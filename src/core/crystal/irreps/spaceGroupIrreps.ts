/**
 * The irreps of a space group at a commensurate k, computed — no tables
 * (ADR 0001; docs/research/SUBGROUP_ENGINES.md §2 and §6):
 *
 *  1. the star of k and its little co-group Ḡ_k = {W : W⁻ᵀk ≡ k (mod Λ*)};
 *  2. the small representations Γ({W|v}) = exp(+2πi k·v)·P(W), where P runs
 *     over the projective irreps of Ḡ_k with factor system
 *     μ(W₁, W₂) = exp(2πi (W₁ᵀk − k)·v₂) (v₂ the translation of W₂'s coset
 *     representative), built by chain induction (projective.ts) — exact roots
 *     of unity, nontrivial only for a non-symmorphic group on the zone
 *     boundary;
 *  3. each induced over the star to an irrep of the whole group, block-monomial:
 *     D(g)_{ij} = Γ(h_i⁻¹ g h_j) when h_i⁻¹ g h_j ∈ G_k, else 0 (SCC13 eq. 7);
 *  4. its reality from the Frobenius–Schur sum (1/|F|) Σ χ(f²) ∈ {1, −1, 0}
 *     over the finite group F = G/T_P (factorGroup.ts), and its physically
 *     irreducible real form: a real irrep brought to real matrices by the
 *     square root of its symmetric unitary intertwiner with D* (spgrep's
 *     method), a pseudoreal or complex one realified with its conjugate;
 *  5. that real form rotated, where it reads poorly, into a basis built from
 *     its one-parameter directions, so the direction symbols come out as
 *     ISODISTORT's do, (a,0,…), (a,a,…) (directionBasis.ts). The rotation is
 *     an orthogonal similarity: characters and isotropy subgroups are unchanged.
 *
 * Conventions (ADR 0003, ISODISTORT's): a translation acts as exp(+2πi k·t),
 * k in the conventional reciprocal basis. spgrep and Bilbao use exp(−ik·t),
 * so their irreps at k are the complex conjugates of these; compare
 * characters, never matrices.
 *
 * Labels are generic (ADR 0004): the k-point's name where it is a standard
 * cubic point (Γ, X, L, W; H, N, P; X, M, R), else its vector, then "irrep n
 * of m". CDML labels such as X3⁺ are not computable and are not invented.
 *
 * Every call checks its own output and throws rather than return a wrong
 * irrep: the representation property, unitarity, Σ dim² = |star|·|Ḡ| over the
 * star, the orthonormality of the characters, and their constancy on the
 * conjugacy classes of F.
 */

import type { Complex, Vec3 } from "@/core/math/types";
import { symmetricEigenDecomposition } from "@/core/math/linalg";
import {
  cadjoint, cconj, cidentity, cmaxDiff, cmul, cscale, csetBlock, ctrace, czeros, nroot, type CMat,
} from "@/core/crystal/irreps/complexMatrix";
import { pointGroupChain } from "@/core/crystal/irreps/chain";
import { projectiveIrreps } from "@/core/crystal/irreps/projective";
import {
  equivalentK, generatorsOf, kInBound, pointGroupElements, rotateK, starsInBound, type FactorGroup,
} from "@/core/crystal/irreps/factorGroup";
import {
  compose, idet, ikey, imul, invert, itransMulVec, phase, rnum, vdot, vfrom, vsub, type IMat, type RVec,
} from "@/core/crystal/irreps/rational";
import { alignedToDirections } from "@/core/crystal/irreps/directionBasis";

export type Reality = "real" | "pseudoreal" | "complex";

/** The star of a k-point in the bound. */
export interface KStar {
  /** The representative arm (conventional reciprocal basis). */
  readonly k: Vec3;
  /** Every arm, the representative first. */
  readonly arms: readonly Vec3[];
  /** The standard name of the point (Γ, X, H, …), or null when it has none here. */
  readonly name: string | null;
  /** The name, else the vector: "X", "k = (0, 0, 1)". */
  readonly label: string;
}

/** One irrep of the whole group (complex), at one star. */
export interface SpaceGroupIrrep {
  /** 1-based position among the star's irreps, which are ordered by dimension. */
  readonly index: number;
  readonly dim: number;
  /** The dimension of its small representation (dim = |star| · smallDim). */
  readonly smallDim: number;
  readonly reality: Reality;
  /** Its matrices on the factor group's elements. */
  readonly matrices: readonly CMat[];
  readonly characters: readonly Complex[];
  /** "X irrep 2 of 4". */
  readonly label: string;
}

/** A physically irreducible representation: the real form of an irrep, or of an irrep with its conjugate. */
export interface PhysicalIrrep {
  /** The irreps (1-based indices at the star) it is made of: one, or a complex pair. */
  readonly irreps: readonly number[];
  readonly dim: number;
  readonly reality: Reality;
  /** Real orthogonal matrices on the factor group's elements, row-major dim×dim. */
  readonly matrices: readonly Float64Array[];
  readonly characters: readonly number[];
  /** "X irrep 2 of 4", "X irreps 3⊕4 of 4". */
  readonly label: string;
  /** The arms of its star, the representative first (conventional reciprocal basis). */
  readonly starArms: readonly Vec3[];
}

export interface StarIrreps {
  readonly star: KStar;
  /** |Ḡ_k|. */
  readonly littleCoGroupOrder: number;
  readonly irreps: readonly SpaceGroupIrrep[];
  readonly physical: readonly PhysicalIrrep[];
}

function formatFraction(x: number): string {
  const r = vfrom([x, 0, 0], 12)[0];
  return r.d === 1 ? String(r.n) : `${r.n}/${r.d}`;
}

/** "(0, 0, 1)". */
export const formatK = (k: Vec3): string => `(${k.map(formatFraction).join(", ")})`;

/** The standard cubic points, in conventional reciprocal units, by lattice centring. */
const NAMED_CUBIC: Record<"P" | "F" | "I", readonly [string, Vec3][]> = {
  P: [["Γ", [0, 0, 0]], ["X", [0, 0.5, 0]], ["M", [0.5, 0.5, 0]], ["R", [0.5, 0.5, 0.5]]],
  F: [["Γ", [0, 0, 0]], ["X", [0, 1, 0]], ["L", [0.5, 0.5, 0.5]], ["W", [0.5, 1, 0]]],
  I: [["Γ", [0, 0, 0]], ["H", [0, 0, 1]], ["N", [0.5, 0.5, 0]], ["P", [0.5, 0.5, 0.5]]],
};

function kName(group: FactorGroup, k: RVec, rotations: readonly IMat[]): string | null {
  if (k.every((x) => x.n === 0)) return "Γ";
  // Cubic: eight proper 3-folds (trace 0, det 1).
  const threeFolds = rotations.filter((W) => W[0][0] + W[1][1] + W[2][2] === 0 && idet(W) === 1);
  if (threeFolds.length < 8) return null;
  const f = group.centrings.length;
  const lattice = f === 1 ? "P" : f === 4 ? "F" : f === 2 ? "I" : null;
  if (!lattice) return null;
  for (const [name, v] of NAMED_CUBIC[lattice]) {
    const kn = vfrom(v, 12);
    if (rotations.some((W) => equivalentK(group, rotateK(W, kn), k))) return name;
  }
  return null;
}

/** The star of k: its arms W⁻ᵀk modulo Λ*, and for each the first element carrying k to it. */
function starOf(group: FactorGroup, k: RVec): { arms: RVec[]; reps: number[] } {
  const arms: RVec[] = [];
  const reps: number[] = [];
  for (const i of pointGroupElements(group)) {
    const kp = rotateK(group.elements[i]!.W, k);
    if (arms.some((q) => equivalentK(group, q, kp))) continue;
    arms.push(kp);
    reps.push(i);
  }
  // The identity's arm (k itself) first.
  const self = arms.findIndex((q) => equivalentK(group, q, k));
  if (self > 0) {
    [arms[0], arms[self]] = [arms[self]!, arms[0]!];
    [reps[0], reps[self]] = [reps[self]!, reps[0]!];
  }
  arms[0] = k;
  reps[0] = group.identity;
  return { arms, reps };
}

/** Real symmetric unitary U = A + iB (A, B commuting): T with T² = U, T symmetric unitary. */
function symmetricSquareRoot(U: CMat): CMat {
  const n = U.n;
  const c = Math.SQRT2 - 1; // generic: separates the joint eigenspaces of A and B
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => U.re[i * n + j]! + c * U.im[i * n + j]!));
  const { vectors } = symmetricEigenDecomposition(M);
  const O = czeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) O.re[i * n + j] = vectors[i]![j]!;
  const Ot = cadjoint(O);
  const diag = cmul(Ot, cmul(U, O));
  const root = czeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && Math.hypot(diag.re[i * n + j]!, diag.im[i * n + j]!) > 1e-7) throw new Error("irreps: the intertwiner of a real irrep is not diagonalized by a real basis");
    }
    const s = nroot({ re: diag.re[i * n + i]!, im: diag.im[i * n + i]! }, 2);
    root.re[i * n + i] = s.re;
    root.im[i * n + i] = s.im;
  }
  return cmul(O, cmul(root, Ot));
}

/** A nonzero intertwiner D(f)·U = U·conj(D(f)) over the group (U ∝ Σ_f D(f) E_ab D(f)ᵀ), det 1. */
function conjugateIntertwiner(D: readonly CMat[]): CMat {
  const n = D[0]!.n;
  let best: CMat | null = null;
  let bestNorm = 0;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const u = czeros(n);
      for (const m of D) {
        // (m E_ab mᵀ)_{ij} = m_{ia} m_{jb}
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const xr = m.re[i * n + a]!;
            const xi = m.im[i * n + a]!;
            const yr = m.re[j * n + b]!;
            const yi = m.im[j * n + b]!;
            u.re[i * n + j] = u.re[i * n + j]! + xr * yr - xi * yi;
            u.im[i * n + j] = u.im[i * n + j]! + xr * yi + xi * yr;
          }
        }
      }
      let norm = 0;
      for (let i = 0; i < n * n; i++) norm = Math.max(norm, Math.hypot(u.re[i]!, u.im[i]!));
      if (norm > bestNorm + 1e-9) {
        best = u;
        bestNorm = norm;
      }
    }
  }
  if (!best || bestNorm < 1e-8) throw new Error("irreps: a real irrep has no intertwiner with its conjugate");
  // Scale to unitary: U·U† = s·I.
  const s = cmul(best, cadjoint(best)).re[0]!;
  return cscale(best, { re: 1 / Math.sqrt(s), im: 0 });
}

/**
 * The real form of a real (type 1) irrep: T⁻¹DT with T² the symmetric
 * intertwiner of D and D*. `D` holds the irrep's matrices on a whole finite
 * group, or on one element of each coset of a subgroup the irrep maps to ±1
 * (D E Dᵀ is then the same on the coset).
 */
export function realForm(D: readonly CMat[]): Float64Array[] {
  return realFormWithBasis(D).matrices;
}

/** {@link realForm}, with the unitary T it takes D to the real matrices by (T⁻¹DT): basis vectors carried by D go to real ones by T. */
export function realFormWithBasis(D: readonly CMat[]): { readonly matrices: Float64Array[]; readonly T: CMat } {
  const U = conjugateIntertwiner(D);
  const T = symmetricSquareRoot(U);
  const Tinv = cconj(T);
  const matrices = D.map((m) => {
    const r = cmul(Tinv, cmul(m, T));
    for (let i = 0; i < r.im.length; i++) if (Math.abs(r.im[i]!) > 1e-7) throw new Error("irreps: the real form of a real irrep is not real");
    return Float64Array.from(r.re, (x) => (Math.abs(x) < 1e-12 ? 0 : x));
  });
  return { matrices, T };
}

/** The realification [[Re D, −Im D], [Im D, Re D]] of a pseudoreal or complex irrep. */
export function realification(D: readonly CMat[]): Float64Array[] {
  return D.map((m) => {
    const n = m.n;
    const out = new Float64Array(4 * n * n);
    const N = 2 * n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const re = m.re[i * n + j]!;
        const im = m.im[i * n + j]!;
        out[i * N + j] = re;
        out[i * N + n + j] = -im;
        out[(n + i) * N + j] = im;
        out[(n + i) * N + n + j] = re;
      }
    }
    return out;
  });
}

/** The conjugacy classes of the factor group, as lists of element indices. */
function conjugacyClasses(group: FactorGroup): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let x = 0; x < group.elements.length; x++) {
    if (seen.has(x)) continue;
    const cls = new Set<number>();
    for (let g = 0; g < group.elements.length; g++) cls.add(group.table[group.table[g]![x]!]![group.inverse[g]!]!);
    for (const y of cls) seen.add(y);
    out.push([...cls]);
  }
  return out;
}

const classCache = new WeakMap<FactorGroup, number[][]>();

function selfCheck(group: FactorGroup, irreps: readonly SpaceGroupIrrep[], star: RVec[], pointGroupOrder: number, label: string): void {
  const F = group.elements.length;
  const fail = (what: string): never => {
    throw new Error(`irreps at ${label}: self-check failed — ${what}`);
  };
  let sumSq = 0;
  for (const irrep of irreps) {
    sumSq += irrep.dim * irrep.dim;
    const D = irrep.matrices;
    // Unitarity, and the representation property D(g)D(b) = D(gb) for g in a
    // generating set and every b — which makes D a homomorphism on all of F.
    for (let a = 0; a < F; a++) {
      if (cmaxDiff(cmul(D[a]!, cadjoint(D[a]!)), cidentity(irrep.dim)) > 1e-7) fail(`${irrep.label} is not unitary`);
    }
    for (const g of generatorsOf(group)) {
      for (let b = 0; b < F; b++) {
        if (cmaxDiff(cmul(D[g]!, D[b]!), D[group.table[g]![b]!]!) > 1e-7) fail(`${irrep.label} is not a representation`);
      }
    }
  }
  if (sumSq !== star.length * pointGroupOrder) fail(`Σ dim² = ${sumSq}, expected |star|·|Ḡ| = ${star.length * pointGroupOrder}`);
  // Orthonormal characters on F.
  for (let a = 0; a < irreps.length; a++) {
    for (let b = a; b < irreps.length; b++) {
      let re = 0;
      let im = 0;
      for (let f = 0; f < F; f++) {
        const x = irreps[a]!.characters[f]!;
        const y = irreps[b]!.characters[f]!;
        re += x.re * y.re + x.im * y.im;
        im += x.im * y.re - x.re * y.im;
      }
      if (Math.abs(re / F - (a === b ? 1 : 0)) > 1e-7 || Math.abs(im / F) > 1e-7) fail(`characters of irreps ${a + 1} and ${b + 1} are not orthonormal`);
    }
  }
  // Class functions.
  let classes = classCache.get(group);
  if (!classes) {
    classes = conjugacyClasses(group);
    classCache.set(group, classes);
  }
  for (const irrep of irreps) {
    for (const cls of classes) {
      const c0 = irrep.characters[cls[0]!]!;
      for (const x of cls) {
        const c = irrep.characters[x]!;
        if (Math.hypot(c.re - c0.re, c.im - c0.im) > 1e-7) fail(`the character of ${irrep.label} is not a class function`);
      }
    }
  }
}

/**
 * The irreps of the parent group at the star of k (conventional reciprocal
 * basis; k must lie in the bound — Phase 1: an integer vector, the cell kept),
 * each induced from a small representation, with their physically
 * irreducible real forms. See the module comment.
 */
export function irrepsOfStar(group: FactorGroup, kIn: Vec3): StarIrreps {
  const { star, littleCoGroupOrder, irreps } = complexIrrepsOfStar(group, kIn);
  const m = irreps.length;

  // Physically irreducible: real ones alone, complex ones with their conjugate when it is at this star.
  const physical: PhysicalIrrep[] = [];
  const used = new Set<number>();
  irreps.forEach((irrep, i) => {
    if (used.has(i)) return;
    used.add(i);
    if (irrep.reality === "real") {
      const matrices = realForm(irrep.matrices);
      physical.push({ irreps: [irrep.index], dim: irrep.dim, reality: "real", matrices, characters: matrices.map((x) => trace(x, irrep.dim)), label: irrep.label, starArms: star.arms });
      return;
    }
    let partner = -1;
    if (irrep.reality === "complex") {
      partner = irreps.findIndex((o, j) => !used.has(j) && o.dim === irrep.dim && o.characters.every((c, f) => Math.hypot(c.re - irrep.characters[f]!.re, c.im + irrep.characters[f]!.im) < 1e-7));
      if (partner >= 0) used.add(partner);
    }
    const matrices = realification(irrep.matrices);
    const members = partner >= 0 ? [irrep.index, irreps[partner]!.index] : [irrep.index];
    physical.push({
      irreps: members,
      dim: 2 * irrep.dim,
      reality: irrep.reality,
      matrices,
      characters: matrices.map((x) => trace(x, 2 * irrep.dim)),
      starArms: star.arms,
      label: members.length === 2
        ? `${star.label} irreps ${members[0]}⊕${members[1]} of ${m}`
        : irrep.reality === "pseudoreal" ? `${irrep.label} (doubled)` : `${irrep.label} ⊕ its conjugate at −k`,
    });
  });
  return { star, littleCoGroupOrder, irreps, physical: physical.map((p) => alignedToDirections(group, p)) };
}

/**
 * The (complex) irreps of the parent group at the star of k, each induced
 * from a small representation of the arm k as given (`star.arms[0]` is k
 * itself, and the top-left block of each matrix, of the small dimension, is
 * the small representation on the elements of G_k), numbered as
 * {@link irrepsOfStar} numbers them, with their reality over F; without the
 * physically irreducible forms. Checked as irrepsOfStar is.
 */
export function complexIrrepsOfStar(group: FactorGroup, kIn: Vec3): Omit<StarIrreps, "physical"> {
  const k = vfrom(kIn, 24);
  if (!kInBound(group, k)) throw new Error(`irreps: k = ${formatK(kIn)} needs a supercell beyond the bound: k·t is not an integer for some translation t of its core T″`);
  const pg = pointGroupElements(group);
  const rotations = pg.map((i) => group.elements[i]!.W);
  const { arms, reps } = starOf(group, k);
  const name = kName(group, k, rotations);
  const kv: Vec3 = [rnum(k[0]), rnum(k[1]), rnum(k[2])];
  const star: KStar = {
    k: kv,
    arms: arms.map((a) => [rnum(a[0]), rnum(a[1]), rnum(a[2])] as Vec3),
    name,
    label: name ?? `k = ${formatK(kv)}`,
  };

  // The little co-group, each rotation with its coset representative's translation.
  const little = pg.filter((i) => equivalentK(group, rotateK(group.elements[i]!.W, k), k));
  const littleW = little.map((i) => group.elements[i]!.W);
  const littleIndex = new Map(littleW.map((W, i) => [ikey(W), i] as const));
  const n = little.length;
  const ltable = littleW.map((A) => littleW.map((B) => littleIndex.get(ikey(imul(A, B)))!));
  const mu: Complex[][] = little.map((ia) => little.map((ib) => {
    const g = vsub(itransMulVec(group.elements[ia]!.W, k), k);
    return phase(vdot(g, group.elements[ib]!.w));
  }));
  const chain = pointGroupChain(littleW);
  const small = projectiveIrreps(ltable, mu, chain);
  const smallSum = small.reduce((s, P) => s + P[0]!.n * P[0]!.n, 0);
  if (smallSum !== n) throw new Error(`irreps at ${star.label}: the small representations miss (Σ d² = ${smallSum}, |Ḡ_k| = ${n})`);

  // Induce each over the star: D(f)_{ij} = Γ(h_i⁻¹ f h_j) when that lies in G_k.
  const s = arms.length;
  const hInv = reps.map((r) => invert(group.elements[r]!));
  const induced = small.map((P) => {
    const d = P[0]!.n;
    const matrices = group.elements.map((f) => {
      const D = czeros(s * d);
      for (let i = 0; i < s; i++) {
        for (let j = 0; j < s; j++) {
          const x = compose(hInv[i]!, compose(f, group.elements[reps[j]!]!));
          const li = littleIndex.get(ikey(x.W));
          if (li === undefined) continue;
          // Γ({X|v}) = exp(2πi k·v)·P(X); v exact (k is an integer vector, so v mod ℤ³ suffices).
          csetBlock(D, i * d, j * d, cscale(P[li]!, phase(vdot(k, x.w))));
        }
      }
      return D;
    });
    return { d, matrices };
  });

  // Reality: (1/|F|) Σ_f χ(f²) = (1/|F|) Σ_f tr(D(f)²).
  const F = group.elements.length;
  const built = induced.map(({ d, matrices }) => {
    let ind = 0;
    for (const m of matrices) ind += ctrace(cmul(m, m)).re;
    ind /= F;
    const rounded = Math.round(ind);
    if (Math.abs(ind - rounded) > 1e-6 || rounded > 1 || rounded < -1) throw new Error(`irreps at ${star.label}: Frobenius–Schur sum ${ind} is not 1, 0 or −1`);
    const reality: Reality = rounded === 1 ? "real" : rounded === -1 ? "pseudoreal" : "complex";
    return { dim: s * d, smallDim: d, reality, matrices, characters: matrices.map(ctrace) };
  });
  // Ordered by dimension, then real before pseudoreal before complex (stable: the chain's order otherwise).
  const rank: Record<Reality, number> = { real: 0, pseudoreal: 1, complex: 2 };
  const ordered = built.map((b, i) => ({ b, i })).sort((x, y) => x.b.dim - y.b.dim || rank[x.b.reality] - rank[y.b.reality] || x.i - y.i).map(({ b }) => b);
  const m = ordered.length;
  const irreps: SpaceGroupIrrep[] = ordered.map((b, i) => ({ ...b, index: i + 1, label: `${star.label} irrep ${i + 1} of ${m}` }));
  selfCheck(group, irreps, arms, rotations.length, star.label);
  return { star, littleCoGroupOrder: n, irreps };
}

function trace(m: Float64Array, n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += m[i * n + i]!;
  return t;
}

/** The stars of every k-point the bound admits, Γ first, each with its irreps. */
export function irrepsInBound(group: FactorGroup): StarIrreps[] {
  return starsInBound(group).map((k) => irrepsOfStar(group, [rnum(k[0]), rnum(k[1]), rnum(k[2])]));
}
