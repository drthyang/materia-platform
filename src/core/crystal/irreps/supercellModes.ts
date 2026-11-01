/**
 * Displacive symmetry modes of a realised child by parent irrep (subgroup
 * engine phase 4, THY-35; GLOSSARY "Symmetry mode"; docs/research/
 * SUBGROUP_ENGINES.md §4.1 and §4.4): the child's allowed displacements, cut
 * into the parent's physically irreducible representations, parent site by
 * parent site, in the child's own cell. These span what ISODISTORT's
 * displacive modes span.
 *
 * Method. The parent's atoms modulo the core T″ of the bound carry the
 * displacement representation D of the factor group F = G/T″: an element f
 * moves the atom at x to f·x and turns its displacement by W_f. The child
 * H ⊆ F fixes exactly the fields its own sites allow (each child site's
 * symmetry-allowed shifts carried over its orbit). Those fields are periodic
 * in the child's lattice, which contains T″, so they live on the T″ cell. For
 * each physically irreducible representation Γ of F whose star has an arm in
 * the dual of the child's lattice, the isotypic projector
 *
 *     P_Γ = d_Γ / (|F|·⟨χ_Γ, χ_Γ⟩) · Σ_f χ_Γ(f) D(f)
 *
 * is central, so it maps the child's fields to the child's fields. Each parent
 * orbit is split further by the local irreps of its site symmetry: the
 * isotypic components of the displacement vector under the site group, found
 * at the site's representative and carried along the orbit. ISODISTORT's
 * "[O:d]Eu" and "[O:d]A2u" are such components. Together these cut the
 * child's fields into orthogonal blocks (Γ, parent site, local component). A
 * Gram–Schmidt over the child's own site shifts, in their order, gives each
 * block an orthonormal basis, one mode per vector. A one-dimensional block is
 * ISODISTORT's mode up to its sign. A larger block, with several copies of Γ
 * on one site, gets a basis of MATERIA's own with the same span.
 *
 * Normalisation follows buildSymmetryModes: amplitude 1 is a displacement of
 * 1 Å summed over the child's conventional cell, multiplicity-weighted, in the
 * child's cell. The realisation builds that cell from the parent's metric, so
 * it is unstrained, as ISODISTORT's normfactor requires. ISODISTORT's A_s and
 * A_p follow from realisedAmplitudeCells (ADR 0003).
 *
 * The basis is complete: the modes span every displacement the child's sites
 * allow. This is checked, and the function throws otherwise.
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { equivalentPositions, siteMultiplicity } from "@/core/crystal/symmetry";
import { metricTensor, orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { symmetricEigenDecomposition } from "@/core/math/linalg";
import { canonicalArm, equivalentK, kInBound, rotateK, pointGroupElements, starsInBound, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar, type PhysicalIrrep, type StarIrreps } from "@/core/crystal/irreps/spaceGroupIrreps";
import { irrepsFor } from "@/core/crystal/irreps/orderParameters";
import { subgroupLattice } from "@/core/crystal/irreps/childSetting";
import { cosets, exponent, inDual } from "@/core/crystal/irreps/supercell";
import { iinv, rat, rnum, type RVec } from "@/core/crystal/irreps/rational";
import type { RealisedChild } from "@/core/crystal/irreps/realisation";

/** One mode: a parent irrep's displacement pattern on one parent site, in the child's cell. */
export interface SupercellMode {
  /** "R irrep 4 of 10 · O", "M irrep 3 of 10 · O 2": the irrep's generic label (ADR 0004), the parent site, a number when the site carries several. */
  readonly label: string;
  /** Index into the basis's irreps. */
  readonly irrep: number;
  /** The parent site the mode moves. */
  readonly parentSite: string;
  /** 1-based number of the mode among the irrep's modes on this site, and their count. */
  readonly copy: number;
  readonly copies: number;
  /** 1-based number of the site-symmetry component it belongs to (the components of the displacement under the site group, smallest first). */
  readonly local: number;
  /** Fractional displacement of each child site at amplitude 1 (1 Å over the child's conventional cell); sites it does not move are left out. */
  readonly axes: readonly { readonly siteLabel: string; readonly axis: Vec3 }[];
}

/** An irrep that carries some of the child's modes. */
export interface IrrepModes {
  /** The physically irreducible representation's generic label ("R irrep 4 of 10"). */
  readonly label: string;
  /** Its star's label ("R", "k = (0, 1/2, 0)"). */
  readonly star: string;
  /** The star's representative arm (conventional reciprocal basis of the parent). */
  readonly k: Vec3;
  readonly dim: number;
  /** The order-parameter direction the child allows, in MATERIA's basis of the irrep ("(a,a,a)"); absent for the identity irrep. */
  readonly direction?: string;
  /** True when this irrep alone lowers the parent to the child (its isotropy subgroup is the child). */
  readonly reachesChild: boolean;
  /** Indices of its modes in the basis. */
  readonly modes: readonly number[];
  /** Its characters on the factor group's elements: they identify it whatever arm it was induced from. */
  readonly characters: readonly number[];
}

/** The child's modes by parent irrep. */
export interface SupercellModeBasis {
  readonly modes: readonly SupercellMode[];
  readonly irreps: readonly IrrepModes[];
  /** The child's elements of the factor group. */
  readonly elements: readonly number[];
  /** The parent's atoms modulo T″ (parent fractional) and the parent site of each. */
  readonly core: { readonly positions: readonly Vec3[]; readonly sites: readonly string[] };
  /** Mode i's field on the core atoms, parent fractional, three per atom (at amplitude 1). */
  readonly fields: readonly Float64Array[];
  /** The elements of F that fix a combination of the modes (amplitude per mode index). */
  stabilizer(amplitudes: readonly number[]): number[];
}

// ── the parent's atoms modulo T″ and F's action on them ─────────────────────

interface CoreCell {
  readonly positions: Vec3[];
  readonly site: number[];
  /** The atom of parent site `site` at x modulo T″; −1 when none. Sites that share a point (mixed occupancy) are told apart by `site`. */
  find(x: Vec3, site: number): number;
}

const mulMV = (m: Mat3 | readonly (readonly number[])[], v: readonly number[]): Vec3 => [
  m[0]![0]! * v[0]! + m[0]![1]! * v[1]! + m[0]![2]! * v[2]!,
  m[1]![0]! * v[0]! + m[1]![1]! * v[1]! + m[1]![2]! * v[2]!,
  m[2]![0]! * v[0]! + m[2]![1]! * v[1]! + m[2]![2]! * v[2]!,
];
const mulMM = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]): Mat3 =>
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

/** Periodic gap between two fractional positions, the largest component. */
function periodicGap(a: Vec3, b: Vec3): number {
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(a[i]! - b[i]!) % 1;
    worst = Math.max(worst, Math.min(d, 1 - d));
  }
  return worst;
}

/** The parent's atoms modulo T″: each site's orbit modulo the parent lattice T, translated over T/T″. */
function coreCell(parent: StructureModel, group: FactorGroup): CoreCell {
  const { D, core } = group.bound;
  const shifts = cosets(group.bound.parent, core).map((v) => [v[0] / D, v[1] / D, v[2] / D] as Vec3);
  const centrings = group.centrings.map((c) => [rnum(c[0]), rnum(c[1]), rnum(c[2])] as Vec3);
  // x modulo T″, in the scaled coordinates D·x reduced by the Hermite rows (a small tolerance at the faces).
  const reduce = (x: Vec3): Vec3 => {
    let s: [number, number, number] = [x[0] * D, x[1] * D, x[2] * D];
    for (let i = 0; i < 3; i++) {
      const h = core[i]!;
      const q = Math.floor(s[i]! / h[i]! + 1e-7);
      if (q !== 0) s = [s[0] - q * h[0], s[1] - q * h[1], s[2] - q * h[2]];
    }
    return [s[0] / D, s[1] / D, s[2] / D];
  };
  const keyOf = (r: Vec3): string => r.map((c) => Math.round(c * 1e4) || 0).join(",");
  const positions: Vec3[] = [];
  const site: number[] = [];
  const reduced: Vec3[] = [];
  const index = new Map<string, number[]>();
  const gapScaled = (a: Vec3, b: Vec3): number => {
    // a − b must lie in T″: reduce it and take the distance to 0 (or to the lattice's face).
    const r = reduce([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    let worst = 0;
    for (let i = 0; i < 3; i++) {
      const hi = core[i]![i]! / D;
      worst = Math.max(worst, Math.min(Math.abs(r[i]!), Math.abs(hi - r[i]!)));
    }
    return worst;
  };
  const find = (x: Vec3, si: number): number => {
    const r = reduce(x);
    for (const i of index.get(`${si}|${keyOf(r)}`) ?? []) if (gapScaled(reduced[i]!, r) < 1e-6) return i;
    for (let i = 0; i < reduced.length; i++) if (site[i] === si && gapScaled(reduced[i]!, r) < 1e-6) return i;
    return -1;
  };
  parent.sites.forEach((s, si) => {
    const orbit: Vec3[] = [];
    for (const x of equivalentPositions(parent.spaceGroup.operations, s.position)) {
      // Modulo the centring vectors too: the orbit modulo T.
      if (orbit.some((y) => centrings.some((c) => periodicGap([y[0] + c[0], y[1] + c[1], y[2] + c[2]], x) < 1e-6))) continue;
      orbit.push(x);
    }
    for (const t of shifts) {
      for (const x of orbit) {
        const X: Vec3 = [x[0] + t[0], x[1] + t[1], x[2] + t[2]];
        if (find(X, si) >= 0) throw new Error(`supercellModes: ${s.label} has two atoms at one point of the T″ cell`);
        const r = reduce(X);
        const k = `${si}|${keyOf(r)}`;
        const list = index.get(k);
        if (list) list.push(positions.length);
        else index.set(k, [positions.length]);
        positions.push(X);
        site.push(si);
        reduced.push(r);
      }
    }
  });
  return { positions, site, find };
}

/** perm[f·N + a]: the atom element f takes atom a to. */
function atomAction(group: FactorGroup, cell: CoreCell): Int32Array {
  const N = cell.positions.length;
  const F = group.elements.length;
  const perm = new Int32Array(F * N);
  group.elements.forEach((e, f) => {
    const w: Vec3 = [rnum(e.w[0]), rnum(e.w[1]), rnum(e.w[2])];
    for (let a = 0; a < N; a++) {
      const y = mulMV(e.W, cell.positions[a]!);
      const b = cell.find([y[0] + w[0], y[1] + w[1], y[2] + w[2]], cell.site[a]!);
      if (b < 0) throw new Error("supercellModes: the parent's operations do not map its atoms onto its atoms");
      perm[f * N + a] = b;
    }
  });
  return perm;
}

/**
 * The character of the displacement representation of F = G/T″ on the
 * parent's atoms modulo T″: χ(f) = Σ over the atoms f leaves in place of
 * tr W_f. Its multiplicity in a physically irreducible representation Γ,
 * ⟨χ_Γ, χ⟩ / ⟨χ_Γ, χ_Γ⟩, counts the copies of Γ the atoms carry (0: Γ moves
 * no atom of this structure).
 */
export function displacementCharacters(parent: StructureModel, group: FactorGroup): Float64Array {
  const cell = coreCell(parent, group);
  const N = cell.positions.length;
  const perm = atomAction(group, cell);
  const F = group.elements.length;
  const chi = new Float64Array(F);
  for (let f = 0; f < F; f++) {
    const W = group.elements[f]!.W;
    const tr = W[0][0] + W[1][1] + W[2][2];
    let fixed = 0;
    for (let a = 0; a < N; a++) if (perm[f * N + a] === a) fixed++;
    chi[f] = fixed * tr;
  }
  return chi;
}

/** The copies of a physically irreducible representation in the displacement representation (displacementCharacters). */
export function displacementMultiplicity(chi: Float64Array, characters: readonly number[]): number {
  let pp = 0;
  let pd = 0;
  for (let f = 0; f < chi.length; f++) {
    pp += characters[f]! * characters[f]!;
    pd += characters[f]! * chi[f]!;
  }
  const n = pd / pp;
  const m = Math.round(n);
  if (Math.abs(n - m) > 1e-6) throw new Error(`supercellModes: the displacement representation holds ${n} copies of an irrep`);
  return m;
}

// ── fields on the core cell ──────────────────────────────────────────────────

type Field = Float64Array;

/** D(f)·u: the displacement at a, turned by W_f, moved to f·a. */
function act(group: FactorGroup, perm: Int32Array, N: number, f: number, u: Field, out: Field, scale = 1): void {
  const W = group.elements[f]!.W;
  for (let a = 0; a < N; a++) {
    const ux = u[3 * a]!;
    const uy = u[3 * a + 1]!;
    const uz = u[3 * a + 2]!;
    if (ux === 0 && uy === 0 && uz === 0) continue;
    const b = perm[f * N + a]!;
    out[3 * b] = out[3 * b]! + scale * (W[0][0] * ux + W[0][1] * uy + W[0][2] * uz);
    out[3 * b + 1] = out[3 * b + 1]! + scale * (W[1][0] * ux + W[1][1] * uy + W[1][2] * uz);
    out[3 * b + 2] = out[3 * b + 2]! + scale * (W[2][0] * ux + W[2][1] * uy + W[2][2] * uz);
  }
}

// ── the stars the child's lattice admits, and their irreps ───────────────────

const irrepCache = new WeakMap<FactorGroup, Map<string, StarIrreps>>();

/** The irreps at a star, computed once per factor group. */
export function cachedIrrepsOfStar(group: FactorGroup, k: Vec3): StarIrreps {
  let byStar = irrepCache.get(group);
  if (!byStar) {
    byStar = new Map();
    irrepCache.set(group, byStar);
  }
  const key = k.map((x) => x.toFixed(6)).join(",");
  const hit = byStar.get(key);
  if (hit) return hit;
  const star = irrepsOfStar(group, k);
  byStar.set(key, star);
  return star;
}

/**
 * Which arm a star's irreps are induced from, which fixes their numbers
 * ("irrep n of m"): "canonical", the first of all its arms (canonicalArm), the
 * same in every bound; "bound", the arm the supercell view lists
 * (starsInBound), so labels match that view's.
 */
export type ArmChoice = "canonical" | "bound";

/**
 * The stars with an arm in the dual of the child's lattice, the waves the
 * child's fields can carry: every k of the core's dual modulo Λ*, grouped into
 * stars, in the order of their canonical arms (Γ first).
 */
function childStars(group: FactorGroup, elements: readonly number[], arms: ArmChoice): StarIrreps[] {
  const lattice = subgroupLattice(group, elements);
  const { core, D } = group.bound;
  const rotations = pointGroupElements(group).map((i) => group.elements[i]!.W);
  const starOf = (k: RVec): RVec[] => {
    const out: RVec[] = [];
    for (const W of rotations) {
      const kp = rotateK(W, k);
      if (!out.some((q) => equivalentK(group, q, kp))) out.push(kp);
    }
    return out;
  };
  // The core's dual lies in (1/M)ℤ³ with M·ℤ³ ⊆ T″; modulo Λ* the components
  // run over [0, L) with L·ℤ³ ⊆ Λ* (L = 1 primitive, 2 centred, 3 rhombohedral).
  const e = exponent(core);
  const M = e / gcdInt(e, D);
  const third = group.centrings.some((c) => c.some((x) => x.d === 3));
  const L = third ? 3 : group.centrings.length > 1 ? 2 : 1;
  const stars: RVec[][] = [];
  for (let a = 0; a < L * M; a++) for (let b = 0; b < L * M; b++) for (let c = 0; c < L * M; c++) {
    const k: RVec = [rat(a, M), rat(b, M), rat(c, M)];
    if (!kInBound(group, k) || !inDual(lattice, k, D)) continue;
    if (stars.some((s) => s.some((q) => equivalentK(group, q, k)))) continue;
    stars.push(starOf(k));
  }
  const bound = arms === "bound" ? starsInBound(group) : [];
  const reps = stars.map((s) => {
    const listed = bound.find((r) => s.some((q) => equivalentK(group, q, r)));
    return listed ?? canonicalArm(group, s[0]!);
  });
  const canonicalOrder = stars.map((s) => canonicalArm(group, s[0]!));
  const weight = (q: RVec): number[] => {
    const v = q.map(rnum);
    return [v.reduce((t, x) => t + Math.abs(x), 0), ...v.map(Math.abs), ...v.map((x) => -x)];
  };
  const order = stars.map((_, i) => i).sort((i, j) => {
    const a = weight(canonicalOrder[i]!);
    const b = weight(canonicalOrder[j]!);
    for (let t = 0; t < a.length; t++) if (Math.abs(a[t]! - b[t]!) > 1e-12) return a[t]! - b[t]!;
    return 0;
  });
  return order.map((i) => {
    const k = reps[i]!;
    return cachedIrrepsOfStar(group, [rnum(k[0]), rnum(k[1]), rnum(k[2])]);
  });
}

function gcdInt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

// ── the local split of a parent orbit by its site symmetry ───────────────────

/**
 * The isotypic components of the displacement vector under the site group of
 * each atom of one parent orbit, as fractional projectors per atom: found at
 * the orbit's first atom from a generic symmetric element of the centre of
 * the site group's algebra, Σ_classes c_k Σ_{R∈class} (R + Rᵀ), whose
 * eigenspaces are those components; carried to the other atoms by an element
 * that takes the first atom there. Ordered by dimension, then eigenvalue.
 */
function localComponents(group: FactorGroup, perm: Int32Array, N: number, atoms: readonly number[], M: Mat3): Mat3[][] {
  const a0 = atoms[0]!;
  const Minv = inverse3(M);
  const rotations = new Map<string, Mat3>();
  const carrier = new Map<number, number>();
  for (let f = 0; f < group.elements.length; f++) {
    const b = perm[f * N + a0]!;
    if (!carrier.has(b)) carrier.set(b, f);
    if (b !== a0) continue;
    const W = group.elements[f]!.W;
    const key = W.map((r) => r.join(",")).join(";");
    if (!rotations.has(key)) rotations.set(key, mulMM(M, mulMM(W, Minv)));
  }
  const rots = [...rotations.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, R]) => R);
  const key = (R: Mat3): string => R.flat().map((x) => Math.round(x * 1e6)).join(",");
  const T = (R: Mat3): Mat3 => [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
  // Conjugacy classes of the site group (S R S⁻¹ with S⁻¹ = Sᵀ in Cartesian).
  const classOf = new Map<string, number>();
  const classes: Mat3[][] = [];
  for (const R of rots) {
    if (classOf.has(key(R))) continue;
    const members = new Map<string, Mat3>();
    for (const S of rots) {
      const C = mulMM(S, mulMM(R, T(S)));
      members.set(key(C), C);
    }
    for (const k of members.keys()) classOf.set(k, classes.length);
    classes.push([...members.values()]);
  }
  const C: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  classes.forEach((members, k) => {
    const c = 1 + 0.5 * Math.sin(1.3 * (k + 1) + 0.7);
    for (const R of members) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i]![j]! += c * (R[i]![j]! + R[j]![i]!);
  });
  const { values, vectors } = symmetricEigenDecomposition(C);
  const scale = Math.max(1, ...values.map(Math.abs));
  const order = [0, 1, 2].sort((i, j) => values[i]! - values[j]!);
  const groups: number[][] = [];
  for (const i of order) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(values[last[0]!]! - values[i]!) < 1e-7 * scale) last.push(i);
    else groups.push([i]);
  }
  groups.sort((g1, g2) => g1.length - g2.length || values[g1[0]!]! - values[g2[0]!]!);
  // Fractional projectors at the first atom: M⁻¹·(Σ v vᵀ)·M.
  const at0 = groups.map((g) => {
    const Pc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const i of g) for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) Pc[r]![s]! += vectors[r]![i]! * vectors[s]![i]!;
    return mulMM(Minv, mulMM(Pc, M));
  });
  // At atom b = g·a0: W_g Π W_g⁻¹.
  return atoms.map((b) => {
    const g = carrier.get(b);
    if (g === undefined) throw new Error("supercellModes: an atom of a parent orbit is not an image of its first atom");
    const W = group.elements[g]!.W;
    const Wi = iinv(W);
    return at0.map((P) => mulMM(W, mulMM(P, Wi)));
  });
}

// ── the basis ─────────────────────────────────────────────────────────────────

/**
 * The displacive modes of a realised child by parent irrep (see the module
 * comment). `elements` are the child's elements of `group`, and `realised`
 * its realisation from the parent's operations (realiseChild).
 */
export function supercellModeBasis(parent: StructureModel, group: FactorGroup, elements: readonly number[], realised: RealisedChild, opts: { readonly arms?: ArmChoice } = {}): SupercellModeBasis {
  const cell = coreCell(parent, group);
  const N = cell.positions.length;
  const perm = atomAction(group, cell);
  const F = group.elements.length;
  const H = [...elements];
  const inH = new Uint8Array(F);
  for (const h of H) inH[h] = 1;
  const G = metricTensor(parent.cell);
  const Mparent = orthogonalizationMatrix(parent.cell);
  const dot = (u: Field, v: Field): number => {
    let s = 0;
    for (let a = 0; a < N; a++) {
      const x = [u[3 * a]!, u[3 * a + 1]!, u[3 * a + 2]!];
      const y = [v[3 * a]!, v[3 * a + 1]!, v[3 * a + 2]!];
      if ((x[0] === 0 && x[1] === 0 && x[2] === 0) || (y[0] === 0 && y[1] === 0 && y[2] === 0)) continue;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += x[i]! * G[i]![j]! * y[j]!;
    }
    return s;
  };

  // The child's own fields: each child site's allowed shifts carried over its atoms, written on the core cell.
  const child = realised.structure;
  const childOps = child.spaceGroup.operations;
  const P = realised.basis;
  const Pinv = inverse3(P);
  const p = realised.origin;
  const childAtomOf = cell.positions.map((X, a) => {
    const x = mulMV(Pinv, [X[0] - p[0], X[1] - p[1], X[2] - p[2]]);
    const parentSite = parent.sites[cell.site[a]!]!.label;
    const i = realised.atoms.findIndex((at) => at.parentSite === parentSite && periodicGap(at.position, x) < 1e-6);
    if (i < 0) throw new Error("supercellModes: an atom of the parent's T″ cell is no atom of the child's cell");
    return i;
  });
  const shiftsOf = child.sites.map((s) => allowedPositionShifts(childOps, s.position).basis);
  const fieldOf = (j: number, b: Vec3): Field => {
    const u = new Float64Array(3 * N);
    const label = child.sites[j]!.label;
    for (let a = 0; a < N; a++) {
      const at = realised.atoms[childAtomOf[a]!]!;
      if (at.site !== label) continue;
      const v = mulMV(P, mulMV(childOps[at.childOperation]!.rotation, b));
      u[3 * a] = v[0];
      u[3 * a + 1] = v[1];
      u[3 * a + 2] = v[2];
    }
    return u;
  };

  // Left cosets gH of the child in F: P_Γ on a field H fixes is Σ_g (Σ_{x∈gH} χ(x)) D(g).
  const cosetOf = new Int32Array(F).fill(-1);
  const reps: number[] = [];
  for (let f = 0; f < F; f++) {
    if (cosetOf[f]! >= 0) continue;
    const id = reps.length;
    reps.push(f);
    for (const h of H) cosetOf[group.table[f]![h]!] = id;
  }

  const stars = childStars(group, elements, opts.arms ?? "canonical");
  const allowed = irrepsFor(group, stars, H);
  const allowedOf = new Map(allowed.map((a) => [a.irrep, a] as const));

  interface Block {
    readonly pir: PhysicalIrrep;
    readonly star: StarIrreps;
    readonly sums: Float64Array;
    readonly c: number;
  }
  const blocks: Block[] = [];
  for (const star of stars) {
    for (const pir of star.physical) {
      let fixed = 0;
      for (const h of H) fixed += pir.characters[h]!;
      if (Math.round(fixed / H.length) <= 0) continue;
      let norm = 0;
      for (let f = 0; f < F; f++) norm += pir.characters[f]! * pir.characters[f]!;
      const sums = new Float64Array(reps.length);
      for (let f = 0; f < F; f++) sums[cosetOf[f]!] = sums[cosetOf[f]!]! + pir.characters[f]!;
      // d / (|F|·⟨χ,χ⟩), ⟨χ,χ⟩ = Σχ²/|F|: d / Σχ².
      blocks.push({ pir, star, sums, c: pir.dim / norm });
    }
  }
  const project = (b: Block, u: Field): Field => {
    const out = new Float64Array(3 * N);
    reps.forEach((g, i) => {
      const s = b.sums[i]!;
      if (Math.abs(s) > 1e-12) act(group, perm, N, g, u, out, b.c * s);
    });
    return out;
  };

  interface RawMode {
    readonly block: number;
    readonly site: number;
    readonly local: number;
    readonly field: Field;
  }
  const raw: RawMode[] = [];
  parent.sites.forEach((s, si) => {
    const atoms = cell.positions.map((_, a) => a).filter((a) => cell.site[a] === si);
    // An orthonormal basis of the fields the child allows on this orbit.
    const basis: Field[] = [];
    child.sites.forEach((_, j) => {
      if (realised.sites[j]!.parentSite !== s.label) return;
      for (const b of shiftsOf[j]!) {
        let u = fieldOf(j, b);
        for (const q of basis) {
          const d = dot(u, q);
          u = u.map((x, i) => x - d * q[i]!) as Field;
        }
        const n = Math.sqrt(dot(u, u));
        if (n > 1e-9) basis.push(u.map((x) => x / n) as Field);
      }
    });
    if (basis.length === 0) return;
    const comps = localComponents(group, perm, N, atoms, Mparent);
    const nLocal = comps[0]!.length;
    let found = 0;
    blocks.forEach((blk, bi) => {
      for (let t = 0; t < nLocal; t++) {
        const accepted: Field[] = [];
        for (const v of basis) {
          // Π_t v: each atom's displacement projected onto its component t.
          const w = new Float64Array(3 * N);
          atoms.forEach((a, ai) => {
            const Pt = comps[ai]![t]!;
            const x = [v[3 * a]!, v[3 * a + 1]!, v[3 * a + 2]!];
            const y = mulMV(Pt, x);
            w[3 * a] = y[0];
            w[3 * a + 1] = y[1];
            w[3 * a + 2] = y[2];
          });
          let u = project(blk, w);
          for (const q of accepted) {
            const d = dot(u, q);
            u = u.map((x, i) => x - d * q[i]!) as Field;
          }
          const n = Math.sqrt(dot(u, u));
          if (n > 1e-6) {
            const e = u.map((x) => x / n) as Field;
            accepted.push(e);
            raw.push({ block: bi, site: si, local: t + 1, field: e });
          }
        }
        found += accepted.length;
      }
    });
    if (found !== basis.length) {
      throw new Error(`supercellModes: the irreps found carry ${found} of the ${basis.length} displacements ${s.label}'s child sites allow (a star of the child's lattice is missing)`);
    }
  });

  // Each mode on the child's sites: the field at each child site's representative, back in child coordinates, 1 Å over the conventional child cell.
  const Mchild = orthogonalizationMatrix(child.cell);
  const mult = child.sites.map((s) => siteMultiplicity(childOps, s.position));
  const siteIndexOf = new Map(parent.sites.map((s, i) => [s.label, i] as const));
  const repAtom = child.sites.map((s, j) => {
    const X = mulMV(P, s.position).map((x, i) => x + p[i]!) as unknown as Vec3;
    const a = cell.find(X, siteIndexOf.get(realised.sites[j]!.parentSite)!);
    if (a < 0) throw new Error(`supercellModes: ${s.label}'s representative is no atom of the parent`);
    return a;
  });
  // By irrep (star order, then the star's irreps), then parent site, then local component.
  raw.sort((x, y) => x.block - y.block || x.site - y.site || x.local - y.local);
  const modes: SupercellMode[] = [];
  const fields: Field[] = [];
  const counts = new Map<string, number>();
  for (const r of raw) counts.set(`${r.block}|${r.site}`, (counts.get(`${r.block}|${r.site}`) ?? 0) + 1);
  const seen = new Map<string, number>();
  const irrepIndex = new Map<number, number>();
  const irreps: { label: string; star: string; k: Vec3; dim: number; direction?: string; reachesChild: boolean; modes: number[]; characters: readonly number[] }[] = [];
  for (const r of raw) {
    const axes: { siteLabel: string; axis: Vec3 }[] = [];
    let norm2 = 0;
    child.sites.forEach((cs, j) => {
      const a = repAtom[j]!;
      const u: Vec3 = [r.field[3 * a]!, r.field[3 * a + 1]!, r.field[3 * a + 2]!];
      if (u[0] === 0 && u[1] === 0 && u[2] === 0) return;
      const axis = mulMV(Pinv, u);
      const c = mulMV(Mchild, axis);
      const n2 = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
      if (n2 < 1e-24) return;
      norm2 += mult[j]! * n2;
      axes.push({ siteLabel: cs.label, axis });
    });
    const n = Math.sqrt(norm2);
    if (!(n > 1e-9)) throw new Error("supercellModes: a mode vanishes on the child's sites");
    const blk = blocks[r.block]!;
    const key = `${r.block}|${r.site}`;
    const copy = (seen.get(key) ?? 0) + 1;
    seen.set(key, copy);
    const copies = counts.get(key)!;
    const siteLabel = parent.sites[r.site]!.label;
    let ii = irrepIndex.get(r.block);
    if (ii === undefined) {
      ii = irreps.length;
      irrepIndex.set(r.block, ii);
      const a = allowedOf.get(blk.pir);
      irreps.push({
        label: blk.pir.label,
        star: blk.star.star.label,
        k: blk.star.star.k,
        dim: blk.pir.dim,
        ...(a ? { direction: a.direction } : {}),
        reachesChild: a?.reachesChild ?? false,
        modes: [],
        characters: blk.pir.characters,
      });
    }
    irreps[ii]!.modes.push(modes.length);
    modes.push({
      label: `${blk.pir.label} · ${siteLabel}${copies > 1 ? ` ${copy}` : ""}`,
      irrep: ii,
      parentSite: siteLabel,
      copy,
      copies,
      local: r.local,
      axes: axes.map(({ siteLabel: l, axis }) => ({ siteLabel: l, axis: axis.map((x) => (Math.abs(x / n) < 1e-12 ? 0 : x / n)) as unknown as Vec3 })),
    });
    fields.push(r.field.map((x) => x / n) as Field);
  }
  // Every allowed displacement is covered (the per-site check above), so the counts agree.
  const free = child.sites.reduce((t, _, j) => t + shiftsOf[j]!.length, 0);
  if (modes.length !== free) throw new Error(`supercellModes: ${modes.length} modes for ${free} free coordinates`);

  const stabilizer = (amplitudes: readonly number[]): number[] => {
    const u = new Float64Array(3 * N);
    amplitudes.forEach((x, i) => {
      if (x === 0) return;
      const f = fields[i]!;
      for (let k = 0; k < u.length; k++) u[k] = u[k]! + x * f[k]!;
    });
    let scale = 0;
    for (let k = 0; k < u.length; k++) scale = Math.max(scale, Math.abs(u[k]!));
    const tol = 1e-9 * Math.max(scale, 1e-12);
    const out: number[] = [];
    const v = new Float64Array(3 * N);
    for (let f = 0; f < F; f++) {
      v.fill(0);
      act(group, perm, N, f, u, v);
      let ok = true;
      for (let k = 0; k < u.length && ok; k++) if (Math.abs(v[k]! - u[k]!) > tol) ok = false;
      if (ok) out.push(f);
    }
    return out;
  };

  return {
    modes,
    irreps,
    elements: H,
    core: { positions: cell.positions, sites: cell.site.map((i) => parent.sites[i]!.label) },
    fields,
    stabilizer,
  };
}

/**
 * The smallest set of the child's irreps whose modes together lower the
 * parent to the child: the order parameter an activation kicks. Searched over
 * one, two and three irreps; ties go to a set holding `preferred` (the
 * irrep the user activated, given by its characters), then to the fewest
 * modes, then to the earliest irreps.
 * Null when no set of up to three irreps reaches the child (every
 * symmetry-breaking irrep is then the order parameter) or when no mode breaks
 * the parent's symmetry at all.
 */
export function orderParameterIrreps(basis: SupercellModeBasis, preferred?: readonly number[]): number[] | null {
  const H = new Set(basis.elements);
  const generic = (i: number): number => 1 + 0.5 * Math.sin(1.7 * (i + 1) + 0.3);
  // Each symmetry-breaking irrep's stabilizer (of a generic combination of its modes).
  const candidates = basis.irreps
    .map((ir, i) => ({ i, ir }))
    .filter(({ ir }) => ir.direction !== undefined && ir.modes.length > 0)
    .map(({ i, ir }) => {
      const amps = basis.modes.map((_, m) => (ir.modes.includes(m) ? generic(m) : 0));
      return { i, ir, stab: new Set(basis.stabilizer(amps)) };
    });
  if (candidates.length === 0) return null;
  const reaches = (set: readonly (typeof candidates)[number][]): boolean => {
    let inter: number[] | null = null;
    for (const c of set) inter = inter === null ? [...c.stab] : inter.filter((x) => c.stab.has(x));
    return inter !== null && inter.length === H.size && inter.every((x) => H.has(x));
  };
  for (let size = 1; size <= Math.min(3, candidates.length); size++) {
    const sets: (typeof candidates)[number][][] = [];
    const pick = (start: number, acc: (typeof candidates)[number][]): void => {
      if (acc.length === size) {
        if (reaches(acc)) sets.push([...acc]);
        return;
      }
      for (let j = start; j < candidates.length; j++) pick(j + 1, [...acc, candidates[j]!]);
    };
    pick(0, []);
    if (sets.length === 0) continue;
    const modesOf = (s: readonly (typeof candidates)[number][]): number => s.reduce((t, c) => t + c.ir.modes.length, 0);
    const isPreferred = (ir: IrrepModes): boolean => preferred !== undefined && preferred.length === ir.characters.length && ir.characters.every((x, f) => Math.abs(x - preferred[f]!) < 1e-6);
    const hasPreferred = (s: readonly (typeof candidates)[number][]): number => (s.some((c) => isPreferred(c.ir)) ? 0 : 1);
    const earlier = (a: readonly (typeof candidates)[number][], b: readonly (typeof candidates)[number][]): number => {
      for (let t = 0; t < a.length; t++) if (a[t]!.i !== b[t]!.i) return a[t]!.i - b[t]!.i;
      return 0;
    };
    sets.sort((a, b) => hasPreferred(a) - hasPreferred(b) || modesOf(a) - modesOf(b) || earlier(a, b));
    return sets[0]!.map((c) => c.i);
  }
  return null;
}

