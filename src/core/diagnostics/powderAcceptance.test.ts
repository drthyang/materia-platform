import { describe, it, expect } from "vitest";
import { fitState, gofBand, physicalItems, powderAcceptance } from "@/core/diagnostics/powderAcceptance";
import { assessRefinement } from "@/core/diagnostics/assessment";
import { GOF_BANDS } from "@/core/diagnostics/thresholds";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";

function param(id: string, kind: RefinementParameter["kind"], value: number, opts: { fixed?: boolean; initial?: number; label?: string } = {}): RefinementParameter {
  return { id, label: opts.label ?? id, kind, value, initialValue: opts.initial ?? value, fixed: opts.fixed ?? false };
}

function result(values: Record<string, number>, over: Partial<RefinementResult> = {}, diagnostics: Partial<NonNullable<RefinementResult["diagnostics"]>> = {}): RefinementResult {
  return {
    status: "converged",
    parameters: values,
    esd: Object.fromEntries(Object.keys(values).map((k) => [k, 0.01])),
    agreement: { rFactor: 0.04, rWeighted: 0.05, rExpected: 0.04, goodnessOfFit: 1.25 },
    history: [{ iteration: 1, chiSquared: 1, agreement: { rFactor: 0.04 } }, { iteration: 2, chiSquared: 1, agreement: { rFactor: 0.04 } }],
    diagnostics: { svdZeroCount: 0, singularParameterIds: [], conditionNumber: 1e3, highCorrelations: [], maxLambda: 1, atBounds: [], maxShiftOverEsd: 0.02, ...diagnostics },
    ...over,
  };
}

const params = [param("scale", "scale", 1), param("B1", "bIso", 0.5)];
const fit = result({ scale: 1, B1: 0.5 });
const assess = (r: RefinementResult, p: readonly RefinementParameter[]) => assessRefinement({ result: r, parameters: [...p], observationCount: 4000, mode: "powder" });

describe("the goodness-of-fit bands", () => {
  it("are the assessment's (Toby 2006), so the tab and assess_refinement band a GoF alike", () => {
    expect(gofBand(0.6)).toBe("too-good");
    expect(gofBand(0.9)).toBe("excellent");
    expect(gofBand(GOF_BANDS.excellent)).toBe("excellent");
    expect(gofBand(2)).toBe("good");
    expect(gofBand(3.05)).toBe("fair");
    expect(gofBand(5)).toBe("poor");
    expect(gofBand(0)).toBeNull();
    for (const gof of [0.9, 1.4, 2, 3.05, 5]) {
      const engine = assess(result({ scale: 1, B1: 0.5 }, { agreement: { rFactor: 0.04, rWeighted: 0.05, rExpected: 0.04, goodnessOfFit: gof } }), params).verdict.band;
      expect(gofBand(gof)).toBe(engine);
    }
  });
});

describe("the state of the fit (never a stale 'not refined')", () => {
  it("a demo opened on its converged snapshot says so, and offers to refine for the esds", () => {
    const s = fitState(null, params, true);
    expect(s.kind).toBe("snapshot");
    expect(s.text).toBe("Opened on a converged fit, which carries no esds or correlations: refine once to get them.");
    expect(s.text).not.toMatch(/not refined/i);
    expect(s.refine).toBe(true);
  });

  it("with no result and nothing refined, says what to do: the method's first block", () => {
    const s = fitState(null, params);
    expect(s.kind).toBe("none");
    expect(s.text).toMatch(/^Not refined yet\. Your method starts with the scale, background and cell: free them in the parameter panel, then refine\.$/);
  });

  it("values moved from their start with no result: the model changed since its last refinement", () => {
    expect(fitState(null, [param("scale", "scale", 1.2, { initial: 1 })]).kind).toBe("changed");
  });

  it("reads a result: converged, settling, moving, stopped, diverged, edited since", () => {
    expect(fitState(fit, params)).toMatchObject({ kind: "converged", tone: "green", current: true, refine: false });
    expect(fitState(fit, params).text).toBe("Converged in 2 cycles: the last moved no parameter by more than 0.02 esd.");
    expect(fitState(result({ scale: 1, B1: 0.5 }, {}, { maxShiftOverEsd: 0.4, maxShiftParameterId: "B1" }), params)).toMatchObject({ kind: "settling", refine: true });
    expect(fitState(result({ scale: 1, B1: 0.5 }, {}, { maxShiftOverEsd: 2 }), params)).toMatchObject({ kind: "moving", tone: "amber" });
    expect(fitState(result({ scale: 1, B1: 0.5 }, { status: "maxIterations" }), params)).toMatchObject({ kind: "stopped", tone: "amber", text: "The last refinement stopped (at its cycle limit) before it converged: the values are provisional — refine again." });
    expect(fitState(result({ scale: 1, B1: 0.5 }, { status: "diverged" }), params)).toMatchObject({ kind: "diverged", tone: "red" });
    expect(fitState(fit, [param("scale", "scale", 1.3), param("B1", "bIso", 0.5)])).toMatchObject({ kind: "edited", current: false });
  });
});

describe("physical sanity, scaled", () => {
  const occ = (value: number, fixed: boolean) => [param("scale", "scale", 1), param("occ_Ga1", "occupancy", value, { fixed, label: "Mn3Ga: Ga1 occ" })];

  it("a held occupancy 0.5 % over 1 is a note to correct, not a blocker", () => {
    const items = physicalItems({ result: null, parameters: occ(1.005, true), structures: [] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ severity: "note", parameterIds: ["occ_Ga1"] });
    expect(items[0]!.text).toBe("Mn3Ga: Ga1 occ is held at 1.005 (0.5% over 1): an input the fit never moved — set it to 1.");
    const a = powderAcceptance({ gof: 1.2, result: null, parameters: occ(1.005, true), structures: [] });
    expect(a.checks[1]).toMatchObject({ id: "physical", tone: "green", value: "Nothing unphysical · 1 note" });
  });

  it("a held occupancy well outside [0, 1], or a refined one outside it, is to check (the assessment's warning)", () => {
    expect(physicalItems({ result: null, parameters: occ(1.05, true), structures: [] })[0]!.severity).toBe("issue");
    expect(physicalItems({ result: null, parameters: occ(1.005, false), structures: [] })[0]!.severity).toBe("issue");
    const rows = occ(1.05, true);
    const r = result({ scale: 1 });
    const a = powderAcceptance({ gof: 1.2, result: r, parameters: rows, structures: [], assessment: assess(r, rows) });
    expect(a.checks[1]).toMatchObject({ tone: "amber", value: "1 to check" });
    expect(a.tone).toBe("amber");
    expect(a.headline).toBe("Excellent fit (GoF 1.20), with 1 value to check.");
    expect(a.passes).toBe(false);
  });

  it("a negative B, held or refined, stays a blocker: the assessment calls it critical", () => {
    const held = [param("scale", "scale", 1), param("B1", "bIso", -0.2, { fixed: true })];
    expect(physicalItems({ result: null, parameters: held, structures: [] })[0]!.severity).toBe("blocker");
    const a = powderAcceptance({ gof: 1.2, result: null, parameters: held, structures: [] });
    expect(a.checks[1]).toMatchObject({ tone: "red", value: "1 to fix" });
    expect(a.tone).toBe("red");
    expect(a.headline).toBe("1 physical problem to fix before refining.");
    const r = result({ scale: 1 });
    expect(powderAcceptance({ gof: 1.2, result: r, parameters: held, structures: [], assessment: assess(r, held) }).headline).toBe("Not acceptable: 1 physical problem to fix first.");
  });

  it("a B on its bound counts while the result describes the values, and not once they are edited", () => {
    const r = result({ scale: 1, B1: 0 }, {}, { atBounds: [{ parameterId: "B1", bound: "min", value: 0 }] });
    const onBound = [param("scale", "scale", 1), param("B1", "bIso", 0)];
    const items = physicalItems({ result: r, parameters: onBound, structures: [], assessment: assess(r, onBound) });
    expect(items.map((i) => i.severity)).toEqual(["blocker"]);
    expect(items[0]!.text).toMatch(/B1 is resting on its min bound/);
    const edited = [param("scale", "scale", 1.1), param("B1", "bIso", 0)];
    expect(physicalItems({ result: r, parameters: edited, structures: [], assessment: assess(r, edited) })).toEqual([]);
  });
});

describe("the cross-check and the esds", () => {
  it("is due once the fit meets the bar on a converged result, and offers both bundles", () => {
    const a = powderAcceptance({ gof: 1.25, result: fit, parameters: params, structures: [], assessment: assess(fit, params), canExport: true });
    expect(a.passes).toBe(true);
    expect(a.tone).toBe("green");
    expect(a.headline).toBe("Excellent fit (GoF 1.25) and physically sane: cross-check it in GSAS-II and FullProf.");
    expect(a.checks[2]).toMatchObject({ id: "cross-check", tone: "amber", value: "To do", actions: ["export-gsas2", "export-fullprof"] });
  });

  it("waits while the fit does not meet the bar, and says why the esds may not hold", () => {
    const a = powderAcceptance({
      gof: 3.05, durbinWatson: { d: 0.61, qd: 1.89, correlated: true },
      result: fit, parameters: params, structures: [], assessment: assess(fit, params), canExport: true,
      topCause: { phrase: "the peak tails", share: 0.85 },
    });
    expect(a.headline).toBe("Fair fit (GoF 3.05): not yet acceptable — most of the misfit is in the peak tails.");
    expect(a.checks[0]).toMatchObject({ tone: "amber", value: "GoF 3.05 · fair" });
    expect(a.checks[2]).toMatchObject({ tone: "grey", value: "Not yet" });
    expect(a.checks[2]!.esd).toEqual([{ text: "The esds are likely too small: neighbouring points miss together (Durbin–Watson 0.61, below 1.89), and the model leaves systematic misfit (GoF 3.05).", posterior: false }]);
    expect(a.checks[2]!.actions).toEqual(["export-gsas2", "export-fullprof"]);
  });

  it("sends a value on its bound or a correlated pair to the Posterior; a background's own coefficients are no warning, as in the assessment", () => {
    const corr = (pairs: { parameterIdA: string; parameterIdB: string; coefficient: number }[]) => result({ scale: 1, B1: 0.5, bkg0: 1, bkg1: 0 }, {}, { highCorrelations: pairs });
    const rows = [...params, param("bkg0", "background", 1), param("bkg1", "background", 0)];
    const strong = corr([{ parameterIdA: "scale", parameterIdB: "B1", coefficient: 0.97 }]);
    const a = powderAcceptance({ gof: 1.25, result: strong, parameters: rows, structures: [], assessment: assess(strong, rows), canExport: true });
    expect(a.checks[2]!.esd).toEqual([{ text: "scale ↔ B1 correlate at 0.97: their esds are inflated. Fix one, or sample the posterior.", posterior: true }]);
    expect(a.checks[2]!.actions).toContain("posterior");
    // The old tab warned of "correlations at or above 0.95" here: the assessment calls them expected (one curve).
    const curve = corr([{ parameterIdA: "bkg0", parameterIdB: "bkg1", coefficient: 0.995 }]);
    const b = powderAcceptance({ gof: 1.25, result: curve, parameters: rows, structures: [], assessment: assess(curve, rows), canExport: true });
    expect(b.checks[2]!.esd ?? []).toEqual([]);
    expect(b.passes).toBe(true);
  });

  it("values edited since the result: its esds are stale, and say so", () => {
    const edited = [param("scale", "scale", 1.3), param("B1", "bIso", 0.5)];
    const a = powderAcceptance({ gof: 1.25, result: fit, parameters: edited, structures: [], assessment: assess(fit, edited) });
    expect(a.state.kind).toBe("edited");
    expect(a.checks[2]!.esd).toEqual([{ text: "The esds on screen are the last refinement's, not these values': refine again.", posterior: false }]);
    expect(a.passes).toBe(false);
  });

  it("before any esd exists, says so instead", () => {
    const a = powderAcceptance({ gof: 3.05, result: null, parameters: params, structures: [], snapshot: true });
    expect(a.state.kind).toBe("snapshot");
    expect(a.checks[2]!.esd).toEqual([{ text: "No esds yet: the opened fit carries none.", posterior: false }]);
    expect(a.passes).toBe(false);
  });
});

describe("the headline", () => {
  it("says what the state needs before the bands do", () => {
    expect(powderAcceptance({ gof: 12, result: null, parameters: params, structures: [] }).headline).toBe("Not refined yet.");
    expect(powderAcceptance({ gof: 1.2, result: result({ scale: 1, B1: 0.5 }, { status: "diverged" }), parameters: params, structures: [] }).headline).toBe("The refinement diverged: its values are not meaningful.");
    expect(powderAcceptance({ gof: 6, result: fit, parameters: params, structures: [], topCause: { phrase: "the peak positions", share: 0.3 } }).headline)
      .toBe("Poor fit (GoF 6.00): far from the data — the largest part of the misfit is the peak positions.");
    expect(powderAcceptance({ gof: 15.85, result: null, parameters: [param("scale", "scale", 1.2, { initial: 1 })], structures: [], topCause: { phrase: "the peak positions", share: 0.21, first: true } }).headline)
      .toBe("Poor fit (GoF 15.85): far from the data — start with the peak positions, your method's first block.");
    expect(powderAcceptance({ gof: 0.6, result: fit, parameters: params, structures: [] }).headline).toBe("GoF 0.60 is below 0.8: the fit is too good, and the esds optimistic.");
    expect(powderAcceptance({ gof: 1.25, result: null, parameters: params, structures: [], snapshot: true }).headline).toBe("Excellent fit (GoF 1.25): refine once to confirm it and get its esds.");
  });
});
