import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import { minMax } from "@/core/math/extent";
import { dRange } from "@/core/workflow/leBail";
import { powderCurves } from "@/core/workflow/powder";
import { powderBindings, powderParameters } from "@/examples/synthetic";
import { IDENTITY3 } from "@/core/math/mat3";
import type { StructureModel } from "@/core/crystal/types";

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

  it("reads 500 000 values, which Math.min cannot take as arguments", () => {
    const values = Array.from({ length: 500_000 }, (_, i) => 0.4 + (i % 1000) * 0.003);
    expect(() => Math.min(...values)).toThrow(RangeError);
    expect(minMax(values)).toEqual({ min: 0.4, max: 0.4 + 999 * 0.003 });
  });
});

describe("a pattern of 500 000 points", () => {
  const N = 500_000;

  it("is drawn: the calculated curve of a 2θ scan", () => {
    const structure: StructureModel = {
      id: "s", name: "s", cell: { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 },
      spaceGroup: { operations: [{ rotation: IDENTITY3, translation: [0, 0, 0], xyz: "x,y,z" }] },
      sites: [{ label: "Ni1", element: "Ni", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } }],
    };
    const pattern: PowderPattern = {
      id: "big2t", name: "big", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 1.54 }, wavelength: 1.54,
      points: Array.from({ length: N }, (_, i) => ({ x: 10 + i * 0.0002, yObs: 1 })),
    };
    const curves = powderCurves(structure, pattern, powderParameters(structure, 1), powderBindings(structure, pattern.id));
    expect(curves.yCalc.length).toBe(N);
  });

  it("has a d range", () => {
    const r = dRange(bigTof(N), { difC: 10000, difA: 0, difB: 0, zero: 0 });
    expect(r.dMin).toBeCloseTo(0.1 * 0.95, 6); // the first point, widened 5 %
    expect(r.dMax).toBeGreaterThan(r.dMin);
  });
});
