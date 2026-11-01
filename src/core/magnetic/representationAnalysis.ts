/**
 * Representation analysis of a commensurate magnetic structure on the
 * subgroup engine (ADR 0001; THY-36): the magnetic representation Γ_mag of the
 * little group G_k decomposed into its small representations at any
 * commensurate k — non-abelian little co-groups and non-symmorphic groups on
 * the zone boundary included — with the basis vectors of each, and the
 * isotropy subgroup of an order parameter, a magnetic space group.
 *
 * The small representations are the engine's: `complexIrrepsOfStar` on G
 * modulo the core of the magnetic cell, induced from the arm k itself, so the
 * top-left block of each irrep on an operation of G_k is its small
 * representation Γ({W|v}) = exp(+2πi k·v)·P(W) (projective P, chain
 * induction; spaceGroupIrreps.ts). Each carries the engine's generic label
 * (ADR 0004): "X irrep 2 of 4", or "k = (1/2, 0, 0) irrep 1 of 2" where the
 * point has no standard name here; CDML labels are not computed.
 *
 * Γ_mag acts on the Fourier coefficients S_j of the magnetic atoms of one
 * primitive cell (`magneticAtoms`): an operation g sending atom j to atom j′
 * plus the lattice vector L (centring part included) sends S_j to
 * exp(2πi k·L)·det(R)·R·S_j at j′, for m(r_j + t) = S_j·exp(−2πi k·t) + c.c.
 * Its multiplicities n = (1/|G_k|) Σ χ_mag(g)·χ_Γ(g)* come out integral
 * (checked), and the basis vectors are built by the transfer operators
 * P_λ0 = (d/|G_k|) Σ_g Γ(g)*_λ0·Γ_mag(g), so each copy's d vectors transform
 * by Γ exactly (checked).
 *
 * At a single-arm k (−k ≡ k, so every lattice phase is ±1) the configuration
 * is real and the order parameter lives in the physically irreducible small
 * representation: a real Γ in its real form, a complex one with its conjugate
 * (realified), a pseudoreal one doubled. Its order-parameter directions are
 * found by the image method, as isotropy.ts finds them for displacive irreps,
 * on the image of G_k × {1, 1′} where time reversal acts as −1: the
 * intersection closure of the fixed spaces of θ·M(g), each subspace's
 * stabilizer its isotropy subgroup — the kernel for the whole space, the
 * epikernels for the others — one per class under G_k. The isotropy subgroup
 * of a combination of irreps (each with its direction) is the intersection.
 * It is the magnetic space group of the ordering, named as a candidate of the
 * magnetic-space-group route is (identifyCandidate: at k ≠ 0 the type-IV
 * group of the magnetic cell).
 *
 * At a two-arm k the decomposition and the (complex) basis vectors are given;
 * its magnetic groups need G_{±k} and the star (docs/MAGNETIC_SYMMETRY.md),
 * so no group is named, as on the magnetic-space-group route.
 *
 * References: Bertaut, Acta Cryst. A24 (1968) 217; Bradley & Cracknell
 * (1972), Ch. 3–4; Izyumov, Naish & Ozerov (1991); Stokes & Hatch (1988);
 * Perez-Mato et al., Annu. Rev. Mater. Res. 45 (2015) 217.
 */

import type { Complex, Vec3 } from "@/core/math/types";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import { applyOperation, centringOffsets, centringTranslations, isLatticeVector, snapLatticeVector } from "@/core/crystal/symmetry";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { complexIrrepsOfStar, realFormWithBasis, realification, type Reality } from "@/core/crystal/irreps/spaceGroupIrreps";
import { czeros, type CMat } from "@/core/crystal/irreps/complexMatrix";
import { directionSymbol, simplicity } from "@/core/crystal/irreps/isotropy";
import { fixedSpace, intersect, projectorKey, type Vec } from "@/core/crystal/irreps/subspace";
import { determinant } from "@/core/math/mat3";
import { latticePhase, littleGroup } from "./magneticGroups";
import { magneticAtoms } from "./magneticRepresentation";
import { classifyPropagation } from "./propagation";
import { identifyMagneticGroup, type MagneticGroupIdentity, type TransformedIdentification } from "./bnsOg";
import { identifyCandidate } from "./magneticCell";

/** One order-parameter direction of a physically irreducible small representation, with its isotropy subgroup. */
export interface MagneticDirection {
  /** A generic vector of the direction in symbols: "(a,0)", "(a,a)", "(a,b)". */
  readonly symbol: string;
  /** Free order-parameter components. */
  readonly dim: number;
  /** An orthonormal basis of the direction, in the irrep's real basis. */
  readonly basis: readonly (readonly number[])[];
  /** True for the generic direction, whose isotropy subgroup is the kernel. */
  readonly kernel: boolean;
  /** The directions of its class: its orientations within G_k (domains of one class). */
  readonly orientations: number;
  /** Time reversal of each operation of G_k in the isotropy subgroup, read as the candidates read it; 0 when the operation is not in it. */
  readonly theta: readonly (-1 | 0 | 1)[];
}

/** A moment on one atom: real at a single-arm k, a Fourier coefficient (re + i·im) at a two-arm one. */
export interface ComplexMoment {
  readonly re: Vec3;
  readonly im: Vec3;
}

/** One irrep in Γ_mag: a physically irreducible small representation at a single-arm k, a small representation at a two-arm one. */
export interface MagneticIrrep {
  /** The engine's generic label: "X irrep 2 of 4", "k = (1/2, 0, 0) irreps 3⊕4 of 4". */
  readonly label: string;
  /** The irrep numbers at the star it is made of: one, or a conjugate pair. */
  readonly irreps: readonly number[];
  /** The dimension of the order parameter: real at a single-arm k, complex at a two-arm one. */
  readonly dim: number;
  /** The small representation's (complex) dimension. */
  readonly smallDim: number;
  readonly reality: Reality;
  /** How many times it appears in Γ_mag: the copies of its basis. */
  readonly multiplicity: number;
  /** Its real matrices on the little group's operations (in `ops` order); null at a two-arm k. */
  readonly matrices: readonly Float64Array[] | null;
  /** The basis vectors: [copy][row][atom], one moment per magnetic atom (crystal axes). */
  readonly basis: readonly (readonly (readonly ComplexMoment[])[])[];
  /** The real directions the basis spans on the reference atom (the first atom of the first ion), orthonormal in crystal components. */
  readonly modes: readonly Vec3[];
  /** Its order-parameter directions, one-parameter first, the kernel last; empty at a two-arm k. */
  readonly directions: readonly MagneticDirection[];
}

export type RepresentationAnalysis =
  | {
      readonly available: true;
      readonly k: Vec3;
      /** The point's name (Γ, X, …) or its vector: the label's prefix. */
      readonly kLabel: string;
      /** G_k: the parent's operations that leave k invariant, the order every per-operation list follows. */
      readonly ops: readonly SymmetryOperation[];
      /** |Ḡ_k|. */
      readonly coGroupOrder: number;
      /** 3 × the magnetic atoms of one primitive cell. */
      readonly dimension: number;
      /** The magnetic atoms (fractional positions), one per primitive cell. */
      readonly atoms: readonly Vec3[];
      /** True at a two-arm k: decomposition and basis only, no magnetic groups. */
      readonly twoArm: boolean;
      readonly terms: readonly MagneticIrrep[];
    }
  | { readonly available: false; readonly reason: "no-group" | "no-ions" | "incommensurate" | "failed" };

/** One selected irrep and the index of its chosen direction (0: the first listed). */
export interface IrrepChoice {
  readonly label: string;
  readonly direction?: number;
}

export type IsotropyFailure =
  | "no-modes" // nothing selected, or the selection carries no moment
  | "two-arm" // a two-arm k: no magnetic space group of this kind
  | "incompatible"; // the directions chosen leave no common group (cannot happen for one irrep)

export interface IsotropyResult {
  /** The isotropy subgroup's operations (θ set), as a candidate of the magnetic-space-group route lists them. */
  readonly operations: readonly SymmetryOperation[];
  /** Standard BNS/OG identification (k = 0, standard setting), or null. */
  readonly standard: MagneticGroupIdentity | null;
  /** Identification in another setting, or in the magnetic cell at k ≠ 0; null when nothing matches. */
  readonly settingMatch: TransformedIdentification | null;
  /** The rotation cosets kept. */
  readonly subgroupOrder: number;
  /** The other irreps whose order parameter the group allows too (secondary): its allowed moments include their modes. */
  readonly secondary: readonly string[];
}

// ---------------------------------------------------------------- small helpers

type CVec = { re: Float64Array; im: Float64Array };
const cvec = (n: number): CVec => ({ re: new Float64Array(n), im: new Float64Array(n) });

/** y = A·x for a complex matrix A (n×n) and a complex vector x. */
function cmatVec(A: CMat, x: CVec): CVec {
  const n = A.n;
  const y = cvec(n);
  for (let i = 0; i < n; i++) {
    let re = 0;
    let im = 0;
    for (let j = 0; j < n; j++) {
      const ar = A.re[i * n + j]!;
      const ai = A.im[i * n + j]!;
      if (ar === 0 && ai === 0) continue;
      re += ar * x.re[j]! - ai * x.im[j]!;
      im += ar * x.im[j]! + ai * x.re[j]!;
    }
    y.re[i] = re;
    y.im[i] = im;
  }
  return y;
}

const cdot = (a: CVec, b: CVec): Complex => {
  // ⟨a, b⟩ = Σ conj(a)·b
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.re.length; i++) {
    re += a.re[i]! * b.re[i]! + a.im[i]! * b.im[i]!;
    im += a.re[i]! * b.im[i]! - a.im[i]! * b.re[i]!;
  }
  return { re, im };
};
const cnorm = (a: CVec): number => Math.sqrt(cdot(a, a).re);

/** Complex Gram–Schmidt: the vectors that add to the span, orthonormalized. */
function complexBasisOf(vectors: readonly CVec[], tol = 1e-6): CVec[] {
  const out: CVec[] = [];
  for (const v0 of vectors) {
    const v: CVec = { re: Float64Array.from(v0.re), im: Float64Array.from(v0.im) };
    for (const q of out) {
      const c = cdot(q, v);
      for (let i = 0; i < v.re.length; i++) {
        v.re[i] = v.re[i]! - (c.re * q.re[i]! - c.im * q.im[i]!);
        v.im[i] = v.im[i]! - (c.re * q.im[i]! + c.im * q.re[i]!);
      }
    }
    const nrm = cnorm(v);
    if (nrm > tol) {
      for (let i = 0; i < v.re.length; i++) {
        v.re[i] = v.re[i]! / nrm;
        v.im[i] = v.im[i]! / nrm;
      }
      out.push(v);
    }
  }
  return out;
}

/** Real Gram–Schmidt rank test: true when every vector of `add` is independent of `basis` and of each other; appends them (orthonormalized) when so. */
function addIndependent(basis: Float64Array[], add: readonly Float64Array[], tol = 1e-6): boolean {
  const trial: Float64Array[] = [];
  for (const v0 of add) {
    const v = Float64Array.from(v0);
    for (const q of [...basis, ...trial]) {
      let d = 0;
      for (let i = 0; i < v.length; i++) d += q[i]! * v[i]!;
      for (let i = 0; i < v.length; i++) v[i] = v[i]! - d * q[i]!;
    }
    let nrm = 0;
    for (let i = 0; i < v.length; i++) nrm += v[i]! * v[i]!;
    nrm = Math.sqrt(nrm);
    if (nrm < tol) return false;
    for (let i = 0; i < v.length; i++) v[i] = v[i]! / nrm;
    trial.push(v);
  }
  basis.push(...trial);
  return true;
}

function block(M: CMat, size: number): CMat {
  const out = czeros(size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      out.re[i * size + j] = M.re[i * M.n + j]!;
      out.im[i * size + j] = M.im[i * M.n + j]!;
    }
  }
  return out;
}

const traceC = (M: CMat): Complex => {
  let re = 0;
  let im = 0;
  for (let i = 0; i < M.n; i++) {
    re += M.re[i * M.n + i]!;
    im += M.im[i * M.n + i]!;
  }
  return { re, im };
};

function cmulMat(a: CMat, b: CMat): CMat {
  const n = a.n;
  const out = czeros(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const ar = a.re[i * n + k]!;
      const ai = a.im[i * n + k]!;
      if (ar === 0 && ai === 0) continue;
      for (let j = 0; j < n; j++) {
        out.re[i * n + j] = out.re[i * n + j]! + ar * b.re[k * n + j]! - ai * b.im[k * n + j]!;
        out.im[i * n + j] = out.im[i * n + j]! + ar * b.im[k * n + j]! + ai * b.re[k * n + j]!;
      }
    }
  }
  return out;
}

const toMoments = (v: CVec, atoms: number): ComplexMoment[] =>
  Array.from({ length: atoms }, (_, j) => ({
    re: [v.re[3 * j]!, v.re[3 * j + 1]!, v.re[3 * j + 2]!].map(clean) as unknown as Vec3,
    im: [v.im[3 * j]!, v.im[3 * j + 1]!, v.im[3 * j + 2]!].map(clean) as unknown as Vec3,
  }));
const clean = (x: number): number => (Math.abs(x) < 1e-9 ? 0 : x);

/** The real directions a set of moments spans on one atom, orthonormal in crystal components. */
function spanOn(moments: readonly ComplexMoment[]): Vec3[] {
  const out: Vec3[] = [];
  for (const m of moments) {
    for (const c of [m.re, m.im]) {
      let v: Vec3 = [c[0], c[1], c[2]];
      for (const q of out) {
        const d = v[0] * q[0] + v[1] * q[1] + v[2] * q[2];
        v = [v[0] - d * q[0], v[1] - d * q[1], v[2] - d * q[2]];
      }
      const nrm = Math.hypot(v[0], v[1], v[2]);
      if (nrm > 1e-6 && out.length < 3) out.push(v.map((x) => clean(x / nrm)) as unknown as Vec3);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Γ_mag

/** Γ_mag(g) on the Fourier coefficients of the atoms (3N × 3N, complex), for each operation. */
function magneticRepresentationMatrices(atoms: readonly Vec3[], k: Vec3, ops: readonly SymmetryOperation[], centrings: readonly Vec3[]): CMat[] {
  const N = atoms.length;
  return ops.map((op) => {
    const M = czeros(3 * N);
    const R = op.rotation;
    const det = determinant(R);
    atoms.forEach((r, j) => {
      const p = applyOperation(op, r);
      const jp = atoms.findIndex((q) => isLatticeVector([p[0] - q[0], p[1] - q[1], p[2] - q[2]], centrings));
      if (jp < 0) throw new Error("representation analysis: an operation of G_k sends a magnetic atom off the magnetic atoms");
      const q = atoms[jp]!;
      const L = snapLatticeVector([p[0] - q[0], p[1] - q[1], p[2] - q[2]]);
      const phi = 2 * Math.PI * (k[0] * L[0] + k[1] * L[1] + k[2] * L[2]);
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const v = det * R[a]![b]!;
          if (v === 0) continue;
          M.re[(3 * jp + a) * 3 * N + 3 * j + b] = c * v;
          M.im[(3 * jp + a) * 3 * N + 3 * j + b] = s * v;
        }
      }
    });
    return M;
  });
}

// ---------------------------------------------------------------- directions

/** θ·M for a real r×r matrix. */
const signed = (M: Float64Array, theta: number): Float64Array => (theta === 1 ? M : Float64Array.from(M, (x) => -x || 0));

function fixesAll(M: Float64Array, r: number, basis: readonly Vec[]): boolean {
  return basis.every((v) => {
    for (let i = 0; i < r; i++) {
      let s = 0;
      for (let j = 0; j < r; j++) s += M[i * r + j]! * v[j]!;
      if (Math.abs(s - v[i]!) > 1e-7) return false;
    }
    return true;
  });
}

/**
 * The order-parameter directions of a real representation M on G_k with time
 * reversal acting as −1 (the module comment), one per class under G_k, and
 * each one's θ on the operations: one-parameter first, then by the size of
 * the isotropy subgroup (largest first), the kernel last.
 */
function directionsOf(M: readonly Float64Array[], r: number, thetaToCandidate: readonly number[]): MagneticDirection[] {
  // The image of G_k × {1, 1′}: distinct matrices θ·M(g).
  const image = new Map<string, Float64Array>();
  for (const m of M) {
    for (const theta of [1, -1]) {
      const x = signed(m, theta);
      const key = Array.from(x, (v) => Math.round(v * 1e6) / 1e6 || 0).join(",");
      if (!image.has(key)) image.set(key, x);
    }
  }
  const spaces = new Map<string, Vec[]>();
  const whole: Vec[] = Array.from({ length: r }, (_, i) => Array.from({ length: r }, (__, j) => (i === j ? 1 : 0)));
  spaces.set(projectorKey(whole, r), whole);
  for (const x of image.values()) {
    const fix = fixedSpace(x, r);
    if (fix.length > 0) spaces.set(projectorKey(fix, r), fix);
  }
  let frontier = [...spaces.values()];
  while (frontier.length > 0) {
    const next: Vec[][] = [];
    const all = [...spaces.values()];
    for (const a of frontier) {
      for (const b of all) {
        const c = intersect(a, b, r);
        if (c.length === 0) continue;
        const key = projectorKey(c, r);
        if (!spaces.has(key)) {
          spaces.set(key, c);
          next.push(c);
        }
      }
    }
    frontier = next;
  }
  // Each subspace's stabilizer: θ per operation (0 when neither sign fixes it).
  const thetaOf = (basis: readonly Vec[]): (-1 | 0 | 1)[] => M.map((m) => (fixesAll(m, r, basis) ? 1 : fixesAll(signed(m, -1), r, basis) ? -1 : 0));
  const found = [...spaces.values()].map((basis) => ({ basis, theta: thetaOf(basis) }));
  // A subspace is a direction when it is the whole fixed space of its stabilizer (else a larger one of the list has the same group).
  const directions = found.filter((d) => found.every((o) => o === d || o.basis.length <= d.basis.length || o.theta.some((t, i) => t !== d.theta[i])));
  // Classes under G_k: g·V = M(g)V.
  const apply = (m: Float64Array, basis: readonly Vec[]): Vec[] => basis.map((v) => Array.from({ length: r }, (_, i) => {
    let s = 0;
    for (let j = 0; j < r; j++) s += m[i * r + j]! * v[j]!;
    return s;
  }));
  const keyOf = new Map(directions.map((d) => [projectorKey(d.basis as Vec[], r), d] as const));
  const seen = new Set<string>();
  const classes: { rep: (typeof directions)[number]; size: number }[] = [];
  for (const d of directions) {
    const key = projectorKey(d.basis as Vec[], r);
    if (seen.has(key)) continue;
    const members: (typeof directions)[number][] = [];
    for (const m of M) {
      const img = apply(m, d.basis);
      const k = projectorKey(img, r);
      const member = keyOf.get(k);
      if (!member) throw new Error("representation analysis: an image of an order-parameter direction is not one");
      if (!members.includes(member)) members.push(member);
      seen.add(k);
    }
    let rep = members[0]!;
    for (const c of members) if (lexLess(simplicity(c.basis), simplicity(rep.basis))) rep = c;
    classes.push({ rep, size: members.length });
  }
  const order = (t: readonly number[]): number => t.filter((x) => x !== 0).length;
  return classes
    .map(({ rep, size }) => ({
      symbol: directionSymbol(rep.basis),
      dim: rep.basis.length,
      basis: rep.basis.map((v) => v.map(clean)),
      kernel: rep.basis.length === r,
      orientations: size,
      // θ read as the candidates read it: the k-phase of the operation's centring part is the lattice's (see thetaToCandidate).
      theta: rep.theta.map((t, i) => (t === 0 ? 0 : ((t * thetaToCandidate[i]!) as -1 | 1))),
    }))
    .sort((a, b) => Number(a.kernel) - Number(b.kernel) || Number(a.dim !== 1) - Number(b.dim !== 1) || order(b.theta) - order(a.theta) || a.dim - b.dim);
}

const lexLess = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return a.length < b.length;
};

// ---------------------------------------------------------------- the analysis

/**
 * Γ_mag of the given magnetic sites over G_k, decomposed into the small
 * representations of k with their basis vectors and order-parameter
 * directions (see the module comment). Throws when a self-check fails.
 */
export function magneticRepresentationAnalysis(structure: StructureModel, k: Vec3, siteLabels: readonly string[]): RepresentationAnalysis {
  const parentOps = structure.spaceGroup.operations;
  if (parentOps.length === 0) return { available: false, reason: "no-group" };
  const centrings = centringTranslations(parentOps);
  const cls = classifyPropagation(k, { centrings });
  if (cls.kind === "incommensurate" || !cls.supercell) return { available: false, reason: "incommensurate" };
  const atoms = magneticAtoms(structure, siteLabels);
  if (atoms.length === 0) return { available: false, reason: "no-ions" };
  const ops = littleGroup(parentOps, k);
  const twoArm = cls.twoArms;

  // The engine's irreps at the star of k, induced from k itself: G modulo the core of the magnetic cell.
  const n = cls.supercell;
  const group = factorGroup(parentOps, [[n[0], 0, 0], [0, n[1], 0], [0, 0, n[2]]]);
  const { star, littleCoGroupOrder, irreps } = complexIrrepsOfStar(group, k);
  const elementOf = ops.map((op) => {
    const i = parentOps.indexOf(op);
    if (i < 0) throw new Error("representation analysis: an operation of G_k is not the parent's");
    return i;
  });
  const coGroup = new Set(ops.map((op) => op.rotation.flat().join(","))).size;
  if (coGroup !== littleCoGroupOrder) throw new Error(`representation analysis: the little co-group has ${coGroup} rotations here and ${littleCoGroupOrder} in the engine`);

  const G = ops.length;
  const gammaMag = magneticRepresentationMatrices(atoms, k, ops, centrings);
  const dimension = 3 * atoms.length;
  const chiMag = gammaMag.map(traceC);
  // The small representations on G_k, in the engine's order.
  const small = irreps.map((irrep) => ({ irrep, D: elementOf.map((e) => block(irrep.matrices[e]!, irrep.smallDim)) }));

  const decomposed = small.map(({ irrep, D }) => {
    let re = 0;
    let im = 0;
    D.forEach((m, i) => {
      const c = traceC(m);
      re += chiMag[i]!.re * c.re + chiMag[i]!.im * c.im;
      im += chiMag[i]!.im * c.re - chiMag[i]!.re * c.im;
    });
    re /= G;
    im /= G;
    const mult = Math.round(re);
    if (Math.abs(re - mult) > 1e-6 || Math.abs(im) > 1e-6) throw new Error(`representation analysis: ${irrep.label} appears ${re.toFixed(4)} times in Γ_mag (not an integer)`);
    return { irrep, D, mult };
  });
  const total = decomposed.reduce((s, x) => s + x.mult * x.irrep.smallDim, 0);
  if (total !== dimension) throw new Error(`representation analysis: the small representations account for ${total} of Γ_mag's ${dimension} dimensions`);

  // Basis vectors: P_λ0 = (d/|G|) Σ_g conj(D(g)_λ0)·Γ_mag(g), on an orthonormal basis of P_00's range.
  const basisOf = (D: readonly CMat[], d: number, mult: number, label: string): CVec[][] => {
    const P = Array.from({ length: d }, (_, lam) => {
      const out = czeros(dimension);
      D.forEach((m, i) => {
        const w = { re: m.re[lam * d]!, im: -m.im[lam * d]! }; // conj(D_λ0)
        const g = gammaMag[i]!;
        for (let x = 0; x < out.re.length; x++) {
          out.re[x] = out.re[x]! + w.re * g.re[x]! - w.im * g.im[x]!;
          out.im[x] = out.im[x]! + w.re * g.im[x]! + w.im * g.re[x]!;
        }
      });
      for (let x = 0; x < out.re.length; x++) {
        out.re[x] = (out.re[x]! * d) / G;
        out.im[x] = (out.im[x]! * d) / G;
      }
      return out;
    });
    const columns = Array.from({ length: dimension }, (_, c) => {
      const v = cvec(dimension);
      for (let i = 0; i < dimension; i++) {
        v.re[i] = P[0]!.re[i * dimension + c]!;
        v.im[i] = P[0]!.im[i * dimension + c]!;
      }
      return v;
    });
    const u = complexBasisOf(columns);
    if (u.length !== mult) throw new Error(`representation analysis: ${label}'s first row spans ${u.length} copies, expected ${mult}`);
    const copies = u.map((us) => P.map((Pl) => cmatVec(Pl, us)));
    // Check: Γ_mag(g)·ψ_μ = Σ_λ D(g)_λμ·ψ_λ.
    for (const psi of copies) {
      D.forEach((m, i) => {
        for (let mu = 0; mu < d; mu++) {
          const lhs = cmatVec(gammaMag[i]!, psi[mu]!);
          for (let x = 0; x < dimension; x++) {
            let re = 0;
            let im = 0;
            for (let lam = 0; lam < d; lam++) {
              const dr = m.re[lam * d + mu]!;
              const di = m.im[lam * d + mu]!;
              re += dr * psi[lam]!.re[x]! - di * psi[lam]!.im[x]!;
              im += dr * psi[lam]!.im[x]! + di * psi[lam]!.re[x]!;
            }
            if (Math.abs(lhs.re[x]! - re) > 1e-6 || Math.abs(lhs.im[x]! - im) > 1e-6) throw new Error(`representation analysis: ${label}'s basis vectors do not transform by it`);
          }
        }
      });
    }
    return copies;
  };

  const thetaToCandidate = centringOffsets(ops).map((c) => latticePhase(k, c) ?? 1);
  const reference = (moments: readonly ComplexMoment[][][]): Vec3[] => spanOn(moments.flatMap((copy) => copy.map((row) => row[0]!)));
  const terms: MagneticIrrep[] = [];

  if (twoArm) {
    for (const { irrep, D, mult } of decomposed) {
      if (mult === 0) continue;
      const copies = basisOf(D, irrep.smallDim, mult, irrep.label);
      const basis = copies.map((copy) => copy.map((v) => toMoments(v, atoms.length)));
      terms.push({ label: irrep.label, irreps: [irrep.index], dim: irrep.smallDim, smallDim: irrep.smallDim, reality: "complex", multiplicity: mult, matrices: null, basis, modes: reference(basis), directions: [] });
    }
  } else {
    const used = new Set<number>();
    decomposed.forEach(({ irrep, D, mult }, idx) => {
      if (used.has(idx)) return;
      used.add(idx);
      const d = irrep.smallDim;
      // Reality over G_k: (1/|G|) Σ tr(D(g)²); the k-phase squares to 1 at a single-arm k.
      let fs = 0;
      for (const m of D) fs += traceC(cmulMat(m, m)).re;
      fs /= G;
      const reality: Reality = Math.abs(fs - 1) < 1e-6 ? "real" : Math.abs(fs + 1) < 1e-6 ? "pseudoreal" : Math.abs(fs) < 1e-6 ? "complex" : (() => {
        throw new Error(`representation analysis: ${irrep.label} has Frobenius–Schur sum ${fs}`);
      })();
      let partner = -1;
      if (reality === "complex") {
        partner = decomposed.findIndex((o, j) => j !== idx && !used.has(j) && o.irrep.smallDim === d && o.D.every((m, i) => {
          const a = traceC(m);
          const b = traceC(D[i]!);
          return Math.hypot(a.re - b.re, a.im + b.im) < 1e-7;
        }));
        if (partner < 0) throw new Error(`representation analysis: ${irrep.label} is complex and its conjugate is not at k`);
        used.add(partner);
      }
      const realMult = reality === "pseudoreal" ? mult / 2 : mult;
      if (!Number.isInteger(realMult)) throw new Error(`representation analysis: the pseudoreal ${irrep.label} appears an odd number of times`);
      if (realMult === 0) return;
      const copies = basisOf(D, d, mult, irrep.label);
      let matrices: Float64Array[];
      let candidates: Float64Array[][]; // each a copy: r real vectors of length 3N
      if (reality === "real") {
        const { matrices: Mr, T } = realFormWithBasis(D);
        matrices = Mr;
        candidates = copies.flatMap((psi) => {
          // φ_μ = Σ_λ ψ_λ·T_λμ, then its real and imaginary parts, each a copy transforming by the real form.
          const phi = Array.from({ length: d }, (_, mu) => {
            const v = cvec(dimension);
            for (let lam = 0; lam < d; lam++) {
              const tr = T.re[lam * d + mu]!;
              const ti = T.im[lam * d + mu]!;
              for (let x = 0; x < dimension; x++) {
                v.re[x] = v.re[x]! + psi[lam]!.re[x]! * tr - psi[lam]!.im[x]! * ti;
                v.im[x] = v.im[x]! + psi[lam]!.re[x]! * ti + psi[lam]!.im[x]! * tr;
              }
            }
            return v;
          });
          return [phi.map((v) => v.re), phi.map((v) => v.im)];
        });
      } else {
        // [[Re D, −Im D], [Im D, Re D]] carries (Re ψ_λ, −Im ψ_λ).
        matrices = realification(D);
        candidates = copies.map((psi) => [...psi.map((v) => v.re), ...psi.map((v) => Float64Array.from(v.im, (x) => -x || 0))]);
      }
      const r = reality === "real" ? d : 2 * d;
      const chosen: Float64Array[][] = [];
      const span: Float64Array[] = [];
      for (const c of candidates) {
        if (chosen.length === realMult) break;
        if (addIndependent(span, c)) chosen.push(c);
      }
      if (chosen.length !== realMult) throw new Error(`representation analysis: ${irrep.label} gives ${chosen.length} real copies, expected ${realMult}`);
      // Check: Γ_mag(g)·φ_μ = Σ_λ M(g)_λμ·φ_λ, in real vectors.
      for (const phi of chosen) {
        matrices.forEach((m, i) => {
          const g = gammaMag[i]!;
          for (let mu = 0; mu < r; mu++) {
            for (let x = 0; x < dimension; x++) {
              let lhs = 0;
              for (let y = 0; y < dimension; y++) lhs += g.re[x * dimension + y]! * phi[mu]![y]!;
              let rhs = 0;
              for (let lam = 0; lam < r; lam++) rhs += m[lam * r + mu]! * phi[lam]![x]!;
              if (Math.abs(lhs - rhs) > 1e-6) throw new Error(`representation analysis: the real basis of ${irrep.label} does not transform by its real form`);
            }
          }
        });
      }
      const basis = chosen.map((copy) => copy.map((v) => toMoments({ re: v, im: new Float64Array(dimension) }, atoms.length)));
      const label = partner >= 0
        ? `${star.label} irreps ${Math.min(irrep.index, decomposed[partner]!.irrep.index)}⊕${Math.max(irrep.index, decomposed[partner]!.irrep.index)} of ${irreps.length}`
        : reality === "pseudoreal" ? `${irrep.label} (doubled)` : irrep.label;
      terms.push({
        label,
        irreps: partner >= 0 ? [irrep.index, decomposed[partner]!.irrep.index].sort((a, b) => a - b) : [irrep.index],
        dim: r,
        smallDim: d,
        reality,
        multiplicity: realMult,
        matrices,
        basis,
        modes: reference(basis),
        directions: directionsOf(matrices, r, thetaToCandidate),
      });
    });
  }
  return { available: true, k, kLabel: star.label, ops, coGroupOrder: littleCoGroupOrder, dimension, atoms, twoArm, terms };
}

/**
 * The isotropy subgroup of a choice of irreps, each along one of its
 * directions (the first listed when none is given): the operations of G_k,
 * with time reversal, that every chosen order parameter keeps, named as the
 * magnetic-space-group route names its candidates.
 */
export function magneticIsotropySubgroup(analysis: Extract<RepresentationAnalysis, { available: true }>, choices: readonly IrrepChoice[]): IsotropyResult | { readonly failure: IsotropyFailure } {
  if (analysis.twoArm) return { failure: "two-arm" };
  const chosen = choices.map((c) => ({ term: analysis.terms.find((t) => t.label === c.label), direction: c.direction ?? 0 })).filter((c) => c.term && c.term.multiplicity > 0);
  if (chosen.length === 0) return { failure: "no-modes" };
  let theta: (-1 | 0 | 1)[] | null = null;
  for (const { term, direction } of chosen) {
    const d = term!.directions[Math.min(direction, term!.directions.length - 1)];
    if (!d) return { failure: "no-modes" };
    theta = theta === null ? [...d.theta] : theta.map((t, i) => (t === d.theta[i] ? t : 0));
  }
  const ops = analysis.ops.flatMap((op, i) => (theta![i] === 0 ? [] : [{ ...op, timeReversal: theta![i]! }]));
  if (ops.length === 0) return { failure: "incompatible" };
  // The other irreps the group allows: a vector of theirs it fixes.
  const thetaRaw = theta!.map((t, i) => t * (centringPhase(analysis, i)));
  const secondary = analysis.terms
    .filter((t) => !chosen.some((c) => c.term === t) && t.matrices)
    .filter((t) => {
      const r = t.dim;
      const fixed = analysis.ops.reduce<Vec[] | null>((acc, _, i) => {
        if (thetaRaw[i] === 0) return acc;
        const fix = fixedSpace(signed(t.matrices![i]!, thetaRaw[i]!), r);
        if (acc === null) return fix;
        return acc.length === 0 || fix.length === 0 ? [] : intersect(acc, fix, r);
      }, null);
      return fixed !== null && fixed.length > 0;
    })
    .map((t) => t.label);
  const cosets = new Set(ops.map((o) => o.rotation.flat().join(",")));
  const zeroK = analysis.k.every((c) => Math.abs(c) < 1e-9);
  const standard = zeroK ? identifyMagneticGroup(ops) : null;
  return { operations: ops, standard, settingMatch: standard ? null : identifyCandidate(ops, analysis.k), subgroupOrder: cosets.size, secondary };
}

const phaseCache = new WeakMap<readonly SymmetryOperation[], number[]>();
/** The k-phase of each operation's centring part (centringOffsets): the factor between θ as the candidates read it and θ on the representation. */
function centringPhase(analysis: Extract<RepresentationAnalysis, { available: true }>, i: number): number {
  let phases = phaseCache.get(analysis.ops);
  if (!phases) {
    phases = centringOffsets(analysis.ops).map((c) => latticePhase(analysis.k, c) ?? 1);
    phaseCache.set(analysis.ops, phases);
  }
  return phases[i]!;
}

/** The moment basis vectors of one copy and row as a real field on the atoms (single-arm k), for tests and the page's preview. */
export function realBasisVector(term: MagneticIrrep, copy: number, row: number): Vec3[] {
  return term.basis[copy]![row]!.map((m) => m.re);
}

