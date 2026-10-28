/**
 * The report's judgment of the result, in the app's own terms: the Result
 * paragraph (what was refined against what, the outcome with its key
 * numbers, the verdict against the acceptance bar, the main limitation) and
 * the one-line caveats under "Quality and caveats".
 *
 * Nothing here judges anew. Each sentence restates a reading the app already
 * made and shows elsewhere: on a powder the Validation tab's verdict
 * (powderAcceptance.ts: the fit state, the GoF band, the physical findings,
 * the cross-check and why the esds may not hold) and its causes of misfit
 * (diagnose_fit, as fitCauses.ts names them); on a single crystal the
 * Validation view's checks (validationChecks.ts singleCrystalChecks); on a
 * PDF the assessment's findings (assessment.ts, mode "pdf"). Every threshold
 * is thresholds.ts's. Every number is one those readings computed. The
 * cross-check names the technique's own programs, as the page banner does
 * (crossCheck.ts): GSAS-II and FullProf for a powder, PDFgui / diffpy-CMI
 * (PDFfit2) and diffpy.mpdf for a PDF, SHELXL, JANA2020 or FullProf for a
 * single crystal.
 *
 * Symbols are marked {{R_wp}} for the renderers to typeset (reportTypeset.ts
 * symbolHtml / symbolText); nothing else in the text is markup.
 */

import type { LinearRestraint, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { Acceptance, Tone } from "@/core/diagnostics/powderAcceptance";
import type { ValidationVerdict, CheckStatus } from "@/core/diagnostics/validationChecks";
import type { RefinementAssessment } from "@/core/diagnostics/assessment";
import { readCorrelations } from "@/core/diagnostics/correlationGuard";
import { oneCurve } from "@/core/diagnostics/assessment";
import { findingLine } from "@/core/diagnostics/findingLines";
import { CAUTION_SHORT } from "@/core/diagnostics/zeroAdpLines";
import { CORRELATION_LIMIT, GOF_BANDS } from "@/core/diagnostics/thresholds";
import { CROSS_CHECK } from "@/core/export/crossCheck";

/** How a caveat reads: met, worth a note, needing attention, a blocker, or context. */
export type ReportTone = "ok" | "note" | "warn" | "bad" | "info";

/** One line under "Quality and caveats": a short label and what it says. */
export interface ReportCaveat {
  readonly tone: ReportTone;
  readonly label: string;
  /** One short line. */
  readonly text: string;
  /** The longer account behind it (a finding's own words): a tooltip on screen, and the appendix's "Caveats in full". */
  readonly detail?: string;
}

/** The report's judgment of the fit: the template Result paragraph and the caveats. */
export interface ReportAssessment {
  /** The Result paragraph, engine-written: shown where the Agent wrote no account. */
  readonly result: string;
  readonly caveats: readonly ReportCaveat[];
}

const TONE: Record<Tone, ReportTone> = { green: "ok", amber: "warn", red: "bad", grey: "info" };

const pct = (v: number, d = 2): string => `${(100 * v).toFixed(d)} %`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const lowerFirst = (s: string): string => (s && !/^[A-Z]{2}|^[A-Z][a-z]*\d/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = (s: string): string => {
  const t = s.trim().replace(/[.;:,]+$/, "");
  return t ? `${upperFirst(t)}.` : "";
};
/** The app's short lines speak to the user ("your bar"); the report speaks of the method. */
const reportVoice = (s: string): string => s.replace(/\byour bar\b/g, "the acceptance bar").replace(/\byour method\b/g, "the method");
/** An action the Validation tab offers after a finding ("→ set to 1"): not a result. */
const withoutAction = (s: string): string => s.replace(/\s*→[\s\u00a0].*$/, "");
/** A first sentence. */
const firstSentence = (s: string): string => s.split(/(?<=\.)\s/)[0] ?? s;

/** A parameter's label as a sentence names it: "Mn3Ga: Ga1 occ" → "the Mn3Ga Ga1 occupancy". */
export function parameterPhrase(label: string): string {
  return label.replace(/:\s+/, " ").replace(/\bocc\b/, "occupancy");
}

// ---------------------------------------------------------------------------
// Correlations

/** A strong pair the report names: not one curve's coefficients, not a restraint's or a sum tie's pair. */
export interface ReportCorrelation {
  readonly a: string;
  readonly b: string;
  readonly coefficient: number;
}

/**
 * The correlations worth reading: the refinement's strong pairs (|ρ| at the
 * limit or over, CORRELATION_LIMIT) less the ones that say nothing about the
 * structure — the terms of one curve (the background coefficients, the
 * Caglioti U, V, W) and two rows a restraint or a sum tie moves together —
 * filtered as the Validation tab and the Agent's guard filter them
 * (correlationGuard.ts readCorrelations, assessment.ts oneCurve). Strongest
 * first, by label. `curveOnly` says some strong pair was left out as one curve's.
 */
export function meaningfulCorrelations(result: RefinementResult, parameters: readonly RefinementParameter[], restraints: readonly LinearRestraint[] = []): { readonly pairs: readonly ReportCorrelation[]; readonly curveOnly: boolean } {
  const read = readCorrelations(result, parameters, restraints);
  const label = new Map(parameters.map((p) => [p.id, p.label]));
  const kind = new Map(parameters.map((p) => [p.id, p.kind]));
  const pairs = [...read.correlated, ...read.carried]
    .sort((x, y) => Math.abs(y.coefficient) - Math.abs(x.coefficient))
    .map((p) => ({ a: label.get(p.a) ?? p.a, b: label.get(p.b) ?? p.b, coefficient: p.coefficient }));
  const curveOnly = (result.diagnostics?.highCorrelations ?? []).some((c) => oneCurve(kind.get(c.parameterIdA), kind.get(c.parameterIdB)) !== null);
  return { pairs, curveOnly };
}

/** The correlations as caveats: each named pair, or that none is strong. */
export function correlationCaveats(c: ReturnType<typeof meaningfulCorrelations>): ReportCaveat[] {
  if (c.pairs.length === 0) {
    return [{ tone: "ok", label: "Correlations", text: `none at |ρ| ≥ ${CORRELATION_LIMIT}${c.curveOnly ? " (the background coefficients among themselves aside)" : ""}` }];
  }
  const shown = c.pairs.slice(0, 3).map((p) => `${p.a} ↔ ${p.b} ${p.coefficient.toFixed(3)}`).join("; ");
  return [{ tone: "warn", label: "Correlations", text: `${shown}${c.pairs.length > 3 ? `; ${c.pairs.length - 3} more in the appendix` : ""} (|ρ| ≥ ${CORRELATION_LIMIT}: esds inflated)` }];
}

// ---------------------------------------------------------------------------
// The outcome: where the fit on screen comes from

export interface OutcomeFacts {
  /** The fit state (powderAcceptance fitState, or the same kinds read off a result). */
  readonly state: Acceptance["state"]["kind"];
  /** The agreement of the curves shown, as a sentence gives it: "{{R_wp}} = 4.01 % ({{R_exp}} = 1.31 %, GoF = 3.05)". */
  readonly agreement: string;
  readonly cycles?: number;
  /** Largest shift/esd of the last cycle, and whose. */
  readonly shift?: number;
  readonly shiftOf?: string;
  /** Why a refinement stopped short: the engine's status. */
  readonly status?: RefinementResult["status"];
}

/** The second sentence: whether the fit converged, and its agreement. */
export function outcomeSentence(f: OutcomeFacts): string {
  const shift = f.shift !== undefined ? `last shift ${f.shift.toFixed(2)} esd${f.shiftOf ? `, on ${parameterPhrase(f.shiftOf)}` : ""}` : "";
  switch (f.state) {
    case "converged": return `It converged${f.cycles ? ` in ${plural(f.cycles, "cycle")}` : ""} at ${f.agreement}.`;
    case "settling": return `It has nearly settled${shift ? ` (${shift})` : ""} at ${f.agreement}.`;
    case "moving": return `It is still moving${shift ? ` (${shift})` : ""} at ${f.agreement}: the values are not yet at the minimum.`;
    case "stopped": return `It stopped before converging (${f.status === "maxIterations" ? "cycle limit" : f.status === "stalled" ? "stalled" : "failed"}) at ${f.agreement}: the values are provisional.`;
    case "diverged": return "The last refinement diverged: its values and esds are not meaningful.";
    case "edited": return `The values were edited after the last refinement, so its esds no longer apply; the curves shown give ${f.agreement}.`;
    case "snapshot": return `The values are a converged snapshot at ${f.agreement}, which carries no esds or correlations: refining once gives them.`;
    case "changed": return `The model was changed after its last refinement and carries no esds; the curves shown give ${f.agreement}.`;
    case "none": return `The model has not been refined; the starting values give ${f.agreement}.`;
  }
}

// ---------------------------------------------------------------------------
// Powder: the Validation tab's verdict

/** A cause of misfit as the Validation tab names it (fitCauses.ts CauseRow). */
export interface ReportCause {
  readonly title: string;
  readonly phrase: string;
  /** Fraction of χ². */
  readonly share: number;
  readonly evidence: string;
  /** What the residual shows, in a few words ("Model's tails too short"). */
  readonly summary?: string;
  readonly statistic?: string;
}

export interface PowderResultInput {
  /** What was refined: "Mn₃Ga (P6₃/mmc), with MnO as a second phase". */
  readonly subject: string;
  /** Against what: "neutron time-of-flight data from POWGEN". */
  readonly against: string;
  readonly free: number;
  readonly points: number;
  readonly rwp: number;
  readonly rexp: number | null;
  readonly gof: number | null;
  readonly result: RefinementResult | null;
  readonly parameters: readonly RefinementParameter[];
  readonly acceptance: Acceptance;
  /** The cause the verdict names (fitCauses.ts headlineCause). */
  readonly headlineCause?: { readonly phrase: string; readonly share: number; readonly first: boolean } | undefined;
  /** The causes, largest share first. */
  readonly causes: readonly ReportCause[];
  readonly restraints?: readonly LinearRestraint[];
  /** The magnetic model in a sentence (reportInputs magneticReportSection), when there is one. */
  readonly magnetic?: string | undefined;
}

/** "most of the misfit is in the peak tails (about 85 % of χ²)", as powderAcceptance words it. */
function causeClause(c: NonNullable<PowderResultInput["headlineCause"]>): string {
  if (c.first) return `the misfit in ${c.phrase} comes first, as the method refines the cell, zero and background before the rest`;
  return `${c.share >= 0.5 ? "most of the misfit is in" : "the largest part of the misfit is in"} ${c.phrase} (about ${Math.round(100 * c.share)} % of χ²)`;
}

/** The verdict sentence against the acceptance bar (powderAcceptance's bands and findings). */
function powderVerdict(i: PowderResultInput): string {
  const a = i.acceptance;
  if (a.state.kind === "diverged" || a.state.kind === "none") return "";
  const items = a.checks[1].items ?? [];
  const blockers = items.filter((x) => x.severity === "blocker");
  const issues = items.filter((x) => x.severity === "issue");
  if (blockers.length > 0) return `It is not acceptable: ${plural(blockers.length, "physical problem")} to fix first (${blockers.map((b) => (b.brief ?? withoutAction(b.text)).replace(/\.$/, "")).join("; ")}).`;
  if (i.gof === null || a.band === null) return "";
  const g = i.gof.toFixed(2);
  const cause = i.headlineCause ? `: ${causeClause(i.headlineCause)}` : "";
  const toCheck = issues.length > 0 ? `, with ${plural(issues.length, "value")} to check` : "";
  // The GoF itself is the outcome sentence's; this one says where it stands.
  switch (a.band) {
    case "poor": return `The fit is poor, far from the data, and no value should be trusted yet${cause}.`;
    case "fair": return `The fit is fair, above the acceptance bar (good ≤ ${GOF_BANDS.good})${cause}.`;
    case "good": return `The fit is good, within the acceptance bar (good ≤ ${GOF_BANDS.good})${toCheck || (a.passes ? " and physically sane" : "")}${i.headlineCause && !i.headlineCause.first ? `; some systematic misfit remains, ${causeClause(i.headlineCause)}` : cause}.`;
    case "excellent": return `The fit is excellent, close to the noise${toCheck || (a.passes ? ", and physically sane" : "")}.`;
    case "too-good": return `GoF = ${g} is below ${GOF_BANDS.tooGood}: the σ's are overestimated or the model has more parameters than the data support, so the esds are optimistic.`;
  }
}

/** The limitations in one sentence: held or odd values, why the esds may not hold, the cross-check. */
function powderLimitations(i: PowderResultInput): string {
  const a = i.acceptance;
  const [, physical, cross] = a.checks;
  const byId = new Map(i.parameters.map((p) => [p.id, p]));
  const clauses: string[] = [];
  // The values to check (the bar's amber findings) and an input held outside its range; the
  // other notes (a bond-valence length, a B on its bound) are the caveats' to list, one line each.
  const items = physical.items ?? [];
  const held = (item: (typeof items)[number]): RefinementParameter | undefined => {
    const p = byId.get(item.parameterIds[0] ?? "");
    return p && p.kind === "occupancy" && (p.fixed || p.expression) && /held at/.test(item.text) ? p : undefined;
  };
  for (const item of [...items.filter((x) => x.severity === "issue").slice(0, 1), ...items.filter((x) => x.severity === "note" && held(x)).slice(0, 1)]) {
    const p = held(item);
    clauses.push(p
      ? `the ${parameterPhrase(p.label)} is held at ${+p.value.toFixed(4)}, outside [0, 1] (an input, not refined)`
      : lowerFirst(parameterPhrase(withoutAction(item.text)).replace(/\.$/, "")));
  }
  const notes = items.filter((x) => x.severity === "note" && !held(x)).length;
  if (notes > 0) clauses.push(`${plural(notes, "further note")} on the values ${notes === 1 ? "is" : "are"} listed under the caveats`);
  for (const e of (cross.esd ?? []).slice(0, 1)) clauses.push(esdClause(e));
  if (a.state.current || a.state.kind === "snapshot") {
    clauses.push(a.passes ? "the cross-check in GSAS-II and FullProf is the step left" : "the cross-check in GSAS-II and FullProf is still to do");
  }
  if (clauses.length === 0) return "";
  const joined = clauses.length > 1 ? `${clauses.slice(0, -1).join("; ")}; and ${clauses[clauses.length - 1]}` : clauses[0]!;
  return sentence(joined);
}

/** The Validation tab's short statistics with their symbols marked: "DW 0.61 < Q_D 1.89" → "Durbin–Watson {{d}} = 0.61 < {{Q_D}} = 1.89". */
const symbols = (t: string): string => t.replace(/\bDW (\d)/, "Durbin–Watson {{d}} = $1").replace(/\bQ_D (\d)/, "{{Q_D}} = $1");

/** Why the esds may not hold, as a clause: "the esds are likely too small (Durbin–Watson d 0.61 < Q_D 1.90, GoF 3.05)". */
function esdClause(e: { readonly text: string; readonly detail?: string }): string {
  const m = /^Esds likely too small: (.+)$/.exec(e.text);
  // The GoF is the outcome sentence's; the clause keeps what it adds (the serial correlation).
  if (m) {
    const why = symbols(m[1]!).split(", ").filter((w) => !/^GoF /.test(w));
    return `the esds are likely too small${why.length ? ` (${why.join(", ")})` : ""}`;
  }
  return lowerFirst((e.detail ?? e.text).replace(/\.$/, ""));
}

/** The agreement as the outcome sentence gives it. */
function powderAgreement(i: PowderResultInput): string {
  const extra = [i.rexp !== null ? `{{R_exp}} = ${pct(i.rexp)}` : "", i.gof !== null ? `GoF = ${i.gof.toFixed(2)}` : ""].filter(Boolean);
  return `{{R_wp}} = ${pct(i.rwp)}${extra.length ? ` (${extra.join(", ")})` : ""}`;
}

/** The Result paragraph of a powder fit: what, the outcome, the verdict, the limitations, the magnetic model. */
export function powderResultParagraph(i: PowderResultInput): string {
  const a = i.acceptance;
  const r = i.result;
  const shiftId = r?.diagnostics?.maxShiftParameterId;
  const outcome = outcomeSentence({
    state: a.state.kind,
    agreement: powderAgreement(i),
    ...(r ? { cycles: r.history.length, status: r.status } : {}),
    ...(r?.diagnostics?.maxShiftOverEsd !== undefined ? { shift: r.diagnostics.maxShiftOverEsd } : {}),
    ...(shiftId ? { shiftOf: i.parameters.find((p) => p.id === shiftId)?.label ?? shiftId } : {}),
  });
  return [
    `Rietveld refinement of ${i.subject} against ${i.against}: ${plural(i.free, "free parameter")} over ${i.points} points.`,
    outcome,
    powderVerdict(i),
    powderLimitations(i),
    i.magnetic ?? "",
  ].filter(Boolean).join(" ");
}

/** The caveats of a powder fit: the bar's three checks, the fit state, the causes of misfit, the correlations. */
export function powderCaveats(i: PowderResultInput): ReportCaveat[] {
  const a = i.acceptance;
  const [gof, physical, cross] = a.checks;
  const out: ReportCaveat[] = [];
  if (a.state.kind !== "converged") out.push({ tone: TONE[a.state.tone], label: "Fit", text: lowerFirst(a.state.detail ?? a.state.text) });
  out.push({ tone: TONE[gof.tone], label: "Goodness of fit", text: `${gof.value.replace(" · ", ", ")}${gof.sentence ? `: ${lowerFirst(reportVoice(gof.sentence))}` : ""}` });
  const misfit: ReportTone = a.band === "poor" ? "bad" : a.band === "fair" ? "warn" : "note";
  for (const c of i.causes.filter((x) => x.share >= 0.05).slice(0, 3)) {
    out.push({ tone: misfit, label: c.title, text: `about ${Math.round(100 * c.share)} % of χ² — ${lowerFirst((c.summary ?? c.evidence).replace(/\.$/, ""))}${c.statistic ? ` (${c.statistic})` : ""}` });
  }
  // A fix of the B-at-0 rule in force is the report's limitation (reportInputs), stated there once.
  const items = (physical.items ?? []).filter((x) => x.zeroAdp !== "applied");
  if ((physical.items ?? []).length === 0) out.push({ tone: TONE[physical.tone], label: "Physical sanity", text: lowerFirst(physical.value) + (physical.sentence ? `; ${lowerFirst(physical.sentence)}` : "") });
  // A held input says why it is one (its detail's first sentence); a B-at-0 line is stated as the
  // report states it (its arrow is a result); the others are their own line's words, the action left out.
  const byId = new Map(i.parameters.map((p) => [p.id, p]));
  const itemText = (item: (typeof items)[number]): string => {
    if (item.report) return item.report;
    const p = byId.get(item.parameterIds[0] ?? "");
    const held = p && p.kind === "occupancy" && (p.fixed || p.expression) && /held at/.test(item.text);
    return `${parameterPhrase(withoutAction(item.text)).replace(/\.$/, "")}${held && item.detail ? ` (${firstSentence(item.detail).replace(/\.$/, "")})` : ""}${item.caution ? ` — ${CAUTION_SHORT}` : ""}`;
  };
  // What the short lines leave out, for the appendix: the finding's own words where the line rewords it.
  const itemDetail = (group: readonly (typeof items)[number][]): { detail?: string } => {
    const d = group.map((x) => (x.info ?? []).join(" ")).filter(Boolean);
    return d.length > 0 ? { detail: d.join(" · ") } : {};
  };
  // Each blocker on its line; the values to check, and the notes, each as one line.
  for (const item of items.filter((x) => x.severity === "blocker")) out.push({ tone: "bad", label: "Physical sanity", text: itemText(item), ...itemDetail([item]) });
  for (const [severity, tone] of [["issue", "warn"], ["note", "note"]] as const) {
    const group = items.filter((x) => x.severity === severity);
    if (group.length > 0) out.push({ tone, label: "Physical sanity", text: group.map(itemText).join("; "), ...itemDetail(group) });
  }
  for (const e of cross.esd ?? []) {
    const m = /^Esds likely too small: (.+)$/.exec(e.text);
    // The longer account (a pair list behind the moderate correlations' line) goes to the appendix.
    out.push({ tone: "warn", label: "Esds", text: m ? `likely too small (${symbols(m[1]!)})` : withoutAction(e.text), ...(e.detail ? { detail: e.detail } : {}) });
  }
  if (i.result && a.state.current) out.push(...correlationCaveats(meaningfulCorrelations(i.result, i.parameters, i.restraints)));
  out.push({ tone: TONE[cross.tone], label: "Cross-check", text: `${lowerFirst(cross.value)} (${lowerFirst(cross.sentence.replace(/ \/ /g, " and "))})` });
  return out;
}

// ---------------------------------------------------------------------------
// Single crystal: the Validation view's checks

const STATUS_TONE: Record<CheckStatus, ReportTone> = { ok: "ok", note: "note", warn: "warn", critical: "bad", info: "info" };

export interface SingleCrystalResultInput {
  readonly subject: string;
  /** "414 reflections (139 unique) of neutron data at λ = 1.0 Å". */
  readonly against: string;
  readonly free: number;
  /** "{{R_1}} = 0.87 % (411 reflections with F_o² > 2σ), {{wR_2}} = 2.18 %, GooF = 1.01". */
  readonly agreement: string;
  readonly result: RefinementResult | null;
  readonly parameters: readonly RefinementParameter[];
  readonly verdict: ValidationVerdict;
  readonly magnetic?: string | undefined;
}

/** The fit state of a result, in the powder's terms (no snapshot on these pages). */
export function stateOf(result: RefinementResult | null, changed: boolean): Acceptance["state"]["kind"] {
  if (!result) return "none";
  if (result.status === "diverged") return "diverged";
  if (changed) return "edited";
  if (result.status !== "converged") return "stopped";
  return "converged";
}

/** The GooF line of the Validation view as a sentence: "At GooF = 1.01 the fit is close to the statistical floor." */
function goofSentence(c: ValidationVerdict["checks"][number]): string {
  const at = c.title.replace(/^GooF /, "GooF = ");
  const detail = (c.detail ?? "").replace(/\.$/, "");
  if (/^below 1/.test(detail)) return sentence(`${at} is ${detail}`);
  return sentence(`At ${at} the fit ${c.status === "ok" ? "is" : "shows"} ${detail}`);
}

export function singleCrystalResultParagraph(i: SingleCrystalResultInput, changed: boolean): string {
  const gof = i.verdict.checks.find((c) => c.id === "gof");
  const attention = i.verdict.checks.filter((c) => c.status === "warn" || c.status === "critical");
  const state = stateOf(i.result, changed);
  return [
    `Single-crystal refinement of ${i.subject} against ${i.against}: ${plural(i.free, "free parameter")}.`,
    outcomeSentence({ state, agreement: i.agreement, ...(i.result ? { cycles: i.result.history.length, status: i.result.status } : {}) }),
    gof && state !== "diverged" && gof.status !== "info" ? goofSentence(gof) : "",
    attention.length > 0 ? sentence(`To resolve before quoting the result: ${attention.map((c) => lowerFirst(c.title)).join("; ")}`) : "",
    i.magnetic ?? "",
  ].filter(Boolean).join(" ");
}

export function singleCrystalCaveats(i: SingleCrystalResultInput, changed = false, restraints: readonly LinearRestraint[] = []): ReportCaveat[] {
  const out: ReportCaveat[] = i.verdict.checks.map((c) => ({ tone: STATUS_TONE[c.status], label: c.title, text: c.detail ?? "" }));
  // The correlations of the refinement that describes the values on screen only, unless the view's checks list them.
  if (i.result && !changed && !i.verdict.checks.some((c) => /correlat/i.test(`${c.id} ${c.title}`))) out.push(...correlationCaveats(meaningfulCorrelations(i.result, i.parameters, restraints)));
  // The single-crystal programs, as the page banner names them.
  out.push({ tone: "info", label: "Cross-check", text: `reproduce the refinement in ${CROSS_CHECK.singleCrystal.packages}: ${CROSS_CHECK.singleCrystal.exportNote}` });
  return out;
}

// ---------------------------------------------------------------------------
// PDF: the assessment's findings

export interface PdfResultInput {
  readonly subject: string;
  /** "X-ray G(r) over r = 1.5–28.0 Å (2651 points)". */
  readonly against: string;
  readonly free: number;
  readonly rw: number;
  readonly result: RefinementResult | null;
  readonly parameters: readonly RefinementParameter[];
  readonly assessment: RefinementAssessment | null;
  readonly magnetic?: string | undefined;
}

const SEVERITY_TONE = { critical: "bad", warning: "warn", note: "note", info: "info" } as const;

export function pdfResultParagraph(i: PdfResultInput, changed: boolean): string {
  const state = stateOf(i.result, changed);
  const serious = (i.assessment?.findings ?? []).filter((f) => f.severity === "critical" || f.severity === "warning");
  return [
    `Real-space refinement of ${i.subject} against ${i.against}: ${plural(i.free, "free parameter")}.`,
    outcomeSentence({ state, agreement: `{{R_w}} = ${pct(i.rw)}`, ...(i.result ? { cycles: i.result.history.length, status: i.result.status } : {}) }),
    // The convention the PDF page's notes state (Toby & Billinge 2004): no GoF on correlated G(r) points.
    "G(r) points are strongly correlated, so {{R_w}} is a relative measure with no statistical acceptance bar, and the esds are optimistic.",
    serious.length > 0 ? sentence(`To resolve: ${serious.slice(0, 3).map((f) => lowerFirst(shortFinding(f, i.parameters).text.replace(/\.$/, ""))).join("; ")}`) : "",
    // A refined fit's cross-check is in the real-space programs, as the powder's is in GSAS-II and FullProf.
    state !== "none" && state !== "diverged"
      ? `The cross-check in ${CROSS_CHECK.pdf.packages}${i.magnetic ? `, with the magnetic term in ${CROSS_CHECK.pdf.magnetic},` : ""} is still to do.`
      : "",
    i.magnetic ?? "",
  ].filter(Boolean).join(" ");
}

/** The cross-check line of a PDF's caveats: the real-space programs, and what the bundle carries (the mPDF term it does not). */
function pdfCrossCheckCaveat(magnetic: boolean): ReportCaveat {
  const mpdf = magnetic ? `; the magnetic term in ${CROSS_CHECK.pdf.magnetic}, which the bundle does not carry` : "";
  return { tone: "info", label: "Cross-check", text: `reproduce the fit in ${CROSS_CHECK.pdf.packages}: ${CROSS_CHECK.pdf.exportNote} that refines the same parameters${mpdf}` };
}

/** A finding as a caveat states it: the page's short line where it has one, the action left out, its own words for the appendix. */
function shortFinding(f: RefinementAssessment["findings"][number], parameters: readonly RefinementParameter[]): { text: string; detail?: string } {
  const line = findingLine(f, { parameters });
  if (!line) return { text: f.summary.replace(/\.$/, "") };
  return { text: line.report ?? withoutAction(line.text), detail: line.detail.join(" ") };
}

export function pdfCaveats(i: PdfResultInput, restraints: readonly LinearRestraint[] = []): ReportCaveat[] {
  const findings = (i.assessment?.findings ?? []).filter((f) => f.severity !== "info" && f.category !== "correlation");
  const out: ReportCaveat[] = findings.map((f) => ({ tone: SEVERITY_TONE[f.severity], label: CATEGORY_LABEL[f.category] ?? "Finding", ...shortFinding(f, i.parameters) }));
  // An assessment is read only off a refinement that describes the values on screen; so are its correlations.
  if (i.result && i.assessment) out.push(...correlationCaveats(meaningfulCorrelations(i.result, i.parameters, restraints)));
  out.push(pdfCrossCheckCaveat(!!i.magnetic));
  return out;
}

const CATEGORY_LABEL: Partial<Record<RefinementAssessment["findings"][number]["category"], string>> = {
  "fit-quality": "Fit", "at-bound": "Bounds", conditioning: "Conditioning", parameterization: "Parameters", convergence: "Convergence", physical: "Physical sanity", residual: "Residual", misfit: "Misfit",
};
