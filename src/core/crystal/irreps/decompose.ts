/**
 * decompose(parent, child): a distorted child structure taken apart into the
 * parent's symmetry modes by irrep, supercell children included (subgroup
 * engine phase 4, THY-35; ISODISTORT's method 4 and AMPLIMODES; docs/research/
 * SUBGROUP_ENGINES.md §4.2–4.4).
 *
 *  1. The child basis (P_H, p_H), unless given: the child's axes are parent
 *     lattice vectors whose lengths and angles match the child's cell within a
 *     strain tolerance, with det P_H the volume ratio; each of the child's
 *     rotations, written in the parent's basis, must be one of the parent's.
 *     Bases related by a parent rotation describe the same child in another
 *     orientation, so one of each is kept. The origin runs over a 1/24 grid of
 *     the parent cell; every child operation must then be a parent operation.
 *  2. The undistorted child: the parent realised in the child's cell and
 *     setting (realiseChild), from the factor group whose bound is the child's
 *     lattice. Its cell is the parent's metric through P_H: unstrained, as
 *     ISODISTORT's normfactor requires.
 *  3. Pairing: each undistorted site with the child site of its element and
 *     multiplicity whose orbit comes nearest, within a tolerance (1.2 Å by
 *     default; AMPLIMODES uses 1 Å), one to one. The displacement is taken in
 *     the undistorted cell's fractional coordinates and projected onto the
 *     site's allowed shifts; what does not project (more than 0.02 Å) means
 *     the basis or origin is wrong, and that candidate is dropped. A polar
 *     child's origin slides: the mean displacement along its polar axes is
 *     removed, as ISODISTORT chooses the origin that minimises the mean
 *     distance.
 *  4. The amplitudes: the displacement's components on the modes by parent
 *     irrep (supercellModes.ts), in the unstrained metric. The candidate with
 *     the smallest total displacement wins.
 *
 * The result is a mode set on the child as loaded: its own sites, cell and
 * labels, each site moved to its undistorted position, the amplitudes seeded
 * at the observed values, so the starting model is the child exactly.
 * A_s = A/√f_child and A_p = A_s·√(V_p/V_s) follow from its amplitude cells
 * (ADR 0003).
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { equivalentPositions, siteMultiplicity } from "@/core/crystal/symmetry";
import { cellVolume, metricTensor, orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { latticeCentring } from "@/core/crystal/standardSetting";
import { classifyPointGroup } from "@/core/crystal/pointGroup";
import type { SubgroupIdentity } from "@/core/crystal/isotropyTree";
import type { DistortionMode, DistortionModeSet } from "@/core/crystal/distortionModes";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { hnf, inLattice, reduceMod, scaleVec, type IVec, type SupercellCentring } from "@/core/crystal/irreps/supercell";
import { ratFrom, type RVec } from "@/core/crystal/irreps/rational";
import { realiseChild, type RealisedChild } from "@/core/crystal/irreps/realisation";
import { supercellModeBasis, type SupercellModeBasis } from "@/core/crystal/irreps/supercellModes";
import { irrepModeSet } from "@/core/crystal/irreps/modeSet";

export interface DecomposeOptions {
  /** P_H (the child's axes as columns, parent basis); searched when absent. */
  readonly basis?: Mat3;
  /** p_H (the child's origin, parent coordinates); searched when absent. */
  readonly origin?: Vec3;
  /** The largest displacement (Å) a child atom may have from its undistorted position. Default 1.2. */
  readonly tolerance?: number;
}

/** One mode's amplitude: MATERIA's A (conventional child cell), ISODISTORT's A_s and A_p. */
export interface ModeAmplitude {
  readonly id: string;
  readonly label: string;
  readonly a: number;
  readonly as: number;
  readonly ap: number;
}

export interface Decomposition {
  /** The mode set on the child as loaded, its amplitudes seeded at the observed values. */
  readonly set: DistortionModeSet;
  /** The undistorted child (the parent in the child's cell and setting). */
  readonly reference: RealisedChild;
  /** The modes by irrep on the undistorted child. */
  readonly modes: SupercellModeBasis;
  readonly basis: Mat3;
  readonly origin: Vec3;
  readonly amplitudes: readonly ModeAmplitude[];
  /** The largest site displacement (Å) the modes leave unrepresented: rounding only. */
  readonly residual: number;
  /** Each paired child site, the undistorted site it moved from, and how far (Å). */
  readonly pairs: readonly { readonly site: string; readonly reference: string; readonly distance: number }[];
  /** Child sites with no parent atom of their element nearby (left as they are, without modes). */
  readonly unpaired: readonly string[];
}

// ── small linear algebra ─────────────────────────────────────────────────────

const mulMV = (m: readonly (readonly number[])[], v: readonly number[]): Vec3 => [
  m[0]![0]! * v[0]! + m[0]![1]! * v[1]! + m[0]![2]! * v[2]!,
  m[1]![0]! * v[0]! + m[1]![1]! * v[1]! + m[1]![2]! * v[2]!,
  m[2]![0]! * v[0]! + m[2]![1]! * v[1]! + m[2]![2]! * v[2]!,
];
const mulMM = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]): Mat3 =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!)) as unknown as Mat3;
const det3 = (m: readonly (readonly number[])[]): number =>
  m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
function inv3(m: readonly (readonly number[])[]): Mat3 {
  const d = det3(m);
  const c = (i: number, j: number): number => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const s = [0, 1, 2].filter((x) => x !== j);
    const minor = m[r[0]!]![s[0]!]! * m[r[1]!]![s[1]!]! - m[r[0]!]![s[1]!]! * m[r[1]!]![s[0]!]!;
    return (i + j) % 2 === 0 ? minor : -minor;
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => c(j, i) / d)) as unknown as Mat3;
}
const wrapDelta = (x: number): number => x - Math.round(x);
const minImage = (v: readonly number[]): Vec3 => [wrapDelta(v[0]!), wrapDelta(v[1]!), wrapDelta(v[2]!)];
const near = (x: number, tol = 1e-6): boolean => Math.abs(x - Math.round(x)) < tol;
const rotKey = (W: readonly (readonly number[])[]): string => W.map((r) => r.map((x) => Math.round(x)).join(",")).join(";");

/** The child's lattice centring as a letter, from its centring vectors (child basis). */
function centringLetter(ops: readonly SymmetryOperation[]): SupercellCentring {
  const vs = latticeCentring(ops).filter((v) => v.some((x) => Math.abs(x) > 1e-9)).map((v) => v.map((x) => Math.round(((x % 1) + 1) % 1 * 6) / 6));
  const has = (t: readonly number[]): boolean => vs.some((v) => v.every((x, i) => Math.abs(x - t[i]!) < 1e-6));
  if (vs.length === 0) return "P";
  if (vs.length === 3 && has([0, 0.5, 0.5]) && has([0.5, 0, 0.5]) && has([0.5, 0.5, 0])) return "F";
  if (vs.length === 1 && has([0.5, 0.5, 0.5])) return "I";
  if (vs.length === 1 && has([0.5, 0.5, 0])) return "C";
  if (vs.length === 1 && has([0, 0.5, 0.5])) return "A";
  if (vs.length === 1 && has([0.5, 0, 0.5])) return "B";
  if (vs.length === 2 && has([2 / 3, 1 / 3, 1 / 3]) && has([1 / 3, 2 / 3, 2 / 3])) return "R";
  throw new Error("decompose: the child's lattice centring is none of P, A, B, C, I, F or obverse R");
}

// ── 1. the child basis ───────────────────────────────────────────────────────

/** The parent's lattice vectors (conventional basis, centring included) up to a length. */
function latticeVectors(parent: StructureModel, maxLength: number): { v: Vec3; length: number }[] {
  const G = metricTensor(parent.cell);
  const centrings = latticeCentring(parent.spaceGroup.operations);
  const shortest = Math.min(parent.cell.a, parent.cell.b, parent.cell.c);
  const N = Math.ceil(maxLength / (shortest * 0.5)) + 1;
  const out: { v: Vec3; length: number }[] = [];
  const seen = new Set<string>();
  for (let a = -N; a <= N; a++) for (let b = -N; b <= N; b++) for (let c = -N; c <= N; c++) {
    for (const t of centrings) {
      const v: Vec3 = [a + t[0], b + t[1], c + t[2]];
      const key = v.map((x) => Math.round(x * 12)).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const g = mulMV(G, v);
      const length = Math.sqrt(v[0] * g[0] + v[1] * g[1] + v[2] * g[2]);
      if (length > 1e-6 && length <= maxLength) out.push({ v, length });
    }
  }
  return out;
}

/**
 * Bases P (child axes as columns, parent basis) that the child's cell and
 * rotations allow, the least strained first, one per orientation class under
 * the parent's rotations.
 */
function candidateBases(parent: StructureModel, child: StructureModel, strain = 0.12): Mat3[] {
  const Gp = metricTensor(parent.cell);
  const Gc = metricTensor(child.cell);
  const L = [0, 1, 2].map((i) => Math.sqrt(Gc[i]![i]!));
  const cosC = (i: number, j: number): number => Gc[i]![j]! / (L[i]! * L[j]!);
  const ratio = cellVolume(child.cell) / cellVolume(parent.cell);
  const vectors = latticeVectors(parent, Math.max(...L) * (1 + strain));
  const perAxis = L.map((len) => vectors.filter((x) => Math.abs(x.length - len) <= strain * len));
  const dotG = (u: Vec3, v: Vec3): number => {
    const g = mulMV(Gp, v);
    return u[0] * g[0] + u[1] * g[1] + u[2] * g[2];
  };
  const parentRot = new Set(parent.spaceGroup.operations.map((op) => rotKey(op.rotation)));
  const parentRots = [...new Map(parent.spaceGroup.operations.map((op) => [rotKey(op.rotation), op.rotation] as const)).values()];
  const childRots = [...new Map(child.spaceGroup.operations.map((op) => [rotKey(op.rotation), op.rotation] as const)).values()];
  const found: { P: Mat3; strain: number; key: string }[] = [];
  const classes = new Set<string>();
  for (const x of perAxis[0]!) for (const y of perAxis[1]!) {
    if (Math.abs(dotG(x.v, y.v) / (x.length * y.length) - cosC(0, 1)) > strain) continue;
    for (const z of perAxis[2]!) {
      if (Math.abs(dotG(x.v, z.v) / (x.length * z.length) - cosC(0, 2)) > strain) continue;
      if (Math.abs(dotG(y.v, z.v) / (y.length * z.length) - cosC(1, 2)) > strain) continue;
      const P: Mat3 = [[x.v[0], y.v[0], z.v[0]], [x.v[1], y.v[1], z.v[1]], [x.v[2], y.v[2], z.v[2]]];
      const d = det3(P);
      if (d <= 1e-9 || Math.abs(d - ratio) > 0.15 * ratio) continue;
      // Every child rotation must be a parent rotation in the parent's basis.
      const Pinv = inv3(P);
      if (!childRots.every((W) => {
        const Wp = mulMM(P, mulMM(W, Pinv));
        return Wp.every((r) => r.every((v) => near(v))) && parentRot.has(rotKey(Wp));
      })) continue;
      // One per orientation class: the smallest key of R·P over the parent's rotations.
      const keyOf = (M: Mat3): string => M.flat().map((v) => Math.round(v * 12)).join(",");
      let cls = keyOf(P);
      for (const R of parentRots) {
        const k = keyOf(mulMM(R, P));
        if (k < cls) cls = k;
      }
      if (classes.has(cls)) continue;
      classes.add(cls);
      const g = mulMM(mulMM([[P[0][0], P[1][0], P[2][0]], [P[0][1], P[1][1], P[2][1]], [P[0][2], P[1][2], P[2][2]]], Gp), P);
      let worst = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(g[i]![j]! - Gc[i]![j]!) / (L[i]! * L[j]!));
      found.push({ P, strain: worst, key: cls });
    }
  }
  return found.sort((a, b) => a.strain - b.strain).map((f) => f.P);
}

/** Origins p on the 1/24 grid (modulo the parent lattice) for which every child operation is a parent operation. */
function candidateOrigins(parent: StructureModel, child: StructureModel, P: Mat3): Vec3[] {
  const centrings = latticeCentring(parent.spaceGroup.operations);
  const byRot = new Map<string, Vec3[]>();
  for (const op of parent.spaceGroup.operations) {
    const k = rotKey(op.rotation);
    const list = byRot.get(k) ?? [];
    for (const c of centrings) list.push([op.translation[0] + c[0], op.translation[1] + c[1], op.translation[2] + c[2]]);
    byRot.set(k, list);
  }
  const Pinv = inv3(P);
  const ops = child.spaceGroup.operations.map((op) => {
    const W = mulMM(P, mulMM(op.rotation, Pinv)).map((r) => r.map((x) => Math.round(x))) as unknown as Mat3;
    return { W, a: mulMV(P, op.translation), allowed: byRot.get(rotKey(W)) ?? [] };
  });
  if (ops.some((o) => o.allowed.length === 0)) return [];
  const out: Vec3[] = [];
  const G = 24;
  // One origin per class modulo the parent lattice (ℤ³ and the centring vectors).
  const seen = new Set<string>();
  const gridKey = (v: readonly number[]): string => v.map((x) => ((Math.round(x * G) % G) + G) % G).join(",");
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) for (let k = 0; k < G; k++) {
    const p: Vec3 = [i / G, j / G, k / G];
    const cls = centrings.map((c) => gridKey([p[0] + c[0], p[1] + c[1], p[2] + c[2]])).sort()[0]!;
    if (seen.has(cls)) continue;
    const ok = ops.every((o) => {
      const Wp = mulMV(o.W, p);
      const w: Vec3 = [o.a[0] + p[0] - Wp[0], o.a[1] + p[1] - Wp[1], o.a[2] + p[2] - Wp[2]];
      return o.allowed.some((t) => near(w[0] - t[0]) && near(w[1] - t[1]) && near(w[2] - t[2]));
    });
    if (ok) {
      seen.add(cls);
      out.push(p);
    }
  }
  return out;
}

// ── 2. the undistorted child ─────────────────────────────────────────────────

/** The parent realised in the child's cell, setting and origin, with the factor group of the child's lattice and the child's elements in it. */
function undistorted(parent: StructureModel, child: StructureModel, P: Mat3, p: Vec3): { group: FactorGroup; elements: number[]; realised: RealisedChild } {
  const letter = centringLetter(child.spaceGroup.operations);
  const group = factorGroup(parent.spaceGroup.operations, { P: P.map((r) => [...r]), centring: letter });
  const { D, core } = group.bound;
  const exact = (v: readonly number[]): RVec => [ratFrom(v[0]!, 96), ratFrom(v[1]!, 96), ratFrom(v[2]!, 96)];
  const keyOf = (W: readonly (readonly number[])[], w: RVec): string => `${rotKey(W)}|${reduceMod(core, scaleVec(w, D)).join(",")}`;
  const index = new Map<string, number>();
  group.elements.forEach((e, i) => index.set(keyOf(e.W, e.w), i));
  const Pinv = inv3(P);
  const set = new Set<number>();
  for (const op of child.spaceGroup.operations) {
    const W = mulMM(P, mulMM(op.rotation, Pinv)).map((r) => r.map((x) => Math.round(x)));
    const Wp = mulMV(W, p);
    const a = mulMV(P, op.translation);
    const w = exact([a[0] + p[0] - Wp[0], a[1] + p[1] - Wp[1], a[2] + p[2] - Wp[2]]);
    const i = index.get(keyOf(W, w));
    if (i === undefined) throw new Error("decompose: a child operation is no element of the parent's factor group");
    set.add(i);
  }
  // The child's lattice translations modulo T″.
  const cols: IVec[] = [0, 1, 2].map((j) => scaleVec(exact([P[0][j]!, P[1][j]!, P[2][j]!]), D));
  const lattice = hnf([...cols, core[0], core[1], core[2]]);
  for (const t of group.translations) if (inLattice(lattice, scaleVec(group.elements[t]!.w, D))) set.add(t);
  // Closed under the product.
  const queue = [...set];
  while (queue.length > 0) {
    const a = queue.pop()!;
    for (const b of [...set]) {
      for (const c of [group.table[a]![b]!, group.table[b]![a]!]) {
        if (set.has(c)) continue;
        set.add(c);
        queue.push(c);
        if (set.size > group.elements.length) throw new Error("decompose: the child's elements do not close");
      }
    }
  }
  const elements = [...set].sort((x, y) => x - y);
  const pg = classifyPointGroup(child.spaceGroup.operations);
  const parentPg = classifyPointGroup(parent.spaceGroup.operations);
  const identity: SubgroupIdentity = {
    ...(child.spaceGroup.number !== undefined ? { number: child.spaceGroup.number } : {}),
    ...(child.spaceGroup.hermannMauguin !== undefined ? { hermannMauguin: child.spaceGroup.hermannMauguin } : {}),
    pointGroup: pg.symbol,
    index: pg.order > 0 ? Math.round(parentPg.order / pg.order) : 0,
    method: child.spaceGroup.number !== undefined ? "conventional-cell" : "point-group-only",
    basis: P,
    ...(p.some((x) => Math.abs(x) > 1e-12) ? { originShift: [p[0], p[1], p[2]] as const } : {}),
  };
  let realised: RealisedChild;
  try {
    realised = realiseChild(parent, group, elements, identity);
  } catch (e) {
    // A setting the table does not list: the child's own operations, unnamed.
    if (!(e instanceof Error) || !/tabulated setting/.test(e.message)) throw e;
    realised = realiseChild(parent, group, elements, { ...identity, method: "point-group-only" });
  }
  return { group, elements, realised };
}

/** The operations of two structures agree as sets (rotation, translation modulo 1). */
function sameOperations(a: readonly SymmetryOperation[], b: readonly SymmetryOperation[]): boolean {
  const key = (op: SymmetryOperation): string => `${rotKey(op.rotation)}|${op.translation.map((t) => Math.round((((t % 1) + 1) % 1) * 48) % 48).join(",")}`;
  const ka = new Set(a.map(key));
  const kb = new Set(b.map(key));
  return ka.size === kb.size && [...ka].every((k) => kb.has(k));
}

// ── 3. pairing ───────────────────────────────────────────────────────────────

interface Pairing {
  /** Per undistorted site (by index): the child site paired, the child operation g with g·x_child ≈ x_reference, and the displacement (reference fractional). */
  readonly pairs: { readonly ref: number; readonly site: number; readonly op: number; readonly delta: Vec3; readonly distance: number }[];
  readonly unpaired: string[];
  /** Σ multiplicity·|δ|² (Å²) over the paired sites. */
  readonly score: number;
  /** The largest component of a displacement off its site's allowed shifts (Å). */
  readonly offSite: number;
}

function pair(reference: StructureModel, child: StructureModel, tolerance: number): Pairing | null {
  const M = orthogonalizationMatrix(reference.cell);
  const ops = child.spaceGroup.operations;
  const refOps = reference.spaceGroup.operations;
  const cart = (v: Vec3): number => Math.hypot(...mulMV(M, v));
  type Option = { ref: number; site: number; op: number; delta: Vec3; distance: number };
  const options: Option[] = [];
  reference.sites.forEach((r, ri) => {
    const mult = siteMultiplicity(refOps, r.position);
    child.sites.forEach((s, si) => {
      if (s.element !== r.element || siteMultiplicity(ops, s.position) !== mult) return;
      let best: Option | null = null;
      ops.forEach((op, oi) => {
        const y = mulMV(op.rotation, s.position);
        const d = minImage([y[0] + op.translation[0] - r.position[0], y[1] + op.translation[1] - r.position[1], y[2] + op.translation[2] - r.position[2]]);
        const distance = cart(d);
        if (!best || distance < best.distance - 1e-12) best = { ref: ri, site: si, op: oi, delta: d, distance };
      });
      if (best && (best as Option).distance <= tolerance) options.push(best);
    });
  });
  options.sort((a, b) => a.distance - b.distance);
  const usedRef = new Set<number>();
  const usedSite = new Set<number>();
  const pairs: Option[] = [];
  for (const o of options) {
    if (usedRef.has(o.ref) || usedSite.has(o.site)) continue;
    usedRef.add(o.ref);
    usedSite.add(o.site);
    pairs.push(o);
  }
  if (usedRef.size !== reference.sites.length) return null;
  // Project each displacement onto its site's allowed shifts.
  let offSite = 0;
  const projected = pairs.map((o) => {
    const basis = allowedPositionShifts(refOps, reference.sites[o.ref]!.position).basis;
    const proj = projectOnto(basis, o.delta, M);
    offSite = Math.max(offSite, cart([o.delta[0] - proj[0], o.delta[1] - proj[1], o.delta[2] - proj[2]]));
    return { ...o, delta: proj };
  });
  // A polar child's origin slides: remove the mean displacement along its polar axes.
  const rotationsOnly = refOps.map((op) => ({ ...op, translation: [0, 0, 0] as Vec3 }));
  const polar = allowedPositionShifts(rotationsOnly, [0, 0, 0]).basis;
  let mean: Vec3 = [0, 0, 0];
  if (polar.length > 0) {
    let n = 0;
    for (const o of projected) {
      const m = siteMultiplicity(refOps, reference.sites[o.ref]!.position);
      const pd = projectOnto(polar, o.delta, M);
      mean = [mean[0] + m * pd[0], mean[1] + m * pd[1], mean[2] + m * pd[2]];
      n += m;
    }
    mean = [mean[0] / n, mean[1] / n, mean[2] / n];
  }
  let score = 0;
  const final = projected.map((o) => {
    const delta: Vec3 = [o.delta[0] - mean[0], o.delta[1] - mean[1], o.delta[2] - mean[2]];
    const m = siteMultiplicity(refOps, reference.sites[o.ref]!.position);
    const c = mulMV(M, delta);
    score += m * (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
    return { ...o, delta, distance: cart(delta) };
  });
  const unpaired = child.sites.filter((_, si) => !usedSite.has(si)).map((s) => s.label);
  return { pairs: final, unpaired, score, offSite };
}

/** The component of v (fractional) in the span of the basis (fractional), in the Cartesian metric M. */
function projectOnto(basis: readonly Vec3[], v: Vec3, M: Mat3): Vec3 {
  if (basis.length === 0) return [0, 0, 0];
  if (basis.length === 3) return v;
  const bc = basis.map((b) => mulMV(M, b));
  const vc = mulMV(M, v);
  const n = bc.length;
  const A = bc.map((x) => [...bc.map((y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2]), x[0] * vc[0] + x[1] * vc[1] + x[2] * vc[2]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k <= n; k++) A[r]![k] = A[r]![k]! - f * A[c]![k]!;
    }
  }
  const out = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const coef = A[k]![n]! / A[k]![k]!;
    for (let i = 0; i < 3; i++) out[i] = out[i]! + coef * basis[k]![i]!;
  }
  return [out[0]!, out[1]!, out[2]!];
}

// ── 4. the decomposition ─────────────────────────────────────────────────────

/** Nearest parent atom of an element to a point (parent fractional), Å; Infinity when the parent has none. */
function nearestParentAtom(parent: StructureModel): (element: string, X: Vec3) => number {
  const G = metricTensor(parent.cell);
  const atoms = parent.sites.flatMap((s) => equivalentPositions(parent.spaceGroup.operations, s.position).map((x) => ({ element: s.element, x })));
  return (element, X) => {
    let best = Infinity;
    for (const a of atoms) {
      if (a.element !== element) continue;
      const d = minImage([X[0] - a.x[0], X[1] - a.x[1], X[2] - a.x[2]]);
      const g = mulMV(G, d);
      best = Math.min(best, Math.sqrt(d[0] * g[0] + d[1] * g[1] + d[2] * g[2]));
    }
    return best;
  };
}

/**
 * The child decomposed against the parent into modes by parent irrep (see the
 * module comment). Throws, with the reason, when no basis and origin pair
 * every undistorted site with a child site.
 */
export function decomposeChild(parent: StructureModel, child: StructureModel, opts: DecomposeOptions = {}): Decomposition {
  const tolerance = opts.tolerance ?? 1.2;
  const bases = opts.basis ? [opts.basis] : candidateBases(parent, child);
  if (bases.length === 0) throw new Error("no child basis: no parent lattice vectors match the child's cell and rotations within 12 % strain");
  const nearest = nearestParentAtom(parent);
  // Quick score of an origin: every child site's distance to the nearest parent atom of its element.
  type Candidate = { P: Mat3; p: Vec3; quick: number };
  const candidates: Candidate[] = [];
  for (const P of bases) {
    const origins = opts.origin ? [opts.origin] : candidateOrigins(parent, child, P);
    for (const p of origins) {
      let quick = 0;
      let ok = true;
      for (const s of child.sites) {
        const X = mulMV(P, s.position);
        const d = nearest(s.element, [X[0] + p[0], X[1] + p[1], X[2] + p[2]]);
        if (!(d <= tolerance)) {
          ok = false;
          break;
        }
        quick += d * d;
      }
      if (ok) candidates.push({ P, p, quick });
    }
  }
  if (candidates.length === 0) throw new Error("no child origin: no basis and origin put every child site within the tolerance of a parent atom of its element");
  candidates.sort((a, b) => a.quick - b.quick);
  let best: { P: Mat3; p: Vec3; group: FactorGroup; elements: number[]; realised: RealisedChild; pairing: Pairing } | null = null;
  let lastError = "";
  for (const c of candidates.slice(0, 12)) {
    try {
      const { group, elements, realised } = undistorted(parent, child, c.P, c.p);
      if (!sameOperations(realised.structure.spaceGroup.operations, child.spaceGroup.operations)) continue;
      const pairing = pair(realised.structure, child, tolerance);
      if (!pairing || pairing.offSite > 0.02) continue;
      if (!best || pairing.score < best.pairing.score - 1e-12) best = { P: c.P, p: c.p, group, elements, realised, pairing };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!best) throw new Error(`no basis and origin pair every parent atom with a child atom${lastError ? ` (${lastError})` : ""}`);

  const { realised, pairing, group, elements } = best;
  const ref = realised.structure;
  const modes = supercellModeBasis(parent, group, elements, realised);
  // The mode set on the undistorted child; its modes are orthonormal in the unstrained metric.
  const onRef = irrepModeSet(parent, realised, modes);
  const M = orthogonalizationMatrix(ref.cell);
  const refOps = ref.spaceGroup.operations;
  const mult = ref.sites.map((s) => siteMultiplicity(refOps, s.position));
  const deltaOf = new Map(pairing.pairs.map((o) => [ref.sites[o.ref]!.label, o.delta] as const));
  const amp = (mode: DistortionMode): number => mode.axes.reduce((t, { siteLabel, axis }) => {
    const d = deltaOf.get(siteLabel);
    const j = ref.sites.findIndex((s) => s.label === siteLabel);
    if (!d || j < 0) return t;
    const a = mulMV(M, axis);
    const b = mulMV(M, d);
    return t + mult[j]! * (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  }, 0);
  const values = new Map(onRef.modes.map((mode) => [mode.id, amp(mode)] as const));
  // What the modes leave of each displacement: rounding only.
  let residual = 0;
  ref.sites.forEach((s) => {
    const d = deltaOf.get(s.label) ?? ([0, 0, 0] as Vec3);
    const rebuilt = [0, 0, 0];
    for (const mode of onRef.modes) {
      const ax = mode.axes.find((a) => a.siteLabel === s.label);
      if (!ax) continue;
      const v = values.get(mode.id)!;
      for (let i = 0; i < 3; i++) rebuilt[i] = rebuilt[i]! + v * ax.axis[i]!;
    }
    residual = Math.max(residual, Math.hypot(...mulMV(M, [d[0] - rebuilt[0]!, d[1] - rebuilt[1]!, d[2] - rebuilt[2]!])));
  });

  // Onto the child as loaded: site L = g⁻¹·(reference site), its axes turned by W_g⁻¹.
  const childOps = child.spaceGroup.operations;
  const bySite = new Map(pairing.pairs.map((o) => [child.sites[o.site]!.label, o] as const));
  const refLabelOf = new Map(pairing.pairs.map((o) => [ref.sites[o.ref]!.label, child.sites[o.site]!.label] as const));
  const Winv = (o: { op: number }): Mat3 => inv3(childOps[o.op]!.rotation);
  const parentized: StructureModel = {
    ...child,
    sites: child.sites.map((s) => {
      const o = bySite.get(s.label);
      if (!o) return s;
      const back = mulMV(Winv(o), o.delta);
      return { ...s, position: [s.position[0] - back[0], s.position[1] - back[1], s.position[2] - back[2]] };
    }),
  };
  const parameters: RefinementParameter[] = [];
  const bindings: ParameterBinding[] = [];
  const setModes: DistortionMode[] = onRef.modes.map((mode) => {
    const v = values.get(mode.id)!;
    const axes = mode.axes.map(({ siteLabel, axis }) => {
      const label = refLabelOf.get(siteLabel)!;
      const turned = mulMV(Winv(bySite.get(label)!), axis);
      return { siteLabel: label, axis: turned.map((x) => (Math.abs(x) < 1e-12 ? 0 : x)) as unknown as Vec3 };
    });
    const active = Math.abs(v) > 1e-5;
    const param = onRef.parameters.find((p) => p.id === mode.id)!;
    parameters.push({ ...param, value: v, initialValue: v, fixed: !active });
    for (const { siteLabel, axis } of axes) bindings.push({ parameterId: mode.id, kind: "positionShift", targetId: child.id, targetKey: siteLabel, axis });
    return { ...mode, axes, observedAmplitude: v, active };
  });
  const cells = onRef.amplitudeCells!;
  const set: DistortionModeSet = {
    parentized,
    originShift: [best.p[0], best.p[1], best.p[2]],
    parameters,
    bindings,
    modes: setModes,
    totalAmplitude: Math.sqrt([...values.values()].reduce((s, v) => s + v * v, 0)),
    unpaired: pairing.unpaired,
    ...(onRef.acousticExcluded !== undefined ? { acousticExcluded: onRef.acousticExcluded } : {}),
    amplitudeCells: cells,
    ...(onRef.parent ? { parent: onRef.parent } : {}),
  };
  return {
    set,
    reference: realised,
    modes,
    basis: best.P,
    origin: best.p,
    amplitudes: setModes.map((m) => ({ id: m.id, label: m.label, a: m.observedAmplitude, as: m.observedAmplitude / Math.sqrt(cells.child), ap: m.observedAmplitude / Math.sqrt(cells.parent) })),
    residual,
    pairs: pairing.pairs.map((o) => ({ site: child.sites[o.site]!.label, reference: ref.sites[o.ref]!.label, distance: o.distance })),
    unpaired: pairing.unpaired,
  };
}

