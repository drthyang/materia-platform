import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { canonicalKey, laueRotations } from "@/core/diffraction/merge";
import { latticeRotations, lawIndices, merohedralTwinLaws, type TwinLawRow } from "@/core/diagnostics/twinLaws";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseShelxIns } from "@/parsers/shelxIns";
import { loadReflectionDataset } from "@/app/loadData";
import type { Mat3 } from "@/core/math/types";

const hexagonal = { a: 12.75, b: 12.75, c: 27.6, alpha: 90, beta: 90, gamma: 120 };

/** A seeded uniform deviate (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One reflection per Laue class of P3₂ (−3), Wilson-distributed, twinned by `law` at fraction α. */
function trigonal(alpha: number, law: Mat3, seed = 7): TwinLawRow[] {
  const sg = buildSpaceGroup(145);
  const laue = laueRotations(sg.operations);
  const random = rng(seed);
  const truth = new Map<string, number>();
  for (let h = -8; h <= 8; h++) for (let k = -8; k <= 8; k++) for (let l = -12; l <= 12; l++) {
    if (h === 0 && k === 0 && l === 0) continue;
    const key = canonicalKey(laue, h, k, l);
    if (!truth.has(key)) truth.set(key, -Math.log(1 - random()) * 1000);
  }
  const rows: TwinLawRow[] = [];
  for (const [key, i] of truth) {
    const [h, k, l] = key.split(",").map(Number) as [number, number, number];
    const t = law.map((row) => row[0]! * h + row[1]! * k + row[2]! * l) as [number, number, number];
    const partner = truth.get(canonicalKey(laue, ...t));
    if (partner === undefined) continue;
    const obs = (1 - alpha) * i + alpha * partner;
    rows.push({ h, k, l, intensity: obs, sigma: 1 });
  }
  return rows;
}

describe("the lattice's merohedral twin laws", () => {
  it("finds the lattice's rotations from its metric: 622 for a hexagonal cell, 422, 432, 222, 2 and 1", () => {
    expect(latticeRotations(hexagonal)).toHaveLength(12);
    expect(latticeRotations({ a: 7, b: 7, c: 9, alpha: 90, beta: 90, gamma: 90 })).toHaveLength(8);
    expect(latticeRotations({ a: 7, b: 7, c: 7, alpha: 90, beta: 90, gamma: 90 })).toHaveLength(24);
    expect(latticeRotations({ a: 7, b: 8, c: 9, alpha: 90, beta: 90, gamma: 90 })).toHaveLength(4);
    expect(latticeRotations({ a: 7, b: 8, c: 9, alpha: 90, beta: 101, gamma: 90 })).toHaveLength(2);
    expect(latticeRotations({ a: 7, b: 8, c: 9, alpha: 80, beta: 101, gamma: 95 })).toHaveLength(1);
    expect(lawIndices([[0, 1, 0], [1, 0, 0], [0, 0, -1]])).toBe("h, k, l → k, h, −l");
    expect(lawIndices([[-1, -1, 0], [1, 0, 0], [0, 0, 1]])).toBe("h, k, l → −h−k, h, l");
  });

  it("offers each coset of the Laue class once, as its simplest rotation, and none where the lattice holds no more", () => {
    // −3 in 6/mmm: three laws (the 2-fold along c, and the two kinds of 2-fold in the plane).
    const laws = merohedralTwinLaws(trigonal(0, [[0, 1, 0], [1, 0, 0], [0, 0, -1]]), hexagonal, buildSpaceGroup(145));
    expect(laws).toHaveLength(3);
    expect(laws.map((l) => l.indices).sort()).toEqual(["h, k, l → −h, −k, l", "h, k, l → −k, −h, −l", "h, k, l → k, h, −l"].sort());
    // P6₁ (6/m): one law. P2₁2₁2₁ in an orthorhombic cell: none.
    expect(merohedralTwinLaws(trigonal(0, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]), hexagonal, buildSpaceGroup(169)).map((l) => l.indices)).toEqual(["h, k, l → k, h, −l"]);
    expect(merohedralTwinLaws(trigonal(0, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]), { a: 7, b: 8, c: 9, alpha: 90, beta: 90, gamma: 90 }, buildSpaceGroup(19))).toEqual([]);
  });

  it("reads no twin from an untwinned crystal, and the fraction of a twinned one by its own law (Yeates' H-test)", () => {
    const law: Mat3 = [[0, 1, 0], [1, 0, 0], [0, 0, -1]];
    const none = merohedralTwinLaws(trigonal(0, law), hexagonal, buildSpaceGroup(145));
    for (const l of none) expect(l.alpha).toBeLessThan(0.04);
    const twinned = merohedralTwinLaws(trigonal(0.3, law), hexagonal, buildSpaceGroup(145));
    expect(twinned[0]!.matrix).toEqual(law);
    expect(twinned[0]!.alpha).toBeGreaterThan(0.26);
    expect(twinned[0]!.alpha).toBeLessThan(0.34);
    expect(twinned[0]!.pairs).toBeGreaterThan(500);
  });
});

describe.skipIf(!dataExists("GSAS-II-tutorials/sc/2b.hkl") || !dataExists("GSAS-II-tutorials/sc/3a.fcf"))("the twin laws in real data", () => {
  it("finds 2b's near-perfect twin by k, h, −l, and 3a's by the same law at about a third", () => {
    const two = parseShelxIns(readFileSync(dataPath("GSAS-II-tutorials/sc/2b.ins"), "utf8"), "2b");
    const twoData = loadReflectionDataset(readFileSync(dataPath("GSAS-II-tutorials/sc/2b.hkl"), "utf8"), two.structure, "2b-hkl", "2b.hkl", { wavelength: two.instructions.wavelength }).dataset;
    const rows = (d: typeof twoData): TwinLawRow[] => d.reflections.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.iObs, sigma: r.sigma ?? 0 }));
    const laws2b = merohedralTwinLaws(rows(twoData), two.structure.cell, two.structure.spaceGroup);
    expect(laws2b).toHaveLength(3);
    // SHELXL's TWIN 0 1 0 1 0 0 0 0 −1, BASF 0.4966.
    expect(laws2b[0]!.matrix).toEqual([[0, 1, 0], [1, 0, 0], [0, 0, -1]]);
    expect(laws2b[0]!.alpha).toBeGreaterThan(0.43);
    // The other two read what a perfect twin by the first leaves them, about ⅛, with pseudo-symmetry on top.
    for (const l of laws2b.slice(1)) expect(l.alpha).toBeLessThan(0.25);

    const three = parseShelxIns(readFileSync(dataPath("GSAS-II-tutorials/sc/3a.ins"), "utf8"), "3a");
    const threeData = loadReflectionDataset(readFileSync(dataPath("GSAS-II-tutorials/sc/3a.fcf"), "utf8"), three.structure, "3a-hkl", "3a.fcf", { wavelength: three.instructions.wavelength }).dataset;
    const laws3a = merohedralTwinLaws(rows(threeData), three.structure.cell, three.structure.spaceGroup);
    expect(laws3a.map((l) => l.matrix)).toEqual([[[0, 1, 0], [1, 0, 0], [0, 0, -1]]]);
    // SHELXL's BASF 0.34068.
    expect(laws3a[0]!.alpha).toBeGreaterThan(0.28);
    expect(laws3a[0]!.alpha).toBeLessThan(0.4);
  });
});
