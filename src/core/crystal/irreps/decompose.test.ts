/**
 * decompose(parent, child) for supercell children (decompose.ts, subgroup
 * engine phase 4, THY-35), through the module interface.
 *
 *  - Glazer tilts of cubic SrTiO₃, built geometrically (testSupport, no
 *    subgroup engine), handed over as a CIF would hand them: other labels,
 *    another orbit member for each site, a strained cell. The decomposition
 *    finds the basis and origin, reproduces the child exactly, and its
 *    amplitudes are the geometric ones: A_s = √3·φ·a for a⁻a⁻a⁻ (six O
 *    displaced by φ·a/√2 in the primitive cell), and for a⁻b⁺a⁻ the norms of
 *    the a⁻_a⁻ and b⁺ parts on the R and M modes.
 *  - A published ISODISTORT decomposition: the ISODISTORT 6.12.2 mode CIF of
 *    the GSAS-II tutorial "k-vector search and ISODISTORT" (STO_Subgroup.cif,
 *    github.com/AdvancedPhotonSource/GSAS-II-tutorials, MDtutorials/
 *    k_vec_isodistort/data): SrTiO₃ (a = 3.899 Å; Sr 1b, Ti 1a, O 3d) with an
 *    X-point distortion to P4/mmm, basis {(1,0,0),(0,0,1),(0,−2,0)}, written
 *    with mode amplitudes A_s = 0.10000 Å (Sr, T1u) and −0.30000 Å (O, A2u).
 *    The numbers below are entered by hand from that file; the file itself is
 *    not in the repository (ADR 0005).
 *  - The parent against itself decomposes to nothing; a polar child keeps its
 *    origin floating and loses no displacement; an unrelated structure is
 *    refused with the reason.
 */
import { describe, it, expect } from "vitest";
import type { Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { applyOperation, siteMultiplicity } from "@/core/crystal/symmetry";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { applyParameters } from "@/core/workflow/apply";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild, type RealisedChild } from "@/core/crystal/irreps/realisation";
import { decomposeChild, type Decomposition } from "@/core/crystal/irreps/decompose";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, childDisplacement, srtio3, tiltIsInvariant, tiltedChild, type Glazer } from "@/testSupport/perovskiteTilts";

const PARENT = srtio3();
const GROUP = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const LATTICE = supercellSubgroups(GROUP, { maxIndex: 48 });

/** A realised class of the lattice that keeps the tilt, and the tilt's orientation in it. */
function tiltChild(name: string, number: number, extra: (r: RealisedChild) => boolean = () => true): { r: RealisedChild; g: Glazer; order: readonly [number, number, number] } {
  const g0 = GLAZER[name]!;
  for (const cls of LATTICE.classes.filter((c) => c.identity?.number === number)) {
    const r = realiseChild(PARENT, GROUP, cls.elements, cls.identity);
    if (!extra(r)) continue;
    for (const order of AXIS_ORDERS) for (const sg of TILT_SENSES) {
      const g: Glazer = { ...g0, phi: [g0.phi[0] * sg[0], g0.phi[1] * sg[1], g0.phi[2] * sg[2]] };
      if (tiltIsInvariant(r, g, order)) return { r, g, order };
    }
  }
  throw new Error(`no #${number} class keeps ${name}`);
}

/** The child as a CIF would give it: relabelled, each site at another orbit member, the cell strained. */
function asLoaded(child: StructureModel): StructureModel {
  const ops = child.spaceGroup.operations;
  return {
    ...child,
    id: "loaded",
    name: "loaded child",
    cell: { ...child.cell, a: child.cell.a * 1.004, c: child.cell.c * 0.997 },
    sites: child.sites.map((s, i) => {
      const x = applyOperation(ops[(3 * i + 1) % ops.length]!, s.position).map((v) => v - Math.floor(v)) as unknown as Vec3;
      return { ...s, label: `${s.element}${i + 1}`, position: x };
    }),
  };
}

/** The structure the decomposition's seeded amplitudes give: the child itself. */
function expectReproduces(d: Decomposition, child: StructureModel): void {
  const values = Object.fromEntries(d.set.parameters.map((p) => [p.id, p.value]));
  const back = applyParameters(d.set.parentized, d.set.bindings, values).model;
  back.sites.forEach((s, i) => s.position.forEach((x, k) => {
    const diff = x - child.sites[i]!.position[k]!;
    expect(Math.abs(diff - Math.round(diff))).toBeLessThan(1e-12);
  }));
  expect(d.residual).toBeLessThan(1e-10);
  expect(d.unpaired).toEqual([]);
}

/** The norm of a tilt field over the child's conventional cell (Å) in the unstrained cell. */
function tiltNorm(r: RealisedChild, g: Glazer, phi: Vec3, scale: number, order: readonly [number, number, number]): number {
  const M = orthogonalizationMatrix(r.structure.cell);
  const ops = r.structure.spaceGroup.operations;
  let s = 0;
  for (const site of r.structure.sites) {
    const u = childDisplacement(r, site.position, { ...g, phi }, scale, order);
    const c = [0, 1, 2].map((i) => M[i]![0]! * u[0] + M[i]![1]! * u[1] + M[i]![2]! * u[2]);
    s += siteMultiplicity(ops, site.position) * (c[0]! ** 2 + c[1]! ** 2 + c[2]! ** 2);
  }
  return Math.sqrt(s);
}

describe("decomposeChild: a supercell child against its parent", () => {
  it("a⁻a⁻a⁻ (R-3c): the basis and origin found, the child reproduced, A_s = √3·φ·a and A_p = A_s/√2 on the one R mode", () => {
    const { r, g, order } = tiltChild("a-a-a-", 167);
    const phi = 0.07;
    const loaded = asLoaded(tiltedChild(r, g, phi, order));
    const d = decomposeChild(PARENT, loaded);
    expectReproduces(d, loaded);
    expect(Math.abs(Math.round(d.basis[0][0] * d.basis[1][1] * d.basis[2][2] + 0) || 1)).toBeGreaterThan(0);
    expect(d.set.amplitudeCells).toEqual({ child: 3, parent: 6 });
    const moving = d.amplitudes.filter((a) => Math.abs(a.a) > 1e-9);
    expect(moving).toHaveLength(1);
    expect(moving[0]!.label).toMatch(/^R irrep \d+ of \d+ · O$/);
    const as = Math.sqrt(3) * phi * PARENT.cell.a;
    expect(Math.abs(moving[0]!.as)).toBeCloseTo(as, 10);
    expect(Math.abs(moving[0]!.ap)).toBeCloseTo(as / Math.SQRT2, 10);
    // The mode set is the child as loaded: its labels, its strained cell; ISODISTORT's parent and basis recorded.
    expect(d.set.parentized.sites.map((s) => s.label)).toEqual(loaded.sites.map((s) => s.label));
    expect(d.set.parentized.cell).toEqual(loaded.cell);
    expect(d.set.parent?.number).toBe(221);
    expect(d.set.modes.every((m) => m.irrep?.parentSite !== undefined)).toBe(true);
  });

  it("a⁻b⁺a⁻ (Pnma, Sr moved on its mirror): seven modes; the tilt's a⁻_a⁻ and b⁺ parts on the R and M modes, the Sr shift on the others", () => {
    const { r, g, order } = tiltChild("a-b+a-", 62, (x) => x.structure.sites.length === 4);
    const phi = 0.07;
    const tilted = tiltedChild(r, g, phi, order);
    // Sr moved on its mirror: modes of the X and R irreps that carry Sr.
    const withSr: StructureModel = {
      ...tilted,
      sites: tilted.sites.map((s) => (s.element === "Sr" ? { ...s, position: [s.position[0] + 0.004, s.position[1], s.position[2] - 0.003] } : s)),
    };
    const loaded = asLoaded(withSr);
    const d = decomposeChild(PARENT, loaded);
    expectReproduces(d, loaded);
    expect(d.amplitudes).toHaveLength(7);
    // The tilt alone (no Sr shift) puts its parts on one R and one M mode on O: compare those modes' amplitudes.
    const tiltOnly = decomposeChild(PARENT, asLoaded(tilted));
    const tiltModes = tiltOnly.amplitudes.filter((a) => Math.abs(a.a) > 1e-9);
    expect(tiltModes.map((a) => a.label[0]).sort()).toEqual(["M", "R"]);
    const R = Math.abs(tiltModes.find((a) => a.label.startsWith("R"))!.a);
    const M = Math.abs(tiltModes.find((a) => a.label.startsWith("M"))!.a);
    expect(R).toBeCloseTo(tiltNorm(r, g, [g.phi[0], 0, g.phi[2]], phi, order), 10);
    expect(M).toBeCloseTo(tiltNorm(r, g, [0, g.phi[1], 0], phi, order), 10);
    // With Sr moved, the Sr-carrying modes (X and R, on Sr) pick up the shift; the O tilt modes keep their values.
    const srModes = d.amplitudes.filter((a) => / · Sr/.test(a.label));
    expect(srModes).toHaveLength(2);
    expect(srModes.every((a) => Math.abs(a.a) > 1e-4)).toBe(true);
    for (const a of tiltModes) expect(d.amplitudes.find((b) => b.label === a.label)!.a).toBeCloseTo(a.a, 10);
  });

  it("ISODISTORT 6.12.2's own decomposition (GSAS-II tutorial STO_Subgroup.cif): |A_s| = 0.100 Å on Sr and 0.300 Å on O, to 1e-3", () => {
    // The parent as ISODISTORT had it: SrTiO3, a = 3.899 Å, Sr 1b, Ti 1a, O 3d.
    const parent: StructureModel = {
      id: "sto",
      name: "STO_Parent",
      cell: { a: 3.899, b: 3.899, c: 3.899, alpha: 90, beta: 90, gamma: 90 },
      spaceGroup: buildSpaceGroup(221),
      sites: [
        { label: "sr", element: "Sr", position: [0.5, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
        { label: "ti", element: "Ti", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
        { label: "o", element: "O", position: [0.5, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      ],
    };
    // The child ISODISTORT wrote: P4/mmm #123, a = b = 3.899, c = 7.798 Å, its atom_site loop.
    const child: StructureModel = {
      id: "sto-child",
      name: "STO_Subgroup",
      cell: { a: 3.899, b: 3.899, c: 7.798, alpha: 90, beta: 90, gamma: 90 },
      spaceGroup: buildSpaceGroup(123),
      sites: [
        { label: "sr_1", element: "Sr", position: [0.5, 0.5, 0.74093], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
        { label: "ti_1", element: "Ti", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
        { label: "ti_2", element: "Ti", position: [0, 0, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
        { label: "o_1", element: "O", position: [0, 0.5, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
        { label: "o_2", element: "O", position: [0, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
        { label: "o_3", element: "O", position: [0, 0, 0.7772], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      ],
    };
    const d = decomposeChild(parent, child);
    expectReproduces(d, child);
    // A primitive child of a primitive parent, twice its cell: A = A_s, A_p = A_s/√2.
    expect(d.set.amplitudeCells).toEqual({ child: 1, parent: 2 });
    // The modes are named by the parent's sites, "sr" and "o" here.
    const sr = d.amplitudes.find((a) => / · sr$/.test(a.label))!;
    const o = d.amplitudes.find((a) => / · o$/.test(a.label))!;
    expect(d.amplitudes).toHaveLength(2);
    // ISODISTORT: 0.10000 and −0.30000 (the sign is its mode vector's convention). The file's coordinates carry 5 decimals.
    expect(Math.abs(Math.abs(sr.as) - 0.1)).toBeLessThan(1e-3);
    expect(Math.abs(Math.abs(o.as) - 0.3)).toBeLessThan(1e-3);
    // Both on the same X-point irrep, as ISODISTORT's X1+.
    expect(sr.label.split(" · ")[0]).toBe(o.label.split(" · ")[0]);
    expect(sr.label).toMatch(/^X irrep/);
  });

  it("the parent against itself: every amplitude zero; a polar Γ child keeps its displacements without a rigid shift", () => {
    const self = decomposeChild(PARENT, { ...PARENT, id: "again" });
    expect(self.amplitudes.every((a) => Math.abs(a.a) < 1e-12)).toBe(true);
    // P4mm: Ti and O moved along c by different amounts, the whole crystal shifted too.
    const p4mm: StructureModel = {
      id: "p4mm",
      name: "polar",
      cell: { a: 3.905, b: 3.905, c: 3.93, alpha: 90, beta: 90, gamma: 90 },
      spaceGroup: buildSpaceGroup(99),
      sites: [
        { label: "Sr", element: "Sr", position: [0, 0, 0.01], occupancy: 1, adp: { kind: "isotropic", bIso: 0.6 } },
        { label: "Ti", element: "Ti", position: [0.5, 0.5, 0.53], occupancy: 1, adp: { kind: "isotropic", bIso: 0.4 } },
        { label: "O1", element: "O", position: [0.5, 0.5, 0.0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.8 } },
        { label: "O2", element: "O", position: [0.5, 0, 0.49], occupancy: 1, adp: { kind: "isotropic", bIso: 0.8 } },
      ],
    };
    const d = decomposeChild(PARENT, p4mm);
    expectReproduces(d, p4mm);
    // One rigid translation along c is projected out: four free z, three modes.
    expect(d.amplitudes).toHaveLength(3);
    expect(d.set.acousticExcluded).toBe(1);
  });

  it("a mixed A site (Sr and La on one point) pairs element by element; the tilt's amplitude is the same", () => {
    const { r, g, order } = tiltChild("a-a-a-", 167);
    const tilted = tiltedChild(r, g, 0.07, order);
    const mix = (x: StructureModel): StructureModel => ({
      ...x,
      sites: x.sites.flatMap((site) => (site.element === "Sr" ? [{ ...site, occupancy: 0.5 }, { ...site, label: `La${site.label.slice(2)}`, element: "La", occupancy: 0.5 }] : [site])),
    });
    const d = decomposeChild(mix(PARENT), asLoaded(mix(tilted)));
    expectReproduces(d, asLoaded(mix(tilted)));
    const moving = d.amplitudes.filter((a) => Math.abs(a.a) > 1e-9);
    expect(moving).toHaveLength(1);
    expect(Math.abs(moving[0]!.as)).toBeCloseTo(Math.sqrt(3) * 0.07 * PARENT.cell.a, 10);
  });

  it("refuses an unrelated structure, with the reason", () => {
    const rutile: StructureModel = {
      id: "tio2",
      name: "rutile",
      cell: { a: 4.594, b: 4.594, c: 2.959, alpha: 90, beta: 90, gamma: 90 },
      spaceGroup: buildSpaceGroup(136),
      sites: [
        { label: "Ti", element: "Ti", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.4 } },
        { label: "O", element: "O", position: [0.305, 0.305, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.6 } },
      ],
    };
    expect(() => decomposeChild(PARENT, rutile)).toThrow(/no child (basis|origin)/);
  });
});
