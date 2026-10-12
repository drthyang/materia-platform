/**
 * Evidence a final answer needs before the chat lets it stand. A rule
 * applies to a reply that concludes a question of one kind (the user asked
 * it, the reply answers it) and is satisfied by the tool that gives the
 * evidence for it; an answer without that tool is sent back to the model
 * once, with what to run (chat.ts, beside the stall guard).
 *
 * The one rule so far: on the PDF page, the local structure against the
 * average one is answered from a boxcar scan (box by box over r), never from
 * the full fit over one window, which cannot tell them apart.
 */

export type EvidencePage = "powder" | "pdf" | "singleCrystal";

export interface EvidenceRule {
  readonly id: string;
  readonly pages: readonly EvidencePage[];
  /** The reply concludes what the user asked, of this kind. */
  readonly applies: (reply: string, asked: string) => boolean;
  /** The tools that ran for this message include the evidence. */
  readonly satisfied: (ran: readonly string[]) => boolean;
  /** What the model is told (from the app, not the user). */
  readonly nudge: string;
  /** What the user is told. */
  readonly notice: string;
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
    satisfied: (ran) => ran.includes("boxcar_scan"),
    nudge: "(From the app, not the user.) Your answer is about the local structure against the average one, but no boxcar scan ran for this question. The full fit over one window cannot tell them apart: run boxcar_scan (with `bonds` for the lengths the question is about), then answer from the boxes. If the scan cannot run, say why instead of answering.",
    notice: "The answer concluded about the local structure without a boxcar scan; the app asked for the scan first.",
  },
];

/** The first rule that applies to this answer on this page, is not satisfied and has not fired yet; else null. */
export function evidenceGate(reply: string, asked: string, ran: readonly string[], page: EvidencePage | null, fired: ReadonlySet<string>): EvidenceRule | null {
  if (page === null) return null;
  return EVIDENCE_RULES.find((r) => r.pages.includes(page) && !fired.has(r.id) && r.applies(reply, asked) && !r.satisfied(ran)) ?? null;
}
