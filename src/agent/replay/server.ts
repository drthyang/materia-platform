/**
 * The dev server's scripted replay (vite.config.ts, `npm run dev` only): with
 * the replay cookie set (replay/arm.ts, from `?agentReplay=<id>`), the
 * Agent's proxy route answers with that replay's turns instead of forwarding
 * to the API. The turn is the number of assistant messages the request
 * already holds, so the real chat loop, executor and tools run on the page
 * and only the model is scripted. No key and no network. Without the cookie
 * the request passes on to the proxy.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { DEMO_REPLAYS } from "./demoReplays";
import { sse } from "./sse";

export const REPLAY_COOKIE = "materia-agent-replay";

/** The replay a request's cookie selects, or null. */
export function replayFrom(cookie: string | undefined): string | null {
  for (const part of (cookie ?? "").split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === REPLAY_COOKIE && v && Object.hasOwn(DEMO_REPLAYS, decodeURIComponent(v))) return decodeURIComponent(v);
  }
  return null;
}

/** How many model turns a Messages request has already had. */
export function turnOf(body: string): number {
  try {
    const parsed = JSON.parse(body) as { messages?: { role?: string }[] };
    return (parsed.messages ?? []).filter((m) => m.role === "assistant").length;
  } catch {
    return 0;
  }
}

export function scriptedReplay(mount = "/api/anthropic/v1/messages") {
  return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void => {
    const id = req.method === "POST" && (req.url ?? "").includes(mount) ? replayFrom(req.headers.cookie) : null;
    if (!id) return next();
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const n = turnOf(Buffer.concat(chunks).toString("utf8"));
      const turn = DEMO_REPLAYS[id]?.turns[n] ?? { text: "(end of the scripted replay)" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse(turn, n + 1));
    });
  };
}
