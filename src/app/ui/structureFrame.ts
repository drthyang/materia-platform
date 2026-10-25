/**
 * How much of the scene the 3D structure view's orthographic camera shows:
 * the half-height of its frustum, for a cell whose bounding box has diagonal
 * `span`, in a canvas `aspect` (width / height) wide. Pure, so the framing is
 * tested without WebGL (structureFrame.test.ts).
 */

type V3 = readonly [number, number, number];

/** The desktop frame: a half-height of 0.85 cell diagonals, whatever the canvas. */
export const FRAME_DIAGONAL_SHARE = 0.85;

/** The cell's half-extents across the screen (`halfW`) and up it (`halfH`), seen from `eye` towards `center` with `up` up. */
export interface ScreenExtent {
  readonly halfW: number;
  readonly halfH: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** The extent on screen of `points` (the cell's corners) in an orthographic view from `eye` looking at `center`. */
export function screenExtent(points: readonly V3[], center: V3, eye: V3, up: V3 = [0, 1, 0]): ScreenExtent {
  const forward = unit(sub(center, eye));
  const right = unit(cross(forward, up));
  const upOnScreen = cross(right, forward);
  let halfW = 0;
  let halfH = 0;
  for (const p of points) {
    const d = sub(p, center);
    halfW = Math.max(halfW, Math.abs(dot(d, right)));
    halfH = Math.max(halfH, Math.abs(dot(d, upOnScreen)));
  }
  return { halfW, halfH };
}

/**
 * `extent` null: the desktop frame, sized from the full diagonal — on a short,
 * wide canvas (a phone on its side) the cell filled about half its height,
 * and on a canvas narrower than tall it ran off the sides.
 * `extent` given (touch screens): the cell as the camera first sees it, fitted
 * to whichever of the canvas's height and width is tighter, with a margin for
 * the atoms at its corners, their labels and the axis arrows (8% of the
 * diagonal plus 1 Å). Turning the model can take a corner past the edge; a
 * pinch brings it back.
 */
export function orthoHalfHeight(span: number, aspect: number, extent: ScreenExtent | null): number {
  if (!extent) return span * FRAME_DIAGONAL_SHARE;
  const pad = 0.08 * span + 1;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return Math.max(extent.halfH + pad, (extent.halfW + pad) / a);
}
