/**
 * The first peak of an observed G(r), found from the data alone: where the
 * subgroup search's window starts (just below it) and where its first-peak
 * check refits from (just past it). THY-72, decisions 8 and 10.
 *
 * Below the first interatomic distance G(r) is the average-density line
 * −4πρ₀r (plus noise and the termination ripple); the peak is read against
 * that line, so a peak of either sign counts (a neutron Ti–O peak is
 * negative). The line's slope is taken from the data's own lowest points.
 *
 *  - The baseline slope: the least-squares slope through the origin of the
 *    points in the first BASELINE_SPAN Å of the data.
 *  - The first peak: the first local extremum of h(r) = G(r) − slope·r whose
 *    |h| reaches PEAK_FRACTION of the largest |h| at or below `rmax` and
 *    NOISE_MULTIPLE times the r.m.s. of h over the baseline span (the noise
 *    and ripple there), whichever is larger.
 *  - Its edges: the half-height crossings on each side (steep flanks, so
 *    noise moves them little); "just below" is the peak less twice the lower
 *    half width, "just past" the peak plus twice the upper half width (a
 *    Gaussian keeps 99 % of its area within ±2·HWHM). Both are snapped to the
 *    data's grid, the lower one never below the first point.
 */

/** The span (Å) at the start of the data the baseline slope is read from. */
export const BASELINE_SPAN = 0.3;
/** A peak counts once |h| reaches this fraction of the largest |h| in range … */
export const PEAK_FRACTION = 0.1;
/** … and this many times the r.m.s. of h over the baseline span. */
export const NOISE_MULTIPLE = 3;

export interface FirstPeak {
  /** The peak's position (Å). */
  readonly r: number;
  /** Its height above the average-density line (the sign of the peak). */
  readonly height: number;
  /** Just below the peak (Å): the search window's rmin. */
  readonly below: number;
  /** Just past the peak (Å): the first-peak check's rmin. */
  readonly past: number;
  /** The baseline slope −4πρ₀ read from the data (per Å). */
  readonly baselineSlope: number;
}

/** The first G(r) peak below `rmax` (Å), from the observed points; null when the data hold none. */
export function firstPeak(r: ArrayLike<number>, g: ArrayLike<number>, rmax = Infinity): FirstPeak | null {
  const n = r.length;
  if (n < 5) return null;
  const r0 = r[0]!;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n && r[i]! <= r0 + BASELINE_SPAN; i++) {
    sxy += r[i]! * g[i]!;
    sxx += r[i]! * r[i]!;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const h = new Float64Array(n);
  let top = 0;
  let base2 = 0;
  let baseN = 0;
  for (let i = 0; i < n; i++) {
    h[i] = g[i]! - slope * r[i]!;
    if (r[i]! <= rmax) top = Math.max(top, Math.abs(h[i]!));
    if (r[i]! <= r0 + BASELINE_SPAN) {
      base2 += h[i]! * h[i]!;
      baseN++;
    }
  }
  if (!(top > 0)) return null;
  const threshold = Math.max(PEAK_FRACTION * top, NOISE_MULTIPLE * Math.sqrt(base2 / Math.max(baseN, 1)));
  let k = -1;
  for (let i = 1; i < n - 1 && r[i]! <= rmax; i++) {
    const a = Math.abs(h[i]!);
    if (a >= threshold && a >= Math.abs(h[i - 1]!) && a >= Math.abs(h[i + 1]!) && Math.sign(h[i]!) === Math.sign(h[i - 1]!) && Math.sign(h[i]!) === Math.sign(h[i + 1]!)) {
      k = i;
      break;
    }
  }
  if (k < 0) return null;
  const peak = h[k]!;
  const half = Math.abs(peak) / 2;
  const crossing = (dir: -1 | 1): number => {
    for (let i = k; i + dir >= 0 && i + dir < n; i += dir) {
      const a = Math.abs(h[i]!) * Math.sign(h[i]! * peak);
      const b = Math.abs(h[i + dir]!) * Math.sign(h[i + dir]! * peak);
      if (b < half) return r[i]! + ((a - half) / (a - b)) * (r[i + dir]! - r[i]!);
    }
    return r[dir < 0 ? 0 : n - 1]!;
  };
  const lowHalf = r[k]! - crossing(-1);
  const highHalf = crossing(1) - r[k]!;
  const step = (r[n - 1]! - r0) / (n - 1);
  const snapDown = (x: number): number => r0 + Math.floor((x - r0) / step + 1e-9) * step;
  const snapUp = (x: number): number => r0 + Math.ceil((x - r0) / step - 1e-9) * step;
  return {
    r: r[k]!,
    height: peak,
    below: Math.max(r0, snapDown(r[k]! - 2 * lowHalf)),
    past: snapUp(r[k]! + 2 * highHalf),
    baselineSlope: slope,
  };
}
