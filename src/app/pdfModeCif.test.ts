/**
 * The PDF page's modes by parent irrep beyond the activation (subgroup engine
 * phase 4, THY-35): the parent-CIF route on a supercell child
 * (withParentModes, decompose.ts) and the ISODISTORT mode CIF (modeCifOf,
 * withModeCif) — export from an activated child, read back on the parent's
 * page, ✕ clear back to the parent, saved and reopened.
 */
import { describe, it, expect } from "vitest";
import type { PdfPattern } from "@/core/diffraction/types";
import type { StructureModel } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { validateSnapshot } from "@/core/project/validate";
import { parseModeCif } from "@/parsers/modeCif";
import { modeCifOf, pageView, pdfPage, withModeCif, withoutModes, withParameter, withParentModes, withSupercellChild, workspaceOf, type PdfPageModel } from "@/app/pdfPage";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, srtio3, tiltIsInvariant, tiltedChild, type Glazer } from "@/testSupport/perovskiteTilts";

const PARENT = srtio3();
const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const lattice = supercellSubgroups(group, { maxIndex: 48 });

/** The R-3c class the a⁻a⁻a⁻ tilt keeps, and the tilted child. */
function tilt(): { cls: (typeof lattice.classes)[number]; truth: StructureModel } {
  const g0 = GLAZER["a-a-a-"]!;
  for (const cls of lattice.classes.filter((c) => c.identity?.number === 167)) {
    const r = realiseChild(PARENT, group, cls.elements, cls.identity);
    for (const order of AXIS_ORDERS) for (const sg of TILT_SENSES) {
      const g: Glazer = { ...g0, phi: [g0.phi[0] * sg[0], g0.phi[1] * sg[1], g0.phi[2] * sg[2]] };
      if (tiltIsInvariant(r, g, order)) return { cls, truth: tiltedChild(r, g, 0.07, order) };
    }
  }
  throw new Error("no R-3c class for the tilt");
}

const { cls, truth } = tilt();

function patternOf(s: StructureModel): PdfPattern {
  const rGrid = makeRGrid(1.5, 10, 0.02);
  const gr = computeGofR(s.cell, expandStructureAtoms(s), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id: "tilt", name: "a-a-a-", scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: gr[i]! })), qdamp: 0.03 };
}

const rows = (x: PdfPageModel) => x.params.map((p) => ({ id: p.id, label: p.label, value: p.value, fixed: p.fixed }));

describe("modes by parent irrep on the PDF page: the parent-CIF route and the mode CIF", () => {
  it("the parent-CIF route decomposes a loaded supercell child by parent irrep, the curve unchanged", () => {
    const loaded: StructureModel = { ...truth, id: "child", name: "tilted SrTiO3" };
    const page = pdfPage(loaded, patternOf(loaded), { preset: { fitRange: { min: 1.5, max: 10 } } });
    const { model, message } = withParentModes(page, PARENT, "SrTiO3 cubic");
    expect(message).toMatch(/^1 mode\(s\) by parent irrep \(R irrep \d+ of 10 carry the distortion\), total \|A\| = [0-9.]+ Å \(A_s [0-9.]+, A_p [0-9.]+\) · a′ = /);
    const set = model.modes!.set;
    expect(model.modes!.ownCell).toBeUndefined();
    expect(set.modes.map((m) => m.label)).toEqual([expect.stringMatching(/^R irrep \d+ of 10 · O$/)]);
    expect(Math.abs(set.modes[0]!.observedAmplitude / Math.sqrt(3))).toBeCloseTo(Math.sqrt(3) * 0.07 * PARENT.cell.a, 9);
    // Seeded to reproduce the child: the page's Rw is the per-coordinate page's.
    expect(pageView(model).rw).toBeCloseTo(pageView(page).rw, 12);
    // The parent and the basis are recorded, so the set exports as a mode CIF.
    expect(modeCifOf(model)).not.toBeNull();
  });

  it("export from an activated child, read back on the parent's page: the same child, rows and Rw; ✕ clear; saved and reopened", () => {
    const page = pdfPage(PARENT, patternOf(truth), { preset: { fitRange: { min: 1.5, max: 10 } } });
    const act = withSupercellChild(page, { group, elements: cls.elements, identity: cls.identity! });
    // As a refinement leaves it: the tilt amplitude, the cell and a B moved.
    const lead = act.model.modes!.set.modes[0]!.id;
    let refined = withParameter(act.model, lead, { value: 0.41 });
    for (const p of refined.params.filter((q) => q.kind === "cellLength" || q.kind === "bIso").slice(0, 2)) refined = withParameter(refined, p.id, { value: p.value * 1.002 });
    const out = modeCifOf(refined)!;
    expect(out.fileName).toMatch(/_modes\.cif$/);
    const parsed = parseModeCif(out.text, PARENT.id);
    const back = withModeCif(page, parsed, out.fileName);
    expect(back.message).toMatch(/^1 mode\(s\) from .* \(MATERIA\), total \|A\| = 0\.4100 Å .* · the child fitted in its own cell, ✕ clear returns to P m -3 m$/);
    expect(back.model.modes!.ownCell).toBe(true);
    // The same child: structure, mode rows (values, free state) and Rw.
    const before = pageView(refined);
    const after = pageView(back.model);
    expect(after.fitStructure.spaceGroup.operations.map((op) => op.xyz)).toEqual(before.fitStructure.spaceGroup.operations.map((op) => op.xyz));
    const modeRows = (x: PdfPageModel) => rows(x).filter((p) => p.id.startsWith("mode_"));
    expect(modeRows(back.model)).toEqual(modeRows(refined));
    expect(after.rw).toBeCloseTo(before.rw, 12);
    // ✕ clear: the parent's own rows.
    const cleared = withoutModes(back.model);
    expect(cleared.modes).toBeNull();
    expect(pageView(cleared).fitStructure).toBe(PARENT);
    expect(rows(cleared).filter((p) => p.id !== "pdfScale")).toEqual(rows(page).filter((p) => p.id !== "pdfScale"));
    // Saved and reopened: the imported child and its modes as they were.
    const saved = JSON.parse(JSON.stringify(workspaceOf(back.model)));
    expect(() => validateSnapshot([PARENT], saved, "snapshot")).not.toThrow();
    const reopened = pdfPage(PARENT, back.model.pattern, { preset: back.model.preset, restore: saved });
    expect(rows(reopened)).toEqual(rows(back.model));
    expect(pageView(reopened).rw).toBeCloseTo(after.rw, 12);
    expect(reopened.modes!.set.modes.map((m) => m.irrep)).toEqual(back.model.modes!.set.modes.map((m) => m.irrep));
  });

  it("refuses a mode CIF whose parent and child are both foreign to the loaded structure", () => {
    const page = pdfPage(PARENT, patternOf(truth), { preset: { fitRange: { min: 1.5, max: 10 } } });
    const act = withSupercellChild(page, { group, elements: cls.elements, identity: cls.identity! });
    const parsed = parseModeCif(modeCifOf(act.model)!.text, "x");
    const rutile: StructureModel = {
      id: "tio2",
      name: "rutile",
      cell: { a: 4.594, b: 4.594, c: 2.959, alpha: 90, beta: 90, gamma: 90 },
      spaceGroup: buildSpaceGroup(136),
      sites: [{ label: "Ti", element: "Ti", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.4 } }],
    };
    const other = pdfPage(rutile, patternOf(truth));
    const r = withModeCif(other, parsed, "child_modes.cif");
    expect(r.model).toBe(other);
    expect(r.message).toMatch(/its parent is P m -3 m #221 and its child R -3 c:H; the loaded structure is neither/);
  });
});
