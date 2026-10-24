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
 * knows, as a guess from the data file's name (FILE_NAME_HINTS: "PG3_…" is
 * POWGEN, "NOM_…" NOMAD, which has no default of its own). An instrument file
 * naming an instrument always wins over the file name, and the guess is never
 * stored as the instrument's name. Only for a TOF pattern with a TOF
 * calibration. Every other page keeps the general default (Chebyshev, the
 * session's term count).
 *
 * A default only: the basis and the count stay the user's (the Background
 * group's controls, the Agent's set_background, MCP build_refinement's
 * `backgroundType`/`backgroundTerms`), and a saved project keeps its own.
 */

import type { BackgroundType } from "@/core/diffraction/background";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";
import { instrumentHintFromFileName } from "@/parsers/instrumentRegistry";

/** The POWGEN default: log interpolate with three points. */
export const POWGEN_BACKGROUND: { readonly type: BackgroundType; readonly terms: number } = { type: "logInterpolate", terms: 3 };

/**
 * The instrument a page is taken to be on, for its starting defaults: the one
 * the instrument file names (`name` is set only by the registry), else the one
 * the data file's name hints at when its mode fits the calibration
 * (`guessed`), else null. A guess steers defaults and the card's label only.
 */
export function pageInstrument(pattern: { readonly name?: string }, instrument: InstrumentParameters | null | undefined): { readonly name: string; readonly guessed: boolean } | null {
  if (!instrument) return null;
  if (instrument.name !== undefined) return { name: instrument.name, guessed: false };
  const hint = instrumentHintFromFileName(pattern.name);
  return hint && hint.mode === (instrument.kind === "tof" ? "tof" : "cw") ? { name: hint.name, guessed: true } : null;
}

/** A POWGEN time-of-flight page: a TOF pattern with a TOF calibration, on POWGEN as named by the instrument file or guessed from the data file's name. */
export function isPowgenTof(pattern: Pick<PowderPattern, "xUnit"> & { readonly name?: string }, instrument: InstrumentParameters | null | undefined): boolean {
  return pattern.xUnit === "tof" && instrument?.kind === "tof" && pageInstrument(pattern, instrument)?.name === "POWGEN";
}

/** The instrument's default background for new data, or null for the general default. */
export function instrumentBackgroundDefault(
  pattern: Pick<PowderPattern, "xUnit"> & { readonly name?: string },
  instrument: InstrumentParameters | null | undefined,
): { readonly type: BackgroundType; readonly terms: number } | null {
  return isPowgenTof(pattern, instrument) ? POWGEN_BACKGROUND : null;
}
