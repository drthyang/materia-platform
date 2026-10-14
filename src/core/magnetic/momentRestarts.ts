/**
 * Restarts for a moments-only fit: the search the MCP path's
 * `refine_magnetic_powder` runs (`restarts`), for a fit that reports only the
 * refined values and an agreement — the magnetic step's ranking, whichever
 * page's backend does the fit.
 *
 * Magnetic intensity is quadratic in the moments, so a partition of the
 * moments over sublattices has several minima, and one Levenberg–Marquardt run
 * stops in the nearest. On Example 3 (docs/AGENT_EXAMPLES.md) one run of
 * P2₁'/m' leaves Mn1 almost without a moment; a restart finds the minimum the
 * pattern was simulated from. Each restart kicks the free amplitudes of the
 * baseline's answer by up to ±max(|value|, floor), the floor being the largest
 * seed (µ_B scale: m = 0 is a stationary point an unkicked fit never leaves,
 * and a sublattice the baseline switched off must be able to turn back on),
 * clamped to the bounds; the lowest agreement wins. Deterministic for a seed.
 */

import type { RefinementParameter } from "@/core/refinement/types";
import { mulberry32 } from "@/core/refinement/multiStart";

export interface MomentFit {
  readonly values: Record<string, number>;
  /** The fit's agreement (wR, R1, Rw): lower is better; null when the fit did not run. */
  readonly agreement: number | null;
}

export interface MomentSearch extends MomentFit {
  /** Restarts run beyond the baseline. */
  readonly restartsRun: number;
  /** Which start won (0 = the baseline from the seeds). */
  readonly bestStart: number;
  /** Each start's agreement, the baseline first. */
  readonly agreements: readonly (number | null)[];
}

/** The ranking's default: Example 3's run used 12, and only one of its 13 starts found the true minimum. */
export const RANK_RESTARTS = 12;
/** The MCP path's default seed (multiStart.ts), so the two searches draw alike. */
const SEED = 0xc0ffee;

const score = (f: MomentFit): number => (f.agreement !== null && Number.isFinite(f.agreement) ? f.agreement : Infinity);

/**
 * Fit from the seeds, then `restarts` kicked starts; return the best. `params`
 * are the model's amplitude rows (a derived one, with an `expression`, is never
 * kicked); `fitOnce` runs one fit from a start (undefined: the seeds).
 */
export async function fitMomentsWithRestarts(
  params: readonly RefinementParameter[],
  fitOnce: (start?: Record<string, number>) => MomentFit | Promise<MomentFit>,
  opts: { readonly restarts?: number; readonly seed?: number; readonly cancelled?: () => boolean } = {},
): Promise<MomentSearch> {
  const restarts = Math.max(0, Math.floor(opts.restarts ?? RANK_RESTARTS));
  const rng = mulberry32((opts.seed ?? SEED) >>> 0);
  const free = params.filter((p) => !p.expression);
  const floor = Math.max(0, ...free.map((p) => Math.abs(p.value)));
  const base = await fitOnce();
  let best = base;
  let bestStart = 0;
  const agreements: (number | null)[] = [base.agreement];
  let run = 0;
  for (let k = 1; k <= restarts && free.length > 0; k++) {
    if (opts.cancelled?.()) break;
    const start: Record<string, number> = { ...base.values };
    for (const p of free) {
      const v = base.values[p.id] ?? p.value;
      const scale = Math.max(Math.abs(v), floor);
      let x = v + (rng() * 2 - 1) * scale;
      if (p.min !== undefined) x = Math.max(x, p.min);
      if (p.max !== undefined) x = Math.min(x, p.max);
      start[p.id] = x;
    }
    const f = await fitOnce(start);
    run++;
    agreements.push(f.agreement);
    if (score(f) < score(best)) {
      best = f;
      bestStart = k;
    }
  }
  return { values: best.values, agreement: best.agreement, restartsRun: run, bestStart, agreements };
}
