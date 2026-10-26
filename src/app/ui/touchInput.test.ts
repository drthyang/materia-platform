import { describe, expect, it } from "vitest";
import { gestureHint, gripHitWidth, isMac, plotGestureDescription, trackPointerDrag } from "@/app/ui/touchInput";

/** A pointer event as the window would see it (Node has Event, not PointerEvent). */
const pointer = (type: string, pointerId: number, clientX = 0): Event => Object.assign(new Event(type), { pointerId, clientX });

describe("a fit-handle drag", () => {
  it("follows its pointer and ends when the pointer lifts", () => {
    const win = new EventTarget();
    const xs: number[] = [];
    const ends: string[] = [];
    trackPointerDrag(win, 1, (e) => xs.push(e.clientX), (how) => ends.push(how));
    win.dispatchEvent(pointer("pointermove", 1, 10));
    win.dispatchEvent(pointer("pointermove", 1, 20));
    win.dispatchEvent(pointer("pointerup", 1));
    win.dispatchEvent(pointer("pointermove", 1, 30));
    expect(xs).toEqual([10, 20]);
    expect(ends).toEqual(["up"]);
  });

  it("ends when the browser takes the touch over (pointercancel), so later taps are heard", () => {
    const win = new EventTarget();
    let dragging = true;
    const xs: number[] = [];
    trackPointerDrag(win, 7, (e) => xs.push(e.clientX), () => {
      dragging = false;
    });
    win.dispatchEvent(pointer("pointermove", 7, 5));
    // The finger moved vertically: the page scrolls and the drag is cancelled.
    win.dispatchEvent(pointer("pointercancel", 7));
    expect(dragging).toBe(false);
    win.dispatchEvent(pointer("pointermove", 7, 50));
    expect(xs).toEqual([5]);
  });

  it("ends when the handle loses its capture, and only once", () => {
    const win = new EventTarget();
    const ends: string[] = [];
    trackPointerDrag(win, 2, () => {}, (how) => ends.push(how));
    win.dispatchEvent(pointer("lostpointercapture", 2));
    win.dispatchEvent(pointer("pointerup", 2));
    win.dispatchEvent(pointer("pointercancel", 2));
    expect(ends).toEqual(["cancel"]);
  });

  it("ignores another finger, and can be stopped early", () => {
    const win = new EventTarget();
    const xs: number[] = [];
    const ends: string[] = [];
    const stop = trackPointerDrag(win, 3, (e) => xs.push(e.clientX), (how) => ends.push(how));
    win.dispatchEvent(pointer("pointermove", 4, 99));
    win.dispatchEvent(pointer("pointerup", 4));
    win.dispatchEvent(pointer("pointermove", 3, 12));
    expect(xs).toEqual([12]);
    expect(ends).toEqual([]);
    stop();
    stop();
    win.dispatchEvent(pointer("pointermove", 3, 13));
    expect(xs).toEqual([12]);
    expect(ends).toEqual(["cancel"]);
  });
});

describe("gesture wording", () => {
  const views = ["plot", "model-3d"] as const;

  it("gives each view one short line: Mac or not, a mouse or a finger", () => {
    const line = (view: (typeof views)[number], coarse: boolean, mac: boolean): string => gestureHint(view, { coarse, mac }).text;
    expect(line("plot", false, true)).toBe("⌘ + scroll to zoom · drag to pan · double-click to reset");
    expect(line("plot", false, false)).toBe("Ctrl + scroll to zoom · drag to pan · double-click to reset");
    expect(line("plot", true, true)).toBe("Pinch to zoom · drag to pan");
    expect(line("plot", true, false)).toBe("Pinch to zoom · drag to pan");
    expect(line("model-3d", false, true)).toBe("Scroll to zoom · drag to rotate");
    expect(line("model-3d", false, false)).toBe("Scroll to zoom · drag to rotate");
    expect(line("model-3d", true, true)).toBe("Pinch to zoom · drag to rotate");
    expect(line("model-3d", true, false)).toBe("Pinch to zoom · drag to rotate");
  });

  it("names no mouse or keyboard gesture on a touch screen, line or tooltip", () => {
    for (const view of views) {
      for (const mac of [true, false]) {
        const h = gestureHint(view, { coarse: true, mac, fitHandles: true, ticks: true });
        for (const s of [h.text, ...h.more]) expect(s).not.toMatch(/scroll|Shift|Ctrl|⌘|double-click|Click|Right-drag|Keys/);
      }
    }
  });

  it("keeps the secondary gestures in the tooltip, not the line", () => {
    for (const mac of [true, false]) {
      const fine = gestureHint("plot", { coarse: false, mac });
      expect(fine.text).not.toMatch(/Shift|box|Keys|handle/);
      expect(fine.more.join(" ")).toMatch(/Shift \+ drag a box/);
      expect(fine.more.join(" ")).toMatch(/\+ and − zoom, ← and → pan, 0 resets/);
      expect(gestureHint("model-3d", { coarse: false, mac }).more.join(" ")).toMatch(/Right-drag or Shift \+ drag to pan/);
    }
  });

  it("names the fit handles and the ticks only on a plot that has them", () => {
    for (const coarse of [true, false]) {
      const bare = gestureHint("plot", { coarse, mac: false }).more.join(" ");
      expect(bare).not.toMatch(/handles|tick/);
      const full = gestureHint("plot", { coarse, mac: false, fitHandles: true, ticks: true }).more.join(" ");
      expect(full).toMatch(/Drag the blue handles to set the fit range\./);
      expect(full).toMatch(coarse ? /Tap a reflection tick/ : /Click a reflection tick/);
    }
  });

  it("tells ⌘ from Ctrl by the platform", () => {
    expect(isMac({ platform: "MacIntel" })).toBe(true);
    expect(isMac({ platform: "iPhone" })).toBe(true);
    expect(isMac({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" })).toBe(true);
    expect(isMac({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
    expect(isMac({ platform: "Linux x86_64" })).toBe(false);
    expect(isMac({})).toBe(false);
  });

  it("describes every gesture and key to a screen reader, with the platform's key", () => {
    for (const mac of [true, false]) {
      const d = plotGestureDescription(mac);
      expect(d).toContain(`${mac ? "⌘" : "Ctrl"} + scroll or pinch to zoom`);
      for (const part of ["Drag to pan", "Shift + drag to box-zoom", "double-click to reset", "plus and minus zoom", "arrows pan", "Shift + arrows step the cursor", "0 resets"]) {
        expect(d).toContain(part);
      }
    }
  });

  it("gives a finger a wider fit handle than a mouse", () => {
    expect(gripHitWidth(false)).toBe(12);
    expect(gripHitWidth(true)).toBeGreaterThanOrEqual(28);
  });
});
