/**
 * Hand-made B-at-0 cases for the tests of the rule's text (core/diagnostics/
 * zeroAdp.ts and the pages' short lines, zeroAdpLines.ts): Cr₂WO₆
 * (trirutile, P4₂/mnm), W1 and Cr1 both octahedral cations (6 O), O1 and O2
 * the two oxygens; the same with Fe sharing the Cr site and no oxidation
 * states (the AWO₄ demo's shape); the rows one B per site group, prefixed per
 * phase as the multi-phase spec does; and a result with exactly the bounds
 * and esds a case needs.
 */

import type { ParameterBinding, RefinementCorrelation, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { StructureModel } from "@/core/crystal/types";

export const CIF = (b: boolean, name = "cr2wo6"): string => `data_${name}
_cell_length_a 4.5753
_cell_length_b 4.5753
_cell_length_c 8.8537
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 42/m n m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
${b ? "_atom_site_U_iso_or_equiv\n" : ""}W1 W6+ 0 0 0 1${b ? " 0.0040" : ""}
Cr1 Cr3+ 0 0 0.3330 1${b ? " 0.0050" : ""}
O1 O2- 0.2985 0.2985 0 1${b ? " 0.0070" : ""}
O2 O2- 0.3075 0.3075 0.3400 1${b ? " 0.0076" : ""}
`;

/** Cr₂WO₆ with Fe sharing the Cr site (one B for both) and no oxidation states: the AWO₄ demo's shape. */
export const SHARED_CIF = `data_shared
_cell_length_a 4.5753
_cell_length_b 4.5753
_cell_length_c 8.8537
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 42/m n m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_U_iso_or_equiv
W1 W 0 0 0 1 0.0184
Cr1 Cr 0 0 0.3330 0.5 0.0050
Fe1 Fe 0 0 0.3330 0.5 0.0050
O1 O 0.2985 0.2985 0 1 0.0070
O2 O 0.3075 0.3075 0.3400 1 0.0076
`;

/** One B row per group of sites, the rows prefixed per phase as the multi-phase spec does. */
export function rows(phases: readonly { structure: StructureModel; prefix: string; groups: readonly (readonly string[])[] }[], values: Record<string, number>, fixed: readonly string[] = []): { params: RefinementParameter[]; bindings: ParameterBinding[] } {
  const params: RefinementParameter[] = [{ id: "scale", label: "scale", kind: "scale", value: 1, initialValue: 1, min: 0, fixed: false }];
  const bindings: ParameterBinding[] = [{ parameterId: "scale", kind: "scale", targetId: "p" }];
  for (const { structure, prefix, groups } of phases) {
    for (const g of groups) {
      const id = `${prefix}B_${g[0]}`;
      const label = `${phases.length > 1 ? `${structure.name}: ` : ""}${g[0]}${g.length > 1 ? `+${g.length - 1}` : ""} B`;
      params.push({ id, label, kind: "bIso", value: values[id] ?? 0.5, initialValue: 0.5, min: 0, max: 10, fixed: fixed.includes(id) });
      for (const l of g) bindings.push({ parameterId: id, kind: "bIso", targetId: structure.id, targetKey: l });
    }
  }
  return { params, bindings };
}

export function result(values: Record<string, number>, esd: Record<string, number>, atMin: readonly string[], moderate: readonly RefinementCorrelation[] = []): RefinementResult {
  return {
    status: "converged",
    parameters: { scale: 1, ...values },
    esd: { scale: 0.01, ...esd },
    agreement: { rFactor: 0.05, rWeighted: 0.07, goodnessOfFit: 1.4 },
    history: [],
    diagnostics: {
      svdZeroCount: 0, singularParameterIds: [], conditionNumber: 10, highCorrelations: [], moderateCorrelations: moderate, maxLambda: 1e-3, maxShiftOverEsd: 0.01,
      atBounds: atMin.map((id) => ({ parameterId: id, bound: "min" as const, value: 0 })),
    },
  } as RefinementResult;
}
