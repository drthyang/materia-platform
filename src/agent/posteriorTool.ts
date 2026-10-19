/**
 * sample_posterior: the Bayesian check of a refinement, on the powder or the
 * PDF page. The page's ensemble MCMC (core/refinement/bayes) samples the
 * posterior of the free parameters around the refined values, and
 * core/diagnostics/posteriorReading.ts reads it.
 */

import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { SampleResult } from "@/core/refinement/bayes/sampler";
import type { LiveState, PosteriorSampler } from "@/agent/port";
import { sig } from "@/agent/liveCommon";
import { posteriorDifference, posteriorReading } from "@/core/diagnostics/posteriorReading";

/** Default and largest steps per call. */
export const POSTERIOR_STEPS = 400;
export const MAX_POSTERIOR_STEPS = 5000;

/** How the Agent runs a chain on. */
const RESUME = { again: "call sample_posterior again with continue: true", brief: "continue: true" } as const;

/** The posterior as the Agent reads it. */
export function posteriorView(result: SampleResult, parameters: readonly RefinementParameter[], esd: Readonly<Record<string, number>> | undefined, compare: readonly (readonly [string, string])[] = []): Record<string, unknown> {
  const { converged, nearly, rows, correlations, reading } = posteriorReading(result, parameters, esd, compare, RESUME, { diagnose: "diagnose_fit" });
  const differences = compare.map(([a, b]) => posteriorDifference(result, a, b));
  return {
    status: result.status,
    converged,
    ...(nearly ? { nearlyConverged: true } : {}),
    steps: result.resume.stepIndex,
    walkers: result.resume.q.length,
    samples: result.diagnostics.nSamples,
    acceptance: sig(result.acceptanceFraction, 2),
    intervals: rows,
    ...(correlations.length ? { correlations: correlations.slice(0, 8).map((x) => ({ a: x.a, b: x.b, rho: sig(x.rho, 3) })) } : {}),
    ...(differences.length ? { differences } : {}),
    reading,
    shown: "The Posterior view on the page shows each marginal with its interval.",
  };
}

/** A finished run, with what it was read against: kept by the executor for the report. */
export interface PosteriorRun {
  readonly run: SampleResult;
  /** The refinement it sampled around (the report shows the run only while that result is on screen). */
  readonly result: RefinementResult;
  readonly parameters: readonly RefinementParameter[];
  readonly compare: readonly (readonly [string, string])[];
}

/** A page's port as the sampler reads it: the powder and PDF pages have a sampler. */
interface SampledPort {
  readonly state: () => LiveState;
  readonly samplePosterior?: PosteriorSampler;
}

/** Run the page's sampler and read the result. `onRun` receives every finished run. */
export async function samplePosteriorTool(input: { continue?: boolean; steps?: number; compare?: readonly (readonly [string, string])[] }, port: SampledPort, onRun?: (run: PosteriorRun) => void): Promise<Record<string, unknown>> {
  if (!port.samplePosterior) throw new Error("this page has no posterior sampler");
  const s = port.state();
  if (s.busy) throw new Error("a refinement is running — wait for it to finish");
  if (!s.result) throw new Error("refine first: the sampler starts at the refined values, and reads its widths against the refinement's esds");
  const free = s.parameters.filter((p) => !p.fixed && !p.expression);
  if (free.length === 0) throw new Error("no parameter is free: free the ones whose uncertainty you want (set_free), refine, then sample");
  // The posterior is read against the refinement's esds: the same free set, or the ratios mean nothing.
  const refined = new Set(Object.keys(s.result.esd));
  const added = free.filter((p) => !refined.has(p.id)).map((p) => p.id);
  const dropped = [...refined].filter((id) => !free.some((p) => p.id === id));
  if (!input.continue && (added.length > 0 || dropped.length > 0)) {
    throw new Error(`refine first with this free set: the refinement on screen freed a different one (${[...(added.length ? [`now free: ${added.join(", ")}`] : []), ...(dropped.length ? [`now fixed: ${dropped.join(", ")}`] : [])].join("; ")}), and the posterior is read against its esds`);
  }
  // The pairs to compare are checked before the run: a typo must not cost a whole chain.
  const compare = input.compare ?? [];
  for (const [a, b] of compare) {
    for (const id of [a, b]) if (!free.some((p) => p.id === id)) throw new Error(`compare: ${id} is not free — only sampled parameters can be compared (free: ${free.map((p) => p.id).join(", ")})`);
  }
  const steps = Math.min(MAX_POSTERIOR_STEPS, Math.max(50, Math.round(input.steps ?? POSTERIOR_STEPS)));
  const run = await port.samplePosterior({ continue: !!input.continue, steps });
  if (typeof run === "string") throw new Error(`the posterior run did not finish: ${run}`);
  const view = posteriorView(run, s.parameters, s.result.esd, compare);
  onRun?.({ run, result: s.result, parameters: s.parameters, compare });
  return free.length > 12 ? { ...view, note: `${free.length} free parameters: each step costs ${2 * free.length + 2} pattern evaluations, and the chain mixes more slowly the more there are (expect ~10⁴ steps at 20). To ask about a few values, free them with their partners, fix the rest (the profile, the background, the cell and zero usually), refine that set, then sample it; the intervals are then conditional on what is held, which the report should say.` } : view;
}
