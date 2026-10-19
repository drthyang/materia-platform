/**
 * A single crystal's data read in words before the model: the merge a
 * crystallographer quotes and its R_int, the Friedel coverage, the measured
 * absences, the intensity statistics and the merohedral twin laws' H-test.
 * reflection_statistics, get_state and the report quote the same merge from
 * here. What the page alone knows (a listing, the merged file, the model's own
 * Bijvoet differences) is passed in.
 */

import type { MergeStatistics } from "@/core/diffraction/merge";
import type { FriedelCoverage, IntensityStatistics, ReflectionStatistics } from "@/core/diagnostics/reflectionStatistics";
import type { TwinLawTest } from "@/core/diagnostics/twinLaws";
import { pct, sig } from "@/core/math/precision";

export interface QuotedMerge {
  readonly unique: number;
  readonly redundancy: number;
  readonly rInt: number;
  readonly rSigma: number;
}

/**
 * The merge a crystallographer quotes: in an acentric group the Friedel mates
 * kept apart and the absences left out, as SHELXL merges it (MERG 2); in a
 * centrosymmetric one, the Laue class.
 */
export const quotedMerge = (m: MergeStatistics): QuotedMerge => m.friedelApart ?? m;

/** The data hold repeats to compare: an R_int means something. */
export const hasRepeats = (m: QuotedMerge): boolean => m.redundancy > 1 + 1e-9;

/**
 * R_int as quoted (%), or why there is none: data holding each reflection once
 * (merged, or a refinement's listing) have no equivalents to compare. In an
 * acentric group each reflection's Friedel mate is another reflection: merged
 * in the Laue class, the Bijvoet pairs would differ by their anomalous signal,
 * which is no R_int. `modelBijvoet` is the model's own Bijvoet difference, as
 * an R_int would read it (null when the page cannot give it).
 */
export function rIntQuoted(m: MergeStatistics, modelBijvoet: () => number | null): number | string {
  const q = quotedMerge(m);
  if (hasRepeats(q)) return pct(q.rInt);
  if (!(m.friedelApart && hasRepeats(m))) return "n/a (each reflection once: merged data)";
  // What the Bijvoet pairs differ by: the anomalous signal the model gives them, and the measurements' noise. The model says which.
  const model = modelBijvoet();
  const which = model === null ? ""
    : model >= 0.5 * m.rInt ? `, mostly their anomalous signal (the model's own Bijvoet differences give ${pct(model)} %)`
      : `; the model's anomalous differences give ${pct(model)} %, so the rest is the measurements' disagreement`;
  return `n/a (each reflection once, its Friedel mate apart; merged with them the Bijvoet pairs differ by ${pct(m.rInt)} %${which})`;
}

/** The Laue-class R_int beside the quoted one, when they differ (an acentric group with repeats). */
export function rIntLaue(m: MergeStatistics): { readonly rIntLaue: number; readonly rIntNote: string } | null {
  if (!m.friedelApart || !hasRepeats(quotedMerge(m))) return null;
  return {
    rIntLaue: pct(m.rInt),
    rIntNote: "rInt keeps the Friedel mates apart and leaves the absences out, as SHELXL merges a non-centrosymmetric group and reports it; rIntLaue merges each reflection's Laue-class equivalents, the Friedel mates among them. The difference is what the mates differ by: the anomalous signal.",
  };
}

/** How many acentric reflections have their Friedel mate measured, and what that allows. */
export function friedelSentence(f: FriedelCoverage): string {
  if (f.centrosymmetric) return "centrosymmetric group: Friedel mates are equivalent; no absolute structure to determine";
  return `${f.withMate} of the ${f.unique - f.centric} acentric reflections unique under the point group have their Friedel mate measured (${pct(f.fraction)} %)${f.centric ? `; ${f.centric} more are centric (no Bijvoet pair)` : ""}${f.fraction < 0.2 ? ": the Friedel pairs were merged (or never measured) — the absolute structure cannot be determined from these data" : ""}`;
}

/** The reflections the group forbids that were measured, the strongest at ≥ 3σ, and how to read them. */
export function absencesView(a: ReflectionStatistics["absences"]): Record<string, unknown> | string {
  if (a.measured === 0) return "no reflection the space group forbids was measured (or the file left them out)";
  return {
    measured: a.measured,
    atThreeSigma: a.violated.length,
    strongest: a.violated.slice(0, 8).map((v) => `${v.h} ${v.k} ${v.l} (d ${sig(v.d, 4)} Å, ${sig(v.iOverSigma, 3)}σ${v.ofAllowed !== undefined ? `, ${pct(v.ofAllowed)} % of the mean allowed intensity at that d` : ""})`),
    reading: "A few weak ones, at a small fraction of the allowed intensity, are what multiple diffraction (Renninger) gives in a good crystal, or λ/2; a whole class of strong ones questions the group.",
  };
}

/** ⟨|E² − 1|⟩ with what it is expected to be, against the group's centrosymmetry. */
export function intensityView(st: IntensityStatistics, centrosymmetric: boolean): Record<string, unknown> | string {
  if (!Number.isFinite(st.meanAbsE2Minus1)) return "too few reflections";
  if (!st.applies) return { meanAbsE2Minus1: sig(st.meanAbsE2Minus1, 3), reading: st.reading };
  return {
    meanAbsE2Minus1: sig(st.meanAbsE2Minus1, 3),
    fractionWeak: sig(st.fractionWeak, 3),
    reading: st.reading,
    expected: "0.968 centrosymmetric, 0.736 non-centrosymmetric, 0.541 for a perfect twin of a non-centrosymmetric crystal (each intensity the mean of two); E² < 0.1 for 24.8 % or 9.5 % of reflections",
    group: centrosymmetric ? "the space group is centrosymmetric" : "the space group is non-centrosymmetric",
    note: "From the measured intensities: strong extinction lowers the strong end, and the value with it.",
  };
}

/** The tools a surface has that the twin reading names. */
export interface TwinReadingTools {
  /** The tool that adds a twin law to the model (set_twin). */
  readonly twin?: string;
}

/** The lattice's merohedral twin laws, each with the fraction Yeates' H-test reads for it from the data alone. */
export function twinLawsView(laws: readonly TwinLawTest[], tools: TwinReadingTools = {}): Record<string, unknown> | string {
  if (laws.length === 0) return "none: the lattice holds no symmetry beyond the Laue class, so no merohedral twin (a pseudo-merohedral one needs a cell that nearly holds more)";
  const add = tools.twin ? `${tools.twin} with it` : "add it to the model";
  return {
    laws: laws.map((l) => ({ law: l.matrix, indices: l.indices, pairs: l.pairs, ...(l.pairs > 0 ? { meanH: sig(l.meanH, 3), alpha: sig(l.alpha, 3) } : { alpha: `no ${l.distribution} pair (h, R·h) measured above 3σ: the test has nothing to read for this law` }) })),
    reading: `Yeates' H-test, before any model: over the pairs (h, R·h) both measured above 3σ, ⟨H⟩ = ⟨|I₁ − I₂|/(I₁ + I₂)⟩ = ${laws[0]!.distribution === "centric" ? "(2/π)(1 − 2α) — the group is centrosymmetric, so every reflection is centric and I₁/(I₁ + I₂) follows the arcsine law" : "½ − α over the acentric pairs"}. A law with α well above the others' twins the crystal: ${add}, and refine its fraction. The test's α is an estimate, and on weak data a high one: keeping only the pairs both above 3σ drops those with one weak member, which raises α, so with few pairs an untwinned crystal can read 0.1–0.3 (the refined fraction decides). A perfect twin by one law leaves the others near α ≈ 0.12 (each intensity then the mean of two), and pseudo-symmetry raises every α; all near 0: no merohedral twin.`,
  };
}
