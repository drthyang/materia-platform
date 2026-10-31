/**
 * The powder page's magnetic analysis step without React, for tests and the
 * eval suite: the step's own store (app/magneticStep.ts, MagneticStep), the
 * one the panel renders, given its inputs from a headless session the way the
 * workbench gives them (app/powderPage.ts: the residual peaks, the moments
 * fit, Show and Continue). Its handle is the step's.
 */

import { multiPhaseCurves } from "@/core/workflow/multiPhase";
import type { Session } from "@/app/powderSession";
import type { MagneticAgentHandle } from "@/agent/magneticPort";
import { magneticComponentCurve } from "@/core/workflow/magneticPowder";
import { powderCurves } from "@/core/workflow/powder";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import { MagneticStep, type AppliedModelView, type StepInputs } from "@/app/magneticStep";
import { magneticApplied, magneticModelSummary, powderMomentFit, powderPageCurves, refinedPhasesOf, residualPeaksOf, weightedR, withMagneticModelRows, withMagneticPreview, type FitWindow, type PowderCompute } from "@/app/powderPage";

/** The curves of a session, the magnetic model's contribution included. */
export function sessionCurves(s: Session): ReturnType<typeof powderCurves> {
  // A multi-phase page sums its phases, as the page's own curves do.
  const curves = s.extraPhases.length > 0
    ? multiPhaseCurves([s.structure, ...s.extraPhases].map((st) => ({ structure: st, id: st.id })), s.pattern, s.powderParams, s.powderBindings, s.powderProfile)
    : powderCurves(s.structure, s.pattern, s.powderParams, s.powderBindings, s.powderProfile);
  if (!s.magnetic) return curves;
  const mag = magneticComponentCurve(s.structure, s.magnetic, s.pattern, s.powderParams, s.powderBindings, s.powderProfile);
  const yCalc = curves.yCalc.map((y, i) => y + (mag[i] ?? 0));
  return { ...curves, yCalc, diff: curves.yObs.map((o, i) => o - yCalc[i]!) };
}

/** The applied model as the step shows it (the panel's, from the same summary). */
function appliedView(s: Session): AppliedModelView | null {
  const m = magneticModelSummary(s);
  return m ? { kLabel: m.kLabel, group: m.group, inCalc: m.inCalc } : null;
}

/** What the step reads off the page: the session and the fit window it applies. */
export interface StepPage {
  readonly session: Session;
  readonly window: FitWindow | null;
}

/** The step over a page the caller owns (`page` / `set`), as the panel's over the workbench's. */
export function magneticHandle(
  page: () => StepPage,
  set: (s: Session) => void,
  openStep: (step: 0 | 1) => void,
  opts: { readonly instrument?: InstrumentParameters; readonly client?: PowderCompute } = {},
): MagneticAgentHandle {
  // The inputs as the workbench gives them to the panel, made again only when the page changes.
  let last: { readonly session: Session; readonly window: FitWindow | null; readonly inputs: StepInputs } | null = null;
  const inputs = (): StepInputs => {
    const { session: s, window } = page();
    if (last && last.session === s && last.window?.min === window?.min && last.window?.max === window?.max) return last.inputs;
    const viewOnly = s.pattern.xUnit === "tof" && s.powderProfile.shape !== "tof";
    const next: StepInputs = {
      // The panel works on the refined phase (the moments fit re-applies the rows onto the loaded one).
      structure: refinedPhasesOf(s)[0]!,
      residualPeaks: residualPeaksOf(s, opts.instrument),
      ...(magneticApplied(s) ? { nuclearResidualPeaks: residualPeaksOf(s, opts.instrument, [], { nuclearOnly: true }) } : {}),
      applied: appliedView(s),
      // A view-only TOF page, which the compute client does not refine, fits in this thread.
      fit: powderMomentFit(viewOnly ? null : opts.client ?? null, s, window),
      baselineAgreement: s.pattern.points.length > 0 ? weightedR(s, powderPageCurves(s).nuclear, window) : null,
      allowRefineK: true,
      fitContext: `${s.pattern.id}|${s.pattern.points.length}|${window ? `${window.min}–${window.max}` : "all"}`,
      preselect: s.magnetic ?? null,
      onApply: (magnetic) => set(withMagneticPreview(page().session, magnetic)),
      onContinue: (magnetic, params, bindings) => {
        set(withMagneticModelRows(page().session, magnetic, params, bindings));
        openStep(0);
      },
    };
    last = { session: s, window, inputs: next };
    return next;
  };
  return new MagneticStep(inputs).handle;
}
