import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { cellParameterGroups, cellSuShifts, cellVolumeEsd } from "@/core/crystal/cellEsd";
import { cellVolume } from "@/core/crystal/unitCell";
import { bondLengths } from "@/core/crystal/geometry";
import { bondEsds } from "@/core/workflow/bondEsds";
import { formatWithEsd, structureToCif } from "@/core/export/cif";
import { parseCif } from "@/parsers/cif";
import { parseShelxIns } from "@/parsers/shelxIns";
import { dataExists, dataPath } from "@/testSupport/data";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";

const ops = (n: number): readonly SymmetryOperation[] => buildSpaceGroup(n).operations;

describe("the cell's esds", () => {
  it("ties the lengths and angles the lattice holds equal, from the group's 3-, 4- and 6-fold axes", () => {
    expect(cellParameterGroups(ops(14))).toEqual([["a"], ["b"], ["c"], ["alpha"], ["beta"], ["gamma"]]);
    expect(cellParameterGroups(ops(145))).toEqual([["a", "b"], ["c"], ["alpha"], ["beta"], ["gamma"]]);
    expect(cellParameterGroups(ops(169))).toEqual([["a", "b"], ["c"], ["alpha"], ["beta"], ["gamma"]]);
    expect(cellParameterGroups(ops(136))).toEqual([["a", "b"], ["c"], ["alpha"], ["beta"], ["gamma"]]);
    expect(cellParameterGroups(ops(225))).toEqual([["a", "b", "c"], ["alpha", "beta", "gamma"]]);
    // R-3 on rhombohedral axes: the 3-fold along [111] ties the edges and the angles.
    const rhombohedral: SymmetryOperation[] = [
      { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0], xyz: "x,y,z" },
      { rotation: [[0, 0, 1], [1, 0, 0], [0, 1, 0]], translation: [0, 0, 0], xyz: "z,x,y" },
      { rotation: [[0, 1, 0], [0, 0, 1], [1, 0, 0]], translation: [0, 0, 0], xyz: "y,z,x" },
    ];
    expect(cellParameterGroups(rhombohedral)).toEqual([["a", "b", "c"], ["alpha", "beta", "gamma"]]);
  });

  it("gives SHELXL's volume esds: 1b's 1402.4(3) Å³ and dipyridyl's 2000.8(3) Å³, a hexagonal cell's with a and b as one", () => {
    // 1b, P2₁2₁2₁: a 6.2256(8), b 12.9136(15), c 17.444(2) Å.
    const one = { a: 6.2256, b: 12.9136, c: 17.444, alpha: 90, beta: 90, gamma: 90 };
    expect(formatWithEsd(cellVolume(one), cellVolumeEsd(one, { a: 0.0008, b: 0.0015, c: 0.002 }, ops(19)), 3)).toBe("1402.4(3)");
    // Dipyridyl disulfide, P2₁/c: β 96.9160(10)°.
    const dipy = { a: 15.8489, b: 5.5008, c: 23.118, alpha: 90, beta: 96.916, gamma: 90 };
    expect(formatWithEsd(cellVolume(dipy), cellVolumeEsd(dipy, { a: 0.0014, b: 0.0005, c: 0.002, beta: 0.001 }, ops(14)), 3)).toBe("2000.8(3)");
    // 2b, P3₂ (ZERR 0.0001 0.0001 0.0003): a and b move together, so σV/V = √((2σa/a)² + (σc/c)²).
    const two = { a: 12.7506, b: 12.7506, c: 27.6245, alpha: 90, beta: 90, gamma: 120 };
    const e = cellVolumeEsd(two, { a: 0.0001, b: 0.0001, c: 0.0003 }, ops(145))!;
    expect(e / cellVolume(two)).toBeCloseTo(Math.hypot((2 * 0.0001) / 12.7506, 0.0003 / 27.6245), 9);
    expect(formatWithEsd(cellVolume(two), e, 3)).toBe("3889.43(7)");
    expect(cellSuShifts(two, { a: 0.0001, b: 0.0001, c: 0.0003 }, ops(145))).toHaveLength(2);
    expect(cellVolumeEsd(two, undefined, ops(145))).toBeUndefined();
    expect(cellVolumeEsd(two, {}, ops(145))).toBeUndefined();
  });

  it("adds the cell's part to a bond's esd, as SHELXL does, and nothing for a cell without esds", () => {
    // Rock salt, Na at the origin and Cl at ½ 0 0, nothing free: the Na–Cl bond's esd is the cell's alone, d·σa/a.
    const salt: StructureModel = {
      id: "nacl", name: "NaCl", cell: { a: 5.64, b: 5.64, c: 5.64, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: buildSpaceGroup(225),
      sites: [
        { label: "Na1", element: "Na", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 1 } },
        { label: "Cl1", element: "Cl", position: [0.5, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 1 } },
      ],
    };
    const measure = (st: StructureModel): ReturnType<typeof bondLengths> => bondLengths(st, 3).filter((b) => b.from === "Na1" && b.to === "Cl1").slice(0, 1);
    const plain = bondEsds(salt, [], [], {}, measure);
    expect([...plain.values()]).toEqual([0]);
    const withSu = bondEsds({ ...salt, cellSu: { a: 0.02, b: 0.02, c: 0.02 } }, [], [], {}, measure);
    expect([...withSu.values()][0]).toBeCloseTo(2.82 * (0.02 / 5.64), 9);
  });
});

describe.skipIf(!dataExists("GSAS-II-tutorials/sc/2b.ins") || !dataExists("GSAS-II-tutorials/sc/1b.cif"))("the cell's esds read from the files", () => {
  it("reads SHELXL's ZERR and a CIF's su, and writes them to the CIF with the volume's", () => {
    const two = parseShelxIns(readFileSync(dataPath("GSAS-II-tutorials/sc/2b.ins"), "utf8"), "2b").structure;
    expect(two.cellSu).toEqual({ a: 0.0001, b: 0.0001, c: 0.0003 });
    const cif = structureToCif(two);
    expect(cif).toContain("_cell_length_a    12.75060(10)");
    expect(cif).toContain("_cell_length_c    27.6245(3)");
    expect(cif).toContain("_cell_angle_gamma 120.0000");
    expect(cif).toContain("_cell_volume      3889.43(7)");
    const one = parseCif(readFileSync(dataPath("GSAS-II-tutorials/sc/1b.cif"), "utf8"), "1b");
    expect(one.cellSu!.a).toBeCloseTo(0.0008, 12);
    expect(one.cellSu!.b).toBeCloseTo(0.0015, 12);
    expect(one.cellSu!.c).toBeCloseTo(0.002, 12);
    expect(one.cellSu!.alpha).toBeUndefined();
  });
});
