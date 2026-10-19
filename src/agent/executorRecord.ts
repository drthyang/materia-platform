/**
 * What the executor keeps (its record side): the analysis's record as calls
 * leave it (the notes, the readings of the data, the cell, the fit and the
 * symmetry, the stages done), what get_state shows of it, the report built
 * from it, and the answers kept by ref so one answer never floods the
 * conversation (as the MATERIA MCP server's).
 */

import { liveTool } from "@/agent/tools";
import type { AgentPort } from "@/agent/port";
import { diagnosisText, type DiagnosisView } from "@/core/diagnostics/fitDiagnosis";
import { magneticNext } from "@/agent/magneticTools";
import type { PosteriorRun } from "@/agent/posteriorTool";
import { buildAgentReport, reportFileBase, type AgentReport } from "@/agent/report";
import { PROBE_OPTIONS } from "@/core/diagnostics/correlationGuard";
import { methodProgress, stagesCovered, stagesOnPath, type AgentRecord } from "@/agent/method";
import { analysisOf, onPage, type PageAdapter } from "@/agent/pages";
import { REF_KEY, RefStore, buildView, isPlainObject } from "@/mcp/refs";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { ActivityEntry, AgentHost, ToolOutcome } from "@/agent/executor";

/** Notes kept per analysis; the oldest go first. */
const MAX_NOTES = 40;

/** Diagnoses of the fit kept per analysis (one per History step); the oldest go first. */
const MAX_DIAGNOSES = 12;

let nextReportId = 1;

/** A converged refinement on screen counts its free blocks as done, whoever ran it. */
export function syncStages(host: AgentHost, port: AgentPort): AgentRecord {
  const s = port.state();
  const key = analysisOf(port);
  // With a History, the stages follow it: undo, go_to_step and a reset take a stage back off the list.
  const onPath = stagesOnPath(port.technique, host.history(), s);
  if (onPath) {
    host.updateRecord(key, (r) => (r.stagesDone.length === onPath.length && onPath.every((c) => r.stagesDone.includes(c)) ? r : { ...r, stagesDone: onPath }));
  } else if (s.result?.status === "converged") {
    // What the fit on screen refined (its esds), not what is free now: a parameter freed since has not been refined.
    const refined = new Set(Object.keys(s.result.esd));
    const covered = stagesCovered(port.technique, s.parameters.filter((p) => refined.has(p.id)), s.parameters);
    host.updateRecord(key, (r) => (covered.every((c) => r.stagesDone.includes(c)) ? r : { ...r, stagesDone: [...new Set([...r.stagesDone, ...covered])] }));
  }
  return host.record(key);
}

/** write_note: a note in the analysis's record, its numbers as they stand. The notes kept. */
export function addNote(host: AgentHost, key: string, text: string): number {
  host.updateRecord(key, (r) => ({ ...r, notes: [...r.notes, { text, at: Date.now() }].slice(-MAX_NOTES) }));
  return host.record(key).notes.length;
}

/** What a read leaves in the record: the checks a method gate or the report reads later. A record, not a gate. */
export function noteRead(host: AgentHost, port: AgentPort, name: string, out: unknown, step: { readonly id: string } | null): void {
  if (name === "check_cell_symmetry") noteCellCheck(host, port, out as CellCheckAnswer);
  if (name === "diagnose_fit") noteDiagnosis(host, port, out, step);
  if (name === "check_fit_range") noteRangeCheck(host, port, out as RangeAnswer);
  if (name === "reflection_statistics") noteDataCheck(host, port, out as DataAnswer);
  if (name === "review_symmetry") noteSymmetryReview(host, port, out as { observedForbidden?: unknown[]; candidates?: { name: string }[] });
}

/** The cell check's outcome, kept for the analysis it ran on. */
function noteCellCheck(host: AgentHost, port: AgentPort, out: CellCheckAnswer): void {
  host.updateRecord(analysisOf(port), (r) => ({ ...r, cellCheck: { passed: !!out.passed, at: Date.now(), summary: cellCheckSummary(out, port.state().parameters) } }));
}

/**
 * A diagnosis of the fit (diagnose_fit), kept with the History step it read:
 * the report gives the earlier ones by step, so an account that cites what
 * the fit was diagnosed with on the way cites the report. The latest per
 * step, at most MAX_DIAGNOSES.
 */
function noteDiagnosis(host: AgentHost, port: AgentPort, out: unknown, step: { readonly id: string } | null): void {
  const dx = out as Partial<DiagnosisView>;
  if (typeof dx.reading !== "string" || !Array.isArray(dx.causes)) return;
  const entry = { at: Date.now(), ...(step ? { step: step.id } : {}), summary: diagnosisText(dx as DiagnosisView) };
  host.updateRecord(analysisOf(port), (r) => ({
    ...r,
    diagnoses: [...(r.diagnoses ?? []).filter((d) => d.step !== entry.step), entry].slice(-MAX_DIAGNOSES),
  }));
}

/** The data ends' reading, kept for the analysis: what each end showed and the window proposed. */
function noteRangeCheck(host: AgentHost, port: AgentPort, out: RangeAnswer): void {
  const causes = (e: RangeAnswer["low"]): string => e.findings.map((f) => f.slice(0, f.indexOf(":"))).join(", ");
  const end = (e: RangeAnswer["low"]): string => e.verdict === "trim" ? `${e.end}: trim to ${e.cut} (${causes(e)})` : e.outside ? `${e.end}: left out by the window (${causes(e)})` : `${e.end}: keep`;
  const proposed = typeof out.proposed === "object" ? `; proposed window ${out.proposed.min}–${out.proposed.max} ${out.unit}` : Array.isArray(out.window) ? `; window ${out.window[0]}–${out.window[1]} ${out.unit}` : "";
  const summary = `${end(out.low)}; ${end(out.high)}${proposed}`;
  host.updateRecord(analysisOf(port), (r) => ({ ...r, rangeCheck: { at: Date.now(), summary } }));
}

/** The data's reading before the model (single crystal), kept for the analysis. */
function noteDataCheck(host: AgentHost, port: AgentPort, out: DataAnswer): void {
  const r = out.reflections;
  const e = out.intensityStatistics;
  const parts = [
    r.listed !== undefined
      ? `${r.listed} reflections from a refinement's listing, each once: no R_int`
      : `${r.measured} reflections, ${r.unique} unique, ${typeof r.rInt === "number" ? `R_int ${r.rInt} %${r.rIntLaue !== undefined ? ` with the Friedel mates apart, as SHELXL reports it (${r.rIntLaue} % in the Laue class)` : ""}` : "merged (one value per reflection)"}`,
    `d_min ${out.resolution.dMin} Å${out.resolution.sinThetaOverLambdaMax !== undefined ? ` (sinθ/λ ${out.resolution.sinThetaOverLambdaMax} Å⁻¹)` : ""}${out.resolution.completeness !== undefined ? `, completeness ${out.resolution.completeness} %` : ""}`,
    ...(typeof e === "object" ? [`⟨|E²−1|⟩ ${e.meanAbsE2Minus1}: ${e.reading}`] : []),
    // The strongest merohedral law the H-test reads, when it reads one.
    ...(typeof out.twinLaws === "object" && typeof out.twinLaws.laws[0]?.alpha === "number" && out.twinLaws.laws[0].alpha >= 0.2 ? [`the H-test reads a twin by ${out.twinLaws.laws[0].indices.replace("h, k, l → ", "(h, k, l) → (")}) at α ≈ ${out.twinLaws.laws[0].alpha} (${out.twinLaws.laws[0].pairs} pairs)`] : []),
    ...(typeof out.absences === "object" ? [`${out.absences.atThreeSigma} of ${out.absences.measured} forbidden reflections at ≥ 3σ${out.absences.strongest?.[0] ? `, the strongest ${out.absences.strongest[0]}` : ""}`] : []),
    ...(out.friedel.startsWith("centrosymmetric") ? [] : [out.friedel.split(":")[0]!]),
  ];
  host.updateRecord(analysisOf(port), (rec) => ({ ...rec, dataCheck: { at: Date.now(), summary: parts.join("; ") } }));
}

/** The symmetry review's outcome, kept for the analysis. */
function noteSymmetryReview(host: AgentHost, port: AgentPort, out: { observedForbidden?: unknown[]; candidates?: { name: string }[] }): void {
  const n = out.observedForbidden?.length ?? 0;
  const top = out.candidates?.slice(0, 3).map((c) => c.name) ?? [];
  const summary = n === 0 ? "no forbidden reflection carries intensity in the refined fit" : `${n} forbidden reflection${n === 1 ? "" : "s"} with intensity${top.length ? `; subgroups allowing them: ${top.join(", ")}` : ""}`;
  host.updateRecord(analysisOf(port), (r) => ({ ...r, symmetryReviewed: { at: Date.now(), summary } }));
}

/**
 * What get_state adds from the Agent's record: with the skills, `method`
 * (methodView); without them (the validation's arm C), `record`, the same
 * checks, exceptions and notes with no stage, skill or next step of a method.
 */
export function recordView(host: AgentHost, port: AgentPort, skills: boolean): Record<string, unknown> {
  if (skills) return { method: methodView(host, port) };
  const record = syncStages(host, port);
  const kept = {
    ...(record.rangeCheck ? { rangeCheck: record.rangeCheck.summary } : {}),
    ...(record.cellCheck ? { cellCheck: record.cellCheck.summary } : {}),
    ...(record.symmetryReviewed ? { symmetryReview: record.symmetryReviewed.summary } : {}),
    ...(record.exceptions.length > 0 ? { exceptions: record.exceptions.map((e) => `${e.rule}: ${e.reason}`) } : {}),
    ...(record.notes.length > 0 ? { notes: record.notes.map((n) => n.text) } : {}),
  };
  return Object.keys(kept).length > 0 ? { record: kept } : {};
}

/** get_state's own answer, without the skills: its magnetic step's note refers to the method's stages. */
export function withoutMethod(out: unknown, skills: boolean): object {
  const o = out as { magneticStep?: { next: unknown; note?: string } };
  if (skills || !o.magneticStep) return out as object;
  return { ...o, magneticStep: { next: o.magneticStep.next, note: "For the magnetic structure, magnetic_state reads where the magnetic step stands." } };
}

/**
 * get_state's view of the method: its stages (done or not), the cell check,
 * the symmetry review, and the exceptions the user allowed.
 */
function methodView(host: AgentHost, port: AgentPort): Record<string, unknown> {
  const record = syncStages(host, port);
  const progress = methodProgress(port.technique, record);
  // Where the magnetic step has something to work on, its own next step leads (as get_state's magneticStep): the stages are the refinement step's.
  const panel = onPage(port, (page, p) => page.magneticStep?.(p) ?? null);
  const magnetic = panel !== null && (panel.peaks.some((p) => p.included) || panel.kSearch !== null || panel.selected !== null);
  return {
    skill: magnetic ? "magnetic-analysis" : progress.skill,
    stages: progress.stages.map((st) => `${st.done ? "✓" : "○"} ${st.label}${st.optional ? " (if needed)" : ""}`),
    next: magnetic
      ? `the magnetic step: ${magneticNext(panel)} (the stages above are the refinement step's)`
      : progress.next ?? `every required stage done: check the acceptance bar${liveTool("review_symmetry")?.pages.includes(port.technique) ? "; only if the fit is still not good, review_symmetry" : ""}`,
    ...(record.rangeCheck ? { rangeCheck: record.rangeCheck.summary } : {}),
    ...(record.cellCheck ? { cellCheck: record.cellCheck.summary } : {}),
    ...(record.symmetryReviewed ? { symmetryReview: record.symmetryReviewed.summary } : {}),
    ...(record.exceptions.length > 0 ? { exceptions: record.exceptions.map((e) => `${e.rule}: ${e.reason}`) } : {}),
    ...(record.notes.length > 0 ? { notes: record.notes.map((n) => n.text) } : {}),
  };
}

/** The last posterior run (sample_posterior), with the analysis and the History step it sampled: for the report. */
export interface SampledPosterior {
  readonly run: PosteriorRun;
  readonly key: string;
  readonly step: { readonly id: string; readonly label: string } | null;
}

/** What the report is built with besides the page. */
export interface ReportContext {
  readonly host: AgentHost;
  readonly skills: boolean;
  readonly posterior: SampledPosterior | null;
  readonly userText: readonly string[];
  /** The model and how it is reached ("Claude Opus 5.5 · Anthropic API"). */
  readonly modelLabel?: () => string;
  readonly onReport?: (report: AgentReport) => void;
}

/**
 * write_report: the page's report with the analysis as the Agent ran it and
 * its account, opened in the viewer. The answer lists the checks, the open
 * issues and any number in the account the report did not compute.
 */
export async function writeReport<P extends AgentPort>(ctx: ReportContext, page: PageAdapter<P>, port: P, summary: string, update: (patch: Partial<ActivityEntry>) => void): Promise<Record<string, unknown>> {
  if (!port.reportInput) throw new Error("this page cannot build a report");
  const s = page.state(port);
  if (s.busy) throw new Error("a refinement is running — wait for it to finish, then write the report");
  page.reportable?.(s);
  const record = syncStages(ctx.host, port);
  // The correlations at the refined values, every pair from |ρ| 0.5 as refine measures them (the
  // refinement itself keeps only those at 0.95): for the free set the refinement on screen had.
  const free = s.parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.id);
  const refined = s.result ? Object.keys(s.result.esd) : [];
  let probe: RefinementResult | null = null;
  if (free.length > 0 && free.length === refined.length && free.every((id) => refined.includes(id))) {
    try {
      probe = await port.probe(PROBE_OPTIONS);
    } catch {
      probe = null;
    }
  }
  const checks = page.reportChecks(s, probe, record);
  // The last run on this analysis: of the refinement on screen, or of an earlier one (a focused
  // set, before the final refinement), which the report labels with how far its values moved since.
  const sampled = ctx.posterior && ctx.posterior.key === page.analysis(s) ? ctx.posterior : null;
  const built = buildAgentReport({
    page: port.technique,
    input: port.reportInput(),
    history: ctx.host.history(),
    record,
    checks,
    posterior: sampled ? { run: sampled.run, current: sampled.run.result === s.result, stepId: sampled.step?.id ?? null, parameters: s.parameters } : null,
    model: ctx.modelLabel?.() ?? "the configured model",
    ...(!ctx.skills ? { method: false } : {}),
    narrative: summary,
    userText: ctx.userText.join("\n\n"),
  });
  const report: AgentReport = {
    id: nextReportId++,
    title: built.input.title,
    technique: port.technique,
    html: built.html,
    markdown: built.markdown,
    fileBase: reportFileBase(built.input.title),
    at: Date.now(),
    unverified: built.unverified,
    audit: built.audit,
  };
  ctx.onReport?.(report);
  const attention = built.agent.checks.filter((c) => c.status === "warn").length;
  update({
    status: "done",
    preview: built.input.title,
    outcome: `Report open · ${built.agent.steps.length} steps · ${built.agent.checks.length} checks${attention ? `, ${attention} for attention` : ""}${built.unverified.length ? ` · ${built.unverified.length} number${built.unverified.length === 1 ? "" : "s"} unverified` : ""}`,
  });
  return {
    shown: true,
    title: built.input.title,
    steps: built.agent.steps.length,
    checks: built.agent.checks.map((c) => `${c.status === "warn" ? "attention" : c.status}: ${c.name} — ${c.detail}`),
    openIssues: built.agent.openIssues,
    ...(built.agent.posterior ? { bayesianCheck: `included (${built.agent.posterior.convergence}${built.agent.posterior.earlier ? `; ${built.agent.posterior.earlier}` : ""})` } : {}),
    ...(built.input.boxcar ? { boxcarScan: `included (${built.input.boxcar.rows.length} boxes of ${built.input.boxcar.width} Å: ${built.input.boxcar.columns.join(", ")})` } : {}),
    ...(built.unverified.length > 0
      ? {
          unverifiedNumbers: built.unverified,
          note: "These numbers in your account (or your notes) match no value the report computed, and are underlined in it. Check each against the tools: correct the account and call write_report again, or leave the number out.",
        }
      : {}),
    downloads: "The user can save the report as HTML, Markdown or PDF, and the CIF, from the viewer.",
  };
}

/**
 * The answers a conversation keeps: a bulky part becomes a ref ("#3/findings")
 * the model can open with read_ref, so one answer never floods the
 * conversation. Cleared with the conversation.
 */
export class Answers {
  private readonly refs = new RefStore(128);

  /** Largest answer, in characters of compact JSON. */
  constructor(private readonly budget: number) {}

  clear(): void {
    this.refs.clear();
  }

  /** An answer as the model reads it: compact JSON, its bulky parts by ref. */
  respond(out: unknown): ToolOutcome {
    const ref = this.refs.put(out);
    const view = buildView(this.refs.get(ref), ref, this.budget);
    const payload = isPlainObject(view) ? { [REF_KEY]: ref, ...view } : view;
    return { isError: false, text: JSON.stringify(payload), status: "ok" };
  }

  /** read_ref: a kept answer's part, or a window of a long one. */
  readRef({ ref, start, end }: { ref: string; start?: number; end?: number }): unknown {
    const budget = this.budget;
    const value = this.refs.get(ref);
    if (typeof value === "string" || Array.isArray(value)) {
      const s = Math.min(start ?? 0, value.length);
      const e = Math.min(end ?? value.length, value.length);
      const window = value.slice(s, e);
      const shown = typeof window === "string" ? window : buildView(window, ref, budget, s);
      const chars = JSON.stringify(shown).length;
      if (chars > budget) {
        const fits = Math.max(1, Math.floor(((e - s) * budget) / chars));
        throw new Error(`${ref} holds ${value.length} ${typeof value === "string" ? "characters" : "items"}; ${s}–${e} is ${chars} characters. Read about ${fits} at a time with start/end.`);
      }
      return { ref, length: value.length, start: s, end: e, [typeof value === "string" ? "text" : "items"]: shown };
    }
    return { ref, value: buildView(value, ref, budget) };
  }
}

/** reflection_statistics' answer, as the record reads it. */
interface DataAnswer {
  /** `listed` for a refinement's listing (each reflection once), `measured` for a measurement. */
  readonly reflections: { readonly measured?: number; readonly listed?: number; readonly unique: number; readonly rInt: number | string; readonly rIntLaue?: number };
  readonly resolution: { readonly dMin: number; readonly sinThetaOverLambdaMax?: number; readonly completeness?: number };
  readonly friedel: string;
  readonly absences: { readonly measured: number; readonly atThreeSigma: number; readonly strongest?: readonly string[] } | string;
  readonly intensityStatistics: { readonly meanAbsE2Minus1: number; readonly reading: string } | string;
  readonly twinLaws?: { readonly laws: readonly { readonly indices: string; readonly alpha: number | string; readonly pairs: number }[] } | string;
}

/** check_cell_symmetry's answer, as the record reads it. */
interface CellCheckAnswer {
  readonly passed?: boolean;
  readonly unindexedPeaks?: readonly { readonly d?: number }[];
  readonly absences?: { readonly violated?: readonly unknown[] };
  /** The Le Bail fit: Rwp in per cent, the independent cell parameters by id. */
  readonly leBail?: { readonly Rwp?: number };
  readonly cellValues?: Readonly<Record<string, number>>;
}

/**
 * The cell check in a line, for the record and the report: what indexed and
 * what was flagged, and the Le Bail fit that judged it (its Rwp and cell, as
 * the tool gave them), so an account that quotes the Le Bail cell quotes the
 * report.
 */
export function cellCheckSummary(out: CellCheckAnswer, parameters: readonly RefinementParameter[]): string {
  const unindexed = out.unindexedPeaks?.length ?? 0;
  const flagged = out.absences?.violated?.length ?? 0;
  // The peaks by d, so the report says which they were, and a note that names them names the report's numbers.
  const ds = (out.unindexedPeaks ?? []).map((p) => p.d).filter((d): d is number => typeof d === "number").slice(0, 12);
  const parts = [
    ...(unindexed > 0 ? [`${unindexed} unindexed peak${unindexed === 1 ? "" : "s"}${ds.length ? ` (d = ${ds.join(", ")}${unindexed > ds.length ? ", …" : ""} Å)` : ""}`] : []),
    ...(flagged > 0 ? [`${flagged} absence${flagged === 1 ? "" : "s"} flagged (revisit at the symmetry review)`] : []),
  ];
  const cell = Object.entries(out.cellValues ?? {}).map(([id, v]) => {
    const p = parameters.find((q) => q.id === id);
    return `${(p?.label ?? id).replace(/\s*\(.*\)$/, "")} ${v} ${p?.kind === "cellAngle" ? "°" : "Å"}`;
  });
  const leBail = typeof out.leBail?.Rwp === "number" ? `; the Le Bail fit (every intensity free) reached Rwp ${out.leBail.Rwp.toFixed(2)} %${cell.length ? ` with ${cell.join(", ")}` : ""}` : "";
  return `${out.passed ? "every peak indexes; no absence flagged" : parts.join(", ")}${leBail}`;
}

/** check_fit_range's answer, as the record reads it. */
interface RangeAnswer {
  readonly unit: string;
  readonly window: readonly [number, number] | string;
  readonly low: { readonly end: string; readonly verdict: string; readonly outside?: true; readonly cut?: number; readonly findings: readonly string[] };
  readonly high: { readonly end: string; readonly verdict: string; readonly outside?: true; readonly cut?: number; readonly findings: readonly string[] };
  readonly proposed: { readonly min: number; readonly max: number } | string;
}
