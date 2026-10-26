/**
 * The magnetic page's residual-peak table (KSearchPanel, step 2): what each
 * row's "near" cell says, and which rows a collapsed table shows. Pure, so the
 * rules are tested without rendering (peakTable.test.ts).
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
