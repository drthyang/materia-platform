/**
 * The basis a physically irreducible representation is written in. Any
 * orthonormal basis of its carrier space gives the same representation up to
 * an orthogonal similarity D → QᵀDQ. That keeps the characters, the image
 * group and every isotropy subgroup with its orientation and domain states;
 * only the order-parameter direction symbols change. ISODISTORT-style
 * symbols, (a,0,…), (a,a,…), (a,-a,…), need a basis in which every class of
 * one-parameter directions (the lines its epikernels fix) has a member whose
 * coordinates are small fractions of each other. isotropy.ts reports that
 * member, unless the parent's cell names another conjugate directly. In
 * every irrep of the 230 groups in the conventional cell, such a conjugate
 * reads cleanly too.
 *
 * The real form spaceGroupIrreps.ts builds is usually such a basis. Where it
 * is not, the basis is rebuilt from the directions. That happens for an
 * irrep induced from a two-dimensional small representation whose real form
 * came out rotated by the same angle in every arm, as at Fm-3m's L:
 *
 *  1. The arm blocks. The translations act on each block through one arm's
 *     character, cos 2πk·t; an arm and its −k share a block when both are in
 *     the star. The blocks are the eigenspaces of a fixed generic sum of
 *     (D(t) + D(t)ᵀ)/2 over the translations.
 *  2. Bases of the representative arm's block, built from the one-parameter
 *     directions inside it: each of them in turn first, then those
 *     orthogonal to the ones chosen, nearest an axis of the current basis
 *     first, then the rest of the block.
 *  3. Each carried to every other block by a group element mapping one onto
 *     the other. Three rules pick the element: the first coset
 *     representative (the induction's own), the first element of the factor
 *     group, or the coset representative of lowest rotation order.
 *
 * The current basis and the candidates are scored by the number of classes
 * of one-parameter directions with no small-fraction member. The lowest
 * score wins, the earliest candidate and the current basis on a tie, so a
 * basis changes only to improve. Signed-permutation matrices skip the search:
 * their directions are rational already. The monomial bases of most induced
 * irreps are of this kind. The choice is deterministic: it rests on the
 * factor group's element order and the irrep's matrices, and comparisons
 * that differ by rounding only count as ties.
 *
 * Not every class gets a clean member. In an eight-fold image (I4₁/amd at
 * (0,0,½)) two classes of mirror lines lie 22.5° apart, so one of them keeps
 * √2 − 1 in any orthonormal basis. A direction spread over three arms that a
 * 3-fold permutes (the rhombohedral children at Fm-3m's L) keeps √3/2-type
 * coefficients in every basis this search tries. ISOTROPY's own image tables
 * use such coefficients too.
 */

import { generatorsOf, pointGroupElements, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import type { PhysicalIrrep } from "@/core/crystal/irreps/spaceGroupIrreps";
import { imul, iIsIdentity, rnum, type IMat } from "@/core/crystal/irreps/rational";
import { symmetricEigenDecomposition } from "@/core/math/linalg";
import { fixedSpace, intersect, isSimpleFraction, projector, projectorKey, type Vec } from "@/core/crystal/irreps/subspace";

const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, x, i) => s + x * b[i]!, 0);

function apply(D: Float64Array, v: readonly number[], n: number): Vec {
  return Array.from({ length: n }, (_, i) => {
    let t = 0;
    for (let j = 0; j < n; j++) t += D[i * n + j]! * v[j]!;
    return t;
  });
}

/** The unit vector with its largest component positive (the first of equal ones). */
function canonical(v: readonly number[]): Vec {
  const norm = Math.hypot(...v);
  let k = 0;
  for (let i = 1; i < v.length; i++) if (Math.abs(v[i]!) > Math.abs(v[k]!) + 1e-9) k = i;
  const s = v[k]! < 0 ? -1 : 1;
  return v.map((x) => (s * x) / norm);
}

/** The distinct matrices of the image group. */
function imageOf(pir: PhysicalIrrep): Float64Array[] {
  const out = new Map<string, Float64Array>();
  for (const m of pir.matrices) {
    const key = Array.from(m, (x) => Math.round(x * 1e6) / 1e6 || 0).join(",");
    if (!out.has(key)) out.set(key, m);
  }
  return [...out.values()];
}

/**
 * True when every matrix is a signed permutation (entries 0 and ±1). Then
 * every fixed space, and every intersection of them, is spanned by rational
 * vectors, so every one-parameter direction already reads cleanly and no
 * basis can do better.
 */
const isSignedPermutation = (image: readonly Float64Array[]): boolean =>
  image.every((D) => D.every((x) => Math.abs(x) < 1e-9 || Math.abs(Math.abs(x) - 1) < 1e-9));

/**
 * Every one-parameter direction (a unit vector per line) with its class, the
 * orbit under the image group, by the orbit-wise intersection closure of the
 * single elements' fixed spaces (as in isotropy.ts). An orbit is walked with
 * the generators' matrices, |orbit|·|generators| images rather than |image|.
 */
function oneParameterDirections(image: readonly Float64Array[], generators: readonly Float64Array[], n: number): { lines: Vec[]; classOf: number[] } {
  const singles = new Map<string, Vec[]>();
  for (const D of image) {
    const fix = fixedSpace(D, n);
    if (fix.length > 0 && fix.length < n) singles.set(projectorKey(fix, n), fix);
  }
  const singleList = [...singles.values()];
  const projectors = new Map<readonly Vec[], number[][]>();
  const within = (a: readonly Vec[], b: readonly Vec[]): boolean => {
    let P = projectors.get(b);
    if (!P) {
      P = projector(b, n);
      projectors.set(b, P);
    }
    return a.every((v) => P.every((row, i) => Math.abs(dot(row, v) - v[i]!) < 1e-7));
  };
  const seen = new Set<string>();
  const lines: Vec[] = [];
  const classOf: number[] = [];
  let orbits = 0;
  const addOrbit = (basis: Vec[]): boolean => {
    const key = projectorKey(basis, n);
    if (seen.has(key)) return false;
    const id = orbits++;
    seen.add(key);
    const queue = [basis];
    while (queue.length > 0) {
      const member = queue.pop()!;
      if (member.length === 1) {
        lines.push(canonical(member[0]!));
        classOf.push(id);
      }
      for (const D of generators) {
        const img = member.map((v) => apply(D, v, n));
        const k = projectorKey(img, n);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(img);
      }
    }
    return true;
  };
  let frontier: Vec[][] = [];
  for (const s of singleList) if (addOrbit(s)) frontier.push(s);
  while (frontier.length > 0) {
    const next: Vec[][] = [];
    for (const a of frontier) {
      if (a.length === 1) continue;
      for (const b of singleList) {
        if (within(a, b) || within(b, a)) continue;
        const c = intersect(a, b, n);
        if (c.length > 0 && addOrbit(c)) next.push(c);
      }
    }
    frontier = next;
  }
  return { lines, classOf };
}

/** True when the vector's coordinates are small fractions of its first nonzero one: its symbol reads cleanly. */
function readsCleanly(v: readonly number[]): boolean {
  const k = v.findIndex((x) => Math.abs(x) > 1e-9);
  return k >= 0 && v.every((x) => isSimpleFraction(x / v[k]!));
}

/** The classes of one-parameter directions with no member that reads cleanly in the basis Q (columns; null: the current one). */
function uncleanClasses(lines: readonly Vec[], classOf: readonly number[], Q: readonly Vec[] | null): number {
  const clean = new Set<number>();
  lines.forEach((v, i) => {
    if (readsCleanly(Q ? Q.map((q) => dot(q, v)) : v)) clean.add(classOf[i]!);
  });
  return new Set(classOf).size - clean.size;
}

/** The arm blocks (orthonormal bases), the representative arm's first, then in the star's order; null when they cannot be told apart. */
function armBlocks(group: FactorGroup, pir: PhysicalIrrep): Vec[][] | null {
  const n = pir.dim;
  const weights = group.translations.map((_, i) => 1 + 0.5 * Math.sin(1.7 * (i + 1)) + 0.1 * i);
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  group.translations.forEach((t, i) => {
    const D = pir.matrices[t]!;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) M[a]![b]! += (weights[i]! * (D[a * n + b]! + D[b * n + a]!)) / 2;
  });
  const { values, vectors } = symmetricEigenDecomposition(M);
  const blocks: { value: number; basis: Vec[] }[] = [];
  for (let k = 0; k < n; k++) {
    const v = vectors.map((row) => row[k]!);
    const b = blocks.find((x) => Math.abs(x.value - values[k]!) < 1e-6);
    if (b) b.basis.push(v);
    else blocks.push({ value: values[k]!, basis: [v] });
  }
  if (blocks.some((b) => b.basis.length !== blocks[0]!.basis.length)) return null;
  // Each arm's eigenvalue Σ w cos 2πk·t, in the star's order.
  const valueOf = (k: readonly number[]): number => group.translations.reduce((s, t, i) => {
    const w = group.elements[t]!.w;
    return s + weights[i]! * Math.cos(2 * Math.PI * (k[0]! * rnum(w[0]) + k[1]! * rnum(w[1]) + k[2]! * rnum(w[2])));
  }, 0);
  const ordered: Vec[][] = [];
  const used = new Set<number>();
  for (const k of pir.starArms) {
    const j = blocks.findIndex((b, bi) => !used.has(bi) && Math.abs(b.value - valueOf(k)) < 1e-6);
    if (j < 0) continue;
    used.add(j);
    ordered.push(blocks[j]!.basis);
  }
  return used.size === blocks.length ? ordered : null;
}

const inBlock = (v: readonly number[], block: readonly Vec[]): boolean => Math.abs(block.reduce((s, b) => s + dot(b, v) ** 2, 0) - 1) < 1e-7;

/**
 * Bases of the block built from the one-parameter directions inside it, one
 * for each of them as the first: then the others orthogonal to the chosen
 * ones, nearest an axis of the current basis first, then the rest of the
 * block. Empty when the block holds none.
 */
function blockBases(block: readonly Vec[], lines: readonly Vec[]): Vec[][] {
  const nearAxis = (v: Vec): number => Math.max(...v.map((x) => Math.abs(x)));
  const lexDesc = (a: Vec, b: Vec): number => {
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 1e-9) return b[i]! - a[i]!;
    return 0;
  };
  // Equal up to rounding counts as equal, so the order never rests on floating-point noise.
  const order = lines.filter((v) => inBlock(v, block)).sort((a, b) => {
    const d = nearAxis(b) - nearAxis(a);
    return Math.abs(d) > 1e-9 ? d : lexDesc(a, b);
  });
  const out: Vec[][] = [];
  for (const seed of order) {
    const basis: Vec[] = [seed];
    for (const v of order) if (basis.every((b) => Math.abs(dot(b, v)) < 1e-7)) basis.push(v);
    for (const v of [...order, ...block]) {
      if (basis.length === block.length) break;
      let w = [...v];
      for (const b of basis) {
        const s = dot(w, b);
        w = w.map((x, i) => x - s * b[i]!);
      }
      if (Math.hypot(...w) > 1e-6) basis.push(canonical(w));
    }
    if (basis.length === block.length) out.push(basis);
  }
  return out;
}

/** The order of a rotation: the least m with W^m = I. */
function rotationOrder(W: IMat): number {
  let M = W;
  for (let m = 1; m <= 6; m++) {
    if (iIsIdentity(M)) return m;
    M = imul(M, W);
  }
  return 7;
}

/** The three rules' element orders for carrying the first block to the others. */
function transportOrders(group: FactorGroup): number[][] {
  const reps = pointGroupElements(group);
  const lowest = reps.map((f, i) => ({ f, i, m: rotationOrder(group.elements[f]!.W) })).sort((a, b) => a.m - b.m || a.i - b.i).map((x) => x.f);
  return [reps, group.elements.map((_, i) => i), lowest];
}

/** The first block's basis carried to the others along one rule; null when some block is not reached. */
function carried(pir: PhysicalIrrep, blocks: readonly Vec[][], first: readonly Vec[], order: readonly number[]): Vec[] | null {
  const n = pir.dim;
  const out: Vec[] = [...first];
  for (const block of blocks.slice(1)) {
    let images: Vec[] | null = null;
    for (const f of order) {
      const img = first.map((v) => apply(pir.matrices[f]!, v, n));
      if (img.every((v) => inBlock(v, block))) {
        images = img;
        break;
      }
    }
    if (!images) return null;
    out.push(...images);
  }
  return out;
}

const isOrthonormal = (Q: readonly Vec[]): boolean => Q.every((a, i) => Q.every((b, j) => Math.abs(dot(a, b) - (i === j ? 1 : 0)) < 1e-8));

/** QᵀDQ for each matrix, Q's columns the new basis vectors. */
function rebased(pir: PhysicalIrrep, Q: readonly Vec[]): PhysicalIrrep {
  const n = pir.dim;
  const matrices = pir.matrices.map((D) => {
    const DQ = Q.map((q) => apply(D, q, n));
    const out = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = dot(Q[i]!, DQ[j]!);
        out[i * n + j] = Math.abs(x) < 1e-12 ? 0 : x;
      }
    }
    return out;
  });
  return { ...pir, matrices };
}

/**
 * The irrep in a basis where every class of one-parameter directions it can
 * has a member with small-fraction coordinates (see the module comment); the
 * irrep itself when its basis already is one or no candidate improves it.
 */
export function alignedToDirections(group: FactorGroup, pir: PhysicalIrrep): PhysicalIrrep {
  const n = pir.dim;
  if (n < 2) return pir;
  const image = imageOf(pir);
  if (isSignedPermutation(image)) return pir;
  const { lines, classOf } = oneParameterDirections(image, generatorsOf(group).map((g) => pir.matrices[g]!), n);
  const current = uncleanClasses(lines, classOf, null);
  if (current === 0) return pir;
  const blocks = armBlocks(group, pir);
  if (!blocks) return pir;
  let best: { Q: Vec[]; score: number } | null = null;
  for (const first of blockBases(blocks[0]!, lines)) {
    for (const order of transportOrders(group)) {
      const Q = carried(pir, blocks, first, order);
      if (!Q || Q.length !== n || !isOrthonormal(Q)) continue;
      const score = uncleanClasses(lines, classOf, Q);
      if (!best || score < best.score) best = { Q, score };
    }
  }
  return best && best.score < current ? rebased(pir, best.Q) : pir;
}
