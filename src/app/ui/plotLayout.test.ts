/**
 * The plot's vertical bands (WorkbenchPlot plotLayout): a pattern with
 * reflection ticks keeps its tick band exactly as before; a plot with no tick
 * rows (G(r)) drops it and gives the height to the data, so the difference
 * band is about a fifth of the plot rather than reading as a third.
 */
import { describe, expect, it } from "vitest";
import { plotLayout } from "@/app/ui/WorkbenchPlot";

describe("the plot's bands", () => {
  it("with tick rows: the layout is the powder plot's, unchanged", () => {
    // A 560px plot reproduces the original 560-unit layout.
    expect(plotLayout(560)).toEqual(plotLayout(560, true));
    const l = plotLayout(560, true);
    expect([l.capY, l.diffA, l.diffY, l.tickMaxBot, l.tickTop, l.base]).toEqual([522, 46, 470, 420, 382, 356]);
  });

  it("without tick rows: the band's 38px go to the data, the difference band stays", () => {
    for (const h of [320, 470, 560, 900]) {
      const ticks = plotLayout(h, true);
      const none = plotLayout(h, false);
      expect(none.tickTop).toBe(none.tickMaxBot);
      expect(none.base - ticks.base).toBe(38);
      expect(none.mainH - ticks.mainH).toBe(38);
      expect([none.diffA, none.diffY, none.capY]).toEqual([ticks.diffA, ticks.diffY, ticks.capY]);
    }
  });

  it("on the PDF page's plot (about 470px at 1600x900) the data take two thirds and the difference band a fifth", () => {
    const h = 470;
    const l = plotLayout(h, false);
    expect(l.mainH / h).toBeGreaterThan(0.6);
    const diffBand = 2 * l.diffA + 10; // the band and its gaps
    expect(diffBand / h).toBeGreaterThan(0.15);
    expect(diffBand / h).toBeLessThan(0.22);
  });

  it("a short plot (a phone on its side) drops its narrower band too", () => {
    const ticks = plotLayout(260, true);
    const none = plotLayout(260, false);
    expect(none.base - ticks.base).toBe(28);
  });
});
