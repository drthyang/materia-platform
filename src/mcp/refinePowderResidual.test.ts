import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { PowderPattern } from "@/core/diffraction/types";
import { mn3gaPowgenExample } from "@/examples/mn3gaPowgen";
import { buildMultiPhaseSpec } from "@/app/multiPhaseSpec";
import { multiPhaseCurves } from "@/core/workflow/multiPhase";
import { assess_refinement, refine_powder } from "@/mcp/tools";
import { TOOL_REGISTRY } from "@/mcp/registry";

/**
 * refine_powder's residual is what assess_refinement scans for peaks no phase
 * explains. It must be the model the refinement fitted: every phase, inside the
 * fit window, with each point's σ and every phase's reflections.
 */
describe("refine_powder's residual", () => {
  const { structure, extraPhases, pattern, instrument } = mn3gaPowgenExample();
  const spec = buildMultiPhaseSpec([structure, ...extraPhases], pattern, instrument, 6, {}, "isotropic");
  const phases = [{ structure, id: structure.id }, ...extraPhases.map((s) => ({ structure: s, id: s.id }))];
  // An exact two-phase pattern: observed = the two-phase calculated one.
  const exact = multiPhaseCurves(phases, pattern, spec.params, spec.bindings, spec.profile);
  const selfPattern: PowderPattern = { ...pattern, points: pattern.points.map((p, i) => ({ ...p, yObs: exact.yCalc[i] ?? 0 })) };
  const parameters = spec.params.map((p) => ({ ...p, fixed: p.kind !== "scale" }));
  const args = { structure, extraPhases, pattern: selfPattern, instrument, parameters, bindings: spec.bindings, profile: spec.profile, maxIterations: 3 };

  it("is the multi-phase model: an exact two-phase fit leaves nothing", async () => {
    const out = await refine_powder(args);
    const worst = out.residual.yObs.reduce((m, y, i) => Math.max(m, Math.abs(y - out.residual.yCalc[i]!)), 0);
    const peak = Math.max(...out.residual.yObs);
    expect(worst / peak).toBeLessThan(1e-6);
    // Every phase's reflections and every point's σ go with it.
    expect(new Set(out.residual.reflections.map((r) => r.phaseLabel)).size).toBe(phases.length);
    expect(out.residual.sigma).toHaveLength(out.residual.d.length);
    const assessment = assess_refinement({ result: out.result, parameters: out.parameters, observationCount: out.observationCount, residual: out.residual });
    expect(assessment.findings.filter((f) => f.category === "residual")).toEqual([]);
  });

  it("covers only the fit window, and counts only its points", async () => {
    const xs = selfPattern.points.map((p) => p.x);
    const lo = xs[Math.floor(xs.length / 3)]!;
    const hi = xs[Math.floor((2 * xs.length) / 3)]!;
    const inside = xs.filter((x) => x >= lo && x <= hi).length;
    const out = await refine_powder({ ...args, fitRange: { min: lo, max: hi } });
    expect(out.observationCount).toBe(inside);
    expect(out.residual.d).toHaveLength(inside);
    expect(out.residual.sigma).toHaveLength(inside);
  });

  it("reaches assess_refinement through the tool's schema whole", () => {
    const tool = TOOL_REGISTRY.find((t) => t.name === "assess_refinement")!;
    const residual = { d: [1, 2], yObs: [3, 4], yCalc: [3, 4], sigma: [1, 1], reflections: [{ d: 1.5, hkl: "1 1 0", phaseLabel: "MnO" }], magneticNeutron: true, lineWidth: 0.01 };
    expect(z.object(tool.inputSchema).parse({ result: {}, parameters: [], observationCount: 2, residual }).residual).toEqual(residual);
  });
});
