/**
 * The Subgroups page's Phase-1 additions on the GaTa₄Se₈ demo (F-43m): the
 * decentring X irreps with their isotropy subgroups (the X chip), the
 * same-cell lattice's k- and general subgroups (By subgroup), the
 * cell-multiplying L and W chips, and both ways of lowering the symmetry to
 * P2₁3 in the parent's cell — the order parameter kicked, the modes by parent
 * irrep, and ISODISTORT's amplitudes in the report.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { ACTIVATION_KICK, pageView, pdfPage, reportInputOf, withActivatedMode, withSameCellSubgroup, type PdfPageModel } from "@/app/pdfPage";
import { SubgroupsPanel, decentringIrrepTree, gammaIrrepTree, sameCellLattice } from "@/app/ui/SubgroupsPanel";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { decentringRows, kChips } from "@/app/ui/subgroupPicker";

function demoPage(): PdfPageModel {
  const demo = gata4se8PdfExample();
  return pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams } });
}

const noop = (): void => undefined;

describe("the Subgroups page at the decentring k-points", () => {
  it("offers the X chip beside Γ as same cell, and L and W as supercell, the X irreps with their children", () => {
    const m = demoPage();
    const tree = decentringIrrepTree(m.loaded);
    const out = renderToStaticMarkup(createElement(SubgroupsPanel, {
      spaceGroup: m.loaded.spaceGroup.hermannMauguin,
      lattice: structuralSubgroupLattice(m.loaded),
      irrepTree: gammaIrrepTree(m.loaded),
      decentringTree: tree,
      sameCell: sameCellLattice(m.loaded),
      operations: m.loaded.spaceGroup.operations,
      onActivateSameCell: noop, onActivateSupercell: noop,
      modes: null, modeCount: null, busy: false,
      onActivateMode: noop, onActivateSubgroup: noop, onClear: noop, onOpenModel: noop,
      initialView: "irrep",
    })).replace(/<!-- -->/g, "");
    for (const name of ["Γ, same cell", "X, same cell", "L, supercell", "W, supercell"]) expect(out).toContain(`aria-label="${name}"`);
    // The X chip's rows: the decentring tree's, generic labels, each child in one line.
    const x = kChips(tree, null).find((c) => c.id === "X")!;
    const rows = decentringRows(tree, x);
    expect(rows.map((r) => r.label)).toContain("X irrep 5 of 5");
    const p213 = rows.find((r) => r.label === "X irrep 5 of 5")!.children.find((c) => c.name === "P 21 3 #198")!;
    expect(p213.facts).toBe("(a,a,a,-a,-a,-a) · same cell · 8 domains");
    expect(p213.action.kind).toBe("irrep");
    // The same-cell lattice (By subgroup): P-43m a decentring k-subgroup (index 4 = 1·4), P2₁3 a general one (8 = 2·4).
    const lattice = sameCellLattice(m.loaded);
    const k = lattice.find((n) => n.identity.number === 215)!;
    expect([k.kind, k.index.t, k.index.k]).toEqual(["k", 1, 4]);
    const g = lattice.find((n) => n.identity.number === 198)!;
    expect([g.kind, g.index.t, g.index.k]).toEqual(["general", 2, 4]);
  });

  it("activates the X irrep toward P2₁3 in the parent's cell: one mode free at the kick, the others by irrep, A_s and A_p in the report", () => {
    const m = demoPage();
    const branch = decentringIrrepTree(m.loaded).find((b) => b.term.irrep.dim === 6)!;
    const p213 = branch.subgroups.find((s) => s.identity.number === 198)!;
    const { model, label, message } = withActivatedMode(m, branch.term, p213);
    expect(label).toBe("X irrep 5 of 5 → P 21 3");
    expect(message).toMatch(/in the parent's cell: 7 child site\(s\) · 13 modes by parent irrep/);
    const set = pageView(model).modeSet!;
    expect(set.parentized.spaceGroup.operations).toHaveLength(12);
    // The conventional cell kept (the refined one: the activation starts from the fit's geometry).
    const cell = set.parentized.cell;
    expect([cell.b, cell.c, cell.alpha, cell.beta, cell.gamma]).toEqual([cell.a, cell.a, 90, 90, 90]);
    expect(model.params.filter((p) => p.value === ACTIVATION_KICK && !p.fixed)).toHaveLength(1);
    expect(set.modes.slice(1).every((x) => x.label.includes(" · "))).toBe(true);
    const report = reportInputOf(model).modes!;
    expect(report.cells).toEqual({ child: 1, parent: 4 });
    const lead = report.rows[0]!;
    expect([lead.a, lead.as, lead.ap]).toEqual([ACTIVATION_KICK, ACTIVATION_KICK, ACTIVATION_KICK / 2]);
  });

  it("lowers to P2₁3 picked from the lattice, with the order parameter from the X irrep", () => {
    const m = demoPage();
    const node = sameCellLattice(m.loaded).find((n) => n.identity.number === 198)!;
    const { model, message } = withSameCellSubgroup(m, node);
    expect(model).not.toBe(m);
    expect(message).toMatch(/the order parameter \(X irrep 5 of 5\) free from 0\.05 Å/);
    expect(pageView(model).modeSet!.parentized.sites).toHaveLength(7);
    expect(model.params.filter((p) => p.value === ACTIVATION_KICK && !p.fixed)).toHaveLength(1);
  });
});
