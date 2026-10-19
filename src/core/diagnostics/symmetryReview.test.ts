import { describe, it, expect } from "vitest";
import { parse_structure } from "@/mcp/tools";
import { generateReflections } from "@/core/diffraction/reflections";
import { orderCandidates, reviewSymmetry } from "@/core/diagnostics/symmetryReview";

/**
 * The symmetry review (the method's last step) on a refined residual: a
 * spinel declared Fd-3m whose residual keeps intensity at the d-glide's
 * forbidden 200 points to F-43m; residual on its allowed reflections — the
 * intensity misfit refinement fixes — points nowhere.
 */

const SPINEL = `data_t
_cell_length_a 8.08
_cell_length_b 8.08
_cell_length_c 8.08
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'F d -3 m:2'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_U_iso_or_equiv
Mg1 Mg 0.125 0.125 0.125 1 0.01
`;

const phase = parse_structure({ cif: SPINEL }).structure;

/** A flat refined fit with small deterministic noise, plus residual peaks at the given d. */
function residual(peaksAt: readonly number[]) {
  const n = 4000;
  const d = Array.from({ length: n }, (_, i) => 1.2 + (4.8 * i) / (n - 1));
  const yCalc = d.map(() => 1000);
  const yObs = d.map((di, i) => 1000 + 8 * Math.sin(i * 1.7) + peaksAt.reduce((s, p) => s + 400 * Math.exp(-0.5 * ((di - p) / 0.004) ** 2), 0));
  const reflections = generateReflections(phase.cell, phase.spaceGroup, 1.2, 6).map((r) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, phaseLabel: "spinel" }));
  return { d, yObs, yCalc, sigma: yCalc.map((y) => Math.sqrt(y)), reflections };
}

const family = (hkl: string): string => hkl.split(" ").map((v) => Math.abs(Number(v))).sort().join("");

describe("the symmetry review", () => {
  it("reads intensity left at a forbidden reflection and names the subgroups that allow it", () => {
    const d200 = 8.08 / 2;
    const review = reviewSymmetry([phase], residual([d200]));
    expect(review.observedForbidden.map((o) => family(o.hkl))).toEqual(["002"]);
    expect(review.observedForbidden[0]!.sigmas).toBeGreaterThan(5);
    // F-43m keeps the lattice and drops the d-glide: it allows 200, at index 2.
    const f43m = review.candidates.find((c) => c.number === 216);
    expect(f43m).toMatchObject({ index: 2, allows: [review.observedForbidden[0]!.hkl] });
    expect(review.candidates[0]!.index).toBeLessThanOrEqual(2);
    // Every candidate allows what it claims to; none keeps the d-glide's absence.
    expect(review.candidates.every((c) => c.allows.length > 0)).toBe(true);
    expect(review.candidates.some((c) => c.number === 203)).toBe(false); // Fd-3 keeps the d-glide
    expect(review.reading).toMatch(/Put this to the user: a lower symmetry is a new model, refined again from the start/);
  });

  it("does not read intensity misfit on allowed reflections as a reason to lower the symmetry", () => {
    const d111 = 8.08 / Math.sqrt(3);
    const d311 = 8.08 / Math.sqrt(11);
    const review = reviewSymmetry([phase], residual([d111, d311]));
    expect(review.observedForbidden).toEqual([]);
    expect(review.candidates).toEqual([]);
    expect(review.tested).toBeGreaterThan(5);
    expect(review.reading).toMatch(/^No forbidden reflection of .* carries intensity in the refined fit .*Nothing in the data asks for a lower symmetry/);
  });
});

describe("the order of the candidates", () => {
  const c = (name: string, index: number, allows: string[]) => ({ name, index, domains: index, allows });
  it("puts those that allow every observed reflection first, then those that allow some, each by smallest index", () => {
    const order = orderCandidates([
      c("H4 (all, index 4)", 4, ["1 0 0", "0 0 1"]),
      c("P3 (some, index 3, allows two)", 3, ["1 0 0", "2 0 0"]),
      c("H2 (all, index 2)", 2, ["1 0 0", "0 0 1"]),
      c("P2 (some, index 2, allows one)", 2, ["1 0 0"]),
    ].map((x) => ({ ...x, allows: x.name.includes("(all") ? ["1 0 0", "0 0 1", "2 0 0"] : x.allows })), 3);
    expect(order.map((x) => x.name)).toEqual(["H2 (all, index 2)", "H4 (all, index 4)", "P2 (some, index 2, allows one)", "P3 (some, index 3, allows two)"]);
  });

  it("names the subgroup a lost centring gives: CsCl read as body-centred leaves intensity at h + k + l odd", () => {
    // The development case (dev-cscl-wrong-centring): Cs and Cl averaged on one site of Im-3m.
    const bcc = parse_structure({ cif: SPINEL.replace(/8\.08/g, "4.123").replace("F d -3 m:2", "I m -3 m").replace("Mg1 Mg 0.125 0.125 0.125", "Cs1 Cs 0 0 0") }).structure;
    const n = 4000;
    const d = Array.from({ length: n }, (_, i) => 1.1 + (3.4 * i) / (n - 1));
    const odd = [4.123, 4.123 / Math.sqrt(3), 4.123 / Math.sqrt(5)]; // 1 0 0, 1 1 1, 2 1 0
    const residualOf = {
      d,
      yCalc: d.map(() => 1000),
      yObs: d.map((di, i) => 1000 + 8 * Math.sin(i * 1.7) + odd.reduce((sum, p) => sum + 400 * Math.exp(-0.5 * ((di - p) / 0.004) ** 2), 0)),
      sigma: d.map(() => Math.sqrt(1000)),
      reflections: generateReflections(bcc.cell, bcc.spaceGroup, 1.1, 4.5).map((r) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, phaseLabel: "cscl" })),
    };
    const review = reviewSymmetry([bcc], residualOf);
    expect(review.observedForbidden.map((o) => family(o.hkl)).sort()).toEqual(["001", "012", "111"]);
    // No subgroup of the body-centred lattice allows them: every one keeps the centring.
    expect(review.candidates.filter((c) => c.allows.length === 3)).toEqual([]);
    // Dropping it gives Im-3m's four primitive subgroups; Pm-3m alone allows all three.
    expect(review.decentred.every((c) => c.index === 2 && c.allows.length > 0)).toBe(true);
    expect(review.decentred.map((c) => c.number)).toContain(221);
    const all = review.decentred.filter((c) => c.allows.length === 3);
    expect(all.map((c) => [c.name, c.number, c.index, c.lost])).toEqual([["P m -3 m", 221, 2, "(½ ½ ½)"]]);
    expect(review.reading).toMatch(/a lost centring explains: P m -3 m \(the centring \(½ ½ ½\) dropped, index 2\) allows them all\. Its model orders what this one averages/);
    expect(review.limits.join(" ")).not.toMatch(/lost centring .* not enumerated/);
  });
});
