import { describe, it, expect } from "vitest";
import { moveTo, recordStep, type ProjectHistory } from "@/core/project/history";
import type { Workspace } from "@/core/project/types";
import type { ParameterKind, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { ReportInput } from "@/core/export/report";
import { buildAgentReport, comparedRefinements, freeSummary, historySteps, recordChecks, reportFileBase } from "@/agent/report";
import { corundumPage } from "@/testSupport/scPages";
import { buildSingleCrystalSpec } from "@/core/workflow/singleCrystalRefinement";
import { withAdpModel } from "@/core/crystal/adp";
import { emptyRecord } from "@/agent/method";
import { parse_structure, simulate_pattern } from "@/mcp/tools";
import { loadedSession } from "@/app/powderSession";
import { executor, fakeHost, pdfPort, sessionPort } from "@/testSupport/agentHeadless";
import type { AgentReport } from "@/agent/report";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";

const row = (id: string, kind: ParameterKind, fixed = true): RefinementParameter => ({ id, label: id, kind, value: 1, initialValue: 1, fixed });
const ALL = [row("scale", "scale"), ...[0, 1, 2, 3].map((i) => row(`bkg${i}`, "background")), row("cell_a", "cellLength"), row("x_O1", "atomX"), row("B_O1", "bIso")];
const freeing = (ids: readonly string[]): RefinementParameter[] => ALL.map((p) => (ids.includes(p.id) ? { ...p, fixed: false } : p));
const result = (wR: number, gof: number, status = "converged"): RefinementResult =>
  ({ status, parameters: {}, esd: {}, agreement: { rFactor: wR, rWeighted: wR, goodnessOfFit: gof }, history: [] }) as unknown as RefinementResult;
const ws = (params: RefinementParameter[], extra: Record<string, unknown> = {}): Workspace =>
  ({ technique: "powder", pattern: { id: "p", points: [] }, backgroundTerms: 4, refinement: { parameters: params, bindings: [], ...extra } }) as unknown as Workspace;

/** A History as an analysis leaves it: a load, freeing, refinements, a settings change, and a dead-end branch. */
function analysis(): ProjectHistory {
  let h = recordStep(null, { kind: "load", label: "Loaded PbSO4.cif", structures: [], workspace: ws(ALL) });
  const base = freeing(["scale", "bkg0", "bkg1", "bkg2", "bkg3", "cell_a"]);
  h = recordStep(h, { kind: "edit", structures: [], workspace: ws(base), actor: "agent" });
  h = recordStep(h, { kind: "refine", label: "Refine", structures: [], workspace: ws(base, { lastResult: result(0.1203, 3.1) }), actor: "agent" });
  const afterFirst = h.current;
  h = recordStep(h, { kind: "settings", label: "Background terms 4 → 6", structures: [], workspace: { ...ws(base, { lastResult: result(0.1203, 3.1) }), backgroundTerms: 6 } as unknown as Workspace, actor: "agent" });
  const atoms = freeing(["scale", "x_O1", "B_O1"]);
  h = recordStep(h, { kind: "edit", structures: [], workspace: { ...ws(atoms), backgroundTerms: 6 } as unknown as Workspace, actor: "agent" });
  h = recordStep(h, { kind: "refine", label: "Refine", structures: [], workspace: { ...ws(atoms, { lastResult: result(0.0412, 1.62, "max-iterations") }), backgroundTerms: 6 } as unknown as Workspace, actor: "agent" });
  const leaf = h.current;
  // A branch the analysis left: back to the first refinement, one more try, then back to the leaf.
  h = moveTo(h, afterFirst);
  h = recordStep(h, { kind: "refine", label: "Escape minimum", structures: [], workspace: ws(base, { lastResult: result(0.13, 3.3) }), actor: "agent" });
  return moveTo(h, leaf);
}

describe("the analysis from the History", () => {
  it("lists the path to the result: freeing folded into the refinement it served, stages as the reason", () => {
    const { steps, otherBranches } = historySteps("powder", analysis());
    expect(steps.map((s) => s.label)).toEqual(["Loaded PbSO4.cif", "Refine", "Background terms 4 → 6", "Refine (max-iterations)"]);
    expect(steps.map((s) => s.by)).toEqual(["user", "agent", "agent", "agent"]);
    expect(steps[1]).toMatchObject({ kind: "refine", wR: 0.1203, gof: 3.1, free: 6, refined: "scale, background ×4, cell", stages: "Scale, background, cell" });
    // The scale rides along: the reason is the positions and the ADPs.
    expect(steps[3]).toMatchObject({ wR: 0.0412, refined: "scale, positions, B", stages: "Positions · ADPs" });
    // A settings step carries no agreement of its own.
    expect(steps[2]!.wR).toBeUndefined();
    expect(otherBranches).toBe(1);
    expect(historySteps("powder", null)).toEqual({ steps: [], otherBranches: 0, rowOf: new Map() });
  });

  it("compares the single-crystal refinements made under other conditions, with the engine's U_eq", () => {
    const c = corundumPage();
    const aniso = withAdpModel(c.structure, "anisotropic");
    const spec = buildSingleCrystalSpec(aniso, c.dataset, { extinction: 0 });
    // U11 of each site at 0.004 (Al: U11 = U22 = U33 mode, so U_eq follows), esd 1e-4 on every free row.
    const params = spec.params.map((p) => (p.kind === "uAniso" || p.kind === "extinction" ? { ...p, fixed: false, value: p.kind === "extinction" ? 0.3 : p.value } : p));
    const esd = Object.fromEntries(params.filter((p) => !p.fixed).map((p) => [p.id, 1e-4]));
    const lastResult = { status: "converged", parameters: {}, esd, agreement: { rFactor: 0.1352, rWeighted: 0.1352, goodnessOfFit: 2.79 }, history: [] } as unknown as RefinementResult;
    const sc = (extra: Record<string, unknown>, wR = 0.1352, gof = 2.79): Workspace =>
      ({ technique: "singleCrystal", dataset: c.dataset, probe: "neutron", adpModel: "anisotropic", refinement: { parameters: params, bindings: spec.bindings, lastResult: { ...lastResult, agreement: { rFactor: wR, rWeighted: wR, goodnessOfFit: gof } } }, ...extra }) as unknown as Workspace;
    let h = recordStep(null, { kind: "load", label: "Loaded", structures: [], workspace: { ...sc({}), refinement: { parameters: spec.params, bindings: spec.bindings } } as unknown as Workspace });
    h = recordStep(h, { kind: "refine", label: "Refine", structures: [], workspace: sc({}), actor: "agent" });
    h = recordStep(h, { kind: "settings", label: "Extinction", structures: [], workspace: sc({ extinctionModel: "bc-1-lorentzian" }), actor: "agent" });
    h = recordStep(h, { kind: "refine", label: "Refine", structures: [], workspace: sc({ extinctionModel: "bc-1-lorentzian" }, 0.1208, 2.49), actor: "agent" });
    h = recordStep(h, { kind: "refine", label: "Refine", structures: [], workspace: sc({ extinctionModel: "bc-1-lorentzian", resolution: { dMax: 0.5 } }, 0.0938, 1.37), actor: "agent" });
    const { rowOf } = historySteps("singleCrystal", h);
    const check = comparedRefinements(h, c.structure.cell, rowOf)!;
    expect(check.name).toBe("Refinements compared");
    const rows = check.detail.replace(/^.*?the ADPs free: /, "").split("; step ");
    expect(rows, check.detail).toHaveLength(3);
    expect(rows[0]).toMatch(/^step 2: SHELXL EXTI, anisotropic — wR2 13\.52 %, GooF 2\.79; extinction \(SHELXL x\) 0\.30000\(10\); U_eq Al1 0\.00\d+\(\d+\), O1 0\.00\d+\(\d+\) Å²$/);
    expect(rows[1]).toMatch(/^\d: Becker–Coppens type I, Lorentzian, anisotropic — wR2 12\.08 %, GooF 2\.49; extinction Eg \(B–C type I\) /);
    expect(rows[2]).toMatch(/^\d: Becker–Coppens type I, Lorentzian, d ≤ 0\.5 Å, anisotropic — wR2 9\.38 %, GooF 1\.37;/);
    // One set of conditions only: nothing to compare.
    expect(comparedRefinements(recordStep(null, { kind: "refine", label: "Refine", structures: [], workspace: sc({}) }), c.structure.cell, new Map())).toBeNull();
  });

  it("names free sets by group, ties and fixed rows left out", () => {
    expect(freeSummary([{ ...row("a", "cellLength"), fixed: false }, { ...row("c", "cellLength"), fixed: false }, { ...row("b", "cellLength"), fixed: false, expression: "= a" }, row("B", "bIso")])).toBe("cell ×2");
  });

  it("reads the record: the cell check, the symmetry review, the exceptions the user allowed", () => {
    const record = {
      ...emptyRecord("k"),
      cellCheck: { passed: false, at: 0, summary: "1 unindexed peak" },
      symmetryReviewed: { at: 0, summary: "no forbidden reflection carries intensity in the refined fit" },
      exceptions: [{ rule: "bare-occupancy" as const, reason: "anomalous contrast at the Fe edge", at: 0 }],
    };
    expect(recordChecks("powder", record)).toEqual([
      { name: "Cell check", status: "note", detail: "1 unindexed peak." },
      { name: "Symmetry review", status: "pass", detail: "No forbidden reflection carries intensity in the refined fit." },
      { name: "Method exception", status: "note", detail: "Refine an occupancy with no tie or second contrast: allowed by the user, because anomalous contrast at the Fe edge" },
    ]);
    expect(recordChecks("powder", emptyRecord("k"))).toEqual([{ name: "Cell check", status: "note", detail: "Not run in this analysis." }]);
    expect(recordChecks("pdf", emptyRecord("k"))).toEqual([]);
  });

  it("audits the account against the engine's numbers only, not the Agent's own notes", () => {
    const input: ReportInput = {
      technique: "powder", title: "PbSO₄", stats: [{ label: "wR", value: "3.71 %" }], data: [], phases: [], parameters: [], date: new Date("2026-10-10T00:00:00Z"),
    };
    const record = { ...emptyRecord("k"), notes: [{ text: "Unexplained line at d = 2.2012 Å.", at: 0 }] };
    const built = buildAgentReport({ page: "powder", input, history: null, record, checks: [], posterior: null, model: "M", narrative: "wR reached 3.71 %; the line at 2.2012 Å stays open; a = 8.4807 Å." });
    // 3.71 is the engine's; 2.2012 only the Agent's own note says; 8.4807 is nowhere.
    expect(built.unverified).toEqual(["2.2012", "8.4807"]);
    expect(built.agent.openIssues).toEqual(["Method stages not yet refined to convergence: Scale, background, cell, Positions, Profile, ADPs."]);
    expect(built.html).toContain("analysed with the Agent");
    expect(built.markdown).toContain("a = 8.4807† Å");
    // A number the user gave (a published refinement's) is theirs to quote.
    const quoted = buildAgentReport({ page: "powder", input, history: null, record: emptyRecord("k"), checks: [], posterior: null, model: "M", narrative: "wR 3.71 % against the published 3.92 %; a = 8.4807 Å.", userText: "Compare with the published wR of 3.92 %." });
    expect(quoted.unverified).toEqual(["8.4807"]);
  });

  it("names the files after the title", () => {
    expect(reportFileBase("Cr₂WO₆ 4 K")).toBe("Cr2WO6_4_K_agent_report");
    expect(reportFileBase("✦")).toBe("analysis_agent_report");
  });
});

describe("write_report through the Agent", () => {
  const CIF = `data_t
_cell_length_a 4.5753
_cell_length_b 4.5753
_cell_length_c 8.8537
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 42/m n m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
W1 W6+ 0 0 0 1 0.5
Cr1 Cr3+ 0 0 0.3330 1 0.5
O1 O2- 0.2985 0.2985 0 1 0.6
O2 O2- 0.3075 0.3075 0.3400 1 0.6
`;
  const INSTRUMENT: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 2.4067, u: 3889, v: -6417, w: 3098, x: 0, y: 0 };

  function page(): ReturnType<typeof sessionPort> {
    const structure = parse_structure({ cif: CIF }).structure;
    const sim = simulate_pattern({ structure, instrument: INSTRUMENT, xMin: 10, xMax: 130, points: 600 });
    const top = Math.max(...sim.curves.yCalc);
    let seed = 7;
    const u = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pattern: PowderPattern = {
      id: "p", name: "Cr2WO6 sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 2.4067 }, wavelength: 2.4067,
      points: sim.curves.x.map((x, i) => {
        const y = (5000 * sim.curves.yCalc[i]!) / top + 60;
        return { x, yObs: y + Math.sqrt(y) * Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()), sigma: Math.sqrt(y) };
      }),
    };
    return sessionPort(loadedSession(structure, pattern, INSTRUMENT), INSTRUMENT);
  }
  const parse = (t: string): Record<string, unknown> => JSON.parse(t) as Record<string, unknown>;

  it("builds the report from the engine, audits the account, and adds the Bayesian check", async () => {
    const { port } = page();
    const reports: AgentReport[] = [];
    const { ex, asked } = executor(fakeHost(port).host, "auto", { onReport: (r) => reports.push(r) });

    await ex.run("check_cell_symmetry", {});
    await ex.run("set_free", { free: ["scale", "bkg0", "B_W1", "B_O2"] });
    await ex.run("set_free", { fix: ["bkg1", "bkg2", "bkg3", "cell_a", "cell_c"] });
    await ex.run("refine", {});
    await ex.run("write_note", { text: "The simulated pattern has no impurity lines; 9.8765 is a made-up number." });
    const wR = (parse((await ex.run("get_state", {})).text).lastRefinement as { wR: number }).wR;

    const askedBefore = asked.length;
    const out = parse((await ex.run("write_report", { summary: `Refined scale, background and two B values: wR ${wR.toFixed(2)} %.\n\nThe cell is a = 9.1234 Å.` })).text) as {
      shown: boolean; checks: string[]; openIssues: string[]; unverifiedNumbers?: string[]; note?: string;
    };
    // A read: nothing asked, the viewer told.
    expect(asked.length).toBe(askedBefore);
    expect(out.shown).toBe(true);
    expect(reports).toHaveLength(1);
    // The engine's checks, the record's cell check.
    for (const name of ["Convergence", "Agreement", "Correlations", "Bounds", "Residual peaks", "Serial correlation", "Bond valence", "Cell check"]) {
      expect(out.checks.some((c) => c.includes(`: ${name} — `))).toBe(true);
    }
    expect(out.openIssues[0]).toMatch(/^Method stages not yet refined to convergence: .*Positions/);
    // Only the invented numbers are unverified: the cell and the note's.
    expect(out.unverifiedNumbers).toEqual(["9.1234", "9.8765"]);
    expect(out.note).toMatch(/call write_report again/);

    const r = reports[0]!;
    expect(r.technique).toBe("powder");
    expect(r.fileBase).toBe(`${r.title}_agent_report`);
    expect(r.html).toContain("Rietveld refinement report · analysed with the Agent");
    expect(r.html).toContain("model Test model · headless");
    expect(r.html).toContain("Bond valence");
    expect(r.html).toContain(`wR ${wR.toFixed(2)} %.</p>`);
    expect(r.html).toContain('<span class="unverified" title="Not among the values this report computed">9.1234</span>');
    expect(r.markdown).toContain("a = 9.1234† Å");
    expect(r.html).not.toContain("Bayesian check");

    // The Bayesian check of this refinement joins the report…
    await ex.run("sample_posterior", { steps: 200 });
    const withPosterior = parse((await ex.run("write_report", { summary: "Same account, now with the posterior of the four free parameters." })).text) as { bayesianCheck?: string };
    expect(withPosterior.bayesianCheck).toMatch(/^included \((converged|close|not converged)\)$/);
    expect(reports[1]!.html).toContain("Bayesian check");
    expect(reports[1]!.html).toContain("12 walkers × 200 steps");
    // …and stays once a later refinement replaces the one it sampled, labelled with how far its values moved.
    await ex.run("set_free", { free: ["cell_a", "cell_c"] });
    await ex.run("refine", {});
    const later = parse((await ex.run("write_report", { summary: "After a final refinement with the cell free, the posterior is of an earlier fit." })).text) as { bayesianCheck?: string };
    expect(later.bayesianCheck).toMatch(/^included \(.*; sampled at an earlier refinement, with 4 parameters free; since then they have moved by up to \d+\.\d esd\)$/);
    expect(reports[2]!.html).toContain("of an earlier refinement · ensemble MCMC");
    expect(reports[2]!.html).toContain("Of an earlier refinement: sampled at an earlier refinement, with 4 parameters free");
    // The Markdown says the same.
    expect(reports[2]!.markdown).toContain("**Bayesian check** — of an earlier refinement");
  }, 120000);

  it("carries the phase fractions and the line broadening the sample adds, so the account can cite them", async () => {
    // Round 10 (NAC on 11-BM): the question was the profile — what the sample adds
    // to the instrument's lines — and the fluorite fraction; the report had neither.
    const { port } = page();
    const reports: AgentReport[] = [];
    const { ex } = executor(fakeHost(port).host, "auto", { onReport: (r) => reports.push(r) });
    await ex.run("add_known_phase", { name: "Al" });
    // X and Y trade at |ρ| > 0.95 on this short simulated range: Y alone, with the two scales.
    await ex.run("set_free", { free: ["p0_scale", "p1_scale", "profY"], fix: ["p0_cell_*", "bkg*"] });
    expect(parse((await ex.run("refine", {})).text).refined).toBe(true);
    await ex.run("write_report", { summary: "Refined the two scales and the Lorentzian Y on the simulated pattern; the report gives the fractions and the broadening." });
    const md = reports.at(-1)!.markdown;
    expect(md).toMatch(/\| \*\*Phase fractions\*\* \| structure [\d.()]+ wt% · Al [\d.()]+ wt% — Hill & Howard/);
    expect(md).toMatch(/\| \*\*Microstrain\*\* \| [\d.()]+ × 10⁻⁶ — Lorentzian Y, the instrument's X = 0, Y = 0 subtracted/);
    expect(md).toMatch(/\| \*\*Crystallite size\*\* \| not resolved: X is not above the instrument's/);
  }, 120000);

  it("reports a PDF fit with Rw and no GoF, and refuses a page without a report", async () => {
    const { port } = pdfPort();
    const reports: AgentReport[] = [];
    const { ex } = executor(fakeHost(port).host, "auto", { onReport: (r) => reports.push(r) });
    await ex.run("set_free", { free: ["pdfScale"] });
    await ex.run("refine", {});
    const out = parse((await ex.run("write_report", { summary: "Refined the scale of the GaTa4Se8 G(r) over the default window." })).text) as { checks: string[] };
    expect(out.checks.some((c) => /^note: Agreement — Rw = \d+\.\d\d %/.test(c))).toBe(true);
    expect(reports[0]!.html).toContain("PDF refinement report · analysed with the Agent");
    expect(reports[0]!.html).toContain('<th class="num">Rw</th>');
    expect(reports[0]!.html).not.toContain('<th class="num">GoF</th>');

    const { reportInput: _drop, ...bare } = port;
    const { ex: ex2 } = executor(fakeHost(bare).host, "auto");
    expect((await ex2.run("write_report", { summary: "There is nothing to build the report from here." })).text).toMatch(/this page cannot build a report/);
  }, 60000);

  it("carries the bond lengths and the last boxcar scan, so the account's lengths are the report's", async () => {
    // Round 9 (LaMnO₃): the Agent's case rested on Mn–O lengths, overall and
    // box by box, and the report had neither — every length it cited was
    // marked as one the report did not compute.
    const { port } = pdfPort();
    const reports: AgentReport[] = [];
    const { ex } = executor(fakeHost(port).host, "auto", { onReport: (r) => reports.push(r) });
    await ex.run("set_free", { free: ["pdfScale", "pos_*"] });
    await ex.run("refine", {});
    const scan = parse((await ex.run("boxcar_scan", { width: 2, step: 1, bonds: ["Ta1"] })).text) as { boxcar: { passes: { boxes: { bonds: Record<string, string[]> }[] }[] } };
    const firstBond = scan.boxcar.passes[0]!.boxes[0]!.bonds["Ta1"]![0]!; // e.g. "Se2 2.5124 ×3"
    const length = firstBond.split(" ")[1]!;
    const md = () => reports.at(-1)!.markdown;
    await ex.run("write_report", { summary: `The scan holds the Ta1 shell box by box: its shortest bond is ${length} Å in the first box.` });
    expect(md()).toContain("Local versus average");
    expect(md()).toMatch(/\| r \(Å\) \| Rw \(%\) \| Ta1–\S+( ×\d+)? \(Å\)/);
    expect(md()).toContain("Bonds (Å)");
    expect(reports.at(-1)!.html).toContain('id="local"');
    expect(reports.at(-1)!.unverified ?? []).toEqual([]);
  }, 60000);
});
