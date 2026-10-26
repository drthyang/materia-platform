import { describe, expect, it } from "vitest";
import {
  clampView, decimalsForStep, decimateByColumn, formatReadoutValue, isFullView, localStep, minimumSpan, nearestIndex, panBy, revealX,
  splitAxisLabel, ticksNear, visibleIndexRange, wheelZoomFactor, zoomAt,
} from "@/visualization/plotView";
import type { PhaseTicks } from "@/visualization/reflectionTicks";

const D = { min: 0, max: 100 };

describe("the x window", () => {
  it("zooms about the anchor: the anchor keeps its fraction of the window", () => {
    const v = { min: 20, max: 60 };
    const z = zoomAt(v, 30, 0.5, D, 1e-6);
    expect(z.max - z.min).toBeCloseTo(20, 12);
    expect((30 - z.min) / (z.max - z.min)).toBeCloseTo((30 - v.min) / (v.max - v.min), 12);
    const out = zoomAt(z, 30, 2, D, 1e-6);
    expect(out.min).toBeCloseTo(20, 12);
    expect(out.max).toBeCloseTo(60, 12);
  });

  it("never zooms past the data range or below the narrowest span", () => {
    expect(zoomAt({ min: 10, max: 90 }, 50, 10, D, 1)).toEqual(D);
    const tiny = zoomAt({ min: 49, max: 51 }, 50, 1e-6, D, 0.5);
    expect(tiny.max - tiny.min).toBeCloseTo(0.5, 12);
    expect(tiny.min).toBeCloseTo(49.75, 12);
  });

  it("pans with the span held and stops at either end", () => {
    expect(panBy({ min: 10, max: 30 }, 5, D)).toEqual({ min: 15, max: 35 });
    expect(panBy({ min: 10, max: 30 }, -50, D)).toEqual({ min: 0, max: 20 });
    expect(panBy({ min: 10, max: 30 }, 500, D)).toEqual({ min: 80, max: 100 });
  });

  it("clamps a window shifted outside the data back in without shrinking it", () => {
    expect(clampView({ min: -10, max: 10 }, D, 1)).toEqual({ min: 0, max: 20 });
    expect(clampView({ min: -50, max: 250 }, D, 1)).toEqual(D);
    expect(isFullView(D, D)).toBe(true);
    expect(isFullView({ min: 0, max: 99 }, D)).toBe(false);
  });

  it("maps a wheel delta to a zoom factor: a pinch's scale, a mouse notch capped", () => {
    // A pinch: Δ = −100·ln(scale), whether its events arrive apart or coalesced.
    expect(wheelZoomFactor(-4)).toBeCloseTo(Math.exp(-0.04), 12);
    expect(wheelZoomFactor(-4) ** 5).toBeCloseTo(wheelZoomFactor(-20), 12);
    // A mouse notch (and a spun wheel) is one capped step.
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(0.3), 12);
    expect(wheelZoomFactor(10000)).toBeCloseTo(Math.exp(0.3), 12);
    expect(wheelZoomFactor(-100)).toBeCloseTo(1 / wheelZoomFactor(100), 12);
    expect(wheelZoomFactor(0.1, 1)).toBeCloseTo(wheelZoomFactor(1.6), 12);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it("reveals an x that is out of view by the least pan, the width unchanged", () => {
    const v = { min: 40, max: 60 };
    // Inside the window (edges included): nothing moves.
    expect(revealX(v, 50, D)).toBeNull();
    expect(revealX(v, 40, D)).toBeNull();
    expect(revealX(v, 60, D)).toBeNull();
    // Past the right edge: it lands a tenth of the span (2) inside that edge.
    expect(revealX(v, 75, D)).toEqual({ min: 57, max: 77 });
    // Past the left edge: a tenth inside the left edge.
    const left = revealX(v, 10, D)!;
    expect(left.min).toBeCloseTo(8, 12);
    expect(left.max).toBeCloseTo(28, 12);
    // A custom margin.
    expect(revealX(v, 75, D, 0)).toEqual({ min: 55, max: 75 });
    expect(revealX(v, 75, D, 0.25)).toEqual({ min: 60, max: 80 });
  });

  it("holds a revealed window inside the data and keeps its width there too", () => {
    const v = { min: 40, max: 60 };
    // Near the data's end the window stops at the end, with the point nearer the edge than the margin.
    expect(revealX(v, 99, D)).toEqual({ min: 80, max: 100 });
    const lo = revealX({ min: 10, max: 30 }, 0.5, D)!;
    expect(lo.min).toBe(0);
    expect(lo.max).toBe(20);
    for (const x of [-5, 3, 77, 100, 140]) {
      const r = revealX(v, x, D);
      if (r) expect(r.max - r.min).toBeCloseTo(20, 12);
    }
  });

  it("does not move for a point it cannot place", () => {
    expect(revealX({ min: 40, max: 60 }, Number.NaN, D)).toBeNull();
    expect(revealX({ min: 40, max: 40 }, 70, D)).toBeNull();
  });

  it("keeps a few data steps as the narrowest window", () => {
    expect(minimumSpan([0, 1, 2, 3, 4])).toBeCloseTo(4, 12);
  });
});

describe("the readout", () => {
  const asc = [1, 2, 3, 4, 5];
  const desc = [5, 4, 3, 2, 1];

  it("finds the nearest point in an ascending or a descending x array", () => {
    expect(nearestIndex(asc, 2.4)).toBe(1);
    expect(nearestIndex(asc, 2.6)).toBe(2);
    expect(nearestIndex(asc, -9)).toBe(0);
    expect(nearestIndex(asc, 99)).toBe(4);
    expect(nearestIndex(desc, 2.4)).toBe(3);
    expect(nearestIndex(desc, 4.9)).toBe(0);
    expect(nearestIndex([], 1)).toBe(-1);
    // Within half a step of the cursor on a log-binned TOF grid.
    const tof = Array.from({ length: 1000 }, (_, i) => 3390 * Math.exp(i * 0.0008));
    for (const x of [3400, 5000.5, 7210.25]) {
      const i = nearestIndex(tof, x);
      expect(Math.abs(tof[i]! - x)).toBeLessThanOrEqual(localStep(tof, i) / 2 + 1e-9);
    }
  });

  it("prints x to the data step: rounding never moves it by half a step", () => {
    expect(decimalsForStep(0.01)).toBe(2);
    expect(decimalsForStep(0.0125)).toBe(2);
    expect(decimalsForStep(0.001)).toBe(3);
    expect(decimalsForStep(20)).toBe(0);
    for (const step of [0.003, 0.01, 0.017, 0.2, 2.7, 66]) {
      const dec = decimalsForStep(step);
      expect(0.5 * 10 ** -dec).toBeLessThanOrEqual(step / 2 + 1e-15);
    }
  });

  it("formats y values to five significant digits", () => {
    expect(formatReadoutValue(512.3456)).toBe("512.35");
    expect(formatReadoutValue(-5.36584)).toBe("-5.3658");
    expect(formatReadoutValue(123456)).toBe("123456");
    expect(formatReadoutValue(0)).toBe("0");
    expect(formatReadoutValue(NaN)).toBe("—");
  });

  it("splits an axis label into its name and unit", () => {
    expect(splitAxisLabel("TOF (µs)")).toEqual({ name: "TOF", unit: "µs" });
    expect(splitAxisLabel("Q (Å⁻¹)")).toEqual({ name: "Q", unit: "Å⁻¹" });
    expect(splitAxisLabel("r")).toEqual({ name: "r", unit: "" });
  });

  it("lists the reflection ticks within the tolerance, nearest first", () => {
    const phases: PhaseTicks[] = [
      { id: "a", label: "A", color: "#000", kind: "nuclear", ticks: [{ x: 10, d: 2, hkl: "1 0 0" }, { x: 10.4, d: 1.9, hkl: "1 1 0" }] as PhaseTicks["ticks"] },
      { id: "m", label: "mag", color: "#f00", kind: "magnetic", ticks: [{ x: 10.1, d: 1.98, hkl: "0.5 0 0" }] as PhaseTicks["ticks"] },
    ];
    const near = ticksNear(phases, 10.04, 0.2);
    expect(near.map((t) => t.hkl)).toEqual(["1 0 0", "0.5 0 0"]);
    expect(near[1]!.row).toBe(1);
    expect(ticksNear(phases, 20, 0.2)).toEqual([]);
  });
});

describe("drawing only what is on screen", () => {
  it("finds the visible index range of a monotonic array", () => {
    expect(visibleIndexRange([1, 2, 3, 4, 5], 2, 4)).toEqual([1, 4]);
    expect(visibleIndexRange([5, 4, 3, 2, 1], 2, 4)).toEqual([1, 4]);
    expect(visibleIndexRange([1, 2, 3], 10, 20)).toEqual([3, 3]);
  });

  it("keeps each pixel column's first, extreme and last points, in order", () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i / 1000);
    const ys = xs.map((x) => Math.sin(40 * x));
    const keep = decimateByColumn(xs, ys, 0, xs.length, 0, 1, (x) => x * 100, (y) => -y * 50);
    expect(keep.length).toBeLessThanOrEqual(400);
    expect(keep).toEqual([...keep].sort((a, b) => a - b));
    // Every column's extremes survive.
    for (let c = 0; c < 100; c++) {
      const idx = xs.map((_, i) => i).filter((i) => Math.floor(xs[i]! * 100) === c);
      const lo = idx.reduce((a, b) => (ys[b]! < ys[a]! ? b : a));
      const hi = idx.reduce((a, b) => (ys[b]! > ys[a]! ? b : a));
      expect(keep).toContain(lo);
      expect(keep).toContain(hi);
    }
  });
});
