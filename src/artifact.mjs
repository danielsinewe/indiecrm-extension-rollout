import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PINNED_RELEASES, validVersion } from "./config.mjs";

export async function readRelease(directory, version) {
  if (!validVersion(version)) throw new Error("Use a valid Chrome extension release version.");
  const filename = `indiecrm-connect-${version}.zip`;
  const checksum = (await readFile(join(directory, filename + ".sha256"), "utf8")).trim();
  const match = checksum.match(/^([a-f0-9]{64})\s+([^\s/]+)$/);
  if (!match || match[2] !== filename)
    throw new Error("The release needs one matching SHA-256 checksum.");
  const bytes = await readFile(join(directory, filename));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== match[1] || (PINNED_RELEASES[version] && sha256 !== PINNED_RELEASES[version]))
    throw new Error(
      "Release ZIP checksum differs from the published artifact. Nothing was uploaded.",
    );
  if (bytes.length > 100 * 1024 * 1024) throw new Error("Unexpectedly large extension package.");
  const path = join(directory, filename);
  const files = execFileSync("unzip", ["-Z1", path], { encoding: "utf8", maxBuffer: 100000 })
    .trim()
    .split("\n");
  if (
    files.some(
      (name) =>
        !/^(manifest\.json|background\.js|popup\.(js|html|css)|content\.(js|css)|icons\/|icons\/icon-(16|32|48|128)\.png)$/.test(
          name,
        ),
    )
  )
    throw new Error(
      "The package contains unexpected files; only extension runtime files may be published.",
    );
  const manifest = JSON.parse(
    execFileSync("unzip", ["-p", path, "manifest.json"], { encoding: "utf8", maxBuffer: 20000 }),
  );
  if (
    manifest.version !== version ||
    manifest.name !== "IndieCRM Connect" ||
    manifest.manifest_version !== 3
  )
    throw new Error("The ZIP manifest does not match the requested IndieCRM Connect release.");
  return { version, sha256, bytes };
}
