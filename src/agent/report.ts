/**
 * The Agent's analysis report: the page's own report — every engine number:
 * the data and the model, the fit figure, the refined structures with esds,
 * every parameter, the diagnostics — with the analysis as the Agent ran it:
 * the History's steps on the path to the result (what was freed at each
 * refinement, and the method stage that is the reason for it), the method's
 * checklist, the engine's checks and the issues left open, the Bayesian check
 * when one ran on this refinement, and the notes kept in the record.
 *
 * The Agent writes one thing: its own account (`narrative`), labelled as its
 * words. Its decimal numbers are audited against the numbers the report
 * computed (reportAudit.ts); any that match none are marked in the report and
 * returned, so the Agent can correct them.
 */

import { reportHtml, type ReportAgent, type ReportCheck, type ReportInput, type ReportPosterior, type ReportStep } from "@/core/export/report";
import { reportMarkdown } from "@/core/export/reportMarkdown";
import { unverifiedNumbers } from "@/core/export/reportAudit";
import { lineage, type HistoryStep, type ProjectHistory } from "@/core/project/history";
import type { ParameterKind, RefinementParameter } from "@/core/refinement/types";
import type { AgentPage } from "@/agent/tools";
import { RULES, methodProgress, stagesCovered, stagesFor, stagesLeft, type AgentRecord } from "@/agent/method";
import { differenceSentences, readPosterior, type PosteriorRun } from "@/agent/posteriorTool";

/** A finished report, as the viewer shows it and the downloads save it. */
export interface AgentReport {
  readonly id: number;
  readonly title: string;
  readonly technique: AgentPage;
  readonly html: string;
  readonly markdown: string;
  /** File name without its extension. */
  readonly fileBase: string;
  readonly at: number;
  /** Numbers in the Agent's account that match no value the report computed. */
  readonly unverified: readonly string[];
}

/** Short names of the parameter kinds, for a refinement's "Refined" column. */
const KIND_SHORT: Partial<Record<ParameterKind, string>> = {
  scale: "scale", background: "background", cellLength: "cell", cellAngle: "cell", zeroShift: "zero",
  tofCalibration: "TOF calibration", atomX: "positions", atomY: "positions", atomZ: "positions", positionShift: "positions",
  occupancy: "occupancy", bIso: "B", uAniso: "Uij",
  peakWidth: "profile", profileU: "profile", profileV: "profile", profileW: "profile", profileX: "profile", profileY: "profile", tofProfile: "profile",
  asymSL: "asymmetry", asymHL: "asymmetry",
  mustrainIso: "microstrain", stephensStrain: "microstrain", mustrainPerp: "microstrain", mustrainPar: "microstrain", anisoSizePerp: "size", anisoSizePar: "size",
  sampleDisplacement: "displacement", sampleTransparency: "transparency", poRatio: "texture", absorption: "absorption",
  surfaceRoughA: "roughness", surfaceRoughB: "roughness", extinction: "extinction", batchScale: "batch scales",
  magneticScale: "magnetic scale", momentX: "moments", momentY: "moments", momentZ: "moments", momentMode: "moments", propagationK: "k",
  pdfScale: "scale", qdamp: "Qdamp", qbroad: "Qbroad", delta1: "δ1", delta2: "δ2", spdiameter: "particle size", sratio: "sratio", rcut: "rcut",
  mpdfOrdScale: "mPDF scale", mpdfParaScale: "mPDF paramagnetic scale", mpdfPsigma: "mPDF width", corrLength: "correlation length",
};

/** The free parameters, by group: "scale, background ×6, cell ×2". */
export function freeSummary(params: readonly RefinementParameter[]): string {
  const counts = new Map<string, number>();
  for (const p of params) {
    if (p.fixed || p.expression) continue;
    const k = KIND_SHORT[p.kind] ?? p.kind;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ");
}

function stepParameters(st: HistoryStep): readonly RefinementParameter[] {
  const r = st.workspace.refinement as { parameters?: readonly RefinementParameter[] } | undefined;
  return r?.parameters ?? [];
}

/** An unnamed edit that only freed or fixed parameters: the next refinement's row shows what was free. */
function freeFixOnly(st: HistoryStep): boolean {
  return st.kind === "edit" && !st.name && /^(Freed|Fixed)\b/.test(st.label) && !/(^|· )set /i.test(st.label);
}

/**
 * The steps on the path from the first step to the one on screen, as the
 * report lists them, and how many steps lie on branches the analysis left.
 */
export function historySteps(page: AgentPage, history: ProjectHistory | null): { steps: ReportStep[]; otherBranches: number; rowOf: Map<string, number> } {
  if (!history) return { steps: [], otherBranches: 0, rowOf: new Map() };
  const path = lineage(history);
  const stageLabel = new Map(stagesFor(page).map((s) => [s.id, s.label]));
  const shown = path.filter((st) => !freeFixOnly(st));
  const steps = shown.map((st): ReportStep => {
    const refine = st.kind === "refine";
    const free = refine ? stepParameters(st).filter((p) => !p.fixed && !p.expression) : [];
    const stages = stagesCovered(page, free).map((id) => stageLabel.get(id) ?? id).join(" · ");
    const status = refine && st.summary.status && st.summary.status !== "converged" ? ` (${st.summary.status})` : "";
    return {
      label: `${st.name ? `${st.name} — ` : ""}${st.label}${status}`,
      by: st.actor === "agent" ? "agent" : "user",
      kind: st.kind,
      ...(refine && st.summary.wR !== undefined ? { wR: st.summary.wR } : {}),
      // No GoF on the PDF page (uniform weights), even from a project saved before steps left it out.
      ...(refine && page !== "pdf" && st.summary.gof !== undefined ? { gof: st.summary.gof } : {}),
      free: st.summary.nFree,
      ...(free.length > 0 ? { refined: freeSummary(free) } : {}),
      ...(stages ? { stages } : {}),
    };
  });
  return { steps, otherBranches: history.steps.length - path.length, rowOf: new Map(shown.map((st, i) => [st.id, i + 1])) };
}

const capital = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The record's checks: the fit range, the cell check, the symmetry review, the data's reading, the method exceptions the user allowed. */
export function recordChecks(page: AgentPage, record: AgentRecord): ReportCheck[] {
  const out: ReportCheck[] = [];
  if (page === "singleCrystal") {
    out.push(record.dataCheck
      ? { name: "Data reading", status: "note", detail: `${capital(record.dataCheck.summary)}.` }
      : { name: "Data reading", status: "note", detail: "Not run in this analysis (reflection_statistics)." });
  }
  if (page === "powder") {
    if (record.rangeCheck) out.push({ name: "Fit range", status: "note", detail: `${capital(record.rangeCheck.summary)}.` });
    out.push(record.cellCheck
      ? { name: "Cell check", status: record.cellCheck.passed ? "pass" : "note", detail: `${capital(record.cellCheck.summary)}.` }
      : { name: "Cell check", status: "note", detail: "Not run in this analysis." });
    if (record.symmetryReviewed) {
      out.push({ name: "Symmetry review", status: record.symmetryReviewed.summary.startsWith("no forbidden") ? "pass" : "note", detail: `${capital(record.symmetryReviewed.summary)}.` });
    }
  }
  for (const e of record.exceptions) out.push({ name: "Method exception", status: "note", detail: `${RULES[e.rule].title}: allowed by the user, because ${e.reason}` });
  return out;
}

/**
 * The Bayesian check for the report, from the Agent's last run. `since` is
 * given when the run sampled an earlier refinement than the one on screen
 * (a focused set, before the final refinement): where it was, and the
 * parameters now, to say how far the sampled values have moved since, in
 * their esds.
 */
export function reportPosterior(p: PosteriorRun, since: { readonly where: string; readonly parameters: readonly RefinementParameter[] } | null = null): ReportPosterior {
  const read = readPosterior(p.run, p.parameters, p.result.esd);
  let earlier: string | undefined;
  if (since) {
    const now = new Map(since.parameters.map((q) => [q.id, q.value]));
    const then = new Map(p.parameters.map((q) => [q.id, q.value]));
    const moved = Math.max(0, ...p.run.freeIds.map((id) => {
      const e = p.result.esd[id];
      const a = now.get(id);
      const b = then.get(id);
      return e && e > 0 && a !== undefined && b !== undefined ? Math.abs(a - b) / e : 0;
    }));
    earlier = `sampled at ${since.where}, with ${p.run.freeIds.length} parameters free; since then they have moved by up to ${moved.toFixed(1)} esd`;
  }
  return {
    ...(earlier ? { earlier } : {}),
    convergence: read.converged ? "converged" : read.nearly ? "close" : "not converged",
    walkers: p.run.resume.q.length,
    steps: p.run.resume.stepIndex,
    samples: p.run.diagnostics.nSamples,
    maxRHat: p.run.diagnostics.maxRHat,
    minEss: p.run.diagnostics.minEss,
    rows: read.rows.map((r) => ({
      label: r.label,
      refined: r.refined,
      ...(r.esd !== undefined ? { esd: r.esd } : {}),
      median: r.median,
      ci68: r.ci68,
      ci95: r.ci95,
      ...(r.esdRatio !== undefined ? { esdRatio: r.esdRatio } : {}),
      verdict: r.verdict,
    })),
    differences: read.converged || read.nearly ? differenceSentences(p.run, p.parameters, p.compare) : [],
  };
}

export interface AgentReportArgs {
  readonly page: AgentPage;
  /** The page's own report (powderReportInput / pdfReportInput). */
  readonly input: ReportInput;
  readonly history: ProjectHistory | null;
  readonly record: AgentRecord;
  /** The page's engine checks (powderReportChecks / pdfReportChecks). */
  readonly checks: readonly ReportCheck[];
  /**
   * The Agent's last posterior run on this analysis: whether it sampled the
   * refinement on screen, the History step it sampled, and the parameters now.
   */
  readonly posterior: { readonly run: PosteriorRun; readonly current: boolean; readonly stepId: string | null; readonly parameters: readonly RefinementParameter[] } | null;
  /** The model and how it was reached. */
  readonly model: string;
  /** The Agent's own account. */
  readonly narrative: string;
  readonly date?: Date;
}

/** Build the report: its input, the Agent section, the HTML and the Markdown, and the audit. */
export function buildAgentReport(a: AgentReportArgs): { input: ReportInput; agent: ReportAgent; html: string; markdown: string; unverified: string[] } {
  const progress = methodProgress(a.page, a.record);
  const { steps, otherBranches, rowOf } = historySteps(a.page, a.history);
  const checks = [...a.checks, ...recordChecks(a.page, a.record)];
  const left = stagesLeft(a.page, a.record);
  // An earlier run is placed by its row in the steps table, the reader's own reference.
  const where = (id: string | null): string => {
    const row = id ? rowOf.get(id) : undefined;
    return row !== undefined ? `step ${row} of the table (${steps[row - 1]!.label})` : id ? "a step on a branch the analysis left" : "an earlier refinement";
  };
  const posterior = a.posterior ? reportPosterior(a.posterior.run, a.posterior.current ? null : { where: where(a.posterior.stepId), parameters: a.posterior.parameters }) : null;
  const openIssues = [
    ...(left.length > 0 ? [`Method stages not yet refined to convergence: ${left.join(", ")}.`] : []),
    ...checks.filter((c) => c.status === "warn").map((c) => `${c.name}: ${c.detail}`),
    ...(posterior && posterior.convergence !== "converged" ? ["The Bayesian check has not converged: its intervals are not final."] : []),
  ];
  const base: ReportAgent = {
    model: a.model,
    method: { skill: progress.skill, stages: progress.stages.map((s) => ({ label: s.label, done: s.done, optional: s.optional })) },
    steps,
    agreementLabel: a.page === "pdf" ? "Rw" : a.page === "singleCrystal" ? "wR2" : "wR",
    ...(otherBranches > 0 ? { otherBranches } : {}),
    checks,
    posterior,
    openIssues,
    notes: a.record.notes.map((n) => n.text),
  };
  const date = a.date ?? new Date();
  // What the report computed: no figure (its data URI), and none of the Agent's
  // own words — the account, its notes, the reasons it gave for an exception.
  const engineText = reportMarkdown({ ...a.input, date, figure: null, agent: { ...base, notes: [], checks: checks.filter((c) => c.name !== "Method exception") } });
  const narrative = a.narrative.trim();
  const unverified = unverifiedNumbers([narrative, ...base.notes].join("\n\n"), engineText);
  const agent: ReportAgent = { ...base, narrative, unverified };
  const input: ReportInput = { ...a.input, date, agent };
  return { input, agent, html: reportHtml(input), markdown: reportMarkdown(input), unverified };
}

/** "<title>_agent_report", the title reduced to a safe token. */
export function reportFileBase(title: string): string {
  const token = title.normalize("NFKD").replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${token.length >= 2 ? token : "analysis"}_agent_report`;
}
