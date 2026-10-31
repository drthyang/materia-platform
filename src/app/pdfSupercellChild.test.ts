import { describe, it, expect } from "vitest";
import { ComputeClient } from "@/workers/computeClient";
import type { PdfPattern } from "@/core/diffraction/types";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { applyParameters } from "@/core/workflow/apply";
import { ACTIVATION_KICK, pageView, pdfFit, pdfPage, withFit, withoutModes, withParameter, withPositionMode, withSupercellChild, workspaceOf, type PdfPageModel } from "@/app/pdfPage";
import { validateSnapshot } from "@/core/project/validate";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, srtio3, tiltedChild, tiltIsInvariant, type Glazer } from "@/testSupport/perovskiteTilts";

/**
 * A cell-multiplying child activated on the PDF page (withSupercellChild,
 * subgroup engine phases 3 and 4): cubic SrTiO₃ (Pm-3m) against a synthetic
 * G(r) of its a⁻a⁻a⁻ tilt (R-3c). The child is realised in its own hexagonal
 * cell and becomes the structure the page fits; its positions are modes by
 * parent irrep, the order parameter (the R irrep's one mode on O) leads, free
 * from the kick, and the fit reaches the tilt. ✕ clear returns to the parent.
 */

const PARENT = srtio3();
const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const lattice = supercellSubgroups(group, { maxIndex: 48 });

/** The R-3c class the tilt has, and the tilt's orientation in it. */
function tiltClass(): { cls: (typeof lattice.classes)[number]; g: Glazer; order: readonly [number, number, number] } {
  const g0 = GLAZER["a-a-a-"]!;
  for (const cls of lattice.classes.filter((c) => c.identity?.number === 167)) {
    const r = realiseChild(PARENT, group, cls.elements, cls.identity);
    for (const order of AXIS_ORDERS) for (const sg of TILT_SENSES) {
      const g: Glazer = { ...g0, phi: [g0.phi[0] * sg[0], g0.phi[1] * sg[1], g0.phi[2] * sg[2]] };
      if (tiltIsInvariant(r, g, order)) return { cls, g, order };
    }
  }
  throw new Error("no R-3c class for the tilt");
}

const { cls, g, order } = tiltClass();
const truth = tiltedChild(realiseChild(PARENT, group, cls.elements, cls.identity), g, 0.07, order);

function tiltPattern(): PdfPattern {
  const rGrid = makeRGrid(1.5, 10, 0.02);
  const gr = computeGofR(truth.cell, expandStructureAtoms(truth), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id: "tilt", name: "a-a-a-", scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: gr[i]! })), qdamp: 0.03 };
}

/** Only the rows given free. */
const freeOnly = (m: PdfPageModel, ids: readonly string[]): PdfPageModel => ({ ...m, params: m.params.map((p) => ({ ...p, fixed: !ids.includes(p.id) })) });

describe("a supercell child activated on the PDF page", () => {
  const page = pdfPage(PARENT, tiltPattern(), { preset: { fitRange: { min: 1.5, max: 10 } } });
  const { model, label, message } = withSupercellChild(page, { group, elements: cls.elements, identity: cls.identity! });
  const set = model.modes!.set;
  const lead = set.modes.find((mode) => mode.active)!;

  it("fits the child in its own cell: R-3c on hexagonal axes, its cell rows and its one mode by parent irrep, kicked", () => {
    expect(label).toBe("R -3 c:H #167");
    expect(message).toMatch(/^realised R -3 c:H #167 in its own cell: 3 child site\(s\), 30 atoms in the cell \(×6 the parent's\) · 1 mode\(s\) in 1 parent irrep\(s\) · the order parameter \(R irrep \d+ of 10\) free from 0\.05 Å/);
    const child = pageView(model).fitStructure;
    expect(child).toBe(set.parentized);
    expect(child.spaceGroup.number).toBe(167);
    expect(child.cell.gamma).toBe(120);
    expect(expandStructureAtoms(child)).toHaveLength(30);
    // The kicked row is O's x on 18e (x, 0, ¼): the tilt.
    const row = model.params.find((p) => p.id === lead.id)!;
    expect([row.value, row.fixed]).toEqual([ACTIVATION_KICK, false]);
    expect(lead.axes.map((a) => a.siteLabel)).toEqual(["O"]);
    // Named by the parent's irrep and site; the star is the parent's R point.
    expect(lead.label).toMatch(/^R irrep \d+ of 10 · O$/);
    expect(lead.star).toBe("R");
    expect(lead.irrep).toMatchObject({ parentSite: "O", k: [0.5, 0.5, 0.5], direction: "(a,a,a)" });
    // The parent and child basis a mode CIF records.
    expect(set.parent).toMatchObject({ number: 221, centring: 1 });
    // Two cell rows (a = b, c), the parent's one gone; the PDF rows carried by id.
    const cellRows = model.params.filter((p) => p.kind === "cellLength");
    expect(cellRows).toHaveLength(2);
    expect(model.params.find((p) => p.id === "pdfScale")!.value).toBe(page.params.find((p) => p.id === "pdfScale")!.value);
    // ISODISTORT's amplitudes: A_s over the primitive (rhombohedral) child cell, A_p over six parent cells.
    expect(set.amplitudeCells).toEqual({ child: 3, parent: 6 });
  });

  it("a Pnma child: every coordinate its sites allow as a mode by parent irrep, the two irreps that reach it kicked first", () => {
    // The a⁻b⁺a⁻ class with Sr free on its mirror: seven modes in five irreps.
    const pnma = lattice.classes.filter((c) => c.identity?.number === 62).map((c) => ({ c, r: realiseChild(PARENT, group, c.elements, c.identity) })).find(({ r }) => r.structure.sites.length === 4 && r.structure.sites.filter((x) => allowedPositionShifts(r.structure.spaceGroup.operations, x.position).dimension > 0).length === 3)!.c;
    const act = withSupercellChild(page, { group, elements: pnma.elements, identity: pnma.identity! });
    const child = act.model.modes!.set.parentized;
    const modes = act.model.modes!.set.modes;
    expect(act.label).toBe("P n m a #62");
    // Pnma is not polar: no rigid translation is projected out, so the modes span every free coordinate.
    const free = child.sites.reduce((n, site) => n + allowedPositionShifts(child.spaceGroup.operations, site.position).dimension, 0);
    expect(free).toBe(7);
    expect(modes).toHaveLength(free);
    expect(new Set(modes.map((mode) => mode.irrep!.label)).size).toBe(5);
    // The order parameter: one mode of each tilt irrep (an R and an M), leading, free, the kick ACTIVATION_KICK in all.
    const active = modes.filter((mode) => mode.active);
    expect(active.map((mode) => mode.star).sort()).toEqual(["M", "R"]);
    expect(modes.slice(0, 2).every((mode) => mode.active)).toBe(true);
    const kicks = act.model.params.filter((p) => p.kind === "positionShift" && !p.fixed).map((p) => p.value);
    expect(kicks).toHaveLength(2);
    expect(Math.hypot(...kicks)).toBeCloseTo(ACTIVATION_KICK, 12);
    expect(Math.abs(kicks[0]! - kicks[1]!)).toBeGreaterThan(1e-3);
    expect(act.message).toMatch(/· 7 mode\(s\) in 5 parent irrep\(s\) · the order parameter \([MR] irrep \d+ of 10 \+ [MR] irrep \d+ of 10\) free from 0\.05 Å/);
    for (const mode of modes) expect(mode.label).toMatch(/^(X|M|R) irrep \d+ of 10 · (Sr|Ti|O)( \d)?$/);
  });

  it("is saved with the project and reopens as it was: the child, every row, Rw", () => {
    const saved = JSON.parse(JSON.stringify(workspaceOf(model)));
    expect(() => validateSnapshot([PARENT], saved, "snapshot")).not.toThrow();
    const back = pdfPage(PARENT, model.pattern, { preset: model.preset, restore: saved });
    expect(back.modes?.parentName).toBe(label);
    expect(pageView(back).fitStructure.spaceGroup.number).toBe(167);
    expect(pageView(back).fitStructure.cell).toEqual(set.parentized.cell);
    const rows = (x: PdfPageModel) => x.params.map((p) => ({ id: p.id, value: p.value + 0, fixed: p.fixed }));
    expect(rows(back)).toEqual(rows(model));
    expect(pageView(back).rw).toBeCloseTo(pageView(model).rw, 9);
    // Still the child in its own cell: ✕ clear after reopening returns to the parent's rows too.
    expect(back.modes?.ownCell).toBe(true);
    expectParentRows(withoutModes(back), back.params.find((p) => p.id === "pdfScale")!.value);
  });

  it("refines from the kick to the tilt; ✕ clear returns to the parent", async () => {
    const client = new ComputeClient();
    const fit = await pdfFit(client, freeOnly(model, [lead.id, "pdfScale"]));
    expect(fit.result.agreement.rWeighted!).toBeLessThan(1e-6);
    const refined = applyParameters(set.parentized, set.bindings, fit.values).model;
    const o = refined.sites.find((s) => s.element === "O")!;
    const axis = allowedPositionShifts(refined.spaceGroup.operations, o.position).basis[0]!.findIndex((x) => Math.abs(x) > 0.5);
    const want = truth.sites.find((s) => s.element === "O")!.position[axis]!;
    // The tilt or its antiphase twin (x ↔ 1 − x about ½), which has the same G(r).
    expect(Math.min(Math.abs(o.position[axis]! - want), Math.abs(1 - o.position[axis]! - want))).toBeLessThan(1e-6);
    // Cleared from the refined child: the parent's own rows (its cubic a, not the
    // child's hexagonal one), the refined scale carried, and the parent's Rw at it.
    const fitted = withFit(freeOnly(model, [lead.id, "pdfScale"]), fit);
    expect(fitted.result).not.toBeNull();
    const back = withoutModes(fitted);
    expect(back.modes).toBeNull();
    expect(pageView(back).fitStructure).toBe(PARENT);
    expectParentRows(back, fitted.params.find((p) => p.id === "pdfScale")!.value);
  }, 120_000);

  it("Constrained atomic sets the child aside for the parent, and Irreps (modes) brings the child back, each in its own cell", () => {
    const atomic = withPositionMode(withParameter(model, "pdfScale", { value: 0.8 }), "atomic");
    expect(pageView(atomic).fitStructure).toBe(PARENT);
    expectParentRows(atomic, 0.8);
    const again = withPositionMode(atomic, "irreps");
    expect(pageView(again).fitStructure).toBe(set.parentized);
    const rowsOf = (x: PdfPageModel, kind: string) => x.params.filter((p) => p.kind === kind).map((p) => [p.id, p.value]);
    expect(rowsOf(again, "cellLength")).toEqual(rowsOf(model, "cellLength"));
    expect(rowsOf(again, "bIso")).toEqual(rowsOf(model, "bIso"));
    expect(again.params.find((p) => p.id === "pdfScale")!.value).toBe(0.8);
  });

  /** The parent's rows as the page had them before the activation, the setting-free scale at `scale`, and the parent's Rw there. */
  function expectParentRows(m: PdfPageModel, scale: number): void {
    const rows = (x: PdfPageModel) => x.params.filter((p) => p.id !== "pdfScale").map((p) => ({ id: p.id, value: p.value, fixed: p.fixed }));
    expect(rows(m)).toEqual(rows(page));
    expect(m.params.find((p) => p.id === "pdfScale")!.value).toBe(scale);
    expect(pageView(m).rw).toBeCloseTo(pageView(withParameter(page, "pdfScale", { value: scale })).rw, 12);
  }
});
