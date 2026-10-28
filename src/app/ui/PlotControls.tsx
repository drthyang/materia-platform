/**
 * The visible controls shared by the interactive 1-D plots (usePlotInteraction):
 * zoom out / in, the y lock, Reset, the gesture-line flash on a plain wheel, and
 * the row under the plot with the resting gesture hint.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import { color, mono } from "@/app/theme";
import { GestureHintLine } from "@/app/ui/GestureHintLine";
import type { usePlotInteraction } from "@/app/ui/usePlotInteraction";

type Interaction = ReturnType<typeof usePlotInteraction>;

export function PlotZoomControls({ ix, yRange, style, inline = false }: {
  ix: Interaction;
  /** The y range on screen now, which "y auto → fixed" freezes. */
  yRange?: { lo: number; hi: number };
  style?: CSSProperties;
  /**
   * A row of its own under the plot instead of a corner overlay: where the
   * overlay would cover the plot's axis text (a narrow plot, where the x
   * title reaches the corner) or its data (finger-sized buttons; see
   * `zoomControlsInline`).
   */
  inline?: boolean;
}): JSX.Element {
  return (
    <div className="wb-plot-zoom" data-inline={inline ? "" : undefined} style={inline ? { ...zoomRow, ...style } : { ...zoomOverlay, ...style }}>
      <SmallButton onClick={ix.zoomOut} title="Zoom out (−)" ariaLabel="Zoom out">−</SmallButton>
      <SmallButton onClick={ix.zoomIn} title="Zoom in (+). Also Ctrl/⌘ + scroll, a pinch, or Shift + drag a box" ariaLabel="Zoom in">+</SmallButton>
      {yRange && (
        <SmallButton
          onClick={() => ix.setYLock(ix.yLock ? null : { lo: yRange.lo, hi: yRange.hi })}
          title={ix.yLock ? "y is fixed — click to autoscale y to the view again" : "Fix the y range (it otherwise autoscales to what is in view). A Shift + drag box taller than 20 px also fixes y."}
          pressed={ix.yLock !== null}
        >
          {ix.yLock ? "y fixed" : "y auto"}
        </SmallButton>
      )}
      <SmallButton onClick={ix.reset} title="Show the whole range, y automatic (also double-click, or 0)" ariaLabel="Reset zoom" disabled={!ix.zoomed}>
        Reset
      </SmallButton>
    </div>
  );
}

/**
 * The row under a plot: the gesture hint on the left and, where the zoom
 * buttons take a row of their own (`inline`), the buttons on the right, so a
 * touch screen spends no extra row on the hint.
 */
export function PlotFooter({ ix, yRange, inline, fitHandles = false, ticks = false, style }: {
  ix: Interaction;
  yRange?: { lo: number; hi: number };
  inline: boolean;
  fitHandles?: boolean;
  ticks?: boolean;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <div className="wb-plot-foot" style={{ ...footRow, ...style }}>
      <GestureHintLine view="plot" fitHandles={fitHandles} ticks={ticks} style={{ flex: "1 1 96px" }} />
      {inline && <PlotZoomControls ix={ix} {...(yRange ? { yRange } : {})} inline style={{ marginTop: 0, marginLeft: "auto", flex: "0 0 auto" }} />}
    </div>
  );
}

export function PlotHint({ text }: { text: string | null }): JSX.Element | null {
  return text ? <div style={hintOverlay} aria-hidden>{text}</div> : null;
}

function SmallButton({ children, onClick, title, ariaLabel, pressed, disabled = false }: {
  children: ReactNode;
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  pressed?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      {...(title ? { title } : {})}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      style={{
        border: `1px solid ${pressed ? color.primaryTintBorder : color.control}`,
        background: pressed ? color.primaryTintBg : hover && !disabled ? "#f5f0e7" : "#fff",
        color: disabled ? color.faintest : color.ink,
        borderRadius: 7, padding: "1px 9px", fontSize: 11, fontFamily: mono, lineHeight: "16px", minWidth: 24,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

const zoomOverlay: CSSProperties = { position: "absolute", bottom: 6, right: 8, display: "flex", alignItems: "center", gap: 5, background: "rgba(255,253,249,0.85)", borderRadius: 8, padding: "3px 6px" };
const zoomRow: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 6, marginTop: 4 };
const footRow: CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 10px", marginTop: 5 };

/**
 * Whether a plot's zoom controls take a row under it rather than its corner:
 * on a touch screen (44 px buttons would cover the difference band) and on a
 * plot under 500 px wide (the centred x title reaches the corner). Every
 * desktop plot is wider, so it keeps the overlay.
 */
export const zoomControlsInline = (coarse: boolean, plotWidth: number): boolean => coarse || plotWidth < 500;

/** The floating cursor readout (positioned by the plot). */
export const plotReadoutBox: CSSProperties = {
  position: "absolute", pointerEvents: "none", zIndex: 1, fontFamily: mono, fontSize: 11.5, lineHeight: 1.45,
  background: "rgba(255,253,249,0.94)", border: `1px solid ${color.border}`, borderRadius: 7, padding: "4px 8px",
  boxShadow: "0 1px 4px rgba(25,23,20,0.08)", whiteSpace: "nowrap", minWidth: 120,
};

const hintOverlay: CSSProperties = {
  position: "absolute", left: "50%", top: "42%", transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 2,
  background: "rgba(25,23,20,0.78)", color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13,
  // The line names every gesture, so on a narrow plot it wraps inside the plot instead of overflowing it.
  maxWidth: "calc(100% - 32px)", width: "max-content", textAlign: "center",
};
