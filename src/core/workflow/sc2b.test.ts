import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseShelxIns } from "@/parsers/shelxIns";
import { loadReflectionDataset } from "@/app/loadData";
import { ridingRules } from "@/core/crystal/riding";
import { floatingOrigins } from "@/core/crystal/polarOrigin";
import { reflectionStatistics } from "@/core/diagnostics/reflectionStatistics";
import { merohedralTwinLaws } from "@/core/diagnostics/twinLaws";
import type { Mat3 } from "@/core/math/types";
import { buildSingleCrystalSpec, mergedDataset, parsonsOfModel, refineSingleCrystal, singleCrystalRefinementComparison, SINGLE_CRYSTAL_REFINE_OPTIONS } from "@/core/workflow/singleCrystalRefinement";

/**
 * 2b (Victor Young's merohedral-twin example, the GSAS-II tutorials): an Al
 * complex, C₅₅H₈₂NO₄Al in P3₂, Mo Kα at 173 K. The .ins carries SHELXL's
 * final model with its TWIN and BASF commented out; its REM lines give R1
 * 4.33 % for the 7597 reflections with Fo > 4σ(Fo) and 5.17 % for all 8414,
 * 567 parameters and 1 restraint (the floating origin along c), WGHT 0.0436
 * 0.2952 — refined with TWIN 0 1 0 1 0 0 0 0 −1, BASF 0.4966.
 */
const INS = "GSAS-II-tutorials/sc/2b.ins";
const HKL = "GSAS-II-tutorials/sc/2b.hkl";
const LAW: Mat3 = [[0, 1, 0], [1, 0, 0], [0, 0, -1]];
const FREE = new Set(["scale", "twinFraction", "positionShift", "uAniso", "ridingTorsion"]);

describe.skipIf(!dataExists(INS) || !dataExists(HKL))("2b, a near-perfect merohedral twin, refined as SHELXL refined it", () => {
  // The data is gitignored and CI has none: return before reading it, or collection fails.
  if (!dataExists(INS) || !dataExists(HKL)) return;
  const { structure: loaded, instructions } = parseShelxIns(readFileSync(dataPath(INS), "utf8"), "2b");
  const measured = loadReflectionDataset(readFileSync(dataPath(HKL), "utf8"), loaded, "2b-hkl", "2b.hkl", { wavelength: instructions.wavelength }).dataset;
  const merged = mergedDataset(measured, loaded.spaceGroup.operations);
  const structure = { ...loaded, riding: ridingRules(loaded, { temperature: instructions.temperature ?? 293 }).rules };

  it("reads SHELXL's model at 173 K with its twin taken out, and merges its 8435 measurements to SHELXL's 8414", () => {
    expect(loaded.spaceGroup.hermannMauguin).toBe("P 32");
    expect(loaded.sites.filter((s) => s.element !== "H")).toHaveLength(61);
    expect(instructions.temperature).toBeCloseTo(173.15, 2);
    expect(instructions.twin).toBeUndefined();
    expect(instructions.weighting).toEqual({ a: 0.0436, b: 0.2952 });
    // SHELXL at 173 K: methyls 0.98 Å (AFIX 137), aromatic 0.95 (43), methine 1.00 (13), CH₂ 0.99 (23).
    expect(structure.riding!.length).toBe(82);
    expect(merged.reflections).toHaveLength(8414);
    expect(merged.merged).toMatchObject({ from: 8435, friedelApart: true, absences: 21 });
  });

  it("shows the twin in the data before any model: the intensities' statistics low, and the H-test on k, h, −l near ½", () => {
    const rows = measured.reflections.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.iObs, sigma: r.sigma ?? 0 }));
    const st = reflectionStatistics(rows, loaded.cell, loaded.spaceGroup, { sites: loaded.sites.length, special: 0 });
    // A perfect twin's intensities are means of two: ⟨|E²−1|⟩ falls from 0.736 toward 0.541 (0.652 here).
    expect(st.intensities.meanAbsE2Minus1).toBeLessThan(0.66);
    expect(st.intensities.reading).toMatch(/^below 0\.736: fewer weak reflections than either expects/);
    const laws = merohedralTwinLaws(rows, loaded.cell, loaded.spaceGroup);
    expect(laws[0]!.matrix).toEqual(LAW);
    expect(laws[0]!.alpha).toBeGreaterThan(0.43);
  });

  it("reproduces SHELXL with the twin: R1 4.32 % on 7595 reflections (SHELXL 4.33 % on 7597), 5.16 % on all 8414, BASF 0.4965, 567 parameters", () => {
    const dataset = { ...merged, twinLaws: [{ matrix: LAW }], weighting: instructions.weighting! };
    const spec = buildSingleCrystalSpec(structure, dataset, { twinFractions: [0.4966] });
    const params = spec.params.map((p) => ({ ...p, fixed: !FREE.has(p.kind) }));
    expect(params.filter((p) => !p.fixed && !p.expression)).toHaveLength(567);
    // Without the twin, SHELXL's own model misses the data: R1 above 20 %.
    const untwinned = { ...merged, weighting: instructions.weighting! };
    const plain = buildSingleCrystalSpec(structure, untwinned, {});
    expect(singleCrystalRefinementComparison(structure, untwinned, plain.params, plain.bindings).agreement.r1).toBeGreaterThan(0.2);

    const result = refineSingleCrystal(structure, dataset, params, spec.bindings, SINGLE_CRYSTAL_REFINE_OPTIONS);
    expect(result.status).toBe("converged");
    const refined = params.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
    const ag = singleCrystalRefinementComparison(structure, dataset, refined, spec.bindings).agreement;
    expect(Math.abs(ag.r1 - 0.0433)).toBeLessThan(0.0005);
    expect(Math.abs(ag.r1All! - 0.0517)).toBeLessThan(0.0005);
    expect(Math.abs(ag.observed - 7597)).toBeLessThan(5);
    expect(ag.total).toBe(8414);
    expect(Math.abs(result.parameters.twin_1! - 0.4966)).toBeLessThan(0.002);
    // SHELXL's one restraint: the floating origin along c.
    expect(floatingOrigins(structure, refined, spec.bindings).map((o) => o.axis)).toEqual(["c"]);
    // The hand: Al the heaviest atom at Mo Kα. Parsons' quotients from 3856 Bijvoet pairs give x = 0.00(13), and the
    // strong Bijvoet differences split as chance would (14 of 28): u above 0.1, the enantiomers are not told apart.
    const hand = parsonsOfModel(structure, dataset, refined, spec.bindings)!;
    expect(hand.quotients).toBeGreaterThan(3800);
    expect(hand.esd).toBeGreaterThan(0.1);
    expect(Math.abs(hand.x)).toBeLessThan(2 * hand.esd);
    expect(Math.abs(hand.signs.modelSign / hand.signs.observed - 0.5)).toBeLessThan(0.2);
  }, 900_000);
});
