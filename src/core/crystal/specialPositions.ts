/**
 * Snap on load: each site moved onto its exact special position.
 *
 * A structure file prints coordinates rounded (Ga at 0.3333, 0.6667; a coupled
 * coordinate such as Mn's y = 2x to four decimals). The engine reads such a
 * site as special at 1e-3 (equivalentPositions, siteMultiplicity, the site
 * constraints), but a coordinate that is only close to the special position
 * leaves the operations mapping the atom onto a point 1e-4 away, and code that
 * needs exact geometry (the supercell mode basis matches images at 1e-6) finds
 * no atom there. Snapping once, when the file is read, gives every path one
 * exact geometry.
 *
 * The site symmetry is the operations that fix the site within SNAP_TOLERANCE,
 * the engine's own 1e-3 (fractional, per coordinate, modulo the lattice); the
 * snapped position is their average (each image taken at the lattice copy
 * nearest the site), which is the point of the special position nearest the
 * printed one (the average of a finite group of isometries is the orthogonal
 * projection onto its fixed set). So a site is snapped exactly when the
 * engine already counts it as special: a free site whose images all lie 1e-3
 * or more away (one that only lies near a special position) is left as
 * printed, as is a site the average would move by more than the tolerance or
 * whose images would not then fix it. The coordinates the site symmetry fixes
 * or ties are written from its exact constraints (x = ¼, y = 2x, y = x + ½), so
 * the snapped point is on the special position in floating point, not only to
 * round-off. A site the snap would change by less than EXACT, and a free
 * coordinate the average leaves within EXACT, keep their printed bits, so a
 * file already exact is read as before, bit for bit.
 */
import { applyOperation } from "@/core/crystal/symmetry";
import type { Vec3 } from "@/core/math/types";
import type { AtomSite, StructureModel, SymmetryOperation, UnitCell } from "@/core/crystal/types";

/** The engine's special-position tolerance (fractional, per coordinate): equivalentPositions', siteIsFixed's. */
export const SNAP_TOLERANCE = 1e-3;
/** A coordinate the snap would change by less than this (fractional) is already exact and keeps its printed bits. */
const EXACT = 1e-9;

/** A site moved onto its special position. */
export interface SiteSnap {
  readonly label: string;
  readonly from: Vec3;
  readonly to: Vec3;
  /** The largest fractional change of a coordinate. */
  readonly shift: number;
  /** The move in Å. */
  readonly shiftAngstrom: number;
}

/** The operations' images of `x` that lie within `tol` of it, each at the lattice copy nearest `x`. */
function nearImages(ops: readonly SymmetryOperation[], x: Vec3, tol: number): Vec3[] {
  const out: Vec3[] = [];
  for (const op of ops) {
    const y = applyOperation(op, x);
    const lifted: [number, number, number] = [0, 0, 0];
    let ok = true;
    for (let i = 0; i < 3; i++) {
      const v = y[i]! + Math.round(x[i]! - y[i]!);
      if (Math.abs(v - x[i]!) > tol) { ok = false; break; }
      lifted[i] = v;
    }
    if (ok) out.push(lifted);
  }
  return out;
}

const mean = (pts: readonly Vec3[]): Vec3 => {
  const s: [number, number, number] = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) s[i]! += p[i]!;
  return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
};

/** The length in Å of a fractional step d. */
function angstrom(cell: UnitCell, d: Vec3): number {
  const rad = Math.PI / 180;
  const ca = Math.cos(cell.alpha * rad), cb = Math.cos(cell.beta * rad), cg = Math.cos(cell.gamma * rad);
  const [x, y, z] = [d[0] * cell.a, d[1] * cell.b, d[2] * cell.c];
  return Math.sqrt(Math.max(0, x * x + y * y + z * z + 2 * x * y * cg + 2 * x * z * cb + 2 * y * z * ca));
}

/** A rational n/d (d > 0, reduced), for the special-position constraints solved exactly. */
type Q = readonly [number, number];
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const q = (n: number, d = 1): Q => {
  const g = gcd(n, d) || 1;
  return d < 0 ? [-n / g, -d / g] : [n / g, d / g];
};
const sub = (a: Q, b: Q): Q => q(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a: Q, b: Q): Q => q(a[0] * b[0], a[1] * b[1]);
const div = (a: Q, b: Q): Q => q(a[0] * b[1], a[1] * b[0]);
/** The translations of the space groups the engine reads are multiples of 1/48 (halves, thirds, quarters, sixths, eighths, twelfths). */
const DENOMINATOR = 48;

/**
 * The site's special position as exact relations, x_i = c_i + Σ_j a_ij x_j over
 * the free coordinates j: the operations that fix `x` (within `tol`, each with
 * the lattice shift that brings its image back) give (R − I)·x = −(t + n), solved
 * in rationals. A coordinate the stabilizer fixes is a constant (¼, ⅓ …); a tied
 * one (y = 2x, y = x + ½) is written through a free one. Null when a translation
 * is not a multiple of 1/48 or the constraints disagree (left to the average).
 */
function constraintsAt(ops: readonly SymmetryOperation[], x: Vec3, tol: number): { readonly free: readonly boolean[]; readonly rows: ReadonlyArray<{ readonly pivot: number; readonly c: Q; readonly a: readonly Q[] }> } | null {
  const rows: Q[][] = [];
  for (const op of ops) {
    const y = applyOperation(op, x);
    const n = [0, 1, 2].map((i) => Math.round(x[i]! - y[i]!));
    if ([0, 1, 2].some((i) => Math.abs(y[i]! + n[i]! - x[i]!) > tol)) continue;
    for (let i = 0; i < 3; i++) {
      const coef = [0, 1, 2].map((j) => op.rotation[i]![j]! - (i === j ? 1 : 0));
      const t = (op.translation[i]! + n[i]!) * DENOMINATOR;
      if (Math.abs(t - Math.round(t)) > 1e-9 || coef.some((v) => !Number.isInteger(v))) return null;
      if (coef.every((v) => v === 0)) continue;
      rows.push([...coef.map((v) => q(v)), q(-Math.round(t), DENOMINATOR)]);
    }
  }
  // Reduced row echelon form, in rationals.
  const pivots: number[] = [];
  let r = 0;
  for (let col = 0; col < 3 && r < rows.length; col++) {
    const k = rows.findIndex((row, i) => i >= r && row[col]![0] !== 0);
    if (k < 0) continue;
    [rows[r], rows[k]] = [rows[k]!, rows[r]!];
    const lead = rows[r]![col]!;
    rows[r] = rows[r]!.map((v) => div(v, lead));
    for (let i = 0; i < rows.length; i++) {
      if (i === r || rows[i]![col]![0] === 0) continue;
      const f = rows[i]![col]!;
      rows[i] = rows[i]!.map((v, j) => sub(v, mul(f, rows[r]![j]!)));
    }
    pivots.push(col);
    r++;
  }
  // A row 0 = c ≠ 0: the images that fix x within the tolerance fix no common point.
  if (rows.slice(r).some((row) => row[3]![0] !== 0)) return null;
  const free = [0, 1, 2].map((j) => !pivots.includes(j));
  return {
    free,
    rows: pivots.map((pivot, i) => ({ pivot, c: rows[i]![3]!, a: [0, 1, 2].map((j) => (free[j] ? q(-rows[i]![j]![0], rows[i]![j]![1]) : q(0))) })),
  };
}

/**
 * One site's special position: the average of the images that fix it, repeated
 * while the site symmetry grows (a point near a high-symmetry position can
 * first show only part of its site symmetry within the tolerance); null when
 * the site is left as printed. The average gives the free coordinates; the
 * coordinates the site symmetry fixes or ties are then written from the exact
 * constraints, so ¼ is 0.25, ⅓ is the double nearest ⅓, and y = x + ½ holds
 * as computed in floating point, not to the average's last-bit round-off.
 */
export function specialPositionOf(ops: readonly SymmetryOperation[], position: Vec3, tol = SNAP_TOLERANCE): Vec3 | null {
  let x = position;
  let count = 0;
  for (let round = 0; round < 6; round++) {
    const images = nearImages(ops, x, tol);
    const next = mean(images);
    const settled = images.length === count && Math.max(...next.map((v, i) => Math.abs(v - x[i]!))) < 1e-15;
    count = images.length;
    x = next;
    if (settled) break;
  }
  const exact = constraintsAt(ops, x, tol);
  if (!exact) return null;
  // A free coordinate the average leaves where it was (a free z) keeps its printed bits.
  const out = x.map((v, i) => (exact.free[i] && Math.abs(v - position[i]!) < EXACT ? position[i]! : v)) as [number, number, number];
  for (const { pivot, c, a } of exact.rows) {
    let v = c[0] / c[1];
    for (let j = 0; j < 3; j++) if (a[j]![0] !== 0) v += (a[j]![0] / a[j]![1]) * out[j]!;
    out[pivot] = v;
  }
  const shift = Math.max(...out.map((v, i) => Math.abs(v - position[i]!)));
  // A site the snap would move by less than EXACT is already exact: its printed bits are kept.
  if (shift < EXACT || shift > tol) return null;
  // The images that fixed it within the tolerance fix the snapped point.
  if (nearImages(ops, out, 1e-8).length !== nearImages(ops, out, tol).length) return null;
  return out;
}

/**
 * The exact special position a site's coordinates stand for, by the same rule
 * as the snap on load (specialPositionOf): a rounded coordinate (GaTa4Se8's Se
 * at 0.384737, 0.884736, 0.884736 on 16e) is put exactly on its special
 * position; a general position, an exact special one, or a site the snap leaves
 * as printed comes back unchanged, bit for bit. The subgroup engine calls it on
 * each parent site (coreCell, realiseChild), so a structure built or restored
 * without the snap still gives one exact geometry to the T″ cell, the realised
 * child and its modes, which match atoms at 1e-6.
 */
export function exactSitePosition(ops: readonly SymmetryOperation[], position: Vec3): Vec3 {
  return specialPositionOf(ops, position) ?? position;
}

/** The structure with each site on its exact special position, and the sites moved. */
export function snapToSpecialPositions(structure: StructureModel, tol = SNAP_TOLERANCE): { readonly structure: StructureModel; readonly snapped: readonly SiteSnap[] } {
  const ops = structure.spaceGroup.operations;
  if (ops.length <= 1) return { structure, snapped: [] };
  const snapped: SiteSnap[] = [];
  const sites = structure.sites.map((site): AtomSite => {
    const to = specialPositionOf(ops, site.position, tol);
    if (!to) return site;
    const d: Vec3 = [to[0] - site.position[0], to[1] - site.position[1], to[2] - site.position[2]];
    snapped.push({ label: site.label, from: site.position, to, shift: Math.max(...d.map(Math.abs)), shiftAngstrom: angstrom(structure.cell, d) });
    return { ...site, position: to };
  });
  return snapped.length === 0 ? { structure, snapped } : { structure: { ...structure, sites }, snapped };
}
