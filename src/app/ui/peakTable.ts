/**
 * The magnetic page's residual-peak table (KSearchPanel, step 2): what each
 * row's "near" cell says, which rows a collapsed table shows, and the order the
 * rows are listed in (a click on a column header). Pure, so the rules are
 * tested without rendering (peakTable.test.ts).
 */

/** Rows a collapsed table shows before "Show all". */
export const PEAK_ROWS_COLLAPSED = 6;

/**
 * Collapse only when that hides at least this many rows: a "Show all" that
 * reveals one or two rows costs as much room as the rows themselves.
 */
const MIN_HIDDEN = 3;

/** The nuclear reflection a residual apex sits on (core/magnetic/extraPeaks.ts). */
export interface NearReflection {
  readonly phaseLabel: string;
  readonly hkl: string;
}

/**
 * The "near" cell: the reflection's hkl, with its phase only when the pattern
 * has more than one. A single phase's name repeated on every row (a long
 * formula on a high-entropy sample) only crowded the table; the cell's tooltip
 * still names it.
 */
export function nearReflectionLabel(near: NearReflection, multiPhase: boolean): string {
  return multiPhase ? `${near.phaseLabel} (${near.hkl})` : `(${near.hkl})`;
}

/** What the collapsed table must keep, whatever its position. */
export interface PeakRowLike {
  readonly idx: number;
  readonly included: boolean;
  readonly manual?: boolean;
  /** Residual height over σ at the apex (absent without σ, or on a masked bin). */
  readonly significance?: number;
}

/**
 * The rows the table shows, in the table's own order. Expanded, or short
 * enough: all of them. Collapsed: every row that feeds the k-search, was added
 * by hand or is spotlighted on the pattern (`keepIdx`) — the table never hides
 * what the search reads or what the user just clicked — then the most
 * significant of the rest up to `limit` (by position where the data carry no
 * σ). The strongest residuals, not the first by d: on a pattern whose high-d
 * end is 3σ noise those rows said nothing, and hid the peaks on nuclear
 * positions that a k = 0 ordering is read from.
 */
export function visiblePeakRows<T extends PeakRowLike>(
  rows: readonly T[],
  expanded: boolean,
  keepIdx: number | null = null,
  limit: number = PEAK_ROWS_COLLAPSED,
): readonly T[] {
  if (expanded || rows.length < limit + MIN_HIDDEN) return rows;
  const kept = new Set(rows.filter((r) => r.included || r.manual === true || r.idx === keepIdx).map((r) => r.idx));
  const rest = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !kept.has(r.idx))
    .sort((a, b) => (b.r.significance ?? -Infinity) - (a.r.significance ?? -Infinity) || a.i - b.i);
  for (const { r } of rest.slice(0, Math.max(0, limit - kept.size))) kept.add(r.idx);
  return rows.filter((r) => kept.has(r.idx));
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/** A sortable column of the table. */
export type PeakSortKey = "idx" | "d" | "significance" | "delta" | "near" | "use";
export type PeakSortDir = "asc" | "desc";
export interface PeakSort {
  readonly key: PeakSortKey;
  readonly dir: PeakSortDir;
}

/**
 * The order the table opens in, and the one it has always had: by # ascending,
 * the numbering the ticks on the pattern carry — d from large to small, low Q
 * first, where magnetic peaks live (magneticStep.ts, peakRows).
 */
export const DEFAULT_PEAK_SORT: PeakSort = { key: "idx", dir: "asc" };

/**
 * The direction a column starts in when first clicked: the end a reader looks
 * for first. The strongest peak and the picks in the search lead; the rest
 * (smallest # or d, the closest satellite match, the peak nearest a nuclear
 * reflection) lead in ascending order.
 */
export const PEAK_SORT_FIRST: Readonly<Record<PeakSortKey, PeakSortDir>> = {
  idx: "asc",
  d: "asc",
  significance: "desc",
  delta: "asc",
  near: "asc",
  use: "desc",
};

/** What a header click does: the active column flips, another column starts in its own first direction. */
export function nextPeakSort(current: PeakSort, key: PeakSortKey): PeakSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: PEAK_SORT_FIRST[key] };
}

/** The row's fields the sort reads. `delta` is the |Δd| (Å) to the nearest satellite G ± k of the current k. */
export interface PeakSortRow extends PeakRowLike {
  readonly d: number;
  /** |Δd| to the nearest satellite of the current k, in Å; absent or non-finite where none was computed. */
  readonly delta?: number | undefined;
  /** The nuclear reflection the apex sits on, if any. */
  readonly nearNuclear?: { readonly relDelta: number };
}

/**
 * A column's value for a row, or null where the row has none. A row without a
 * value goes last in either direction: a missing σ or satellite match is not
 * "the weakest" or "the best", and the strongest peaks should lead whichever
 * way the column is flipped.
 */
function sortValue(row: PeakSortRow, key: PeakSortKey): number | null {
  const finite = (v: number | undefined): number | null => (v !== undefined && Number.isFinite(v) ? v : null);
  switch (key) {
    case "idx": return row.idx;
    case "d": return finite(row.d);
    case "significance": return finite(row.significance);
    case "delta": return finite(row.delta);
    // Closeness to a nuclear reflection, as the "near" cell shows it. A peak
    // away from every one is a value too (infinitely far), not a missing one:
    // reversed, those lead.
    case "near": return finite(row.nearNuclear?.relDelta) ?? Infinity;
    case "use": return row.included ? 1 : 0;
  }
}

/**
 * Order rows by one column. Ties (equal values, or no value at all) keep the
 * # order whichever way the column is sorted — the secondary key is always # ascending,
 * so a flip reverses the column, not the rows inside a tie, and the order is the same on every render.
 */
export function comparePeakRows(sort: PeakSort): (a: PeakSortRow, b: PeakSortRow) => number {
  const sign = sort.dir === "asc" ? 1 : -1;
  return (a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va !== null && vb !== null) {
      if (va !== vb) return sign * (va < vb ? -1 : 1);
    } else if (va !== null) {
      return -1;
    } else if (vb !== null) {
      return 1;
    }
    return a.idx - b.idx;
  };
}

/** The rows in the order of `sort`; the rows themselves are kept, the input is not changed. */
export function sortPeakRows<T extends PeakSortRow>(rows: readonly T[], sort: PeakSort): T[] {
  return [...rows].sort(comparePeakRows(sort));
}

/**
 * The rows the table lists, in the order of `sort`. WHICH rows a collapsed
 * table shows does not depend on the order: the same ones `visiblePeakRows`
 * keeps (every row the search reads, a hand-added or spotlighted one, then the
 * strongest), so sorting by d or by the satellite match never swaps a real
 * residual peak for 3σ noise; sorting only reorders them. Sorted by I/σ
 * descending, the collapsed rows are the first rows of the order.
 */
export function listedPeakRows<T extends PeakSortRow>(
  rows: readonly T[],
  sort: PeakSort,
  expanded: boolean,
  keepIdx: number | null = null,
  limit: number = PEAK_ROWS_COLLAPSED,
): T[] {
  return sortPeakRows(visiblePeakRows(rows, expanded, keepIdx, limit), sort);
}

/** A column's name in the sort note and the screen reader's status. */
const SORT_NAME: Readonly<Record<PeakSortKey, string>> = {
  idx: "#",
  d: "d",
  significance: "I/σ",
  delta: "Δd→k",
  near: "nearness to a nuclear reflection",
  use: "use in the k-search",
};

/**
 * What an order is, in words: the direction where it is plain (d, #), and the
 * end that leads where it is not (I/σ, Δd→k, near, use). Shown beside the table
 * once the order is not the default, and read out when a header is pressed.
 */
export function describePeakSort(sort: PeakSort): string {
  const asc = sort.dir === "asc";
  switch (sort.key) {
    case "idx": return asc ? "# ascending (d from large to small)" : "# descending (d from small to large)";
    case "d": return asc ? "d ascending" : "d descending";
    case "significance": return asc ? "I/σ, weakest first" : "I/σ, strongest first";
    case "delta": return asc ? "Δd→k, best match first" : "Δd→k, worst match first";
    case "near": return asc ? "nearest a nuclear reflection first" : "away from nuclear reflections first";
    case "use": return asc ? "unselected peaks first" : "selected peaks first";
  }
}

/** The name `describePeakSort` and the header tooltips use for a column. */
export const peakSortName = (key: PeakSortKey): string => SORT_NAME[key];

export const isDefaultPeakSort = (sort: PeakSort): boolean => sort.key === DEFAULT_PEAK_SORT.key && sort.dir === DEFAULT_PEAK_SORT.dir;
