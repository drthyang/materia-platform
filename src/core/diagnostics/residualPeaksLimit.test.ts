import { describe, it, expect } from "vitest";
import { residualPeaks } from "@/core/diagnostics/assessment";

/**
 * The peak list's limit applies to each class after classification: with 15
 * misfits on strong reflections and one weaker line between reflections, a
 * limit of 12 used to keep the 12 tallest residuals (all misfits) and drop the
 * unexplained line before it was classified.
 */
describe("residualPeaks' limit", () => {
  it("keeps a weaker unexplained peak when misfits outnumber the limit", () => {
    const d = Array.from({ length: 4000 }, (_, i) => 1 + i * 0.001);
    const misfitAt = Array.from({ length: 15 }, (_, i) => 1.2 + i * 0.15);
    const lineAt = 3.53;
    const bump = (x: number, at: number, h: number): number => h * Math.exp(-0.5 * ((x - at) / 0.003) ** 2);
    const yCalc = d.map((x) => 100 + misfitAt.reduce((s, at) => s + bump(x, at, 1000), 0));
    const yObs = d.map((x, i) => yCalc[i]! + misfitAt.reduce((s, at) => s + bump(x, at, 300), 0) + bump(x, lineAt, 60));
    const reflections = misfitAt.map((at, i) => ({ d: at, hkl: `${i} 0 0`, phaseLabel: "main" }));
    const sigma = yObs.map((y) => Math.sqrt(y) * 0.2);
    const peaks = residualPeaks({ d, yObs, yCalc, sigma, reflections }, { limit: 12 });
    expect(peaks.onReflection).toHaveLength(12);
    expect(peaks.between.map((p) => +p.d.toFixed(2))).toEqual([lineAt]);
  });
});
