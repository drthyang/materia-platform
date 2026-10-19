import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import type { StructureModel } from "@/core/crystal/types";
import { INVERSION_TWIN, type SingleCrystalDataset } from "@/core/diffraction/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { buildSingleCrystalSpec, parsonsOfModel, singleCrystalRefinementComparison } from "@/core/workflow/singleCrystalRefinement";
import { parsonsQuotients, type BijvoetRow } from "@/core/diagnostics/absoluteStructure";
import { mergeEquivalents } from "@/core/diffraction/merge";

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

  it("use every measurement of unmerged data: the quotients of the equivalents merged, the Friedel opposites apart", () => {
    // Each reflection and its 2-fold equivalent measured twice, both hands, with counting noise.
    let seed = 3;
    const normal = (): number => {
      const u = (): number => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      return Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
    };
    const measuredAt = base.reflections.flatMap((r) => [r, r, { ...r, h: -r.h, l: -r.l }, { ...r, h: -r.h, l: -r.l }]);
    const many: SingleCrystalDataset = { ...base, reflections: measuredAt };
    const truth = singleCrystalRefinementComparison(structure, { ...many, twinLaws: [INVERSION_TWIN] }, truthSpec.params, truthSpec.bindings).rows;
    const noisy: SingleCrystalDataset = { ...many, reflections: truth.map((r) => {
      const sigma = 0.03 * r.fcSq + 0.5;
      return { h: r.h, k: r.k, l: r.l, iObs: r.fcSq + sigma * normal(), sigma };
    }) };
    const spec = buildSingleCrystalSpec(structure, noisy, { scale: 3 });
    const rows = singleCrystalRefinementComparison(structure, noisy, spec.params, spec.bindings).rows;
    const ops = structure.spaceGroup.operations;
    const est = parsonsQuotients(rows, ops)!;
    // The same as on the data merged first (SHELXL's MERG 2), each model Fc² at its representative.
    const fcOf = new Map(rows.map((r) => [`${r.h},${r.k},${r.l}`, r.fcSq]));
    const merged = mergeEquivalents(rows.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.foSq, sigma: r.sigma })), ops, { friedel: false }).reflections;
    const mergedRows: BijvoetRow[] = merged.map((m) => ({ h: m.h, k: m.k, l: m.l, foSq: m.intensity, sigma: m.sigma, fcSq: fcOf.get(`${m.h},${m.k},${m.l}`)! }));
    const first = parsonsQuotients(mergedRows, ops)!;
    expect(est.x).toBeCloseTo(first.x, 10);
    expect(est.esd).toBeCloseTo(first.esd, 10);
    expect(est.quotients).toBe(first.quotients);
    // Four measurements of each side: the esd about half what one measurement of each gives.
    const once = new Map<string, BijvoetRow>();
    for (const r of rows) if (!once.has(`${r.h},${r.k},${r.l}`) && !once.has(`${-r.h},${r.k},${-r.l}`)) once.set(`${r.h},${r.k},${r.l}`, r);
    const single = parsonsQuotients([...once.values()], ops)!;
    expect(est.esd).toBeLessThan(0.65 * single.esd);
    expect(Math.abs(est.x - 0.3)).toBeLessThan(3 * est.esd);
  });
});
