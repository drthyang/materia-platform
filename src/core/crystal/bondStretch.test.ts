/**
 * bondStretch: how much an irrep's displacements must stretch the shortest
 * bonds. SrTiO₃ in its 2×2×2 cube, the bonds Ti–O (1.95 Å; Sr–O, 2.76 Å, is
 * not within 10% of it): the octahedral tilts (R irrep 8 antiphase, M irrep 5
 * in phase) move O at right angles to its bonds, a rigid-unit mode, 0; the
 * Jahn–Teller-like R irrep 6 and M irrep 3 move O along them; R irrep 7 moves
 * Ti against its octahedron; M irrep 4 moves Sr, which no bond holds.
 *
 * The values by hand: K = Σ (ê·Δu)² over the bonds, each counted from both
 * ends; its mean per coordinate on the bonded atoms is 2·96 / (3·32) = 2 (48
 * Ti–O bonds, 8 Ti and 24 O). A unit displacement of O along its two bonds
 * changes both by its size: K = 2·2·u² = 4, a stretch of 2. Ti moved by a
 * unit along a cube axis stretches two of its six bonds by ±u: K = 2·2 = 4,
 * also 2. Sr alone: |u|²·2 / 2 = 1.
 */
import { describe, expect, it } from "vitest";
import { factorGroup, starsInBound, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { rnum } from "@/core/crystal/irreps/rational";
import { cachedIrrepsOfStar } from "@/core/crystal/irreps/supercellModes";
import { boundIrreps, type BoundIrrep } from "@/core/crystal/irreps/subgroupIrreps";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { bondStretch } from "@/core/crystal/bondStretch";
import { srtio3 } from "@/testSupport/perovskiteTilts";

const STO = srtio3();
const GROUP: FactorGroup = factorGroup(STO.spaceGroup.operations, DEFAULT_SUPERCELL);
const IRREPS: BoundIrrep[] = boundIrreps(GROUP, starsInBound(GROUP).map((k) => cachedIrrepsOfStar(GROUP, [rnum(k[0]), rnum(k[1]), rnum(k[2])])), { lazy: true });
const irrep = (label: string): BoundIrrep => IRREPS.find((b) => b.irrep.label === label)!;
/** An irrep's isotropy subgroup of the given ITA number along the given direction. */
const iso = (label: string, number: number, direction: string): readonly number[] =>
  irrep(label).subgroups.find((s) => s.identity.number === number && s.direction.symbol === direction)!.elements;
const stretch = bondStretch(STO, GROUP);
const of = (label: string, H: readonly number[]): number | null => stretch(irrep(label).irrep.characters, H);

describe("bondStretch on SrTiO₃, 2×2×2", () => {
  it("a⁰a⁰c⁻ I4/mcm: the R tilt stretches no bond, the Jahn–Teller-like R irrep 6 stretches O's two", () => {
    const tilt = iso("R irrep 8 of 10", 140, "(a,0,0)");
    expect(of("R irrep 8 of 10", tilt)).toBeLessThan(1e-9);
    const jt = iso("R irrep 6 of 10", 140, "(a,a)");
    expect(of("R irrep 6 of 10", jt)).toBeCloseTo(2, 9);
    // a⁻a⁻a⁻ R-3c and a⁻a⁻c⁰ Imma by the same tilt: rigid too.
    expect(of("R irrep 8 of 10", iso("R irrep 8 of 10", 167, "(a,a,a)"))).toBeLessThan(1e-9);
    expect(of("R irrep 8 of 10", iso("R irrep 8 of 10", 74, "(a,a,0)"))).toBeLessThan(1e-9);
  });

  it("a⁰a⁰c⁺ P4/mbm: the in-phase tilt (M irrep 5) is rigid, its tied twin (M irrep 3) is not", () => {
    expect(of("M irrep 5 of 10", iso("M irrep 5 of 10", 127, "(a,0,0)"))).toBeLessThan(1e-9);
    expect(of("M irrep 3 of 10", iso("M irrep 3 of 10", 127, "(a,0,0)"))).toBeCloseTo(2, 9);
  });

  it("Ti against its octahedron stretches its bonds; Sr, held by none, counts as one; an irrep on no atom has none", () => {
    expect(of("R irrep 7 of 10", iso("R irrep 7 of 10", 74, "(a,a,0)"))).toBeCloseTo(2, 9);
    expect(of("M irrep 4 of 10", iso("M irrep 4 of 10", 129, "(a,0,0)"))).toBeCloseTo(1, 9);
    expect(of("R irrep 9 of 10", iso("R irrep 9 of 10", 140, "(a,0,0)"))).toBeNull();
    // A subgroup that keeps none of the irrep's displacements: R irreps under every translation of the cube.
    expect(of("R irrep 8 of 10", GROUP.translations)).toBeNull();
  });

  it("rigid shifts are no distortion: the polar Γ irrep in P4mm keeps a rigid octahedron moving against Sr (0), never the shift itself", () => {
    const p4mm = iso("Γ irrep 10 of 10", 99, "(a,0,0)");
    // Its Γ irrep has four copies on the atoms (Sr, Ti, O twice) less the shift; the TiO₆ unit moving alone stretches nothing.
    expect(of("Γ irrep 10 of 10", p4mm)).toBeLessThan(1e-9);
    // In the cubic group itself (all of F) no displacement is kept.
    expect(of("Γ irrep 10 of 10", GROUP.elements.map((_, i) => i))).toBeNull();
  });
});
