import { describe, it, expect } from "vitest";
import type { UnitCell } from "@/core/crystal/types";
import type { ExpandedAtom } from "@/core/diffraction/structureFactor";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { exampleStructure } from "@/examples/highEntropyWO4";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import {
  CompactPairs, colocatedGroups, enumeratePairs, pairArraySource, pairSourceFor, streamPairs,
  type PairSource, type PdfPair,
} from "@/core/pdf/pairEnumerator";
import { computeGofR, makeRGrid, type PdfModelParams } from "@/core/pdf/forwardModel";
import { computeGofRWithColumns, DUISO_DBISO, type PdfColumnRequest } from "@/core/pdf/gradients";

/**
 * The compact pair list (a translation per run, a small atom-pair code per
 * pair) and the stream recompute r, n̂ and the msd with enumeratePairs' own
 * expressions in its order, so every pair, and every sum over them, is
 * bit-identical to the object list.
 */

/** Every pair of a source, as objects. */
function collect(source: PairSource): PdfPair[] {
  const out: PdfPair[] = [];
  source.forEachChunk((c) => {
    for (let p = 0; p < c.length; p++) out.push({ rij: c.r[p]!, i: c.i[p]!, j: c.j[p]!, msd: c.msd[p]!, nx: c.nx[p]!, ny: c.ny[p]!, nz: c.nz[p]! });
  });
  return out;
}

function expectSamePairs(got: readonly PdfPair[], ref: readonly PdfPair[]): void {
  expect(got.length).toBe(ref.length);
  for (let p = 0; p < ref.length; p++) {
    const a = got[p]!;
    const b = ref[p]!;
    if (!(a.i === b.i && a.j === b.j && Object.is(a.rij, b.rij) && Object.is(a.msd, b.msd) && Object.is(a.nx, b.nx) && Object.is(a.ny, b.ny) && Object.is(a.nz, b.nz))) {
      throw new Error(`pair ${p} differs: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
}

function expectBitIdentical(got: ArrayLike<number>, ref: ArrayLike<number>): void {
  expect(got.length).toBe(ref.length);
  for (let k = 0; k < ref.length; k++) {
    if (!Object.is(got[k], ref[k])) throw new Error(`index ${k}: ${got[k]} vs ${ref[k]}`);
  }
}

function atom(element: string, position: readonly [number, number, number], adp: ExpandedAtom["adp"] = { kind: "isotropic", bIso: 0.5 }): ExpandedAtom {
  return { element, position, occupancy: 1, adp };
}

const HEX: UnitCell = { a: 3.2, b: 3.2, c: 5.1, alpha: 90, beta: 90, gamma: 120 };
const TRICLINIC: UnitCell = { a: 4.1, b: 5.3, c: 6.2, alpha: 78, beta: 101, gamma: 113 };
const ANISO = { kind: "anisotropic" as const, uAniso: [0.012, 0.008, 0.015, 0.002, -0.001, 0.003] as [number, number, number, number, number, number] };

const cases: { name: string; cell: UnitCell; atoms: readonly ExpandedAtom[]; rMax: number }[] = [
  { name: "hexagonal, two sites", cell: HEX, atoms: [atom("Ni", [1 / 3, 2 / 3, 0.25]), atom("O", [0.1, 0.2, 0.3], ANISO)], rMax: 14 },
  { name: "triclinic, anisotropic", cell: TRICLINIC, atoms: [atom("Fe", [0.1, 0.2, 0.3], ANISO), atom("O", [0.6, 0.1, 0.8]), atom("O", [0.35, 0.72, 0.05], ANISO)], rMax: 17 },
  { name: "GaTa₄Se₈ (anisotropic, 52 atoms)", cell: gata4se8PdfExample().structure.cell, atoms: expandStructureAtoms(gata4se8PdfExample().structure), rMax: 16 },
];

describe("compact and streamed pairs", () => {
  for (const c of cases) {
    it(`are enumeratePairs, bit for bit: ${c.name}`, () => {
      const ref = enumeratePairs(c.cell, c.atoms, c.rMax);
      expect(ref.length).toBeGreaterThan(1000);
      const compact = CompactPairs.build(c.cell, c.atoms, c.rMax);
      expect(compact.count).toBe(ref.length);
      expectSamePairs(collect(compact), ref);
      expectSamePairs(collect(streamPairs(c.cell, c.atoms, c.rMax)), ref);
      expectSamePairs(collect(pairArraySource(ref)), ref);
    });
  }

  it("are enumeratePairs over a mixed site's representatives, and hold about two bytes a pair", () => {
    const st = exampleStructure();
    const atoms = expandStructureAtoms(st);
    const groups = colocatedGroups(atoms)!;
    const ref = enumeratePairs(st.cell, atoms, 21, groups);
    const compact = CompactPairs.build(st.cell, atoms, 21, groups);
    expectSamePairs(collect(compact), ref);
    expectSamePairs(collect(streamPairs(st.cell, atoms, 21, groups)), ref);
    expect(compact.bytes / compact.count).toBeLessThan(2);
  });

  it("keep a shell's pairs in order: those in [rMin, rMax] and those below rAlways", () => {
    const st = exampleStructure();
    const atoms = expandStructureAtoms(st);
    const groups = colocatedGroups(atoms)!;
    const ref = enumeratePairs(st.cell, atoms, 24, groups).filter((p) => (p.rij >= 11 && p.rij <= 17) || p.rij < 3);
    const shell = { rMin: 11, rMax: 17, rAlways: 3 };
    expect(ref.length).toBeLessThan(0.5 * enumeratePairs(st.cell, atoms, 24, groups).length);
    expectSamePairs(collect(CompactPairs.build(st.cell, atoms, 24, groups, shell)), ref);
    expectSamePairs(collect(streamPairs(st.cell, atoms, 24, groups, shell)), ref);
  });

  it("stream beyond the storage budget, with the same pairs", () => {
    const st = exampleStructure();
    const atoms = expandStructureAtoms(st);
    const ref = enumeratePairs(st.cell, atoms, 12);
    const streamed = pairSourceFor(st.cell, atoms, 12, null, undefined, 1);
    expect(streamed).not.toBeInstanceOf(CompactPairs);
    expect(pairSourceFor(st.cell, atoms, 12)).toBeInstanceOf(CompactPairs);
    expectSamePairs(collect(streamed), ref);
  });
});

describe("G(r) and its columns over any pair source", () => {
  const ex = gata4se8PdfExample();
  const atoms = expandStructureAtoms(ex.structure);
  const cell = ex.structure.cell;
  const grid = makeRGrid(0.5, 15, 0.01);
  const params: PdfModelParams = { scatteringType: "xray", scale: 0.9, qdamp: 0.04, qbroad: 0.02, delta1: 0.9, delta2: 1.6, spdiameter: 60 };
  const objects = enumeratePairs(cell, atoms, 16);
  const compact = CompactPairs.build(cell, atoms, 16);
  const stream = streamPairs(cell, atoms, 16);

  it("computeGofR is bit-identical on objects, the compact list, the stream and none given", () => {
    const ref = computeGofR(cell, atoms, grid, params, objects);
    expectBitIdentical(computeGofR(cell, atoms, grid, params, compact), ref);
    expectBitIdentical(computeGofR(cell, atoms, grid, params, stream), ref);
    expectBitIdentical(computeGofR(cell, atoms, grid, params), ref);
  });

  it("the fused pass is bit-identical on each, value and every column kind", () => {
    const n = atoms.length;
    const onSite = (from: number, to: number): Float64Array => {
      const d = new Float64Array(n);
      for (let a = from; a < to; a++) d[a] = 1;
      return d;
    };
    const requests: PdfColumnRequest[] = [
      { kind: "qdamp" },
      { kind: "spdiameter" },
      { kind: "sigma", target: "delta1" },
      { kind: "sigma", target: "delta2" },
      { kind: "sigma", target: "qbroad" },
      { kind: "occupancy", dOcc: onSite(0, 4) },
      { kind: "msd", constant: Float64Array.from(onSite(4, 20), (v) => v * DUISO_DBISO), tensors: atoms.map(() => null) },
      { kind: "position", velocity: atoms.map((_, a) => (a < 16 ? [0.1, -0.2, 0.05] as [number, number, number] : null)) },
    ];
    const ref = computeGofRWithColumns(cell, atoms, grid, params, objects, requests);
    for (const src of [compact, stream]) {
      const got = computeGofRWithColumns(cell, atoms, grid, params, src, requests);
      expectBitIdentical(got.g, ref.g);
      got.columns.forEach((col, c) => expectBitIdentical(col, ref.columns[c]!));
    }
  });
});
