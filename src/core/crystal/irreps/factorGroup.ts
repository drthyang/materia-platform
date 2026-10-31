/**
 * The finite group the irreps, the isotropy subgroups and the subgroup
 * lattice live in: the parent group modulo the translations of the point-group
 * core of a supercell bound, F = G/T″ (ADR 0002; supercell.ts;
 * docs/research/SUBGROUP_ENGINES.md §6(a) and Implications item 1).
 *
 * Without a bound, F is Phase 1's G/ℤ³: the space group's operation list
 * itself, one element per operation, the centring translations included,
 * composed modulo the integer translations (Fm-3m: 48 × 4 = 192 elements).
 * With a supercell P (the 2×2×2 conventional cell by default in the app),
 * every operation is taken with every translation of T/T″: Pm-3m in 2×2×2,
 * 48 × 8 = 384 elements; Fm-3m, 48 × 32 = 1536. Element i < |operations|
 * is still operation i, so a bound of P = I gives Phase 1's group exactly.
 *
 * The k-points the bound admits are the reciprocal vectors k with k·t ∈ ℤ
 * for every t ∈ T″ (taken modulo the parent's reciprocal lattice Λ*), and the
 * stars listed are those with an arm in the supercell's dual (k·t ∈ ℤ for
 * every t ∈ T′): with P = I, Γ and the decentring points that keep the
 * conventional cell; with 2×2×2, Pm-3m's X, M and R and Fm-3m's L, W and X.
 */

import type { SymmetryOperation } from "@/core/crystal/types";
import { formatOperationXyz } from "@/core/crystal/symmetry";
import {
  exactOp, iinv, ikey, iIsIdentity, imul, itransMulVec, risInt, vdot, vmod1, vsub, rat, rnum, type ExactOp, type IMat, type RVec,
} from "@/core/crystal/irreps/rational";
import {
  boundLattices, cosets, exponent, iapply, inDual, reduceMod, scaleVec, unscaleVec, CONVENTIONAL_CELL, type BoundLattices, type IVec, type SupercellMatrix, type SupercellSpec,
} from "@/core/crystal/irreps/supercell";

export interface FactorGroup {
  /**
   * One operation per element: element i < |parent operations| is the
   * parent's operation i; with a supercell bound the others carry the
   * translations of T/T″ (their translation is the element's, below).
   */
  readonly operations: readonly SymmetryOperation[];
  /** The elements exactly, translations reduced modulo T″ (in [0, 1) without a bound). */
  readonly elements: readonly ExactOp[];
  /** elements[a]·elements[b] = elements[table[a][b]]. */
  readonly table: readonly (readonly number[])[];
  readonly inverse: readonly number[];
  readonly identity: number;
  /** The parent lattice's translations modulo ℤ³ (its centring vectors), zero first. */
  readonly centrings: readonly RVec[];
  /** The pure translations of F (T/T″), as element indices, the identity first. */
  readonly translations: readonly number[];
  /** The bound's lattices (T, T′, T″), scaled. */
  readonly bound: BoundLattices;
  /** The parent's operation list, as given. */
  readonly parentOperations: readonly SymmetryOperation[];
}

/**
 * The parent group modulo the bound's core T″ (see the module comment). With
 * no supercell the bound is the conventional cell (Phase 1's group).
 */
export function factorGroup(operations: readonly SymmetryOperation[], supercell: SupercellMatrix | SupercellSpec = CONVENTIONAL_CELL): FactorGroup {
  if (operations.length === 0) throw new Error("factorGroup: no operations");
  const exact = operations.map(exactOp);
  const centrings: RVec[] = [];
  for (const e of exact) {
    if (!iIsIdentity(e.W)) continue;
    const c = vmod1(e.w);
    if (!centrings.some((q) => vsub(q, c).every((x) => x.n === 0))) centrings.push(c);
  }
  if (!centrings.some((c) => c.every((x) => x.n === 0))) centrings.push([rat(0), rat(0), rat(0)]);
  centrings.sort((a, b) => Number(b.every((x) => x.n === 0)) - Number(a.every((x) => x.n === 0)));
  // The distinct rotations, indexed, with their product table.
  const rotKeys = new Map<string, number>();
  const rots: IMat[] = [];
  for (const e of exact) {
    const key = ikey(e.W);
    if (!rotKeys.has(key)) {
      rotKeys.set(key, rots.length);
      rots.push(e.W);
    }
  }
  const rotTable = rots.map((A) => rots.map((B) => {
    const r = rotKeys.get(ikey(imul(A, B)));
    if (r === undefined) throw new Error("factorGroup: the rotations are not closed");
    return r;
  }));
  const bound = boundLattices(supercell, centrings, exact.map((e) => e.w), rots);
  const { D, core } = bound;
  // Elements as (rotation, scaled translation reduced modulo T″), keyed by an integer.
  const span = [core[0][0], core[1][1], core[2][2]] as const;
  const tKey = (v: IVec): number => v[0] + span[0] * (v[1] + span[1] * v[2]);
  const keyOf = (r: number, v: IVec): number => r * span[0] * span[1] * span[2] + tKey(v);
  const shifts = cosets(bound.parent, core);
  const rotOf: number[] = [];
  const trans: IVec[] = [];
  const index = new Map<number, number>();
  const ops: SymmetryOperation[] = [];
  for (const t of shifts) {
    exact.forEach((e, i) => {
      const r = rotKeys.get(ikey(e.W))!;
      const s0 = scaleVec(e.w, D);
      const v = reduceMod(core, [s0[0] + t[0], s0[1] + t[1], s0[2] + t[2]]);
      const key = keyOf(r, v);
      if (index.has(key)) {
        if (t === shifts[0]) throw new Error(`factorGroup: operation ${operations[i]!.xyz} is listed twice`);
        return;
      }
      index.set(key, rotOf.length);
      rotOf.push(r);
      trans.push(v);
      if (t === shifts[0] && shifts.length === centrings.length) ops.push(operations[i]!);
      else {
        const w = unscaleVec(v, D);
        const translation = [rnum(w[0]), rnum(w[1]), rnum(w[2])] as const;
        ops.push({ rotation: operations[i]!.rotation, translation: [...translation], xyz: formatOperationXyz(operations[i]!.rotation, [...translation]) });
      }
    });
  }
  const n = rotOf.length;
  if (n !== rots.length * shifts.length) {
    throw new Error("factorGroup: the operations are not closed modulo the lattice");
  }
  const elements: ExactOp[] = rotOf.map((r, i) => ({ W: rots[r]!, w: unscaleVec(trans[i]!, D) }));
  const table = rotOf.map((ra, a) => {
    const row = new Array<number>(n);
    const Wa = rots[ra]!;
    const ta = trans[a]!;
    for (let b = 0; b < n; b++) {
      const wb = iapply(Wa, trans[b]!);
      const v = reduceMod(core, [ta[0] + wb[0], ta[1] + wb[1], ta[2] + wb[2]]);
      const c = index.get(keyOf(rotTable[ra]![rotOf[b]!]!, v));
      if (c === undefined) throw new Error("factorGroup: the operations are not closed modulo the lattice");
      row[b] = c;
    }
    return row;
  });
  const identity = elements.findIndex((e) => iIsIdentity(e.W) && e.w.every((x) => x.n === 0));
  if (identity < 0) throw new Error("factorGroup: no identity operation");
  const inverse = table.map((row) => row.indexOf(identity));
  const translations = elements.map((e, i) => (iIsIdentity(e.W) ? i : -1)).filter((i) => i >= 0);
  translations.sort((a, b) => Number(b === identity) - Number(a === identity));
  return { operations: ops, elements, table, inverse, identity, centrings, translations, bound, parentOperations: operations };
}

/** True when k − k′ is a vector of the parent's reciprocal lattice Λ*. */
export function equivalentK(group: FactorGroup, k: RVec, kp: RVec): boolean {
  const d = vsub(k, kp);
  if (!d.every(risInt)) return false;
  return group.centrings.every((c) => risInt(vdot(d, c)));
}

/** The image of k under the rotation W of an element: W⁻ᵀk (the arm it carries k to). */
export const rotateK = (W: ExactOp["W"], k: RVec): RVec => itransMulVec(iinv(W), k);

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

const generatorCache = new WeakMap<FactorGroup, number[]>();

/** A generating set of the factor group, greedily: each element not yet generated joins it. */
export function generatorsOf(group: FactorGroup): number[] {
  const cached = generatorCache.get(group);
  if (cached) return cached;
  const gens: number[] = [];
  const inSpan = new Uint8Array(group.elements.length);
  inSpan[group.identity] = 1;
  let span = [group.identity];
  for (let x = 0; x < group.elements.length; x++) {
    if (inSpan[x]) continue;
    gens.push(x);
    // Close the span under right multiplication by every generator.
    const queue = [...span];
    while (queue.length > 0) {
      const a = queue.pop()!;
      for (const g of gens) {
        const b = group.table[a]![g]!;
        if (!inSpan[b]) {
          inSpan[b] = 1;
          span.push(b);
          queue.push(b);
        }
      }
    }
    span = [...span];
  }
  generatorCache.set(group, gens);
  return gens;
}

const pointGroupCache = new WeakMap<FactorGroup, number[]>();

/**
 * The distinct rotations of the group (its point group), each with its coset
 * representative: the element with that rotation and the smallest translation
 * (lexicographically, in [0, 1)). The identity comes first, then the
 * rotations in a fixed order of their matrices, so every choice built on them
 * (arms, coset representatives, the factor system) is independent of the
 * order of the operation list.
 */
export function pointGroupElements(group: FactorGroup): number[] {
  const cached = pointGroupCache.get(group);
  if (cached) return cached;
  const best = new Map<string, number>();
  const tLess = (a: RVec, b: RVec): boolean => {
    for (let i = 0; i < 3; i++) {
      const d = a[i]!.n * b[i]!.d - b[i]!.n * a[i]!.d;
      if (d !== 0) return d < 0;
    }
    return false;
  };
  group.elements.forEach((e, i) => {
    const key = ikey(e.W);
    const cur = best.get(key);
    if (cur === undefined || tLess(e.w, group.elements[cur]!.w)) best.set(key, i);
  });
  const idKey = ikey(group.elements[group.identity]!.W);
  const out = [...best.entries()].sort(([a], [b]) => (a === idKey ? -1 : b === idKey ? 1 : a < b ? -1 : a > b ? 1 : 0)).map(([, i]) => i);
  pointGroupCache.set(group, out);
  return out;
}

/** True when the bound admits k: k·t ∈ ℤ for every t of the core T″ (Phase 1's bound: k an integer vector). */
export const kInBound = (group: FactorGroup, k: RVec): boolean => inDual(group.bound.core, k, group.bound.D);

/** True when k lies in the supercell's dual: k·t ∈ ℤ for every t of T′. */
export const kInSupercell = (group: FactorGroup, k: RVec): boolean => inDual(group.bound.supercell, k, group.bound.D);

/**
 * The canonical arm of k's star: of all its arms, the first in starsInBound's
 * order, whatever the supercell. An irrep's number at a star ("irrep n of m")
 * depends on the arm it is induced from, and starsInBound takes the first arm
 * in the supercell's dual, which can differ between bounds; this one does not.
 * For a bound whose supercell admits every arm (the default 2×2×2 of a cubic
 * or hexagonal parent) the two agree.
 */
export function canonicalArm(group: FactorGroup, k: RVec): RVec {
  const { core, D } = group.bound;
  const m = exponent(core);
  const M = m / gcd(m, D);
  const rotations = pointGroupElements(group).map((i) => group.elements[i]!.W);
  const arms: RVec[] = [];
  for (const W of rotations) {
    const kp = rotateK(W, k);
    if (!arms.some((q) => equivalentK(group, q, kp))) arms.push(kp);
  }
  const values: number[] = [0];
  for (let n = 1; n <= 2 * M; n++) {
    values.push(n);
    if (n <= M) values.push(-n);
  }
  const weight = (q: RVec): number => q.reduce((s, x) => s + Math.abs(x.n) * (M / x.d), 0);
  const order = (q: RVec): number[] => [weight(q), ...q.map((x) => Math.abs(x.n) * (M / x.d)), ...q.map((x) => -x.n * (M / x.d))];
  const less = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
    return false;
  };
  let best: { k: RVec; order: number[] } | null = null;
  for (const a of values) for (const b of values) for (const c of values) {
    const q: RVec = [rat(a, M), rat(b, M), rat(c, M)];
    if (!arms.some((arm) => equivalentK(group, arm, q))) continue;
    const o = order(q);
    if (best === null || less(o, best.order)) best = { k: q, order: o };
  }
  if (!best) throw new Error("canonicalArm: k is not in the bound");
  return best.k;
}

/**
 * The stars of the k-points the bound admits, one representative each, Γ
 * first: the vectors of the core's dual modulo Λ*, grouped into orbits of the
 * point group, keeping the stars with an arm in the supercell's dual. The
 * representative is the first such arm in the order: the smallest, then the
 * "latest-axis" components ((0,0,1) before (1,0,0)); components n/M with M
 * the smallest integer for which M·ℤ³ ⊆ T″ (Phase 1: integers).
 */
export function starsInBound(group: FactorGroup): RVec[] {
  const { core, D } = group.bound;
  // M·ℤ³ ⊆ T″ (scaled: M·D·ℤ³ ⊆ core), so the core's dual lies in (1/M)ℤ³.
  const m = exponent(core);
  const M = m / gcd(m, D);
  const values: number[] = [0];
  for (let n = 1; n <= 2 * M; n++) {
    values.push(n);
    if (n <= M) values.push(-n);
  }
  const candidates: RVec[] = [];
  for (const a of values) for (const b of values) for (const c of values) {
    const k: RVec = [rat(a, M), rat(b, M), rat(c, M)];
    if (kInBound(group, k) && kInSupercell(group, k)) candidates.push(k);
  }
  const weight = (k: RVec): number => k.reduce((s, x) => s + Math.abs(x.n) * (M / x.d), 0);
  const order = (k: RVec): number[] => [weight(k), ...k.map((x) => Math.abs(x.n) * (M / x.d)), ...k.map((x) => -x.n * (M / x.d))];
  const lex = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  };
  candidates.sort((a, b) => lex(order(a), order(b)));
  const classes: RVec[] = [];
  for (const k of candidates) if (!classes.some((q) => equivalentK(group, q, k))) classes.push(k);
  const rotations = pointGroupElements(group).map((i) => group.elements[i]!.W);
  const stars: RVec[][] = [];
  for (const k of classes) {
    if (stars.some((s) => s.some((q) => equivalentK(group, q, k)))) continue;
    const orbit: RVec[] = [];
    for (const W of rotations) {
      const kp = rotateK(W, k);
      if (!orbit.some((q) => equivalentK(group, q, kp))) orbit.push(kp);
    }
    stars.push([k, ...orbit]);
  }
  return stars.map((s) => s[0]!);
}
