/**
 * The merohedral twin laws a crystal's lattice allows, and how strongly its
 * measured intensities say each one twins it, before any model.
 *
 * A law is a symmetry of the lattice that the crystal's Laue class lacks:
 * h′ = R·h with Rᵀ·G*·R = G* keeps every d, so the domains' reflections
 * overlap exactly. The laws come one per coset of the Laue class, each as a
 * proper rotation (the class holds −1, so every coset has one), the simplest
 * of its coset. Yeates' H-test reads each law's twin fraction from the data
 * alone: over the acentric pairs (h, R·h) both measured and not related by
 * the crystal's own symmetry, H = |I₁ − I₂|/(I₁ + I₂), and ⟨H⟩ = ½ − α for a
 * twin of fraction α (Yeates, Methods Enzymol. 276 (1997) 344). A perfect
 * twin by one law leaves the others at α ≈ ⅛ (each observed intensity the
 * mean of two, ⟨H⟩ = ⅜); pseudo-symmetry raises every law's α.
 */

import type { SpaceGroup, UnitCell } from "@/core/crystal/types";
import type { Mat3 } from "@/core/math/types";
import { reciprocalMetricTensor } from "@/core/crystal/unitCell";
import { canonicalKey, isCentrosymmetric, laueRotations, pointGroupRotations } from "@/core/diffraction/merge";

export interface TwinLawTest {
  /** The law, h′ = R·h (rows), as `set_twin` and SHELXL's TWIN take it. */
  readonly matrix: Mat3;
  /** The law on the indices: "h, k, l → k, h, −l". */
  readonly indices: string;
  /** The pairs (h, R·h) both measured above the cut, h not equivalent to R·h: the acentric ones, or every one in a centrosymmetric group. */
  readonly pairs: number;
  /** ⟨|I₁ − I₂|/(I₁ + I₂)⟩ over them. */
  readonly meanH: number;
  /**
   * The intensity statistics the pairs follow. Acentric: ⟨|H|⟩ = ½ untwinned.
   * Centric (a centrosymmetric group, where every reflection is centric):
   * I₁/(I₁ + I₂) follows the arcsine law, ⟨|H|⟩ = 2/π untwinned.
   */
  readonly distribution: "acentric" | "centric";
  /** The twin fraction it reads, within [0, ½]: ½ − ⟨H⟩ (acentric), ½ − (π/4)·⟨H⟩ (centric). */
  readonly alpha: number;
}

export interface TwinLawRow {
  readonly h: number;
  readonly k: number;
  readonly l: number;
  readonly intensity: number;
  readonly sigma: number;
}

type M = number[][];

const det = (r: M): number => r[0]![0]! * (r[1]![1]! * r[2]![2]! - r[1]![2]! * r[2]![1]!) - r[0]![1]! * (r[1]![0]! * r[2]![2]! - r[1]![2]! * r[2]![0]!) + r[0]![2]! * (r[1]![0]! * r[2]![1]! - r[1]![1]! * r[2]![0]!);
const product = (a: M, b: M): M => a.map((row) => [0, 1, 2].map((j) => row.reduce((t, v, k) => t + v * b[k]![j]!, 0)));
const transpose = (a: M): M => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[j]![i]!));
const keyOf = (a: M): string => a.map((row) => row.map((v) => Math.round(v)).join(",")).join(";");
const apply = (r: M, h: number, k: number, l: number): [number, number, number] => [r[0]![0]! * h + r[0]![1]! * k + r[0]![2]! * l, r[1]![0]! * h + r[1]![1]! * k + r[1]![2]! * l, r[2]![0]! * h + r[2]![1]! * k + r[2]![2]! * l];

/** The proper rotations with entries −1, 0, 1 that keep the reciprocal metric: the lattice's rotations, h′ = R·h. */
export function latticeRotations(cell: UnitCell): Mat3[] {
  const g = reciprocalMetricTensor(cell);
  const tol = 1e-4 * Math.max(g[0]![0]!, g[1]![1]!, g[2]![2]!);
  const out: Mat3[] = [];
  const v = [-1, 0, 1];
  for (let n = 0; n < 19683; n++) {
    let x = n;
    const e: number[] = [];
    for (let i = 0; i < 9; i++) {
      e.push(v[x % 3]!);
      x = Math.floor(x / 3);
    }
    const r: M = [e.slice(0, 3), e.slice(3, 6), e.slice(6, 9)];
    if (det(r) !== 1) continue;
    let keeps = true;
    for (let i = 0; i < 3 && keeps; i++) {
      for (let j = 0; j < 3 && keeps; j++) {
        let s = 0;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) s += r[a]![i]! * g[a]![b]! * r[b]![j]!;
        keeps = Math.abs(s - g[i]![j]!) <= tol;
      }
    }
    if (keeps) out.push(r as unknown as Mat3);
  }
  return out;
}

/** A law's action on the indices, "h, k, l → k, h, −l". */
export function lawIndices(r: Mat3): string {
  const names = ["h", "k", "l"];
  const term = (row: readonly number[]): string => {
    const parts = row.flatMap((c, j) => (c === 0 ? [] : [`${c < 0 ? "−" : "+"}${Math.abs(c) === 1 ? "" : Math.abs(c)}${names[j]}`]));
    const text = parts.join("");
    return text.startsWith("+") ? text.slice(1) : text || "0";
  };
  return `h, k, l → ${r.map(term).join(", ")}`;
}

/**
 * The lattice's merohedral twin laws with Yeates' H-test of each, the
 * strongest first; empty when the lattice holds no symmetry beyond the Laue
 * class (an orthorhombic, monoclinic or rhombohedral lattice of its own class).
 * `minIOverSigma` keeps the pairs both above it (default 3): the noise of a
 * weak pair would raise ⟨H⟩ and lower α. The cut is not neutral either: it
 * drops the pairs with one weak member, whose H is large, so on weak data it
 * lowers ⟨H⟩ and raises α — an untwinned crystal measured at ⟨I/σ⟩ ≈ 20
 * reads α ≈ 0.1, at ⟨I/σ⟩ ≈ 5 about 0.2. Few pairs above the cut is the sign.
 */
export function merohedralTwinLaws(rows: readonly TwinLawRow[], cell: UnitCell, spaceGroup: SpaceGroup, options: { readonly minIOverSigma?: number } = {}): TwinLawTest[] {
  const ops = spaceGroup.operations;
  // The Laue class in the laws' convention: a direct-space rotation W takes h to Wᵀ·h.
  const laue = laueRotations(ops).map((w) => transpose(w as unknown as M));
  const inLaue = new Set(laue.map(keyOf));
  const seen = new Set<string>();
  const laws: Mat3[] = [];
  const simplicity = (r: M): number[] => [r.flat().filter((v) => v !== 0).length, r.flat().filter((v) => v < 0).length];
  for (const r of latticeRotations(cell)) {
    const rm = r as unknown as M;
    if (inLaue.has(keyOf(rm)) || seen.has(keyOf(rm))) continue;
    const coset = laue.map((m) => product(rm, m));
    coset.forEach((c) => seen.add(keyOf(c)));
    // The simplest proper rotation of the coset: fewest non-zero entries, then fewest negative ones.
    const best = coset.filter((c) => det(c) === 1).sort((a, b) => {
      const [sa, sb] = [simplicity(a), simplicity(b)];
      return sa[0]! - sb[0]! || sa[1]! - sb[1]! || keyOf(b).localeCompare(keyOf(a));
    })[0]!;
    laws.push(best as unknown as Mat3);
  }
  if (laws.length === 0) return [];

  // The intensities merged in the Laue class (the Friedel mates too: the test reads intensities, not their anomalous difference).
  const laueKeyRotations = laueRotations(ops);
  const merged = new Map<string, { h: number; k: number; l: number; sum: number; var: number; n: number }>();
  for (const r of rows) {
    if (!(r.sigma > 0) || !Number.isFinite(r.intensity)) continue;
    const key = canonicalKey(laueKeyRotations, r.h, r.k, r.l);
    const m = merged.get(key);
    if (m) {
      m.sum += r.intensity;
      m.var += r.sigma * r.sigma;
      m.n++;
    } else {
      merged.set(key, { h: r.h, k: r.k, l: r.l, sum: r.intensity, var: r.sigma * r.sigma, n: 1 });
    }
  }
  // Centric: h and −h related by a rotation of the point group; their intensities follow another distribution.
  // In a centrosymmetric group every reflection is: the test then reads the centric distribution.
  const centric = isCentrosymmetric(ops);
  const pg = pointGroupRotations(ops);
  const cut = options.minIOverSigma ?? 3;
  const strong = new Map<string, number>();
  for (const [key, m] of merged) {
    const i = m.sum / m.n;
    const s = Math.sqrt(m.var) / m.n;
    if (i < cut * s) continue;
    if (!centric && canonicalKey(pg, m.h, m.k, m.l) === canonicalKey(pg, -m.h, -m.k, -m.l)) continue;
    strong.set(key, i);
  }
  return laws.map((law) => {
    let sum = 0;
    let pairs = 0;
    for (const [key, i1] of strong) {
      const [h, k, l] = key.split(",").map(Number) as [number, number, number];
      const partner = canonicalKey(laueKeyRotations, ...apply(law as unknown as M, h, k, l));
      // Each pair once; a reflection the law maps onto its own equivalent carries no test.
      if (partner <= key) continue;
      const i2 = strong.get(partner);
      if (i2 === undefined || !(i1 + i2 > 0)) continue;
      sum += Math.abs(i1 - i2) / (i1 + i2);
      pairs++;
    }
    const meanH = pairs > 0 ? sum / pairs : NaN;
    // Twinned, H_obs = (1 − 2α)·H: ⟨|H|⟩ = (1 − 2α)·½ for acentric pairs, (1 − 2α)·2/π for centric ones.
    const untwinned = centric ? 2 / Math.PI : 0.5;
    const alpha = Number.isFinite(meanH) ? Math.min(0.5, Math.max(0, 0.5 * (1 - meanH / untwinned))) : NaN;
    return { matrix: law, indices: lawIndices(law), pairs, meanH, distribution: centric ? "centric" as const : "acentric" as const, alpha };
  }).sort((a, b) => (Number.isFinite(b.alpha) ? b.alpha : -1) - (Number.isFinite(a.alpha) ? a.alpha : -1));
}
