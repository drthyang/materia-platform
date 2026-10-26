import { describe, it, expect } from "vitest";
import { parse_structure } from "@/mcp/tools";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { assessRefinement, physicalFindings, type AssessmentFinding } from "@/core/diagnostics/assessment";
import { findingLine, moderateCorrelationLine } from "@/core/diagnostics/findingLines";
import { physicalItems, powderAcceptance } from "@/core/diagnostics/powderAcceptance";
import { zeroAdpFix, zeroAdpFixText, zeroAdpProposals } from "@/core/diagnostics/zeroAdp";
import { CIF, result, rows } from "@/testSupport/zeroAdpFixtures";

/**
 * The physical, at-bound and moderate-correlation findings in the pages'
 * short lines (findingLines.ts): the result or the action first, built from
 * the finding's structure; the finding's own words behind the "?". The
 * findings themselves stay as the Agent reads them (agentVisibleText.test.ts).
 */

const p = (id: string, label: string, kind: RefinementParameter["kind"], value: number, fixed = false): RefinementParameter => ({ id, label, kind, value, initialValue: value, fixed });
const line = (f: AssessmentFinding, parameters: readonly RefinementParameter[]) => findingLine(f, { parameters });

describe("the physical findings of the values", () => {
  const params = [
    p("B_W1", "W1 B", "bIso", -0.0123),
    p("B_O1", "O1 B", "bIso", -0.5, true),
    p("occ_Ga1", "Mn3Ga: Ga1 occ", "occupancy", 1.05, true),
    p("occ_Mn1", "Mn1 occ", "occupancy", 1.0731),
    p("occ_Fe1", "Fe1 occ", "occupancy", -0.0712),
    p("profX", "size (Lorentzian X)", "profileX", -1.234),
  ];
  const found = physicalFindings(params);
  const of = (id: string) => found.find((f) => f.parameterIds?.[0] === id)!;

  it("each in one line, the action first, the finding's own words behind the \"?\"", () => {
    expect(line(of("B_W1"), params)).toEqual({ text: "W1 B refined negative (-0.0123) → hold it positive, find the cause", detail: [of("B_W1").summary, of("B_W1").detail] });
    expect(line(of("B_O1"), params)!.text).toBe("O1 B held at -0.5, negative → correct the input");
    expect(line(of("occ_Ga1"), params)!.text).toBe("Mn3Ga: Ga1 occ held at 1.05, outside [0, 1] → correct the input");
    expect(line(of("occ_Mn1"), params)!.text).toBe("Mn1 occ refined to 1.0731, outside [0, 1] → constrain it");
    expect(line(of("occ_Fe1"), params)!.text).toBe("Fe1 occ refined to -0.0712, outside [0, 1] → constrain it");
    expect(line(of("profX"), params)!.text).toBe("size (Lorentzian X) refined negative (-1.234) → hold it at 0, refine U, V, W");
    // Each shorter than the finding, which stays as the Agent reads it.
    for (const f of found) expect(line(f, params)!.text.length).toBeLessThan(f.summary.length + (f.detail?.length ?? 0));
    expect(of("occ_Ga1").summary).toBe("Mn3Ga: Ga1 occ is held at 1.0500, outside [0, 1].");
  });

  it("a finding it does not reword (a distance, a U's range) is shown as it stands", () => {
    expect(line({ category: "physical", severity: "warning", summary: "Ni1–O1 is 1.832 Å, 11% shorter than the 2.06 Å bond-valence length.", evidence: { from: "Ni1", to: "O1", distance: 1.832 } }, params)).toBeNull();
  });
});

describe("a parameter on its bound", () => {
  it("any parameter: what it hit, then what to do; the assessment's reading behind the \"?\"", () => {
    const params = [p("scale", "scale", "scale", 1), p("profX", "size (Lorentzian X)", "profileX", 0), p("occ_Mn1", "Mn1 occ", "occupancy", 1), p("B1", "B1", "bIso", 0)];
    const r = result({ profX: 0, occ_Mn1: 1, B1: 0 }, {}, []);
    const bounded = { ...r, diagnostics: { ...r.diagnostics!, atBounds: [{ parameterId: "profX", bound: "min" as const, value: 0 }, { parameterId: "occ_Mn1", bound: "max" as const, value: 1 }, { parameterId: "B1", bound: "min" as const, value: 0 }] } };
    const at = assessRefinement({ result: bounded, parameters: params, observationCount: 1800, mode: "powder" }).findings.filter((f) => f.category === "at-bound");
    const texts = at.map((f) => line(f, params)!.text);
    expect(texts).toContain("size (Lorentzian X) hit its lower bound (0) → find the cause");
    expect(texts).toContain("Mn1 occ hit its upper bound (1) → find the cause");
    // The brief's "B1 is resting on its min bound (0).", where the B-at-0 rule has nothing on the page.
    const b1 = at.find((f) => f.parameterIds?.[0] === "B1")!;
    expect(b1.summary).toBe("B1 is resting on its min bound (0).");
    expect(line(b1, params)).toEqual({ text: "B1 hit its lower bound (0) → find the cause", detail: [b1.summary, b1.detail] });
  });

  it("a twin domain at 0 is already a few words: shown as it stands", () => {
    const params = [p("tw1", "twin 1", "twinFraction", 0)];
    expect(line({ category: "at-bound", severity: "note", summary: "twin 1 refines to 0: the crystal holds none of that domain.", parameterIds: ["tw1"], evidence: { bound: "min", value: 0 } }, params)).toBeNull();
  });
});

describe("a B on 0 with the B-at-0 rule on the page", () => {
  const cwo = parse_structure({ cif: CIF(true), id: "cwo" }).structure;
  const single = [{ structure: cwo, prefix: "", groups: [["W1"], ["Cr1"], ["O1"], ["O2"]] }];
  const v = { B_W1: 0, B_Cr1: 0.4, B_O1: 0.62, B_O2: 0 };
  const { params, bindings } = rows(single, v);
  const r: RefinementResult = result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_W1", "B_O2"]);
  const proposals = zeroAdpProposals({ parameters: params, bindings, result: r, structures: [cwo] });
  const w1 = proposals.find((z) => z.parameterId === "B_W1")!;

  it("the open proposal: its options in one line, its caution a ⚠, and behind the \"?\" the reading and the warning — not the Agent's instructions", () => {
    const zeroAdp = { proposals, applied: [] };
    const found = assessRefinement({ result: r, parameters: params, observationCount: 1800, mode: "powder", structures: [cwo], zeroAdp }).findings;
    const f = found.find((x) => x.category === "at-bound" && x.parameterIds?.[0] === "B_W1")!;
    const l = findingLine(f, { parameters: params, result: r, zeroAdp })!;
    expect(l.text).toBe("B(W1) is at its 0 bound: tie it to B(Cr1) (same coordination) or hold it at 0.316 Å²");
    expect(l.caution).toMatch(/^A different cation \(W⁶⁺ vs Cr³⁺\): check it is physically sensible\.$/);
    expect(l.detail[0]).toMatch(/^W1 B is resting on its min bound \(0\)\. A displacement parameter pinned at a bound/);
    expect(l.detail[1]).toBe(w1.warning);
    expect(l.detail.join(" ")).not.toContain("apply_adp_proposal");
  });

  it("the Validation tab's physical sanity: the open B a blocker in a short line, a fix in force a note in one", () => {
    const fix = zeroAdpFix(w1, 0);
    const zeroAdp = { proposals: proposals.filter((z) => z.parameterId !== "B_W1"), applied: [fix] };
    const assessment = assessRefinement({ result: r, parameters: params, observationCount: 1800, mode: "powder", structures: [cwo], zeroAdp });
    const items = physicalItems({ result: r, parameters: params, structures: [cwo], assessment, zeroAdp });
    const o2 = items.find((i) => i.parameterIds[0] === "B_O2")!;
    expect(o2).toMatchObject({ severity: "blocker", text: "B(O2) is at its 0 bound: tie it to B(O1) (same element) or hold it at 0.600 Å²", brief: "B(O2) at its 0 bound", zeroAdp: "open" });
    const applied = items.find((i) => i.parameterIds[0] === "B_W1" && i.zeroAdp === "applied")!;
    expect(applied.severity).toBe("note");
    expect(applied.text).toBe("B(W1) hit 0 → tied to B(Cr1) = 0.40(4) Å² (same 6-O coordination, different cation); not measured on its own");
    expect(applied.caution).toBe("a different cation (W⁶⁺ vs Cr³⁺): check it is physically sensible");
    expect(applied.info?.at(-1)).toBe(zeroAdpFixText(fix));
    // The finding the Agent reads is the long text, unchanged.
    expect(assessment.findings.find((f) => f.severity === "note" && f.parameterIds?.[0] === "B_W1")!.summary).toBe(zeroAdpFixText(fix));
    // Without the rule on the page the line falls back to the finding as it stands.
    expect(physicalItems({ result: r, parameters: params, structures: [cwo], assessment }).find((i) => i.parameterIds[0] === "B_W1" && i.severity === "note")!.text).toBe(zeroAdpFixText(fix));
  });
});

describe("the moderate correlations (the cross-check's esd note)", () => {
  const params = [p("B_W1", "W1 B", "bIso", 0.3), p("occ_Mn1", "Mn1 occ", "occupancy", 0.9), p("B_O1", "O1 B", "bIso", 0.5), p("occ_Fe1", "Fe1 occ", "occupancy", 0.1)];
  const values = Object.fromEntries(params.map((q) => [q.id, q.value]));
  const moderate = (pairs: readonly (readonly [string, string, number])[]) =>
    assessRefinement({ result: result(values, {}, [], pairs.map(([a, b, c]) => ({ parameterIdA: a, parameterIdB: b, coefficient: c }))), parameters: params, observationCount: 1800, mode: "powder" })
      .findings.find((f) => f.category === "correlation" && f.evidence?.pairs !== undefined)!;

  it("one pair names it; several give their count and the largest |ρ|; the pairs in full behind the \"?\"", () => {
    const one = moderate([["B_W1", "occ_Mn1", -0.86]]);
    expect(moderateCorrelationLine(one, params)).toEqual({ text: "W1 B ↔ Mn1 occ: |ρ| 0.86 → report both with ρ", detail: [one.summary, one.detail] });
    const three = moderate([["B_W1", "occ_Mn1", 0.86], ["occ_Fe1", "B_O1", -0.82], ["occ_Mn1", "occ_Fe1", -0.91]]);
    expect(three.summary).toMatch(/^3 pairs correlate at \|ρ\| 0\.8–0\.95: /);
    expect(moderateCorrelationLine(three, params)!.text).toBe("3 pairs correlate, |ρ| up to 0.91 → report each with ρ");
  });

  it("the cross-check card shows the short line, the pairs in its tooltip", () => {
    const r = result(values, {}, [], [{ parameterIdA: "B_W1", parameterIdB: "occ_Mn1", coefficient: 0.86 }, { parameterIdA: "occ_Fe1", parameterIdB: "B_O1", coefficient: -0.82 }]);
    const assessment = assessRefinement({ result: r, parameters: params, observationCount: 1800, mode: "powder" });
    const cross = powderAcceptance({ gof: 1.4, result: r, parameters: params, structures: [], assessment }).checks[2];
    const note = cross.esd!.find((e) => e.text.startsWith("2 pairs"))!;
    expect(note.text).toBe("2 pairs correlate, |ρ| up to 0.86 → report each with ρ");
    expect(note.detail).toBe("2 pairs correlate at |ρ| 0.8–0.95: W1 B ↔ Mn1 occ 0.86; Fe1 occ ↔ O1 B -0.82.");
  });
});
