/**
 * A parent whose special positions carry CIF rounding (a coordinate 1e-6 off
 * its Wyckoff relation, as GaTa4Se8's Se at 0.384737, 0.884736, 0.884736 for
 * x+½, x, x with x = 0.8847365) is the same parent: the repo's orbit
 * convention (equivalentPositions, 1e-3) counts the site as special, so the
 * subgroup engine must realise and decompose its children as it does for the
 * exact coordinates. Before the fix every cell-multiplying child of such a
 * parent threw (supercellModes: "an atom of the parent's T″ cell is no atom
 * of the child's cell", or "has two atoms at one point of the T″ cell").
 */
import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import { exactSitePosition } from "@/core/crystal/specialPositions";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { displacementCharacters, supercellModeBasis } from "@/core/crystal/irreps/supercellModes";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";

const EXACT = gata4se8PdfExample().structure;
const ops = EXACT.spaceGroup.operations;
/** Every site with a free coordinate nudged 1e-6 along a, off its special position: CIF rounding. */
const ROUNDED: StructureModel = {
  ...EXACT,
  sites: EXACT.sites.map((s) => (s.position.some((c) => Math.abs(c * 4 - Math.round(c * 4)) > 1e-6) ? { ...s, position: [s.position[0] + 1e-6, s.position[1], s.position[2]] } : s)),
};
const group = factorGroup(ops, DEFAULT_SUPERCELL);
const lattice = supercellSubgroups(group, { maxIndex: 24 });

describe("a parent with rounded special positions", () => {
  it("puts a rounded coordinate back on its special position, and leaves exact ones alone", () => {
    // (x, x+½, x+½) of 16e: the nearest point of the special line, x the mean of 0.384737, 0.384736, 0.384736.
    const x = (0.384737 + 2 * 0.384736) / 3;
    exactSitePosition(ops, [0.384737, 0.884736, 0.884736]).forEach((c, i) => expect(c).toBeCloseTo(i === 0 ? x : x + 0.5, 12));
    for (const s of EXACT.sites) exactSitePosition(ops, s.position).forEach((c, i) => expect(c).toBeCloseTo(s.position[i]!, 12));
    expect(ROUNDED.sites.some((s, i) => s.position[0] !== EXACT.sites[i]!.position[0])).toBe(true);
  });

  it("carries the displacement representation (the listing's mode counts)", () => {
    expect(Array.from(displacementCharacters(ROUNDED, group))).toEqual(Array.from(displacementCharacters(EXACT, group)).map((x) => expect.closeTo(x, 9)));
  });

  it("realises P-42₁m in the 1×1×2 cell (THY-85) and its modes, as for the exact coordinates", () => {
    const classes = lattice.classes.filter((c) => c.identity?.number === 113 && c.index.t * c.index.k === 24);
    expect(classes.length).toBeGreaterThan(0);
    for (const cls of classes) {
      const exact = realiseChild(EXACT, group, cls.elements, cls.identity);
      const rounded = realiseChild(ROUNDED, group, cls.elements, cls.identity);
      expect(rounded.atoms).toHaveLength(exact.atoms.length);
      const a = supercellModeBasis(EXACT, group, cls.elements, exact, { arms: "bound" });
      const b = supercellModeBasis(ROUNDED, group, cls.elements, rounded, { arms: "bound" });
      expect(b.modes.map((m) => m.label)).toEqual(a.modes.map((m) => m.label));
    }
  });
});
