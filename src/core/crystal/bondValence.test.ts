import { describe, it, expect } from "vitest";
import { parseCif } from "@/parsers/cif";
import { bondValenceReading, bondValenceSums } from "@/core/crystal/bondValence";

const cif = (cell: string, sg: string, atoms: string[]): string => [
  "data_t", cell, `_symmetry_space_group_name_H-M '${sg}'`,
  "loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z", "_atom_site_occupancy", "_atom_site_U_iso_or_equiv",
  ...atoms,
].join("\n");

describe("bond-valence sums", () => {
  it("MgO: six Mg–O at 2.106 Å sum to 2, the state assumed when the CIF gives none", () => {
    const mgo = parseCif(cif("_cell_length_a 4.212\n_cell_length_b 4.212\n_cell_length_c 4.212\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90", "F m -3 m", ["Mg1 Mg 0 0 0 1 0.005", "O1 O 0.5 0.5 0.5 1 0.005"]), "mgo");
    const [mg] = bondValenceSums(mgo);
    expect(mg).toMatchObject({ site: "Mg1", element: "Mg", valence: 2, assumed: true });
    expect(mg!.coordination).toBe(6);
    expect(mg!.meanDistance).toBeCloseTo(2.106, 3);
    expect(mg!.sum).toBeCloseTo(6 * Math.exp((1.693 - 2.106) / 0.37), 3);
    expect(bondValenceReading([mg!])).toMatch(/agree with the valences/);
  });

  it("Cr₂WO₆ at 150 K (the refined trirutile): W⁶⁺ 6.2, Cr³⁺ 3.0, from the CIF's oxidation states", () => {
    const s = parseCif(cif("_cell_length_a 4.57531\n_cell_length_b 4.57531\n_cell_length_c 8.8537\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90", "P 42/m n m", [
      "W1 W6+ 0 0 0 1 0.005", "Cr1 Cr3+ 0 0 0.3345 1 0.005", "O1 O2- 0.2974 0.2974 0 1 0.005", "O2 O2- 0.3059 0.3059 0.3393 1 0.005",
    ]), "cwo");
    const sums = new Map(bondValenceSums(s).map((v) => [v.site, v]));
    expect([...sums.keys()]).toEqual(["W1", "Cr1"]);
    expect(sums.get("W1")).toMatchObject({ valence: 6, assumed: false, coordination: 6 });
    // The first shell gives 6.17 and 3.02; the farther O add a few hundredths.
    expect(sums.get("W1")!.sum).toBeGreaterThan(6.1);
    expect(sums.get("W1")!.sum).toBeLessThan(6.35);
    expect(sums.get("Cr1")!.sum).toBeGreaterThan(2.95);
    expect(sums.get("Cr1")!.sum).toBeLessThan(3.15);
    expect(sums.get("Cr1")!.meanDistance).toBeCloseTo(1.978, 2);
  });

  it("ZnO (P6₃mc) with 4-decimal special positions: Zn²⁺ fourfold, BVS near 2, no duplicated symmetry copies", () => {
    const zno = parseCif(cif("_cell_length_a 3.2498\n_cell_length_b 3.2498\n_cell_length_c 5.2066\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 120", "P 63 m c", [
      "Zn1 Zn 0.3333 0.6667 0 1 0.005", "O1 O 0.3333 0.6667 0.3821 1 0.005",
    ]), "zno");
    const [zn] = bondValenceSums(zno);
    expect(zn!.coordination).toBe(4);
    expect(zn!.sum).toBeGreaterThan(1.85);
    expect(zn!.sum).toBeLessThan(2.05);
  });

  it("flags a cation far from its valence: W on the Cr site of the same structure", () => {
    const s = parseCif(cif("_cell_length_a 4.57531\n_cell_length_b 4.57531\n_cell_length_c 8.8537\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90", "P 42/m n m", [
      "Cr1 Cr3+ 0 0 0 1 0.005", "W1 W6+ 0 0 0.3345 1 0.005", "O1 O2- 0.2974 0.2974 0 1 0.005", "O2 O2- 0.3059 0.3059 0.3393 1 0.005",
    ]), "swapped");
    const sums = new Map(bondValenceSums(s).map((v) => [v.site, v]));
    // Cr³⁺ in the short W–O octahedron is over-bonded, W⁶⁺ in Cr's long one under-bonded.
    expect(sums.get("Cr1")!.deviation).toBeGreaterThan(0.15);
    expect(sums.get("W1")!.deviation).toBeLessThan(-0.1);
    expect(bondValenceReading([...sums.values()])).toMatch(/Cr1 is more than 15 % from the valence: an over-bonded site/);
  });
});
