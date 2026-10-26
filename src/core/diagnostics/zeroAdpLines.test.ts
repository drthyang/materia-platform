import { describe, it, expect } from "vitest";
import { parse_structure } from "@/mcp/tools";
import type { RefinementResult } from "@/core/refinement/types";
import { zeroAdpFix, zeroAdpFixText, zeroAdpProposals, type ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";
import { zeroAdpFixLine, zeroAdpOpenLimitation, zeroAdpOptionLine, zeroAdpProposalLine, type ShortLine } from "@/core/diagnostics/zeroAdpLines";
import { CIF, SHARED_CIF, result, rows } from "@/testSupport/zeroAdpFixtures";

/**
 * The B-at-0 rule in the pages' short lines, from the facts the rule carries:
 * the result or the action first, no rule letters, no parentheses inside
 * parentheses, the values with their esds; the rule's prose behind the "?".
 */

const cwo = parse_structure({ cif: CIF(true), id: "cwo" }).structure;
const single = [{ structure: cwo, prefix: "", groups: [["W1"], ["Cr1"], ["O1"], ["O2"]] }];

/** How deep the parentheses go: "B(O1) (same element)" is 1, "(a (b))" 2. */
function depth(s: string): number {
  let d = 0;
  let max = 0;
  for (const c of s) {
    if (c === "(") max = Math.max(max, ++d);
    else if (c === ")") d--;
  }
  return max;
}

/** What every short line keeps to: one line, short, plain words. */
function plain(line: ShortLine, long: string): void {
  expect(line.text).not.toMatch(/\n/);
  expect(line.text).not.toMatch(/rule [ABC]\b/);
  expect(depth(line.text)).toBeLessThanOrEqual(1);
  expect(line.text.length).toBeLessThanOrEqual(130);
  expect(line.text.length).toBeLessThan(0.5 * long.length);
  // Nothing is said twice in one line.
  expect(line.text.match(/different cation/g)?.length ?? 0).toBeLessThanOrEqual(1);
}

/** W1 and O2 on 0: O2 has a same-element partner (O1), W1 only another cation (Cr1). */
function awo4Like(): { o2: ZeroAdpProposal; w1: ZeroAdpProposal } {
  const v = { B_W1: 0, B_Cr1: 0.4, B_O1: 0.62, B_O2: 0 };
  const { params, bindings } = rows(single, v);
  const ps = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_W1", "B_O2"]), structures: [cwo] });
  return { o2: ps.find((p) => p.parameterId === "B_O2")!, w1: ps.find((p) => p.parameterId === "B_W1")! };
}

describe("an open proposal, in one line", () => {
  it("names the B and every option in brief, the ties by what they share; the warning behind the \"?\"", () => {
    const { o2, w1 } = awo4Like();
    const a = zeroAdpProposalLine(o2);
    expect(a.text).toBe("B(O2) is at its 0 bound: tie it to B(O1) (same element) or hold it at 0.600 Å²");
    expect(a.caution).toBeUndefined();
    expect(a.detail).toEqual([o2.warning]);
    plain(a, o2.warning);
    const b = zeroAdpProposalLine(w1);
    expect(b.text).toBe("B(W1) is at its 0 bound: tie it to B(Cr1) (same coordination) or hold it at 0.316 Å²");
    plain(b, w1.warning);
  });

  it("a starting value alone says where it comes from; with nothing to propose, says so", () => {
    const v = { B_W1: 0, B_Cr1: 0.05, B_O1: 0, B_O2: 0 };
    const { params, bindings } = rows(single, v);
    const [w1] = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_W1", "B_O1", "B_O2"]), structures: [cwo] });
    expect(zeroAdpProposalLine(w1!).text).toBe("B(W1) is at its 0 bound: hold it at 0.316 Å² (starting value)");
    const bare = parse_structure({ cif: CIF(false), id: "cwo" }).structure;
    const vc = { B_W1: 0.3, B_Cr1: 0.4, B_O1: 0, B_O2: 0 };
    const c = rows([{ structure: bare, prefix: "", groups: [["W1"], ["Cr1"], ["O1"], ["O2"]] }], vc);
    const [o1] = zeroAdpProposals({ parameters: c.params, bindings: c.bindings, result: result(vc, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_O1", "B_O2"]), structures: [bare] });
    const line = zeroAdpProposalLine(o1!);
    expect(line.text).toBe("B(O1) is at its 0 bound: no value to propose — find the cause first");
    plain(line, o1!.warning);
  });

  it("each option in brief beside its Apply, its esd kept; the option's sentence behind the \"?\"", () => {
    const { o2, w1 } = awo4Like();
    expect(o2.options.map((o) => zeroAdpOptionLine(o).text)).toEqual(["Tie to B(O1) = 0.62(5) Å² (same element)", "Hold at 0.600 Å² (starting value)"]);
    const tie = zeroAdpOptionLine(w1.options[0]!);
    expect(tie.text).toBe("Tie to B(Cr1) = 0.40(4) Å² (same 6-O coordination, different cation)");
    expect(tie.detail).toEqual([`${w1.options[0]!.text.charAt(0).toUpperCase()}${w1.options[0]!.text.slice(1)}.`]);
    plain(tie, w1.options[0]!.text);
  });
});

describe("the cross-site caution", () => {
  it("rides along as a caution (the page's ⚠, the report's suffix), never as a parenthetical in the line", () => {
    const { w1 } = awo4Like();
    expect(zeroAdpOptionLine(w1.options[0]!).caution).toBe("a different cation (W⁶⁺ vs Cr³⁺): check it is physically sensible");
    const line = zeroAdpProposalLine(w1);
    expect(line.caution).toBe("A different cation (W⁶⁺ vs Cr³⁺): check it is physically sensible.");
    expect(line.text).not.toMatch(/physically sensible|W⁶⁺/);
    expect(line.report).toBe(`${line.text} — check it is physically sensible`);
    const fix = zeroAdpFixLine(zeroAdpFix(w1, 0, { reason: "W and Cr share one octahedral site type here" }));
    expect(fix.caution).toBe("a different cation (W⁶⁺ vs Cr³⁺): check it is physically sensible");
    expect(fix.text).not.toMatch(/physically sensible/);
    expect(fix.report).toMatch(/ — check it is physically sensible$/);
  });
});

describe("a fix in force, in one line", () => {
  it("a tie: the B it hit, its leader's value with its esd, what the two share; the options not taken and the whole account behind the \"?\"", () => {
    const { o2, w1 } = awo4Like();
    const fix = zeroAdpFix(o2, 0);
    const line = zeroAdpFixLine(fix);
    expect(line.text).toBe("B(O2) hit 0 → tied to B(O1) = 0.62(5) Å² (same element); not measured on its own");
    expect(line.detail).toEqual(["Other options: hold at 0.600 Å² (starting value).", zeroAdpFixText(fix)]);
    expect(line.report).toBe("B(O2) refined to 0 and is tied to B(O1) = 0.62(5) Å² (same element); not measured on its own");
    plain(line, zeroAdpFixText(fix));
    // The user's example: another cation, the starting value not taken.
    const cross = zeroAdpFixLine(zeroAdpFix(w1, 0));
    expect(cross.text).toBe("B(W1) hit 0 → tied to B(Cr1) = 0.40(4) Å² (same 6-O coordination, different cation); not measured on its own");
    expect(cross.detail[0]).toBe("Other options: hold at 0.316 Å² (starting value).");
    plain(cross, zeroAdpFixText(zeroAdpFix(w1, 0)));
  });

  it("the tied value is the leader's as it stands: the last fit's with its esd, else the row's", () => {
    const { o2 } = awo4Like();
    const fix = zeroAdpFix(o2, 0);
    const refit = { parameters: { B_O1: 0.587 }, esd: { B_O1: 0.031 } } as unknown as RefinementResult;
    expect(zeroAdpFixLine(fix, { result: refit }).text).toContain("tied to B(O1) = 0.59(3) Å²");
    const { params } = rows(single, { B_O1: 0.61 });
    expect(zeroAdpFixLine(fix, { result: null, parameters: params }).text).toContain("tied to B(O1) = 0.610 Å²");
  });

  it("a held value: the starting value, not measured; the tie not taken behind the \"?\"", () => {
    const { o2 } = awo4Like();
    const fix = zeroAdpFix(o2, 1);
    const line = zeroAdpFixLine(fix);
    expect(line.text).toBe("B(O2) hit 0 → held at 0.600 Å² (starting value); not measured");
    expect(line.detail[0]).toBe("Other options: tie to B(O1) = 0.62(5) Å² (same element).");
    plain(line, zeroAdpFixText(fix));
  });

  it("who chose it: the Agent in auto mode says so in the line, its reason behind the \"?\"", () => {
    const { o2 } = awo4Like();
    const fix = zeroAdpFix(o2, 0, { chosenBy: "agent-auto", reason: "both are the oxide's oxygens" });
    const line = zeroAdpFixLine(fix);
    expect(line.text).toBe("B(O2) hit 0 → tied to B(O1) = 0.62(5) Å² (same element); not measured on its own; the Agent's choice (auto mode)");
    expect(line.detail).toContain("The Agent's reason: both are the oxide's oxygens.");
  });
});

describe("a shared site and several phases", () => {
  it("a shared site is named by its atoms, and a site with no oxidation state by its element", () => {
    const shared = parse_structure({ cif: SHARED_CIF, id: "shared" }).structure;
    const v = { B_W1: 0, B_Cr1: 0.6, B_O1: 0.62, B_O2: 0.5 };
    const { params, bindings } = rows([{ structure: shared, prefix: "", groups: [["W1"], ["Cr1", "Fe1"], ["O1"], ["O2"]] }], v);
    const [w1] = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.2, B_O1: 0.05, B_O2: 0.05 }, ["B_W1"]), structures: [shared] });
    expect(zeroAdpProposalLine(w1!).text).toBe("B(W1) is at its 0 bound: tie it to B(Cr1/Fe1) (same coordination) or hold it at 1.453 Å²");
    const fix = zeroAdpFix(w1!, 0);
    const line = zeroAdpFixLine(fix);
    // The user's example, on a shared site of no oxidation states.
    expect(line.text).toBe("B(W1) hit 0 → tied to B(Cr1/Fe1) = 0.6(2) Å² (same 6-O coordination, different cation); not measured on its own");
    expect(line.caution).toBe("a different cation (W site vs Cr site/Fe site): check it is physically sensible");
    expect(line.detail[0]).toBe("Other options: hold at 1.453 Å² (starting value).");
    plain(line, zeroAdpFixText(fix));
  });

  it("with several phases each line names its phase, as the rows' labels do", () => {
    const first = { ...cwo, name: "Cr2WO6-a" };
    const second = { ...parse_structure({ cif: CIF(true, "second"), id: "second" }).structure, name: "Cr2WO6-b" };
    const phases = [{ structure: first, prefix: "p0_", groups: [["W1"], ["Cr1"], ["O1"], ["O2"]] }, { structure: second, prefix: "p1_", groups: [["W1"], ["Cr1"], ["O1"], ["O2"]] }];
    const v = { p0_B_W1: 0.3, p0_B_Cr1: 0.4, p0_B_O1: 0.62, p0_B_O2: 0, p1_B_W1: 0.3, p1_B_Cr1: 0.4, p1_B_O1: 0, p1_B_O2: 0.7 };
    const { params, bindings } = rows(phases, v);
    const ps = zeroAdpProposals({ parameters: params, bindings, result: result(v, Object.fromEntries(Object.keys(v).map((k) => [k, 0.05])), ["p0_B_O2", "p1_B_O1"]), structures: [first, second] });
    expect(ps.map((p) => p.phase)).toEqual(["Cr2WO6-a", "Cr2WO6-b"]);
    expect(ps.map((p) => zeroAdpProposalLine(p).text)).toEqual([
      "Cr2WO6-a: B(O2) is at its 0 bound: tie it to B(O1) (same element) or hold it at 0.600 Å²",
      "Cr2WO6-b: B(O1) is at its 0 bound: tie it to B(O2) (same element) or hold it at 0.553 Å²",
    ]);
    expect(zeroAdpFixLine(zeroAdpFix(ps[1]!, 0)).text).toBe("Cr2WO6-b: B(O1) hit 0 → tied to B(O2) = 0.70(5) Å² (same element); not measured on its own");
    // One phase: no prefix.
    expect(awo4Like().o2.phase).toBeUndefined();
  });
});

describe("the report's limitation for a B left on 0", () => {
  it("says why its value cannot be quoted, the warning in full for the appendix", () => {
    const { o2 } = awo4Like();
    const line = zeroAdpOpenLimitation(o2);
    expect(line.text).toBe("B(O2) refined to 0 with no option applied: its esd means nothing");
    expect(line.detail[0]).toMatch(/^B\(O2\) refined to 0 Å² \(its lower bound\)\. 2 options, none applied until you choose one: .* Not applied: the B is reported on its bound, where its esd means nothing\.$/);
  });
});
