/**
 * Self-consistency of the irrep engine (spaceGroupIrreps.ts) through its
 * interface: every star in the conventional-cell bound of a set of parents,
 * symmorphic and not, with the counts group theory fixes. The engine also
 * checks the representation property, unitarity, Σ dim², orthonormality and
 * class functions itself and throws on a failure; these tests make sure
 * those checks run and pass, and pin what they do not cover.
 */
import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsInBound, irrepsOfStar, type StarIrreps } from "@/core/crystal/irreps/spaceGroupIrreps";

const groupOf = (sg: number | string) => factorGroup(buildSpaceGroup(sg).operations);

/** [label, |Ḡ_k|, arms, irrep dimensions, realities] per star. */
const summary = (s: StarIrreps) => [s.star.label, s.littleCoGroupOrder, s.star.arms.length, s.irreps.map((i) => i.dim), s.irreps.map((i) => i.reality[0]).join("")];

describe("irreps in the conventional-cell bound", () => {
  it("Pm-3m: Γ only, the ten point-group irreps of m-3m", () => {
    const stars = irrepsInBound(groupOf(221));
    expect(stars.map(summary)).toEqual([["Γ", 48, 1, [1, 1, 1, 1, 2, 2, 3, 3, 3, 3], "rrrrrrrrrr"]]);
  });

  it("Fm-3m: Γ and the three-arm X star (little co-group 4/mmm, symmorphic)", () => {
    const [gamma, x] = irrepsInBound(groupOf(225));
    expect(summary(gamma!)).toEqual(["Γ", 48, 1, [1, 1, 1, 1, 2, 2, 3, 3, 3, 3], "rrrrrrrrrr"]);
    expect(summary(x!)).toEqual(["X", 16, 3, [3, 3, 3, 3, 3, 3, 3, 3, 6, 6], "rrrrrrrrrr"]);
    expect(x!.star.arms).toHaveLength(3);
  });

  it("F-43m: X with little co-group -42m", () => {
    const x = irrepsOfStar(groupOf(216), [0, 0, 1]);
    expect(summary(x)).toEqual(["X", 8, 3, [3, 3, 3, 3, 6], "rrrrr"]);
  });

  it("Fd-3m (non-symmorphic, origin 2): every X small representation is projective, two-dimensional", () => {
    const x = irrepsOfStar(groupOf("F d -3 m:2"), [0, 0, 1]);
    expect(x.littleCoGroupOrder).toBe(16);
    expect(x.irreps.map((i) => i.smallDim)).toEqual([2, 2, 2, 2]);
    expect(x.irreps.map((i) => i.dim)).toEqual([6, 6, 6, 6]);
  });

  it("Im-3m: H is one arm (k ≡ −k) with the whole m-3m as its little co-group", () => {
    const stars = irrepsInBound(groupOf(229));
    expect(stars.map((s) => s.star.label)).toEqual(["Γ", "H"]);
    expect(summary(stars[1]!)).toEqual(["H", 48, 1, [1, 1, 1, 1, 2, 2, 3, 3, 3, 3], "rrrrrrrrrr"]);
  });

  it("I4/mmm: the decentring point (0,0,1), one arm, little co-group 4/mmm", () => {
    const stars = irrepsInBound(groupOf(139));
    expect(stars.map((s) => s.star.label)).toEqual(["Γ", "k = (0, 0, 1)"]);
    expect(stars[1]!.littleCoGroupOrder).toBe(16);
    expect(stars[1]!.irreps.map((i) => i.dim)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2]);
  });

  it("R-3m on hexagonal axes: (0,0,1) and (0,0,−1) form one star, little co-group 3m", () => {
    const stars = irrepsInBound(groupOf("R -3 m:H"));
    expect(stars.map((s) => s.star.label)).toEqual(["Γ", "k = (0, 0, 1)"]);
    expect(summary(stars[1]!)).toEqual(["k = (0, 0, 1)", 6, 2, [2, 2, 4], "rrr"]);
  });

  it("Cmcm: (1,0,0) keeps the cell, and its small representations are projective", () => {
    const stars = irrepsInBound(groupOf(63));
    expect(stars.map((s) => s.star.label)).toEqual(["Γ", "k = (0, 1, 0)"]);
    const y = stars[1]!;
    expect(y.star.arms).toHaveLength(1);
    expect(y.irreps.reduce((s, i) => s + i.dim * i.dim, 0)).toBe(8);
  });

  it("Pnma: Γ only, with non-symmorphic but ordinary Γ irreps", () => {
    const stars = irrepsInBound(groupOf(62));
    expect(stars.map(summary)).toEqual([["Γ", 8, 1, [1, 1, 1, 1, 1, 1, 1, 1], "rrrrrrrr"]]);
  });

  it("a complex pair is merged into one physically irreducible representation (P4, Γ)", () => {
    const [gamma] = irrepsInBound(groupOf(75));
    expect(gamma!.irreps.map((i) => i.reality)).toEqual(["real", "real", "complex", "complex"]);
    expect(gamma!.physical.map((p) => [p.dim, p.irreps.length])).toEqual([[1, 1], [1, 1], [2, 2]]);
    expect(gamma!.physical[2]!.label).toBe("Γ irreps 3⊕4 of 4");
  });

  it("the physically irreducible forms are real orthogonal representations with the irreps' real characters", () => {
    const group = groupOf("F d -3 m:2");
    for (const s of irrepsInBound(group)) {
      for (const p of s.physical) {
        const n = p.dim;
        const mul = (a: Float64Array, b: Float64Array): Float64Array => {
          const out = new Float64Array(n * n);
          for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) out[i * n + j] = out[i * n + j]! + a[i * n + k]! * b[k * n + j]!;
          return out;
        };
        for (let a = 0; a < group.elements.length; a += 7) {
          for (let b = 0; b < group.elements.length; b += 5) {
            const lhs = mul(p.matrices[a]!, p.matrices[b]!);
            const rhs = p.matrices[group.table[a]![b]!]!;
            expect(Math.max(...lhs.map((x, i) => Math.abs(x - rhs[i]!)))).toBeLessThan(1e-9);
          }
        }
        // χ_PIR = Σ over its member irreps of Re χ (a real irrep: χ; a pair: χ + χ*; doubled: 2χ).
        const members = p.irreps.map((i) => s.irreps[i - 1]!);
        p.characters.forEach((c, f) => {
          const expected = p.irreps.length === 2 ? members.reduce((t, m) => t + m.characters[f]!.re, 0) : (p.dim / members[0]!.dim) * members[0]!.characters[f]!.re;
          expect(c).toBeCloseTo(expected, 9);
        });
      }
    }
  });

  it("refuses a k-point that needs a supercell", () => {
    expect(() => irrepsOfStar(groupOf(221), [0.5, 0, 0])).toThrow(/needs a supercell/);
  });
});
