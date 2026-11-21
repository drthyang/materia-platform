/**
 * What the page and the Copilot say of a session whose instrument file gives
 * the time-of-flight profile (app/powderSpec.ts: tofFileProfileOf). The
 * file's terms are rows of kind `tofFileProfile`, held at the file's values;
 * the fit's share of the peak shape is the zero and the sample's rows beside
 * them. One wording, read off the rows the session has, for the fit-cause
 * advice, set_free, the final instrument pass and get_state.
 */

import type { RefinementParameter } from "@/core/refinement/types";

/** The rows of a session whose instrument file gives the profile, by id. */
export interface TofFileRows {
  /** The file's own profile terms (held). */
  readonly file: readonly string[];
  /** The sample's Lorentzian rows: the microstrain and the size (a GSAS-II file's session has them). */
  readonly lorentz: readonly string[];
  /** The sample's Gaussian microstrain. */
  readonly gauss: readonly string[];
  /** The file's σ₁², which is never free with the Gaussian microstrain. */
  readonly sig1: string | null;
  /** The zero. */
  readonly zero: readonly string[];
}

/** The rows, or null when no instrument file gave the profile (the page's own refinable profile). */
export function tofFileRows(parameters: readonly RefinementParameter[]): TofFileRows | null {
  const ids = (kinds: readonly string[]): string[] => parameters.filter((p) => kinds.includes(p.kind)).map((p) => p.id);
  const file = ids(["tofFileProfile"]);
  if (file.length === 0) return null;
  return {
    file,
    lorentz: ids(["tofSampleLorentz", "tofSampleSize"]),
    gauss: ids(["tofSampleGauss"]),
    sig1: file.find((id) => id.endsWith("tof_sig1")) ?? null,
    zero: ids(["zeroShift"]),
  };
}

/** Why σ₁² and the Gaussian microstrain are never free together. */
export const SIG1_OR_GAUSS = "σ₁² and the sample's Gaussian microstrain widen every peak in proportion to d alike, so the two are never free together";

/** What a profile step or the final instrument pass frees in such a session. */
export function tofFilePassTerms(rows: TofFileRows): string {
  return rows.lorentz.length > 0
    ? `the zero and the sample's Lorentzian rows (${rows.lorentz.join(", ")})`
    : `the zero (this session has no Lorentzian sample row${rows.gauss.length > 0 ? `; its one sample row, the Gaussian microstrain ${rows.gauss.join(", ")}, is in no step of the method` : ""})`;
}

/** The advice on a peak width, tail or shape misfit in such a session: in full, and in a few words. */
export function tofFileShapeAdvice(parameters: readonly RefinementParameter[]): { readonly action: string; readonly short: string } | null {
  const rows = tofFileRows(parameters);
  if (!rows) return null;
  return {
    action: `The instrument file gave the profile and its rows are held: free ${tofFilePassTerms(rows)}, with the scale and background. A peak-shape misfit that stays points to the calibration (the file may not describe this bank or run), not to those rows.`,
    short: `${rows.lorentz.length > 0 ? "Free the sample's Lorentzian rows and the zero" : "Free the zero"} (the file's profile stays held); if it stays, suspect the calibration`,
  };
}

/** set_free's answer for the file's rows it does not free. */
export function tofFileFreeRefusal(rows: TofFileRows, skipped: readonly string[]): string {
  return `not freed: ${skipped.join(", ")} — the instrument file's profile, held at the file's values (no step of the method frees them). For the peak shape free ${tofFilePassTerms(rows)}; a misfit they leave points to the calibration: say so. The user can free a file row by hand in the parameter panel.`;
}
