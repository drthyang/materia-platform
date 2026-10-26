/**
 * Staged (guided) refinement driver.
 *
 * Structure refinement diverges when every parameter is freed at once: a wrong
 * scale corrupts the position gradients, a wrong background masks the peaks, and
 * the coupled solve wanders. The expert workflow instead unlocks parameters in
 * order of how strongly and how linearly they act on the pattern —
 *   scale → background → cell → profile width → ADP → positions → occupancy —
 * refining each group to convergence before adding the next, and carrying the
 * converged values forward. Groups are *cumulative*: once freed, a parameter
 * stays free in every later stage, so the final stage is a full co-refinement
 * seeded from a good point.
 *
 * The driver is crystallography-blind. It toggles each parameter's `fixed` flag
 * per stage, rebuilds the problem through a caller-supplied factory (so the
 * closure captures the updated values), runs the base `refine`, and writes the
 * converged values back onto the parameter objects.
 */

import type { RefinementCorrelation, RefinementOptions, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { refine, type RefinementProblem } from "@/core/refinement/engine";
import { CORRELATION_REPORTED } from "@/core/diagnostics/thresholds";

/** One stage: a name and a predicate selecting the parameters it unlocks. */
export interface RefinementStage {
  readonly name: string;
  /** Parameters (by object) this stage adds to the free set. */
  readonly select: (p: RefinementParameter) => boolean;
}

/** Per-stage record of what ran and how it ended. */
export interface StageResult {
  readonly name: string;
  /** Ids of the parameters free in `result`'s run (cumulative). */
  readonly freeIds: readonly string[];
  /** The run the stage kept — or, for a rejected stage, the run that failed. */
  readonly result: RefinementResult;

  /** Present when the controller rejected this stage: its newly-freed
   *  parameters were re-fixed and every value reverted to the pre-stage
   *  state before continuing with the next stage. */
  readonly rejected?: { readonly reason: string };
  /** Newly-freed parameters the controller re-fixed at their pre-stage
   *  values; the stage was re-run without them and that run kept. */
  readonly refixed?: readonly { readonly id: string; readonly reason: string }[];
  /** Newly-freed parameters in a singular direction that stayed free because
   *  re-fixing them cost fit: degenerate only to first order, at this point. */
  readonly keptDegenerate?: readonly { readonly id: string; readonly reason: string }[];
}

export interface StagedRefinementResult {
  /** Parameter objects with their final refined values and esds. */
  readonly parameters: RefinementParameter[];
  readonly stages: StageResult[];
  /** The last accepted stage's result — the run that produced `parameters`;
   *  undefined if no stage ran. */
  readonly final?: RefinementResult;
}

/**
 * Controller guards (roadmap F1.4): parameter additions that make the model
 * WORSE are rejected rather than carried forward — at the right granularity.
 *
 * STAGE-level rejection (revert everything the stage did) only for genuine
 * divergence: the wR worsened (freeing parameters can only ever lower χ² at
 * the optimum), or freeing the new group INFLATED the esd of a previously
 * determined parameter with no newcomer to blame (the classic "adding X
 * destabilizes everything").
 *
 * PARAMETER-level refixing (keep the stage, re-fix the culprit at its
 * pre-stage value) for pathologies of individual newly-freed parameters: a
 * singular direction, a near-perfect correlation, or an earlier parameter's
 * esd inflated through its correlation with the newcomer. One weak parameter
 * must not discard its well-behaved siblings' gains. The stage is then RE-RUN
 * from its pre-stage values without the culprits, and that run is the one
 * kept: the values carried forward are always ones a fit produced.
 *
 * An inflated esd is the esd of the full covariance growing as a newcomer that
 * correlates with the parameter joins the fit: by 1/√(1 − ρ²) for one partner,
 * several-fold for the TOF zero against the cell lengths (|ρ| above 0.9 on a
 * TOF bank; stagedTofProfile.test.ts). That is the
 * pair the data cannot separate, not a diverging fit — the stage's other
 * newcomers (the TOF peak shape) improve it — so the newcomer the parameter
 * correlates with most strongly is re-fixed, the member of the pair that this
 * sequence frees later, as the user's method fixes the zero against the cell.
 * Only an inflation that no reported correlation (|ρ| ≥ CORRELATION_REPORTED)
 * ties to a newcomer still rejects the stage. While the engine's eigen-solver
 * stopped short (its esds near the conditional ones) the rule never fired on
 * such a pair; with the full inverse it rejected the whole TOF profile stage.
 *
 * A singular direction is a combination the data cannot see, so re-fixing one
 * member removes it: of k mutually degenerate newcomers, k − 1 are re-fixed
 * and one stays free. Re-fixing a member the data cannot see costs no fit; a
 * re-run that fits worse shows the degeneracy holds only to first order at
 * the current point (symmetry-equivalent sites refined independently, from
 * equal starting values) — those newcomers then stay free, in the run that
 * had them free.
 */
export interface StageGuardOptions {
  /** Master switch. Default true. */
  readonly enabled?: boolean;
  /** Max tolerated relative wR increase vs the last accepted stage — and what
   *  re-fixing a degenerate newcomer may cost before it stays free. Default 1e-3. */
  readonly maxWrIncrease?: number;
  /** A previously-free parameter whose esd grows by more than this factor
   *  after the addition re-fixes the newcomer it correlates with most strongly;
   *  with none to blame, the stage is rejected. Default 5. */
  readonly maxEsdInflation?: number;
  /** Re-fix a newly-freed parameter sitting in |ρ| ≥ this. Default 0.998. */
  readonly maxCorrelation?: number;
}

type Refix = { readonly id: string; readonly reason: string };

interface StageGuardVerdict {
  /** Reject the whole stage (revert values, re-fix its additions). */
  readonly stageReason: string | null;
  /** The fewest newcomers whose re-fixing removes the singular directions. */
  readonly singular: Refix[];
  /** Newcomers in a near-perfect correlation outside those directions. */
  readonly correlated: Refix[];
  /** For each earlier parameter whose esd inflated, the newcomer it
   *  correlates with most strongly. */
  readonly inflating: Refix[];
  /** An earlier parameter's esd inflated and no newcomer correlates with it:
   *  rejects the stage once the rules above have nothing left to re-fix. */
  readonly unattributedInflation: string | null;
}

/** A verdict that re-fixes nothing: the stage stands, or (with a reason) is rejected. */
const wholeStage = (stageReason: string | null): StageGuardVerdict => ({ stageReason, singular: [], correlated: [], inflating: [], unattributedInflation: null });

/** Component (of a unit null direction) below which a parameter does not
 *  take part in it. */
const PARTICIPATION = 1e-2;

/** A wR this small is an exact fit to noise-free data, whose differences are
 *  round-off (the engine's exact-fit threshold). */
const EXACT_FIT_RWP = 1e-6;

const pct = (wr: number | undefined): string => (wr === undefined ? "?" : `${(100 * wr).toFixed(3)}%`);

function stageGuardVerdict(
  prev: { wr: number | undefined; esd: ReadonlyMap<string, number> },
  result: RefinementResult,
  previouslyFree: readonly string[],
  newcomers: readonly string[],
  keptFree: ReadonlySet<string>,
  guards: StageGuardOptions,
): StageGuardVerdict {
  if (guards.enabled === false) return wholeStage(null);

  const wr = result.agreement.rWeighted;
  const maxInc = guards.maxWrIncrease ?? 1e-3;
  if (prev.wr !== undefined && wr !== undefined && wr > prev.wr * (1 + maxInc) + 1e-12) {
    return wholeStage(`wR worsened: ${pct(prev.wr)} → ${pct(wr)}`);
  }

  const candidates = newcomers.filter((id) => !keptFree.has(id));
  const nullDirections = result.diagnostics?.nullDirections ?? [];
  const singular = degenerateNewcomers(nullDirections, candidates, [...keptFree]);

  // A parameter in a dropped direction has its covariance confined to the
  // kept subspace, so its correlations are truncation artifacts (a degenerate
  // set reads |ρ| = 1 throughout) — the singular rule owns those.
  const inNull = new Set(nullDirections.flatMap((d) => Object.keys(d).filter((id) => Math.abs(d[id]!) >= PARTICIPATION)));
  const fresh = new Set(candidates);
  const correlated: Refix[] = [];
  const maxCorr = guards.maxCorrelation ?? 0.998;
  for (const c of result.diagnostics?.highCorrelations ?? []) {
    if (Math.abs(c.coefficient) < maxCorr || inNull.has(c.parameterIdA) || inNull.has(c.parameterIdB)) continue;
    // Re-fix the NEW member of the pair (the older one was fine before).
    const target = fresh.has(c.parameterIdA) ? c.parameterIdA : fresh.has(c.parameterIdB) ? c.parameterIdB : null;
    if (target && !correlated.some((r) => r.id === target)) {
      correlated.push({ id: target, reason: `|ρ|=${Math.abs(c.coefficient).toFixed(4)} with ${target === c.parameterIdA ? c.parameterIdB : c.parameterIdA}` });
    }
  }

  // An earlier parameter's esd inflated: blame the newcomer it correlates with
  // most strongly (see the guards' note above), or, with none, the stage.
  const pairs = [...(result.diagnostics?.highCorrelations ?? []), ...(result.diagnostics?.moderateCorrelations ?? [])];
  const maxInfl = guards.maxEsdInflation ?? 5;
  const inflating: Refix[] = [];
  let unattributedInflation: string | null = null;
  for (const id of previouslyFree) {
    const before = prev.esd.get(id);
    const after = result.esd[id];
    if (!(before !== undefined && before > 0 && after !== undefined && after > maxInfl * before && after > 1e-8)) continue;
    const factor = `${(after / before).toFixed(1)}×`;
    const partner = inNull.has(id) ? null : strongestNewcomer(id, pairs, fresh, inNull);
    if (partner === null) {
      unattributedInflation ??= `freeing ${newcomers.join(", ")} inflated esd(${id}) ${factor}`;
    } else if (!inflating.some((r) => r.id === partner.id)) {
      inflating.push({ id: partner.id, reason: `inflated esd(${id}) ${factor}, |ρ|=${Math.abs(partner.coefficient).toFixed(3)} with ${id}` });
    }
  }
  return { stageReason: null, singular, correlated, inflating, unattributedInflation };
}

/**
 * The newcomer `id` correlates with most strongly among the reported pairs
 * (|ρ| ≥ CORRELATION_REPORTED; the engine lists them by |ρ|), outside the
 * dropped directions, whose correlations are truncation artifacts. Fixing a
 * newcomer j alone leaves var(id) × (1 − ρ²): the strongest partner removes
 * the most of the inflation.
 */
function strongestNewcomer(
  id: string,
  pairs: readonly RefinementCorrelation[],
  fresh: ReadonlySet<string>,
  inNull: ReadonlySet<string>,
): { id: string; coefficient: number } | null {
  let best: { id: string; coefficient: number } | null = null;
  for (const c of pairs) {
    if (Math.abs(c.coefficient) < CORRELATION_REPORTED) continue;
    const other = c.parameterIdA === id ? c.parameterIdB : c.parameterIdB === id ? c.parameterIdA : null;
    if (other === null || !fresh.has(other) || inNull.has(other)) continue;
    if (best === null || Math.abs(c.coefficient) > Math.abs(best.coefficient)) best = { id: other, coefficient: c.coefficient };
  }
  return best;
}

/**
 * The fewest newcomers whose re-fixing removes every dropped direction they
 * take part in. Fixing a parameter removes the directions along its row of the
 * null basis, so the newcomers to re-fix are those whose rows are linearly
 * independent — taken latest-declared first (Gram–Schmidt), so the earliest
 * member of a degenerate set is the one that stays free, and a newcomer that
 * only duplicates an old parameter is re-fixed while the old one stays free.
 * Directions among old parameters alone (a pre-existing degeneracy, or an old
 * parameter pinned on its bound) implicate no newcomer, nor do directions
 * already `settled` — those of newcomers kept free because re-fixing them
 * cost fit.
 */
function degenerateNewcomers(
  nullDirections: readonly Readonly<Record<string, number>>[],
  candidates: readonly string[],
  settled: readonly string[],
): Refix[] {
  if (nullDirections.length === 0) return [];
  const row = (id: string): number[] => nullDirections.map((d) => d[id] ?? 0);
  const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, x, i) => s + x * b[i]!, 0);

  const basis: number[][] = [];
  // Orthogonalize a row against the basis; extend the basis when it is new.
  const addsDirection = (id: string): boolean => {
    const r = row(id);
    for (const q of basis) {
      const t = dot(q, r);
      for (let m = 0; m < r.length; m++) r[m]! -= t * q[m]!;
    }
    const norm = Math.sqrt(dot(r, r));
    if (norm < PARTICIPATION) return false;
    basis.push(r.map((x) => x / norm));
    return true;
  };
  for (const id of settled) addsDirection(id);
  const picked = new Set<string>();
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (addsDirection(candidates[i]!)) picked.add(candidates[i]!);
  }

  // Partners: the parameters a re-fixed one is confounded with, read off the
  // projector onto the null space (basis-independent).
  const involved = [...new Set(nullDirections.flatMap((d) => Object.keys(d)))];
  return candidates.filter((id) => picked.has(id)).map((id) => {
    const r = row(id);
    const partners = involved.filter((j) => j !== id && Math.abs(dot(r, row(j))) >= PARTICIPATION);
    const shown = partners.length > 4 ? `${partners.slice(0, 4).join(", ")} and ${partners.length - 4} more` : partners.join(", ");
    return { id, reason: partners.length > 0 ? `degenerate with ${shown}` : "no leverage on the data" };
  });
}

/** Whether a re-run without some newcomers fits worse than the run with them,
 *  beyond the stage tolerance — the data does use them. */
function refixCostsFit(rerun: RefinementResult, withThem: RefinementResult, guards: StageGuardOptions): boolean {
  const a = rerun.agreement.rWeighted;
  const b = withThem.agreement.rWeighted;
  return a !== undefined && b !== undefined && a > b * (1 + (guards.maxWrIncrease ?? 1e-3)) + EXACT_FIT_RWP;
}

/**
 * The staged sequence as a sans-io generator: it yields each problem to refine
 * and receives the result, so the serial and the injectable-refiner drivers
 * run the SAME loop (as the engine's `refineCore` does for its two drivers).
 */
function* stagedCore(
  parameters: readonly RefinementParameter[],
  buildProblem: (params: readonly RefinementParameter[]) => RefinementProblem,
  stages: readonly RefinementStage[],
  guards: StageGuardOptions,
): Generator<RefinementProblem, StagedRefinementResult, RefinementResult> {
  // Work on copies; remember which were caller-fixed so a stage cannot free one
  // the caller deliberately held (a stage widens the free set, never overrides).
  const work: RefinementParameter[] = parameters.map((p) => ({ ...p }));
  const lockedByCaller = new Set(parameters.filter((p) => p.fixed).map((p) => p.id));
  const freed = new Set<string>();
  const stageResults: StageResult[] = [];
  let final: RefinementResult | undefined;

  let lastAcceptedWr: number | undefined;
  let lastAcceptedEsd: ReadonlyMap<string, number> = new Map();
  for (const stage of stages) {
    const newlyFreed: string[] = [];
    for (const p of work) {
      if (!lockedByCaller.has(p.id) && stage.select(p) && !freed.has(p.id)) {
        freed.add(p.id);
        newlyFreed.push(p.id);
      }
    }
    // No point running a stage that unlocks nothing new.
    const freeIds = work.filter((p) => freed.has(p.id)).map((p) => p.id);
    if (freeIds.length === 0) {
      stageResults.push({ name: stage.name, freeIds: [], result: emptyStage() });
      continue;
    }

    const before = new Map(work.map((p) => [p.id, p.value]));
    const previouslyFree = freeIds.filter((id) => !newlyFreed.includes(id));
    // Every run of the stage starts from the pre-stage values, so a re-run
    // without some newcomers is the stage as if they had never been freed.
    const restart = (): RefinementProblem => {
      for (const p of work) {
        p.value = before.get(p.id)!;
        p.fixed = !freed.has(p.id);
      }
      return buildProblem(work);
    };

    // `result` is always the run of the current `freed` set.
    let result = yield restart();
    let rejected: string | null = null;
    const refixed: Refix[] = [];
    const kept: Refix[] = [];
    for (;;) {
      const newcomers = newlyFreed.filter((id) => freed.has(id));
      const verdict = stageGuardVerdict(
        { wr: lastAcceptedWr, esd: lastAcceptedEsd }, result, previouslyFree, newcomers,
        new Set(kept.map((k) => k.id)), guards,
      );
      if (verdict.stageReason !== null) {
        rejected = verdict.stageReason;
        break;
      }
      if (verdict.singular.length > 0) {
        for (const r of verdict.singular) freed.delete(r.id);
        const rerun = yield restart();
        if (refixCostsFit(rerun, result, guards)) {
          for (const r of verdict.singular) {
            freed.add(r.id);
            kept.push({ id: r.id, reason: `${r.reason}; re-fixing raised wR ${pct(result.agreement.rWeighted)} → ${pct(rerun.agreement.rWeighted)}` });
          }
          continue;
        }
        refixed.push(...verdict.singular);
        result = rerun;
        continue;
      }
      if (verdict.correlated.length > 0) {
        for (const r of verdict.correlated) freed.delete(r.id);
        refixed.push(...verdict.correlated);
        result = yield restart();
        continue;
      }
      // After the rules above, which may already remove the cause.
      if (verdict.inflating.length > 0) {
        for (const r of verdict.inflating) freed.delete(r.id);
        refixed.push(...verdict.inflating);
        result = yield restart();
        continue;
      }
      if (verdict.unattributedInflation !== null) {
        rejected = verdict.unattributedInflation;
        break;
      }
      break;
    }

    const runFree = work.filter((p) => freed.has(p.id)).map((p) => p.id);
    if (rejected !== null) {
      // Revert: this stage's additions come back out; values roll back.
      for (const id of newlyFreed) freed.delete(id);
      for (const p of work) {
        p.value = before.get(p.id)!;
        p.fixed = !freed.has(p.id);
      }
      stageResults.push({ name: stage.name, freeIds: runFree, result, rejected: { reason: rejected } });
      continue;
    }
    for (const p of work) {
      p.fixed = !freed.has(p.id);
      const v = result.parameters[p.id];
      if (v !== undefined) p.value = v;
      const e = result.esd[p.id];
      if (e !== undefined) p.esd = e;
    }
    stageResults.push({
      name: stage.name,
      freeIds: runFree,
      result,
      ...(refixed.length ? { refixed } : {}),
      ...(kept.length ? { keptDegenerate: kept } : {}),
    });
    final = result;
    lastAcceptedWr = result.agreement.rWeighted ?? lastAcceptedWr;
    lastAcceptedEsd = new Map(runFree.map((id) => [id, result.esd[id] ?? 0]));
  }

  return { parameters: work, stages: stageResults, ...(final !== undefined ? { final } : {}) };
}

/**
 * Run a cumulative staged refinement. `parameters` is the full working set;
 * `buildProblem` rebuilds the `RefinementProblem` from a parameter list (its
 * `calculate` closure must read the passed parameters' current values). Stages
 * unlock parameters in order. Parameters that no stage selects, and those the
 * caller pre-marked `fixed`, stay fixed throughout.
 *
 * Returns copies of the parameters (the input array is not mutated).
 */
export function refineStaged(
  parameters: readonly RefinementParameter[],
  buildProblem: (params: readonly RefinementParameter[]) => RefinementProblem,
  stages: readonly RefinementStage[],
  options: Partial<RefinementOptions> = {},
  guards: StageGuardOptions = {},
): StagedRefinementResult {
  const gen = stagedCore(parameters, buildProblem, stages, guards);
  let step = gen.next();
  while (!step.done) step = gen.next(refine(step.value, options));
  return step.value;
}

function emptyStage(): RefinementResult {
  return {
    status: "converged",
    parameters: {},
    esd: {},
    agreement: { rFactor: 0 },
    history: [],
    message: "Stage unlocked no new parameters.",
  };
}


/** A refinement runner: the serial `refine` or a parallel/pooled variant. */
export type StagedRefiner = (
  problem: RefinementProblem,
  options: Partial<RefinementOptions>,
) => RefinementResult | Promise<RefinementResult>;

/**
 * `refineStaged` with an injectable (possibly async) refiner, so the staged
 * sequence can run each stage through the parallel evaluator pool. Both drive
 * the same `stagedCore` loop — `staged.test.ts` pins the two to identical
 * results when given the serial refiner.
 */
export async function refineStagedAsync(
  parameters: readonly RefinementParameter[],
  buildProblem: (params: readonly RefinementParameter[]) => RefinementProblem,
  stages: readonly RefinementStage[],
  options: Partial<RefinementOptions> = {},
  refiner: StagedRefiner = refine,
  guards: StageGuardOptions = {},
): Promise<StagedRefinementResult> {
  const gen = stagedCore(parameters, buildProblem, stages, guards);
  let step = gen.next();
  while (!step.done) step = gen.next(await refiner(step.value, options));
  return step.value;
}
