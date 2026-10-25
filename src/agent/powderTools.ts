/**
 * The Agent tools on the powder page: each one reads the live state through
 * the page's port (port.ts) or calls the page's own handler. The analysis
 * tools are the MATERIA MCP handlers (src/mcp/tools.ts) fed from what is on
 * screen, so the Agent and a headless agent judge a fit the same way.
 */

import type { InstrumentConstants, PowderAgentPort, PowderLiveState } from "@/agent/port";
import { liveTool, type InputOf } from "@/agent/tools";
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
import type { CorrectionsUpdate, SiteTies } from "@/app/powderSpec";
import { availableDisplayUnits, convertAxisValue, convertInterval } from "@/visualization/axisUnits";
import { k0MagneticHint, oneCurve, physicalFindings, residualPeaks } from "@/core/diagnostics/assessment";
import { structureChecks } from "@/core/diagnostics/structureChecks";
import { reviewSymmetry } from "@/core/diagnostics/symmetryReview";
import { formatWt, fractionsOf } from "@/core/diagnostics/phaseFractions";
import { fittedPoints, pointSigma, powderResidual, type PowderResidual } from "@/core/diagnostics/powderResidual";
import { unexplainedPeaks, type PeakReading } from "@/core/diagnostics/unexplainedPeaks";
import { diagnoseFit, diagnosisText, durbinWatsonSentence, fitDiagnosisView } from "@/core/diagnostics/fitDiagnosis";
import { backgroundTermsReading } from "@/core/diagnostics/backgroundTerms";
import type { BackgroundType } from "@/core/diffraction/background";
import { identifyPeaks, identifyReading, knownPhaseNames, knownPhaseStructure } from "@/core/diagnostics/knownPhases";
import { withAntisite } from "@/core/crystal/antisite";
import { structureTable } from "@/agent/structureTable";
import { powderReflectionObsCalc } from "@/core/workflow/obsCalc";
import { checkEqualTies, type EqualTieUpdate } from "@/core/refinement/constraints";
import { zeroAdpFixText, zeroAdpOptionIndex } from "@/core/diagnostics/zeroAdp";
import type { CardOptionGroup } from "@/agent/cardOptions";
import { bondsOf, cellOf, historyView, labelOf, matchIds, parameterSummary, pct, sig, type LiveToolHost } from "@/agent/liveCommon";
import { change, freePlan, goToPlan, nothing, refinePlan, resetPlan, type Plans } from "@/agent/pages/plans";
import { powderValidation } from "@/core/diagnostics/powderValidation";
import type { ReportCheck } from "@/core/export/report";
import { CORRELATION_LISTED, bondValenceCheck, boundsCheck, convergenceCheck, correlationsCheck, findingChecks, noResultCheck, verdictCheck } from "@/agent/reportChecks";
import { groupOf, POSITION_KINDS, THERMAL_KINDS } from "@/agent/method";
import { MAGNETIC_PLANS, magneticNext } from "@/agent/magneticTools";
import { cellCheckReading, dScaleReading } from "@/core/diagnostics/cellReading";
import type { DataRangeReading } from "@/core/diagnostics/dataRange";
import { fitRangeView, readFitRange, type FitRangeWords } from "@/core/diagnostics/fitRangeReading";
import { X_UNIT_LABEL, axisPlausibility as axisReading } from "@/core/diagnostics/axisReading";
import type { ReferenceEntry } from "@/agent/references";
import { minMax } from "@/core/math/extent";


/* eslint-disable @typescript-eslint/no-explicit-any -- inputs are validated against the spec's zod schema before a handler runs */
type Input = any;

/** Refuse a tool that needs a structure when only data are loaded. */
export function requireStructure(name: string, s: PowderLiveState): void {
  // On the placeholder they would judge nothing (check_fit_range cuts the window in the gaps between the reflections, and a placeholder has none).
  if (liveTool(name)?.needsStructure && s.structure.sites.length === 0) {
    throw new Error("no structure is loaded: the data sit on an empty placeholder model (no atoms, no reflections). Ask the user to load the CIF of the phase (Load CIF…) before refining or judging anything");
  }
}

/** Run a read or control tool. Returns the JSON result the model sees. */
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
      return fitRangeView(fitRangeReading(s), fitRangeWords(s), s.fitRange);
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
      const reading = cellCheckReading(check, { loaded: s.structure.cell, unit: s.pattern.xUnit, scale, tools: { identify: "identify_peaks", note: "write_note", review: "review_symmetry", prefit: 'refine with mode "thorough"' }, spaceGroup: (s.refinedPhases[0] ?? s.structure).spaceGroup, fitOnScreen: !!s.result });
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
      const span = minMax(finite);
      const id = identifyPeaks(peaks, s.pattern.radiation, { dMin: span.min, dMax: span.max });
      const { candidates } = id;
      const reading = identifyReading(peaks.length, id, { add: "add_known_phase" });
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
      return fitDiagnosisOf(s);
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
 * The page's changes, one plan each (pages/plans.ts): what the approval card
 * says, and the change through the page's own handler. A change that cannot
 * run on this page is refused here, before its card. The magnetic step's
 * changes are the step's own (magneticTools.ts).
 */
export const POWDER_PLANS: Plans<PowderAgentPort> = {
  ...MAGNETIC_PLANS,
  set_free: freePlan,
  set_background: (input, s, port) => {
    // An empty change is an error before anyone is asked.
    if (input.terms === undefined && input.type === undefined) throw new Error("pass `terms`, `type`, or both");
    const caution = input.terms !== undefined ? backgroundTermsCaution(s, input.type ?? s.settings.backgroundType, input.terms) : null;
    const preview = [
      ...(input.terms !== undefined ? [`Background terms ${s.settings.backgroundTerms} → ${String(input.terms)}`] : []),
      ...(input.type !== undefined ? [`Background basis ${s.settings.backgroundType} → ${input.type}`] : []),
      ...(caution ? [caution] : []),
    ].join(" · ");
    return change(preview, () => {
      if (input.terms !== undefined) port.setBackgroundTerms(input.terms);
      if (input.type !== undefined) port.setBackgroundType(input.type);
      return caution ?? undefined;
    });
  },
  set_microstrain: (input, s, port) => change(`Microstrain ${s.settings.mustrain} → ${input.model}`, () => {
    port.setMustrain(input.model);
    return undefined;
  }),
  set_adp_model: (input, s, port) => {
    const want = input.anisotropic ? "anisotropic" : "isotropic";
    if (s.structure.sites.every((site) => site.adp.kind === want)) return nothing(`the ADPs are already ${want}`);
    return change(`ADPs ${s.settings.anisotropicAdp ? "anisotropic" : "isotropic"} → ${want}`, () => {
      port.setAnisotropicAdp(input.anisotropic);
      return undefined;
    });
  },
  set_site_ties: (input, s, port) => {
    const update = siteTieUpdate(input);
    const keys = Object.keys(update) as (keyof SiteTies)[];
    if (keys.length === 0) throw new Error("pass at least one of `positions`, `adp`, `occupancyToUnity`, `composition`");
    if (keys.every((k) => tieOn(s.settings.siteTies, k) === update[k])) return nothing("the site ties are already set so");
    return change(keys.map((k) => `${SITE_TIE_NAMES[k]} ${update[k] ? "on" : "off"}`).join(" · "), () => {
      port.setSiteTies(update);
      return undefined;
    });
  },
  set_corrections: (input, s, port) => {
    const update = correctionUpdate(input);
    if (Object.keys(update).length === 0) throw new Error("pass `asymmetry`, `preferredOrientation`, `peak`, or several");
    if (update.asymmetry && s.pattern.xUnit !== "twoTheta") throw new Error("peak asymmetry (FCJ) is for constant-wavelength 2θ data; a TOF peak's asymmetry is its back-to-back exponentials");
    if (update.asymmetry && s.profile.shape !== "pseudoVoigt") throw new Error("peak asymmetry (FCJ) works on the pseudo-Voigt profile, which needs the instrument's Caglioti U, V, W: ask the user to load the instrument file");
    const now = s.settings.corrections;
    const same = (update.asymmetry === undefined || !!now.asymmetry === update.asymmetry)
      && (update.preferredOrientation === undefined || (update.preferredOrientation === null ? !now.preferredOrientation : now.preferredOrientation?.join() === update.preferredOrientation.join()))
      && (update.peak === undefined || [...update.peak].sort().join() === [...(now.peak ?? [])].sort().join());
    if (same) return nothing("the corrections are already set so");
    const set = handler(port.setCorrections, "this page has no corrections to set");
    const preview = [
      ...(update.asymmetry !== undefined ? [`asymmetry ${update.asymmetry ? "on" : "off"}`] : []),
      ...(update.preferredOrientation !== undefined ? [update.preferredOrientation ? `preferred orientation along ${update.preferredOrientation.join(" ")}` : "preferred orientation off"] : []),
      ...(update.peak !== undefined ? [`peak corrections: ${update.peak.length ? update.peak.join(", ") : "none"}`] : []),
    ].join(" · ");
    return change(preview, () => {
      set(update);
      return undefined;
    });
  },
  add_antisite: (input, s, port) => {
    if (s.extraPhases.length > 0) throw new Error("antisite disorder is added to a single-phase model");
    // Throws for an unknown site, two sites of one element, or a pair already exchanged.
    withAntisite(s.structure, input.siteA, input.siteB);
    const add = handler(port.addAntisite, "this page cannot change its structure");
    const a = s.structure.sites.find((x) => x.label === input.siteA);
    const b = s.structure.sites.find((x) => x.label === input.siteB);
    return change(`Antisite ${input.siteA} ⇄ ${input.siteB}: ${b?.element ?? "?"} on ${input.siteA}, ${a?.element ?? "?"} on ${input.siteB}, at occupancy 0 · Σ occ = 1 and hold composition on`, () => {
      add(input.siteA, input.siteB);
      return undefined;
    });
  },
  add_known_phase: (input, s, port) => {
    const phase = knownPhaseStructure(input.name);
    if (!phase) throw new Error(`"${input.name}" is not in the library — it holds ${knownPhaseNames().join(", ")}; for another phase the user loads its CIF (Add CIF…)`);
    if ([s.structure, ...s.extraPhases].some((p) => p.name === input.name)) return nothing(`${input.name} is already a phase of the model`);
    const add = handler(port.addPhase, "this page cannot add a phase");
    return change(`Add ${phase.name} (${phase.spaceGroup.hermannMauguin ?? "?"}, a = ${phase.cell.a} Å) as a further phase: its scale and cell refine with the others`, () => {
      add(phase);
      return undefined;
    });
  },
  tie_parameters: (input, s, port) => {
    if (input.complement !== undefined || input.adp !== undefined) throw new Error("`complement` and `adp` are the single-crystal page's: here set_site_ties ties a shared site's occupancies (Σ occ = 1) and ADPs");
    const update = tieUpdate(s.parameters, input);
    if (checkEqualTies(s.parameters, update).unchanged) return nothing("those parameters are already tied so");
    const tie = handler(port.setParameterTies, "this page cannot tie parameters");
    const kind = (id: string | undefined): string => (s.parameters.find((p) => p.id === id)?.kind === "occupancy" ? "occupancy" : "B");
    const preview = [
      ...(update.equal ? [`Tie ${update.equal.slice(1).join(", ")} = ${update.equal[0]} (one ${kind(update.equal[0])} refines)`] : []),
      ...(update.release ? [`Release the tie on ${update.release.join(", ")}`] : []),
    ].join(" · ");
    return change(preview, () => {
      tie(update);
      return undefined;
    });
  },
  apply_adp_proposal: (input, s, port) => {
    if (!s.result) throw new Error("there is no refinement result on screen — refine first: the options are read off the last fit's bounds");
    const seen = new Set<string>();
    const picks = input.choose.map((c) => {
      if (seen.has(c.parameter)) throw new Error(`${c.parameter} is chosen twice: one option per row`);
      seen.add(c.parameter);
      const p = s.zeroAdp?.proposals.find((z) => z.parameterId === c.parameter);
      if (!p) throw new Error(`${c.parameter} is not a free B the last fit left on its lower bound (get_state's bAtZero and assess_refinement list the B-at-0 options)`);
      if (p.rule === "C") throw new Error(`${p.atom}: no value is proposed (rule C) — ${p.source.replace(/^rule C: no value /, "")}. Leave it and report it, or ask the user for a value they can cite`);
      const i = zeroAdpOptionIndex(p, c.option);
      if (i < 0) throw new Error(`${p.atom} has no option "${c.option}": its options are ${p.options.map((o) => `"${o.id}" (${o.rank}, ${o.label})`).join(", ")}`);
      const o = p.options[i]!;
      if (o.caution && !c.reason?.trim()) throw new Error(`option "${o.id}" for ${p.atom} ties it to ${o.label.replace(/^same coordination \([^)]*\), /, "a ")}: take it only when it is physically sensible, and say why in \`reason\`; otherwise choose "start" (the starting structure's value) if offered, or leave the B and report it`);
      return { p, i, ...(c.reason?.trim() ? { reason: c.reason.trim() } : {}) };
    });
    const apply = handler(port.applyZeroAdp, "this page cannot apply the B-at-0 rule");
    // The card: every ranked option, the Agent's pick preselected; the user picks another or declines (cardOptions.ts).
    const groups: CardOptionGroup[] = picks.map(({ p, i }) => ({
      id: p.parameterId,
      title: `${p.atom} refined to 0 Å² (its lower bound)`,
      options: p.options.map((o, k) => ({ id: o.id, label: `${k + 1} · ${o.rank}`, detail: o.text })),
      selected: p.options[i]!.id,
    }));
    const preview = picks.map(({ p, i, reason }) => `${p.atom} refined to 0 Å² (its lower bound). The Agent chose option ${i + 1} (${p.options[i]!.rank}): ${p.options[i]!.text}${reason ? ` — its reason: ${reason}` : ""}.${p.options.length > 1 ? ` Other options: ${p.options.map((o, k) => (k === i ? null : `${k + 1}) ${o.rank} — ${o.text}`)).filter(Boolean).join("; ")}.` : ""}`).join(" · ");
    return change(preview, (_host, decision) => {
      // No decision: approved without a card (auto mode), so the Agent's picks apply, recorded as its choice.
      const auto = !decision;
      const chosen = picks.map(({ p, i, reason }) => {
        const picked = decision ? zeroAdpOptionIndex(p, decision.selected[p.parameterId] ?? p.options[i]!.id) : i;
        const j = picked >= 0 ? picked : i;
        return { p, j, choice: { parameterId: p.parameterId, option: j, chosenBy: auto ? ("agent-auto" as const) : ("user" as const), ...(reason && j === i ? { reason } : {}) } };
      });
      apply(chosen.map((c) => c.choice));
      return {
        note: auto ? "Applied in auto mode without a card: the Agent's choice, recorded as such in the History, the notice and the report." : "Applied: the user's selection on the card.",
        data: {
          applied: chosen.map(({ p, j, choice }) => ({
            parameter: p.parameterId,
            option: p.options[j]!.id,
            rank: p.options[j]!.rank,
            applied: p.options[j]!.text,
            chosenBy: auto ? "the Agent, in auto mode (no card)" : "the user, on the card",
            ...(choice.reason ? { reason: choice.reason } : {}),
            notTaken: p.options.filter((_, k) => k !== j).map((o) => `${o.id} (${o.rank}, ${o.label})`),
          })),
          next: "Refine next, and say it in the report (its limitations list it). tie_parameters release or set_free frees the row again; go_to_step undoes it.",
        },
      };
    }, groups);
  },
  set_instrument_constants: (input, s, port) => {
    const update = constantsUpdate(input);
    if (Object.keys(update).length === 0) throw new Error("pass `polarization`, `kAlpha2Ratio`, or both");
    const r = s.pattern.radiation;
    if (r.kind !== "xray" || s.pattern.xUnit !== "twoTheta") throw new Error("the polarization and the Kα₂ ratio are constants of constant-wavelength X-ray data; this pattern is not");
    if (update.kAlpha2Ratio !== undefined && !r.kAlpha2) throw new Error("this instrument has no Kα₂ line (a monochromatic beam): there is no ratio to set");
    const same = (update.polarization === undefined || Math.abs((r.polarization ?? 0.5) - update.polarization) < 1e-9)
      && (update.kAlpha2Ratio === undefined || Math.abs((r.kAlpha2?.ratio ?? 0) - update.kAlpha2Ratio) < 1e-9);
    if (same) return nothing("the instrument constants are already so");
    const set = handler(port.setInstrumentConstants, "this page cannot change its instrument");
    const preview = [
      ...(update.polarization !== undefined ? [`Polarization ${r.polarization ?? 0.5} → ${update.polarization}`] : []),
      ...(update.kAlpha2Ratio !== undefined ? [`Kα₂/Kα₁ ${r.kAlpha2?.ratio ?? "—"} → ${update.kAlpha2Ratio}`] : []),
    ].join(" · ");
    return change(preview, () => {
      set(update);
      return undefined;
    });
  },
  set_fit_range: (input, s, port) => {
    if (input.whole) {
      return change("Fit the whole pattern", () => {
        port.setFitRange(null);
        return undefined;
      });
    }
    const w = requestedWindow(s, input);
    if (w.max < s.extent.min || w.min > s.extent.max) throw new Error(`${sig(w.min, 6)}–${sig(w.max, 6)} ${UNIT[s.pattern.xUnit]} is outside the pattern (${sig(s.extent.min, 6)}–${sig(s.extent.max, 6)})`);
    const native = `${sig(w.min, 6)} – ${sig(w.max, 6)} ${UNIT[s.pattern.xUnit]}`;
    const unit = input.unit ?? s.pattern.xUnit;
    return change(unit === s.pattern.xUnit ? `Fit window ${native}` : `Fit window ${String(input.min ?? "edge")} – ${String(input.max ?? "edge")} ${UNIT[unit]} (${native})`, () => {
      port.setFitRange({ min: Math.max(w.min, s.extent.min), max: Math.min(w.max, s.extent.max) });
      return undefined;
    });
  },
  refine: refinePlan<PowderAgentPort>({
    refuse: (s) => (s.viewOnly ? "this pattern is view-only (a TOF pattern without a TOF profile); load its instrument file to refine it" : null),
    fits: (s, free) => {
      const caution = k0RefineCaution(s);
      return `Refine ${free} free parameter${free === 1 ? "" : "s"}${caution ? ` · ${caution}` : ""}`;
    },
    after: (s) => {
      const caution = k0RefineCaution(s);
      return caution ? [caution] : [];
    },
  }),
  reset_parameters: resetPlan,
  go_to_step: goToPlan,
};

/** A handler the page may not have: refused before the card when it is missing. */
function handler<F>(f: F | undefined, missing: string): F {
  if (!f) throw new Error(missing);
  return f;
}

/** tie_parameters' globs expanded in the order given (so the leader stays first), each id once. */
function tieUpdate(params: readonly RefinementParameter[], input: InputOf<"tie_parameters">): EqualTieUpdate {
  const expand = (list: readonly string[]): string[] => [...new Set(list.flatMap((g) => matchIds(params, [g])))];
  return {
    ...(input.equal ? { equal: expand(input.equal) } : {}),
    ...(input.release ? { release: expand(input.release) } : {}),
  };
}

function constantsUpdate(input: InputOf<"set_instrument_constants">): InstrumentConstants {
  return {
    ...(input.polarization !== undefined ? { polarization: input.polarization } : {}),
    ...(input.kAlpha2Ratio !== undefined ? { kAlpha2Ratio: input.kAlpha2Ratio } : {}),
  };
}

function correctionUpdate(input: InputOf<"set_corrections">): CorrectionsUpdate {
  return {
    ...(input.asymmetry !== undefined ? { asymmetry: input.asymmetry } : {}),
    // The schema holds it to three indices.
    ...(input.preferredOrientation !== undefined ? { preferredOrientation: input.preferredOrientation as [number, number, number] | null } : {}),
    ...(input.peak ? { peak: input.peak } : {}),
  };
}

const SITE_TIE_KEYS = ["positions", "adp", "occupancyToUnity", "composition"] as const;
const SITE_TIE_NAMES: Record<keyof SiteTies, string> = { positions: "tie position", adp: "tie ADP", occupancyToUnity: "Σ occ = 1", composition: "hold composition" };
/** A tie's effective value: positions and ADPs are tied unless switched off. */
const tieOn = (ties: SiteTies, k: keyof SiteTies): boolean => ties[k] ?? (k === "positions" || k === "adp");

function siteTieUpdate(input: InputOf<"set_site_ties">): Partial<Record<keyof SiteTies, boolean>> {
  const update: Partial<Record<keyof SiteTies, boolean>> = {};
  for (const k of SITE_TIE_KEYS) {
    const on = input[k];
    if (on !== undefined) update[k] = on;
  }
  return update;
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
    ...zeroAdpView(s),
    ...parameterSummary(s.parameters, s.result?.esd, select),
    history: historyView(history),
  };
}

// ── analysis helpers ────────────────────────────────────────────────────────

/** The B-at-0 rule on the page: the proposals for B's on their bound (apply_adp_proposal), and the fixes in force. */
function zeroAdpView(s: PowderLiveState): Record<string, unknown> {
  const z = s.zeroAdp;
  if (!z || (z.proposals.length === 0 && z.applied.length === 0)) return {};
  return {
    bAtZero: {
      ...(z.proposals.length > 0 ? { proposed: z.proposals.map((p) => ({ parameter: p.parameterId, rule: p.rule, options: p.options.map((o, i) => ({ option: i + 1, rank: o.rank, ...(o.leader ? { tieTo: o.leader } : {}), ...(o.value !== undefined ? { holdAt: o.value } : {}), label: o.label, ...(o.caution ? { caution: o.caution } : {}) })), warning: p.warning })), choose: "apply_adp_proposal with the option's id per row (\"tie:<row>\" or \"start\"): prefer the same-element tie; a cross-element tie only when physically sensible, with your reason; in doubt the starting value, or leave the B and report it. Asking first, the user sees every option on the card and may pick another or decline; in auto mode your choice applies and is recorded as yours. Rule C has nothing to apply" } : {}),
      ...(z.applied.length > 0 ? { applied: z.applied.map((f) => zeroAdpFixText(f)) } : {}),
    },
  };
}

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

const UNIT = X_UNIT_LABEL;

/** The data's ends read on the page's curves: every phase's reflections placed on the pattern's own axis. */
export function fitRangeReading(s: PowderLiveState): DataRangeReading {
  return readFitRange({
    unit: s.pattern.xUnit,
    x: s.curves.x,
    yObs: s.curves.yObs,
    sigma: pointSigma(s.curves.yObs, s.pattern.points),
    yCalc: s.curves.yCalc,
    ...(s.curves.yBackground ? { yBackground: s.curves.yBackground } : {}),
    fitted: s.result?.status === "converged",
    d: s.d,
    phases: s.refinedPhases,
    xOf: (d) => convertAxisValue(d, "dSpacing", s.pattern.xUnit, s.axis),
    window: s.fitRange,
  });
}

/** How check_fit_range's answer is worded on the page: the window applied with set_fit_range. */
function fitRangeWords(s: PowderLiveState): FitRangeWords {
  const unit = s.pattern.xUnit;
  return {
    unit,
    dOf: (x) => (unit === "dSpacing" ? x : convertAxisValue(x, unit, "dSpacing", s.axis)),
    apply: "set_fit_range with this min and max (and unit) — it shows the user an approval card; say why, end by end",
  };
}

/**
 * The window set_fit_range asks for, on the pattern's own axis. min/max may
 * come in any unit the page can convert to; a bound left out is the pattern's
 * edge. Conversions can reverse order (Q ↔ d), so the result is sorted.
 */
function requestedWindow(s: PowderLiveState, input: InputOf<"set_fit_range">): { min: number; max: number } {
  const native = s.pattern.xUnit;
  const unit = input.unit ?? native;
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

/** The d-scale reading (core/diagnostics/cellReading.ts) of the page's pattern. */
export function scaleReading(s: PowderLiveState): string | null {
  return s.d ? dScaleReading(s.d, s.pattern, s.structure, s.instrument ?? undefined) : null;
}

/** Whether the data's axis can be what the file says (core/diagnostics/axisReading.ts). */
export function axisPlausibility(s: PowderLiveState): string | null {
  return s.pattern.points.length === 0 ? null : axisReading({ unit: s.pattern.xUnit, extent: s.extent, d: s.d, structure: s.structure });
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
    structures: s.refinedPhases,
    ...(s.zeroAdp ? { zeroAdp: s.zeroAdp } : {}),
  });
}

/**
 * The physical checks after a refinement (the user's rule: every run with
 * free parameters is assessed): the structures (distances, bond-valence
 * lengths, U's range and order), the parameters (a negative U), and the
 * correlations below the refusal limit, which are reported, never silent.
 * A hard failure is put to the user before anything else.
 */
export function refineChecks(s: PowderLiveState): Record<string, unknown> {
  if (!s.result) return {};
  const many = s.refinedPhases.length > 1;
  const found = [...physicalFindings(s.parameters), ...s.refinedPhases.flatMap((m) => structureChecks(m, many ? m.name || m.id : undefined))];
  const hard = found.filter((f) => f.severity === "critical").map((f) => f.summary);
  // A B the fit left on its bound: the B-at-0 rule's proposal, never applied without the user (apply_adp_proposal).
  const warnings = [...found.filter((f) => f.severity === "warning").map((f) => f.summary), ...(s.zeroAdp?.proposals ?? []).map((p) => p.warning)];
  const kind = new Map(s.parameters.map((p) => [p.id, p.kind]));
  const correlations = (s.result.diagnostics?.moderateCorrelations ?? [])
    .filter((c) => !oneCurve(kind.get(c.parameterIdA), kind.get(c.parameterIdB)))
    .slice(0, 4)
    .map((c) => `${labelOf(s.parameters, c.parameterIdA)} ↔ ${labelOf(s.parameters, c.parameterIdB)} ${sig(c.coefficient, 2)}`);
  if (hard.length === 0 && warnings.length === 0 && correlations.length === 0) return { checks: "distances, bonds and U within the limits" };
  return {
    checks: {
      ...(hard.length ? { hard, action: "A hard failure: take this run back (go_to_step to the step before it) and put it to the user before going on." } : {}),
      ...(warnings.length ? { warnings } : {}),
      ...(correlations.length ? { correlations, note: "below the refusal limit: refined, and reported with their coefficients" } : {}),
    },
  };
}

/** ADP parameters bound to two or more sites: a shared (mixed) site's tied ADP. */
function sharedSiteAdps(s: PowderLiveState): string[] {
  const sites = new Map<string, Set<string>>();
  for (const b of s.bindings) {
    if ((b.kind === "bIso" || b.kind === "uAniso") && b.targetKey) sites.set(b.parameterId, (sites.get(b.parameterId) ?? new Set()).add(`${b.targetId}/${b.targetKey}`));
  }
  return [...sites].filter(([, set]) => set.size > 1).map(([id]) => id);
}

/**
 * set_background's caution on more terms, read on the fit on screen
 * (backgroundTerms.ts): the excess between the lines no reflection explains,
 * which a more flexible background would absorb, and the count the points
 * between the lines justify. Null when the count does not grow, or nothing
 * stands against it.
 */
function backgroundTermsCaution(s: PowderLiveState, type: BackgroundType, terms: number): string | null {
  const c = s.curves;
  if (!s.d || terms <= s.settings.backgroundTerms || !c.yBackground || c.yBackground.length !== c.x.length) return null;
  const reading = backgroundTermsReading({
    x: c.x, yObs: c.yObs, yCalc: c.yCalc, yBackground: c.yBackground,
    sigma: pointSigma(c.yObs, s.pattern.points), include: fittedPoints(c.x, c.yObs, s.fitRange), d: s.d, type,
  });
  if (!reading) return null;
  const parts = [
    ...(reading.excess.length > 0
      ? [`more terms can absorb the excess between the lines that no reflection explains, at d = ${reading.excess.slice(0, 4).map((e) => e.d.toFixed(3)).join(", ")} Å (find_unexplained_peaks)`]
      : []),
    ...(terms > reading.justified ? [`the ${reading.points} points between the lines justify ${reading.justified} (BIC${reading.excess.length > 0 ? ", the excess left out" : ""})`] : []),
  ];
  return parts.length > 0 ? `Caution: ${parts.join("; ")}` : null;
}

/**
 * The k = 0 magnetic signature on the fit on screen, as find_unexplained_peaks
 * reads it (k0Magnetic): a neutron pattern of magnetic ions with no magnetic
 * model, whose misfits on nuclear reflections sit at large d.
 */
function k0Signature(residual: PowderResidual): boolean {
  return k0MagneticHint(residual.magneticNeutron, residualPeaks(residual, { limit: 12 }).onReflection);
}

/**
 * refine's caution when it frees B's or positions against a k = 0 signature:
 * on a simulated k = 0 pattern (Mn₃Ga 30 K, Example 3) the method's ADP stage
 * on the nuclear model alone left the B's 3–6× too large and the scale 50 %
 * too large, and its verdict "good" (docs/LIMITATIONS.md). A caution, not a
 * refusal: the order is the user's method.
 */
function k0RefineCaution(s: PowderLiveState): string | null {
  if (!s.result || s.magnetic) return null;
  const atoms = s.parameters.some((p) => !p.fixed && !p.expression && (THERMAL_KINDS.has(p.kind) || POSITION_KINDS.has(p.kind)));
  if (!atoms || !s.d || !k0Signature(residualOf(s))) return null;
  return "Caution: the residual carries the k = 0 magnetic signature (a neutron pattern of magnetic ions, its misfits on nuclear reflections at large d: find_unexplained_peaks' k0Magnetic) and no magnetic model is on the page. B's and positions refined now take up the magnetic intensity (on a simulated k = 0 pattern the B's came out 3–6× too large). Unless the sample is not ordered, check k = 0 in the magnetic step first (magnetic_state) and refine them with the moments.";
}

/** The Caglioti terms and the Lorentzian X: diagnose_fit reads the shape, not the width, once those present are all free. */
const WIDTH_KINDS = ["profileU", "profileV", "profileW", "profileX"] as const;

/** diagnose_fit: the residual read cause by cause (core/diagnostics/fitDiagnosis.ts), on the page's curves. */
function fitDiagnosisOf(s: PowderLiveState): ReturnType<typeof fitDiagnosisView> {
  if (!s.d) throw new Error("this pattern's axis cannot be converted to d-spacing (no wavelength or TOF calibration)");
  const curves = s.curves;
  const sigma = pointSigma(curves.yObs, s.pattern.points);
  const include = fittedPoints(curves.x, curves.yObs, s.fitRange);
  const reflections = powderReflectionObsCalc(s.structure, s.pattern, [...s.parameters], [...s.bindings], s.profile, s.magnetic, s.fitRange, s.extraPhases, "rietveld", {
    yCalc: [...curves.yCalc], sigma, include,
  });
  const freeKinds = new Set(s.parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.kind));
  const present = WIDTH_KINDS.filter((k) => s.parameters.some((p) => p.kind === k));
  const residual = residualOf(s);
  const widthsFree = present.includes("profileU") && present.every((k) => freeKinds.has(k));
  const dx = diagnoseFit({
    x: curves.x, yObs: curves.yObs, yCalc: curves.yCalc,
    ...(curves.yBackground && curves.yBackground.length === curves.x.length ? { yBackground: curves.yBackground } : {}),
    sigma, include,
    nParams: s.parameters.filter((p) => !p.fixed && !p.expression).length,
    d: s.d,
    reflections,
    phases: s.refinedPhases,
    twoTheta: s.pattern.xUnit === "twoTheta",
    xOf: (d) => convertAxisValue(d, "dSpacing", s.pattern.xUnit, s.axis),
    ...(widthsFree ? { widthsFree: { lorentzian: present.includes("profileX") } } : {}),
    background: { type: s.settings.backgroundType, terms: s.settings.backgroundTerms },
    ...(residual.magneticNeutron ? { magneticNeutron: { k0: k0Signature(residual) } } : {}),
  });
  return fitDiagnosisView(dx, s.pattern.xUnit);
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
  const sigma = pointSigma(s.curves.yObs, s.pattern.points);
  const include = fittedPoints(s.curves.x, s.curves.yObs, s.fitRange);
  const v = powderValidation({ x: s.curves.x, yObs: s.curves.yObs, yCalc: s.curves.yCalc, sigma, include, nParams: s.parameters.filter((p) => !p.fixed && !p.expression).length });
  if (v.durbinWatson) {
    const dw = v.durbinWatson;
    checks.push({ name: "Serial correlation", status: dw.correlated ? "note" : "pass", detail: durbinWatsonSentence(dw) });
  }
  const bv = bondValenceCheck(s.refinedPhases);
  if (bv) checks.push(bv);
  // The fit's diagnosis, as diagnose_fit gives it on the fit on screen: an
  // account that cites it ("the lines are 2.45× broader") cites the report.
  if (s.d) {
    const dx = fitDiagnosisOf(s);
    checks.push({ name: "Fit diagnosis", status: dx.causes.length > 0 ? "note" : "pass", detail: diagnosisText(dx) });
  }
  checks.push(...findingChecks(a));
  return checks;
}

