import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ITEM, PINNED_RELEASES, REPOSITORY } from "./config.mjs";

export const REVIEW_WORKFLOW = "watch.yml";

export function finishReviewWatch(
  receipt,
  {
    now = Date.now(),
    run = (args) =>
      execFileSync("gh", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
      }),
  } = {},
) {
  if (
    receipt.itemId !== ITEM ||
    receipt.version !== "1.2.1" ||
    receipt.sha256 !== PINNED_RELEASES["1.2.1"] ||
    receipt.command !== "publish"
  )
    throw new Error("The review watch requires the exact IndieCRM 1.2.1 publication receipt.");
  if (receipt.action !== "published") return { action: "watching", state: receipt.action };
  const age = now - Date.parse(receipt.checkedAt);
  if (
    !Number.isFinite(age) ||
    age < -60000 ||
    age > 600000 ||
    receipt.error ||
    receipt.takenDown ||
    receipt.warned ||
    receipt.published?.state !== "PUBLISHED" ||
    !receipt.published.channels?.length ||
    !receipt.published.channels.every(
      (channel) => channel.version === "1.2.1" && channel.deployPercentage === 100,
    )
  )
    throw new Error("Fresh Google publication proof is required before stopping review checks.");
  run([
    "api",
    "--method",
    "PUT",
    `repos/${REPOSITORY}/actions/workflows/${REVIEW_WORKFLOW}/disable`,
  ]);
  return { action: "stopped", workflow: REVIEW_WORKFLOW, publishedVersion: "1.2.1" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(
      JSON.stringify(finishReviewWatch(JSON.parse(readFileSync(process.argv[2], "utf8")))),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
