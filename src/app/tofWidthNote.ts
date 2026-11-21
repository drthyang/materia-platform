/**
 * What the Instrument card says about an instrument file's TOF profile
 * (core/workflow/powder.ts: tofWidthsAt): how the file's terms are used, and,
 * only when it happens, where in the data's d-range the file gives no peak
 * width and which reflections are therefore not drawn.
 */
import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import type { InstrumentBank } from "@/parsers/instrument";
import { resolveTies } from "@/core/refinement/constraints";
import { applyParameters } from "@/core/workflow/apply";
import { phaseBindingsFor } from "@/core/workflow/multiPhase";
import { tofReflectionsLeftOut, tofWidthProblems } from "@/core/workflow/powder";
import { GSAS2_NEW_PHASE_MUSTRAIN, GSAS2_NEW_PHASE_SIZE, tofFileProfileOf } from "@/app/powderSpec";

export interface CardNote {
  /** One plain line. */
  readonly line: string;
  /** The rest, behind "?". */
  readonly detail: string;
}

/**
 * The line for an instrument file whose profile the page evaluates with the
 * file's own program's function, or null when the instrument gives no profile
 * (the page's own refinable profile, described by bankChoice.unusedNote).
 */
export function fileProfileNote(instrument: InstrumentParameters, bank: InstrumentBank | null): CardNote | null {
  const file = tofFileProfileOf(instrument);
  if (!file) return null;
  const unread = bank?.extras.pdabc ? " Not used: the pdabc table." : "";
  return {
    line: `Profile as the file gives it, held. Sample rows start at GSAS-II's defaults (Lorentzian microstrain ${GSAS2_NEW_PHASE_MUSTRAIN}, size ${GSAS2_NEW_PHASE_SIZE} µm), which a GSAS-II calibration assumes.${unread}`,
    detail: [
      "Every profile term of the file is used as read, negative values included, with GSAS-II's functions of d: α = alpha/d, β = beta-0 + beta-1/d⁴ + beta-q/d², σ² = sig-0 + sig-1·d² + sig-2·d⁴ + sig-q·d, and the Lorentzian width γ = X·d + Y·d² + Z (a negative γ counts as none).",
      "The peak is GSAS-II's time-of-flight function: two back-to-back exponentials convolved with a pseudo-Voigt.",
      "These rows are the instrument's and stay held unless you free them; a profile step refines the sample's rows.",
      `GSAS-II adds the sample's broadening to the instrument's, and a new phase in GSAS-II has Lorentzian microstrain ${GSAS2_NEW_PHASE_MUSTRAIN} (× 10⁻⁶) and size ${GSAS2_NEW_PHASE_SIZE} µm. A calibration fitted without changing them leaves X and Y as what remained, so the file gives the standard's peaks only with those two values beside it. The two sample rows start there; edit them if the calibration used other values.`,
      "The Gaussian microstrain row starts at 0. It and σ₁² widen every peak in proportion to d alike, so the two are never free together: freeing one holds the other.",
      "2-theta, fltPath and Azimuth are read and not used in the calculation.",
      ...(bank?.extras.pdabc ? ["The tabulated profile (pdabc) is not read."] : []),
    ].join(" "),
  };
}

const fmtD = (d: number): string => d.toFixed(d < 1 ? 3 : 2);

/**
 * The warning when the instrument file's profile gives σ² ≤ 0, α ≤ 0 or β ≤ 0
 * somewhere in the d-range of the loaded data, or null when the widths are
 * valid everywhere there (then the page says nothing).
 */
export function tofWidthNote(s: {
  readonly structure: StructureModel;
  readonly extraPhases?: readonly StructureModel[];
  readonly pattern: PowderPattern;
  readonly powderParams: readonly RefinementParameter[];
  readonly powderBindings: readonly ParameterBinding[];
}): CardNote | null {
  if (s.pattern.xUnit !== "tof" || !s.powderBindings.some((b) => b.kind === "tofFileProfile")) return null;
  const values: Record<string, number> = {};
  for (const p of s.powderParams) values[p.id] = p.value;
  const resolved = resolveTies(s.powderParams, values);
  const phases = [s.structure, ...(s.extraPhases ?? [])];
  const multi = phases.length > 1;
  const appliedOf = (phase: StructureModel) => applyParameters(phase, multi ? phaseBindingsFor(s.powderBindings, phase.id) : s.powderBindings, resolved);
  const problems = tofWidthProblems(s.pattern, appliedOf(s.structure));
  if (problems.length === 0) return null;
  const left = phases.flatMap((phase) => tofReflectionsLeftOut(s.pattern, appliedOf(phase)));
  const ranges = problems.map((p) => `d ${fmtD(p.dMin)}–${fmtD(p.dMax)} Å (${p.which} ≤ 0)`).join(", ");
  const names = left.slice(0, 12).map((r) => `${r.h} ${r.k} ${r.l} (${fmtD(r.d)} Å)`).join(", ");
  return {
    line: `The instrument file gives no peak width for ${ranges}: ${left.length} reflection${left.length === 1 ? "" : "s"} not drawn.`,
    detail: [
      "Checked over the d-range of the loaded data only. Where the file's σ², α or β is not positive no peak is defined, in GSAS-II as here, so the reflections there are left out of the calculated pattern and no width is invented for them.",
      left.length > 0 ? `Not drawn: ${names}${left.length > 12 ? `, and ${left.length - 12} more` : ""}.` : "No reflection of the model falls there.",
      "Set the fit range to leave that part of the data out, or use an instrument file calibrated over it. A refinement step that would take a width below zero elsewhere in the data's range is rejected.",
    ].join(" "),
  };
}
