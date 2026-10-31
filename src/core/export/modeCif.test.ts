/**
 * ISODISTORT mode-CIF export and import (export/modeCif.ts, parsers/
 * modeCif.ts; subgroup engine phase 4, THY-35), through the module interfaces.
 *
 *  - Round trip, exact: a supercell child's modes by parent irrep (R-3c and
 *    Pnma from SrTiO₃, amplitudes set and the cell strained as a refinement
 *    leaves them) and a decomposition's, exported and read back, give the same
 *    structure, the same undistorted positions, modes, axes and amplitudes,
 *    bit for bit.
 *  - ISODISTORT's own form: the export's normfactors are ISODISTORT's, checked
 *    against the ISODISTORT 6.12.2 mode CIF of the GSAS-II tutorial "k-vector
 *    search and ISODISTORT" (STO_Subgroup.cif, github.com/AdvancedPhotonSource/
 *    GSAS-II-tutorials, MDtutorials/k_vec_isodistort/data): 0.09068 for both
 *    of its modes. That file's tags, with its numbers entered by hand (the file
 *    itself is not in the repository), read back as its two modes, their
 *    amplitudes A_s = 0.1 and −0.3 Å, and its structure.
 */
import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { applyParameters } from "@/core/workflow/apply";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { supercellModeBasis } from "@/core/crystal/irreps/supercellModes";
import { irrepModeSet } from "@/core/crystal/irreps/modeSet";
import { decomposeChild } from "@/core/crystal/irreps/decompose";
import type { DistortionModeSet } from "@/core/crystal/distortionModes";
import { modeCif } from "@/core/export/modeCif";
import { parseModeCif } from "@/parsers/modeCif";
import { srtio3 } from "@/testSupport/perovskiteTilts";

const PARENT = srtio3();
const GROUP = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const LATTICE = supercellSubgroups(GROUP, { maxIndex: 48 });

/** A supercell child's mode set, its amplitudes set, and the child they give (the cell strained, B changed, as a fit leaves them). */
function activated(number: number, pick: (n: number) => boolean): { set: DistortionModeSet; child: StructureModel; values: Record<string, number> } {
  for (const cls of LATTICE.classes.filter((c) => c.identity?.number === number)) {
    const r = realiseChild(PARENT, GROUP, cls.elements, cls.identity);
    const b = supercellModeBasis(PARENT, GROUP, cls.elements, r);
    if (!pick(b.modes.length)) continue;
    const set = irrepModeSet(PARENT, r, b);
    const values = Object.fromEntries(set.modes.map((m, i) => [m.id, 0.013 * (i + 1) * (i % 2 === 0 ? 1 : -1)]));
    const moved = applyParameters(set.parentized, set.bindings, values).model;
    const child: StructureModel = {
      ...moved,
      cell: { ...moved.cell, a: moved.cell.a * 1.0031, c: moved.cell.c * 0.9987 },
      sites: moved.sites.map((s, i) => (i === 0 ? { ...s, adp: { kind: "isotropic", bIso: 0.7123 } } : s)),
    };
    return { set, child, values };
  }
  throw new Error(`no #${number} class`);
}

/** Export, import, and compare everything a refinement reads. */
function expectRoundTrip(set: DistortionModeSet, child: StructureModel, values: Record<string, number>, free: Record<string, boolean> = {}): void {
  const text = modeCif({ set, child, values, free, version: "test" });
  const back = parseModeCif(text, child.id);
  expect(back.materia).toBe(true);
  // The structure as written.
  expect(back.structure.cell).toEqual(child.cell);
  expect(back.structure.spaceGroup.operations.map((op) => op.xyz)).toEqual(child.spaceGroup.operations.map((op) => op.xyz));
  expect(back.structure.spaceGroup.number).toBe(child.spaceGroup.number);
  expect(back.structure.sites.map(({ label, element, position, occupancy, adp }) => ({ label, element, position, occupancy, adp }))).toEqual(
    child.sites.map(({ label, element, position, occupancy, adp }) => ({ label, element, position, occupancy, adp })),
  );
  // The modes: the same undistorted positions, labels, irreps, axes and amplitudes.
  expect(back.set.parentized.sites.map((s) => s.position)).toEqual(set.parentized.sites.map((s) => s.position));
  expect(back.set.modes.map((m) => m.label)).toEqual(set.modes.map((m) => m.label));
  expect(back.set.modes.map((m) => m.irrep)).toEqual(set.modes.map((m) => m.irrep));
  expect(back.set.modes.map((m) => m.star)).toEqual(set.modes.map((m) => m.star));
  expect(back.set.modes.map((m) => m.axes)).toEqual(set.modes.map((m) => m.axes));
  expect(back.set.parameters.map((p) => p.value)).toEqual(set.modes.map((m) => values[m.id]));
  expect(back.set.parameters.map((p) => p.fixed)).toEqual(set.modes.map((m) => !free[m.id]));
  expect(back.set.amplitudeCells).toEqual(set.amplitudeCells);
  expect(back.set.parent).toEqual(set.parent);
  // The amplitudes on the undistorted child give the child's positions back, exactly.
  const rebuilt = applyParameters({ ...back.set.parentized, cell: child.cell }, back.set.bindings, Object.fromEntries(back.set.parameters.map((p) => [p.id, p.value]))).model;
  const before = applyParameters({ ...set.parentized, cell: child.cell }, set.bindings, values).model;
  expect(rebuilt.sites.map((s) => s.position)).toEqual(before.sites.map((s) => s.position));
}

describe("mode CIF: export and import", () => {
  it("round trip, exact: R-3c and Pnma children of SrTiO₃ (strained, amplitudes set)", () => {
    for (const [number, pick] of [[167, (n: number) => n === 1], [62, (n: number) => n === 7]] as const) {
      const { set, child, values } = activated(number, pick);
      expectRoundTrip(set, child, values, { [set.modes[0]!.id]: true });
    }
  });

  it("round trip, exact: a decomposition of a supercell child", () => {
    const { set, child, values } = activated(62, (n) => n === 7);
    const d = decomposeChild(PARENT, { ...child, id: "loaded" });
    expectRoundTrip(d.set, { ...child, id: "loaded" }, Object.fromEntries(d.set.parameters.map((p) => [p.id, p.value])), Object.fromEntries(d.set.parameters.map((p) => [p.id, !p.fixed])));
    // The decomposition's amplitudes are the activation's (the same child, the same irreps): equal as multisets.
    const sorted = (xs: number[]): number[] => xs.map(Math.abs).sort((x, y) => x - y);
    expect(sorted(d.set.parameters.map((p) => p.value)).map((x) => +x.toFixed(10))).toEqual(sorted(set.modes.map((m) => values[m.id]!)).map((x) => +x.toFixed(10)));
  });

  it("writes ISODISTORT's tags and normfactors: 0.09068 for the GSAS-II tutorial's STO_Subgroup modes", () => {
    const { parent, child } = stoSubgroup();
    const d = decomposeChild(parent, child);
    const text = modeCif({ set: d.set, child, values: Object.fromEntries(d.set.parameters.map((p) => [p.id, p.value])), version: "test" });
    for (const tag of ["_iso_displacivemode_label", "_iso_displacivemodenorm_value", "_iso_deltacoordinate_label", "_iso_coordinate_formula", "_iso_displacivemodematrix_value", "_iso_parentcell_length_a", "_iso_parent-to-child.transform_Pp_abc"]) {
      expect(text).toContain(tag);
    }
    const norms = [...text.matchAll(/^\s*(\d+)\s+([0-9.eE-]+)\s*$/gm)].filter((m) => text.slice(text.indexOf("_iso_displacivemodenorm_value"), text.indexOf("_iso_deltacoordinate_ID")).includes(m[0])).map((m) => Number(m[2]));
    expect(norms).toHaveLength(2);
    for (const n of norms) expect(n).toBeCloseTo(0.09068, 5);
    // Labels in ISODISTORT's shape: parent, k (an arm of X's star), irrep, direction, [site:Wyckoff:dsp].
    expect(text).toMatch(/Pm-3m\[(0,0,1\/2|0,1\/2,0|1\/2,0,0)\]X_irrep\d+of10\([a0,]+\)\[sr:\?:dsp\]m1/);
  });

  it("reads ISODISTORT 6.12.2's own mode CIF (the GSAS-II tutorial's numbers): two modes, A_s 0.1 and −0.3 Å, the structure", () => {
    const parsed = parseModeCif(STO_SUBGROUP_ISODISTORT, "sto");
    expect(parsed.materia).toBe(false);
    expect(parsed.parentSymbol).toBe("Pm-3m");
    expect(parsed.parentNumber).toBe(221);
    expect(parsed.set.modes.map((m) => m.label)).toEqual(["Pm-3m[0,1/2,0]X1+(a;0;0)[sr:b:dsp]T1u(a)", "Pm-3m[0,1/2,0]X1+(a;0;0)[o:d:dsp]A2u(a)"]);
    expect(parsed.set.modes.map((m) => m.irrep)).toEqual([
      { label: "X1+", k: [0, 0.5, 0], direction: "(a;0;0)", parentSite: "sr" },
      { label: "X1+", k: [0, 0.5, 0], direction: "(a;0;0)", parentSite: "o" },
    ]);
    // A primitive child: A = A_s; the parent cells from the transform a,c,−2b (det 2).
    expect(parsed.set.amplitudeCells).toEqual({ child: 1, parent: 2 });
    expect(parsed.set.parameters.map((p) => p.value)).toEqual([0.1, -0.3]);
    // The undistorted sites from the formulas; the amplitudes rebuild the file's positions to its 5 decimals.
    const sr = parsed.set.parentized.sites.find((s) => s.label === "sr_1")!;
    expect(sr.position).toEqual([0.5, 0.5, 0.75]);
    const rebuilt = applyParameters(parsed.set.parentized, parsed.set.bindings, { mode_1: 0.1, mode_2: -0.3 }).model;
    expect(rebuilt.sites.find((s) => s.label === "sr_1")!.position[2]).toBeCloseTo(0.74093, 5);
    expect(rebuilt.sites.find((s) => s.label === "o_3")!.position[2]).toBeCloseTo(0.7772, 5);
    // MATERIA's decomposition of the same structure agrees on the amplitudes, to the file's rounding.
    const { parent } = stoSubgroup();
    const d = decomposeChild(parent, parsed.structure);
    expect(d.amplitudes.map((a) => Math.abs(a.as)).sort()).toEqual([expect.closeTo(0.1, 3), expect.closeTo(0.3, 3)]);
  });
});

/** The GSAS-II tutorial's parent and child (ISODISTORT 6.12.2), entered by hand. */
function stoSubgroup(): { parent: StructureModel; child: StructureModel } {
  const parent: StructureModel = {
    id: "sto",
    name: "STO_Parent",
    cell: { a: 3.899, b: 3.899, c: 3.899, alpha: 90, beta: 90, gamma: 90 },
    spaceGroup: buildSpaceGroup(221),
    sites: [
      { label: "sr", element: "Sr", position: [0.5, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      { label: "ti", element: "Ti", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      { label: "o", element: "O", position: [0.5, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
    ],
  };
  const child: StructureModel = {
    id: "sto-child",
    name: "STO_Subgroup",
    cell: { a: 3.899, b: 3.899, c: 7.798, alpha: 90, beta: 90, gamma: 90 },
    spaceGroup: buildSpaceGroup(123),
    sites: [
      { label: "sr_1", element: "Sr", position: [0.5, 0.5, 0.74093], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      { label: "ti_1", element: "Ti", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      { label: "ti_2", element: "Ti", position: [0, 0, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      { label: "o_1", element: "O", position: [0, 0.5, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      { label: "o_2", element: "O", position: [0, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      { label: "o_3", element: "O", position: [0, 0, 0.7772], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
    ],
  };
  return { parent, child };
}

/**
 * The tags of ISODISTORT 6.12.2's mode CIF for the GSAS-II tutorial's
 * STO_Subgroup (P4/mmm from SrTiO₃ at X), its numbers entered by hand; the
 * strain modes and comments of the original are left out.
 */
const STO_SUBGROUP_ISODISTORT = `# This file was generated by ISODISTORT, version 6.12.2
# Space Group: 221 Pm-3m      Oh-1
data_isodistort-output
_cell_length_a     3.89900
_cell_length_b     3.89900
_cell_length_c     7.79800
_cell_angle_alpha  90.00000
_cell_angle_beta   90.00000
_cell_angle_gamma  90.00000
_symmetry_space_group_name_H-M "P 4/m 2/m 2/m"
_symmetry_Int_Tables_number 123
loop_
_space_group_symop_id
_space_group_symop_operation_xyz
1 x,y,z
2 x,-y,-z
3 -x,y,-z
4 -x,-y,z
5 -y,-x,-z
6 -y,x,z
7 y,-x,z
8 y,x,-z
9 -x,-y,-z
10 -x,y,z
11 x,-y,z
12 x,y,-z
13 y,x,z
14 y,-x,-z
15 -y,x,-z
16 -y,-x,z
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_symmetry_multiplicity
_atom_site_Wyckoff_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_fract_symmform
sr_1 Sr   2 h  0.50000  0.50000  0.74093  1.00000 0,0,Dz
ti_1 Ti   1 a  0.00000  0.00000  0.00000  1.00000 0,0,0
ti_2 Ti   1 b  0.00000  0.00000  0.50000  1.00000 0,0,0
o_1  O    2 f  0.00000  0.50000  0.00000  1.00000 0,0,0
o_2  O    2 e  0.00000  0.50000  0.50000  1.00000 0,0,0
o_3  O    2 g  0.00000  0.00000  0.77720  1.00000 0,0,Dz
_iso_displacivemode_number    2
loop_
_iso_displacivemode_ID
_iso_displacivemode_label
_iso_displacivemode_value
   1 Pm-3m[0,1/2,0]X1+(a;0;0)[sr:b:dsp]T1u(a)  0.10000
   2 Pm-3m[0,1/2,0]X1+(a;0;0)[o:d:dsp]A2u(a) -0.30000
loop_
_iso_displacivemodenorm_ID
_iso_displacivemodenorm_value
   1  0.09068
   2  0.09068
loop_
_iso_deltacoordinate_ID
_iso_deltacoordinate_label
_iso_deltacoordinate_value
   1 sr_1_dz  -0.00907
   2 o_3_dz   0.02720
loop_
_iso_coordinate_label
_iso_coordinate_formula
sr_1_x                  "1/2"
sr_1_y                  "1/2"
sr_1_z                  "3/4 + sr_1_dz"
ti_1_x                  "0"
ti_1_y                  "0"
ti_1_z                  "0 + ti_1_dz"
ti_2_x                  "0"
ti_2_y                  "0"
ti_2_z                  "1/2 + ti_2_dz"
o_1_x                   "0"
o_1_y                   "1/2"
o_1_z                   "0 + o_1_dz"
o_2_x                   "0"
o_2_y                   "1/2"
o_2_z                   "1/2 + o_2_dz"
o_3_x                   "0"
o_3_y                   "0"
o_3_z                   "3/4 + o_3_dz"
loop_
_iso_displacivemodematrix_row
_iso_displacivemodematrix_col
_iso_displacivemodematrix_value
    1    1  -1.00000
    2    2  -1.00000
_iso_parentcell_length_a     3.89900
_iso_parentcell_length_b     3.89900
_iso_parentcell_length_c     3.89900
_iso_parentcell_angle_alpha  90.00000
_iso_parentcell_angle_beta   90.00000
_iso_parentcell_angle_gamma  90.00000
_iso_parentcell_volume       59.27338
_iso_parent-to-child.transform_Pp_abc a,c,-2b;0,2,0
`;
