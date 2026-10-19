/** A number to `digits` significant figures, as a number (the tools' rounding); a non-finite value as it is. */
export function sig(v: number, digits = 6): number {
  return Number.isFinite(v) ? Number(v.toPrecision(digits)) : v;
}
