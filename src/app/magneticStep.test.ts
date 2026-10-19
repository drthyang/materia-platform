import { describe, it, expect } from "vitest";
import { parse_structure, simulate_pattern } from "@/mcp/tools";
import { loadedSession } from "@/app/powderSession";
import { powderMomentFit, powderPageCurves, refinedPhasesOf, residualPeaksOf, weightedR } from "@/app/powderPage";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { momentFit as singleCrystalMomentFit, singleCrystalPage, type SingleCrystalCompute } from "@/app/singleCrystalPage";
import { MagneticStep, candidatesOf, momentDims, buildFor, rankCandidates, stepView, type MagneticFit, type StepInputs } from "@/app/magneticStep";
import { sessionPort } from "@/testSupport/agentHeadless";
import { corundumPage } from "@/testSupport/scPages";
import { mn3gaMagneticSession } from "@/agent/evals/pages";
import { knownPhaseStructure } from "@/core/diagnostics/knownPhases";
import { ComputeClient } from "@/workers/computeClient";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { MagneticModel } from "@/core/magnetic/types";
import type { RefinementParameter } from "@/core/refinement/types";
import type { Vec3 } from "@/core/math/types";

/**
 * The magnetic analysis step (magneticStep.ts), which the panel and the
 * Agent's headless page both run. The headless page once kept its own copy:
 * it searched k without the lattice's centring, fitted the moments over the
 * whole pattern, the primary phase only and the default background basis,
 * scored the nuclear model its own way, ranked only the maximal groups,
 * stopped the ranking at a failed fit, and left the k rows fixed on Continue.
 * The panel's own fit dropped the background basis too, and both freed the
 * phase gauge of a two-arm k.
 */

/** α-Fe (Im-3m) with the CsCl-type antiferromagnet's peaks (h + k + l odd), k = (0 0 1). */
function bccPage(): ReturnType<typeof sessionPort> {
  const instrument: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 2.4, u: 3889, v: -6417, w: 3098, x: 0, y: 0 };
  const structure = parse_structure({
    cif: `data_fe
_cell_length_a 2.8665
_cell_length_b 2.8665
_cell_length_c 2.8665
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'I m -3 m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
Fe1 Fe3+ 0 0 0 1 0.4
`,
  }).structure;
  const sim = simulate_pattern({ structure, instrument, xMin: 10, xMax: 140, points: 1300 });
  const top = Math.max(...sim.curves.yCalc);
  const twoTheta = (d: number): number => (360 / Math.PI) * Math.asin(2.4 / (2 * d));
  const odd = [[1, 0, 0], [1, 1, 1], [2, 1, 0]].map(([h, k, l]) => twoTheta(2.8665 / Math.hypot(h!, k!, l!)));
  const points = sim.curves.x.map((x, i) => {
    const y = sim.curves.yCalc[i]! + 50 + odd.reduce((sum, c) => sum + 0.15 * top * Math.exp(-0.5 * ((x - c) / 0.25) ** 2), 0);
    return { x, yObs: y, sigma: Math.sqrt(y) };
  });
  const pattern = { id: "p", name: "sim", xUnit: "twoTheta" as const, radiation: { kind: "neutron" as const, wavelength: 2.4 }, wavelength: 2.4, points };
  return sessionPort(loadedSession(structure, pattern, instrument), instrument);
}

/** The app's compute client, each magnetic powder fit it is asked for recorded; `fail` makes the first one throw. */
function recordingClient(fail = false): { client: ComputeClient; fits: RefinementParameter[][] } {
  const fits: RefinementParameter[][] = [];
  class Recording extends ComputeClient {
    override async refineMagneticPowderParallel(...args: Parameters<ComputeClient["refineMagneticPowderParallel"]>): ReturnType<ComputeClient["refineMagneticPowderParallel"]> {
      fits.push([...args[0].parameters]);
      if (fail && fits.length === 1) throw new Error("the fit diverged");
      return super.refineMagneticPowderParallel(...args);
    }
  }
  return { client: new Recording(), fits };
}

const TWO_ARM: Vec3 = [0, 0, 0.25];

describe("the magnetic step on the Agent's page, as on the app's", () => {
  it("searches k against the lattice's centring", () => {
    // Without it, the primitive lattice indexes the h + k + l odd peaks at k = 0.
    const { port } = bccPage();
    const found = port.magnetic!()!.searchK();
    expect(found[0]!.label).toBe("(0 0 1)");
  }, 30000);

  // The wR the step reports is the page's at the moments it fitted, whatever the page fits against.
  const fittedOn = async (change: (port: ReturnType<typeof sessionPort>["port"]) => void): Promise<{ step: number | null; page: number }> => {
    const { port } = sessionPort(mn3gaMagneticSession());
    change(port);
    const h = (): NonNullable<ReturnType<NonNullable<typeof port.magnetic>>> => port.magnetic!()!;
    h().setK([0, 0, 0.5]);
    h().choose("G2");
    const step = await h().refineMoments();
    h().apply(true);
    return { step, page: port.state().wR };
  };

  it("fits the moments in the page's window and against every phase", async () => {
    const { step, page } = await fittedOn((port) => {
      port.setFitRange({ min: 20, max: 100 });
      port.addPhase!(knownPhaseStructure("CaF₂")!);
    });
    expect(step).not.toBeNull();
    expect(step!).toBeCloseTo(page, 6);
  }, 60000);

  it("fits the moments against the page's background basis", async () => {
    const { step, page } = await fittedOn((port) => {
      port.setFitRange({ min: 20, max: 100 });
      port.setBackgroundType("cosine");
    });
    expect(step).not.toBeNull();
    expect(step!).toBeCloseTo(page, 6);
  }, 60000);

  it("fits the moments against every phase and the page's background basis together", async () => {
    // The page's multi-phase curves once drew the default Chebyshev basis while the fit used the page's (7.536 against 7.522 here).
    const { step, page } = await fittedOn((port) => {
      port.setFitRange({ min: 20, max: 100 });
      port.addPhase!(knownPhaseStructure("CaF₂")!);
      port.setBackgroundType("cosine");
    });
    expect(step).not.toBeNull();
    expect(step!).toBeCloseTo(page, 6);
  }, 60000);

  it("compares the groups with the page's own nuclear-only wR", () => {
    const { port, session } = sessionPort(mn3gaMagneticSession());
    port.setFitRange({ min: 20, max: 100 });
    port.addPhase!(knownPhaseStructure("CaF₂")!);
    const window = port.state().fitRange;
    expect(port.magnetic!()!.state().baselineAgreement).toBeCloseTo(weightedR(session(), powderPageCurves(session()).nuclear, window), 9);
  }, 30000);

  it("hands Continue's rows over with k free and the phase gauge held", () => {
    const { port, session } = sessionPort(mn3gaMagneticSession());
    const h = (): NonNullable<ReturnType<NonNullable<typeof port.magnetic>>> => port.magnetic!()!;
    h().setK(TWO_ARM);
    h().choose(h().state().candidates.find((c) => c.momentDims > 0)!.id);
    h().continueToRefinement(true);
    const rows = session().powderParams.filter((p) => p.kind === "momentMode" || p.kind === "propagationK");
    expect(rows.filter((p) => p.label.includes("[phase gauge]")).map((p) => p.fixed)).toEqual([true]);
    expect(rows.filter((p) => p.kind === "propagationK" && !p.expression).every((p) => !p.fixed)).toBe(true);
    expect(rows.filter((p) => p.kind === "momentMode" && !p.label.includes("[phase gauge]")).every((p) => !p.fixed)).toBe(true);
  }, 30000);

  it("fits the moments through the page's compute client with the phase gauge held", async () => {
    const { client, fits } = recordingClient();
    const { port } = sessionPort(mn3gaMagneticSession(), undefined, { client });
    const h = (): NonNullable<ReturnType<NonNullable<typeof port.magnetic>>> => port.magnetic!()!;
    h().setK(TWO_ARM);
    h().choose(h().state().candidates.find((c) => c.momentDims > 0)!.id);
    await h().refineMoments();
    expect(fits).toHaveLength(1);
    const moments = fits[0]!.filter((p) => p.kind === "momentMode");
    expect(moments.filter((p) => p.label.includes("[phase gauge]")).map((p) => p.fixed)).toEqual([true]);
    expect(moments.filter((p) => !p.label.includes("[phase gauge]")).every((p) => !p.fixed)).toBe(true);
  }, 60000);

  it("marks a group whose fit fails and ranks the rest", async () => {
    const { client } = recordingClient(true);
    const { port } = sessionPort(mn3gaMagneticSession(), undefined, { client });
    const h = (): NonNullable<ReturnType<NonNullable<typeof port.magnetic>>> => port.magnetic!()!;
    h().setK([0, 0, 0.5]);
    await h().rank("open", 0);
    const fitted = h().state().candidates.filter((c) => c.fit);
    expect(fitted.filter((c) => c.fit!.status === "failed")).toHaveLength(1);
    expect(fitted.filter((c) => c.fit!.status === "ok").length).toBeGreaterThan(1);
  }, 60000);

  it("ranks every index section that is open, the chosen group's among them", async () => {
    const { port } = sessionPort(mn3gaMagneticSession());
    const h = (): NonNullable<ReturnType<NonNullable<typeof port.magnetic>>> => port.magnetic!()!;
    h().setK([0, 0, 0.5]);
    const fourth = h().state().candidates.find((c) => c.index === 4 && c.momentDims > 0)!;
    h().choose(fourth.id);
    await h().rank("open", 0);
    const ranked = h().state().candidates.filter((c) => c.fit);
    expect(ranked.some((c) => c.index === 2)).toBe(true);
    expect(ranked.some((c) => c.index === 4)).toBe(true);
    expect(ranked.every((c) => c.index === 2 || c.index === 4)).toBe(true);
  }, 120000);
});

describe("one restart scheme", () => {
  it("the ranking is the restart loop: one fit per start, each without restarts of its own unless the fit keeps them", async () => {
    const s = mn3gaMagneticSession();
    const k: Vec3 = [0, 0, 0.5];
    const reps = candidatesOf(s.structure, k);
    const dims = momentDims(s.structure, reps, ["Mn1"], k);
    const calls: (number | undefined)[] = [];
    const fit: MagneticFit = {
      agreementLabel: "wR",
      refine: async (_magnetic, params, _bindings, options) => {
        calls.push(options?.restarts);
        return { values: Object.fromEntries(params.map((p) => [p.id, p.value])), agreement: 0.1 };
      },
    };
    const ties = { sameSite: true, magnitudes: false as const, flippedUnits: [] };
    const results = await rankCandidates({
      reps, dims, scope: "open", open: new Set([2]), restarts: 3, fit, structure: s.structure,
      build: (ops) => buildFor(s.structure, k, ["Mn1"], ops, ties),
    });
    const ranked = Object.values(results).filter((e) => e.status === "ok").length;
    expect(ranked).toBeGreaterThan(1);
    expect(calls).toHaveLength(ranked * 4);
    expect(calls.every((r) => r === 0)).toBe(true);
    // A fit that keeps its own starts (the mPDF's) is asked for its default in each.
    calls.length = 0;
    await rankCandidates({
      reps, dims, scope: "open", open: new Set([2]), restarts: 3, fit: { ...fit, nestedStarts: true }, structure: s.structure,
      build: (ops) => buildFor(s.structure, k, ["Mn1"], ops, ties),
    });
    expect(calls).toHaveLength(ranked * 4);
    expect(calls.every((r) => r === undefined)).toBe(true);
  });

  const magnetic: MagneticModel = { id: "mag", structureId: "x", propagation: [[0, 0, 0]], moments: [] };

  it("refines the single crystal's moments with its own restarts, or as many as asked", async () => {
    const asked: unknown[] = [];
    const client = {
      refineMagneticSingleCrystalMultiStart: async (_spec: unknown, multiStart: { restarts?: number }) => {
        asked.push(multiStart.restarts);
        return { final: { parameters: {}, agreement: { rWeighted: 0.1 } } };
      },
    } as unknown as SingleCrystalCompute;
    const c = corundumPage();
    const m = singleCrystalPage(c.structure, c.dataset);
    await singleCrystalMomentFit(client, m, magnetic, [], []);
    await singleCrystalMomentFit(client, m, magnetic, [], [], { restarts: 0 });
    expect(asked).toEqual([8, 0]);
  });

});

describe("the step's state, as the panel keeps it", () => {
  /** A step over the magnetic Mn₃Ga page, its inputs as the workbench gives them; `set` changes them as a render would. */
  function stepOn(): { step: MagneticStep; set: (change: Partial<StepInputs>) => void; at: () => StepInputs } {
    const s = mn3gaMagneticSession();
    let at: StepInputs = {
      structure: refinedPhasesOf(s)[0]!,
      residualPeaks: residualPeaksOf(s, undefined),
      fit: powderMomentFit(new ComputeClient(), s, null),
      baselineAgreement: null,
      allowRefineK: true,
      fitContext: "data|all",
      preselect: null,
    };
    const step = new MagneticStep(() => at);
    return { step, at: () => at, set: (change) => { at = { ...at, ...change }; step.sync(); } };
  }
  const view = (step: MagneticStep): ReturnType<typeof stepView> => step.view();

  it("keeps the ranking when the page shows the model (the structure rebuilt, equal); drops it for another structure, window or k", async () => {
    const { step, set, at } = stepOn();
    step.setK([0, 0, 0.5]);
    await step.rank("open", 0);
    const ranked = Object.keys(view(step).rankResults).length;
    expect(ranked).toBeGreaterThan(1);
    // Show strips the model's rows, so the refined structure is made again, equal.
    set({ structure: structuredClone(at().structure) });
    expect(Object.keys(view(step).rankResults)).toHaveLength(ranked);
    set({ fitContext: "data|20–100" });
    expect(view(step).rankResults).toEqual({});
    // It does not come back with the window it ran on.
    set({ fitContext: "data|all" });
    expect(view(step).rankResults).toEqual({});
    await step.rank("open", 0);
    const st = at().structure;
    set({ structure: { ...st, sites: st.sites.map((x, i) => (i === 0 ? { ...x, position: [x.position[0], x.position[1], x.position[2] + 0.01] as Vec3 } : x)) } });
    expect(view(step).rankResults).toEqual({});
  }, 60000);

  it("drops the per-peak picks with a new criterion, and keeps those of the peaks still detected", () => {
    const { step, set, at } = stepOn();
    const rows = view(step).rows;
    expect(rows.length).toBeGreaterThan(2);
    step.setOverride(rows[0]!.key, false);
    step.setCriteria({ minSig: 4 });
    expect(step.state().overrides).toEqual({});
    step.setOverride(rows[0]!.key, false);
    step.setOverride(rows[1]!.key, false);
    set({ residualPeaks: at().residualPeaks.filter((p) => Math.abs(p.d - rows[1]!.d) > 1e-6) });
    expect(step.state().overrides).toEqual({ [rows[0]!.key]: false });
  });

  it("keeps the k-search's candidates for the peaks it ran on", () => {
    const { step } = stepOn();
    step.search();
    expect(view(step).results?.length).toBeGreaterThan(0);
    const first = view(step).rows.find((r) => r.included)!;
    step.setOverride(first.key, false);
    expect(view(step).results).toBeNull();
    step.setOverride(first.key, true);
    expect(view(step).results).toBeNull();
  });

  it("starts a ranked group from its fitted moments, and keeps an amplitude through a rebuild of the same model", async () => {
    const { step } = stepOn();
    step.setK([0, 0, 0.5]);
    await step.rank("open", 0);
    const v = view(step);
    const g2 = v.reps[1]!;
    step.choose(1);
    const entry = view(step).rankResults[g2.candidate.id]!;
    expect(entry.status).toBe("ok");
    for (const p of view(step).build!.params) expect(step.state().amps[p.id]).toBeCloseTo(entry.values[p.id]!, 12);
    const id = view(step).build!.params[0]!.id;
    step.setAmp(id, 1.7);
    step.setIons(["Mn1"]);
    expect(step.state().amps[id]).toBe(1.7);
    // A second click on the chosen row clears the choice.
    step.choose(null);
    expect(step.state().chosen).toBeNull();
  }, 60000);

  it("opens on a model: its k, its group chosen, its amplitudes fitted to its moments", () => {
    const { step, set, at } = stepOn();
    const k: Vec3 = [0, 0, 0.5];
    const reps = candidatesOf(at().structure, k);
    const build = buildFor(at().structure, k, ["Mn1"], reps[1]!.candidate.operations, { sameSite: true, magnitudes: false, flippedUnits: [] });
    const model = applyMagneticMoments(build.magnetic, build.bindings, Object.fromEntries(build.params.map((p) => [p.id, 2.5])));
    set({ preselect: model });
    expect(step.state().k).toEqual(k);
    expect(step.state().chosen).toBe(1);
    expect(step.state().open.has(reps[1]!.index)).toBe(true);
    for (const p of view(step).build!.params) expect(view(step).resolvedAmps[p.id]).toBeCloseTo(2.5, 6);
  });

  it("drops the moments fit's readout for good when the group or the data change", async () => {
    const { step, set } = stepOn();
    step.setK([0, 0, 0.5]);
    step.choose(1);
    expect(await step.refineMoments()).not.toBeNull();
    expect(view(step).fitWR).not.toBeNull();
    step.choose(2);
    step.choose(1);
    expect(view(step).fitWR).toBeNull();
    await step.refineMoments();
    set({ fitContext: "other data|all" });
    expect(view(step).fitWR).toBeNull();
  }, 60000);
});
