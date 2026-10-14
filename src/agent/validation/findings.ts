/**
 * Findings: what a reviewer (a supervisor model reading the saved transcripts,
 * or a person) files against a validation run. One schema for every reviewer,
 * checked here, so the loop from a run to a fix is auditable:
 *
 * - a `bug` is fixed with a test and merged on green CI;
 * - a new tool (`missing-tool`) or a skill change (`skill-gap`) always waits
 *   for the user's approval (`needs_user_approval` must be true);
 * - a finding on a test-set run proposes nothing until the same failure is
 *   reproduced on a dev case (`reproduced_on`): the test set is never tuned on.
 */

import { caseById } from "@/agent/validation/cases";

export type FindingKind = "bug" | "missing-tool" | "skill-gap" | "orchestration" | "science-error";

export interface FindingEvidence {
  /** Transcript references: "<case>/<arm>/<model>/run<k>#step<n>" (or "#conclusion", "#report<n>"). */
  readonly refs: readonly string[];
  /** The numbers that show it, each with what it is ("wR 14.26 % at step 4"). */
  readonly numbers: readonly string[];
}

export interface Finding {
  readonly case: string;
  /** 1-based run number. */
  readonly run: number;
  /** The decision step it is about (0: the run as a whole). */
  readonly step: number;
  readonly kind: FindingKind;
  readonly evidence: FindingEvidence;
  /** What to change, or "" when nothing is proposed (a test-set finding not yet reproduced on a dev case). */
  readonly proposed_fix: string;
  readonly needs_user_approval: boolean;
  /** A dev case the failure was reproduced on: required before a test-set finding may propose a fix. */
  readonly reproduced_on?: string;
}

const KINDS: readonly FindingKind[] = ["bug", "missing-tool", "skill-gap", "orchestration", "science-error"];
const REF = /^[a-z0-9-]+\/[ABC]\/[^/]+\/run\d+#(step\d+|conclusion|report\d+)$/;

/** The problems with a finding, or [] when it may be filed. */
export function findingProblems(f: Finding): string[] {
  const out: string[] = [];
  const c = caseById(f.case);
  if (!c) out.push(`no case "${f.case}"`);
  if (!KINDS.includes(f.kind)) out.push(`kind must be one of ${KINDS.join(", ")}`);
  if (!Number.isInteger(f.run) || f.run < 1) out.push("run must be a run number from 1");
  if (!Number.isInteger(f.step) || f.step < 0) out.push("step must be a step number (0 for the whole run)");
  if (f.evidence.refs.length === 0) out.push("evidence needs at least one transcript reference");
  for (const r of f.evidence.refs) if (!REF.test(r)) out.push(`"${r}" is not a transcript reference (<case>/<arm>/<model>/run<k>#step<n>)`);
  if ((f.kind === "missing-tool" || f.kind === "skill-gap") && !f.needs_user_approval) out.push(`a ${f.kind} finding changes what the Agent is taught or can do: it needs the user's approval`);
  if (c?.split === "test" && f.proposed_fix.trim() !== "") {
    const dev = f.reproduced_on ? caseById(f.reproduced_on) : undefined;
    if (!dev || dev.split !== "dev") out.push("a test-set finding proposes a fix only once reproduced on a dev case (reproduced_on): the test set is never tuned on");
  }
  return out;
}

/** Parse and check a reviewer's findings (a JSON array); throws with every problem found. */
export function parseFindings(json: string): Finding[] {
  const list = JSON.parse(json) as Finding[];
  if (!Array.isArray(list)) throw new Error("findings must be a JSON array");
  const problems = list.flatMap((f, i) => findingProblems(f).map((p) => `finding ${i + 1}: ${p}`));
  if (problems.length) throw new Error(problems.join("\n"));
  return list;
}
