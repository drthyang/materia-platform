import { describe, expect, it } from "vitest";
import { boxcarTable, type BoxcarRun } from "@/core/workflow/pdfBoxcar";
import { parseCif } from "@/parsers/cif";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";

/**
 * A boxcar table's bond columns follow each bond by identity (its neighbour
 * and the image it reaches), not by its rank in the shell: a bond that grows
 * past another keeps its column.
 */
describe("boxcar bond columns", () => {
  const phase = parseCif(["data_t", "_cell_length_a 8", "_cell_length_b 8", "_cell_length_c 8", "_cell_angle_alpha 90", "_cell_angle_beta 90", "_cell_angle_gamma 90",
    "_symmetry_space_group_name_H-M 'P 1'", "loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z",
    "Zn1 Zn 0 0 0", "O1 O 0.24 0 0", "O2 O 0 0.25 0"].join("\n"), "t");
  const parameters: RefinementParameter[] = [{ id: "x_O1", label: "O1 x", kind: "atomX", value: 0.24, initialValue: 0.24, fixed: false }];
  const bindings: ParameterBinding[] = [{ parameterId: "x_O1", kind: "atomX", targetId: phase.id, targetKey: "O1" }];
  const step = (x: number) => ({ result: { parameters: { x_O1: x }, esd: {}, agreement: { rWeighted: 0.1 } } });
  const run = {
    windows: [{ center: 3, min: 1.5, max: 4.5 }, { center: 5, min: 3.5, max: 6.5 }],
    // O1 moves out from 1.92 Å to 2.08 Å, past O2 at 2.00 Å.
    series: [{ direction: "up", result: { steps: [step(0.24), step(0.26)] } }],
    width: 3, restarts: 0, freeIds: ["x_O1"], bondSites: ["Zn1"],
  } as unknown as BoxcarRun;

  it("keeps Zn1–O1 in its column when it grows past Zn1–O2", () => {
    const table = boxcarTable(run, phase, bindings, parameters);
    expect(table.columns).toEqual(["Zn1–O1 (Å)", "Zn1–O2 (Å)"]);
    expect(table.rows[0]!.values[0]).toBeCloseTo(1.92, 4);
    expect(table.rows[1]!.values[0]).toBeCloseTo(2.08, 4);
    expect(table.rows[1]!.values[1]).toBeCloseTo(2.0, 4);
  });
});
