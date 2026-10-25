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
    expect(s.text).toBe("Converged snapshot: no esds or correlations");
    expect(s.detail).toBe("The page opened on a converged fit, which carries no esds or correlations: refine once to get them.");
    expect(s.text).not.toMatch(/not refined/i);
    expect(s.refine).toBe(true);
  });

  it("with no result and nothing refined, says what to do: the method's first block", () => {
    const s = fitState(null, params);
    expect(s.kind).toBe("none");
    expect(s.text).toBe("Free the scale, background and cell first");
    expect(s.detail).toBe("Your method starts with the scale, background and cell: free them in the parameter panel, then refine.");
  });

  it("values moved from their start with no result: the model changed since its last refinement", () => {
    expect(fitState(null, [param("scale", "scale", 1.2, { initial: 1 })])).toMatchObject({ kind: "changed", text: "Model changed since its last refinement", detail: "Refine to bring the values, esds and correlations up to date." });
  });

  it("reads a result: converged, settling, moving, stopped, diverged, edited since", () => {
    expect(fitState(fit, params)).toMatchObject({ kind: "converged", tone: "green", current: true, refine: false });
    expect(fitState(fit, params)).toMatchObject({ text: "Converged in 2 cycles · max shift 0.02 esd", detail: "The last cycle moved no parameter by more than 0.02 esd." });
    expect(fitState(result({ scale: 1, B1: 0.5 }, {}, { maxShiftOverEsd: 0.4, maxShiftParameterId: "B1" }), params)).toMatchObject({ kind: "settling", refine: true, text: "Nearly settled: last shift 0.40 esd (B1), settled < 0.1", detail: "Refine a few more cycles." });
    expect(fitState(result({ scale: 1, B1: 0.5 }, {}, { maxShiftOverEsd: 2 }), params)).toMatchObject({ kind: "moving", tone: "amber", text: "Still moving: last shift 2.00 esd", detail: "Refine more cycles; the values are not the minimum yet." });
    expect(fitState(result({ scale: 1, B1: 0.5 }, { status: "maxIterations" }), params)).toMatchObject({ kind: "stopped", tone: "amber", text: "Stopped before converging (cycle limit): values provisional", detail: "Refine again." });
    expect(fitState(result({ scale: 1, B1: 0.5 }, { status: "stalled" }), params).text).toBe("Stopped before converging (stalled): values provisional");
    expect(fitState(result({ scale: 1, B1: 0.5 }, { status: "diverged" }), params)).toMatchObject({ kind: "diverged", tone: "red", refine: false, text: "Go back a step (History), or refine fewer parameters at once", detail: "The last refinement diverged: its values and esds mean nothing." });
    expect(fitState(fit, [param("scale", "scale", 1.3), param("B1", "bIso", 0.5)])).toMatchObject({ kind: "edited", current: false, text: "Edited since the last refinement: esds stale", detail: "Values edited since the last refinement: refine again before quoting values or esds." });
  });
});

describe("physical sanity, scaled", () => {
  const occ = (value: number, fixed: boolean) => [param("scale", "scale", 1), param("occ_Ga1", "occupancy", value, { fixed, label: "Mn3Ga: Ga1 occ" })];

  it("a held occupancy 0.5 % over 1 is a note to correct, not a blocker", () => {
    const items = physicalItems({ result: null, parameters: occ(1.005, true), structures: [] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ severity: "note", parameterIds: ["occ_Ga1"] });
    expect(items[0]!.text).toBe("Mn3Ga: Ga1 occ held at 1.005 → set to 1");
    // The why rides along for the tooltip, with the assessment's own account.
    expect(items[0]!.detail).toMatch(/^0\.5% over 1: an input the fit never moved\. This value was not refined; it comes from the starting structure or CIF\./);
    const a = powderAcceptance({ gof: 1.2, result: null, parameters: occ(1.005, true), structures: [] });
    // The value says nothing is unphysical: no line repeats it.
    expect(a.checks[1]).toMatchObject({ id: "physical", tone: "green", value: "Nothing unphysical · 1 note", sentence: "" });
    expect(physicalItems({ result: null, parameters: occ(-0.004, true), structures: [] })[0]!.text).toBe("Mn3Ga: Ga1 occ held at -0.004 → set to 0");
  });

  it("a held occupancy well outside [0, 1], or a refined one outside it, is to check (the assessment's warning)", () => {
    expect(physicalItems({ result: null, parameters: occ(1.05, true), structures: [] })[0]!.severity).toBe("issue");
    expect(physicalItems({ result: null, parameters: occ(1.005, false), structures: [] })[0]!.severity).toBe("issue");
    const rows = occ(1.05, true);
    const r = result({ scale: 1 });
    const a = powderAcceptance({ gof: 1.2, result: r, parameters: rows, structures: [], assessment: assess(r, rows) });
    expect(a.checks[1]).toMatchObject({ tone: "amber", value: "1 to check", sentence: "Unusual: check each before quoting" });
    expect(a.tone).toBe("amber");
    expect(a.headline).toBe("Excellent fit, 1 value to check");
    expect(a.passes).toBe(false);
  });

  it("a negative B, held or refined, stays a blocker: the assessment calls it critical", () => {
    const held = [param("scale", "scale", 1), param("B1", "bIso", -0.2, { fixed: true })];
    expect(physicalItems({ result: null, parameters: held, structures: [] })[0]!.severity).toBe("blocker");
    const a = powderAcceptance({ gof: 1.2, result: null, parameters: held, structures: [] });
    expect(a.checks[1]).toMatchObject({ tone: "red", value: "1 to fix", sentence: "Blockers: fix them before reading the fit" });
    expect(a.tone).toBe("red");
    expect(a.headline).toBe("Fix 1 physical problem before refining");
    const r = result({ scale: 1 });
    expect(powderAcceptance({ gof: 1.2, result: r, parameters: held, structures: [], assessment: assess(r, held) }).headline).toBe("Not acceptable: fix 1 physical problem first");
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
    expect(a.headline).toBe("Excellent fit, physically sane: cross-check it");
    expect(a.checks[2]).toMatchObject({ id: "cross-check", tone: "amber", value: "To do", actions: ["export-gsas2", "export-fullprof"] });
    expect(a.checks[2]).toMatchObject({ sentence: "In GSAS-II and FullProf: each value within 2 combined esds", detail: "The step left: refine the same model in GSAS-II and FullProf; done when both give each value within 2 combined esds." });
    expect(a.checks[1]).toMatchObject({ tone: "green", sentence: "Nothing at a bound either" });
  });

  it("waits while the fit does not meet the bar, and says why the esds may not hold", () => {
    const a = powderAcceptance({
      gof: 3.05, durbinWatson: { d: 0.61, qd: 1.89, correlated: true },
      result: fit, parameters: params, structures: [], assessment: assess(fit, params), canExport: true,
      topCause: { phrase: "the peak tails", share: 0.85 },
    });
    expect(a.headline).toBe("Fair fit: misfit mostly in the peak tails");
    expect(a.headlineDetail).toBe("Not yet acceptable. Most of the misfit is in the peak tails (about 85% of χ²).");
    expect(a.checks[0]).toMatchObject({ tone: "amber", value: "GoF 3.05 · fair", sentence: "Above your bar (good ≤ 2.5)", detail: "The model misses systematic features." });
    expect(a.checks[2]).toMatchObject({ tone: "grey", value: "Not yet", sentence: "In GSAS-II and FullProf, once the bar is met" });
    expect(a.checks[2]!.detail).toBe("Once the fit meets the bar: refine the same model in GSAS-II and FullProf, and compare the values and esds.");
    expect(a.checks[2]!.esd).toEqual([{
      text: "Esds likely too small: DW 0.61 < Q_D 1.89, GoF 3.05",
      detail: "The esds are likely too small: neighbouring points miss together (Durbin–Watson 0.61, below 1.89), and the model leaves systematic misfit (GoF 3.05).",
      posterior: false,
    }]);
    expect(a.checks[2]!.actions).toEqual(["export-gsas2", "export-fullprof"]);
  });

  it("sends a value on its bound or a correlated pair to the Posterior; a background's own coefficients are no warning, as in the assessment", () => {
    const corr = (pairs: { parameterIdA: string; parameterIdB: string; coefficient: number }[]) => result({ scale: 1, B1: 0.5, bkg0: 1, bkg1: 0 }, {}, { highCorrelations: pairs });
    const rows = [...params, param("bkg0", "background", 1), param("bkg1", "background", 0)];
    const strong = corr([{ parameterIdA: "scale", parameterIdB: "B1", coefficient: 0.97 }]);
    const a = powderAcceptance({ gof: 1.25, result: strong, parameters: rows, structures: [], assessment: assess(strong, rows), canExport: true });
    expect(a.checks[2]!.esd).toEqual([{ text: "scale ↔ B1 correlate at 0.97: fix one or sample the posterior", detail: "Their esds are inflated.", posterior: true }]);
    expect(a.checks[2]!.actions).toContain("posterior");
    // The old tab warned of "correlations at or above 0.95" here: the assessment calls them expected (one curve).
    const curve = corr([{ parameterIdA: "bkg0", parameterIdB: "bkg1", coefficient: 0.995 }]);
    const b = powderAcceptance({ gof: 1.25, result: curve, parameters: rows, structures: [], assessment: assess(curve, rows), canExport: true });
    expect(b.checks[2]!.esd ?? []).toEqual([]);
    expect(b.passes).toBe(true);
  });

  it("a value on its bound: no meaningful esd, to the Posterior", () => {
    const r = result({ scale: 1, B1: 0 }, {}, { atBounds: [{ parameterId: "B1", bound: "min", value: 0 }] });
    const rows = [param("scale", "scale", 1), param("B1", "bIso", 0)];
    const a = powderAcceptance({ gof: 1.25, result: r, parameters: rows, structures: [], assessment: assess(r, rows), canExport: true });
    expect(a.checks[2]!.esd).toContainEqual({ text: "B1 on a bound, no meaningful esd — sample the posterior", detail: "A value on its bound has no meaningful esd. Sample the posterior before quoting it.", posterior: true });
    expect(a.checks[2]!.actions).toContain("posterior");
  });

  it("values edited since the result: the state line says the esds are stale, and the card does not repeat it", () => {
    const edited = [param("scale", "scale", 1.3), param("B1", "bIso", 0.5)];
    const a = powderAcceptance({ gof: 1.25, result: fit, parameters: edited, structures: [], assessment: assess(fit, edited) });
    expect(a.state).toMatchObject({ kind: "edited", text: "Edited since the last refinement: esds stale" });
    expect(a.checks[2]!.esd).toBeUndefined();
    expect(a.passes).toBe(false);
  });

  it("before any esd exists, the state line says so once", () => {
    const a = powderAcceptance({ gof: 3.05, result: null, parameters: params, structures: [], snapshot: true });
    expect(a.state).toMatchObject({ kind: "snapshot", text: "Converged snapshot: no esds or correlations" });
    expect(a.checks[2]!.esd).toBeUndefined();
    expect(a.passes).toBe(false);
  });
});

describe("the headline", () => {
  it("says what the state needs before the bands do", () => {
    expect(powderAcceptance({ gof: 12, result: null, parameters: params, structures: [] }).headline).toBe("Not refined yet");
    expect(powderAcceptance({ gof: 1.2, result: result({ scale: 1, B1: 0.5 }, { status: "diverged" }), parameters: params, structures: [] }).headline).toBe("Refinement diverged: values not meaningful");
    const poor = powderAcceptance({ gof: 6, result: fit, parameters: params, structures: [], topCause: { phrase: "the peak positions", share: 0.3 } });
    expect(poor.headline).toBe("Poor fit: largest misfit in the peak positions");
    expect(poor.headlineDetail).toBe("Far from the data. The largest part of the misfit is in the peak positions (about 30% of χ²).");
    const first = powderAcceptance({ gof: 15.85, result: null, parameters: [param("scale", "scale", 1.2, { initial: 1 })], structures: [], topCause: { phrase: "the peak positions", share: 0.21, first: true } });
    expect(first.headline).toBe("Poor fit: fix the peak positions first");
    expect(first.headlineDetail).toBe("Far from the data. The peak positions: your method's first block (cell, zero, background) comes before the rest, whatever its share of χ².");
    expect(first.checks[0]).toMatchObject({ tone: "red", value: "GoF 15.85 · poor", sentence: "Far from the data — trust no value yet" });
    expect(powderAcceptance({ gof: 6, result: fit, parameters: params, structures: [] }).headline).toBe("Poor fit: far from the data");
    expect(powderAcceptance({ gof: 3, result: fit, parameters: params, structures: [] }).headline).toBe("Fair fit: not yet acceptable");
    const tooGood = powderAcceptance({ gof: 0.6, result: fit, parameters: params, structures: [] });
    expect(tooGood.headline).toBe("Fit too good (GoF < 0.8): esds optimistic");
    expect(tooGood.checks[0]).toMatchObject({ sentence: "σ overestimated, or too many parameters" });
    expect(tooGood.checks[0]!.detail).toMatch(/^Below 0\.8: the σ's are overestimated or the model has more parameters than the data support/);
    expect(powderAcceptance({ gof: 1.25, result: null, parameters: params, structures: [], snapshot: true }).headline).toBe("Excellent fit — refine once to confirm");
    expect(powderAcceptance({ gof: 2, result: result({ scale: 1, B1: 0.5 }, {}, { maxShiftOverEsd: 0.4 }), parameters: params, structures: [] }).headline).toBe("Good fit — refine until settled before quoting");
    expect(powderAcceptance({ gof: 2, result: fit, parameters: params, structures: [] }).checks[0]).toMatchObject({ sentence: "Within your bar (good ≤ 2.5)", detail: "Some systematic misfit remains." });
    expect(powderAcceptance({ gof: 1, result: fit, parameters: params, structures: [] }).checks[0]).toMatchObject({ sentence: "Close to the noise", detail: "The model explains the data within their uncertainties." });
  });

  it("keeps every line short: the headline, the state, each check", () => {
    const words = (t: string): number => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const held = [param("scale", "scale", 1), param("B1", "bIso", -0.2, { fixed: true })];
    const cases = [
      powderAcceptance({ gof: 12, result: null, parameters: params, structures: [] }),
      powderAcceptance({ gof: 3.05, result: null, parameters: params, structures: [], snapshot: true, topCause: { phrase: "lines no phase explains", share: 0.4 } }),
      powderAcceptance({ gof: 1.25, result: fit, parameters: params, structures: [], assessment: assess(fit, params), canExport: true }),
      powderAcceptance({ gof: 3.05, durbinWatson: { d: 0.61, qd: 1.89, correlated: true }, result: fit, parameters: params, structures: [], assessment: assess(fit, params) }),
      powderAcceptance({ gof: 1.2, result: null, parameters: held, structures: [] }),
      powderAcceptance({ gof: 0.6, result: fit, parameters: params, structures: [] }),
      powderAcceptance({ gof: 1.2, result: result({ scale: 1, B1: 0.5 }, { status: "maxIterations" }), parameters: params, structures: [] }),
    ];
    for (const a of cases) {
      expect(words(a.headline), a.headline).toBeLessThanOrEqual(9);
      expect(words(a.state.text), a.state.text).toBeLessThanOrEqual(10);
      for (const c of a.checks) expect(words(c.sentence), c.sentence).toBeLessThanOrEqual(10);
    }
  });
});
