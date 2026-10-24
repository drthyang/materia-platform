/**
 * Pure view maths for the interactive 1-D plots (the powder pattern, G(r), S(Q)):
 * the x window, cursor-anchored zoom, clamped pan, the wheel's zoom factor, the
 * data point under the cursor, the readout's precision, the reflection ticks
 * near the cursor, and the per-pixel-column decimation that keeps a redraw cheap
 * on a dense pattern. No DOM, no React: `usePlotInteraction` wires these to the
 * pointer, wheel and keyboard.
 *
 * Every readout here reads the data; nothing changes a value.
 */

import type { PhaseTicks } from "@/visualization/reflectionTicks";

/** An x window [min, max] in the plot's display unit (min < max). */
export interface XView {
  readonly min: number;
  readonly max: number;
}

/** Keep a window inside the data range: the span is held between `minSpan`
 *  and the full span, then the window is shifted (never shrunk) to fit. */
export function clampView(view: XView, domain: XView, minSpan: number): XView {
  const full = domain.max - domain.min;
  if (!(full > 0)) return domain;
  const span = Math.min(full, Math.max(Math.min(minSpan, full), view.max - view.min));
  let min = view.min;
  if (!Number.isFinite(min)) min = domain.min;
  if (min < domain.min) min = domain.min;
  if (min + span > domain.max) min = domain.max - span;
  return { min, max: min + span };
}

/**
 * Zoom by `factor` (< 1 zooms in) about the data value `anchor`, which keeps its
 * fraction of the window — the point under the cursor stays under the cursor.
 * The span is clamped first and the anchor kept against the clamped span; only
 * at a data edge does the shift that keeps the window inside the data move it.
 */
export function zoomAt(view: XView, anchor: number, factor: number, domain: XView, minSpan: number): XView {
  const span = view.max - view.min;
  const full = domain.max - domain.min;
  if (!(span > 0) || !(full > 0) || !Number.isFinite(factor) || factor <= 0) return view;
  const next = Math.min(full, Math.max(Math.min(minSpan, full), span * factor));
  const frac = (anchor - view.min) / span;
  const min = anchor - frac * next;
  return clampView({ min, max: min + next }, domain, minSpan);
}

/** Shift the window by `dx` data units, clamped to the data (span unchanged). */
export function panBy(view: XView, dx: number, domain: XView): XView {
  return clampView({ min: view.min + dx, max: view.max + dx }, domain, view.max - view.min);
}

/** True when the window shows the whole data range (to a part in 10⁹ of it). */
export function isFullView(view: XView, domain: XView): boolean {
  const tol = 1e-9 * Math.abs(domain.max - domain.min || 1);
  return view.min <= domain.min + tol && view.max >= domain.max - tol;
}

/**
 * The zoom factor of one wheel event: exp(Δ/100), Δ normalised to pixels (line
 * and page deltas scaled as browsers do) — the scale Chromium encodes a
 * trackpad pinch in (its ctrl + wheel Δ is −100·ln(scale)), so a pinch tracks
 * the fingers, and a pinch's events coalesced into one zoom as much. One event
 * is capped at e^±0.3 (≈ 1.35×), so a mouse notch (Δ ≈ 100) is one moderate
 * step, however fast the wheel spins. Positive Δ (scroll down / pinch in)
 * zooms out.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  if (!Number.isFinite(px) || px === 0) return 1;
  return Math.exp(Math.min(0.3, Math.max(-0.3, px / 100)));
}

/**
 * The smallest window: a few data steps, so a zoom never shows less than a
 * handful of points (and never a degenerate span).
 */
export function minimumSpan(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 1e-9;
  const full = Math.abs(xs[n - 1]! - xs[0]!);
  return Math.max((full / (n - 1)) * 4, full * 1e-7, 1e-12);
}

/**
 * Index of the data point whose x is nearest `x`, for an x array sorted
 * ascending or descending (a pattern always is: a TOF pattern shown in Q runs
 * backwards). −1 for an empty array.
 */
export function nearestIndex(xs: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0 || !Number.isFinite(x)) return -1;
  const asc = xs[n - 1]! >= xs[0]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (asc ? xs[mid]! <= x : xs[mid]! >= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo]! - x) <= Math.abs(xs[hi]! - x) ? lo : hi;
}

/** The local data step at index i (half the distance between its neighbours). */
export function localStep(xs: readonly number[], i: number): number {
  const n = xs.length;
  if (n < 2 || i < 0 || i >= n) return NaN;
  const a = xs[Math.max(0, i - 1)]!;
  const b = xs[Math.min(n - 1, i + 1)]!;
  const width = i === 0 || i === n - 1 ? 1 : 2;
  return Math.abs(b - a) / width;
}

/**
 * Decimals for an x readout: the fewest with 10^(−decimals) ≤ step, so the
 * printed value is within half a data step of the data point's x.
 */
export function decimalsForStep(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 3;
  return Math.min(8, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

/** A readout value: five significant digits, plain notation in the usual range. */
export function formatReadoutValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(3);
  if (a >= 1e4) return v.toFixed(0);
  return String(Number(v.toPrecision(5)));
}

/** "TOF (µs)" → { name: "TOF", unit: "µs" }; a label with no unit keeps its name. */
export function splitAxisLabel(label: string): { name: string; unit: string } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(label);
  return m ? { name: m[1]!, unit: m[2]! } : { name: label, unit: "" };
}

/** A reflection tick near the cursor, for the readout. */
export interface NearTick {
  readonly phaseId: string;
  readonly phaseLabel: string;
  readonly kind: "nuclear" | "magnetic";
  readonly color: string;
  readonly row: number;
  readonly hkl: string;
  readonly d: number;
  readonly x: number;
  /** |x − cursor| in data units. */
  readonly distance: number;
}

/**
 * The reflection ticks within `tolerance` (data units) of `x`, nearest first,
 * at most `max` of them (ties keep the phase-row order).
 */
export function ticksNear(phases: readonly PhaseTicks[] | undefined, x: number, tolerance: number, max = 4): NearTick[] {
  if (!phases || !Number.isFinite(x)) return [];
  const out: NearTick[] = [];
  phases.forEach((p, row) => {
    for (const t of p.ticks) {
      const distance = Math.abs(t.x - x);
      if (distance <= tolerance) {
        out.push({ phaseId: p.id, phaseLabel: p.label, kind: p.kind, color: p.color, row, hkl: t.hkl, d: t.d, x: t.x, distance });
      }
    }
  });
  out.sort((a, b) => a.distance - b.distance || a.row - b.row);
  return out.slice(0, max);
}

/**
 * Indices of a monotonic x array that fall inside [lo, hi], as a half-open
 * index range [start, end) in array order. Falls back to the whole array when
 * the order cannot be read (fewer than two points).
 */
export function visibleIndexRange(xs: readonly number[], lo: number, hi: number): [number, number] {
  const n = xs.length;
  if (n < 2) return [0, n];
  const asc = xs[n - 1]! >= xs[0]!;
  // First index whose x is inside, then the first past it.
  const first = (pred: (v: number) => boolean): number => {
    let a = 0;
    let b = n;
    while (a < b) {
      const m = (a + b) >> 1;
      if (pred(xs[m]!)) b = m;
      else a = m + 1;
    }
    return a;
  };
  if (asc) return [first((v) => v >= lo), first((v) => v > hi)];
  return [first((v) => v <= hi), first((v) => v < lo)];
}

/**
 * Per-pixel-column decimation of a polyline: of the points in [start, end)
 * that also lie in [lo, hi], keep each column's first, lowest, highest and
 * last point, in order — at screen resolution the same line, at a cost set by
 * the plot's width rather than the point count. `px` maps x to a pixel, `py`
 * y to a pixel (larger = lower on screen). Returns the kept indices.
 */
export function decimateByColumn(
  xs: readonly number[],
  ys: readonly number[],
  start: number,
  end: number,
  lo: number,
  hi: number,
  px: (x: number) => number,
  py: (y: number) => number,
): number[] {
  const out: number[] = [];
  let col = NaN;
  let iFirst = -1;
  let iMin = -1;
  let iMax = -1;
  let iLast = -1;
  let vMin = Infinity;
  let vMax = -Infinity;
  const flush = (): void => {
    if (iFirst < 0) return;
    const keep = [iFirst, iMin, iMax, iLast].sort((a, b) => a - b);
    let prev = -1;
    for (const k of keep) if (k !== prev) { out.push(k); prev = k; }
  };
  for (let i = start; i < end; i++) {
    const x = xs[i]!;
    if (x < lo || x > hi) continue;
    const c = Math.floor(px(x));
    const y = py(ys[i]!);
    if (c !== col) {
      flush();
      col = c;
      iFirst = iMin = iMax = iLast = i;
      vMin = vMax = y;
      continue;
    }
    iLast = i;
    if (y < vMin) { vMin = y; iMin = i; }
    if (y > vMax) { vMax = y; iMax = i; }
  }
  flush();
  return out;
}
