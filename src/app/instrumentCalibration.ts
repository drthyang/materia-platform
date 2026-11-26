/**
 * Calibrating a time-of-flight bank against a line-position standard: the
 * instrument's constants and peak shape refined against a standard whose cell
 * is known, in GSAS-II's calibration convention, so that the instrument file
 * written from the result is what GSAS-II would have refined.
 *
 * The convention (the NOMAD instrument README states it): the standard's
 * sample terms are GSAS-II's new-phase defaults, size 1 µm and Lorentzian
 * microstrain 1000 × 10⁻⁶, held; the instrument's profile is what is left. The
 * cell is the standard's, held: difC and a cubic cell are one factor on every
 * d, exactly correlated, so the two are never free together. The positions are
 * fixed (by symmetry for silicon; a LaB₆ boron x is the caller's).
 *
 * The order, one bank at a time, with the scale and the background free
 * throughout; each step adds its terms to those already free:
 *   1. scale + background
 *   2. difC
 *   3. difC + zero
 *   4. difC + zero + difA, only when the bank's d-range supports difA: the
 *      correlation guard probes the three at the current values first and,
 *      by default, a pair at |ρ| ≥ CORRELATION_LIMIT keeps difA at its
 *      starting value (`difAGuard`)
 *   5. + α, β₀, β₁
 *   6. + σ₀, σ₁, σ₂
 *   7. + X, Y (the Lorentzian)
 *   8. the standard's U_iso, the instrument held
 * then the instrument's terms (U_iso held) and U_iso (the instrument held)
 * alternate, as the instrument–thermal rule of a sample refinement does, until
 * a cycle moves no term by more than SETTLED_ESD of its esd. The terms the
 * order does not name (difB, β_q, σ_q, Z) stay at the starting file's values.
 *
 * Pure, in the app layer beside the page's spec builder (buildPowderSpec), whose rows it
 * uses: the page's sample refinement is not touched. Nothing here frees a
 * difC in any other fit; buildStructureRefinement still emits it fixed.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { refine } from "@/core/refinement/engine";
import { ModelDomainError } from "@/core/refinement/types";
import { readCorrelations, type CorrelatedPair } from "@/core/diagnostics/correlationGuard";
import { buildPowderSpec, GSAS2_NEW_PHASE_MUSTRAIN, GSAS2_NEW_PHASE_SIZE, tofFileProfileOf } from "@/app/powderSpec";
import { applyParameters } from "@/core/workflow/apply";
import { resolveTies } from "@/core/refinement/constraints";
import { buildPowderProblem, reflectionDRange, TOF_DMIN_FLOOR, type FitRange } from "@/core/workflow/powder";
import { dFromTof, tofFromD } from "@/core/diffraction/instrument";
import { generateReflections } from "@/core/diffraction/reflections";

export type TofInstrument = Extract<InstrumentParameters, { kind: "tof" }>;

/** The instrument terms a calibration refines, by their GSAS-II `.instprm` names. */
export type CalibratedTerm = "difC" | "Zero" | "difA" | "alpha" | "beta-0" | "beta-1" | "sig-0" | "sig-1" | "sig-2" | "X" | "Y";

/** Row id of each term in the powder spec. */
const ROW: Readonly<Record<CalibratedTerm, string>> = {
  difC: "tof_difC", Zero: "zero", difA: "tof_difA",
  alpha: "tof_alpha1", "beta-0": "tof_beta0", "beta-1": "tof_beta1",
  "sig-0": "tof_sig0", "sig-1": "tof_sig1", "sig-2": "tof_sig2",
  X: "tof_gamX", Y: "tof_gamY",
};

export const CALIBRATED_TERMS: readonly CalibratedTerm[] = ["difC", "Zero", "difA", "alpha", "beta-0", "beta-1", "sig-0", "sig-1", "sig-2", "X", "Y"];

/** A cycle that moves no term by more than this many esds has settled. */
export const SETTLED_ESD = 0.1;
/** At most this many cycles of the blocks after the first pass. */
export const MAX_CYCLES = 20;
/** A bank with fewer of the standard's reflections in its fit range than this is not calibrated. */
export const MIN_REFLECTIONS = 8;
/** A bank whose difC comes out with a relative esd above this is flagged as low-statistics. */
export const LOW_STATISTICS_DIFC = 5e-5;

/** The zero's limits in a calibration (µs): a starting file can be tens of µs off. */
const ZERO_BOUND = 500;

export interface TofCalibrationInput {
  /** The standard at its cell (standardStructure). */
  readonly structure: StructureModel;
  /** One bank's pattern. */
  readonly pattern: PowderPattern;
  /** The starting instrument for this bank: a GSAS-II `.instprm` bank (its profile terms are needed). */
  readonly start: TofInstrument;
  /** The fit window asked for; its low end is raised to calibrationWindow's when that is higher. */
  readonly fitRange?: FitRange;
  /** Chebyshev background terms (GSAS-II's calibrations use 6). */
  readonly backgroundTerms?: number;
  /**
   * How the correlation guard decides difA: "pairwise" (default) holds it when it
   * correlates with difC or the zero at |ρ| ≥ CORRELATION_LIMIT; "determined" only
   * when the data cannot determine it at all (a null direction).
   */
  readonly difAGuard?: "pairwise" | "determined";
  /** Terms held at their starting value whatever the order says (e.g. a term the user keeps). */
  readonly hold?: readonly CalibratedTerm[];
}

export interface CalibrationStep {
  /** "difC", "difC + zero", "α, β₀, β₁", … */
  readonly name: string;
  readonly cycle: number;
  readonly free: readonly string[];
  readonly status: RefinementResult["status"];
  readonly wR: number;
  readonly gof: number;
  /** The largest |shift| / esd over the step's own terms. */
  readonly maxShiftEsd: number;
  /** Pairs of the step's free rows (background excluded) at |ρ| ≥ 0.8. */
  readonly correlations: readonly { readonly a: string; readonly b: string; readonly coefficient: number }[];
}

export interface TofCalibrationResult {
  /** "calibrated", or "uncovered" (too few of the standard's reflections: nothing refined). */
  readonly status: "calibrated" | "uncovered";
  /** The bank's instrument with the calibrated terms (profileProgram "gsas"). */
  readonly instrument: TofInstrument;
  /** Each calibrated term's value and esd (conditional on the other blocks held, as refined). */
  readonly terms: Readonly<Partial<Record<CalibratedTerm, { readonly value: number; readonly esd: number; readonly start: number; readonly refined: boolean }>>>;
  /** The standard's U_iso per site (Å²) with esd. */
  readonly uiso: Readonly<Record<string, { readonly value: number; readonly esd: number }>>;
  readonly difA: { readonly refined: boolean };
  /** The terms the correlation guard (or a bound) kept at the file's value, and why. */
  readonly guardStops: readonly { readonly term: string; readonly why: string }[];
  /** False when, at the end, a calibration or profile term still correlates at |ρ| ≥ CORRELATION_LIMIT with another free one. */
  readonly separable: boolean;
  /** Those pairs, by `.instprm` name. */
  readonly finalCorrelations: readonly { readonly a: string; readonly b: string; readonly coefficient: number }[];
  readonly steps: readonly CalibrationStep[];
  readonly settled: boolean;
  readonly reflections: number;
  /** The fit window used (calibrationWindow). */
  readonly window: CalibrationWindow;
  readonly wR: number;
  readonly gof: number;
  /** Plain statements for the user: a bank not calibrated, low statistics, difA held. */
  readonly flags: readonly string[];
  /** The final rows (for a plot or a report). */
  readonly parameters: readonly RefinementParameter[];
  /** The calculated pattern at the final rows, point by point (empty when not calibrated). */
  readonly yCalc: readonly number[];
}

const B_PER_U = 8 * Math.PI * Math.PI;

/** Calibrate one TOF bank (see the module comment for the order). */
export function calibrateTofBank(input: TofCalibrationInput): TofCalibrationResult {
  const { structure, pattern, start } = input;
  if (!tofFileProfileOf(start)) throw new Error("The starting instrument gives no TOF profile (alpha, beta-0, sig-1): a GSAS-II .instprm bank is needed");
  const spec = buildPowderSpec(structure, pattern, start, true, input.backgroundTerms ?? 6);
  const held = new Set(input.hold ?? []);
  let params: RefinementParameter[] = spec.params.map((p) => {
    const q: RefinementParameter = { ...p, fixed: p.kind !== "scale" && p.kind !== "background" };
    return p.kind === "zeroShift" ? { ...q, min: -ZERO_BOUND, max: ZERO_BOUND } : q;
  });
  const has = (id: string): boolean => params.some((p) => p.id === id);
  // The held sample terms are GSAS-II's: check them, they are the convention.
  for (const [id, want] of [["tofSampleLorentz", GSAS2_NEW_PHASE_MUSTRAIN], ["tofSampleSize", GSAS2_NEW_PHASE_SIZE], ["tofSampleGauss", 0]] as const) {
    const p = params.find((q) => q.id === id);
    if (!p || p.value !== want || !p.fixed) throw new Error(`calibration: the sample row ${id} must be held at ${want}`);
  }
  if (params.some((p) => p.kind === "cellLength" && !p.fixed)) throw new Error("calibration: the cell is never free with difC");

  const startValue: Record<string, number> = Object.fromEntries(params.map((p) => [p.id, p.value]));
  const window = calibrationWindow(pattern, start, input.fitRange);
  const reflections = countReflections(structure, pattern, params, spec.bindings, window);
  const steps: CalibrationStep[] = [];
  const guardStops: { term: string; why: string }[] = [];
  const esd: Record<string, number> = {};
  const flags: string[] = [];

  const run = (name: string, cycle: number, ids: readonly string[], probe = false): RefinementResult => {
    const free = new Set(ids.filter(has));
    const rows = params.map((p) => ({ ...p, fixed: !(p.kind === "scale" || p.kind === "background" || free.has(p.id)) }));
    const before = Object.fromEntries(rows.map((p) => [p.id, p.value]));
    let result: RefinementResult;
    try {
      result = refine(buildPowderProblem(structure, pattern, rows, spec.bindings, spec.profile, [], window),
        probe ? { maxIterations: 0, correlationThreshold: 0.5, maxReportedCorrelations: 64 } : { maxIterations: 40, correlationThreshold: 0.8, maxReportedCorrelations: 64 });
    } catch (e) {
      // A step the profile cannot take (σ² ≤ 0 inside the window): nothing moves, the step is failed.
      if (!(e instanceof ModelDomainError)) throw e;
      if (!probe) steps.push({ name, cycle, free: [...free], status: "failed", wR: NaN, gof: NaN, maxShiftEsd: 0, correlations: [] });
      return { status: "failed", parameters: {}, esd: {}, agreement: {} as RefinementResult["agreement"], history: [], message: e.message };
    }
    if (probe) return result;
    params = rows.map((p) => (result.parameters[p.id] !== undefined ? { ...p, value: result.parameters[p.id]!, esd: result.esd[p.id] ?? 0 } : p));
    let maxShiftEsd = 0;
    for (const id of free) {
      const e = result.esd[id] ?? 0;
      esd[id] = e;
      if (e > 0) maxShiftEsd = Math.max(maxShiftEsd, Math.abs((result.parameters[id] ?? before[id]!) - before[id]!) / e);
    }
    const kind = new Map(params.map((p) => [p.id, p.kind]));
    const correlations = (result.diagnostics?.highCorrelations ?? [])
      .filter((c) => kind.get(c.parameterIdA) !== "background" && kind.get(c.parameterIdB) !== "background" && Math.abs(c.coefficient) >= 0.8)
      .map((c) => ({ a: c.parameterIdA, b: c.parameterIdB, coefficient: c.coefficient }));
    steps.push({
      name, cycle, free: [...free], status: result.status,
      wR: 100 * (result.agreement.rWeighted ?? NaN), gof: result.agreement.goodnessOfFit ?? NaN, maxShiftEsd, correlations,
    });
    return result;
  };
  const rows = (terms: readonly CalibratedTerm[]): string[] => terms.filter((t) => !held.has(t)).map((t) => ROW[t]).filter(has);
  const uisoRows = params.filter((p) => p.kind === "bIso").map((p) => p.id);

  if (reflections < MIN_REFLECTIONS) {
    flags.push(`Not calibrated: the fit range holds ${reflections} of the standard's reflections, fewer than ${MIN_REFLECTIONS}.`);
    return {
      status: "uncovered", instrument: start, terms: {}, uiso: {}, difA: { refined: false }, steps, settled: false,
      reflections, window, wR: NaN, gof: NaN, flags, parameters: params, guardStops, separable: false, finalCorrelations: [], yCalc: [],
    };
  }

  // The correlation guard, as the page's: a probe of the free set at the current values, read
  // with readCorrelations (the TOF peak-shape terms among themselves are listed, not stopped).
  // "determined": difC, the zero and difA are one curve, TOF(d), exempt among themselves.
  const oneCurve = new Set([ROW.difC, ROW.Zero, ROW.difA]);
  const guardPairs = (ids: readonly string[]): { pairs: readonly CorrelatedPair[]; undetermined: readonly string[] } => {
    const probe = run("probe", 0, ids, true);
    // A probe the profile cannot be evaluated at tells nothing: every candidate counts as undetermined.
    if (probe.status === "failed" && Object.keys(probe.parameters).length === 0) return { pairs: [], undetermined: [...ids] };
    const rowsNow = params.map((p) => ({ ...p, fixed: !(p.kind === "scale" || p.kind === "background" || ids.includes(p.id)) }));
    const check = readCorrelations(probe, rowsNow);
    const pairs = check.correlated.filter((c) => (input.difAGuard ?? "pairwise") === "pairwise" || !(oneCurve.has(c.a) && oneCurve.has(c.b)));
    return { pairs, undetermined: check.undetermined };
  };
  const instrumentRows: string[] = [];
  // Add a block to the free terms; a term the guard stops is held at the file's value: the one this
  // order frees later of each correlated pair, and any the data cannot determine at all.
  const addBlock = (name: string, added: readonly string[]): void => {
    if (added.length === 0) return;
    const candidate = [...instrumentRows, ...added];
    const { pairs, undetermined } = guardPairs(candidate);
    const order = (id: string): number => candidate.indexOf(id);
    const hold = new Map<string, string>();
    for (const id of added) if (undetermined.includes(id)) hold.set(id, `${termOf(id)} held at ${startValue[id]}: the bank's data cannot determine it with the other free terms.`);
    for (const c of pairs) {
      const later = order(c.a) > order(c.b) ? c.a : c.b;
      const other = later === c.a ? c.b : c.a;
      if (added.includes(later) && !hold.has(later)) hold.set(later, `${termOf(later)} held at ${startValue[later]}: over this bank's d-range it correlates with ${termOf(other)} at ${c.coefficient.toFixed(3)}.`);
    }
    for (const [id, why] of hold) {
      flags.push(why);
      guardStops.push({ term: termOf(id), why });
    }
    const kept = added.filter((id) => !hold.has(id));
    if (kept.length === 0) return;
    instrumentRows.push(...kept);
    if (!runHolding(name, 0)) {
      for (const id of kept) {
        instrumentRows.splice(instrumentRows.indexOf(id), 1);
        const why = `${termOf(id)} held at ${startValue[id]}: refined with ${name.replace(/^\+ /, "")}, the profile left its valid range (${steps[steps.length - 1]?.name ?? ""} failed).`;
        flags.push(why);
        guardStops.push({ term: termOf(id), why });
      }
    }
  };
  // A term that ends on its bound is one the bank does not determine (a rise time far shorter
  // than the Gaussian width, say): back to the step's start, the term held at its value there.
  const runHolding = (name: string, cycle: number): boolean => {
    for (;;) {
      const saved = params;
      const result = run(name, cycle, instrumentRows);
      if (result.status === "failed" && result.message !== undefined && Object.keys(result.parameters).length === 0) return false;
      const railed = (result.diagnostics?.atBounds ?? []).map((b) => b.parameterId).filter((id) => instrumentRows.includes(id));
      if (railed.length === 0) return true;
      steps.pop();
      // Back to the values before the step (a valid profile), the railed terms held there.
      params = saved;
      for (const id of railed) {
        instrumentRows.splice(instrumentRows.indexOf(id), 1);
        const held = params.find((p) => p.id === id)!.value;
        const why = `${termOf(id)} held at ${held}: refined, it ran to its bound (the bank does not determine it).`;
        flags.push(why);
        guardStops.push({ term: termOf(id), why });
      }
    }
  };

  // 1–4: scale + background; difC; the zero; difA when the d-range supports it.
  run("scale + background", 0, []);
  addBlock("difC", rows(["difC"]));
  addBlock("difC + zero", rows(["Zero"]));
  addBlock("difC + zero + difA", rows(["difA"]));
  const difARefined = instrumentRows.includes(ROW.difA);
  // 5–7: the profile, each block added to the terms already free.
  addBlock("+ α, β₀, β₁", rows(["alpha", "beta-0", "beta-1"]));
  addBlock("+ σ₀, σ₁, σ₂", rows(["sig-0", "sig-1", "sig-2"]));
  addBlock("+ X, Y", rows(["X", "Y"]));
  // 8: the standard's U_iso with the instrument held; then the two groups alternate.
  if (uisoRows.length > 0) run("U_iso (instrument held)", 0, uisoRows);
  let settled = false;
  for (let cycle = 1; cycle <= MAX_CYCLES && !settled; cycle++) {
    if (!runHolding("instrument (U_iso held)", cycle)) {
      flags.push("Stopped: a refinement of the instrument's terms left the profile's valid range (σ² ≤ 0 inside the window).");
      break;
    }
    let worst = steps[steps.length - 1]!.maxShiftEsd;
    if (uisoRows.length > 0) {
      run("U_iso (instrument held)", cycle, uisoRows);
      worst = Math.max(worst, steps[steps.length - 1]!.maxShiftEsd);
    }
    settled = worst <= SETTLED_ESD;
  }
  // The final check: the guard on the whole free instrument set at the end.
  const finalPairs = guardPairs(instrumentRows).pairs.map((c) => ({ a: termOf(c.a), b: termOf(c.b), coefficient: c.coefficient }));
  for (const c of finalPairs) flags.push(`Not separable: at the end ${c.a} and ${c.b} correlate at ${c.coefficient.toFixed(3)}; this bank does not tell them apart.`);
  if (!settled) flags.push(`Not settled: after ${MAX_CYCLES} cycles a block still moves by more than ${SETTLED_ESD} esd.`);

  const value = (id: string): number => params.find((p) => p.id === id)!.value;
  const terms: Partial<Record<CalibratedTerm, { value: number; esd: number; start: number; refined: boolean }>> = {};
  for (const t of CALIBRATED_TERMS) {
    if (!has(ROW[t])) continue;
    const refined = instrumentRows.includes(ROW[t]);
    terms[t] = { value: value(ROW[t]), esd: refined ? esd[ROW[t]] ?? 0 : 0, start: startValue[ROW[t]]!, refined };
  }
  const difC = terms.difC!;
  if (difC.esd / difC.value > LOW_STATISTICS_DIFC) flags.push(`Low statistics: difC's relative esd ${(1e6 * difC.esd / difC.value).toFixed(0)} ppm is above ${(1e6 * LOW_STATISTICS_DIFC).toFixed(0)} ppm.`);
  const uiso: Record<string, { value: number; esd: number }> = {};
  for (const p of params.filter((q) => q.kind === "bIso")) uiso[p.label.replace(/ B$/, "")] = { value: p.value / B_PER_U, esd: (esd[p.id] ?? 0) / B_PER_U };
  const last = [...steps].reverse().find((q) => Number.isFinite(q.wR)) ?? steps[steps.length - 1]!;
  const instrument: TofInstrument = {
    ...start,
    difC: difC.value,
    ...(terms.difA ? { difA: terms.difA.value } : {}),
    ...(terms.Zero ? { zero: terms.Zero.value } : {}),
    ...(terms.alpha ? { alpha: terms.alpha.value } : {}),
    ...(terms["beta-0"] ? { beta0: terms["beta-0"].value } : {}),
    ...(terms["beta-1"] ? { beta1: terms["beta-1"].value } : {}),
    ...(terms["sig-0"] ? { sig0: terms["sig-0"].value } : {}),
    ...(terms["sig-1"] ? { sig1: terms["sig-1"].value } : {}),
    ...(terms["sig-2"] ? { sig2: terms["sig-2"].value } : {}),
    ...(terms.X ? { gamX: terms.X.value } : {}),
    ...(terms.Y ? { gamY: terms.Y.value } : {}),
    profileProgram: "gsas",
  };
  return {
    status: "calibrated", instrument, terms, uiso, difA: { refined: difARefined }, guardStops, separable: finalPairs.length === 0, finalCorrelations: finalPairs,
    steps, settled, reflections, window, wR: last.wR, gof: last.gof, flags, parameters: params,
    yCalc: [...buildPowderProblem(structure, pattern, params, spec.bindings, spec.profile).calculate(Object.fromEntries(params.map((p) => [p.id, p.value])))],
  };
}

/** The fit window starts this many peak widths (FWHM at its lowest modelled d) above that d. */
export const SUPPORT_FWHM = 4;

/** A calibration's fit window (µs) and the d-spacings at its ends (Å). */
export interface CalibrationWindow {
  readonly min: number;
  readonly max: number;
  readonly dMin: number;
  readonly dMax: number;
}

/**
 * The fit window of a calibration. Its low end is the requested one or, when higher, the
 * lowest d the pattern is modelled at (the data's first point, and never below
 * TOF_DMIN_FLOOR: no reflection is calculated below it) plus SUPPORT_FWHM peak widths, so that
 * no point in the window takes intensity from a reflection that is not calculated.
 */
export function calibrationWindow(pattern: PowderPattern, start: TofInstrument, fitRange?: FitRange): CalibrationWindow {
  const xs = pattern.points.map((p) => p.x);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const dLowest = Math.max(dFromTof(start, lo), TOF_DMIN_FLOOR);
  const floor = tofFromD(start, dLowest) + SUPPORT_FWHM * tofFwhm(start, dLowest);
  const min = Math.max(fitRange?.min ?? lo, floor, lo);
  const max = Math.min(fitRange?.max ?? hi, hi);
  return { min, max, dMin: dFromTof(start, min), dMax: dFromTof(start, max) };
}

/**
 * A TOF peak's full width at half maximum (µs), from a GSAS-II file's terms with GSAS-II's
 * new-phase sample broadening: the Gaussian and Lorentzian widths combined in quadrature, plus
 * the rise and decay lengths (ln 2/α, ln 2/β). An upper estimate, for the window only.
 */
export function tofFwhm(p: TofInstrument, d: number): number {
  const sig2 = (p.sig0 ?? 0) + (p.sig1 ?? 0) * d * d + (p.sig2 ?? 0) * d ** 4 + (p.sigQ ?? 0) * d;
  const gamma = (p.gamX ?? 0) * d + (p.gamY ?? 0) * d * d + (p.gamZ ?? 0)
    + 1e-6 * p.difC * d * GSAS2_NEW_PHASE_MUSTRAIN + 1e-4 * p.difC * d * d / GSAS2_NEW_PHASE_SIZE;
  const alpha = (p.alpha ?? 0) / d;
  const beta = (p.beta0 ?? 0) + (p.beta1 ?? 0) / d ** 4 + (p.betaQ ?? 0) / (d * d);
  const core = Math.hypot(2 * Math.sqrt(2 * Math.LN2) * Math.sqrt(Math.max(sig2, 0)), Math.max(gamma, 0));
  return core + (alpha > 0 ? Math.LN2 / alpha : 0) + (beta > 0 ? Math.LN2 / beta : 0);
}

/** The `.instprm` name of a row id, for the user. */
function termOf(id: string | undefined): string {
  return (Object.entries(ROW).find(([, row]) => row === id)?.[0]) ?? id ?? "another term";
}

/** The standard's reflections inside the fit range. */
function countReflections(structure: StructureModel, pattern: PowderPattern, params: readonly RefinementParameter[], bindings: Parameters<typeof applyParameters>[1], fitRange?: FitRange): number {
  const values = Object.fromEntries(params.map((p) => [p.id, p.value]));
  const applied = applyParameters(structure, bindings, resolveTies(params, values));
  const windowed: PowderPattern = fitRange ? { ...pattern, points: pattern.points.filter((p) => (fitRange.min === undefined || p.x >= fitRange.min) && (fitRange.max === undefined || p.x <= fitRange.max)) } : pattern;
  if (windowed.points.length === 0) return 0;
  const { dMin, dMax } = reflectionDRange(windowed, applied);
  // Distinct d-spacings: reflections that coincide (3 3 3 and 5 1 1) are one line.
  const ds = new Set(generateReflections(applied.model.cell, applied.model.spaceGroup, dMin, dMax).map((r) => r.d.toFixed(5)));
  return ds.size;
}
