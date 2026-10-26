import { describe, it, expect } from "vitest";
import { AWO4_DEMO_FILES, awo4DemoParams, buildAwo4MagneticExample, type Awo4Solution } from "@/examples/awo4Magnetic";
import { magneticSubgroupLattice, latticeRepresentatives } from "@/core/magnetic/subgroupLattice";
import { operationKey } from "@/core/crystal/symmetry";
import { momentCartesian } from "@/core/magnetic/moment";
import { magneticIonCandidates } from "@/core/magnetic/magneticIons";
import { loadedSession } from "@/app/powderSession";
import { powderCurves } from "@/core/workflow/powder";
import { buildMagneticPowderProblem, magneticComponentCurve } from "@/core/workflow/magneticPowder";
import { refine } from "@/core/refinement/engine";
import { dataExists, readData } from "@/testSupport/data";
import type { SymmetryOperation } from "@/core/crystal/types";

const sig = (ops: readonly SymmetryOperation[]): string =>
  [...new Set(ops.map((o) => `${operationKey(o)}|${o.timeReversal ?? 1}`))].sort().join(" ");

const has = Object.values(AWO4_DEMO_FILES).every((rel) => dataExists(rel));

/**
 * The LOCAL AWO₄ magnetic demo must stay coherent with the machinery that
 * produced it (`awo4MagneticSolve.test.ts`): a real histogram, a k = (½,0,0)
 * model whose group is a candidate the magnetic page enumerates, moment rows
 * whose ids the page's builder regenerates, and a session that reopens on the
 * solved fit — the magnetic refinement, moments only with the nuclear model
 * held. Data-gated: the files live only in the git-ignored data/
 * folder (unpublished data), so this skips on CI and fresh clones.
 */
describe.skipIf(!has)("local AWO₄ magnetic demo (POWGEN 6 K, k = ½ 0 0)", () => {
  // Built lazily: vitest evaluates a skipped describe's body to collect its
  // tests, so reading the (absent) files here would throw on CI.
  let built: ReturnType<typeof buildAwo4MagneticExample> | null = null;
  const example = (): ReturnType<typeof buildAwo4MagneticExample> =>
    (built ??= buildAwo4MagneticExample({
      data: readData(AWO4_DEMO_FILES.data),
      instrument: readData(AWO4_DEMO_FILES.instrument),
      solution: readData(AWO4_DEMO_FILES.solution),
    }));

  it("reads the bank-3 histogram and the TOF calibration", () => {
    const ex = example();
    expect(ex.pattern.points.length).toBe(3670);
    expect(ex.pattern.xUnit).toBe("tof");
    expect(ex.pattern.points.every((p) => Number.isFinite(p.yObs) && (p.sigma ?? 0) > 0)).toBe(true);
    expect(ex.instrument.kind).toBe("tof");
    if (ex.instrument.kind === "tof") expect(ex.instrument.difC).toBeCloseTo(22600, 0);
  });

  // The moment is the one the solve wrote (the solution's `moment`), not a
  // number kept here: the demo must carry the model the solve refined, and the
  // data's scans and reductions move it by about an esd. One moment for the
  // co-located cations, at most their mean spin-only value (g·S of the 2+
  // ions, the benchmark's C8 bound).
  it("carries the solved P2/c′ model: a maximal candidate of the k = (½,0,0) lattice, one moment on the tied cations", () => {
    const ex = example();
    expect(ex.k).toEqual([0.5, 0, 0]);
    expect(ex.magnetic.propagation[0]).toEqual([0.5, 0, 0]);
    const reps = latticeRepresentatives(magneticSubgroupLattice(ex.structure.spaceGroup.operations, ex.k));
    const hit = reps.find((r) => sig(r.candidate.operations) === sig(ex.magnetic.operations ?? []));
    expect(hit).toBeDefined();
    expect(hit!.index).toBe(2);
    // The page's label: the parent-cell operations read as a k = 0 group. With
    // the k's anti-translation the group is of type IV, which the bundled table
    // does not hold.
    expect(hit!.candidate.standard?.bnsNumber ?? hit!.settingMatch?.identity.bnsNumber).toBe("13.68");
    expect(magneticIonCandidates(ex.structure).map((i) => i.siteLabel)).toEqual(ex.magneticSites);
    const carried = ex.magnetic.moments.filter((m) => m.components.some((c) => c !== 0));
    expect(carried.map((m) => m.siteLabel).sort()).toEqual([...ex.magneticSites].sort());
    const solved = (JSON.parse(readData(AWO4_DEMO_FILES.solution)) as { moment?: number }).moment;
    expect(solved, "the solution's moment: regenerate the solution (AWO4_SOLVE=1)").toBeDefined();
    const spinOnly: Record<string, number> = { Mn: 5, Fe: 4, Co: 3, Ni: 2, Cu: 1 };
    const spins = carried.map((m) => spinOnly[ex.structure.sites.find((s) => s.label === m.siteLabel)!.element]!);
    const bound = spins.reduce((a, b) => a + b, 0) / spins.length;
    for (const m of carried) {
      const size = Math.hypot(...momentCartesian(ex.structure.cell, m));
      expect(size).toBeCloseTo(solved!, 4);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(bound);
    }
    expect(ex.momentParams).toHaveLength(2);
  });

  // The demo opens on the solve's last step, the magnetic refinement: only the
  // magnetic parameters free, the nuclear model held at its refined values
  // (magnetic-analysis, Stage 4). So the free rows are the solution's, the
  // nuclear rows are all held, the pattern gives the solved wR, and Refine from
  // there moves nothing: the moments are converged against that nuclear model.
  it("reopens as a powder session on the magnetic refinement: the nuclear rows held, the moments free and converged, at the solved wR", () => {
    const ex = example();
    const base = loadedSession(ex.structure, ex.pattern, ex.instrument, [], ex.refinedParams, ex.backgroundTerms);
    expect(base.backgroundTerms).toBe(ex.backgroundTerms);
    expect(base.powderProfile.shape).toBe("tof");
    const ids = new Set(base.powderParams.map((p) => p.id));
    for (const p of ex.momentParams) expect(ids.has(p.id)).toBe(false);
    for (const id of ["scale", "cell_beta", "tof_sig0", "B_Co1", "pos_O2_2"]) {
      expect(base.powderParams.find((p) => p.id === id)?.value).toBeCloseTo(ex.refinedParams[id]!, 6);
    }
    const params = awo4DemoParams(base.powderParams, ex);
    const bindings = [...base.powderBindings, ...ex.momentBindings];
    const solution = JSON.parse(readData(AWO4_DEMO_FILES.solution)) as Awo4Solution;
    const free = params.filter((p) => !p.fixed).map((p) => p.id);
    expect(free.length).toBeGreaterThan(0);
    expect([...free].sort()).toEqual([...solution.free].sort());
    expect(free.every((id) => ex.momentParams.some((p) => p.id === id))).toBe(true);
    expect(params.filter((p) => ids.has(p.id)).every((p) => p.fixed)).toBe(true);

    const nuclear = powderCurves(ex.structure, ex.pattern, base.powderParams, base.powderBindings, base.powderProfile);
    const mag = magneticComponentCurve(ex.structure, ex.magnetic, ex.pattern, params, bindings, { shape: "tof" });
    let num = 0, den = 0;
    for (let i = 0; i < nuclear.yObs.length; i++) {
      const o = nuclear.yObs[i]!, c = nuclear.yCalc[i]! + (mag[i] ?? 0);
      const s = ex.pattern.points[i]!.sigma!;
      num += (o - c) ** 2 / (s * s); den += (o * o) / (s * s);
    }
    const wR = Math.sqrt(num / den);
    expect(wR).toBeLessThan(0.08);
    expect(wR).toBeLessThan(ex.nuclearWr);
    expect(wR).toBeCloseTo(ex.magneticWr, 4);
    expect(Math.max(...mag)).toBeGreaterThan(0);

    const again = refine(buildMagneticPowderProblem(ex.structure, ex.magnetic, ex.pattern, params, bindings, base.powderProfile), { maxIterations: 20 });
    for (const id of free) expect(Math.abs((again.parameters[id] ?? NaN) - ex.refinedParams[id]!), id).toBeLessThanOrEqual(0.1 * (again.esd[id] ?? NaN));
    expect(again.agreement.rWeighted ?? NaN).toBeCloseTo(ex.magneticWr, 4);
  });
});
