import type { Vec3 } from "@/core/math/types";
import { describe, it, expect } from "vitest";
import type { UnitCell } from "@/core/crystal/types";
import { inverseDSquared } from "@/core/crystal/unitCell";
import { searchPropagationVector, candidateKVectors, kLabel } from "@/core/magnetic/kSearch";

const ortho: UnitCell = { a: 4, b: 5, c: 6, alpha: 90, beta: 90, gamma: 90 };
const dOf = (h: number, k: number, l: number): number => 1 / Math.sqrt(inverseDSquared(ortho, h, k, l));

describe("propagation-vector (k) search", () => {
  it("enumerates the commensurate high-symmetry candidates", () => {
    const set = candidateKVectors([2, 3, 4]).map((k) => k.map((v) => v.toFixed(4)).join(","));
    expect(set).toContain("0.0000,0.0000,0.0000"); // Γ
    expect(set).toContain("0.5000,0.0000,0.0000"); // (½,0,0)
    expect(set).toContain("0.3333,0.0000,0.0000"); // (⅓,0,0)
    expect(set).toContain("0.2500,0.0000,0.0000"); // (¼,0,0)
    expect(set).toContain("0.5000,0.5000,0.5000"); // (½,½,½)
    // Components never exceed ½ (k and 1−k give the same powder set).
    for (const k of candidateKVectors()) for (const v of k) expect(v).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("recovers a known commensurate k = (0,0,½) from synthetic magnetic peaks", () => {
    const observed = [dOf(0, 0, 0.5), dOf(1, 0, 0.5), dOf(0, 1, 0.5), dOf(1, 1, 0.5), dOf(0, 0, 1.5), dOf(1, 0, 1.5)];
    const result = searchPropagationVector(ortho, observed, { tolerance: 0.005 });
    expect(result[0]!.k).toEqual([0, 0, 0.5]);
    expect(result[0]!.matched).toBe(observed.length);
    expect(result[0]!.rmsd).toBeLessThan(0.005);
  });

  it("does not spuriously prefer Γ for genuinely magnetic (non-nuclear) peaks", () => {
    const observed = [dOf(0, 0, 0.5), dOf(1, 0, 0.5), dOf(1, 1, 0.5)];
    const result = searchPropagationVector(ortho, observed, { tolerance: 0.005 });
    // The winner is the true k, not Γ — half-integer-L peaks are not nuclear.
    expect(result[0]!.k).toEqual([0, 0, 0.5]);
    expect(result[0]!.k.every((v) => v === 0)).toBe(false);
    // If Γ is returned at all, it explains none of the peaks.
    const gamma = result.find((c) => c.k.every((v) => v === 0));
    if (gamma) expect(gamma.matched).toBe(0);
  });

  it("distinguishes k = (½,0,0) from (0,0,½) in a non-cubic cell", () => {
    const observed = [dOf(0.5, 0, 0), dOf(0.5, 1, 0), dOf(0.5, 0, 1)];
    const result = searchPropagationVector(ortho, observed, { tolerance: 0.005 });
    expect(result[0]!.k).toEqual([0.5, 0, 0]);
  });

  it("labels fractional components", () => {
    expect(kLabel([0.5, 0, 0])).toBe("(½ 0 0)");
    expect(kLabel([1 / 3, 1 / 3, 0])).toBe("(⅓ ⅓ 0)");
  });

  it("recovers k = (½,0,0) on the real AWO₄ monoclinic cell (P2/c, β≈89.3°)", () => {
    // AWO₄ high-entropy tungstate orders antiferromagnetically with k = (½,0,0):
    // magnetic satellites sit at half-integer h, integer k,l.
    const awo4: UnitCell = { a: 4.6757, b: 5.701, c: 4.9367, alpha: 90, beta: 89.312, gamma: 90 };
    const d = (h: number, k: number, l: number): number => 1 / Math.sqrt(inverseDSquared(awo4, h, k, l));
    const observed = [
      d(0.5, 0, 0), d(0.5, 1, 0), d(0.5, 0, 1), d(0.5, 1, 1), d(1.5, 0, 0), d(0.5, 2, 0), d(0.5, 1, -1),
    ];
    const result = searchPropagationVector(awo4, observed, { tolerance: 0.01 });
    expect(result[0]!.k).toEqual([0.5, 0, 0]);
    expect(result[0]!.matched).toBe(observed.length);
    // The true k must beat the other two zone-boundary axes on matched count.
    const matchOf = (kx: number, ky: number, kz: number): number =>
      result.find((c) => c.k[0] === kx && c.k[1] === ky && c.k[2] === kz)?.matched ?? 0;
    expect(matchOf(0.5, 0, 0)).toBeGreaterThan(matchOf(0, 0.5, 0));
    expect(matchOf(0.5, 0, 0)).toBeGreaterThan(matchOf(0, 0, 0.5));
  });

  it("matches a large-d peak within a tolerance relative to d (a line's width in d grows with d)", () => {
    // Cr₂WO₆ at 4 K (trirutile, a 4.5778, c 8.8423 Å): k = 0 magnetic intensity on the
    // forbidden 0 0 1 and 1 0 2. The 0 0 1 apex sits 0.35 % (0.031 Å) long at 2θ = 16°.
    const cwo: UnitCell = { a: 4.5778, b: 4.5778, c: 8.8423, alpha: 90, beta: 90, gamma: 90 };
    const d = (h: number, k: number, l: number): number => 1 / Math.sqrt(inverseDSquared(cwo, h, k, l));
    const observed = [d(0, 0, 1) * 1.0035, d(1, 0, 2) * 1.0006];
    const absolute = searchPropagationVector(cwo, observed, { tolerance: 0.02, maxQ: 0 });
    expect(absolute.find((c) => c.k.every((v) => v === 0))!.matched).toBe(1);
    // Now k = 0 explains both, and leads: two peaks also fit complex k by chance,
    // as closely, and the simpler k ranks first among equal matches.
    const relative = searchPropagationVector(cwo, observed, { tolerance: 0.02, relativeTolerance: 0.005, maxQ: 0 });
    expect(relative[0]!.k).toEqual([0, 0, 0]);
    expect(relative[0]!.matched).toBe(2);
  });

  it("ignores high-Q peaks (magnetic scattering lives at low Q)", () => {
    const lowQ = [dOf(0, 0, 0.5), dOf(1, 0, 0.5)]; // large d, Q ≪ 6
    const highQd = 0.5; // d = 0.5 Å → Q = 2π/0.5 ≈ 12.6 Å⁻¹, above the default maxQ = 6
    const result = searchPropagationVector(ortho, [...lowQ, highQd], { tolerance: 0.005 });
    expect(result[0]!.total).toBe(2); // the high-Q peak is dropped before scoring
    expect(result[0]!.k).toEqual([0, 0, 0.5]);
    // Disabling the cut keeps all three.
    expect(searchPropagationVector(ortho, [...lowQ, highQd], { tolerance: 0.005, maxQ: 0 })[0]!.total).toBe(3);
  });
});

describe("k-search in a centred lattice", () => {
  // I4/mmm, a = 4, c = 10: the body centring forbids h + k + l odd.
  const cell = { a: 4, b: 4, c: 10, alpha: 90, beta: 90, gamma: 90 };
  const I: Vec3[] = [[0.5, 0.5, 0.5]];
  const d = (h: number, k: number, l: number): number => 1 / Math.sqrt(h * h / 16 + k * k / 16 + l * l / 100);

  it("does not explain centring-forbidden peaks with k = 0, and finds the vector that puts them there", () => {
    // Magnetic peaks at 1 0 0, 0 0 1 and 1 1 1: h + k + l odd, absent from the nuclear I lattice.
    const peaks = [d(1, 0, 0), d(0, 0, 1), d(1, 1, 1), d(2, 1, 0)];
    const plain = searchPropagationVector(cell, peaks);
    expect(plain[0]!.label).toBe("(0 0 0)"); // the primitive reading: the bug
    const centred = searchPropagationVector(cell, peaks, { centring: I });
    const gamma = centred.find((c) => c.label === "(0 0 0)");
    expect(gamma?.matched ?? 0).toBe(0);
    // k = (0 0 1) of the I lattice (the X/M point, ≡ (1 0 0)) explains them all.
    expect(centred[0]!.matched).toBe(4);
    expect(centred[0]!.label).toBe("(0 0 1)");
  });
});

describe("satellite positions", () => {
  it("lists G ± k with their labels, and k = 0 at the lattice points, absences included", async () => {
    const { satellitePositions } = await import("@/core/magnetic/kSearch");
    const cubic = { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 };
    const half = satellitePositions(cubic, [0.5, 0, 0], 1.5, 10);
    expect(half.filter((r) => Math.abs(r.d - 8) < 1e-9).map((r) => r.hkl)).toContain("0 0 0 + k");
    expect(half.some((r) => Math.abs(r.d - 4) < 1e-9)).toBe(false); // (1 0 0) itself is not a satellite of k = (½ 0 0)…
    expect(half.some((r) => Math.abs(r.d - 4 / Math.sqrt(1.25)) < 1e-9)).toBe(true); // …but (½ 1 0) is
    const gamma = satellitePositions(cubic, [0, 0, 0], 1.5, 10, [[0.5, 0.5, 0.5]]);
    expect(gamma.some((r) => r.hkl === "1 1 0")).toBe(true);
    expect(gamma.some((r) => r.hkl === "1 0 0")).toBe(false); // the I lattice has no 1 0 0
  });
});
