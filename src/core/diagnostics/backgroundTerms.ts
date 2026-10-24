/**
 * How flexible the background may be, read where it is the background's alone.
 *
 * A background with enough terms follows anything smooth enough, a peak the
 * model lacks included: on a POWGEN-like pattern with a smooth background and
 * one Gaussian line no phase explains (FWHM 3 % of its d, at d = 5.3 Å), 4
 * Chebyshev terms take 18 % of the line's intensity, 12 terms 62 % and 24 terms
 * 97 % (backgroundTerms.test.ts measures it). So the number of terms is
 * chosen on the points where the model is background alone, with the excess no
 * reflection explains taken out first:
 *
 *  - **Background points**: inside the fit, and the model's peaks under half a
 *    σ there (fitDiagnosis.ts reads the background misfit on the same points).
 *  - **Unexplained excess** (`unexplainedExcess`): a run of those points whose
 *    residual stands above the noise on the scale of a diffraction line — a
 *    matched box filter of 1, 2, 4 and 8 line widths over the residual in σ,
 *    after a running mean over 24 line widths is taken off it, so a misfit of
 *    the background's own (which spans most of the pattern) is not one. The
 *    threshold holds the family-wise false alarm on pure noise at 1 %
 *    (Bonferroni over the independent windows of every scale). Such excess is
 *    a line — magnetic, an impurity, the sample environment — not background.
 *  - **The count** (`backgroundTermsReading`): the background fitted alone to
 *    the remaining points for 1 … 24 coefficients of the page's basis (linear
 *    least squares, the refinement's weights), and the count with the lowest
 *    BIC = χ² + k·ln n (Schwarz 1978): a term is worth adding when it lowers χ²
 *    by more than ln n (≈ 8 on a few thousand points, about a 2.8σ term),
 *    against AIC's 2, which over-fits a long pattern. BIC needs no nesting, so
 *    it compares interpolation backgrounds whose points move with their count.
 *
 * Limits: the points under the lines tell nothing of the background, so a
 * short-d stretch of overlapping TOF lines is not read; a hump wider than 24
 * line widths (amorphous scattering, broad diffuse magnetic scattering) is
 * background by this reading; the BIC trusts the σ (an underestimated σ asks
 * for more terms; the unknown-variance form n·ln(χ²/n) + k·ln n picked the same
 * counts on every pattern tried). The count is read on the model's residual:
 * on the 350 K Mn₃Ga bank refined without its MnO impurity the excess found is
 * MnO's (d = 1.341, 2.567, 2.218 Å …), and the points between the lines still
 * ask for 19–23 terms: a count read on the residual of a model that lacks a
 * phase. Explain the excess first, then read the count again. Without three resolved lines
 * there is no line width, and no excess is looked for.
 */

import { evaluateBackground, interpAnchors, type BackgroundType } from "@/core/diffraction/background";
import { erfc } from "@/core/diffraction/profile";
import { solveSymmetricPseudoInverse } from "@/core/math/linalg";
import { minMax } from "@/core/math/extent";
import { relativeLineWidth } from "@/core/diagnostics/assessment";

/** The model is background alone where its peaks put less than this many σ. */
export const BACKGROUND_ALONE_SIGMA = 0.5;
/** Matched-filter widths, in line widths (FWHM). */
const SCALES = [1, 2, 4, 8] as const;
/** The running mean taken off the residual first, in line widths: wider excess is background. */
const BASELINE_WIDTHS = 24;
/** Family-wise false-alarm probability on pure noise. */
const FALSE_ALARM = 0.01;
/** Most coefficients the page offers (the Background group, set_background). */
const MAX_TERMS = 24;

export interface BackgroundPointsInput {
  readonly x: readonly number[];
  readonly yObs: readonly number[];
  readonly yCalc: readonly number[];
  readonly yBackground: readonly number[];
  readonly sigma: readonly number[];
  readonly include: readonly boolean[];
  /** d (Å) of every point. */
  readonly d: readonly number[];
}

/** A run of background points whose residual stands above the noise on a line's scale. */
export interface BackgroundExcess {
  /** d (Å) and x of the window that carries it most. */
  readonly d: number;
  readonly x: number;
  /** That window's summed residual over √(points), in σ (1 for noise). */
  readonly significance: number;
  /** Its extent on the axis (the run of points it covers). */
  readonly xFrom: number;
  readonly xTo: number;
  /** Net counts above the calculated curve over the run (Σ (y_obs − y_calc)·|Δx|). */
  readonly netIntensity: number;
}

/** Points where the model is background alone. */
export function backgroundPoints(input: Pick<BackgroundPointsInput, "yCalc" | "yBackground" | "sigma" | "include">): boolean[] {
  return input.yCalc.map((y, i) => input.include[i]! && y - input.yBackground[i]! <= BACKGROUND_ALONE_SIGMA * input.sigma[i]!);
}

/** The upper normal tail Q(z) = P(Z > z). */
const upperTail = (z: number): number => 0.5 * erfc(z / Math.SQRT2);

/** z with Q(z) = p, by bisection (p in (0, 0.5)). */
function upperQuantile(p: number): number {
  let lo = 0, hi = 40;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (upperTail(mid) > p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The excess between the lines that no reflection explains (see the module
 * note), and the points it covers. `lineWidth` is the lines' FWHM over d, read
 * from the calculated curve when not given; none found, nothing is looked for.
 */
export function unexplainedExcess(input: BackgroundPointsInput, base?: readonly boolean[], lineWidth?: number): { readonly features: BackgroundExcess[]; readonly mask: boolean[]; readonly lineWidth?: number } {
  const n = input.x.length;
  const mask = new Array<boolean>(n).fill(false);
  const w = lineWidth ?? relativeLineWidth(input.d, input.yCalc);
  const on = base ?? backgroundPoints(input);
  if (w === undefined || !(w > 0)) return { features: [], mask };
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (on[i] && input.d[i]! > 0 && input.sigma[i]! > 0) idx.push(i);
  const m = idx.length;
  if (m < 20) return { features: [], mask };
  // Order by d, so a window in d is a run of positions (a 2θ axis runs the other way).
  idx.sort((a, b) => input.d[a]! - input.d[b]!);
  const dd = idx.map((i) => input.d[i]!);
  const r = idx.map((i) => (input.yObs[i]! - input.yCalc[i]!) / input.sigma[i]!);
  // Windows [lo, hi) of every position holding the points within ±half·w·d of it.
  const windows = (half: number): { lo: Int32Array; hi: Int32Array } => {
    const lo = new Int32Array(m), hi = new Int32Array(m);
    let a = 0, b = 0;
    for (let k = 0; k < m; k++) {
      const reach = half * w * dd[k]!;
      while (dd[a]! < dd[k]! - reach) a++;
      if (b < k + 1) b = k + 1;
      while (b < m && dd[b]! <= dd[k]! + reach) b++;
      lo[k] = a; hi[k] = b;
    }
    return { lo, hi };
  };
  const prefix = (v: readonly number[]): Float64Array => {
    const p = new Float64Array(v.length + 1);
    for (let k = 0; k < v.length; k++) p[k + 1] = p[k]! + v[k]!;
    return p;
  };
  // High-pass: the running mean over BASELINE_WIDTHS line widths taken off.
  const wide = windows(BASELINE_WIDTHS / 2);
  const pr = prefix(r);
  const hp = r.map((v, k) => v - (pr[wide.hi[k]!]! - pr[wide.lo[k]!]!) / (wide.hi[k]! - wide.lo[k]!));
  const ph = prefix(hp);
  // Every scale's statistic, and the number of independent windows it tests.
  const scans = SCALES.map((s) => {
    const { lo, hi } = windows(s / 2);
    const z = new Float64Array(m);
    let sizes = 0;
    for (let k = 0; k < m; k++) {
      const c = hi[k]! - lo[k]!;
      sizes += c;
      z[k] = c >= 3 ? (ph[hi[k]!]! - ph[lo[k]!]!) / Math.sqrt(c) : 0;
    }
    return { z, lo, hi, tests: m / Math.max(1, sizes / m) };
  });
  const threshold = upperQuantile(FALSE_ALARM / scans.reduce((t, sc) => t + sc.tests, 0));
  // Each detection's run: outward from its window while the scale's filtered
  // residual stays positive, no further than the baseline's half-width.
  const covered = new Uint8Array(m);
  const runs: { from: number; to: number; best: number; at: number }[] = [];
  for (const sc of scans) {
    for (let k = 0; k < m; k++) {
      const z = sc.z[k]!;
      if (z <= threshold || (k > 0 && sc.z[k - 1]! > z) || (k + 1 < m && sc.z[k + 1]! >= z)) continue;
      const limit = (BASELINE_WIDTHS / 2) * w * dd[k]!;
      let a = k, b = k;
      while (a > 0 && sc.z[a - 1]! > 0 && dd[k]! - dd[a - 1]! <= limit) a--;
      while (b + 1 < m && sc.z[b + 1]! > 0 && dd[b + 1]! - dd[k]! <= limit) b++;
      const from = sc.lo[a]!, to = sc.hi[b]! - 1;
      const merged = runs.find((u) => from <= u.to && to >= u.from);
      if (merged) {
        merged.from = Math.min(merged.from, from); merged.to = Math.max(merged.to, to);
        if (z > merged.best) { merged.best = z; merged.at = k; }
      } else runs.push({ from, to, best: z, at: k });
    }
  }
  const features: BackgroundExcess[] = [];
  for (const u of runs.sort((p, q) => p.from - q.from)) {
    let net = 0, xFrom = Infinity, xTo = -Infinity;
    for (let k = u.from; k <= u.to; k++) {
      if (covered[k]) continue;
      covered[k] = 1;
      const i = idx[k]!;
      mask[i] = true;
      const x = input.x[i]!;
      xFrom = Math.min(xFrom, x); xTo = Math.max(xTo, x);
      const step = i + 1 < n ? Math.abs(input.x[i + 1]! - x) : i > 0 ? Math.abs(x - input.x[i - 1]!) : 0;
      net += (input.yObs[i]! - input.yCalc[i]!) * step;
    }
    const at = idx[u.at]!;
    features.push({ d: input.d[at]!, x: input.x[at]!, significance: u.best, xFrom, xTo, netIntensity: net });
  }
  return { features: features.sort((p, q) => q.significance - p.significance), mask, lineWidth: w };
}

export interface BackgroundTermsReading {
  /** The count the background points justify (lowest BIC). */
  readonly justified: number;
  /** The background points read, after the unexplained excess is taken out. */
  readonly points: number;
  /** χ² and BIC of the background alone on those points, by count. */
  readonly byTerms: readonly { readonly terms: number; readonly chi2: number; readonly bic: number }[];
  readonly excess: readonly BackgroundExcess[];
}

/**
 * The number of background coefficients the background points justify, in the
 * page's basis: BIC over 1 … 24 on the points where the model is background
 * alone, the unexplained excess taken out (see the module note). Null when
 * there are too few such points to read (fewer than ten per coefficient of
 * the smallest count, 10).
 */
export function backgroundTermsReading(
  input: BackgroundPointsInput & { readonly type: BackgroundType },
  /** The background points, when the caller reads them more narrowly (default backgroundPoints). */
  points?: readonly boolean[],
  /** unexplainedExcess on those points, when the caller has it. */
  found?: ReturnType<typeof unexplainedExcess>,
): BackgroundTermsReading | null {
  const base = points ?? backgroundPoints(input);
  const excess = found ?? unexplainedExcess(input, base);
  const idx: number[] = [];
  for (let i = 0; i < input.x.length; i++) if (base[i] && !excess.mask[i] && input.sigma[i]! > 0) idx.push(i);
  const n = idx.length;
  if (n < 10) return null;
  // The basis spans the whole pattern, as the calculated curve's does (synthesizePattern).
  const { min: xMin, max: xMax } = minMax(input.x);
  const target = idx.map((i) => input.yObs[i]! - (input.yCalc[i]! - input.yBackground[i]!));
  const weight = idx.map((i) => 1 / input.sigma[i]! ** 2);
  const byTerms: { terms: number; chi2: number; bic: number }[] = [];
  // A polynomial basis's first k functions are its basis of k terms, so its
  // columns are evaluated once; an interpolation basis's points move with k.
  const interpolation = input.type === "linInterpolate" || input.type === "logInterpolate";
  const kMax = Math.min(MAX_TERMS, Math.floor(n / 10));
  const full = interpolation ? [] : idx.map((i) => Array.from({ length: kMax }, (_, j) => {
    const unit = new Array<number>(j + 1).fill(0);
    unit[j] = 1;
    return evaluateBackground(input.x[i]!, unit, input.type, xMin, xMax);
  }));
  for (let k = 1; k <= kMax; k++) {
    const basis = interpolation
      ? idx.map((i) => hatRow(input.x[i]!, interpAnchors(k, xMin, xMax, input.type === "logInterpolate")))
      : full.map((row) => row.slice(0, k));
    const a = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const b = new Array<number>(k).fill(0);
    for (let r = 0; r < n; r++) {
      const row = basis[r]!, wr = weight[r]!;
      for (let p = 0; p < k; p++) {
        b[p]! += wr * row[p]! * target[r]!;
        for (let q = p; q < k; q++) a[p]![q]! += wr * row[p]! * row[q]!;
      }
    }
    for (let p = 0; p < k; p++) for (let q = 0; q < p; q++) a[p]![q] = a[q]![p]!;
    const { x: c, diagnostics } = solveSymmetricPseudoInverse(a, b, 1e-12);
    let chi2 = 0;
    for (let r = 0; r < n; r++) {
      let f = 0;
      for (let p = 0; p < k; p++) f += c[p]! * basis[r]![p]!;
      chi2 += weight[r]! * (target[r]! - f) ** 2;
    }
    // A coefficient the points cannot determine (an interpolation point with
    // no background point near it) is not a parameter of this fit.
    byTerms.push({ terms: k, chi2, bic: chi2 + (k - diagnostics.zeroCount) * Math.log(n) });
  }
  if (byTerms.length === 0) return null;
  let best = byTerms[0]!;
  for (const t of byTerms) if (t.bic < best.bic) best = t;
  return { justified: best.terms, points: n, byTerms, excess: excess.features };
}

/** The interpolation basis at x: each point's weight in the linear interpolation between them (flat past the ends), as interpolateAt reads it. */
function hatRow(x: number, pos: readonly number[]): number[] {
  const k = pos.length;
  const row = new Array<number>(k).fill(0);
  if (k === 1 || x <= pos[0]!) { row[0] = 1; return row; }
  if (x >= pos[k - 1]!) { row[k - 1] = 1; return row; }
  let j = 0;
  while (j < k - 2 && x > pos[j + 1]!) j++;
  const t = pos[j + 1]! > pos[j]! ? (x - pos[j]!) / (pos[j + 1]! - pos[j]!) : 0;
  row[j] = 1 - t;
  row[j + 1] = t;
  return row;
}
