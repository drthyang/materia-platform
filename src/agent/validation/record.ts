/**
 * A validation run as it is kept (docs/VALIDATION.md): every decision the run
 * made (the tool, its input, why — the Agent's own words before the call —
 * and what came back), every number it told the user with the engine value it
 * came from, its conclusion, and its score against the truth. Saved as JSON
 * (re-scored for free) and as a Markdown transcript a reviewer reads offline:
 * the case, the run step by step, the numbers, the score.
 */

import type { EvalRun, EvalUsage } from "@/agent/evals/harness";
import { tierFlags, type TierFlags } from "@/agent/evals/harness";
import { sentences } from "@/agent/evals/checks";
import type { CaseScore } from "@/agent/validation/scoring";
import type { ValidationCase } from "@/agent/validation/cases";

/** One decision a run made: a tool (or, in arm A, a button), its input, why, and what came back. */
export interface Decision {
  readonly step: number;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** The Agent's own words before the call (arm A: the scripted reason). */
  readonly why: string;
  /** What came back, shortened. */
  readonly outcome: string;
  readonly isError: boolean;
}

/** A number the run told the user, and where in the engine's output it came from. */
export interface ReportedNumber {
  readonly text: string;
  /** The sentence it is in. */
  readonly sentence: string;
  /** The step whose tool output holds a value it rounds from, and that value; null when none does. */
  readonly source: { readonly step: number; readonly tool: string; readonly value: number } | null;
}

export type Arm = "A" | "B" | "C";

export interface ValidationRecord {
  readonly case: string;
  readonly split: ValidationCase["split"];
  readonly arm: Arm;
  /** The model (arm A: "none"). */
  readonly model: string;
  /** 1-based run number within the case. */
  readonly run: number;
  readonly commit: string;
  readonly date: string;
  readonly message: string;
  readonly decisions: readonly Decision[];
  readonly numbers: readonly ReportedNumber[];
  /** The run's final word to the user (its last reply, or arm A's verdict). */
  readonly conclusion: string;
  /** The reports written, as Markdown (the engine's numbers resolved in them). */
  readonly reports: readonly string[];
  readonly score: CaseScore;
  readonly flags?: TierFlags;
  readonly usage?: EvalUsage;
  readonly costUsd?: number;
  readonly seconds: number;
  readonly notices: readonly string[];
}

const short = (text: string, max = 600): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The Agent's decisions from a run's events: each call with the words that preceded it. */
export function decisionsOf(run: Pick<EvalRun, "events">): Decision[] {
  const out: Decision[] = [];
  let said = "";
  for (const e of run.events) {
    if (e.kind === "user") said = "";
    else if (e.kind === "reply") said = e.text.trim() || said;
    else {
      out.push({ step: out.length + 1, tool: e.name, input: e.input, why: said, outcome: short(e.text), isError: e.isError });
      said = "";
    }
  }
  return out;
}

/** Numbers in a tool's output (JSON or text). */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)].map((m) => Number(m[0])).filter(Number.isFinite);
}

/** `said` is `value` as printed to its own precision (rounded, or a fraction given as a percentage). */
export function roundsFrom(said: string, value: number): boolean {
  const x = Number(said);
  const decimals = said.includes(".") ? said.split(".")[1]!.length : 0;
  const half = 0.5 * 10 ** -decimals + 1e-12;
  return Math.abs(value - x) <= half || Math.abs(100 * value - x) <= half;
}

/**
 * Every number with a decimal point (or of three digits and more) the run
 * said to the user, traced to the first tool output before it that holds a
 * value it rounds from. Integers below 100 (counts, Miller indices, steps)
 * are left out.
 */
export function traceNumbers(run: Pick<EvalRun, "events">): ReportedNumber[] {
  const outputs: { step: number; tool: string; values: number[] }[] = [];
  const out: ReportedNumber[] = [];
  for (const e of run.events) {
    if (e.kind === "call") {
      outputs.push({ step: outputs.length + 1, tool: e.name, values: numbersIn(e.text) });
      continue;
    }
    if (e.kind !== "reply") continue;
    for (const s of sentences(e.text)) {
      for (const m of s.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?/g)) {
        const t = m[0];
        if (!t.includes(".") && Math.abs(Number(t)) < 100) continue;
        const hit = outputs.find((o) => o.values.some((v) => roundsFrom(t, v)));
        const value = hit?.values.find((v) => roundsFrom(t, v));
        out.push({ text: t, sentence: short(s, 240), source: hit && value !== undefined ? { step: hit.step, tool: hit.tool, value } : null });
      }
    }
  }
  return out;
}

/** The record of an Agent run (arms B and C). */
export function agentRecord(args: {
  readonly c: ValidationCase; readonly arm: Arm; readonly model: string; readonly run: number; readonly commit: string;
  readonly message: string; readonly result: EvalRun; readonly score: CaseScore; readonly costUsd?: number;
}): ValidationRecord {
  const { result: r } = args;
  const replies = r.events.filter((e) => e.kind === "reply").map((e) => (e as { text: string }).text.trim()).filter(Boolean);
  return {
    case: args.c.id,
    split: args.c.split,
    arm: args.arm,
    model: args.model,
    run: args.run,
    commit: args.commit,
    date: new Date().toISOString(),
    message: args.message,
    decisions: decisionsOf(r),
    numbers: traceNumbers(r),
    conclusion: replies[replies.length - 1] ?? "",
    reports: r.reports.map((x) => x.markdown),
    score: args.score,
    flags: tierFlags(r),
    usage: r.usage,
    ...(args.costUsd !== undefined ? { costUsd: args.costUsd } : {}),
    seconds: r.seconds,
    notices: r.notices,
  };
}

/** Everything the Agent said, and its reports: the text its conclusion is scored on. */
export function agentConclusionText(r: Pick<EvalRun, "events" | "reports">): string {
  return [...r.events.filter((e) => e.kind === "reply").map((e) => (e as { text: string }).text), ...r.reports.map((x) => x.markdown)].join("\n");
}

const fmt = (v: number | null | undefined, digits = 4): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Number(v.toPrecision(digits)).toString());
const cell = (t: string): string => t.replace(/\|/g, "\\|").replace(/\n+/g, " ");

/** The run as a reviewer reads it: self-contained Markdown (the case, each step, the numbers, the score). */
export function transcriptMarkdown(rec: ValidationRecord, c: ValidationCase): string {
  const s = rec.score;
  const lines: string[] = [
    `# ${rec.case} · arm ${rec.arm} · ${rec.model} · run ${rec.run}`,
    "",
    `- **Split:** ${rec.split}${rec.split === "test" ? " (held out: report only; a fix waits until the failure is reproduced on a dev case)" : ""}`,
    `- **Commit:** ${rec.commit} · **date:** ${rec.date} · **time:** ${rec.seconds.toFixed(0)} s${rec.costUsd !== undefined ? ` · **cost:** $${rec.costUsd.toFixed(3)}` : ""}`,
    `- **Case:** ${c.title}`,
    `- **Source:** ${c.source}`,
    `- **Injected fault:** ${c.fault ? `${c.fault.kind}: ${c.fault.detail}` : "none"}`,
    "",
    "## What the user asked",
    "",
    `> ${rec.message}`,
    "",
    "## Steps",
    "",
  ];
  for (const d of rec.decisions) {
    lines.push(`### Step ${d.step}: \`${d.tool}\`${Object.keys(d.input).length ? ` ${cell(short(JSON.stringify(d.input), 300))}` : ""}${d.isError ? " (refused or failed)" : ""}`, "");
    if (d.why) lines.push(`*Why:* ${short(d.why, 800)}`, "");
    lines.push("```", short(d.outcome, 600), "```", "");
  }
  lines.push("## Conclusion", "", rec.conclusion || "(no final reply)", "");
  for (const [i, r] of rec.reports.entries()) lines.push(`## Report ${i + 1} (as rendered, engine values resolved)`, "", r, "");
  if (rec.numbers.length) {
    lines.push("## Numbers told to the user", "", "| number | traced to | sentence |", "| --- | --- | --- |");
    for (const n of rec.numbers) lines.push(`| ${n.text} | ${n.source ? `step ${n.source.step} \`${n.source.tool}\`: ${fmt(n.source.value, 6)}` : "**untraced**"} | ${cell(n.sentence)} |`);
    lines.push("");
  }
  lines.push("## Score", "", `**Conclusion: ${s.conclusion.pass ? "right" : "wrong"}** (${s.conclusion.why})`, "");
  if (s.recovery.scored) {
    lines.push("| value | truth | found | error | tolerance | |", "| --- | --- | --- | --- | --- | --- |");
    for (const v of s.recovery.values) lines.push(`| ${v.what} | ${fmt(v.truth, 6)} | ${fmt(v.found, 6)} | ${fmt(v.error, 3)} | ${v.relative ? `${v.tolerance} (relative)` : v.tolerance} | ${v.pass ? "✓" : "✗"} |`);
    lines.push("");
  } else lines.push("No value is scored: the fault needs the user before the model can be right.", "");
  lines.push(
    `- **Fault named:** ${s.fault.kind === null ? "n/a (none injected)" : s.fault.detected ? `yes: "${cell(short(s.fault.evidence ?? "", 200))}"` : "no"}`,
    `- **False alarms:** ${s.falseAlarms.length ? s.falseAlarms.map((a) => `${a.kind} ("${cell(short(a.evidence, 160))}")`).join("; ") : "none"}`,
    `- **Fit:** wR ${s.fit.wR === null ? "—" : `${(100 * s.fit.wR).toFixed(2)} %`}, GoF ${fmt(s.fit.gof, 3)}${s.fit.pass === null ? "" : s.fit.pass ? " (good)" : " (not good enough)"}`,
    `- **Unsafe outcomes:** ${s.unsafe.length ? s.unsafe.join("; ") : "none"}`,
  );
  if (rec.flags) lines.push(`- **Run flags:** turn cap ${rec.flags.turnCap ? "hit" : "no"}, loop stop ${rec.flags.loopStopped ? "yes" : "no"}, chat error ${rec.flags.chatError ? "yes" : "no"}, prompt cut ${rec.flags.truncated ? "yes" : "no"}, most repeats of one call ${rec.flags.maxSameCall}`);
  if (rec.notices.length) lines.push(`- **Notices:** ${rec.notices.map((n) => cell(short(n, 200))).join(" · ")}`);
  lines.push("");
  return lines.join("\n");
}
