/**
 * The subgroup lattice inside a supercell bound (ADR 0002; Phase 2): every
 * subgroup H of the parent whose translations contain the supercell's,
 * T_H ⊇ T′, up to conjugacy — t-subgroups, k-subgroups (decentring and
 * cell-multiplying, isomorphic ones included) and general subgroups — with
 * their index split t·k, orientation and domain states, the covering edges
 * between the classes, and the name of each class in ITA standard setting
 * with its child basis (P_H, p_H). The classes are conjugacy classes under
 * the parent group G.
 *
 * The classes with a member whose lattice is exactly the supercell
 * (`supercellLattice`) are the list Bilbao's SUBGROUPS gives for a supercell
 * (docs/research/SUBGROUP_ENGINES.md §1.2, §1.5), with one difference:
 * SUBGROUPS lists a class once per space-group type among its members, and a
 * class of a chiral type holds both types of its enantiomorphic pair (the
 * parent's improper operations turn P4₁22 into P4₃22), so SUBGROUPS lists it
 * twice. `enantiomorph` marks those classes. Fm-3m in (a/2−b/2, a/2+b/2, 2c)
 * has 96 classes and 99 SUBGROUPS entries: P4₁/P4₃, P4₁22/P4₃22 and
 * P4₁2₁2/P4₃2₁2 are listed twice (Bilbao SUBGROUPS tutorial, Example 1).
 *
 * Enumeration after Hatch & Stokes, Phys. Rev. B 31 (1985) 2908, §III–IV, in
 * the finite group F = G/T″ (T″ the point-group core of T′, factorGroup.ts).
 * A subgroup H ⊇ T″ is fixed by
 *   - its translations T_H/T″, a subgroup of the abelian group T/T″ that
 *     contains a conjugate R·T′ of the supercell (else no member of the class
 *     keeps it);
 *   - its point group H̄ ≤ Ḡ, which must leave T_H invariant (condition A);
 *   - the translations of lifts of a generating set of H̄, which matter only
 *     modulo T_H: H = T_H·⟨g₁, …, g_m⟩ is a subgroup with exactly these
 *     translations when ⟨T_H, g₁, …, g_j⟩ has |⟨R₁, …, R_j⟩|·|T_H| elements
 *     for every j (condition B, checked generator by generator, so the search
 *     backtracks instead of trying all |T/T_H|^m lifts at once).
 * Distinct lifts modulo T_H give distinct subgroups, and every subgroup
 * arises, so the search is exhaustive.
 *
 * The search is bounded twice: by the supercell (ADR 0002) and by a maximum
 * index. Above a measured ceiling — |F| larger than MAX_FACTOR_ORDER, or more
 * than MAX_SUBGROUPS subgroups — it refuses with SubgroupSearchTooLarge
 * rather than truncate silently. On the reference machine (Node 22) Fm-3m in
 * Bilbao's (a/2−b/2, a/2+b/2, 2c) supercell (|F| = 1536) takes a few seconds.
 */

import type { SymmetryOperation } from "@/core/crystal/types";
import type { SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { allSubgroups, buildCosetContext } from "@/core/magnetic/subgroupLattice";
import { pointGroupElements, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { idet, ikey, iIsIdentity } from "@/core/crystal/irreps/rational";
import { inLattice, scaleVec } from "@/core/crystal/irreps/supercell";
import { keepsConventionalCell, nameChild } from "@/core/crystal/irreps/childSetting";
import type { IndexSplit } from "@/core/crystal/irreps/isotropy";

/** The largest factor group the lattice search accepts (Fm-3m in a 2×2×2 cell is 1536). */
export const MAX_FACTOR_ORDER = 3072;
/** The most subgroups (all members of all classes) the search lists before refusing. */
export const MAX_SUBGROUPS = 60000;

/** Thrown when a bound is too large to search exhaustively. */
export class SubgroupSearchTooLarge extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubgroupSearchTooLarge";
  }
}

export type LatticeKind = "parent" | "t" | "k" | "general";

export interface SubgroupClass {
  /** 0-based, the parent first, then by index. */
  readonly id: number;
  /** The representative's factor-group elements, ascending: a member that keeps the supercell. */
  readonly elements: readonly number[];
  /** Its operations, translations modulo T″. */
  readonly operations: readonly SymmetryOperation[];
  readonly order: number;
  /** [G : H] = t·k. */
  readonly index: IndexSplit;
  readonly kind: LatticeKind;
  /** True when it loses translations of the conventional cell (a supercell child). */
  readonly cellMultiplying: boolean;
  /** A k-subgroup of the parent's own type (an isomorphic subgroup). */
  readonly isomorphic: boolean;
  /** Conjugate subgroups in F, [G : N_G(H)] (orientation states). */
  readonly orientationStates: number;
  /** Domain states, [G : H]. */
  readonly domainStates: number;
  /** The members of the class that keep the supercell (Bilbao lists only these). */
  readonly membersInSupercell: number;
  /**
   * True when a member's lattice is the supercell exactly (T_H = T′): the
   * classes Bilbao's SUBGROUPS lists for a supercell, which shows only the
   * conjugates "whose supercell coincides" with the input. A class with an
   * `enantiomorph` is two entries there, one per type.
   */
  readonly supercellLattice: boolean;
  /** The classes that cover this one (minimal supergroups in the list), by id. */
  readonly coveredBy: readonly number[];
  /** True when the parent covers it: a maximal subgroup within the bound. */
  readonly maximal: boolean;
  /**
   * True for a class with the supercell's lattice that lies below no other
   * such class: maximal in Bilbao's SUBGROUPS list for the supercell.
   */
  readonly maximalInSupercell: boolean;
  /** The ITA standard-setting name with (P_H, p_H); absent when naming was skipped. */
  readonly identity?: SubgroupIdentity;
  /**
   * For a class of a chiral type (P4₁22, P3₁21, …; the 11 enantiomorphic
   * pairs): the other type of the pair, named in standard setting, when the
   * class holds it too. An improper operation of the parent that keeps the
   * supercell (−1 always does) turns the representative into its mirror
   * image, a member of the same class. Bilbao's SUBGROUPS lists such a class
   * twice, once per type; MATERIA lists it once. Absent when naming was skipped.
   */
  readonly enantiomorph?: SubgroupIdentity;
}

/** The 11 enantiomorphic pairs of space-group types, both ways (P4₁ #76 ↔ P4₃ #78, …). */
const ENANTIOMORPHS: ReadonlyMap<number, number> = new Map(
  [[76, 78], [91, 95], [92, 96], [144, 145], [151, 153], [152, 154], [169, 170], [171, 172], [178, 179], [180, 181], [212, 213]]
    .flatMap(([a, b]) => [[a!, b!], [b!, a!]] as [number, number][]),
);

export interface SupercellLattice {
  readonly factorOrder: number;
  readonly classes: readonly SubgroupClass[];
  /** Covering edges [lower, upper] between classes. */
  readonly edges: readonly (readonly [number, number])[];
  /** Subgroups (members of all classes, conjugates included) the search found. */
  readonly subgroupCount: number;
}

export interface LatticeOptions {
  /** The largest index [G : H] listed (all by default). */
  readonly maxIndex?: number;
  /** Name every class in standard setting (default true). */
  readonly name?: boolean;
}

/** The index split of a subgroup of F: point-group factor t, translation factor k = |T/T″| / |T_H/T″|. */
export function latticeIndexSplit(group: FactorGroup, elements: readonly number[]): IndexSplit {
  const rotations = new Set(elements.map((i) => ikey(group.elements[i]!.W)));
  const translations = elements.filter((i) => iIsIdentity(group.elements[i]!.W)).length;
  return { t: pointGroupElements(group).length / rotations.size, k: group.translations.length / translations };
}

/**
 * The classes of subgroups compatible with the bound's supercell, up to
 * `maxIndex`, each with its covering edges and (by default) its name. See
 * the module comment; throws SubgroupSearchTooLarge above the ceiling.
 */
export function supercellSubgroups(group: FactorGroup, opts: LatticeOptions = {}): SupercellLattice {
  const F = group.elements.length;
  if (F > MAX_FACTOR_ORDER) {
    throw new SubgroupSearchTooLarge(`the factor group G/T″ has ${F} elements, above the ${MAX_FACTOR_ORDER} this search is measured for; choose a smaller supercell`);
  }
  const maxIndex = opts.maxIndex ?? Number.POSITIVE_INFINITY;
  const { D, supercell } = group.bound;
  const T = group.translations;
  const tSetOf = (xs: readonly number[]): Uint8Array => {
    const m = new Uint8Array(F);
    for (const x of xs) m[x] = 1;
    return m;
  };
  // The translations of the supercell, and their images under the point group.
  const N = T.filter((t) => inLattice(supercell, scaleVec(group.elements[t]!.w, D)));
  const pgReps = pointGroupElements(group);
  const conj = (g: number, x: number): number => group.table[group.table[g]![x]!]![group.inverse[g]!]!;
  const conjugatesOfN = new Map<string, number[]>();
  for (const g of pgReps) {
    const img = N.map((t) => conj(g, t)).sort((a, b) => a - b);
    conjugatesOfN.set(img.join(","), img);
  }
  // Subgroups of the abelian group T/T″ that contain a conjugate of the supercell.
  const generateFrom = (seed: readonly number[], gens: readonly number[], mark: Uint8Array, limit: number): number[] | null => {
    const out = [...seed];
    for (const x of seed) mark[x] = 1;
    const queue = [...seed];
    while (queue.length > 0) {
      const a = queue.pop()!;
      for (const g of gens) {
        const b = group.table[a]![g]!;
        if (!mark[b]) {
          mark[b] = 1;
          out.push(b);
          if (out.length > limit) {
            for (const x of out) mark[x] = 0;
            return null;
          }
          queue.push(b);
        }
      }
    }
    for (const x of out) mark[x] = 0;
    return out.sort((x, y) => x - y);
  };
  const scratch = new Uint8Array(F);
  const tSubgroups = new Map<string, number[]>();
  for (const base of conjugatesOfN.values()) {
    const start = generateFrom([group.identity], base, scratch, F)!;
    const key = start.join(",");
    if (tSubgroups.has(key)) continue;
    tSubgroups.set(key, start);
    const queue = [start];
    while (queue.length > 0) {
      const S = queue.pop()!;
      const inS = tSetOf(S);
      for (const t of T) {
        if (inS[t]) continue;
        const next = generateFrom(S, [t], scratch, F)!;
        const k = next.join(",");
        if (!tSubgroups.has(k)) {
          tSubgroups.set(k, next);
          queue.push(next);
        }
      }
    }
  }

  // Point subgroups of Ḡ, as rotation keys.
  const byRotation = new Map<string, number[]>();
  group.elements.forEach((e, i) => {
    const key = ikey(e.W);
    const list = byRotation.get(key);
    if (list) list.push(i);
    else byRotation.set(key, [i]);
  });
  const ctx = buildCosetContext(group.parentOperations);
  const wKey = (op: SymmetryOperation): string => op.rotation.map((row) => row.map((x) => Math.round(x)).join(",")).join(";");
  const pointSubgroups = allSubgroups(ctx).map((S) => S.map((ci) => wKey(ctx.cosets[ci]!)));

  const found = new Map<string, number[]>();
  for (const rotations of pointSubgroups) {
    // A generating set of the rotation group, greedily, with the orders of its prefixes.
    const repOf = (r: string): number => byRotation.get(r)![0]!;
    const gens: string[] = [];
    const prefixOrder: number[] = [];
    let span = new Set<string>([ikey(group.elements[group.identity]!.W)]);
    for (const r of rotations) {
      if (span.has(r)) continue;
      gens.push(r);
      span = new Set(generateFrom([group.identity], gens.map(repOf), scratch, F)!.map((i) => ikey(group.elements[i]!.W)));
      prefixOrder.push(span.size);
    }
    for (const TH of tSubgroups.values()) {
      const order = rotations.length * TH.length;
      if (F / order > maxIndex) continue;
      // Condition A: T_H invariant under the rotations.
      const inT = tSetOf(TH);
      if (!gens.every((r) => TH.every((t) => inT[conj(repOf(r), t)]))) continue;
      // Lifts of each generator modulo T_H.
      const choices = gens.map((r) => {
        const reps: number[] = [];
        const covered = new Uint8Array(F);
        for (const f of byRotation.get(r)!) {
          if (covered[f]) continue;
          reps.push(f);
          for (const t of TH) covered[group.table[f]![t]!] = 1;
        }
        return reps;
      });
      // Condition B, generator by generator (backtracking).
      const pick: number[] = [];
      const extend = (j: number, current: number[]): void => {
        if (j === gens.length) {
          const key = current.join(",");
          if (!found.has(key)) {
            found.set(key, current);
            if (found.size > MAX_SUBGROUPS) throw new SubgroupSearchTooLarge(`more than ${MAX_SUBGROUPS} subgroups in the bound; choose a smaller supercell or a lower maximum index`);
          }
          return;
        }
        const expected = prefixOrder[j]! * TH.length;
        for (const g of choices[j]!) {
          pick[j] = g;
          const H = generateFrom(TH, pick.slice(0, j + 1), scratch, expected);
          if (H && H.length === expected) extend(j + 1, H);
        }
      };
      extend(0, TH);
    }
  }

  // Conjugacy classes in F, then those with a member that keeps the supercell.
  const subgroups = [...found.values()].sort((a, b) => b.length - a.length || (a.join(",") < b.join(",") ? -1 : 1));
  const keepsSupercell = (H: readonly number[]): boolean => {
    const inH = tSetOf(H);
    return N.every((t) => inH[t]);
  };
  /** T_H = T′ exactly: the subgroup's translations are the supercell's. */
  const hasSupercellLattice = (H: readonly number[]): boolean => keepsSupercell(H) && H.filter((h) => iIsIdentity(group.elements[h]!.W)).length === N.length;
  const classOf = new Map<string, number>();
  const classMembers: number[][][] = [];
  for (const H of subgroups) {
    const key = H.join(",");
    if (classOf.has(key)) continue;
    const id = classMembers.length;
    const members = new Map<string, number[]>();
    for (let g = 0; g < F; g++) {
      const c = H.map((h) => conj(g, h)).sort((x, y) => x - y);
      const k = c.join(",");
      if (!members.has(k)) members.set(k, c);
    }
    for (const k of members.keys()) classOf.set(k, id);
    classMembers.push([...members.values()]);
  }
  const kept = classMembers.map((members, id) => ({ id, members, inSupercell: members.filter(keepsSupercell), exact: members.some(hasSupercellLattice) })).filter((c) => c.inSupercell.length > 0);
  kept.sort((a, b) => b.members[0]!.length - a.members[0]!.length || a.id - b.id);

  // Covering edges: for each class representative, its minimal proper supergroups among all listed subgroups.
  const allMembers: { cls: number; set: Uint8Array; size: number }[] = [];
  kept.forEach((c, ci) => c.members.forEach((m) => allMembers.push({ cls: ci, set: tSetOf(m), size: m.length })));
  const reps = kept.map((c) => c.inSupercell[0]!);
  const coveredBy: number[][] = reps.map((rep) => {
    const supers = allMembers.filter((x) => x.size > rep.length && x.size % rep.length === 0 && rep.every((h) => x.set[h]));
    const minimal = supers.filter((x) => !supers.some((y) => y !== x && y.size < x.size && x.size % y.size === 0 && isSubset(y.set, x.set, F)));
    return [...new Set(minimal.map((x) => x.cls))].sort((a, b) => a - b);
  });

  // Every class above each one (transitively), for the maximal classes of the supercell list.
  const ancestors = coveredBy.map(() => new Set<number>());
  const above = (ci: number): Set<number> => {
    const acc = ancestors[ci]!;
    if (acc.size > 0 || coveredBy[ci]!.length === 0) return acc;
    for (const u of coveredBy[ci]!) {
      acc.add(u);
      for (const x of above(u)) acc.add(x);
    }
    return acc;
  };
  /**
   * The other type of a chiral representative's enantiomorphic pair, when the
   * class holds it: the representative conjugated by an improper operation
   * that keeps the supercell (its mirror image), named.
   */
  const enantiomorphOf = (rep: readonly number[], identity: SubgroupIdentity): SubgroupIdentity | undefined => {
    const partner = identity.number === undefined ? undefined : ENANTIOMORPHS.get(identity.number);
    if (partner === undefined) return undefined;
    for (let g = 0; g < F; g++) {
      if (idet(group.elements[g]!.W) > 0) continue;
      const image = rep.map((h) => conj(g, h)).sort((x, y) => x - y);
      if (!keepsSupercell(image)) continue;
      const named = nameChild(group, image);
      return named.number === partner ? named : undefined;
    }
    return undefined;
  };
  const parentType = opts.name === false ? undefined : nameChild(group, group.elements.map((_, i) => i)).number;
  const classes: SubgroupClass[] = kept.map((c, ci) => {
    const rep = reps[ci]!;
    const index = latticeIndexSplit(group, rep);
    const kind: LatticeKind = rep.length === F ? "parent" : index.k === 1 ? "t" : index.t === 1 ? "k" : "general";
    const identity = opts.name === false ? undefined : nameChild(group, rep);
    const enantiomorph = identity ? enantiomorphOf(rep, identity) : undefined;
    return {
      id: ci,
      elements: rep,
      operations: rep.map((i) => group.operations[i]!),
      order: rep.length,
      index,
      kind,
      cellMultiplying: !keepsConventionalCell(group, rep),
      isomorphic: kind === "k" && identity?.number !== undefined && identity.number === parentType,
      orientationStates: c.members.length,
      domainStates: F / rep.length,
      membersInSupercell: c.inSupercell.length,
      supercellLattice: c.exact,
      coveredBy: coveredBy[ci]!,
      maximal: coveredBy[ci]!.length === 1 && coveredBy[ci]![0] === 0 && ci !== 0,
      maximalInSupercell: c.exact && ![...above(ci)].some((u) => kept[u]!.exact),
      ...(identity ? { identity } : {}),
      ...(enantiomorph ? { enantiomorph } : {}),
    };
  });
  const edges: [number, number][] = [];
  classes.forEach((c) => c.coveredBy.forEach((u) => edges.push([c.id, u])));
  return { factorOrder: F, classes, edges, subgroupCount: subgroups.length };
}

function isSubset(a: Uint8Array, b: Uint8Array, n: number): boolean {
  for (let i = 0; i < n; i++) if (a[i] && !b[i]) return false;
  return true;
}
