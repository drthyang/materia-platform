/**
 * Dev only (main.tsx loads it under `import.meta.env.DEV`, so a production
 * build drops it): `?agentReplay=<id>` points the Agent at the dev server's
 * scripted replay (replay/server.ts). It sets the replay cookie the server
 * reads, and the Agent's settings to the proxy route, labelled as a scripted
 * replay, keeping the user's own settings aside. A later load without the
 * flag puts them back and clears the cookie.
 */

import { SETTINGS_KEY } from "../storage";
import { DEMO_REPLAYS } from "./demoReplays";
import { LOCAL_REPLAY, REPLAY_COOKIE } from "./cookie";

const KEPT_KEY = `${SETTINGS_KEY}.beforeReplay`;

/** The label the drawer's chip shows for a scripted replay. */
export const scriptedLabel = (id: string): string => `Scripted model (eval ${id})`;

export interface ReplayEnv {
  readonly search: string;
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly setCookie: (cookie: string) => void;
}

/** Arm (or disarm) the replay; returns the replay in effect, or null. */
export function armReplay(env: ReplayEnv): string | null {
  const id = new URLSearchParams(env.search).get("agentReplay");
  // A `local-…` replay lives in the git-ignored data folder; the dev server checks it exists.
  if (id && (Object.hasOwn(DEMO_REPLAYS, id) || LOCAL_REPLAY.test(id))) {
    if (env.storage.getItem(KEPT_KEY) === null) env.storage.setItem(KEPT_KEY, env.storage.getItem(SETTINGS_KEY) ?? "");
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(env.storage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, unknown>;
    } catch {
      stored = {};
    }
    env.storage.setItem(SETTINGS_KEY, JSON.stringify({ ...stored, mode: "proxy", replayOf: scriptedLabel(id) }));
    env.setCookie(`${REPLAY_COOKIE}=${encodeURIComponent(id)}; path=/; SameSite=Strict`);
    return id;
  }
  const kept = env.storage.getItem(KEPT_KEY);
  if (kept !== null) {
    if (kept) env.storage.setItem(SETTINGS_KEY, kept);
    else env.storage.removeItem(SETTINGS_KEY);
    env.storage.removeItem(KEPT_KEY);
    env.setCookie(`${REPLAY_COOKIE}=; path=/; max-age=0; SameSite=Strict`);
  }
  return null;
}
