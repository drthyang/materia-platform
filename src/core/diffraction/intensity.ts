/**
 * Intensity models converting structure factors to observable intensities.
 *
 * Single crystal (this workbench refines on integrated Bragg intensities):
 *   I(hkl) = scale · |F|²                        (optionally × Lorentz)
 *
 * Powder (constant-wavelength):
 *   I(hkl) = scale · m · Lp(θ) · |F|²
 * where m is the reflection multiplicity and Lp is the Lorentz(-polarization)
 * factor. Polarization applies to X-rays only.
 *
 * In full, as `powderPeakIntensities` forms it:
 *   I(hkl) = m · Lp · P_MD · |F_N|² · scale
 * and the peak corrections that depend on the peak's place (absorption,
 * surface roughness) multiply afterwards, in workflow/powder.ts through
 * diffraction/corrections.ts. Units: |F_N|² in fm² (neutron) or electrons²
 * (X-ray); the scale is a free factor, so I is in the units of the data.
 * Index of every equation: docs/EQUATIONS.md.
 */

import type { Radiation } from "@/core/diffraction/types";
import type { SpaceGroup, StructureModel, UnitCell } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { lauEquivalents, type Reflection } from "@/core/diffraction/reflections";
import { braggTheta, reciprocalMetricTensor } from "@/core/crystal/unitCell";
import { mulVec } from "@/core/math/mat3";
import { nuclearStructureFactorSquared } from "@/core/diffraction/structureFactor";

/**
 * March–Dollase preferred-orientation correction for a reflection (hkl) given a
 * preferred-orientation axis (as reciprocal indices) and the March coefficient
 * r (r = 1 ⇒ no texture):
 *   P(α) = (r²·cos²α + sin²α / r)^(−3/2),
 * where α is the angle between the reflection's reciprocal vector and the PO
 * axis. Reference: Dollase, W. A. (1986), *J. Appl. Cryst.* 19, 267.
 * Symbols → code: r `ratio` (dimensionless; in Bragg–Brentano geometry r < 1
 * is platelets and r > 1 needles, for the axis normal to the plate or along
 * the needle); cos²α `cos2`, sin²α
 * `sin2`, with cosα = (h·G*·p)/(|h|·|p|) `cosA` in the reciprocal metric G*
 * `g`; the axis p `poAxis` (reciprocal-lattice indices). P is a dimensionless
 * factor on the intensity; its average over all directions is 1.
 */
export function marchDollase(
  cell: UnitCell,
  poAxis: Vec3,
  h: number,
  k: number,
  l: number,
  ratio: number,
): number {
  if (ratio === 1) return 1;
  const g = reciprocalMetricTensor(cell);
  const hkl: Vec3 = [h, k, l];
  const gHkl = mulVec(g, hkl);
  const gPo = mulVec(g, poAxis);
  const dotHP = hkl[0] * gPo[0] + hkl[1] * gPo[1] + hkl[2] * gPo[2];
  const normH = Math.sqrt(hkl[0] * gHkl[0] + hkl[1] * gHkl[1] + hkl[2] * gHkl[2]);
  const normP = Math.sqrt(poAxis[0] * gPo[0] + poAxis[1] * gPo[1] + poAxis[2] * gPo[2]);
  if (normH < 1e-9 || normP < 1e-9) return 1;
  const cosA = Math.min(1, Math.max(-1, dotHP / (normH * normP)));
  const cos2 = cosA * cosA;
  const sin2 = 1 - cos2;
  return Math.pow(ratio * ratio * cos2 + sin2 / ratio, -1.5);
}

/** Each space group's Laue orbits, memoized: the refinement asks for them on every evaluation. */
const orbits = new WeakMap<SpaceGroup, Map<string, Vec3[]>>();

function orbitOf(sg: SpaceGroup, h: number, k: number, l: number): Vec3[] {
  let byHkl = orbits.get(sg);
  if (!byHkl) orbits.set(sg, (byHkl = new Map()));
  const key = `${h},${k},${l}`;
  let orbit = byHkl.get(key);
  if (!orbit) byHkl.set(key, (orbit = lauEquivalents(sg, h, k, l)));
  return orbit;
}

/**
 * March–Dollase for a powder reflection: the mean of P(α) over the family's
 * Laue equivalents, which lie at different angles to the axis (as GSAS-II's
 * GetPrefOri). Cubic (100) on [001]: two members along the axis, four across.
 *
 *   P_MD(hkl) = (1/M) Σ_{h′ ∈ family} P(α_h′)
 *
 * Symbols → code: the family `orbit` (M = `orbit.length` members); P
 * {@link marchDollase}; r `ratio`. Dimensionless.
 */
export function marchDollaseFamily(
  cell: UnitCell,
  spaceGroup: SpaceGroup,
  poAxis: Vec3,
  h: number,
  k: number,
  l: number,
  ratio: number,
): number {
  if (ratio === 1) return 1;
  const orbit = orbitOf(spaceGroup, h, k, l);
  return orbit.reduce((s, [eh, ek, el]) => s + marchDollase(cell, poAxis, eh, ek, el, ratio), 0) / orbit.length;
}

export interface PreferredOrientation {
  readonly axis: Vec3;
  readonly ratio: number;
}

/**
 * Debye–Scherrer (cylinder) absorption transmission A(μR, θ), ported verbatim
 * from GSAS-II's `Absorb` (cylinder geometry) — an analytical fit in μR and
 * sin²θ. Returns the transmitted fraction (≤ 1) that multiplies the calculated
 * intensity; μR = 0 ⇒ 1 (no absorption). Two branches at μR = 3.
 *
 * μR is the linear absorption coefficient × capillary radius; for a hard X-ray
 * synchrotron capillary it is typically small (≲ 1).
 *
 *   μR ≤ 3:  A = exp(−T₀·μR − T₁·μR² − T₂·μR³ − T₃·μR⁴),   T₀ = 16/(3π)
 *   μR > 3:  A = [(T₁ − T₄)/(1 + T₂·(μR − 3))^T₃ + T₄] / 100
 *
 * with T₁ … T₄ fitted functions of sin²θ (the constants below).
 * Symbols → code: μR `muR` (dimensionless: μ in cm⁻¹ times R in cm); sin²θ
 * `sth2`, θ half of `twoThetaDeg` (2θ in degrees); T₀ … T₄ `t0` … `t4`; the
 * exponent or the percentage `trns`. A is dimensionless, ≤ 1, floored at 10⁻⁶
 * on the second branch.
 * Source: a port of GSAS-II's `Absorb`, cylinder branch (GSASIIpwd.py); the
 * constants are GSAS-II's. The fit is credited to Lobanov & Alte da Veiga in
 * GSAS-II's source (GSASIIpwd.py).
 */
export function cylinderAbsorption(muR: number, twoThetaDeg: number): number {
  if (muR <= 0) return 1;
  const theta = (twoThetaDeg / 2) * (Math.PI / 180);
  const sth2 = Math.sin(theta) ** 2;
  if (muR <= 3) {
    const t0 = 16.0 / (3 * Math.PI);
    const t1 = (25.99978 - 0.01911 * sth2 ** 0.25) * Math.exp(-0.024551 * sth2) + 0.109561 * Math.sqrt(sth2) - 26.04556;
    const t2 = -0.02489 - 0.39499 * sth2 + 1.219077 * sth2 ** 1.5 - 1.31268 * sth2 ** 2 + 0.871081 * sth2 ** 2.5 - 0.2327 * sth2 ** 3;
    const t3 = 0.003045 + 0.018167 * sth2 - 0.03305 * sth2 ** 2;
    const trns = -t0 * muR - t1 * muR ** 2 - t2 * muR ** 3 - t3 * muR ** 4;
    return Math.exp(trns);
  }
  const t1 = 1.433902 + 11.07504 * sth2 - 8.77629 * sth2 * sth2 + 10.02088 * sth2 ** 3 - 3.36778 * sth2 ** 4;
  const t2 = (0.013869 - 0.01249 * sth2) * Math.exp(3.27094 * sth2) + (0.337894 + 13.77317 * sth2) / (1.0 + 11.53544 * sth2) ** 1.555039;
  const t3 = 1.933433 / (1.0 + 23.12967 * sth2) ** 1.686715 - 0.13576 * Math.sqrt(sth2) + 1.163198;
  const t4 = 0.044365 - 0.04259 / (1.0 + 0.41051 * sth2) ** 148.4202;
  const trns = (t1 - t4) / (1.0 + t2 * (muR - 3.0)) ** t3 + t4;
  return Math.max(trns / 100, 1e-6);
}

/**
 * Suortti flat-plate (Bragg–Brentano) surface-roughness correction, ported from
 * GSAS-II's `SurfaceRough`:
 *   C(θ) = [SRA + (1−SRA)·exp(−SRB/sinθ)] / [SRA + (1−SRA)·exp(−SRB)]
 * normalized to 1 at θ = 90°. At grazing (low) angles the shallow-penetrating
 * beam samples the rough/porous surface, so C < 1 there and rises to 1 at high
 * angle — leaving low-angle intensity unsuppressed inflates B_iso and skews
 * occupancies. SRA ∈ (0,1], SRB ≥ 0; SRA = 1 or SRB = 0 ⇒ C ≡ 1 (no roughness).
 * Symbols → code: SRA `sra`, SRB `srb` (dimensionless); sinθ `sinTheta`, θ
 * half of `twoThetaDeg` (2θ in degrees). C is a dimensionless factor on the
 * intensity.
 * Reference: Suortti, *J. Appl. Cryst.* 5 (1972) 325; GSAS-II `SurfaceRough`.
 * This is a reflection-geometry effect only — irrelevant for capillary /
 * cylindrical transmission, where `cylinderAbsorption` handles the low-angle
 * intensity instead.
 */
export function surfaceRoughness(sra: number, srb: number, twoThetaDeg: number): number {
  if (sra >= 1 || srb <= 0) return 1;
  const sinTheta = Math.sin((twoThetaDeg / 2) * (Math.PI / 180));
  if (sinTheta < 1e-9) return 1;
  const t1 = Math.exp(-srb / sinTheta);
  const t2 = sra + (1 - sra) * Math.exp(-srb);
  return t2 > 0 ? (sra + (1 - sra) * t1) / t2 : 1;
}

/**
 * Lorentz(-polarization) factor for a powder experiment.
 *  - neutron (CW): L = 1 / (sin²θ · cosθ)
 *  - X-ray (CW):   Lp = [(1−P)·cos²2θ + P] / (sin²θ · cosθ), P = polarization
 *    fraction (GSAS-II Polariz.). P = 0.5 ⇒ the unpolarized (1+cos²2θ)/2 form;
 *    a monochromated synchrotron beam has P ≈ 0.9–0.95, which materially
 *    re-weights mid-angle reflections. Reference: Azaroff (1955); GSAS-II
 *    `Polarization`. Pecharsky & Zavalij, *Fundamentals of Powder Diffraction*.
 *  - neutron (TOF): L = d⁴ — the fixed-2θ time-of-flight Lorentz factor
 *    (Buras & Gerward; GSAS-II). The sin θ prefactor is constant per detector
 *    bank and absorbed into the refined scale.
 * Returns 1 when θ is undefined.
 * Symbols → code: d `d` (Å); θ `theta` (radians), from Bragg's law with
 * `radiation.wavelength` (Å); sinθ `sinT`, cosθ `cosT`, cos2θ `cos2T`; P `p`
 * (`radiation.polarization`, 0.5 when absent); L `lorentz`.
 * Units: dimensionless on CW; Å⁴ on TOF (a relative factor: the scale takes
 * up the units).
 * References: Buras & Gerward, Acta Cryst. A31 (1975) 372 (the TOF factor);
 * Azároff, Acta Cryst. 8 (1955) 701 (polarization with a monochromator).
 */
export function lorentzPolarization(radiation: Radiation, d: number): number {
  if (radiation.kind === "neutron-tof") return d * d * d * d;
  const theta = braggTheta(d, radiation.wavelength);
  if (Number.isNaN(theta)) return 1;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const lorentz = 1 / (sinT * sinT * cosT);
  if (radiation.kind === "xray") {
    const cos2T = Math.cos(2 * theta);
    const p = radiation.polarization ?? 0.5;
    return ((1 - p) * cos2T * cos2T + p) * lorentz;
  }
  return lorentz;
}

export interface PowderPeak {
  readonly h: number;
  readonly k: number;
  readonly l: number;
  readonly d: number;
  readonly twoTheta: number;
  readonly intensity: number;
}

/**
 * Integrated peak intensities for a powder pattern (before profile spreading).
 *
 * `f2Override`, when given, supplies |F_N|² per reflection (in `reflections`
 * order) instead of computing the CPU structure-factor sum — the seam the GPU
 * evaluator uses to inject its batched |F|² while reusing this exact intensity
 * assembly (multiplicity·Lp·PO·scale). Ignored unless its length matches
 * `reflections`, so a stale/mismatched cache silently falls back to the CPU sum.
 *
 *   I(hkl) = m · Lp · P_MD · |F_N|² · scale
 *
 * Symbols → code: m `r.multiplicity`; Lp `lp` ({@link lorentzPolarization});
 * P_MD `poFactor` ({@link marchDollaseFamily}); |F_N|² `f2` (fm² or
 * electrons²); `scale` last, so that the product is bit-identical to scaling
 * a unit-scale intensity. 2θ = 2·asin(λ/2d) `twoTheta` (degrees; NaN on TOF).
 */
export function powderPeakIntensities(
  model: StructureModel,
  radiation: Radiation,
  reflections: readonly Reflection[],
  scale: number,
  po?: PreferredOrientation,
  applyLorentz = true,
  f2Override?: ArrayLike<number>,
): PowderPeak[] {
  const useOverride = f2Override !== undefined && f2Override.length === reflections.length;
  const peaks: PowderPeak[] = [];
  for (let i = 0; i < reflections.length; i++) {
    const r = reflections[i]!;
    const f2 = useOverride ? f2Override![i]! : nuclearStructureFactorSquared(model, radiation, r.h, r.k, r.l);
    // Pre-reduced synchrotron I(Q) (e.g. area-detector PDF beamlines) is already
    // Lorentz-corrected; re-applying the 2θ factor double-corrects and wildly
    // over-weights low Q. `applyLorentz=false` skips it for such data.
    const lp = applyLorentz ? lorentzPolarization(radiation, r.d) : 1;
    const poFactor = po ? marchDollaseFamily(model.cell, model.spaceGroup, po.axis, r.h, r.k, r.l, po.ratio) : 1;
    // Scale multiplies LAST so unit-scale intensities scaled afterwards are
    // bit-identical to computing at the target scale directly — the invariant
    // the geometry cache in workflow/powder.ts relies on.
    const intensity = r.multiplicity * lp * poFactor * f2 * scale;
    let twoTheta = NaN;
    if (radiation.kind !== "neutron-tof") {
      const theta = braggTheta(r.d, radiation.wavelength);
      twoTheta = Number.isNaN(theta) ? NaN : (2 * theta * 180) / Math.PI;
    }
    peaks.push({ h: r.h, k: r.k, l: r.l, d: r.d, twoTheta, intensity });
  }
  return peaks;
}

/** Single-crystal calculated intensities aligned with an observed hkl list. */
export function singleCrystalIntensity(
  model: StructureModel,
  radiation: Radiation,
  h: number,
  k: number,
  l: number,
  scale: number,
): number {
  return scale * nuclearStructureFactorSquared(model, radiation, h, k, l);
}
