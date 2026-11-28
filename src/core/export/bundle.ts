/**
 * Export-bundle assembler: turns a refinement (structure + dataset + instrument
 * + refined parameters) into the set of files a user drops into FullProf or
 * GSAS-II. Pure — returns `ZipEntry[]`; the UI zips (via zipStore) and downloads.
 *
 * Two program-specific bundles (one click each):
 *  - FullProf: `<name>.pcr` (every phase) + data (`.dat` XYDATA / `.int`) + README
 *  - GSAS-II:  one `.cif` per phase + `.instprm` (powder) + data (`.xye`/`.hkl`)
 *              + `build_gpx.py` + README
 *
 * `refinementBundle` is the entry point for a finished fit: it applies the
 * refined values to every phase AND derives the refined instrument profile,
 * background curve and fit range, so both programs start from the model the
 * workbench converged to — not just its structure.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { DiffractionDataset, PowderPattern, Radiation } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { RefinementParameter, ParameterBinding, ParameterKind } from "@/core/refinement/types";
import type { ZipEntry } from "@/core/export/zip";
import type { BackgroundType } from "@/core/diffraction/background";
import { evaluateBackground } from "@/core/diffraction/background";
import { structureToCif, type CifRefinementMeta } from "@/core/export/cif";
import { structureToPcr, type PcrExportOptions, type PcrPhase } from "@/core/export/fullprof";
import {
  instrumentToInstprm, buildGpxScript, gsas2InstrumentValues, gsas2SampleTerms, patchInstprm, GSAS2_CW_NO_SAMPLE_TERMS,
  type RefinedInstrumentProfile,
} from "@/core/export/gsas2";
import {
  powderDataXye, powderDataFullProf, singleCrystalHkl, singleCrystalInt, radiationWavelength, hklf4ScaleFactor,
} from "@/core/export/data";
import { applyParameters, type AppliedModel } from "@/core/workflow/apply";
import { phaseBindingsFor } from "@/core/workflow/multiPhase";
import { resolveTies } from "@/core/refinement/constraints";
import { minMax } from "@/core/math/extent";

/** A further phase of a multi-phase fit, as it goes into the bundle. */
export interface BundlePhase {
  readonly structure: StructureModel;
  /** Refined phase scale (a starting value for FullProf). */
  readonly scale?: number;
  /** March–Dollase preferred orientation of this phase. */
  readonly po?: { readonly axis: readonly [number, number, number]; readonly ratio: number };
}

export interface BundleOptions {
  /** Base filename (default: sanitized structure name). */
  readonly name?: string;
  /** Full instrument parameters; derived from the dataset radiation if omitted. */
  readonly instrument?: InstrumentParameters;
  /** Refined parameters + bindings (for CIF value(su) annotation). */
  readonly params?: readonly RefinementParameter[];
  readonly bindings?: readonly ParameterBinding[];
  /** Refinement agreement metadata for the CIF. */
  readonly refinement?: CifRefinementMeta;
  /** Standard BNS label for a magnetic phase. */
  readonly magneticLabel?: string;
  /** The user's original instrument file (verbatim). When it is a single-bank
   *  GSAS-II `.instprm`, the refined profile is patched into a copy of it
   *  (every other line kept) instead of regenerating from the lossy instrument
   *  model; the untouched original always ships alongside. */
  readonly rawInstrument?: { readonly name: string; readonly text: string };
  /** A statement on the instrument file's origin for the README, when it is not the user's own (a default shipped with the app). */
  readonly instrumentNote?: string;
  /** The user's original data file (verbatim), shipped alongside the portable
   *  re-serialized data so the exact input travels with the bundle. */
  readonly rawData?: { readonly name: string; readonly text: string };
  /** Main-phase scale + preferred orientation (refined values). */
  readonly primary?: Omit<BundlePhase, "structure">;
  /** The other phases of a multi-phase fit (at their refined values). */
  readonly extraPhases?: readonly BundlePhase[];
  /** The refined instrument profile, in MATERIA's conventions. */
  readonly profile?: RefinedInstrumentProfile;
  /** The refined background curve y_b(x) (pattern units). */
  readonly backgroundCurve?: (x: number) => number;
  /** Anchors of an interpolating background (its values transfer exactly). */
  readonly backgroundAnchors?: readonly number[];
  /** The fit range used (only a range narrower than the data has an effect). */
  readonly fitRange?: { readonly min?: number; readonly max?: number };
  /** Refined quantities neither program receives from the bundle. */
  readonly notExported?: readonly string[];
}

type SingleCrystalData = Extract<DiffractionDataset, { reflections: unknown }>;

function isSingleCrystal(dataset: DiffractionDataset): dataset is SingleCrystalData {
  return "reflections" in dataset;
}

/** Filesystem-safe base name. */
function sanitize(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || "structure";
}

/** Keep a user's original filename (with its extension) but make it zip-safe. */
function sanitizeFilename(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned && cleaned !== "." ? cleaned : "";
}

/** Does a raw instrument file look like a GSAS-II `.instprm` (usable verbatim)? */
function isInstprm(name: string, text: string): boolean {
  return /\.instprm$/i.test(name)
    || /#\s*GSAS-II instrument parameter file/i.test(text)
    || /(^|\n)\s*Type\s*:\s*(PNT|PXC|PNC)\b/i.test(text);
}

/**
 * The one bank of a multi-bank GSAS-II `.instprm` ("#Bank N: …" blocks) that
 * the session used, as a single-bank file with the block's lines verbatim. The
 * bank is the one whose difC is the instrument's as loaded (bank numbers are
 * not kept with the instrument). Undefined for a single-bank file, off TOF, or
 * when no block matches.
 */
function sessionBankOfInstprm(text: string, instrument: InstrumentParameters | undefined): { text: string; bank: number } | undefined {
  if (instrument?.kind !== "tof") return undefined;
  const lines = text.split(/\r?\n/);
  const starts = lines.map((l, i) => (/^\s*#\s*Bank\s+\d+/i.test(l) ? i : -1)).filter((i) => i >= 0);
  if (starts.length < 2) return undefined;
  for (let b = 0; b < starts.length; b++) {
    const block = lines.slice(starts[b]! + 1, b + 1 < starts.length ? starts[b + 1]! : lines.length);
    const difC = block.map((l) => l.match(/(?:^|;)\s*difC\s*:\s*(-?\d[\d.eE+-]*)/i)).find((m) => m)?.[1];
    if (difC === undefined || Math.abs(parseFloat(difC) - instrument.difC) > 1e-9 * Math.abs(instrument.difC)) continue;
    const bank = parseInt(lines[starts[b]!]!.match(/#\s*Bank\s+(\d+)/i)![1]!, 10);
    // One key:value per line, as patchInstprm reads it.
    const body = block.flatMap((l) => (l.trim().startsWith("#") ? [l] : l.split(";"))).filter((l) => l.trim() !== "");
    return { text: ["#GSAS-II instrument parameter file; do not add/delete items!", ...body].join("\n") + "\n", bank };
  }
  return undefined;
}

/** The detector-bank 2θ a GSAS-II `.instprm` declares (TOF), if any. */
function instprmTwoTheta(text: string | undefined): number | undefined {
  const m = text?.match(/^\s*2-theta\s*:\s*(-?\d[\d.eE+-]*)/im);
  const v = m ? parseFloat(m[1]!) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

/** A minimal instrument when the caller doesn't supply full parameters. */
function deriveInstrument(radiation: Radiation): InstrumentParameters {
  if (radiation.kind === "neutron-tof") return { kind: "tof", difC: 0 };
  return {
    kind: "constantWavelength",
    wavelength: radiation.wavelength,
    radiationKind: radiation.kind === "xray" ? "xray" : "neutron",
    ...(radiation.kind === "xray" && radiation.polarization !== undefined ? { polarization: radiation.polarization } : {}),
  };
}

export type BundleTarget = "fullprof" | "gsas2";

export interface RefinementBundleOptions extends BundleOptions {
  /** The refinement's parameters, carrying the refined values (and `esd`). */
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  /** Ids of the other phases in a multi-phase fit, whose bindings are left out
   *  of the main phase. Pass the phases themselves as `phases` to export them. */
  readonly otherPhaseIds?: readonly string[];
  /** The other phases of a multi-phase fit, as loaded; exported at their
   *  refined values (own bindings + the shared instrument profile). */
  readonly phases?: readonly StructureModel[];
  /** Background basis the refinement used (default Chebyshev). */
  readonly backgroundType?: BackgroundType;
}

/** Kinds the bundle carries (everything else is reported as not exported). Exported for the guard test that each is written by both bundles. */
export const EXPORTED_KINDS: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  "scale", "background", "cellLength", "cellAngle", "atomX", "atomY", "atomZ", "positionShift",
  "occupancy", "bIso", "uAniso", "peakWidth", "profileU", "profileV", "profileW", "profileX", "profileY",
  "asymSL", "asymHL", "zeroShift", "tofCalibration", "tofProfile", "poRatio", "mustrainIso",
  "tofFileProfile", "tofSampleGauss", "tofSampleLorentz", "tofSampleSize",
]);

/** Readable names for the kinds the bundle does not carry. */
export const KIND_NAMES: Partial<Record<ParameterKind, string>> = {
  sampleDisplacement: "sample displacement",
  sampleTransparency: "sample transparency",
  absorption: "absorption (muR)",
  surfaceRoughA: "surface roughness",
  surfaceRoughB: "surface roughness",
  extinction: "extinction",
  stephensStrain: "Stephens anisotropic microstrain",
  anisoSizePerp: "uniaxial crystallite size",
  anisoSizePar: "uniaxial crystallite size",
  mustrainPerp: "uniaxial microstrain",
  mustrainPar: "uniaxial microstrain",
  magneticScale: "the magnetic phase",
  momentX: "the magnetic phase",
  momentY: "the magnetic phase",
  momentZ: "the magnetic phase",
  momentMode: "the magnetic phase",
};

/**
 * The cross-check bundle of a refinement. Everything the fit converged to is
 * applied first — cell, positions, ADPs, occupancies for every phase, and the
 * shared instrument profile (zero, peak shape, TOF calibration), background and
 * fit range — so the files carry the refined model, not the starting one.
 * Bindings aimed at another phase are left out of the main phase, so a
 * multi-phase fit cannot cross-apply a cell.
 */
export function refinementBundle(
  target: BundleTarget,
  structure: StructureModel,
  dataset: DiffractionDataset,
  opts: RefinementBundleOptions,
): ZipEntry[] {
  const others = new Set([...(opts.otherPhaseIds ?? []), ...(opts.phases ?? []).map((p) => p.id)]);
  const values = resolveTies(opts.params, Object.fromEntries(opts.params.map((p) => [p.id, p.value])));
  const primaryApplied = applyParameters(structure, opts.bindings.filter((b) => !others.has(b.targetId)), values);
  const extraPhases: BundlePhase[] = (opts.phases ?? []).map((ph) => {
    const a = applyParameters(ph, phaseBindingsFor(opts.bindings, ph.id), values);
    return { structure: a.model, ...phaseExtras(a, opts.bindings, ph.id) };
  });
  const kinds = new Set(opts.bindings.map((b) => b.kind));
  const notExported = [...new Set([...kinds].filter((k) => !EXPORTED_KINDS.has(k)).map((k) => KIND_NAMES[k] ?? k))];
  const bundleOpts: BundleOptions = {
    ...opts,
    primary: phaseExtras(primaryApplied, opts.bindings, undefined),
    extraPhases,
    ...(!isSingleCrystal(dataset) ? powderExtras(dataset, primaryApplied, kinds, opts.backgroundType ?? "chebyshev") : {}),
    ...(notExported.length ? { notExported } : {}),
  };
  const refined = primaryApplied.model;
  return target === "fullprof" ? fullprofBundle(refined, dataset, bundleOpts) : gsas2Bundle(refined, dataset, bundleOpts);
}

/** Scale + preferred orientation of one phase (only when actually bound). */
function phaseExtras(
  a: AppliedModel,
  bindings: readonly ParameterBinding[],
  phaseId: string | undefined,
): Omit<BundlePhase, "structure"> {
  const scaleBound = bindings.some((b) => b.kind === "scale" && (phaseId === undefined || b.targetId === phaseId));
  return {
    ...(scaleBound ? { scale: a.scale } : {}),
    ...(a.po ? { po: { axis: a.po.axis, ratio: a.po.ratio } } : {}),
  };
}

/** The refined instrument profile + background of a powder fit, in model units. */
function powderExtras(
  pattern: PowderPattern,
  a: AppliedModel,
  kinds: ReadonlySet<ParameterKind>,
  bgType: BackgroundType,
): Pick<BundleOptions, "profile" | "backgroundCurve" | "backgroundAnchors"> {
  // An isotropic TOF Mustrain is the ∝d² Gaussian strain term: fold its
  // σ_T² ≈ (difC·ε)²·d² into Sig-1, since neither file carries it separately
  // here (ε is already dimensionless on the applied model).
  // Units: `a.mustrainIso` is ε (a pure number), so (difC·ε)² is in µs²/Å², the
  // unit of σ₁². The same fold from the ROW value (10⁶·ε) is in
  // `tofShapeFromParams` below, hence its extra 10⁻⁶. The fold takes difC for
  // dT/dd; the fit uses |dT/dd| (diffraction/anisoStrain.ts): equal when
  // difA = difB = 0.
  // An instrument file's profile goes back as it is used: its σ₁² untouched, its
  // Lorentzian X, Y, Z, and the sample's rows apart (tofSample).
  const tofProfile = a.tofProfile && a.tofFile
    ? { ...a.tofProfile, gamX: a.tofFile.gamX, gamY: a.tofFile.gamY, gamZ: a.tofFile.gamZ }
    : a.tofProfile && a.mustrainIso && a.tof
      ? { ...a.tofProfile, sig1: a.tofProfile.sig1 + (a.tof.difC * a.mustrainIso) ** 2 }
      : a.tofProfile;
  const tofSample = a.tofFile
    ? { gauss: a.tofFile.sampleGauss * 1e6, lorentz: a.tofFile.sampleLorentz, ...(a.tofFile.sampleSize !== undefined ? { size: a.tofFile.sampleSize } : {}) }
    : undefined;
  const profile: RefinedInstrumentProfile = {
    zero: a.zeroShift,
    ...(a.caglioti ? { caglioti: a.caglioti } : {}),
    ...(!a.caglioti && kinds.has("peakWidth") ? { peakWidth: a.peakWidth } : {}),
    ...(a.lorentzian ? { lorentzian: a.lorentzian } : {}),
    ...(a.axial ? { axial: a.axial } : {}),
    ...(a.tof ? { tof: a.tof } : {}),
    ...(tofProfile ? { tofProfile } : {}),
    ...(tofSample ? { tofSample } : {}),
    ...(a.tofFile ? { tofLorentzForm: a.tofFile.lorentzForm } : {}),
  };
  if (!kinds.has("background") || a.background.length === 0 || pattern.points.length < 2) return { profile };
  const { min: xMin, max: xMax } = minMax(pattern.points.map((p) => p.x));
  const coeffs = a.background;
  const backgroundCurve = (x: number): number => evaluateBackground(x, coeffs, bgType, xMin, xMax);
  // An interpolating background is exact at its own anchors (GSAS-II style).
  // The anchors X_j are typed again here, after diffraction/background.ts
  // `interpAnchors` (linear, or evenly spaced in ln x), on the same domain. Not
  // an exact copy in log mode: `interpAnchors` sets the two end points to
  // x_min and x_max themselves and needs x_max > x_min for the log spacing;
  // here every point, the ends included, is exp(…), and the test is x_min > 0.
  if ((bgType === "linInterpolate" || bgType === "logInterpolate") && coeffs.length >= 2) {
    const n = coeffs.length;
    const log = bgType === "logInterpolate" && xMin > 0;
    const backgroundAnchors = Array.from({ length: n }, (_, i) =>
      log ? Math.exp(Math.log(xMin) + (i * (Math.log(xMax) - Math.log(xMin))) / (n - 1)) : xMin + (i * (xMax - xMin)) / (n - 1));
    return { profile, backgroundCurve, backgroundAnchors };
  }
  return { profile, backgroundCurve };
}

/** Direct-call fallback (no derived `profile`): the refined TOF shape read off
 *  the parameter list by id (`tof_<key>`, see buildStructureRefinement), with an
 *  isotropic Mustrain folded into Sig-1 as σ_T² ≈ (difC·ε)²·d². */
function tofShapeFromParams(
  params: readonly RefinementParameter[] | undefined,
  instrument: InstrumentParameters | undefined,
): PcrExportOptions["tofShape"] | undefined {
  if (!params || !params.some((p) => p.id.startsWith("tof_") || p.id === "mustrainIso")) return undefined;
  const val = (id: string): number | undefined => params.find((p) => p.id === id)?.value;
  const shape: Record<string, number> = {};
  for (const key of ["sig0", "sig1", "sig2", "sigQ", "alpha0", "alpha1", "beta0", "beta1", "betaQ"] as const) {
    const v = val(`tof_${key}`);
    if (v !== undefined) shape[key] = v;
  }
  // `mustrain` is the ROW's value, 10⁶·ε (×10⁻⁶): × 10⁻⁶ gives ε, then the fold of `powderExtras`.
  const mustrain = val("mustrainIso");
  if (mustrain !== undefined && mustrain > 0 && instrument?.kind === "tof") {
    shape.sig1 = (shape.sig1 ?? 0) + (instrument.difC * mustrain * 1e-6) ** 2;
  }
  return Object.keys(shape).length > 0 ? shape : undefined;
}

/** `n` evenly spaced abscissae from lo to hi, inclusive. */
function linspace(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lo + (i * (hi - lo)) / (n - 1));
}

/** Data span, fitted span and the excluded tails outside the fit range. */
function powderSpan(pattern: PowderPattern, fitRange: BundleOptions["fitRange"]) {
  const xs = pattern.points.map((p) => p.x);
  const { min: xMin, max: xMax } = minMax(xs);
  const lo = fitRange?.min !== undefined && fitRange.min > xMin ? fitRange.min : xMin;
  const hi = fitRange?.max !== undefined && fitRange.max < xMax ? fitRange.max : xMax;
  const inFit = xs.filter((x) => x >= lo && x <= hi);
  const { min: first, max: last } = inFit.length ? minMax(inFit) : { min: xMin, max: xMax };
  const excluded: [number, number][] = [];
  const margin = Math.max(1, (xMax - xMin) * 0.01);
  if (lo > xMin) excluded.push([xMin - margin, lo]);
  if (hi < xMax) excluded.push([hi, xMax + margin]);
  return { xMin, xMax, lo, hi, first, last, excluded, narrowed: excluded.length > 0 };
}

/**
 * The TOF profile for the `.pcr`. FullProf holds the instrument's widths and the
 * sample's in the same functions of d (manual: σ² = (Sig-2 + GSIZ)·d⁴ +
 * (Sig-1 + DST)·d² + Sig-0, γ = (Gam-2 + DSIZ)·d² + (Gam-1 + LStr)·d + Gam-0),
 * and this `.pcr` has no resolution file (Res = 0), so its profile lines are
 * the totals: an instrument file's terms as the fit used them, with the
 * sample's rows added where they act. The Gaussian microstrain ε widens as
 * (difC·ε)²·d², the Lorentzian microstrain M as 10⁻⁶·difC·M·d, the size S as
 * 10⁻⁴·difC/S·d².
 *
 * Units and the two factors: `s.gauss` and `s.lorentz` are the rows' values,
 * microstrain × 10⁶, so 10⁻⁶ turns each into a strain Δd/d; `s.size` is in
 * µm = 10⁴ Å, so 10⁻⁴·d²/S is d²/S with S in Å, the size broadening Δd = d²/S.
 * difC (µs/Å) turns a width in d (Å) into µs. The same terms are in the fit:
 * workflow/powder.ts `tofWidthsAt`. See docs/EQUATIONS.md.
 */
function pcrTofShape(prof: RefinedInstrumentProfile | undefined, instrument: InstrumentParameters | undefined): PcrExportOptions["tofShape"] | undefined {
  const t = prof?.tofProfile;
  if (!t) return undefined;
  const s = prof.tofSample;
  if (!s || instrument?.kind !== "tof") return t;
  const difC = instrument.difC;
  return {
    ...t,
    sig1: t.sig1 + (difC * s.gauss * 1e-6) ** 2,
    gamX: (t.gamX ?? 0) + 1e-6 * difC * s.lorentz,
    gamY: (t.gamY ?? 0) + (s.size !== undefined && s.size > 0 ? (1e-4 * difC) / s.size : 0),
    gamZ: t.gamZ ?? 0,
  };
}

/** FullProf bundle: `.pcr` + data + README (+ verbatim originals when present). */
export function fullprofBundle(structure: StructureModel, dataset: DiffractionDataset, opts: BundleOptions = {}): ZipEntry[] {
  const name = sanitize(opts.name ?? structure.name);
  const sc = isSingleCrystal(dataset);
  const dataName = `${name}.${sc ? "int" : "dat"}`;
  const data = isSingleCrystal(dataset) ? singleCrystalInt(dataset) : powderDataFullProf(dataset, name);
  const wl = radiationWavelength(dataset.radiation);
  const radiationKind = dataset.radiation.kind === "xray" ? "xray" as const : "neutron" as const;
  const phases: PcrPhase[] = [{ structure, ...(opts.primary ?? {}) }, ...(opts.extraPhases ?? [])];
  const base: PcrExportOptions = { title: name, datFile: dataName, radiationKind, phases, ...(wl ? { wavelength: wl } : {}) };
  let pcr: string;
  let narrowed = false;
  if (isSingleCrystal(dataset)) {
    pcr = structureToPcr(structure, { ...base, singleCrystal: true });
  } else {
    const span = powderSpan(dataset, opts.fitRange);
    narrowed = span.narrowed;
    const prof = opts.profile;
    let instrument = opts.instrument;
    if (instrument?.kind === "tof" && prof?.tof) instrument = { ...instrument, ...prof.tof };
    const bank = instprmTwoTheta(opts.rawInstrument?.text);
    const tofShape = pcrTofShape(prof, instrument) ?? tofShapeFromParams(opts.params, opts.instrument);
    const caglioti = prof?.caglioti
      ?? (prof?.peakWidth !== undefined ? { u: 0, v: 0, w: (prof.peakWidth * 100) ** 2 } : undefined);
    pcr = structureToPcr(structure, {
      ...base,
      ...(instrument ? { instrument } : {}),
      dataRange: [span.xMin, span.xMax],
      background: fullprofBackground(dataset, opts, span),
      ...(span.narrowed ? { excluded: span.excluded } : {}),
      ...(prof?.zero !== undefined ? { zero: prof.zero } : {}),
      ...(caglioti ? { caglioti } : {}),
      ...(prof?.lorentzian ? { lorentzian: prof.lorentzian } : {}),
      ...(prof?.axial ? { axial: prof.axial } : {}),
      ...(tofShape ? { tofShape } : {}),
      ...(bank !== undefined ? { twoThetaBank: bank } : {}),
    });
  }
  const entries: ZipEntry[] = [
    { name: `${name}.pcr`, data: pcr },
    { name: dataName, data },
  ];
  // Ship the user's exact originals verbatim (never the .pcr's own names, to
  // avoid clobbering the portable generated files).
  const reserved = new Set([`${name}.pcr`, dataName, "README.txt"]);
  const rawInstrName = addVerbatim(entries, opts.rawInstrument, reserved);
  const rawDataName = addVerbatim(entries, opts.rawData, reserved);
  entries.push({
    name: "README.txt",
    data: fullprofReadme({ name, sc, dataName, phases, opts, narrowed, rawInstrName, rawDataName }),
  });
  return entries;
}

/** Background anchors for the `.pcr`: the refined curve (exact at an
 *  interpolating background's own anchors, else sampled densely enough for
 *  FullProf's linear interpolation), or a windowed-minimum estimate from the
 *  data when no refined background is known. With a fit window the curve is
 *  sampled inside it only: a polynomial extrapolated into the excluded tails
 *  is meaningless (and can go negative). */
function fullprofBackground(
  pattern: PowderPattern,
  opts: BundleOptions,
  span: { readonly first: number; readonly last: number; readonly narrowed: boolean },
): (readonly [number, number])[] {
  const curve = opts.backgroundCurve;
  if (curve && pattern.points.length >= 2) {
    const anchors = opts.backgroundAnchors && !span.narrowed ? opts.backgroundAnchors : linspace(span.first, span.last, 24);
    return anchors.map((x) => [x, curve(x)] as const);
  }
  return windowedMinBackground(pattern);
}

/** Windowed-minimum background estimate (12 anchors) from the observed data. */
function windowedMinBackground(pattern: PowderPattern): (readonly [number, number])[] {
  const pts = pattern.points;
  if (pts.length < 2) return [];
  const nAnchors = 12;
  const background: [number, number][] = [];
  for (let i = 0; i < nAnchors; i++) {
    const lo = Math.floor((i * pts.length) / nAnchors);
    const hi = Math.floor(((i + 1) * pts.length) / nAnchors);
    let yMin = Infinity;
    let xAt = pts[lo]!.x;
    for (let j = lo; j < hi; j++) {
      const p = pts[j]!;
      if (p.yObs < yMin) { yMin = p.yObs; xAt = p.x; }
    }
    if (Number.isFinite(yMin)) background.push([xAt, Math.max(0, yMin)]);
  }
  return background;
}

/** Push a verbatim original file into the bundle under a zip-safe, non-colliding
 *  name; returns the name used (or undefined when there's nothing to add). */
function addVerbatim(
  entries: ZipEntry[],
  file: { readonly name: string; readonly text: string } | undefined,
  reserved: Set<string>,
): string | undefined {
  if (!file) return undefined;
  let out = sanitizeFilename(file.name) || "original.txt";
  while (reserved.has(out)) out = `original_${out}`;
  reserved.add(out);
  entries.push({ name: out, data: file.text });
  return out;
}

/** GSAS-II bundle: a `.cif` per phase + `.instprm` (powder) + data + build_gpx.py + README. */
export function gsas2Bundle(structure: StructureModel, dataset: DiffractionDataset, opts: BundleOptions = {}): ZipEntry[] {
  const name = sanitize(opts.name ?? structure.name);
  const sc = isSingleCrystal(dataset);
  const cif = structureToCif(structure, {
    blockName: name,
    ...(opts.params ? { params: opts.params } : {}),
    ...(opts.bindings ? { bindings: opts.bindings } : {}),
    ...(opts.refinement ? { refinement: opts.refinement } : {}),
    ...(opts.magneticLabel ? { magneticLabel: opts.magneticLabel } : {}),
  });
  const dataName = `${name}.${sc ? "hkl" : "xye"}`;
  const data = isSingleCrystal(dataset) ? singleCrystalHkl(dataset) : powderDataXye(dataset);
  const entries: ZipEntry[] = [{ name: `${name}.cif`, data: cif }, { name: dataName, data }];
  const reserved = new Set([`${name}.cif`, dataName, `${name}.gpx`, `${name}.instprm`, "build_gpx.py", "README.txt"]);

  // Further phases: one CIF each, at their refined values.
  const extraCifs: { cifFile: string; phaseName: string }[] = [];
  (opts.extraPhases ?? []).forEach((ph, i) => {
    const phaseName = sanitize(ph.structure.name || `phase${i + 2}`);
    let cifFile = `${phaseName}.cif`;
    while (reserved.has(cifFile)) cifFile = `phase${i + 2}_${cifFile}`;
    reserved.add(cifFile);
    entries.push({ name: cifFile, data: structureToCif(ph.structure, { blockName: phaseName }) });
    extraCifs.push({ cifFile, phaseName });
  });

  // The instrument, carrying the refined profile in GSAS-II units. A loaded
  // single-bank `.instprm` is patched (every other line kept verbatim) and the
  // untouched original ships alongside; a multi-bank file goes verbatim; with
  // no `.instprm` a complete one is generated from the model + refined profile.
  let instprmFile: string | undefined;
  let instprmMode: InstprmMode | undefined;
  let instNotes: string[] = [];
  let rawInstrName: string | undefined;
  let instprmBank: number | undefined;
  // GSAS-II adds each phase's Size and Mustrain to the instrument's widths. TOF: the sample's rows, where the
  // fit has them. CW: none, written explicitly for every bundle, because X and Y already hold the fit's whole
  // Lorentzian width and GSAS-II's defaults for a new phase (Size 1 µm, Mustrain 1000) would widen every peak.
  const powderInst = sc ? undefined : opts.instrument ?? deriveInstrument(dataset.radiation);
  const cwInst = powderInst && powderInst.kind !== "tof" ? powderInst : undefined;
  const sample = cwInst ? GSAS2_CW_NO_SAMPLE_TERMS : powderInst && opts.profile?.tofSample ? gsas2SampleTerms(opts.profile.tofSample) : undefined;
  if (powderInst) {
    const inst = powderInst;
    const mapped = opts.profile
      ? gsas2InstrumentValues(inst.kind === "tof" ? "tof" : "cw", opts.profile)
      : { values: {}, notes: [] as string[] };
    instNotes = mapped.notes;
    const raw = opts.rawInstrument;
    if (raw && isInstprm(raw.name, raw.text)) {
      // A multi-bank file: the session's bank alone, so that GSAS-II reads the instrument the fit used.
      const oneBank = sessionBankOfInstprm(raw.text, opts.instrument);
      instprmBank = oneBank?.bank;
      const patched = Object.keys(mapped.values).length > 0 ? patchInstprm(oneBank?.text ?? raw.text, mapped.values) : undefined;
      if (patched !== undefined) {
        instprmFile = `${name}.instprm`;
        entries.push({ name: instprmFile, data: patched });
        instprmMode = "patched";
        rawInstrName = addVerbatim(entries, raw, reserved);
      } else {
        instprmFile = sanitizeFilename(raw.name) || `${name}.instprm`;
        while (reserved.has(instprmFile) && instprmFile !== `${name}.instprm`) instprmFile = `original_${instprmFile}`;
        reserved.add(instprmFile);
        entries.push({ name: instprmFile, data: raw.text });
        instprmMode = "verbatim";
        rawInstrName = instprmFile;
        instNotes = [];
      }
    } else {
      instprmFile = `${name}.instprm`;
      entries.push({ name: instprmFile, data: instrumentToInstprm(inst, mapped.values) });
      instprmMode = "generated";
      rawInstrName = addVerbatim(entries, raw, reserved);
    }
  }

  // Fit limits + the refined background as GSAS-II 'lin interpolate' points,
  // spaced from the first to the last fitted point exactly as GSAS-II places them.
  let limits: [number, number] | undefined;
  let background: number[] | undefined;
  if (!isSingleCrystal(dataset)) {
    const span = powderSpan(dataset, opts.fitRange);
    if (span.narrowed) limits = [span.lo, span.hi];
    const curve = opts.backgroundCurve;
    if (curve) {
      const n = opts.backgroundAnchors && !span.narrowed ? opts.backgroundAnchors.length : 20;
      background = linspace(span.first, span.last, Math.max(n, 3)).map((x) => curve(x));
    }
  }
  const hklScale = isSingleCrystal(dataset) ? hklf4ScaleFactor(dataset) : 1;

  // Each phase's March–Dollase texture, set on its powder HAP entry by build_gpx.py
  // (a single-crystal histogram has none, so there it is reported as not carried).
  const poPhases = [
    { phaseName: name, po: opts.primary?.po },
    ...(opts.extraPhases ?? []).map((ph, i) => ({ phaseName: extraCifs[i]!.phaseName, po: ph.po })),
  ];
  const preferredOrientation = !sc && poPhases.some((p) => p.po) ? poPhases.map((p) => p.po) : undefined;
  const textured = poPhases.filter((p): p is { phaseName: string; po: NonNullable<BundlePhase["po"]> } => p.po !== undefined);
  const notExported = [...(opts.notExported ?? []), ...(sc && textured.length ? ["preferred orientation"] : [])];

  entries.push({
    name: "build_gpx.py",
    data: buildGpxScript({
      gpxName: `${name}.gpx`,
      cifFile: `${name}.cif`,
      phaseName: name,
      dataFile: dataName,
      histogramKind: sc ? "single" : "powder",
      ...(extraCifs.length ? { extraPhases: extraCifs } : {}),
      ...(instprmFile ? { instprmFile } : {}),
      ...(sc ? { dataFmthint: "HKLF" } : {}),
      ...(limits ? { limits } : {}),
      ...(background ? { background } : {}),
      ...(sample ? { sample } : {}),
      ...(cwInst ? { sampleOff: true } : {}),
      ...(preferredOrientation ? { preferredOrientation } : {}),
    }),
  });
  const rawDataName = addVerbatim(entries, opts.rawData, reserved);
  entries.push({
    name: "README.txt",
    data: gsas2Readme({
      name, sc, dataName, instprmFile, instprmMode, rawInstrName, rawDataName, instNotes, instprmBank, sample,
      ...(cwInst ? { cwWavelength: cwInst.wavelength } : {}),
      preferredOrientation: sc ? [] : textured,
      extraCifs: extraCifs.map((c) => c.cifFile), limits, background: background !== undefined, hklScale,
      ...(opts.instrumentNote ? { instrumentNote: opts.instrumentNote } : {}),
      notExported, magnetic: opts.magneticLabel !== undefined,
      refinementNote: opts.refinement?.specialDetails,
    }),
  });
  return entries;
}

type InstprmMode = "patched" | "verbatim" | "generated";

/** A space-group symbol carrying an origin/setting suffix ("F d -3 m:2"). */
function hasSettingSuffix(structure: StructureModel): boolean {
  return /:/.test(structure.spaceGroup.hermannMauguin ?? "");
}

/** A README's lines for a statement about how the fit was run (RefinementResult.methodNote); none without one. */
function refinementNoteLines(note: string | undefined): string[] {
  return note ? [`How the fit behind these values was run: ${note}`, ``] : [];
}

function fullprofReadme(r: {
  name: string;
  sc: boolean;
  dataName: string;
  phases: readonly PcrPhase[];
  opts: BundleOptions;
  narrowed: boolean;
  rawInstrName: string | undefined;
  rawDataName: string | undefined;
}): string {
  const { name, sc, dataName, phases, opts } = r;
  const lines = [
    `FullProf bundle for ${name} — generated by MATERIA Workbench.`,
    ``,
    ...refinementNoteLines(opts.refinement?.specialDetails),
    `Files:`,
    `  ${name}.pcr   control file: ${phases.length} phase${phases.length > 1 ? "s" : ""} (cell, space group, atoms${sc ? "" : ", profile"}).`,
    `  ${dataName}   ${sc ? "single-crystal reflections (h k l F² σ cod), FullProf .int" : "powder data (X, Yobs, σ) with an XYDATA header — Ins = 10"}.`,
  ];
  if (r.rawInstrName) lines.push(`  ${r.rawInstrName}   your original instrument file, verbatim (for reference or the .pcr Irf).`);
  if (r.rawDataName) lines.push(`  ${r.rawDataName}   your original data file, verbatim (the exact input; ${dataName} is the portable re-serialization).`);
  lines.push(
    ``,
    `Run:  fp2k ${name}   (reads ${name}.pcr + ${dataName}; or open the .pcr in WinPLOTR / EdPCR).`,
    ``,
    `What carries over (refined values, all refinement codes 0):`,
    `  - every phase's cell, positions, ADPs (anisotropic as beta_ij, N_t = 2) and occupancies.`,
    `    Occ is in FullProf's convention: site fraction × m_site / m_general.`,
  );
  if (!sc) {
    lines.push(
      `  - zero shift, peak shape (${opts.instrument?.kind === "tof" ? "TOF Sig/alpha/beta, Npr 9" : "Caglioti U,V,W + Lorentzian X,Y + S_L/D_L, Npr 7"}),`,
      `    ${opts.instrument?.kind === "tof" ? "TOF calibration (Dtt1/Dtt2/Dtt_1overd)" : "wavelength"}, preferred orientation,`,
      `  - background as ${opts.backgroundCurve ? "the refined curve sampled at interpolation points" : "a data-minimum estimate (no refined background given)"}${r.narrowed ? "," : "."}`,
    );
    if (r.narrowed) lines.push(`  - the fit range, as excluded regions.`);
  }
  lines.push(
    ``,
    `Refine first in FullProf:`,
    `  - scale factor(s): FullProf's scale has different units (cell volume, scattering-length`,
    `    units), so the value is only a starting point — free the scale before comparing R-factors.`,
  );
  if (!sc && opts.instrument?.kind !== "tof") {
    lines.push(`  - X-ray data: check Cthm/Rpolarz (monochromator polarization) for your geometry.`);
  }
  const sigQ = opts.profile?.tofProfile?.sigQ ?? (opts.instrument?.kind === "tof" ? opts.instrument.sigQ : undefined) ?? 0;
  if (!sc && sigQ !== 0) {
    lines.push(
      `  - Sig-0 / Sig-1: the fit has a Gaussian term sigma^2 += ${+sigQ.toPrecision(6)}·d (GSAS-II sig-q), but`,
      `    FullProf's Sig-Q d-dependence is undocumented, so it was left 0 — refine Sig-0/Sig-1 to absorb it.`,
    );
  }
  // A fit made with an instrument file's profile: what the .pcr's profile lines hold, and what they cannot.
  const tp = opts.profile?.tofProfile;
  const ts = opts.profile?.tofSample;
  if (!sc && tp && ts) {
    const added = [
      ...(ts.gauss !== 0 ? [`its Gaussian microstrain ${+ts.gauss.toPrecision(8)} (x 1e-6) in Sig-1`] : []),
      ...(ts.lorentz !== 0 ? [`its Lorentzian microstrain ${+ts.lorentz.toPrecision(8)} (x 1e-6) in Gam-1`] : []),
      ...(ts.size !== undefined ? [`its size ${+ts.size.toPrecision(8)} um in Gam-2`] : []),
    ];
    lines.push(
      ``,
      `Peak profile: the .pcr's Sig-2, Sig-1, Sig-0, Gam-2, Gam-1, Gam-0 and alph0, beta0, alph1, beta1 are the`,
      `widths the fit used, as totals (no resolution file is named: Res = 0).${added.length ? ` The sample's broadening is` : ""}`,
      ...(added.length ? [`added where it acts: ${added.join("; ")}.`] : []),
    );
    if (opts.profile?.tofLorentzForm === "fullprof") {
      lines.push(
        `The fit evaluated your FullProf resolution file with FullProf's NPROF 9 function as its documentation gives`,
        `it; that reading, its Lorentzian part and alph0 above all, is not yet checked against a FullProf run.`,
        `To use your .irf as the resolution file instead, set Res = 5, name it, and zero these lines (they are then`,
        `shifts added to the file's values).`,
      );
    } else {
      lines.push(
        `The fit used a GSAS-II instrument file, evaluated with GSAS-II's time-of-flight function. The widths mean`,
        `the same in FullProf (X, Y, Z are Gam-1, Gam-2, Gam-0), but FullProf's function for the Lorentzian part is`,
        `its own: the peak is a starting point in FullProf, not the same peak. Refine the profile there against a`,
        `standard.`,
      );
    }
  }
  if (opts.instrumentNote) lines.push(``, `Instrument file: ${opts.instrumentNote}`);
  if (opts.notExported && opts.notExported.length) {
    lines.push(``, `Not carried by this file (re-add in FullProf if needed): ${opts.notExported.join(", ")}.`);
  }
  if (phases.some((p) => hasSettingSuffix(p.structure))) {
    lines.push(``, `Space-group setting: a symbol with an origin/setting suffix (e.g. ":2") was written as-is;`, `confirm FullProf picks the same origin choice as the CIF.`);
  }
  lines.push(``);
  return lines.join("\n");
}

function gsas2Readme(r: {
  name: string;
  sc: boolean;
  dataName: string;
  instprmFile: string | undefined;
  instprmMode: InstprmMode | undefined;
  rawInstrName: string | undefined;
  rawDataName: string | undefined;
  instNotes: readonly string[];
  /** The bank of a multi-bank `.instprm` the bundle's instrument is. */
  instprmBank?: number | undefined;
  /** GSAS-II's sample terms written into build_gpx.py: the sample's TOF broadening, or none on constant wavelength. */
  sample?: { readonly mustrain: number; readonly mustrainMix: number; readonly size: number } | undefined;
  /** The wavelength (Å) of a constant-wavelength bundle, whose sample terms are written as none. */
  cwWavelength?: number;
  /** The phases whose March–Dollase texture build_gpx.py sets. */
  preferredOrientation: readonly { readonly phaseName: string; readonly po: NonNullable<BundlePhase["po"]> }[];
  extraCifs: readonly string[];
  limits: readonly [number, number] | undefined;
  background: boolean;
  hklScale: number;
  notExported: readonly string[];
  instrumentNote?: string;
  magnetic: boolean;
  /** A statement about how the fit was run (the result's `methodNote`). */
  refinementNote?: string | undefined;
}): string {
  const { name, sc, dataName } = r;
  const phases = [`${name}.cif`, ...r.extraCifs].join(", ");
  const instImport = sc || !r.instprmFile ? "" : `, ${r.instprmFile} (instrument)`;
  const lines = [
    `GSAS-II bundle for ${name} — generated by MATERIA Workbench.`,
    ``,
    ...refinementNoteLines(r.refinementNote),
    `Option A — script (recommended): run  python build_gpx.py  (needs GSAS-II) to`,
    `           assemble ${name}.gpx via GSASIIscriptable${sc ? "" : ", with the fit limits and background set"}.`,
    `Option B — GUI: import ${phases} (phase${r.extraCifs.length ? "s" : ""})${instImport} and ${dataName} (data).`,
    ``,
    `The .gpx is a GSAS-II internal (pickled) project, so it is built by the`,
    `script rather than written directly.`,
  ];
  if (r.instprmMode === "patched") {
    lines.push(``, `Instrument: ${r.instprmFile} is ${r.instprmBank !== undefined ? `bank ${r.instprmBank} of your original .instprm (the bank this fit used)` : "your original .instprm"} with the refined profile`, `(zero, peak shape${sc ? "" : ", calibration"}) written in; every other line is unchanged.`, `The untouched original is ${r.rawInstrName}.`);
  } else if (r.instprmMode === "verbatim") {
    lines.push(``, `Instrument: ${r.instprmFile} is your original .instprm, used verbatim (a multi-bank`, `file is not patched) — refine the profile in GSAS-II before comparing.`);
  } else if (r.instprmMode === "generated") {
    lines.push(``, `Instrument: ${r.instprmFile} was generated from the refined instrument model.`);
    if (r.rawInstrName) lines.push(`Your original instrument file is included verbatim as ${r.rawInstrName}.`);
  }
  if (r.sample && r.cwWavelength !== undefined) {
    // GSAS-II's window takes a typed Size from 0 to 10 µm only (GSASIIddataGUI IsoSizer, checked by running its
    // NumberValidator: 1e6 is refused, 0 is accepted and is a division by zero). At 10 µm the size term is
    // 1.8·λ/(π·10·cosθ) centidegrees.
    const atTen = (1.8 * r.cwWavelength) / (Math.PI * 10);
    const none = +r.sample.size.toPrecision(8);
    // A uniaxial size or microstrain model is the one Lorentzian width the fit has apart from X and Y.
    const apart = [KIND_NAMES.anisoSizePerp!, KIND_NAMES.mustrainPerp!].filter((n) => r.notExported.includes(n));
    lines.push(
      ``,
      `Sample broadening: in this constant-wavelength fit, X and Y of ${r.instprmFile} hold the whole Lorentzian`,
      `width, instrument and sample together${apart.length ? ` (but for the fit's ${apart.join(" and ")}, not carried: see below)` : ""}. GSAS-II adds each phase's Size and Mustrain to X and Y, and a new`,
      `phase starts at Size 1 um and Mustrain 1000, which widen every peak. So build_gpx.py sets every phase's`,
      `Mustrain to ${+r.sample.mustrain.toPrecision(8)} (LGmix ${+r.sample.mustrainMix.toPrecision(8)}) and its Size to ${none} um, which is no size broadening: GSAS-II then`,
      `calculates the widths of the fit.`,
      `An import through the GUI (Option B) starts from GSAS-II's defaults instead: set Mustrain to 0 there. For`,
      `Size the window takes 10 um at most (never enter 0), which still adds ${+atTen.toPrecision(3)}/cos(theta) centidegrees`,
      `at this wavelength; the script is exact.`,
      `Before refining Size in GSAS-II, enter a finite value (at ${none} um its derivative is zero).`,
    );
  } else if (r.sample) {
    lines.push(
      ``,
      `Sample broadening: build_gpx.py sets every phase's Mustrain to ${+r.sample.mustrain.toPrecision(8)} (x 1e-6) with`,
      `Lorentzian fraction ${+r.sample.mustrainMix.toPrecision(8)}, and Size to ${+r.sample.size.toPrecision(8)} um (Lorentzian): the values MATERIA added`,
      `to the instrument's widths. An import through the GUI starts from GSAS-II's own defaults`,
      `(Mustrain 1000, Size 1 um); enter these values there.`,
    );
  }
  if (r.preferredOrientation.length) {
    lines.push(
      ``,
      `Preferred orientation: build_gpx.py sets GSAS-II's March-Dollase model ('MD', not refined) as MATERIA refined it:`,
      ...r.preferredOrientation.map(({ phaseName, po }) =>
        `  - ${phaseName}: ratio ${+po.ratio.toPrecision(8)} on the reciprocal-lattice axis [${po.axis.map((x) => +x.toPrecision(8)).join(" ")}].`),
      `An import through the GUI starts from no preferred orientation (ratio 1); enter these values there.`,
    );
  }
  if (r.instNotes.length) lines.push(``, `Profile terms GSAS-II cannot express:`, ...r.instNotes.map((n) => `  - ${n}`));
  if (!sc) {
    if (r.limits) lines.push(``, `Fit limits ${+r.limits[0].toPrecision(8)} – ${+r.limits[1].toPrecision(8)} are set by build_gpx.py.`);
    if (r.background) lines.push(``, `Background: the refined curve, as GSAS-II 'lin interpolate' points (set by build_gpx.py, not refined).`);
  }
  if (sc && r.hklScale !== 1) {
    lines.push(``, `Intensities in ${dataName} are multiplied by ${r.hklScale} to fit SHELX HKLF4's fixed F8.2 columns;`, `only the scale factor absorbs this.`);
  }
  if (r.instrumentNote) lines.push(``, `Instrument file: ${r.instrumentNote}`);
  lines.push(``, `Refine first in GSAS-II: the histogram scale / phase fractions (not transferred).`);
  if (r.notExported.length) lines.push(``, `Not carried by these files (re-add in GSAS-II if needed): ${r.notExported.join(", ")}.`);
  if (r.magnetic) lines.push(``, `${name}.cif is a magnetic CIF: import it as a magnetic phase in GSAS-II.`);
  if (r.rawDataName) lines.push(``, `Your original data file is included verbatim as ${r.rawDataName} (the exact input;`, `${dataName} is the portable re-serialization the script imports).`);
  lines.push(``);
  return lines.join("\n");
}
