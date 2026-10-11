/**
 * The Agent tools on the single-crystal page: each reads the live state
 * through the page's port (port.ts) or calls the page's own handler, as on the
 * powder and PDF pages. A single-crystal fit is to integrated F²: its agreement
 * is SHELX's (R1 over Fo² > 2σ, wR2 and GooF over every reflection), the cell is
 * fixed input from indexing, and the data are judged before the model —
 * merging, resolution, completeness, the absences, the intensity statistics.
 */

import type { SingleCrystalAgentPort, SingleCrystalLiveState, SingleCrystalRow } from "@/agent/port";
import type { LiveToolSpec } from "@/agent/tools";
import type { ProjectHistory } from "@/core/project/history";
import { assess_refinement, bond_geometry } from "@/mcp/tools";
import { structureTable } from "@/agent/structureTable";
import { applyFree, bondEsds, bondsOf, uniqueBonds, cellOf, describeFree, freeNoOp, goToStep, historyView, matchIds, parameterSummary, pct, sig, type ChangeResult, type LiveToolHost } from "@/agent/liveCommon";
import type { RefinementResult } from "@/core/refinement/types";
import type { ReportCheck } from "@/core/export/report";
import { singleCrystalValidation, type ScValidation } from "@/core/diagnostics/singleCrystalValidation";
import { reflectionStatistics } from "@/core/diagnostics/reflectionStatistics";
import { canonicalKey, laueRotations } from "@/core/diffraction/merge";
import { nonPositiveDefiniteSites } from "@/core/crystal/adp";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { dSpacing } from "@/core/crystal/unitCell";
import { EXTINCTION_MODEL_LABELS } from "@/core/diffraction/singleCrystalFactors";
import { inResolution, isOmitted } from "@/core/workflow/singleCrystalRefinement";
import type { ExtinctionModel, OmittedMeasurement, ResolutionRange } from "@/core/diffraction/types";
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
    case "reflection_equivalents":
      return equivalentsView(s, input.h, input.k, input.l);
    case "assess_refinement":
      return assessment(s);
    case "structure_table":
      return { phases: [structureTable(s.refinedStructure, 0, s.parameters, s.bindings, s.result?.esd ?? {})], ...(s.result ? {} : { note: "No refinement on screen: the values carry no esds." }) };
    case "bond_geometry":
      // With the refined positions' esds, each length's esd (the cell is fixed input here).
      return bondsOf([s.refinedStructure], input, bond_geometry, s.result
        ? () => bondEsds(s.structure, s.bindings, s.parameters, s.result!.esd, (st) => uniqueBonds(st, input, bond_geometry).bonds)
        : undefined);
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
      port.setOutlierFilter({
        ...(input.on !== undefined ? { on: !!input.on } : {}),
        ...(input.cutoffSigma !== undefined ? { cutoffSigma: input.cutoffSigma } : {}),
        ...(input.minExtinction !== undefined ? { minExtinction: input.minExtinction } : {}),
      });
      return undefined;
    case "omit_reflections":
      port.setOmitted(omitPlan(s, input).next);
      return undefined;
    case "set_resolution_range":
      port.setResolution({ ...(input.dMin !== undefined ? { dMin: input.dMin } : {}), ...(input.dMax !== undefined ? { dMax: input.dMax } : {}) });
      return undefined;
    case "set_extinction_model":
      port.setExtinctionModel(input.model as ExtinctionModel);
      return "The extinction parameter restarted at 0 under the new model: refine it with the scale (and what was free before) to convergence before comparing the fit.";
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
      const minY = input.minExtinction === undefined ? s.outlierFilter.minExtinction : input.minExtinction ?? undefined;
      return on === s.outlierFilter.on && cutoff === s.outlierFilter.cutoffSigma && minY === s.outlierFilter.minExtinction
        ? `the filter is already ${on ? `on at ${cutoff}σ${minY !== undefined ? `, y ≥ ${minY}` : ""}` : "off"}`
        : null;
    }
    case "omit_reflections": {
      const plan = omitPlan(s, input);
      return plan.added.length === 0 && plan.restored.length === 0
        ? s.omitted.length === 0 ? "nothing is omitted, and nothing new was named" : `already as asked: ${s.omitted.map(omittedText).join(", ")} omitted`
        : null;
    }
    case "set_extinction_model":
      return input.model === s.extinctionModel ? `the extinction model is already ${EXTINCTION_MODEL_LABELS[s.extinctionModel]}` : null;
    case "set_resolution_range": {
      const next = resolutionAfter(s, input);
      if (next.dMin !== undefined && next.dMax !== undefined && next.dMin >= next.dMax) throw new Error(`dMin ${next.dMin} Å must lie below dMax ${next.dMax} Å`);
      return next.dMin === s.resolution.dMin && next.dMax === s.resolution.dMax ? `the range is already ${rangeText(next)}` : null;
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
      const minY: number | undefined = input.minExtinction === undefined ? s.outlierFilter.minExtinction : input.minExtinction ?? undefined;
      if (!on) return "Outlier filter off: every reflection fitted";
      // Counted on every reflection in the file, against the current model, as the page's filter cuts.
      const left = s.allRows.filter((r) => !isOmitted(r, s.omitted) && inResolution(r, s.structure.cell, s.resolution) && (Math.abs(r.deltaOverSigma) > cutoff || (minY !== undefined && (r.extinction ?? 1) < minY))).length;
      return `Outlier filter on at ${cutoff}σ${minY !== undefined ? ` and y ≥ ${minY}` : ""}: leaves out ${left} reflection${left === 1 ? "" : "s"} against the current model`;
    }
    case "omit_reflections": {
      const plan = omitPlan(s, input);
      const parts = [
        ...(plan.added.length ? [`Omit ${plan.added.map(omittedText).join(", ")}${input.reason ? ` (${String(input.reason)})` : ""}`] : []),
        ...(plan.restored.length ? [`restore ${plan.restored.map(omittedText).join(", ")}`] : []),
      ];
      return `${parts.join("; ")} — ${plan.next.length} measurement${plan.next.length === 1 ? "" : "s"} omitted in all`;
    }
    case "set_extinction_model":
      return `Extinction model: ${EXTINCTION_MODEL_LABELS[input.model as ExtinctionModel]}, in place of ${EXTINCTION_MODEL_LABELS[s.extinctionModel]} — its parameter restarts at 0`;
    case "set_resolution_range": {
      const next = resolutionAfter(s, input);
      const outside = s.allRows.filter((r) => !inResolution(r, s.structure.cell, next) && !isOmitted(r, s.omitted)).length;
      return `Resolution ${rangeText(next)}: ${outside === 0 ? "every reflection in range" : `leaves out ${outside} reflection${outside === 1 ? "" : "s"}`}`;
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

// ── resolution range ────────────────────────────────────────────────────────

/** The range after set_resolution_range: a limit given as null opens that end, one not given stays. */
function resolutionAfter(s: SingleCrystalLiveState, input: Input): ResolutionRange {
  const end = (v: unknown, was: number | undefined): number | undefined => (v === undefined ? was : typeof v === "number" ? v : undefined);
  const dMin = end(input.dMin, s.resolution.dMin);
  const dMax = end(input.dMax, s.resolution.dMax);
  return { ...(dMin !== undefined ? { dMin } : {}), ...(dMax !== undefined ? { dMax } : {}) };
}

const rangeText = (r: ResolutionRange): string =>
  r.dMin === undefined && r.dMax === undefined ? "the full range" : `d ${r.dMax !== undefined ? `≤ ${r.dMax} Å` : ""}${r.dMin !== undefined && r.dMax !== undefined ? " and " : ""}${r.dMin !== undefined ? `≥ ${r.dMin} Å` : ""}`;

// ── omitting measurements ───────────────────────────────────────────────────

const omittedText = (o: OmittedMeasurement): string => `${o.h} ${o.k} ${o.l}${o.batch !== undefined ? ` (batch ${o.batch})` : ""}`;
const sameMeasurement = (a: OmittedMeasurement, b: OmittedMeasurement): boolean => a.h === b.h && a.k === b.k && a.l === b.l && a.batch === b.batch;

/**
 * omit_reflections: the list after the call, what it adds and what it puts
 * back. Each named measurement must be in the file; when the file has batches
 * and the indices were measured in more than one, the batch must be named
 * (the others stay). Throws, before the user is asked, on a measurement that
 * is not there.
 */
function omitPlan(s: SingleCrystalLiveState, input: Input): { next: OmittedMeasurement[]; added: OmittedMeasurement[]; restored: OmittedMeasurement[] } {
  const named = (item: { h: number; k: number; l: number; batch?: number }): OmittedMeasurement => {
    const matches = s.dataset.reflections.filter((r) => r.h === item.h && r.k === item.k && r.l === item.l && (item.batch === undefined || r.batch === item.batch));
    const where = `${item.h} ${item.k} ${item.l}${item.batch !== undefined ? ` in batch ${item.batch}` : ""}`;
    if (matches.length === 0) {
      const batches = [...new Set(s.dataset.reflections.filter((r) => r.h === item.h && r.k === item.k && r.l === item.l).flatMap((r) => (r.batch !== undefined ? [r.batch] : [])))];
      throw new Error(`no measurement ${where} in the data${batches.length ? ` (it was measured in batch${batches.length === 1 ? "" : "es"} ${batches.join(", ")})` : " — the indices are the file's own, not an equivalent's"}`);
    }
    const batches = [...new Set(matches.flatMap((r) => (r.batch !== undefined ? [r.batch] : [])))];
    if (item.batch === undefined && batches.length > 1) throw new Error(`${where} was measured in batches ${batches.join(", ")}: name the batch of the one that failed`);
    return { h: item.h, k: item.k, l: item.l, ...(item.batch !== undefined ? { batch: item.batch } : batches.length === 1 ? { batch: batches[0]! } : {}) };
  };
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : undefined;
  const added = ((input.omit ?? []) as { h: number; k: number; l: number; batch?: number }[]).map(named)
    .filter((o, i, all) => all.findIndex((x) => sameMeasurement(x, o)) === i && !s.omitted.some((x) => sameMeasurement(x, o)))
    .map((o) => ({ ...o, ...(reason ? { reason } : {}) }));
  const restoreAll = input.restore === "all";
  const restoreList = Array.isArray(input.restore) ? (input.restore as { h: number; k: number; l: number; batch?: number }[]) : [];
  const restored = restoreAll ? [...s.omitted] : s.omitted.filter((o) => restoreList.some((r) => r.h === o.h && r.k === o.k && r.l === o.l && (r.batch === undefined || r.batch === o.batch)));
  if (!restoreAll) {
    for (const r of restoreList) {
      if (!s.omitted.some((o) => r.h === o.h && r.k === o.k && r.l === o.l && (r.batch === undefined || r.batch === o.batch))) {
        throw new Error(`${r.h} ${r.k} ${r.l}${r.batch !== undefined ? ` (batch ${r.batch})` : ""} is not omitted${s.omitted.length ? ` — omitted: ${s.omitted.map(omittedText).join(", ")}` : ""}`);
      }
    }
  }
  const next = [...s.omitted.filter((o) => !restored.includes(o)), ...added];
  return { next, added, restored };
}

// ── views ───────────────────────────────────────────────────────────────────

const hklOf = (x: { h: number; k: number; l: number }): string => `${x.h} ${x.k} ${x.l}`;
const median = (values: readonly number[]): number => {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
};
const measurementKey = (r: SingleCrystalRow): string => `${r.h},${r.k},${r.l},${r.batch ?? ""},${r.foSq},${r.sigma}`;

/**
 * What a misfit measurement's equivalents say: the other measurements of the
 * same reflection (the Laue class), each against its own Fc² (the extinction
 * differs with wavelength), as the ratio Fo²/Fc². One far from the others'
 * median while they agree among themselves failed — whatever the model, so it
 * holds when that one failure drags the whole fit. All of them off the same
 * way is the model's misfit, which no omission should hide; equivalents that
 * scatter among themselves are a correction that differs between them
 * (extinction at different wavelengths, before it is refined) or the model.
 */
function equivalentsReading(s: SingleCrystalLiveState, row: SingleCrystalRow, keyOf: (r: { h: number; k: number; l: number }) => string): string {
  const key = keyOf(row);
  const self = measurementKey(row);
  const others = s.allRows.filter((r) => keyOf(r) === key && measurementKey(r) !== self && r.fcSq > 0);
  if (others.length === 0 || !(row.fcSq > 0)) return "no equivalent measured";
  // A ratio floored at σ, so a measurement that caught nothing still has one.
  const ratio = (r: SingleCrystalRow): number => Math.max(r.foSq, r.sigma, 1e-9 * r.fcSq) / r.fcSq;
  const logs = others.map((r) => Math.log(ratio(r)));
  const lm = median(logs);
  const spread = logs.length > 1 ? median(logs.map((v) => Math.abs(v - lm))) : 0;
  const lq = Math.log(ratio(row));
  const apart = Math.abs(lq - lm);
  const n = `${others.length} equivalent${others.length === 1 ? "" : "s"} at Fo²/Fc² ${sig(Math.exp(lm), 2)} (median${others.length > 2 ? `, scatter ${sig(Math.exp(spread) - 1, 2)}` : ""}), this one ${sig(Math.exp(lq), 2)}`;
  // Failed: off by itself — its equivalents agree among themselves and roughly with the model (within ×1.8, so a
  // fit that one failure drags still counts), and it lies farther from the model than they do.
  if (Math.abs(row.deltaOverSigma) >= 6 && Math.abs(lm) <= 0.6 && Math.abs(lq) > Math.abs(lm) && apart >= Math.max(0.5, 4 * spread)) {
    return `${n}: ${others.length >= 2 && (apart >= 1 || Math.abs(row.deltaOverSigma) >= 10) ? "a failed measurement" : "possibly a failed measurement"}`;
  }
  if (Math.sign(lm) === Math.sign(lq) && Math.abs(lm) >= Math.abs(lq) / 2) return `${n}: the model (or a correction) misses the reflection`;
  return `${n}: they disagree among themselves — a correction that differs between them (extinction or absorption at another wavelength or path), or the model`;
}

/** The largest misfits fitted, each with its batch and what its equivalents say. */
function outliersView(s: SingleCrystalLiveState, count: number): string[] {
  const rotations = laueRotations(s.structure.spaceGroup.operations);
  const keyOf = (r: { h: number; k: number; l: number }): string => canonicalKey(rotations, r.h, r.k, r.l);
  return [...s.rows]
    .filter((r) => r.sigma > 0)
    .sort((a, b) => Math.abs(b.deltaOverSigma) - Math.abs(a.deltaOverSigma))
    .slice(0, count)
    .map((r) => `${hklOf(r)}${r.batch !== undefined ? ` (batch ${r.batch})` : ""}: Fo² ${sig(r.foSq, 4)}, Fc² ${sig(r.fcSq, 4)}, ${sig(r.deltaOverSigma, 3)}σ (d ${sig(dSpacing(s.structure.cell, r.h, r.k, r.l), 3)} Å) — ${equivalentsReading(s, r, keyOf)}`);
}

/** How the reflections were measured, when the file says: each at its own wavelength (TOF Laue), in batches. */
function measurementView(s: SingleCrystalLiveState): Record<string, unknown> | null {
  const refl = s.dataset.reflections;
  const range = (values: number[], digits: number): string => `${sig(Math.min(...values), digits)}–${sig(Math.max(...values), digits)}`;
  const wl = refl.flatMap((r) => (r.wavelength !== undefined ? [r.wavelength] : []));
  const tt = refl.flatMap((r) => (r.twoTheta !== undefined ? [r.twoTheta] : []));
  const tr = refl.flatMap((r) => (r.transmission !== undefined ? [r.transmission] : []));
  const batches = new Set(refl.flatMap((r) => (r.batch !== undefined ? [r.batch] : [])));
  if (wl.length === 0 && batches.size < 2) return null;
  return {
    ...(wl.length > 0 ? { wavelengths: `${range(wl, 3)} Å, each reflection its own (Laue)` } : {}),
    ...(tt.length > 0 ? { twoTheta: `${range(tt, 4)}°` } : {}),
    ...(batches.size >= 2 ? { batches: `${batches.size} (runs or orientations), one scale for all` } : {}),
    ...(tr.length > 0 ? { transmission: `${range(tr, 3)}, applied in data reduction` } : {}),
  };
}

/** Per batch: K = ΣFo²/ΣFc², R1 and its worst reflection, when the reflections carry batches. */
function batchView(rows: readonly SingleCrystalRow[]): Record<string, unknown> | null {
  const groups = new Map<number, SingleCrystalRow[]>();
  for (const r of rows) if (r.batch !== undefined) (groups.get(r.batch) ?? groups.set(r.batch, []).get(r.batch)!).push(r);
  if (groups.size < 2) return null;
  const per = [...groups].map(([batch, rs]) => {
    const fo = rs.reduce((a, r) => a + r.foSq, 0);
    const fc = rs.reduce((a, r) => a + r.fcSq, 0);
    const obs = rs.filter((r) => r.sigma > 0 && r.foSq > 2 * r.sigma);
    const f = (x: number): number => Math.sqrt(Math.max(x, 0));
    const r1 = obs.reduce((a, r) => a + Math.abs(f(r.foSq) - f(r.fcSq)), 0) / Math.max(1e-12, obs.reduce((a, r) => a + f(r.foSq), 0));
    const worst = rs.reduce((w, r) => (Math.abs(r.deltaOverSigma) > Math.abs(w.deltaOverSigma) ? r : w));
    return { batch, n: rs.length, k: fc > 0 ? fo / fc : NaN, r1, worst };
  }).filter((b) => Number.isFinite(b.k) && b.k > 0);
  if (per.length < 2) return null;
  const logs = per.map((b) => Math.log(b.k));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1));
  per.sort((a, b) => Math.abs(Math.log(b.k) - mean) - Math.abs(Math.log(a.k) - mean));
  return {
    batches: per.length,
    K: `${sig(Math.min(...per.map((b) => b.k)), 3)}–${sig(Math.max(...per.map((b) => b.k)), 3)} (geometric mean ${sig(Math.exp(mean), 3)}, scatter ${pct(sd)} %)`,
    farthest: per.slice(0, 5).map((b) => `batch ${b.batch}: ${b.n} reflections, K ${sig(b.k, 3)}, R1 ${pct(b.r1)} %; worst ${hklOf(b.worst)} at ${sig(b.worst.deltaOverSigma, 3)}σ`),
    reading: "One scale serves every batch, so K should scatter about its mean by each batch's precision. A batch whose K stands apart has a scale of its own, or holds a reflection measured wrongly (an edge of the detector, a shadow): its worst reflection says which.",
  };
}

/**
 * reflection_equivalents: every measurement of h k l and its Laue equivalents,
 * against the model and against each other.
 */
function equivalentsView(s: SingleCrystalLiveState, h: number, k: number, l: number): Record<string, unknown> {
  const rotations = laueRotations(s.structure.spaceGroup.operations);
  const key = canonicalKey(rotations, h, k, l);
  const fitted = new Set(s.rows.map((r) => `${r.h},${r.k},${r.l},${r.foSq},${r.sigma}`));
  const matches = s.allRows.filter((r) => canonicalKey(rotations, r.h, r.k, r.l) === key);
  if (matches.length === 0) return { reflection: `${h} ${k} ${l}`, measured: 0, note: "Neither it nor an equivalent is in the data." };
  // The median, not the weighted mean: one failed measurement with a small σ
  // (most of the peak missed, so few counts) drags a weighted mean to itself
  // (sapphire's 5 4 1 pulled its family's mean from ≈ 1400 to 340).
  const sorted = matches.map((r) => r.foSq).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const weighted = matches.filter((r) => r.sigma > 0);
  const spread = weighted.length > 1 ? Math.sqrt(weighted.reduce((a, r) => a + ((r.foSq - median) / r.sigma) ** 2, 0) / (weighted.length - 1)) : undefined;
  return {
    reflection: `${h} ${k} ${l}`,
    measured: matches.length,
    medianFoSq: sig(median, 5),
    fcSq: sig(matches.reduce((a, r) => a + r.fcSq, 0) / matches.length, 5),
    ...(spread !== undefined ? { scatterInSigma: sig(spread, 3) } : {}),
    measurements: matches.map((r) => [
      hklOf(r),
      ...(r.batch !== undefined ? [`batch ${r.batch}`] : []),
      ...(r.wavelength !== undefined ? [`λ ${sig(r.wavelength, 4)} Å`] : []),
      `Fo² ${sig(r.foSq, 5)}(${sig(r.sigma, 3)})`,
      `Fc² ${sig(r.fcSq, 5)}`,
      `${sig(r.deltaOverSigma, 3)}σ from Fc²`,
      ...(r.sigma > 0 ? [`${sig((r.foSq - median) / r.sigma, 3)}σ from the median`] : []),
      ...(r.extinction !== undefined && r.extinction < 1 ? [`y ${sig(r.extinction, 3)}`] : []),
      ...(fitted.has(`${r.h},${r.k},${r.l},${r.foSq},${r.sigma}`) ? [] : [isOmitted(r, s.omitted) ? "omitted" : !inResolution(r, s.structure.cell, s.resolution) ? "outside the resolution range" : "left out by the filter"]),
    ].join(", ")),
    reading: "Equivalents agree to their σ (scatter ≈ 1) when each was measured well. One far from the others, which agree with Fc², failed (a detector edge, a gap, a shadow); all off the same way is the model's misfit, or a correction (extinction, absorption) that differs with wavelength.",
  };
}

/** How hard the extinction correction bites: the smallest y, and how many reflections it reduces a lot. */
function extinctionView(rows: readonly SingleCrystalRow[]): Record<string, unknown> | null {
  const ys = rows.filter((r) => r.extinction !== undefined && r.extinction < 1);
  if (ys.length === 0) return null;
  const min = ys.reduce((m, r) => (r.extinction! < m.extinction! ? r : m));
  return {
    yMin: `${sig(min.extinction!, 3)} at ${hklOf(min)} (Fo² ${sig(min.foSq, 4)})`,
    belowPoint8: ys.filter((r) => r.extinction! < 0.8).length,
    belowPoint5: ys.filter((r) => r.extinction! < 0.5).length,
    reading: "y multiplies |F|² in Fc²: y = 0.6 takes 40 % off. Below about 0.7–0.8 the correction is severe: the extinction model carries those reflections, and their Fo² say little about the structure.",
  };
}

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
      outlierFilter: s.outlierFilter.on ? `on at ${s.outlierFilter.cutoffSigma}σ${s.outlierFilter.minExtinction !== undefined ? ` and y ≥ ${s.outlierFilter.minExtinction}` : ""}: ${s.outlierFilter.excluded} reflections left out` : "off",
      omitted: s.omitted.length ? s.omitted.map((o) => `${omittedText(o)}${o.reason ? `: ${o.reason}` : ""}`) : "none",
      resolution: s.resolution.dMin === undefined && s.resolution.dMax === undefined ? "the full range" : `${rangeText(s.resolution)}: ${s.resolution.excluded} reflections outside`,
      extinctionModel: EXTINCTION_MODEL_LABELS[s.extinctionModel],
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
  const ops = s.structure.spaceGroup.operations;
  const special = s.structure.sites.filter((site) => allowedPositionShifts(ops, site.position).basis.length < 3).length;
  const st = reflectionStatistics(s.rows.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.foSq, sigma: r.sigma })), s.structure.cell, s.structure.spaceGroup, { sites: s.structure.sites.length, special });
  const f = st.friedel;
  const hkl = (x: { h: number; k: number; l: number }): string => `${x.h} ${x.k} ${x.l}`;
  return {
    reflections: { measured: s.observationCount, unique: s.merge.unique, redundancy: sig(s.merge.redundancy, 3), rInt: pct(s.merge.rInt), rSigma: pct(s.merge.rSigma) },
    resolution: { dMin: sig(v.dMin, 4), sinThetaOverLambdaMax: sig(v.sinThetaOverLambdaMax, 4), ...(v.completeness !== undefined ? { completeness: pct(v.completeness) } : {}), uniqueAllowed: v.uniqueAllowed ?? v.uniqueObserved, ...(v.uniqueExpected !== undefined ? { uniqueExpected: v.uniqueExpected } : {}) },
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
      : {
          measured: st.absences.measured,
          atThreeSigma: st.absences.violated.length,
          strongest: st.absences.violated.slice(0, 8).map((a) => `${hkl(a)} (d ${sig(a.d, 4)} Å, ${sig(a.iOverSigma, 3)}σ${a.ofAllowed !== undefined ? `, ${pct(a.ofAllowed)} % of the mean allowed intensity at that d` : ""})`),
          reading: "A few weak ones, at a small fraction of the allowed intensity, are what multiple diffraction (Renninger) gives in a good crystal, or λ/2; a whole class of strong ones questions the group.",
        },
    intensityStatistics: !Number.isFinite(st.intensities.meanAbsE2Minus1) ? "too few reflections"
      : !st.intensities.applies ? { meanAbsE2Minus1: sig(st.intensities.meanAbsE2Minus1, 3), reading: st.intensities.reading }
        : {
            meanAbsE2Minus1: sig(st.intensities.meanAbsE2Minus1, 3),
            fractionWeak: sig(st.intensities.fractionWeak, 3),
            reading: st.intensities.reading,
            expected: "0.968 centrosymmetric, 0.736 non-centrosymmetric; E² < 0.1 for 24.8 % or 9.5 % of reflections",
            group: v.centrosymmetric ? "the space group is centrosymmetric" : "the space group is non-centrosymmetric",
            note: "From the measured intensities: strong extinction lowers the strong end, and the value with it.",
          },
    reflectionsPerParameter: sig(v.reflectionsPerParameter, 3),
    ...(measurementView(s) ? { measurement: measurementView(s) } : {}),
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
      reading: "K = ΣFo²/ΣFc² should stay level (near 1 once the scale is right) and GooF level across both: K falling on the strongest reflections, against the other bins, is extinction; K rising on the weakest is twinning or a wrong model; K rising with resolution is ADPs too large (or extinction at low angle); GooF growing with intensity is the weighting.",
    },
    extinction: v.extinction.suspected
      ? `suspected: the strongest bin has K = ${sig(v.extinction.strongBinK, 3)} against ${sig(v.extinction.otherBinsK, 3)} in the other bins, GooF ${sig(v.extinction.strongBinGoof, 3)}; ${v.extinction.strongUnder} of ${v.extinction.outliers} outliers are strong with Fo² < Fc²`
      : `not indicated (strongest bin K = ${sig(v.extinction.strongBinK, 3)}, the other bins ${sig(v.extinction.otherBinsK, 3)})`,
    ...(extinctionView(s.rows) ? { extinctionCorrection: extinctionView(s.rows) } : {}),
    ...(batchView(s.rows) ? { byBatch: batchView(s.rows) } : {}),
    outliers: outliersView(s, 8),
    outliersReading: "Each outlier against its equivalents: one marked a failed measurement goes with omit_reflections (by its batch); a reflection the model misses stays, whatever its residual.",
    ...(s.omitted.length ? { omitted: s.omitted.map((o) => `${omittedText(o)}${o.reason ? `: ${o.reason}` : ""}`) } : {}),
    extinctionModel: EXTINCTION_MODEL_LABELS[s.extinctionModel],
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
      detail: (v.extinction.suspected
        ? `Strong reflections are weaker than calculated: the strongest bin has K = ${sig(v.extinction.strongBinK, 3)} against ${sig(v.extinction.otherBinsK, 3)} in the others, GooF ${sig(v.extinction.strongBinGoof, 3)}.`
        : `The strongest reflections agree (K = ${sig(v.extinction.strongBinK, 3)} in the strongest bin, ${sig(v.extinction.otherBinsK, 3)} in the others).`) + extinctionLine(s.rows),
    },
  ];
  // The tables a single-crystal listing gives, so the account can quote them.
  checks.push({
    name: "Resolution shells",
    status: "note",
    detail: v.shells.map((sh) => `${sig(sh.dMax, 3)}–${sig(sh.dMin, 3)} Å: ${sh.n} reflections${sh.completeness !== undefined ? `, completeness ${pct(sh.completeness)} %` : ""}, ⟨I/σ⟩ ${sig(sh.iOverSigma, 3)}${sh.rInt !== undefined ? `, R_int ${pct(sh.rInt)} %` : ""}, K ${sig(sh.k, 3)}, GooF ${sig(sh.goof, 3)}, R1 ${pct(sh.r1)} %`).join("; ") + ".",
  });
  checks.push({
    name: "Analysis of variance",
    status: "note",
    detail: `By intensity (weakest to strongest): ${v.bins.map((b) => `K ${sig(b.k, 3)}, GooF ${sig(b.goof, 3)}`).join("; ")}.`,
  });
  const batches = batchView(s.rows);
  if (batches) checks.push({ name: "Batches", status: "note", detail: `${String(batches.batches)} batches, K ${String(batches.K)}; farthest: ${(batches.farthest as string[]).slice(0, 3).join("; ")}.` });
  if (v.outliers.length > 0) {
    checks.push({ name: "Largest outliers", status: "note", detail: outliersView(s, 6).join("; ") + (s.outlierFilter.on ? `; ${s.outlierFilter.excluded} left out by the filter (|Δ|/σ > ${s.outlierFilter.cutoffSigma}${s.outlierFilter.minExtinction !== undefined ? ` or y < ${s.outlierFilter.minExtinction}` : ""}).` : ".") });
  }
  const npd = nonPositiveDefiniteSites(s.refinedStructure);
  if (npd.length) checks.push({ name: "ADPs", status: "warn", detail: `Not positive definite: ${npd.join(", ")} — the ellipsoid is unphysical; refine those sites isotropically, or look for disorder.` });
  const bv = bondValenceCheck([s.refinedStructure]);
  if (bv) checks.push(bv);
  checks.push(...findingChecks(a));
  return checks;
}

/** The correction's reach, for the report: the smallest y and how many reflections fall below 0.8. */
function extinctionLine(rows: readonly SingleCrystalRow[]): string {
  const ext = extinctionView(rows);
  return ext ? ` The correction reaches y = ${String(ext.yMin)}; ${String(ext.belowPoint8)} reflections have y < 0.8.` : "";
}
