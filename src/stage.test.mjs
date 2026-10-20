import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUCKET, PINNED_RELEASES, VERSION } from "./config.mjs";
import { stageRelease } from "./stage.mjs";

const downloadUrl =
  "https://release-assets.githubusercontent.com/github-production-release-asset/test?signature=private";
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "stage-test-"));
  const original = PINNED_RELEASES[VERSION];
  try {
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        name: "IndieCRM Connect",
        version: VERSION,
        manifest_version: 3,
      }),
    );
    execFileSync("zip", ["-q", "release.zip", "manifest.json"], {
      cwd: directory,
    });
    const bytes = await readFile(join(directory, "release.zip"));
    PINNED_RELEASES[VERSION] = createHash("sha256").update(bytes).digest("hex");
    await run(bytes);
  } finally {
    PINNED_RELEASES[VERSION] = original;
    await rm(directory, { recursive: true, force: true });
  }
}

test("staging writes only verified private bytes, conditionally creates the exact object and reads them back", async () => {
  await fixture(async (bytes) => {
    const calls = [];
    const result = await stageRelease({
      token: "private-google-token",
      downloadUrl,
      version: VERSION,
      fetcher: async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) {
          assert.equal(options.headers, undefined);
          return new Response(bytes);
        }
        assert.equal(
          options.headers.Authorization,
          "Bearer private-google-token",
        );
        if (calls.length === 2) {
          assert.ok(url.includes(`/b/${BUCKET}/`));
          assert.ok(url.includes("ifGenerationMatch=0"));
          assert.ok(
            url.includes(`releases%2F${VERSION}%2Findiecrm-connect-${VERSION}.zip`),
          );
          assert.deepEqual(options.body, bytes);
          return new Response("{}", { status: 200 });
        }
        return new Response(bytes);
      },
    });
    assert.equal(result.action, "staged");
    assert.equal(result.bytes, bytes.length);
    assert.equal(calls.length, 3);
    assert.ok(
      calls.every(
        ({ url, options }) =>
          !url.includes("receipt.json") && options.redirect === "error",
      ),
    );
    assert.ok(!JSON.stringify(result).includes("private"));
  });
});

test("an existing artifact is compared without overwriting, and mismatched stored bytes fail", async () => {
  await fixture(async (bytes) => {
    for (const matching of [true, false]) {
      let call = 0;
      const run = stageRelease({
        token: "token",
        downloadUrl,
        version: VERSION,
        fetcher: async () => {
          if (++call === 1) return new Response(bytes);
          if (call === 2) return new Response("{}", { status: 412 });
          return new Response(matching ? bytes : "different artifact");
        },
      });
      if (matching) assert.equal((await run).existing, true);
      else await assert.rejects(run, /readback did not match/);
      assert.equal(call, 3);
    }
  });
});

test("unknown versions, off-site downloads and wrong checksums never write to storage", async () => {
  for (const options of [
    { version: "1.2.4", downloadUrl },
    { version: VERSION, downloadUrl: "https://example.com/private" },
    { version: VERSION, downloadUrl },
  ]) {
    const calls = [];
    await assert.rejects(
      stageRelease({
        token: "token",
        ...options,
        fetcher: async (url) => {
          calls.push(url);
          return new Response("wrong ZIP");
        },
      }),
    );
    assert.ok(
      calls.every(
        (url) =>
          new URL(url).hostname === "release-assets.githubusercontent.com",
      ),
    );
  }
});

test("provider errors never disclose the signed URL or token", async () => {
  await assert.rejects(
    stageRelease({
      token: "secret-token",
      downloadUrl,
      version: VERSION,
      fetcher: async () => {
        throw new Error(downloadUrl + " secret-token");
      },
    }),
    (error) =>
      !error.message.includes("signature") &&
      !error.message.includes("secret-token"),
  );
});
