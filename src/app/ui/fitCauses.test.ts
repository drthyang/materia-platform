import { describe, it, expect } from "vitest";
import { causeRows, headlineCause, whereSummary, type CauseContext } from "@/app/ui/fitCauses";
import type { FitCause, FitDiagnosis } from "@/core/diagnostics/fitDiagnosis";
import type { PowderValidation } from "@/core/diagnostics/powderValidation";
import type { RefinementParameter } from "@/core/refinement/types";

function param(id: string, kind: RefinementParameter["kind"], free = false): RefinementParameter {
  return { id, label: id, kind, value: 1, initialValue: 1, fixed: !free };
}

const validation = (shells: { lo: number; hi: number; n: number; chi2PerPoint: number; share: number }[] = []): PowderValidation => ({
  agreement: { n: 1000, nParams: 9, rp: 0.04, rwp: 0.05, rexp: 0.02, gof: 2.5, chi2nu: 6.25 },
  delta: new Float64Array(0),
  cumulative: new Float64Array(0),
  chi2: 6000,
  shells,
  shellAxis: "d",
});

function diagnosis(causes: FitCause[], extra: Partial<FitDiagnosis> = {}): FitDiagnosis {
  return { validation: validation(), worst: [], causes, reading: "", ...extra };
}

const cause = (id: FitCause["id"], share: number, evidence = "the agent's evidence", action = "the agent's action"): FitCause => ({ id, share, evidence, action });

/** A TOF page: scale, background and cell free (the first block done), the rest held. */
const tofRows = [
  param("scale", "scale", true), param("bkg0", "background", true), param("cell_a", "cellLength", true),
  param("zero", "zeroShift"), param("tof_sig2", "tofProfile"), param("tof_beta0", "tofProfile"),
  param("B_Mn1", "bIso"), param("pos_Mn1", "positionShift"), param("occ_Ga1", "occupancy"),
];
/** A constant-wavelength page with Caglioti and Lorentzian rows. */
const cwRows = [
  param("scale", "scale", true), param("bkg0", "background", true), param("cell_a", "cellLength", true),
  param("zero", "zeroShift"), param("U", "profileU"), param("V", "profileV"), param("W", "profileW"), param("X", "profileX"), param("Y", "profileY"),
  param("B_O1", "bIso"), param("x_O1", "atomX"), param("occ_O1", "occupancy"),
];

const ctx = (parameters: RefinementParameter[], over: Partial<CauseContext> = {}): CauseContext => ({
  parameters, twoTheta: parameters.some((p) => p.kind === "profileU"), backgroundTerms: 4, stagesDone: ["base"], ...over,
});

const tails = { median: 0.96, low: 0.96, high: 0.91, lines: 15, etaObs: 0.31, etaCalc: -0.004, shapeLines: 12 };

describe("what limits the fit, in the page's words", () => {
  it("keeps diagnose_fit's causes, order and shares, with its evidence behind each row", () => {
    const dx = diagnosis([cause("peak-tails", 0.85, "the observed lines are more Lorentzian than calculated"), cause("unexplained-peak", 0.1)], {
      width: tails,
      unexplained: [{ d: 0.468, x: 10570, significance: 16, xFrom: 10560, xTo: 10580, netIntensity: 5 }, { d: 2.149, x: 48000, significance: 8, xFrom: 47990, xTo: 48010, netIntensity: 3 }],
    });
    const rows = causeRows(dx, ctx(tofRows));
    expect(rows.map((r) => [r.id, r.share])).toEqual([["peak-tails", 0.85], ["unexplained-peak", 0.1]]);
    expect(rows[0]).toMatchObject({ title: "Peak tails", phrase: "the peak tails", detail: "the observed lines are more Lorentzian than calculated" });
    expect(rows[0]!.evidence).toBe("The observed peaks have longer tails than the model's.");
    expect(rows[0]!.statistic).toBe("η 0.31 observed against 0.00 calculated · 12 isolated lines");
    expect(rows[1]!.evidence).toBe("2 excesses between the lines that no phase explains, at d 0.468, 2.149 Å.");
    // The row shows each in a few words; the sentences above are its tooltip.
    expect(rows[0]!.summary).toBe("Model's tails too short");
    expect(rows[0]!.todo).toBe("Refine TOF σ and β (keep α), after the atom positions");
    expect(rows[1]!.summary).toBe("2 excesses at d 0.468, 2.149 Å");
    expect(rows[1]!.todo).toBe("Another phase or magnetic order — not background");
    expect(causeRows(dx, ctx(tofRows, { magneticNeutron: { k0: false } }))[1]!.todo).toBe("Try the k-search, then another phase — not background");
    // The strongest excess on the pattern's own axis.
    expect(rows[1]!.buttons[0]).toMatchObject({ label: "Show on pattern", action: { kind: "pattern", x: 10570 } });
  });

  it("words the profile advice for the page's profile: the TOF shape (α held), or the Lorentzian X and Y with the Caglioti terms", () => {
    const dx = diagnosis([cause("peak-tails", 0.6)], { width: tails });
    const tof = causeRows(dx, ctx(tofRows))[0]!;
    expect(tof.action).toMatch(/^Refine the TOF peak shape: the widths σ and the decay β, with the rise α held at the instrument's value\./);
    expect(tof.buttons).toEqual([{ label: "Open Instrument / profile", title: "Open the Instrument / profile group in the parameter panel (nothing is freed)", action: { kind: "parameters", group: "Instrument / profile" } }]);
    const cw = causeRows(dx, ctx(cwRows))[0]!;
    expect(cw.action).toMatch(/^A Lorentzian part is missing: free X \(size\) and Y \(strain\) with the Caglioti terms/);
    expect(cw.buttons[0]!.action).toEqual({ kind: "parameters", group: "Microstructure" });
    expect(cw.summary).toBe("Model's tails too short (data more Lorentzian)");
    expect(cw.todo).toBe("Free X, Y with U, V, W; hold a negative one at 0, after the atom positions");
    const lorentzian = causeRows(diagnosis([cause("peak-tails", 0.6)], { width: { ...tails, etaObs: 0.1, etaCalc: 0.5 } }), ctx(cwRows))[0]!;
    expect(lorentzian.summary).toBe("Model's tails too long (data less Lorentzian)");
    expect(lorentzian.todo).toMatch(/^Refine X, Y with U, V, W, or hold them at the instrument's values/);
  });

  it("keeps the method's order: the atom positions are a quick pass before the profile, unless the widths are far off", () => {
    const tailsRow = causeRows(diagnosis([cause("peak-tails", 0.6)], { width: tails }), ctx(tofRows))[0]!;
    expect(tailsRow.action).toMatch(/After a quick pass on the atom positions \(your method's order\)\.$/);
    const done = causeRows(diagnosis([cause("peak-tails", 0.6)], { width: tails }), ctx(tofRows, { stagesDone: ["base", "positions"] }))[0]!;
    expect(done.action).not.toMatch(/atom positions/);
    expect(done.todo).toBe("Refine TOF σ and β (keep α)");
    const wide = causeRows(diagnosis([cause("peak-width", 0.5)], { width: { median: 2.4, low: 2.4, high: 2.4, lines: 9 } }), ctx(cwRows))[0]!;
    expect(wide.evidence).toBe("The observed peaks are 2.40× broader than the model's at half maximum.");
    expect(wide.action).toMatch(/Before the atom positions: atoms refined against lines this wrong absorb the misfit\.$/);
    // The order stays on the row; the reason is the tooltip's.
    expect(wide.summary).toBe("Observed 2.40× broader than the model (FWHM)");
    expect(wide.todo).toBe("Free W, then U and V, before the atom positions");
    const growing = causeRows(diagnosis([cause("peak-width", 0.5)], { width: { median: 1.6, low: 1.2, high: 2.0, lines: 9 } }), ctx(cwRows, { stagesDone: ["base", "positions"] }))[0]!;
    expect(growing.todo).toBe("Free W, then U and V; U and Y matter most");
    const narrow = causeRows(diagnosis([cause("peak-width", 0.5)], { width: { median: 0.7, low: 0.7, high: 0.7, lines: 9 } }), ctx(cwRows, { stagesDone: ["base", "positions"] }))[0]!;
    expect(narrow.summary).toBe("Observed 0.70× narrower than the model (FWHM)");
    expect(narrow.todo).toBe("Free W, then U and V; hold X and Y at the instrument's values");
  });

  it("never suggests occupancy before the positions, the profile and the B values; then only under a tie", () => {
    const structure = (stagesDone: string[], rows = tofRows) => causeRows(diagnosis([cause("structure", 0.4)]), ctx(rows, { stagesDone }))[0]!;
    expect(structure(["base"]).action).toMatch(/^Free the atom positions/);
    expect(structure(["base"]).buttons[0]!.action).toEqual({ kind: "parameters", group: "Positions" });
    expect(structure(["base", "positions"]).action).toMatch(/^The profile comes next in your method, then the B values/);
    expect(structure(["base", "positions", "profile"]).action).toMatch(/^Free the B values; anisotropic only if the data clearly support it\.$/);
    const last = structure(["base", "positions", "profile", "adp"]);
    expect(last.action).toMatch(/occupancy is last, and only under a tie \(Σ = 1 on a shared site, a known composition\) or with a second contrast/);
    expect(last.buttons[0]!.action).toEqual({ kind: "parameters", group: "Occupancy" });
    for (const s of [["base"], ["base", "positions"], ["base", "positions", "profile"]]) {
      expect(structure(s).action).not.toMatch(/occupanc/i);
      expect(structure(s).todo).not.toMatch(/occupanc/i);
    }
    expect(structure(["base"]).summary).toBe("Intensities off with no trend: the atoms");
    expect(structure(["base"]).todo).toBe("Free the atom positions (a quick pass, before the profile)");
    expect(structure(["base", "positions"]).todo).toBe("Refine the profile next, then the B values");
    expect(structure(["base", "positions", "profile"]).todo).toBe("Free the B values; anisotropic only if clearly supported");
    expect(last.todo).toBe("Occupancy last, only under a tie or a second contrast; then check bond lengths");
  });

  it("the intensity fall-off: the B values, after the profile; with them free, an absorption or roughness correction", () => {
    const wilson = { deltaB: 0.6, r: -0.7, n: 40 };
    const held = causeRows(diagnosis([cause("intensity-falloff", 0.3)], { wilson }), ctx(tofRows))[0]!;
    expect(held.evidence).toBe("Reflections at short d are calculated too strong: as if the B values were too small by 0.60 Å².");
    expect(held.action).toBe("Free the B values — after the profile, in your method's order; alternate them with the profile terms, never both free.");
    expect(held.summary).toBe("Calculated too strong at short d, as if B were 0.60 Å² too small");
    expect(held.todo).toBe("Free the B values after the profile (never both free)");
    expect(held.buttons[0]!.action).toEqual({ kind: "parameters", group: "ADPs (thermal)" });
    const free = causeRows(diagnosis([cause("intensity-falloff", 0.3)], { wilson }), ctx(tofRows.map((p) => (p.kind === "bIso" ? { ...p, fixed: false } : p)), { stagesDone: ["base", "positions", "profile"] }))[0]!;
    expect(free.action).toMatch(/^The B values are free already: a missing absorption \(μR\) or surface-roughness correction/);
    expect(free.todo).toBe("The B values are free: try an absorption (μR) or roughness correction");
    // With the profile terms still free, the B values wait for them.
    const alternate = causeRows(diagnosis([cause("intensity-falloff", 0.3)], { wilson }), ctx(tofRows.map((p) => (p.kind === "tofProfile" ? { ...p, fixed: false } : p)), { stagesDone: ["base", "positions", "profile"] }))[0]!;
    expect(alternate.todo).toBe("Fix the profile terms, then free the B values");
    // The k = 0 signature comes first on a neutron pattern of magnetic ions.
    const k0 = causeRows(diagnosis([cause("intensity-falloff", 0.3)], { wilson }), ctx(tofRows, { magneticNeutron: { k0: true } }))[0]!;
    expect(k0.action).toMatch(/^First rule out k = 0 magnetic order/);
    expect(k0.todo).toBe("Rule out k = 0 magnetic order; if none, free the B values after the profile (never both free)");
    expect(k0.buttons.map((b) => b.action.kind)).toEqual(["parameters", "magnetic"]);
  });

  it("a misfit of the first block (positions or background) is fixed before the later blocks are read", () => {
    const dx = diagnosis([cause("peak-tails", 0.97), cause("peak-position", 0.21, "the residual sits on the high-x side of the peaks across the pattern (83% one-sided)")], { width: tails });
    const rows = causeRows(dx, ctx(tofRows));
    expect(rows.map((r) => r.id)).toEqual(["peak-tails", "peak-position"]);
    expect(rows[0]!.action).toMatch(/^Fix the peak positions first: your method refines the cell, zero and background before the rest\. Refine the TOF peak shape/);
    expect(rows[0]!.todo).toBe("Fix the peak positions first, then refine TOF σ and β (keep α), after the atom positions");
    expect(rows[1]!.evidence).toBe("The observed peaks sit on the high-TOF side of the model's, across the pattern.");
    expect(rows[1]!.statistic).toBe("83% one-sided");
    expect(rows[1]!.action).toBe("A position error: refine the zero with the cell (the diffractometer constants stay the instrument's).");
    expect(rows[1]!.summary).toBe("Observed peaks shifted to higher TOF throughout");
    expect(rows[1]!.todo).toBe("Refine the zero with the cell; keep the diffractometer constants");
    const cw = causeRows(diagnosis([cause("peak-position", 0.3, "the residual sits on the low-x side of the peaks across the pattern (90% one-sided)")]), ctx(cwRows))[0]!;
    expect(cw.summary).toBe("Observed peaks shifted to lower angle throughout");
    expect(cw.todo).toBe("Refine the zero with the cell, or the sample displacement on flat plate — not both");
    // The headline names the first block's misfit, not the larger share it overlaps.
    expect(headlineCause(rows)).toEqual({ phrase: "the peak positions", share: 0.21, first: true });
    expect(headlineCause(rows.slice(0, 1))).toEqual({ phrase: "the peak tails", share: 0.97, first: false });
    expect(headlineCause([])).toBeUndefined();
  });

  it("the background: the count the points between the lines support, or another function", () => {
    const between = { share: 0.4, chi2PerPoint: 6.2, points: 700 };
    const more = causeRows(diagnosis([cause("background", 0.4)], { betweenPeaks: between, backgroundTerms: { justified: 8, points: 700, byTerms: [], excess: [] } }), ctx(tofRows))[0]!;
    expect(more.action).toBe("Use 8 background terms instead of 4 (what the points between the lines support), then refine the background alone.");
    expect(more.statistic).toBe("χ² 6.2 per point there, noise gives 1 · 700 points");
    expect(more.summary).toBe("Misses the data between the peaks");
    expect(more.todo).toBe("Use 8 terms instead of 4, then refine it alone");
    const enough = causeRows(diagnosis([cause("background", 0.4)], { betweenPeaks: between, backgroundTerms: { justified: 3, points: 700, byTerms: [], excess: [] } }), ctx(tofRows))[0]!;
    expect(enough.action).toMatch(/^More terms are not justified \(the points between the lines support 3; the page has 4\)/);
    expect(enough.buttons[0]!.action).toEqual({ kind: "parameters", group: "Background" });
    expect(enough.todo).toBe("No more terms (3 supported, 4 used): try another function, or scattering the model lacks");
    const lines = causeRows(diagnosis([cause("background", 0.4)], { betweenPeaks: between, backgroundTerms: { justified: 8, points: 700, byTerms: [], excess: [{ d: 2.1, x: 1, significance: 9, xFrom: 0, xTo: 2, netIntensity: 1 }] } }), ctx(tofRows))[0]!;
    expect(lines.todo).toBe("Explain the lines no phase explains first, then read it again");
    const unread = causeRows(diagnosis([cause("background", 0.4)]), ctx(tofRows))[0]!;
    expect(unread.todo).toBe("Refine it alone; if it still misses, add terms or change its function");
  });
});

describe("every row in a few words, the full account behind it", () => {
  const words = (t: string): number => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const wilson = { deltaB: -0.4, r: -0.6, n: 30 };
  const texture = { axis: [0, 0, 1] as [number, number, number], ratio: 0.8, atLimit: false, explained: 0.6, chance: 0.001, n: 20, axes: 7, enhancedAlongAxis: true };
  const variants = (): ReturnType<typeof causeRows> => {
    const out: ReturnType<typeof causeRows> = [];
    for (const rows of [tofRows, cwRows]) {
      for (const stagesDone of [["base"], ["base", "positions"], ["base", "positions", "profile"], ["base", "positions", "profile", "adp"]]) {
        const c = ctx(rows, { stagesDone });
        out.push(
          ...causeRows(diagnosis([cause("peak-tails", 0.5)], { width: tails }), c),
          ...causeRows(diagnosis([cause("peak-width", 0.5)], { width: { median: 1.5, low: 1.1, high: 1.9, lines: 9 } }), c),
          ...causeRows(diagnosis([cause("peak-width", 0.5)], { width: { median: 1.5, low: 1.9, high: 1.1, lines: 9 } }), c),
          ...causeRows(diagnosis([cause("peak-shape", 0.5)], { width: { median: 1.01, low: 1, high: 1, lines: 9 } }), { ...c, widthsFree: true }),
          ...causeRows(diagnosis([cause("peak-shape", 0.5)], { width: { median: 1.3, low: 1.3, high: 1.3, lines: 9 } }), c),
          ...causeRows(diagnosis([cause("asymmetry", 0.5, "62% of the peak-shape misfit is in the lowest third")]), c),
          ...causeRows(diagnosis([cause("intensity-falloff", 0.5)], { wilson }), c),
          ...causeRows(diagnosis([cause("texture", 0.5)], { texture }), c),
          ...causeRows(diagnosis([cause("structure", 0.5)]), c),
          ...causeRows(diagnosis([cause("peak-position", 0.5, "the residual sits on the low-x side of the peaks (88% one-sided)")]), c),
          ...causeRows(diagnosis([cause("background", 0.5)]), c),
          ...causeRows(diagnosis([cause("unexplained-peak", 0.5)], { unexplained: [{ d: 1.234, x: 1, significance: 7, xFrom: 0, xTo: 2, netIntensity: 1 }] }), c),
        );
      }
    }
    return out;
  };

  it("shows each cause, on TOF and CW, at every stage of the method, as one short line of evidence and one of action", () => {
    const rows = variants();
    expect(new Set(rows.map((r) => r.id)).size).toBe(10);
    for (const r of rows) {
      expect(words(r.summary), r.summary).toBeLessThanOrEqual(14);
      expect(words(r.todo), r.todo).toBeLessThanOrEqual(17);
      // Shorter than the sentence it stands for, which the tooltip keeps.
      expect(r.todo.length, r.todo).toBeLessThan(r.action.length);
      expect(r.summary.length, r.summary).toBeLessThan(r.evidence.length);
    }
  });

  it("keeps the numbers the sentence shows", () => {
    for (const r of variants()) {
      for (const n of r.summary.match(/\d+\.\d+/g) ?? []) expect(r.evidence, r.summary).toContain(n);
    }
    const asym = causeRows(diagnosis([cause("asymmetry", 0.5)]), ctx(cwRows))[0]!;
    expect(asym.summary).toBe("One-sided misfit at low angle: axial divergence");
    expect(asym.todo).toBe("Switch on asymmetry and refine S/L with the profile, after the atom positions");
    const tex = causeRows(diagnosis([cause("texture", 0.5)], { texture }), ctx(cwRows))[0]!;
    expect(tex.summary).toBe("Reflections near [0 0 1] stronger than calculated");
    expect(tex.todo).toBe("Add March–Dollase along 0 0 1, after the structure, if the sample can be textured");
    const settled = causeRows(diagnosis([cause("peak-shape", 0.5)], { width: { median: 1.01, low: 1, high: 1, lines: 9 } }), ctx(cwRows, { widthsFree: true }))[0]!;
    expect(settled.summary).toBe("± misfit on both sides; widths already right");
    expect(settled.todo).toBe("Check the worst peaks: asymmetry, anisotropic broadening, or the profile's limit");
    const shape = causeRows(diagnosis([cause("peak-shape", 0.5)], { width: { median: 1.3, low: 1.3, high: 1.3, lines: 9 } }), ctx(cwRows))[0]!;
    expect(shape.todo).toBe("Free U, V, W together, then X and Y, after the atom positions");
    expect(causeRows(diagnosis([cause("peak-shape", 0.5)], { width: { median: 1.3, low: 1.3, high: 1.3, lines: 9 } }), ctx(tofRows))[0]!.todo).toBe("Refine TOF σ and β (keep α), after the atom positions");
    const weak = causeRows(diagnosis([cause("intensity-falloff", 0.5)], { wilson }), ctx(cwRows))[0]!;
    expect(weak.summary).toBe("Calculated too weak at short d, as if B were 0.40 Å² too large");
  });
});

describe("where the misfit sits", () => {
  const shells = [0.18, 0.13, 0.16, 0.13, 0.16, 0.1, 0.04, 0.04, 0.05, 0.02].map((share, i) => ({ lo: 0.4 + 0.5 * i, hi: 0.9 + 0.5 * i, n: 100, chi2PerPoint: 60 * share, share }));

  it("says the fewest points that hold half of χ² (what the worst peaks carry is the Worst peaks summary's)", () => {
    expect(whereSummary(validation(shells))).toBe("Half of χ² at d < 2.40 Å (40% of points)");
  });

  it("reads from long d when the misfit sits there", () => {
    const reversed = [...shells].reverse().map((s, i) => ({ ...s, lo: 0.4 + 0.5 * i, hi: 0.9 + 0.5 * i }));
    expect(whereSummary(validation(reversed))).toBe("Half of χ² at d > 3.40 Å (40% of points)");
  });

  it("says nothing without d-shells", () => {
    expect(whereSummary({ ...validation(shells), shellAxis: "x" })).toBeNull();
  });
});
