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
import type { PowderPattern } from "@/core/diffraction/types";
import { reflectionRange, type PowderCurves } from "@/core/workflow/powder";
import { appliedPhases, type ShortDPage, type Window } from "@/app/shortD";
import { currentDataBank, dataBanksOf } from "@/app/bankChoice";

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
 * range its curve and ticks use: core/workflow/powder.ts reflectionRange,
 * following the window) that passes the limit, or null when every one is
 * within it. The lists are the engine's own (memoized), so a list within the
 * limit is the one the curves then read. Its `dMin` is the d the data reach
 * (the window's short-d edge, as the sentence says it); the count is the
 * list's, which reaches one peak support further.
 */
export function pageReflectionLimit(p: ShortDPage, window: Window | null): ReflectionLimitOver | null {
  if (p.pattern.points.length === 0) return null;
  for (const a of appliedPhases(p)) {
    const range = reflectionRange(p.pattern, a, window ?? undefined);
    const r = readWithinLimit(() => generateReflections(a.model.cell, a.model.spaceGroup, range.dMin, range.dMax));
    if ("error" in r && r.error.over) return { ...r.error.over, dMin: Math.max(r.error.over.dMin, range.windowD) };
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

/** The pattern's observed points with no calculated curve (zeros): what the page holds while its list is past the limit. */
export function observedOnlyCurves(pattern: PowderPattern): { nuclear: PowderCurves; curves: PowderCurves } {
  const x = pattern.points.map((p) => p.x);
  const yObs = pattern.points.map((p) => p.yObs);
  const zero = x.map(() => 0);
  const curves: PowderCurves = { x, yObs, yCalc: zero, yBackground: zero, diff: yObs.slice() };
  return { nuclear: curves, curves };
}

/**
 * The page's sentence when its list is past the limit, or null: the Agent's
 * headless page (the shell reads the same parts from its memos). The bank is
 * named when the data file has several; `uncovered`, the instrument file has
 * no bank for it (app/bankFollow.ts bankCoverage).
 */
export function pageLimitLine(
  p: ShortDPage & { readonly rawData?: { readonly name: string; readonly text: string; readonly bank?: number } },
  window: Window | null,
  uncovered: boolean,
): string | null {
  const over = pageReflectionLimit(p, window);
  if (!over) return null;
  const banks = dataBanksOf(p.rawData?.text);
  const bank = banks && banks.length > 1 ? currentDataBank(banks, p.rawData)?.bankNumber ?? null : null;
  return reflectionLimitSentence(over, { dataBank: bank, uncovered });
}
