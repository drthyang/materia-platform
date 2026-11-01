/**
 * Which irreps a subgroup activates (the Subgroups page's "By subgroup" rows;
 * GLOSSARY "Primary irrep", "Secondary irrep"; docs/research/SUBGROUP_ENGINES.md
 * §3.3–3.5; Stokes & Hatch 1988; Campbell et al. 2006 §4): for each class of
 * the subgroup lattice inside a supercell bound (supercellLattice.ts), the
 * irreps of the parent whose order parameter lowers it to that class, and the
 * irreps that come along.
 *
 *  - **Primary**: an irrep whose isotropy subgroup, for some order-parameter
 *    direction, is the class itself. The irrep's isotropy subgroups come from
 *    isotropy.ts, one per conjugacy class (the children the "By irrep" view
 *    lists), and are matched to the lattice's classes as classes (any member,
 *    SupercellLattice.classOf), never by one representative. Each is reported
 *    with the direction "By irrep" shows for that class.
 *  - **Coupled**: when no single irrep has the class as an isotropy subgroup,
 *    the fewest irreps whose joint isotropy subgroup is it. For a member H and
 *    an irrep j with a vector H fixes (n_j > 0), the isotropy subgroup of the
 *    whole fixed space Fix_j(H) is K_j, the smallest isotropy subgroup of j
 *    that contains H (any isotropy subgroup L ⊇ H has Fix_j(L) ⊆ Fix_j(H), so
 *    its stabilizer lies in L); a generic vector of ⊕_j Fix_j(H) is fixed by
 *    ∩_j K_j exactly. A set of irreps reaches H when ∩_j K_j = H, with each
 *    irrep in the domain H fixes. Every class is reached by all its allowed
 *    irreps together (the coset vector of the permutation representation on
 *    F/H decomposes into exactly these), so the search, over two, three and
 *    four irreps, finds the smallest set; it stops, and says so, if a
 *    search grows beyond a fixed budget. Several sets of the smallest size can
 *    reach one class (a trilinear coupling makes any two of three irreps
 *    enough: Pnma of a cubic perovskite is reached by its R and M tilts, by
 *    either with the X irrep of the antipolar shift, …); the one shown first
 *    is chosen by the structure, when given: irreps its atoms carry first,
 *    then the fewest child modes, then the lowest-dimensional irreps, then
 *    the earliest.
 *  - **Secondary**: every other irrep with a vector the subgroup fixes
 *    (n_j = (1/|H|) Σ_{h∈H} χ_j(h) > 0: its subduction to H contains the
 *    identity), the primary and coupled ones excluded.
 *
 * The identity irrep is left out throughout. Everything is the group's; the
 * structure enters only to order the coupled sets and to say which irreps
 * move no atom (displacement multiplicities, supercellModes.ts).
 */

import type { FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { cachedIsotropySubgroups, type IrrepIsotropySubgroup } from "@/core/crystal/irreps/isotropy";
import type { KStar, PhysicalIrrep, StarIrreps } from "@/core/crystal/irreps/spaceGroupIrreps";
import type { SupercellLattice } from "@/core/crystal/irreps/supercellLattice";

/** A non-identity physically irreducible representation of the bound, with its isotropy subgroups. */
export interface BoundIrrep {
  readonly star: KStar;
  readonly irrep: PhysicalIrrep;
  /** Its isotropy subgroups, one per conjugacy class, as "By irrep" lists them. */
  readonly subgroups: readonly IrrepIsotropySubgroup[];
  /** 0-based, in star then irrep order: the order coupled sets are listed in. */
  readonly order: number;
}

/** True for the identity irrep: every character equals the dimension 1. */
const isIdentityIrrep = (p: PhysicalIrrep): boolean => p.dim === 1 && p.characters.every((c) => Math.abs(c - 1) < 1e-9);

/**
 * The non-identity irreps of the given stars (in their order) with their
 * isotropy subgroups (cachedIsotropySubgroups, so a view that asks for them
 * again computes nothing).
 */
export function boundIrreps(group: FactorGroup, stars: readonly StarIrreps[]): BoundIrrep[] {
  const out: BoundIrrep[] = [];
  for (const s of stars) {
    for (const irrep of s.physical) {
      if (isIdentityIrrep(irrep)) continue;
      out.push({ star: s.star, irrep, subgroups: cachedIsotropySubgroups(group, irrep).subgroups, order: out.length });
    }
  }
  return out;
}

/** An irrep along one of its order-parameter directions: the class of its isotropy subgroup as "By irrep" lists it. */
export interface IrrepDirection {
  readonly irrep: BoundIrrep;
  /** The isotropy subgroup's class (By irrep's child). For a primary irrep it is the row's class; for a coupled one, the class of K_j ⊇ H. */
  readonly subgroup: IrrepIsotropySubgroup;
  /** Its direction symbol, as By irrep writes it ("(a,0,0)"). */
  readonly direction: string;
}

export interface SubgroupIrreps {
  /** Every irrep with an isotropy subgroup in this class, each alone lowering the parent to it: irreps the atoms carry first, then in order. */
  readonly primary: readonly IrrepDirection[];
  /** When no single irrep does: the preferred smallest set whose joint isotropy subgroup is the class; null otherwise, or when none was found. */
  readonly coupled: readonly IrrepDirection[] | null;
  /** The other sets of that size that reach it. */
  readonly otherCoupled: readonly (readonly IrrepDirection[])[];
  /** The other irreps with a vector the class fixes (n_j > 0), with that dimension n_j. */
  readonly secondary: readonly { readonly irrep: BoundIrrep; readonly n: number }[];
  /** The largest coupled set searched: with no primary and no coupled set, none of up to this size reaches the class. */
  readonly searchedUpTo: number;
}

export interface SubgroupIrrepOptions {
  /** The structure's displacement multiplicity of each irrep (m_j, the copies its atoms carry), to order the coupled sets and flag irreps that move no atom; omitted, the order is the group's alone. */
  readonly multiplicity?: (irrep: BoundIrrep) => number;
  /** The largest coupled set searched (default 4). */
  readonly maxCoupled?: number;
  /** The most intersections one class's coupled search may take before it stops (default 400 000). */
  readonly budget?: number;
}

/** Bitsets over the factor group's elements. */
type Bits = Uint32Array;
const bitsOf = (elements: readonly number[], words: number): Bits => {
  const b = new Uint32Array(words);
  for (const x of elements) b[x >>> 5]! |= 1 << (x & 31);
  return b;
};
function popcount(b: Bits): number {
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    let v = b[i]!;
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return n;
}
const and = (a: Bits, b: Bits): Bits => {
  const out = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! & b[i]!;
  return out;
};
const contains = (outer: Bits, inner: Bits): boolean => {
  for (let i = 0; i < inner.length; i++) if ((inner[i]! & ~outer[i]!) !== 0) return false;
  return true;
};
const sameBits = (a: Bits, b: Bits): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** One irrep's isotropy subgroups, every member of every class, as bitsets. */
interface IrrepMembers {
  readonly members: readonly { readonly bits: Bits; readonly size: number; readonly cls: number }[];
}

function membersOf(group: FactorGroup, b: BoundIrrep, words: number): IrrepMembers {
  const F = group.elements.length;
  const members: { bits: Bits; size: number; cls: number }[] = [];
  b.subgroups.forEach((s, cls) => {
    const seen = new Set<string>();
    for (let g = 0; g < F; g++) {
      const c = s.elements.map((h) => group.table[group.table[g]![h]!]![group.inverse[g]!]!).sort((x, y) => x - y);
      const key = c.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      members.push({ bits: bitsOf(c, words), size: c.length, cls });
    }
  });
  return { members };
}

/**
 * The irreps each class of the lattice activates (see the module comment),
 * indexed by class id; the parent's own class gets empty lists. `irreps` are
 * the bound's (boundIrreps over every star of the bound), on the same factor
 * group as the lattice.
 */
export function subgroupIrreps(group: FactorGroup, irreps: readonly BoundIrrep[], lattice: SupercellLattice, opts: SubgroupIrrepOptions = {}): SubgroupIrreps[] {
  const F = group.elements.length;
  const words = Math.ceil(F / 32);
  const maxCoupled = opts.maxCoupled ?? 4;
  const budget = opts.budget ?? 400_000;
  const m = irreps.map((b) => opts.multiplicity?.(b) ?? 1);
  // Each irrep's isotropy classes, matched to the lattice's classes.
  const primaryOf = new Map<number, IrrepDirection[]>();
  irreps.forEach((b) => {
    for (const s of b.subgroups) {
      const cls = lattice.classOf(s.elements);
      if (cls === null) continue;
      const list = primaryOf.get(cls) ?? [];
      if (list.some((x) => x.irrep === b)) throw new Error(`subgroupIrreps: two isotropy classes of ${b.irrep.label} fall in one lattice class`);
      list.push({ irrep: b, subgroup: s, direction: s.direction.symbol });
      primaryOf.set(cls, list);
    }
  });
  const memberCache = new Map<number, IrrepMembers>();
  const members = (j: number): IrrepMembers => {
    let x = memberCache.get(j);
    if (!x) {
      x = membersOf(group, irreps[j]!, words);
      memberCache.set(j, x);
    }
    return x;
  };
  const displacive = (d: IrrepDirection): number => (m[d.irrep.order]! > 0 ? 0 : 1);

  return lattice.classes.map((c) => {
    if (c.kind === "parent") return { primary: [], coupled: null, otherCoupled: [], secondary: [], searchedUpTo: 0 };
    const H = c.elements;
    const hBits = bitsOf(H, words);
    // n_j: the dimension of the subspace H fixes.
    const n = irreps.map((b) => {
      let sum = 0;
      for (const h of H) sum += b.irrep.characters[h]!;
      const v = sum / H.length;
      const r = Math.round(v);
      if (Math.abs(v - r) > 1e-6) throw new Error(`subgroupIrreps: n = ${v} is not an integer for ${b.irrep.label}`);
      return r;
    });
    const primary = [...(primaryOf.get(c.id) ?? [])].sort((a, b) => displacive(a) - displacive(b) || a.irrep.order - b.irrep.order);
    for (const p of primary) if (n[p.irrep.order]! <= 0) throw new Error(`subgroupIrreps: ${p.irrep.irrep.label} reaches a class it fixes no vector of`);
    let coupled: IrrepDirection[] | null = null;
    let otherCoupled: IrrepDirection[][] = [];
    let searchedUpTo = 1;
    if (primary.length === 0) {
      // K_j: the smallest isotropy subgroup of j containing H, the intersection of all that do.
      const cands: { j: number; K: Bits; dir: IrrepDirection }[] = [];
      irreps.forEach((b, j) => {
        if (n[j]! <= 0) return;
        let K: Bits | null = null;
        for (const mem of members(j).members) if (contains(mem.bits, hBits)) K = K ? and(K, mem.bits) : mem.bits;
        if (!K) throw new Error(`subgroupIrreps: no isotropy subgroup of ${b.irrep.label} contains a subgroup that fixes one of its vectors`);
        const own = members(j).members.find((mem) => sameBits(mem.bits, K!));
        if (!own) throw new Error(`subgroupIrreps: the stabilizer of ${b.irrep.label}'s fixed space is not one of its isotropy subgroups`);
        if (popcount(K) === H.length) throw new Error(`subgroupIrreps: ${b.irrep.label} reaches a class its isotropy subgroups were not matched to`);
        const s = b.subgroups[own.cls]!;
        cands.push({ j, K, dir: { irrep: b, subgroup: s, direction: s.direction.symbol } });
      });
      let spent = 0;
      for (let size = 2; size <= Math.min(maxCoupled, cands.length) && coupled === null; size++) {
        const sets: number[][] = [];
        let over = false;
        const pick = (start: number, acc: Bits | null, chosen: number[]): void => {
          if (over) return;
          if (chosen.length === size) {
            if (popcount(acc!) === H.length) sets.push([...chosen]);
            return;
          }
          for (let t = start; t < cands.length; t++) {
            if (++spent > budget) {
              over = true;
              return;
            }
            const next = acc ? and(acc, cands[t]!.K) : cands[t]!.K;
            // An irrep that lowers nothing further cannot be in a smallest set.
            if (acc && sameBits(next, acc)) continue;
            chosen.push(t);
            pick(t + 1, next, chosen);
            chosen.pop();
          }
        };
        pick(0, null, []);
        if (over) break;
        searchedUpTo = size;
        if (sets.length === 0) continue;
        const score = (set: readonly number[]): number[] => [
          set.reduce((s, t) => s + (m[cands[t]!.j]! > 0 ? 0 : 1), 0),
          opts.multiplicity ? set.reduce((s, t) => s + n[cands[t]!.j]! * m[cands[t]!.j]!, 0) : 0,
          set.reduce((s, t) => s + cands[t]!.dir.irrep.irrep.dim, 0),
          ...set.map((t) => cands[t]!.j),
        ];
        const ranked = sets.map((set) => ({ set, key: score(set) })).sort((a, b) => {
          for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i]! - b.key[i]!;
          return 0;
        });
        const asDirs = (set: readonly number[]): IrrepDirection[] => set.map((t) => cands[t]!.dir);
        coupled = asDirs(ranked[0]!.set);
        otherCoupled = ranked.slice(1).map((r) => asDirs(r.set));
      }
    }
    const used = new Set<BoundIrrep>([...primary, ...(coupled ?? [])].map((d) => d.irrep));
    const secondary = irreps.filter((b, j) => n[j]! > 0 && !used.has(b)).map((b) => ({ irrep: b, n: n[b.order]! }));
    return { primary, coupled, otherCoupled, secondary, searchedUpTo };
  });
}
