import { BUCKET, VERSION } from "./config.mjs";

export const RECEIPT_OBJECT = `releases/${VERSION}/receipt.json`;
export const ARTIFACT_OBJECT = `releases/${VERSION}/indiecrm-connect-${VERSION}.zip`;

export function privateStorage(token, fetcher = fetch) {
  let generation = "0";
  const request = async (url, options = {}) => {
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(
        "Private release storage connection failed. No unchecked retry is safe.",
      );
    }
    return response;
  };
  const url = (object) =>
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(object)}`;
  return {
    async readReceipt() {
      const metadata = await request(url(RECEIPT_OBJECT));
      if (metadata.status === 404) return {};
      if (!metadata.ok)
        throw new Error(
          `Private receipt metadata returned HTTP ${metadata.status}.`,
        );
      const body = await metadata.json();
      if (
        body.bucket !== BUCKET ||
        body.name !== RECEIPT_OBJECT ||
        !/^\d+$/.test(body.generation)
      )
        throw new Error("Private receipt identity was not verified.");
      generation = body.generation;
      const response = await request(
        `${url(RECEIPT_OBJECT)}?alt=media&generation=${generation}`,
      );
      if (!response.ok)
        throw new Error(
          `Private receipt read returned HTTP ${response.status}.`,
        );
      return response.json();
    },
    async saveReceipt(receipt) {
      const response = await request(
        `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(RECEIPT_OBJECT)}&ifGenerationMatch=${generation}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(receipt),
        },
      );
      if (!response.ok)
        throw new Error(
          `Private receipt save returned HTTP ${response.status}; progress was not assumed.`,
        );
      const body = await response.json();
      if (
        body.bucket !== BUCKET ||
        body.name !== RECEIPT_OBJECT ||
        !/^\d+$/.test(body.generation)
      )
        throw new Error("The saved receipt identity was not verified.");
      generation = body.generation;
    },
    async artifactBytes() {
      const response = await request(`${url(ARTIFACT_OBJECT)}?alt=media`);
      if (!response.ok)
        throw new Error(
          `Private release ZIP returned HTTP ${response.status}.`,
        );
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
