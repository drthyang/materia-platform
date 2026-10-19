import { describe, expect, it } from "vitest";
import type { Session } from "@/app/powderSession";
import { mn3gaFluoriteSession, mn3gaMagneticSession } from "@/agent/evals/pages";
import { sessionPort } from "@/testSupport/agentHeadless";
import { knownPhaseStructure } from "@/core/diagnostics/knownPhases";
import { evaluate_pattern, rank_next_parameters, refine_magnetic_powder, refine_powder } from "@/mcp/tools";

/**
 * The MCP tools that fit or score a powder problem with a second phase or a
 * magnetic model, on a pattern whose first points are an excluded plateau (a
 * GSAS export's constant −3 outside its fit range). The multi-phase and
 * nuclear + magnetic problems once fitted the plateau: each tool's wR was not
 * that of the points it counts (observationCount, its residual), and
 * evaluate_pattern scored the plateau too.
 */
const PLATEAU = 60;
const withPlateau = <S extends Session>(s: S): S => ({ ...s, pattern: { ...s.pattern, points: s.pattern.points.map((p, i) => (i < PLATEAU ? { ...p, yObs: -3 } : p)) } });

/** The weighted R over the points kept: √(Σ((o − c)/σ)² / Σ(o/σ)²). */
function wROf(yObs: readonly number[], yCalc: readonly number[], sigma: readonly number[], keep: (i: number) => boolean = () => true): number {
  let num = 0, den = 0;
  yObs.forEach((o, i) => {
    if (!keep(i)) return;
    const w = 1 / sigma[i]! ** 2;
    num += w * (o - yCalc[i]!) ** 2;
    den += w * o * o;
  });
  return Math.sqrt(num / den);
}

describe("the MCP tools' wR on a pattern with an excluded plateau", () => {
  it("refine_powder with a second phase: the result's wR is that of its residual, the points it counts", async () => {
    const { port, session } = sessionPort(withPlateau(mn3gaFluoriteSession()));
    port.addPhase!(knownPhaseStructure("CaF₂")!);
    const s = session();
    const out = await refine_powder({
      structure: s.structure, extraPhases: [...s.extraPhases], pattern: s.pattern,
      parameters: [...s.powderParams], bindings: [...s.powderBindings], profile: s.powderProfile,
    });
    expect(out.result.status).toBe("converged");
    expect(out.observationCount).toBe(s.pattern.points.length - PLATEAU);
    expect(out.residual.yObs).toHaveLength(out.observationCount);
    expect(out.result.agreement.rWeighted).toBeCloseTo(wROf(out.residual.yObs, out.residual.yCalc, out.residual.sigma), 9);
  }, 120_000);

  it("refine_magnetic_powder, evaluate_pattern and rank_next_parameters give the refined model one wR, without the plateau", async () => {
    const { port, session } = sessionPort(withPlateau(mn3gaMagneticSession()));
    const h = (): NonNullable<ReturnType<NonNullable<typeof port.magnetic>>> => port.magnetic!()!;
    h().setK([0, 0, 0.5]);
    h().choose("G2");
    h().continueToRefinement(false);
    const s = session();
    const args = { structure: s.structure, pattern: s.pattern, bindings: [...s.powderBindings], profile: s.powderProfile };
    const out = await refine_magnetic_powder({ ...args, magnetic: s.magnetic!, parameters: [...s.powderParams] });
    expect(out.result.status).toBe("converged");
    const wR = out.result.agreement.rWeighted!;
    const c = out.components;
    expect(out.observationCount).toBe(s.pattern.points.length - PLATEAU);
    expect(wR).toBeCloseTo(wROf(c.yObs, c.yCalc, s.pattern.points.map((p) => p.sigma!), (i) => i >= PLATEAU), 9);
    const scored = evaluate_pattern({ ...args, magnetic: out.magnetic, parameters: out.parameters });
    expect(scored.observationCount).toBe(out.observationCount);
    expect(scored.agreement.wR / 100).toBeCloseTo(wR, 9);
    expect(rank_next_parameters({ ...args, magnetic: out.magnetic, parameters: out.parameters }).wrNow).toBeCloseTo(wR, 9);
  }, 120_000);
});
