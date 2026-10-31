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
import { ACTIVATION_KICK, pageView, pdfFit, pdfPage, withoutModes, withSupercellChild, type PdfPageModel } from "@/app/pdfPage";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, srtio3, tiltedChild, tiltIsInvariant, type Glazer } from "@/testSupport/perovskiteTilts";

/**
 * A cell-multiplying child activated on the PDF page (withSupercellChild,
 * subgroup engine phase 3): cubic SrTiO₃ (Pm-3m) against a synthetic G(r) of
 * its a⁻a⁻a⁻ tilt (R-3c). The child is realised in its own hexagonal cell and
 * becomes the structure the page fits; its symmetry-breaking displacement
 * leads, free from the kick, and the fit reaches the tilt. ✕ clear returns to
 * the parent.
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

  it("fits the child in its own cell: R-3c on hexagonal axes, its cell rows and its displacement, kicked", () => {
    expect(label).toBe("R -3 c:H #167");
    expect(message).toMatch(/^realised R -3 c:H #167 in its own cell: 3 child site\(s\), 30 atoms in the cell \(×6 the parent's\) · 1 distortion mode\(s\) · the symmetry-breaking displacements free from 0\.05 Å/);
    const child = pageView(model).fitStructure;
    expect(child).toBe(set.parentized);
    expect(child.spaceGroup.number).toBe(167);
    expect(child.cell.gamma).toBe(120);
    expect(expandStructureAtoms(child)).toHaveLength(30);
    // The kicked row is O's x on 18e (x, 0, ¼): the tilt.
    const row = model.params.find((p) => p.id === lead.id)!;
    expect([row.value, row.fixed]).toEqual([ACTIVATION_KICK, false]);
    expect(lead.axes.map((a) => a.siteLabel)).toEqual(["O"]);
    expect(lead.label).toBe("R -3 c:H #167: symmetry-breaking displacements");
    // The child's own modes carry no k-point: "@ Γ" would read as the parent's Γ.
    for (const mode of set.modes) {
      expect(mode.star).toBeUndefined();
      expect(mode.label).not.toContain("Γ");
    }
    // Two cell rows (a = b, c), the parent's one gone; the PDF rows carried by id.
    const cellRows = model.params.filter((p) => p.kind === "cellLength");
    expect(cellRows).toHaveLength(2);
    expect(model.params.find((p) => p.id === "pdfScale")!.value).toBe(page.params.find((p) => p.id === "pdfScale")!.value);
    // ISODISTORT's amplitudes: A_s over the primitive (rhombohedral) child cell, A_p over six parent cells.
    expect(set.amplitudeCells).toEqual({ child: 3, parent: 6 });
  });

  it("a Pnma child: every coordinate its sites allow as a mode, the symmetry-breaking field leading, none labelled with a k-point", () => {
    const pnma = lattice.classes.find((c) => c.identity?.number === 62)!;
    const act = withSupercellChild(page, { group, elements: pnma.elements, identity: pnma.identity! });
    const child = act.model.modes!.set.parentized;
    const modes = act.model.modes!.set.modes;
    expect(act.label).toBe("P n m a #62");
    // Pnma is not polar: no rigid translation is projected out, so the modes span every free coordinate.
    const free = child.sites.reduce((n, site) => n + allowedPositionShifts(child.spaceGroup.operations, site.position).dimension, 0);
    expect(free).toBeGreaterThan(1);
    expect(modes).toHaveLength(free);
    expect(modes.filter((mode) => mode.active)).toHaveLength(1);
    expect(modes[0]!.active).toBe(true);
    for (const mode of modes) {
      expect(mode.star).toBeUndefined();
      expect(mode.label).not.toContain("Γ");
    }
    expect(act.model.params.filter((p) => p.kind === "positionShift" && !p.fixed).map((p) => p.value)).toEqual([ACTIVATION_KICK]);
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
    const back = withoutModes(model);
    expect(back.modes).toBeNull();
    expect(pageView(back).fitStructure).toBe(PARENT);
  }, 120_000);
});
