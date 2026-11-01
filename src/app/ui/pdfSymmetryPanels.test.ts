import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { pageView, pdfPage, withActivatedMode, withPositionMode, type ModesInForce, type PdfPageModel } from "@/app/pdfPage";
import { decomposeDisplacementRepresentation } from "@/core/crystal/displaciveModes";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { DistortionModesPanel } from "@/app/ui/DistortionModesPanel";
import { SubgroupsPanel, decentringIrrepTree, gammaIrrepTree, sameCellLattice } from "@/app/ui/SubgroupsPanel";

/**
 * The PDF page separates choosing the symmetry from inspecting the modes. The
 * Subgroups page is where the symmetry is lowered: one path, a k-point chip,
 * then a child, then Activate, and ✕ clear. The 3D Model view lists the modes
 * being refined (row click → green arrows), says where to choose them when
 * there are none, and holds Import ▾ (a mode CIF or a parent CIF) and
 * Mode CIF ↓. (The chips' interactions: subgroupsPanel.dom.test.ts.)
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

/** The Subgroups page as the workbench renders it (the trees computed only from the parent state), on its first view or By irrep. */
function subgroups(m: PdfPageModel, opts: { busy?: boolean; modes?: ModesInForce | null; view?: "subgroup" | "irrep" } = {}): string {
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
    ...(opts.view ? { initialView: opts.view } : {}),
  }));
}

/** The 3D Model view's mode panel. */
function modesPanel(m: PdfPageModel, opts: { shownModeId?: string; ownModes?: boolean; loaders?: boolean; busy?: boolean } = {}): string {
  const v = pageView(m);
  return renderToStaticMarkup(createElement(DistortionModesPanel, {
    modeSet: v.modeSet, modes: m.modes, params: m.params, result: m.result,
    spaceGroup: m.loaded.spaceGroup.hermannMauguin,
    ownModes: opts.ownModes ?? (v.symModes?.modes.length ?? 0) > 0,
    shownModeId: opts.shownModeId ?? null, onShowMode: noop, onOpenSubgroups: noop,
    ...(opts.loaders ? { onLoadParentCif: noop, onLoadModeCif: noop } : {}),
    busy: opts.busy ?? false,
  }));
}

/** Every `<button>` whose text starts with `text`, as its opening tag. */
const buttons = (html: string, text: string): string[] => [...html.matchAll(new RegExp(`<button[^>]*>${text}`, "g"))].map((x) => x[0]);
/** The page's text, tags dropped. */
const textOf = (html: string): string => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");

describe("the Subgroups page", () => {
  it("opens on By subgroup: the subgroups that keep the cell at once, each in one line with its cell, domains and irreps, and Activate — and no CIF loader", () => {
    const m = demoPage();
    const out = subgroups(m);
    for (const gone of ["Load parent CIF", "Load mode CIF", "type=\"file\""]) expect(out).not.toContain(gone);
    const text = textOf(out);
    // By subgroup first, then By irrep; the larger cells are worked out once the view shows (subgroupsPanel.dom.test.ts).
    expect(text.indexOf("By subgroup")).toBeLessThan(text.indexOf("By irrep"));
    expect(text).toMatch(/^By subgroupBy irrepSupercell.*\d+ subgroups keep the cell/);
    expect(text).toContain("index 4");
    expect(text).toContain("P -4 21 m #113same cell · 12 domains · X irrep 5 of 5 (0,0,a,-a,-a,a)");
    expect(text).toContain("P 21 3 #198same cell · 8 domains · X irrep 5 of 5 (a,a,a,-a,-a,-a)");
    expect(buttons(out, "Activate").length).toBeGreaterThan(40);
    expect(out).toContain('aria-label="Activate P 21 3 #198"');
    expect(out).not.toContain("✕ clear");
    expect(out).not.toContain("▼ ");
    // The k-point chips are By irrep's.
    expect(out).not.toContain('aria-label="Γ, same cell"');
  });

  it("offers By irrep: the Γ chip, its irreps and children, each with Activate", () => {
    const m = demoPage();
    const tree = gammaIrrepTree(m.loaded)!;
    expect(tree.length).toBeGreaterThan(0);
    const out = subgroups(m, { view: "irrep" });
    for (const gone of ["Load parent CIF", "Load mode CIF", "type=\"file\""]) expect(out).not.toContain(gone);
    expect(out).toContain("By irrep");
    expect(out).toContain("By subgroup");
    expect(textOf(out)).toContain("Pick a k-point, then a child, then Activate.");
    expect(out).toContain('aria-label="Γ, same cell"');
    expect(out).toContain('aria-pressed="true"');
    // Each irrep keeps its generic label, dimension and optic/acoustic counts.
    for (const { term } of tree) {
      const optic = term.multiplicity - term.acoustic;
      expect(textOf(out)).toContain(`${term.irrep.label}dim ${term.irrep.dim ?? 1} · ${optic} optic mode`);
    }
    // Three irreps or fewer open together; more, the first only.
    const open = tree.length <= 3 ? tree : tree.slice(0, 1);
    const activate = buttons(out, "Activate");
    expect(activate).toHaveLength(open.reduce((n, b) => n + b.subgroups.length, 0));
    expect(activate.filter((b) => b.includes("disabled"))).toEqual([]);
    // Nothing is in force, so there is nothing to clear.
    expect(out).not.toContain("✕ clear");
    expect(out).not.toContain("▼ ");
  });

  it("names each child of GaTa₄Se₈'s Γ irreps in one line: name, direction, cell, domains", () => {
    const out = textOf(subgroups(demoPage(), { view: "irrep" }));
    const tree = gammaIrrepTree(demoPage().loaded)!;
    const open = tree.length <= 3 ? tree : tree.slice(0, 1);
    for (const { subgroups: subs } of open) {
      for (const s of subs) expect(out).toContain(`${s.identity.hermannMauguin} #${s.identity.number}${s.direction} · same cell · ${s.domainStates} domains`);
    }
    // The long explanations sit behind "?": no paragraph of prose on the resting page.
    expect(out).not.toContain("Stokes & Hatch): the one-parameter directions first");
  });

  it("drops the acoustic-only and the symmetry-conserving irreps from the tree", () => {
    const m = demoPage();
    const dec = decomposeDisplacementRepresentation(m.loaded);
    const tree = gammaIrrepTree(m.loaded)!;
    expect(tree.every(({ term }) => !term.trivial && term.multiplicity - term.acoustic > 0)).toBe(true);
    expect(tree.map(({ term }) => term.irrep.label)).toEqual(dec.terms.filter((t) => !t.trivial && t.multiplicity - t.acoustic > 0).map((t) => t.irrep.label));
  });

  it("holds every activation while a fit runs, in both views", () => {
    for (const view of ["subgroup", "irrep"] as const) {
      const out = subgroups(demoPage(), { busy: true, view });
      expect(buttons(out, "Activate").length).toBeGreaterThan(0);
      expect(buttons(out, "Activate").every((b) => b.includes("disabled"))).toBe(true);
    }
  });

  it("shows an activated mode with ✕ clear and the way to the 3D Model, and only that until it is cleared", () => {
    const { model, label } = activated();
    const n = pageView(model).modeSet!.modes.length;
    const out = subgroups(model);
    expect(out).toContain(`▼ lowered to ${label}`);
    expect(out).toContain(`${n} distortion mode${n === 1 ? "" : "s"} in the Positions group`);
    expect(buttons(out, "✕ clear")).toHaveLength(1);
    expect(buttons(out, "3D Model →")).toHaveLength(1);
    expect(textOf(out)).toContain("Clear to pick another child.");
    for (const hidden of ["By irrep", "Activate", "same cell"]) expect(out).not.toContain(hidden);
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
