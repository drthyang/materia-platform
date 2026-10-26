/**
 * Whether the page has the Agent's local proxy (proxy.ts): the dev and
 * preview servers serve one under `<base>api/anthropic/`, the static build
 * (the published site) none. Kept apart from chat.ts so the settings can ask
 * without loading the API client.
 */

export const PROXY_PATH = "api/anthropic";

/** What a page reached through `base` has: a proxy with a key, one without, or none (the static build). */
export type ProxyStatus = "ready" | "no-key" | "absent";

/** Ask the proxy's health check; a static host answers 404, or its index page, never the proxy's JSON. */
export async function proxyStatus(base: string, fetchImpl: typeof fetch = fetch): Promise<ProxyStatus> {
  try {
    const r = await fetchImpl(`${base}${PROXY_PATH}/health`);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("application/json")) return "absent";
    const body = (await r.json()) as { proxy?: unknown; key?: unknown };
    return body.proxy !== true ? "absent" : body.key === true ? "ready" : "no-key";
  } catch {
    return "absent";
  }
}

/** Why the proxy mode fails on a page that has no proxy (the published site). */
export const NO_PROXY = "This page has no proxy: the local proxy runs only when you serve the app yourself (npm run dev or npm run preview, with ANTHROPIC_API_KEY set where it runs). On the published site, use an API key instead (Copilot settings).";
