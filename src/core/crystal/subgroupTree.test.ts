/**
 * Gates for the structural translationengleiche subgroup lattice:
 *  - the m-3m golden: O_h has exactly 98 t-subgroups (Bilbao/ITA1), three
 *    index-2 maximal subgroups (P432, P-43m, Pm-3), conjugate 4/mmm (×3) and
 *    -3m (×4) classes, and a covering chain down to P1;
 *  - Pnma (point group mmm ≅ (C₂)³): exactly 16 subgroups (the subspaces of
 *    𝔽₂³), operations closed and index-consistent — the non-symmorphic case,
 *    verifying intrinsic glide/screw translations ride along on each node;
 *  - P1: the trivial one-node lattice;
 *  - each node's operations feed `realizeSubgroup` (subgroup-driven activation);
 *  - a centred parent: every node keeps the parent's centring translations
 *    and is named in its standard setting (Fm-3m: I4/mmm, R-3m, Fmmm…, the
 *    maximal t-subgroups of ITA A1), and its realized child keeps the
 *    parent's sites (NaCl's Na 4a stays one site), for F, I and R lattices.
 */
import { describe, it, expect } from "vitest";
import type { StructureModel, UnitCell, AtomSite } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { composeOperations } from "@/core/crystal/symmetry";
import { rotationKey } from "@/core/magnetic/magneticGroups";
import { realizeSubgroup } from "@/core/crystal/isotropyTree";
import { formatBasis } from "@/core/crystal/standardSetting";
import { structuralSubgroupLattice, subgroupClassRepresentatives } from "@/core/crystal/subgroupTree";

const CELL: UnitCell = { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 };
function site(label: string, position: readonly [number, number, number]): AtomSite {
  return { label, element: "Sr", position, occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } };
}
function structure(sgId: number, sites: AtomSite[], cell: UnitCell = CELL): StructureModel {
  return { id: "t", name: "t", cell, spaceGroup: buildSpaceGroup(sgId), sites };
}

describe("m-3m (Pm-3m) subgroup lattice — golden", () => {
  const tree = structuralSubgroupLattice(structure(221, [site("A", [0, 0, 0])]));

  it("enumerates all 98 translationengleiche subgroups", () => {
    expect(tree.nodes.length).toBe(98);
    expect(tree.truncated).toBe(false);
  });

  it("puts the whole group first, named Pm-3m (#221)", () => {
    const parent = tree.nodes.find((n) => n.id === tree.parentId)!;
    expect(parent).toBe(tree.nodes[0]); // index ascending → parent first
    expect(parent.isParent).toBe(true);
    expect(parent.index).toBe(1);
    expect(parent.order).toBe(48);
    expect(parent.identity.number).toBe(221);
  });

  it("has the three index-2 maximal subgroups P432, P-43m, Pm-3", () => {
    const idx2 = tree.nodes.filter((n) => n.index === 2);
    expect(idx2.length).toBe(3);
    expect(new Set(idx2.map((n) => n.identity.number))).toEqual(new Set([207, 215, 200]));
    expect(new Set(idx2.map((n) => n.pointGroup))).toEqual(new Set(["432", "-43m", "m-3"]));
  });

  it("links the parent's covering (maximal) subgroups — 3×i2 + 3×i3 + 4×i4 = 10", () => {
    const parent = tree.nodes[0]!;
    expect(parent.maximalSubgroupIds.length).toBe(10);
    const covers = parent.maximalSubgroupIds.map((id) => tree.nodes.find((n) => n.id === id)!);
    expect(covers.filter((n) => n.index === 2).length).toBe(3);
    expect(covers.filter((n) => n.pointGroup === "4/mmm").length).toBe(3);
    expect(covers.filter((n) => n.pointGroup === "-3m").length).toBe(4);
  });

  it("groups conjugate subgroups into classes (4/mmm ×3, -3m ×4)", () => {
    const fourMmm = tree.nodes.filter((n) => n.pointGroup === "4/mmm");
    expect(fourMmm.length).toBe(3);
    expect(new Set(fourMmm.map((n) => n.conjugacyClassId)).size).toBe(1); // one class
    expect(fourMmm.every((n) => n.conjugates === 3)).toBe(true);
    expect(fourMmm.filter((n) => n.classRepresentative).length).toBe(1);

    const bar3m = tree.nodes.filter((n) => n.pointGroup === "-3m");
    expect(bar3m.length).toBe(4);
    expect(bar3m.every((n) => n.conjugates === 4)).toBe(true);
  });

  it("counts the conjugates [G : N_G(H)] and the domain states [G : H] apart (P4mm: 3 orientations, 6 states)", () => {
    // Janovec (ITA D, Ch. 3.4): each of the 3 orientations of the polar axis
    // holds 2 domain states (±P) with the same symmetry, so 6 in all.
    const p4mm = tree.nodes.filter((n) => n.identity.number === 99);
    expect(p4mm.length).toBe(3);
    expect(p4mm.every((n) => n.conjugates === 3 && n.domainStates === 6)).toBe(true);
    // A normal subgroup has one conjugate and still [G : H] states: Pm-3 (index 2) is the ±1 pair.
    const pm3 = tree.nodes.find((n) => n.identity.number === 200)!;
    expect([pm3.conjugates, pm3.domainStates]).toEqual([1, 2]);
    for (const n of tree.nodes) expect(n.domainStates % n.conjugates).toBe(0);
  });

  it("names the subgroups whose axes are the cube's diagonals in their own cells (Amm2, Cmmm, R3m)", () => {
    const names = new Set(tree.nodes.map((n) => n.identity.number));
    for (const n of [38, 65, 160, 166, 35, 12, 8]) expect(names.has(n), `#${n}`).toBe(true);
    expect(tree.nodes.every((n) => n.identity.number !== undefined)).toBe(true);
    const r3m = tree.nodes.find((n) => n.identity.number === 160)!;
    expect(r3m.identity.method).toBe("conventional-cell");
    expect(r3m.identity.hermannMauguin).toBe("R 3 m:H");
  });

  it("class-representative view is a smaller, deduplicated list", () => {
    const reps = subgroupClassRepresentatives(tree);
    expect(reps.length).toBeLessThan(tree.nodes.length);
    expect(reps.length).toBeGreaterThan(0);
    // Every conjugacy class has exactly one representative.
    const classIds = new Set(tree.nodes.map((n) => n.conjugacyClassId));
    expect(reps.length).toBe(classIds.size);
  });

  it("has a covering chain from the parent down to P1", () => {
    const trivial = tree.nodes.find((n) => n.isTrivial)!;
    expect(trivial.order).toBe(1);
    expect(trivial.index).toBe(48);
    expect(trivial.pointGroup).toBe("1");
    // Greedy descent through covering edges reaches the trivial node.
    let cur = tree.nodes[0]!;
    const visited = new Set([cur.id]);
    while (!cur.isTrivial && cur.maximalSubgroupIds.length > 0) {
      const next = cur.maximalSubgroupIds
        .map((id) => tree.nodes.find((n) => n.id === id)!)
        .sort((a, b) => b.order - a.order)[0]!;
      if (visited.has(next.id)) break;
      visited.add(next.id);
      cur = next;
    }
    expect(cur.isTrivial).toBe(true);
  });

  it("maxIndex truncates the lattice", () => {
    const capped = structuralSubgroupLattice(structure(221, [site("A", [0, 0, 0])]), { maxIndex: 2 });
    expect(capped.truncated).toBe(true);
    expect(capped.nodes.every((n) => n.index <= 2)).toBe(true);
    expect(capped.nodes.length).toBe(4); // parent + 3 index-2
  });
});

describe("Pnma (mmm ≅ (C₂)³) — non-symmorphic, 16 subgroups", () => {
  const tree = structuralSubgroupLattice(
    structure(62, [site("A", [0.1, 0.25, 0.2])], { a: 7, b: 5, c: 8, alpha: 90, beta: 90, gamma: 90 }),
  );

  it("has exactly 16 t-subgroups (subspaces of 𝔽₂³)", () => {
    expect(tree.nodes.length).toBe(16);
    expect(tree.nodes[0]!.identity.number).toBe(62);
  });

  it("every node is index-consistent and closed under composition", () => {
    const N = 8;
    for (const n of tree.nodes) {
      expect(n.order * n.index).toBe(N);
      const keys = new Set(n.operations.map(rotationKey));
      for (const a of n.operations) {
        for (const b of n.operations) {
          expect(keys.has(rotationKey(composeOperations(a, b)))).toBe(true);
        }
      }
    }
  });
});

describe("P1 — trivial lattice", () => {
  it("is a single self-parent, self-trivial node", () => {
    const tree = structuralSubgroupLattice(structure(1, [site("A", [0.3, 0.3, 0.3])]));
    expect(tree.nodes.length).toBe(1);
    const only = tree.nodes[0]!;
    expect(only.isParent).toBe(true);
    expect(only.isTrivial).toBe(true);
    expect(only.index).toBe(1);
    expect(only.order).toBe(1);
  });
});

describe("nodes feed realizeSubgroup (subgroup-driven activation)", () => {
  it("realizes the Pm-3 (#200) child from its node operations", () => {
    const parent = structure(221, [site("A", [0, 0, 0])]);
    const tree = structuralSubgroupLattice(parent);
    const pm3 = tree.nodes.find((n) => n.identity.number === 200)!;
    const child = realizeSubgroup(parent, pm3.operations, pm3.identity);
    expect(child.spaceGroup.operations.length).toBe(24);
    expect(child.spaceGroup.number).toBe(200); // direct match → standard name stamped
    expect(child.sites.length).toBe(1); // the 1a site at the origin stays one orbit
  });
});

describe("a centred parent: the nodes keep its centring and are named in their standard settings", () => {
  const cubic = (a: number): UnitCell => ({ a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 });
  const nacl: StructureModel = {
    id: "nacl", name: "NaCl", cell: cubic(5.64), spaceGroup: buildSpaceGroup(225),
    sites: [{ ...site("Na", [0, 0, 0]), element: "Na" }, { ...site("Cl", [0.5, 0.5, 0.5]), element: "Cl" }],
  };
  const tree = structuralSubgroupLattice(nacl);

  it("names the parent Fm-3m (#225), not Pm-3m, and every node (98)", () => {
    expect(tree.nodes.length).toBe(98);
    expect(tree.nodes[0]!.identity).toMatchObject({ number: 225, hermannMauguin: "F m -3 m", method: "direct" });
    expect(tree.nodes[0]!.operations.length).toBe(192);
    expect(tree.nodes.every((n) => n.identity.number !== undefined)).toBe(true);
    // Every node carries the four F translations on each coset.
    for (const n of tree.nodes) expect(n.operations.length).toBe(4 * n.cosetOperations.length);
  });

  it("finds the maximal t-subgroups of ITA A1: F-43m, Fm-3, F432 (index 2), I4/mmm (3), R-3m (4)", () => {
    const at = (index: number): Set<number | undefined> => new Set(tree.nodes.filter((n) => n.index === index).map((n) => n.identity.number));
    expect(at(2)).toEqual(new Set([216, 202, 209]));
    expect(at(3)).toEqual(new Set([139]));
    expect(at(4)).toEqual(new Set([166, 196]));
    // Index 6: the subgroups of I4/mmm, Immm with the face diagonals, and Fmmm.
    expect(at(6)).toEqual(new Set([119, 107, 71, 121, 87, 69, 97]));
  });

  it("names the 4/mmm subgroup I4/mmm (#139) in its own cell a′ = (a−b)/2, b′ = (a+b)/2, c′ = c", () => {
    const along = tree.nodes.filter((n) => n.pointGroup === "4/mmm");
    expect(along.length).toBe(3);
    expect(along.every((n) => n.identity.number === 139 && n.identity.hermannMauguin === "I 4/m m m")).toBe(true);
    const c = along.find((n) => n.identity.inParentCell === "F 4/m m m")!;
    expect(c.identity.method).toBe("conventional-cell");
    expect(formatBasis(c.identity.basis!)).toBe("a′ = (a+b)/2, b′ = (−a+b)/2, c′ = c");
    expect(c.operations.length).toBe(64);
  });

  it("realizes F4/mmm with Na 4a and Cl 4b each still one site (once split into three by a primitive child)", () => {
    const node = tree.nodes.find((n) => n.identity.inParentCell === "F 4/m m m")!;
    const child = realizeSubgroup(nacl, node.operations, node.identity);
    expect(child.spaceGroup.operations.length).toBe(64);
    expect(child.sites.map((s) => s.label)).toEqual(["Na", "Cl"]);
    // The listed non-standard setting is stamped (the operations are exactly it).
    expect(child.spaceGroup).toMatchObject({ number: 139, hermannMauguin: "F 4/m m m" });
    // The other two orientations have no tabulated setting in the cubic cell: no symbol is stamped.
    const other = tree.nodes.find((n) => n.pointGroup === "4/mmm" && n.identity.inParentCell === undefined)!;
    const child2 = realizeSubgroup(nacl, other.operations, other.identity);
    expect(child2.sites.length).toBe(2);
    expect(child2.spaceGroup.hermannMauguin).toBeUndefined();
  });

  it("names zincblende's (F-43m) subgroups: F23, I-4m2, R3m, Imm2, F222, Cm, P1", () => {
    const zb = structuralSubgroupLattice({ ...nacl, spaceGroup: buildSpaceGroup(216), sites: [site("Zn", [0, 0, 0]), site("S", [0.25, 0.25, 0.25])] });
    expect(zb.nodes.length).toBe(30);
    const numbers = new Set(zb.nodes.map((n) => n.identity.number));
    for (const n of [216, 196, 119, 160, 82, 44, 22, 146, 5, 8, 1]) expect(numbers.has(n), `#${n}`).toBe(true);
    const r3m = zb.nodes.filter((n) => n.identity.number === 160);
    expect(r3m.length).toBe(4); // the four <111> axes
    expect(r3m.every((n) => n.conjugates === 4 && n.domainStates === 4)).toBe(true);
    const triclinic = zb.nodes.find((n) => n.isTrivial)!;
    expect(triclinic.identity).toMatchObject({ number: 1, hermannMauguin: "P 1", inParentCell: "F 1" });
  });

  it("an I-centred parent (Im-3m): Fmmm on the face diagonals, I4/mmm, R-3m, each child keeping the bcc site", () => {
    const bcc: StructureModel = { ...nacl, spaceGroup: buildSpaceGroup(229), sites: [site("W", [0, 0, 0])] };
    const lattice = structuralSubgroupLattice(bcc);
    expect(lattice.nodes[0]!.identity.number).toBe(229);
    const fmmm = lattice.nodes.find((n) => n.identity.number === 69)!;
    expect(fmmm.pointGroup).toBe("mmm");
    expect(fmmm.identity.method).toBe("conventional-cell");
    for (const n of lattice.nodes) {
      expect(n.operations.length).toBe(2 * n.cosetOperations.length);
      expect(realizeSubgroup(bcc, n.operations, n.identity).sites.length).toBe(1);
    }
  });

  it("an R-centred parent (R-3m, hexagonal axes): R3m, R32, R-3 and C2/m, the R translations kept (3a stays one site)", () => {
    const r: StructureModel = { ...nacl, cell: { a: 3, b: 3, c: 15, alpha: 90, beta: 90, gamma: 120 }, spaceGroup: buildSpaceGroup("R -3 m:H"), sites: [site("Bi", [0, 0, 0])] };
    const lattice = structuralSubgroupLattice(r);
    expect(lattice.nodes.length).toBe(16);
    const numbers = new Set(lattice.nodes.map((n) => n.identity.number));
    for (const n of [166, 160, 155, 148, 146, 12, 5, 8, 2, 1]) expect(numbers.has(n), `#${n}`).toBe(true);
    for (const n of lattice.nodes) {
      expect(n.operations.length).toBe(3 * n.cosetOperations.length);
      expect(realizeSubgroup(r, n.operations, n.identity).sites.length).toBe(1);
    }
    const c2m = lattice.nodes.filter((n) => n.identity.number === 12);
    expect(c2m.length).toBe(3);
    expect(c2m.every((n) => n.conjugates === 3 && n.domainStates === 3)).toBe(true);
  });
});
