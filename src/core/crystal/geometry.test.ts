import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bondLengths, centroidContacts, coordinationShells, covalentBonds, hydrogenBondLines, hydrogenBonds, planarRings, ringGeometryLines } from "@/core/crystal/geometry";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseShelxIns } from "@/parsers/shelxIns";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import type { StructureModel } from "@/core/crystal/types";
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

describe("bonds to symmetry images", () => {
  const iso = { kind: "isotropic", bIso: 1 } as const;
  const cubic = { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 };

  it("name the image each bond reaches with its CIF site-symmetry code, and none for the atom as listed", () => {
    // P-1: C1 bonds to its own inversion image (operation 2, no translation) at 0.2·√3·5 Å.
    const pm1: StructureModel = { id: "p", name: "p", cell: cubic, spaceGroup: buildSpaceGroup(2), sites: [{ label: "C1", element: "C", position: [0.1, 0.1, 0.1], occupancy: 1, adp: iso }] };
    const self = covalentBonds(pm1);
    expect(self).toHaveLength(1);
    expect(self[0]).toMatchObject({ from: "C1", to: "C1", image: "2_555" });
    expect(self[0]!.distance).toBeCloseTo(Math.sqrt(3), 6);
    // P1: C2 across the cell face, one lattice vector along a; C1–C3 within the cell, no code.
    const p1: StructureModel = { id: "q", name: "q", cell: cubic, spaceGroup: buildSpaceGroup(1), sites: [
      { label: "C1", element: "C", position: [0.9, 0.1, 0.1], occupancy: 1, adp: iso },
      { label: "C2", element: "C", position: [0.18, 0.1, 0.1], occupancy: 1, adp: iso },
      { label: "C3", element: "C", position: [0.9, 0.4, 0.1], occupancy: 1, adp: iso },
    ] };
    const bonds = covalentBonds(p1);
    expect(bonds.find((b) => b.to === "C2")).toMatchObject({ from: "C1", image: "1_655" });
    expect(bonds.find((b) => b.to === "C3")).not.toHaveProperty("image");
    // From the other end, the image is the inverse: C2 reaches C1 one cell back.
    expect(bondLengths(p1, 2).find((b) => b.from === "C2" && b.to === "C1")).toMatchObject({ image: "1_455" });
  });

  it("reach the covalent radii of the largest atoms present: caesium's ring at 3.2–3.4 Å", () => {
    const cs: StructureModel = { id: "c", name: "c", cell: { a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: buildSpaceGroup(1), sites: [
      { label: "Cs1", element: "Cs", position: [0.5, 0.5, 0.5], occupancy: 1, adp: iso },
      { label: "C1", element: "C", position: [0.5, 0.5, 0.83], occupancy: 1, adp: iso },
    ] };
    expect(covalentBonds(cs).map((b) => `${b.from}–${b.to} ${b.distance.toFixed(2)}`)).toEqual(["Cs1–C1 3.30"]);
  });
});

describe("a molecule's rings and hydrogen bonds", () => {
  const iso = { kind: "isotropic", bIso: 1 } as const;
  const P1 = buildSpaceGroup(1);
  const cell = { a: 20, b: 20, c: 20, alpha: 90, beta: 90, gamma: 90 };
  const at = (label: string, element: string, x: number, y: number, z: number): StructureModel["sites"][number] =>
    ({ label, element, position: [0.5 + x / 20, 0.5 + y / 20, 0.5 + z / 20], occupancy: 1, adp: iso });

  it("finds a flat ring and the metal over its centroid, not a puckered ring", () => {
    // A benzene ring (1.39 Å) in the xy plane, a metal 2.0 Å over its centroid; a chair of six carbons at 1.53 Å.
    const ring = [0, 1, 2, 3, 4, 5].map((i) => at(`C${i + 1}`, "C", 1.39 * Math.cos((i * Math.PI) / 3), 1.39 * Math.sin((i * Math.PI) / 3), 0));
    const chair = [0, 1, 2, 3, 4, 5].map((i) => at(`C${i + 11}`, "C", 6 + 1.45 * Math.cos((i * Math.PI) / 3), 1.45 * Math.sin((i * Math.PI) / 3), i % 2 === 0 ? 0.25 : -0.25));
    const model: StructureModel = { id: "m", name: "m", cell, spaceGroup: P1, sites: [...ring, ...chair, at("Fe1", "Fe", 0, 0, 2.0)] };
    const rings = planarRings(model);
    expect(rings.map((r) => r.atoms.length)).toEqual([6]);
    expect(rings[0]!.planarity).toBeLessThan(1e-6);
    const contacts = centroidContacts(model, rings);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ atom: "Fe1", ring: "Cg1" });
    expect(contacts[0]!.distance).toBeCloseTo(2.0, 6);
    expect(ringGeometryLines(model).contacts).toEqual(["Fe1···Cg1 2.000 Å"]);
  });

  it("finds an O–H···O hydrogen bond with its lengths and angle, and none past the van der Waals contact", () => {
    // Water dimer: the donor's O–H 0.96 Å pointing at the acceptor's O, H···O 1.90 Å.
    const model: StructureModel = { id: "w", name: "w", cell, spaceGroup: P1, sites: [
      at("O1", "O", 0, 0, 0), at("H1", "H", 0.96, 0, 0), at("H2", "H", -0.24, 0.93, 0),
      at("O2", "O", 2.86, 0, 0), at("H3", "H", 3.1, 0.93, 0), at("H4", "H", 3.1, -0.46, 0.8),
    ] };
    const bonds = hydrogenBonds(model);
    expect(bonds.map((b) => [b.donor, b.hydrogen, b.acceptor])).toContainEqual(["O1", "H1", "O2"]);
    const hb = bonds.find((b) => b.hydrogen === "H1")!;
    expect(hb.ha).toBeCloseTo(1.9, 6);
    expect(hb.da).toBeCloseTo(2.86, 6);
    expect(hb.angle).toBeCloseTo(180, 6);
    expect(hydrogenBondLines(model)[0]).toBe("O1–H1···O2: D–H 0.96, H···A 1.90, D···A 2.860 Å, 180°");
  });
});

describe.skipIf(!dataExists("GSAS-II-tutorials/sc/3a.ins") || !dataExists("GSAS-II-tutorials/sc/2b.ins"))("rings in real structures", () => {
  it("sandwiches 3a's caesium between two C₅Me₅ centroids, and points 2b's ammonium N–H at an aryl ring", () => {
    const three = parseShelxIns(readFileSync(dataPath("GSAS-II-tutorials/sc/3a.ins"), "utf8"), "3a").structure;
    const g3 = ringGeometryLines(three);
    expect(g3.rings[0]).toMatch(/^Cg1: C1 C5 C4 C3 C2 \(planar within 0\.0\d\d Å\)$/);
    const cs = g3.contacts.filter((c) => c.startsWith("Cs1···Cg1"));
    expect(cs).toHaveLength(2);
    expect(cs.every((c) => /3\.0\d\d Å$/.test(c))).toBe(true);
    expect(g3.contacts).toContainEqual(expect.stringMatching(/^Cg1( \[\d_\d{3}\])?–Cs1–Cg1( \[\d_\d{3}\])? 1\d\d\.\d°$/));
    const two = parseShelxIns(readFileSync(dataPath("GSAS-II-tutorials/sc/2b.ins"), "utf8"), "2b").structure;
    // No classical hydrogen bond, and said so: the N–H points at an aryl ring's centroid instead.
    expect(hydrogenBonds(two)).toEqual([]);
    expect(hydrogenBondLines(two)).toEqual(["none: N1–H1D reaches no acceptor (N, O, F, S or a halogen) within the van der Waals sum at D–H···A above 110°"]);
    // A structure without N–H or O–H has no donors to speak of.
    expect(hydrogenBondLines(three)).toEqual([]);
    const nh = ringGeometryLines(two).contacts.filter((c) => c.startsWith("N1–H1D···"));
    expect(nh).toHaveLength(1);
    expect(nh[0]).toMatch(/^N1–H1D···Cg\d 2\.4\d\d Å, 17\d°$/);
  });
});

describe("symmetry copies at rounded special positions", () => {
  // ZnO, P6₃mc, with the 4-decimal coordinates a CIF prints: 0.3333 and 0.6667
  // map to copies 1e-4 apart, which are one atom, not two.
  const ZNO = ["data_zno", "_cell_length_a 3.2498", "_cell_length_b 3.2498", "_cell_length_c 5.2066", "_cell_angle_alpha 90", "_cell_angle_beta 90", "_cell_angle_gamma 120",
    "_symmetry_space_group_name_H-M 'P 63 m c'", "loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z",
    "Zn1 Zn 0.3333 0.6667 0", "O1 O 0.3333 0.6667 0.3821"].join("\n");

  it("are one atom in the coordination shell and the bond list", () => {
    const zno = parseCif(ZNO, "zno");
    const zn = coordinationShells(zno).find((sh) => sh.site === "Zn1")!;
    expect(zn.bonds.reduce((n, b) => n + b.count, 0)).toBe(4);
    const znO = bondLengths(zno, 2.1).filter((b) => b.from === "Zn1" && b.to === "O1");
    // One Zn–O at 1.99 Å along c and three at 1.97 Å: four bonds, no doubles.
    expect(znO.length).toBeLessThanOrEqual(4);
    expect(znO.length).toBeGreaterThan(0);
  });
});
