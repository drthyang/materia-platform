/**
 * The eval scenarios: each one a request a user made (or a researcher round
 * made) that the Agent once got wrong, on a page built from the repository's
 * own data, with the checks that say whether it got it right this time.
 */

import { MAGNETIC_TRUTH, impurityD, mn3gaFluoriteSession, mn3gaImpuritySession, mn3gaMagneticSession, mn3gaMisfitSession, mn3gaSession, pdfPage, powderPage } from "@/agent/evals/pages";
import {
  addsKnownPhase,
  adaptsAfterRefusal,
  coversStages,
  doesNotRefuse,
  explains,
  fitWindowIs,
  liftsNoRule,
  magneticGroupIs,
  magneticKIs,
  mentionsD,
  noPhantomPeaks,
  noStall,
  oneMotionTerm,
  ran,
  readsMethodFirst,
  refines,
  reportCarriesScan,
  reportsEngineNumbers,
  symmetryLast,
  tracksBonds,
} from "@/agent/evals/checks";
import type { EvalScenario } from "@/agent/evals/harness";

export const SCENARIOS: readonly EvalScenario[] = [
  {
    id: "full-refinement",
    title: "Runs the full refinement when asked",
    origin: "User report on the deployed Agent: it refused the full refinement, citing the cell and space-group check.",
    page: () => powderPage(mn3gaSession()),
    messages: ["Run the full refinement to improve the quality of the fit."],
    autonomy: "auto",
    checks: [readsMethodFirst, doesNotRefuse, refines(3), coversStages(["base", "positions", "profile", "adp"]), symmetryLast, noStall],
  },
  {
    id: "analysis-report",
    title: "Writes the report from the engine's numbers",
    origin: "User request: the analysis report — every number from the engine and the History, the Agent writing only its own account.",
    page: () => powderPage(mn3gaSession()),
    messages: ["Refine the scale, background and cell, then write the analysis report."],
    autonomy: "auto",
    checks: [readsMethodFirst, refines(1), ran("write_report"), reportsEngineNumbers, noStall],
  },
  {
    id: "misfits-not-extra-peaks",
    title: "Calls intensity misfit a misfit, not an extra peak",
    origin: "User report: reflections with somewhat different intensity were called extra peaks.",
    page: () => powderPage(mn3gaMisfitSession()),
    messages: ["Are there extra peaks in this pattern that the model does not explain?"],
    autonomy: "ask",
    checks: [ran("find_unexplained_peaks"), noPhantomPeaks, symmetryLast, noStall],
  },
  {
    id: "symmetry-last",
    title: "Refines to the best before questioning the space group",
    origin: "User report: the Agent proposed lowering the symmetry at the start; that is the last step, once nothing else can be refined.",
    page: () => powderPage(mn3gaMisfitSession()),
    messages: ["The fit is not good. Should we lower the symmetry?"],
    autonomy: "ask",
    checks: [symmetryLast, explains(/\brefin/i, "refining first"), noStall],
  },
  {
    id: "impurity-line",
    title: "Finds and reports a line no phase explains",
    origin: "Residual peaks (#40): judged by their own noise and against every phase's reflections.",
    page: () => powderPage(mn3gaImpuritySession()),
    messages: ["Is there anything in the pattern the model does not account for?"],
    autonomy: "ask",
    checks: [ran("find_unexplained_peaks"), mentionsD(impurityD(), 0.03), symmetryLast, noStall],
  },
  {
    id: "known-impurity",
    title: "Names a known impurity and adds it as a phase",
    origin: "Researcher round 10 (NAC on 11-BM): 22 unindexed lines were fluorite, a by-product of the fluoride synthesis; the library did not hold it, and only the user's CIF could add it.",
    page: () => powderPage(mn3gaFluoriteSession()),
    messages: ["There are lines this model does not explain. What are they? Model them if you can."],
    autonomy: "auto",
    approveAsked: ["add_known_phase"],
    checks: [ran("identify_peaks"), addsKnownPhase("CaF₂"), noStall],
  },
  {
    id: "bare-occupancy",
    title: "Does not refine an occupancy bare, and says why",
    origin: "Round 5: the occupancy guardrail; only the user lifts it.",
    page: () => powderPage(mn3gaSession()),
    messages: ["Refine the Mn occupancy as well."],
    autonomy: "ask",
    checks: [liftsNoRule, adaptsAfterRefusal(2), explains(/\b(tie|Σ|sum|scale|composition|restrain|degenera|correlat)/i, "why the occupancy needs a tie"), noStall],
  },
  {
    id: "free-everything",
    title: "Answers a refusal by changing the free set",
    origin: "The correlation guard (#39): correlated parameters are never refined together.",
    page: () => powderPage(mn3gaSession()),
    messages: ["Free every parameter and refine."],
    autonomy: "ask",
    checks: [liftsNoRule, adaptsAfterRefusal(3), noStall],
  },
  {
    id: "fit-window-in-d",
    title: "Sets a fit window given in d",
    origin: "Axis units (#39): windows and positions in d, Q or the data's own axis.",
    page: () => powderPage(mn3gaSession()),
    messages: ["Restrict the fit to d-spacings from 1.2 to 3 Å."],
    autonomy: "ask",
    checks: [fitWindowIs("dSpacing", 1.2, 3, 0.01), noStall],
  },
  {
    id: "magnetic-structure",
    title: "Solves a magnetic structure on the magnetic step",
    origin: "User report: the Agent could not act on the magnetic analysis step.",
    page: () => powderPage(mn3gaMagneticSession()),
    messages: ["The nuclear structure is refined. Find the magnetic structure."],
    autonomy: "auto",
    checks: [readsMethodFirst, ran("search_propagation_vector"), magneticKIs([MAGNETIC_TRUTH.k[0], MAGNETIC_TRUTH.k[1], MAGNETIC_TRUTH.k[2]]), magneticGroupIs(MAGNETIC_TRUTH.id), ran("refine_moments"), noStall],
  },
  {
    id: "pdf-method",
    title: "Refines a PDF by its method",
    origin: "The PDF page (v0.3): scale and cell, ADPs, one correlated-motion term, positions.",
    page: () => pdfPage(),
    messages: ["Refine this PDF fit following my method."],
    autonomy: "auto",
    checks: [readsMethodFirst, refines(2), oneMotionTerm, noStall],
  },
  {
    id: "pdf-local-structure",
    title: "Compares local and average structure with a boxcar scan",
    origin: "Boxcar scans on the PDF page (#40).",
    page: () => pdfPage(),
    messages: ["Does the local structure differ from the average one?"],
    autonomy: "ask",
    checks: [ran("boxcar_scan"), noStall],
  },
  {
    id: "pdf-local-geometry",
    title: "Answers a bond-length question box by box, and reports the scan",
    origin: "Researcher round 9 (LaMnO₃ at 300 K, NPDF): whether the Jahn–Teller distortion holds at low r is a question about Mn–O lengths, which the scan gave only as coordinate shifts; narrowing the page's free set for the scan, then going back to the full fit, left the scan out of the report.",
    page: () => pdfPage(),
    messages: ["Is the Ta coordination the same locally as on average? Write the report when you are done."],
    autonomy: "auto",
    checks: [ran("boxcar_scan"), tracksBonds, reportCarriesScan, reportsEngineNumbers, noStall],
  },
];

export function scenario(id: string): EvalScenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`no eval scenario "${id}"`);
  return s;
}
