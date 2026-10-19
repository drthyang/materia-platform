import { describe, it, expect } from "vitest";
import { buildPowderSpec } from "@/app/powderSpec";
import { exampleStructure } from "@/examples/mn3ga";
import { powderCurves } from "@/core/workflow/powder";
import { powderReflectionObsCalc } from "@/core/workflow/obsCalc";
import { diagnoseFit, peakShapeAction } from "@/core/diagnostics/fitDiagnosis";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";
import type { RefinementParameter } from "@/core/refinement/types";
import type { SampleCorrections } from "@/core/workflow/powderModelOptions";

/**
 * The fit diagnosis on patterns whose fault is known: simulated with a
 * correction (asymmetry, texture) and judged by the same model without it,
 * every other parameter at its true value. The diagnosis must name the fault.
 */

const D1A: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 1.909, zero: 0, u: 1963, v: -4217, w: 3613, x: 0, y: 0 };
const structure = exampleStructure();
const grid: PowderPattern = {
  id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 1.909 }, wavelength: 1.909,
  points: Array.from({ length: 2800 }, (_, i) => ({ x: 10 + i * 0.05, yObs: 0 })),
};

function gaussian(seed = 11): () => number {
  let state = seed;
  const u = (): number => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** Observed: the model with this correction (at these values) plus noise; calculated: the same model without it. */
function judge(corrections: SampleCorrections, values: Record<string, number>, seed = 11) {
  const truthSpec = buildPowderSpec(structure, grid, D1A, true, 4, {}, "isotropic", corrections);
  const set = (params: readonly RefinementParameter[], v: Record<string, number>): RefinementParameter[] => params.map((p) => (p.id in v ? { ...p, value: v[p.id]! } : p));
  const truth = set(truthSpec.params, { scale: 1, bkg0: 50, bkg1: 0, bkg2: 0, bkg3: 0, ...values });
  const yTrue = powderCurves(structure, grid, truth, truthSpec.bindings, truthSpec.profile).yCalc;
  const top = Math.max(...yTrue);
  const k = 20000 / top;
  const noise = gaussian(seed);
  const pattern: PowderPattern = { ...grid, points: grid.points.map((p, i) => {
    const y = k * yTrue[i]!;
    return { ...p, yObs: y + Math.sqrt(Math.max(y, 1)) * noise(), sigma: Math.sqrt(Math.max(y, 1)) };
  }) };
  const spec = buildPowderSpec(structure, pattern, D1A, true, 4, {}, "isotropic");
  const params = set(spec.params, { scale: k * (truth.find((p) => p.id === "scale")!.value), bkg0: k * 50, bkg1: 0, bkg2: 0, bkg3: 0 });
  const curves = powderCurves(structure, pattern, params, spec.bindings, spec.profile);
  const sigma = pattern.points.map((p) => p.sigma!);
  const include = pattern.points.map(() => true);
  const reflections = powderReflectionObsCalc(structure, pattern, params, spec.bindings, spec.profile, null, null, [], "rietveld", { yCalc: curves.yCalc, sigma, include });
  const d = pattern.points.map((p) => 1.909 / (2 * Math.sin((p.x * Math.PI) / 360)));
  return diagnoseFit({
    x: curves.x, yObs: curves.yObs, yCalc: curves.yCalc, ...(curves.yBackground ? { yBackground: curves.yBackground } : {}),
    sigma, include, nParams: 8, d, reflections, phases: [structure], twoTheta: true,
    xOf: (dd) => (2 * Math.asin(1.909 / (2 * dd)) * 180) / Math.PI,
  });
}

describe("the fit diagnosis", () => {
  it("names missing axial-divergence asymmetry", () => {
    const dx = judge({ asymmetry: true }, { asymSL: 0.06 });
    expect(dx.causes[0]?.id).toBe("asymmetry");
    expect(dx.causes[0]?.action).toMatch(/set_corrections asymmetry/);
    expect(dx.validation.durbinWatson?.correlated).toBe(true);
  });

  it("names texture along the axis it was simulated with", () => {
    const dx = judge({ preferredOrientation: [0, 0, 1] }, { po: 0.7 });
    const texture = dx.causes.find((c) => c.id === "texture");
    expect(texture, JSON.stringify(dx.causes)).toBeDefined();
    expect(dx.texture?.axis).toEqual([0, 0, 1]);
    expect(texture!.action).toMatch(/preferredOrientation \[0, 0, 1\]/);
  });

  it("names no texture on a correct model, over many noise seeds", () => {
    const named = Array.from({ length: 12 }, (_, i) => judge({}, {}, 101 + i)).filter((dx) => dx.causes.some((c) => c.id === "texture"));
    expect(named.map((dx) => dx.texture)).toEqual([]);
  });

  it("measures peaks broader than calculated, and does not bill their flanks to the background", () => {
    // The sample's lines √3 × the instrument file's: U, V, W three times larger.
    const dx = judge({}, { profU: 3 * 1963, profV: 3 * -4217, profW: 3 * 3613 });
    expect(dx.causes[0]?.id, JSON.stringify(dx.causes)).toBe("peak-width");
    expect(dx.width?.median).toBeGreaterThan(1.5);
    expect(dx.width?.median).toBeLessThan(1.9);
    expect(dx.causes[0]?.action).toMatch(/Caglioti W, then U and V/);
    expect(dx.causes.some((c) => c.id === "background")).toBe(false);
  });

  it("names a missing Lorentzian part from the lines' shape", () => {
    // The sample adds a Lorentzian size width (X = 10: 0.1° at low angle) the model lacks.
    const dx = judge({}, { profX: 10 });
    const tails = dx.causes.find((c) => c.id === "peak-tails");
    expect(tails, JSON.stringify(dx.causes)).toBeDefined();
    expect(dx.width!.etaObs! - dx.width!.etaCalc!).toBeGreaterThan(0.15);
    expect(tails!.action).toMatch(/Lorentzian X \(size, 1\/cosθ\) and Y/);
  });

  it("finds nothing to name on a fit that matches its data", () => {
    const dx = judge({}, {});
    expect(dx.causes.filter((c) => c.share > 0.3)).toEqual([]);
    expect(dx.width?.median).toBeCloseTo(1, 1);
    expect(Math.abs(dx.width!.etaObs! - dx.width!.etaCalc!)).toBeLessThan(0.1);
    expect(dx.validation.agreement.gof).toBeLessThan(1.3);
  });
});

describe("the peak-shape action", () => {
  it("frees the widths while they are fixed, and reads the shape once they are free and agree", () => {
    expect(peakShapeAction(1.02, undefined)).toMatch(/^A width or shape mismatch: free the Caglioti U, V, W together/);
    expect(peakShapeAction(1.02, { lorentzian: true })).toMatch(/^The Caglioti U, V, W and the Lorentzian X are already free and the line widths agree \(observed\/calculated 1\.02\).*set_corrections asymmetry.*set_microstrain/);
    expect(peakShapeAction(1.02, { lorentzian: false })).toMatch(/^The Caglioti U, V, W are already free/);
    // Free but disagreeing widths: the width is still the advice.
    expect(peakShapeAction(1.3, { lorentzian: false })).toMatch(/^A width or shape mismatch/);
    expect(peakShapeAction(undefined, { lorentzian: false })).toMatch(/^A width or shape mismatch/);
  });
});
