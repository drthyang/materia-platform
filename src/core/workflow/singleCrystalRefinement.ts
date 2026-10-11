/**
 * Single-crystal **F² structure refinement** — the integrated-Bragg counterpart
 * of the powder `structureRefinement`, assembled from the *same* symmetry-
 * constraint layer (symmetry-adapted position and ADP modes, occupancy) so a
 * special-position atom is reduced identically whichever data type refines it.
 * What differs is the observable: one F² per reflection, with (optionally)
 * secondary extinction, and SHELX F² agreement factors (R1, wR2, GooF) instead
 * of a profile wR.
 *
 *   Fc²(hkl) = k · y_ext(Fc²) · |F(hkl)|²
 *
 * The reflection files hold Fo² as data reduction leaves them — Lorentz,
 * polarization and absorption already corrected: SHELX HKLF 4 and .fcf,
 * FullProf .int, the SNS TOPAZ .hkl. SHELXL, Jana, FullProf and GSAS-II fit
 * them so, and so does this model: SHELXL's own Fc² in a LIST 4 .fcf is |F|²
 * on the absolute scale, with no angle factor (multiplying the model by
 * 1/sin2θ again, as this module once did, bent its fall-off with angle by up to
 * a factor of 15 for Mo data, for the scale and the ADPs to absorb).
 *
 * The **unit cell is input, not a parameter.** Integrated intensities carry no
 * information about peak positions; the cell enters |F|² only through the weak
 * Q-dependence of form factors and displacement factors, fully correlated with
 * scale and ADPs. Every single-crystal program treats it so — SHELXL's
 * CELL/ZERR lines (esds propagate into geometry, the cell itself never
 * varies), Jana's cell refinement living under the *powder* profile options,
 * FullProf's "codewords for cell constants must be equal to zero if there is no
 * powder profile", GSAS-II computing cell derivatives only on the powder path.
 * The spec therefore emits no lattice rows: the cell comes from indexing and is
 * shown on the Structure card as fixed input.
 *
 * Parameter-freeing convention matches the powder path: scale (and extinction,
 * when present) refine on the first "Refine"; structural rows (positions, ADP,
 * occupancy) start **fixed** and are freed per row or by the staged sequence, in
 * the expert order scale → ADP → positions.
 */

import type { AtomSite, StructureModel, UnitCell } from "@/core/crystal/types";
import type { OmittedMeasurement, ResolutionRange, SingleCrystalDataset, SingleCrystalReflection } from "@/core/diffraction/types";
import type { ParameterBinding, ParameterKind, RefinementParameter } from "@/core/refinement/types";
import type { RefinementProblem } from "@/core/refinement/engine";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { allowedAnisotropicAdpModes } from "@/core/crystal/adpConstraints";
import { weightsFromSigma } from "@/core/refinement/factors";
import { resolveTies } from "@/core/refinement/constraints";
import { applyParameters } from "@/core/workflow/apply";
import { nuclearStructureFactorSquared } from "@/core/diffraction/structureFactor";
import {
  EXTINCTION_PARAMETER_LABELS,
  extinctionFactorFor,
  shelxWeights,
  singleCrystalAgreement,
  type SingleCrystalAgreement,
} from "@/core/diffraction/singleCrystalFactors";
import { cellVolume, dSpacing } from "@/core/crystal/unitCell";

/** Structural kinds held fixed on load; freed via the table or staged sequence. */
const STRUCTURAL_KINDS: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  "positionShift", "bIso", "uAniso", "occupancy",
]);

export interface SingleCrystalSpec {
  readonly params: RefinementParameter[];
  readonly bindings: ParameterBinding[];
}

export interface SingleCrystalSpecOptions {
  /** Starting overall scale (applied to F²). Default 1. */
  readonly scale?: number;
  /** Refine symmetry-adapted atomic positions. Default true. */
  readonly refinePositions?: boolean;
  /** Refine per-site ADP (isotropic B or symmetry-adapted anisotropic U). Default true. */
  readonly refineAdp?: boolean;
  /** Refine site occupancies. Default false (correlates with scale/ADP). */
  readonly refineOccupancy?: boolean;
  /** Include a secondary-extinction parameter (SHELXL EXTI). Default 0 = none. */
  readonly extinction?: number;
  /** Tie atoms sharing one crystallographic site (disorder). Default true. */
  readonly tieSharedSites?: boolean;
  /** Max fractional shift of a positional mode from its start. Default 0.2. */
  readonly positionBound?: number;
  /** Starting isotropic B for isotropic sites (Å²). Default 0.5. */
  readonly startB?: number;
  /** A scale row per batch after the first, fixed, when the reflections carry two or more batches. Default true. */
  readonly batchScales?: boolean;
}

/** Group atoms sharing a fractional position (periodic per-component). */
function groupSites(sites: readonly AtomSite[], tie: boolean): { key: string; rep: AtomSite; members: AtomSite[] }[] {
  if (!tie) return sites.map((s) => ({ key: s.label, rep: s, members: [s] }));
  const groups: { key: string; rep: AtomSite; members: AtomSite[] }[] = [];
  for (const s of sites) {
    const g = groups.find((grp) => {
      const p = grp.rep.position;
      for (let i = 0; i < 3; i++) {
        let d = Math.abs(p[i]! - s.position[i]!);
        d = Math.min(d, 1 - d);
        if (d > 1e-3) return false;
      }
      return true;
    });
    if (g) g.members.push(s);
    else groups.push({ key: s.label, rep: s, members: [s] });
  }
  return groups;
}

const groupLabel = (g: { rep: AtomSite; members: AtomSite[] }): string =>
  g.members.length > 1 ? `${g.rep.label}+${g.members.length - 1}` : g.rep.label;

/** Describe a positional mode by the axes it drives (e.g. "x", "x+y+z"). */
function describeMode(axis: readonly number[]): string {
  const names = ["x", "y", "z"];
  const parts = axis
    .map((c, i) => ({ c, i }))
    .filter((o) => Math.abs(o.c) > 1e-6)
    .map(({ c, i }, idx) => `${c < 0 ? "−" : idx === 0 ? "" : "+"}${names[i]}`);
  return parts.join("") || "·";
}

/**
 * Assemble the full symmetry-allowed single-crystal refinement parameter set.
 * Scale (and extinction) start free; structural rows start fixed, mirroring the
 * powder-spec convention so the first "Refine" is a safe scale-only fit.
 */
export function buildSingleCrystalSpec(
  structure: StructureModel,
  dataset: SingleCrystalDataset,
  opts: SingleCrystalSpecOptions = {},
): SingleCrystalSpec {
  const {
    scale = 1,
    refinePositions = true,
    refineAdp = true,
    refineOccupancy = false,
    extinction = 0,
    tieSharedSites = true,
    positionBound = 0.2,
    startB,
  } = opts;

  const params: RefinementParameter[] = [];
  const bindings: ParameterBinding[] = [];

  // Overall scale (on F²) — free on load.
  params.push({ id: "scale", label: "scale (OSF)", kind: "scale", value: scale, initialValue: scale, min: 0, fixed: false });
  bindings.push({ parameterId: "scale", kind: "scale", targetId: dataset.id });

  // Secondary extinction (SHELXL EXTI) — free on load when present.
  if (extinction > 0 || opts.extinction !== undefined) {
    params.push({ id: "extinction", label: EXTINCTION_PARAMETER_LABELS[dataset.extinctionModel ?? "shelx"], kind: "extinction", value: extinction, initialValue: extinction, min: 0, max: 100, fixed: false });
    bindings.push({ parameterId: "extinction", kind: "extinction", targetId: dataset.id });
  }

  // Batch scales (SHELX's batch scale factors): one row per batch after the
  // first, relative to it, fixed on load — the data reduction normally scales
  // the batches, and freeing them is a decision the residuals by batch support.
  if (opts.batchScales ?? true) {
    const batches = [...new Set(dataset.reflections.flatMap((r) => (r.batch !== undefined ? [r.batch] : [])))].sort((a, b) => a - b);
    for (const b of batches.slice(1)) {
      const id = `bscale_${b}`;
      params.push({ id, label: `batch ${b} scale`, kind: "batchScale", value: 1, initialValue: 1, min: 0.2, max: 5, fixed: true });
      bindings.push({ parameterId: id, kind: "batchScale", targetId: dataset.id, targetKey: String(b) });
    }
  }

  // No cell rows — see the module comment: the cell is fixed input from
  // indexing, as in every single-crystal refinement program. (A project saved
  // by an earlier build that still carried fixed cell rows reopens cleanly: the
  // restore overlays saved rows onto this spec by id and drops the rest.)

  const groups = groupSites(structure.sites, tieSharedSites);

  // Per-site ADP: isotropic B or symmetry-adapted anisotropic U modes.
  if (refineAdp) {
    for (const g of groups) {
      if (g.rep.adp.kind === "isotropic") {
        const id = `B_${g.key}`;
        const b0 = startB ?? (g.rep.adp.kind === "isotropic" ? g.rep.adp.bIso : 0.5);
        params.push({ id, label: `${groupLabel(g)} B`, kind: "bIso", value: b0, initialValue: b0, min: 0, max: 10, fixed: true });
        for (const m of g.members) if (m.adp.kind === "isotropic") bindings.push({ parameterId: id, kind: "bIso", targetId: structure.id, targetKey: m.label });
      } else {
        const allowed = allowedAnisotropicAdpModes(structure.spaceGroup.operations, g.rep.position, g.rep.adp.uAniso);
        allowed.modes.forEach((mode, i) => {
          const id = `U_${g.key}_${i}`;
          const abs = Math.abs(mode.coefficient);
          const span = Math.max(0.02, abs * 4);
          params.push({
            id,
            label: `${groupLabel(g)} ${mode.label}`,
            kind: "uAniso",
            value: mode.coefficient,
            initialValue: mode.coefficient,
            min: mode.diagonal ? 0 : mode.coefficient - span,
            max: mode.diagonal ? Math.max(0.2, mode.coefficient + span) : mode.coefficient + span,
            fixed: true,
          });
          for (const m of g.members) if (m.adp.kind === "anisotropic") bindings.push({ parameterId: id, kind: "uAniso", targetId: structure.id, targetKey: m.label, uBasis: mode.basis });
        });
      }
    }
  }

  // Symmetry-adapted positions: one parameter per free displacement mode.
  if (refinePositions) {
    for (const g of groups) {
      const { basis } = allowedPositionShifts(structure.spaceGroup.operations, g.rep.position);
      basis.forEach((axis, i) => {
        const id = `pos_${g.key}_${i}`;
        params.push({ id, label: `${groupLabel(g)} ${describeMode(axis)}`, kind: "positionShift", value: 0, initialValue: 0, min: -positionBound, max: positionBound, fixed: true });
        for (const m of g.members) bindings.push({ parameterId: id, kind: "positionShift", targetId: structure.id, targetKey: m.label, axis });
      });
    }
  }

  // Occupancies (optional).
  if (refineOccupancy) {
    for (const site of structure.sites) {
      const id = `occ_${site.label}`;
      params.push({ id, label: `${site.label} occ`, kind: "occupancy", value: site.occupancy, initialValue: site.occupancy, min: 0, max: 1, fixed: true });
      bindings.push({ parameterId: id, kind: "occupancy", targetId: structure.id, targetKey: site.label });
    }
  }

  // Auto-estimate the overall scale so the initial |F|² match is sensible: the
  // least-squares optimum k = Σ(Fo²·Fc²)/Σ(Fc²)² evaluated at k = 1 (I_calc is
  // linear in the scale, so one pass is exact). Without this, heavy-atom |F_calc|²
  // dwarfs small integrated intensities and the starting R-factors are absurd.
  if (opts.scale === undefined) {
    const scaleParam = params.find((p) => p.id === "scale");
    if (scaleParam) {
      scaleParam.value = 1;
      const cmp = singleCrystalRefinementComparison(structure, dataset, params, bindings);
      let num = 0;
      let den = 0;
      for (const r of cmp.rows) { num += r.foSq * r.fcSq; den += r.fcSq * r.fcSq; }
      if (den > 0 && num > 0) {
        scaleParam.value = num / den;
        scaleParam.initialValue = num / den;
      }
    }
  }

  return { params, bindings };
}

/**
 * A single-crystal refinement has converged, by the crystallographic
 * convention, when every shift is below a fraction of its esd — not when χ²
 * stops falling: with a GooF of 2–3 a shift of most of an esd changes χ² by
 * less than the engine's relative tolerance. Sapphire with 31 batch scales
 * stopped after 7 cycles with its extinction still moving by 0.79 esd, and
 * needed 21 to settle below 0.05 (the scale moving by an esd on the way). So
 * the page refines until every shift is below 0.05 esd, up to 50 cycles.
 */
export const SINGLE_CRYSTAL_REFINE_OPTIONS = { maxIterations: 50, convergenceTolerance: 1e-12, shiftTolerance: 0.05 } as const;

/** Whether a measurement is one of those left out by hand: the same indices, and the same batch when the omission names one. */
export function isOmitted(r: Pick<SingleCrystalReflection, "h" | "k" | "l" | "batch">, omitted: readonly OmittedMeasurement[]): boolean {
  return omitted.some((o) => o.h === r.h && o.k === r.k && o.l === r.l && (o.batch === undefined || o.batch === r.batch));
}

/** The dataset without the measurements left out by hand. */
export function withoutOmitted(dataset: SingleCrystalDataset, omitted: readonly OmittedMeasurement[]): SingleCrystalDataset {
  return omitted.length === 0 ? dataset : { ...dataset, reflections: dataset.reflections.filter((r) => !isOmitted(r, omitted)) };
}

/** Whether a reflection lies in the resolution range (SHELXL's SHEL), its d from the cell. */
export function inResolution(r: Pick<SingleCrystalReflection, "h" | "k" | "l">, cell: UnitCell, range: ResolutionRange): boolean {
  if (range.dMin === undefined && range.dMax === undefined) return true;
  const d = dSpacing(cell, r.h, r.k, r.l);
  return (range.dMin === undefined || d >= range.dMin) && (range.dMax === undefined || d <= range.dMax);
}

/** The dataset limited to the resolution range. */
export function withinResolution(dataset: SingleCrystalDataset, cell: UnitCell, range: ResolutionRange): SingleCrystalDataset {
  return range.dMin === undefined && range.dMax === undefined ? dataset : { ...dataset, reflections: dataset.reflections.filter((r) => inResolution(r, cell, range)) };
}

/** Which structural rows the staged sequence unlocks (occupancy excluded). */
export function guidedSingleCrystalParams(params: readonly RefinementParameter[]): RefinementParameter[] {
  const unlock: ReadonlySet<ParameterKind> = new Set<ParameterKind>([...STRUCTURAL_KINDS].filter((k) => k !== "occupancy"));
  return params.map((p) => (unlock.has(p.kind) ? { ...p, fixed: false } : { ...p }));
}

/** The extinction factor y of one reflection at the current values. */
function extinctionOf(applied: ReturnType<typeof applyParameters>, dataset: SingleCrystalDataset, r: SingleCrystalReflection, volume: number): number {
  if (!(applied.extinction > 0)) return 1;
  const f2 = nuclearStructureFactorSquared(applied.model, dataset.radiation, r.h, r.k, r.l);
  return extinctionFactorFor(dataset.extinctionModel, applied.extinction, f2, dataset.radiation, dSpacing(applied.model.cell, r.h, r.k, r.l), volume, r);
}

/** Fc² for one reflection: k·y_ext·|F|² (the data are corrected Fo²), at the reflection's own λ and 2θ when the file gives them. */
function reflectionIntensity(
  applied: ReturnType<typeof applyParameters>,
  dataset: SingleCrystalDataset,
  r: SingleCrystalReflection,
  volume: number,
): number {
  const model = applied.model;
  const d = dSpacing(model.cell, r.h, r.k, r.l);
  const f2 = nuclearStructureFactorSquared(model, dataset.radiation, r.h, r.k, r.l);
  const y = applied.extinction > 0 ? extinctionFactorFor(dataset.extinctionModel, applied.extinction, f2, dataset.radiation, d, volume, r) : 1;
  const batch = r.batch !== undefined ? applied.batchScales?.get(r.batch) ?? 1 : 1;
  return applied.scale * batch * y * f2;
}

/**
 * Build a single-crystal F² refinement problem: observations are the measured
 * Fo², the model returns k·y·|F|², weights are 1/σ²(Fo²)
 * (SHELX a = b = 0; the a/b terms need Fc²-dependent reweighting, tracked
 * separately in the agreement report).
 */
export function buildSingleCrystalRefinementProblem(
  structure: StructureModel,
  dataset: SingleCrystalDataset,
  parameters: readonly RefinementParameter[],
  bindings: readonly ParameterBinding[],
): RefinementProblem {
  const observations = Float64Array.from(dataset.reflections.map((r) => r.iObs));
  const weights = weightsFromSigma(dataset.reflections.map((r) => r.sigma));

  const calculate = (values: Readonly<Record<string, number>>): Float64Array => {
    const resolved = resolveTies(parameters, values);
    const applied = applyParameters(structure, bindings, resolved);
    const volume = cellVolume(applied.model.cell);
    const out = new Float64Array(dataset.reflections.length);
    for (let i = 0; i < dataset.reflections.length; i++) {
      const r = dataset.reflections[i]!;
      out[i] = reflectionIntensity(applied, dataset, r, volume);
    }
    return out;
  };

  return { parameters, observations, weights, calculate };
}

export interface SingleCrystalRefinementComparison {
  readonly rows: {
    readonly h: number; readonly k: number; readonly l: number;
    readonly foSq: number; readonly fcSq: number; readonly sigma: number;
    /** Standardized residual (Fo²−Fc²)/σ — flags outliers. */
    readonly deltaOverSigma: number;
    /** The extinction factor y in Fc² (1 without extinction). */
    readonly extinction: number;
    /** The batch and wavelength it was measured at, when the file gives them. */
    readonly batch?: number;
    readonly wavelength?: number;
  }[];
  readonly agreement: SingleCrystalAgreement;
}

/**
 * Observed/calculated comparison with SHELX F² agreement (R1, wR2, GooF) for the
 * current parameter values. `weightAB` supplies the SHELX WGHT a,b for the
 * reported wR2/GooF (defaults to pure σ weighting).
 */
export function singleCrystalRefinementComparison(
  structure: StructureModel,
  dataset: SingleCrystalDataset,
  parameters: readonly RefinementParameter[],
  bindings: readonly ParameterBinding[],
  weightAB: { readonly a?: number; readonly b?: number } = {},
): SingleCrystalRefinementComparison {
  const values: Record<string, number> = {};
  for (const p of parameters) values[p.id] = p.value;
  const resolved = resolveTies(parameters, values);
  const applied = applyParameters(structure, bindings, resolved);
  const volume = cellVolume(applied.model.cell);

  const foSq: number[] = [];
  const fcSq: number[] = [];
  const sigma: number[] = [];
  const rows: SingleCrystalRefinementComparison["rows"] = [];
  for (const r of dataset.reflections) {
    const fc2 = reflectionIntensity(applied, dataset, r, volume);
    const s = r.sigma ?? 0;
    foSq.push(r.iObs);
    fcSq.push(fc2);
    sigma.push(s);
    rows.push({
      h: r.h, k: r.k, l: r.l, foSq: r.iObs, fcSq: fc2, sigma: s,
      deltaOverSigma: s > 0 ? (r.iObs - fc2) / s : 0,
      extinction: extinctionOf(applied, dataset, r, volume),
      ...(r.batch !== undefined ? { batch: r.batch } : {}),
      ...(r.wavelength !== undefined ? { wavelength: r.wavelength } : {}),
    });
  }

  const nFree = parameters.filter((p) => !p.fixed && !p.expression).length;
  const weights = shelxWeights(foSq, fcSq, sigma, weightAB.a ?? 0, weightAB.b ?? 0);
  const agreement = singleCrystalAgreement(foSq, fcSq, sigma, weights, nFree);
  return { rows, agreement };
}
