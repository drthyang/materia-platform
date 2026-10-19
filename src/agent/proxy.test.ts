import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { anthropicProxy, sameOrigin, trustedHost } from "@/agent/proxy";

/** The proxy behind a real HTTP server; the upstream API is a stubbed fetch. */
async function serve(apiKey: string | undefined): Promise<{ url: string; server: Server }> {
  const handler = anthropicProxy(apiKey);
  const server = createServer((req, res) => handler(req, res, () => {
    res.statusCode = 404;
    res.end("next");
  }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, server };
}

describe("Agent API proxy", () => {
  const realFetch = globalThis.fetch;
  let server: Server | null = null;
  afterEach(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = realFetch;
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });

  it("accepts only the app's own pages", () => {
    const req = (headers: Record<string, string>): IncomingMessage => ({ headers } as unknown as IncomingMessage);
    expect(sameOrigin(req({ host: "localhost:5173", origin: "http://localhost:5173" }))).toBe(true);
    expect(sameOrigin(req({ host: "localhost:5173", origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(req({ host: "localhost:5173" }))).toBe(true); // curl: no browser metadata
    expect(sameOrigin(req({ host: "localhost:5173", "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("answers only on this machine's names or the allowed hosts: a DNS-rebound name is refused", async () => {
    // The page of evil.example, re-pointed at 127.0.0.1, is its own origin: Origin and Host agree.
    const rebound = { host: "evil.example:5173", origin: "http://evil.example:5173" };
    expect(sameOrigin({ headers: rebound } as unknown as IncomingMessage)).toBe(true);
    expect(trustedHost(rebound.host)).toBe(false);
    for (const host of ["localhost:5173", "127.0.0.1:4173", "[::1]:5173", "app.localhost:5173"]) expect(trustedHost(host), host).toBe(true);
    expect(trustedHost("lab.example.org:5173", ["lab.example.org"])).toBe(true);
    expect(trustedHost("a.lab.example.org", [".lab.example.org"])).toBe(true);
    expect(trustedHost("evil.example", true)).toBe(true);
    expect(trustedHost(undefined)).toBe(false);
    expect(trustedHost("127.0.0.1.evil.example")).toBe(false);

    const s = await serve("sk-test");
    server = s.server;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const r = request(`${s.url}/materia-platform/api/anthropic/v1/messages`, { method: "POST", headers: { Host: rebound.host, Origin: rebound.origin, "content-type": "application/json" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      r.on("error", reject);
      r.end("{}");
    });
    expect(status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says how to configure it when there is no key", async () => {
    const s = await serve(undefined);
    server = s.server;
    const r = await realFetch(`${s.url}/materia-platform/api/anthropic/v1/messages`, { method: "POST", body: "{}" });
    expect(r.status).toBe(503);
    const body = (await r.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe("proxy_not_configured");
    expect(body.error.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("answers a health check, saying whether it holds a key (the page asks before it relies on it)", async () => {
    for (const key of ["sk-test", undefined]) {
      const s = await serve(key);
      server = s.server;
      const r = await realFetch(`${s.url}/web-refinement/api/anthropic/health`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ proxy: true, key: key !== undefined });
      await new Promise<void>((done) => s.server.close(() => done()));
      server = null;
    }
  });

  it("leaves other paths to the next handler", async () => {
    const s = await serve("k");
    server = s.server;
    expect(await (await realFetch(`${s.url}/materia-platform/data/x.txt`)).text()).toBe("next");
  });

  it("forwards with the server's key, never the page's, and streams the answer back", async () => {
    const s = await serve("sk-ant-server-key");
    server = s.server;
    let seen: { url: string; headers: Headers; body: string } | null = null;
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.anthropic.com")) return realFetch(input, init);
      seen = { url, headers: new Headers(init?.headers), body: new TextDecoder().decode(init?.body as Uint8Array) };
      return new Response("event: message_stop\ndata: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_1" } });
    }) as typeof fetch;
    const r = await realFetch(`${s.url}/materia-platform/api/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "page-placeholder", "anthropic-version": "2023-06-01", cookie: "secret=1", origin: s.url },
      body: JSON.stringify({ model: "m" }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/event-stream");
    expect(await r.text()).toMatch(/message_stop/);
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen!.headers.get("x-api-key")).toBe("sk-ant-server-key");
    expect(seen!.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(seen!.headers.get("cookie")).toBeNull();
    expect(seen!.body).toBe("{\"model\":\"m\"}");
  });

  it("refuses another site's page", async () => {
    const s = await serve("k");
    server = s.server;
    const r = await realFetch(`${s.url}/materia-platform/api/anthropic/v1/messages`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
    expect(r.status).toBe(403);
  });
});
