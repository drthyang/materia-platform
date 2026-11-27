import { describe, it, expect } from "vitest";
import type { PdfPattern } from "@/core/diffraction/types";
import type { StructureModel } from "@/core/crystal/types";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { pdfPage } from "@/app/pdfPage";
import { activationOf, listSubgroups, parseBound } from "@/app/pdfSubgroups";
import { parseCifWithSnaps } from "@/parsers/cif";
import { MN3GA_CIF } from "@/examples/mn3ga";
import { snapNote } from "@/app/snapNote";

/**
 * The bundled Mn₃Ga CIF prints Ga at (0.3333, 0.6667) and Mn's y = 2x to four
 * decimals. Read as printed, a cell-multiplying child could not be realised
 * on the PDF page (the supercell mode basis matches atoms at 1e-6); snapped on
 * load, Pnma in its 1×2×1 cell is lowered, and the load's notice says which
 * sites moved and by how much. The engine now also places each parent site
 * exactly (exactSitePosition), so the printed structure gives the same child.
 */
function pattern(s: StructureModel): PdfPattern {
  const rGrid = makeRGrid(1.5, 10, 0.02);
  const g = computeGofR(s.cell, expandStructureAtoms(s), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id: "p", name: "p", scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: g[i]! })), qdamp: 0.03 };
}

const { structure, snapped } = parseCifWithSnaps(MN3GA_CIF, "mn3ga");
/** The structure as the file prints it, before the snap. */
const printed: StructureModel = { ...structure, sites: structure.sites.map((s) => ({ ...s, position: snapped.find((x) => x.label === s.label)?.from ?? s.position })) };

async function pnma(s: StructureModel) {
  const listing = await listSubgroups(s, parseBound("1×2×1")!);
  const row = listing.rows.find((r) => r.name === "P n m a #62" && !r.sameCell);
  expect(row).toBeDefined();
  return activationOf(pdfPage(s, pattern(s), { preset: { fitRange: { min: 1.5, max: 10 } } }), row!.action);
}

describe("Mn₃Ga snapped on load", () => {
  it("snapped, Pnma in 1×2×1 is realised; as printed too, the same child: the engine places each parent site exactly (exactSitePosition)", async () => {
    expect(printed.sites.map((s) => s.position)).toEqual([[0.16393, 0.32775, 0.25], [0.3333, 0.6667, 0.75]]);
    const after = await pnma(structure);
    expect(after.message).toMatch(/^realised P n m a #62 in its own cell: \d+ child site\(s\), \d+ atoms in the cell \(×2 the parent's\)/);
    expect(after.model.modes).toBeDefined();
    // Before the engine placed parent sites exactly, the printed CIF failed here with "supercellModes: the
    // parent's operations do not map its atoms onto its atoms".
    const before = await pnma(printed);
    expect(before.message).toBe(after.message);
    expect(before.model.modes!.set.modes.map((m) => m.label)).toEqual(after.model.modes!.set.modes.map((m) => m.label));
  }, 240_000);

  it("the notice names the sites moved and by how much", () => {
    expect(snapNote(snapped, "mn3ga.cif")).toBe("Placed 2 sites exactly on their special positions (mn3ga.cif rounds them): Mn1 moved 0.00030 Å, Ga1 0.00031 Å.");
    expect(snapNote(snapped.slice(1))).toBe("Placed 1 site exactly on its special position (the file rounds it): Ga1 moved 0.00031 Å.");
    expect(snapNote([])).toBeNull();
    const many = Array.from({ length: 8 }, (_, i) => ({ ...snapped[0]!, label: `Mn${i + 1}` }));
    expect(snapNote(many)).toMatch(/: Mn1 moved 0\.00030 Å, Mn2 0\.00030 Å, .* Mn6 0\.00030 Å, and 2 more\.$/);
  });
});
