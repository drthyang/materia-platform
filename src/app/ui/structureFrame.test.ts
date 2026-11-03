import { describe, expect, it } from "vitest";
import { defaultEye, orthoHalfHeight, screenExtent } from "@/app/ui/structureFrame";

type V3 = [number, number, number];
/** The eight corners of a box from the origin along three cell vectors. */
const corners = (a: V3, b: V3, c: V3): V3[] => {
  const out: V3[] = [];
  for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) out.push([i * a[0] + j * b[0] + k * c[0], i * a[1] + j * b[1] + k * c[1], i * a[2] + j * b[2] + k * c[2]]);
  return out;
};

describe("the 3D view's frame", () => {
  /** Mn3Ga's hexagonal cell (a 5.4 Å, c 4.35 Å), seen as the view first frames it. */
  const mn3ga = () => {
    const a: V3 = [5.4, 0, 0];
    const b: V3 = [-2.7, 4.677, 0];
    const c: V3 = [0, 0, 4.35];
    const center: V3 = [1.35, 2.3385, 2.175];
    const span = Math.hypot(8.1, 4.677, 4.35);
    return { box: corners(a, b, c), center, span, extent: screenExtent(corners(a, b, c), center, defaultEye(center, span)) };
  };

  it("first looks from the cell centre slightly down the body diagonal, 4 Å further back", () => {
    expect(defaultEye([1, 2, 3], 10)).toEqual([1 + 5.5, 2 + 4.5, 3 + 11 + 4]);
  });

  it("fills a wide desktop canvas: the cell takes about two thirds of the tighter side, not a third", () => {
    // The review's 970×400 3D card: the former fixed frame (0.85 diagonals of
    // half-height) left the cell 36% of its height; the fit gives 64%.
    const { span, extent } = mn3ga();
    const aspect = 970 / 400;
    const d = orthoHalfHeight(span, aspect, extent);
    const tallShare = extent.halfH / d;
    const wideShare = extent.halfW / (d * aspect);
    expect(Math.max(tallShare, wideShare)).toBeGreaterThan(0.6);
    expect(Math.max(tallShare, wideShare)).toBeLessThan(1);
    const formerFrame = span * 0.85;
    expect(formerFrame / d).toBeGreaterThan(1.5);
  });

  it("measures a cube seen face on as its half-edge both ways", () => {
    const box = corners([4, 0, 0], [0, 4, 0], [0, 0, 4]);
    const e = screenExtent(box, [2, 2, 2], [2, 2, 20]);
    expect(e.halfW).toBeCloseTo(2, 9);
    expect(e.halfH).toBeCloseTo(2, 9);
  });

  it("fits the cell as first seen to the tighter side of the canvas, corners inside", () => {
    const { span, extent: e } = mn3ga();
    for (const aspect of [0.45, 1, 1.6, 3.5]) {
      const d = orthoHalfHeight(span, aspect, e);
      expect(d).toBeGreaterThan(e.halfH);
      expect(d * aspect).toBeGreaterThan(e.halfW);
    }
    // A phone held sideways (an 770×220 canvas): the cell shows ~1.6× as tall as in the former fixed frame.
    const gain = (span * 0.85) / orthoHalfHeight(span, 770 / 220, e);
    expect(gain).toBeGreaterThan(1.4);
    // A canvas narrower than tall widens the frame instead of cutting the cell off at the sides.
    expect(orthoHalfHeight(span, 0.45, e) * 0.45).toBeGreaterThan(e.halfW);
  });

  it("never returns a frame that is zero, negative or NaN for a degenerate canvas", () => {
    const e = { halfW: 3, halfH: 2 };
    for (const aspect of [0, Number.NaN, -1]) {
      const d = orthoHalfHeight(10, aspect, e);
      expect(Number.isFinite(d) && d > 0).toBe(true);
    }
  });
});
