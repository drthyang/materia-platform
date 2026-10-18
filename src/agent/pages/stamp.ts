/**
 * The pieces every page's stamp is made of (types.ts, PageAdapter.stamp).
 */

import type { RefinementParameter } from "@/core/refinement/types";

/** A short, stable hash of a string (FNV-1a, 32 bits, as hex): the stamps and the situation's fingerprint. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** A value to six figures, so a round trip through the page does not move a stamp. */
export const sig6 = (v: number): number => (Number.isFinite(v) ? Number(v.toPrecision(6)) : v);

/** The rows as a change reads them: free or fixed, tied, and their values. */
export const rowsOf = (parameters: readonly RefinementParameter[]): unknown[] => parameters.map((p) => [p.id, p.fixed ? 0 : 1, p.expression ?? "", sig6(p.value)]);

/** A stamp of these parts: the rows and the page's own settings. */
export const stampOf = (parameters: readonly RefinementParameter[], settings: Record<string, unknown>): string => hashText(JSON.stringify({ parameters: rowsOf(parameters), ...settings }));
