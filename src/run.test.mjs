import test from "node:test";
import assert from "node:assert/strict";
import { ITEM, NAME, PINNED_RELEASES, VERSION } from "./config.mjs";
import { reconcile } from "./run.mjs";

const revision = (version, state) => ({
  state,
  distributionChannels: [{ crxVersion: version, deployPercentage: 100 }],
});
const status = () => ({
  name: NAME,
  itemId: ITEM,
  publishedItemRevisionStatus: revision("1.1.0", "PUBLISHED"),
});
const release = {
  version: VERSION,
  sha256: PINNED_RELEASES[VERSION],
  bytes: Buffer.from("checked artifact"),
};

test("pending review checks keep progress without downloading the ZIP or submitting again", async () => {
  const current = {
    ...status(),
    submittedItemRevisionStatus: revision("1.2.0", "PENDING_REVIEW"),
  };
  let receipt = {};
  const result = await reconcile("publish", {
    api: async (action) => {
      assert.equal(action, "fetchStatus");
      return current;
    },
    storage: {
      readReceipt: async () => receipt,
      saveReceipt: async (next) => {
        receipt = structuredClone(next);
      },
    },
    loadArtifact: async () =>
      assert.fail("A pending review does not need another ZIP download"),
    finish: () => ({ action: "watching" }),
  });
  assert.equal(result.action, "waiting_review");
  assert.equal(receipt.command, "publish");
  assert.equal(receipt.sha256, release.sha256);
});

test("read-only status leaves the publication checkpoint untouched", async () => {
  const result = await reconcile("status", {
    api: async () => status(),
    storage: new Proxy(
      {},
      { get: () => assert.fail("Status must not change private progress") },
    ),
    loadArtifact: async () => assert.fail("Status must not download the ZIP"),
  });
  assert.equal(result.action, "status");
});

test("a later cloud process resumes acknowledged upload progress and verifies submission", async () => {
  let receipt = {};
  let uploads = 0;
  let publishCalls = 0;
  let current = status();
  const storage = {
    readReceipt: async () => structuredClone(receipt),
    saveReceipt: async (next) => {
      receipt = structuredClone(next);
    },
  };
  const api = async (action) => {
    if (action === "fetchStatus") return current;
    if (action === "upload") {
      uploads++;
      return { uploadState: "SUCCEEDED", crxVersion: VERSION };
    }
    if (action === "publish") {
      if (++publishCalls === 1) throw new Error("Temporary transport failure");
      current = {
        ...status(),
        submittedItemRevisionStatus: revision(VERSION, "PENDING_REVIEW"),
      };
      return {};
    }
    throw new Error("Unexpected operation");
  };
  const options = {
    api,
    storage,
    loadArtifact: async () => release,
    finish: () => ({ action: "watching" }),
  };
  await assert.rejects(reconcile("publish", options), /Temporary transport/);
  assert.equal(receipt.uploaded, true);
  const result = await reconcile("publish", options);
  assert.equal(uploads, 1);
  assert.equal(result.action, "submitted");
  assert.equal(receipt.error, undefined);
});

test("another item's checkpoint and failed pre-upload persistence prevent Store writes", async () => {
  for (const wrongItem of [true, false]) {
    const writes = [];
    const storage = {
      readReceipt: async () => (wrongItem ? { itemId: "other-item" } : {}),
      saveReceipt: async () => {
        throw new Error("Conditional write rejected");
      },
    };
    await assert.rejects(
      reconcile("publish", {
        api: async (action) => {
          if (action === "fetchStatus") return status();
          writes.push(action);
        },
        storage,
        loadArtifact: async () => release,
      }),
    );
    assert.deepEqual(writes, []);
  }
});
