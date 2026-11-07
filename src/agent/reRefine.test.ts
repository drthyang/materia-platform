import { describe, expect, it } from "vitest";
import { executor, fakeHost, headlessHistory } from "@/testSupport/agentHeadless";
import { mn3gaSession, powderPage } from "@/agent/evals/pages";
import { analysisOf } from "@/agent/pages";

/**
 * A refinement run again at its minimum (full-refinement, Sonnet, 2026-11-07):
 * the re-run found no step that lowered χ², came back "stalled", and the
 * method's stages already done (the base and the ADPs) went off the record,
 * the verdict "poor" at GoF 0.97.
 */
describe("a converged fit refined again", () => {
  it("is converged with no change, and keeps its stages and its verdict", async () => {
    const port = powderPage(mn3gaSession());
    const h = headlessHistory(port);
    const { host, records } = fakeHost(port, h.history, (kind, agent) => h.record(kind, agent ? "agent" : undefined), h.goTo);
    const { ex } = executor(host);
    const run = async (name: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
      const out = await ex.run(name, input);
      if (name === "refine" && out.refined) h.record("refine", "agent", "Refine");
      expect(out.isError, out.text).toBe(false);
      return JSON.parse(out.text) as Record<string, unknown>;
    };
    // Sonnet's route: the base, the width, the Mn position, the B values, the width and cell, the B values.
    await run("set_fit_range", { min: 16.968, max: 119.352, unit: "twoTheta" });
    await run("refine");
    await run("set_free", { free: ["width"] });
    await run("refine");
    await run("set_free", { fix: ["width", "cell_a", "cell_c"], free: ["pos_Mn1_0"] });
    await run("refine");
    await run("set_free", { fix: ["pos_Mn1_0"], free: ["B_Mn1", "B_Ga1"] });
    await run("refine");
    await run("set_free", { fix: ["B_Mn1", "B_Ga1"], free: ["width", "cell_a", "cell_c"] });
    await run("refine");
    await run("set_free", { fix: ["width", "cell_a", "cell_c"], free: ["B_Mn1", "B_Ga1"] });
    // The B values again: one tiny step (0.001 esd), then none lowers χ². It was "stalled".
    const last = await run("refine");
    expect(last).toMatchObject({ refined: true, status: "converged" });
    expect(last.maxShiftOverEsd as number).toBeLessThan(0.01);
    const key = analysisOf(port);
    const stages = (): string[] => [...records.get(key)!.stagesDone].sort();
    const band = async (): Promise<string> => ((await run("assess_refinement")).verdict as { band: string }).band;
    await run("get_state");
    expect(stages()).toEqual(["adp", "base", "positions", "profile"]);
    const verdict = await band();
    expect(verdict).not.toBe("poor");
    // Run again twice at the minimum: converged with no change, the stages and the verdict kept.
    for (let n = 0; n < 2; n++) {
      const again = await run("refine");
      // Whether a round-off step is accepted first is the platform's (macOS arm64: none, "no change"; Linux x64: one, 4e-12 esd).
      expect(again).toMatchObject({ refined: true, status: "converged" });
      expect(again.maxShiftOverEsd as number).toBeLessThan(1e-6);
      expect(again.message).toMatch(/^converged after (1 iteration\(s\), no change: already at the minimum|2 iteration\(s\))$/);
      await run("get_state");
      expect(stages()).toEqual(["adp", "base", "positions", "profile"]);
      expect(await band()).toBe(verdict);
    }
  }, 120_000);
});
