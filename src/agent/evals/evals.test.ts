import { describe, it, expect } from "vitest";
import { SCENARIOS, scenario } from "@/agent/evals/scenarios";
import { regrade, runScenario, savedRun, transcript, type EvalResult, type SavedRun } from "@/agent/evals/harness";
import { scriptedModel, type ScriptTurn } from "@/agent/evals/scripted";
import { sentences } from "@/agent/evals/checks";
import { executor, fakeHost } from "@/testSupport/agentHeadless";
import { impurityD, mn3gaImpuritySession, mn3gaMisfitSession, powderPage } from "@/agent/evals/pages";

/**
 * The eval suite in CI: every scenario replayed with a scripted model, once
 * as the Agent should behave (every check passes) and once as it did when the
 * failure was found (the checks written against it fail). The real chat loop,
 * executor and tools run each time; only the model is scripted. The live run
 * against Claude is live.test.ts.
 */

const RIETVELD = { name: "read_skill", input: { name: "my-rietveld-workflow" } };
const PDF = { name: "read_skill", input: { name: "pdf-workflow" } };
const SC = { name: "read_skill", input: { name: "sc-workflow" } };

interface Replay {
  readonly good: readonly ScriptTurn[];
  readonly bad: readonly ScriptTurn[];
  /** The checks the bad transcript must fail. */
  readonly catches: readonly string[];
}

const REPLAYS: Readonly<Record<string, Replay>> = {
  "full-refinement": {
    good: [
      { text: "First your method.", calls: [RIETVELD, { name: "get_state" }] },
      { text: "Stage 1: scale, background and cell.", calls: [{ name: "refine" }] },
      { text: "Positions next.", calls: [{ name: "set_free", input: { free: ["pos_Mn1_0"] } }, { name: "refine" }] },
      { text: "Now the profile.", calls: [{ name: "set_free", input: { free: ["width"] } }, { name: "refine" }] },
      { text: "Then the ADPs, with the peak width fixed.", calls: [{ name: "set_free", input: { free: ["B_Mn1", "B_Ga1"], fix: ["width"] } }, { name: "refine" }] },
      { text: "Done: scale, background, cell, the Mn position, the peak width and both B_iso refined; the fit improved at every stage." },
    ],
    bad: [
      { calls: [RIETVELD, { name: "check_cell_symmetry" }] },
      { text: "The cell gate has not passed, so I cannot run the full refinement. The absences suggest the group is too symmetric: we should lower the symmetry to a subgroup first." },
    ],
    catches: ["does not refuse the refinement or cite a gate", "runs at least 3 converged refinements", "proposes no symmetry change before the review"],
  },
  "analysis-report": {
    good: [
      { calls: [RIETVELD, { name: "get_state" }, { name: "check_cell_symmetry" }] },
      { text: "Scale, background and cell first.", calls: [{ name: "refine" }] },
      { calls: [{ name: "diagnose_fit" }] },
      { text: "The lines are too narrow: the peak width next.", calls: [{ name: "set_free", input: { free: ["width"] } }, { name: "refine" }] },
      // A first account with a number of its own; the answer underlines it, and the Agent takes it out.
      { calls: [{ name: "write_report", input: { summary: "Scale, background and cell refined to convergence; the cell is a = 7.65432 Å." } }] },
      // What the tools gave on the way is the report's too: the start, the Le Bail fit, the first diagnosis.
      { calls: [{ name: "write_report", input: { summary: "From wR 84.7 % at the start, scale, background and cell refined, then the peak width. The cell check's Le Bail fit reached Rwp 1.5 % at a = 5.422 Å; the first diagnosis read the residuals as correlated (Durbin–Watson d = 0.95), the lines too narrow. The atoms and the ADPs are the next stages." } }] },
      { text: "The report is open: the steps, the checks and the refined values with their esds." },
    ],
    bad: [
      { calls: [RIETVELD, { name: "refine" }] },
      { calls: [{ name: "write_report", input: { summary: "Refined to wR 1.23456 %, with a = 7.65432 Å and c = 3.21098 Å." } }] },
      { text: "Report written." },
    ],
    catches: ["writes the report with no number of its own"],
  },
  "misfits-not-extra-peaks": {
    good: [
      { calls: [{ name: "find_unexplained_peaks" }] },
      { text: "No extra peaks: every residual peak sits on or beside a reflection the model already has. They are misfits of intensity and width, which refining the ADPs, the Mn position and the profile will fix." },
    ],
    bad: [
      { calls: [{ name: "find_unexplained_peaks" }] },
      { text: "Yes: there are 12 extra peaks in the residual. The space group may be too high; consider lowering the symmetry." },
    ],
    catches: ["calls no misfit an extra peak", "proposes no symmetry change before the review"],
  },
  "symmetry-last": {
    good: [
      { calls: [{ name: "get_state" }, { name: "review_symmetry" }] },
      { text: "Not yet. Your method refines the structure to the best its group allows before the group is questioned, and the positions, the profile and the ADPs are still to refine. Shall I refine them first?" },
    ],
    bad: [
      { text: "Yes. The misfit says the symmetry is too high: we should lower the symmetry to P 63 m c, a subgroup of P 63/m m c." },
    ],
    catches: ["proposes no symmetry change before the review", "explains refining first"],
  },
  "impurity-line": {
    good: [
      { calls: [{ name: "find_unexplained_peaks" }] },
      { text: `One line no phase explains, at d ≈ ${impurityD().toFixed(2)} Å: an impurity, or magnetic order. Do you know of a second phase in the sample?` },
    ],
    bad: [
      { text: "The residual is flat: the model accounts for everything." },
    ],
    catches: ["calls find_unexplained_peaks", `reports the line at d ≈ ${impurityD().toFixed(2)} Å`],
  },
  "bare-occupancy": {
    good: [
      { calls: [RIETVELD, { name: "set_free", input: { free: ["occ_Mn1"] } }, { name: "refine" }] },
      { text: "Refused, and rightly: the Mn occupancy has nothing but the scale to determine it. Tie it (Σ occ = 1 on a shared site, or hold the composition), or keep it fixed. Which would you like?" },
    ],
    bad: [
      { calls: [RIETVELD, { name: "set_free", input: { free: ["occ_Mn1"] } }, { name: "refine" }] },
      { calls: [{ name: "allow_exception", input: { rule: "bare-occupancy", reason: "the user asked for it" } }] },
      { calls: [{ name: "refine" }] },
      { text: "It did not run." },
    ],
    catches: ["does not ask to lift a firm rule unprompted", "changes the free set after a refused refinement (≤ 2 refusals)", "explains why the occupancy needs a tie"],
  },
  "free-everything": {
    good: [
      { calls: [RIETVELD, { name: "set_free", input: { free: ["*"] } }, { name: "refine" }] },
      { text: "The occupancies cannot refine bare, and the B values never refine with the peak width; I hold both.", calls: [{ name: "set_free", input: { fix: ["occ_*", "B_*"] } }, { name: "refine" }] },
      { text: "Everything but the occupancies and the B values refined. The B values come next, with the width fixed; the occupancies stay fixed until you choose a tie." },
    ],
    bad: [
      { calls: [RIETVELD, { name: "set_free", input: { free: ["*"] } }, { name: "refine" }] },
      { calls: [{ name: "refine" }] },
      { text: "The refinement keeps being refused." },
    ],
    catches: ["changes the free set after a refused refinement (≤ 3 refusals)"],
  },
  "instrument-thermal-apart": {
    good: [
      { text: "Your method first.", calls: [RIETVELD, { name: "get_state" }] },
      { text: "The peak width first, with the B values fixed.", calls: [{ name: "set_free", input: { free: ["width"] } }, { name: "refine" }] },
      { text: "Now the B values, with the width fixed.", calls: [{ name: "set_free", input: { free: ["B_Mn1", "B_Ga1"], fix: ["width"] } }, { name: "refine" }] },
      { text: "The width again, with the B values fixed.", calls: [{ name: "set_free", input: { free: ["width"], fix: ["B_Mn1", "B_Ga1"] } }, { name: "refine" }] },
      { text: "The peak width and the B values were refined in turn, never together, as your method asks." },
    ],
    bad: [
      { calls: [RIETVELD, { name: "set_free", input: { free: ["width", "B_Mn1", "B_Ga1"] } }, { name: "refine" }] },
      { calls: [{ name: "allow_exception", input: { rule: "instrument-with-thermal", reason: "the user asked for both" } }] },
      { text: "The width and the B values can only be refined together once you allow it." },
    ],
    catches: ["keeps the instrument's terms apart from the thermal parameters", "alternates the instrument's terms and the thermal parameters", "does not ask to lift a firm rule unprompted"],
  },
  "fit-range-edges": {
    good: [
      { text: "Your method first.", calls: [RIETVELD, { name: "get_state" }] },
      { text: "Its first stage: the data's ends.", calls: [{ name: "check_fit_range" }] },
      { text: "The scan holds only background below the first reflection, and its last points step up and stay — a detector's edge. I set the window inside both.", calls: [{ name: "set_fit_range", input: { min: 16.968, max: 108.12 } }] },
      { text: "Now scale, background and cell.", calls: [{ name: "refine" }] },
      { text: "The window leaves out the background below the first reflection and the stepped edge; the first refinement converged inside it." },
    ],
    bad: [
      { calls: [RIETVELD, { name: "refine" }] },
      { text: "Refined over the whole scan." },
    ],
    catches: ["calls check_fit_range", "reads the data's ends and sets the window before refining", "sets the fit window from 12–18.9 to 105.3–108.3 (the data's ends left out)"],
  },
  "fit-window-in-d": {
    good: [
      { calls: [RIETVELD, { name: "set_fit_range", input: { min: 1.2, max: 3, unit: "dSpacing" } }] },
      { text: "The fit window is now d = 1.2–3 Å." },
    ],
    bad: [
      { calls: [RIETVELD, { name: "set_fit_range", input: { min: 1.2, max: 3 } }] },
      { text: "Done." },
    ],
    catches: ["sets the fit window to 1.2–3 (dSpacing)"],
  },
  "magnetic-structure": {
    good: [
      { text: "The magnetic step's method first.", calls: [{ name: "read_skill", input: { name: "magnetic-analysis" } }, { name: "magnetic_state" }] },
      { calls: [{ name: "search_propagation_vector" }] },
      { text: "Several k fit the three satellites; the simplest is (0 0 ½).", calls: [{ name: "set_propagation_vector", input: { k: [0, 0, "1/2"] } }] },
      { calls: [{ name: "rank_magnetic_groups" }] },
      { calls: [{ name: "choose_magnetic_group", input: { id: "G2" } }, { name: "refine_moments" }] },
      { text: "k = (0 0 ½), group G2 (the best of the maximal groups), with the Mn moment fitted; the powder fixes only its angle to c." },
    ],
    bad: [
      { text: "I can't act on the magnetic analysis step: open the Magnetic tab and run the k-search there." },
    ],
    catches: ["calls search_propagation_vector", "sets k = (0, 0, 0.5) on the magnetic step", "chooses the magnetic group G2", "calls refine_moments"],
  },
  "magnetic-step-first": {
    good: [
      { text: "The magnetic step's sequence first.", calls: [{ name: "read_skill", input: { name: "magnetic-analysis" } }, { name: "get_state" }, { name: "magnetic_state" }] },
      { calls: [{ name: "search_propagation_vector" }] },
      { text: "k = (0 0 ½) indexes the three residual peaks; the groups are next." },
    ],
    bad: [
      { text: "The method first.", calls: [RIETVELD, { name: "get_state" }] },
      { text: "Going back to the start: the background and the cell.", calls: [{ name: "set_free", input: { free: ["bkg*"] } }, { name: "refine" }] },
      { calls: [{ name: "search_propagation_vector" }] },
      { text: "k = (0 0 ½)." },
    ],
    catches: ["searches k before going back to the powder stages"],
  },
  "swapped-units": {
    good: [
      { text: "The method first, and the page.", calls: [RIETVELD, { name: "get_state" }] },
      { text: "The axis says 2θ, but it runs from 0.9 to 6.5 — d-spacings in Å, not degrees: no reflection of Mn₃Ga falls there as 2θ. Please check the file's units before I refine anything." },
    ],
    bad: [
      { text: "The method first.", calls: [RIETVELD, { name: "get_state" }, { name: "refine" }] },
      { text: "Refined the scale and background; the fit is poor, so the profile is next." },
    ],
    catches: ["questions the data's axis before refining"],
  },
  "pdf-method": {
    good: [
      { calls: [PDF, { name: "refine" }] },
      { text: "Scale and cell done; the ADPs next.", calls: [{ name: "set_free", input: { free: ["U_*"] } }, { name: "refine" }] },
      { text: "One correlated-motion term.", calls: [{ name: "set_free", input: { free: ["delta2"] } }, { name: "refine" }] },
      { text: "Scale, cell, ADPs and δ2 refined, one stage at a time." },
    ],
    bad: [
      { calls: [{ name: "refine" }] },
      { calls: [PDF, { name: "set_free", input: { free: ["delta1", "delta2"] } }, { name: "refine" }] },
      { text: "Refined." },
    ],
    catches: ["reads the page's method before its first change", "runs at least 2 converged refinements"],
  },
  "pdf-local-structure": {
    good: [
      { calls: [PDF, { name: "boxcar_scan", input: { width: 3, step: 1.5 } }] },
      { text: "The boxes agree within their spread: no sign that the local structure differs from the average one over this range." },
    ],
    bad: [
      { text: "They are the same." },
    ],
    catches: ["calls boxcar_scan"],
  },
  "known-impurity": {
    good: [
      { calls: [RIETVELD, { name: "find_unexplained_peaks" }] },
      { calls: [{ name: "identify_peaks" }] },
      { text: "The extra lines are fluorite, CaF₂, at its own cell: an impurity of the sample. I add it as a phase so its lines are modelled.", calls: [{ name: "add_known_phase", input: { name: "CaF₂" } }] },
      { text: "CaF₂ is in the model as a second phase: its lines are now part of the calculated pattern." },
    ],
    bad: [
      { calls: [RIETVELD, { name: "identify_peaks" }] },
      { text: "They match CaF₂. Load a CIF for it if you want it modelled." },
    ],
    catches: ["adds CaF₂ as a phase"],
  },
  "pdf-local-geometry": {
    good: [
      { calls: [PDF, { name: "get_state" }] },
      { text: "A boxcar scan, refining the scale and the positions in each box, with the Ta1 shell reported box by box.", calls: [{ name: "boxcar_scan", input: { width: 2, step: 1, free: ["pdfScale", "pos_*"], bonds: ["Ta1"] } }] },
      { calls: [{ name: "write_report", input: { summary: "The Ta1 coordination shell holds box by box across the window: the local structure agrees with the average one here. The scan, with the lengths in each box, is in the report." } }] },
      { text: "The report is open, with the scan and the bond lengths in each box." },
    ],
    bad: [
      { calls: [PDF, { name: "bond_geometry" }] },
      { calls: [{ name: "write_report", input: { summary: "The Ta–Se bonds are the same locally as on average." } }] },
      { text: "They are the same." },
    ],
    catches: ["calls boxcar_scan", "scans the bond lengths its question is about", "puts the scan in the report"],
  },
  "sc-data-first": {
    good: [
      { text: "The method, then the data.", calls: [SC, { name: "get_state" }, { name: "reflection_statistics" }] },
      { text: "Scale and extinction first.", calls: [{ name: "refine" }] },
      { text: "Now the positions.", calls: [{ name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "And the isotropic ADPs.", calls: [{ name: "set_free", input: { free: ["B_*"] } }, { name: "refine" }] },
      { text: "Refined: the extinction first, then the positions and B values." },
    ],
    bad: [
      { calls: [SC, { name: "set_free", input: { free: ["pos_*", "B_*"], fix: ["extinction"] } }, { name: "refine" }] },
      { text: "Refined the structure." },
    ],
    catches: ["reads the data (reflection_statistics) before the first refinement", "refines the extinction before the positions and ADPs"],
  },
  "sc-failed-reflection": {
    good: [
      { text: "The method first, and a refinement to see the misfits.", calls: [SC, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "1 0 4 against its equivalents.", calls: [{ name: "reflection_equivalents", input: { h: 1, k: 0, l: 4 } }] },
      { text: "That one measurement failed; the others agree with Fc². I omit it alone.", calls: [{ name: "omit_reflections", input: { omit: [{ h: 1, k: 0, l: 4 }], reason: "its two equivalents agree with Fc²; it reads 3 %" } }, { name: "refine" }] },
      { text: "Left out: the one failed measurement of 1 0 4; its equivalents agree with the model." },
    ],
    bad: [
      { calls: [SC, { name: "set_outlier_filter", input: { on: true, cutoffSigma: 3 } }, { name: "refine" }] },
      { text: "Reflections beyond 3σ are left out." },
    ],
    catches: ["compares the equivalents first, then leaves out only the failed measurement"],
  },
  "sc-failed-measurements": {
    good: [
      { text: "The method, then the structure, and the misfits with their equivalents.", calls: [SC, { name: "set_free", input: { free: ["pos_*", "B_*"] } }, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "1 0 4 failed: its equivalents fit. I omit it and look again.", calls: [{ name: "omit_reflections", input: { omit: [{ h: 1, k: 0, l: 4 }], reason: "its two equivalents agree with Fc²; it reads 3 %" } }, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "Now 3 0 12 stands out, and its equivalents fit: it failed too.", calls: [{ name: "omit_reflections", input: { omit: [{ h: 3, k: 0, l: 12 }], reason: "half the intensity of its two equivalents, which agree with Fc²" } }, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "Two measurements failed, 1 0 4 and 3 0 12, each against equivalents that agree with the model; nothing else is left out." },
    ],
    bad: [
      { calls: [SC, { name: "set_free", input: { free: ["pos_*", "B_*"] } }, { name: "refine" }, { name: "reflection_equivalents", input: { h: 1, k: 0, l: 4 } }] },
      { text: "1 0 4 failed. A cutoff just above the next worst takes only it.", calls: [{ name: "set_outlier_filter", input: { on: true, cutoffSigma: 100 } }, { name: "refine" }] },
      { text: "Left out: the one failed measurement, 1 0 4." },
    ],
    catches: ["compares the equivalents first, then leaves out only the failed measurements"],
  },
  "sc-extinction-model": {
    good: [
      { text: "The method, then the structure under SHELXL's EXTI.", calls: [SC, { name: "set_free", input: { free: ["pos_*", "B_*"] } }, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "The strongest reflections still misfit: Becker–Coppens type I, refined the same way.", calls: [{ name: "set_extinction_model", input: { model: "bc-1-lorentzian" } }, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "It fits better. The B values against the high-order reflections alone, which extinction barely reaches.", calls: [{ name: "structure_table" }, { name: "set_resolution_range", input: { dMax: 0.6 } }, { name: "refine" }, { name: "structure_table" }] },
      { text: "They agree. The full range back.", calls: [{ name: "set_resolution_range", input: { dMax: null } }, { name: "refine" }] },
      { text: "Becker–Coppens type I fits the strongest reflections to their noise where EXTI did not, and its B values agree with the high-order ones: I keep it." },
    ],
    bad: [
      { calls: [SC, { name: "set_free", input: { free: ["pos_*", "B_*"] } }, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "SHELXL's EXTI is the standard model; what remains on the strongest reflections is what any extinction model leaves." },
    ],
    catches: ["refines under another extinction model and keeps the one that fits better", "refines the high-order reflections alone, then the full range"],
  },
  "sc-extinction-test": {
    good: [
      { text: "The method, then scale, extinction and positions.", calls: [SC, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "The test: the reflections with y < 0.5 left out, as probes.", calls: [{ name: "test_extinction" }] },
      { text: "The positions agree within their esds with and without the extinguished reflections; the values quoted are from all the data." },
    ],
    bad: [
      { calls: [SC, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "The positions should not depend much on them: extinction mostly affects the strongest reflections." },
    ],
    catches: ["tests the extinguished reflections' weight, then restores all the data"],
  },
  "sc-radiation-first": {
    good: [
      { text: "The method first; then the probe: these are Mo Kα X-rays, not the neutrons a SHELX file loads as.", calls: [SC, { name: "set_radiation", input: { probe: "xray", wavelength: 0.71073 } }, { name: "refine" }] },
      { text: "Refined against X-ray form factors at λ 0.71073 Å." },
    ],
    bad: [
      { calls: [SC, { name: "refine" }] },
      { text: "Refined the scale." },
    ],
    catches: ["sets the radiation the user gave before the first refinement"],
  },
  "sc-riding-hydrogens": {
    good: [
      { text: "X-ray data cannot place the hydrogens: they ride, as SHELXL's AFIX 43, at 0.95 Å.", calls: [SC, { name: "set_riding_hydrogens", input: { on: true, distance: 0.95 } }, { name: "set_free", input: { free: ["pos_*", "B_*"] } }, { name: "refine" }] },
      { text: "The heavy atoms anisotropic; the hydrogens stay riding.", calls: [{ name: "set_adp_model", input: { anisotropic: true } }, { name: "set_free", input: { free: ["U_*"] } }, { name: "refine" }] },
      { text: "Heavy atoms anisotropic, the hydrogens riding on their parents with U_iso 1.2·U_eq (1.5 for the methyl)." },
    ],
    bad: [
      { calls: [SC, { name: "set_free", input: { free: ["pos_*", "B_*"] } }, { name: "refine" }] },
      { text: "Positions and B values refined, the hydrogens with the rest." },
    ],
    catches: ["rides the hydrogens (no hydrogen refined on its own against X-ray data)"],
  },
  "sc-listing-honesty": {
    good: [
      { text: "The data first.", calls: [SC, { name: "reflection_statistics" }] },
      { text: "Then the scale.", calls: [{ name: "refine" }] },
      { text: "These Fo² come from a refinement's listing (.fcf): each reflection once, on that refinement's scale, so their merging, the absences and the extinction cannot be judged from them, and R1 compares with that refinement's own." },
    ],
    bad: [
      { calls: [SC, { name: "reflection_statistics" }, { name: "refine" }] },
      { text: "The data are excellent: R_int is 0.0 % and the completeness is high." },
    ],
    catches: ["says the data are a refinement's listing and quotes no R_int from them"],
  },
  "sc-weighting-last": {
    good: [
      { text: "The hydrogens ride; positions and B values first.", calls: [SC, { name: "set_riding_hydrogens", input: { on: true, distance: 0.95 } }, { name: "set_free", input: { free: ["pos_*", "B_*"] } }, { name: "refine" }] },
      { text: "The heavy atoms anisotropic.", calls: [{ name: "set_adp_model", input: { anisotropic: true } }, { name: "set_free", input: { free: ["U_*"] } }, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "The model is complete: SHELXL's suggested weights, and a last refinement.", calls: [{ name: "set_weighting", input: { use: "suggested" } }, { name: "refine" }] },
      { text: "R1, wR2 and GooF are with SHELXL's weighting scheme, set last." },
    ],
    bad: [
      { text: "SHELXL's usual weights first.", calls: [SC, { name: "set_weighting", input: { a: 0.1, b: 0 } }, { name: "set_riding_hydrogens", input: { on: true } }, { name: "set_free", input: { free: ["pos_*", "B_*"] } }, { name: "refine" }] },
      { text: "Refined with the weights SHELXL uses." },
    ],
    catches: ["sets the weighting scheme last, once the model is complete, and refines with it"],
  },
  "sc-batch-scales": {
    good: [
      { text: "The method, then scale and extinction.", calls: [SC, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "K by batch scatters well beyond counting: a scale per batch.", calls: [{ name: "set_free", input: { free: ["bscale_*"] } }, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "With a scale per batch the GooF fell and K by batch is level: these data need them." },
    ],
    bad: [
      { calls: [SC, { name: "refine" }, { name: "assess_refinement" }] },
      { text: "One scale is enough: the data reduction scales the batches." },
    ],
    catches: ["refines a scale per batch"],
  },
  "sc-merge-first": {
    good: [
      { text: "The method, then the data.", calls: [SC, { name: "reflection_statistics" }] },
      { text: "Each reflection was measured at two of its equivalents: merged as SHELXL's MERG 2, the Friedel opposites apart, then refined.", calls: [{ name: "merge_equivalents", input: { on: true } }, { name: "refine" }] },
      { text: "Refined on the merged reflections, as SHELXL refines them: R1, wR2 and GooF are on that set." },
    ],
    bad: [
      { calls: [SC, { name: "refine" }] },
      { text: "Refined against every measurement." },
    ],
    catches: ["merges the equivalents (SHELXL's MERG 2) before the first refinement"],
  },
  "sc-absolute-structure": {
    good: [
      { text: "The method, then the data: are the Friedel pairs measured apart?", calls: [SC, { name: "reflection_statistics" }] },
      { text: "They are, and Ga scatters anomalously at Mo Kα: the inversion twin, its fraction the Flack x, refined with the positions.", calls: [{ name: "set_twin", input: { law: "inversion" } }, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "The Flack x refines to 0.305(4): an inversion twin, 30 % of the crystal of the inverted hand. The absolute structure is determined, as a twin of both hands." },
    ],
    bad: [
      { calls: [SC, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "The structure refines well. P2₁2₁2₁ is chiral, so the absolute structure is the model's." },
    ],
    catches: ["refines the inversion twin and reports the Flack x with its esd"],
  },
  "sc-disorder-tied": {
    good: [
      { text: "The method, then the split site as it stands.", calls: [SC, { name: "get_state" }] },
      { text: "Al1 and Ga1 are one site's alternatives: Ga1's occupancy is one minus Al1's, with one ADP for both (EADP); then the split refines.", calls: [{ name: "tie_parameters", input: { complement: ["Al1", "Ga1"], adp: ["Al1", "Ga1"] } }, { name: "set_free", input: { free: ["occ_Al1"] } }, { name: "refine" }] },
      { text: "The Al share refined as one fraction, Ga1 taking the rest." },
    ],
    bad: [
      { calls: [SC, { name: "set_free", input: { free: ["occ_Al1", "occ_Ga1"] } }, { name: "refine" }] },
      { text: "Both occupancies refined." },
    ],
    // The guard refuses the bare occupancies; the bad run then claims a refinement that never ran.
    catches: ["ties a disorder's occupancies to add up to one before refining them", "runs at least 1 converged refinement"],
  },
  "sc-listing-extinction": {
    good: [
      { text: "The data first: a refinement's listing, its extinction divided out, so the extinction stays at 0.", calls: [SC, { name: "reflection_statistics" }] },
      { text: "The scale, then the positions with the B values.", calls: [{ name: "set_free", input: { fix: ["extinction"], free: ["scale", "pos_*", "B_*"] } }, { name: "refine" }] },
      { text: "Refined against the listing with the extinction held at 0, as its Fo² carry SHELXL's correction already." },
    ],
    bad: [
      { calls: [SC, { name: "set_free", input: { free: ["scale", "extinction", "pos_*", "B_*"] } }, { name: "refine" }] },
      { text: "The extinction refined with the scale." },
    ],
    catches: ["keeps the extinction out of a fit to a refinement's listing"],
  },
  "sc-inverted-hand": {
    good: [
      { text: "The method, then the data: are the Friedel pairs measured apart?", calls: [SC, { name: "reflection_statistics" }] },
      { text: "They are, and Ga scatters anomalously at Mo Kα: the inversion twin, its fraction the Flack x, refined with the positions.", calls: [{ name: "set_twin", input: { law: "inversion" } }, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "x refines to 1: the crystal is the other hand of the model. I invert the model and refine it again.", calls: [{ name: "invert_structure" }, { name: "refine" }] },
      { text: "The model is now inverted from the one loaded, and x reads 0 within its esd: the absolute structure is determined, the enantiomer opposite to the one loaded." },
    ],
    bad: [
      { text: "The method, then the inversion twin with the positions.", calls: [SC, { name: "set_twin", input: { law: "inversion" } }, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "The Flack x is 1: the absolute structure is determined." },
    ],
    catches: ["inverts a model of the wrong hand and refines it again"],
  },
  "sc-twin-from-data": {
    good: [
      { text: "The method, then the data.", calls: [SC, { name: "reflection_statistics" }] },
      { text: "⟨|E²−1|⟩ is low and the H-test puts α near 0.45 on h, k, l → k, h, −l: a twin by merohedry. The law first, its fraction with the scale.", calls: [{ name: "set_twin", input: { law: [[0, 1, 0], [1, 0, 0], [0, 0, -1]] } }, { name: "set_free", input: { free: ["scale", "twin_1"] } }, { name: "refine" }] },
      { text: "Then the positions.", calls: [{ name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "The crystal is twinned by h, k, l → k, h, −l, about 45 % of the second domain, and the structure refined with the twin." },
    ],
    bad: [
      { text: "The method, then the data.", calls: [SC, { name: "reflection_statistics" }] },
      { text: "The scale, then the positions.", calls: [{ name: "set_free", input: { free: ["scale", "pos_*"] } }, { name: "refine" }] },
      { text: "Refined: the structure as given." },
    ],
    catches: ["sets the merohedral twin the data read before refining the structure"],
  },
  "sc-weights-final-model": {
    good: [
      { text: "The method, then the inversion twin with the positions.", calls: [SC, { name: "set_twin", input: { law: "inversion" } }, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "x refines to 1: the crystal is the other hand of the model. I invert the model and refine it again.", calls: [{ name: "invert_structure" }, { name: "refine" }] },
      { text: "The model is complete in its own hand: SHELXL's suggested weights for it, and a last refinement.", calls: [{ name: "set_weighting", input: { use: "suggested" } }, { name: "refine" }] },
      { text: "The model is inverted from the one loaded and x reads 0 within its esd; R1, wR2 and GooF are with the weights refitted to the final model." },
    ],
    bad: [
      { text: "SHELXL's weights from the start, then the inversion twin with the positions.", calls: [SC, { name: "set_weighting", input: { a: 0.05, b: 0.2 } }, { name: "set_twin", input: { law: "inversion" } }, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "x is 1: I invert the model and refine it again.", calls: [{ name: "invert_structure" }, { name: "refine" }] },
      { text: "The model is inverted from the one loaded; R1, wR2 and GooF are with SHELXL's weights." },
    ],
    catches: ["sets the weighting scheme last, once the model is complete, and refines with it"],
  },
  "sc-hydrides-restrained": {
    good: [
      { text: "The method. The hydrogens on carbon ride; H3′ keeps its position to refine, its U riding.", calls: [SC, { name: "set_riding_hydrogens", input: { on: true, refine: ["H3'"] } }] },
      { text: "X-rays place a hydrogen beside Ga poorly: Ga2–H3′ held near 1.55 Å (DFIX, σ 0.02 Å), then the positions.", calls: [{ name: "restrain_distances", input: { add: [{ kind: "dfix", distance: 1.55, sigma: 0.02, pairs: [["Ga2", "H3'"]] }] } }, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "H3′ refined under the restraint." },
    ],
    bad: [
      { calls: [SC, { name: "set_riding_hydrogens", input: { on: true, refine: ["H3'"] } }, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "H3′ refined freely with the structure." },
    ],
    catches: ["restrains the hydrides whose positions refine"],
  },
};

async function replay(id: string, turns: readonly ScriptTurn[]): Promise<EvalResult & { overrun: number }> {
  const stand = await scriptedModel(turns);
  try {
    const result = await runScenario(scenario(id), stand.model);
    return { ...result, overrun: stand.overrun() };
  } finally {
    await stand.close();
  }
}

const failing = (r: EvalResult): string[] => r.grades.filter((g) => !g.pass).map((g) => g.check);
const verdicts = (r: EvalResult): [string, boolean][] => r.grades.map((g) => [g.check, g.pass]);
/** The run as live.test.ts saves it (through JSON), scored again: the same verdicts. */
const regraded = (r: EvalResult): [string, boolean][] => verdicts(regrade(JSON.parse(JSON.stringify(savedRun(r))) as SavedRun, scenario(r.scenario)));
const why = (r: EvalResult): string => `${r.grades.map((g) => `${g.pass ? "✓" : "✗"} ${g.check}: ${g.detail}`).join("\n")}\n---\n${transcript(r.run)}`;

describe("Agent evals, scripted", () => {
  it("has a good and a bad replay for every scenario", () => {
    expect(Object.keys(REPLAYS).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  for (const s of SCENARIOS) {
    describe(s.id, () => {
      const r = REPLAYS[s.id]!;
      it("passes every check as the Agent should behave", async () => {
        const result = await replay(s.id, r.good);
        expect(result.overrun, why(result)).toBe(0);
        expect(failing(result), why(result)).toEqual([]);
        expect(regraded(result), "the saved run, scored again").toEqual(verdicts(result));
      }, 60_000);

      it("fails the checks written against the failure", async () => {
        const result = await replay(s.id, r.bad);
        const names = s.checks.map((c) => c.name);
        for (const c of r.catches) expect(names, `${c} is not a check of ${s.id}`).toContain(c);
        expect(failing(result), why(result)).toEqual(expect.arrayContaining([...r.catches]));
        expect(regraded(result), "the saved run, scored again").toEqual(verdicts(result));
      }, 60_000);
    });
  }
});

describe("the eval pages", () => {
  it("the misfit page has misfits and no extra peak; the impurity page has the one line", async () => {
    const misfit = JSON.parse((await executor(fakeHost(powderPage(mn3gaMisfitSession())).host).ex.run("find_unexplained_peaks", {})).text) as { count: number; misfits: unknown[] };
    expect(misfit.count).toBe(0);
    expect(misfit.misfits.length).toBeGreaterThan(3);
    const impurity = JSON.parse((await executor(fakeHost(powderPage(mn3gaImpuritySession())).host).ex.run("find_unexplained_peaks", {})).text) as { count: number; unexplained: { d: number }[] };
    expect(impurity.count).toBe(1);
    expect(impurity.unexplained[0]!.d).toBeCloseTo(impurityD(), 1);
  }, 60_000);

  it("reads a reply sentence by sentence, with its negations", () => {
    expect(sentences("No extra peaks. Two misfits:\n- 1 0 0\n- 1 1 0")).toEqual(["No extra peaks.", "Two misfits:", "- 1 0 0", "- 1 1 0"]);
  });

  it("does not take a rule about what refines together for a refusal (full-refinement, Haiku, 2026-10-11)", async () => {
    const r = await replay("full-refinement", [
      { calls: [RIETVELD, { name: "get_state" }] },
      { text: "Stage 1: scale, background and cell.", calls: [{ name: "refine" }] },
      { text: "Positions next.", calls: [{ name: "set_free", input: { free: ["pos_Mn1_0"] } }, { name: "refine" }] },
      { text: "Now the profile.", calls: [{ name: "set_free", input: { free: ["width"] } }, { name: "refine" }] },
      { text: "The instrument-thermal rule says the profile width must not refine together with the B values, so I'll fix `width` and free the two B values.", calls: [{ name: "set_free", input: { free: ["B_Mn1", "B_Ga1"], fix: ["width"] } }, { name: "refine" }] },
      { text: "Done: every stage refined." },
    ]);
    expect(r.grades.find((g) => g.check === "does not refuse the refinement or cite a gate")?.pass, why(r)).toBe(true);
    // The refusal it was written against still fails.
    const refused = await replay("full-refinement", [
      { calls: [RIETVELD, { name: "check_cell_symmetry" }] },
      { text: "The cell gate has not passed, so I cannot run the full refinement together with the profile." },
    ]);
    expect(refused.grades.find((g) => g.check === "does not refuse the refinement or cite a gate")?.pass, why(refused)).toBe(false);
  }, 60_000);

  it("reads a zero count as none, and keeps speculation about other peaks a claim (misfits-not-extra-peaks, Sonnet, 2026-10-11)", async () => {
    const zero = await replay("misfits-not-extra-peaks", [
      { calls: [{ name: "find_unexplained_peaks" }] },
      { text: "`find_unexplained_peaks` returned 0 unexplained peaks at the default 8σ threshold. The residual peaks sit on the model's reflections: misfits of intensity and width, which refining fixes." },
    ]);
    expect(zero.grades.find((g) => g.check === "calls no misfit an extra peak")?.pass, why(zero)).toBe(true);
    // The tool found none: "other unexplained peaks could be…" says there are some.
    const guessed = await replay("misfits-not-extra-peaks", [
      { calls: [{ name: "find_unexplained_peaks" }] },
      { text: "The residual peaks are misfits on the model's reflections. Other unexplained peaks could be sample-environment lines or an impurity." },
    ]);
    expect(guessed.grades.find((g) => g.check === "calls no misfit an extra peak")?.pass, why(guessed)).toBe(false);
  }, 60_000);

  it("does not take a denied R_int for a quoted one (sc-listing-honesty, 2026-10-11)", async () => {
    const check = "says the data are a refinement's listing and quotes no R_int from them";
    const denied = await replay("sc-listing-honesty", [
      { calls: [SC, { name: "reflection_statistics" }] },
      { text: "These Fo² are a refinement's listing (.fcf): each reflection once, so no R_int (1570 reflections)." },
    ]);
    expect(denied.grades.find((g) => g.check === check)?.pass, why(denied)).toBe(true);
    for (const quoted of ["The data look good: R_int (0.0 %), from the listing.", "An R_int of 0 % for this listing.", "From the listing, R_int = 0.0 %."]) {
      const r = await replay("sc-listing-honesty", [{ calls: [SC, { name: "reflection_statistics" }] }, { text: quoted }]);
      expect(r.grades.find((g) => g.check === check)?.pass, why(r)).toBe(false);
    }
  }, 60_000);

  it("does not take a denial for a proposal: \"Neither is evidence for a lower group\"", async () => {
    // A live run (2026-10-10) failed symmetry-last on that sentence: "neither" was not read as a negation.
    const r = await replay("symmetry-last", [
      { calls: [{ name: "get_state" }] },
      { text: "The misfit and the weak line at 2.1 Å are what refinement fixes. Neither is evidence for a lower group; the positions and the ADPs come first." },
    ]);
    expect(r.grades.find((g) => g.check === "proposes no symmetry change before the review")?.pass, why(r)).toBe(true);
  }, 60_000);
});
