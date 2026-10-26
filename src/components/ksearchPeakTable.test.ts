// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parse_structure } from "@/mcp/tools";
import { KSearchPanel, type MagneticPatternView } from "@/components/KSearchPanel";
import type { ResidualPeak } from "@/app/magneticStep";
import type { PhaseTicks } from "@/visualization/reflectionTicks";

/**
 * The magnetic page's residual-peak table, as the page renders it: a click on a
 * row marks the peak on the pattern and leaves the view where it is (moving it
 * only to show a peak that is out of view, at the same width); a header sorts.
 * The real panel and the real plot, in a DOM; only the 3D viewer is stubbed.
 */
vi.mock("@/app/ui/StructureView", () => ({ StructureView: () => null }));
// Each test mounts the whole panel, which works out the little group's subgroup lattice: about a second
// on an idle machine, several on a loaded CI runner, so the default 5 s is too tight.
vi.setConfig({ testTimeout: 60_000 });

const FE = `data_fe
_cell_length_a 2.8665
_cell_length_b 2.8665
_cell_length_c 2.8665
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'I m -3 m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
Fe1 Fe3+ 0 0 0 1 0.4
`;

/** 24 peaks, #1 at d = 6.0 down to #24 at d = 1.4 in steps of 0.2; the strongest are #3, #14 and #22. */
const SIGMA: Record<number, number> = { 3: 9, 14: 12, 22: 8 };
const peaks: ResidualPeak[] = Array.from({ length: 24 }, (_, i) => ({
  d: Number((6.0 - 0.2 * i).toFixed(4)),
  height: 100,
  significance: SIGMA[i + 1] ?? 3.2 + 0.01 * i,
}));
/** Where #n sits on the pattern (the x axis is d here). */
const dOf = (n: number): number => peaks[n - 1]!.d;

/**
 * A pattern over d = 0.7…6.5 Å, zoomed on arrival to the fit window (+ 8 % either side): 3.0…4.0 Å, or
 * Q = 2π/4.0…2π/3.0 Å⁻¹ in the other unit — the same peaks in either, so the view is the same region.
 */
type Unit = "d" | "Q";
const toX = (unit: Unit) => (d: number): number => (unit === "d" ? d : (2 * Math.PI) / d);
function patternView(unit: Unit = "d"): MagneticPatternView {
  const dToX = toX(unit);
  const x = Array.from({ length: 600 }, (_, i) => (unit === "d" ? 0.7 + (5.8 * i) / 599 : dToX(6.5) + ((dToX(0.7) - dToX(6.5)) * i) / 599));
  const yObs = x.map((v) => 100 + 400 * Math.exp(-0.5 * ((v - dToX(3.4)) / 0.03) ** 2));
  const nuclear: PhaseTicks = { id: "fe", label: "Fe", color: "#0f8a8a", kind: "nuclear", ticks: [{ x: dToX(2.0), hkl: "1 1 0", d: 2.0 }] };
  return {
    curves: { x, yObs, yCalc: x.map(() => 100), diff: yObs.map((v) => v - 100) },
    xLabel: unit === "d" ? "d (Å)" : "Q (Å⁻¹)",
    dToX,
    xToD: (v) => (unit === "d" ? v : (2 * Math.PI) / v),
    dRange: { min: 0.7, max: 6.5 },
    nuclearTicks: [nuclear],
    fitRange: unit === "d" ? { min: 3.0, max: 4.0 } : { min: dToX(4.0), max: dToX(3.0) },
  };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const { structure } = parse_structure({ cif: FE });
const render = async (unit: Unit = "d", residualPeaks: readonly ResidualPeak[] = peaks): Promise<void> => {
  await act(async () => {
    root!.render(createElement(KSearchPanel, { structure, residualPeaks, patternView: patternView(unit) }));
  });
};
async function mount(): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await render();
  return host;
}

const table = (h: HTMLElement): HTMLTableElement => {
  const t = [...h.querySelectorAll("table")].find((el) => el.textContent?.includes("Δd→k"));
  if (!t) throw new Error("no peak table");
  return t;
};
const rowsOf = (h: HTMLElement): HTMLTableRowElement[] => [...table(h).querySelectorAll<HTMLTableRowElement>("tbody tr")];
const rowFor = (h: HTMLElement, n: number): HTMLTableRowElement => {
  const r = rowsOf(h).find((el) => el.cells[1]?.textContent === `#${n}`);
  if (!r) throw new Error(`no row #${n}`);
  return r;
};
const numbers = (h: HTMLElement): number[] => rowsOf(h).map((r) => Number(r.cells[1]!.textContent!.slice(1)));
const view = (h: HTMLElement): [number, number] => {
  const svg = h.querySelector("svg[data-vmin]")!;
  return [Number(svg.getAttribute("data-vmin")), Number(svg.getAttribute("data-vmax"))];
};
const width = (h: HTMLElement): number => view(h)[1] - view(h)[0];
const click = (el: Element): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
/** A key pressed on `el`; whether the page kept it from the browser's own handling. */
const key = (el: Element, k: string): boolean => {
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev.defaultPrevented;
};
const picked = (h: HTMLElement): string[] => [...h.querySelectorAll("tr[aria-current='true']")].map((r) => (r as HTMLTableRowElement).cells[1]!.textContent!);
const band = (h: HTMLElement): SVGRectElement | null => h.querySelector("rect[data-highlight-band]");
/** The data-space x the highlight band is centred on, read back through the plot's own frame. */
const bandX = (h: HTMLElement): number => {
  const svg = h.querySelector("svg[data-vmin]")!;
  const [x0, x1] = svg.getAttribute("data-frame")!.split(",").map(Number);
  const r = band(h)!;
  const centre = Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2;
  const [lo, hi] = view(h);
  return lo + ((centre - x0!) / (x1! - x0!)) * (hi - lo);
};
/** The visible "sorted by …" note beside the table (there only while the order is not the default). */
const sortNote = (h: HTMLElement): string | null => [...h.querySelectorAll("span")].find((el) => el.textContent?.startsWith("sorted by"))?.textContent ?? null;
const header = (h: HTMLElement, column: string): HTMLButtonElement => table(h).querySelector<HTMLButtonElement>(`button[data-sort-column="${column}"]`)!;
const sortedHeaders = (h: HTMLElement): string[] => [...table(h).querySelectorAll("th[aria-sort]")].map((th) => `${th.querySelector("button")!.dataset.sortColumn}:${th.getAttribute("aria-sort")}`);
const showAll = (h: HTMLElement): HTMLButtonElement => [...h.querySelectorAll("button")].find((b) => /Show (all|fewer)/.test(b.textContent ?? "")) as HTMLButtonElement;

describe("the residual-peak table on the magnetic page: a click on a row", () => {
  it("opens zoomed on the fit window, in # order, showing the strongest rows, nothing highlighted", async () => {
    const h = await mount();
    const [lo, hi] = view(h);
    expect(lo).toBeCloseTo(2.92, 6);
    expect(hi).toBeCloseTo(4.08, 6);
    // The strongest six of 24: #3, #14 and #22 stand out, then the three highest of the rest; listed by #.
    expect(numbers(h)).toEqual([3, 14, 21, 22, 23, 24]);
    expect(picked(h)).toEqual([]);
    expect(band(h)).toBeNull();
  });

  it("highlights a peak that is in view and leaves the view exactly where it was", async () => {
    const h = await mount();
    const before = view(h);
    click(rowFor(h, 14)); // d = 3.4, inside 2.92…4.08
    expect(picked(h)).toEqual(["#14"]);
    expect(band(h)).not.toBeNull();
    expect(bandX(h)).toBeCloseTo(dOf(14), 6);
    expect(view(h)).toEqual(before);
  });

  it("pans a peak that is out of view to the nearest edge, keeping the zoom width", async () => {
    const h = await mount();
    const w0 = width(h);
    click(rowFor(h, 3)); // d = 5.6, right of the window
    const [lo, hi] = view(h);
    expect(picked(h)).toEqual(["#3"]);
    expect(hi - lo).toBeCloseTo(w0, 9);
    // Just enough: a tenth of the window inside the right edge, not centred.
    expect(dOf(3)).toBeCloseTo(hi - 0.1 * w0, 9);
    expect(bandX(h)).toBeCloseTo(dOf(3), 6);

    click(rowFor(h, 22)); // d = 1.6, left of the window now
    const [lo2, hi2] = view(h);
    expect(picked(h)).toEqual(["#22"]);
    expect(hi2 - lo2).toBeCloseTo(w0, 9);
    expect(dOf(22)).toBeCloseTo(lo2 + 0.1 * w0, 9);
    expect(bandX(h)).toBeCloseTo(dOf(22), 6);
    expect(lo).toBeGreaterThan(lo2);
  });

  it("clears on a second click on the row, and moves with a click on another", async () => {
    const h = await mount();
    click(rowFor(h, 14));
    expect(picked(h)).toEqual(["#14"]);
    click(rowFor(h, 21)); // d = 2.0: out of view on the left, the width kept
    expect(picked(h)).toEqual(["#21"]);
    expect(h.querySelectorAll("rect[data-highlight-band]")).toHaveLength(1);
    const after = view(h);
    click(rowFor(h, 21));
    expect(picked(h)).toEqual([]);
    expect(band(h)).toBeNull();
    // Clearing does not move the view either.
    expect(view(h)).toEqual(after);
  });

  it("takes Enter and Space on the row; a key on its check box stays the check box's", async () => {
    const h = await mount();
    const w0 = width(h);
    const row = rowFor(h, 14);
    expect(row.tabIndex).toBe(0);
    expect(key(row, " ")).toBe(true);
    expect(picked(h)).toEqual(["#14"]);
    expect(key(row, "Enter")).toBe(true);
    expect(picked(h)).toEqual([]);
    expect(key(row, "Enter")).toBe(true);
    expect(picked(h)).toEqual(["#14"]);
    // The check box: Space is its own (the browser toggles it), so the row is not touched.
    const box = rowFor(h, 21).querySelector("input[type='checkbox']")!;
    expect(key(box, " ")).toBe(false);
    expect(picked(h)).toEqual(["#14"]);
    // Other keys do nothing.
    expect(key(row, "a")).toBe(false);
    expect(width(h)).toBeCloseTo(w0, 9);
  });

  it("follows the plot's x unit: the same peak, marked at its place on the other axis", async () => {
    const h = await mount();
    click(rowFor(h, 14));
    expect(bandX(h)).toBeCloseTo(dOf(14), 6);
    await render("Q");
    // The plot is now in Q (its view reset to the fit window there); the pick is kept and drawn at its Q.
    expect(h.querySelector("svg[data-vmin]")!.textContent).toContain("Q (Å⁻¹)");
    expect(picked(h)).toEqual(["#14"]);
    expect(bandX(h)).toBeCloseTo((2 * Math.PI) / dOf(14), 6);
    const [lo, hi] = view(h);
    expect(lo).toBeCloseTo((2 * Math.PI) / 4.0 - 0.08 * ((2 * Math.PI) / 3.0 - (2 * Math.PI) / 4.0), 6);
    // An out-of-view peak is brought in the same way in this unit.
    const w = hi - lo;
    click(rowFor(h, 3)); // d = 5.6 → Q = 1.12, left of the window
    expect(width(h)).toBeCloseTo(w, 9);
    expect(bandX(h)).toBeCloseTo((2 * Math.PI) / dOf(3), 6);
  });
});

describe("the residual-peak table on the magnetic page: a click on a header", () => {
  it("sorts by that column, says which column and which way, and flips on the next click", async () => {
    const h = await mount();
    expect(sortedHeaders(h)).toEqual(["idx:ascending"]);
    click(header(h, "significance"));
    // The strongest first; the same six rows.
    expect(numbers(h)).toEqual([14, 3, 22, 24, 23, 21]);
    expect(sortedHeaders(h)).toEqual(["significance:descending"]);
    click(header(h, "significance"));
    expect(numbers(h)).toEqual([21, 23, 24, 22, 3, 14]);
    expect(sortedHeaders(h)).toEqual(["significance:ascending"]);
    // d: ascending is the smallest d first — the largest #.
    click(header(h, "d"));
    expect(numbers(h)).toEqual([24, 23, 22, 21, 14, 3]);
    expect(sortedHeaders(h)).toEqual(["d:ascending"]);
    click(header(h, "d"));
    expect(numbers(h)).toEqual([3, 14, 21, 22, 23, 24]);
    // The sort is said in words, in a polite status and beside the table.
    expect(sortNote(h)).toMatch(/^sorted by d descending/);
    expect([...h.querySelectorAll("[role='status']")].map((el) => el.textContent)).toContain("Peaks sorted by d descending");
    // The default order is one click away, and # is the column it sorts by.
    const reset = [...h.querySelectorAll("button")].find((b) => b.textContent === "default order")!;
    click(reset);
    expect(sortedHeaders(h)).toEqual(["idx:ascending"]);
    expect(numbers(h)).toEqual([3, 14, 21, 22, 23, 24]);
    expect(sortNote(h)).toBeNull();
  });

  it("puts the peaks in the search first on 'use', and every header is a button the keyboard can press", async () => {
    const h = await mount();
    for (const column of ["use", "idx", "d", "significance", "delta", "near"]) {
      const b = header(h, column);
      expect(b.type).toBe("button");
      expect(b.closest("th")!.getAttribute("scope")).toBe("col");
      expect(b.title).toMatch(/Click/);
    }
    // #3, #14 and #22 (≥ 5σ, off the nuclear positions) feed the search.
    click(header(h, "use"));
    expect(numbers(h).slice(0, 3)).toEqual([3, 14, 22]);
    expect(sortedHeaders(h)).toEqual(["use:descending"]);
    click(header(h, "use"));
    expect(numbers(h).slice(-3)).toEqual([3, 14, 22]);
  });

  it("changes which rows are listed only by Show all, never by the order", async () => {
    const h = await mount();
    for (const column of ["d", "delta", "near", "use", "significance", "idx"]) {
      click(header(h, column));
      expect([...numbers(h)].sort((a, b) => a - b), column).toEqual([3, 14, 21, 22, 23, 24]);
    }
    click(header(h, "d"));
    click(showAll(h));
    // All 24, the smallest d first.
    expect(numbers(h)).toEqual(Array.from({ length: 24 }, (_, i) => 24 - i));
    click(showAll(h));
    expect(numbers(h)).toEqual([24, 23, 22, 21, 14, 3]);
  });

  it("keeps the clicked peak in a collapsed table, wherever the order puts it", async () => {
    const h = await mount();
    click(header(h, "d"));
    click(showAll(h));
    click(rowFor(h, 8)); // d = 4.6, a weak peak
    click(showAll(h));
    // The six: the three in the search, the clicked #8, and the strongest two of the rest; smallest d first.
    expect(numbers(h)).toEqual([24, 23, 22, 14, 8, 3]);
    // Clicking another peak lets #8 go back to the strongest-first rule.
    click(rowFor(h, 3));
    expect(numbers(h)).toEqual([24, 23, 22, 21, 14, 3]);
  });

  it("keeps the order, and the highlighted peak, while the page re-renders with a fresh copy of the same peaks", async () => {
    const h = await mount();
    click(header(h, "significance"));
    click(rowFor(h, 14));
    await render("d", peaks.map((p) => ({ ...p })));
    expect(numbers(h)).toEqual([14, 3, 22, 24, 23, 21]);
    expect(sortedHeaders(h)).toEqual(["significance:descending"]);
    expect(picked(h)).toEqual(["#14"]);
  });
});
