import { describe, it, expect } from "vitest";
import { fillReferences, referenceCatalog, type ReferenceSource } from "@/agent/references";
import type { AgentReport } from "@/agent/report";
import { executor, fakeHost, singleCrystalPort } from "@/testSupport/agentHeadless";
import { corundumPage } from "@/testSupport/scPages";
import type { RefinementParameter } from "@/core/refinement/types";

const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;
const row = (id: string, value: number): RefinementParameter => ({ id, label: id, kind: "scale", value, initialValue: value, fixed: false });

describe("numbers by reference", () => {
  it("fills each reference from the page, its parameters as value(esd), and leaves the unknown ones as written", () => {
    let flackAsked = 0;
    const source: ReferenceSource = {
      entries: [
        { key: "wR2", what: "wR2 (%)", value: () => "9.75 %" },
        { key: "GoF", what: "goodness of fit", value: () => null },
        { key: "flack", what: "Flack x", value: () => { flackAsked++; return "0.00(13)"; } },
      ],
      parameters: [row("twin_1", 0.49651), row("scale", 0.0958869)],
      esd: { twin_1: 0.00121 },
    };
    const out = fillReferences("wR2 {{wR2}} ({{ WR2 }}), the twin {{p:twin_1}}, the scale {{p:scale}}, GoF {{GoF}}, {{Rwp}}.", source);
    expect(out.text).toBe("wR2 9.75 % (9.75 %), the twin 0.4965(12), the scale 0.0958869, GoF {{GoF}}, {{Rwp}}.");
    expect(out.unknown).toEqual(["GoF", "Rwp"]);
    expect(out.filled).toBe(4);
    // A value is worked out only when a reference asks for it.
    expect(flackAsked).toBe(0);
    expect(fillReferences("x = {{flack}}", source).text).toBe("x = 0.00(13)");
    expect(flackAsked).toBe(1);
    // No braces, nothing done; no page, nothing filled.
    expect(fillReferences("R1 4.32 %", source)).toEqual({ text: "R1 4.32 %", unknown: [], filled: 0 });
    expect(fillReferences("{{wR2}}", null)).toEqual({ text: "{{wR2}}", unknown: ["wR2"], filled: 0 });
    expect(referenceCatalog(source)).toBe("{{wR2}} wR2 (%); {{GoF}} goodness of fit; {{flack}} Flack x; {{p:ID}} a parameter row's value(esd), by its id");
  });

  it("fills a report's account and a note from the page, and refuses a reference the page cannot fill", async () => {
    const c = corundumPage();
    const { port } = singleCrystalPort(c.structure, c.dataset);
    const reports: AgentReport[] = [];
    const { ex } = executor(fakeHost(port).host, "auto", { onReport: (r) => reports.push(r) });
    // get_state names the page's references.
    expect(String(parse((await ex.run("get_state", {})).text).references)).toMatch(/^Quote the engine's numbers by reference; .*\{\{R1\}\} R1 \(%\) over Fo² > 2σ; \{\{wR2\}\} .*\{\{p:ID\}\} a parameter row's value\(esd\), by its id\.$/);
    await ex.run("set_free", { free: ["pos_*", "B_*"] });
    await ex.run("refine", {});
    const s = port.state();
    const wr2 = `${Math.round(s.agreement.wr2 * 10000) / 100} %`;

    // A reference the single-crystal page has no value of: refused, with the ones it has.
    const bad = await ex.run("write_report", { summary: "The fit reaches {{Rwp}} against the data, which is the powder page's figure, not this one's." });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/write_report: \{\{Rwp\}\} names no value the page has now\. The references here: \{\{R1\}\}/);

    const ok = await ex.run("write_report", { summary: "The refinement converged at wR2 {{wR2}} and R1 {{R1}}, GooF {{GooF}}, with the scale at {{p:scale}}." });
    expect(ok.isError).toBe(false);
    const answer = parse(ok.text);
    expect(answer.unverifiedNumbers).toBeUndefined();
    expect(reports.at(-1)!.markdown).toContain(`converged at wR2 ${wr2} and R1`);
    expect(reports.at(-1)!.markdown).not.toContain("{{");

    // A note keeps the number as it stands when written.
    await ex.run("write_note", { text: "Positions and B values refined: wR2 {{wR2}}." });
    const notes = (parse((await ex.run("get_state", {})).text).method as { notes?: string[] }).notes ?? [];
    expect(notes.at(-1)).toBe(`Positions and B values refined: wR2 ${wr2}.`);
    expect(ex.fill("now {{wR2}}, and {{nothing}}")).toBe(`now ${wr2}, and {{nothing}}`);
  });
});
