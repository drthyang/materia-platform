/**
 * Export ▾ → "For a MOTIF figure…" (forMotif.ts): the one standard file the
 * entry writes for each page state, and its "?" line.
 */
import { describe, it, expect } from "vitest";
import { FOR_MOTIF_LABEL, motifChoice } from "@/app/forMotif";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { modeCifOf, pdfPage, withSupercellChild } from "@/app/pdfPage";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { AXIS_ORDERS, GLAZER, srtio3, tiltIsInvariant } from "@/testSupport/perovskiteTilts";

describe("the file the MOTIF entry writes", () => {
  it("is the CIF for a nuclear page", () => {
    const c = motifChoice({ magnetic: false, modeChild: false });
    expect(c.kind).toBe("cif");
    expect(c.help).toBe("Writes the refined CIF; MOTIF opens it for a publication figure.");
  });

  it("is the mCIF with a magnetic model on", () => {
    const c = motifChoice({ magnetic: true, modeChild: false });
    expect(c.kind).toBe("mcif");
    expect(c.help).toBe("Writes the mCIF (magnetic space group; the magnetic cell for k ≠ 0); MOTIF opens it for a publication figure.");
  });

  it("is the mode CIF with a subgroup child in force", () => {
    const c = motifChoice({ magnetic: false, modeChild: true });
    expect(c.kind).toBe("modeCif");
    expect(c.help).toBe("Writes the ISODISTORT mode CIF of the subgroup child (atoms and mode displacements); MOTIF opens it for a publication figure.");
  });

  it("is the mCIF with both, and says the modes are left out", () => {
    const c = motifChoice({ magnetic: true, modeChild: true });
    expect(c.kind).toBe("mcif");
    expect(c.help).toMatch(/The mode displacements are left out/);
  });

  it("says what is left out: other phases, moments a page cannot write, an incommensurate modulation", () => {
    expect(motifChoice({ magnetic: false, modeChild: false, phases: 2 }).help).toMatch(/\. First phase only\.$/);
    const sc = motifChoice({ magnetic: false, modeChild: false, momentsNotExported: true });
    expect(sc.kind).toBe("cif");
    expect(sc.help).toMatch(/The moments are left out \(this page writes no mCIF\)\.$/);
    expect(motifChoice({ magnetic: true, modeChild: false, incommensurate: true }).help).toMatch(/The modulation is left out: k is incommensurate, so the parent cell holds the cosine amplitudes\.$/);
    // Without a magnetic model the incommensurate flag says nothing.
    expect(motifChoice({ magnetic: false, modeChild: false, incommensurate: true }).help).not.toMatch(/incommensurate/);
  });

  it("is one line, result first, and names no address", () => {
    for (const s of [{ magnetic: false, modeChild: false }, { magnetic: true, modeChild: true, phases: 3, incommensurate: true }, { magnetic: false, modeChild: true }]) {
      const { help } = motifChoice(s);
      expect(help.startsWith("Writes ")).toBe(true);
      expect(help).not.toMatch(/\n|https?:|www\./);
    }
    expect(FOR_MOTIF_LABEL).toBe("For a MOTIF figure…");
  });

  it("on the PDF page, follows the page: the CIF on the parent, the mode CIF once a supercell child is active", () => {
    const parent: StructureModel = srtio3();
    const group = factorGroup(parent.spaceGroup.operations, DEFAULT_SUPERCELL);
    // The R-3c class the a⁻a⁻a⁻ tilt keeps (as pdfModeCif.test.ts finds it).
    const cls = supercellSubgroups(group, { maxIndex: 48 }).classes
      .filter((c) => c.identity?.number === 167)
      .find((c) => AXIS_ORDERS.some((order) => tiltIsInvariant(realiseChild(parent, group, c.elements, c.identity), GLAZER["a-a-a-"]!, order)))!;
    const rGrid = makeRGrid(1.5, 10, 0.02);
    const gr = computeGofR(parent.cell, expandStructureAtoms(parent), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
    const pattern: PdfPattern = { id: "sto", name: "SrTiO3", scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: gr[i]! })), qdamp: 0.03 };
    const page = pdfPage(parent, pattern, { preset: { fitRange: { min: 1.5, max: 10 } } });
    // The state as the page reads it (PdfWorkbench: modeCifOf on the live model).
    expect(motifChoice({ magnetic: false, modeChild: modeCifOf(page) !== null }).kind).toBe("cif");
    const child = withSupercellChild(page, { group, elements: cls.elements, identity: cls.identity! }).model;
    expect(motifChoice({ magnetic: false, modeChild: modeCifOf(child) !== null }).kind).toBe("modeCif");
  });
});
