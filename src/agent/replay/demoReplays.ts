/**
 * Good replays of three eval scenarios, one per kind of page, which the dev
 * server plays into the Agent drawer (`?agentReplay=<id>`, replay/server.ts)
 * for the dock's screenshots. Each is written for the page it plays on in the
 * app (the bundled Mn₃Ga TOF and GaTa₄Se₈ PDF demos, the suite's corundum
 * crystal), and replay.test.ts plays it there in CI against its scenario's
 * checks, so a replay shown is one known to pass them. Plain data: the dev
 * server imports it without the "@/" alias.
 */

import type { ScriptTurn } from "./sse";

export interface DemoReplay {
  /** The page it plays on: a bundled demo, or a page loaded from files (single crystal; the Mn₃Ga 30 K powder files in examples/mcp). */
  readonly page: "rietveld" | "pdf" | "single-crystal" | "mn3ga-30k";
  /** The user's message (the scenario's first). */
  readonly message: string;
  readonly turns: readonly ScriptTurn[];
  /** Calls the run is meant to have refused: a guardrail the replay shows at work (replay.test checks each is refused, and nothing else fails). */
  readonly refusals?: readonly string[];
}

const RIETVELD = { name: "read_skill", input: { name: "my-rietveld-workflow" } };
const PDF = { name: "read_skill", input: { name: "pdf-workflow" } };
const SC = { name: "read_skill", input: { name: "sc-workflow" } };
const MAGNETIC = { name: "read_skill", input: { name: "magnetic-analysis" } };

export const DEMO_REPLAYS: Readonly<Record<string, DemoReplay>> = {
  "full-refinement": {
    page: "rietveld",
    message: "Run the full refinement to improve the quality of the fit.",
    turns: [
      { text: "First the workflow skill.", calls: [RIETVELD, { name: "get_state" }] },
      { text: "Stage 1: scale, background and cell.", calls: [{ name: "refine" }] },
      { text: "Positions next.", calls: [{ name: "set_free", input: { free: ["p0_pos_Mn1_0"] } }, { name: "refine" }] },
      { text: "Now the profile, with the position fixed.", calls: [{ name: "set_free", input: { free: ["tof_sig2"], fix: ["p0_pos_Mn1_0"] } }, { name: "refine" }] },
      { text: "Then the ADPs, with the peak width fixed.", calls: [{ name: "set_free", input: { free: ["p0_B_Mn1", "p0_B_Ga1"], fix: ["tof_sig2"] } }, { name: "refine" }] },
      { text: "Done: scale, background, cell, the Mn position, the peak width and both B_iso of Mn₃Ga refined.\n\nThe fit improved at every stage; the residual is in the pattern, and the refined values with their esds are in the parameters." },
    ],
  },
  "pdf-local-geometry": {
    page: "pdf",
    message: "Is the Ta coordination the same locally as on average? Write the report when you are done.",
    turns: [
      { calls: [PDF, { name: "get_state" }] },
      { text: "A boxcar scan, refining the scale and the positions in each box, with the Ta1 shell reported box by box.", calls: [{ name: "boxcar_scan", input: { width: 2, step: 1, free: ["pdfScale", "pos_*"], bonds: ["Ta1"] } }] },
      { calls: [{ name: "write_report", input: { summary: "The Ta1 coordination shell holds box by box across the window: the local structure agrees with the average one here. The scan, with the lengths in each box, is in the report." } }] },
      { text: "The report is open, with the scan and the bond lengths in each box." },
    ],
  },
  "sc-data-first": {
    page: "single-crystal",
    message: "Refine this crystal structure properly and report the result.",
    turns: [
      { text: "The method, then the data.", calls: [SC, { name: "get_state" }, { name: "reflection_statistics" }] },
      { text: "Scale and extinction first.", calls: [{ name: "refine" }] },
      { text: "Now the positions.", calls: [{ name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "And the isotropic ADPs.", calls: [{ name: "set_free", input: { free: ["B_*"] } }, { name: "refine" }] },
      { text: "Refined: the extinction first, then the positions and B values." },
    ],
  },
  "magnetic-30k": {
    page: "mn3ga-30k",
    // The method gate refusing a symmetry review asked for too early.
    refusals: ["review_symmetry"],
    message: "Fit this 30 K neutron pattern. If the nuclear model leaves intensity unexplained, find the magnetic order.",
    turns: [
      { text: "First the Rietveld workflow skill, then where the page stands.", calls: [RIETVELD, { name: "get_state" }] },
      { text: "Scale, background and cell are free; I'll add the peak widths (U, V, W) and hold the atoms. If this is k = 0 order, magnetic intensity sits on the nuclear lines, and free positions would soak it up.", calls: [{ name: "set_free", input: { free: ["profU", "profV", "profW"] } }, { name: "refine" }] },
      { text: "wR {{wR}}, GoF {{GoF}}, with misfits on allowed reflections at large d. Is the space group too symmetric? A symmetry review.", calls: [{ name: "review_symmetry" }] },
      { text: "Refused by the workflow skill's gate: the space group is questioned last, and misfit on the group's own reflections is not evidence against it. What does the residual leave?", calls: [{ name: "find_unexplained_peaks" }] },
      { text: "No extra peaks, but strong misfits on nuclear lines at large d (111, 201, 101): on a neutron pattern of Mn, that is the k = 0 magnetic signature. The magnetic-analysis skill first.", calls: [MAGNETIC] },
      { text: "The magnetic-analysis skill, for k = 0 with no pattern above the ordering temperature: this nuclear fit took magnetic intensity into its scale. Refitting the nuclear model where the Mn form factor has faded, d ≤ 1.5 Å.", calls: [{ name: "set_fit_range", input: { max: 1.5, unit: "dSpacing" } }, { name: "refine" }] },
      { text: "wR {{wR}} at high angle: that is the nuclear reference the moments will be measured against. The whole pattern back.", calls: [{ name: "set_fit_range", input: { whole: true } }] },
      { text: "Step 1, the propagation vector. First the peaks the nuclear model leaves.", calls: [{ name: "magnetic_state" }] },
      { text: "A k-search on the three strongest misfits: 101, 111 and 201.", calls: [{ name: "search_propagation_vector", input: { include: [1, 3, 4] } }] },
      { text: "Five vectors explain all three peaks; k = 0 fits closest and needs no supercell. Setting it, and saying k is not unique.", calls: [{ name: "set_propagation_vector", input: { k: ["0", "0", "0"] } }] },
      { text: "Step 2, the symmetry analysis: the moments sit on the three Mn sites, and the magnetic space groups of the little group of k follow from them.", calls: [{ name: "select_magnetic_ions", input: { sites: ["Mn1_0", "Mn2_1", "Mn3_2"] } }, { name: "magnetic_state" }] },
      { text: "Eleven magnetic space groups allow a moment on Mn; four are maximal (index 2). Step 3: rank them top-down, each fitted from 12 restarts.", calls: [{ name: "rank_magnetic_groups" }] },
      { text: "P2₁′/m′ (G4) reaches 5.04 %, against 9.6–12.5 % for the other three; Hamilton's test keeps G4 alone, beyond the noise. Choosing it.", calls: [{ name: "choose_magnetic_group", input: { id: "G4" } }] },
      { text: "Step 4, the moments refined properly: handed to the refinement, with the scale, background, cell and profile held at the high-angle reference, so only the six moment amplitudes are free.", calls: [{ name: "continue_magnetic_refinement" }, { name: "set_free", input: { fix: ["scale", "bkg*", "cell_*", "profU", "profV", "profW"] } }, { name: "refine" }] },
      { text: "wR {{wR}}, GoF {{GoF}}. Checking the fit before quoting it.", calls: [{ name: "assess_refinement" }] },
      { text: "Converged, every shift under a tenth of its esd. |M| is 2.15–2.83 µB on the three Mn sites, below the spin-only 5 µB; two moment pairs correlate at −0.86, under the 0.95 limit, so they are reported with their coefficients. The report.", calls: [{ name: "write_report", input: { summary: "The 30 K pattern orders at k = 0 in P2₁′/m′, with moments in the ac plane on all three Mn sites (|M| 2.15–2.83 µB). Of the four maximal groups only this one fits within the noise. The moments were refined alone against the nuclear model refined at d ≤ 1.5 Å, where the Mn form factor has faded, so the nuclear scale did not take the magnetic intensity on the nuclear lines." } }] },
      { text: "Magnetic order: k = 0, P2₁′/m′, moments in the ac plane on all three Mn sites ({{p:mom_Mn1_0_0}}, {{p:mom_Mn1_0_1}} on Mn1). wR {{wR}}, GoF {{GoF}}, with only the moments free against the high-angle nuclear model. The report is open." },
    ],
  },
};
