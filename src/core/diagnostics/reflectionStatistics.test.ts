import { describe, it, expect } from "vitest";
import { parseCif } from "@/parsers/cif";
import { measurementMerge, mergeEquivalents } from "@/core/diffraction/merge";
import { reflectionStatistics, type StatisticsRow } from "@/core/diagnostics/reflectionStatistics";

function crystal(group: string) {
  return parseCif(`data_x
_cell_length_a 6.2
_cell_length_b 12.9
_cell_length_c 17.4
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M '${group}'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Ga1 Ga 0.21 0.61 0.18
`, "x");
}

/**
 * Each general reflection of P2₁2₁2₁ measured at two equivalents of its point
 * group, and its Friedel mate likewise at 4 % more: the equivalents agree
 * exactly, the mates differ by an anomalous signal.
 */
function bijvoetRows(): StatisticsRow[] {
  const rows: StatisticsRow[] = [];
  for (let h = 1; h <= 4; h++) for (let k = 1; k <= 4; k++) for (let l = 1; l <= 4; l++) {
    const i = 100 + 10 * h + 3 * k + l;
    rows.push({ h, k, l, intensity: i, sigma: 1 }, { h: -h, k: -k, l, intensity: i, sigma: 1 });
    rows.push({ h: -h, k: -k, l: -l, intensity: 1.04 * i, sigma: 1 }, { h, k, l: -l, intensity: 1.04 * i, sigma: 1 });
  }
  return rows;
}

describe("reflection statistics", () => {
  it("gives R_int with the Friedel mates apart, as SHELXL merges a non-centrosymmetric group: below the Laue figure by the anomalous signal", () => {
    const c = crystal("P 21 21 21");
    const rows = bijvoetRows();
    const st = reflectionStatistics(rows, c.cell, c.spaceGroup);
    expect(st.friedel.centrosymmetric).toBe(false);
    expect(st.friedel.fraction).toBe(1);
    // The one Friedel-apart merge, the one get_state, reflection_statistics and the report quote.
    expect(measurementMerge(rows, c.spaceGroup.operations).statistics.friedelApart!.rInt).toBeCloseTo(0, 12);
    // Merged in the Laue class the mates average: each 2 % off their mean, R_int 0.08/4.08.
    expect(mergeEquivalents(rows, c.spaceGroup.operations).statistics.rInt).toBeCloseTo(0.08 / 4.08, 12);
  });

  it("has no Friedel-apart R_int for a centrosymmetric group, whose mates are equivalent", () => {
    const c = crystal("P 1 21/c 1");
    expect(measurementMerge(bijvoetRows(), c.spaceGroup.operations).statistics.friedelApart).toBeUndefined();
  });
});
