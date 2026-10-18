export const REPOSITORY = "danielsinewe/indiecrm-extension-rollout";
export const BUCKET = "indiec-507107-chrome-releases";
export const VERSION = "1.2.1";
export const PUBLISHER = "bc8a3569-1d50-4414-a27f-ca85f54678cd";
export const ITEM = "eiabmmajcanapfaphkammeieoiagmifc";
export const NAME = `publishers/${PUBLISHER}/items/${ITEM}`;
export const API = "https://chromewebstore.googleapis.com";
export const PINNED_RELEASES = {
  "1.2.1": "f7853b87371dd751f3fff0e7a2892a1b0eeaa26bb06df9ad2a1b32cdeadd27a8",
};

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
