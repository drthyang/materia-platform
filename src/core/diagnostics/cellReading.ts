/**
 * What the cell check (core/workflow/cellSymmetryCheck.ts) says, for both
 * surfaces: one factor on every d that the pattern's own peaks read (a wrong
 * wavelength or TOF difC, which the Le Bail fit cannot follow), the cell the
 * Le Bail fit found against the structure's, the peaks no reflection indexes,
 * the shoulders on strong lines, and the forbidden reflections that show
 * intensity. The app's check_cell_symmetry and MCP's give the same reading;
 * each names its own tools.
 */

import type { StructureModel, UnitCell } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import { generateReflections } from "@/core/diffraction/reflections";
import { dScaleSearch, observedPeaks, wrongScale } from "@/core/diagnostics/dScale";
import type { CellSymmetryCheck } from "@/core/workflow/cellSymmetryCheck";

/**
 * The pattern's strongest peaks against the structure's reflections: one
 * factor on every d that indexes them where 1 does not is a wrong wavelength
 * (or TOF difC), named with the value it implies. `d` is each point's d.
 * Null when 1 indexes them.
 */
export function dScaleReading(d: readonly number[], pattern: PowderPattern, structure: StructureModel, instrument?: InstrumentParameters): string | null {
  if (structure.sites.length === 0 || d.length !== pattern.points.length) return null;
  const peaks = observedPeaks(d, pattern.points.map((p) => p.yObs), pattern.points.map((p) => p.sigma ?? 0));
  const r = dScaleSearch(peaks, generateReflections(structure.cell, structure.spaceGroup, 0.4, 50).map((x) => x.d));
  if (!wrongScale(r)) return null;
  const f = r.factor;
  const pctOf = (v: number): string => `${Math.round(100 * v)} %`;
  const lambda = pattern.xUnit === "twoTheta" ? (instrument?.kind === "constantWavelength" ? instrument.wavelength : pattern.radiation.kind !== "neutron-tof" ? pattern.radiation.wavelength : undefined) : undefined;
  const cause = pattern.xUnit === "tof"
    ? `a wrong difC (the calibration would be difC × ${(1 / f).toFixed(4)})`
    : lambda !== undefined
      ? `a wrong wavelength: the data would be at λ ${(lambda / f).toFixed(4)} Å, not ${lambda} Å`
      : "a wrong wavelength or calibration";
  return `The pattern's ${r.peaks} strongest peaks index the structure's cell with every d × ${f.toFixed(4)} (${pctOf(r.indexed)} of their height; at × 1, ${pctOf(r.indexedAtOne)}): one factor on every line is ${cause} — or the wrong cell for this phase. Ask the user to confirm before anything else: no refinement fixes it, and a refined cell would absorb it.`;
}

/**
 * The cell the peaks give against the structure's. Every length scaled by
 * one factor is what a wrong wavelength (or a wrong TOF difC) does to every
 * d, more often than a wrong cell; lengths moving apart are the phase, its
 * temperature or its composition. Null when the cell agrees within 0.5 %.
 */
export function cellShiftReading(loaded: UnitCell, found: UnitCell, unit: PowderPattern["xUnit"]): string | null {
  const rel = (["a", "b", "c"] as const).map((k) => found[k] / loaded[k] - 1);
  const worst = Math.max(...rel.map(Math.abs));
  if (worst <= 0.005) return null;
  const spread = Math.max(...rel) - Math.min(...rel);
  const pctText = (v: number): string => `${v > 0 ? "+" : ""}${(100 * v).toFixed(2)} %`;
  const what = unit === "tof" ? "the TOF calibration (difC)" : unit === "twoTheta" ? "the wavelength" : "the d scale";
  if (spread <= 0.1 * worst) {
    const mean = rel.reduce((t, v) => t + v, 0) / 3;
    return `The peaks give a cell ${pctText(mean)} off the structure's in every length alike (a ${pctText(rel[0]!)}, b ${pctText(rel[1]!)}, c ${pctText(rel[2]!)}): one factor on every d is what a wrong ${unit === "twoTheta" ? "wavelength" : "calibration"} does. Ask the user to confirm ${what} before refining: a refined cell would absorb it silently.`;
  }
  return `The peaks give a cell up to ${pctText(rel[rel.map(Math.abs).indexOf(worst)]!)} off the structure's (a ${pctText(rel[0]!)}, b ${pctText(rel[1]!)}, c ${pctText(rel[2]!)}), unevenly: the phase at another temperature or composition, or another phase. Say so before refining.`;
}

/**
 * What the cell check's shoulders mean: tails of a profile the Le Bail fit
 * draws simply, not a phase. Shoulders at one common offset from their lines
 * are the instrument's; the Rietveld profile is the place to fit them.
 */
export function shoulderReading(shoulders: readonly { readonly x: number; readonly of: string; readonly offset: number; readonly relativeHeight: number }[], unit: string): string {
  const n = shoulders.length;
  const at = (x: number): string => (unit === "twoTheta" ? `${x.toFixed(2)}°` : `${x.toFixed(4)} ${unit}`);
  const list = shoulders.slice(0, 4).map((sh) => `${at(sh.x)} beside ${sh.of}, ${(100 * sh.relativeHeight).toFixed(1)} %`).join("; ");
  const offsets = shoulders.map((sh) => sh.offset);
  const mean = offsets.reduce((a, b) => a + b, 0) / n;
  const spread = Math.max(...offsets) - Math.min(...offsets);
  const common = n >= 2 && spread <= 0.25 * Math.abs(mean);
  return `${n} shoulder${n === 1 ? "" : "s"} on the flank of a strong line (${list}): the tail of a peak profile the Le Bail fit draws simply, not a missing phase${common ? `; ${n === 2 ? "both sit" : "they sit"} at one offset from their lines (${mean < 0 ? "−" : "+"}${Math.abs(mean).toFixed(2)}${unit === "twoTheta" ? "°" : ` ${unit}`}), an instrumental feature` : ""}. They do not count against the cell. The Rietveld profile (asymmetry, Lorentzian X and Y) fits such tails; look at them again on the refined residual, and name them to the user only if they outlive it.`;
}

/** The tools a surface's reading names: the peak identification, a note, the symmetry review (each left out where the surface has none). */
export interface CellReadingTools {
  readonly identify?: string;
  readonly note?: string;
  readonly review?: string;
}

/**
 * The check read whole: the d scale first (null when 1 indexes the peaks),
 * else the cell a good Le Bail fit found against `loaded`; the unindexed
 * peaks, the shoulders and the forbidden reflections with intensity, or that
 * none of these is there.
 */
export function cellCheckReading(check: CellSymmetryCheck, o: { readonly loaded: UnitCell; readonly unit: PowderPattern["xUnit"]; readonly scale: string | null; readonly tools?: CellReadingTools }): string {
  const tools = o.tools ?? {};
  const violated = check.absences.violated;
  const unindexed = check.unindexedPeaks.length;
  const flags = violated.map((v) => `${v.h} ${v.k} ${v.l} at d ${v.d.toFixed(3)} Å`).join(", ");
  // The cell a good Le Bail fit found, against the structure's: one factor on every length reads as the wavelength.
  const shift = o.scale ?? (check.leBail.rWeighted < 0.5 ? cellShiftReading(o.loaded, check.cell, o.unit) : null);
  const readings = [
    ...(shift ? [shift] : []),
    ...(unindexed > 0 ? [`${unindexed} peak${unindexed === 1 ? "" : "s"} no reflection of the cell indexes: a missing phase (most often) or a wrong cell.${tools.identify ? ` ${tools.identify} (with their d) checks the sample environment and common standards.` : ""} Settle this with the user before refining the structure.`] : []),
    ...(check.shoulders.length > 0 ? [shoulderReading(check.shoulders, o.unit)] : []),
    ...(violated.length > 0
      ? [`${violated.length} forbidden reflection${violated.length === 1 ? "" : "s"} show${violated.length === 1 ? "s" : ""} leftover intensity (${flags}). This is a flag, not a verdict: before the structure is refined, profile misfit${unindexed > 0 ? ", or a line of the unindexed phase," : ""} reads the same way. Do not change the space group now: note it${tools.note ? ` (${tools.note})` : ""} and refine the structure to the best; ${tools.review ?? "the symmetry review"} reads the refined residual at the end.`]
      : []),
  ];
  return readings.length > 0 ? readings.join(" ") : "Every peak indexes and no forbidden reflection shows intensity: refine the structure.";
}
