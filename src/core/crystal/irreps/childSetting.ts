/**
 * The name of a child group of the factor group F = G/T″ in ITA standard
 * setting, with its child basis (P_H, p_H) from the parent's cell (ADR 0003;
 * GLOSSARY "Child basis"; docs/research/SUBGROUP_ENGINES.md §1.3–1.4).
 *
 *  - A child that keeps the conventional cell's translations (every t ∈ ℤ³)
 *    is named as Phase 1 names it: its operations in the parent's cell,
 *    modulo ℤ³ (identifySubgroup, standard).
 *  - A cell-multiplying child is first written in a primitive cell of its
 *    own lattice T_H — the Hermite basis of T_H, reduced in the parent's
 *    metric — where its translations are ℤ³; its conventional cell and
 *    origin are then found from its own symmetry (standardSettingOf, with
 *    origin grids down to 1/48 of that cell), and the two transformations
 *    compose: P_H = B·P_std, p_H = B·p_std.
 *
 * (P_H, p_H) follows ITA and Bilbao: the child's axes are the columns of P_H
 * in the parent's basis, its origin p_H in the parent's coordinates.
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { SymmetryOperation } from "@/core/crystal/types";
import { formatOperationXyz } from "@/core/crystal/symmetry";
import { classifyPointGroup } from "@/core/crystal/pointGroup";
import { extendedSymbol } from "@/core/crystal/spaceGroups";
import { identifySubgroup, type SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { standardSettingOf } from "@/core/crystal/standardSetting";
import type { FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { iIsIdentity, rnum } from "@/core/crystal/irreps/rational";
import { hnf, inLattice, scaleVec, type Hnf, type IVec } from "@/core/crystal/irreps/supercell";

/** The lattice T_H of a subgroup (scaled), from its pure translations and the core. */
export function subgroupLattice(group: FactorGroup, elements: readonly number[]): Hnf {
  const { core, D } = group.bound;
  const gens: IVec[] = [core[0], core[1], core[2]];
  for (const i of elements) {
    const e = group.elements[i]!;
    if (iIsIdentity(e.W)) gens.push(scaleVec(e.w, D));
  }
  return hnf(gens);
}

/** True when the subgroup keeps every translation of the conventional cell (ℤ³ ⊆ T_H). */
export function keepsConventionalCell(group: FactorGroup, elements: readonly number[]): boolean {
  const h = subgroupLattice(group, elements);
  const D = group.bound.D;
  return [0, 1, 2].every((i) => inLattice(h, [i === 0 ? D : 0, i === 1 ? D : 0, i === 2 ? D : 0]));
}

/** The operations of a same-cell subgroup modulo ℤ³ (one per element of G/ℤ³). */
function operationsModCell(group: FactorGroup, elements: readonly number[]): SymmetryOperation[] {
  const seen = new Set<string>();
  const out: SymmetryOperation[] = [];
  for (const i of elements) {
    const op = group.operations[i]!;
    const t = op.translation.map((x) => ((x % 1) + 1) % 1) as unknown as Vec3;
    const key = `${op.rotation.flat().join(",")}|${t.map((x) => Math.round(x * 48)).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i < group.parentOperations.length ? group.parentOperations[i]! : { rotation: op.rotation, translation: [t[0], t[1], t[2]], xyz: formatOperationXyz(op.rotation, [t[0], t[1], t[2]]) });
  }
  return out;
}

/** The parent's invariant metric Σ WᵀW over its rotations (conventional basis). */
function parentMetric(group: FactorGroup): number[][] {
  const g = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const seen = new Set<string>();
  for (const e of group.elements) {
    const key = e.W.flat().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) g[i]![j]! += e.W[k]![i]! * e.W[k]![j]!;
  }
  return g;
}

/** A reduced basis of the lattice in the metric g: pairwise size reduction until no vector shortens, then sorted by length. */
function reduceBasis(h: Hnf, g: number[][]): IVec[] {
  const dot = (a: IVec, b: IVec): number => {
    let s = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += a[i]! * g[i]![j]! * b[j]!;
    return s;
  };
  const b: IVec[] = [h[0], h[1], h[2]];
  for (let changed = true, guard = 0; changed && guard < 200; guard++) {
    changed = false;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        const q = Math.round(dot(b[i]!, b[j]!) / dot(b[j]!, b[j]!));
        if (q === 0) continue;
        const next: IVec = [b[i]![0] - q * b[j]![0], b[i]![1] - q * b[j]![1], b[i]![2] - q * b[j]![2]];
        if (dot(next, next) < dot(b[i]!, b[i]!)) {
          b[i] = next;
          changed = true;
        }
      }
    }
  }
  b.sort((x, y) => dot(x, x) - dot(y, y) || y[0] - x[0] || y[1] - x[1] || y[2] - x[2]);
  // Right-handed.
  const det = b[0]![0] * (b[1]![1] * b[2]![2] - b[1]![2] * b[2]![1]) - b[0]![1] * (b[1]![0] * b[2]![2] - b[1]![2] * b[2]![0]) + b[0]![2] * (b[1]![0] * b[2]![1] - b[1]![1] * b[2]![0]);
  if (det < 0) b[2] = [-b[2]![0], -b[2]![1], -b[2]![2]];
  return b;
}

const mulMat = (A: number[][], B: number[][]): number[][] => A.map((r) => [0, 1, 2].map((j) => r[0]! * B[0]![j]! + r[1]! * B[1]![j]! + r[2]! * B[2]![j]!));
const mulVec = (A: number[][], v: readonly number[]): number[] => A.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
function inv3(m: number[][]): number[][] {
  const [a, b, c] = m[0]!;
  const [d, e, f] = m[1]!;
  const [g, h, i] = m[2]!;
  const A = e! * i! - f! * h!;
  const B = -(d! * i! - f! * g!);
  const C = d! * h! - e! * g!;
  const det = a! * A + b! * B + c! * C;
  return [
    [A / det, -(b! * i! - c! * h!) / det, (b! * f! - c! * e!) / det],
    [B / det, (a! * i! - c! * g!) / det, -(a! * f! - c! * d!) / det],
    [C / det, -(a! * h! - b! * g!) / det, (a! * e! - b! * d!) / det],
  ];
}
const snap = (x: number): number => {
  const r = Math.round(x * 48) / 48;
  return Math.abs(r - x) < 1e-9 ? r + 0 : x;
};
const mod1 = (x: number): number => {
  const f = snap(x - Math.floor(x));
  return f >= 1 - 1e-12 ? 0 : f;
};

const ORIGIN_GRIDS_SUPERCELL = [8, 24, 16, 48] as const;

/**
 * The child's name in ITA standard setting and its child basis from the
 * parent's cell (see the module comment). `basis` and `originShift` are
 * (P_H, p_H) whenever the method is "conventional-cell"; a "direct" name
 * holds in the parent's cell as it stands (P_H = I, p_H = 0).
 */
export function nameChild(group: FactorGroup, elements: readonly number[]): SubgroupIdentity {
  if (keepsConventionalCell(group, elements)) {
    return identifySubgroup(operationsModCell(group, elements), group.parentOperations, { standard: true });
  }
  const { D } = group.bound;
  const basisRows = reduceBasis(subgroupLattice(group, elements), parentMetric(group));
  // B: the primitive cell's axes as columns, in the parent's basis.
  const B: number[][] = [0, 1, 2].map((i) => [0, 1, 2].map((j) => basisRows[j]![i]! / D));
  const Binv = inv3(B);
  const seen = new Set<string>();
  const ops: SymmetryOperation[] = [];
  for (const i of elements) {
    const e = group.elements[i]!;
    const W = mulMat(Binv, mulMat(e.W.map((r) => [...r]), B)).map((r) => r.map((x) => Math.round(x)));
    const w = mulVec(Binv, e.w.map(rnum)).map(mod1);
    const key = `${W.flat().join(",")}|${w.map((x) => Math.round(x * 48)).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rotation = W as unknown as Mat3;
    const translation: Vec3 = [w[0]!, w[1]!, w[2]!];
    ops.push({ rotation, translation, xyz: formatOperationXyz(rotation, translation) });
  }
  const pg = classifyPointGroup(ops);
  const parentPg = classifyPointGroup(group.parentOperations);
  const index = pg.order > 0 ? Math.round(parentPg.order / pg.order) : 0;
  const std = standardSettingOf(ops, { originGrids: ORIGIN_GRIDS_SUPERCELL });
  if (!std) return { pointGroup: pg.symbol, index, method: "point-group-only", basis: B.map((r) => r.map(snap)) as unknown as Mat3 };
  const P = mulMat(B, std.basis.map((r) => [...r])).map((r) => r.map(snap));
  const p = mulVec(B, std.origin).map(snap);
  const shifted = p.some((x) => Math.abs(x) > 1e-9);
  return {
    number: std.entry.number,
    hermannMauguin: extendedSymbol(std.entry),
    pointGroup: pg.symbol,
    index,
    method: "conventional-cell",
    basis: P as unknown as Mat3,
    ...(shifted ? { originShift: [p[0]!, p[1]!, p[2]!] as const } : {}),
  };
}
