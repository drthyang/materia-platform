// @vitest-environment happy-dom
/**
 * The 3D Model's mode table in a DOM, on SrTiO₃ → Pnma: the k-point chips
 * and the parent-site chips filter the rows, a chip pressed again goes back to
 * all, and Free all / Fix all through the page's own row edit (withParameter,
 * as the Positions toggles do) give the very rows the per-row toggles give.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PdfPattern } from "@/core/diffraction/types";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { pageView, pdfPage, withParameter, withSupercellChild, type PdfPageModel } from "@/app/pdfPage";
import { DistortionModesPanel } from "@/app/ui/DistortionModesPanel";
import { srtio3 } from "@/testSupport/perovskiteTilts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PARENT = srtio3();
const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const lattice = supercellSubgroups(group, { maxIndex: 48 });
const pattern: PdfPattern = { id: "flat", name: "flat", scatteringType: "neutron", points: Array.from({ length: 60 }, (_, i) => ({ r: 1.5 + i * 0.1, gObs: 0 })), qdamp: 0.03 };
const page = pdfPage(PARENT, pattern, { preset: { fitRange: { min: 1.5, max: 7.4 } } });
const cls = lattice.classes.filter((c) => c.identity?.number === 62).map((c) => ({ c, r: realiseChild(PARENT, group, c.elements, c.identity) }))
  .find(({ r }) => r.structure.sites.length === 4 && r.structure.sites.filter((x) => allowedPositionShifts(r.structure.spaceGroup.operations, x.position).dimension > 0).length === 3)!.c;
const PNMA = withSupercellChild(page, { group, elements: cls.elements, identity: cls.identity! }).model;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** The panel over a live page model, its row edit the page's own (withParameter). */
function mount(start: PdfPageModel, shown: { id: string | null } = { id: null }): { host: HTMLDivElement; model: () => PdfPageModel } {
  let latest = start;
  function Host(): JSX.Element {
    const [m, setM] = useState(start);
    const [shownId, setShown] = useState<string | null>(shown.id);
    latest = m;
    shown.id = shownId;
    const v = pageView(m);
    return createElement(DistortionModesPanel, {
      modeSet: v.modeSet, modes: m.modes, params: m.params, result: m.result, spaceGroup: m.loaded.spaceGroup.hermannMauguin, ownModes: false,
      shownModeId: shownId, onShowMode: setShown, onOpenSubgroups: () => undefined,
      onParamChange: (id, patch) => setM((x) => withParameter(x, id, patch)),
    });
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Host)));
  return { host, model: () => latest };
}

const chip = (h: HTMLElement, group: string, name: string): HTMLButtonElement => {
  const b = h.querySelector<HTMLButtonElement>(`[role=group][aria-label="${group}"] button[aria-label="${name}"]`);
  if (!b) throw new Error(`no chip ${name} in ${group}`);
  return b;
};
const button = (h: ParentNode, text: string): HTMLButtonElement => [...h.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const modeRows = (h: HTMLElement): string[] => [...h.querySelectorAll<HTMLElement>('tr[title^="Click to show"]')].map((r) => r.querySelector("td")!.textContent!.replace(/^▸ /, ""));
const click = (b: HTMLElement): void => act(() => b.click());
const rows = (m: PdfPageModel) => m.params.map((p) => ({ id: p.id, value: p.value, fixed: p.fixed }));

describe("the mode table's chips", () => {
  const set = pageView(PNMA).modeSet!;
  const label = (pred: (m: (typeof set.modes)[number]) => boolean) => set.modes.filter(pred).map((m) => m.label);

  it("offers the child's k-points (X, M, R, each ×2) and its sites, and filters the rows by both", () => {
    const { host: h } = mount(PNMA);
    const ks = [...h.querySelectorAll('[role=group][aria-label="k-point"] button')].map((b) => b.getAttribute("aria-label"));
    expect(ks).toEqual(["all k-points", "X, supercell ×2", "M, supercell ×2", "R, supercell ×2"]);
    expect(chip(h, "k-point", "all k-points").getAttribute("aria-pressed")).toBe("true");
    const sites = [...h.querySelectorAll('[role=group][aria-label="parent site"] button')].map((b) => b.textContent);
    expect(sites[0]).toBe("all sites");
    expect(sites.slice(1).every((s) => ["Sr", "Ti", "O"].includes(s!))).toBe(true);
    expect(modeRows(h)).toEqual(label(() => true));
    click(chip(h, "k-point", "R, supercell ×2"));
    expect(modeRows(h)).toEqual(label((m) => m.star === "R"));
    click(chip(h, "parent site", "O"));
    expect(modeRows(h)).toEqual(label((m) => m.star === "R" && m.irrep!.parentSite === "O"));
    // The line under the chips: the result first.
    expect(h.textContent).toMatch(/R · O: total A_s [\d.]+ Å, A_p [\d.]+ Å · \d of \d free/);
    // Pressed again: back to all k.
    click(chip(h, "k-point", "R, supercell ×2"));
    expect(modeRows(h)).toEqual(label((m) => m.irrep!.parentSite === "O"));
  });

  for (const [what, k, site] of [["R on O", "R, supercell ×2", "O"], ["M", "M, supercell ×2", null], ["O", null, "O"]] as const) {
    it(`Free all then Fix all on ${what}: the rows the per-row toggles give`, () => {
      const { host: h, model } = mount(PNMA);
      if (k) click(chip(h, "k-point", k));
      if (site) click(chip(h, "parent site", site));
      const star = k ? k.split(",")[0] : null;
      const ids = set.modes.filter((m) => (!star || m.star === star) && (!site || m.irrep!.parentSite === site)).map((m) => m.id);
      expect(ids.length).toBeGreaterThan(0);
      click(button(h, "Free all"));
      const freed = ids.reduce((x, id) => withParameter(x, id, { fixed: false }), PNMA);
      expect(rows(model())).toEqual(rows(freed));
      // Every row of the group free: Free all has nothing left to do.
      expect(button(h, "Free all").disabled).toBe(true);
      click(button(h, "Fix all"));
      expect(rows(model())).toEqual(rows(ids.reduce((x, id) => withParameter(x, id, { fixed: true }), freed)));
    });
  }

  it("puts the arrows away when the chips hide the row drawn", () => {
    const first = set.modes.find((m) => m.star !== "R")!;
    const shown = { id: first.id as string | null };
    const { host: h } = mount(PNMA, shown);
    click(chip(h, "k-point", "R, supercell ×2"));
    expect(shown.id).toBeNull();
  });
});
