/**
 * Structural geometry helpers for the quality-assessment step: interatomic
 * distances (bond lengths) computed from the fractional coordinates and cell.
 */

import type { AtomSite, StructureModel } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { fractionalToCartesian } from "@/core/crystal/unitCell";
import { applyOperation } from "@/core/crystal/symmetry";
import { wrapFractional, sub, norm } from "@/core/math/vec3";

export interface BondLength {
  readonly from: string;
  readonly to: string;
  readonly distance: number;
}

/**
 * Nearest-neighbour bond lengths (Å) up to `cutoff`, between each asymmetric
 * site and all symmetry-generated atoms in the surrounding cells. Deduplicated
 * and sorted by distance.
 */
export function bondLengths(model: StructureModel, cutoff = 3.2): BondLength[] {
  // Generate all atoms in the reference cell plus neighbouring cells.
  const atoms: Array<{ label: string; site: AtomSite; frac: Vec3 }> = [];
  for (const site of model.sites) {
    const positions: Vec3[] = [];
    for (const op of model.spaceGroup.operations) {
      const p = wrapFractional(applyOperation(op, site.position));
      if (!positions.some((q) => norm(sub(q, p)) < 1e-4)) positions.push(p);
    }
    for (const p of positions) atoms.push({ label: site.label, site, frac: p });
  }

  const bonds: BondLength[] = [];
  for (const site of model.sites) {
    const originFrac = wrapFractional(site.position);
    const originCart = fractionalToCartesian(model.cell, originFrac);
    for (const atom of atoms) {
      // Two alternatives of one disorder are never present together: no distance between them is a bond.
      if (alternatives(site, atom.site)) continue;
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) {
          for (let dc = -1; dc <= 1; dc++) {
            const frac: Vec3 = [atom.frac[0] + da, atom.frac[1] + db, atom.frac[2] + dc];
            const cart = fractionalToCartesian(model.cell, frac);
            const dist = norm(sub(cart, originCart));
            if (dist > 1e-3 && dist <= cutoff) {
              bonds.push({ from: site.label, to: atom.label, distance: dist });
            }
          }
        }
      }
    }
  }

  // Deduplicate near-equal bonds and sort.
  bonds.sort((a, b) => a.distance - b.distance);
  const unique: BondLength[] = [];
  for (const b of bonds) {
    if (!unique.some((u) => u.from === b.from && u.to === b.to && Math.abs(u.distance - b.distance) < 1e-3)) {
      unique.push(b);
    }
  }
  return unique;
}

/**
 * Two sites are alternatives of one disorder (SHELXL's PART 1 and PART 2 of
 * an assembly): never present together, so never bonded.
 */
export function alternatives(a: AtomSite, b: AtomSite): boolean {
  return !!a.disorder && !!b.disorder && a.disorder.assembly === b.disorder.assembly && a.disorder.group !== b.disorder.group;
}

/** Covalent radii (Å), Cordero et al. (2008); for Mn, Fe and Co the low-spin values; 0.75 for an element not listed. */
const COVALENT: Readonly<Record<string, number>> = {
  H: 0.31, D: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58,
  Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06,
  K: 2.03, Ca: 1.76, Sc: 1.7, Ti: 1.6, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22,
  Ga: 1.22, Ge: 1.2, As: 1.19, Se: 1.2, Br: 1.2, Kr: 1.16,
  Rb: 2.2, Sr: 1.95, Y: 1.9, Zr: 1.75, Nb: 1.64, Mo: 1.54, Tc: 1.47, Ru: 1.46, Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44,
  In: 1.42, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.4,
  Cs: 2.44, Ba: 2.15, La: 2.07, Ce: 2.04, Pr: 2.03, Nd: 2.01, Pm: 1.99, Sm: 1.98, Eu: 1.98, Gd: 1.96, Tb: 1.94, Dy: 1.92,
  Ho: 1.92, Er: 1.89, Tm: 1.9, Yb: 1.87, Lu: 1.87, Hf: 1.75, Ta: 1.7, W: 1.62, Re: 1.51, Os: 1.44, Ir: 1.41, Pt: 1.36,
  Au: 1.36, Hg: 1.32, Tl: 1.45, Pb: 1.46, Bi: 1.48, Po: 1.4, At: 1.5, Rn: 1.5,
  Fr: 2.6, Ra: 2.21, Ac: 2.15, Th: 2.06, Pa: 2.0, U: 1.96, Np: 1.9, Pu: 1.87, Am: 1.8, Cm: 1.69,
};
export const covalentRadius = (element: string): number => COVALENT[element.replace(/[^A-Za-z]/g, "")] ?? 0.75;

/** Two atoms at `distance` (Å) are bonded: closer than their covalent radii's sum and 0.4 Å. */
export const covalentlyBonded = (a: string, b: string, distance: number): boolean => distance > 0.5 && distance < covalentRadius(a) + covalentRadius(b) + 0.4;

/** A structure with carbon is molecular: its geometry is its covalent bonds, not cation shells. */
export function isMolecular(model: StructureModel): boolean {
  return model.sites.some((site) => site.element.replace(/[^A-Za-z]/g, "") === "C");
}

/**
 * The covalent bonds of a structure, as SHELXL lists them (_geom_bond): each
 * pair of atoms closer than their covalent radii's sum and 0.4 Å, once, from
 * the site listed first, in the order of the sites and shortest first.
 */
export function covalentBonds(model: StructureModel): BondLength[] {
  const order = new Map(model.sites.map((site, i) => [site.label, i]));
  const element = new Map(model.sites.map((site) => [site.label, site.element]));
  const seen = new Set<string>();
  const out: BondLength[] = [];
  for (const b of bondLengths(model, 3.0)) {
    if (!covalentlyBonded(element.get(b.from)!, element.get(b.to)!, b.distance)) continue;
    const [from, to] = order.get(b.from)! <= order.get(b.to)! ? [b.from, b.to] : [b.to, b.from];
    const key = `${from}–${to}@${b.distance.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to, distance: b.distance });
  }
  return out.sort((x, y) => order.get(x.from)! - order.get(y.from)! || x.distance - y.distance);
}

/** One bond of a coordination shell: the neighbour site, the length and how many neighbours sit at it. */
export interface ShellBond {
  readonly to: string;
  readonly distance: number;
  readonly count: number;
}

/** A site's first coordination shell, shortest bond first. */
export interface CoordinationShell {
  readonly site: string;
  readonly bonds: readonly ShellBond[];
  /** The occupancy-blind mean bond length over the shell (Å). */
  readonly mean: number;
}

/** Elements that make the polyhedra around the cations. */
const ANION_ELEMENTS: ReadonlySet<string> = new Set(["O", "F", "Cl", "Br", "I", "S", "Se", "Te", "N"]);

/** A shell reaches at least this far (Å), so a long Jahn–Teller bond (Cu²⁺–O ≈ 2.7 Å) stays in it. */
const SHELL_REACH = 3.2;

/**
 * Each cation's coordination shell, as a structure report tabulates it: its
 * anion neighbours out to 3.2 Å, or 1.25 × the shortest bond for a large
 * cation, grouped by neighbour site and length with the multiplicity —
 * Mn–O6 1.907 ×2, Mn–O1 1.969 ×2, Mn–O6 2.179 ×2 in LaMnO₃. A structure
 * without anions (a metal, an intermetallic) gives every site's shell of any
 * neighbours. Lengths equal within 0.0005 Å are one bond.
 */
export function coordinationShells(model: StructureModel, cutoff = 3.5): CoordinationShell[] {
  const atoms: { label: string; element: string; frac: Vec3 }[] = [];
  for (const site of model.sites) {
    const positions: Vec3[] = [];
    for (const op of model.spaceGroup.operations) {
      const p = wrapFractional(applyOperation(op, site.position));
      if (!positions.some((q) => norm(sub(q, p)) < 1e-4)) positions.push(p);
    }
    for (const p of positions) atoms.push({ label: site.label, element: site.element, frac: p });
  }
  const anions = atoms.some((a) => ANION_ELEMENTS.has(a.element));
  const out: CoordinationShell[] = [];
  for (const site of model.sites) {
    if (anions && ANION_ELEMENTS.has(site.element)) continue;
    const origin = fractionalToCartesian(model.cell, wrapFractional(site.position));
    const found: { to: string; distance: number }[] = [];
    for (const atom of atoms) {
      if (anions && !ANION_ELEMENTS.has(atom.element)) continue;
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) {
          for (let dc = -1; dc <= 1; dc++) {
            const d = norm(sub(fractionalToCartesian(model.cell, [atom.frac[0] + da, atom.frac[1] + db, atom.frac[2] + dc]), origin));
            if (d > 0.5 && d <= cutoff) found.push({ to: atom.label, distance: d });
          }
        }
      }
    }
    if (found.length === 0) continue;
    const shortest = Math.min(...found.map((f) => f.distance));
    const reach = Math.max(SHELL_REACH, 1.25 * shortest);
    const shell = found.filter((f) => f.distance <= reach).sort((a, b) => a.distance - b.distance);
    const bonds: { to: string; distance: number; count: number }[] = [];
    for (const f of shell) {
      const same = bonds.find((b) => b.to === f.to && Math.abs(b.distance - f.distance) < 5e-4);
      if (same) same.count++;
      else bonds.push({ to: f.to, distance: f.distance, count: 1 });
    }
    out.push({ site: site.label, bonds, mean: shell.reduce((s, f) => s + f.distance, 0) / shell.length });
  }
  return out;
}
