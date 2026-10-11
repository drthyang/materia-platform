import { describe, it, expect } from "vitest";
import { pyridylPage } from "@/testSupport/scPages";
import { buildSingleCrystalSpec, refineSingleCrystal, singleCrystalRefinementComparison, SINGLE_CRYSTAL_REFINE_OPTIONS, withFitWeights } from "@/core/workflow/singleCrystalRefinement";
import { suggestShelxWeighting } from "@/core/diffraction/singleCrystalFactors";
import type { SingleCrystalDataset } from "@/core/diffraction/types";
import { ridingRules } from "@/core/crystal/riding";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseCif } from "@/parsers/cif";
import { parse_single_crystal_data } from "@/mcp/tools";
import { optimalScale } from "@/core/workflow/singleCrystalRefinement";

/** Deterministic standard normals (mulberry32 into Box–Muller). */
function normals(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/**
 * SHELXL's WGHT: data whose errors grow with the intensity beyond the σ the
 * file gives (a 4 % error on every Fo², as an absorption or scaling error
 * leaves) — the suggestion finds a ≈ 0.04, and the fit weighted by it reaches
 * GooF ≈ 1 where 1/σ² weights leave it far above.
 */
describe("SHELXL weighting scheme", () => {
  const page = pyridylPage();
  const truth = { ...page.truth, riding: ridingRules(page.truth).rules };
  const spec = buildSingleCrystalSpec(truth, page.dataset, { extinction: 0 });
  const fc2 = singleCrystalRefinementComparison(truth, page.dataset, spec.params, spec.bindings).rows.map((r) => r.fcSq);
  const noise = normals(5);
  const dataset: SingleCrystalDataset = {
    ...page.dataset,
    reflections: page.dataset.reflections.map((r, i) => {
      const extra = 0.04 * fc2[i]!;
      return { ...r, iObs: fc2[i]! + Math.sqrt(r.sigma! ** 2 + extra * extra) * noise() };
    }),
  };

  it("suggests the a that the data's extra error needs, and flattens the analysis of variance", () => {
    const s = suggestShelxWeighting(dataset.reflections.map((r) => r.iObs), fc2, dataset.reflections.map((r) => r.sigma!), spec.params.filter((p) => !p.fixed).length);
    expect(s.a).toBeGreaterThan(0.034);
    expect(s.a).toBeLessThan(0.046);
    expect(s.goof).toBeCloseTo(1, 1);
    for (const g of s.bins) expect(Math.abs(g - 1)).toBeLessThan(0.25);
    // With σ alone the GooF is high, the strong reflections carrying the misfit.
    expect(singleCrystalRefinementComparison(truth, dataset, spec.params, spec.bindings, {}).agreement.goof).toBeGreaterThan(1.3);
    // Data the σ describe keep w = 1/σ².
    const honest = suggestShelxWeighting(page.dataset.reflections.map((r) => r.iObs), fc2, page.dataset.reflections.map((r) => r.sigma!), 40);
    expect(honest.a).toBeLessThan(0.01);
  });

  it("refines with the scheme's weights re-evaluated at its own Fc², to GooF ≈ 1", () => {
    const start = { ...page.structure, riding: ridingRules(page.structure, { distance: 0.95 }).rules };
    const startSpec = buildSingleCrystalSpec(start, dataset, { extinction: 0 });
    const params = startSpec.params.map((p) => ({ ...p, fixed: !(p.kind === "scale" || p.kind === "positionShift" || p.kind === "bIso") }));
    const weighted = { ...dataset, weighting: { a: 0.04, b: 0 } };
    const result = refineSingleCrystal(start, weighted, params, startSpec.bindings, SINGLE_CRYSTAL_REFINE_OPTIONS);
    expect(result.status).toBe("converged");
    const refined = params.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
    const cmp = singleCrystalRefinementComparison(start, weighted, refined, startSpec.bindings);
    expect(cmp.agreement.goof).toBeGreaterThan(0.85);
    expect(cmp.agreement.goof).toBeLessThan(1.15);
    // Its weights are those of its own Fc²: another pass moves nothing.
    const again = refineSingleCrystal(start, weighted, refined, startSpec.bindings, SINGLE_CRYSTAL_REFINE_OPTIONS);
    for (const p of refined.filter((q) => !q.fixed)) expect(Math.abs((again.parameters[p.id] ?? p.value) - p.value) / (again.esd[p.id] ?? 1)).toBeLessThan(0.1);
    // Weights fixed on the dataset stay fixed: one refinement.
    expect(withFitWeights(start, weighted, refined, startSpec.bindings).fitSigma).toHaveLength(dataset.reflections.length);
    expect(withFitWeights(start, dataset, refined, startSpec.bindings).fitSigma).toBeUndefined();
  });

  const DIPYRIDYL = { cif: "GSAS-II-tutorials/sc/S2dipyridyl.cif", fcf: "GSAS-II-tutorials/sc/S2dipyridyl.fcf" };
  it.skipIf(!dataExists(DIPYRIDYL.cif) || !dataExists(DIPYRIDYL.fcf))("reproduces SHELXL's wR2 and GooF for dipyridyl disulfide with its WGHT, and suggests a scheme near it", () => {
    const model = parseCif(readFileSync(dataPath(DIPYRIDYL.cif), "utf8"), "dipy");
    const structure = { ...model, riding: ridingRules(model).rules };
    const listing = parse_single_crystal_data({ text: readFileSync(dataPath(DIPYRIDYL.fcf), "utf8"), name: "S2dipyridyl.fcf" }).dataset as SingleCrystalDataset;
    const data: SingleCrystalDataset = { ...listing, radiation: { kind: "xray", wavelength: 0.71073, polarization: 0.5 } };
    const s = buildSingleCrystalSpec(structure, data, { extinction: 0 });
    const k = optimalScale(structure, data, s.params, s.bindings)!;
    const params = s.params.map((p) => (p.kind === "scale" ? { ...p, value: k } : p));
    // SHELXL: WGHT 0.0362 0.7686, 4508 reflections, 254 parameters, wR2 7.86 %, GooF 1.041.
    const cmp = singleCrystalRefinementComparison(structure, { ...data, weighting: { a: 0.0362, b: 0.7686 } }, params, s.bindings);
    const free = params.filter((p) => !p.fixed).length;
    expect(cmp.agreement.wr2).toBeCloseTo(0.0786, 2);
    expect(cmp.agreement.goof * Math.sqrt((4508 - free) / (4508 - 254))).toBeCloseTo(1.041, 1);
    const suggested = suggestShelxWeighting(cmp.rows.map((r) => r.foSq), cmp.rows.map((r) => r.fcSq), cmp.rows.map((r) => r.sigma), 254);
    expect(suggested.a).toBeGreaterThan(0.025);
    expect(suggested.a).toBeLessThan(0.045);
    expect(suggested.b).toBeGreaterThan(0.4);
    expect(suggested.b).toBeLessThan(1.5);
  });
});
