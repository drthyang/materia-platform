/**
 * The names of k-vectors (THY-73; ADR 0004): the labels of the points and
 * lines of symmetry of the Brillouin zone in the nomenclature of Bradley &
 * Cracknell (1972) and Cracknell, Davies, Miller & Love (CDML, 1979), which
 * the Bilbao server's KVEC lists ("Δ (0, 0, ½)", "X", "A"). The table below is
 * written from that published convention, by hand, in the reciprocal basis
 * dual to the conventional cell of the ITA standard setting (KVEC's
 * "conventional basis"). Nothing is taken from Bilbao's database or from
 * ISOTROPY; the opt-in ISOTROPY oracle (kVectorNameOracle.test.ts) only
 * checks the names against ISOTROPY's own k-vector list, which uses CDML's
 * labels (ADR 0005).
 *
 * How a k is named, in the standard setting of its group (a group in another
 * setting is brought there first, standardSetting.ts; k transforms as
 * k′ = Pᵀk):
 *
 *  1. Γ at k ≡ 0;
 *  2. a point of the table when some arm of k's star is that point modulo the
 *     reciprocal lattice. KA and HA (the hexagonal −K and −H) are named only
 *     where the group does not carry K to −K (Bilbao's P321 example, its KVEC
 *     help page "examples_kvec", read 2026-11-08);
 *  3. a line of the table when some arm of k's star lies strictly inside the
 *     table's segment between the line's two end points, modulo the
 *     reciprocal lattice. As in CDML and KVEC, the holohedry's labels hold in
 *     every arithmetic class of the lattice, where a line may have become part
 *     of a plane or of the general position (KVEC's help: k-vectors with
 *     different CDML labels can be of one type, marked "ex"); so F-43m's
 *     (0, ½, ½) is Σ. A segment the group no longer relates to the
 *     holohedry's (CDML's "A" lines of the trigonal classes, the −Λ of F-43m)
 *     is left unnamed rather than guessed;
 *  4. otherwise no name (planes, general points, and the lattices below).
 *
 * Lattices named: cP, cF, cI, tP, oP, hP, and hR's points T, L and F. Not
 * named, because their CDML labels could not be written from the convention
 * with confidence (zone shapes that depend on the axial ratios, CDML's
 * monoclinic and triclinic labels): aP, mP, mC, oC (and oA), oF, oI, tI, and
 * hR's lines. A k there keeps its coordinates.
 *
 * Checked against ISOTROPY (the opt-in oracle, all 230 types, 2026-11-08): the
 * entries it contradicted were removed, not corrected from it, since it is a
 * check and not a source. They were Bradley & Cracknell's fcc line Z (X–W) and
 * the orthorhombic E and P (U–R, T–R), whose CDML labels differ from what was
 * written here. Withdrawn with them: fcc S (X–U) and bcc F (P–H), Bradley &
 * Cracknell lines that ISOTROPY does not list, since the fcc case shows CDML's
 * line labels can differ from theirs. Points and lines ISOTROPY does not list
 * because they share a k-vector type with another, but which Bilbao's KVEC
 * help or the issue names, stay as written: fcc K and U, hexagonal T, S, KA and
 * HA.
 *
 * The name does not depend on the arm passed: a line's coordinates are those
 * of the star's canonical arm (the first in starsInBound's order: the
 * smallest, then zeros in the first components), "Δ (0, 0, 1/2)".
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { SymmetryOperation } from "@/core/crystal/types";
import { settingForOperations, buildSpaceGroup, extendedSymbol } from "@/core/crystal/spaceGroups";
import { standardSettingOf } from "@/core/crystal/standardSetting";
import type { SpaceGroupData } from "@/core/crystal/spaceGroupData";
import {
  exactOp, iIsIdentity, iinv, ikey, itransMulVec, radd, rat, ratFrom, rmul, rnum, risInt, vdot, vmod1, vsub, type IMat, type Rat, type RVec,
} from "@/core/crystal/irreps/rational";

/** A k-vector's name: a point of symmetry ("X") or a line of symmetry ("Δ"). */
export interface KVectorName {
  readonly label: string;
  readonly kind: "point" | "line";
}

/** The Bravais lattice of a standard setting, as the table keys it. */
export type LatticeKey = "aP" | "mP" | "mC" | "oP" | "oC" | "oF" | "oI" | "tP" | "tI" | "hP" | "hR" | "cP" | "cF" | "cI";

type Q = readonly [number, number, number];

interface TablePoint {
  readonly label: string;
  readonly k: Q;
  /** Named only where the group does not carry this point to that one's star (KA, HA). */
  readonly unlessEquivalentTo?: Q;
}

interface TableLine {
  readonly label: string;
  readonly from: Q;
  readonly to: Q;
}

interface LatticeTable {
  readonly points: readonly TablePoint[];
  readonly lines: readonly TableLine[];
}

const G: Q = [0, 0, 0];

/**
 * The points and lines of symmetry per Bravais lattice, conventional
 * reciprocal coordinates of the ITA standard setting (Bradley & Cracknell's
 * figures and CDML's labels; see the module comment). A line runs between its
 * two end points, ends excluded.
 */
export const K_VECTOR_TABLES: Readonly<Partial<Record<LatticeKey, LatticeTable>>> = {
  cP: {
    points: [
      { label: "X", k: [0, 1 / 2, 0] },
      { label: "M", k: [1 / 2, 1 / 2, 0] },
      { label: "R", k: [1 / 2, 1 / 2, 1 / 2] },
    ],
    lines: [
      { label: "Δ", from: G, to: [0, 1 / 2, 0] },
      { label: "Σ", from: G, to: [1 / 2, 1 / 2, 0] },
      { label: "Λ", from: G, to: [1 / 2, 1 / 2, 1 / 2] },
      { label: "Z", from: [0, 1 / 2, 0], to: [1 / 2, 1 / 2, 0] },
      { label: "S", from: [0, 1 / 2, 0], to: [1 / 2, 1 / 2, 1 / 2] },
      { label: "T", from: [1 / 2, 1 / 2, 0], to: [1 / 2, 1 / 2, 1 / 2] },
    ],
  },
  cF: {
    points: [
      { label: "X", k: [0, 1, 0] },
      { label: "L", k: [1 / 2, 1 / 2, 1 / 2] },
      { label: "W", k: [1 / 2, 1, 0] },
      { label: "K", k: [3 / 4, 3 / 4, 0] },
      { label: "U", k: [1 / 4, 1, 1 / 4] },
    ],
    lines: [
      { label: "Δ", from: G, to: [0, 1, 0] },
      { label: "Λ", from: G, to: [1 / 2, 1 / 2, 1 / 2] },
      { label: "Σ", from: G, to: [3 / 4, 3 / 4, 0] },
      { label: "Q", from: [1 / 2, 1 / 2, 1 / 2], to: [1 / 2, 1, 0] },
    ],
  },
  cI: {
    points: [
      { label: "H", k: [0, 1, 0] },
      { label: "N", k: [1 / 2, 1 / 2, 0] },
      { label: "P", k: [1 / 2, 1 / 2, 1 / 2] },
    ],
    lines: [
      { label: "Δ", from: G, to: [0, 1, 0] },
      { label: "Σ", from: G, to: [1 / 2, 1 / 2, 0] },
      { label: "Λ", from: G, to: [1 / 2, 1 / 2, 1 / 2] },
      { label: "D", from: [1 / 2, 1 / 2, 0], to: [1 / 2, 1 / 2, 1 / 2] },
      { label: "G", from: [0, 1, 0], to: [1 / 2, 1 / 2, 0] },
    ],
  },
  tP: {
    points: [
      { label: "Z", k: [0, 0, 1 / 2] },
      { label: "X", k: [0, 1 / 2, 0] },
      { label: "M", k: [1 / 2, 1 / 2, 0] },
      { label: "R", k: [0, 1 / 2, 1 / 2] },
      { label: "A", k: [1 / 2, 1 / 2, 1 / 2] },
    ],
    lines: [
      { label: "Δ", from: G, to: [0, 1 / 2, 0] },
      { label: "Σ", from: G, to: [1 / 2, 1 / 2, 0] },
      { label: "Y", from: [0, 1 / 2, 0], to: [1 / 2, 1 / 2, 0] },
      { label: "Λ", from: G, to: [0, 0, 1 / 2] },
      { label: "V", from: [1 / 2, 1 / 2, 0], to: [1 / 2, 1 / 2, 1 / 2] },
      { label: "W", from: [0, 1 / 2, 0], to: [0, 1 / 2, 1 / 2] },
      { label: "U", from: [0, 0, 1 / 2], to: [0, 1 / 2, 1 / 2] },
      { label: "S", from: [0, 0, 1 / 2], to: [1 / 2, 1 / 2, 1 / 2] },
      { label: "T", from: [0, 1 / 2, 1 / 2], to: [1 / 2, 1 / 2, 1 / 2] },
    ],
  },
  oP: {
    points: [
      { label: "X", k: [1 / 2, 0, 0] },
      { label: "Y", k: [0, 1 / 2, 0] },
      { label: "Z", k: [0, 0, 1 / 2] },
      { label: "S", k: [1 / 2, 1 / 2, 0] },
      { label: "U", k: [1 / 2, 0, 1 / 2] },
      { label: "T", k: [0, 1 / 2, 1 / 2] },
      { label: "R", k: [1 / 2, 1 / 2, 1 / 2] },
    ],
    lines: [
      { label: "Σ", from: G, to: [1 / 2, 0, 0] },
      { label: "Δ", from: G, to: [0, 1 / 2, 0] },
      { label: "Λ", from: G, to: [0, 0, 1 / 2] },
      { label: "D", from: [1 / 2, 0, 0], to: [1 / 2, 1 / 2, 0] },
      { label: "C", from: [0, 1 / 2, 0], to: [1 / 2, 1 / 2, 0] },
      { label: "A", from: [0, 0, 1 / 2], to: [1 / 2, 0, 1 / 2] },
      { label: "B", from: [0, 0, 1 / 2], to: [0, 1 / 2, 1 / 2] },
      { label: "G", from: [1 / 2, 0, 0], to: [1 / 2, 0, 1 / 2] },
      { label: "H", from: [0, 1 / 2, 0], to: [0, 1 / 2, 1 / 2] },
      { label: "Q", from: [1 / 2, 1 / 2, 0], to: [1 / 2, 1 / 2, 1 / 2] },
    ],
  },
  hP: {
    points: [
      { label: "A", k: [0, 0, 1 / 2] },
      { label: "K", k: [1 / 3, 1 / 3, 0] },
      { label: "H", k: [1 / 3, 1 / 3, 1 / 2] },
      { label: "M", k: [1 / 2, 0, 0] },
      { label: "L", k: [1 / 2, 0, 1 / 2] },
      { label: "KA", k: [2 / 3, -1 / 3, 0], unlessEquivalentTo: [1 / 3, 1 / 3, 0] },
      { label: "HA", k: [2 / 3, -1 / 3, 1 / 2], unlessEquivalentTo: [1 / 3, 1 / 3, 1 / 2] },
    ],
    lines: [
      { label: "Δ", from: G, to: [0, 0, 1 / 2] },
      { label: "Σ", from: G, to: [1 / 2, 0, 0] },
      { label: "Λ", from: G, to: [1 / 3, 1 / 3, 0] },
      { label: "T", from: [1 / 3, 1 / 3, 0], to: [1 / 2, 0, 0] },
      { label: "P", from: [1 / 3, 1 / 3, 0], to: [1 / 3, 1 / 3, 1 / 2] },
      { label: "U", from: [1 / 2, 0, 0], to: [1 / 2, 0, 1 / 2] },
      { label: "R", from: [0, 0, 1 / 2], to: [1 / 2, 0, 1 / 2] },
      { label: "Q", from: [0, 0, 1 / 2], to: [1 / 3, 1 / 3, 1 / 2] },
      { label: "S", from: [1 / 3, 1 / 3, 1 / 2], to: [1 / 2, 0, 1 / 2] },
    ],
  },
  hR: {
    points: [
      { label: "T", k: [0, 0, 3 / 2] },
      { label: "L", k: [1 / 2, 0, 1 / 2] },
      { label: "F", k: [0, 1 / 2, 1] },
    ],
    lines: [],
  },
};

/** The Bravais lattice of a tabulated standard setting. */
export function latticeOf(entry: SpaceGroupData): LatticeKey {
  const n = entry.number;
  const c = entry.hm.trim()[0]!;
  if (n <= 2) return "aP";
  if (n <= 15) return c === "P" ? "mP" : "mC";
  if (n <= 74) return c === "P" ? "oP" : c === "F" ? "oF" : c === "I" ? "oI" : "oC";
  if (n <= 142) return c === "P" ? "tP" : "tI";
  if (n <= 194) return c === "R" ? "hR" : "hP";
  return c === "P" ? "cP" : c === "F" ? "cF" : "cI";
}

/** A group's standard setting, as the names need it. */
export interface KVectorContext {
  readonly lattice: LatticeKey;
  /** The rotations of the standard setting (integer, conventional basis). */
  readonly rotations: readonly IMat[];
  /** Its centring vectors (zero first). */
  readonly centrings: readonly RVec[];
  /** Pᵀ, exact: k in the standard setting is toStandard·k; null when the group is in it already. */
  readonly toStandard: readonly (readonly Rat[])[] | null;
}

const contextCache = new Map<string, KVectorContext | null>();

function rotationsAndCentrings(ops: readonly SymmetryOperation[]): { rotations: IMat[]; centrings: RVec[] } {
  const exact = ops.map(exactOp);
  const rotations: IMat[] = [];
  const seen = new Set<string>();
  const centrings: RVec[] = [[rat(0), rat(0), rat(0)]];
  for (const e of exact) {
    const key = ikey(e.W);
    if (!seen.has(key)) {
      seen.add(key);
      rotations.push(e.W);
    }
    if (iIsIdentity(e.W)) {
      const c = vmod1(e.w);
      if (!centrings.some((q) => vsub(q, c).every((x) => x.n === 0))) centrings.push(c);
    }
  }
  return { rotations, centrings };
}

/**
 * The standard setting of a group given by its operations, with the map of k
 * into it, or null when no ITA reference setting matches (then nothing is
 * named but Γ). Cached by the operation set.
 */
export function kVectorContext(ops: readonly SymmetryOperation[]): KVectorContext | null {
  const key = ops.map((op) => op.xyz).sort().join(";");
  if (contextCache.has(key)) return contextCache.get(key)!;
  let context: KVectorContext | null = null;
  try {
    const direct = settingForOperations(ops);
    if (direct?.reference) {
      context = { lattice: latticeOf(direct), ...rotationsAndCentrings(ops), toStandard: null };
    } else {
      const match = standardSettingOf(ops);
      if (match?.entry.reference) {
        const std = buildSpaceGroup(extendedSymbol(match.entry)).operations;
        const P: Mat3 = match.basis;
        const toStandard = [0, 1, 2].map((j) => [0, 1, 2].map((i) => ratFrom(P[i]![j]!, 48)));
        context = { lattice: latticeOf(match.entry), ...rotationsAndCentrings(std), toStandard };
      }
    }
  } catch {
    context = null;
  }
  contextCache.set(key, context);
  return context;
}

const rq = (q: Q): RVec => [ratFrom(q[0], 48), ratFrom(q[1], 48), ratFrom(q[2], 48)];
const rotate = (W: IMat, k: RVec): RVec => itransMulVec(iinv(W), k);

/** k − k′ in the reciprocal lattice of a lattice with these centrings. */
function equivalent(centrings: readonly RVec[], k: RVec, kp: RVec): boolean {
  const d = vsub(k, kp);
  if (!d.every(risInt)) return false;
  return centrings.every((c) => risInt(vdot(d, c)));
}

const inStar = (ctx: KVectorContext, p: RVec, k: RVec): boolean => ctx.rotations.some((W) => equivalent(ctx.centrings, rotate(W, p), k));

/** True when q lies strictly between a and b modulo the reciprocal lattice. */
function onSegment(centrings: readonly RVec[], q: RVec, a: RVec, b: RVec): boolean {
  const r0 = vsub(q, a);
  const d = vsub(b, a);
  const j = d.findIndex((x) => x.n !== 0);
  if (j < 0) return false;
  // q − a − t·d = g with g in the reciprocal lattice and 0 < t < 1: g_j lies strictly between r0_j − d_j and r0_j.
  const lo = Math.min(rnum(r0[j]!) - rnum(d[j]!), rnum(r0[j]!));
  const hi = Math.max(rnum(r0[j]!) - rnum(d[j]!), rnum(r0[j]!));
  for (let gj = Math.ceil(lo - 1e-9); gj <= Math.floor(hi + 1e-9); gj++) {
    // t = (r0_j − g_j)/d_j, exactly.
    const t = rmul(radd(r0[j]!, rat(-gj)), rat(d[j]!.d, d[j]!.n));
    if (t.n <= 0 || t.n >= t.d) continue;
    const g: RVec = [0, 1, 2].map((i) => radd(r0[i]!, rmul(rat(-t.n, t.d), d[i]!))) as unknown as RVec;
    if (equivalent(centrings, g, [rat(0), rat(0), rat(0)])) return true;
  }
  return false;
}

/** k (the group's own setting) in the standard setting. */
function toStandard(ctx: KVectorContext, k: RVec): RVec {
  if (!ctx.toStandard) return k;
  const T = ctx.toStandard;
  return [0, 1, 2].map((j) => radd(radd(rmul(T[j]![0]!, k[0]), rmul(T[j]![1]!, k[1])), rmul(T[j]![2]!, k[2]))) as unknown as RVec;
}

/**
 * The name of k (in the group's own setting, conventional reciprocal basis)
 * in the nomenclature of the module comment, or null when it has none here.
 */
export function kVectorName(ctx: KVectorContext | null, k: RVec): KVectorName | null {
  if (!ctx) return k.every((x) => x.n === 0) ? { label: "Γ", kind: "point" } : null;
  const ks = toStandard(ctx, k);
  const zero: RVec = [rat(0), rat(0), rat(0)];
  if (equivalent(ctx.centrings, ks, zero)) return { label: "Γ", kind: "point" };
  const table = K_VECTOR_TABLES[ctx.lattice];
  if (!table) return null;
  for (const p of table.points) {
    const pk = rq(p.k);
    if (!inStar(ctx, pk, ks)) continue;
    if (p.unlessEquivalentTo && inStar(ctx, rq(p.unlessEquivalentTo), pk)) continue;
    return { label: p.label, kind: "point" };
  }
  for (const line of table.lines) {
    const a = rq(line.from);
    const b = rq(line.to);
    if (ctx.rotations.some((W) => onSegment(ctx.centrings, rotate(W, ks), a, b))) return { label: line.label, kind: "line" };
  }
  return null;
}

/**
 * The canonical arm of k's star (the group's own setting): of the arms and
 * their translates by the reciprocal lattice with every component in [−1, 2],
 * the first in starsInBound's order (the smallest Σ|kᵢ|, then the smaller
 * |k₁|, |k₂|, |k₃|, then the positive component), whatever the bound.
 */
export function canonicalStarArm(rotations: readonly IMat[], centrings: readonly RVec[], k: RVec): RVec {
  const arms: RVec[] = [];
  for (const W of rotations) {
    const q = rotate(W, k);
    if (!arms.some((x) => equivalent(centrings, x, q))) arms.push(q);
  }
  const order = (q: RVec): number[] => [q.reduce((s, x) => s + Math.abs(rnum(x)), 0), ...q.map((x) => Math.abs(rnum(x))), ...q.map((x) => -rnum(x))];
  const less = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 1e-12) return a[i]! < b[i]!;
    return false;
  };
  let best: { q: RVec; o: number[] } | null = null;
  for (const arm of arms) {
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let c = -3; c <= 3; c++) {
      const g: RVec = [rat(a), rat(b), rat(c)];
      if (!centrings.every((t) => risInt(vdot(g, t)))) continue;
      const q: RVec = [radd(arm[0], g[0]), radd(arm[1], g[1]), radd(arm[2], g[2])];
      if (q.some((x) => rnum(x) < -1 - 1e-12 || rnum(x) > 2 + 1e-12)) continue;
      const o = order(q);
      if (!best || less(o, best.o)) best = { q, o };
    }
  }
  return best ? best.q : k;
}

/** A k-vector's name as the app writes it: "X" for a point, "Δ (0, 0, 1/2)" for a line (the canonical arm's coordinates). */
export function kVectorDisplayName(name: KVectorName, canonicalArm: Vec3, format: (k: Vec3) => string): string {
  return name.kind === "point" ? name.label : `${name.label} ${format(canonicalArm)}`;
}
