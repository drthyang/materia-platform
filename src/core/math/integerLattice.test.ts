import { describe, expect, it } from "vitest";
import { adjugate3i, det3i, diagonalize, integerKernel, latticeBasis, solveCongruence } from "@/core/math/integerLattice";

const mul = (A: number[][], B: number[][]): number[][] => A.map((row) => B[0]!.map((_, j) => row.reduce((s, v, k) => s + v * B[k]![j]!, 0)));

describe("integer lattices", () => {
  it("diagonalizes by unimodular row and column operations: U·A·V = D", () => {
    const A = [[2, 4, 4], [-6, 6, 12], [10, -4, -16], [1, 0, 3]];
    const { D, U, V, rank } = diagonalize(A);
    expect(mul(mul(U, A), V)).toEqual(D);
    expect(rank).toBe(3);
    for (let i = 0; i < D.length; i++) for (let j = 0; j < D[0]!.length; j++) if (i !== j) expect(D[i]![j]).toBe(0);
    expect(Math.abs(det3i(V))).toBe(1);
  });

  it("solves a congruence: a 2-fold's origin shift, and none where it has no solution", () => {
    // (R − I)·p ≡ b mod ℤ³ for R a 2-fold along b: −2x ≡ ½, −2z ≡ 0.
    const RI = [[-2, 0, 0], [0, 0, 0], [0, 0, -2]];
    const p = solveCongruence(RI, [0.5, 0, 0])!;
    const r = RI.map((row) => row.reduce((s, v, j) => s + v * p[j]!, 0) - [0.5, 0, 0][RI.indexOf(row)]!);
    for (const x of r) expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-9);
    // 0·y ≡ ½ has no solution.
    expect(solveCongruence(RI, [0, 0.5, 0])).toBeNull();
  });

  it("finds the integer kernel and a lattice's basis", () => {
    // The plane normal to the c 4-fold: vectors the 2-fold along c reverses.
    const K = integerKernel([[1 + -1, 0, 0], [0, 1 + -1, 0], [0, 0, 2]]);
    expect(K.map((row) => row.length)).toEqual([2, 2, 2]);
    expect(K.every((row) => row.length === 2) && K[2]!.every((v) => v === 0)).toBe(true);
    // The F lattice on the 1/2 grid: ℤ³ + the three centrings has a primitive cell of volume ¼.
    const B = latticeBasis([[2, 0, 0], [0, 2, 0], [0, 0, 2], [0, 1, 1], [1, 0, 1], [1, 1, 0]]);
    expect(Math.abs(det3i(B))).toBe(2); // in 1/2 units: (1/2)³·2 = ¼
    expect(mul(B, adjugate3i(B)).map((row, i) => row[i])).toEqual([det3i(B), det3i(B), det3i(B)]);
  });
});
