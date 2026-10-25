/**
 * The PDF page's operations, one implementation for both of its adapters: the
 * workbench (PdfWorkbench.tsx), which holds the page in React state, and the
 * Agent's headless page (testSupport/agentHeadless.ts), which holds it in a
 * variable. As powderPage.ts and singleCrystalPage.ts for the other pages.
 *
 * The page is a value (`PdfPageModel`): what was loaded and the settings that
 * are saved with a project or change the fit. Every change is a function that
 * returns the next value with its parameter rows already rebuilt (no render
 * pairs the old rows with a new spec), every derived quantity (the structure
 * fitted, the spec, the curves, Rw) is read from `pageView`, and the fits take
 * the compute client and return what they found. Nothing here touches React.
 */

import type { PdfWorkspace } from "@/core/project/types";
import { overlaySavedParameters, pdfWorkspaceFrom } from "@/app/projectIo";
import type { AtomSite, StructureModel } from "@/core/crystal/types";
import { withAdpModel as structureWithAdpModel } from "@/core/crystal/adp";
import type { PdfPattern } from "@/core/diffraction/types";
import { isMagneticModelParameterKind, type ParameterBinding, type RefinementOptions, type RefinementParameter, type RefinementResult } from "@/core/refinement/types";
import { CANCELLED, type ComputeClient } from "@/workers/computeClient";
import { withTieValues } from "@/core/refinement/constraints";
import { siteSumConstraints, siteSumRangeWarnings } from "@/core/workflow/structureRefinement";
import {
  buildMultiPhasePdfSpec, buildPdfSpec, correlatedMotionConflict, multiPhasePdfCurves, optimalPdfScale, pdfCurves, pdfPhaseBindingsFor, zeroAdpWarning,
} from "@/core/workflow/pdf";
import { buildMpdfSpec, mpdfComponents, unsupportedMpdfModel } from "@/core/workflow/mpdf";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import type { MagneticModel } from "@/core/magnetic/types";
import { buildDistortionModes, buildSymmetryModes, positionShiftValuesFor, withDistortionModes, type DistortionModeSet } from "@/core/crystal/distortionModes";
import { decomposeDisplacementRepresentation, type DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import { activateDisplacementMode, identifySubgroup, projectIsotypicModes, realizeSubgroup, stabilizerOfField, type DisplacementField, type SubgroupIdentity } from "@/core/crystal/isotropyTree";
import type { SubgroupNode } from "@/core/crystal/subgroupTree";
import { applyParameters } from "@/core/workflow/apply";
import { boxcarPlanIssue, boxcarStepIndex, boxcarTable, boxcarWindows, type BoxcarDirection, type BoxcarPlan, type BoxcarRun, type BoxcarSeries } from "@/core/workflow/pdfBoxcar";
import type { SequentialResult, SequentialStep } from "@/core/refinement/sequential";
import type { SampleOptions, SampleResult } from "@/core/refinement/bayes/sampler";
import type { ReportInput } from "@/core/export/report";
import { pdfReportInput, type MagneticExploration } from "@/app/reportInputs";
import type { PdfLiveState } from "@/agent/port";

/** The r window the model is computed and fitted in (Å). */
export interface FitWindow {
  readonly min: number;
  readonly max: number;
}

/** The distortion-mode parameterization in force: from a parent CIF, or from a subgroup activation. */
export interface ModesInForce {
  readonly set: DistortionModeSet;
  readonly parentName: string;
  readonly fromActivation?: boolean;
}

/** The spin model handed over from the magnetic page, with its moment rows as handed over. */
export interface SpinModel {
  readonly magnetic: MagneticModel;
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
}

/** The ADP model switched to on the page, seeded per site from the ADPs as refined then; null keeps the structure's own. */
export interface AdpSwitch {
  readonly model: "isotropic" | "anisotropic";
  readonly seeds: Readonly<Record<string, AtomSite["adp"]>>;
}

type SamplePdfRequest = Parameters<ComputeClient["samplePdfPosterior"]>[0];
type SampleMpdfRequest = Parameters<ComputeClient["sampleMpdfPosterior"]>[0];
/** The problem a posterior run poses, which Continue poses again. */
export type SampleRequest = SamplePdfRequest | SampleMpdfRequest;

/** A posterior run and the very request it sampled (Continue must re-pose it). */
export interface PosteriorRun {
  readonly result: SampleResult;
  readonly req: SampleRequest;
}

export interface PdfPageModel {
  /** The primary phase as loaded. */
  readonly loaded: StructureModel;
  /** The other phases of a multi-phase G(r) sum. */
  readonly extraPhases: readonly StructureModel[];
  readonly pattern: PdfPattern;
  /** A demo snapshot's converged values (value and initial value) and its window. */
  readonly preset: { readonly values?: Readonly<Record<string, number>>; readonly fitRange?: FitWindow };
  /** Per-coordinate shifts, or symmetry-adapted distortion-mode amplitudes (single phase only). */
  readonly positionMode: "atomic" | "irreps";
  readonly modes: ModesInForce | null;
  readonly adp: AdpSwitch | null;
  readonly spinModel: SpinModel | null;
  readonly params: readonly RefinementParameter[];
  readonly result: RefinementResult | null;
  readonly fitRange: FitWindow;
  /** The window the page opens with (Reset range): a reopened project's, a demo's, or above r_poly up to 30 Å. */
  readonly defaultRange: FitWindow;
  readonly boxcarPlan: BoxcarPlan;
  readonly boxcarRun: BoxcarRun | null;
  readonly sample: PosteriorRun | null;
  /** Each shared site's total occupancy set below 1 (vacancies), by the site's key (its first member's label); absent: 1. */
  readonly siteTotals: Readonly<Record<string, number>>;
}

/** The compute client's fits the page runs. */
export type PdfCompute = Pick<
  ComputeClient,
  "refinePdfParallel" | "refineMpdfParallel" | "refinePdfMultiStart" | "refineMpdfMultiStart" | "refinePdfBoxcar" | "samplePdfPosterior" | "sampleMpdfPosterior"
>;

/** A refinement's streamed calculated curve, cycle by cycle. */
export type OnLive = (yCalc: number[]) => void;

const DEFAULT_BOXCAR_PLAN: BoxcarPlan = { width: 5, step: 1, direction: "up", randomStart: false, restarts: 4 };

// ── the page as loaded, or as saved ──────────────────────────────────────────

/** The window a page opens with on this data: above the reduction's low-r limit and capped at 30 Å, or the one given (clipped to the data). */
function defaultRangeOf(pattern: PdfPattern, given?: FitWindow): FitWindow {
  const rFirst = pattern.points[0]?.r ?? 0;
  const rLast = pattern.points[pattern.points.length - 1]?.r ?? 1;
  if (given) return { min: Math.max(given.min, rFirst), max: Math.min(given.max, rLast) };
  // Files often carry G(r) to 100 Å, and modeling the whole grid on load would hang the page.
  return { min: Math.min(Math.max(pattern.rpoly ?? 1.5, rFirst), rLast), max: Math.min(rLast, 30) };
}

/**
 * The page on a structure and a G(r): a saved workspace's settings when one
 * is reopened, a demo snapshot's values and window when given, else the
 * spec's rows with the phase scale seeded from the starting model.
 */
export function pdfPage(
  loaded: StructureModel,
  pattern: PdfPattern,
  opts: { readonly extraPhases?: readonly StructureModel[]; readonly preset?: PdfPageModel["preset"]; readonly restore?: PdfWorkspace } = {},
): PdfPageModel {
  const r = opts.restore;
  const dm = r?.distortionModes;
  const sm = r?.spinModel;
  const defaultRange = defaultRangeOf(pattern, r?.fitRange ?? opts.preset?.fitRange);
  const seed: PdfPageModel = {
    loaded,
    extraPhases: opts.extraPhases ?? [],
    pattern,
    preset: opts.preset ?? {},
    positionMode: r?.positionMode ?? "atomic",
    modes: dm ? { set: dm.set, parentName: dm.parentName, ...(dm.fromActivation ? { fromActivation: true } : {}) } : null,
    adp: r?.adpModel ? { model: r.adpModel, seeds: {} } : null,
    spinModel: sm ? { magnetic: sm.magnetic, params: [...sm.parameters], bindings: [...sm.bindings] } : null,
    params: [],
    result: r?.refinement.lastResult ?? null,
    fitRange: defaultRange,
    defaultRange,
    boxcarPlan: r?.boxcar?.plan ?? DEFAULT_BOXCAR_PLAN,
    boxcarRun: r?.boxcar?.lastRun ?? null,
    sample: null,
    siteTotals: r?.siteTotals ?? {},
  };
  return { ...seed, params: freshRows(seed, r) };
}

/** The page as a project saves it. */
export function workspaceOf(m: PdfPageModel): PdfWorkspace {
  return pdfWorkspaceFrom({
    pattern: m.pattern,
    params: m.params,
    bindings: pageView(m).bindings,
    result: m.result,
    fitRange: m.fitRange,
    positionMode: m.positionMode,
    modes: m.modes,
    spinModel: m.spinModel,
    boxcarPlan: m.boxcarPlan,
    boxcarRun: m.boxcarRun,
    adpModel: m.adp?.model ?? null,
    siteTotals: m.siteTotals,
  });
}

/**
 * The rows of a page built afresh (on load, new data, new phases): the spec's,
 * the phase scale(s) seeded from the least-squares optimum of the starting
 * model over the default window (exact for one linear scale; split evenly
 * across phases) unless a demo snapshot or a reopened project supplies every
 * scale, then the snapshot's values, then the saved rows.
 */
function freshRows(m: PdfPageModel, restore?: PdfWorkspace): RefinementParameter[] {
  const v = pageView(m);
  const raw = v.spec;
  // A demo's values are keyed by the parent setting's ids: after a subgroup activation colliding ids mean other modes.
  const preset = v.modeSet !== null && m.modes?.fromActivation ? undefined : m.preset.values;
  const savedIds = restore ? new Set(restore.refinement.parameters.map((p) => p.id)) : null;
  const covered = raw.params.every((p) => p.kind !== "pdfScale" || (preset !== undefined && preset[p.id] !== undefined) || (savedIds !== null && savedIds.has(p.id)));
  let params: RefinementParameter[] = [...raw.params];
  if (!covered) {
    const w = m.defaultRange;
    const start = v.multiPhase
      ? multiPhasePdfCurves(v.phases, m.pattern, raw.params, raw.bindings, w)
      : pdfCurves(v.fitStructure, m.pattern, raw.params, raw.bindings, w);
    const inside = (i: number): boolean => start.x[i]! >= w.min && start.x[i]! <= w.max;
    const kappa = optimalPdfScale(start.yObs.filter((_, i) => inside(i)), start.yCalc.filter((_, i) => inside(i))) / (v.multiPhase ? v.phases.length : 1);
    params = params.map((p) => (p.kind === "pdfScale" ? { ...p, value: kappa, initialValue: kappa } : p));
  }
  if (preset) params = params.map((p) => (preset[p.id] !== undefined ? { ...p, value: preset[p.id]!, initialValue: preset[p.id]! } : p));
  // A reopened project's rows are the state being reopened: they win over the seed and the snapshot.
  if (restore) {
    const saved = restore.refinement.parameters;
    params = overlaySavedParameters(params, saved);
    // The spec's ties win over the file: a row the spec ties and the file did not (a shared
    // site's last occupancy, in a project saved before that tie, possibly free) is held at what
    // its tie gives, from the others' saved values.
    const untiedInFile = new Set(saved.filter((p) => !p.expression).map((p) => p.id));
    const newlyTied = new Set(params.filter((p) => p.expression && untiedInFile.has(p.id)).map((p) => p.id));
    if (newlyTied.size > 0) params = withTieValues(params, newlyTied, true);
  }
  return params;
}

// ── what the page derives ────────────────────────────────────────────────────

export interface PdfPageView {
  readonly multiPhase: boolean;
  /** The magnetic term exists for single-phase neutron data only. */
  readonly magneticCapable: boolean;
  /** Why the spin model is held out of the fit (an incommensurate k), when it is. */
  readonly spinBlockedReason: string | null;
  /** The spin model in the fit, or null. */
  readonly spinFit: SpinModel | null;
  /** The distortion modes from the structure's own space group (single phase). */
  readonly symModes: DistortionModeSet | null;
  /** The mode set in force, when positions refine as mode amplitudes. */
  readonly modeSet: DistortionModeSet | null;
  /** The structure the primary phase fits: the parent setting in irreps mode, with the ADP switch applied. */
  readonly fitStructure: StructureModel;
  readonly adpModel: "isotropic" | "anisotropic" | "mixed";
  readonly phases: readonly { readonly structure: StructureModel; readonly id: string }[];
  /** The spec's rows, bindings and restraints. */
  readonly spec: ReturnType<typeof buildPdfSpec>;
  readonly bindings: readonly ParameterBinding[];
  /** The primary phase's bindings (all of them on a single-phase page). */
  readonly primaryBindings: readonly ParameterBinding[];
  /** Every phase with the current values applied (primary first). */
  readonly refinedPhases: readonly StructureModel[];
  /** The spin model with the current moment values. */
  readonly refinedMagnetic: MagneticModel | null;
  /** The mPDF total and its nuclear and magnetic parts, with a spin model in the fit. */
  readonly mpdfCurves: ReturnType<typeof mpdfComponents> | null;
  readonly curves: { readonly x: number[]; readonly yObs: number[]; readonly yCalc: number[]; readonly diff: number[] };
  /** Rw over G(r) inside the window: √(Σ(o−c)²/Σo²), uniform weights, a relative indicator. */
  readonly rw: number;
  readonly observationCount: number;
  readonly motionConflict: string | null;
  readonly adpWarning: string | null;
  readonly radiationWarning: string | null;
}

/** The distortion modes from a structure's own space group, built once per structure. */
const ownModes = new WeakMap<StructureModel, DistortionModeSet>();
function symModesOf(structure: StructureModel): DistortionModeSet {
  let set = ownModes.get(structure);
  if (!set) ownModes.set(structure, (set = buildSymmetryModes(structure)));
  return set;
}

/** The mode set in force, when positions refine as mode amplitudes (single phase): the one built from a parent or an activation, else the structure's own. */
function modeSetOf(m: PdfPageModel): DistortionModeSet | null {
  if (m.extraPhases.length > 0 || m.positionMode !== "irreps") return null;
  if (m.modes) return m.modes.set;
  // An empty set (every site pinned by symmetry) cannot replace the position rows: atomic it stays.
  const own = symModesOf(m.loaded);
  return own.modes.length > 0 ? own : null;
}

/** The spin model in the fit: single-phase neutron data, and a model the spin field can represent (an incommensurate k is held out, not fitted approximately). */
function spinFitOf(m: PdfPageModel): SpinModel | null {
  const capable = m.extraPhases.length === 0 && m.pattern.scatteringType === "neutron";
  return capable && m.spinModel && !unsupportedMpdfModel(m.spinModel.magnetic) ? m.spinModel : null;
}

const views = new WeakMap<PdfPageModel, View>();
let lastView: View | null = null;

/**
 * What the page derives from its model, computed when first read. A quantity
 * whose inputs are the very values of the page viewed last is taken from it,
 * so a change recomputes only what depends on it.
 */
export function pageView(m: PdfPageModel): PdfPageView {
  const cached = views.get(m);
  if (cached) return cached;
  const v = new View(m, lastView);
  lastView?.detach();
  lastView = v;
  views.set(m, v);
  return v;
}

const same = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

class View implements PdfPageView {
  private readonly slots = new Map<string, { readonly deps: readonly unknown[]; readonly value: unknown }>();

  constructor(private readonly m: PdfPageModel, private base: View | null) {}

  /** This view no longer lends to the next one's predecessor (no chain of views is kept alive). */
  detach(): void {
    this.base = null;
  }

  private memo<T>(key: string, deps: readonly unknown[], make: () => T): T {
    const own = this.slots.get(key);
    if (own) return own.value as T;
    const lent = this.base?.slots.get(key);
    const value = lent && same(lent.deps, deps) ? (lent.value as T) : make();
    this.slots.set(key, { deps, value });
    return value;
  }

  get multiPhase(): boolean {
    return this.m.extraPhases.length > 0;
  }

  get magneticCapable(): boolean {
    return !this.multiPhase && this.m.pattern.scatteringType === "neutron";
  }

  get spinBlockedReason(): string | null {
    const { spinModel } = this.m;
    return spinModel ? unsupportedMpdfModel(spinModel.magnetic) : null;
  }

  get spinFit(): SpinModel | null {
    return spinFitOf(this.m);
  }

  get symModes(): DistortionModeSet | null {
    return this.multiPhase ? null : symModesOf(this.m.loaded);
  }

  get modeSet(): DistortionModeSet | null {
    return modeSetOf(this.m);
  }

  get fitStructure(): StructureModel {
    const { loaded, adp } = this.m;
    const set = this.modeSet;
    // The mode parameters are anchored on the parentized structure.
    const base = set ? set.parentized : loaded;
    return this.memo("fitStructure", [base, adp], () => (adp ? structureWithAdpModel({ ...base, sites: base.sites.map((site) => ({ ...site, adp: adp.seeds[site.label] ?? site.adp })) }, adp.model) : base));
  }

  get adpModel(): "isotropic" | "anisotropic" | "mixed" {
    const kinds = new Set(this.fitStructure.sites.map((site) => site.adp.kind));
    return kinds.size === 1 ? [...kinds][0]! : "mixed";
  }

  get phases(): readonly { readonly structure: StructureModel; readonly id: string }[] {
    const fit = this.fitStructure;
    const { extraPhases } = this.m;
    return this.memo("phases", [fit, extraPhases], () => [{ structure: fit, id: fit.id }, ...extraPhases.map((s) => ({ structure: s, id: s.id }))]);
  }

  get spec(): ReturnType<typeof buildPdfSpec> {
    const { extraPhases, pattern } = this.m;
    const fit = this.fitStructure;
    const set = this.modeSet;
    const spin = this.spinFit;
    const multi = this.multiPhase;
    const totals = this.m.siteTotals;
    return this.memo("spec", [fit, set, extraPhases, pattern, spin, totals], () => {
      const ties = Object.keys(totals).length > 0 ? { totals } : {};
      const base = multi
        ? buildMultiPhasePdfSpec([fit, ...extraPhases], pattern, ties)
        : spin
          // The magnetic build's rows join the nuclear ones.
          ? buildMpdfSpec(fit, pattern, { magnetic: spin.magnetic, params: [...spin.params], bindings: [...spin.bindings] }, ties)
          : buildPdfSpec(fit, pattern, ties);
      // Mode amplitudes in place of the per-coordinate position rows.
      return set ? { ...base, ...withDistortionModes({ params: base.params, bindings: base.bindings }, set) } : base;
    });
  }

  get bindings(): readonly ParameterBinding[] {
    return this.spec.bindings;
  }

  get primaryBindings(): readonly ParameterBinding[] {
    const bindings = this.bindings;
    return this.multiPhase ? this.memo("primaryBindings", [bindings, this.fitStructure.id], () => pdfPhaseBindingsFor(bindings, this.fitStructure.id)) : bindings;
  }

  get refinedPhases(): readonly StructureModel[] {
    const { params } = this.m;
    const phases = this.phases;
    const bindings = this.bindings;
    const multi = this.multiPhase;
    return this.memo("refinedPhases", [phases, params, bindings], () => {
      const values = valuesOf(params);
      return phases.map((ph) => applyParameters(ph.structure, multi ? pdfPhaseBindingsFor(bindings, ph.id) : bindings, values).model);
    });
  }

  get refinedMagnetic(): MagneticModel | null {
    const spin = this.spinFit;
    if (!spin) return null;
    const { params } = this.m;
    const bindings = this.bindings;
    return this.memo("refinedMagnetic", [spin, params, bindings], () => applyMagneticMoments(spin.magnetic, bindings, valuesOf(params)));
  }

  get mpdfCurves(): ReturnType<typeof mpdfComponents> | null {
    const spin = this.spinFit;
    if (!spin) return null;
    const { pattern, params, fitRange } = this.m;
    const fit = this.fitStructure;
    const bindings = this.bindings;
    return this.memo("mpdfCurves", [spin, fit, pattern, params, bindings, fitRange], () => mpdfComponents(fit, spin.magnetic, pattern, params, bindings, fitRange));
  }

  get curves(): { readonly x: number[]; readonly yObs: number[]; readonly yCalc: number[]; readonly diff: number[] } {
    // With a spin model the fit is the mPDF co-refinement, so the curves include the magnetic term.
    const mpdf = this.mpdfCurves;
    if (mpdf) return this.memo("curves", [mpdf], () => ({ x: mpdf.x, yObs: mpdf.yObs, yCalc: mpdf.yCalc, diff: mpdf.diff }));
    const { pattern, params, fitRange } = this.m;
    const bindings = this.bindings;
    if (this.multiPhase) {
      const phases = this.phases;
      return this.memo("curves", [null, phases, pattern, params, bindings, fitRange], () => multiPhasePdfCurves(phases, pattern, params, bindings, fitRange));
    }
    const fit = this.fitStructure;
    return this.memo("curves", [null, fit, pattern, params, bindings, fitRange], () => pdfCurves(fit, pattern, params, bindings, fitRange));
  }

  get rw(): number {
    return rwOf(this.curves, this.m.fitRange);
  }

  get observationCount(): number {
    const { fitRange } = this.m;
    return this.curves.x.filter((r) => r >= fitRange.min && r <= fitRange.max).length;
  }

  get motionConflict(): string | null {
    const { params } = this.m;
    return this.memo("motionConflict", [params], () => correlatedMotionConflict(params));
  }

  get adpWarning(): string | null {
    // A CIF with no U column loads every site at B = 0, which wrecks a real-space fit silently.
    const phases = this.phases;
    return this.memo("adpWarning", [phases], () => zeroAdpWarning(phases.map((p) => p.structure)));
  }

  get radiationWarning(): string | null {
    return this.m.pattern.radiationAssumed
      ? "The data file names no radiation, so it is read as X-ray data. Neutrons weight the pairs differently (Mn, Ti, V, Li and H scatter with negative lengths): confirm the radiation before reading the fit."
      : null;
  }
}

function valuesOf(params: readonly RefinementParameter[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const p of params) values[p.id] = p.value;
  return values;
}

/** Rw over G(r) inside the window, from these curves (the workbench's live curve too). */
export function rwOf(curves: { readonly x: readonly number[]; readonly yObs: readonly number[]; readonly yCalc: readonly number[] }, fitRange: FitWindow): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < curves.x.length; i++) {
    const r = curves.x[i]!;
    if (r < fitRange.min || r > fitRange.max) continue;
    const d = curves.yObs[i]! - curves.yCalc[i]!;
    num += d * d;
    den += curves.yObs[i]! * curves.yObs[i]!;
  }
  return den > 0 ? Math.sqrt(num / den) : NaN;
}

/**
 * What the spec depends on, by identity: a fit, scan or posterior run that
 * lands after any of these changed belongs to another parameter set and is
 * dropped (`landsOn`).
 */
export type SpecKey = readonly unknown[];

export function specKeyOf(m: PdfPageModel): SpecKey {
  return [m.loaded, m.extraPhases.length > 0 ? m.extraPhases : null, m.pattern, modeSetOf(m), m.adp, spinFitOf(m), m.siteTotals];
}

/** Whether something computed on the page with this key may land on this page. */
export function landsOn(m: PdfPageModel, key: SpecKey): boolean {
  return same(specKeyOf(m), key);
}

// ── the rows across a change of the spec ─────────────────────────────────────

/**
 * Kinds whose ids do not depend on the setting: an activation carries only
 * these (cell rows and U modes of another setting share ids with different
 * meanings). The mPDF envelope rows are problem-level too; the moment ids are not.
 */
const SETTING_FREE = new Set([
  "pdfScale", "qdamp", "qbroad", "delta1", "delta2", "sratio", "rcut", "spdiameter", "occupancy", "scale",
  "mpdfOrdScale", "mpdfParaScale", "mpdfPsigma", "corrLength",
]);

/**
 * The next page after a change of its spec on the same structure and data
 * (the position parameterization, the mode set, the ADP model, the spin
 * model): the rows the new spec gives, each keeping its value and free choice
 * by id; the positions re-seeded exactly from the current geometry (an
 * interpolation onto the new position rows, not a fit), unless `kick` keeps
 * the spec's own seeds (an activation's starting kick, which also carries
 * only the setting-free kinds); a new spin model's moment rows as handed over.
 * The last fit, the posterior and the boxcar scan belong to the old rows and
 * are cleared.
 */
function withSpecChange(m: PdfPageModel, change: Partial<Pick<PdfPageModel, "positionMode" | "modes" | "adp" | "spinModel" | "siteTotals">>, how: { readonly kick?: boolean } = {}): PdfPageModel {
  // A change the spec does not see (the mode toggle on a multi-phase page, a spin model on X-ray data) keeps the rows and the fit.
  if (landsOn({ ...m, ...change }, specKeyOf(m))) return { ...m, ...change };
  const draft: PdfPageModel = { ...m, ...change, result: null, sample: null, boxcarRun: null };
  const prev = pageView(m);
  const next = pageView(draft);
  const spinChanged = next.spinFit !== prev.spinFit;
  const before = new Map(m.params.map((p) => [p.id, p]));
  // Positions re-seed on a single-phase page; a multi-phase page has no other parameterization, so its rows carry by id.
  const realized = how.kick || prev.multiPhase ? null : applyParameters(prev.fitStructure, prev.bindings, valuesOf(m.params)).model;
  const posSeed = realized ? positionShiftValuesFor(next.fitStructure, next.bindings, realized) : null;
  const params = next.spec.params.map((p) => {
    if (p.kind === "positionShift" && posSeed) {
      const v = posSeed[p.id] ?? 0;
      // Rows carrying a real displacement enter free (they hold the fit); the rest keep the spec's default.
      return { ...p, value: v, fixed: Math.abs(v) > 1e-8 ? false : p.fixed };
    }
    if (p.kind === "positionShift" && how.kick) return p;
    if (how.kick && !SETTING_FREE.has(p.kind)) return p;
    // A new spin model's moment rows replace the old ones: moment ids repeat across magnetic groups.
    if (spinChanged && isMagneticModelParameterKind(p.kind)) return p;
    const old = before.get(p.id);
    return old ? { ...p, value: old.value, fixed: old.fixed } : p;
  });
  // A shared site's last occupancy follows the kept others (and a new total).
  return { ...draft, params: withSiteSumValues(params) };
}

// ── the changes ──────────────────────────────────────────────────────────────

/** Free or fix rows by id. */
export function withFixed(m: PdfPageModel, changes: readonly { readonly id: string; readonly fixed: boolean }[]): PdfPageModel {
  const fixed = new Map(changes.map((c) => [c.id, c.fixed]));
  return { ...m, params: m.params.map((p) => (fixed.has(p.id) ? { ...p, fixed: fixed.get(p.id)! } : p)) };
}

/** One row edited in the parameter panel; the rows tied to it follow. */
export function withParameter(m: PdfPageModel, id: string, patch: Partial<RefinementParameter>): PdfPageModel {
  return { ...m, params: withSiteSumValues(m.params.map((p) => (p.id === id ? { ...p, ...patch } : p))) };
}

/** The rows with each shared site's last occupancy at what its tie gives from the others now. */
function withSiteSumValues(params: RefinementParameter[]): RefinementParameter[] {
  const followers = siteSumConstraints(params).map((c) => c.follower);
  return followers.length > 0 ? withTieValues(params, new Set(followers)) : params;
}

/**
 * One shared site's total occupancy (by its key, the first member's label): 1
 * clears it, below 1 leaves vacancies. The spec changes (the last occupancy's
 * tie), so the last fit is cleared; every row keeps its value and the last
 * occupancy follows the new total.
 */
export function withSiteTotal(m: PdfPageModel, key: string, total: number): PdfPageModel {
  const { [key]: _old, ...rest } = m.siteTotals;
  return withSpecChange(m, { siteTotals: total === 1 ? rest : { ...rest, [key]: total } });
}

/** Values back to their starting values (these ids, or every one), every row and free choice kept; the last fit cleared. */
export function withReset(m: PdfPageModel, ids?: readonly string[]): PdfPageModel {
  const only = ids ? new Set(ids) : null;
  return { ...m, params: m.params.map((p) => (only && !only.has(p.id) ? p : { ...p, value: p.initialValue })), result: null };
}

/** The fit window; null restores the page's default. */
export function withFitRange(m: PdfPageModel, range: FitWindow | null): PdfPageModel {
  return { ...m, fitRange: range ? { min: range.min, max: range.max } : m.defaultRange };
}

/**
 * The primary phase's ADP model: one U per site, or the symmetry-allowed
 * tensor, seeded from the ADPs as refined so far; the new rows enter fixed.
 * The same model is no change.
 */
export function withAdpModel(m: PdfPageModel, anisotropic: boolean): PdfPageModel {
  const v = pageView(m);
  const model = anisotropic ? "anisotropic" : "isotropic";
  if (model === v.adpModel) return m;
  const refined = applyParameters(v.fitStructure, v.primaryBindings, valuesOf(m.params)).model;
  return withSpecChange(m, { adp: { model, seeds: Object.fromEntries(refined.sites.map((site) => [site.label, site.adp])) } });
}

/** Positions as per-coordinate shifts or as mode amplitudes; the geometry carries over exactly. */
export function withPositionMode(m: PdfPageModel, mode: "atomic" | "irreps"): PdfPageModel {
  if (mode === m.positionMode) return m;
  return withSpecChange(m, { positionMode: mode });
}

/** Back to the parent's per-coordinate positions: the mode set in force dropped (✕ clear). */
export function withoutModes(m: PdfPageModel): PdfPageModel {
  if (m.modes === null && m.positionMode === "atomic") return m;
  return withSpecChange(m, { modes: null, positionMode: "atomic" });
}

/**
 * The structure decomposed against a high-symmetry parent into refinable
 * distortion-mode amplitudes, seeded to reproduce it exactly (the curve does
 * not move). `message`: why nothing changed, or what the set holds.
 */
export function withParentModes(m: PdfPageModel, parent: StructureModel, parentName: string): { readonly model: PdfPageModel; readonly message: string } {
  const set = buildDistortionModes(parent, m.loaded);
  if (set.modes.length === 0) return { model: m, message: "no child site could be paired with the parent structure — check that both CIFs share the same lattice/setting" };
  return {
    model: withSpecChange(m, { modes: { set, parentName }, positionMode: "irreps" }),
    message: `${set.modes.length} mode(s), total |A| = ${set.totalAmplitude.toFixed(4)} Å${set.unpaired.length ? ` · unpaired: ${set.unpaired.join(", ")}` : ""}`,
  };
}

/**
 * A chosen subgroup: the child realized (Wyckoff orbits split) from the
 * current refined geometry, with every distortion it permits as an amplitude
 * seeded at 0 and fixed; the setting-free rows carry over. `label` names it.
 */
export function withSubgroup(m: PdfPageModel, node: SubgroupNode): { readonly model: PdfPageModel; readonly label: string; readonly message: string } {
  const name = node.identity.hermannMauguin ?? node.identity.pointGroup ?? "subgroup";
  const label = node.identity.number !== undefined ? `${name} #${node.identity.number}` : `${name} (index ${node.index})`;
  const v = pageView(m);
  const refined = applyParameters(v.fitStructure, v.bindings, valuesOf(m.params)).model;
  const child = realizeSubgroup(refined, node.operations, node.identity);
  const set = buildSymmetryModes(child);
  if (set.modes.length === 0) return { model: m, label, message: `${label}: this subgroup leaves every site symmetry-pinned — no refinable distortion modes` };
  return {
    model: withSpecChange(m, { modes: { set, parentName: label, fromActivation: true }, positionMode: "irreps" }, { kick: true }),
    label,
    message: `lowered to ${label}: ${child.sites.length} child site(s) · ${set.modes.length} distortion mode(s) — free the rows to refine (Positions group)`,
  };
}

/** The starting amplitude of an activated mode (Å, whole cell): a polar mode's χ² is stationary at 0. */
export const ACTIVATION_KICK = 0.05;

/**
 * One symmetry-breaking mode activated from the current refined geometry: the
 * isotropy subgroup's child realized, the activated field the leading free
 * amplitude with a small starting kick (±a are inversion domains with the
 * same G(r), so a gradient fit could never leave 0); the setting-free rows
 * carry over.
 */
export function withActivatedMode(m: PdfPageModel, term: DisplaciveIrrepTerm, sub: { readonly identity: SubgroupIdentity; readonly field: DisplacementField }): { readonly model: PdfPageModel; readonly label: string; readonly message: string } {
  const subName = sub.identity.hermannMauguin ?? sub.identity.pointGroup ?? "subgroup";
  const label = `${term.irrep.label} → ${subName}`;
  const v = pageView(m);
  // From the refined geometry, not the loaded CIF: the child spec then self-seeds the refined values in its own setting.
  const refined = applyParameters(v.fitStructure, v.bindings, valuesOf(m.params)).model;
  // The field again on the refined anchor (the atoms moved with the fit): by irrep label, then by the subgroup it leads to.
  const termNow = decomposeDisplacementRepresentation(refined).terms.find((t) => t.irrep.label === term.irrep.label && !t.trivial);
  let fieldNow: DisplacementField | null = null;
  for (const f of termNow ? projectIsotypicModes(refined, undefined, termNow, refined.spaceGroup.operations) : []) {
    const id = identifySubgroup(stabilizerOfField(f, refined.spaceGroup.operations), refined.spaceGroup.operations);
    if (id.number !== undefined ? id.number === sub.identity.number : id.pointGroup === sub.identity.pointGroup && id.index === sub.identity.index) {
      fieldNow = f;
      break;
    }
  }
  if (!fieldNow) return { model: m, label, message: `activation failed: ${label} not found on the refined structure (did the fit lower the effective symmetry?)` };
  const act = activateDisplacementMode(refined, fieldNow, label);
  // A purely acoustic field is projected away: target the kick by the active mode's id, never by index.
  const activeId = act.modeSet.modes.find((mode) => mode.active)?.id;
  if (activeId === undefined) return { model: m, label, message: `activation of ${label} produced no refinable mode (the field is pure rigid translation) — nothing to do` };
  const set: DistortionModeSet = {
    ...act.modeSet,
    parameters: act.modeSet.parameters.map((p) => (p.id === activeId ? { ...p, value: ACTIVATION_KICK, initialValue: ACTIVATION_KICK, fixed: false } : p)),
  };
  return {
    model: withSpecChange(m, { modes: { set, parentName: label, fromActivation: true }, positionMode: "irreps" }, { kick: true }),
    label,
    message: `activated ${label}${sub.identity.number !== undefined ? ` (#${sub.identity.number})` : ""}: ${act.child.sites.length} child site(s) · starting amplitude ${ACTIVATION_KICK} Å`,
  };
}

/**
 * A spin model from the magnetic page, replaced wholesale (never merged): its
 * moment rows join the fit as handed over (none for a preview, which shows the
 * model's own moments), or null to remove it. A model the spin field cannot
 * represent (an incommensurate k) is refused: `message` says why.
 */
export function withSpinModel(m: PdfPageModel, spin: SpinModel | null): { readonly model: PdfPageModel; readonly message: string | null } {
  const unsupported = spin ? unsupportedMpdfModel(spin.magnetic) : null;
  if (unsupported) return { model: m, message: unsupported };
  return { model: withSpecChange(m, { spinModel: spin }), message: null };
}

/**
 * Another structure loaded on the same data: the rows built afresh, and the
 * mode set, the ADP switch, the spin model, the last fit, the posterior and
 * the scan go with the old structure. A reopened project's window gives way
 * to the page's own default.
 */
export function withLoadedStructure(m: PdfPageModel, loaded: StructureModel): PdfPageModel {
  if (loaded === m.loaded) return m;
  return rebuilt({ ...m, loaded, modes: null, adp: null, spinModel: null });
}

/** Phases added or removed (a multi-phase G(r) sum): the rows built afresh, the scale split across the phases. */
export function withExtraPhases(m: PdfPageModel, extraPhases: readonly StructureModel[]): PdfPageModel {
  if (extraPhases === m.extraPhases || (extraPhases.length === 0 && m.extraPhases.length === 0)) return m;
  return rebuilt({ ...m, extraPhases }, false);
}

/** Another G(r) on the same page (it is keyed on the data's id): the rows built afresh, the default window the new data's. */
export function withPattern(m: PdfPageModel, pattern: PdfPattern): PdfPageModel {
  if (pattern === m.pattern) return m;
  return rebuilt({ ...m, pattern });
}

/** A page whose rows are built afresh; on another structure or data the default window is the page's own again, and the window follows it if it moved. */
function rebuilt(m: PdfPageModel, newDefault = true): PdfPageModel {
  const defaultRange = newDefault ? defaultRangeOf(m.pattern, m.preset.fitRange) : m.defaultRange;
  const moved = defaultRange.min !== m.defaultRange.min || defaultRange.max !== m.defaultRange.max;
  const next: PdfPageModel = { ...m, defaultRange, fitRange: moved ? defaultRange : m.fitRange, params: [], result: null, sample: null, boxcarRun: null };
  return { ...next, params: freshRows(next) };
}

/** The boxcar plan, edited in the Boxcar view. */
export function withBoxcarPlan(m: PdfPageModel, patch: Partial<BoxcarPlan>): PdfPageModel {
  return { ...m, boxcarPlan: { ...m.boxcarPlan, ...patch } };
}

/**
 * One box's refined values on the rows (an explicit act: a scan never moves
 * them). The last fit is cleared rather than set to the box's: its esds belong
 * to a narrow window, and the page reads `result` as the whole window's fit.
 */
export function withBoxcarStep(m: PdfPageModel, seriesIndex: number, windowIndex: number): { readonly model: PdfPageModel; readonly center: number; readonly note: string } | null {
  const run = m.boxcarRun;
  const series = run?.series[seriesIndex];
  const w = run?.windows[windowIndex];
  if (!run || !series || !w) return null;
  const si = boxcarStepIndex(series.direction, windowIndex, run.windows.length, series.result.steps.length);
  const step = si >= 0 ? series.result.steps[si] : undefined;
  if (!step) return null;
  return {
    model: { ...m, params: m.params.map((p) => ({ ...p, value: step.result.parameters[p.id] ?? p.value })), result: null },
    center: w.center,
    note: `adopted the ${w.center.toFixed(2)} Å box's values from the ${series.direction === "up" ? "low → high r" : "high → low r"} pass (${w.min.toFixed(2)}–${w.max.toFixed(2)} Å, Rw ${(100 * (step.result.agreement.rWeighted ?? 0)).toFixed(2)}%) — the fit window is unchanged; refine to get esds for the full window`,
  };
}

// ── the fits ─────────────────────────────────────────────────────────────────

/** The request the Refine button, Prefit and the probe share. */
function refineRequest(m: PdfPageModel, start: readonly RefinementParameter[], options: Partial<RefinementOptions>) {
  const v = pageView(m);
  return { structure: v.fitStructure, pattern: m.pattern, parameters: [...start], bindings: [...v.bindings], restraints: v.spec.restraints, fitRange: m.fitRange, options };
}

/** What a fit found, to land on the page it ran on (`withFit`). */
export interface PdfFit {
  readonly values: Readonly<Record<string, number>>;
  readonly result: RefinementResult;
  /** The History step's label. */
  readonly label: string;
  readonly key: SpecKey;
}

/** The Refine button: nuclear G(r), the sum of the phases, or nuclear + magnetic with a spin model. Throws CANCELLED or the engine's error. */
export async function pdfFit(client: PdfCompute, m: PdfPageModel, onLive?: OnLive): Promise<PdfFit> {
  const v = pageView(m);
  const req = refineRequest(m, m.params, { maxIterations: 30 });
  const res = v.spinFit
    ? await client.refineMpdfParallel({ ...req, magnetic: v.spinFit.magnetic }, onLive)
    : await client.refinePdfParallel({ ...req, ...(v.multiPhase ? { extraPhases: [...m.extraPhases] } : {}) }, onLive);
  return { values: res.parameters, result: res, label: v.spinFit ? "Refine nuclear + magnetic G(r)" : "Refine", key: specKeyOf(m) };
}

/**
 * The multi-start (one engine, two faces): with no fit yet the wide Prefit,
 * after one a lighter Escape minimum; the lowest χ² of the baseline and the
 * restarts is kept. With a spin model it is the magnetic one (the nuclear
 * scaffold frozen, the moments searched, one joint fit, the ±m twin
 * canonicalized). `summary`: what it found, for the status line.
 */
export async function pdfThorough(client: PdfCompute, m: PdfPageModel, onLive?: OnLive): Promise<PdfFit & { readonly summary: string }> {
  const v = pageView(m);
  const escape = m.result !== null;
  const req = refineRequest(m, m.params, { maxIterations: 25 });
  const restarts = escape ? { restarts: 4, escapeSigma: 2 } : { restarts: 8 };
  const ms = v.spinFit
    ? await client.refineMpdfMultiStart({ ...req, magnetic: v.spinFit.magnetic }, restarts, onLive)
    : await client.refinePdfMultiStart({ ...req, ...(v.multiPhase ? { extraPhases: [...m.extraPhases] } : {}) }, restarts, onLive);
  return {
    values: ms.final.parameters,
    result: ms.final,
    label: escape ? "Escape minimum" : "Prefit",
    key: specKeyOf(m),
    summary: `${escape ? "escape" : "prefit"}: best of ${ms.restartsRun + 1} starts${ms.bestStartIndex > 0 ? ` (restart ${ms.bestStartIndex} won)` : " (baseline held)"} · Rw ${(100 * (ms.final.agreement.rWeighted ?? 0)).toFixed(2)}%`,
  };
}

/** A fit's values on the rows of the page as it is when the fit lands, and its result; nothing when the spec changed meanwhile. */
export function withFit(m: PdfPageModel, f: PdfFit): PdfPageModel {
  if (!landsOn(m, f.key)) return m;
  return { ...m, params: m.params.map((p) => ({ ...p, value: f.values[p.id] ?? p.value })), result: f.result };
}

/** The Refine button's fit with these options, returned and never applied. */
export function pdfProbe(client: PdfCompute, m: PdfPageModel, options: Partial<RefinementOptions>): Promise<RefinementResult> {
  const v = pageView(m);
  const req = refineRequest(m, m.params, options);
  return v.spinFit
    ? client.refineMpdfParallel({ ...req, magnetic: v.spinFit.magnetic })
    : client.refinePdfParallel({ ...req, ...(v.multiPhase ? { extraPhases: [...m.extraPhases] } : {}) });
}

/**
 * The magnetic page's moment fit against this G(r): only the moments move —
 * the nuclear scaffold and the mPDF envelope rows (the ordered scale is
 * degenerate with |m|) are frozen — from a few seeded restarts, since m = 0 is
 * a stationary point (d(r) is quadratic in the moments). The ranking keeps
 * them in each of its starts (magneticStep.ts, nestedStarts).
 */
export async function momentFit(client: PdfCompute, m: PdfPageModel, magnetic: MagneticModel, momentParams: readonly RefinementParameter[], momentBindings: readonly ParameterBinding[]): Promise<{ readonly values: Record<string, number>; readonly agreement: number | null }> {
  const v = pageView(m);
  const nuclearFixed = m.params.filter((p) => !isMagneticModelParameterKind(p.kind)).map((p) => ({ ...p, fixed: true }));
  // The applied model's k rows would write its k onto every candidate.
  const nuclearBindings = v.bindings.filter((b) => !isMagneticModelParameterKind(b.kind));
  const ms = await client.refineMpdfMultiStart(
    { structure: v.fitStructure, magnetic, pattern: m.pattern, parameters: [...nuclearFixed, ...momentParams], bindings: [...nuclearBindings, ...momentBindings], fitRange: m.fitRange, options: { maxIterations: 20 } },
    { restarts: 3 },
  );
  const values: Record<string, number> = {};
  for (const p of momentParams) values[p.id] = ms.final.parameters[p.id] ?? p.value;
  return { values, agreement: ms.final.agreement.rWeighted ?? null };
}

/** A boxcar plan as the Agent (or the Boxcar view) runs it: the panel's plan, with the Agent's own free set and bonds. */
export interface BoxcarScanPlan {
  readonly width: number;
  readonly step: number;
  readonly direction: BoxcarPlan["direction"];
  readonly randomStart: boolean;
  readonly restarts: number;
  readonly bonds?: readonly string[];
  readonly free?: readonly string[];
}

/** The plan the Agent asks a scan for (PdfAgentPort's `boxcar`). */
export interface AgentBoxcarPlan {
  readonly width: number;
  readonly step: number;
  readonly direction: BoxcarPlan["direction"];
  readonly bonds?: readonly string[];
  readonly free?: readonly string[];
  /** Perturbed starts per box beyond the seeded one; none unless the Agent asks. */
  readonly restarts?: number;
}

/**
 * The Agent's scan on the panel's plan: its box, direction and restarts
 * (the seeded start alone unless it asks, whatever the panel's tick; the
 * panel's count kept when it asks for none), and its own bonds and free set.
 * The panel then shows this plan.
 */
export function agentBoxcarPlan(panel: BoxcarPlan, agent: AgentBoxcarPlan): BoxcarScanPlan {
  const restarts = agent.restarts ?? 0;
  return {
    width: agent.width,
    step: agent.step,
    direction: agent.direction,
    randomStart: restarts > 0,
    restarts: restarts > 0 ? restarts : panel.restarts,
    ...(agent.bonds ? { bonds: agent.bonds } : {}),
    ...(agent.free ? { free: agent.free } : {}),
  };
}

/** How a scan went: complete, or stopped with the boxes already fitted kept (`partial`). */
export interface BoxcarOutcome {
  readonly run: BoxcarRun | null;
  readonly key: SpecKey;
  /** Null when the scan finished; why it stopped otherwise. */
  readonly stopped: null | "cancelled" | { readonly failed: string };
}

/**
 * The boxcar scan: a fixed-width box slid across the fit window, refined at
 * each position from the previous box's values (every box refines the free
 * set inside its own window, the page's window untouched); "both" is two
 * passes over the same boxes from the same model. The rows are left as they
 * are. `onRun` sees the run as it grows, box by box. A cancelled or failed
 * scan resolves to the boxes already fitted, marked partial.
 */
export async function pdfBoxcar(client: PdfCompute, m: PdfPageModel, plan: BoxcarScanPlan, hooks: { readonly onRun?: (run: BoxcarRun) => void; readonly onProgress?: (done: number, total: number) => void } = {}): Promise<BoxcarOutcome> {
  const v = pageView(m);
  const key = specKeyOf(m);
  const opts = { range: { min: m.fitRange.min, max: m.fitRange.max }, width: plan.width, step: plan.step };
  const issue = boxcarPlanIssue(opts);
  if (issue) throw new Error(issue);
  const windows = boxcarWindows(opts);
  if (windows.length === 0) return { run: null, key, stopped: null };
  const restarts = plan.randomStart ? plan.restarts : 0;
  // The Agent may name the scan's own free set; the panel's free flags stay as they are.
  const own = plan.free ? new Set(plan.free) : null;
  const scanParams = own ? m.params.map((p) => (p.expression ? p : { ...p, fixed: !own.has(p.id) })) : m.params;
  const freeIds = scanParams.filter((p) => !p.fixed && !p.expression).map((p) => p.id);
  const directions: BoxcarDirection[] = plan.direction === "both" ? ["up", "down"] : [plan.direction];
  const base = { windows, width: plan.width, restarts, freeIds, ...(plan.bonds?.length ? { bondSites: [...plan.bonds] } : {}) };
  const total = windows.length * directions.length;
  const evolutionOf = (steps: readonly SequentialStep[]): SequentialResult["evolution"] =>
    scanParams.map((p) => ({ parameterId: p.id, values: steps.map((s) => s.result.parameters[p.id]), esd: steps.map((s) => s.result.esd[p.id]) }));
  const done: BoxcarSeries[] = [];
  let streaming: SequentialStep[] = [];
  const runOf = (inFlight: BoxcarDirection | null, partial: boolean): BoxcarRun | null => {
    const series = [...done, ...(inFlight !== null && streaming.length > 0 ? [{ direction: inFlight, result: { steps: [...streaming], evolution: evolutionOf(streaming) } }] : [])];
    return series.length ? { ...base, series, ...(partial ? { partial: true } : {}) } : null;
  };
  hooks.onProgress?.(0, total);
  try {
    for (const direction of directions) {
      streaming = [];
      const ordered = direction === "up" ? windows : [...windows].reverse();
      const before = done.reduce((n, d) => n + d.result.steps.length, 0);
      const res = await client.refinePdfBoxcar(
        { structure: v.fitStructure, pattern: m.pattern, parameters: [...scanParams], bindings: [...v.bindings], restraints: v.spec.restraints, options: { maxIterations: 20 }, ...(v.spinFit ? {} : v.multiPhase ? { extraPhases: [...m.extraPhases] } : {}) },
        ordered,
        {
          ...(v.spinFit ? { magnetic: v.spinFit.magnetic } : {}),
          ...(restarts > 0 ? { restarts } : {}),
          onStep: (step, index) => {
            streaming.push(step);
            hooks.onProgress?.(before + index + 1, total);
            const run = runOf(direction, true);
            if (run) hooks.onRun?.(run);
          },
        },
      );
      done.push({ direction, result: res });
      streaming = [];
    }
    const run = runOf(null, false);
    if (run) hooks.onRun?.(run);
    return { run, key, stopped: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A stopped scan still fitted boxes: keep them, the whole run marked partial.
    const run = runOf(directions[done.length] ?? null, true);
    if (run) hooks.onRun?.(run);
    return { run, key, stopped: msg.includes(CANCELLED) ? "cancelled" : { failed: msg } };
  }
}

/** A scan (or the part of one that ran) on the page it ran on; nothing when the spec changed meanwhile. */
export function withBoxcarRun(m: PdfPageModel, run: BoxcarRun | null, key: SpecKey): PdfPageModel {
  return landsOn(m, key) ? { ...m, boxcarRun: run } : m;
}

/** What a boxcar scan says, for the status line. */
export function boxcarSummary(m: PdfPageModel, run: BoxcarRun, direction: BoxcarPlan["direction"]): string {
  const bad = run.series.reduce((n, d) => n + d.result.steps.filter((s) => !s.carried).length, 0);
  const last = run.windows.at(-1);
  return `${run.windows.length} boxes of ${run.width} Å across ${m.fitRange.min.toFixed(2)}–${(last?.max ?? m.fitRange.max).toFixed(2)} Å` +
    `${run.series.length > 1 || direction === "both" ? " · both directions" : ` · ${direction === "down" ? "high → low r" : "low → high r"}`}` +
    `${run.restarts > 0 ? ` · best of ${run.restarts + 1} starts per box` : ""}` +
    `${bad > 0 ? ` · ${bad} box(es) diverged and were not carried forward` : ""}`;
}

/** Ensemble steps per posterior run or Continue (each one proposal per walker). */
export const SAMPLE_STEPS = 400;

/**
 * The Bayesian posterior of the free parameters. A fresh run poses the
 * current problem (seeded at the refined values, the LM esds as the esdRatio
 * reference); Continue poses the run's own request again with its resume
 * token, so the chain keeps targeting the same posterior. mPDF has no analytic
 * gradient: the sampler is the gradient-free ensemble either way.
 */
export async function pdfPosterior(client: PdfCompute, m: PdfPageModel, continueRun: boolean, steps = SAMPLE_STEPS, onStep?: (step: number, total: number) => void): Promise<{ readonly sample: PosteriorRun; readonly key: SpecKey }> {
  const v = pageView(m);
  const key = specKeyOf(m);
  const prior = continueRun ? m.sample : null;
  const req: SampleRequest = prior
    ? prior.req
    : {
        structure: v.fitStructure,
        ...(v.spinFit ? { magnetic: v.spinFit.magnetic } : v.multiPhase ? { extraPhases: [...m.extraPhases] } : {}),
        pattern: m.pattern,
        parameters: [...m.params],
        bindings: [...v.bindings],
        restraints: v.spec.restraints,
        fitRange: m.fitRange,
      };
  const total = (prior ? prior.result.resume.stepIndex : 0) + steps;
  const options: SampleOptions = {
    nSteps: steps,
    seed: 0xbae5,
    ...(prior ? { init: prior.result.resume } : {}),
    ...(m.result?.esd ? { linearizedEsd: m.result.esd } : {}),
    ...(onStep ? { onStep: (s: number) => onStep(s, total) } : {}),
  };
  const result = "magnetic" in req ? await client.sampleMpdfPosterior(req, options) : await client.samplePdfPosterior(req, options);
  return { sample: { result, req }, key };
}

/** A posterior run on the page it sampled; nothing when the spec changed meanwhile. */
export function withPosterior(m: PdfPageModel, sample: PosteriorRun, key: SpecKey): PdfPageModel {
  return landsOn(m, key) ? { ...m, sample } : m;
}

// ── what the page shows the Agent and the report ─────────────────────────────

/** The page as the Agent reads it (agent/port.ts). */
export function liveStateOf(m: PdfPageModel, extra: { readonly busy: boolean; readonly rw?: number }): PdfLiveState {
  const v = pageView(m);
  const ext = { min: m.pattern.points[0]?.r ?? 0, max: m.pattern.points[m.pattern.points.length - 1]?.r ?? 1 };
  return {
    phases: v.phases.map((ph) => ph.structure),
    refinedPhases: v.refinedPhases,
    pattern: m.pattern,
    parameters: m.params,
    bindings: v.bindings,
    result: m.result,
    fitRange: { min: m.fitRange.min, max: m.fitRange.max },
    defaultRange: { min: m.defaultRange.min, max: m.defaultRange.max },
    extent: ext,
    busy: extra.busy,
    rw: extra.rw ?? v.rw,
    curves: v.curves,
    observationCount: v.observationCount,
    positionMode: m.positionMode,
    adpModel: v.adpModel,
    spinModel: v.spinFit !== null,
    warnings: [v.radiationWarning, v.motionConflict, v.adpWarning].filter((w): w is string => w !== null),
    source: m.pattern.name,
    restraints: v.spec.restraints,
  };
}

/** The page's report (Export ▾ → Report): every phase as refined, the agreement, the spin model, the last boxcar scan. */
export function reportInputOf(m: PdfPageModel, extra: { readonly explored?: MagneticExploration | null; readonly rw?: number } = {}): ReportInput {
  const v = pageView(m);
  return pdfReportInput({
    phases: v.refinedPhases,
    params: m.params,
    bindings: v.bindings,
    result: m.result,
    pattern: m.pattern,
    rw: extra.rw ?? v.rw,
    fitRange: m.fitRange,
    curves: v.curves,
    positionMode: m.positionMode,
    spinModel: v.spinFit ? v.refinedMagnetic ?? v.spinFit.magnetic : null,
    explored: extra.explored ?? null,
    ...(v.motionConflict || v.radiationWarning || siteSumRangeWarnings(m.params).length > 0 ? { warnings: [v.motionConflict, v.radiationWarning, ...siteSumRangeWarnings(m.params)].filter((w): w is string => w !== null) } : {}),
    boxcar: m.boxcarRun ? boxcarTable(m.boxcarRun, v.fitStructure, v.primaryBindings, m.params) : null,
  });
}
