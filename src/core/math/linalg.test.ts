import { describe, it, expect } from "vitest";
import {
  solveLinearSystem,
  invertMatrix,
  pseudoInverseSymmetric,
  solveSymmetricPseudoInverse,
  symmetricEigenDecomposition,
  shiftedPseudoInverseSolver,
  type Matrix,
} from "@/core/math/linalg";

/** A seeded uniform generator in [0, 1). */
function uniform(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** XᵀX of a random n-column design whose columns come in nearly collinear pairs (|r| ≈ 0.999), as a split site's positions do. */
function correlatedNormalMatrix(n: number, rows: number, seed: number): Matrix {
  const rnd = uniform(seed);
  const x = Array.from({ length: rows }, () => {
    const row = Array.from({ length: n }, () => rnd() - 0.5);
    for (let j = 0; j + 1 < n; j += 2) row[j + 1] = -row[j]! + 0.03 * (rnd() - 0.5);
    return row;
  });
  return Array.from({ length: n }, (_, a) => Array.from({ length: n }, (__, b) => x.reduce((t, row) => t + row[a]! * row[b]!, 0)));
}

describe("linalg", () => {
  it("solves a linear system", () => {
    // 2x + y = 5 ; x + 3y = 10  → x = 1, y = 3
    const x = solveLinearSystem([[2, 1], [1, 3]], [5, 10]);
    expect(x[0]).toBeCloseTo(1, 10);
    expect(x[1]).toBeCloseTo(3, 10);
  });

  it("inverts a matrix (A·A⁻¹ = I)", () => {
    const a = [[4, 3], [6, 3]];
    const inv = invertMatrix(a);
    // Product should be identity.
    const p00 = a[0]![0]! * inv[0]![0]! + a[0]![1]! * inv[1]![0]!;
    const p01 = a[0]![0]! * inv[0]![1]! + a[0]![1]! * inv[1]![1]!;
    expect(p00).toBeCloseTo(1, 10);
    expect(p01).toBeCloseTo(0, 10);
  });

  it("throws on a singular matrix", () => {
    expect(() => solveLinearSystem([[1, 2], [2, 4]], [1, 2])).toThrow();
  });

  it("pseudo-inverts a singular symmetric matrix with diagnostics", () => {
    const result = pseudoInverseSymmetric([[1, 2], [2, 4]], 1e-8);

    expect(result.zeroCount).toBe(1);
    expect(result.droppedIndices).toEqual(expect.arrayContaining([0, 1]));
    expect(result.singularValues[0]).toBeCloseTo(5, 10);
    expect(result.singularValues[1]).toBeCloseTo(0, 10);

    // A·A⁺·A = A for the Moore-Penrose pseudo-inverse.
    const inv = result.inverse;
    const a00 = 1 * inv[0]![0]! + 2 * inv[1]![0]!;
    const a01 = 1 * inv[0]![1]! + 2 * inv[1]![1]!;
    const p00 = a00 * 1 + a01 * 2;
    const p01 = a00 * 2 + a01 * 4;
    expect(p00).toBeCloseTo(1, 10);
    expect(p01).toBeCloseTo(2, 10);
  });

  it("solves singular systems with the least-norm pseudo-inverse solution", () => {
    const { x, diagnostics } = solveSymmetricPseudoInverse([[1, 2], [2, 4]], [1, 2], 1e-8);

    expect(diagnostics.zeroCount).toBe(1);
    expect(x[0]).toBeCloseTo(0.2, 10);
    expect(x[1]).toBeCloseTo(0.4, 10);
  });

  it("decomposes a large symmetric matrix completely: A·v = λ·v, the vectors orthonormal", () => {
    const n = 120;
    const rnd = uniform(3);
    const a: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { const v = rnd() - 0.5 + (i === j ? i * 0.3 : 0); a[i]![j] = v; a[j]![i] = v; }
    const { values, vectors } = symmetricEigenDecomposition(a);
    const norm = Math.max(...values.map(Math.abs));
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const av = a[i]!.reduce((t, aij, j) => t + aij * vectors[j]![k]!, 0);
        expect(Math.abs(av - values[k]! * vectors[i]![k]!)).toBeLessThan(1e-10 * norm);
      }
      for (let l = 0; l <= k; l++) {
        const dot = vectors.reduce((t, row) => t + row[k]! * row[l]!, 0);
        expect(Math.abs(dot - (k === l ? 1 : 0))).toBeLessThan(1e-10);
      }
    }
    // Largest |λ| first.
    for (let k = 1; k < n; k++) expect(Math.abs(values[k]!)).toBeLessThanOrEqual(Math.abs(values[k - 1]!));
  });

  it("inverts a normal matrix of nearly collinear pairs exactly, as the esds need", () => {
    // A Jacobi search capped at 80 rotations left such a matrix far from diagonal: its
    // "inverse" was nearly 1/diagonal, the conditional variances, 5× too small an esd.
    const a = correlatedNormalMatrix(140, 400, 5);
    const exact = invertMatrix(a);
    const { inverse, zeroCount } = pseudoInverseSymmetric(a, 1e-12);
    expect(zeroCount).toBe(0);
    for (let j = 0; j < a.length; j++) {
      expect(Math.abs(inverse[j]![j]! / exact[j]![j]! - 1)).toBeLessThan(1e-8);
      // The pair's variance is far above the conditional one, 1/A_jj.
      if (j === 0) expect(exact[0]![0]! * a[0]![0]!).toBeGreaterThan(100);
    }
  });

  it("solves (A + μI)·x = b for any shift from one decomposition", () => {
    const a = correlatedNormalMatrix(30, 90, 9);
    const b = Array.from({ length: 30 }, (_, i) => Math.sin(i));
    const solve = shiftedPseudoInverseSolver(a, 1e-14);
    for (const mu of [0, 1e-3, 0.5]) {
      const shifted = a.map((row, i) => row.map((v, j) => (i === j ? v + mu : v)));
      const exact = solveLinearSystem(shifted, b);
      const { x, diagnostics } = solve(mu, b);
      expect(diagnostics.zeroCount).toBe(0);
      x.forEach((xi, i) => expect(Math.abs(xi - exact[i]!)).toBeLessThan(1e-7 * Math.max(1, Math.abs(exact[i]!))));
    }
  });
});
