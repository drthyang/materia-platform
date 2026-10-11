import { describe, it, expect } from "vitest";
import {
  beckerCoppensFactor,
  extinctionFactor,
  extinctionFactorFor,
  shelxWeights,
  singleCrystalAgreement,
} from "@/core/diffraction/singleCrystalFactors";
import type { Radiation } from "@/core/diffraction/types";

const xray: Radiation = { kind: "xray", wavelength: 0.71073 };

describe("extinction", () => {
  it("is 1 when the parameter is 0 and damps strong low-angle reflections", () => {
    expect(extinctionFactor(0, 1000, xray, 3)).toBe(1);
    const y = extinctionFactor(0.5, 1000, xray, 3);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(1);
    // A stronger reflection is damped more.
    expect(extinctionFactor(0.5, 5000, xray, 3)).toBeLessThan(y);
  });

  it("takes a time-of-flight reflection at its own wavelength and angle", () => {
    const tof: Radiation = { kind: "neutron-tof" };
    // With neither, there is no λ to correct with.
    expect(extinctionFactor(0.5, 1000, tof, 2)).toBe(1);
    // At λ = 1 Å, 2θ follows from d = 2 Å: the CW correction at the same λ.
    const cw = extinctionFactor(0.5, 1000, { kind: "neutron", wavelength: 1 }, 2);
    expect(extinctionFactor(0.5, 1000, tof, 2, { wavelength: 1 })).toBeCloseTo(cw, 12);
    // A longer wavelength reflects more strongly per mosaic block: more extinction (λ³/sin2θ).
    const twoTheta = (2 * Math.asin(1 / 4) * 180) / Math.PI;
    expect(extinctionFactor(0.5, 1000, tof, 2, { wavelength: 2, twoTheta: 2 * (Math.asin(2 / 4) * 180) / Math.PI })).toBeLessThan(extinctionFactor(0.5, 1000, tof, 2, { wavelength: 1, twoTheta }));
    // 2θ alone gives λ = 2d·sinθ.
    expect(extinctionFactor(0.5, 1000, tof, 2, { twoTheta })).toBeCloseTo(cw, 12);
  });
});

describe("Becker–Coppens extinction (GSAS-II's SCExtinction)", () => {
  // Hand values from a line-by-line transcription of GSASIIstrMath.SCExtinction,
  // in GSAS-II's units: F² in barns there is fm²/100 here; V = 254.8 Å³ (sapphire).
  const V = 254.8;
  const tof: Radiation = { kind: "neutron-tof" };

  it("type I on a TOF Laue reflection: its own λ and path length (forward and back scattering)", () => {
    expect(beckerCoppensFactor("bc-1-lorentzian", 5.71e-4, 4000, tof, 2.085, V, { wavelength: 1.0, tbar: 0.07 })).toBeCloseTo(0.28072418310956826, 12);
    // cos2θ < 0: GSAS-II's other branch of the Lorentzian B.
    expect(beckerCoppensFactor("bc-1-lorentzian", 5.71e-4, 4000, tof, 0.6, V, { wavelength: 1.15, tbar: 0.07 })).toBeCloseTo(0.7258487016511018, 12);
    expect(beckerCoppensFactor("bc-1-gaussian", 5.71e-4, 4000, tof, 0.6, V, { wavelength: 1.15, tbar: 0.07 })).toBeCloseTo(0.7048706890589321, 12);
  });

  it("type II at one wavelength, and X-rays with the polarization ratio", () => {
    expect(beckerCoppensFactor("bc-2-gaussian", 0.002, 4000, { kind: "neutron", wavelength: 1.0 }, 2.085, V)).toBeCloseTo(0.06874185485089043, 12);
    expect(beckerCoppensFactor("bc-1-lorentzian", 1e-4, 2500, { kind: "xray", wavelength: 0.71073 }, 1.5, V)).toBeCloseTo(0.3980504111932954, 12);
    // P = 0.9 is GSAS-II's cos²2θ_m = P/(1 − P) = 9.
    expect(beckerCoppensFactor("bc-1-lorentzian", 1e-4, 2500, { kind: "xray", wavelength: 0.71073, polarization: 0.9 }, 1.5, V)).toBeCloseTo(0.3827595869363905, 12);
  });

  it("is 1 without extinction or without a wavelength, and the dispatcher keeps SHELXL's as the default", () => {
    expect(beckerCoppensFactor("bc-1-lorentzian", 0, 4000, tof, 2.085, V, { wavelength: 1.0 })).toBe(1);
    expect(beckerCoppensFactor("bc-1-lorentzian", 5.71e-4, 4000, tof, 2.085, V)).toBe(1);
    const at = { wavelength: 1.0, twoTheta: 27.9 };
    expect(extinctionFactorFor(undefined, 0.5, 1000, tof, 2.085, V, at)).toBe(extinctionFactor(0.5, 1000, tof, 2.085, at));
    expect(extinctionFactorFor("shelx", 0.5, 1000, tof, 2.085, V, at)).toBe(extinctionFactor(0.5, 1000, tof, 2.085, at));
  });
});

describe("SHELX F² weights and agreement", () => {
  it("reduces to 1/σ² when a = b = 0", () => {
    const w = shelxWeights([100], [100], [4], 0, 0);
    expect(w[0]).toBeCloseTo(1 / 16, 10);
  });

  it("R1/wR2/GooF are zero for a perfect fit", () => {
    const fo = [100, 50, 25];
    const w = shelxWeights(fo, fo, [2, 2, 2]);
    const ag = singleCrystalAgreement(fo, fo, [2, 2, 2], w, 1);
    expect(ag.r1).toBeCloseTo(0, 10);
    expect(ag.wr2).toBeCloseTo(0, 10);
    expect(ag.goof).toBeCloseTo(0, 10);
  });

  it("counts observed reflections above the σ cutoff", () => {
    const fo = [100, 1]; // second is weak: 1 < 2·σ(=2)
    const fc = [100, 1];
    const w = shelxWeights(fo, fc, [2, 2]);
    const ag = singleCrystalAgreement(fo, fc, [2, 2], w, 1, 2);
    expect(ag.observed).toBe(1);
    expect(ag.total).toBe(2);
  });

  it("wR2 matches its definition on a mismatched fit", () => {
    const fo = [100, 40];
    const fc = [90, 44];
    const sig = [5, 3];
    const w = shelxWeights(fo, fc, sig);
    const ag = singleCrystalAgreement(fo, fc, sig, w, 1);
    let num = 0, den = 0;
    for (let i = 0; i < 2; i++) {
      num += w[i]! * (fo[i]! - fc[i]!) ** 2;
      den += w[i]! * fo[i]! * fo[i]!;
    }
    expect(ag.wr2).toBeCloseTo(Math.sqrt(num / den), 10);
  });
});
