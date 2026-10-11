import { describe, it, expect } from "vitest";
import { coordinationShells } from "@/core/crystal/geometry";
import { parseCif } from "@/parsers/cif";

// LaMnO₃ at 300 K, Pbnm (the PDFgui tutorial model): Mn³⁺ on an inversion
// centre, its octahedron Jahn–Teller distorted into three pairs of bonds.
const LAMNO3 = `data_LaMnO3
_cell_length_a 5.538767
_cell_length_b 5.744239
_cell_length_c 7.705918
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M "P b n m"
loop_
_space_group_symop_operation_xyz
x,y,z
1/2-x,1/2+y,z
1/2+x,1/2-y,1/2+z
-x,-y,1/2+z
-x,-y,-z
1/2+x,1/2-y,-z
1/2-x,1/2+y,1/2-z
x,y,1/2-z
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
La2 La 0.49274 0.45183 0.75000 0.0052
Mn1 Mn 0.00000 0.50000 0.00000 0.0038
O1 O 0.07196 0.48633 0.25000 0.0070
O6 O 0.22566 0.19343 0.96069 0.0076
`;

const NICKEL = `data_Ni
_cell_length_a 3.524
_cell_length_b 3.524
_cell_length_c 3.524
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M "F m -3 m"
loop_
_space_group_symop_operation_xyz
x,y,z
x,1/2+y,1/2+z
1/2+x,y,1/2+z
1/2+x,1/2+y,z
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
Ni1 Ni 0 0 0 0.005
`;

describe("coordination shells", () => {
  const shells = coordinationShells(parseCif(LAMNO3, "lmo"));

  it("gives each cation its anion shell, grouped by neighbour and length with the multiplicity", () => {
    expect(shells.map((s) => s.site)).toEqual(["La2", "Mn1"]);
    const mn = shells.find((s) => s.site === "Mn1")!;
    // Three pairs: short and long equatorial bonds to O6, the apical pair to O1.
    expect(mn.bonds.map((b) => [b.to, b.count])).toEqual([["O6", 2], ["O1", 2], ["O6", 2]]);
    expect(mn.bonds[0]!.distance).toBeCloseTo(1.907, 2);
    expect(mn.bonds[1]!.distance).toBeCloseTo(1.969, 2);
    expect(mn.bonds[2]!.distance).toBeCloseTo(2.179, 2);
    expect(mn.mean).toBeCloseTo((mn.bonds[0]!.distance + mn.bonds[1]!.distance + mn.bonds[2]!.distance) / 3, 6);
  });

  it("reaches 3.2 Å, so the A site's long bonds stay in its shell", () => {
    const la = shells.find((s) => s.site === "La2")!;
    const n = la.bonds.reduce((k, b) => k + b.count, 0);
    expect(n).toBeGreaterThanOrEqual(8);
    expect(Math.max(...la.bonds.map((b) => b.distance))).toBeLessThanOrEqual(3.2);
  });

  it("gives every site's shell of any neighbours when there are no anions", () => {
    const ni = coordinationShells(parseCif(NICKEL, "ni"));
    expect(ni).toHaveLength(1);
    expect(ni[0]!.bonds).toEqual([{ to: "Ni1", distance: expect.closeTo(3.524 / Math.SQRT2, 6), count: 12 }]);
  });
});
