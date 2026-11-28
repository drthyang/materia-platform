import { describe, it, expect } from "vitest";
import { LOWERING_FOLLOW_UPS, scenario } from "@/agent/evals/scenarios";
import { type EvalResult, savedRun, type SavedRun } from "@/agent/evals/harness";
import { type ScriptTurn } from "@/agent/evals/scripted";
import { sentences } from "@/agent/evals/checks";
import { executor, fakeHost } from "@/testSupport/agentHeadless";
import { impurityD, mn3gaImpuritySession, mn3gaMisfitSession, powderPage } from "@/agent/evals/pages";
import { MORE_FAILURES, REPLAYS, RIETVELD, SC } from "@/agent/evals/replays";
import { failing, regraded, replay, verdicts, why } from "@/agent/evals/scriptedReplay";

/** The scripted eval suite (see evals.test.ts): the checks every scenario holds, and the cases written against one live failure each. */

describe("checks every scenario holds, shown to catch their failure", () => {
  for (const f of MORE_FAILURES) {
    it(`${f.scenario}: ${f.catches.join(", ")}`, async () => {
      const result = await replay(f.scenario, f.turns);
      for (const c of f.catches) expect(scenario(f.scenario).checks.map((k) => k.name), `${c} is not a check of ${f.scenario}`).toContain(c);
      expect(failing(result), why(result)).toEqual(expect.arrayContaining([...f.catches]));
    }, 60_000);
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

  it("sends back a grade that contradicts the engine's verdict, as the app does", async () => {
    // The harness's runner once had no `fill`, so this final-answer check ran in the app but never in an eval or the validation.
    const turns = (answer: string): ScriptTurn[] => [
      { calls: [RIETVELD, { name: "get_state" }] },
      { text: "Stage 1: scale, background and cell.", calls: [{ name: "refine" }] },
      { calls: [{ name: "assess_refinement" }] },
      { text: answer },
      { text: "The engine's verdict is {{verdict}}." },
    ];
    const quoted = await replay("full-refinement", turns("The engine's verdict is {{verdict}}."));
    const band = quoted.run.events.flatMap((e) => (e.kind === "reply" && e.refs ? [e.refs["verdict"]] : []))[0];
    expect(band, why(quoted)).toBeTruthy();
    expect(quoted.run.notices.filter((n) => /quote the engine's verdict/.test(n)), why(quoted)).toEqual([]);
    const contradicting = /excellent|good/.test(band!) ? "A poor fit, every stage refined." : "An excellent fit, every stage refined.";
    const graded = await replay("full-refinement", turns(contradicting));
    expect(graded.run.notices.some((n) => /quote the engine's verdict/.test(n)), why(graded)).toBe(true);
    expect(graded.overrun, why(graded)).toBe(0);
    // Every run keeps the policy it ran under, through the saved run too.
    expect(graded.run.policy).toMatchObject({ turnCap: 40, toolScope: "all", pruning: "server" });
    expect((JSON.parse(JSON.stringify(savedRun(graded))) as SavedRun).policy).toEqual(graded.run.policy);
  }, 60_000);

  it("counts a moments-only refine on the refinement page as the moments step, and a refine that frees a nuclear row with them not (magnetic-structure, Sonnet, 2026-11-03)", async () => {
    const check = "refines the moments with the nuclear model held";
    // Sonnet's route (evalfix, run 2): the moment rows handed to the refinement, the page's method read, every nuclear row held, refine.
    const head = REPLAYS["magnetic-structure"]!.good.slice(0, 4);
    const route = (free: string[]): ScriptTurn[] => [
      ...head,
      { calls: [{ name: "choose_magnetic_group", input: { id: "G1" } }, { name: "continue_magnetic_refinement" }] },
      { text: "Now hold every nuclear row so only the moment refines.", calls: [RIETVELD, { name: "set_free", input: { fix: ["*"] } }, { name: "set_free", input: { free } }, { name: "refine" }] },
      { text: "k = (0 0 ½), group G1, the Mn moment refined with the nuclear model held." },
    ];
    const alone = await replay("magnetic-structure", route(["mom_*"]));
    const refine = alone.run.events.find((e) => e.kind === "call" && e.name === "refine");
    expect(refine?.kind === "call" && refine.free, why(alone)).toEqual(["mom_Mn1_0"]);
    expect(alone.grades.find((g) => g.check === check), why(alone)).toMatchObject({ pass: true });
    expect(failing(alone), why(alone)).toEqual([]);
    expect(regraded(alone), "the saved run, scored again").toEqual(verdicts(alone));
    // The scale, or every row as continue_magnetic_refinement leaves them: nuclear and magnetic together.
    const withScale = await replay("magnetic-structure", route(["mom_*", "scale"]));
    expect(withScale.grades.find((g) => g.check === check), why(withScale)).toMatchObject({ pass: false, detail: expect.stringMatching(/freed nuclear rows too: scale$/) });
    const joint = await replay("magnetic-structure", [...head, { calls: [{ name: "choose_magnetic_group", input: { id: "G1" } }, { name: "continue_magnetic_refinement" }] }, { calls: [RIETVELD, { name: "refine" }] }, { text: "Refined." }]);
    expect(joint.grades.find((g) => g.check === check)?.pass, why(joint)).toBe(false);
  }, 60_000);

  it("answers a question before lowering with the user's follow-up, and the run goes on (pdf-lower-symmetry, 2026-11-07)", async () => {
    const PDF_SKILL = { name: "read_skill", input: { name: "pdf-workflow" } };
    const good = REPLAYS["pdf-lower-symmetry"]!.good;
    // Asked which variant (Haiku #2, Sonnet #1): the user's follow-up answers, and the lowering and the refinement follow.
    const asked = await replay("pdf-lower-symmetry", [
      { calls: [PDF_SKILL, { name: "list_subgroups", input: { name: "P-42_1m", cell: "1×1×2" } }] },
      { text: "One row of four classes.", calls: [{ name: "ask_user", input: { question: "Lower to the row's default variant, or another?", options: [{ label: "The default", message: "Lower to the default variant." }, { label: "Another", message: "Show me the other variants." }] } }] },
      ...good.slice(1),
    ]);
    expect(asked.run.events.filter((e) => e.kind === "user").map((e) => (e as { text: string }).text), why(asked)).toEqual([scenario("pdf-lower-symmetry").messages[0], "Use the default variant, and go on."]);
    expect(asked.overrun, why(asked)).toBe(0);
    expect(failing(asked), why(asked)).toEqual([]);
    // A run that lowered sends no follow-up, and neither does one that ended without a question.
    const lowered = await replay("pdf-lower-symmetry", good);
    expect(lowered.run.events.filter((e) => e.kind === "user"), why(lowered)).toHaveLength(1);
    const silent = await replay("pdf-lower-symmetry", [{ calls: [PDF_SKILL, { name: "list_subgroups", input: { name: "P-42_1m", cell: "1×1×2" } }] }, { text: "That is the row." }]);
    expect(silent.run.events.filter((e) => e.kind === "user"), why(silent)).toHaveLength(1);
    expect(failing(silent), why(silent)).toContain("lowers the symmetry to P -4 21 m #113, in its own cell, 1×1×2");
  }, 120_000);

  it("answers a question after lowering with the method's defaults, and the run goes on (THY-85)", async () => {
    const [before, after] = LOWERING_FOLLOW_UPS.map((f) => f.text);
    const users = (r: EvalResult): string[] => r.run.events.filter((e) => e.kind === "user").map((e) => (e as { text: string }).text);
    const good = REPLAYS["pdf-line-k-subgroup"]!.good;
    const FIT_WINDOW = { name: "ask_user", input: { question: "Keep the method's fit window, 1.5–6 Å, or widen it before refining?", options: [{ label: "Keep it", message: "Keep the fit window." }, { label: "Widen it", message: "Widen the fit window." }] } };
    // THY-73 run 1: lowered, then asked about the fit window, and the run ended there. The user's answer lets it refine.
    const askedAfter = await replay("pdf-line-k-subgroup", [good[0]!, { ...good[1]!, calls: [...good[1]!.calls!, FIT_WINDOW] }, ...good.slice(2)]);
    expect(users(askedAfter), why(askedAfter)).toEqual([scenario("pdf-line-k-subgroup").messages[0], after]);
    expect(askedAfter.overrun, why(askedAfter)).toBe(0);
    expect(failing(askedAfter), why(askedAfter)).toEqual([]);
    // Asked before lowering and again after it: each answer once, in order.
    const both = await replay("pdf-line-k-subgroup", [
      good[0]!,
      { text: "One row, P-4c2 #116, two classes. Lower to the default variant?" },
      { ...good[1]!, calls: [...good[1]!.calls!, FIT_WINDOW] },
      ...good.slice(2),
    ]);
    expect(users(both), why(both)).toEqual([scenario("pdf-line-k-subgroup").messages[0], before, after]);
    expect(failing(both), why(both)).toEqual([]);
    // A question in a reply after lowering counts too, and pdf-lower-symmetry answers it the same way.
    const lowerGood = REPLAYS["pdf-lower-symmetry"]!.good;
    const replied = await replay("pdf-lower-symmetry", [...lowerGood.slice(0, 2), { text: "Lowered. Should I keep the fit window at 1.5–6 Å?" }, ...lowerGood.slice(2)]);
    expect(users(replied), why(replied)).toEqual([scenario("pdf-lower-symmetry").messages[0], after]);
    expect(failing(replied), why(replied)).toEqual([]);
    // A run that lowered and ended on an answer hears nothing more.
    expect(users(await replay("pdf-line-k-subgroup", good))).toHaveLength(1);
  }, 120_000);

  it("catches a coupled pair named as the line point, or by another irrep (THY-85)", async () => {
    const good = REPLAYS["pdf-coupled-k-subgroup"]!.good;
    const NAMING = "names the k-points and irreps as the engine labels them: X irrep 5 + W irrep 1";
    for (const last of [
      "F-43m is lowered to P-42₁m #113 in its own 1×1×2 cell, reached by Δ (0, 0, 1/2) irrep 2; its modes are refined with the scale: Rw {{Rw}}.",
      "F-43m is lowered to P-42₁m #113 in its own 1×1×2 cell, reached by X irrep 3 + W irrep 1; its modes are refined with the scale: Rw {{Rw}}.",
    ]) {
      // The good run, its naming sentence before lowering left out and its answer naming another k-point or irrep.
      const r = await replay("pdf-coupled-k-subgroup", [good[0]!, { ...good[1]!, text: "Lowering to the row's default." }, ...good.slice(2, -1), { text: last }]);
      expect(r.overrun, why(r)).toBe(0);
      expect(failing(r), why(r)).toEqual([NAMING]);
    }
  }, 120_000);

  it("does not take a denial for a proposal: \"Neither is evidence for a lower group\"", async () => {
    // A live run (2026-10-10) failed symmetry-last on that sentence: "neither" was not read as a negation.
    const r = await replay("symmetry-last", [
      { calls: [{ name: "get_state" }] },
      { text: "The misfit and the weak line at 2.1 Å are what refinement fixes. Neither is evidence for a lower group; the positions and the ADPs come first." },
    ]);
    expect(r.grades.find((g) => g.check === "proposes no symmetry change before the review")?.pass, why(r)).toBe(true);
  }, 60_000);
});
