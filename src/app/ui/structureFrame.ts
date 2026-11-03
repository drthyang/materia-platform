/**
 * How much of the scene the 3D structure view's orthographic camera shows:
 * the half-height of its frustum, for a cell whose bounding box has diagonal
 * `span`, in a canvas `aspect` (width / height) wide. Pure, so the framing is
 * tested without WebGL (structureFrame.test.ts).
 */

type V3 = readonly [number, number, number];

/** The camera's first view: from the cell centre, this far along each axis per unit of the cell's diagonal (plus a fixed 4 Å back), looking slightly down the body diagonal. */
export const VIEW_DIRECTION: V3 = [0.55, 0.45, 1.1];

/** Where the camera first stands for a cell of diagonal `span` centred on `center` (the view the frame is fitted to). */
export function defaultEye(center: V3, span: number): V3 {
  return [center[0] + span * VIEW_DIRECTION[0], center[1] + span * VIEW_DIRECTION[1], center[2] + span * VIEW_DIRECTION[2] + 4];
}

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
 * The cell as the camera first sees it (`extent`), fitted to whichever of the
 * canvas's height and width is tighter, with a margin for the atoms at its
 * corners, their labels and the axis arrows (8% of the diagonal plus 1 Å).
 * Every screen frames this way: the fixed frame desktops had (0.85 cell
 * diagonals of half-height, whatever the canvas) showed a 200 px cell in a
 * 970×400 canvas, and on a short, wide canvas (a phone on its side) the cell
 * filled about half its height. Turning the model can take a corner past the
 * edge; the wheel or a pinch brings it back.
 */
export function orthoHalfHeight(span: number, aspect: number, extent: ScreenExtent): number {
  const pad = 0.08 * span + 1;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return Math.max(extent.halfH + pad, (extent.halfW + pad) / a);
}
