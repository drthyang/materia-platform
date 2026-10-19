import { describe, it, expect } from "vitest";
import { lostCentring } from "@/core/diagnostics/lostCentring";
import { parseCif } from "@/parsers/cif";

/** A cubic group by its Hermann–Mauguin symbol, as a CIF gives it. */
function group(symbol: string) {
  const text = ["data_t", "_cell_length_a 4", "_cell_length_b 4", "_cell_length_c 4", "_cell_angle_alpha 90", "_cell_angle_beta 90", "_cell_angle_gamma 90", `_symmetry_space_group_name_H-M "${symbol}"`,
    "loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z", "A1 Ni 0 0 0", ""].join("\n");
  return parseCif(text, "t").spaceGroup;
}

describe("a lost centring in the flagged absences", () => {
  it("reads every flag of the I centring's class as one, from three on", () => {
    const flags = [[1, 0, 0], [2, 1, 0], [1, 1, 1], [3, 0, 0]] as const;
    expect(lostCentring(group("I m -3 m"), flags)).toEqual({ centring: "I", condition: "h+k+l odd", count: 4 });
    expect(lostCentring(group("I m -3 m"), flags.slice(0, 2))).toBeNull();
  });

  it("is no lost centring when one flag is a reflection the centring allows (a glide's, or a stray line)", () => {
    expect(lostCentring(group("I m -3 m"), [[1, 0, 0], [2, 1, 0], [1, 1, 1], [2, 0, 0]])).toBeNull();
  });

  it("names the F centring's class, and reads nothing on a primitive model", () => {
    expect(lostCentring(group("F m -3 m"), [[1, 0, 0], [1, 1, 0], [2, 1, 0]])).toMatchObject({ centring: "F", condition: "h, k, l of mixed parity" });
    expect(lostCentring(group("P m -3 m"), [[1, 0, 0], [2, 1, 0], [1, 1, 1]])).toBeNull();
  });
});
