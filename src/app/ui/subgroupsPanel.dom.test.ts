// @vitest-environment happy-dom
/**
 * The Subgroups page in a DOM: the k-point chips are buttons with accessible
 * names; a supercell chip shows "working…" and holds every chip while its
 * irreps are worked out, and a repeat click starts no second run; Activate
 * calls the handler with the child's own data; By subgroup lists the lattice;
 * and Import ▾ on the 3D Model row opens the two loaders.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { SubgroupsPanel, gammaIrrepTree, sameCellLattice } from "@/app/ui/SubgroupsPanel";
import { ImportMenu } from "@/app/ui/DistortionModesPanel";
import * as picker from "@/app/ui/subgroupPicker";
import { srtio3 } from "@/testSupport/perovskiteTilts";

vi.mock("@/app/ui/subgroupPicker", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/app/ui/subgroupPicker")>();
  return { ...mod, supercellRows: vi.fn(mod.supercellRows) };
});
vi.setConfig({ testTimeout: 60_000 });
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
const until = async (ok: () => boolean, ms = 30_000): Promise<void> => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
};

function panel(handlers: { onActivateMode?: () => void; onActivateSupercell?: () => void; onActivateSubgroup?: () => void } = {}) {
  return createElement(SubgroupsPanel, {
    spaceGroup: PARENT.spaceGroup.hermannMauguin,
    lattice: structuralSubgroupLattice(PARENT),
    irrepTree: gammaIrrepTree(PARENT),
    decentringTree: [],
    sameCell: sameCellLattice(PARENT),
    operations: PARENT.spaceGroup.operations,
    onActivateSameCell: () => undefined,
    onActivateSupercell: handlers.onActivateSupercell ?? (() => undefined),
    modes: null, modeCount: null, busy: false,
    onActivateMode: handlers.onActivateMode ?? (() => undefined),
    onActivateSubgroup: handlers.onActivateSubgroup ?? (() => undefined),
    onClear: () => undefined, onOpenModel: () => undefined,
  });
}

describe("the k-point chips in a DOM", () => {
  it("are buttons named for the keyboard and screen readers, Γ chosen first", () => {
    const h = mount(panel());
    const chips = [...h.querySelectorAll<HTMLButtonElement>('[role=group][aria-label="k-point"] button')];
    expect(chips.map((b) => b.getAttribute("aria-label"))).toEqual(["Γ, same cell", "X, supercell", "M, supercell", "R, supercell"]);
    expect(chips.every((b) => b.tagName === "BUTTON" && b.tabIndex >= 0)).toBe(true);
    expect(chip(h, "Γ, same cell").getAttribute("aria-pressed")).toBe("true");
  });

  it("work out a supercell chip's irreps once: working… with every chip held, a repeat click ignored, then its irreps", async () => {
    const spy = vi.mocked(picker.supercellRows);
    spy.mockClear();
    const h = mount(panel());
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
    const h = mount(panel({ onActivateSupercell: onSupercell, onActivateMode: onMode }));
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

  it("By subgroup lists the same-cell lattice, each with Activate", () => {
    const onSubgroup = vi.fn();
    const h = mount(panel({ onActivateSubgroup: onSubgroup }));
    act(() => button(h, "By subgroup")!.click());
    expect(h.textContent).toContain("Pick a subgroup, then Activate.");
    expect(h.querySelector('[role=group][aria-label="k-point"]')).toBeNull();
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Activate P 4/m m m #123"]')!.click());
    expect(onSubgroup).toHaveBeenCalledTimes(1);
    expect(button(h, "List supercell subgroups")).toBeDefined();
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
