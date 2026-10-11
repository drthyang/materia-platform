/**
 * Bond-length esds from the refined positions' esds, for the Agent's
 * bond_geometry and for the report's bond table.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { applyParameters } from "@/core/workflow/apply";

/**
 * A bond's identity across small shifts of the structure: its two sites, in
 * either order (a shift can list A–B as B–A), and its rank among their bonds.
 */
export function bondKeys(bonds: readonly { from?: string; to?: string; distance: number }[]): string[] {
  const rank = new Map<string, number>();
  return bonds.map((b) => {
    const pair = [b.from ?? "", b.to ?? ""].sort().join("–");
    const r = rank.get(pair) ?? 0;
    rank.set(pair, r + 1);
    return `${pair}#${r}`;
  });
}

/**
 * The esd of each bond length from the refined positions' esds: every free
 * positional parameter shifted by its esd, the bonds measured again in the
 * structure that gives (each symmetry image follows its own operation), and the
 * changes added in quadrature (the positions taken as independent; the cell is
 * fixed input on the single-crystal page). Keyed as `bondKeys` keys the bonds.
 */
export function bondEsds(
  base: StructureModel,
  bindings: readonly ParameterBinding[],
  parameters: readonly RefinementParameter[],
  esd: Readonly<Record<string, number>>,
  measure: (structure: StructureModel) => readonly { from?: string; to?: string; distance: number }[],
): Map<string, number> {
  const values: Record<string, number> = Object.fromEntries(parameters.map((p) => [p.id, p.value]));
  const at = (v: Record<string, number>): Map<string, number> => {
    const bonds = measure(applyParameters(base, bindings, v).model);
    const keys = bondKeys(bonds);
    return new Map(bonds.map((b, i) => [keys[i]!, b.distance]));
  };
  const ref = at(values);
  const variance = new Map<string, number>([...ref.keys()].map((k) => [k, 0]));
  const positional = new Set(["positionShift", "atomX", "atomY", "atomZ"]);
  for (const p of parameters) {
    const e = esd[p.id];
    if (p.fixed || p.expression || !positional.has(p.kind) || !(e !== undefined && e > 0)) continue;
    const moved = at({ ...values, [p.id]: p.value + e });
    for (const [k, d] of ref) {
      const d2 = moved.get(k);
      if (d2 !== undefined) variance.set(k, variance.get(k)! + (d2 - d) ** 2);
    }
  }
  return new Map([...variance].map(([k, v]) => [k, Math.sqrt(v)]));
}
