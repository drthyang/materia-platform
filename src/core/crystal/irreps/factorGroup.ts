/**
 * The finite group the irreps, the isotropy subgroups and the subgroup
 * lattice live in: the parent group modulo the translations of a supercell
 * bound, F = G/T_P (ADR 2; docs/research/SUBGROUP_ENGINES.md §6(a)).
 *
 * Phase 1 bounds every search by the conventional cell itself, T_P = ℤ³. A
 * space group's operation list is then already F: one element per operation,
 * the centring translations included, composed modulo the integer
 * translations (Fm-3m: 48 × 4 = 192 elements). The k-points the bound admits
 * are the reciprocal vectors k with k·t ∈ ℤ for every t ∈ ℤ³ — the integer
 * vectors — taken modulo the parent's reciprocal lattice Λ*: Γ, and for a
 * centred lattice the decentring points that keep the conventional cell
 * (X for F, H for I, (1,0,0) for C, (0,0,1) for R on hexagonal axes).
 */

import type { SymmetryOperation } from "@/core/crystal/types";
import {
  compose, exactOp, iinv, ikey, iIsIdentity, invert, itransMulVec, risInt, vdot, vkey, vmod1, vsub, rat, type ExactOp, type RVec,
} from "@/core/crystal/irreps/rational";

export interface FactorGroup {
  /** The parent's operations, one per element (element i is operations[i]). */
  readonly operations: readonly SymmetryOperation[];
  /** The elements exactly, translations in [0, 1). */
  readonly elements: readonly ExactOp[];
  /** elements[a]·elements[b] = elements[table[a][b]]. */
  readonly table: readonly (readonly number[])[];
  readonly inverse: readonly number[];
  readonly identity: number;
  /** The parent lattice's translations modulo ℤ³ (its centring vectors), zero first. */
  readonly centrings: readonly RVec[];
}

const elementKey = (op: ExactOp): string => `${ikey(op.W)}|${vkey(vmod1(op.w))}`;

/** The parent group modulo the conventional cell's translations, from its operation list. */
export function factorGroup(operations: readonly SymmetryOperation[]): FactorGroup {
  if (operations.length === 0) throw new Error("factorGroup: no operations");
  const elements = operations.map((op) => {
    const e = exactOp(op);
    return { W: e.W, w: vmod1(e.w) };
  });
  const index = new Map<string, number>();
  elements.forEach((e, i) => {
    const key = elementKey(e);
    if (index.has(key)) throw new Error(`factorGroup: operation ${operations[i]!.xyz} is listed twice`);
    index.set(key, i);
  });
  const table = elements.map((a) => elements.map((b) => {
    const c = index.get(elementKey(compose(a, b)));
    if (c === undefined) throw new Error("factorGroup: the operations are not closed modulo the lattice");
    return c;
  }));
  const identity = elements.findIndex((e) => iIsIdentity(e.W) && e.w.every((x) => x.n === 0));
  if (identity < 0) throw new Error("factorGroup: no identity operation");
  const inverse = elements.map((e) => index.get(elementKey(invert(e)))!);
  const centrings = elements.filter((e) => iIsIdentity(e.W)).map((e) => e.w);
  centrings.sort((a, b) => Number(b.every((x) => x.n === 0)) - Number(a.every((x) => x.n === 0)));
  return { operations, elements, table, inverse, identity, centrings };
}

/** True when k − k′ is a vector of the parent's reciprocal lattice Λ*. */
export function equivalentK(group: FactorGroup, k: RVec, kp: RVec): boolean {
  const d = vsub(k, kp);
  if (!d.every(risInt)) return false;
  return group.centrings.every((c) => risInt(vdot(d, c)));
}

/** The image of k under the rotation W of an element: W⁻ᵀk (the arm it carries k to). */
export const rotateK = (W: ExactOp["W"], k: RVec): RVec => itransMulVec(iinv(W), k);

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

/** True when the bound (the conventional cell) admits k: k·t ∈ ℤ for every integer t, i.e. k is an integer vector. */
export const kInBound = (k: RVec): boolean => k.every(risInt);

/**
 * The stars of the k-points the bound admits, one representative each, Γ
 * first: the integer vectors modulo Λ*, grouped into orbits of the point
 * group. The representative is the arm with the smallest, then the
 * "latest-axis" components ((0,0,1) before (1,0,0)).
 */
export function starsInBound(group: FactorGroup): RVec[] {
  const candidates: RVec[] = [];
  for (const a of [0, 1, -1, 2]) for (const b of [0, 1, -1, 2]) for (const c of [0, 1, -1, 2]) candidates.push([rat(a), rat(b), rat(c)]);
  const weight = (k: RVec): number => k.reduce((s, x) => s + Math.abs(x.n), 0);
  const order = (k: RVec): number[] => [weight(k), ...k.map((x) => Math.abs(x.n)), ...k.map((x) => -x.n)];
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
