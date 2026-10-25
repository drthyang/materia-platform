import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DEMO_REPLAYS } from "@/agent/replay/demoReplays";
import { REPLAY_COOKIE, replayFrom, scriptedReplay, turnOf } from "@/agent/replay/server";
import { armReplay, scriptedLabel } from "@/agent/replay/arm";
import { modelLabel, replayLabel, settingsFrom } from "@/agent/useAgent";
import { scenario } from "@/agent/evals/scenarios";
import { calls, runScenario } from "@/agent/evals/harness";
import { scriptedModel } from "@/agent/evals/scripted";
import { mn3ga30kPage, scPage } from "@/agent/evals/pages";
import { pdfPort, sessionPort } from "@/testSupport/agentHeadless";
import { loadedSession } from "@/app/powderSession";
import { mn3gaPowgenExample } from "@/examples/mn3gaPowgen";
import { SETTINGS_KEY } from "@/agent/storage";

/** The page each replay plays on in the app, as the eval harness drives it. */
const APP_PAGE = {
  rietveld: () => {
    const ex = mn3gaPowgenExample();
    return sessionPort(loadedSession(ex.structure, ex.pattern, ex.instrument, ex.extraPhases, ex.refinedParams), ex.instrument).port;
  },
  pdf: () => pdfPort().port,
  "single-crystal": () => scPage(),
  "mn3ga-30k": () => mn3ga30kPage(),
};

describe("the dock's scripted replays", () => {
  it("play the scenarios' own messages", () => {
    for (const [id, r] of Object.entries(DEMO_REPLAYS)) expect(scenario(id).messages[0], id).toBe(r.message);
  });

  for (const [id, r] of Object.entries(DEMO_REPLAYS)) {
    it(`${id}: passes its scenario's checks on the page it plays on in the app`, async () => {
      const stand = await scriptedModel(r.turns);
      try {
        const result = await runScenario({ ...scenario(id), page: APP_PAGE[r.page] }, stand.model);
        expect(stand.overrun()).toBe(0);
        expect(result.grades.filter((g) => !g.pass).map((g) => `${g.check}: ${g.detail}`)).toEqual([]);
        const refusals = r.refusals ?? [];
        const failed = calls(result.run).filter((c) => c.isError && !refusals.includes(c.name)).map((c) => `${c.name}: ${c.text}`);
        expect(failed).toEqual([]);
        // A refusal the replay is meant to show happens, as a refusal.
        for (const name of refusals) expect(calls(result.run).some((c) => c.name === name && c.isError), `${name} refused`).toBe(true);
      } finally {
        await stand.close();
      }
    }, 120_000);
  }

  it("read the replay from its cookie, and nothing else", () => {
    expect(replayFrom(`a=1; ${REPLAY_COOKIE}=sc-data-first`)).toBe("sc-data-first");
    expect(replayFrom(`${REPLAY_COOKIE}=no-such-replay`)).toBeNull();
    expect(replayFrom(`${REPLAY_COOKIE}=toString`)).toBeNull();
    // A local replay counts only when its file is there; nothing outside the folder is reachable.
    expect(replayFrom(`${REPLAY_COOKIE}=local-no-such-run`)).toBeNull();
    expect(replayFrom(`${REPLAY_COOKIE}=local-..%2Fsecrets`)).toBeNull();
    expect(replayFrom(undefined)).toBeNull();
  });

  it("count the model turns a request already had", () => {
    expect(turnOf(JSON.stringify({ messages: [{ role: "user" }] }))).toBe(0);
    expect(turnOf(JSON.stringify({ messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }, { role: "assistant" }, { role: "user" }] }))).toBe(2);
    expect(turnOf("not json")).toBe(0);
  });

  function request(url: string, cookie: string | undefined, body: string): { req: IncomingMessage; res: ServerResponse; done: Promise<string | "next"> } {
    const req = Object.assign(new EventEmitter(), { url, method: "POST", headers: cookie ? { cookie } : {} }) as unknown as IncomingMessage;
    let resolve!: (v: string | "next") => void;
    const done = new Promise<string | "next">((r) => (resolve = r));
    const res = { writeHead: () => res, end: (s: string) => resolve(s) } as unknown as ServerResponse;
    scriptedReplay()(req, res, () => resolve("next"));
    queueMicrotask(() => {
      req.emit("data", Buffer.from(body));
      req.emit("end");
    });
    return { req, res, done };
  }

  it("answer the proxy route with the turn the conversation is at", async () => {
    const body = JSON.stringify({ messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }] });
    const out = await request("/materia-platform/api/anthropic/v1/messages?beta=true", `${REPLAY_COOKIE}=sc-data-first`, body).done;
    expect(out).toContain("Scale and extinction first.");
    expect(out).toContain('"stop_reason":"tool_use"');
  });

  it("pass the request on to the proxy without the cookie", async () => {
    expect(await request("/materia-platform/api/anthropic/v1/messages", undefined, "{}").done).toBe("next");
  });
});

describe("arming a replay from the page's address", () => {
  function env(search: string, store: Map<string, string>, cookies: string[]) {
    return {
      search,
      storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      setCookie: (c: string) => void cookies.push(c),
    };
  }

  it("points the Agent at the replay, then gives the user's settings back", () => {
    const own = JSON.stringify({ mode: "ollama", ollamaModel: "qwen3:32b" });
    const store = new Map([[SETTINGS_KEY, own]]);
    const cookies: string[] = [];
    expect(armReplay(env("?agentReplay=full-refinement", store, cookies))).toBe("full-refinement");
    expect(JSON.parse(store.get(SETTINGS_KEY)!)).toEqual({ mode: "proxy", ollamaModel: "qwen3:32b", replayOf: scriptedLabel("full-refinement") });
    expect(cookies.at(-1)).toMatch(new RegExp(`^${REPLAY_COOKIE}=full-refinement;`));
    // A second replay keeps the user's settings, not the first replay's.
    armReplay(env("?agentReplay=sc-data-first", store, cookies));
    expect(armReplay(env("", store, cookies))).toBeNull();
    expect(store.get(SETTINGS_KEY)).toBe(own);
    expect(cookies.at(-1)).toMatch(/max-age=0/);
  });

  it("does nothing for an unknown replay or a plain load", () => {
    const store = new Map<string, string>();
    const cookies: string[] = [];
    expect(armReplay(env("?agentReplay=nope", store, cookies))).toBeNull();
    expect(armReplay(env("", store, cookies))).toBeNull();
    expect(store.size).toBe(0);
    expect(cookies).toEqual([]);
  });
});

describe("a scripted replay's name", () => {
  it("is said to be scripted, never a replay of a live run, in the tooltip and the report", () => {
    const label = scriptedLabel("full-refinement");
    expect(replayLabel(label)).toBe("Scripted model (eval full-refinement) · a scripted replay, not a live run");
    expect(modelLabel(settingsFrom(JSON.stringify({ mode: "proxy", replayOf: label })))).not.toContain("live run ");
    expect(modelLabel(settingsFrom(JSON.stringify({ mode: "proxy", replayOf: label })))).toContain("scripted replay");
    // A recording of a live run keeps its wording.
    expect(replayLabel("Claude Opus 5.5")).toBe("Claude Opus 5.5 · replay of a live run");
  });
});

describe("a production build", () => {
  it("serves the replay only from the dev server", async () => {
    const { agentReplay } = await import("../../../vite.config");
    const plugin = agentReplay();
    expect(plugin.apply).toBe("serve");
    expect(plugin.configurePreviewServer).toBeUndefined();
  });

  it("carries none of the replay", async () => {
    const { build } = await import("vite");
    const out = mkdtempSync(join(tmpdir(), "materia-build-"));
    // As `npm run build` runs it: vitest's NODE_ENV=test would build a dev bundle.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({ logLevel: "silent", build: { outDir: out, emptyOutDir: true, reportCompressedSize: false } });
      const js = readdirSync(join(out, "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(out, "assets", f), "utf8")).join("\n");
      expect(js).toContain(SETTINGS_KEY);
      for (const s of ["agentReplay", REPLAY_COOKIE, "Scripted model (eval", "end of the scripted replay"]) expect(js, s).not.toContain(s);
    } finally {
      process.env.NODE_ENV = nodeEnv;
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
