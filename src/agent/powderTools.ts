/**
 * The Agent tools on the powder page: each one reads the live state through
 * the page's port (port.ts) or calls the page's own handler. The analysis
 * tools are the MATERIA MCP handlers (src/mcp/tools.ts) fed from what is on
 * screen, so the Agent and a headless agent judge a fit the same way.
 */

import type { InstrumentConstants, PowderAgentPort, PowderLiveState } from "@/agent/port";
import type { LiveToolSpec } from "@/agent/tools";
import type { ProjectHistory } from "@/core/project/history";
import {
  assess_refinement,
  bond_geometry,
  check_cell_symmetry,
  interpret_structure,
  rank_next_parameters,
  suggest_next_steps,
} from "@/mcp/tools";
import type { StructureModel } from "@/core/crystal/types";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { BackgroundType } from "@/core/diffraction/background";
import type { CorrectionsUpdate, MustrainModel, PeakCorrectionId, SiteTies } from "@/app/powderSpec";
import type { PowderXUnit } from "@/core/diffraction/types";
import { availableDisplayUnits, convertAxisValue, convertInterval } from "@/visualization/axisUnits";
import { residualPeaks } from "@/core/diagnostics/assessment";
import { reviewSymmetry } from "@/core/diagnostics/symmetryReview";
import { formatWt, fractionsOf } from "@/core/diagnostics/phaseFractions";
import { powderResidual, type PowderResidual } from "@/core/diagnostics/powderResidual";
import { unexplainedPeaks, type PeakReading } from "@/core/diagnostics/unexplainedPeaks";
import { generateReflections } from "@/core/diffraction/reflections";
import { diagnoseFit, widthsComparable } from "@/core/diagnostics/fitDiagnosis";
import { knownPhaseNames, knownPhaseStructure, matchKnownPhases } from "@/core/diagnostics/knownPhases";
import { withAntisite } from "@/core/crystal/antisite";
import { structureTable } from "@/agent/structureTable";
import { powderReflectionObsCalc } from "@/core/workflow/obsCalc";
import { excludedPointMask } from "@/core/refinement/factors";
import { checkEqualTies, type EqualTieUpdate } from "@/core/refinement/constraints";
import { applyFree, bondsOf, cellOf, describeFree, freeNoOp, goToStep, historyView, matchIds, parameterSummary, pct, sig, type LiveToolHost } from "@/agent/liveCommon";
import { powderValidation } from "@/core/diagnostics/powderValidation";
import type { ReportCheck } from "@/core/export/report";
import { CORRELATION_LISTED, bondValenceCheck, boundsCheck, convergenceCheck, correlationsCheck, findingChecks, noResultCheck, verdictCheck } from "@/agent/reportChecks";
import { groupOf } from "@/agent/method";
import { magneticNext } from "@/agent/magneticTools";
import type { UnitCell } from "@/core/crystal/types";
import { dScaleSearch, observedPeaks, wrongScale } from "@/core/diagnostics/dScale";
import { inspectDataRange, type DataEnd, type DataRangeReading } from "@/core/diagnostics/dataRange";
import type { ReferenceEntry } from "@/agent/references";


/* eslint-disable @typescript-eslint/no-explicit-any -- inputs are validated against the spec's zod schema before a handler runs */
type Input = any;

/** Run a read or control tool. Returns the JSON result the model sees. */
/** The tools that need a model with atoms: on the placeholder they would judge nothing. */
// check_fit_range too: it cuts the window in the gaps between the reflections, and a placeholder has none.
const NEEDS_STRUCTURE = new Set(["check_fit_range", "assess_refinement", "suggest_next_steps", "rank_next_parameters", "check_cell_symmetry", "find_unexplained_peaks", "review_symmetry", "diagnose_fit", "bond_geometry", "interpret_structure", "refine"]);

/** Refuse a tool that needs a structure when only data are loaded. */
export function requireStructure(name: string, s: PowderLiveState): void {
  if (NEEDS_STRUCTURE.has(name) && s.structure.sites.length === 0) {
    throw new Error("no structure is loaded: the data sit on an empty placeholder model (no atoms, no reflections). Ask the user to load the CIF of the phase (Load CIF…) before refining or judging anything");
  }
}

export function readPowderTool(name: string, input: Input, port: PowderAgentPort, host: LiveToolHost): unknown {
  const s = port.state();
  requireStructure(name, s);
  switch (name) {
    case "get_state": {
      // Where the magnetic step has something to work on, its own next step: for a
      // magnetic question it leads, and the powder checklist is the refinement step's.
      const magnetic = port.magnetic?.()?.state();
      const view = stateView(s, host.history(), input.parameters);
      const active = magnetic && (magnetic.peaks.some((p) => p.included) || magnetic.kSearch !== null || magnetic.selected !== null);
      return active ? { magneticStep: { next: magneticNext(magnetic), note: "For the magnetic structure, follow the magnetic step's sequence (magnetic_state reads it): the method's powder stages below are the refinement step's, not the next step of a magnetic analysis." }, ...view } : view;
    }
    case "assess_refinement":
      return assessment(s);
    case "suggest_next_steps":
      return { steps: suggest_next_steps({ assessment: assessment(s) }) };
    case "rank_next_parameters": {
      if (s.extraPhases.length > 0) throw new Error("rank_next_parameters is single-phase only; this session has " + (s.extraPhases.length + 1) + " phases");
      const ranked = rank_next_parameters({
        structure: s.structure,
        pattern: s.pattern,
        parameters: [...s.parameters],
        bindings: [...s.bindings],
        profile: s.profile,
        magnetic: s.magnetic,
        // The problem the next refinement solves: its restraints, and only the points in the fit window.
        restraints: [...s.restraints],
        ...(s.fitRange ? { fitRange: { ...s.fitRange } } : {}),
      });
      // A group the instrument–thermal rule would refuse next to the free set: say so with the ranking.
      const kindOf = new Map(s.parameters.map((p) => [p.id, p.kind]));
      const freeGroups = new Set(s.parameters.filter((p) => !p.fixed && !p.expression).map((p) => groupOf(p.kind)));
      const clash = (ids: readonly string[]): string | null => {
        const mine = new Set(ids.map((id) => groupOf(kindOf.get(id) ?? "scale")));
        if (mine.has("instrument") && freeGroups.has("thermal")) return "the B values are free: fix them first (the instrument's terms and the thermal parameters refine in turn)";
        if (mine.has("thermal") && freeGroups.has("instrument")) return "instrument terms are free: fix them first (the instrument's terms and the thermal parameters refine in turn)";
        return null;
      };
      return {
        wrNow: pct(ranked.wrNow),
        groups: ranked.groups.slice(0, 12).map((g) => {
          const rule = clash(g.parameterIds);
          return {
            group: g.group,
            parameterIds: g.parameterIds,
            predictedWr: pct(g.predictedWr),
            expectedRelativeImprovement: sig(g.expectedRelativeImprovement, 3),
            ...(rule ? { rule } : {}),
          };
        }),
      };
    }
    case "check_fit_range":
      return fitRangeView(s, fitRangeReading(s));
    case "check_cell_symmetry": {
      // One factor on every d (a wrong λ or difC) first, from the pattern's own peaks: the Le Bail fit cannot follow it.
      const scale = scaleReading(s);
      const runCellCheck = (): ReturnType<typeof check_cell_symmetry> =>
        check_cell_symmetry({
        structure: s.refinedPhases[0] ?? s.structure,
        pattern: s.pattern,
        ...(s.instrument ? { instrument: s.instrument } : {}),
        ...(s.extraPhases.length > 0 ? { extraPhases: s.refinedPhases.slice(1) as StructureModel[] } : {}),
        ...(s.fitRange ? { fitRange: { ...s.fitRange } } : {}),
        ...(input.dMin !== undefined ? { dMin: input.dMin } : {}),
        ...(input.significance !== undefined ? { significance: input.significance } : {}),
        });
      let check: ReturnType<typeof check_cell_symmetry>;
      try {
        check = runCellCheck();
      } catch (e) {
        throw new Error(`${e instanceof Error ? e.message : String(e)}${scale ? `. ${scale}` : ""}`, { cause: e });
      }
      // Each unindexed peak in d and Q too, and marked on the plot for the user:
      // in 2θ with the check's own refined zero taken out, as its reflections were placed.
      const axis = check.zero !== undefined ? { ...s.axis, zero: check.zero } : s.axis;
      const unindexed = check.unindexedPeaks.map((p) => {
        const d = convertAxisValue(p.x, s.pattern.xUnit, "dSpacing", axis);
        return { ...p, ...(Number.isFinite(d) ? { d: sig(d, 5), q: sig((2 * Math.PI) / d, 5) } : {}) };
      });
      const marks = unindexed.flatMap((p) => ("d" in p && p.d !== undefined ? [{ d: p.d, height: p.significance }] : []));
      if (marks.length > 0) port.showPeaks(marks);
      // A check, not a gate: an absence flag is recorded and revisited at the
      // end (review_symmetry), never acted on before the structure is refined.
      const violated = check.absences.violated;
      const flags = violated.map((v) => `${v.h} ${v.k} ${v.l} at d ${v.d.toFixed(3)} Å`).join(", ");
      // The cell a good Le Bail fit found, against the structure's: one factor on every length reads as the wavelength.
      const shift = scale ?? (check.leBail.rWeighted < 0.5 ? cellShiftReading(s.structure.cell, check.cell, s.pattern.xUnit) : null);
      const readings = [
        ...(shift ? [shift] : []),
        ...(unindexed.length > 0 ? [`${unindexed.length} peak${unindexed.length === 1 ? "" : "s"} no reflection of the cell indexes: a missing phase (most often) or a wrong cell. identify_peaks (with their d) checks the sample environment and common standards. Settle this with the user before refining the structure.`] : []),
        ...(check.shoulders.length > 0 ? [shoulderReading(check.shoulders, s.pattern.xUnit)] : []),
        ...(violated.length > 0
          ? [`${violated.length} forbidden reflection${violated.length === 1 ? "" : "s"} show${violated.length === 1 ? "s" : ""} leftover intensity (${flags}). This is a flag, not a verdict: before the structure is refined, profile misfit${unindexed.length > 0 ? ", or a line of the unindexed phase," : ""} reads the same way. Do not change the space group now: note it (write_note) and refine the structure to the best; review_symmetry reads the refined residual at the end.`]
          : []),
      ];
      const reading = readings.length > 0 ? readings.join(" ") : "Every peak indexes and no forbidden reflection shows intensity: refine the structure.";
      // Shoulders in the pattern's own unit, rounded.
      const shoulders = check.shoulders.map((sh) => ({ x: sig(sh.x, 6), significance: sig(sh.significance, 3), of: sh.of, offset: sig(sh.offset, 3), relativeHeight: sig(sh.relativeHeight, 2) }));
      // The Le Bail fit as the report gives it (cellCheckSummary): the cell to six figures, Rwp in per cent.
      const rounded = (o: Readonly<Record<string, number>>): Record<string, number> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sig(v, 6)]));
      const hklAt = <T extends { d: number; x: number }>(r: T): T => ({ ...r, d: sig(r.d, 5), x: sig(r.x, 6) });
      return {
        ...check,
        cell: rounded(check.cell as unknown as Record<string, number>),
        cellValues: rounded(check.cellValues),
        leBail: { Rwp: pct(check.leBail.rWeighted), fwhm: sig(check.leBail.fwhm, 4), background: sig(check.leBail.background, 4) },
        absences: { ...check.absences, violated: check.absences.violated.map(hklAt), untestable: check.absences.untestable.map(hklAt) },
        unindexedPeaks: unindexed,
        shoulders,
        reading,
        ...(marks.length > 0 ? { markedOnPlot: "The unindexed peaks are marked on the plot (filled ▽, listed under it)." } : {}),
      };
    }
    case "find_unexplained_peaks": {
      // Each peak must stand 5σ above its own counting noise, and is checked
      // against every phase's reflections. Only a peak on no reflection is
      // unexplained (an extra peak); one on or beside a reflection is that
      // reflection's misfit, which refining the model fixes.
      const found = unexplainedPeaks(residualOf(s), { ...(input.sigma !== undefined ? { sigma: input.sigma } : {}), limit: input.limit ?? 12, identifyTool: "identify_peaks" });
      const { unexplained: between, misfits } = found.raw;
      // Shown to the user too: ▽ marks with guide lines on the plot.
      const marked = input.showMisfits ? [...between, ...misfits].sort((a, b) => b.height - a.height) : between;
      port.showPeaks(marked.map((p) => {
        const near = found.view(p).near;
        return { d: p.d, height: p.height, ...(near ? { near } : {}) };
      }));
      // The tools' reading (core/diagnostics/unexplainedPeaks.ts), with the data's own axis (TOF or 2θ) from the page's calibration.
      const view = (p: PeakReading): Record<string, unknown> => ({
        d: sig(p.d, 5),
        q: sig((2 * Math.PI) / p.d, 5),
        ...(s.pattern.xUnit !== "dSpacing" && s.pattern.xUnit !== "q" ? { [s.pattern.xUnit]: sig(convertAxisValue(p.d, "dSpacing", s.pattern.xUnit, s.axis), 6) } : {}),
        height: sig(p.height, 3),
        ...(p.sigmas !== undefined ? { sigmas: sig(p.sigmas, 3) } : {}),
        ...(p.near ? { near: p.near } : {}),
      });
      return {
        count: found.count,
        unexplained: found.unexplained.map(view),
        misfits: found.misfits.map(view),
        ...(found.k0Magnetic ? { k0Magnetic: true } : {}),
        reading: found.reading,
        ...(marked.length > 0
          ? { markedOnPlot: input.showMisfits ? "The user sees these marked on the plot (filled ▽ unexplained, hollow ▽ misfits on or beside a known reflection, listed under it); refer to them by d." : "The user sees the unexplained peaks marked on the plot (filled ▽, listed under it); refer to them by d." }
          : {}),
      };
    }
    case "identify_peaks": {
      const residual = residualOf(s);
      const given = Array.isArray(input.d) ? (input.d as number[]).filter((d) => d > 0) : null;
      const peaks = given
        ? given.map((d) => ({ d, height: 0 }))
        : residualPeaks(residual, { limit: 12 }).between.map((p) => ({ d: p.d, height: p.height }));
      if (peaks.length === 0) return { peaks: [], candidates: [], reading: "No unexplained peak to identify: every residual peak sits on or beside a reflection of the model's phases." };
      const finite = residual.d.filter((v) => Number.isFinite(v) && v > 0);
      const candidates = matchKnownPhases(peaks, s.pattern.radiation, { dMin: Math.min(...finite), dMax: Math.max(...finite) });
      const lead = candidates[0];
      // A phase whose strongest line is missing is a doubtful match, however many weak lines it explains
      // (round 10: graphite offered for two weak NAC lines without its 002).
      const strongestMissing = lead?.alsoExpected.find((e) => e.relativeIntensity >= 0.8);
      const strongLead = lead && !strongestMissing && (lead.explains.length >= 2 || (lead.explains.length === 1 && lead.explains[0]!.relativeIntensity >= 0.8 && lead.alsoExpected.length === 0));
      const reading = !lead
        ? `None of the ${peaks.length} peak${peaks.length === 1 ? "" : "s"} matches a common sample-environment phase or standard: an impurity of the sample, magnetic order, or a feature to put to the user.`
        : strongestMissing
          ? `No convincing match: ${lead.phase} would explain ${lead.explains.length} of ${peaks.length} (${lead.explains.map((e) => e.hkl).join(", ")}), but its strongest line ${strongestMissing.hkl} at d ${strongestMissing.d.toFixed(3)} Å is not among the peaks. Unless that line hides under one of the sample's, report the peaks as unexplained.`
        : strongLead
          ? `${lead.explains.length} of ${peaks.length} peak${peaks.length === 1 ? "" : "s"} match ${lead.phase} (${lead.explains.map((e) => e.hkl).join(", ")}), with its d-spacings × ${lead.dScale.toFixed(4)} — usually ${lead.source}.${lead.alsoExpected.length ? ` Its strong lines ${lead.alsoExpected.map((e) => `${e.hkl} at d ${e.d.toFixed(3)} Å`).join(", ")} should also be seen (they may hide under the sample's lines).` : ""}${lead.impurity ? " An impurity of the sample: put it to the user, and add it (add_known_phase) so its lines are modelled and its weight fraction refines." : " Put it to the user: add the phase (add_known_phase) or leave the lines unmodelled and say so; it is not part of the sample."}`
          : `Only weak or single matches (best: ${lead.phase} ${lead.explains.map((e) => e.hkl).join(", ")}): not enough to name a phase. Report the peaks to the user as unexplained.`;
      return {
        peaks: peaks.map((p) => ({ d: sig(p.d, 5), ...(s.pattern.xUnit !== "dSpacing" && s.pattern.xUnit !== "q" ? { [s.pattern.xUnit]: sig(convertAxisValue(p.d, "dSpacing", s.pattern.xUnit, s.axis), 6) } : {}) })),
        candidates: candidates.slice(0, 4).map((c) => ({
          phase: c.phase, source: c.source, dScale: sig(c.dScale, 5),
          explains: c.explains.map((e) => ({ d: sig(e.d, 5), hkl: e.hkl, relativeIntensity: sig(e.relativeIntensity, 2) })),
          alsoExpected: c.alsoExpected.map((e) => ({ d: sig(e.d, 5), hkl: e.hkl, relativeIntensity: sig(e.relativeIntensity, 2) })),
        })),
        reading,
      };
    }
    case "review_symmetry": {
      // The executor runs this only once the method's stages are refined.
      const residual = residualOf(s);
      const review = reviewSymmetry(s.refinedPhases, residual);
      const marks = review.observedForbidden.map((o) => ({ d: o.d, height: o.height, near: `forbidden ${o.hkl}` }));
      if (marks.length > 0) port.showPeaks(marks);
      const magnetic = review.observedForbidden.length > 0 && residual.magneticNeutron
        ? "Neutron data with magnetic ions: magnetic order with k = 0 puts intensity on nuclear-forbidden reflections. Rule that out (is the sample below its ordering temperature? the magnetic page) before lowering the nuclear symmetry."
        : undefined;
      return {
        ...review,
        observedForbidden: review.observedForbidden.map((o) => ({ hkl: o.hkl, d: sig(o.d, 5), ...(o.sigmas !== undefined ? { sigmas: sig(o.sigmas, 3) } : {}) })),
        ...(magnetic ? { magneticCaveat: magnetic } : {}),
        decision: "The user's. Present the evidence and the candidates; do not change the model. A lower symmetry is a new model (its CIF, loaded by the user), refined again from the start of the method, and kept only if it fits these reflections without the misfit moving elsewhere and with fewer free parameters than it gains in χ² (a Hamilton-type test).",
        ...(marks.length > 0 ? { markedOnPlot: "The forbidden reflections with intensity are marked on the plot (filled ▽, labelled forbidden h k l)." } : {}),
      };
    }
    case "diagnose_fit":
      return fitDiagnosisView(s);
    case "structure_table":
      if (input.against !== undefined) throw new Error("`against` is on the single-crystal page only, for now");
      return { phases: s.refinedPhases.map((ph, i) => structureTable(ph, i, s.parameters, s.bindings, s.result?.esd ?? {})), ...(s.result ? {} : { note: "No refinement on screen: the values carry no esds." }) };
    case "bond_geometry":
      return bondsOf(s.refinedPhases, input, bond_geometry);
    case "interpret_structure": {
      const wavelength = s.instrument?.kind === "constantWavelength" ? s.instrument.wavelength : s.pattern.radiation.kind !== "neutron-tof" ? s.pattern.radiation.wavelength : undefined;
      return interpret_structure({
        structure: s.refinedPhases[0] ?? s.structure,
        parameters: [...s.parameters],
        ...(s.result ? { esd: { ...s.result.esd } } : {}),
        ...(wavelength !== undefined ? { wavelength } : {}),
        magnetic: s.magnetic,
      });
    }
    default:
      throw new Error(`${name} is not a powder read tool`);
  }
}

/**
 * Make a change on the page. Returns a note for the model when the change
 * needed adjusting (tied parameters skipped). The caller records the step and
 * reports the outcome once the change has rendered.
 */
export async function changePowder(name: string, input: Input, port: PowderAgentPort, host: LiveToolHost): Promise<string | undefined> {
  const s = port.state();
  requireStructure(name, s);
  switch (name) {
    case "set_free":
      return applyFree(s.parameters, input, port.setFixed);
    case "set_background":
      if (input.terms !== undefined) port.setBackgroundTerms(input.terms);
      if (input.type !== undefined) port.setBackgroundType(input.type as BackgroundType);
      return undefined;
    case "set_microstrain":
      port.setMustrain(input.model as MustrainModel);
      return undefined;
    case "set_adp_model":
      port.setAnisotropicAdp(!!input.anisotropic);
      return undefined;
    case "set_site_ties":
      port.setSiteTies(siteTieUpdate(input));
      return undefined;
    case "set_corrections": {
      if (!port.setCorrections) throw new Error("this page has no corrections to set");
      port.setCorrections(correctionUpdate(input));
      return undefined;
    }
    case "add_antisite": {
      if (!port.addAntisite) throw new Error("this page cannot change its structure");
      port.addAntisite(String(input.siteA), String(input.siteB));
      return undefined;
    }
    case "add_known_phase": {
      if (!port.addPhase) throw new Error("this page cannot add a phase");
      port.addPhase(knownPhaseStructure(String(input.name))!);
      return undefined;
    }
    case "tie_parameters": {
      if (!port.setParameterTies) throw new Error("this page cannot tie parameters");
      port.setParameterTies(tieUpdate(s.parameters, input));
      return undefined;
    }
    case "set_instrument_constants": {
      if (!port.setInstrumentConstants) throw new Error("this page cannot change its instrument");
      port.setInstrumentConstants(constantsUpdate(input));
      return undefined;
    }
    case "set_fit_range": {
      if (input.whole) {
        port.setFitRange(null);
        return undefined;
      }
      const { min, max } = requestedWindow(s, input);
      if (max < s.extent.min || min > s.extent.max) throw new Error(`${sig(min, 6)}–${sig(max, 6)} ${UNIT[s.pattern.xUnit]} is outside the pattern (${sig(s.extent.min, 6)}–${sig(s.extent.max, 6)})`);
      port.setFitRange({ min: Math.max(min, s.extent.min), max: Math.min(max, s.extent.max) });
      return undefined;
    }
    case "refine":
      if (s.viewOnly) throw new Error("this pattern is view-only (a TOF pattern without a TOF profile); load its instrument file to refine it");
      if (!s.parameters.some((p) => !p.fixed && !p.expression)) throw new Error("no parameter is free — free some with set_free first");
      {
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
      throw new Error(`${name} is not a powder change tool`);
  }
}

/**
 * Why a change would do nothing, or null when it would do something — a
 * no-op never asks the user for approval.
 */
export function powderNoOp(spec: LiveToolSpec, input: Input, s: PowderLiveState): string | null {
  // Checked before the correlation probe: on the placeholder it would misread.
  requireStructure(spec.name, s);
  // An empty change is an error before anyone is asked.
  if (spec.name === "set_background" && input.terms === undefined && input.type === undefined) throw new Error("pass `terms`, `type`, or both");
  if (spec.name === "set_adp_model") {
    const want = input.anisotropic ? "anisotropic" : "isotropic";
    return s.structure.sites.every((site) => site.adp.kind === want) ? `the ADPs are already ${want}` : null;
  }
  if (spec.name === "set_site_ties") {
    const update = siteTieUpdate(input);
    const keys = Object.keys(update) as (keyof SiteTies)[];
    if (keys.length === 0) throw new Error("pass at least one of `positions`, `adp`, `occupancyToUnity`, `composition`");
    return keys.every((k) => tieOn(s.settings.siteTies, k) === update[k]) ? "the site ties are already set so" : null;
  }
  if (spec.name === "set_corrections") {
    const update = correctionUpdate(input);
    if (Object.keys(update).length === 0) throw new Error("pass `asymmetry`, `preferredOrientation`, `peak`, or several");
    if (update.asymmetry && s.pattern.xUnit !== "twoTheta") throw new Error("peak asymmetry (FCJ) is for constant-wavelength 2θ data; a TOF peak's asymmetry is its back-to-back exponentials");
    if (update.asymmetry && s.profile.shape !== "pseudoVoigt") throw new Error("peak asymmetry (FCJ) works on the pseudo-Voigt profile, which needs the instrument's Caglioti U, V, W: ask the user to load the instrument file");
    const now = s.settings.corrections;
    const same = (update.asymmetry === undefined || !!now.asymmetry === update.asymmetry)
      && (update.preferredOrientation === undefined || (update.preferredOrientation === null ? !now.preferredOrientation : now.preferredOrientation?.join() === update.preferredOrientation.join()))
      && (update.peak === undefined || [...update.peak].sort().join() === [...(now.peak ?? [])].sort().join());
    return same ? "the corrections are already set so" : null;
  }
  if (spec.name === "add_known_phase") {
    const name = String(input.name);
    if (!knownPhaseStructure(name)) throw new Error(`"${name}" is not in the library — it holds ${knownPhaseNames().join(", ")}; for another phase the user loads its CIF (Add CIF…)`);
    if ([s.structure, ...s.extraPhases].some((p) => p.name === name)) return `${name} is already a phase of the model`;
  }
  if (spec.name === "add_antisite") {
    if (s.extraPhases.length > 0) throw new Error("antisite disorder is added to a single-phase model");
    // Throws for an unknown site, two sites of one element, or a pair already exchanged.
    withAntisite(s.structure, String(input.siteA), String(input.siteB));
    return null;
  }
  if (spec.name === "tie_parameters") {
    if (input.complement !== undefined || input.adp !== undefined) throw new Error("`complement` and `adp` are the single-crystal page's: here set_site_ties ties a shared site's occupancies (Σ occ = 1) and ADPs");
    return checkEqualTies(s.parameters, tieUpdate(s.parameters, input)).unchanged ? "those parameters are already tied so" : null;
  }
  if (spec.name === "set_instrument_constants") {
    const update = constantsUpdate(input);
    if (Object.keys(update).length === 0) throw new Error("pass `polarization`, `kAlpha2Ratio`, or both");
    const r = s.pattern.radiation;
    if (r.kind !== "xray" || s.pattern.xUnit !== "twoTheta") throw new Error("the polarization and the Kα₂ ratio are constants of constant-wavelength X-ray data; this pattern is not");
    if (update.kAlpha2Ratio !== undefined && !r.kAlpha2) throw new Error("this instrument has no Kα₂ line (a monochromatic beam): there is no ratio to set");
    const same = (update.polarization === undefined || Math.abs((r.polarization ?? 0.5) - update.polarization) < 1e-9)
      && (update.kAlpha2Ratio === undefined || Math.abs((r.kAlpha2?.ratio ?? 0) - update.kAlpha2Ratio) < 1e-9);
    return same ? "the instrument constants are already so" : null;
  }
  return spec.name === "set_free" ? freeNoOp(s.parameters, input) : null;
}

/** tie_parameters' globs expanded in the order given (so the leader stays first), each id once. */
function tieUpdate(params: readonly RefinementParameter[], input: Input): EqualTieUpdate {
  const expand = (list: readonly string[]): string[] => [...new Set(list.flatMap((g) => matchIds(params, [g])))];
  return {
    ...(Array.isArray(input.equal) ? { equal: expand(input.equal as string[]) } : {}),
    ...(Array.isArray(input.release) ? { release: expand(input.release as string[]) } : {}),
  };
}

function constantsUpdate(input: Input): InstrumentConstants {
  return {
    ...(typeof input.polarization === "number" ? { polarization: input.polarization } : {}),
    ...(typeof input.kAlpha2Ratio === "number" ? { kAlpha2Ratio: input.kAlpha2Ratio } : {}),
  };
}

function correctionUpdate(input: Input): CorrectionsUpdate {
  return {
    ...(typeof input.asymmetry === "boolean" ? { asymmetry: input.asymmetry as boolean } : {}),
    ...(input.preferredOrientation !== undefined ? { preferredOrientation: input.preferredOrientation as [number, number, number] | null } : {}),
    ...(Array.isArray(input.peak) ? { peak: input.peak as PeakCorrectionId[] } : {}),
  };
}

const SITE_TIE_KEYS = ["positions", "adp", "occupancyToUnity", "composition"] as const;
const SITE_TIE_NAMES: Record<keyof SiteTies, string> = { positions: "tie position", adp: "tie ADP", occupancyToUnity: "Σ occ = 1", composition: "hold composition" };
/** A tie's effective value: positions and ADPs are tied unless switched off. */
const tieOn = (ties: SiteTies, k: keyof SiteTies): boolean => ties[k] ?? (k === "positions" || k === "adp");

function siteTieUpdate(input: Input): Partial<Record<keyof SiteTies, boolean>> {
  const update: Partial<Record<keyof SiteTies, boolean>> = {};
  for (const k of SITE_TIE_KEYS) if (typeof input[k] === "boolean") update[k] = input[k] as boolean;
  return update;
}

/** One line for the approval card: what this change will do, in the page's terms. */
export function describePowderChange(spec: LiveToolSpec, input: Input, s: PowderLiveState): string {
  switch (spec.name) {
    case "set_free":
      return describeFree(s.parameters, input);
    case "set_background":
      return [
        ...(input.terms !== undefined ? [`Background terms ${s.settings.backgroundTerms} → ${String(input.terms)}`] : []),
        ...(input.type !== undefined ? [`Background basis ${s.settings.backgroundType} → ${String(input.type)}`] : []),
      ].join(" · ");
    case "set_microstrain":
      return `Microstrain ${s.settings.mustrain} → ${String(input.model)}`;
    case "set_adp_model":
      return `ADPs ${s.settings.anisotropicAdp ? "anisotropic" : "isotropic"} → ${input.anisotropic ? "anisotropic" : "isotropic"}`;
    case "set_site_ties":
      return Object.entries(siteTieUpdate(input)).map(([k, v]) => `${SITE_TIE_NAMES[k as keyof SiteTies]} ${v ? "on" : "off"}`).join(" · ");
    case "set_corrections": {
      const u = correctionUpdate(input);
      return [
        ...(u.asymmetry !== undefined ? [`asymmetry ${u.asymmetry ? "on" : "off"}`] : []),
        ...(u.preferredOrientation !== undefined ? [u.preferredOrientation ? `preferred orientation along ${u.preferredOrientation.join(" ")}` : "preferred orientation off"] : []),
        ...(u.peak !== undefined ? [`peak corrections: ${u.peak.length ? u.peak.join(", ") : "none"}`] : []),
      ].join(" · ");
    }
    case "add_known_phase": {
      const p = knownPhaseStructure(String(input.name));
      return p ? `Add ${p.name} (${p.spaceGroup.hermannMauguin ?? "?"}, a = ${p.cell.a} Å) as a further phase: its scale and cell refine with the others` : `Add ${String(input.name)}`;
    }
    case "add_antisite": {
      const a = s.structure.sites.find((x) => x.label === input.siteA);
      const b = s.structure.sites.find((x) => x.label === input.siteB);
      return `Antisite ${String(input.siteA)} ⇄ ${String(input.siteB)}: ${b?.element ?? "?"} on ${String(input.siteA)}, ${a?.element ?? "?"} on ${String(input.siteB)}, at occupancy 0 · Σ occ = 1 and hold composition on`;
    }
    case "tie_parameters": {
      const u = tieUpdate(s.parameters, input);
      const kind = (id: string | undefined): string => (s.parameters.find((p) => p.id === id)?.kind === "occupancy" ? "occupancy" : "B");
      return [
        ...(u.equal ? [`Tie ${u.equal.slice(1).join(", ")} = ${u.equal[0]} (one ${kind(u.equal[0])} refines)`] : []),
        ...(u.release ? [`Release the tie on ${u.release.join(", ")}`] : []),
      ].join(" · ");
    }
    case "set_instrument_constants": {
      const u = constantsUpdate(input);
      const r = s.pattern.radiation;
      return [
        ...(u.polarization !== undefined ? [`Polarization ${r.kind === "xray" ? r.polarization ?? 0.5 : "—"} → ${u.polarization}`] : []),
        ...(u.kAlpha2Ratio !== undefined ? [`Kα₂/Kα₁ ${r.kind === "xray" ? r.kAlpha2?.ratio ?? "—" : "—"} → ${u.kAlpha2Ratio}`] : []),
      ].join(" · ");
    }
    case "set_fit_range": {
      if (input.whole) return "Fit the whole pattern";
      const w = requestedWindow(s, input);
      const native = `${sig(w.min, 6)} – ${sig(w.max, 6)} ${UNIT[s.pattern.xUnit]}`;
      const unit = (input.unit as PowderXUnit | undefined) ?? s.pattern.xUnit;
      return unit === s.pattern.xUnit ? `Fit window ${native}` : `Fit window ${String(input.min ?? "edge")} – ${String(input.max ?? "edge")} ${UNIT[unit]} (${native})`;
    }
    case "refine": {
      const free = s.parameters.filter((p) => !p.fixed && !p.expression).length;
      return input.mode === "thorough"
        ? `${s.result ? "Escape minimum" : "Prefit"} (multi-start) on ${free} free parameter${free === 1 ? "" : "s"}`
        : `Refine ${free} free parameter${free === 1 ? "" : "s"}`;
    }
    case "reset_parameters":
      return input.parameters ? `Reset ${matchIds(s.parameters, input.parameters as string[]).join(", ")} to the starting value` : "Reset every parameter to its starting value";
    case "go_to_step":
      return `Go to step ${String(input.step)}`;
    default:
      return spec.title;
  }
}

// ── state view ──────────────────────────────────────────────────────────────

function stateView(s: PowderLiveState, history: ProjectHistory | null, select: readonly string[] | undefined): Record<string, unknown> {
  if (s.structure.sites.length === 0) {
    return {
      technique: "powder",
      source: s.source,
      warning: "No structure is loaded: the data sit on an empty placeholder model (no atoms, no reflections). Nothing can be refined or judged until the user loads the phase's CIF (Load CIF…).",
      data: { points: s.pattern.points.length, axis: s.pattern.xUnit, extent: [sig(s.extent.min, 6), sig(s.extent.max, 6)], radiation: s.pattern.radiation.kind },
    };
  }
  const xs = s.pattern.points;
  const axisWarning = axisPlausibility(s);
  return {
    technique: "powder",
    source: s.source,
    busy: s.busy,
    ...(axisWarning ? { axisWarning } : {}),
    ...(s.viewOnly ? { viewOnly: "TOF pattern without a TOF profile: shown, not refined" } : {}),
    phases: [s.structure, ...s.extraPhases].map((ph, i) => {
      const refined = s.refinedPhases[i] ?? ph;
      return { id: ph.id, name: ph.name, spaceGroup: ph.spaceGroup.hermannMauguin, cell: cellOf(refined), sites: ph.sites.map((site) => `${site.label} ${site.element}`) };
    }),
    data: {
      points: xs.length,
      axis: s.pattern.xUnit,
      extent: [sig(s.extent.min, 6), sig(s.extent.max, 6)],
      fitWindow: s.fitRange ? [sig(s.fitRange.min, 6), sig(s.fitRange.max, 6)] : "whole pattern",
      // The same in every unit the page converts to, so no one converts by hand.
      inOtherUnits: Object.fromEntries(
        availableDisplayUnits(s.axis)
          .filter((u) => u !== s.pattern.xUnit)
          .map((u) => {
            const e = convertInterval(s.extent, s.pattern.xUnit, u, s.axis);
            const w = s.fitRange ? convertInterval(s.fitRange, s.pattern.xUnit, u, s.axis) : null;
            return [u, { unit: UNIT[u], extent: [sig(e.min, 5), sig(e.max, 5)], ...(w ? { fitWindow: [sig(w.min, 5), sig(w.max, 5)] } : {}) }];
          }),
      ),
      observations: s.observationCount,
      radiation: s.pattern.radiation.kind,
      // X-ray constants the fit cannot determine (set_instrument_constants); a
      // lab tube's Kα₂ is drawn with every reflection: no misfit and no phase.
      ...(s.pattern.radiation.kind === "xray" ? {
        polarization: s.pattern.radiation.polarization ?? 0.5,
        ...(s.pattern.radiation.kAlpha2 && s.pattern.xUnit === "twoTheta"
          ? { kAlpha2: { wavelength: s.pattern.radiation.kAlpha2.wavelength, ratio: s.pattern.radiation.kAlpha2.ratio, note: "every reflection is drawn at Kα₁ and Kα₂" } }
          : {}),
      } : {}),
    },
    instrument: s.instrument
      ? s.instrument.kind === "constantWavelength"
        ? {
            kind: "constant wavelength",
            wavelength: s.instrument.wavelength,
            ...(s.instrument.asymmetry
              ? { asymmetry: `S/L ${s.instrument.asymmetry.sl}, H/L ${s.instrument.asymmetry.hl} in the file — ${s.settings.corrections.asymmetry ? "on" : "off until set_corrections switches it on, which seeds it from these"}` }
              : {}),
          }
        : { kind: "time of flight", difC: s.instrument.difC, difA: s.instrument.difA ?? 0, zero: s.instrument.zero ?? 0, note: "TOF = difC·d + difA·d² + zero; set_fit_range and find_unexplained_peaks convert for you" }
      : "none loaded (default CW, λ = 1.54 Å)",
    settings: {
      ...s.settings,
      profileShape: s.profile.shape,
      ...(s.restraints.length > 0 ? { occupancyRestraints: s.restraints.map((r) => `${r.label} (${r.terms.map((t) => t.parameterId).join(", ")})`) } : {}),
    },
    magneticModel: s.magnetic
      ? { propagation: s.magnetic.propagation, moments: s.magnetic.moments.length, refined: s.parameters.some((p) => p.kind === "momentMode") }
      : null,
    wR: pct(s.wR),
    ...phaseFractionView(s),
    lastRefinement: s.result
      ? {
          status: s.result.status,
          wR: pct(s.result.agreement.rWeighted ?? 0),
          gof: s.result.agreement.goodnessOfFit !== undefined ? sig(s.result.agreement.goodnessOfFit, 4) : null,
          rExpected: s.result.agreement.rExpected !== undefined ? pct(s.result.agreement.rExpected) : null,
          iterations: s.result.history.length,
          ...(s.result.diagnostics ? { maxShiftOverEsd: sig(s.result.diagnostics.maxShiftOverEsd, 3), atBounds: s.result.diagnostics.atBounds.map((b) => b.parameterId) } : {}),
          ...(s.result.message ? { message: s.result.message } : {}),
        }
      : null,
    ...parameterSummary(s.parameters, s.result?.esd, select),
    history: historyView(history),
  };
}

// ── analysis helpers ────────────────────────────────────────────────────────

/** Multi-phase, after a refinement: each phase's weight fraction from its scale. */
function phaseFractionView(s: PowderLiveState): Record<string, unknown> {
  if (!s.result || s.extraPhases.length === 0) return {};
  const fractions = fractionsOf(s.refinedPhases, s.parameters, s.result);
  if (!fractions) return {};
  return {
    phaseFractions: {
      weight: fractions.map((f) => ({ phase: f.name, wtPercent: sig(f.weightPercent, 4), ...(f.esd !== undefined ? { esd: sig(f.esd, 2) } : {}), shown: formatWt(f) })),
      basis: "Hill & Howard, from the refined scales, cell masses and volumes: of the crystalline phases in the model only; no microabsorption (Brindley) correction, esds from the scale esds alone.",
    },
  };
}

const UNIT: Record<PowderXUnit, string> = { tof: "µs (TOF)", twoTheta: "° 2θ", dSpacing: "Å (d)", q: "Å⁻¹ (Q)" };

/** The data's ends read on the page's curves: every phase's reflections placed on the pattern's own axis. */
export function fitRangeReading(s: PowderLiveState): DataRangeReading {
  const unit = s.pattern.xUnit;
  const x = s.curves.x;
  const points = s.pattern.points.length === x.length ? s.pattern.points : null;
  const sigma = s.curves.yObs.map((y, i) => {
    const given = points?.[i]?.sigma;
    return given !== undefined && given > 0 ? given : Math.sqrt(Math.max(y, 1));
  });
  let reflections: number[] = [];
  if (s.d) {
    const finite = s.d.filter((v) => Number.isFinite(v) && v > 0);
    const dMin = Math.min(...finite) * 0.98;
    const dMax = Math.max(...finite) * 1.02;
    reflections = s.refinedPhases.flatMap((ph) => generateReflections(ph.cell, ph.spaceGroup, dMin, Math.min(dMax, 50), { absences: true }).map((r) => convertAxisValue(r.d, "dSpacing", unit, s.axis)));
  }
  return inspectDataRange({
    x,
    yObs: s.curves.yObs,
    sigma,
    yCalc: s.curves.yCalc,
    ...(s.curves.yBackground ? { yBackground: s.curves.yBackground } : {}),
    fitted: s.result?.status === "converged",
    reflections: reflections.filter(Number.isFinite),
    shortD: unit === "tof" || unit === "dSpacing" ? "low" : "high",
    excluded: excludedPointMask(s.curves.yObs),
    window: s.fitRange,
  });
}

/** check_fit_range's answer: each end with its evidence, and the window to propose, in the data's unit and in d. */
function fitRangeView(s: PowderLiveState, r: DataRangeReading): Record<string, unknown> {
  const unit = s.pattern.xUnit;
  const dOf = (v: number): number | null => {
    if (unit === "dSpacing") return sig(v, 4);
    const d = convertAxisValue(v, unit, "dSpacing", s.axis);
    return Number.isFinite(d) ? sig(d, 4) : null;
  };
  // Which end is which on this axis, in words a crystallographer uses.
  const name = (end: "low" | "high"): string => (unit === "tof" ? (end === "low" ? "short-TOF end (short d)" : "long-TOF end (long d)") : unit === "twoTheta" ? (end === "low" ? "low-angle end" : "high-angle end") : `${end} end`);
  const endView = (e: DataEnd): Record<string, unknown> => ({
    end: name(e.end),
    verdict: e.verdict === "trim" ? "trim" : e.alreadyOutside ? "keep: the fit window already leaves the stretch out" : "keep",
    ...(e.alreadyOutside ? { outside: true } : {}),
    ...(e.cut !== undefined ? { cut: sig(e.cut, 6), cutD: dOf(e.cut), pointsLeftOut: e.dropped } : {}),
    ...(e.large ? { large: "a large cut: put it to the user before applying it" } : {}),
    findings: e.findings.map((f) => `${f.cause}: ${sig(Math.min(f.from, f.to), 6)}–${sig(Math.max(f.from, f.to), 6)} (${f.points} points): ${f.detail}`),
    ...(e.notes.length ? { notes: e.notes } : {}),
  });
  const p = r.proposed;
  return {
    unit: UNIT[unit],
    extent: [sig(r.extent.min, 6), sig(r.extent.max, 6)],
    window: s.fitRange ? [sig(s.fitRange.min, 6), sig(s.fitRange.max, 6)] : "the whole pattern",
    basis: r.basis === "the data" ? "the data alone (no converged fit yet: run this again after the first refinement, when the residual can show more)" : "the data and the converged fit's residual",
    low: endView(r.low),
    high: endView(r.high),
    proposed: p
      ? { min: sig(p.min, 6), max: sig(p.max, 6), unit, d: [dOf(p.min), dOf(p.max)], apply: "set_fit_range with this min and max (and unit) — it shows the user an approval card; say why, end by end" }
      : "keep the current window: neither end needs trimming",
    ...(r.interior.length ? { interior: r.interior, interiorNote: "The page fits one window; it cannot leave out a stretch inside the pattern. Tell the user if one matters." } : {}),
  };
}

/**
 * The window set_fit_range asks for, on the pattern's own axis. min/max may
 * come in any unit the page can convert to; a bound left out is the pattern's
 * edge. Conversions can reverse order (Q ↔ d), so the result is sorted.
 */
function requestedWindow(s: PowderLiveState, input: Input): { min: number; max: number } {
  const native = s.pattern.xUnit;
  const unit = (input.unit as PowderXUnit | undefined) ?? native;
  const units = availableDisplayUnits(s.axis);
  if (!units.includes(unit)) throw new Error(`this pattern cannot be read in ${unit}: it converts to ${units.join(", ")} (load the instrument file for its calibration)`);
  const edges = unit === native ? s.extent : convertInterval(s.extent, native, unit, s.axis);
  const lo = input.min ?? edges.min;
  const hi = input.max ?? edges.max;
  if (!(hi > lo)) throw new Error(`the window needs max > min (got ${lo}–${hi} ${UNIT[unit]})`);
  if (unit === native) return { min: lo, max: hi };
  const w = convertInterval({ min: lo, max: hi }, unit, native, s.axis);
  if (!Number.isFinite(w.min) || !Number.isFinite(w.max)) throw new Error(`${lo}–${hi} ${UNIT[unit]} does not convert to ${UNIT[native]} on this pattern`);
  return w;
}

/**
 * The pattern's strongest peaks against the structure's reflections: one
 * factor on every d that indexes them where 1 does not is a wrong wavelength
 * (or TOF difC), named with the value it implies. Null when 1 indexes them.
 */
export function scaleReading(s: PowderLiveState): string | null {
  if (!s.d || s.structure.sites.length === 0) return null;
  const peaks = observedPeaks(s.d, s.pattern.points.map((p) => p.yObs), s.pattern.points.map((p) => p.sigma ?? 0));
  const r = dScaleSearch(peaks, generateReflections(s.structure.cell, s.structure.spaceGroup, 0.4, 50).map((x) => x.d));
  if (!wrongScale(r)) return null;
  const f = r.factor;
  const pctOf = (v: number): string => `${Math.round(100 * v)} %`;
  const lambda = s.pattern.xUnit === "twoTheta" ? (s.instrument?.kind === "constantWavelength" ? s.instrument.wavelength : s.pattern.radiation.kind !== "neutron-tof" ? s.pattern.radiation.wavelength : undefined) : undefined;
  const cause = s.pattern.xUnit === "tof"
    ? `a wrong difC (the calibration would be difC × ${(1 / f).toFixed(4)})`
    : lambda !== undefined
      ? `a wrong wavelength: the data would be at λ ${(lambda / f).toFixed(4)} Å, not ${lambda} Å`
      : "a wrong wavelength or calibration";
  return `The pattern's ${r.peaks} strongest peaks index the structure's cell with every d × ${f.toFixed(4)} (${pctOf(r.indexed)} of their height; at × 1, ${pctOf(r.indexedAtOne)}): one factor on every line is ${cause} — or the wrong cell for this phase. Ask the user to confirm before anything else: no refinement fixes it, and a refined cell would absorb it.`;
}

/**
 * The cell the peaks give against the structure's. Every length scaled by
 * one factor is what a wrong wavelength (or a wrong TOF difC) does to every
 * d, more often than a wrong cell; lengths moving apart are the phase, its
 * temperature or its composition. Null when the cell agrees within 0.5 %.
 */
export function cellShiftReading(loaded: UnitCell, found: UnitCell, unit: PowderLiveState["pattern"]["xUnit"]): string | null {
  const rel = (["a", "b", "c"] as const).map((k) => found[k] / loaded[k] - 1);
  const worst = Math.max(...rel.map(Math.abs));
  if (worst <= 0.005) return null;
  const spread = Math.max(...rel) - Math.min(...rel);
  const pctText = (v: number): string => `${v > 0 ? "+" : ""}${(100 * v).toFixed(2)} %`;
  const what = unit === "tof" ? "the TOF calibration (difC)" : unit === "twoTheta" ? "the wavelength" : "the d scale";
  if (spread <= 0.1 * worst) {
    const mean = rel.reduce((t, v) => t + v, 0) / 3;
    return `The peaks give a cell ${pctText(mean)} off the structure's in every length alike (a ${pctText(rel[0]!)}, b ${pctText(rel[1]!)}, c ${pctText(rel[2]!)}): one factor on every d is what a wrong ${unit === "twoTheta" ? "wavelength" : "calibration"} does. Ask the user to confirm ${what} before refining: a refined cell would absorb it silently.`;
  }
  return `The peaks give a cell up to ${pctText(rel[rel.map(Math.abs).indexOf(worst)]!)} off the structure's (a ${pctText(rel[0]!)}, b ${pctText(rel[1]!)}, c ${pctText(rel[2]!)}), unevenly: the phase at another temperature or composition, or another phase. Say so before refining.`;
}

/**
 * Whether the data's axis can be what the file says: the structure's
 * reflections against the extent. A 2θ axis that holds next to none of them
 * (d-spacings, or Q, read as degrees: 0.6–5 "°") is the commonest swapped
 * unit; null when the axis holds the reflections a pattern of it should.
 */
export function axisPlausibility(s: PowderLiveState): string | null {
  if (s.structure.sites.length === 0 || s.pattern.points.length === 0 || !s.d) return null;
  const finite = s.d.filter((v) => Number.isFinite(v) && v > 0);
  if (finite.length === 0) return `the ${UNIT[s.pattern.xUnit]} axis (${sig(s.extent.min, 4)}–${sig(s.extent.max, 4)}) converts to no d-spacing at this wavelength: is the axis in another unit (d in Å, or Q)? Ask the user before anything else.`;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const inside = generateReflections(s.structure.cell, s.structure.spaceGroup, lo, Math.min(hi, 50)).length;
  if (inside >= 3) return null;
  return `the ${UNIT[s.pattern.xUnit]} axis (${sig(s.extent.min, 4)}–${sig(s.extent.max, 4)}) spans d ${sig(lo, 3)}–${sig(hi, 3)} Å at this wavelength, where the structure has ${inside === 0 ? "no reflection" : `only ${inside} reflection${inside === 1 ? "" : "s"}`}: the axis is likely in another unit (d in Å or Q read as ${UNIT[s.pattern.xUnit]}), or the wavelength is wrong. Ask the user before refining: no refinement fixes it.`;
}

/** The residual of the fit on screen (core/diagnostics/powderResidual.ts, as the MCP tools build it). */
function residualOf(s: PowderLiveState): PowderResidual {
  if (!s.d) throw new Error("this pattern's axis cannot be converted to d-spacing (no wavelength or TOF calibration)");
  return powderResidual({ curves: s.curves, d: s.d, pattern: s.pattern, phases: s.refinedPhases, fitRange: s.fitRange, magnetic: s.magnetic }).residual;
}

/** The numbers the Agent quotes by reference on the powder page ({{Rwp}}, {{GoF}}, {{verdict}}; {{p:ID}} for any row). */
export function powderReferences(s: PowderLiveState): ReferenceEntry[] {
  const r = (): RefinementResult["agreement"] | null => s.result?.agreement ?? null;
  const percent = (v: number | undefined): string | null => (v === undefined ? null : `${pct(v)} %`);
  return [
    { key: "Rwp", what: "Rwp (%) of the curves on screen", value: () => `${pct(s.wR)} %` },
    { key: "wR", what: "the same Rwp (%)", value: () => `${pct(s.wR)} %` },
    { key: "Rp", what: "Rp (%), the last refinement", value: () => percent(r()?.rFactor) },
    { key: "Rexp", what: "the expected Rwp (%), the last refinement", value: () => percent(r()?.rExpected) },
    { key: "GoF", what: "the goodness of fit Rwp/Rexp, the last refinement", value: () => (r()?.goodnessOfFit !== undefined ? String(sig(r()!.goodnessOfFit!, 3)) : null) },
    { key: "chi2", what: "the reduced χ² (GoF²), the last refinement", value: () => (r()?.goodnessOfFit !== undefined ? String(sig(r()!.goodnessOfFit! ** 2, 3)) : null) },
    { key: "verdict", what: "the engine's verdict on the last refinement (its band)", value: () => (s.result ? assessment(s).verdict.band : null) },
  ];
}

function assessment(s: PowderLiveState): ReturnType<typeof assess_refinement> {
  if (!s.result) throw new Error("there is no refinement result on screen — refine first (a model change clears the last result)");
  return assess_refinement({
    result: s.result,
    parameters: [...s.parameters],
    observationCount: s.observationCount,
    ...(s.d ? { residual: residualOf(s) } : {}),
    mode: "powder",
    restraints: s.restraints,
    sharedSiteAdps: sharedSiteAdps(s),
  });
}

/** ADP parameters bound to two or more sites: a shared (mixed) site's tied ADP. */
function sharedSiteAdps(s: PowderLiveState): string[] {
  const sites = new Map<string, Set<string>>();
  for (const b of s.bindings) {
    if ((b.kind === "bIso" || b.kind === "uAniso") && b.targetKey) sites.set(b.parameterId, (sites.get(b.parameterId) ?? new Set()).add(`${b.targetId}/${b.targetKey}`));
  }
  return [...sites].filter(([, set]) => set.size > 1).map(([id]) => id);
}

/** diagnose_fit: the residual read cause by cause (core/diagnostics/fitDiagnosis.ts). */
const WIDTH_KINDS = ["profileU", "profileV", "profileW", "profileX"] as const;

/** diagnose_fit's action for ± lobes once the width terms are free and the widths agree. */
function shapeLeft(ratio: number, lorentzian: boolean): string {
  return `The Caglioti U, V, W${lorentzian ? " and the Lorentzian X" : ""} are already free and the line widths agree (observed/calculated ${sig(ratio, 3)}): what is left is a shape the profile does not follow, not a width. Read the worst reflections: lobes on one side at low angle are axial-divergence asymmetry (set_corrections asymmetry); some hkl broader than others are anisotropic broadening (set_microstrain); lobes that change side from peak to peak, at a few % of the peak, are the limit of the profile function — say so, and read the esds as too small by the Durbin–Watson factor rather than adding parameters.`;
}

function fitDiagnosisView(s: PowderLiveState): Record<string, unknown> {
  if (!s.d) throw new Error("this pattern's axis cannot be converted to d-spacing (no wavelength or TOF calibration)");
  const curves = s.curves;
  const points = s.pattern.points.length === curves.x.length ? s.pattern.points : null;
  const sigma = curves.yObs.map((y, i) => {
    const given = points?.[i]?.sigma;
    return given !== undefined && given > 0 ? given : Math.sqrt(Math.max(y, 1));
  });
  const excluded = excludedPointMask(curves.yObs);
  const include = curves.x.map((x, i) => !excluded[i] && (!s.fitRange || (x >= s.fitRange.min && x <= s.fitRange.max)));
  const reflections = powderReflectionObsCalc(s.structure, s.pattern, [...s.parameters], [...s.bindings], s.profile, s.magnetic, s.fitRange, s.extraPhases, "rietveld", {
    yCalc: [...curves.yCalc], sigma, include,
  });
  const dx = diagnoseFit({
    x: curves.x, yObs: curves.yObs, yCalc: curves.yCalc,
    ...(curves.yBackground && curves.yBackground.length === curves.x.length ? { yBackground: curves.yBackground } : {}),
    sigma, include,
    nParams: s.parameters.filter((p) => !p.fixed && !p.expression).length,
    d: s.d,
    reflections,
    cells: s.refinedPhases.map((p) => p.cell),
    twoTheta: s.pattern.xUnit === "twoTheta",
    xOf: (d) => convertAxisValue(d, "dSpacing", s.pattern.xUnit, s.axis),
  });
  const v = dx.validation;
  // "Free the widths" is no advice once they are free and the widths agree: what is left is the shape.
  const freeKinds = new Set(s.parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.kind));
  const present = WIDTH_KINDS.filter((k) => s.parameters.some((p) => p.kind === k));
  const widthsDone = present.includes("profileU") && present.every((k) => freeKinds.has(k)) && !!dx.width && Math.abs(dx.width.median - 1) <= 0.1;
  return {
    reading: dx.reading,
    causes: dx.causes.map((c) => ({
      cause: c.id, chi2Share: pct(c.share), evidence: c.evidence,
      action: c.id === "peak-shape" && widthsDone ? shapeLeft(dx.width!.median, present.includes("profileX")) : c.action,
    })),
    agreement: {
      rwp: pct(v.agreement.rwp), rexp: pct(v.agreement.rexp), gof: sig(v.agreement.gof, 3),
      ...(v.agreement.rwpBkg !== undefined ? { rwpBackgroundSubtracted: pct(v.agreement.rwpBkg) } : {}),
      ...(v.durbinWatson ? { durbinWatson: sig(v.durbinWatson.d, 3), durbinWatsonCritical: sig(v.durbinWatson.qd, 3) } : {}),
    },
    ...(dx.betweenPeaks ? { betweenPeaks: { chi2Share: pct(dx.betweenPeaks.share), chi2PerPoint: sig(dx.betweenPeaks.chi2PerPoint, 3), points: dx.betweenPeaks.points } } : {}),
    ...(dx.width ? { lineWidths: { observedOverCalculated: sig(dx.width.median, 3), lowerThird: sig(dx.width.low, 3), upperThird: sig(dx.width.high, 3), isolatedLines: dx.width.lines, ...(dx.width.etaObs !== undefined && dx.width.etaCalc !== undefined && widthsComparable(dx.width) ? { lorentzianFraction: { observed: sig(dx.width.etaObs, 2), calculated: sig(dx.width.etaCalc, 2), lines: dx.width.shapeLines } } : {}) } } : {}),
    dShells: v.shells.map((sh) => ({ d: `${sig(Math.min(sh.lo, sh.hi), 3)}–${sig(Math.max(sh.lo, sh.hi), 3)} Å`, chi2PerPoint: sig(sh.chi2PerPoint, 3), chi2Share: pct(sh.share) })),
    worstReflections: dx.worst.map((w) => ({
      hkl: `${w.phase ? `${w.phase} ` : ""}${w.hkl}`, d: sig(w.d, 4), [s.pattern.xUnit]: sig(w.x, 5), chi2Share: pct(w.share),
      misfit: w.signature === "shape" ? `shape (residual ${w.lobe > 0 ? "on the high" : "on the low"}-${s.pattern.xUnit === "twoTheta" ? "angle" : "x"} side)` : w.signature === "under" ? "calculated too weak" : "calculated too strong",
    })),
    ...(dx.wilson ? { intensityFalloff: { deltaB: sig(dx.wilson.deltaB, 3), r: sig(dx.wilson.r, 2), reflections: dx.wilson.n } } : {}),
    ...(dx.texture ? { textureTest: { axis: dx.texture.axis.join(" "), r: sig(dx.texture.r, 2), reflections: dx.texture.n } } : {}),
  };
}

/** What diagnosisText reads of diagnose_fit's answer. */
export interface DiagnosisView {
  readonly reading: string;
  readonly causes: readonly { readonly cause: string; readonly chi2Share: number; readonly evidence: string }[];
  readonly worstReflections?: readonly { readonly hkl: string; readonly d: number; readonly chi2Share: number; readonly misfit: string }[];
}

/**
 * diagnose_fit's answer as the report gives it: the reading, each cause with
 * its share of χ² and its evidence, and the three worst reflections. The
 * report's check on the fit on screen, and the record of each earlier
 * diagnosis (by the step it read).
 */
export function diagnosisText(dx: DiagnosisView): string {
  const worst = (dx.worstReflections ?? []).slice(0, 3);
  return `${dx.reading}${dx.causes.map((c) => ` ${c.cause} (${c.chi2Share} % of χ²): ${c.evidence}.`).join("")}` +
    (worst.length > 0 ? ` Worst reflections: ${worst.map((w) => `${w.hkl} (d ${w.d} Å, ${w.chi2Share} % of χ², ${w.misfit})`).join("; ")}.` : "");
}

/**
 * The engine's checks of the fit on screen, for the Agent's report: the
 * convergence, the agreement verdict, correlations, bounds, the residual
 * peaks, the serial correlation of the residual, the bond-valence sums and
 * the assessment's other findings (reportChecks.ts).
 */
export function powderReportChecks(s: PowderLiveState, probe: RefinementResult | null = null): ReportCheck[] {
  if (!s.result || s.structure.sites.length === 0) return [noResultCheck()];
  const a = assessment(s);
  const checks: ReportCheck[] = [
    convergenceCheck(s.result),
    verdictCheck(a),
    probe ? correlationsCheck(probe, s.parameters, s.restraints) : correlationsCheck(s.result, s.parameters, s.restraints, CORRELATION_LISTED),
    boundsCheck(s.result, s.parameters),
  ];
  if (s.d) {
    const { between, beside, onReflection } = residualPeaks(residualOf(s), { limit: 12 });
    const list = (ps: readonly { d: number }[]): string => ps.slice(0, 6).map((p) => p.d.toFixed(4)).join(", ") + (ps.length > 6 ? ", …" : "");
    const misfits = [...onReflection, ...beside].sort((x, y) => y.height - x.height);
    checks.push(between.length > 0
      ? { name: "Residual peaks", status: "warn", detail: `${between.length} peak${between.length === 1 ? "" : "s"} on no phase's reflection, 5σ above the noise: d = ${list(between)} Å — intensity no phase in the model accounts for.${misfits.length > 0 ? ` ${misfits.length} more on or beside the model's reflections (misfits).` : ""}` }
      : misfits.length > 0
        ? { name: "Residual peaks", status: "note", detail: `No extra peak. ${misfits.length} residual peak${misfits.length === 1 ? "" : "s"} on or beside the model's reflections (intensity or shape misfits): d = ${list(misfits)} Å.` }
        : { name: "Residual peaks", status: "pass", detail: "No residual peak stands 5σ above its own noise." });
  }
  // The serial correlation of the residual: a systematic misfit makes the esds optimistic.
  const points = s.pattern.points.length === s.curves.x.length ? s.pattern.points : null;
  const sigma = s.curves.yObs.map((y, i) => {
    const given = points?.[i]?.sigma;
    return given !== undefined && given > 0 ? given : Math.sqrt(Math.max(y, 1));
  });
  const excluded = excludedPointMask(s.curves.yObs);
  const include = s.curves.x.map((x, i) => !excluded[i] && (!s.fitRange || (x >= s.fitRange.min && x <= s.fitRange.max)));
  const v = powderValidation({ x: s.curves.x, yObs: s.curves.yObs, yCalc: s.curves.yCalc, sigma, include, nParams: s.parameters.filter((p) => !p.fixed && !p.expression).length });
  if (v.durbinWatson) {
    const dw = v.durbinWatson;
    checks.push(dw.correlated
      ? { name: "Serial correlation", status: "note", detail: `Durbin–Watson d = ${dw.d.toFixed(2)}, below Q_D = ${dw.qd.toFixed(2)}: neighbouring residuals correlate (a systematic misfit of the profile or the model), so the esds — and a posterior's intervals — are optimistic.` }
      : { name: "Serial correlation", status: "pass", detail: `Durbin–Watson d = ${dw.d.toFixed(2)} (Q_D = ${dw.qd.toFixed(2)}): no significant serial correlation of the residuals.` });
  }
  const bv = bondValenceCheck(s.refinedPhases);
  if (bv) checks.push(bv);
  // The fit's diagnosis, as diagnose_fit gives it on the fit on screen: an
  // account that cites it ("the lines are 2.45× broader") cites the report.
  if (s.d) {
    const dx = fitDiagnosisView(s) as unknown as DiagnosisView;
    checks.push({ name: "Fit diagnosis", status: dx.causes.length > 0 ? "note" : "pass", detail: diagnosisText(dx) });
  }
  checks.push(...findingChecks(a));
  return checks;
}

/**
 * What the cell check's shoulders mean: tails of a profile the Le Bail fit
 * draws simply, not a phase. Shoulders at one common offset from their lines
 * are the instrument's; the Rietveld profile is the place to fit them.
 */
export function shoulderReading(shoulders: readonly { x: number; of: string; offset: number; relativeHeight: number }[], unit: string): string {
  const n = shoulders.length;
  const at = (x: number): string => (unit === "twoTheta" ? `${x.toFixed(2)}°` : `${x.toFixed(4)} ${unit}`);
  const list = shoulders.slice(0, 4).map((sh) => `${at(sh.x)} beside ${sh.of}, ${(100 * sh.relativeHeight).toFixed(1)} %`).join("; ");
  const offsets = shoulders.map((sh) => sh.offset);
  const mean = offsets.reduce((a, b) => a + b, 0) / n;
  const spread = Math.max(...offsets) - Math.min(...offsets);
  const common = n >= 2 && spread <= 0.25 * Math.abs(mean);
  return `${n} shoulder${n === 1 ? "" : "s"} on the flank of a strong line (${list}): the tail of a peak profile the Le Bail fit draws simply, not a missing phase${common ? `; ${n === 2 ? "both sit" : "they sit"} at one offset from their lines (${mean < 0 ? "−" : "+"}${Math.abs(mean).toFixed(2)}${unit === "twoTheta" ? "°" : ` ${unit}`}), an instrumental feature` : ""}. They do not count against the cell. The Rietveld profile (asymmetry, Lorentzian X and Y) fits such tails; look at them again on the refined residual, and name them to the user only if they outlive it.`;
}
