/**
 * The background a new powder page starts with, by instrument.
 *
 * POWGEN (SNS) time-of-flight data start on a logarithmic background: GSAS-II's
 * "log interpolate" (background.ts, logInterpolateBackground) with three
 * refinable points, at TOF_min, √(TOF_min·TOF_max) and TOF_max. Over a POWGEN
 * bank's decades of TOF the middle point sits where the background bends; three
 * points fit the 350 K Mn₃Ga bank (PG3_45598, examples/mn3ga-350k) better than
 * the four-term Chebyshev default (wR 8.90 % against 9.00 %, scale, background
 * and cell refined on the nuclear model) with one parameter fewer, and a low
 * order leaves the long-d end, where magnetic peaks sit, too stiff to follow a
 * peak no phase explains.
 *
 * POWGEN is recognized the way the Instrument card names it: from the
 * instrument file's text (instrumentRegistry.ts, alias "POWGEN" or "PG3"; a
 * GSAS-II .instprm extracted from a POWGEN project carries "PG3_<run>" in its
 * header), or, when the instrument file names no instrument the registry
 * knows, from the data file's name when it starts with POWGEN's run-file
 * prefix "PG3_" (PG3_45598_Bank1.fxye, PG3_61113-3.dat, PG3_61115.gsa). An
 * instrument file naming another instrument (NOMAD, …) wins over the file
 * name. Only for a TOF pattern with a TOF calibration. Every other page keeps the
 * general default (Chebyshev, the session's term count).
 *
 * A default only: the basis and the count stay the user's (the Background
 * group's controls, the Agent's set_background, MCP build_refinement's
 * `backgroundType`/`backgroundTerms`), and a saved project keeps its own.
 */

import type { BackgroundType } from "@/core/diffraction/background";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";

/** The POWGEN default: log interpolate with three points. */
export const POWGEN_BACKGROUND: { readonly type: BackgroundType; readonly terms: number } = { type: "logInterpolate", terms: 3 };

/**
 * A POWGEN run file's name: "PG3_" at the start of its base name (the text
 * after the last / or \), in any case. Not a looser match: "PG3" elsewhere in
 * the name, or a folder named PG3_…, does not count.
 */
export function isPowgenFileName(name: string | undefined): boolean {
  return /^PG3_/i.test((name ?? "").split(/[/\\]/).pop()!);
}

/**
 * A POWGEN time-of-flight page: a TOF pattern with a TOF calibration, where the
 * instrument file names POWGEN, or names no known instrument (`name` is set
 * only by the registry) and the data file (the pattern's name, which a loaded
 * file takes) is a POWGEN run file.
 */
export function isPowgenTof(pattern: Pick<PowderPattern, "xUnit"> & { readonly name?: string }, instrument: InstrumentParameters | null | undefined): boolean {
  return pattern.xUnit === "tof" && instrument?.kind === "tof" && (instrument.name === "POWGEN" || (instrument.name === undefined && isPowgenFileName(pattern.name)));
}

/** The instrument's default background for new data, or null for the general default. */
export function instrumentBackgroundDefault(
  pattern: Pick<PowderPattern, "xUnit"> & { readonly name?: string },
  instrument: InstrumentParameters | null | undefined,
): { readonly type: BackgroundType; readonly terms: number } | null {
  return isPowgenTof(pattern, instrument) ? POWGEN_BACKGROUND : null;
}
