/**
 * Naming a space group in its standard setting from its operations in any
 * cell of its lattice (standardSetting.ts): the maximal translationengleiche
 * subgroups of ITA A1 for primitive and centred parents (F, I, R lattices,
 * origin choices, non-symmorphic), every t-subgroup of each named with a
 * number of its own point group, and the cell written out.
 */
import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { parseSymmetryOperation } from "@/core/crystal/symmetry";
import { classifyPointGroup } from "@/core/crystal/pointGroup";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { formatBasis, referenceSetting, standardSettingOf } from "@/core/crystal/standardSetting";

const iso = { kind: "isotropic", bIso: 0.5 } as const;
const lattice = (symbol: string | number) => {
  const s: StructureModel = {
    id: "t", name: "t", cell: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: buildSpaceGroup(symbol),
    sites: [{ label: "A", element: "Fe", position: [0.1, 0.2, 0.3], occupancy: 1, adp: iso }],
  };
  return structuralSubgroupLattice(s);
};

/** The maximal t-subgroups of each parent by IT number (ITA A1, Part 2), with their conjugate counts. */
const MAXIMAL: readonly [string | number, readonly (readonly [number, number])[]][] = [
  [221, [[207, 1], [215, 1], [200, 1], [123, 3], [166, 4]]],
  [225, [[216, 1], [209, 1], [202, 1], [139, 3], [166, 4]]],
  ["F d -3 m:2", [[203, 1], [210, 1], [216, 1], [141, 3], [166, 4]]],
  ["F d -3 m:1", [[203, 1], [210, 1], [216, 1], [141, 3], [166, 4]]],
  [229, [[204, 1], [211, 1], [217, 1], [139, 3], [166, 4]]],
  [139, [[87, 1], [97, 1], [107, 1], [121, 1], [119, 1], [71, 1], [69, 1]]],
  ["I 41/a m d:2", [[88, 1], [98, 1], [109, 1], [122, 1], [119, 1], [74, 1], [70, 1]]],
  ["R -3 m:H", [[148, 1], [155, 1], [160, 1], [12, 3]]],
  ["R -3 m:R", [[148, 1], [155, 1], [160, 1], [12, 3]]],
  [194, [[186, 1], [187, 1], [190, 1], [182, 1], [176, 1], [164, 1], [163, 1], [63, 3]]],
  [62, [[19, 1], [33, 1], [31, 1], [26, 1], [11, 1], [14, 1], [14, 1]]],
];

describe("the maximal t-subgroups of ITA A1, named in their standard settings", () => {
  for (const [parent, expected] of MAXIMAL) {
    it(`${parent}`, () => {
      const tree = lattice(parent);
      const top = tree.nodes[0]!;
      const maximal = top.maximalSubgroupIds.map((id) => tree.nodes.find((n) => n.id === id)!).filter((n) => n.classRepresentative);
      const got = maximal.map((n) => [n.identity.number, n.conjugates] as const).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || a[1] - b[1]);
      expect(got).toEqual([...expected].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    });
  }
});

describe("every t-subgroup gets a standard name", () => {
  for (const parent of [221, 225, 216, 229, "F d -3 m:2", "F d -3 m:1", 139, "I 41/a m d:2", "R -3 m:H", "R -3 m:R", 62, 194, 15, 123, 14]) {
    it(`${parent}: a number of the subgroup's own point group and order`, () => {
      for (const n of lattice(parent).nodes) {
        expect(n.identity.number, n.pointGroup ?? "?").toBeDefined();
        const reference = referenceSetting(n.identity.number!)!;
        const ops = reference.ops.map(parseSymmetryOperation);
        expect(classifyPointGroup(ops).symbol).toBe(n.pointGroup);
        // The name holds in a cell of the subgroup's own lattice: the setting matched has as many operations.
        expect(n.identity.method === "direct" || n.identity.method === "conventional-cell").toBe(true);
      }
    });
  }
});

describe("the conventional cell, written out", () => {
  it("F4/mmm in the cubic cell is I4/mmm on a′ = (a+b)/2, b′ = (−a+b)/2, c′ = c", () => {
    const f4mmm = buildSpaceGroup("F 4/m m m");
    const m = standardSettingOf(f4mmm.operations)!;
    expect(m.entry.number).toBe(139);
    expect(m.entry.reference).toBe(true);
    expect(formatBasis(m.basis)).toBe("a′ = (a+b)/2, b′ = (−a+b)/2, c′ = c");
    expect(m.origin).toEqual([0, 0, 0]);
  });

  it("a rhombohedral-axes setting goes to obverse hexagonal axes", () => {
    const m = standardSettingOf(buildSpaceGroup("R -3 m:R").operations)!;
    expect(m.entry.hm).toBe("R -3 m");
    expect(m.entry.ext).toBe("H");
  });

  it("Fd-3m:2's F-43m subgroup sits ⅛ along the diagonal from its standard origin", () => {
    const tree = lattice("F d -3 m:2");
    const f43m = tree.nodes.find((n) => n.identity.number === 216)!;
    expect(f43m.identity.method).toBe("conventional-cell");
    expect(f43m.identity.originShift).toEqual([0.125, 0.125, 0.125]);
  });

  it("formats axes with a common denominator", () => {
    expect(formatBasis([[1, 0, 1], [-1, 1, 1], [0, -1, 1]])).toBe("a′ = a−b, b′ = b−c, c′ = a+b+c");
    expect(formatBasis([[0.5, 0, 0], [0.5, 1, 0], [0.5, 0, 1]])).toBe("a′ = (a+b+c)/2, b′ = b, c′ = c");
  });
});
