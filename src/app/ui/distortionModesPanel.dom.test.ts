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
import { pageView, pdfPage, withParameter, withSameCellSubgroup, withSupercellChild, type PdfPageModel } from "@/app/pdfPage";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { sameCellLattice } from "@/app/ui/SubgroupsPanel";
import { DistortionModesPanel } from "@/app/ui/DistortionModesPanel";
import type { ModeArrows } from "@/app/ui/modeFold";
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
function mount(start: PdfPageModel, shown: { arrows: ModeArrows | null } = { arrows: null }, opts: { expand?: boolean } = {}): { host: HTMLDivElement; model: () => PdfPageModel; setModel: (m: PdfPageModel) => void } {
  let latest = start;
  let set: (m: PdfPageModel) => void = () => undefined;
  function Host(): JSX.Element {
    const [m, setM] = useState(start);
    const [arrows, setArrows] = useState<ModeArrows | null>(shown.arrows);
    latest = m;
    set = setM;
    shown.arrows = arrows;
    const v = pageView(m);
    return createElement(DistortionModesPanel, {
      modeSet: v.modeSet, modes: m.modes, params: m.params, result: m.result, spaceGroup: m.loaded.spaceGroup.hermannMauguin, ownModes: false,
      arrows, onArrows: setArrows, onOpenSubgroups: () => undefined,
      onParamChange: (id, patch) => setM((x) => withParameter(x, id, patch)),
    });
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Host)));
  // The irreps open on one row each; most tests read the per-site rows.
  if (opts.expand !== false) act(() => button(host!, "Expand all").click());
  return { host, model: () => latest, setModel: (m) => act(() => set(m)) };
}

const chip = (h: HTMLElement, group: string, name: string): HTMLButtonElement => {
  const b = h.querySelector<HTMLButtonElement>(`[role=group][aria-label="${group}"] button[aria-label="${name}"]`);
  if (!b) throw new Error(`no chip ${name} in ${group}`);
  return b;
};
const button = (h: ParentNode, text: string): HTMLButtonElement => [...h.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const modeRows = (h: HTMLElement): string[] => [...h.querySelectorAll<HTMLElement>('tr[title^="Click to show"]')].map((r) => r.querySelector("td")!.textContent!.replace(/^▸ /, ""));
const click = (b: HTMLElement): void => act(() => b.click());
const irrepRow = (h: HTMLElement, label: string): HTMLElement => {
  const r = [...h.querySelectorAll<HTMLElement>("tr[data-irrep]")].find((x) => x.dataset.irrep === label);
  if (!r) throw new Error(`no irrep row ${label}`);
  return r;
};
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
    // A site no R mode moves is off while R is chosen.
    for (const site of ["Sr", "Ti", "O"].filter((x) => set.modes.some((m) => m.irrep!.parentSite === x))) {
      expect(chip(h, "parent site", site).disabled, site).toBe(!set.modes.some((m) => m.star === "R" && m.irrep!.parentSite === site));
    }
    click(chip(h, "parent site", "O"));
    expect(modeRows(h)).toEqual(label((m) => m.star === "R" && m.irrep!.parentSite === "O"));
    // The line under the chips: the result first.
    expect(h.textContent).toMatch(/R · O: A_s [\d.]+ Å, A_p [\d.]+ Å · \d\/\d free/);
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
    const shown: { arrows: ModeArrows | null } = { arrows: { kind: "mode", id: first.id } };
    const { host: h } = mount(PNMA, shown);
    click(chip(h, "k-point", "R, supercell ×2"));
    expect(shown.arrows).toBeNull();
    // An irrep the chips hide goes the same way; All in 3D stays.
    click(chip(h, "k-point", "R, supercell ×2"));
    shown.arrows = null;
    click(irrepRow(h, first.irrep!.label));
    expect(shown.arrows).toEqual({ kind: "irrep", id: first.irrep!.label });
    click(chip(h, "k-point", "R, supercell ×2"));
    expect(shown.arrows).toBeNull();
    click(button(h, "All in 3D"));
    click(chip(h, "k-point", "R, supercell ×2"));
    expect(shown.arrows).toEqual({ kind: "all" });
  });
});

describe("the mode table folded by irrep", () => {
  const set = pageView(PNMA).modeSet!;
  const irreps = [...new Set(set.modes.map((m) => m.irrep!.label))];
  const irrepRows = (h: HTMLElement): string[] => [...h.querySelectorAll<HTMLElement>("tr[data-irrep]")].map((r) => r.dataset.irrep!);
  const disclosure = (h: HTMLElement, label: string): HTMLButtonElement => irrepRow(h, label).querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  const cells = (r: HTMLElement): string[] => [...r.querySelectorAll("td")].map((c) => c.textContent!);

  it("opens on one row per irrep: its total, its free count, and ▸ for its rows", () => {
    const { host: h } = mount(PNMA, undefined, { expand: false });
    expect(irrepRows(h)).toEqual(irreps);
    expect(modeRows(h)).toEqual([]);
    const first = set.modes.filter((m) => m.irrep!.label === irreps[0]);
    const a = Math.hypot(...first.map((m) => PNMA.params.find((p) => p.id === m.id)!.value));
    const row = cells(irrepRow(h, irreps[0]!));
    expect(row[0]).toContain(irreps[0]);
    expect(row[0]).toContain(first[0]!.irrep!.direction!);
    expect(row[1]).toBe(a.toFixed(5));
    const free = first.filter((m) => !PNMA.params.find((p) => p.id === m.id)!.fixed).length;
    expect(row[5]).toBe(`${free}/${first.length} free`);
    // ▸ opens that irrep only; ▾ folds it again.
    click(disclosure(h, irreps[0]!));
    expect(modeRows(h)).toEqual(first.map((m) => m.label));
    expect(disclosure(h, irreps[0]!).getAttribute("aria-expanded")).toBe("true");
    click(disclosure(h, irreps[0]!));
    expect(modeRows(h)).toEqual([]);
    // Expand all, then Collapse all.
    click(button(h, "Expand all"));
    expect(modeRows(h)).toEqual(irreps.flatMap((l) => set.modes.filter((m) => m.irrep!.label === l).map((m) => m.label)));
    click(button(h, "Collapse all"));
    expect(modeRows(h)).toEqual([]);
  });

  it("with a site chip, folds to that site's part of each irrep", () => {
    const { host: h } = mount(PNMA, undefined, { expand: false });
    click(chip(h, "parent site", "O"));
    const onO = [...new Set(set.modes.filter((m) => m.irrep!.parentSite === "O").map((m) => m.irrep!.label))];
    expect(irrepRows(h)).toEqual(onO);
    for (const l of onO) {
      const part = set.modes.filter((m) => m.irrep!.label === l && m.irrep!.parentSite === "O");
      const whole = set.modes.filter((m) => m.irrep!.label === l);
      const row = cells(irrepRow(h, l));
      expect(row[1]).toBe(Math.hypot(...part.map((m) => PNMA.params.find((p) => p.id === m.id)!.value)).toFixed(5));
      expect(row[0]!.includes("· O")).toBe(whole.length > part.length);
    }
  });

  for (const [what, k, site] of [["R on O", "R, supercell ×2", "O"], ["all", null, null]] as const) {
    it(`Free all / Fix all on ${what}, folded: the rows the per-row toggles give, and the folded free count follows`, () => {
      const { host: h, model } = mount(PNMA, undefined, { expand: false });
      if (k) click(chip(h, "k-point", k));
      if (site) click(chip(h, "parent site", site));
      const star = k ? k.split(",")[0] : null;
      const ids = set.modes.filter((m) => (!star || m.star === star) && (!site || m.irrep!.parentSite === site)).map((m) => m.id);
      click(button(h, "Free all"));
      const freed = ids.reduce((x, id) => withParameter(x, id, { fixed: false }), PNMA);
      expect(rows(model())).toEqual(rows(freed));
      for (const l of irrepRows(h)) expect(cells(irrepRow(h, l))[5]).toMatch(/^(\d+)\/\1 free$/);
      click(button(h, "Fix all"));
      expect(rows(model())).toEqual(rows(ids.reduce((x, id) => withParameter(x, id, { fixed: true }), freed)));
      for (const l of irrepRows(h)) expect(cells(irrepRow(h, l))[5]).toMatch(/^0\/\d+ free$/);
    });
  }

  it("draws an irrep at once from its row, every listed mode from All in 3D, and nothing after Arrows off", () => {
    const shown: { arrows: ModeArrows | null } = { arrows: null };
    const { host: h } = mount(PNMA, shown, { expand: false });
    // An irrep with a non-zero amplitude (the tilts the child is seeded with).
    const live = irreps.find((l) => set.modes.some((m) => m.irrep!.label === l && PNMA.params.find((p) => p.id === m.id)!.value !== 0))!;
    click(irrepRow(h, live));
    expect(shown.arrows).toEqual({ kind: "irrep", id: live });
    expect(h.textContent).toMatch(new RegExp(`▸ green arrows: ${live} · largest shift \\d\\.\\d{3} Å`));
    // Its ▸ only opens it; the arrows stay.
    click(disclosure(h, live));
    expect(shown.arrows).toEqual({ kind: "irrep", id: live });
    // A row at 0: nothing to draw, said so.
    const dead = irreps.find((l) => set.modes.every((m) => m.irrep!.label !== l || PNMA.params.find((p) => p.id === m.id)!.value === 0))!;
    click(irrepRow(h, dead));
    expect(h.textContent).toContain(`${dead}: every A is 0, nothing to draw yet — refine first`);
    click(button(h, "All in 3D"));
    expect(shown.arrows).toEqual({ kind: "all" });
    expect(h.textContent).toMatch(/▸ green arrows: all modes listed · largest shift/);
    click(button(h, "Arrows off"));
    expect(shown.arrows).toBeNull();
    expect(button(h, "Arrows off")).toBeUndefined();
  });

  it("charts each irrep's share, dominant first, the % summing to 100, and follows a refine", () => {
    const { host: h, setModel } = mount(PNMA, undefined, { expand: false });
    const bars = (): { label: string; pct: number }[] => [...h.querySelectorAll<HTMLButtonElement>('[aria-label^="share of the distortion"] [role=listitem] > button')]
      .map((b) => { const [label, pct] = b.getAttribute("aria-label")!.split(": "); return { label: label!, pct: parseFloat(pct!) }; });
    const before = bars();
    expect(before.map((b) => b.label).sort()).toEqual([...irreps].sort());
    expect(before.reduce((s, b) => s + b.pct, 0)).toBeCloseTo(100, 0);
    for (let i = 1; i < before.length; i++) expect(before[i - 1]!.pct).toBeGreaterThanOrEqual(before[i]!.pct);
    expect(h.textContent).toContain(`${before[0]!.label} carries ${before[0]!.pct}`);
    // A refine moves the amplitudes: the chart follows (here the last irrep becomes the dominant one).
    const last = irreps[irreps.length - 1]!;
    const bumped = set.modes.filter((m) => m.irrep!.label === last).reduce((x, m) => withParameter(x, m.id, { value: 1 }), PNMA);
    setModel(bumped);
    expect(bars()[0]!.label).toBe(last);
    // A bar click draws that irrep, as its row does.
    const shownBar = h.querySelector<HTMLButtonElement>(`[role=listitem] > button[aria-label^="${last}:"]`)!;
    click(shownBar);
    expect(shownBar.getAttribute("aria-pressed")).toBe("true");
    // An irrep opened shows its split by site under its bar.
    const multi = irreps.find((l) => set.modes.filter((m) => m.irrep!.label === l).length > 1)!;
    const listItem = (l: string) => h.querySelector<HTMLButtonElement>(`[role=listitem] > button[aria-label^="${l}:"]`)!.parentElement!;
    expect(listItem(multi).children.length).toBe(1);
    click(disclosure(h, multi));
    expect(listItem(multi).children.length).toBe(1 + set.modes.filter((m) => m.irrep!.label === multi).length);
  });
});

describe("a same-cell activation, folded by the irreps its labels name", () => {
  it("GaTa₄Se₈ → P-42₁m: one row per irrep, the order parameter on its own, every row behind them", () => {
    const demo = gata4se8PdfExample();
    const start = pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams } });
    const node = sameCellLattice(start.loaded).find((n) => n.identity.number === 113)!;
    const { model } = withSameCellSubgroup(start, node);
    const set = pageView(model).modeSet!;
    expect(set.modes.some((m) => m.irrep)).toBe(false);
    const { host: h } = mount(model, undefined, { expand: false });
    const folded = [...h.querySelectorAll<HTMLElement>("tr[data-irrep]")].map((r) => r.dataset.irrep!);
    const named = [...new Set(set.modes.map((m) => (m.label.includes(" · ") ? m.label.slice(0, m.label.indexOf(" · ")) : m.label)))];
    expect(folded).toEqual(named);
    expect(folded.length).toBeLessThan(set.modes.length);
    expect(folded.some((l) => l.includes("→"))).toBe(true);
    expect(modeRows(h)).toEqual([]);
    click(button(h, "Expand all"));
    expect(modeRows(h).sort()).toEqual(set.modes.map((m) => m.label).sort());
  });
});
