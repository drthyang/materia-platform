import { describe, it, expect } from "vitest";
import { evidenceGate, gradeContradiction, gradeIn, type CallRecord } from "@/agent/evidence";
import { runScenario } from "@/agent/evals/harness";
import { scenario } from "@/agent/evals/scenarios";
import { scriptedModel } from "@/agent/evals/scripted";

const ASKED = "Is the Ta coordination the same locally as on average? Write the report when you are done.";
const ANSWER = "The local coordination is the same as the average one: the Ta–Se bonds agree.";

/** Calls that answered and left the fit as it was. */
const read = (...names: string[]): CallRecord[] => names.map((name) => ({ name, status: "ok", fitChanged: false }));
/** A call that answered and changed the fit (a refinement, the hand inverted). */
const refit = (name: string): CallRecord => ({ name, status: "ok", fitChanged: true });

describe("the evidence an answer needs", () => {
  it("sends back a local-structure answer with no boxcar scan, once, on the PDF page only", () => {
    expect(evidenceGate(ANSWER, ASKED, read("get_state", "bond_geometry"), "pdf", new Set())?.id).toBe("local-structure");
    expect(evidenceGate(ANSWER, ASKED, read("boxcar_scan"), "pdf", new Set())).toBeNull();
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
    expect(evidenceGate(hand, "Is the hand right?", read("get_state"), "singleCrystal", new Set())?.id).toBe("hand");
    expect(evidenceGate(hand, "Is the hand right?", [refit("refine"), ...read("assess_refinement")], "singleCrystal", new Set())).toBeNull();
    // The reading taken before the last refinement is of another fit.
    expect(evidenceGate(hand, "Is the hand right?", [...read("assess_refinement"), refit("invert_structure")], "singleCrystal", new Set())?.id).toBe("hand");
    expect(evidenceGate(hand, "", read("get_state"), "powder", new Set())).toBeNull();
  });

  it("sends back a grade of a fit refined since its last assessment, on every page", () => {
    const graded = "The fit is excellent now.";
    for (const page of ["powder", "pdf", "singleCrystal"] as const) {
      expect(evidenceGate(graded, "Refine it.", [refit("refine")], page, new Set())?.id).toBe("fit-grade");
      expect(evidenceGate(graded, "Refine it.", [refit("refine"), ...read("assess_refinement")], page, new Set())).toBeNull();
    }
    // Nothing refined in this message: the grade needs no new assessment.
    expect(evidenceGate(graded, "How is it?", read("get_state"), "powder", new Set())).toBeNull();
    expect(evidenceGate(graded, "Refine it.", [refit("refine")], "powder", new Set(["fit-grade"]))).toBeNull();
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

/** A call as the chat logs it: its tool, what it came to, and whether the fit on screen changed. */
interface Logged {
  readonly name: string;
  readonly status?: "ok" | "error" | "refused" | "declined" | "unchanged" | "stopped";
  readonly fitChanged?: boolean;
}

const gate = (reply: string, asked: string, calls: readonly Logged[], page: "powder" | "pdf" | "singleCrystal"): string | null =>
  evidenceGate(reply, asked, calls.map((c) => ({ name: c.name, status: c.status ?? "ok", fitChanged: c.fitChanged ?? false })), page, new Set())?.id ?? null;

describe("the gate reads what each call came to, not its name", () => {
  const graded = "The fit is excellent now.";
  const hand = "The Flack parameter says the hand is right.";
  const assessed: Logged = { name: "assess_refinement", status: "ok" };

  it("a refinement that was refused or declined is no refit: the assessment before it still stands", () => {
    expect(gate(graded, "Refine it.", [assessed, { name: "refine", status: "refused" }], "powder")).toBeNull();
    expect(gate(graded, "Refine it.", [assessed, { name: "refine", status: "declined" }], "powder")).toBeNull();
    expect(gate(hand, "Is the hand right?", [assessed, { name: "invert_structure", status: "declined" }], "singleCrystal")).toBeNull();
  });

  it("any change that changed the fit needs a reading after it, whatever the tool", () => {
    // The extinction model clears the fit; no name list had it.
    expect(gate(hand, "Is the hand right?", [assessed, { name: "set_extinction_model", status: "ok", fitChanged: true }], "singleCrystal")).toBe("hand");
    // A grade after the weights cleared the fit: the fit graded is not the one assessed.
    expect(gate(graded, "Set the weights.", [assessed, { name: "set_weighting", status: "ok", fitChanged: true }], "singleCrystal")).toBe("fit-grade");
    // Back to a step whose fit is the one on screen: nothing to read again.
    expect(gate(hand, "Is the hand right?", [assessed, { name: "go_to_step", status: "ok", fitChanged: false }], "singleCrystal")).toBeNull();
  });

  it("evidence counts only when it answered", () => {
    expect(gate(ANSWER, ASKED, [{ name: "boxcar_scan", status: "declined" }], "pdf")).toBe("local-structure");
    expect(gate(ANSWER, ASKED, [{ name: "boxcar_scan", status: "error" }], "pdf")).toBe("local-structure");
    expect(gate(graded, "Refine it.", [{ name: "refine", status: "ok", fitChanged: true }, { name: "assess_refinement", status: "error" }], "powder")).toBe("fit-grade");
  });

  it("through the chat: a grade after a refused refinement stands on the assessment before it", async () => {
    const stand = await scriptedModel([
      { calls: [{ name: "read_skill", input: { name: "my-rietveld-workflow" } }, { name: "refine" }] },
      { calls: [{ name: "assess_refinement" }] },
      // The bare occupancy: the firm rule refuses the refinement, and the fit stays the one assessed.
      { calls: [{ name: "set_free", input: { free: ["occ_Mn1"] } }, { name: "refine" }] },
      { text: "The refinement with the occupancy was refused: the occupancy needs a tie. The fit is good as it stands." },
    ]);
    try {
      const r = await runScenario(scenario("full-refinement"), stand.model);
      expect(r.run.events.some((e) => e.kind === "call" && e.name === "refine" && e.isError)).toBe(true);
      expect(r.run.notices.filter((n) => /graded a fit refined since/.test(n))).toEqual([]);
    } finally {
      await stand.close();
    }
  }, 60_000);
});
