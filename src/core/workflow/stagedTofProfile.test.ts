import { describe, it, expect } from "vitest";
import { buildPowderSpec } from "@/app/powderSpec";
import { CORRECTION_KINDS } from "@/core/diffraction/corrections";
import type { ParameterKind, RefinementParameter } from "@/core/refinement/types";
import { buildPowderProblem, powderCurves } from "@/core/workflow/powder";
import { refineStaged } from "@/core/refinement/staged";
import { DEFAULT_STAGE_KINDS, stagesFromKindGroups } from "@/core/workflow/structureRefinement";
import { exampleStructure } from "@/examples/highEntropyWO4";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";

/**
 * The staged powder fit keeps a time-of-flight profile stage whose zero
 * trades with the cell. On TOF data the zero offset and a uniform change of
 * the cell lengths both move every peak along TOF, so once the zero is freed
 * (the profile stage) the cell lengths' esds grow several-fold. The stage
 * guard read that growth as divergence and rejected the whole stage — the
 * peak shape (α, β, σ) with it — once the engine's covariance became the full
 * inverse (its esds had been near the conditional ones): every later stage
 * then fitted with the profile left at its calibration. The guard now re-fixes
 * the newcomer the inflated esd correlates with (the zero) and keeps the rest.
 *
 * Synthetic: a POWGEN-like bank (difC of the bundled Mn₃Ga example) simulated
 * from the bundled monoclinic tungstate model with a broader, slower peak shape
 * than the one the fit starts from, Poisson-like noise of a fixed seed.
 */

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
}

describe("staged powder fit — a TOF profile stage with the zero free", () => {
  it("re-fixes the zero that trades with the cell and keeps the peak shape refined", { timeout: 120_000 }, () => {
    const structure = exampleStructure();
    const step = 0.0008; // Δt/t of a log-binned TOF histogram
    const xs = Array.from({ length: Math.floor(Math.log(140000 / 25000) / step) }, (_, i) => 25000 * Math.exp(i * step));
    const start: InstrumentParameters = {
      kind: "tof", difC: 22585.8, difA: -5, difB: 0, zero: 0,
      alpha: 0.13, beta0: 0.0128, beta1: -0.0065, betaQ: 0.0617, sig0: 40, sig1: 0, sig2: 465, sigQ: 0,
    };
    const truth: InstrumentParameters = { ...start, alpha: 0.2, beta0: 0.02, sig0: 120, sig2: 300 };
    const grid: PowderPattern = { id: "tof", name: "synthetic bank", xUnit: "tof", radiation: { kind: "neutron-tof" }, points: xs.map((x) => ({ x, yObs: 0 })) };
    const specTrue = buildPowderSpec(structure, grid, truth, true, 2);
    const sim = powderCurves(structure, grid, specTrue.params.map((p) =>
      p.kind === "scale" ? { ...p, value: 50 } : p.kind === "background" ? { ...p, value: 0 } : p), specTrue.bindings, specTrue.profile);
    const u = seeded(7);
    const pattern: PowderPattern = {
      ...grid,
      points: xs.map((x, i) => {
        const mu = Math.max(sim.yCalc[i] ?? 0, 0) + 20;
        const sigma = Math.sqrt(mu);
        return { x, yObs: mu + sigma * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()), sigma };
      }),
    };

    // The AWO₄ solve's free set: everything but the occupancies and the TOF
    // calibration, sig-q held at its calibration.
    const spec = buildPowderSpec(structure, pattern, start, true, 6, { positions: true, adp: true });
    const unlock = new Set<ParameterKind>([
      "positionShift", "bIso", "uAniso", "poRatio", ...CORRECTION_KINDS,
      "peakWidth", "profileV", "profileW", "profileX", "profileY", "asymSL", "asymHL", "zeroShift", "tofProfile",
      "stephensStrain", "anisoSizePerp", "anisoSizePar", "mustrainIso",
    ]);
    const params: RefinementParameter[] = spec.params.map((p) => (unlock.has(p.kind) && p.id !== "tof_sigQ" ? { ...p, fixed: false } : p));
    const build = (ps: readonly RefinementParameter[]) => buildPowderProblem(structure, pattern, ps, spec.bindings, spec.profile);
    const out = refineStaged(params, build, stagesFromKindGroups(DEFAULT_STAGE_KINDS), { maxIterations: 12 });

    const cell = out.stages.find((s) => s.name === "cell")!;
    const profile = out.stages.find((s) => s.name === "profile")!;
    expect(profile.rejected).toBeUndefined();
    const zero = profile.refixed?.find((r) => r.id === "zero");
    expect(zero?.reason).toMatch(/^inflated esd\(cell_[abc]\) \d+\.\d×, \|ρ\|=0\.\d+ with cell_[abc]$/);
    expect(profile.freeIds).toEqual(expect.arrayContaining(["tof_alpha1", "tof_beta0", "tof_sig0", "tof_sig2"]));
    // The peak shape is the stage's gain: wR falls to the noise.
    expect(profile.result.agreement.rWeighted!).toBeLessThan(0.5 * cell.result.agreement.rWeighted!);
    const byId = new Map(out.parameters.map((p) => [p.id, p]));
    expect(byId.get("zero")!.fixed).toBe(true);
    expect(byId.get("zero")!.value).toBe(0);
    expect(byId.get("tof_sig2")!.fixed).toBe(false);
    expect(out.final!.agreement.goodnessOfFit!).toBeLessThan(1.2);
    expect(out.final!.agreement.rWeighted!).toBeLessThanOrEqual(profile.result.agreement.rWeighted! * (1 + 1e-3));
  });
});
