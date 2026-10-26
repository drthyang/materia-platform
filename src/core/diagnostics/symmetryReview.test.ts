import { describe, it, expect } from "vitest";
import { parse_structure } from "@/mcp/tools";
import { generateReflections } from "@/core/diffraction/reflections";
import { orderCandidates, reviewSymmetry } from "@/core/diagnostics/symmetryReview";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import type { StructureModel, UnitCell } from "@/core/crystal/types";

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

describe("the review's names under the validation freeze", () => {
  // review_symmetry is model-visible, and frozen (docs/AGENT_PLAN.md, phase 6).
  // The subgroup lattice now names a centred parent's subgroups in their
  // standard settings, but the review keeps its names as they were until the
  // freeze lifts, and some are wrong: from the coset representatives alone,
  // I4₁/amd's Imma (#74) reads as Pmna (#53), its Imm2 (#44) as Pmn2₁ (#31)
  // and R-3c's R-3 (#148) as P-3 (#147). The lattice's own names are the right
  // ones (asserted here too), for the review once the freeze lifts.
  const review = (symbol: string, cell: UnitCell) => {
    const s: StructureModel = { id: "f", name: "f", cell, spaceGroup: buildSpaceGroup(symbol), sites: [{ label: "A1", element: "Fe", position: [0.1, 0.2, 0.3], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } }] };
    const allowed = generateReflections(cell, s.spaceGroup, 1.2, 6);
    const keys = new Set(allowed.map((r) => `${r.h} ${r.k} ${r.l}`));
    const forbidden = generateReflections(cell, s.spaceGroup, 1.2, 6, { absences: false }).filter((r) => !keys.has(`${r.h} ${r.k} ${r.l}`));
    const n = 6000;
    const d = Array.from({ length: n }, (_, i) => 1.2 + (4.8 * i) / (n - 1));
    const yCalc = d.map(() => 1000);
    const yObs = d.map((di, i) => 1000 + 8 * Math.sin(i * 1.7) + forbidden.reduce((sum, f) => sum + 400 * Math.exp(-0.5 * ((di - f.d) / 0.004) ** 2), 0));
    const reflections = allowed.map((r) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, phaseLabel: "f" }));
    return { s, out: reviewSymmetry([s], { d, yObs, yCalc, sigma: yCalc.map((y) => Math.sqrt(y)), reflections }) };
  };
  const rows = (r: ReturnType<typeof reviewSymmetry>) => r.candidates.map((c) => [c.name, c.number ?? null, c.index, c.domains]);

  it("I4₁/amd: the candidates as main had them", () => {
    const { s, out } = review("I 41/a m d:2", { a: 5, b: 5, c: 12, alpha: 90, beta: 90, gamma: 90 });
    expect(rows(out)).toEqual([
      ["I -4 m 2", 119, 2, 1], ["P m n a", 53, 2, 1], ["I 41 2 2", 98, 2, 1], ["I 41/a:2", 88, 2, 1],
      ["I -4", 82, 4, 1], ["P m n 21", 31, 4, 1], ["P 1 2/n 1", 13, 4, 2], ["222 (point group; index 4)", null, 4, 1],
    ]);
    const names = new Set(structuralSubgroupLattice(s, { maxIndex: 6 }).nodes.map((n) => n.identity.number));
    for (const right of [74, 44, 15, 22]) expect(names.has(right)).toBe(true);
  });

  it("R-3c: the candidates as main had them", () => {
    const { s, out } = review("R -3 c:H", { a: 5, b: 5, c: 13.7, alpha: 90, beta: 90, gamma: 120 });
    expect(rows(out)).toEqual([
      ["P -3", 147, 2, 1], ["R 3 2:H", 155, 2, 1], ["P 3", 143, 4, 1], ["2 (point group; index 6)", null, 6, 3],
      ["P -1", 2, 6, 1], ["m (point group; index 6)", null, 6, 3],
    ]);
    expect(out.decentred.map((c) => [c.name, c.number ?? null, c.index, c.domains])).toEqual([["P -3 c 1", 165, 3, 1], ["a primitive subgroup (index 3)", null, 3, 2]]);
    const names = new Set(structuralSubgroupLattice(s, { maxIndex: 6 }).nodes.map((n) => n.identity.number));
    for (const right of [148, 146, 15, 5, 9]) expect(names.has(right)).toBe(true);
  });
});
