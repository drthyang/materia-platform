/**
 * The powder report's judgment of the fit on screen: the Validation tab's
 * verdict (powderAcceptance) and its causes of misfit (diagnose_fit, named as
 * fitCauses.ts names them), read from the page exactly as the tab and the
 * Agent read it (powderJudgment.ts). The report restates them in the Result
 * paragraph and the caveats (core/export/reportResult.ts); it judges nothing
 * itself.
 */

import type { JudgedPage } from "@/app/powderJudgment";
import { pageAssessment, pageFitDiagnosis } from "@/app/powderJudgment";
import { causeRows, headlineCause } from "@/app/ui/fitCauses";
import { powderAcceptance, type Acceptance } from "@/core/diagnostics/powderAcceptance";
import { powderValidation } from "@/core/diagnostics/powderValidation";
import { fittedPoints, pointSigma } from "@/core/diagnostics/powderResidual";
import { parametersChangedSince } from "@/core/diagnostics/validationChecks";
import type { ReportCause } from "@/core/export/reportResult";
import type { LinearRestraint } from "@/core/refinement/types";

export interface PowderJudgment {
  readonly acceptance: Acceptance;
  /** The causes of misfit, the largest share of χ² first. */
  readonly causes: readonly ReportCause[];
  /** The cause the verdict names. */
  readonly headlineCause?: { readonly phrase: string; readonly share: number; readonly first: boolean } | undefined;
  readonly restraints: readonly LinearRestraint[];
  /** The agreement of the curves shown, as the Validation tab computes it: what the verdict reads where no refinement gave one (a snapshot). */
  readonly agreement: { readonly rexp: number; readonly gof: number };
}

/**
 * The verdict and causes of the fit on screen. `gof` is the GoF the page
 * shows (the last refinement's), `snapshot` whether it shows the converged
 * snapshot it opened on.
 */
export function powderJudgment(page: JudgedPage, o: { readonly gof: number | null; readonly snapshot: boolean }): PowderJudgment {
  const judged = pageFitDiagnosis(page);
  const rows = judged
    ? causeRows(judged.diagnosis, {
        parameters: page.parameters,
        twoTheta: page.pattern.xUnit === "twoTheta",
        backgroundTerms: page.settings.backgroundTerms,
        magneticNeutron: judged.magneticNeutron,
        widthsFree: judged.widthsFree,
        stagesDone: [],
      })
    : [];
  const current = page.result !== null && !parametersChangedSince(page.result, page.parameters);
  const assessment = current ? pageAssessment(page) : null;
  const c = page.curves;
  const validation = powderValidation({
    x: c.x, yObs: c.yObs, yCalc: c.yCalc,
    ...(c.yBackground && c.yBackground.length === c.x.length ? { yBackground: c.yBackground } : {}),
    sigma: pointSigma(c.yObs, page.pattern.points),
    include: fittedPoints(c.x, c.yObs, page.fitRange),
    nParams: page.parameters.filter((p) => !p.fixed && !p.expression).length,
    ...(page.d ? { d: page.d } : {}),
  });
  const top = headlineCause(rows);
  const acceptance = powderAcceptance({
    gof: o.gof ?? validation.agreement.gof,
    durbinWatson: validation.durbinWatson,
    result: page.result,
    parameters: page.parameters,
    structures: page.refinedPhases,
    assessment,
    snapshot: o.snapshot,
    topCause: top,
    canExport: true,
    zeroAdp: page.zeroAdp,
  });
  return {
    acceptance,
    causes: rows.map((r) => ({ title: r.title, phrase: r.phrase, share: r.share, evidence: r.evidence, summary: r.summary, ...(r.statistic ? { statistic: r.statistic } : {}) })),
    ...(top ? { headlineCause: top } : {}),
    restraints: page.restraints,
    agreement: { rexp: validation.agreement.rexp, gof: validation.agreement.gof },
  };
}
