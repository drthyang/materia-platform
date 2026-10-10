import { describe, it, expect } from "vitest";
import type { Vec3 } from "@/core/math/types";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { exampleStructure } from "@/examples/mn3ga";
import { magneticSubgroupLattice, latticeRepresentatives } from "@/core/magnetic/subgroupLattice";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { reportHtml, formatParameterValue, type ReportAgent, type ReportInput } from "@/core/export/report";
import { reportMarkdown } from "@/core/export/reportMarkdown";
import { formatWithEsd } from "@/core/export/cif";
import { niceTicks, patternFigureSvg } from "@/core/export/reportFigures";
import { groupOfOperations, magneticReportSection, pdfReportInput, reportFileName } from "@/app/reportInputs";
import type { PdfPattern } from "@/core/diffraction/types";

const DATE = new Date("2026-09-16T00:00:00Z");

function cmcm() {
  const structure = exampleStructure();
  const k: Vec3 = [0, 0, 0];
  const reps = latticeRepresentatives(magneticSubgroupLattice(structure.spaceGroup.operations, k, { maxIndex: 6 }));
  const cand = reps.find((r) => {
    const bns = r.candidate.standard?.bnsSymbol ?? r.settingMatch?.identity.bnsSymbol ?? "";
    return bns.replace(/\s/g, "") === "Cm'cm'";
  })!;
  const build = buildMagneticModel(structure, k, ["Mn1"], [...cand.candidate.operations], { moment: 2.5 });
  const modes = build.params.filter((p) => p.kind === "momentMode");
  const values: Record<string, number> = {};
  modes.filter((p) => !p.id.includes("_o2_")).forEach((p, i) => { values[p.id] = i === 0 ? 2.5 : 0; });
  modes.filter((p) => p.id.includes("_o2_")).forEach((p) => { values[p.id] = 2.5; });
  const params = build.params.map((p) => ({ ...p, value: values[p.id] ?? p.value, fixed: false }));
  const magnetic = applyMagneticMoments(build.magnetic, build.bindings, values);
  return { structure, k, cand, build, params, magnetic };
}

function powderInput(): ReportInput {
  const structure = exampleStructure();
  const params: RefinementParameter[] = [
    { id: "scale", label: "scale", kind: "scale", value: 0.01234, initialValue: 0.01, fixed: false, esd: 0.00012 },
    { id: "bkg0", label: "bkg c0", kind: "background", value: 120.5, initialValue: 100, fixed: false, esd: 1.4 },
    { id: "cell_a", label: "a", kind: "cellLength", value: 5.4321, initialValue: 5.43, fixed: false, esd: 0.00031 },
    { id: "cell_c", label: "c", kind: "cellLength", value: 4.3210, initialValue: 4.32, fixed: true },
    { id: "B_Mn1", label: "B_iso Mn1", kind: "bIso", value: 0.62, initialValue: 0.5, fixed: false, esd: 0.05 },
    { id: "tied", label: "b (= a)", kind: "cellLength", value: 5.4321, initialValue: 5.43, fixed: true, expression: "= cell_a" },
  ];
  const bindings = [
    { parameterId: "cell_a", kind: "cellLength" as const, targetId: structure.id, targetKey: "a" },
    { parameterId: "cell_c", kind: "cellLength" as const, targetId: structure.id, targetKey: "c" },
    { parameterId: "B_Mn1", kind: "bIso" as const, targetId: structure.id, targetKey: "Mn1" },
  ];
  const x = Array.from({ length: 400 }, (_, i) => 10 + i * 0.2);
  const yCalc = x.map((v) => 100 + 900 * Math.exp(-((v - 40) ** 2) / 2));
  const yObs = yCalc.map((v, i) => v + 8 * Math.sin(i));
  const result: RefinementResult = {
    status: "converged",
    parameters: {},
    esd: { scale: 0.00012, cell_a: 0.00031, B_Mn1: 0.05 },
    agreement: { rFactor: 0.05, rWeighted: 0.0386, rExpected: 0.0276, goodnessOfFit: 1.4 },
    history: [{ iteration: 0, chiSquared: 5000, agreement: { rFactor: 0.1 } }, { iteration: 1, chiSquared: 1234.5, agreement: { rFactor: 0.05 } }],
    diagnostics: { svdZeroCount: 0, highCorrelations: [{ parameterIdA: "scale", parameterIdB: "B_Mn1", coefficient: 0.93 }] },
  } as unknown as RefinementResult;
  return {
    technique: "powder",
    title: "Mn<3>Ga <test>",
    subtitle: "Neutron, time-of-flight · POWGEN",
    summary: "Rietveld refinement summary sentence.",
    date: DATE,
    appVersion: "0.1.0",
    stats: [{ label: "wR", value: "3.86 %", hint: "weighted profile R" }, { label: "GoF (S)", value: "1.40" }],
    data: [{ label: "Data file", value: "PG3_1.gsa" }, { label: "Probe", value: "Neutron, time-of-flight" }],
    phases: [{ structure, params, bindings }],
    magnetic: null,
    figure: {
      kind: "pattern",
      curves: { x, yObs, yCalc, diff: yObs.map((o, i) => o - yCalc[i]!) },
      xLabel: "2θ (°)",
      ticks: [{ label: "Mn3Ga", color: "#0f8a8a", x: [40, 52.5, 61] }],
      fitRange: { min: 20, max: 80 },
      caption: "Observed, calculated, difference.",
    },
    parameters: params,
    result,
    notes: ["wR definition note."],
    warnings: ["Scale and B_iso are strongly correlated."],
  };
}

describe("refinement report (HTML)", () => {
  it("is a complete document with the sections in order and everything escaped", () => {
    const html = reportHtml(powderInput());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Mn&lt;3&gt;Ga &lt;test&gt; · Rietveld refinement report</title>");
    expect(html).not.toContain("Mn<3>Ga");
    expect(html).toContain("Rietveld refinement report · 2026-09-16");
    const order = ["Data &amp; model", "Fit", "Atomic structure", "Parameters", "Refinement details"].map((t) => html.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("Magnetic structure</h2>"); // no magnetic model → no section
    // Numbered sections skip the absent one: 1..5.
    expect(html).toContain('<span class="n">5</span>');
    expect(html).not.toContain('<span class="n">6</span>');
  });

  it("tabulates the cell and sites with standard uncertainties and groups the parameters", () => {
    const html = reportHtml(powderInput());
    expect(html).toContain(`${formatWithEsd(exampleStructure().cell.a, 0.00031, 5)} Å`); // a with its esd (two significant figures of the su)
    expect(html).toContain(`${exampleStructure().cell.c.toFixed(5)} Å`); // fixed c: plain decimals
    expect(html).toContain("0.620(50)"); // B_iso Mn1
    expect(html).toContain("Unit cell");
    expect(html).toContain("Scale &amp; background");
    expect(html).toContain("Atoms");
    expect(html).toContain("tied · = cell_a"); // tied parameter status
    expect(html).toContain("fixed");
    expect(html).toContain("refined");
    // Stats, warnings, notes, diagnostics.
    expect(html).toContain('title="weighted profile R"');
    expect(html).toContain("Scale and B_iso are strongly correlated.");
    expect(html).toContain("wR definition note.");
    expect(html).toContain("scale / B_iso Mn1 0.93");
    expect(html).toContain("converged after 2 cycles");
  });

  it("draws the fit figure with excluded regions, tick rows and a legend", () => {
    const html = reportHtml(powderInput());
    expect(html).toContain('aria-label="Observed, calculated and difference curves"');
    expect(html).toContain('class="excl"'); // fit window narrower than the data
    expect(html).toContain(">Mn3Ga</text>"); // tick-row label
    expect(html).toContain(">observed</text>");
    expect(html).toContain('<path class="calc"');
    expect(html).toContain('<path class="diff"');
  });

  it("renders the magnetic section: group facts, sublattice table with |m|, arrows in the projection", () => {
    const { structure, k, cand, params, magnetic } = cmcm();
    const base = powderInput();
    const html = reportHtml({
      ...base,
      phases: [{ structure, params: [], bindings: [] }],
      magnetic: {
        magnetic,
        k,
        group: { symbol: "Cm′cm′", numbers: "BNS 63.462 · OG 63.9.520", index: cand.index },
        params,
        status: "Refined jointly with the atomic structure against the powder pattern.",
      },
    });
    expect(html).toContain("Magnetic structure</h2>");
    expect(html).toContain("Cm′cm′");
    expect(html).toContain("BNS 63.462");
    expect(html).toContain("k = (0 0 0)");
    expect(html).toContain("the nuclear cell (k = 0)");
    expect(html).toContain("Refined jointly with the atomic structure");
    expect(html).toContain("Magnetic sublattices");
    expect(html).toContain("<polygon"); // arrow heads
    expect(html).toContain('aria-label="Projection of the magnetic structure down c-star with moment arrows"');
    // Every carried sublattice at 2.500 µB.
    const rows = html.match(/<td class="num">2\.500<\/td><\/tr>/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Moment parameters");
    expect(html).toContain('<span class="n">6</span>'); // six sections now
  });

  it("renders the single-crystal figure", () => {
    const base = powderInput();
    const html = reportHtml({
      ...base,
      technique: "singleCrystal",
      figure: { kind: "fobsFcalc", points: [{ obs: 100, calc: 98 }, { obs: 25, calc: 30, magnetic: true }, { obs: 4, calc: 4.5 }], caption: "F plot." },
    });
    expect(html).toContain("Single-crystal refinement report");
    expect(html).toContain('aria-label="Observed versus calculated structure-factor amplitudes"');
    expect(html).toContain("3 reflections · 1 magnetic");
    expect(html).toContain('<path class="ptmag"');
  });
});

describe("the analysis as the Agent ran it", () => {
  const agent: ReportAgent = {
    model: "Claude Opus 5.5 · Anthropic API",
    method: { skill: "my-rietveld-workflow", stages: [{ label: "Cell check", done: true, optional: false }, { label: "Positions", done: true, optional: false }, { label: "Occupancy", done: false, optional: true }] },
    steps: [
      { label: "Loaded PbSO4.cif", by: "user", kind: "load", free: 0 },
      { label: "Refine", by: "agent", kind: "refine", wR: 0.1203, gof: 3.1, free: 6, refined: "scale, background ×4, zero", stages: "Scale, background, cell" },
      { label: "Refine", by: "agent", kind: "refine", wR: 0.0386, gof: 1.4, free: 14, refined: "positions ×8, B ×5, scale", stages: "Positions · ADPs" },
    ],
    otherBranches: 2,
    agreementLabel: "wR",
    checks: [
      { name: "Convergence", status: "pass", detail: "Converged in 4 cycles." },
      { name: "Residual peaks", status: "warn", detail: "1 peak on no phase's reflection: d = 2.2012 Å <unexplained>." },
    ],
    posterior: {
      convergence: "close", walkers: 12, steps: 2300, samples: 13800, maxRHat: 1.071, minEss: 412,
      rows: [{ label: "B_iso Mn1", refined: 0.62, esd: 0.05, median: 0.6213, ci68: [0.571, 0.672], ci95: [0.52, 0.72], esdRatio: 1.02, verdict: "the posterior confirms the esd" }],
      differences: ["B_Mn1 − B_Ga1 = 0.1 (68 % 0.05 to 0.15); P(B_Mn1 > B_Ga1) = 0.98: the data distinguish them."],
    },
    openIssues: ["Residual peaks: 1 peak on no phase's reflection: d = 2.2012 Å."],
    notes: ["The 2.2012 Å line is also in the 300 K pattern & at 9.99 Å."],
    narrative: "I refined the structure stage by stage.\n\nThe fit reaches wR 3.86 % with B = 0.62(5) Å²; the extra line at 7.77 Å is open.",
    unverified: ["7.77", "9.99"],
  };
  const withAgent = (a: ReportAgent = agent): ReportInput => ({ ...powderInput(), agent: a });

  it("puts the analysis first: the steps, the method, the checks, the Bayesian check, the account", () => {
    const html = reportHtml(withAgent());
    expect(html).toContain("Rietveld refinement report · analysed with the Agent · 2026-09-16");
    const order = ["The analysis", "Data &amp; model", "Fit", "Atomic structure"].map((t) => html.indexOf(t));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("3 steps from the History · model Claude Opus 5.5 · Anthropic API");
    expect(html).toContain('<span class="pill agent">Agent</span>');
    expect(html).toContain("positions ×8, B ×5, scale");
    expect(html).toContain("12.03 %");
    expect(html).toContain('<th class="num">GoF</th>');
    expect(html).toContain("2 steps on branches the analysis left are kept in the History, not shown.");
    expect(html).toContain('<span class="stage done">✓ Cell check</span>');
    expect(html).toContain("○ Occupancy, if needed");
    // Checks escaped, the attention pill, the open issue.
    expect(html).toContain('<span class="pill warn">attention</span>');
    expect(html).toContain("d = 2.2012 Å &lt;unexplained&gt;.");
    expect(html).not.toContain("<unexplained>");
    // The Bayesian check table, its convergence and caveat.
    expect(html).toContain("Bayesian check");
    expect(html).toContain("12 walkers × 2300 steps");
    expect(html).toContain("close to converged");
    expect(html).toContain("0.620(50)");
    expect(html).toContain("0.571–0.672");
    expect(html).toContain("not final values to quote");
    expect(html).toContain("P(B_Mn1 &gt; B_Ga1) = 0.98");
    // The account: the Agent's words, labelled, two paragraphs, its unverified numbers marked (and its notes').
    expect(html).toContain("The Agent's account");
    expect(html).toContain("<p>I refined the structure stage by stage.</p>");
    expect(html).toContain('<span class="unverified" title="Not among the values this report computed">7.77</span>');
    expect(html).not.toContain('>3.86</span>');
    expect(html).toContain("The Agent's notes");
    expect(html).toContain('pattern &amp; at <span class="unverified" title="Not among the values this report computed">9.99</span> Å');
    expect(html).toContain("in its own words, as are its notes");
  });

  it("drops the GoF column on the PDF page and names its agreement Rw", () => {
    const html = reportHtml(withAgent({ ...agent, agreementLabel: "Rw", steps: agent.steps.map(({ gof: _g, ...st }) => st), posterior: null, narrative: "", unverified: [] }));
    expect(html).toContain('<th class="num">Rw</th>');
    expect(html).not.toContain('<th class="num">GoF</th>');
    expect(html).not.toContain("Bayesian check");
    expect(html).not.toContain("The Agent's account");
  });

  it("carries the same content as Markdown, the figure embedded and the unverified numbers marked †", () => {
    const md = reportMarkdown(withAgent());
    expect(md.startsWith("# Mn<3>Ga <test>\n")).toBe(true);
    expect(md).toContain("*MATERIA · Rietveld refinement report · analysed with the Agent · 2026-09-16*");
    const order = ["## 1. The analysis", "## 2. Data & model", "## 3. Fit", "## 4. Atomic structure", "## 5. Parameters", "## 6. Refinement details"].map((t) => md.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(md).toContain("| # | Step | By | Refined | Free | wR | GoF |");
    expect(md).toContain("| 3 | Refine · Positions · ADPs | Agent | positions ×8, B ×5, scale | 14 | 3.86 % | 1.40 |");
    expect(md).toContain("| Residual peaks | attention | 1 peak on no phase's reflection: d = 2.2012 Å <unexplained>. |");
    expect(md).toContain("**Bayesian check** — ensemble MCMC, 12 walkers × 2300 steps");
    expect(md).toContain("| B_iso Mn1 | 0.620(50) | 0.621 | 0.571–0.672 | 0.520–0.720 | 1.02 | the posterior confirms the esd |");
    expect(md).toContain("> I refined the structure stage by stage.\n>\n> The fit reaches wR 3.86 % with B = 0.62(5) Å²; the extra line at 7.77† Å is open.");
    expect(md).toContain("- The 2.2012 Å line is also in the 300 K pattern & at 9.99† Å.");
    expect(md).toContain("Numbers marked † in the Agent's words are not among the values this report computed.");
    // The figure: an SVG data URI with its own style; the cell and sites with esds.
    expect(md).toMatch(/!\[Observed, calculated and difference pattern\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)/);
    const svg = new TextDecoder().decode(Uint8Array.from(atob(md.match(/base64,([A-Za-z0-9+/=]+)\)/)![1]!), (c) => c.charCodeAt(0)));
    expect(svg).toContain("<style>");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(md).toContain(formatWithEsd(exampleStructure().cell.a, 0.00031, 5));
    expect(md).toContain("| B_iso Mn1 | 0.620(50) | Å² | refined |");
    expect(md).toContain("| b (= a) | 5.43210 | Å | tied · = cell_a |");
    // A table cell with a pipe stays one cell.
    expect(reportMarkdown({ ...powderInput(), data: [{ label: "Data | file", value: "a|b" }] })).toContain("| **Data \\| file** | a\\|b |");
  });
});

describe("report helpers", () => {
  it("formats parameter values by kind, with esds when present", () => {
    const p = (kind: RefinementParameter["kind"], value: number, esd?: number): RefinementParameter =>
      ({ id: "x", label: "x", kind, value, initialValue: value, fixed: false, ...(esd !== undefined ? { esd } : {}) });
    expect(formatParameterValue(p("cellLength", 5.43217, 0.00031))).toBe("5.43217(31)");
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
    expect(svg).toContain('class="obsline"'); // dense data → line, not dots
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
    // The same label the magnetic page shows for this candidate (identified in
    // the orthohexagonal setting, so it carries the transformation).
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
    expect(joint.section?.group.numbers).toContain("BNS 63.");
    expect(joint.section?.group.index).toBe(6);
    expect(joint.summary).toContain("refined jointly");
    expect(joint.summary).toContain("|m| = 2.50 µB");

    const carried = magneticReportSection({ structure, applied: magnetic, params, result: null, explored: null, against: "the powder pattern" });
    expect(carried.section?.status).toMatch(/^Included in the model/);
    expect(carried.summary).toContain("not refined jointly in this session");

    const explored = {
      magnetic, params, bindings: [], k, group: { symbol: "Cm′cm′ (explored)" }, agreement: 0.074, agreementLabel: "wR",
    };
    const cand = magneticReportSection({ structure, applied: null, params, result: null, explored, against: "the powder pattern" });
    expect(cand.section?.status).toContain("Candidate under exploration");
    expect(cand.section?.status).toContain("wR = 7.4 %");
    expect(cand.section?.group.symbol).toBe("Cm′cm′ (explored)");
    expect(cand.summary).toContain("not part of the refinement");

    const none = magneticReportSection({ structure, applied: null, params, result: null, explored: null, against: "x" });
    expect(none.section).toBeNull();
    expect(none.summary).toBe("No magnetic model is included.");
  });
});

describe("PDF report (reportInputs)", () => {
  // The mPDF page shows "report: Export ▾" beside a selected candidate, promising
  // the report carries it until you Continue — so the PDF report must honour the
  // same contract as the powder and single-crystal ones.
  it("carries the mPDF page's candidate, labelled as under exploration", () => {
    const { structure, k, params, magnetic } = cmcm();
    const pattern: PdfPattern = {
      id: "gr", name: "Mn3Sn.gr", scatteringType: "neutron",
      points: Array.from({ length: 50 }, (_, i) => ({ r: 1 + i * 0.1, gObs: Math.sin(i) })),
    };
    const curves = {
      x: pattern.points.map((pt) => pt.r),
      yObs: pattern.points.map((pt) => pt.gObs),
      yCalc: pattern.points.map(() => 0),
      diff: pattern.points.map((pt) => pt.gObs),
    };
    const base = {
      phases: [structure], params, bindings: [], result: null, pattern, rw: 0.081,
      fitRange: { min: 1.5, max: 20 }, curves, positionMode: "atomic" as const, spinModel: null,
    };
    const explored = {
      magnetic, params, bindings: [], k, group: { symbol: "Cm′cm′ (explored)" }, agreement: 0.074, agreementLabel: "Rw",
    };

    const withCandidate = pdfReportInput({ ...base, explored });
    expect(withCandidate.magnetic?.status).toContain("Candidate under exploration");
    expect(withCandidate.magnetic?.group.symbol).toBe("Cm′cm′ (explored)");
    expect(withCandidate.summary).toContain("not part of the refinement");
    expect(withCandidate.summary).not.toContain("No magnetic (mPDF) component");

    // Nothing selected on the magnetic page: the report says so plainly.
    const nuclearOnly = pdfReportInput({ ...base, explored: null });
    expect(nuclearOnly.magnetic).toBeNull();
    expect(nuclearOnly.summary).toContain("No magnetic (mPDF) component is included.");
  });
});
