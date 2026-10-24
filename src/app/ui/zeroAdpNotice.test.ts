import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZeroAdpNotice } from "@/app/ui/ZeroAdpNotice";
import type { ZeroAdpFix, ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";

/** The B-at-0 notice as the powder page renders it over the parameter list. */
const proposal = (rule: "A" | "B" | "C", id: string): ZeroAdpProposal => ({
  parameterId: id, sites: [id.slice(2)], atom: `B(${id.slice(2)})`, reached: 0, rule,
  ...(rule === "A" ? { leader: "B_O1" } : rule === "B" ? { value: 0.6 } : {}),
  source: `rule ${rule}: …`, advice: "…", warning: `B(${id.slice(2)}) refined to 0 Å² (its lower bound). Proposed (rule ${rule}): … If this B carries physical meaning (a conclusion rests on it), run the Bayesian check on it (sample_posterior) before quoting it: a parameter on its bound is not convincing, and its esd means nothing.`,
});
const html = (proposals: ZeroAdpProposal[], applied: ZeroAdpFix[] = []): string =>
  renderToStaticMarkup(createElement(ZeroAdpNotice, { proposals, applied, busy: false, onApply: () => undefined, onRelease: () => undefined }));

describe("the B-at-0 notice", () => {
  it("names each B at its bound with its proposal; Apply for rules A and B, none for C; Apply all for several", () => {
    const out = html([proposal("A", "B_O2"), proposal("B", "B_W1"), proposal("C", "B_Cr1")]);
    expect(out).toContain("⚠ B at its lower bound");
    expect(out).toContain("B(O2) refined to 0 Å² (its lower bound). Proposed (rule A)");
    expect(out).toContain("B(Cr1) refined to 0 Å² (its lower bound). Proposed (rule C)");
    expect(out.match(/>Apply</g)).toHaveLength(2);
    expect(out).toContain(">Apply all<");
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
