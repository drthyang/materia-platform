import { describe, it, expect } from "vitest";
import { SCENARIOS, scenario } from "@/agent/evals/scenarios";
import { runScenario, transcript, type EvalResult } from "@/agent/evals/harness";
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
      { calls: [RIETVELD, { name: "get_state" }] },
      { text: "Scale, background and cell first.", calls: [{ name: "refine" }] },
      // A first account with a number of its own; the answer underlines it, and the Agent takes it out.
      { calls: [{ name: "write_report", input: { summary: "Scale, background and cell refined to convergence; the cell is a = 7.65432 Å." } }] },
      { calls: [{ name: "write_report", input: { summary: "Scale, background and cell refined to convergence in one refinement. The report lists the checks; the atoms, the profile and the ADPs are the next stages." } }] },
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
      { text: "That one measurement failed; the others agree with Fc². A cutoff just above the next worst takes only it.", calls: [{ name: "set_outlier_filter", input: { on: true, cutoffSigma: 100 } }, { name: "refine" }] },
      { text: "Left out: the one failed measurement of 1 0 4; its equivalents agree with the model." },
    ],
    bad: [
      { calls: [SC, { name: "set_outlier_filter", input: { on: true, cutoffSigma: 3 } }, { name: "refine" }] },
      { text: "Reflections beyond 3σ are left out." },
    ],
    catches: ["compares the equivalents first, then leaves out only the failed measurement"],
  },
  "sc-extinction-test": {
    good: [
      { text: "The method, then scale, extinction and positions.", calls: [SC, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "The test: the reflections with y < 0.5 left out.", calls: [{ name: "set_outlier_filter", input: { on: true, cutoffSigma: 1000, minExtinction: 0.5 } }, { name: "refine" }, { name: "structure_table" }] },
      { text: "Back to all the data.", calls: [{ name: "set_outlier_filter", input: { minExtinction: null } }, { name: "refine" }, { name: "structure_table" }] },
      { text: "The positions agree within their esds with and without the extinguished reflections; the values quoted are from all the data." },
    ],
    bad: [
      { calls: [SC, { name: "set_free", input: { free: ["pos_*"] } }, { name: "refine" }] },
      { text: "The positions should not depend much on them: extinction mostly affects the strongest reflections." },
    ],
    catches: ["tests the extinguished reflections' weight, then restores all the data"],
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
      }, 60_000);

      it("fails the checks written against the failure", async () => {
        const result = await replay(s.id, r.bad);
        const names = s.checks.map((c) => c.name);
        for (const c of r.catches) expect(names, `${c} is not a check of ${s.id}`).toContain(c);
        expect(failing(result), why(result)).toEqual(expect.arrayContaining([...r.catches]));
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

  it("does not take a denial for a proposal: \"Neither is evidence for a lower group\"", async () => {
    // A live run (2026-10-10) failed symmetry-last on that sentence: "neither" was not read as a negation.
    const r = await replay("symmetry-last", [
      { calls: [{ name: "get_state" }] },
      { text: "The misfit and the weak line at 2.1 Å are what refinement fixes. Neither is evidence for a lower group; the positions and the ADPs come first." },
    ]);
    expect(r.grades.find((g) => g.check === "proposes no symmetry change before the review")?.pass, why(r)).toBe(true);
  }, 60_000);
});
