import { describe, expect, it } from "vitest";
import { withEsd } from "@/agent/structureTable";
import { formatWithEsd } from "@/core/export/cif";

describe("withEsd", () => {
  it("reads the su's leading digits before rounding it: 0.015 is two figures, 15", () => {
    // Rounding first made 0.015 → 0.02, one figure, and "0.43(2)".
    expect(withEsd(0.435, 0.015)).toBe("0.435(15)");
    expect(withEsd(0.18752, 0.00009)).toBe("0.18752(9)");
    expect(withEsd(8.46808, 0.0001)).toBe("8.46808(10)");
    expect(withEsd(0.2400, 0.0010)).toBe("0.2400(10)");
    expect(withEsd(1.234, 0.25)).toBe("1.2(3)");
  });

  it("agrees with the CIF writer, and caps the decimals", () => {
    for (const [v, u] of [[0.435, 0.015], [0.4293, 0.0009], [12.3456, 0.0196], [0.07, 0.0095], [3.1, 1.4]] as const) {
      expect(withEsd(v, u)).toBe(formatWithEsd(v, u, 6));
    }
    expect(withEsd(0.1234567891, 0.00000012, 6)).toBe("0.123457(1)");
    expect(withEsd(0.5, undefined)).toBe("0.50000");
  });
});

describe("the refined structure against the loaded one", () => {
  it("measures the shifts from the values, not from the printed digits", async () => {
    const { parseCif } = await import("@/parsers/cif");
    const { compareWithLoaded, structureTable } = await import("@/agent/structureTable");
    const cif = (x: string): string => ["data_t", "_cell_length_a 10", "_cell_length_b 10", "_cell_length_c 10", "_cell_angle_alpha 90", "_cell_angle_beta 90", "_cell_angle_gamma 90",
      "_symmetry_space_group_name_H-M 'P 1'", "loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z", "_atom_site_B_iso_or_equiv",
      `Fe1 Fe ${x} 0.2 0.3 0.5`].join("\n");
    // Refined and loaded at the same x, 0.12346: printed with an esd of 0.0002 it reads 0.1235, 0.4 mÅ off.
    const refined = parseCif(cif("0.12346"), "t");
    const loaded = parseCif(cif("0.12346"), "t");
    const params = [{ id: "x_Fe1", label: "Fe1 x", kind: "atomX" as const, value: 0.12346, initialValue: 0.12346, fixed: false }];
    const bindings = [{ parameterId: "x_Fe1", kind: "atomX" as const, targetId: "t", targetKey: "Fe1" }];
    const table = structureTable(refined, 0, params, bindings, { x_Fe1: 0.0002 });
    expect(table.sites[0]!.x).toBe("0.1235(2)");
    const cmp = compareWithLoaded(table, refined, loaded) as { positions: string };
    expect(cmp.positions).toMatch(/largest shift 0\.0000 Å at Fe1/);
  });
});
