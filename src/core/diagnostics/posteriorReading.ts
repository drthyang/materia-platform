/**
 * The reading of a posterior run (core/refinement/bayes), the way the
 * reporting literature asks (McCluskey et al., J. Appl. Cryst. 56, 2023):
 * credible intervals with the convergence evidence, the posterior width
 * against the least-squares esd, intervals that end on a bound, and the
 * correlations the data leave. The app's sample_posterior and the Agent's
 * report read a run through it, and so does MCP's sample_posterior.
 *
 * What it can and cannot say is in the reading: the posterior is the honest
 * uncertainty WITHIN the model and the declared noise model. It does not make
 * a weakly determined parameter better determined, cannot tell a wrong model
 * from a right one, and, like the esds, assumes independent residuals, so a
 * systematic misfit leaves it too narrow as well.
 */

import type { RefinementParameter } from "@/core/refinement/types";
import type { SampleResult } from "@/core/refinement/bayes/sampler";
import { sig } from "@/core/math/precision";
import { POSTERIOR_CORRELATION, POSTERIOR_NEARLY_RHAT, POSTERIOR_RHAT, POSTERIOR_WIDER } from "@/core/diagnostics/thresholds";

/** What a reading needs of a run (MCP's carries its own resume state). */
export type PosteriorRunRead = Pick<SampleResult, "status" | "diagnostics" | "posterior" | "freeIds" | "chains">;

/** Below this R̂ (with the ESS reached) an unconverged ensemble run is read with a caveat. */
const NEARLY_RHAT = POSTERIOR_NEARLY_RHAT;
/** Posterior width over the esd beyond which the esd understates the uncertainty. */
const WIDER = POSTERIOR_WIDER;
/** A 95 % interval ending within this fraction of its own width of a bound is one-sided. */
const AT_BOUND = 0.05;
/** Posterior correlations worth naming. */
const STRONG = POSTERIOR_CORRELATION;

export interface ParameterReading {
  readonly id: string;
  readonly label: string;
  readonly refined: number;
  readonly esd?: number;
  readonly median: number;
  readonly ci68: readonly [number, number];
  readonly ci95: readonly [number, number];
  readonly esdRatio?: number;
  readonly rHat: number;
  readonly ess: number;
  /** The 95 % interval ends on a bound: only a limit is determined. */
  readonly bound?: "lower" | "upper";
  /** The 68 % interval's halves differ by more than half its width. */
  readonly skewed?: boolean;
  readonly verdict: string;
}

/** Quantile q of sorted values (linear interpolation). */
function quantile(sorted: readonly number[], q: number): number {
  const i = q * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/**
 * The posterior of a − b from the chains: is the difference of two values (two
 * B's, two occupancies, two moments) determined, and with what probability is
 * a the larger?
 */
export function posteriorDifference(result: PosteriorRunRead, a: string, b: string): { a: string; b: string; median: number; ci68: [number, number]; ci95: [number, number]; probabilityAGreater: number } {
  const ia = result.freeIds.indexOf(a);
  const ib = result.freeIds.indexOf(b);
  if (ia < 0 || ib < 0) throw new Error(`compare: ${ia < 0 ? a : b} is not a sampled (free) parameter — sampled: ${result.freeIds.join(", ")}`);
  const diffs: number[] = [];
  for (const walker of result.chains) for (const draw of walker) diffs.push(draw[ia]! - draw[ib]!);
  if (diffs.length === 0) throw new Error("compare: the run kept no draws");
  diffs.sort((x, y) => x - y);
  const positive = diffs.filter((d) => d > 0).length / diffs.length;
  return {
    a, b,
    median: sig(quantile(diffs, 0.5), 4),
    ci68: [sig(quantile(diffs, 0.16), 4), sig(quantile(diffs, 0.84), 4)],
    ci95: [sig(quantile(diffs, 0.025), 4), sig(quantile(diffs, 0.975), 4)],
    probabilityAGreater: sig(positive, 3),
  };
}

/**
 * A run read parameter by parameter: converged (the sampler's own test), close
 * to it, and each parameter's interval, width against its esd, bound and
 * verdict. posteriorReading and the Agent's report both read a run through this.
 */
export function readPosterior(result: PosteriorRunRead, parameters: readonly RefinementParameter[], esd: Readonly<Record<string, number>> | undefined): { converged: boolean; nearly: boolean; essWanted: number; rows: ParameterReading[] } {
  const byId = new Map(parameters.map((p) => [p.id, p]));
  // The sampler's own test: R̂ < 1.05 and ESS ≥ max(100, 10 per free parameter).
  // Split-R̂ over ensemble walkers (not independent chains) is conservative and
  // levels off near 1.05 on long runs: with the ESS there and R̂ < 1.1 the run
  // can say whether a value is determined, but its intervals are not reported
  // (the knowledge base's rule, after McCluskey et al. 2023).
  const converged = result.status === "ok";
  const essWanted = Math.max(100, 10 * result.freeIds.length);
  const nearly = !converged && result.diagnostics.maxRHat < NEARLY_RHAT && result.diagnostics.minEss >= essWanted;
  const rows: ParameterReading[] = result.posterior.parameters.map((q) => {
    const p = byId.get(q.id);
    const e = esd?.[q.id];
    // Against the posterior's own width: a posterior piled on a bound has its
    // 2.5 % quantile a small part of its 95 % width from it (a half-normal's is
    // 1.4 %). The bound range is no scale: B in [0, 20] would call 0.082 "at 0".
    const width = Math.max(Math.abs(q.q975 - q.q025), 1e-12);
    const bound = p?.min !== undefined && q.q025 - p.min <= AT_BOUND * width ? "lower" as const
      : p?.max !== undefined && p.max - q.q975 <= AT_BOUND * width ? "upper" as const : undefined;
    const lo = q.median - q.q16;
    const hi = q.q84 - q.median;
    const skewed = Math.abs(hi - lo) > 0.5 * (hi + lo);
    const ratio = q.esdRatio;
    const verdict = bound === "lower"
      ? `rests on its lower bound (${p!.min}): only an upper limit is determined, < ${sig(q.q975, 3)} at 95 %`
      : bound === "upper"
        ? `rests on its upper bound (${p!.max}): only a lower limit is determined, > ${sig(q.q025, 3)} at 95 %`
        : ratio === undefined
          ? "no least-squares esd to compare with"
          : ratio > WIDER
            ? `the posterior is ${sig(ratio, 2)}× wider than the esd: quote the credible interval, not the esd`
            : ratio < 1 / WIDER
              ? `the posterior is narrower than the esd (${sig(ratio, 2)}×): suspect the run (chains not mixed, or a prior too tight) before trusting either`
              : "the posterior confirms the esd";
    return {
      id: q.id,
      label: p?.label ?? q.id,
      refined: sig(p?.value ?? q.median, 6),
      ...(e !== undefined ? { esd: sig(e, 2) } : {}),
      median: sig(q.median, 6),
      ci68: [sig(q.q16, 5), sig(q.q84, 5)] as const,
      ci95: [sig(q.q025, 5), sig(q.q975, 5)] as const,
      ...(ratio !== undefined ? { esdRatio: sig(ratio, 3) } : {}),
      rHat: sig(q.rHat, 4),
      ess: Math.round(q.ess),
      ...(bound ? { bound } : {}),
      ...(skewed ? { skewed: true } : {}),
      verdict: !converged && !nearly
        ? "not converged: do not read yet"
        : skewed && !bound ? `${verdict}; the distribution is asymmetric (68 %: −${sig(lo, 2)} / +${sig(hi, 2)})` : verdict,
    };
  });
  return { converged, nearly, essWanted, rows };
}

/** Each compared pair's difference as a sentence: its intervals and whether the data tell the two apart. */
export function differenceSentences(result: PosteriorRunRead, parameters: readonly RefinementParameter[], compare: readonly (readonly [string, string])[]): string[] {
  const byId = new Map(parameters.map((p) => [p.id, p]));
  return compare.map(([a, b]) => {
    const d = posteriorDifference(result, a, b);
    const la = byId.get(d.a)?.label ?? d.a;
    const lb = byId.get(d.b)?.label ?? d.b;
    const p = d.probabilityAGreater;
    const decisive = p >= 0.975 || p <= 0.025;
    return `${la} − ${lb} = ${d.median} (68 % ${d.ci68[0]} to ${d.ci68[1]}; 95 % ${d.ci95[0]} to ${d.ci95[1]}); P(${la} > ${lb}) = ${p}: ${decisive ? "the data distinguish them" : "the data do not distinguish them at 95 %"}.`;
  });
}

/** How the caller runs the chain on, in its own surface's terms. */
export interface PosteriorResume {
  /** The sentence's instruction: "call sample_posterior again with continue: true". */
  readonly again: string;
  /** The same, briefly, in parentheses: "continue: true". */
  readonly brief: string;
}

export interface PosteriorReading {
  readonly converged: boolean;
  readonly nearly: boolean;
  readonly essWanted: number;
  readonly rows: ParameterReading[];
  /** The posterior correlations at |ρ| ≥ POSTERIOR_CORRELATION, strongest first. */
  readonly correlations: { readonly a: string; readonly b: string; readonly rho: number }[];
  readonly reading: string;
}

/** The tools a surface has that the reading names (MCP has no diagnose_fit). */
export interface PosteriorReadingTools {
  /** The tool that reads a powder fit's serial correlation (diagnose_fit). */
  readonly diagnose?: string;
}

/** The run read whole: each parameter (readPosterior), the strong correlations, and the reading, with the compared pairs' differences. */
export function posteriorReading(result: PosteriorRunRead, parameters: readonly RefinementParameter[], esd: Readonly<Record<string, number>> | undefined, compare: readonly (readonly [string, string])[], resume: PosteriorResume, tools: PosteriorReadingTools = {}): PosteriorReading {
  const byId = new Map(parameters.map((p) => [p.id, p]));
  const { converged, nearly, essWanted, rows } = readPosterior(result, parameters, esd);
  const ids = result.freeIds;
  const pairs: { a: string; b: string; rho: number }[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const rho = result.posterior.correlation[i]?.[j];
      if (rho !== undefined && Math.abs(rho) >= STRONG) pairs.push({ a: ids[i]!, b: ids[j]!, rho });
    }
  }
  pairs.sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho));
  const wider = rows.filter((r) => !r.bound && r.esdRatio !== undefined && r.esdRatio > WIDER);
  const bounded = rows.filter((r) => r.bound);
  const text = !converged && !nearly
    ? `Not converged yet (R̂max ${sig(result.diagnostics.maxRHat, 3)}, ESS min ${Math.round(result.diagnostics.minEss)}; wanted R̂ < ${POSTERIOR_RHAT} and ESS ≥ ${essWanted}): ${resume.again} before reading the intervals.`
    : [
      converged
        ? `Converged (R̂max ${sig(result.diagnostics.maxRHat, 3)}, ESS min ${Math.round(result.diagnostics.minEss)}, ${result.diagnostics.nSamples} samples).`
        : `Close to converged (R̂max ${sig(result.diagnostics.maxRHat, 3)} < ${NEARLY_RHAT}, ESS min ${Math.round(result.diagnostics.minEss)}): good enough to judge whether a value is determined, not to quote — continue the chain (${resume.brief}) before you report intervals.`,
      wider.length === 0 && bounded.length === 0
        ? "The posterior confirms the least-squares esds: quote value(esd) as refined."
        : [
          ...(wider.length ? [`${wider.map((r) => `${r.label} (×${r.esdRatio})`).join(", ")}: the esd understates the uncertainty; quote the median with its 68 % interval.`] : []),
          ...(bounded.length ? [`${bounded.map((r) => r.label).join(", ")}: on a bound, only a limit is determined.`] : []),
        ].join(" "),
      ...(pairs.length ? [`Posterior correlations: ${pairs.slice(0, 5).map((x) => `${byId.get(x.a)?.label ?? x.a} ↔ ${byId.get(x.b)?.label ?? x.b} ${sig(x.rho, 2)}`).join("; ")} — the data fix their combination, not each alone (a tie or a restraint, or more data, separates them).`] : []),
      `The intervals hold within this model and its noise model: a systematic misfit (${tools.diagnose ? `on powder, ${tools.diagnose}'s Durbin–Watson d below Q_D` : "a Durbin–Watson d of the residual below Q_D"}) leaves them as overconfident as the esds.`,
    ].join(" ");
  const differences = differenceSentences(result, parameters, compare);
  return { converged, nearly, essWanted, rows, correlations: pairs, reading: differences.length && (converged || nearly) ? `${text} ${differences.join(" ")}` : text };
}
