import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseShelxIns } from "@/parsers/shelxIns";
import { loadReflectionDataset } from "@/app/loadData";
import { ridingRules } from "@/core/crystal/riding";
import { floatingOrigins } from "@/core/crystal/polarOrigin";
import { invertedModel } from "@/core/crystal/inversion";
import { EIGHT_PI_SQUARED } from "@/core/crystal/adp";
import type { StructureModel } from "@/core/crystal/types";
import type { RefinementParameter } from "@/core/refinement/types";
import type { SingleCrystalDataset } from "@/core/diffraction/types";
import { buildSingleCrystalSpec, parsonsOfModel, refineSingleCrystal, singleCrystalRefinementComparison, SINGLE_CRYSTAL_REFINE_OPTIONS } from "@/core/workflow/singleCrystalRefinement";

/**
 * 3a (the GSAS-II merohedral-twin tutorial): Cs(C₅Me₅)·py in P6₁, twinned by
 * [[0,1,0],[1,0,0],[0,0,−1]], refined by SHELXL against the listing it wrote
 * (LIST 4: its Fo² with the extinction divided out). Its .ins: R1 0.0218 for
 * the 1458 reflections with Fo > 4σ(Fo) and 0.0220 for all 1465, 162
 * parameters and 1 restraint (the floating origin along c), BASF 0.34068,
 * the methyl hydrogens' U one free variable, 0.08883.
 */
const INS = "GSAS-II-tutorials/sc/3a.ins";
const FCF = "GSAS-II-tutorials/sc/3a.fcf";
const FREE = new Set(["scale", "twinFraction", "positionShift", "uAniso", "ridingTorsion", "bIso"]);

describe.skipIf(!dataExists(INS) || !dataExists(FCF))("3a, refined as SHELXL refined it", () => {
  const { structure: loaded, instructions } = parseShelxIns(readFileSync(dataPath(INS), "utf8"), "3a");
  const fcf = readFileSync(dataPath(FCF), "utf8");
  const ride = (s: StructureModel): StructureModel => ({ ...s, riding: ridingRules(s, { temperature: 293, sharedU: [["methyl"]] }).rules });
  const fit = (structure: StructureModel, laws = [{ matrix: instructions.twin!.matrix }]): { dataset: SingleCrystalDataset; params: RefinementParameter[]; spec: ReturnType<typeof buildSingleCrystalSpec>; result: ReturnType<typeof refineSingleCrystal> } => {
    const data = loadReflectionDataset(fcf, structure, "3a-hkl", "3a.fcf", { wavelength: instructions.wavelength }).dataset;
    const dataset = { ...data, twinLaws: laws, weighting: instructions.weighting! };
    const spec = buildSingleCrystalSpec(structure, dataset, { scale: 1, extinction: 0, twinFractions: laws.length === 1 ? instructions.basf : laws.map(() => 0.1) });
    // EXTI stays out: the listing's Fo² have SHELXL's extinction divided out.
    const free = spec.params.map((p) => ({ ...p, fixed: !FREE.has(p.kind) }));
    const result = refineSingleCrystal(structure, dataset, free, spec.bindings, SINGLE_CRYSTAL_REFINE_OPTIONS);
    return { dataset, spec, result, params: free.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value })) };
  };
  const p61 = ride(loaded);
  const asShelxl = fit(p61);

  it("reproduces SHELXL: R1 2.18 % on 1458 reflections, 161 parameters with EXTI the 162nd, the origin restrained, BASF and the methyl U", () => {
    const { dataset, params, spec, result } = asShelxl;
    expect(result.status).toBe("converged");
    const ag = singleCrystalRefinementComparison(p61, dataset, params, spec.bindings).agreement;
    expect(ag.observed).toBe(1458);
    expect(ag.total).toBe(1465);
    expect(ag.r1).toBeCloseTo(0.0218, 4);
    expect(ag.r1All).toBeCloseTo(0.0220, 4);
    expect(params.filter((p) => !p.fixed && !p.expression)).toHaveLength(161);
    expect(params.find((p) => p.kind === "extinction")).toMatchObject({ fixed: true, value: 0 });
    // SHELXL's one restraint: the floating origin along c.
    expect(floatingOrigins(p61, params, spec.bindings).map((o) => o.axis)).toEqual(["c"]);
    expect(result.diagnostics?.svdZeroCount).toBe(0);
    expect(result.parameters.twin_1).toBeCloseTo(0.34068, 3);
    expect(result.parameters.B_shared_1! / EIGHT_PI_SQUARED).toBeCloseTo(0.08883, 3);
  }, 120_000);

  it("finds the model's hand inverted: Parsons' x near 1 in P6₁, near 0 in P6₅, and the enantiomorph fits better", () => {
    const hand = parsonsOfModel(p61, asShelxl.dataset, asShelxl.params, asShelxl.spec.bindings)!;
    expect(hand.quotients).toBe(432);
    expect(hand.x).toBeGreaterThan(1 - 3 * hand.esd);
    expect(hand.esd).toBeLessThan(0.08);
    const p65 = ride(invertedModel(loaded).structure);
    expect(p65.spaceGroup.number).toBe(170);
    const other = fit(p65);
    const before = singleCrystalRefinementComparison(p61, asShelxl.dataset, asShelxl.params, asShelxl.spec.bindings).agreement;
    const after = singleCrystalRefinementComparison(p65, other.dataset, other.params, other.spec.bindings).agreement;
    expect(after.r1).toBeCloseTo(0.0183, 3);
    // Hamilton's ratio of wR2 for 161 parameters and 1465 reflections: far beyond any table.
    expect(before.wr2 / after.wr2).toBeGreaterThan(1.15);
    const flipped = parsonsOfModel(p65, other.dataset, other.params, other.spec.bindings)!;
    expect(Math.abs(flipped.x)).toBeLessThan(2 * flipped.esd);
    expect(other.result.parameters.twin_1).toBeCloseTo(0.340, 2);
  }, 240_000);
});
