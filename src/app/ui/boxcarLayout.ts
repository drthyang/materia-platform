/**
 * Pure layout math for the boxcar track plot (BoxcarPanel's `TrackPlot`): how
 * a measured drawing box is split between the value panel, the Rw strip and
 * the shared r axis, how many ticks each axis carries, and how wide a box's
 * Rw bar may be. Kept out of the component so it is unit-testable — the plot
 * draws to whatever height the card hands it, and the split has to stay
 * readable from a laptop's short card to a 1440p one.
 */

/** Horizontal margins of the plot area (px). */
export const TRACK_PAD = { left: 62, right: 14, top: 12 } as const;
/** How far inside the plot area the first and last box centers sit, so their
 *  points and Rw bars (at most 16 px wide) clear the axis lines. */
export const TRACK_X_INSET = 10;
/** Below the Rw strip: the r tick labels and the axis title, drawn ONCE for
 *  both panels (they share the r axis). */
export const TRACK_AXIS_H = 34;
/** Gap between the value panel and the Rw strip. */
const PANEL_GAP = 10;

export interface TrackLayout {
  /** Value panel, top and bottom edge (px from the top of the drawing). */
  readonly valueTop: number;
  readonly valueBottom: number;
  /** Rw strip, top edge and baseline (its bars stand on the baseline). */
  readonly rwTop: number;
  readonly rwBottom: number;
  /** Baselines of the r tick labels and of the axis title. */
  readonly xTickY: number;
  readonly xTitleY: number;
  /** Target interval counts for {@link tickValues}. */
  readonly yTicks: number;
  readonly xTicks: number;
  readonly rwTicks: number;
}

/**
 * Split a `width` × `height` drawing into the value panel over the Rw strip
 * over one shared r axis. The strip scales with the height (a fixed strip took
 * a third of a short card) but stays between 40 and 84 px: it is context for
 * the track, never the headline.
 */
export function trackLayout(width: number, height: number): TrackLayout {
  const rwH = clamp(Math.round(height * 0.2), 40, 84);
  const rwBottom = height - TRACK_AXIS_H;
  const rwTop = rwBottom - rwH;
  const valueTop = TRACK_PAD.top;
  const valueBottom = Math.max(valueTop + 20, rwTop - PANEL_GAP);
  const innerW = width - TRACK_PAD.left - TRACK_PAD.right;
  return {
    valueTop,
    valueBottom,
    rwTop,
    rwBottom,
    xTickY: rwBottom + 15,
    xTitleY: height - 3,
    // About one y gridline per 45 px, and one r tick per 80 px of width.
    yTicks: clamp(Math.floor((valueBottom - valueTop) / 45), 3, 8),
    xTicks: clamp(Math.floor(innerW / 80), 3, 10),
    rwTicks: rwH >= 64 ? 2 : 1,
  };
}

/**
 * The smallest gap between neighbouring box centers, in px, or null with fewer
 * than two distinct centers. Sets the Rw bar width and how far from a box the
 * pointer may be and still pick it.
 */
export function boxSpacingPx(centersPx: readonly number[]): number | null {
  const xs = [...new Set(centersPx.filter(Number.isFinite))].sort((a, b) => a - b);
  let best: number | null = null;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    if (d > 0 && (best === null || d < best)) best = d;
  }
  return best;
}

/** Width of one box's Rw bar slot (px): most of the spacing, so neighbours
 *  never touch, within 4–16 px. A two-pass run splits the slot in two. */
export function rwSlotPx(spacing: number | null): number {
  return spacing === null ? 10 : clamp(spacing * 0.6, 4, 16);
}

/** How far (px) from a box center the pointer still picks that box: half the
 *  spacing, so every point of the axis between two boxes belongs to one. */
export function pickReachPx(spacing: number | null): number {
  return spacing === null ? 40 : Math.max(12, spacing / 2 + 1);
}

/** Whether a monospace label fits along `px` at `fontSize` (IBM Plex Mono
 *  advances 0.6 em per glyph). */
export function monoLabelFits(label: string, fontSize: number, px: number): boolean {
  return label.length * 0.6 * fontSize <= px;
}

/** Round tick positions covering [lo, hi] — the same "nice numbers" the other
 *  hand-rolled plots use, kept local so this panel has no plot dependency. */
export function tickValues(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const stepN = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  const step = stepN * mag;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-6; t += step) out.push(t);
  return out;
}

/**
 * At least one labelled tick above zero on a [0, hi] axis (the Rw strip). With
 * one or two intervals {@link tickValues} can round its step past `hi` itself
 * (0–12.9 % in one interval steps by 20), leaving only the zero line; ask for
 * finer steps until a tick lands inside.
 */
export function positiveTicks(hi: number, count: number): number[] {
  if (!(hi > 0)) return [];
  for (let n = Math.max(1, count); n <= 16; n *= 2) {
    const ticks = tickValues(0, hi, n).filter((t) => t > 0);
    if (ticks.length > 0) return ticks;
  }
  return [];
}

export function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(1);
  return String(+v.toFixed(4));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
