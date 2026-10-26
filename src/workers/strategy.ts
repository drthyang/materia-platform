/**
 * The fitting strategies both runtimes run, written once over a solver: the
 * browser's compute client solves on its worker pool, the MCP server on its
 * worker threads, and either one in this thread when it has none. A strategy
 * owns what it does between solves — the seeding, the kicks, the best start;
 * a runtime owns its pool, its lifecycle and its cancel, and hands the
 * strategy a `Solver` over it. (Before, each strategy was written once per
 * runtime, and the copies drifted: the MCP boxcar took no extra phases, kicked
 * its restarts without the esds and differentiated another way than the
 * app's in-thread one; the MCP moment search fitted the whole pattern on
 * Chebyshev whatever it was given.)
 *
 * The strategies work on the evaluator spec (protocol.ts), the serializable
 * problem every runtime builds the same way (buildProblemForSpec); core does
 * not know it, so they live here, beside it. Nothing here touches a Worker.
 */

import type { EvaluatorSpec } from "@/workers/protocol";
import { buildProblemForSpec } from "@/workers/runPowder";
import type { RefinementOptions, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { refine, refineParallel, type BatchEvaluator, type ParallelDriverCapabilities } from "@/core/refinement/engine";
import { refineMultiStart, type MultiStartOptions, type MultiStartResult } from "@/core/refinement/multiStart";
import { isMomentParameterKind } from "@/core/refinement/types";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { canonicalizeMomentValues, momentDegeneracies, type MomentDegeneracy } from "@/core/magnetic/canonicalize";
import { refineSequentialAsync, type SequentialDataset, type SequentialOptions, type SequentialResult } from "@/core/refinement/sequential";
import type { BoxcarWindow } from "@/core/workflow/pdfBoxcar";

/** Evaluators that hold replicas of the problem (a worker pool): a batch evaluator, rebuilt from a spec. */
export interface EvaluatorReplicas extends BatchEvaluator {
  init(spec: EvaluatorSpec): Promise<void>;
}

/** What a strategy solves with: a problem set once, then one start of it refined at a time. */
export interface Solver {
  /** The problem every later solve refines (the replicas are rebuilt from it). */
  init(spec: EvaluatorSpec): Promise<void>;
  /** One start of that problem, refined. */
  solve(parameters: readonly RefinementParameter[], options: Partial<RefinementOptions>): Promise<RefinementResult>;
}

/**
 * The Jacobian of the strategies here, one rule for every runtime: a PDF problem's analytic columns
 * are computed on the driver — its analytic layer is one fused pass (one
 * pair-loop traversal yields G(r) and every supported ∂G/∂p), about one extra
 * `calculate` per iteration, and spares the evaluators two evaluations per
 * column. Every other problem keeps its columns on the evaluators: the powder
 * template synthesizes a whole pattern per column, the work a pool exists for
 * (and in the browser the driver is the UI thread). A pool that splits every
 * evaluation (the browser's, on a single-phase PDF problem) takes the analytic
 * pass and the single evaluations itself (`BatchEvaluator.splitsEvaluations`);
 * the columns are the same.
 */
export function analyticDriverPolicy(
  spec: EvaluatorSpec,
  options: Partial<RefinementOptions>,
): { opts: Partial<RefinementOptions>; driver: ParallelDriverCapabilities } {
  if (spec.kind !== "pdf") return { opts: options, driver: {} };
  return { opts: { analyticDerivatives: true, ...options }, driver: { analyticOnDriver: true } };
}

/** A solver over a pool of evaluators, or in this thread when there is none. */
export function poolSolver(pool: EvaluatorReplicas | null): Solver {
  let spec: EvaluatorSpec | null = null;
  return {
    async init(next) {
      spec = next;
      await pool?.init(next);
    },
    solve(parameters, options) {
      if (!spec) throw new Error("solver used before init");
      const problem = buildProblemForSpec({ ...spec, parameters: [...parameters] });
      const policy = analyticDriverPolicy(spec, options);
      return pool ? refineParallel(problem, policy.opts, pool, policy.driver) : Promise.resolve(refine(problem, policy.opts));
    },
  };
}

/** A result's converged values and esds on a copy of the start (what a multi-start kicks the next start from). */
export function applyResultToParams(start: readonly RefinementParameter[], result: RefinementResult): RefinementParameter[] {
  return start.map((p) => {
    const e = result.esd[p.id];
    return { ...p, value: result.parameters[p.id] ?? p.value, ...(e !== undefined ? { esd: e } : {}) };
  });
}

export interface BoxcarScanOptions {
  readonly refineOptions?: Partial<RefinementOptions>;
  readonly seedFromPrevious?: boolean;
  readonly rejectDiverged?: boolean;
  /** Perturbed random restarts per box beyond the seeded start (0: the seed only). */
  readonly restarts?: number;
  readonly onStep?: SequentialOptions["onStep"];
}

/**
 * Boxcar (sliding-window) refinement of one PDF problem: the sequential
 * controller over the same pattern, one box per window, each seeded from the
 * last (core/workflow/pdfBoxcar.ts plans the windows). The fit range is part
 * of the problem, not of the values, so the solver is set again for every box.
 *
 * `restarts` searches each box from randomly perturbed starts as well, the
 * seeded start kept as the baseline candidate — a box can only improve — and
 * the lowest χ² seeds the next box: seeding every box from the last makes the
 * series path-dependent, so a track could inherit one box's local minimum.
 * Each box draws from its own seed; one shared seed would kick every box the
 * same way and imprint an r-dependence of its own.
 *
 * A solve that throws (a cancelled pool) ends the scan after the boxes already
 * reported through `onStep`.
 */
export async function boxcarScan(
  spec: Extract<EvaluatorSpec, { kind: "pdf" | "mpdf" }>,
  windows: readonly BoxcarWindow[],
  solver: Solver,
  options: BoxcarScanOptions = {},
): Promise<SequentialResult> {
  const restarts = Math.max(0, Math.floor(options.restarts ?? 0));
  const boxSpec = (w: BoxcarWindow): EvaluatorSpec => ({ ...spec, fitRange: { min: w.min, max: w.max } });
  const datasets: SequentialDataset[] = windows.map((w, i) => ({
    id: `box_${i}`,
    label: `${w.center.toFixed(2)} Å`,
    buildProblem: (params) => buildProblemForSpec({ ...boxSpec(w), parameters: [...params] }),
  }));
  const sequential: SequentialOptions = {
    refineOptions: options.refineOptions ?? {},
    ...(options.seedFromPrevious !== undefined ? { seedFromPrevious: options.seedFromPrevious } : {}),
    ...(options.rejectDiverged !== undefined ? { rejectDiverged: options.rejectDiverged } : {}),
    ...(options.onStep ? { onStep: options.onStep } : {}),
  };
  return refineSequentialAsync(spec.parameters, datasets, sequential, async (problem, refineOptions, _dataset, index) => {
    const w = windows[index]!;
    await solver.init(boxSpec(w));
    // `problem.parameters` is the box's seeded set: the restarts' baseline is exactly the seed-only fit.
    if (restarts === 0) return solver.solve(problem.parameters, refineOptions);
    const ms = await refineMultiStart(
      problem.parameters,
      async (start) => {
        const result = await solver.solve(start, refineOptions);
        return { parameters: applyResultToParams(start, result), final: result };
      },
      { restarts, seed: 0xb0 + Math.round(w.center * 1000) },
    );
    return ms.final;
  });
}

/** The problems that carry a magnetic model: powder, the magnetic PDF, a single crystal. */
export type MagneticSpec = Extract<EvaluatorSpec, { kind: "magneticPowder" | "mpdf" | "magneticSingleCrystal" }>;

/** A moment search's outcome: the multi-start report, and the moment directions the data leave undetermined. */
export interface MomentSearchResult extends MultiStartResult {
  readonly degeneracies: MomentDegeneracy[];
}

/**
 * The moment search (a magnetic Prefit or Escape minimum). The magnetic
 * intensity is quadratic in the moments, so a moment partition has several
 * local minima and m = 0 is a stationary point an unkicked fit never leaves:
 *
 * 1. the moments alone are restarted from kicked starts on the frozen nuclear
 *    scaffold (µB-scale kicks by default: `escapeSigma` 6, `relFraction` 1;
 *    the caller's options win);
 * 2. the best start's moments seed one joint fit over the caller's free set;
 * 3. the global ±m sign is canonicalized, and the data-limited directions are
 *    read off that fit.
 *
 * With no free moment there is nothing to search (a model shown without its
 * rows): the joint fit runs alone and reports no restarts. The solver is set
 * once: the replicas evaluate the whole values record, so the frozen search
 * and the joint fit share them. `jointOptions` lets a runtime watch the joint
 * fit (its progress).
 */
export async function momentMultiStart(
  spec: MagneticSpec,
  solver: Solver,
  multiStart: MultiStartOptions,
  options: Partial<RefinementOptions>,
  jointOptions: Partial<RefinementOptions> = options,
): Promise<MomentSearchResult> {
  const params = spec.parameters;
  const isMoment = (p: RefinementParameter): boolean => isMomentParameterKind(p.kind);
  const frozen = params.map((p) => (!isMoment(p) && !p.fixed && !p.expression ? { ...p, fixed: true } : { ...p }));
  await solver.init({ ...spec, parameters: frozen });
  const searchable = params.some((p) => isMoment(p) && !p.fixed && !p.expression);
  const ms = searchable
    ? await refineMultiStart(
        frozen,
        async (start) => {
          const result = await solver.solve(start, options);
          return { parameters: applyResultToParams(start, result), final: result };
        },
        { escapeSigma: 6, relFraction: 1, ...multiStart, shouldPerturb: isMoment },
      )
    : { parameters: frozen, restartsRun: 0, bestStartIndex: 0, improved: false, costByStart: [] };
  const best = new Map(ms.parameters.map((p) => [p.id, p.value]));
  const jointStart = params.map((p) => (isMoment(p) && best.has(p.id) ? { ...p, value: best.get(p.id)! } : { ...p }));
  const joint = await solver.solve(jointStart, jointOptions);
  const refined = applyMagneticMoments(spec.magnetic, spec.bindings, joint.parameters);
  const final: RefinementResult = { ...joint, parameters: canonicalizeMomentValues(joint.parameters, refined, spec.structure.cell, params) };
  return {
    final,
    parameters: applyResultToParams(jointStart, final),
    restartsRun: ms.restartsRun,
    bestStartIndex: ms.bestStartIndex,
    improved: ms.improved,
    costByStart: ms.costByStart,
    degeneracies: momentDegeneracies(joint.diagnostics, params),
  };
}
