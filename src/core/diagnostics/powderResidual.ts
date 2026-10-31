/**
 * The powder residual the judgment tools read (assess_refinement,
 * find_unexplained_peaks, review_symmetry, identify_peaks, diagnose_fit): the
 * points a refinement fits, in d, each with its σ, beside every line the model
 * has. One builder for the MCP tools and the in-app Agent, which each had
 * their own: only the app's knew an applied magnetic model's satellites and
 * that a neutron pattern of magnetic ions may carry k = 0 order, and only the
 * MCP's left out the excluded plateau.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { MagneticModel } from "@/core/magnetic/types";
import type { PowderPattern } from "@/core/diffraction/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { magneticLines } from "@/core/magnetic/magneticLines";
import { magneticIonCandidates } from "@/core/magnetic/magneticIons";
import { excludedPointMask } from "@/core/refinement/factors";
import { relativeLineWidth } from "@/core/diagnostics/assessment";

/** The residual as assess_refinement and residualPeaks take it. */
export interface PowderResidual {
  d: number[];
  yObs: number[];
  yCalc: number[];
  sigma: number[];
  /**
   * Where σ came from: the file's own for every point, or counting statistics
   * (√y, at least 1) for points the file gave none. √y is right for raw counts
   * and means nothing for normalized data, so a tool that tests significance
   * says which it had.
   */
  sigmaFrom: "file" | "counting";
  /** Every phase's reflections in its refined cell, and an applied magnetic model's satellites. */
  reflections: { d: number; hkl: string; phaseLabel: string }[];
  /** A neutron pattern with no magnetic model, of a phase with magnetic ions: excess on nuclear lines at large d may be k = 0 order. */
  magneticNeutron: boolean;
  /** Constant wavelength: the calculated lines' typical FWHM over d (relativeLineWidth). */
  lineWidth?: number;
}

export interface PowderResidualInput {
  /** The curves the refinement fitted, on the pattern's own axis. */
  readonly curves: { readonly x: readonly number[]; readonly yObs: readonly number[]; readonly yCalc: readonly number[] };
  /** Each point's d (Å), with the refined zero or calibration taken out. */
  readonly d: readonly number[];
  readonly pattern: PowderPattern;
  /** Every phase with its refined values applied, primary first. */
  readonly phases: readonly StructureModel[];
  /** The fit window on the pattern's axis; null: the whole pattern. */
  readonly fitRange: { readonly min: number; readonly max: number } | null;
  /** The magnetic model applied to the calculated pattern, if any, at the moments the calculated pattern uses. */
  readonly magnetic?: MagneticModel | null;
}

/** A satellite's indices as the tools print them: "h k l" at k = 0, else its parent reflection and arm, "0 0 1 + k". */
function satelliteLabel(q: readonly [number, number, number], k: readonly number[]): string {
  const isInt = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-6;
  const ints = (v: readonly number[]): string => v.map((x) => String(Math.round(x) + 0)).join(" ");
  if (k.every((v) => Math.abs(v) < 1e-9)) return ints(q);
  const minus = q.map((v, i) => v - k[i]!);
  if (minus.every(isInt)) return `${ints(minus)} + k`;
  const plus = q.map((v, i) => v + k[i]!);
  if (plus.every(isInt)) return `${ints(plus)} − k`;
  return q.map((v) => String(+v.toFixed(3))).join(" ");
}

/** The least and greatest finite positive value, by a loop (a TOF file's 10⁵–10⁶ points overflow a spread into Math.min). */
function positiveExtent(values: readonly number[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Each point's σ: the file's where it gives one, counting statistics (√max(y, 1)) where it does not. */
export function pointSigma(yObs: readonly number[], points: readonly { readonly sigma?: number }[] | null): number[] {
  const given = points && points.length === yObs.length ? points : null;
  return yObs.map((y, i) => {
    const s = given?.[i]?.sigma;
    return s !== undefined && s > 0 ? s : Math.sqrt(Math.max(y, 1));
  });
}

/** The points a refinement fits: inside the window and off the excluded plateau. */
export function fittedPoints(x: readonly number[], yObs: readonly number[], window: { readonly min: number; readonly max: number } | null | undefined): boolean[] {
  const plateau = excludedPointMask(yObs);
  return x.map((v, i) => !plateau[i] && !(window && (v < window.min || v > window.max)));
}

/** The residual of the points a refinement fits (inside the window, not on the excluded plateau), and how many there are. */
export function powderResidual(input: PowderResidualInput): { residual: PowderResidual; observationCount: number } {
  const { curves, pattern } = input;
  const keep = fittedPoints(curves.x, curves.yObs, input.fitRange);
  const pick = <T>(a: readonly T[]): T[] => a.filter((_, i) => keep[i]);
  // Each point's own σ; counting statistics where the file gives none.
  const points = pattern.points.length === curves.x.length ? pattern.points : null;
  let fromFile = points !== null;
  const sigma = curves.yObs.map((y, i) => {
    const given = points?.[i]?.sigma;
    if (given !== undefined && given > 0) return given;
    if (keep[i]) fromFile = false;
    return Math.sqrt(Math.max(y, 1));
  });
  const d = pick(input.d);
  const yCalc = pick(curves.yCalc);
  const extent = positiveExtent(d);
  const reflections: PowderResidual["reflections"] = [];
  if (extent) {
    const [dMin, dMax] = [extent[0] * 0.99, extent[1] * 1.01];
    for (const ph of input.phases) {
      reflections.push(...generateReflections(ph.cell, ph.spaceGroup, dMin, dMax, { absences: true }).map((r) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, phaseLabel: ph.name || ph.id })));
    }
    // An applied magnetic model's lines are lines of the model too, where the
    // calculated pattern has its intensity: a residual on one is its misfit,
    // not a missing phase. A satellite with no magnetic intensity (zero
    // moments, a structure factor that vanishes there) explains nothing — a
    // magnetic tick alone never marks a peak as explained (THY-45).
    const magnetic = input.magnetic;
    if (magnetic) {
      const parent = input.phases.find((ph) => ph.id === magnetic.structureId) ?? input.phases[0];
      if (parent) {
        reflections.push(...magneticLines(parent, magnetic, dMin, dMax).map((r) => ({ d: r.d, hkl: satelliteLabel([r.h, r.k, r.l], magnetic.propagation[0] ?? [0, 0, 0]), phaseLabel: `${parent.name || parent.id} magnetic` })));
      }
    }
  }
  // Neutrons see magnetic order; a phase with magnetic ions may carry it.
  const magneticNeutron = pattern.radiation.kind.startsWith("neutron") && !input.magnetic && input.phases.some((ph) => magneticIonCandidates(ph).length > 0);
  // Constant wavelength: "on" and "beside" a reflection follow the lines' own width.
  const lineWidth = pattern.xUnit === "twoTheta" ? relativeLineWidth(d, yCalc) : undefined;
  return {
    residual: { d, yObs: pick(curves.yObs), yCalc, sigma: pick(sigma), sigmaFrom: fromFile ? "file" : "counting", reflections, magneticNeutron, ...(lineWidth !== undefined ? { lineWidth } : {}) },
    observationCount: keep.reduce((n, k) => n + (k ? 1 : 0), 0),
  };
}
