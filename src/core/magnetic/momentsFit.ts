/**
 * The moments fit of a powder pattern: the one home of its rule. The page's
 * Refine moments, the Copilot's `refine_moments` (which drives the page) and
 * the tests all run it from here.
 *
 * The rule (the owner's): the moments refine with the nuclear model held, in
 * rounds with the scale and the background, and the fit ends on a moments
 * step; a moment and a nuclear row never refine in one step.
 *
 *  - a moments step refines the free magnetic rows (below), every other row
 *    held, whatever its `fixed` flag says;
 *  - the step between refines every untied scale row (each phase's own) and
 *    every untied background row, the magnetic rows held; never the peak
 *    shape, the cell or the atoms;
 *  - the rounds stop when no moment moved by ALTERNATION_SHIFT_TOLERANCE of
 *    its esd (or the fit is exact, or the shift negligible), at
 *    ALTERNATION_MAX_ROUNDS at the latest;
 *  - the moments steps report esds that include the scale and the background
 *    (the engine's `esdWith`), or say why they could not.
 *
 * A caller hands over the rows, the model (for its k) and a way to run one
 * refinement. It cannot choose the rows of either step, the tolerance, the
 * cap, the iterations or `esdWith`: those are decided here.
 *
 * The page's Refine button with only magnetic rows free is a moments step the
 * user set up by hand; its esds follow the same rule (`momentsOnlyEsdOptions`).
 *
 * The loop itself is momentAlternation.ts, an internal file: no application
 * file but this one imports it (momentsFit.test.ts holds that).
 *
 * Why rounds at all: docs/reports/2026-11-19-moments-alternation.md.
 */

import type { RefinementOptions, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { isMagneticModelParameterKind, isMomentParameterKind } from "@/core/refinement/types";
import type { MagneticModel } from "@/core/magnetic/types";
import { alternateMoments, ALTERNATION_MAX_ROUNDS, ALTERNATION_SHIFT_TOLERANCE, K0_SCALE_WITH_MOMENTS } from "@/core/magnetic/momentAlternation";

/** Read-only, for the words a page shows and for tests: the rule's numbers and its one switch. */
export { ALTERNATION_MAX_ROUNDS, ALTERNATION_SHIFT_TOLERANCE, K0_SCALE_WITH_MOMENTS };

/**
 * One refinement of the rows flagged free, with exactly the options it is
 * given, wherever the caller runs its fits: the page on its worker pool (or in
 * its thread), a test in its thread. The options are the fit's own
 * (`maxIterations`, `esdWith`): a runner hands them to the engine unchanged.
 */
export type MomentsFitRunner = (
  rows: readonly RefinementParameter[],
  options: Partial<RefinementOptions>,
) => Promise<RefinementResult> | RefinementResult;

export interface MomentsFitProblem {
  /**
   * Every row of the fit, in the order the engine is to see them: the nuclear
   * rows of every phase, and the magnetic model's rows. Values, bounds and
   * ties are read. `fixed` is read on a magnetic row only (a held one stays
   * held: the phase gauge of a two-arm k); on every other row it is ignored.
   */
  readonly rows: readonly RefinementParameter[];
  /** The model the moment rows drive. Read for its k only (k = 0 or not). */
  readonly magnetic: Pick<MagneticModel, "propagation">;
  readonly fit: MomentsFitRunner;
}

export interface MomentsFitHooks {
  /** Asked before each refinement: true stops the fit, and nothing of it is kept. */
  readonly cancelled?: () => boolean;
  /** Each round as it starts (1, 2, …), and the most rounds a fit runs. */
  readonly onRound?: (round: number, maxRounds: number) => void;
}

export interface MomentsFitOutcome {
  readonly cancelled: false;
  /** Every row's value at the end (the moment rows among them, free and tied). */
  readonly values: Readonly<Record<string, number>>;
  /** The magnetic rows' esds from the last moments step, by id, in row order. */
  readonly esd: Readonly<Record<string, number>>;
  /** The held rows whose uncertainty those esds include. Empty: the esds are of the moments alone. */
  readonly esdIncludes: readonly string[];
  /** Why the esds are of the moments alone, where rows were re-refined and the engine could not include them. Otherwise null. */
  readonly esdAloneReason: string | null;
  /** The re-refined rows (`reRefinedRows`) at the end, by id: the caller writes these back. */
  readonly reRefined: Readonly<Record<string, number>>;
  /** Rounds run (each: the scale and the background, then a moments step). */
  readonly rounds: number;
  /** False when the cap was reached with a moment still moving. */
  readonly settled: boolean;
  /** The largest shift of a moments-step row over the last round, in its esd. */
  readonly lastShiftOverEsd: number;
  /** wR of the last moments step; null when the engine reports none. */
  readonly agreement: number | null;
  /** The last moments step's engine result (status, correlations, χ² history, diagnostics). */
  readonly result: RefinementResult;
}

/** k = 0: every component of every propagation vector zero (a model without one is k = 0). */
function atKZero(magnetic: Pick<MagneticModel, "propagation">): boolean {
  return magnetic.propagation.every((k) => k.every((x) => Math.abs(x) < 1e-9));
}

const untied = (p: RefinementParameter): boolean => !p.expression;

/**
 * The rows a moments fit re-refines between its moments steps, by id with
 * their present values: every untied scale row (each phase's own) and every
 * untied background row, whether or not the page holds them. Read-only: for a
 * page that writes them back or compares them. The fit takes no such list.
 */
export function reRefinedRows(rows: readonly RefinementParameter[]): Record<string, number> {
  return Object.fromEntries(rows.filter((p) => (p.kind === "scale" || p.kind === "background") && untied(p)).map((p) => [p.id, p.value]));
}

/**
 * For one refinement of `rows` as they are flagged (the page's Refine button),
 * where it is a moments step of the user's own making: magnetic rows only are
 * free (at least one moment; k's components may be with them). The options
 * that make its moment esds include the held scale and background rows
 * (`reRefinedRows`, the engine's `esdWith`): those rows were fitted to the
 * same pattern, and a moment's esd without their uncertainty is too small
 * (10 to 29 % on the report's patterns). Nothing for any other free set: its
 * esds are its own.
 */
export function momentsOnlyEsdOptions(rows: readonly RefinementParameter[]): Pick<RefinementOptions, "esdWith"> | Record<string, never> {
  const free = rows.filter((p) => !p.fixed && untied(p));
  if (!free.some((p) => isMomentParameterKind(p.kind)) || !free.every((p) => isMagneticModelParameterKind(p.kind))) return {};
  const esdWith = Object.keys(reRefinedRows(rows));
  return esdWith.length > 0 ? { esdWith } : {};
}

/**
 * The rows a moments step refines: the free, untied magnetic rows (the moment
 * amplitudes; k's components where the caller's rows carry them free, which
 * the page's never do); at k = 0 under K0_SCALE_WITH_MOMENTS, the untied
 * scale rows with them.
 */
function momentsStepIds(problem: MomentsFitProblem): string[] {
  const scaleToo = K0_SCALE_WITH_MOMENTS && atKZero(problem.magnetic);
  return problem.rows
    .filter((p) => untied(p) && ((scaleToo && p.kind === "scale") || (isMagneticModelParameterKind(p.kind) && !p.fixed)))
    .map((p) => p.id);
}

/**
 * The moments fit: a moments step, then rounds of (the scale and the
 * background, the moments held) and (the moments, every nuclear row held),
 * until the moments settle. It ends on a moments step. With no row to
 * re-refine it is one moments step: 0 rounds, settled.
 */
export async function runMomentsFit(problem: MomentsFitProblem, hooks: MomentsFitHooks = {}): Promise<MomentsFitOutcome | { readonly cancelled: true }> {
  const reRefinedIds = Object.keys(reRefinedRows(problem.rows));
  const out = await alternateMoments({
    rows: problem.rows,
    momentIds: momentsStepIds(problem),
    betweenIds: reRefinedIds,
    fit: problem.fit,
    ...(hooks.cancelled ? { cancelled: hooks.cancelled } : {}),
    ...(hooks.onRound ? { onRound: hooks.onRound } : {}),
  });
  if (!out) return { cancelled: true };
  const esd: Record<string, number> = {};
  for (const p of problem.rows) if (isMagneticModelParameterKind(p.kind) && out.result.esd[p.id] !== undefined) esd[p.id] = out.result.esd[p.id]!;
  const esdIncludes = out.result.diagnostics?.esdIncludes ?? [];
  return {
    cancelled: false,
    values: out.values,
    esd,
    esdIncludes,
    esdAloneReason: esdIncludes.length === 0 ? out.result.diagnostics?.esdWithFailed ?? null : null,
    // Every row the rounds may have moved, whichever step refined it (the scale is a moments step's at k = 0 under K0_SCALE_WITH_MOMENTS).
    reRefined: Object.fromEntries(reRefinedIds.map((id) => [id, out.values[id]!])),
    rounds: out.rounds,
    settled: out.settled,
    lastShiftOverEsd: out.lastShiftOverEsd,
    agreement: out.result.agreement.rWeighted ?? null,
    result: out.result,
  };
}
