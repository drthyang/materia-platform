/**
 * The plot-card view switcher shared by the powder and PDF pages — a compact
 * segmented control (chip-background track, primary-filled active segment).
 * One component so the two pages render byte-identical toggles.
 */

import { color, mono } from "@/app/theme";

export interface SegmentedOption<T extends string> {
  readonly id: T;
  readonly label: string;
  /** Tooltip describing the view. */
  readonly title: string;
}

export function SegmentedToggle<T extends string>({ options, value, onChange }: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
}): JSX.Element {
  return (
    // A segment never wraps its own label ("low → high r" broke in two in the
    // Boxcar plan with the Copilot open at 1280px); where the track is short
    // of room, whole segments go to a second line.
    <div className="wb-seg" style={{ display: "inline-flex", flexWrap: "wrap", maxWidth: "100%", gap: 2, background: color.chipBg, border: `1px solid ${color.border}`, borderRadius: 8, padding: 2 }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          title={o.title}
          style={{
            border: "none",
            borderRadius: 6,
            padding: "3px 11px",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: mono,
            whiteSpace: "nowrap",
            background: o.id === value ? color.primary : "transparent",
            color: o.id === value ? "#fff" : color.secondary,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
