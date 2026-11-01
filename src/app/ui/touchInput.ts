/**
 * Touch-aware pieces shared by the plots and the 3D views: whether the main
 * pointer is a finger, whether the zoom key is ⌘ or Ctrl, the gesture wording
 * that matches both, and a drag that ends however the pointer goes away. The pure parts are tested without a
 * browser (touchInput.test.ts).
 */

import { useMediaQuery } from "@/app/ui/useMediaQuery";

/** The main pointer is a finger (a phone, a tablet): the CSS `(pointer: coarse)`. */
export const COARSE_QUERY = "(pointer: coarse)";

/** Whether the main pointer is coarse, following the device as it changes (a keyboard and trackpad attached). */
export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_QUERY);
}

/**
 * Whether the zoom key is ⌘ rather than Ctrl: macOS, and iPadOS / iOS with a
 * keyboard (an iPad reports itself as a Mac).
 */
export function isMac(nav: { readonly platform?: string; readonly userAgent?: string } | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  return nav !== undefined && /Mac|iPhone|iPad|iPod/i.test(nav.platform || nav.userAgent || "");
}

/** A view the hint describes: a 1-D plot (usePlotInteraction) or the 3D model (StructureView). */
export type GestureView = "plot" | "model-3d";

export interface GestureInput {
  /** The main pointer is a finger (`useCoarsePointer`). */
  readonly coarse: boolean;
  /** ⌘ rather than Ctrl (`isMac`). */
  readonly mac: boolean;
  /** The plot has fit-range handles to drag. */
  readonly fitHandles?: boolean;
  /** The plot has reflection ticks that name their indices on a click. */
  readonly ticks?: boolean;
}

export interface GestureHint {
  /** The one line shown with the view: how to zoom first, then pan or rotate. */
  readonly text: string;
  /** The secondary gestures, for the hint's tooltip, one sentence each. */
  readonly more: readonly string[];
}

/**
 * The how-to line with a view, in the gestures the user has: a mouse or
 * trackpad scrolls with ⌘ (a Mac) or Ctrl, drags and double-clicks; a finger
 * pinches and drags (a key + scroll and Shift + drag do not exist on a phone).
 * The line stays short; the rest goes in `more`, the hint's tooltip. The 3D
 * gestures are OrbitControls' defaults.
 */
export function gestureHint(view: GestureView, { coarse, mac, fitHandles = false, ticks = false }: GestureInput): GestureHint {
  if (view === "model-3d") {
    return coarse
      ? { text: "Pinch to zoom · drag to rotate", more: ["Drag two fingers to pan.", "View a, b or c looks down that axis."] }
      : { text: "Scroll to zoom · drag to rotate", more: ["Right-drag or Shift + drag to pan.", "View a, b or c looks down that axis."] };
  }
  const shared = [
    ...(ticks ? [`${coarse ? "Tap" : "Click"} a reflection tick for its indices.`] : []),
    ...(fitHandles ? ["Drag the blue handles to set the fit range."] : []),
  ];
  return coarse
    ? { text: "Pinch to zoom · drag to pan", more: ["Tap the plot to read the values there.", "Reset shows the whole range.", ...shared] }
    : {
        text: `${mac ? "⌘" : "Ctrl"} + scroll to zoom · drag to pan · double-click to reset`,
        more: [
          "Shift + drag a box to zoom to it.",
          "A trackpad pinch also zooms; a sideways swipe or Shift + scroll pans.",
          "Keys, once the plot has focus: + and − zoom, ← and → pan, 0 resets.",
          ...shared,
        ],
      };
}

/**
 * A plot's accessible description: every gesture and key, whatever the
 * pointer (a screen reader user may have any of them).
 */
export function plotGestureDescription(mac: boolean): string {
  return `Drag to pan, Shift + drag to box-zoom, ${mac ? "⌘" : "Ctrl"} + scroll or pinch to zoom, double-click to reset. Keys: plus and minus zoom, left and right arrows pan, Shift + arrows step the cursor one point, 0 resets.`;
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
