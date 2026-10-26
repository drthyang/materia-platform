/**
 * The isotropy subgroups of Γ irreps (isotropySubgroups.ts) against the known
 * lists (Stokes & Hatch 1988; the ISOTROPY suite): every order-parameter
 * direction of a multidimensional irrep, the epikernels off the axes
 * included, each with a field whose stabilizer is exactly it; and the order
 * parameter that lowers a structure to a subgroup picked from the lattice.
 */
import { describe, it, expect } from "vitest";
import type { AtomSite, StructureModel, UnitCell } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { decomposeDisplacementRepresentation, type DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import { stabilizerOfField } from "@/core/crystal/isotropyTree";
import { irrepIsotropySubgroups, subgroupOrderParameter, type IsotropySubgroup } from "@/core/crystal/isotropySubgroups";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";

const iso = { kind: "isotropic", bIso: 0.5 } as const;
const site = (label: string, position: [number, number, number]): AtomSite => ({ label, element: label.replace(/\d+$/, ""), position, occupancy: 1, adp: iso });
const cubic = (a: number): UnitCell => ({ a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 });
const structure = (sg: number | string, cell: UnitCell, sites: AtomSite[]): StructureModel => ({ id: "t", name: "t", cell, spaceGroup: buildSpaceGroup(sg), sites });

const BATIO3 = structure(221, cubic(4), [site("Ba", [0, 0, 0]), site("Ti", [0.5, 0.5, 0.5]), site("O", [0, 0.5, 0.5])]);
const CAF2 = structure(225, cubic(5.46), [site("Ca", [0, 0, 0]), site("F", [0.25, 0.25, 0.25])]);
const ZNS = structure(216, cubic(5.41), [site("Zn", [0, 0, 0]), site("S", [0.25, 0.25, 0.25])]);
const P4MMM = structure(123, { a: 3.9, b: 3.9, c: 4.1, alpha: 90, beta: 90, gamma: 90 }, [site("Sr", [0, 0, 0]), site("Ti", [0.5, 0.5, 0.5]), site("O", [0, 0.5, 0.5])]);
const I4MMM = structure(139, { a: 3.8, b: 3.8, c: 13.2, alpha: 90, beta: 90, gamma: 90 }, [site("La", [0, 0, 0]), site("O", [0, 0, 0.35])]);
const GATA4SE8 = gata4se8PdfExample().structure;
const R3M = structure("R -3 m:H", { a: 4.4, b: 4.4, c: 30.5, alpha: 90, beta: 90, gamma: 120 }, [site("Bi", [0, 0, 0]), site("Te", [0, 0, 0.4])]);

/** The irreps of a structure that carry an optic mode, with their isotropy subgroups (computed once per structure). */
const computed = new Map<StructureModel, { term: DisplaciveIrrepTerm; subs: IsotropySubgroup[] }[]>();
function branches(s: StructureModel): { term: DisplaciveIrrepTerm; subs: IsotropySubgroup[] }[] {
  let out = computed.get(s);
  if (!out) {
    out = decomposeDisplacementRepresentation(s).terms
      .filter((t) => !t.trivial && t.multiplicity - t.acoustic > 0)
      .map((term) => ({ term, subs: irrepIsotropySubgroups(s, term) }));
    computed.set(s, out);
  }
  return out;
}

/** The branch whose isotropy subgroups include the IT number given. */
const branchWith = (s: StructureModel, n: number) => branches(s).find(({ subs }) => subs.some((x) => x.identity.number === n))!;

/** [IT number, order-parameter dimension, conjugates, domain states] per isotropy subgroup, in the listed order. */
const rows = (subs: readonly IsotropySubgroup[]) => subs.map((x) => [x.identity.number, x.orderParameterDim, x.conjugates, x.domainStates]);

function expectExactFields(s: StructureModel, subs: readonly IsotropySubgroup[]): void {
  for (const x of subs) {
    expect(x.field, `${x.identity.hermannMauguin}`).not.toBeNull();
    expect(stabilizerOfField(x.field!, s.spaceGroup.operations), `${x.identity.hermannMauguin}`).toHaveLength(x.operations.length);
    expect(x.domainStates % x.conjugates).toBe(0);
  }
  expect(subs.filter((x) => x.kernel)).toHaveLength(1);
  expect(subs[subs.length - 1]!.kernel).toBe(true);
}

describe("cubic perovskite Pm-3m (BaTiO₃): the polar T1u (Γ4⁻) and the silent T2u (Γ5⁻)", () => {
  it("T1u is the vector representation: χ(g) = tr R(g), multiplicity 4 with one acoustic copy", () => {
    const { term } = branchWith(BATIO3, 99);
    const ops = BATIO3.spaceGroup.operations;
    ops.forEach((op, i) => expect(term.irrep.characters[i]!.re).toBeCloseTo(op.rotation[0][0] + op.rotation[1][1] + op.rotation[2][2], 9));
    expect([term.multiplicity, term.acoustic]).toEqual([4, 1]);
  });

  it("T1u: P4mm (a,0,0), R3m (a,a,a), Amm2 (a,a,0) — then Pm (a,b,0), Cm (a,a,b) and P1, the kernel", () => {
    const { subs } = branchWith(BATIO3, 99);
    expect(rows(subs)).toEqual([[99, 1, 3, 6], [160, 1, 4, 8], [38, 1, 6, 12], [6, 2, 3, 24], [8, 2, 6, 24], [1, 3, 1, 48]]);
    expectExactFields(BATIO3, subs);
    // The rhombohedral one is named on hexagonal axes, the orthorhombic one in its A-centred cell.
    expect(subs[1]!.identity.hermannMauguin).toBe("R 3 m:H");
    expect(subs[2]!.identity).toMatchObject({ hermannMauguin: "A m m 2", method: "conventional-cell" });
  });

  it("T2u: P-4m2 (a,0,0), R32 (a,a,a), Amm2 (a,a,0) — then C2, Pm and P1", () => {
    const { term, subs } = branchWith(BATIO3, 115);
    expect([term.multiplicity, term.acoustic]).toEqual([1, 0]);
    expect(rows(subs)).toEqual([[115, 1, 3, 6], [155, 1, 4, 8], [38, 1, 6, 12], [5, 2, 6, 24], [6, 2, 3, 24], [1, 3, 1, 48]]);
    expectExactFields(BATIO3, subs);
  });
});

describe("fluorite Fm-3m (CaF₂): centred, a Raman T2g and the polar T1u", () => {
  it("T2g (Γ5⁺): R-3m, Immm, C2/m and P-1", () => {
    const { term, subs } = branchWith(CAF2, 166);
    // Even under inversion (χ(-1) = χ(E) = 3): a Raman mode, only F 8c moves.
    const inversion = CAF2.spaceGroup.operations.findIndex((op) => op.rotation.every((row, i) => row.every((v, j) => v === (i === j ? -1 : 0))) && op.translation.every((t) => t === 0));
    expect(term.irrep.characters[inversion]!.re).toBeCloseTo(3, 9);
    expect(rows(subs)).toEqual([[166, 1, 4, 4], [71, 1, 3, 6], [12, 2, 6, 12], [2, 3, 1, 24]]);
    expectExactFields(CAF2, subs);
  });

  it("T1u (Γ4⁻): I4mm, R3m, Imm2 — then the two Cm directions and P1", () => {
    const { subs } = branchWith(CAF2, 107);
    expect(rows(subs)).toEqual([[107, 1, 3, 6], [160, 1, 4, 8], [44, 1, 6, 12], [8, 2, 3, 24], [8, 2, 6, 24], [1, 3, 1, 48]]);
    expectExactFields(CAF2, subs);
    // Each keeps the four F translations.
    for (const x of subs) expect(x.operations.length % 4).toBe(0);
  });
});

describe("zincblende F-43m (ZnS) and the GaTa₄Se₈ demo (F-43m)", () => {
  it("ZnS's T2: R3m (a,a,a), Imm2 (a,0,0), Cm and P1", () => {
    const { term, subs } = branchWith(ZNS, 160);
    expect([term.multiplicity, term.acoustic]).toEqual([2, 1]);
    expect(rows(subs)).toEqual([[160, 1, 4, 4], [44, 1, 3, 6], [8, 2, 6, 12], [1, 3, 1, 24]]);
    expectExactFields(ZNS, subs);
  });

  it("GaTa₄Se₈: E → I-4m2 and the kernel F222; T1 → I-4, R3, Cm, P1; T2 → R3m, Imm2, Cm, P1", () => {
    const s = GATA4SE8;
    const all = branches(s).map(({ subs }) => rows(subs));
    expect(all).toEqual([
      [[119, 1, 3, 3], [22, 2, 1, 6]],
      [[82, 1, 3, 6], [146, 1, 4, 8], [8, 1, 6, 12], [1, 3, 1, 24]],
      [[160, 1, 4, 4], [44, 1, 3, 6], [8, 2, 6, 12], [1, 3, 1, 24]],
    ]);
    for (const { subs } of branches(s)) expectExactFields(s, subs);
  });
});

describe("tetragonal, I-centred and rhombohedral parents", () => {
  it("P4/mmm's in-plane polar Eu: Pmm2 (a,0), Amm2 (a,a) and the kernel Pm", () => {
    const { term, subs } = branchWith(P4MMM, 25);
    expect(term.irrep.dim).toBe(2);
    expect(rows(subs)).toEqual([[25, 1, 2, 4], [38, 1, 2, 4], [6, 2, 1, 8]]);
    expectExactFields(P4MMM, subs);
  });

  it("I4/mmm's Eu: Fmm2 (a,a), Imm2 (a,0) and Cm; its Eg: two C2/m directions and P-1", () => {
    expect(rows(branchWith(I4MMM, 42).subs)).toEqual([[42, 1, 2, 4], [44, 1, 2, 4], [8, 2, 1, 8]]);
    expect(rows(branchWith(I4MMM, 12).subs)).toEqual([[12, 1, 2, 4], [12, 1, 2, 4], [2, 2, 1, 8]]);
    for (const { subs } of branches(I4MMM)) expectExactFields(I4MMM, subs);
  });

  it("R-3m's Eu: C2, Cm and P1; its Eg: C2/m and P-1 — the R translations kept", () => {
    expect(rows(branchWith(R3M, 5).subs)).toEqual([[5, 1, 3, 6], [8, 1, 3, 6], [1, 2, 1, 12]]);
    expect(rows(branchWith(R3M, 12).subs)).toEqual([[12, 1, 3, 3], [2, 2, 1, 6]]);
    for (const { subs } of branches(R3M)) {
      expectExactFields(R3M, subs);
      for (const x of subs) expect(x.operations.length % 3).toBe(0);
    }
  });
});

describe("the order parameter for a subgroup picked from the lattice", () => {
  const node = (s: StructureModel, n: number) => structuralSubgroupLattice(s).nodes.find((x) => x.identity.number === n && x.classRepresentative)!;

  it("lowers BaTiO₃ to P4mm with the polar T1u, and to P-4m2 with the silent T2u", () => {
    const p4mm = node(BATIO3, 99);
    const op = subgroupOrderParameter(BATIO3, p4mm.operations)!;
    expect(op.irreps).toEqual([branchWith(BATIO3, 99).term.irrep.label]);
    expect(op.reachesTarget).toBe(true);
    expect(stabilizerOfField(op.field, BATIO3.spaceGroup.operations)).toHaveLength(p4mm.operations.length);
    expect(subgroupOrderParameter(BATIO3, node(BATIO3, 115).operations)!.irreps).toEqual([branchWith(BATIO3, 115).term.irrep.label]);
  });

  it("has none for a subgroup no displacement reaches (BaTiO₃'s Pm-3, NaCl's I4/mmm: a metric change only)", () => {
    expect(subgroupOrderParameter(BATIO3, node(BATIO3, 200).operations)).toBeNull();
    const nacl = structure(225, cubic(5.64), [site("Na", [0, 0, 0]), site("Cl", [0.5, 0.5, 0.5])]);
    expect(subgroupOrderParameter(nacl, node(nacl, 139).operations)).toBeNull();
    expect(subgroupOrderParameter(nacl, node(nacl, 107).operations)!.reachesTarget).toBe(true); // I4mm: the polar T1u
  });

  it("couples two irreps when no single one reaches the subgroup (GaTa₄Se₈ → C2), and says when the displacements keep more", () => {
    const s = GATA4SE8;
    const c2 = node(s, 5);
    const op = subgroupOrderParameter(s, c2.operations)!;
    expect(op.irreps).toHaveLength(2);
    expect(op.reachesTarget).toBe(true);
    expect(stabilizerOfField(op.field, s.spaceGroup.operations)).toHaveLength(c2.operations.length);
    // ZnS's displacements fixed by R3 are fixed by R3m too: its field keeps R3m.
    const r3 = subgroupOrderParameter(ZNS, node(ZNS, 146).operations)!;
    expect(r3.reachesTarget).toBe(false);
    expect(stabilizerOfField(r3.field, ZNS.spaceGroup.operations)).toHaveLength(node(ZNS, 160).operations.length);
  });
});
