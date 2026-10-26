/**
 * The magnetic space group a candidate denotes, written in its magnetic cell.
 *
 * A candidate (H, θ) of the subgroup lattice lists H's operations in the
 * PARENT cell with a time-reversal sign each; at a propagation vector k ≠ 0 a
 * lattice translation t of the parent carries the phase χ(t) = e^{2πi k·t}
 * (±1 for a single-arm k). The group of the ordered structure is then
 *   M = { {R | τ_g + t} with sign θ_g·χ(t + c(g)) : g ∈ H, t ∈ Λ },
 * where c(g) is the centring offset the moment code reads θ through
 * (`centringOffsets`): the parent translations with χ = −1 become
 * ANTI-translations, so M is a black-and-white group of BNS type IV whenever
 * k ≠ 0. Its lattice is the magnetic cell's — here the diagonal supercell
 * N = diag(n₁, n₂, n₃) with nᵢ the denominator of kᵢ, the box the mCIF
 * exporter and the 3D view use (`classifyPropagation().supercell`).
 *
 * `candidateCellGroup` writes M in that box: R' = N⁻¹·R·N, t' = N⁻¹·(τ + t)
 * mod 1, one operation per element modulo the box's own translations (the
 * parent translations inside the box are its centring and anti-centring
 * translations). This is what names a candidate at k ≠ 0: the parent-cell
 * operations alone describe a type-I or type-III group of the PARENT lattice,
 * which is not the group of the structure (the AWO₄-type P2/c at k = (½,0,0)
 * is P_a2/c, BNS 13.70, not "P2/c′").
 *
 * A two-arm k (2k not in the reciprocal lattice) gives complex phases: the
 * candidate is then not a magnetic space group of the box, and null is
 * returned.
 */

import type { SymmetryOperation } from "@/core/crystal/types";
import type { Mat3, Vec3 } from "@/core/math/types";
import { centringOffsets, centringTranslations, formatOperationXyz } from "@/core/crystal/symmetry";
import { classifyPropagation } from "@/core/magnetic/propagation";
import { latticePhase } from "@/core/magnetic/magneticGroups";

export interface CandidateCellGroup {
  /** The box: the magnetic cell is (n₁a, n₂b, n₃c) of the parent. */
  readonly n: readonly [number, number, number];
  /** M in box coordinates, θ-signed, translations in [0, 1), complete modulo the box's lattice translations. */
  readonly operations: readonly SymmetryOperation[];
}

const wrap = (x: number): number => {
  const r = Math.round(x * 24) / 24;
  const v = Math.abs(x - r) < 1e-6 ? r : x;
  const w = ((v % 1) + 1) % 1;
  return w > 1 - 1e-9 ? 0 : w;
};

/** A box operation's key: rotation, translation on the 1/48 grid, θ. */
function opKey(R: Mat3, t: Vec3, theta: number): string {
  return `${R.map((r) => r.join(",")).join(";")}|${t.map((x) => Math.round(x * 48) % 48).join(",")}|${theta}`;
}

/**
 * The group of a candidate's operations at k, in its magnetic cell (see the
 * module doc). Null for a two-arm k, for an incommensurate one, and when a
 * rotation does not preserve the box (never for operations of the little
 * group of k).
 */
export function candidateCellGroup(ops: readonly SymmetryOperation[], k: Vec3): CandidateCellGroup | null {
  const cls = classifyPropagation(k, { centrings: centringTranslations(ops) });
  if (cls.twoArms || !cls.supercell) return null;
  const n = cls.supercell;
  const offsets = centringOffsets(ops);
  const out = new Map<string, SymmetryOperation>();
  for (let gi = 0; gi < ops.length; gi++) {
    const op = ops[gi]!;
    const R: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const v = (op.rotation[i]![j]! * n[j]!) / n[i]!;
        if (Math.abs(v - Math.round(v)) > 1e-9) return null;
        R[i]![j] = Math.round(v);
      }
    }
    const Rb = R as unknown as Mat3;
    const c = offsets[gi]!;
    const theta0 = op.timeReversal ?? 1;
    for (let a = 0; a < n[0]; a++) for (let b = 0; b < n[1]; b++) for (let d = 0; d < n[2]; d++) {
      const phase = latticePhase(k, [a + c[0]!, b + c[1]!, d + c[2]!]);
      if (phase === null) return null;
      const theta = (theta0 * phase) as 1 | -1;
      const t: Vec3 = [
        wrap((op.translation[0]! + a) / n[0]),
        wrap((op.translation[1]! + b) / n[1]),
        wrap((op.translation[2]! + d) / n[2]),
      ];
      const key = opKey(Rb, t, theta);
      if (!out.has(key)) out.set(key, { rotation: Rb, translation: t, xyz: formatOperationXyz(Rb, t), timeReversal: theta });
    }
  }
  return { n: [n[0], n[1], n[2]], operations: [...out.values()] };
}

/**
 * Whether a box operation list is a magnetic group: closed under composition
 * (translations mod 1, θ multiplying) and without an operation carried with
 * both signs (which would put pure time reversal 1′ in it).
 */
export function isMagneticGroup(ops: readonly SymmetryOperation[]): boolean {
  const sign = new Map<string, number>();
  for (const o of ops) {
    const spatial = opKey(o.rotation, o.translation, 0);
    const s = o.timeReversal ?? 1;
    const prev = sign.get(spatial);
    if (prev !== undefined && prev !== s) return false;
    sign.set(spatial, s);
  }
  for (const a of ops) {
    for (const b of ops) {
      const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a.rotation[i]![0]! * b.rotation[0]![j]! + a.rotation[i]![1]! * b.rotation[1]![j]! + a.rotation[i]![2]! * b.rotation[2]![j]!)) as unknown as Mat3;
      const t: Vec3 = [0, 1, 2].map((i) => wrap(a.rotation[i]![0]! * b.translation[0]! + a.rotation[i]![1]! * b.translation[1]! + a.rotation[i]![2]! * b.translation[2]! + a.translation[i]!)) as unknown as Vec3;
      const s = sign.get(opKey(R, t, 0));
      if (s === undefined || s !== (a.timeReversal ?? 1) * (b.timeReversal ?? 1)) return false;
    }
  }
  return true;
}
