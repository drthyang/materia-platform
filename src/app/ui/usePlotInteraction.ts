/**
 * Shared pointer / wheel / keyboard / touch mechanics of the interactive 1-D
 * plots (the powder pattern, G(r), the magnetic step's pattern, S(Q)), so every
 * plot zooms, pans and resets the same way. The maths is in
 * `visualization/plotView`; this hook keeps the x window (and an optional y
 * lock) and turns input into window changes. What the plot draws, and what a
 * click or the cursor reads, stays with the plot.
 *
 * The rules (documented in USER_GUIDE "Zoom, pan and the cursor readout"):
 *  - Hover: a cursor at the pointer's x (the plot draws the line and readout).
 *  - Ctrl/⌘ + wheel and trackpad pinch: zoom x about the cursor. A plain wheel
 *    zooms too when nothing around the plot can scroll; where the page scrolls,
 *    a plain wheel scrolls it and briefly shows the gesture line ("Ctrl + scroll to zoom · drag to pan · …")
 *    (⌘ on a Mac). The resting hint under each plot is `GestureHintLine`.
 *  - A horizontal wheel / trackpad swipe (or Shift + wheel) pans x.
 *  - Drag pans x; Shift + drag box-zooms (a flat box zooms x only, a box at
 *    least 20 px tall also fixes y to the box). A click without a drag is the
 *    plot's own click (a Bragg tick, "add a peak here").
 *  - Double-click resets the view (whole range, y automatic).
 *  - Keys when focused: + / − zoom about the cursor (or the centre), ← / → pan
 *    a tenth of the window, Shift + ← / → step the cursor one data point,
 *    0 resets, Esc cancels a drag and hides the cursor.
 *  - Touch: one finger scrolls the page vertically and pans the plot
 *    horizontally, two fingers pinch-zoom, a tap shows the readout there.
 *  - The window is clamped to the data range; y autoscales to what is in view
 *    unless locked (a tall box zoom, or the Lock y button).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { clampView, isFullView, nearestIndex, panBy, wheelZoomFactor, zoomAt, type XView } from "@/visualization/plotView";
import { isMac } from "@/app/ui/touchInput";

/** The plot's frame in its own user units (one unit = one CSS px at its size). */
export interface PlotGeometry {
  /** The SVG's user-space size (its viewBox). */
  readonly boxW: number;
  /** Left and right edges of the data area. */
  readonly x0: number;
  readonly x1: number;
  /** Top and bottom of the band a box zoom reads y from (the main panel). */
  readonly yTop: number;
  readonly yBottom: number;
}

export interface PlotTap {
  /** Data x at the tap. */
  readonly x: number;
  readonly userX: number;
  readonly userY: number;
  /** The element pressed (a tap on a tick is the tick's own click). */
  readonly target: Element | null;
}

export interface PlotInteractionOptions {
  readonly svgRef: RefObject<SVGSVGElement>;
  /** The whole data range in the display unit. */
  readonly domain: XView;
  /** Narrowest window (see plotView.minimumSpan). */
  readonly minSpan: number;
  readonly geometry: PlotGeometry;
  /** The plotted x values, for the keyboard's one-point cursor steps. */
  readonly xs?: readonly number[];
  /** Main-band pixel → data y at the current scale (for a box's y range). */
  readonly yAt?: (userY: number) => number;
  /** A press-and-release without a drag. */
  readonly onTap?: (tap: PlotTap) => void;
}

export interface PlotCursor {
  readonly x: number;
  readonly source: "pointer" | "keyboard" | "touch";
}

export interface PlotBox {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  /** A flat box zooms x only. */
  readonly xOnly: boolean;
}

/** A box at least this tall (px) also fixes y. */
const BOX_Y_MIN = 20;
/** Movement (px) before a press becomes a drag. */
const DRAG_SLOP = 3;
const KEY_ZOOM = 1.5;
const KEY_PAN = 0.1;

/** The hint a plain wheel shows where the page scrolls: zoom first, then the other gestures, one line. */
export function zoomHintText(): string {
  return `${isMac() ? "⌘" : "Ctrl"} + scroll to zoom · drag to pan · Shift + drag to box-zoom · double-click to reset`;
}

/** Whether a vertical wheel over `el` would scroll something (an ancestor or the page). */
export function scrollsAround(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (/(auto|scroll|overlay)/.test(oy) && p.scrollHeight > p.clientHeight + 1) return true;
  }
  const doc = document.scrollingElement ?? document.documentElement;
  const bodyOy = getComputedStyle(document.body).overflowY;
  return bodyOy !== "hidden" && doc.scrollHeight > doc.clientHeight + 1;
}

export function usePlotInteraction(opts: PlotInteractionOptions) {
  const { svgRef, domain, minSpan, geometry } = opts;
  const [viewState, setViewState] = useState<XView | null>(null);
  const [yLock, setYLock] = useState<{ lo: number; hi: number } | null>(null);
  const [cursor, setCursorState] = useState<PlotCursor | null>(null);
  const [box, setBox] = useState<PlotBox | null>(null);
  const [panning, setPanning] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const view = viewState ? clampView(viewState, domain, minSpan) : domain;
  const full = isFullView(view, domain);

  // Latest values for the native listeners and the rAF-coalesced updates.
  const live = useRef({ view, domain, minSpan, geometry, opts, cursor });
  live.current = { view, domain, minSpan, geometry, opts, cursor };
  const pendingView = useRef<XView | null | undefined>(undefined);
  const pendingCursor = useRef<PlotCursor | null | undefined>(undefined);
  const raf = useRef(0);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<{ dataX: number; clientX: number; x0: number; x1: number; boxW: number; t: number } | null>(null);

  const flush = useCallback((): void => {
    raf.current = 0;
    if (pendingView.current !== undefined) {
      setViewState(pendingView.current);
      pendingView.current = undefined;
    }
    if (pendingCursor.current !== undefined) {
      setCursorState(pendingCursor.current);
      pendingCursor.current = undefined;
    }
  }, []);
  const schedule = useCallback((): void => {
    if (raf.current) return;
    raf.current = typeof requestAnimationFrame === "function" ? requestAnimationFrame(flush) : (setTimeout(flush, 0) as unknown as number);
  }, [flush]);
  useEffect(() => () => {
    if (raf.current && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf.current);
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  /** The window as the next frame will show it (pending changes included). */
  const latestView = (): XView => {
    const l = live.current;
    const p = pendingView.current;
    return p === undefined ? l.view : p === null ? l.domain : clampView(p, l.domain, l.minSpan);
  };
  const queueView = (v: XView | null): void => {
    pendingView.current = v;
    schedule();
  };
  const queueCursor = (c: PlotCursor | null): void => {
    pendingCursor.current = c;
    schedule();
  };

  /** Client px → user px (the SVG's own units; correct under a CSS zoom). */
  const toUser = (clientX: number, clientY: number): { ux: number; uy: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const g = live.current.geometry;
    // The viewBox height is the rendered height in user units: scale y by the
    // same rule as x (the box is never letterboxed: preserveAspectRatio none).
    const boxH = (svg.viewBox?.baseVal?.height || r.height) as number;
    return { ux: ((clientX - r.left) / r.width) * g.boxW, uy: ((clientY - r.top) / r.height) * boxH };
  };
  const dataXAt = (ux: number, v: XView): number => {
    const g = live.current.geometry;
    return v.min + ((ux - g.x0) / (g.x1 - g.x0 || 1)) * (v.max - v.min);
  };

  const setView = useCallback((v: XView | null): void => {
    pendingView.current = undefined;
    anchor.current = null;
    setViewState(v);
  }, []);

  const zoomAbout = (dataX: number, factor: number, clientX?: number): void => {
    const l = live.current;
    const v = latestView();
    const next = zoomAt(v, dataX, factor, l.domain, l.minSpan);
    if (clientX !== undefined) anchor.current = { dataX, clientX, x0: l.geometry.x0, x1: l.geometry.x1, boxW: l.geometry.boxW, t: Date.now() };
    queueView(isFullView(next, l.domain) ? null : next);
  };

  // Keep a zoom's anchor under the cursor when the frame itself moves (the left
  // margin follows the y-label width, which a zoom can change): one correction,
  // before paint.
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    if (a.x0 === geometry.x0 && a.x1 === geometry.x1 && a.boxW === geometry.boxW) return;
    anchor.current = null;
    if (Date.now() - a.t > 500) return; // a resize long after the zoom: nothing to keep
    const u = toUser(a.clientX, 0);
    if (!u) return;
    const span = view.max - view.min;
    const min = a.dataX - ((u.ux - geometry.x0) / (geometry.x1 - geometry.x0 || 1)) * span;
    const next = clampView({ min, max: min + span }, domain, minSpan);
    if (Math.abs(next.min - view.min) > 1e-12 * Math.abs(span)) setViewState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the frame moves
  }, [geometry.x0, geometry.x1, geometry.boxW]);

  const reset = useCallback((): void => {
    setView(null);
    setYLock(null);
  }, [setView]);

  const zoomCentreOrCursor = (factor: number): void => {
    const v = latestView();
    const c = live.current.cursor;
    const at = c && c.x >= v.min && c.x <= v.max ? c.x : (v.min + v.max) / 2;
    zoomAbout(at, factor);
  };
  const zoomIn = (): void => zoomCentreOrCursor(1 / KEY_ZOOM);
  const zoomOut = (): void => zoomCentreOrCursor(KEY_ZOOM);

  const showHint = (): void => {
    setHint(zoomHintText());
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 1500);
  };

  // --- wheel and Safari pinch: native listeners (React's wheel is passive) ----
  // Attached to whichever element the ref holds (a plot that first renders
  // without its SVG gets them when the SVG appears).
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  // Every render, but it sets state only when the element changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a ref's element is only seen after the commit
  useLayoutEffect(() => {
    if (svgRef.current !== svgEl) setSvgEl(svgRef.current);
  });
  useEffect(() => {
    const svg = svgEl;
    if (!svg) return;
    const onWheel = (e: WheelEvent): void => {
      const l = live.current;
      const u = toUser(e.clientX, e.clientY);
      if (!u) return;
      const zoomKey = e.ctrlKey || e.metaKey;
      const v = latestView();
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || (e.shiftKey && !zoomKey);
      if (horizontal) {
        if (isFullView(v, l.domain)) return; // nothing to pan: leave it to the page
        e.preventDefault();
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const px = e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * 400 : d;
        const r = svg.getBoundingClientRect();
        const du = (px / (r.width || 1)) * l.geometry.boxW;
        queueView(panBy(v, (du / (l.geometry.x1 - l.geometry.x0 || 1)) * (v.max - v.min), l.domain));
        return;
      }
      if (!zoomKey && scrollsAround(svg)) {
        showHint();
        return; // the page scrolls
      }
      e.preventDefault();
      if (e.deltaY === 0) return;
      const at = Math.min(v.max, Math.max(v.min, dataXAt(u.ux, v)));
      zoomAbout(at, wheelZoomFactor(e.deltaY, e.deltaMode), e.clientX);
    };
    // Safari reports a trackpad pinch as gesture events, not ctrl + wheel.
    let gestureScale = 1;
    let gestureAt: { dataX: number; clientX: number } | null = null;
    const onGestureStart = (e: Event): void => {
      e.preventDefault();
      const ge = e as Event & { clientX: number; scale: number };
      const u = toUser(ge.clientX, 0);
      const v = latestView();
      gestureScale = 1;
      gestureAt = u ? { dataX: Math.min(v.max, Math.max(v.min, dataXAt(u.ux, v))), clientX: ge.clientX } : null;
    };
    const onGestureChange = (e: Event): void => {
      e.preventDefault();
      const ge = e as Event & { scale: number };
      if (!gestureAt || !(ge.scale > 0)) return;
      zoomAbout(gestureAt.dataX, gestureScale / ge.scale, gestureAt.clientX);
      gestureScale = ge.scale;
    };
    const onGestureEnd = (e: Event): void => {
      e.preventDefault();
      gestureAt = null;
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("gesturestart", onGestureStart, { passive: false } as AddEventListenerOptions);
    svg.addEventListener("gesturechange", onGestureChange, { passive: false } as AddEventListenerOptions);
    svg.addEventListener("gestureend", onGestureEnd, { passive: false } as AddEventListenerOptions);
    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("gesturestart", onGestureStart);
      svg.removeEventListener("gesturechange", onGestureChange);
      svg.removeEventListener("gestureend", onGestureEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the listeners read `live`
  }, [svgEl]);

  // --- pointer: drag pans, Shift + drag box-zooms, two fingers pinch --------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const press = useRef<{
    id: number; clientX: number; clientY: number; ux: number; uy: number;
    view: XView; mode: "pan" | "box"; moved: boolean; target: Element | null; type: string;
  } | null>(null);
  const pinch = useRef<{ dist: number; view: XView; dataX: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const u = toUser(e.clientX, e.clientY);
    if (!u) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no capture in tests */ }
    if (pointers.current.size === 2) {
      // Two fingers: pinch about their midpoint; the one-finger pan stops.
      const [a, b] = [...pointers.current.values()];
      const mid = toUser((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      const v = latestView();
      press.current = null;
      setPanning(false);
      pinch.current = mid ? { dist: Math.max(1, Math.abs(a!.x - b!.x)), view: v, dataX: dataXAt(mid.ux, v) } : null;
      return;
    }
    press.current = {
      id: e.pointerId, clientX: e.clientX, clientY: e.clientY, ux: u.ux, uy: u.uy,
      view: latestView(), mode: e.shiftKey ? "box" : "pan", moved: false,
      target: e.target as Element | null, type: e.pointerType,
    };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const l = live.current;
    const g = l.geometry;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pz = pinch.current;
    if (pz && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = toUser((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      if (!mid) return;
      const factor = pz.dist / Math.max(1, Math.abs(a!.x - b!.x));
      const span = Math.min(l.domain.max - l.domain.min, Math.max(l.minSpan, (pz.view.max - pz.view.min) * factor));
      const min = pz.dataX - ((mid.ux - g.x0) / (g.x1 - g.x0 || 1)) * span;
      const next = clampView({ min, max: min + span }, l.domain, l.minSpan);
      queueView(isFullView(next, l.domain) ? null : next);
      return;
    }
    const u = toUser(e.clientX, e.clientY);
    if (!u) return;
    const p = press.current;
    if (p && p.id === e.pointerId) {
      if (!p.moved && Math.hypot(e.clientX - p.clientX, e.clientY - p.clientY) > DRAG_SLOP) {
        p.moved = true;
        if (p.mode === "pan") setPanning(true);
      }
      if (!p.moved) return;
      if (p.mode === "pan") {
        const dxData = ((u.ux - p.ux) / (g.x1 - g.x0 || 1)) * (p.view.max - p.view.min);
        queueView(panBy(p.view, -dxData, l.domain));
        if (p.type !== "touch") queueCursor(null);
      } else {
        const clampX = (x: number): number => Math.min(g.x1, Math.max(g.x0, x));
        const clampY = (y: number): number => Math.min(g.yBottom, Math.max(g.yTop, y));
        const y0 = clampY(p.uy);
        const y1 = clampY(u.uy);
        setBox({ x0: clampX(p.ux), x1: clampX(u.ux), y0, y1, xOnly: Math.abs(y1 - y0) < BOX_Y_MIN || !opts.yAt });
      }
      return;
    }
    if (e.pointerType === "touch") return;
    // Hover: the cursor follows the pointer over the data area.
    const inside = u.ux >= g.x0 && u.ux <= g.x1;
    queueCursor(inside ? { x: dataXAt(u.ux, latestView()), source: "pointer" } : null);
  };

  const endPress = (e: React.PointerEvent<SVGSVGElement>, cancelled: boolean): void => {
    pointers.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      press.current = null;
      return;
    }
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    setPanning(false);
    const l = live.current;
    const g = l.geometry;
    if (cancelled) {
      setBox(null);
      return;
    }
    const u = toUser(e.clientX, e.clientY);
    if (!p.moved) {
      if (!u) return;
      const x = dataXAt(u.ux, latestView());
      if (p.type === "touch" && u.ux >= g.x0 && u.ux <= g.x1) queueCursor({ x, source: "touch" });
      opts.onTap?.({ x, userX: u.ux, userY: u.uy, target: p.target });
      return;
    }
    if (p.mode === "box") {
      setBox(null);
      if (!u) return;
      const a = Math.min(g.x1, Math.max(g.x0, Math.min(p.ux, u.ux)));
      const b = Math.min(g.x1, Math.max(g.x0, Math.max(p.ux, u.ux)));
      if (b - a < DRAG_SLOP) return;
      const v = p.view;
      const next = clampView({ min: dataXAt(a, v), max: dataXAt(b, v) }, l.domain, l.minSpan);
      anchor.current = null;
      pendingView.current = undefined;
      setViewState(next);
      const ya = Math.min(g.yBottom, Math.max(g.yTop, p.uy));
      const yb = Math.min(g.yBottom, Math.max(g.yTop, u.uy));
      if (opts.yAt && Math.abs(yb - ya) >= BOX_Y_MIN) {
        const lo = opts.yAt(Math.max(ya, yb));
        const hi = opts.yAt(Math.min(ya, yb));
        if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) setYLock({ lo, hi });
      }
    }
  };

  const onPointerLeave = (): void => {
    if (!press.current && live.current.cursor?.source === "pointer") queueCursor(null);
  };

  // --- keyboard ---------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl + / − stay the browser's page zoom
    const l = live.current;
    const v = latestView();
    const span = v.max - v.min;
    const c = l.cursor;
    switch (e.key) {
      case "+":
      case "=":
        zoomIn();
        break;
      case "-":
      case "_":
        zoomOut();
        break;
      case "0":
        reset();
        break;
      case "ArrowLeft":
      case "ArrowRight": {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (e.shiftKey) {
          // Step the cursor one data point (the readout follows).
          const xs = l.opts.xs;
          if (!xs || xs.length === 0) break;
          const asc = xs[xs.length - 1]! >= xs[0]!;
          const from = c ? nearestIndex(xs, c.x) : nearestIndex(xs, (v.min + v.max) / 2);
          const i = Math.min(xs.length - 1, Math.max(0, from + (asc ? dir : -dir)));
          const x = xs[i]!;
          queueCursor({ x, source: "keyboard" });
          if (x < v.min || x > v.max) queueView(panBy(v, x < v.min ? x - v.min : x - v.max, l.domain));
          break;
        }
        const next = panBy(v, dir * KEY_PAN * span, l.domain);
        queueView(isFullView(next, l.domain) ? null : next);
        // The keyboard cursor keeps its place on screen as the data slides under it.
        if (c && c.source !== "pointer") queueCursor({ x: c.x + (next.min - v.min), source: c.source });
        break;
      }
      case "Escape":
        // Cancels a drag and hides the cursor; left to bubble, so an Esc
        // that closes something else still does.
        press.current = null;
        setBox(null);
        setPanning(false);
        queueCursor(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const onFocus = (e: React.FocusEvent<SVGSVGElement>): void => {
    // A keyboard focus shows the cursor at the centre, so the readout speaks.
    let keyboard: boolean;
    try { keyboard = e.currentTarget.matches(":focus-visible"); } catch { keyboard = false; }
    if (keyboard && !live.current.cursor) {
      const v = latestView();
      queueCursor({ x: (v.min + v.max) / 2, source: "keyboard" });
    }
  };
  const onBlur = (): void => {
    if (live.current.cursor?.source === "keyboard") queueCursor(null);
  };

  return {
    /** The resolved window (the whole range when not zoomed). */
    view,
    /** The window differs from the whole range, or y is locked. */
    zoomed: !full || yLock !== null,
    xZoomed: !full,
    setView,
    yLock,
    setYLock,
    cursor,
    box,
    panning,
    hint,
    zoomIn,
    zoomOut,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => endPress(e, false),
      onPointerCancel: (e: React.PointerEvent<SVGSVGElement>) => endPress(e, true),
      onPointerLeave,
      onDoubleClick: reset,
      onKeyDown,
      onFocus,
      onBlur,
    },
  };
}

/**
 * A screen-reader copy of a changing readout: the latest text, at most once
 * per `ms`, trailing (the last value always lands).
 */
export function useThrottledText(text: string, ms = 600): string {
  const [out, setOut] = useState(text);
  const last = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const wait = Math.max(0, last.current + ms - now);
    const t = setTimeout(() => {
      last.current = Date.now();
      setOut(text);
    }, wait);
    return () => clearTimeout(t);
  }, [text, ms]);
  return out;
}
