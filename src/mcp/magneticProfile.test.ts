import { describe, it, expect } from "vitest";
import { build_magnetic_model, build_refinement, evaluate_pattern, list_magnetic_subgroups, rank_next_parameters, refine_magnetic_powder } from "@/mcp/tools";
import { buildMagneticPowderProblem } from "@/core/workflow/magneticPowder";
import { computeAgreementFactors } from "@/core/refinement/factors";
import { buildMultiPhaseSpec } from "@/app/multiPhaseSpec";
import { exampleStructure } from "@/examples/mn3ga";
import { MNO_CIF } from "@/examples/mn3gaPowgen";
import { parseCif } from "@/parsers/cif";
import type { PowderPattern } from "@/core/diffraction/types";
import type { PowderProfile } from "@/core/workflow/powder";
import type { PowderPhase } from "@/core/workflow/multiPhase";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";

/**
 * The MCP magnetic tools on the whole powder profile. evaluate_pattern (and
 * rank_next_parameters' probe) cut the profile to its shape and η, so a cosine
 * background was drawn on Chebyshev and the Lorentz factor was always on. The
 * nuclear + magnetic components dropped η, and drew an extra phase with the
 * Lorentz factor whatever the profile said, so refine_magnetic_powder handed
 * back curves that were not the pattern it had fitted. Each tool's curve and wR
 * must be what the problem the fit solves (`buildMagneticPowderProblem`) gives
 * for the same profile and phases.
 */
describe("MCP magnetic tools on the whole powder profile", () => {
  const structure = exampleStructure(); // hexagonal Mn₃Ga, P6₃/mmc
  const mno = { ...parseCif(MNO_CIF, "mno"), id: "mno" }; // its "Mn1" collides with Mn₃Ga's
  const mnoPhase: PowderPhase = { structure: mno, id: mno.id };
  const neutron = { kind: "constantWavelength" as const, wavelength: 1.54, radiationKind: "neutron" as const };
  const grid = Array.from({ length: 600 }, (_, i) => 15 + (i * 80) / 599);
  const probe: PowderPattern = {
    id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 1.54 },
    points: grid.map((x) => ({ x, yObs: 100 })),
  };

  // Cm'cm' on the Mn₃Ga parent at k = 0 (the golden-validated subgroup).
  const subs = list_magnetic_subgroups({ structure, k: [0, 0, 0], maxIndex: 6 });
  const ops = subs.candidates.find((c) => (c.bns ?? "").replace(/\s/g, "") === "Cm'cm'")!.operations;
  const mm = build_magnetic_model({ structure, ionLabels: ["Mn1"], operations: ops, moment: 2 });

  // Mn₃Ga + MnO, the Mn₃Ga ordered, on a sloped background (so a fitted
  // background keeps the terms whose basis differs): the data every case is
  // checked against.
  const twoPhase = buildMultiPhaseSpec([structure, mno], probe, neutron, 3);
  const TRUTH_BACKGROUND: Record<string, number> = { bkg0: 50, bkg1: 15, bkg2: -8 };
  const truthValue = (p: RefinementParameter): number =>
    p.kind === "scale" ? (p.id.startsWith("p0_") ? 3e-3 : 3e-4) : p.kind === "background" ? TRUTH_BACKGROUND[p.id] ?? 0 : p.value;
  const truthParams = [...twoPhase.params, ...mm.parameters].map((p) => ({ ...p, value: truthValue(p) }));
  const truth = buildMagneticPowderProblem(
    structure, mm.magnetic, probe, truthParams, [...twoPhase.bindings, ...mm.bindings], twoPhase.profile, undefined, [mnoPhase],
  ).calculate(Object.fromEntries(truthParams.map((p) => [p.id, p.value])));
  const pattern: PowderPattern = { ...probe, points: grid.map((x, i) => ({ x, yObs: truth[i]! })) };

  /** A start off the truth: moments moved, and a background whose basis matters. */
  const START_MOMENTS = [1.5, 0.3, 1.5];
  const BACKGROUND = [60, 12, -6];
  function start(nuclear: readonly RefinementParameter[]): RefinementParameter[] {
    const bkg = nuclear.filter((p) => p.kind === "background").map((p) => p.id);
    return [
      ...nuclear.map((p) => (p.kind === "background" ? { ...p, value: BACKGROUND[bkg.indexOf(p.id)] ?? 0 } : p.kind === "scale" ? { ...p, value: truthValue(p) } : p)),
      ...mm.parameters.map((p, i) => ({ ...p, value: START_MOMENTS[i]!, fixed: false })),
    ];
  }
  /** What the fitted problem gives at these values: its calculated pattern and wR. */
  function problemFit(profile: PowderProfile, parameters: readonly RefinementParameter[], bindings: readonly ParameterBinding[], extra: readonly PowderPhase[] = []) {
    const problem = buildMagneticPowderProblem(structure, mm.magnetic, pattern, parameters, bindings, profile, undefined, extra);
    const yCalc = problem.calculate(Object.fromEntries(parameters.map((p) => [p.id, p.value])));
    return { yCalc, wR: computeAgreementFactors(problem.observations, yCalc, problem.weights, 0).rWeighted ?? NaN };
  }
  function expectSameCurve(tool: readonly number[], fitted: Float64Array): void {
    const top = Math.max(...fitted);
    let worst = 0;
    for (let i = 0; i < fitted.length; i++) worst = Math.max(worst, Math.abs(tool[i]! - fitted[i]!));
    expect(worst).toBeLessThan(1e-9 * top);
  }
  /** The option a case sets moves the pattern: the check is not vacuous. */
  function expectOptionMatters(a: Float64Array, b: Float64Array): void {
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    expect(worst).toBeGreaterThan(0.01 * Math.max(...a));
  }

  const single = build_refinement({ structure, pattern, instrument: neutron, backgroundTerms: 3 });
  const singleParams = start(single.parameters);
  const singleBindings = [...single.bindings, ...mm.bindings];

  describe("evaluate_pattern", () => {
    const cases: [string, PowderProfile][] = [
      ["a cosine background", { ...single.profile, backgroundType: "cosine" }],
      ["the Lorentz factor off", { ...single.profile, lorentz: false }],
      // No Lorentzian width in the model: every peak takes the profile's η.
      ["a pseudo-Voigt with η = 0.3", { ...single.profile, shape: "pseudoVoigt", eta: 0.3 }],
    ];
    for (const [name, profile] of cases) {
      it(`draws ${name} as the fit does`, () => {
        const ev = evaluate_pattern({ structure, pattern, parameters: singleParams, bindings: singleBindings, profile, magnetic: mm.magnetic });
        const fitted = problemFit(profile, singleParams, singleBindings);
        expectOptionMatters(fitted.yCalc, problemFit(single.profile, singleParams, singleBindings).yCalc);
        expectSameCurve(ev.curves.yCalc, fitted.yCalc);
        expect(ev.agreement.wR).toBeCloseTo(100 * fitted.wR, 9);
        // rank_next_parameters probes from the same wR.
        const probed = rank_next_parameters({ structure, pattern, parameters: singleParams, bindings: singleBindings, profile, magnetic: mm.magnetic });
        expect(probed.wrNow).toBeCloseTo(fitted.wR, 9);
        // The two components still add up to the total.
        for (let i = 0; i < ev.curves.yCalc.length; i++) {
          expect(ev.curves.yNuclear![i]! + ev.curves.yMagnetic![i]!).toBeCloseTo(ev.curves.yCalc[i]!, 8);
        }
        expect(Math.max(...ev.curves.yMagnetic!)).toBeGreaterThan(0);
      });
    }
  });

  describe("refine_magnetic_powder", () => {
    const free = (ps: RefinementParameter[]): RefinementParameter[] =>
      ps.map((p) => ({ ...p, fixed: !["scale", "background", "momentMode"].includes(p.kind) || !!p.expression }));

    it("returns the components of the pattern it fitted on a cosine background", async () => {
      const profile: PowderProfile = { ...single.profile, backgroundType: "cosine" };
      const out = await refine_magnetic_powder({
        structure, magnetic: mm.magnetic, pattern, parameters: free(singleParams), bindings: singleBindings, profile, staged: false, maxIterations: 6,
      });
      const fitted = problemFit(profile, out.parameters, singleBindings);
      expectOptionMatters(fitted.yCalc, problemFit(single.profile, out.parameters, singleBindings).yCalc);
      expectSameCurve(out.components.yCalc, fitted.yCalc);
      expect(out.result.agreement.rWeighted).toBeCloseTo(fitted.wR, 9);
    }, 60000);

    it("returns the components of the pattern it fitted with the Lorentz factor off and an extra phase", async () => {
      const profile: PowderProfile = { ...twoPhase.profile, lorentz: false };
      const bindings = [...twoPhase.bindings, ...mm.bindings];
      const out = await refine_magnetic_powder({
        structure, magnetic: mm.magnetic, pattern, parameters: free(start(twoPhase.params)), bindings, profile,
        extraPhases: [mno], staged: false, maxIterations: 6,
      });
      const fitted = problemFit(profile, out.parameters, bindings, [mnoPhase]);
      expectOptionMatters(fitted.yCalc, problemFit(twoPhase.profile, out.parameters, bindings, [mnoPhase]).yCalc);
      expectSameCurve(out.components.yCalc, fitted.yCalc);
      expect(out.result.agreement.rWeighted).toBeCloseTo(fitted.wR, 9);
      // MnO is in the nuclear component, the moments in the magnetic one.
      expect(Math.max(...out.components.yMagnetic)).toBeGreaterThan(0);
    }, 60000);
  });
});
