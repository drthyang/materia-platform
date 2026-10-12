/**
 * Dense linear algebra for the refinement normal equations.
 *
 * Gaussian elimination with partial pivoting for the general systems, and a
 * full symmetric eigen-decomposition (Householder and QL) for the normal
 * matrices, which in a single-crystal refinement reach a few hundred
 * parameters. Matrices are `number[][]` (row-major) and vectors `number[]`.
 */

export type Matrix = number[][];

export interface SymmetricPseudoInverseResult {
  readonly inverse: Matrix;
  readonly singularValues: readonly number[];
  readonly zeroCount: number;
  /** Indices with the largest participation in discarded singular directions. */
  readonly droppedIndices: readonly number[];
  /** The discarded directions themselves: orthonormal eigenvectors of `a`. */
  readonly droppedVectors: readonly (readonly number[])[];
  readonly conditionNumber: number;
}

/** Solve A·x = b for x via Gaussian elimination with partial pivoting. */
export function solveLinearSystem(a: Matrix, b: number[]): number[] {
  const n = b.length;
  // Work on augmented copies so inputs are not mutated.
  const m: Matrix = a.map((row, i) => [...row, b[i] as number]);

  for (let col = 0; col < n; col++) {
    // Partial pivot: find the largest magnitude entry in this column.
    let pivotRow = col;
    let pivotVal = Math.abs(m[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r]![col]!);
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = r;
      }
    }
    if (pivotVal < 1e-14) {
      throw new Error("Singular matrix in solveLinearSystem");
    }
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
    }

    const pivot = m[col]![col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        m[r]![c]! -= factor * m[col]![c]!;
      }
    }
  }

  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    x[i] = m[i]![n]! / m[i]![i]!;
  }
  return x;
}

/** Invert a square matrix via Gauss-Jordan elimination. Used for covariance. */
export function invertMatrix(a: Matrix): Matrix {
  const n = a.length;
  const m: Matrix = a.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotVal = Math.abs(m[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r]![col]!);
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = r;
      }
    }
    if (pivotVal < 1e-14) {
      throw new Error("Singular matrix in invertMatrix");
    }
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
    }

    const pivot = m[col]![col]!;
    for (let c = 0; c < 2 * n; c++) {
      m[col]![c]! /= pivot;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]!;
      if (factor === 0) continue;
      for (let c = 0; c < 2 * n; c++) {
        m[r]![c]! -= factor * m[col]![c]!;
      }
    }
  }

  return m.map((row) => row.slice(n));
}

/**
 * Householder reduction of the symmetric matrix in V to tridiagonal form (d the
 * diagonal, e the subdiagonal), V left holding the orthogonal transformation:
 * EISPACK's tred2 (Bowdler, Martin, Reinsch & Wilkinson, Handbook for Automatic
 * Computation II), as JAMA has it.
 */
function householderTridiagonal(V: Float64Array[], d: Float64Array, e: Float64Array): void {
  const n = V.length;
  for (let j = 0; j < n; j++) d[j] = V[n - 1]![j]!;
  for (let i = n - 1; i > 0; i--) {
    let scale = 0;
    let h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]!);
    if (scale === 0) {
      e[i] = d[i - 1]!;
      for (let j = 0; j < i; j++) {
        d[j] = V[i - 1]![j]!;
        V[i]![j] = 0;
        V[j]![i] = 0;
      }
    } else {
      // The Householder vector, scaled against under- and overflow.
      for (let k = 0; k < i; k++) {
        d[k]! /= scale;
        h += d[k]! * d[k]!;
      }
      let f = d[i - 1]!;
      let g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      // The similarity transformation of the remaining columns.
      for (let j = 0; j < i; j++) {
        f = d[j]!;
        V[j]![i] = f;
        g = e[j]! + V[j]![j]! * f;
        for (let k = j + 1; k <= i - 1; k++) {
          g += V[k]![j]! * d[k]!;
          e[k]! += V[k]![j]! * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) {
        e[j]! /= h;
        f += e[j]! * d[j]!;
      }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j]! -= hh * d[j]!;
      for (let j = 0; j < i; j++) {
        f = d[j]!;
        g = e[j]!;
        for (let k = j; k <= i - 1; k++) V[k]![j]! -= f * e[k]! + g * d[k]!;
        d[j] = V[i - 1]![j]!;
        V[i]![j] = 0;
      }
    }
    d[i] = h;
  }
  // Accumulate the transformations.
  for (let i = 0; i < n - 1; i++) {
    V[n - 1]![i] = V[i]![i]!;
    V[i]![i] = 1;
    const h = d[i + 1]!;
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[k]![i + 1]! / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[k]![i + 1]! * V[k]![j]!;
        for (let k = 0; k <= i; k++) V[k]![j]! -= g * d[k]!;
      }
    }
    for (let k = 0; k <= i; k++) V[k]![i + 1] = 0;
  }
  for (let j = 0; j < n; j++) {
    d[j] = V[n - 1]![j]!;
    V[n - 1]![j] = 0;
  }
  V[n - 1]![n - 1] = 1;
  e[0] = 0;
}

/**
 * The implicit QL algorithm on the tridiagonal (d, e) from
 * householderTridiagonal: d ends as the eigenvalues and V's columns as the
 * eigenvectors. EISPACK's tql2, as JAMA has it.
 */
function tridiagonalQL(V: Float64Array[], d: Float64Array, e: Float64Array): void {
  const n = V.length;
  for (let i = 1; i < n; i++) e[i - 1] = e[i]!;
  e[n - 1] = 0;
  let f = 0;
  let tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    // The first negligible subdiagonal element at or after l.
    tst1 = Math.max(tst1, Math.abs(d[l]!) + Math.abs(e[l]!));
    let m = l;
    while (m < n - 1 && Math.abs(e[m]!) > eps * tst1) m++;
    if (m > l) {
      for (let iter = 0; iter < 100; iter++) {
        // The implicit shift.
        let g = d[l]!;
        let p = (d[l + 1]! - g) / (2 * e[l]!);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l]! / (p + r);
        d[l + 1] = e[l]! * (p + r);
        const dl1 = d[l + 1]!;
        let h = g - d[l]!;
        for (let i = l + 2; i < n; i++) d[i]! -= h;
        f += h;
        // The implicit QL transformation, accumulated in V.
        p = d[m]!;
        let c = 1;
        let c2 = 1;
        let c3 = 1;
        const el1 = e[l + 1]!;
        let s = 0;
        let s2 = 0;
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i]!;
          h = c * p;
          r = Math.hypot(p, e[i]!);
          e[i + 1] = s * r;
          s = e[i]! / r;
          c = p / r;
          p = c * d[i]! - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]!);
          for (let k = 0; k < n; k++) {
            const row = V[k]!;
            h = row[i + 1]!;
            row[i + 1] = s * row[i]! + c * h;
            row[i] = c * row[i]! - s * h;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]!) / dl1;
        e[l] = s * p;
        d[l] = c * p;
        if (!(Math.abs(e[l]!) > eps * tst1)) break;
      }
    }
    d[l]! += f;
    e[l] = 0;
  }
}

/**
 * Eigen-decompose a real symmetric matrix: Householder reduction to
 * tridiagonal form, then the implicit QL algorithm (EISPACK's tred2 and tql2).
 * Every eigenvalue and vector to rounding, in O(n³): a normal matrix of a few
 * hundred parameters (a single-crystal refinement's) takes tens of
 * milliseconds. The values come largest |λ| first; `vectors[i][k]` is the
 * i-th component of the k-th eigenvector.
 */
export function symmetricEigenDecomposition(a: Matrix): { values: number[]; vectors: Matrix } {
  const n = a.length;
  if (n === 0) return { values: [], vectors: [] };
  const V = Array.from({ length: n }, (_, i) =>
    Float64Array.from({ length: n }, (__, j) => {
      const aij = a[i]?.[j] ?? 0;
      const aji = a[j]?.[i] ?? aij;
      return 0.5 * (aij + aji);
    }),
  );
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  householderTridiagonal(V, d, e);
  tridiagonalQL(V, d, e);
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => Math.abs(d[j]!) - Math.abs(d[i]!));
  return {
    values: order.map((i) => d[i]!),
    vectors: Array.from({ length: n }, (_, row) => order.map((col) => V[row]![col]!)),
  };
}

/** Which eigen-directions a truncated pseudo-inverse keeps: those above `rcond · max |λ|`. */
function truncation(values: readonly number[], vectors: Matrix, rcond: number): Omit<SymmetricPseudoInverseResult, "inverse"> & { readonly kept: readonly number[] } {
  const n = values.length;
  const singularValues = values.map((x) => Math.abs(x));
  const maxSingular = Math.max(...singularValues, 0);
  const cutoff = rcond * maxSingular;
  const droppedScore = new Array<number>(n).fill(0);
  const droppedVectors: number[][] = [];
  const kept: number[] = [];
  let minKept = Infinity;
  for (let k = 0; k < n; k++) {
    const singular = singularValues[k]!;
    if (singular <= cutoff || !Number.isFinite(singular)) {
      for (let i = 0; i < n; i++) droppedScore[i]! += Math.abs(vectors[i]![k]!);
      droppedVectors.push(vectors.map((row) => row[k]!));
      continue;
    }
    kept.push(k);
    minKept = Math.min(minKept, singular);
  }
  const droppedIndices = droppedScore
    .map((score, index) => ({ score, index }))
    .filter((o) => o.score > 1e-8)
    .sort((a, b) => b.score - a.score)
    .map((o) => o.index);
  return {
    kept,
    singularValues,
    zeroCount: n - kept.length,
    droppedIndices,
    droppedVectors,
    conditionNumber: minKept < Infinity && minKept > 0 ? maxSingular / minKept : Infinity,
  };
}

/**
 * Moore-Penrose pseudo-inverse for a symmetric matrix. Small singular values
 * are truncated using `rcond * max(singularValue)`, which is the same stability
 * principle GSAS-II applies to ill-conditioned Hessian least squares.
 */
export function pseudoInverseSymmetric(a: Matrix, rcond = 1e-6): SymmetricPseudoInverseResult {
  const n = a.length;
  const { values, vectors } = symmetricEigenDecomposition(a);
  const { kept, ...diagnostics } = truncation(values, vectors, rcond);
  const inverse: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const k of kept) {
    const inv = 1 / values[k]!;
    for (let i = 0; i < n; i++) {
      const vik = vectors[i]![k]! * inv;
      if (vik === 0) continue;
      const row = inverse[i]!;
      for (let j = 0; j < n; j++) row[j]! += vik * vectors[j]![k]!;
    }
  }
  return { inverse, ...diagnostics };
}

/**
 * Solve (A + μI)·x = b by the truncated pseudo-inverse, for any shift μ, from
 * one eigen-decomposition of the symmetric A: A + μI has A's eigenvectors and
 * its eigenvalues shifted by μ. A Levenberg–Marquardt step tried at several
 * dampings costs one decomposition. Truncation as pseudoInverseSymmetric's, on
 * the shifted eigenvalues.
 */
export function shiftedPseudoInverseSolver(
  a: Matrix,
  rcond = 1e-6,
): (shift: number, b: readonly number[]) => { x: number[]; diagnostics: Omit<SymmetricPseudoInverseResult, "inverse"> } {
  const n = a.length;
  const { values, vectors } = symmetricEigenDecomposition(a);
  return (shift, b) => {
    const shifted = values.map((v) => v + shift);
    const { kept, ...diagnostics } = truncation(shifted, vectors, rcond);
    const x = new Array<number>(n).fill(0);
    for (const k of kept) {
      let projection = 0;
      for (let i = 0; i < n; i++) projection += vectors[i]![k]! * b[i]!;
      const coefficient = projection / shifted[k]!;
      for (let i = 0; i < n; i++) x[i]! += coefficient * vectors[i]![k]!;
    }
    return { x, diagnostics };
  };
}

/** Solve A·x=b with a symmetric pseudo-inverse. */
export function solveSymmetricPseudoInverse(
  a: Matrix,
  b: readonly number[],
  rcond = 1e-6,
): { x: number[]; diagnostics: SymmetricPseudoInverseResult } {
  const diagnostics = pseudoInverseSymmetric(a, rcond);
  const x = diagnostics.inverse.map((row) => row.reduce((acc, v, i) => acc + v * b[i]!, 0));
  return { x, diagnostics };
}
