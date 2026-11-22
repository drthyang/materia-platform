/**
 * The moments fit as rounds: the moments with every nuclear row held, then the
 * scale and the background with the moments held, then the moments again,
 * until the moments stop moving. Always ends on a moments step, and never
 * refines a moment and a nuclear row in one step.
 *
 * Why: a nuclear-only fit takes up the magnetic intensity it does not model in
 * its background and scale (at k ≠ 0 the satellites between its lines, at
 * k = 0 the intensity on them), and a single moments fit against those rows
 * gives a moment several esds too small. The rounds end on the answer a joint
 * fit of the three would give (docs/reports/2026-11-19-moments-alternation.md:
 * a synthetic MnWO₄ calculated without this code, 4.2 µ_B read as 4.06 by one
 * fit and as 4.20 after four rounds).
 *
 * Sans-io: `fit` runs one refinement of the rows marked free, wherever the
 * page runs its fits (the worker pool, or this thread).
 *
 * Internal: this is the loop over rows it is told. Which rows those are, and
 * every number of the rule, is momentsFit.ts, the only application file that
 * imports this one (momentsFit.test.ts holds that); a fit is run through
 * `runMomentsFit`. Tests may call the loop to ask of it what the fit does not
 * take from a caller (a smaller cap, the other k = 0 choice).
 */

import type { RefinementOptions, RefinementParameter, RefinementResult } from "@/core/refinement/types";

/**
 * A round's moments have settled when every free moment row moved by less than
 * this fraction of its esd since the round before: the crystallographic
 * "settled" (shift/esd below 0.1). Measured on the pattern of the report: what
 * is then left against the joint fit is below 0.05 esd.
 */
export const ALTERNATION_SHIFT_TOLERANCE = 0.1;

/**
 * The most rounds one fit runs. Three to five are needed at k ≠ 0 and seven
 * for a k = 0 ferromagnet with the scale held; a fit that reaches the cap
 * keeps its last moments step and says it did not settle.
 */
export const ALTERNATION_MAX_ROUNDS = 10;

/**
 * At k = 0, whether a moments step refines the scale with the moments (as the
 * ranking's single fit does) and the step between refines the background
 * alone. False: the scale is held in every moments step, at k = 0 as at any k
 * (the rule "the moments refine with the nuclear model held", as written), and
 * the step between refines the scale and the background. Both end on the same
 * moments; true takes two or three rounds where false takes up to seven.
 * The owner chose false on 2026-11-20 ("we usually don't refine the scale"
 * with the moments); this is the one switch.
 */
export const K0_SCALE_WITH_MOMENTS = false;

/**
 * A weighted residual below which the fit is exact (noise-free data): the esds
 * are then round-off and a shift cannot be measured against them. The engine's
 * own line for an exact fit.
 */
const EXACT_FIT_RWP = 1e-6;

/**
 * A shift this small against the row's own size (or against 1 µ_B, for a row
 * near zero) is below what a moment is known to: the rounded γr₀/2 alone is
 * 1.5e-4 of one. On noise-free data the esds shrink with the misfit, so
 * shift/esd never falls, and this ends the rounds instead.
 */
const NEGLIGIBLE_RELATIVE_SHIFT = 1e-4;

export interface AlternationRun {
  /** Every row of the fit, nuclear and magnetic, at its starting value. */
  readonly rows: readonly RefinementParameter[];
  /** The rows a moments step refines (the free moment rows; with the scale at k = 0 under K0_SCALE_WITH_MOMENTS). */
  readonly momentIds: readonly string[];
  /** The rows the step between refines, the moments held: the scale and the background. */
  readonly betweenIds: readonly string[];
  /** One refinement of the rows marked free. */
  readonly fit: (rows: readonly RefinementParameter[], options: Partial<RefinementOptions>) => Promise<RefinementResult> | RefinementResult;
  readonly maxIterations?: number;
  readonly tolerance?: number;
  readonly maxRounds?: number;
  /** Asked before each fit: true stops the rounds, and nothing of them is kept. */
  readonly cancelled?: () => boolean;
  /** Each round as it starts (1, 2, …), of at most `maxRounds`. */
  readonly onRound?: (round: number, maxRounds: number) => void;
}

export interface AlternationOutcome {
  /** The last moments step: its values, its esds (the step between's rows included), its agreement. */
  readonly result: RefinementResult;
  /** Every row's value at the end. */
  readonly values: Readonly<Record<string, number>>;
  /** The step between's rows at the end, by id: what the page must take. */
  readonly held: Readonly<Record<string, number>>;
  /** Rounds run (each: the step between, then a moments step). */
  readonly rounds: number;
  /** False when the cap was reached with a moment still moving. */
  readonly settled: boolean;
  /** The largest shift of a moment row over the last round, in its esd. */
  readonly lastShiftOverEsd: number;
}

const withValues = (rows: readonly RefinementParameter[], values: Readonly<Record<string, number>>): RefinementParameter[] =>
  rows.map((p) => (values[p.id] !== undefined && values[p.id] !== p.value ? { ...p, value: values[p.id]! } : p));

/** The rows with exactly these free (a tied row follows its tie, never free). */
const freeing = (rows: readonly RefinementParameter[], ids: ReadonlySet<string>): RefinementParameter[] =>
  rows.map((p) => ({ ...p, fixed: !!p.expression || !ids.has(p.id) }));

/**
 * Run the rounds. Null when `cancelled` said so: nothing is kept.
 *
 * The moments steps report their esds with the step between's rows included
 * (the engine's `esdWith`): the esd of a moment then carries the uncertainty
 * of the scale and the background, which were fitted to the same pattern.
 */
export async function alternateMoments(run: AlternationRun): Promise<AlternationOutcome | null> {
  const tolerance = run.tolerance ?? ALTERNATION_SHIFT_TOLERANCE;
  const maxRounds = Math.max(1, Math.floor(run.maxRounds ?? ALTERNATION_MAX_ROUNDS));
  const moments = new Set(run.momentIds);
  // A row cannot be in both steps: one the moments step refines is the moments step's.
  const between = new Set(run.betweenIds.filter((id) => !moments.has(id)));
  const options: Partial<RefinementOptions> = { maxIterations: run.maxIterations ?? 20 };
  const momentsStep = async (rows: readonly RefinementParameter[]): Promise<RefinementResult> =>
    run.fit(freeing(rows, moments), { ...options, ...(between.size > 0 ? { esdWith: [...between] } : {}) });

  if (run.cancelled?.()) return null;
  let rows = [...run.rows];
  let result = await momentsStep(rows);
  rows = withValues(rows, result.parameters);
  let rounds = 0;
  let settled = between.size === 0;
  let lastShiftOverEsd = 0;
  while (!settled && rounds < maxRounds) {
    if (run.cancelled?.()) return null;
    run.onRound?.(rounds + 1, maxRounds);
    const middle = await run.fit(freeing(rows, between), options);
    if (run.cancelled?.()) return null;
    rows = withValues(rows, middle.parameters);
    const before = result;
    result = await momentsStep(rows);
    rows = withValues(rows, result.parameters);
    rounds++;
    let negligible = true;
    lastShiftOverEsd = 0;
    for (const id of moments) {
      const now = result.parameters[id];
      const then = before.parameters[id];
      if (now === undefined || then === undefined) continue;
      const shift = Math.abs(now - then);
      if (shift > NEGLIGIBLE_RELATIVE_SHIFT * Math.max(Math.abs(now), 1)) negligible = false;
      // A row with no esd (a direction the fit dropped) has no scale to measure a shift against, as in the engine.
      const esd = result.esd[id];
      if (esd !== undefined && esd > 0) lastShiftOverEsd = Math.max(lastShiftOverEsd, shift / esd);
    }
    const exact = result.agreement.rWeighted !== undefined && result.agreement.rWeighted < EXACT_FIT_RWP;
    if (exact || negligible) lastShiftOverEsd = 0;
    settled = exact || negligible || lastShiftOverEsd < tolerance;
  }
  if (run.cancelled?.()) return null;
  const values = Object.fromEntries(rows.map((p) => [p.id, p.value]));
  return { result, values, held: Object.fromEntries([...between].map((id) => [id, values[id]!])), rounds, settled, lastShiftOverEsd };
}
