/**
 * Isotropy subgroups by the image method (isotropy.ts) through its interface:
 * the invariants every list must satisfy, for Γ and the decentring stars of
 * centred parents, and the decentring k-subgroups group theory fixes by hand.
 *
 * Hand-derived counts: a decentring irrep at a one-arm star with a
 * one-dimensional small representation has the kernel as its only isotropy
 * subgroup, and those subgroups are the parent's lattice-halving k-subgroups,
 * one per one-dimensional real character of the little co-group (a
 * homomorphism to the lost centring). Im-3m has four (m-3m's four
 * one-dimensional irreps), I4/mmm eight (4/mmm's eight): the P cubic groups
 * Pm-3m, Pn-3n, Pm-3n, Pn-3m and the eight P4/m.. and P4₂/m.. groups, as the
 * maximal klassengleiche subgroups of type IIa in ITA Vol. A1 list them.
 */
import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsInBound } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups, type IrrepIsotropySubgroup } from "@/core/crystal/irreps/isotropy";

const setting = (sg: number | string) => factorGroup(buildSpaceGroup(sg).operations);

function analyse(sg: number | string) {
  const group = setting(sg);
  return { group, stars: irrepsInBound(group).map((s) => ({ s, iso: s.physical.map((p) => ({ p, a: isotropySubgroups(group, p) })) })) };
}

const numbers = (subs: readonly IrrepIsotropySubgroup[]) => subs.map((x) => x.identity.number);

describe("isotropy subgroups by the image method", () => {
  for (const sg of [225, 216, "F d -3 m:2", 229, 139, "R -3 m:H", 63] as const) {
    it(`${sg}: one kernel each, last; t·k = [G : H]; the direction's stabilizer is the subgroup; every child named`, () => {
      const { group, stars } = analyse(sg);
      for (const { s, iso } of stars) {
        for (const { p, a } of iso) {
          const subs = a.subgroups;
          expect(subs.filter((x) => x.kernel), p.label).toHaveLength(1);
          expect(subs[subs.length - 1]!.kernel).toBe(true);
          expect(subs[subs.length - 1]!.direction.dim).toBe(p.dim);
          for (const x of subs) {
            expect(x.index.t * x.index.k, `${p.label} ${x.direction.symbol}`).toBe(x.domainStates);
            expect(x.domainStates % x.orientationStates).toBe(0);
            expect(x.identity.number, `${p.label} ${x.direction.symbol}`).toBeDefined();
            // Γ keeps every centring; a decentring irrep loses some.
            if (s.star.name === "Γ") expect(x.index.k).toBe(1);
            else expect(x.index.k).toBeGreaterThan(1);
            // The stabilizer of the direction (pointwise) is exactly the subgroup.
            const n = p.dim;
            const fixes = (f: number): boolean => x.direction.basis.every((b) => {
              const D = p.matrices[f]!;
              for (let i = 0; i < n; i++) {
                let v = 0;
                for (let j = 0; j < n; j++) v += D[i * n + j]! * b[j]!;
                if (Math.abs(v - b[i]!) > 1e-7) return false;
              }
              return true;
            });
            const stab = group.elements.map((_, f) => f).filter(fixes);
            expect(stab).toEqual([...x.elements].sort((u, v) => u - v));
          }
        }
      }
    });
  }

  it("Im-3m H: the four primitive cubic k-subgroups of index 2, one per one-dimensional irrep", () => {
    const { stars } = analyse(229);
    const h = stars.find(({ s }) => s.star.name === "H")!;
    const oneDim = h.iso.filter(({ p }) => p.dim === 1).map(({ a }) => a.subgroups);
    expect(oneDim.map((subs) => subs.length)).toEqual([1, 1, 1, 1]);
    expect(oneDim.map((subs) => subs[0]!.identity.number).sort()).toEqual([221, 222, 223, 224]);
    for (const subs of oneDim) expect([subs[0]!.index, subs[0]!.orientationStates, subs[0]!.domainStates]).toEqual([{ t: 1, k: 2 }, 1, 2]);
  });

  it("I4/mmm (0,0,1): the eight primitive tetragonal k-subgroups of index 2", () => {
    const { stars } = analyse(139);
    const oneDim = stars[1]!.iso.filter(({ p }) => p.dim === 1).map(({ a }) => numbers(a.subgroups));
    expect(oneDim.flat().sort((a, b) => a! - b!)).toEqual([123, 126, 128, 129, 131, 134, 136, 137]);
  });

  it("Fm-3m X: the primitive cubic k-subgroups Pm-3m and Pn-3m (index 4) with all three arms equal", () => {
    const { stars } = analyse(225);
    const cubic = stars[1]!.iso.flatMap(({ a }) => a.subgroups).filter((x) => x.index.t === 1);
    expect(cubic.map((x) => x.identity.number).sort()).toEqual([221, 224]);
    for (const x of cubic) expect([x.domainStates, x.orientationStates]).toEqual([4, 4]);
  });

  it("F-43m X: P2₁3 (index 8 = 2·4) from the six-dimensional irrep — GaNb₄Se₈'s local symmetry", () => {
    const { stars } = analyse(216);
    const six = stars[1]!.iso.find(({ p }) => p.dim === 6)!;
    const p213 = six.a.subgroups.find((x) => x.identity.number === 198)!;
    expect(p213).toBeDefined();
    expect([p213.index, p213.domainStates, p213.direction.dim]).toEqual([{ t: 2, k: 4 }, 8, 1]);
    // Its operations keep no centring translation.
    expect(p213.operations).toHaveLength(12);
  });
});
