/**
 * The PDF page's S(Q) view: the reduced reciprocal-space data a G(r) was
 * transformed from, with its ±σ error RIBBON, the transform's Q window, and
 * what that error becomes in real space over the current fit window — σ_G,
 * how correlated neighboring r points are, and how many independent points
 * the window really holds (core/totalscattering/grErrors).
 *
 * S(Q) and F(Q) = Q·[S(Q) − 1] are both offered because the error reads
 * differently in each: σ_S is often near-constant and thin against S(Q)'s
 * swing, while σ_F = Q·σ_S grows with Q — the high-Q noise that dominates
 * σ_G(r) is plain in F(Q).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePlotInteraction, useThrottledText } from "@/app/ui/usePlotInteraction";
import { PlotHint, PlotZoomControls, plotReadoutBox } from "@/app/ui/PlotControls";
import { decimalsForStep, formatReadoutValue, localStep, minimumSpan, nearestIndex } from "@/visualization/plotView";
import type { PdfPattern } from "@/core/diffraction/types";
import { grUncertaintySummary } from "@/core/totalscattering/grErrors";
import { SegmentedToggle } from "@/app/ui/SegmentedToggle";
import { color, fz, mono } from "@/app/theme";

type Ordinate = "sq" | "fq";

const PAD = { left: 58, right: 14, top: 30, bottom: 40 };
const EMPTY: readonly number[] = [];

function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 640, height: 360 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box && box.width > 0 && box.height > 0) setSize({ width: Math.max(240, box.width), height: Math.max(200, box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * 10 ** exp;
}

function ticks(lo: number, hi: number, target: number): number[] {
  const step = niceStep(hi - lo || 1, target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * step; v += step) out.push(Math.abs(v) < 1e-12 * step ? 0 : v);
  return out;
}

const fmtTick = (v: number, step: number): string => (step >= 1 ? String(Math.round(v)) : v.toFixed(Math.min(3, Math.max(1, -Math.floor(Math.log10(step))))));
const sci = (v: number): string => (v === 0 ? "0" : Math.abs(v) >= 0.01 && Math.abs(v) < 100 ? v.toPrecision(3) : v.toExponential(2));

export function ReciprocalPanel({ pattern, fitRange }: { pattern: PdfPattern; fitRange: { min: number; max: number } }): JSX.Element {
  const rec = pattern.reciprocal;
  const [ordinate, setOrdinate] = useState<Ordinate>(rec?.kind ?? "sq");
  const [showSigma, setShowSigma] = useState(true);
  const [boxRef, { width: W, height: H }] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const qs = rec?.q ?? EMPTY;
  const domain = useMemo(() => ({ min: qs[0] ?? 0, max: qs.length > 1 ? qs[qs.length - 1]! : (qs[0] ?? 0) + 1 }), [qs]);
  const minSpan = useMemo(() => minimumSpan(qs), [qs]);
  const yScale = useRef({ yLo: 0, yHi: 1 });
  // The same zoom / pan / keyboard / readout mechanics as the G(r) plot.
  const ix = usePlotInteraction({
    svgRef,
    domain,
    minSpan,
    xs: qs,
    geometry: { boxW: W, x0: PAD.left, x1: W - PAD.right, yTop: PAD.top, yBottom: H - PAD.bottom },
    yAt: (uy) => yScale.current.yLo + ((H - PAD.bottom - uy) / (H - PAD.bottom - PAD.top || 1)) * (yScale.current.yHi - yScale.current.yLo),
  });
  // A new file starts on its own ordinate at full range — a zoom window from
  // the previous file could lie entirely outside this one's Q range.
  useEffect(() => {
    setOrdinate(rec?.kind ?? "sq");
    ix.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new file only
  }, [rec]);

  // Both ordinates from the retained data, whichever the file held:
  // F = Q(S − 1), σ_F = Q·σ_S (and back, S = 1 + F/Q at Q > 0).
  const series = useMemo(() => {
    if (!rec) return null;
    const q = rec.q;
    const s = rec.kind === "sq" ? rec.y : rec.y.map((f, i) => (q[i]! > 0 ? 1 + f / q[i]! : 1));
    const f = rec.kind === "fq" ? rec.y : rec.y.map((v, i) => q[i]! * (v - 1));
    const sigS = rec.sigma ? (rec.kind === "sq" ? rec.sigma : rec.sigma.map((v, i) => (q[i]! > 0 ? v / q[i]! : 0))) : null;
    const sigF = rec.sigma ? (rec.kind === "fq" ? rec.sigma : rec.sigma.map((v, i) => q[i]! * v)) : null;
    return { q, s, f, sigS, sigF };
  }, [rec]);

  // What the propagated error means over the CURRENT fit window. O(n²) in the
  // window's points (the participation ratio streams the covariance), so it is
  // computed here — only while this tab is open — not on the fit page.
  const summary = useMemo(() => grUncertaintySummary(pattern, fitRange), [pattern, fitRange]);
  const readoutText = useMemo(() => {
    const c = ix.cursor;
    if (!c || !series) return "";
    const i = nearestIndex(series.q, c.x);
    if (i < 0) return "";
    const y = ordinate === "sq" ? series.s : series.f;
    const sg = ordinate === "sq" ? series.sigS : series.sigF;
    return `Q ${series.q[i]!.toFixed(decimalsForStep(localStep(series.q, i)))} Å⁻¹, ${ordinate === "sq" ? "S(Q)" : "F(Q)"} ${formatReadoutValue(y[i]!)}${sg ? ` ± ${formatReadoutValue(sg[i]!)}` : ""}`;
  }, [ix.cursor, series, ordinate]);
  const spoken = useThrottledText(readoutText, 600);

  if (!rec || !series) {
    return <div style={{ flex: 1, display: "grid", placeItems: "center", color: color.secondary, fontSize: fz.small }}>This pattern was loaded as G(r) — there is no S(Q) to show.</div>;
  }

  const { q } = series;
  const y = ordinate === "sq" ? series.s : series.f;
  const sig = showSigma ? (ordinate === "sq" ? series.sigS : series.sigF) : null;
  const qLo = q[0]!;
  const qHi = q[q.length - 1]!;
  const vlo = ix.view.min;
  const vhi = ix.view.max;

  let yLo = Infinity;
  let yHi = -Infinity;
  for (let i = 0; i < q.length; i++) {
    if (q[i]! < vlo || q[i]! > vhi) continue;
    const e = sig?.[i] ?? 0;
    yLo = Math.min(yLo, y[i]! - e);
    yHi = Math.max(yHi, y[i]! + e);
  }
  if (!Number.isFinite(yLo)) { yLo = 0; yHi = 1; }
  const yPad = 0.06 * (yHi - yLo || 1);
  yLo -= yPad;
  yHi += yPad;
  if (ix.yLock) {
    yLo = ix.yLock.lo;
    yHi = ix.yLock.hi;
  }
  yScale.current = { yLo, yHi };

  const X0 = PAD.left;
  const X1 = W - PAD.right;
  const Y0 = PAD.top;
  const Y1 = H - PAD.bottom;
  const sx = (v: number): number => X0 + ((v - vlo) / (vhi - vlo || 1)) * (X1 - X0);
  const sy = (v: number): number => Y1 - ((v - yLo) / (yHi - yLo || 1)) * (Y1 - Y0);

  const line: string[] = [];
  const upper: string[] = [];
  const lower: string[] = [];
  for (let i = 0; i < q.length; i++) {
    if (q[i]! < vlo || q[i]! > vhi) continue;
    const x = sx(q[i]!).toFixed(1);
    line.push(`${x},${sy(y[i]!).toFixed(1)}`);
    if (sig) {
      upper.push(`${x},${sy(y[i]! + sig[i]!).toFixed(1)}`);
      lower.push(`${x},${sy(y[i]! - sig[i]!).toFixed(1)}`);
    }
  }
  const ribbon = upper.length > 1 ? `M ${upper.join(" L ")} L ${lower.reverse().join(" L ")} Z` : null;

  const xT = ticks(vlo, vhi, Math.max(3, Math.min(8, Math.floor((X1 - X0) / 80))));
  const xStep = xT.length > 1 ? xT[1]! - xT[0]! : 1;
  const yT = ticks(yLo, yHi, 5);
  const yStep = yT.length > 1 ? yT[1]! - yT[0]! : 1;
  const baseline = ordinate === "sq" ? 1 : 0;
  const tr = pattern.transform;

  const ci = ix.cursor ? nearestIndex(q, ix.cursor.x) : -1;
  const cursorQ = ci >= 0 && q[ci]! >= vlo && q[ci]! <= vhi ? q[ci]! : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SegmentedToggle
          options={[
            { id: "sq", label: "S(Q)", title: "Total structure factor S(Q) ± σ — dimensionless, → 1 at high Q" },
            { id: "fq", label: "F(Q)", title: "Reduced structure function F(Q) = Q·[S(Q) − 1] ± Q·σ_S — what the sine transform integrates; its high-Q noise sets σ_G(r)" },
          ] as const}
          value={ordinate}
          onChange={setOrdinate}
        />
        {series.sigS && (
          <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: fz.micro, color: color.secondary, cursor: "pointer" }} title="Show the ±1σ error ribbon from the file's uncertainty column">
            <input type="checkbox" checked={showSigma} onChange={(e) => setShowSigma(e.target.checked)} style={{ accentColor: color.primary }} />
            ±σ ribbon
          </label>
        )}
        <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: fz.micro, color: color.faint }}>
          {q.length} pts · Q {qLo.toFixed(2)}–{qHi.toFixed(2)} Å⁻¹
        </span>
      </div>

      <div ref={boxRef} style={{ position: "relative", flex: 1, minHeight: 240 }}>
        <svg
          ref={svgRef}
          className="wb-plot"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          tabIndex={0}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", touchAction: "pan-y", cursor: ix.panning ? "grabbing" : "crosshair", userSelect: "none" }}
          role="application"
          aria-roledescription="interactive plot"
          aria-label={`${ordinate === "sq" ? "S(Q)" : "F(Q)"} against Q${sig ? " with a ±σ error ribbon" : ""}. Drag to pan, Shift + drag to box-zoom, Ctrl + scroll or pinch to zoom, double-click to reset. Keys: plus and minus zoom, left and right arrows pan, Shift + arrows step the cursor one point, 0 resets.`}
          {...ix.handlers}
          {...{ "data-vmin": vlo, "data-vmax": vhi, "data-dmin": qLo, "data-dmax": qHi, "data-ylock": ix.yLock ? 1 : 0, "data-frame": [X0, X1, W, H, Y0, Y1].join(",") }}
        >
          <rect x={0} y={0} width={W} height={H} fill={color.raised} />
          {yT.map((t) => (
            <g key={`y${t}`}>
              <line x1={X0} x2={X1} y1={sy(t)} y2={sy(t)} stroke={color.subtle2} />
              <text x={X0 - 6} y={sy(t) + 3.5} textAnchor="end" fontSize={10} fontFamily={mono} fill={color.faint}>{fmtTick(t, yStep)}</text>
            </g>
          ))}
          {xT.map((t) => (
            <text key={`x${t}`} x={sx(t)} y={Y1 + 15} textAnchor="middle" fontSize={10} fontFamily={mono} fill={color.faint}>{fmtTick(t, xStep)}</text>
          ))}
          <line x1={X0} x2={X1} y1={Y1} y2={Y1} stroke={color.border} />
          <line x1={X0} x2={X0} y1={Y0} y2={Y1} stroke={color.border} />
          {baseline >= yLo && baseline <= yHi && <line x1={X0} x2={X1} y1={sy(baseline)} y2={sy(baseline)} stroke="#c9c0b0" strokeDasharray="4 4" />}

          {/* Outside the transform's Q window: dimmed, and its edges marked. */}
          {tr && (
            <g>
              {tr.qmin > vlo && <rect x={X0} y={Y0} width={Math.max(0, sx(Math.min(tr.qmin, vhi)) - X0)} height={Y1 - Y0} fill={color.muted} opacity={0.75} />}
              {tr.qmax < vhi && <rect x={sx(Math.max(tr.qmax, vlo))} y={Y0} width={Math.max(0, X1 - sx(Math.max(tr.qmax, vlo)))} height={Y1 - Y0} fill={color.muted} opacity={0.75} />}
              {[["Qmin", tr.qmin], ["Qmax", tr.qmax]].map(([label, v]) =>
                (v as number) >= vlo && (v as number) <= vhi ? (
                  <g key={label as string}>
                    <line x1={sx(v as number)} x2={sx(v as number)} y1={Y0} y2={Y1} stroke={color.primary} strokeDasharray="3 3" opacity={0.6} />
                    {/* Label inside the window: right of Qmin, left of Qmax — so a
                        window edge on the plot edge never clips its own label. */}
                    <text
                      x={sx(v as number) + (label === "Qmax" ? -4 : 4)}
                      y={Y0 + 11}
                      textAnchor={label === "Qmax" ? "end" : "start"}
                      fontSize={10}
                      fontFamily={mono}
                      fill={color.primary}
                    >
                      {label}
                    </text>
                  </g>
                ) : null,
              )}
            </g>
          )}

          {ribbon && <path d={ribbon} fill={color.obs} fillOpacity={0.22} stroke="none" />}
          {line.length > 1 && <polyline points={line.join(" ")} fill="none" stroke={color.obs} strokeWidth={1.2} />}

          {ix.box && (
            <rect
              x={Math.min(ix.box.x0, ix.box.x1)}
              y={ix.box.xOnly ? Y0 : Math.min(ix.box.y0, ix.box.y1)}
              width={Math.abs(ix.box.x1 - ix.box.x0)}
              height={ix.box.xOnly ? Y1 - Y0 : Math.abs(ix.box.y1 - ix.box.y0)}
              fill={color.primary}
              opacity={0.08}
            />
          )}
          {cursorQ !== null && <line x1={sx(cursorQ)} x2={sx(cursorQ)} y1={Y0} y2={Y1} stroke={color.ink} strokeWidth={1} opacity={0.45} pointerEvents="none" />}

          <text x={(X0 + X1) / 2} y={H - 8} textAnchor="middle" fontSize={11} fontFamily={mono} fill={color.faint}>Q (Å⁻¹)</text>
          <text x={14} y={(Y0 + Y1) / 2} textAnchor="middle" fontSize={10} fontFamily={mono} fill={color.faint} transform={`rotate(-90 14 ${(Y0 + Y1) / 2})`}>
            {ordinate === "sq" ? "S(Q)" : "F(Q) = Q[S(Q) − 1] (Å⁻¹)"}
          </text>
          <g fontSize={11} fontFamily={mono} fill={color.secondary}>
            <line x1={X0 + 8} x2={X0 + 24} y1={16} y2={16} stroke={color.obs} strokeWidth={1.4} />
            <text x={X0 + 29} y={19.5}>{ordinate === "sq" ? "S(Q)" : "F(Q)"}</text>
            {ribbon && (
              <>
                <rect x={X0 + 80} y={12} width={12} height={8} fill={color.obs} fillOpacity={0.3} />
                <text x={X0 + 97} y={19.5}>±σ</text>
              </>
            )}
          </g>
        </svg>
        {cursorQ !== null && readoutText && !ix.panning && (
          <div
            className="wb-plot-readout"
            data-x={cursorQ}
            data-step={localStep(q, ci)}
            aria-hidden
            style={{ ...plotReadoutBox, left: `${(sx(cursorQ) / W) * 100}%`, top: `${((Y0 + 18) / H) * 100}%`, transform: sx(cursorQ) > (X0 + X1) / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
          >
            {readoutText}
          </div>
        )}
        <div role="status" aria-live="polite" aria-atomic="true" className="wb-sr-only">{spoken}</div>
        <PlotHint text={ix.hint} />
        <PlotZoomControls ix={ix} yRange={{ lo: yLo, hi: yHi }} style={{ bottom: 4 }} />
      </div>

      <div style={{ fontSize: fz.micro, color: color.secondary, lineHeight: 1.55 }}>
        {tr && (
          <div>
            Transformed at load: trapezoid sine transform G(r) = (2/π)∫F(Q)·sin(Qr)dQ over Q {tr.qmin.toFixed(2)}–{tr.qmax.toFixed(2)} Å⁻¹
            {tr.modification === "lorch" ? ", Lorch-modified" : ", no modification function"}
            {tr.lowQ === "linear" ? ", low-Q region extrapolated linearly to S(0) = 0" : ", 0 → Qmin omitted"}.
          </div>
        )}
        {!series.sigS ? (
          <div>This file has no uncertainty column, so there is no error ribbon and no σ to propagate into G(r).</div>
        ) : summary ? (
          <div style={{ fontFamily: mono }} title="σ_G(r) is propagated exactly through the same linear operator that produced G(r) (U_G = J·U_F·Jᵀ, JCGM 102:2011), treating S(Q) points as independent. Points on the r grid are correlated: ρ is their correlation far from r = 0; 'effective' independent points is the participation ratio of the correlation matrix (Bretherton et al. 1999), 'Nyquist' is (r_max − r_min)·Qmax/π (Farrow et al. 2011).">
            In the fit window {fitRange.min.toFixed(2)}–{fitRange.max.toFixed(2)} Å: σ_G median {sci(summary.medianSigma)}, max {sci(summary.maxSigma)} Å⁻²
            {" · "}Δr {summary.gridStep.toFixed(3)} Å vs Nyquist π/Qmax {summary.nyquistStep.toFixed(3)} Å ({summary.oversampling.toFixed(1)}× oversampled)
            {" · "}ρ(neighbors) {summary.rhoNeighbor.toFixed(2)}, ρ(Nyquist spacing) {summary.rhoNyquist.toFixed(2)}
            {" · "}independent points {Math.round(summary.effectivePoints)} effective / {Math.round(summary.nyquistPoints)} Nyquist, of {summary.points} on the grid.
          </div>
        ) : (
          <div>The fit window holds fewer than two G(r) points — no error summary.</div>
        )}
      </div>
    </div>
  );
}
