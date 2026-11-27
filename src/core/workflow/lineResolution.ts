/**
 * Where a pattern's lines stop being resolved at short d (THY-90, the owner's
 * Q3). Read from the model: every phase's reflections at their calculated
 * intensities, and the profile's own line width at each d, widened by the
 * data's binning (a line cannot be narrower on the data than its bin).
 *
 * Near each d the lines' effective number is (ΣI)²/ΣI² (weak lines between
 * strong ones count little), their mean spacing the stretch they cover over
 * that number. The lines are resolved where that spacing is at least one
 * line width; going down in d they stop being resolved at the first d where
 * it is not. It says where the lines merge, not whether the data still show
 * them (dataRange.ts reads that).
 */

import type { PowderPattern } from "@/core/diffraction/types";
import type { AppliedModel } from "@/core/workflow/apply";
import { generateReflections } from "@/core/diffraction/reflections";
import { powderPeakIntensities } from "@/core/diffraction/intensity";
import { synthesizePattern, type ProfileOptions } from "@/core/diffraction/profile";
import { placePeaks, type PowderProfile } from "@/core/workflow/powder";

/** Lines count as resolved where their mean spacing is at least this many line widths. */
export const RESOLVED_SPACING = 1;
/** Each reading takes the lines within this factor of its d, either side. */
const BLOCK = 1.04;
/** A reading needs at least this many distinct lines. */
const MIN_LINES = 4;
/** Readings, evenly in log d over the range. */
const GRID = 80;

/** The full width at half maximum (on the pattern's axis) of one reflection at d, read off the profile itself; NaN where no peak is defined. */
export function lineFwhm(pattern: PowderPattern, applied: AppliedModel, profile: PowderProfile, d: number): number {
  const peaks = placePeaks(pattern, applied, [{ d, intensity: 1 }]).filter((p) => !p.secondLine);
  if (peaks.length === 0) return NaN;
  const centre = peaks.reduce((a, p) => a + p.center, 0) / peaks.length;
  const reach = 3 * Math.max(...peaks.map((p) => p.fwhm));
  const n = 601;
  const xs = Array.from({ length: n }, (_, i) => centre - reach + (2 * reach * i) / (n - 1));
  const opts: ProfileOptions = { shape: profile.shape, ...(profile.eta !== undefined ? { eta: profile.eta } : {}) };
  const y = synthesizePattern(xs, peaks, opts);
  let top = 0;
  for (let i = 1; i < n; i++) if (y[i]! > y[top]!) top = i;
  const half = y[top]! / 2;
  if (!(half > 0)) return NaN;
  let lo = top;
  while (lo > 0 && y[lo]! > half) lo--;
  let hi = top;
  while (hi < n - 1 && y[hi]! > half) hi++;
  const cross = (i: number, j: number): number => xs[i]! + ((half - y[i]!) / (y[j]! - y[i]!)) * (xs[j]! - xs[i]!);
  return Math.abs(cross(hi - 1, hi) - cross(lo, lo + 1));
}

/** One reading near d: the lines' effective number and their mean spacing in line widths. */
export interface ResolutionReading {
  readonly d: number;
  readonly lines: number;
  readonly effective: number;
  readonly ratio: number;
}

export interface LineResolution {
  /** The shortest d (Å) down to which the lines are resolved. */
  readonly d: number;
  /** Distinct reflection d-spacings (all phases) in the range read, and how many lie below d. */
  readonly lines: number;
  readonly linesBelow: number;
  readonly readings: readonly ResolutionReading[];
}

/** The data's bin width (on its axis) near x: the median spacing of the nearest points. */
function binAt(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < x) lo = mid;
    else hi = mid;
  }
  const gaps: number[] = [];
  for (let i = Math.max(1, lo - 3); i <= Math.min(xs.length - 1, hi + 3); i++) gaps.push(Math.abs(xs[i]! - xs[i - 1]!));
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] ?? 0;
}

/**
 * The lines read from the long-d end down: null when they are resolved down
 * to the end of the range (or too few to tell). `phases` are each phase's
 * applied model; the width is the first phase's (the instrument's profile).
 */
export function resolvedDown(
  pattern: PowderPattern,
  phases: readonly AppliedModel[],
  profile: PowderProfile,
  range: { readonly dMin: number; readonly dMax: number },
): LineResolution | null {
  const first = phases[0];
  if (!first || !(range.dMax > range.dMin) || !(range.dMin > 0) || pattern.points.length < 2) return null;
  const applyLorentz = profile.lorentz ?? true;
  // Every phase's lines at their intensities; coincident ones (3 3 3 and 5 1 1, two phases on one d) are one line.
  const raw = phases.flatMap((a) => {
    const refl = generateReflections(a.model.cell, a.model.spaceGroup, range.dMin / BLOCK, range.dMax * BLOCK);
    return powderPeakIntensities(a.model, pattern.radiation, refl, a.scale, a.po, applyLorentz).map((q) => ({ d: q.d, i: Math.max(0, q.intensity) }));
  }).sort((a, b) => a.d - b.d);
  const lines: { d: number; i: number; x: number }[] = [];
  for (const r of raw) {
    const last = lines[lines.length - 1];
    if (last && r.d - last.d <= 1e-6 * r.d) last.i += r.i;
    else lines.push({ d: r.d, i: r.i, x: NaN });
  }
  for (const l of lines) l.x = placePeaks(pattern, first, [{ d: l.d, intensity: 1 }]).find((p) => !p.secondLine)?.center ?? NaN;
  const xs = [...pattern.points.map((p) => p.x)].sort((a, b) => a - b);
  const readings: ResolutionReading[] = [];
  const step = Math.log(range.dMax / range.dMin) / (GRID - 1);
  for (let g = GRID - 1; g >= 0; g--) {
    const d = range.dMin * Math.exp(g * step);
    const block = lines.filter((l) => l.d >= d / BLOCK && l.d <= d * BLOCK && Number.isFinite(l.x));
    if (block.length < MIN_LINES) continue;
    const sum = block.reduce((a, l) => a + l.i, 0);
    const sum2 = block.reduce((a, l) => a + l.i * l.i, 0);
    if (!(sum > 0) || !(sum2 > 0)) continue;
    const effective = (sum * sum) / sum2;
    const span = Math.abs(Math.max(...block.map((l) => l.x)) - Math.min(...block.map((l) => l.x)));
    const fwhm = lineFwhm(pattern, first, profile, d);
    if (!(fwhm > 0)) continue;
    const bin = binAt(xs, block[block.length >> 1]!.x);
    const width = Math.hypot(fwhm, bin);
    readings.push({ d, lines: block.length, effective, ratio: span / Math.max(1, effective - 1) / width });
  }
  let last: number | null = null;
  for (const r of readings) {
    if (r.ratio < RESOLVED_SPACING) {
      if (last === null) return null;
      const dRes = last;
      const inRange = lines.filter((l) => l.d >= range.dMin && l.d <= range.dMax);
      return { d: dRes, lines: inRange.length, linesBelow: inRange.filter((l) => l.d < dRes).length, readings };
    }
    last = r.d;
  }
  return null;
}
