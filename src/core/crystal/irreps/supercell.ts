/**
 * The supercell bound of a subgroup search (ADR 0002; GLOSSARY "Supercell
 * bound"): the lattices it involves, exactly.
 *
 *  - T, the parent's lattice: ℤ³ and its centring vectors;
 *  - T′, the supercell: the lattice spanned by the columns of P (conventional
 *    basis; the default is the 2×2×2 conventional cell, P = 2·I); it must be
 *    a sublattice of T;
 *  - T″ = ∩_R R·T′ over the parent's point group, the point-group core of T′
 *    (docs/research/SUBGROUP_ENGINES.md, Implications item 1). T″ is the
 *    largest sublattice of T′ every operation of the parent leaves invariant,
 *    so it is normal in G and G/T″ is a finite group: the factor group the
 *    irreps, the isotropy subgroups and the subgroup lattice live in.
 *
 * Every lattice here lies in (1/D)ℤ³ for one integer D (the common
 * denominator of P, the centring vectors and the operations' translations),
 * and is held as the Hermite normal form of its basis in those scaled
 * integer coordinates: rows b₀ = (h₀₀, h₀₁, h₀₂), b₁ = (0, h₁₁, h₁₂),
 * b₂ = (0, 0, h₂₂), h_ii > 0. A vector reduced modulo a lattice by these rows
 * has its i-th component in [0, h_ii) — a canonical coset representative.
 */

import { rat, type Rat, type RVec } from "@/core/crystal/irreps/rational";

/** An integer vector in the scaled coordinates D·x. */
export type IVec = readonly [number, number, number];
/** The Hermite normal form of a full-rank lattice basis: three upper-triangular rows. */
export type Hnf = readonly [IVec, IVec, IVec];

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}
const lcm = (a: number, b: number): number => (a === 0 || b === 0 ? Math.max(a, b) : Math.abs(a * b) / gcd(a, b));

/** Extended Euclid: [g, s, t] with s·a + t·b = g = gcd(a, b) ≥ 0. */
function egcd(a: number, b: number): [number, number, number] {
  let [r0, r1, s0, s1, t0, t1] = [a, b, 1, 0, 0, 1];
  while (r1 !== 0) {
    const q = Math.trunc(r0 / r1);
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  return r0 < 0 ? [-r0, -s0, -t0] : [r0, s0, t0];
}

const sub = (a: IVec, b: IVec, q = 1): IVec => [a[0] - q * b[0], a[1] - q * b[1], a[2] - q * b[2]];
const mod = (a: number, m: number): number => ((a % m) + m) % m;

/**
 * The Hermite normal form of the lattice the vectors generate (it must have
 * full rank). Row-style elimination with the extended Euclidean algorithm,
 * then the entries above each pivot reduced into [0, pivot).
 */
export function hnf(vectors: readonly IVec[]): Hnf {
  const rows: (IVec | null)[] = [null, null, null];
  const insert = (v0: IVec): void => {
    let v = v0;
    for (let i = 0; i < 3; i++) {
      if (v[i] === 0) continue;
      const r = rows[i];
      if (!r) {
        rows[i] = v[i]! < 0 ? [-v[0], -v[1], -v[2]] : v;
        return;
      }
      const [g, s, t] = egcd(r[i]!, v[i]!);
      const a = r[i]! / g;
      const b = v[i]! / g;
      const pivot: IVec = [s * r[0] + t * v[0], s * r[1] + t * v[1], s * r[2] + t * v[2]];
      const rest: IVec = [a * v[0] - b * r[0], a * v[1] - b * r[1], a * v[2] - b * r[2]];
      rows[i] = pivot;
      v = rest;
    }
  };
  for (const v of vectors) insert(v);
  if (!rows[0] || !rows[1] || !rows[2]) throw new Error("supercell: the vectors do not span a full lattice");
  // Reduce above the pivots.
  const out = rows as IVec[];
  for (let i = 1; i < 3; i++) {
    for (let j = 0; j < i; j++) {
      const q = Math.floor(out[j]![i]! / out[i]![i]!);
      if (q !== 0) out[j] = sub(out[j]!, out[i]!, q);
    }
  }
  return [out[0]!, out[1]!, out[2]!];
}

/** The canonical representative of v modulo the lattice: component i in [0, h_ii). */
export function reduceMod(h: Hnf, v: IVec): IVec {
  let x = v;
  for (let i = 0; i < 3; i++) {
    const q = Math.floor(x[i]! / h[i]![i]!);
    if (q !== 0) x = sub(x, h[i]!, q);
  }
  return x;
}

export const inLattice = (h: Hnf, v: IVec): boolean => {
  const r = reduceMod(h, v);
  return r[0] === 0 && r[1] === 0 && r[2] === 0;
};

/** |det| of the basis: the lattice's index in ℤ³ (scaled coordinates). */
export const hnfDet = (h: Hnf): number => h[0][0] * h[1][1] * h[2][2];

/** The smallest M with M·ℤ³ ⊆ the lattice (its exponent in the scaled coordinates). */
export function exponent(h: Hnf): number {
  const d = hnfDet(h);
  for (let m = 1; m <= d; m++) {
    if (d % m !== 0) continue;
    if ([0, 1, 2].every((i) => inLattice(h, [i === 0 ? m : 0, i === 1 ? m : 0, i === 2 ? m : 0]))) return m;
  }
  return d;
}

/** The cosets of `fine` modulo `coarse` (coarse ⊆ fine), canonical representatives, zero first. */
export function cosets(fine: Hnf, coarse: Hnf): IVec[] {
  // Σ a_i b_i over a_i ∈ [0, M/h_ii) covers fine/Mℤ³; reduce each modulo coarse.
  const m = exponent(coarse);
  const out = new Map<string, IVec>();
  const n = [m / fine[0][0], m / fine[1][1], m / fine[2][2]].map((x) => Math.ceil(x));
  for (let a = 0; a < n[0]!; a++) {
    for (let b = 0; b < n[1]!; b++) {
      for (let c = 0; c < n[2]!; c++) {
        const v: IVec = [
          a * fine[0][0] + b * fine[1][0] + c * fine[2][0],
          a * fine[0][1] + b * fine[1][1] + c * fine[2][1],
          a * fine[0][2] + b * fine[1][2] + c * fine[2][2],
        ];
        const r = reduceMod(coarse, v);
        const key = r.join(",");
        if (!out.has(key)) out.set(key, r);
      }
    }
  }
  const expected = hnfDet(coarse) / hnfDet(fine);
  if (out.size !== expected) throw new Error(`supercell: ${out.size} cosets found, expected ${expected}`);
  return [...out.values()].sort((u, v) => Number(v.every((x) => x === 0)) - Number(u.every((x) => x === 0)));
}

/** W·v for an integer matrix (row-major) and an integer column. */
export const iapply = (W: readonly (readonly number[])[], v: IVec): IVec => [
  W[0]![0]! * v[0] + W[0]![1]! * v[1] + W[0]![2]! * v[2],
  W[1]![0]! * v[0] + W[1]![1]! * v[1] + W[1]![2]! * v[2],
  W[2]![0]! * v[0] + W[2]![1]! * v[1] + W[2]![2]! * v[2],
];

/** The intersection of two lattices: the residues of `a` modulo a common exponent that lie in `b`, with that exponent's lattice. */
export function intersectLattices(a: Hnf, b: Hnf): Hnf {
  const m = lcm(exponent(a), exponent(b));
  const mm = hnf([[m, 0, 0], [0, m, 0], [0, 0, m]]);
  const gens: IVec[] = [[m, 0, 0], [0, m, 0], [0, 0, m]];
  for (const v of cosets(a, mm)) if (inLattice(b, v)) gens.push(v);
  return hnf(gens);
}

/** A rational 3×3 matrix with the basis vectors as its columns, as the user enters P: rows of numbers. */
export type SupercellMatrix = readonly (readonly number[])[];

/** A centring of the supercell, in the supercell's own basis (ITA letters; R on obverse hexagonal axes). */
export type SupercellCentring = "P" | "A" | "B" | "C" | "I" | "F" | "R";

/** A supercell bound: the basis P (columns) and, optionally, the centring of that cell. */
export interface SupercellSpec {
  readonly P: SupercellMatrix;
  readonly centring?: SupercellCentring;
}

const CENTRING_VECTORS: Record<SupercellCentring, readonly (readonly [number, number, number])[]> = {
  P: [],
  A: [[0, 0.5, 0.5]],
  B: [[0.5, 0, 0.5]],
  C: [[0.5, 0.5, 0]],
  I: [[0.5, 0.5, 0.5]],
  F: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
  R: [[2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]],
};

/** The lattice vectors that span a bound, in the parent's basis: P's columns and P·c for each centring vector c. */
export function supercellGenerators(spec: SupercellMatrix | SupercellSpec): { P: SupercellMatrix; generators: number[][] } {
  const P = "P" in spec && !Array.isArray(spec) ? (spec as SupercellSpec).P : (spec as SupercellMatrix);
  const centring = "P" in spec && !Array.isArray(spec) ? (spec as SupercellSpec).centring ?? "P" : "P";
  const cols = [0, 1, 2].map((j) => [P[0]![j]!, P[1]![j]!, P[2]![j]!]);
  const extra = CENTRING_VECTORS[centring].map((c) => [0, 1, 2].map((i) => P[i]![0]! * c[0] + P[i]![1]! * c[1] + P[i]![2]! * c[2]));
  return { P, generators: [...cols, ...extra] };
}

/** The default bound: the 2×2×2 conventional cell. */
export const DEFAULT_SUPERCELL: SupercellMatrix = [[2, 0, 0], [0, 2, 0], [0, 0, 2]];
/** Phase 1's bound: the conventional cell itself. */
export const CONVENTIONAL_CELL: SupercellMatrix = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** The lattices of a bound, scaled by D. */
export interface BoundLattices {
  /** Every vector and translation in play lies in (1/D)ℤ³. */
  readonly D: number;
  /** The parent's lattice T. */
  readonly parent: Hnf;
  /** The supercell T′ (the columns of P). */
  readonly supercell: Hnf;
  /** The point-group core T″ = ∩_R R·T′. */
  readonly core: Hnf;
  /** P as given, its columns the supercell's axes (conventional basis). */
  readonly P: readonly RVec[];
  /** The supercell's centring (P when none was given). */
  readonly centring: SupercellCentring;
}

/** The exact columns of P: entries as rationals with a denominator up to 12. */
export function supercellColumns(P: SupercellMatrix): RVec[] {
  if (P.length !== 3 || P.some((r) => r.length !== 3)) throw new Error("supercell: P must be a 3×3 matrix");
  return [0, 1, 2].map((j) => toRatVec([P[0]![j]!, P[1]![j]!, P[2]![j]!]));
}

function toRatVec(v: readonly number[]): RVec {
  const toRat = (x: number): Rat => {
    for (let d = 1; d <= 12; d++) {
      const n = Math.round(x * d);
      if (Math.abs(x * d - n) < 1e-9) return rat(n, d);
    }
    throw new Error(`supercell: entry ${x} of P is not a fraction with a denominator up to 12`);
  };
  return [toRat(v[0]!), toRat(v[1]!), toRat(v[2]!)];
}

/** The scaled integer vector D·v (v rational; throws when D does not clear its denominators). */
export function scaleVec(v: RVec, D: number): IVec {
  return v.map((x) => {
    const n = (x.n * D) / x.d;
    if (!Number.isInteger(n)) throw new Error("supercell: a denominator outside the bound's grid");
    return n;
  }) as unknown as IVec;
}

/** The rational vector v/D. */
export const unscaleVec = (v: IVec, D: number): RVec => [rat(v[0], D), rat(v[1], D), rat(v[2], D)];

/**
 * The lattices of the bound P for a parent with the given centring vectors,
 * translations and rotations (conventional basis). Throws when P is singular
 * or its columns are not lattice vectors of the parent.
 */
export function boundLattices(
  spec: SupercellMatrix | SupercellSpec,
  centrings: readonly RVec[],
  translations: readonly RVec[],
  rotations: readonly (readonly (readonly number[])[])[],
): BoundLattices {
  const { P, generators } = supercellGenerators(spec);
  const columns = supercellColumns(P);
  const gens = generators.map(toRatVec);
  let D = 1;
  for (const v of [...gens, ...centrings, ...translations]) for (const x of v) D = lcm(D, x.d);
  const parent = hnf([[D, 0, 0], [0, D, 0], [0, 0, D], ...centrings.map((c) => scaleVec(c, D))]);
  const cols = columns.map((c) => scaleVec(c, D));
  const det = cols[0]![0] * (cols[1]![1] * cols[2]![2] - cols[2]![1] * cols[1]![2])
    - cols[1]![0] * (cols[0]![1] * cols[2]![2] - cols[2]![1] * cols[0]![2])
    + cols[2]![0] * (cols[0]![1] * cols[1]![2] - cols[1]![1] * cols[0]![2]);
  if (det === 0) throw new Error("supercell: P is singular");
  const scaledGens = gens.map((c) => scaleVec(c, D));
  for (const c of scaledGens) if (!inLattice(parent, c)) throw new Error("supercell: a vector of the supercell is not a lattice vector of the parent");
  const supercell = hnf(scaledGens);
  let core = supercell;
  for (const W of rotations) core = intersectLattices(core, hnf([0, 1, 2].map((i) => iapply(W, supercell[i]!))));
  const centring = !Array.isArray(spec) && "P" in spec ? (spec as SupercellSpec).centring ?? "P" : "P";
  return { D, parent, supercell, core, P: columns, centring };
}

/** v·k for an integer (scaled) vector and a rational k: (v·k)/D. */
export function dotScaled(v: IVec, k: RVec, D: number): Rat {
  let n = 0;
  let d = 1;
  for (let i = 0; i < 3; i++) {
    const x = k[i]!;
    // n/d + v_i·x.n/x.d
    const nn = n * x.d + v[i]! * x.n * d;
    d *= x.d;
    n = nn;
    const g = gcd(n, d) || 1;
    n /= g;
    d /= g;
  }
  return rat(n, d * D);
}

/** True when k·t ∈ ℤ for every t of the lattice (k in the lattice's dual). */
export const inDual = (h: Hnf, k: RVec, D: number): boolean => [0, 1, 2].every((i) => dotScaled(h[i]!, k, D).d === 1);

/** True when the lattice contains ℤ³ (the conventional cell's translations): the cell is kept. */
export const containsConventional = (h: Hnf, D: number): boolean => [0, 1, 2].every((i) => inLattice(h, [i === 0 ? D : 0, i === 1 ? D : 0, i === 2 ? D : 0]));

export { mod as imod };
