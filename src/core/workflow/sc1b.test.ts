import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseCif } from "@/parsers/cif";
import { loadReflectionDataset } from "@/app/loadData";
import { mergedDataset } from "@/core/workflow/singleCrystalRefinement";
import { mergeEquivalents } from "@/core/diffraction/merge";
import { reflectionStatistics } from "@/core/diagnostics/reflectionStatistics";

/**
 * 1b (Luo et al., the Bruker–MIT workshop): SHELXL's CIF carries its own
 * measurement (_shelx_hkl_file). Merged as SHELXL's MERG 2 — the Friedel
 * opposites apart in P2₁2₁2₁ — it is the 2482 reflections SHELXL refined
 * against (_reflns_number_total).
 */
const CIF = "GSAS-II-tutorials/sc/1b.cif";

describe.skipIf(!dataExists(CIF))("1b, from the CIF's own measurement", () => {
  const text = readFileSync(dataPath(CIF), "utf8");
  const structure = parseCif(text, "1b");
  const loaded = loadReflectionDataset(text, structure, "1b-hkl", "1b.cif");

  it("reads the measurement at Mo Kα, and merges it to SHELXL's unique set with the Friedel opposites apart", () => {
    expect(loaded.format).toBe("shelx-cif");
    expect(loaded.dataset.radiation).toMatchObject({ kind: "xray", wavelength: 0.71073 });
    const merged = mergedDataset(loaded.dataset, structure.spaceGroup.operations);
    expect(merged.merged).toMatchObject({ from: loaded.dataset.reflections.length, friedelApart: true });
    // The systematic absences left out, as SHELXL leaves them out of the refinement.
    expect(merged.merged!.absences).toBe(21);
    expect(merged.reflections.length).toBe(2482);
  });

  it("reads R_int as SHELXL reports it: the Friedel mates apart, the absences out", () => {
    const rows = loaded.dataset.reflections.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.iObs, sigma: r.sigma ?? 0 }));
    const st = reflectionStatistics(rows, structure.cell, structure.spaceGroup);
    // SHELXL: _diffrn_reflns_av_R_equivalents 0.0293. In the Laue class, the Bijvoet pairs merged, 3.04 %.
    expect(st.friedel.rIntApart).toBeCloseTo(0.0293, 4);
    expect(mergeEquivalents(rows, structure.spaceGroup.operations).statistics.rInt).toBeCloseTo(0.0304, 4);
  });
});

describe.skipIf(!dataExists(CIF))("1b refined as SHELXL refined it", () => {
  it("reproduces SHELXL's fit from its own model: 142 parameters, 8 restraints, the inversion twin's Flack x", async () => {
    const { INVERSION_TWIN } = await import("@/core/diffraction/types");
    const { ridingRules } = await import("@/core/crystal/riding");
    const { nearestPair, restraintCount } = await import("@/core/crystal/restraints");
    const { withEqualTies } = await import("@/core/refinement/constraints");
    const { buildSingleCrystalSpec, refineSingleCrystal, singleCrystalRefinementComparison, SINGLE_CRYSTAL_REFINE_OPTIONS } = await import("@/core/workflow/singleCrystalRefinement");
    // SHELXL's model as its .res has it: the inversion twin (TWIN, BASF), the five hydrides refined under
    // its four SADI and their U riding (-1.2), the methyls rotating (AFIX 137) and the CH2 (AFIX 23),
    // Al1/Ga1 a PART 1/2 split tied 21/-21 with EADP, WGHT 0.0271 0.2580, no EXTI.
    const text = readFileSync(dataPath(CIF), "utf8");
    const base = parseCif(text, "1b");
    const loaded = loadReflectionDataset(text, base, "1b-hkl", "1b.cif").dataset;
    const pair = (a: string, b: string) => {
      const p = nearestPair(base, a, b)!;
      return { from: p.from, to: p.to, op: p.op, cell: p.cell };
    };
    const hydrides = ["H1'", "H2'", "H3'", "H4'", "H5'"];
    const restraints = [
      { kind: "sadi" as const, sigma: 0.005, pairs: [pair("Ga2", "H3'"), pair("Ga2", "H4'"), pair("Ga2", "H5'")] },
      { kind: "sadi" as const, sigma: 0.02, pairs: [pair("H3'", "H4'"), pair("H3'", "H5'"), pair("H4'", "H5'")] },
      { kind: "sadi" as const, sigma: 0.02, pairs: [pair("Al1", "H1'"), pair("Al1", "H2'")] },
      { kind: "sadi" as const, sigma: 0.02, pairs: [pair("Ga1", "H1'"), pair("Ga1", "H2'")] },
    ];
    expect(restraintCount(restraints)).toBe(8);
    const structure = { ...base, riding: ridingRules(base, { refine: hydrides }).rules, restraints };
    const dataset = { ...mergedDataset(loaded, base.spaceGroup.operations), twinLaws: [INVERSION_TWIN], weighting: { a: 0.0271, b: 0.258 } };
    const spec = buildSingleCrystalSpec(structure, dataset, { twinFractions: [0.435] });
    const tied = withEqualTies(spec.params, {
      complement: ["occ_Al1", "occ_Ga1"],
      groups: spec.params.filter((p) => p.id.startsWith("U_Al1_")).map((p) => [p.id, p.id.replace("U_Al1_", "U_Ga1_")]),
    });
    const params = tied.map((p) => (p.expression ? p : { ...p, fixed: p.kind === "extinction" }));
    const free = params.filter((p) => !p.fixed && !p.expression);
    expect(free.length).toBe(142);
    const result = refineSingleCrystal(structure, dataset, params, spec.bindings, SINGLE_CRYSTAL_REFINE_OPTIONS);
    expect(result.status).toBe("converged");
    const refined = params.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
    const ag = singleCrystalRefinementComparison(structure, dataset, refined, spec.bindings).agreement;
    // SHELXL: R1 2.04 % over 2334 Fo > 4σ(Fo), wR2 5.04 %, GooF 1.044 (WGHT 0.0271 0.2580 on its absolute scale).
    expect(Math.abs(ag.r1 - 0.0204)).toBeLessThan(0.001);
    expect(Math.abs(ag.wr2 - 0.0504)).toBeLessThan(0.002);
    expect(Math.abs(ag.goof - 1.044)).toBeLessThan(0.05);
    expect(Math.abs(ag.observed - 2334)).toBeLessThan(15);
    // Flack x 0.435(15) and the Al share 0.844(2): within SHELXL's esds.
    expect(Math.abs(result.parameters.twin_1! - 0.435)).toBeLessThan(0.015);
    expect(Math.abs(result.parameters.occ_Al1! - 0.844)).toBeLessThan(0.002);
    expect(result.parameters.occ_Ga1 ?? 1 - result.parameters.occ_Al1!).toBeCloseTo(1 - result.parameters.occ_Al1!, 12);
    // The split site's positions correlate at −0.99 with each other and with the shared U: their esds are
    // the full covariance's (SHELXL: Al1 x 0.0012, Ga1 x 0.003, U11 0.0010), not the 3–5× smaller
    // conditional ones an unconverged eigen-decomposition gave.
    expect(result.esd.pos_Al1_0!).toBeGreaterThan(0.0008);
    expect(result.esd.pos_Ga1_0!).toBeGreaterThan(0.0017);
    expect(result.esd.U_Al1_0!).toBeGreaterThan(0.0007);
    expect(result.esd.occ_Al1!).toBeGreaterThan(0.0015);
    expect(result.diagnostics?.highCorrelations.some((c) => [c.parameterIdA, c.parameterIdB].sort().join() === "pos_Al1_1,pos_Ga1_1" && c.coefficient < -0.95)).toBe(true);
    // A good start converges in a few cycles.
    expect(result.history.length).toBeLessThan(15);
  }, 600_000);
});
