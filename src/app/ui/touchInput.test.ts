import { describe, expect, it } from "vitest";
import { gestureHint, gripHitWidth, trackPointerDrag } from "@/app/ui/touchInput";

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
  it("names a finger's gestures on a touch screen, and a mouse's elsewhere", () => {
    for (const view of ["powder-plot", "pdf-plot", "model-3d"] as const) {
      const touch = gestureHint(view, true);
      expect(touch).toMatch(/pinch to zoom/i);
      expect(touch).not.toMatch(/scroll|Shift|Ctrl|⌘|double-click/);
      expect(gestureHint(view, false)).toMatch(/scroll/);
    }
    expect(gestureHint("model-3d", true)).toBe("drag to rotate, pinch to zoom");
  });

  it("gives a finger a wider fit handle than a mouse", () => {
    expect(gripHitWidth(false)).toBe(12);
    expect(gripHitWidth(true)).toBeGreaterThanOrEqual(28);
  });
});
