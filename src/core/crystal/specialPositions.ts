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
 * whose images would not then fix it. A coordinate the snap would change by
 * less than EXACT keeps its printed bits, so a file already exact is read as
 * before, bit for bit.
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

/** v as the double of the nearest fraction n/48 (thirds, quarters, sixths, eighths …) when it lies within 1e-12 of one; else v. */
function onFraction(v: number): number {
  const n = Math.round(v * 48);
  if (Math.abs(v - n / 48) > 1e-12) return v;
  const d = 48 / gcd(Math.abs(n), 48);
  return (n / (48 / d)) / d;
}
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * One site's special position: the average of the images that fix it, repeated
 * while the site symmetry grows (a point near a high-symmetry position can
 * first show only part of its site symmetry within the tolerance); null when
 * the site is left as printed.
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
  // A coordinate the snap leaves where it was (a free z) keeps its printed bits, and one the average puts on a
  // fraction of small denominator (⅔) is that fraction's own double, not the average's last-bit round-off.
  x = x.map((v, i) => (Math.abs(v - position[i]!) < EXACT ? position[i]! : onFraction(v))) as unknown as Vec3;
  const shift = Math.max(...x.map((v, i) => Math.abs(v - position[i]!)));
  if (shift === 0 || shift > tol) return null;
  // The images that fixed it within the tolerance fix the snapped point (to the printed bits kept above).
  if (nearImages(ops, x, 1e-8).length !== nearImages(ops, x, tol).length) return null;
  return x;
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
