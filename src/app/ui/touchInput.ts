/**
 * Touch-aware pieces shared by the plots and the 3D views: whether the main
 * pointer is a finger, the gesture wording that matches it, and a drag that
 * ends however the pointer goes away. The pure parts are tested without a
 * browser (touchInput.test.ts).
 */

import { useEffect, useState } from "react";

/** The main pointer is a finger (a phone, a tablet): the CSS `(pointer: coarse)`. */
export const COARSE_QUERY = "(pointer: coarse)";

/** Whether the main pointer is coarse, following the device as it changes (a keyboard and trackpad attached). */
export function useCoarsePointer(): boolean {
  const get = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COARSE_QUERY).matches;
  const [coarse, setCoarse] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(COARSE_QUERY);
    const on = (): void => setCoarse(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return coarse;
}

/**
 * The how-to line under a view, in the gestures the user has: a mouse or
 * trackpad scrolls, Shift-drags and double-clicks; a finger pinches and drags
 * (Ctrl/⌘ + scroll and Shift + drag do not exist on a phone).
 */
export function gestureHint(view: "powder-plot" | "pdf-plot" | "model-3d", coarse: boolean): string {
  switch (view) {
    case "powder-plot":
      return coarse
        ? "Pinch to zoom, drag sideways to pan, Reset to see it all; drag the blue handles to set the fit range."
        : "Drag to pan, Ctrl/⌘ + scroll or pinch to zoom, Shift + drag to box-zoom, double-click to reset; blue handles set the fit range.";
    case "pdf-plot":
      return coarse
        ? "Pinch to zoom, drag sideways to pan, drag the handles to set the fit window."
        : "Drag to pan, Ctrl/⌘ + scroll to zoom, handles set the fit window.";
    case "model-3d":
      return coarse ? "drag to rotate, pinch to zoom" : "drag to rotate, scroll to zoom";
  }
}

/**
 * The hit width (CSS px) of a fit-range handle: a finger needs more than a
 * mouse, and a narrow handle under a finger was easy to miss and pan the
 * plot instead.
 */
export const gripHitWidth = (coarse: boolean): number => (coarse ? 32 : 12);

/**
 * Follow one pointer's moves on `target` (the window) until it lifts, or until
 * the browser takes the gesture over (`pointercancel`: a touch drag that turns
 * into a page scroll, a system gesture), or the element loses its capture.
 * A drag that listened for `pointerup` alone never heard a cancelled touch end,
 * and stayed "dragging" — so the plot ignored every later tap.
 * Returns a function that stops the drag early (it calls `onEnd` once).
 */
export function trackPointerDrag(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  pointerId: number,
  onMove: (e: PointerEvent) => void,
  onEnd: (how: "up" | "cancel") => void,
): () => void {
  let done = false;
  const mine = (e: Event): boolean => (e as PointerEvent).pointerId === undefined || (e as PointerEvent).pointerId === pointerId;
  const move = (e: Event): void => {
    if (!done && mine(e)) onMove(e as PointerEvent);
  };
  const finish = (how: "up" | "cancel"): void => {
    if (done) return;
    done = true;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", cancel);
    target.removeEventListener("lostpointercapture", cancel);
    onEnd(how);
  };
  const up = (e: Event): void => {
    if (mine(e)) finish("up");
  };
  const cancel = (e: Event): void => {
    if (mine(e)) finish("cancel");
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", cancel);
  target.addEventListener("lostpointercapture", cancel);
  return () => finish("cancel");
}
