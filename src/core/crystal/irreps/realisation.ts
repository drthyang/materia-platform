/**
 * The realisation of a child group in its own cell (GLOSSARY "Realisation";
 * subgroup engine phase 3, THY-34; docs/research/SUBGROUP_ENGINES.md §1.3,
 * §4): the parent structure re-expressed in the child's ITA standard setting,
 * every Wyckoff orbit of the parent split into the child's orbits, and each
 * atom of the child cell traced back to the parent atom it came from.
 *
 * Input: a child of the factor group F = G/T″ (its elements, as the subgroup
 * lattice and the isotropy subgroups give them) and its child basis
 * (P_H, p_H) from `nameChild`, ITA's and Bilbao's convention (ADR 0003): the
 * child's axes are the columns of P_H in the parent's basis and its origin is
 * p_H, so a point has coordinates x_parent = P_H·x_child + p_H.
 *
 *  - Operations: each element {W|w} becomes {P⁻¹WP | P⁻¹(w + Wp − p)},
 *    exactly (rational arithmetic), taken modulo the child's integer
 *    translations. A named child's set must be a tabulated setting of its IT
 *    number (spaceGroupData); its operations are then the table's.
 *  - Cell: G_child = Pᵀ·G_parent·P from the parent's own metric (not an ideal
 *    one), averaged over the child's rotations so the ties its symmetry
 *    imposes hold to rounding.
 *  - Sites: every image of every parent site in the child cell (the parent
 *    orbit, translated over the parent lattice), split into orbits of the
 *    child's operations; one child site per orbit. A site whose orbit stays
 *    whole keeps its label; a split one gets letter suffixes, as
 *    realizeSubgroup labels a same-cell child. Element, isotope, oxidation
 *    state, occupancy and disorder group carry over; an isotropic B carries
 *    over; an anisotropic U is rotated to the representative's image and
 *    transformed to the child's axes (C = N·U·N, the fractional displacement
 *    covariance, goes to P⁻¹·W·C·Wᵀ·P⁻ᵀ).
 *  - Atom correspondence: every atom of the child cell, with the parent site,
 *    the parent operation and the parent lattice translation that place it:
 *    P·x + p = W·x_s + w + n.
 *
 * Riding hydrogens and distance restraints name the parent's sites and
 * operations, so they are not carried (`dropped` says so), nor are the
 * source's standard uncertainties.
 *
 * The realised child is an ordinary StructureModel, the seam to the PDF and
 * Rietveld engines: they expand it with its own operations and enumerate its
 * own reflections, superlattice ones included. At the parent's geometry it
 * is the parent exactly: the same G(r), and |F(H)|² = (V_child/V_parent)²
 * |F_parent(P⁻ᵀH)|² with every superlattice reflection zero (tests).
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { AtomSite, DisplacementParameters, StructureModel, SymmetryOperation, UnitCell } from "@/core/crystal/types";
import { applyOperation, formatOperationXyz, parseSymmetryOperation, siteMultiplicity } from "@/core/crystal/symmetry";
import { distinctSiteOps } from "@/core/diffraction/structureFactor";
import { metricTensor, orthogonalizationMatrix, reciprocalMetricTensor } from "@/core/crystal/unitCell";
import { cellFromMetric } from "@/core/crystal/settings";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { SPACE_GROUP_DATA, type SpaceGroupData } from "@/core/crystal/spaceGroupData";
import { extendedSymbol } from "@/core/crystal/spaceGroups";
import { latticeCentring } from "@/core/crystal/standardSetting";
import type { SubgroupIdentity } from "@/core/crystal/isotropyTree";
import type { FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { nameChild } from "@/core/crystal/irreps/childSetting";
import { rat, radd, rmul, rsub, rnum, rmod1, ratFrom, ZERO, type Rat, type RVec } from "@/core/crystal/irreps/rational";

/** One atom of the child cell and the parent atom it is. */
export interface ChildAtom {
  /** The child site it belongs to (a label of the realised child). */
  readonly site: string;
  /** Index into the child's operations of the one that carries the site's representative here (modulo the child's lattice). */
  readonly childOperation: number;
  /** Its fractional position in the child cell, in [0, 1). */
  readonly position: Vec3;
  /** The parent site it comes from. */
  readonly parentSite: string;
  /** Index into the parent's operations of the one that places it: P·x + p = W·x_s + w + n. */
  readonly parentOperation: number;
  /** The parent lattice translation n of that equation (integer). */
  readonly parentTranslation: Vec3;
}

/** A site of the realised child and where it comes from. */
export interface ChildSiteOrigin {
  readonly label: string;
  readonly parentSite: string;
  /** Atoms of this site in the child cell. */
  readonly multiplicity: number;
  /** Index into the parent's operations of the one that places the site's representative (its ADP is the parent's rotated by it). */
  readonly parentOperation: number;
}

export interface RealisedChild {
  /** The child in its own cell: its standard setting's operations, its split sites at the parent's geometry. */
  readonly structure: StructureModel;
  /** The child's name and child basis. */
  readonly identity: SubgroupIdentity;
  /** P_H: the child's axes as columns, in the parent's basis. */
  readonly basis: Mat3;
  /** p_H: the child's origin in the parent's coordinates. */
  readonly origin: Vec3;
  /** det P_H: the child's conventional cell over the parent's (a supercell's is above 1). */
  readonly volumeRatio: number;
  /** One entry per child site, in the structure's site order. */
  readonly sites: readonly ChildSiteOrigin[];
  /** Every atom of the child cell, site by site. */
  readonly atoms: readonly ChildAtom[];
  /** What the parent held that the child does not carry ("riding hydrogens", "distance restraints", …). */
  readonly dropped: readonly string[];
}

// ── exact 3×3 arithmetic ──────────────────────────────────────────────────────

type RMat = readonly [RVec, RVec, RVec];

const toRMat = (m: Mat3): RMat => [0, 1, 2].map((i) => [0, 1, 2].map((j) => ratFrom(m[i]![j]!, 96)) as unknown as RVec) as unknown as RMat;
const toRVec = (v: Vec3): RVec => [ratFrom(v[0], 96), ratFrom(v[1], 96), ratFrom(v[2], 96)];
const rmatNum = (m: RMat): Mat3 => m.map((r) => r.map(rnum)) as unknown as Mat3;

function rdet(m: RMat): Rat {
  const t = (a: Rat, b: Rat, c: Rat): Rat => rmul(rmul(a, b), c);
  return rsub(
    radd(radd(t(m[0][0], m[1][1], m[2][2]), t(m[0][1], m[1][2], m[2][0])), t(m[0][2], m[1][0], m[2][1])),
    radd(radd(t(m[0][2], m[1][1], m[2][0]), t(m[0][0], m[1][2], m[2][1])), t(m[0][1], m[1][0], m[2][2])),
  );
}

function rinv(m: RMat): RMat {
  const d = rdet(m);
  if (d.n === 0) throw new Error("realiseChild: the child basis is singular");
  const inv: Rat = rat(d.d, d.n);
  const cof = (i: number, j: number): Rat => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const s = [0, 1, 2].filter((x) => x !== j);
    const a = (u: number, v: number): Rat => m[r[u]!]![s[v]!]!;
    const minor = rsub(rmul(a(0, 0), a(1, 1)), rmul(a(0, 1), a(1, 0)));
    return (i + j) % 2 === 0 ? minor : rsub(ZERO, minor);
  };
  // m⁻¹[i][j] = cofactor(j, i) / det.
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => rmul(cof(j, i), inv)) as unknown as RVec) as unknown as RMat;
}

const rmulVec = (m: RMat, v: RVec): RVec => [0, 1, 2].map((i) => radd(radd(rmul(m[i]![0]!, v[0]), rmul(m[i]![1]!, v[1])), rmul(m[i]![2]!, v[2]))) as unknown as RVec;
function rmulMat(a: RMat, b: RMat): RMat {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => radd(radd(rmul(a[i]![0]!, b[0]![j]!), rmul(a[i]![1]!, b[1]![j]!)), rmul(a[i]![2]!, b[2]![j]!))) as unknown as RVec) as unknown as RMat;
}
const intRMat = (W: readonly (readonly number[])[]): RMat => W.map((r) => r.map((x) => rat(x)) as unknown as RVec) as unknown as RMat;

// ── floating helpers ──────────────────────────────────────────────────────────

const mulMV = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const mulMM = (a: Mat3, b: Mat3): Mat3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!)) as unknown as Mat3;
const transposeM = (m: Mat3): Mat3 => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];

/** x mod 1 in [0, 1), a value within 1e-9 of 1 taken as 0. */
function wrap01(x: number): number {
  const f = x - Math.floor(x);
  return f > 1 - 1e-9 ? 0 : f;
}
const wrapVec = (v: Vec3): Vec3 => [wrap01(v[0]), wrap01(v[1]), wrap01(v[2])];

/** Periodic distance between two fractional positions, per component (the largest). */
function periodicGap(a: Vec3, b: Vec3): number {
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(a[i]! - b[i]!) % 1;
    worst = Math.max(worst, Math.min(d, 1 - d));
  }
  return worst;
}

/** The tolerance (fractional) at which two positions are one atom: the repo's orbit convention (equivalentPositions). */
const SAME_ATOM = 1e-3;

/** Atoms nearer the cell's faces than this (fractional) are on the face and counted once (at 0). */
const FACE = 1e-6;

// ── the child's operations ────────────────────────────────────────────────────

/** Canonical key of an operation modulo ℤ³: rotation, then translation as exact fractions. */
const exactKey = (W: readonly (readonly number[])[], w: RVec): string => `${W.map((r) => r.join(",")).join(";")}|${w.map((x) => `${x.n}/${x.d}`).join(",")}`;

/** The key a tabulated operation has: rotation, translation in 24ths (null when the translation is not a multiple of 1/24). */
function tableKey(op: SymmetryOperation): string | null {
  const t = op.translation.map((x) => {
    const f = wrap01(x) * 24;
    const n = Math.round(f);
    return Math.abs(f - n) < 1e-6 ? n % 24 : null;
  });
  if (t.some((x) => x === null)) return null;
  return `${op.rotation.map((r) => r.map((x) => Math.round(x)).join(",")).join(";")}|${t.join(",")}`;
}

/** The tabulated setting whose operations are exactly these (reference settings first); null when none is. */
function tabulatedSetting(ops: readonly SymmetryOperation[], number: number | undefined): SpaceGroupData | null {
  const keys = ops.map(tableKey);
  if (keys.some((k) => k === null)) return null;
  const key = [...keys].sort().join(";");
  const candidates = SPACE_GROUP_DATA
    .filter((e) => e.ops.length === ops.length && (number === undefined || e.number === number))
    .sort((a, b) => Number(b.reference) - Number(a.reference));
  for (const e of candidates) {
    const k = e.ops.map((xyz) => tableKey(parseSymmetryOperation(xyz)));
    if (k.some((x) => x === null)) continue;
    if ([...(k as string[])].sort().join(";") === key) return e;
  }
  return null;
}

type IntMat = readonly (readonly number[])[];
interface ChildOp {
  readonly W: IntMat;
  readonly w: RVec;
}

/**
 * The child's operations in its own basis, modulo its integer translations
 * (centring included), exactly. The elements are cosets of T″, which need
 * not lie in the child's conventional lattice (a hexagonal R cell of volume 6
 * does not hold 2ℤ³), so their images modulo that lattice miss classes; the
 * set is closed under composition with T″'s translations added.
 */
function childOperations(group: FactorGroup, elements: readonly number[], P: RMat, Pinv: RMat, p: RVec): SymmetryOperation[] {
  const gens: ChildOp[] = [];
  for (const i of elements) {
    const e = group.elements[i]!;
    const Wr = rmulMat(Pinv, rmulMat(intRMat(e.W), P));
    const W = Wr.map((row) => row.map((x) => {
      if (x.d !== 1) throw new Error("realiseChild: an operation's rotation is not integral in the child basis (the basis is not a cell of the child's lattice)");
      return x.n;
    }));
    // w′ = P⁻¹(w + W·p − p).
    const Wp = rmulVec(intRMat(e.W), p);
    const shifted: RVec = [radd(e.w[0], rsub(Wp[0], p[0])), radd(e.w[1], rsub(Wp[1], p[1])), radd(e.w[2], rsub(Wp[2], p[2]))];
    gens.push({ W, w: rmulVec(Pinv, shifted).map(rmod1) as unknown as RVec });
  }
  const I3: IntMat = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const { core, D } = group.bound;
  for (const t of core) gens.push({ W: I3, w: rmulVec(Pinv, [rat(t[0], D), rat(t[1], D), rat(t[2], D)]).map(rmod1) as unknown as RVec });
  // Closure modulo ℤ³: {W₁|w₁}{W₂|w₂} = {W₁W₂ | w₁ + W₁w₂}.
  const all = new Map<string, ChildOp>();
  const queue: ChildOp[] = [];
  const push = (op: ChildOp): void => {
    const key = exactKey(op.W, op.w);
    if (all.has(key)) return;
    all.set(key, op);
    queue.push(op);
  };
  push({ W: I3, w: [ZERO, ZERO, ZERO] });
  for (const g of gens) push(g);
  while (queue.length > 0) {
    const a = queue.pop()!;
    for (const b of [...gens]) {
      const W = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a.W[i]![0]! * b.W[0]![j]! + a.W[i]![1]! * b.W[1]![j]! + a.W[i]![2]! * b.W[2]![j]!));
      const Wb = rmulVec(intRMat(a.W), b.w);
      push({ W, w: [rmod1(radd(a.w[0], Wb[0])), rmod1(radd(a.w[1], Wb[1])), rmod1(radd(a.w[2], Wb[2]))] });
      if (all.size > 4096) throw new Error("realiseChild: the child's operations do not close");
    }
  }
  const out = [...all.values()].map((op) => {
    const rotation = op.W as unknown as Mat3;
    const translation: Vec3 = [rnum(op.w[0]), rnum(op.w[1]), rnum(op.w[2])];
    return { rotation, translation, xyz: formatOperationXyz(rotation, translation) } satisfies SymmetryOperation;
  });
  // The identity first, as every tabulated list has it.
  out.sort((a, b) => Number(isIdentityOp(b)) - Number(isIdentityOp(a)));
  return out;
}

function isIdentityOp(op: SymmetryOperation): boolean {
  return op.rotation.every((r, i) => r.every((x, j) => x === (i === j ? 1 : 0))) && op.translation.every((t) => Math.abs(wrap01(t)) < 1e-12);
}

// ── the child's cell ──────────────────────────────────────────────────────────

/** G_child = Pᵀ·G·P, averaged over the child's rotations; ties its symmetry imposes snapped to exact. */
function childCell(parentCell: UnitCell, P: Mat3, ops: readonly SymmetryOperation[]): UnitCell {
  const g = mulMM(transposeM(P), mulMM(metricTensor(parentCell), P));
  const rotations = new Map<string, Mat3>();
  for (const op of ops) rotations.set(op.rotation.flat().join(","), op.rotation);
  const avg: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const W of rotations.values()) {
    const t = mulMM(transposeM(W), mulMM(g, W));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) avg[i]![j]! += t[i]![j]! / rotations.size;
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < i; j++) avg[i]![j] = avg[j]![i]!;
  const c = cellFromMetric(avg as unknown as Mat3);
  const snapLength = (x: number, ref: number): number => (Math.abs(x - ref) < 1e-12 * ref ? ref : x);
  const snapAngle = (x: number): number => {
    for (const v of [60, 90, 120]) if (Math.abs(x - v) < 1e-8) return v;
    return x;
  };
  const b = snapLength(c.b, c.a);
  return {
    a: c.a,
    b,
    c: snapLength(snapLength(c.c, c.a), b),
    alpha: snapAngle(c.alpha),
    beta: snapAngle(c.beta),
    gamma: snapAngle(c.gamma),
  };
}

// ── ADPs ──────────────────────────────────────────────────────────────────────

/** The reciprocal axis lengths a*, b*, c* of a cell. */
function reciprocalLengths(cell: UnitCell): Vec3 {
  const g = reciprocalMetricTensor(cell);
  return [Math.sqrt(g[0][0]), Math.sqrt(g[1][1]), Math.sqrt(g[2][2])];
}

/**
 * A parent site's ADP on an image placed by the rotation W, in the child's
 * axes: C = N·U·N (the fractional displacement covariance; N = diag(a*, b*, c*)),
 * C′ = P⁻¹·W·C·Wᵀ·P⁻ᵀ, U′ = C′ / (a*′_i a*′_j). B_iso is invariant.
 */
function childAdp(adp: DisplacementParameters, W: Mat3, parentCell: UnitCell, Pinv: Mat3, cell: UnitCell): DisplacementParameters {
  if (adp.kind === "isotropic") return adp;
  const [u11, u22, u33, u12, u13, u23] = adp.uAniso;
  const U: Mat3 = [[u11, u12, u13], [u12, u22, u23], [u13, u23, u33]];
  const n = reciprocalLengths(parentCell);
  const C = U.map((r, i) => r.map((x, j) => x * n[i]! * n[j]!)) as unknown as Mat3;
  const A = mulMM(Pinv, W);
  const Cc = mulMM(A, mulMM(C, transposeM(A)));
  const m = reciprocalLengths(cell);
  const u = (i: number, j: number): number => {
    const x = Cc[i]![j]! / (m[i]! * m[j]!);
    return Math.abs(x) < 1e-15 ? 0 : x;
  };
  return { kind: "anisotropic", uAniso: [u(0, 0), u(1, 1), u(2, 2), u(0, 1), u(0, 2), u(1, 2)] };
}

// ── the realisation ───────────────────────────────────────────────────────────

/** Letter suffixes a, b, …, z, aa, ab, … (realizeSubgroup's). */
function suffix(n: number): string {
  let s = "";
  let x = n;
  do {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

/**
 * How standard a representative looks, lower first: its free coordinates on
 * the fewest and earliest axes (so (x,0,¼) before (0,x,¼) and (x,x,¼)), then
 * the fewest nonzero coordinates, then the smallest coordinates.
 */
function representativeKey(ops: readonly SymmetryOperation[], x: Vec3): number[] {
  const basis = allowedPositionShifts(ops, x).basis;
  const nonzero = basis.reduce((s, b) => s + b.filter((c) => Math.abs(c) > 1e-9).length, 0);
  const axes = basis.map((b) => b.findIndex((c) => Math.abs(c) > 1e-9)).sort((a, b) => a - b);
  const filled = x.filter((c) => Math.abs(c) > 1e-9).length;
  return [nonzero, ...axes, filled, ...x.map((c) => Math.round(c * 1e6))];
}

const lexLess = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return a.length < b.length;
};

/** The child basis (P_H, p_H) a name holds in: the parent's cell for a direct name, else the conventional cell found. */
function childBasisOf(identity: SubgroupIdentity): { basis: Mat3; origin: Vec3 } {
  const I: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const origin: Vec3 = identity.originShift ? [identity.originShift[0], identity.originShift[1], identity.originShift[2]] : [0, 0, 0];
  if (identity.method === "direct") return { basis: I, origin: [0, 0, 0] };
  if (identity.method === "permuted-setting") return { basis: I, origin: [0, 0, 0] };
  return { basis: identity.basis ?? I, origin };
}

/**
 * Realise a child of the factor group in its own cell (see the module
 * comment). `elements` are the child's elements of `group`, which must be
 * the factor group of the parent's own operation list; `identity` is its
 * name with the child basis (nameChild's, computed when absent).
 */
export function realiseChild(parent: StructureModel, group: FactorGroup, elements: readonly number[], identity: SubgroupIdentity = nameChild(group, elements)): RealisedChild {
  const parentOps = parent.spaceGroup.operations;
  if (group.parentOperations !== parentOps && (group.parentOperations.length !== parentOps.length || group.parentOperations.some((op, i) => op.xyz !== parentOps[i]!.xyz))) {
    throw new Error("realiseChild: the factor group is not the parent's (another operation list)");
  }
  const { basis, origin } = childBasisOf(identity);
  const P = toRMat(basis);
  const Pinv = rinv(P);
  const p = toRVec(origin);
  const det = rdet(P);
  if (rnum(det) <= 0) throw new Error("realiseChild: the child basis is not right-handed");
  const Pf = rmatNum(P);
  const PinvF = rmatNum(Pinv);
  const pf: Vec3 = [rnum(p[0]), rnum(p[1]), rnum(p[2])];

  // Operations: the transformed set, the table's when it is a tabulated setting.
  const transformed = childOperations(group, elements, P, Pinv, p);
  const named = identity.method === "direct" || identity.method === "conventional-cell";
  const setting = tabulatedSetting(transformed, identity.number);
  if (named && !setting) {
    throw new Error(`realiseChild: the child's operations in its basis are no tabulated setting of #${identity.number} (the child basis does not match the name)`);
  }
  const operations = setting ? setting.ops.map(parseSymmetryOperation) : transformed;
  const cell = childCell(parent.cell, Pf, operations);

  // The parent lattice translations n that can bring an image into the child cell.
  const corners: Vec3[] = [];
  for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) corners.push(mulMV(Pf, [a, b, c]).map((x, i) => x + pf[i]!) as unknown as Vec3);
  const lo = [0, 1, 2].map((i) => Math.floor(Math.min(...corners.map((v) => v[i]!))) - 1);
  const hi = [0, 1, 2].map((i) => Math.ceil(Math.max(...corners.map((v) => v[i]!))) + 1);
  const ratio = rnum(det);

  const sites: AtomSite[] = [];
  const origins: ChildSiteOrigin[] = [];
  const atoms: ChildAtom[] = [];
  const taken = new Set<string>(parent.sites.map((s) => s.label));
  for (const site of parent.sites) {
    const placing = distinctSiteOps(parentOps, site.position);
    const images = placing.map((op) => ({ op: parentOps.indexOf(op), x: applyOperation(op, site.position) }));
    // Every image of the site in the child cell.
    const found: { x: Vec3; parentOp: number; n: Vec3 }[] = [];
    for (const img of images) {
      const base = wrapVec(img.x);
      for (let n0 = lo[0]!; n0 <= hi[0]!; n0++) {
        for (let n1 = lo[1]!; n1 <= hi[1]!; n1++) {
          for (let n2 = lo[2]!; n2 <= hi[2]!; n2++) {
            const xc = mulMV(PinvF, [base[0] + n0 - pf[0], base[1] + n1 - pf[1], base[2] + n2 - pf[2]]);
            if (xc.some((c) => c < -FACE || c >= 1 - FACE)) continue;
            const x = wrapVec(xc);
            if (found.some((f) => periodicGap(f.x, x) < 1e-7)) continue;
            // P·x + p = W·x_s + w + n, read from the wrapped position: wrapping moves an atom by a
            // child lattice vector, which can be a parent centring vector, so the image it is an
            // integer translate of is found again (exactly, else within the orbit tolerance).
            const X = mulMV(Pf, x).map((c, i) => c + pf[i]!);
            const offInteger = (im: { x: Vec3 }): number => Math.max(...X.map((c, i) => Math.abs(c - im.x[i]! - Math.round(c - im.x[i]!))));
            let k = images.findIndex((im) => offInteger(im) < 1e-6);
            if (k < 0) k = images.findIndex((im) => offInteger(im) < SAME_ATOM);
            if (k < 0) throw new Error(`realiseChild: an image of ${site.label} in the child cell is no parent atom`);
            const n = X.map((c, i) => Math.round(c - images[k]!.x[i]!)) as unknown as Vec3;
            found.push({ x, parentOp: images[k]!.op, n });
          }
        }
      }
    }
    const expected = Math.round(images.length * ratio);
    if (found.length !== expected || Math.abs(images.length * ratio - expected) > 1e-9) {
      throw new Error(`realiseChild: ${site.label} has ${found.length} images in the child cell where ${images.length} × ${ratio} were expected`);
    }
    // Split into orbits of the child's operations.
    const orbitOf = new Int32Array(found.length).fill(-1);
    const orbits: number[][] = [];
    for (let a = 0; a < found.length; a++) {
      if (orbitOf[a]! >= 0) continue;
      const id = orbits.length;
      const members: number[] = [];
      for (const op of operations) {
        const y = wrapVec(applyOperation(op, found[a]!.x));
        const b = found.findIndex((f) => periodicGap(f.x, y) < SAME_ATOM);
        if (b < 0) throw new Error(`realiseChild: the child's operation ${op.xyz} takes an image of ${site.label} off the parent's atoms`);
        if (orbitOf[b] === id) continue;
        if (orbitOf[b]! >= 0) throw new Error(`realiseChild: ${site.label}'s images do not split into orbits (tolerance)`);
        orbitOf[b] = id;
        members.push(b);
      }
      orbits.push(members);
    }
    // One child site per orbit, its representative the most standard-looking member.
    const reps = orbits.map((members) => {
      let best = members[0]!;
      let bestKey = representativeKey(operations, found[best]!.x);
      for (const m of members.slice(1)) {
        const k = representativeKey(operations, found[m]!.x);
        if (lexLess(k, bestKey)) {
          best = m;
          bestKey = k;
        }
      }
      return { members, rep: best, key: bestKey };
    });
    reps.sort((a, b) => (lexLess(a.key, b.key) ? -1 : lexLess(b.key, a.key) ? 1 : 0));
    reps.forEach((o, oi) => {
      let label = site.label;
      if (reps.length > 1) {
        let k = oi;
        do {
          label = `${site.label}${suffix(k)}`;
          k += reps.length;
        } while (taken.has(label));
      }
      taken.add(label);
      const r = found[o.rep]!;
      const multiplicity = siteMultiplicity(operations, r.x);
      if (multiplicity !== o.members.length) {
        throw new Error(`realiseChild: ${label} has ${o.members.length} atoms but its site multiplicity is ${multiplicity}`);
      }
      const W = parentOps[r.parentOp]!.rotation;
      const { su: _su, multiplicity: _m, ...kept } = site;
      sites.push({ ...kept, label, position: [r.x[0], r.x[1], r.x[2]], adp: childAdp(site.adp, W, parent.cell, PinvF, cell) });
      origins.push({ label, parentSite: site.label, multiplicity, parentOperation: r.parentOp });
      for (const m of o.members) {
        const f = found[m]!;
        const childOperation = operations.findIndex((op) => periodicGap(wrapVec(applyOperation(op, r.x)), f.x) < SAME_ATOM);
        atoms.push({ site: label, childOperation, position: f.x, parentSite: site.label, parentOperation: f.parentOp, parentTranslation: f.n });
      }
    });
  }

  const dropped: string[] = [];
  if (parent.riding && parent.riding.length > 0) dropped.push("riding hydrogens");
  if (parent.restraints && parent.restraints.length > 0) dropped.push("distance restraints");
  if (parent.cellSu) dropped.push("cell esds");
  if (parent.sites.some((s) => s.su)) dropped.push("site esds");
  const symbol = setting ? extendedSymbol(setting) : identity.hermannMauguin;
  const number = setting?.number ?? identity.number;
  const structure: StructureModel = {
    id: parent.id,
    name: parent.name,
    cell,
    spaceGroup: {
      operations,
      ...(symbol !== undefined ? { hermannMauguin: symbol } : {}),
      ...(number !== undefined ? { number } : {}),
    },
    sites,
  };
  return { structure, identity, basis: Pf, origin: pf, volumeRatio: ratio, sites: origins, atoms, dropped };
}

/**
 * Lattice points per conventional cell for ISODISTORT's amplitudes of a mode
 * set on a realised child (decentringModes.amplitudeCells, generalised): the
 * child's own, and the parent's primitive cells in the child's conventional
 * cell, det(P_H)·f_parent, so that A_s = A/√child and A_p = A_s·√(V_p/V_s) =
 * A/√parent (ADR 0003).
 */
export function realisedAmplitudeCells(parent: StructureModel, child: RealisedChild): { readonly child: number; readonly parent: number } {
  return {
    child: latticeCentring(child.structure.spaceGroup.operations).length,
    parent: Math.round(child.volumeRatio * latticeCentring(parent.spaceGroup.operations).length * 1e9) / 1e9,
  };
}

/**
 * A displacement field of the realised child that breaks the parent's
 * symmetry down to the child's, for an activation's starting kick: a generic
 * vector of the child's allowed displacements (its site symmetries') with the
 * parent's own (every displacement the parent's site symmetries allow, carried
 * into the child cell) and the rigid translations projected out, normalised to
 * 1 Å over the child's conventional cell (buildSymmetryModes' metric). At the
 * parent's geometry χ² is stationary along every symmetry-breaking direction,
 * so a fit started there never leaves it; the kick along this field does,
 * along all of them at once. The coefficients are fixed, so the field is
 * reproducible. Null when the child allows no displacement the parent does
 * not (it differs from the parent only in its metric).
 *
 * The order parameter of one irrep, and the child's modes by irrep, come with
 * the supercell mode basis (subgroup engine phase 4, THY-35).
 */
export function symmetryBreakingField(parent: StructureModel, child: RealisedChild): { readonly siteLabel: string; readonly axis: Vec3 }[] | null {
  const s = child.structure;
  const ops = s.spaceGroup.operations;
  const M = orthogonalizationMatrix(s.cell);
  const n = s.sites.length;
  const mult = s.sites.map((site) => siteMultiplicity(ops, site.position));
  type Field = Vec3[];
  const zero = (): Field => s.sites.map(() => [0, 0, 0] as Vec3);
  const dot = (a: Field, b: Field): number => {
    let t = 0;
    for (let j = 0; j < n; j++) {
      const ca = mulMV(M, a[j]!);
      const cb = mulMV(M, b[j]!);
      t += mult[j]! * (ca[0] * cb[0] + ca[1] * cb[1] + ca[2] * cb[2]);
    }
    return t;
  };
  const minus = (a: Field, b: Field, f: number): Field => a.map((v, j) => [v[0] - f * b[j]![0], v[1] - f * b[j]![1], v[2] - f * b[j]![2]] as Vec3);
  // What the projection removes: the parent's own displacements, and the rigid translations.
  const removed: Field[] = [];
  const add = (f: Field): void => {
    let w = f;
    for (const q of removed) w = minus(w, q, dot(w, q));
    const norm = Math.sqrt(dot(w, w));
    if (norm > 1e-9) removed.push(w.map((v) => [v[0] / norm, v[1] / norm, v[2] / norm] as Vec3));
  };
  const parentOps = parent.spaceGroup.operations;
  const PinvF = inverse3(child.basis);
  parent.sites.forEach((site) => {
    for (const b of allowedPositionShifts(parentOps, site.position).basis) {
      const f = zero();
      child.sites.forEach((o, j) => {
        if (o.parentSite !== site.label) return;
        f[j] = mulMV(PinvF, mulMV(parentOps[o.parentOperation]!.rotation, b as Vec3));
      });
      add(f);
    }
  });
  // The rigid translations the child allows: the directions every rotation of it fixes (its polar axes).
  const rotationsOnly = ops.map((op) => ({ ...op, translation: [0, 0, 0] as Vec3 }));
  for (const t of allowedPositionShifts(rotationsOnly, [0, 0, 0]).basis) add(s.sites.map(() => [t[0]!, t[1]!, t[2]!] as Vec3));
  // A generic vector of the allowed displacements: fixed, distinct, nonzero weights.
  let v = zero();
  let k = 0;
  s.sites.forEach((site, j) => {
    for (const b of allowedPositionShifts(ops, site.position).basis) {
      const c = 1 + 0.5 * Math.sin(1.7 * (k + 1) + 0.3);
      k++;
      v[j] = [v[j]![0] + c * b[0]!, v[j]![1] + c * b[1]!, v[j]![2] + c * b[2]!];
    }
  });
  for (const q of removed) v = minus(v, q, dot(v, q));
  const norm = Math.sqrt(dot(v, v));
  if (!(norm > 1e-8)) return null;
  const out: { siteLabel: string; axis: Vec3 }[] = [];
  s.sites.forEach((site, j) => {
    const a: Vec3 = [v[j]![0] / norm, v[j]![1] / norm, v[j]![2] / norm];
    if (Math.hypot(...mulMV(M, a)) > 1e-12) out.push({ siteLabel: site.label, axis: a });
  });
  return out;
}

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
