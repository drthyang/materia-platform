import { describe, it, expect } from "vitest";
import { buildSingleCrystalRefinementProblem, buildSingleCrystalSpec } from "@/core/workflow/singleCrystalRefinement";
import { chiralPage, corundumPage, disorderPage, pyridylPage } from "@/testSupport/scPages";
import { withEqualTies } from "@/core/refinement/constraints";
import { INVERSION_TWIN } from "@/core/diffraction/types";
import { withAdpModel } from "@/core/crystal/adp";
import type { ExtinctionModel } from "@/core/diffraction/types";
import type { RefinementProblem } from "@/core/refinement/engine";
import { parseCif } from "@/parsers/cif";
import { generateReflections } from "@/core/diffraction/reflections";
import { ridingRules } from "@/core/crystal/riding";

/**
 * Every analytic column of the single-crystal problem against the central
 * finite difference it replaces: the scale, a batch scale, the extinction
 * (SHELXL's and Becker–Coppens, at each reflection's own wavelength), the
 * position and U-tensor modes on special positions, B_iso and occupancy.
 */
describe("single-crystal analytic Jacobian", () => {
  function centralDifference(problem: RefinementProblem, id: string, base: number): Float64Array {
    const values: Record<string, number> = {};
    for (const p of problem.parameters) values[p.id] = p.value;
    const h = Math.max(1e-7, Math.abs(base) * 1e-6);
    const yF = problem.calculate({ ...values, [id]: base + h });
    const yB = problem.calculate({ ...values, [id]: base - h });
    const col = new Float64Array(yF.length);
    for (let i = 0; i < col.length; i++) col[i] = (yF[i]! - yB[i]!) / (2 * h);
    return col;
  }

  function check(problem: RefinementProblem): number {
    const free = problem.parameters.filter((p) => !p.fixed && !p.expression);
    const columns = problem.analyticColumns!(free, free.map((p) => p.value));
    let checked = 0;
    free.forEach((p, j) => {
      const analytic = columns[j];
      expect(analytic, `${p.id} has an analytic column`).not.toBeNull();
      const fd = centralDifference(problem, p.id, p.value);
      const scale = Math.max(...Array.from(fd, Math.abs), 1e-12);
      for (let i = 0; i < fd.length; i++) expect(Math.abs(analytic![i]! - fd[i]!) / scale, `${p.id} row ${i}`).toBeLessThan(2e-5);
      checked++;
    });
    return checked;
  }

  it("carries a riding hydrogen's derivatives on its parent's position and U modes", () => {
    const base = parseCif(`data_t
_cell_length_a 7.1
_cell_length_b 5.3
_cell_length_c 9.7
_cell_angle_alpha 90
_cell_angle_beta 101.3
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 21/c'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
_atom_site_adp_type
S1 S 0.123 0.271 0.088 0.021 Uani
C1 C 0.311 0.105 0.247 0.025 Uani
H1 H 0.402 0.183 0.301 0.030 Uiso
loop_
_atom_site_aniso_label
_atom_site_aniso_U_11
_atom_site_aniso_U_22
_atom_site_aniso_U_33
_atom_site_aniso_U_12
_atom_site_aniso_U_13
_atom_site_aniso_U_23
S1 0.020 0.024 0.019 0.002 0.004 -0.001
C1 0.026 0.022 0.027 -0.003 0.006 0.002
`, "t");
    const { rules } = ridingRules(base);
    expect(rules).toEqual([expect.objectContaining({ site: "H1", parent: "C1", geometry: "fixed", uFactor: 1.2 })]);
    const structure = { ...base, riding: rules };
    const radiation = { kind: "xray" as const, wavelength: 0.71073, polarization: 0.5 };
    const dataset = { id: "t", name: "t", radiation, reflections: generateReflections(base.cell, base.spaceGroup, 0.9, 20).map((r) => ({ h: r.h, k: r.k, l: r.l, iObs: 100, sigma: 3 })) };
    const spec = buildSingleCrystalSpec(structure, dataset, { extinction: 0 });
    // No parameter for the riding hydrogen.
    expect(spec.params.some((p) => p.id.includes("H1"))).toBe(false);
    const params = spec.params.map((p) => ({ ...p, fixed: p.kind === "extinction" }));
    expect(check(buildSingleCrystalRefinementProblem(structure, dataset, params, spec.bindings))).toBeGreaterThanOrEqual(13);
  });

  it("turns an sp² hydrogen with the bisector when its carbon or the carbon's neighbours move (AFIX 43), exactly", () => {
    const page = pyridylPage();
    const { rules } = ridingRules(page.structure, { distance: 0.95 });
    expect(rules.filter((r) => r.geometry === "aromatic")).toHaveLength(4);
    const structure = { ...page.structure, riding: rules };
    const spec = buildSingleCrystalSpec(structure, page.dataset, { extinction: 0 });
    const params = spec.params.map((p) => ({ ...p, fixed: !(p.kind === "positionShift" || p.kind === "bIso") }));
    // Every position column of a ring atom carries the hydrogens it places; the central difference sees the bisector turn.
    expect(check(buildSingleCrystalRefinementProblem(structure, page.dataset, params, spec.bindings))).toBeGreaterThanOrEqual(30);
  });

  it("differentiates a twinned fit exactly: the twin fraction, and every structural column through both domains", () => {
    const page = chiralPage();
    const dataset = { ...page.dataset, twinLaws: [INVERSION_TWIN] };
    const spec = buildSingleCrystalSpec(page.structure, dataset, { extinction: 2, twinFractions: [0.3] });
    const params = spec.params.map((p) => ({ ...p, fixed: !(p.kind === "scale" || p.kind === "extinction" || p.kind === "twinFraction" || p.kind === "positionShift" || p.kind === "bIso") }));
    expect(params.find((p) => p.kind === "twinFraction")).toMatchObject({ id: "twin_1", label: "inversion twin fraction (Flack x)", value: 0.3 });
    expect(check(buildSingleCrystalRefinementProblem(page.structure, dataset, params, spec.bindings))).toBeGreaterThanOrEqual(40);
  });

  it("carries a tie's followers: a disorder's complement occupancy and the ADP held to the other alternative's", () => {
    const page = disorderPage();
    const spec = buildSingleCrystalSpec(page.structure, page.dataset, { extinction: 0 });
    expect(spec.params.filter((p) => p.kind === "occupancy").map((p) => p.id)).toEqual(["occ_Al1", "occ_Ga1"]);
    const tied = withEqualTies(spec.params, { complement: ["occ_Al1", "occ_Ga1"], equal: ["B_Al1", "B_Ga1"] });
    const params = tied.map((p) => (p.expression ? p : { ...p, fixed: !(p.kind === "scale" || p.kind === "occupancy" || p.kind === "bIso" || p.kind === "positionShift") }));
    const problem = buildSingleCrystalRefinementProblem(page.structure, page.dataset, params, spec.bindings);
    expect(check(problem)).toBeGreaterThanOrEqual(30);
  });

  for (const model of ["shelx", "bc-1-lorentzian"] as ExtinctionModel[]) {
    it(`matches finite differences for every kind, extinction ${model}, TOF Laue with batches`, () => {
      const c = corundumPage({ extinction: model === "shelx" ? 20 : 1e-4, ...(model === "shelx" ? {} : { extinctionModel: model }), laue: true, batches: [1, 1.05], dMin: 0.8 });
      const aniso = withAdpModel(c.structure, "anisotropic");
      const dataset = { ...c.dataset, extinctionModel: model };
      // Isotropic and anisotropic sites both: Al anisotropic, O isotropic.
      const structure = { ...aniso, sites: aniso.sites.map((s) => (s.label === "O1" ? c.structure.sites.find((x) => x.label === "O1")! : s)) };
      const spec = buildSingleCrystalSpec(structure, dataset, { extinction: model === "shelx" ? 15 : 8e-5, refineOccupancy: true });
      const params = spec.params.map((p) => ({ ...p, fixed: p.kind === "occupancy" && p.id.includes("Al") ? false : p.kind === "occupancy" ? true : false }));
      const problem = buildSingleCrystalRefinementProblem(structure, dataset, params, spec.bindings);
      const n = check(problem);
      expect(n).toBeGreaterThanOrEqual(8);
    });
  }
});
