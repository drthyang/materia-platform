/**
 * The resting how-to line that sits with every zoomable plot (WorkbenchPlot,
 * ReciprocalPanel) and every 3D model (StructureView): how to zoom and pan or
 * rotate, in the user's own gestures (⌘ or Ctrl + scroll with a mouse or
 * trackpad, a pinch with a finger). The secondary gestures (box zoom, keys,
 * the fit handles) are in its tooltip, so the line stays one short line. The
 * wording is `gestureHint` (touchInput.ts, tested there).
 *
 * It sits beside the plot's controls, never over the data: in the zoom row
 * under a plot on a touch screen or a narrow plot, on a line of its own under
 * a wide one, and beside the View a / b / c chip under the 3D canvas.
 */

import { Fragment, type CSSProperties } from "react";
import { color } from "@/app/theme";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { gestureHint, isMac, useCoarsePointer, type GestureView } from "@/app/ui/touchInput";

export function GestureHintLine({ view, fitHandles = false, ticks = false, style }: {
  view: GestureView;
  /** The plot has fit-range handles (named in the tooltip). */
  fitHandles?: boolean;
  /** The plot has reflection ticks to click (named in the tooltip). */
  ticks?: boolean;
  style?: CSSProperties;
}): JSX.Element {
  const coarse = useCoarsePointer();
  const hint = gestureHint(view, { coarse, mac: isMac(), fitHandles, ticks });
  // A squeezed line (beside a phone's zoom buttons) breaks between the
  // gestures, never inside one.
  const parts = hint.text.split(" · ");
  const label = parts.map((p, i) => (
    <Fragment key={p}>
      {i > 0 && " "}
      <span style={{ whiteSpace: "nowrap" }}>{i < parts.length - 1 ? `${p} ·` : p}</span>
    </Fragment>
  ));
  return (
    <span className="wb-gesture-hint" style={{ ...line, ...style }}>
      <InfoBadge
        label={label}
        ariaLabel={hint.more.join(" ")}
        width={300}
        text={hint.more.map((m) => <span key={m} style={{ display: "block" }}>{m}</span>)}
      />
    </span>
  );
}

/** The page's sans (index.html), whatever the row it sits in (the 3D view's row is monospaced). */
const line: CSSProperties = {
  display: "inline-flex", alignItems: "center", minWidth: 0,
  fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontSize: 11.5, lineHeight: 1.35, color: color.secondary,
};
