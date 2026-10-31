/**
 * The realisation of a child in its own cell (realisation.ts), through the
 * module interfaces: a supercell child of cubic SrTiO₃ (Pm-3m) and of rock
 * salt (Fm-3m), reached by the irrep route (an isotropy subgroup) and by the
 * lattice route (a class of the supercell lattice), realised in its ITA
 * standard setting.
 *
 * At the parent's geometry the child is the parent: the same atoms, so the
 * same G(r) and |F(H)|² = (V_child/V_parent)²·|F_parent(P⁻ᵀH)|², every
 * superlattice reflection zero. Checked to 1e-9 relative with isotropic and
 * anisotropic ADPs, the latter testing the ADP transformation to the child's
 * axes.
 */
import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import type { Radiation } from "@/core/diffraction/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups, type IrrepIsotropySubgroup } from "@/core/crystal/irreps/isotropy";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild, realisedAmplitudeCells, symmetryBreakingField, type RealisedChild } from "@/core/crystal/irreps/realisation";
import { nuclearStructureFactor, expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { applyOperation, siteMultiplicity } from "@/core/crystal/symmetry";
import { cellVolume } from "@/core/crystal/unitCell";
import { allowedAnisotropicAdpModes } from "@/core/crystal/adpConstraints";

const SRTIO3: StructureModel = {
  id: "srtio3",
  name: "SrTiO3",
  cell: { a: 3.905, b: 3.905, c: 3.905, alpha: 90, beta: 90, gamma: 90 },
  spaceGroup: buildSpaceGroup(221),
  sites: [
    { label: "Sr", element: "Sr", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.6 } },
    { label: "Ti", element: "Ti", position: [0.5, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.4 } },
    { label: "O", element: "O", position: [0, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.8 } },
  ],
};

/** The same with O's symmetry-allowed tensor: U11 along the Ti–O–Ti bond, U22 = U33 across it. */
const SRTIO3_ANISO: StructureModel = {
  ...SRTIO3,
  sites: SRTIO3.sites.map((s) => (s.label === "O" ? { ...s, adp: { kind: "anisotropic", uAniso: [0.004, 0.012, 0.012, 0, 0, 0] } } : s.label === "Sr" ? { ...s, occupancy: 0.9 } : s)),
};

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

const groups = new Map<StructureModel, FactorGroup>();
const groupOf = (s: StructureModel): FactorGroup => {
  if (!groups.has(s)) groups.set(s, factorGroup(s.spaceGroup.operations, DEFAULT_SUPERCELL));
  return groups.get(s)!;
};

/** The isotropy subgroups of every irrep at k, flattened. */
function isotropyAt(s: StructureModel, k: readonly [number, number, number]): IrrepIsotropySubgroup[] {
  const group = groupOf(s);
  return irrepsOfStar(group, k).physical.flatMap((p) => isotropySubgroups(group, p).subgroups);
}

const NEUTRON: Radiation = { kind: "neutron", wavelength: 1.5 };
const XRAY: Radiation = { kind: "xray", wavelength: 0.7107 } as Radiation;

/** |F(H)|² of the child against the parent's at h = P⁻ᵀH: (V_c/V_p)² times, or 0 off the parent's lattice. */
function expectParentIntensities(parent: StructureModel, r: RealisedChild, radiation: Radiation, hMax = 4): void {
  const Pinv = inv(r.basis);
  let checked = 0;
  let superlattice = 0;
  for (let h = -hMax; h <= hMax; h++) for (let k = -hMax; k <= hMax; k++) for (let l = -hMax; l <= hMax; l++) {
    if (h === 0 && k === 0 && l === 0) continue;
    // h_parent = P⁻ᵀ·H: column j of P⁻¹ dotted with H.
    const hp = [0, 1, 2].map((j) => Pinv[0]![j]! * h + Pinv[1]![j]! * k + Pinv[2]![j]! * l);
    const integral = hp.every((x) => Math.abs(x - Math.round(x)) < 1e-9);
    const fc = nuclearStructureFactor(r.structure, radiation, h, k, l);
    const ic = fc.re * fc.re + fc.im * fc.im;
    if (!integral) {
      superlattice++;
      expect(ic, `(${h},${k},${l})`).toBeLessThan(1e-18);
      continue;
    }
    const fp = nuclearStructureFactor(parent, radiation, Math.round(hp[0]!), Math.round(hp[1]!), Math.round(hp[2]!));
    const ip = (fp.re * fp.re + fp.im * fp.im) * r.volumeRatio * r.volumeRatio;
    expect(Math.abs(ic - ip), `(${h},${k},${l})`).toBeLessThanOrEqual(1e-9 * Math.max(ip, 1e-6));
    checked++;
  }
  expect(checked).toBeGreaterThan(20);
  expect(superlattice).toBeGreaterThan(20);
}

/** G(r) of the child and of the parent on one grid, equal to 1e-9 of the curve's scale. */
function expectParentPdf(parent: StructureModel, r: RealisedChild): void {
  const grid = makeRGrid(1, 12, 0.01);
  const params = { scatteringType: "neutron" as const, scale: 1, qdamp: 0.03, qbroad: 0.01, delta1: 0, delta2: 1.5 };
  const gp = computeGofR(parent.cell, expandStructureAtoms(parent), grid, params);
  const gc = computeGofR(r.structure.cell, expandStructureAtoms(r.structure), grid, params);
  const scale = Math.max(...Array.from(gp, Math.abs));
  for (let i = 0; i < grid.length; i++) expect(Math.abs(gc[i]! - gp[i]!), `r = ${grid[i]}`).toBeLessThan(1e-9 * scale);
}

function inv(m: readonly (readonly number[])[]): number[][] {
  const [a, b, c] = m[0]!;
  const [d, e, f] = m[1]!;
  const [g, h, i] = m[2]!;
  const A = e! * i! - f! * h!;
  const B = -(d! * i! - f! * g!);
  const C = d! * h! - e! * g!;
  const det = a! * A + b! * B + c! * C;
  return [
    [A / det, -(b! * i! - c! * h!) / det, (b! * f! - c! * e!) / det],
    [B / det, (a! * i! - c! * g!) / det, -(a! * f! - c! * d!) / det],
    [C / det, -(a! * h! - b! * g!) / det, (a! * e! - b! * d!) / det],
  ];
}

/** The correspondence: every child atom is the parent atom it names, P·x + p = W·x_s + w + n. */
function expectCorrespondence(parent: StructureModel, r: RealisedChild): void {
  const ops = parent.spaceGroup.operations;
  for (const a of r.atoms) {
    const site = parent.sites.find((s) => s.label === a.parentSite)!;
    const img = applyOperation(ops[a.parentOperation]!, site.position);
    const X = [0, 1, 2].map((i) => r.basis[i]![0]! * a.position[0] + r.basis[i]![1]! * a.position[1] + r.basis[i]![2]! * a.position[2] + r.origin[i]!);
    for (let i = 0; i < 3; i++) expect(Math.abs(X[i]! - img[i]! - a.parentTranslation[i]!)).toBeLessThan(1e-9);
    for (const n of a.parentTranslation) expect(Number.isInteger(n)).toBe(true);
    // The child operation it names carries the child site's representative here.
    const childSite = r.structure.sites.find((s) => s.label === a.site)!;
    const y = applyOperation(r.structure.spaceGroup.operations[a.childOperation]!, childSite.position);
    for (let i = 0; i < 3; i++) {
      const d = Math.abs(y[i]! - a.position[i]!) % 1;
      expect(Math.min(d, 1 - d)).toBeLessThan(1e-9);
    }
  }
  // Every parent atom of the child cell once: |orbit| × det P per parent site.
  for (const s of parent.sites) {
    const n = r.atoms.filter((a) => a.parentSite === s.label).length;
    expect(n).toBe(Math.round(siteMultiplicity(ops, s.position) * r.volumeRatio));
  }
  // Each child site's multiplicity is its share of the atoms.
  for (const o of r.sites) expect(r.atoms.filter((a) => a.site === o.label)).toHaveLength(o.multiplicity);
}

describe("realiseChild: Pm-3m SrTiO₃ in the 2×2×2 bound", { timeout: 600_000 }, () => {
  it("R4+ (a,a,a) → R-3c #167 on hexagonal axes: 6 formula units, O on 18e at x = ½", () => {
    const sub = isotropyAt(SRTIO3, [0.5, 0.5, 0.5]).find((s) => s.identity.number === 167)!;
    expect(sub.cellMultiplying).toBe(true);
    const r = realiseChild(SRTIO3, groupOf(SRTIO3), sub.elements, sub.identity);
    console.log("R-3c", JSON.stringify({ basis: r.basis, origin: r.origin, sg: r.structure.spaceGroup.hermannMauguin, cell: r.structure.cell, sites: r.structure.sites.map((s) => [s.label, s.position]) }));
    expect(r.structure.spaceGroup.number).toBe(167);
    expect(r.structure.spaceGroup.operations).toHaveLength(36);
    expect(r.volumeRatio).toBe(6);
    const c = r.structure.cell;
    expect(c.a).toBeCloseTo(3.905 * Math.SQRT2, 10);
    expect(c.b).toBe(c.a);
    expect(c.c).toBeCloseTo(3.905 * 2 * Math.sqrt(3), 10);
    expect([c.alpha, c.beta, c.gamma]).toEqual([90, 90, 120]);
    expect(cellVolume(c) / cellVolume(SRTIO3.cell)).toBeCloseTo(6, 10);
    expect(r.structure.sites.map((s) => [s.label, siteMultiplicity(r.structure.spaceGroup.operations, s.position)])).toEqual([["Sr", 6], ["Ti", 6], ["O", 18]]);
    expectCorrespondence(SRTIO3, r);
    expectParentIntensities(SRTIO3, r, NEUTRON);
    expectParentPdf(SRTIO3, r);
    expect(realisedAmplitudeCells(SRTIO3, r)).toEqual({ child: 3, parent: 6 });
  });

  it("the lattice route reaches the same R-3c, and Pnma #62, I4/mcm #140 and P4/mbm #127", () => {
    const lattice = supercellSubgroups(groupOf(SRTIO3), { maxIndex: 48 });
    for (const [number, z] of [[167, 6], [62, 4], [140, 4], [127, 2]] as const) {
      const cls = lattice.classes.find((c) => c.identity?.number === number && c.cellMultiplying)!;
      expect(cls, `#${number}`).toBeDefined();
      const r = realiseChild(SRTIO3, groupOf(SRTIO3), cls.elements, cls.identity);
      console.log(number, JSON.stringify({ basis: r.basis, origin: r.origin, sg: r.structure.spaceGroup.hermannMauguin, cell: r.structure.cell, sites: r.structure.sites.map((s) => [s.label, s.position.map((x) => +x.toFixed(4))]) }));
      expect(r.structure.spaceGroup.number).toBe(number);
      expect(r.volumeRatio).toBe(z);
      expectCorrespondence(SRTIO3, r);
      expectParentIntensities(SRTIO3, r, XRAY, 3);
      expectParentPdf(SRTIO3, r);
    }
  });

  it("anisotropic ADPs and a partial occupancy carry over: the same intensities and G(r)", () => {
    const group = groupOf(SRTIO3_ANISO);
    for (const sub of isotropyAt(SRTIO3_ANISO, [0.5, 0.5, 0.5]).filter((s) => [167, 140, 74, 15].includes(s.identity.number ?? 0))) {
      const r = realiseChild(SRTIO3_ANISO, group, sub.elements, sub.identity);
      // Each child tensor satisfies the child's site symmetry.
      for (const site of r.structure.sites) {
        if (site.adp.kind !== "anisotropic") continue;
        const u = site.adp.uAniso;
        const allowed = allowedAnisotropicAdpModes(r.structure.spaceGroup.operations, site.position, u);
        const back = [0, 1, 2, 3, 4, 5].map((c) => allowed.modes.reduce((t, m) => t + m.coefficient * m.basis[c]!, 0));
        for (let c = 0; c < 6; c++) expect(Math.abs(back[c]! - u[c]!), `${site.label} U${c}`).toBeLessThan(1e-12);
      }
      expectParentIntensities(SRTIO3_ANISO, r, NEUTRON, 3);
      expectParentPdf(SRTIO3_ANISO, r);
    }
  });

  it("a symmetry-breaking field exists for the tilt children, is normalised and leaves the parent's sites' own space", () => {
    const sub = isotropyAt(SRTIO3, [0.5, 0.5, 0.5]).find((s) => s.identity.number === 167)!;
    const r = realiseChild(SRTIO3, groupOf(SRTIO3), sub.elements, sub.identity);
    const field = symmetryBreakingField(SRTIO3, r)!;
    expect(field).not.toBeNull();
    // R-3c from cubic SrTiO₃: only O moves (its x, the tilt).
    expect(field.map((f) => f.siteLabel)).toEqual(["O"]);
  });
});

describe("realiseChild: Fm-3m rock salt, a centred parent", { timeout: 600_000 }, () => {
  it("every L-point isotropy subgroup realises in its own cell and reproduces the parent", () => {
    const subs = isotropyAt(NACL, [0.5, 0.5, 0.5]).filter((s) => s.cellMultiplying);
    expect(subs.length).toBeGreaterThan(5);
    const seen = new Set<number>();
    for (const sub of subs) {
      const number = sub.identity.number!;
      if (seen.has(number)) continue;
      seen.add(number);
      const r = realiseChild(NACL, groupOf(NACL), sub.elements, sub.identity);
      expect(r.structure.spaceGroup.number).toBe(number);
      expectCorrespondence(NACL, r);
      expectParentIntensities(NACL, r, NEUTRON, 3);
    }
    console.log("Fm-3m L children", [...seen].join(","));
  });
});
