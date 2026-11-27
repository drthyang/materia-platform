/**
 * The short-d end of the model on the page (THY-90, the owner's decisions of
 * 2026-11-26): where the reflection list stops and why, which points of the
 * fit window it does not reach (those are left out of the fit and of wR, as
 * the refinement leaves them out: core/workflow/powder.ts modelledFitRange),
 * and, when the window reaches well below the last resolved lines, the d to
 * trim it at. One line for the page, the rest behind "?"; get_state and
 * check_fit_range read the same words.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { resolveTies } from "@/core/refinement/constraints";
import { excludedPointMask } from "@/core/refinement/factors";
import { applyParameters, type AppliedModel } from "@/core/workflow/apply";
import { phaseBindingsFor } from "@/core/workflow/multiPhase";
import { magneticDRange, modelledFitRange, reflectionDRange, reflectionRange, startValues, type PowderProfile, type ReflectionRange } from "@/core/workflow/powder";
import { resolvedDown } from "@/core/workflow/lineResolution";
import { minMax } from "@/core/math/extent";

/** The page's model as these readings need it. */
export interface ShortDPage {
  readonly structure: StructureModel;
  readonly extraPhases?: readonly StructureModel[];
  readonly pattern: PowderPattern;
  readonly powderParams: readonly RefinementParameter[];
  readonly powderBindings: readonly ParameterBinding[];
  readonly powderProfile?: PowderProfile;
}

/** A window on the pattern's own axis. */
export interface Window {
  readonly min: number;
  readonly max: number;
}

/** The window's short-d edge is "well below" the last resolved lines when it lies below this fraction of their d. */
export const WELL_BELOW = 0.9;

/** Every phase's applied model at the rows' current values, each phase with its own bindings. */
export function appliedPhases(p: ShortDPage): AppliedModel[] {
  const resolved = resolveTies(p.powderParams, startValues(p.powderParams));
  const phases = [p.structure, ...(p.extraPhases ?? [])];
  const multi = phases.length > 1;
  return phases.map((ph) => applyParameters(ph, multi ? phaseBindingsFor(p.powderBindings, ph.id) : p.powderBindings, resolved));
}

/**
 * The window the page scores wR, GoF and the point count in: the fit window,
 * narrowed where the reflection list does not reach it, as the refinement
 * weighs the points. Null: the whole pattern.
 */
export function scoredWindow(p: ShortDPage, window: Window | null): Window | null {
  if (p.pattern.points.length === 0) return window;
  const r = modelledFitRange(p.pattern, appliedPhases(p), window ?? undefined);
  if (!r || (r.min === undefined && r.max === undefined)) return window;
  if (window && r.min === window.min && r.max === window.max) return window;
  const extent = minMax(p.pattern.points.map((pt) => pt.x));
  return { min: r.min ?? extent.min, max: r.max ?? extent.max };
}

/**
 * The tick rows' d-ranges: each nuclear row the list its phase draws (it
 * follows the window), the magnetic row the satellites' range. Null when the
 * axis does not convert to d (a TOF pattern with no calibration).
 */
export function tickDRanges(p: ShortDPage, window: Window | null): { nuclear: { dMin: number; dMax: number }[]; magnetic: { dMin: number; dMax: number } } | null {
  if (p.pattern.points.length === 0) return null;
  const phases = appliedPhases(p);
  if (p.pattern.xUnit === "tof" && phases[0]!.tof === undefined) return null;
  return {
    nuclear: phases.map((a) => reflectionDRange(p.pattern, a, window ?? undefined)),
    magnetic: magneticDRange(p.pattern, phases[0]!),
  };
}

/** What the page says about the short-d end of the model. */
export interface ShortDReading {
  /** The primary phase's list; with several phases, the one that stops highest for a validity limit. */
  readonly range: ReflectionRange;
  /** Points in the fit window that the list does not reach: left out of the fit and of wR. */
  readonly leftOut: number;
  /** The d (Å) the left-out points start below. */
  readonly leftOutBelow?: number;
  /** The window reaches well below the last resolved lines: their d (Å), and how many of the window's lines lie below it. */
  readonly trim?: { readonly d: number; readonly linesBelow: number; readonly lines: number };
}

/** The reading, or null where there is nothing to say (constant-wavelength neutrons, X-rays above 0.25 Å, a TOF page with no calibration). */
export function shortDReading(p: ShortDPage, window: Window | null): ShortDReading | null {
  const pattern = p.pattern;
  if (pattern.points.length === 0) return null;
  const phases = appliedPhases(p);
  const ranges = phases.map((a) => reflectionRange(pattern, a, window ?? undefined));
  const range = ranges.reduce((best, r) => ((r.fittedFrom ?? -Infinity) > (best.fittedFrom ?? -Infinity) ? r : best), ranges[0]!);
  const tof = pattern.xUnit === "tof" && phases[0]!.tof !== undefined;
  if (!tof && range.stop === "data") return null;
  // The points the scored window drops from the fit window.
  const scored = scoredWindow(p, window);
  const excluded = excludedPointMask(pattern.points.map((pt) => pt.yObs));
  let leftOut = 0;
  pattern.points.forEach((pt, i) => {
    if (excluded[i]) return;
    if (window && (pt.x < window.min || pt.x > window.max)) return;
    if (scored && (pt.x < scored.min || pt.x > scored.max)) leftOut++;
  });
  if (!tof && leftOut === 0) return null;
  // The resolution reading only on time of flight: where the window reaches far below the lines.
  const edge = Math.max(range.windowD, range.fittedFrom ?? 0);
  let trim: ShortDReading["trim"];
  if (tof) {
    const res = resolvedDown(pattern, phases, p.powderProfile ?? { shape: "gaussian" }, { dMin: edge, dMax: range.dMax });
    if (res && edge < WELL_BELOW * res.d) trim = { d: res.d, linesBelow: res.linesBelow, lines: res.lines };
  }
  return { range, leftOut, ...(range.fittedFrom !== undefined && leftOut > 0 ? { leftOutBelow: range.fittedFrom } : {}), ...(trim ? { trim } : {}) };
}

const fmtD = (d: number): string => d.toFixed(d < 1 ? 3 : 2);
const points = (n: number): string => `${n} point${n === 1 ? "" : "s"}`;

/** The page's line and its "?", or null where there is nothing to say. */
export function shortDNote(r: ShortDReading | null): { line: string; detail: string; warn: boolean } | null {
  if (!r) return null;
  const { range } = r;
  const left = r.leftOut > 0 ? ` ${points(r.leftOut)} at shorter d are left out of the fit and wR.` : "";
  const leftDetail = r.leftOut > 0
    ? ` The ${points(r.leftOut)} of the fit window below d ${fmtD(r.leftOutBelow!)} Å are not fitted and not counted in wR, GoF or the point count, as the refinement leaves them out.`
    : "";
  const trim = r.trim
    ? ` Lines are resolved down to d ${fmtD(r.trim.d)} Å: trimming the window there would fit faster.`
    : "";
  const trimDetail = r.trim
    ? ` Below d ${fmtD(r.trim.d)} Å neighbouring lines lie less than one line width apart and merge: ${r.trim.linesBelow} of the ${r.trim.lines} distinct lines in the window are there. They are calculated, so the fit is complete, but each one costs time. Move the window's short-d handle to about ${fmtD(r.trim.d)} Å, or ask the Copilot to check the fit range.`
    : "";
  if (range.stop === "profile") {
    return {
      line: `Reflections stop at d ${fmtD(range.dMin)} Å: below it the profile gives ${range.which} ≤ 0, no peak.${left}${trim}`,
      detail: [
        `Below d ${fmtD(range.dMin)} Å the peak terms (the instrument file's, or the profile rows') give a non-positive ${range.which}: no peak is defined there, so no reflection is calculated below it.${leftDetail}`,
        "An instrument file is fitted over the d-range of its standard; below that its terms are an extrapolation.",
        `To fit that part of the data, use an instrument file calibrated to shorter d; otherwise set the fit window above ${fmtD(range.dMin)} Å.${trimDetail}`,
      ].join(" "),
      warn: r.leftOut > 0,
    };
  }
  if (range.stop === "xray") {
    return {
      line: `Reflections stop at d ${fmtD(range.dMin)} Å (sin θ/λ = 2.0 Å⁻¹), the end of the X-ray form-factor table.${left}`,
      detail: `The X-ray form factors are a four-Gaussian table valid to sin θ/λ = 2.0 Å⁻¹ (d = 0.25 Å); beyond, it is an extrapolation, so no reflection is calculated there.${leftDetail} These points end within one peak support of 0.25 Å, so every point kept has the tails of all its lines.`,
      warn: r.leftOut > 0,
    };
  }
  return {
    line: `Reflections down to d ${fmtD(range.dMin)} Å, one peak support below the fit window's edge (${fmtD(range.windowD)} Å).${trim}`,
    detail: `The fit window sets the shortest d: every reflection whose peak reaches a point in the window is calculated, none below. A narrower window at short d calculates fewer.${trimDetail}`,
    warn: false,
  };
}

/** The same words in one string, for get_state and check_fit_range: the "?" only when points are left out or a trim is suggested. */
export function shortDText(r: ShortDReading | null): string | null {
  const n = shortDNote(r);
  if (!n) return null;
  return n.warn || r?.trim ? `${n.line} ${n.detail}` : n.line;
}
