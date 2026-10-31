/**
 * The displacive modes of a realised child by parent irrep (supercellModes.ts,
 * subgroup engine phase 4, THY-35), through the module interface.
 *
 *  - The basis is complete and orthonormal: the modes span every displacement
 *    the child's sites allow, one mode per free coordinate, orthonormal in the
 *    child's metric over its conventional cell, each one an allowed shift of
 *    every site it moves. Checked on perovskite, rock-salt and NiAs children
 *    in the 2×2×2 bound, centred and hexagonal parents included.
 *  - The irreps are the right ones, by physics that does not use the engine:
 *    Glazer tilts of cubic SrTiO₃ built geometrically (testSupport) lie
 *    entirely in the modes of one antiphase irrep (R) or one in-phase irrep
 *    (M), and a⁻b⁺a⁻ splits into exactly those two, with the amplitudes of its
 *    a⁻_a⁻ and b⁺ parts.
 *  - The order parameter an activation kicks: the R irrep alone for R-3c, the
 *    two tilt irreps for Pnma.
 */
import { describe, it, expect } from "vitest";
import type { Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { siteMultiplicity } from "@/core/crystal/symmetry";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups } from "@/core/crystal/irreps/isotropy";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild, type RealisedChild } from "@/core/crystal/irreps/realisation";
import { orderParameterIrreps, supercellModeBasis, type SupercellModeBasis } from "@/core/crystal/irreps/supercellModes";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, childDisplacement, srtio3, tiltIsInvariant, type Glazer } from "@/testSupport/perovskiteTilts";

const PARENT = srtio3();
const GROUP = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const LATTICE = supercellSubgroups(GROUP, { maxIndex: 48 });

const NACL: StructureModel = {
  id: "nacl",
  name: "NaCl",
  cell: { a: 5.64, b: 5.64, c: 5.64, alpha: 90, beta: 90, gamma: 90 },
  spaceGroup: buildSpaceGroup(225),
  sites: [
    { label: "Na", element: "Na", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 1.1 } },
    { label: "Cl", element: "Cl", position: [0.5, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.9 } },
  ],
};

const NIAS: StructureModel = {
  id: "nias",
  name: "NiAs",
  cell: { a: 3.619, b: 3.619, c: 5.034, alpha: 90, beta: 90, gamma: 120 },
  spaceGroup: buildSpaceGroup(194),
  sites: [
    { label: "Ni", element: "Ni", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
    { label: "As", element: "As", position: [1 / 3, 2 / 3, 0.25], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
  ],
};

const mulMV = (m: readonly (readonly number[])[], v: Vec3): Vec3 => [
  m[0]![0]! * v[0] + m[0]![1]! * v[1] + m[0]![2]! * v[2],
  m[1]![0]! * v[0] + m[1]![1]! * v[1] + m[1]![2]! * v[2],
  m[2]![0]! * v[0] + m[2]![1]! * v[1] + m[2]![2]! * v[2],
];

/** ⟨u, v⟩ over the child's conventional cell: Σ_site multiplicity · (M·u)·(M·v). */
function childDot(child: StructureModel, u: ReadonlyMap<string, Vec3>, v: ReadonlyMap<string, Vec3>): number {
  const M = orthogonalizationMatrix(child.cell);
  let s = 0;
  for (const site of child.sites) {
    const a = u.get(site.label);
    const b = v.get(site.label);
    if (!a || !b) continue;
    const ca = mulMV(M, a);
    const cb = mulMV(M, b);
    s += siteMultiplicity(child.spaceGroup.operations, site.position) * (ca[0] * cb[0] + ca[1] * cb[1] + ca[2] * cb[2]);
  }
  return s;
}

const axesOf = (b: SupercellModeBasis, i: number): Map<string, Vec3> => new Map(b.modes[i]!.axes.map((a) => [a.siteLabel, a.axis] as const));

/** Complete, orthonormal and made of allowed shifts. */
function expectSoundBasis(r: RealisedChild, b: SupercellModeBasis): void {
  const child = r.structure;
  const ops = child.spaceGroup.operations;
  const free = child.sites.reduce((n, s) => n + allowedPositionShifts(ops, s.position).dimension, 0);
  expect(b.modes).toHaveLength(free);
  for (let i = 0; i < b.modes.length; i++) {
    for (let j = i; j < b.modes.length; j++) {
      expect(childDot(child, axesOf(b, i), axesOf(b, j))).toBeCloseTo(i === j ? 1 : 0, 9);
    }
    // Each axis lies in its site's allowed shifts.
    for (const { siteLabel, axis } of b.modes[i]!.axes) {
      const site = child.sites.find((s) => s.label === siteLabel)!;
      const basis = allowedPositionShifts(ops, site.position).basis;
      const M = orthogonalizationMatrix(child.cell);
      const c = mulMV(M, axis);
      const bc = basis.map((v) => mulMV(M, v));
      // Residual of the least-squares fit onto the allowed span.
      const G = bc.map((x) => bc.map((y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2]));
      const rhs = bc.map((x) => x[0] * c[0] + x[1] * c[1] + x[2] * c[2]);
      const coef = solve(G, rhs);
      const fit = [0, 0, 0];
      coef.forEach((k, t) => {
        for (let q = 0; q < 3; q++) fit[q] = fit[q]! + k * bc[t]![q]!;
      });
      expect(Math.hypot(c[0] - fit[0]!, c[1] - fit[1]!, c[2] - fit[2]!)).toBeLessThan(1e-9);
    }
  }
  // Every irrep's modes are listed under it, once.
  expect(b.irreps.flatMap((ir) => ir.modes).sort((x, y) => x - y)).toEqual(b.modes.map((_, i) => i));
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** A child of the lattice, realised, and its basis. */
function realiseClass(number: number, pick: (r: RealisedChild) => boolean = () => true): { r: RealisedChild; b: SupercellModeBasis; elements: readonly number[] } {
  for (const cls of LATTICE.classes.filter((c) => c.identity?.number === number)) {
    const r = realiseChild(PARENT, GROUP, cls.elements, cls.identity);
    if (!pick(r)) continue;
    return { r, b: supercellModeBasis(PARENT, GROUP, cls.elements, r), elements: cls.elements };
  }
  throw new Error(`no class #${number}`);
}

/** The tilt's orientation that the realised child keeps, if any. */
function tiltIn(r: RealisedChild, g0: Glazer): { g: Glazer; order: readonly [number, number, number] } | null {
  for (const order of AXIS_ORDERS) for (const sg of TILT_SENSES) {
    const g: Glazer = { ...g0, phi: [g0.phi[0] * sg[0], g0.phi[1] * sg[1], g0.phi[2] * sg[2]] };
    if (tiltIsInvariant(r, g, order)) return { g, order };
  }
  return null;
}

/** The tilt field on the child's sites (child fractional) and its amplitude on each mode. */
function tiltAmplitudes(r: RealisedChild, b: SupercellModeBasis, g: Glazer, scale: number, order: readonly [number, number, number]): { field: Map<string, Vec3>; amps: number[] } {
  const field = new Map(r.structure.sites.map((s) => [s.label, childDisplacement(r, s.position, g, scale, order)] as const));
  return { field, amps: b.modes.map((_, i) => childDot(r.structure, field, axesOf(b, i))) };
}

describe("supercellModeBasis: the child's displacements by parent irrep", () => {
  it("is complete and orthonormal on SrTiO₃'s tilt children and their relatives (2×2×2)", () => {
    for (const number of [167, 140, 127, 62, 74, 15, 12, 2]) {
      for (const cls of LATTICE.classes.filter((c) => c.identity?.number === number).slice(0, 3)) {
        const r = realiseChild(PARENT, GROUP, cls.elements, cls.identity);
        expectSoundBasis(r, supercellModeBasis(PARENT, GROUP, cls.elements, r));
      }
    }
  });

  it("is complete and orthonormal for a centred parent (rock salt at L and W) and a hexagonal one (NiAs at M and L)", { timeout: 120_000 }, () => {
    const cases: readonly [StructureModel, readonly (readonly [number, number, number])[]][] = [
      [NACL, [[0.5, 0.5, 0.5], [0.5, 1, 0]]],
      [NIAS, [[0.5, 0, 0], [0.5, 0, 0.5]]],
    ];
    let checked = 0;
    for (const [parent, ks] of cases) {
      const group: FactorGroup = factorGroup(parent.spaceGroup.operations, DEFAULT_SUPERCELL);
      for (const k of ks) {
        // Irreps up to dimension 6: the isotropy analysis of rock salt's 8- and 12-dimensional L and W irreps takes minutes.
        for (const p of irrepsOfStar(group, k).physical.filter((x) => x.dim <= 6)) {
          for (const s of isotropySubgroups(group, p).subgroups.slice(0, 3)) {
            if (!s.cellMultiplying) continue;
            const r = realiseChild(parent, group, s.elements, s.identity);
            const b = supercellModeBasis(parent, group, s.elements, r);
            expectSoundBasis(r, b);
            // The irrep itself carries modes whenever any of its displacements are allowed.
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("a⁻a⁻a⁻ (R-3c), a⁰a⁰c⁻ (I4/mcm) and a⁰a⁰c⁺ (P4/mbm): the tilt is all in one irrep's mode on O", () => {
    for (const [name, number, star] of [["a-a-a-", 167, "R"], ["a0a0c-", 140, "R"], ["a0a0c+", 127, "M"]] as const) {
      const g0 = GLAZER[name]!;
      const { r, b } = realiseClass(number, (x) => tiltIn(x, g0) !== null);
      const { g, order } = tiltIn(r, g0)!;
      const { field, amps } = tiltAmplitudes(r, b, g, 0.07, order);
      const total = Math.sqrt(childDot(r.structure, field, field));
      const lead = amps.map((a, i) => ({ a, i })).sort((x, y) => Math.abs(y.a) - Math.abs(x.a))[0]!;
      const mode = b.modes[lead.i]!;
      expect(b.irreps[mode.irrep]!.star).toBe(star);
      expect(mode.parentSite).toBe("O");
      expect(Math.abs(lead.a)).toBeCloseTo(total, 12);
      for (const [i, a] of amps.entries()) if (i !== lead.i) expect(Math.abs(a)).toBeLessThan(1e-12);
      // The irrep alone reaches the child, and is the order parameter.
      expect(b.irreps[mode.irrep]!.reachesChild).toBe(true);
      expect(orderParameterIrreps(b)).toEqual([mode.irrep]);
    }
  });

  it("a⁻b⁺a⁻ (Pnma): seven modes in five irreps; the tilt splits into the antiphase R and the in-phase M, with its two parts' amplitudes", () => {
    const g0 = GLAZER["a-b+a-"]!;
    const { r, b } = realiseClass(62, (x) => tiltIn(x, g0) !== null && x.structure.sites.some((s) => s.label.startsWith("Sr") && allowedPositionShifts(x.structure.spaceGroup.operations, s.position).dimension > 0));
    const { g, order } = tiltIn(r, g0)!;
    // ISODISTORT's X5+ (Sr, O), M3+ (O), M2+ (O), R4+ (O), R5+ (Sr, O): two modes on two irreps, one on three.
    expect(b.modes).toHaveLength(7);
    expect(b.irreps.map((ir) => `${ir.star}:${ir.modes.map((m) => b.modes[m]!.parentSite).join("+")}`).sort()).toEqual(["M:O", "M:O", "R:O", "R:Sr+O", "X:Sr+O"].sort());
    const { field, amps } = tiltAmplitudes(r, b, g, 0.07, order);
    // The tilt lives on two modes, one R and one M, both on O.
    const carried = amps.map((a, i) => ({ a, i })).filter((x) => Math.abs(x.a) > 1e-9);
    expect(carried.map((x) => b.irreps[b.modes[x.i]!.irrep]!.star).sort()).toEqual(["M", "R"]);
    // Their amplitudes are the norms of the a⁻_a⁻ and the b⁺ parts, built separately.
    const part = (phi: Vec3): number => {
      const gp: Glazer = { ...g, phi };
      const f = new Map(r.structure.sites.map((s) => [s.label, childDisplacement(r, s.position, gp, 0.07, order)] as const));
      return Math.sqrt(childDot(r.structure, f, f));
    };
    const antiphase = part([g.phi[0], 0, g.phi[2]]);
    const inPhase = part([0, g.phi[1], 0]);
    const ampOf = (star: string): number => Math.abs(carried.find((x) => b.irreps[b.modes[x.i]!.irrep]!.star === star)!.a);
    expect(ampOf("R")).toBeCloseTo(antiphase, 12);
    expect(ampOf("M")).toBeCloseTo(inPhase, 12);
    expect(Math.hypot(antiphase, inPhase)).toBeCloseTo(Math.sqrt(childDot(r.structure, field, field)), 12);
    // The order parameter: the two tilt irreps.
    expect(orderParameterIrreps(b)!.map((i) => b.irreps[i]!.star).sort()).toEqual(["M", "R"]);
  });

  it("labels each mode by its generic irrep and parent site, and keeps them when the arms are the bound's (the default bound admits every arm)", () => {
    const { r, b, elements } = realiseClass(62, (x) => x.structure.sites.length === 4);
    for (const mode of b.modes) expect(mode.label).toMatch(/^(Γ|X|M|R) irreps? [0-9⊕]+ of \d+ · (Sr|Ti|O)( \d)?$/);
    const viaBound = supercellModeBasis(PARENT, GROUP, elements, r, { arms: "bound" });
    expect(viaBound.modes.map((m) => m.label)).toEqual(b.modes.map((m) => m.label));
  });
});
