/**
 * Powder-pattern chart, rebuilt to the design handoff spec: a custom SVG plot
 * with auto-scaled y/x "nice" ticks, obs/calc/bkg/diff series, a difference
 * band, a Bragg-reflection tick row (coloured per phase), excluded-region
 * scrims, draggable fit-range handles, and the shared zoom / pan / cursor
 * readout of `usePlotInteraction`. Fed by the real refinement curves.
 *
 * The data series (obs markers, ±σ ribbon, calc, background, overlays, the
 * difference) and the Bragg tick rows are painted on a canvas under the SVG,
 * decimated per pixel column when the view holds more points than pixels, so
 * a pan or zoom costs the plot's width rather than its point count. Axes,
 * labels, the picked and hovered ticks, the
 * legend and the handles stay SVG on top.
 *
 * The viewBox is the element's own measured size, so one user unit is one CSS
 * pixel: labels keep the same readable size on a phone, a 1080p laptop and a 4K
 * monitor, and the extra height of a tall plot goes to the data rather than to
 * ever-larger text. (A fixed 560-unit viewBox used to scale every glyph with the
 * card height — ~5px labels on an iPad, ~30px on a 4K screen.)
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PowderCurves } from "@/core/workflow/powder";
import type { PhaseTicks } from "@/visualization/reflectionTicks";
import { color, mono } from "@/app/theme";
import { minMax } from "@/core/math/extent";
import { cssZoom } from "@/app/ui/cssZoom";
import { usePlotInteraction, useThrottledText, type PlotTap } from "@/app/ui/usePlotInteraction";
import { PlotHint, PlotZoomControls, plotReadoutBox, zoomControlsInline } from "@/app/ui/PlotControls";
import { gripHitWidth, trackPointerDrag, useCoarsePointer } from "@/app/ui/touchInput";
import { tickCountFor, yTickCount } from "@/visualization/axisTicks";
import {
  decimalsForStep, decimateByColumn, formatReadoutValue, localStep, minimumSpan, nearestIndex, splitAxisLabel, ticksNear, visibleIndexRange,
} from "@/visualization/plotView";

export interface FitRangeSelection {
  readonly min: number;
  readonly max: number;
}

/** A detected ("found") peak, flagged with a ▽ marker above the pattern. */
export interface FoundPeak {
  /** Position in the plot's current display unit (x-axis). */
  readonly x: number;
  /** d-spacing in Å (for the tooltip). */
  readonly d: number;
  /** Sits on a known reflection (named here): drawn hollow, a misfit rather than new intensity. */
  readonly near?: string;
}

interface Props {
  readonly curves: PowderCurves;
  readonly xLabel: string;
  readonly fitRange?: FitRangeSelection;
  readonly onFitRangeChange?: (range: FitRangeSelection) => void;
  readonly phases?: readonly PhaseTicks[];
  /**
   * Detected peaks to flag with downward ▽ triangles *above* the pattern — the
   * magnetic-analysis "found peaks" (intensity the nuclear fit leaves
   * unexplained). Deliberately a different mark from the Bragg-tick phase rows
   * below, so found peaks don't read as another indexed phase.
   */
  readonly foundPeaks?: readonly FoundPeak[];
  /**
   * How to draw `foundPeaks` (default: obs-coloured ▽, legend "found"). With
   * `guides`, each marker also drops a dashed line through the intensity
   * region, so the peak stands out on a dense pattern.
   */
  readonly foundStyle?: { readonly label: string; readonly color: string; readonly guides: boolean };
  readonly showBackground?: boolean;
  /** Increment to zoom the view onto the active fit range (no-op without one). */
  readonly focusFitToken?: number;
  /** Increment to zoom in on the currently-highlighted reflection, centred, at a
   *  moderate zoom (from "Show in pattern" in the F_obs/F_calc plot). */
  readonly focusPeakToken?: number;
  /** Zoom in on this display-unit x, centred (from the Validation view's
   *  residual strip). A new token re-runs the zoom; it also runs on mount. */
  readonly focusPoint?: { readonly x: number; readonly token: number } | null;
  /**
   * A reflection spotlighted from elsewhere (e.g. a point clicked in the
   * F_obs/F_calc plot): its hkl ("h k l") and kind. Draws an arrow + guide line
   * down to its Bragg position (on the matching phase row) and pans the view to
   * reveal it if it is off-screen.
   */
  readonly highlight?: { readonly hkl: string; readonly kind: "nuclear" | "magnetic"; readonly phaseId?: string } | null;
  /**
   * Called when a Bragg tick is clicked (or the current pick is toggled off) —
   * the *same* selection channel as the F_obs/F_calc plot, so a tick click and a
   * scatter-point click share one spotlight and each replaces the other. Passes
   * the tick's hkl + phase kind + phase id, or null to clear.
   */
  readonly onHighlight?: (sel: { hkl: string; kind: "nuclear" | "magnetic"; phaseId?: string } | null) => void;
  /**
   * Called on a plain click in the data area (a press-and-release without the
   * drag that starts a rubber zoom, and not on a Bragg tick), with the clicked
   * x in data units — e.g. the magnetic page's "add a residual peak here".
   */
  readonly onPlotClick?: (x: number) => void;
  /**
   * Signed ordinate: auto-scale y to the observed data's [min, max] instead of
   * clamping at 0, and draw a zero line. For observables that oscillate about
   * zero — a reduced PDF G(r) has negative lobes that the default [0, yTop]
   * intensity scale would flatten. Default false (Rietveld intensity behaviour).
   */
  readonly signedY?: boolean;
  /** y-axis caption; defaults to the Rietveld "Intensity (a.u.)". */
  readonly yLabel?: string;
  /**
   * Extra decomposition curves on the calc's y-scale with their own legend
   * entries — e.g. element-pair partial PDFs. Drawn under the calc line,
   * clipped to the fit window, coloured from a fixed muted palette.
   */
  readonly overlays?: readonly { readonly label: string; readonly y: readonly number[] }[];
  /**
   * Standard uncertainty of each observed point (aligned with `curves.x`):
   * drawn as a ±σ error RIBBON around the observations, and included in the
   * y auto-scale so the ribbon is never clipped. Omit for no ribbon.
   */
  readonly obsSigma?: readonly number[];
  /** Legend label for the ribbon (e.g. "±σ propagated"); default "±σ". */
  readonly obsSigmaLabel?: string;
  /**
   * The zoom is kept until this changes (compared by identity): pass a value
   * that changes with the dataset and the x unit, so a refinement — even one
   * that moves a converted axis (a refined zero or difC in a d display) —
   * keeps the view. Omitted, the view resets when the x label, the point count
   * or the x range changes.
   */
  readonly viewKey?: unknown;
  /** Accessible name of the plot (the keyboard help is appended). */
  readonly ariaLabel?: string;
}

/** Muted overlay palette — distinct from the obs/calc/diff/bkg series inks. */
const OVERLAY_COLORS = ["#b0812f", "#7a5ea8", "#2f8f8a", "#c05575", "#5d7f34", "#8a6652"];

// Plot geometry in CSS px (the viewBox tracks the rendered size; see above).
// Vertical stack (top→bottom): intensity plot, x-axis ticks/labels, a Bragg
// reflection tick band, then the difference band — each with clear separation.
// The fixed-height bands (labels, ticks, caps) are laid out from the bottom
// edge; the intensity region takes whatever height is left. At a 560px-tall plot
// this reproduces the original 560-unit layout exactly.
const X0_MIN = 58; // left margin: y tick labels + the rotated axis title
const RIGHT_PAD = 14; // right margin; the drawable width fills to boxW − RIGHT_PAD
const MIN_W = 240; // narrowest drawing width (a phone card is ~330px)
// The plot box is at least 320px tall (see the wrapper), except where the page
// fits it to a short window (a phone on its side: .wb-plot-box in workbench.css).
const MIN_H = 200;
const TOP = 14;
const TICK_H = 9; // tick mark height at the default row spacing
const TICK_ROW = 13; // vertical step per phase row (> tick height so rows never overlap)
// Found-peak (▽) markers: a row of downward triangles just below the legend,
// above the intensity plot — a distinct mark from the Bragg tick rows below.
const FOUND_TOP = 30; // flat top edge of the triangle
const FOUND_H = 8; // triangle height (apex points down toward the peak x)
const FOUND_W = 5; // triangle half-width
const LEGEND_Y = 24; // first legend row's centre line
const LEGEND_ROW = 16; // extra legend rows (a narrow plot wraps its legend)

/** Vertical layout for a plot `h` px tall (bottom-up; see the constants above). */
function plotLayout(h: number) {
  const capY = h - 38; // fit-handle caps, below the difference band
  // Difference half-height. A plot under 300px tall (only a phone on its side
  // makes one) takes a slimmer floor, so the pattern keeps most of the height.
  const diffA = Math.round(Math.min(110, Math.max(h < 300 ? 18 : 26, h * 0.082)));
  const diffY = capY - 6 - diffA; // difference-band zero line
  const tickMaxBot = diffY - diffA - 4; // tick band floor (just above the difference band)
  const tickTop = tickMaxBot - 38; // Bragg tick band (below the x-axis labels)
  const base = tickTop - 26; // main-region baseline
  return { capY, diffA, diffY, tickMaxBot, tickTop, base, mainH: base - TOP - 6, xLabelY: base + 16, axisTitleY: h - 10 };
}

/**
 * Plot type size, tracking the app's fluid micro text (--fz-micro in
 * workbench.css: 10.5px → 12.5px with the window) so the chart never reads
 * smaller than the UI around it.
 */
function plotTypeScale(): number {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  return Math.min(12.5, Math.max(10.5, vw * 0.0018 + 9)) / 10.5;
}

/** Monospace advance (IBM Plex Mono is 0.6 em) — sizes legend entries and labels. */
const MONO_ADVANCE = 0.6;

function niceNum(x: number, round: boolean): number {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

function formatY(v: number, step = 1): string {
  if (v === 0) return "0";
  if (Math.abs(v) >= 1000) return `${+(v / 1000).toFixed(1)}k`;
  if (step >= 1) return String(Math.round(v));
  // Sub-unit tick spacing (signed G(r) scales are O(1)): show enough decimals
  // to distinguish adjacent ticks.
  const decimals = Math.min(3, Math.max(1, -Math.floor(Math.log10(step))));
  return v.toFixed(decimals);
}

function formatX(v: number, span: number): string {
  if (span >= 200) return String(Math.round(v));
  if (span >= 5) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * Display form of an hkl label: magnetic satellite indices are non-integer
 * (G ± k), and a fractional k like 1/3 would print its full float — trim to
 * 3 decimals for reading. Display only; matching still uses the raw string.
 */
function formatHkl(hkl: string): string {
  return hkl
    .split(" ")
    .map((s) => {
      const v = Number(s);
      if (!Number.isFinite(v)) return s;
      const r = Math.round(v);
      return Math.abs(v - r) < 5e-4 ? String(r) : String(+v.toFixed(3));
    })
    .join(" ");
}

/** Pixel tolerance for "the reflection under the cursor" (readout and tick click). */
const TICK_TOL_PX = 4.5;

export function WorkbenchPlot({
  curves,
  xLabel,
  fitRange,
  onFitRangeChange,
  phases,
  foundPeaks,
  foundStyle,
  showBackground = true,
  focusFitToken = 0,
  focusPeakToken = 0,
  focusPoint = null,
  highlight: highlightSel = null,
  onHighlight,
  onPlotClick,
  signedY = false,
  yLabel = "Intensity (a.u.)",
  overlays,
  obsSigma,
  obsSigmaLabel = "±σ",
  viewKey,
  ariaLabel,
}: Props): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingGrip = useRef(false);
  const coarse = useCoarsePointer();
  const gripW = gripHitWidth(coarse);
  const onTapRef = useRef<(tap: PlotTap) => void>(() => {});

  const xs = curves.x;
  const { min: fullMin, max: fullMax } = xs.length ? minMax(xs) : { min: 0, max: 1 };
  const domain = useMemo(() => ({ min: fullMin, max: fullMax > fullMin ? fullMax : fullMin + 1 }), [fullMin, fullMax]);
  const minSpan = useMemo(() => minimumSpan(xs), [xs]);

  // A Bragg tick click is the *same* selection as an F_obs/F_calc point click:
  // both flow through `onHighlight` into one shared spotlight (`highlightSel`),
  // so clicking a tick draws the arrow+guide line and replaces any prior pick,
  // and clicking a scatter point replaces the tick pick. There is no separate
  // per-plot selection state — the parent owns the single selection.

  // The viewBox is the rendered box in CSS px (the element's own, unzoomed
  // size — contentRect, not getBoundingClientRect, which a CSS zoom scales), so
  // units are square and one unit is one pixel: no stretched text or lines, and
  // the plot uses the full width and height at any window size.
  const [box, setBox] = useState({ w: 860, h: 560 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (r && r.height > 0 && r.width > 0) {
        setBox({ w: Math.max(MIN_W, Math.round(r.width)), h: Math.max(MIN_H, Math.round(r.height)) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const boxW = box.w;
  const VB_H = box.h;
  const { capY: CAP_Y, diffA: DIFF_A, diffY: DIFF_Y, tickMaxBot: TICK_MAX_BOT, tickTop: TICK_TOP, base: BASE, mainH: MAINH, xLabelY: X_LABEL_Y, axisTitleY: AXIS_TITLE_Y } = plotLayout(VB_H);
  const ts = plotTypeScale();
  const fsTick = 10 * ts; // axis tick labels
  const fsLabel = 11 * ts; // axis titles, legend, spotlight label

  // y range of the observed data (±σ) over [lo, hi], padded as the axis shows it.
  const yObs = curves.yObs;
  const yRangeOver = (lo: number, hi: number): { yTop: number; yLo: number } => {
    let top = signedY ? -Infinity : 1;
    let bot = 0;
    const [i0, i1] = visibleIndexRange(xs, lo, hi);
    for (let i = i0; i < i1; i++) {
      if (xs[i]! >= lo && xs[i]! <= hi) {
        const sd = obsSigma?.[i] ?? 0;
        top = Math.max(top, yObs[i]! + sd);
        if (signedY) bot = Math.min(bot, yObs[i]! - sd);
      }
    }
    if (!Number.isFinite(top)) top = 1;
    if (signedY) {
      const pad = 0.06 * (top - bot || 1);
      return { yTop: top + pad, yLo: bot - pad };
    }
    return { yTop: top * 1.06, yLo: bot };
  };
  // The whole-range y ticks fix the left margin's minimum, so zooming into a
  // region with shorter y labels does not shift the frame under the cursor.
  const fullYChars = useMemo(() => {
    const { yTop: t, yLo: b } = yRangeOver(domain.min, domain.max);
    const step = niceNum((t - b) / 4, true);
    let n = 1;
    for (let v = Math.ceil(b / step) * step; v <= t + 1e-6 * step; v += step) n = Math.max(n, formatY(v, step).length);
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- of the data only
  }, [xs, yObs, obsSigma, signedY, domain]);

  // --- interaction (zoom / pan / cursor), shared with the other curve plots ---
  // The frame needs the y-label width, which needs the view's y range: the
  // margin is computed from the hook's view below, and fed back next render.
  const [frame, setFrame] = useState({ x0: X0_MIN, x1: boxW - RIGHT_PAD });
  const yScaleRef = useRef<{ yLo: number; ySpan: number }>({ yLo: 0, ySpan: 1 });
  const ix = usePlotInteraction({
    svgRef,
    domain,
    minSpan,
    xs,
    geometry: { boxW, x0: frame.x0, x1: frame.x1, yTop: TOP, yBottom: BASE },
    yAt: (uy) => yScaleRef.current.yLo + ((BASE - uy) / MAINH) * yScaleRef.current.ySpan,
    onTap: (tap) => onTapRef.current(tap),
  });
  const { view, setView } = ix;
  const vlo = view.min;
  const vhi = view.max;
  const vspan = vhi - vlo || 1;

  // The view resets when the data or the x unit changes (viewKey, or the
  // domain and label when no key is given) — never on a refinement. It
  // defaults to the active fit range, so switching units lands on the region
  // being fitted, or to the full range when no window is set.
  const resetKey = viewKey !== undefined ? viewKey : `${xLabel}|${xs.length}|${fullMin}|${fullMax}`;
  useEffect(() => {
    ix.setYLock(null);
    if (fitRange && (fitRange.min > fullMin + 1e-9 || fitRange.max < fullMax - 1e-9)) {
      const pad = (fitRange.max - fitRange.min) * 0.08;
      setView({ min: Math.max(fullMin, fitRange.min - pad), max: Math.min(fullMax, fitRange.max + pad) });
    } else {
      setView(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the data / unit
  }, [resetKey]);

  // Explicit "focus the fit range" command from the toolbar: zoom onto the
  // active fit window (small pad), same framing the unit-switch default uses.
  useEffect(() => {
    if (focusFitToken === 0) return;
    if (fitRange && (fitRange.min > fullMin + 1e-9 || fitRange.max < fullMax - 1e-9)) {
      const pad = (fitRange.max - fitRange.min) * 0.08;
      setView({ min: Math.max(fullMin, fitRange.min - pad), max: Math.min(fullMax, fitRange.max + pad) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on the command token only
  }, [focusFitToken]);

  // Fit window (defaults to full domain) clips the calc/diff curves.
  const fitLo = fitRange ? fitRange.min : fullMin;
  const fitHi = fitRange ? fitRange.max : fullMax;
  const fitActive = fitRange !== undefined && (fitLo > fullMin + 1e-9 || fitHi < fullMax - 1e-9);

  // y auto-scale to the *observed* data in view only. Basing it on the calc too
  // would make the axis (and every marker) rescale on every refinement cycle;
  // observed peaks dominate the height anyway, so this keeps the frame stable.
  // Signed mode (G(r)): the floor follows the data's minimum instead of 0.
  // A y lock (a tall box zoom, or Lock y) holds the range instead.
  const auto = useMemo(() => yRangeOver(vlo, vhi),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- of the data and the window
    [xs, yObs, obsSigma, signedY, vlo, vhi]);
  const yTop = ix.yLock ? ix.yLock.hi : auto.yTop;
  const yLo = ix.yLock ? ix.yLock.lo : auto.yLo;
  const ySpan = yTop - yLo || 1;
  yScaleRef.current = { yLo, ySpan };
  const sy = (y: number): number => BASE - ((Math.min(Math.max(y, yLo), yTop) - yLo) / ySpan) * MAINH;

  // Y nice ticks: four, fewer on a short panel (a phone on its side). The
  // signed scale starts at the first step at/above yLo.
  const yStep = niceNum((yTop - yLo) / yTickCount(MAINH), true);
  const yTicks: number[] = [];
  for (let v = Math.ceil(yLo / yStep) * yStep; v <= yTop + 1e-6 * yStep; v += yStep) yTicks.push(v);
  // The left margin fits the widest y label beside the rotated axis title
  // (which occupies x ≈ 16 ± 0.75 em), so neither collides as the type grows.
  const yLabelChars = Math.max(...yTicks.map((v) => formatY(v, yStep).length), fullYChars, 1);
  const X0 = Math.max(X0_MIN, Math.ceil(16 + 0.25 * fsLabel + 13 + yLabelChars * MONO_ADVANCE * fsTick));
  const X1 = boxW - RIGHT_PAD;
  const XW = X1 - X0;
  useLayoutEffect(() => {
    if (frame.x0 !== X0 || frame.x1 !== X1) setFrame({ x0: X0, x1: X1 });
  }, [X0, X1, frame.x0, frame.x1]);
  const sx = (x: number): number => X0 + ((x - vlo) / vspan) * XW;
  // X nice ticks: as many as the width holds without labels crowding (six on a
  // desktop plot, fewer on a phone).
  const xLabelW = Math.max(formatX(vlo, vspan).length, formatX(vhi, vspan).length) * MONO_ADVANCE * fsTick;
  const xStep = niceNum(vspan / tickCountFor(XW, xLabelW * 1.8, 2, 6), true);
  const xTicks: number[] = [];
  for (let v = Math.ceil(vlo / xStep) * xStep; v <= vhi + 1e-6; v += xStep) xTicks.push(v);

  // Difference band scaled to its own max in view (with headroom) so a poor fit
  // fills the band instead of clipping flat against its edge; a floor keeps a
  // near-perfect fit from blowing up noise. It rescales as the fit converges,
  // which reads as the residual shrinking — the intended Rietveld behaviour.
  const dm = useMemo(() => {
    let dPeak = 0;
    const [i0, i1] = visibleIndexRange(xs, vlo, vhi);
    for (let i = i0; i < i1; i++) {
      if (xs[i]! >= vlo && xs[i]! <= vhi) dPeak = Math.max(dPeak, Math.abs(curves.diff[i] ?? 0));
    }
    return Math.max(dPeak * 1.1, yTop * 0.02, 1e-9);
  }, [xs, curves.diff, vlo, vhi, yTop]);
  const sdiff = (d: number): number => DIFF_Y - (Math.min(Math.max(d, -dm), dm) / dm) * DIFF_A;

  // Row geometry: at up to three phase rows the fixed spacing applies; more
  // rows (e.g. two nuclear phases + the magnetic-analysis rows) compress the
  // spacing and tick height so the band stays above the difference band.
  const nRows = phases?.length ?? 0;
  const tickStep = nRows > 3 ? Math.min(TICK_ROW, Math.floor((TICK_MAX_BOT - TICK_TOP - TICK_H) / (nRows - 1))) : TICK_ROW;
  const tickH = tickStep < TICK_ROW ? Math.max(5, tickStep - 2) : TICK_H;

  // --- the data layer (canvas) ---------------------------------------------
  // Painted in a layout effect, so it lands in the same frame as the SVG.
  // Same marks as the former SVG series: obs dots (every 2nd point, r 1.3,
  // 50 %), the ±σ ribbon, overlays, the dashed background, the calc line, the
  // difference line on its dashed zero. Clipped to the data area, so a zoomed
  // line no longer runs under the y-axis labels.
  const showBkg = showBackground && !!curves.yBackground;
  useLayoutEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const scale = (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) * cssZoom();
    const W = Math.max(1, Math.round(boxW * scale));
    const H = Math.max(1, Math.round(VB_H * scale));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = cv.getContext("2d"); } catch { ctx = null; }
    if (!ctx) return;
    ctx.setTransform(W / boxW, 0, 0, H / VB_H, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.fillStyle = color.raised;
    ctx.fillRect(0, 0, boxW, VB_H);
    const mx = (x: number): number => X0 + ((x - vlo) / vspan) * XW;
    const [v0, v1] = visibleIndexRange(xs, vlo, vhi);
    // One point past each edge so a line reaches the frame; the clip trims it.
    const e0 = Math.max(0, v0 - 1);
    const e1 = Math.min(xs.length, v1 + 1);
    const nVisible = v1 - v0;

    ctx.save();
    ctx.beginPath();
    ctx.rect(X0, 0, XW, VB_H);
    ctx.clip();

    // zero line for a signed ordinate (G(r) oscillates about 0)
    if (signedY && yLo < 0) {
      ctx.strokeStyle = "#c9c0b0";
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(X0, sy(0));
      ctx.lineTo(X1, sy(0));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ±σ ribbon (upper edge left→right, lower edge back), under the markers.
    if (obsSigma && obsSigma.length === xs.length) {
      const idx: number[] = [];
      for (let i = v0; i < v1; i++) idx.push(i);
      if (idx.length >= 2) {
        ctx.fillStyle = color.obs;
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        idx.forEach((i, k) => (k === 0 ? ctx!.moveTo(mx(xs[i]!), sy(yObs[i]! + (obsSigma[i] ?? 0))) : ctx!.lineTo(mx(xs[i]!), sy(yObs[i]! + (obsSigma[i] ?? 0)))));
        for (let k = idx.length - 1; k >= 0; k--) ctx.lineTo(mx(xs[idx[k]!]!), sy(yObs[idx[k]!]! - (obsSigma[idx[k]!] ?? 0)));
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Observed markers: every 2nd point (by index, so a pan keeps the same
    // dots). Past ~6 dots per pixel the dots are a solid smear; draw each
    // pixel column's min–max as one dot-wide bar instead (same ink, a fraction
    // of the cost).
    ctx.fillStyle = color.obs;
    ctx.globalAlpha = 0.5;
    if (nVisible / 2 <= 6 * XW) {
      for (let i = v0 + (v0 % 2); i < v1; i += 2) {
        ctx.beginPath();
        ctx.arc(mx(xs[i]!), sy(yObs[i]!), 1.3, 0, 2 * Math.PI);
        ctx.fill();
      }
    } else {
      let col = NaN;
      let a = 0;
      let b = 0;
      const bar = (): void => {
        if (Number.isNaN(col)) return;
        ctx!.fillRect(col + 0.5 - 1.3, a - 1.3, 2.6, b - a + 2.6);
      };
      for (let i = v0; i < v1; i++) {
        const c = Math.floor(mx(xs[i]!));
        const y = sy(yObs[i]!);
        if (c !== col) { bar(); col = c; a = b = y; } else { if (y < a) a = y; if (y > b) b = y; }
      }
      bar();
    }
    ctx.globalAlpha = 1;

    const line = (ys: readonly number[], map: (y: number) => number): void => {
      const lo = fitLo;
      const hi = fitHi;
      const dense = nVisible > 3 * XW;
      ctx!.beginPath();
      let first = true;
      const put = (i: number): void => {
        const X = mx(xs[i]!);
        const Y = map(ys[i]!);
        if (first) { ctx!.moveTo(X, Y); first = false; } else ctx!.lineTo(X, Y);
      };
      if (dense) {
        for (const i of decimateByColumn(xs, ys, e0, e1, lo, hi, mx, map)) put(i);
      } else {
        for (let i = e0; i < e1; i++) {
          const x = xs[i]!;
          if (x < lo || x > hi) continue;
          put(i);
        }
      }
      ctx!.stroke();
    };

    // decomposition overlays (e.g. partial PDFs), under the calc line
    (overlays ?? []).forEach((o, i) => {
      ctx!.strokeStyle = OVERLAY_COLORS[i % OVERLAY_COLORS.length]!;
      ctx!.lineWidth = 1;
      ctx!.globalAlpha = 0.85;
      line(o.y, sy);
    });
    ctx.globalAlpha = 1;
    if (showBkg) {
      ctx.strokeStyle = color.bkg;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([5, 3]);
      line(curves.yBackground!, sy);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color.calc;
    ctx.lineWidth = 1.4;
    line(curves.yCalc, sy);

    // difference band: dashed zero line, then the difference
    ctx.strokeStyle = "#e0d8c9";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(X0, DIFF_Y);
    ctx.lineTo(X1, DIFF_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = color.diff;
    ctx.lineWidth = 1;
    line(curves.diff, sdiff);

    // Bragg reflection ticks, one coloured row per phase, each tick its own
    // 70 % stroke (so a dense cluster darkens as the SVG ticks did). A click
    // is hit-tested (`tickAt`); the ticks at the cursor and the picked one are
    // drawn bold in the SVG on top.
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    (phases ?? []).forEach((phase, row) => {
      const y1 = TICK_TOP + row * tickStep;
      ctx!.strokeStyle = phase.color;
      for (const t of phase.ticks) {
        if (t.x < vlo || t.x > vhi) continue;
        const X = mx(t.x);
        ctx!.beginPath();
        ctx!.moveTo(X, y1);
        ctx!.lineTo(X, y1 + tickH);
        ctx!.stroke();
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the scales are derived from these
  }, [xs, yObs, curves.yCalc, curves.diff, curves.yBackground, showBkg, overlays, obsSigma, vlo, vhi, yLo, yTop, dm, boxW, VB_H, X0, X1, BASE, MAINH, DIFF_Y, DIFF_A, fitLo, fitHi, signedY, phases, TICK_TOP, tickStep, tickH]);

  // The single selected reflection (from a scatter-point OR a Bragg-tick click):
  // locate its Bragg tick so we can spotlight that peak. Prefer the row whose
  // *phase id* matches (so the right phase lights up when two phases share an
  // hkl); then the row whose *kind* matches (a k = 0 magnetic satellite sharing
  // an hkl with a nuclear peak lights the magnetic row); then any hkl match. Both
  // the tick emphasis and the arrow read from this, so a tick click and a scatter
  // click resolve to exactly the same peak.
  const highlight = useMemo(() => {
    if (!highlightSel || !phases) return null;
    // One pass, ranking each row instead of building three filtered copies:
    // 0 = the phase id matches, 1 = the kind matches, 2 = anything else. The
    // best rank wins, and among equal ranks the earlier row does — the same
    // peak the three-pass form resolved to.
    const sel = highlightSel;
    let best: { x: number; hkl: string; d: number; color: string; row: number; label: string } | null = null;
    let bestRank = 3;
    for (let row = 0; row < phases.length; row++) {
      const p = phases[row]!;
      const rank = sel.phaseId !== undefined && p.id === sel.phaseId ? 0 : p.kind === sel.kind ? 1 : 2;
      if (rank >= bestRank) continue;
      const t = p.ticks.find((tk) => tk.hkl === sel.hkl);
      if (t) {
        best = { x: t.x, hkl: t.hkl, d: t.d, color: p.color, row, label: p.label };
        bestRank = rank;
      }
    }
    return best;
  }, [highlightSel, phases]);


  /** The tick a press at (userX, userY) lands on: the nearest within the tolerance on that row. */
  const tickAt = (userX: number, userY: number): { hkl: string; kind: "nuclear" | "magnetic"; phaseId: string; picked: boolean } | null => {
    if (!phases || phases.length === 0) return null;
    const top = TICK_TOP - 4;
    const bottom = TICK_TOP + (phases.length - 1) * tickStep + tickH + 4;
    if (userY < top || userY > bottom) return null;
    const row = Math.min(phases.length - 1, Math.max(0, Math.round((userY - TICK_TOP - tickH / 2) / tickStep)));
    const phase = phases[row]!;
    const x = vlo + ((userX - X0) / XW) * vspan;
    const tol = (TICK_TOL_PX / XW) * vspan;
    let best: (typeof phase.ticks)[number] | null = null;
    for (const t of phase.ticks) {
      if (Math.abs(t.x - x) <= tol && (!best || Math.abs(t.x - x) < Math.abs(best.x - x))) best = t;
    }
    if (!best) return null;
    const picked = !!highlight && highlight.row === row && highlight.hkl === best.hkl;
    return { hkl: best.hkl, kind: phase.kind, phaseId: phase.id, picked };
  };

  // A click (press and release without a drag): a Bragg tick toggles the
  // spotlight; elsewhere in the data area it is the page's plot click (e.g.
  // the magnetic page's "add a residual peak here").
  onTapRef.current = (tap: PlotTap): void => {
    if (draggingGrip.current) return;
    const tick = tickAt(tap.userX, tap.userY);
    if (tick) {
      onHighlight?.(tick.picked ? null : { hkl: tick.hkl, kind: tick.kind, phaseId: tick.phaseId });
      return;
    }
    if (tap.x >= vlo && tap.x <= vhi) onPlotClick?.(tap.x);
  };

  // Pan to reveal a freshly-spotlighted peak when it sits outside the zoom
  // window — keyed on the pick only, so re-zooming/panning doesn't fight the user.
  useEffect(() => {
    if (!highlight) return;
    if (highlight.x >= vlo && highlight.x <= vhi) return;
    const span = vhi - vlo;
    let min = highlight.x - span / 2;
    let max = highlight.x + span / 2;
    if (min < fullMin) { min = fullMin; max = fullMin + span; }
    if (max > fullMax) { max = fullMax; min = fullMax - span; }
    setView({ min: Math.max(min, fullMin), max: Math.min(max, fullMax) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the pick only
  }, [highlightSel?.hkl, highlightSel?.kind, highlightSel?.phaseId]);

  // "Show in pattern" command: zoom in on the highlighted reflection, centred, at
  // a moderate zoom — a small fraction of the full domain to each side, so the
  // peak has context and isn't blown up to fill the frame. Keyed on the command
  // token only, so it fires exactly when requested (including on mount after the
  // view switches from Validation back to the pattern).
  useEffect(() => {
    if (focusPeakToken === 0 || !highlight) return;
    const hw = Math.max((fullMax - fullMin) * 0.06, 1e-9);
    setView({ min: highlight.x - hw, max: highlight.x + hw });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on the command token only
  }, [focusPeakToken]);

  // "Open this spot" command from the Validation view: the same moderate zoom
  // as a reflection, centred on an arbitrary x (an unindexed peak, or wherever
  // the residual strip was clicked).
  useEffect(() => {
    if (!focusPoint || !Number.isFinite(focusPoint.x)) return;
    const hw = Math.max((fullMax - fullMin) * 0.04, 1e-9);
    setView({ min: Math.max(fullMin, focusPoint.x - hw), max: Math.min(fullMax, focusPoint.x + hw) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on the command token only
  }, [focusPoint?.token]);

  // --- pointer helpers -------------------------------------------------------
  const clientToX = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return vlo;
    const px = ((clientX - rect.left) / rect.width) * boxW; // user-space px
    return vlo + ((px - X0) / XW) * vspan;
  };

  const startGrip = (which: "min" | "max") => (e: React.PointerEvent): void => {
    if (!onFitRangeChange || !fitRange) return;
    e.stopPropagation();
    e.preventDefault();
    draggingGrip.current = true;
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* the pointer is already gone */ }
    const move = (ev: PointerEvent): void => {
      const v = Math.min(fullMax, Math.max(fullMin, clientToX(ev.clientX)));
      if (which === "min") onFitRangeChange({ min: Math.min(v, fitRange.max), max: fitRange.max });
      else onFitRangeChange({ min: fitRange.min, max: Math.max(v, fitRange.min) });
    };
    // Ends on a lift, and on a cancel too (the browser took a touch over to
    // scroll): left set, the flag made the plot ignore every later tap.
    trackPointerDrag(window, e.pointerId, move, () => {
      draggingGrip.current = false;
    });
  };

  // --- the cursor readout ----------------------------------------------------
  // Reads the data at the point nearest the cursor: x in the axis unit to the
  // data step's precision, obs / calc / diff (calc and diff only inside the fit
  // window, as drawn), the overlays, and the reflection ticks within a few
  // pixels. Read-only: it changes nothing.
  const readout = useMemo(() => {
    const c = ix.cursor;
    if (!c || xs.length === 0) return null;
    const i = nearestIndex(xs, c.x);
    if (i < 0) return null;
    const x = xs[i]!;
    if (x < vlo || x > vhi) return null;
    const dec = decimalsForStep(localStep(xs, i));
    const inFit = x >= fitLo && x <= fitHi;
    const near = ticksNear(phases, c.source === "pointer" ? c.x : x, (TICK_TOL_PX / XW) * vspan, 4);
    return { i, x, dec, inFit, near };
  }, [ix.cursor, xs, vlo, vhi, vspan, XW, fitLo, fitHi, phases]);
  const axis = splitAxisLabel(xLabel);
  const readoutLines = useMemo(() => {
    if (!readout) return null;
    const { i, x, dec, inFit, near } = readout;
    const xText = `${axis.name} ${x.toFixed(dec)}${axis.unit ? ` ${axis.unit}` : ""}`;
    const sd = obsSigma?.[i];
    const ys: { label: string; value: string; color: string }[] = [
      { label: "obs", value: `${formatReadoutValue(yObs[i]!)}${sd !== undefined && obsSigma ? ` ± ${formatReadoutValue(sd)}` : ""}`, color: color.obs },
    ];
    if (inFit) {
      ys.push({ label: "calc", value: formatReadoutValue(curves.yCalc[i]!), color: color.calc });
      ys.push({ label: "diff", value: formatReadoutValue(curves.diff[i]!), color: color.diff });
      if (showBkg) ys.push({ label: "bkg", value: formatReadoutValue(curves.yBackground![i]!), color: color.bkg });
      (overlays ?? []).forEach((o, k) => ys.push({ label: o.label, value: formatReadoutValue(o.y[i]!), color: OVERLAY_COLORS[k % OVERLAY_COLORS.length]! }));
    }
    const ticks = near.map((t) => ({ text: `${t.phaseLabel} (${formatHkl(t.hkl)}) d ${t.d.toFixed(4)} Å`, color: t.color }));
    const speech = [xText, ...ys.map((y) => `${y.label} ${y.value}`), inFit ? "" : "outside the fit window", ...ticks.map((t) => t.text)].filter(Boolean).join(", ");
    return { xText, ys, ticks, inFit, speech };
  }, [readout, axis.name, axis.unit, yObs, obsSigma, curves.yCalc, curves.diff, curves.yBackground, showBkg, overlays]);
  const spoken = useThrottledText(readoutLines?.speech ?? "", 600);

  // Legend layout (see the render): measured from the label widths, wrapping
  // onto extra rows on a narrow plot. The found-peak markers sit below it.
  const hasSigma = !!obsSigma && obsSigma.length === xs.length;
  const legend = layoutLegend(
    [
      { color: color.obs, label: "obs", shape: "dot" },
      ...(hasSigma ? [{ color: color.obs, label: obsSigmaLabel, shape: "band" as const }] : []),
      { color: color.calc, label: "calc", shape: "line" },
      { color: color.diff, label: "diff", shape: "line" },
      { color: color.bkg, label: "bkg", shape: "dashline" },
      // The ▽ "found" key leads the dynamic entries when found peaks exist.
      ...(foundPeaks && foundPeaks.length > 0 ? [{ color: foundStyle?.color ?? color.obs, label: foundStyle?.label ?? "found", shape: "triangle" as const }] : []),
      ...(overlays ?? []).map((o, i) => ({ color: OVERLAY_COLORS[i % OVERLAY_COLORS.length]!, label: o.label, shape: "dash" as const })),
      // Overlays replace the generic "hkl" key only; explicit Bragg rows (the
      // magnetic page draws its candidate over the pattern AND needs its tick
      // rows named) stay in the legend. No Bragg rows on a signed-y (PDF) plot —
      // the generic "hkl" key only applies where reflection ticks can render.
      ...(phases && phases.length > 0
        ? phases.map((p) => ({ color: p.color, label: p.label, shape: "tick" as const }))
        : signedY || (overlays && overlays.length > 0)
          ? []
          : [{ color: color.hkl, label: "hkl", shape: "tick" as const }]),
    ],
    X0 + 6,
    X1,
    fsLabel,
    ts,
  );
  const foundTop = FOUND_TOP + (legend.length ? legend[legend.length - 1]!.row : 0) * LEGEND_ROW * ts;

  const minPx = sx(Math.min(fullMax, Math.max(fullMin, fitLo)));
  const maxPx = sx(Math.min(fullMax, Math.max(fullMin, fitHi)));
  const cursorPx = readout ? sx(readout.x) : null;
  const plotName = ariaLabel ?? `${yLabel} against ${xLabel}`;
  const zoomInline = zoomControlsInline(coarse, boxW);

  return (
    <>
    <div className="wb-plot-box" style={{ position: "relative", width: "100%", flex: 1, minHeight: 320 }}>
      <canvas ref={canvasRef} aria-hidden style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", pointerEvents: "none" }} />
      <svg
        ref={svgRef}
        className="wb-plot"
        viewBox={`0 0 ${boxW} ${VB_H}`}
        preserveAspectRatio="none"
        tabIndex={0}
        role="application"
        aria-roledescription="interactive plot"
        aria-label={`${plotName}. Drag to pan, Shift + drag to box-zoom, Ctrl + scroll or pinch to zoom, double-click to reset. Keys: plus and minus zoom, left and right arrows pan, Shift + arrows step the cursor one point, 0 resets.`}
        {...ix.handlers}
        {...{
          // The frame and the window, for the headless interaction checks.
          "data-vmin": vlo, "data-vmax": vhi, "data-dmin": fullMin, "data-dmax": fullMax, "data-ylock": ix.yLock ? 1 : 0,
          "data-frame": [X0, X1, boxW, VB_H, TOP, BASE, DIFF_Y, DIFF_A, TICK_TOP, tickStep, tickH].join(","),
        }}
        style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", touchAction: "pan-y", cursor: ix.panning ? "grabbing" : "crosshair", userSelect: "none", WebkitUserSelect: "none" }}
      >
        {/* axes */}
        <line x1={X0} y1={TOP} x2={X0} y2={BASE} stroke="#c9c0b0" />
        <line x1={X0} y1={BASE} x2={X1} y2={BASE} stroke="#c9c0b0" />

        {/* y ticks */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={X0 - 4} y1={sy(v)} x2={X0} y2={sy(v)} stroke="#c9c0b0" />
            <text x={X0 - 7} y={sy(v) + 0.32 * fsTick} textAnchor="end" fontSize={fsTick} fontFamily={mono} fill={color.faint}>
              {formatY(v, yStep)}
            </text>
          </g>
        ))}
        <text x={16} y={(TOP + BASE) / 2} fontSize={fsTick} fontFamily={mono} fill={color.faint} textAnchor="middle" transform={`rotate(-90 16 ${(TOP + BASE) / 2})`}>
          {yLabel}
        </text>

        {/* x ticks */}
        {xTicks.map((v) => {
          // A label centred on the last tick would run past the plot's right
          // edge (the fit range often ends on a round number): pin it inside.
          const label = formatX(v, vspan);
          const half = (label.length * MONO_ADVANCE * fsTick) / 2;
          const atEdge = sx(v) + half > boxW - 2;
          return (
            <g key={v}>
              <line x1={sx(v)} y1={BASE} x2={sx(v)} y2={BASE + 4} stroke="#c9c0b0" />
              <text x={atEdge ? boxW - 2 : sx(v)} y={X_LABEL_Y} textAnchor={atEdge ? "end" : "middle"} fontSize={fsTick} fontFamily={mono} fill={color.faint}>
                {label}
              </text>
            </g>
          );
        })}
        <text x={(X0 + X1) / 2} y={AXIS_TITLE_Y} textAnchor="middle" fontSize={fsLabel} fontFamily={mono} fill={color.faint}>
          {xLabel}
        </text>

        {/* The series (obs, ±σ, overlays, bkg, calc, diff) are on the canvas below. */}
        <text x={16} y={DIFF_Y} fontSize={fsTick} fontFamily={mono} fill={color.faint} textAnchor="middle" transform={`rotate(-90 16 ${DIFF_Y})`}>
          Difference
        </text>

        {/* Bragg reflection ticks: the rows are on the canvas; the ticks at
            the cursor and the picked one are drawn bold here. */}
        {readout?.near.map((t) => {
          if (highlight && highlight.row === t.row && highlight.hkl === t.hkl) return null;
          const y1 = TICK_TOP + t.row * tickStep;
          return <line key={`n${t.row}|${t.hkl}`} x1={sx(t.x)} y1={y1} x2={sx(t.x)} y2={y1 + tickH} stroke={t.color} strokeWidth={2} pointerEvents="none" />;
        })}
        {highlight && highlight.x >= vlo && highlight.x <= vhi && (() => {
          const y1 = TICK_TOP + highlight.row * tickStep;
          return <line x1={sx(highlight.x)} y1={y1 - 3} x2={sx(highlight.x)} y2={y1 + tickH + 3} stroke={highlight.color} strokeWidth={2.6} pointerEvents="none" />;
        })()}

        {/* Found-peak markers: downward ▽ triangles above the pattern at each
            detected (unexplained-residual) peak — a distinct mark from the
            Bragg tick rows below, so they don't read as another indexed phase.
            The Agent's unexplained peaks use `foundStyle` (colour + guides). */}
        {foundPeaks && foundPeaks.length > 0 && (
          <g>
            {foundPeaks.map((p, i) => {
              if (p.x < vlo || p.x > vhi) return null;
              const px = sx(p.x);
              const ink = foundStyle?.color ?? color.obs;
              return (
                <g key={i}>
                  {foundStyle?.guides && (
                    <line x1={px} y1={foundTop + FOUND_H} x2={px} y2={BASE} stroke={ink} strokeWidth={1.2} strokeDasharray={p.near ? "1 4" : "4 3"} opacity={p.near ? 0.5 : 0.75} pointerEvents="none" />
                  )}
                  <path
                    d={`M ${(px - FOUND_W).toFixed(1)} ${foundTop} L ${(px + FOUND_W).toFixed(1)} ${foundTop} L ${px.toFixed(1)} ${foundTop + FOUND_H} Z`}
                    fill={p.near ? color.raised : ink}
                    stroke={p.near ? ink : color.raised}
                    strokeWidth={p.near ? 1.3 : 0.8}
                  />
                  <rect x={px - 6} y={foundTop - 2} width={12} height={FOUND_H + 6} fill="transparent">
                    <title>{p.near ? `residual peak on ${p.near} (a misfit of that reflection) · d ${p.d.toFixed(3)} Å` : `${foundStyle?.label ?? "found"} peak · d ${p.d.toFixed(3)} Å`}</title>
                  </rect>
                </g>
              );
            })}
          </g>
        )}

        {/* Spotlight for a reflection picked in the F_obs/F_calc plot: an arrow
            at the top, a dashed guide through the intensity region, and a bold
            tick on the matching Bragg row — linking the scatter point to its
            peak. (Off-screen picks are panned into view by the effect above.) */}
        {highlight && highlight.x >= vlo && highlight.x <= vhi && (() => {
          const hx = sx(highlight.x);
          const tickY2 = TICK_TOP + highlight.row * tickStep + tickH + 3;
          const right = hx > (X0 + X1) / 2;
          return (
            <g pointerEvents="none">
              {/* ink (not primary — that equals the calc/hkl blue) so the guide
                  reads over the blue calc curve; matches the scatter's pick ring. */}
              <line x1={hx} y1={TOP + 12} x2={hx} y2={tickY2} stroke={color.ink} strokeWidth={1.1} strokeDasharray="3 3" opacity={0.55} />
              <path d={`M ${hx - 5} ${TOP} L ${hx + 5} ${TOP} L ${hx} ${TOP + 11} Z`} fill={color.ink} />
              <line x1={hx} y1={TICK_TOP + highlight.row * tickStep - 3} x2={hx} y2={tickY2} stroke={highlight.color} strokeWidth={2.6} />
              <text
                x={right ? hx - 8 : hx + 8}
                y={TOP + 26}
                textAnchor={right ? "end" : "start"}
                fontSize={fsLabel}
                fontFamily={mono}
                fontWeight={600}
                fill={color.ink}
                stroke={color.raised}
                strokeWidth={3}
                paintOrder="stroke"
              >
                {formatHkl(highlight.hkl)}
              </text>
            </g>
          );
        })()}

        {/* excluded-region scrims (dim data outside the fit range) */}
        {fitActive && (
          <>
            {minPx > X0 && (
              <>
                <rect x={X0} y={TOP} width={minPx - X0} height={BASE - TOP} fill={color.primary} opacity={0.06} />
                <rect x={X0} y={TOP} width={minPx - X0} height={CAP_Y - TOP} fill={color.raised} opacity={0.6} />
              </>
            )}
            {maxPx < X1 && (
              <>
                <rect x={maxPx} y={TOP} width={X1 - maxPx} height={BASE - TOP} fill={color.primary} opacity={0.06} />
                <rect x={maxPx} y={TOP} width={X1 - maxPx} height={CAP_Y - TOP} fill={color.raised} opacity={0.6} />
              </>
            )}
          </>
        )}

        {/* the cursor: a vertical line at the data point under the pointer,
            through the pattern, the tick rows and the difference band */}
        {cursorPx !== null && (
          <line x1={cursorPx} y1={TOP} x2={cursorPx} y2={DIFF_Y + DIFF_A} stroke={color.ink} strokeWidth={1} opacity={0.45} pointerEvents="none" />
        )}

        {/* fit-range handles */}
        {onFitRangeChange && fitRange && (
          <>
            {(["min", "max"] as const).map((which) => {
              const px = which === "min" ? minPx : maxPx;
              // touch-action none: a finger on a handle drags it rather than
              // scrolling the page (the plot itself lets vertical drags scroll).
              const grip = { cursor: "ew-resize", touchAction: "none" } as const;
              return (
                <g key={which} data-fit-handle={which}>
                  <line x1={px} y1={TOP} x2={px} y2={CAP_Y} stroke={color.primary} strokeWidth={1.5} />
                  <rect x={px - gripW / 2} y={TOP} width={gripW} height={CAP_Y - TOP} fill="transparent" style={grip} onPointerDown={startGrip(which)} />
                  {coarse && <rect x={px - gripW / 2} y={CAP_Y - 4} width={gripW} height={22} fill="transparent" style={grip} onPointerDown={startGrip(which)} />}
                  <rect x={px - 4.5} y={CAP_Y} width={9} height={14} rx={3} fill={color.primary} style={grip} onPointerDown={startGrip(which)} />
                </g>
              );
            })}
          </>
        )}

        {/* box-zoom selection (Shift + drag): a flat box is an x band */}
        {ix.box && (
          <rect
            x={Math.min(ix.box.x0, ix.box.x1)}
            y={ix.box.xOnly ? TOP : Math.min(ix.box.y0, ix.box.y1)}
            width={Math.abs(ix.box.x1 - ix.box.x0)}
            height={ix.box.xOnly ? BASE - TOP : Math.abs(ix.box.y1 - ix.box.y0)}
            fill={color.primary}
            opacity={0.14}
            stroke={color.primary}
            strokeWidth={1}
          />
        )}

        {/* legend: the series, then one vertical-tick entry per phase row (the
            phase legend) — or a generic "hkl" entry when no rows are supplied.
            Entries are laid out from their own label widths (so the swatch of
            one never butts against the label of the last) and wrap onto a new
            row when a narrow plot runs out of width. */}
        <g fontSize={fsLabel} fill={color.secondary} fontFamily={mono}>
          {legend.map((e, i) => (
            <g key={i}>
              {e.shape === "dot" ? (
                <circle cx={e.x + 2} cy={e.cy} r={2} fill={e.color} />
              ) : e.shape === "triangle" ? (
                <path d={`M ${e.x} ${e.cy - 4} L ${e.x + 8} ${e.cy - 4} L ${e.x + 4} ${e.cy + 4} Z`} fill={e.color} />
              ) : e.shape === "band" ? (
                <rect x={e.x} y={e.cy - 4} width={e.swatch} height={8} fill={e.color} fillOpacity={0.25} />
              ) : e.shape === "tick" ? (
                <line x1={e.x + 1} y1={e.cy - 5} x2={e.x + 1} y2={e.cy + 5} stroke={e.color} strokeWidth={2} />
              ) : (
                <line x1={e.x} y1={e.cy} x2={e.x + e.swatch} y2={e.cy} stroke={e.color} strokeWidth={1.6} {...(e.shape === "dashline" ? { strokeDasharray: "5 3" } : {})} />
              )}
              {/* A halo in the plot's background keeps a label legible where a
                  fit handle or a tall peak runs through the legend row. */}
              <text x={e.x + e.swatch + 5} y={e.cy + 0.3 * fsLabel} stroke={color.raised} strokeWidth={3} paintOrder="stroke">{e.label}</text>
            </g>
          ))}
        </g>
      </svg>
      {/* corner overlays (HTML on top of the SVG). wR lives in the
          Refinement-quality rail, judged against R_exp. */}
      {highlight && (
        <div style={tickPickOverlay} onClick={() => onHighlight?.(null)} title="Click to dismiss (or click the tick again)">
          <span style={{ width: 9, height: 9, borderRadius: 2, background: highlight.color, display: "inline-block" }} />
          <span style={{ fontFamily: mono, fontSize: 12, color: color.ink }}>
            ({formatHkl(highlight.hkl)}) · d {highlight.d.toFixed(4)} Å
          </span>
          <span style={{ fontSize: 11, color: color.secondary }}>{highlight.label}</span>
        </div>
      )}
      {readoutLines && cursorPx !== null && !ix.panning && (
        <div
          className="wb-plot-readout"
          data-x={readout!.x}
          data-index={readout!.i}
          data-step={localStep(xs, readout!.i)}
          aria-hidden
          style={{
            ...plotReadoutBox,
            left: `${(cursorPx / boxW) * 100}%`,
            top: `${((foundTop + FOUND_H + 6) / VB_H) * 100}%`,
            transform: cursorPx > (X0 + X1) / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
          }}
        >
          <div style={{ color: color.ink, fontWeight: 600 }}>{readoutLines.xText}</div>
          {readoutLines.ys.map((y) => (
            <div key={y.label} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              <span style={{ color: y.color }}>{y.label}</span>
              <span style={{ color: color.ink }}>{y.value}</span>
            </div>
          ))}
          {!readoutLines.inFit && <div style={{ color: color.faint }}>outside the fit window</div>}
          {readoutLines.ticks.map((t) => (
            <div key={t.text} style={{ color: color.ink, display: "flex", gap: 5, alignItems: "center" }}>
              <span style={{ width: 2, height: 10, background: t.color, display: "inline-block" }} />
              {t.text}
            </div>
          ))}
        </div>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="wb-sr-only">{spoken}</div>
      <PlotHint text={ix.hint} />
      {!zoomInline && <PlotZoomControls ix={ix} yRange={{ lo: yLo, hi: yTop }} />}
    </div>
    {zoomInline && <PlotZoomControls ix={ix} yRange={{ lo: yLo, hi: yTop }} inline />}
    </>
  );
}

type LegendShape = "dot" | "line" | "dashline" | "tick" | "triangle" | "dash" | "band";

/**
 * Place legend entries left to right from their label widths (monospace, so
 * the width is exact), starting a new row whenever the next entry would cross
 * `right` — a phone-width plot wraps instead of running off the edge.
 */
function layoutLegend(
  entries: readonly { readonly color: string; readonly label: string; readonly shape: LegendShape }[],
  left: number,
  right: number,
  fontSize: number,
  typeScale: number,
): { color: string; label: string; shape: LegendShape; x: number; cy: number; row: number; swatch: number }[] {
  const swatchW = (shape: LegendShape): number =>
    shape === "line" || shape === "dashline" || shape === "dash" ? 16 : shape === "band" ? 12 : shape === "dot" ? 4 : shape === "triangle" ? 8 : 2;
  let x = left;
  let row = 0;
  return entries.map((e, i) => {
    const swatch = swatchW(e.shape);
    const w = swatch + 5 + e.label.length * MONO_ADVANCE * fontSize;
    if (i > 0 && x + w > right) {
      x = left;
      row += 1;
    }
    const placed = { ...e, x, cy: LEGEND_Y + row * LEGEND_ROW * typeScale, row, swatch };
    x += w + 14;
    return placed;
  });
}

const tickPickOverlay: CSSProperties = { position: "absolute", top: 6, right: 8, display: "flex", alignItems: "center", gap: 7, background: "rgba(255,253,249,0.92)", border: `1px solid ${color.border}`, borderRadius: 8, padding: "3px 9px", cursor: "pointer" };
