/**
 * Commensurate propagation-vector (k-vector) search from powder magnetic-peak
 * positions.
 *
 * Method (the standard powder k-search, e.g. FullProf's `k_search` /
 * Rodríguez-Carvajal): magnetic reflections appear at G ± k for reciprocal
 * lattice vectors G. Given the d-spacings of the observed magnetic-only peaks
 * (extra peaks not indexed by the nuclear cell), scan a set of candidate k
 * (commensurate rational grid + high-symmetry Brillouin-zone points), and for
 * each score how well the predicted satellite positions {|G ± k|} reproduce the
 * observed peaks. Rank by matched-peak count, then position RMSD, then
 * simplicity (smallest denominator).
 *
 * Scope: single k, commensurate, position-only scoring (no intensity fit). This
 * finds *candidate* propagation vectors; confirming one needs a magnetic
 * refinement (M4). Symmetry-equivalent k give identical powder d-sets, so they
 * tie — the cell's symmetry decides which representative is physical.
 *
 * References: Rodríguez-Carvajal, *Physica B* 192 (1993) 55 (FullProf);
 * Bertaut, *Acta Cryst.* A24 (1968) 217 (magnetic reflection conditions).
 */

import type { UnitCell } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { inverseDSquared, reciprocalTensorA } from "@/core/crystal/unitCell";
import { isReciprocalLatticeVector } from "@/core/crystal/symmetry";

export interface KCandidate {
  /** Propagation vector (reciprocal-lattice units), components in [0, ½]. */
  readonly k: Vec3;
  /** Pretty label, e.g. "(½ 0 0)". */
  readonly label: string;
  /** Observed peaks explained (a satellite within tolerance). */
  readonly matched: number;
  /** Total observed peaks. */
  readonly total: number;
  /** RMS |Δd| over matched peaks (Å). */
  readonly rmsd: number;
  /** Ranking score (higher is better): matched fraction penalised by RMSD. */
  readonly score: number;
  /** WHICH peaks this k explains: index into the caller's `observedD` list plus
   *  the |Δd| (Å) to the matching satellite — the per-candidate evidence. */
  readonly matches: readonly { readonly index: number; readonly delta: number }[];
}

export interface KSearchOptions {
  /** Match tolerance on d (Å). Default 0.02 (K_SEARCH_DEFAULTS). */
  readonly tolerance?: number;
  /**
   * Match tolerance relative to d, taken where it is the wider: a line's width
   * in d grows with d (at fixed angular width, Δd = d·cotθ·Δθ), so a fixed Å
   * tolerance that suits d ≈ 2 Å is a fraction of a line at 9 Å (Cr₂WO₆'s
   * magnetic 0 0 1 sat 0.031 Å — 0.35 % — from its position, and k = 0 lost to
   * spurious vectors). Default 0.005 (K_SEARCH_DEFAULTS); 0 for the absolute tolerance only.
   */
  readonly relativeTolerance?: number;
  /** Denominators for the commensurate grid. Default [2, 3, 4, 6]. */
  readonly denominators?: readonly number[];
  /**
   * Half-range of integer hkl for satellite prediction. Default from the
   * cell: along each axis, the indices that reach the smallest d searched
   * (|h| ≤ a/d, plus one for k), so a large cell's high-index satellites are
   * predicted (a fixed ±4 reached only d ≈ 2.6 Å on a 20 Å cell).
   */
  readonly hklRange?: number;
  /** Max candidates returned. Default 12. */
  readonly limit?: number;
  /**
   * Only consider observed peaks below this |Q| (Å⁻¹), with Q = 2π/d: the
   * magnetic form factor falls off fast with Q, and a cut suppresses spurious
   * high-Q matches. Default 0, no cut (K_SEARCH_DEFAULTS): the peaks given
   * are the criterion, and a hidden cut drops peaks the user (or an agent)
   * chose.
   */
  readonly maxQ?: number;
  /**
   * Optional per-peak weights, parallel to `observedD` (e.g. each peak's
   * statistical significance): the matched fraction in the ranking becomes
   * weight-weighted, so explaining a strong, certain peak counts for more than
   * explaining a marginal one. The reported `matched`/`total` stay plain counts.
   */
  readonly weights?: readonly number[];
  /**
   * The lattice's centring translations (centringTranslations of the space
   * group: (½ ½ ½) for I). The nuclear reflections are then only the G with
   * G·t integer, and an integer k that is not one of them (k = (0 0 1) of an
   * I lattice) is a vector of its own. Default none: a primitive lattice.
   */
  readonly centring?: readonly Vec3[];
}

/**
 * The search's one option set, the app's and MCP's alike: a peak matches
 * within 0.02 Å, or 0.5 % of d where that is wider (a line's width in d grows
 * with d), and no Q cut.
 */
export const K_SEARCH_DEFAULTS = { tolerance: 0.02, relativeTolerance: 0.005, maxQ: 0 } as const;

/** The largest hkl half-range the search sizes from a cell. */
const MAX_HKL = 24;

/** Along each axis, the hkl half-range that reaches d = dMin: |h| = |G·a| ≤ a/d, plus one for k's offset. */
function hklRangeOf(cell: UnitCell, dMin: number): Vec3 {
  const n = (length: number): number => Math.min(MAX_HKL, Math.ceil(length / dMin) + 1);
  return [n(cell.a), n(cell.b), n(cell.c)];
}

const FRAC_LABEL: ReadonlyMap<string, string> = new Map([
  ["0.0000", "0"], ["0.5000", "½"], ["0.3333", "⅓"], ["0.6667", "⅔"],
  ["0.2500", "¼"], ["0.7500", "¾"], ["0.1667", "⅙"], ["0.8333", "⅚"],
  ["1.0000", "1"],
]);

/** A fraction with a denominator up to 12 that is x (4/3, 3/2 in a centred lattice's coset), or null. */
function exactFraction(x: number): string | null {
  for (const d of [2, 3, 4, 6, 8, 12]) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-9) return `${n}/${d}`;
  }
  return null;
}

function comp(x: number): string {
  if (x < -1e-9) return `−${comp(-x)}`;
  // Exact, never rounded: (0 0 4/3), not (0 0 1.333), which would read back as another k.
  return FRAC_LABEL.get(x.toFixed(4)) ?? exactFraction(x) ?? x.toFixed(3);
}

export function kLabel(k: Vec3): string {
  return `(${comp(k[0])} ${comp(k[1])} ${comp(k[2])})`;
}

/**
 * Candidate k set: the commensurate rational grid with the given denominators,
 * each component in [0, ½] (k and 1−k / −k give the same powder d-set), plus Γ.
 */
export function candidateKVectors(denominators: readonly number[] = [2, 3, 4, 6]): Vec3[] {
  const values = new Set<number>([0]);
  for (const n of denominators) {
    for (let i = 1; i * 2 <= n; i++) values.add(i / n); // ≤ ½
  }
  const axis = [...values].sort((a, b) => a - b);
  const out: Vec3[] = [];
  const seen = new Set<string>();
  for (const x of axis) for (const y of axis) for (const z of axis) {
    const key = [x, y, z].map((v) => v.toFixed(4)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([x, y, z]);
  }
  return out;
}

/**
 * The integer vectors that are not reciprocal-lattice vectors of a centred
 * lattice, one per class modulo the lattice: [(0 0 1)] for I, three for F,
 * none for P. Each added to the grid gives the vectors a primitive grid misses.
 */
function integerCosets(centring: readonly Vec3[]): Vec3[] {
  const reps: Vec3[] = [[0, 0, 0]];
  for (let x = 0; x <= 1; x++) for (let y = 0; y <= 1; y++) for (let z = 0; z <= 1; z++) {
    const v: Vec3 = [x, y, z];
    if (!reps.some((r) => isReciprocalLatticeVector([v[0] - r[0], v[1] - r[1], v[2] - r[2]], centring))) reps.push(v);
  }
  return reps;
}

/** One key per powder-equivalent k: k and −k, each modulo the (centred) reciprocal lattice. */
function kClass(k: Vec3, centring: readonly Vec3[]): string {
  const keys: string[] = [];
  for (const s of [1, -1]) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
    const g: Vec3 = [a, b, c];
    if (!isReciprocalLatticeVector(g, centring)) continue;
    keys.push([s * k[0] + a, s * k[1] + b, s * k[2] + c].map((v) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(4)).join(","));
  }
  return keys.sort()[0]!;
}

/**
 * The first-octant grid point with its components' signs varied, the overall
 * sign fixed (k ≡ −k): in an oblique cell (a metric angle off 90°) the h·l,
 * h·k or k·l term tells (¼ 0 ¼) from (¼ 0 −¼), which a monoclinic or
 * triclinic crystal needs; with every angle 90° they give one d-set.
 */
function signVariants(k: Vec3): Vec3[] {
  const nonzero = [0, 1, 2].filter((i) => Math.abs(k[i]!) > 1e-9);
  const out: Vec3[] = [];
  for (let mask = 0; mask < 1 << nonzero.length; mask++) {
    if (nonzero.length > 0 && mask & 1) continue; // the first nonzero component stays positive
    const flip = (i: number): number => {
      const bit = nonzero.indexOf(i);
      return bit >= 0 && mask & (1 << bit) ? -k[i]! : k[i]!;
    };
    out.push([flip(0), flip(1), flip(2)]);
  }
  return out;
}

/**
 * The lattice's reflections G within ±range, each with |G|² and the gradient
 * the satellites need: |G ± k|² = |G|² ± ∇·k + |k|², a few flops per G for
 * each k instead of the metric afresh.
 */
function reflectionTable(cell: UnitCell, range: Vec3, centring: readonly Vec3[]): { readonly q: Float64Array; readonly grad: Float64Array; readonly A: ReturnType<typeof reciprocalTensorA> } {
  const A = reciprocalTensorA(cell);
  const q: number[] = [];
  const grad: number[] = [];
  for (let h = -range[0]; h <= range[0]; h++) {
    for (let kk = -range[1]; kk <= range[1]; kk++) {
      for (let l = -range[2]; l <= range[2]; l++) {
        // Only the centred lattice's own reflections carry satellites.
        if (centring.length > 0 && !isReciprocalLatticeVector([h, kk, l], centring)) continue;
        q.push(A.a11 * h * h + A.a22 * kk * kk + A.a33 * l * l + A.a12 * h * kk + A.a13 * h * l + A.a23 * kk * l);
        grad.push(2 * A.a11 * h + A.a12 * kk + A.a13 * l, A.a12 * h + 2 * A.a22 * kk + A.a23 * l, A.a13 * h + A.a23 * kk + 2 * A.a33 * l);
      }
    }
  }
  return { q: Float64Array.from(q), grad: Float64Array.from(grad), A };
}

/**
 * Each observed peak's distance to the nearest satellite G ± k (exact up to
 * `window`, Infinity beyond), and the satellites' d-set in [dMin, dMax] as
 * its count and moments. `sorted` is the observed d ascending.
 */
function satelliteDistances(table: ReturnType<typeof reflectionTable>, k: Vec3, sorted: readonly number[], window: number, dMin: number, dMax: number): { readonly best: Float64Array; readonly dSet: string } {
  const { q, grad, A } = table;
  const qk = A.a11 * k[0] * k[0] + A.a22 * k[1] * k[1] + A.a33 * k[2] * k[2] + A.a12 * k[0] * k[1] + A.a13 * k[0] * k[2] + A.a23 * k[1] * k[2];
  const best = new Float64Array(sorted.length).fill(Infinity);
  let count = 0;
  let s1 = 0;
  let s2 = 0;
  for (let g = 0; g < q.length; g++) {
    const lin = grad[3 * g]! * k[0] + grad[3 * g + 1]! * k[1] + grad[3 * g + 2]! * k[2];
    // Both satellites G+k and G−k (they differ for non-½ components); Γ's has no d.
    for (const s of [1, -1]) {
      const inv = q[g]! + s * lin + qk;
      if (!(inv > 1e-12)) continue;
      const d = 1 / Math.sqrt(inv);
      if (d < dMin || d > dMax) continue;
      count++;
      s1 += d;
      s2 += d * d;
      // The observed peaks within the window of this satellite.
      let a = 0;
      let b = sorted.length;
      while (a < b) {
        const m = (a + b) >> 1;
        if (sorted[m]! < d - window) a = m + 1;
        else b = m;
      }
      for (let i = a; i < sorted.length && sorted[i]! <= d + window; i++) {
        const e = Math.abs(sorted[i]! - d);
        if (e < best[i]!) best[i] = e;
      }
    }
  }
  return { best, dSet: `${count}:${s1.toFixed(6)}:${s2.toFixed(6)}` };
}

/** Predicted magnetic-satellite d-spacings (Å) for propagation vector k, about the lattice's reflections G (hkl within ±range along each axis). */
function predictedSatelliteD(cell: UnitCell, k: Vec3, range: Vec3, dMin: number, dMax: number, centring: readonly Vec3[] = []): number[] {
  const A = reciprocalTensorA(cell);
  const ds: number[] = [];
  for (let h = -range[0]; h <= range[0]; h++) {
    for (let kk = -range[1]; kk <= range[1]; kk++) {
      for (let l = -range[2]; l <= range[2]; l++) {
        // Only the centred lattice's own reflections carry satellites.
        if (centring.length > 0 && !isReciprocalLatticeVector([h, kk, l], centring)) continue;
        // Both satellites G+k and G−k (they differ for non-½ components).
        for (const s of [1, -1]) {
          const m0 = h + s * k[0], m1 = kk + s * k[1], m2 = l + s * k[2];
          if (m0 === 0 && m1 === 0 && m2 === 0) continue; // Γ satellite has no d
          const inv = A.a11 * m0 * m0 + A.a22 * m1 * m1 + A.a33 * m2 * m2 + A.a12 * m0 * m1 + A.a13 * m0 * m2 + A.a23 * m1 * m2;
          if (inv <= 0) continue;
          const d = 1 / Math.sqrt(inv);
          if (d >= dMin && d <= dMax) ds.push(d);
        }
      }
    }
  }
  return ds;
}

/**
 * Rank candidate propagation vectors by how well their satellites {|G ± k|}
 * reproduce the observed magnetic-peak d-spacings.
 */
export function searchPropagationVector(
  cell: UnitCell,
  observedD: readonly number[],
  options: KSearchOptions = {},
): KCandidate[] {
  const { tolerance = K_SEARCH_DEFAULTS.tolerance, relativeTolerance = K_SEARCH_DEFAULTS.relativeTolerance, denominators = [2, 3, 4, 6], hklRange, limit = 12, maxQ = K_SEARCH_DEFAULTS.maxQ, weights, centring = [] } = options;
  const tolAt = (d: number): number => Math.max(tolerance, relativeTolerance * d);
  // Q = 2π/d; keep only low-Q peaks (large d), where magnetic scattering lives.
  // Weights stay parallel through the filter.
  const dMinQ = maxQ > 0 && Number.isFinite(maxQ) ? (2 * Math.PI) / maxQ : 0;
  const obs: { d: number; w: number; index: number }[] = [];
  observedD.forEach((d, i) => {
    if (!Number.isFinite(d) || d <= 0 || d < dMinQ) return;
    const w = weights?.[i];
    obs.push({ d, w: w !== undefined && Number.isFinite(w) && w > 0 ? w : 1, index: i });
  });
  if (obs.length === 0) return [];
  const dMax = Math.max(...obs.map((o) => o.d)) * 1.05;
  const dMin = Math.min(...obs.map((o) => o.d)) * 0.95;
  const totalW = obs.reduce((s, o) => s + o.w, 0);
  const range: Vec3 = hklRange !== undefined ? [hklRange, hklRange, hklRange] : hklRangeOf(cell, dMin);
  const table = reflectionTable(cell, range, centring);
  const byD = [...obs].sort((a, b) => a.d - b.d);
  const sorted = byD.map((o) => o.d);
  const window = Math.max(...obs.map((o) => tolAt(o.d)));

  // The grid, and in a centred lattice the grid shifted by each integer vector the lattice lacks; one k per class.
  // In an oblique cell each grid point's sign variants too, kept where their satellites fall elsewhere.
  const oblique = [cell.alpha, cell.beta, cell.gamma].some((angle) => Math.abs(angle - 90) > 1e-6);
  const grid = candidateKVectors(denominators);
  const classes = new Set<string>();
  const kVectors: { k: Vec3; best: Float64Array }[] = [];
  const dSets = new Set<string>();
  for (const c of integerCosets(centring)) {
    for (const g of grid) {
      for (const [i, v] of (oblique ? signVariants(g) : [g]).entries()) {
        const k: Vec3 = [v[0] + c[0], v[1] + c[1], v[2] + c[2]];
        const key = kClass(k, centring);
        if (classes.has(key)) continue;
        const { best, dSet } = satelliteDistances(table, k, sorted, window, dMin, dMax);
        // A variant whose satellites a kept k already puts in the window adds a tie, not a k:
        // the d-set's count and moments stand for it (a sum's order moves only its last bits).
        if (oblique) {
          if (i > 0 && dSets.has(dSet)) continue;
          dSets.add(dSet);
        }
        classes.add(key);
        kVectors.push({ k, best });
      }
    }
  }
  const candidates: (KCandidate & { matchedW: number })[] = kVectors.map(({ k, best: nearest }) => {
    let matched = 0;
    let matchedW = 0;
    let sumSq = 0;
    const found: { index: number; delta: number }[] = [];
    byD.forEach((o, j) => {
      const best = nearest[j]!;
      if (best <= tolAt(o.d)) {
        matched++;
        matchedW += o.w;
        sumSq += best * best;
        found.push({ index: o.index, delta: best });
      }
    });
    // In the caller's order, as the observed list gives them.
    const matches = found.sort((a, b) => a.index - b.index);
    const rmsd = matched > 0 ? Math.sqrt(sumSq / matched) : Infinity;
    // Score: (weighted) fraction explained, minus a small RMSD penalty
    // (Å → fraction of tol). With no weights this is the plain matched fraction.
    const score = matchedW / totalW - (matched > 0 ? (rmsd / tolerance) * 0.05 : 0);
    return { k, label: kLabel(k), matched, total: obs.length, rmsd, score, matches, matchedW };
  });

  // Prefer simpler k (smaller denominators) among k that explain the same
  // peaks: inside the tolerance a smaller RMSD is noise, and with few peaks a
  // complex k matches by chance (Cr₂WO₆'s two magnetic peaks fit (0 ½ ¼) as
  // closely as k = 0). RMSD decides between k of equal complexity.
  const denomComplexity = (k: Vec3): number =>
    k.reduce((acc, v) => acc + (v === 0 ? 0 : minDenominator(v)), 0);

  candidates.sort((a, b) =>
    b.matchedW - a.matchedW ||
    denomComplexity(a.k) - denomComplexity(b.k) ||
    a.rmsd - b.rmsd ||
    a.k.reduce((s, v) => s + Math.abs(v), 0) - b.k.reduce((s, v) => s + Math.abs(v), 0),
  );
  return candidates.slice(0, limit).map(({ matchedW: _w, ...c }) => c);
}

/**
 * For each observed peak, the |Δd| (Å) to the nearest satellite G ± k of the
 * given propagation vector — the per-peak quantitative check of the CURRENT k
 * (the search above reports only aggregate matched counts). Infinity when no
 * satellite falls in the peaks' d-window.
 */
export function satelliteMatchDeltas(
  cell: UnitCell,
  k: Vec3,
  observedD: readonly number[],
  options: Pick<KSearchOptions, "hklRange"> = {},
): number[] {
  const valid = observedD.filter((d) => Number.isFinite(d) && d > 0);
  if (valid.length === 0) return observedD.map(() => Infinity);
  const dMax = Math.max(...valid) * 1.05;
  const dMin = Math.min(...valid) * 0.95;
  const range: Vec3 = options.hklRange !== undefined ? [options.hklRange, options.hklRange, options.hklRange] : hklRangeOf(cell, dMin);
  const predicted = predictedSatelliteD(cell, k, range, dMin, dMax);
  return observedD.map((d) => {
    if (!Number.isFinite(d) || d <= 0) return Infinity;
    let best = Infinity;
    for (const p of predicted) {
      const e = Math.abs(p - d);
      if (e < best) best = e;
    }
    return best;
  });
}

/** Smallest denominator n such that value ≈ m/n (for complexity tie-breaking). */
function minDenominator(v: number): number {
  for (let n = 1; n <= 12; n++) if (Math.abs(v * n - Math.round(v * n)) < 1e-4) return n;
  return 12;
}

/**
 * The magnetic satellites G ± k of a cell in [dMin, dMax], each with its
 * label ("1 0 0 + k"): the lines a magnetic model puts in a pattern. G runs
 * over the (centred) lattice's own reflections; k = 0 gives the lattice
 * points themselves, the space group's absences included (magnetic order can
 * break them).
 */
export function satellitePositions(cell: UnitCell, k: Vec3, dMin: number, dMax: number, centring: readonly Vec3[] = []): { d: number; hkl: string }[] {
  const zero = k.every((v) => Math.abs(v) < 1e-9);
  const n = Math.min(16, Math.ceil(Math.max(cell.a, cell.b, cell.c) / dMin) + 1);
  const out: { d: number; hkl: string }[] = [];
  for (let h = -n; h <= n; h++) for (let kk = -n; kk <= n; kk++) for (let l = -n; l <= n; l++) {
    if (centring.length > 0 && !isReciprocalLatticeVector([h, kk, l], centring)) continue;
    for (const s of zero ? [1] : [1, -1]) {
      const m: Vec3 = [h + s * k[0], kk + s * k[1], l + s * k[2]];
      if (m.every((v) => Math.abs(v) < 1e-9)) continue;
      const inv = inverseDSquared(cell, m[0], m[1], m[2]);
      if (!(inv > 0)) continue;
      const d = 1 / Math.sqrt(inv);
      if (d >= dMin && d <= dMax) out.push({ d, hkl: zero ? `${h} ${kk} ${l}` : `${h} ${kk} ${l} ${s > 0 ? "+" : "−"} k` });
    }
  }
  return out;
}
