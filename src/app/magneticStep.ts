/**
 * The magnetic analysis step as one module: the operations of the powder
 * page's Magnetic tab and of the single-crystal and PDF pages' symmetry step,
 * which the panel (components/KSearchPanel.tsx) and the Agent's headless page
 * (testSupport/magneticHeadless.ts) both run. From the residual peaks to k
 * (one option set), the magnetic groups of the little group of k, the moment
 * model under the page's ties, the moments fitted (one rule for the rows a
 * fit frees, one restart scheme), the ranking and its best group, and the
 * rows Continue hands the refinement. The numerics are core/magnetic's; the
 * fit against the data is the page's own (MagneticFit).
 */

import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import type { MagneticModel } from "@/core/magnetic/types";
import type { AnnotatedExtraPeak } from "@/core/magnetic/extraPeaks";
import { searchPropagationVector, type KCandidate } from "@/core/magnetic/kSearch";
import { centringTranslations } from "@/core/crystal/symmetry";
import { magneticSubgroupLattice, latticeRepresentatives, maximalWithMoment, type LatticeCandidate } from "@/core/magnetic/subgroupLattice";
import { buildMagneticModel, type MagneticModelBuild } from "@/core/magnetic/momentModel";
import { propagationKParameters } from "@/core/magnetic/refinableK";
import { fitMomentsWithRestarts, RANK_RESTARTS, type MomentFit } from "@/core/magnetic/momentRestarts";
import { momentCartesian } from "@/core/magnetic/moment";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { resolveTies } from "@/core/refinement/constraints";
import { RANK_TIE_WR } from "@/core/diagnostics/thresholds";
import { withinNoiseOfBest } from "@/core/diagnostics/hamilton";
import { magneticIonCandidates } from "@/core/magnetic/magneticIons";
import { classifyPropagation, describePropagation } from "@/core/magnetic/propagation";
import { littleGroup } from "@/core/magnetic/magneticGroups";
import { decomposeMagneticRepresentation, projectIrrepModes } from "@/core/magnetic/irreps";
import { isotropySubgroup, type IrrepSelection } from "@/core/magnetic/isotropy";
import { magneticOperationSignature } from "@/core/magnetic/operationSignature";
import { fitAmplitudesToMoments } from "@/core/magnetic/amplitudeFit";
import { candidateId, candidateIndex, candidateView, selectionView, type KCandidateView, type MagneticAgentHandle } from "@/agent/magneticPort";

// ── the residual peaks ──────────────────────────────────────────────────────

/**
 * A residual peak as the step consumes it: detected (annotated) or added by a
 * click on the pattern. A manual pick bypasses the inclusion criteria (adding
 * one is the decision) and can be removed from the table.
 */
export interface ResidualPeak extends AnnotatedExtraPeak {
  readonly manual?: boolean;
}

/** Which detections count as magnetic input for the k-search; the per-peak check boxes override them. */
export interface PeakCriteria {
  /** The I/σ a detection must reach (where the data carry σ). */
  readonly minSig: number;
  /** Whether a peak on a nuclear reflection may count (usually profile misfit, not magnetic). */
  readonly allowNearNuclear: boolean;
}

export const PEAK_CRITERIA: PeakCriteria = { minSig: 5, allowNearNuclear: false };

/** A row of the peak table: numbered by d, low Q first, as the ticks on the pattern are. */
export interface PeakRow extends ResidualPeak {
  readonly idx: number;
  /** Its key in the overrides: the d, so a table detected again keeps the picks. */
  readonly key: string;
  readonly included: boolean;
}

export const peakKey = (d: number): string => d.toFixed(5);

/** The peak table: the criteria set each detection's default, a check box (override) overrules it. */
export function peakRows(peaks: readonly ResidualPeak[], criteria: PeakCriteria, overrides: Readonly<Record<string, boolean>>): PeakRow[] {
  return [...peaks]
    .sort((a, b) => b.d - a.d)
    .map((p, i) => {
      const key = peakKey(p.d);
      // A peak without a significance (a masked bin, mixed data) passes the threshold rather than disabling it for everyone.
      const passSig = p.significance === undefined || p.significance >= criteria.minSig;
      const passNuclear = criteria.allowNearNuclear || !p.nearNuclear;
      return { ...p, idx: i + 1, key, included: overrides[key] ?? (p.manual ? true : passSig && passNuclear) };
    });
}

/**
 * The Agent's picks of peaks into or out of the search, by row number, as the
 * table's check boxes: the rows as picked (the search reads them in this
 * call) and the overrides that keep them (the table shows them).
 */
export function pickedRows(
  rows: readonly PeakRow[],
  overrides: Readonly<Record<string, boolean>>,
  choice?: { readonly exclude?: readonly number[]; readonly include?: readonly number[] },
): { readonly rows: PeakRow[]; readonly overrides: Readonly<Record<string, boolean>> } {
  const out = new Set(choice?.exclude ?? []);
  const into = new Set(choice?.include ?? []);
  const unknown = [...out, ...into].filter((n) => !rows.some((r) => r.idx === n));
  if (unknown.length > 0) throw new Error(`no residual peak ${unknown.join(", ")} — the peaks are 1–${rows.length} (magnetic_state lists them)`);
  const picked = rows.map((r) => (out.has(r.idx) ? { ...r, included: false } : into.has(r.idx) ? { ...r, included: true } : r));
  if (out.size + into.size === 0) return { rows: picked, overrides };
  return { rows: picked, overrides: { ...overrides, ...Object.fromEntries(picked.filter((r) => out.has(r.idx) || into.has(r.idx)).map((r) => [r.key, r.included])) } };
}

export const NO_PEAK_INCLUDED = "no residual peak is included for the k-search — the nuclear fit leaves none, or every one sits on a nuclear reflection (left out by default: include them by number, `include`, when they may be magnetic — at k = 0 the magnetic intensity sits on the nuclear lines; magnetic_state lists the peaks)";

// ── k ───────────────────────────────────────────────────────────────────────

/**
 * Candidate k from the included peaks: satellites about the lattice's own
 * reflections (a centred lattice's absences carry none), weighted by
 * significance where the data give one, capped so one strong peak does not
 * drown the rest.
 */
export function searchK(structure: StructureModel, rows: readonly PeakRow[]): KCandidate[] {
  const included = rows.filter((r) => r.included);
  const weighted = rows.some((r) => r.significance !== undefined);
  // The search's own defaults (K_SEARCH_DEFAULTS): the ticked peaks are the criterion, with no Q cut.
  return searchPropagationVector(structure.cell, included.map((r) => r.d), {
    centring: centringTranslations(structure.spaceGroup.operations),
    ...(weighted ? { weights: included.map((r) => Math.min(r.significance ?? 1, 20)) } : {}),
  });
}

// ── the groups and the model ────────────────────────────────────────────────

/** The magnetic space groups of the little group of k: one representative per conjugacy class, every index. */
export function candidatesOf(structure: StructureModel, k: Vec3): LatticeCandidate[] {
  const ops = structure.spaceGroup.operations;
  return ops.length === 0 ? [] : latticeRepresentatives(magneticSubgroupLattice(ops, k));
}

/**
 * The index sections open on a new k, where a top-down search starts: those of
 * its maximal groups that carry a moment on the chosen ions (`moments`, the
 * parameters each group's fit refines; maximal by containment, at any index:
 * MnO at k = 0 has them at 6, 8 and 12). Without the moments, or when no
 * group carries one, the lowest index the groups sit at — 2 at k = 0, 4 where
 * no group closes on the whole little group (the Z point of P4₂/mnm).
 */
export function firstOpen(reps: readonly LatticeCandidate[], moments?: readonly number[]): Set<number> {
  if (moments) {
    const top = maximalWithMoment(reps, moments);
    const indices = reps.filter((_, i) => top[i]).map((r) => r.index);
    if (indices.length > 0) return new Set(indices);
  }
  return new Set([reps.length > 0 ? Math.min(...reps.map((r) => r.index)) : 2]);
}

/** The moment model's options: same-site moments tied, an |M| tie (within each element or across all), the sublattices flipped. */
export interface ModelOptions {
  readonly sameSite: boolean;
  readonly magnitudes: false | "element" | "all";
  readonly flippedUnits: readonly string[];
}

/**
 * The moment parameters each group's fit refines on the chosen ions: the free
 * rows of its moment model under the page's ties (fitRows) — every split
 * orbit's modes, co-located ions sharing one moment when the same-site tie is
 * on, a derived |M| row and a two-arm k's phase gauge held. What Hamilton's
 * test counts, what the ★'s "fewest parameters" compares, and 0 only for a
 * group that puts no moment on any orbit of the chosen ions.
 */
export function momentParameters(structure: StructureModel, reps: readonly LatticeCandidate[], ions: Iterable<string>, k: Vec3, options: ModelOptions): number[] {
  const labels = [...ions];
  return reps.map((r) => fitRows(buildFor(structure, k, labels, r.candidate.operations, options)).filter((p) => !p.fixed).length);
}

/** The moment model of a group's operations: one builder for the chosen group and for the ranking, so a ranked wR is the model a click previews. */
export function buildFor(structure: StructureModel, k: Vec3, ions: Iterable<string>, ops: readonly SymmetryOperation[], options: ModelOptions): MagneticModelBuild {
  return buildMagneticModel(structure, k, [...ions], [...ops], {
    moment: 2,
    tieSameSite: options.sameSite,
    tieEqualMagnitude: options.magnitudes,
    flippedUnits: [...options.flippedUnits],
  });
}

/** The amplitudes with the |M| ties resolved: every row a value (edited, else its seed), a derived one following its reference. */
export function resolvedAmplitudes(build: MagneticModelBuild, amps: Readonly<Record<string, number>>): Record<string, number> {
  const base: Record<string, number> = {};
  for (const p of build.params) base[p.id] = amps[p.id] ?? p.value;
  return resolveTies(build.params, base);
}

// ── the fit ─────────────────────────────────────────────────────────────────

/** How a fit runs: `restarts`, the page's own multi-start inside the fit (absent: the page's default). */
export interface FitOptions {
  readonly restarts?: number;
  /**
   * Refine the nuclear scale with the moments: at k = 0 the magnetic peaks
   * sit on the nuclear ones, and a scale refined without the moments has
   * taken up part of their intensity.
   */
  readonly freeScale?: boolean;
}

/**
 * The page's moments-only fit (powder pattern, single-crystal F², mPDF), the
 * nuclear model held. The symmetry workflow is the same on every page; only
 * this fit differs.
 */
export interface MagneticFit {
  /** Refine the moment rows (the free ones; fitRows says which) against the data. */
  readonly refine: (
    magnetic: MagneticModel,
    momentParams: readonly RefinementParameter[],
    momentBindings: readonly ParameterBinding[],
    options?: FitOptions,
  ) => Promise<MomentFit>;
  /** The agreement's name: "wR" (powder), "wR2" (single crystal), "Rw" (mPDF). */
  readonly agreementLabel: string;
  /**
   * Why this fit cannot model the k, or null when it can: every action that
   * would give a number is then held back (mPDF: an incommensurate k has no
   * periodic spin box).
   */
  readonly unsupportedK?: (k: Vec3) => string | null;
  /**
   * Whether each of the ranking's starts keeps this fit's own multi-start.
   * The mPDF's does: d(r) is quadratic in the moments, and on a synthetic
   * Mn₃Ga mPDF the true group's minimum was found only with them
   * (docs/reports/2026-10-19-magnetic-step.md).
   */
  readonly nestedStarts?: boolean;
}

/**
 * The rows a moment fit refines, from a start (absent: the model's seeds):
 * every amplitude free but a derived one (an |M| tie's "= ±hypot(…)", which
 * follows its reference) and the phase gauge of a two-arm k (the global
 * modulation phase, which the data cannot see).
 */
export function fitRows(build: MagneticModelBuild, start?: Readonly<Record<string, number>>): RefinementParameter[] {
  const gauge = build.phaseGauge?.parameterId;
  return build.params.map((p) => {
    const v = start?.[p.id] ?? p.value;
    return { ...p, value: v, initialValue: v, fixed: !!p.expression || p.id === gauge };
  });
}

/** One fit of a model's moments, from a start. */
export function fitMoments(fit: MagneticFit, build: MagneticModelBuild, start?: Readonly<Record<string, number>>, options?: FitOptions): Promise<MomentFit> {
  return fit.refine(build.magnetic, fitRows(build, start), build.bindings, options);
}

// ── the ranking ─────────────────────────────────────────────────────────────

/** One group's result in the ranking. */
export interface RankEntry {
  readonly status: "ok" | "failed" | "forbidden";
  /** The moments-only fit's agreement (a fraction); null when not fitted. */
  readonly wR: number | null;
  /** The refined amplitudes by row id: the seed when the group is chosen. */
  readonly values: Record<string, number>;
  /** The refined moment per sublattice (µ_B), a split orbit's as site#orbit. */
  readonly magnitudes: readonly { readonly label: string; readonly value: number }[];
  /** The fit's χ² and degrees of freedom, where it is weighted by the data's σ: Hamilton's test reads them. */
  readonly chi2?: number;
  readonly dof?: number;
}

export interface RankRun {
  readonly structure: StructureModel;
  readonly reps: readonly LatticeCandidate[];
  /** The moment parameters each group's fit refines (`momentParameters`), in the order of `reps`. */
  readonly dims: readonly number[];
  /** "open": the index sections open on the page; "all": every one. */
  readonly scope: "open" | "all";
  readonly open: ReadonlySet<number>;
  readonly build: (ops: readonly SymmetryOperation[]) => MagneticModelBuild;
  readonly fit: MagneticFit;
  readonly restarts?: number;
  /** Refine the nuclear scale with each group's moments (k = 0). */
  readonly freeScale?: boolean;
  readonly cancelled?: () => boolean;
  /** Each group as it is fitted, with the results so far. */
  readonly onEntry?: (results: Readonly<Record<string, RankEntry>>) => void;
}

/** The groups a ranking fits: those whose fit refines a moment on the chosen ions (any split orbit), in the scope. */
export function rankedGroups(reps: readonly LatticeCandidate[], dims: readonly number[], scope: "open" | "all", open: ReadonlySet<number>): LatticeCandidate[] {
  return reps.filter((r, i) => (dims[i] ?? 0) > 0 && (scope === "all" || open.has(r.index)));
}

/**
 * Rank the groups against the data: each fitted from its seeds, then from
 * kicked restarts (one fit can stop with a sublattice switched off), the
 * lowest agreement kept. The ranking is the restart loop: each start is one
 * fit, without the page's own restarts, but where the fit keeps them
 * (nestedStarts). A fit that fails marks its group and the ranking goes on.
 */
export async function rankCandidates(run: RankRun): Promise<Record<string, RankEntry>> {
  const results: Record<string, RankEntry> = {};
  for (const r of rankedGroups(run.reps, run.dims, run.scope, run.open)) {
    if (run.cancelled?.()) break;
    const id = r.candidate.id;
    try {
      const build = run.build(r.candidate.operations);
      if (build.params.length === 0) {
        results[id] = { status: "forbidden", wR: null, values: {}, magnitudes: [] };
      } else {
        const once = { ...(run.fit.nestedStarts ? {} : { restarts: 0 }), ...(run.freeScale ? { freeScale: true } : {}) };
        const { values, agreement, chi2, dof } = await fitMomentsWithRestarts(fitRows(build), (start) => fitMoments(run.fit, build, start, once), {
          restarts: run.restarts ?? RANK_RESTARTS,
          ...(run.cancelled ? { cancelled: run.cancelled } : {}),
        });
        const applied = applyMagneticMoments(build.magnetic, build.bindings, values);
        const magnitudes = applied.moments.map((m) => ({
          label: `${m.siteLabel}${m.orbitIndex !== undefined && m.orbitIndex > 1 ? `#${m.orbitIndex}` : ""}`,
          value: Math.hypot(...momentCartesian(run.structure.cell, m)),
        }));
        results[id] = { status: "ok", wR: agreement, values, magnitudes, ...(chi2 !== undefined && dof !== undefined ? { chi2, dof } : {}) };
      }
    } catch {
      results[id] = { status: "failed", wR: null, values: {}, magnitudes: [] };
    }
    if (run.cancelled?.()) break;
    run.onEntry?.({ ...results });
  }
  return results;
}

/**
 * The groups within the noise of the best fit: by Hamilton's test where every
 * fit reports its χ² (a group with more moment parameters must lower χ²
 * beyond the noise to beat one with fewer), else the groups within
 * RANK_TIE_WR of the lowest agreement (the same fit). The skill's "groups
 * within the noise of the best are equally good fits".
 */
export function withinNoise(results: Readonly<Record<string, RankEntry>>, reps: readonly LatticeCandidate[], dims: readonly number[]): string[] {
  const ok = Object.entries(results).filter(([, e]) => e.status === "ok" && e.wR != null);
  if (ok.length === 0) return [];
  const moments = new Map(reps.map((r, i) => [r.candidate.id, dims[i] ?? 0]));
  if (ok.every(([, e]) => e.chi2 !== undefined && e.dof !== undefined)) {
    const set = withinNoiseOfBest(ok.map(([id, e]) => ({ id, chi2: e.chi2!, dof: e.dof!, parameters: moments.get(id) ?? 0 })));
    return ok.filter(([id]) => set.has(id)).map(([id]) => id);
  }
  const bw = Math.min(...ok.map(([, e]) => e.wR!));
  return ok.filter(([, e]) => e.wR! <= bw + RANK_TIE_WR).map(([id]) => id);
}

/**
 * The groups within the noise of the best fit (withinNoise), in the order the
 * ★ takes them, top-down: a group no other of them contains first (a group
 * with a supergroup among them is the lower symmetry the data do not ask
 * for), then the lowest index, the fewest moment parameters, the lowest
 * agreement. Ties are the rule: a powder often cannot tell several groups
 * apart, and the top-down prescription breaks them.
 */
export function rankWithinNoise(results: Readonly<Record<string, RankEntry>>, reps: readonly LatticeCandidate[], dims: readonly number[]): string[] {
  const tied = withinNoise(results, reps, dims);
  const meta = new Map(reps.map((r, i) => [r.candidate.id, { rep: r, dof: dims[i] ?? 0 }]));
  const classes = new Set(tied.map((id) => meta.get(id)?.rep.classId));
  const below = (id: string): number => (meta.get(id)?.rep.above.some((c) => classes.has(c)) ? 1 : 0);
  return tied.sort((a, b) =>
    below(a) - below(b) ||
    (meta.get(a)?.rep.index ?? 99) - (meta.get(b)?.rep.index ?? 99) ||
    (meta.get(a)?.dof ?? 99) - (meta.get(b)?.dof ?? 99) ||
    results[a]!.wR! - results[b]!.wR!,
  );
}

/** The ★: the first of the groups within the noise of the best fit, top-down (rankWithinNoise). */
export function bestRanked(results: Readonly<Record<string, RankEntry>>, reps: readonly LatticeCandidate[], dims: readonly number[]): { readonly id: string; readonly wR: number } | null {
  const id = rankWithinNoise(results, reps, dims)[0];
  return id === undefined ? null : { id, wR: results[id]!.wR! };
}

// ── the hand-off ────────────────────────────────────────────────────────────

/** What Continue hands the refinement page. */
export interface Handoff {
  readonly magnetic: MagneticModel;
  readonly params: RefinementParameter[];
  readonly bindings: ParameterBinding[];
}

/**
 * The model at these amplitudes, its rows free as a fit frees them (fitRows:
 * the phase gauge and a derived row held) and, with k, the k components the
 * little group leaves free.
 */
export function handoff(build: MagneticModelBuild, amps: Readonly<Record<string, number>>, kRows: ReturnType<typeof propagationKParameters> | null): Handoff {
  return {
    magnetic: applyMagneticMoments(build.magnetic, build.bindings, amps),
    params: [...fitRows(build, amps), ...(kRows ? kRows.params.map((p) => ({ ...p, fixed: !!p.expression })) : [])],
    bindings: [...build.bindings, ...(kRows ? kRows.bindings : [])],
  };
}

// ── the step's state ────────────────────────────────────────────────────────

/**
 * What the step works on, from its page: the phase (refined), the residual
 * peaks, the page's fit, the nuclear-only agreement, a model to open on, and
 * where Show and Continue hand a model.
 */
export interface StepInputs {
  readonly structure: StructureModel;
  readonly residualPeaks: readonly ResidualPeak[];
  /** The page's moments fit; null where there is nothing to fit against. */
  readonly fit: MagneticFit | null;
  readonly baselineAgreement: number | null;
  /** The page refines k with the moments (powder). */
  readonly allowRefineK: boolean;
  /** The data and the fit window, as a key: a new one drops the ranking and the fit readout. */
  readonly fitContext: string;
  /** A model to open on (an applied one, a demo, a reopened project); a new one is opened on. */
  readonly preselect: MagneticModel | null;
  readonly onApply?: (magnetic: MagneticModel | null) => void;
  readonly onContinue?: (magnetic: MagneticModel, params: readonly RefinementParameter[], bindings: readonly ParameterBinding[]) => void;
}

/** The moment model's ties as the page sets them. */
export interface StepTies {
  readonly sameSite: boolean;
  /** An |M| tie across sublattices, within each element or across all sites (the scope kept while it is off). */
  readonly magnitudes: boolean;
  readonly scope: "element" | "all";
  readonly flippedUnits: ReadonlySet<string>;
}

export interface StepRank {
  readonly running: boolean;
  readonly done: number;
  readonly total: number;
  readonly results: Readonly<Record<string, RankEntry>>;
  /** The model and data it was run on (rankKey). */
  readonly on: string;
}

/** The step's state: what the page shows and the Agent reads, from the ions to the ranking. */
export interface StepState {
  readonly ions: ReadonlySet<string>;
  readonly k: Vec3;
  /** The last k-search, for the included peaks it was run on. */
  readonly search: { readonly peaks: string; readonly found: readonly KCandidate[] } | null;
  readonly criteria: PeakCriteria;
  readonly overrides: Readonly<Record<string, boolean>>;
  /** The symmetry framework: the magnetic space groups, or representation analysis. */
  readonly framework: "msg" | "irrep";
  readonly irreps: ReadonlySet<string>;
  /** The chosen group (its place in the list for this k). */
  readonly chosen: number | null;
  /** The index sections open: the maximal groups' to start, and each a choice or a click opens. */
  readonly open: ReadonlySet<number>;
  readonly amps: Readonly<Record<string, number>>;
  readonly ties: StepTies;
  /** Continue hands k over to refine with the moments. */
  readonly refineK: boolean;
  readonly rank: StepRank;
  /** The chosen model's moments fit, for the model and data it was run on (fitKey). */
  readonly fitWR: { readonly on: string; readonly wR: number | null } | null;
  readonly refining: boolean;
}

/** No ranking: before one, or once the model or data it ran on have changed. */
export const NO_RANK: StepRank = { running: false, done: 0, total: 0, results: {}, on: "" };

/** A structure's content, for the keys: a rebuilt but equal structure (Show strips the model's rows) keeps the ranking. */
function structureKey(s: StructureModel): string {
  return JSON.stringify([s.cell, s.spaceGroup.hermannMauguin, s.spaceGroup.operations.length, s.sites.map((x) => [x.label, x.element, x.position, x.occupancy])]);
}

const sortedKey = (set: Iterable<string>): string => [...set].sort().join(",");

/** What the step derives from its state and its page, memoized. */
export interface StepView {
  readonly rows: readonly PeakRow[];
  readonly includedSignature: string;
  /** The k-search's candidates while the included peaks are the ones it ran on. */
  readonly results: readonly KCandidate[] | null;
  readonly kClass: ReturnType<typeof classifyPropagation>;
  readonly reps: readonly LatticeCandidate[];
  readonly lgSize: number;
  /** The moment parameters each group's fit refines on the chosen ions, under the ties (`momentParameters`). */
  readonly dims: readonly number[];
  readonly irrepAnalysis: { readonly dec: ReturnType<typeof decomposeMagneticRepresentation>; readonly modes: ReturnType<typeof projectIrrepModes>[]; readonly lg: ReturnType<typeof littleGroup> } | null;
  readonly combo: ReturnType<typeof isotropySubgroup> | null;
  /** The isotropy subgroup as one of the candidates (it always is one), or null. */
  readonly comboRepIdx: number | null;
  /** The operations of the chosen group, from whichever framework is active. */
  readonly chosenOps: readonly SymmetryOperation[] | null;
  readonly options: ModelOptions;
  /** The chosen group's moment model. */
  readonly build: MagneticModelBuild | null;
  readonly kRows: ReturnType<typeof propagationKParameters> | null;
  readonly canRefineK: boolean;
  readonly resolvedAmps: Readonly<Record<string, number>>;
  readonly applied: MagneticModel | null;
  readonly kUnsupported: string | null;
  readonly canFit: boolean;
  readonly canRefine: boolean;
  readonly agreementLabel: string;
  /** What a ranking's fit means: the data, the window, the structure, k, the ions, the ties. */
  readonly rankKey: string;
  /** What the chosen model's fit means: the ranking's key and the group. */
  readonly fitKey: string;
  /** The ranking while it is for this model and data. */
  readonly rankResults: Readonly<Record<string, RankEntry>>;
  readonly best: { readonly id: string; readonly wR: number } | null;
  /** The ranked groups within the noise of the best fit, in the ★'s order (the ★ first). */
  readonly noise: readonly string[];
  /** Per representative: a maximal group that carries a moment on the chosen ions (maximalWithMoment). */
  readonly maximal: readonly boolean[];
  /** The chosen model's fit while it is for this model and data. */
  readonly fitWR: number | null;
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

/**
 * The step's derived values, one slot each, kept while what it is made from
 * (by identity) stays. Each step holds its own slots: the app mounts several
 * steps at once (the powder page's stays mounted, hidden, beside the PDF or
 * single-crystal page's), and slots shared between them made each evict the
 * other's on every render, re-enumerating the magnetic subgroup lattice each
 * time (about half a second for GaTa₄Se₈'s 96 operations, on the UI thread).
 */
export type StepSlots = Map<string, { readonly deps: readonly unknown[]; readonly value: unknown }>;

/** What the step derives from a state on its page's inputs, in its own slots. */
export function stepView(s: StepState, at: StepInputs, slots: StepSlots): StepView {
  const memo = <T,>(key: string, deps: readonly unknown[], make: () => T): T => {
    const slot = slots.get(key);
    if (slot && sameDeps(slot.deps, deps)) return slot.value as T;
    const value = make();
    slots.set(key, { deps, value });
    return value;
  };
  const { structure } = at;
  const rows = memo("rows", [at.residualPeaks, s.criteria, s.overrides], () => peakRows(at.residualPeaks, s.criteria, s.overrides));
  const includedSignature = memo("included", [rows], () => rows.filter((r) => r.included).map((r) => r.key).join("|"));
  const results = s.search && s.search.peaks === includedSignature ? s.search.found : null;
  const kClass = memo("kClass", [structure, ...s.k], () => classifyPropagation(s.k, { centrings: centringTranslations(structure.spaceGroup.operations) }));
  const { reps, lgSize } = memo("reps", [structure, ...s.k], () => {
    const ops = structure.spaceGroup.operations;
    return { reps: candidatesOf(structure, s.k), lgSize: ops.length === 0 ? 0 : littleGroup(ops, s.k).length };
  });
  const options = memo("options", [s.ties], (): ModelOptions => ({
    sameSite: s.ties.sameSite,
    magnitudes: s.ties.magnitudes ? s.ties.scope : false,
    flippedUnits: [...s.ties.flippedUnits],
  }));
  // The moment parameters each group's fit refines, under the page's ties: the count the ranking reads.
  const dims = memo("dims", [reps, s.ions, structure, options, ...s.k], () => momentParameters(structure, reps, s.ions, s.k, options));
  // Representation analysis: Γ_mag over G(k) into the irreps of its little co-group, each one's basis modes on the reference site.
  const irrepAnalysis = memo("irreps", [structure, s.ions, ...s.k], () => {
    const ops = structure.spaceGroup.operations;
    if (ops.length === 0 || s.ions.size === 0) return null;
    const lg = littleGroup(ops, s.k);
    const dec = decomposeMagneticRepresentation(structure, s.k, [...s.ions], lg);
    const modes = dec.available ? dec.terms.map((t) => projectIrrepModes(structure, s.k, [...s.ions], lg, t.irrep)) : [];
    return { dec, modes, lg };
  });
  // The isotropy subgroup of the irreps chosen (any combination of real ones), named against the BNS/OG table.
  const combo = memo("combo", [irrepAnalysis, s.irreps, structure, s.ions, ...s.k], () => {
    if (!irrepAnalysis || !irrepAnalysis.dec.available || s.irreps.size === 0) return null;
    const selections: IrrepSelection[] = irrepAnalysis.dec.terms.filter((t) => s.irreps.has(t.irrep.label)).map((t) => ({ irrep: t.irrep }));
    return selections.length === 0 ? null : isotropySubgroup(structure, s.k, [...s.ions], irrepAnalysis.lg, selections);
  });
  const comboRepIdx = memo("comboRep", [combo, reps], () => {
    if (!combo || "failure" in combo) return null;
    const sig = magneticOperationSignature(combo.operations);
    const idx = reps.findIndex((r) => magneticOperationSignature(r.candidate.operations) === sig);
    return idx >= 0 ? idx : null;
  });
  const chosenOps = s.framework === "msg" ? (s.chosen != null ? reps[s.chosen]?.candidate.operations ?? null : null) : combo && !("failure" in combo) ? combo.operations : null;
  const build = memo("build", [chosenOps, structure, s.ions, options, ...s.k], () => (chosenOps ? buildFor(structure, s.k, s.ions, chosenOps, options) : null));
  const kRows = memo("kRows", [structure, build], () => (build ? propagationKParameters(structure, build.magnetic) : null));
  const canRefineK = at.allowRefineK && !!kRows && kRows.params.length > 0;
  const resolvedAmps = memo("amps", [build, s.amps], () => (build ? resolvedAmplitudes(build, s.amps) : s.amps));
  const applied = memo("applied", [build, resolvedAmps], () => (build ? applyMagneticMoments(build.magnetic, build.bindings, resolvedAmps) : null));
  const kUnsupported = at.fit?.unsupportedK?.(s.k) ?? null;
  const canFit = !!at.fit && !kUnsupported;
  const canRefine = !!(build && build.params.length > 0 && at.fit) && !kUnsupported;
  const rankKey = `${at.fitContext}|${memo("structureKey", [structure], () => structureKey(structure))}|${s.k.join(",")}|${sortedKey(s.ions)}|${s.ties.sameSite}|${options.magnitudes}|${sortedKey(s.ties.flippedUnits)}`;
  const fitKey = `${rankKey}|${chosenOps ? magneticOperationSignature(chosenOps) : ""}`;
  const rankResults = s.rank.on === rankKey ? s.rank.results : {};
  const noise = memo("noise", [rankResults, reps, dims], () => rankWithinNoise(rankResults, reps, dims));
  const best = memo("best", [noise, rankResults], () => (noise.length > 0 ? { id: noise[0]!, wR: rankResults[noise[0]!]!.wR! } : null));
  const maximal = memo("maximal", [reps, dims], () => maximalWithMoment(reps, dims));
  return {
    rows, includedSignature, results, kClass, reps, lgSize, dims, irrepAnalysis, combo, comboRepIdx, chosenOps, options, build, kRows, canRefineK,
    resolvedAmps, applied, kUnsupported, canFit, canRefine, agreementLabel: at.fit?.agreementLabel ?? "wR", rankKey, fitKey, rankResults, best, noise, maximal,
    fitWR: s.fitWR && s.fitWR.on === fitKey ? s.fitWR.wR : null,
  };
}

/**
 * The magnetic step: its state, the changes the page's controls and the Agent
 * make, the derived view, and the Agent's handle (one object for the step's
 * life, so a call after an await reads the step as it is). The panel renders
 * it (useSyncExternalStore) and the Agent's headless page holds one too; each
 * gives it its inputs.
 */
export class MagneticStep {
  private s: StepState;
  private readonly listeners = new Set<() => void>();
  private cancelRequested = false;
  private seenPreselect: MagneticModel | null = null;
  private seenPeaks = "";
  private readonly slots: StepSlots = new Map();
  readonly handle: MagneticAgentHandle;

  constructor(private readonly inputs: () => StepInputs) {
    const at = inputs();
    this.s = {
      ions: new Set(magneticIonCandidates(at.structure).map((i) => i.siteLabel)),
      k: [0, 0, 0],
      search: null,
      criteria: PEAK_CRITERIA,
      overrides: {},
      framework: "msg",
      irreps: new Set(),
      chosen: null,
      open: new Set([2]),
      amps: {},
      ties: { sameSite: true, magnitudes: false, scope: "element", flippedUnits: new Set() },
      refineK: false,
      rank: NO_RANK,
      fitWR: null,
      refining: false,
    };
    // The sections open to start: those of the maximal groups that carry a moment at k = 0.
    const v0 = this.view(this.s, at);
    this.s = { ...this.s, open: firstOpen(v0.reps, v0.dims) };
    this.seenPeaks = peakSetKey(at.residualPeaks);
    this.sync();
    this.handle = this.makeHandle();
  }

  // ── the store ──

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly state = (): StepState => this.s;

  /**
   * The new state, with what no longer holds dropped: a ranking or a fit
   * readout once the model or data it ran on have changed, so neither comes
   * back when the page returns to the same content.
   */
  private commit(next: StepState): void {
    next = this.holding(next);
    if (next === this.s) return;
    this.s = next;
    for (const l of this.listeners) l();
  }

  /** A state without what no longer holds on the page's inputs; the same state when all of it holds. */
  private holding(next: StepState): StepState {
    const v = this.view(next);
    if (next.search && next.search.peaks !== v.includedSignature) next = { ...next, search: null };
    if (next.rank !== NO_RANK && next.rank.on !== v.rankKey) {
      this.cancelRequested = true;
      next = { ...next, rank: NO_RANK };
    }
    if (next.fitWR && next.fitWR.on !== v.fitKey) next = { ...next, fitWR: null };
    return next;
  }

  /**
   * A change that can change the chosen model: the amplitudes follow it. A
   * seed (a ranked group's fitted values, a model opened on) gives them;
   * otherwise each keeps its value where the new model has the same row.
   */
  private commitModel(next: StepState, seed?: Readonly<Record<string, number>>): void {
    const before = this.view(this.s).build;
    const after = this.view(next).build;
    if (after && (seed || after !== before)) {
      const from = seed ?? next.amps;
      const amps: Record<string, number> = {};
      for (const p of after.params) amps[p.id] = from[p.id] ?? p.value;
      next = { ...next, amps };
    }
    this.commit(next);
  }

  /**
   * Catch up with the page: a new model to open on is opened on, and a new
   * peak set drops the picks of peaks no longer in it. The panel calls it
   * after each render; the handle before each call.
   */
  sync(): void {
    const at = this.inputs();
    if (at.preselect !== this.seenPreselect) {
      this.seenPreselect = at.preselect;
      if (at.preselect?.operations) this.openOn(at.preselect);
    }
    const peaks = peakSetKey(at.residualPeaks);
    if (peaks !== this.seenPeaks) {
      this.seenPeaks = peaks;
      const valid = new Set(at.residualPeaks.map((p) => peakKey(p.d)));
      const kept = Object.entries(this.s.overrides).filter(([key]) => valid.has(key));
      if (kept.length !== Object.keys(this.s.overrides).length) this.commit({ ...this.s, overrides: Object.fromEntries(kept) });
    }
    // The candidates of a k-search are for the peaks it ran on; a ranking and a readout, for the model and data.
    this.commit(this.s);
  }

  /** The derived view of a state (this one by default) on the page's current inputs (or these). */
  view(s: StepState = this.s, at: StepInputs = this.inputs()): StepView {
    return stepView(s, at, this.slots);
  }

  // ── the changes ──

  /** Confirm a k: the group pick goes, with the irreps chosen and the sections opened. */
  setK(k: Vec3): void {
    const next: StepState = { ...this.s, k: [k[0], k[1], k[2]], chosen: null, irreps: new Set() };
    const v = this.view(next);
    this.commitModel({ ...next, open: firstOpen(v.reps, v.dims) });
  }

  setIons(labels: Iterable<string>): void {
    this.commitModel({ ...this.s, ions: new Set(labels) });
  }

  toggleIon(label: string): void {
    const ions = new Set(this.s.ions);
    if (ions.has(label)) ions.delete(label);
    else ions.add(label);
    this.setIons(ions);
  }

  /** A new criterion drops the per-peak picks: the criteria stay the one explanation of what is included. */
  setCriteria(criteria: Partial<PeakCriteria>): void {
    this.commit({ ...this.s, criteria: { ...this.s.criteria, ...criteria }, overrides: {} });
  }

  setOverride(key: string, included: boolean): void {
    this.commit({ ...this.s, overrides: { ...this.s.overrides, [key]: included } });
  }

  /** Search k from these rows' included peaks (the table's, by default). */
  search(rows: readonly PeakRow[] = this.view().rows): KCandidate[] {
    const at = this.inputs();
    const found = searchK(at.structure, rows);
    this.commit({ ...this.s, search: { peaks: rows.filter((r) => r.included).map((r) => r.key).join("|"), found } });
    return found;
  }

  setFramework(framework: "msg" | "irrep"): void {
    this.commitModel({ ...this.s, framework });
  }

  toggleIrrep(label: string): void {
    const irreps = new Set(this.s.irreps);
    if (irreps.has(label)) irreps.delete(label);
    else irreps.add(label);
    this.commitModel({ ...this.s, irreps });
  }

  toggleOpen(index: number): void {
    const open = new Set(this.s.open);
    if (open.has(index)) open.delete(index);
    else open.add(index);
    this.commit({ ...this.s, open });
  }

  /**
   * Choose a group (null: none): its index section opens, and a ranked one
   * starts from its fitted moments.
   */
  choose(i: number | null): void {
    if (i === null) {
      this.commitModel({ ...this.s, chosen: null });
      return;
    }
    const v = this.view();
    const r = v.reps[i];
    if (!r) return;
    const entry = v.rankResults[r.candidate.id];
    const seed = entry?.status === "ok" && i !== this.s.chosen ? entry.values : undefined;
    this.commitModel({ ...this.s, framework: "msg", chosen: i, open: new Set([...this.s.open, r.index]) }, seed);
  }

  setAmp(id: string, value: number): void {
    this.commit({ ...this.s, amps: { ...this.s.amps, [id]: value } });
  }

  setTies(ties: Partial<Omit<StepTies, "flippedUnits">>): void {
    this.commitModel({ ...this.s, ties: { ...this.s.ties, ...ties } });
  }

  toggleFlip(key: string): void {
    const flippedUnits = new Set(this.s.ties.flippedUnits);
    if (flippedUnits.has(key)) flippedUnits.delete(key);
    else flippedUnits.add(key);
    this.commitModel({ ...this.s, ties: { ...this.s.ties, flippedUnits } });
  }

  setRefineK(refineK: boolean): void {
    this.commit({ ...this.s, refineK });
  }

  /**
   * Open on a model: its ions (those carrying a moment), its k, the
   * magnetic-group framework, the candidate whose operations match (its
   * section opened) and amplitudes fitted to its moments. A model that is not
   * a candidate of the lattice (a non-standard setting) leaves the page open
   * at its k.
   */
  openOn(model: MagneticModel): void {
    const at = this.inputs();
    const k = model.propagation[0] ?? [0, 0, 0];
    const carrying = new Set(model.moments.filter((m) => m.components.some((c) => c !== 0) || (m.sinComponents?.some((c) => c !== 0) ?? false)).map((m) => m.siteLabel));
    const known = new Set(magneticIonCandidates(at.structure).map((i) => i.siteLabel));
    const pick = [...carrying].filter((l) => known.has(l));
    const kNext: Vec3 = [k[0]!, k[1]!, k[2]!];
    const opened: StepState = { ...this.s, ...(pick.length > 0 ? { ions: new Set(pick) } : {}), framework: "msg", k: kNext, chosen: null, irreps: new Set() };
    const v = this.view(opened, at);
    const reps = v.reps;
    let next: StepState = { ...opened, open: firstOpen(reps, v.dims) };
    if (!model.operations) {
      this.commitModel(next);
      return;
    }
    const sig = magneticOperationSignature(model.operations);
    const idx = reps.findIndex((r) => magneticOperationSignature(r.candidate.operations) === sig);
    if (idx < 0) {
      this.commitModel(next);
      return;
    }
    next = { ...next, chosen: idx, open: new Set([...next.open, reps[idx]!.index]) };
    const build = this.view(next).build;
    this.commitModel(next, build ? fitAmplitudesToMoments(build, model).values : undefined);
  }

  /** Stop a ranking after the group being fitted; the groups done stay. */
  cancelRank(): void {
    this.cancelRequested = true;
  }

  /** Rank the groups in the scope against the data (rankCandidates), the table filling as each is fitted. */
  async rank(scope: "open" | "all", restarts?: number): Promise<void> {
    this.sync();
    const at = this.inputs();
    const v = this.view();
    if (!v.canFit || !at.fit) throw new Error(v.kUnsupported ?? "the moments cannot be fitted on this page (no refinable pattern)");
    const total = rankedGroups(v.reps, v.dims, scope, this.s.open).length;
    if (total === 0) return;
    const on = v.rankKey;
    this.cancelRequested = false;
    // A change of what the fits mean stops the run, as a click on Cancel does.
    const stopped = (): boolean => this.cancelRequested || this.view().rankKey !== on;
    this.commit({ ...this.s, rank: { running: true, done: 0, total, results: {}, on } });
    await rankCandidates({
      structure: at.structure, reps: v.reps, dims: v.dims, scope, open: this.s.open, fit: at.fit,
      build: (ops) => buildFor(at.structure, this.s.k, this.s.ions, ops, v.options),
      ...(restarts !== undefined ? { restarts } : {}),
      // At k = 0 the magnetic peaks sit on the nuclear ones: the scale refines with the moments.
      ...(this.s.k.every((v) => Math.abs(v) < 1e-9) ? { freeScale: true } : {}),
      cancelled: stopped,
      onEntry: (results) => {
        if (this.s.rank.on === on) this.commit({ ...this.s, rank: { ...this.s.rank, done: this.s.rank.done + 1, results } });
      },
    });
    if (this.s.rank.on === on) this.commit({ ...this.s, rank: { ...this.s.rank, running: false } });
  }

  /** Fit the chosen model's moments (the page's own restarts), its amplitudes then the fitted ones. */
  async refineMoments(): Promise<number | null> {
    this.sync();
    const at = this.inputs();
    const v = this.view();
    if (!v.canRefine || !v.build || !at.fit) return null;
    const build = v.build;
    const on = v.fitKey;
    this.commit({ ...this.s, refining: true, fitWR: null });
    try {
      const { values, agreement } = await fitMoments(at.fit, build, v.resolvedAmps);
      const amps: Record<string, number> = { ...this.s.amps };
      for (const p of build.params) amps[p.id] = values[p.id] ?? amps[p.id]!;
      this.commit({ ...this.s, amps, fitWR: { on, wR: agreement } });
      return agreement;
    } finally {
      this.commit({ ...this.s, refining: false });
    }
  }

  /** Show the chosen model on the refinement pattern (its moments held), or clear it. */
  show(on: boolean): void {
    const at = this.inputs();
    if (!at.onApply) throw new Error("this page cannot show a model on the refinement pattern");
    if (!on) {
      at.onApply(null);
      return;
    }
    const v = this.view();
    if (!v.applied) throw new Error("choose a magnetic group first");
    at.onApply(v.applied);
  }

  /** Hand the chosen model to the refinement page (handoff), with k where it may refine. */
  continueToRefinement(withK: boolean): void {
    const at = this.inputs();
    if (!at.onContinue) throw new Error("this page cannot hand a model to the refinement page");
    const v = this.view();
    if (!v.build) throw new Error("choose a magnetic group first");
    if (v.kUnsupported) throw new Error(v.kUnsupported);
    if (withK && !v.canRefineK) throw new Error(v.kRows?.notes.join(" ") || "k cannot refine with this model");
    const out = handoff(v.build, v.resolvedAmps, withK ? v.kRows : null);
    at.onContinue(out.magnetic, out.params, out.bindings);
  }

  // ── the Agent's handle ──

  private makeHandle(): MagneticAgentHandle {
    const kView = (c: KCandidate): KCandidateView => ({ k: [c.k[0], c.k[1], c.k[2]], label: c.label, matched: c.matched, total: c.total, rmsd: c.rmsd });
    return {
      state: () => {
        this.sync();
        const at = this.inputs();
        const s = this.s;
        const v = this.view();
        const chosen = s.framework === "msg" && s.chosen != null ? v.reps[s.chosen] : undefined;
        return {
          ions: magneticIonCandidates(at.structure).map((i) => ({ label: i.siteLabel, element: i.element, selected: s.ions.has(i.siteLabel) })),
          peaks: v.rows.map((p) => ({
            n: p.idx,
            d: p.d,
            ...(p.significance !== undefined ? { sigmas: p.significance } : {}),
            ...(p.nearNuclear ? { near: `${p.nearNuclear.phaseLabel} ${p.nearNuclear.hkl}` } : {}),
            included: p.included,
            manual: !!p.manual,
          })),
          kSearch: v.results ? v.results.slice(0, 8).map(kView) : null,
          k: [s.k[0], s.k[1], s.k[2]],
          kDescription: describePropagation(v.kClass),
          kUnsupported: v.kUnsupported,
          candidates: v.reps.map((r, i) => candidateView(r, i, v.dims[i] ?? 0, v.maximal[i] ?? false, v.rankResults[r.candidate.id])),
          selected: chosen && v.build && v.applied ? selectionView(chosen, s.chosen!, at.structure, v.build.params, v.resolvedAmps, v.applied, v.fitWR) : null,
          ties: { sameSite: s.ties.sameSite, magnitudes: v.options.magnitudes },
          baselineAgreement: at.baselineAgreement,
          best: v.best ? candidateId(v.reps.findIndex((r) => r.candidate.id === v.best!.id)) : null,
          withinNoise: v.noise.map((id) => candidateId(v.reps.findIndex((r) => r.candidate.id === id))),
          canFit: v.canFit,
          canRefineK: v.canRefineK,
        };
      },
      searchK: (choice) => {
        this.sync();
        // The Agent's picks, as the table's check boxes: applied now (the search reads them) and kept (the table shows them).
        const picked = pickedRows(this.view().rows, this.s.overrides, choice);
        if (picked.overrides !== this.s.overrides) this.commit({ ...this.s, overrides: picked.overrides });
        if (!picked.rows.some((r) => r.included)) throw new Error(NO_PEAK_INCLUDED);
        return this.search(picked.rows).slice(0, 8).map(kView);
      },
      setK: (k) => {
        this.sync();
        this.setK(k);
      },
      selectIons: (labels) => {
        this.sync();
        const known = new Set(magneticIonCandidates(this.inputs().structure).map((i) => i.siteLabel));
        const unknown = labels.filter((l) => !known.has(l));
        if (unknown.length > 0) throw new Error(`not a magnetic ion site: ${unknown.join(", ")} — the sites are ${[...known].join(", ")}`);
        this.setIons(labels);
      },
      setTies: (t) => {
        this.sync();
        this.setTies({
          ...(t.sameSite !== undefined ? { sameSite: t.sameSite } : {}),
          ...(t.magnitudes !== undefined ? { magnitudes: t.magnitudes !== false, ...(t.magnitudes ? { scope: t.magnitudes } : {}) } : {}),
        });
      },
      rank: (scope, restarts) => this.rank(scope, restarts),
      choose: (id) => {
        this.sync();
        this.choose(candidateIndex(id, this.view().reps.length));
      },
      refineMoments: async () => {
        this.sync();
        const v = this.view();
        if (!v.build) throw new Error("choose a magnetic group first");
        if (v.build.params.length === 0) throw new Error("the chosen group allows no moment on the chosen ions");
        if (!v.canRefine) throw new Error(v.kUnsupported ?? "the moments cannot be fitted on this page");
        return this.refineMoments();
      },
      apply: (on) => {
        this.sync();
        this.show(on);
      },
      continueToRefinement: (withK) => {
        this.sync();
        this.continueToRefinement(withK);
      },
    };
  }
}

/** The detected peak set's content, so a re-minted but equal list keeps the picks. */
const peakSetKey = (peaks: readonly ResidualPeak[]): string => peaks.map((p) => peakKey(p.d)).sort().join("|");
