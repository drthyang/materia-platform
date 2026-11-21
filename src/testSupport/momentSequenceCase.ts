/**
 * The app's side of the known-truth moments test: the fits the powder page
 * runs, on the patterns of `independentMnwo4.ts` (a calculation that shares no
 * code with `src/core`).
 *
 * The page's sequence is "nuclear model first, the satellites unmodelled; then
 * the moments with every nuclear row held" (`momentFitRequest`,
 * `powderPage.ts`). `sequence` runs it, then the alternation
 * "scale + background with the moments held, then the moments again", and
 * reports the moment and its quoted esd after every moments step, with the
 * joint fit of the same rows beside them as the reference.
 */

import { mnwo4Structure } from "@/examples/mnwo4";
import { buildStructureRefinement } from "@/core/workflow/structureRefinement";
import { buildPowderProblem, type PowderProfile } from "@/core/workflow/powder";
import { buildMagneticPowderProblem } from "@/core/workflow/magneticPowder";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { momentCartesian } from "@/core/magnetic/moment";
import { refine, type RefinementProblem } from "@/core/refinement/engine";
import { buildFor, candidatesOf, fitRows, momentParameters, powderTwins, rankCandidates, rankWithinNoise, withinNoise, type MagneticFit } from "@/app/magneticStep";
import type { Session } from "@/app/powderSession";
import { powderMomentFit } from "@/app/powderPage";
import { noiseOf } from "@/core/magnetic/momentRestarts";
import type { MagneticModelBuild } from "@/core/magnetic/momentModel";
import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { ParameterBinding, ParameterKind, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { Vec3 } from "@/core/math/types";
import { cleanPattern, noisy, type CleanPattern, type PatternSpec, type SpinModel } from "@/testSupport/independentMnwo4";

/** The pattern of the 2026-11-09 audit: λ = 2.41 Å, 8–130°, FWHM 0.40°, flat background 200, K = 0.02 on the magnetic cell. */
export const AUDIT_PATTERN = { wavelength: 2.41, scale: 0.02, background: 200, fwhm: 0.4, twoThetaMin: 8, twoThetaMax: 130, step: 0.05, reflectionsTo: 140 } as const;
/** The fit window: the pattern's last degrees are left out (a line beyond the last point has no tail in the app's calculation). */
export const FIT_RANGE = { min: 10, max: 125 } as const;
const PROFILE: PowderProfile = { shape: "gaussian", lorentz: true };

/** Model A: 4.2 µ_B along b, Mn(y) and Mn(−y) antiparallel. One moment parameter. */
export const MODEL_A: SpinModel = { na: 2, mnY: [0, 4.2, 0], mnMinusY: [0, -4.2, 0] };
/** Model B: 3.0 â + 2.0 ĉ (3.5723 µ_B), Mn(y) and Mn(−y) antiparallel. Two moment parameters. */
export const MODEL_B: SpinModel = { na: 2, mnY: [3, 0, 2], mnMinusY: [-3, 0, -2] };
/** Model A's arrangement at k = 0 (every parent cell alike): an antiferromagnet in the cell, its lines on integer (h k l), part of them where the c glide leaves no nuclear line. */
export const MODEL_A_K0: SpinModel = { na: 1, mnY: [0, 4.2, 0], mnMinusY: [0, -4.2, 0] };
/** A ferromagnet at k = 0, 4.2 µ_B along b: every magnetic line on a nuclear line, the case where the scale and the moment trade most. */
export const MODEL_F_K0: SpinModel = { na: 1, mnY: [0, 4.2, 0], mnMinusY: [0, 4.2, 0] };

export interface Case {
  readonly structure: StructureModel;
  readonly k: Vec3;
  readonly clean: CleanPattern;
  /** The nuclear rows at their true values, all held. */
  readonly nuclearTruth: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  /** The app's moment model of the true group. */
  readonly build: MagneticModelBuild;
  readonly backgroundTerms: number;
}

function patternOf(points: readonly { x: number; yObs: number; sigma: number }[]): PowderPattern {
  return { id: "pat", name: "independent MnWO4", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: AUDIT_PATTERN.wavelength }, wavelength: AUDIT_PATTERN.wavelength, points: [...points] };
}

export function cleanPoints(clean: CleanPattern): { x: number; yObs: number; sigma: number }[] {
  return clean.x.map((x, i) => ({ x, yObs: clean.y[i]!, sigma: Math.sqrt(clean.y[i]!) }));
}

/**
 * The case for a spin model: its noise-free pattern, the app's nuclear rows at
 * the truth, and the app's candidate group that reproduces the pattern (found
 * by fitting each candidate with the right number of moment parameters to the
 * noise-free pattern: the one that reaches wR ≈ 0).
 */
export function caseOf(model: SpinModel, backgroundTerms: number, pattern: Omit<PatternSpec, "model"> = AUDIT_PATTERN): Case {
  const structure = mnwo4Structure();
  const k: Vec3 = model.na === 2 ? [0.5, 0, 0] : [0, 0, 0];
  const clean = cleanPattern({ ...pattern, model });
  const pat = patternOf(cleanPoints(clean));
  // The app's scale is per parent cell: |F|² of na cells is na² that of one.
  const spec = buildStructureRefinement(structure, pat, { scale: pattern.scale * model.na * model.na, backgroundTerms, width: pattern.fwhm });
  const nuclearTruth = spec.params.map((p) => ({ ...p, value: p.id === "bkg0" ? pattern.background : p.value, fixed: true })).map((p) => ({ ...p, initialValue: p.value }));
  const free = model.mnY.filter((c) => c !== 0).length;
  let best: { build: MagneticModelBuild; wR: number } | null = null;
  for (const r of candidatesOf(structure, k)) {
    const build = buildFor(structure, k, ["Mn1"], r.candidate.operations, { sameSite: true, magnitudes: false, flippedUnits: [] });
    const rows = fitRows(build);
    if (rows.filter((p) => !p.fixed).length !== free) continue;
    const res = refine(buildMagneticPowderProblem(structure, build.magnetic, pat, [...nuclearTruth, ...rows], [...spec.bindings, ...build.bindings], PROFILE, FIT_RANGE), { maxIterations: 40 });
    const wR = res.agreement.rWeighted ?? Infinity;
    // The first of equals: the candidates come highest symmetry first.
    if (!best || wR < best.wR - 1e-9) best = { build, wR };
  }
  if (!best || best.wR > 1e-3) throw new Error(`no candidate of the app reproduces the independent pattern (best wR ${best?.wR})`);
  return { structure, k, clean, nuclearTruth, bindings: spec.bindings, build: best.build, backgroundTerms };
}

/** What one fit left: the values, the engine's esds, the fit's agreement. */
export interface Step {
  readonly values: Readonly<Record<string, number>>;
  readonly esd: Readonly<Record<string, number>>;
  readonly result: RefinementResult;
}

type Rows = readonly RefinementParameter[];

const withValues = (rows: Rows, values: Readonly<Record<string, number>>): RefinementParameter[] => rows.map((p) => ({ ...p, value: values[p.id] ?? p.value, initialValue: values[p.id] ?? p.value }));
const freeing = (rows: Rows, free: (p: RefinementParameter) => boolean): RefinementParameter[] => rows.map((p) => ({ ...p, fixed: !!p.expression || !free(p) }));
const isMoment = (p: RefinementParameter): boolean => p.kind === "momentMode";

/** The nuclear kinds each variant refines beside or between the moments. */
export const NUCLEAR_SETS = {
  /** Design A: the scale and the background. */
  scaleBackground: ["scale", "background"],
  /** The audit's alternation: the scale, the background and the peak width. */
  scaleBackgroundWidth: ["scale", "background", "peakWidth"],
} as const satisfies Record<string, readonly ParameterKind[]>;

export class Fitter {
  readonly pattern: PowderPattern;
  constructor(readonly c: Case, points: readonly { x: number; yObs: number; sigma: number }[]) {
    this.pattern = patternOf(points);
  }

  /** The nuclear-only problem: no magnetic model in the calculation. */
  nuclearOnly(rows: Rows, kinds: readonly ParameterKind[]): Step {
    const start = freeing(rows, (p) => kinds.includes(p.kind));
    return this.run(buildPowderProblem(this.c.structure, this.pattern, start, this.c.bindings, PROFILE, [], FIT_RANGE), 30);
  }

  problem(rows: Rows): RefinementProblem {
    return buildMagneticPowderProblem(this.c.structure, this.c.build.magnetic, this.pattern, rows, [...this.c.bindings, ...this.c.build.bindings], PROFILE, FIT_RANGE);
  }

  /** Nuclear + magnetic, the rows `free` picks refined. */
  magnetic(rows: Rows, free: (p: RefinementParameter) => boolean, maxIterations = 20): Step {
    return this.run(this.problem(freeing(rows, free)), maxIterations);
  }

  private run(problem: RefinementProblem, maxIterations: number): Step {
    const result = refine(problem, { maxIterations });
    return { values: result.parameters, esd: result.esd, result };
  }

  /** |M| per Mn (µ_B, Cartesian length) at these values. */
  moment(values: Readonly<Record<string, number>>): number {
    const applied = applyMagneticMoments(this.c.build.magnetic, this.c.build.bindings, values);
    return Math.hypot(...momentCartesian(this.c.structure.cell, applied.moments[0]!));
  }

  /**
   * The esds of the rows `free` picks from the covariance of exactly those
   * rows at `values`, with no step taken: (JᵀWJ)⁻¹ · χ²/(N − P), J by central
   * differences of the app's calculated pattern. With `free` = the moments it
   * is the moments-only esd; with the scale and the background added it is the
   * esd the design proposes to report.
   */
  covarianceEsd(rows: Rows, values: Readonly<Record<string, number>>, free: (p: RefinementParameter) => boolean): Record<string, number> {
    const at = withValues(rows, values);
    const problem = this.problem(freeing(at, free));
    const ids = problem.parameters.filter((p) => !p.fixed).map((p) => p.id);
    const base: Record<string, number> = Object.fromEntries(at.map((p) => [p.id, p.value]));
    const y0 = problem.calculate(base);
    const w = problem.weights;
    const obs = problem.observations;
    let chi2 = 0;
    let n = 0;
    for (let i = 0; i < y0.length; i++) {
      if (!(w[i]! > 0)) continue;
      chi2 += w[i]! * (obs[i]! - y0[i]!) ** 2;
      n++;
    }
    const cols = ids.map((id) => {
      const h = 1e-5 * Math.max(Math.abs(base[id]!), 1e-3);
      const up = problem.calculate({ ...base, [id]: base[id]! + h });
      const dn = problem.calculate({ ...base, [id]: base[id]! - h });
      return Float64Array.from(up, (v, i) => (v - dn[i]!) / (2 * h));
    });
    const normal = ids.map((_, a) => ids.map((__, b) => {
      let s = 0;
      for (let i = 0; i < y0.length; i++) s += w[i]! * cols[a]![i]! * cols[b]![i]!;
      return s;
    }));
    const inv = invert(normal);
    const red = chi2 / (n - ids.length);
    return Object.fromEntries(ids.map((id, j) => [id, Math.sqrt(inv[j]![j]! * red)]));
  }
}

/** Gauss–Jordan inverse with a diagonal pre-scaling (the scale and the moments differ by orders of magnitude). */
function invert(m: readonly (readonly number[])[]): number[][] {
  const n = m.length;
  const s = m.map((row, i) => 1 / Math.sqrt(row[i]!));
  const a = m.map((row, i) => [...row.map((v, j) => v * s[i]! * s[j]!), ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!];
    const d = a[c]![c]!;
    for (let j = 0; j < 2 * n; j++) a[c]![j] = a[c]![j]! / d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r]![j] = a[r]![j]! - f * a[c]![j]!;
    }
  }
  return a.map((row, i) => row.slice(n).map((v, j) => v * s[i]! * s[j]!));
}

/** One moments step of a sequence. */
export interface MomentsStep {
  /** The free moment rows' values, in row order. */
  readonly components: readonly number[];
  readonly moment: number;
  /** The engine's esds of this moments-only fit (what the page quotes today). */
  readonly quotedEsd: readonly number[];
  /** The esds from the covariance of the moments with the nuclear set of the alternation, at this point. */
  readonly fullEsd: readonly number[];
  readonly scale: number;
  readonly background: number;
  readonly width: number;
  readonly gof: number;
  readonly wR: number;
  /** The largest |shift| / quoted esd of a moment row since the previous moments step (absent on the first). */
  readonly shiftOverEsd?: number;
}

export interface Sequence {
  /** The moments with the nuclear rows held at the truth. */
  readonly truthHeld: MomentsStep;
  /** steps[0]: today's sequence. steps[r]: after r rounds of "nuclear set with the moments held, then the moments". */
  readonly steps: readonly MomentsStep[];
  /** The nuclear set and the moments refined together, from the last step: the reference the alternation should reach. */
  readonly joint: MomentsStep;
}

/**
 * Today's sequence and `rounds` rounds of alternation on one pattern.
 * `first`: what the nuclear-only fit refines (the page's base stage frees the
 * scale, the background and the width). `between`: what a round refines with
 * the moments held.
 */
export function sequence(
  c: Case, points: readonly { x: number; yObs: number; sigma: number }[], rounds: number,
  between: readonly ParameterKind[] = NUCLEAR_SETS.scaleBackground,
  first: readonly ParameterKind[] = NUCLEAR_SETS.scaleBackgroundWidth,
  /** Kinds refined with the moments in every moments step: ["scale"] is the page's `freeScale` (the ranking at k = 0). */
  withMoments: readonly ParameterKind[] = [],
): Sequence {
  const f = new Fitter(c, points);
  const momentRows = fitRows(c.build);
  const freeIds = momentRows.filter((p) => !p.fixed).map((p) => p.id);
  const inBetween = (p: RefinementParameter): boolean => between.includes(p.kind);
  const momentsStep = (p: RefinementParameter): boolean => isMoment(p) || withMoments.includes(p.kind);
  const read = (rows: Rows, step: Step, previous?: MomentsStep): MomentsStep => {
    const v = step.values;
    const quoted = f.covarianceEsd(rows, v, momentsStep);
    const full = f.covarianceEsd(rows, v, (p) => momentsStep(p) || inBetween(p));
    const components = freeIds.map((id) => v[id]!);
    return {
      components, moment: f.moment(v),
      quotedEsd: freeIds.map((id) => step.esd[id] ?? quoted[id]!), fullEsd: freeIds.map((id) => full[id]!),
      scale: v.scale!, background: v.bkg0!, width: v.width!,
      gof: step.result.agreement.goodnessOfFit ?? NaN, wR: step.result.agreement.rWeighted ?? NaN,
      ...(previous ? { shiftOverEsd: Math.max(...components.map((x, i) => Math.abs(x - previous.components[i]!) / previous.quotedEsd[i]!)) } : {}),
    };
  };

  const truthRows = [...c.nuclearTruth, ...momentRows];
  const truthHeld = read(truthRows, f.magnetic(truthRows, momentsStep));

  // Today: the nuclear model first, the satellites unmodelled; then the moments, every nuclear row held.
  const nuclear = withValues(c.nuclearTruth, f.nuclearOnly(c.nuclearTruth, first).values);
  let rows: RefinementParameter[] = [...nuclear, ...momentRows];
  let step = f.magnetic(rows, momentsStep);
  const steps: MomentsStep[] = [read(rows, step)];
  for (let r = 0; r < rounds; r++) {
    rows = withValues(rows, step.values);
    rows = withValues(rows, f.magnetic(rows, inBetween).values);
    step = f.magnetic(rows, momentsStep);
    steps.push(read(rows, step, steps[steps.length - 1]));
  }
  rows = withValues(rows, step.values);
  const joint = f.magnetic(rows, (p) => momentsStep(p) || inBetween(p), 40);
  return { truthHeld, steps, joint: read(rows, joint) };
}

export { noisy };

// ── the page's own fit, and the ranking under each ───────────────────────────


/** A powder session holding these nuclear rows: what the page's own moments fit (`powderMomentFit`) reads. */
export function sessionOf(c: Case, points: readonly { x: number; yObs: number; sigma: number }[], nuclear: Rows): Session {
  return {
    structure: c.structure, extraPhases: [], pattern: patternOf(points), powderParams: [...nuclear], powderBindings: [...c.bindings],
    powderProfile: PROFILE, backgroundTerms: c.backgroundTerms, siteTies: {}, powderSource: "independent MnWO4 (synthetic)",
  };
}

/** The nuclear rows after the page's nuclear-only fit of these points (the satellites unmodelled). */
export function nuclearOnlyRows(c: Case, points: readonly { x: number; yObs: number; sigma: number }[], first: readonly ParameterKind[] = NUCLEAR_SETS.scaleBackgroundWidth): RefinementParameter[] {
  return withValues(c.nuclearTruth, new Fitter(c, points).nuclearOnly(c.nuclearTruth, first).values);
}

/** The stopping rule proposed for the alternation: every free moment row moved by less than this fraction of its esd in the last round. */
export const ALTERNATION_TOLERANCE = 0.1;
export const ALTERNATION_MAX_ROUNDS = 8;

/**
 * A moments fit that alternates, as the design proposes: the moments (nuclear
 * rows held), then the scale and the background (moments held), then the
 * moments again, until the moments move by less than ALTERNATION_TOLERANCE of
 * their esd; the last step is a moments step. The test's own statement of the
 * design, for comparing a ranking under it with today's single pass.
 */
export function alternatingFit(c: Case, points: readonly { x: number; yObs: number; sigma: number }[], nuclear: Rows, counts?: { rounds: number[] }): MagneticFit {
  const pattern = patternOf(points);
  return {
    agreementLabel: "wR",
    refine: async (magnetic, momentParams, momentBindings) => {
      const bindings = [...c.bindings, ...momentBindings];
      const run = (rows: Rows, free: (p: RefinementParameter) => boolean): RefinementResult =>
        refine(buildMagneticPowderProblem(c.structure, magnetic, pattern, freeing(rows, free), bindings, PROFILE, FIT_RANGE), { maxIterations: 20 });
      const momentIds = new Set(momentParams.filter((p) => !p.fixed).map((p) => p.id));
      const momentFree = (p: RefinementParameter): boolean => momentIds.has(p.id);
      let rows: RefinementParameter[] = [...nuclear, ...momentParams];
      let res = run(rows, momentFree);
      let rounds = 0;
      for (; rounds < ALTERNATION_MAX_ROUNDS; rounds++) {
        const before = res;
        rows = withValues(rows, res.parameters);
        rows = withValues(rows, run(rows, (p) => (NUCLEAR_SETS.scaleBackground as readonly ParameterKind[]).includes(p.kind)).parameters);
        res = run(rows, momentFree);
        const shift = Math.max(...[...momentIds].map((id) => Math.abs(res.parameters[id]! - before.parameters[id]!) / (before.esd[id] || Infinity)));
        if (shift < ALTERNATION_TOLERANCE) {
          rounds++;
          break;
        }
      }
      counts?.rounds.push(rounds);
      const values: Record<string, number> = {};
      for (const p of momentParams) values[p.id] = res.parameters[p.id] ?? p.value;
      return { values, agreement: res.agreement.rWeighted ?? null, ...noiseOf(res) };
    },
  };
}

export interface RankingOutcome {
  /** The ★, by the app's label and operations. */
  readonly best: string | null;
  /** The groups within the noise of the best, in the ★'s order. */
  readonly withinNoise: readonly string[];
  readonly twins: readonly string[];
  /** Each ranked group's wR and |M| of the first site. */
  readonly entries: Readonly<Record<string, { wR: number | null; moment: number | null }>>;
}

/** The page's ranking ("all") of every candidate group at the case's k, under a fit. */
export async function rankUnder(c: Case, fit: MagneticFit, restarts = 4): Promise<RankingOutcome> {
  const reps = candidatesOf(c.structure, c.k);
  const options = { sameSite: true, magnitudes: false as const, flippedUnits: [] };
  const dims = momentParameters(c.structure, reps, ["Mn1"], c.k, options);
  const results = await rankCandidates({
    structure: c.structure, reps, dims, scope: "all", open: new Set(), fit, ions: ["Mn1"], restarts,
    build: (ops) => buildFor(c.structure, c.k, ["Mn1"], ops, options),
  });
  const name = (id: string): string => {
    const i = reps.findIndex((r) => r.candidate.id === id);
    return `G${i + 1} ${reps[i]!.candidate.label}`;
  };
  const ordered = rankWithinNoise(results, reps, dims);
  return {
    best: ordered[0] !== undefined ? name(ordered[0]) : null,
    withinNoise: withinNoise(results, reps, dims).map(name).sort(),
    twins: powderTwins(results, ordered, reps).map(name).sort(),
    entries: Object.fromEntries(Object.entries(results).map(([id, e]) => [name(id), { wR: e.wR, moment: e.magnitudes[0]?.value ?? null }])),
  };
}

export { powderMomentFit };
