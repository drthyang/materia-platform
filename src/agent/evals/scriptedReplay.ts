import { describe, it, expect } from "vitest";
import { SCENARIOS, scenario } from "@/agent/evals/scenarios";
import { regrade, runScenario, savedRun, transcript, type EvalResult, type SavedRun } from "@/agent/evals/harness";
import { scriptedModel, type ScriptTurn } from "@/agent/evals/scripted";
import { LIVE_TOOLS } from "@/agent/tools";
import { REPLAYS } from "@/agent/evals/replays";

/**
 * What the scripted eval test files share: one replay of a scenario, how a
 * result is read, and the three cases every scenario gets. The cases are split
 * over several test files (evals*.test.ts) so that no one file holds the whole
 * suite's time and CI's shards balance; each scenario is in exactly one file.
 */

export async function replay(id: string, turns: readonly ScriptTurn[], toolScope?: "stage"): Promise<EvalResult & { overrun: number; offered: readonly (readonly string[])[] }> {
  const stand = await scriptedModel(turns);
  try {
    const result = await runScenario(scenario(id), { ...stand.model, ...(toolScope ? { toolScope } : {}) });
    return { ...result, overrun: stand.overrun(), offered: stand.offered() };
  } finally {
    await stand.close();
  }
}

export const failing = (r: EvalResult): string[] => r.grades.filter((g) => !g.pass).map((g) => g.check);
export const verdicts = (r: EvalResult): [string, boolean][] => r.grades.map((g) => [g.check, g.pass]);
/** The run as live.test.ts saves it (through JSON), scored again: the same verdicts. */
export const regraded = (r: EvalResult): [string, boolean][] => verdicts(regrade(JSON.parse(JSON.stringify(savedRun(r))) as SavedRun, scenario(r.scenario)));
export const why = (r: EvalResult): string => `${r.grades.map((g) => `${g.pass ? "✓" : "✗"} ${g.check}: ${g.detail}`).join("\n")}\n---\n${transcript(r.run)}`;

/** The test file a scenario's replays run in. Every id has one: what no rule names is in "powder". */
export type EvalGroup = "powder" | "magnetic" | "magnetic-30k" | "pdf" | "sc";
export function evalGroup(id: string): EvalGroup {
  if (id === "magnetic-30k") return "magnetic-30k"; // the slowest scenario by far, alone in its file
  if (id.startsWith("sc-")) return "sc";
  if (id.startsWith("pdf-")) return "pdf";
  if (id.startsWith("magnetic-") || id === "local-data-user-flow") return "magnetic";
  return "powder";
}

/** The good, stage-scoped and bad replay of every scenario of one group. Call it inside `describe("Agent evals, scripted", …)`. */
export function scenarioReplays(group: EvalGroup): void {
  for (const s of SCENARIOS.filter((x) => evalGroup(x.id) === group)) {
    // A scenario on data only some machines have (the user's own) replays where they are.
    describe.skipIf(!(s.available?.() ?? true))(s.id, () => {
      const r = REPLAYS[s.id]!;
      const limit = s.slow ? 240_000 : 60_000;
      it("passes every check as the Agent should behave", async () => {
        const result = await replay(s.id, r.good);
        expect(result.overrun, why(result)).toBe(0);
        expect(failing(result), why(result)).toEqual([]);
        expect(regraded(result), "the saved run, scored again").toEqual(verdicts(result));
      }, limit);

      it("offers every tool the good replay calls when the tools follow the stage (a local model's list)", async () => {
        const result = await replay(s.id, r.good, "stage");
        // Request i is answered with turn i: each call it makes must have been offered with it.
        const missing = r.good.flatMap((turn, i) => (turn.calls ?? []).filter((c) => !result.offered[i]?.includes(c.name)).map((c) => `turn ${i + 1}: ${c.name}`));
        expect(missing, why(result)).toEqual([]);
        expect(failing(result), why(result)).toEqual([]);
        // Fewer tools than the page has, on the powder page.
        if (result.run.port.technique === "powder") expect(Math.min(...result.offered.slice(0, r.good.length).map((o) => o.length))).toBeLessThan(LIVE_TOOLS.filter((t) => t.pages.includes("powder")).length);
      }, limit);

      it("fails the checks written against the failure", async () => {
        const result = await replay(s.id, r.bad);
        const names = s.checks.map((c) => c.name);
        for (const c of r.catches) expect(names, `${c} is not a check of ${s.id}`).toContain(c);
        expect(failing(result), why(result)).toEqual(expect.arrayContaining([...r.catches]));
        expect(regraded(result), "the saved run, scored again").toEqual(verdicts(result));
      }, limit);
    });
  }
}
