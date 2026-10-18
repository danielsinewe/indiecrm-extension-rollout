import { API, NAME } from "./config.mjs";

export function storeApi(getToken, fetcher = fetch) {
  return async (action, bytes) => {
    if (!["fetchStatus", "upload", "publish"].includes(action))
      throw new Error(
        "Unsupported store operation. Cancellation, audience changes and rollback are not supported.",
      );
    const token = await getToken();
    if (!token) throw new Error("Google returned no access token.");
    let response;
    try {
      response = await fetcher(
        `${API}${action === "upload" ? "/upload" : ""}/v2/${NAME}:${action}`,
        {
          method: action === "fetchStatus" ? "GET" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(action === "fetchStatus"
              ? {}
              : { "Content-Type": action === "upload" ? "application/zip" : "application/json" }),
          },
          ...(action === "fetchStatus"
            ? {}
            : {
                body:
                  action === "upload"
                    ? bytes
                    : JSON.stringify({
                        publishType: "DEFAULT_PUBLISH",
                        skipReview: false,
                        blockOnWarnings: true,
                      }),
              }),
          redirect: "error",
          signal: AbortSignal.timeout(action === "upload" ? 120000 : 30000),
        },
      );
    } catch {
      throw new Error(
        `Chrome Web Store ${action} connection failed. The outcome may be unknown; check status before retrying a write.`,
      );
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = String(body.error?.message ?? `HTTP ${response.status}`)
        .replaceAll(token, "[redacted]")
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .slice(0, 1500);
      throw Object.assign(new Error(`Chrome Web Store ${action}: ${reason}`), {
        status: response.status,
      });
    }
    if (body.name !== NAME || body.itemId !== NAME.split("/").at(-1))
      throw new Error(
        "Google returned a different or unidentified store item. Nothing further was submitted.",
      );
    return body;
  };
}
