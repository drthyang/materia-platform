/**
 * The cell's standard uncertainties as the structure file gives them
 * (SHELXL's ZERR, a CIF's su). They come from the diffractometer's own
 * refinement of the cell, which a single-crystal fit to F² holds fixed, and
 * they enter what is derived from the cell the way SHELXL takes them: each
 * independent cell parameter moved by its esd, the lengths and angles the
 * lattice holds equal moving together (a and b of a tetragonal, trigonal or
 * hexagonal cell; a, b and c of a cubic or rhombohedral one), the effects
 * added in quadrature.
 */

import type { SymmetryOperation, UnitCell } from "@/core/crystal/types";
import { cellVolume } from "@/core/crystal/unitCell";

/** The esds of a cell's lengths (Å) and angles (°); a parameter without one (or 0) is exact or held by symmetry. */
export type CellSu = Partial<Record<keyof UnitCell, number>>;

const LENGTHS = ["a", "b", "c"] as const;
const ANGLES = ["alpha", "beta", "gamma"] as const;

/** A rotation's proper part and its axis (integer direction), for an order of 3, 4 or 6; null otherwise. */
function highOrderAxis(rotation: SymmetryOperation["rotation"]): [number, number, number] | null {
  const R = rotation.map((row) => row.map((v) => Math.round(v)));
  const det = R[0]![0]! * (R[1]![1]! * R[2]![2]! - R[1]![2]! * R[2]![1]!) - R[0]![1]! * (R[1]![0]! * R[2]![2]! - R[1]![2]! * R[2]![0]!) + R[0]![2]! * (R[1]![0]! * R[2]![1]! - R[1]![1]! * R[2]![0]!);
  const P = det < 0 ? R.map((row) => row.map((v) => -v)) : R;
  const trace = P[0]![0]! + P[1]![1]! + P[2]![2]!;
  // 1 + 2cos(2π/n): 0 for a 3-fold, 1 for a 4-fold, 2 for a 6-fold.
  if (trace < 0 || trace > 2) return null;
  const M = P.map((row, i) => row.map((v, j) => v - (i === j ? 1 : 0)));
  // The axis is the null vector of P − I: the cross product of two independent rows.
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const u = M[i]!;
      const w = M[j]!;
      const v: [number, number, number] = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      if (v.some((x) => x !== 0)) return v;
    }
  }
  return null;
}

/**
 * The cell's independent parameters, each a group of the lengths or angles
 * the lattice holds equal: from the space group's 3-, 4- and 6-fold axes, an
 * axis along one edge ties the other two edges, one along a body diagonal
 * ties all three edges and all three angles.
 */
export function cellParameterGroups(operations: readonly SymmetryOperation[]): (keyof UnitCell)[][] {
  const parent = new Map<keyof UnitCell, keyof UnitCell>([...LENGTHS, ...ANGLES].map((k) => [k, k]));
  const find = (k: keyof UnitCell): keyof UnitCell => (parent.get(k) === k ? k : find(parent.get(k)!));
  const tie = (x: keyof UnitCell, y: keyof UnitCell): void => {
    const [rx, ry] = [find(x), find(y)];
    if (rx !== ry) parent.set(ry, rx);
  };
  for (const op of operations) {
    const v = highOrderAxis(op.rotation);
    if (!v) continue;
    const nonzero = v.map((x) => x !== 0);
    if (nonzero.filter(Boolean).length === 1) {
      const along = nonzero.indexOf(true);
      const [p, q] = LENGTHS.filter((_, i) => i !== along);
      tie(p!, q!);
    } else if (nonzero.every(Boolean) && Math.abs(v[0]) === Math.abs(v[1]) && Math.abs(v[1]) === Math.abs(v[2])) {
      tie("a", "b");
      tie("a", "c");
      tie("alpha", "beta");
      tie("alpha", "gamma");
    }
  }
  const groups = new Map<keyof UnitCell, (keyof UnitCell)[]>();
  for (const k of [...LENGTHS, ...ANGLES]) groups.set(find(k), [...(groups.get(find(k)) ?? []), k]);
  return [...groups.values()];
}

/** The cell with every independent parameter moved by its esd, one at a time: the shifts a derived quantity's esd is read from. */
export function cellSuShifts(cell: UnitCell, su: CellSu, operations: readonly SymmetryOperation[]): UnitCell[] {
  const out: UnitCell[] = [];
  for (const group of cellParameterGroups(operations)) {
    const e = group.map((k) => su[k]).find((v) => v !== undefined && v > 0);
    if (e === undefined) continue;
    const moved: Record<keyof UnitCell, number> = { ...cell };
    for (const k of group) moved[k] = cell[k] + e;
    out.push(moved);
  }
  return out;
}

/** The volume's esd from the cell's, or undefined when the cell has none. */
export function cellVolumeEsd(cell: UnitCell, su: CellSu | undefined, operations: readonly SymmetryOperation[]): number | undefined {
  if (!su) return undefined;
  const shifts = cellSuShifts(cell, su, operations);
  if (shifts.length === 0) return undefined;
  const v = cellVolume(cell);
  return Math.sqrt(shifts.reduce((sum, c) => sum + (cellVolume(c) - v) ** 2, 0));
}
