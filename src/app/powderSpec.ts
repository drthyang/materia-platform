/**
 * Build the full symmetry-allowed powder refinement parameter set for the UI.
 *
 * Wraps `buildStructureRefinement` (scale, Chebyshev background, symmetry-reduced
 * cell, instrument profile, per-site ADP, symmetry-adapted atomic positions) and
 * seeds the scale from the observed data. Structural parameters (positions, ADP,
 * occupancy, corrections) start *fixed* so the first click of "Refine" does a
 * safe scale/background/cell/profile fit; the user frees them per row or per
 * group, in the order they choose.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { LinearRestraint, ParameterBinding, ParameterKind, RefinementParameter } from "@/core/refinement/types";
import { estimateBackground, evaluateBackground, type BackgroundType } from "@/core/diffraction/background";
import { estimateZeroShift } from "@/core/workflow/startingValues";
import { buildStructureRefinement, siteTieRestraints, type TofFileProfile, type TofFileTerm } from "@/core/workflow/structureRefinement";
import { tieReferences } from "@/core/refinement/constraints";
import { powderCurves, type PowderProfile } from "@/core/workflow/powder";
import { CORRECTION_KINDS } from "@/core/diffraction/corrections";
import { optimalScale } from "@/app/loadData";
import { readWithinLimit } from "@/app/reflectionLimit";

/** Structural kinds held fixed on first load; freed via the table. */
const STRUCTURAL_KINDS: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  "positionShift", "bIso", "uAniso", "occupancy", "poRatio",
  // Sample-geometry + intensity corrections (registry) are held fixed on load too.
  ...CORRECTION_KINDS,
]);

/**
 * Instrument / profile kinds (peak shape, width, zero, TOF calibration + shape).
 * These are held fixed on first load too, so the default "Refine" does *not*
 * touch instrument parameters — a plain scale/background/cell fit. The user frees
 * them per row.
 */
const INSTRUMENT_KINDS: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  "peakWidth", "profileU", "profileV", "profileW", "profileX", "profileY",
  "asymSL", "asymHL", "zeroShift", "tofCalibration", "tofProfile", "tofFileProfile",
]);

/**
 * Anisotropic-microstructure kinds (Stephens strain S-parameters, uniaxial size).
 * Emitted only when the user enables microstrain; seeded at zero anisotropy and
 * held fixed on load — strongly correlated, so free them only after the
 * isotropic profile + structure have converged.
 */
const MICROSTRUCTURE_KINDS: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  "stephensStrain", "anisoSizePerp", "anisoSizePar", "mustrainIso",
  "tofSampleGauss", "tofSampleLorentz", "tofSampleSize",
]);

/** Everything the UI holds fixed on load (structural + instrument/profile + microstructure). */
const FIXED_ON_LOAD_KINDS: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  ...STRUCTURAL_KINDS,
  ...INSTRUMENT_KINDS,
  ...MICROSTRUCTURE_KINDS,
]);

export interface PowderSpec {
  readonly params: RefinementParameter[];
  readonly bindings: ParameterBinding[];
  readonly profile: PowderProfile;
}

// The session-level option types live in the core so the project file can
// carry them without importing the app layer; re-exported here for the callers
// that always imported them from the spec builder.
import type { SiteTies, MustrainModel, SampleCorrections } from "@/core/workflow/powderModelOptions";
export { PEAK_CORRECTION_IDS, type CorrectionsUpdate, type PeakCorrectionId, type SampleCorrections } from "@/core/workflow/powderModelOptions";
export type { SiteTies, MustrainModel };

/**
 * The occupancy restraints a session's site ties ask for (the composition;
 * a shared site's Σ is a tie in the rows) over every phase, multi-phase ids
 * prefixed `p{i}_` as the multi-phase spec does. Kept only where one of their
 * occupancies moves: free, or a tied row that follows a free one. Over fixed
 * occupancies a restraint changes nothing, and any restraint turns off the
 * analytic Jacobian.
 */
export function powderRestraints(phases: readonly StructureModel[], ties: SiteTies, params: readonly RefinementParameter[]): LinearRestraint[] {
  const freeIds = new Set(params.filter((p) => !p.fixed && !p.expression).map((p) => p.id));
  const free = new Set([...freeIds, ...params.filter((p) => p.expression && tieReferences(p.expression).some((id) => freeIds.has(id))).map((p) => p.id)]);
  const prefixed = (r: LinearRestraint, i: number): LinearRestraint =>
    phases.length > 1
      ? { ...r, id: `p${i}_${r.id}`, label: `${phases[i]!.name}: ${r.label}`, terms: r.terms.map((t) => ({ ...t, parameterId: `p${i}_${t.parameterId}` })) }
      : r;
  return phases
    .flatMap((structure, i) => siteTieRestraints(structure, ties).map((r) => prefixed(r, i)))
    .filter((r) => r.terms.some((t) => free.has(t.parameterId)));
}


/**
 * Robust automatic starting values (roadmap F1.3): background from the data's
 * lower envelope, THEN the scale against the background-subtracted counts,
 * plus (CW only) a zero-shift sanity check by cross-correlation. Seeding the
 * background before the scale prevents the classic false basin where the
 * auto-scale absorbs the background level into the peaks.
 */
function seedStartingValues(
  structure: StructureModel,
  pattern: PowderPattern,
  seedParams: readonly RefinementParameter[],
  seedBindings: readonly ParameterBinding[],
  profile: PowderProfile,
  backgroundTerms: number,
  checkZero: boolean,
): { background: number[]; scale: number; zeroDelta: number } {
  const xs = pattern.points.map((pt) => pt.x);
  const yObs = pattern.points.map((pt) => pt.yObs);
  const bkgType = profile.backgroundType ?? "chebyshev";
  const background = estimateBackground(xs, yObs, bkgType, backgroundTerms);
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const x of xs) {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }
  const net = yObs.map((y, i) => y - evaluateBackground(xs[i]!, background, bkgType, xMin, xMax));

  // Peaks-only calculated curve (zero background) at unit scale.
  const peaksOnly = seedParams.map((pp) => (pp.kind === "background" ? { ...pp, value: 0 } : pp));
  // A list past the engine's limit has no curve to seed against: the rows' own scale stands, and the page
  // says why it cannot calculate (app/reflectionLimit.ts).
  const first = readWithinLimit(() => powderCurves(structure, pattern, peaksOnly, seedBindings, profile));
  if ("error" in first) {
    if (!first.error.over) throw first.error;
    return { background, scale: seedParams.find((pp) => pp.kind === "scale")?.value ?? 1, zeroDelta: 0 };
  }
  let curves = first.value;

  // Zero-shift sanity (2θ only): apply only a significant, sane shift.
  let zeroDelta = 0;
  if (checkZero && xs.length > 32) {
    const { shift, gain } = estimateZeroShift(xs, net, [...curves.yCalc]);
    const dx = (xMax - xMin) / (xs.length - 1);
    if (gain > 0.05 && Math.abs(shift) > 2 * dx) {
      zeroDelta = shift;
      const shifted = peaksOnly.map((pp) => (pp.kind === "zeroShift" ? { ...pp, value: pp.value + shift } : pp));
      curves = powderCurves(structure, pattern, shifted, seedBindings, profile);
    }
  }
  const scale = optimalScale(net.map((v) => (v > 0 ? v : 0)), curves.yCalc);
  return { background, scale, zeroDelta };
}

/** Overlay seeded background/zero values onto a freshly built parameter set. */
function applySeeds(
  params: readonly RefinementParameter[],
  seeds: { background: number[]; zeroDelta: number },
): RefinementParameter[] {
  let bkgIdx = 0;
  return params.map((pp) => {
    if (pp.kind === "background") {
      const v = seeds.background[bkgIdx++] ?? 0;
      return { ...pp, value: v, initialValue: v };
    }
    if (pp.kind === "zeroShift" && seeds.zeroDelta !== 0) {
      return { ...pp, value: pp.value + seeds.zeroDelta, initialValue: pp.initialValue + seeds.zeroDelta };
    }
    return pp;
  });
}

/** The corrections as the structure builder takes them, for this pattern and instrument. */
function correctionOptions(corrections: SampleCorrections | undefined, pattern: PowderPattern, cwProfile: boolean, asymmetry?: { readonly sl: number; readonly hl: number }): Record<string, unknown> {
  if (!corrections) return {};
  return {
    // FCJ needs the CW pseudo-Voigt profile; seeded from the instrument file's
    // S/L and H/L when it has them (11-BM: 0.0011), else small (0.01).
    ...(corrections.asymmetry && cwProfile && pattern.xUnit === "twoTheta" ? { axial: { sl: asymmetry?.sl ?? 0.01, hl: asymmetry?.hl ?? 0.01 } } : {}),
    ...(corrections.preferredOrientation ? { preferredOrientation: { axis: [...corrections.preferredOrientation] as [number, number, number], ratio: 1 } } : {}),
    ...(corrections.peak && corrections.peak.length > 0 ? { corrections: corrections.peak.map((id) => ({ id, refine: false })) } : {}),
  };
}

/** GSAS-II's sample terms of a new phase: Mustrain 1000 (×10⁻⁶) and Size 1 µm, both Lorentzian. */
export const GSAS2_NEW_PHASE_MUSTRAIN = 1000;
export const GSAS2_NEW_PHASE_SIZE = 1;

/**
 * The profile an instrument file gives, or null when it gives none (a
 * calibration alone: the app's own refinable profile then starts from seeds,
 * as before). A file gives it when it carries the rise, the decay and the
 * Gaussian width: a GSAS-II TOF file's alpha, beta-0 and sig-1; a FullProf
 * `.irf`'s ALFBE (not all zero) and SIGMA.
 *
 * GSAS-II: a calibration is made with a phase beside the instrument, and a new
 * phase in GSAS-II has Lorentzian microstrain 1000 and size 1 µm; the file's
 * X and Y are what is left once those are taken out. So the sample's two
 * Lorentzian rows start at those values, which is the peak GSAS-II calculates
 * from the file.
 *
 * FullProf: the `.irf` is the instrument and the `.pcr` holds the sample as
 * shifts, none by default. The sample starts with a Gaussian microstrain row
 * at 0 and nothing else.
 */
export function tofFileProfileOf(instrument: InstrumentParameters): TofFileProfile | null {
  if (instrument.kind !== "tof" || instrument.profileProgram === undefined) return null;
  const fullprof = instrument.profileProgram === "fullprof";
  const rise = fullprof ? instrument.alpha !== undefined || instrument.alpha0 !== undefined : instrument.alpha !== undefined;
  if (!rise || instrument.beta0 === undefined || instrument.sig1 === undefined) return null;
  const given: [TofFileTerm, number | undefined][] = [
    // GSAS-II's rise has no constant term; FullProf's alph0 is one.
    ...(fullprof ? [["alpha0", instrument.alpha0] as [TofFileTerm, number | undefined]] : []),
    ["alpha1", instrument.alpha], ["beta0", instrument.beta0], ["beta1", instrument.beta1], ["betaQ", instrument.betaQ],
    ["sig0", instrument.sig0], ["sig1", instrument.sig1], ["sig2", instrument.sig2], ["sigQ", instrument.sigQ],
    ["gamX", instrument.gamX], ["gamY", instrument.gamY], ["gamZ", instrument.gamZ],
  ];
  return {
    terms: given.filter(([, v]) => v !== undefined).map(([k]) => k),
    ...(instrument.gamX !== undefined ? { gamX: instrument.gamX } : {}),
    ...(instrument.gamY !== undefined ? { gamY: instrument.gamY } : {}),
    ...(instrument.gamZ !== undefined ? { gamZ: instrument.gamZ } : {}),
    lorentzForm: fullprof ? "fullprof" : "gsas",
    sample: fullprof ? { gauss: 0 } : { gauss: 0, lorentz: GSAS2_NEW_PHASE_MUSTRAIN, size: GSAS2_NEW_PHASE_SIZE },
  };
}

export function buildPowderSpec(
  structure: StructureModel,
  pattern: PowderPattern,
  instrument: InstrumentParameters,
  lorentz = true,
  backgroundTerms = 4,
  ties: SiteTies = {},
  mustrain: MustrainModel = "isotropic",
  corrections?: SampleCorrections,
  /** The background basis, which the seeds are estimated in; omitted: Chebyshev (the profile then names none). */
  backgroundType?: BackgroundType,
): PowderSpec {
  const basis = backgroundType !== undefined ? { backgroundType } : {};
  const tieOpts = {
    tieSharedPositions: ties.positions ?? true,
    tieSharedAdp: ties.adp ?? true,
    // A shared site's occupancies sum to exactly its total by a tie (the last follows the others), as on the PDF page.
    tieSharedOccupancy: true,
    ...(ties.totals ? { occupancyTotals: ties.totals } : {}),
    holdComposition: ties.composition ?? false,
  };
  // Time-of-flight: back-to-back-exponential profile driven by the diffractometer
  // constants (difC/difA/difB) plus α/β/σ shape coefficients. The .instprm here
  // rarely carries the shape coefficients, so seed them: σ scales with difC·Δd
  // (a POWGEN-like resolution), and α/β take moderator-scale (µs) starting
  // values. The profile stage then refines them against the data.
  // The pattern's unit — not the instrument alone — decides the branch: a TOF
  // pattern with a TOF calibration gets the back-to-back-exponential profile; a
  // 2θ pattern always gets the constant-wavelength profile even if a TOF
  // instrument happens to be loaded (e.g. after "Reset to example").
  if (pattern.xUnit === "tof" && instrument.kind === "tof") {
    const resolution = 0.0015; // Δd/d ballpark → σ_TOF ≈ difC·d·Δd/d
    // TOF Mustrain: generalized → Stephens σ; isotropic (also the uniaxial
    // fallback, 2θ-CW only) → an isotropic Mustrain sample parameter in µstrain,
    // seeded from the instrument resolution. When the isotropic Mustrain is used
    // it carries the ∝d² strain term, so σ₁² is seeded to 0 and not emitted (the
    // two are the same functional form — see buildStructureRefinement).
    // An instrument file that gives the profile (tofFileProfileOf): its terms are the
    // instrument's rows, held, and the sample has its own rows beside them.
    const file = tofFileProfileOf(instrument);
    const useIsoMustrain = !file && (mustrain === "isotropic" || mustrain === "uniaxial");
    // Shape coefficients: prefer the instrument's own calibration when the
    // .instprm carries it (GSAS-II α = alpha/d → our alpha1; β and σ² terms map
    // one-to-one), falling back to moderator-scale ballparks refined later.
    const tof = {
      difC: instrument.difC,
      difA: instrument.difA ?? 0,
      difB: instrument.difB ?? 0,
      alpha0: instrument.alpha0 ?? 0, alpha1: instrument.alpha ?? 1.5,
      beta0: instrument.beta0 ?? 0.02, beta1: instrument.beta1 ?? 0,
      betaQ: instrument.betaQ ?? 0,
      sig0: instrument.sig0 ?? 0,
      sig1: instrument.sig1 ?? (useIsoMustrain ? 0 : (instrument.difC * resolution) ** 2),
      sig2: instrument.sig2 ?? 0,
      sigQ: instrument.sigQ ?? 0,
      ...(file ? { file } : {}),
    };
    const microOpt = mustrain === "generalized" ? { stephensStrain: true }
      : useIsoMustrain ? { mustrainIso: resolution * 1e6 } // µstrain seed (×10⁻⁶)
      : {};
    const zero = instrument.zero ?? 0;
    const profile: PowderProfile = { shape: "tof", ...basis };
    const corr = correctionOptions(corrections, pattern, false);
    const seed = buildStructureRefinement(structure, pattern, { scale: 1, backgroundTerms, zero, tof, ...microOpt, refineOccupancy: true, ...tieOpts });
    const seeds = seedStartingValues(structure, pattern, seed.params, seed.bindings, profile, backgroundTerms, false);
    const spec = buildStructureRefinement(structure, pattern, { scale: seeds.scale, backgroundTerms, zero, tof, ...microOpt, ...corr, refineOccupancy: true, ...tieOpts });
    const params = applySeeds(spec.params, seeds).map((p) => (FIXED_ON_LOAD_KINDS.has(p.kind) ? { ...p, fixed: true } : p));
    return { params, bindings: spec.bindings, profile };
  }

  const cw = instrument.kind === "constantWavelength" ? instrument : null;
  // A GSAS-II .instprm carries the Caglioti U,V,W → angle-dependent width; else
  // fall back to a single width.
  const caglioti = cw && cw.u !== undefined ? { u: cw.u, v: cw.v ?? 0, w: cw.w ?? 1 } : undefined;
  const zero = cw?.zero ?? 0;
  const profile: PowderProfile = {
    shape: caglioti ? "pseudoVoigt" : "gaussian",
    ...(caglioti ? { eta: 0.5 } : {}),
    lorentz,
    ...basis,
  };

  // For a proper CW instrument, refine a Thompson–Cox–Hastings pseudo-Voigt:
  // the Gaussian Caglioti U/V/W plus a Lorentzian size–strain X/Y. Seed the
  // Lorentzian from the instrument's *calibrated* X/Y when the file carries them
  // (a GSAS .prm/.instprm does) — this is the instrument resolution and is what
  // lets sharp synchrotron peaks fit on load; refined further in the profile
  // stage. Only fall back to X=1 when the file gives no Lorentzian at all.
  // (Seeding 11-BM's real X≈0.17 vs the old placeholder X=1 takes wR 52%→~19%.)
  const profOpt = caglioti ? { caglioti, lorentzian: { x: cw?.x ?? 1, y: cw?.y ?? 0 } } : {};
  // Seed background (lower envelope) → zero sanity → scale, in that order.
  const seed = buildStructureRefinement(structure, pattern, { scale: 1, backgroundTerms, zero, ...profOpt, refineOccupancy: true, ...tieOpts });
  const seeds = seedStartingValues(structure, pattern, seed.params, seed.bindings, profile, backgroundTerms, pattern.xUnit === "twoTheta");
  const s = seeds.scale;

  // Stephens (1999) anisotropic microstrain: one S-parameter per symmetry-allowed
  // quartic invariant, adding hkl-dependent Gaussian broadening. 2θ CW only, and
  // fixed on load (freed via the Microstructure group).
  // Mustrain model: isotropic (Lorentzian Y, always present) | uniaxial (Y⊥/Y∥
  // about the c-axis) | generalized (Stephens). Anisotropic models need a
  // Lorentzian (caglioti) profile to attach to.
  const microOpt = caglioti && mustrain === "generalized" ? { stephensStrain: true }
    : caglioti && mustrain === "uniaxial" ? { uniaxialStrain: { axis: [0, 0, 1] as [number, number, number] } }
    : {};
  const corr = correctionOptions(corrections, pattern, !!caglioti, cw?.asymmetry);
  const spec = buildStructureRefinement(structure, pattern, { scale: s, backgroundTerms, zero, ...profOpt, ...microOpt, ...corr, refineOccupancy: true, ...tieOpts });
  // S/L and H/L enter the FCJ profile symmetrically: the data determine their
  // sum, not each (GSAS-II refines one SH/L). H/L follows S/L.
  const params = applySeeds(spec.params, seeds).map((p) => (p.kind === "asymHL" ? { ...p, expression: "= asymSL" } : p))
    .map((p) => (FIXED_ON_LOAD_KINDS.has(p.kind) ? { ...p, fixed: true } : p));
  return { params, bindings: spec.bindings, profile };
}
