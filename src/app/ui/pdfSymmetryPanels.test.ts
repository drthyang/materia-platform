// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { pageView, pdfPage, withActivatedMode, withPositionMode, type ModesInForce, type PdfPageModel } from "@/app/pdfPage";
import { decomposeDisplacementRepresentation } from "@/core/crystal/displaciveModes";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { DistortionModesPanel } from "@/app/ui/DistortionModesPanel";
import { SubgroupsPanel, decentringIrrepTree, gammaIrrepTree, sameCellLattice } from "@/app/ui/SubgroupsPanel";

/**
 * The PDF page separates choosing the symmetry from inspecting the modes. The
 * Subgroups page is where the symmetry is lowered: one list of subgroups
 * (the k-point chips filter it), a row's detail, Activate, and ✕ clear. The
 * 3D Model view lists the modes
 * being refined (row click → green arrows), says where to choose them when
 * there are none, and holds Import ▾ (a mode CIF or a parent CIF) and
 * Mode CIF ↓. (Selecting, the chips, the detail and Activate: subgroupsPanel.dom.test.ts.)
 */

/** The GaTa₄Se₈ demo (F-43m) as the app opens it. */
function demoPage(): PdfPageModel {
  const demo = gata4se8PdfExample();
  return pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams } });
}

/** The demo with its first symmetry-breaking Γ mode activated, as the Subgroups page's Activate → does. */
function activated(): { model: PdfPageModel; label: string } {
  const m = demoPage();
  const branch = gammaIrrepTree(m.loaded)![0]!;
  const { model, label } = withActivatedMode(m, branch.term, branch.subgroups[0]!);
  expect(model).not.toBe(m);
  return { model, label };
}

const noop = (): void => undefined;

/** The Subgroups page as the workbench renders it (the trees computed only from the parent state). */
function subgroups(m: PdfPageModel, opts: { busy?: boolean; modes?: ModesInForce | null } = {}): string {
  const modes = opts.modes !== undefined ? opts.modes : m.modes;
  return renderToStaticMarkup(createElement(SubgroupsPanel, {
    spaceGroup: m.loaded.spaceGroup.hermannMauguin,
    lattice: structuralSubgroupLattice(m.loaded),
    irrepTree: modes === null ? gammaIrrepTree(m.loaded) : null,
    decentringTree: modes === null ? decentringIrrepTree(m.loaded) : null,
    sameCell: modes === null ? sameCellLattice(m.loaded) : [],
    operations: m.loaded.spaceGroup.operations,
    structure: m.loaded,
    onActivateSameCell: noop, onActivateSupercell: noop,
    modes,
    modeCount: pageView(m).modeSet?.modes.length ?? null,
    busy: opts.busy ?? false,
    onActivateMode: noop, onActivateSubgroup: noop, onClear: noop, onOpenModel: noop,
  }));
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The same page mounted, switched to the List (it opens on the Tree), as its markup; unmounted after. */
function subgroupsList(m: PdfPageModel): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(SubgroupsPanel, {
    spaceGroup: m.loaded.spaceGroup.hermannMauguin,
    lattice: structuralSubgroupLattice(m.loaded),
    irrepTree: gammaIrrepTree(m.loaded),
    decentringTree: decentringIrrepTree(m.loaded),
    sameCell: sameCellLattice(m.loaded),
    operations: m.loaded.spaceGroup.operations,
    structure: m.loaded,
    onActivateSameCell: noop, onActivateSupercell: noop,
    modes: null, modeCount: null, busy: false,
    onActivateMode: noop, onActivateSubgroup: noop, onClear: noop, onOpenModel: noop,
  })));
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "List")!.click());
  const html = host.innerHTML;
  act(() => root.unmount());
  host.remove();
  return html;
}

/** The 3D Model view's mode panel. */
function modesPanel(m: PdfPageModel, opts: { shownModeId?: string; ownModes?: boolean; loaders?: boolean; busy?: boolean } = {}): string {
  const v = pageView(m);
  return renderToStaticMarkup(createElement(DistortionModesPanel, {
    modeSet: v.modeSet, modes: m.modes, params: m.params, result: m.result,
    spaceGroup: m.loaded.spaceGroup.hermannMauguin,
    ownModes: opts.ownModes ?? (v.symModes?.modes.length ?? 0) > 0,
    arrows: opts.shownModeId ? { kind: "mode", id: opts.shownModeId } : null, onArrows: noop, onOpenSubgroups: noop,
    ...(opts.loaders ? { onLoadParentCif: noop, onLoadModeCif: noop } : {}),
    busy: opts.busy ?? false,
  }));
}

/** Every `<button>` whose text starts with `text`, as its opening tag. */
const buttons = (html: string, text: string): string[] => [...html.matchAll(new RegExp(`<button[^>]*>${text}`, "g"))].map((x) => x[0]);
/** The page's text, tags dropped. */
const textOf = (html: string): string => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");

describe("the Subgroups page", () => {
  it("opens on one short line of controls and the Tree: the supercell, the k-point chips, the subgroups high to low symmetry, the filters folded — and no CIF loader", () => {
    const m = demoPage();
    const out = subgroups(m);
    for (const gone of ["Load parent CIF", "Load mode CIF", "type=\"file\"", "By irrep", "By subgroup"]) expect(out).not.toContain(gone);
    const text = textOf(out);
    // The supercell, then how many subgroups the list keeps (the larger cells are worked out once it shows: subgroupsPanel.dom.test.ts).
    expect(text).toMatch(/^Supercell.*\d+ of \d+ subgroups so far · fit 2×2×2/);
    // The chips: any k, Γ and the decentring X (same cell), the bound's larger-cell stars.
    for (const name of ["any k-point", "Γ, same cell", "X, same cell", "W, supercell", "L, supercell"]) expect(out).toContain(`aria-label="${name}"`);
    // Cell, kind and index sit behind one folded "Filters".
    expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*>▸ Filters/);
    expect(text).not.toContain("Reached by");
    expect(text).not.toContain("Strain only");
    expect(text).toContain("ListTree");
    // The Tree first: the parent with its maximal steps, one plain line each, the tag not ISODISTORT's label; Find beside it.
    expect(out).toContain('aria-label="find a subgroup"');
    expect(text).toMatch(/▾F-43m· parent · 5 maximal steps/);
    expect(text).toContain("I-4m2 #119· same cell· 3 dom· 7 belowΓ·3");
    expect(text).toContain("P-43m #215· same cell· 4 dom· 3 belowX·1");
    expect(text).not.toMatch(/X5[+-]|R4\+/);
    // The List: a short list, the top index levels, then Show more and show all.
    const list = textOf(subgroupsList(m));
    expect(list).toMatch(/Show more: index [\d–]+ \(\+\d+\)show all \d+/);
    // Rows in one plain line, merged (×2), the tag not ISODISTORT's label; index headers from the top.
    expect(list.indexOf("index 2")).toBeLessThan(list.indexOf("index 4"));
    expect(list).toContain("P-42₁m #113· same cell· 12 domX·5×2");
    expect(list).toContain("P2₁3 #198· same cell· 8 domX·5");
    expect(list).not.toMatch(/X5[+-]|R4\+/);
    // Nothing chosen yet: the detail says what to do, and nothing is activated or in force.
    expect(text).toContain("Pick a subgroup: its cell, how you get there, then Activate.");
    expect(buttons(out, "Activate")).toEqual([]);
    expect(out).not.toContain("✕ clear");
    expect(out).not.toContain("▼ ");
  });

  it("drops the acoustic-only and the symmetry-conserving irreps from the tree", () => {
    const m = demoPage();
    const dec = decomposeDisplacementRepresentation(m.loaded);
    const tree = gammaIrrepTree(m.loaded)!;
    expect(tree.every(({ term }) => !term.trivial && term.multiplicity - term.acoustic > 0)).toBe(true);
    expect(tree.map(({ term }) => term.irrep.label)).toEqual(dec.terms.filter((t) => !t.trivial && t.multiplicity - t.acoustic > 0).map((t) => t.irrep.label));
  });

  it("shows an activated mode with ✕ clear and the way to the 3D Model; the list stays, to pick from once cleared", () => {
    const { model, label } = activated();
    const n = pageView(model).modeSet!.modes.length;
    const out = subgroups(model);
    expect(out).toContain(`▼ lowered to ${label}`);
    expect(out).toContain(`${n} distortion mode${n === 1 ? "" : "s"} in the Positions group`);
    expect(buttons(out, "✕ clear")).toHaveLength(1);
    expect(buttons(out, "3D Model →")).toHaveLength(1);
    expect(out).toContain("✕ clear returns to the parent");
    // The parent's subgroups are still listed (from the parent's state), with nothing to activate over the choice.
    expect(textOf(out)).toContain("I-4m2 #119· same cell· 3 dom");
    expect(buttons(out, "Activate")).toEqual([]);
  });

  it("names a parent-CIF decomposition, and a choice set aside by the atomic switch", () => {
    const { model } = activated();
    const fromCif: ModesInForce = { set: model.modes!.set, parentName: "GaTa4Se8 parent" };
    expect(subgroups(model, { modes: fromCif })).toContain("▼ decomposed against GaTa4Se8 parent");
    const atomic = withPositionMode(model, "atomic");
    expect(pageView(atomic).modeSet).toBeNull();
    const out = subgroups(atomic);
    expect(out).toContain("set aside while Positions is on “Constrained atomic”");
    expect(buttons(out, "✕ clear")).toHaveLength(1);
  });
});

describe("the 3D Model view's distortion modes", () => {
  it("lists the modes being refined, against the choice made on the Subgroups page, without the controls that make it", () => {
    const { model, label } = activated();
    const set = pageView(model).modeSet!;
    const out = modesPanel(model);
    expect(out).toContain("Distortion modes");
    expect(out).toContain(`vs ${label}`);
    expect(out).toContain("total |A| = ");
    for (const mode of set.modes) expect(out).toContain(mode.label);
    expect(out.match(/<tr title="Click to show\/hide this mode/g)).toHaveLength(set.modes.length);
    expect(buttons(out, "Subgroups →")).toHaveLength(1);
    for (const moved of ["✕ clear", "Activate", "By irrep"]) expect(out).not.toContain(moved);
    // A choice is in force: nothing to import over it.
    expect(modesPanel(model, { loaders: true })).not.toContain("Import ");
  });

  it("names the mode drawn as green arrows", () => {
    const { model } = activated();
    const mode = pageView(model).modeSet!.modes[0]!;
    expect(modesPanel(model, { shownModeId: mode.id })).toContain(`▸ green arrows: ${mode.label}`);
  });

  it("lists the structure's own symmetry-conserving Γ modes under Irreps (modes)", () => {
    const m = withPositionMode(demoPage(), "irreps");
    const set = pageView(m).modeSet!;
    const out = modesPanel(m);
    expect(out).toContain(`from ${m.loaded.spaceGroup.hermannMauguin}`);
    for (const mode of set.modes) expect(out).toContain(mode.label);
    if ((set.acousticExcluded ?? 0) > 0) expect(out).toContain(`${set.acousticExcluded} acoustic excluded`);
    // One line; the parent-CIF hint and the norm definitions sit behind its "?".
    expect(out).toContain("A: mode amplitude (Å), all start at 0 · free/fix in Positions · click a row to show it in");
    expect(out).toContain('aria-label="In full"');
    expect(out).not.toContain("✕ clear");
  });

  it("with no modes, says in one line that the symmetry is lowered on the Subgroups page", () => {
    const m = demoPage();
    expect(pageView(m).symModes!.modes.length).toBeGreaterThan(0);
    const out = modesPanel(m);
    expect(out).toContain("none active — the symmetry is lowered on the Subgroups page");
    expect(buttons(out, "Subgroups →")).toHaveLength(1);
    expect(out).toContain("or flip Positions → “Irreps (modes)”");
    expect(out).not.toContain("<table");
    for (const moved of ["Activate", "✕ clear"]) expect(out).not.toContain(moved);
    // No symmetry-conserving modes to flip to: no hint to flip.
    expect(modesPanel(m, { ownModes: false })).not.toContain("Irreps (modes)");
  });

  it("holds Import ▾ while no choice is in force, closed until opened, and waits while a fit runs", () => {
    const m = demoPage();
    const out = modesPanel(m, { loaders: true });
    expect(buttons(out, "Import ▾")).toHaveLength(1);
    expect(buttons(out, "Import ▾")[0]).toContain('aria-expanded="false"');
    expect(buttons(out, "Import ▾")[0]).not.toContain("disabled");
    // The two loaders open from it (subgroupsPanel.dom.test.ts clicks it).
    expect(out).not.toContain("Mode CIF (ISODISTORT)…");
    expect(buttons(modesPanel(m, { loaders: true, busy: true }), "Import ▾")[0]).toContain("disabled");
    // Under Irreps (modes), the structure's own modes listed: still no choice in force, so Import stays.
    expect(buttons(modesPanel(withPositionMode(m, "irreps"), { loaders: true }), "Import ▾")).toHaveLength(1);
    // Without the loaders wired, no menu.
    expect(modesPanel(m)).not.toContain("Import ");
  });

  it("names a choice set aside by the atomic switch", () => {
    const { model, label } = activated();
    const out = modesPanel(withPositionMode(model, "atomic"));
    expect(out).toContain(`vs ${label}, set aside while Positions is on “Constrained atomic”`);
    expect(out).not.toContain("<table");
  });
});
