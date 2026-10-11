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
import { isInversion, type OmittedMeasurement, type ResolutionRange, type SingleCrystalDataset, type SingleCrystalReflection } from "@/core/diffraction/types";
import type { ParameterBinding, ParameterKind, RefinementOptions, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { refine, type RefinementProblem } from "@/core/refinement/engine";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { allowedAnisotropicAdpModes } from "@/core/crystal/adpConstraints";
import { weightsFromSigma } from "@/core/refinement/factors";
import { parseTie, resolveTies } from "@/core/refinement/constraints";
import { applyParameters } from "@/core/workflow/apply";
import { scPlan, scStructureFactors, type ScDerivative, type ScKernelResult, type ScPlan } from "@/core/diffraction/scKernel";
import {
  EXTINCTION_PARAMETER_LABELS,
  extinctionFactorFor,
  shelxWeights,
  singleCrystalAgreement,
  type SingleCrystalAgreement,
} from "@/core/diffraction/singleCrystalFactors";
import { cellVolume, dSpacing } from "@/core/crystal/unitCell";
import { EIGHT_PI_SQUARED, uEquivalent } from "@/core/crystal/adp";
import { ridingDependence } from "@/core/crystal/riding";
import { mulVec } from "@/core/math/mat3";
import type { Mat3, Vec3 } from "@/core/math/types";

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
  /** An occupancy row for every site, not only the partial and disordered ones. Default false (correlates with scale/ADP). */
  readonly refineOccupancy?: boolean;
  /** Starting fractions of the dataset's twin laws, in order (default 0.1 each). */
  readonly twinFractions?: readonly number[];
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

  // Twin domains (SHELXL's TWIN/BASF): one fraction per law beyond the first
  // domain, free — the law is a decision already made. For the inversion twin
  // it is the Flack parameter.
  (dataset.twinLaws ?? []).forEach((law, i) => {
    const id = `twin_${i + 1}`;
    const start = opts.twinFractions?.[i] ?? 0.1;
    params.push({ id, label: isInversion(law) ? "inversion twin fraction (Flack x)" : `twin fraction ${i + 1} (BASF)`, kind: "twinFraction", value: start, initialValue: start, min: 0, max: 1, fixed: false });
    bindings.push({ parameterId: id, kind: "twinFraction", targetId: dataset.id, targetKey: String(i + 1) });
  });

  // No cell rows — see the module comment: the cell is fixed input from
  // indexing, as in every single-crystal refinement program. (A project saved
  // by an earlier build that still carried fixed cell rows reopens cleanly: the
  // restore overlays saved rows onto this spec by id and drops the rest.)

  // Riding hydrogens follow their parents and carry no parameter of their own.
  const riding = new Set(structure.riding?.map((r) => r.site) ?? []);
  const groups = groupSites(structure.sites.filter((site) => !riding.has(site.label)), tieSharedSites);

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

  // Occupancies: a row, fixed, for each partial or disordered site — the
  // alternatives of a disorder refine tied to add up to one (SHELXL's 21 and
  // −21) — or for every site with `refineOccupancy`. A riding hydrogen has none.
  for (const site of structure.sites) {
    if (riding.has(site.label) || !(refineOccupancy || site.occupancy < 1 - 1e-6 || site.disorder)) continue;
    const id = `occ_${site.label}`;
    params.push({ id, label: `${site.label} occ`, kind: "occupancy", value: site.occupancy, initialValue: site.occupancy, min: 0, max: 1, fixed: true });
    bindings.push({ parameterId: id, kind: "occupancy", targetId: structure.id, targetKey: site.label });
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
export const SINGLE_CRYSTAL_REFINE_OPTIONS = { maxIterations: 50, convergenceTolerance: 1e-12, shiftTolerance: 0.05, analyticDerivatives: true } as const;

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

/**
 * The overall scale that best fits Fo² with every other parameter as it is:
 * k = Σw·Fo²·c / Σw·c², c the calculated F² at k = 1, w = 1/σ². What the scale
 * should restart from when the physics changes under it (another probe or
 * wavelength), so the fit on screen is not a stale scale's.
 */
export function optimalScale(structure: StructureModel, dataset: SingleCrystalDataset, parameters: readonly RefinementParameter[], bindings: readonly ParameterBinding[]): number | null {
  const scaleIds = new Set(bindings.filter((b) => b.kind === "scale").map((b) => b.parameterId));
  const unit = parameters.map((p) => (scaleIds.has(p.id) ? { ...p, value: 1 } : p));
  const values: Record<string, number> = {};
  for (const p of unit) values[p.id] = p.value;
  const applied = applyParameters(structure, bindings, resolveTies(unit, values));
  const c = scIntensities(scPlans(structure, dataset), applied, dataset).fc2;
  let num = 0;
  let den = 0;
  dataset.reflections.forEach((r, i) => {
    const w = r.sigma && r.sigma > 0 ? 1 / (r.sigma * r.sigma) : 1;
    num += w * r.iObs * c[i]!;
    den += w * c[i]! * c[i]!;
  });
  return den > 0 && num > 0 ? num / den : null;
}

/** Which structural rows the staged sequence unlocks (occupancy excluded). */
export function guidedSingleCrystalParams(params: readonly RefinementParameter[]): RefinementParameter[] {
  const unlock: ReadonlySet<ParameterKind> = new Set<ParameterKind>([...STRUCTURAL_KINDS].filter((k) => k !== "occupancy"));
  return params.map((p) => (unlock.has(p.kind) ? { ...p, fixed: false } : { ...p }));
}

/** The plans of a fit: the reflections as indexed, and for each twin law the indices of the reflection that overlaps them, h′ = R·h. */
export interface ScPlans {
  readonly components: readonly ScPlan[];
}

export function scPlans(structure: StructureModel, dataset: SingleCrystalDataset): ScPlans {
  const base = scPlan(structure, dataset.radiation, dataset.reflections);
  const twins = (dataset.twinLaws ?? []).map((law) => {
    const R = law.matrix;
    return scPlan(structure, dataset.radiation, dataset.reflections.map((r) => ({
      h: R[0][0] * r.h + R[0][1] * r.k + R[0][2] * r.l,
      k: R[1][0] * r.h + R[1][1] * r.k + R[1][2] * r.l,
      l: R[2][0] * r.h + R[2][1] * r.k + R[2][2] * r.l,
    })));
  });
  return { components: [base, ...twins] };
}

/** One twin domain's share of every reflection: its fraction, |F|², y, the gain that turns ∂|F|² into ∂Fc², and the kernel's F and ∂F. */
interface ScComponent {
  readonly w: number;
  readonly f2: Float64Array;
  readonly y: Float64Array;
  readonly gain: Float64Array | null;
  readonly kernel: ScKernelResult;
}

/**
 * Fc² = k·k_b·Σ_m w_m·y_m·|F(R_m·h)|² for every reflection from the kernel's
 * F — one domain, or each twin domain at its fraction (the first at 1 − Σ of
 * the others), each extinguished on its own intensity — with what the
 * analytic Jacobian needs per domain: |F|², y, and g = k·k_b·(y + |F|²·∂y/∂|F|²),
 * the factor that turns ∂|F|²/∂p into ∂Fc²/∂p. ∂y/∂|F|² is taken numerically on
 * the scalar extinction function (cheap, and the same function the fit uses).
 * `y` is the first domain's, for display.
 */
function scIntensities(
  plans: ScPlans,
  applied: ReturnType<typeof applyParameters>,
  dataset: SingleCrystalDataset,
  derivatives: readonly ScDerivative[] = [],
  withGain = false,
): { fc2: Float64Array; y: Float64Array; batch: Float64Array; components: ScComponent[] } {
  const model = applied.model;
  const base = plans.components[0]!;
  const n = base.n;
  const volume = cellVolume(model.cell);
  const x = applied.extinction;
  const fractions = plans.components.slice(1).map((_, m) => applied.twinFractions?.get(m + 1) ?? 0);
  const weights = [1 - fractions.reduce((a, b) => a + b, 0), ...fractions];
  const batch = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = dataset.reflections[i]!;
    batch[i] = r.batch !== undefined ? applied.batchScales?.get(r.batch) ?? 1 : 1;
  }
  const fc2 = new Float64Array(n);
  const components = plans.components.map((plan, c): ScComponent => {
    const kernel = scStructureFactors(plan, model, derivatives);
    const f2 = new Float64Array(n);
    const y = new Float64Array(n);
    const gain = withGain ? new Float64Array(n) : null;
    const w = weights[c]!;
    for (let i = 0; i < n; i++) {
      const r = dataset.reflections[i]!;
      const fsq = kernel.re[i]! * kernel.re[i]! + kernel.im[i]! * kernel.im[i]!;
      const d = 1 / (2 * Math.sqrt(plan.s2[i]!));
      const yOf = (value: number): number => extinctionFactorFor(dataset.extinctionModel, x, value, dataset.radiation, d, volume, r);
      const yi = x > 0 ? yOf(fsq) : 1;
      const kb = applied.scale * batch[i]!;
      f2[i] = fsq;
      y[i] = yi;
      fc2[i]! += w * kb * yi * fsq;
      if (gain) {
        let dy = 0;
        if (x > 0 && fsq > 0) {
          const step = 1e-5 * fsq;
          dy = (yOf(fsq + step) - yOf(fsq - step)) / (2 * step);
        }
        gain[i] = kb * (yi + fsq * dy);
      }
    }
    return { w, f2, y, gain, kernel };
  });
  return { fc2, y: components[0]!.y, batch, components };
}

/** Whether the dataset's weighting scheme is more than 1/σ². */
const weighted = (dataset: SingleCrystalDataset): boolean => !!dataset.weighting && (dataset.weighting.a > 0 || dataset.weighting.b > 0);

/**
 * The σ a fit weights by under the dataset's weighting scheme, √(σ² + (aP)² +
 * bP) with P = (max(Fo², 0) + 2Fc²)/3 from the Fc² these parameters give; null
 * when the scheme is 1/σ².
 */
export function schemeSigma(structure: StructureModel, dataset: SingleCrystalDataset, parameters: readonly RefinementParameter[], bindings: readonly ParameterBinding[]): number[] | null {
  if (!weighted(dataset)) return null;
  const { a, b } = dataset.weighting!;
  const values: Record<string, number> = {};
  for (const p of parameters) values[p.id] = p.value;
  const applied = applyParameters(structure, bindings, resolveTies(parameters, values));
  const fc2 = scIntensities(scPlans(structure, dataset), applied, dataset).fc2;
  return dataset.reflections.map((r, i) => {
    const p = (Math.max(r.iObs, 0) + 2 * Math.max(fc2[i]!, 0)) / 3;
    const s = r.sigma ?? 0;
    return Math.sqrt(s * s + (a * p) ** 2 + b * p);
  });
}

/** The dataset with its scheme's weights fixed at the Fc² these parameters give (unchanged without a scheme): for fits whose χ² are compared, such as the starts of a multi-start. */
export function withFitWeights(structure: StructureModel, dataset: SingleCrystalDataset, parameters: readonly RefinementParameter[], bindings: readonly ParameterBinding[]): SingleCrystalDataset {
  const fitSigma = schemeSigma(structure, dataset, parameters, bindings);
  return fitSigma ? { ...dataset, fitSigma } : dataset;
}

/**
 * A single-crystal refinement weighted as SHELXL weights it. Under a weighting
 * scheme the weights depend on Fc², which SHELXL recomputes every cycle: the
 * fit is refined again with the weights of its own result until no parameter
 * moves by more than 5 % of its esd (at most four times more). With w = 1/σ²,
 * or weights fixed on the dataset, it is one refinement.
 */
export function refineSingleCrystal(
  structure: StructureModel,
  dataset: SingleCrystalDataset,
  parameters: readonly RefinementParameter[],
  bindings: readonly ParameterBinding[],
  options: Partial<RefinementOptions> = {},
): RefinementResult {
  let result = refine(buildSingleCrystalRefinementProblem(structure, dataset, parameters, bindings), options);
  if (!weighted(dataset) || dataset.fitSigma) return result;
  let history = [...result.history];
  let passes = 0;
  for (; passes < 4 && (result.status === "converged" || result.status === "maxIterations"); passes++) {
    const start = parameters.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
    const again = refine(buildSingleCrystalRefinementProblem(structure, dataset, start, bindings), options);
    history = [...history, ...again.history];
    const moved = Math.max(0, ...parameters.filter((p) => !p.fixed && !p.expression).map((p) => {
      const e = again.esd[p.id];
      return e && e > 0 ? Math.abs((again.parameters[p.id] ?? p.value) - (result.parameters[p.id] ?? p.value)) / e : 0;
    }));
    result = again;
    if (moved < 0.05) {
      passes++;
      break;
    }
  }
  // The message counts every cycle, as `history` does, not the last pass's alone.
  const how = result.status === "converged" ? "converged" : `stopped (${result.status})`;
  return { ...result, history, message: `${how} after ${history.length} iteration(s), the weights re-evaluated at the fit's own Fc² ${passes} time${passes === 1 ? "" : "s"}` };
}

/**
 * Build a single-crystal F² refinement problem: observations are the measured
 * Fo², the model returns k·y·|F|², weights are 1/σ²(Fo²) — or, under SHELXL's
 * WGHT a b, 1/[σ² + (aP)² + bP] with P from the Fc² of the parameters the
 * problem starts from (refineSingleCrystal re-weights as the fit moves). The
 * structure factors come from the
 * kernel (scKernel.ts), and the Jacobian's columns for the scale, the batch
 * scales, the extinction and every structural parameter are analytic: one
 * kernel pass yields them all, where finite differences cost two evaluations
 * per parameter.
 */
export function buildSingleCrystalRefinementProblem(
  structure: StructureModel,
  dataset: SingleCrystalDataset,
  parameters: readonly RefinementParameter[],
  bindings: readonly ParameterBinding[],
): RefinementProblem {
  const observations = Float64Array.from(dataset.reflections.map((r) => r.iObs));
  // Under a weighting scheme the weights follow Fc²: from the dataset's, or from the Fc² these parameters give.
  const fitSigma = dataset.fitSigma?.length === dataset.reflections.length ? dataset.fitSigma : schemeSigma(structure, dataset, parameters, bindings);
  const weights = weightsFromSigma(fitSigma ?? dataset.reflections.map((r) => r.sigma));
  const plans = scPlans(structure, dataset);
  const plan = plans.components[0]!;
  const siteIndex = new Map(structure.sites.map((site, j) => [site.label, j]));
  // The hydrogens riding on each site: they move with its position and their U_iso follows its U_eq.
  const ridersOf = new Map<string, NonNullable<StructureModel["riding"]>[number][]>();
  for (const rule of structure.riding ?? []) ridersOf.set(rule.parent, [...(ridersOf.get(rule.parent) ?? []), rule]);

  const appliedAt = (values: Readonly<Record<string, number>>): ReturnType<typeof applyParameters> =>
    applyParameters(structure, bindings, resolveTies(parameters, values));

  const calculate = (values: Readonly<Record<string, number>>): Float64Array => scIntensities(plans, appliedAt(values), dataset).fc2;

  // The rows a parameter carries by a linear tie ("= f·p + c": the complement
  // of a disorder's occupancy, an ADP held equal to another's): their bindings
  // move with it, f times. A magnitude tie leaves the parameters it reads to
  // finite differences, which see it through calculate().
  const followersOf = new Map<string, { id: string; factor: number }[]>();
  const readByNorm = new Set<string>();
  for (const q of parameters) {
    if (!q.expression) continue;
    const tie = parseTie(q.expression);
    if (tie.kind === "linear") followersOf.set(tie.refId, [...(followersOf.get(tie.refId) ?? []), { id: q.id, factor: tie.factor }]);
    else for (const id of tie.refIds) readByNorm.add(id);
  }

  const analyticColumns = (freeParams: readonly RefinementParameter[], freeValues: readonly number[]): (Float64Array | null)[] => {
    const values: Record<string, number> = {};
    for (const p of parameters) values[p.id] = p.value;
    for (let j = 0; j < freeParams.length; j++) values[freeParams[j]!.id] = freeValues[j]!;
    const applied = appliedAt(values);
    // The riding hydrogens each atom's move carries, with ∂x_H/∂x_atom at these values.
    const movers = new Map<string, { h: number; jacobian: Mat3 }[]>();
    for (const dep of ridingDependence(applied.model)) {
      const h = siteIndex.get(dep.site);
      if (h === undefined) continue;
      for (const on of dep.on) movers.set(on.label, [...(movers.get(on.label) ?? []), { h, jacobian: on.jacobian }]);
    }
    const moversOf = (label: string): { h: number; jacobian: Mat3 }[] => movers.get(label) ?? [];
    // Each free parameter's kernel derivatives (one per binding), or why it has none.
    const requests: ScDerivative[] = [];
    const columnPlans = freeParams.map((p): { kind: "structural"; at: number[] } | { kind: "scale" } | { kind: "extinction" } | { kind: "batch"; batch: number } | { kind: "twin"; law: number } | null => {
      if (readByNorm.has(p.id)) return null;
      const own = bindings.filter((b) => b.parameterId === p.id);
      if (own.length === 0) return null;
      const followers = followersOf.get(p.id) ?? [];
      if (followers.length === 0) {
        if (own.every((b) => b.kind === "scale")) return { kind: "scale" };
        if (own.every((b) => b.kind === "extinction")) return { kind: "extinction" };
        if (own.length === 1 && own[0]!.kind === "batchScale" && own[0]!.targetKey !== undefined) return { kind: "batch", batch: Number(own[0]!.targetKey) };
        if (own.length === 1 && own[0]!.kind === "twinFraction" && own[0]!.targetKey !== undefined) return { kind: "twin", law: Number(own[0]!.targetKey) };
      }
      // Its own bindings, and its followers' at their factor.
      const bs = [...own.map((b) => ({ b, f: 1 })), ...followers.flatMap(({ id, factor }) => bindings.filter((b) => b.parameterId === id).map((b) => ({ b, f: factor })))];
      const at: number[] = [];
      for (const { b, f } of bs) {
        const site = b.targetKey !== undefined ? siteIndex.get(b.targetKey) : undefined;
        if (site === undefined) return null;
        const scaled = f === 1 ? {} : { scale: f };
        let d: ScDerivative | null = null;
        if (b.kind === "positionShift" && b.axis) d = { kind: "position", site, axis: b.axis as [number, number, number], ...scaled };
        else if (b.kind === "uAniso" && b.uBasis) d = { kind: "uMode", site, basis: b.uBasis as [number, number, number, number, number, number], ...scaled };
        else if (b.kind === "bIso") d = { kind: "bIso", site, ...scaled };
        else if (b.kind === "occupancy") d = { kind: "occupancy", site, ...scaled };
        if (!d) return null;
        at.push(requests.length);
        requests.push(d);
        // The riding hydrogens it moves: x_H follows the atoms that place it (∂x_H/∂x·axis, from the
        // geometry at these values); B_H = 8π²·f·U_eq of the parent, linear in each U mode (f·B for an isotropic parent).
        if (d.kind === "position") {
          for (const dep of moversOf(b.targetKey!)) {
            const v = mulVec(dep.jacobian, d.axis as Vec3);
            at.push(requests.length);
            requests.push({ kind: "position", site: dep.h, axis: [v[0], v[1], v[2]], ...scaled });
          }
        }
        for (const rider of ridersOf.get(b.targetKey!) ?? []) {
          const h = siteIndex.get(rider.site);
          if (h === undefined) continue;
          let extra: ScDerivative | null = null;
          if (d.kind === "uMode") extra = { kind: "bIso", site: h, scale: f * EIGHT_PI_SQUARED * rider.uFactor * uEquivalent(d.basis, structure.cell) };
          else if (d.kind === "bIso") extra = { kind: "bIso", site: h, scale: f * rider.uFactor };
          if (!extra) continue;
          at.push(requests.length);
          requests.push(extra);
        }
      }
      return { kind: "structural", at };
    });
    if (columnPlans.every((pl) => pl === null)) return columnPlans.map(() => null);
    const out = scIntensities(plans, applied, dataset, requests, true);
    const comps = out.components;
    const n = plan.n;
    return columnPlans.map((pl): Float64Array | null => {
      if (!pl) return null;
      const col = new Float64Array(n);
      if (pl.kind === "scale") {
        for (const c of comps) for (let i = 0; i < n; i++) col[i]! += c.w * out.batch[i]! * c.y[i]! * c.f2[i]!;
      } else if (pl.kind === "batch") {
        for (const c of comps) for (let i = 0; i < n; i++) if (dataset.reflections[i]!.batch === pl.batch) col[i]! += c.w * applied.scale * c.y[i]! * c.f2[i]!;
      } else if (pl.kind === "twin") {
        // ∂Fc²/∂k_m: the domain's intensity against the first domain's, which gives up what it takes.
        const m = comps[pl.law];
        if (!m) return null;
        const first = comps[0]!;
        for (let i = 0; i < n; i++) col[i] = applied.scale * out.batch[i]! * (m.y[i]! * m.f2[i]! - first.y[i]! * first.f2[i]!);
      } else if (pl.kind === "extinction") {
        const x = applied.extinction;
        const volume = cellVolume(applied.model.cell);
        const step = Math.max(1e-6 * x, 1e-10);
        for (const c of comps) {
          for (let i = 0; i < n; i++) {
            const r = dataset.reflections[i]!;
            const d = 1 / (2 * Math.sqrt(plan.s2[i]!));
            const yAt = (v: number): number => (v > 0 ? extinctionFactorFor(dataset.extinctionModel, v, c.f2[i]!, dataset.radiation, d, volume, r) : 1);
            const dy = x > 10 * step ? (yAt(x + step) - yAt(x - step)) / (2 * step) : (yAt(x + step) - yAt(x)) / step;
            col[i]! += c.w * applied.scale * out.batch[i]! * c.f2[i]! * dy;
          }
        }
      } else {
        for (const c of comps) {
          const { kernel, gain } = c;
          for (let i = 0; i < n; i++) {
            let dF2 = 0;
            for (const r of pl.at) dF2 += 2 * (kernel.re[i]! * kernel.dRe[r]![i]! + kernel.im[i]! * kernel.dIm[r]![i]!);
            col[i]! += c.w * gain![i]! * dF2;
          }
        }
      }
      return col;
    });
  };

  return { parameters, observations, weights, calculate, analyticColumns };
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
 * current parameter values. wR2 and GooF are weighted by the dataset's scheme
 * (SHELXL's WGHT, P from these Fc²; 1/σ² without one), or by `weightAB`.
 */
export function singleCrystalRefinementComparison(
  structure: StructureModel,
  dataset: SingleCrystalDataset,
  parameters: readonly RefinementParameter[],
  bindings: readonly ParameterBinding[],
  weightAB: { readonly a?: number; readonly b?: number } = dataset.weighting ?? {},
): SingleCrystalRefinementComparison {
  const values: Record<string, number> = {};
  for (const p of parameters) values[p.id] = p.value;
  const resolved = resolveTies(parameters, values);
  const applied = applyParameters(structure, bindings, resolved);
  const computed = scIntensities(scPlans(structure, dataset), applied, dataset);

  const foSq: number[] = [];
  const fcSq: number[] = [];
  const sigma: number[] = [];
  const rows: SingleCrystalRefinementComparison["rows"] = [];
  dataset.reflections.forEach((r, i) => {
    const fc2 = computed.fc2[i]!;
    const s = r.sigma ?? 0;
    foSq.push(r.iObs);
    fcSq.push(fc2);
    sigma.push(s);
    rows.push({
      h: r.h, k: r.k, l: r.l, foSq: r.iObs, fcSq: fc2, sigma: s,
      deltaOverSigma: s > 0 ? (r.iObs - fc2) / s : 0,
      extinction: computed.y[i]!,
      ...(r.batch !== undefined ? { batch: r.batch } : {}),
      ...(r.wavelength !== undefined ? { wavelength: r.wavelength } : {}),
    });
  });

  const nFree = parameters.filter((p) => !p.fixed && !p.expression).length;
  const weights = shelxWeights(foSq, fcSq, sigma, weightAB.a ?? 0, weightAB.b ?? 0);
  const agreement = singleCrystalAgreement(foSq, fcSq, sigma, weights, nFree);
  return { rows, agreement };
}
