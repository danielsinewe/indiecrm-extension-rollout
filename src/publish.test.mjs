import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeApi } from "./api.mjs";
import { readRelease } from "./artifact.mjs";
import { ITEM, NAME } from "./config.mjs";
import { publishRelease, releasePlan } from "./lifecycle.mjs";

const release = {
  version: "1.2.1",
  sha256: "a".repeat(64),
  bytes: Buffer.from("verified runtime ZIP"),
};
const revision = (version, state) => ({
  state,
  distributionChannels: [{ crxVersion: version, deployPercentage: 100 }],
});
const initial = () => ({
  name: NAME,
  itemId: ITEM,
  publishedItemRevisionStatus: revision("1.1.0", "PUBLISHED"),
});

function fixture(status = initial()) {
  let current = structuredClone(status);
  const calls = [],
    saved = [];
  const api = async (action, bytes) => {
    calls.push(action);
    if (action === "fetchStatus") return structuredClone(current);
    if (action === "upload") {
      assert.deepEqual(bytes, release.bytes);
      return {
        name: NAME,
        itemId: ITEM,
        uploadState: "SUCCEEDED",
        crxVersion: release.version,
      };
    }
    if (action === "publish") {
      current.submittedItemRevisionStatus = revision(
        release.version,
        "PENDING_REVIEW",
      );
      return { name: NAME, itemId: ITEM, state: "PENDING_REVIEW" };
    }
    throw new Error(`Unexpected ${action}`);
  };
  return {
    api,
    calls,
    saved,
    save: async (r) => saved.push(structuredClone(r)),
    change: (next) => (current = next),
  };
}

test("an older pending review is preserved without an upload or cancellation", async () => {
  const status = initial();
  status.submittedItemRevisionStatus = revision("1.2.0", "PENDING_REVIEW");
  const f = fixture(status);
  const result = await publishRelease(f.api, release, f);
  assert.equal(result.action, "waiting_review");
  assert.deepEqual(f.calls, ["fetchStatus"]);
});

test("the target already submitted or published is idempotent", async () => {
  for (const state of ["PENDING_REVIEW", "PUBLISHED"]) {
    const status = initial();
    status[
      state === "PUBLISHED"
        ? "publishedItemRevisionStatus"
        : "submittedItemRevisionStatus"
    ] = revision("1.2.1", state);
    const f = fixture(status);
    assert.equal(
      (await publishRelease(f.api, release, f)).action,
      state === "PUBLISHED" ? "published" : "waiting_review",
    );
    assert.deepEqual(f.calls, ["fetchStatus"]);
  }
});

test("a clear release uploads the exact checked bytes and independently verifies submission", async () => {
  const f = fixture();
  const result = await publishRelease(f.api, release, f);
  assert.equal(result.action, "submitted");
  assert.deepEqual(f.calls, [
    "fetchStatus",
    "upload",
    "fetchStatus",
    "publish",
    "fetchStatus",
  ]);
  assert.deepEqual(
    f.saved.map((r) => r.action),
    ["uploading", "uploaded", "submitted"],
  );
  assert.equal(f.saved[0].uploaded, false);
  assert.equal(f.saved[1].sha256, release.sha256);
  assert.equal(result.submitted.channels[0].version, "1.2.1");
});

test("a confirmed upload receipt resumes after a process restart without uploading again", async () => {
  const f = fixture();
  const receipt = {
    itemId: ITEM,
    version: release.version,
    sha256: release.sha256,
    uploaded: true,
    uploadAttempted: true,
  };
  assert.equal(
    (await publishRelease(f.api, release, { ...f, receipt })).action,
    "submitted",
  );
  assert.equal(f.calls.includes("upload"), false);
});

test("unknown uploads and receipts for different bytes cannot submit an unverified draft", async () => {
  for (const receipt of [
    { uploadAttempted: true, uploaded: false },
    {
      itemId: ITEM,
      version: release.version,
      sha256: "b".repeat(64),
      uploaded: true,
      uploadAttempted: true,
    },
  ]) {
    const f = fixture();
    await assert.rejects(
      publishRelease(f.api, release, { ...f, receipt }),
      /unknown outcome/,
    );
    assert.deepEqual(f.calls, ["fetchStatus"]);
  }
});

test("an asynchronous upload keeps its uncertain receipt and cannot become an assumed success", async () => {
  const f = fixture();
  const api = async (action, bytes) =>
    action === "upload"
      ? { name: NAME, itemId: ITEM, uploadState: "IN_PROGRESS" }
      : f.api(action, bytes);
  await assert.rejects(publishRelease(api, release, f), /not confirmed/);
  assert.equal(f.saved[0].uploadAttempted, true);
  assert.equal(f.saved[0].uploaded, false);
  const status = { ...initial(), lastAsyncUploadState: "IN_PROGRESS" };
  const waiting = fixture(status);
  assert.equal(
    (
      await publishRelease(waiting.api, release, {
        ...waiting,
        receipt: f.saved[0],
      })
    ).uploadAttempted,
    true,
  );
  waiting.change({ ...initial(), lastAsyncUploadState: "SUCCEEDED" });
  await assert.rejects(
    publishRelease(waiting.api, release, {
      ...waiting,
      receipt: waiting.saved.at(-1),
    }),
    /unknown outcome/,
  );
});

test("a staged target publishes without replacing its package; another staged version is preserved", async () => {
  for (const version of ["1.2.0", "1.2.1"]) {
    const status = initial();
    status.submittedItemRevisionStatus = revision(version, "STAGED");
    const f = fixture(status);
    const result = await publishRelease(f.api, release, f);
    assert.equal(f.calls.includes("upload"), false);
    assert.equal(f.calls.includes("publish"), version === "1.2.1");
    assert.equal(
      result.action,
      version === "1.2.1" ? "submitted" : "waiting_other_staged_release",
    );
  }
});

test("an identified async upload waits for Google processing before submission", async () => {
  const f = fixture();
  let uploads = 0;
  let checks = 0;
  let submitted = false;
  const api = async (action, bytes) => {
    if (action === "upload") {
      uploads++;
      return { name: NAME, itemId: ITEM, uploadState: "IN_PROGRESS" };
    }
    if (action === "fetchStatus" && uploads && !submitted) {
      f.change({
        ...initial(),
        lastAsyncUploadState: ++checks === 1 ? "IN_PROGRESS" : "SUCCEEDED",
      });
    }
    if (action === "publish") {
      assert.ok(
        f.saved.some((saved) => saved.uploaded && saved.uploadAccepted),
      );
      submitted = true;
    }
    return f.api(action, bytes);
  };
  const result = await publishRelease(api, release, {
    ...f,
    wait: async () => {},
  });
  assert.equal(result.action, "submitted");
  assert.equal(uploads, 1);
  assert.equal(f.calls.filter((action) => action === "publish").length, 1);
  assert.ok(f.saved.some((saved) => saved.uploadAccepted && !saved.uploaded));
});

test("an accepted async upload survives a new process without another package upload", async () => {
  const f = fixture();
  let uploads = 0;
  const api = async (action, bytes) => {
    if (action === "upload") {
      uploads++;
      f.change({ ...initial(), lastAsyncUploadState: "IN_PROGRESS" });
      return { name: NAME, itemId: ITEM, uploadState: "UPLOAD_IN_PROGRESS" };
    }
    return f.api(action, bytes);
  };
  const waiting = await publishRelease(api, release, {
    ...f,
    wait: async () => {},
  });
  assert.equal(waiting.action, "waiting_upload");
  assert.equal(waiting.uploadAccepted, true);
  assert.equal(waiting.uploaded, false);
  f.change({ ...initial(), lastAsyncUploadState: "SUCCEEDED" });
  const result = await publishRelease(api, release, {
    ...f,
    receipt: f.saved.at(-1),
    wait: async () => {},
  });
  assert.equal(result.action, "submitted");
  assert.equal(uploads, 1);
});

test("async acknowledgments cannot hide changed bytes or a lost/failed Google upload", async () => {
  for (const change of [
    { sha256: "other-bytes", state: "SUCCEEDED" },
    { sha256: release.sha256, state: null },
    { sha256: release.sha256, state: "FAILED" },
  ]) {
    const f = fixture({ ...initial(), lastAsyncUploadState: change.state });
    await assert.rejects(
      publishRelease(f.api, release, {
        ...f,
        receipt: {
          itemId: ITEM,
          version: release.version,
          sha256: change.sha256,
          uploadAttempted: true,
          uploadAccepted: true,
          uploaded: false,
        },
      }),
      /different bytes|not confirmed/,
    );
    assert.equal(f.calls.includes("upload"), false);
    assert.equal(f.calls.includes("publish"), false);
  }
});

test("newer versions, policy flags, rejected revisions and wrong item identities fail closed", () => {
  const cases = [
    { ...initial(), itemId: "another-item" },
    { ...initial(), warned: true },
    { ...initial(), takenDown: true },
    {
      ...initial(),
      publishedItemRevisionStatus: revision("1.3.0", "PUBLISHED"),
    },
    {
      ...initial(),
      submittedItemRevisionStatus: revision("1.2.0", "REJECTED"),
    },
    {
      ...initial(),
      submittedItemRevisionStatus: {
        state: "PENDING_REVIEW",
        distributionChannels: [],
      },
    },
  ];
  for (const status of cases)
    assert.throws(() => releasePlan(status, release.version));
});

test("a newer revision appearing after upload prevents publication", async () => {
  const f = fixture();
  const api = async (action, bytes) => {
    const result = await f.api(action, bytes);
    if (action === "upload")
      f.change({
        ...initial(),
        submittedItemRevisionStatus: revision("1.3.0", "PENDING_REVIEW"),
      });
    return result;
  };
  await assert.rejects(publishRelease(api, release, f), /newer version/);
  assert.equal(f.calls.includes("publish"), false);
});

test("the API pins publisher/item, preserves audience and rollout, requires review, and hides credentials", async () => {
  const requests = [];
  const api = storeApi(
    async () => "private-synthetic-token",
    async (url, init) => {
      requests.push({ url, ...init });
      return new Response(JSON.stringify({ name: NAME, itemId: ITEM }), {
        status: 200,
      });
    },
  );
  await api("publish");
  assert.equal(
    requests[0].url,
    `https://chromewebstore.googleapis.com/v2/${NAME}:publish`,
  );
  assert.deepEqual(JSON.parse(requests[0].body), {
    publishType: "DEFAULT_PUBLISH",
    skipReview: false,
    blockOnWarnings: true,
  });
  assert.equal(requests[0].redirect, "error");
  await assert.rejects(api("cancelSubmission"), /Unsupported/);
  const failing = storeApi(
    async () => "private-synthetic-token",
    async () =>
      new Response(
        JSON.stringify({
          error: { message: "Rejected Bearer private-synthetic-token" },
        }),
        { status: 403 },
      ),
  );
  await assert.rejects(
    failing("fetchStatus"),
    (e) => e.status === 403 && !e.message.includes("private-synthetic-token"),
  );
});

async function releaseFixture(t, overrides = {}) {
  const directory = await mkdtemp(
    join(tmpdir(), "indiecrm-extension-artifact-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const version = "1.3.4",
    filename = `indiecrm-connect-${version}.zip`;
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify({
      name: "IndieCRM Connect",
      version,
      manifest_version: 3,
      ...overrides,
    }),
  );
  execFileSync("zip", ["-q", filename, "manifest.json"], { cwd: directory });
  const bytes = await readFile(join(directory, filename));
  await writeFile(
    join(directory, filename + ".sha256"),
    `${createHash("sha256").update(bytes).digest("hex")}  ${filename}\n`,
  );
  return { directory, version, filename };
}

test("the release loader reads the packaged manifest and never rebuilds an existing release", async (t) => {
  const f = await releaseFixture(t);
  assert.equal((await readRelease(f.directory, f.version)).version, f.version);
  await writeFile(
    join(f.directory, f.filename + ".sha256"),
    `${"0".repeat(64)}  ${f.filename}\n`,
  );
  await assert.rejects(readRelease(f.directory, f.version), /checksum differs/);
});

test("a valid checksum cannot disguise the wrong extension or version", async (t) => {
  for (const overrides of [
    { name: "Different extension" },
    { version: "1.3.5" },
  ]) {
    const f = await releaseFixture(t, overrides);
    await assert.rejects(
      readRelease(f.directory, f.version),
      /manifest does not match/,
    );
  }
});
