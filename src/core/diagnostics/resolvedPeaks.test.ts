import { describe, it, expect } from "vitest";
import { markResolvedPeaks } from "@/core/diagnostics/assessment";
import { annotateExtraPeaks, detectExtraPeaks } from "@/core/magnetic/extraPeaks";
import { PEAK_CRITERIA, peakRows } from "@/app/magneticStep";

/**
 * A dense nuclear pattern (Lorentzian lines, half-width 0.01 Å), and obs =
 * model + Gaussian bumps: misfits on strong lines, and magnetic lines within
 * 1 % of weak nuclear reflections, as on AWO4's monoclinic cell.
 */
function pattern(lines: readonly { d: number; height: number }[], bumps: readonly { d: number; height: number }[]) {
  const d: number[] = [];
  for (let x = 1; x <= 5; x += 0.0005) d.push(x);
  const model = (x: number): number => 100 + lines.reduce((s, l) => s + l.height * (1e-4 / ((x - l.d) ** 2 + 1e-4)), 0);
  const yCalc = d.map(model);
  const yObs = d.map((x) => model(x) + bumps.reduce((s, b) => s + b.height * Math.exp(-(((x - b.d) / 0.004) ** 2)), 0));
  return { d, yObs, yCalc, sigma: d.map(() => 1) };
}

describe("residual peaks near a nuclear reflection, for the k-search", () => {
  const lines = [{ d: 3.0, height: 2000 }, { d: 2.4, height: 20 }, { d: 1.827, height: 2000 }, { d: 1.6, height: 1500 }, { d: 4.0, height: 1800 }];
  const refs = lines.map((l, i) => ({ d: l.d, hkl: `${i + 1} 0 0`, phaseLabel: "AWO4" }));
  // A misfit on a strong line, a magnetic line 0.6 % from a weak one, a bump 0.8 % beside a strong line's tail, one on no line,
  // and one on a weak line's own position (the k = 0 signature: left to the step's k = 0 reading).
  const bumps = [{ d: 3.0, height: 60 }, { d: 2.385, height: 100 }, { d: 4.0005, height: 300 }, { d: 1.812, height: 100 }, { d: 2.084, height: 80 }];
  const p = pattern(lines, bumps);
  const peaks = markResolvedPeaks(annotateExtraPeaks(detectExtraPeaks(p.d, p.yObs, p.yCalc, { pointSigma: p.sigma, minSignificance: 3 }), refs), p.d, p.yCalc);
  const at = (d: number) => peaks.find((q) => Math.abs(q.d - d) < 0.003)!;

  it("keeps a misfit and a line's tail on the line, and frees a peak resolved from a weak line", () => {
    expect(at(3.0).nearNuclear?.resolved).toBeUndefined();
    expect(at(4.0).nearNuclear?.resolved).toBeUndefined();
    expect(at(1.812).nearNuclear).toMatchObject({ hkl: "3 0 0" });
    expect(at(1.812).nearNuclear?.resolved).toBeUndefined();
    expect(at(2.385).nearNuclear).toMatchObject({ hkl: "2 0 0", resolved: true });
    expect(at(2.084).nearNuclear).toBeUndefined();
  });

  it("keeps a shifted line (the data's peak beside the model's) a misfit", () => {
    // The data's strong line 0.5 % above the model's: a cell misfit, not a new peak.
    const shifted = pattern([{ d: 3.0, height: 2000 }, { d: 4.0, height: 1800 }, { d: 1.6, height: 1500 }, { d: 2.0, height: 1000 }], []);
    const yObs = shifted.d.map((x) => 100 + 2000 * (1e-4 / ((x - 3.015) ** 2 + 1e-4)) + 1800 * (1e-4 / ((x - 4.0) ** 2 + 1e-4)) + 1500 * (1e-4 / ((x - 1.6) ** 2 + 1e-4)) + 1000 * (1e-4 / ((x - 2.0) ** 2 + 1e-4)));
    const found = markResolvedPeaks(annotateExtraPeaks(detectExtraPeaks(shifted.d, yObs, shifted.yCalc, { pointSigma: shifted.sigma, minSignificance: 3 }), refs), shifted.d, shifted.yCalc);
    const off = found.find((q) => Math.abs(q.d - 3.02) < 0.01)!;
    expect(off.nearNuclear?.hkl).toBe("1 0 0");
    expect(off.nearNuclear?.resolved).toBeUndefined();
  });

  it("feeds the k-search the resolved peak by default, not the misfits", () => {
    const rows = peakRows(peaks, PEAK_CRITERIA, {});
    const included = rows.filter((r) => r.included).map((r) => Math.floor(r.d * 100) / 100).sort();
    expect(included).toEqual([2.08, 2.38]);
  });
});
