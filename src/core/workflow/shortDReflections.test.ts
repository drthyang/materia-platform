import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import type { RefinementParameter } from "@/core/refinement/types";
import { parseCif } from "@/parsers/cif";
import { buildPowderSpec } from "@/app/powderSpec";
import { applyParameters } from "@/core/workflow/apply";
import { resolveTies } from "@/core/refinement/constraints";
import { generateReflections } from "@/core/diffraction/reflections";
import { PEAK_WINDOW_FWHM } from "@/core/diffraction/profile";
import { buildPowderProblem, magneticDRange, modelledFitRange, placePeaks, reflectionRange, startValues, TOF_DMIN_FLOOR, XRAY_FORM_FACTOR_DMIN } from "@/core/workflow/powder";

/**
 * THY-90: the reflection list reaches the fit window's short-d edge less one
 * peak support, stops earlier only where the model is not valid (TOF peak
 * terms, the X-ray table), and the points it does not reach are left out of
 * the fit. Silicon on an invented bank (difC 9000, Δt/t 0.0009, d 0.25–3.3 Å).
 */

const SI = `data_si
_cell_length_a 5.431
_cell_length_b 5.431
_cell_length_c 5.431
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M "F d -3 m:1"
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
Si1 Si 0 0 0 0.0063
`;
const DIFC = 9000;

function tofPattern(dLo = 0.25, dHi = 3.3): PowderPattern {
  const points = [];
  for (let t = DIFC * dLo; t <= DIFC * dHi; t *= 1.0009) points.push({ x: t, yObs: 100, sigma: 10 });
  return { id: "si-tof", name: "si-tof", xUnit: "tof", radiation: { kind: "neutron-tof" }, points } as PowderPattern;
}

function tofSetUp(change: (p: RefinementParameter) => RefinementParameter = (p) => p) {
  const structure = parseCif(SI, "si");
  const pattern = tofPattern();
  const spec = buildPowderSpec(structure, pattern, { kind: "tof", difC: DIFC, alpha: 0.6, beta0: 0.04, beta1: 0.005, sig1: 30 }, true, 2);
  const params = spec.params.map(change);
  const applied = applyParameters(structure, spec.bindings, resolveTies(params, startValues(params)));
  return { structure, pattern, params, bindings: spec.bindings, profile: spec.profile, applied };
}

describe("a TOF reflection list follows the fit window", () => {
  it("reaches one peak support below the window's short-d edge, and no further", () => {
    const { pattern, applied } = tofSetUp();
    for (const window of [undefined, { min: DIFC * 0.6 }]) {
      const r = reflectionRange(pattern, applied, window);
      expect(r.stop).toBe("window");
      const edge = window?.min ?? pattern.points[0]!.x;
      expect(r.windowD).toBeCloseTo(edge / DIFC, 9);
      // A reflection at the list's end reaches the window's edge with its support (the end is rounded down on a 10⁻⁴ grid in ln d); one 1 % further does not.
      const reach = (d: number): number => {
        const p = placePeaks(pattern, applied, [{ d, intensity: 1 }])[0]!;
        return p.center + PEAK_WINDOW_FWHM * p.fwhm;
      };
      expect(reach(r.dMin)).toBeGreaterThanOrEqual(edge * (1 - 1e-4));
      expect(reach(r.dMin * (1 + 1e-4))).toBeGreaterThanOrEqual(edge * (1 - 1e-9));
      expect(reach(r.dMin * 0.99)).toBeLessThan(edge);
      expect(r.dMin).toBeLessThan(r.windowD);
      expect(r.fittedFrom).toBeUndefined();
    }
    // Below 0.5 Å: the old floor is gone for nuclear reflections.
    expect(reflectionRange(pattern, applied).dMin).toBeLessThan(0.25);
  });

  it("falls to half the edge's d when 20 widths are longer than the edge's time of flight, with or without a Lorentzian width", () => {
    // σ₀² = 4·10⁴ µs²: one width is 470 µs at every d, so at the data's end (d 0.25 Å, 2250 µs) 20 widths pass TOF 0 and no d ends the support.
    // The list used to start at the edge itself there (no margin); it reaches SUPPORT_REACH_LIMIT × the edge's d.
    const { pattern, applied } = tofSetUp((p) => (p.id === "tof_sig0" ? { ...p, value: 4e4, initialValue: 4e4 } : p));
    const edge = pattern.points[0]!.x;
    const peak = placePeaks(pattern, applied, [{ d: 0.25, intensity: 1 }])[0]!;
    expect(peak.tof!.gamma ?? 0).toBe(0);
    expect(PEAK_WINDOW_FWHM * peak.fwhm).toBeGreaterThan(edge);
    const r = reflectionRange(pattern, applied);
    expect(r.stop).toBe("window");
    expect(r.windowD).toBeCloseTo(0.25, 9);
    // 0.5 × the edge's d, rounded down on the 10⁻⁴ grid in ln d.
    expect(r.dMin).toBeLessThanOrEqual(0.5 * r.windowD);
    expect(r.dMin).toBeGreaterThan(0.5 * r.windowD * (1 - 1e-4));
    expect(r.fittedFrom).toBeUndefined();
  });

  it("leaves no point of the window out when the list reaches it", () => {
    const { pattern, applied } = tofSetUp();
    expect(modelledFitRange(pattern, [applied], { min: DIFC * 0.3, max: DIFC * 3 })).toEqual({ min: DIFC * 0.3, max: DIFC * 3 });
    expect(modelledFitRange(pattern, [applied], undefined)).toBeUndefined();
  });

  it("keeps the magnetic satellites at d ≥ 0.5 Å (no magnetic number moves)", () => {
    const { pattern, applied } = tofSetUp();
    expect(TOF_DMIN_FLOOR).toBe(0.5);
    expect(magneticDRange(pattern, applied).dMin).toBe(0.5);
  });
});

describe("a TOF profile that gives no peak at short d", () => {
  // β = 0.04 − 0.002/d⁴ is ≤ 0 below d = (0.002/0.04)^¼ = 0.4729 Å.
  const dZero = (0.002 / 0.04) ** 0.25;
  const set = (): ReturnType<typeof tofSetUp> => tofSetUp((p) => (p.id === "tof_beta1" ? { ...p, value: -0.002, initialValue: -0.002 } : p));

  it("stops the list there, names the width, and leaves the points below out of the fit", () => {
    const { structure, pattern, params, bindings, profile, applied } = set();
    const r = reflectionRange(pattern, applied);
    expect(r.stop).toBe("profile");
    expect(r.which).toBe("β");
    expect(r.dMin).toBeGreaterThanOrEqual(dZero);
    expect(r.dMin).toBeLessThan(dZero * 1.0002);
    expect(r.fittedFrom).toBe(r.dMin);
    const fitted = modelledFitRange(pattern, [applied], undefined)!;
    expect(fitted.min).toBeCloseTo(DIFC * r.dMin + applied.zeroShift, 6);
    const problem = buildPowderProblem(structure, pattern, params, bindings, profile);
    pattern.points.forEach((p, i) => expect(problem.weights[i]! > 0).toBe(p.x >= fitted.min!));
    // No reflection of the list lies where the profile gives none.
    const list = generateReflections(applied.model.cell, applied.model.spaceGroup, r.dMin, r.dMax);
    expect(Math.min(...list.map((x) => x.d))).toBeGreaterThanOrEqual(dZero);
  });

  it("rejects a step that takes β to zero inside the range the fit weighs", () => {
    const { structure, pattern, params, bindings, profile } = set();
    const problem = buildPowderProblem(structure, pattern, params.map((p) => ({ ...p, fixed: p.id !== "tof_beta1" })), bindings, profile);
    const values = { ...startValues(params), tof_beta1: -0.02 };
    expect(() => problem.calculate(values)).toThrow(/β ≤ 0/);
  });
});

describe("X-rays: the list stops at sin θ/λ = 2.0 Å⁻¹", () => {
  it("stops at 0.25 Å and leaves out the points within one peak support of it", () => {
    const structure = parseCif(SI, "si");
    const points = [];
    for (let q = 2; q <= 30; q += 0.005) points.push({ x: q, yObs: 100, sigma: 10 });
    const pattern = { id: "si-q", name: "si-q", xUnit: "q", radiation: { kind: "xray", wavelength: 0.2 }, points } as PowderPattern;
    const spec = buildPowderSpec(structure, pattern, { kind: "constantWavelength", wavelength: 0.2 }, false, 2);
    const applied = applyParameters(structure, spec.bindings, resolveTies(spec.params, startValues(spec.params)));
    const r = reflectionRange(pattern, applied);
    expect(r.stop).toBe("xray");
    expect(r.dMin).toBe(XRAY_FORM_FACTOR_DMIN);
    expect(r.fittedFrom!).toBeGreaterThan(XRAY_FORM_FACTOR_DMIN);
    const fitted = modelledFitRange(pattern, [applied], undefined)!;
    expect(fitted.max!).toBeLessThan((2 * Math.PI) / XRAY_FORM_FACTOR_DMIN);
    expect(fitted.max!).toBeCloseTo((2 * Math.PI) / r.fittedFrom!, 9);
    const weights = buildPowderProblem(structure, pattern, spec.params, spec.bindings, spec.profile).weights;
    pattern.points.forEach((p, i) => expect(weights[i]! > 0).toBe(p.x <= fitted.max!));
  });

  it("is the data's own range for neutrons at constant wavelength", () => {
    const structure = parseCif(SI, "si");
    const points = [];
    for (let q = 2; q <= 30; q += 0.01) points.push({ x: q, yObs: 100, sigma: 10 });
    const pattern = { id: "si-n", name: "si-n", xUnit: "q", radiation: { kind: "neutron", wavelength: 0.5 }, points } as PowderPattern;
    const spec = buildPowderSpec(structure, pattern, { kind: "constantWavelength", wavelength: 0.5 }, false, 2);
    const applied = applyParameters(structure, spec.bindings, resolveTies(spec.params, startValues(spec.params)));
    const r = reflectionRange(pattern, applied);
    expect(r.stop).toBe("data");
    expect(r.dMin).toBeCloseTo((2 * Math.PI) / points[points.length - 1]!.x, 12);
  });
});
