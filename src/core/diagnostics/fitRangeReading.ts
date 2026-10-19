/**
 * The fit range read for a tool: the input inspectDataRange needs, put
 * together one way for both surfaces, and its reading in words, each end named
 * as a crystallographer names it. The app's check_fit_range gives the view
 * (fitRangeView); MCP's returns the raw reading with the same words in one
 * paragraph (fitRangeSentence). Each surface says how its window is applied.
 */

import type { SpaceGroup, UnitCell } from "@/core/crystal/types";
import type { PowderXUnit } from "@/core/diffraction/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { minMax } from "@/core/math/extent";
import { sig } from "@/core/math/precision";
import { excludedPointMask } from "@/core/refinement/factors";
import { inspectDataRange, type DataEnd, type DataRangeReading } from "@/core/diagnostics/dataRange";
import { X_UNIT_LABEL } from "@/core/diagnostics/axisReading";

export interface FitRangeSource {
  readonly unit: PowderXUnit;
  readonly x: readonly number[];
  readonly yObs: readonly number[];
  readonly sigma: readonly number[];
  readonly yCalc?: readonly number[];
  readonly yBackground?: readonly number[];
  /** yCalc is a converged refinement's: its residual is read too. */
  readonly fitted: boolean;
  /** Each point's d (Å); NaN where it has none. Null when the axis converts to no d. */
  readonly d: readonly number[] | null;
  /** Every phase of the model: each one's reflections are placed on the pattern. */
  readonly phases: readonly { readonly cell: UnitCell; readonly spaceGroup: SpaceGroup }[];
  /** A d (Å) on the pattern's own axis. */
  readonly xOf: (d: number) => number;
  readonly window: { readonly min: number; readonly max: number } | null;
}

/** The data's ends read on the curves given: every phase's reflections placed on the pattern's own axis. */
export function readFitRange(src: FitRangeSource): DataRangeReading {
  let reflections: number[] = [];
  const finite = (src.d ?? []).filter((v) => Number.isFinite(v) && v > 0);
  if (finite.length > 0) {
    const span = minMax(finite);
    const dMin = span.min * 0.98;
    const dMax = Math.min(span.max * 1.02, 50);
    reflections = src.phases.flatMap((ph) => generateReflections(ph.cell, ph.spaceGroup, dMin, dMax, { absences: true }).map((r) => src.xOf(r.d)));
  }
  return inspectDataRange({
    x: src.x,
    yObs: src.yObs,
    sigma: src.sigma,
    ...(src.yCalc ? { yCalc: src.yCalc } : {}),
    ...(src.yBackground ? { yBackground: src.yBackground } : {}),
    fitted: src.fitted,
    reflections: reflections.filter(Number.isFinite),
    shortD: src.unit === "tof" || src.unit === "dSpacing" ? "low" : "high",
    excluded: excludedPointMask(src.yObs),
    window: src.window,
  });
}

/** How the reading is put into words on one surface. */
export interface FitRangeWords {
  readonly unit: PowderXUnit;
  /** A position on the pattern's axis in d (Å), or null where it has none. */
  readonly dOf: (x: number) => number | null;
  /** How this surface applies the proposed window ("set_fit_range with this min and max …"). */
  readonly apply: string;
}

/** Which end is which on this axis, in words a crystallographer uses. */
export function endName(unit: PowderXUnit, end: "low" | "high"): string {
  if (unit === "tof") return end === "low" ? "short-TOF end (short d)" : "long-TOF end (long d)";
  if (unit === "twoTheta") return end === "low" ? "low-angle end" : "high-angle end";
  return `${end} end`;
}

const LARGE = "a large cut: put it to the user before applying it";
const INTERIOR = "A refinement fits one window; it cannot leave out a stretch inside the pattern. Tell the user if one matters.";
const KEEP = "keep the current window: neither end needs trimming";

const verdictOf = (e: DataEnd): string => (e.verdict === "trim" ? "trim" : e.alreadyOutside ? "keep: the fit window already leaves the stretch out" : "keep");
const basisOf = (r: DataRangeReading): string =>
  r.basis === "the data" ? "the data alone (no converged fit yet: run this again after the first refinement, when the residual can show more)" : "the data and the converged fit's residual";
const findingsOf = (e: DataEnd): string[] => e.findings.map((f) => `${f.cause}: ${sig(Math.min(f.from, f.to), 6)}–${sig(Math.max(f.from, f.to), 6)} (${f.points} points): ${f.detail}`);
const dRounded = (w: FitRangeWords, x: number): number | null => {
  const d = w.dOf(x);
  return d !== null && Number.isFinite(d) ? sig(d, 4) : null;
};

/** check_fit_range's answer in the app: each end with its evidence, and the window to propose, in the data's unit and in d. */
export function fitRangeView(r: DataRangeReading, w: FitRangeWords, window: { readonly min: number; readonly max: number } | null): Record<string, unknown> {
  const endView = (e: DataEnd): Record<string, unknown> => ({
    end: endName(w.unit, e.end),
    verdict: verdictOf(e),
    ...(e.alreadyOutside ? { outside: true } : {}),
    ...(e.cut !== undefined ? { cut: sig(e.cut, 6), cutD: dRounded(w, e.cut), pointsLeftOut: e.dropped } : {}),
    ...(e.large ? { large: LARGE } : {}),
    findings: findingsOf(e),
    ...(e.notes.length ? { notes: e.notes } : {}),
  });
  const p = r.proposed;
  return {
    unit: X_UNIT_LABEL[w.unit],
    extent: [sig(r.extent.min, 6), sig(r.extent.max, 6)],
    window: window ? [sig(window.min, 6), sig(window.max, 6)] : "the whole pattern",
    basis: basisOf(r),
    low: endView(r.low),
    high: endView(r.high),
    proposed: p ? { min: sig(p.min, 6), max: sig(p.max, 6), unit: w.unit, d: [dRounded(w, p.min), dRounded(w, p.max)], apply: w.apply } : KEEP,
    ...(r.interior.length ? { interior: r.interior, interiorNote: INTERIOR } : {}),
  };
}

/** The same reading in one paragraph, for a surface that returns the raw reading (MCP). */
export function fitRangeSentence(r: DataRangeReading, w: FitRangeWords): string {
  const end = (e: DataEnd): string => {
    const cut = e.cut !== undefined ? ` at ${sig(e.cut, 6)} ${X_UNIT_LABEL[w.unit]}${dRounded(w, e.cut) !== null ? ` (d ${dRounded(w, e.cut)} Å)` : ""}, ${e.dropped ?? 0} points left out` : "";
    const findings = findingsOf(e);
    return `The ${endName(w.unit, e.end)}: ${verdictOf(e)}${cut}${findings.length ? ` — ${findings.join("; ")}` : ""}${e.large ? `; ${LARGE}` : ""}.`;
  };
  const p = r.proposed;
  const proposed = p
    ? `Proposed window ${sig(p.min, 6)}–${sig(p.max, 6)} ${X_UNIT_LABEL[w.unit]}${dRounded(w, p.min) !== null && dRounded(w, p.max) !== null ? ` (d ${dRounded(w, p.min)}–${dRounded(w, p.max)} Å)` : ""}: ${w.apply}.`
    : `${KEEP[0]!.toUpperCase()}${KEEP.slice(1)}.`;
  return [end(r.low), end(r.high), `Read on ${basisOf(r)}.`, proposed, ...(r.interior.length ? [INTERIOR] : [])].join(" ");
}
