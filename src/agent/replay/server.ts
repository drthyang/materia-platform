/**
 * The dev server's scripted replay (vite.config.ts, `npm run dev` only): with
 * the replay cookie set (replay/arm.ts, from `?agentReplay=<id>`), the
 * Agent's proxy route answers with that replay's turns instead of forwarding
 * to the API. The turn is the number of assistant messages the request
 * already holds, so the real chat loop, executor and tools run on the page
 * and only the model is scripted. No key and no network. Without the cookie
 * the request passes on to the proxy.
 *
 * A replay named `local-…` is read from the git-ignored data folder
 * (`data/replays/<id>.json`, or MATERIA_DATA_DIR's): a run on unpublished data
 * the repository must not hold, played the same way.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEMO_REPLAYS, type DemoReplay } from "./demoReplays";
import { LOCAL_REPLAY, REPLAY_COOKIE } from "./cookie";
import { sse } from "./sse";

export { LOCAL_REPLAY, REPLAY_COOKIE };

/** A `local-…` replay from the git-ignored data folder, or null when there is none. */
export function localReplay(id: string): DemoReplay | null {
  if (!LOCAL_REPLAY.test(id)) return null;
  const dir = process.env.MATERIA_DATA_DIR ? resolve(process.env.MATERIA_DATA_DIR) : resolve(process.cwd(), "data");
  const file = join(dir, "replays", `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as DemoReplay;
  } catch {
    return null;
  }
}

/** The replay a request's cookie selects, or null. */
export function replayFrom(cookie: string | undefined): string | null {
  for (const part of (cookie ?? "").split(";")) {
    const [k, v] = part.trim().split("=");
    const id = v ? decodeURIComponent(v) : "";
    if (k === REPLAY_COOKIE && id && (Object.hasOwn(DEMO_REPLAYS, id) || localReplay(id))) return id;
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
      const replay = Object.hasOwn(DEMO_REPLAYS, id) ? DEMO_REPLAYS[id] : localReplay(id);
      const turn = replay?.turns[n] ?? { text: "(end of the scripted replay)" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse(turn, n + 1));
    });
  };
}
