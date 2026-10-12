/**
 * The number audit of a report's narrative. Every number in a MATERIA report
 * comes from the engine and the project's History, except what the Agent
 * writes in its own account. This finds the decimal numbers in that account
 * that match no value the report computed, so the renderers can mark them
 * (and the Agent can correct them before the report is final).
 *
 * A narrative number matches an engine value when the value rounds to it at
 * the narrative's precision ("9.9" matches 9.93), as a fraction or a
 * percentage (0.2214 matches "22.14"), and whatever its sign (a difference
 * may be written either way round). A narrative number more precise than the
 * report's matches when it rounds to the report's value ("2.9992" matches a
 * printed 2.999: the tools gave the Agent more digits than the report shows),
 * provided the report's value has a decimal and two significant digits, so a
 * printed "1" or "0.9" vouches for nothing finer. Integers are not audited:
 * counts, temperatures and hkl indices would only add noise.
 */

/** A decimal number standing alone: not part of a word, a version string or a longer number. A full stop after it ends the sentence. */
export const NUMBER_TOKEN = /(?<![\w.])\d+\.\d+(?!\.?\d)/g;

/** Any number in the engine's text, integers included (a narrative "2.0" may match an engine "2"). */
const ANY_NUMBER = /(?<![\w.])\d+(?:\.\d+)?(?!\.?\d)/g;

interface Token {
  readonly text: string;
  readonly value: number;
  readonly decimals: number;
}

function tokens(text: string): Token[] {
  return [...text.matchAll(NUMBER_TOKEN)].map((m) => ({ text: m[0], value: Number(m[0]), decimals: m[0].split(".")[1]!.length }));
}

/** The engine's values, as fractions and as percentages. */
function engineValues(engineText: string): number[] {
  const out: number[] = [];
  for (const m of engineText.matchAll(ANY_NUMBER)) {
    const v = Number(m[0]);
    if (!Number.isFinite(v)) continue;
    out.push(v, v * 100, v / 100);
  }
  return out.sort((a, b) => a - b);
}

/** The engine's printed decimals precise enough to vouch for a finer number: a decimal and two significant digits. */
function printedValues(engineText: string): Token[] {
  const out: Token[] = [];
  for (const m of engineText.matchAll(NUMBER_TOKEN)) {
    const decimals = m[0].split(".")[1]!.length;
    const significant = m[0].replace(".", "").replace(/^0+/, "").length;
    if (significant < 2) continue;
    const value = Number(m[0]);
    // As printed, and as a percentage or a fraction of it (0.2214 ↔ 22.14).
    out.push({ text: m[0], value, decimals });
    if (decimals > 2) out.push({ text: m[0], value: value * 100, decimals: decimals - 2 });
    out.push({ text: m[0], value: value / 100, decimals: decimals + 2 });
  }
  return out;
}

/** Whether `t`, more precise than a printed value, rounds to it at the printed precision. */
function roundsToPrinted(t: Token, printed: readonly Token[]): boolean {
  return printed.some((e) => e.decimals < t.decimals && Math.abs(t.value - e.value) <= 0.5 * 10 ** -e.decimals + 1e-9 * Math.max(1, t.value));
}

/** Whether a value in `sorted` rounds to `t` at its precision. */
function matches(t: Token, sorted: readonly number[]): boolean {
  const half = 0.5 * 10 ** -t.decimals + 1e-9 * Math.max(1, t.value);
  // Binary search for the first value ≥ t − half.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < t.value - half) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo]! <= t.value + half;
}

/**
 * The decimal numbers in `narrative` that match no number in `engineText`
 * (each once, in order of appearance). Signs are ignored: the token is the
 * number's digits.
 */
export function unverifiedNumbers(narrative: string, engineText: string): string[] {
  const values = engineValues(engineText);
  let printed: Token[] | null = null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens(narrative)) {
    if (seen.has(t.text)) continue;
    seen.add(t.text);
    if (matches(t, values)) continue;
    printed ??= printedValues(engineText);
    if (!roundsToPrinted(t, printed)) out.push(t.text);
  }
  return out;
}

/** Wrap each unverified token in `text` (already escaped for its format) with `mark`. */
export function markNumbers(text: string, unverified: readonly string[], mark: (token: string) => string): string {
  if (unverified.length === 0) return text;
  const set = new Set(unverified);
  return text.replace(NUMBER_TOKEN, (m) => (set.has(m) ? mark(m) : m));
}
