import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BUCKET, ITEM, PINNED_RELEASES, releaseVersion } from "./config.mjs";
import { readRelease } from "./artifact.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The URL is a short-lived, single-asset GitHub capability supplied as a secret.
// No application source, repository credential or download URL is logged.
export async function stageRelease({
  token,
  downloadUrl,
  version,
  fetcher = fetch,
}) {
  releaseVersion(`chrome-extension-v${version}`);
  if (!["1.3.15", "1.3.14", "1.3.13", "1.2.3", "1.3.1", "1.3.2", "1.3.3", "1.3.9", "1.3.10", "1.3.11", "1.3.12"].includes(version))
    throw new Error("This staging handoff requires an authorized pinned artifact.");
  let url;
  try {
    url = new URL(downloadUrl);
  } catch {
    throw new Error("A private release download is required.");
  }
  if (
    url.origin !== "https://release-assets.githubusercontent.com" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Use GitHub's exact signed release-asset download.");
  if (!token)
    throw new Error("A short-lived Google workload token is required.");
  const request = async (target, options = {}) => {
    try {
      return await fetcher(target, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(
        "Private staging transport failed; verify the object before retrying.",
      );
    }
  };
  const source = await request(url.href);
  if (!source.ok)
    throw new Error(`Private release download returned HTTP ${source.status}.`);
  const bytes = Buffer.from(await source.arrayBuffer());
  if (hash(bytes) !== PINNED_RELEASES[version])
    throw new Error("The private release checksum did not match.");
  const directory = await mkdtemp(join(tmpdir(), "indiecrm-stage-"));
  const filename = `indiecrm-connect-${version}.zip`;
  try {
    await writeFile(join(directory, filename), bytes, { mode: 0o600 });
    await writeFile(
      join(directory, filename + ".sha256"),
      `${PINNED_RELEASES[version]}  ${filename}\n`,
    );
    await readRelease(directory, version);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const object = `releases/${version}/${filename}`;
  const headers = { Authorization: `Bearer ${token}` };
  const saved = await request(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(object)}&ifGenerationMatch=0`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/zip" },
      body: bytes,
    },
  );
  if (!saved.ok && saved.status !== 412)
    throw new Error(
      `Private artifact staging returned HTTP ${saved.status}; no progress was assumed.`,
    );
  const stored = await request(
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(object)}?alt=media`,
    { headers },
  );
  if (
    !stored.ok ||
    hash(Buffer.from(await stored.arrayBuffer())) !== PINNED_RELEASES[version]
  )
    throw new Error(
      "The private artifact readback did not match the pinned release.",
    );
  return {
    itemId: ITEM,
    command: "stage",
    action: "staged",
    version,
    sha256: PINNED_RELEASES[version],
    bytes: bytes.length,
    existing: saved.status === 412,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let receipt;
  try {
    receipt = await stageRelease({
      token: process.env.CHROME_WEBSTORE_ACCESS_TOKEN,
      downloadUrl: process.env.INDIECRM_RELEASE_DOWNLOAD_URL,
      version: releaseVersion(process.env.STORE_RELEASE),
    });
  } catch (error) {
    receipt = { itemId: ITEM, command: "stage", error: error.message };
    process.exitCode = 1;
  }
  if (process.env.STORE_RECEIPT)
    await writeFile(process.env.STORE_RECEIPT, JSON.stringify(receipt) + "\n", {
      mode: 0o600,
    });
  console.log(`INDIECRM_CHROME_WEBSTORE_RECEIPT:${JSON.stringify(receipt)}`);
}
