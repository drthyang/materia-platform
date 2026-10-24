import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZeroAdpNotice } from "@/app/ui/ZeroAdpNotice";
import type { ZeroAdpFix, ZeroAdpOption, ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";

/** The B-at-0 notice as the powder page renders it over the parameter list. */
const tie = (leader: string, rank: "preferred" | "alternative", label: string, caution?: string): ZeroAdpOption => ({
  id: `tie:${leader}`, rule: "A", rank, leader, label, ...(caution ? { caution } : {}), source: `rule A: ${leader}`, text: `tie it to B(${leader.slice(2)}), ${label}${caution ? ` — ${caution}` : ""}`,
});
const start: ZeroAdpOption = { id: "start", rule: "B", rank: "alternative", value: 0.6, label: "the starting structure's B", source: "rule B: …", text: "hold it at 0.600 Å², the B of the site in the loaded starting structure" };
const proposal = (id: string, options: ZeroAdpOption[]): ZeroAdpProposal => ({
  parameterId: id, sites: [id.slice(2)], atom: `B(${id.slice(2)})`, reached: 0, rule: options[0]?.rule ?? "C", options,
  source: options[0]?.source ?? "rule C: no value", advice: options.length ? "…" : "No value is proposed (no partner, no starting B, no documented table). If this B carries physical meaning (a conclusion rests on it), run the Bayesian check on it (sample_posterior) before quoting it: a parameter on its bound is not convincing, and its esd means nothing.", warning: "…",
});
const html = (proposals: ZeroAdpProposal[], applied: ZeroAdpFix[] = []): string =>
  renderToStaticMarkup(createElement(ZeroAdpNotice, { proposals, applied, busy: false, onApply: () => undefined, onRelease: () => undefined }));

describe("the B-at-0 notice", () => {
  it("lists every option ranked, the preferred first, each with its own Apply; nothing is applied for the user and there is no Apply all", () => {
    const out = html([
      proposal("B_O2", [tie("B_O1", "preferred", "same element (O²⁻)"), start]),
      proposal("B_W1", [tie("B_Co1", "alternative", "same coordination (6 O), different cation (W⁶⁺ vs Co²⁺)", "a different cation (W⁶⁺ vs Co²⁺): check it is physically sensible"), start]),
      proposal("B_Cr1", []),
    ]);
    expect(out).toContain("⚠ B at its lower bound — choose an option, or none");
    expect(out).toContain("B(O2) refined to 0 Å² (its lower bound).");
    // O2: the same-element tie first and labelled preferred; the starting value an alternative.
    const o2 = out.slice(out.indexOf("B(O2) refined"), out.indexOf("B(W1) refined"));
    expect(o2.indexOf("1 · preferred")).toBeLessThan(o2.indexOf("2 · alternative"));
    expect(o2).toContain("tie it to B(O1), same element (O²⁻)");
    // W1: the other cation only as a labelled alternative with its caution, next to the starting value; nothing preferred.
    const w1 = out.slice(out.indexOf("B(W1) refined"), out.indexOf("B(Cr1) refined"));
    expect(w1).not.toContain("preferred");
    expect(w1).toContain("1 · alternative");
    expect(w1).toContain("different cation (W⁶⁺ vs Co²⁺): check it is physically sensible");
    expect(w1).toContain("2 · alternative");
    expect(w1).toContain("hold it at 0.600 Å²");
    // Cr1: nothing to apply, and why.
    expect(out).toContain("No value is proposed (no partner, no starting B, no documented table).");
    expect(out.match(/>Apply</g)).toHaveLength(4);
    expect(out).not.toContain("Apply all");
    // The page's own wording for the Bayesian check: the Posterior view, not an Agent tool.
    expect(out).toContain("the Posterior view");
    expect(out).not.toContain("sample_posterior");
  });

  it("shows a fix in force with Release, and nothing at all when there is neither", () => {
    const fix: ZeroAdpFix = { parameterId: "B_O2", atom: "B(O2)", reached: 0, rule: "A", leader: "B_O1", source: "rule A: B(O1) (B_O1), same element (O)" };
    const out = html([], [fix]);
    expect(out).toContain("B(O2) refined to 0 Å² (its lower bound) and is tied to B_O1 by the B-at-0 rule");
    expect(out).toContain(">Release<");
    expect(html([])).toBe("");
  });
});
