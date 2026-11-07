import { describe, expect, it } from "vitest";
import { flackReading } from "@/agent/scTools";
import { refinesFlack } from "@/agent/evals/checks";
import type { EvalRun } from "@/agent/evals/harness";

/** Readings and graders checked on small cases: the Flack x outside [0, 1] (flackUnbounded.test.ts), and what the eval checks accept. */
describe("reading and grading an x outside [0, 1]", () => {
  it("says an x below 0 by more than 2u is unphysical, and an x within 2u of 0 is the model's hand", () => {
    expect(flackReading(-0.12, 0.03, "Ga f″ 1.6 e")).toMatch(/below 0 by more than 2u.*systematic error/);
    expect(flackReading(1.15, 0.03, "Ga f″ 1.6 e")).toMatch(/above 1 by more than 2u.*inverted one/);
    expect(flackReading(-0.04, 0.03, "Ga f″ 1.6 e")).toMatch(/^the model's hand/);
    expect(flackReading(0.3, 0.03, "Ga f″ 1.6 e")).toMatch(/inversion twin/);
  });

  it("grades a reported negative x with its sign", () => {
    const run = (reply: string): EvalRun => ({
      events: [
        { kind: "call", name: "set_twin", input: { law: "inversion" }, isError: false, text: "{}" },
        { kind: "call", name: "refine", input: {}, isError: false, text: JSON.stringify({ refined: true }), free: ["scale", "twin_1"] },
        { kind: "reply", text: reply },
      ],
      port: { state: () => ({ dataset: {}, result: { parameters: { twin_1: -0.04 }, esd: { twin_1: 0.02 } } }) },
    }) as unknown as EvalRun;
    expect(refinesFlack.grade(run("The Flack x is −0.04(2).")).pass).toBe(true);
    expect(refinesFlack.grade(run("The Flack x is -0.04(2).")).pass).toBe(true);
    // Its magnitude with the sign dropped is a different value.
    expect(refinesFlack.grade(run("The Flack x is 0.04(2).")).pass).toBe(false);
  });
});

describe("mentionsD", () => {
  it("counts a d-spacing, not any number within the tolerance", async () => {
    const { mentionsD } = await import("@/agent/evals/checks");
    const run = (reply: string): EvalRun => ({ events: [{ kind: "reply", text: reply }] }) as unknown as EvalRun;
    const check = mentionsD(2.31, 0.03);
    expect(check.grade(run("An extra line at d = 2.312 Å, from Cr₂O₃.")).pass).toBe(true);
    expect(check.grade(run("An extra peak, 2.30 Å, unindexed.")).pass).toBe(true);
    expect(check.grade(run("The d-spacing of the unindexed peak is 2.33.")).pass).toBe(true);
    // A GoF, an R in %, an angle or a B in Å² near 2.31 is not the line.
    expect(check.grade(run("GoF 2.30 and wR 2.29 %, B = 2.31 Å², at 2θ 2.32°.")).pass).toBe(false);
  });
});

describe("comparesExtinctionModels", () => {
  const refine = (wR2: number) => ({ kind: "call", name: "refine", input: {}, isError: false, text: JSON.stringify({ refined: true, wR2 }), free: ["scale", "extinction", "B_O1"] });
  const run = (events: unknown[], model: string): EvalRun => ({ events, port: { state: () => ({ dataset: {}, extinctionModel: model }) } }) as unknown as EvalRun;
  const setModel = { kind: "call", name: "set_extinction_model", input: { model: "bc-1-lorentzian" }, isError: false, text: "{}" };

  it("compares the wR2s of refinements under the same conditions only", async () => {
    const { comparesExtinctionModels } = await import("@/agent/evals/checks");
    // Same data, weights and free set: a fair comparison, the better kept.
    expect(comparesExtinctionModels.grade(run([refine(5.1), setModel, refine(4.2)], "bc-1-lorentzian")).pass).toBe(true);
    // The high order alone under EXTI, the full range under Becker–Coppens: the wR2s do not compare.
    const cut = { kind: "call", name: "set_resolution_range", input: { dMax: 1 }, isError: false, text: "{}" };
    const back = { kind: "call", name: "set_resolution_range", input: { dMax: null }, isError: false, text: "{}" };
    const verdict = comparesExtinctionModels.grade(run([cut, refine(3.0), back, setModel, refine(4.2)], "shelx"));
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toMatch(/never under the same data/);
  });
});

describe("the free set an eval records for a call", () => {
  it("is what a boxcar_scan given `free` fits, not the page's set", async () => {
    const { freeAtCall } = await import("@/agent/evals/harness");
    const row = (id: string, fixed: boolean, expression?: string) => ({ id, label: id, kind: "bIso" as const, value: 1, initialValue: 1, fixed, ...(expression ? { expression } : {}) });
    const params = [row("scale", false), row("delta2", false), row("x_Ga1", true), row("x_Se1", true), row("x_Se2", true, "= x_Se1")];
    expect(freeAtCall("boxcar_scan", { free: ["x_*"] }, params)).toEqual(["x_Ga1", "x_Se1"]);
    expect(freeAtCall("boxcar_scan", {}, params)).toEqual(["scale", "delta2"]);
    expect(freeAtCall("refine", { free: ["x_*"] }, params)).toEqual(["scale", "delta2"]);
    expect(freeAtCall("get_state", {}, params)).toBeUndefined();
  });
});

describe("magneticGroupIs", () => {
  it("counts a group indistinguishable by powder from the truth (the ★'s exact twin), not one merely within the noise (THY-58)", async () => {
    const { magneticGroupIs } = await import("@/agent/evals/checks");
    const run = (chosen: string, best: string, powderTwins: string[]): EvalRun =>
      ({ events: [], port: { magnetic: () => ({ state: () => ({ selected: { id: chosen }, best, powderTwins }) }) } }) as unknown as EvalRun;
    const check = magneticGroupIs("G1");
    expect(check.grade(run("G1", "G1", ["G3"])).pass).toBe(true);
    expect(check.grade(run("G3", "G1", ["G3"])).pass).toBe(true);
    expect(check.grade(run("G3", "G3", ["G1"])).pass).toBe(true);
    // Within the noise but a different pattern, or no ranking: only the truth counts.
    expect(check.grade(run("G3", "G1", [])).pass).toBe(false);
    expect(check.grade(run("G2", "G1", ["G3"])).pass).toBe(false);
  });
});

describe("doesNotRefuse", () => {
  const refined = { kind: "call", name: "refine", input: {}, isError: false, text: JSON.stringify({ refined: true }), free: ["scale", "width"] };
  const cellCheck = { kind: "call", name: "check_cell_symmetry", input: {}, isError: false, text: "{}" };
  const run = (events: unknown[]): EvalRun => ({ events }) as unknown as EvalRun;
  const reply = (text: string) => ({ kind: "reply", text });
  // Sonnet's last reply on full-refinement, 2026-11-03 (v0.5.0 gate, run 1), after every stage had refined: its last bullets, verbatim.
  const sonnet = [
    "- **Corrections:** I added none, because the residual shows no signature for one.",
    "- **Cross-check:** the method asks for a GSAS-II and FullProf cross-check, which I can't run. You can write both bundles from the Export menu.",
  ].join("\n");

  it("does not count an external cross-check it cannot run as a refusal, once the refinement ran", async () => {
    const { doesNotRefuse } = await import("@/agent/evals/checks");
    expect(doesNotRefuse.grade(run([refined, reply(sonnet)])).pass).toBe(true);
    expect(doesNotRefuse.grade(run([refined, reply("I can't run TOPAS here, so the cross-check is yours.")])).pass).toBe(true);
  });

  it("still counts a refusal of the refinement, whatever external program it names", async () => {
    const { doesNotRefuse } = await import("@/agent/evals/checks");
    // No refinement ran: the explained limit is the whole answer.
    expect(doesNotRefuse.grade(run([cellCheck, reply(sonnet)])).pass).toBe(false);
    // The refusal the check was written against (user report, 2026-10-10).
    expect(doesNotRefuse.grade(run([cellCheck, reply("The cell check flags an absence, so I can't run the full refinement yet.")])).pass).toBe(false);
    // A refinement ran, but the reply refuses the next one, citing an external check or a gate.
    expect(doesNotRefuse.grade(run([refined, reply("I can't refine the positions until a GSAS-II cross-check confirms the cell.")])).pass).toBe(false);
    expect(doesNotRefuse.grade(run([refined, reply("I won't continue: the FullProf cross-check comes first.")])).pass).toBe(false);
    expect(doesNotRefuse.grade(run([refined, reply("The Le Bail gate has not passed, so I cannot run the FullProf cross-check or refine further.")])).pass).toBe(false);
  });
});

describe("noStall", () => {
  const run = (events: unknown[]): EvalRun => ({ events }) as unknown as EvalRun;
  const reply = (text: string) => ({ kind: "reply", text });
  const asked = (isError = false) => ({
    kind: "call", name: "ask_user", isError,
    input: { question: "Apply the suggested fit window of 16.32–117.624° 2θ (trimming background-only low-angle points and the edge-cut high-angle end), and then run the cell check?" },
    text: isError ? "Error: options: at least 2" : JSON.stringify({ ref: "#3", asked: true, options: 2, note: "Shown to the user; your turn ends here. Their answer comes as their next message: an option's message, or their own words." }),
  });
  // Haiku's reply on symmetry-last, 2026-11-03 (v0.5.0 gate, run 3): its last paragraph, verbatim, then ask_user.
  const haiku = "Proposed window: 16.32–117.624° 2θ (d ≈ 5.43 to 0.90 Å). After that come the cell check, then the staged refinement. I'll refine each block to convergence and check it before moving on.";

  it("accepts a reply that ends the turn with a question put to the user", async () => {
    const { noStall } = await import("@/agent/evals/checks");
    const v = noStall.grade(run([reply(haiku), asked()]));
    expect(v.pass).toBe(true);
    expect(v.detail).toBe("ended asking the user");
    // An empty reply between them (the turn's last stream) changes nothing.
    expect(noStall.grade(run([reply(haiku), asked(), reply("")])).pass).toBe(true);
  });

  it("still catches a turn that ends on a promise to act", async () => {
    const { noStall } = await import("@/agent/evals/checks");
    // The same reply with no question after it: a stall.
    expect(noStall.grade(run([reply(haiku)])).pass).toBe(false);
    // A question the app refused was never shown: the turn ended on the promise.
    expect(noStall.grade(run([reply(haiku), asked(true)])).pass).toBe(false);
    // A question asked earlier, answered, and a later reply that stalls.
    expect(noStall.grade(run([reply("Trim the window?"), asked(), { kind: "user", text: "Yes." }, reply("Starting the Le Bail gate now. I will run check_cell_symmetry.")])).pass).toBe(false);
    // The stall the check was written against (local models).
    expect(noStall.grade(run([reply("According to your method, the cell check comes first. I will start by running check_cell_symmetry.\n\nStarting the Le Bail gate now.")])).pass).toBe(false);
  });
});

describe("refinesMomentsAlone", () => {
  const NUCLEAR = ["scale", "bkg0", "bkg1", "bkg2", "bkg3", "cell_a", "cell_c", "B_Mn1", "B_Ga1", "pos_Mn1_0"];
  const call = (name: string, free?: string[], out: Record<string, unknown> = {}, isError = false) =>
    ({ kind: "call", name, input: {}, isError, text: isError ? "Error: refused" : JSON.stringify(name === "refine" ? { refined: true, ...out } : out), ...(free ? { free } : {}) });
  const run = (events: unknown[]): EvalRun => ({ events }) as unknown as EvalRun;
  const reply = (text: string) => ({ kind: "reply", text });
  const momentsOnly = call("refine", ["mom_Mn1_0"]);
  /**
   * Sonnet on magnetic-structure, 2026-11-03 (evalfix, run 2), failed on "calls refine_moments": its magnetic calls
   * and replies in order, as the run's log kept them. Its saved report is gone, so each refine's free set is the one
   * its reply states, in the page's row ids (the scripted replay in evals.test.ts runs the same route on the page).
   */
  const sonnet = [
    call("search_propagation_vector"), call("set_propagation_vector"), call("rank_magnetic_groups"), call("choose_magnetic_group"),
    call("continue_magnetic_refinement"),
    reply("Now hold every nuclear row so only the moment refines."),
    call("set_free", undefined, {}, true), call("read_skill"), call("set_free"),
    momentsOnly, call("assess_refinement"),
    reply("Stage 5: free the instrument term (peak FWHM) with scale and background, everything else held."),
    call("set_free"), call("refine", ["scale", "bkg0", "bkg1", "bkg2", "bkg3", "width"]), call("refine", ["scale", "bkg0", "bkg1", "bkg2", "bkg3", "width"]),
    call("write_report"),
  ];

  it("counts a converged refine with only the moments free, every nuclear row held (Sonnet's run)", async () => {
    const { refinesMomentsAlone } = await import("@/agent/evals/checks");
    const v = refinesMomentsAlone.grade(run(sonnet));
    expect(v).toEqual({ pass: true, detail: "refine with only mom_Mn1_0 free, every nuclear row held" });
    // The moments with k's components freed (refineK), or a modulated amplitude: magnetic rows too.
    expect(refinesMomentsAlone.grade(run([call("refine", ["mom_Mn1_0", "prop_k3"])])).pass).toBe(true);
    expect(refinesMomentsAlone.grade(run([call("refine", ["modAmp_Mn1"])])).pass).toBe(true);
  });

  it("still passes on refine_moments", async () => {
    const { refinesMomentsAlone } = await import("@/agent/evals/checks");
    expect(refinesMomentsAlone.grade(run([call("choose_magnetic_group"), call("refine_moments", undefined, { note: "Moments fitted: wR 2.32%." })]))).toEqual({ pass: true, detail: "refine_moments ran" });
    // A refused refine_moments is no fit.
    expect(refinesMomentsAlone.grade(run([call("refine_moments", undefined, {}, true)])).pass).toBe(false);
  });

  it("fails a refine of the moments that frees any nuclear row", async () => {
    const { refinesMomentsAlone } = await import("@/agent/evals/checks");
    for (const row of ["scale", "cell_a", "pos_Mn1_0", "B_Mn1", "bkg0", "width", "profU"]) {
      const v = refinesMomentsAlone.grade(run([call("continue_magnetic_refinement"), call("refine", ["mom_Mn1_0", row])]));
      expect(v, row).toEqual({ pass: false, detail: `refine_moments never ran, and every refine of the moments freed nuclear rows too: ${row}` });
    }
    // Every row free, as continue_magnetic_refinement leaves them: nuclear and magnetic together.
    expect(refinesMomentsAlone.grade(run([call("continue_magnetic_refinement"), call("refine", [...NUCLEAR, "mom_Mn1_0"])])).detail).toMatch(/freed nuclear rows too: scale, bkg0, .* and 2 more$/);
  });

  it("fails a run with no moments-only step", async () => {
    const { refinesMomentsAlone } = await import("@/agent/evals/checks");
    // Sonnet's run without its moments-only refine: only the instrument pass, the moments held.
    expect(refinesMomentsAlone.grade(run(sonnet.filter((e) => e !== momentsOnly)))).toEqual({ pass: false, detail: "refine_moments never ran, and no converged refine fitted the moments" });
    // k alone is no moments step; a refine that did not finish, or was refused, is none either.
    expect(refinesMomentsAlone.grade(run([call("refine", ["prop_k3"])])).pass).toBe(false);
    expect(refinesMomentsAlone.grade(run([call("refine", ["mom_Mn1_0"], { refined: false })])).pass).toBe(false);
    expect(refinesMomentsAlone.grade(run([call("refine", ["mom_Mn1_0"], {}, true)])).pass).toBe(false);
    expect(refinesMomentsAlone.grade(run([])).pass).toBe(false);
  });
});

describe("symmetryLast", () => {
  const run = (reply: string): EvalRun => ({ events: [{ kind: "reply", text: reply }] }) as unknown as EvalRun;

  it("reads a lowering named for what it would hide as a reason to wait, not a proposal (symmetry-last, Haiku, 2026-11-07)", async () => {
    const { symmetryLast } = await import("@/agent/evals/checks");
    for (const said of [
      "Lowering the symmetry now would hide that misfit behind extra parameters.",
      "A subgroup at this stage could only add parameters that absorb the profile misfit.",
      "Breaking the symmetry would just fit the noise the ADPs leave.",
    ]) expect(symmetryLast.grade(run(said)), said).toMatchObject({ pass: true });
  });

  it("still catches a proposal, a lowering said to help included", async () => {
    const { symmetryLast } = await import("@/agent/evals/checks");
    for (const said of [
      "Yes. The misfit says the symmetry is too high: we should lower the symmetry to P 63 m c, a subgroup of P 63/m m c.",
      "Lowering the symmetry would fix that misfit.",
      "Lowering the symmetry to P-42₁m would explain the extra intensity.",
      "I'll lower the symmetry now; it will improve the fit.",
      // The cost is the higher group's, in another clause: still a proposal.
      "We should lower the symmetry to P 63 m c: the higher group would hide the splitting.",
    ]) expect(symmetryLast.grade(run(said)), said).toMatchObject({ pass: false });
  });
});
