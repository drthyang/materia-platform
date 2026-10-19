/**
 * The fitting strategies both runtimes run, written once over a solver: the
 * browser's compute client solves on its worker pool, the MCP server on its
 * worker threads, and either one in this thread when it has none. A strategy
 * owns what it does between solves — the seeding, the kicks, the best start;
 * a runtime owns its pool, its lifecycle and its cancel, and hands the
 * strategy a `Solver` over it. (Before, each strategy was written once per
 * runtime, and the copies drifted: the MCP boxcar took no extra phases, kicked
 * its restarts without the esds and differentiated another way than the
 * app's in-thread one.)
 *
 * The strategies work on the evaluator spec (protocol.ts), the serializable
 * problem every runtime builds the same way (buildProblemForSpec); core does
 * not know it, so they live here, beside it. Nothing here touches a Worker.
 */

import type { EvaluatorSpec } from "@/workers/protocol";
import { buildProblemForSpec } from "@/workers/runPowder";
import type { RefinementOptions, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { refine, refineParallel, type BatchEvaluator, type ParallelDriverCapabilities } from "@/core/refinement/engine";
import { refineMultiStart } from "@/core/refinement/multiStart";
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
 * The Jacobian, one rule for every runtime: a PDF problem's analytic columns
 * are computed on the driver — its analytic layer is one fused pass (one
 * pair-loop traversal yields G(r) and every supported ∂G/∂p), about one extra
 * `calculate` per iteration, and spares the evaluators two evaluations per
 * column. Every other problem keeps its columns on the evaluators: the powder
 * template synthesizes a whole pattern per column, the work a pool exists for
 * (and in the browser the driver is the UI thread).
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
