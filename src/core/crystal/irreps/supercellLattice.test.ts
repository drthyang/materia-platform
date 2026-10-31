/**
 * The subgroup lattice inside a supercell bound (supercellLattice.ts) through
 * its interface, against Bilbao's SUBGROUPS (ADR 0005: published counts only,
 * typed by hand with their source).
 *
 * Source: L. Elcoro, J. M. Perez-Mato & M. I. Aroyo, tutorial on the program
 * SUBGROUPS of the Bilbao Crystallographic Server,
 * https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf
 * (the PDF of 2018-08-16, read 2026-10-31; page numbers are the PDF's):
 *  - Example 1, Fm-3m, primitive supercell (½a−½b, ½a+½b, 2c): 99 subgroups
 *    (p. 3); 62 with "lowest crystal system" orthorhombic (p. 4); 20 down to
 *    point group mmm, drawn in Fig. 1.1: P4₂/ncm, P4₂/nmc, P4₂/mcm, P4₂/mmc,
 *    P4/ncc, P4/nmm, P4/mcc, P4/mmm, Ccce, Cmme, Cccm, Cmmm, Cmce, Cmcm, Pnma,
 *    Pmmn, Pccn, Pmma, Pccm, Pmmm (p. 4); 31 with the Landau (single-irrep)
 *    filter (p. 12).
 *  - Example 2, Pnma, supercell (a, b, 2c): 11 (p. 13); 4 maximal, Pca2₁,
 *    Pmc2₁, P2₁/c, P2₁/m (p. 15); 8 polar (p. 15); 6 Landau-type (p. 18).
 *  - Example 3, Pm-3m, I-centred supercell (a+b, −a+b, 2c): 98 (p. 21); 10
 *    maximal (p. 21), two of them I4/mcm differing in origin (p. 22).
 * SUBGROUPS lists the classes with a member whose lattice is the supercell
 * ("conjugates … whose supercell does not coincide with the one of the input,
 * are NOT shown", p. 6): `supercellLattice` below. It lists such a class once
 * per space-group type among those members, so a class holding both types of
 * an enantiomorphic pair is two entries (`enantiomorph`). With that rule every
 * Fm-3m number above follows from MATERIA's conjugacy classes: 99 = 96 + 3,
 * 62 = 60 + 2, 31 = 28 + 3. MATERIA keeps one entry per class.
 */
import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { classifyPointGroup } from "@/core/crystal/pointGroup";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups, SubgroupSearchTooLarge, type SubgroupClass, type SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import { irrepsInBound } from "@/core/crystal/irreps/spaceGroupIrreps";
import { irrepsFor } from "@/core/crystal/irreps/orderParameters";
import { iIsIdentity } from "@/core/crystal/irreps/rational";
import { inLattice, scaleVec, type SupercellMatrix, type SupercellSpec } from "@/core/crystal/irreps/supercell";

function lattice(sg: number | string, P: SupercellMatrix | SupercellSpec, name = true): SupercellLattice {
  return supercellSubgroups(factorGroup(buildSpaceGroup(sg).operations, P), { name });
}

const POLAR = new Set(["1", "2", "m", "mm2", "4", "4mm", "3", "3m", "6", "6mm"]);
/** The point groups in these lists that contain 222, mm2 or mmm (4, -4 and 4/m contain none). */
const DOWN_TO_ORTHORHOMBIC = new Set(["222", "mm2", "mmm", "422", "4mm", "-42m", "4/mmm"]);
const pointGroupOf = (c: SubgroupClass): string => classifyPointGroup(c.operations).symbol ?? "?";
/** SUBGROUPS' entries for a list of classes: one per space-group type, so a class with an enantiomorph counts twice. */
const entries = (classes: readonly SubgroupClass[]): number => classes.length + classes.filter((c) => c.enantiomorph).length;
/** The classes one irrep alone reaches (its isotropy subgroup is the class): SUBGROUPS' Landau filter. */
const landau = (group: FactorGroup, classes: readonly SubgroupClass[]): SubgroupClass[] => {
  const stars = irrepsInBound(group);
  return classes.filter((c) => irrepsFor(group, stars, c.elements).some((a) => a.reachesChild));
};

const FM3M_SUPERCELL: SupercellMatrix = [[0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 2]];
let fm3m: { group: FactorGroup; list: SubgroupClass[] } | null = null;
/** Fm-3m in (½a−½b, ½a+½b, 2c), named, its supercell list (computed once: a few seconds). */
const fm3mList = () => {
  if (!fm3m) {
    const group = factorGroup(buildSpaceGroup(225).operations, FM3M_SUPERCELL);
    fm3m = { group, list: supercellSubgroups(group).classes.filter((c) => c.supercellLattice) };
  }
  return fm3m;
};

describe("supercell subgroup lattice: Bilbao SUBGROUPS class counts", { timeout: 600_000 }, () => {
  it("Pnma, (a, b, 2c): 11 classes, 4 maximal (Pca2₁, Pmc2₁, P2₁/c, P2₁/m), 8 polar, 6 Landau-type", () => {
    const group = factorGroup(buildSpaceGroup(62).operations, [[1, 0, 0], [0, 1, 0], [0, 0, 2]]);
    const list = supercellSubgroups(group).classes.filter((c) => c.supercellLattice);
    expect(list).toHaveLength(11);
    const maximal = list.filter((c) => c.maximalInSupercell);
    expect(maximal.map((c) => c.identity?.number).sort((a, b) => a! - b!)).toEqual([11, 14, 26, 29]);
    expect(list.filter((c) => POLAR.has(pointGroupOf(c)))).toHaveLength(8);
    expect(landau(group, list)).toHaveLength(6);
    // No chiral type here: the entries are the classes.
    expect(entries(list)).toBe(11);
    // Every class of the list doubles the cell: k = 2.
    for (const c of list) expect(c.index.k).toBe(2);
  });

  it("Pm-3m, I-centred (a+b, −a+b, 2c): 98 classes, 10 maximal, two of them I4/mcm at different origins", () => {
    const L = lattice(221, { P: [[1, -1, 0], [1, 1, 0], [0, 0, 2]], centring: "I" });
    const list = L.classes.filter((c) => c.supercellLattice);
    expect(list).toHaveLength(98);
    const maximal = list.filter((c) => c.maximalInSupercell);
    expect(maximal).toHaveLength(10);
    const i4mcm = maximal.filter((c) => c.identity?.number === 140);
    expect(i4mcm).toHaveLength(2);
    const origin = (c: (typeof i4mcm)[number]) => (c.identity?.originShift ?? [0, 0, 0]).map((x) => x.toFixed(3)).join(",");
    expect(origin(i4mcm[0]!)).not.toBe(origin(i4mcm[1]!));
    // No chiral type here: the entries are the classes.
    expect(entries(list)).toBe(98);
  });

  it("Fm-3m, (½a−½b, ½a+½b, 2c): the 20 classes of Fig. 1.1 down to point group mmm", () => {
    const { list } = fm3mList();
    const mmmOrHigher = list.filter((c) => ["mmm", "4/mmm"].includes(pointGroupOf(c)));
    expect(mmmOrHigher.map((c) => c.identity?.number).sort((a, b) => a! - b!)).toEqual([47, 49, 51, 56, 59, 62, 63, 64, 65, 66, 67, 68, 123, 124, 129, 130, 131, 132, 137, 138]);
    expect(entries(mmmOrHigher)).toBe(20);
  });

  it("Fm-3m, (½a−½b, ½a+½b, 2c): 96 conjugacy classes, 99 SUBGROUPS entries — P4₁/P4₃, P4₁22/P4₃22, P4₁2₁2/P4₃2₁2 listed once per type", () => {
    const { list } = fm3mList();
    expect(list).toHaveLength(96);
    const pairs = list.filter((c) => c.enantiomorph).map((c) => [c.identity!.number!, c.enantiomorph!.number!].sort((a, b) => a - b).join("/"));
    expect(pairs.sort()).toEqual(["76/78", "91/95", "92/96"]);
    expect(entries(list)).toBe(99);
  });

  it("Fm-3m, (½a−½b, ½a+½b, 2c): 62 entries down to the orthorhombic system (60 classes), 31 Landau-type (28 classes)", () => {
    const { group, list } = fm3mList();
    // SUBGROUPS' "lowest crystal system" orthorhombic keeps the point groups that contain 222, mm2 or mmm.
    const downToOrthorhombic = list.filter((c) => DOWN_TO_ORTHORHOMBIC.has(pointGroupOf(c)));
    expect(downToOrthorhombic).toHaveLength(60);
    expect(entries(downToOrthorhombic)).toBe(62);
    const single = landau(group, list);
    expect(single).toHaveLength(28);
    expect(entries(single)).toBe(31);
    // Of the six primitive mmm classes (Fig. 1.2) only Pnma and Pmma are Landau-type, both from DT5 (pp. 8–9).
    const primitiveMmm = [47, 49, 51, 56, 59, 62];
    expect(single.map((c) => c.identity?.number ?? 0).filter((n) => primitiveMmm.includes(n)).sort((a, b) => a - b)).toEqual([51, 62]);
  });
});

/**
 * An independent count: every subgroup of F that contains the supercell's
 * translations and has exactly them, found by cyclic extension (H → ⟨H, x⟩
 * for every x), against the HS85 search's conjugacy classes expanded to their
 * members that keep the supercell's lattice.
 */
function bruteForceExact(group: FactorGroup): number {
  const F = group.elements.length;
  const { D, supercell } = group.bound;
  const N = group.translations.filter((t) => inLattice(supercell, scaleVec(group.elements[t]!.w, D)));
  const isT = group.elements.map((e) => iIsIdentity(e.W));
  const seen = new Uint8Array(F);
  const close = (gens: readonly number[]): number[] | null => {
    seen.fill(0);
    const out = [group.identity];
    seen[group.identity] = 1;
    let translations = 1;
    for (let i = 0; i < out.length; i++) {
      for (const g of gens) {
        const c = group.table[out[i]!]![g]!;
        if (seen[c]) continue;
        seen[c] = 1;
        out.push(c);
        if (isT[c] && ++translations > N.length) return null;
      }
    }
    return out.sort((a, b) => a - b);
  };
  const start = close(N)!;
  const found = new Map<string, readonly number[]>([[start.join(","), N]]);
  const queue: { H: number[]; gens: readonly number[] }[] = [{ H: start, gens: N }];
  while (queue.length > 0) {
    const { H, gens } = queue.pop()!;
    const inH = new Uint8Array(F);
    for (const h of H) inH[h] = 1;
    for (let x = 0; x < F; x++) {
      if (inH[x] || isT[x]) continue;
      const K = close([...gens, x]);
      if (!K) continue;
      const key = K.join(",");
      if (!found.has(key)) {
        found.set(key, [...gens, x]);
        queue.push({ H: K, gens: [...gens, x] });
      }
    }
  }
  return found.size;
}

describe("supercell subgroup lattice: the HS85 search against brute force", { timeout: 600_000 }, () => {
  // Fm-3m in Bilbao's (½a−½b, ½a+½b, 2c): 231 subgroups with the supercell's lattice, in 96 classes (THY-48).
  for (const [name, sg, P] of [["Pnma (a,b,2c)", 62, [[1, 0, 0], [0, 1, 0], [0, 0, 2]]], ["P4/mmm (a,b,2c)", 123, [[1, 0, 0], [0, 1, 0], [0, 0, 2]]], ["P4/mmm √2×√2×1", 123, [[1, -1, 0], [1, 1, 0], [0, 0, 1]]], ["Fm-3m (½a−½b,½a+½b,2c)", 225, FM3M_SUPERCELL]] as const) {
    it(`${name}: the same subgroups with the supercell's lattice`, () => {
      const group = factorGroup(buildSpaceGroup(sg).operations, P as unknown as number[][]);
      const L = supercellSubgroups(group, { name: false });
      const { D, supercell } = group.bound;
      const N = new Set(group.translations.filter((t) => inLattice(supercell, scaleVec(group.elements[t]!.w, D))));
      // Expand each class to its members with T_H = T′.
      let members = 0;
      for (const c of L.classes) {
        const seen = new Set<string>();
        for (let g = 0; g < group.elements.length; g++) {
          const H = c.elements.map((h) => group.table[group.table[g]![h]!]![group.inverse[g]!]!).sort((a, b) => a - b);
          const key = H.join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          const T = H.filter((h) => iIsIdentity(group.elements[h]!.W));
          if (T.length === N.size && T.every((t) => N.has(t))) members++;
        }
      }
      expect(members).toBe(bruteForceExact(group));
    });
  }
});

describe("supercell subgroup lattice: structure", { timeout: 600_000 }, () => {
  it("Pm-3m in 2×2×2: the parent first, t·k = index, covers form a lattice, the cell-multiplying children named with (P_H, p_H)", () => {
    const L = lattice(221, [[2, 0, 0], [0, 2, 0], [0, 0, 2]], false);
    expect(L.classes[0]!.kind).toBe("parent");
    for (const c of L.classes) {
      expect(c.index.t * c.index.k).toBe(c.domainStates);
      expect(c.domainStates % c.orientationStates === 0 || c.orientationStates % 1 === 0).toBe(true);
      if (c.id !== 0) expect(c.coveredBy.length).toBeGreaterThan(0);
      for (const u of c.coveredBy) expect(L.classes[u]!.order).toBeGreaterThan(c.order);
    }
    // The isomorphic k-subgroups of index 8 (Pm-3m in 2a×2b×2c) are found and flagged.
    const named = lattice(221, [[2, 0, 0], [0, 2, 0], [0, 0, 2]], true);
    const iso = named.classes.filter((c) => c.isomorphic);
    expect(iso.length).toBeGreaterThan(0);
    for (const c of iso) {
      expect(c.cellMultiplying).toBe(true);
      expect(c.identity?.number).toBe(221);
      expect(c.identity?.basis).toBeDefined();
    }
    // R-point children: Fm-3m (index 2, F lattice of the 2×2×2 cell) is a cell-multiplying k-subgroup.
    const fm3m = named.classes.filter((c) => c.identity?.number === 225 && c.kind === "k");
    expect(fm3m.length).toBeGreaterThan(0);
    for (const c of fm3m) expect([c.index.t, c.index.k, c.cellMultiplying]).toEqual([1, 2, true]);
  });

  it("every class's representative is a subgroup with T_H ⊇ T′, closed under the group law", () => {
    const group = factorGroup(buildSpaceGroup(62).operations, [[1, 0, 0], [0, 1, 0], [0, 0, 2]]);
    const L = supercellSubgroups(group, { name: false });
    for (const c of L.classes) {
      const set = new Set(c.elements);
      for (const a of c.elements) for (const b of c.elements) expect(set.has(group.table[a]![b]!)).toBe(true);
      const translations = c.elements.filter((i) => iIsIdentity(group.elements[i]!.W)).length;
      expect(group.translations.length / translations).toBe(c.index.k);
    }
  });

  it("refuses a bound above the measured ceiling instead of truncating", () => {
    // Pmmm in an 8a×4b×16c cell: |F| = 8 · 512 = 4096 elements, above the ceiling.
    const group = factorGroup(buildSpaceGroup(47).operations, [[8, 0, 0], [0, 4, 0], [0, 0, 16]]);
    expect(() => supercellSubgroups(group)).toThrow(SubgroupSearchTooLarge);
  });

  it("a maximum index bounds the list", () => {
    const L = lattice(221, [[2, 0, 0], [0, 2, 0], [0, 0, 2]], false);
    const capped = supercellSubgroups(factorGroup(buildSpaceGroup(221).operations, [[2, 0, 0], [0, 2, 0], [0, 0, 2]]), { maxIndex: 8, name: false });
    expect(capped.classes.every((c) => c.domainStates <= 8)).toBe(true);
    expect(capped.classes.length).toBe(L.classes.filter((c) => c.domainStates <= 8).length);
  });
});
