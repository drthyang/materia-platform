import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZeroAdpNotice } from "@/app/ui/ZeroAdpNotice";
import type { RefinementResult } from "@/core/refinement/types";
import type { ZeroAdpFix, ZeroAdpOption, ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";

/** The B-at-0 notice as the powder page renders it over the parameter list. */
const sameElement = (leader: string, rank: "preferred" | "alternative"): ZeroAdpOption => ({
  id: `tie:${leader}`, rule: "A", rank, leader, leaderAtom: `B(${leader.slice(2)})`, leaderValue: 0.62, leaderEsd: 0.05, shared: "element",
  label: "same element (O²⁻)", source: `rule A: ${leader}`, text: `tie it to B(${leader.slice(2)}), same element (O²⁻), which refined to 0.62(5) Å² (a constraint: the common B still refines)`,
});
const otherCation: ZeroAdpOption = {
  id: "tie:B_Co1", rule: "A", rank: "alternative", leader: "B_Co1", leaderAtom: "B(Co1)", leaderValue: 0.6, leaderEsd: 0.2, shared: "coordination", shell: "6 O", differs: "cation",
  label: "same coordination (6 O), different cation (W⁶⁺ vs Co²⁺)", caution: "a different cation (W⁶⁺ vs Co²⁺): check it is physically sensible",
  source: "rule A: B(Co1) (B_Co1), same coordination (6 O), different cation (W⁶⁺ vs Co²⁺), refined to 0.6(2) Å²",
  text: "tie it to B(Co1), same coordination (6 O), different cation (W⁶⁺ vs Co²⁺), which refined to 0.6(2) Å² (a constraint: the common B still refines) — a different cation (W⁶⁺ vs Co²⁺): check it is physically sensible",
};
const start: ZeroAdpOption = { id: "start", rule: "B", rank: "alternative", value: 1.453, label: "the starting structure's B", source: "rule B: …", text: "hold it at 1.453 Å², the B of the site in the loaded starting structure" };
const proposal = (id: string, options: ZeroAdpOption[]): ZeroAdpProposal => ({
  parameterId: id, sites: [id.slice(2)], atom: `B(${id.slice(2)})`, reached: 0, rule: options[0]?.rule ?? "C", options,
  source: options[0]?.source ?? "rule C: no value",
  advice: options.length ? "…" : "No value is proposed (no partner, no starting B, no documented table). If this B carries physical meaning (a conclusion rests on it), run the Bayesian check on it (sample_posterior) before quoting it: a parameter on its bound is not convincing, and its esd means nothing.",
  warning: `B(${id.slice(2)}) refined to 0 Å² (its lower bound). The long warning.`,
});
const html = (proposals: ZeroAdpProposal[], applied: ZeroAdpFix[] = [], result: RefinementResult | null = null): string =>
  renderToStaticMarkup(createElement(ZeroAdpNotice, { proposals, applied, busy: false, onApply: () => undefined, onRelease: () => undefined, result }));
/** The markup's text, tags dropped (a line keeps its last word with its marks). */
const text = (markup: string): string => markup.replace(/<[^>]+>/g, "");
const between = (s: string, a: string, b: string): string => s.slice(s.indexOf(a), s.indexOf(b));

describe("the B-at-0 notice", () => {
  it("lists every option ranked, the preferred first, each in one short line with its own Apply; nothing is applied for the user and there is no Apply all", () => {
    const out = html([proposal("B_O2", [sameElement("B_O1", "preferred"), start]), proposal("B_W1", [otherCation, start]), proposal("B_Cr1", [])]);
    const t = text(out);
    expect(t).toContain("⚠ B at its lower bound — choose an option, or none");
    expect(t).toContain("B(O2) is at its 0 bound");
    // O2: the same-element tie first and labelled preferred; the starting value an alternative.
    const o2 = between(t, "B(O2) is at", "B(W1) is at");
    expect(o2.indexOf("1 · preferred")).toBeLessThan(o2.indexOf("2 · alternative"));
    expect(o2).toContain("Tie to B(O1) = 0.62(5) Å² (same element)");
    expect(o2).toContain("Hold at 1.453 Å² (starting value)");
    // W1: the other cation only as an alternative, its caution a ⚠ with the caution as its tooltip, never a parenthetical.
    const w1 = between(out, "B(W1) is at", "B(Cr1) is at");
    expect(text(w1)).not.toContain("preferred");
    expect(text(w1)).toContain("Tie to B(Co1) = 0.6(2) Å² (same 6-O coordination, different cation)⚠");
    expect(w1).toContain('title="a different cation (W⁶⁺ vs Co²⁺): check it is physically sensible"');
    expect(text(w1)).not.toContain("physically sensible");
    // Cr1: nothing to apply, and why, in a line.
    expect(t).toContain("B(Cr1) is at its 0 bound: no value to propose — find the cause first");
    expect(out.match(/>Apply</g)).toHaveLength(4);
    expect(out).not.toContain("Apply all");
    // The rule's own sentences are behind the "?": the option's account, the warning, the advice.
    expect(out).toContain('aria-label="Tie it to B(O1), same element (O²⁻), which refined to 0.62(5) Å² (a constraint: the common B still refines)."');
    expect(out).toContain('aria-label="B(O2) refined to 0 Å² (its lower bound). The long warning."');
    expect(out).toContain('aria-label="No value is proposed (no partner, no starting B, no documented table)."');
    // No rule letters on the lines themselves.
    expect(t).not.toMatch(/rule [ABC]/);
    // The page's own wording for the Bayesian check: the Posterior view, not an Agent tool.
    expect(t).toContain("Quoting a B? Sample its posterior first (the Posterior view).");
    expect(out).not.toContain("sample_posterior");
  });

  it("shows a fix in force in one line with Release: the tie's value as it stands, its caution a ⚠, the options not taken and the whole account behind the \"?\"", () => {
    const fix: ZeroAdpFix = {
      parameterId: "B_W1", atom: "B(W1)", reached: 0, rule: "A", leader: "B_Co1",
      source: "alternative: rule A: B(Co1) (B_Co1), same coordination (6 O), different cation (W⁶⁺ vs Co²⁺), refined to 0.6(2) Å² (a different cation (W⁶⁺ vs Co²⁺): check it is physically sensible)",
      alternatives: ["alternative: hold at 1.453 Å² (the starting structure's B)"],
      facts: { rule: "A", rank: "alternative", leader: "B_Co1", leaderAtom: "B(Co1)", leaderValue: 0.6, leaderEsd: 0.2, shared: "coordination", shell: "6 O", differs: "cation" },
      caution: "a different cation (W⁶⁺ vs Co²⁺): check it is physically sensible",
      others: [{ rule: "B", rank: "alternative", value: 1.453 }],
    };
    const out = html([], [fix]);
    expect(text(out)).toContain("B(W1) hit 0 → tied to B(Co1) = 0.6(2) Å² (same 6-O coordination, different cation); not measured on its own⚠");
    expect(out).toContain(">Release<");
    // The "?" holds the options not taken and the rule's whole account (a tooltip rendered on hover; its label in the markup).
    expect(out).toContain('aria-label="In full"');
    // Refined again with the tie: the line gives the common B as the fit has it now.
    const refit = { parameters: { B_Co1: 0.55 }, esd: { B_Co1: 0.04 } } as unknown as RefinementResult;
    expect(text(html([], [fix], refit))).toContain("tied to B(Co1) = 0.55(4) Å²");
    expect(html([])).toBe("");
  });

  it("a fix saved before the short lines still reads in one line", () => {
    const old: ZeroAdpFix = { parameterId: "B_O2", atom: "B(O2)", reached: 0, rule: "A", leader: "B_O1", source: "rule A: B(O1) (B_O1), same element (O)" };
    expect(text(html([], [old]))).toContain("B(O2) hit 0 → tied to B_O1; not measured on its own");
    const held: ZeroAdpFix = { parameterId: "B_O2", atom: "B(O2)", reached: 0, rule: "B", value: 0.8, source: "rule B: …" };
    expect(text(html([], [held]))).toContain("B(O2) hit 0 → held at 0.800 Å² (starting value); not measured");
  });
});
