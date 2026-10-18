import test from "node:test";
import assert from "node:assert/strict";
import { ITEM, PINNED_RELEASES } from "./config.mjs";
import { finishReviewWatch } from "./finish-watch.mjs";

const now = Date.parse("2026-10-18T09:15:00Z");
const target = {
  itemId: ITEM,
  command: "publish",
  version: "1.2.1",
  sha256: PINNED_RELEASES["1.2.1"],
  action: "published",
  checkedAt: new Date(now).toISOString(),
  published: {
    state: "PUBLISHED",
    channels: [{ version: "1.2.1", deployPercentage: 100 }],
  },
};

test("an older pending review or submitted target keeps the cloud watch running", () => {
  for (const action of ["waiting_review", "submitted", "waiting_upload"]) {
    const result = finishReviewWatch(
      {
        ...target,
        action,
        published: { state: "PUBLISHED", channels: [{ version: "1.1.0" }] },
      },
      { now, run: () => assert.fail("Review checks must keep running") },
    );
    assert.equal(result.action, "watching");
  }
});

test("fresh target publication disables only its dedicated scheduler and preserves future releases", () => {
  const calls = [];
  const result = finishReviewWatch(target, {
    now,
    run: (args) => calls.push(args),
  });
  assert.equal(result.action, "stopped");
  assert.deepEqual(calls, [
    [
      "api",
      "--method",
      "PUT",
      "repos/danielsinewe/indiecrm-extension-rollout/actions/workflows/review-timer.yml/disable",
    ],
  ]);
});

test("another item, different bytes, stale receipt and unverified publication cannot stop checks", () => {
  for (const override of [
    { itemId: "another-item" },
    { version: "1.2.0" },
    { sha256: "different-bytes" },
    { command: "status" },
    { checkedAt: new Date(now - 600001).toISOString() },
    { checkedAt: "invalid" },
    { checkedAt: new Date(now + 60001).toISOString() },
    { error: "Publication failed" },
    { warned: true },
    { takenDown: true },
    { published: { state: "STAGED", channels: [{ version: "1.2.1" }] } },
    { published: { state: "PUBLISHED", channels: [{ version: "1.2.0" }] } },
    {
      published: {
        state: "PUBLISHED",
        channels: [{ version: "1.2.1", deployPercentage: 10 }],
      },
    },
    {
      published: {
        state: "PUBLISHED_TO_TESTERS",
        channels: [{ version: "1.2.1" }],
      },
    },
  ]) {
    const calls = [];
    assert.throws(() =>
      finishReviewWatch(
        { ...target, ...override },
        { now, run: (args) => calls.push(args) },
      ),
    );
    assert.deepEqual(calls, []);
  }
});
