import { describe, it, expect } from "vitest";
import { runScenario, savedRun, type SavedRun } from "@/agent/evals/harness";
import { LiveRuns, isolatedTranscript, progressLines, readProgress, runIsolated, type StoppedRun } from "@/agent/evals/isolated";
import { scenario } from "@/agent/evals/scenarios";
import { scriptedModel, type ScriptTurn } from "@/agent/evals/scripted";
import { REPLAYS, RIETVELD } from "@/agent/evals/replays";

/**
 * The live eval's time limits (THY-71): a run whose page work holds its
 * thread is stopped at its limit, and recorded as a timeout with its
 * conversation so far; the overall cap stops the run going and leaves the
 * rest not run. The stuck page is stuckScenarios.ts (a CPU-bound loop in
 * Refine); the model is the scripted one, so no key and no network.
 */

/** The method and the state, then Refine: the page's Refine never returns. */
const STUCK: readonly ScriptTurn[] = [
  { text: "First the state.", calls: [RIETVELD, { name: "get_state" }] },
  { text: "Now the scale and background.", calls: [{ name: "refine" }] },
  { text: "Done." },
];

/** A run's record without its wall-clock parts (the time it took, when each record was written). */
function steady(r: SavedRun): unknown {
  const { seconds: _s, ...rest } = r;
  return JSON.parse(JSON.stringify(rest, (k, v: unknown) => (k === "at" && typeof v === "number" ? "<time>" : v)));
}

describe("the live eval's time limits", () => {
  it("stops a run held by CPU-bound page work at its own limit, and keeps it as a timeout with its conversation so far", async () => {
    const stand = await scriptedModel(STUCK);
    try {
      const t0 = Date.now();
      const run = await runIsolated({ scenario: "stuck-refine", set: "stuck", model: stand.model, runMs: 5_000 });
      const stopped = run.record as StoppedRun;
      const why = isolatedTranscript(run);
      expect(run.outcome, why).toBe("timeout");
      expect(stopped).toMatchObject({ passed: false, outcome: "timeout", limit: "run", technique: "powder", during: "refine({})" });
      expect(stopped.grades).toEqual([{ check: "timeout", pass: false, detail: "stopped at the run's limit of 5 s, during refine({})" }]);
      // Stopped at the limit, not when the page's loop gave up (ten minutes).
      expect(stopped.seconds).toBeGreaterThanOrEqual(5);
      expect(stopped.seconds).toBeLessThan(15);
      expect(Date.now() - t0).toBeLessThan(120_000);
      // The conversation up to the stuck call: the message, the first reply, the method's and get_state's answers, the second reply.
      expect(stopped.events.map((e) => e.kind)).toEqual(["user", "reply", "call", "call", "reply"]);
      expect(stopped.events[3]).toMatchObject({ kind: "call", name: "get_state", isError: false });
      expect(why).toContain("→ get_state({})");
      expect(why).toContain("AGENT: Now the scale and background.");
      // The model was asked twice; the third turn never came.
      expect(stand.requests()).toHaveLength(2);
    } finally {
      await stand.close();
    }
  }, 180_000);

  it("stops the run going at the overall cap, leaves the rest not run, and reports both", async () => {
    const stand = await scriptedModel(STUCK);
    try {
      const live = new LiveRuns(stand.model, { runMs: 60 * 60_000, capMs: 1_500 }, "stuck");
      const first = await live.next("stuck-refine", "stuck-refine");
      const second = await live.next("stuck-refine #2", "stuck-refine");
      expect(first?.run.outcome).toBe("timeout");
      expect(first?.run.record).toMatchObject({ outcome: "timeout", limit: "cap", grades: [{ check: "timeout", pass: false, detail: expect.stringMatching(/^stopped at the overall cap/) }] });
      expect(second).toBeNull();
      expect(live.notRun).toEqual(["stuck-refine #2"]);
      expect(live.capReached).toBe(true);
      expect(live.rows(["stuck-refine"])).toEqual([expect.objectContaining({ id: "stuck-refine", passed: 0, runs: 1, timeout: 1, error: 0, notRun: 1 })]);
      expect(live.saved()).toEqual([expect.objectContaining({ scenario: "stuck-refine", outcome: "timeout", passed: false, flags: expect.any(Object), transcript: expect.any(String) })]);
    } finally {
      await stand.close();
    }
  }, 180_000);

  it("brings a finished run back from its process as the test process would have run it", async () => {
    const id = "misfits-not-extra-peaks";
    const turns = REPLAYS[id]!.good;
    const here = await scriptedModel(turns);
    const away = await scriptedModel(turns);
    try {
      const inProcess = savedRun(await runScenario(scenario(id), here.model));
      const live = new LiveRuns(away.model, { runMs: 10 * 60_000, capMs: 10 * 60_000 });
      const done = await live.next(id, id);
      expect(done?.run.outcome, done ? isolatedTranscript(done.run) : "").toBe("finished");
      const record = done!.run.record as SavedRun;
      expect(record.passed).toBe(true);
      expect(steady(record)).toEqual(steady(JSON.parse(JSON.stringify(inProcess)) as SavedRun));
      expect(live.capReached).toBe(false);
      expect(live.rows([id])).toEqual([expect.objectContaining({ passed: 1, runs: 1, timeout: 0, notRun: 0 })]);
    } finally {
      await here.close();
      await away.close();
    }
  }, 180_000);

  it("reads the run so far back from its progress lines, the last reply as it grew", () => {
    const sent = { events: 0, notices: 0, technique: false };
    const usage = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
    const events: { kind: "user" | "reply"; text: string }[] = [{ kind: "user", text: "Hi" }, { kind: "reply", text: "Wor" }];
    const lines = [...progressLines({ technique: "pdf", events, notices: [], usage, during: null }, sent)];
    events[1]!.text = "Working.";
    lines.push(...progressLines({ technique: "pdf", events, notices: ["a notice"], usage, during: "refine({})" }, sent));
    const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n{"kind":"event","i":2,"ev`; // the last line cut by the kill
    expect(readProgress(text)).toEqual({ started: false, technique: "pdf", events: [{ kind: "user", text: "Hi" }, { kind: "reply", text: "Working." }], notices: ["a notice"], usage, during: "refine({})" });
  });
});
