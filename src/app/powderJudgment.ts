/**
 * The Agent's two readings of the fit on screen, for the Validation view: the
 * residual read cause by cause (`diagnose_fit`) and the engine's assessment
 * (`assess_refinement`). Each is built from the page's state exactly as the
 * Agent's powder tools build it (agent/powderTools.ts: fitDiagnosisOf and
 * assessment) — the same σ, points, Rietveld partition, residual, restraints
 * and B-at-0 proposals — so the view and the Agent report the same causes,
 * shares and findings. powderJudgment.test.ts holds the two to each other on
 * the bundled demo, before and after a refinement.
 */

import type { PowderLiveState } from "@/agent/port";
import { assess_refinement } from "@/mcp/tools";
import { diagnoseFit, type FitDiagnosis } from "@/core/diagnostics/fitDiagnosis";
import { k0MagneticHint, residualPeaks, type RefinementAssessment } from "@/core/diagnostics/assessment";
import { fittedPoints, pointSigma, powderResidual, type PowderResidual } from "@/core/diagnostics/powderResidual";
import type { ParameterKind } from "@/core/refinement/types";
import { powderReflectionObsCalc } from "@/core/workflow/obsCalc";
import { convertAxisValue } from "@/visualization/axisUnits";

/** What the readings take of the page: the Agent's live state, or the same fields. */
export type JudgedPage = Pick<
  PowderLiveState,
  "structure" | "extraPhases" | "refinedPhases" | "pattern" | "parameters" | "bindings" | "profile" | "magnetic" | "result" | "fitRange" | "curves" | "d" | "axis" | "observationCount" | "restraints" | "zeroAdp"
> & {
  readonly settings: Pick<PowderLiveState["settings"], "backgroundTerms" | "backgroundType">;
};

/** The diagnosis, with what it was read with that the advice on it depends on. */
export interface PageDiagnosis {
  readonly diagnosis: FitDiagnosis;
  /** A neutron pattern of a phase with magnetic ions and no magnetic model; `k0`: its misfits on nuclear lines carry the k = 0 signature. */
  readonly magneticNeutron?: { readonly k0: boolean };
  /** The Caglioti terms present are all free (and the Lorentzian X, when present). */
  readonly widthsFree: boolean;
}

/** The Caglioti terms and the Lorentzian X: diagnose_fit reads the shape, not the width, once those present are all free. */
const WIDTH_KINDS: readonly ParameterKind[] = ["profileU", "profileV", "profileW", "profileX"];

/** The residual of the fit on screen, as the Agent's tools read it (core/diagnostics/powderResidual.ts). Null without d-spacings. */
export function pageResidual(s: JudgedPage): PowderResidual | null {
  if (!s.d) return null;
  return powderResidual({ curves: s.curves, d: s.d, pattern: s.pattern, phases: s.refinedPhases, fitRange: s.fitRange, magnetic: s.magnetic }).residual;
}

/** The k = 0 magnetic signature of a residual, as find_unexplained_peaks reads it (k0Magnetic). */
function k0Signature(residual: PowderResidual): boolean {
  return k0MagneticHint(residual.magneticNeutron, residualPeaks(residual, { limit: 12 }).onReflection);
}

/** diagnose_fit on the page: null when the axis does not convert to d-spacing (the Agent's tool refuses then). */
export function pageFitDiagnosis(s: JudgedPage): PageDiagnosis | null {
  if (!s.d) return null;
  const curves = s.curves;
  const sigma = pointSigma(curves.yObs, s.pattern.points);
  const include = fittedPoints(curves.x, curves.yObs, s.fitRange);
  const reflections = powderReflectionObsCalc(s.structure, s.pattern, [...s.parameters], [...s.bindings], s.profile, s.magnetic, s.fitRange, s.extraPhases, "rietveld", {
    yCalc: [...curves.yCalc], sigma, include,
  });
  const freeKinds = new Set(s.parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.kind));
  const present = WIDTH_KINDS.filter((k) => s.parameters.some((p) => p.kind === k));
  const residual = pageResidual(s)!;
  const widthsFree = present.includes("profileU") && present.every((k) => freeKinds.has(k));
  const magneticNeutron = residual.magneticNeutron ? { k0: k0Signature(residual) } : undefined;
  const diagnosis = diagnoseFit({
    x: curves.x, yObs: curves.yObs, yCalc: curves.yCalc,
    ...(curves.yBackground && curves.yBackground.length === curves.x.length ? { yBackground: curves.yBackground } : {}),
    sigma, include,
    nParams: s.parameters.filter((p) => !p.fixed && !p.expression).length,
    d: s.d,
    reflections,
    phases: s.refinedPhases,
    twoTheta: s.pattern.xUnit === "twoTheta",
    xOf: (d) => convertAxisValue(d, "dSpacing", s.pattern.xUnit, s.axis),
    ...(widthsFree ? { widthsFree: { lorentzian: present.includes("profileX") } } : {}),
    background: { type: s.settings.backgroundType, terms: s.settings.backgroundTerms },
    ...(magneticNeutron ? { magneticNeutron } : {}),
  });
  return { diagnosis, ...(magneticNeutron ? { magneticNeutron } : {}), widthsFree };
}

/** ADP parameters bound to two or more sites: a shared (mixed) site's tied ADP. */
function sharedSiteAdps(s: JudgedPage): string[] {
  const sites = new Map<string, Set<string>>();
  for (const b of s.bindings) {
    if ((b.kind === "bIso" || b.kind === "uAniso") && b.targetKey) sites.set(b.parameterId, (sites.get(b.parameterId) ?? new Set()).add(`${b.targetId}/${b.targetKey}`));
  }
  return [...sites].filter(([, set]) => set.size > 1).map(([id]) => id);
}

/** assess_refinement on the page: null with no refinement result to assess. */
export function pageAssessment(s: JudgedPage): RefinementAssessment | null {
  if (!s.result) return null;
  const residual = pageResidual(s);
  return assess_refinement({
    result: s.result,
    parameters: [...s.parameters],
    observationCount: s.observationCount,
    ...(residual ? { residual } : {}),
    mode: "powder",
    restraints: s.restraints,
    sharedSiteAdps: sharedSiteAdps(s),
    structures: s.refinedPhases,
    ...(s.zeroAdp ? { zeroAdp: s.zeroAdp } : {}),
  });
}
