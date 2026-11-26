/**
 * The layer-by-layer subgroup search on a short-range PDF fit (THY-72): which
 * lower symmetry the local structure has, judged by BIC with the independent
 * points of the window, a gate of five criteria and fixed stop rules. The
 * owner's decisions are the spec (THY-72 DECISIONS, items 1–11); every number
 * below is one of them, never a tuning of this file.
 *
 * The search runs one step at a time; the caller (the Agent's workflow)
 * confirms between steps and may pick a branch:
 *
 *  - **Step 1**: every single-irrep class that moves atoms, refined with that
 *    irrep's displacement modes only (ADPs tied to the parent's sites), ranked
 *    by BIC; the classes whose irrep moves no atom (strain or ordering only)
 *    are listed without a fit.
 *  - **Step 2**: the coupled classes of the pairs among step 1's top three
 *    irreps.
 *  - **Step 3**: a beam through the maximal subgroups of the accepted
 *    children, the best three per layer (near-ties kept), equivalent classes
 *    merged.
 *
 * Statistics (decision 1): BIC = N_ind·ln(RSS/N_grid) + p·ln N_ind with
 * N_ind = (rmax − rmin)·Qmax/π, the window's independent points; a child
 * against its parent on the same data and window, ΔBIC = N_ind·ln(Rw_c²/Rw_p²)
 * + Δp·ln N_ind. p counts the rows a fit refines, a tied group once, a row the
 * correlation guard held not at all (decision 2).
 *
 * A child is accepted (decision 5) only when ΔBIC ≤ −6 and
 *  (1) each primary order parameter's amplitude is at least 3σ, σ from the
 *      fit's covariance × √(N_grid/N_ind);
 *  (2) at least 3 starts reach the best Rw within 0.1 % (relative);
 *  (3) the child is still preferred (ΔBIC < 0) refitted with rmax 2 Å lower
 *      and 2 Å higher;
 *  (4) no ADP is non-positive and no bond-valence sum is more than 15 % from
 *      its valence.
 * A child that fails is listed "not accepted" with its reasons.
 *
 * Starts (decision 7): the activation's own start and 9 kicked ones; a
 * candidate with ΔBIC ≤ 0 after them gets max(20, 10 × its new parameters)
 * in all before the gate is judged. Each step has a 10-minute budget, reports
 * progress and stops on an abort signal; what did not finish is named.
 *
 * Stop rules (decision 8): a child whose p would exceed N_ind/4 is listed, not
 * fitted, with the rmax that would allow it; an accepted child is refitted
 * with rmin just past the first G(r) peak, and if it is no longer preferred it
 * is marked "gain only from the first peak" and the search does not descend
 * below it. A candidate whose best Rw is worse than its parent's, that did
 * not converge or gave non-numbers, or that moves an atom more than 0.5 Å is
 * "fit failed" (decision 9), listed and never ranked.
 *
 * This module is pure: what a fit is, how a class is realised and refined,
 * lives behind {@link SearchHost} (the PDF page's binding is
 * app/pdfSubgroupSearch.ts).
 */

import { nyquistPointCount } from "@/core/totalscattering/grErrors";

// ── the owner's numbers ──────────────────────────────────────────────────────

/** The numbers the search decides by (THY-72 decisions; each says which). */
export interface SearchRules {
  /** Decision 4: a child must lower BIC by at least this (ΔBIC ≤ −6). */
  readonly deltaBic: number;
  /** Decision 5(1): the primary order parameter's amplitude in σ. */
  readonly amplitudeSigmas: number;
  /** Decision 5(2): starts that must reach the best Rw. */
  readonly agreeingStarts: number;
  /** Decision 5(2): "reach the best Rw": within this relative difference. */
  readonly agreementTolerance: number;
  /** Decision 5(3): rmax moved by this much (Å) down and up. */
  readonly rmaxShift: number;
  /** Decision 5(4): the largest relative deviation of a bond-valence sum. */
  readonly bondValenceTolerance: number;
  /** Decision 9: the largest displacement (Å) of an atom from its parent position. */
  readonly maxDisplacement: number;
  /** Decision 8(1): p may not exceed N_ind times this. */
  readonly parameterCap: number;
  /** Decision 7: the starts every candidate gets (the activation's own and the kicked ones). */
  readonly starts: number;
  /** Decision 7: a candidate with ΔBIC ≤ 0 is topped up to max(this, …). */
  readonly topUpMin: number;
  /** Decision 7: … max(…, this × its new parameters). */
  readonly topUpPerParameter: number;
  /** Decision 7: the budget of one step (ms). */
  readonly stepBudgetMs: number;
  /** Decision 6: children kept per layer of step 3. */
  readonly beamWidth: number;
  /** Decision 6: step 2 pairs the irreps among this many of step 1's top. */
  readonly pairedIrreps: number;
  /** Decision 10: the window's upper end (Å). */
  readonly rmax: number;
  /**
   * Decision 6 says "near-ties kept" without a number: a child whose BIC is
   * within this of the last one kept in a layer is kept too. Not the owner's
   * number yet (2 is Kass & Raftery's "not worth more than a bare mention").
   */
  readonly nearTie: number;
}

export const SEARCH_RULES: SearchRules = {
  deltaBic: -6,
  amplitudeSigmas: 3,
  agreeingStarts: 3,
  agreementTolerance: 0.001,
  rmaxShift: 2,
  bondValenceTolerance: 0.15,
  maxDisplacement: 0.5,
  parameterCap: 0.25,
  starts: 10,
  topUpMin: 20,
  topUpPerParameter: 10,
  stepBudgetMs: 10 * 60_000,
  beamWidth: 3,
  pairedIrreps: 3,
  rmax: 10,
  nearTie: 2,
};

/**
 * The kicks of the starts (decision 7: "mostly ≤ 0.1 Å, a few 0.2–0.3 Å;
 * tied Uiso reset to ~half in some starts"), by the start's place in each
 * run of ten: start 0 is the activation's own; 1–7 kick the free modes so the
 * atom that moves most moves 0.02–0.1 Å, 8–9 so it moves 0.2–0.3 Å; starts
 * 3, 6 and 9 also start the tied ADPs at half the parent's.
 */
export const KICKS = { small: [0.02, 0.1], large: [0.2, 0.3], largeFrom: 8, halfAdp: [3, 6, 9], adpFactor: 0.5 } as const;

// ── statistics ───────────────────────────────────────────────────────────────

/** A fit window (Å). */
export interface Window {
  readonly rmin: number;
  readonly rmax: number;
}

/** N_ind = (rmax − rmin)·Qmax/π (decision 1). */
export const independentPoints = (w: Window, qmax: number): number => nyquistPointCount(w.rmin, w.rmax, qmax);

/** BIC = N_ind·ln(RSS/N_grid) + p·ln N_ind, RSS = Rw²·Σo² (uniform weights). */
export function bicOf(rw: number, sumObs2: number, nGrid: number, nInd: number, p: number): number {
  return nInd * Math.log((rw * rw * sumObs2) / nGrid) + p * Math.log(nInd);
}

/** ΔBIC of a child against its parent on the same data and window: N_ind·ln(Rw_c²/Rw_p²) + Δp·ln N_ind. */
export function deltaBicOf(rwChild: number, rwParent: number, dp: number, nInd: number): number {
  return nInd * Math.log((rwChild * rwChild) / (rwParent * rwParent)) + dp * Math.log(nInd);
}

/** The smallest rmax (Å) at which p parameters stay within the cap: N_ind·cap ≥ p. */
export const rmaxAllowing = (p: number, rmin: number, qmax: number, rules: SearchRules = SEARCH_RULES): number => rmin + (p * Math.PI) / (qmax * rules.parameterCap);

/** How many starts agree with the best: Rw within the relative tolerance of the lowest. */
export function agreeingCount(rws: readonly number[], tolerance: number): number {
  const ok = rws.filter((x) => Number.isFinite(x));
  if (ok.length === 0) return 0;
  const best = Math.min(...ok);
  return ok.filter((x) => (x - best) <= tolerance * best).length;
}

/** The starts a candidate gets once its ΔBIC is ≤ 0: max(20, 10 × its new parameters). */
export const toppedUpStarts = (dp: number, rules: SearchRules = SEARCH_RULES): number => Math.max(rules.topUpMin, rules.topUpPerParameter * dp, rules.starts);

// ── starts ───────────────────────────────────────────────────────────────────

/** One start of a candidate's fit. */
export interface StartPlan {
  /** 0 is the activation's own start (no kick). */
  readonly index: number;
  /** The kick (Å): the displacement of the atom it moves most; 0 for none. */
  readonly kick: number;
  /** The kick's direction in the free modes' space (one entry per free mode, unit length); empty for none. */
  readonly direction: readonly number[];
  /** The tied ADPs start at the parent's times this. */
  readonly adpFactor: number;
}

/** A small deterministic generator (mulberry32). */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string's seed (FNV-1a). */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Start `index` of a candidate with `modes` free modes, the same for the same seed, whatever ran before. */
export function startPlan(index: number, modes: number, seed: number): StartPlan {
  const slot = index % 10;
  const adpFactor = (KICKS.halfAdp as readonly number[]).includes(slot) ? KICKS.adpFactor : 1;
  if (index === 0 || modes === 0) return { index, kick: 0, direction: [], adpFactor: index === 0 ? 1 : adpFactor };
  const rand = generator(seed ^ Math.imul(index + 1, 0x9e3779b1));
  const [lo, hi] = slot >= KICKS.largeFrom || slot === 0 ? KICKS.large : KICKS.small;
  const kick = lo + (hi - lo) * rand();
  const v: number[] = [];
  for (let i = 0; i < modes; i++) v.push(Math.sqrt(-2 * Math.log(rand() + 1e-300)) * Math.cos(2 * Math.PI * rand()));
  const norm = Math.hypot(...v) || 1;
  return { index, kick, direction: v.map((x) => x / norm), adpFactor };
}

// ── candidates and the host ──────────────────────────────────────────────────

/** An irrep along an order-parameter direction. */
export interface IrrepAlong {
  /** Its generic label ("R irrep 8 of 10"). */
  readonly label: string;
  /** Its order-parameter direction ("(a,a,a)"). */
  readonly direction: string;
}

/** A class to fit: a subgroup of the parent with the irreps whose modes refine. */
export interface SearchCandidate {
  /** Unique within a search: the class and its order parameter. */
  readonly key: string;
  /** The class's row key ("c71", "s12"). */
  readonly classKey: string;
  /** Its group ("R -3 c:H #167"). */
  readonly group: string;
  /** "same cell", or the parent-axes box ("2×2×2"). */
  readonly cell: string;
  /** [G : H]. */
  readonly index: number;
  /** The primary order parameter: one irrep (step 1), the coupled pair (step 2), the new ones (step 3). */
  readonly irreps: readonly IrrepAlong[];
  /** Every irrep whose modes refine (step 3 adds its parent's). */
  readonly freeIrreps: readonly IrrepAlong[];
  /** False when the order parameter moves no atom (strain or ordering only): listed, never fitted. */
  readonly moves: boolean;
}

/** A primary order parameter's amplitude after a fit. */
export interface AmplitudeReading {
  readonly label: string;
  /** √ΣA² over the irrep's free modes (Å). */
  readonly amplitude: number;
  /** Its esd from the fit's covariance (not yet scaled by √(N_grid/N_ind)); NaN when the covariance cannot give it. */
  readonly esd: number;
}

/** What one fit gives. */
export interface FitReading {
  readonly rw: number;
  /** The fit ended converged (not stalled, diverged, failed or at its iteration cap). */
  readonly converged: boolean;
  readonly status: string;
  /** Every refined row's value (to start a later fit from). */
  readonly values: Readonly<Record<string, number>>;
  /** The primary order parameters' amplitudes. */
  readonly amplitudes: readonly AmplitudeReading[];
  /** The largest displacement of an atom from its parent position (Å). */
  readonly maxDisplacement: number;
  /** Sites with a non-positive ADP. */
  readonly nonPositiveAdp: readonly string[];
  /** The bond-valence sums' relative deviations, by site (empty: none tabulated). */
  readonly bondValence: readonly { readonly site: string; readonly deviation: number }[];
  readonly message?: string;
}

/** A fitted model to compare against, refitted in other windows (the parent, or an accepted child in step 3). */
export interface Reference {
  readonly label: string;
  /** The rows it refines (p). */
  readonly parameters: number;
  /** Refit from its best values in another window. */
  refit(window: Window): Promise<FitReading>;
}

/** A candidate realised and ready to fit. */
export interface PreparedCandidate {
  /** Its p: the rows it refines after the ties and the correlation guard. */
  readonly parameters: number;
  /** The free mode ids (the kicks' space). */
  readonly modeIds: readonly string[];
  /** Rows the correlation guard held, each with its reason (reported, not counted). */
  readonly heldByGuard: readonly string[];
  /** Fit one start in a window. */
  fit(start: StartPlan, window: Window): Promise<FitReading>;
  /** Refit from these values in a window (no kick). */
  refitFrom(values: Readonly<Record<string, number>>, window: Window): Promise<FitReading>;
  /**
   * The correlation guard at these values (the best start's): the candidate
   * with the rows it holds, or null when it holds none (or has held already).
   */
  guard(values: Readonly<Record<string, number>>): Promise<PreparedCandidate | null>;
}

/** The data side of the statistics: per window, the grid points and Σ Gobs². */
export interface WindowData {
  readonly nGrid: number;
  readonly sumObs2: number;
}

/** What a search needs from the page it runs on. */
export interface SearchHost {
  /** The data's own Qmax (Å⁻¹). */
  readonly qmax: number;
  /** The data's grid points and Σ Gobs² in a window. */
  windowData(window: Window): WindowData;
  /** Realise a candidate (with the free rows of its irreps; step 3: under this parent). */
  prepare(candidate: SearchCandidate, window: Window): Promise<PreparedCandidate | { readonly failed: string }>;
}

// ── the rows ─────────────────────────────────────────────────────────────────

/** One criterion of the gate. */
export interface GateCheck {
  readonly pass: boolean;
  readonly detail: string;
}

export interface GateVerdict {
  readonly accepted: boolean;
  /** Why it is not accepted (empty when accepted). */
  readonly reasons: readonly string[];
  readonly deltaBic: GateCheck;
  readonly amplitude: GateCheck & { readonly sigmas: readonly { readonly label: string; readonly amplitude: number; readonly sigma: number; readonly ratio: number }[] };
  readonly restarts: GateCheck;
  readonly rmaxShift: GateCheck & { readonly deltaBicLow: number; readonly deltaBicHigh: number };
  readonly adp: GateCheck;
  readonly bondValence: GateCheck & { readonly worst: number | null };
}

export type RowStatus = "fitted" | "not fitted" | "fit failed";

/** One candidate in a step's table. */
export interface CandidateRow {
  readonly candidate: SearchCandidate;
  readonly status: RowStatus;
  /** Why it was not fitted, or why the fit failed. */
  readonly reason?: string;
  /** The reference it is compared with. */
  readonly reference: string;
  readonly rw?: number;
  readonly p?: number;
  readonly dp?: number;
  readonly bic?: number;
  readonly deltaBic?: number;
  readonly startsRun?: number;
  readonly startsAgreeing?: number;
  readonly heldByGuard?: readonly string[];
  readonly gate?: GateVerdict;
  /** Accepted, refitted with rmin just past the first peak (stop rule 8(2)). */
  readonly firstPeak?: { readonly rmin: number; readonly deltaBic: number; readonly gainOnlyFromFirstPeak: boolean };
  /** The best fit's reading (values, amplitudes, displacement). */
  readonly best?: FitReading;
  /** Every start's Rw, in order. */
  readonly startRws?: readonly number[];
  /** Step 3: the other accepted parents this class sits under (merged). */
  readonly alsoUnder?: readonly string[];
}

export const isAccepted = (row: CandidateRow): boolean => row.gate?.accepted === true;

/** A step's table and how it ended. */
export interface StepResult {
  readonly step: 1 | 2 | 3;
  /** Step 3's layer (1 for the first beam layer). */
  readonly layer?: number;
  readonly window: Window;
  readonly nInd: number;
  readonly nGrid: number;
  /** Every candidate: the fitted ranked by BIC (the accepted first), then the failed, then the not fitted. */
  readonly rows: readonly CandidateRow[];
  /** The candidates the budget or the stop left unfitted, by key (also rows "not fitted"). */
  readonly unfinished: readonly string[];
  readonly ended: "complete" | "budget" | "stopped";
  /** Why the search stops here, when it does (no child passes the gate). */
  readonly stop: string | null;
  readonly elapsedMs: number;
}

/** A step's progress line. */
export interface SearchProgress {
  readonly done: number;
  readonly total: number;
  readonly current: string;
  readonly elapsedMs: number;
}

/** What a step runs with. */
export interface StepContext {
  readonly host: SearchHost;
  readonly window: Window;
  /** The first G(r) peak's far edge (Å): where the first-peak check's window starts. */
  readonly firstPeakPast: number;
  readonly rules?: SearchRules;
  readonly onProgress?: (p: SearchProgress) => void;
  readonly signal?: AbortSignal;
  /** The clock (ms); tests replace it. */
  readonly now?: () => number;
}

// ── one candidate ────────────────────────────────────────────────────────────

const pct = (x: number): string => `${(100 * x).toFixed(2)} %`;

/** Thrown inside a step when its budget ends or it is stopped. */
class StepInterrupted extends Error {
  constructor(readonly why: "budget" | "stopped") {
    super(why);
  }
}

interface Clock {
  readonly check: () => void;
}

/** A failed fit's reason, or null (decision 9). */
function failureOf(best: FitReading | null, referenceRw: number, rules: SearchRules): string | null {
  if (!best) return "no start gave a number";
  if (!Number.isFinite(best.rw)) return "the fit returned non-numbers";
  if (!best.converged) return `the best start did not converge (${best.status})`;
  // A child holds its parent (its modes at 0), so it is worse only when its fit missed: beyond round-off, read
  // with the starts' agreement tolerance (a child back at the parent's minimum is not a failed fit).
  if (best.rw > referenceRw * (1 + rules.agreementTolerance)) return `its best Rw ${pct(best.rw)} is worse than its parent's ${pct(referenceRw)}`;
  if (best.maxDisplacement > rules.maxDisplacement) return `an atom moves ${best.maxDisplacement.toFixed(3)} Å from its parent position (bound ${rules.maxDisplacement} Å)`;
  return null;
}

/** The reference's readings a step shares between its candidates. */
interface ReferenceFits {
  readonly reference: Reference;
  readonly at: (window: Window) => Promise<FitReading>;
}

function referenceFits(reference: Reference): ReferenceFits {
  const cache = new Map<string, Promise<FitReading>>();
  return {
    reference,
    at: (w) => {
      const key = `${w.rmin}|${w.rmax}`;
      let hit = cache.get(key);
      if (!hit) cache.set(key, (hit = reference.refit(w)));
      return hit;
    },
  };
}

/** Fit, top up, gate and check one candidate against its reference. */
async function evaluate(candidate: SearchCandidate, ref: ReferenceFits, ctx: StepContext, clock: Clock): Promise<CandidateRow> {
  const rules = ctx.rules ?? SEARCH_RULES;
  const { host, window } = ctx;
  const base = { candidate, reference: ref.reference.label };
  if (!candidate.moves) return { ...base, status: "not fitted", reason: "strain or ordering only: its order parameter moves no atom" };
  const data = host.windowData(window);
  const nInd = independentPoints(window, host.qmax);
  const first = await host.prepare(candidate, window);
  if ("failed" in first) return { ...base, status: "fit failed", reason: first.failed };
  let prepared: PreparedCandidate = first;
  const capped = (pc: PreparedCandidate): CandidateRow | null => {
    const p = pc.parameters;
    const dp = p - ref.reference.parameters;
    if (p > rules.parameterCap * nInd) {
      return {
        ...base,
        status: "not fitted",
        p,
        dp,
        heldByGuard: pc.heldByGuard,
        reason: `p = ${p} would exceed N_ind/4 = ${(rules.parameterCap * nInd).toFixed(1)}; rmax ≥ ${rmaxAllowing(p, window.rmin, host.qmax, rules).toFixed(2)} Å would allow it`,
      };
    }
    if (dp <= 0) return { ...base, status: "not fitted", p, dp, heldByGuard: pc.heldByGuard, reason: `it frees no parameter beyond its parent's${pc.heldByGuard.length > 0 ? ` once the correlation guard held ${pc.heldByGuard.join(", ")}` : ""}: nothing to compare` };
    return null;
  };
  const cap0 = capped(prepared);
  if (cap0) return cap0;
  const refRw = (await ref.at(window)).rw;
  const seed = seedOf(candidate.key);
  let readings: FitReading[] = [];
  let rws: number[] = [];
  const run = async (count: number): Promise<void> => {
    while (readings.length < count) {
      clock.check();
      const plan = startPlan(readings.length, prepared.modeIds.length, seed);
      let reading: FitReading;
      try {
        reading = await prepared.fit(plan, window);
      } catch (e) {
        reading = { rw: NaN, converged: false, status: "failed", values: {}, amplitudes: [], maxDisplacement: NaN, nonPositiveAdp: [], bondValence: [], message: e instanceof Error ? e.message : String(e) };
      }
      readings.push(reading);
      rws.push(reading.rw);
    }
  };
  const bestOf = (): FitReading | null => readings.filter((r) => Number.isFinite(r.rw)).reduce<FitReading | null>((a, b) => (a === null || b.rw < a.rw ? b : a), null);
  await run(rules.starts);
  let best = bestOf();
  // The correlation guard at the best start; with rows held, the starts again on the smaller set.
  if (best) {
    const held = await prepared.guard(best.values);
    if (held) {
      prepared = held;
      const cap1 = capped(prepared);
      if (cap1) return cap1;
      readings = [];
      rws = [];
      await run(rules.starts);
      best = bestOf();
    }
  }
  const p = prepared.parameters;
  const dp = p - ref.reference.parameters;
  const dBic = (rw: number): number => deltaBicOf(rw, refRw, dp, nInd);
  if (best && Number.isFinite(best.rw) && dBic(best.rw) <= 0) {
    await run(toppedUpStarts(dp, rules));
    best = bestOf();
  }
  const common = { ...base, p, dp, startsRun: readings.length, startsAgreeing: agreeingCount(rws, rules.agreementTolerance), heldByGuard: prepared.heldByGuard, startRws: rws };
  const failed = failureOf(best, refRw, rules);
  if (failed || !best) return { ...common, status: "fit failed", reason: failed ?? "no start gave a number", ...(best && Number.isFinite(best.rw) ? { rw: best.rw, best } : {}) };
  const deltaBic = dBic(best.rw);
  const bic = bicOf(best.rw, data.sumObs2, data.nGrid, nInd, p);
  const row: CandidateRow = { ...common, status: "fitted", rw: best.rw, bic, deltaBic, best };
  const gate = await gateOf(row, best, prepared, ref, ctx, clock, { nInd, nGrid: data.nGrid, rules });
  let firstPeak: CandidateRow["firstPeak"];
  if (gate.accepted) {
    clock.check();
    const w: Window = { rmin: ctx.firstPeakPast, rmax: window.rmax };
    const child = await prepared.refitFrom(best.values, w);
    const parent = await ref.at(w);
    const d = deltaBicOf(child.rw, parent.rw, dp, independentPoints(w, host.qmax));
    firstPeak = { rmin: w.rmin, deltaBic: d, gainOnlyFromFirstPeak: !(d < 0) };
  }
  return { ...row, gate, ...(firstPeak ? { firstPeak } : {}) };
}

/** The gate's five criteria (decision 5); the costly refits only for a child with ΔBIC ≤ 0. */
async function gateOf(row: CandidateRow, best: FitReading, prepared: PreparedCandidate, ref: ReferenceFits, ctx: StepContext, clock: Clock, s: { readonly nInd: number; readonly nGrid: number; readonly rules: SearchRules }): Promise<GateVerdict> {
  const { rules } = s;
  const deltaBic = row.deltaBic!;
  const dBicPass = deltaBic <= rules.deltaBic;
  const scale = Math.sqrt(s.nGrid / s.nInd);
  const sigmas = best.amplitudes.map((a) => {
    const sigma = a.esd * scale;
    return { label: a.label, amplitude: a.amplitude, sigma, ratio: Number.isFinite(sigma) && sigma > 0 ? a.amplitude / sigma : NaN };
  });
  const ampPass = sigmas.length > 0 && sigmas.every((x) => x.ratio >= rules.amplitudeSigmas);
  const agreeing = row.startsAgreeing ?? 0;
  const restartsPass = agreeing >= rules.agreeingStarts;
  let low = NaN;
  let high = NaN;
  if (deltaBic <= 0) {
    for (const shift of [-rules.rmaxShift, rules.rmaxShift]) {
      clock.check();
      const w: Window = { rmin: ctx.window.rmin, rmax: ctx.window.rmax + shift };
      const child = await prepared.refitFrom(best.values, w);
      const parent = await ref.at(w);
      const d = deltaBicOf(child.rw, parent.rw, row.dp!, independentPoints(w, ctx.host.qmax));
      if (shift < 0) low = d;
      else high = d;
    }
  }
  const shiftPass = low < 0 && high < 0;
  const adpPass = best.nonPositiveAdp.length === 0;
  const worst = best.bondValence.length > 0 ? best.bondValence.reduce((a, b) => (Math.abs(b.deviation) > Math.abs(a.deviation) ? b : a)) : null;
  const bvsPass = worst === null || Math.abs(worst.deviation) <= rules.bondValenceTolerance;
  const verdict = {
    deltaBic: { pass: dBicPass, detail: `ΔBIC ${deltaBic.toFixed(1)} (needs ≤ ${rules.deltaBic})` },
    amplitude: {
      pass: ampPass,
      detail: sigmas.length === 0 ? "no order-parameter amplitude was read" : sigmas.map((x) => `${x.label} ${x.amplitude.toFixed(3)} Å = ${Number.isFinite(x.ratio) ? x.ratio.toFixed(1) : "undetermined"}σ`).join(", ") + ` (needs ≥ ${rules.amplitudeSigmas}σ)`,
      sigmas,
    },
    restarts: { pass: restartsPass, detail: `${agreeing} of ${row.startsRun} starts reach the best Rw within ${100 * rules.agreementTolerance} % (needs ${rules.agreeingStarts})` },
    rmaxShift: {
      pass: shiftPass,
      detail: Number.isFinite(low) ? `ΔBIC ${low.toFixed(1)} at rmax ${ctx.window.rmax - rules.rmaxShift} Å, ${high.toFixed(1)} at ${ctx.window.rmax + rules.rmaxShift} Å (needs < 0 at both)` : "not refitted (ΔBIC > 0)",
      deltaBicLow: low,
      deltaBicHigh: high,
    },
    adp: { pass: adpPass, detail: adpPass ? "every ADP positive" : `non-positive ADP at ${best.nonPositiveAdp.join(", ")}` },
    bondValence: {
      pass: bvsPass,
      detail: worst === null ? "no bond-valence parameters for these ions" : `largest bond-valence deviation ${(100 * worst.deviation).toFixed(1)} % at ${worst.site} (needs ≤ ${100 * rules.bondValenceTolerance} %)`,
      worst: worst === null ? null : worst.deviation,
    },
  };
  const checks = [verdict.deltaBic, verdict.amplitude, verdict.restarts, verdict.rmaxShift, verdict.adp, verdict.bondValence];
  return { accepted: checks.every((c) => c.pass), reasons: checks.filter((c) => !c.pass).map((c) => c.detail), ...verdict };
}

// ── a step ───────────────────────────────────────────────────────────────────

/** The order a table shows: accepted by BIC, other fitted by BIC, failed, then not fitted. */
export function rankRows(rows: readonly CandidateRow[]): CandidateRow[] {
  const tier = (r: CandidateRow): number => (r.status === "fitted" ? (isAccepted(r) ? 0 : 1) : r.status === "fit failed" ? 2 : 3);
  return [...rows].sort((a, b) => tier(a) - tier(b) || (a.bic ?? Infinity) - (b.bic ?? Infinity));
}

/** Run candidates against their references within one step's budget. */
async function runStep(
  step: 1 | 2 | 3,
  items: readonly { readonly candidate: SearchCandidate; readonly reference: ReferenceFits; readonly alsoUnder?: readonly string[] }[],
  ctx: StepContext,
  layer?: number,
): Promise<StepResult> {
  const rules = ctx.rules ?? SEARCH_RULES;
  const now = ctx.now ?? (() => performance.now());
  const t0 = now();
  const clock: Clock = {
    check: () => {
      if (ctx.signal?.aborted) throw new StepInterrupted("stopped");
      if (now() - t0 > rules.stepBudgetMs) throw new StepInterrupted("budget");
    },
  };
  const rows: CandidateRow[] = [];
  const unfinished: string[] = [];
  let ended: StepResult["ended"] = "complete";
  for (const [i, item] of items.entries()) {
    if (ended !== "complete") {
      unfinished.push(item.candidate.key);
      rows.push({ candidate: item.candidate, reference: item.reference.reference.label, status: "not fitted", reason: ended === "budget" ? "the step's budget ended first" : "the step was stopped first" });
      continue;
    }
    ctx.onProgress?.({ done: i, total: items.length, current: `${item.candidate.group} (${item.candidate.irreps.map((x) => `${x.label} ${x.direction}`).join(" + ")})`, elapsedMs: now() - t0 });
    try {
      const row = await evaluate(item.candidate, item.reference, ctx, clock);
      rows.push(item.alsoUnder?.length ? { ...row, alsoUnder: item.alsoUnder } : row);
    } catch (e) {
      if (!(e instanceof StepInterrupted)) throw e;
      ended = e.why;
      unfinished.push(item.candidate.key);
      rows.push({ candidate: item.candidate, reference: item.reference.reference.label, status: "not fitted", reason: ended === "budget" ? "the step's budget ended during its fit" : "the step was stopped during its fit" });
    }
  }
  ctx.onProgress?.({ done: items.length - unfinished.length, total: items.length, current: "", elapsedMs: now() - t0 });
  const data = ctx.host.windowData(ctx.window);
  const ranked = rankRows(rows);
  const anyAccepted = ranked.some(isAccepted);
  return {
    step,
    ...(layer !== undefined ? { layer } : {}),
    window: ctx.window,
    nInd: independentPoints(ctx.window, ctx.host.qmax),
    nGrid: data.nGrid,
    rows: ranked,
    unfinished,
    ended,
    stop: ended === "complete" && !anyAccepted ? "no child passes the gate" : null,
    elapsedMs: now() - t0,
  };
}

/** Step 1: every single-irrep class (decision 6), against the parent. */
export function searchStep1(ctx: StepContext, parent: Reference, candidates: readonly SearchCandidate[]): Promise<StepResult> {
  const ref = referenceFits(parent);
  return runStep(1, candidates.map((candidate) => ({ candidate, reference: ref })), ctx);
}

/** Step 1's top irreps: the first `count` distinct irreps of its fitted rows, by BIC. */
export function topIrreps(step1: StepResult, count = (SEARCH_RULES.pairedIrreps)): string[] {
  const out: string[] = [];
  for (const row of step1.rows) {
    if (row.status !== "fitted") continue;
    for (const ir of row.candidate.irreps) if (!out.includes(ir.label) && out.length < count) out.push(ir.label);
  }
  return out;
}

/**
 * Step 2: the coupled classes of the pairs among step 1's top irreps, against
 * the parent (decision 1: a child against its parent). `candidates` is every
 * coupled class of two irreps the host lists; those whose pair is among the
 * top are fitted. Step 1 must have accepted a child.
 */
export function searchStep2(ctx: StepContext, parent: Reference, step1: StepResult, coupled: readonly SearchCandidate[]): Promise<StepResult> {
  const rules = ctx.rules ?? SEARCH_RULES;
  const top = topIrreps(step1, rules.pairedIrreps);
  const ref = referenceFits(parent);
  const chosen = step1.rows.some(isAccepted)
    ? coupled.filter((c) => c.irreps.length === 2 && c.irreps.every((ir) => top.includes(ir.label)) && c.irreps[0]!.label !== c.irreps[1]!.label)
    : [];
  return runStep(2, chosen.map((candidate) => ({ candidate, reference: ref })), ctx);
}

/** An accepted child the beam may descend from, with the reference it becomes. */
export interface BeamNode {
  readonly row: CandidateRow;
  readonly reference: Reference;
}

/**
 * The beam's frontier: the accepted rows not marked "gain only from the first
 * peak", best `beamWidth` by BIC, and any within `nearTie` of the last kept.
 */
export function beamOf(rows: readonly CandidateRow[], rules: SearchRules = SEARCH_RULES): CandidateRow[] {
  const ok = rankRows(rows.filter((r) => isAccepted(r) && !r.firstPeak?.gainOnlyFromFirstPeak));
  if (ok.length <= rules.beamWidth) return ok;
  const last = ok[rules.beamWidth - 1]!.bic!;
  return ok.filter((r, i) => i < rules.beamWidth || r.bic! - last <= rules.nearTie);
}

/**
 * Step 3, one layer: the maximal subgroups of each frontier node, each class
 * once (under its best parent by BIC, the others named), against that parent.
 * `childrenOf` gives a node's maximal subgroups as candidates (their free
 * irreps the node's plus their own order parameter's).
 */
export function searchStep3Layer(ctx: StepContext, frontier: readonly BeamNode[], childrenOf: (node: BeamNode) => readonly SearchCandidate[], layer: number): Promise<StepResult> {
  const byClass = new Map<string, { candidate: SearchCandidate; node: BeamNode; also: string[] }>();
  const ordered = [...frontier].sort((a, b) => (a.row.bic ?? Infinity) - (b.row.bic ?? Infinity));
  const refs = new Map(ordered.map((n) => [n, referenceFits(n.reference)] as const));
  for (const node of ordered) {
    for (const c of childrenOf(node)) {
      const seen = byClass.get(c.classKey);
      if (seen) seen.also.push(node.reference.label);
      else byClass.set(c.classKey, { candidate: c, node, also: [] });
    }
  }
  const items = [...byClass.values()].map((x) => ({ candidate: x.candidate, reference: refs.get(x.node)!, alsoUnder: x.also }));
  return runStep(3, items, ctx, layer);
}
