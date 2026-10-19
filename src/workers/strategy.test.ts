import { describe, it, expect } from "vitest";
import type { AtomSite, StructureModel, UnitCell } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { IDENTITY3 } from "@/core/math/mat3";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { refineSequential } from "@/core/refinement/sequential";
import { buildPdfProblem, buildPdfSpec } from "@/core/workflow/pdf";
import { boxcarWindows } from "@/core/workflow/pdfBoxcar";
import { ComputeClient } from "@/workers/computeClient";
import { build_magnetic_model, build_pdf_model, list_magnetic_subgroups, refine_magnetic_powder, refine_pdf_boxcar } from "@/mcp/tools";
import { example3Session } from "@/agent/validation/example3";
import { momentKickFloor } from "@/core/magnetic/canonicalize";
import { isMomentParameterKind } from "@/core/refinement/types";
import { buildMagneticDataset, exampleMagnetic, magneticBindings, magneticParameters } from "@/examples/mn3gaMagnetic";
import { boxcarScan, poolSolver } from "@/workers/strategy";

/**
 * The strategies both runtimes run (strategy.ts), over a solver. The boxcar
 * was written once in the browser's client and once in the MCP tool; the
 * copies differed in the extra phases (the MCP one took none), in what a
 * restart kicks from (the MCP one dropped the esds) and in the Jacobian (the
 * client's in-thread scan differentiated numerically, the MCP's analytically).
 */

const IDENTITY_OP = { rotation: IDENTITY3, translation: [0, 0, 0] as const, xyz: "x,y,z" };
const site = (label: string, element: string, position: readonly [number, number, number], bIso: number): AtomSite =>
  ({ label, element, position, occupancy: 1, adp: { kind: "isotropic", bIso } });
const cubic = (id: string, a: number, sites: AtomSite[]): StructureModel =>
  ({ id, name: id, cell: { a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: { operations: [IDENTITY_OP] }, sites });

/** A G(r) of the true model (a = 4 Å, one Ni per cell), plus a second phase's (a = 5.1 Å, one Fe) when asked. */
function pattern(withSecond = false): PdfPattern {
  const rGrid = makeRGrid(1.5, 16.5, 0.02);
  const g = (s: StructureModel, scale: number) => computeGofR(s.cell as UnitCell, expandStructureAtoms(s), rGrid, {
    scatteringType: "neutron", scale, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0,
  });
  const main = g(cubic("s", 4.0, [site("Ni1", "Ni", [0, 0, 0], 0.5)]), 1.3);
  const second = withSecond ? g(cubic("t", 5.1, [site("Fe1", "Fe", [0, 0, 0], 0.4)]), 0.6) : null;
  // A little noise (a fixed sequence), so that no box fits exactly and how a fit is differentiated shows.
  let seed = 7;
  const noise = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  return {
    id: "pdf-boxcar", name: "synthetic G(r)", scatteringType: "neutron", qdamp: 0.03,
    points: Array.from(rGrid, (r, i) => ({ r, gObs: main[i]! + (second?.[i] ?? 0) + noise() })),
  };
}

/** The starting model: the cell and the ADP off the truth. */
const start = (): StructureModel => cubic("s", 4.04, [site("Ni1", "Ni", [0, 0, 0], 0.6)]);
const second = (): StructureModel => cubic("t", 5.12, [site("Fe1", "Fe", [0, 0, 0], 0.5)]);
const PLAN = { range: { min: 1.5, max: 16.5 }, width: 5, step: 5 };

/** A value and esd track per row id, as the MCP tool reports them (null where a box gives none). */
const num = (v: number | null | undefined): number | null => (v === undefined || v === null || !Number.isFinite(v) ? null : v);
const tracks = (evolution: readonly { parameterId: string; values: readonly (number | null | undefined)[]; esd: readonly (number | null | undefined)[] }[]) =>
  Object.fromEntries(evolution.map((e) => [e.parameterId, { values: e.values.map(num), esd: e.esd.map(num) }]));

describe("the boxcar scan, one driver for both runtimes", () => {
  it("gives the browser's client and the MCP tool the same series, restarts included", async () => {
    const structure = start();
    const data = pattern();
    const spec = buildPdfSpec(structure, data);
    // The ADP free too: its column has a closed form, so how the fit is differentiated shows.
    const parameters = spec.params.map((p) => (p.kind === "bIso" ? { ...p, fixed: false } : p));
    expect(parameters.filter((p) => !p.fixed).map((p) => p.kind)).toContain("bIso");
    const windows = boxcarWindows(PLAN);
    const browser = await new ComputeClient().refinePdfBoxcar(
      { structure, pattern: data, parameters, bindings: spec.bindings, options: { maxIterations: 20 } },
      windows,
      { restarts: 2 },
    );
    const mcp = await refine_pdf_boxcar({ structure, pattern: data, parameters, bindings: spec.bindings, ...PLAN, restarts: 2, maxIterations: 20 });
    expect(mcp.boxes.length).toBe(windows.length);
    expect(tracks(mcp.evolution)).toEqual(tracks(browser.evolution));
  });

  it("sums the extra phases on MCP as in the browser", async () => {
    const structure = start();
    const data = pattern(true);
    const model = build_pdf_model({ structure, pattern: data, extraPhases: [second()] });
    const windows = boxcarWindows(PLAN);
    const browser = await new ComputeClient().refinePdfBoxcar(
      { structure, extraPhases: [second()], pattern: data, parameters: model.parameters, bindings: model.bindings, options: { maxIterations: 20 } },
      windows,
    );
    const mcp = await refine_pdf_boxcar({ structure, extraPhases: [second()], pattern: data, parameters: model.parameters, bindings: model.bindings, ...PLAN, maxIterations: 20 });
    expect(tracks(mcp.evolution)).toEqual(tracks(browser.evolution));
    // The second phase is in the fit: its G(r) is in the data, and every box fits better with it than without.
    const single = buildPdfSpec(structure, data);
    const alone = await refine_pdf_boxcar({ structure, pattern: data, parameters: single.params, bindings: single.bindings, ...PLAN, maxIterations: 20 });
    mcp.boxes.forEach((b, i) => expect(b.rWeighted!).toBeLessThan(alone.boxes[i]!.rWeighted!));
  });

  it("restarts a box from its seed: never worse than the seed alone, and the same on a rerun", async () => {
    const structure = start();
    const data = pattern();
    const spec = buildPdfSpec(structure, data);
    const windows = boxcarWindows(PLAN);
    const evaluatorSpec = { kind: "pdf" as const, structure, pattern: data, parameters: spec.params, bindings: spec.bindings };
    const scan = () => boxcarScan(evaluatorSpec, windows, poolSolver(null), { refineOptions: { maxIterations: 20 }, restarts: 3 });
    const seedOnly = refineSequential(spec.params, windows.map((w, i) => ({
      id: `box_${i}`,
      buildProblem: (parameters) => buildPdfProblem(structure, data, parameters, spec.bindings, [], { min: w.min, max: w.max }),
    })), { refineOptions: { maxIterations: 20, analyticDerivatives: true } });
    const restarted = await scan();
    for (let i = 0; i < windows.length; i++) {
      const a = seedOnly.steps[i]!.result.agreement.rWeighted ?? Infinity;
      const b = restarted.steps[i]!.result.agreement.rWeighted ?? Infinity;
      expect(b).toBeLessThanOrEqual(a * 1.001);
    }
    expect((await scan()).evolution).toEqual(restarted.evolution);
  });
});

/**
 * The moment search (a magnetic Prefit): the moments restarted on the frozen
 * nuclear scaffold, the best seeding one joint fit. It was written in the
 * browser's client twice (powder and mPDF; single crystal) and once in the MCP
 * tool. The MCP copy fitted the whole pattern on Chebyshev whatever the page's
 * window and basis, and kicked its restarts without the esds; the
 * single-crystal copy searched in the UI thread and re-solved one problem
 * `restarts` times when no moment was free.
 */
describe("the moment search, one driver for both runtimes", () => {
  /** Example 3 after its nuclear fit, with P2₁'/m''s moment model on it: scale, background and moments free. */
  function example3Magnetic() {
    const s = example3Session();
    const subs = list_magnetic_subgroups({ structure: s.structure, k: [0, 0, 0] });
    const ops = subs.candidates.find((c) => c.bns === "P2_1'/m'")!.operations;
    const mm = build_magnetic_model({ structure: s.structure, ionLabels: ["Mn1_0", "Mn2_1", "Mn3_2"], operations: ops, k: [0, 0, 0], moment: 2 });
    const nuclear = s.powderParams.map((p) => ({ ...p, fixed: !(p.kind === "scale" || p.kind === "background") }));
    const moments = mm.parameters.map((p) => (isMomentParameterKind(p.kind) && !p.expression ? { ...p, fixed: false } : p));
    return { s, mm, parameters: [...nuclear, ...moments], bindings: [...s.powderBindings, ...mm.bindings] };
  }

  it("gives the app's Prefit and the MCP tool the same moments, in the page's window and on its basis", async () => {
    const { s, mm, parameters, bindings } = example3Magnetic();
    const fitRange = { min: 12, max: 140 };
    const profile = { ...s.powderProfile, backgroundType: "cosine" as const };
    const app = await new ComputeClient().refineMagneticPowderMultiStart(
      {
        structure: s.structure, magnetic: mm.magnetic, pattern: s.pattern, parameters, bindings,
        shape: profile.shape, ...(profile.eta !== undefined ? { eta: profile.eta } : {}), lorentz: profile.lorentz ?? true, backgroundType: profile.backgroundType, fitRange,
      },
      { restarts: 3, minKick: momentKickFloor(parameters) },
      { maxIterations: 20 },
    );
    const mcp = await refine_magnetic_powder({
      structure: s.structure, magnetic: mm.magnetic, pattern: s.pattern, parameters, bindings, profile, fitRange,
      staged: false, restarts: 3, maxIterations: 20,
    });
    expect(app.restartsRun).toBe(3);
    expect(mcp.multiStart?.restartsRun).toBe(3);
    expect(mcp.result.agreement.rWeighted).toBe(app.final.agreement.rWeighted);
    const moments = (values: Record<string, number>) => mm.parameters.map((p) => values[p.id]);
    expect(moments(mcp.result.parameters)).toEqual(moments(app.final.parameters));
  }, 120000);

  it("on a single crystal, searches nothing when no moment is free", async () => {
    const ex = exampleMagnetic();
    const dataset = buildMagneticDataset(ex);
    const parameters = magneticParameters(ex.magnetic).map((p) => ({ ...p, fixed: p.kind !== "scale" }));
    const out = await new ComputeClient().refineMagneticSingleCrystalMultiStart(
      { structure: ex.structure, magnetic: ex.magnetic, dataset, parameters, bindings: magneticBindings(ex.magnetic) },
      { restarts: 4 },
      { maxIterations: 10 },
    );
    expect(out.restartsRun).toBe(0);
  });
});
