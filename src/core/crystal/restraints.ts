/**
 * Distance restraints, as SHELXL's DFIX and SADI: observational equations
 * beside the data that hold a distance near a target (DFIX d s) or several
 * distances near one another (SADI s), each with an esd s. They let a model
 * keep atoms the data alone place poorly — a hydride beside a heavy metal, a
 * disordered fragment — at a chemically sensible geometry while the data
 * refine everything else. Restraints are counted as SHELXL counts them: a
 * DFIX one per distance; a SADI of two distances one (their difference), of
 * more one per distance (each to their mean).
 */

import type { RestrainedPair, DistanceRestraint, StructureModel } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { mulVec, transpose } from "@/core/math/mat3";

/** SHELXL's default esd of a DFIX or SADI (Å). */
export const DEFAULT_RESTRAINT_SIGMA = 0.02;

/** One restraint row: Σ c_k·d_k over the pairs' distances, held at `target` with esd `sigma`. */
export interface RestraintRow {
  readonly label: string;
  /** Indices into the flat pair list, with their coefficients. */
  readonly terms: readonly { readonly pair: number; readonly coefficient: number }[];
  readonly target: number;
  readonly sigma: number;
}

const pairText = (p: RestrainedPair): string => `${p.from}–${p.to}`;

/** Every restraint as rows over one flat list of the pairs they name. */
export function restraintRows(restraints: readonly DistanceRestraint[]): { pairs: RestrainedPair[]; rows: RestraintRow[] } {
  const pairs: RestrainedPair[] = [];
  const rows: RestraintRow[] = [];
  for (const r of restraints) {
    const first = pairs.length;
    pairs.push(...r.pairs);
    const at = r.pairs.map((_, i) => first + i);
    if (r.kind === "dfix") {
      r.pairs.forEach((p, i) => rows.push({ label: `DFIX ${r.target} ${r.sigma} ${pairText(p)}`, terms: [{ pair: at[i]!, coefficient: 1 }], target: r.target ?? 0, sigma: r.sigma }));
    } else if (r.pairs.length === 2) {
      rows.push({ label: `SADI ${r.sigma} ${r.pairs.map(pairText).join(" = ")}`, terms: [{ pair: at[0]!, coefficient: 1 }, { pair: at[1]!, coefficient: -1 }], target: 0, sigma: r.sigma });
    } else {
      const n = r.pairs.length;
      r.pairs.forEach((p, i) => rows.push({
        label: `SADI ${r.sigma} ${pairText(p)} against the mean of ${n}`,
        terms: at.map((k, j) => ({ pair: k, coefficient: (j === i ? 1 : 0) - 1 / n })),
        target: 0,
        sigma: r.sigma,
      }));
    }
  }
  return { pairs, rows };
}

/** How many restraints, as SHELXL counts them. */
export const restraintCount = (restraints: readonly DistanceRestraint[]): number => restraintRows(restraints).rows.length;

/** The image of `to` a pair names: its position under the operation and lattice translation. */
function imageOf(model: StructureModel, pair: RestrainedPair, to: Vec3): Vec3 {
  const o = model.spaceGroup.operations[pair.op]!;
  const p = mulVec(o.rotation, to);
  return [p[0] + o.translation[0] + pair.cell[0], p[1] + o.translation[1] + pair.cell[1], p[2] + o.translation[2] + pair.cell[2]];
}

/**
 * Each pair's distance at the model's positions, and its gradient with
 * respect to each atom's own fractional coordinates (the second through its
 * image's rotation): ∂d/∂x_from = Gᵀ·Δ/d, ∂d/∂x_to = −Rᵀ·Gᵀ·Δ/d.
 */
export function pairGeometry(model: StructureModel, pairs: readonly RestrainedPair[]): { distance: number; from: number; to: number; gradFrom: Vec3; gradTo: Vec3 }[] {
  const index = new Map(model.sites.map((s, i) => [s.label, i]));
  const m = orthogonalizationMatrix(model.cell);
  const mt = transpose(m);
  return pairs.map((pair) => {
    const from = index.get(pair.from);
    const to = index.get(pair.to);
    if (from === undefined || to === undefined) return { distance: NaN, from: -1, to: -1, gradFrom: [0, 0, 0], gradTo: [0, 0, 0] };
    const a = model.sites[from]!.position;
    const b = imageOf(model, pair, model.sites[to]!.position);
    const c = mulVec(m, [a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    const distance = Math.hypot(c[0], c[1], c[2]);
    const g = mulVec(mt, [c[0] / distance, c[1] / distance, c[2] / distance]);
    const r = transpose(model.spaceGroup.operations[pair.op]!.rotation);
    const gt = mulVec(r, g);
    return { distance, from, to, gradFrom: g, gradTo: [-gt[0], -gt[1], -gt[2]] };
  });
}

/** The rows' values (Σ c_k·d_k) at the model's positions. */
export function restraintValues(model: StructureModel, pairs: readonly RestrainedPair[], rows: readonly RestraintRow[]): Float64Array {
  const d = pairGeometry(model, pairs).map((g) => g.distance);
  return Float64Array.from(rows.map((row) => row.terms.reduce((t, x) => t + x.coefficient * d[x.pair]!, 0)));
}

/**
 * The nearest image of `to` from `from` (any symmetry operation and lattice
 * translation, not `from` itself): the pair a restraint between two labels
 * means, as SHELXL takes the shortest contact. Null when either is unknown.
 */
export function nearestPair(model: StructureModel, from: string, to: string): (RestrainedPair & { distance: number }) | null {
  const a = model.sites.find((s) => s.label === from);
  const b = model.sites.find((s) => s.label === to);
  if (!a || !b) return null;
  const m = orthogonalizationMatrix(model.cell);
  let best: (RestrainedPair & { distance: number }) | null = null;
  model.spaceGroup.operations.forEach((o, op) => {
    const p = mulVec(o.rotation, b.position);
    const base: Vec3 = [p[0] + o.translation[0], p[1] + o.translation[1], p[2] + o.translation[2]];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const cell: [number, number, number] = [Math.round(a.position[0] - base[0]) + i, Math.round(a.position[1] - base[1]) + j, Math.round(a.position[2] - base[2]) + k];
      const c = mulVec(m, [base[0] + cell[0] - a.position[0], base[1] + cell[1] - a.position[1], base[2] + cell[2] - a.position[2]]);
      const distance = Math.hypot(c[0], c[1], c[2]);
      if (distance > 0.1 && (!best || distance < best.distance - 1e-9)) best = { from, to, op, cell, distance };
    }
  });
  return best;
}

/**
 * Each restraint as it stands in the model: the distances it names, their
 * mean, and how far each row is from its target in its esds (SHELXL's
 * listing of the restraints' deviations).
 */
export function restraintReport(model: StructureModel, restraints: readonly DistanceRestraint[]): { text: string; worst: number }[] {
  return restraints.map((r) => {
    const { pairs, rows } = restraintRows([r]);
    const d = pairGeometry(model, pairs).map((g) => g.distance);
    const values = restraintValues(model, pairs, rows);
    const devs = rows.map((row, i) => (values[i]! - row.target) / row.sigma);
    const worst = Math.max(0, ...devs.map(Math.abs));
    const lengths = pairs.map((p, i) => `${pairText(p)} ${d[i]!.toFixed(3)}`).join(", ");
    const head = r.kind === "dfix" ? `DFIX ${r.target} Å (σ ${r.sigma})` : `SADI (σ ${r.sigma}), mean ${(d.reduce((t, x) => t + x, 0) / d.length).toFixed(3)} Å`;
    return { text: `${head}: ${lengths} Å — the largest deviation ${worst.toFixed(1)}σ`, worst };
  });
}
