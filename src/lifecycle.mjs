import { compareVersions, ITEM, NAME, validVersion } from "./config.mjs";

export function snapshot(status) {
  if (status.name !== NAME || status.itemId !== ITEM)
    throw new Error("Unexpected Chrome Web Store item.");
  const revision = (value) =>
    value
      ? {
          state: value.state,
          channels: (value.distributionChannels ?? []).map(({ crxVersion, deployPercentage }) => {
            if (!validVersion(crxVersion))
              throw new Error("Google did not identify the revision version.");
            return { version: crxVersion, deployPercentage };
          }),
        }
      : null;
  return {
    itemId: ITEM,
    published: revision(status.publishedItemRevisionStatus),
    submitted: revision(status.submittedItemRevisionStatus),
    uploadState: status.lastAsyncUploadState ?? null,
    takenDown: Boolean(status.takenDown),
    warned: Boolean(status.warned),
  };
}

export function releasePlan(status, version) {
  if (!validVersion(version)) throw new Error("Invalid release version.");
  const state = snapshot(status);
  if (state.takenDown || state.warned)
    throw new Error(
      "Google reported an item policy issue. Inspect the dashboard before changing the release.",
    );
  const published = state.published?.channels ?? [];
  const submitted = state.submitted?.channels ?? [];
  if ([...published, ...submitted].some((c) => compareVersions(c.version, version) > 0))
    throw new Error("A newer version already exists. Refusing to downgrade or replace it.");
  if (published.some((c) => compareVersions(c.version, version) === 0))
    return { action: "published", ...state };
  if (state.submitted && !submitted.length)
    throw new Error("Google returned an unidentified submitted revision. No upload is safe.");
  if (state.submitted?.state === "PENDING_REVIEW") return { action: "waiting_review", ...state };
  if (state.submitted?.state === "STAGED") {
    if (submitted.every((c) => compareVersions(c.version, version) === 0))
      return { action: "publish_staged", ...state };
    return { action: "waiting_other_staged_release", ...state };
  }
  if (
    state.submitted &&
    !["CANCELLED", "PUBLISHED", "PUBLISHED_TO_TESTERS"].includes(state.submitted.state)
  )
    throw new Error(
      `Submitted revision is ${state.submitted.state}. Resolve it before another submission.`,
    );
  if (["IN_PROGRESS", "UPLOAD_IN_PROGRESS"].includes(state.uploadState))
    return { action: "waiting_upload", ...state };
  if (!published.length)
    throw new Error(
      "The existing published extension is unavailable. No new item will be created.",
    );
  return { action: "upload", ...state };
}

export async function publishRelease(api, release, { receipt = {}, save = async () => {} } = {}) {
  const before = await api("fetchStatus");
  const plan = releasePlan(before, release.version);
  const result = {
    ...receipt,
    error: undefined,
    itemId: ITEM,
    version: release.version,
    sha256: release.sha256,
    checkedAt: new Date().toISOString(),
    ...plan,
  };
  if (
    ["published", "waiting_review", "waiting_other_staged_release", "waiting_upload"].includes(
      plan.action,
    )
  ) {
    await save(result);
    return result;
  }
  if (plan.action === "upload") {
    if (
      receipt.uploadAttempted &&
      (!receipt.uploaded ||
        receipt.sha256 !== release.sha256 ||
        receipt.version !== release.version ||
        receipt.itemId !== ITEM)
    )
      throw new Error(
        "An earlier upload has an unknown outcome. Inspect it before replacing or submitting a draft.",
      );
    const uploaded =
      receipt.uploaded &&
      receipt.itemId === ITEM &&
      receipt.version === release.version &&
      receipt.sha256 === release.sha256;
    if (!uploaded) {
      await save({ ...result, action: "uploading", uploadAttempted: true, uploaded: false });
      const upload = await api("upload", release.bytes);
      if (upload.uploadState !== "SUCCEEDED" || upload.crxVersion !== release.version)
        throw new Error(
          "Google has not confirmed the uploaded version. Check the stored receipt and upload status before retrying.",
        );
      await save({ ...result, action: "uploaded", uploadAttempted: true, uploaded: true });
    }
  }
  const latest = await api("fetchStatus");
  const freshPlan = releasePlan(latest, release.version);
  if (!["upload", "publish_staged"].includes(freshPlan.action)) {
    const observed = { ...result, ...freshPlan };
    await save(observed);
    return observed;
  }
  await api("publish");
  const after = snapshot(await api("fetchStatus"));
  const published = after.published?.channels.some(
    (c) => compareVersions(c.version, release.version) === 0,
  );
  const submitted = after.submitted?.channels.some(
    (c) => compareVersions(c.version, release.version) === 0,
  );
  if (!published && !submitted)
    throw new Error(
      "Publication request returned but Google has not confirmed the requested revision. Inspect status before retrying.",
    );
  const verified = {
    ...result,
    ...after,
    action: published ? "published" : "submitted",
    uploaded: true,
    uploadAttempted: true,
  };
  await save(verified);
  return verified;
}
