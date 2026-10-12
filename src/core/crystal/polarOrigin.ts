/**
 * The floating origin of a polar space group. In P6₁, P2₁, Pc, P1 … nothing
 * fixes the origin along the polar directions: shifting every atom along one
 * of them leaves every intensity unchanged, so a refinement with all those
 * coordinates free has a direction the data cannot see. SHELXL restrains it
 * (Flack & Schwarzenbach, Acta Cryst. A44 (1988) 499): the weighted mean
 * coordinate along each polar direction is held, one restraint per direction —
 * here where the model the parameters apply to has it, so that the origin
 * stays put from one refinement to the next. Here the weights are the atoms' scattering powers, Z², so the
 * heavy atoms anchor the origin; the fit and every interatomic distance are
 * the same whatever the weights, only an individual coordinate's esd along
 * the polar direction depends on them.
 */

import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { ELEMENT_SYMBOLS } from "@/core/crystal/elements";

/** One floating origin: the shift that changes nothing, and the restraint that holds it. */
export interface FloatingOrigin {
  /** The origin shift along the polar direction, in fractional coordinates (e.g. [0, 0, 1]: along c). */
  readonly direction: Vec3;
  /** Its name: "c", "b", "a", or the direction's indices. */
  readonly axis: string;
  /** The coordinate the restraint holds: g·x, g dual to the directions (g·direction = 1). */
  readonly dual: Vec3;
  /** Each site's weight (summing to 1). */
  readonly weights: ReadonlyMap<string, number>;
}

/** The restraint's esd, on the weighted mean fractional coordinate: tight enough to pin the origin, too small to matter otherwise. */
export const ORIGIN_RESTRAINT_SIGMA = 1e-5;

const atomicNumber = (element: string): number => {
  const bare = element.replace(/[^A-Za-z]/g, "");
  if (bare === "D") return 1;
  const z = ELEMENT_SYMBOLS.indexOf(bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase()) + 1;
  return z > 0 ? z : 6;
};

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The polar directions of a space group: the shifts every rotation part leaves
 * unchanged, R·t = t (fractional). None in a group with the inversion or with
 * axes along every direction; c in P6₁ and P3; b in P2₁; a and c in Pc (b
 * unique); all three in P1. Axis-aligned where they can be.
 */
export function polarDirections(operations: readonly SymmetryOperation[]): Vec3[] {
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const fixed = (v: Vec3): boolean => operations.every((op) => [0, 1, 2].every((i) => Math.abs(dot(op.rotation[i] as unknown as Vec3, v) - v[i]!) < 1e-9));
  const aligned = axes.filter(fixed);
  if (aligned.length > 0) return aligned;
  // A polar direction off the axes (a rhombohedral cell's [111]): the vector every rotation fixes.
  for (const v of [[1, 1, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, -1, 0], [1, 2, 0], [2, 1, 0]] as Vec3[]) if (fixed(v)) return [v];
  return [];
}

const axisName = (v: Vec3): string => (v[0] === 1 && v[1] === 0 && v[2] === 0 ? "a" : v[0] === 0 && v[1] === 1 && v[2] === 0 ? "b" : v[0] === 0 && v[1] === 0 && v[2] === 1 ? "c" : `[${v.join(" ")}]`);

/**
 * The origins the free set leaves floating: each polar direction along which
 * every site that is not a riding hydrogen can move by its free position
 * parameters. A site held fixed along it pins the origin, and needs no
 * restraint.
 */
export function floatingOrigins(structure: StructureModel, parameters: readonly RefinementParameter[], bindings: readonly ParameterBinding[]): FloatingOrigin[] {
  const directions = polarDirections(structure.spaceGroup.operations);
  if (directions.length === 0) return [];
  const free = new Set(parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.id));
  const riders = new Set((structure.riding ?? []).filter((r) => r.geometry !== "free").map((r) => r.site));
  const sites = structure.sites.filter((s) => !riders.has(s.label));
  if (sites.length === 0) return [];
  // Each site's free shift axes (fractional).
  const axesOf = new Map<string, Vec3[]>();
  for (const b of bindings) {
    if (!b.targetKey || !free.has(b.parameterId)) continue;
    const axis: Vec3 | undefined = b.kind === "positionShift" ? (b.axis as Vec3 | undefined) : b.kind === "atomX" ? [1, 0, 0] : b.kind === "atomY" ? [0, 1, 0] : b.kind === "atomZ" ? [0, 0, 1] : undefined;
    if (axis) axesOf.set(b.targetKey, [...(axesOf.get(b.targetKey) ?? []), axis]);
  }
  const canMove = (label: string, u: Vec3): boolean => {
    const axes = axesOf.get(label) ?? [];
    if (axes.length === 0) return false;
    // u lies in the span of the axes: its residual after least squares onto them vanishes.
    const k = axes.length;
    const a = axes.map((x) => axes.map((y) => dot(x, y)));
    const rhs = axes.map((x) => dot(x, u));
    const coef = solveSmall(a, rhs);
    if (!coef) return false;
    const fit = [0, 0, 0];
    for (let i = 0; i < k; i++) for (let j = 0; j < 3; j++) fit[j]! += coef[i]! * axes[i]![j]!;
    return Math.hypot(fit[0]! - u[0], fit[1]! - u[1], fit[2]! - u[2]) < 1e-6 * Math.hypot(u[0], u[1], u[2]);
  };
  const z2 = sites.map((s) => atomicNumber(s.element) ** 2);
  const total = z2.reduce((t, v) => t + v, 0);
  const weights = new Map(sites.map((s, i) => [s.label, z2[i]! / total]));
  return directions
    .filter((u) => sites.every((s) => canMove(s.label, u)))
    .map((u) => ({ direction: u, axis: axisName(u), dual: u.map((x) => x / dot(u, u)) as unknown as Vec3, weights }));
}

/** The coordinate a floating-origin restraint holds: Σ w_s g·x_s over its sites. */
export function originCoordinate(origin: FloatingOrigin, structure: StructureModel): number {
  let v = 0;
  for (const s of structure.sites) {
    const w = origin.weights.get(s.label);
    if (w !== undefined) v += w * dot(origin.dual, s.position as Vec3);
  }
  return v;
}

/** A small symmetric system by Gaussian elimination; null when singular. */
function solveSmall(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-12) {
      // A repeated axis: drop it (zero coefficient) and go on.
      m[c]![c] = 1;
      for (let j = c + 1; j <= n; j++) m[c]![j] = 0;
      continue;
    }
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= n; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}
