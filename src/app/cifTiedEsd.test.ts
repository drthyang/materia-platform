import { describe, expect, it } from "vitest";
import { singleCrystalCifText, withEsds } from "@/app/reportInputs";
import { buildSingleCrystalSpec } from "@/core/workflow/singleCrystalRefinement";
import { withEqualTies } from "@/core/refinement/constraints";
import { disorderPage } from "@/testSupport/scPages";
import type { RefinementResult } from "@/core/refinement/types";

/**
 * The single-crystal CIF carries a tied row's su: a disorder's complement
 * occupancy has its leader's, as SHELXL's CIF gives it. It exported the
 * result's own esds only, and a tied row has none.
 */
describe("a tied parameter's su in the CIF", () => {
  it("gives the complement occupancy the leader's su", () => {
    const d = disorderPage();
    const spec = buildSingleCrystalSpec(d.structure, d.dataset, { extinction: 0 });
    const params = withEqualTies(spec.params, { complement: ["occ_Al1", "occ_Ga1"] }).map((p) => (p.id === "occ_Al1" ? { ...p, value: 0.84, fixed: false } : p.id === "occ_Ga1" ? { ...p, value: 0.16 } : p));
    const result = { esd: { occ_Al1: 0.012 }, parameters: {} } as unknown as RefinementResult;
    const rows = withEsds(params, result);
    expect(rows.find((p) => p.id === "occ_Ga1")!.esd).toBeCloseTo(0.012, 12);
    // The workbench's Export CIF path.
    const structure = { ...d.structure, sites: d.structure.sites.map((s) => (s.label === "Al1" ? { ...s, occupancy: 0.84 } : s.label === "Ga1" ? { ...s, occupancy: 0.16 } : s)) };
    const cif = singleCrystalCifText({ structure, params, result, bindings: spec.bindings, refinement: { r1: 0.03, wr2: 0.07, gof: 1.02, nRef: 100, nParam: 10 } });
    const ga = cif.split("\n").find((l) => /^\s*Ga1\s/.test(l))!;
    expect(ga).toMatch(/0\.160\(12\)/);
  });
});
