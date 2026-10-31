/**
 * Subspaces of a physically irreducible representation's carrier space ℝⁿ,
 * held as orthonormal bases (row vectors): the fixed space of one matrix,
 * intersections, and a projector key that identifies a subspace whatever its
 * basis. Shared by the image method (isotropy.ts) and the choice of basis
 * (directionBasis.ts).
 */

import { symmetricEigenDecomposition } from "@/core/math/linalg";

export type Vec = number[];

/** An orthonormal basis of the null space of a symmetric positive semidefinite matrix. */
export function nullSpace(M: number[][]): Vec[] {
  const n = M.length;
  const { values, vectors } = symmetricEigenDecomposition(M);
  const out: Vec[] = [];
  for (let k = 0; k < n; k++) if (Math.abs(values[k]!) < 1e-9 * n) out.push(vectors.map((row) => row[k]!));
  return out;
}

export const projector = (basis: readonly Vec[], n: number): number[][] =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => basis.reduce((s, b) => s + b[i]! * b[j]!, 0)));

/** The subspace's projector, rounded: equal for every basis of the same subspace. */
export const projectorKey = (basis: readonly Vec[], n: number): string =>
  `${basis.length}:${projector(basis, n).flat().map((x) => Math.round(x * 1e6) / 1e6 || 0).join(",")}`;

/** The fixed space of a real matrix: the null space of (D − I)ᵀ(D − I). */
export function fixedSpace(D: Float64Array, n: number): Vec[] {
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => D[i * n + j]! - (i === j ? 1 : 0)));
  const AtA = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => A.reduce((s, row) => s + row[i]! * row[j]!, 0)));
  return nullSpace(AtA);
}

/** The intersection of two subspaces: the null space of (I − P) + (I − Q). */
export function intersect(a: readonly Vec[], b: readonly Vec[], n: number): Vec[] {
  const P = projector(a, n);
  const Q = projector(b, n);
  return nullSpace(P.map((row, i) => row.map((x, j) => (i === j ? 2 : 0) - x - Q[i]![j]!)));
}

/** True when a coefficient reads as a small fraction in a direction symbol (n/d, d ∈ {1, 2, 3, 4, 6}). */
export const isSimpleFraction = (x: number): boolean => [1, 2, 3, 4, 6].some((d) => Math.abs(x * d - Math.round(x * d)) < 1e-7);
