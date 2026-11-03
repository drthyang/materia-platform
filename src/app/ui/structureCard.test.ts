/**
 * The PDF page's Structure card (structureCardText): it names the structure the
 * page fits. At the parent's symmetry that is the loaded structure; with a
 * supercell child or a same-cell subgroup in force it is the child (name,
 * group, cell, sites) with a "child of …" note; ✕ clear, or the child set
 * aside on "Constrained atomic", returns it to the parent. A decomposition
 * against a parent CIF keeps the loaded structure: that is the one fitted.
 */
import { describe, expect, it } from "vitest";
import type { PdfPattern } from "@/core/diffraction/types";
import type { AtomSite, StructureModel } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { realizeSubgroup } from "@/core/crystal/isotropyTree";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { pageView, pdfPage, withoutModes, withParentModes, withPositionMode, withSubgroup, withSupercellChild, type PdfPageModel } from "@/app/pdfPage";
import { structureCardText } from "@/app/ui/structureCard";
import { srtio3 } from "@/testSupport/perovskiteTilts";

const card = (m: PdfPageModel) => {
  const v = pageView(m);
  return structureCardText(m.loaded, m.modes, v.modeSet, v.fitStructure);
};

/** Any G(r) on a grid: the card does not read the data. */
const flat: PdfPattern = { id: "flat", name: "flat", scatteringType: "neutron", points: Array.from({ length: 200 }, (_, i) => ({ r: 1.5 + i * 0.05, gObs: 0 })), qdamp: 0.03 };

describe("the Structure card on the PDF page", () => {
  const parent = srtio3();
  const page = pdfPage(parent, flat, { preset: { fitRange: { min: 1.5, max: 10 } } });

  it("names the loaded structure at the parent's symmetry", () => {
    expect(card(page)).toEqual({ title: `SrTiO3 · ${parent.spaceGroup.hermannMauguin}`, meta: "a 3.9050 · b 3.9050 · c 3.9050 Å · 3 sites", childOf: null });
  });

  const group = factorGroup(parent.spaceGroup.operations, DEFAULT_SUPERCELL);
  // The R-3c class whose child has a refinable displacement (the a⁻a⁻a⁻ tilt's; others pin every site).
  const child = supercellSubgroups(group, { maxIndex: 48 }).classes
    .filter((c) => c.identity?.number === 167)
    .map((c) => withSupercellChild(page, { group, elements: c.elements, identity: c.identity! }).model)
    .find((m) => m !== page)!;

  it("names the supercell child while it is fitted, with the parent in a note", () => {
    const c = card(child);
    const fitted = pageView(child).fitStructure;
    expect(fitted.spaceGroup.number).toBe(167);
    expect(c.title).toBe(`${fitted.name || "structure"} · ${fitted.spaceGroup.hermannMauguin}`);
    expect(c.title).toContain("R -3 c");
    // Its own hexagonal cell and sites, not the parent's.
    expect(c.meta).toBe(`a ${fitted.cell.a.toFixed(4)} · b ${fitted.cell.b.toFixed(4)} · c ${fitted.cell.c.toFixed(4)} Å · ${fitted.sites.length} sites`);
    expect(fitted.cell.c).toBeGreaterThan(10);
    expect(c.childOf).toBe(`child of SrTiO3 · ${parent.spaceGroup.hermannMauguin}`);
  });

  it("returns to the parent on ✕ clear", () => {
    expect(card(withoutModes(child))).toEqual(card(page));
  });

  it("returns to the parent while the child is set aside on “Constrained atomic”", () => {
    expect(card(withPositionMode(child, "atomic")).childOf).toBeNull();
  });

  it("names a same-cell subgroup child too", () => {
    const site = (label: string, element: string, position: [number, number, number]): AtomSite => ({ label, element, position, occupancy: 1, adp: { kind: "isotropic", bIso: 0.4 } });
    const bto: StructureModel = {
      id: "bto", name: "BaTiO3", cell: { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: buildSpaceGroup(221),
      sites: [site("Ba", "Ba", [0, 0, 0]), site("Ti", "Ti", [0.5, 0.5, 0.5]), site("O", "O", [0, 0.5, 0.5])],
    };
    const p4mm = structuralSubgroupLattice(bto).nodes.find((n) => n.identity.number === 99 && n.identity.method === "direct")!;
    const lowered = withSubgroup(pdfPage(bto, flat, { preset: { fitRange: { min: 1.5, max: 10 } } }), p4mm).model;
    const c = card(lowered);
    expect(c.title).toContain("P 4 m m");
    expect(c.childOf).toBe(`child of BaTiO3 · ${bto.spaceGroup.hermannMauguin}`);
    // A decomposition against a parent CIF: the loaded structure is the child and the one fitted.
    const child = realizeSubgroup(bto, p4mm.operations, p4mm.identity);
    const decomposed = withParentModes(pdfPage({ ...child, name: "BaTiO3 P4mm" }, flat, {}), bto, "BaTiO3").model;
    expect(decomposed.modes).not.toBeNull();
    expect(card(decomposed).childOf).toBeNull();
    expect(card(decomposed).title).toContain("BaTiO3 P4mm");
  });
});
