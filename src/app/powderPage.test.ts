import { describe, it, expect } from "vitest";
import { ComputeClient } from "@/workers/computeClient";
import { mn3gaSession } from "@/agent/evals/pages";
import { executor, fakeHost, headlessHistory, sessionPort } from "@/testSupport/agentHeadless";
import { powderRestraints } from "@/app/powderSpec";
import { knownPhaseStructure } from "@/core/diagnostics/knownPhases";
import { DEFAULT_INSTRUMENT, type Session } from "@/app/powderSession";
import { extentOf, posteriorRun, powderFit, powderPageCurves, thoroughFit, withBackgroundType, withPhase, type PowderCompute, type PowderPageModel } from "@/app/powderPage";
import { evaluateBackground, type BackgroundType } from "@/core/diffraction/background";
import type { PowderCurves } from "@/core/workflow/powder";

/**
 * The powder page's operations, which the workbench and the Agent's headless
 * page both call: each request carries what the page's fit depends on. A copy
 * of these in the headless page once dropped the window (refine), the extra
 * phases and the magnetic model (the posterior), the restraints of every
 * phase but the first, and the Lorentzian part and background type of the
 * profile; the evals and the validation ran on that copy.
 */

/** The real client, each request it is asked for recorded. */
function recording(): { client: PowderCompute; requests: { call: string; req: Record<string, unknown> }[] } {
  const real = new ComputeClient();
  const requests: { call: string; req: Record<string, unknown> }[] = [];
  const watch = <K extends keyof PowderCompute>(call: K) => ((req: Record<string, unknown>, ...rest: unknown[]) => {
    requests.push({ call, req });
    return (real[call] as (...a: unknown[]) => unknown).call(real, req, ...rest);
  }) as unknown as PowderCompute[K];
  const client = {
    refinePowderParallel: watch("refinePowderParallel"),
    refineMagneticPowderParallel: watch("refineMagneticPowderParallel"),
    leBailPrefit: watch("leBailPrefit"),
    refinePowderMultiStart: watch("refinePowderMultiStart"),
    refineMagneticPowderMultiStart: watch("refineMagneticPowderMultiStart"),
    samplePowderPosterior: watch("samplePowderPosterior"),
    sampleMagneticPowderPosterior: watch("sampleMagneticPowderPosterior"),
  } as PowderCompute;
  return { client, requests };
}

/** The demo with a second phase and occupancy ties on, a log-interpolated background, and the cell free. */
function busySession(): Session {
  const s0 = mn3gaSession();
  const second = { ...s0.structure, id: "second", name: "Second" };
  const s1 = withBackgroundType(withPhase({ ...s0, siteTies: { ...s0.siteTies, occupancyToUnity: true } }, second, DEFAULT_INSTRUMENT), "logInterpolate");
  return { ...s1, powderParams: s1.powderParams.map((p) => (p.kind === "cellLength" ? { ...p, fixed: false } : p)) };
}

describe("the powder page's fits", () => {
  it("every request carries the window, every phase, every phase's restraints and the whole profile", async () => {
    const session = busySession();
    const page: PowderPageModel = { session, instrument: DEFAULT_INSTRUMENT, fitRange: { min: 20, max: 100 }, result: null };
    const { client, requests } = recording();
    await powderFit(client, page, { maxIterations: 2 });
    await thoroughFit(client, page);
    await posteriorRun(client, page)({ nSteps: 2, seed: 1 });
    expect(requests.map((r) => r.call)).toEqual(["refinePowderParallel", "refinePowderMultiStart", "samplePowderPosterior"]);
    const restraints = powderRestraints([session.structure, ...session.extraPhases], session.siteTies, session.powderParams);
    for (const { call, req } of requests) {
      expect(req.fitRange, call).toEqual({ min: 20, max: 100 });
      expect((req.extraPhases as unknown[]).length, call).toBe(1);
      expect(req.backgroundType, call).toBe("logInterpolate");
      expect(req.lorentz, call).toBe(session.powderProfile.lorentz);
      expect(req.restraints ?? [], call).toEqual(restraints);
    }
  }, 120_000);

  it("Prefit runs the Le Bail cell inside the window, then the multi-start from its cell", async () => {
    const s = mn3gaSession();
    const session = { ...s, powderParams: s.powderParams.map((p) => (p.kind === "cellLength" ? { ...p, fixed: false } : p)) };
    const { client, requests } = recording();
    const out = await thoroughFit(client, { session, instrument: DEFAULT_INSTRUMENT, fitRange: { min: 15, max: 110 }, result: null });
    expect(requests.map((r) => r.call)).toEqual(["leBailPrefit", "refinePowderMultiStart"]);
    expect(requests[0]!.req.fitRange).toEqual({ min: 15, max: 110 });
    expect(out.mode).toBe("prefit");
    expect(out.message).toMatch(/^Prefit/);
  }, 120_000);
});

describe("a page with a second phase, on the background basis chosen", () => {
  // The multi-phase curves and fits once drew and refined the default Chebyshev
  // basis whatever the page had chosen; the magnetic step's moments fit, which
  // used the page's, then disagreed with the page's wR (6.793 against 6.781).
  /** The demo with CaF₂ added, its four background coefficients read on the basis given. */
  const twoPhase = (basis: BackgroundType): Session => withBackgroundType(withPhase(mn3gaSession(), knownPhaseStructure("CaF₂")!, DEFAULT_INSTRUMENT), basis);
  const largest = (a: readonly number[], b: readonly number[]): number => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0);

  it("draws the basis chosen under the same peaks", () => {
    const s = twoPhase("cosine");
    const cosine = powderPageCurves(s).curves;
    const chebyshev = powderPageCurves(twoPhase("chebyshev")).curves;
    const coefficients = s.powderParams.filter((p) => p.kind === "background").map((p) => p.value);
    const { min, max } = extentOf(cosine.x);
    expect(largest(cosine.yBackground!, cosine.x.map((x) => evaluateBackground(x, coefficients, "cosine", min, max)))).toBeLessThan(1e-9);
    expect(largest(cosine.yBackground!, chebyshev.yBackground!)).toBeGreaterThan(1);
    const peaks = (c: PowderCurves): number[] => c.yCalc.map((y, i) => y - c.yBackground![i]!);
    expect(largest(peaks(cosine), peaks(chebyshev))).toBeLessThan(1e-9);
  });

  it("refines on it (in the page's thread and through the evaluator spec), to the wR the page shows", async () => {
    for (const fit of ["refine", "thorough"] as const) {
      const coefficients: Partial<Record<BackgroundType, number[]>> = {};
      for (const basis of ["cosine", "chebyshev"] as const) {
        const { port } = sessionPort(twoPhase(basis));
        // The demo holds no CaF₂: its scale goes to nothing, and a free cell with it runs away.
        port.setFixed([{ id: "p1_cell_a", fixed: true }]);
        port.setFitRange({ min: 20, max: 100 });
        await port[fit]();
        const { result, wR, parameters } = port.state();
        expect(result!.status, `${fit} ${basis}`).toBe("converged");
        expect(result!.agreement.rWeighted, `${fit} ${basis}`).toBeCloseTo(wR, 9);
        coefficients[basis] = parameters.filter((p) => p.kind === "background").map((p) => p.value);
      }
      // Four terms of either basis follow this smooth background about as well (the wR's within 10⁻⁶), each with its own coefficients.
      expect(largest(coefficients.cosine!, coefficients.chebyshev!), fit).toBeGreaterThan(5);
    }
  }, 120_000);
});

describe("a phase the data do not contain, its cell free", () => {
  it("Refine completes when a trial step drives the cell negative (it threw a RangeError and ended the refinement)", async () => {
    // The demo has no CaF₂: its scale goes to 0 and its free cell drifts until
    // a trial step makes it negative, where no reflections can be listed.
    const { port } = sessionPort(mn3gaSession());
    port.setFitRange({ min: 20, max: 100 });
    port.addPhase!(knownPhaseStructure("CaF₂")!);
    port.setFixed([{ id: "p1_cell_a", fixed: false }]);
    const seed = port.state().parameters.find((p) => p.id === "p1_scale")!.value;
    await port.refine();
    const result = port.state().result!;
    expect(result.message).toMatch(/trial step\(s\) rejected outside the model's domain \(Cell length a = -[\d.]+ Å is not a positive, finite length/);
    expect(result.parameters.p1_cell_a).toBeGreaterThan(0);
    // The fit says what the data say: no CaF₂, and the demo's own fit.
    expect(result.parameters.p1_scale).toBeLessThan(1e-3 * seed);
    const { port: alone } = sessionPort(mn3gaSession());
    alone.setFitRange({ min: 20, max: 100 });
    await alone.refine();
    expect(port.state().wR).toBeCloseTo(alone.state().wR, 5);
  }, 120_000);
});

describe("the Agent's headless powder page runs the page's operations", () => {
  it("applies what each control does (the copy only logged the background, microstrain and ADP controls)", () => {
    const { port } = sessionPort(mn3gaSession());
    const rows = (): number => port.state().parameters.filter((p) => p.kind === "background").length;
    port.setBackgroundTerms(rows() + 2);
    expect(port.state().settings.backgroundTerms).toBe(rows());
    port.setBackgroundType("linInterpolate");
    expect(port.state().settings.backgroundType).toBe("linInterpolate");
    port.setMustrain("uniaxial");
    expect(port.state().settings.mustrain).toBe("uniaxial");
    port.setAnisotropicAdp(true);
    expect(port.state().settings.anisotropicAdp).toBe(true);
  });

  it("samples the posterior over the window it fits", async () => {
    const { client, requests } = recording();
    const { port } = sessionPort(mn3gaSession(), DEFAULT_INSTRUMENT, { client });
    port.setFitRange({ min: 20, max: 100 });
    await port.refine();
    await port.samplePosterior!({ continue: false, steps: 2 });
    expect(requests.map((r) => [r.call, r.req.fitRange])).toEqual([["refinePowderParallel", { min: 20, max: 100 }], ["samplePowderPosterior", { min: 20, max: 100 }]]);
    expect(port.state().observationCount).toBeLessThan(port.state().curves.x.length);
  }, 120_000);
});

describe("the Agent's headless page and the History", () => {
  it("goes back to a step as the app does: its state on the page, the History's current step moved (it once did nothing)", async () => {
    const { port } = sessionPort(mn3gaSession());
    const history = headlessHistory(port);
    const { host } = fakeHost(port, history.history, (kind, agent) => history.record(kind, agent ? "agent" : undefined), history.goTo);
    const { ex } = executor(host, "auto");
    await ex.run("refine", {});
    history.record("refine", "agent", "Refine");
    const first = history.history()!.current;
    const after1 = port.state().parameters.map((p) => p.value);
    expect(port.state().parameters.filter((p) => p.kind === "bIso" && !p.fixed)).toEqual([]);
    await ex.run("set_free", { free: ["B_*"] });
    await ex.run("refine", {});
    history.record("refine", "agent", "Refine");
    expect(port.state().parameters.map((p) => p.value)).not.toEqual(after1);
    const back = await ex.run("go_to_step", { step: first });
    expect(back.isError, back.text).toBe(false);
    expect(history.history()!.current).toBe(first);
    expect(port.state().parameters.map((p) => p.value)).toEqual(after1);
    expect(port.state().parameters.filter((p) => p.kind === "bIso" && !p.fixed)).toEqual([]);
  }, 120_000);
});
