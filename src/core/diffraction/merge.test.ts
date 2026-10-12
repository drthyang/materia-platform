import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { parseSymmetryOperation } from "@/core/crystal/symmetry";
import { laueRotations, measurementMerge, mergeEquivalents, type Reflection2 } from "@/core/diffraction/merge";

describe("laueRotations", () => {
  it("adds Friedel inversion to a P1 operation list (Laue class -1)", () => {
    const p1 = [parseSymmetryOperation("x,y,z")];
    const rots = laueRotations(p1);
    // Identity + its negative (inversion) = 2 distinct rotations.
    expect(rots).toHaveLength(2);
  });

  it("recovers the 48 rotations of the m-3m Laue class for Fm-3m", () => {
    const fm3m = buildSpaceGroup(225);
    // Centring translations share rotation parts, so distinct rotations = 48.
    expect(laueRotations(fm3m.operations)).toHaveLength(48);
  });
});

describe("mergeEquivalents", () => {
  it("merges Friedel pairs under P-1 and reports zero R_int for equal intensities", () => {
    const p1bar = buildSpaceGroup(2);
    const data: Reflection2[] = [
      { h: 1, k: 2, l: 3, intensity: 100, sigma: 5 },
      { h: -1, k: -2, l: -3, intensity: 100, sigma: 5 },
      { h: 2, k: 0, l: 0, intensity: 50, sigma: 3 },
    ];
    const { reflections, statistics } = mergeEquivalents(data, p1bar.operations);
    expect(statistics.unique).toBe(2); // the pair merges, the singleton stays
    expect(statistics.observations).toBe(3);
    expect(statistics.redundancy).toBeCloseTo(1.5, 6);
    expect(statistics.rInt).toBeCloseTo(0, 10); // identical equivalents
    const pair = reflections.find((r) => r.redundancy === 2)!;
    expect(pair.intensity).toBeCloseTo(100, 6);
    // Merged σ shrinks vs a single measurement (propagated 1/√Σw = 5/√2).
    expect(pair.sigma).toBeCloseTo(5 / Math.SQRT2, 6);
  });

  it("computes a nonzero R_int from discrepant equivalents", () => {
    const p1bar = buildSpaceGroup(2);
    const data: Reflection2[] = [
      { h: 1, k: 0, l: 0, intensity: 90, sigma: 5 },
      { h: -1, k: 0, l: 0, intensity: 110, sigma: 5 },
    ];
    const { statistics } = mergeEquivalents(data, p1bar.operations);
    // mean 100; Σ|I−<I>| = 10+10 = 20; Σ|I| = 200 → R_int = 0.1.
    expect(statistics.rInt).toBeCloseTo(0.1, 6);
  });

  it("takes the merged σ from the scatter, as SHELXL estimates it, when the equivalents disagree beyond their σ", () => {
    const p1bar = buildSpaceGroup(2);
    // Four equivalents of 1 2 3 (two of them Friedel opposites, equivalent under −1), σ 1, spread far beyond it.
    const data: Reflection2[] = [[1, 2, 3, 100], [-1, -2, -3, 110], [1, 2, 3, 96], [-1, -2, -3, 106]].map(([h, k, l, i]) => ({ h: h!, k: k!, l: l!, intensity: i!, sigma: 1 }));
    const [merged] = mergeEquivalents(data, p1bar.operations).reflections;
    // Mean 103; Σ|I − Ī| = 3 + 7 + 7 + 3 = 20; SHELXL's 20 / (4·√3), not the RMS standard error √(116/12).
    expect(merged!.intensity).toBeCloseTo(103, 10);
    expect(merged!.sigma).toBeCloseTo(20 / (4 * Math.sqrt(3)), 10);
    // Equivalents within their σ keep the propagated σ.
    const close = data.map((r, i) => ({ ...r, intensity: 100 + 0.1 * i }));
    expect(mergeEquivalents(close, p1bar.operations).reflections[0]!.sigma).toBeCloseTo(0.5, 10);
  });

  it("collapses a full cubic equivalent set to one unique reflection", () => {
    const fm3m = buildSpaceGroup(225);
    // The {2 0 0} family under m-3m: all permutations/signs are equivalent.
    const family: Reflection2[] = [
      [2, 0, 0], [0, 2, 0], [0, 0, 2], [-2, 0, 0], [0, -2, 0], [0, 0, -2],
    ].map(([h, k, l]) => ({ h: h!, k: k!, l: l!, intensity: 200, sigma: 4 }));
    const { statistics } = mergeEquivalents(family, fm3m.operations);
    expect(statistics.unique).toBe(1);
    expect(statistics.redundancy).toBeCloseTo(6, 6);
    expect(statistics.rInt).toBeCloseTo(0, 10);
  });
});

describe("measurementMerge", () => {
  it("adds, for a non-centrosymmetric group, the merge with the Friedel mates apart and the absences out, as SHELXL reports it", () => {
    const ops = buildSpaceGroup(19).operations; // P2₁2₁2₁
    const rows: Reflection2[] = [];
    for (let h = 1; h <= 3; h++) for (let k = 1; k <= 3; k++) for (let l = 1; l <= 3; l++) {
      const i = 100 + 10 * h + 3 * k + l;
      rows.push({ h, k, l, intensity: i, sigma: 1 }, { h: -h, k: -k, l, intensity: i, sigma: 1 });
      rows.push({ h: -h, k: -k, l: -l, intensity: 1.04 * i, sigma: 1 }, { h, k, l: -l, intensity: 1.04 * i, sigma: 1 });
    }
    // An absence measured (h00, h odd): out of the merge with the mates apart, as SHELXL leaves it out.
    rows.push({ h: 1, k: 0, l: 0, intensity: 0.5, sigma: 1 }, { h: -1, k: 0, l: 0, intensity: 0.4, sigma: 1 });
    const st = measurementMerge(rows, ops).statistics;
    expect(st.rInt).toBeGreaterThan(0.019);
    expect(st.friedelApart).toMatchObject({ unique: 54, redundancy: 2 });
    expect(st.friedelApart!.rInt).toBeCloseTo(0, 12);
    // Centrosymmetric: the mates are equivalent, nothing to add.
    expect(measurementMerge(rows, buildSpaceGroup(62).operations).statistics.friedelApart).toBeUndefined();
  });
});

describe("merging reflections without their own σ", () => {
  it("invents no σ = 1/√n: the scatter alone stands, and a single measurement's σ stays unknown", () => {
    const ops = buildSpaceGroup(2).operations; // P-1: h and -h equivalent
    const rows: Reflection2[] = [
      { h: 1, k: 0, l: 0, intensity: 100, sigma: 0 },
      { h: -1, k: 0, l: 0, intensity: 104, sigma: 0 },
      { h: 0, k: 1, l: 0, intensity: 50, sigma: 0 },
    ];
    const merged = mergeEquivalents(rows, ops).reflections;
    const pair = merged.find((r) => r.redundancy === 2)!;
    // The scatter: |100 − 102| + |104 − 102| over 2·√1 = 2. Not max(1/√2, 2) by chance, and not 1 for the single one.
    expect(pair.sigma).toBeCloseTo(2, 12);
    expect(merged.find((r) => r.redundancy === 1)!.sigma).toBe(0);
  });
});
