/**
 * Single-crystal intensity corrections and F²-based agreement factors — the
 * pieces that separate an integrated-Bragg refinement from the powder path,
 * following the SHELXL conventions crystallographers publish against.
 *
 * Calculated F² for one reflection:
 *   Fc² = k · y(ext) · |F|²
 * with k the overall scale (SHELX OSF, applied to F²) and y the extinction
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

/** SHELX WGHT weights w = 1/[σ²(Fo²) + (aP)² + bP], P = [max(Fo²,0)+2Fc²]/3. */
export function shelxWeights(
  foSq: readonly number[],
  fcSq: readonly number[],
  sigma: readonly number[],
  a = 0,
  b = 0,
): Float64Array {
  const w = new Float64Array(foSq.length);
  for (let i = 0; i < foSq.length; i++) {
    const P = (Math.max(foSq[i]!, 0) + 2 * fcSq[i]!) / 3;
    const s = sigma[i] ?? 0;
    const denom = s * s + (a * P) * (a * P) + b * P;
    w[i] = denom > 0 ? 1 / denom : (s > 0 ? 1 / (s * s) : 1);
  }
  return w;
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
