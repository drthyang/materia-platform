import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { inversionText, invertedModel, invertedRiding, invertedTwinFractions } from "@/core/crystal/inversion";
import { applyRiding, ridingRules } from "@/core/crystal/riding";
import { restraintRows, restraintValues } from "@/core/crystal/restraints";
import { applyOperation } from "@/core/crystal/symmetry";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { Mat3, Vec3 } from "@/core/math/types";
import { INVERSION_TWIN } from "@/core/diffraction/types";

const iso = { kind: "isotropic", bIso: 1 } as const;
const model = (group: number | string, cell: StructureModel["cell"]): StructureModel => ({
  id: "m",
  name: "m",
  cell,
  spaceGroup: buildSpaceGroup(group),
  sites: [
    { label: "Cs1", element: "Cs", position: [0.11, 0.23, 0.07], occupancy: 1, adp: iso },
    { label: "C1", element: "C", position: [0.31, 0.12, 0.29], occupancy: 1, adp: iso },
  ],
});
const hexagonal = { a: 11.37, b: 11.37, c: 20.5, alpha: 90, beta: 90, gamma: 120 };

/** Whether the operation set (R, (I − R)s − t) is the group's own, mod lattice translations. */
const frac = (v: number): number => v - Math.floor(v + 1e-9);
function holds(ops: readonly SymmetryOperation[], s: Vec3): boolean {
  return ops.every((op) => {
    const t = [0, 1, 2].map((i) => s[i]! - op.rotation[i]!.reduce((a, r, j) => a + r * s[j]!, 0) - op.translation[i]!);
    return ops.some((o) => o.rotation.every((row, i) => row.every((v, j) => v === op.rotation[i]![j])) && [0, 1, 2].every((i) => {
      const d = frac(o.translation[i]! - t[i]!);
      return d < 1e-6 || d > 1 - 1e-6;
    }));
  });
}

describe("the inverted model", () => {
  it("takes P6₁ to its enantiomorph P6₅ and every coordinate to its negative; inverted again, it is the model", () => {
    const m = model(169, hexagonal);
    const inv = invertedModel(m);
    expect(inv.structure.spaceGroup.number).toBe(170);
    expect(inv.enantiomorph).toBe("P 65");
    expect(inv.shift).toEqual([0, 0, 0]);
    expect(inv.structure.sites.map((s) => s.position)).toEqual(m.sites.map((s) => s.position.map((x) => -x + 0)));
    expect(inversionText(m, inv)).toBe("the model as loaded, inverted through the origin (every coordinate x → −x, as SHELXL's MOVE 1 1 1 −1); the space group P 61 → P 65, its enantiomorph");
    const back = invertedModel(inv.structure);
    expect(back.structure.spaceGroup.number).toBe(169);
    back.structure.sites.forEach((s, i) => s.position.forEach((x, k) => expect(x).toBeCloseTo(m.sites[i]!.position[k]!, 12)));
  });

  it("keeps a group the inversion maps onto itself (P2₁, P2₁2₁2₁), and shifts the origin where the group needs it (I4₁, Fdd2)", () => {
    const mono = invertedModel(model(4, { a: 5, b: 6, c: 7, alpha: 90, beta: 100, gamma: 90 }));
    expect([mono.structure.spaceGroup.number, mono.enantiomorph, mono.shift]).toEqual([4, undefined, [0, 0, 0]]);
    expect(invertedModel(model(19, { a: 5, b: 6, c: 7, alpha: 90, beta: 90, gamma: 90 })).structure.spaceGroup.number).toBe(19);
    for (const [group, cell] of [[80, { a: 7, b: 7, c: 9, alpha: 90, beta: 90, gamma: 90 }], [43, { a: 7, b: 8, c: 9, alpha: 90, beta: 90, gamma: 90 }]] as const) {
      const m = model(group, cell);
      const inv = invertedModel(m);
      expect(inv.structure.spaceGroup.number).toBe(group);
      expect(inv.enantiomorph).toBeUndefined();
      expect(inv.shift.some((v) => v !== 0)).toBe(true);
      expect(holds(m.spaceGroup.operations, inv.shift)).toBe(true);
      expect(inv.structure.sites[0]!.position).toEqual(m.sites[0]!.position.map((x, i) => inv.shift[i]! - x));
    }
  });

  it("refuses a centrosymmetric group: the inverse is the same model", () => {
    expect(() => invertedModel(model(14, { a: 5, b: 6, c: 7, alpha: 90, beta: 100, gamma: 90 }))).toThrow(/centrosymmetric/);
  });

  it("maps every image to the inverted model's: a restrained distance stays what it was", () => {
    const m = model(169, hexagonal);
    const inv = invertedModel(m);
    for (let op = 0; op < m.spaceGroup.operations.length; op++) {
      const cell: [number, number, number] = [1, -1, 0];
      const was = applyOperation(m.spaceGroup.operations[op]!, m.sites[1]!.position as Vec3).map((v, i) => v + cell[i]!);
      const image = inv.mapImage(op, cell);
      const now = applyOperation(inv.structure.spaceGroup.operations[image.op]!, inv.structure.sites[1]!.position as Vec3).map((v, i) => v + image.cell[i]!);
      now.forEach((v, i) => expect(v).toBeCloseTo(inv.shift[i]! - was[i]!, 12));
    }
    const restrained: StructureModel = { ...m, restraints: [{ kind: "dfix", target: 3.4, sigma: 0.01, pairs: [{ from: "Cs1", to: "C1", op: 2, cell: [0, 1, -1] }] }] };
    const flipped = invertedModel(restrained).structure;
    const before = restraintRows(restrained.restraints!);
    const after = restraintRows(flipped.restraints!);
    expect(restraintValues(flipped, after.pairs, after.rows)[0]).toBeCloseTo(restraintValues(restrained, before.pairs, before.rows)[0]!, 10);
  });
});

describe("the twin of an inverted model", () => {
  const R: Mat3 = [[0, 1, 0], [1, 0, 0], [0, 0, -1]];
  const minusR: Mat3 = [[0, -1, 0], [-1, 0, 0], [0, 0, 1]];

  it("re-expresses a twin with both hands: each domain takes the fraction of its inverse", () => {
    // The first domain held −0.034: clamped, as a fraction is.
    const next = invertedTwinFractions([{ matrix: R }, INVERSION_TWIN, { matrix: minusR }], [0, 0.693, 0.341]);
    expect(next).toEqual([0.341, 0, 0]);
    expect(invertedTwinFractions([{ matrix: R }, INVERSION_TWIN, { matrix: minusR }], [0.05, 0.6, 0.3])).toEqual([0.3, expect.closeTo(0.05, 12), 0.05]);
  });

  it("turns a lone inversion twin's x into 1 − x, and keeps a merohedral law's fraction", () => {
    expect(invertedTwinFractions([INVERSION_TWIN], [0.3])).toEqual([0.7]);
    expect(invertedTwinFractions([{ matrix: R }], [0.34])).toEqual([0.34]);
  });
});

describe("the riding groups of an inverted model", () => {
  it("places each hydrogen where the inverted model has it, with the U factors and the shared U kept", () => {
    // A methyl on C1 and a CH₂ between it and C2: their hydrogens placed, then the model inverted.
    const base: StructureModel = {
      id: "r", name: "r", cell: { a: 8, b: 9, c: 10, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: buildSpaceGroup(19),
      sites: [
        { label: "C1", element: "C", position: [0.2, 0.2, 0.2], occupancy: 1, adp: iso },
        { label: "C2", element: "C", position: [0.2 + 1.53 / 8, 0.2, 0.2], occupancy: 1, adp: iso },
        { label: "C3", element: "C", position: [0.2 + 2.04 / 8, 0.2 + 1.44 / 9, 0.2], occupancy: 1, adp: iso },
        { label: "H1A", element: "H", position: [0.2 - 0.36 / 8, 0.2 + 0.9 / 9, 0.2], occupancy: 1, adp: iso },
        { label: "H1B", element: "H", position: [0.2 - 0.36 / 8, 0.2 - 0.45 / 9, 0.2 + 0.78 / 10], occupancy: 1, adp: iso },
        { label: "H1C", element: "H", position: [0.2 - 0.36 / 8, 0.2 - 0.45 / 9, 0.2 - 0.78 / 10], occupancy: 1, adp: iso },
        { label: "H2A", element: "H", position: [0.2 + 1.75 / 8, 0.2 - 0.55 / 9, 0.2 + 0.8 / 10], occupancy: 1, adp: iso },
        { label: "H2B", element: "H", position: [0.2 + 1.75 / 8, 0.2 - 0.55 / 9, 0.2 - 0.8 / 10], occupancy: 1, adp: iso },
      ],
    };
    const rules = ridingRules(base, { sharedU: [["methyl"]], uFactor: 1.3 }).rules;
    expect(rules.map((r) => r.geometry)).toEqual(["methyl", "methyl", "methyl", "methylene", "methylene"]);
    const sites = base.sites.map((s) => ({ ...s }));
    const placed = { ...base, riding: rules, sites };
    applyRiding(placed, sites);
    const flipped = invertedModel(placed).structure;
    const again = invertedRiding(rules, flipped);
    expect(again.map((r) => [r.site, r.geometry, r.uFactor, r.uShared])).toEqual(rules.map((r) => [r.site, r.geometry, r.uFactor, r.uShared]));
    // Placed afresh on the inverted model, every hydrogen sits where the inversion put it.
    const resites = flipped.sites.map((s) => ({ ...s }));
    applyRiding({ ...flipped, riding: again, sites: resites }, resites);
    resites.forEach((s, i) => s.position.forEach((x, k) => expect(x).toBeCloseTo(flipped.sites[i]!.position[k]!, 9)));
  });
});
