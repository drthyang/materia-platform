/**
 * A reflection list past the engine's limit (core/diffraction/reflections.ts
 * generateReflections: never truncated, it throws a ReflectionLimitError) on
 * the powder page. A calibration far from the data's (another bank's, held on
 * a data bank its instrument file lacks) or a large cell can reach a short d
 * where the list is too large to calculate. The page then says so in one
 * plain sentence, in the plot area and the Validation view, and holds Refine;
 * the cards and the bank chooser stay usable. The Agent reads the same
 * sentence (get_state, and refine's refusal). Pure: the shell and the Agent's
 * page call these.
 */

import { ReflectionLimitError, generateReflections, type ReflectionLimitOver } from "@/core/diffraction/reflections";
import { reflectionDRange } from "@/core/workflow/powder";
import { appliedPhases, type ShortDPage, type Window } from "@/app/shortD";

/** The reading, or the limit it passed (a ReflectionLimitError); any other error is thrown. */
export function readWithinLimit<T>(read: () => T): { readonly value: T } | { readonly error: ReflectionLimitError } {
  try {
    return { value: read() };
  } catch (e) {
    if (e instanceof ReflectionLimitError) return { error: e };
    throw e;
  }
}

/** The reading, or null when it passes the engine's reflection limit (ReflectionLimitError); anything else is thrown. */
export function withinReflectionLimit<T>(read: () => T): T | null {
  const r = readWithinLimit(read);
  return "value" in r ? r.value : null;
}

/**
 * The first of the page's nuclear reflection lists (each phase's, over the
 * range its curve and ticks use: core/workflow/powder.ts reflectionDRange,
 * following the window) that passes the limit, or null when every one is
 * within it. The lists are the engine's own (memoized), so a list within the
 * limit is the one the curves then read.
 */
export function pageReflectionLimit(p: ShortDPage, window: Window | null): ReflectionLimitOver | null {
  if (p.pattern.points.length === 0) return null;
  for (const a of appliedPhases(p)) {
    const { dMin, dMax } = reflectionDRange(p.pattern, a, window ?? undefined);
    const r = readWithinLimit(() => generateReflections(a.model.cell, a.model.spaceGroup, dMin, dMax));
    if ("error" in r && r.error.over) return r.error.over;
  }
  return null;
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** 1.5×10⁸: two significant figures, a trailing zero dropped. */
export function timesTen(n: number): string {
  const [m, e] = n.toExponential(1).split("e");
  const mantissa = m!.replace(/\.0$/, "");
  const exp = Number(e);
  const digits = String(Math.abs(exp)).split("").map((c) => SUPERSCRIPT[Number(c)]).join("");
  return `${mantissa}×10${exp < 0 ? "⁻" : ""}${digits}`;
}

const fmtD = (d: number): string => d.toFixed(d < 1 ? 3 : 2);

/** "1.5×10⁸ hkl to scan", "Miller indices up to 2100", "more than 3×10⁵ reflections". */
function sizeOf(over: ReflectionLimitOver): string {
  if (over.limit === "scan") return `${timesTen(over.count)} hkl to scan`;
  if (over.limit === "index") return `Miller indices up to ${over.count}`;
  return `more than ${timesTen(over.max)} reflections`;
}

/** Where the page's data come from, for the sentence. */
export interface LimitContext {
  /** The data's bank, when the data file has several. */
  readonly dataBank: number | null;
  /** The instrument file has no bank for it: the page holds another bank's calibration. */
  readonly uncovered: boolean;
}

/**
 * The page's sentence, the Agent's too: "Bank 6's data at this instrument
 * calibration reach d 0.039 Å: 1.5×10⁸ hkl to scan, over the limit. Load the
 * instrument file for bank 6, or narrow the window."
 */
export function reflectionLimitSentence(over: ReflectionLimitOver, ctx: LimitContext): string {
  const who = ctx.dataBank !== null ? `Bank ${ctx.dataBank}'s data` : "The data";
  const advice = ctx.dataBank !== null && ctx.uncovered
    ? `Load the instrument file for bank ${ctx.dataBank}, or narrow the window.`
    : "Load a matching instrument file, or narrow the window.";
  return `${who} at this instrument calibration reach d ${fmtD(over.dMin)} Å: ${sizeOf(over)}, over the limit. ${advice}`;
}

/** The width note's form: "the data reach d 0.039 Å, 1.5×10⁸ hkl to scan" (app/tofWidthNote.ts). */
export function reachText(over: ReflectionLimitOver): string {
  return `the data reach d ${fmtD(over.dMin)} Å, ${sizeOf(over)}`;
}
