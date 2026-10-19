/**
 * Which fits are within the noise of the best one (Hamilton, Acta Cryst. 18
 * (1965) 502): the magnetic ranking's "equally good fits", among which the
 * ★ takes the maximal group with the fewest moment parameters. A group that
 * adds moments must lower χ² by more than the noise of the best fit gives
 * those parameters: F = (Δχ²/q) / (χ²_best/ν_best) against F(q, ν_best) at
 * RANK_NOISE_ALPHA. Normalized by the best fit's own reduced χ², the test
 * holds on a fit whose GoF is above 1 too.
 */

import { fCritical } from "@/core/math/fDistribution";
import { RANK_NOISE_ALPHA } from "@/core/diagnostics/thresholds";

export interface NoisyFit {
  readonly id: string;
  /** Σ w (yobs − ycalc)² of the fit. */
  readonly chi2: number;
  /** Its degrees of freedom, observations less free parameters. */
  readonly dof: number;
  /** The model's parameters the test counts (the group's moment amplitudes). */
  readonly parameters: number;
}

/** The ids of the fits within the noise of the lowest χ², the best's among them; empty for none. */
export function withinNoiseOfBest(fits: readonly NoisyFit[], alpha = RANK_NOISE_ALPHA): Set<string> {
  const usable = fits.filter((f) => Number.isFinite(f.chi2) && f.dof > 0);
  if (usable.length === 0) return new Set();
  const best = usable.reduce((a, b) => (b.chi2 < a.chi2 ? b : a));
  const noise = best.chi2 / best.dof;
  const out = new Set([best.id]);
  for (const f of usable) {
    if (f === best) continue;
    const q = Math.max(1, best.parameters - f.parameters);
    const F = (f.chi2 - best.chi2) / q / noise;
    if (F <= fCritical(alpha, q, best.dof)) out.add(f.id);
  }
  return out;
}
