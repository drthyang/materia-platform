/**
 * Posterior view for the PDF workbench plot card: run the ensemble MCMC
 * sampler over the CURRENT free parameters (seeded at their present values —
 * refine first, then sample), and read the posterior the way the reporting
 * literature asks (McCluskey et al. 2023): credible intervals + convergence
 * evidence (split-R̂, ESS, acceptance), never a bare std. The headline column
 * is esdRatio = posterior std / linearized LM esd: ≈ 1 validates the
 * least-squares error bars; ≫ 1 means the linearization was overconfident.
 *
 * While a run goes, Stop takes the Sample button's place (as Cancel takes
 * Refine's): the run ends on its last whole step and its partial chains stay,
 * labelled "Stopped early" — never "Converged" — with no estimates at all when
 * too few steps were kept for the diagnostics to read.
 */

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { essTarget, MIN_KEPT_STEPS, tooFewToRead, type SampleResult } from "@/core/refinement/bayes/sampler";
import type { PosteriorParamSummary } from "@/core/refinement/bayes/diagnostics";
import { POSTERIOR_RHAT } from "@/core/diagnostics/thresholds";
import { color, fz, mono, primaryButton, secondaryButton, uppercaseLabel } from "@/app/theme";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { CANCEL_ARM_MS } from "@/app/ui/RunActions";

export interface PosteriorPanelProps {
  readonly result: SampleResult | null;
  readonly busy: boolean;
  readonly progress: { step: number; total: number } | null;
  /** Kick off a run; `continueRun` resumes the existing chain. */
  readonly onRun: (continueRun: boolean) => void;
  /** Stop the running sampler (shown in the Sample button's place while `busy`). */
  readonly onStop: () => void;
  /** A converged LM result exists (enables sampling + the esdRatio column). */
  readonly hasRefined: boolean;
  /** Parameter labels by id (falls back to the id). */
  readonly labels: ReadonlyMap<string, string>;
}

/** Tone for the esdRatio verdict: ≈1 healthy, drifting → warn ink. */
function ratioInk(ratio: number | undefined): string {
  if (ratio === undefined) return color.secondary;
  return ratio > 1.5 || ratio < 0.6 ? color.warnInk : color.okInk;
}

function rhatInk(rhat: number): string {
  return rhat < POSTERIOR_RHAT ? color.okInk : color.warnInk;
}

function essInk(ess: number, nFree: number): string {
  return ess >= essTarget(nFree) ? color.okInk : color.warnInk;
}

const stopButton: CSSProperties = { ...secondaryButton, border: `1px solid ${color.warnBorder}`, background: color.warnBg, color: color.warnInk, fontWeight: 600 };

/** Compact marginal histogram (SVG) from the flattened per-parameter draws. */
function Marginal({ draws, summary }: { draws: readonly number[]; summary: PosteriorParamSummary }) {
  const { bars, lo, hi } = useMemo(() => {
    const lo = summary.q025;
    const hi = summary.q975;
    const span = hi - lo || 1;
    const nBins = 24;
    const counts = new Array<number>(nBins).fill(0);
    for (const v of draws) {
      const b = Math.floor(((v - lo) / span) * nBins);
      if (b >= 0 && b < nBins) counts[b] = counts[b]! + 1;
    }
    const max = Math.max(1, ...counts);
    return { bars: counts.map((c) => c / max), lo, hi };
  }, [draws, summary]);

  const W = 132;
  const H = 34;
  const bw = W / bars.length;
  // Median marker position within the histogram span.
  const mx = ((summary.median - lo) / (hi - lo || 1)) * W;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} aria-hidden>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * bw + 0.5}
          y={(1 - h) * (H - 4) + 2}
          width={Math.max(bw - 1, 1)}
          height={h * (H - 4)}
          fill={color.primaryTintBorder}
        />
      ))}
      <line x1={mx} x2={mx} y1={0} y2={H} stroke={color.primary} strokeWidth={1.2} />
    </svg>
  );
}

export function PosteriorPanel({ result, busy, progress, onRun, onStop, hasRefined, labels }: PosteriorPanelProps) {
  // A Stop tap this soon after the run started is the second tap of a double
  // tap on Sample (Stop takes its place): ignored, as the run bar's Cancel is.
  const startedAt = useRef(0);
  useEffect(() => {
    if (busy) startedAt.current = Date.now();
  }, [busy]);
  const stop = (): void => {
    if (Date.now() - startedAt.current < CANCEL_ARM_MS) return;
    onStop();
  };
  // Flattened draws per parameter for the marginals (kept small by the panel).
  const flat = useMemo(() => {
    if (!result) return new Map<string, number[]>();
    const out = new Map<string, number[]>();
    result.freeIds.forEach((id, j) => {
      const draws: number[] = [];
      for (const walker of result.chains) for (const row of walker) draws.push(row[j]!);
      out.set(id, draws);
    });
    return out;
  }, [result]);

  const stopped = result?.stopped ?? null;
  const converged = result?.status === "ok" && !stopped;
  // Too few kept steps for R̂/ESS: a stopped run then shows only its note.
  const tooFew = result !== null && tooFewToRead(result);
  const showEstimates = result !== null && !(stopped && tooFew);
  // A run stopped before its first step left nothing to continue.
  const canContinue = result !== null && result.resume.logP.length === result.resume.q.length;
  const nFree = result?.freeIds.length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      {/* Action row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {busy ? (
          <button style={stopButton} onClick={stop} title="Stop the sampler: the steps already taken are kept, marked as stopped early">
            Stop
          </button>
        ) : (
          <button
            style={{ ...primaryButton, opacity: hasRefined ? 1 : 0.55 }}
            disabled={!hasRefined}
            onClick={() => onRun(false)}
            title={
              hasRefined
                ? "Sample the Bayesian posterior of the FREE parameters, seeded at the current refined values (400 ensemble steps; marginalized noise model)"
                : "Refine first — sampling seeds walkers at the converged least-squares values"
            }
          >
            Sample posterior
          </button>
        )}
        {result ? (
          <button
            style={{ ...secondaryButton, opacity: busy || !canContinue ? 0.55 : 1 }}
            disabled={busy || !canContinue}
            onClick={() => onRun(true)}
            title={
              canContinue
                ? "Continue the SAME chain from its resume token (400 more steps) — the honest fix for a not-converged run"
                : "Stopped before the first step: nothing to continue — sample afresh"
            }
          >
            Continue ↻
          </button>
        ) : null}
        {busy ? (
          <span style={{ fontFamily: mono, fontSize: fz.small, color: color.secondary }}>
            <span className="wb-shimmer-text">Sampling…</span>
            {progress ? ` step ${progress.step}/${progress.total}` : ""}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <InfoBadge
          width={300}
          align="right"
          text={
            <span>
              The ensemble MCMC posterior of the free parameters (uniform priors within
              bounds; error scale marginalized because G(r) point errors are correlated).
              Report the 68% credible interval with the convergence evidence — split-R̂
              ≈ 1 and enough effective samples (ESS). <b>esd ratio</b> = posterior σ /
              least-squares esd: ≈ 1 validates the LM error bars, larger means the
              linearized esd was overconfident.
            </span>
          }
        />
      </div>

      {/* Status banner */}
      {result ? (
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "baseline",
            flexWrap: "wrap",
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${converged ? color.okBorder : color.border}`,
            background: converged ? color.okBg : color.chipBg,
            fontSize: fz.small,
          }}
        >
          {stopped ? (
            <span data-testid="posterior-stopped" style={{ fontWeight: 600, color: color.noteInk, display: "inline-flex", alignItems: "center", gap: 6 }}>
              Stopped early · {result.diagnostics.nSamples} of {stopped.plannedSamples} samples{tooFew ? " · too few to estimate" : ""}
              <InfoBadge
                width={280}
                text={
                  tooFew ? (
                    <span>
                      Stopped at step {stopped.atStep} of {stopped.plannedStep}. R̂ and ESS need at least {MIN_KEPT_STEPS} kept
                      steps per walker after burn-in, so no estimates are shown. Sample again for a full run.
                    </span>
                  ) : (
                    <span>
                      Stopped at step {stopped.atStep} of {stopped.plannedStep}; burn-in is half the steps taken. The chains are
                      partial, so the intervals below are not final and the run is not called converged. Continue ↻ resumes
                      the chain from its last step; Sample posterior starts afresh.
                    </span>
                  )
                }
              />
            </span>
          ) : (
            <span style={{ fontWeight: 600, color: converged ? color.okInk : color.noteInk }}>
              {converged ? "Converged" : "Not converged — continue the chain"}
            </span>
          )}
          {showEstimates ? (
            <>
              <span style={{ fontFamily: mono, color: color.secondary }} title={`passes below ${POSTERIOR_RHAT}`}>
                R̂max <b style={{ color: rhatInk(result.diagnostics.maxRHat) }}>{result.diagnostics.maxRHat.toFixed(3)}</b>
              </span>
              <span style={{ fontFamily: mono, color: color.secondary }} title={`passes at ${essTarget(nFree)} or more`}>
                ESSmin <b style={{ color: essInk(result.diagnostics.minEss, nFree) }}>{Math.round(result.diagnostics.minEss)}</b>
              </span>
              <span style={{ fontFamily: mono, color: color.secondary }}>
                accept <b>{(result.acceptanceFraction * 100).toFixed(0)}%</b>
              </span>
              {stopped ? null : (
                <span style={{ fontFamily: mono, color: color.secondary }}>
                  {result.diagnostics.nSamples} samples
                </span>
              )}
            </>
          ) : null}
        </div>
      ) : (
        <div style={{ color: color.secondary, fontSize: fz.small, lineHeight: 1.5 }}>
          Sample the posterior <i>after</i> a converged refinement: walkers seed at the
          refined values, and the posterior widths are compared against the linearized
          esds (the <b>esd ratio</b> — ≈ 1 validates the least-squares error bars).
          Only the currently <b>free</b> parameters are sampled.
        </div>
      )}

      {/* Per-parameter table */}
      {result && showEstimates ? (
        <div className="wb-posterior-table" style={{ overflow: "auto", minHeight: 0, flex: 1 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: fz.small }}>
            <thead>
              <tr style={{ ...uppercaseLabel, color: color.faint, textAlign: "left" }}>
                <th style={{ padding: "4px 8px" }}>parameter</th>
                <th style={{ padding: "4px 8px" }}>marginal</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>median</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>68% interval</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>
                  esd ratio
                </th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>R̂</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>ESS</th>
              </tr>
            </thead>
            <tbody>
              {result.posterior.parameters.map((p) => (
                <tr key={p.id} style={{ borderTop: `1px solid ${color.subtle2}` }}>
                  <td style={{ padding: "6px 8px", color: color.ink }}>{labels.get(p.id) ?? p.id}</td>
                  <td style={{ padding: "4px 8px" }}>
                    <Marginal draws={flat.get(p.id) ?? []} summary={p} />
                  </td>
                  <td style={{ fontFamily: mono, padding: "6px 8px", textAlign: "right", color: color.ink }}>
                    {p.median.toPrecision(5)}
                  </td>
                  <td style={{ fontFamily: mono, padding: "6px 8px", textAlign: "right", color: color.secondary }}>
                    [{p.q16.toPrecision(4)}, {p.q84.toPrecision(4)}]
                  </td>
                  <td style={{ fontFamily: mono, padding: "6px 8px", textAlign: "right", fontWeight: 600, color: ratioInk(p.esdRatio) }}>
                    {p.esdRatio !== undefined ? p.esdRatio.toFixed(2) : "—"}
                  </td>
                  <td style={{ fontFamily: mono, padding: "6px 8px", textAlign: "right", color: rhatInk(p.rHat) }}>
                    {p.rHat.toFixed(3)}
                  </td>
                  <td style={{ fontFamily: mono, padding: "6px 8px", textAlign: "right", color: stopped ? essInk(p.ess, nFree) : color.secondary }}>
                    {Math.round(p.ess)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
