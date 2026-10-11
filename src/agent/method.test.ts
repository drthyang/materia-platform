import { describe, it, expect } from "vitest";
import { ALTERNATION_SETTLED, advanceAlternation, alternationView, analysisKey, emptyRecord, methodProgress, outOfOrder, ruleRefusal, stagesCovered, stagesLeft, type Alternation } from "@/agent/method";
import type { RefinementParameter } from "@/core/refinement/types";

const p = (id: string, kind: RefinementParameter["kind"]): RefinementParameter => ({ id, label: id, kind, value: 1, initialValue: 1, fixed: false });

describe("the method as code", () => {
  it("names an analysis by its page, data and phases", () => {
    const a = analysisKey("powder", "x.xye", [{ name: "MgAl2O4", spaceGroup: { hermannMauguin: "F d -3 m:2" } }]);
    expect(a).toBe("powder¦x.xye¦MgAl2O4|F d -3 m:2");
    expect(analysisKey("powder", "x.xye", [{ name: "MgAl2O4", spaceGroup: { number: 227 } }])).toBe("powder¦x.xye¦MgAl2O4|227");
  });

  it("maps a free set onto the stages it covers", () => {
    // The scale rides along with every stage: it marks the first only alone.
    expect(stagesCovered("powder", [p("scale", "scale"), p("profW", "profileW"), p("B", "bIso")])).toEqual(["profile", "adp"]);
    expect(stagesCovered("powder", [p("scale", "scale"), p("bkg0", "background")])).toEqual(["base"]);
    expect(stagesCovered("powder", [p("scale", "scale")])).toEqual(["base"]);
    expect(stagesCovered("pdf", [p("s", "pdfScale"), p("d2", "delta2")])).toEqual(["motion"]);
    expect(stagesCovered("pdf", [p("s", "pdfScale"), p("a", "cellLength")])).toEqual(["base"]);
  });

  it("tracks the stages and names the next required one", () => {
    const fresh = methodProgress("powder", emptyRecord("k"));
    expect(fresh.skill).toBe("my-rietveld-workflow");
    expect(fresh.next).toBe("Cell check");
    const later = methodProgress("powder", { ...emptyRecord("k"), cellCheck: { passed: false, at: 0, summary: "1 absence flagged" }, stagesDone: ["base", "positions"] });
    // A check that flagged something is still done: it is a check, not a gate.
    expect(later.stages.map((s) => s.done)).toEqual([true, true, true, false, false, false, false, false]);
    expect(later.next).toBe("Profile");
    // The symmetry review is the last stage, and optional.
    expect(later.stages.at(-1)).toMatchObject({ id: "symmetry", label: "Symmetry review (last)", optional: true });
    // Optional stages never hold up the next one.
    const all = methodProgress("pdf", { ...emptyRecord("k"), stagesDone: ["base", "adp", "motion", "positions"] });
    expect(all.next).toBeNull();
  });

  it("lists the refinement stages left before the space group may be questioned", () => {
    expect(stagesLeft("powder", emptyRecord("k"))).toEqual(["Scale, background, cell", "Positions", "Profile", "ADPs"]);
    // The cell check is not among them: it never holds anything up.
    expect(stagesLeft("powder", { ...emptyRecord("k"), stagesDone: ["base", "positions", "profile", "adp"] })).toEqual([]);
  });

  it("notes a block freed ahead of an earlier required one", () => {
    const record = { ...emptyRecord("k"), stagesDone: ["base"] };
    expect(outOfOrder("powder", [p("B", "bIso")], record)).toBe("Out of the method's order (my-rietveld-workflow): adps refined before positions, profile. Fine if the residual calls for it; say why.");
    expect(outOfOrder("powder", [p("pos", "positionShift")], record)).toBeNull();
    // Freeing the earlier block alongside is in order.
    expect(outOfOrder("powder", [p("pos", "positionShift"), p("W", "profileW"), p("B", "bIso")], record)).toBeNull();
  });

  it("never holds a refinement on the cell check; refuses bare occupancies on both pages", () => {
    const none = emptyRecord("k");
    // Atomic parameters refine whether or not the cell check ran, or flagged something.
    expect(ruleRefusal("powder", [p("pos", "positionShift"), p("B", "bIso")], [], none)).toBeNull();
    const flagged = { ...none, cellCheck: { passed: false, at: 0, summary: "2 absences flagged" } };
    expect(ruleRefusal("powder", [p("pos", "positionShift")], [], flagged)).toBeNull();
    expect(ruleRefusal("powder", [p("occ_A", "occupancy")], [], none)?.rule).toBe("bare-occupancy");
    const tie = { id: "t", label: "Σ", target: 1, sigma: 0.01, terms: [{ parameterId: "occ_A", coefficient: 1 }, { parameterId: "occ_B", coefficient: 1 }] };
    expect(ruleRefusal("powder", [p("occ_A", "occupancy"), p("occ_B", "occupancy")], [tie], none)).toBeNull();
    expect(ruleRefusal("pdf", [p("occ_A", "occupancy")], [], none)?.message).toMatch(/a shared site holds its Σ occupancy/);
    const allowed = { ...none, exceptions: [{ rule: "bare-occupancy" as const, reason: "isotope contrast", at: 0 }] };
    expect(ruleRefusal("powder", [p("occ_A", "occupancy")], [], allowed)).toBeNull();
  });

  it("never refines the instrument's terms with the thermal parameters, and names every broken rule at once", () => {
    const none = emptyRecord("k");
    expect(ruleRefusal("powder", [p("zero", "zeroShift"), p("pos", "atomX")], [], none)).toBeNull();
    expect(ruleRefusal("powder", [p("B_Pb1", "bIso"), p("pos", "atomX")], [], none)).toBeNull();
    // A microstrain model is the sample's broadening, not the instrument's.
    expect(ruleRefusal("powder", [p("mustrain", "mustrainIso"), p("B_Pb1", "bIso")], [], none)).toBeNull();
    const r = ruleRefusal("powder", [p("W", "profileW"), p("SL", "asymSL"), p("B_Pb1", "bIso")], [], none)!;
    expect(r.rule).toBe("instrument-with-thermal");
    expect(r.line).toBe("Not run: instrument terms (W, SL) free with thermal (B_Pb1)");
    expect(r.message).toMatch(/^Not refined: the instrument's terms \(W, SL\) and the thermal parameters \(B_Pb1\) are free together — the user's method never refines them together\. Wider or more Lorentzian peaks/);
    expect(r.message).toMatch(/alternate the two groups: fix the thermal parameters and refine the instrument terms, then fix those and refine the thermal ones, and repeat until a cycle moves neither by more than 0\.3 esd/);
    expect(r.message).toMatch(/call allow_exception with rule "instrument-with-thermal" and their reason/);
    expect(ruleRefusal("pdf", [p("qdamp", "qdamp"), p("U11", "uAniso")], [], none)?.message).toMatch(/Qbroad widens the peaks with r and Qdamp damps them with r/);
    const both = ruleRefusal("powder", [p("occ_A", "occupancy"), p("zero", "zeroShift"), p("B", "bIso")], [], none)!;
    expect(both.rule).toBe("bare-occupancy");
    expect(both.message).toMatch(/^Not refined, for 2 of the user's firm rules\. \(1\) occ_A is a free occupancy.* \(2\) the instrument's terms \(zero\) and the thermal parameters \(B\)/);
    expect(both.line).toBe("Not run: occ_A free with no tie; Not run: instrument terms (zero) free with thermal (B)");
    const allowed = { ...none, exceptions: [{ rule: "instrument-with-thermal" as const, reason: "one joint cycle for the esds", at: 0 }] };
    expect(ruleRefusal("powder", [p("W", "profileW"), p("B", "bIso")], [], allowed)).toBeNull();
  });

  it("follows the alternation: each group's shift since its last refinement, settled once neither moves", () => {
    const at = (w: number, b: number, free: "W" | "B"): RefinementParameter[] => [
      { ...p("W", "profileW"), value: w, fixed: free !== "W" },
      { ...p("B", "bIso"), value: b, fixed: free !== "B" },
      { ...p("x", "atomX"), value: 0.1, fixed: true },
    ];
    const step = (memory: Alternation, w: number, b: number, free: "W" | "B", esd: number) => {
      const params = at(w, b, free);
      const next = advanceAlternation(memory, params.filter((q) => !q.fixed), params, { [free]: esd });
      return { ...next, view: alternationView(next.memory, next.refined, params)?.alternation as Record<string, unknown> | undefined };
    };
    // The instrument refined before any B: remembered, nothing to alternate with yet.
    let s = step({}, 10, 0.5, "W", 0.5);
    expect(s.refined).toBe("instrument");
    expect(s.view).toBeUndefined();
    s = step(s.memory, 10, 0.8, "B", 0.05);
    expect(s.view).toMatchObject({ refined: "the thermal parameters (B), with the instrument terms fixed", largestShift: "their first refinement in the alternation", settled: false });
    expect(String(s.view!.next)).toMatch(/^Fix the thermal parameters and refine the instrument terms \(W\) again, unless they stay at the instrument file's values/);
    s = step(s.memory, 11, 0.8, "W", 0.5);
    expect(s.view).toMatchObject({ largestShift: "W 2.00 esd since their last refinement", otherGroupLastShift: "not yet measured", settled: false });
    s = step(s.memory, 11, 0.81, "B", 0.05);
    expect(s.view).toMatchObject({ largestShift: "B 0.20 esd since their last refinement", otherGroupLastShift: "W 2.00 esd", settled: false });
    // W moves 1.6 esd after 2.0: the shifts shrink slowly — the groups are coupled.
    s = step(s.memory, 11.8, 0.81, "W", 0.5);
    expect(String(s.view!.slow)).toMatch(/^The shifts shrink slowly \(W: 2\.00 → 1\.60 esd\): the two groups are coupled\./);
    s = step(s.memory, 11.8, 0.815, "B", 0.05);
    s = step(s.memory, 11.9, 0.815, "W", 0.5);
    expect(s.view).toMatchObject({ largestShift: "W 0.20 esd since their last refinement", settled: true });
    expect(String(s.view!.next)).toMatch(new RegExp(`^Neither group moved by more than ${ALTERNATION_SETTLED} esd in its last refinement: the alternation has converged\\. Each group's esds are conditional on the other held fixed`));
    // Both groups free together (the user's exception) is no step of the alternation.
    const both = at(12, 0.8, "W").map((q) => ({ ...q, fixed: q.id === "x" }));
    expect(advanceAlternation(s.memory, both.filter((q) => !q.fixed), both, { W: 0.5, B: 0.05 }).refined).toBeNull();
  });
});
