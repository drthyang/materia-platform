// @vitest-environment happy-dom
/**
 * The Subgroups page in a DOM. Its one list shows the same-cell subgroups at
 * once and works out the larger cells after it shows (here on the main
 * thread: the DOM has no Web Worker, so the listing client steps the worker's
 * generator in place): a progress line with the supercell held, the rows
 * streaming in, a stop heard, one run at a time, the result kept for the next
 * visit. A row opens its detail (how you get here, the irreps, the variants,
 * the modes) and Activate hands over that row's own action; the k-point chips
 * and the folded filters filter the list; the tree expands one maximal step
 * at a time; on a narrow panel the detail is a full-screen sheet with Back.
 * Import ▾ on the 3D Model row opens the two loaders.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { SubgroupsPanel, gammaIrrepTree, sameCellLattice } from "@/app/ui/SubgroupsPanel";
import { ImportMenu } from "@/app/ui/DistortionModesPanel";
import * as listingSteps from "@/app/ui/supercellListing";
import { srtio3 } from "@/testSupport/perovskiteTilts";

vi.mock("@/app/ui/supercellListing", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/app/ui/supercellListing")>();
  return { ...mod, supercellListingSteps: vi.fn(mod.supercellListingSteps) };
});
// The 2×2×2 lattice and irreps of Pm-3m take seconds; more on a loaded CI runner.
vi.setConfig({ testTimeout: 240_000 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PARENT = srtio3();
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(el: ReturnType<typeof createElement>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

const chip = (h: HTMLElement, name: string): HTMLButtonElement => h.querySelector<HTMLButtonElement>(`[role=group][aria-label="k-point"] button[aria-label="${name}"]`)!;
const button = (h: ParentNode, text: string): HTMLButtonElement | undefined => [...h.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const until = async (ok: () => boolean, ms = 200_000): Promise<void> => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
};

type Handlers = { onActivateMode?: () => void; onActivateSupercell?: () => void; onActivateSubgroup?: () => void; busy?: boolean };
function panel(handlers: Handlers = {}) {
  return createElement(SubgroupsPanel, {
    spaceGroup: PARENT.spaceGroup.hermannMauguin,
    lattice: structuralSubgroupLattice(PARENT),
    irrepTree: gammaIrrepTree(PARENT),
    decentringTree: [],
    sameCell: sameCellLattice(PARENT),
    operations: PARENT.spaceGroup.operations,
    structure: PARENT,
    onActivateSameCell: () => undefined,
    onActivateSupercell: handlers.onActivateSupercell ?? (() => undefined),
    modes: null, modeCount: null, busy: handlers.busy ?? false,
    onActivateMode: handlers.onActivateMode ?? (() => undefined),
    onActivateSubgroup: handlers.onActivateSubgroup ?? (() => undefined),
    onClear: () => undefined, onOpenModel: () => undefined,
  });
}
const select = (h: HTMLElement): HTMLSelectElement => h.querySelector<HTMLSelectElement>("select")!;
const text = (h: ParentNode): string => h.textContent ?? "";
const rows = (h: HTMLElement): HTMLElement[] => [...h.querySelectorAll<HTMLElement>("[data-row]")];
const rowOf = (h: HTMLElement, key: string): HTMLElement | undefined => h.querySelector<HTMLElement>(`[data-row="${key}"]`) ?? undefined;
/** The default list of SrTiO₃ in 2×2×2: subgroups one irrep reaches, or two coupled, and the maximal ones, merged by name, cell and domains. */
const ALL = "444 of 559 subgroups · fit 2×2×2";
const PNMA = "P n m a #62|2×2×2|24";
const R3C = "R -3 c:H #167|2×2×2|8";
const P4MM = "P 4 m m #99|same cell|6";
const P4MMM = "P 4/m m m #123|same cell|3";
const pickRow = (h: HTMLElement, key: string): void => act(() => rowOf(h, key)!.click());
/** Activate in the detail (it runs once "working…" has painted). */
async function activate(h: HTMLElement, name: string): Promise<void> {
  act(() => h.querySelector<HTMLButtonElement>(`button[aria-label="Activate ${name}"]`)!.click());
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}

describe("the subgroup list in a DOM", () => {
  it("shows the same-cell subgroups at once, then works out the larger cells: a progress line, the supercell held, rows streaming in, a stop heard, one run", async () => {
    const listing = vi.mocked(listingSteps.supercellListingSteps);
    listing.mockClear();
    const h = mount(panel());
    for (const gone of ["By subgroup", "By irrep"]) expect(button(h, gone)).toBeUndefined();
    // The same-cell rows are there before any work is done, in one line each.
    expect(text(rowOf(h, P4MM)!)).toBe("P4mm #99· same cell· 6 domΓ·10");
    const sameCount = rows(h).length;
    expect(sameCount).toBeGreaterThan(10);
    await until(() => /listing 2×2×2 subgroups… \d+ %/.test(text(h)));
    expect(select(h).disabled).toBe(true);
    await until(() => rows(h).length > sameCount);
    expect(text(h)).toMatch(/listing 2×2×2 subgroups… \d+ % · \d+ larger so far/);
    expect(text(h)).toContain("so far · fit 2×2×2");
    // Stop: the run ends, the supercell free again, the same-cell rows kept and the partial ones dropped.
    act(() => button(h, "stop")!.click());
    await until(() => text(h).includes("larger cells not worked out"));
    expect(select(h).disabled).toBe(false);
    expect(rows(h)).toHaveLength(sameCount);
    expect(listing).toHaveBeenCalledTimes(1);
    act(() => button(h, "work them out")!.click());
    await until(() => text(h).includes("listing 2×2×2 subgroups…"));
    await until(() => text(h).includes(ALL));
    expect(listing).toHaveBeenCalledTimes(2);
    expect(rows(h)).toHaveLength(444);
    // The tilts: R-3c from the R irrep alone, a⁻b⁺a⁻ Pnma among four Pnma classes (×4), its tied pair on one tag.
    expect(text(rowOf(h, R3C)!)).toBe("R-3c:H #167· 2×2×2· 8 domR·8×2");
    expect(text(rowOf(h, PNMA)!)).toMatch(/^Pnma #62· 2×2×2· 24 domM·3\/5\+R·7×4$/);
  });

  it("keeps the larger cells for the next visit; a row opens its detail, and Activate hands over that row's own action", async () => {
    const listing = vi.mocked(listingSteps.supercellListingSteps);
    listing.mockClear();
    const onMode = vi.fn();
    const onSupercell = vi.fn();
    const onSubgroup = vi.fn();
    const h = mount(panel({ onActivateMode: onMode, onActivateSupercell: onSupercell, onActivateSubgroup: onSubgroup }));
    await until(() => text(h).includes(ALL));
    expect(listing).not.toHaveBeenCalled();
    expect(text(h)).toContain("Pick a subgroup");
    pickRow(h, P4MM);
    expect(text(h)).toContain("P4mm in the parent's cell, from one irrep: Γ irrep 10.");
    await activate(h, "P 4 m m #99");
    expect(onMode).toHaveBeenCalledTimes(1);
    expect(onMode.mock.calls[0]![1].identity.number).toBe(99);
    pickRow(h, P4MMM);
    expect(text(h)).toContain("strain only");
    // P4/mmm moves no atom of SrTiO₃ (Γ irrep 5 is strain): nothing to activate.
    const strain = h.querySelector<HTMLButtonElement>('button[aria-label="Activate P 4/m m m #123"]')!;
    expect(strain.disabled).toBe(true);
    expect(strain.textContent).toBe("Strain only: nothing to refine");
    pickRow(h, R3C);
    expect(text(h)).toContain("R-3c:H in a 2×2×2 cell, from one irrep: R irrep 8.");
    expect(text(h)).toContain("its own cell ×6, not drawn");
    await activate(h, "R -3 c:H #167");
    expect(onSupercell).toHaveBeenCalledTimes(1);
    expect(onSupercell.mock.calls[0]![0].identity.number).toBe(167);
    expect(onSupercell.mock.calls[0]![0].primary).toBeDefined();
  });

  it("Pnma's detail: the result first, how you get here one irrep per step, the coupled pair with its tie, the four variants each with its own Activate, the modes", async () => {
    const onSupercell = vi.fn();
    const h = mount(panel({ onActivateSupercell: onSupercell }));
    await until(() => text(h).includes(ALL));
    pickRow(h, PNMA);
    const detail = h.querySelector<HTMLElement>("[data-detail]")!;
    // The four classes, the a⁻b⁺a⁻ one (M irrep 3 or 5 + R irrep 8) among them.
    const variants = [...detail.querySelectorAll<HTMLElement>("[data-variant]")];
    expect(variants).toHaveLength(4);
    const tilt = variants.find((v) => v.textContent!.includes("M irrep 3 or 5 + R irrep 8"))!;
    act(() => tilt.querySelector<HTMLButtonElement>("button[aria-pressed]")!.click());
    const t = text(h.querySelector("[data-detail]")!);
    expect(t).toContain("Pnma in a 2×2×2 cell, from 2 irreps together: M irrep 3 or 5 and R irrep 8.");
    expect(t).toContain("Pm-3m→Imma(R irrep 8)→Pnma(+ M irrep 3 or 5)");
    expect(t).toContain("Pm-3m→P4/mbm(M irrep 3 or 5)→Pnma(+ R irrep 8)");
    expect(t).toMatch(/\d+ more ways/);
    expect(t).toContain("M irrep 3 or 5 (of 10)(a,0,0)alone → P4/mbm");
    expect(t).toContain("R irrep 8 of 10(a,a,0)alone → Imma");
    expect(t).toMatch(/every lattice step \(\d+\)/);
    expect(t).toContain("7 modes refine");
    // The literal lattice steps, on demand: each chain from the parent to Pnma.
    act(() => button(h, [...h.querySelectorAll("button")].find((b) => /every lattice step/.test(b.textContent ?? ""))!.textContent!.trim())!.click());
    const chains = [...h.querySelectorAll<HTMLElement>("[data-lattice-chain]")];
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.every((c) => c.dataset.latticeChain!.startsWith("p>") && c.textContent!.startsWith("Pm-3m→") && c.textContent!.endsWith("Pnma"))).toBe(true);
    // Activate: the variant's own choice, its coupled pair as the order parameter.
    await activate(h, "P n m a #62");
    expect(onSupercell).toHaveBeenCalledTimes(1);
    const choice = onSupercell.mock.calls[0]![0];
    expect(choice.identity.number).toBe(62);
    expect(choice.coupled).toHaveLength(2);
  });

  it("filters: a k-point chip keeps the subgroups its irreps reach, two chips their coupled pairs; the folded filters set how a subgroup is reached, its cell and index", async () => {
    const h = mount(panel());
    await until(() => text(h).includes(ALL));
    expect(h.querySelector('[role=group][aria-label="Filters"]')).toBeNull();
    act(() => chip(h, "R, supercell").click());
    expect(chip(h, "R, supercell").getAttribute("aria-pressed")).toBe("true");
    expect(rowOf(h, R3C)).toBeDefined();
    expect(rowOf(h, PNMA)).toBeUndefined();
    expect(rowOf(h, P4MM)).toBeUndefined();
    act(() => chip(h, "M, supercell").click());
    expect(text(rowOf(h, PNMA)!)).toContain("M·3/5+R·7");
    act(() => chip(h, "any k-point").click());
    expect(text(h)).toContain(ALL);
    // Filters: one irrep only drops the coupled Pnma; all lists every one of the 559.
    act(() => button(h, "▸ Filters")!.click());
    const filters = h.querySelector<HTMLElement>('[role=group][aria-label="Filters"]')!;
    act(() => button(filters, "one irrep")!.click());
    expect(rowOf(h, PNMA)).toBeUndefined();
    expect(rowOf(h, R3C)).toBeDefined();
    act(() => button(filters, "all 559")!.click());
    expect(text(h)).toContain("559 of 559 subgroups");
    act(() => button(filters, "same cell")!.click());
    expect(rows(h).every((r) => r.textContent!.includes("same cell"))).toBe(true);
    act(() => button(filters, "reset")!.click());
    expect(text(h)).toContain(ALL);
  });

  it("the tree: from the parent one maximal step at a time, a subgroup under two parents says so, those the filters leave out dimmed", async () => {
    const h = mount(panel());
    await until(() => text(h).includes(ALL));
    act(() => button(h, "Tree")!.click());
    const root = h.querySelector<HTMLElement>('[data-tree="p"]')!;
    expect(root.textContent).toMatch(/^▾Pm-3m· parent · \d+ maximal steps$/);
    const level1 = [...h.querySelectorAll<HTMLElement>("[data-tree]")].filter((n) => n.dataset.tree !== "p");
    expect(level1.length).toBeGreaterThan(5);
    const p4mmm = level1.find((n) => /^▸P4\/mmm #123· same cell/.test(n.textContent!))!;
    act(() => p4mmm.querySelector<HTMLElement>('[aria-label="expand"]')!.click());
    const level2 = [...h.querySelectorAll<HTMLElement>("[data-tree]")].length - level1.length - 1;
    expect(level2).toBeGreaterThan(5);
    expect(text(h)).toMatch(/also under/);
    // A node opens its detail like a row.
    const i4mcm = [...h.querySelectorAll<HTMLElement>("[data-tree] [data-row]")].find((n) => /^.I4\/mcm #140· 2×2×2/.test(n.textContent!))!;
    act(() => i4mcm.click());
    expect(text(h.querySelector("[data-detail]")!)).toContain("I4/mcm in a 2×2×2 cell");
    // The R chip: P4/mmm (Γ) stays in the tree, dimmed; I4/mcm (R irrep 8) does not dim.
    act(() => chip(h, "R, supercell").click());
    const rowIn = (re: RegExp): HTMLElement => [...h.querySelectorAll<HTMLElement>("[data-tree] [data-row]")].find((n) => re.test(n.textContent!))!;
    expect(rowIn(/^.P4\/mmm #123· same cell/).style.opacity).toBe("0.45");
    expect(rowIn(/^.I4\/mcm #140· 2×2×2/).style.opacity).toBe("1");
  });

  it("holds Activate while a fit runs", async () => {
    const h = mount(panel({ busy: true }));
    pickRow(h, P4MM);
    const b = h.querySelector<HTMLButtonElement>('button[aria-label="Activate P 4 m m #99"]')!;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe("A fit is running");
  });

  it("on a narrow panel a row opens its detail as a full-screen sheet, with Back", async () => {
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return { width: 390, height: 800, top: 0, left: 0, right: 390, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    try {
      const h = mount(panel());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      pickRow(h, P4MM);
      const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(sheet).not.toBeNull();
      expect(sheet.textContent).toContain("P4mm in the parent's cell");
      expect(sheet.querySelector('button[aria-label="Activate P 4 m m #99"]')).not.toBeNull();
      act(() => button(sheet, "‹ Back")!.click());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = real;
    }
  });
});

describe("Import ▾ on the 3D Model row", () => {
  it("opens the two loaders, each a file input for a CIF", () => {
    const h = mount(createElement(ImportMenu, { onLoadParentCif: () => undefined, onLoadModeCif: () => undefined }));
    expect(button(h, "Mode CIF (ISODISTORT)…")).toBeUndefined();
    act(() => button(h, "Import ▾")!.click());
    expect(button(h, "Mode CIF (ISODISTORT)…")).toBeDefined();
    expect(button(h, "Parent CIF (decompose this structure)…")).toBeDefined();
    const inputs = [...h.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    expect(inputs.map((i) => i.getAttribute("aria-label"))).toEqual(["mode CIF file", "parent CIF file"]);
    expect(inputs.every((i) => i.accept === ".cif,text/plain")).toBe(true);
  });
});
