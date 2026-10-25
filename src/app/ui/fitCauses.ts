/**
 * What limits the fit, for the powder Validation view: the causes of misfit
 * diagnose_fit reads (core/diagnostics/fitDiagnosis.ts), each in plain words
 * with its share of χ², the evidence in one sentence (the statistic beside
 * it, diagnose_fit's own wording behind it), and what to do in the app's
 * terms, in the order of the user's method (my-rietveld-workflow: scale,
 * background and cell; positions; profile; ADPs; occupancy; corrections).
 *
 * The ranking, the shares and the numbers are the diagnosis's own, read from
 * the page as the Agent reads it (powderJudgment.ts), so the view and the
 * Agent name the same causes; only the words are the page's. The page never
 * frees a row for the user (the order is theirs): an action opens the
 * parameter group where the rows are, or shows the pattern.
 */

import type { CauseId, FitCause, FitDiagnosis } from "@/core/diagnostics/fitDiagnosis";
import type { PowderValidation, ReflectionMisfit } from "@/core/diagnostics/powderValidation";
import type { CheckAction } from "@/core/diagnostics/validationChecks";
import { WIDTHS_AGREE } from "@/core/diagnostics/thresholds";
import type { ParameterKind, RefinementParameter } from "@/core/refinement/types";
import { stagesFor } from "@/agent/method";
import { parameterGroupOf } from "@/app/ui/parameterGroups";

/** The evidence sections the view keeps behind disclosures. */
export type EvidenceSection = "residual" | "shells" | "worst" | "agreement";

/** What a button in the Validation view does; the page carries it out. */
export type ValidationAction =
  | { readonly kind: "refine" }
  | { readonly kind: "check"; readonly action: CheckAction }
  /** Open a parameter group in the panel (nothing is freed). */
  | { readonly kind: "parameters"; readonly group: string }
  /** Open the pattern at a point of the pattern's own axis. */
  | { readonly kind: "pattern"; readonly x: number }
  | { readonly kind: "magnetic" }
  | { readonly kind: "evidence"; readonly section: EvidenceSection };

export interface ActionButton {
  readonly label: string;
  readonly title: string;
  readonly action: ValidationAction;
}

export interface CauseRow {
  readonly id: CauseId;
  /** Its name ("Peak tails"). */
  readonly title: string;
  /** As a sentence names it ("the peak tails"). */
  readonly phrase: string;
  /** Fraction of the fit's χ² (approximate; causes can overlap). */
  readonly share: number;
  /** What the residual shows, in one plain sentence. */
  readonly evidence: string;
  /** The numbers behind it, shown beside the sentence. */
  readonly statistic?: string;
  /** diagnose_fit's own evidence, verbatim. */
  readonly detail: string;
  /** What to do, in the app's terms and the method's order. */
  readonly action: string;
  readonly buttons: readonly ActionButton[];
}

export interface CauseContext {
  readonly parameters: readonly RefinementParameter[];
  /** Constant-wavelength 2θ data. */
  readonly twoTheta: boolean;
  /** The page's background: its basis's coefficient count. */
  readonly backgroundTerms: number;
  /** A neutron pattern of magnetic ions with no magnetic model; `k0`: its misfits on nuclear lines carry the k = 0 signature. */
  readonly magneticNeutron?: { readonly k0: boolean } | undefined;
  /** The Caglioti terms present are all free (diagnose_fit's `widthsFree`). */
  readonly widthsFree?: boolean;
  /** The method's stages a converged refinement has covered (agent/method.ts ids: base, positions, profile, adp, …). */
  readonly stagesDone: readonly string[];
}

const fmt = (v: number, digits = 2): string => (Number.isFinite(v) ? v.toFixed(digits) : "—");
const pct = (f: number): string => `${Math.round(100 * f)}%`;
/** η as diagnose_fit shows it, in [0, 1]. */
const eta = (v: number): string => Math.min(1, Math.max(0, v)).toFixed(2);

const STAGES = stagesFor("powder");
const kindsOf = (stage: string): readonly ParameterKind[] => STAGES.find((s) => s.id === stage)?.kinds ?? [];

/** A block of the method is done (a converged refinement covered it) or under way (its rows are free now). */
function inPlay(ctx: CauseContext, stage: string): boolean {
  if (ctx.stagesDone.includes(stage)) return true;
  const kinds = kindsOf(stage);
  return ctx.parameters.some((p) => kinds.includes(p.kind) && !p.fixed && !p.expression);
}

const has = (ctx: CauseContext, kinds: readonly ParameterKind[]): boolean => ctx.parameters.some((p) => kinds.includes(p.kind));
const isFree = (ctx: CauseContext, kinds: readonly ParameterKind[]): boolean => ctx.parameters.some((p) => kinds.includes(p.kind) && !p.fixed && !p.expression);

const ADP_KINDS: readonly ParameterKind[] = ["bIso", "uAniso"];
/** The instrument's peak-shape terms, which never refine with the B values (the method's alternation). */
const PROFILE_TERMS: readonly ParameterKind[] = ["peakWidth", "profileU", "profileV", "profileW", "profileX", "profileY", "asymSL", "asymHL", "tofProfile"];

/** Open a parameter group, when the page has rows in it. */
function openGroup(ctx: CauseContext, kind: ParameterKind): ActionButton[] {
  if (!has(ctx, [kind])) return [];
  const group = parameterGroupOf(kind);
  return [{ label: `Open ${group}`, title: `Open the ${group} group in the parameter panel (nothing is freed)`, action: { kind: "parameters", group } }];
}

/** The page's profile: back-to-back exponentials on time of flight, the Caglioti widths on constant wavelength. */
const tof = (ctx: CauseContext): boolean => has(ctx, ["tofProfile"]);

/** The TOF peak shape as the app models it: back-to-back exponentials on a Gaussian (assessment.ts: α from the calibration, held). */
const TOF_SHAPE = "the TOF peak shape: the widths σ and the decay β, with the rise α held at the instrument's value";

/** A profile cause's note on the method's order: the atom positions are a quick pass before the profile, unless the widths are far off. */
function afterPositions(ctx: CauseContext): string {
  return inPlay(ctx, "positions") ? "" : " After a quick pass on the atom positions (your method's order).";
}

/** An ADP step's note on the method's order: after the profile, and never with the profile terms free. */
function adpOrder(ctx: CauseContext): string {
  if (!inPlay(ctx, "profile")) return " — after the profile, in your method's order; alternate them with the profile terms, never both free";
  return isFree(ctx, PROFILE_TERMS) ? " — fix the profile terms first: the two groups alternate, never both free" : "";
}

function background(dx: FitDiagnosis, ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const between = dx.betweenPeaks;
  const reading = dx.backgroundTerms;
  const terms = ctx.backgroundTerms;
  const action = !reading
    ? "Refine the background alone; if it still misses, add terms or change its function (Background)."
    : reading.excess.length > 0 && reading.justified > terms
      ? "Lines the model lacks sit between the peaks as well: explain them first (see “Lines no phase explains”), then read the background again."
      : reading.justified <= terms
        ? `More terms are not justified (the points between the lines support ${reading.justified}; the page has ${terms}): try another function, or look for scattering the model lacks.`
        : `Use ${reading.justified} background terms instead of ${terms} (what the points between the lines support), then refine the background alone.`;
  return {
    title: "Background",
    phrase: "the background",
    evidence: "Between the peaks, where the model is background alone, it misses the data.",
    ...(between ? { statistic: `χ² ${fmt(between.chi2PerPoint, 1)} per point there, noise gives 1 · ${between.points} points` } : {}),
    action,
    buttons: openGroup(ctx, "background"),
  };
}

function unexplained(dx: FitDiagnosis, ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const ex = dx.unexplained ?? [];
  const list = ex.slice(0, 3).map((e) => e.d.toFixed(3)).join(", ") + (ex.length > 3 ? ", …" : "");
  const strongest = [...ex].sort((a, b) => b.significance - a.significance)[0];
  return {
    title: "Lines no phase explains",
    phrase: "lines no phase explains",
    evidence: `${ex.length === 1 ? "An excess" : `${ex.length} excesses`} between the lines that no phase explains, at d ${list} Å.`,
    ...(strongest ? { statistic: `the strongest ${fmt(strongest.significance, 0)}σ` } : {}),
    action: "Not background: another phase (an impurity, the sample environment) or magnetic order. Explain them before adding background terms, which would absorb them." +
      (ctx.magneticNeutron ? " On neutron data of magnetic ions, try the k-search of the magnetic analysis first." : ""),
    buttons: [
      ...(strongest ? [{ label: "Show on pattern", title: `Open the pattern at d = ${strongest.d.toFixed(3)} Å, the strongest excess`, action: { kind: "pattern", x: strongest.x } as const }] : []),
      ...(ctx.magneticNeutron ? [{ label: "Magnetic analysis", title: "Open the magnetic symmetry analysis (k-search) with the refined structure", action: { kind: "magnetic" } as const }] : []),
    ],
  };
}

function peakWidth(dx: FitDiagnosis, ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const w = dx.width!;
  const broader = w.median > 1;
  const trend = Math.abs(Math.log(w.high / w.low)) > Math.log(1.25);
  // The method: a profile far off comes before the positions, which would absorb the width misfit.
  const first = inPlay(ctx, "positions") ? "" : " Before the atom positions: atoms refined against lines this wrong absorb the misfit.";
  const action = tof(ctx)
    ? `Refine ${TOF_SHAPE}.${first}`
    : broader
      ? `The model's peaks are too narrow: free the Caglioti W, then U and V, with the scale and background${w.high > 1.25 * w.low ? "; the excess grows with angle, so U (and the Lorentzian Y, strain) matter most" : w.low > 1.25 * w.high ? "; the excess is largest at low angle — W and the Lorentzian X (size)" : ""}. Then X and Y if the tails are long.${first}`
      : `The model's peaks are too broad: free the Caglioti W, then U and V; hold the Lorentzian X and Y at the instrument's values.${first}`;
  return {
    title: "Peak widths",
    phrase: "the peak widths",
    evidence: `The observed peaks are ${fmt(w.median)}× ${broader ? "broader" : "narrower"} than the model's at half maximum.`,
    statistic: `${w.lines} isolated lines${trend ? ` · ${fmt(w.low)}× in the lower third, ${fmt(w.high)}× in the upper` : ""}`,
    action,
    buttons: openGroup(ctx, tof(ctx) ? "tofProfile" : "profileW"),
  };
}

function peakTails(dx: FitDiagnosis, ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const w = dx.width!;
  const more = (w.etaObs ?? 0) > (w.etaCalc ?? 0);
  const action = tof(ctx)
    ? `Refine ${TOF_SHAPE}.`
    : more
      ? "A Lorentzian part is missing: free X (size) and Y (strain) with the Caglioti terms; hold a negative X or Y at 0."
      : "The model's peaks are too Lorentzian: refine X and Y with the Caglioti terms, or hold them at the instrument's values.";
  return {
    title: "Peak tails",
    phrase: "the peak tails",
    evidence: tof(ctx)
      ? `The observed peaks have ${more ? "longer" : "shorter"} tails than the model's.`
      : `The observed peaks have ${more ? "longer" : "shorter"} tails than the model's: their shape is ${more ? "more" : "less"} Lorentzian.`,
    statistic: `η ${eta(w.etaObs ?? 0)} observed against ${eta(w.etaCalc ?? 0)} calculated · ${w.shapeLines ?? w.lines} isolated lines`,
    action: action + afterPositions(ctx),
    buttons: openGroup(ctx, tof(ctx) ? "tofProfile" : has(ctx, ["profileX"]) ? "profileX" : "profileW"),
  };
}

function peakPosition(cause: FitCause, ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const m = /on the (high|low)-x side.*\((\d+)% one-sided\)/.exec(cause.evidence);
  const axis = ctx.twoTheta ? "angle" : tof(ctx) ? "TOF" : "x";
  return {
    title: "Peak positions",
    phrase: "the peak positions",
    evidence: m ? `The observed peaks sit on the ${m[1]}-${axis} side of the model's, across the pattern.` : "The observed peaks sit to one side of the model's, across the pattern.",
    ...(m ? { statistic: `${m[2]}% one-sided` } : {}),
    action: tof(ctx)
      ? "A position error: refine the zero with the cell (the diffractometer constants stay the instrument's)."
      : "A position error: refine the zero with the cell (a constant shift), or, on flat-plate data, the sample displacement (Δ2θ ∝ cosθ) — not both with the zero.",
    buttons: openGroup(ctx, "zeroShift"),
  };
}

function asymmetry(cause: FitCause, ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const m = /^(\d+)% of the peak-shape misfit/.exec(cause.evidence);
  return {
    title: "Peak asymmetry",
    phrase: "the peak asymmetry",
    evidence: "The peak-shape misfit sits at low angle, on one side of the peaks: axial divergence.",
    ...(m ? { statistic: `${m[1]}% of it in the lowest third of the pattern` } : {}),
    action: "Switch on the asymmetry correction (Instrument / profile ▸ corrections) and refine S/L with the profile; H/L follows it." + afterPositions(ctx),
    buttons: openGroup(ctx, has(ctx, ["profileW"]) ? "profileW" : "zeroShift"),
  };
}

function peakShape(dx: FitDiagnosis, ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const ratio = dx.width?.median;
  const widthsSettled = !!ctx.widthsFree && ratio !== undefined && Math.abs(ratio - 1) <= WIDTHS_AGREE;
  if (widthsSettled) {
    return {
      title: "Peak shape",
      phrase: "the peak shape",
      evidence: "± misfits on both sides of the peaks across the pattern, with the widths already right.",
      statistic: `observed/calculated width ${fmt(ratio!, 3)}`,
      action: "What is left is a shape the profile does not follow. In the worst peaks: one-sided at low angle is asymmetry; some reflections broader than others is anisotropic broadening (Microstructure); misfits that change side from peak to peak are the profile function's limit — then read the esds as optimistic rather than add parameters.",
      buttons: [{ label: "Worst peaks", title: "Open the worst peaks below", action: { kind: "evidence", section: "worst" } }],
    };
  }
  return {
    title: "Peak shape",
    phrase: "the peak shape",
    evidence: "± misfits on both sides of the peaks, across the pattern: a width or shape mismatch.",
    action: (tof(ctx)
      ? `Refine ${TOF_SHAPE}.`
      : "Free the Caglioti U, V, W together, then the Lorentzian X (size) and Y (strain); anisotropic broadening (Microstructure) if some reflections are broader than others.") + afterPositions(ctx),
    buttons: openGroup(ctx, tof(ctx) ? "tofProfile" : "profileW"),
  };
}

/** The k = 0 magnetic signature's caution, before any ADP or structure advice (fitDiagnosis.ts K0_DIAGNOSIS). */
const K0_FIRST = "First rule out k = 0 magnetic order (Magnetic analysis): its intensity sits on the nuclear lines at large d, and B values or positions refined now would take it up. If the sample is not ordered: ";

function intensityFalloff(dx: FitDiagnosis, ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const wl = dx.wilson!;
  const tooStrong = wl.deltaB > 0;
  const adpsFree = isFree(ctx, ADP_KINDS);
  const k0 = !!ctx.magneticNeutron?.k0;
  const action = adpsFree
    ? "The B values are free already: a missing absorption (μR) or surface-roughness correction is more likely (Instrument / profile ▸ corrections), or a Lorentz–polarization that does not fit the data."
    : `Free the B values${adpOrder(ctx)}.`;
  return {
    title: "Intensity fall-off",
    phrase: "the fall-off of intensity with angle",
    evidence: `Reflections at short d are calculated ${tooStrong ? "too strong" : "too weak"}: as if the B values were ${tooStrong ? "too small" : "too large"} by ${fmt(Math.abs(wl.deltaB))} Å².`,
    statistic: `ln(I_obs/I_calc) against sin²θ/λ² · r ${fmt(wl.r)} · ${wl.n} reflections`,
    action: (k0 ? K0_FIRST : "") + action,
    buttons: [
      ...(adpsFree ? openGroup(ctx, has(ctx, ["profileW"]) ? "profileW" : "zeroShift") : openGroup(ctx, has(ctx, ["bIso"]) ? "bIso" : "uAniso")),
      ...(k0 ? [{ label: "Magnetic analysis", title: "Open the magnetic symmetry analysis (k = 0 check) with the refined structure", action: { kind: "magnetic" } as const }] : []),
    ],
  };
}

function texture(dx: FitDiagnosis, ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const t = dx.texture!;
  const axis = t.axis.join(" ");
  return {
    title: "Preferred orientation",
    phrase: "preferred orientation",
    evidence: `Reflections near [${axis}] are ${t.enhancedAlongAxis ? "stronger" : "weaker"} than calculated: the crystallites are not randomly oriented.`,
    statistic: `March–Dollase r ≈ ${fmt(t.ratio)} explains ${pct(t.explained)} of the intensity misfit · chance ${t.chance < 0.005 ? "< 0.5%" : `${fmt(100 * t.chance, 1)}%`}`,
    action: `Add March–Dollase along ${axis} (Instrument / profile ▸ texture) and refine its ratio — after the structure, and only if the sample can be textured (a capillary rarely is).`,
    buttons: openGroup(ctx, has(ctx, ["profileW"]) ? "profileW" : "zeroShift"),
  };
}

function structure(ctx: CauseContext): Omit<CauseRow, "id" | "share" | "detail"> {
  const k0 = !!ctx.magneticNeutron?.k0;
  // The next block of the method that the atoms' intensities depend on: positions, the profile, the B values; occupancy last, and only under a tie.
  const next = !inPlay(ctx, "positions") ? "positions" : !inPlay(ctx, "profile") ? "profile" : !inPlay(ctx, "adp") ? "adp" : "occupancy";
  const step = {
    positions: { text: "Free the atom positions: a quick pass, before the profile (your method's order).", group: "positionShift" as ParameterKind, alt: ["atomX", "atomY", "atomZ"] as ParameterKind[] },
    profile: { text: "The profile comes next in your method, then the B values: an intensity misfit is the atoms', but refined against an unsettled profile the B values absorb it.", group: (tof(ctx) ? "tofProfile" : "profileW") as ParameterKind, alt: [] as ParameterKind[] },
    adp: { text: `Free the B values${adpOrder(ctx)}; anisotropic only if the data clearly support it.`, group: "bIso" as ParameterKind, alt: ["uAniso"] as ParameterKind[] },
    occupancy: { text: "Positions and B values are refined: occupancy is last, and only under a tie (Σ = 1 on a shared site, a known composition) or with a second contrast. Check the bond lengths after.", group: "occupancy" as ParameterKind, alt: [] as ParameterKind[] },
  }[next];
  const kind = [step.group, ...step.alt].find((k) => has(ctx, [k]));
  return {
    title: "Reflection intensities",
    phrase: "the reflection intensities",
    evidence: "Reflections calculated too strong or too weak, with no trend in angle or direction: the atoms.",
    action: (k0 ? K0_FIRST : "") + step.text,
    buttons: [
      ...(kind ? openGroup(ctx, kind) : []),
      ...(k0 ? [{ label: "Magnetic analysis", title: "Open the magnetic symmetry analysis (k = 0 check) with the refined structure", action: { kind: "magnetic" } as const }] : []),
    ],
  };
}

/** One cause as the view shows it. */
export function causeRow(cause: FitCause, dx: FitDiagnosis, ctx: CauseContext): CauseRow {
  const body = ((): Omit<CauseRow, "id" | "share" | "detail"> => {
    switch (cause.id) {
      case "background": return background(dx, ctx);
      case "unexplained-peak": return unexplained(dx, ctx);
      case "peak-width": return peakWidth(dx, ctx);
      case "peak-tails": return peakTails(dx, ctx);
      case "peak-position": return peakPosition(cause, ctx);
      case "asymmetry": return asymmetry(cause, ctx);
      case "peak-shape": return peakShape(dx, ctx);
      case "intensity-falloff": return intensityFalloff(dx, ctx);
      case "texture": return texture(dx, ctx);
      case "structure": return structure(ctx);
    }
  })();
  return { id: cause.id, share: cause.share, detail: cause.evidence, ...body };
}

/** Causes a later block of the method fixes: the profile, the atoms, the corrections. */
const LATER_BLOCKS: ReadonlySet<CauseId> = new Set<CauseId>(["peak-width", "peak-tails", "peak-shape", "asymmetry", "intensity-falloff", "texture", "structure"]);

/**
 * The causes diagnose_fit found, in its order (the largest share of χ²
 * first), as the view shows them. A misfit of the method's first block (the
 * peak positions: cell and zero; the background) is fixed before the rest is
 * read: while one is listed, every later block's advice says so first. The
 * shares can overlap (a position misfit sits under the lines too), so a large
 * later share does not move the first block down the method.
 */
/** The cause a headline names: a misfit of the method's first block when one is listed, else the largest. */
export function headlineCause(rows: readonly CauseRow[]): { phrase: string; share: number; first: boolean } | undefined {
  const base = rows.find((r) => r.id === "peak-position" || r.id === "background");
  const top = rows[0];
  if (base && base !== top) return { phrase: base.phrase, share: base.share, first: true };
  return top ? { phrase: top.phrase, share: top.share, first: false } : undefined;
}

export function causeRows(dx: FitDiagnosis, ctx: CauseContext): CauseRow[] {
  const rows = dx.causes.map((c) => causeRow(c, dx, ctx));
  const base = rows.find((r) => r.id === "peak-position" || r.id === "background");
  if (!base) return rows;
  const first = `Fix ${base.phrase} first: your method refines the cell, zero and background before the rest. `;
  return rows.map((r) => (LATER_BLOCKS.has(r.id) ? { ...r, action: first + r.action } : r));
}

/**
 * Where the misfit sits, in one factual line: how much of χ² the worst
 * reflections carry, and the fewest points from either end of d (the
 * equal-count shells) that hold half of it. A misfit spread over many peaks
 * and concentrated at short d reads differently from a few bad peaks.
 */
export function whereSummary(validation: PowderValidation, worst: readonly ReflectionMisfit[]): string | null {
  const parts: string[] = [];
  if (worst.length > 0) {
    const share = worst.reduce((a, w) => a + w.share, 0);
    parts.push(`the ${worst.length} worst reflections carry ${pct(share)} of χ²`);
  }
  const shells = validation.shells;
  const n = shells.reduce((a, s) => a + s.n, 0);
  if (validation.shellAxis === "d" && shells.length >= 4 && n > 0) {
    const half = (ordered: typeof shells): { k: number; points: number } => {
      let share = 0, points = 0, k = 0;
      for (const s of ordered) {
        share += s.share;
        points += s.n;
        k++;
        if (share >= 0.5) break;
      }
      return { k, points };
    };
    const short = half(shells);
    const long = half([...shells].reverse());
    const fromShort = short.points <= long.points;
    const edge = fromShort ? shells[short.k - 1]!.hi : shells[shells.length - long.k]!.lo;
    const points = fromShort ? short.points : long.points;
    parts.push(`half of χ² comes from the ${pct(points / n)} of points at d ${fromShort ? "<" : ">"} ${edge.toFixed(2)} Å`);
  }
  if (parts.length === 0) return null;
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
