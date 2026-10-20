import test from "node:test";
import assert from "node:assert/strict";
import { BUCKET, PINNED_RELEASES, releaseVersion } from "./config.mjs";
import { privateStorage, RECEIPT_OBJECT } from "./storage.mjs";

const metadata = (generation) => ({
  bucket: BUCKET,
  name: RECEIPT_OBJECT,
  generation,
});
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

test("private progress reads a pinned generation and saves with conditional writes", async () => {
  const calls = [];
  const responses = [
    json(metadata("7")),
    json({ action: "waiting_review" }),
    json(metadata("8")),
    json(metadata("9")),
  ];
  const storage = privateStorage("private-token", async (url, options) => {
    calls.push({ url, options });
    return responses.shift();
  });
  assert.deepEqual(await storage.readReceipt(), { action: "waiting_review" });
  await storage.saveReceipt({ action: "uploaded" });
  await storage.saveReceipt({ action: "submitted" });
  assert.match(calls[1].url, /generation=7$/);
  assert.match(calls[2].url, /ifGenerationMatch=7$/);
  assert.match(calls[3].url, /ifGenerationMatch=8$/);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, "Bearer private-token");
    assert.equal(call.options.redirect, "error");
    assert.ok(call.url.startsWith("https://storage.googleapis.com/"));
  }
});

test("authorization failures and another object's metadata cannot reset release progress", async () => {
  for (const response of [
    json({}, 403),
    json({ ...metadata("7"), name: "another-release" }),
  ]) {
    const storage = privateStorage("private-token", async () => response);
    await assert.rejects(storage.readReceipt());
  }
});

test("an absent receipt starts at generation zero, while competing writes stay rejected", async () => {
  const calls = [];
  const responses = [json({}, 404), json({}, 412)];
  const storage = privateStorage("private-token", async (url) => {
    calls.push(url);
    return responses.shift();
  });
  assert.deepEqual(await storage.readReceipt(), {});
  await assert.rejects(
    storage.saveReceipt({ action: "uploading" }),
    /HTTP 412/,
  );
  assert.match(calls[1], /ifGenerationMatch=0$/);
});

test("each pinned release uses its own private ZIP and generation-protected receipt", async () => {
  for (const version of Object.keys(PINNED_RELEASES)) {
    const calls = [];
    const storage = privateStorage(
      "private-token",
      async (url) => {
        calls.push(url);
        if (url.includes("uploadType"))
          return json({
            bucket: BUCKET,
            name: `releases/${version}/receipt.json`,
            generation: "1",
          });
        if (url.includes("alt=media")) return new Response("zip");
        return json({}, 404);
      },
      version,
    );
    await storage.readReceipt();
    await storage.saveReceipt({ version });
    await storage.artifactBytes();
    assert.ok(
      calls.every((url) =>
        decodeURIComponent(url).includes(`releases/${version}/`),
      ),
    );
    assert.match(calls[1], /ifGenerationMatch=0$/);
  }
  for (const tag of [
    "chrome-extension-v1.3.2",
    "1.2.2",
    "chrome-extension-v__proto__",
    "chrome-extension-v1.2.2/other",
  ]) {
    assert.throws(() => releaseVersion(tag), /exact pinned/);
  }
});
