import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import type { StructureModel } from "@/core/crystal/types";
import { INVERSION_TWIN, type SingleCrystalDataset } from "@/core/diffraction/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { buildSingleCrystalSpec, parsonsOfModel, singleCrystalRefinementComparison } from "@/core/workflow/singleCrystalRefinement";
import { parsonsQuotients } from "@/core/diagnostics/absoluteStructure";

const iso = { kind: "isotropic", bIso: 1.2 } as const;
/** P2₁ with a bromine: Mo Kα gives it f″ ≈ 2.5 e, a clear Bijvoet signal. */
const structure: StructureModel = {
  id: "br",
  name: "Br test",
  cell: { a: 6.1, b: 7.3, c: 8.2, alpha: 90, beta: 103, gamma: 90 },
  spaceGroup: buildSpaceGroup(4),
  sites: [
    { label: "Br1", element: "Br", position: [0.11, 0.25, 0.32], occupancy: 1, adp: iso },
    { label: "C1", element: "C", position: [0.42, 0.13, 0.27], occupancy: 1, adp: iso },
    { label: "O1", element: "O", position: [0.71, 0.62, 0.08], occupancy: 1, adp: iso },
    { label: "N1", element: "N", position: [0.27, 0.81, 0.66], occupancy: 1, adp: iso },
  ],
};

/** Each reflection with its Friedel opposite, as a MERG 2 listing holds them. */
function bothHands(): SingleCrystalDataset {
  const hkl = generateReflections(structure.cell, structure.spaceGroup, 0.9, 8).flatMap((r) => [{ h: r.h, k: r.k, l: r.l, iObs: 0 }, { h: -r.h, k: -r.k, l: -r.l, iObs: 0 }]);
  return { id: "br", name: "br", radiation: { kind: "xray", wavelength: 0.71073, polarization: 0.5 }, reflections: hkl };
}

describe("Parsons' quotients", () => {
  const base = bothHands();
  // "Measured": a crystal with 30 % of the other hand.
  const twinned: SingleCrystalDataset = { ...base, twinLaws: [INVERSION_TWIN] };
  const truthSpec = buildSingleCrystalSpec(structure, twinned, { scale: 3, twinFractions: [0.3] });
  const measured = singleCrystalRefinementComparison(structure, twinned, truthSpec.params, truthSpec.bindings).rows;
  const data: SingleCrystalDataset = { ...base, reflections: measured.map((r) => ({ h: r.h, k: r.k, l: r.l, iObs: r.fcSq, sigma: 0.01 * r.fcSq + 0.05 })) };

  it("give the fraction of the other hand from the Bijvoet pairs, the scale cancelling", () => {
    // The model's Fc² at another scale, with no inversion twinning.
    const spec = buildSingleCrystalSpec(structure, data, { scale: 1 });
    const rows = singleCrystalRefinementComparison(structure, data, spec.params, spec.bindings).rows;
    const est = parsonsQuotients(rows, structure.spaceGroup.operations)!;
    expect(est.x).toBeCloseTo(0.3, 6);
    // Each pair once; h0l reflections are centric in 2/m's point group 2: no quotient.
    expect(est.quotients).toBeGreaterThan(100);
    expect(est.quotients).toBeLessThan(rows.length / 2);
    expect(est.esd).toBeGreaterThan(0);
  });

  it("leave a refined inversion twin out of the model's quotients", () => {
    // A fit that holds the twin: its fraction set aside, the quotients still read the crystal's 30 %.
    const spec = buildSingleCrystalSpec(structure, { ...data, twinLaws: [INVERSION_TWIN] }, { scale: 3, twinFractions: [0.3] });
    expect(parsonsOfModel(structure, { ...data, twinLaws: [INVERSION_TWIN] }, spec.params, spec.bindings)!.x).toBeCloseTo(0.3, 6);
  });

  it("need the pairs measured both ways", () => {
    const oneHand = data.reflections.filter((r) => r.h > 0 || (r.h === 0 && (r.k > 0 || (r.k === 0 && r.l > 0))));
    const spec = buildSingleCrystalSpec(structure, data, { scale: 1 });
    const rows = singleCrystalRefinementComparison(structure, { ...data, reflections: oneHand }, spec.params, spec.bindings).rows;
    expect(parsonsQuotients(rows, structure.spaceGroup.operations)).toBeNull();
    expect(parsonsOfModel({ ...structure, spaceGroup: buildSpaceGroup(14) }, data, spec.params, spec.bindings)).toBeNull();
  });
});
