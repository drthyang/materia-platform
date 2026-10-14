import { describe, it, expect } from "vitest";
import { evidenceGate, gradeContradiction, gradeIn } from "@/agent/evidence";
import { runScenario } from "@/agent/evals/harness";
import { scenario } from "@/agent/evals/scenarios";
import { scriptedModel } from "@/agent/evals/scripted";

const ASKED = "Is the Ta coordination the same locally as on average? Write the report when you are done.";
const ANSWER = "The local coordination is the same as the average one: the Ta–Se bonds agree.";

describe("the evidence an answer needs", () => {
  it("sends back a local-structure answer with no boxcar scan, once, on the PDF page only", () => {
    expect(evidenceGate(ANSWER, ASKED, ["get_state", "bond_geometry"], "pdf", new Set())?.id).toBe("local-structure");
    expect(evidenceGate(ANSWER, ASKED, ["boxcar_scan"], "pdf", new Set())).toBeNull();
    expect(evidenceGate(ANSWER, ASKED, [], "pdf", new Set(["local-structure"]))).toBeNull();
    expect(evidenceGate(ANSWER, ASKED, [], "powder", new Set())).toBeNull();
    // Not every reply on the page: the question must be about it, and the reply conclude it.
    expect(evidenceGate(ANSWER, "Refine this PDF fit following my method.", [], "pdf", new Set())).toBeNull();
    expect(evidenceGate("The scale and the cell refined.", ASKED, [], "pdf", new Set())).toBeNull();
  });

  it("the chat asks for the scan, the model runs it, and its answer then stands", async () => {
    const stand = await scriptedModel([
      { text: ANSWER },
      { calls: [{ name: "read_skill", input: { name: "pdf-workflow" } }, { name: "boxcar_scan", input: { width: 2, step: 1, bonds: ["Ta1"] } }] },
      { text: "The boxes agree within their spread: the local coordination matches the average one over this range." },
    ]);
    try {
      const r = await runScenario(scenario("pdf-local-geometry"), stand.model);
      expect(r.run.notices.filter((n) => /without a boxcar scan/.test(n))).toEqual(["The answer concluded about the local structure without a boxcar scan; the app asked for the scan first."]);
      expect(r.run.events.some((e) => e.kind === "call" && e.name === "boxcar_scan" && !e.isError)).toBe(true);
      expect(stand.overrun()).toBe(0);
    } finally {
      await stand.close();
    }
  }, 60_000);
});

describe("THY-18: no verdict without its evidence, none the engine did not give", () => {
  it("sends back a word on the hand with no absolute-structure reading after the last refinement", () => {
    const hand = "The Flack parameter says the hand is right.";
    expect(evidenceGate(hand, "Is the hand right?", ["get_state"], "singleCrystal", new Set())?.id).toBe("hand");
    expect(evidenceGate(hand, "Is the hand right?", ["refine", "assess_refinement"], "singleCrystal", new Set())).toBeNull();
    // The reading taken before the last refinement is of another fit.
    expect(evidenceGate(hand, "Is the hand right?", ["assess_refinement", "invert_structure"], "singleCrystal", new Set())?.id).toBe("hand");
    expect(evidenceGate(hand, "", ["get_state"], "powder", new Set())).toBeNull();
  });

  it("sends back a grade of a fit refined since its last assessment, on every page", () => {
    const graded = "The fit is excellent now.";
    for (const page of ["powder", "pdf", "singleCrystal"] as const) {
      expect(evidenceGate(graded, "Refine it.", ["refine"], page, new Set())?.id).toBe("fit-grade");
      expect(evidenceGate(graded, "Refine it.", ["refine", "assess_refinement"], page, new Set())).toBeNull();
    }
    // Nothing refined in this message: the grade needs no new assessment.
    expect(evidenceGate(graded, "How is it?", ["get_state"], "powder", new Set())).toBeNull();
    expect(evidenceGate(graded, "Refine it.", ["refine"], "powder", new Set(["fit-grade"]))).toBeNull();
  });

  it("reads the grade a reply gives, and calls one a contradiction only well away from the engine's", () => {
    expect(gradeIn("An excellent fit.")).toBe("excellent");
    expect(gradeIn("The refinement looks good.")).toBe("good");
    expect(gradeIn("Refined to wR 4 %.")).toBeNull();
    expect(gradeContradiction("An excellent fit.", "poor")).toMatch(/"excellent".*"poor"/);
    expect(gradeContradiction("A good fit.", "fair")).not.toBeNull(); // across the line between fair and good
    expect(gradeContradiction("An excellent fit.", "good")).toBeNull(); // neighbours on the same side
    expect(gradeContradiction("A poor fit.", "poor")).toBeNull();
    expect(gradeContradiction("An excellent fit.", null)).toBeNull();
  });
});
