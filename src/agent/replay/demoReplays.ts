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
  /** The page it plays on: a bundled demo, or the single-crystal page loaded from files. */
  readonly page: "rietveld" | "pdf" | "single-crystal";
  /** The user's message (the scenario's first). */
  readonly message: string;
  readonly turns: readonly ScriptTurn[];
}

const RIETVELD = { name: "read_skill", input: { name: "my-rietveld-workflow" } };
const PDF = { name: "read_skill", input: { name: "pdf-workflow" } };
const SC = { name: "read_skill", input: { name: "sc-workflow" } };

export const DEMO_REPLAYS: Readonly<Record<string, DemoReplay>> = {
  "full-refinement": {
    page: "rietveld",
    message: "Run the full refinement to improve the quality of the fit.",
    turns: [
      { text: "First your method.", calls: [RIETVELD, { name: "get_state" }] },
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
};
