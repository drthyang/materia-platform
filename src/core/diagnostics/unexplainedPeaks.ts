/**
 * find_unexplained_peaks, on both tool surfaces: the residual's peaks split
 * into those on no line of the model (unexplained: an impurity, the sample
 * environment, magnetic order) and those on or beside one (misfits, which
 * refining the model fixes), with a reading. The MCP tool once returned the
 * raw peaks, unclassified and with no σ, while the in-app tool classified
 * them: an agent on MCP could call a misfit an extra peak.
 */

import { K0_MAGNETIC, k0MagneticHint, residualPeaks, type AssessmentInput } from "@/core/diagnostics/assessment";
import type { AnnotatedExtraPeak } from "@/core/magnetic/extraPeaks";

type Residual = NonNullable<AssessmentInput["residual"]> & { readonly sigmaFrom?: "file" | "counting" };

/** A peak as the tools give it: where, how high, how many σ, and the line it sits on or beside. */
export interface PeakReading {
  readonly d: number;
  readonly height: number;
  /** Height over the point's σ, when the residual had σ. */
  readonly sigmas?: number;
  /** "on Mn3Ga 1 0 1", "beside Mn3Ga 1 1 0 (+1.0% in d)", or "near …, resolved from it" for an unexplained peak by a line. */
  readonly near?: string;
}

export interface UnexplainedPeaks {
  readonly count: number;
  readonly unexplained: readonly PeakReading[];
  /** Peaks on or beside a known line, tallest first. */
  readonly misfits: readonly PeakReading[];
  /**
   * A neutron pattern of magnetic ions with its excess on nuclear lines at
   * large d: the misfits may be k = 0 magnetic order (their d go to the
   * k-search), not a model to refine into.
   */
  readonly k0Magnetic: boolean;
  readonly reading: string;
  /** The raw peaks, for a page that marks them on its plot. */
  readonly raw: { readonly unexplained: readonly AnnotatedExtraPeak[]; readonly misfits: readonly AnnotatedExtraPeak[] };
  /** Each raw peak's PeakReading, as listed above. */
  readonly view: (p: AnnotatedExtraPeak) => PeakReading;
}

/**
 * The residual's peaks, classified (residualPeaks), at most `limit` of each
 * kind. `identifyTool` names the tool that matches an unexplained peak to the
 * sample environment and common phases, where the surface has one.
 */
export function unexplainedPeaks(residual: Residual, options: { readonly sigma?: number; readonly limit?: number; readonly identifyTool?: string } = {}): UnexplainedPeaks {
  const limit = options.limit ?? 12;
  const { between, beside, onReflection } = residualPeaks(residual, { ...(options.sigma !== undefined ? { sigma: options.sigma } : {}), limit });
  const misfits = [...onReflection, ...beside].sort((a, b) => b.height - a.height).slice(0, limit);
  const isBeside = new Set(beside);
  const isExtra = new Set(between);
  const near = (p: AnnotatedExtraPeak): string | undefined => {
    if (!p.nearNuclear) return undefined;
    const ref = `${p.nearNuclear.phaseLabel} ${p.nearNuclear.hkl}`;
    const off = `${((p.d / p.nearNuclear.d - 1) * 100).toFixed(1)}% in d`;
    // An extra peak near a line, but resolved from it: the model has no intensity there.
    if (isExtra.has(p)) return `near ${ref} (${off}), resolved from it`;
    return isBeside.has(p) ? `beside ${ref} (${off})` : `on ${ref}`;
  };
  const view = (p: AnnotatedExtraPeak): PeakReading => ({
    d: p.d,
    height: p.height,
    ...(p.significance !== undefined ? { sigmas: p.significance } : {}),
    ...(near(p) ? { near: near(p)! } : {}),
  });
  const k0Magnetic = k0MagneticHint(residual.magneticNeutron, onReflection);
  const counted = residual.sigma && residual.sigmaFrom === "counting" ? " (σ from counting statistics, √y: the file gives none, so this assumes raw counts)" : "";
  const misfitReading = misfits.length === 0 ? ""
    : ` ${misfits.length} residual peak${misfits.length === 1 ? " sits" : "s sit"} on or beside a known reflection (misfits): ${misfits.length === 1 ? "a reflection" : "reflections"} the model has, with intensity or shape not matched yet. They are not extra peaks — don't call them so, and don't add a phase or change the symmetry for them. Refining the structure (positions, ADPs, occupancy), the profile and the corrections (preferred orientation, absorption) is what fixes them.`;
  const reading = between.length === 0 && misfits.length === 0
    ? `No residual peak stands 5σ above its own noise${counted}.`
    : (between.length === 0
      ? "No extra peak: no residual peak sits away from the phases' reflections."
      : `${between.length} peak${between.length === 1 ? "" : "s"} on no phase's reflection or its tail: intensity no phase accounts for (an impurity, the sample environment, magnetic order, or an unmodelled feature${options.identifyTool ? `; ${options.identifyTool} checks the sample environment and common standards` : ""}).`) +
      misfitReading +
      (k0Magnetic ? ` ${K0_MAGNETIC}` : "") +
      (between.length + misfits.length > 0 ? counted.replace(/^ \((.*)\)$/, " Note: $1.") : "");
  return {
    count: between.length,
    unexplained: between.map(view),
    misfits: misfits.map(view),
    k0Magnetic,
    reading,
    raw: { unexplained: between, misfits },
    view,
  };
}
