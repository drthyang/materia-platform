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
import type { AgentPort, PdfAgentPort, PdfLiveState, PowderAgentPort, PowderLiveState, SingleCrystalAgentPort, SingleCrystalLiveState } from "@/agent/port";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { buildPdfProblem, buildPdfSpec, pdfCurves } from "@/core/workflow/pdf";
import { applyParameters } from "@/core/workflow/apply";
import { refine as refineProblem } from "@/core/refinement/engine";
import { boxcarTable, boxcarWindows, type BoxcarRun } from "@/core/workflow/pdfBoxcar";
import { DEFAULT_INSTRUMENT, buildSpecFor, keptBindings, keptRow, keptRows, withMagneticRows, withValidUserTies, type Session } from "@/app/powderSession";
import { withEqualTies } from "@/core/refinement/constraints";
import { withConstants, type InstrumentParameters } from "@/core/diffraction/instrument";
import { withAntisite } from "@/core/crystal/antisite";
import { isHydrogen, withAdpModel } from "@/core/crystal/adp";
import type { DistanceRestraint, RidingRule, StructureModel } from "@/core/crystal/types";
import { ridingRules } from "@/core/crystal/riding";
import { powderRestraints } from "@/app/powderSpec";
import { runPowderRefinement } from "@/workers/runPowder";
import { axisContext, convertAxisArray } from "@/visualization/axisUnits";
import { excludedPointMask } from "@/core/refinement/factors";
import type { RefinementOptions, RefinementResult } from "@/core/refinement/types";
import { buildMagneticPowderProblem } from "@/core/workflow/magneticPowder";
import { buildPowderProblem } from "@/core/workflow/powder";
import { samplePosterior, type SampleResult } from "@/core/refinement/bayes/sampler";
import { magneticHandle, sessionCurves } from "@/testSupport/magneticHeadless";
import type { ProjectHistory, StepKind } from "@/core/project/history";
import { pdfReportInput, powderReportInput, singleCrystalReportInput } from "@/app/reportInputs";
import type { ExtinctionModel, OmittedMeasurement, Radiation, ResolutionRange, ShelxWeighting, SingleCrystalDataset, TwinLaw } from "@/core/diffraction/types";
import { EXTINCTION_PARAMETER_LABELS } from "@/core/diffraction/singleCrystalFactors";
import { measurementMerge } from "@/core/diffraction/merge";
import { SINGLE_CRYSTAL_REFINE_OPTIONS, buildSingleCrystalRefinementProblem, buildSingleCrystalSpec, mergedDataset, refineSingleCrystal, inResolution, isOmitted, optimalScale, singleCrystalRefinementComparison, withinResolution, withoutOmitted } from "@/core/workflow/singleCrystalRefinement";

/**
 * A powder page without React: a session, the real curves and the real
 * engine behind the port, so the tools judge an actual fit.
 */
export function sessionPort(start: Session, instrument: InstrumentParameters = DEFAULT_INSTRUMENT): { port: PowderAgentPort; calls: string[]; session: () => Session } {
  let s = start;
  let result: RefinementResult | null = null;
  let fitRange: { min: number; max: number } | null = null;
  const calls: string[] = [];
  const state = (): PowderLiveState => {
    const curves = sessionCurves(s);
    const xs = curves.x;
    const excluded = excludedPointMask(curves.yObs);
    let num = 0;
    let den = 0;
    let n = 0;
    curves.yObs.forEach((o, i) => {
      if (excluded[i]) return;
      n++;
      const w = 1 / Math.max(o, 1);
      num += w * (o - curves.yCalc[i]!) ** 2;
      den += w * o * o;
    });
    return {
      structure: s.structure,
      extraPhases: s.extraPhases,
      // Each phase with the parameters applied, its bindings routed by phase (as the page does).
      refinedPhases: ((): PowderLiveState["refinedPhases"] => {
        const values: Record<string, number> = Object.fromEntries(s.powderParams.map((p) => [p.id, p.value]));
        const multi = s.extraPhases.length > 0;
        return [s.structure, ...s.extraPhases].map((ph) => applyParameters(ph, multi ? s.powderBindings.filter((b) => b.targetId === ph.id) : s.powderBindings, values).model);
      })(),
      pattern: s.pattern,
      parameters: s.powderParams,
      bindings: s.powderBindings,
      profile: s.powderProfile,
      magnetic: s.magnetic ?? null,
      result,
      instrument: null,
      fitRange,
      extent: { min: Math.min(...xs), max: Math.max(...xs) },
      busy: false,
      viewOnly: false,
      wR: Math.sqrt(num / den),
      settings: { backgroundTerms: s.backgroundTerms, backgroundType: "chebyshev", mustrain: "isotropic", anisotropicAdp: s.structure.sites.some((site) => site.adp.kind === "anisotropic"), siteTies: s.siteTies, corrections: s.corrections ?? {} },
      curves,
      d: convertAxisArray(curves.x, s.pattern.xUnit, "dSpacing", axisContext(s.pattern, undefined, s.powderParams.find((p) => p.kind === "zeroShift")?.value)),
      observationCount: n,
      axis: axisContext(s.pattern, undefined, s.powderParams.find((p) => p.kind === "zeroShift")?.value),
      source: "test",
      restraints: powderRestraints([s.structure], s.siteTies, s.powderParams),
      ...(s.extraPhases.length > 0 ? { extraPhases: s.extraPhases } : {}),
    };
  };
  /** The fit as the page runs it: nuclear + magnetic once a magnetic model is on the session. */
  const fitOnce = (options: Partial<RefinementOptions>): RefinementResult =>
    s.magnetic
      ? refineProblem(buildMagneticPowderProblem(s.structure, s.magnetic, s.pattern, s.powderParams, s.powderBindings, { shape: s.powderProfile.shape, ...(s.powderProfile.eta !== undefined ? { eta: s.powderProfile.eta } : {}) }), options)
      : runPowderRefinement({
        type: "refinePowder",
        requestId: 0,
        structure: s.structure,
        pattern: s.pattern,
        parameters: s.powderParams,
        bindings: s.powderBindings,
        shape: s.powderProfile.shape,
        restraints: powderRestraints([s.structure], s.siteTies, s.powderParams),
        ...(s.extraPhases.length > 0 ? { extraPhases: s.extraPhases } : {}),
        options,
      });
  let sampled: SampleResult | null = null;
  const refine = async (): Promise<string | null> => {
    calls.push("refine");
    if (s.magnetic) {
      const r = fitOnce({ maxIterations: 20 });
      s = { ...s, powderParams: s.powderParams.map((p) => ({ ...p, value: r.parameters[p.id] ?? p.value })) };
      result = r;
      return null;
    }
    const r = runPowderRefinement({
      type: "refinePowder",
      requestId: 0,
      structure: s.structure,
      pattern: s.pattern,
      parameters: s.powderParams,
      bindings: s.powderBindings,
      shape: s.powderProfile.shape,
      restraints: powderRestraints([s.structure], s.siteTies, s.powderParams),
      ...(s.extraPhases.length > 0 ? { extraPhases: s.extraPhases } : {}),
      options: { maxIterations: 20 },
    });
    s = { ...s, powderParams: s.powderParams.map((p) => ({ ...p, value: r.parameters[p.id] ?? p.value })) };
    result = r;
    return null;
  };
  const port: PowderAgentPort = {
    technique: "powder",
    state,
    setFixed: (changes) => {
      calls.push(`setFixed ${changes.map((c) => `${c.id}=${c.fixed}`).join(",")}`);
      const m = new Map(changes.map((c) => [c.id, c.fixed]));
      s = { ...s, powderParams: s.powderParams.map((p) => (m.has(p.id) ? { ...p, fixed: m.get(p.id)! } : p)) };
    },
    setBackgroundTerms: (n) => calls.push(`terms ${n}`),
    setBackgroundType: (t) => calls.push(`type ${t}`),
    setMustrain: (m) => calls.push(`mustrain ${m}`),
    setAnisotropicAdp: (on) => calls.push(`adp ${on}`),
    setSiteTies: (update) => {
      calls.push(`ties ${JSON.stringify(update)}`);
      s = { ...s, siteTies: { ...s.siteTies, ...update } };
    },
    addAntisite: (a, b) => {
      calls.push(`antisite ${a} ${b}`);
      const structure = withAntisite(s.structure, a, b);
      const siteTies = { ...s.siteTies, occupancyToUnity: true, composition: true };
      const spec = buildSpecFor(structure, s.extraPhases, s.pattern, instrument, true, s.backgroundTerms, siteTies, s.mustrain ?? "isotropic", s.corrections);
      s = { ...s, structure, siteTies, powderParams: keptRows(spec.params, s.powderParams), powderBindings: keptBindings(spec.bindings, s.powderBindings) };
    },
    addPhase: (structure) => {
      calls.push(`add phase ${structure.name}`);
      const extraPhases = [...s.extraPhases, structure];
      const spec = buildSpecFor(s.structure, extraPhases, s.pattern, instrument, true, s.backgroundTerms, s.siteTies, s.mustrain ?? "isotropic", s.corrections);
      s = { ...s, extraPhases, powderParams: keptRows(spec.params, s.powderParams), powderBindings: keptBindings(spec.bindings, s.powderBindings), powderProfile: spec.profile };
    },
    setParameterTies: (update) => {
      calls.push(`ties ${JSON.stringify(update)}`);
      s = { ...s, powderParams: withEqualTies(s.powderParams, update) };
    },
    setInstrumentConstants: (update) => {
      calls.push(`constants ${JSON.stringify(update)}`);
      if (s.pattern.radiation.kind === "xray") s = { ...s, pattern: { ...s.pattern, radiation: withConstants(s.pattern.radiation, update) } };
    },
    setCorrections: (update) => {
      calls.push(`corrections ${JSON.stringify(update)}`);
      const was = s.corrections ?? {};
      const po = update.preferredOrientation === undefined ? was.preferredOrientation : update.preferredOrientation ?? undefined;
      const peak = update.peak ?? was.peak ?? [];
      const corrections = { ...((update.asymmetry ?? was.asymmetry) ? { asymmetry: true } : {}), ...(po ? { preferredOrientation: po } : {}), ...(peak.length ? { peak } : {}) };
      const spec = buildSpecFor(s.structure, s.extraPhases, s.pattern, instrument, true, s.backgroundTerms, s.siteTies, "isotropic", corrections);
      const previous = new Map(s.powderParams.map((p) => [p.id, p]));
      s = {
        ...s,
        corrections,
        powderParams: withMagneticRows(spec.params.map((p) => {
          const old = previous.get(p.id);
          return old ? { ...p, value: old.value, initialValue: old.initialValue, fixed: old.fixed } : { ...p, fixed: true };
        }), s.powderParams),
        powderBindings: keptBindings(spec.bindings, s.powderBindings),
        powderProfile: spec.profile,
      };
      result = null;
    },
    setFitRange: (r) => {
      calls.push(`range ${r ? `${r.min}-${r.max}` : "whole"}`);
      fitRange = r ? { ...r } : null;
    },
    showPeaks: (peaks) => calls.push(`showPeaks ${peaks.map((p) => p.d.toFixed(3)).join(",")}`),
    refine,
    thorough: refine,
    samplePosterior: async ({ continue: more, steps }) => {
      calls.push(`sample ${more ? "continue" : "start"} ${steps}`);
      if (more && !sampled) return "there is no posterior run to continue: sample first";
      const problem = buildPowderProblem(s.structure, s.pattern, s.powderParams, s.powderBindings, s.powderProfile, powderRestraints([s.structure], s.siteTies, s.powderParams));
      sampled = samplePosterior(problem, {
        nSteps: steps,
        seed: 0xbae5,
        ...(more && sampled ? { init: sampled.resume } : {}),
        ...(result?.esd ? { linearizedEsd: result.esd } : {}),
      });
      return sampled;
    },
    probe: async (options) => {
      calls.push("probe");
      return fitOnce(options);
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
        fitRange,
        pointsInWindow: st.observationCount,
        tofViewOnly: false,
        explored: null,
      });
    },
    cancel: () => calls.push("cancel"),
    reset: (ids) => {
      calls.push(ids ? `reset ${ids.join(",")}` : "reset");
      const only = ids ? new Set(ids) : null;
      s = { ...s, powderParams: s.powderParams.map((p) => (only && !only.has(p.id) ? p : { ...p, value: p.initialValue })) };
      result = null;
    },
    magnetic: () => magnetic,
    openStep: (step) => calls.push(`step ${step}`),
  };
  const magnetic = magneticHandle(() => s, (next) => {
    s = next;
    result = null;
  }, (step) => calls.push(`step ${step}`));
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

export function fakeHost(port: AgentPort | null, history: () => ProjectHistory | null = () => null): { host: AgentHost; steps: { kind: StepKind; agent: boolean }[]; records: Map<string, AgentRecord> } {
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
    recordNow: (kind) => steps.push({ kind, agent }),
    history,
    goToStep: () => undefined,
    record: (key) => records.get(key) ?? emptyRecord(key),
    updateRecord: (key, update) => void records.set(key, update(records.get(key) ?? emptyRecord(key))),
  };
  return { host, steps, records };
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
 * A single-crystal page without React: a structure and its reflections behind
 * the port, refined with the real engine, the outlier filter and the ADP
 * switch as the page has them.
 */
export function singleCrystalPort(start: StructureModel, loaded: SingleCrystalDataset): { port: SingleCrystalAgentPort; calls: string[] } {
  let model = start;
  let base: SingleCrystalDataset = loaded;
  let extinctionModel: ExtinctionModel = loaded.extinctionModel ?? "shelx";
  let omitted: readonly OmittedMeasurement[] = [];
  let resolution: ResolutionRange = {};
  let riding: readonly RidingRule[] | null = start.riding?.length ? start.riding : null;
  let weighting: ShelxWeighting | null = loaded.weighting ?? null;
  let twinLaws: readonly TwinLaw[] = loaded.twinLaws ?? [];
  let restraints: readonly DistanceRestraint[] = start.restraints ?? [];
  let merged = false;
  // The reflections with the extinction model, as the page's probed dataset.
  let dataset: SingleCrystalDataset = { ...loaded, extinctionModel };
  let spec = buildSingleCrystalSpec(model, dataset, { extinction: 0 });
  let params = spec.params;
  let result: RefinementResult | null = null;
  let filter: { on: boolean; cutoffSigma: number; minExtinction?: number } = { on: false, cutoffSigma: 6 };
  const calls: string[] = [];
  const values = (): Record<string, number> => Object.fromEntries(params.map((p) => [p.id, p.value]));
  // The omitted measurements go first; the filter reads the residuals of the whole set against the current model, as the page's.
  const kept = (): SingleCrystalDataset => withinResolution(withoutOmitted(dataset, omitted), model.cell, resolution);
  const active = (): SingleCrystalDataset => {
    if (!filter.on) return kept();
    const full = singleCrystalRefinementComparison(model, dataset, params, spec.bindings);
    return { ...dataset, reflections: dataset.reflections.filter((r, i) => !isOmitted(r, omitted) && inResolution(r, model.cell, resolution) && Math.abs(full.rows[i]?.deltaOverSigma ?? 0) <= filter.cutoffSigma && (filter.minExtinction === undefined || (full.rows[i]?.extinction ?? 1) >= filter.minExtinction)) };
  };
  const state = (): SingleCrystalLiveState => {
    const ds = active();
    const nKept = kept().reflections.length;
    const outside = withoutOmitted(dataset, omitted).reflections.length - nKept;
    const cmp = singleCrystalRefinementComparison(model, ds, params, spec.bindings);
    const merge = measurementMerge((merged ? loaded : ds).reflections.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.iObs, sigma: r.sigma ?? 0 })), model.spaceGroup.operations);
    return {
      structure: model,
      refinedStructure: applyParameters(model, spec.bindings, values()).model,
      dataset,
      totalReflections: loaded.reflections.length,
      measurement: loaded.reflections,
      probe: dataset.radiation.kind,
      parameters: params,
      bindings: spec.bindings,
      result,
      busy: false,
      agreement: cmp.agreement,
      merge: merge.statistics,
      rows: cmp.rows,
      allRows: ds.reflections.length < dataset.reflections.length ? singleCrystalRefinementComparison(model, dataset, params, spec.bindings).rows : cmp.rows,
      outlierFilter: { ...filter, excluded: nKept - ds.reflections.length },
      omitted,
      resolution: { ...resolution, excluded: outside },
      riding: riding ?? [],
      weighting,
      twinLaws,
      distanceRestraints: restraints,
      extinctionModel,
      adpModel: adpModelOf(model),
      magnetic: false,
      observationCount: ds.reflections.length,
      source: dataset.name,
      restraints: [],
    };
  };
  const port: SingleCrystalAgentPort = {
    technique: "singleCrystal",
    state,
    setFixed: (changes) => {
      calls.push(`setFixed ${changes.map((c) => `${c.id}=${c.fixed}`).join(",")}`);
      const m = new Map(changes.map((c) => [c.id, c.fixed]));
      params = params.map((p) => (m.has(p.id) ? { ...p, fixed: m.get(p.id)! } : p));
    },
    // The page's switch: the tensors (or spheres) seeded from the refined ADPs, entering fixed.
    setAdpModel: (anisotropic) => {
      calls.push(`adp ${anisotropic ? "anisotropic" : "isotropic"}`);
      const refined = applyParameters(model, spec.bindings, values()).model;
      const seeds = new Map(refined.sites.map((site) => [site.label, site.adp]));
      const switched = withAdpModel({ ...start, sites: start.sites.map((site) => ({ ...site, adp: seeds.get(site.label) ?? site.adp })) }, anisotropic ? "anisotropic" : "isotropic", { hydrogensIsotropic: dataset.radiation.kind === "xray" });
      model = riding ? { ...switched, riding } : switched;
      const old = new Map(params.map((p) => [p.id, p]));
      spec = buildSingleCrystalSpec(model, dataset, { extinction: 0 });
      params = withValidUserTies(spec.params.map((p) => keptRow(p, p.kind === "bIso" || p.kind === "uAniso" ? undefined : old.get(p.id))));
      result = null;
    },
    setExtinctionModel: (m) => {
      calls.push(`extinction model ${m}`);
      extinctionModel = m;
      dataset = { ...base, extinctionModel, ...(weighting ? { weighting } : {}), ...(twinLaws.length ? { twinLaws } : {}) };
      params = params.map((p) => (p.kind === "extinction" ? { ...p, label: EXTINCTION_PARAMETER_LABELS[m], value: 0, initialValue: 0 } : p));
      result = null;
    },
    setRadiation: (update) => {
      calls.push(`radiation ${JSON.stringify(update)}`);
      const probe = update.probe ?? base.radiation.kind;
      const wl = update.wavelength ?? ("wavelength" in base.radiation ? base.radiation.wavelength : 1.54);
      const radiation: Radiation = probe === "neutron-tof" ? { kind: "neutron-tof" } : probe === "xray" ? { kind: "xray", wavelength: wl, polarization: 0.5 } : { kind: "neutron", wavelength: wl };
      base = { ...base, radiation };
      dataset = { ...base, extinctionModel, ...(weighting ? { weighting } : {}), ...(twinLaws.length ? { twinLaws } : {}) };
      const k = optimalScale(model, active(), params, spec.bindings);
      if (k !== null) params = params.map((p) => (p.kind === "scale" ? { ...p, value: k } : p));
      result = null;
    },
    setResolution: (update) => {
      calls.push(`resolution ${JSON.stringify(update)}`);
      const end = (v: number | null | undefined, was: number | undefined): number | undefined => (v === undefined ? was : v ?? undefined);
      const dMin = end(update.dMin, resolution.dMin);
      const dMax = end(update.dMax, resolution.dMax);
      resolution = { ...(dMin !== undefined ? { dMin } : {}), ...(dMax !== undefined ? { dMax } : {}) };
    },
    setTwinLaws: (laws) => {
      calls.push(`twin ${laws.map((l) => JSON.stringify(l.matrix)).join(" ") || "none"}`);
      twinLaws = laws;
      const { twinLaws: _, ...rest } = dataset;
      dataset = laws.length ? { ...rest, twinLaws: laws } : rest;
      const old = new Map(params.map((p) => [p.id, p]));
      spec = buildSingleCrystalSpec(model, dataset, { extinction: 0 });
      params = withValidUserTies(spec.params.map((p) => keptRow(p, p.kind === "twinFraction" ? undefined : old.get(p.id))));
      result = null;
    },
    setParameterTies: (update) => {
      calls.push(`ties ${JSON.stringify(update)}`);
      params = withValidUserTies(withEqualTies(params, update));
    },
    // The page's handler: the merged equivalents (or every measurement) with the batch rows rebuilt, the omissions and the last fit cleared.
    setMerged: (on) => {
      calls.push(`merged ${on}`);
      merged = on;
      const set = on ? mergedDataset(loaded, model.spaceGroup.operations) : loaded;
      base = { ...set, radiation: base.radiation };
      dataset = { ...base, extinctionModel, ...(weighting ? { weighting } : {}), ...(twinLaws.length ? { twinLaws } : {}) };
      const old = new Map(params.map((p) => [p.id, p]));
      spec = buildSingleCrystalSpec(model, dataset, { extinction: 0 });
      params = withValidUserTies(spec.params.map((p) => keptRow(p, old.get(p.id))));
      omitted = [];
      result = null;
    },
    setDistanceRestraints: (next) => {
      calls.push(`restraints ${next.length}`);
      restraints = next;
      model = next.length ? { ...model, restraints: next } : (({ restraints: _, ...rest }) => rest)(model);
      result = null;
    },
    setWeighting: (next) => {
      calls.push(`weighting ${next ? `${next.a} ${next.b}` : "1/σ²"}`);
      weighting = next && (next.a > 0 || next.b > 0) ? { a: next.a, b: next.b } : null;
      const { weighting: _, ...rest } = dataset;
      dataset = weighting ? { ...rest, weighting } : rest;
      result = null;
    },
    // The page's handler: rules from the structure as refined now; the hydrogens' rows leave the fit (or come back).
    setRiding: (on, options) => {
      calls.push(`riding ${on ? "on" : "off"}${options ? ` ${JSON.stringify(options)}` : ""}`);
      const rules = on ? ridingRules({ ...applyParameters(model, spec.bindings, values()).model, riding: [] }, options) : null;
      if (rules && rules.rules.length === 0) return "no hydrogen is bonded to an atom of this model";
      riding = rules ? rules.rules : null;
      model = riding ? { ...model, riding } : (({ riding: _, ...rest }) => rest)(model);
      const old = new Map(params.map((p) => [p.id, p]));
      spec = buildSingleCrystalSpec(model, dataset, { extinction: 0 });
      params = withValidUserTies(spec.params.map((p) => keptRow(p, old.get(p.id))));
      result = null;
      return rules && rules.unbonded.length ? `not riding (no parent in bonding distance): ${rules.unbonded.join(", ")}` : null;
    },
    setOmitted: (next) => {
      calls.push(`omit ${next.map((o) => `${o.h} ${o.k} ${o.l}${o.batch !== undefined ? `/${o.batch}` : ""}`).join(", ")}`);
      omitted = next;
    },
    setOutlierFilter: (update) => {
      calls.push(`filter ${JSON.stringify(update)}`);
      const minExtinction = update.minExtinction === null ? undefined : update.minExtinction ?? filter.minExtinction;
      filter = { on: update.on ?? filter.on, cutoffSigma: update.cutoffSigma ?? filter.cutoffSigma, ...(minExtinction !== undefined ? { minExtinction } : {}) };
    },
    refine: async () => {
      calls.push("refine");
      const r = refineSingleCrystal(model, active(), params, spec.bindings, SINGLE_CRYSTAL_REFINE_OPTIONS);
      params = params.map((p) => ({ ...p, value: r.parameters[p.id] ?? p.value }));
      result = r;
      return null;
    },
    thorough: async () => {
      calls.push("thorough");
      return "cancelled";
    },
    probe: async (options) => refineProblem(buildSingleCrystalRefinementProblem(model, active(), params, spec.bindings), { analyticDerivatives: true, ...options }),
    reportInput: () => {
      const st = state();
      return singleCrystalReportInput({
        structure: st.refinedStructure, base: model, params, bindings: spec.bindings, result, dataset: active(), totalReflections: loaded.reflections.length,
        excluded: st.outlierFilter.excluded, filterOn: filter.on, cutoffSigma: filter.cutoffSigma, minExtinction: filter.minExtinction ?? null, omitted, resolution: st.resolution, agreement: st.agreement, merge: st.merge,
        points: st.rows.map((r) => ({ obs: r.foSq, calc: r.fcSq })), magnetic: null, explored: null,
      });
    },
    cancel: () => calls.push("cancel"),
    reset: (ids) => {
      calls.push(`reset${ids ? ` ${ids.join(",")}` : ""}`);
      const only = ids ? new Set(ids) : null;
      params = params.map((p) => (only && !only.has(p.id) ? p : { ...p, value: p.initialValue }));
      result = null;
    },
  };
  return { port, calls };
}
