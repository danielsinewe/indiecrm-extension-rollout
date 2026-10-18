import test from "node:test";
import assert from "node:assert/strict";
import { ITEM, NAME, PINNED_RELEASES, VERSION } from "./config.mjs";
import { reconcile, reconcileRollout } from "./run.mjs";
import { finishReviewWatch } from "./finish-watch.mjs";

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

test("the cloud chain waits for 1.2.1, submits 1.2.2 once, and stops only after final publication", async () => {
  let current = {
    ...status(),
    submittedItemRevisionStatus: revision("1.2.1", "PENDING_REVIEW"),
  };
  let uploads = 0,
    publications = 0,
    stopped = 0;
  const receipts = new Map();
  const options = {
    api: async (action, bytes) => {
      if (action === "fetchStatus") return current;
      if (action === "upload") {
        uploads++;
        assert.deepEqual(bytes, release.bytes);
        return { uploadState: "SUCCEEDED", crxVersion: VERSION };
      }
      if (action === "publish") {
        publications++;
        current =
          current.submittedItemRevisionStatus?.state === "STAGED"
            ? {
                ...status(),
                publishedItemRevisionStatus: revision(VERSION, "PUBLISHED"),
              }
            : {
                ...current,
                submittedItemRevisionStatus: revision(
                  VERSION,
                  "PENDING_REVIEW",
                ),
              };
        return {};
      }
      assert.fail(`Unexpected ${action}`);
    },
    storageFor: (version) => ({
      readReceipt: async () => receipts.get(version) ?? {},
      saveReceipt: async (receipt) =>
        receipts.set(version, structuredClone(receipt)),
    }),
    loadArtifact: async (version) => {
      assert.equal(version, VERSION);
      return release;
    },
    finish: (receipt) => finishReviewWatch(receipt, { run: () => stopped++ }),
  };
  assert.equal(
    (await reconcileRollout("publish", options)).action,
    "waiting_review",
  );
  assert.equal(uploads, 0);
  assert.equal(publications, 0);
  assert.equal(receipts.has("1.2.1"), false);
  current = {
    ...status(),
    publishedItemRevisionStatus: revision("1.2.1", "PUBLISHED"),
  };
  assert.equal(
    (await reconcileRollout("publish", options)).action,
    "submitted",
  );
  assert.equal(
    (await reconcileRollout("publish", options)).action,
    "waiting_review",
  );
  assert.equal(uploads, 1);
  assert.equal(publications, 1);
  assert.equal(stopped, 0);
  current = {
    ...current,
    submittedItemRevisionStatus: revision(VERSION, "STAGED"),
  };
  const result = await reconcileRollout("publish", options);
  assert.equal(result.action, "published");
  assert.equal(result.reviewWatch.action, "stopped");
  assert.equal(stopped, 1);
  assert.equal(uploads, 1);
  assert.equal(publications, 2);
  assert.equal(receipts.get(VERSION).sha256, PINNED_RELEASES[VERSION]);
});

test("an approved staged predecessor publishes before the target and keeps separate pinned checkpoints", async () => {
  let current = {
    ...status(),
    submittedItemRevisionStatus: revision("1.2.1", "STAGED"),
  };
  const operations = [],
    receipts = new Map();
  const result = await reconcileRollout("publish", {
    api: async (action) => {
      if (action === "fetchStatus") return current;
      operations.push(action);
      if (action === "upload")
        return { uploadState: "SUCCEEDED", crxVersion: VERSION };
      if (action === "publish") {
        current =
          current.submittedItemRevisionStatus?.state === "STAGED"
            ? {
                ...status(),
                publishedItemRevisionStatus: revision("1.2.1", "PUBLISHED"),
              }
            : {
                ...current,
                submittedItemRevisionStatus: revision(
                  VERSION,
                  "PENDING_REVIEW",
                ),
              };
        return {};
      }
      assert.fail(`Unexpected ${action}`);
    },
    storageFor: (version) => ({
      readReceipt: async () => receipts.get(version) ?? {},
      saveReceipt: async (receipt) =>
        receipts.set(version, structuredClone(receipt)),
    }),
    loadArtifact: async (version) => {
      assert.equal(version, VERSION);
      return release;
    },
    finish: (receipt) =>
      finishReviewWatch(receipt, {
        run: () => assert.fail("Do not stop at predecessor publication"),
      }),
  });
  assert.equal(result.action, "submitted");
  assert.deepEqual(operations, ["publish", "upload", "publish"]);
  for (const version of ["1.2.1", VERSION]) {
    assert.equal(receipts.get(version).version, version);
    assert.equal(receipts.get(version).sha256, PINNED_RELEASES[version]);
  }
});
