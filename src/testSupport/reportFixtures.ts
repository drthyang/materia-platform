/**
 * Report inputs for the report tests: a powder fit of the bundled Mn₃Ga cell
 * with a few refined rows and a figure, the Cm′cm′ magnetic candidate at
 * k = 0, the Agent's analysis in two shapes, a single crystal (a monoclinic
 * cell with a U₁₃ term and a molecule's bonds), and an mPDF candidate. Pure
 * data, built from the engine; the frozen-layout goldens and the layout tests
 * read the same inputs.
 */

import type { Vec3 } from "@/core/math/types";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { exampleStructure } from "@/examples/mn3ga";
import { magneticSubgroupLattice, latticeRepresentatives } from "@/core/magnetic/subgroupLattice";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import type { ReportAgent, ReportInput } from "@/core/export/report";
import { pdfReportInput } from "@/app/reportInputs";
import type { PdfPattern } from "@/core/diffraction/types";

export const DATE = new Date("2026-09-16T00:00:00Z");

/** The Cm′cm′ candidate of the Mn₃Ga cell at k = 0, its Mn moments at 2.5 µB. */
export function cmcm() {
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

/** A powder report of the Mn₃Ga cell: a, B(Mn1) and the scale refined, c fixed, b tied to a. */
export function powderInput(): ReportInput {
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

/** The Agent's analysis: three steps, a branch left, a check for attention, a Bayesian check close to converged, notes and an account with unverified numbers. */
export const AGENT: ReportAgent = {
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

/** The Agent's analysis with a check of each kind: passed, noted, for attention, and the diagnostic listings. */
export const AGENT_CHECKS: ReportAgent = {
  model: "Model X · API key",
  method: { skill: "my-rietveld-workflow", stages: [{ label: "Cell check", done: true, optional: false }, { label: "Occupancy", done: false, optional: true }] },
  steps: [
    { label: "Loaded PbSO4.cif", by: "user", kind: "load", free: 0 },
    { label: "Refine", by: "agent", kind: "refine", wR: 0.0386, gof: 1.4, free: 6, refined: "scale, background ×4, B", stages: "Scale, background, cell" },
  ],
  agreementLabel: "wR",
  checks: [
    { name: "Convergence", status: "pass", detail: "Converged in 7 cycles; largest final shift/esd 0.0012." },
    { name: "Correlations", status: "note", detail: "Correlated at |ρ| ≥ 0.95, refined together: scale ↔ B_iso Mn1 0.962 (overall intensity terms)." },
    { name: "Bounds", status: "warn", detail: "On a bound (its esd means nothing there): B_iso Ga1 at its lower bound 0." },
    { name: "Residual peaks", status: "warn", detail: "1 peak on no phase's reflection: d = 2.2012 Å." },
    { name: "Resolution shells", status: "note", detail: "3.48–1.19 Å: 53 reflections, R1 0.99 %." },
    { name: "Fit diagnosis", status: "note", detail: "Most of the misfit: peak-tails (~85% of χ²)." },
  ],
  posterior: {
    convergence: "converged", walkers: 12, steps: 2000, samples: 12000, maxRHat: 1.01, minEss: 900,
    rows: [{ label: "B_iso Mn1", refined: 0.62, esd: 0.05, median: 0.6213, ci68: [0.571, 0.672], ci95: [0.52, 0.72], esdRatio: 1.02, verdict: "the posterior confirms the esd" }],
    differences: [],
  },
  openIssues: ["Bounds: On a bound (its esd means nothing there): B_iso Ga1 at its lower bound 0.", "Residual peaks: 1 peak on no phase's reflection: d = 2.2012 Å."],
  notes: ["Kept for the record: the 2.2012 Å line."],
  narrative: "The structure refines to wR 3.86 % with B = 0.62(5) Å².",
  unverified: [],
};

/** The powder report with the phase fractions, the Cm′cm′ moments refined jointly (with the powder's limits) and the Agent's checks. */
export function magneticAgentInput(): ReportInput {
  const base = powderInput();
  const { structure, k, cand, params, magnetic } = cmcm();
  return {
    ...base,
    data: [...base.data, { label: "Phase fractions", value: "Mn3Ga 96.62(7) wt% · MnO 3.38(7) wt% — Hill & Howard" }],
    magnetic: {
      magnetic, k, group: { symbol: "Cm′cm′", numbers: "BNS 63.462", index: cand.index },
      params: params.map((p) => ({ ...p, esd: 0.04 })), status: "Refined jointly with the atomic structure against the powder pattern.", structure,
      limits: ["A powder pattern averages over the crystallites' orientations: it cannot fix the absolute moment direction."],
    },
    agent: AGENT_CHECKS,
  };
}

/** A single crystal: a monoclinic cell (β 110°) with a U₁₃ term on the first site, and a molecule's covalent bonds. */
export function singleCrystalInput(): ReportInput {
  const base = exampleStructure();
  const cell = { a: 7, b: 9, c: 11, alpha: 90, beta: 110, gamma: 90 };
  const u: [number, number, number, number, number, number] = [0.03, 0.025, 0.04, 0, -0.012, 0];
  const structure = { ...base, cell, sites: base.sites.map((s, i) => (i === 0 ? { ...s, adp: { kind: "anisotropic" as const, uAniso: u } } : s)) };
  return {
    technique: "singleCrystal", title: "t", stats: [], data: [], parameters: [], date: DATE,
    phases: [{
      structure, params: [], bindings: [],
      bonds: [{ from: "C1", to: "C2", length: "1.381(2)" }, { from: "C1", to: "H1", length: "0.9500 (riding)" }, { from: "S1", to: "S2", length: "2.0222(5)", image: "2_554" }],
      rings: { rings: ["Cg1: C1–C6"], contacts: ["Fe1···Cg1 1.65"] },
      hydrogenBonds: ["N1–H1···O2 0.88 1.95 2.81 165°"],
    }],
  };
}

/** A single crystal's shared hydrogen U_iso (B in the rows, U in the report). */
export function sharedUInput(): ReportInput {
  const shared = { id: "B_shared_1", label: "H11A…H15C shared B (15 H)", kind: "bIso" as const, value: 6.9, initialValue: 7, esd: 0.6, fixed: false };
  return { technique: "singleCrystal", title: "t", stats: [], data: [], parameters: [shared], phases: [], date: DATE };
}

/** A neutron G(r) of the Mn₃Ga cell with the mPDF page's Cm′cm′ candidate under exploration. */
export function pdfCandidateInput(): ReportInput {
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
  const explored = { magnetic, params, bindings: [], k, group: { symbol: "Cm′cm′ (explored)" }, agreement: 0.074, agreementLabel: "Rw" };
  return {
    ...pdfReportInput({
      phases: [structure], params, bindings: [], result: null, pattern, rw: 0.081,
      fitRange: { min: 1.5, max: 20 }, curves, positionMode: "atomic", spinModel: null, explored,
      boxcar: { width: 5, free: ["scale", "delta2"], columns: ["Mn1–Mn1 (Å)"], rows: [{ r: [1.5, 6.5], rw: 0.12, values: [2.6877] }, { r: [6.5, 11.5], rw: 0.09, values: [Number.NaN] }], decimals: 4 },
    }),
    date: DATE,
    // The version the goldens were written with: a release must not move them.
    appVersion: "0.1.0",
  };
}
