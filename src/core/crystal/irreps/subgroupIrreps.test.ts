/**
 * Which irreps a subgroup activates (subgroupIrreps.ts), through the module
 * interface, on the Subgroups page's cases: SrTiO₃ (Pm-3m) in the 2×2×2
 * bound, and the GaTa₄Se₈ demo (F-43m, published) in 1×1×2 and 2×2×2.
 *
 *  - The two views agree: every primary irrep of a class has an isotropy
 *    subgroup ("By irrep"'s child) in that class, and every By-irrep child
 *    whose lattice fits the bound is a class naming that irrep as primary.
 *    Each is checked again on the class's own member by the inverse query of
 *    orderParameters.ts (fixed subspace, pointwise stabilizer: a separate
 *    route), which also checks the coupled sets (their joint isotropy
 *    subgroup is the class, and no single irrep reaches it) and the
 *    secondary irreps (n_j > 0).
 *  - Known cases: R-3c and I4/mcm from SrTiO₃'s antiphase R tilt alone, Pnma
 *    (a⁻b⁺a⁻) from that R tilt and the in-phase M tilt coupled, each class
 *    found as the stabilizer of the geometric tilt (testSupport, no subgroup
 *    engine); GaTa₄Se₈'s P-42₁m in 1×1×2 and at X.
 *  - Bilbao's SUBGROUPS Landau-type counts (one irrep reaches the class):
 *    Fm-3m (½a−½b, ½a+½b, 2c) 31 entries in 28 classes, Pnma (a, b, 2c) 6
 *    (tutorial pp. 12, 18; supercellLattice.test.ts has the source).
 */
import { describe, it, expect } from "vitest";
import type { Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup, starsInBound, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { rnum } from "@/core/crystal/irreps/rational";
import { fitsBound, keepsSupercell, supercellSubgroups, type SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import { cachedIrrepsOfStar, displacementCharacters, displacementMultiplicity } from "@/core/crystal/irreps/supercellModes";
import { irrepsFor } from "@/core/crystal/irreps/orderParameters";
import { periodicityBox } from "@/core/crystal/irreps/childSetting";
import type { StarIrreps } from "@/core/crystal/irreps/spaceGroupIrreps";
import { boundIrreps, subgroupIrreps, type BoundIrrep, type SubgroupIrreps } from "@/core/crystal/irreps/subgroupIrreps";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, srtio3, tiltDisplacement, type Glazer } from "@/testSupport/perovskiteTilts";

// The lattice and the isotropy analysis of every star take seconds; more on a loaded CI runner.
const SLOW = 300_000;

interface Case {
  readonly group: FactorGroup;
  readonly stars: StarIrreps[];
  readonly irreps: BoundIrrep[];
  readonly lattice: SupercellLattice;
  readonly result: SubgroupIrreps[];
}

const cache = new Map<string, Case>();
function analyse(name: string, structure: StructureModel | null, ops: StructureModel["spaceGroup"]["operations"], P: number[][]): Case {
  const hit = cache.get(name);
  if (hit) return hit;
  const group = factorGroup(ops, { P, centring: "P" });
  const lattice = supercellSubgroups(group);
  const stars = starsInBound(group).map((k) => cachedIrrepsOfStar(group, [rnum(k[0]), rnum(k[1]), rnum(k[2])]));
  const irreps = boundIrreps(group, stars);
  const chi = structure ? displacementCharacters(structure, group) : null;
  const result = subgroupIrreps(group, irreps, lattice, chi ? { multiplicity: (b) => displacementMultiplicity(chi, b.irrep.characters) } : {});
  const c = { group, stars, irreps, lattice, result };
  cache.set(name, c);
  return c;
}

const STO = srtio3();
const GTS = gata4se8PdfExample().structure;
const sto222 = (): Case => analyse("sto222", STO, STO.spaceGroup.operations, [[2, 0, 0], [0, 2, 0], [0, 0, 2]]);
const gts112 = (): Case => analyse("gts112", GTS, GTS.spaceGroup.operations, [[1, 0, 0], [0, 1, 0], [0, 0, 2]]);
const gts222 = (): Case => analyse("gts222", GTS, GTS.spaceGroup.operations, [[2, 0, 0], [0, 2, 0], [0, 0, 2]]);

const sameSet = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && [...a].sort((x, y) => x - y).every((x, i) => x === [...b].sort((p, q) => p - q)[i]);

/** The two views agree, class by class and child by child, and the inverse query says the same. */
function consistent(c: Case): { primary: number; coupled: number; byIrrep: number } {
  const { group, stars, irreps, lattice, result } = c;
  let primaryCount = 0;
  let coupledCount = 0;
  lattice.classes.forEach((cls, id) => {
    if (cls.kind === "parent") return;
    const r = result[id]!;
    const H = cls.elements;
    const allowed = irrepsFor(group, stars, H);
    const allowedOf = (b: BoundIrrep) => allowed.find((a) => a.irrep === b.irrep);
    for (const p of r.primary) {
      // By irrep lists this irrep's child in this very class …
      expect(lattice.classOf(p.subgroup.elements)).toBe(id);
      expect(p.direction).toBe(p.subgroup.direction.symbol);
      expect(p.irrep.subgroups).toContain(p.subgroup);
      // … and on the class's own member, the irrep alone reaches it.
      expect(allowedOf(p.irrep)?.reachesChild).toBe(true);
      primaryCount++;
    }
    if (r.primary.length === 0) {
      // No irrep alone reaches the member.
      expect(allowed.some((a) => a.reachesChild)).toBe(false);
      expect(r.coupled).not.toBeNull();
      coupledCount++;
      for (const set of [r.coupled!, ...r.otherCoupled]) {
        expect(set.length).toBeGreaterThanOrEqual(2);
        expect(set.length).toBe(r.coupled!.length);
        // The joint isotropy subgroup: ∩ over the set of each irrep's isotropy subgroup of the member's fixed space.
        let joint: number[] | null = null;
        for (const d of set) {
          const a = allowedOf(d.irrep)!;
          expect(a).toBeDefined();
          // The direction shown is the class of that irrep's own isotropy subgroup of the member's fixed space.
          expect(d.irrep.subgroups).toContain(d.subgroup);
          const own = lattice.classOf(a.isotropyElements);
          expect(own).not.toBeNull();
          expect(own).toBe(lattice.classOf(d.subgroup.elements));
          joint = joint === null ? [...a.isotropyElements] : joint.filter((x) => a.isotropyElements.includes(x));
        }
        expect(sameSet(joint!, H)).toBe(true);
      }
    }
    // Secondary: every other irrep with a vector the member fixes.
    const named = new Set([...r.primary, ...(r.coupled ?? [])].map((d) => d.irrep.irrep));
    expect(r.secondary.map((s) => s.irrep.irrep.label).sort()).toEqual(allowed.filter((a) => !named.has(a.irrep)).map((a) => a.irrep.label).sort());
  });
  // Vice versa: every By-irrep child that fits the bound is a class naming its irrep as primary.
  let byIrrep = 0;
  for (const b of irreps) {
    for (const s of b.subgroups) {
      const id = lattice.classOf(s.elements);
      expect(id !== null).toBe(fitsBound(group, s.elements));
      if (id === null) continue;
      expect(result[id]!.primary.some((p) => p.irrep === b && p.subgroup === s)).toBe(true);
      byIrrep++;
    }
  }
  return { primary: primaryCount, coupled: coupledCount, byIrrep };
}

/**
 * The stabilizer in the 2×2×2 factor group of a geometric Glazer tilt
 * (testSupport, no subgroup engine): the elements f with u(f·X) = W_f·u(X)
 * on every atom of the 2×2×2 cell.
 */
function tiltStabilizer(group: FactorGroup, g: Glazer, order: readonly [number, number, number]): number[] {
  const atoms: Vec3[] = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    for (const x of [[0, 0, 0], [0.5, 0.5, 0.5], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]] as const) atoms.push([x[0] + i, x[1] + j, x[2] + k]);
  }
  const mod2 = (x: number): number => ((x % 2) + 2) % 2;
  const u = (X: Vec3): Vec3 => tiltDisplacement([mod2(X[0]), mod2(X[1]), mod2(X[2])], g, 0.05, order);
  const out: number[] = [];
  group.elements.forEach((e, f) => {
    const w = e.w.map(rnum);
    const ok = atoms.every((X) => {
      const Y: Vec3 = [0, 1, 2].map((r) => e.W[r]![0]! * X[0] + e.W[r]![1]! * X[1] + e.W[r]![2]! * X[2] + w[r]!) as unknown as Vec3;
      const want = u(X);
      const turned = [0, 1, 2].map((r) => e.W[r]![0]! * want[0] + e.W[r]![1]! * want[1] + e.W[r]![2]! * want[2]);
      const got = u(Y);
      return turned.every((x, r) => Math.abs(x - got[r]!) < 1e-12);
    });
    if (ok) out.push(f);
  });
  return out;
}

/** The row of the class a Glazer tilt lowers SrTiO₃ to (in its first orientation and sense that gives the expected group). */
function tiltRow(c: Case, key: keyof typeof GLAZER): { id: number; row: SubgroupIrreps } {
  const g0 = GLAZER[key]!;
  for (const order of AXIS_ORDERS) for (const sense of TILT_SENSES) {
    const g: Glazer = { ...g0, phi: [g0.phi[0] * sense[0], g0.phi[1] * sense[1], g0.phi[2] * sense[2]] };
    const id = c.lattice.classOf(tiltStabilizer(c.group, g, order));
    if (id !== null && c.lattice.classes[id]!.identity?.number === g0.number) return { id, row: c.result[id]! };
  }
  throw new Error(`no class of ${g0.name}`);
}

const shown = (r: SubgroupIrreps): string =>
  r.primary.length > 0
    ? r.primary.map((p) => `${p.irrep.irrep.label} ${p.direction}`).join(" or ")
    : r.coupled ? `${r.coupled.map((p) => `${p.irrep.irrep.label} ${p.direction}`).join(" + ")} (coupled)` : "none";

describe("the irreps each subgroup activates agree with the isotropy subgroups By irrep lists", () => {
  it("SrTiO₃, Pm-3m in 2×2×2: every class, every child", () => {
    const c = sto222();
    const n = consistent(c);
    // 1426 classes below the parent fit the cube; 209 are one irrep's isotropy subgroup, the rest are reached by coupled irreps.
    expect(c.lattice.classes.length).toBe(1427);
    expect(n.coupled + c.result.filter((r, i) => c.lattice.classes[i]!.kind !== "parent" && r.primary.length > 0).length).toBe(1426);
    expect(c.result.filter((r) => r.primary.length === 0 && r.coupled === null && r.searchedUpTo > 0)).toEqual([]);
    expect(n.byIrrep).toBe(n.primary);
  }, SLOW);

  it("GaTa₄Se₈, F-43m in 1×1×2: every class, every child that fits; the larger ones left out", () => {
    const c = gts112();
    const n = consistent(c);
    expect(n.byIrrep).toBe(n.primary);
    // By irrep's children that do not fit 1×1×2 (the (2a, 2a, c) P-42₁m of the owner's report among them).
    const larger = c.irreps.flatMap((b) => b.subgroups.filter((s) => !fitsBound(c.group, s.elements)));
    expect(larger.length).toBeGreaterThan(0);
    // Its isotropy subgroups at W and (0, 0, ½) of type P-42₁m double two axes (a (2a, 2a, c) cell in some orientation).
    const boxes = larger.filter((s) => s.identity.number === 113).map((s) => periodicityBox(c.group, s.elements));
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => [...b].sort().join("×") === "1×2×2")).toBe(true);
  }, SLOW);

  it("GaTa₄Se₈, F-43m in 2×2×2: every class, every child", () => {
    const c = gts222();
    const n = consistent(c);
    expect(n.byIrrep).toBe(n.primary);
  }, SLOW);
});

describe("known cases", () => {
  it("SrTiO₃'s tilts: R-3c and I4/mcm from the R tilt alone, Pnma from the R and M tilts coupled", () => {
    const c = sto222();
    const r3c = tiltRow(c, "a-a-a-");
    expect(shown(r3c.row)).toBe("R irrep 8 of 10 (a,a,a)");
    expect(periodicityBox(c.group, c.lattice.classes[r3c.id]!.elements)).toEqual([2, 2, 2]);
    const i4mcm = tiltRow(c, "a0a0c-");
    expect(shown(i4mcm.row)).toBe("R irrep 8 of 10 (a,0,0)");
    const p4mbm = tiltRow(c, "a0a0c+");
    expect(shown(p4mbm.row)).toBe("M irrep 5 of 10 (a,0,0)");
    const pnma = tiltRow(c, "a-b+a-");
    // No irrep alone: two coupled, an M irrep along its P4/mbm direction and an R irrep along its Imma one.
    expect(shown(pnma.row)).toBe("M irrep 3 of 10 (a,0,0) + R irrep 8 of 10 (a,a,0) (coupled)");
    expect(pnma.row.coupled!.map((d) => d.subgroup.identity.number)).toEqual([127, 74]);
    // Eight pairs reach this Pnma (a trilinear coupling makes any two of R, M and X enough), so the row lists the
    // other seven behind its "?"; the two tilts themselves, a⁰a⁰c⁺'s M irrep and a⁻a⁻a⁻'s R irrep, are one of them.
    const pairs = [pnma.row.coupled!, ...pnma.row.otherCoupled].map((set) => set.map((d) => d.irrep.irrep.label).join(" + "));
    expect(pairs).toHaveLength(8);
    expect(pairs).toContain(`${p4mbm.row.primary[0]!.irrep.irrep.label} + ${r3c.row.primary[0]!.irrep.irrep.label}`);
    expect(pairs.filter((x) => x.startsWith("X irrep"))).toHaveLength(4);
    // The R tilt moves O only; Sr and Ti stay: its irrep is the one the atoms carry once.
    const chi = displacementCharacters(STO, c.group);
    expect(displacementMultiplicity(chi, r3c.row.primary[0]!.irrep.irrep.characters)).toBe(1);
    // The tilts come second, tied with the first pair on every count: M irrep 3 and M irrep 5 have the same isotropy
    // subgroups (P4/mbm, Im-3, I4/mmm, Immm, of the same orders; ISODISTORT's M2+ and M3+), each alone gives P4/mbm here
    // (index 6) with R irrep 8's Imma (index 12), the atoms carry each once, and both are 3-dimensional: the earlier stays first.
    expect(pairs[1]).toBe(`${p4mbm.row.primary[0]!.irrep.irrep.label} + ${r3c.row.primary[0]!.irrep.irrep.label}`);
    const sameOrders = (label: string): string => c.irreps.find((b) => b.irrep.label === label)!.subgroups.map((x) => `${x.identity.number}:${x.elements.length}`).join(" ");
    expect(sameOrders("M irrep 3 of 10")).toBe(sameOrders("M irrep 5 of 10"));
    const index = (set: readonly { subgroup: { elements: readonly number[] } }[]): number => set.reduce((n, d) => n + c.group.elements.length / d.subgroup.elements.length, 0);
    expect(index(pnma.row.coupled!)).toBe(18);
    expect(index(pnma.row.otherCoupled[0]!)).toBe(18);
  }, SLOW);

  it("the first coupled set: irreps the atoms carry, then the highest symmetry of the members' own isotropy subgroups (the smallest Σ [F : K_j])", () => {
    for (const [c, s] of [[sto222(), STO], [gts112(), GTS], [gts222(), GTS]] as const) {
      const chi = displacementCharacters(s, c.group);
      const F = c.group.elements.length;
      const key = (set: readonly { irrep: BoundIrrep; subgroup: { elements: readonly number[] } }[]): [number, number] => [
        set.filter((d) => displacementMultiplicity(chi, d.irrep.irrep.characters) === 0).length,
        set.reduce((n, d) => n + F / d.subgroup.elements.length, 0),
      ];
      let ties = 0;
      c.result.forEach((r) => {
        if (!r.coupled) return;
        const first = key(r.coupled);
        for (const other of r.otherCoupled) {
          const k = key(other);
          // No other set is ahead on these two counts; the ones level with it are ordered by the older rule.
          expect(k[0] > first[0] || (k[0] === first[0] && k[1] >= first[1])).toBe(true);
          if (k[0] === first[0] && k[1] === first[1]) ties++;
        }
      });
      expect(ties).toBeGreaterThan(0);
    }
  }, SLOW);

  it("a row the symmetry rule reorders: SrTiO₃'s C2/c in 1×2×1 by two one-parameter X directions, not Γ irrep 7's two-parameter one", () => {
    const c = sto222();
    const rows = c.lattice.classes.map((cls, id) => ({ cls, r: c.result[id]! })).filter(({ cls, r }) => cls.identity?.number === 15 && r.coupled !== null && periodicityBox(c.group, cls.elements).join("×") === "1×2×1");
    const reordered = rows.filter(({ r }) => r.coupled!.map((d) => d.irrep.irrep.label).join(" + ") === "X irrep 2 of 10 + X irrep 10 of 10");
    expect(reordered).toHaveLength(1);
    const { r } = reordered[0]!;
    expect(shown(r)).toBe("X irrep 2 of 10 (a,0,0) + X irrep 10 of 10 (a,0,0,0,0,0) (coupled)");
    // The pair shown before (the structure's counts only) is still among the others, behind the "?".
    expect(r.otherCoupled.map((set) => set.map((d) => `${d.irrep.irrep.label} ${d.direction}`).join(" + "))).toContain("Γ irrep 7 of 10 (a,a,b) + X irrep 10 of 10 (a,0,0,0,0,0)");
  }, SLOW);

  it("GaTa₄Se₈: P-42₁m in 1×1×2 is reached by coupled irreps, in its own cell (a, a, 2c); at X, by X irrep 5 of 5 in the parent's cell", () => {
    const c = gts112();
    const rows = c.lattice.classes.map((cls, id) => ({ cls, r: c.result[id]! })).filter(({ cls }) => cls.identity?.number === 113);
    const own = rows.filter(({ cls }) => cls.cellMultiplying);
    expect(own).toHaveLength(4);
    for (const { cls, r } of own) {
      expect(cls.supercellLattice).toBe(true);
      expect(keepsSupercell(c.group, cls.elements)).toBe(true);
      expect(periodicityBox(c.group, cls.elements)).toEqual([1, 1, 2]);
      expect(r.primary).toEqual([]);
      expect(r.coupled!.length).toBe(2);
      expect(r.coupled!.some((d) => d.irrep.irrep.label === "X irrep 5 of 5")).toBe(true);
    }
    const same = rows.filter(({ cls }) => !cls.cellMultiplying);
    expect(same).toHaveLength(2);
    for (const { cls, r } of same) {
      expect(periodicityBox(c.group, cls.elements)).toEqual([1, 1, 1]);
      expect(r.primary.map((p) => p.irrep.irrep.label)).toEqual(["X irrep 5 of 5"]);
    }
    expect(same.map(({ r }) => r.primary[0]!.direction).sort()).toEqual(["(0,0,a,-a,-a,a)", "(0,0,a,a,a,a)"]);
  }, SLOW);
});

describe("Bilbao's SUBGROUPS Landau-type counts: the classes with the supercell's lattice that one irrep reaches", () => {
  const landau = (sg: number, P: number[][]): { classes: number; entries: number } => {
    const group = factorGroup(buildSpaceGroup(sg).operations, P);
    const lattice = supercellSubgroups(group);
    const stars = starsInBound(group).map((k) => cachedIrrepsOfStar(group, [rnum(k[0]), rnum(k[1]), rnum(k[2])]));
    const result = subgroupIrreps(group, boundIrreps(group, stars), lattice);
    const hit = lattice.classes.filter((cls, id) => cls.supercellLattice && result[id]!.primary.length > 0);
    return { classes: hit.length, entries: hit.length + hit.filter((cls) => cls.enantiomorph).length };
  };

  it("Pnma (a, b, 2c): 6", () => {
    expect(landau(62, [[1, 0, 0], [0, 1, 0], [0, 0, 2]])).toEqual({ classes: 6, entries: 6 });
  }, SLOW);

  it("Fm-3m (½a−½b, ½a+½b, 2c): 31 entries in 28 classes", () => {
    expect(landau(225, [[0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 2]])).toEqual({ classes: 28, entries: 31 });
  }, SLOW);
});
