import { describe, it, expect } from "vitest";
import type { LinearRestraint, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { StructureModel } from "@/core/crystal/types";
import { exampleStructure } from "@/examples/mn3ga";
import { reportHtml, formatParameterValue, qualityItems, type ReportInput } from "@/core/export/report";
import { reportMarkdown } from "@/core/export/reportMarkdown";
import { formatWithEsd } from "@/core/export/cif";
import { uEquivalent } from "@/core/crystal/adp";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { niceTicks, patternFigureSvg } from "@/core/export/reportFigures";
import { atomTable, cellLineText, cellTerms } from "@/core/export/reportTables";
import { asFraction, formulaHtml, formulaParts, formulasText, minus, spaceGroupHtml, spaceGroupText, symbolHtml, symbolText } from "@/core/export/reportTypeset";
import { correlationCaveats, meaningfulCorrelations, pdfResultParagraph, powderCaveats, powderResultParagraph, singleCrystalCaveats, singleCrystalResultParagraph, type PowderResultInput } from "@/core/export/reportResult";
import { powderAcceptance } from "@/core/diagnostics/powderAcceptance";
import type { ValidationVerdict } from "@/core/diagnostics/validationChecks";
import { groupOfOperations, magneticReportSection, pdfReportInput, powderMomentLimits, reportFileName, subjectOf } from "@/app/reportInputs";
import { AGENT, AGENT_CHECKS, DATE, cmcm, magneticAgentInput, pdfCandidateInput, powderInput, sharedUInput, singleCrystalInput } from "@/testSupport/reportFixtures";

/** The report as a reader opens it: what comes before the appendix, and the appendix (whose parts are collapsed). */
function parts(html: string): { summary: string; appendix: string } {
  const i = html.indexOf('<section id="appendix"');
  expect(i).toBeGreaterThan(0);
  return { summary: html.slice(0, i), appendix: html.slice(i) };
}
function mdParts(md: string): { summary: string; appendix: string } {
  const i = md.indexOf("## Appendix");
  expect(i).toBeGreaterThan(0);
  return { summary: md.slice(0, i), appendix: md.slice(i) };
}
/** The text a reader sees: tags dropped, entities read. */
const text = (html: string): string => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

describe("refinement report (HTML)", () => {
  it("is a complete document: the result, the structure, the fit, the caveats, then the appendix, everything escaped", () => {
    const html = reportHtml(powderInput());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Mn&lt;3&gt;Ga &lt;test&gt; · Rietveld refinement report</title>");
    expect(html).not.toContain("Mn<3>Ga");
    expect(html).toContain("MATERIA · Rietveld refinement · 2026-09-16");
    const order = ["<h2>Result</h2>", "<h2>Structure</h2>", "<h2>Fit</h2>", "<h2>Quality and caveats</h2>", "<h2>Appendix</h2>", ">Data and model<", ">Refinement statistics<", ">Every parameter<", ">Conventions and software<"].map((t) => html.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("<h2>Magnetic structure</h2>"); // no magnetic model → no section
    // A paper, not a dashboard: no tiles, no cards; booktabs tables.
    expect(html).not.toContain('class="stat"');
    expect(html).not.toContain('class="card');
    expect(html).toContain('<table class="bt atoms">');
    // Without the app's judgment the Result falls back to the summary sentence.
    expect(html).toContain('<p class="lede">Rietveld refinement summary sentence.</p>');
  });

  it("gives the cell as its independent parameters and the atoms in crystallographic convention", () => {
    const html = reportHtml(powderInput());
    const a = formatWithEsd(exampleStructure().cell.a, 0.00031, 5);
    // Hexagonal: a = b with its esd, c held, V; no angle the symmetry fixes.
    expect(text(html)).toContain(`a = b = ${a} Å, c = ${exampleStructure().cell.c.toFixed(5)} Å, V = `);
    expect(html).not.toContain("90.0000");
    expect(html).not.toContain("120.0000");
    // The atom table: Wyckoff positions, fractions where the symmetry fixes a coordinate, B with its esd.
    expect(html).toContain("<th>Wyckoff</th>");
    expect(text(html)).toMatch(/Mn16h0\.\d{4}0\.\d{4}1\/4/);
    expect(text(html)).toContain("Ga12d1/32/33/4"); // 2d: 1/3, 2/3, 3/4 from the CIF's 0.3333, 0.6667
    expect(text(html)).toContain("0.62(5)");
    // Numbers aligned on the decimal point: the integer and fractional parts in boxes.
    expect(html).toMatch(/<td class="n"><span class="ip" style="min-width:\d+(\.\d+)?ch">0<\/span><span class="fp" style="min-width:\d+ch">\.62\(5\)<\/span><\/td>/);
    // What the numbers are, said once.
    expect(html.match(/Fractions: coordinates fixed by the site symmetry/g)).toHaveLength(1);
    expect(html.match(/no esds, as the covariance is not carried to the lengths/g)).toHaveLength(1);
    // The shells as small tables, not a run-on line.
    expect(html).toContain('<table class="bt mini">');
    expect(html).not.toContain(" · Ga1 ");
  });

  it("puts the agreement indices in one line and the other refined values in a compact table", () => {
    const html = reportHtml({ ...powderInput(), indices: [{ symbol: "R_wp", value: "3.86 %" }, { symbol: "χ^2", value: "1.96" }, { symbol: "GoF", value: "1.40" }, { symbol: "points", value: "301", count: true }] });
    expect(html).toContain('<p class="indices"><span class="nw"><i>R</i><sub>wp</sub> = 3.86 %</span>, <span class="nw"><i>χ</i><sup>2</sup> = 1.96</span>, <span class="nw">GoF = 1.40</span> · <span class="nw">301 points</span></p>');
    expect(html).toContain("<h3>Other refined values</h3>");
    expect(text(html)).toContain("scale0.01234(12)");
    // The stats stand in without indices.
    expect(text(reportHtml(powderInput()))).toContain("wR = 3.86 %, GoF (S) = 1.40");
  });

  it("keeps everything in the appendix: every parameter with its status, the statistics, the data, the conventions", () => {
    const { summary, appendix } = parts(reportHtml(powderInput()));
    for (const moved of ["bkg c0", "tied · = cell_a", "Final χ² (Σ w Δ²)", "1234.50", "scale / B_iso Mn1 0.930", "wR definition note.", "MATERIA Workbench v0.1.0", "PG3_1.gsa"]) {
      expect(summary, moved).not.toContain(moved);
      expect(appendix, moved).toContain(moved);
    }
    // Collapsed on screen, opened for print.
    const details = appendix.match(/<details[^>]*>/g) ?? [];
    expect(details.length).toBe(4);
    for (const d of details) expect(d).not.toMatch(/\bopen\b/);
    expect(reportHtml(powderInput())).toMatch(/@media print \{[^]*details::details-content \{ content-visibility: visible; display: block; \}/);
  });

  it("lists the page's limitations among the caveats", () => {
    expect(reportHtml(powderInput())).toContain('<li class="t-warn"><span class="dot" title="attention"></span><span class="lbl">Limitation</span> Scale and B_iso are strongly correlated.</li>');
  });

  it("draws the fit figure with excluded regions, tick rows and a legend", () => {
    const html = reportHtml(powderInput());
    expect(html).toContain('aria-label="Observed, calculated and difference curves"');
    expect(html).toContain('class="excl"');
    expect(html).toContain(">Mn3Ga</text>");
    expect(html).toContain(">observed</text>");
    expect(html).toContain('<path class="calc"');
    expect(html).toContain('<path class="diff"');
  });

  it("renders the magnetic section: k, the group with its primes, the moments with |m|, the projection", () => {
    const { structure, k, cand, params, magnetic } = cmcm();
    const html = reportHtml({
      ...powderInput(),
      phases: [{ structure, params: [], bindings: [] }],
      magnetic: { magnetic, k, group: { symbol: "Cm'cm'", numbers: "BNS 63.462 · OG 63.9.520", index: cand.index }, params, status: "Refined jointly with the atomic structure against the powder pattern." },
    });
    expect(html).toContain("<h2>Magnetic structure</h2>");
    expect(html).toContain("magnetic space group Cm′cm′");
    expect(html).toContain("BNS 63.462");
    expect(html).toContain("<i>k</i> = (0 0 0)");
    expect(html).toContain("magnetic cell: the nuclear cell (k = 0)");
    expect(html).toContain("Refined jointly with the atomic structure");
    expect(html).toContain("<polygon");
    expect(html).toContain('aria-label="Projection of the magnetic structure down c-star with moment arrows"');
    // Every carried sublattice at 2.500 µB, in the |m| column.
    expect((html.match(/<span class="ip" style="min-width:1ch">2<\/span><span class="fp" style="min-width:4ch">\.500<\/span><\/td><\/tr>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Moment parameter");
  });

  it("renders the single-crystal figure and groups its parameters: no background or peak shape", () => {
    const base = powderInput();
    const html = reportHtml({ ...base, technique: "singleCrystal", figure: { kind: "fobsFcalc", points: [{ obs: 100, calc: 98 }, { obs: 25, calc: 30, magnetic: true }, { obs: 4, calc: 4.5 }], caption: "F plot." } });
    expect(html).toContain("Single-crystal refinement");
    expect(html).toContain("3 reflections · 1 magnetic");
    expect(html).toContain('<path class="ptmag"');
    const p = (id: string, kind: RefinementParameter["kind"], label: string): RefinementParameter => ({ id, label, kind, value: 0.1, initialValue: 0.1, fixed: false, esd: 0.01 });
    const parameters = [p("scale", "scale", "scale k = OSF²"), p("twin_1", "twinFraction", "inversion twin fraction (Flack x)"), p("extinction", "extinction", "extinction (SHELXL x)"), p("pos_A_0", "positionShift", "A x"), p("rot_C1", "ridingTorsion", "C1 methyl torsion (AFIX 137)")];
    const sc = reportHtml({ ...base, technique: "singleCrystal", parameters });
    for (const title of ["Scale", "Twin fractions", "Extinction", "Atoms", "Riding groups"]) expect(sc).toContain(`<h4>${title} <span class="meta">`);
    expect(sc).not.toContain("Peak shape");
    expect(reportMarkdown({ ...base, technique: "singleCrystal", parameters })).toContain("**Twin fractions** — 1 parameter, 1 refined");
  });
});

describe("the analysis as the Agent ran it", () => {
  const withAgent = (): ReportInput => ({ ...powderInput(), agent: AGENT });

  it("gives the Copilot's account as the Result, the open issues and the Bayesian check among the caveats, the record in the appendix", () => {
    const html = reportHtml(withAgent());
    const { summary, appendix } = parts(html);
    expect(html).toContain("MATERIA · Rietveld refinement · analysed with MATERIA Copilot · 2026-09-16");
    // The account, labelled, its unverified numbers marked.
    expect(summary).toContain("The Copilot's account");
    expect(summary).toContain("<p>I refined the structure stage by stage.</p>");
    expect(summary).toContain('<span class="unverified" title="Not among the values this report computed">7.77</span>');
    expect(summary).toContain("in its own words, as are its notes");
    // The open issue as a caveat; the Bayesian check with its caveat.
    expect(summary).toContain('<span class="lbl">Residual peaks</span> 1 peak on no phase\'s reflection: d = 2.2012&nbsp;Å.');
    expect(summary).toContain("Bayesian check");
    expect(summary).toContain("12 walkers × 2300 steps");
    expect(summary).toContain("0.571 – 0.672");
    expect(summary).toContain("not final values to quote");
    expect(summary).toContain("P(B_Mn1 &gt; B_Ga1) = 0.98");
    // The steps, the method, every check (escaped) and the notes: the appendix's.
    for (const moved of ["3 steps from the History · model Claude Opus 5.5 · Anthropic API", "positions ×8, B ×5, scale", "12.03", "✓ Cell check", "○ Occupancy, if needed", "2 steps on branches the analysis left are kept in the History, not shown.", "d = 2.2012 Å <unexplained>.", "The Copilot's notes"]) {
      expect(text(summary), moved).not.toContain(moved);
      expect(text(appendix), moved).toContain(moved);
    }
    expect(appendix).toContain('<span class="stage done">✓ Cell check</span>');
    expect(appendix).toContain("d = 2.2012 Å &lt;unexplained&gt;.");
    expect(appendix).toContain('<th class="n">GoF</th>');
    expect(appendix).toContain('pattern &amp; at <span class="unverified" title="Not among the values this report computed">9.99</span> Å');
    expect(html).not.toContain("<unexplained>");
  });

  it("drops the GoF column on the PDF page and names its agreement Rw", () => {
    const html = reportHtml({ ...powderInput(), agent: { ...AGENT, agreementLabel: "Rw", steps: AGENT.steps.map(({ gof: _g, ...st }) => st), posterior: null, narrative: "", unverified: [] } });
    expect(html).toContain('<th class="n">Rw (%)</th>');
    expect(html).not.toContain(">GoF</th>");
    expect(html).not.toContain("Bayesian check");
    expect(html).not.toContain("The Copilot's account");
  });

  it("carries the same report as Markdown, the figure embedded and the unverified numbers marked †", () => {
    const md = reportMarkdown(withAgent());
    expect(md.startsWith("# Mn<3>Ga <test>\n")).toBe(true);
    expect(md).toContain("*MATERIA · Rietveld refinement · analysed with MATERIA Copilot · 2026-09-16*");
    const order = ["## Result", "## Structure", "## Fit", "## Quality and caveats", "## Appendix", "### A. Data and model", "### B. Refinement statistics", "### C. The analysis step by step", "### D. Every parameter", "### E. Conventions and software"].map((t) => md.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(md).toContain("> I refined the structure stage by stage.\n>\n> The fit reaches wR 3.86 % with B = 0.62(5) Å²; the extra line at 7.77† Å is open.");
    expect(md).toContain("- The 2.2012 Å line is also in the 300 K pattern & at 9.99† Å.");
    expect(md).toContain("| # | Step | By | Refined | Free | wR (%) | GoF |");
    expect(md).toContain("| 3 | Refine · Positions · ADPs | Copilot | positions ×8, B ×5, scale | 14 | 3.86 | 1.40 |");
    expect(md).toContain("- **Residual peaks:** 1 peak on no phase's reflection: d = 2.2012 Å.");
    expect(md).toContain("**Bayesian check** — ensemble MCMC, 12 walkers × 2300 steps");
    // The cell line and the atom table, as in the HTML.
    expect(md).toContain(`a = b = ${formatWithEsd(exampleStructure().cell.a, 0.00031, 5)} Å, c = `);
    expect(md).toMatch(/\| Site \| Wyckoff \| x \| y \| z \| Occ\. \| B_iso \(Å²\) \|/);
    expect(md).toMatch(/!\[Observed, calculated and difference pattern\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)/);
    const svg = new TextDecoder().decode(Uint8Array.from(atob(md.match(/base64,([A-Za-z0-9+/=]+)\)/)![1]!), (c) => c.charCodeAt(0)));
    expect(svg).toContain("<style>");
    expect(md).toContain("| B_iso Mn1 | 0.62(5) | Å² | refined |");
    expect(md).toContain("| b (= a) | 5.43210 | Å | tied · = cell_a |");
    expect(reportMarkdown({ ...powderInput(), data: [{ label: "Data | file", value: "a|b" }] })).toContain("| **Data \\| file** | a\\|b |");
  });

  it("keeps the results, their uncertainties and every consequential limit before the appendix", () => {
    const input = magneticAgentInput();
    const { summary } = parts(reportHtml(input));
    const md = mdParts(reportMarkdown(input)).summary;
    const required = [
      formatWithEsd(exampleStructure().cell.a, 0.00031, 5), "0.62(5)", "0.01234(12)", "Cm′cm′", formatWithEsd(2.5, 0.04, 3),
      "cannot fix the absolute moment direction", "B_iso Ga1 at its lower bound 0", "d = 2.2012 Å", "Scale and B_iso are strongly correlated.",
      "0.571", "The structure refines to wR 3.86 %",
    ];
    for (const item of required) {
      expect(text(summary), item).toContain(item);
      expect(md, item).toContain(item);
    }
  });
});

describe("report tables: the cell and the atoms in crystallographic convention", () => {
  const withGroup = (hm: string, cell: StructureModel["cell"]): StructureModel => ({ ...exampleStructure(), cell, spaceGroup: buildSpaceGroup(hm, cell), sites: [] });
  const cellOf = (st: StructureModel, esd: Record<string, number> = {}): string => {
    const params: RefinementParameter[] = Object.entries(esd).map(([k, e]) => ({ id: `cell_${k}`, label: k, kind: "cellLength", value: st.cell[k as "a"], initialValue: st.cell[k as "a"], fixed: false, esd: e }));
    const bindings = params.map((p) => ({ parameterId: p.id, kind: "cellLength" as const, targetId: st.id, targetKey: p.label }));
    return cellLineText(cellTerms({ structure: st, params, bindings }));
  };

  it("names the parameters the symmetry holds equal once, and leaves out the angles it fixes", () => {
    expect(cellOf(withGroup("P 63/m m c", { a: 5.41964, b: 5.41964, c: 4.37366, alpha: 90, beta: 90, gamma: 120 }), { a: 0.00005, b: 0.00005, c: 0.00007 }))
      .toMatch(/^a = b = 5\.41964\(5\) Å, c = 4\.37366\(7\) Å, V = 111\.25\d\(\d\) Å³$/);
    expect(cellOf(withGroup("F m -3 m", { a: 4.4561, b: 4.4561, c: 4.4561, alpha: 90, beta: 90, gamma: 90 }))).toBe("a = b = c = 4.45610 Å, V = 88.484 Å³");
    expect(cellOf(withGroup("P n m a", { a: 5.5, b: 7.7, c: 5.4, alpha: 90, beta: 90, gamma: 90 }))).toBe("a = 5.50000 Å, b = 7.70000 Å, c = 5.40000 Å, V = 228.690 Å³");
    // Monoclinic: β is free, α and γ are not.
    const mono = cellOf(withGroup("P 1 21/c 1", { a: 7, b: 9, c: 11, alpha: 90, beta: 110, gamma: 90 }));
    expect(mono).toContain("β = 110.0000°");
    expect(mono).not.toMatch(/[αγ]/);
    // Triclinic: all six.
    const tri = cellOf(withGroup("P -1", { a: 5, b: 6, c: 7, alpha: 80, beta: 85, gamma: 95 }));
    for (const t of ["a = 5.00000 Å", "b = 6.00000 Å", "c = 7.00000 Å", "α = 80.0000°", "β = 85.0000°", "γ = 95.0000°"]) expect(tri).toContain(t);
  });

  it("prints a refined coordinate with its esd, a symmetry-fixed one as a fraction, a held free one with four decimals", () => {
    const st = exampleStructure();
    const mn = st.sites.find((s) => s.label === "Mn1")!;
    const shift: RefinementParameter = { id: "pos_Mn1", label: "Mn1 x", kind: "positionShift", value: 0, initialValue: 0, fixed: false, esd: 0.00004 };
    const t = atomTable({ structure: st, params: [shift], bindings: [{ parameterId: "pos_Mn1", kind: "positionShift", targetId: st.id, targetKey: "Mn1", axis: [1, 2, 0] }] }, "powder");
    const row = t.rows.find((r) => r.label === "Mn1")!;
    expect(row.x).toBe(formatWithEsd(mn.position[0], 0.00004, 5)); // x of (x, 2x, 1/4), refined
    expect(row.y).toBe(formatWithEsd(mn.position[1], 0.00008, 5)); // y = 2x carries twice its esd
    expect(row.z).toBe("1/4");
    expect(row.wyckoff).toBe("6h");
    const ga = t.rows.find((r) => r.label === "Ga1")!;
    expect([ga.x, ga.y, ga.z]).toEqual(["1/3", "2/3", "3/4"]);
    expect(t.symmetryFixed).toBe(true);
    // Unrefined, a free coordinate is the value held: four decimals, no esd.
    expect(atomTable({ structure: st, params: [], bindings: [] }, "powder").rows.find((r) => r.label === "Mn1")!.x).toBe(mn.position[0].toFixed(4));
  });

  it("typesets symbols, formulas and space groups as a paper does", () => {
    expect(spaceGroupHtml("P 63/m m c")).toBe('<span class="sg"><i>P</i>6<sub>3</sub>/<i>mmc</i></span>');
    expect(spaceGroupHtml("F m -3 m")).toBe('<span class="sg"><i>Fm</i><span class="ovl">3</span><i>m</i></span>');
    expect(spaceGroupText("P 63/m m c")).toBe("P6₃/mmc");
    expect(spaceGroupText("R -3 c:H")).toBe("R-3c:H");
    expect(spaceGroupText("P 1 21/c 1")).toBe("P12₁/c1");
    expect(formulaHtml("Mn3Ga")).toBe("Mn<sub>3</sub>Ga");
    expect(formulaParts("Eu324")).toBeNull(); // a sample name, not a formula
    expect(formulaParts("AWO4")).toBeNull();
    expect(formulasText("the Mn3Ga Ga1 occupancy")).toBe("the Mn₃Ga Ga1 occupancy"); // a site label is never a formula
    expect(symbolHtml("R_wp")).toBe("<i>R</i><sub>wp</sub>");
    expect(symbolHtml("GoF")).toBe("GoF");
    expect(symbolText("R_wp")).toBe("Rwp");
    expect(symbolText("wR_2")).toBe("wR2");
    expect(symbolText("χ^2")).toBe("χ²");
    expect(asFraction(0.3333)).toBe("1/3");
    expect(asFraction(-0.25)).toBe("−1/4");
    expect(asFraction(0.1665)).toBe("1/6"); // a fixed coordinate a CIF rounded
    expect(asFraction(0.1665, 5e-5)).toBeNull(); // a free one is not read as a fraction
    expect(minus("-0.0123(4) and x = -1")).toBe("−0.0123(4) and x = −1");
  });
});

describe("correlations worth reading", () => {
  const p = (id: string, kind: RefinementParameter["kind"]): RefinementParameter => ({ id, label: id, kind, value: 1, initialValue: 1, fixed: false });
  const result = (pairs: [string, string, number][]): RefinementResult =>
    ({ status: "converged", parameters: {}, esd: {}, agreement: { rFactor: 0 }, history: [], diagnostics: { svdZeroCount: 0, highCorrelations: pairs.map(([a, b, c]) => ({ parameterIdA: a, parameterIdB: b, coefficient: c })) } }) as unknown as RefinementResult;

  it("leaves out one curve's coefficients and a restraint's pair, keeps the structural pairs", () => {
    const params = [p("bkg0", "background"), p("bkg1", "background"), p("U", "profileU"), p("W", "profileW"), p("scale", "scale"), p("B_Mn1", "bIso"), p("occ_A", "occupancy"), p("occ_C", "occupancy")];
    const restraint: LinearRestraint = { id: "r", label: "Σ occ", target: 1, sigma: 0.01, terms: [{ parameterId: "occ_A", coefficient: 1 }, { parameterId: "occ_C", coefficient: 1 }] };
    const c = meaningfulCorrelations(result([["bkg0", "bkg1", 0.995], ["U", "W", -0.97], ["scale", "B_Mn1", 0.962], ["occ_A", "occ_C", -0.99]]), params, [restraint]);
    expect(c.pairs.map((x) => `${x.a}/${x.b}`)).toEqual(["scale/B_Mn1"]);
    expect(c.curveOnly).toBe(true);
    expect(correlationCaveats(c)[0]!.text).toBe("scale ↔ B_Mn1 0.962 (|ρ| ≥ 0.95: esds inflated)");
    // Only the background's among themselves: said so, not listed.
    const none = meaningfulCorrelations(result([["bkg0", "bkg1", 0.995]]), params);
    expect(none.pairs).toEqual([]);
    expect(correlationCaveats(none)[0]).toEqual({ tone: "ok", label: "Correlations", text: "none at |ρ| ≥ 0.95 (the background coefficients among themselves aside)" });
  });
});

describe("the Result paragraph per verdict state", () => {
  const scale: RefinementParameter = { id: "scale", label: "scale", kind: "scale", value: 1.2, initialValue: 1, fixed: false };
  const occ: RefinementParameter = { id: "occ_Ga1", label: "Mn3Ga: Ga1 occ", kind: "occupancy", value: 1.005, initialValue: 1.005, fixed: true };
  const fit = (gof: number, status: RefinementResult["status"] = "converged", shift = 0.001): RefinementResult =>
    ({ status, parameters: { scale: 1.2 }, esd: { scale: 0.01 }, agreement: { rFactor: 0.03, rWeighted: 0.0401, rExpected: 0.0401 / gof, goodnessOfFit: gof }, history: [{}, {}], diagnostics: { svdZeroCount: 0, highCorrelations: [], maxShiftOverEsd: shift } }) as unknown as RefinementResult;
  function input(o: { gof: number | null; result: RefinementResult | null; parameters?: RefinementParameter[]; snapshot?: boolean; cause?: PowderResultInput["headlineCause"] }): PowderResultInput {
    const parameters = o.parameters ?? [scale];
    const acceptance = powderAcceptance({ gof: o.gof ?? 0, result: o.result, parameters, structures: [], snapshot: o.snapshot ?? false, topCause: o.cause, canExport: true });
    return {
      subject: "Mn₃Ga (P6₃/mmc)", against: "neutron time-of-flight data", free: 9, points: 3125, rwp: 0.0401, rexp: o.gof ? 0.0401 / o.gof : null, gof: o.gof,
      result: o.result, parameters, acceptance, headlineCause: o.cause,
      causes: o.cause ? [{ title: "Peak tails", phrase: o.cause.phrase, share: o.cause.share, evidence: "The observed peaks have longer tails than the model's." }] : [],
    };
  }

  it("a fair fit: the verdict against the bar, the misfit's cause, the held input, the esds, the cross-check", () => {
    const i = input({ gof: 3.05, result: fit(3.05), parameters: [scale, occ], cause: { phrase: "the peak tails", share: 0.85, first: false } });
    expect(powderResultParagraph(i)).toBe(
      "Rietveld refinement of Mn₃Ga (P6₃/mmc) against neutron time-of-flight data: 9 free parameters over 3125 points. " +
      "It converged in 2 cycles at {{R_wp}} = 4.01 % ({{R_exp}} = 1.31 %, GoF = 3.05). " +
      "The fit is fair, above the acceptance bar (good ≤ 2.5): most of the misfit is in the peak tails (about 85 % of χ²). " +
      "The Mn3Ga Ga1 occupancy is held at 1.005, outside [0, 1] (an input, not refined); the esds are likely too small; and the cross-check in GSAS-II and FullProf is still to do.",
    );
    const caveats = powderCaveats(i);
    expect(caveats.map((c) => c.label)).toEqual(["Goodness of fit", "Peak tails", "Physical sanity", "Esds", "Correlations", "Cross-check"]);
    expect(caveats[0]).toEqual({ tone: "warn", label: "Goodness of fit", text: "GoF 3.05, fair: above the acceptance bar (good ≤ 2.5)" });
    expect(caveats[1]!.text).toBe("about 85 % of χ² — the observed peaks have longer tails than the model's");
    expect(caveats[2]!.text).toBe("Mn3Ga Ga1 occupancy held at 1.005 (0.5% over 1: an input the fit never moved)");
  });

  it("a good fit, physically sane: within the bar, the cross-check the step left", () => {
    const p = powderResultParagraph(input({ gof: 1.8, result: fit(1.8) }));
    expect(p).toContain("GoF = 1.80). The fit is good, within the acceptance bar (good ≤ 2.5) and physically sane.");
    expect(p).toContain("The cross-check in GSAS-II and FullProf is the step left.");
  });

  it("an excellent, a poor and a too-good fit", () => {
    expect(powderResultParagraph(input({ gof: 1.2, result: fit(1.2) }))).toContain("GoF = 1.20). The fit is excellent, close to the noise, and physically sane.");
    expect(powderResultParagraph(input({ gof: 6.5, result: fit(6.5), cause: { phrase: "the peak positions", share: 0.4, first: true } })))
      .toContain("GoF = 6.50). The fit is poor, far from the data, and no value should be trusted yet: the misfit in the peak positions comes first, as the method refines the cell, zero and background before the rest.");
    expect(powderResultParagraph(input({ gof: 0.6, result: fit(0.6) }))).toContain("GoF = 0.60 is below 0.8: the σ's are overestimated or the model has more parameters than the data support, so the esds are optimistic.");
  });

  it("a blocker makes it not acceptable, whatever the GoF", () => {
    const negative: RefinementParameter = { id: "B_O1", label: "B(O1)", kind: "bIso", value: -0.4, initialValue: -0.4, fixed: true };
    expect(powderResultParagraph(input({ gof: 1.2, result: fit(1.2), parameters: [scale, negative] }))).toContain("It is not acceptable: 1 physical problem to fix first (B(O1) is held at -0.4000, negative");
  });

  it("states where the values come from when they are not a converged refinement's", () => {
    expect(powderResultParagraph(input({ gof: null, result: null, snapshot: true }))).toContain("The values are a converged snapshot at {{R_wp}} = 4.01 %, which carries no esds or correlations: refining once gives them.");
    // A snapshot's curves still have a GoF (the Validation tab's): the verdict reads it.
    expect(powderResultParagraph(input({ gof: 3.05, result: null, snapshot: true }))).toContain("The values are a converged snapshot at {{R_wp}} = 4.01 % ({{R_exp}} = 1.31 %, GoF = 3.05), which carries no esds or correlations: refining once gives them. The fit is fair, above the acceptance bar (good ≤ 2.5).");
    expect(powderResultParagraph(input({ gof: null, result: null, parameters: [{ ...scale, initialValue: 1.2 }] }))).toContain("The model has not been refined; the starting values give {{R_wp}} = 4.01 %.");
    expect(powderResultParagraph(input({ gof: 3, result: fit(3), parameters: [{ ...scale, value: 1.5 }] }))).toContain("The values were edited after the last refinement, so its esds no longer apply");
    expect(powderResultParagraph(input({ gof: 3, result: fit(3, "diverged") }))).toContain("The last refinement diverged: its values and esds are not meaningful.");
    expect(powderResultParagraph(input({ gof: 3, result: fit(3, "maxIterations") }))).toContain("It stopped before converging (cycle limit)");
    expect(powderResultParagraph(input({ gof: 3, result: fit(3, "converged", 2.5) }))).toContain("It is still moving (last shift 2.50 esd) at {{R_wp}} = 4.01 %");
  });

  it("a single crystal states its GooF and what to resolve; a PDF its relative Rw", () => {
    const verdict: ValidationVerdict = { headline: "", tone: "warn", checks: [{ id: "gof", status: "ok", title: "GooF 1.01", detail: "close to the statistical floor" }, { id: "completeness", status: "warn", title: "Only 85.0% complete", detail: "…" }] };
    const result = fit(1.01);
    expect(singleCrystalResultParagraph({ subject: "Al₂O₃ (R-3c:H)", against: "414 reflections (139 unique) of neutron data", free: 6, agreement: "{{R_1}} = 0.87 %", result, parameters: [scale], verdict }, false))
      .toBe("Single-crystal refinement of Al₂O₃ (R-3c:H) against 414 reflections (139 unique) of neutron data: 6 free parameters. It converged in 2 cycles at {{R_1}} = 0.87 %. At GooF = 1.01 the fit is close to the statistical floor. To resolve before quoting the result: only 85.0% complete.");
    expect(pdfResultParagraph({ subject: "GaTa₄Se₈ (F-43m)", against: "X-ray G(r) over r = 1.50–28.00 Å (2651 points)", free: 2, rw: 0.0812, result, parameters: [scale], assessment: null }, false))
      .toContain("It converged in 2 cycles at {{R_w}} = 8.12 %. G(r) points are strongly correlated, so {{R_w}} is a relative measure with no statistical acceptance bar, and the esds are optimistic.");
  });

  it("names a second phase as a paper does", () => {
    const st = exampleStructure();
    expect(subjectOf([st])).toBe("Mn₃Ga (P6₃/mmc)");
    expect(subjectOf([st, { ...st, name: "MnO", spaceGroup: { ...st.spaceGroup, hermannMauguin: "F m -3 m" } }])).toBe("Mn₃Ga (P6₃/mmc), with MnO (Fm-3m) as a second phase,");
  });

  it("puts the app's caveats first, then the page's limitations and the Agent's open issues; the composed Result says whose words it is", () => {
    const items = qualityItems({ ...powderInput(), assessment: { result: "x", caveats: [{ tone: "ok", label: "Correlations", text: "none" }] }, agent: AGENT_CHECKS });
    expect(items.map((c) => c.label)).toEqual(["Correlations", "Limitation", "Bounds", "Residual peaks"]);
    const html = reportHtml({ ...powderInput(), assessment: { result: "The fit is fair, with {{R_wp}} = 4.01 %.", caveats: [] } });
    expect(html).toContain('<p class="lede">The fit is fair, with <i>R</i><sub>wp</sub> = 4.01&nbsp;%.</p>');
    expect(html).toContain("Composed by MATERIA from its own checks of this fit, not by a model.");
  });
});

describe("report helpers", () => {
  it("formats parameter values by kind, with esds when present", () => {
    const p = (kind: RefinementParameter["kind"], value: number, esd?: number): RefinementParameter =>
      ({ id: "x", label: "x", kind, value, initialValue: value, fixed: false, ...(esd !== undefined ? { esd } : {}) });
    expect(formatParameterValue(p("cellLength", 5.43217, 0.00031))).toBe("5.4322(3)");
    expect(formatParameterValue(p("cellLength", 5.43217))).toBe("5.43217");
    expect(formatParameterValue(p("scale", 0.0123456))).toBe("0.012346");
    expect(formatParameterValue(p("scale", 1234567))).toBe("1.2346e+6");
    expect(formatParameterValue(p("momentMode", -0.0004))).toBe("0.000");
  });

  it("picks nice axis ticks", () => {
    expect(niceTicks(0, 100, 5).ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(1.2, 4.9, 7).step).toBe(0.5);
    expect(niceTicks(3, 3).ticks).toEqual([3]);
  });

  it("thins a huge pattern to a bounded SVG", () => {
    const n = 60000;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = x.map((v) => Math.sin(v / 500));
    const svg = patternFigureSvg({ x, yObs: y, yCalc: y, diff: y.map(() => 0) }, { xLabel: "x" });
    expect(svg.length).toBeLessThan(400_000);
    expect(svg).toContain('class="obsline"');
  });
});

describe("report file name", () => {
  it("reduces the structure name to a safe token, falling back to the id", () => {
    const base = exampleStructure();
    expect(reportFileName({ ...base, name: "(Co,Cu,Fe,Mn,Ni,Zn)WO₄" })).toBe("Co_Cu_Fe_Mn_Ni_Zn_WO4_report.html");
    expect(reportFileName({ ...base, name: "Mn₃Ga" })).toBe("Mn3Ga_report.html");
    expect(reportFileName({ ...base, id: "s1", name: "☃" })).toBe("s1_report.html");
  });
});

describe("magnetic report section (reportInputs)", () => {
  it("names a standard group from its operations", () => {
    const { structure, magnetic, cand } = cmcm();
    const g = groupOfOperations(structure, magnetic);
    const identity = cand.settingMatch!.identity;
    expect(g.numbers).toContain(`BNS ${identity.bnsNumber}`);
    expect(g.setting).toBe(cand.settingMatch!.transformation);
    expect(g.index).toBe(cand.index);
    expect(g.symbol.replace(/[\s′']/g, "")).toBe(identity.bnsSymbol.replace(/[\s'′]/g, ""));
  });

  it("prefers the applied model, reports joint refinement from the esds, else the explored candidate", () => {
    const { structure, k, params, magnetic } = cmcm();
    const withEsd = params.map((p) => ({ ...p, esd: 0.05 }));
    const result = { esd: Object.fromEntries(params.map((p) => [p.id, 0.05])) } as unknown as RefinementResult;
    const joint = magneticReportSection({ structure, applied: magnetic, params: withEsd, result, explored: null, against: "the powder pattern" });
    expect(joint.section?.status).toMatch(/^Refined jointly/);
    expect(joint.section?.group.index).toBe(6);
    expect(joint.summary).toContain("|m| = 2.50 µB");
    const carried = magneticReportSection({ structure, applied: magnetic, params, result: null, explored: null, against: "the powder pattern" });
    expect(carried.section?.status).toMatch(/^Included in the model/);
    const explored = { magnetic, params, bindings: [], k, group: { symbol: "Cm′cm′ (explored)" }, agreement: 0.074, agreementLabel: "wR" };
    expect(magneticReportSection({ structure, applied: null, params, result: null, explored, against: "the powder pattern" }).section?.status).toContain("wR = 7.4 %");
    expect(magneticReportSection({ structure, applied: null, params, result: null, explored: null, against: "x" }).section).toBeNull();
  });

  it("states the powder's limits on the moment direction by the crystal system", () => {
    const hexagonal = exampleStructure();
    expect(powderMomentLimits(hexagonal)).toEqual([expect.stringMatching(/cannot fix the absolute moment direction/), expect.stringMatching(/angle to the unique axis/)]);
    expect(powderMomentLimits({ ...hexagonal, spaceGroup: { ...hexagonal.spaceGroup, number: 225 } })[1]).toMatch(/only the size of each moment, \|m\|/);
    expect(powderMomentLimits({ ...hexagonal, spaceGroup: { ...hexagonal.spaceGroup, number: 63 } })).toHaveLength(1);
  });
});

describe("PDF report (reportInputs)", () => {
  it("carries the mPDF page's candidate, labelled as under exploration, its indices and its boxcar scan", () => {
    const input = pdfCandidateInput();
    expect(input.magnetic?.status).toContain("Candidate under exploration");
    expect(input.summary).toContain("not part of the refinement");
    expect(input.indices?.map((i) => i.symbol)).toEqual(["R_w", "r", "points", "free parameters"]);
    const html = reportHtml(input);
    expect(html).toContain('<h3 id="local">Local versus average: boxcar scan</h3>');
    expect(text(html)).toContain("Rw = 8.10 %");
    const nuclearOnly = pdfReportInput({ phases: [cmcm().structure], params: [], bindings: [], result: null, pattern: { id: "g", name: "g", scatteringType: "xray", points: [{ r: 1, gObs: 0 }] }, rw: 0.08, fitRange: { min: 1, max: 2 }, curves: { x: [], yObs: [], yCalc: [], diff: [] }, positionMode: "atomic", spinModel: null, explored: null });
    expect(nuclearOnly.magnetic).toBeNull();
    expect(nuclearOnly.summary).toContain("No magnetic (mPDF) component is included.");
  });
});

describe("the cross-check names the technique's own programs", () => {
  const converged = { status: "converged", parameters: {}, esd: {}, agreement: { rWeighted: 0.0812 }, history: [{}, {}], diagnostics: { svdZeroCount: 0, highCorrelations: [] } } as unknown as RefinementResult;
  const scaleRow: RefinementParameter = { id: "pdfScale", label: "PDF scale", kind: "pdfScale", value: 0.09, initialValue: 0.09, fixed: false };
  const pattern = { id: "g", name: "g.gr", scatteringType: "xray" as const, points: Array.from({ length: 30 }, (_, i) => ({ r: 1 + 0.1 * i, gObs: Math.sin(i) })) };
  /** A refined nuclear PDF, as the PDF page assembles it (its assessment read, its fit current). */
  const nuclearPdf = (): ReportInput => ({
    ...pdfReportInput({ phases: [exampleStructure()], params: [scaleRow], bindings: [], result: converged, pattern, rw: 0.0812, fitRange: { min: 1, max: 3.9 }, curves: { x: [], yObs: [], yCalc: [], diff: [] }, positionMode: "atomic", spinModel: null, explored: null, findings: null, current: true }),
    date: DATE,
  });

  it("a PDF report names PDFgui / diffpy-CMI (PDFfit2), never GSAS-II or FullProf: Result, caveats and footer", () => {
    const input = nuclearPdf();
    expect(input.assessment?.result).toContain("The cross-check in PDFgui / diffpy-CMI (PDFfit2) is still to do.");
    expect(input.assessment?.caveats.at(-1)).toEqual({
      tone: "info", label: "Cross-check",
      text: "reproduce the fit in PDFgui / diffpy-CMI (PDFfit2): the Export menu writes a PDFgui / diffpy-CMI bundle with the structure, the data and a PDFfit2 script that refines the same parameters",
    });
    const footer = "MATERIA is in public beta: reproduce a result you publish in PDFgui / diffpy-CMI (PDFfit2); the Export menu writes a PDFgui / diffpy-CMI bundle with the structure, the data and a PDFfit2 script.";
    for (const doc of [text(reportHtml(input)), reportMarkdown(input)]) {
      expect(doc).not.toMatch(/GSAS|FullProf/);
      expect(doc).toContain(footer);
      expect(doc).not.toContain("diffpy.mpdf");
    }
  });

  it("a magnetic PDF adds diffpy.mpdf for its magnetic term, which the bundle does not carry", () => {
    const input = pdfCandidateInput();
    const md = reportMarkdown(input);
    expect(md).not.toMatch(/GSAS|FullProf/);
    expect(md).toContain("reproduce a result you publish in PDFgui / diffpy-CMI (PDFfit2), and its magnetic term in diffpy.mpdf; the Export menu writes a PDFgui / diffpy-CMI bundle");
    const result = pdfResultParagraph({ subject: "Mn₃Ga (Cmcm)", against: "neutron G(r)", free: 3, rw: 0.08, result: converged, parameters: [scaleRow], assessment: null, magnetic: "Magnetic PDF (mPDF) spin model: …" }, false);
    expect(result).toContain("The cross-check in PDFgui / diffpy-CMI (PDFfit2), with the magnetic term in diffpy.mpdf, is still to do.");
    // Nothing to cross-check before a refinement, or after one that diverged.
    expect(pdfResultParagraph({ subject: "s", against: "a", free: 1, rw: 0.3, result: null, parameters: [], assessment: null }, false)).not.toContain("cross-check");
  });

  it("a Rietveld report names GSAS-II and FullProf; a single crystal SHELXL, JANA2020 or FullProf", () => {
    const powder = text(reportHtml(powderInput()));
    expect(powder).toContain("reproduce a result you publish in GSAS-II or FullProf; the Export menu writes a GSAS-II and a FullProf bundle.");
    expect(powder).not.toMatch(/PDFgui|diffpy|SHELXL/);
    const sc = text(reportHtml(singleCrystalInput()));
    expect(sc).toContain("reproduce a result you publish in SHELXL, JANA2020 or FullProf; the Export menu writes the CIF and the reflections as a FullProf .int.");
    expect(sc).not.toMatch(/GSAS|PDFgui|diffpy/);
    const verdict: ValidationVerdict = { headline: "", tone: "ok", checks: [] };
    expect(singleCrystalCaveats({ subject: "s", against: "a", free: 1, agreement: "{{R_1}} = 1 %", result: null, parameters: [], verdict }).at(-1)).toEqual({
      tone: "info", label: "Cross-check", text: "reproduce the refinement in SHELXL, JANA2020 or FullProf: the Export menu writes the CIF and the reflections as a FullProf .int",
    });
  });
});

describe("single-crystal report geometry", () => {
  it("gives U_eq by the full formula in a monoclinic cell (B_eq on a powder), a molecule's bonds, rings and hydrogen bonds", () => {
    const input = singleCrystalInput();
    const md = reportMarkdown(input);
    const adp = input.phases[0]!.structure.sites[0]!.adp;
    const uEq = adp.kind === "anisotropic" ? uEquivalent(adp.uAniso, input.phases[0]!.structure.cell) : NaN;
    expect(md).toContain("U_eq (Å²)");
    expect(md).toContain(uEq.toFixed(5));
    expect(reportHtml(input)).toContain("<i>U</i><sub>eq</sub> (Å²)");
    expect(reportMarkdown({ ...input, technique: "powder" })).toContain((8 * Math.PI * Math.PI * uEq).toFixed(3));
    // The covalent bonds in place of the cation shells, an image by its code; the rings and hydrogen bonds.
    expect(md).toContain("| C1–C2 | 1.381(2) |");
    expect(md).toContain("| S1–S2 [2_554] | 2.0222(5) |");
    expect(md).toContain("**Ring centroids.** Cg1: C1–C6. Fe1···Cg1 1.65.");
    expect(md).toContain("**Hydrogen bonds.** N1–H1···O2 0.88 1.95 2.81 165°.");
    const html = reportHtml(input);
    expect(text(html)).toContain("S1–S2 [2_554]2.0222(5)");
    expect(html).toContain("riding");
    expect(html).not.toContain("shell out to 3.2 Å");
  });

  it("shows a single crystal's isotropic displacement parameters as U_iso, with their esds", () => {
    expect(reportMarkdown(sharedUInput())).toContain("| H11A…H15C shared U_iso (15 H) | 0.087(8) | Å² | refined |");
    expect(reportMarkdown({ ...sharedUInput(), technique: "powder" })).toContain("| H11A…H15C shared B (15 H) | 6.9(6) | Å² | refined |");
  });

  it("dates the report by its input and sets no label in capitals", () => {
    const html = reportHtml({ ...powderInput(), date: DATE });
    expect(html).toContain("2026-09-16");
    expect(html).not.toMatch(/text-transform: uppercase/);
  });
});
