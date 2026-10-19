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
  /** Of them, the centric ones: −h is equivalent to h by the point group (h0l in 222), so no Bijvoet pair to measure. */
  readonly centric: number;
  /** Of the acentric ones, those whose Friedel mate was measured too. */
  readonly withMate: number;
  /** withMate / acentric (0 when the data were merged in the Laue class). */
  readonly fraction: number;
}

export interface AbsenceViolation {
  readonly h: number;
  readonly k: number;
  readonly l: number;
  readonly d: number;
  /** I/σ of the merged reflection. */
  readonly iOverSigma: number;
  /** I over the mean intensity of the allowed reflections at its resolution: how weak it is, as a fraction. */
  readonly ofAllowed?: number;
}

export interface IntensityStatistics {
  /** ⟨|E² − 1|⟩ over the merged, allowed reflections (E² = I/(ε·⟨I/ε⟩) in resolution shells). */
  readonly meanAbsE2Minus1: number;
  /** Fraction of acentric-like weak reflections: E² < 0.1 (≈ 0.095 acentric, ≈ 0.248 centric, fewer when twinned). */
  readonly fractionWeak: number;
  readonly reflections: number;
  /** What the value suggests, in words: centrosymmetric, non-centrosymmetric, or below both (twinning?); or why it is no test here. */
  readonly reading: string;
  /** False when the structure is too small or too special for Wilson statistics: the value then tests nothing. */
  readonly applies: boolean;
}

/** The model the statistics are read against: its independent sites, and how many sit on special positions. */
export interface StatisticsModel {
  readonly sites: number;
  readonly special: number;
  /** The model holds a twin whose domains' reflections overlap (not the inversion twin alone): it lowers ⟨|E²−1|⟩. */
  readonly twinned?: boolean;
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

/**
 * Wilson's distributions hold for many atoms of comparable scattering power in
 * general positions; a structure of a few independent sites, most of them on
 * special positions (corundum: two, both special), has intensity classes of its
 * own, and its ⟨|E² − 1|⟩ says nothing about a centre of symmetry.
 */
const WILSON_MIN_SITES = 6;

/** ε: how many point-group operations map h onto itself (h·R = h). */
function epsilon(rotations: readonly SpaceGroup["operations"][number]["rotation"][], h: number, k: number, l: number): number {
  let n = 0;
  for (const R of rotations) {
    const hp = Math.round(R[0]![0]! * h + R[1]![0]! * k + R[2]![0]! * l);
    const kp = Math.round(R[0]![1]! * h + R[1]![1]! * k + R[2]![1]! * l);
    const lp = Math.round(R[0]![2]! * h + R[1]![2]! * k + R[2]![2]! * l);
    if (hp === h && kp === k && lp === l) n++;
  }
  return Math.max(1, n);
}

export function reflectionStatistics(rows: readonly StatisticsRow[], cell: UnitCell, sg: SpaceGroup, model?: StatisticsModel): ReflectionStatistics {
  const rotations = pointGroupRotations(sg);
  const centrosymmetric = rotations.some(isInversion);

  // Friedel coverage: unique under the point group, and whether −h is there too; the systematic absences are not data.
  const keys = new Set(rows.filter((r) => !isReflectionAbsent(sg.operations, r.h, r.k, r.l)).map((r) => canonicalKey(rotations, r.h, r.k, r.l)));
  let withMate = 0;
  let centric = 0;
  if (!centrosymmetric) {
    for (const key of keys) {
      const [h, k, l] = key.split(",").map(Number) as [number, number, number];
      const mate = canonicalKey(rotations, -h, -k, -l);
      if (mate === key) centric++;
      else if (keys.has(mate)) withMate++;
    }
  }
  const acentric = keys.size - centric;
  const friedel: FriedelCoverage = {
    centrosymmetric,
    unique: keys.size,
    centric,
    withMate,
    fraction: acentric > 0 && !centrosymmetric ? withMate / acentric : 0,
  };

  // Merged in the Laue class: absences and intensity statistics read unique reflections.
  const merged = mergeEquivalents(rows.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.intensity, sigma: r.sigma })), sg.operations).reflections;
  let measured = 0;
  const allowed: { d: number; i: number; eps: number }[] = [];
  const forbidden: { m: (typeof merged)[number]; d: number }[] = [];
  // The absences counted as SHELXL counts them: in an acentric group, a forbidden reflection and its Friedel mate apart.
  const absent = rows.filter((r) => isReflectionAbsent(sg.operations, r.h, r.k, r.l) && !(r.h === 0 && r.k === 0 && r.l === 0));
  for (const m of mergeEquivalents(absent.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.intensity, sigma: r.sigma })), sg.operations, { friedel: centrosymmetric }).reflections) {
    measured++;
    if (m.sigma > 0 && m.intensity / m.sigma >= 3) forbidden.push({ m, d: dSpacing(cell, m.h, m.k, m.l) });
  }
  for (const m of merged) {
    if ((m.h === 0 && m.k === 0 && m.l === 0) || isReflectionAbsent(sg.operations, m.h, m.k, m.l)) continue;
    const d = dSpacing(cell, m.h, m.k, m.l);
    if (Number.isFinite(d) && d > 0) allowed.push({ d, i: m.intensity, eps: epsilon(rotations, m.h, m.k, m.l) });
  }

  // E² = I / (ε·⟨I/ε⟩) within resolution shells of equal count.
  allowed.sort((a, b) => b.d - a.d);
  const shellSize = Math.max(50, Math.round(allowed.length / 12));
  const shellMeans: { dLow: number; mean: number }[] = [];
  let sumAbs = 0;
  let weak = 0;
  let n = 0;
  for (let s = 0; s < allowed.length; s += shellSize) {
    const shell = allowed.slice(s, Math.min(allowed.length, s + shellSize));
    const mean = shell.reduce((acc, r) => acc + r.i / r.eps, 0) / shell.length;
    shellMeans.push({ dLow: shell[shell.length - 1]!.d, mean: shell.reduce((acc, r) => acc + r.i, 0) / shell.length });
    if (!(mean > 0)) continue;
    for (const r of shell) {
      const e2 = r.i / (r.eps * mean);
      sumAbs += Math.abs(e2 - 1);
      if (e2 < 0.1) weak++;
      n++;
    }
  }
  // A forbidden reflection's intensity against the allowed ones at its d.
  const allowedMeanAt = (d: number): number | undefined => (shellMeans.find((sh) => d >= sh.dLow) ?? shellMeans.at(-1))?.mean;
  const violated: AbsenceViolation[] = forbidden.map(({ m, d }) => {
    const ref = allowedMeanAt(d);
    return { h: m.h, k: m.k, l: m.l, d, iOverSigma: m.intensity / m.sigma, ...(ref && ref > 0 ? { ofAllowed: m.intensity / ref } : {}) };
  }).sort((a, b) => b.iOverSigma - a.iOverSigma);

  const meanAbs = n > 0 ? sumAbs / n : NaN;
  const applies = !model || (model.sites >= WILSON_MIN_SITES && model.special <= model.sites / 2);
  const reading = !Number.isFinite(meanAbs) ? "too few reflections to read"
    : !applies ? `no test here: ${model!.sites} independent site${model!.sites === 1 ? "" : "s"}, ${model!.special} on special positions — Wilson's distributions assume many atoms in general positions`
      : meanAbs >= (CENTRIC + ACENTRIC) / 2 ? `close to ${CENTRIC} (centrosymmetric)`
        : meanAbs >= ACENTRIC - 0.08 ? `close to ${ACENTRIC} (non-centrosymmetric)`
          : model?.twinned ? `below ${ACENTRIC}: fewer weak reflections than either expects — what the twin the model holds gives, its domains' intensities summed`
            : `below ${ACENTRIC}: fewer weak reflections than either expects — look for twinning (or pseudo-symmetry)`;
  return {
    friedel,
    absences: { measured, violated: violated.slice(0, 20) },
    intensities: { meanAbsE2Minus1: meanAbs, fractionWeak: n > 0 ? weak / n : NaN, reflections: n, reading, applies },
  };
}
