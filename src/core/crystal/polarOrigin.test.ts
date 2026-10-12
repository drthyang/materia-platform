import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { floatingOrigins, originCoordinate, polarDirections } from "@/core/crystal/polarOrigin";
import type { StructureModel } from "@/core/crystal/types";
import type { SingleCrystalDataset } from "@/core/diffraction/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { applyParameters } from "@/core/workflow/apply";
import { buildSingleCrystalRefinementProblem, buildSingleCrystalSpec, refineSingleCrystal, singleCrystalRefinementComparison, SINGLE_CRYSTAL_REFINE_OPTIONS } from "@/core/workflow/singleCrystalRefinement";

describe("polar directions", () => {
  it("are the shifts every rotation keeps: c in P6₁ and P3, b in P2₁, a and c in Pc, all three in P1, none with the inversion or axes on every direction", () => {
    expect(polarDirections(buildSpaceGroup(169).operations)).toEqual([[0, 0, 1]]);
    expect(polarDirections(buildSpaceGroup(143).operations)).toEqual([[0, 0, 1]]);
    expect(polarDirections(buildSpaceGroup(4).operations)).toEqual([[0, 1, 0]]);
    expect(polarDirections(buildSpaceGroup(7).operations)).toEqual([[1, 0, 0], [0, 0, 1]]);
    expect(polarDirections(buildSpaceGroup(1).operations)).toHaveLength(3);
    expect(polarDirections(buildSpaceGroup(2).operations)).toEqual([]);
    expect(polarDirections(buildSpaceGroup(14).operations)).toEqual([]);
    expect(polarDirections(buildSpaceGroup(19).operations)).toEqual([]);
    // A rhombohedral cell's threefold runs along [111].
    expect(polarDirections(buildSpaceGroup("R 3:R").operations)).toEqual([[1, 1, 1]]);
  });
});

/** Two atoms in P2₁: every coordinate free leaves the origin along b to float. */
const iso = { kind: "isotropic", bIso: 0.8 } as const;
const structure: StructureModel = {
  id: "p21",
  name: "P21 test",
  cell: { a: 5.1, b: 6.3, c: 7.2, alpha: 90, beta: 97, gamma: 90 },
  spaceGroup: buildSpaceGroup(4),
  sites: [
    { label: "Fe1", element: "Fe", position: [0.21, 0.25, 0.13], occupancy: 1, adp: iso },
    { label: "O1", element: "O", position: [0.43, 0.61, 0.32], occupancy: 1, adp: iso },
    { label: "O2", element: "O", position: [0.82, 0.04, 0.71], occupancy: 1, adp: iso },
  ],
};
const radiation = { kind: "xray" as const, wavelength: 0.71073 };

function truth(): SingleCrystalDataset {
  const base: SingleCrystalDataset = { id: "p21", name: "truth", radiation, reflections: generateReflections(structure.cell, structure.spaceGroup, 0.7, 8).map((r) => ({ h: r.h, k: r.k, l: r.l, iObs: 0 })) };
  const spec = buildSingleCrystalSpec(structure, base, { scale: 2 });
  const rows = singleCrystalRefinementComparison(structure, base, spec.params, spec.bindings).rows;
  return { ...base, reflections: rows.map((r) => ({ h: r.h, k: r.k, l: r.l, iObs: r.fcSq, sigma: 0.02 * Math.sqrt(r.fcSq + 1) + 0.01 })) };
}

describe("the floating origin", () => {
  const data = truth();
  const spec = buildSingleCrystalSpec(structure, data, { scale: 2 });
  const allFree = spec.params.map((p) => (p.kind === "positionShift" || p.kind === "scale" ? { ...p, fixed: false } : p));

  it("floats along b when every site can move along it, weighted by Z²", () => {
    const origins = floatingOrigins(structure, allFree, spec.bindings);
    expect(origins).toHaveLength(1);
    expect(origins[0]!.axis).toBe("b");
    expect(origins[0]!.direction).toEqual([0, 1, 0]);
    const w = origins[0]!.weights;
    expect(w.get("Fe1")! / w.get("O1")!).toBeCloseTo(26 ** 2 / 8 ** 2, 10);
    expect([...w.values()].reduce((t, v) => t + v, 0)).toBeCloseTo(1, 12);
    expect(originCoordinate(origins[0]!, structure)).toBeCloseTo((676 * 0.25 + 64 * 0.61 + 64 * 0.04) / 804, 12);
  });

  it("is pinned by one site held along it: no restraint then", () => {
    const fixedY = allFree.map((p) => (p.id === "pos_Fe1_1" ? { ...p, fixed: true } : p));
    expect(spec.bindings.some((b) => b.parameterId === "pos_Fe1_1" && b.axis?.[1] === 1)).toBe(true);
    expect(floatingOrigins(structure, fixedY, spec.bindings)).toEqual([]);
  });

  it("leaves the fit no null direction, holds the weighted mean y where the model as loaded has it, and recovers every coordinate", () => {
    // Start every atom off its true place, along b as well: the mean y off too.
    const shifted = allFree.map((p) => (p.kind === "positionShift" ? { ...p, value: 0.01 * ((p.id.length % 3) - 1) + 0.004 } : p));
    const origin = floatingOrigins(structure, shifted, spec.bindings)[0]!;
    const start = applyParameters(structure, spec.bindings, Object.fromEntries(shifted.map((p) => [p.id, p.value]))).model;
    expect(Math.abs(originCoordinate(origin, start) - originCoordinate(origin, structure))).toBeGreaterThan(1e-3);
    const result = refineSingleCrystal(structure, data, shifted, spec.bindings, SINGLE_CRYSTAL_REFINE_OPTIONS);
    expect(result.status).toBe("converged");
    expect(result.diagnostics?.svdZeroCount).toBe(0);
    expect(result.diagnostics?.nullDirections).toBeUndefined();
    const refined = applyParameters(structure, spec.bindings, result.parameters).model;
    // The origin stays where the loaded model has it, refinement after refinement: here, the truth's.
    expect(originCoordinate(origin, refined)).toBeCloseTo(originCoordinate(origin, structure), 6);
    refined.sites.forEach((s, i) => [0, 1, 2].forEach((k) => expect(s.position[k]).toBeCloseTo(structure.sites[i]!.position[k]!, 6)));
    expect(result.esd.pos_Fe1_1).toBeGreaterThan(0);
  });

  it("carries the restraint's row in the analytic Jacobian as its finite difference", () => {
    const problem = buildSingleCrystalRefinementProblem(structure, data, allFree, spec.bindings);
    expect(problem.observations.length).toBe(data.reflections.length + 1);
    const free = problem.parameters.filter((p) => !p.fixed && !p.expression);
    const columns = problem.analyticColumns!(free, free.map((p) => p.value));
    const row = data.reflections.length;
    free.forEach((p, j) => {
      const values = Object.fromEntries(problem.parameters.map((q) => [q.id, q.value]));
      const h = 1e-6;
      const fd = (problem.calculate({ ...values, [p.id]: p.value + h })[row]! - problem.calculate({ ...values, [p.id]: p.value - h })[row]!) / (2 * h);
      expect(columns[j]![row]!).toBeCloseTo(fd, 8);
    });
  });
});
