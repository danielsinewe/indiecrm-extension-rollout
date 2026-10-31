export const REPOSITORY = "danielsinewe/indiecrm-extension-rollout";
export const BUCKET = "indiec-507107-chrome-releases";
export const VERSION = "1.3.17";
export const PUBLISHER = "bc8a3569-1d50-4414-a27f-ca85f54678cd";
export const ITEM = "eiabmmajcanapfaphkammeieoiagmifc";
export const NAME = `publishers/${PUBLISHER}/items/${ITEM}`;
export const API = "https://chromewebstore.googleapis.com";
export const PINNED_RELEASES = {
  "1.3.18": "21dc5a6e2b1dfc5632d0975cfa5b263461db893af11690571fb5fd91a38e07d2",
  "1.3.17": "9dd5a160378be66b92667f964b68c19b299c389f9208fdf6920df76d5291f39a",
  "1.3.16": "038658e172d9e0d01c927895469a507215bcf2ec95cd643caa2bb99942101583",
  "1.3.15": "5e7e08819f7eb2ccc9bc7c77f0aba68cd5c348ff99b156d4c7fd0d5013e005fd",
  "1.3.14": "5c8d95da1caa764a9e792e455d947bdc54bc3a4ce8fde32054eb0f574d5df412",
  "1.3.13": "ad584f6825e10e278ffc77b7b3388ad8127383321b75985744f66b2b41a8026b",
  "1.3.12": "7b2ee7f7cab262cb499a6a1c924a368b21aca8761d9fdf8fad4f9c8290fdf90c",
  "1.3.11": "cbe637537cd0ba5a7b71576a1483b8e870019207ffe5e6c71a7c64b5d881dd1a",
  "1.3.10": "1ea540254bed80da60ecf1059f9f51103f0eb7d047049668079eb00fbe8468ef",
  "1.3.9": "1e14834db15b408b807d4825989555b9d0248d8e2f481dbac8269f11837ec29f",
  "1.2.1": "f7853b87371dd751f3fff0e7a2892a1b0eeaa26bb06df9ad2a1b32cdeadd27a8",
  "1.2.2": "1dd619b2af08e236d1bddb0462bc778073a99ec8d0944e14b9452f418c44613b",
  "1.2.3": "7db36e7813e4d825abd6972ea300f765e7a52a5caaf0e5ef414b1000daee7cb9",
  "1.2.4": "5c4898d9516a7d5ae5ce8e141afd7903489eaea80395109d1e09b39dcc1952b1",
  "1.3.1": "b4524e33e6c235a989afdf36ef94dd1222e75d4c130b4cc0186672f7828ad807",
  "1.3.2": "1196cd86d3d30e1ea39f40a07fd010a0d209235eae99985ec2487ce83a904fb8",
  "1.3.3": "d4184019682d5c1ee6d80910ad4d64faf2f2778808b0ff6429536d46b239f354",
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
