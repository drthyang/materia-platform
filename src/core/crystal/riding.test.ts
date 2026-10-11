import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseCif } from "@/parsers/cif";
import type { AtomSite, StructureModel } from "@/core/crystal/types";
import { applyRiding, ridingRules } from "@/core/crystal/riding";
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
