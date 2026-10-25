import { describe, expect, it } from "vitest";
import { PEAK_ROWS_COLLAPSED, nearReflectionLabel, visiblePeakRows, type PeakRowLike } from "@/app/ui/peakTable";

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
