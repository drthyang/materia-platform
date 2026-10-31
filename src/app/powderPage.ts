/**
 * The powder page without React: what its controls do to the session, the
 * curves and agreement it shows, and the fits it runs, as plain functions.
 *
 * The workbench (PowderWorkbench.tsx) calls these from its handlers and hooks,
 * and the Agent's headless page (testSupport/agentHeadless.ts) calls the same
 * functions with the same compute client running in-thread. So the evals and
 * the validation run the page's own operations, not a copy of them: a copy
 * once refined the whole pattern after the Agent set a fit window, and its
 * Prefit was a plain refine (docs/AGENT_REVIEW.md).
 */

import { withTieValues } from "@/core/refinement/constraints";
import { siteSumConstraints } from "@/core/workflow/structureRefinement";
import type { StructureModel } from "@/core/crystal/types";
import type { ParameterBinding, RefinementOptions, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { isMagneticModelParameterKind, isMomentParameterKind } from "@/core/refinement/types";
import { powderCurves, type PowderCurves } from "@/core/workflow/powder";
import { buildMagneticPowderProblem, magneticComponentCurve } from "@/core/workflow/magneticPowder";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { multiPhaseCurves } from "@/core/workflow/multiPhase";
import { applyParameters } from "@/core/workflow/apply";
import { isUserTie, withEqualTies, type EqualTieUpdate } from "@/core/refinement/constraints";
import { activeZeroAdpFixes, withFixRecorded, withZeroAdpProposal, zeroAdpFix, zeroAdpProposals, type ZeroAdpFix, type ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";
import type { PeakShape } from "@/core/diffraction/profile";
import { evaluateBackground, interpAnchors, type BackgroundType } from "@/core/diffraction/background";
import { instrumentBackgroundDefault } from "@/core/workflow/backgroundDefaults";
import { excludedPointMask } from "@/core/refinement/factors";
import { radiationOf, withConstants, type InstrumentConstants, type InstrumentParameters } from "@/core/diffraction/instrument";
import { withAntisite } from "@/core/crystal/antisite";
import { withAdpModel } from "@/core/crystal/adp";
import { momentKickFloor } from "@/core/magnetic/canonicalize";
import type { SampleOptions, SampleResult } from "@/core/refinement/bayes/sampler";
import type { ComputeClient, MagneticMultiStartResult } from "@/workers/computeClient";
import type { PowderProgress } from "@/workers/runPowder";
import type { MultiStartResult } from "@/core/refinement/multiStart";
import { buildPowderSpec, powderRestraints, type CorrectionsUpdate, type MustrainModel, type SampleCorrections, type SiteTies } from "@/app/powderSpec";
import {
  buildSpecFor, carryRefinedStructure, DEFAULT_BACKGROUND_TERMS, DEFAULT_INSTRUMENT, EMPTY_SOURCE, emptySession, keptBindings, keptRow, keptRows, newSession, SYNTHETIC_SOURCE,
  withMagneticRows, withValidUserTies, type Session,
} from "@/app/powderSession";
import { rowsForPhases } from "@/app/multiPhaseSpec";
import { startingPowderParams } from "@/app/loadData";
import { powderBindings } from "@/examples/synthetic";
import type { PowderPattern } from "@/core/diffraction/types";
import type { MagneticFit, ResidualPeak } from "@/app/magneticStep";
import { noiseOf } from "@/core/magnetic/momentRestarts";
import { momentBindingKey, type MagneticModel } from "@/core/magnetic/types";
import type { Vec3 } from "@/core/math/types";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { fitAmplitudesToMoments } from "@/core/magnetic/amplitudeFit";
import { identifyMagneticGroup, formatMagneticSymbol } from "@/core/magnetic/bnsOg";
import { kLabel } from "@/core/magnetic/kSearch";
import { refine } from "@/core/refinement/engine";
import { generateReflections } from "@/core/diffraction/reflections";
import { annotateExtraPeaks, detectExtraPeaks } from "@/core/magnetic/extraPeaks";
import { axisContext, availableDisplayUnits, convertAxisArray, convertAxisValue, tofCalibrationOf, type AxisContext } from "@/visualization/axisUnits";
import { minMax } from "@/core/math/extent";

/** The fit window on the pattern's own axis. */
export interface FitWindow {
  readonly min: number;
  readonly max: number;
}

/** What a fit on the page depends on beyond the session. */
export interface PowderPageModel {
  readonly session: Session;
  /** The instrument the parameter set is built with: the loaded one, or the default. */
  readonly instrument: InstrumentParameters;
  /** The fit window when it narrows the pattern; null: the whole pattern. */
  readonly fitRange: FitWindow | null;
  /** The last refinement's result; null before the first fit or after a model change. */
  readonly result: RefinementResult | null;
}

/**
 * The powder page as the shell holds it: the session, the instrument, and the
 * last fit's result. The shell parses files and routes them here; what a load
 * or a control does to the page, the result included, is this module's.
 */
export interface PowderPage {
  readonly session: Session;
  /** The instrument file loaded, or the default while none is. */
  readonly instrument: InstrumentParameters;
  readonly instrumentLoaded: boolean;
  /** The last refinement's result; null before the first fit and after any change that makes it out of date. */
  readonly result: RefinementResult | null;
  /**
   * A converged fit the page opened on without a result of its own (a bundled
   * demo's snapshot): every row's value as it opened. The Validation view reads
   * the fit as converged while the rows still hold these values; a change of
   * the model (`changed`) or a fit (`withFit`) drops it.
   */
  readonly snapshot?: PowderSnapshot;
}

/** The values a converged snapshot opened with, by parameter id. */
export interface PowderSnapshot {
  readonly values: Readonly<Record<string, number>>;
}

/** The page's rows as a converged snapshot: what a demo that opens on a finished fit records. */
export function snapshotOf(s: Session): PowderSnapshot {
  return { values: Object.fromEntries(s.powderParams.map((p) => [p.id, p.value])) };
}

/** The page still shows its snapshot: the same rows, each at the value it opened with. */
export function snapshotHolds(p: Pick<PowderPage, "session" | "snapshot">): boolean {
  const snap = p.snapshot;
  if (!snap) return false;
  const rows = p.session.powderParams;
  return rows.length === Object.keys(snap.values).length && rows.every((r) => snap.values[r.id] === r.value);
}

/** The clean, data-less page the app opens on. */
export function emptyPage(): PowderPage {
  return { session: emptySession(), instrument: DEFAULT_INSTRUMENT, instrumentLoaded: false, result: null };
}

/** The instrument the page's rows are built with: the loaded one, or the default. */
export function specInstrumentOf(p: PowderPage): InstrumentParameters {
  return p.instrumentLoaded ? p.instrument : DEFAULT_INSTRUMENT;
}

/** A change of the model, the data or a setting: the last fit's result (and a snapshot the page opened on) no longer describes the page, so it goes. */
export function changed(p: PowderPage, session: Session): PowderPage {
  const { snapshot: _snapshot, ...rest } = p;
  return { ...rest, session, result: null };
}

/** A fit on the page: its values on the rows, its result on the page (in place of a snapshot it opened on). */
export function withFit(p: PowderPage, result: RefinementResult): PowderPage {
  const { snapshot: _snapshot, ...rest } = p;
  return { ...rest, session: withFitResult(p.session, result), result };
}

/** The compute client's calls the page makes. */
export type PowderCompute = Pick<
  ComputeClient,
  "refinePowderParallel" | "refineMagneticPowderParallel" | "leBailPrefit" | "refinePowderMultiStart" | "refineMagneticPowderMultiStart" | "samplePowderPosterior" | "sampleMagneticPowderPosterior"
>;

// ── what the controls do to the session ────────────────────────────────────

/** The spec rebuilt for a changed structure, ties or settings: every row keeps its value and state, new rows come in as the spec seeds them. */
function rebuilt(s: Session, instrument: InstrumentParameters, change: { structure?: StructureModel; backgroundTerms?: number; siteTies?: SiteTies; mustrain?: MustrainModel }): Session {
  const structure = change.structure ?? s.structure;
  const backgroundTerms = change.backgroundTerms ?? s.backgroundTerms;
  const siteTies = change.siteTies ?? s.siteTies;
  const mustrain = change.mustrain ?? s.mustrain ?? "isotropic";
  const spec = buildSpecFor(structure, s.extraPhases, s.pattern, instrument, s.powderProfile.lorentz ?? true, backgroundTerms, siteTies, mustrain, s.corrections, s.powderProfile.backgroundType);
  return {
    ...s,
    structure,
    backgroundTerms,
    siteTies,
    ...(change.mustrain ? { mustrain: change.mustrain } : {}),
    powderParams: keptRows(spec.params, s.powderParams),
    powderBindings: keptBindings(spec.bindings, s.powderBindings),
    powderProfile: { ...spec.profile, ...(s.powderProfile.backgroundType ? { backgroundType: s.powderProfile.backgroundType } : {}) },
  };
}

/** Change the smooth-background basis (reinterprets the same coefficients). */
export function withBackgroundType(s: Session, backgroundType: BackgroundType): Session {
  // Interpolation coefficients are background *heights* at anchor points, so
  // switching to/from a polynomial basis reseeds them: flatten to the current
  // constant level for interpolation, or c0 + zeros for a polynomial.
  const isInterp = backgroundType === "linInterpolate" || backgroundType === "logInterpolate";
  const wasInterp = s.powderProfile.backgroundType === "linInterpolate" || s.powderProfile.backgroundType === "logInterpolate";
  if (isInterp === wasInterp) {
    return { ...s, powderProfile: { ...s.powderProfile, backgroundType } };
  }
  const level = s.powderParams.find((p) => p.kind === "background")?.value ?? 0;
  let bIdx = 0;
  const powderParams = s.powderParams.map((p) => {
    if (p.kind !== "background") return p;
    const v = isInterp ? level : bIdx === 0 ? level : 0;
    bIdx++;
    return { ...p, value: v, initialValue: v };
  });
  return { ...s, powderParams, powderProfile: { ...s.powderProfile, backgroundType } };
}

/** How many background coefficients the page takes: at least one, as the project file needs (docs/PROJECT_FORMAT.md). */
export const BACKGROUND_TERMS = { min: 1, max: 24 } as const;

/**
 * The count an entry in the terms field asks for, or null while it asks for
 * none: the field emptied to retype it (`Number("")` is 0), 0, a fraction, or
 * more than 24. The field waits on null instead of applying it.
 */
export function backgroundTermsEntry(raw: string): number | null {
  const n = raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= BACKGROUND_TERMS.min && n <= BACKGROUND_TERMS.max ? n : null;
}

/**
 * Change the number of background coefficients (1–24), keeping every other row
 * and the background type. Never none: 0 took every background row, and with
 * them the Background group and its function and terms controls, off the
 * parameter panel. An interpolation basis's coefficients are heights at
 * points that move with their number, so they are read off the current curve at
 * the new points: the background keeps its shape instead of each height landing
 * at another point.
 */
export function withBackgroundTerms(s: Session, n: number, instrument: InstrumentParameters): Session {
  // Not a count (NaN would build no rows either): the session as it is.
  if (!Number.isFinite(n)) return s;
  const next = rebuilt(s, instrument, { backgroundTerms: Math.max(BACKGROUND_TERMS.min, Math.min(BACKGROUND_TERMS.max, Math.trunc(n))) });
  const type = s.powderProfile.backgroundType;
  if ((type !== "linInterpolate" && type !== "logInterpolate") || next.backgroundTerms === s.backgroundTerms) return next;
  const old = s.powderParams.filter((p) => p.kind === "background").map((p) => p.value);
  const { min: xMin, max: xMax } = minMax(s.pattern.points.map((p) => p.x));
  if (old.length === 0 || !(xMax > xMin)) return next;
  const anchors = interpAnchors(next.backgroundTerms, xMin, xMax, type === "logInterpolate");
  let k = 0;
  return {
    ...next,
    powderParams: next.powderParams.map((p) => {
      if (p.kind !== "background") return p;
      const v = evaluateBackground(next.backgroundTerms === 1 ? (xMin + xMax) / 2 : anchors[k]!, old, type, xMin, xMax);
      k++;
      return { ...p, value: v, initialValue: v };
    }),
  };
}

/**
 * Antisite disorder between two sites: each element added on the other site
 * at occupancy 0, sharing its host's position and ADP (each site's occupancies
 * then sum to its total by the shared-site tie), with hold composition on.
 * Every existing row keeps its value and state; the new occupancy rows come in
 * fixed.
 */
export function withAntisitePair(s: Session, siteA: string, siteB: string, instrument: InstrumentParameters): Session {
  return rebuilt(s, instrument, { structure: withAntisite(s.structure, siteA, siteB), siteTies: { ...s.siteTies, composition: true } });
}

/** Another phase in the model (an impurity, the sample environment): its rows come in as the spec seeds them, every other row keeps its value, state and tie. */
export function withPhase(s: Session, phase: StructureModel, instrument: InstrumentParameters): Session {
  return withPhases(s, [...s.extraPhases, phase], instrument);
}

/** An added phase taken out again (by id), the spec rebuilt back down: its rows go, every other row keeps its value, state and tie. */
export function withoutPhase(s: Session, id: string, instrument: InstrumentParameters): Session {
  return withPhases(s, s.extraPhases.filter((p) => p.id !== id), instrument);
}

/**
 * The added phases set to these, the spec rebuilt for them. Each phase's rows
 * follow it to its new ids first (`scale` on one phase is `p0_scale` on
 * several, and a phase after one taken out moves up), so they keep their
 * values: matched by id alone, the main phase came back at the CIF's seeds.
 */
export function withPhases(s: Session, extraPhases: readonly StructureModel[], instrument: InstrumentParameters): Session {
  const spec = buildSpecFor(s.structure, extraPhases, s.pattern, instrument, s.powderProfile.lorentz ?? true, s.backgroundTerms, s.siteTies, s.mustrain ?? "isotropic", s.corrections);
  return {
    ...s,
    extraPhases: [...extraPhases],
    powderParams: keptRows(spec.params, rowsForPhases(s.powderParams, [s.structure, ...s.extraPhases], [s.structure, ...extraPhases])),
    powderBindings: keptBindings(spec.bindings, s.powderBindings),
    powderProfile: { ...spec.profile, ...(s.powderProfile.backgroundType ? { backgroundType: s.powderProfile.backgroundType } : {}) },
  };
}

/**
 * The primary phase refines U tensors: some site is anisotropic. Read from
 * the structure, not from the toggle alone — a CIF with U_aniso columns loads
 * tensors without anyone ticking the box (round 10, NAC on 11-BM).
 */
export function hasTensorAdp(structure: StructureModel): boolean {
  return structure.sites.some((site) => site.adp.kind === "anisotropic");
}

/** Tie parameters of one kind to one refined value, or release such ties (the rows come back fixed at their value). */
export function withParameterTies(s: Session, update: EqualTieUpdate): Session {
  return withZeroAdpPruned({ ...s, powderParams: withEqualTies(s.powderParams, update) });
}

/** One row edited in the parameter panel; a shared site's last occupancy follows the others. */
export function withParameter(s: Session, id: string, patch: Partial<RefinementParameter>): Session {
  const rows = s.powderParams.map((p) => (p.id === id ? { ...p, ...patch } : p));
  const followers = siteSumConstraints(rows).map((c) => c.follower);
  return { ...s, powderParams: followers.length > 0 ? withTieValues(rows, new Set(followers)) : rows };
}

/** Toggle tying position/ADP across shared (disordered) sites, or set the sites' totals (an empty set: every site full). */
export function withSiteTies(s: Session, update: Partial<SiteTies>, instrument: InstrumentParameters): Session {
  const { totals, ...rest } = { ...s.siteTies, ...update };
  return rebuilt(s, instrument, { siteTies: totals && Object.keys(totals).length > 0 ? { ...rest, totals } : rest });
}

/** One shared site's total occupancy (by its key, the first member's label): 1 clears it; below 1 leaves vacancies. Every row keeps its value; the site's last occupancy follows the new total. */
export function withSiteTotal(s: Session, key: string, total: number, instrument: InstrumentParameters): Session {
  const { [key]: _old, ...rest } = s.siteTies.totals ?? {};
  return withSiteTies(s, { totals: total === 1 ? rest : { ...rest, [key]: total } }, instrument);
}

/**
 * The microstrain model: isotropic (Lorentzian Y only), uniaxial (equatorial
 * and axial Y about c), or generalized (Stephens). The new rows seed at the
 * current isotropic strain and come in fixed.
 */
export function withMustrain(s: Session, model: MustrainModel, instrument: InstrumentParameters): Session {
  return rebuilt(s, instrument, { mustrain: model });
}

/**
 * Sample and geometry corrections on or off (peak asymmetry, preferred
 * orientation, displacement, transparency, absorption, roughness). The rows a
 * correction adds come in fixed at their seeds; every other row keeps its
 * value and state. A changed preferred-orientation axis restarts its ratio at 1.
 */
export function withCorrections(s: Session, update: CorrectionsUpdate, instrument: InstrumentParameters): Session {
  const was = s.corrections ?? {};
  const asymmetry = update.asymmetry ?? was.asymmetry ?? false;
  const preferredOrientation = update.preferredOrientation === undefined ? was.preferredOrientation : update.preferredOrientation ?? undefined;
  const peak = update.peak ?? was.peak ?? [];
  const corrections: SampleCorrections = {
    ...(asymmetry ? { asymmetry: true } : {}),
    ...(preferredOrientation ? { preferredOrientation } : {}),
    ...(peak.length > 0 ? { peak } : {}),
  };
  const spec = buildSpecFor(s.structure, s.extraPhases, s.pattern, instrument, s.powderProfile.lorentz ?? true, s.backgroundTerms, s.siteTies, s.mustrain ?? "isotropic", corrections);
  const previous = new Map(s.powderParams.map((p) => [p.id, p]));
  const axisChanged = update.preferredOrientation !== undefined;
  return {
    ...s,
    corrections,
    powderParams: withValidUserTies(withMagneticRows(spec.params.map((p) => {
      const old = previous.get(p.id);
      if (!old || (axisChanged && p.kind === "poRatio")) return { ...p, fixed: true };
      return keptRow(p, old);
    }), s.powderParams)),
    powderBindings: keptBindings(spec.bindings, s.powderBindings),
    powderProfile: { ...spec.profile, ...(s.powderProfile.backgroundType ? { backgroundType: s.powderProfile.backgroundType } : {}) },
  };
}

/**
 * The ADP model, isotropic (B_iso) or anisotropic (U tensor). Promotion seeds
 * each site's spherical U from its current (refined) B_iso, so an isotropic
 * fit is the start of the anisotropic one; every other row keeps its value and
 * state, and only the ADP rows are reseeded.
 */
export function withAnisotropicAdp(s: Session, on: boolean, instrument: InstrumentParameters): Session {
  // Bake the current refined B_iso/U into the base structure's ADPs so the
  // conversion seeds from the converged values (positions/cell stay in the
  // preserved parameters, so they are not double-applied here).
  const values: Record<string, number> = {};
  for (const p of s.powderParams) values[p.id] = p.value;
  const refined = applyParameters(s.structure, s.powderBindings, values).model;
  const refinedAdp = new Map(refined.sites.map((rs) => [rs.label, rs.adp]));
  const seeded = { ...s.structure, sites: s.structure.sites.map((site) => ({ ...site, adp: refinedAdp.get(site.label) ?? site.adp })) };
  const promoted = withAdpModel(seeded, on ? "anisotropic" : "isotropic");
  const spec = buildSpecFor(promoted, s.extraPhases, s.pattern, instrument, s.powderProfile.lorentz ?? true, s.backgroundTerms, s.siteTies, s.mustrain ?? "isotropic", s.corrections);
  const previous = new Map(s.powderParams.map((p) => [p.id, p]));
  return {
    ...s,
    structure: promoted,
    anisotropicAdp: on,
    powderParams: withValidUserTies(withMagneticRows(spec.params.map((p) => {
      // ADP rows are freshly seeded by the rebuild (their ties with them);
      // everything else keeps its current (possibly refined) value and state.
      if (p.kind === "bIso" || p.kind === "uAniso") return p;
      return keptRow(p, previous.get(p.id));
    }), s.powderParams)),
    powderBindings: keptBindings(spec.bindings, s.powderBindings),
    powderProfile: { ...spec.profile, ...(s.powderProfile.backgroundType ? { backgroundType: s.powderProfile.backgroundType } : {}) },
  };
}

/** Every parameter, or those named, back to its starting value (its esd dropped). */
export function withReset(s: Session, ids?: readonly string[]): Session {
  const only = ids ? new Set(ids) : null;
  return {
    ...s,
    powderParams: s.powderParams.map((p) => {
      if (only && !only.has(p.id)) return p;
      const { esd: _esd, ...rest } = p;
      return { ...rest, value: p.initialValue };
    }),
  };
}

/**
 * The B-at-0 rule on the page (core/diagnostics/zeroAdp.ts): a proposal for
 * each free B the fit on the page left on its lower bound, and the fixes the
 * user applied that the rows still carry.
 */
export function zeroAdpOf(p: Pick<PowderPage, "session" | "result">): { proposals: ZeroAdpProposal[]; applied: ZeroAdpFix[] } {
  const s = p.session;
  return {
    proposals: zeroAdpProposals({ parameters: s.powderParams, bindings: s.powderBindings, result: p.result, structures: [s.structure, ...s.extraPhases], refined: refinedPhasesOf(s) }),
    applied: activeZeroAdpFixes(s.powderParams, s.zeroAdpFixes),
  };
}

/** A B-at-0 option the user chose (the preferred one, 0, by default): its tie or held value on the row, and its record. Rule C has none to apply. */
export function withZeroAdpApplied(s: Session, proposal: ZeroAdpProposal, option = 0, how: { readonly chosenBy?: "user" | "agent-auto"; readonly reason?: string } = {}): Session {
  const fix = zeroAdpFix(proposal, option, how);
  return { ...s, powderParams: withZeroAdpProposal(s.powderParams, proposal, option), zeroAdpFixes: withFixRecorded(activeZeroAdpFixes(s.powderParams, s.zeroAdpFixes), fix) };
}

/** The B-at-0 records the rows still carry: one the user overrode (a tie released, the row freed or retyped) goes, so a later tie of their own is never claimed by the rule. */
export function withZeroAdpPruned(s: Session): Session {
  if (!s.zeroAdpFixes?.length) return s;
  const kept = activeZeroAdpFixes(s.powderParams, s.zeroAdpFixes);
  if (kept.length === s.zeroAdpFixes.length) return s;
  const { zeroAdpFixes: _drop, ...rest } = s;
  return kept.length > 0 ? { ...rest, zeroAdpFixes: kept } : rest;
}

/** A B-at-0 fix released: the row free again (a tie released first), at the value it holds now; its record goes. */
export function withZeroAdpReleased(s: Session, parameterId: string): Session {
  const row = s.powderParams.find((p) => p.id === parameterId);
  const untied = row && isUserTie(row) ? withEqualTies(s.powderParams, { release: [parameterId] }) : s.powderParams;
  return {
    ...s,
    powderParams: untied.map((p) => (p.id === parameterId ? { ...p, fixed: false } : p)),
    zeroAdpFixes: (s.zeroAdpFixes ?? []).filter((f) => f.parameterId !== parameterId),
  };
}

/** Free or fix rows by id. */
export function withFixed(s: Session, changes: readonly { readonly id: string; readonly fixed: boolean }[]): Session {
  const fixed = new Map(changes.map((c) => [c.id, c.fixed]));
  return withZeroAdpPruned({ ...s, powderParams: s.powderParams.map((p) => (fixed.has(p.id) ? { ...p, fixed: fixed.get(p.id)! } : p)) });
}

// ── files loaded onto the page ─────────────────────────────────────────────

/** A file as the page keeps it, verbatim (bundles ship it as the original). */
export interface LoadedFile {
  readonly name: string;
  readonly text: string;
}

/** GSAS-II's own calc and background, shown with a view-only TOF pattern. */
export type PatternOverlay = NonNullable<Session["powderOverlay"]>;

/** The page holds data: a file's or a demo's, not the landing's placeholder or a structure's synthetic pattern. */
function hasData(s: Session): boolean {
  return s.powderSource !== EMPTY_SOURCE && s.powderSource !== SYNTHETIC_SOURCE;
}

/**
 * The rows of a structure on a pattern: the spec the page refines, or, for
 * TOF data the page cannot refine (no TOF calibration loaded, or GSAS-II's
 * own calc shown with it), the view-only rows. Constant-wavelength data take
 * a constant-wavelength instrument when one is loaded, else the default.
 */
function rowsOn(
  p: PowderPage,
  structure: StructureModel,
  pattern: PowderPattern,
  settings: { readonly lorentz: boolean; readonly backgroundTerms: number; readonly backgroundType?: BackgroundType; readonly siteTies: SiteTies },
  overlay: boolean,
): { params: RefinementParameter[]; bindings: ParameterBinding[]; profile: Session["powderProfile"]; viewOnly: boolean } {
  const { lorentz, backgroundTerms, backgroundType, siteTies } = settings;
  if (pattern.xUnit === "tof") {
    const tof = p.instrumentLoaded && p.instrument.kind === "tof" ? p.instrument : null;
    if (overlay || !tof) {
      const bindings = powderBindings(structure, pattern.id);
      return { params: startingPowderParams(structure, pattern, bindings), bindings, profile: { shape: "gaussian" }, viewOnly: true };
    }
    return { ...buildPowderSpec(structure, pattern, tof, lorentz, backgroundTerms, siteTies, undefined, undefined, backgroundType), viewOnly: false };
  }
  const cw = p.instrumentLoaded && p.instrument.kind === "constantWavelength" ? p.instrument : DEFAULT_INSTRUMENT;
  return { ...buildPowderSpec(structure, pattern, cw, lorentz, backgroundTerms, siteTies, undefined, undefined, backgroundType), viewOnly: false };
}

/**
 * The background new data, a new instrument or a new model start on: the
 * instrument's default where it has one (backgroundDefaults.ts: POWGEN TOF,
 * log interpolate with three points), else the general one, Chebyshev with the
 * page's count — the general default's count when the page was on POWGEN's.
 * The rebuilds that keep the data (a term count, a phase, a correction) keep
 * the page's own background instead, so do a saved project and the demos.
 */
function startingBackground(pattern: PowderPattern, p: PowderPage, previous: { readonly pattern: PowderPattern; readonly page: PowderPage; readonly terms: number }): { readonly type?: BackgroundType; readonly terms: number } {
  const own = instrumentBackgroundDefault(pattern, p.instrumentLoaded ? p.instrument : null);
  if (own) return own;
  const wasOwn = instrumentBackgroundDefault(previous.pattern, previous.page.instrumentLoaded ? previous.page.instrument : null);
  return { terms: wasOwn ? DEFAULT_BACKGROUND_TERMS : previous.terms };
}

/**
 * A structure file (a CIF, a magnetic CIF, a SHELX .ins) as the page's model.
 * On data, its rows are built on those data with the page's instrument;
 * without, on a synthetic pattern of it. Either way the model starts afresh:
 * one phase, the default settings, its own magnetic model or none. The
 * instrument file stays with the instrument.
 */
export function withStructure(p: PowderPage, structure: StructureModel, magnetic?: MagneticModel): PowderPage {
  const s = p.session;
  // A file's magnetic model (an mCIF) comes with its moments as rows, held (THY-45).
  const model = magnetic ? fileMomentRows(structure, magnetic) : null;
  const magneticPart = (session: Session): Session => (model ? withHeldMagneticRows(session, model) : session);
  const fresh: Session = {
    ...newSession(structure, p.instrument),
    ...(magnetic ? { magnetic: model?.magnetic ?? magnetic } : {}),
    ...(p.instrumentLoaded && s.rawInstrument ? { rawInstrument: s.rawInstrument } : {}),
  };
  if (!hasData(s)) return changed(p, magneticPart(fresh));
  const background = startingBackground(s.pattern, p, { pattern: s.pattern, page: p, terms: fresh.backgroundTerms });
  const rows = rowsOn(p, structure, s.pattern, { lorentz: s.powderProfile.lorentz ?? true, backgroundTerms: background.terms, ...(background.type ? { backgroundType: background.type } : {}), siteTies: fresh.siteTies }, !!s.powderOverlay);
  return changed(p, magneticPart({
    ...fresh,
    backgroundTerms: background.terms,
    pattern: s.pattern,
    powderParams: rows.params,
    powderBindings: rows.bindings,
    powderProfile: rows.profile,
    powderOverlay: s.powderOverlay ?? null,
    powderSource: s.powderSource,
    ...(s.rawData ? { rawData: s.rawData } : {}),
  }));
}

/** A magnetic model with the rows that drive its moments. */
export interface MagneticRows {
  readonly magnetic: MagneticModel;
  readonly params: RefinementParameter[];
  readonly bindings: ParameterBinding[];
}

/**
 * A magnetic model read from a file (an mCIF) as rows: its moments over the
 * symmetry modes its own magnetic group allows on each site (the magnetic
 * page's moment model), at the file's values, every row held. The owner's
 * rule: the moments refine with the nuclear model held, so nothing is freed on
 * load. Null when the file has no operations or its moments are not a
 * combination of the allowed modes (the model then stays on show without rows,
 * as before).
 */
export function fileMomentRows(structure: StructureModel, magnetic: MagneticModel): MagneticRows | null {
  if (!magnetic.operations || magnetic.moments.length === 0) return null;
  const k = magnetic.propagation[0] ?? [0, 0, 0];
  const ions = [...new Set(magnetic.moments.map((m) => m.siteLabel))].filter((l) => structure.sites.some((site) => site.label === l));
  if (ions.length === 0) return null;
  let build: ReturnType<typeof buildMagneticModel>;
  try {
    build = buildMagneticModel(structure, k, ions, magnetic.operations, { tieSameSite: false });
  } catch {
    return null;
  }
  if (build.params.length === 0) return null;
  const fit = fitAmplitudesToMoments(build, magnetic);
  const largest = Math.max(1, ...magnetic.moments.flatMap((m) => m.components.map(Math.abs)));
  if (!(fit.maxMisfit <= 1e-3 * largest)) return null;
  const params = build.params.map((p) => {
    const v = fit.values[p.id] ?? p.value;
    return { ...p, value: v, initialValue: v, fixed: true };
  });
  // The file's own model where the rows address its moments as they are (they reproduce them); the build's where it splits a site.
  const fileKeys = new Set(magnetic.moments.map(momentBindingKey));
  if (build.magnetic.moments.every((m) => fileKeys.has(momentBindingKey(m)))) return { magnetic, params, bindings: build.bindings.map((b) => (b.targetId === build.magnetic.id ? { ...b, targetId: magnetic.id } : b)) };
  const values = Object.fromEntries(params.map((p) => [p.id, p.value]));
  return { magnetic: { ...applyMagneticMoments(build.magnetic, build.bindings, values), id: magnetic.id, structureId: magnetic.structureId }, params, bindings: build.bindings };
}

/** The session with this model and its rows, held, in place of any earlier model's. */
function withHeldMagneticRows(s: Session, model: MagneticRows): Session {
  return {
    ...s,
    magnetic: model.magnetic,
    powderParams: [...s.powderParams.filter((p) => !isMagneticModelParameterKind(p.kind)), ...model.params.map((p) => ({ ...p, fixed: true }))],
    powderBindings: [...s.powderBindings.filter((b) => !isMagneticModelParameterKind(b.kind)), ...model.bindings],
  };
}

/** What the Structure card's chip and the magnetic page say of the applied model: its k and its magnetic group. */
export interface MagneticModelSummary {
  readonly k: Vec3;
  readonly kLabel: string;
  /** The BNS symbol where the operations are a tabulated group in its standard setting; else the file's name for it; else null. */
  readonly group: string | null;
  /** Moment rows on the page, and how many of them are free. */
  readonly rows: number;
  readonly free: number;
  /** The moments put intensity in the calculated pattern (not all zero). */
  readonly inCalc: boolean;
}

/** The applied magnetic model's summary, or null without one. `live`: the model at the rows' current values (the page's liveMagnetic), when the caller has it. */
export function magneticModelSummary(s: Session, live?: MagneticModel | null): MagneticModelSummary | null {
  const mag = live ?? s.magnetic;
  if (!mag || mag.moments.length === 0) return null;
  const k = mag.propagation[0] ?? [0, 0, 0];
  let group: string | null = null;
  if (mag.operations) {
    const id = identifyMagneticGroup(mag.operations);
    if (id) group = formatMagneticSymbol(id.bnsSymbol);
    else if (s.structure.spaceGroup.operations === mag.operations || s.structure.spaceGroup.operations.some((op) => op.timeReversal === -1)) group = s.structure.spaceGroup.hermannMauguin ?? null;
  }
  const rows = s.powderParams.filter((p) => isMomentParameterKind(p.kind));
  const inCalc = mag.moments.some((m) => m.components.some((c) => Math.abs(c) > 1e-9) || (m.sinComponents?.some((c) => Math.abs(c) > 1e-9) ?? false));
  return { k: [k[0]!, k[1]!, k[2]!], kLabel: kLabel([k[0]!, k[1]!, k[2]!]), group, rows: rows.length, free: rows.filter((p) => !p.fixed && !p.expression).length, inCalc };
}

/** The session's rows under the ids the primary phase has on its own (a multi-phase spec prefixes them `p0_`), the added phases' left out. */
function primaryOnly(s: Session): Session {
  return { ...s, powderParams: rowsForPhases(s.powderParams, [s.structure, ...s.extraPhases], [s.structure]) };
}

/**
 * New data on the page. The structure starts where the last fit left it (a
 * temperature series: carryRefinedStructure); the data's own scale,
 * background and profile start afresh, with Lorentz on. The added phases, the
 * corrections and the microstrain model go; a magnetic model stays, its rows
 * (moments, k) held at their values (THY-45: the moments in the calculated
 * pattern are always rows on the page); a TOF instrument goes for
 * constant-wavelength data, which it cannot place.
 */
export function withPattern(p: PowderPage, pattern: PowderPattern, file?: LoadedFile, overlay?: PatternOverlay): PowderPage {
  const page = pattern.xUnit !== "tof" && p.instrument.kind === "tof" ? { ...p, instrument: DEFAULT_INSTRUMENT, instrumentLoaded: false } : p;
  const s = p.session;
  const background = startingBackground(pattern, page, { pattern: s.pattern, page: p, terms: s.backgroundTerms });
  const rows = rowsOn(page, s.structure, pattern, { lorentz: true, backgroundTerms: background.terms, ...(background.type ? { backgroundType: background.type } : {}), siteTies: s.siteTies }, !!overlay);
  const { corrections: _corrections, mustrain: _mustrain, rawData: _rawData, ...rest } = s;
  return changed(page, {
    ...rest,
    backgroundTerms: background.terms,
    extraPhases: [],
    pattern,
    powderParams: withMagneticRows(rows.viewOnly ? rows.params : carryRefinedStructure(primaryOnly(s), rows.params).params, s.magnetic ? s.powderParams.map((p) => (isMagneticModelParameterKind(p.kind) && !p.expression ? { ...p, fixed: true } : p)) : []),
    powderBindings: s.magnetic ? keptBindings(rows.bindings, s.powderBindings) : rows.bindings,
    powderProfile: rows.profile,
    powderOverlay: overlay ?? null,
    powderSource: file?.name ?? pattern.name,
    ...(file ? { rawData: { name: file.name, text: file.text } } : {}),
  });
}

/**
 * An instrument file on the page. The rows are built again from it (the
 * profile, the zero, the diffractometer constants, the scale and background
 * seeded afresh), the structure where the last fit left it, as with new
 * data, and the magnetic model's rows as they were. A constant-wavelength
 * instrument sets the radiation and λ of non-TOF data, whichever came first.
 * On a page with nothing loaded, it waits for the next load.
 */
export function withInstrument(p: PowderPage, instrument: InstrumentParameters, file?: LoadedFile): PowderPage {
  const s = p.session;
  const page = { ...p, instrument, instrumentLoaded: true };
  const raw = file ? { rawInstrument: { name: file.name, text: file.text } } : {};
  if (s.powderSource === EMPTY_SOURCE) return changed(page, { ...s, ...raw });
  const pattern = instrument.kind === "constantWavelength" && s.pattern.xUnit !== "tof"
    ? { ...s.pattern, radiation: radiationOf(instrument), wavelength: instrument.wavelength }
    : s.pattern;
  const background = startingBackground(pattern, page, { pattern: s.pattern, page: p, terms: s.backgroundTerms });
  const spec = buildSpecFor(s.structure, s.extraPhases, pattern, instrument, s.powderProfile.lorentz ?? true, background.terms, s.siteTies, s.mustrain ?? "isotropic", s.corrections, background.type);
  return changed(page, {
    ...s,
    ...raw,
    backgroundTerms: background.terms,
    pattern,
    powderParams: withMagneticRows(carryRefinedStructure(s, spec.params).params, s.powderParams),
    powderBindings: keptBindings(spec.bindings, s.powderBindings),
    powderProfile: spec.profile,
  });
}

/**
 * A page opened from its files as a user loads them: the structure, the
 * instrument, then the data (read with the instrument). The evals and the
 * validation open their pages this way.
 */
export function openedPage(structure: StructureModel, instrument: InstrumentParameters, pattern: PowderPattern, files: { readonly instrument?: LoadedFile; readonly data?: LoadedFile } = {}): PowderPage {
  return withPattern(withInstrument(withStructure(emptyPage(), structure), instrument, files.instrument), pattern, files.data);
}

/** An X-ray instrument's constants (polarization, Kα₂ ratio): set on the instrument and on the pattern's radiation, which the model reads; a neutron pattern has none. */
export function withInstrumentConstants(p: PowderPage, update: InstrumentConstants): PowderPage {
  const s = p.session;
  const instrument = p.instrument.kind === "constantWavelength" ? withConstants(p.instrument, update) : p.instrument;
  return changed({ ...p, instrument }, s.pattern.radiation.kind === "xray" ? { ...s, pattern: { ...s.pattern, radiation: withConstants(s.pattern.radiation, update) } } : s);
}

// ── what the page shows ────────────────────────────────────────────────────

/** A magnetic model on the session is part of the calculated pattern, whether or not its moments are refinable. */
export function magneticApplied(s: Session): boolean {
  return !!s.magnetic && s.magnetic.moments.length > 0;
}

/** Moment rows are present: the moments themselves refine. */
export function momentRowsFree(s: Session): boolean {
  return s.powderParams.some((p) => isMomentParameterKind(p.kind));
}

/** The profile a fit and the curves use. */
export function profileRequest(s: Session): { shape: PeakShape; eta?: number; lorentz?: boolean; backgroundType?: BackgroundType } {
  return {
    shape: s.powderProfile.shape,
    ...(s.powderProfile.eta !== undefined ? { eta: s.powderProfile.eta } : {}),
    ...(s.powderProfile.lorentz !== undefined ? { lorentz: s.powderProfile.lorentz } : {}),
    ...(s.powderProfile.backgroundType !== undefined ? { backgroundType: s.powderProfile.backgroundType } : {}),
  };
}

/** The profile the magnetic component is synthesized with (the background basis is the nuclear curve's business). */
export function magneticProfileOf(s: Session): { shape: PeakShape; eta?: number } {
  return { shape: s.powderProfile.shape, ...(s.powderProfile.eta !== undefined ? { eta: s.powderProfile.eta } : {}) };
}

/** The occupancy restraints the site ties ask for, over every phase (the magnetic path takes none). */
export function restraintRequest(s: Session): { restraints?: ReturnType<typeof powderRestraints> } {
  const restraints = powderRestraints([s.structure, ...s.extraPhases], s.siteTies, s.powderParams);
  return restraints.length > 0 ? { restraints } : {};
}

const phaseListOf = (s: Session): { structure: StructureModel; id: string }[] => s.extraPhases.map((st) => ({ structure: st, id: st.id }));

/** Every phase with the current parameter values applied, primary first; each phase's bindings routed by phase. */
export function refinedPhasesOf(s: Session): StructureModel[] {
  const values: Record<string, number> = {};
  for (const p of s.powderParams) values[p.id] = p.value;
  const multi = s.extraPhases.length > 0;
  return [s.structure, ...s.extraPhases].map((ph) => applyParameters(ph, multi ? s.powderBindings.filter((b) => b.targetId === ph.id) : s.powderBindings, values).model);
}

/**
 * The nuclear curves (every phase, no magnetic term: the magnetic step draws
 * its candidate on these), and what the page plots and scores: the nuclear
 * plus the applied magnetic model's contribution. A TOF pattern with GSAS-II's
 * overlay shows that overlay.
 */
export function powderPageCurves(s: Session): { nuclear: PowderCurves; curves: PowderCurves } {
  const pattern = s.pattern;
  const tofOverlay = pattern.xUnit === "tof" && s.powderOverlay;
  let nuclear: PowderCurves;
  if (pattern.points.length === 0) {
    nuclear = { x: [], yObs: [], yCalc: [], yBackground: [], diff: [] };
  } else if (tofOverlay) {
    const x = pattern.points.map((p) => p.x);
    const yObs = pattern.points.map((p) => p.yObs);
    const yCalc = s.powderOverlay!.calc;
    nuclear = { x, yObs, yCalc, yBackground: s.powderOverlay!.background, diff: yObs.map((o, i) => o - (yCalc[i] ?? 0)) };
  } else if (s.extraPhases.length > 0) {
    nuclear = multiPhaseCurves([{ structure: s.structure, id: s.structure.id }, ...phaseListOf(s)], pattern, s.powderParams, s.powderBindings, s.powderProfile);
  } else {
    nuclear = powderCurves(s.structure, pattern, s.powderParams, s.powderBindings, s.powderProfile);
  }
  const mag = s.magnetic;
  if (!mag || mag.moments.length === 0 || pattern.points.length === 0 || tofOverlay) return { nuclear, curves: nuclear };
  // The applied model's moments are driven by its moment rows in the session, so the full parameter set applies.
  const yMagnetic = magneticComponentCurve(s.structure, mag, pattern, s.powderParams, s.powderBindings, magneticProfileOf(s), phaseListOf(s));
  const yCalc = nuclear.yCalc.map((v, i) => v + (yMagnetic[i] ?? 0));
  return { nuclear, curves: { ...nuclear, yCalc, diff: nuclear.yObs.map((o, i) => o - (yCalc[i] ?? 0)) } };
}

/**
 * The weighted R_wp with the engine's definition and point selection (1/σ²
 * weights, the excluded-sentinel plateau, the fit window; for a TOF overlay
 * only where the reference calc > 0), so it matches the refinement's at
 * convergence and stays live as parameters are edited.
 */
export function weightedR(s: Session, c: { readonly x: readonly number[]; readonly yObs: readonly number[]; readonly yCalc: readonly number[] }, window: FitWindow | null): number {
  const tof = s.pattern.xUnit === "tof";
  const excluded = excludedPointMask(c.yObs);
  let num = 0, den = 0;
  for (let i = 0; i < c.yObs.length; i++) {
    const calc = c.yCalc[i] ?? 0;
    if (excluded[i]) continue;
    if (tof && calc <= 0) continue;
    if (window && (c.x[i]! < window.min || c.x[i]! > window.max)) continue;
    const o = c.yObs[i]!;
    const sigma = s.pattern.points[i]?.sigma ?? (o > 0 ? Math.sqrt(o) : 1);
    const w = sigma > 0 ? 1 / (sigma * sigma) : 1;
    num += w * (o - calc) * (o - calc);
    den += w * o * o;
  }
  return Math.sqrt(num / Math.max(den, 1e-12));
}

/**
 * The goodness of fit of the curves on screen, √[Σw(y_o − y_c)² / (N − P)]
 * over `weightedR`'s points, P the free rows: wR/R_exp as a refinement reports
 * it, for a page with no refinement of its own (a demo opened on its converged
 * snapshot), so the card's GoF and the Validation view's agree.
 */
export function curvesGoodnessOfFit(s: Session, c: { readonly x: readonly number[]; readonly yObs: readonly number[]; readonly yCalc: readonly number[] }, window: FitWindow | null): number {
  const tof = s.pattern.xUnit === "tof";
  const excluded = excludedPointMask(c.yObs);
  let chi2 = 0, n = 0;
  for (let i = 0; i < c.yObs.length; i++) {
    const calc = c.yCalc[i] ?? 0;
    if (excluded[i]) continue;
    if (tof && calc <= 0) continue;
    if (window && (c.x[i]! < window.min || c.x[i]! > window.max)) continue;
    const o = c.yObs[i]!;
    const sigma = s.pattern.points[i]?.sigma ?? (o > 0 ? Math.sqrt(o) : 1);
    if (!(sigma > 0)) continue;
    chi2 += ((o - calc) * (o - calc)) / (sigma * sigma);
    n++;
  }
  const free = s.powderParams.filter((p) => !p.fixed && !p.expression).length;
  return n > 0 ? Math.sqrt(chi2 / Math.max(n - free, 1)) : 0;
}

/** The points a fit uses: not excluded, inside the window. */
export function observationsIn(c: { readonly x: readonly number[]; readonly yObs: readonly number[] }, window: FitWindow | null): number {
  const excluded = excludedPointMask(c.yObs);
  let n = 0;
  c.x.forEach((x, i) => {
    if (!excluded[i] && !(window && (x < window.min || x > window.max))) n++;
  });
  return n;
}

/** The pattern's full extent on its own axis (0–0 with no points). */
export function extentOf(xs: readonly number[]): FitWindow {
  return xs.length === 0 ? { min: 0, max: 0 } : minMax(xs);
}

// ── the fits the page runs ─────────────────────────────────────────────────

const windowRequest = (page: PowderPageModel): { fitRange?: FitWindow } => (page.fitRange ? { fitRange: { min: page.fitRange.min, max: page.fitRange.max } } : {});

/** The magnetic co-refinement's spec: nuclear + the applied magnetic model on the shared scale. */
function magneticSpec(page: PowderPageModel) {
  const s = page.session;
  return {
    structure: s.structure, magnetic: s.magnetic!, pattern: s.pattern, parameters: [...s.powderParams], bindings: [...s.powderBindings],
    ...(s.extraPhases.length > 0 ? { extraPhases: s.extraPhases.map((st) => ({ structure: st, id: st.id })) } : {}),
    ...profileRequest(s),
    ...windowRequest(page),
  };
}

/** The nuclear refinement's request (multi-phase when there are extra phases). */
function nuclearRequest(page: PowderPageModel, parameters: readonly RefinementParameter[] = page.session.powderParams) {
  const s = page.session;
  return {
    structure: s.structure, pattern: s.pattern, parameters: [...parameters], bindings: s.powderBindings, ...profileRequest(s), ...restraintRequest(s),
    ...(s.extraPhases.length > 0 ? { extraPhases: s.extraPhases } : {}),
    ...windowRequest(page),
  };
}

/**
 * The Refine button's fit of the current free set: with an applied magnetic
 * model, nuclear + magnetic on the shared scale; otherwise the nuclear
 * pattern. Applies nothing: the caller does, or (the Agent's correlation
 * probe) only reads it.
 */
export function powderFit(client: PowderCompute, page: PowderPageModel, options: Partial<RefinementOptions>, gpu = false, onProgress?: PowderProgress): Promise<RefinementResult> {
  if (magneticApplied(page.session)) return client.refineMagneticPowderParallel(magneticSpec(page), options);
  return client.refinePowderParallel({ ...nuclearRequest(page), options, useGpu: gpu }, onProgress);
}

/** A fit's values on the session, and with a magnetic model applied, its refined moments. */
export function withFitResult(s: Session, result: RefinementResult): Session {
  const powderParams = s.powderParams.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
  return magneticApplied(s)
    ? { ...s, magnetic: applyMagneticMoments(s.magnetic!, s.powderBindings, result.parameters), powderParams }
    : { ...s, powderParams };
}

/** What Prefit or Escape-minimum found: the session with it applied, its result, and the page's message. */
export interface ThoroughOutcome {
  readonly mode: "prefit" | "escape";
  readonly magnetic: boolean;
  readonly session: Session;
  readonly result: RefinementResult;
  readonly message: string;
}

/**
 * Prefit (no fit yet) or Escape minimum (after one): the robust path, in two
 * stages for a nuclear model.
 *  1. A Le Bail cell pre-fit (single phase, a cell row free; on TOF with the
 *     diffractometer's calibration): the cell against peak positions with free
 *     intensities, so a wrong starting cell cannot trap the structural solve.
 *     Its cell is seeded back, and on 2θ its zero seeds a free zero.
 *  2. Multi-start: a baseline fit and perturbed restarts, the lowest χ² kept.
 * With a magnetic model applied, the search runs over the moment subspace
 * instead. `onStage` says when the Le Bail stage starts (the page shows it before the fit runs).
 */
export async function thoroughFit(client: PowderCompute, page: PowderPageModel, onProgress?: PowderProgress, onStage?: (message: string) => void | Promise<void>): Promise<ThoroughOutcome> {
  const s = page.session;
  const mode: "prefit" | "escape" = page.result ? "escape" : "prefit";
  if (magneticApplied(s)) {
    const msOptions = mode === "prefit" ? { restarts: 12, minKick: momentKickFloor(s.powderParams) } : { restarts: 6, escapeSigma: 3 };
    const ms: MagneticMultiStartResult = await client.refineMagneticPowderMultiStart(magneticSpec(page), msOptions, { maxIterations: 20 }, onProgress);
    const wr = (100 * (ms.final.agreement.rWeighted ?? 0)).toFixed(2);
    const degNote = ms.degeneracies.length > 0 ? ` Data-limited: ${ms.degeneracies[0]!.message}` : "";
    // restartsRun 0 = no free moment row to perturb (a previewed model): the
    // engine went straight to the joint solve, so no search is reported.
    const bestNote = ms.restartsRun === 0
      ? "no free moment row to search — joint solve with the magnetic model held"
      : ms.improved
        ? `found a lower minimum (start ${ms.bestStartIndex} of ${ms.restartsRun})`
        : `baseline held over ${ms.restartsRun + 1} starts`;
    return {
      mode, magnetic: true, session: withFitResult(s, ms.final), result: ms.final,
      message: `Magnetic ${mode === "prefit" ? "prefit" : "escape"}: ${bestNote} — wR ${wr}%.${degNote}`,
    };
  }
  let workingParams: readonly RefinementParameter[] = s.powderParams;
  const isCell = (kind: string): boolean => kind === "cellLength" || kind === "cellAngle";
  const tof = s.pattern.xUnit === "tof";
  const applied = applyParameters(s.structure, s.powderBindings, Object.fromEntries(s.powderParams.map((p) => [p.id, p.value])));
  const tofCal = tof && applied.tof ? { ...applied.tof, zero: applied.zeroShift } : undefined;
  const leBailReady = mode === "prefit"
    && s.extraPhases.length === 0
    && s.powderParams.some((p) => isCell(p.kind) && !p.fixed && !p.expression)
    && (!tof || tofCal !== undefined);
  if (leBailReady) {
    await onStage?.("Le Bail pre-fit: refining the cell against peak positions (no structure)…");
    const pre = await client.leBailPrefit({
      structure: s.structure, pattern: s.pattern,
      cellParameters: s.powderParams.filter((p) => isCell(p.kind)),
      cellBindings: s.powderBindings.filter((b) => isCell(b.kind)),
      shape: s.powderProfile.shape,
      ...(s.powderProfile.eta !== undefined ? { eta: s.powderProfile.eta } : {}),
      ...windowRequest(page),
      ...(tofCal ? { tof: tofCal } : {}),
    });
    if (pre.refined) {
      // The Le Bail fit refines its own zero on a 2θ pattern, so its cell is
      // free of the zero error: a free zero starts at the same value.
      workingParams = s.powderParams.map((p) => (pre.cellValues[p.id] !== undefined
        ? { ...p, value: pre.cellValues[p.id]! }
        : p.kind === "zeroShift" && pre.zero !== undefined && !p.fixed && !p.expression ? { ...p, value: pre.zero } : p));
    }
  }
  // Prefit casts a wide net from a cold start (many restarts, the default ~4σ
  // kick); Escape is a light nudge around a refined fit (few restarts, ~1.5σ).
  const msOptions = mode === "prefit" ? { restarts: 8 } : { restarts: 3, escapeSigma: 1.5 };
  const ms: MultiStartResult = await client.refinePowderMultiStart({ ...nuclearRequest(page, workingParams), options: { maxIterations: 20 } }, msOptions, onProgress);
  const wr = (100 * (ms.final.agreement.rWeighted ?? 0)).toFixed(2);
  const message = mode === "prefit"
    ? ms.improved
      ? `Prefit found a lower minimum (restart ${ms.bestStartIndex} of ${ms.restartsRun}) — wR ${wr}%, best of ${ms.restartsRun + 1} starts. Refine to polish.`
      : `Prefit: the starting model was already best of ${ms.restartsRun + 1} starts — wR ${wr}%. Refine to polish.`
    : ms.improved
      ? `Escaped a local minimum (restart ${ms.bestStartIndex} of ${ms.restartsRun}) — wR ${wr}%, best of ${ms.restartsRun + 1} starts.`
      : `Already at the best minimum — the baseline beat all ${ms.restartsRun + 1} starts, wR ${wr}%.`;
  return { mode, magnetic: false, session: withFitResult(s, ms.final), result: ms.final, message };
}

/**
 * The posterior sampler over the page's problem as it stands (the free rows,
 * the window, every phase, the restraints, an applied magnetic model), seeded
 * at the present values with the last fit's esds. A continued run reuses the
 * closure this returns, so the chain keeps targeting the same posterior.
 */
export function posteriorRun(client: PowderCompute, page: PowderPageModel): (options: SampleOptions) => Promise<SampleResult> {
  const esd = page.result?.esd;
  if (magneticApplied(page.session)) {
    const spec = magneticSpec(page);
    return (o) => client.sampleMagneticPowderPosterior(spec, { ...o, ...(esd ? { linearizedEsd: esd } : {}) });
  }
  const req = nuclearRequest(page);
  return (o) => client.samplePowderPosterior(req, { ...o, ...(esd ? { linearizedEsd: esd } : {}) });
}

// ── the magnetic step's view of the page ────────────────────────────────────

/** The page's axis: the data's own unit, the instrument shown (a TOF pattern reaches d through it), the refined zero and TOF calibration. */
export function pageAxis(s: Session, instrument: InstrumentParameters | undefined): AxisContext {
  const zero = s.powderParams.find((p) => p.kind === "zeroShift")?.value;
  const { difC, difA, difB } = tofCalibrationOf(s.powderParams);
  return axisContext(s.pattern, instrument, zero, { ...(difC !== undefined ? { difC } : {}), ...(difA !== undefined ? { difA } : {}), ...(difB !== undefined ? { difB } : {}) });
}

/** Every phase's reflections over the pattern (refined cells, d from 0.4 Å), for the residual peaks' nuclear neighbours. */
function nuclearReflections(s: Session, axis: AxisContext, x: readonly number[]): { d: number; hkl: string; phaseLabel: string }[] {
  const extent = extentOf(x);
  const dA = convertAxisValue(extent.min, s.pattern.xUnit, "dSpacing", axis);
  const dB = convertAxisValue(extent.max, s.pattern.xUnit, "dSpacing", axis);
  if (!Number.isFinite(dA) || !Number.isFinite(dB)) return [];
  const dMin = Math.max(Math.min(dA, dB), 0.4);
  const dMax = Math.max(dA, dB);
  const refined = refinedPhasesOf(s);
  const labels = [s.structure.name || "nuclear", ...s.extraPhases.map((ph, i) => ph.name || `phase ${i + 2}`)];
  return refined.flatMap((ph, i) => generateReflections(ph.cell, ph.spaceGroup, dMin, dMax).map((r) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, phaseLabel: labels[i]! })));
}

/**
 * The magnetic step's residual peaks: positive residual the model on the
 * page leaves (above 3σ where the data carry σ: the step's own criteria
 * decide which feed the k-search), and the user's own picks at these d, each
 * annotated with any nuclear reflection of any phase beside it (a residual on
 * a nuclear position is usually profile misfit, not magnetic).
 *
 * The residual is against what the calculated pattern includes: an applied
 * magnetic model explains a peak only through the intensity its moments put
 * in the calculation (zero moments explain nothing), never by its ticks. With
 * `nuclearOnly`, against the nuclear calculation alone: the residual a
 * k-search starts from when a loaded model is in question (THY-45).
 */
export function residualPeaksOf(s: Session, instrument: InstrumentParameters | undefined, manualD: readonly number[] = [], options: { readonly nuclearOnly?: boolean } = {}): ResidualPeak[] {
  const axis = pageAxis(s, instrument);
  if (!availableDisplayUnits(axis).includes("dSpacing")) return [];
  const page = powderPageCurves(s);
  const curves = options.nuclearOnly ? page.nuclear : page.curves;
  const d = s.pattern.xUnit === "dSpacing" ? curves.x : convertAxisArray(curves.x, s.pattern.xUnit, "dSpacing", axis);
  // Only data that carry σ: √yObs is valid for raw counts only, and on a normalized pattern it would exceed any residual.
  const hasSigma = s.pattern.points.length > 0 && s.pattern.points.every((p) => p.sigma !== undefined);
  const pointSigma = hasSigma ? s.pattern.points.map((p) => p.sigma!) : undefined;
  const detected = detectExtraPeaks(d, curves.yObs, curves.yCalc, { ...(pointSigma ? { pointSigma, minSignificance: 3 } : {}), limit: 24 });
  // A pick carries the residual at the nearest point; one on a detected apex is that peak.
  const manual = manualD.map((at) => {
    let bi = 0;
    let bestErr = Infinity;
    for (let i = 0; i < d.length; i++) {
      const e = Math.abs(d[i]! - at);
      if (e < bestErr) {
        bestErr = e;
        bi = i;
      }
    }
    const height = (curves.yObs[bi] ?? 0) - (curves.yCalc[bi] ?? 0);
    const sigma = hasSigma ? s.pattern.points[bi]!.sigma! : undefined;
    return { d: at, height, ...(sigma !== undefined && sigma > 0 ? { significance: height / sigma } : {}) };
  }).filter((m) => !detected.some((p) => Math.abs(p.d - m.d) < 0.01));
  if (detected.length + manual.length === 0) return [];
  const refs = nuclearReflections(s, axis, curves.x);
  return [...annotateExtraPeaks(detected, refs), ...annotateExtraPeaks(manual, refs).map((p) => ({ ...p, manual: true as const }))];
}

/** The step's moments-only fit, as the page refines: the nuclear model held, its full profile, every phase, the window. */
export function momentFitRequest(s: Session, window: FitWindow | null, magnetic: MagneticModel, momentParams: readonly RefinementParameter[], momentBindings: readonly ParameterBinding[], freeScale = false) {
  return {
    structure: s.structure, magnetic, pattern: s.pattern,
    parameters: [...s.powderParams.filter((p) => !isMagneticModelParameterKind(p.kind)).map((p) => ({ ...p, fixed: !(freeScale && p.kind === "scale" && !p.expression) })), ...momentParams],
    bindings: [...s.powderBindings.filter((b) => !isMagneticModelParameterKind(b.kind)), ...momentBindings],
    ...(s.extraPhases.length > 0 ? { extraPhases: phaseListOf(s) } : {}),
    ...profileRequest(s),
    ...(window ? { fitRange: { min: window.min, max: window.max } } : {}),
  };
}

/**
 * The step's fit on the powder page: through the compute client, or (a
 * view-only TOF page, which the client does not refine) in this thread. A
 * row of a previously applied model is dropped: the model handed in brings
 * its own.
 */
export function powderMomentFit(client: PowderCompute | null, s: Session, window: FitWindow | null): MagneticFit {
  return {
    agreementLabel: "wR",
    refine: async (magnetic, momentParams, momentBindings, options) => {
      const spec = momentFitRequest(s, window, magnetic, momentParams, momentBindings, options?.freeScale);
      let result: RefinementResult;
      if (client) {
        result = await client.refineMagneticPowderParallel(spec, { maxIterations: 20 });
      } else {
        await new Promise((r) => setTimeout(r, 30)); // let the busy state paint
        result = refine(buildMagneticPowderProblem(spec.structure, magnetic, spec.pattern, spec.parameters, spec.bindings, profileRequest(s), spec.fitRange, spec.extraPhases ?? []), { maxIterations: 20 });
      }
      const values: Record<string, number> = {};
      for (const p of momentParams) values[p.id] = result.parameters[p.id] ?? p.value;
      return { values, agreement: result.agreement.rWeighted ?? null, ...noiseOf(result) };
    },
  };
}

/**
 * "Show on refinement pattern": a model on the session without its rows (or
 * none), so the refinement page plots nuclear + this model and refines the
 * nuclear set against it with the moments held; Continue is what adds the
 * rows. Rows an earlier Continue left are dropped: they would drive a model
 * they do not belong to.
 */
export function withMagneticPreview(s: Session, magnetic: NonNullable<Session["magnetic"]> | null): Session {
  const { magnetic: _previous, ...rest } = s;
  return {
    ...rest,
    ...(magnetic ? { magnetic } : {}),
    powderParams: s.powderParams.filter((p) => !isMagneticModelParameterKind(p.kind)),
    powderBindings: s.powderBindings.filter((b) => !isMagneticModelParameterKind(b.kind)),
  };
}

/** The rows a magnetic model hands the refinement page (magneticStep.ts, handoff: free as a fit frees them) replace any earlier model's. */
export function withMagneticModelRows(s: Session, magnetic: NonNullable<Session["magnetic"]>, momentParams: readonly RefinementParameter[], momentBindings: readonly ParameterBinding[]): Session {
  return {
    ...s,
    magnetic,
    powderParams: [...s.powderParams.filter((p) => !isMagneticModelParameterKind(p.kind)), ...momentParams],
    powderBindings: [...s.powderBindings.filter((b) => !isMagneticModelParameterKind(b.kind)), ...momentBindings],
  };
}
