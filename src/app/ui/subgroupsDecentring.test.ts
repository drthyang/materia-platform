/**
 * The Subgroups page's Phase-1 additions on the GaTa₄Se₈ demo (F-43m): the
 * decentring X irreps with their isotropy subgroups, the same-cell lattice's
 * k- and general subgroups, the supercell note, and both ways of lowering the
 * symmetry to P2₁3 in the parent's cell — the order parameter kicked, the
 * modes by parent irrep, and ISODISTORT's amplitudes in the report.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { ACTIVATION_KICK, pageView, pdfPage, reportInputOf, withActivatedMode, withSameCellSubgroup, type PdfPageModel } from "@/app/pdfPage";
import { SubgroupsPanel, decentringIrrepTree, gammaIrrepTree, sameCellLattice, supercellPointsOf } from "@/app/ui/SubgroupsPanel";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";

function demoPage(): PdfPageModel {
  const demo = gata4se8PdfExample();
  return pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams } });
}

const noop = (): void => undefined;

describe("the Subgroups page at the decentring k-points", () => {
  it("lists the X irreps, the k- and general subgroups of the same cell, and names the points that need a supercell", () => {
    const m = demoPage();
    const out = renderToStaticMarkup(createElement(SubgroupsPanel, {
      spaceGroup: m.loaded.spaceGroup.hermannMauguin,
      lattice: structuralSubgroupLattice(m.loaded),
      irrepTree: gammaIrrepTree(m.loaded),
      decentringTree: decentringIrrepTree(m.loaded),
      sameCell: sameCellLattice(m.loaded),
      supercellNote: supercellPointsOf(m.loaded),
      onActivateSameCell: noop,
      modes: null, modeCount: null, busy: false,
      onLoadParentCif: noop, onActivateMode: noop, onActivateSubgroup: noop, onClear: noop, onOpenModel: noop,
    })).replace(/<!-- -->/g, "");
    const text = out.replace(/<[^>]+>/g, "");
    expect(out).toContain("Decentring modes · irreps (same cell)");
    expect(out).toContain("X irrep 5 of 5 · dim 6");
    expect(out).toContain("Activate → P 21 3 #198 · (a,a,a,-a,-a,-a)");
    // The lattice: P-43m a decentring k-subgroup (index 4 = 1·4), P2₁3 a general one (8 = 2·4).
    expect(text).toContain("P -4 3 m #215 · k · 1·4");
    expect(text).toContain("P 21 3 #198 · general · 2·4");
    expect(out).toContain("Cell-multiplying k-points (L and W) need a supercell (planned).");
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
