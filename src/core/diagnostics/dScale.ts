/**
 * One factor on every d: what a wrong wavelength (constant wavelength) or a
 * wrong difC (time of flight) does to a powder pattern. Every line lands at
 * f·d of the structure's reflection, too far for a Le Bail fit that starts at
 * the structure's cell to follow once f is off by more than a line width.
 * This finds the pattern's own peaks and the factor that indexes them best.
 */

/** A peak of the observed pattern: its d (Å) and its height above the local floor. */
export interface ObservedPeak {
  readonly d: number;
  readonly height: number;
}

/**
 * The pattern's strongest peaks: points that are the highest within ±`half`
 * points and stand `minSigma` σ above the lowest point of that window. At
 * most `limit`, strongest first.
 */
export function observedPeaks(d: readonly number[], y: readonly number[], sigma: readonly number[], { half = 6, minSigma = 10, limit = 30 } = {}): ObservedPeak[] {
  const out: ObservedPeak[] = [];
  for (let i = half; i < y.length - half; i++) {
    const v = y[i]!;
    let top = true;
    let floor = Infinity;
    for (let j = i - half; j <= i + half && top; j++) {
      if (j !== i && y[j]! > v) top = false;
      floor = Math.min(floor, y[j]!);
    }
    const s = sigma[i]! > 0 ? sigma[i]! : Math.sqrt(Math.max(v, 1));
    if (top && Number.isFinite(d[i]!) && d[i]! > 0 && v - floor >= minSigma * s) out.push({ d: d[i]!, height: v - floor });
  }
  return out.sort((a, b) => b.height - a.height).slice(0, limit);
}

export interface DScaleReading {
  /** The factor that indexes the most peak height: observed d = f · the structure's d. */
  readonly factor: number;
  /** Share of the peaks' height it indexes, and the best share within ±0.3 % of 1. */
  readonly indexed: number;
  readonly indexedAtOne: number;
  readonly peaks: number;
}

/**
 * The factor in [0.85, 1.18] whose scaled reflections index the most peak
 * height (a peak indexes within `tolerance`·d of a reflection's f·d), and
 * how much the best factor near 1 indexes.
 */
export function dScaleSearch(peaks: readonly ObservedPeak[], reflectionsD: readonly number[], tolerance = 0.0015): DScaleReading | null {
  if (peaks.length < 4 || reflectionsD.length === 0) return null;
  const sorted = [...reflectionsD].sort((a, b) => a - b);
  const total = peaks.reduce((t, p) => t + p.height, 0);
  // The height indexed at f, and the height-weighted mean relative miss of the indexed peaks (the tie-break: the centre of a plateau).
  const share = (f: number): { s: number; miss: number } => {
    let hit = 0;
    let miss = 0;
    for (const p of peaks) {
      const target = p.d / f;
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid]! < target) lo = mid + 1;
        else hi = mid;
      }
      const near = Math.min(Math.abs((sorted[lo] ?? Infinity) - target), Math.abs((sorted[lo - 1] ?? Infinity) - target));
      if (near <= tolerance * target) {
        hit += p.height;
        miss += p.height * (near / target);
      }
    }
    return { s: hit / total, miss: hit > 0 ? miss / hit : Infinity };
  };
  let best = { f: 1, s: -1, miss: Infinity };
  let atOne = 0;
  for (let f = 0.85; f <= 1.18; f += 0.0001) {
    const { s, miss } = share(f);
    if (Math.abs(f - 1) <= 0.003) atOne = Math.max(atOne, s);
    else if (s > best.s + 1e-9 || (Math.abs(s - best.s) <= 1e-9 && miss < best.miss)) best = { f, s, miss };
  }
  return { factor: best.f, indexed: best.s, indexedAtOne: atOne, peaks: peaks.length };
}

/** Whether the reading says one factor on every d: most of the height indexed away from 1, little at 1. */
export function wrongScale(r: DScaleReading | null): r is DScaleReading {
  return r !== null && r.indexed >= 0.8 && r.indexedAtOne <= 0.5 && r.indexed >= r.indexedAtOne + 0.3;
}
