import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { pageView, pdfPage, withActivatedMode, withPositionMode, type ModesInForce, type PdfPageModel } from "@/app/pdfPage";
import { decomposeDisplacementRepresentation } from "@/core/crystal/displaciveModes";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { DistortionModesPanel } from "@/app/ui/DistortionModesPanel";
import { SubgroupsPanel, gammaIrrepTree } from "@/app/ui/SubgroupsPanel";

/**
 * The PDF page separates choosing the symmetry from inspecting the modes. The
 * Subgroups page is where the symmetry is lowered: the parent CIF, the Γ irrep
 * tree with its Activate buttons, the subgroup lattice, and ✕ clear. The 3D
 * Model view lists the modes being refined (row click → green arrows) and,
 * with none, says where to choose them. Both once lived on the 3D view.
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

/** The Subgroups page as the workbench renders it (the irrep tree computed only from the parent state). */
function subgroups(m: PdfPageModel, opts: { busy?: boolean; modes?: ModesInForce | null } = {}): string {
  const modes = opts.modes !== undefined ? opts.modes : m.modes;
  return renderToStaticMarkup(createElement(SubgroupsPanel, {
    spaceGroup: m.loaded.spaceGroup.hermannMauguin,
    lattice: structuralSubgroupLattice(m.loaded),
    irrepTree: modes === null ? gammaIrrepTree(m.loaded) : null,
    modes,
    modeCount: pageView(m).modeSet?.modes.length ?? null,
    busy: opts.busy ?? false,
    onLoadParentCif: noop, onActivateMode: noop, onActivateSubgroup: noop, onClear: noop, onOpenModel: noop,
  }));
}

/** The 3D Model view's mode panel. */
function modesPanel(m: PdfPageModel, opts: { shownModeId?: string; ownModes?: boolean } = {}): string {
  const v = pageView(m);
  return renderToStaticMarkup(createElement(DistortionModesPanel, {
    modeSet: v.modeSet, modes: m.modes, params: m.params, result: m.result,
    spaceGroup: m.loaded.spaceGroup.hermannMauguin,
    ownModes: opts.ownModes ?? (v.symModes?.modes.length ?? 0) > 0,
    shownModeId: opts.shownModeId ?? null, onShowMode: noop, onOpenSubgroups: noop,
  }));
}

/** Every `<button>` whose text starts with `text`, as its opening tag; and the parent CIF's file input. */
const buttons = (html: string, text: string): string[] => [...html.matchAll(new RegExp(`<button[^>]*>${text}`, "g"))].map((x) => x[0]);
const fileInput = (html: string): string => html.match(/<input type="file"[^>]*>/)![0];

describe("the Subgroups page", () => {
  it("hosts the parent CIF, the Γ irrep tree with its Activate buttons and the subgroup lattice, from the parent's own symmetry", () => {
    const m = demoPage();
    const tree = gammaIrrepTree(m.loaded)!;
    expect(tree.length).toBeGreaterThan(0);
    const out = subgroups(m);
    expect(out).toContain("Load parent CIF…");
    expect(fileInput(out)).not.toContain("disabled");
    expect(out).toContain("Potential Γ modes · irreps");
    expect(out).toContain(`${m.loaded.spaceGroup.hermannMauguin} · ${tree.length} symmetry-breaking irrep`);
    // Each irrep keeps its label, dimension and optic/acoustic counts.
    for (const { term } of tree) {
      const optic = term.multiplicity - term.acoustic;
      expect(out).toContain(`${term.irrep.label} · dim ${term.irrep.dim ?? 1} · ${optic} optic mode`);
    }
    const activate = buttons(out, "Activate → ");
    expect(activate).toHaveLength(tree.reduce((n, b) => n + b.subgroups.length, 0));
    expect(activate.filter((b) => b.includes("disabled"))).toEqual([]);
    expect(out).toContain("Subgroup lattice");
    expect(buttons(out, "Activate ↓").length).toBeGreaterThan(0);
    expect(buttons(out, "Activate ↓").filter((b) => b.includes("disabled"))).toEqual([]);
    // Nothing is in force, so there is nothing to clear.
    expect(out).not.toContain("✕ clear");
    expect(out).not.toContain("▼ ");
  });

  it("lists every order-parameter direction of GaTa₄Se₈'s irreps, and its lattice with the F translations kept", () => {
    const out = subgroups(demoPage()).replace(/<!-- -->/g, "");
    // The polar T2's epikernels off the axes (R3m on ⟨111⟩, Imm2), the lower Cm, and the kernel P1.
    for (const name of ["R 3 m:H #160", "I m m 2 #44", "C 1 m 1 #8 · 2-dim", "P 1 #1 · general", "I -4 m 2 #119"]) {
      expect(out).toContain(`Activate → ${name}`);
    }
    // The lattice is F-43m's, named in standard settings: never a primitive name for a centred subgroup.
    expect(out).toContain("F -4 3 m");
    expect(out).not.toContain("P -4 3 m");
    expect(out).toContain("I -4 m 2");
    expect(out).toContain("4 orientations · 4 domain states"); // R3m: the four ⟨111⟩ axes, no ± pairs at index 4
    expect(out).toContain("· own cell");
  });

  it("drops the acoustic-only and the symmetry-conserving irreps from the tree", () => {
    const m = demoPage();
    const dec = decomposeDisplacementRepresentation(m.loaded);
    const tree = gammaIrrepTree(m.loaded)!;
    expect(tree.every(({ term }) => !term.trivial && term.multiplicity - term.acoustic > 0)).toBe(true);
    expect(tree.map(({ term }) => term.irrep.label)).toEqual(dec.terms.filter((t) => !t.trivial && t.multiplicity - t.acoustic > 0).map((t) => t.irrep.label));
  });

  it("holds every activation and the parent CIF while a fit runs", () => {
    const out = subgroups(demoPage(), { busy: true });
    for (const text of ["Activate → ", "Activate ↓"]) {
      expect(buttons(out, text).length).toBeGreaterThan(0);
      expect(buttons(out, text).every((b) => b.includes("disabled"))).toBe(true);
    }
    expect(fileInput(out)).toContain("disabled");
  });

  it("shows an activated mode with ✕ clear and the way to the 3D Model, and offers no other choice until it is cleared", () => {
    const { model, label } = activated();
    const n = pageView(model).modeSet!.modes.length;
    const out = subgroups(model);
    expect(out).toContain(`▼ lowered to ${label}`);
    expect(out).toContain(`${n} distortion mode${n === 1 ? "" : "s"} in the Positions group`);
    expect(buttons(out, "✕ clear")).toHaveLength(1);
    expect(buttons(out, "3D Model →")).toHaveLength(1);
    // The parent's irreps would not match the lowered setting: the tree waits for ✕ clear.
    expect(out).not.toContain("Activate → ");
    expect(out).toContain("✕ clear the active distortion first");
    expect(buttons(out, "Activate ↓").length).toBeGreaterThan(0);
    expect(buttons(out, "Activate ↓").every((b) => b.includes("disabled"))).toBe(true);
    expect(fileInput(out)).toContain("disabled");
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
    for (const moved of ["✕ clear", "Load parent CIF", "Activate", "Potential Γ modes"]) expect(out).not.toContain(moved);
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
    for (const moved of ["Load parent CIF", "Activate", "✕ clear"]) expect(out).not.toContain(moved);
    // No symmetry-conserving modes to flip to: no hint to flip.
    expect(modesPanel(m, { ownModes: false })).not.toContain("Irreps (modes)");
  });

  it("names a choice set aside by the atomic switch", () => {
    const { model, label } = activated();
    const out = modesPanel(withPositionMode(model, "atomic"));
    expect(out).toContain(`vs ${label}, set aside while Positions is on “Constrained atomic”`);
    expect(out).not.toContain("<table");
  });
});
