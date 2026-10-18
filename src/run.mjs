import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { storeApi } from "./api.mjs";
import { readRelease } from "./artifact.mjs";
import { ITEM, PINNED_RELEASES, VERSION, releaseVersion } from "./config.mjs";
import { finishReviewWatch } from "./finish-watch.mjs";
import { publishRelease, releasePlan, snapshot } from "./lifecycle.mjs";
import { privateStorage } from "./storage.mjs";

export async function reconcile(
  command,
  { api, storage, loadArtifact, finish = finishReviewWatch, version = VERSION },
) {
  releaseVersion(`chrome-extension-v${version}`);
  if (!["doctor", "status", "plan", "publish"].includes(command))
    throw new Error("Unsupported release command.");
  const base = {
    itemId: ITEM,
    command,
    version,
    sha256: PINNED_RELEASES[version],
    checkedAt: new Date().toISOString(),
  };
  const status = await api("fetchStatus");
  if (["doctor", "status"].includes(command))
    return { ...base, action: "status", ...snapshot(status) };
  const plan = releasePlan(status, version);
  if (command === "plan") {
    await loadArtifact();
    return { ...base, ...plan };
  }
  const previous = await storage.readReceipt();
  if (
    Object.keys(previous).length &&
    (previous.itemId !== ITEM ||
      previous.version !== version ||
      previous.sha256 !== base.sha256)
  )
    throw new Error(
      "The private receipt belongs to another item or release. Its state was preserved.",
    );
  let current = { ...previous, ...base, error: undefined };
  const save = async (value) => {
    current = { ...current, ...value, checkedAt: new Date().toISOString() };
    await storage.saveReceipt(current);
  };
  try {
    // Pending reviews do not need to download the ZIP on every check.
    const release =
      plan.action === "upload"
        ? await loadArtifact()
        : { version, sha256: base.sha256 };
    const result = await publishRelease(api, release, {
      receipt: previous,
      save,
    });
    return { ...current, ...result, reviewWatch: finish(current) };
  } catch (error) {
    await save({ error: error.message }).catch(() => {});
    throw error;
  }
}

export async function reconcileRollout(
  command,
  { api, storageFor, loadArtifact, finish },
  version = VERSION,
) {
  releaseVersion(`chrome-extension-v${version}`);
  const options = (target) => ({
    api,
    storage: storageFor(target),
    loadArtifact: () => loadArtifact(target),
    finish,
    version: target,
  });
  if (command === "publish" && version === VERSION) {
    const observed = snapshot(await api("fetchStatus"));
    // If Google's earlier approval was staged, finish that exact release first.
    // Pending/rejected reviews remain untouched by the ordinary release planner.
    if (
      observed.submitted?.state === "STAGED" &&
      observed.submitted.channels.length &&
      observed.submitted.channels.every(
        (channel) => channel.version === "1.2.1",
      )
    ) {
      await reconcile("publish", options("1.2.1"));
    }
  }
  return reconcile(command, options(version));
}

export async function main(command = process.argv[2]) {
  const token = process.env.CHROME_WEBSTORE_ACCESS_TOKEN;
  if (!token)
    throw new Error("A short-lived Google workload token is required.");
  const version = releaseVersion(process.env.STORE_RELEASE || undefined);
  const stores = new Map();
  const storageFor = (target) => {
    if (!stores.has(target))
      stores.set(target, privateStorage(token, undefined, target));
    return stores.get(target);
  };
  const temporary = [];
  try {
    return await reconcileRollout(
      command,
      {
        api: storeApi(async () => token),
        storageFor,
        loadArtifact: async (target) => {
          const directory = await mkdtemp(join(tmpdir(), "indiecrm-release-"));
          temporary.push(directory);
          const filename = `indiecrm-connect-${target}.zip`;
          await writeFile(
            join(directory, filename),
            await storageFor(target).artifactBytes(),
            { mode: 0o600 },
          );
          await writeFile(
            join(directory, filename + ".sha256"),
            `${PINNED_RELEASES[target]}  ${filename}\n`,
          );
          return readRelease(directory, target);
        },
      },
      version,
    );
  } finally {
    for (const directory of temporary)
      await rm(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let receipt;
  try {
    receipt = await main();
  } catch (error) {
    const message = String(error.message).replaceAll(
      process.env.CHROME_WEBSTORE_ACCESS_TOKEN ?? "[no-token]",
      "[redacted]",
    );
    receipt = { itemId: ITEM, command: process.argv[2], error: message };
    process.exitCode = 1;
  }
  if (process.env.STORE_RECEIPT) {
    await mkdir(dirname(process.env.STORE_RECEIPT), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      process.env.STORE_RECEIPT,
      JSON.stringify(receipt, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  console.log(`INDIECRM_CHROME_WEBSTORE_RECEIPT:${JSON.stringify(receipt)}`);
}
