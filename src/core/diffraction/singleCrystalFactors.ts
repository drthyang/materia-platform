/**
 * Single-crystal intensity corrections and F²-based agreement factors — the
 * pieces that separate an integrated-Bragg refinement from the powder path,
 * following the SHELXL conventions crystallographers publish against.
 *
 * Calculated F² for one reflection:
 *   Fc² = k · y(ext) · |F|²
 * with k the overall scale on F² (SHELXL's OSF squared: OSF scales F) and y the extinction
 * correction (SHELXL's EXTI, or Becker–Coppens as GSAS-II applies it). The observed Fo² come Lorentz-, polarization- and
 * absorption-corrected from data reduction, as every single-crystal program
 * takes them; unlike powder there is no multiplicity or profile — each
 * reflection is one measured F².
 *
 * Agreement (F² refinement, SHELXL):
 *   w      = 1 / [σ²(Fo²) + (a·P)² + b·P],   P = [max(Fo²,0) + 2·Fc²]/3
 *   wR2    = √[ Σ w(Fo²−Fc²)² / Σ w(Fo²)² ]
 *   R1     = Σ ||Fo|−|Fc|| / Σ |Fo|          (on F, over a chosen Fo² cutoff)
 *   GooF S = √[ Σ w(Fo²−Fc²)² / (N−P_params) ]
 * References: Sheldrick, Acta Cryst. A64 (2008) 112; C64 (2015) 3; SHELXL manual
 * (WGHT, EXTI, and the F² least-squares definitions).
 */

import type { ExtinctionModel, Radiation } from "@/core/diffraction/types";

export type { ExtinctionModel };
import { braggTheta } from "@/core/crystal/unitCell";

/** Where a reflection was measured, when the file says: its own wavelength (Å), 2θ (degrees) and mean path length through the crystal (cm). */
export interface MeasuredAt {
  readonly wavelength?: number;
  readonly twoTheta?: number;
  readonly tbar?: number;
}

export const EXTINCTION_MODELS: readonly ExtinctionModel[] = ["shelx", "bc-1-lorentzian", "bc-1-gaussian", "bc-2-lorentzian", "bc-2-gaussian"];

export const EXTINCTION_MODEL_LABELS: Readonly<Record<ExtinctionModel, string>> = {
  shelx: "SHELXL EXTI",
  "bc-1-lorentzian": "Becker–Coppens type I, Lorentzian",
  "bc-1-gaussian": "Becker–Coppens type I, Gaussian",
  "bc-2-lorentzian": "Becker–Coppens type II, Lorentzian",
  "bc-2-gaussian": "Becker–Coppens type II, Gaussian",
};

/** What the extinction parameter is under each model: SHELXL's x, or GSAS-II's Eg (mosaic spread) or Es (domain size). */
export const EXTINCTION_PARAMETER_LABELS: Readonly<Record<ExtinctionModel, string>> = {
  shelx: "extinction (SHELXL x)",
  "bc-1-lorentzian": "extinction Eg (B–C type I)",
  "bc-1-gaussian": "extinction Eg (B–C type I)",
  "bc-2-lorentzian": "extinction Es (B–C type II)",
  "bc-2-gaussian": "extinction Es (B–C type II)",
};

/**
 * SHELXL's secondary-extinction correction y applied to F²:
 *   F²_corr = F² · y,   y = [1 + 0.001·x·F²·λ³ / sin(2θ)]^(−1/2)
 * where x is the refinable EXTI parameter (0 = no extinction). Strong low-angle
 * reflections are damped, as physically observed. (SHELXL uses the same
 * expression on Fc²; the ^(−1/2) form is the intensity's, |F|².)
 *
 * λ and 2θ are the reflection's own when the file gives them (`at`): a
 * time-of-flight Laue measurement takes each reflection at its own wavelength,
 * and the extinction follows the kinematic reflectivity λ³F²/sin2θ at that
 * wavelength (the coupling of the beam to the mosaic blocks is the same at
 * each λ; integrating over λ instead of over the angle changes the Lorentz
 * factor of the integrated intensity, which the data reduction removed, not
 * the extinction). SHELXL's HKLF 2 carries a wavelength per reflection for
 * the same reason. With neither a wavelength nor a 2θ for a TOF reflection,
 * y = 1.
 */
export function extinctionFactor(x: number, fSquared: number, radiation: Radiation, d: number, at: MeasuredAt = {}): number {
  if (x <= 0) return 1;
  const lambda = at.wavelength ?? (radiation.kind === "neutron-tof" ? undefined : radiation.wavelength);
  const theta = at.twoTheta !== undefined ? (at.twoTheta * Math.PI) / 360 : lambda !== undefined ? braggTheta(d, lambda) : NaN;
  if (Number.isNaN(theta)) return 1;
  // λ from 2θ and d when only the angle is known (λ = 2d·sinθ).
  const wl = lambda ?? 2 * d * Math.sin(theta);
  const s2t = Math.sin(2 * theta);
  if (Math.abs(s2t) < 1e-6) return 1;
  const denom = 1 + (0.001 * x * fSquared * wl * wl * wl) / s2t;
  return denom > 0 ? 1 / Math.sqrt(denom) : 1;
}

/**
 * Becker & Coppens' secondary extinction as GSAS-II computes it
 * (GSASIIstrMath.SCExtinction), so a refined value compares with GSAS-II's:
 *
 *   y = [1 + 2p + A·p²/(1 + B·p)]^(−1/2),   p = Q·T̄·ψ
 *
 * with A and B the Gaussian or Lorentzian mosaic's coefficients in cos2θ, T̄
 * the reflection's mean path length (cm; 1 when the file has none, and the
 * parameter absorbs it), and Q = c·F²·λ²/V² the kinematic term: c = 10⁷ with
 * F² in barns for neutrons (fm²/100 here), c = 7.9406·10⁵ times the
 * polarization ratio [P + (1−P)cos⁴2θ]/[P + (1−P)cos²2θ] with F² in electrons²
 * for X-rays; V in Å³, λ in Å. ψ = Eg/L for type I, with L = sin2θ/λ at one
 * wavelength and (sinθ/λ)² over a time-of-flight Laue measurement (GSAS-II's
 * forms), and ψ = Es for type II. x is Eg or Es; y = 1 at x ≤ 0.
 */
export function beckerCoppensFactor(
  model: Exclude<ExtinctionModel, "shelx">,
  x: number,
  fSquared: number,
  radiation: Radiation,
  d: number,
  volume: number,
  at: MeasuredAt = {},
): number {
  if (!(x > 0) || !(volume > 0) || !(d > 0)) return 1;
  const sq = 1 / (4 * d * d);
  const lambda = at.wavelength
    ?? (radiation.kind === "neutron-tof" ? (at.twoTheta !== undefined ? 2 * d * Math.sin((at.twoTheta * Math.PI) / 360) : undefined) : radiation.wavelength);
  if (lambda === undefined || !(lambda > 0)) return 1;
  const cos2t = 1 - 2 * sq * lambda * lambda;
  if (cos2t < -1 || cos2t > 1) return 1;
  const sin2t = Math.sqrt(Math.max(0, 1 - cos2t * cos2t));
  let q: number;
  let l: number;
  if (radiation.kind === "xray") {
    const p = radiation.polarization ?? 0.5;
    const c2 = cos2t * cos2t;
    const ratio = (p + (1 - p) * c2 * c2) / (p + (1 - p) * c2);
    q = ((7.9406e5 / (volume * volume)) * ratio * fSquared * lambda * lambda);
    l = sin2t / lambda;
  } else {
    q = (1e7 / (volume * volume)) * (fSquared / 100) * lambda * lambda;
    l = radiation.kind === "neutron-tof" ? sq : sin2t / lambda;
  }
  const type1 = model === "bc-1-lorentzian" || model === "bc-1-gaussian";
  if (type1 && !(l > 0)) return 1;
  const psi = type1 ? x / l : x;
  const pf = q * (at.tbar !== undefined && at.tbar > 0 ? at.tbar : 1) * psi;
  const gaussian = model === "bc-1-gaussian" || model === "bc-2-gaussian";
  const a = gaussian ? 0.58 + 0.48 * cos2t + 0.24 * cos2t * cos2t : 0.025 + 0.285 * cos2t;
  const b = gaussian ? 0.02 - 0.025 * cos2t : cos2t < 0 ? -0.45 * cos2t : 0.15 - 0.2 * (0.75 - cos2t) ** 2;
  const pf4 = 1 + 2 * pf + (a * pf * pf) / (1 + b * pf);
  return pf4 > 0 ? 1 / Math.sqrt(pf4) : 1;
}

/** The extinction factor under `model` (SHELXL's when absent); `volume` is the cell's (Å³), which only Becker–Coppens uses. */
export function extinctionFactorFor(
  model: ExtinctionModel | undefined,
  x: number,
  fSquared: number,
  radiation: Radiation,
  d: number,
  volume: number,
  at: MeasuredAt = {},
): number {
  return model === undefined || model === "shelx"
    ? extinctionFactor(x, fSquared, radiation, d, at)
    : beckerCoppensFactor(model, x, fSquared, radiation, d, volume, at);
}

/**
 * SHELX WGHT weights w = 1/[σ²(Fo²) + (aP)² + bP], P = [max(Fo²,0)+2Fc²]/3.
 * SHELXL states a and b on the absolute scale (Fc² in electrons², Fo² divided
 * by its scale), so for data on the scale `scale` (Fc² here = scale·|F|²) the
 * b term is scale·b·P; the a term does not depend on the scale.
 */
export function shelxWeights(
  foSq: readonly number[],
  fcSq: readonly number[],
  sigma: readonly number[],
  a = 0,
  b = 0,
  scale = 1,
): Float64Array {
  const w = new Float64Array(foSq.length);
  for (let i = 0; i < foSq.length; i++) {
    const P = (Math.max(foSq[i]!, 0) + 2 * fcSq[i]!) / 3;
    const s = sigma[i] ?? 0;
    const denom = s * s + (a * P) * (a * P) + b * scale * P;
    w[i] = denom > 0 ? 1 / denom : (s > 0 ? 1 / (s * s) : 1);
  }
  return w;
}

export interface WeightingSuggestion {
  /** WGHT a and b, rounded as SHELXL prints them. */
  readonly a: number;
  readonly b: number;
  /** GooF with them, over N − P. */
  readonly goof: number;
  /** GooF by bin of Fc² (equal counts, weakest first) with them, each over its own reflections as SHELXL's analysis of variance gives it: what they flatten. */
  readonly bins: readonly number[];
}

/**
 * The weighting scheme SHELXL suggests at the end of a run, by its criterion:
 * the WGHT a and b that bring the analysis of variance flat at 1 — in each of
 * `binCount` bins of Fc² (equal counts) GooF_bin = √(Σw(Fo²−Fc²)²/n_bin), the
 * sum of (GooF_bin − 1)² least. Nothing holds the overall GooF at 1: over
 * N − P it settles near √(N/(N−P)), as SHELXL's converged suggestions leave
 * it (3a's WGHT 0.0374 0.6277 suggests itself again at GooF 1.058). SHELXL
 * searches a coarse grid and stops in the criterion's shallow valley, a few
 * thousandths off in a and up to about 0.2 in b (from SHELXL's own listings:
 * 1b 0.0277 0.2519 where this gives 0.0259 0.313, 3a 0.0374 0.6277 for
 * 0.0370 0.668); this finds the valley's bottom. Fitted to a model, it
 * absorbs that model's errors into the weights: it is the last step of a
 * refinement, not a way to a better one. Data whose bins all read GooF ≤ 1
 * with σ alone keep a = b = 0. b is on SHELXL's absolute scale: for data on
 * the scale `scale` (see shelxWeights) the b term is scale·b·P.
 */
export function suggestShelxWeighting(
  foSq: readonly number[],
  fcSq: readonly number[],
  sigma: readonly number[],
  nParams: number,
  binCount = 10,
  scale = 1,
): WeightingSuggestion {
  const n = foSq.length;
  const dof = Math.max(n - nParams, 1);
  const p = new Float64Array(n);
  const s2 = new Float64Array(n);
  const d2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    p[i] = (Math.max(foSq[i]!, 0) + 2 * Math.max(fcSq[i]!, 0)) / 3;
    s2[i] = (sigma[i] ?? 0) ** 2;
    d2[i] = (foSq[i]! - fcSq[i]!) ** 2;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => fcSq[x]! - fcSq[y]!);
  const bins: number[][] = [];
  for (let k = 0; k < Math.min(binCount, n); k++) bins.push(order.slice(Math.round((k * n) / binCount), Math.round(((k + 1) * n) / binCount)));
  const chi2 = (a: number, b: number, idx?: readonly number[]): number => {
    let sum = 0;
    const one = (i: number): void => {
      const v = s2[i]! + a * a * p[i]! * p[i]! + b * scale * p[i]!;
      sum += v > 0 ? d2[i]! / v : 0;
    };
    if (idx) for (const i of idx) one(i);
    else for (let i = 0; i < n; i++) one(i);
    return sum;
  };
  // SHELXL's analysis of variance: each bin's GooF over its own reflections.
  const binGoof = (a: number, b: number): number[] => bins.map((idx) => Math.sqrt(chi2(a, b, idx) / Math.max(idx.length, 1)));
  const cost = (a: number, b: number): number => binGoof(a, b).reduce((sum, g) => sum + (g - 1) ** 2, 0);
  const result = (a: number, b: number): WeightingSuggestion => ({ a, b, goof: n ? Math.sqrt(chi2(a, b) / dof) : 0, bins: n ? binGoof(a, b) : [] });
  if (n === 0 || binGoof(0, 0).every((g) => g <= 1)) return result(0, 0);
  // Every bin's GooF falls as b grows: the b that brings them all to 1 or below (a = 0) bounds b for every a.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += p[i]!;
  mean = Math.max(mean / n / scale, 1e-12);
  let hi = mean * 1e-6;
  for (let k = 0; k < 200 && binGoof(0, hi).some((g) => g > 1); k++) hi *= 2;
  // For one a, the best b ≥ 0: a scan of [0, hi], then a golden section about its best.
  const bestB = (a: number): { a: number; b: number; cost: number } => {
    const steps = 32;
    let j = 0;
    let c = cost(a, 0);
    for (let k = 1; k <= steps; k++) {
      const ck = cost(a, (hi * k) / steps);
      if (ck < c) [j, c] = [k, ck];
    }
    let lo = (hi * Math.max(j - 1, 0)) / steps;
    let up = (hi * Math.min(j + 1, steps)) / steps;
    for (let k = 0; k < 40; k++) {
      const m1 = lo + 0.381966 * (up - lo);
      const m2 = up - 0.381966 * (up - lo);
      if (cost(a, m1) <= cost(a, m2)) up = m2;
      else lo = m1;
    }
    const b = (lo + up) / 2;
    const cb = cost(a, b);
    return cb < c ? { a, b, cost: cb } : { a, b: (hi * j) / steps, cost: c };
  };
  let best = bestB(0);
  for (let a = 0.002; a <= 0.3 + 1e-12; a += 0.002) {
    const t = bestB(a);
    if (t.cost < best.cost) best = t;
  }
  const centre = best.a;
  for (let a = Math.max(0, centre - 0.002); a <= centre + 0.002 + 1e-12; a += 0.0001) {
    const t = bestB(a);
    if (t.cost < best.cost) best = t;
  }
  const a = Math.round(best.a * 1e4) / 1e4;
  const b = best.b > 0 ? Number(best.b.toPrecision(4)) : 0;
  return result(a, b);
}

export interface SingleCrystalAgreement {
  /** R1 = Σ||Fo|−|Fc||/Σ|Fo| over reflections with Fo² > cutoff·σ (all if cutoff ≤ 0). */
  readonly r1: number;
  /** R1 over ALL reflections (no σ cutoff), for completeness. */
  readonly r1All: number;
  /** wR2 = √[Σw(Fo²−Fc²)²/Σw(Fo²)²]. */
  readonly wr2: number;
  /** Goodness of fit S = √[Σw(Fo²−Fc²)²/(N−P)]. */
  readonly goof: number;
  /** Number of reflections passing the Fo² cutoff (the "observed" I>nσ count). */
  readonly observed: number;
  /** Total reflections used. */
  readonly total: number;
}

/**
 * SHELX-style F² agreement factors. `sigmaCutoff` (default 2) selects the
 * "observed" reflections for R1 (Fo² > cutoff·σ(Fo²)); wR2 and GooF use all.
 */
export function singleCrystalAgreement(
  foSq: readonly number[],
  fcSq: readonly number[],
  sigma: readonly number[],
  weights: Float64Array,
  nParams: number,
  sigmaCutoff = 2,
): SingleCrystalAgreement {
  let wNum = 0;
  let wDen = 0;
  let r1Num = 0;
  let r1Den = 0;
  let r1AllNum = 0;
  let r1AllDen = 0;
  let observed = 0;
  const n = foSq.length;

  for (let i = 0; i < n; i++) {
    const fo2 = foSq[i]!;
    const fc2 = fcSq[i]!;
    const w = weights[i]!;
    const diff2 = fo2 - fc2;
    wNum += w * diff2 * diff2;
    wDen += w * fo2 * fo2;

    const fo = Math.sqrt(Math.max(fo2, 0));
    const fc = Math.sqrt(Math.max(fc2, 0));
    r1AllNum += Math.abs(fo - fc);
    r1AllDen += fo;
    if (sigmaCutoff <= 0 || fo2 > sigmaCutoff * (sigma[i] ?? 0)) {
      observed++;
      r1Num += Math.abs(fo - fc);
      r1Den += fo;
    }
  }

  const dof = Math.max(n - nParams, 1);
  return {
    r1: r1Den > 0 ? r1Num / r1Den : 0,
    r1All: r1AllDen > 0 ? r1AllNum / r1AllDen : 0,
    wr2: wDen > 0 ? Math.sqrt(wNum / wDen) : 0,
    goof: Math.sqrt(wNum / dof),
    observed,
    total: n,
  };
}
