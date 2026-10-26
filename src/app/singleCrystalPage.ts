/**
 * The single-crystal page's operations, one implementation for both of its
 * adapters: the workbench (SingleCrystalWorkbench.tsx), which holds the page
 * in React state, and the Agent's headless page (testSupport/agentHeadless.ts),
 * which holds it in a variable. As powderPage.ts for powder.
 *
 * The page is a value (`SingleCrystalPageModel`): what was loaded and the
 * settings that are saved with a project or change the fit. Every change is a
 * function that returns the next value, every derived quantity (the dataset
 * fitted, the structure fitted, the spec, the comparisons) is read from
 * `pageView`, and the fits take the compute client and return what they found.
 * Nothing here touches React.
 */

import type { SingleCrystalWorkspace } from "@/core/project/types";
import { restoreMomentBindings, restoreSingleCrystalParameters, singleCrystalWorkspaceFrom, type ModulatedInputs } from "@/app/projectIo";
import type { AtomSite, DistanceRestraint, RidingRule, StructureModel } from "@/core/crystal/types";
import { isInversion, type ExtinctionModel, type OmittedMeasurement, type Radiation, type ResolutionRange, type ShelxWeighting, type SingleCrystalDataset, type TwinLaw } from "@/core/diffraction/types";
import type { ReflectionObsCalc } from "@/core/workflow/obsCalc";
import { isMagneticModelParameterKind, type ParameterBinding, type RefinementOptions, type RefinementParameter, type RefinementResult } from "@/core/refinement/types";
import type { ComputeClient } from "@/workers/computeClient";
import { measurementMerge } from "@/core/diffraction/merge";
import {
  SINGLE_CRYSTAL_REFINE_OPTIONS, buildSingleCrystalSpec, guidedSingleCrystalParams, improper, inResolution, isOmitted, mergedDataset, optimalScale,
  singleCrystalRefinementComparison, withinResolution, withoutOmitted,
} from "@/core/workflow/singleCrystalRefinement";
import { EXTINCTION_PARAMETER_LABELS, suggestShelxWeighting, type WeightingSuggestion } from "@/core/diffraction/singleCrystalFactors";
import { isHydrogen, withAdpModel as structureWithAdpModel } from "@/core/crystal/adp";
import { ridingRules, type RidingOptions } from "@/core/crystal/riding";
import { inversionText, invertedModel, invertedRiding, invertedTwinFractions } from "@/core/crystal/inversion";
import { withEqualTies, type EqualTieUpdate } from "@/core/refinement/constraints";
import { keptRow, withValidUserTies } from "@/app/powderSession";
import { dSpacing } from "@/core/crystal/unitCell";
import type { MagneticModel } from "@/core/magnetic/types";
import { applyMagneticMoments, magneticComparison } from "@/core/workflow/magnetic";
import { applyParameters } from "@/core/workflow/apply";
import type { ReportInput } from "@/core/export/report";
import { singleCrystalReportInput, type MagneticExploration } from "@/app/reportInputs";
import { singleCrystalValidation } from "@/core/diagnostics/singleCrystalValidation";
import { singleCrystalChecks, type ValidationVerdict } from "@/core/diagnostics/validationChecks";
import { shelxWeights, singleCrystalAgreement } from "@/core/diffraction/singleCrystalFactors";
import { nonPositiveDefiniteSites } from "@/core/crystal/adp";
import type { SingleCrystalLiveState } from "@/agent/port";
import type { FitOptions } from "@/app/magneticStep";
import { noiseOf, type MomentFit } from "@/core/magnetic/momentRestarts";

/** The probe the reflections were measured with: a bare reflection file cannot say, so the user picks it. */
export type Probe = "xray" | "neutron" | "neutron-tof";

/** The ADP model switched to on the page, seeded per site from the ADPs as refined then; null keeps the structure's own. */
export interface AdpSwitch {
  readonly model: "isotropic" | "anisotropic";
  readonly seeds: Readonly<Record<string, AtomSite["adp"]>>;
  readonly hydrogensIsotropic: boolean;
}

export interface SingleCrystalPageModel {
  /** The structure as loaded (a CIF, a SHELX .ins/.res). */
  readonly loaded: StructureModel;
  /** The measurement as loaded. */
  readonly dataset: SingleCrystalDataset;
  /** The model inverted through the origin (invert_structure), in place of the one loaded. */
  readonly inverted: boolean;
  /** The wavelength set on the page; null: the file's, else 1.54 Å. */
  readonly wavelength: number | null;
  readonly probe: Probe;
  readonly extinctionModel: ExtinctionModel;
  /** SHELXL's WGHT a b; null for w = 1/σ². */
  readonly weighting: ShelxWeighting | null;
  /** SHELXL's TWIN laws, each with its fraction row; empty when untwinned. */
  readonly twinLaws: readonly TwinLaw[];
  /** The equivalents merged as SHELXL's MERG 2, or every measurement. */
  readonly merged: boolean;
  readonly adp: AdpSwitch | null;
  /** Riding hydrogens (SHELXL's AFIX); null when every atom refines on its own. */
  readonly riding: readonly RidingRule[] | null;
  /** SHELXL's DFIX and SADI. */
  readonly restraints: readonly DistanceRestraint[];
  readonly params: readonly RefinementParameter[];
  readonly result: RefinementResult | null;
  /** A magnetic model applied from the symmetry analysis, with its moment rows' bindings. */
  readonly magnetic: MagneticModel | null;
  readonly momentBindings: readonly ParameterBinding[];
  /** SHELX's OMIT filter at |Fo² − Fc²|/σ, and GSAS-II's minimum extinction. */
  readonly filter: { readonly on: boolean; readonly cutoffSigma: number; readonly minExtinction: number | null };
  /** Measurements left out by hand (SHELXL's OMIT h k l). */
  readonly omitted: readonly OmittedMeasurement[];
  /** The resolution range fitted (SHELXL's SHEL). */
  readonly resolution: ResolutionRange;
}

/** The compute client's fits the page runs. */
export type SingleCrystalCompute = Pick<ComputeClient, "refineSingleCrystalParallel" | "refineMagneticParallel" | "refineSingleCrystalMultiStart" | "refineMagneticSingleCrystalMultiStart">;

// ── the page as loaded, or as saved ──────────────────────────────────────────

/**
 * The page on a structure and a measurement: the probe from the loaded
 * instrument when there is one, a saved workspace's settings when one is
 * reopened, else what the files carry.
 */
export function singleCrystalPage(loaded: StructureModel, dataset: SingleCrystalDataset, opts: { readonly instrumentProbe?: "xray" | "neutron"; readonly restore?: SingleCrystalWorkspace } = {}): SingleCrystalPageModel {
  const r = opts.restore;
  const seed: SingleCrystalPageModel = {
    loaded,
    dataset,
    inverted: r?.inverted ?? false,
    wavelength: r?.wavelength ?? null,
    probe: r?.probe ?? opts.instrumentProbe ?? dataset.radiation.kind,
    extinctionModel: r?.extinctionModel ?? dataset.extinctionModel ?? "shelx",
    weighting: r?.weighting ?? dataset.weighting ?? null,
    twinLaws: r?.twinLaws ?? dataset.twinLaws ?? [],
    merged: r?.merged ?? false,
    adp: r?.adpModel ? { model: r.adpModel, seeds: {}, hydrogensIsotropic: r.probe === "xray" } : null,
    riding: r?.riding ?? (loaded.riding?.length ? loaded.riding : null),
    restraints: r?.restraints ?? loaded.restraints ?? [],
    params: [],
    result: r?.refinement.lastResult ?? null,
    magnetic: r?.magnetic ?? null,
    momentBindings: r ? restoreMomentBindings(r) : [],
    filter: { on: r?.outlierFilter?.on ?? false, cutoffSigma: r?.outlierFilter?.cutoffSigma ?? 6, minExtinction: r?.outlierFilter?.minExtinction ?? null },
    omitted: r?.omitted ?? [],
    resolution: r?.resolution ?? {},
  };
  // Nuclear rows from the fresh spec, with a saved project's state overlaid by id; its moment rows, which no builder regenerates, appended.
  const fresh = pageView(seed).spec.params;
  return { ...seed, params: r ? restoreSingleCrystalParameters(fresh, r) : fresh };
}

/** The page as a project saves it; the magnetic dataset and the modulated-moment form are the workbench's. */
export function workspaceOf(m: SingleCrystalPageModel, extra: { readonly magneticDataset?: SingleCrystalDataset | null; readonly modulated: ModulatedInputs }): SingleCrystalWorkspace {
  return singleCrystalWorkspaceFrom({
    dataset: m.dataset,
    magneticDataset: extra.magneticDataset ?? null,
    probe: m.probe,
    params: m.params,
    bindings: [...pageView(m).bindings, ...m.momentBindings],
    result: m.result,
    magnetic: m.magnetic,
    filterOn: m.filter.on,
    cutoffSigma: m.filter.cutoffSigma,
    minExtinction: m.filter.minExtinction,
    omitted: m.omitted,
    extinctionModel: m.extinctionModel,
    resolution: m.resolution,
    ...(m.wavelength !== null ? { wavelength: m.wavelength } : {}),
    ...(m.riding ? { riding: m.riding } : {}),
    ...(m.weighting ? { weighting: m.weighting } : {}),
    ...(m.twinLaws.length ? { twinLaws: m.twinLaws } : {}),
    ...(m.restraints.length ? { restraints: m.restraints } : {}),
    ...(m.merged ? { merged: m.merged } : {}),
    ...(m.inverted ? { inverted: m.inverted } : {}),
    modulated: extra.modulated,
    adpModel: m.adp?.model ?? null,
  });
}

// ── what the page derives ────────────────────────────────────────────────────

export interface SingleCrystalPageView {
  /** The model inverted through the origin, when it is. */
  readonly inversion: ReturnType<typeof invertedModel> | null;
  /** The structure the page works on: the one loaded, or its inverse. */
  readonly structure: StructureModel;
  /** "the inverted hand of …", when inverted. */
  readonly handText: string | undefined;
  readonly baseWavelength: number;
  readonly radiation: Radiation;
  /** The reflections fitted: the measurement, or its merge. */
  readonly fittedSet: SingleCrystalDataset;
  /** What the physics runs against: the reflections fitted with the probe, the extinction model, the weights and the twin laws. */
  readonly probedDataset: SingleCrystalDataset;
  /** The structure the fit uses: the ADP model, the riding rules and the restraints applied. */
  readonly fitStructure: StructureModel;
  readonly spec: ReturnType<typeof buildSingleCrystalSpec>;
  readonly bindings: readonly ParameterBinding[];
  /** The structure with the current parameter values applied. */
  readonly refinedStructure: StructureModel;
  /** The comparison over every reflection: the residuals the filter reads. */
  readonly fullComparison: ReturnType<typeof singleCrystalRefinementComparison>;
  readonly omittedDataset: SingleCrystalDataset;
  readonly keptDataset: SingleCrystalDataset;
  /** The reflections the fit runs on: less the omissions, outside the range, and what the filter cuts. */
  readonly activeDataset: SingleCrystalDataset;
  readonly omittedCount: number;
  readonly outsideRange: number;
  readonly excluded: number;
  /** R_int and the redundancy: on the active set, or the measurement as loaded when the fit runs on its merge. */
  readonly merge: ReturnType<typeof measurementMerge>;
  /** The comparison on the reflections fitted, with SHELX's agreement. */
  readonly comparison: ReturnType<typeof singleCrystalRefinementComparison>;
  /** Observed against calculated per reflection; with a magnetic model, the total intensity. */
  readonly obsCalc: readonly ReflectionObsCalc[];
}

const views = new WeakMap<SingleCrystalPageModel, View>();
let lastView: View | null = null;

/**
 * What the page derives from its model, computed when first read. A quantity
 * whose inputs are the very values of the page viewed last is taken from it,
 * so a change recomputes only what depends on it (as the workbench's
 * `useMemo` chain did).
 */
export function pageView(m: SingleCrystalPageModel): SingleCrystalPageView {
  const cached = views.get(m);
  if (cached) return cached;
  const v = new View(m, lastView);
  lastView?.detach();
  lastView = v;
  views.set(m, v);
  return v;
}

const same = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

class View implements SingleCrystalPageView {
  private readonly slots = new Map<string, { readonly deps: readonly unknown[]; readonly value: unknown }>();

  constructor(private readonly m: SingleCrystalPageModel, private base: View | null) {}

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

  get inversion(): ReturnType<typeof invertedModel> | null {
    const { loaded, inverted } = this.m;
    return this.memo("inversion", [loaded, inverted], () => (inverted ? invertedModel(loaded) : null));
  }

  get structure(): StructureModel {
    return this.inversion?.structure ?? this.m.loaded;
  }

  get handText(): string | undefined {
    const inv = this.inversion;
    return inv ? inversionText(this.m.loaded, inv) : undefined;
  }

  get baseWavelength(): number {
    const { wavelength, dataset } = this.m;
    return wavelength ?? ("wavelength" in dataset.radiation ? dataset.radiation.wavelength : undefined) ?? 1.54;
  }

  get radiation(): Radiation {
    const { probe } = this.m;
    const wl = this.baseWavelength;
    return this.memo("radiation", [probe, wl], () => radiationOf(probe, wl));
  }

  get fittedSet(): SingleCrystalDataset {
    const { dataset, merged } = this.m;
    const ops = this.structure.spaceGroup.operations;
    return this.memo("fittedSet", [dataset, merged, ops], () => (merged ? mergedDataset(dataset, ops) : dataset));
  }

  get probedDataset(): SingleCrystalDataset {
    const { extinctionModel, weighting, twinLaws } = this.m;
    const fitted = this.fittedSet;
    const radiation = this.radiation;
    return this.memo("probed", [fitted, radiation, extinctionModel, weighting, twinLaws], () => {
      // The page's weights and twin laws replace any the file carried.
      const { weighting: _w, twinLaws: _t, ...rest } = fitted;
      return { ...rest, radiation, extinctionModel, ...(weighting ? { weighting } : {}), ...(twinLaws.length ? { twinLaws } : {}) };
    });
  }

  get fitStructure(): StructureModel {
    const { adp, riding, restraints } = this.m;
    const structure = this.structure;
    return this.memo("fitStructure", [structure, adp, riding, restraints], () => fitStructureOf(structure, adp, riding, restraints));
  }

  get spec(): ReturnType<typeof buildSingleCrystalSpec> {
    const fit = this.fitStructure;
    const probed = this.probedDataset;
    return this.memo("spec", [fit, probed], () => buildSingleCrystalSpec(fit, probed, { extinction: 0 }));
  }

  get bindings(): readonly ParameterBinding[] {
    return this.spec.bindings;
  }

  get refinedStructure(): StructureModel {
    const { params } = this.m;
    const fit = this.fitStructure;
    const bindings = this.bindings;
    return this.memo("refined", [fit, params, bindings], () => applyParameters(fit, bindings, Object.fromEntries(params.map((p) => [p.id, p.value]))).model);
  }

  get fullComparison(): ReturnType<typeof singleCrystalRefinementComparison> {
    const { params } = this.m;
    const fit = this.fitStructure;
    const probed = this.probedDataset;
    const bindings = this.bindings;
    return this.memo("fullComparison", [fit, probed, params, bindings], () => singleCrystalRefinementComparison(fit, probed, params, bindings));
  }

  get omittedDataset(): SingleCrystalDataset {
    const { omitted } = this.m;
    const probed = this.probedDataset;
    return this.memo("omitted", [probed, omitted], () => withoutOmitted(probed, omitted));
  }

  get keptDataset(): SingleCrystalDataset {
    const { resolution } = this.m;
    const omitted = this.omittedDataset;
    const cell = this.structure.cell;
    return this.memo("kept", [omitted, cell, resolution], () => withinResolution(omitted, cell, resolution));
  }

  get activeDataset(): SingleCrystalDataset {
    const { filter, omitted, resolution } = this.m;
    const kept = this.keptDataset;
    if (!filter.on || (filter.cutoffSigma <= 0 && filter.minExtinction === null)) return kept;
    const probed = this.probedDataset;
    const full = this.fullComparison;
    const cell = this.structure.cell;
    return this.memo("active", [probed, kept, omitted, cell, resolution, filter, full], () => ({
      ...probed,
      reflections: probed.reflections.filter((r, i) => {
        if (isOmitted(r, omitted) || !inResolution(r, cell, resolution)) return false;
        const row = full.rows[i];
        return (filter.cutoffSigma <= 0 || Math.abs(row?.deltaOverSigma ?? 0) <= filter.cutoffSigma) && (filter.minExtinction === null || (row?.extinction ?? 1) >= filter.minExtinction);
      }),
    }));
  }

  get omittedCount(): number {
    return this.probedDataset.reflections.length - this.omittedDataset.reflections.length;
  }

  get outsideRange(): number {
    return this.omittedDataset.reflections.length - this.keptDataset.reflections.length;
  }

  get excluded(): number {
    return this.keptDataset.reflections.length - this.activeDataset.reflections.length;
  }

  get merge(): ReturnType<typeof measurementMerge> {
    const { merged, dataset } = this.m;
    const source = merged ? dataset : this.activeDataset;
    const ops = this.structure.spaceGroup.operations;
    return this.memo("merge", [source, ops], () =>
      measurementMerge(source.reflections.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.iObs, sigma: r.sigma ?? 0 })), ops),
    );
  }

  get comparison(): ReturnType<typeof singleCrystalRefinementComparison> {
    const { params, filter } = this.m;
    const cut = (filter.on && this.excluded > 0) || this.omittedCount > 0 || this.outsideRange > 0;
    if (!cut) return this.fullComparison;
    const fit = this.fitStructure;
    const active = this.activeDataset;
    const bindings = this.bindings;
    return this.memo("comparison", [fit, active, params, bindings], () => singleCrystalRefinementComparison(fit, active, params, bindings));
  }

  get obsCalc(): readonly ReflectionObsCalc[] {
    const { magnetic, params, momentBindings } = this.m;
    const cell = this.structure.cell;
    if (magnetic) {
      const fit = this.fitStructure;
      const active = this.activeDataset;
      const bindings = this.bindings;
      return this.memo("obsCalc", [magnetic, cell, fit, active, params, bindings, momentBindings], () =>
        magneticComparison(fit, magnetic, active, params, [...bindings, ...momentBindings]).map((r) => ({
          kind: r.iMagnetic > r.iNuclear ? ("magnetic" as const) : ("nuclear" as const),
          h: r.h, k: r.k, l: r.l,
          d: dSpacing(cell, r.h, r.k, r.l),
          iObs: r.iObs, iCalc: r.iTotal,
          ...(r.sigma !== undefined && r.sigma > 0 ? { sigma: r.sigma } : {}),
        })),
      );
    }
    const comparison = this.comparison;
    return this.memo("obsCalc", [null, cell, comparison], () =>
      comparison.rows.map((r) => ({
        kind: "nuclear" as const,
        h: r.h, k: r.k, l: r.l,
        d: dSpacing(cell, r.h, r.k, r.l),
        iObs: r.foSq, iCalc: r.fcSq,
        ...(r.sigma > 0 ? { sigma: r.sigma } : {}),
      })),
    );
  }
}

function radiationOf(probe: Probe, wavelength: number): Radiation {
  if (probe === "neutron-tof") return { kind: "neutron-tof" };
  if (probe === "xray") return { kind: "xray", wavelength, polarization: 0.5 };
  return { kind: "neutron", wavelength };
}

/** The structure the fit uses: the page's ADP model, riding rules and restraints in place of the file's. */
function fitStructureOf(structure: StructureModel, adp: AdpSwitch | null, riding: readonly RidingRule[] | null, restraints: readonly DistanceRestraint[]): StructureModel {
  const withAdp = adp ? structureWithAdpModel({ ...structure, sites: structure.sites.map((site) => ({ ...site, adp: adp.seeds[site.label] ?? site.adp })) }, adp.model, { hydrogensIsotropic: adp.hydrogensIsotropic }) : structure;
  const { riding: _r, restraints: _x, ...rest } = withAdp;
  return { ...rest, ...(riding ? { riding } : {}), ...(restraints.length ? { restraints } : {}) };
}

/** The ADP model of a structure's sites, as the Agent reads it. */
function adpModelOf(s: StructureModel): "isotropic" | "anisotropic" | "mixed" {
  // Hydrogens that stay isotropic under an anisotropic model (X-ray) do not make it mixed.
  const heavy = s.sites.filter((site) => !isHydrogen(site));
  const aniso = heavy.filter((site) => site.adp.kind === "anisotropic").length;
  return aniso === 0 ? (s.sites.some((site) => site.adp.kind === "anisotropic") ? "mixed" : "isotropic") : aniso === heavy.length ? "anisotropic" : "mixed";
}

/** Whether two twin laws are the same matrix. */
function sameTwinLaw(a: TwinLaw | undefined, b: TwinLaw | undefined): boolean {
  return !!a && !!b && a.matrix.every((row, i) => row.every((v, j) => Math.round(v) === Math.round(b.matrix[i]![j]!)));
}

/** The rows a rebuilt spec gives, each keeping its value and state where the old set had it (unless `fresh` says it starts anew); the moment rows kept. */
function rebuiltRows(m: SingleCrystalPageModel, specParams: readonly RefinementParameter[], fresh: (p: RefinementParameter) => boolean = () => false, adjust: (row: RefinementParameter, p: RefinementParameter) => RefinementParameter = (row) => row): RefinementParameter[] {
  const kept = new Map(m.params.map((p) => [p.id, p]));
  return withValidUserTies([
    ...specParams.map((p) => adjust(keptRow(p, fresh(p) ? undefined : kept.get(p.id)), p)),
    ...m.params.filter((p) => isMagneticModelParameterKind(p.kind)),
  ]);
}

// ── the changes ──────────────────────────────────────────────────────────────

/** Free or fix rows by id. */
export function withFixed(m: SingleCrystalPageModel, changes: readonly { readonly id: string; readonly fixed: boolean }[]): SingleCrystalPageModel {
  const fixed = new Map(changes.map((c) => [c.id, c.fixed]));
  return { ...m, params: m.params.map((p) => (fixed.has(p.id) ? { ...p, fixed: fixed.get(p.id)! } : p)) };
}

/** One row edited in the parameter panel. */
export function withParameter(m: SingleCrystalPageModel, id: string, patch: Partial<RefinementParameter>): SingleCrystalPageModel {
  return { ...m, params: m.params.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Values back to their starting values (these ids, or every one), every row kept; the last fit cleared. */
export function withReset(m: SingleCrystalPageModel, ids?: readonly string[]): SingleCrystalPageModel {
  const only = ids ? new Set(ids) : null;
  return { ...m, params: m.params.map((p) => (only && !only.has(p.id) ? p : { ...p, value: p.initialValue })), result: null };
}

/**
 * Every site's ADP model: one B per site, or the symmetry-allowed U tensor,
 * seeded from the ADPs as refined so far; the new rows enter fixed, the other
 * rows keep their values and choices. The same model is no change.
 */
export function withAdpModel(m: SingleCrystalPageModel, anisotropic: boolean): SingleCrystalPageModel {
  const v = pageView(m);
  const model = anisotropic ? "anisotropic" : "isotropic";
  if (model === adpModelOf(v.fitStructure)) return m;
  // On X-ray data the hydrogens stay isotropic; neutrons see them as well as any atom.
  const adp: AdpSwitch = { model, seeds: Object.fromEntries(v.refinedStructure.sites.map((site) => [site.label, site.adp])), hydrogensIsotropic: m.probe === "xray" };
  const fresh = buildSingleCrystalSpec(fitStructureOf(v.structure, adp, m.riding, m.restraints), v.probedDataset, { extinction: 0 }).params;
  // The new ADP rows start (and reset) at the refined values, their ties gone.
  return { ...m, adp, params: rebuiltRows(m, fresh, (p) => p.kind === "bIso" || p.kind === "uAniso"), result: null };
}

/**
 * Another probe or wavelength: every Fc changes (form factors against
 * scattering lengths) or the extinction's angle does, so the scale restarts
 * from its best value under the new physics and the last fit is cleared.
 */
export function withRadiation(m: SingleCrystalPageModel, update: { readonly probe?: Probe; readonly wavelength?: number }): SingleCrystalPageModel {
  const v = pageView(m);
  const probe = update.probe ?? m.probe;
  const wl = update.wavelength ?? v.baseWavelength;
  if (probe === m.probe && wl === v.baseWavelength) return m;
  const k = optimalScale(v.fitStructure, { ...v.activeDataset, radiation: radiationOf(probe, wl) }, m.params, v.bindings);
  return {
    ...m,
    probe,
    ...(update.wavelength !== undefined ? { wavelength: update.wavelength } : {}),
    params: k !== null ? m.params.map((p) => (p.kind === "scale" ? { ...p, value: k } : p)) : m.params,
    result: null,
  };
}

/**
 * The hydrogens ride on their parents (rules set from the structure as
 * refined now), or refine on their own again; their own rows leave the fit
 * (or come back, fixed, at the loaded positions). `message`: hydrogens left
 * out, or why nothing changed.
 */
export function withRiding(m: SingleCrystalPageModel, on: boolean, options?: RidingOptions): { readonly model: SingleCrystalPageModel; readonly message: string | null } {
  const v = pageView(m);
  const rules = on ? ridingRules({ ...v.refinedStructure, riding: [] }, options) : null;
  if (rules && rules.rules.length === 0) return { model: m, message: "no hydrogen is bonded to an atom of this model" };
  const riding = rules ? rules.rules : null;
  const fresh = buildSingleCrystalSpec(fitStructureOf(v.structure, m.adp, riding, m.restraints), v.probedDataset, { extinction: 0 }).params;
  return {
    model: { ...m, riding, params: rebuiltRows(m, fresh), result: null },
    message: rules && rules.unbonded.length ? `not riding (no parent in bonding distance): ${rules.unbonded.join(", ")}` : null,
  };
}

/** SHELXL's weighting scheme; null (or 0 0) for w = 1/σ². The fit's weights change, so the last fit is cleared. */
export function withWeighting(m: SingleCrystalPageModel, next: ShelxWeighting | null): SingleCrystalPageModel {
  const weighting = next && (next.a > 0 || next.b > 0) ? { a: next.a, b: next.b } : null;
  if (weighting?.a === m.weighting?.a && weighting?.b === m.weighting?.b) return m;
  return { ...m, weighting, result: null };
}

/**
 * The twin laws (SHELXL's TWIN): each brings its fraction row (BASF; the
 * Flack x for the inversion twin). A law that stays where it was keeps its
 * fraction and its free or fixed state; a new one starts at 0.1. The last fit
 * is cleared.
 */
export function withTwinLaws(m: SingleCrystalPageModel, next: readonly TwinLaw[]): SingleCrystalPageModel {
  const v = pageView(m);
  const { twinLaws: _, ...rest } = v.probedDataset;
  const fresh = buildSingleCrystalSpec(v.fitStructure, next.length ? { ...rest, twinLaws: next } : rest, { extinction: 0 }).params;
  const stays = (id: string): boolean => {
    const i = Number(/^twin_(\d+)$/.exec(id)?.[1] ?? 0) - 1;
    return i >= 0 && sameTwinLaw(m.twinLaws[i], next[i]);
  };
  return { ...m, twinLaws: next, params: rebuiltRows(m, fresh, (p) => p.kind === "twinFraction" && !stays(p.id)), result: null };
}

/** Ties: rows held to a leader's value, a disorder's second occupancy to one minus the first, or released. */
export function withParameterTies(m: SingleCrystalPageModel, update: EqualTieUpdate): SingleCrystalPageModel {
  return { ...m, params: withValidUserTies(withEqualTies(m.params, update)) };
}

/**
 * The model inverted through the origin, as SHELXL's MOVE 1 1 1 −1 with the
 * space group changed to its enantiomorph: the positions as refined go to
 * s − x (their shifts change sign), the riding groups are placed afresh, the
 * restraints follow their atoms' images, and a twin with both hands keeps its
 * fit (each domain takes the place of its inverse). Called again, it returns
 * to the hand as loaded. The last fit is cleared. Throws with a magnetic model
 * applied, or for a centrosymmetric group.
 */
export function withHand(m: SingleCrystalPageModel): { readonly model: SingleCrystalPageModel; readonly text: string } {
  if (m.magnetic) throw new Error("a magnetic model is applied: invert the structure before applying it");
  const v = pageView(m);
  // One transform both ways, the one that takes the model as loaded to its inverse: the round trip is exact.
  const forward = invertedModel(m.loaded);
  const total = forward.shift.map((x, i) => x + forward.translation[i]!) as unknown as typeof forward.shift;
  const flip = invertedModel(v.fitStructure, { total });
  const riding = m.riding ? invertedRiding(m.riding, invertedModel(v.refinedStructure, { total }).structure) : null;
  const nextFit = { ...flip.structure, ...(riding ? { riding } : {}) };
  const fresh = buildSingleCrystalSpec(nextFit, v.probedDataset, { extinction: 0 }).params;
  const old = new Map(m.params.map((p) => [p.id, p]));
  const lawOf = (id: string): number => Number(v.bindings.find((b) => b.parameterId === id && b.kind === "twinFraction")?.targetKey ?? 0) - 1;
  const fractions = m.twinLaws.map((_, i) => m.params.find((p) => p.kind === "twinFraction" && lawOf(p.id) === i)?.value ?? 0);
  const twins = invertedTwinFractions(m.twinLaws, fractions);
  const params = rebuiltRows(m, fresh, () => false, (row, p) => {
    // A shift moves the inverted site the other way; a torsion and a twin fraction take their new values.
    if (p.kind === "positionShift") return { ...row, value: -(old.get(p.id)?.value ?? 0) };
    if (p.kind === "ridingTorsion") return { ...row, value: p.value, initialValue: p.value };
    if (p.kind === "twinFraction") return { ...row, value: twins[lawOf(p.id)] ?? row.value };
    return row;
  });
  return {
    model: { ...m, riding, restraints: flip.structure.restraints ?? [], inverted: !m.inverted, params, result: null },
    text: m.inverted ? "back to the model as loaded" : inversionText(m.loaded, forward),
  };
}

/** The distance restraints, replaced as a whole: they change what the fit minimizes, so the last fit is cleared. */
export function withRestraints(m: SingleCrystalPageModel, next: readonly DistanceRestraint[]): SingleCrystalPageModel {
  return { ...m, restraints: next, result: null };
}

/**
 * The merged equivalents (SHELXL's MERG 2) or every measurement. The
 * reflections change, so the batch rows follow them, the omissions (which
 * named the other set's reflections) are cleared, and so is the last fit.
 */
export function withMerged(m: SingleCrystalPageModel, on: boolean): SingleCrystalPageModel {
  if (on === m.merged) return m;
  const v = pageView(m);
  const set = on ? mergedDataset(m.dataset, v.structure.spaceGroup.operations) : m.dataset;
  const fresh = buildSingleCrystalSpec(v.fitStructure, { ...v.probedDataset, reflections: set.reflections }, { extinction: 0 }).params;
  return { ...m, merged: on, params: rebuiltRows(m, fresh), omitted: [], result: null };
}

/** Another extinction model: its parameter is another quantity, so it restarts at 0 (none), as on load. */
export function withExtinctionModel(m: SingleCrystalPageModel, model: ExtinctionModel): SingleCrystalPageModel {
  if (model === m.extinctionModel) return m;
  return {
    ...m,
    extinctionModel: model,
    params: m.params.map((p) => (p.kind === "extinction" ? { ...p, label: EXTINCTION_PARAMETER_LABELS[model], value: 0, initialValue: 0 } : p)),
    result: null,
  };
}

/** The resolution range fitted; a limit given as null opens that end, one not given stays. */
export function withResolution(m: SingleCrystalPageModel, update: { readonly dMin?: number | null; readonly dMax?: number | null }): SingleCrystalPageModel {
  const end = (next: number | null | undefined, was: number | undefined): number | undefined => (next === undefined ? was : next ?? undefined);
  const dMin = end(update.dMin, m.resolution.dMin);
  const dMax = end(update.dMax, m.resolution.dMax);
  return { ...m, resolution: { ...(dMin !== undefined ? { dMin } : {}), ...(dMax !== undefined ? { dMax } : {}) } };
}

/** The measurements left out by hand, replaced as a whole. */
export function withOmitted(m: SingleCrystalPageModel, next: readonly OmittedMeasurement[]): SingleCrystalPageModel {
  return { ...m, omitted: next };
}

/** The OMIT filter: on or off, its cutoff in σ, and its extinction cut (null removes it). */
export function withOutlierFilter(m: SingleCrystalPageModel, update: { readonly on?: boolean; readonly cutoffSigma?: number; readonly minExtinction?: number | null }): SingleCrystalPageModel {
  return {
    ...m,
    filter: {
      on: update.on ?? m.filter.on,
      cutoffSigma: update.cutoffSigma ?? m.filter.cutoffSigma,
      minExtinction: update.minExtinction === undefined ? m.filter.minExtinction : update.minExtinction,
    },
  };
}

/**
 * A magnetic model from the symmetry step, or none: its bindings kept and its
 * moment rows (free as the step's fit frees them: magneticStep.ts, handoff)
 * put in place of any earlier magnetic rows, so the fit and the parameter
 * panel carry them with the nuclear ones.
 */
export function withMagneticModel(m: SingleCrystalPageModel, magnetic: MagneticModel | null, momentParams: readonly RefinementParameter[] = [], momentBindings: readonly ParameterBinding[] = []): SingleCrystalPageModel {
  return {
    ...m,
    magnetic,
    momentBindings: magnetic ? momentBindings : [],
    // The whole magnetic model is replaced — k rows included, never orphaned.
    params: [...m.params.filter((p) => !isMagneticModelParameterKind(p.kind)), ...(magnetic ? momentParams : [])],
  };
}

/**
 * Another structure loaded on the same measurement: the rows become the new
 * spec's, and the last fit, the ADP switch, the hand, the riding rules, the
 * restraints and the magnetic model go with the old structure (the page keeps
 * what belongs to the data: the probe, the weights, the twin laws, the merge,
 * the filter, the omissions and the range).
 */
export function withLoadedStructure(m: SingleCrystalPageModel, loaded: StructureModel): SingleCrystalPageModel {
  if (loaded === m.loaded) return m;
  // The new structure's own riding rules and restraints, as on load.
  const next = { ...m, loaded, adp: null, inverted: false, riding: loaded.riding?.length ? loaded.riding : null, restraints: loaded.restraints ?? [], result: null, magnetic: null, momentBindings: [] };
  return { ...next, params: pageView(next).spec.params };
}

/**
 * Another reflection file on the same structure (the page stays open: it is
 * keyed on the structure's dataset id): the rows follow the new reflections
 * (a batch's scale comes or goes) keeping their values, and the omissions,
 * which named the old file's measurements, and the last fit are cleared.
 */
export function withDataset(m: SingleCrystalPageModel, dataset: SingleCrystalDataset): SingleCrystalPageModel {
  if (dataset === m.dataset) return m;
  const next = { ...m, dataset, omitted: [], result: null };
  return { ...next, params: rebuiltRows(m, pageView(next).spec.params) };
}

/** The scheme SHELXL would suggest for the model as refined now (WGHT's b on the absolute scale). */
export function suggestedWeighting(m: SingleCrystalPageModel): WeightingSuggestion {
  const rows = pageView(m).comparison.rows;
  return suggestShelxWeighting(rows.map((r) => r.foSq), rows.map((r) => r.fcSq), rows.map((r) => r.sigma), m.params.filter((p) => !p.fixed && !p.expression).length, 10, m.params.find((p) => p.kind === "scale")?.value ?? 1);
}

// ── the fits ─────────────────────────────────────────────────────────────────

/** What a refinement found, to put on the page that ran it (`withFit`). */
export interface SingleCrystalFit {
  readonly params: readonly RefinementParameter[];
  readonly result: RefinementResult;
  readonly magnetic: MagneticModel | null;
  /** The History step's label. */
  readonly label: string;
}

/**
 * The Refine button (`guided`: the guided refine, which frees the rows it
 * stages): the fit on the reflections fitted, nuclear and moments together
 * when a magnetic model is applied. Throws CANCELLED or the engine's error.
 */
export async function singleCrystalFit(client: SingleCrystalCompute, m: SingleCrystalPageModel, guided = false): Promise<SingleCrystalFit> {
  const v = pageView(m);
  const start = guided ? guidedSingleCrystalParams(m.params) : [...m.params];
  const res = m.magnetic
    ? await client.refineMagneticParallel({ structure: v.fitStructure, magnetic: m.magnetic, dataset: v.activeDataset, parameters: start, bindings: [...v.bindings, ...m.momentBindings], options: SINGLE_CRYSTAL_REFINE_OPTIONS })
    : await client.refineSingleCrystalParallel({ structure: v.fitStructure, dataset: v.activeDataset, parameters: start, bindings: [...v.bindings], options: SINGLE_CRYSTAL_REFINE_OPTIONS });
  return {
    params: start.map((p) => ({ ...p, value: res.parameters[p.id] ?? p.value, ...(guided ? { fixed: false } : {}) })),
    result: res,
    magnetic: m.magnetic ? applyMagneticMoments(m.magnetic, m.momentBindings, res.parameters) : null,
    label: guided ? "Guided refine" : m.magnetic ? "Refine nuclear + magnetic" : "Refine",
  };
}

/** A refinement's outcome on the page. */
export function withFit(m: SingleCrystalPageModel, f: SingleCrystalFit): SingleCrystalPageModel {
  return { ...m, params: f.params, result: f.result, magnetic: f.magnetic ?? m.magnetic };
}

export interface SingleCrystalThorough {
  readonly mode: "prefit" | "escape";
  /** The values found, for every row the page has when it lands (`withThorough`). */
  readonly values: Readonly<Record<string, number>>;
  readonly result: RefinementResult;
  readonly magnetic: MagneticModel | null;
  /** What the search found, in words, beside the refine buttons. */
  readonly note: string;
  readonly label: string;
}

/**
 * The local-minimum-resistant fit: one baseline plus perturbed restarts,
 * keeping the lowest χ². With no fit yet it is the Prefit (a broad cold-start
 * search); after one, the Escape minimum (a lighter nudge). An F² surface
 * traps LM readily (a positional mode driven onto its bound, an atom settled
 * in a neighbour's basin), and the esd- and value-relative kicks vanish for a
 * mode at 0, so the kicks carry a floor in the parameter's own units. With a
 * magnetic model applied the search is the magnetic one: the nuclear scaffold
 * frozen, the moments searched, then one joint fit.
 */
export async function singleCrystalThorough(client: SingleCrystalCompute, m: SingleCrystalPageModel): Promise<SingleCrystalThorough> {
  const v = pageView(m);
  const mode: "prefit" | "escape" = m.result ? "escape" : "prefit";
  const wide = mode === "prefit";
  let ms;
  if (m.magnetic) {
    ms = await client.refineMagneticSingleCrystalMultiStart(
      { structure: v.fitStructure, magnetic: m.magnetic, dataset: v.activeDataset, parameters: [...m.params], bindings: [...v.bindings, ...m.momentBindings] },
      wide ? { restarts: 12 } : { restarts: 6, escapeSigma: 3 },
      { maxIterations: 25 },
    );
  } else {
    // Kick floors: 0.15 in fractional coordinates (~0.9 Å in a 6 Å cell) for a
    // positional mode, with 50 iterations per start — a seed sweep on a
    // synthetic bound-trapped start recovered 8/10 so, 2–5/10 with 25
    // iterations, and fewer with the 0.05 or 0.2 floor — and a basin-sized step
    // for the displacement parameters.
    const minKick = (p: RefinementParameter): number | undefined => {
      switch (p.kind) {
        case "positionShift": return 0.15;
        case "bIso": return wide ? 1 : 0.5;
        case "uAniso": return wide ? 0.01 : 0.005;
        case "occupancy": return wide ? 0.2 : 0.1;
        case "extinction": return 0.01;
        default: return undefined; // scale: the esd-relative kick is right
      }
    };
    ms = await client.refineSingleCrystalMultiStart(
      { structure: v.fitStructure, dataset: v.activeDataset, parameters: [...m.params], bindings: [...v.bindings], options: { maxIterations: 50, analyticDerivatives: true } },
      wide ? { restarts: 12, escapeSigma: 4, relFraction: 0.5, minKick } : { restarts: 6, escapeSigma: 2, relFraction: 0.5, minKick },
    );
  }
  const wr = (100 * (ms.final.agreement.rWeighted ?? 0)).toFixed(2);
  const starts = ms.restartsRun + 1;
  const note = wide
    ? (ms.improved
        ? `Prefit found a lower minimum (restart ${ms.bestStartIndex} of ${ms.restartsRun}) — wR2 ${wr}%, best of ${starts} starts. Refine to polish.`
        : `Prefit: the starting model was already best of ${starts} starts — wR2 ${wr}%. Refine to polish.`)
    : (ms.improved
        ? `Escaped a local minimum (restart ${ms.bestStartIndex} of ${ms.restartsRun}) — wR2 ${wr}%, best of ${starts} starts.`
        : `Already at the best minimum — the baseline beat all ${starts} starts, wR2 ${wr}%.`);
  return {
    mode,
    values: ms.final.parameters,
    result: ms.final,
    magnetic: m.magnetic ? applyMagneticMoments(m.magnetic, m.momentBindings, ms.final.parameters) : null,
    note,
    label: wide ? "Prefit" : "Escape minimum",
  };
}

/** A multi-start's outcome on the page as it is when the search lands. */
export function withThorough(m: SingleCrystalPageModel, t: SingleCrystalThorough): SingleCrystalPageModel {
  return { ...m, params: m.params.map((p) => ({ ...p, value: t.values[p.id] ?? p.value })), result: t.result, magnetic: t.magnetic ?? m.magnetic };
}

/**
 * The Refine button's fit with these options, returned and never applied.
 * `cut.minExtinction`: on the reflections fitted less those whose extinction
 * factor y (at the current model) is below it — the extinction test, the
 * page's own filter untouched.
 */
export function singleCrystalProbe(client: SingleCrystalCompute, m: SingleCrystalPageModel, options: Partial<RefinementOptions>, cut?: { readonly minExtinction: number }): Promise<RefinementResult> {
  const v = pageView(m);
  const yOf = cut ? new Map(v.probedDataset.reflections.map((r, i) => [r, v.fullComparison.rows[i]?.extinction ?? 1] as const)) : null;
  const data = yOf && cut ? { ...v.activeDataset, reflections: v.activeDataset.reflections.filter((r) => (yOf.get(r) ?? 1) >= cut.minExtinction) } : v.activeDataset;
  return m.magnetic
    ? client.refineMagneticParallel({ structure: v.fitStructure, magnetic: m.magnetic, dataset: data, parameters: [...m.params], bindings: [...v.bindings, ...m.momentBindings], options })
    : client.refineSingleCrystalParallel({ structure: v.fitStructure, dataset: data, parameters: [...m.params], bindings: [...v.bindings], options: { analyticDerivatives: true, ...options } });
}

/**
 * The symmetry step's moment fit on this dataset's F², the nuclear model held:
 * a seeded moment multi-start (8 restarts, or `options.restarts`: the
 * ranking's starts ask for none), then a final fit and the ±m
 * canonicalization. One scale: nuclear and magnetic Bragg peaks are the same
 * measurement, so the magnetic scale is tied to the nuclear one, which also
 * pins |m| uniquely.
 */
export async function momentFit(client: SingleCrystalCompute, m: SingleCrystalPageModel, magnetic: MagneticModel, momentParams: readonly RefinementParameter[], momentBindings: readonly ParameterBinding[], options: FitOptions = {}): Promise<MomentFit> {
  const v = pageView(m);
  // At k = 0 (options.freeScale) the scale refines with the moments; the magnetic scale follows it.
  const nuclearFixed = m.params.map((p) => ({ ...p, fixed: !(options.freeScale && p.kind === "scale" && !p.expression) }));
  const nuclearScale = m.params.find((p) => p.kind === "scale")?.value ?? 1;
  const scaleTie: RefinementParameter = { id: "magScale", label: "magnetic scale (= nuclear)", kind: "magneticScale", value: nuclearScale, initialValue: nuclearScale, fixed: true, expression: "= scale" };
  const scaleTieBinding: ParameterBinding = { parameterId: "magScale", kind: "magneticScale", targetId: v.activeDataset.id };
  const ms = await client.refineMagneticSingleCrystalMultiStart(
    { structure: v.fitStructure, magnetic, dataset: v.activeDataset, parameters: [...nuclearFixed, scaleTie, ...momentParams], bindings: [...v.bindings, scaleTieBinding, ...momentBindings] },
    { restarts: options.restarts ?? 8 }, { maxIterations: 20 },
  );
  const values: Record<string, number> = {};
  for (const p of momentParams) values[p.id] = ms.final.parameters[p.id] ?? p.value;
  return { values, agreement: ms.final.agreement.rWeighted ?? null, ...noiseOf(ms.final) };
}

// ── what the page shows the Agent and the report ─────────────────────────────

/** The page as the Agent reads it (agent/port.ts). */
export function liveStateOf(m: SingleCrystalPageModel, extra: { readonly busy: boolean; readonly structureFile?: readonly string[] }): SingleCrystalLiveState {
  const v = pageView(m);
  return {
    structure: v.fitStructure,
    refinedStructure: v.refinedStructure,
    dataset: v.probedDataset,
    totalReflections: m.dataset.reflections.length,
    measurement: m.dataset.reflections,
    ...(extra.structureFile ? { structureFile: extra.structureFile } : {}),
    ...(v.handText ? { inverted: v.handText, loadedAs: m.loaded } : {}),
    probe: m.probe,
    parameters: m.params,
    bindings: [...v.bindings, ...m.momentBindings],
    result: m.result,
    busy: extra.busy,
    agreement: v.comparison.agreement,
    merge: v.merge.statistics,
    // With a magnetic model, the total (nuclear + magnetic) intensity; else the comparison's rows, with y and the batch.
    rows: m.magnetic
      ? v.obsCalc.map((r) => ({ h: r.h, k: r.k, l: r.l, foSq: r.iObs, fcSq: r.iCalc, sigma: r.sigma ?? 0, deltaOverSigma: r.sigma ? (r.iObs - r.iCalc) / r.sigma : 0 }))
      : v.comparison.rows,
    allRows: v.fullComparison.rows,
    outlierFilter: { on: m.filter.on, cutoffSigma: m.filter.cutoffSigma, excluded: v.excluded, ...(m.filter.minExtinction !== null ? { minExtinction: m.filter.minExtinction } : {}) },
    omitted: m.omitted,
    resolution: { ...m.resolution, excluded: v.outsideRange },
    riding: m.riding ?? [],
    weighting: m.weighting,
    twinLaws: m.twinLaws,
    distanceRestraints: m.restraints,
    extinctionModel: m.extinctionModel,
    adpModel: adpModelOf(v.fitStructure),
    magnetic: m.magnetic !== null,
    observationCount: v.activeDataset.reflections.length,
    source: m.dataset.name,
    restraints: [],
  };
}

/**
 * The Validation view's checks of the fit on screen (SingleCrystalValidation.tsx),
 * built the same way: the SHELX agreement and the statistics over the
 * reflections shown, the σ filter's omissions, the ADPs' definiteness.
 */
export function validationVerdictOf(m: SingleCrystalPageModel): ValidationVerdict | null {
  const v = pageView(m);
  const rows = v.obsCalc;
  if (rows.length === 0) return null;
  const nParams = m.params.filter((p) => !p.fixed && !p.expression).length;
  const fo = rows.map((r) => r.iObs);
  const fc = rows.map((r) => r.iCalc);
  const sg = rows.map((r) => r.sigma ?? 0);
  const ag = singleCrystalAgreement(fo, fc, sg, shelxWeights(fo, fc, sg), nParams);
  const structure = v.refinedStructure;
  const validation = singleCrystalValidation({
    rows: rows.map((r) => ({ h: r.h, k: r.k, l: r.l, foSq: r.iObs, fcSq: r.iCalc, ...(r.sigma !== undefined ? { sigma: r.sigma } : {}) })),
    cell: structure.cell, spaceGroup: structure.spaceGroup, nParams,
  });
  return singleCrystalChecks({
    validation, goof: ag.goof, result: m.result, parameters: m.params,
    nonPositiveDefinite: nonPositiveDefiniteSites(structure),
    xray: v.activeDataset.radiation.kind === "xray",
    omitted: m.filter.on ? { count: v.excluded, cutoff: m.filter.cutoffSigma } : undefined,
  });
}

/** The page's report (Export ▾ → Report): data and merge statistics, the F figure, the agreement, the refined structure, the magnetic model. */
export function reportInputOf(m: SingleCrystalPageModel, extra: { readonly explored?: MagneticExploration | null; readonly structureFile?: readonly string[]; readonly structureFileName?: string } = {}): ReportInput {
  const v = pageView(m);
  return singleCrystalReportInput({
    structure: v.refinedStructure,
    base: v.fitStructure,
    params: m.params,
    bindings: [...v.bindings, ...m.momentBindings],
    result: m.result,
    dataset: v.activeDataset,
    totalReflections: m.dataset.reflections.length,
    excluded: v.excluded,
    filterOn: m.filter.on,
    cutoffSigma: m.filter.cutoffSigma,
    minExtinction: m.filter.minExtinction,
    omitted: m.omitted,
    resolution: { ...m.resolution, excluded: v.outsideRange },
    agreement: v.comparison.agreement,
    merge: v.merge.statistics,
    points: v.obsCalc.map((r) => ({ obs: r.iObs, calc: r.iCalc, ...(r.kind === "magnetic" ? { magnetic: true } : {}) })),
    magnetic: m.magnetic,
    explored: extra.explored ?? null,
    ...(v.handText ? { inverted: v.handText } : {}),
    ...(extra.structureFile?.length ? { structureFile: extra.structureFile, ...(extra.structureFileName ? { structureFileName: extra.structureFileName } : {}) } : {}),
    verdict: validationVerdictOf(m),
  });
}

/** A twin law in the History's words. */
export function twinStepLabel(next: readonly TwinLaw[]): string {
  return next.length === 0 ? "Untwinned" : next.length === 1 && isInversion(next[0]!) ? "Inversion twin" : next.length > 1 && next.some((law) => improper(law.matrix)) ? `Twin law with the inversion (${next.length + 1} domains)` : `${next.length} twin law${next.length === 1 ? "" : "s"}`;
}
