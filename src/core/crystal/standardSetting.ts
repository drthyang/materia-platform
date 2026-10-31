/**
 * The standard name of a space group given by its operations in ANY basis of
 * its lattice — here a translationengleiche subgroup written in its parent's
 * cell, which keeps every lattice translation of the parent, centring
 * included. Fm-3m's 4/mmm subgroup is F4/mmm in the cubic cell, a setting no
 * table lists; in its own conventional cell a′ = (a−b)/2, b′ = (a+b)/2,
 * c′ = c it is I4/mmm (#139). Pm-3m's subgroup that keeps a [111] axis is
 * R3m (#160) on hexagonal axes a′ = a−b, b′ = b−c, c′ = a+b+c.
 *
 * Method: the conventional cell is built from the group's OWN symmetry
 * directions (ITA A, Ch. 3.1, the conventional cells of the Bravais lattices;
 * the same idea as Bilbao's IDENTIFY GROUP, Aroyo et al., Z. Kristallogr. 221
 * (2006) 15):
 *
 *  - cubic: a, b, c along the three 4-fold axes (the 2-fold axes in 23, m-3);
 *  - tetragonal: c along the 4 or -4 axis, a the shortest lattice vector
 *    perpendicular to it and b = 4·a — a P or I cell, never C or F;
 *  - trigonal and hexagonal: c along the 3 or 6 axis, a the shortest
 *    perpendicular lattice vector and b = 3·a (120°); an R lattice is put on
 *    obverse hexagonal axes;
 *  - orthorhombic: a, b, c along the three 2-fold directions (axes, mirror
 *    normals), tried in the six axis orders;
 *  - monoclinic: b along the unique axis, a and c a reduced basis of the
 *    lattice plane perpendicular to it, tried in the six cell choices;
 *  - triclinic: a primitive cell.
 *
 * Each cell vector is the shortest vector of the group's lattice (its pure
 * translations, centring included) along its direction. The operations are
 * transformed as W′ = P⁻¹WP, w′ = P⁻¹(w + (W − I)p) (ITA A, Ch. 5.1), the
 * lattice re-expressed in the new cell (its new centring vectors), and the
 * set is matched against every tabulated setting (spaceGroupData, 564
 * settings): a reference setting is preferred, and origin shifts on a ⅛ grid
 * of the original cell are tried when no unshifted cell matches (finer grids
 * on request: a supercell child's primitive cell is larger than the parent's,
 * so the parent's ⅛ is a 1/16 or finer there).
 * "Perpendicular" and "shortest" use the metric G = Σ WᵀW, which the group
 * leaves invariant: a 3-, 4- or 6-fold axis fixes the metric of its plane up
 * to a scale, so the shortest perpendicular vector is the cell's; where the
 * metric is free (monoclinic, triclinic) any basis is a valid cell and the
 * tried cell choices cover the table's.
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { SymmetryOperation } from "@/core/crystal/types";
import { parseSymmetryOperation } from "@/core/crystal/symmetry";
import { SPACE_GROUP_DATA, type SpaceGroupData } from "@/core/crystal/spaceGroupData";
import { determinant, inverse, mulMat, mulVec, transpose } from "@/core/math/mat3";

const EPS = 1e-6;

/** The table setting a group matched, and the cell it matched in. */
export interface StandardSettingMatch {
  readonly entry: SpaceGroupData;
  /** P: the columns are the matched cell's axes in the original basis. */
  readonly basis: Mat3;
  /** The matched cell's origin in the original basis (zero when unshifted). */
  readonly origin: Vec3;
}

type V3 = [number, number, number];

const isInt = (x: number): boolean => Math.abs(x - Math.round(x)) < EPS;
const mod1 = (x: number): number => {
  const f = x - Math.floor(x);
  return f > 1 - EPS || f < EPS ? 0 : f;
};
const add = (a: Vec3, b: Vec3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const isZero = (v: Vec3): boolean => Math.abs(v[0]) < EPS && Math.abs(v[1]) < EPS && Math.abs(v[2]) < EPS;
const columns = (a: Vec3, b: Vec3, c: Vec3): Mat3 => [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];
const column = (m: Mat3, j: number): V3 => [m[0][j]!, m[1][j]!, m[2][j]!];
const neg = (m: Mat3): Mat3 => m.map((r) => r.map((x) => -x)) as unknown as Mat3;
const isIdentityMatrix = (m: Mat3): boolean => m.every((r, i) => r.every((x, j) => Math.abs(x - (i === j ? 1 : 0)) < EPS));
const rotKey = (m: Mat3): string => m.map((r) => r.map((x) => Math.round(x)).join(",")).join(";");

/** Canonical key of one operation mod the lattice: rotation and translation in 24ths. */
function opKey(rotation: Mat3, translation: Vec3): string {
  return `${rotKey(rotation)}|${translation.map((t) => Math.round(mod1(t) * 24) % 24).join(",")}`;
}

/** The group's pure translations mod 1 (its lattice's centring vectors, the zero vector first). */
export function latticeCentring(ops: readonly SymmetryOperation[]): V3[] {
  const out: V3[] = [[0, 0, 0]];
  for (const op of ops) {
    if (!isIdentityMatrix(op.rotation)) continue;
    const t: V3 = [mod1(op.translation[0]), mod1(op.translation[1]), mod1(op.translation[2])];
    if (!out.some((c) => isInt(c[0] - t[0]) && isInt(c[1] - t[1]) && isInt(c[2] - t[2]))) out.push(t);
  }
  return out;
}

const inLattice = (v: Vec3, centring: readonly Vec3[]): boolean =>
  centring.some((c) => isInt(v[0] - c[0]) && isInt(v[1] - c[1]) && isInt(v[2] - c[2]));

/** A rotation's proper part (the rotation itself, or minus a rotoinversion). */
const properPart = (w: Mat3): Mat3 => (determinant(w) < 0 ? neg(w) : w);

/** The order of a proper crystallographic rotation, from its trace. */
function properOrder(p: Mat3): number {
  const t = Math.round(p[0][0] + p[1][1] + p[2][2]);
  return t === 3 ? 1 : t === -1 ? 2 : t === 0 ? 3 : t === 1 ? 4 : t === 2 ? 6 : 0;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > EPS) [x, y] = [y, x % y];
  return x;
}

/** The axis of a proper rotation ≠ 1, as a primitive integer direction (first nonzero component positive). */
function axisOf(p: Mat3): V3 | null {
  const m = p.map((r, i) => r.map((x, j) => x - (i === j ? 1 : 0))) as unknown as Mat3;
  let best: V3 | null = null;
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
    const c = cross(m[i]!, m[j]!);
    if (!isZero(c) && (best === null || Math.abs(c[0]) + Math.abs(c[1]) + Math.abs(c[2]) > Math.abs(best[0]) + Math.abs(best[1]) + Math.abs(best[2]))) best = c;
  }
  if (!best) return null;
  const r = best.map((x) => Math.round(x)) as V3;
  const g = gcd(gcd(r[0], r[1]), r[2]) || 1;
  const v = r.map((x) => x / g) as V3;
  const lead = v.find((x) => Math.abs(x) > EPS) ?? 1;
  return lead < 0 ? scale(v, -1) : v;
}

/** The shortest lattice vector along an integer direction (the direction itself is a lattice vector). */
function shortestAlong(dir: Vec3, centring: readonly Vec3[]): V3 {
  for (let k = 1; k <= 12; k++) {
    const v = scale(dir, k / 12);
    if (inLattice(v, centring)) return v;
  }
  return [dir[0], dir[1], dir[2]];
}

/** Short lattice vectors (coefficients within ±2), shortest first in the metric g, ties broken deterministically. */
function shortVectors(centring: readonly Vec3[], g: Mat3): { v: V3; n2: number }[] {
  const out: { v: V3; n2: number }[] = [];
  const seen = new Set<string>();
  for (const c of centring) {
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        for (let k = -2; k <= 2; k++) {
          const v: V3 = [i + c[0], j + c[1], k + c[2]];
          if (isZero(v)) continue;
          const key = v.map((x) => Math.round(x * 24)).join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          const gv = mulVec(g, v);
          out.push({ v, n2: v[0] * gv[0] + v[1] * gv[1] + v[2] * gv[2] });
        }
      }
    }
  }
  const lex = (a: Vec3, b: Vec3): number => b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  return out.sort((a, b) => a.n2 - b.n2 || lex(a.v, b.v));
}

const dotG = (g: Mat3, a: Vec3, b: Vec3): number => {
  const gb = mulVec(g, b);
  return a[0] * gb[0] + a[1] * gb[1] + a[2] * gb[2];
};

/** The candidate conventional cells of a group, from its own symmetry directions. */
export function conventionalCells(ops: readonly SymmetryOperation[], options: { readonly cubicSwap?: boolean } = {}): Mat3[] {
  const rotations = new Map<string, Mat3>();
  for (const op of ops) rotations.set(rotKey(op.rotation), op.rotation);
  const rots = [...rotations.values()];
  const centring = latticeCentring(ops);
  // The group-invariant metric G = Σ WᵀW.
  let g: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const w of rots) {
    const m = mulMat(transpose(w), w);
    g = g.map((r, i) => r.map((x, j) => x + m[i]![j]!)) as unknown as Mat3;
  }
  const proper = rots.map(properPart).filter((p) => !isIdentityMatrix(p));
  const axesOfOrder = (n: number): { axis: V3; p: Mat3 }[] => {
    const out: { axis: V3; p: Mat3 }[] = [];
    for (const p of proper) {
      if (properOrder(p) !== n) continue;
      const axis = axisOf(p);
      if (axis && !out.some((o) => isZero(cross(o.axis, axis)))) out.push({ axis, p });
    }
    return out;
  };
  const right = (a: Vec3, b: Vec3, c: Vec3): Mat3 => (determinant(columns(a, b, c)) < 0 ? columns(a, b, scale(c, -1)) : columns(a, b, c));
  const short = shortVectors(centring, g);
  const perpendicular = (axis: Vec3): V3[] => short.filter(({ v }) => Math.abs(dotG(g, axis, v)) < 1e-6 * Math.max(1, dotG(g, v, v))).map(({ v }) => v);

  const threes = axesOfOrder(3);
  const fours = axesOfOrder(4);
  const sixes = axesOfOrder(6);
  const twos = axesOfOrder(2);
  const cells: Mat3[] = [];

  if (threes.length > 1) {
    // Cubic: the 4-fold axes, else (23, m-3) the 2-fold ones; kept in the original order.
    const axes = (fours.length >= 3 ? fours : twos).map((o) => o.axis);
    if (axes.length >= 3) {
      const dominant = (v: Vec3): number => [0, 1, 2].reduce((m, i) => (Math.abs(v[i]!) > Math.abs(v[m]!) ? i : m), 0);
      const sorted = [...axes].sort((u, v) => dominant(u) - dominant(v));
      const [a, b, c] = sorted.map((d) => shortestAlong(d, centring)) as [V3, V3, V3];
      // With cubicSwap, the other axis order (a, c, b): Pa-3 and Ia-3 lack the 4-fold that
      // relates their two settings, so a child can sit in the one the table does not list.
      cells.push(options.cubicSwap ? right(a, c, b) : right(a, b, c));
    }
  } else if (options.cubicSwap) {
    return [];
  } else if (threes.length === 1 || sixes.length === 1) {
    // Trigonal or hexagonal: c along the axis, a ⟂ it, b = 3·a.
    const main = sixes[0] ?? threes[0]!;
    const p3 = properOrder(main.p) === 6 ? mulMat(main.p, main.p) : main.p;
    const plane = perpendicular(main.axis);
    const a = plane[0];
    if (a) {
      const b = mulVec(p3, a) as V3;
      let cell = right(a, b, shortestAlong(main.axis, centring));
      // An R lattice on reverse axes goes to obverse: a, b → −a, −b.
      const reverse = newCentring(cell, centring).some((t) => isInt(t[0] - 1 / 3) && isInt(t[1] - 2 / 3) && isInt(t[2] - 1 / 3));
      if (reverse) cell = columns(scale(a, -1), scale(b, -1), column(cell, 2));
      cells.push(cell);
    }
  } else if (fours.length === 1) {
    // Tetragonal: c along the 4 / -4 axis, a the shortest ⟂ vector, b = 4·a.
    const main = fours[0]!;
    const a = perpendicular(main.axis)[0];
    if (a) cells.push(right(a, mulVec(main.p, a), shortestAlong(main.axis, centring)));
  } else if (twos.length === 3) {
    // Orthorhombic: the three 2-fold directions, in each of the six orders.
    const v = twos.map((o) => shortestAlong(o.axis, centring));
    for (const [i, j, k] of [[0, 1, 2], [1, 2, 0], [2, 0, 1], [1, 0, 2], [0, 2, 1], [2, 1, 0]] as const) {
      cells.push(right(v[i]!, v[j]!, v[k]!));
    }
  } else if (twos.length === 1) {
    // Monoclinic: b along the unique axis, a and c a reduced basis of the ⟂ lattice plane, in six cell choices.
    const b = shortestAlong(twos[0]!.axis, centring);
    const plane = perpendicular(twos[0]!.axis);
    const a = plane[0];
    const c = a ? plane.find((v) => !isZero(cross(a, v))) : undefined;
    if (a && c) {
      const choices: [Vec3, Vec3][] = [[a, c], [c, a], [add(a, c), c], [a, add(a, c)], [add(a, c), a], [c, add(a, c)]];
      for (const [x, z] of choices) {
        cells.push(determinant(columns(x, b, z)) < 0 ? columns(x, scale(b, -1), z) : columns(x, b, z));
      }
    }
  } else if (proper.length === 0) {
    // Triclinic: a primitive cell (three short vectors spanning one lattice point).
    const volume = 1 / centring.length;
    const pool = short.slice(0, 40).map(({ v }) => v);
    search: for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        for (let k = j + 1; k < pool.length; k++) {
          const d = determinant(columns(pool[i]!, pool[j]!, pool[k]!));
          if (Math.abs(Math.abs(d) - volume) < EPS) {
            cells.push(right(pool[i]!, pool[j]!, pool[k]!));
            break search;
          }
        }
      }
    }
  }
  return cells;
}

/** The lattice's translations mod 1 in a new cell: the old cell's axes and centring vectors re-expressed, closed under addition. */
function newCentring(basis: Mat3, centring: readonly Vec3[]): V3[] {
  const pInv = inverse(basis);
  const axes: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const gens: V3[] = [...centring, ...axes].map((t) => mulVec(pInv, t).map(mod1) as V3);
  const out: V3[] = [[0, 0, 0]];
  const has = (t: Vec3): boolean => out.some((c) => isInt(c[0] - t[0]) && isInt(c[1] - t[1]) && isInt(c[2] - t[2]));
  for (let grew = true; grew && out.length <= 24;) {
    grew = false;
    for (const a of [...out]) {
      for (const b of gens) {
        const t = add(a, b).map(mod1) as V3;
        if (!has(t)) {
          out.push(t);
          grew = true;
        }
      }
    }
  }
  return out;
}

/** The operations in a new cell (P, origin p), the lattice's translations added; null when a rotation is not integral there. */
function inCell(ops: readonly SymmetryOperation[], basis: Mat3, origin: Vec3, centring: readonly Vec3[]): { rotation: Mat3; translation: V3 }[] | null {
  const pInv = inverse(basis);
  const lattice = newCentring(basis, centring);
  if (lattice.length > 24) return null;
  const out = new Map<string, { rotation: Mat3; translation: V3 }>();
  for (const op of ops) {
    const w = op.rotation;
    const r = mulMat(pInv, mulMat(w, basis));
    if (!r.every((row) => row.every(isInt))) return null;
    const rotation = r.map((row) => row.map((x) => Math.round(x))) as unknown as Mat3;
    const shift: V3 = [
      (w[0][0] - 1) * origin[0] + w[0][1] * origin[1] + w[0][2] * origin[2] + op.translation[0],
      w[1][0] * origin[0] + (w[1][1] - 1) * origin[1] + w[1][2] * origin[2] + op.translation[1],
      w[2][0] * origin[0] + w[2][1] * origin[1] + (w[2][2] - 1) * origin[2] + op.translation[2],
    ];
    const t = mulVec(pInv, shift);
    for (const c of lattice) {
      const translation = add(t, c).map(mod1) as V3;
      const key = opKey(rotation, translation);
      if (!out.has(key)) out.set(key, { rotation, translation });
    }
  }
  return [...out.values()];
}

interface TableEntryKeys {
  readonly e: SpaceGroupData;
  readonly key: string;
  readonly rotations: string;
  readonly ops: ReadonlySet<string>;
}

const tableCache = new Map<number, TableEntryKeys[]>();
/** The table's settings with `n` operations, reference settings first, keyed once. */
function tableWithOrder(n: number): TableEntryKeys[] {
  let list = tableCache.get(n);
  if (!list) {
    list = SPACE_GROUP_DATA.filter((e) => e.ops.length === n)
      .sort((a, b) => Number(b.reference) - Number(a.reference))
      .map((e) => {
        const parsed = e.ops.map(parseSymmetryOperation);
        const keys = parsed.map((op) => opKey(op.rotation, op.translation));
        return { e, key: [...new Set(keys)].sort().join(";"), rotations: [...new Set(parsed.map((op) => rotKey(op.rotation)))].sort().join(" "), ops: new Set(keys) };
      });
    tableCache.set(n, list);
  }
  return list;
}

/**
 * The grids of origin shifts tried: ⅛ first (a subgroup of an origin-choice-2
 * group sits ⅛ off its own origin), then 1/24 (a decentred child of an R or
 * hexagonal parent can sit a third or a sixth off), the ⅛ points skipped.
 */
const ORIGIN_GRIDS = [8, 24] as const;

/**
 * The tabulated setting a group's operations match in one of its conventional
 * cells (see the module comment), a reference setting preferred; null when
 * none does. The caller tries its operations as given first (a direct match).
 */
export function standardSettingOf(
  ops: readonly SymmetryOperation[],
  options: { readonly originGrids?: readonly number[] } = {},
): StandardSettingMatch | null {
  const match = standardSettingIn(ops, options, false);
  if (match || ops.length === 0) return match;
  // Only when nothing matched: a cubic group in the other axis order (Pa-3, Ia-3).
  return standardSettingIn(ops, options, true);
}

function standardSettingIn(
  ops: readonly SymmetryOperation[],
  options: { readonly originGrids?: readonly number[] },
  cubicSwap: boolean,
): StandardSettingMatch | null {
  const grids = options.originGrids ?? ORIGIN_GRIDS;
  if (ops.length === 0) return null;
  const centring = latticeCentring(ops);
  const cells = conventionalCells(ops, { cubicSwap });
  if (cubicSwap && cells.length === 0) return null;
  const zero: Vec3 = [0, 0, 0];
  // A reference setting wins (unshifted before shifted); else the first match
  // in any setting, unshifted first.
  const found: { reference: StandardSettingMatch | null; other: StandardSettingMatch | null } = { reference: null, other: null };
  const consider = (cell: Mat3, origin: Vec3, transformed: readonly { rotation: Mat3; translation: V3 }[]): void => {
    const key = transformed.map((o) => opKey(o.rotation, o.translation)).sort().join(";");
    const hit = tableWithOrder(transformed.length).find((t) => t.key === key);
    if (!hit) return;
    const match = { entry: hit.e, basis: cell, origin };
    if (hit.e.reference) found.reference ??= match;
    else found.other ??= match;
  };
  for (const cell of cells) {
    const transformed = inCell(ops, cell, zero, centring);
    if (transformed) consider(cell, zero, transformed);
    if (found.reference) return found.reference;
  }
  // Origin shifts: screen each shift on a few operations, then match the whole set.
  const shiftedCells: { cell: Mat3; candidates: TableEntryKeys[]; probes: SymmetryOperation[] }[] = [];
  for (const cell of cells) {
    const atZero = inCell(ops, cell, zero, centring);
    if (!atZero) continue;
    const rotations = [...new Set(atZero.map((o) => rotKey(o.rotation)))].sort().join(" ");
    const candidates = tableWithOrder(atZero.length).filter((t) => t.rotations === rotations);
    if (candidates.length === 0) continue;
    const probes = ops.filter((op) => !isIdentityMatrix(op.rotation)).slice(0, 3);
    shiftedCells.push({ cell, candidates, probes });
  }
  for (const grid of grids) {
    for (const { cell, candidates, probes } of shiftedCells) {
      for (let a = 0; a < grid; a++) {
        for (let b = 0; b < grid; b++) {
          for (let c = 0; c < grid; c++) {
            if (a === 0 && b === 0 && c === 0) continue;
            // The coarser grid's points were tried already.
            if (grid !== grids[0] && grids.slice(0, grids.indexOf(grid)).some((g) => grid % g === 0 && (a * g) % grid === 0 && (b * g) % grid === 0 && (c * g) % grid === 0)) continue;
            const origin: Vec3 = [a / grid, b / grid, c / grid];
            const probe = inCell(probes, cell, origin, [[0, 0, 0]]);
            if (!probe) continue;
            const keys = probe.map((o) => opKey(o.rotation, o.translation));
            if (!candidates.some((t) => keys.every((k) => t.ops.has(k)))) continue;
            const transformed = inCell(ops, cell, origin, centring);
            if (transformed) consider(cell, origin, transformed);
            if (found.reference) return found.reference;
          }
        }
      }
    }
    if (found.other) return found.other;
  }
  return found.other;
}

/** The reference (standard) setting of an IT number. */
export function referenceSetting(number: number): SpaceGroupData | undefined {
  return SPACE_GROUP_DATA.find((e) => e.number === number && e.reference);
}

/** A cell's axes in words, e.g. "a′ = (a−b)/2, b′ = (a+b)/2, c′ = c". */
export function formatBasis(basis: Mat3): string {
  const names = ["a", "b", "c"] as const;
  const axis = (j: number): string => {
    const v = column(basis, j);
    // A common denominator over 1, 2, 3, 4, 6.
    const den = [1, 2, 3, 4, 6].find((d) => v.every((x) => isInt(x * d))) ?? 1;
    const parts: string[] = [];
    v.forEach((x, i) => {
      const n = Math.round(x * den);
      if (n === 0) return;
      const sign = n < 0 ? "−" : parts.length ? "+" : "";
      parts.push(`${sign}${Math.abs(n) === 1 ? "" : Math.abs(n)}${names[i]}`);
    });
    const sum = parts.join("") || "0";
    return den === 1 ? sum : parts.length > 1 ? `(${sum})/${den}` : `${sum}/${den}`;
  };
  return `a′ = ${axis(0)}, b′ = ${axis(1)}, c′ = ${axis(2)}`;
}
