import test from "node:test";
import assert from "node:assert/strict";
import { ITEM, PINNED_RELEASES, VERSION } from "./config.mjs";
import { JOB, PUBLISHER_ACCOUNT, SCOPES, scheduledReview } from "./cloud-clock.mjs";
const request = { method: "POST", path: "/review", headers: { "x-cloudscheduler-jobname": JOB, "x-cloudscheduler-scheduletime": new Date().toISOString() } };
const receipt = { itemId: ITEM, command: "publish", version: VERSION, sha256: PINNED_RELEASES[VERSION], action: "waiting_review" };
function fixture(run) {
  const calls = [], logs = [];
  const handler = scheduledReview({ run, log: (message) => logs.push(message), fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith("http://metadata.google.internal/")) return Response.json({ access_token: "runtime-private-token" });
    if (url.endsWith(":generateAccessToken")) return Response.json({ accessToken: "publisher-private-token" });
    if (url === "https://cloudscheduler.googleapis.com/v1/" + JOB + ":pause") return Response.json({ name: JOB, state: "PAUSED" });
    assert.fail("Unexpected request " + url);
  } });
  return { handler, calls, logs };
}
test("the cloud timer mints only short-lived publisher scopes and records the actual scheduled time", async () => {
  const f = fixture(async (command, runtime) => {
    assert.equal(command, "publish");
    assert.equal(runtime.releaseTag, "chrome-extension-v" + VERSION);
    assert.equal(runtime.accessToken, "publisher-private-token");
    assert.equal(runtime.execution.schedulerJob, JOB);
    assert.equal(runtime.execution.scheduledTime, request.headers["x-cloudscheduler-scheduletime"]);
    assert.equal((await runtime.finish(receipt)).action, "watching");
    return receipt;
  });
  assert.equal((await f.handler(request)).status, 200);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].url.includes(PUBLISHER_ACCOUNT));
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { scope: SCOPES, lifetime: "600s" });
  assert.equal(f.logs.some((line) => line.includes("private-token")), false);
});
test("another job, missing schedule metadata and arbitrary paths cannot trigger a release", async () => {
  const f = fixture(() => assert.fail("No release should run"));
  for (const override of [{ method: "GET" }, { path: "/other" }, { headers: {} },
    { headers: { ...request.headers, "x-cloudscheduler-jobname": "another-job" } },
    { headers: { ...request.headers, "x-cloudscheduler-scheduletime": "invalid" } }])
    assert.equal((await f.handler({ ...request, ...override })).status, 403);
  assert.equal(f.calls.length, 0);
});
test("only fresh verified final publication pauses the exact dedicated timer", async () => {
  const f = fixture(async (_, runtime) => {
    const published = { ...receipt, checkedAt: new Date().toISOString(), action: "published",
      published: { state: "PUBLISHED", channels: [{ version: VERSION, deployPercentage: 100 }] } };
    const result = await runtime.finish(published);
    assert.equal(result.schedulerJob, JOB);
    return { ...published, reviewWatch: result };
  });
  assert.equal((await f.handler(request)).status, 200);
  assert.equal(f.calls[2].url, "https://cloudscheduler.googleapis.com/v1/" + JOB + ":pause");
  assert.equal(f.calls[2].options.method, "POST");
});
test("failed cloud requests redact both runtime and publisher credentials", async () => {
  const f = fixture(() => { throw Error("runtime-private-token publisher-private-token Bearer another-secret"); });
  const result = await f.handler(request);
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify([result, f.logs]).includes("private-token"), false);
  assert.equal(JSON.stringify([result, f.logs]).includes("another-secret"), false);
});

test("a new cloud tick replaces stale execution metadata while preserving release progress", async () => {
  const { reconcile } = await import("./run.mjs");
  const { NAME } = await import("./config.mjs");
  let saved = { itemId: ITEM, version: VERSION, sha256: PINNED_RELEASES[VERSION], execution: { scheduledTime: "old" } };
  const execution = { trigger: "schedule", scheduledTime: request.headers["x-cloudscheduler-scheduletime"], schedulerJob: JOB };
  const revision = (version, state) => ({ state, distributionChannels: [{ crxVersion: version, deployPercentage: 100 }] });
  const result = await reconcile("publish", {
    api: async () => ({ name: NAME, itemId: ITEM, publishedItemRevisionStatus: revision("1.2.0", "PUBLISHED"), submittedItemRevisionStatus: revision("1.2.1", "PENDING_REVIEW") }),
    storage: { readReceipt: async () => saved, saveReceipt: async (value) => { saved = structuredClone(value); } },
    loadArtifact: () => assert.fail("A pending review does not need a ZIP"),
    finish: () => ({ action: "watching" }), execution,
  });
  assert.equal(result.action, "waiting_review");
  assert.deepEqual(saved.execution, execution);
  assert.deepEqual(result.execution, execution);
});

test("Google project-number normalization identifies only the same pinned timer", async () => {
 const f=fixture(async()=>receipt);
 assert.equal((await f.handler({...request,headers:{...request.headers,"x-cloudscheduler-jobname":JOB.replace("projects/indiec-507107/","projects/987262795252/")}})).status,200);
 for(const value of [JOB.replace("indiec-507107","other-project"),JOB.replace("indiecrm-chrome-review-15m","another-job")])
  assert.equal((await f.handler({...request,headers:{...request.headers,"x-cloudscheduler-jobname":value}})).status,403);
});

test("Google sends the exact short job name while IAM binds its project identity", async () => {
 const f=fixture(async()=>receipt);
 assert.equal((await f.handler({...request,headers:{...request.headers,"x-cloudscheduler-jobname":"indiecrm-chrome-review-15m"}})).status,200);
 assert.equal((await f.handler({...request,headers:{...request.headers,"x-cloudscheduler-jobname":"another-job"}})).status,403);
});
