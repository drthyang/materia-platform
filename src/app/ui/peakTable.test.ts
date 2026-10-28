import { describe, expect, it } from "vitest";
import {
  DEFAULT_PEAK_SORT, PEAK_ROWS_COLLAPSED, PEAK_SORT_FIRST, comparePeakRows, describePeakSort, isDefaultPeakSort, listedPeakRows, nearReflectionLabel,
  nextPeakSort, sortPeakRows, visiblePeakRows, type PeakRowLike, type PeakSort, type PeakSortKey, type PeakSortRow,
} from "@/app/ui/peakTable";

/** `n` rows numbered 1…n, none in the search. */
const rows = (n: number, edit: (r: PeakRowLike) => PeakRowLike = (r) => r): PeakRowLike[] =>
  Array.from({ length: n }, (_, i) => edit({ idx: i + 1, included: false }));

describe("the residual-peak table's near cell", () => {
  const near = { phaseLabel: "Mn3Ga", hkl: "1 0 0" };

  it("shows only the hkl for a single phase", () => {
    expect(nearReflectionLabel(near, false)).toBe("(1 0 0)");
  });

  it("names the phase when the pattern has several", () => {
    expect(nearReflectionLabel(near, true)).toBe("Mn3Ga (1 0 0)");
    expect(nearReflectionLabel({ phaseLabel: "MnO", hkl: "1 1 1" }, true)).toBe("MnO (1 1 1)");
  });
});

describe("the residual-peak table's collapsed rows", () => {
  it("shows a short table whole", () => {
    expect(visiblePeakRows(rows(4), false)).toHaveLength(4);
    // Collapsing would hide only one or two rows: not worth a "Show all".
    expect(visiblePeakRows(rows(PEAK_ROWS_COLLAPSED + 2), false)).toHaveLength(PEAK_ROWS_COLLAPSED + 2);
  });

  it("keeps the first rows of a long table when the data carry no σ", () => {
    expect(visiblePeakRows(rows(24), false).map((r) => r.idx)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps the most significant rows, in the table's order", () => {
    // A high-d end of 3σ noise, the real residuals further down.
    const sig = [3.2, 3.2, 3.4, 3.9, 3.4, 3.6, 4.0, 3.4, 4.0, 3.7, 3.2, 4.5, 3.0, 3.5, 4.1, 3.1, 4.0, 3.1, 3.6, 3.5, 3.6, 4.3, 10.6, 5.1];
    const table = rows(sig.length, (r) => ({ ...r, significance: sig[r.idx - 1]! }));
    // Ties (4.0 at #7, #9, #17) go to the earlier row.
    expect(visiblePeakRows(table, false).map((r) => r.idx)).toEqual([7, 12, 15, 22, 23, 24]);
  });

  it("ranks a row without a significance last", () => {
    const table = rows(10, (r) => (r.idx === 2 ? r : { ...r, significance: r.idx }));
    expect(visiblePeakRows(table, false).map((r) => r.idx)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("shows every row once expanded", () => {
    expect(visiblePeakRows(rows(24), true)).toHaveLength(24);
  });

  it("never hides a row the k-search reads, a manual pick or the spotlighted peak", () => {
    const table = rows(24, (r) => (r.idx === 12 ? { ...r, included: true } : r.idx === 20 ? { ...r, manual: true, included: true } : r));
    // Three kept, the first three of the rest fill the six.
    expect(visiblePeakRows(table, false, 17).map((r) => r.idx)).toEqual([1, 2, 3, 12, 17, 20]);
  });

  it("keeps more than the limit when that many rows must stay", () => {
    const table = rows(12, (r) => ({ ...r, included: r.idx <= 8 }));
    expect(visiblePeakRows(table, false).map((r) => r.idx)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps the rows' own objects", () => {
    const table = rows(10);
    expect(visiblePeakRows(table, false)[0]).toBe(table[0]);
    expect(visiblePeakRows(table, true)).toBe(table);
  });
});

/** A table of rows #1…n as the page lists them: d falling with #, whatever else each row carries. */
const sortable = (n: number, edit: (r: PeakSortRow) => PeakSortRow = (r) => r): PeakSortRow[] =>
  Array.from({ length: n }, (_, i) => edit({ idx: i + 1, included: false, d: 6 - 0.1 * i }));
const idxs = (rows: readonly { idx: number }[]): number[] => rows.map((r) => r.idx);
const by = (key: PeakSortKey, dir: "asc" | "desc"): PeakSort => ({ key, dir });

describe("the residual-peak table's sort", () => {
  it("opens in the order the table has always had: # ascending, d from large to small", () => {
    expect(DEFAULT_PEAK_SORT).toEqual({ key: "idx", dir: "asc" });
    expect(isDefaultPeakSort(DEFAULT_PEAK_SORT)).toBe(true);
    expect(isDefaultPeakSort(by("idx", "desc"))).toBe(false);
    const table = sortable(8);
    expect(idxs(sortPeakRows(table, DEFAULT_PEAK_SORT))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Rows handed over in another order come out in the default one.
    expect(idxs(sortPeakRows([...table].reverse(), DEFAULT_PEAK_SORT))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(describePeakSort(DEFAULT_PEAK_SORT)).toBe("# ascending (d from large to small)");
  });

  it("orders by d, I/σ, Δd→k, nearness to a nuclear reflection and use, either way", () => {
    const table = sortable(5, (r) => ({
      ...r,
      significance: [4.2, 9.1, 5.5, 4.2, 7.0][r.idx - 1]!,
      delta: [0.020, 0.003, 0.150, 0.0, 0.040][r.idx - 1]!,
      included: r.idx === 2 || r.idx === 5,
      ...(r.idx === 1 || r.idx === 4 ? { nearNuclear: { relDelta: r.idx === 1 ? 0.004 : 0.001 } } : {}),
    }));
    expect(idxs(sortPeakRows(table, by("d", "asc")))).toEqual([5, 4, 3, 2, 1]);
    expect(idxs(sortPeakRows(table, by("d", "desc")))).toEqual([1, 2, 3, 4, 5]);
    // I/σ: 1 and 4 tie at 4.2 and stay in # order in both directions.
    expect(idxs(sortPeakRows(table, by("significance", "desc")))).toEqual([2, 5, 3, 1, 4]);
    expect(idxs(sortPeakRows(table, by("significance", "asc")))).toEqual([1, 4, 3, 5, 2]);
    expect(idxs(sortPeakRows(table, by("delta", "asc")))).toEqual([4, 2, 1, 5, 3]);
    expect(idxs(sortPeakRows(table, by("delta", "desc")))).toEqual([3, 5, 1, 2, 4]);
    // Nearest a nuclear reflection first (4 at 0.1 %, then 1 at 0.4 %); the rows on none go last, in # order.
    expect(idxs(sortPeakRows(table, by("near", "asc")))).toEqual([4, 1, 2, 3, 5]);
    // Reversed: the rows on none first, then the peak furthest from its reflection.
    expect(idxs(sortPeakRows(table, by("near", "desc")))).toEqual([2, 3, 5, 1, 4]);
    // The picks in the search first, or last; each group in # order.
    expect(idxs(sortPeakRows(table, by("use", "desc")))).toEqual([2, 5, 1, 3, 4]);
    expect(idxs(sortPeakRows(table, by("use", "asc")))).toEqual([1, 3, 4, 2, 5]);
  });

  it("breaks ties by # ascending whichever way the column runs, so a flip reverses the column and not the rows inside a tie", () => {
    const table = sortable(6, (r) => ({ ...r, significance: r.idx % 2 === 0 ? 5 : 8 }));
    expect(idxs(sortPeakRows(table, by("significance", "desc")))).toEqual([1, 3, 5, 2, 4, 6]);
    expect(idxs(sortPeakRows(table, by("significance", "asc")))).toEqual([2, 4, 6, 1, 3, 5]);
    // The same answer from any starting order: the sort is a function of the rows, not of the array they arrive in.
    expect(idxs(sortPeakRows([...table].reverse(), by("significance", "desc")))).toEqual([1, 3, 5, 2, 4, 6]);
    const shuffled = [table[3]!, table[0]!, table[5]!, table[2]!, table[1]!, table[4]!];
    expect(idxs(sortPeakRows(shuffled, by("significance", "asc")))).toEqual([2, 4, 6, 1, 3, 5]);
    // Equal d (a peak listed twice) is a tie too.
    const same = sortable(3, (r) => ({ ...r, d: 4 }));
    expect(idxs(sortPeakRows([...same].reverse(), by("d", "desc")))).toEqual([1, 2, 3]);
  });

  it("puts a row with no value last in either direction", () => {
    // No σ on #2 (a masked bin), no satellite match on #3, #4 on a nuclear reflection and #1 on none.
    const table = sortable(4, (r) => ({
      ...r,
      ...(r.idx === 2 ? {} : { significance: r.idx }),
      ...(r.idx === 3 ? { delta: Number.NaN } : { delta: 0.01 * r.idx }),
    }));
    expect(idxs(sortPeakRows(table, by("significance", "desc")))).toEqual([4, 3, 1, 2]);
    expect(idxs(sortPeakRows(table, by("significance", "asc")))).toEqual([1, 3, 4, 2]);
    expect(idxs(sortPeakRows(table, by("delta", "asc")))).toEqual([1, 2, 4, 3]);
    expect(idxs(sortPeakRows(table, by("delta", "desc")))).toEqual([4, 2, 1, 3]);
    // Two rows with nothing to compare keep # order.
    const none = sortable(3, (r) => ({ ...r }));
    expect(idxs(sortPeakRows(none, by("significance", "desc")))).toEqual([1, 2, 3]);
  });

  it("is a consistent order: antisymmetric, and sorting twice changes nothing", () => {
    const table = sortable(12, (r) => ({ ...r, ...(r.idx % 3 === 0 ? {} : { significance: (r.idx * 7) % 5 }), delta: ((r.idx * 3) % 4) / 100 }));
    for (const key of ["idx", "d", "significance", "delta", "near", "use"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        const cmp = comparePeakRows(by(key, dir));
        for (const a of table) for (const b of table) expect(Math.sign(cmp(a, b))).toBe(-Math.sign(cmp(b, a)) || 0);
        const once = sortPeakRows(table, by(key, dir));
        expect(sortPeakRows(once, by(key, dir))).toEqual(once);
      }
    }
  });

  it("keeps the rows' own objects and leaves the input as it was", () => {
    const table = sortable(5, (r) => ({ ...r, significance: 10 - r.idx }));
    const copy = [...table];
    const out = sortPeakRows(table, by("significance", "asc"));
    expect(table).toEqual(copy);
    expect(out[0]).toBe(table[4]);
    expect(out).not.toBe(table);
  });

  it("starts a column at the end a reader looks for, and flips it on the next click", () => {
    // The strongest and the picked first; the rest ascending.
    expect(PEAK_SORT_FIRST).toEqual({ idx: "asc", d: "asc", significance: "desc", delta: "asc", near: "asc", use: "desc" });
    expect(nextPeakSort(DEFAULT_PEAK_SORT, "significance")).toEqual(by("significance", "desc"));
    expect(nextPeakSort(by("significance", "desc"), "significance")).toEqual(by("significance", "asc"));
    expect(nextPeakSort(by("significance", "asc"), "significance")).toEqual(by("significance", "desc"));
    // # is the column the table opens sorted by: its first click reverses it, and a click from another column starts it ascending.
    expect(nextPeakSort(DEFAULT_PEAK_SORT, "idx")).toEqual(by("idx", "desc"));
    expect(nextPeakSort(by("d", "desc"), "idx")).toEqual(DEFAULT_PEAK_SORT);
    expect(nextPeakSort(by("use", "desc"), "d")).toEqual(by("d", "asc"));
  });

  it("describes every order in words", () => {
    expect(describePeakSort(by("significance", "desc"))).toBe("I/σ, strongest first");
    expect(describePeakSort(by("use", "desc"))).toBe("selected peaks first");
    expect(describePeakSort(by("d", "asc"))).toBe("d ascending");
    expect(describePeakSort(by("delta", "asc"))).toBe("Δd→k, best match first");
    expect(describePeakSort(by("near", "asc"))).toBe("nearest a nuclear reflection first");
  });
});

describe("the residual-peak table's collapsed rows under a sort", () => {
  // 24 rows with the σ the #116 rule was written for: a noisy high-d end, the real residuals below.
  const sig = [3.2, 3.2, 3.4, 3.9, 3.4, 3.6, 4.0, 3.4, 4.0, 3.7, 3.2, 4.5, 3.0, 3.5, 4.1, 3.1, 4.0, 3.1, 3.6, 3.5, 3.6, 4.3, 10.6, 5.1];
  const table = (edit: (r: PeakSortRow) => PeakSortRow = (r) => r): PeakSortRow[] =>
    sortable(sig.length, (r) => edit({ ...r, significance: sig[r.idx - 1]!, delta: 0.01 * ((r.idx * 7) % 24) }));
  const allSorts: PeakSort[] = (["idx", "d", "significance", "delta", "near", "use"] as const).flatMap((key) => [by(key, "asc"), by(key, "desc")]);

  it("shows the same rows in any order: sorting reorders them, and never swaps a real peak for noise", () => {
    const rows = table();
    const expected = [7, 12, 15, 22, 23, 24];
    for (const sort of allSorts) {
      expect(idxs(listedPeakRows(rows, sort, false)).sort((a, b) => a - b), `${sort.key} ${sort.dir}`).toEqual(expected);
    }
  });

  it("lists the collapsed rows in the order of the sort", () => {
    const rows = table();
    // Strongest first: the collapsed rows are the first rows of the order. Ties (4.0, #7 before #9 …) in # order.
    expect(idxs(listedPeakRows(rows, by("significance", "desc"), false))).toEqual([23, 24, 12, 22, 15, 7]);
    expect(idxs(listedPeakRows(rows, by("d", "asc"), false))).toEqual([24, 23, 22, 15, 12, 7]);
    expect(idxs(listedPeakRows(rows, by("idx", "desc"), false))).toEqual([24, 23, 22, 15, 12, 7]);
    expect(idxs(listedPeakRows(rows, DEFAULT_PEAK_SORT, false))).toEqual([7, 12, 15, 22, 23, 24]);
  });

  it("keeps the search's rows, a hand-added one and the spotlighted one in any order, listed where the sort puts them", () => {
    const rows = table((r) => (r.idx === 2 ? { ...r, included: true } : r.idx === 20 ? { ...r, manual: true, included: true } : r));
    for (const sort of allSorts) {
      const shown = idxs(listedPeakRows(rows, sort, false, 17));
      expect(shown, `${sort.key} ${sort.dir}`).toEqual(expect.arrayContaining([2, 17, 20]));
      // The three kept and the three strongest of the rest (#23, #24, #12) fill the six.
      expect([...shown].sort((a, b) => a - b)).toEqual([2, 12, 17, 20, 23, 24]);
    }
    expect(idxs(listedPeakRows(rows, by("d", "desc"), false, 17))).toEqual([2, 12, 17, 20, 23, 24]);
    expect(idxs(listedPeakRows(rows, by("d", "asc"), false, 17))).toEqual([24, 23, 20, 17, 12, 2]);
    // The spotlight follows a click on another row: the row it left goes back to the strongest-first rule.
    expect(idxs(listedPeakRows(rows, by("d", "asc"), false, 5))).toEqual([24, 23, 20, 12, 5, 2]);
  });

  it("lists every row once expanded, in the order of the sort, and a short table whole", () => {
    const rows = table();
    expect(idxs(listedPeakRows(rows, by("significance", "desc"), true))).toEqual(idxs(sortPeakRows(rows, by("significance", "desc"))));
    expect(listedPeakRows(rows, by("d", "asc"), true)).toHaveLength(24);
    const short = sortable(5, (r) => ({ ...r, significance: r.idx }));
    expect(idxs(listedPeakRows(short, by("significance", "desc"), false))).toEqual([5, 4, 3, 2, 1]);
  });

  it("collapses by # where the data carry no σ, in any order, as before", () => {
    const rows = sortable(24);
    for (const sort of allSorts) expect(idxs(listedPeakRows(rows, sort, false)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(idxs(listedPeakRows(rows, by("d", "asc"), false))).toEqual([6, 5, 4, 3, 2, 1]);
  });
});
