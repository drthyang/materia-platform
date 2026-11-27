/**
 * A TOF calibration term on the Instrument card's line: two decimals (difA
 * −23.08, Zero −3.20 µs), two significant figures when smaller than 0.01,
 * with a real minus sign. Page only: get_state gives the numbers as read.
 */
export function calNumber(v: number): string {
  const t = v === 0 || Math.abs(v) >= 0.01 ? v.toFixed(2) : v.toPrecision(2);
  return t.startsWith("-") ? `−${t.slice(1)}` : t;
}
