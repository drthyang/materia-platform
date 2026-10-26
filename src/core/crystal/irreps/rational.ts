/**
 * The exact kernel of the irrep engine: rationals for translations, k-vectors,
 * cosets and the factor system, and space-group operations as exact Seitz
 * pairs {W|w} with an integer W and a rational w.
 *
 * Everything the group theory decides — which operations leave k unchanged,
 * which coset an element lies in, the phase exp(2πi k·v) a translation
 * carries — is decided here exactly. Floating point enters only in the
 * representation matrices (complexMatrix.ts), which are checked against these
 * exact quantities.
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { SymmetryOperation } from "@/core/crystal/types";

/** A rational n/d in lowest terms with d > 0. */
export interface Rat {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

export function rat(n: number, d = 1): Rat {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) throw new Error(`rat: not a rational ${n}/${d}`);
  const g = gcd(n, d) || 1;
  const s = d < 0 ? -1 : 1;
  return { n: (s * n) / g || 0, d: (s * d) / g };
}

export const ZERO: Rat = { n: 0, d: 1 };
export const ONE: Rat = { n: 1, d: 1 };

export const radd = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const rsub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const rmul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
export const rmulInt = (a: Rat, k: number): Rat => rat(a.n * k, a.d);
export const rneg = (a: Rat): Rat => ({ n: -a.n || 0, d: a.d });
export const req = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;
export const risInt = (a: Rat): boolean => a.d === 1;
export const rnum = (a: Rat): number => a.n / a.d;
/** The fractional part in [0, 1). */
export const rmod1 = (a: Rat): Rat => rat(((a.n % a.d) + a.d) % a.d, a.d);
export const rcmp = (a: Rat, b: Rat): number => a.n * b.d - b.n * a.d;

/**
 * The rational nearest a float, with a denominator up to `maxDen`; throws when
 * none is within 1e-6 (a coordinate or k component that is not crystallographic).
 */
export function ratFrom(x: number, maxDen = 48): Rat {
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(x * d);
    if (Math.abs(x * d - n) < 1e-6 * d) return rat(n, d);
  }
  throw new Error(`ratFrom: ${x} is not a rational with a denominator up to ${maxDen}`);
}

export type RVec = readonly [Rat, Rat, Rat];
/** An integer 3×3 matrix, row-major. */
export type IMat = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

export const RZERO: RVec = [ZERO, ZERO, ZERO];
export const IDENTITY_I: IMat = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export const vadd = (a: RVec, b: RVec): RVec => [radd(a[0], b[0]), radd(a[1], b[1]), radd(a[2], b[2])];
export const vsub = (a: RVec, b: RVec): RVec => [rsub(a[0], b[0]), rsub(a[1], b[1]), rsub(a[2], b[2])];
export const vneg = (a: RVec): RVec => [rneg(a[0]), rneg(a[1]), rneg(a[2])];
export const vmod1 = (a: RVec): RVec => [rmod1(a[0]), rmod1(a[1]), rmod1(a[2])];
export const veq = (a: RVec, b: RVec): boolean => req(a[0], b[0]) && req(a[1], b[1]) && req(a[2], b[2]);
export const visInt = (a: RVec): boolean => risInt(a[0]) && risInt(a[1]) && risInt(a[2]);
export const vnum = (a: RVec): Vec3 => [rnum(a[0]), rnum(a[1]), rnum(a[2])];
export const vfrom = (v: Vec3, maxDen = 48): RVec => [ratFrom(v[0], maxDen), ratFrom(v[1], maxDen), ratFrom(v[2], maxDen)];
export const vkey = (a: RVec): string => a.map((r) => `${r.n}/${r.d}`).join(",");
/** k·v = Σ k_i v_i (k in the reciprocal basis, v fractional). */
export const vdot = (a: RVec, b: RVec): Rat => radd(radd(rmul(a[0], b[0]), rmul(a[1], b[1])), rmul(a[2], b[2]));

/** W·v for an integer matrix and a rational column. */
export function imulVec(W: IMat, v: RVec): RVec {
  const row = (i: 0 | 1 | 2): Rat => radd(radd(rmulInt(v[0], W[i][0]), rmulInt(v[1], W[i][1])), rmulInt(v[2], W[i][2]));
  return [row(0), row(1), row(2)];
}

/** Wᵀ·k: how a reciprocal vector picks up an operation's rotation. */
export function itransMulVec(W: IMat, k: RVec): RVec {
  const col = (j: 0 | 1 | 2): Rat => radd(radd(rmulInt(k[0], W[0][j]), rmulInt(k[1], W[1][j])), rmulInt(k[2], W[2][j]));
  return [col(0), col(1), col(2)];
}

export function imul(A: IMat, B: IMat): IMat {
  const r = (i: 0 | 1 | 2, j: 0 | 1 | 2): number => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return [[r(0, 0), r(0, 1), r(0, 2)], [r(1, 0), r(1, 1), r(1, 2)], [r(2, 0), r(2, 1), r(2, 2)]];
}

export function idet(W: IMat): number {
  return W[0][0] * (W[1][1] * W[2][2] - W[1][2] * W[2][1]) - W[0][1] * (W[1][0] * W[2][2] - W[1][2] * W[2][0]) + W[0][2] * (W[1][0] * W[2][1] - W[1][1] * W[2][0]);
}

/** The inverse of a unimodular integer matrix (det ±1), itself integral. */
export function iinv(W: IMat): IMat {
  const d = idet(W);
  if (d !== 1 && d !== -1) throw new Error(`iinv: not unimodular (det ${d})`);
  const cof = (i: number, j: number): number => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const s = [0, 1, 2].filter((x) => x !== j);
    const m = (a: number, b: number): number => W[r[a]!]![s[b]!]!;
    return ((i + j) % 2 === 0 ? 1 : -1) * (m(0, 0) * m(1, 1) - m(0, 1) * m(1, 0));
  };
  // W⁻¹ = adj(W)/det, adj[i][j] = cofactor(j, i); 1/det = det for det = ±1.
  const row = (i: number): [number, number, number] => [cof(0, i) * d, cof(1, i) * d, cof(2, i) * d];
  return [row(0), row(1), row(2)];
}

export const itranspose = (W: IMat): IMat => [[W[0][0], W[1][0], W[2][0]], [W[0][1], W[1][1], W[2][1]], [W[0][2], W[1][2], W[2][2]]];
export const ieq = (A: IMat, B: IMat): boolean => A.every((row, i) => row.every((x, j) => x === B[i]![j]));
export const ikey = (W: IMat): string => W.map((r) => r.join(",")).join(";");
export const iIsIdentity = (W: IMat): boolean => ieq(W, IDENTITY_I);
export const iIsMinusIdentity = (W: IMat): boolean => W.every((row, i) => row.every((x, j) => x === (i === j ? -1 : 0)));

/** A space-group operation {W|w}: x ↦ Wx + w, exact. */
export interface ExactOp {
  readonly W: IMat;
  readonly w: RVec;
}

/** {W₁|w₁}{W₂|w₂} = {W₁W₂ | w₁ + W₁w₂}. */
export const compose = (a: ExactOp, b: ExactOp): ExactOp => ({ W: imul(a.W, b.W), w: vadd(a.w, imulVec(a.W, b.w)) });

/** {W|w}⁻¹ = {W⁻¹ | −W⁻¹w}. */
export function invert(a: ExactOp): ExactOp {
  const Wi = iinv(a.W);
  return { W: Wi, w: vneg(imulVec(Wi, a.w)) };
}

/** An operation of the model, exactly: an integer rotation and a rational translation. */
export function exactOp(op: SymmetryOperation): ExactOp {
  const W = op.rotation.map((row) => row.map((x) => {
    const n = Math.round(x);
    if (Math.abs(x - n) > 1e-6) throw new Error(`exactOp: non-integral rotation in ${op.xyz}`);
    return n;
  })) as unknown as IMat;
  return { W, w: vfrom(op.translation, 48) };
}

/** The operation as the model's floating-point type (translations as given, not wrapped). */
export function toSymmetryOperation(op: ExactOp, xyz: string): SymmetryOperation {
  return { rotation: op.W.map((r) => [...r]) as unknown as Mat3, translation: vnum(op.w), xyz };
}

/** exp(2πi q) for a rational q, the real and imaginary parts snapped where they are exactly 0, ±½ or ±1. */
export function phase(q: Rat): { re: number; im: number } {
  const f = rmod1(q);
  const angle = (2 * Math.PI * f.n) / f.d;
  const snap = (x: number): number => {
    for (const v of [0, 0.5, -0.5, 1, -1]) if (Math.abs(x - v) < 1e-14) return v;
    return x;
  };
  return { re: snap(Math.cos(angle)), im: snap(Math.sin(angle)) };
}
