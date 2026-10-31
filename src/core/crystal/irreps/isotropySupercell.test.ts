/**
 * Isotropy subgroups, coupled and secondary irreps at the cell-multiplying
 * k-points of the 2×2×2 supercell bound, through the module interfaces.
 *
 * Published references (hand-typed, with their source):
 *  - Pm-3m R3+ gives I4/mmm (a,0), I4/mcm (0,a) and Fmmm (a,b) (Stokes, van
 *    Orden & Campbell, J. Appl. Cryst. 49 (2016) 1849, Fig. 3).
 *  - Pm-3m R4+ alone gives 6 classes with P-1 the kernel (Bilbao SUBGROUPS
 *    tutorial, docs/research/SUBGROUP_ENGINES.md §7): I4/mcm, Imma, R-3c,
 *    C2/m, C2/c, P-1.
 *  - Pm-3m M3+ (a,0,0) gives P4/mbm; R4+ (a,a,0) gives Imma; coupled they
 *    give Pnma, the GdFeO₃ tilt system (Campbell et al., J. Appl. Cryst. 39
 *    (2006) 607, §4.6).
 *  - Pm-3m X3+ (a,b,0) gives Pban with two arms active (SvOC16 Fig. 2).
 * The irreps are matched by their subgroups, never by label (ADR 0004).
 */
import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar, type StarIrreps } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups, type IsotropyAnalysis } from "@/core/crystal/irreps/isotropy";
import { coupledIsotropy, irrepsFor, secondaryIrreps } from "@/core/crystal/irreps/orderParameters";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";

const cache = new Map<string, FactorGroup>();
const groupOf = (sg: number | string): FactorGroup => {
  const key = String(sg);
  if (!cache.has(key)) cache.set(key, factorGroup(buildSpaceGroup(sg).operations, DEFAULT_SUPERCELL));
  return cache.get(key)!;
};

function analyse(sg: number | string, k: readonly [number, number, number]): { group: FactorGroup; star: StarIrreps; iso: IsotropyAnalysis[] } {
  const group = groupOf(sg);
  const star = irrepsOfStar(group, k);
  return { group, star, iso: star.physical.map((p) => isotropySubgroups(group, p)) };
}

const numbers = (a: IsotropyAnalysis): number[] => a.subgroups.map((s) => s.identity.number ?? 0);

describe("isotropy subgroups at cell-multiplying k-points (2×2×2 bound)", { timeout: 600_000 }, () => {
  it("Pm-3m R: R3+ → I4/mmm, I4/mcm, Fmmm; R4+ → I4/mcm, Imma, R-3c, C2/m, C2/c, P-1", () => {
    const { iso } = analyse(221, [0.5, 0.5, 0.5]);
    const lists = iso.map((a) => [...numbers(a)].sort((x, y) => x - y).join(","));
    expect(lists).toContain([69, 139, 140].join(","));
    expect(lists).toContain([2, 12, 15, 74, 140, 167].join(","));
    for (const a of iso) {
      for (const s of a.subgroups) {
        expect(s.index.k).toBe(2);
        expect(s.cellMultiplying).toBe(true);
        expect(s.identity.number).toBeDefined();
        expect(s.identity.basis).toBeDefined();
      }
    }
  });

  it("Pm-3m M: P4/mbm from a one-arm direction; Im-3m from three equal arms", () => {
    const { iso } = analyse(221, [0.5, 0.5, 0]);
    const all = iso.flatMap((a) => a.subgroups);
    const p4mbm = all.filter((s) => s.identity.number === 127);
    expect(p4mbm.length).toBeGreaterThan(0);
    for (const s of p4mbm) expect([s.direction.dim, s.activeArms.length, s.index.t, s.index.k]).toEqual([1, 1, 3, 2]);
    const im3m = all.find((s) => s.identity.number === 229)!;
    expect([im3m.activeArms.length, im3m.index.t, im3m.index.k]).toEqual([3, 1, 4]);
  });

  it("Pm-3m X: a (a,b,0) direction reaches Pban (#50) with two arms active, index 24", () => {
    const { iso } = analyse(221, [0, 0.5, 0]);
    const pban = iso.flatMap((a) => a.subgroups).filter((s) => s.identity.number === 50 && s.direction.dim === 2);
    expect(pban.length).toBeGreaterThan(0);
    expect(pban.some((s) => s.activeArms.length === 2 && s.domainStates === 24)).toBe(true);
  });

  for (const [name, sg, k] of [["Fm-3m L", 225, [0.5, 0.5, 0.5]], ["Fm-3m W", 225, [0.5, 1, 0]], ["Pm-3m M", 221, [0.5, 0.5, 0]]] as const) {
    it(`${name}: one kernel per irrep, last; t·k = [G : H]; every child named; the direction's stabilizer is the subgroup`, () => {
      const { group, star, iso } = analyse(sg, k);
      star.physical.forEach((p, i) => {
        const subs = iso[i]!.subgroups;
        expect(subs.filter((s) => s.kernel)).toHaveLength(1);
        expect(subs[subs.length - 1]!.kernel).toBe(true);
        for (const s of subs) {
          expect(s.index.t * s.index.k).toBe(s.domainStates);
          expect(s.identity.number, `${p.label} ${s.direction.symbol}`).toBeDefined();
          const n = p.dim;
          const stab = group.elements.map((_, f) => f).filter((f) => s.direction.basis.every((b) => {
            const D = p.matrices[f]!;
            for (let r = 0; r < n; r++) {
              let v = 0;
              for (let c = 0; c < n; c++) v += D[r * n + c]! * b[c]!;
              if (Math.abs(v - b[r]!) > 1e-7) return false;
            }
            return true;
          }));
          expect(stab).toEqual([...s.elements].sort((u, v) => u - v));
        }
      });
    });
  }
});

describe("coupled and secondary irreps, and the inverse query", { timeout: 600_000 }, () => {
  it("R4+ (a,a,0) Imma coupled with M3+ (a,0,0) P4/mbm reaches Pnma for one domain choice", () => {
    const R = analyse(221, [0.5, 0.5, 0.5]);
    const M = analyse(221, [0.5, 0.5, 0]);
    const imma = R.iso.flatMap((a) => a.subgroups).filter((s) => s.identity.number === 74);
    const p4mbm = M.iso.flatMap((a) => a.subgroups).filter((s) => s.identity.number === 127);
    const children = imma.flatMap((a) => p4mbm.flatMap((b) => coupledIsotropy(R.group, a.elements, b.elements)));
    const pnma = children.filter((c) => c.identity.number === 62);
    expect(pnma.length).toBeGreaterThan(0);
    // Not every domain choice gives Pnma: the choice matters and is reported.
    expect(new Set(children.map((c) => c.identity.number)).size).toBeGreaterThan(1);
    for (const c of pnma) {
      expect(c.index.t * c.index.k).toBe(R.group.elements.length / c.elements.length);
      expect(c.domain.xyz).toMatch(/x|y|z/);
    }
  });

  it("irrepsFor(child): Pnma allows an R irrep and an M irrep, neither reaching it alone; secondary irreps exclude the primary", () => {
    const R = analyse(221, [0.5, 0.5, 0.5]);
    const M = analyse(221, [0.5, 0.5, 0]);
    const imma = R.iso.flatMap((a) => a.subgroups).find((s) => s.identity.number === 74)!;
    const p4mbm = M.iso.flatMap((a) => a.subgroups).find((s) => s.identity.number === 127)!;
    const pnma = coupledIsotropy(R.group, imma.elements, p4mbm.elements).find((c) => c.identity.number === 62)!;
    const stars = [R.star, M.star];
    const allowed = irrepsFor(R.group, stars, pnma.elements);
    expect(allowed.some((a) => a.starLabel === "R")).toBe(true);
    expect(allowed.some((a) => a.starLabel === "M")).toBe(true);
    expect(allowed.every((a) => a.multiplicity > 0 && a.isotropyElements.length >= pnma.elements.length)).toBe(true);
    // Each allowed irrep's isotropy subgroup contains the child.
    for (const a of allowed) {
      const iso = new Set(a.isotropyElements);
      expect(pnma.elements.every((x) => iso.has(x))).toBe(true);
    }
    // For an isotropy subgroup, its primary irrep reaches it alone; the secondaries are listed without it.
    const primary = R.star.physical.find((p) => isotropySubgroups(R.group, p).subgroups.some((s) => s.elements.join() === imma.elements.join()))!;
    const forImma = irrepsFor(R.group, stars, imma.elements);
    expect(forImma.find((a) => a.irrep === primary)?.reachesChild).toBe(true);
    const secondary = secondaryIrreps(R.group, stars, imma.elements, primary);
    expect(secondary.some((a) => a.irrep === primary)).toBe(false);
    expect(secondary.length).toBe(forImma.length - 1);
  });
});
