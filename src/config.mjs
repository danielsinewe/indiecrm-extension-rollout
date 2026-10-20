export const REPOSITORY = "danielsinewe/indiecrm-extension-rollout";
export const BUCKET = "indiec-507107-chrome-releases";
export const VERSION = "1.3.1";
export const PUBLISHER = "bc8a3569-1d50-4414-a27f-ca85f54678cd";
export const ITEM = "eiabmmajcanapfaphkammeieoiagmifc";
export const NAME = `publishers/${PUBLISHER}/items/${ITEM}`;
export const API = "https://chromewebstore.googleapis.com";
export const PINNED_RELEASES = {
  "1.2.1": "f7853b87371dd751f3fff0e7a2892a1b0eeaa26bb06df9ad2a1b32cdeadd27a8",
  "1.2.2": "1dd619b2af08e236d1bddb0462bc778073a99ec8d0944e14b9452f418c44613b",
  "1.2.3": "7db36e7813e4d825abd6972ea300f765e7a52a5caaf0e5ef414b1000daee7cb9",
  "1.2.4": "5c4898d9516a7d5ae5ce8e141afd7903489eaea80395109d1e09b39dcc1952b1",
  "1.3.1": "b4524e33e6c235a989afdf36ef94dd1222e75d4c130b4cc0186672f7828ad807",
};

export function releaseVersion(tag = `chrome-extension-v${VERSION}`) {
  const version = tag.replace(/^chrome-extension-v/, "");
  if (
    tag !== `chrome-extension-v${version}` ||
    !Object.hasOwn(PINNED_RELEASES, version)
  )
    throw new Error(
      "Choose an exact pinned IndieCRM release.",
    );
  return version;
}

export function validVersion(value) {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(value) &&
    value.split(".").every((n) => Number(n) <= 65535) &&
    value.split(".").some((n) => Number(n) > 0)
  );
}

export function compareVersions(a, b) {
  if (!validVersion(a) || !validVersion(b))
    throw new Error("Invalid Chrome extension version.");
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
