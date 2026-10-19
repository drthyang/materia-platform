/**
 * The least and greatest of a list of numbers, by a loop. `Math.min(...xs)`
 * passes every value as an argument, and a time-of-flight pattern's 10⁵–10⁶
 * points overflow the call stack.
 */

/** The least and greatest of `values`; an empty list gives +∞ and −∞. */
export function minMax(values: Iterable<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}
