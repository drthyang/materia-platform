import { describe, it, expect } from "vitest";
import type { RefinementParameter } from "@/core/refinement/types";
import { refine, type RefinementProblem } from "@/core/refinement/engine";

/**
 * The per-cycle relative shift cap (5× the parameter's magnitude) and a
 * parameter at ~0. A value of exactly 0 was always left unlimited; a value
 * round-off had left at 1e-15 was not, so it could grow sixfold per cycle at
 * most, the χ² test then called the fit converged, and the parameter stayed
 * at 1e-11 (the PDF page's secondary distortion modes after a change of the
 * ADP model, secondary-modes-refine 2026-11-20). A value whose whole effect
 * on the calculated pattern is below a part per million of the pattern is
 * numerically at zero and is left unlimited as an exact 0 is.
 */

const x = Array.from({ length: 81 }, (_, i) => -2 + 0.05 * i);

/** Two Gaussians: one of fixed place and refined height, one of refined place `u` (a displacement from 0.6) and width `w`. */
function peaks(start: { readonly u: number; readonly height?: number }, truth = { u: 0.3, w: 0.5, height: 2 }): RefinementProblem {
  const model = (p: Readonly<Record<string, number>>): Float64Array =>
    Float64Array.from(x.map((xi) => (p.height ?? 0) * Math.exp(-((xi + 1) ** 2) / 0.18) + Math.exp(-((xi - 0.6 - (p.u ?? 0)) ** 2) / (2 * (p.w ?? 1) ** 2))));
  const parameters: RefinementParameter[] = [
    { id: "height", label: "height", kind: "scale", value: start.height ?? 1.7, initialValue: 1.7, fixed: false },
    { id: "u", label: "u", kind: "positionShift", value: start.u, initialValue: start.u, fixed: false },
    { id: "w", label: "w", kind: "bIso", value: 0.42, initialValue: 0.42, fixed: false },
  ];
  return { parameters, observations: model(truth), weights: Float64Array.from(x.map(() => 1)), calculate: model };
}

describe("the relative shift cap and a parameter at ~0", () => {
  it("refines a displacement that starts at round-off (1e-15, 1e-11) as one that starts at exactly 0", () => {
    const fromZero = refine(peaks({ u: 0 }), { maxIterations: 30 });
    expect(fromZero.status).toBe("converged");
    expect(fromZero.parameters.u).toBeCloseTo(0.3, 9);
    for (const u of [1e-15, -3e-15, 2.6e-11, 4e-32]) {
      const r = refine(peaks({ u }), { maxIterations: 30 });
      // It stayed at 6ⁿ·u: "converged" after a few cycles, the displacement still ~1e-11.
      expect(r.status, `u = ${u}`).toBe("converged");
      expect(r.parameters.u, `u = ${u}`).toBeCloseTo(0.3, 9);
      expect(r.parameters.w, `u = ${u}`).toBeCloseTo(0.5, 9);
      expect(r.history.length, `u = ${u}`).toBe(fromZero.history.length);
    }
  });

  it("still caps a parameter that carries the pattern, however small its value (a scale of 1e-11)", () => {
    // The first peak's height is 2e-11 of its unit: tiny, yet it is half the pattern. One cycle moves it fivefold at most.
    const tiny = 1e-11;
    const model = (p: Readonly<Record<string, number>>): Float64Array => Float64Array.from(x.map((xi) => ((p.height ?? 0) / tiny) * Math.exp(-((xi + 1) ** 2) / 0.18)));
    const problem: RefinementProblem = {
      parameters: [{ id: "height", label: "height", kind: "positionShift", value: tiny, initialValue: tiny, fixed: false }],
      observations: model({ height: 100 * tiny }),
      weights: Float64Array.from(x.map(() => 1)),
      calculate: model,
    };
    const one = refine(problem, { maxIterations: 1 });
    expect(one.parameters.height! / tiny).toBeCloseTo(6, 9);
    expect(refine(problem, { maxIterations: 30 }).parameters.height! / tiny).toBeCloseTo(100, 6);
  });

  it("leaves a value its explicit maxShift limits limited at ~0 too", () => {
    const p = peaks({ u: 1e-15 });
    const capped: RefinementProblem = { ...p, parameters: p.parameters.map((q) => (q.id === "u" ? { ...q, maxShift: 0.01 } : q)) };
    const one = refine(capped, { maxIterations: 1 });
    expect(Math.abs(one.parameters.u!)).toBeLessThanOrEqual(0.01 + 1e-12);
    expect(Math.abs(one.parameters.u!)).toBeGreaterThan(1e-4);
  });
});
