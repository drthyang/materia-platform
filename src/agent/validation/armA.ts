/**
 * Arm A of the validation (docs/VALIDATION.md): the app without the Agent, as
 * a user new to Rietveld refinement drives it. No model is involved:
 *
 *  1. free every parameter the panel offers (each check box ticked; tied rows
 *     follow their tie);
 *  2. press Refine until wR stops moving (at most three presses);
 *  3. read the Validation tab's verdict, which is what the app itself says
 *     about the fit (core/diagnostics/validationChecks.ts, as the tab
 *     computes it).
 *
 * The verdict is arm A's conclusion; it is scored by the same functions as
 * the Agent's replies and report (scoring.ts). It is the bar the Agent must
 * beat: what a fault looks like when nobody but the app looks at it.
 */

import type { PowderAgentPort, PowderLiveState } from "@/agent/port";
import { generateReflections } from "@/core/diffraction/reflections";
import { powderValidation, unindexedPeaks } from "@/core/diagnostics/powderValidation";
import { powderChecks, type ValidationVerdict } from "@/core/diagnostics/validationChecks";
import { excludedPointMask } from "@/core/refinement/factors";
import type { Decision } from "@/agent/validation/record";
import { minMax } from "@/core/math/extent";

export interface ArmARun {
  readonly port: PowderAgentPort;
  readonly decisions: readonly Decision[];
  readonly verdict: ValidationVerdict;
  /** The verdict as the tab shows it, one check a line: arm A's conclusion. */
  readonly conclusion: string;
  readonly seconds: number;
}

/** The Validation tab's verdict on the page as it stands. */
export function onScreenVerdict(s: PowderLiveState): ValidationVerdict {
  const { x, yObs, yCalc, yBackground } = s.curves;
  const sigma = s.pattern.points.map((p) => p.sigma ?? Math.sqrt(Math.max(p.yObs, 1)));
  const excluded = excludedPointMask([...yObs]);
  const include = x.map((v, i) => !excluded[i] && (!s.fitRange || (v >= s.fitRange.min && v <= s.fitRange.max)));
  const nParams = s.parameters.filter((p) => !p.fixed && !p.expression).length;
  const d = s.d ? [...s.d] : undefined;
  const validation = powderValidation({ x, yObs, yCalc, ...(yBackground ? { yBackground } : {}), sigma, include, nParams, ...(d ? { d } : {}) });
  const finite = (d ?? []).filter((v) => Number.isFinite(v) && v > 0);
  const span = minMax(finite);
  const indexed = finite.length === 0 ? [] : s.refinedPhases.flatMap((ph) =>
    generateReflections(ph.cell, ph.spaceGroup, span.min, span.max).map((r) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, phaseLabel: ph.name || ph.id })));
  const hasSigma = s.pattern.points.every((p) => p.sigma !== undefined);
  const unindexed = d ? unindexedPeaks(d, yObs, yCalc, validation, indexed, hasSigma ? { pointSigma: sigma } : {}) : [];
  return powderChecks({ validation, unindexed, result: s.result, parameters: s.parameters });
}

export const verdictText = (v: ValidationVerdict): string =>
  [`Verdict: ${v.headline}.`, ...v.checks.map((c) => `- [${c.status}] ${c.title}${c.detail ? `: ${c.detail}` : ""}.`)].join("\n");

/** Run arm A on a page. */
export async function runArmA(port: PowderAgentPort): Promise<ArmARun> {
  const started = Date.now();
  const decisions: Decision[] = [];
  const toFree = port.state().parameters.filter((p) => p.fixed && !p.expression).map((p) => p.id);
  port.setFixed(toFree.map((id) => ({ id, fixed: false })));
  decisions.push({ step: 1, tool: "free every parameter", input: { free: toFree }, why: "the default a new user reaches for: tick every box", outcome: `${toFree.length} freed`, isError: false });
  let last = port.state().wR;
  for (let press = 0; press < 3; press++) {
    const failed = await port.refine();
    const s = port.state();
    decisions.push({
      step: decisions.length + 1,
      tool: "Refine",
      input: {},
      why: press === 0 ? "the Refine button" : "Refine again: wR was still moving",
      outcome: failed ? `did not finish: ${failed}` : `wR ${(100 * s.wR).toFixed(2)} %${s.result ? `, GoF ${s.result.agreement.goodnessOfFit?.toFixed(2) ?? "—"}` : ""}`,
      isError: !!failed,
    });
    if (failed || Math.abs(s.wR - last) < 1e-3) break;
    last = s.wR;
  }
  const verdict = onScreenVerdict(port.state());
  decisions.push({ step: decisions.length + 1, tool: "read the Validation tab", input: {}, why: "what the app says about the fit", outcome: verdict.headline, isError: false });
  return { port, decisions, verdict, conclusion: verdictText(verdict), seconds: (Date.now() - started) / 1000 };
}
