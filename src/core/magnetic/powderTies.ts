/**
 * Exact powder ties between magnetic models (THY-58): two models a powder
 * cannot tell apart because they give the same calculated pattern, not two
 * that merely fit about equally well.
 *
 * With every line the sum of |F_M⊥|² over its family (powderAverage.ts),
 * different magnetic groups can give the same powder pattern exactly. On the
 * synthetic Mn₃Ga page, P_c-3m1 with 2.5 µB on every Mn and P_c-6m2 with
 * √2 × 2.5 µB on half of them agree to 10⁻¹³ on every line. The ranking's
 * top-down rule (no supergroup among the ties, lowest index, fewest moment
 * parameters) cannot choose between such groups, and its last key, the wR,
 * then differs only in its last digits.
 *
 * Two fitted models are an **exact powder tie** when both hold, each to
 * {@link POWDER_TIE_REL} relative:
 *  - their wR are equal (the data cannot tell them apart), and
 *  - their magnetic lines are equal: the family sums grouped by d, over
 *    d ≥ max(0.8 Å, V^⅓/6), compared with the strongest line (the same
 *    calculated pattern, not two patterns that fit equally badly).
 * A fit converged to 10⁻⁶ in its parameters leaves ties apart by about 10⁻¹¹
 * (2.5·10⁻¹¹ for the pair above); groups whose best fits differ at 10⁻⁵ are
 * near-ties and keep the wR order.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { MagneticModel } from "@/core/magnetic/types";
import type { Vec3 } from "@/core/math/types";
import { cellVolume } from "@/core/crystal/unitCell";
import { siteMultiplicity } from "@/core/crystal/symmetry";
import { momentAnchorPosition } from "@/core/crystal/cellExpansion";
import { satelliteIntensities } from "@/core/magnetic/powderAverage";

/** Relative tolerance of an exact powder tie, on the wR and on the lines. */
export const POWDER_TIE_REL = 1e-9;

/** The longest d of the line fingerprint (Å): the (000)±k satellite of a long-period k included. */
const TIE_D_MAX = 1000;

/** The shortest d of the line fingerprint (Å): 0.8 Å, or longer in a large cell (about 10² families). */
export function tieDMin(structure: StructureModel): number {
  return Math.max(0.8, Math.cbrt(cellVolume(structure.cell)) / 6);
}

/**
 * The model's magnetic lines as a fingerprint: |F_M⊥|² summed over each
 * family, families at one d (10⁻⁹ relative) summed as the powder sees them,
 * in increasing d. Two models of one structure and k give arrays of one
 * length, line for line.
 */
export function powderLines(structure: StructureModel, magnetic: MagneticModel): number[] {
  const lines = satelliteIntensities(structure, magnetic, tieDMin(structure), TIE_D_MAX)
    .map((s) => ({ d: s.d, squared: s.squared }))
    .sort((a, b) => a.d - b.d);
  const out: number[] = [];
  let lastD = -Infinity;
  for (const l of lines) {
    if (out.length > 0 && Math.abs(l.d - lastD) <= POWDER_TIE_REL * l.d) out[out.length - 1]! += l.squared;
    else {
      out.push(l.squared);
      lastD = l.d;
    }
  }
  return out;
}

/** The same lines to `rel` of the strongest of either. */
export function samePowderLines(a: readonly number[], b: readonly number[], rel = POWDER_TIE_REL): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let max = 0;
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, a[i]!, b[i]!);
    worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  }
  return max > 0 && worst <= rel * max;
}

/** Two fitted models are an exact powder tie: wR and lines equal to {@link POWDER_TIE_REL}. */
export function exactPowderTie(
  a: { readonly wR: number | null; readonly lines?: readonly number[] },
  b: { readonly wR: number | null; readonly lines?: readonly number[] },
): boolean {
  if (a.wR == null || b.wR == null || !a.lines || !b.lines) return false;
  if (Math.abs(a.wR - b.wR) > POWDER_TIE_REL * Math.max(a.wR, b.wR)) return false;
  return samePowderLines(a.lines, b.lines);
}

/** How many of the chosen ions carry a refined moment, of how many the parent cell holds. */
export interface MomentCoverage {
  /** Atoms of the chosen ions in the parent cell with a nonzero moment (or modulation amplitude). */
  readonly carrying: number;
  /** Atoms of the chosen ions in the parent cell (each site's multiplicity in the parent group). */
  readonly total: number;
}

/**
 * The chosen ions that carry a moment in a model: each moment entry whose
 * amplitude is above 10⁻⁶ of the largest counts its orbit's atoms in the
 * parent cell; a split orbit the group gives no moment (or the fit left at
 * zero) counts none. P_c-3m1 on Mn₃Ga's 6h: 6 of 6; P_c-6m2: 3 of 6.
 */
export function momentCoverage(structure: StructureModel, magnetic: MagneticModel, ions: readonly string[]): MomentCoverage {
  const nuclearOps = structure.spaceGroup.operations;
  const ops = magnetic.operations ?? nuclearOps;
  const chosen = new Set(ions);
  let total = 0;
  for (const site of structure.sites) if (chosen.has(site.label)) total += siteMultiplicity(nuclearOps, site.position);
  const size = (v: Vec3 | undefined): number => (v ? Math.hypot(v[0], v[1], v[2]) : 0);
  const amplitude = (m: MagneticModel["moments"][number]): number => size(m.components) + size(m.sinComponents);
  const largest = Math.max(0, ...magnetic.moments.filter((m) => chosen.has(m.siteLabel)).map(amplitude));
  let carrying = 0;
  if (largest > 0) {
    for (const m of magnetic.moments) {
      if (!chosen.has(m.siteLabel) || amplitude(m) <= 1e-6 * largest) continue;
      const site = structure.sites.find((s) => s.label === m.siteLabel);
      if (!site) continue;
      const anchor = momentAnchorPosition(nuclearOps, ops, site.position, m.orbitIndex, m.position);
      carrying += siteMultiplicity(ops, anchor);
    }
  }
  return { carrying: Math.min(carrying, total), total };
}
