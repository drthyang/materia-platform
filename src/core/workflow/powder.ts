/**
 * Powder atomic refinement workflow: structure + powder pattern + parameters →
 * RefinementProblem, plus obs/calc/difference curves for plotting and export.
 *
 * Handles constant-wavelength data (2θ, d, or Q) with a Caglioti/TCH width and
 * time-of-flight data with the back-to-back-exponential profile. `placePeaks`
 * factors out the abscissa placement + instrument profile so the magnetic path
 * (satellites at G±k) reuses the exact same positioning and resolution.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import { ModelDomainError, type CalculateOptions, type LinearRestraint, type ParameterBinding, type ParameterKind, type RefinementParameter } from "@/core/refinement/types";
import type { RefinementProblem } from "@/core/refinement/engine";
import { weightsFromSigma, excludedPointMask, applyExclusionMask, fitRangeMask } from "@/core/refinement/factors";
import { resolveTies, tieReferences } from "@/core/refinement/constraints";
import { applyParameters, type AppliedModel } from "@/core/workflow/apply";
import { generateReflections } from "@/core/diffraction/reflections";
import { powderPeakIntensities, lorentzPolarization, marchDollaseFamily } from "@/core/diffraction/intensity";
import { correctionsForPattern } from "@/core/diffraction/corrections";
import { nuclearStructureFactorPartials } from "@/core/diffraction/structureFactor";
import { braggTheta } from "@/core/crystal/unitCell";
import { dFromTof, secondLine, secondLineTwoTheta } from "@/core/diffraction/instrument";
import { synthesizePattern, cagliotiFwhm, lorentzianFwhm, tchPseudoVoigt, fcjSubPeaks, tofLorentzSupport, PEAK_WINDOW_FWHM, type ProfilePeak, type ProfileOptions, type PeakShape } from "@/core/diffraction/profile";
import { evaluateBackground, type BackgroundType } from "@/core/diffraction/background";
import { quarticStrainInvariants, stephensStrainFwhmDeg, stephensStrainSigmaTof, isotropicStrainSigmaTof, uniaxialStrainFwhmDeg, type QuarticInvariant } from "@/core/diffraction/anisoStrain";
import { uniaxialSizeFwhmDeg } from "@/core/diffraction/anisoSize";
import { minMax } from "@/core/math/extent";

/** Inclusive abscissa window that restricts refinement to a sub-range of the
 * pattern. Either bound may be omitted to leave that side unrestricted. */
export interface FitRange {
  readonly min?: number;
  readonly max?: number;
}

/** Powder profile + intensity options for the refinement workflow. */
export interface PowderProfile {
  readonly shape: PeakShape;
  /** Pseudo-Voigt mixing; ignored for Gaussian. */
  readonly eta?: number;
  /** Apply the 2θ Lorentz factor. Default true; false for pre-reduced I(Q). */
  readonly lorentz?: boolean;
  /** Background model. Default Chebyshev. */
  readonly backgroundType?: BackgroundType;
}

/** Convert a d-spacing to the pattern's abscissa unit. Returns NaN if undefined. */
function dToX(pattern: PowderPattern, d: number): number {
  const wl = pattern.wavelength ?? (pattern.radiation.kind !== "neutron-tof" ? pattern.radiation.wavelength : undefined);
  switch (pattern.xUnit) {
    case "twoTheta": {
      if (wl === undefined) return NaN;
      const theta = braggTheta(d, wl);
      return Number.isNaN(theta) ? NaN : (2 * theta * 180) / Math.PI;
    }
    case "dSpacing":
      return d;
    case "q":
      return (2 * Math.PI) / d;
    case "tof":
      return NaN; // not modelled in the minimal engine
  }
}

function dRange(pattern: PowderPattern): { dMin: number; dMax: number } {
  const { min: xMin, max: xMax } = minMax(pattern.points.map((p) => p.x));
  const wl = pattern.wavelength ?? (pattern.radiation.kind !== "neutron-tof" ? pattern.radiation.wavelength : 1.54);
  switch (pattern.xUnit) {
    case "twoTheta": {
      const dAt = (twoThetaDeg: number): number => wl / (2 * Math.sin((twoThetaDeg / 2) * (Math.PI / 180)));
      return { dMin: dAt(xMax), dMax: dAt(xMin) };
    }
    case "dSpacing":
      return { dMin: xMin, dMax: xMax };
    case "q":
      return { dMin: (2 * Math.PI) / xMax, dMax: (2 * Math.PI) / xMin };
    case "tof":
      return { dMin: 0.5, dMax: 5 };
  }
}

/**
 * Smallest d-spacing (Å) of the magnetic satellites on a TOF pattern. Nuclear
 * reflections no longer stop here: they follow the fit window
 * (`reflectionRange`, THY-90). The satellites keep it (the owner's decision of
 * 2026-11-26): at 0.5 Å every ⟨j0⟩ in the table is below 0.025, and three rows
 * grow without bound far below it.
 */
export const TOF_DMIN_FLOOR = 0.5;

/**
 * Smallest d-spacing (Å) of an X-ray reflection list: sin θ/λ = 2.0 Å⁻¹, the
 * end of the range the four-Gaussian form-factor table is valid over (its own
 * file, DABAX f0_InterTables.dat: "only valid in the interval
 * 0 ≤ sin(θ)/λ < 2.0 Å⁻¹").
 */
export const XRAY_FORM_FACTOR_DMIN = 0.25;

/** The d-range covered by a TOF pattern, from its TOF extent and calibration. */
function tofDataDRange(
  pattern: PowderPattern,
  cal: { difC: number; difA: number; difB: number },
  zero: number,
): { dMin: number; dMax: number } {
  const xs = pattern.points.map((p) => p.x);
  const p = { kind: "tof" as const, difC: cal.difC, difA: cal.difA, difB: cal.difB, zero };
  // TOF increases monotonically with d, so min/max TOF map to min/max d.
  const span = minMax(xs);
  const dLo = dFromTof(p, span.min);
  const dHi = dFromTof(p, span.max);
  return { dMin: Math.min(dLo, dHi), dMax: Math.max(dLo, dHi) };
}

/** The widths of a TOF peak at one d-spacing, when the instrument file gives the profile. */
export interface TofWidths {
  readonly alpha: number;
  readonly beta: number;
  /** Gaussian variance (µs²): the instrument's σ²(d) plus the sample's Gaussian microstrain. */
  readonly sig2: number;
  /** Lorentzian FWHM (µs): the instrument's γ(d) plus the sample's Lorentzian terms; a negative sum counts as none. */
  readonly gamma: number;
  /** That sum as the terms give it, negative or not. */
  readonly gammaAsGiven: number;
  /** Which width is not positive here, so that no peak is defined; null when all are. */
  readonly invalid: "σ²" | "α" | "β" | null;
}

/**
 * α, β, σ² and γ at d from an instrument file's profile and the sample rows
 * beside it, each term as its program defines it (GSAS-II: getTOFalpha,
 * getTOFbeta, getTOFsig, getTOFgamma and GetSampleSigGam; FullProf: LINE 27
 * and LINE 30 of its manual):
 *
 *   α = α₀ + α₁/d        β = β₀ + β₁/d⁴ + β_q/d²
 *   σ² = σ₀² + σ₁²·d² + σ₂²·d⁴ + σ_q²·d  +  (|dT/dd|·ε·d)²
 *   γ = X·d + Y·d² + Z  +  10⁻⁶·difC·d·M  +  10⁻⁴·difC·d²/S
 *
 * Nothing is floored. Where σ², α or β is not positive there is no peak, and
 * `invalid` names the first that fails. A negative γ counts as zero: GSAS-II
 * takes γ below 10⁻⁵ µs as 10⁻⁵ µs; FullProf's manual does not say what it
 * does, and zero is taken here until a FullProf run shows otherwise (the
 * Instrument card says where it happens: tofNegativeLorentzian).
 */
export function tofWidthsAt(applied: AppliedModel, d: number): TofWidths {
  const cal = applied.tof!;
  const tp = applied.tofProfile;
  const file = applied.tofFile!;
  const d2 = d * d;
  const alpha = (tp?.alpha0 ?? 0) + (tp?.alpha1 ?? 0) / d;
  const beta = (tp?.beta0 ?? 0) + (tp?.beta1 ?? 0) / (d2 * d2) + (tp?.betaQ ?? 0) / d2;
  let sig2 = (tp?.sig0 ?? 0) + (tp?.sig1 ?? 0) * d2 + (tp?.sig2 ?? 0) * d2 * d2 + (tp?.sigQ ?? 0) * d;
  if (file.sampleGauss > 0) {
    const s = isotropicStrainSigmaTof(d, cal, file.sampleGauss);
    sig2 += s * s;
  }
  let gamma = file.gamX * d + file.gamY * d2 + file.gamZ;
  if (file.sampleLorentz !== 0) gamma += 1e-6 * cal.difC * d * file.sampleLorentz;
  if (file.sampleSize !== undefined && file.sampleSize > 0) gamma += (1e-4 * cal.difC * d2) / file.sampleSize;
  const gammaAsGiven = gamma;
  if (!(gamma > 0)) gamma = 0;
  const invalid = !(sig2 > 0) ? "σ²" : !(alpha > 0) ? "α" : !(beta > 0) ? "β" : null;
  return { alpha, beta, sig2, gamma, gammaAsGiven, invalid };
}

/** The d-range (Å) the pattern's points cover, with the applied calibration on TOF. */
export function dataDRange(pattern: PowderPattern, applied: AppliedModel): { dMin: number; dMax: number } {
  return pattern.xUnit === "tof" && applied.tof !== undefined ? tofDataDRange(pattern, applied.tof, applied.zeroShift) : dRange(pattern);
}

/** d-spacings spread evenly in log d over the data's d-range, for checking a file's widths over the data. */
function tofWidthGrid(pattern: PowderPattern, applied: AppliedModel, n = 512): number[] {
  const { dMin, dMax } = dataDRange(pattern, applied);
  if (!(dMax > dMin)) return [dMin];
  const step = Math.log(dMax / dMin) / (n - 1);
  return Array.from({ length: n }, (_, i) => dMin * Math.exp(i * step));
}

/** A stretch of the data's d-range where an instrument file's profile gives no peak. */
export interface TofWidthProblem {
  /** The width that is not positive there. */
  readonly which: "σ²" | "α" | "β";
  readonly dMin: number;
  readonly dMax: number;
}

/**
 * Where, over the d-range of the loaded data, an instrument file's profile
 * gives σ² ≤ 0, α ≤ 0 or β ≤ 0 (no peak is defined there, and none is drawn).
 * Empty when the file's widths are valid everywhere in the data, when the
 * profile is not an instrument file's, and off time of flight.
 */
export function tofWidthProblems(pattern: PowderPattern, applied: AppliedModel): TofWidthProblem[] {
  if (pattern.xUnit !== "tof" || !applied.tof || !applied.tofFile) return [];
  const grid = tofWidthGrid(pattern, applied);
  const out: TofWidthProblem[] = [];
  let open: { which: "σ²" | "α" | "β"; from: number; to: number } | null = null;
  for (const d of grid) {
    const which = tofWidthsAt(applied, d).invalid;
    if (open && which !== open.which) {
      out.push({ which: open.which, dMin: open.from, dMax: open.to });
      open = null;
    }
    if (which) open = { which, from: open ? open.from : d, to: d };
  }
  if (open) out.push({ which: open.which, dMin: open.from, dMax: open.to });
  return out;
}

/** The stretches of the data's d-range where an instrument file's Lorentzian width comes out negative (and is taken as none). */
export function tofNegativeLorentzian(pattern: PowderPattern, applied: AppliedModel): { dMin: number; dMax: number }[] {
  if (pattern.xUnit !== "tof" || !applied.tof || !applied.tofFile) return [];
  const out: { dMin: number; dMax: number }[] = [];
  let open: { dMin: number; dMax: number } | null = null;
  for (const d of tofWidthGrid(pattern, applied)) {
    const w = tofWidthsAt(applied, d);
    if (w.gammaAsGiven < 0 && !w.invalid) open = { dMin: open ? open.dMin : d, dMax: d };
    else if (open) { out.push(open); open = null; }
  }
  if (open) out.push(open);
  return out;
}

/** The reflections of the applied model that an instrument file's profile gives no peak for, in the data's range. */
export function tofReflectionsLeftOut(pattern: PowderPattern, applied: AppliedModel): { h: number; k: number; l: number; d: number; which: "σ²" | "α" | "β" }[] {
  if (pattern.xUnit !== "tof" || !applied.tof || !applied.tofFile) return [];
  const { dMin, dMax } = dataDRange(pattern, applied);
  const out: { h: number; k: number; l: number; d: number; which: "σ²" | "α" | "β" }[] = [];
  for (const r of generateReflections(applied.model.cell, applied.model.spaceGroup, dMin, dMax)) {
    const which = tofWidthsAt(applied, r.d).invalid;
    if (which) out.push({ h: r.h, k: r.k, l: r.l, d: r.d, which });
  }
  return out;
}

/**
 * A refinement problem's check on the TOF peak widths (an instrument file's
 * profile, or the page's own refinable one). Built from the problem's starting
 * values; called on every model the fit evaluates.
 *
 * - Where the widths are already invalid at the start, the reflections are
 *   left out (at the short-d end the list stops there, reflectionRange;
 *   elsewhere buildTofFilePeaks leaves them out) and the fit goes on.
 * - A step that makes a width invalid somewhere in the data's d-range where it
 *   was valid at the start is outside the model's domain: the engine rejects
 *   it as it rejects a cell length ≤ 0. The points the fit weighs were chosen
 *   at the start (modelledFitRange), so the list may not shrink under them.
 *
 * It does nothing unless a `tofFileProfile` or `tofProfile` row is free: held,
 * the widths cannot change.
 */
export function createTofWidthGuard(
  pattern: PowderPattern,
  parameters: readonly RefinementParameter[],
  bindings: readonly ParameterBinding[],
  applyAt: (values: Readonly<Record<string, number>>) => AppliedModel,
): (applied: AppliedModel) => void {
  const none = (): void => {};
  if (pattern.xUnit !== "tof") return none;
  const freeIds = new Set(parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.id));
  const freeRows = bindings.filter((b) => (b.kind === "tofFileProfile" || b.kind === "tofProfile") && freeIds.has(b.parameterId));
  if (freeRows.length === 0) return none;
  const start: Record<string, number> = {};
  for (const p of parameters) start[p.id] = p.value;
  const baseline = applyAt(start);
  if (!baseline.tof || (!baseline.tofFile && !baseline.tofProfile)) return none;
  const grid = tofWidthGrid(pattern, baseline);
  const validAtStart = grid.map((d) => tofWidthInvalidAt(baseline, d) === null);
  return (applied) => {
    if (!applied.tof) return;
    for (let i = 0; i < grid.length; i++) {
      if (!validAtStart[i]) continue;
      const which = tofWidthInvalidAt(applied, grid[i]!);
      if (which) throw new ModelDomainError(`the TOF profile gives ${which} ≤ 0 at d = ${grid[i]!.toFixed(3)} Å, inside the data's range`);
    }
  };
}

/** TOF peaks from an instrument file's profile: its program's function, no floor (tofWidthsAt). */
function buildTofFilePeaks(
  intensities: readonly { d: number; intensity: number; h?: number; k?: number; l?: number }[],
  applied: AppliedModel,
): ProfilePeak[] {
  const cal = applied.tof!;
  const lorentzForm = applied.tofFile!.lorentzForm;
  const stephens = applied.stephensStrain;
  const invariants = stephens ? strainInvariantsFor(applied) : null;
  const peaks: ProfilePeak[] = [];
  for (const p of intensities) {
    const d = p.d;
    if (d <= 0) continue;
    const w = tofWidthsAt(applied, d);
    // No width, no peak: the reflection is left out, and named where the page reports the file (tofWidthProblems).
    if (w.invalid) continue;
    let sig2 = w.sig2;
    if (stephens && invariants && p.h !== undefined && p.k !== undefined && p.l !== undefined) {
      const sStrain = stephensStrainSigmaTof(p.h, p.k, p.l, applied.model.cell, cal, stephens, invariants);
      if (sStrain > 0) sig2 += sStrain * sStrain;
    }
    const sigma = Math.sqrt(sig2);
    const center = cal.difC * d + cal.difA * d * d + cal.difB / d + applied.zeroShift;
    let support = 2.3548 * sigma + w.gamma + 1 / w.alpha + 1 / w.beta;
    if (w.gamma > 0) {
      // The Lorentzian tail is drawn out to where it holds a negligible share of the peak (tofLorentzSupport),
      // inside the part of the window that is not faded.
      support = Math.max(support, tofLorentzSupport(sigma, w.gamma) / (0.8 * PEAK_WINDOW_FWHM));
      peaks.push({ center, intensity: p.intensity, fwhm: support, tof: { alpha: w.alpha, beta: w.beta, sigma, gamma: w.gamma, lorentzForm } });
    } else {
      peaks.push({ center, intensity: p.intensity, fwhm: support, tof: { alpha: w.alpha, beta: w.beta, sigma } });
    }
  }
  return peaks;
}

/** Back-to-back-exponential TOF peaks: positions from the diffractometer
 *  constants, d-dependent α/β/σ from the profile coefficients. */
function buildTofPeaks(
  intensities: readonly { d: number; intensity: number; h?: number; k?: number; l?: number }[],
  applied: AppliedModel,
): ProfilePeak[] {
  if (applied.tofFile) return buildTofFilePeaks(intensities, applied);
  const cal = applied.tof!;
  const tp = applied.tofProfile;
  // Stephens anisotropic microstrain adds an hkl-dependent Gaussian variance to
  // the TOF peak (in quadrature with the instrument σ²). Cached invariants.
  const stephens = applied.stephensStrain;
  const invariants = stephens ? strainInvariantsFor(applied) : null;
  const peaks: ProfilePeak[] = [];
  for (const p of intensities) {
    const d = p.d;
    if (d <= 0) continue;
    const center = cal.difC * d + cal.difA * d * d + cal.difB / d + applied.zeroShift;
    const alpha = Math.max((tp?.alpha0 ?? 0) + (tp?.alpha1 ?? 0) / d, 1e-6);
    const beta = Math.max((tp?.beta0 ?? 0) + (tp?.beta1 ?? 0) / (d * d * d * d) + (tp?.betaQ ?? 0) / (d * d), 1e-6);
    let sig2 = Math.max((tp?.sig0 ?? 0) + (tp?.sig1 ?? 0) * d * d + (tp?.sig2 ?? 0) * d * d * d * d + (tp?.sigQ ?? 0) * d, 1e-6);
    // Isotropic Mustrain (GSAS-II): a constant Δd/d broadens ∝ d in TOF; add its
    // Gaussian variance in quadrature. σ_T = |dT/dd|·ε·d (see isotropicStrainSigmaTof).
    if (applied.mustrainIso !== undefined && applied.mustrainIso > 0) {
      const sIso = isotropicStrainSigmaTof(d, cal, applied.mustrainIso);
      if (sIso > 0) sig2 += sIso * sIso;
    }
    if (stephens && invariants && p.h !== undefined && p.k !== undefined && p.l !== undefined) {
      const sStrain = stephensStrainSigmaTof(p.h, p.k, p.l, applied.model.cell, cal, stephens, invariants);
      if (sStrain > 0) sig2 += sStrain * sStrain;
    }
    const sigma = Math.sqrt(sig2);
    // Support proxy for the far-peak skip: Gaussian FWHM plus both exponential
    // decay lengths, so the long β tail is not clipped.
    const effFwhm = 2.3548 * sigma + 1 / alpha + 1 / beta;
    peaks.push({ center, intensity: p.intensity, fwhm: effFwhm, tof: { alpha, beta, sigma } });
  }
  return peaks;
}

/** What ends a reflection list at short d. */
export type ShortDStop =
  /** TOF: the fit window's short-d edge less one peak support (the data's end when the window is the whole pattern). */
  | "window"
  /** TOF: below this d the peak terms give a non-positive width, so no peak is defined. */
  | "profile"
  /** X-rays: the form-factor table's range ends here (XRAY_FORM_FACTOR_DMIN). */
  | "xray"
  /** Constant wavelength (and a TOF pattern with no calibration): the data's own range. */
  | "data";

/** The d-range (Å) a pattern's reflection list covers, and why it ends where it does. */
export interface ReflectionRange {
  readonly dMin: number;
  readonly dMax: number;
  readonly stop: ShortDStop;
  /** With stop "profile": the width that is not positive just below dMin. */
  readonly which?: "σ²" | "α" | "β";
  /** The d (Å) of the fit window's short-d edge: the data's own end when the window is the whole pattern. */
  readonly windowD: number;
  /**
   * With stop "profile" or "xray": the points at shorter d than this are not
   * fully modelled and are left out of the fit (modelledFitRange). "profile":
   * dMin itself, since below it no peak is defined to reach the points above.
   * "xray": one peak support above dMin, so that every point kept has the
   * tails of all its lines. Absent when the list reaches the window.
   */
  readonly fittedFrom?: number;
}

/** TOF at d with the applied calibration and zero. */
function tofAt(applied: AppliedModel, d: number): number {
  const c = applied.tof!;
  return c.difC * d + c.difA * d * d + c.difB / d + applied.zeroShift;
}

/** d at a TOF with the applied calibration and zero. */
function dAtTof(applied: AppliedModel, t: number): number {
  const c = applied.tof!;
  return dFromTof({ kind: "tof", difC: c.difC, difA: c.difA, difB: c.difB, zero: applied.zeroShift }, t);
}

/** d at a position on a constant-wavelength pattern's axis (NaN where it has none). */
function dAtX(pattern: PowderPattern, x: number): number {
  const wl = pattern.wavelength ?? (pattern.radiation.kind !== "neutron-tof" ? pattern.radiation.wavelength : 1.54);
  switch (pattern.xUnit) {
    case "twoTheta": return wl / (2 * Math.sin((x / 2) * (Math.PI / 180)));
    case "dSpacing": return x;
    case "q": return (2 * Math.PI) / x;
    case "tof": return NaN;
  }
}

/** The d-spacing (Å) at a position on the pattern's axis, with the applied calibration and zero; NaN where it has none. */
export function dAtPosition(pattern: PowderPattern, applied: AppliedModel, x: number): number {
  if (pattern.xUnit === "tof") return applied.tof ? dAtTof(applied, x) : NaN;
  return dAtX(pattern, x - applied.zeroShift);
}

/**
 * The two ends, on the pattern's axis, of the support of one reflection at d:
 * PEAK_WINDOW_FWHM widths each side of every peak placePeaks draws for it
 * (sub-peaks and a Kα₂ line included). Null where no peak is defined.
 */
function supportAt(pattern: PowderPattern, applied: AppliedModel, d: number): { lo: number; hi: number } | null {
  const peaks = placePeaks(pattern, applied, [{ d, intensity: 1 }]);
  if (peaks.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of peaks) {
    lo = Math.min(lo, p.center - PEAK_WINDOW_FWHM * p.fwhm);
    hi = Math.max(hi, p.center + PEAK_WINDOW_FWHM * p.fwhm);
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null;
}

/**
 * Which TOF peak width is not positive at d, or null when the peak is defined.
 * An instrument file's profile: tofWidthsAt. The page's own refinable profile
 * (no file): the same widths before the 10⁻⁶ floor buildTofPeaks applies, a
 * rise or decay checked only when the model has terms for it, σ² only when it
 * is negative (zero is the limit of a pure exponential pair).
 */
export function tofWidthInvalidAt(applied: AppliedModel, d: number): "σ²" | "α" | "β" | null {
  if (!applied.tof) return null;
  if (applied.tofFile) return tofWidthsAt(applied, d).invalid;
  const tp = applied.tofProfile;
  if (!tp) return null;
  const d2 = d * d;
  let sig2 = tp.sig0 + tp.sig1 * d2 + tp.sig2 * d2 * d2 + tp.sigQ * d;
  if (applied.mustrainIso !== undefined && applied.mustrainIso > 0) {
    const s = isotropicStrainSigmaTof(d, applied.tof, applied.mustrainIso);
    sig2 += s * s;
  }
  const alphaGiven = tp.alpha0 !== 0 || tp.alpha1 !== 0;
  const betaGiven = tp.beta0 !== 0 || tp.beta1 !== 0 || tp.betaQ !== 0;
  if (sig2 < 0) return "σ²";
  if (alphaGiven && !(tp.alpha0 + tp.alpha1 / d > 0)) return "α";
  if (betaGiven && !(tp.beta0 + tp.beta1 / (d2 * d2) + tp.betaQ / d2 > 0)) return "β";
  return null;
}

/**
 * Where the TOF peak terms first define a peak, scanning up from dLo: null
 * when they do at dLo already; else the shortest d above which they do (to
 * 10⁻⁹ relative), and the width that fails just below it. A stretch of
 * invalid widths that does not reach dLo is not this function's business
 * (buildTofFilePeaks leaves those reflections out; tofWidthProblems names them).
 */
function profileValidFrom(applied: AppliedModel, dLo: number, dHi: number): { d: number; which: "σ²" | "α" | "β" } | null {
  let which = tofWidthInvalidAt(applied, dLo);
  if (!which || !(dHi > dLo)) return null;
  const n = 512;
  const step = Math.log(dHi / dLo) / (n - 1);
  let bad = dLo;
  let good = NaN;
  for (let i = 1; i < n; i++) {
    const d = dLo * Math.exp(i * step);
    const w = tofWidthInvalidAt(applied, d);
    if (!w) {
      good = d;
      break;
    }
    bad = d;
    which = w;
  }
  if (Number.isNaN(good)) return { d: dHi, which };
  for (let i = 0; i < 60 && good - bad > 1e-9 * good; i++) {
    const mid = 0.5 * (bad + good);
    const w = tofWidthInvalidAt(applied, mid);
    if (w) {
      bad = mid;
      which = w;
    } else {
      good = mid;
    }
  }
  return { d: good, which };
}

/**
 * The reflection list of a TOF pattern reaches no further below the window's
 * edge than this fraction of the edge's d, whatever the peak support says (a
 * decay rate that nears zero makes the support run away, and a support longer
 * than the edge's own time of flight has no d to end at).
 */
const SUPPORT_REACH_LIMIT = 0.5;

/**
 * How far above its centre (µs) a reflection at d reaches for the list: one
 * support of its peak, PEAK_WINDOW_FWHM widths of 2.3548σ + γ + 1/α + 1/β.
 * That is the support every TOF peak is drawn with, but for the extension a
 * Lorentzian tail gets (buildTofFilePeaks, tofLorentzSupport), which is left
 * out here. The extension is a drawing range: it keeps the area a listed peak
 * loses under 2×10⁻⁴ and runs to some 2000 Lorentzian widths, at short d more
 * than the whole time of flight, so as a list margin it has no end (the list
 * then started at the window's edge itself, and a reflection there dropped in
 * and out of the model as the cell moved: a step in χ²). A reflection 20
 * widths below the window puts under 1 % of its area into it (the Lorentzian
 * share beyond X is ηΓ/2πX, and Γ is no more than one width), thinly spread.
 * Null where no peak is defined.
 */
function tofListReach(pattern: PowderPattern, applied: AppliedModel, d: number): number | null {
  let hi = -Infinity;
  for (const p of placePeaks(pattern, applied, [{ d, intensity: 1 }])) {
    const t = p.tof;
    const width = t ? 2.3548 * t.sigma + (t.gamma ?? 0) + 1 / t.alpha + 1 / t.beta : p.fwhm;
    hi = Math.max(hi, p.center + PEAK_WINDOW_FWHM * width);
  }
  return Number.isFinite(hi) ? hi - tofAt(applied, d) : null;
}

/**
 * The list's short-d end on a grid of 10⁻⁴ in ln d, rounded outward (down for
 * a support's reach, up for a validity limit): a width that moves a little
 * (a profile column's finite difference) leaves the same list, so the
 * structure factors stay cached (createPeakBuilder).
 */
const SNAP = 1e-4;
const snapDown = (d: number): number => Math.exp(Math.floor(Math.log(d) / SNAP) * SNAP);
const snapUp = (d: number): number => Math.exp(Math.ceil(Math.log(d) / SNAP) * SNAP);

/** A TOF pattern's list: to the window's short-d edge less one peak support, stopped earlier where the peak terms give no peak. */
function tofReflectionRange(pattern: PowderPattern, applied: AppliedModel, window?: FitRange): ReflectionRange {
  const data = tofDataDRange(pattern, applied.tof!, applied.zeroShift);
  const xs = minMax(pattern.points.map((p) => p.x));
  const xEdge = Math.min(Math.max(window?.min ?? xs.min, xs.min), xs.max);
  const windowD = dAtTof(applied, xEdge);
  // The shortest d whose support still reaches the edge: x(d) + reach above x(d) = xEdge, by fixed point.
  // Converged: the reflection there just reaches the edge. Not converged in 20 steps: the shortest d tried.
  let lowest = windowD;
  let d = windowD;
  let converged = false;
  for (let i = 0; i < 20 && !converged; i++) {
    const reach = tofListReach(pattern, applied, d);
    if (reach === null) break;
    const next = dAtTof(applied, xEdge - reach);
    // A support longer than the edge's time of flight: no d ends it, and SUPPORT_REACH_LIMIT does.
    if (!(next > 0) || !Number.isFinite(next)) {
      lowest = 0;
      break;
    }
    lowest = Math.min(lowest, next);
    converged = Math.abs(next - d) <= 1e-9 * d;
    d = next;
  }
  let dList = converged ? d : lowest;
  dList = snapDown(Math.max(dList, SUPPORT_REACH_LIMIT * windowD));
  const valid = profileValidFrom(applied, dList, data.dMax);
  if (valid) {
    const from = snapUp(valid.d);
    return { dMin: from, dMax: data.dMax, stop: "profile", which: valid.which, windowD, fittedFrom: from };
  }
  return { dMin: dList, dMax: data.dMax, stop: "window", windowD };
}

/**
 * The reflection list's d-range (THY-90, the owner's rule of 2026-11-26).
 *
 * - Time of flight: from the fit window's short-d edge less one peak support
 *   (the lines just outside the window are drawn, so every point in it has
 *   all its lines; the support is 20 peak widths, tofListReach, and a
 *   Lorentzian's far tail does not lengthen it), stopped earlier only where the peak terms define no peak
 *   (a non-positive σ², α or β below some d: an instrument file's polynomials
 *   extrapolated past the range they were fitted on). No window: the whole
 *   pattern.
 * - Constant wavelength: the data's range, to d = 0.25 Å at most for X-rays
 *   (XRAY_FORM_FACTOR_DMIN).
 *
 * Points the list does not reach are left out of the fit (modelledFitRange).
 */
export function reflectionRange(pattern: PowderPattern, applied: AppliedModel, window?: FitRange): ReflectionRange {
  if (pattern.xUnit === "tof" && applied.tof !== undefined && pattern.points.length > 0) return tofReflectionRange(pattern, applied, window);
  const data = dRange(pattern);
  if (pattern.radiation.kind === "xray" && data.dMin < XRAY_FORM_FACTOR_DMIN && data.dMax > XRAY_FORM_FACTOR_DMIN) {
    const s = supportAt(pattern, applied, XRAY_FORM_FACTOR_DMIN);
    // The long-d end of the support: low 2θ or low Q, high d on a d axis.
    const reach = s ? dAtX(pattern, (pattern.xUnit === "dSpacing" ? s.hi : s.lo) - applied.zeroShift) : XRAY_FORM_FACTOR_DMIN;
    const fittedFrom = Number.isFinite(reach) && reach > XRAY_FORM_FACTOR_DMIN ? reach : XRAY_FORM_FACTOR_DMIN;
    return { dMin: XRAY_FORM_FACTOR_DMIN, dMax: data.dMax, stop: "xray", windowD: data.dMin, fittedFrom };
  }
  return { ...data, stop: "data", windowD: data.dMin };
}

/** The reflection list's d-range (reflectionRange without the reasons). */
export function reflectionDRange(pattern: PowderPattern, applied: AppliedModel, window?: FitRange): { dMin: number; dMax: number } {
  const r = reflectionRange(pattern, applied, window);
  return { dMin: r.dMin, dMax: r.dMax };
}

/**
 * The magnetic satellites' d-range: the data's range, floored at
 * TOF_DMIN_FLOOR on time of flight, as before THY-90 (the owner's decision:
 * no magnetic number moves).
 */
export function magneticDRange(pattern: PowderPattern, applied: AppliedModel): { dMin: number; dMax: number } {
  if (pattern.xUnit !== "tof" || applied.tof === undefined) return dRange(pattern);
  const data = tofDataDRange(pattern, applied.tof, applied.zeroShift);
  return { dMin: Math.max(data.dMin, TOF_DMIN_FLOOR), dMax: data.dMax };
}

/**
 * The fit window the points are weighted in: the window asked for, narrowed
 * where a phase's reflection list stops short of it (a validity limit), so
 * that no point is fitted where the model draws nothing. The narrowest over
 * the phases given (each phase's own applied model). Undefined bounds are
 * the pattern's own ends, as in FitRange.
 */
export function modelledFitRange(pattern: PowderPattern, applied: readonly AppliedModel[], window?: FitRange): FitRange | undefined {
  let from = -Infinity;
  for (const a of applied) {
    const r = reflectionRange(pattern, a, window);
    if (r.fittedFrom !== undefined && r.fittedFrom > from) from = r.fittedFrom;
  }
  if (!(from > 0) || applied.length === 0) return window;
  const a = applied[0]!;
  // The cut on the pattern's own axis: short d is low TOF and low d, high 2θ and high Q.
  if (pattern.xUnit === "tof" || pattern.xUnit === "dSpacing") {
    const cut = pattern.xUnit === "tof" ? (a.tof ? tofAt(a, from) : NaN) : from + a.zeroShift;
    if (!Number.isFinite(cut)) return window;
    return { ...(window ?? {}), min: Math.max(window?.min ?? -Infinity, cut) };
  }
  const cut = dToX(pattern, from) + a.zeroShift;
  if (!Number.isFinite(cut)) return window;
  return { ...(window ?? {}), max: Math.min(window?.max ?? Infinity, cut) };
}

export function buildPeaks(pattern: PowderPattern, applied: AppliedModel, applyLorentz = true, window?: FitRange): ProfilePeak[] {
  const { dMin, dMax } = reflectionDRange(pattern, applied, window);
  const reflections = generateReflections(applied.model.cell, applied.model.spaceGroup, dMin, dMax);
  const intensities = powderPeakIntensities(applied.model, pattern.radiation, reflections, applied.scale, applied.po, applyLorentz);
  return placePeaks(pattern, applied, intensities);
}

/**
 * Parameter kinds whose value changes the reflection intensity list
 * (d-spacings, |F|², multiplicity, LP, March–Dollase). Everything else —
 * scale (hoisted out as a pure multiplier), background, zero shift, all
 * profile widths/shapes, absorption, microstructure broadening — only affects
 * peak PLACEMENT or synthesis, which stay cheap and uncached.
 */
const GEOMETRY_BINDING_KINDS = new Set<ParameterKind>([
  "cellLength", "cellAngle", "positionShift", "uAniso", "bIso", "occupancy", "poRatio",
]);

/**
 * A peak builder with a single-entry geometry cache, for use inside a
 * refinement problem's `calculate` closure. The expensive stage — structure
 * factors over every reflection — is reused whenever no geometry parameter
 * moved since the previous evaluation. During a Levenberg–Marquardt iteration
 * that is every scale/background (linear) column, every profile/zero column,
 * and every synthesis-only trial, which dominate the Jacobian; geometry
 * columns necessarily recompute.
 *
 * EXACT by construction, not approximate: intensities are cached at unit
 * scale and multiplied by the current scale on retrieval, which is
 * bit-identical to a direct computation because `powderPeakIntensities`
 * multiplies scale last. The cache key is the exact string form of every
 * geometry-bound parameter value plus the reflection d-window (which for TOF
 * depends on the calibration and zero shift).
 */
/** Precomputed |F_N|² for a d-window, injected to skip the CPU structure-factor
 *  sum (the GPU evaluator's seam). */
export interface InjectedStructureFactors {
  readonly f2: Float64Array;
  readonly dMin: number;
  readonly dMax: number;
}

export function createPeakBuilder(
  pattern: PowderPattern,
  bindings: readonly ParameterBinding[],
  applyLorentz = true,
  window?: FitRange,
): (applied: AppliedModel, resolved: Readonly<Record<string, number>>, injected?: InjectedStructureFactors) => ProfilePeak[] {
  const geomIds = [...new Set(bindings.filter((b) => GEOMETRY_BINDING_KINDS.has(b.kind)).map((b) => b.parameterId))];
  let lastKey: string | null = null;
  let unitIntensities: ReturnType<typeof powderPeakIntensities> = [];

  return (applied, resolved, injected) => {
    const { dMin, dMax } = reflectionDRange(pattern, applied, window);
    let unit: ReturnType<typeof powderPeakIntensities>;
    // Injected |F|² path (GPU evaluator): recompute the unit intensities from the
    // supplied structure factors — same intensity assembly, |F|² sourced off-core.
    // Only when the d-window matches; the geometry cache is left untouched so a
    // later CPU-sum call still recomputes. `powderPeakIntensities` re-checks the
    // reflection count and silently falls back to the CPU sum on any mismatch.
    if (injected && injected.dMin === dMin && injected.dMax === dMax) {
      const reflections = generateReflections(applied.model.cell, applied.model.spaceGroup, dMin, dMax);
      unit = powderPeakIntensities(applied.model, pattern.radiation, reflections, 1, applied.po, applyLorentz, injected.f2);
    } else {
      let key = `${dMin}|${dMax}`;
      for (const id of geomIds) key += `|${resolved[id]}`;
      if (key !== lastKey) {
        const reflections = generateReflections(applied.model.cell, applied.model.spaceGroup, dMin, dMax);
        unitIntensities = powderPeakIntensities(applied.model, pattern.radiation, reflections, 1, applied.po, applyLorentz);
        lastKey = key;
      }
      unit = unitIntensities;
    }
    const s = applied.scale;
    const intensities = s === 1 ? unit : unit.map((q) => ({ ...q, intensity: q.intensity * s }));
    return placePeaks(pattern, applied, intensities);
  };
}

/**
 * Place pre-computed {d, intensity} peaks at the pattern's abscissa with the
 * instrument profile: CW Caglioti/TCH-pseudo-Voigt width, Finger–Cox–Jephcoat
 * axial asymmetry and cylinder absorption on a 2θ pattern, or the TOF
 * back-to-back-exponential shape. Shared by the nuclear peaks and the magnetic
 * satellites so both get identical positioning + resolution.
 */
/** Cache the (space-group-determined) Stephens invariants by operation list. */
const invariantCache = new WeakMap<object, QuarticInvariant[]>();
function strainInvariantsFor(applied: AppliedModel): QuarticInvariant[] {
  const ops = applied.model.spaceGroup.operations;
  let inv = invariantCache.get(ops);
  if (!inv) {
    inv = quarticStrainInvariants(ops);
    invariantCache.set(ops, inv);
  }
  return inv;
}

export function placePeaks(
  pattern: PowderPattern,
  applied: AppliedModel,
  intensities: readonly { d: number; intensity: number; h?: number; k?: number; l?: number }[],
): ProfilePeak[] {
  const isTof = pattern.xUnit === "tof" && applied.tof !== undefined;
  if (isTof) return buildTofPeaks(intensities, applied);
  const constWidth = Math.max(applied.peakWidth, 1e-4);
  // Angle-dependent Caglioti width only makes sense on a 2θ abscissa (the form
  // is defined in 2θ). GSAS-II gives U,V,W in centidegrees², so the FWHM comes
  // out in centidegrees — divide by 100 to reach the pattern's degree unit.
  const useCaglioti = applied.caglioti !== undefined && pattern.xUnit === "twoTheta";
  // Thompson–Cox–Hastings: an independent Lorentzian size–strain width (GSAS-II
  // X,Y, also centidegrees) combined with the Gaussian per peak into a per-peak
  // FWHM and η. This is the peak-shape model real synchrotron/CW data needs.
  const useTch = applied.lorentzian !== undefined && pattern.xUnit === "twoTheta";
  // Finger–Cox–Jephcoat axial-divergence asymmetry: each peak is expanded into a
  // set of shifted sub-peaks with a low-angle tail (2θ patterns only).
  const useFcj = applied.axial !== undefined && pattern.xUnit === "twoTheta";
  // Sample-geometry + intensity corrections (displacement, transparency,
  // absorption, roughness) come from the registry: position shifts accumulate,
  // intensity factors multiply — in registry order, identity values are exact
  // no-ops, so an unused correction leaves the pattern bit-identical.
  const corr = correctionsForPattern(pattern, applied.corrections);
  // Anisotropic microstructure (2θ CW only). Stephens strain adds to the Gaussian
  // width (variance add); uniaxial size adds to the Lorentzian (breadth add).
  const isCW = pattern.xUnit === "twoTheta" && pattern.radiation.kind !== "neutron-tof";
  const wavelength = pattern.radiation.kind !== "neutron-tof" ? pattern.radiation.wavelength : NaN;
  const useStephens = isCW && applied.stephensStrain !== undefined;
  const useUniaxial = isCW && applied.uniaxialSize !== undefined;
  const useUniaxialStrain = isCW && applied.uniaxialStrain !== undefined && applied.lorentzian !== undefined;
  // A Lorentzian component is part of the MODEL whenever TCH or an anisotropic
  // size/strain term is configured — even at peaks where it evaluates to zero
  // (X refined to its 0 bound, or cos²ψ nulling the uniaxial term). Gating the
  // TCH combination on the value instead made the peak shape discontinuous
  // there: Γ_L → 0 flipped a peak from the TCH η → 0 (pure Gaussian) to the
  // global fallback η = 0.5 (half Lorentzian), and the optimizer walked into a
  // false basin (the local X-ray benchmark: wR more than doubled).
  const useLorentzModel = useTch || useUniaxial || useUniaxialStrain;
  const invariants = useStephens ? strainInvariantsFor(applied) : null;
  // A lab tube's Kα₂: each reflection again at λ₂, ratio × the intensity.
  const line2 = secondLine(pattern);

  // Position corrections (displacement D·cosθ, transparency T·sin2θ) at the
  // Bragg angle, then the zero shift. Accumulated then added once (not folded
  // into a single expression) to keep the exact float arithmetic of the
  // pre-registry code.
  const shifted = (bragg: number): number => {
    let x = bragg;
    if (corr.anyPositional) {
      let shift = 0;
      for (const c of corr.positional) shift += c.positionShift!(applied.corrections, bragg);
      x += shift;
    }
    return x + applied.zeroShift;
  };
  const peaks: ProfilePeak[] = [];
  const emit = (center: number, intensity: number, fwhm: number, eta: number | undefined, second: boolean): void => {
    if (useFcj) {
      for (const sub of fcjSubPeaks(center, applied.axial!)) peaks.push(profilePeak(sub.center, intensity * sub.weight, fwhm, eta, second));
    } else {
      peaks.push(profilePeak(center, intensity, fwhm, eta, second));
    }
  };
  for (const p of intensities) {
    const bragg = dToX(pattern, p.d);
    if (Number.isNaN(bragg)) continue;
    const center = shifted(bragg);
    let gaussianFwhm = useCaglioti ? cagliotiFwhm(center, applied.caglioti!) / 100 : constWidth;
    const hasHkl = p.h !== undefined && p.k !== undefined && p.l !== undefined;
    // Stephens anisotropic strain → extra Gaussian width, added in quadrature.
    if (useStephens && hasHkl && invariants) {
      const gStrain = stephensStrainFwhmDeg(p.h!, p.k!, p.l!, applied.model.cell, wavelength, applied.stephensStrain!, invariants);
      if (gStrain > 0) gaussianFwhm = Math.sqrt(gaussianFwhm * gaussianFwhm + gStrain * gStrain);
    }
    // Uniaxial anisotropic size → extra Lorentzian breadth (added to isotropic X,Y).
    let gammaL = useTch ? lorentzianFwhm(center, applied.lorentzian!) / 100 : 0;
    if (useUniaxial && hasHkl) {
      gammaL += uniaxialSizeFwhmDeg(p.h!, p.k!, p.l!, applied.model.cell, wavelength, applied.uniaxialSize!);
    }
    // Uniaxial anisotropic microstrain → replaces the isotropic Y·tanθ Lorentzian
    // strain with a direction-dependent one (net-zero at the isotropic seed).
    if (useUniaxialStrain && hasHkl) {
      const isoStrain = (applied.lorentzian!.y * Math.tan((center / 2) * (Math.PI / 180))) / 100;
      gammaL += uniaxialStrainFwhmDeg(p.h!, p.k!, p.l!, applied.model.cell, wavelength, applied.uniaxialStrain!) - isoStrain;
    }
    let fwhm: number;
    let eta: number | undefined;
    if (useLorentzModel || gammaL > 0) {
      const tch = tchPseudoVoigt(gaussianFwhm, gammaL);
      fwhm = Math.max(tch.fwhm, 1e-4);
      eta = tch.eta;
    } else {
      fwhm = Math.max(gaussianFwhm, 1e-4);
    }
    // Intensity corrections that scale a peak (registry order: absorption then
    // roughness); each returns 1 at identity, so multiplying is a no-op when off.
    let intensity = p.intensity;
    for (const c of corr.intensity) intensity *= c.intensityFactor!(applied.corrections, center);
    emit(center, intensity, fwhm, eta, false);
    // Kα₂ with Kα₁'s width, shape and corrections, as GSAS-II draws it: over
    // the ≤ 0.5° that separates the lines, the widths differ by far less than
    // they are known.
    if (line2) {
      const bragg2 = secondLineTwoTheta(bragg, line2.lambdaRatio);
      if (!Number.isNaN(bragg2)) emit(shifted(bragg2), intensity * line2.ratio, fwhm, eta, true);
    }
  }
  return peaks;
}

function profilePeak(center: number, intensity: number, fwhm: number, eta: number | undefined, second: boolean): ProfilePeak {
  if (second) return eta !== undefined ? { center, intensity, fwhm, eta, secondLine: true } : { center, intensity, fwhm, secondLine: true };
  return eta !== undefined ? { center, intensity, fwhm, eta } : { center, intensity, fwhm };
}

/**
 * Per-reflection structure-factor breakdown at the current model, plus the
 * intensity prefactor (multiplicity·Lp·PO·scale — everything the forward model
 * multiplies onto |F|²). Computed ONCE per analytic-column request and shared by
 * every occupancy/B_iso column, so freeing several such parameters costs a
 * single structure-factor pass rather than one per column. The prefactor is
 * rebuilt from the very helpers `powderPeakIntensities` uses, so the analytic
 * columns are consistent with the forward model by construction.
 */
interface DerivativeReflection {
  readonly d: number;
  readonly h: number;
  readonly k: number;
  readonly l: number;
  readonly prefactor: number;
  readonly partials: ReturnType<typeof nuclearStructureFactorPartials>;
}

function derivativeReflections(applied: AppliedModel, pattern: PowderPattern, applyLorentz: boolean, window?: FitRange): DerivativeReflection[] {
  const { dMin, dMax } = reflectionDRange(pattern, applied, window);
  const reflections = generateReflections(applied.model.cell, applied.model.spaceGroup, dMin, dMax);
  const radiation = pattern.radiation;
  return reflections.map((r) => {
    const lp = applyLorentz ? lorentzPolarization(radiation, r.d) : 1;
    const poFactor = applied.po ? marchDollaseFamily(applied.model.cell, applied.model.spaceGroup, applied.po.axis, r.h, r.k, r.l, applied.po.ratio) : 1;
    return {
      d: r.d, h: r.h, k: r.k, l: r.l,
      prefactor: r.multiplicity * lp * poFactor * applied.scale,
      partials: nuclearStructureFactorPartials(applied.model, radiation, r.h, r.k, r.l),
    };
  });
}

/**
 * ∂(integrated intensity)/∂p per reflection for one occupancy or isotropic
 * B_iso parameter, derived from the shared per-reflection breakdown (roadmap
 * F1.1). Positions and widths do not depend on occupancy or B_iso, so the caller
 * spreads these derivative intensities with the ordinary profile to get
 * ∂yCalc/∂p.
 */
function nuclearDerivativeIntensities(
  reflections: readonly DerivativeReflection[],
  kind: "occupancy" | "bIso",
  siteLabels: readonly string[],
): { d: number; intensity: number; h: number; k: number; l: number }[] {
  const labels = new Set(siteLabels);
  return reflections.map((r) => {
    const { f, s, perSite } = r.partials;
    // A parameter bound to several symmetry-equivalent sites (a shared-B ADP
    // group) moves them together, so ∂|F|²/∂p sums the per-site contributions.
    let dF2 = 0;
    for (const site of perSite) {
      if (!labels.has(site.label)) continue;
      // Re(conj(F)·unitSite), with unitSite = ∂F/∂occ (occupancy pulled out).
      const reDot = f.re * site.unitSite.re + f.im * site.unitSite.im;
      // ∂|F|²/∂occ = 2·Re(conj F·unitSite);  ∂F/∂B = −s²·occ·unitSite (isotropic)
      // ⇒ ∂|F|²/∂B = −2·s²·occ·Re(conj F·unitSite). Anisotropic sites ignore B_iso
      // (apply.ts leaves them untouched), so they contribute zero — matching FD.
      dF2 += kind === "occupancy" ? 2 * reDot : site.isotropic ? -2 * s * s * site.occupancy * reDot : 0;
    }
    return { d: r.d, intensity: r.prefactor * dF2, h: r.h, k: r.k, l: r.l };
  });
}

/**
 * The weights of a powder pattern's points, as every powder problem fits them
 * (single-phase, multi-phase, nuclear + magnetic): 1/σ², with σ = √y_obs where
 * the file gives none (1 at a count ≤ 0), and zero on an excluded sentinel
 * plateau (a GSAS export's constant −3 outside its fit range) and outside the
 * fit range. The page's wR and point count (powderPage.ts `weightedR`,
 * `observationsIn`) select the same points.
 */
export function powderPointWeights(pattern: PowderPattern, fitRange?: FitRange): Float64Array {
  return applyExclusionMask(
    applyExclusionMask(
      weightsFromSigma(pattern.points.map((p) => p.sigma ?? (p.yObs > 0 ? Math.sqrt(p.yObs) : 1))),
      excludedPointMask(pattern.points.map((p) => p.yObs)),
    ),
    fitRangeMask(pattern.points.map((p) => p.x), fitRange),
  );
}

/** Every parameter at its current value (id → value). */
export function startValues(parameters: readonly RefinementParameter[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const p of parameters) values[p.id] = p.value;
  return values;
}

export function buildPowderProblem(
  structure: StructureModel,
  pattern: PowderPattern,
  parameters: readonly RefinementParameter[],
  bindings: readonly ParameterBinding[],
  profile: PowderProfile = { shape: "gaussian" },
  restraints: readonly LinearRestraint[] = [],
  fitRange?: FitRange,
): RefinementProblem {
  const xValues = pattern.points.map((p) => p.x);
  const observations = Float64Array.from([...pattern.points.map((p) => p.yObs), ...restraints.map((r) => r.target)]);
  const applyAt = (v: Readonly<Record<string, number>>): AppliedModel => applyParameters(structure, bindings, resolveTies(parameters, v));
  const weights = new Float64Array(observations.length);
  // No point is fitted where the reflection list stops short of it (a validity limit, reflectionRange).
  weights.set(powderPointWeights(pattern, modelledFitRange(pattern, [applyAt(startValues(parameters))], fitRange)), 0);
  for (let i = 0; i < restraints.length; i++) {
    const sigma = Math.max(restraints[i]!.sigma, 1e-12);
    weights[xValues.length + i] = 1 / (sigma * sigma);
  }
  const applyLorentz = profile.lorentz ?? true;
  const peaksFor = createPeakBuilder(pattern, bindings, applyLorentz, fitRange);
  const widthGuard = createTofWidthGuard(pattern, parameters, bindings, applyAt);

  const calculate = (values: Readonly<Record<string, number>>, options?: CalculateOptions): Float64Array => {
    const resolved = resolveTies(parameters, values);
    const applied = applyParameters(structure, bindings, resolved);
    widthGuard(applied);
    const peaks = peaksFor(applied, resolved, options?.structureFactors);
    const opts: ProfileOptions = {
      shape: profile.shape,
      ...(profile.eta !== undefined ? { eta: profile.eta } : {}),
      ...(profile.backgroundType !== undefined ? { backgroundType: profile.backgroundType } : {}),
      ...(applied.background.length ? { background: applied.background } : {}),
    };
    const yCalc = synthesizePattern(xValues, peaks, opts);
    if (restraints.length === 0) return yCalc;
    const withRestraints = new Float64Array(yCalc.length + restraints.length);
    withRestraints.set(yCalc, 0);
    for (let i = 0; i < restraints.length; i++) {
      const restraint = restraints[i]!;
      let value = 0;
      for (const term of restraint.terms) value += term.coefficient * (resolved[term.parameterId] ?? 0);
      withRestraints[yCalc.length + i] = value;
    }
    return withRestraints;
  };

  // Analytic Jacobian columns (roadmap F1.1) for the coupling-free nuclear
  // structural kinds — site occupancy and isotropic B_iso — whose derivative
  // flows purely through |F|² (peak centers and widths are unaffected). Offered
  // only when there are no restraints (so a column's length is exactly the
  // pattern) and only for a parameter driven by a single such binding — which
  // makes the target site unambiguous and mirrors apply's last-write-wins site
  // assignment exactly. Every other parameter returns null and stays on the
  // finite-difference path.
  const analyticColumns =
    restraints.length === 0
      ? (freeParams: readonly RefinementParameter[], freeValues: readonly number[]): (Float64Array | null)[] => {
          const values: Record<string, number> = {};
          for (const p of parameters) values[p.id] = p.value;
          for (let j = 0; j < freeParams.length; j++) values[freeParams[j]!.id] = freeValues[j]!;
          const resolved = resolveTies(parameters, values);
          const applied = applyParameters(structure, bindings, resolved);
          const opts: ProfileOptions = {
            shape: profile.shape,
            ...(profile.eta !== undefined ? { eta: profile.eta } : {}),
            ...(profile.backgroundType !== undefined ? { backgroundType: profile.backgroundType } : {}),
            // Background is independent of occupancy/B_iso, so it is deliberately
            // omitted here: the derivative is the peaks-only synthesis.
          };
          // Decide which columns are analytic before touching structure factors,
          // so a request with no occupancy/B_iso free skips the whole pass.
          // A parameter another one follows (a tie "= p") moves the follower's
          // sites too, which its own bindings do not name: finite differences,
          // which see the tie through calculate().
          const followed = new Set(parameters.flatMap((q) => (q.expression ? tieReferences(q.expression) : [])));
          const kindOf = (p: RefinementParameter): "occupancy" | "bIso" | null => {
            if (followed.has(p.id)) return null;
            const bs = bindings.filter((b) => b.parameterId === p.id);
            if (bs.length === 0) return null;
            // Analytic only when every binding is the same coupling-free kind on a
            // named site (e.g. a shared-B ADP group); mixed/other kinds → FD.
            const kind = bs[0]!.kind;
            if (kind !== "occupancy" && kind !== "bIso") return null;
            return bs.every((b) => b.kind === kind && b.targetKey) ? kind : null;
          };
          const kinds = freeParams.map(kindOf);
          if (kinds.every((k) => k === null)) return kinds.map(() => null);
          // One structure-factor pass shared by every analytic column.
          const refl = derivativeReflections(applied, pattern, applyLorentz, fitRange);
          return freeParams.map((p, i) => {
            const kind = kinds[i];
            if (!kind) return null;
            const labels = bindings.filter((b) => b.parameterId === p.id).map((b) => b.targetKey!);
            const derivPeaks = nuclearDerivativeIntensities(refl, kind, labels);
            return synthesizePattern(xValues, placePeaks(pattern, applied, derivPeaks), opts);
          });
        }
      : undefined;

  return { parameters, observations, weights, dataLength: xValues.length, calculate, ...(analyticColumns ? { analyticColumns } : {}) };
}

export interface PowderCurves {
  readonly x: number[];
  readonly yObs: number[];
  readonly yCalc: number[];
  readonly yBackground?: number[];
  readonly diff: number[];
}

/** Observed / calculated / difference curves for the current parameters. */
export function powderCurves(
  structure: StructureModel,
  pattern: PowderPattern,
  parameters: readonly RefinementParameter[],
  bindings: readonly ParameterBinding[],
  profile: PowderProfile = { shape: "gaussian" },
  fitRange?: FitRange,
): PowderCurves {
  // The list follows the window as the fit's does, so the curve drawn is the one fitted.
  const problem = buildPowderProblem(structure, pattern, parameters, bindings, profile, [], fitRange);
  const values: Record<string, number> = {};
  for (const p of parameters) values[p.id] = p.value;
  const yCalc = problem.calculate(values);
  const x = pattern.points.map((p) => p.x);
  const yObs = pattern.points.map((p) => p.yObs);
  const resolved = resolveTies(parameters, values);
  const applied = applyParameters(structure, bindings, resolved);
  const { min: xMin, max: xMax } = minMax(x);
  const bgType = profile.backgroundType ?? "chebyshev";
  const yBackground = x.map((xv) => evaluateBackground(xv, applied.background, bgType, xMin, xMax));
  const diff = yObs.map((o, i) => o - (yCalc[i] ?? 0));
  return { x, yObs, yCalc: Array.from(yCalc), yBackground, diff };
}
