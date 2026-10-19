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
import type { AgentPort, PdfAgentPort, PowderAgentPort, PowderLiveState, SingleCrystalAgentPort } from "@/agent/port";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { DEFAULT_INSTRUMENT, type Session } from "@/app/powderSession";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { StructureModel } from "@/core/crystal/types";
import { convertAxisArray } from "@/visualization/axisUnits";
import type { SampleOptions, SampleResult } from "@/core/refinement/bayes/sampler";
import { magneticHandle } from "@/testSupport/magneticHeadless";
import { ComputeClient } from "@/workers/computeClient";
import {
  extentOf, hasTensorAdp, observationsIn, pageAxis, posteriorRun, powderFit, powderPageCurves, refinedPhasesOf, restraintRequest, thoroughFit, weightedR,
  withAnisotropicAdp, withAntisitePair, withBackgroundTerms, withBackgroundType, withCorrections, withFit as withPowderFit, withFixed, withInstrumentConstants,
  withMustrain, withParameterTies, withPhase, withReset, withSiteTies, changed, specInstrumentOf, type FitWindow, type PowderCompute, type PowderPage, type PowderPageModel,
} from "@/app/powderPage";
import { moveTo, recordStep, restoreStep, type ProjectHistory, type Snapshot, type StepActor, type StepKind } from "@/core/project/history";
import type { Workspace } from "@/core/project/types";
import { powderReportInput } from "@/app/reportInputs";
import {
  agentBoxcarPlan, liveStateOf as liveStateOfPdf, pdfBoxcar, pdfFit, pdfPage, pdfPosterior, pdfProbe, pdfThorough, reportInputOf as reportInputOfPdf, withAdpModel as withPdfAdpModel,
  withBoxcarPlan, withBoxcarRun, withFit as withPdfFit, withFitRange, withFixed as withPdfFixed, withPosterior, withReset as withPdfReset, type PdfCompute, type PdfPageModel,
} from "@/app/pdfPage";
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
  // The page as the shell holds it (powderPage.ts): the session, the instrument, the last fit's result.
  let held: PowderPage = { session: start, instrument, instrumentLoaded: true, result: null };
  // The page shows its instrument as the app does (a TOF pattern needs it for d); off by default, as the older tests expect.
  const shown = opts.instrumentOnPage ? instrument : undefined;
  let fitRange: FitWindow | null = null;
  const calls: string[] = [];
  // The app's compute client: without a Worker (here) it runs each request in-thread. A test may watch the requests.
  const client: PowderCompute = opts.client ?? new ComputeClient();
  /** The window as the app applies it: only when it narrows the pattern. */
  const activeWindow = (): FitWindow | null => {
    if (!fitRange) return null;
    const extent = extentOf(powderPageCurves(held.session).curves.x);
    return fitRange.min > extent.min || fitRange.max < extent.max ? { ...fitRange } : null;
  };
  const page = (): PowderPageModel => ({ session: held.session, instrument: specInstrumentOf(held), fitRange: activeWindow(), result: held.result });
  /** A change of the model or a setting, the rows built with the page's instrument: the result goes (changed). */
  const change = (next: (s: Session, instrument: InstrumentParameters) => Session): void => {
    held = changed(held, next(held.session, specInstrumentOf(held)));
  };
  const state = (): PowderLiveState => {
    const { session: s, result } = held;
    const { curves } = powderPageCurves(s);
    const window = activeWindow();
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
      d: s.pattern.xUnit === "dSpacing" ? curves.x : convertAxisArray(curves.x, s.pattern.xUnit, "dSpacing", pageAxis(s, shown)),
      observationCount: observationsIn(curves, window),
      axis: pageAxis(s, shown),
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
      held = { ...held, session: withFixed(held.session, changes) };
    },
    setBackgroundTerms: (n) => {
      calls.push(`terms ${n}`);
      change((s, inst) => withBackgroundTerms(s, n, inst));
    },
    setBackgroundType: (t) => {
      calls.push(`type ${t}`);
      change((s) => withBackgroundType(s, t));
    },
    setMustrain: (m) => {
      calls.push(`mustrain ${m}`);
      change((s, inst) => withMustrain(s, m, inst));
    },
    setAnisotropicAdp: (on) => {
      calls.push(`adp ${on}`);
      change((s, inst) => withAnisotropicAdp(s, on, inst));
    },
    setSiteTies: (update) => {
      calls.push(`ties ${JSON.stringify(update)}`);
      change((s, inst) => withSiteTies(s, update, inst));
    },
    addAntisite: (a, b) => {
      calls.push(`antisite ${a} ${b}`);
      change((s, inst) => withAntisitePair(s, a, b, inst));
    },
    addPhase: (structure) => {
      calls.push(`add phase ${structure.name}`);
      change((s, inst) => withPhase(s, structure, inst));
    },
    setParameterTies: (update) => {
      calls.push(`ties ${JSON.stringify(update)}`);
      change((s) => withParameterTies(s, update));
    },
    setInstrumentConstants: (update) => {
      calls.push(`constants ${JSON.stringify(update)}`);
      held = withInstrumentConstants(held, update);
    },
    setCorrections: (update) => {
      calls.push(`corrections ${JSON.stringify(update)}`);
      change((s, inst) => withCorrections(s, update, inst));
    },
    setFitRange: (r) => {
      calls.push(`range ${r ? `${r.min}-${r.max}` : "whole"}`);
      fitRange = r ? { min: r.min, max: r.max } : null;
    },
    showPeaks: (peaks) => calls.push(`showPeaks ${peaks.map((p) => p.d.toFixed(3)).join(",")}`),
    refine: async () => {
      calls.push("refine");
      const r = await powderFit(client, page(), { maxIterations: 20 });
      held = withPowderFit(held, r);
      return null;
    },
    thorough: async () => {
      calls.push("thorough");
      const out = await thoroughFit(client, page());
      held = { ...held, session: out.session, result: out.result };
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
      const { session: s, result } = held;
      return powderReportInput({
        session: s,
        refinedPhases: st.refinedPhases,
        params: s.powderParams,
        bindings: s.powderBindings,
        result,
        instrument: held.instrument,
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
      change((s) => withReset(s, ids));
    },
    magnetic: () => magnetic,
    openStep: (step) => calls.push(`step ${step}`),
  };
  const magnetic = magneticHandle(() => ({ session: held.session, window: activeWindow() }), (next) => {
    held = changed(held, next);
  }, (step) => calls.push(`step ${step}`), { ...(shown ? { instrument: shown } : {}), client });
  PAGE_STATE.set(port, {
    capture: () => ({ held, fitRange }),
    restore: (captured) => {
      const at = captured as { held: PowderPage; fitRange: FitWindow | null };
      held = at.held;
      fitRange = at.fitRange;
    },
  });
  return { port, calls, session: () => held.session };
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

/**
 * The GaTa4Se8 PDF demo as the app opens it (its converged values as the
 * starting values), behind the PDF page's own operations (pdfPage.ts) and the
 * app's compute client, in-thread: the app's fits, Prefit, boxcar scan and
 * posterior. It opens on a 1.5–6 Å window, passed as the app passes the
 * demo's own (1.5–28 Å, where one fit takes seconds), so an eval stays short.
 */
export function pdfPort(opts: { readonly client?: PdfCompute; readonly page?: PdfPageModel } = {}): { port: PdfAgentPort; calls: string[] } {
  const demo = gata4se8PdfExample();
  let m = opts.page ?? pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams, fitRange: { min: 1.5, max: 6 } } });
  const calls: string[] = [];
  const client: PdfCompute = opts.client ?? new ComputeClient();
  const port: PdfAgentPort = {
    technique: "pdf",
    state: () => liveStateOfPdf(m, { busy: false }),
    setFixed: (changes) => {
      calls.push(`setFixed ${changes.map((c) => `${c.id}=${c.fixed}`).join(",")}`);
      m = withPdfFixed(m, changes);
    },
    setAdpModel: (anisotropic) => {
      calls.push(`adp ${anisotropic ? "anisotropic" : "isotropic"}`);
      m = withPdfAdpModel(m, anisotropic);
    },
    setFitRange: (r) => {
      calls.push(`range ${r ? `${r.min}-${r.max}` : "default"}`);
      m = withFitRange(m, r);
    },
    refine: async () => {
      calls.push("refine");
      m = withPdfFit(m, await pdfFit(client, m));
      return null;
    },
    thorough: async () => {
      calls.push("thorough");
      m = withPdfFit(m, await pdfThorough(client, m));
      return null;
    },
    probe: (options) => pdfProbe(client, m, options),
    // The Boxcar view's scan: the Agent's plan becomes the panel's, the rows untouched.
    boxcar: async (asked) => {
      calls.push(`boxcar ${asked.width}/${asked.step}${asked.bonds?.length ? ` bonds ${asked.bonds.join(",")}` : ""}${asked.restarts ? ` restarts ${asked.restarts}` : ""}`);
      const plan = agentBoxcarPlan(m.boxcarPlan, asked);
      m = withBoxcarPlan(m, { width: plan.width, step: plan.step, direction: plan.direction, randomStart: plan.randomStart, restarts: plan.restarts });
      const out = await pdfBoxcar(client, m, plan);
      m = withBoxcarRun(m, out.run, out.key);
      return out.stopped ? null : out.run;
    },
    samplePosterior: async ({ continue: more, steps }) => {
      calls.push(`sample ${more ? "continue" : "start"} ${steps}`);
      if (more && !m.sample) return "there is no posterior run to continue: sample first";
      const out = await pdfPosterior(client, m, more, steps);
      m = withPosterior(m, out.sample, out.key);
      return out.sample.result;
    },
    reportInput: () => reportInputOfPdf(m),
    cancel: () => calls.push("cancel"),
    reset: (ids) => {
      calls.push(ids ? `reset ${ids.join(",")}` : "reset");
      m = withPdfReset(m, ids);
    },
  };
  PAGE_STATE.set(port, {
    capture: () => m,
    restore: (captured) => {
      m = captured as PdfPageModel;
    },
  });
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
