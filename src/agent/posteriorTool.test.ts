import { describe, it, expect } from "vitest";
import { parse_structure, simulate_pattern } from "@/mcp/tools";
import { loadedSession } from "@/app/powderSession";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { posteriorDifference, posteriorView } from "@/agent/posteriorTool";
import type { SampleResult } from "@/core/refinement/bayes/sampler";
import type { RefinementParameter } from "@/core/refinement/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";

const row = (id: string, value: number, extra: Partial<RefinementParameter> = {}): RefinementParameter =>
  ({ id, label: id, kind: "bIso", value, initialValue: value, fixed: false, ...extra });

/** A posterior summary as the sampler returns it, for the parameters given. */
function result(params: { id: string; median: number; q: [number, number, number, number]; esdRatio?: number }[], over: Partial<SampleResult["diagnostics"]> = {}, correlation?: number[][]): SampleResult {
  const n = params.length;
  return {
    chains: [], logProb: [], freeIds: params.map((p) => p.id), acceptanceFraction: 0.35,
    diagnostics: { rHat: params.map(() => 1.01), ess: params.map(() => 800), maxRHat: 1.01, minEss: 800, nSamples: 4800, ...over },
    posterior: {
      parameters: params.map((p) => ({ id: p.id, mean: p.median, median: p.median, std: (p.q[2] - p.q[1]) / 2, q025: p.q[0], q16: p.q[1], q84: p.q[2], q975: p.q[3], rHat: 1.01, ess: 800, ...(p.esdRatio !== undefined ? { esdRatio: p.esdRatio } : {}) })),
      correlation: correlation ?? Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))),
    },
    resume: { q: Array.from({ length: 12 }, () => []), logP: [], rngDraws: 0, stepIndex: 400, freeIds: params.map((p) => p.id), seed: 1 },
    status: (over.maxRHat ?? 1.01) < 1.05 && (over.minEss ?? 800) >= 100 ? "ok" : "not-converged",
  };
}

describe("reading the posterior", () => {
  const params = [row("B_W1", 0.44, { min: 0, max: 10 }), row("B_Cr1", 0.02, { min: 0, max: 10 }), row("B_O1", 0.35, { min: 0, max: 10 }), row("pos_O1_0", -0.01, { kind: "positionShift", min: -0.2, max: 0.2 })];
  const esd = { B_W1: 0.08, B_Cr1: 0.2, B_O1: 0.14, pos_O1_0: 0.0008 };

  it("confirms an esd, widens one, reads a bound as a limit, and names a strong correlation", () => {
    const view = posteriorView(result([
      { id: "B_W1", median: 0.44, q: [0.28, 0.36, 0.52, 0.60], esdRatio: 1.02 },
      { id: "B_Cr1", median: 0.15, q: [0.004, 0.05, 0.33, 0.55], esdRatio: 0.9 },
      { id: "B_O1", median: 0.4, q: [0.15, 0.2, 0.62, 0.85], esdRatio: 2.1 },
      { id: "pos_O1_0", median: -0.01, q: [-0.0118, -0.0108, -0.007, -0.0055], esdRatio: 1.5 },
    ], {}, [[1, -0.86, 0, 0], [-0.86, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]), params, esd) as { converged: boolean; reading: string; intervals: { id: string; verdict: string; bound?: string; skewed?: boolean }[] };
    const v = new Map(view.intervals.map((p) => [p.id, p]));
    expect(view.converged).toBe(true);
    expect(v.get("B_W1")!.verdict).toBe("the posterior confirms the esd");
    expect(v.get("B_Cr1")!.bound).toBe("lower");
    expect(v.get("B_Cr1")!.verdict).toMatch(/only an upper limit is determined, < 0\.55 at 95 %/);
    expect(v.get("B_O1")!.verdict).toMatch(/2\.1× wider than the esd: quote the credible interval/);
    expect(v.get("pos_O1_0")!.skewed).toBe(true);
    expect(view.reading).toMatch(/B_O1 \(×2\.1\): the esd understates the uncertainty/);
    expect(view.reading).toMatch(/B_Cr1: on a bound, only a limit is determined/);
    expect(view.reading).toMatch(/B_W1 ↔ B_Cr1 -0\.86 — the data fix their combination/);
    expect(view.reading).toMatch(/as overconfident as the esds/);
  });

  it("reads a bound against the posterior's width, not the bound range: B 0.15 [0.082, 0.218] in [0, 20] is determined", () => {
    const wide = [row("B_Mn1", 0.15, { min: 0, max: 20 })];
    const view = posteriorView(result([{ id: "B_Mn1", median: 0.15, q: [0.082, 0.115, 0.185, 0.218], esdRatio: 1.0 }]), wide, { B_Mn1: 0.035 }) as { intervals: { id: string; verdict: string; bound?: string }[] };
    expect(view.intervals[0]!.bound).toBeUndefined();
    expect(view.intervals[0]!.verdict).toBe("the posterior confirms the esd");
    // Piled against the bound: its 2.5 % quantile within a few per cent of its width of it.
    const piled = posteriorView(result([{ id: "B_Mn1", median: 0.03, q: [0.001, 0.01, 0.07, 0.1], esdRatio: 1.0 }]), wide, { B_Mn1: 0.03 }) as { intervals: { bound?: string }[] };
    expect(piled.intervals[0]!.bound).toBe("lower");
  });

  it("gives the posterior of a difference and the probability one value is the larger", () => {
    // Two walkers' draws of (a, b): a − b = 0.5 ± spread, a the larger in 9 of 10 draws.
    const draws = [0.9, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.3, 0.1, -0.2].map((d, i) => [1 + d, 1, i]);
    const r = { ...result([{ id: "a", median: 1.4, q: [1, 1.2, 1.6, 1.8] }, { id: "b", median: 1, q: [0.9, 0.95, 1.05, 1.1] }, { id: "c", median: 4, q: [0, 2, 6, 9] }]), chains: [draws.slice(0, 5), draws.slice(5)] };
    const d = posteriorDifference(r, "a", "b");
    expect(d.probabilityAGreater).toBe(0.9);
    expect(d.median).toBeCloseTo(0.475, 3);
    expect(d.ci95[0]).toBeLessThan(0);
    expect(() => posteriorDifference(r, "a", "zz")).toThrow(/zz is not a sampled/);
    const view = posteriorView(r, params, esd, [["a", "b"]]) as { reading: string; differences: unknown[] };
    expect(view.differences).toHaveLength(1);
    expect(view.reading).toMatch(/a − b = 0\.475 .*P\(a > b\) = 0\.9: the data do not distinguish them at 95 %/);
  });

  it("says to continue the chain before reading a run that has not converged", () => {
    const view = posteriorView(result([{ id: "B_W1", median: 0.44, q: [0.28, 0.36, 0.52, 0.60], esdRatio: 1 }], { maxRHat: 1.2, minEss: 40 }), params, esd) as { converged: boolean; reading: string };
    expect(view.converged).toBe(false);
    expect(view.reading).toMatch(/^Not converged yet \(R̂max 1\.2, ESS min 40.*continue: true/);
  });
});

describe("sample_posterior through the Agent", () => {
  const CIF = `data_t
_cell_length_a 4.5753
_cell_length_b 4.5753
_cell_length_c 8.8537
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 42/m n m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
W1 W6+ 0 0 0 1 0.5
Cr1 Cr3+ 0 0 0.3330 1 0.5
O1 O2- 0.2985 0.2985 0 1 0.6
O2 O2- 0.3075 0.3075 0.3400 1 0.6
`;
  const INSTRUMENT: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 2.4067, u: 3889, v: -6417, w: 3098, x: 0, y: 0 };

  it("refuses before a refinement, samples after one, reads the esds, and continues the chain", async () => {
    const structure = parse_structure({ cif: CIF }).structure;
    const sim = simulate_pattern({ structure, instrument: INSTRUMENT, xMin: 10, xMax: 130, points: 600 });
    const top = Math.max(...sim.curves.yCalc);
    let seed = 5;
    const u = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pattern: PowderPattern = {
      id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 2.4067 }, wavelength: 2.4067,
      points: sim.curves.x.map((x, i) => {
        const y = (5000 * sim.curves.yCalc[i]!) / top + 60;
        return { x, yObs: y + Math.sqrt(y) * Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()), sigma: Math.sqrt(y) };
      }),
    };
    const { port, calls } = sessionPort(loadedSession(structure, pattern, INSTRUMENT), INSTRUMENT);
    const { ex, asked } = executor(fakeHost(port).host, true);
    const parse = (t: string): Record<string, unknown> => JSON.parse(t) as Record<string, unknown>;
    expect((await ex.run("sample_posterior", {})).text).toMatch(/refine first/);

    await ex.run("set_free", { free: ["scale", "bkg0", "B_W1", "B_O2"] });
    await ex.run("set_free", { fix: ["bkg1", "bkg2", "bkg3", "cell_a", "cell_c"] });
    await ex.run("refine", {});
    expect((await ex.run("sample_posterior", { continue: true })).text).toMatch(/no posterior run to continue/);
    // A free set other than the refinement's: its esds are not this set's.
    await ex.run("set_free", { free: ["B_O1"] });
    expect((await ex.run("sample_posterior", {})).text).toMatch(/refine first with this free set.*now free: B_O1/);
    await ex.run("set_free", { fix: ["B_O1"] });

    const askedBefore = asked.length;
    type Run = { converged: boolean; intervals: { id: string; esdRatio?: number; ci95: [number, number] }[]; steps: number; reading: string };
    const first = parse((await ex.run("sample_posterior", { steps: 300 })).text) as Run;
    // A read: nothing asked.
    expect(asked.length).toBe(askedBefore);
    expect(first.steps).toBe(300);
    expect(first.intervals.map((p) => p.id).sort()).toEqual(["B_O2", "B_W1", "bkg0", "scale"]);
    // 300 steps of 12 walkers have not mixed: the reading says to continue, not to read.
    if (!first.converged) expect(first.reading).toMatch(/^Not converged yet.*continue: true/);

    // Continue until converged, or close to it (split-R̂ over ensemble walkers is conservative).
    let last = parse((await ex.run("sample_posterior", { continue: true, steps: 2000 })).text) as Run & { nearlyConverged?: boolean };
    expect(last.steps).toBe(2300);
    for (let i = 0; i < 3 && !(last.converged || last.nearlyConverged); i++) {
      last = parse((await ex.run("sample_posterior", { continue: true, steps: 2000 })).text) as Run & { nearlyConverged?: boolean };
    }
    expect(last.converged || last.nearlyConverged).toBe(true);
    expect(last.reading).toMatch(/^(Converged|Close to converged)/);
    // A correct model with honest σ: the posterior agrees with the least-squares esds.
    for (const p of last.intervals) {
      expect(p.esdRatio).toBeGreaterThan(0.6);
      expect(p.esdRatio).toBeLessThan(1.6);
    }
    const bW = last.intervals.find((p) => p.id === "B_W1")!;
    expect(bW.ci95[0]).toBeLessThan(0.5);
    expect(bW.ci95[1]).toBeGreaterThan(0.5);
    // The refused continue asked the page, which had nothing to continue.
    expect(calls.filter((c) => c.startsWith("sample")).slice(0, 3)).toEqual(["sample continue 400", "sample start 300", "sample continue 2000"]);
  }, 180000);
});
