/**
 * The displacive mode basis's dimension checked independently (THY-80 B2,
 * tier 1; the full coverage is the opt-in tier 2,
 * modeBasisDimension.tier2.test.ts; the method is in independentModeCount.ts).
 *
 * For every class of a few (parent, bound) pairs, with the parent's atoms
 * exactly on their Wyckoff positions: supercellModeBasis has one mode per free
 * coordinate of the child's Wyckoff positions, as moyo splits the parent's
 * orbits; each irrep carries m_Γ·n_Γ of them (character formula); the fields
 * are orthonormal and fixed by H; and irrepModeSet, the set the PDF page
 * refines, has the polar gauge's count (the free coordinates minus H's polar
 * directions, removed from the irreps the translations belong to).
 *
 * First the oracle's own pieces: the site-symmetry table, and moyo on the
 * parent structures alone (their atoms on the Wyckoff positions stated).
 * Then negative controls: a dropped mode, a field H does not fix and a field
 * of the wrong norm are each caught.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import type { SupercellModeBasis } from "@/core/crystal/irreps/supercellModes";
import { BOUNDS, initMoyo } from "@/core/crystal/irreps/validation/independentNaming";
import { MODE_PARENTS, checkModeBound, checkModes, freeFromSiteSymbol, gaugeGaps, modeFindings, parentWyckoff } from "@/core/crystal/irreps/validation/independentModeCount";

beforeAll(() => initMoyo());

describe("the oracle", () => {
  it("free coordinates from a site-symmetry symbol (ITA A, Table 2.2.13.1 point groups)", () => {
    const cases: Record<string, number> = {
      "1": 3, "-1": 0, "m": 2, "..m": 2, ".m.": 2, "m..": 2, "2": 1, ".2.": 1, "2..": 1, "2/m": 0, "2/m..": 0,
      "mm2": 1, "m2m": 1, "2mm.": 1, "m.m2": 1, "222": 0, "mmm": 0, "mmm.": 0,
      "3": 1, "3.": 1, "-3": 0, ".-3m": 0, "32": 0, ".32": 0, "3m": 1, ".3m": 1, "3m.": 1, "-3m": 0, "-3m.": 0,
      "4": 1, "-4": 0, "4/m": 0, "422": 0, "4mm": 1, "4m.m": 1, "-42m": 0, "-4m2": 0, "4/mmm": 0, "4/mm.m": 0,
      "6": 1, "-6": 0, "6/m": 0, "622": 0, "6mm": 1, "-6m2": 0, "6/mmm": 0,
      "23": 0, "m-3": 0, "432": 0, "-43m": 0, "m-3m": 0, "m-3.": 0,
    };
    for (const [s, n] of Object.entries(cases)) expect(freeFromSiteSymbol(s), s).toBe(n);
  });

  it("the parent structures: moyo finds each parent's group and its sites on the Wyckoff positions stated", () => {
    for (const [name, mp] of Object.entries(MODE_PARENTS)) {
      const w = parentWyckoff(mp);
      expect(w.number, name).toBe(mp.parent);
      expect(w.siteSymmetry, name).toEqual(mp.siteSymmetry);
    }
  });
});

describe("the check catches a wrong basis (negative controls)", () => {
  const mp = MODE_PARENTS["Pm-3m"]!;
  const P = BOUNDS["1x1x2"]!;
  const group = factorGroup(mp.structure.spaceGroup.operations, P);
  const classes = supercellSubgroups(group).classes;
  /** P4mm, c doubled: polar, three irreps (Γ and two at X), 8 modes. */
  const cls = classes.find((c) => c.identity?.number === 99 && c.order === 32)!;
  const label = "control";

  it("the unmodified class passes", () => {
    const r = checkModes(mp, group, cls, label);
    expect(r).toMatchObject({ expected: 8, polar: 1, engine: 8, engineGauged: 7 });
    expect(r.irreps).toHaveLength(3);
    expect(r.problems).toEqual([]);
  });
  it("a dropped mode is caught (dimension and irrep count)", () => {
    const drop = (b: SupercellModeBasis): SupercellModeBasis => {
      const last = b.modes.length - 1;
      return { ...b, modes: b.modes.slice(0, last), fields: b.fields.slice(0, last), irreps: b.irreps.map((ir) => ({ ...ir, modes: ir.modes.filter((i) => i !== last) })) };
    };
    const r = checkModes(mp, group, cls, label, { tamper: drop });
    expect(r.problems.some((p) => p.startsWith("dimension:"))).toBe(true);
    expect(r.problems.some((p) => p.startsWith("irrep "))).toBe(true);
  });
  it("a field H does not fix is caught", () => {
    const turn = (b: SupercellModeBasis): SupercellModeBasis => {
      // The first field replaced by a shift of one atom alone: H moves that atom onto others.
      const v = new Float64Array(b.fields[0]!.length);
      v[0] = 0.1;
      return { ...b, fields: [v, ...b.fields.slice(1)] };
    };
    const r = checkModes(mp, group, cls, label, { tamper: turn });
    expect(r.problems.some((p) => p.startsWith("H-invariance:"))).toBe(true);
  });
  it("a field of the wrong norm is caught", () => {
    const stretch = (b: SupercellModeBasis): SupercellModeBasis => ({ ...b, fields: [b.fields[0]!.map((x) => 1.1 * x), ...b.fields.slice(1)] });
    const r = checkModes(mp, group, cls, label, { tamper: stretch });
    expect(r.problems.some((p) => p.startsWith("orthonormality:"))).toBe(true);
  });
});

/** Fixed (parent, bound) pairs: about 15 s together. */
const TIER1: readonly (readonly [string, string])[] = [
  ["Pm-3m", "1x1x1"],
  ["Pm-3m", "1x1x2"],
  ["Fm-3m", "1x1x1"],
  ["R-3m", "1x1x1"],
  ["P6_3/mmc", "r3xr3x1"],
  ["Pnma", "1x1x2"],
  ["Cmcm", "1x1x1"],
  ["P2_1/c", "2x2x2"],
];

describe("every class: the mode basis has the dimension Wyckoff splitting gives", { timeout: 120_000 }, () => {
  for (const [parent, bound] of TIER1) {
    it(`${parent}, ${bound}`, () => {
      const r = checkModeBound(parent, bound, BOUNDS[bound]!);
      expect(r.note).toBeUndefined();
      expect(r.classes.length).toBe(r.listed);
      expect(r.listed).toBeGreaterThan(0);
      expect(modeFindings(r)).toEqual([]);
    });
  }

  it("the default gauge keeps every real mode where the per-site intersection is larger than H's translations", () => {
    // R-3m 1×1×1, P3₁21: every site allows c, H has no polar direction; both
    // gauges keep all 7 modes (the default kept 6 before 2026-11-26).
    const r = checkModeBound("R-3m", "1x1x1", BOUNDS["1x1x1"]!);
    const c = r.classes.find((x) => x.number === 152)!;
    expect(c).toMatchObject({ expected: 7, polar: 0, engine: 7, engineGauged: 7, defaultGauge: 7 });
    expect(gaugeGaps(r)).toEqual([]);
  });
});
