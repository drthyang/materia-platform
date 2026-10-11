import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseCif } from "@/parsers/cif";
import type { AtomSite, RidingRule, StructureModel } from "@/core/crystal/types";
import { applyRiding, ridingRules, shelxDistance, withTorsions } from "@/core/crystal/riding";
import { hydrogenFragment } from "@/testSupport/scPages";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { EIGHT_PI_SQUARED, uEquivalent } from "@/core/crystal/adp";
import { mulVec } from "@/core/math/mat3";
import { applyParameters } from "@/core/workflow/apply";

const P1_CELL = parseCif(`data_f
_cell_length_a 10
_cell_length_b 10
_cell_length_c 10
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
X1 C 0.5 0.5 0.5 0.02
`, "f");

/** An sp² C–H in a cubic P1 cell of 10 Å: C1 with two ring neighbours at 0° and 120°, H1 placed off the bisector. */
function fragment(): StructureModel {
  const at = (x: number, y: number): [number, number, number] => [0.5 + x / 10, 0.5 + y / 10, 0.5];
  const deg = Math.PI / 180;
  const site = (label: string, element: string, position: [number, number, number], adp: AtomSite["adp"]): AtomSite => ({ label, element, position, occupancy: 1, adp });
  return {
    ...P1_CELL,
    sites: [
      site("C1", "C", at(0, 0), { kind: "anisotropic", uAniso: [0.02, 0.025, 0.03, 0, 0, 0] }),
      site("C2", "C", at(1.39, 0), { kind: "isotropic", bIso: 1.5 }),
      site("C3", "C", at(1.39 * Math.cos(120 * deg), 1.39 * Math.sin(120 * deg)), { kind: "isotropic", bIso: 1.5 }),
      site("H1", "H", at(0.95 * Math.cos(230 * deg), 0.95 * Math.sin(230 * deg)), { kind: "isotropic", bIso: 3 }),
    ],
  };
}

describe("riding hydrogens", () => {
  it("places an sp² hydrogen on the external bisector at its distance, with U_iso 1.2·U_eq of its carbon", () => {
    const model = fragment();
    const { rules, unbonded } = ridingRules(model);
    expect(unbonded).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ site: "H1", parent: "C1", geometry: "aromatic", uFactor: 1.2 });
    expect(rules[0]!.distance).toBeCloseTo(0.95, 6);
    const sites = model.sites.map((s) => ({ ...s }));
    applyRiding({ ...model, riding: rules }, sites);
    const h = mulVec(orthogonalizationMatrix(model.cell), sites[3]!.position);
    // The bisector of 0° and 120° points to 240°.
    expect(h[0] - 5).toBeCloseTo(0.95 * Math.cos((240 * Math.PI) / 180), 6);
    expect(h[1] - 5).toBeCloseTo(0.95 * Math.sin((240 * Math.PI) / 180), 6);
    expect(sites[3]!.adp).toEqual({ kind: "isotropic", bIso: EIGHT_PI_SQUARED * 1.2 * uEquivalent([0.02, 0.025, 0.03, 0, 0, 0], model.cell) });
  });

  it("follows its carbon through applyParameters, and needs no parameter of its own", () => {
    const model = { ...fragment(), riding: ridingRules(fragment()).rules };
    const bindings = [{ parameterId: "dx", kind: "positionShift" as const, targetId: model.id, targetKey: "C1", axis: [0.01, 0, 0] as [number, number, number] }];
    const before = applyParameters(model, bindings, { dx: 0 }).model.sites.find((s) => s.label === "H1")!.position;
    const after = applyParameters(model, bindings, { dx: 1 }).model.sites.find((s) => s.label === "H1")!.position;
    // C1 moved 0.1 Å along a; the hydrogen re-sits on the new bisector, moved by about as much.
    expect(Math.hypot((after[0] - before[0]) * 10, (after[1] - before[1]) * 10)).toBeGreaterThan(0.05);
  });

  it("rotates a methyl about its axis (AFIX 137) and places a methylene's pair by X–C–Y (AFIX 23), as SHELXL placed them", () => {
    const model = hydrogenFragment();
    const { rules, unbonded } = ridingRules(model);
    expect(unbonded).toEqual([]);
    const by = (site: string): RidingRule => rules.find((r) => r.site === site)!;
    expect(["H1A", "H1B", "H1C"].map((h) => by(h).geometry)).toEqual(["methyl", "methyl", "methyl"]);
    expect(by("H1A")).toMatchObject({ parent: "C1", neighbours: [expect.objectContaining({ label: "N1" })], uFactor: 1.5 });
    expect(new Set(["H1A", "H1B", "H1C"].map((h) => by(h).phase))).toEqual(new Set([0, 120, 240]));
    expect(by("H1A").distance).toBeCloseTo(0.98, 4);
    expect([by("H3A").geometry, by("H3B").geometry]).toEqual(["methylene", "methylene"]);
    expect(by("H3A").side).toBe(-by("H3B").side!);
    expect(by("H3A").distance).toBeCloseTo(0.99, 4);
    // A metal's hydrogen rides at its offset; asked, its position refines and only its U rides.
    expect(by("H3'")).toMatchObject({ parent: "Ga2", geometry: "fixed" });
    expect(ridingRules(model, { refine: ["H3'"] }).rules.find((r) => r.site === "H3'")).toEqual({ site: "H3'", parent: "Ga2", geometry: "free", uFactor: 1.2 });
    // Placed from the heavy atoms alone, every hydrogen sits where SHELXL put it.
    const sites = model.sites.map((s) => ({ ...s }));
    applyRiding({ ...model, riding: rules }, sites);
    const m = orthogonalizationMatrix(model.cell);
    for (const rule of rules) {
      const was = model.sites.find((s) => s.label === rule.site)!.position;
      const now = sites.find((s) => s.label === rule.site)!.position;
      const d = mulVec(m, [now[0] - was[0], now[1] - was[1], now[2] - was[2]]);
      expect(Math.hypot(d[0], d[1], d[2]), rule.site).toBeLessThan(2e-4);
    }
    // A torsion turns the methyl, its hydrogens 120° apart, at the tetrahedral angle to the axis.
    const turned = { ...model, riding: withTorsions(rules, new Map([["C1", by("H1A").torsion! + 60]])) };
    const after = model.sites.map((s) => ({ ...s }));
    applyRiding(turned, after);
    const cart = (label: string, list: readonly AtomSite[]): number[] => [...mulVec(m, list.find((s) => s.label === label)!.position)];
    const angle = (a: number[], o: number[], b: number[]): number => {
      const u = a.map((x, i) => x - o[i]!);
      const v = b.map((x, i) => x - o[i]!);
      return (Math.acos(u.reduce((t, x, i) => t + x * v[i]!, 0) / Math.hypot(...u) / Math.hypot(...v)) * 180) / Math.PI;
    };
    const c1 = cart("C1", after);
    expect(angle(cart("N1", after), c1, cart("H1A", after))).toBeCloseTo(109.4712, 3);
    expect(angle(cart("H1A", after), c1, cart("H1B", after))).toBeCloseTo(109.4712, 3);
    // Turned by 60° about the N1–C1 axis: the projections of H1A before and after, across the axis, are 60° apart.
    const axis = cart("C1", after).map((x, i) => x - cart("N1", after)[i]!);
    const across = (h: number[]): number[] => {
      const v = h.map((x, i) => x - c1[i]!);
      const k = v.reduce((t, x, i) => t + x * axis[i]!, 0) / axis.reduce((t, x) => t + x * x, 0);
      return v.map((x, i) => x - k * axis[i]!);
    };
    const [p, q] = [across(cart("H1A", sites)), across(cart("H1A", after))];
    expect((Math.acos(p.reduce((t, x, i) => t + x * q[i]!, 0) / Math.hypot(...p) / Math.hypot(...q)) * 180) / Math.PI).toBeCloseTo(60, 6);
    expect(shelxDistance("methyl", "C", 173)).toBe(0.98);
    expect(shelxDistance("methylene", "C", 296)).toBe(0.97);
    expect(shelxDistance("aromatic", "C", 240)).toBe(0.94);
  });

  const dipyridyl = "GSAS-II-tutorials/sc/S2dipyridyl.cif";
  it.skipIf(!dataExists(dipyridyl))("reproduces SHELXL's riding hydrogens in dipyridyl disulfide (AFIX 43, U_iso 1.2·U_eq)", () => {
    const model = parseCif(readFileSync(dataPath(dipyridyl), "utf8"), "dipy");
    const { rules, unbonded } = ridingRules(model);
    expect(unbonded).toEqual([]);
    expect(rules).toHaveLength(16);
    expect(rules.every((r) => r.geometry === "aromatic" && r.uFactor === 1.2)).toBe(true);
    const sites = model.sites.map((s) => ({ ...s }));
    applyRiding({ ...model, riding: rules }, sites);
    const m = orthogonalizationMatrix(model.cell);
    for (const rule of rules) {
      const was = model.sites.find((s) => s.label === rule.site)!;
      const now = sites.find((s) => s.label === rule.site)!;
      const d = mulVec(m, [now.position[0] - was.position[0], now.position[1] - was.position[1], now.position[2] - was.position[2]]);
      // The CIF prints four decimals: placements agree to that.
      expect(Math.hypot(d[0], d[1], d[2]), rule.site).toBeLessThan(0.003);
      const cifU = was.adp.kind === "isotropic" ? was.adp.bIso / EIGHT_PI_SQUARED : NaN;
      expect(now.adp.kind === "isotropic" ? now.adp.bIso / EIGHT_PI_SQUARED : NaN).toBeCloseTo(cifU, 3);
    }
  });
});
