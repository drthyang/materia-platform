/**
 * What a 3D card shows when the model cannot be drawn: one plain line with its
 * detail behind "?" (View3DFallback), and a boundary that turns any error from
 * the 3D layer into that line (View3DBoundary), so a three.js failure stays in
 * its card and never reaches the workbench's own error boundary, whose message
 * is about the structure and the data.
 */

import { Component, type ReactNode } from "react";
import { color as theme } from "@/app/theme";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { VIEW_FAILED_LINE, WEBGL_UNAVAILABLE_HELP, WEBGL_UNAVAILABLE_LINE } from "@/app/ui/webglSupport";

export function View3DFallback({
  line = WEBGL_UNAVAILABLE_LINE,
  help = WEBGL_UNAVAILABLE_HELP,
  minHeight = 120,
}: {
  line?: string;
  help?: ReactNode;
  minHeight?: number;
}): JSX.Element {
  return (
    <div
      role="status"
      data-testid="view3d-fallback"
      style={{ flex: 1, minHeight, display: "grid", placeItems: "center", padding: "12px 16px", borderRadius: 10, background: theme.chipBg, color: theme.secondary, fontSize: 13, textAlign: "center" }}
    >
      {/* The line opens its own "?" (a finger gets the line to tap). */}
      <InfoBadge width={300} label={line} text={help} ariaLabel="Why the 3D view is unavailable" />
    </div>
  );
}

interface Props {
  readonly children: ReactNode;
  /** A change in any of these (by identity) draws the children again. */
  readonly resetKeys: readonly unknown[];
  /** Kept above the line when the children fail (the viewer's downloads). */
  readonly header?: ReactNode;
}

interface State {
  readonly error: Error | null;
  readonly keys: readonly unknown[];
}

const changed = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));

export class View3DBoundary extends Component<Props, State> {
  override state: State = { error: null, keys: this.props.resetKeys };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return changed(props.resetKeys, state.keys) ? { error: null, keys: props.resetKeys } : null;
  }

  override componentDidCatch(error: unknown): void {
    console.warn("[3D view] could not be drawn:", error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 6 }}>
        {this.props.header && <div style={{ display: "flex", fontSize: 12 }}>{this.props.header}</div>}
        <View3DFallback
          line={VIEW_FAILED_LINE}
          help={`The 3D layer reported: "${error.message}". Refinement, the plots and the exports are not affected. Loading the structure again, or reloading the page, draws the view again.`}
        />
      </div>
    );
  }
}
