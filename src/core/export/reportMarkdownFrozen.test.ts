import { describe, it, expect } from "vitest";
import { frozenReportMarkdown } from "@/core/export/reportMarkdownFrozen";
import { reportMarkdown } from "@/core/export/reportMarkdown";
import { buildAgentReport } from "@/agent/report";
import { emptyRecord } from "@/agent/method";
import type { ReportInput } from "@/core/export/report";
import { AGENT, DATE, cmcm, magneticAgentInput, pdfCandidateInput, powderInput, sharedUInput, singleCrystalInput } from "@/testSupport/reportFixtures";

/**
 * The frozen layout, held to goldens written from the report as it was on
 * 2026-10-24 (b525ac2): the number audit and the Agent validation read this
 * text, so it must not move while the validation runs (reportMarkdownFrozen.ts).
 * The figures are left out, as the evals leave them out (harness withoutFigures).
 */
const withoutFigures = (md: string): string => md.replace(/\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)/g, "(figure)");

function inputs(): Record<string, ReportInput> {
  const { structure, k, cand, params, magnetic } = cmcm();
  return {
    "powder": powderInput(),
    "powder-agent": { ...powderInput(), agent: AGENT },
    "powder-magnetic-agent": magneticAgentInput(),
    "powder-magnetic": {
      ...powderInput(),
      phases: [{ structure, params: [], bindings: [] }],
      magnetic: { magnetic, k, group: { symbol: "Cm′cm′", numbers: "BNS 63.462 · OG 63.9.520", index: cand.index }, params, status: "Refined jointly with the atomic structure against the powder pattern." },
    },
    "pdf-agent": { ...powderInput(), technique: "pdf", agent: { ...AGENT, agreementLabel: "Rw", steps: AGENT.steps.map(({ gof: _g, ...st }) => st), posterior: null, narrative: "", unverified: [], start: { agreement: 0.1648 } } },
    "pdf-candidate": pdfCandidateInput(),
    "single-crystal": singleCrystalInput(),
    "single-crystal-shared-u": sharedUInput(),
  };
}

describe("the frozen report layout (the audit's and the validation's text)", () => {
  for (const [name, input] of Object.entries(inputs())) {
    it(`${name} is as it was`, async () => {
      await expect(withoutFigures(frozenReportMarkdown(input))).toMatchFileSnapshot(`__goldens__/frozen-${name}.md`);
    });
  }

  it("the audit reads it: what write_report checks the account against is as it was", async () => {
    const input: ReportInput = { ...powderInput(), date: DATE };
    const record = { ...emptyRecord("k"), notes: [{ text: "Unexplained line at d = 2.2012 Å.", at: 0 }], start: { at: 0, agreement: 0.1648 } };
    const built = buildAgentReport({
      page: "powder", input, history: null, record, posterior: null, model: "M", date: DATE,
      checks: [{ name: "Convergence", status: "pass", detail: "Converged in 2 cycles." }, { name: "Method exception", status: "note", detail: "allowed by the user, because 1.234" }],
      narrative: "wR reached 3.86 %; the line at 2.2012 Å stays open; a = 8.4807 Å.", userText: "The published wR is 3.92 %.",
    });
    expect(built.unverified).toEqual(["2.2012", "8.4807"]);
    await expect(built.audit.against).toMatchFileSnapshot("__goldens__/frozen-audit-against.md");
    // The report the evals and the validation read is the frozen one; the viewer saves the current layout.
    expect(built.markdown).toBe(frozenReportMarkdown(built.input));
    expect(built.markdownFile).toBe(reportMarkdown(built.input));
    expect(built.markdownFile).toContain("## Quality and caveats");
  });
});
