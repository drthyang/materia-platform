/**
 * How much an irrep's displacements must stretch the structure's shortest
 * bonds: the Subgroups list's way of telling a rigid-unit mode (octahedra
 * tilting as rigid units, SrTiO₃'s R and M tilts) from a mode of the same
 * symmetry that deforms them (the Jahn–Teller-like R mode that also gives
 * I4/mcm). Symmetry alone cannot tell the two apart; the first-order change
 * of the bond lengths can (rigid-unit modes: Giddy, Dove, Pawley & Heine,
 * Acta Cryst. A49 (1993) 697; Hammonds, Dove, Giddy, Heine & Winkler, Am.
 * Mineral. 81 (1996) 1057).
 *
 * The bonds are the structure's shortest interatomic distances, those within
 * BOND_TOLERANCE of the shortest (SrTiO₃'s Ti–O, not Sr–O). A displacement u
 * of the atoms of the bound's cell changes bond i–j's length by
 * ê_ij·(u_j − u_i) to first order; K = Σ (ê·Δu)² over the bonds, plus
 * |u|² on every atom no bond holds (a rattler moving alone is not a rigid
 * unit). The stretch of an irrep in a subgroup H is K's least value over the
 * irrep's displacements that H keeps (unit norm), divided by K's mean value
 * per coordinate on the bonded atoms: 0 for a rigid-unit mode, of order 1 for
 * one that moves atoms along their bonds or a rattler alone.
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import { equivalentPositions } from "@/core/crystal/symmetry";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { symmetricEigenDecomposition } from "@/core/math/linalg";
import type { FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { atomAction, coreCell } from "@/core/crystal/irreps/supercellModes";

/** Bonds are the distances within this fraction of the structure's shortest one. */
export const BOND_TOLERANCE = 0.1;
/** Closer than this (Å) two sites are one atom's disorder, not a bond. */
const SAME_ATOM = 0.5;

/**
 * The stretch (see the module comment) of the irrep with these characters
 * (on the factor group's elements) in the subgroup H (its elements); null
 * when the irrep moves no atom H keeps.
 */
export type BondStretch = (characters: readonly number[], H: readonly number[]) => number | null;

interface Frame {
  readonly N: number;
  readonly perm: Int32Array;
  /** Each element's rotation in Cartesian axes, row-major. */
  readonly R: Float64Array;
  /** Directed bonds: from[i] → to[i] along the unit vector e[3i..3i+2]. */
  readonly from: Int32Array;
  readonly to: Int32Array;
  readonly e: Float64Array;
  readonly bonded: Uint8Array;
  /** K's mean value per coordinate on the bonded atoms. */
  readonly ref: number;
  /** The cell's rigid translations (every atom moved alike along x, y or z), unit norm: no distortion, left out. */
  readonly shifts: readonly Float64Array[];
  /** The characters of the displacement representation and of the rigid shifts (tr W), by element. */
  readonly disp: Float64Array;
  readonly shift: Float64Array;
}

const mul3 = (a: Mat3, b: readonly (readonly number[])[]): Mat3 =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!)) as unknown as Mat3;

function inverse3(m: Mat3): Mat3 {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const cart = (M: Mat3, x: Vec3): Vec3 => [
  M[0][0] * x[0] + M[0][1] * x[1] + M[0][2] * x[2],
  M[1][0] * x[0] + M[1][1] * x[1] + M[1][2] * x[2],
  M[2][0] * x[0] + M[2][1] * x[1] + M[2][2] * x[2],
];

function frameOf(parent: StructureModel, group: FactorGroup): Frame {
  const cell = coreCell(parent, group);
  const N = cell.positions.length;
  const perm = atomAction(group, cell);
  const M = orthogonalizationMatrix(parent.cell);
  const Mi = inverse3(M);
  const R = new Float64Array(group.elements.length * 9);
  group.elements.forEach((el, f) => {
    const r = mul3(mul3(M, el.W), Mi);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[f * 9 + i * 3 + j] = r[i]![j]!;
  });
  // Every atom of the conventional cell, by site: every atom of the crystal is one of these plus a lattice vector.
  const conv: { x: Vec3; site: number }[] = [];
  parent.sites.forEach((s, site) => {
    const seen = new Set<string>();
    for (const x of equivalentPositions(parent.spaceGroup.operations, s.position)) {
      const y: Vec3 = [x[0] - Math.floor(x[0] + 1e-7), x[1] - Math.floor(x[1] + 1e-7), x[2] - Math.floor(x[2] + 1e-7)];
      const key = y.map((c) => Math.round(c * 1e4) % 1e4).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      conv.push({ x: y, site });
    }
  });
  // Each atom's neighbours: the conventional cell's atoms brought next to it, over the 27 nearest images.
  const near: { a: number; to: Vec3; site: number; d: number; v: Vec3 }[] = [];
  let dmin = Infinity;
  for (let a = 0; a < N; a++) {
    const p = cell.positions[a]!;
    for (const q of conv) {
      const d0 = [0, 1, 2].map((i) => q.x[i]! - p[i]! - Math.round(q.x[i]! - p[i]!));
      for (let n0 = -1; n0 <= 1; n0++) for (let n1 = -1; n1 <= 1; n1++) for (let n2 = -1; n2 <= 1; n2++) {
        const x: Vec3 = [d0[0]! + n0, d0[1]! + n1, d0[2]! + n2];
        const v = cart(M, x);
        const d = Math.hypot(v[0], v[1], v[2]);
        if (d < SAME_ATOM) continue;
        if (d < dmin) dmin = d;
        near.push({ a, to: [p[0]! + x[0], p[1]! + x[1], p[2]! + x[2]], site: q.site, d, v });
      }
    }
  }
  const cutoff = dmin * (1 + BOND_TOLERANCE);
  const from: number[] = [];
  const to: number[] = [];
  const e: number[] = [];
  const bonded = new Uint8Array(N);
  for (const b of near) {
    if (b.d > cutoff) continue;
    const j = cell.find(b.to, b.site);
    if (j < 0) throw new Error("bondStretch: a neighbour is not an atom of the cell");
    bonded[b.a] = 1;
    bonded[j] = 1;
    // A bond to the atom's own image cannot stretch under a displacement of the cell.
    if (j === b.a) continue;
    from.push(b.a);
    to.push(j);
    e.push(b.v[0] / b.d, b.v[1] / b.d, b.v[2] / b.d);
  }
  const nBonded = bonded.reduce((n, x) => n + x, 0);
  // Each directed bond adds |ê|² = 1 at both its ends to K's trace.
  const ref = nBonded > 0 ? (2 * from.length) / (3 * nBonded) : 1;
  const shifts = [0, 1, 2].map((k) => {
    const v = new Float64Array(3 * N);
    for (let a = 0; a < N; a++) v[3 * a + k] = 1 / Math.sqrt(N);
    return v;
  });
  const F = group.elements.length;
  const disp = new Float64Array(F);
  const shift = new Float64Array(F);
  for (let f = 0; f < F; f++) {
    const tr = R[f * 9]! + R[f * 9 + 4]! + R[f * 9 + 8]!;
    let fixed = 0;
    for (let a = 0; a < N; a++) if (perm[f * N + a] === a) fixed++;
    disp[f] = fixed * tr;
    shift[f] = tr;
  }
  return { N, perm, disp, shift, R, from: Int32Array.from(from), to: Int32Array.from(to), e: Float64Array.from(e), bonded, ref: ref > 0 ? ref : 1, shifts };
}

/** K·u (see the module comment). */
function applyK(fr: Frame, u: Float64Array): Float64Array {
  const out = new Float64Array(u.length);
  for (let i = 0; i < fr.from.length; i++) {
    const a = 3 * fr.from[i]!;
    const b = 3 * fr.to[i]!;
    const ex = fr.e[3 * i]!;
    const ey = fr.e[3 * i + 1]!;
    const ez = fr.e[3 * i + 2]!;
    const s = ex * (u[b]! - u[a]!) + ey * (u[b + 1]! - u[a + 1]!) + ez * (u[b + 2]! - u[a + 2]!);
    out[a]! -= s * ex;
    out[a + 1]! -= s * ey;
    out[a + 2]! -= s * ez;
    out[b]! += s * ex;
    out[b + 1]! += s * ey;
    out[b + 2]! += s * ez;
  }
  for (let a = 0; a < fr.N; a++) {
    if (fr.bonded[a]) continue;
    for (let k = 0; k < 3; k++) out[3 * a + k]! += fr.ref * u[3 * a + k]!;
  }
  return out;
}

const dot = (a: Float64Array, b: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/**
 * Orthonormalise (modified Gram–Schmidt) against `against` (orthonormal,
 * left out of the result) and each other, dropping a vector whose norm
 * falls below `tol` of `scale` (its own norm when 0); at most `limit`.
 */
function orthonormal(vs: Iterable<Float64Array>, o: { readonly against?: readonly Float64Array[]; readonly scale?: number; readonly limit?: number } = {}, tol = 1e-7): Float64Array[] {
  const out: Float64Array[] = [];
  const all: Float64Array[] = [...(o.against ?? [])];
  for (const v0 of vs) {
    if (o.limit !== undefined && out.length >= o.limit) break;
    const v = Float64Array.from(v0);
    const n0 = o.scale ?? Math.sqrt(dot(v, v));
    if (n0 === 0) continue;
    for (const q of all) {
      const c = dot(q, v);
      for (let i = 0; i < v.length; i++) v[i]! -= c * q[i]!;
    }
    const n = Math.sqrt(dot(v, v));
    if (n <= tol * n0) continue;
    for (let i = 0; i < v.length; i++) v[i]! /= n;
    out.push(v);
    all.push(v);
  }
  return out;
}

/** A displacement on a few atoms: their indices and, three to an atom, the vector. */
interface Sparse {
  readonly atoms: Int32Array;
  readonly v: Float64Array;
}

/** The displacements H keeps, orthonormal: for each H-orbit of atoms, its representative's three axes averaged over H. */
function invariants(fr: Frame, H: readonly number[]): Sparse[] {
  const { N, perm, R } = fr;
  const done = new Uint8Array(N);
  const out: Sparse[] = [];
  for (let a = 0; a < N; a++) {
    if (done[a]) continue;
    const orbit: number[] = [];
    const at = new Map<number, number>();
    for (const h of H) {
      const b = perm[h * N + a]!;
      if (!at.has(b)) {
        at.set(b, orbit.length);
        orbit.push(b);
        done[b] = 1;
      }
    }
    const three: Float64Array[] = [0, 1, 2].map(() => new Float64Array(3 * orbit.length));
    for (const h of H) {
      const b = at.get(perm[h * N + a]!)!;
      // R_h e_k at atom b.
      for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) three[k]![3 * b + i]! += R[h * 9 + i * 3 + k]!;
    }
    const atoms = Int32Array.from(orbit);
    // The sums are of order |H| or exactly 0 (an axis the site symmetry kills): a rounding remainder is no direction.
    for (const v of orthonormal(three, { scale: H.length })) out.push({ atoms, v });
  }
  return out;
}

/** A pseudo-random generator (a fixed seed: the same rows give the same numbers). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2147483648 - 1;
  };
}

/** Σ c_i v_i, dense and of unit norm. */
function combine(N: number, vs: readonly Sparse[], c: readonly number[]): Float64Array {
  const out = new Float64Array(3 * N);
  vs.forEach((s, i) => {
    const w = c[i]!;
    for (let j = 0; j < s.atoms.length; j++) for (let k = 0; k < 3; k++) out[3 * s.atoms[j]! + k]! += w * s.v[3 * j + k]!;
  });
  const n = Math.sqrt(dot(out, out));
  if (n > 0) for (let i = 0; i < out.length; i++) out[i]! /= n;
  return out;
}

const dense = (N: number, s: Sparse): Float64Array => combine(N, [s], [1]);

/** ⟨χ_a, χ_b⟩ / ⟨χ_a, χ_a⟩: the copies of the irrep a in the representation of character b. */
function copies(a: readonly number[], b: ArrayLike<number>): number {
  let aa = 0;
  let ab = 0;
  for (let f = 0; f < a.length; f++) {
    aa += a[f]! * a[f]!;
    ab += a[f]! * b[f]!;
  }
  return Math.round(ab / aa);
}

/** H's left cosets fH: each element's coset, and one representative of each. */
interface Cosets {
  readonly of: Int32Array;
  readonly reps: readonly number[];
}

function cosetsOf(group: FactorGroup, H: readonly number[]): Cosets {
  const of = new Int32Array(group.elements.length).fill(-1);
  const reps: number[] = [];
  for (let f = 0; f < of.length; f++) {
    if (of[f] !== -1) continue;
    for (const h of H) of[group.table[f]![h]!] = reps.length;
    reps.push(f);
  }
  return { of, reps };
}

/**
 * Σ_g χ(g) Γ(g) u for u that H keeps: u's component in the irrep's
 * isotypic part, up to a factor. Γ(fh)u = Γ(f)u, so the sum runs over H's
 * cosets, each representative weighted by its coset's Σ χ (`weights`).
 */
function project(fr: Frame, cosets: Cosets, weights: Float64Array, u: Float64Array): Float64Array {
  const { N, perm, R } = fr;
  const out = new Float64Array(3 * N);
  for (let i = 0; i < cosets.reps.length; i++) {
    const c = weights[i]!;
    if (Math.abs(c) < 1e-9) continue;
    const f = cosets.reps[i]!;
    for (let a = 0; a < N; a++) {
      const ux = u[3 * a]!;
      const uy = u[3 * a + 1]!;
      const uz = u[3 * a + 2]!;
      if (ux === 0 && uy === 0 && uz === 0) continue;
      const b = 3 * perm[f * N + a]!;
      const r = f * 9;
      out[b]! += c * (R[r]! * ux + R[r + 1]! * uy + R[r + 2]! * uz);
      out[b + 1]! += c * (R[r + 3]! * ux + R[r + 4]! * uy + R[r + 5]! * uz);
      out[b + 2]! += c * (R[r + 6]! * ux + R[r + 7]! * uy + R[r + 8]! * uz);
    }
  }
  return out;
}

/** The bond stretch of the parent's irreps on the bound's cell (see the module comment); the bonds are found on first use. */
export function bondStretch(parent: StructureModel, group: FactorGroup): BondStretch {
  let frame: Frame | null | undefined;
  // The last subgroup's displacements and cosets: a row asks for its few irreps in turn.
  let last: { key: string; inv: Sparse[]; cosets: Cosets } | null = null;
  // Each irrep's copies on the atoms, rigid shifts left out.
  const moving = new WeakMap<readonly number[], number>();
  return (chi, H) => {
    if (frame === undefined) {
      // A structure whose bonds cannot be laid on the cell has no stretch; the list keeps its order.
      try {
        frame = frameOf(parent, group);
      } catch {
        frame = null;
      }
    }
    if (frame === null) return null;
    const fr = frame;
    const key = H.join(",");
    if (last?.key !== key) last = { key, inv: invariants(fr, H), cosets: cosetsOf(group, H) };
    const { inv, cosets } = last;
    let m = moving.get(chi);
    if (m === undefined) {
      m = copies(chi, fr.disp) - copies(chi, fr.shift);
      moving.set(chi, m);
    }
    // The dimension of what is asked for: the dimension H fixes times the copies.
    const rank = Math.round(H.reduce((t, h) => t + chi[h]!, 0) / H.length) * m;
    if (rank <= 0) return null;
    const weights = new Float64Array(cosets.reps.length);
    for (let g = 0; g < chi.length; g++) weights[cosets.of[g]!]! += chi[g]!;
    // A projected unit vector is of order Σ|χ| when it lies in the irrep's part, of rounding when it does not.
    const scale = chi.reduce((t, c) => t + Math.abs(c), 0);
    // A few random combinations of H's displacements span their part in the irrep (with probability 1); every one of them if not.
    const rand = lcg(0x9e3779b9);
    const few = function* (): Generator<Float64Array> {
      for (let i = 0; i < rank + 2; i++) yield project(fr, cosets, weights, combine(fr.N, inv, inv.map(() => rand())));
    };
    const each = function* (): Generator<Float64Array> {
      for (const u of inv) yield project(fr, cosets, weights, dense(fr.N, u));
    };
    let Q = orthonormal(few(), { against: fr.shifts, scale, limit: rank });
    if (Q.length < rank) Q = orthonormal(each(), { against: fr.shifts, scale, limit: rank });
    if (Q.length === 0) return null;
    const KQ = Q.map((q) => applyK(fr, q));
    const G = Q.map((qi) => KQ.map((kj) => dot(qi, kj)));
    const { values } = symmetricEigenDecomposition(G);
    const least = Math.max(0, Math.min(...values));
    return least / fr.ref;
  };
}
