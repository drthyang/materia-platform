/**
 * What a crystallographer reads in a single-crystal data set before the model:
 * whether Friedel pairs were measured apart (the absolute structure of a
 * non-centrosymmetric crystal needs them), which reflections the space group
 * forbids yet carry intensity, and the normalized intensity statistics
 * ⟨|E² − 1|⟩ — 0.968 for a centrosymmetric structure, 0.736 for a
 * non-centrosymmetric one, lower again for a twinned crystal (twinning averages
 * the intensities of the domains, and fewer reflections are weak).
 *
 * The merging (R_int, redundancy) and the completeness by resolution shell are
 * merge.ts's and singleCrystalValidation.ts's.
 */

import type { SpaceGroup, UnitCell } from "@/core/crystal/types";
import { dSpacing } from "@/core/crystal/unitCell";
import { isReflectionAbsent } from "@/core/crystal/symmetry";
import { canonicalKey, mergeEquivalents } from "@/core/diffraction/merge";

export interface StatisticsRow {
  readonly h: number;
  readonly k: number;
  readonly l: number;
  readonly intensity: number;
  readonly sigma: number;
}

export interface FriedelCoverage {
  /** The space group holds the inversion: Friedel mates are equivalent, nothing to measure apart. */
  readonly centrosymmetric: boolean;
  /** Unique reflections under the point group (Friedel mates kept apart). */
  readonly unique: number;
  /** Of them, those whose Friedel mate was measured too. */
  readonly withMate: number;
  /** withMate / unique (0 when the data were merged in the Laue class). */
  readonly fraction: number;
}

export interface AbsenceViolation {
  readonly h: number;
  readonly k: number;
  readonly l: number;
  readonly d: number;
  /** I/σ of the merged reflection. */
  readonly iOverSigma: number;
}

export interface IntensityStatistics {
  /** ⟨|E² − 1|⟩ over the merged, allowed reflections (E² normalized in resolution shells). */
  readonly meanAbsE2Minus1: number;
  /** Fraction of acentric-like weak reflections: E² < 0.1 (≈ 0.095 acentric, ≈ 0.248 centric, fewer when twinned). */
  readonly fractionWeak: number;
  readonly reflections: number;
  /** What the value suggests, in words: centrosymmetric, non-centrosymmetric, or below both (twinning?). */
  readonly reading: string;
}

export interface ReflectionStatistics {
  readonly friedel: FriedelCoverage;
  /** Reflections the space group forbids: how many were measured, and those at ≥ 3σ. */
  readonly absences: { readonly measured: number; readonly violated: readonly AbsenceViolation[] };
  readonly intensities: IntensityStatistics;
}

const CENTRIC = 0.968;
const ACENTRIC = 0.736;

function isInversion(R: SpaceGroup["operations"][number]["rotation"]): boolean {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (Math.round(R[i]![j]!) !== (i === j ? -1 : 0)) return false;
  return true;
}

/** The point group's rotations (proper and improper), each once. */
function pointGroupRotations(sg: SpaceGroup): SpaceGroup["operations"][number]["rotation"][] {
  const seen = new Map<string, SpaceGroup["operations"][number]["rotation"]>();
  for (const op of sg.operations) seen.set(op.rotation.map((row) => row.map((v) => Math.round(v)).join(",")).join(";"), op.rotation);
  return [...seen.values()];
}

export function reflectionStatistics(rows: readonly StatisticsRow[], cell: UnitCell, sg: SpaceGroup): ReflectionStatistics {
  const rotations = pointGroupRotations(sg);
  const centrosymmetric = rotations.some(isInversion);

  // Friedel coverage: unique under the point group, and whether −h is there too.
  const keys = new Set(rows.map((r) => canonicalKey(rotations, r.h, r.k, r.l)));
  let withMate = 0;
  if (!centrosymmetric) {
    for (const key of keys) {
      const [h, k, l] = key.split(",").map(Number) as [number, number, number];
      const mate = canonicalKey(rotations, -h, -k, -l);
      if (mate !== key && keys.has(mate)) withMate++;
    }
  }
  const friedel: FriedelCoverage = { centrosymmetric, unique: keys.size, withMate, fraction: keys.size > 0 && !centrosymmetric ? withMate / keys.size : 0 };

  // Merged in the Laue class: absences and intensity statistics read unique reflections.
  const merged = mergeEquivalents(rows.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.intensity, sigma: r.sigma })), sg.operations).reflections;
  const violated: AbsenceViolation[] = [];
  let measured = 0;
  const allowed: { d: number; i: number }[] = [];
  for (const m of merged) {
    if (m.h === 0 && m.k === 0 && m.l === 0) continue;
    const d = dSpacing(cell, m.h, m.k, m.l);
    if (isReflectionAbsent(sg.operations, m.h, m.k, m.l)) {
      measured++;
      if (m.sigma > 0 && m.intensity / m.sigma >= 3) violated.push({ h: m.h, k: m.k, l: m.l, d, iOverSigma: m.intensity / m.sigma });
    } else if (Number.isFinite(d) && d > 0) {
      allowed.push({ d, i: m.intensity });
    }
  }
  violated.sort((a, b) => b.iOverSigma - a.iOverSigma);

  // E² = I / ⟨I⟩ within resolution shells of equal count (the multiplicity ε of
  // special reflections is left at 1: a small bias for a few zones).
  allowed.sort((a, b) => b.d - a.d);
  const shellSize = Math.max(50, Math.round(allowed.length / 12));
  let sumAbs = 0;
  let weak = 0;
  let n = 0;
  for (let s = 0; s < allowed.length; s += shellSize) {
    const shell = allowed.slice(s, Math.min(allowed.length, s + shellSize));
    const mean = shell.reduce((acc, r) => acc + r.i, 0) / shell.length;
    if (!(mean > 0)) continue;
    for (const r of shell) {
      const e2 = r.i / mean;
      sumAbs += Math.abs(e2 - 1);
      if (e2 < 0.1) weak++;
      n++;
    }
  }
  const meanAbs = n > 0 ? sumAbs / n : NaN;
  const reading = !Number.isFinite(meanAbs) ? "too few reflections to read"
    : meanAbs >= (CENTRIC + ACENTRIC) / 2 ? `close to ${CENTRIC} (centrosymmetric)`
      : meanAbs >= ACENTRIC - 0.08 ? `close to ${ACENTRIC} (non-centrosymmetric)`
        : `below ${ACENTRIC}: fewer weak reflections than either expects — look for twinning (or pseudo-symmetry)`;
  return {
    friedel,
    absences: { measured, violated: violated.slice(0, 20) },
    intensities: { meanAbsE2Minus1: meanAbs, fractionWeak: n > 0 ? weak / n : NaN, reflections: n, reading },
  };
}
