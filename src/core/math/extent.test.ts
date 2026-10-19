import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import { minMax } from "@/core/math/extent";
import { dRange } from "@/core/workflow/leBail";

/**
 * The least and greatest of a pattern's values, by a loop. `Math.min(...xs)`
 * passes every value as an argument; past about 10⁵ of them the call stack
 * overflows, and a time-of-flight file holds 10⁵–10⁶ points.
 */

/** A TOF pattern of `n` points. */
function bigTof(n: number): PowderPattern {
  return {
    id: "big", name: "big", xUnit: "tof", radiation: { kind: "neutron-tof" },
    points: Array.from({ length: n }, (_, i) => ({ x: 1000 + i * 0.1, yObs: 1 + (i % 7) })),
  };
}

describe("minMax", () => {
  it("gives the least and greatest, and ±∞ for none", () => {
    expect(minMax([3, -1, 7, 2])).toEqual({ min: -1, max: 7 });
    expect(minMax([])).toEqual({ min: Infinity, max: -Infinity });
  });
});

describe("a pattern of 500 000 points", () => {
  const N = 500_000;

  it("has a d range", () => {
    const r = dRange(bigTof(N), { difC: 10000, difA: 0, difB: 0, zero: 0 });
    expect(r.dMin).toBeCloseTo(0.1 * 0.95, 6); // the first point, widened 5 %
    expect(r.dMax).toBeGreaterThan(r.dMin);
  });
});
