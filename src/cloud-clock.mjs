import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ITEM, VERSION } from "./config.mjs";
import { finishReviewWatch } from "./finish-watch.mjs";
import { main } from "./run.mjs";

export const PROJECT = "indiec-507107";
export const REGION = "us-central1";
export const JOB = "projects/" + PROJECT + "/locations/" + REGION + "/jobs/indiecrm-chrome-review-15m";
export const PUBLISHER_ACCOUNT = "indiecrm-chrome-publisher@" + PROJECT + ".iam.gserviceaccount.com";
export const SCOPES = [
  "https://www.googleapis.com/auth/chromewebstore",
  "https://www.googleapis.com/auth/devstorage.read_write",
];

export function scheduledReview({ fetcher = fetch, run = main, log = console.log } = {}) {
  return async ({ method, path, headers }) => {
    if (method === "GET" && path === "/")
      return { status: 200, body: { controller: "indiecrm-chrome-review", version: VERSION } };
    const scheduledTime = headers["x-cloudscheduler-scheduletime"];
    const receivedJob = headers["x-cloudscheduler-jobname"];
    const acceptedJobs = new Set([JOB, JOB.replace("projects/" + PROJECT + "/", "projects/987262795252/")]);
    if (method !== "POST" || path !== "/review" ||
        !acceptedJobs.has(receivedJob) ||
        typeof scheduledTime !== "string" || !Number.isFinite(Date.parse(scheduledTime))) {
      log(JSON.stringify({
        event: "indiecrm_scheduled_request_rejected", method,
        schedulerJob: typeof receivedJob === "string" && receivedJob.startsWith("projects/") ? receivedJob.slice(0, 200) : "[missing or invalid]",
        scheduledTime: typeof scheduledTime === "string" && Number.isFinite(Date.parse(scheduledTime)) ? scheduledTime : "[missing or invalid]",
        schedulerHeaderNames: Object.keys(headers).filter((name) => name.includes("cloudscheduler")),
      }));
      return { status: 403, body: { error: "An authenticated request from the pinned cloud timer is required." } };
    }

    const execution = {
      trigger: "schedule", scheduler: "google-cloud-scheduler", schedulerJob: JOB, receivedSchedulerJob: receivedJob,
      scheduledTime, receivedAt: new Date().toISOString(), runtime: "google-cloud-run",
      revision: process.env.K_REVISION ?? "local-test",
    };
    const secrets = [];
    const json = async (url, options, label) => {
      const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(label + " returned HTTP " + response.status + ".");
      return response.json();
    };
    try {
      const identity = await json(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        { headers: { "Metadata-Flavor": "Google" } }, "Cloud runtime identity");
      if (!identity.access_token) throw new Error("Cloud runtime returned no access token.");
      secrets.push(identity.access_token);
      const credentials = await json(
        "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/" + PUBLISHER_ACCOUNT + ":generateAccessToken",
        { method: "POST", headers: { Authorization: "Bearer " + identity.access_token, "Content-Type": "application/json" },
          body: JSON.stringify({ scope: SCOPES, lifetime: "600s" }) }, "Short-lived publisher identity");
      if (!credentials.accessToken) throw new Error("Google returned no short-lived publisher token.");
      secrets.push(credentials.accessToken);
      const receipt = await run("publish", {
        accessToken: credentials.accessToken, releaseTag: "chrome-extension-v" + VERSION, execution,
        finish: async (verified) => {
          const result = finishReviewWatch(verified, { run: () => {} });
          if (result.action !== "stopped") return result;
          const paused = await json(
            "https://cloudscheduler.googleapis.com/v1/" + JOB + ":pause",
            { method: "POST", headers: { Authorization: "Bearer " + identity.access_token, "Content-Type": "application/json" }, body: "{}" },
            "Pause the completed release timer");
          if (paused.name !== JOB || paused.state !== "PAUSED")
            throw new Error("The completed timer pause was not confirmed.");
          return { action: "stopped", schedulerJob: JOB, publishedVersion: VERSION };
        },
      });
      log(JSON.stringify({ event: "indiecrm_scheduled_review_completed", ...execution, receipt }));
      return { status: 200, body: { ...receipt, execution } };
    } catch (error) {
      let message = String(error.message);
      for (const secret of secrets) message = message.replaceAll(secret, "[redacted]");
      message = message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 1500);
      log(JSON.stringify({ event: "indiecrm_scheduled_review_failed", ...execution, itemId: ITEM, error: message }));
      return { status: 500, body: { itemId: ITEM, execution, error: message } };
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const handle = scheduledReview();
  createServer(async (request, response) => {
    const result = await handle({ method: request.method, path: request.url, headers: request.headers });
    response.writeHead(result.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(result.body));
  }).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
}
