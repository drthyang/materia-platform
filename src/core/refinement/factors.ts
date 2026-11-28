/**
 * Agreement factors (R values) and weighting helpers.
 *
 *   R    = Σ|y_obs − y_calc| / Σ|y_obs|
 *   R_wp = sqrt( Σ w (y_obs − y_calc)² / Σ w·y_obs² )
 *   R_exp = sqrt( (N − P) / Σ w·y_obs² )
 *   GoF  = R_wp / R_exp   (χ² = GoF²)
 *
 * N is the number of observations that actually contribute — points with a
 * positive weight — not the raw array length: excluded/masked points (a fit
 * range, or a sentinel plateau) carry weight 0 and must not inflate N − P, or
 * R_exp, GoF and the ESDs derived from the reduced χ² come out optimistic.
 * Reference: Toby, B. H. (2006), "R factors in Rietveld analysis," *Powder
 * Diffr.* 21, 67; Young, *The Rietveld Method* (1993), Ch. 1.
 */

import type { AgreementFactors } from "@/core/refinement/types";

/** Weights from sigmas; falls back to unit weights where sigma is missing/zero. */
export function weightsFromSigma(sigma: readonly (number | undefined)[]): Float64Array {
  const w = new Float64Array(sigma.length);
  for (let i = 0; i < sigma.length; i++) {
    const s = sigma[i];
    w[i] = s === undefined || s <= 0 ? 1 : 1 / (s * s);
  }
  return w;
}

/**
 * Detect a repeated non-positive "sentinel" plateau marking excluded/masked
 * points (e.g. GSAS exports a constant −3 outside the fit range) and return a
 * boolean mask (true = excluded). Only triggers when one non-positive value
 * repeats many times, so scattered near-zero noise in valid data is untouched.
 */
export function excludedPointMask(yObs: readonly number[]): boolean[] {
  const counts = new Map<number, number>();
  for (const y of yObs) if (y <= 0) counts.set(y, (counts.get(y) ?? 0) + 1);
  let sentinel: number | null = null;
  let best = 4; // require ≥5 repeats to be considered a sentinel plateau
  for (const [v, c] of counts) if (c > best) { best = c; sentinel = v; }
  return yObs.map((y) => sentinel !== null && y === sentinel);
}

/** Apply an exclusion mask to a weight vector in place (masked → weight 0). */
export function applyExclusionMask(weights: Float64Array, mask: readonly boolean[]): Float64Array {
  for (let i = 0; i < weights.length; i++) if (mask[i]) weights[i] = 0;
  return weights;
}

/**
 * Mask (true = excluded) for points whose abscissa falls outside an inclusive
 * fit range [min, max]. A missing bound leaves that side unrestricted, so a
 * partially-defined range still works.
 */
export function fitRangeMask(
  xValues: readonly number[],
  range: { readonly min?: number; readonly max?: number } | undefined,
): boolean[] {
  if (!range || (range.min === undefined && range.max === undefined)) {
    return xValues.map(() => false);
  }
  const min = range.min ?? -Infinity;
  const max = range.max ?? Infinity;
  return xValues.map((x) => x < min || x > max);
}

/**
 * The agreement factors of the module header:
 *   R = Σ|y_o − y_c| / Σ|y_o|        R_wp = √[Σ w (y_o − y_c)² / Σ w y_o²]
 *   R_exp = √[(N − P) / Σ w y_o²]    GoF = R_wp / R_exp,   χ²_red = GoF²
 * Symbols → code: y_o `yObs`, y_c `yCalc`; w `weights` (1/σ²; a point with
 * w ≤ 0 is left out of every sum); N `nUsed`; P `nParams`; N − P `dof`
 * (at least 1); the four sums `sumAbsDiff`, `sumAbsObs`, `sumWDiff2`,
 * `sumWObs2`. All four results are fractions (× 100 for %), GoF a ratio.
 * Reference: Toby, Powder Diffr. 21 (2006) 67.
 * Also in: app/powderPage.ts `weightedR` and `curvesGoodnessOfFit` (the page
 * forms R_wp and GoF again over its own window; docs/EQUATIONS.md).
 */
export function computeAgreementFactors(
  yObs: Float64Array,
  yCalc: Float64Array,
  weights: Float64Array,
  nParams: number,
): AgreementFactors {
  let sumAbsObs = 0;
  let sumAbsDiff = 0;
  let sumWObs2 = 0;
  let sumWDiff2 = 0;
  // Count only the observations that contribute (positive weight); masked/
  // excluded points are dropped from every sum AND from N in N − P.
  let nUsed = 0;

  for (let i = 0; i < yObs.length; i++) {
    const w = weights[i]!;
    if (w <= 0) continue; // excluded/masked point — omit from every agreement sum
    nUsed++;
    const o = yObs[i]!;
    const c = yCalc[i]!;
    const diff = o - c;
    sumAbsObs += Math.abs(o);
    sumAbsDiff += Math.abs(diff);
    sumWObs2 += w * o * o;
    sumWDiff2 += w * diff * diff;
  }

  const rFactor = sumAbsObs > 0 ? sumAbsDiff / sumAbsObs : 0;
  const rWeighted = sumWObs2 > 0 ? Math.sqrt(sumWDiff2 / sumWObs2) : 0;
  const dof = Math.max(nUsed - nParams, 1);
  const rExpected = sumWObs2 > 0 ? Math.sqrt(dof / sumWObs2) : 0;
  // Goodness of fit S = R_wp / R_exp (GSAS-II's "GOF"); the reduced χ² is S².
  const goodnessOfFit = rExpected > 0 ? rWeighted / rExpected : 0;

  return { rFactor, rWeighted, rExpected, goodnessOfFit };
}

/** Weighted sum of squared residuals, χ² = Σ w (obs − calc)² (dimensionless
 *  with w = 1/σ²; not divided by N − P). */
export function chiSquared(
  yObs: Float64Array,
  yCalc: Float64Array,
  weights: Float64Array,
): number {
  let sum = 0;
  for (let i = 0; i < yObs.length; i++) {
    const diff = yObs[i]! - yCalc[i]!;
    sum += weights[i]! * diff * diff;
  }
  return sum;
}
