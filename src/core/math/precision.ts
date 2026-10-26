/** A number to `digits` significant figures, as a number (the tools' rounding); a non-finite value as it is. */
export function sig(v: number, digits = 6): number {
  return Number.isFinite(v) ? Number(v.toPrecision(digits)) : v;
}

/** A fraction as a percentage with two decimals, the way the page shows wR. */
export function pct(f: number): number {
  return Math.round(f * 10000) / 100;
}
