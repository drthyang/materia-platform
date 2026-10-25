/**
 * How many ticks an axis carries: as many as its length holds at the room
 * each label needs, between a floor and a ceiling. A fixed count printed a
 * phone-wide axis's labels over each other, and crowded a short plot's y axis.
 * The plots then round the step to 1-2-5 (which can add up to half as many
 * again), so `perTickPx` should already allow for that.
 */
export function tickCountFor(lengthPx: number, perTickPx: number, min = 2, max = 8): number {
  if (!(lengthPx > 0) || !(perTickPx > 0)) return min;
  return Math.max(min, Math.min(max, Math.floor(lengthPx / perTickPx)));
}

/**
 * The y axis of a plot's main panel: four ticks where it is tall enough (every
 * plot at least 320 px tall, which leaves the panel 144 px: every desktop and
 * tablet plot), fewer as it shrinks (a phone on its side), never under two.
 * 32 px a tick keeps 1-2-5 rounding's extra ticks ~21 px apart, two lines of
 * tick label.
 */
export const yTickCount = (panelPx: number): number => tickCountFor(panelPx, 32, 2, 4);
