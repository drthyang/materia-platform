/**
 * The powder page's magnetic analysis step without React, for tests and the
 * eval suite: the step's operations (app/magneticStep.ts) and the powder
 * page's view of them (app/powderPage.ts: the residual peaks, the moments
 * fit, Show and Continue), as the panel runs them, behind the handle the
 * panel publishes (agent/magneticPort.ts), over a headless session. What it
 * holds is the panel's state, reset where the panel resets it.
 */

import { multiPhaseCurves } from "@/core/workflow/multiPhase";
import type { Vec3 } from "@/core/math/types";
import type { Session } from "@/app/powderSession";
import { candidateId, candidateIndex, candidateView, selectionView, type KCandidateView, type MagneticAgentHandle, type MomentTies } from "@/agent/magneticPort";
import { magneticIonCandidates } from "@/core/magnetic/magneticIons";
import type { KCandidate } from "@/core/magnetic/kSearch";
import { classifyPropagation, describePropagation } from "@/core/magnetic/propagation";
import { centringTranslations } from "@/core/crystal/symmetry";
import { propagationKParameters } from "@/core/magnetic/refinableK";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { magneticComponentCurve } from "@/core/workflow/magneticPowder";
import { powderCurves } from "@/core/workflow/powder";
import { isMagneticModelParameterKind } from "@/core/refinement/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import {
  NO_PEAK_INCLUDED, PEAK_CRITERIA, bestRanked, buildFor, candidatesOf, fitMoments, handoff, momentDims, peakRows, pickedRows, rankCandidates, resolvedAmplitudes, searchK,
  type MagneticFit, type ModelOptions, type RankEntry,
} from "@/app/magneticStep";
import { powderMomentFit, powderPageCurves, refinedPhasesOf, residualPeaksOf, weightedR, withMagneticModelRows, withMagneticPreview, type FitWindow, type PowderCompute } from "@/app/powderPage";

/** The curves of a session, the magnetic model's contribution included. */
export function sessionCurves(s: Session): ReturnType<typeof powderCurves> {
  // A multi-phase page sums its phases, as the page's own curves do.
  const curves = s.extraPhases.length > 0
    ? multiPhaseCurves([s.structure, ...s.extraPhases].map((st) => ({ structure: st, id: st.id })), s.pattern, s.powderParams, s.powderBindings, s.powderProfile)
    : powderCurves(s.structure, s.pattern, s.powderParams, s.powderBindings, s.powderProfile);
  if (!s.magnetic) return curves;
  const mag = magneticComponentCurve(s.structure, s.magnetic, s.pattern, s.powderParams, s.powderBindings, s.powderProfile);
  const yCalc = curves.yCalc.map((y, i) => y + (mag[i] ?? 0));
  return { ...curves, yCalc, diff: curves.yObs.map((o, i) => o - yCalc[i]!) };
}

/** What the step reads off the page: the session and the fit window it applies. */
export interface StepPage {
  readonly session: Session;
  readonly window: FitWindow | null;
}

/** The handle over a page the caller owns (`page` / `set`), as the panel's. */
export function magneticHandle(
  page: () => StepPage,
  set: (s: Session) => void,
  openStep: (step: 0 | 1) => void,
  opts: { readonly instrument?: InstrumentParameters; readonly client?: PowderCompute } = {},
): MagneticAgentHandle {
  let selected: Set<string> | null = null;
  let k: Vec3 = [0, 0, 0];
  // The k-search's candidates, for the included peaks they were found from.
  let results: { readonly peaks: string; readonly found: KCandidate[] } | null = null;
  let selIdx: number | null = null;
  let amps: Record<string, number> = {};
  let ties: MomentTies = { sameSite: true, magnitudes: false };
  // The index sections open: the maximal groups', and each one a choice opened.
  let open = new Set([2]);
  // The ranking and the moments fit's readout, for the page they were made on.
  let rank: { readonly on: string; readonly results: Record<string, RankEntry> } | null = null;
  let fitWR: { readonly on: string; readonly wR: number | null } | null = null;
  // The Agent's picks of peaks into or out of the search, by the peak's d (the table's check boxes).
  let overrides: Readonly<Record<string, boolean>> = {};

  // The panel works on the refined phase (the moments fit re-applies the rows onto the loaded one).
  const structure = () => refinedPhasesOf(page().session)[0]!;
  const ions = () => magneticIonCandidates(structure());
  const chosenIons = (): string[] => [...(selected ?? new Set(ions().map((i) => i.siteLabel)))];
  const options = (): ModelOptions => ({ sameSite: ties.sameSite, magnitudes: ties.magnitudes, flippedUnits: [] });
  const reps = () => candidatesOf(structure(), k);
  const build = (ops: Parameters<typeof buildFor>[3]) => buildFor(structure(), k, chosenIons(), ops, options());
  const rows = () => peakRows(residualPeaksOf(page().session, opts.instrument), PEAK_CRITERIA, overrides);
  const signature = (list: ReturnType<typeof rows>): string => list.filter((r) => r.included).map((r) => r.key).join("|");
  /** What a fit means: the model's structure and rows, the data and the window (the panel drops its ranking and readout when one changes). */
  const fitContext = (): string => {
    const { session: s, window } = page();
    const nuclear = s.powderParams.filter((p) => !isMagneticModelParameterKind(p.kind)).map((p) => `${p.id}=${p.value}`).join(";");
    return `${s.pattern.id}|${s.pattern.points.length}|${window ? `${window.min}–${window.max}` : "all"}|${nuclear}|${k.join(",")}|${chosenIons().join(",")}|${ties.sameSite}|${ties.magnitudes}`;
  };
  const ranked = (): Record<string, RankEntry> => (rank && rank.on === fitContext() ? rank.results : {});
  const fitAgreement = (): number | null => (fitWR && fitWR.on === `${fitContext()}|${selIdx}` ? fitWR.wR : null);
  /** The page's own fit: through the compute client, in this thread for a view-only TOF page (the client does not refine it). */
  const fit = (): MagneticFit => {
    const { session: s, window } = page();
    const viewOnly = s.pattern.xUnit === "tof" && s.powderProfile.shape !== "tof";
    return powderMomentFit(viewOnly ? null : opts.client ?? null, s, window);
  };
  /** The chosen group's amplitudes for a new build: a seed when there is one, else the values kept by row id. */
  const seeded = (b: ReturnType<typeof build>, seed?: Readonly<Record<string, number>>): Record<string, number> => {
    const init: Record<string, number> = {};
    for (const p of b.params) init[p.id] = (seed ?? amps)[p.id] ?? p.value;
    return init;
  };

  const kView = (c: KCandidate): KCandidateView => ({ k: [c.k[0], c.k[1], c.k[2]], label: c.label, matched: c.matched, total: c.total, rmsd: c.rmsd });

  return {
    state: () => {
      const st = structure();
      const list = reps();
      const d = momentDims(st, list, chosenIons(), k);
      const chosen = selIdx !== null ? list[selIdx] : undefined;
      const b = chosen ? build(chosen.candidate.operations) : null;
      const values = b ? resolvedAmplitudes(b, amps) : {};
      const kRows = b ? propagationKParameters(st, b.magnetic) : null;
      const table = rows();
      const entries = ranked();
      const best = bestRanked(entries, list, d);
      const { session: s, window } = page();
      return {
        ions: ions().map((i) => ({ label: i.siteLabel, element: i.element, selected: chosenIons().includes(i.siteLabel) })),
        peaks: table.map((p) => ({ n: p.idx, d: p.d, ...(p.significance !== undefined ? { sigmas: p.significance } : {}), ...(p.nearNuclear ? { near: `${p.nearNuclear.phaseLabel} ${p.nearNuclear.hkl}` } : {}), included: p.included, manual: !!p.manual })),
        kSearch: results && results.peaks === signature(table) ? results.found.slice(0, 8).map(kView) : null,
        k: [k[0], k[1], k[2]],
        kDescription: describePropagation(classifyPropagation(k, { centrings: centringTranslations(st.spaceGroup.operations) })),
        kUnsupported: null,
        candidates: list.map((r, i) => candidateView(r, i, d[i] ?? 0, entries[r.candidate.id])),
        selected: chosen && b ? selectionView(chosen, selIdx!, st, b.params, values, applyMagneticMoments(b.magnetic, b.bindings, values), fitAgreement()) : null,
        ties,
        baselineAgreement: s.pattern.points.length > 0 ? weightedR(s, powderPageCurves(s).nuclear, window) : null,
        best: best ? candidateId(list.findIndex((r) => r.candidate.id === best.id)) : null,
        canFit: true,
        canRefineK: !!kRows && kRows.params.length > 0,
      };
    },
    searchK: (choice) => {
      const picked = pickedRows(rows(), overrides, choice);
      overrides = picked.overrides;
      if (!picked.rows.some((r) => r.included)) throw new Error(NO_PEAK_INCLUDED);
      results = { peaks: signature(picked.rows), found: searchK(structure(), picked.rows) };
      openStep(1);
      return results.found.slice(0, 8).map(kView);
    },
    setK: (kk) => {
      k = [kk[0], kk[1], kk[2]];
      selIdx = null;
      open = new Set([2]);
    },
    selectIons: (labels) => {
      const known = new Set(ions().map((i) => i.siteLabel));
      const unknown = labels.filter((l) => !known.has(l));
      if (unknown.length > 0) throw new Error(`not a magnetic ion site: ${unknown.join(", ")} — the sites are ${[...known].join(", ")}`);
      selected = new Set(labels);
    },
    setTies: (t) => {
      ties = { sameSite: t.sameSite ?? ties.sameSite, magnitudes: t.magnitudes !== undefined ? t.magnitudes : ties.magnitudes };
    },
    rank: async (scope, restarts) => {
      const st = structure();
      const list = reps();
      const on = fitContext();
      rank = { on, results: {} };
      const entries = await rankCandidates({
        structure: st, reps: list, dims: momentDims(st, list, chosenIons(), k), scope, open, build, fit: fit(),
        ...(restarts !== undefined ? { restarts } : {}),
      });
      rank = { on, results: entries };
    },
    choose: (id) => {
      const list = reps();
      const i = candidateIndex(id, list.length);
      const r = list[i]!;
      const entry = ranked()[r.candidate.id];
      amps = seeded(build(r.candidate.operations), entry?.status === "ok" ? entry.values : undefined);
      selIdx = i;
      open = new Set([...open, r.index]);
    },
    refineMoments: async () => {
      const list = reps();
      if (selIdx === null) throw new Error("choose a magnetic group first");
      const b = build(list[selIdx]!.candidate.operations);
      if (b.params.length === 0) throw new Error("the chosen group allows no moment on the chosen ions");
      const on = `${fitContext()}|${selIdx}`;
      const { values, agreement } = await fitMoments(fit(), b, resolvedAmplitudes(b, amps));
      const next = { ...amps };
      for (const p of b.params) next[p.id] = values[p.id] ?? next[p.id]!;
      amps = next;
      fitWR = { on, wR: agreement };
      return agreement;
    },
    apply: (show) => {
      const s = page().session;
      if (!show) {
        set(withMagneticPreview(s, null));
        return;
      }
      if (selIdx === null) throw new Error("choose a magnetic group first");
      const b = build(reps()[selIdx]!.candidate.operations);
      set(withMagneticPreview(s, applyMagneticMoments(b.magnetic, b.bindings, resolvedAmplitudes(b, amps))));
    },
    continueToRefinement: (withK) => {
      if (selIdx === null) throw new Error("choose a magnetic group first");
      const b = build(reps()[selIdx]!.candidate.operations);
      const kRows = withK ? propagationKParameters(structure(), b.magnetic) : null;
      if (withK && (!kRows || kRows.params.length === 0)) throw new Error(kRows?.notes.join(" ") || "k cannot refine with this model");
      const out = handoff(b, resolvedAmplitudes(b, amps), kRows);
      set(withMagneticModelRows(page().session, out.magnetic, out.params, out.bindings));
      openStep(0);
    },
  };
}
