import test from "node:test";
import assert from "node:assert/strict";
import { continueReviewClock } from "./review-clock.mjs";
import { REPOSITORY, VERSION } from "./config.mjs";

const valid = {
  repository: REPOSITORY, ref: "refs/heads/main", enabled: "true",
  generation: "release-1-3-3-20261020", expectedGeneration: "release-1-3-3-20261020", runId: "12345",
};
const harness = (states = ["active", "active"], delay = 15) => {
  const calls = [];
  return { calls, run: args => { calls.push(args); return args[1]?.includes("/environments/")
    ? JSON.stringify({ name: "chrome-review-delay", protection_rules: [{ type: "wait_timer", wait_timer: delay }] })
    : args[0] === "api" ? states.shift() : ""; } };
};
test("one delayed check queues the pinned publisher and exactly one successor", () => {
  const h = harness();
  assert.deepEqual(continueReviewClock({ ...valid, run: h.run }), {
    action: "queued", publisherQueued: true, successorQueued: true, version: VERSION,
  });
  assert.deepEqual(h.calls.filter(c => c[0] === "workflow"), [
    ["workflow", "run", "store.yml", "--repo", REPOSITORY, "--ref", "main", "-f", "command=publish", "-f", `release_tag=chrome-extension-v${VERSION}`, "-f", "request_id=review-clock-12345"],
    ["workflow", "run", "review-timer.yml", "--repo", REPOSITORY, "--ref", "main", "-f", "clock_id=release-1-3-3-20261020"],
  ]);
});
test("disabled or superseded generations make no external calls", () => {
  for (const override of [{ enabled: "false" }, { generation: "" }, { generation: "old-release" }]) {
    const h = harness();
    assert.equal(continueReviewClock({ ...valid, ...override, run: h.run }).action, "stopped");
    assert.deepEqual(h.calls, []);
  }
});
test("another repository, ref or malformed run cannot dispatch", () => {
  for (const override of [{ repository: "another/project" }, { ref: "refs/heads/another" }, { runId: "not-a-run" }, { generation: "invalid/value", expectedGeneration: "invalid/value" }]) {
    const h = harness();
    assert.throws(() => continueReviewClock({ ...valid, ...override, run: h.run }));
    assert.deepEqual(h.calls, []);
  }
});
test("completed publication stops a queued successor before another publisher", () => {
  const h = harness(["disabled_manually"]);
  assert.equal(continueReviewClock({ ...valid, run: h.run }).action, "stopped");
  assert.equal(h.calls.filter(c => c[0] === "workflow").length, 0);
});
test("publication completing during dispatch prevents the next check", () => {
  const h = harness(["active", "disabled_manually"]);
  assert.deepEqual(continueReviewClock({ ...valid, run: h.run }), { action: "stopped", publisherQueued: true });
  assert.equal(h.calls.filter(c => c[0] === "workflow").length, 1);
});
test("an unacknowledged publisher dispatch fails without claiming a successor", () => {
  const calls = [];
  assert.throws(() => continueReviewClock({ ...valid, run: args => {
    calls.push(args);
    if (args[1]?.includes("/environments/")) return JSON.stringify({ name: "chrome-review-delay", protection_rules: [{ type: "wait_timer", wait_timer: 15 }] });
    if (args[0] === "api") return "active"; throw new Error("GitHub unavailable");
  } }), /GitHub unavailable/);
  assert.equal(calls.filter(c => c.includes("review-timer.yml") && c[0] === "workflow").length, 0);
});
test("a missing, zero or excessive delay cannot create a rapid dispatch loop", () => {
  for (const delay of [undefined, null, 0, 61, "15"]) {
    const h = harness(["active", "active"], delay === undefined ? null : delay);
    assert.throws(() => continueReviewClock({ ...valid, run: h.run }), /wait timer/);
    assert.equal(h.calls.filter(c => c[0] === "workflow").length, 0);
  }
});
