/**
 * Evidence a final answer needs before the chat lets it stand. A rule
 * applies to a reply that concludes a question of one kind (the user asked
 * it, the reply answers it) and is satisfied by the tool that gives the
 * evidence for it; an answer without that tool is sent back to the model
 * once, with what to run (chat.ts, beside the stall guard).
 *
 * A rule reads the message's call log: each call with what it came to and
 * whether the fit on screen changed (the executor says, comparing the fit
 * before and after). Evidence counts only from a call that answered, and a
 * reading counts only when it was taken after the last change of the fit: a
 * refinement that was refused or declined changed nothing.
 *
 * The rules: on the PDF page, the local structure against the average one is
 * answered from a boxcar scan (box by box over r), never from the full fit
 * over one window, which cannot tell them apart; on the single-crystal page,
 * a word on the hand needs the absolute-structure reading of the refinement
 * as it stands; on any page, a grade of a fit refined in this message needs
 * its assessment first. And a grade of the fit that contradicts the engine's
 * verdict is sent back to be quoted from the engine (gradeContradiction;
 * chat.ts asks the runner for the verdict).
 */

import type { ToolStatus } from "@/agent/executor";
import { liveTool, type Evidence } from "@/agent/tools";

export type EvidencePage = "powder" | "pdf" | "singleCrystal";

/** One call of this message, as the chat logs it. */
export interface CallRecord {
  readonly name: string;
  /** What it came to (ok, refused, declined, unchanged, error, stopped). */
  readonly status: ToolStatus;
  /** The fit on screen is another one after it. */
  readonly fitChanged: boolean;
}

export interface EvidenceRule {
  readonly id: string;
  readonly pages: readonly EvidencePage[];
  /** The reply concludes what the user asked, of this kind. */
  readonly applies: (reply: string, asked: string) => boolean;
  /** The calls of this message include the evidence. */
  readonly satisfied: (log: readonly CallRecord[]) => boolean;
  /** What the model is told (from the app, not the user). */
  readonly nudge: string;
  /** What the user is told. */
  readonly notice: string;
}

/** The fit changed in this message. */
const fitChanged = (log: readonly CallRecord[]): boolean => log.some((c) => c.fitChanged);

/** The call answered, and its tool gives this evidence (its definition's `evidence`). */
const gives = (c: CallRecord, evidence: Evidence): boolean => c.status === "ok" && !!liveTool(c.name)?.evidence?.includes(evidence);

/** A call that gives this evidence answered after the last change of the fit in this message (anywhere in it, when the fit did not change). */
function givenSinceFitChanged(log: readonly CallRecord[], evidence: Evidence): boolean {
  let last = -1;
  log.forEach((c, i) => {
    if (c.fitChanged) last = i;
  });
  return log.some((c, i) => i > last && gives(c, evidence));
}

/** The user asks about the local structure against the average (or how it depends on r). */
export const LOCAL_QUESTION = /\blocal(ly)?\b[^.?!]{0,60}\b(average|differ|same|structure|geometry|coordination|distort)|\baverage\b[^.?!]{0,60}\blocal(ly)?\b|\br[- ]dependen(t|ce)\b|\bdepend(s|ence)? on r\b|\b(low|short)[- ]r\b[^.?!]{0,60}\b(high|long)[- ]r\b/i;
/** The reply concludes about it. */
export const LOCAL_CONCLUSION = /\b(the )?local (structure|geometry|coordination|distortion)\b[^.?!]{0,80}\b(differs?|same|matches|agrees?|average|holds|persists|vanishes)/i;

export const EVIDENCE_RULES: readonly EvidenceRule[] = [
  {
    id: "local-structure",
    pages: ["pdf"],
    applies: (reply, asked) => LOCAL_QUESTION.test(asked) && LOCAL_CONCLUSION.test(reply),
    satisfied: (log) => log.some((c) => gives(c, "localStructure")),
    nudge: "(From the app, not the user.) Your answer is about the local structure against the average one, but no boxcar scan ran for this question. The full fit over one window cannot tell them apart: run boxcar_scan (with `bonds` for the lengths the question is about), then answer from the boxes. If the scan cannot run, say why instead of answering.",
    notice: "The answer concluded about the local structure without a boxcar scan; the app asked for the scan first.",
  },
  {
    id: "hand",
    pages: ["singleCrystal"],
    applies: (reply) => /\b(absolute structure|the hand|enantiomer|enantiomorph|Flack x|Flack parameter|inverted (model|hand))\b/i.test(reply),
    satisfied: (log) => givenSinceFitChanged(log, "absoluteStructure"),
    nudge: `(From the app, not the user.) Your answer speaks of the hand, but the absolute-structure reading (Parsons' x with its esd, the Bijvoet signs) was not taken on the refinement as it stands. Call assess_refinement and answer from its absoluteStructure reading, with its esd.`,
    notice: "The answer spoke of the hand without the absolute-structure reading of the refinement as it stands; the app asked for it first.",
  },
  {
    id: "fit-grade",
    pages: ["powder", "pdf", "singleCrystal"],
    applies: (reply) => gradeIn(reply) !== null,
    // Only a fit that changed in this message needs its assessment before it is graded.
    satisfied: (log) => !fitChanged(log) || givenSinceFitChanged(log, "assessment"),
    nudge: `(From the app, not the user.) Your answer grades the fit, but it was refined after the last assessment. Call assess_refinement and quote its verdict ({{verdict}}); the grade is the engine's.`,
    notice: "The answer graded a fit refined since its last assessment; the app asked for the assessment first.",
  },
];

const BANDS = ["excellent", "good", "fair", "poor", "unreliable"] as const;
export type Band = (typeof BANDS)[number];

/** The grade a text gives the fit ("a good fit", "the refinement is excellent"), or null when it gives none. */
export function gradeIn(text: string): Band | null {
  const word = "(excellent|good|fair|poor|unreliable)";
  const noun = "(fit|refinement|agreement)";
  // "an excellent fit", "a good refinement"; "the fit is poor", "the refinement looks good".
  const m = new RegExp(`\\b${word}\\s+${noun}\\b`, "i").exec(text) ?? new RegExp(`\\b${noun}\\s+(is|was|looks|reads|remains|stays)\\s+(very\\s+|now\\s+)?${word}\\b`, "i").exec(text);
  if (!m) return null;
  const found = m.slice(1).find((g) => g !== undefined && (BANDS as readonly string[]).includes(g.toLowerCase()));
  return (found?.toLowerCase() as Band | undefined) ?? null;
}

/**
 * A grade of the fit that contradicts the engine's verdict, as the model is
 * told it; null when the text gives none, or the engine's own. "good" and
 * "excellent" are not told apart from each other's neighbours by a model's
 * prose alone, so only a grade two or more bands away, or one across the
 * line between fair and good, counts as a contradiction.
 */
export function gradeContradiction(text: string, engineBand: string | null): string | null {
  if (!engineBand || !(BANDS as readonly string[]).includes(engineBand)) return null;
  const said = gradeIn(text);
  if (said === null || said === engineBand) return null;
  const rank = (b: string): number => BANDS.indexOf(b as Band);
  const apart = Math.abs(rank(said) - rank(engineBand));
  const crosses = (rank(said) <= 1) !== (rank(engineBand) <= 1);
  if (apart < 2 && !crosses) return null;
  return `calls the fit "${said}", but the engine's verdict on it is "${engineBand}"`;
}

/** The first rule that applies to this answer on this page, is not satisfied and has not fired yet; else null. */
export function evidenceGate(reply: string, asked: string, log: readonly CallRecord[], page: EvidencePage | null, fired: ReadonlySet<string>): EvidenceRule | null {
  if (page === null || !reply.trim()) return null;
  return EVIDENCE_RULES.find((r) => r.pages.includes(page) && !fired.has(r.id) && r.applies(reply, asked) && !r.satisfied(log)) ?? null;
}
