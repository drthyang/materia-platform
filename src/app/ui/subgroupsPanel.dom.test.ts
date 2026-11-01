// @vitest-environment happy-dom
/**
 * The Subgroups page in a DOM. By subgroup, its first view, lists the
 * same-cell subgroups at once and works out the larger cells after it shows:
 * "working…" with the bound held, a stop heard, one run at a time, and the
 * result kept for the next visit; Activate hands over each row's own action.
 * By irrep: the k-point chips are buttons with accessible names; a supercell
 * chip shows "working…" and holds every chip while its irreps are worked out,
 * and a repeat click starts no second run; only the children that fit the
 * bound are listed until "show larger cells"; Activate calls the handler with
 * the child's own data. Import ▾ on the 3D Model row opens the two loaders.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { SubgroupsPanel, gammaIrrepTree, sameCellLattice } from "@/app/ui/SubgroupsPanel";
import { ImportMenu } from "@/app/ui/DistortionModesPanel";
import * as picker from "@/app/ui/subgroupPicker";
import { PRESETS } from "@/app/ui/SupercellView";
import { srtio3 } from "@/testSupport/perovskiteTilts";

vi.mock("@/app/ui/subgroupPicker", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/app/ui/subgroupPicker")>();
  return { ...mod, supercellRows: vi.fn(mod.supercellRows), supercellListing: vi.fn(mod.supercellListing) };
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
const button = (h: HTMLElement, text: string): HTMLButtonElement | undefined => [...h.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const until = async (ok: () => boolean, ms = 200_000): Promise<void> => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
};

function panel(handlers: { onActivateMode?: () => void; onActivateSupercell?: () => void; onActivateSubgroup?: () => void } = {}, view?: "subgroup" | "irrep") {
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
    modes: null, modeCount: null, busy: false,
    onActivateMode: handlers.onActivateMode ?? (() => undefined),
    onActivateSubgroup: handlers.onActivateSubgroup ?? (() => undefined),
    onClear: () => undefined, onOpenModel: () => undefined,
    ...(view ? { initialView: view } : {}),
  });
}
const irrepView = (handlers: Parameters<typeof panel>[0] = {}) => panel(handlers, "irrep");
const select = (h: HTMLElement): HTMLSelectElement => h.querySelector<HTMLSelectElement>("select")!;
const text = (h: HTMLElement): string => h.textContent ?? "";
const ALL = "1426 subgroups fit the 2×2×2 cell";

describe("By subgroup in a DOM", () => {
  it("lists the same-cell subgroups at once, then works out the larger cells: working…, the bound held, a stop heard, one run", async () => {
    const listing = vi.mocked(picker.supercellListing);
    listing.mockClear();
    const h = mount(panel());
    expect(button(h, "By subgroup")).toBeDefined();
    expect(h.querySelector('[role=group][aria-label="k-point"]')).toBeNull();
    // The same-cell rows are there before any work is done.
    expect(h.querySelector('button[aria-label="Activate P 4 m m #99"]')).not.toBeNull();
    expect(text(h)).toContain("P 4 m m #99same cell · 6 domains · Γ irrep 10 of 10 (a,0,0)");
    await until(() => text(h).includes("working…"));
    expect(select(h).disabled).toBe(true);
    // Stop: heard at the next step; the bound free again, the rows kept.
    act(() => button(h, "stop")!.click());
    await until(() => text(h).includes("larger cells not worked out"));
    expect(select(h).disabled).toBe(false);
    expect(h.querySelector('button[aria-label="Activate P 4 m m #99"]')).not.toBeNull();
    expect(listing).not.toHaveBeenCalled();
    // On again, to the end: one listing.
    act(() => button(h, "work them out")!.click());
    await until(() => text(h).includes("working…"));
    await until(() => text(h).includes(ALL));
    expect(listing).toHaveBeenCalledTimes(1);
    expect(text(h)).not.toContain("working…");
    expect(select(h).disabled).toBe(false);
    expect(text(h)).toContain("R -3 c:H #1672×2×2 · 8 domains · R irrep 8 of 10 (a,a,a)");
    expect(text(h)).toContain("P n m a #622×2×2 · 24 domains · M irrep 3 of 10 (a,0,0) + R irrep 8 of 10 (a,a,0), coupled (or 7 other pairs)");
  });

  it("keeps the larger cells for the next visit, and Activate hands over each row's own action", async () => {
    const listing = vi.mocked(picker.supercellListing);
    listing.mockClear();
    const onMode = vi.fn();
    const onSupercell = vi.fn();
    const onSubgroup = vi.fn();
    const h = mount(panel({ onActivateMode: onMode, onActivateSupercell: onSupercell, onActivateSubgroup: onSubgroup }));
    await until(() => text(h).includes(ALL));
    expect(listing).not.toHaveBeenCalled();
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Activate P 4 m m #99"]')!.click());
    expect(onMode).toHaveBeenCalledTimes(1);
    expect(onMode.mock.calls[0]![1].identity.number).toBe(99);
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Activate P 4/m m m #123"]')!.click());
    expect(onSubgroup).toHaveBeenCalledTimes(1);
    expect(onSubgroup.mock.calls[0]![0].identity.number).toBe(123);
    const r3c = [...h.querySelectorAll<HTMLElement>("[data-row]")].find((r) => r.textContent?.includes("R irrep 8 of 10 (a,a,a)") && r.textContent.startsWith("R -3 c:H #167"))!;
    act(() => r3c.querySelector<HTMLButtonElement>('button[aria-label="Activate R -3 c:H #167"]')!.click());
    expect(onSupercell).toHaveBeenCalledTimes(1);
    const choice = onSupercell.mock.calls[0]![0];
    expect(choice.identity.number).toBe(167);
    expect(choice.primary).toBeDefined();
  });
});

describe("the k-point chips in a DOM", () => {
  it("are buttons named for the keyboard and screen readers, Γ chosen first", () => {
    const h = mount(irrepView());
    const chips = [...h.querySelectorAll<HTMLButtonElement>('[role=group][aria-label="k-point"] button')];
    expect(chips.map((b) => b.getAttribute("aria-label"))).toEqual(["Γ, same cell", "X, supercell", "M, supercell", "R, supercell"]);
    expect(chips.every((b) => b.tagName === "BUTTON" && b.tabIndex >= 0)).toBe(true);
    expect(chip(h, "Γ, same cell").getAttribute("aria-pressed")).toBe("true");
  });

  it("work out a supercell chip's irreps once: working… with every chip held, a repeat click ignored, then its irreps", async () => {
    const spy = vi.mocked(picker.supercellRows);
    spy.mockClear();
    const h = mount(irrepView());
    act(() => chip(h, "R, supercell").click());
    expect(chip(h, "R, supercell").textContent).toContain("working…");
    expect([...h.querySelectorAll<HTMLButtonElement>('[role=group][aria-label="k-point"] button')].every((b) => b.disabled)).toBe(true);
    // A repeat click on R, and a click on another chip, while it runs.
    act(() => {
      chip(h, "R, supercell").click();
      chip(h, "M, supercell").click();
    });
    await until(() => (h.textContent ?? "").includes("R irrep 1 of 10"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(chip(h, "R, supercell").getAttribute("aria-pressed")).toBe("true");
    expect(chip(h, "R, supercell").disabled).toBe(false);
    // Back to Γ and to R again: the irreps are kept, not worked out again.
    act(() => chip(h, "Γ, same cell").click());
    act(() => chip(h, "R, supercell").click());
    expect(h.textContent).toContain("R irrep 1 of 10");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("Activate on a supercell child hands over its choice; on a Γ child, its irrep and direction", async () => {
    const onSupercell = vi.fn();
    const onMode = vi.fn();
    const h = mount(irrepView({ onActivateSupercell: onSupercell, onActivateMode: onMode }));
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Activate P 4 m m #99"]')!.click());
    expect(onMode).toHaveBeenCalledTimes(1);
    expect(onMode.mock.calls[0]![1].identity.number).toBe(99);
    act(() => chip(h, "R, supercell").click());
    await until(() => (h.textContent ?? "").includes("R irrep 1 of 10"));
    // Open every irrep, then activate R-3c.
    for (let i = 0; i < 20; i++) {
      const closed = h.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      if (!closed) break;
      act(() => closed.click());
    }
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Activate R -3 c:H #167"]')!.click());
    expect(onSupercell).toHaveBeenCalledTimes(1);
    const choice = onSupercell.mock.calls[0]![0];
    expect(choice.identity.number).toBe(167);
    expect(choice.primary).toBeDefined();
  });

  it("lists only the children that fit the bound until asked for the larger cells: X of Pm-3m in 1×1×2", async () => {
    const h = mount(irrepView());
    act(() => {
      const sel = select(h);
      sel.value = String(PRESETS.findIndex((p) => p.label === "1×1×2"));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => chip(h, "X, supercell").click());
    await until(() => text(h).includes("X irrep 1 of 10"));
    for (let i = 0; i < 20; i++) {
      const closed = h.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      if (!closed) break;
      act(() => closed.click());
    }
    const activates = (): number => [...h.querySelectorAll("button")].filter((b) => b.textContent === "Activate").length;
    const fitting = activates();
    expect(fitting).toBeGreaterThan(0);
    expect(text(h)).toMatch(/larger than 1×1×2/);
    const toggle = [...h.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((x) => x.parentElement?.textContent?.includes("show larger cells"))!;
    act(() => toggle.click());
    expect(activates()).toBeGreaterThan(fitting);
    expect(text(h)).not.toMatch(/larger than 1×1×2/);
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
