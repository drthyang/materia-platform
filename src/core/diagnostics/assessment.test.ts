import { describe, it, expect } from "vitest";
import { assessRefinement, relativeLineWidth, residualPeaks, suggestNextSteps } from "@/core/diagnostics/assessment";
import { GOOF_SINGLE_CRYSTAL_BANDS } from "@/core/diagnostics/thresholds";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { refine, type RefinementProblem } from "@/core/refinement/engine";
import { noisyPeakProblem } from "@/testSupport/noisyPeak";

function param(id: string, kind: RefinementParameter["kind"], value: number, extra: Partial<RefinementParameter> = {}): RefinementParameter {
  return { id, label: id, kind, value, initialValue: value, fixed: false, ...extra };
}

function result(over: Partial<Omit<RefinementResult, "agreement">> & { agreement?: Partial<RefinementResult["agreement"]> } = {}): RefinementResult {
  const { agreement, ...rest } = over;
  return {
    status: "converged",
    parameters: {},
    esd: {},
    agreement: { rFactor: 0.05, rWeighted: 0.07, rExpected: 0.06, goodnessOfFit: 1.17, ...agreement },
    history: [],
    ...rest,
  };
}

describe("assessRefinement — fit verdict", () => {
  it("GoF ~1.2 with no diagnostics reads as an excellent, issue-free fit", () => {
    const a = assessRefinement({ result: result(), parameters: [param("scale", "scale", 1)], observationCount: 4000 });
    expect(a.verdict.band).toBe("excellent");
    expect(a.findings).toHaveLength(0);
    expect(a.summary).toMatch(/EXCELLENT/);
    expect(a.summary).toMatch(/no issues/);
  });

  it("GoF < 1 is flagged as 'too good' (fair), not green", () => {
    const a = assessRefinement({ result: result({ agreement: { goodnessOfFit: 0.6 } }), parameters: [param("scale", "scale", 1)], observationCount: 4000 });
    expect(a.verdict.band).toBe("fair");
    expect(a.verdict.rationale).toMatch(/too good|over-parameterized|overestimated/i);
  });

  it("on a single crystal, a GooF a little below 1 asks for the weights refitted, not a green light", () => {
    const a = assessRefinement({ result: result({ agreement: { goodnessOfFit: 0.889 } }), parameters: [param("scale", "scale", 1)], observationCount: 1465, mode: "single-crystal" });
    expect(a.verdict.band).toBe("good");
    expect(a.verdict.rationale).toBe("GooF 0.89, below 1: the model leaves less misfit than the weights expect (their σ about 12 % too large) — refit the weighting scheme to the final model (SHELXL's suggestion).");
    // At 1 it is the floor.
    expect(assessRefinement({ result: result({ agreement: { goodnessOfFit: 1.02 } }), parameters: [param("scale", "scale", 1)], observationCount: 1465, mode: "single-crystal" }).verdict.band).toBe("excellent");
  });

  it("bands a single crystal's GooF from the Validation tab's 1.3 line, not the powder's 1.5", () => {
    const band = (gof: number, mode: "powder" | "single-crystal"): string =>
      assessRefinement({ result: result({ agreement: { goodnessOfFit: gof } }), parameters: [param("scale", "scale", 1)], observationCount: 1465, mode }).verdict.band;
    expect([1.2, 1.4, 2.2, 2.4, 3.7, 3.9].map((g) => band(g, "single-crystal"))).toEqual(["excellent", "good", "good", "fair", "fair", "poor"]);
    expect([1.2, 1.4, 2.4, 3.9].map((g) => band(g, "powder"))).toEqual(["excellent", "excellent", "good", "fair"]);
    // The Validation tab reads the same lines: ok to 1.3, a note to 2.3, a warning to 3.8.
    for (const [k, v] of Object.entries({ tooGood: 0.8, excellent: 1.3, good: 2.3, fair: 3.8 })) expect(GOOF_SINGLE_CRYSTAL_BANDS[k as keyof typeof GOOF_SINGLE_CRYSTAL_BANDS], k).toBeCloseTo(v, 12);
  });

  it("a high GoF reads as poor", () => {
    const a = assessRefinement({ result: result({ agreement: { goodnessOfFit: 5.2 } }), parameters: [param("scale", "scale", 1)], observationCount: 4000 });
    expect(a.verdict.band).toBe("poor");
  });

  it("a diverged run is unreliable regardless of wR", () => {
    const a = assessRefinement({ result: result({ status: "diverged" }), parameters: [param("scale", "scale", 1)], observationCount: 4000 });
    expect(a.verdict.band).toBe("unreliable");
    expect(a.findings.some((f) => f.category === "convergence" && f.severity === "critical")).toBe(true);
  });
});

describe("assessRefinement — findings", () => {
  it("flags a negative B_iso as a critical physical problem", () => {
    const a = assessRefinement({
      result: result(),
      parameters: [param("Fe1_B", "bIso", -0.3)],
      observationCount: 4000,
    });
    const f = a.findings.find((x) => x.category === "physical");
    expect(f?.severity).toBe("critical");
    expect(f?.parameterIds).toEqual(["Fe1_B"]);
    expect(f?.summary).toMatch(/Fe1_B refined negative/);
    expect(f?.evidence?.origin).toBe("refined");
  });

  it("lets an off-diagonal U term be negative, and flags a diagonal one", () => {
    const a = assessRefinement({
      result: result(),
      parameters: [
        // As the builders make them: U12 may go below 0, U11 is bounded at 0.
        param("U_N1A_3", "uAniso", -0.0069, { label: "N1A U12", min: -0.03 }),
        param("U_C4A_5", "uAniso", -0.0103, { label: "C4A U23", min: -0.05 }),
        param("U_N1A_0", "uAniso", -0.001, { label: "N1A U11", min: 0, fixed: true }),
        // A row without a bound is read by its label.
        param("U_x", "uAniso", -0.002, { label: "C9 U13" }),
      ],
      observationCount: 4000,
    });
    const f = a.findings.filter((x) => x.category === "physical");
    expect(f.map((x) => x.parameterIds)).toEqual([["U_N1A_0"]]);
  });

  it("flags a free Lorentzian width refined negative, and not a held one", () => {
    const a = assessRefinement({
      result: result(),
      parameters: [param("profileY", "profileY", -7.2, { label: "Lorentzian Y" }), param("profileX", "profileX", -0.5, { fixed: true })],
      observationCount: 4000,
    });
    const f = a.findings.filter((x) => x.category === "physical");
    expect(f.map((x) => x.parameterIds)).toEqual([["profileY"]]);
    expect(f[0]?.summary).toMatch(/Lorentzian Y refined negative.*no physical meaning/);
    expect(f[0]?.detail).toMatch(/Fix it at 0 and refine U, V, W/);
  });

  it("words a held negative B_iso as an input value, not a refinement result", () => {
    const a = assessRefinement({
      result: result(),
      parameters: [param("Fe1_B", "bIso", -0.3, { fixed: true })],
      observationCount: 4000,
    });
    const f = a.findings.find((x) => x.category === "physical");
    expect(f?.severity).toBe("critical");
    expect(f?.summary).toMatch(/Fe1_B is held at -0\.3000/);
    expect(f?.summary).not.toMatch(/refined/);
    expect(f?.detail).toMatch(/starting structure or CIF/);
    expect(f?.detail).not.toMatch(/absorbs an error/);
    expect(f?.evidence?.origin).toBe("input");
  });

  it("flags a freed occupancy outside [0, 1] and points at the scale correlation", () => {
    const a = assessRefinement({
      result: result(),
      parameters: [param("occ_Ga1", "occupancy", 1.005)],
      observationCount: 4000,
    });
    const f = a.findings.find((x) => x.category === "physical");
    expect(f?.severity).toBe("warning");
    expect(f?.summary).toBe("occ_Ga1 refined to 1.0050, outside [0, 1].");
    expect(f?.detail).toMatch(/scale\/occupancy correlation/);
    expect(f?.evidence?.origin).toBe("refined");
  });

  it("words a held occupancy outside [0, 1] as an input value, with no correlation blame", () => {
    // The Mn₃Ga 30 K CIF carries Ga1 occupancy 1.005; it stays held in a
    // scale/background/cell/profile refinement.
    const a = assessRefinement({
      result: result(),
      parameters: [param("occ_Ga1", "occupancy", 1.005, { fixed: true })],
      observationCount: 4000,
    });
    const f = a.findings.find((x) => x.category === "physical");
    expect(f?.severity).toBe("warning");
    expect(f?.summary).toBe("occ_Ga1 is held at 1.0050, outside [0, 1].");
    expect(f?.detail).toMatch(/starting structure or CIF/);
    expect(f?.detail).not.toMatch(/correlation/);
    expect(f?.evidence?.origin).toBe("input");
  });

  it("gives a physical reason for a known dangerous correlation (scale ↔ background)", () => {
    const a = assessRefinement({
      result: result({
        diagnostics: {
          svdZeroCount: 0, singularParameterIds: [], conditionNumber: 100, maxLambda: 1,
          atBounds: [], maxShiftOverEsd: 0,
          highCorrelations: [{ parameterIdA: "scale", parameterIdB: "bkg0", coefficient: 0.98 }],
        },
      }),
      parameters: [param("scale", "scale", 1), param("bkg0", "background", 10)],
      observationCount: 4000,
    });
    const f = a.findings.find((x) => x.category === "correlation");
    expect(f?.severity).toBe("warning");
    expect(f?.detail).toMatch(/background/i);
  });

  it("notes, not warns about, a pair the correlation guard refines together", () => {
    // The guard's rule (correlationGuard.ts): a pair a third free parameter carries, and on a single
    // crystal the overall intensity terms among themselves. The assessment warned about both, and told
    // the model to refine apart what the guard had just refined together.
    const diagnostics = (highCorrelations: NonNullable<RefinementResult["diagnostics"]>["highCorrelations"]): NonNullable<RefinementResult["diagnostics"]> => ({
      svdZeroCount: 0, singularParameterIds: [], conditionNumber: 100, maxLambda: 1, atBounds: [], maxShiftOverEsd: 0, highCorrelations,
    });
    const sc = [param("scale", "scale", 1), param("extinction", "extinction", 20), param("B_O1", "bIso", 0.3), param("occ_O1", "occupancy", 1)];
    const a = assessRefinement({
      result: result({ diagnostics: diagnostics([
        { parameterIdA: "scale", parameterIdB: "B_O1", coefficient: 0.976, conditional: 0.722 },
        { parameterIdA: "scale", parameterIdB: "extinction", coefficient: 0.989, conditional: 0.95 },
        { parameterIdA: "B_O1", parameterIdB: "occ_O1", coefficient: 0.97, conditional: 0.95 },
      ]) }),
      parameters: sc,
      observationCount: 400,
      mode: "single-crystal",
    });
    const of = (a1: string, b1: string) => a.findings.find((x) => x.category === "correlation" && x.parameterIds?.join() === `${a1},${b1}`)!;
    expect([of("scale", "B_O1").severity, of("scale", "extinction").severity, of("B_O1", "occ_O1").severity]).toEqual(["note", "note", "warning"]);
    expect(of("scale", "B_O1").detail).toMatch(/carried by a third free parameter: with every other free parameter held fixed they correlate at 0\.72/i);
    expect(of("scale", "extinction").detail).toMatch(/overall intensity terms/);
    // On powder the scale and the extinction are not exempt: two phases' scales at −0.99 are a real problem there.
    const powder = assessRefinement({
      result: result({ diagnostics: diagnostics([{ parameterIdA: "scale", parameterIdB: "extinction", coefficient: 0.989, conditional: 0.95 }]) }),
      parameters: sc,
      observationCount: 4000,
    });
    expect(powder.findings.find((x) => x.category === "correlation")?.severity).toBe("warning");
  });

  it("notes the TOF peak-shape terms among themselves, and warns when one trades with anything else", () => {
    // AWO₄ at 8 K on POWGEN, the profile freed with the moments held: the guard refines α, β, σ and the
    // zero together (correlationGuard.ts), so the assessment must not tell the model to split them.
    const diagnostics = (highCorrelations: NonNullable<RefinementResult["diagnostics"]>["highCorrelations"]): NonNullable<RefinementResult["diagnostics"]> => ({
      svdZeroCount: 0, singularParameterIds: [], conditionNumber: 100, maxLambda: 1, atBounds: [], maxShiftOverEsd: 0, highCorrelations,
    });
    const tof = [param("tof_alpha1", "tofProfile", 0.14), param("tof_beta0", "tofProfile", 0.004), param("zero", "zeroShift", 10), param("cell_a", "cellLength", 4.68)];
    const a = assessRefinement({
      result: result({ diagnostics: diagnostics([
        { parameterIdA: "tof_alpha1", parameterIdB: "tof_beta0", coefficient: 0.997, conditional: 0.99 },
        { parameterIdA: "tof_beta0", parameterIdB: "zero", coefficient: 0.995, conditional: 0.99 },
        { parameterIdA: "zero", parameterIdB: "cell_a", coefficient: 0.98, conditional: 0.97 },
      ]) }),
      parameters: tof,
      observationCount: 3600,
    });
    const of = (a1: string, b1: string) => a.findings.find((x) => x.category === "correlation" && x.parameterIds?.join() === `${a1},${b1}`)!;
    expect([of("tof_alpha1", "tof_beta0").severity, of("tof_beta0", "zero").severity, of("zero", "cell_a").severity]).toEqual(["note", "note", "warning"]);
    expect(of("tof_alpha1", "tof_beta0").detail).toMatch(/TOF peak-shape terms/);
  });

  it("reads a PDF fit without a GoF band, the mode taken from its parameters when not given", () => {
    // MCP could not ask for the PDF mode, so assess_refinement on a refine_pdf result read the
    // engine's GoF with the powder bands; the app's page stripped it before calling.
    const pdf = [param("pdfScale", "pdfScale", 1), param("qdamp", "qdamp", 0.03)];
    for (const mode of ["pdf", undefined] as const) {
      const a = assessRefinement({ result: result({ agreement: { goodnessOfFit: 4.2, rWeighted: 0.12 } }), parameters: pdf, observationCount: 2000, ...(mode ? { mode } : {}) });
      expect(a.verdict.gof).toBeUndefined();
      expect(a.verdict.band).toBe("fair");
      expect(a.verdict.rationale).toMatch(/^Converged\. A PDF fit has no goodness of fit/);
    }
  });

  it("reports the correlations below the refusal limit, never silently (the user's rule)", () => {
    const a = assessRefinement({
      result: result({
        diagnostics: {
          svdZeroCount: 0, singularParameterIds: [], conditionNumber: 100, maxLambda: 1,
          atBounds: [], maxShiftOverEsd: 0, highCorrelations: [],
          moderateCorrelations: [{ parameterIdA: "scale", parameterIdB: "B1", coefficient: 0.87 }],
        },
      }),
      parameters: [param("scale", "scale", 1), param("B1", "bIso", 0.5)],
      observationCount: 4000,
    });
    const f = a.findings.find((x) => x.category === "correlation");
    expect(f?.severity).toBe("note");
    expect(f?.summary).toMatch(/1 pair correlates at \|ρ\| 0\.8–0\.95: scale ↔ B1 0\.87/);
  });

  it("flags an at-bound ADP as critical with expert context", () => {
    const a = assessRefinement({
      result: result({
        diagnostics: {
          svdZeroCount: 0, singularParameterIds: [], conditionNumber: 100, maxLambda: 1,
          highCorrelations: [], maxShiftOverEsd: 0,
          atBounds: [{ parameterId: "Fe1_B", bound: "min", value: 0 }],
        },
      }),
      parameters: [param("Fe1_B", "bIso", 0)],
      observationCount: 4000,
    });
    const f = a.findings.find((x) => x.category === "at-bound");
    expect(f?.severity).toBe("critical");
  });

  it("suspects the mixing for an ADP at a bound on a shared site", () => {
    const diagnostics = {
      svdZeroCount: 0, singularParameterIds: [], conditionNumber: 100, maxLambda: 1,
      highCorrelations: [], maxShiftOverEsd: 0,
      atBounds: [{ parameterId: "B_Al2", bound: "min" as const, value: 0 }],
    };
    const shared = assessRefinement({ result: result({ diagnostics }), parameters: [param("B_Al2", "bIso", 0)], observationCount: 4000, sharedSiteAdps: ["B_Al2"] });
    expect(shared.findings.find((x) => x.category === "at-bound")?.detail).toMatch(/scatters more than the model puts on it.*mixing is off/);
    const lone = assessRefinement({ result: result({ diagnostics }), parameters: [param("B_Al2", "bIso", 0)], observationCount: 4000 });
    expect(lone.findings.find((x) => x.category === "at-bound")?.detail).toMatch(/over-damping/);
  });

  it("notes occupancies tied by a restraint once, and still warns about the scale", () => {
    const a = assessRefinement({
      result: result({
        diagnostics: {
          svdZeroCount: 0, singularParameterIds: [], conditionNumber: 100, maxLambda: 1, atBounds: [], maxShiftOverEsd: 0,
          highCorrelations: [
            { parameterIdA: "occ_Mg1", parameterIdB: "occ_Al1", coefficient: -0.97 },
            { parameterIdA: "scale", parameterIdB: "occ_Al1", coefficient: 0.96 },
          ],
        },
      }),
      parameters: [param("scale", "scale", 1), param("occ_Mg1", "occupancy", 0.75), param("occ_Al1", "occupancy", 0.25)],
      observationCount: 4000,
      restraints: [{ id: "occ_sum_Mg1", label: "Σ occ @ Mg1 site", target: 1, sigma: 0.01, terms: [{ parameterId: "occ_Mg1", coefficient: 1 }, { parameterId: "occ_Al1", coefficient: 1 }] }],
    });
    const corr = a.findings.filter((x) => x.category === "correlation");
    expect(corr.map((f) => [f.severity, f.summary])).toEqual(expect.arrayContaining([
      ["info", "Parameters tied by a restraint correlate (up to 0.970): Σ occ @ Mg1 site."],
      ["warning", "scale ↔ occ_Al1 correlate at 0.96."],
    ]));
    expect(corr).toHaveLength(2);
  });

  it("warns when data barely supports the free parameters", () => {
    const params = Array.from({ length: 30 }, (_, i) => param(`p${i}`, "atomX", 0.1));
    const a = assessRefinement({ result: result(), parameters: params, observationCount: 80 });
    const f = a.findings.find((x) => x.category === "parameterization");
    expect(f?.severity).toBe("warning");
  });

  it("detects unexplained residual peaks as the discovery signal", () => {
    // A sharp positive residual bump (obs > calc) around d = 2.5 Å.
    const n = 200;
    const d: number[] = [];
    const yObs: number[] = [];
    const yCalc: number[] = [];
    for (let i = 0; i < n; i++) {
      const dd = 1 + (i / n) * 3; // 1..4 Å
      d.push(dd);
      const base = 100;
      const bump = Math.abs(dd - 2.5) < 0.03 ? 900 : 0;
      yCalc.push(base);
      yObs.push(base + bump);
    }
    const a = assessRefinement({
      result: result(),
      parameters: [param("scale", "scale", 1)],
      observationCount: n,
      residual: { d, yObs, yCalc },
    });
    const f = a.findings.find((x) => x.category === "residual");
    expect(f).toBeDefined();
    expect(f?.detail).toMatch(/impurity|phase|magnetic/i);
  });
});

describe("residual peaks against the line width", () => {
  // Lines 0.4 % wide in d (a CW neutron pattern); an extra peak 1.5 % from a
  // reflection — the cryostat's Al 111 beside Cr₂WO₆ 200.
  const d = Array.from({ length: 3000 }, (_, i) => 1.5 + i * 0.001);
  const line = (x: number, c: number, h: number): number => h * Math.exp((-4 * Math.LN2 * ((x - c) / (0.004 * c)) ** 2));
  const centers = [1.8, 2.0, 2.287, 2.6, 3.1, 3.6, 4.1];
  const yCalc = d.map((x) => 50 + centers.reduce((s, c) => s + line(x, c, 2000), 0));
  const extra = 2.287 * 1.015;
  const yObs = d.map((x, i) => yCalc[i]! + line(x, extra, 300));
  const reflections = centers.map((c, i) => ({ d: c, hkl: `${i} 0 0`, phaseLabel: "sample" }));

  it("measures the lines' width as a fraction of d", () => {
    expect(relativeLineWidth(d, yCalc)).toBeCloseTo(0.004, 3);
  });

  it("calls a peak four widths away an extra peak on CW data, and keeps the wide window without the width", () => {
    const lineWidth = relativeLineWidth(d, yCalc)!;
    const cw = residualPeaks({ d, yObs, yCalc, reflections, lineWidth });
    expect(cw.between.map((p) => Math.round(p.d * 1000))).toEqual([Math.round(extra * 1000)]);
    // Without the width the window is the wide 2 % — but a bump the line's
    // calculated intensity does not reach is a resolved peak, not its tail.
    const wide = residualPeaks({ d, yObs, yCalc, reflections });
    expect(wide.between.map((p) => Math.round(p.d * 1000))).toEqual([Math.round(extra * 1000)]);
    expect(wide.beside).toEqual([]);
  });

  it("keeps a bump on a line's own tail beside it (a TOF line tailing to larger d)", () => {
    const tail = (x: number, c: number, h: number): number => line(x, c, h) + (x > c ? 0.1 * h * Math.exp(-(x - c) / (0.01 * c)) : 0);
    const yTail = d.map((x) => 50 + centers.reduce((s, c) => s + tail(x, c, 2000), 0));
    const bump = d.map((x, i) => yTail[i]! + line(x, extra, 60));
    const tof = residualPeaks({ d, yObs: bump, yCalc: yTail, reflections });
    expect(tof.between).toEqual([]);
    expect(tof.beside.map((p) => Math.round(p.d * 1000))).toEqual([Math.round(extra * 1000)]);
  });
});

describe("assessRefinement — convergence (shift/esd)", () => {
  const assessFit = (problem: RefinementProblem, r: RefinementResult) =>
    assessRefinement({
      result: r,
      parameters: problem.parameters.map((p) => ({ ...p, value: r.parameters[p.id] ?? p.value })),
      observationCount: problem.observations.length,
    });
  const convergence = (a: ReturnType<typeof assessRefinement>) => a.findings.filter((f) => f.category === "convergence");

  it("does not flag a converged fit whose position offset refined to ~0", () => {
    // Positions refine as offsets from the starting coordinates, so they end
    // near 0. The old relative shift |Δp|/|p| exploded there and warned on
    // every such fit; against the esd the last step is negligible.
    const problem = noisyPeakProblem({ start: 0.01 });
    const r = refine(problem);
    expect(r.status).toBe("converged");
    expect(Math.abs(r.parameters.pos!)).toBeLessThan(1e-4 * r.esd.pos!);
    expect(r.diagnostics!.maxShiftOverEsd).toBeLessThan(0.1);
    expect(convergence(assessFit(problem, r))).toEqual([]);
  });

  it("warns when the fit stopped on χ² while a parameter was still moving", () => {
    // Heavy damping covers a fraction of the way per step, and a loose χ²
    // tolerance then stops the search with the offset still esds from its
    // optimum (exactly 0 for this problem).
    const problem = noisyPeakProblem({ start: 0.015 });
    const r = refine(problem, { lambda: 10, convergenceTolerance: 0.1 });
    expect(r.status).toBe("converged");
    expect(Math.abs(r.parameters.pos!)).toBeGreaterThan(3 * r.esd.pos!);
    const [f] = convergence(assessFit(problem, r));
    expect(f?.severity).toBe("warning");
    expect(f?.parameterIds).toEqual(["pos"]);
    expect(f?.summary).toMatch(/peak offset was still moving/);
    expect(f?.evidence?.maxShiftOverEsd).toBeGreaterThan(1);
  });

  it("notes, without counting it as an issue, a last shift between 0.1 and 1 esd", () => {
    const diagnostics = {
      svdZeroCount: 0, singularParameterIds: [], conditionNumber: 100, maxLambda: 1e-3,
      highCorrelations: [], atBounds: [],
    };
    const params = [param("bkg0", "background", 10)];
    const settled = assessRefinement({
      result: result({ diagnostics: { ...diagnostics, maxShiftOverEsd: 0.08, maxShiftParameterId: "bkg0" } }),
      parameters: params,
      observationCount: 4000,
    });
    expect(convergence(settled)).toEqual([]);
    const unsettled = assessRefinement({
      result: result({ diagnostics: { ...diagnostics, maxShiftOverEsd: 0.4, maxShiftParameterId: "bkg0" } }),
      parameters: params,
      observationCount: 4000,
    });
    expect(convergence(unsettled).map((f) => f.severity)).toEqual(["note"]);
    expect(convergence(unsettled)[0]?.parameterIds).toEqual(["bkg0"]);
    expect(unsettled.summary).toMatch(/no issues flagged/);
  });
});

describe("suggestNextSteps", () => {
  it("prioritizes fixing an unphysical value before anything else", () => {
    const a = assessRefinement({ result: result(), parameters: [param("Fe1_B", "bIso", -0.3)], observationCount: 4000 });
    const steps = suggestNextSteps(a);
    expect(steps[0]?.addresses).toContain("physical");
    expect(steps[0]?.action).toMatch(/trace the upstream cause/);
  });

  it("for a held unphysical value, points at the starting structure instead of the fit", () => {
    const a = assessRefinement({ result: result(), parameters: [param("Fe1_B", "bIso", -0.3, { fixed: true })], observationCount: 4000 });
    const steps = suggestNextSteps(a);
    expect(steps[0]?.addresses).toContain("physical");
    expect(steps[0]?.action).toMatch(/Correct Fe1_B in the starting structure/);
    expect(steps[0]?.action).not.toMatch(/upstream cause/);
  });

  it("on a clean, good fit points at validation rather than more refinement", () => {
    const a = assessRefinement({ result: result(), parameters: [param("scale", "scale", 1)], observationCount: 4000 });
    const steps = suggestNextSteps(a);
    expect(steps.some((s) => /validat/i.test(s.action))).toBe(true);
  });

  it("suggests a phase / k-search when residual peaks are present", () => {
    const n = 200;
    const d: number[] = [], yObs: number[] = [], yCalc: number[] = [];
    for (let i = 0; i < n; i++) {
      const dd = 1 + (i / n) * 3;
      d.push(dd); yCalc.push(100);
      yObs.push(100 + (Math.abs(dd - 2.5) < 0.03 ? 900 : 0));
    }
    const a = assessRefinement({ result: result(), parameters: [param("scale", "scale", 1)], observationCount: n, residual: { d, yObs, yCalc } });
    const steps = suggestNextSteps(a);
    expect(steps.some((s) => s.addresses.includes("residual"))).toBe(true);
  });
});

describe("data per parameter on powder", () => {
  it("counts the reflections in the fitted range against the structural parameters, not the profile points", () => {
    const p = (id: string, kind: RefinementParameter["kind"]): RefinementParameter => ({ id, label: id, kind, value: 0.1, initialValue: 0.1, fixed: false });
    const structural = Array.from({ length: 12 }, (_, i) => p(`x${i}`, "atomX"));
    const parameters = [p("scale", "scale"), p("bkg0", "background"), p("W", "profileW"), ...structural];
    const result = { status: "converged", parameters: Object.fromEntries(parameters.map((q) => [q.id, q.value])), esd: {}, agreement: { rWeighted: 0.05, goodnessOfFit: 1.1 }, history: [], diagnostics: { svdZeroCount: 0, singularParameterIds: [], conditionNumber: 1e3, highCorrelations: [], maxLambda: 1, atBounds: [], maxShiftOverEsd: 0.01 } } as unknown as RefinementResult;
    const residual = (reflections: number) => ({ d: [], yObs: [], yCalc: [], reflections: Array.from({ length: reflections }, (_, i) => ({ d: 1 + i * 0.01, hkl: `${i} 0 0`, phaseLabel: "P" })) });
    const finding = (reflections: number) => assessRefinement({ result, parameters, observationCount: 5000, residual: residual(reflections) }).findings.find((f) => f.category === "parameterization");
    // 5000 points but 30 reflections for 12 positions: 2.5 per parameter, a warning (points would say 333).
    expect(finding(30)?.severity).toBe("warning");
    expect(finding(30)?.summary).toMatch(/2\.5 reflections per free structural parameter \(12 free structural \/ 30 reflections/);
    expect(finding(300)).toBeUndefined();
  });
});
