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
 *    (the engine's `esdWith`), or say why they could not;
 *  - an amplitude the fit leaves at exactly 0 is kicked to ZERO_START_KICK and
 *    kept only when the ranking's Hamilton test says the data require it, else
 *    held at 0 with no esd; a direction the data do not determine (a null
 *    direction of the covariance through a moment the fit carries) is said,
 *    and its rows get no esd (runMomentsFit).
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
import { alternateMoments, ALTERNATION_MAX_ROUNDS, ALTERNATION_SHIFT_TOLERANCE, K0_SCALE_WITH_MOMENTS, type AlternationOutcome } from "@/core/magnetic/momentAlternation";
import { noiseOf } from "@/core/magnetic/momentRestarts";
import { withinNoiseOfBest } from "@/core/diagnostics/hamilton";
import { RANK_NOISE_ALPHA, RANK_TIE_WR } from "@/core/diagnostics/thresholds";
import { fCritical } from "@/core/math/fDistribution";

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
  /**
   * The amplitudes the fit from the given start left at exactly 0, kicked and
   * tested (ZERO_START_KICK); null when there were none. Kept: the values are
   * the kicked fit's. Not kept: the rows are held at 0 and have no esd.
   */
  readonly zeroStart: ZeroStartTest | null;
  /**
   * The moment rows whose direction the data do not determine (a null
   * direction of the moments step's covariance that moves a moment the fit
   * carries: `undeterminedFamilies`), by family. Their esds are not given:
   * the engine's esds leave that direction out and read too small.
   */
  readonly undetermined: readonly UndeterminedFamily[];
}

/**
 * The kick a free, untied moment amplitude gets when the fit from its start
 * leaves it at exactly 0, in µ_B. Magnetic intensity is quadratic in the
 * amplitudes: a mode in an irrep of its own has no gradient at 0, and a fit
 * started there never leaves it, though the data may want it (a missed
 * component also biases the others: docs/reports/2026-11-26-zero-start-moments.md).
 * Fixed and deterministic, as the PDF page's ACTIVATION_KICK.
 */
export const ZERO_START_KICK = 0.1;

/** A weighted residual below which a fit is exact (noise-free data): the alternation's and the engine's line. */
const EXACT_FIT_RWP = 1e-6;

/** An amplitude within this of 0 is at 0: a start the kick is for, or where the fit left it. */
export const ZERO_AMPLITUDE = 1e-6;

/**
 * A row takes part in a null direction (the engine's `nullDirections`, unit
 * vectors in its normalized coordinates) with a component at least this
 * large.
 */
export const NULL_DIRECTION_COMPONENT = 0.1;

/**
 * A moment the fit carries, for the family test: its value is more than this
 * many esds from 0 (an amplitude nearer 0 than its esd is not a moment the
 * direction of which is in question).
 */
export const CARRIED_MOMENT_ESDS = 3;

/** The zero-start test: the kicked fit against the fit that left the rows at 0, by the ranking's own Hamilton test. */
export interface ZeroStartTest {
  /** The rows left at exactly 0 and kicked to ZERO_START_KICK, in row order. */
  readonly rows: readonly string[];
  readonly kick: number;
  /** True: the data require the rows (the kicked fit is kept). False: they are held at 0. */
  readonly kept: boolean;
  /** χ² of the fit with the rows at 0 less χ² of the kicked fit (negative: the kicked fit is worse). Null where the fits report no χ². */
  readonly deltaChi2: number | null;
  /** The number of parameters the test adds: the kicked rows. */
  readonly q: number;
  /** Hamilton's F = (Δχ²/q)/(χ²/ν of the kicked fit), and its 5 % point F(q, ν). Null where the fits report no χ². */
  readonly f: number | null;
  readonly fCritical: number | null;
  /**
   * The likelihood-ratio significance of one kicked row, √(Δχ²/(χ²/ν)), in σ:
   * for a component that enters the intensity only squared, value/esd reads
   * twice this. Null for several rows (the test is joint) or no χ².
   */
  readonly z: number | null;
  /** Where the kicked fit put the kicked rows: the answer when kept, the alternative the data did not require otherwise. */
  readonly kickedValues: Readonly<Record<string, number>>;
}

/** Moment rows the data cannot orient: a direction in them changes the fit by nothing. */
export interface UndeterminedFamily {
  readonly rows: readonly string[];
  /**
   * Where an equally good fit (the kicked one, not required by the data) put
   * these rows; absent when the direction was found in the fit reported.
   */
  readonly alternative?: Readonly<Record<string, number>>;
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
 * The families of moment rows whose direction the data do not determine, in a
 * moments step's result: each null direction of its covariance (the engine's
 * `nullDirections`) restricted to the moment rows it moves by at least
 * NULL_DIRECTION_COMPONENT, where one of those rows carries a moment (its
 * value more than CARRIED_MOMENT_ESDS of its esd from 0). A null direction
 * that moves only amplitudes at or near 0, or a dead row (no esd), is a
 * component the data do not ask for (the zero-start test's business), not a
 * direction in question. On a powder a helix in an orthogonal cell is
 * one: its cosine and sine amplitudes on one axis trade along a circle of the
 * same |M| and the same pattern.
 */
export function undeterminedFamilies(result: RefinementResult, momentIds: readonly string[]): string[][] {
  const moments = new Set(momentIds);
  const out: string[][] = [];
  for (const d of result.diagnostics?.nullDirections ?? []) {
    const rows = Object.entries(d).filter(([id, c]) => moments.has(id) && Math.abs(c) >= NULL_DIRECTION_COMPONENT).map(([id]) => id);
    const carried = rows.some((id) => {
      const v = Math.abs(result.parameters[id] ?? 0);
      const e = result.esd[id];
      return e !== undefined && e > 0 && v > Math.max(ZERO_AMPLITUDE, CARRIED_MOMENT_ESDS * e);
    });
    if (rows.length > 0 && carried) out.push(rows);
  }
  return out;
}

/** Families that share a row are one. */
function mergeFamilies(families: readonly (readonly string[])[]): string[][] {
  const out: Set<string>[] = [];
  for (const f of families) {
    const joined = new Set(f);
    for (let i = out.length - 1; i >= 0; i--) {
      if ([...out[i]!].some((id) => joined.has(id))) {
        for (const id of out[i]!) joined.add(id);
        out.splice(i, 1);
      }
    }
    out.push(joined);
  }
  return out.map((s) => [...s]);
}

/**
 * The zero-start test: whether the kicked fit's χ² is lower than that of the
 * fit with the rows at 0 beyond the noise, by the magnetic ranking's own
 * Hamilton test (withinNoiseOfBest, at RANK_NOISE_ALPHA, q = the kicked rows).
 * Where the fits report no χ², the ranking's fallback: kept only when the
 * agreement is lower by more than RANK_TIE_WR.
 */
function zeroStartTest(zero: AlternationOutcome, kicked: AlternationOutcome, rows: readonly string[], freeCount: number): Omit<ZeroStartTest, "kick" | "kickedValues"> & { readonly equallyGood: boolean } {
  const q = rows.length;
  const a = noiseOf(zero.result);
  const b = noiseOf(kicked.result);
  const wa = zero.result.agreement.rWeighted;
  const wb = kicked.result.agreement.rWeighted;
  // Both fits exact (noise-free data): the kick gains nothing, and the two are the same fit to round-off.
  const exact = wa !== undefined && wb !== undefined && wa < EXACT_FIT_RWP && wb < EXACT_FIT_RWP;
  if (exact || a.chi2 === undefined || b.chi2 === undefined || b.dof === undefined || !(b.dof > 0)) {
    const kept = !exact && wa !== undefined && wb !== undefined && wb < wa - RANK_TIE_WR;
    const equallyGood = exact || (wa !== undefined && wb !== undefined && Math.abs(wb - wa) <= RANK_TIE_WR);
    return { rows, kept, equallyGood, deltaChi2: exact ? (a.chi2 ?? 0) - (b.chi2 ?? 0) : null, q, f: null, fCritical: null, z: null };
  }
  const deltaChi2 = a.chi2 - b.chi2;
  const noise = b.chi2 / b.dof;
  const within = withinNoiseOfBest([
    // The fit with the rows at 0 is the model without them: q parameters fewer, q degrees of freedom more.
    { id: "zero", chi2: a.chi2, dof: b.dof + q, parameters: freeCount - q },
    { id: "kicked", chi2: b.chi2, dof: b.dof, parameters: freeCount },
  ]);
  const kept = within.has("kicked") && !within.has("zero");
  const f = deltaChi2 / q / noise;
  return {
    rows, kept, equallyGood: within.has("kicked") && within.has("zero"), deltaChi2, q, f,
    fCritical: fCritical(RANK_NOISE_ALPHA, q, b.dof),
    z: q === 1 && deltaChi2 > 0 ? Math.sqrt(deltaChi2 / noise) : null,
  };
}

/**
 * The moments fit: a moments step, then rounds of (the scale and the
 * background, the moments held) and (the moments, every nuclear row held),
 * until the moments settle. It ends on a moments step. With no row to
 * re-refine it is one moments step: 0 rounds, settled.
 *
 * A free, untied moment amplitude that the fit from the given start leaves at
 * exactly 0 (ZERO_AMPLITUDE) is kicked: the fit is run again from the same
 * start with those rows at ZERO_START_KICK, and kept only when the data
 * require them (zeroStartTest, the ranking's Hamilton test with q = the kicked
 * rows). Otherwise the rows are held at 0, and the fit with the rows at 0 is
 * re-run from its end with them held, for esds of the rest that are not
 * spoiled by the dead rows. The sign of a kept row is a domain choice (the
 * intensity is even in it), not a measurement. The ranking's fits do not come
 * here and are not kicked. Both surfaces run this: the page's Refine moments
 * (powderPage.ts, powderMomentFit) and MCP refine_moments.
 */
export async function runMomentsFit(problem: MomentsFitProblem, hooks: MomentsFitHooks = {}): Promise<MomentsFitOutcome | { readonly cancelled: true }> {
  const reRefinedIds = Object.keys(reRefinedRows(problem.rows));
  const momentIds = momentsStepIds(problem);
  const run = (rows: readonly RefinementParameter[], ids: readonly string[] = momentIds) => alternateMoments({
    rows,
    momentIds: ids,
    betweenIds: reRefinedIds,
    fit: problem.fit,
    ...(hooks.cancelled ? { cancelled: hooks.cancelled } : {}),
    ...(hooks.onRound ? { onRound: hooks.onRound } : {}),
  });
  const amplitudeIds = problem.rows.filter((p) => isMomentParameterKind(p.kind) && momentIds.includes(p.id)).map((p) => p.id);
  const atZero = new Set(problem.rows.filter((p) => amplitudeIds.includes(p.id) && Math.abs(p.value) <= ZERO_AMPLITUDE).map((p) => p.id));
  const zero = await run(problem.rows);
  if (!zero) return { cancelled: true };
  // The rows the fit could not move off 0 (a row with a gradient there moved, and is the fit's answer).
  const stuck = problem.rows.filter((p) => atZero.has(p.id) && Math.abs(zero.values[p.id] ?? 0) <= ZERO_AMPLITUDE).map((p) => p.id);
  let out = zero;
  let zeroStart: ZeroStartTest | null = null;
  let rounds = { rounds: zero.rounds, settled: zero.settled, lastShiftOverEsd: zero.lastShiftOverEsd };
  const families: { rows: string[]; alternative?: Record<string, number> }[] = [];
  if (stuck.length > 0) {
    const kickedRows = problem.rows.map((p) => (stuck.includes(p.id) ? { ...p, value: ZERO_START_KICK } : p));
    const kicked = await run(kickedRows);
    if (!kicked) return { cancelled: true };
    const { equallyGood, ...test } = zeroStartTest(zero, kicked, stuck, momentIds.length);
    zeroStart = { ...test, kick: ZERO_START_KICK, kickedValues: Object.fromEntries(stuck.map((id) => [id, kicked.values[id]!])) };
    if (test.kept) {
      out = kicked;
      rounds = { rounds: kicked.rounds, settled: kicked.settled, lastShiftOverEsd: kicked.lastShiftOverEsd };
    } else {
      // Held at 0: the fit with the rows at 0, re-run from where it ended with them held (values unchanged; esds of the rest without the dead rows).
      const held = new Set(stuck);
      const heldRows = problem.rows.map((p) => ({ ...p, value: held.has(p.id) ? 0 : zero.values[p.id] ?? p.value, ...(held.has(p.id) ? { fixed: true } : {}) }));
      const again = await run(heldRows, momentIds.filter((id) => !held.has(id)));
      if (!again) return { cancelled: true };
      out = again;
      rounds = { rounds: zero.rounds, settled: zero.settled && again.settled, lastShiftOverEsd: Math.max(zero.lastShiftOverEsd, again.lastShiftOverEsd) };
      // A family the kicked fit found, where that fit is as good (within the noise both ways): the data do not determine the direction there either.
      if (equallyGood) for (const f of undeterminedFamilies(kicked.result, amplitudeIds)) families.push({ rows: f, alternative: Object.fromEntries(f.map((id) => [id, kicked.values[id]!])) });
    }
  }
  for (const f of undeterminedFamilies(out.result, amplitudeIds)) families.push({ rows: f });
  const undetermined: UndeterminedFamily[] = mergeFamilies(families.map((f) => f.rows)).map((rows) => {
    const alt = families.filter((f) => f.alternative && f.rows.some((id) => rows.includes(id))).map((f) => f.alternative!);
    const ordered = amplitudeIds.filter((id) => rows.includes(id));
    return alt.length > 0 ? { rows: ordered, alternative: Object.fromEntries(ordered.map((id) => [id, alt.find((a) => a[id] !== undefined)?.[id] ?? out.values[id]!])) } : { rows: ordered };
  });
  // No esd for a row held at 0, a row in an undetermined direction, or a dead row (the engine's esd 0 is no measurement).
  const dead = amplitudeIds.filter((id) => !((out.result.esd[id] ?? 1) > 0));
  const noEsd = new Set([...(zeroStart && !zeroStart.kept ? zeroStart.rows : []), ...undetermined.flatMap((f) => f.rows), ...dead]);
  const esd: Record<string, number> = {};
  for (const p of problem.rows) if (isMagneticModelParameterKind(p.kind) && out.result.esd[p.id] !== undefined && !noEsd.has(p.id)) esd[p.id] = out.result.esd[p.id]!;
  const esdIncludes = out.result.diagnostics?.esdIncludes ?? [];
  return {
    cancelled: false,
    values: out.values,
    esd,
    esdIncludes,
    esdAloneReason: esdIncludes.length === 0 ? out.result.diagnostics?.esdWithFailed ?? null : null,
    // Every row the rounds may have moved, whichever step refined it (the scale is a moments step's at k = 0 under K0_SCALE_WITH_MOMENTS).
    reRefined: Object.fromEntries(reRefinedIds.map((id) => [id, out.values[id]!])),
    rounds: rounds.rounds,
    settled: rounds.settled,
    lastShiftOverEsd: rounds.lastShiftOverEsd,
    agreement: out.result.agreement.rWeighted ?? null,
    // The engine's result, without an esd for a row held at 0 or one whose direction is not determined (as `esd`).
    result: noEsd.size > 0 ? { ...out.result, esd: Object.fromEntries(Object.entries(out.result.esd).filter(([id]) => !noEsd.has(id))) } : out.result,
    zeroStart,
    undetermined,
  };
}

const sig3 = (x: number): string => (Math.abs(x) >= 1000 ? x.toFixed(0) : Number(x.toPrecision(3)).toString()).replace(/^-/, "−");
const listOf = (names: readonly string[]): string => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * What the zero-start test and the undetermined directions mean, in words:
 * one sentence each, rows named by `name` (the page's labels, MCP's ids).
 * Empty when the fit had neither. The page's "?" and MCP's `reading` both
 * read these, so the two surfaces say the same.
 */
export function zeroStartSentences(out: Pick<MomentsFitOutcome, "zeroStart" | "undetermined">, name: (id: string) => string = (id) => id): string[] {
  const words: string[] = [];
  const z = out.zeroStart;
  if (z) {
    const rows = z.rows;
    const n = rows.length;
    const test = z.deltaChi2 === null
      ? "the fits report no χ², and wR moved by less than the ranking's tie"
      : `Δχ² ${sig3(z.deltaChi2)} for ${z.q} amplitude${z.q === 1 ? "" : "s"}, F ${sig3(z.f!)} ${z.kept ? ">" : "≤"} ${sig3(z.fCritical!)} at 5 %`;
    const it = n === 1 ? "it" : "them";
    const started = `${listOf(rows.map(name))} started at 0, where the fit cannot move ${it}; kicked to ${z.kick} µB`;
    if (z.kept) {
      words.push(`${started}, ${n === 1 ? "it is" : "they are"} kept: the data require ${it} (${test}${z.z !== null ? `; ${sig3(z.z)}σ by Δχ², not value/esd, which reads twice that for a component the intensity has only squared` : ""}). ${n === 1 ? "Its sign is" : "Their signs are"} a domain choice.`);
    } else {
      words.push(`${started}, ${n === 1 ? "it is" : "they are"} not required by the data (${test}) and ${n === 1 ? "is" : "are"} held at 0, with no esd.`);
    }
  }
  for (const f of out.undetermined) {
    const alt = f.alternative ? Object.entries(f.alternative) : [];
    words.push(`The data do not determine the direction of ${listOf(f.rows.map(name))}${alt.length > 0 ? ` (an equally good fit puts ${alt.map(([id, v]) => `${name(id)} ${sig3(v)}`).join(", ")})` : ""}: no esd is given for ${f.rows.length === 1 ? "it" : "them"}.`);
  }
  return words;
}
