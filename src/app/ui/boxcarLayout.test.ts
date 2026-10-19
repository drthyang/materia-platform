import { describe, expect, it } from "vitest";
import {
  TRACK_AXIS_H,
  TRACK_PAD,
  boxSpacingPx,
  monoLabelFits,
  pickReachPx,
  positiveTicks,
  rwSlotPx,
  tickValues,
  trackLayout,
} from "@/app/ui/boxcarLayout";

describe("trackLayout", () => {
  it("stacks value panel, Rw strip and the shared r axis without overlap", () => {
    for (const h of [160, 287, 400, 540]) {
      const l = trackLayout(800, h);
      expect(l.valueTop).toBe(TRACK_PAD.top);
      expect(l.valueBottom).toBeLessThan(l.rwTop);
      expect(l.rwTop).toBeLessThan(l.rwBottom);
      expect(l.rwBottom).toBe(h - TRACK_AXIS_H);
      expect(l.xTickY).toBeGreaterThan(l.rwBottom);
      expect(l.xTitleY).toBeLessThanOrEqual(h);
      expect(l.xTitleY).toBeGreaterThan(l.xTickY);
    }
  });

  it("gives the value panel most of the height, even on a short card", () => {
    // 150 px of figure used to leave ~50 px for the track (a fixed 54 px Rw
    // strip plus 46 px of margins). The minimum figure now keeps more than
    // that, and a laptop-sized one several times more.
    const short = trackLayout(780, 160);
    expect(short.valueBottom - short.valueTop).toBeGreaterThanOrEqual(60);
    const laptop = trackLayout(780, 287);
    expect(laptop.valueBottom - laptop.valueTop).toBeGreaterThanOrEqual(160);
  });

  it("scales the Rw strip with the height, within its bounds", () => {
    const strip = (h: number): number => {
      const l = trackLayout(800, h);
      return l.rwBottom - l.rwTop;
    };
    expect(strip(160)).toBe(40);
    expect(strip(300)).toBe(60);
    expect(strip(900)).toBe(84);
  });

  it("adds gridlines with the room it has", () => {
    expect(trackLayout(800, 160).yTicks).toBe(3);
    expect(trackLayout(800, 540).yTicks).toBeGreaterThan(trackLayout(800, 287).yTicks);
    expect(trackLayout(300, 300).xTicks).toBe(3);
    expect(trackLayout(1200, 300).xTicks).toBe(10);
    expect(trackLayout(800, 160).rwTicks).toBe(1);
    expect(trackLayout(800, 400).rwTicks).toBe(2);
  });
});

describe("box spacing", () => {
  it("is the smallest gap between distinct centers", () => {
    expect(boxSpacingPx([100, 140, 180, 200])).toBe(20);
    // A two-pass run lists every center twice; duplicates are not a zero gap.
    expect(boxSpacingPx([100, 100, 150, 150])).toBe(50);
    expect(boxSpacingPx([100])).toBeNull();
    expect(boxSpacingPx([])).toBeNull();
  });

  it("sizes the Rw bar slot and the pick reach from the spacing", () => {
    expect(rwSlotPx(50)).toBe(16);
    expect(rwSlotPx(10)).toBe(6);
    expect(rwSlotPx(2)).toBe(4);
    expect(rwSlotPx(null)).toBe(10);
    // Half the spacing (plus a pixel) covers the whole axis between two boxes.
    expect(pickReachPx(50)).toBe(26);
    expect(pickReachPx(8)).toBe(12);
    expect(pickReachPx(null)).toBe(40);
  });
});

describe("monoLabelFits", () => {
  it("measures a monospace label against the room along the axis", () => {
    expect(monoLabelFits("PDF scale", 10, 54)).toBe(true);
    expect(monoLabelFits("PDF scale", 10, 53)).toBe(false);
  });
});

describe("tickValues", () => {
  it("covers the span with round steps", () => {
    expect(tickValues(0, 10, 4)).toEqual([0, 5, 10]);
    expect(tickValues(4, 25, 5)).toEqual([5, 10, 15, 20, 25]);
    expect(tickValues(3, 3, 4)).toEqual([3]);
  });
});

describe("positiveTicks", () => {
  it("always labels the Rw strip above zero", () => {
    // One interval over 0–12.9 % rounds the step to 20: no tick inside.
    expect(tickValues(0, 12.9, 1).filter((t) => t > 0)).toEqual([]);
    expect(positiveTicks(12.9, 1)).toEqual([10]);
    expect(positiveTicks(4.02, 2)).toEqual([2, 4]);
    expect(positiveTicks(12.9, 2)).toEqual([10]);
  });

  it("returns nothing for an empty axis", () => {
    expect(positiveTicks(0, 2)).toEqual([]);
    expect(positiveTicks(NaN, 2)).toEqual([]);
  });
});
