/**
 * The powder Validation view's verdict, in the terms of the user's method
 * (.claude/skills/my-rietveld-workflow, "When it's done — the acceptance
 * bar"): the state of the fit being judged, one line that says where it
 * stands, and the bar as three checks, each green, amber or red with one
 * plain sentence.
 *
 *  1. Goodness of fit, in the assessment's bands (GOF_BANDS, Toby 2006): good
 *     or excellent meets the bar; fair and poor do not; below 0.8 the esds are
 *     optimistic.
 *  2. Physical sanity: the assessment's physical and at-bound findings (with
 *     a current result, assess_refinement's own), else the checks of the
 *     values on screen (physicalFindings, structureChecks), scaled. A finding
 *     the assessment calls critical is a blocker; a warning is to check; a
 *     held occupancy within 1 % outside [0, 1] (OCCUPANCY_FULL) is an input to
 *     correct, a note rather than a fault of the fit.
 *  3. The external cross-check in GSAS-II and FullProf, which the app cannot
 *     run: due once the first two pass, with why the esds may not hold (serial
 *     correlation, a value on its bound, a correlated pair: the Posterior).
 *
 * Pure: the view renders it and the tests read it. No threshold here is new:
 * each comes from thresholds.ts, as the assessment and the Agent use it.
 */

import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { StructureModel } from "@/core/crystal/types";
import { physicalFindings, type AssessmentFinding, type RefinementAssessment } from "@/core/diagnostics/assessment";
import { structureChecks } from "@/core/diagnostics/structureChecks";
import type { DurbinWatson } from "@/core/diagnostics/powderValidation";
import { parametersChangedSince, type CheckAction } from "@/core/diagnostics/validationChecks";
import { GOF_BANDS, OCCUPANCY_FULL, SHIFT_SETTLED } from "@/core/diagnostics/thresholds";

/** What a check or the verdict shows: met, worth attention, a blocker, or context. */
export type Tone = "green" | "amber" | "red" | "grey";

export type GofBand = "too-good" | "excellent" | "good" | "fair" | "poor";

/** The assessment's band for a powder GoF (assessment.ts verdictFrom); null without a GoF. */
export function gofBand(gof: number): GofBand | null {
  if (!(gof > 0) || !Number.isFinite(gof)) return null;
  if (gof < GOF_BANDS.tooGood) return "too-good";
  if (gof <= GOF_BANDS.excellent) return "excellent";
  if (gof <= GOF_BANDS.good) return "good";
  if (gof <= GOF_BANDS.fair) return "fair";
  return "poor";
}

const fmt = (v: number, digits = 2): string => (Number.isFinite(v) ? v.toFixed(digits) : "—");
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// ── the fit being judged ───────────────────────────────────────────────────

export type FitStateKind = "none" | "changed" | "snapshot" | "edited" | "converged" | "settling" | "moving" | "stopped" | "diverged";

export interface FitState {
  readonly kind: FitStateKind;
  readonly tone: Tone;
  /** One sentence: where the fit on screen comes from, and what to do next if anything. */
  readonly text: string;
  /** Refining is the next step (the view offers Refine). */
  readonly refine: boolean;
  /** A refinement result describes the values on screen: its esds, correlations and bounds can be read. */
  readonly current: boolean;
}

/** Two values of a parameter the same (a snapshot's own, read back). */
const same = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Where the fit on screen comes from. With a result: whether it converged and
 * settled (shift/esd below SHIFT_SETTLED), or the values were edited since.
 * Without one: a converged snapshot the page opened on (a demo), a model
 * changed since its last refinement, or nothing refined yet — each with what
 * to do, never a stale "not refined".
 */
export function fitState(result: RefinementResult | null, parameters: readonly RefinementParameter[], snapshot = false): FitState {
  if (result) {
    if (result.status === "diverged") {
      return { kind: "diverged", tone: "red", text: "The last refinement diverged: its values and esds mean nothing. Go back a step (History), or refine fewer parameters at once.", refine: false, current: false };
    }
    if (parametersChangedSince(result, parameters)) {
      return { kind: "edited", tone: "grey", text: "Values edited since the last refinement: refine again before quoting values or esds.", refine: true, current: false };
    }
    if (result.status !== "converged") {
      return { kind: "stopped", tone: "amber", text: `The last refinement stopped (${result.status}) before it converged: the values are provisional — refine again.`, refine: true, current: true };
    }
    const shift = result.diagnostics?.maxShiftOverEsd ?? 0;
    const id = result.diagnostics?.maxShiftParameterId;
    const who = id ? ` (${parameters.find((p) => p.id === id)?.label ?? id})` : "";
    const cycles = plural(result.history.length, "cycle");
    if (shift > 1) {
      return { kind: "moving", tone: "amber", text: `Still moving: the last cycle shifted a parameter by ${fmt(shift)} esd${who}. Refine more cycles; the values are not the minimum yet.`, refine: true, current: true };
    }
    if (shift > SHIFT_SETTLED) {
      return { kind: "settling", tone: "grey", text: `Nearly settled: the last cycle shifted a parameter by ${fmt(shift)} esd${who}; settled is below ${SHIFT_SETTLED}. Refine a few more cycles.`, refine: true, current: true };
    }
    return { kind: "converged", tone: "green", text: `Converged in ${cycles}: the last moved no parameter by more than ${fmt(shift, shift < 0.01 ? 3 : 2)} esd.`, refine: false, current: true };
  }
  if (snapshot) {
    return { kind: "snapshot", tone: "grey", text: "Opened on a converged fit, which carries no esds or correlations: refine once to get them.", refine: true, current: false };
  }
  if (parameters.some((p) => !p.expression && !same(p.value, p.initialValue))) {
    return { kind: "changed", tone: "grey", text: "The model changed since its last refinement: refine to bring the values, esds and correlations up to date.", refine: true, current: false };
  }
  return { kind: "none", tone: "grey", text: "Not refined yet. Your method starts with the scale, background and cell: free them in the parameter panel, then refine.", refine: true, current: false };
}

// ── physical sanity ────────────────────────────────────────────────────────

export type PhysicalSeverity = "blocker" | "issue" | "note";

export interface PhysicalItem {
  readonly severity: PhysicalSeverity;
  readonly text: string;
  /** The assessment's account: what it usually means and what to do. */
  readonly detail?: string;
  readonly parameterIds: readonly string[];
}

const SEVERITY_ORDER: Record<PhysicalSeverity, number> = { blocker: 0, issue: 1, note: 2 };

/**
 * A held occupancy outside [0, 1] by no more than the 1 % that counts a site
 * as full (OCCUPANCY_FULL): a value the starting structure brought (a CIF's
 * rounding), which the fit never moved. A note to correct, not a fault of the
 * fit. Null for anything else.
 */
function heldOccupancyNote(f: AssessmentFinding, byId: ReadonlyMap<string, RefinementParameter>): string | null {
  if (f.category !== "physical" || f.evidence?.origin !== "input") return null;
  const p = byId.get(f.parameterIds?.[0] ?? "");
  if (!p || p.kind !== "occupancy") return null;
  const off = p.value > 1 ? p.value - 1 : p.value < 0 ? -p.value : 0;
  if (!(off > 0) || off > 1 - OCCUPANCY_FULL + 1e-9) return null;
  const edge = p.value > 1 ? 1 : 0;
  const by = 100 * off;
  return `${p.label} is held at ${p.value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} (${by < 0.1 ? by.toFixed(2) : by.toFixed(1)}% ${edge === 1 ? "over 1" : "below 0"}): an input the fit never moved — set it to ${edge}.`;
}

/** One finding as the check lists it: the assessment's severity, a held occupancy just outside its range scaled to a note. */
function itemOf(f: AssessmentFinding, byId: ReadonlyMap<string, RefinementParameter>): PhysicalItem {
  const ids = f.parameterIds ?? [];
  const detail = f.detail ? { detail: f.detail } : {};
  if (f.severity === "critical") return { severity: "blocker", text: f.summary, ...detail, parameterIds: ids };
  const held = heldOccupancyNote(f, byId);
  if (held) return { severity: "note", text: held, ...detail, parameterIds: ids };
  return { severity: f.severity === "warning" ? "issue" : "note", text: f.summary, ...detail, parameterIds: ids };
}

export interface PhysicalInput {
  readonly result: RefinementResult | null;
  readonly parameters: readonly RefinementParameter[];
  /** Every phase with the current values applied (primary first): the checks after every run read them. */
  readonly structures: readonly StructureModel[];
  /** assess_refinement's reading of the fit on screen, when a result describes it. */
  readonly assessment?: RefinementAssessment | null;
}

/**
 * The physical findings of the fit on screen, scaled, blockers first. With a
 * current result, the assessment's own physical and at-bound findings (what
 * assess_refinement gives the Agent); otherwise the checks of the values
 * alone (what refine's checks give it): a bound is read only off a result
 * that still describes the values.
 */
export function physicalItems(input: PhysicalInput): PhysicalItem[] {
  const { result, parameters, structures } = input;
  const current = result !== null && !parametersChangedSince(result, parameters);
  const findings = current && input.assessment
    ? input.assessment.findings.filter((f) => f.category === "physical" || f.category === "at-bound")
    : [...physicalFindings(parameters), ...structures.flatMap((m) => structureChecks(m, structures.length > 1 ? m.name || m.id : undefined))];
  const byId = new Map(parameters.map((p) => [p.id, p]));
  return findings.map((f) => itemOf(f, byId)).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// ── the three checks ───────────────────────────────────────────────────────

export type AcceptanceCheckId = "gof" | "physical" | "cross-check";

/** Why the esds may not hold, for the cross-check: each with whether sampling the posterior is the way to judge it. */
export interface EsdNote {
  readonly text: string;
  readonly posterior: boolean;
}

export interface AcceptanceCheck {
  readonly id: AcceptanceCheckId;
  readonly label: string;
  readonly tone: Tone;
  /** The value or count beside the label ("GoF 3.05 · fair", "1 note", "To do"). */
  readonly value: string;
  /** One plain sentence. */
  readonly sentence: string;
  /** Physical sanity: the findings, scaled. */
  readonly items?: readonly PhysicalItem[];
  /** Cross-check: why the esds may not hold. */
  readonly esd?: readonly EsdNote[];
  readonly actions?: readonly CheckAction[];
}

const BAND_WORD: Record<GofBand, string> = { "too-good": "too good", excellent: "excellent", good: "good", fair: "fair", poor: "poor" };

function goodnessCheck(gof: number, band: GofBand | null): AcceptanceCheck {
  const base = { id: "gof" as const, label: "Goodness of fit" };
  if (band === null) return { ...base, tone: "grey", value: "GoF —", sentence: "No fitted points to judge." };
  const value = `GoF ${fmt(gof)} · ${BAND_WORD[band]}`;
  switch (band) {
    case "excellent":
      return { ...base, tone: "green", value, sentence: "Close to the noise: the model explains the data within their uncertainties." };
    case "good":
      return { ...base, tone: "green", value, sentence: `Within your bar (good is up to ${GOF_BANDS.good}); some systematic misfit remains.` };
    case "fair":
      return { ...base, tone: "amber", value, sentence: `Above your bar (good is up to ${GOF_BANDS.good}): the model misses systematic features.` };
    case "poor":
      return { ...base, tone: "red", value, sentence: "Far from the data: fix the largest cause of misfit before trusting any value." };
    case "too-good":
      return { ...base, tone: "amber", value, sentence: `Below ${GOF_BANDS.tooGood}: the σ's are overestimated or the model has more parameters than the data support, so the esds are optimistic.` };
  }
}

function physicalCheck(items: readonly PhysicalItem[], current: boolean): AcceptanceCheck {
  const count = (s: PhysicalSeverity): number => items.filter((i) => i.severity === s).length;
  const [blockers, issues, notes] = [count("blocker"), count("issue"), count("note")];
  const noteText = notes > 0 ? ` · ${plural(notes, "note")}` : "";
  const base = { id: "physical" as const, label: "Physical sanity", items };
  if (blockers > 0) {
    return { ...base, tone: "red", value: `${blockers} to fix${issues > 0 ? `, ${issues} to check` : ""}${noteText}`, sentence: "Your bar treats these as blockers: fix them before reading anything else into the fit." };
  }
  if (issues > 0) {
    return { ...base, tone: "amber", value: `${issues} to check${noteText}`, sentence: "Unusual values: each can be right, but check it before quoting the result." };
  }
  return {
    ...base, tone: "green", value: `Nothing unphysical${noteText}`,
    sentence: notes > 0
      ? "Nothing the fit made unphysical."
      : `B values positive, occupancies in [0, 1], distances and U values within the limits${current ? ", nothing at a bound" : "; bounds are read after a refinement"}.`,
  };
}

/** Labels of parameters by id, as the panel shows them. */
function labels(ids: readonly string[], parameters: readonly RefinementParameter[]): string {
  const names = ids.map((id) => parameters.find((p) => p.id === id)?.label ?? id);
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} …` : names.join(", ");
}

interface CrossCheckInput {
  readonly passes: boolean;
  readonly state: FitState;
  readonly gof: number;
  readonly band: GofBand | null;
  readonly durbinWatson?: DurbinWatson | undefined;
  readonly assessment?: RefinementAssessment | null | undefined;
  readonly parameters: readonly RefinementParameter[];
  readonly canExport: boolean;
}

function crossCheck(input: CrossCheckInput): AcceptanceCheck {
  const { state, band, durbinWatson: dw } = input;
  const esd: EsdNote[] = [];
  if (!state.current) {
    esd.push({ text: state.kind === "snapshot" ? "No esds yet: the opened fit carries none." : "No esds yet: refine to get them.", posterior: false });
  } else {
    // Serially correlated residuals, or a model that leaves systematic misfit: the esds understate the uncertainty (the method's stopping rule).
    const why = [
      dw?.correlated ? `neighbouring points miss together (Durbin–Watson ${fmt(dw.d)}, below ${fmt(dw.qd)})` : null,
      band === "fair" || band === "poor" ? `the model leaves systematic misfit (GoF ${fmt(input.gof)})` : null,
    ].filter((w): w is string => w !== null);
    if (why.length > 0) esd.push({ text: `The esds are likely too small: ${why.join(", and ")}.`, posterior: false });
    const findings = input.assessment?.findings ?? [];
    const bound = findings.filter((f) => f.category === "at-bound" && (f.severity === "critical" || f.severity === "warning")).flatMap((f) => f.parameterIds ?? []);
    if (bound.length > 0) esd.push({ text: `A value on its bound has no meaningful esd: ${labels(bound, input.parameters)}. Sample the posterior before quoting it.`, posterior: true });
    // The pairs the Agent's guard would not refine together (the assessment's warnings), not the expected ones (one curve's terms, a restraint's pair).
    for (const f of findings.filter((x) => x.category === "correlation" && x.severity === "warning").slice(0, 2)) {
      esd.push({ text: `${f.summary.replace(/\.$/, "")}: their esds are inflated. Fix one, or sample the posterior.`, posterior: true });
    }
    const conditioning = findings.find((f) => f.category === "conditioning");
    if (conditioning) {
      esd.push({ text: `The data cannot separate ${labels(conditioning.parameterIds ?? [], input.parameters) || "some parameters"}: fix or tie one; their esds mean nothing.`, posterior: false });
    }
    // Pairs from 0.8 up to the refusal limit: refined, and reported, never silent (the user's rule).
    const moderate = findings.find((f) => f.category === "correlation" && f.severity === "note" && f.evidence?.pairs !== undefined);
    if (moderate) esd.push({ text: moderate.summary, posterior: false });
  }
  const posterior = esd.some((e) => e.posterior);
  const actions: CheckAction[] = [...(input.canExport ? ["export-gsas2", "export-fullprof"] as const : []), ...(posterior ? ["posterior"] as const : [])];
  return {
    id: "cross-check",
    label: "Cross-check",
    tone: input.passes ? "amber" : "grey",
    value: input.passes ? "To do" : "Not yet",
    sentence: input.passes
      ? "The step left: refine the same model in GSAS-II and FullProf; done when both give each value within 2 combined esds."
      : "Once the fit meets the bar: refine the same model in GSAS-II and FullProf, and compare the values and esds.",
    ...(esd.length > 0 ? { esd } : {}),
    ...(actions.length > 0 ? { actions } : {}),
  };
}

// ── the verdict ────────────────────────────────────────────────────────────

export interface AcceptanceInput {
  /** The GoF the page shows: the last refinement's, else that of the curves on screen. */
  readonly gof: number;
  readonly durbinWatson?: DurbinWatson | undefined;
  readonly result: RefinementResult | null;
  readonly parameters: readonly RefinementParameter[];
  /** Every phase with the current values applied (primary first). */
  readonly structures: readonly StructureModel[];
  /** assess_refinement's reading, when a result describes the values on screen. */
  readonly assessment?: RefinementAssessment | null | undefined;
  /** The page shows a converged snapshot it opened on (a demo), not a refinement of its own. */
  readonly snapshot?: boolean;
  /** The largest cause of misfit, as the view names it ("the peak tails"), and its share of χ². */
  readonly topCause?: { readonly phrase: string; readonly share: number } | undefined;
  /** Offer the cross-check bundles. */
  readonly canExport?: boolean;
}

export interface Acceptance {
  readonly tone: Tone;
  /** One line: where the fit stands against the bar. */
  readonly headline: string;
  readonly state: FitState;
  readonly band: GofBand | null;
  /** The bar's first two checks pass on a converged fit: the cross-check is the step left. */
  readonly passes: boolean;
  readonly checks: readonly [AcceptanceCheck, AcceptanceCheck, AcceptanceCheck];
}

export function powderAcceptance(input: AcceptanceInput): Acceptance {
  const state = fitState(input.result, input.parameters, input.snapshot ?? false);
  const band = gofBand(input.gof);
  const items = physicalItems({ result: input.result, parameters: input.parameters, structures: input.structures, assessment: input.assessment ?? null });
  const gof = goodnessCheck(input.gof, band);
  const physical = physicalCheck(items, state.current);
  const passes = state.kind === "converged" && (band === "excellent" || band === "good") && physical.tone === "green";
  const cross = crossCheck({ passes, state, gof: input.gof, band, durbinWatson: input.durbinWatson, assessment: input.assessment, parameters: input.parameters, canExport: input.canExport ?? false });
  const g = `GoF ${fmt(input.gof)}`;
  const cause = input.topCause ? ` — ${input.topCause.share >= 0.5 ? "most of the misfit is in" : "the largest part of the misfit is"} ${input.topCause.phrase}` : "";
  const blockers = items.filter((i) => i.severity === "blocker").length;
  const issues = items.filter((i) => i.severity === "issue").length;
  const verdict = ((): { tone: Tone; headline: string } => {
    if (state.kind === "diverged") return { tone: "red", headline: "The refinement diverged: its values are not meaningful." };
    if (state.kind === "none") return { tone: "grey", headline: "Not refined yet." };
    if (blockers > 0) return { tone: "red", headline: `Not acceptable: ${plural(blockers, "physical problem")} to fix first.` };
    switch (band) {
      case null: return { tone: "grey", headline: "No fitted points to judge." };
      case "poor": return { tone: "red", headline: `Poor fit (${g}): far from the data${cause}.` };
      case "fair": return { tone: "amber", headline: `Fair fit (${g}): not yet acceptable${cause}.` };
      case "too-good": return { tone: "amber", headline: `${g} is below ${GOF_BANDS.tooGood}: the fit is too good, and the esds optimistic.` };
      default: break;
    }
    const word = band === "excellent" ? "Excellent" : "Good";
    if (issues > 0) return { tone: "amber", headline: `${word} fit (${g}), with ${plural(issues, "value")} to check.` };
    if (passes) return { tone: "green", headline: `${word} fit (${g}) and physically sane: cross-check it in GSAS-II and FullProf.` };
    return { tone: "grey", headline: `${word} fit (${g}): ${state.kind === "snapshot" ? "refine once to confirm it and get its esds" : "refine until it settles before you quote it"}.` };
  })();
  return { ...verdict, state, band, passes, checks: [gof, physical, cross] };
}
