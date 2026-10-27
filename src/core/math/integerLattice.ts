/**
 * Exact integer linear algebra for crystallographic lattices: a diagonal form
 * of an integer matrix by unimodular row and column operations (Smith's
 * reduction without the divisibility chain, which nothing here needs), and
 * what it gives directly — the solutions of a congruence A·u ≡ b (mod ℤᵐ),
 * the integer kernel of a matrix, and a basis of the lattice a set of integer
 * vectors generates.
 *
 * Every matrix is a plain number[][] of small integers (rows); the entries
 * stay small for the 3×3 rotation and basis matrices this is used on.
 */

export type IntMatrix = number[][];

function identity(n: number): IntMatrix {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

/** Floor division that rounds toward −∞, for Euclid's steps on signed entries. */
const fdiv = (a: number, b: number): number => Math.floor(a / b);

/**
 * U·A·V = D with D diagonal (entries D[i][i], i < rank, nonzero; the rest
 * zero) and U (m×m), V (n×n) unimodular integer matrices.
 */
export function diagonalize(A: readonly (readonly number[])[]): { D: IntMatrix; U: IntMatrix; V: IntMatrix; rank: number } {
  const m = A.length;
  const n = m > 0 ? A[0]!.length : 0;
  const D = A.map((r) => r.map((v) => Math.round(v)));
  const U = identity(m);
  const V = identity(n);
  const swapRows = (M: IntMatrix, i: number, j: number): void => {
    const t = M[i]!;
    M[i] = M[j]!;
    M[j] = t;
  };
  const swapCols = (M: IntMatrix, i: number, j: number): void => {
    for (const row of M) {
      const t = row[i]!;
      row[i] = row[j]!;
      row[j] = t;
    }
  };
  const addRow = (M: IntMatrix, target: number, source: number, q: number): void => {
    for (let c = 0; c < M[0]!.length; c++) M[target]![c]! -= q * M[source]![c]!;
  };
  const addCol = (M: IntMatrix, target: number, source: number, q: number): void => {
    for (const row of M) row[target]! -= q * row[source]!;
  };
  let t = 0;
  for (; t < Math.min(m, n); t++) {
    // The smallest nonzero entry of the remaining block becomes the pivot.
    let best: [number, number] | null = null;
    for (let i = t; i < m; i++) for (let j = t; j < n; j++) {
      const v = Math.abs(D[i]![j]!);
      if (v !== 0 && (best === null || v < Math.abs(D[best[0]]![best[1]]!))) best = [i, j];
    }
    if (best === null) break;
    swapRows(D, t, best[0]);
    swapRows(U, t, best[0]);
    swapCols(D, t, best[1]);
    swapCols(V, t, best[1]);
    for (;;) {
      let clean = true;
      for (let i = t + 1; i < m; i++) {
        if (D[i]![t] === 0) continue;
        const q = fdiv(D[i]![t]!, D[t]![t]!);
        addRow(D, i, t, q);
        addRow(U, i, t, q);
        if (D[i]![t] !== 0) clean = false;
      }
      for (let j = t + 1; j < n; j++) {
        if (D[t]![j] === 0) continue;
        const q = fdiv(D[t]![j]!, D[t]![t]!);
        addCol(D, j, t, q);
        addCol(V, j, t, q);
        if (D[t]![j] !== 0) clean = false;
      }
      if (clean) break;
      // A remainder is smaller than the pivot: bring the smallest to the pivot and repeat.
      let pick: [number, number] = [t, t];
      for (let i = t + 1; i < m; i++) if (D[i]![t] !== 0 && Math.abs(D[i]![t]!) < Math.abs(D[pick[0]]![pick[1]]!)) pick = [i, t];
      for (let j = t + 1; j < n; j++) if (D[t]![j] !== 0 && Math.abs(D[t]![j]!) < Math.abs(D[pick[0]]![pick[1]]!)) pick = [t, j];
      if (pick[0] !== t) {
        swapRows(D, t, pick[0]);
        swapRows(U, t, pick[0]);
      } else if (pick[1] !== t) {
        swapCols(D, t, pick[1]);
        swapCols(V, t, pick[1]);
      }
    }
  }
  return { D, U, V, rank: t };
}

/**
 * A real solution u of A·u ≡ b (mod ℤᵐ) — A an m×n integer matrix, b real —
 * or null when there is none. Free directions (rank < n) are set to 0; of the
 * finitely many solutions mod ℤⁿ-images, the one with the smallest numerators.
 */
export function solveCongruence(A: readonly (readonly number[])[], b: readonly number[], tol = 1e-6): number[] | null {
  const { D, U, V, rank } = diagonalize(A);
  const m = A.length;
  const n = V.length;
  const Ub = U.map((row) => row.reduce((s, v, j) => s + v * b[j]!, 0));
  // Rows beyond the rank: 0 ≡ (U·b)_i, which must be an integer.
  for (let i = rank; i < m; i++) if (Math.abs(Ub[i]! - Math.round(Ub[i]!)) > tol) return null;
  const w = new Array<number>(n).fill(0);
  for (let i = 0; i < rank; i++) w[i] = Ub[i]! / D[i]![i]!;
  return V.map((row) => row.reduce((s, v, j) => s + v * w[j]!, 0));
}

/** A basis (as columns) of the integer kernel lattice {v ∈ ℤⁿ : M·v = 0}. */
export function integerKernel(M: readonly (readonly number[])[]): IntMatrix {
  const { V, rank } = diagonalize(M);
  const n = V.length;
  const cols: number[][] = [];
  for (let j = rank; j < n; j++) cols.push(V.map((row) => row[j]!));
  // As a matrix of columns.
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]!));
}

/** The determinant of a 3×3 integer matrix. */
export function det3i(M: readonly (readonly number[])[]): number {
  return (
    M[0]![0]! * (M[1]![1]! * M[2]![2]! - M[1]![2]! * M[2]![1]!) -
    M[0]![1]! * (M[1]![0]! * M[2]![2]! - M[1]![2]! * M[2]![0]!) +
    M[0]![2]! * (M[1]![0]! * M[2]![1]! - M[1]![1]! * M[2]![0]!)
  );
}

/** The adjugate of a 3×3 integer matrix: M·adj(M) = det(M)·I. */
export function adjugate3i(M: readonly (readonly number[])[]): IntMatrix {
  const c = (r1: number, c1: number, r2: number, c2: number): number => M[r1]![c1]! * M[r2]![c2]! - M[r1]![c2]! * M[r2]![c1]!;
  return [
    [c(1, 1, 2, 2), -c(0, 1, 2, 2), c(0, 1, 1, 2)],
    [-c(1, 0, 2, 2), c(0, 0, 2, 2), -c(0, 0, 1, 2)],
    [c(1, 0, 2, 1), -c(0, 0, 2, 1), c(0, 0, 1, 1)],
  ];
}

/**
 * A basis (3 columns) of the lattice the integer 3-vectors `gens` generate,
 * which must span 3D: with U·G·V = D (G the generators as columns),
 * the lattice is U⁻¹·D·ℤ, so U⁻¹·diag(d₁, d₂, d₃) is a basis.
 */
export function latticeBasis(gens: readonly (readonly number[])[]): IntMatrix {
  const G = [0, 1, 2].map((i) => gens.map((g) => g[i]!));
  const { D, U, rank } = diagonalize(G);
  if (rank < 3) throw new Error("the generators do not span a 3D lattice");
  const detU = det3i(U);
  const Ui = adjugate3i(U).map((row) => row.map((v) => v * detU)); // U unimodular: U⁻¹ = det(U)·adj(U)
  return Ui.map((row) => [0, 1, 2].map((j) => row[j]! * D[j]![j]!));
}
