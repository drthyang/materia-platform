import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parse_single_crystal_data, parse_structure } from "@/mcp/tools";
import { dSpacing } from "@/core/crystal/unitCell";
import type { StructureModel } from "@/core/crystal/types";
import type { SingleCrystalDataset } from "@/core/diffraction/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { generateReflections } from "@/core/diffraction/reflections";
import { refine } from "@/core/refinement/engine";
import {
  buildSingleCrystalSpec,
  buildSingleCrystalRefinementProblem,
  singleCrystalRefinementComparison,
} from "@/core/workflow/singleCrystalRefinement";

const iso = { kind: "isotropic", bIso: 0.5 } as const;

// A small P-1 structure with two atoms — a general position that will carry a
// real coordinate gradient.
const structure: StructureModel = {
  id: "sx",
  name: "SX test",
  cell: { a: 6, b: 7, c: 8, alpha: 88, beta: 95, gamma: 91 },
  spaceGroup: buildSpaceGroup(2), // P-1
  sites: [
    { label: "Fe1", element: "Fe", oxidationState: 2, position: [0.2, 0.3, 0.15], occupancy: 1, adp: iso },
    { label: "O1", element: "O", oxidationState: -2, position: [0.4, 0.1, 0.35], occupancy: 1, adp: iso },
  ],
};
const radiation = { kind: "xray" as const, wavelength: 0.71073 };

/** A truth dataset: I_calc from the model at a known scale, used as observations. */
function truthDataset(scale: number): SingleCrystalDataset {
  const reflections = generateReflections(structure.cell, structure.spaceGroup, 0.8, 8).slice(0, 60);
  const base: SingleCrystalDataset = {
    id: "sx",
    name: "truth",
    radiation,
    reflections: reflections.map((r) => ({ h: r.h, k: r.k, l: r.l, iObs: 0 })),
  };
  const spec = buildSingleCrystalSpec(structure, base, { scale });
  const cmp = singleCrystalRefinementComparison(structure, base, spec.params, spec.bindings);
  return {
    ...base,
    reflections: cmp.rows.map((row) => ({
      h: row.h, k: row.k, l: row.l,
      iObs: row.fcSq,
      sigma: Math.sqrt(Math.abs(row.fcSq)) + 0.1,
    })),
  };
}

describe("buildSingleCrystalSpec", () => {
  it("frees scale on load and fixes structural rows (powder-consistent convention)", () => {
    const data = truthDataset(3);
    const spec = buildSingleCrystalSpec(structure, data);
    const scale = spec.params.find((p) => p.id === "scale")!;
    expect(scale.fixed).toBe(false);
    // Positions + ADP present but fixed.
    expect(spec.params.filter((p) => p.kind === "positionShift").length).toBeGreaterThan(0);
    expect(spec.params.filter((p) => p.kind === "bIso").every((p) => p.fixed)).toBe(true);
  });

  it("offers no lattice rows: the cell is fixed input from indexing, as in SHELXL / Jana / FullProf / GSAS-II", () => {
    const spec = buildSingleCrystalSpec(structure, truthDataset(3));
    expect(spec.params.some((p) => p.kind === "cellLength" || p.kind === "cellAngle")).toBe(false);
    expect(spec.bindings.some((b) => b.kind === "cellLength" || b.kind === "cellAngle")).toBe(false);
  });

  it("emits an extinction parameter only when requested", () => {
    const data = truthDataset(3);
    expect(buildSingleCrystalSpec(structure, data).params.some((p) => p.kind === "extinction")).toBe(false);
    expect(buildSingleCrystalSpec(structure, data, { extinction: 0 }).params.some((p) => p.kind === "extinction")).toBe(true);
  });
});

describe("single-crystal F² refinement recovery", () => {
  it("recovers the overall scale from a wrong start", () => {
    const data = truthDataset(3);
    const spec = buildSingleCrystalSpec(structure, data);
    // Only scale free; start at 1 vs true 3.
    const params = spec.params.map((p) => (p.id === "scale" ? { ...p, value: 1, initialValue: 1 } : p));
    const problem = buildSingleCrystalRefinementProblem(structure, data, params, spec.bindings);
    const result = refine(problem, { maxIterations: 30 });
    expect(result.parameters.scale).toBeCloseTo(3, 2);
  });

  it("recovers a displaced atom and drives wR2/R1 to ~0", () => {
    const data = truthDataset(2);
    const spec = buildSingleCrystalSpec(structure, data);
    // Displace Fe1 along its first positional mode, free scale + that mode.
    const posId = spec.params.find((p) => p.id.startsWith("pos_Fe1_"))!.id;
    const params = spec.params.map((p) => {
      if (p.id === "scale") return { ...p, value: 2, initialValue: 2, fixed: false };
      if (p.id === posId) return { ...p, value: 0.05, initialValue: 0.05, fixed: false }; // 0.05 off truth
      return { ...p, fixed: true };
    });
    const problem = buildSingleCrystalRefinementProblem(structure, data, params, spec.bindings);
    const result = refine(problem, { maxIterations: 60 });
    expect(Math.abs(result.parameters[posId] ?? 1)).toBeLessThan(0.01); // back to ~0

    const refined = spec.params.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
    const cmp = singleCrystalRefinementComparison(structure, data, refined, spec.bindings);
    expect(cmp.agreement.wr2).toBeLessThan(0.02);
    expect(cmp.agreement.r1).toBeLessThan(0.02);
    expect(cmp.agreement.total).toBe(data.reflections.length);
  });

  it("reports per-reflection standardized residuals for outlier diagnosis", () => {
    const data = truthDataset(2);
    const spec = buildSingleCrystalSpec(structure, data, { scale: 2 }); // at the truth scale
    const cmp = singleCrystalRefinementComparison(structure, data, spec.params, spec.bindings);
    // At the truth scale the residuals are ~0.
    expect(Math.max(...cmp.rows.map((r) => Math.abs(r.deltaOverSigma)))).toBeLessThan(1e-6);
  });
});

const SHELX_1B = { cif: "GSAS-II-tutorials/sc/1b.cif", fcf: "GSAS-II-tutorials/sc/1b.fcf" };

describe.skipIf(!dataExists(SHELX_1B.cif) || !dataExists(SHELX_1B.fcf))("the model against SHELXL's own Fc² (GSAS-II tutorial 1b, Mo Kα)", () => {
  it("has SHELXL's fall-off with angle: the data are corrected Fo², with no Lorentz–polarization factor left to apply", () => {
    const s = parse_structure({ cif: readFileSync(dataPath(SHELX_1B.cif), "utf8") }).structure;
    const fcf = readFileSync(dataPath(SHELX_1B.fcf), "utf8");
    const ds = { ...parse_single_crystal_data({ text: fcf, name: "1b.fcf" }).dataset, radiation: { kind: "xray" as const, wavelength: 0.71073 } };
    const spec = buildSingleCrystalSpec(s, ds, { scale: 1 });
    const ours = singleCrystalRefinementComparison(s, ds, spec.params, spec.bindings).rows;
    // The .fcf's own F²calc column (LIST 4: h k l Fc² Fo² σ flag).
    const shelx = new Map(fcf.split("\n").map((l) => l.trim().split(/\s+/)).filter((t) => t.length === 7 && /^[ox]$/.test(t[6]!)).map((t) => [`${t[0]},${t[1]},${t[2]}`, Number(t[3])]));
    // The median ratio per sinθ/λ shell: flat when the model falls off as SHELXL's does.
    const shells = new Map<number, number[]>();
    for (const r of ours) {
      const fc = shelx.get(`${r.h},${r.k},${r.l}`);
      if (!fc || fc < 50) continue;
      const shell = Math.floor(1 / (2 * dSpacing(s.cell, r.h, r.k, r.l)) / 0.1);
      (shells.get(shell) ?? shells.set(shell, []).get(shell)!).push(r.fcSq / fc);
    }
    const medians = [...shells.values()].filter((v) => v.length >= 20).map((v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!);
    expect(medians.length).toBeGreaterThanOrEqual(4);
    // Within 5 % of each other from 0.1 to 0.6 Å⁻¹ (anomalous dispersion and the inversion twin
    // are not modelled here); an L·P factor made the ratio run from 14 down to 0.9.
    expect(Math.max(...medians) / Math.min(...medians)).toBeLessThan(1.05);
  });
});

describe("batch scales", () => {
  it("emits a fixed row per batch after the first, and recovers a batch measured 10 % high", () => {
    const base = truthDataset(2);
    // The same reflections in two batches, the second 10 % high.
    const two: SingleCrystalDataset = {
      ...base,
      reflections: [...base.reflections.map((r) => ({ ...r, batch: 1 })), ...base.reflections.map((r) => ({ ...r, iObs: 1.1 * r.iObs, sigma: 1.1 * (r.sigma ?? 1), batch: 2 }))],
    };
    const spec = buildSingleCrystalSpec(structure, two, { scale: 1 });
    const rows = spec.params.filter((p) => p.kind === "batchScale");
    expect(rows.map((p) => [p.id, p.fixed, p.value])).toEqual([["bscale_2", true, 1]]);
    expect(buildSingleCrystalSpec(structure, base, { scale: 1 }).params.some((p) => p.kind === "batchScale")).toBe(false);
    const free = spec.params.map((p) => ({ ...p, fixed: !(p.id === "scale" || p.id === "bscale_2") }));
    const r = refine(buildSingleCrystalRefinementProblem(structure, two, free, spec.bindings), { maxIterations: 30 });
    expect(r.parameters["bscale_2"]).toBeCloseTo(1.1, 5);
    expect(r.parameters["scale"]).toBeCloseTo(2, 4);
  });
});
