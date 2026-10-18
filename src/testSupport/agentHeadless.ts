/**
 * The Agent's pages without React, for tests and the eval suite: a powder
 * session, the GaTa4Se8 PDF demo and a single-crystal data set behind real
 * ports (the real curves and the real engine), a host that keeps the Agent's
 * records in memory, and an executor that has read the pages' methods.
 */

import { AgentExecutor, type ActivityEntry, type AgentHost } from "@/agent/executor";
import type { AgentReport } from "@/agent/report";
import { PAGE_METHOD } from "@/agent/skills";
import { emptyRecord, type AgentRecord } from "@/agent/method";
import type { AgentPort, PdfAgentPort, PdfLiveState, PowderAgentPort, PowderLiveState, SingleCrystalAgentPort } from "@/agent/port";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { buildPdfProblem, buildPdfSpec, pdfCurves } from "@/core/workflow/pdf";
import { applyParameters } from "@/core/workflow/apply";
import { refine as refineProblem } from "@/core/refinement/engine";
import { boxcarTable, boxcarWindows, type BoxcarRun } from "@/core/workflow/pdfBoxcar";
import { DEFAULT_INSTRUMENT, type Session } from "@/app/powderSession";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import { isHydrogen, withAdpModel } from "@/core/crystal/adp";
import type { StructureModel } from "@/core/crystal/types";
import { axisContext, convertAxisArray } from "@/visualization/axisUnits";
import type { RefinementResult } from "@/core/refinement/types";
import type { SampleOptions, SampleResult } from "@/core/refinement/bayes/sampler";
import { magneticHandle } from "@/testSupport/magneticHeadless";
import { ComputeClient } from "@/workers/computeClient";
import {
  extentOf, hasTensorAdp, observationsIn, posteriorRun, powderFit, powderPageCurves, refinedPhasesOf, restraintRequest, thoroughFit, weightedR,
  withAnisotropicAdp, withAntisitePair, withBackgroundTerms, withBackgroundType, withCorrections, withFitResult, withFixed, withInstrumentConstants,
  withMustrain, withParameterTies, withPhase, withReset, withSiteTies, type FitWindow, type PowderCompute, type PowderPageModel,
} from "@/app/powderPage";
import { moveTo, recordStep, restoreStep, type ProjectHistory, type Snapshot, type StepActor, type StepKind } from "@/core/project/history";
import type { Workspace } from "@/core/project/types";
import { pdfReportInput, powderReportInput } from "@/app/reportInputs";
import type { SingleCrystalDataset } from "@/core/diffraction/types";
import {
  liveStateOf, reportInputOf, singleCrystalFit, singleCrystalPage, singleCrystalProbe, singleCrystalThorough, withAdpModel as withScAdpModel, withExtinctionModel,
  withFit, withFixed as withScFixed, withHand, withMerged, withOmitted, withOutlierFilter, withParameterTies as withScParameterTies, withRadiation,
  withReset as withScReset, withResolution, withRestraints, withRiding, withThorough, withTwinLaws, withWeighting, type SingleCrystalCompute, type SingleCrystalPageModel,
} from "@/app/singleCrystalPage";

/**
 * What a headless page keeps of itself in a History step, and how it goes
 * back to one: the app restores a step's workspace when the user (or the
 * Agent's go_to_step) returns to it, and a page registered here does the same.
 */
const PAGE_STATE = new WeakMap<AgentPort, { readonly capture: () => unknown; readonly restore: (captured: unknown) => void }>();

/**
 * A powder page without React: a session behind the page's own operations
 * (powderPage.ts) and the app's compute client, which runs in-thread here. So
 * a tool judges an actual fit, and the page computes what the app's does: the
 * same curves, agreement, setters, fits, Prefit and posterior, from the same
 * requests.
 */
export function sessionPort(start: Session, instrument: InstrumentParameters = DEFAULT_INSTRUMENT, opts: { readonly instrumentOnPage?: boolean; readonly client?: PowderCompute } = {}): { port: PowderAgentPort; calls: string[]; session: () => Session } {
  let s = start;
  // The page shows its instrument as the app does (a TOF pattern needs it for d); off by default, as the older tests expect.
  const shown = opts.instrumentOnPage ? instrument : undefined;
  let result: RefinementResult | null = null;
  let fitRange: FitWindow | null = null;
  const calls: string[] = [];
  // The app's compute client: without a Worker (here) it runs each request in-thread. A test may watch the requests.
  const client: PowderCompute = opts.client ?? new ComputeClient();
  /** The window as the app applies it: only when it narrows the pattern. */
  const activeWindow = (): FitWindow | null => {
    if (!fitRange) return null;
    const extent = extentOf(powderPageCurves(s).curves.x);
    return fitRange.min > extent.min || fitRange.max < extent.max ? { ...fitRange } : null;
  };
  const page = (): PowderPageModel => ({ session: s, instrument, fitRange: activeWindow(), result });
  const changed = (next: Session): void => {
    s = next;
    result = null;
  };
  const state = (): PowderLiveState => {
    const { curves } = powderPageCurves(s);
    const window = activeWindow();
    const zero = s.powderParams.find((p) => p.kind === "zeroShift")?.value;
    return {
      structure: s.structure,
      extraPhases: s.extraPhases,
      refinedPhases: refinedPhasesOf(s),
      pattern: s.pattern,
      parameters: s.powderParams,
      bindings: s.powderBindings,
      profile: s.powderProfile,
      magnetic: s.magnetic ?? null,
      result,
      instrument: shown ?? null,
      fitRange: window,
      extent: extentOf(curves.x),
      busy: false,
      viewOnly: s.pattern.xUnit === "tof" && s.powderProfile.shape !== "tof",
      wR: weightedR(s, curves, window),
      settings: {
        backgroundTerms: s.backgroundTerms,
        backgroundType: s.powderProfile.backgroundType ?? "chebyshev",
        mustrain: s.mustrain ?? "isotropic",
        anisotropicAdp: hasTensorAdp(s.structure),
        siteTies: s.siteTies,
        corrections: s.corrections ?? {},
      },
      curves,
      d: s.pattern.xUnit === "dSpacing" ? curves.x : convertAxisArray(curves.x, s.pattern.xUnit, "dSpacing", axisContext(s.pattern, shown, zero)),
      observationCount: observationsIn(curves, window),
      axis: axisContext(s.pattern, shown, zero),
      source: "test",
      restraints: restraintRequest(s).restraints ?? [],
    };
  };
  /** The posterior run to continue: its closure keeps the problem it sampled, as the page's. */
  let sampled: { result: SampleResult; rerun: (options: SampleOptions) => Promise<SampleResult> } | null = null;
  const port: PowderAgentPort = {
    technique: "powder",
    state,
    setFixed: (changes) => {
      calls.push(`setFixed ${changes.map((c) => `${c.id}=${c.fixed}`).join(",")}`);
      s = withFixed(s, changes);
    },
    setBackgroundTerms: (n) => {
      calls.push(`terms ${n}`);
      changed(withBackgroundTerms(s, n, instrument));
    },
    setBackgroundType: (t) => {
      calls.push(`type ${t}`);
      changed(withBackgroundType(s, t));
    },
    setMustrain: (m) => {
      calls.push(`mustrain ${m}`);
      changed(withMustrain(s, m, instrument));
    },
    setAnisotropicAdp: (on) => {
      calls.push(`adp ${on}`);
      changed(withAnisotropicAdp(s, on, instrument));
    },
    setSiteTies: (update) => {
      calls.push(`ties ${JSON.stringify(update)}`);
      changed(withSiteTies(s, update, instrument));
    },
    addAntisite: (a, b) => {
      calls.push(`antisite ${a} ${b}`);
      changed(withAntisitePair(s, a, b, instrument));
    },
    addPhase: (structure) => {
      calls.push(`add phase ${structure.name}`);
      changed(withPhase(s, structure, instrument));
    },
    setParameterTies: (update) => {
      calls.push(`ties ${JSON.stringify(update)}`);
      changed(withParameterTies(s, update));
    },
    setInstrumentConstants: (update) => {
      calls.push(`constants ${JSON.stringify(update)}`);
      changed(withInstrumentConstants(s, update));
    },
    setCorrections: (update) => {
      calls.push(`corrections ${JSON.stringify(update)}`);
      changed(withCorrections(s, update, instrument));
    },
    setFitRange: (r) => {
      calls.push(`range ${r ? `${r.min}-${r.max}` : "whole"}`);
      fitRange = r ? { min: r.min, max: r.max } : null;
    },
    showPeaks: (peaks) => calls.push(`showPeaks ${peaks.map((p) => p.d.toFixed(3)).join(",")}`),
    refine: async () => {
      calls.push("refine");
      const r = await powderFit(client, page(), { maxIterations: 20 });
      s = withFitResult(s, r);
      result = r;
      return null;
    },
    thorough: async () => {
      calls.push("thorough");
      const out = await thoroughFit(client, page());
      s = out.session;
      result = out.result;
      return null;
    },
    samplePosterior: async ({ continue: more, steps }) => {
      calls.push(`sample ${more ? "continue" : "start"} ${steps}`);
      if (more && !sampled) return "there is no posterior run to continue: sample first";
      const prior = more ? sampled : null;
      const rerun = prior ? prior.rerun : posteriorRun(client, page());
      const res = await rerun({ nSteps: steps, seed: 0xbae5, ...(prior ? { init: prior.result.resume } : {}) });
      sampled = { result: res, rerun };
      return res;
    },
    probe: async (options) => {
      calls.push("probe");
      return powderFit(client, page(), options);
    },
    // The page's report (Export ▾ → Report) from the same state.
    reportInput: () => {
      const st = state();
      return powderReportInput({
        session: s,
        refinedPhases: st.refinedPhases,
        params: s.powderParams,
        bindings: s.powderBindings,
        result,
        instrument,
        instrumentLoaded: true,
        wR: st.wR,
        rExp: result?.agreement.rExpected ?? null,
        gof: result?.agreement.goodnessOfFit ?? null,
        curves: { x: st.curves.x, yObs: st.curves.yObs, yCalc: st.curves.yCalc, diff: st.curves.yObs.map((o, i) => o - st.curves.yCalc[i]!) },
        xLabel: s.pattern.xUnit === "twoTheta" ? "2θ (°)" : s.pattern.xUnit,
        ticks: [],
        fitRange: st.fitRange,
        pointsInWindow: st.observationCount,
        tofViewOnly: false,
        explored: null,
      });
    },
    cancel: () => calls.push("cancel"),
    reset: (ids) => {
      calls.push(ids ? `reset ${ids.join(",")}` : "reset");
      changed(withReset(s, ids));
    },
    magnetic: () => magnetic,
    openStep: (step) => calls.push(`step ${step}`),
  };
  const magnetic = magneticHandle(() => s, (next) => {
    s = next;
    result = null;
  }, (step) => calls.push(`step ${step}`), shown);
  PAGE_STATE.set(port, {
    capture: () => ({ session: s, result, fitRange }),
    restore: (captured) => {
      const at = captured as { session: Session; result: RefinementResult | null; fitRange: FitWindow | null };
      s = at.session;
      result = at.result;
      fitRange = at.fitRange;
    },
  });
  return { port, calls, session: () => s };
}

/**
 * The port as the app hands it out: the page publishes a new port object at
 * every render, and its state() is that render's. A tool that changes the page
 * and then reads the port it was given sees the page as it was before; only a
 * port fetched again after the render sees the change.
 */
function renderSnapshot(port: AgentPort): AgentPort {
  const frozen = port.state();
  return { ...port, state: () => frozen } as AgentPort;
}

export function fakeHost(
  port: AgentPort | null,
  history: () => ProjectHistory | null = () => null,
  onRecord?: (kind: StepKind, agent: boolean) => void,
  goToStep: (id: string) => void = () => undefined,
): { host: AgentHost; steps: { kind: StepKind; agent: boolean }[]; records: Map<string, AgentRecord> } {
  const steps: { kind: StepKind; agent: boolean }[] = [];
  const records = new Map<string, AgentRecord>();
  let agent = false;
  const host: AgentHost = {
    port: () => (port ? renderSnapshot(port) : null),
    technique: () => port?.technique ?? null,
    settle: async () => undefined,
    asAgent: async (fn) => {
      agent = true;
      try {
        return await fn();
      } finally {
        agent = false;
      }
    },
    recordNow: (kind) => {
      steps.push({ kind, agent });
      onRecord?.(kind, agent);
    },
    history,
    goToStep,
    record: (key) => records.get(key) ?? emptyRecord(key),
    updateRecord: (key, update) => void records.set(key, update(records.get(key) ?? emptyRecord(key))),
  };
  return { host, steps, records };
}

/**
 * The History as the app keeps it, for a headless page: each step the
 * executor asks for is recorded from the page's state — the phases, the
 * parameters and the last result, and on the single-crystal page the
 * settings the report compares refinements by — and the first is the start,
 * as when data loads. The pages record a refinement's own step when it ends
 * ("Refine"); a headless port does not, so its caller records that one
 * (record("refine", "agent", "Refine")). A report written in a test or an
 * eval then lists the analysis' steps with their agreement, as the app's does.
 */
export function headlessHistory(port: AgentPort): { history: () => ProjectHistory | null; record: (kind: StepKind, actor?: StepActor, label?: string) => void; goTo: (id: string) => void } {
  const snapshot = (): Snapshot => {
    const s = port.state();
    const structures = "phases" in s ? s.phases : "dataset" in s ? [s.structure] : [s.structure, ...s.extraPhases];
    const refinement = { parameters: s.parameters, bindings: s.bindings, ...(s.result ? { lastResult: s.result } : {}) };
    const sc = "dataset" in s
      ? {
          extinctionModel: s.extinctionModel,
          resolution: { ...(s.resolution.dMin !== undefined ? { dMin: s.resolution.dMin } : {}), ...(s.resolution.dMax !== undefined ? { dMax: s.resolution.dMax } : {}) },
          omitted: s.omitted,
          outlierFilter: { on: s.outlierFilter.on, cutoffSigma: s.outlierFilter.cutoffSigma, ...(s.outlierFilter.minExtinction !== undefined ? { minExtinction: s.outlierFilter.minExtinction } : {}) },
          twinLaws: s.twinLaws,
          inverted: s.inverted !== undefined,
          ...(s.weighting ? { weighting: { a: s.weighting.a, b: s.weighting.b } } : {}),
        }
      : {};
    // A registered page keeps its own state with the step, to go back to it (PAGE_STATE).
    const page = PAGE_STATE.get(port);
    return { structures, workspace: { technique: port.technique, refinement, ...sc, ...(page ? { headlessPage: page.capture() } : {}) } as unknown as Workspace };
  };
  let h: ProjectHistory = recordStep(null, { ...snapshot(), kind: "load", label: "Start" });
  return {
    history: () => h,
    record: (kind, actor, label) => {
      h = recordStep(h, { ...snapshot(), kind, ...(label ? { label } : {}), ...(actor ? { actor } : {}) });
    },
    // The app's go-to-step: the step's state back on the page, and the History's current step moved to it.
    goTo: (id) => {
      const captured = (restoreStep(h, id).workspace as unknown as { headlessPage?: unknown }).headlessPage;
      if (captured !== undefined) PAGE_STATE.get(port)?.restore(captured);
      h = moveTo(h, id);
    },
  };
}

/**
 * An executor as a conversation has it once the pages' methods are read
 * (`readMethods: false` for one that has read nothing yet). The reads run
 * before the activity is recorded, so tests see only their own calls.
 */
export function executor(
  host: AgentHost,
  decision: boolean | "auto" = true,
  { readMethods = true, onReport }: { readMethods?: boolean; onReport?: (report: AgentReport) => void } = {},
): { ex: AgentExecutor; asked: ActivityEntry[]; seen: ActivityEntry[] } {
  const asked: ActivityEntry[] = [];
  const seen: ActivityEntry[] = [];
  let recording = false;
  const ex = new AgentExecutor(host, {
    approve: async (entry) => {
      asked.push(entry);
      return decision === "auto" ? true : decision;
    },
    onActivity: (e) => {
      if (recording) seen.push(e);
    },
    modelLabel: () => "Test model · headless",
    ...(onReport ? { onReport } : {}),
  });
  // A read_skill call runs synchronously up to its result, so the methods
  // count as read before this returns.
  if (readMethods) for (const name of Object.values(PAGE_METHOD)) void ex.run("read_skill", { name });
  recording = true;
  return { ex, asked, seen };
}

/** What a structure's sites refine: one U each, the tensor, or both. */
function adpModelOf(structure: StructureModel): "isotropic" | "anisotropic" | "mixed" {
  // Hydrogens kept isotropic under an anisotropic model (X-ray) do not make it mixed.
  const heavy = structure.sites.filter((site) => !isHydrogen(site));
  const kinds = new Set((heavy.length ? heavy : structure.sites).map((site) => site.adp.kind));
  return kinds.size === 1 ? [...kinds][0]! : "mixed";
}

/** The GaTa4Se8 PDF demo behind a PDF page's port, refined with the real engine. */
export function pdfPort(): { port: PdfAgentPort; calls: string[] } {
  const demo = gata4se8PdfExample();
  let model: StructureModel = demo.structure;
  let spec = buildPdfSpec(model, demo.pattern);
  let params = spec.params.map((p) => ({ ...p, value: demo.refinedParams[p.id] ?? p.value }));
  let result: RefinementResult | null = null;
  let lastRun: BoxcarRun | null = null;
  const defaultRange = { min: 1.5, max: 6 };
  let fitRange = { ...defaultRange };
  const rs = demo.pattern.points.map((p) => p.r);
  const calls: string[] = [];
  const state = (): PdfLiveState => {
    const curves = pdfCurves(model, demo.pattern, params, spec.bindings, fitRange);
    let num = 0;
    let den = 0;
    let n = 0;
    curves.x.forEach((r, i) => {
      if (r < fitRange.min || r > fitRange.max) return;
      n++;
      num += (curves.yObs[i]! - curves.yCalc[i]!) ** 2;
      den += curves.yObs[i]! ** 2;
    });
    const values: Record<string, number> = {};
    for (const p of params) values[p.id] = p.value;
    return {
      phases: [model],
      refinedPhases: [applyParameters(model, spec.bindings, values).model],
      pattern: demo.pattern,
      parameters: params,
      bindings: spec.bindings,
      result,
      fitRange,
      defaultRange,
      extent: { min: rs[0]!, max: rs.at(-1)! },
      busy: false,
      rw: Math.sqrt(num / den),
      curves,
      observationCount: n,
      positionMode: "atomic",
      adpModel: adpModelOf(model),
      spinModel: false,
      warnings: [],
      source: "test",
      restraints: spec.restraints,
    };
  };
  const refine = async (): Promise<string | null> => {
    calls.push("refine");
    const r = refineProblem(buildPdfProblem(model, demo.pattern, params, spec.bindings, spec.restraints, fitRange), { maxIterations: 4, analyticDerivatives: true });
    params = params.map((p) => ({ ...p, value: r.parameters[p.id] ?? p.value }));
    result = r;
    return null;
  };
  const port: PdfAgentPort = {
    technique: "pdf",
    state,
    setFixed: (changes) => {
      calls.push(`setFixed ${changes.map((c) => `${c.id}=${c.fixed}`).join(",")}`);
      const m = new Map(changes.map((c) => [c.id, c.fixed]));
      params = params.map((p) => (m.has(p.id) ? { ...p, fixed: m.get(p.id)! } : p));
    },
    // The ADPs box: the model rebuilt in the other ADP model, the other rows kept by id.
    setAdpModel: (anisotropic) => {
      calls.push(`adp ${anisotropic ? "anisotropic" : "isotropic"}`);
      model = withAdpModel(model, anisotropic ? "anisotropic" : "isotropic");
      const old = new Map(params.map((p) => [p.id, p]));
      spec = buildPdfSpec(model, demo.pattern);
      params = spec.params.map((p) => { const o = old.get(p.id); return o ? { ...p, value: o.value, fixed: o.fixed } : p; });
      result = null;
    },
    setFitRange: (r) => {
      calls.push(`range ${r ? `${r.min}-${r.max}` : "default"}`);
      fitRange = r ? { ...r } : { ...defaultRange };
    },
    refine,
    thorough: async () => {
      calls.push("thorough");
      return "cancelled";
    },
    probe: async (options) => refineProblem(buildPdfProblem(model, demo.pattern, params, spec.bindings, spec.restraints, fitRange), { ...options, analyticDerivatives: true }),
    // The Boxcar view's scan, one short refinement per box, the rows untouched.
    boxcar: async (plan) => {
      calls.push(`boxcar ${plan.width}/${plan.step}${plan.bonds?.length ? ` bonds ${plan.bonds.join(",")}` : ""}`);
      const windows = boxcarWindows({ range: fitRange, width: plan.width, step: plan.step });
      const own = plan.free ? new Set(plan.free) : null;
      let seed = own ? params.map((p) => (p.expression ? p : { ...p, fixed: !own.has(p.id) })) : params;
      const steps = windows.map((w) => {
        const result = refineProblem(buildPdfProblem(model, demo.pattern, seed, spec.bindings, spec.restraints, { min: w.min, max: w.max }), { maxIterations: 2, analyticDerivatives: true });
        seed = seed.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
        return { datasetId: String(w.center), result, parameters: seed, carried: true };
      });
      const freeIds = (own ? params.filter((p) => own.has(p.id)) : params).filter((p) => (own || !p.fixed) && !p.expression).map((p) => p.id);
      lastRun = { windows, width: plan.width, restarts: 0, freeIds, series: [{ direction: "up" as const, result: { steps, evolution: [] } }], ...(plan.bonds?.length ? { bondSites: [...plan.bonds] } : {}) };
      return lastRun;
    },
    reportInput: () => {
      const st = state();
      return pdfReportInput({
        phases: st.refinedPhases, params, bindings: spec.bindings, result, pattern: demo.pattern, rw: st.rw, fitRange,
        curves: { x: st.curves.x, yObs: st.curves.yObs, yCalc: st.curves.yCalc, diff: st.curves.yObs.map((o, i) => o - st.curves.yCalc[i]!) },
        positionMode: "atomic", spinModel: null, explored: null,
        boxcar: lastRun ? boxcarTable(lastRun, model, spec.bindings, params) : null,
      });
    },
    cancel: () => calls.push("cancel"),
    reset: () => calls.push("reset"),
  };
  return { port, calls };
}

/**
 * A single-crystal page without React: the page's model (singleCrystalPage.ts)
 * in a variable, behind the page's own operations and the app's compute
 * client, which runs in-thread here. So the Agent's tools change, fit and read
 * this page as they do the workbench, and go_to_step puts a History step's
 * page back.
 */
export function singleCrystalPort(start: StructureModel, loaded: SingleCrystalDataset, opts: { readonly client?: SingleCrystalCompute } = {}): { port: SingleCrystalAgentPort; calls: string[] } {
  let m = singleCrystalPage(start, loaded);
  const calls: string[] = [];
  const client: SingleCrystalCompute = opts.client ?? new ComputeClient();
  const port: SingleCrystalAgentPort = {
    technique: "singleCrystal",
    state: () => liveStateOf(m, { busy: false }),
    setFixed: (changes) => {
      calls.push(`setFixed ${changes.map((c) => `${c.id}=${c.fixed}`).join(",")}`);
      m = withScFixed(m, changes);
    },
    setAdpModel: (anisotropic) => {
      calls.push(`adp ${anisotropic ? "anisotropic" : "isotropic"}`);
      m = withScAdpModel(m, anisotropic);
    },
    setExtinctionModel: (model) => {
      calls.push(`extinction model ${model}`);
      m = withExtinctionModel(m, model);
    },
    setRadiation: (update) => {
      calls.push(`radiation ${JSON.stringify(update)}`);
      m = withRadiation(m, update);
    },
    setResolution: (update) => {
      calls.push(`resolution ${JSON.stringify(update)}`);
      m = withResolution(m, update);
    },
    setTwinLaws: (laws) => {
      calls.push(`twin ${laws.map((l) => JSON.stringify(l.matrix)).join(" ") || "none"}`);
      m = withTwinLaws(m, laws);
    },
    setParameterTies: (update) => {
      calls.push(`ties ${JSON.stringify(update)}`);
      m = withScParameterTies(m, update);
    },
    setMerged: (on) => {
      calls.push(`merged ${on}`);
      m = withMerged(m, on);
    },
    setDistanceRestraints: (next) => {
      calls.push(`restraints ${next.length}`);
      m = withRestraints(m, next);
    },
    invertStructure: () => {
      calls.push("invert");
      const { model, text } = withHand(m);
      m = model;
      return text;
    },
    setWeighting: (next) => {
      calls.push(`weighting ${next ? `${next.a} ${next.b}` : "1/σ²"}`);
      m = withWeighting(m, next);
    },
    setRiding: (on, options) => {
      calls.push(`riding ${on ? "on" : "off"}${options ? ` ${JSON.stringify(options)}` : ""}`);
      const { model, message } = withRiding(m, on, options);
      m = model;
      return message;
    },
    setOmitted: (next) => {
      calls.push(`omit ${next.map((o) => `${o.h} ${o.k} ${o.l}${o.batch !== undefined ? `/${o.batch}` : ""}`).join(", ")}`);
      m = withOmitted(m, next);
    },
    setOutlierFilter: (update) => {
      calls.push(`filter ${JSON.stringify(update)}`);
      m = withOutlierFilter(m, update);
    },
    refine: async () => {
      calls.push("refine");
      m = withFit(m, await singleCrystalFit(client, m));
      return null;
    },
    thorough: async () => {
      calls.push("thorough");
      m = withThorough(m, await singleCrystalThorough(client, m));
      return null;
    },
    probe: (options, cut) => singleCrystalProbe(client, m, options, cut),
    reportInput: () => reportInputOf(m),
    cancel: () => calls.push("cancel"),
    reset: (ids) => {
      calls.push(`reset${ids ? ` ${ids.join(",")}` : ""}`);
      m = withScReset(m, ids);
    },
  };
  PAGE_STATE.set(port, {
    capture: () => m,
    restore: (captured) => {
      m = captured as SingleCrystalPageModel;
    },
  });
  return { port, calls };
}
