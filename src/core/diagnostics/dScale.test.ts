import { describe, expect, it } from "vitest";
import { dScaleSearch, observedPeaks, wrongScale } from "@/core/diagnostics/dScale";

describe("one factor on every d", () => {
  // A cubic cell's reflections, a = 4.2 Å: d = a/√(h²+k²+l²).
  const reflections = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 16].map((n) => 4.2 / Math.sqrt(n));
  const peaksAt = (f: number) => reflections.slice(0, 10).map((d, i) => ({ d: d * f, height: 100 - 5 * i }));

  it("finds the factor that indexes the peaks, and calls it a wrong scale only away from 1", () => {
    const off = dScaleSearch(peaksAt(1.0104), reflections)!;
    expect(off.factor).toBeCloseTo(1.0104, 3);
    expect(off.indexed).toBeGreaterThan(0.95);
    expect(wrongScale(off)).toBe(true);
    expect(wrongScale(dScaleSearch(peaksAt(1), reflections))).toBe(false);
    expect(dScaleSearch(peaksAt(1).slice(0, 3), reflections)).toBeNull();
  });

  it("reads peaks off a pattern: the highest within their window, well above its floor", () => {
    const d = Array.from({ length: 400 }, (_, i) => 1 + i * 0.01);
    const y = d.map((v) => 50 + 1000 * Math.exp(-(((v - 2.1) / 0.02) ** 2)) + 400 * Math.exp(-(((v - 3) / 0.02) ** 2)));
    const peaks = observedPeaks(d, y, y.map((v) => Math.sqrt(v)));
    expect(peaks.map((p) => +p.d.toFixed(2))).toEqual([2.1, 3]);
  });
});
