import { describe, expect, it } from "vitest";
import { tickCountFor, yTickCount } from "@/visualization/axisTicks";

describe("how many ticks an axis carries", () => {
  it("fits the labels to the axis length, between the floor and the ceiling", () => {
    // The validation strip's x axis (80 px a label): a desktop card holds eight,
    // an iPhone held upright (~290 px of axis) three.
    expect(tickCountFor(1100, 80)).toBe(8);
    expect(tickCountFor(640, 80)).toBe(8);
    expect(tickCountFor(290, 80)).toBe(3);
    expect(tickCountFor(120, 80)).toBe(2);
    // The pattern's x axis: at most six.
    expect(tickCountFor(1100, 70, 2, 6)).toBe(6);
    expect(tickCountFor(300, 70, 2, 6)).toBe(4);
  });

  it("never returns fewer than the floor, whatever it is given", () => {
    expect(tickCountFor(0, 80)).toBe(2);
    expect(tickCountFor(-5, 80)).toBe(2);
    expect(tickCountFor(Number.NaN, 80)).toBe(2);
    expect(tickCountFor(500, 0)).toBe(2);
    expect(tickCountFor(500, Number.POSITIVE_INFINITY, 3)).toBe(3);
  });

  it("keeps four y ticks on every plot tall enough for them, fewer on a short one", () => {
    // A plot is at least 320 px tall on a desktop or a tablet, which leaves its
    // main panel 144 px and more: four, as before.
    for (const h of [144, 150, 300, 600]) expect(yTickCount(h)).toBe(4);
    // A plot fitted to a phone held sideways leaves the panel ~70–130 px.
    expect(yTickCount(110)).toBe(3);
    expect(yTickCount(90)).toBe(2);
    expect(yTickCount(40)).toBe(2);
  });
});
