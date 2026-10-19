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
import { magneticSubgroupLattice, latticeRepresentatives, type LatticeCandidate } from "@/core/magnetic/subgroupLattice";
import { allowedMomentDirections } from "@/core/magnetic/allowedMoments";
import { buildMagneticModel, type MagneticModelBuild } from "@/core/magnetic/momentModel";
import { propagationKParameters } from "@/core/magnetic/refinableK";
import { fitMomentsWithRestarts, RANK_RESTARTS, type MomentFit } from "@/core/magnetic/momentRestarts";
import { momentCartesian } from "@/core/magnetic/moment";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { resolveTies } from "@/core/refinement/constraints";
import { RANK_TIE_WR } from "@/core/diagnostics/thresholds";

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

export const NO_PEAK_INCLUDED = "no residual peak is included for the k-search — the nuclear fit leaves none, or every one sits on a nuclear reflection";

// ── k ───────────────────────────────────────────────────────────────────────

/**
 * The k-search's one option set. No Q cut: the checked peaks are the
 * criterion, and a hidden low-Q cut would drop peaks the user ticked. A line's
 * width grows with d, so a peak matches within 0.5 % of d where that is wider
 * than 0.02 Å.
 */
export const K_SEARCH = { tolerance: 0.02, relativeTolerance: 0.005, maxQ: 0 } as const;

/**
 * Candidate k from the included peaks: satellites about the lattice's own
 * reflections (a centred lattice's absences carry none), weighted by
 * significance where the data give one, capped so one strong peak does not
 * drown the rest.
 */
export function searchK(structure: StructureModel, rows: readonly PeakRow[]): KCandidate[] {
  const included = rows.filter((r) => r.included);
  const weighted = rows.some((r) => r.significance !== undefined);
  return searchPropagationVector(structure.cell, included.map((r) => r.d), {
    ...K_SEARCH,
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

/** How many moment components each group allows on the chosen ions, summed over them. */
export function momentDims(structure: StructureModel, reps: readonly LatticeCandidate[], ions: Iterable<string>, k: Vec3): number[] {
  const sites = [...ions].map((l) => structure.sites.find((s) => s.label === l)).filter((s): s is NonNullable<typeof s> => s !== undefined);
  return reps.map((r) => sites.reduce((sum, s) => sum + allowedMomentDirections(r.candidate.operations, s.position, k).dimension, 0));
}

/** The moment model's options: same-site moments tied, an |M| tie (within each element or across all), the sublattices flipped. */
export interface ModelOptions {
  readonly sameSite: boolean;
  readonly magnitudes: false | "element" | "all";
  readonly flippedUnits: readonly string[];
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
}

export interface RankRun {
  readonly structure: StructureModel;
  readonly reps: readonly LatticeCandidate[];
  readonly dims: readonly number[];
  /** "open": the index sections open on the page; "all": every one. */
  readonly scope: "open" | "all";
  readonly open: ReadonlySet<number>;
  readonly build: (ops: readonly SymmetryOperation[]) => MagneticModelBuild;
  readonly fit: MagneticFit;
  readonly restarts?: number;
  readonly cancelled?: () => boolean;
  /** Each group as it is fitted, with the results so far. */
  readonly onEntry?: (results: Readonly<Record<string, RankEntry>>) => void;
}

/** The groups a ranking fits: those allowing a moment on the chosen ions, in the scope. */
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
        const once = run.fit.nestedStarts ? undefined : { restarts: 0 };
        const { values, agreement } = await fitMomentsWithRestarts(fitRows(build), (start) => fitMoments(run.fit, build, start, once), {
          restarts: run.restarts ?? RANK_RESTARTS,
          ...(run.cancelled ? { cancelled: run.cancelled } : {}),
        });
        const applied = applyMagneticMoments(build.magnetic, build.bindings, values);
        const magnitudes = applied.moments.map((m) => ({
          label: `${m.siteLabel}${m.orbitIndex !== undefined && m.orbitIndex > 1 ? `#${m.orbitIndex}` : ""}`,
          value: Math.hypot(...momentCartesian(run.structure.cell, m)),
        }));
        results[id] = { status: "ok", wR: agreement, values, magnitudes };
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
 * The ★: the lowest agreement, and among the groups tied with it (within
 * RANK_TIE_WR, the same fit) the maximal one (lowest index) with the fewest
 * moment parameters. Ties are the rule: a powder often cannot tell several
 * groups apart, and the top-down prescription breaks them.
 */
export function bestRanked(results: Readonly<Record<string, RankEntry>>, reps: readonly LatticeCandidate[], dims: readonly number[]): { readonly id: string; readonly wR: number } | null {
  const ok = Object.entries(results).filter(([, e]) => e.status === "ok" && e.wR != null);
  if (ok.length === 0) return null;
  const bw = Math.min(...ok.map(([, e]) => e.wR!));
  const meta = new Map(reps.map((r, i) => [r.candidate.id, { index: r.index, dof: dims[i] ?? 0 }]));
  const tied = ok.filter(([, e]) => e.wR! <= bw + RANK_TIE_WR).map(([id]) => id);
  tied.sort((a, b) => (meta.get(a)?.index ?? 99) - (meta.get(b)?.index ?? 99) || (meta.get(a)?.dof ?? 99) - (meta.get(b)?.dof ?? 99));
  const id = tied[0]!;
  return { id, wR: results[id]!.wR! };
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
