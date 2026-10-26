/**
 * A column header of the magnetic page's residual-peak table that sorts it: a
 * button in the header cell (so Tab, Enter and Space work, and a finger gets
 * the 44 px the touch rules give every button), the cell's aria-sort saying
 * which column is sorted and which way, and a glyph for the same in sight.
 */

import type { CSSProperties, ReactNode } from "react";
import { color } from "@/app/theme";
import { describePeakSort, nextPeakSort, type PeakSort, type PeakSortKey } from "@/app/ui/peakTable";

const buttonStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent",
  padding: 0, margin: 0, font: "inherit", fontWeight: 600, color: "inherit", cursor: "pointer", textAlign: "left",
  whiteSpace: "nowrap",
};

/** Two small triangles; the one for the sorted direction is solid, the other (or both, on an unsorted column) pale. */
function SortGlyph({ dir }: { dir: "asc" | "desc" | null }): JSX.Element {
  return (
    <svg width="7" height="11" viewBox="0 0 7 11" aria-hidden focusable="false" style={{ flex: "none" }}>
      <path d="M3.5 0.5 L6.5 4.5 L0.5 4.5 Z" fill={dir === "asc" ? color.ink : color.faintest} />
      <path d="M3.5 10.5 L6.5 6.5 L0.5 6.5 Z" fill={dir === "desc" ? color.ink : color.faintest} />
    </svg>
  );
}

export function PeakSortHeader({ column, label, title, sort, onSort, style }: {
  readonly column: PeakSortKey;
  readonly label: ReactNode;
  /** What the column is (the tooltip adds what a click does). */
  readonly title: string;
  readonly sort: PeakSort;
  readonly onSort: (next: PeakSort) => void;
  readonly style?: CSSProperties;
}): JSX.Element {
  const active = sort.key === column;
  const next = nextPeakSort(sort, column);
  return (
    <th
      scope="col"
      style={style}
      {...(active ? { "aria-sort": sort.dir === "asc" ? "ascending" : "descending" } : {})}
    >
      <button
        type="button"
        data-sort-column={column}
        style={buttonStyle}
        onClick={() => onSort(next)}
        title={`${title}. ${active ? `Sorted: ${describePeakSort(sort)}. Click for ${describePeakSort(next)}.` : `Click to sort: ${describePeakSort(next)}.`}`}
      >
        {label}
        <SortGlyph dir={active ? sort.dir : null} />
      </button>
    </th>
  );
}
