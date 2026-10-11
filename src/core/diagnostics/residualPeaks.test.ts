import { describe, it, expect } from "vitest";
import { residualPeaks } from "@/core/diagnostics/assessment";

/**
 * A d grid with a model — flat, or with Lorentzian lines (half-width 0.01 Å) —
 * and obs = model + bumps (Gaussian in d, width ~ 0.004 Å).
 */
function pattern(bumps: { d: number; height: number }[], noiseAt?: { from: number; to: number }, lines: readonly number[] = []) {
  const d: number[] = [];
  for (let x = 1; x <= 5; x += 0.0005) d.push(x);
  const model = (x: number): number => 100 + lines.reduce((s, c) => s + 2000 * (1e-4 / ((x - c) ** 2 + 1e-4)), 0);
  const yCalc = d.map(model);
  const yObs = d.map((x, i) => {
    let y = model(x) + bumps.reduce((s, b) => s + b.height * Math.exp(-(((x - b.d) / 0.004) ** 2)), 0);
    // A sparse, low-count stretch: lone points 3σ high (σ = 10 there), never a peak.
    if (noiseAt && x >= noiseAt.from && x <= noiseAt.to && i % 7 === 0) y += 30;
    return y;
  });
  const sigma = d.map((x) => (noiseAt && x >= noiseAt.from && x <= noiseAt.to ? 10 : 1));
  return { d, yObs, yCalc, sigma };
}

describe("residual peaks", () => {
  const reflections = [{ d: 3.199, hkl: "1 0 1", phaseLabel: "Mn3Ga" }, { d: 2.709, hkl: "1 1 0", phaseLabel: "Mn3Ga" }];

  it("tells a misfit of a known reflection, and a tail beside one, from intensity no phase explains", () => {
    const bumps = [{ d: 3.2, height: 60 }, { d: 2.735, height: 30 }, { d: 2.0, height: 40 }];
    const { between, beside, onReflection } = residualPeaks({ ...pattern(bumps, undefined, [3.199, 2.709]), reflections });
    expect(onReflection.map((p) => [Number(p.d.toFixed(3)), p.nearNuclear?.hkl])).toEqual([[3.2, "1 0 1"]]);
    // 1% beyond 1 1 0, on the line's calculated tail: its tail or shoulder, not a new phase.
    expect(beside.map((p) => [Number(p.d.toFixed(3)), p.nearNuclear?.hkl])).toEqual([[2.735, "1 1 0"]]);
    expect(between.map((p) => Number(p.d.toFixed(3)))).toEqual([2]);
  });

  it("calls a bump beside a reflection a peak when the model has no line intensity under it", () => {
    // The same positions with a flat model: nothing calculated reaches 2.735, so it is a resolved peak.
    const { between, beside } = residualPeaks({ ...pattern([{ d: 2.735, height: 30 }, { d: 2.0, height: 40 }]), reflections });
    expect(beside).toEqual([]);
    expect(between.map((p) => Number(p.d.toFixed(3)))).toEqual([2, 2.735]);
  });

  it("does not read lone noisy points in a low-count region as peaks, given each point's σ", () => {
    const data = pattern([{ d: 2.0, height: 40 }], { from: 4.6, to: 5 });
    expect(residualPeaks(data).between.map((p) => Number(p.d.toFixed(3)))).toEqual([2]);
    // Without σ the same noise passes the global threshold.
    const { sigma: _s, ...noSigma } = data;
    expect(residualPeaks(noSigma).between.length).toBeGreaterThan(1);
  });
});

describe("an ADP at its bound, by technique", () => {
  it("gives real-space advice on the PDF page", async () => {
    const { assessRefinement } = await import("@/core/diagnostics/assessment");
    const result = {
      status: "converged" as const, parameters: { U_Ga: 0 }, esd: {}, agreement: { rFactor: 0.12, rWeighted: 0.125 }, history: [],
      diagnostics: { svdZeroCount: 0, singularParameterIds: [], conditionNumber: 10, highCorrelations: [], maxLambda: 1e-3, atBounds: [{ parameterId: "U_Ga", bound: "min" as const, value: 0 }], maxShiftOverEsd: 0 },
    };
    const parameters = [{ id: "U_Ga", label: "Ga U", kind: "uAniso" as const, value: 0, initialValue: 0.01, fixed: false, min: 0 }];
    const pdf = assessRefinement({ result, parameters, observationCount: 500, mode: "pdf" });
    expect(pdf.findings[0]!.detail).toMatch(/correlated motion sharpens them/);
    const powder = assessRefinement({ result, parameters, observationCount: 500 });
    expect(powder.findings[0]!.detail).toMatch(/over-damping high-angle intensity/);
  });
});
