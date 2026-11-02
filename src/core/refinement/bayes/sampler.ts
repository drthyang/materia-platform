/**
 * Affine-invariant ensemble MCMC sampler (Goodman & Weare stretch move) —
 * Bayesian posterior sampling over a RefinementProblem's free parameters.
 *
 * Where LM returns a point estimate + linearized ESDs, this returns the full
 * posterior: true correlations, non-Gaussian widths, and multimodality the
 * quadratic approximation cannot express. The stretch move is affine-invariant
 * (indifferent to the scale/correlation pathologies the LM preconditioner
 * fights — a ~1e-11 scale and a ~10 Å cell mix equally well) and needs no
 * gradients, so it works on every problem the engine can already evaluate.
 *
 * Architecture mirrors refineCore (engine.ts): a sans-io generator yields
 * batches of value-sets and receives their `calculate` results. Each half-
 * ensemble update is one batch of independent evaluations, so the pool driver
 * fans walkers across workers exactly like Jacobian columns. The RNG advances
 * ONLY inside the generator — never in a driver — so serial and pooled chains
 * are bit-identical (the sampler analog of engineParallel.test.ts), and the
 * full walker state serializes to a resume token for bounded MCP calls.
 *
 * References: Goodman & Weare, Comm. App. Math. Comp. Sci. 5 (2010) 65;
 * Foreman-Mackey et al., PASP 125 (2013) 306 (emcee). Crystallographic
 * precedent — MCMC posterior sampling for full-profile structure refinement,
 * with posterior widths vs Rietveld esds: Fancher et al., Sci. Rep. 6 (2016)
 * 31625, doi:10.1038/srep31625.
 */

import type { RefinementParameter } from "@/core/refinement/types";
import type { BatchEvaluator, RefinementProblem } from "@/core/refinement/engine";
import {
  DEFAULT_STUDENT_NU,
  logLikelihoodCurve,
  logPrior,
  nUsedOf,
  type NoiseModel,
  type PriorSpec,
} from "@/core/refinement/bayes/logPosterior";
import {
  logJacobian,
  planTransforms,
  toBounded,
  toUnbounded,
  type TransformSpec,
} from "@/core/refinement/bayes/transform";
import {
  buildDiagnostics,
  posteriorSummary,
  type PosteriorSummary,
  type SampleDiagnostics,
} from "@/core/refinement/bayes/diagnostics";
import { POSTERIOR_RHAT } from "@/core/diagnostics/thresholds";

/** Deterministic 32-bit PRNG (mulberry32) → uniform [0, 1). Counter-resumable:
 *  the state after n draws is a pure function of (seed, n), so a resume token
 *  needs only the draw count to reproduce the stream exactly. */
function mulberry32From(seed: number, skip: number): { next: () => number; count: () => number } {
  let s = seed >>> 0;
  let n = 0;
  const raw = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    n++;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < skip; i++) raw();
  return { next: raw, count: () => n };
}

/** Serializable ensemble state — the resume token for bounded chunked runs. */
export interface WalkerState {
  /** Walker positions in UNBOUNDED space, [nWalkers][nFree]. */
  readonly q: number[][];
  /** Cached log-posterior per walker (recomputed on rehydrate if absent). */
  readonly logP: number[];
  /** Draws consumed from the seeded RNG stream so far. */
  readonly rngDraws: number;
  /** Total ensemble steps taken so far (across all chunks). */
  readonly stepIndex: number;
  /** Free-parameter ids, order-aligned with q columns (sanity check on resume). */
  readonly freeIds: string[];
  readonly seed: number;
}

export interface SampleOptions {
  /** Ensemble steps to run in THIS call (a bounded chunk). */
  readonly nSteps: number;
  /** Walkers; even, ≥ 2·nFree+2 for a healthy ensemble. Default max(2·nFree+2, 12). */
  readonly nWalkers?: number;
  /** Steps (from the START of the whole run) discarded from summaries. Default
   *  half of the total steps taken so far. */
  readonly burnIn?: number;
  /** Keep every thin-th post-burn-in step in the returned chains. Default 1. */
  readonly thin?: number;
  /** RNG seed (ignored on resume — the token carries it). Default 0xbae5ea. */
  readonly seed?: number;
  /** Likelihood noise model — match it to the data's provenance: raw counts →
   *  "poisson", processed intensities with honest σ → "fixed", outliers /
   *  imperfect model → "studentT", unknown error scale (PDF unit weights) →
   *  "marginalized" (the default; see logPosterior.ts). */
  readonly noiseModel?: NoiseModel;
  /** Student-t degrees of freedom for noiseModel "studentT". Default 5. */
  readonly nu?: number;
  /** Priors by parameter id (bounded space). Default: uniform within bounds. */
  readonly priors?: Readonly<Record<string, PriorSpec>>;
  /** Stretch scale a > 1. Default 2 (the standard choice). */
  readonly a?: number;
  /** Resume token from a previous run's `resume` output. */
  readonly init?: WalkerState;
  /** Initial walker dispersion around the starting values, as a fraction of each
   *  parameter's scale (|value| or bound span), for a parameter with no
   *  linearized esd. Default 1e-2. Ignored on resume. */
  readonly initialSpread?: number;
  /** Initial dispersion, in esds, of a parameter with a linearized esd (see
   *  `linearizedEsd`). Default 1. Ignored on resume. */
  readonly initialSpreadEsd?: number;
  /** Linearized ESDs (from a prior LM fit) for the esdRatio comparison. */
  readonly linearizedEsd?: Readonly<Record<string, number>>;
  /** Progress callback per completed ensemble step. */
  readonly onStep?: (step: number, meanLogP: number) => void;
  /**
   * Stop the run early. Checked at every step boundary; an async driver also
   * abandons the batch in flight. The step that was running is discarded, so
   * the chains and the resume token end on the last COMPLETED step, and the
   * result carries `stopped` (never status "ok"). The default burn-in is then
   * half the steps actually taken, the same rule as a finished run.
   */
  readonly signal?: AbortSignal;
}

/** A run stopped through `SampleOptions.signal`, as its result records it. */
export interface SampleStopped {
  /** Total ensemble steps completed (across all chunks) when it stopped. */
  readonly atStep: number;
  /** The total the run was asked to reach. */
  readonly plannedStep: number;
  /** Draws (walkers × kept steps) a finished run would have kept. */
  readonly plannedSamples: number;
}

/**
 * Fewest kept steps per walker the diagnostics read: split-R̂ halves each
 * walker into two chains of at least 2, and the ESS needs 4 draws. A stopped
 * run with fewer has no posterior estimates to show.
 */
export const MIN_KEPT_STEPS = 4;

/** Effective samples a run needs to pass (with R̂ < POSTERIOR_RHAT). */
export function essTarget(nFree: number): number {
  return Math.max(100, 10 * nFree);
}

/** Whether a run kept too few steps for any posterior estimate (see MIN_KEPT_STEPS). */
export function tooFewToRead(result: Pick<SampleResult, "chains">): boolean {
  return (result.chains[0]?.length ?? 0) < MIN_KEPT_STEPS;
}

/** Thrown into the sampler generator to stop it at the batch it is waiting on. */
export class SamplingStopped extends Error {
  constructor() {
    super("sampling stopped");
    this.name = "SamplingStopped";
  }
}

export interface SampleResult {
  /** Post-burn-in, thinned chains in ORIGINAL bounded space, [nWalkers][kept][nFree]. */
  readonly chains: number[][][];
  /** Log-posterior aligned with chains, [nWalkers][kept]. */
  readonly logProb: number[][];
  readonly freeIds: string[];
  /** Accepted proposals / total proposals in this call. */
  readonly acceptanceFraction: number;
  readonly diagnostics: SampleDiagnostics;
  readonly posterior: PosteriorSummary;
  /** Serializable state to continue the chain in a later call. */
  readonly resume: WalkerState;
  /** "ok" when R̂/ESS pass; "not-converged" with reasons in diagnostics. A
   *  stopped run is always "not-converged": its chains are partial. */
  readonly status: "ok" | "not-converged";
  readonly message?: string;
  /** Present when `signal` stopped the run before its last step. */
  readonly stopped?: SampleStopped;
}

const DEFAULT_A = 2;
const DEFAULT_SEED = 0xbae5ea;

interface Prep {
  readonly freeParams: RefinementParameter[];
  readonly freeIds: string[];
  readonly transforms: TransformSpec[];
  readonly nUsed: number;
  readonly noiseModel: NoiseModel;
  readonly nu: number;
}

function prepare(problem: RefinementProblem, options: SampleOptions): Prep {
  const freeParams = problem.parameters.filter((p) => !p.fixed);
  if (freeParams.length === 0) throw new Error("samplePosterior: no free parameters to sample");
  return {
    freeParams,
    freeIds: freeParams.map((p) => p.id),
    transforms: planTransforms(freeParams),
    nUsed: nUsedOf(problem.weights),
    noiseModel: options.noiseModel ?? "marginalized",
    nu: options.nu ?? DEFAULT_STUDENT_NU,
  };
}

/** Full id→value record: fixed params at their held values, free from the walker. */
function valuesRecord(
  problem: RefinementProblem,
  freeIds: readonly string[],
  bounded: readonly number[],
): Record<string, number> {
  const rec: Record<string, number> = {};
  for (const p of problem.parameters) rec[p.id] = p.value;
  for (let j = 0; j < freeIds.length; j++) rec[freeIds[j]!] = bounded[j]!;
  return rec;
}

/** log-posterior in UNBOUNDED space (likelihood + prior + transform Jacobian).
 *  Curve-based so every noise model is expressible (Poisson and Student-t need
 *  the per-point residuals, not just χ²). */
function logPostOf(
  problem: RefinementProblem,
  yCalc: Float64Array,
  q: readonly number[],
  bounded: readonly number[],
  prep: Prep,
  priors: Readonly<Record<string, PriorSpec>> | undefined,
): number {
  let lp = logLikelihoodCurve(problem.observations, yCalc, problem.weights, prep.nUsed, prep.noiseModel, prep.nu);
  if (!Number.isFinite(lp)) return Number.NEGATIVE_INFINITY;
  lp += logPrior(prep.freeParams, bounded, priors);
  for (let j = 0; j < q.length; j++) lp += logJacobian(q[j]!, prep.transforms[j]!);
  return Number.isFinite(lp) ? lp : Number.NEGATIVE_INFINITY;
}

/**
 * The stretch-move core as a sans-io generator. Yields batches of value-sets
 * (bounded space, ready for `problem.calculate`); receives the calculated
 * curves; returns the finished SampleResult. Batch order: one initialization
 * batch (fresh start only), then per step two half-ensemble batches.
 */
export function* sampleCore(
  problem: RefinementProblem,
  options: SampleOptions,
): Generator<Record<string, number>[], SampleResult, Float64Array[]> {
  const prep = prepare(problem, options);
  const { freeParams, freeIds, transforms } = prep;
  const nFree = freeParams.length;
  const a = options.a ?? DEFAULT_A;
  if (!(a > 1)) throw new Error(`samplePosterior: stretch scale a must be > 1, got ${a}`);

  // --- Ensemble state: fresh start or rehydrated resume token -----------------
  let q: number[][];
  let logP: number[];
  let stepIndex: number;
  let seed: number;
  let rngDraws: number;

  if (options.init) {
    const init = options.init;
    if (init.freeIds.length !== nFree || init.freeIds.some((id, j) => id !== freeIds[j])) {
      throw new Error(
        "samplePosterior: resume token's free parameters do not match the problem " +
          `(token: [${init.freeIds.join(", ")}], problem: [${freeIds.join(", ")}])`,
      );
    }
    if (init.logP.length !== init.q.length) {
      throw new Error("samplePosterior: the resume token has no evaluated ensemble (the run stopped before its first step) — start a fresh run");
    }
    q = init.q.map((row) => [...row]);
    logP = [...init.logP];
    stepIndex = init.stepIndex;
    seed = init.seed;
    rngDraws = init.rngDraws;
  } else {
    const nWalkers = Math.max(2, options.nWalkers ?? Math.max(2 * nFree + 2, 12));
    const even = nWalkers % 2 === 0 ? nWalkers : nWalkers + 1;
    seed = (options.seed ?? DEFAULT_SEED) >>> 0;
    const rng = mulberry32From(seed, 0);
    const spread = options.initialSpread ?? 1e-2;
    const spreadEsd = options.initialSpreadEsd ?? 1;

    // Initialize walkers in a tight ball around the current parameter values
    // (bounded space), then transform. With the least-squares esds the ball is
    // spreadEsd·esd per parameter — the expected posterior width, as emcee
    // practice asks. A ball set by |value| instead puts a precise parameter
    // (a cell length, esd 1e-5 of its value) hundreds of esds out, where a
    // walker can settle in a false minimum the stretch move never leaves
    // (Cr₂WO₆: one walker of 42 held a = 4.29 Å against 4.575 Å). Without an
    // esd: spread·max(|value|, span/100, tiny), so zero-valued parameters move.
    const center = freeParams.map((p) => p.value);
    q = [];
    for (let w = 0; w < even; w++) {
      const row: number[] = new Array<number>(nFree);
      for (let j = 0; j < nFree; j++) {
        const p = freeParams[j]!;
        const span = p.min !== undefined && p.max !== undefined ? p.max - p.min : 0;
        const esd = options.linearizedEsd?.[p.id];
        const scale = esd !== undefined && Number.isFinite(esd) && esd > 0
          ? spreadEsd * esd
          : spread * Math.max(Math.abs(center[j]!), span / 100, 1e-8);
        let x = center[j]! + (rng.next() * 2 - 1) * scale;
        if (p.min !== undefined) x = Math.max(x, p.min);
        if (p.max !== undefined) x = Math.min(x, p.max);
        row[j] = toUnbounded(x, transforms[j]!);
      }
      q.push(row);
    }

    // Evaluate the whole initial ensemble as one batch.
    const boundedRows = q.map((row) => row.map((qj, j) => toBounded(qj, transforms[j]!)));
    let initCurves: Float64Array[];
    try {
      initCurves = yield boundedRows.map((b) => valuesRecord(problem, freeIds, b));
    } catch (e) {
      if (!(e instanceof SamplingStopped)) throw e;
      return stoppedBeforeStart(q, freeIds, seed, rng.count(), options);
    }
    logP = boundedRows.map((b, w) =>
      logPostOf(problem, initCurves[w]!, q[w]!, b, prep, options.priors),
    );
    stepIndex = 0;
    rngDraws = rng.count();
  }

  const nWalkers = q.length;
  const half = nWalkers >> 1;
  let rng = mulberry32From(seed, rngDraws);

  // --- Chain storage for THIS chunk ------------------------------------------
  // A stoppable run stores every step: stopped early, its burn-in is half the
  // steps it took, which reaches back before the planned one.
  const keptQ: number[][][] = Array.from({ length: nWalkers }, () => []);
  const keptLogP: number[][] = Array.from({ length: nWalkers }, () => []);
  const keptAt: number[] = [];
  const thin = Math.max(1, options.thin ?? 1);
  const totalStepsAfter = stepIndex + options.nSteps;
  const burnIn = options.burnIn ?? Math.floor(totalStepsAfter / 2);
  const isKept = (s: number, burn: number): boolean => s > burn && (s - burn) % thin === 0;
  const keepAll = options.signal !== undefined;
  const firstStep = stepIndex;
  let stopped = false;

  let accepted = 0;
  let proposed = 0;

  // --- Stretch-move steps -----------------------------------------------------
  steps: for (let step = 0; step < options.nSteps; step++) {
    if (options.signal?.aborted) {
      stopped = true;
      break;
    }
    // The step's starting state: a stop mid-step returns here, so the chains
    // and the resume token never hold half a step. Rows are replaced, never
    // mutated, so shallow copies suffice.
    const atStart = { q: q.slice(), logP: logP.slice(), draws: rng.count(), accepted, proposed };
    // Two half-ensemble updates: active half [start, start+half) proposes
    // against the complementary half, as one independent batch each.
    for (let phase = 0; phase < 2; phase++) {
      const start = phase === 0 ? 0 : half;
      const otherStart = phase === 0 ? half : 0;

      // Draw all proposal randomness FIRST (deterministic order, walker-major),
      // then evaluate the batch, then accept/reject with pre-drawn uniforms —
      // the RNG stream is independent of evaluation timing by construction.
      const zs: number[] = new Array<number>(half);
      const partners: number[] = new Array<number>(half);
      const acceptU: number[] = new Array<number>(half);
      const proposals: number[][] = new Array<number[]>(half);
      const proposalBounded: number[][] = new Array<number[]>(half);
      for (let k = 0; k < half; k++) {
        const zr = rng.next();
        // z ~ g(z) ∝ 1/√z on [1/a, a] via inverse CDF.
        const z = ((a - 1) * zr + 1) ** 2 / a;
        zs[k] = z;
        partners[k] = otherStart + Math.floor(rng.next() * half);
        acceptU[k] = rng.next();
        const wq = q[start + k]!;
        const cq = q[partners[k]!]!;
        const prop: number[] = new Array<number>(nFree);
        for (let j = 0; j < nFree; j++) prop[j] = cq[j]! + z * (wq[j]! - cq[j]!);
        proposals[k] = prop;
        proposalBounded[k] = prop.map((qj, j) => toBounded(qj, transforms[j]!));
      }

      let curves: Float64Array[];
      try {
        curves = yield proposalBounded.map((b) => valuesRecord(problem, freeIds, b));
      } catch (e) {
        if (!(e instanceof SamplingStopped)) throw e;
        q = atStart.q;
        logP = atStart.logP;
        rng = mulberry32From(seed, atStart.draws);
        accepted = atStart.accepted;
        proposed = atStart.proposed;
        stopped = true;
        break steps;
      }

      for (let k = 0; k < half; k++) {
        proposed++;
        const w = start + k;
        const lpNew = logPostOf(problem, curves[k]!, proposals[k]!, proposalBounded[k]!, prep, options.priors);
        // Stretch-move acceptance: min(1, z^(D−1)·exp(Δ logP)).
        const logAccept = (nFree - 1) * Math.log(zs[k]!) + lpNew - logP[w]!;
        if (Number.isFinite(lpNew) && Math.log(acceptU[k]!) < logAccept) {
          q[w] = proposals[k]!;
          logP[w] = lpNew;
          accepted++;
        }
      }
    }

    stepIndex++;
    if (keepAll || isKept(stepIndex, burnIn)) {
      keptAt.push(stepIndex);
      for (let w = 0; w < nWalkers; w++) {
        keptQ[w]!.push([...q[w]!]);
        keptLogP[w]!.push(logP[w]!);
      }
    }
    if (options.onStep) {
      const mean = logP.reduce((acc, v) => acc + v, 0) / nWalkers;
      options.onStep(stepIndex, mean);
    }
  }

  // --- Assemble result --------------------------------------------------------
  const finalBurn = stopped && options.burnIn === undefined ? Math.floor(stepIndex / 2) : burnIn;
  const rows = keptAt.flatMap((s, i) => (isKept(s, finalBurn) ? [i] : []));
  const chains = keptQ.map((walker) =>
    rows.map((i) => walker[i]!.map((qj, j) => toBounded(qj, transforms[j]!))),
  );
  const chainLogP = keptLogP.map((walker) => rows.map((i) => walker[i]!));
  const diagnostics = buildDiagnostics(chains, chainLogP, freeIds);
  const posterior = posteriorSummary(chains, freeIds, diagnostics, options.linearizedEsd);
  const passes = diagnostics.maxRHat < POSTERIOR_RHAT && diagnostics.minEss >= essTarget(nFree);
  const converged = passes && !stopped;
  let plannedKept = 0;
  for (let s = firstStep + 1; s <= totalStepsAfter; s++) if (isKept(s, burnIn)) plannedKept++;

  return {
    chains,
    logProb: chainLogP,
    freeIds: [...freeIds],
    acceptanceFraction: proposed > 0 ? accepted / proposed : 0,
    diagnostics,
    posterior,
    resume: {
      q: q.map((row) => [...row]),
      logP: [...logP],
      rngDraws: rng.count(),
      stepIndex,
      freeIds: [...freeIds],
      seed,
    },
    status: converged ? "ok" : "not-converged",
    message: stopped
      ? `stopped early at step ${stepIndex} of ${totalStepsAfter}: ${diagnostics.nSamples} of ${nWalkers * plannedKept} samples — the chains are partial`
      : converged
        ? `converged: R̂max ${diagnostics.maxRHat.toFixed(3)}, ESSmin ${Math.round(diagnostics.minEss)}`
        : `not converged: R̂max ${diagnostics.maxRHat.toFixed(3)}, ESSmin ${Math.round(diagnostics.minEss)} — continue via the resume token`,
    ...(stopped ? { stopped: { atStep: stepIndex, plannedStep: totalStepsAfter, plannedSamples: nWalkers * plannedKept } } : {}),
  };
}

/** A fresh run stopped while its first ensemble was being evaluated: no samples, nothing to resume. */
function stoppedBeforeStart(q: number[][], freeIds: readonly string[], seed: number, rngDraws: number, options: SampleOptions): SampleResult {
  const nWalkers = q.length;
  const chains: number[][][] = q.map(() => []);
  const diagnostics = buildDiagnostics(chains, chains.map(() => []), freeIds);
  const burnIn = options.burnIn ?? Math.floor(options.nSteps / 2);
  const thin = Math.max(1, options.thin ?? 1);
  let plannedKept = 0;
  for (let s = 1; s <= options.nSteps; s++) if (s > burnIn && (s - burnIn) % thin === 0) plannedKept++;
  return {
    chains,
    logProb: chains.map(() => []),
    freeIds: [...freeIds],
    acceptanceFraction: 0,
    diagnostics,
    posterior: posteriorSummary(chains, freeIds, diagnostics, options.linearizedEsd),
    // logP left empty: the token cannot be resumed (the resume path refuses it).
    resume: { q: q.map((row) => [...row]), logP: [], rngDraws, stepIndex: 0, freeIds: [...freeIds], seed },
    status: "not-converged",
    message: `stopped early at step 0 of ${options.nSteps}: 0 of ${nWalkers * plannedKept} samples`,
    stopped: { atStep: 0, plannedStep: options.nSteps, plannedSamples: nWalkers * plannedKept },
  };
}

/** Serial driver: every yielded batch is evaluated in-process. */
export function samplePosterior(problem: RefinementProblem, options: SampleOptions): SampleResult {
  const gen = sampleCore(problem, options);
  let step = gen.next();
  while (!step.done) {
    step = gen.next(step.value.map((values) => problem.calculate(values)));
  }
  return step.value;
}

/**
 * Pool driver: batches (half-ensembles — the entire cost) go to the evaluator;
 * order-preserving evaluation makes the chain bit-identical to `samplePosterior`
 * for any faithful evaluator (samplerParallel test), because the RNG advances
 * only inside the generator.
 */
export async function samplePosteriorParallel(
  problem: RefinementProblem,
  options: SampleOptions,
  evaluator: BatchEvaluator,
): Promise<SampleResult> {
  const gen = sampleCore(problem, options);
  const signal = options.signal;
  let step = gen.next();
  while (!step.done) {
    const sets = step.value;
    let results: Float64Array[];
    try {
      // An evaluator that splits every evaluation takes the single ones too (the driver holds no pairs).
      results = sets.length === 1 && evaluator.splitsEvaluations !== true ? [problem.calculate(sets[0]!)] : await untilAborted(evaluator.evaluate(sets), signal);
      if (signal?.aborted) throw new SamplingStopped();
    } catch (e) {
      // Stopped: the batch in flight is abandoned (its evaluator is the
      // caller's to dispose), and the generator ends on the last whole step.
      if (!signal?.aborted) throw e;
      step = gen.throw(new SamplingStopped());
      continue;
    }
    step = gen.next(results);
  }
  return step.value;
}

/** The evaluation, or a SamplingStopped rejection as soon as `signal` aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  // Abandoned on a stop: its own failure (the pool disposed under it) must not surface as unhandled.
  work.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new SamplingStopped());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
