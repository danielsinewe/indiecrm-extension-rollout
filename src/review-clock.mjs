import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPOSITORY, VERSION } from "./config.mjs";
import { REVIEW_WORKFLOW } from "./finish-watch.mjs";

// GitHub holds this workflow at its environment wait timer before allocating
// a runner. Each completed check queues one successor, independent of cron.
export function continueReviewClock({
  repository = process.env.GITHUB_REPOSITORY,
  ref = process.env.GITHUB_REF,
  enabled = process.env.REVIEW_ENABLED,
  generation = process.env.REVIEW_CLOCK_ID,
  expectedGeneration = process.env.EXPECTED_CLOCK_ID,
  runId = process.env.GITHUB_RUN_ID,
  run = (args) => execFileSync("gh", args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000,
  }).trim(),
} = {}) {
  if (repository !== REPOSITORY || ref !== "refs/heads/main")
    throw new Error("The clock must run in the exact release repository on main.");
  if (enabled !== "true" || !generation || generation !== expectedGeneration)
    return { action: "stopped", reason: "Clock disabled or superseded" };
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(generation) || !/^\d+$/.test(runId ?? ""))
    throw new Error("Invalid clock generation or workflow run.");
  const state = () => run([
    "api", `repos/${REPOSITORY}/actions/workflows/${REVIEW_WORKFLOW}`,
    "--jq", ".state",
  ]).trim();
  if (state() !== "active") return { action: "stopped", reason: "Review workflow disabled" };
  run([
    "workflow", "run", "store.yml", "--repo", REPOSITORY, "--ref", "main",
    "-f", "command=publish", "-f", `release_tag=chrome-extension-v${VERSION}`,
    "-f", `request_id=review-clock-${runId}`,
  ]);
  // The publisher can disable the clock after final, fresh Google proof.
  if (state() !== "active") return { action: "stopped", publisherQueued: true };
  run([
    "workflow", "run", REVIEW_WORKFLOW, "--repo", REPOSITORY, "--ref", "main",
    "-f", `clock_id=${generation}`,
  ]);
  return { action: "queued", publisherQueued: true, successorQueued: true, version: VERSION };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(continueReviewClock())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
