/**
 * The Agent tools on the single-crystal page: each reads the live state
 * through the page's port (port.ts) or calls the page's own handler, as on the
 * powder and PDF pages. A single-crystal fit is to integrated F²: its agreement
 * is SHELX's (R1 over Fo² > 2σ, wR2 and GooF over every reflection), the cell is
 * fixed input from indexing, and the data are judged before the model —
 * merging, resolution, completeness, the absences, the intensity statistics.
 */

import type { SingleCrystalAgentPort, SingleCrystalLiveState } from "@/agent/port";
import type { LiveToolSpec } from "@/agent/tools";
import type { ProjectHistory } from "@/core/project/history";
import { assess_refinement, bond_geometry } from "@/mcp/tools";
import { structureTable } from "@/agent/structureTable";
import { applyFree, bondsOf, cellOf, describeFree, freeNoOp, goToStep, historyView, matchIds, parameterSummary, pct, sig, type ChangeResult, type LiveToolHost } from "@/agent/liveCommon";
import type { RefinementResult } from "@/core/refinement/types";
import type { ReportCheck } from "@/core/export/report";
import { singleCrystalValidation, type ScValidation } from "@/core/diagnostics/singleCrystalValidation";
import { reflectionStatistics } from "@/core/diagnostics/reflectionStatistics";
import { nonPositiveDefiniteSites } from "@/core/crystal/adp";
import { CORRELATION_LISTED, bondValenceCheck, boundsCheck, convergenceCheck, correlationsCheck, findingChecks, noResultCheck, verdictCheck } from "@/agent/reportChecks";

/* eslint-disable @typescript-eslint/no-explicit-any -- inputs are validated against the spec's zod schema before a handler runs */
type Input = any;

/** Run a read tool. Returns the JSON result the model sees. */
export function readSingleCrystalTool(name: string, input: Input, port: SingleCrystalAgentPort, host: LiveToolHost): unknown {
  const s = port.state();
  switch (name) {
    case "get_state":
      return stateView(s, host.history(), input.parameters);
    case "reflection_statistics":
      return statisticsView(s);
    case "assess_refinement":
      return assessment(s);
    case "structure_table":
      return { phases: [structureTable(s.refinedStructure, 0, s.parameters, s.bindings, s.result?.esd ?? {})], ...(s.result ? {} : { note: "No refinement on screen: the values carry no esds." }) };
    case "bond_geometry":
      return bondsOf([s.refinedStructure], input, bond_geometry);
    default:
      throw new Error(`${name} is not a single-crystal read tool`);
  }
}

/** Make a change on the page. Returns a note for the model when the change needed adjusting or did not finish. */
export async function changeSingleCrystal(name: string, input: Input, port: SingleCrystalAgentPort, host: LiveToolHost): Promise<ChangeResult> {
  const s = port.state();
  switch (name) {
    case "set_free":
      return applyFree(s.parameters, input, port.setFixed);
    case "set_adp_model":
      port.setAdpModel(!!input.anisotropic);
      return undefined;
    case "set_outlier_filter":
      port.setOutlierFilter({ ...(input.on !== undefined ? { on: !!input.on } : {}), ...(input.cutoffSigma !== undefined ? { cutoffSigma: input.cutoffSigma } : {}) });
      return undefined;
    case "refine": {
      if (!s.parameters.some((p) => !p.fixed && !p.expression)) throw new Error("no parameter is free — free some with set_free first");
      const why = await (input.mode === "thorough" ? port.thorough() : port.refine());
      return why ? `The refinement did not finish (${why}); the parameters keep their values from before it.` : undefined;
    }
    case "reset_parameters":
      port.reset(input.parameters ? matchIds(s.parameters, input.parameters as string[]) : undefined);
      return undefined;
    case "go_to_step":
      goToStep(host, input.step);
      return undefined;
    default:
      throw new Error(`${name} is not a single-crystal change tool`);
  }
}

/** Why a change would do nothing, or null when it would do something. */
export function singleCrystalNoOp(spec: LiveToolSpec, input: Input, s: SingleCrystalLiveState): string | null {
  switch (spec.name) {
    case "set_free":
      return freeNoOp(s.parameters, input);
    case "set_adp_model":
      return s.adpModel === (input.anisotropic ? "anisotropic" : "isotropic") ? `the ADPs are already ${s.adpModel}` : null;
    case "set_outlier_filter": {
      const on = input.on ?? s.outlierFilter.on;
      const cutoff = input.cutoffSigma ?? s.outlierFilter.cutoffSigma;
      return on === s.outlierFilter.on && cutoff === s.outlierFilter.cutoffSigma ? `the filter is already ${on ? `on at ${cutoff}σ` : "off"}` : null;
    }
    default:
      return null;
  }
}

/** One line for the approval card: what this change will do, in the page's terms. */
export function describeSingleCrystalChange(spec: LiveToolSpec, input: Input, s: SingleCrystalLiveState): string {
  switch (spec.name) {
    case "set_free":
      return describeFree(s.parameters, input);
    case "set_adp_model":
      return `ADPs ${s.adpModel} → ${input.anisotropic ? "anisotropic (U tensor per site, seeded from the refined B)" : "isotropic (one B per site)"}`;
    case "set_outlier_filter": {
      const on = input.on ?? s.outlierFilter.on;
      const cutoff = input.cutoffSigma ?? s.outlierFilter.cutoffSigma;
      if (!on) return "Outlier filter off: every reflection fitted";
      const left = s.rows.filter((r) => Math.abs(r.deltaOverSigma) > cutoff).length;
      return `Outlier filter on at ${cutoff}σ: leaves out ${left} reflection${left === 1 ? "" : "s"} against the current model`;
    }
    case "refine": {
      const free = s.parameters.filter((p) => !p.fixed && !p.expression).length;
      return input.mode === "thorough"
        ? `${s.result ? "Escape minimum" : "Prefit"} (multi-start) on ${free} free parameter${free === 1 ? "" : "s"}`
        : `Refine F², ${free} free parameter${free === 1 ? "" : "s"} against ${s.observationCount} reflections`;
    }
    case "reset_parameters":
      return input.parameters ? `Reset ${matchIds(s.parameters, input.parameters as string[]).join(", ")} to the starting value` : "Reset every parameter to its starting value";
    case "go_to_step":
      return `Go to step ${String(input.step)}`;
    default:
      return spec.title;
  }
}

// ── views ───────────────────────────────────────────────────────────────────

function validationOf(s: SingleCrystalLiveState): ScValidation {
  return singleCrystalValidation({
    rows: s.rows.map((r) => ({ h: r.h, k: r.k, l: r.l, foSq: r.foSq, fcSq: r.fcSq, ...(r.sigma > 0 ? { sigma: r.sigma } : {}) })),
    cell: s.structure.cell,
    spaceGroup: s.structure.spaceGroup,
    nParams: s.parameters.filter((p) => !p.fixed && !p.expression).length,
  });
}

function stateView(s: SingleCrystalLiveState, history: ProjectHistory | null, select: readonly string[] | undefined): Record<string, unknown> {
  const ph = s.refinedStructure;
  const r = s.dataset.radiation;
  const ag = s.agreement;
  return {
    technique: "singleCrystal",
    source: s.source,
    busy: s.busy,
    phase: {
      name: ph.name || ph.id,
      spaceGroup: ph.spaceGroup.hermannMauguin ?? ph.spaceGroup.number,
      cell: cellOf(ph),
      sites: ph.sites.map((site) => `${site.label} ${site.element}`),
      adpModel: s.adpModel,
      note: "The cell is fixed input from indexing: intensities carry no peak positions.",
    },
    data: {
      probe: s.probe === "xray" ? "X-ray" : s.probe === "neutron" ? "neutron, constant wavelength" : "neutron, time of flight (Laue)",
      ...(r.kind !== "neutron-tof" ? { wavelength: r.wavelength } : {}),
      reflectionsInFile: s.totalReflections,
      fitted: s.observationCount,
      merging: { unique: s.merge.unique, redundancy: sig(s.merge.redundancy, 3), rInt: pct(s.merge.rInt), rSigma: pct(s.merge.rSigma), ...(s.merge.dMin !== undefined ? { dMin: sig(s.merge.dMin, 4) } : {}) },
      outlierFilter: s.outlierFilter.on ? `on at ${s.outlierFilter.cutoffSigma}σ: ${s.outlierFilter.excluded} reflections left out` : "off",
    },
    agreement: { R1: pct(ag.r1), wR2: pct(ag.wr2), GooF: sig(ag.goof, 4), observed: ag.observed, total: ag.total, note: "R1 over Fo² > 2σ; wR2 and GooF over every reflection fitted, w = 1/σ²." },
    magneticModel: s.magnetic,
    lastRefinement: s.result ? { status: s.result.status, iterations: s.result.history.length, ...(s.result.diagnostics ? { maxShiftOverEsd: sig(s.result.diagnostics.maxShiftOverEsd, 3) } : {}) } : null,
    ...parameterSummary(s.parameters, s.result?.esd, select),
    history: historyView(history),
  };
}

/** reflection_statistics: the data before the model. */
function statisticsView(s: SingleCrystalLiveState): Record<string, unknown> {
  const v = validationOf(s);
  const st = reflectionStatistics(s.rows.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.foSq, sigma: r.sigma })), s.structure.cell, s.structure.spaceGroup);
  const f = st.friedel;
  const hkl = (x: { h: number; k: number; l: number }): string => `${x.h} ${x.k} ${x.l}`;
  return {
    reflections: { measured: s.observationCount, unique: s.merge.unique, redundancy: sig(s.merge.redundancy, 3), rInt: pct(s.merge.rInt), rSigma: pct(s.merge.rSigma) },
    resolution: { dMin: sig(v.dMin, 4), sinThetaOverLambdaMax: sig(v.sinThetaOverLambdaMax, 4), ...(v.completeness !== undefined ? { completeness: pct(v.completeness) } : {}), uniqueObserved: v.uniqueObserved, ...(v.uniqueExpected !== undefined ? { uniqueExpected: v.uniqueExpected } : {}) },
    shells: v.shells.map((sh) => ({
      d: `${sig(sh.dMax, 3)}–${sig(sh.dMin, 3)} Å`,
      n: sh.n,
      unique: sh.unique,
      ...(sh.completeness !== undefined ? { completeness: pct(sh.completeness) } : {}),
      iOverSigma: sig(sh.iOverSigma, 3),
      ...(sh.rInt !== undefined ? { rInt: pct(sh.rInt) } : {}),
    })),
    friedel: f.centrosymmetric
      ? "centrosymmetric group: Friedel mates are equivalent; no absolute structure to determine"
      : `${f.withMate} of ${f.unique} reflections unique under the point group have their Friedel mate measured (${pct(f.fraction)} %)${f.fraction < 0.2 ? ": the Friedel pairs were merged (or never measured) — the absolute structure cannot be determined from these data" : ""}`,
    absences: st.absences.measured === 0
      ? "no reflection the space group forbids was measured (or the file left them out)"
      : { measured: st.absences.measured, atThreeSigma: st.absences.violated.length, strongest: st.absences.violated.slice(0, 8).map((a) => `${hkl(a)} (d ${sig(a.d, 4)} Å, ${sig(a.iOverSigma, 3)}σ)`) },
    intensityStatistics: Number.isFinite(st.intensities.meanAbsE2Minus1)
      ? { meanAbsE2Minus1: sig(st.intensities.meanAbsE2Minus1, 3), fractionWeak: sig(st.intensities.fractionWeak, 3), reading: st.intensities.reading, expected: "0.968 centrosymmetric, 0.736 non-centrosymmetric; E² < 0.1 for 24.8 % or 9.5 % of reflections", group: v.centrosymmetric ? "the space group is centrosymmetric" : "the space group is non-centrosymmetric" }
      : "too few reflections",
    reflectionsPerParameter: sig(v.reflectionsPerParameter, 3),
  };
}

function assessment(s: SingleCrystalLiveState): Record<string, unknown> {
  if (!s.result) throw new Error("there is no refinement result on screen — refine first (a model change clears the last result)");
  const a = assess_refinement({ result: s.result, parameters: [...s.parameters], observationCount: s.observationCount, mode: "single-crystal", restraints: s.restraints });
  const v = validationOf(s);
  const npd = nonPositiveDefiniteSites(s.refinedStructure);
  return {
    ...a,
    agreement: { R1: pct(s.agreement.r1), wR2: pct(s.agreement.wr2), GooF: sig(s.agreement.goof, 4) },
    analysisOfVariance: {
      byIntensity: v.bins.map((b) => ({ fcOverFcMax: `≤ ${sig(b.fcRatioMax, 3)}`, n: b.n, K: sig(b.k, 3), GooF: sig(b.goof, 3) })),
      byResolution: v.shells.map((sh) => ({ d: `${sig(sh.dMax, 3)}–${sig(sh.dMin, 3)} Å`, n: sh.n, K: sig(sh.k, 3), GooF: sig(sh.goof, 3), R1: pct(sh.r1) })),
      reading: "K = ΣFo²/ΣFc² should stay near 1 and GooF level across both: K < 1 on the strongest reflections is extinction; K rising on the weakest is twinning or a wrong model; GooF growing with intensity is the weighting.",
    },
    extinction: v.extinction.suspected
      ? `suspected: the strongest bin has K = ${sig(v.extinction.strongBinK, 3)} and GooF ${sig(v.extinction.strongBinGoof, 3)}; ${v.extinction.strongUnder} of ${v.extinction.outliers} outliers are strong with Fo² < Fc²`
      : `not indicated (strongest bin K = ${sig(v.extinction.strongBinK, 3)})`,
    outliers: v.outliers.slice(0, 8).map((o) => `${o.h} ${o.k} ${o.l}: Fo² ${sig(o.foSq, 4)}, Fc² ${sig(o.fcSq, 4)}, ${sig(o.z, 3)}σ (d ${sig(o.d, 3)} Å)`),
    ...(npd.length ? { nonPositiveDefinite: npd } : {}),
    reflectionsPerParameter: sig(v.reflectionsPerParameter, 3),
  };
}

/** The report's checks: the engine's view of the fit on screen. */
export function singleCrystalReportChecks(s: SingleCrystalLiveState, probe: RefinementResult | null = null): ReportCheck[] {
  if (!s.result || s.structure.sites.length === 0) return [noResultCheck()];
  const a = assess_refinement({ result: s.result, parameters: [...s.parameters], observationCount: s.observationCount, mode: "single-crystal", restraints: s.restraints });
  const v = validationOf(s);
  const checks: ReportCheck[] = [
    convergenceCheck(s.result),
    verdictCheck(a),
    probe ? correlationsCheck(probe, s.parameters, s.restraints) : correlationsCheck(s.result, s.parameters, s.restraints, CORRELATION_LISTED),
    boundsCheck(s.result, s.parameters),
    {
      name: "Data",
      status: s.merge.rInt > 0.1 || (v.completeness !== undefined && v.completeness < 0.95) ? "note" : "pass",
      detail: `${s.observationCount} reflections, ${s.merge.unique} unique (R_int ${pct(s.merge.rInt)} %, R_σ ${pct(s.merge.rSigma)} %), d_min ${sig(v.dMin, 4)} Å${v.completeness !== undefined ? `, completeness ${pct(v.completeness)} %` : ""}; ${sig(v.reflectionsPerParameter, 3)} unique reflections per free parameter.`,
    },
    {
      name: "Extinction",
      status: v.extinction.suspected ? "warn" : "pass",
      detail: v.extinction.suspected
        ? `Strong reflections are weaker than calculated: the strongest bin has K = ${sig(v.extinction.strongBinK, 3)}, GooF ${sig(v.extinction.strongBinGoof, 3)}.`
        : `The strongest reflections agree (K = ${sig(v.extinction.strongBinK, 3)} in the strongest bin).`,
    },
  ];
  const npd = nonPositiveDefiniteSites(s.refinedStructure);
  if (npd.length) checks.push({ name: "ADPs", status: "warn", detail: `Not positive definite: ${npd.join(", ")} — the ellipsoid is unphysical; refine those sites isotropically, or look for disorder.` });
  const bv = bondValenceCheck([s.refinedStructure]);
  if (bv) checks.push(bv);
  checks.push(...findingChecks(a));
  return checks;
}
