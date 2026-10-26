/**
 * The assessment's physical, at-bound and moderate-correlation findings
 * (assessment.ts) in the pages' own words: one short line each, the result or
 * the action first, built from the finding's structured fields (its category,
 * parameter, evidence) and the rows — never by editing its summary.
 *
 *   B1 is resting on its min bound (0).               → B1 hit its lower bound (0) → find the cause
 *   Mn1 occ is held at 1.0500, outside [0, 1].        → Mn1 occ held at 1.05, outside [0, 1] → correct the input
 *   W1 B refined negative (-0.0123) — an unphysical … → W1 B refined negative (-0.0123) → hold it positive, find the cause
 *   2 pairs correlate at |ρ| 0.8–0.95: …              → 2 pairs correlate, |ρ| up to 0.86 → report each with ρ
 *
 * A B on its lower bound with the B-at-0 rule's proposal, or a fix of that
 * rule in force, reads as zeroAdpLines.ts words it. The finding's own summary
 * and detail move to `detail`, behind a "?" and in the report's appendix.
 *
 * UI only. The Agent reads the findings as assessment.ts writes them, frozen
 * (agentVisibleText.test.ts); nothing here reaches it. Null: a finding this
 * module does not reword (its summary is short already, or it is another
 * kind), shown as it stands.
 */

import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { AssessmentFinding } from "@/core/diagnostics/assessment";
import type { ZeroAdpFix, ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";
import { zeroAdpFixLine, zeroAdpProposalLine, type ShortLine } from "@/core/diagnostics/zeroAdpLines";

export interface FindingContext {
  readonly parameters: readonly RefinementParameter[];
  /** The fit the findings read: a tied B's value is its leader's, with its esd. */
  readonly result?: RefinementResult | null;
  /** The B-at-0 rule on the page: the proposals for the B's on their bound and the fixes in force. */
  readonly zeroAdp?: { readonly proposals: readonly ZeroAdpProposal[]; readonly applied: readonly ZeroAdpFix[] } | undefined;
}

/** A value as the short line gives it: four decimals at most, no trailing zeros ("1.05", "-0.0123"). */
const short = (v: number): string => (Number.isFinite(v) ? String(+v.toFixed(4)) : "—");

/** The finding's own words, for the "?". */
const own = (f: AssessmentFinding): string[] => [f.summary, ...(f.detail ? [f.detail] : [])];

/** Where the at-bound finding's reading of the cause ends and the B-at-0 rule's advice begins (assessment.ts). */
const RULE_MARK = " The B-at-0 rule: ";

/** The finding in a short line of the page's own, or null to show it as it stands. */
export function findingLine(f: AssessmentFinding, ctx: FindingContext): ShortLine | null {
  const id = f.parameterIds?.length === 1 ? f.parameterIds[0]! : undefined;
  const p = id !== undefined ? ctx.parameters.find((q) => q.id === id) : undefined;
  const label = p?.label ?? id ?? "";
  const ev = f.evidence ?? {};
  if (f.category === "at-bound" && id !== undefined) {
    // A fix of the B-at-0 rule in force (its note carries the rule and the B it reached).
    if (ev.rule !== undefined && ev.reached !== undefined) {
      const fix = ctx.zeroAdp?.applied.find((x) => x.parameterId === id);
      return fix ? zeroAdpFixLine(fix, ctx) : null;
    }
    // A twin domain at 0 is a finding about the crystal, already in a few words.
    if (p?.kind === "twinFraction") return null;
    const bound = ev.bound === "min" ? "lower" : ev.bound === "max" ? "upper" : null;
    if (bound === null || typeof ev.value !== "number") return null;
    const proposal = ev.proposal !== undefined && ev.bound === "min" ? ctx.zeroAdp?.proposals.find((z) => z.parameterId === id) : undefined;
    if (proposal) {
      const line = zeroAdpProposalLine(proposal);
      const reading = (f.detail ?? "").split(RULE_MARK)[0]!;
      return { ...line, detail: [`${f.summary}${reading ? ` ${reading}` : ""}`, ...line.detail] };
    }
    return { text: `${label} hit its ${bound} bound (${short(ev.value)}) → find the cause`, detail: own(f) };
  }
  if (f.category === "physical" && p && typeof ev.value === "number" && f.summary.startsWith(p.label)) {
    const v = short(ev.value);
    const held = ev.origin === "input";
    if ((p.kind === "bIso" || p.kind === "uAniso") && ev.value < 0) {
      return { text: held ? `${label} held at ${v}, negative → correct the input` : `${label} refined negative (${v}) → hold it positive, find the cause`, detail: own(f) };
    }
    if (p.kind === "profileX" || p.kind === "profileY") {
      return { text: `${label} refined negative (${v}) → hold it at 0, refine U, V, W`, detail: own(f) };
    }
    if (p.kind === "occupancy") {
      return { text: held ? `${label} held at ${v}, outside [0, 1] → correct the input` : `${label} refined to ${v}, outside [0, 1] → constrain it`, detail: own(f) };
    }
    return null;
  }
  return null;
}

/**
 * The pairs from 0.8 up to the refusal limit (assessment.ts's moderate
 * correlation note): "O1 B ↔ O2 B: |ρ| 0.86 → report both with ρ", or
 * "3 pairs correlate, |ρ| up to 0.91 → report each with ρ". The pairs and
 * their coefficients go to `detail`.
 */
export function moderateCorrelationLine(f: AssessmentFinding, parameters: readonly RefinementParameter[]): ShortLine | null {
  const n = f.evidence?.pairs;
  const max = f.evidence?.maxCoefficient;
  if (f.category !== "correlation" || typeof n !== "number" || typeof max !== "number") return null;
  const ids = f.parameterIds ?? [];
  const name = (id: string): string => parameters.find((q) => q.id === id)?.label ?? id;
  const text = n === 1 && ids.length === 2
    ? `${name(ids[0]!)} ↔ ${name(ids[1]!)}: |ρ| ${max.toFixed(2)} → report both with ρ`
    : `${n} pairs correlate, |ρ| up to ${max.toFixed(2)} → report each with ρ`;
  return { text, detail: own(f) };
}
