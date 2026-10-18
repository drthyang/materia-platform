/**
 * Single-crystal F² refinement page (Roadmap M7 UI). Shares the powder
 * workbench's design language — SummaryCards row, a themed quality rail, and the
 * collapsible ParameterPanel — but drives the single-crystal core against
 * integrated Bragg intensities. What its controls and fits do is in
 * singleCrystalPage.ts, which the Agent's headless page runs too: this
 * component holds the page in one state value and renders it.
 *
 * Self-contained: it owns its page state and its own CIF export, so the powder
 * path in App is untouched. The root mounts it (keyed on the dataset) whenever
 * single-crystal data is loaded.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, useCallback } from "react";
import type { HistoryBinding } from "@/app/historyBinding";
import type { EngineExportsRef } from "@/app/workbenchEngine";
import type { SingleCrystalWorkspace } from "@/core/project/types";
import { modulatedInputsFrom } from "@/app/projectIo";
import { useOnChange } from "@/app/useOnChange";
import type { DistanceRestraint, StructureModel } from "@/core/crystal/types";
import { restraintCount } from "@/core/crystal/restraints";
import { withEsd as withEsdText } from "@/agent/structureTable";
import type { AgentLink } from "@/agent/link";
import { isInversion, mergedOnlyAbsences, type ExtinctionModel, type OmittedMeasurement, type ResolutionRange, type ShelxWeighting, type SingleCrystalDataset, type TwinLaw } from "@/core/diffraction/types";
import type { Vec3 } from "@/core/math/types";
import type { ReflectionObsCalc } from "@/core/workflow/obsCalc";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { CANCELLED, type ComputeClient } from "@/workers/computeClient";
import { improper, parsonsOfModel, singleCrystalRefinementComparison } from "@/core/workflow/singleCrystalRefinement";
import { floatingOrigins } from "@/core/crystal/polarOrigin";
import { dispersionLine } from "@/core/scattering/dispersion";
import { EXTINCTION_MODELS, EXTINCTION_MODEL_LABELS } from "@/core/diffraction/singleCrystalFactors";
import { nonPositiveDefiniteSites } from "@/core/crystal/adp";
import { ridingStepLabel, type RidingOptions } from "@/core/crystal/riding";
import { tieStepLabel, type EqualTieUpdate } from "@/core/refinement/constraints";
import type { MagneticModel } from "@/core/magnetic/types";
import {
  liveStateOf, momentFit, pageView, reportInputOf, singleCrystalFit, singleCrystalPage, singleCrystalProbe, singleCrystalThorough, suggestedWeighting as suggestedWeightingOf,
  twinStepLabel, withAdpModel, withDataset, withExtinctionModel, withFit, withFixed, withHand, withLoadedStructure, withMagneticModel, withMerged, withOmitted,
  withOutlierFilter, withParameter, withParameterTies, withRadiation, withReset, withResolution, withRestraints, withRiding, withThorough, withTwinLaws, withWeighting,
  workspaceOf, type Probe,
} from "@/app/singleCrystalPage";
import { KSearchPanel, type MagneticFit } from "@/components/KSearchPanel";
import { FobsFcalc } from "@/app/ui/QualityPlots";
import { SingleCrystalValidationView } from "@/app/ui/SingleCrystalValidation";
import { SegmentedToggle } from "@/app/ui/SegmentedToggle";
import { ParameterPanel } from "@/app/ui/ParameterPanel";
import { SummaryCards, type SummaryCardData } from "@/app/ui/SummaryCards";
import type { CifRefinementMeta } from "@/core/export/cif";
import { writeFullProfInt } from "@/core/export/fullprofInt";
import { magneticIonCandidates } from "@/core/magnetic/magneticIons";
import { expandStructureToSupercell, buildModulatedMomentModel, mergeToMagneticSupercell, type ModulatedIon } from "@/core/magnetic/magneticSupercell";
import type { MomentDegeneracy } from "@/core/magnetic/canonicalize";
import { downloadText } from "@/app/download";
import { reportHtml, type ReportInput } from "@/core/export/report";
import { singleCrystalCifText, reportFileName, type MagneticExploration } from "@/app/reportInputs";
import { card as themeCard, color, mono, fz, uppercaseLabel, secondaryButton, space } from "@/app/theme";

// Lazy so three.js stays out of the main bundle until the 3D view is opened.
const StructureView = lazy(() => import("@/app/ui/StructureView").then((m) => ({ default: m.StructureView })));

const DATA_ACCEPT = ".xye,.xy,.dat,.txt,.gr,.sgr,.fgr,.sq,.fq,.hkl,.fcf,.cif,.int,.csv,.gsa,.gss,.gsas,.fxye,.raw,.cwn,.xra,.rawd,text/plain";
const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
const noop = (): void => {};

/** Parse one k component: a fraction ("1/4", "-1/3") or a decimal. */
function parseKComponent(s: string): number {
  const frac = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) { const den = Number(frac[2]); return den === 0 ? 0 : Number(frac[1]) / den; }
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/** R1 quality bands (fraction): <8 % good · <15 % mediocre · else poor. */
function r1Ink(r1: number): string {
  if (!Number.isFinite(r1)) return color.ink;
  if (r1 < 0.08) return color.okInk;
  if (r1 < 0.15) return color.noteInk;
  return color.warnInk;
}

/** F-plot ↔ list selection: which reflection is spotlighted (shared with the
 *  QualityPlots' FobsFcalc so a click there highlights the matching list row). */
type Selection = { hkl: string; kind: ReflectionObsCalc["kind"]; phaseId?: string };

export function SingleCrystalWorkbench({ structure: loadedStructure, dataset, magneticDataset, client, step, onStep, onMagneticPresent, instrumentProbe, exportsRef, onLoadData, onLoadMagneticData, onLoadCif, restore, structureFileNotes, structureFileName, stepHistory, agentLink }: {
  structure: StructureModel;
  /** A SHELX .ins/.res loaded as the structure: its refinement instructions in a few lines (TWIN, BASF, EXTI, WGHT, FVAR, the hydrogens' U), for the Agent to read. */
  structureFileNotes?: readonly string[];
  /** The SHELX file the model came from (3a.ins). */
  structureFileName?: string;
  dataset: SingleCrystalDataset;
  /** Companion magnetic reflection file for joint co-refinement (Phase 2). When
   *  present alongside an applied magnetic model, the joint panel co-refines the
   *  nuclear + magnetic datasets with χ²_total = w_N·χ²_N + w_M·χ²_M. */
  magneticDataset?: SingleCrystalDataset | null;
  /** Shared compute worker — refinement runs off the main thread, as in powder. */
  client: ComputeClient;
  /** Active workflow step (0 = F² refinement, 1 = magnetic symmetry analysis). */
  step: number;
  /** Switch the app-level step (e.g. "continue to refinement" after applying a model). */
  onStep?: (i: number) => void;
  /** Report whether the model currently carries magnetic moments, so the shell's
   *  header can light the Magnetic chip from the F² page. */
  onMagneticPresent?: (present: boolean) => void;
  /** Radiation of the loaded instrument, if any — seeds the probe default so a
   *  loaded X-ray instrument selects X-ray scattering without the user asking. */
  instrumentProbe?: "xray" | "neutron";
  /** Shell-owned ref this engine publishes its header exports into
   *  (WorkbenchEngine contract) — so "Export CIF" acts on this mode's
   *  structure/params (this workbench owns them), not the powder exporter. */
  exportsRef?: EngineExportsRef;
  /** Load a different dataset — powder here switches the app back to powder mode. */
  onLoadData?: (file: File) => void;
  /** Load a companion magnetic reflection file to pair with this nuclear dataset. */
  onLoadMagneticData?: (file: File) => void;
  /** Load a different structure (CIF). */
  onLoadCif?: (file: File) => void;
  /** A saved single-crystal workspace to reopen (project open). Read once, on
   *  mount — the shell remounts this page with a fresh key when it opens a
   *  project — and only seeds the initial state below. */
  restore?: SingleCrystalWorkspace;
  /** The shell's step history: recorded at this page's refinements and model changes. */
  stepHistory?: HistoryBinding;
  /** Where this page publishes its Agent port (agent/port.ts). */
  agentLink?: AgentLink;
}): JSX.Element {
  // Captured at mount: the shell may drop the prop later without this page
  // losing what it restored.
  const restoring = useRef(restore).current;
  const restoredModulated = restoring?.modulated ? modulatedInputsFrom(restoring.modulated) : null;
  // The page: the structure and the reflections as loaded, and every setting
  // that is saved with a project or changes the fit (singleCrystalPage.ts,
  // whose operations the Agent's headless page runs too). The probe is seeded
  // from the loaded instrument when there is one: a bare reflection file
  // cannot say what measured it.
  const [model, setModel] = useState(() => singleCrystalPage(loadedStructure, dataset, { ...(instrumentProbe ? { instrumentProbe } : {}), ...(restoring ? { restore: restoring } : {}) }));
  const view = useMemo(() => pageView(model), [model]);
  const { probe, extinctionModel, weighting, twinLaws, restraints, params, result, magnetic, omitted, resolution } = model;
  const { on: filterOn, cutoffSigma, minExtinction } = model.filter;
  const { structure, handText, baseWavelength, radiation: effectiveRadiation, probedDataset, fitStructure, bindings, refinedStructure, activeDataset, omittedCount, outsideRange, excluded, merge, comparison, obsCalc } = view;
  const [busy, setBusy] = useState(false);
  // Outcome of the last Prefit / Escape-min run, shown beside the refine actions.
  const [thoroughNote, setThoroughNote] = useState<string | null>(null);
  // The quality card's view: the working layout (F plot beside the 3D model),
  // or the full validation analysis.
  const [qualityView, setQualityView] = useState<"refinement" | "validation">("refinement");
  // Reflection spotlighted by a click in the F_obs/F_calc plot (or null).
  const [selected, setSelected] = useState<Selection | null>(null);

  // A new structure (CIF load) keeps this page mounted (keyed on the dataset),
  // and so does another reflection file for the same structure: the page
  // follows (withLoadedStructure, withDataset). On change only — the mount
  // render may carry a restored state.
  useOnChange(loadedStructure, () => setModel((m) => withLoadedStructure(m, loadedStructure)));
  useOnChange(dataset, () => setModel((m) => withDataset(m, dataset)));

  // Anisotropic sites whose refined U is not positive-definite (validation).
  const nonPositiveDefinite = useMemo(() => nonPositiveDefiniteSites(refinedStructure), [refinedStructure]);
  const outliers = useMemo(
    () => [...comparison.rows].sort((a, b) => Math.abs(b.deltaOverSigma) - Math.abs(a.deltaOverSigma)).slice(0, 6),
    [comparison],
  );

  const nFree = params.filter((p) => !p.fixed && !p.expression).length;

  /** The Refine buttons. Resolves to why it did not finish, or null when it did (the Agent reads it). */
  async function runRefine(guided: boolean): Promise<string | null> {
    stepHistory?.recordNow("edit");
    setBusy(true);
    try {
      // Solve off the main thread (shared worker) so the UI stays responsive,
      // matching the powder path; with a magnetic model, nuclear + moments together.
      const outcome = await singleCrystalFit(client, model, guided);
      setModel((m) => withFit(m, outcome));
      stepHistory?.requestStep("refine", outcome.label);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === CANCELLED) {
        console.info("[status] Single-crystal refinement cancelled");
        return "cancelled";
      }
      console.error(`[status] Single-crystal refinement failed: ${msg}`);
      return `failed: ${msg}`;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Thorough refine — the local-minimum-resistant path the powder and PDF pages
   * have (singleCrystalThorough): with no fit yet it is "Prefit" (a broad
   * cold-start search); once a fit exists it is a lighter "Escape min" nudge
   * out of the current basin.
   */
  async function runThorough(): Promise<string | null> {
    const wide = !result;
    stepHistory?.recordNow("edit");
    setBusy(true);
    setThoroughNote(null);
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the busy state paint
      const outcome = await singleCrystalThorough(client, model);
      setModel((m) => withThorough(m, outcome));
      setThoroughNote(outcome.note);
      stepHistory?.requestStep("refine", outcome.label);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === CANCELLED) {
        setThoroughNote(`${wide ? "Prefit" : "Escape min"} cancelled`);
        return "cancelled";
      }
      setThoroughNote(`${wide ? "Prefit" : "Escape min"} failed: ${msg}`);
      console.error(`[status] Single-crystal ${wide ? "prefit" : "escape"} failed: ${msg}`);
      return `failed: ${msg}`;
    } finally {
      setBusy(false);
    }
  }

  // Moment-fit backend handed to the (shared) symmetry panel: it fits the freed
  // moment amplitudes against this dataset's F² with the nuclear model held fixed,
  // through the same worker. This is single-crystal magnetic refinement.
  const magneticFit: MagneticFit = {
    agreementLabel: "wR2",
    refine: (mag, momentParams, mBindings) => momentFit(client, model, mag, momentParams, mBindings),
  };

  // ── Magnetic single-k supercell refinement (modulated moments) ───────────────
  // Self-contained: works from the BASE structure + the nuclear (`dataset`) and
  // magnetic (`magneticDataset`) reflection files, and on refine internally
  // expands the structure, merges the reflections, builds the k-tied modulated
  // moment model, and runs the single-dataset magnetic multi-start — WITHOUT
  // mutating App state (the shared structure/3D view stay in the base cell).
  const [kText, setKText] = useState<[string, string, string]>(() => (restoredModulated ? [...restoredModulated.kText] : ["1/4", "0", "1/4"]));
  const magIons = useMemo(() => magneticIonCandidates(structure), [structure]);
  // Per-candidate hypothesis: whether it carries a moment, its direction (crystal
  // axes), and the modulation phase (0 = node pattern, π/4 = equal-moment).
  const [ionState, setIonState] = useState<Record<string, { on: boolean; dir: [string, string, string]; phase: string }>>(() =>
    restoredModulated
      ? Object.fromEntries(Object.entries(restoredModulated.ionState).map(([label, ion]) => [label, { on: ion.on, dir: [...ion.dir] as [string, string, string], phase: ion.phase }]))
      : {},
  );
  const ionOf = (label: string) => ionState[label] ?? { on: magIons.length === 1, dir: ["0", "0", "1"] as [string, string, string], phase: "1/4" };
  const [modMoment, setModMoment] = useState(restoredModulated?.moment ?? 1);
  const [modSeed, setModSeed] = useState(restoredModulated?.seed ?? 1);
  const [modRestarts, setModRestarts] = useState(restoredModulated?.restarts ?? 8);
  const [modBusy, setModBusy] = useState(false);
  const [modError, setModError] = useState<string | null>(null);
  const [modResult, setModResult] = useState<{
    amplitudes: { site: string; amp: number }[]; multiplicity: readonly [number, number, number];
    atoms: number; r1: number | null; degeneracies: MomentDegeneracy[];
  } | null>(null);
  const selectedIonCount = magIons.filter((c) => ionOf(c.siteLabel).on).length;
  // A new structure (CIF load) keeps this workbench mounted (keyed on the dataset
  // id), so clear the stale magnetic hypothesis + results/error for the old cell.
  // (On change only — the mount render may carry a restored hypothesis.)
  useOnChange(loadedStructure, () => { setIonState({}); setModResult(null); setModError(null); });

  /** One-pass linear least-squares scale from the nuclear reflections (satellites
   *  carry ~0 nuclear |F|², so they don't bias it): k = Σ Fo²Fc² / Σ (Fc²)². */
  function estimateScale(struct: StructureModel, ds: SingleCrystalDataset): number {
    const sp: RefinementParameter = { id: "scale", label: "s", kind: "scale", value: 1, initialValue: 1, fixed: false, min: 0 };
    const cmp = singleCrystalRefinementComparison(struct, ds, [sp], [{ parameterId: "scale", kind: "scale", targetId: ds.id }]);
    let num = 0, den = 0;
    for (const r of cmp.rows) { num += r.foSq * r.fcSq; den += r.fcSq * r.fcSq; }
    return den > 0 && num > 0 ? num / den : 1;
  }

  async function runModulated(): Promise<void> {
    if (!magneticDataset) return;
    const k = [parseKComponent(kText[0]), parseKComponent(kText[1]), parseKComponent(kText[2])] as Vec3;
    const ions: ModulatedIon[] = magIons
      .filter((c) => ionOf(c.siteLabel).on)
      .map((c) => {
        const s = ionOf(c.siteLabel);
        return { site: c.siteLabel, direction: [parseKComponent(s.dir[0]), parseKComponent(s.dir[1]), parseKComponent(s.dir[2])] as Vec3, phase: parseKComponent(s.phase) * Math.PI };
      });
    // Validate before spinning: surface the reason in the panel (App status only
    // logs to the console) instead of a silent no-op or a swallowed throw.
    if (ions.length === 0) { setModError("Tick at least one magnetic ion to carry a moment."); return; }
    if (k.every((c) => c === 0)) { setModError("Enter a non-zero propagation vector k (e.g. 1/4)."); return; }
    if (ions.some((ion) => ion.direction.every((c) => c === 0))) { setModError("Give each selected ion a non-zero moment direction."); return; }
    setModError(null);
    setModBusy(true);
    try {
      const expansion = expandStructureToSupercell(structure, k);
      const superS = expansion.structure;
      const { dataset: merged } = mergeToMagneticSupercell(probedDataset, { ...magneticDataset, radiation: effectiveRadiation }, k, `${dataset.id}-magcell`);
      const mod = buildModulatedMomentModel(expansion, k, ions, modMoment);
      const scaleStart = estimateScale(superS, merged);
      // ONE scale: nuclear + magnetic share it (same measurement); magneticScale
      // is tied to the (freed) nuclear scale, structure frozen (two-phase).
      const scaleP: RefinementParameter = { id: "scale", label: "scale k = OSF²", kind: "scale", value: scaleStart, initialValue: scaleStart, fixed: false, min: 0 };
      const mscaleP: RefinementParameter = { id: "magScale", label: "magnetic scale (= nuclear)", kind: "magneticScale", value: scaleStart, initialValue: scaleStart, fixed: true, expression: "= scale" };
      const scaleB: ParameterBinding = { parameterId: "scale", kind: "scale", targetId: merged.id };
      const mscaleB: ParameterBinding = { parameterId: "magScale", kind: "magneticScale", targetId: merged.id };
      const ms = await client.refineMagneticSingleCrystalMultiStart(
        {
          structure: superS, magnetic: mod.magnetic, dataset: merged,
          parameters: [scaleP, mscaleP, ...mod.params.map((p) => ({ ...p, fixed: false }))],
          bindings: [scaleB, mscaleB, ...mod.bindings],
        },
        { restarts: modRestarts, seed: modSeed }, { maxIterations: 30 },
      );
      setModResult({
        amplitudes: ions.map((ion, i) => ({ site: ion.site, amp: Math.abs(ms.final.parameters[mod.params[i]!.id] ?? mod.params[i]!.value) })),
        multiplicity: expansion.supercell.multiplicity,
        atoms: superS.sites.length,
        r1: ms.final.agreement.rWeighted ?? null,
        degeneracies: ms.degeneracies,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[status] Magnetic supercell refinement failed: ${msg}`);
      setModError(msg);
    } finally {
      setModBusy(false);
    }
  }

  /** Download the combined magnetic-supercell `.int` (non-destructive). */
  function downloadCombinedInt(): void {
    if (!magneticDataset) return;
    const k = [parseKComponent(kText[0]), parseKComponent(kText[1]), parseKComponent(kText[2])] as Vec3;
    try {
      const wl = "wavelength" in effectiveRadiation ? effectiveRadiation.wavelength : 0;
      const { dataset: merged } = mergeToMagneticSupercell(probedDataset, { ...magneticDataset, radiation: effectiveRadiation }, k);
      downloadText(`${structure.id}_ALL_magcell.int`, writeFullProfInt(merged.reflections, { title: structure.name || structure.id, wavelength: wl }), "text/plain");
      setModError(null);
    } catch (e) {
      setModError(e instanceof Error ? e.message : String(e));
    }
  }

  // Apply a magnetic model from the symmetry step to the workbench: keep its
  // bindings and merge the (freed) moment parameters into the F² parameter set
  // so the refinement and parameter panel show them alongside the nuclear ones.
  function applyMagneticModel(mag: MagneticModel | null, momentParams: readonly RefinementParameter[] = [], mBindings: readonly ParameterBinding[] = []): void {
    setModel((m) => withMagneticModel(m, mag, momentParams, mBindings));
    stepHistory?.requestStep("magnetic", mag ? "Magnetic model applied" : "Magnetic model removed");
  }

  function onParamChange(id: string, patch: Partial<RefinementParameter>): void {
    setModel((m) => withParameter(m, id, patch));
  }

  /**
   * Values back to their starting values, every row kept — as on the powder
   * page. (Rebuilding from `spec.params` instead dropped applied moment rows
   * while the magnetic model stayed set, and the free/fixed choices of a
   * reopened project.)
   */
  function reset(ids?: readonly string[]): void {
    setModel((m) => withReset(m, ids));
    setThoroughNote(null);
    stepHistory?.requestStep("edit", ids ? `Reset ${[...new Set(ids)].join(", ")}` : "Reset to starting values");
  }

  /** Switch every site's ADP model (withAdpModel): the new rows seeded from the ADPs as refined so far, entering fixed. */
  function switchAdpModel(anisotropic: boolean): void {
    const next = withAdpModel(model, anisotropic);
    if (next === model) return;
    setModel(next);
    stepHistory?.requestStep("settings", anisotropic ? "Anisotropic ADPs" : "Isotropic ADPs");
  }

  /** Another probe or wavelength (withRadiation): the scale restarts from its best value under the new physics. */
  function changeRadiation(update: { readonly probe?: Probe; readonly wavelength?: number }): void {
    const next = withRadiation(model, update);
    if (next === model) return;
    setModel(next);
    const wl = pageView(next).baseWavelength;
    stepHistory?.requestStep("settings", `${next.probe === "xray" ? "X-ray" : next.probe === "neutron" ? "Neutron CW" : "Neutron TOF"}${next.probe !== "neutron-tof" ? `, λ ${wl} Å` : ""}`);
  }

  /** The hydrogens ride on their parents, or refine on their own again (withRiding). */
  function changeRiding(on: boolean, options?: RidingOptions): string | null {
    const { model: next, message } = withRiding(model, on, options);
    if (next === model) return message;
    setModel(next);
    stepHistory?.requestStep("settings", next.riding ? ridingStepLabel(next.riding) : "Hydrogens refined on their own");
    return message;
  }

  /** SHELXL's weighting scheme, w = 1/[σ² + (aP)² + bP]; null (or 0 0) for w = 1/σ². */
  function changeWeighting(scheme: ShelxWeighting | null): void {
    const next = withWeighting(model, scheme);
    if (next === model) return;
    setModel(next);
    stepHistory?.requestStep("settings", next.weighting ? `WGHT ${next.weighting.a} ${next.weighting.b}` : "Weights 1/σ²");
  }

  /** The twin laws (SHELXL's TWIN), each with its fraction row (withTwinLaws). */
  function changeTwinLaws(next: readonly TwinLaw[]): void {
    setModel(withTwinLaws(model, next));
    stepHistory?.requestStep("settings", twinStepLabel(next));
  }

  /**
   * Ties the user (or the Agent) makes: rows held to a leader's value, a
   * disorder's second occupancy to one minus the first, or released. The
   * tied rows leave the fit; their values follow at once.
   */
  function changeParameterTies(update: EqualTieUpdate): void {
    setModel((m) => withParameterTies(m, update));
    stepHistory?.requestStep("edit", tieStepLabel(update));
  }

  /** The model inverted through the origin (withHand); called again, back to the hand as loaded. */
  function changeHand(): string {
    const { model: next, text } = withHand(model);
    setModel(next);
    const enantiomorph = pageView(next).inversion?.enantiomorph;
    stepHistory?.requestStep("settings", next.inverted ? `Inverted${enantiomorph ? ` (${enantiomorph})` : ""}` : "Hand as loaded");
    return text;
  }

  /** The distance restraints, replaced as a whole: they change what the fit minimizes, so the last fit is cleared. */
  function changeRestraints(next: readonly DistanceRestraint[]): void {
    setModel((m) => withRestraints(m, next));
    stepHistory?.requestStep("settings", next.length ? `${restraintCount(next)} restraint${restraintCount(next) === 1 ? "" : "s"}` : "No restraints");
  }

  /** Fit the merged equivalents (SHELXL's MERG 2) or every measurement (withMerged). */
  function changeMerged(on: boolean): void {
    const next = withMerged(model, on);
    if (next === model) return;
    setModel(next);
    const nextSet = pageView(next).fittedSet;
    // A file merged by its data reduction loses only its absences: say so, not "merged".
    const onlyAbsences = on && nextSet.merged ? mergedOnlyAbsences(nextSet.merged, nextSet.reflections.length) : false;
    stepHistory?.requestStep("settings", on ? (onlyAbsences ? `${dataset.reflections.length - nextSet.reflections.length} absences left out: ${nextSet.reflections.length} reflections` : `Merged: ${dataset.reflections.length} → ${nextSet.reflections.length} reflections`) : "Every measurement");
  }

  /** Another extinction model: its parameter is another quantity, so it restarts at 0 (none), as on load. */
  function switchExtinctionModel(next: ExtinctionModel): void {
    if (next === extinctionModel) return;
    setModel((m) => withExtinctionModel(m, next));
    stepHistory?.requestStep("settings", `Extinction: ${EXTINCTION_MODEL_LABELS[next]}`);
  }

  /** The resolution range fitted; a limit given as null opens that end. */
  function changeResolution(update: { readonly dMin?: number | null; readonly dMax?: number | null }): void {
    const next = withResolution(model, update);
    setModel(next);
    const range = next.resolution;
    stepHistory?.requestStep("settings", range.dMin === undefined && range.dMax === undefined
      ? "Full resolution range"
      : `Resolution d ${[range.dMax !== undefined ? `≤ ${range.dMax}` : "", range.dMin !== undefined ? `≥ ${range.dMin}` : ""].filter(Boolean).join(" and ")} Å`);
  }

  /** The measurements left out by hand, replaced as a whole. */
  function changeOmitted(next: readonly OmittedMeasurement[]): void {
    const was = omitted.length;
    setModel((m) => withOmitted(m, next));
    stepHistory?.requestStep("settings", next.length > was ? `Omitted ${next.length - was} measurement${next.length - was === 1 ? "" : "s"}` : `${next.length} measurement${next.length === 1 ? "" : "s"} omitted`);
  }

  /** The OMIT filter's controls: on or off, its cutoff in σ, its extinction cut. */
  function changeOutlierFilter(update: { readonly on?: boolean; readonly cutoffSigma?: number; readonly minExtinction?: number | null }): void {
    setModel((m) => withOutlierFilter(m, update));
  }

  /**
   * The CIF's Flack x and how it was found: an inversion twin's fraction, the
   * inverted domains of a twin with both hands summed (its esd from the
   * covariance), or Parsons' quotients from the Bijvoet pairs.
   */
  function absoluteStructureMeta(): Pick<CifRefinementMeta, "flack" | "absStructureDetails"> {
    const fraction = (i: number) => params.find((p) => p.kind === "twinFraction" && bindings.some((b) => b.parameterId === p.id && b.targetKey === String(i + 1)));
    if (twinLaws.length === 1 && isInversion(twinLaws[0]!) && fraction(0)) {
      const p = fraction(0)!;
      return { flack: withEsdText(p.value, result?.esd[p.id]), absStructureDetails: "Refined as an inversion twin." };
    }
    const inverted = twinLaws.flatMap((law, i) => (improper(law.matrix) ? [fraction(i)] : []));
    if (twinLaws.length > 1 && inverted.length > 0 && inverted.every((p) => p)) {
      const x = inverted.reduce((t, p) => t + p!.value, 0);
      return { flack: withEsdText(x, result?.combinationEsd?.flack), absStructureDetails: `Refined as a ${twinLaws.length + 1}-component twin of both hands (SHELXL's TWIN with the inversion); the Flack x is the inverted domains' fractions together, its su from the full covariance.` };
    }
    const r = effectiveRadiation;
    if (r.kind !== "xray" || !dispersionLine(r.wavelength)) return {};
    const est = parsonsOfModel(fitStructure, activeDataset, params, bindings);
    return est ? { flack: withEsdText(est.x, est.esd), absStructureDetails: `Flack x determined using ${est.quotients} quotients [(I+)-(I-)]/[(I+)+(I-)] (Parsons, Flack and Wagner, Acta Cryst. B69 (2013) 249-259).${handText ? ` The model is ${handText}.` : ""}` } : {};
  }

  function exportCif(): void {
    const meta: CifRefinementMeta = {
      r1: comparison.agreement.r1,
      wr2: comparison.agreement.wr2,
      gof: comparison.agreement.goof,
      nRef: activeDataset.reflections.length,
      nParam: nFree,
      // The floating origin of a polar group is a restraint, as SHELXL counts it.
      nRestraints: restraintCount(restraints) + floatingOrigins(fitStructure, params, bindings).length,
      ...absoluteStructureMeta(),
    };
    // `refinedStructure`, not `structure`: structureToCif reads coordinates and
    // cell off the model and takes the parameters only for their esds, so the
    // starting model would export pre-refinement values with refined esds.
    // A tied row (a complement occupancy, an EADP follower) carries its leader's esd, as the report does.
    downloadText(`${structure.id}.cif`, singleCrystalCifText({ structure: refinedStructure, params, result, bindings, refinement: meta }), "chemical/x-cif");
  }

  // Export the reflection data as FullProf `.int`. When a joint session is loaded
  // the two files follow the pairing convention (`_nuc.int` + `_mag.int`) so they
  // reload as one co-refinement session; otherwise a single `<id>.int`.
  function exportInt(): void {
    const wl = "wavelength" in effectiveRadiation ? effectiveRadiation.wavelength : 0;
    const emit = (ds: SingleCrystalDataset, suffix: string): void =>
      downloadText(`${structure.id}${suffix}.int`, writeFullProfInt(ds.reflections, { title: structure.name || structure.id, wavelength: wl }), "text/plain");
    if (magneticDataset) {
      emit(probedDataset, "_nuc");
      emit({ ...magneticDataset, radiation: effectiveRadiation }, "_mag");
    } else {
      emit(probedDataset, "");
    }
  }

  // Tell the shell whether the model includes moments (the header's Magnetic
  // chip lights up from the F² page); withdrawn when this engine unmounts.
  useEffect(() => {
    onMagneticPresent?.(!!magnetic && magnetic.moments.length > 0);
  }, [onMagneticPresent, magnetic]);
  useEffect(() => () => onMagneticPresent?.(false), [onMagneticPresent]);

  // The magnetic page's current candidate, for the report (published by KSearchPanel).
  const exploredMagnetic = useRef<MagneticExploration | null>(null);
  const publishExploration = useCallback((m: MagneticExploration | null): void => {
    exploredMagnetic.current = m;
  }, []);

  // Self-contained HTML report (Export ▾ → Report): data and merge statistics,
  // the F_obs/F_calc figure, SHELX agreement, the refined structure with esds,
  // the magnetic model (applied or under exploration), every parameter.
  const reportInputRef = useRef<() => ReportInput>(() => { throw new Error("SingleCrystalWorkbench: not mounted"); });
  reportInputRef.current = (): ReportInput => reportInputOf(model, {
    explored: exploredMagnetic.current,
    ...(structureFileNotes ? { structureFile: structureFileNotes } : {}),
    ...(structureFileName ? { structureFileName } : {}),
  });
  function exportReport(): void {
    downloadText(reportFileName(structure), reportHtml(reportInputRef.current()), "text/html");
  }

  // Publish the Agent port (agent/port.ts): the live state, read lazily, and
  // this page's own handlers — the Agent's `refine` is the Refine button.
  // Republished every render, so a call always sees the state on screen.
  useEffect(() => {
    if (!agentLink) return;
    agentLink.publish({
      technique: "singleCrystal",
      state: () => liveStateOf(model, { busy, ...(structureFileNotes ? { structureFile: structureFileNotes } : {}) }),
      setFixed: (changes) => setModel((m) => withFixed(m, changes)),
      setAdpModel: switchAdpModel,
      setExtinctionModel: switchExtinctionModel,
      setRadiation: changeRadiation,
      setRiding: changeRiding,
      setWeighting: changeWeighting,
      setTwinLaws: changeTwinLaws,
      setParameterTies: changeParameterTies,
      setDistanceRestraints: changeRestraints,
      invertStructure: changeHand,
      setMerged: changeMerged,
      setOmitted: changeOmitted,
      setResolution: changeResolution,
      setOutlierFilter: changeOutlierFilter,
      refine: () => runRefine(false),
      thorough: runThorough,
      // The Refine button's request with the Agent's options; the result is only read.
      probe: (options, cut) => singleCrystalProbe(client, model, options, cut),
      reportInput: () => reportInputRef.current(),
      cancel: () => client.cancel(),
      reset,
    });
  });
  useEffect(() => () => agentLink?.release("singleCrystal"), [agentLink]);

  // Publish the current exporter so the app header can drive it; clear on unmount
  // (switch back to powder) so the header never calls a stale single-crystal export.
  useEffect(() => {
    if (!exportsRef) return;
    exportsRef.current = {
      report: exportReport,
      cif: exportCif,
      scInt: exportInt,
      projectWorkspace: () => workspaceOf(model, {
        magneticDataset: magneticDataset ?? null,
        modulated: { kText, ionState, moment: modMoment, seed: modSeed, restarts: modRestarts },
      }),
    };
    return () => { exportsRef.current = null; };
  });

  const ag = comparison.agreement;
  // The σ-reject control (SHELX-style OMIT), rendered in either view, and the
  // measurements omitted by hand beneath it.
  const outlierFilter = (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <label style={filterRow} title="Reject reflections whose |Fo²−Fc²|/σ exceeds the threshold against the current model (SHELX-style OMIT)">
      <input type="checkbox" checked={filterOn} onChange={(e) => changeOutlierFilter({ on: e.target.checked })} style={{ accentColor: color.primary }} />
      <span style={{ color: color.secondary }}>Reject reflections with |Δ|/σ &gt;</span>
      <input
        type="number" min={2} step={0.5} value={cutoffSigma}
        disabled={!filterOn}
        onChange={(e) => changeOutlierFilter({ cutoffSigma: Math.max(0, Number(e.target.value) || 0) })}
        style={{ ...numInput, ...(filterOn ? {} : { opacity: 0.5 }) }}
      />
      <span style={{ color: color.secondary }}>σ</span>
      {/* GSAS-II's minimum extinction: blank for none. */}
      <span style={{ color: color.secondary }} title="Also reject reflections whose extinction factor y is below this (blank: none) — where the correction is that severe, the extinction model carries the intensity">or y &lt;</span>
      <input
        type="number" min={0.05} max={0.95} step={0.05} value={minExtinction ?? ""} placeholder="—"
        disabled={!filterOn}
        onChange={(e) => { const v = Number(e.target.value); changeOutlierFilter({ minExtinction: e.target.value === "" || !(v > 0 && v < 1) ? null : v }); }}
        style={{ ...numInput, ...(filterOn ? {} : { opacity: 0.5 }) }}
      />
      {filterOn && (
        <span style={{ marginLeft: "auto", fontFamily: mono, color: excluded > 0 ? color.warnInk : color.faint }}>
          {excluded} of {dataset.reflections.length} excluded
        </span>
      )}
    </label>
    <OmittedRow omitted={omitted} count={omittedCount} batches={probedDataset.reflections.some((r) => r.batch !== undefined)} onChange={changeOmitted} />
    <ResolutionRow range={resolution} excluded={outsideRange} onChange={changeResolution} />
    </div>
  );
  const st = merge.statistics;
  const cell = structure.cell;
  const probeLabel = probe === "xray" ? "X-ray · CW" : probe === "neutron" ? "Neutron · CW" : "Neutron · TOF";
  const wl = "wavelength" in effectiveRadiation ? ` · λ ${effectiveRadiation.wavelength} Å` : "";

  const summaryCards: SummaryCardData[] = [
    {
      label: "Structure",
      help: "The unit cell is taken from indexing / data reduction and held fixed. Integrated intensities carry no information on peak positions, so no single-crystal program refines the cell against F² (SHELXL's CELL/ZERR, Jana, FullProf and GSAS-II alike); its esds belong to the diffractometer, not to this fit.",
      loadLabel: "Load CIF…",
      accept: ".cif,.mcif,.ins,.res,text/plain",
      onFile: onLoadCif ?? noop,
      chip: "✓ parsed",
      title: `${structure.name || "structure"} · ${structure.spaceGroup.hermannMauguin ?? "—"}`,
      meta: `a ${cell.a.toFixed(4)} · b ${cell.b.toFixed(4)} · c ${cell.c.toFixed(4)} Å · ${structure.sites.length} sites · cell fixed`,
    },
    {
      label: "Data · single crystal",
      loadLabel: "Load data…",
      accept: DATA_ACCEPT,
      onFile: onLoadData ?? noop,
      chip: "✓ loaded",
      title: dataset.name,
      // A non-centrosymmetric group's merge as SHELXL reports it: the Friedel mates apart, the absences out.
      meta: `${probeLabel}${wl} · ${st.observations} obs → ${st.friedelApart ? `${st.friedelApart.unique} unique (Friedel apart)` : `${st.unique} unique`} · ${(st.friedelApart ?? st).redundancy > 1 + 1e-9 ? `R_int ${pct((st.friedelApart ?? st).rInt)}` : "each reflection once"}${dataset.origin === "refinement-listing" ? " · a refinement's listing" : ""}`,
      control: (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <ProbeToggle probe={probe} onChange={(p) => changeRadiation({ probe: p })} />
          {probe !== "neutron-tof" && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="The wavelength of the measurement: a SHELX or .fcf file carries none, and 1.54 Å is assumed. Mo Kα 0.71073 Å, Cu Kα 1.54184 Å, Ag Kα 0.56087 Å. It enters the extinction correction, not |F|².">
              <span style={{ fontSize: fz.micro, color: color.faint }}>λ</span>
              <input
                type="number" min={0.1} max={5} step={0.0001} defaultValue={baseWavelength} key={baseWavelength}
                onBlur={(e) => { const v = Number(e.target.value); if (v > 0.1 && v < 5) changeRadiation({ wavelength: v }); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                style={{ ...numInput, width: 80 }}
              />
              <span style={{ fontSize: fz.micro, color: color.faint }}>Å</span>
            </label>
          )}
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            title="The extinction model: SHELXL's empirical EXTI, or Becker–Coppens secondary extinction as GSAS-II applies it (type I: the mosaic spread limits it; type II: the domain size), with each reflection's path length when the file gives it. Switching restarts the extinction parameter at 0."
          >
            <span style={{ fontSize: fz.micro, color: color.faint }}>extinction</span>
            <select
              value={extinctionModel}
              onChange={(e) => switchExtinctionModel(e.target.value as ExtinctionModel)}
              style={{ border: `1px solid ${color.control}`, borderRadius: 6, fontSize: 11.5, padding: "1px 4px", background: "#fff", color: color.secondary }}
            >
              {EXTINCTION_MODELS.map((m) => <option key={m} value={m}>{EXTINCTION_MODEL_LABELS[m]}</option>)}
            </select>
          </label>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            title="SHELXL's weighting scheme WGHT a b: w = 1/[σ²(Fo²) + (aP)² + bP], P = (Fo² + 2Fc²)/3; 0 0 is w = 1/σ². It is set last, once the model is complete, from the values that flatten the analysis of variance (suggest)."
          >
            <span style={{ fontSize: fz.micro, color: color.faint }}>WGHT</span>
            {(["a", "b"] as const).map((term) => (
              <input
                key={`${term}${weighting?.[term] ?? 0}`}
                type="number" min={0} step={term === "a" ? 0.001 : 0.01} defaultValue={weighting?.[term] ?? 0}
                aria-label={`WGHT ${term}`}
                onBlur={(e) => { const v = Number(e.target.value); if (v >= 0) changeWeighting({ a: weighting?.a ?? 0, b: weighting?.b ?? 0, [term]: v }); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                style={{ ...numInput, width: 74 }}
              />
            ))}
            <button
              style={{ ...secondaryButton, padding: "1px 8px", fontSize: 11.5 }}
              onClick={() => { const w = suggestedWeightingOf(model); changeWeighting({ a: w.a, b: w.b }); }}
              title="Use the scheme SHELXL would suggest for the model as refined now: the a and b that make the GooF flat across the intensity bins, and 1 overall"
            >
              suggest
            </button>
          </span>
        </div>
      ),
    },
  ];

  const refineActions = (
    <>
      <button
        style={{ ...secondaryButton, padding: "7px 13px", ...(busy ? disabledStyle : {}) }}
        disabled={busy}
        onClick={() => runRefine(true)}
        title="Free all symmetry-allowed structural parameters (positions, ADPs) and refine"
      >
        Refine structure
      </button>
      <button
        style={{ ...secondaryButton, padding: "7px 13px" }}
        onClick={exportCif}
        title="Export the current structure as CIF (with esds + agreement factors)"
      >
        Export CIF
      </button>
      {thoroughNote && (
        <span style={{ fontSize: fz.small, color: thoroughNote.includes("failed") ? color.warnInk : color.secondary, alignSelf: "center" }}>
          {thoroughNote}
        </span>
      )}
    </>
  );

  return (
    <>
      <SummaryCards cards={summaryCards} />
      {/* Step 0 (F² refinement) and step 1 (magnetic symmetry) stay mounted; the
          step toggles visibility so each page's state survives switching. */}
      <div className="wb-sc" style={{ display: step === 1 ? "none" : undefined }}>
        {/* Quality card: F² agreement, then either the working view (merge stats,
            Fo² vs Fc² beside the 3D model, largest outliers) or the validation
            analysis. */}
        <div style={{ ...themeCard, padding: space.inset, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={uppercaseLabel}>Refinement quality — single crystal (F²)</span>
            <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <Stat value={pct(ag.r1)} label="R1" hint={`${ag.observed}/${ag.total} obs > 2σ`} ink={r1Ink(ag.r1)} />
              <Stat value={pct(ag.wr2)} label="wR2" />
              <Stat value={ag.goof.toFixed(2)} label="GooF" />
              <SegmentedToggle
                options={[
                  { id: "refinement", label: "Refinement", title: "Fo² vs Fc² beside the 3D model, with the largest outliers" },
                  { id: "validation", label: "Validation", title: "Verdict, agreement and data quality, analysis of variance by intensity and resolution, outliers, convergence" },
                ] as const}
                value={qualityView}
                onChange={setQualityView}
              />
            </div>
          </div>

          {/* In an acentric group the Friedel mates stay apart, as SHELXL merges them (MERG 2): merged in the
              Laue class, a listing's Bijvoet pairs would read as an R_int that is only their anomalous difference. */}
          {qualityView === "refinement" && <div style={mergeStrip}>
            <Stat small value={`${st.observations}`} label={excluded > 0 ? "kept" : "observations"} />
            <Stat small value={`${(st.friedelApart ?? st).unique}`} label={st.friedelApart ? "unique (Friedel apart)" : "unique"} />
            <Stat small value={(st.friedelApart ?? st).redundancy.toFixed(2)} label="redundancy" />
            <Stat small value={(st.friedelApart ?? st).redundancy > 1 + 1e-9 ? pct((st.friedelApart ?? st).rInt) : "—"} label="R_int" />
            <Stat small value={pct((st.friedelApart ?? st).rSigma)} label="R_sigma" />
          </div>}

          {/* Outlier (σ) reflection filter: here in the working view; in the
              validation view it sits in the Outliers panel, where it acts. */}
          {qualityView === "refinement" && outlierFilter}

          {qualityView === "validation" ? (
            <SingleCrystalValidationView
              rows={obsCalc}
              cell={structure.cell}
              spaceGroup={structure.spaceGroup}
              nParams={nFree}
              merge={st}
              result={result}
              parameters={params}
              nonPositiveDefinite={nonPositiveDefinite}
              xray={probe === "xray"}
              selected={selected}
              onSelect={setSelected}
              outlierFilter={outlierFilter}
              omitted={filterOn ? { count: excluded, cutoff: cutoffSigma } : undefined}
            />
          ) : (<>
          {/* Fo² vs Fc² beside the 3D structure model; stacks when the panel is narrow. */}
          <div className="wb-sc-plots">
            <div>
              <div style={{ ...uppercaseLabel, marginBottom: 6 }}><span style={{ textTransform: "none" }}>Fo² vs Fc²</span></div>
              <FobsFcalc rows={obsCalc} selected={selected} onHighlight={setSelected} />
            </div>
            <div>
              <div style={{ ...uppercaseLabel, marginBottom: 4 }}>Crystal structure — unit cell</div>
              <Suspense fallback={<div style={{ minHeight: 320, display: "grid", placeItems: "center", color: color.secondary, fontSize: 13 }}>Loading 3D viewer…</div>}>
                <div style={{ minHeight: 320 }}><StructureView structure={refinedStructure} /></div>
              </Suspense>
            </div>
          </div>

          <div>
            <div style={{ ...uppercaseLabel, marginBottom: 6 }}>Largest outliers · <span style={{ textTransform: "none" }}>(Fo²−Fc²)/σ</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, fontFamily: mono, fontSize: fz.small }}>
              {outliers.map((r, i) => {
                const hkl = `${r.h} ${r.k} ${r.l}`;
                const isSel = selected?.kind === "nuclear" && selected.hkl === hkl;
                return (
                  <div
                    key={`${i}:${hkl}`}
                    onClick={() => setSelected(isSel ? null : { hkl, kind: "nuclear" })}
                    style={{
                      display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, cursor: "pointer",
                      padding: "1px 4px", borderRadius: 5,
                      color: isSel ? color.ink : color.secondary,
                      background: isSel ? color.primaryTintBg : "transparent",
                    }}
                  >
                    <span>({hkl})</span>
                    <span style={{ color: color.faint }}>Fo² {r.foSq.toFixed(1)} · Fc² {r.fcSq.toFixed(1)}</span>
                    <span style={{ color: Math.abs(r.deltaOverSigma) > 4 ? color.warnInk : color.faint }}>
                      {r.deltaOverSigma >= 0 ? "+" : ""}{r.deltaOverSigma.toFixed(1)}σ
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          </>)}
        </div>

        {/* Parameters — the shared collapsible panel, single-crystal actions. */}
        <ParameterPanel
          params={params}
          esd={result?.esd}
          onChange={onParamChange}
          onRefine={() => runRefine(false)}
          onThorough={() => void runThorough()}
          thoroughMode={result ? "escape" : "prefit"}
          prefitTitle="Prefit from a cold start: a broad set of perturbed restarts of the free parameters (positions kicked by up to ~0.15 in fractional coordinates), keeping the best — lands the structure in a good basin before you refine. (No Le Bail stage: integrated intensities have no profile to pre-fit.)"
          onReset={reset}
          busy={busy}
          result={result}
          title="Single-crystal parameters"
          extraActions={refineActions}
        />

        {/* Magnetic single-k supercell refinement. Self-contained: expands the
            base structure, merges the nuclear + magnetic files into the
            supercell, ties one modulated amplitude per magnetic sublattice, and
            refines with ONE shared scale (nuclear + magnetic = one measurement).
            Non-destructive: the shared structure/3D view stay in the base cell. */}
        <div className="wb-sc-wide" style={{ ...themeCard, padding: space.inset, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={uppercaseLabel}>Magnetic single-k · supercell refinement</span>
            <label style={{ ...secondaryButton, padding: "6px 12px", cursor: "pointer" }} title="Load a companion magnetic reflection file (.int/.hkl): satellites indexed in the nuclear cell as the fundamental h k l of hkl ± k">
              {magneticDataset ? "Replace magnetic file…" : "Load magnetic .int…"}
              <input
                type="file" accept={DATA_ACCEPT} style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoadMagneticData?.(f); e.currentTarget.value = ""; }}
              />
            </label>
          </div>

          {!magneticDataset ? (
            <p style={{ fontSize: 13, color: color.secondary, margin: 0, lineHeight: 1.5 }}>
              Load the <strong>magnetic</strong> reflection file (the satellites, indexed in the nuclear cell as the
              fundamental h k l of hkl ± k). This page then expands the structure into the magnetic supercell, merges both
              files, and refines the k-modulated moments — the FullProf single-k workflow.
            </p>
          ) : magIons.length === 0 ? (
            <p style={{ fontSize: 13, color: color.noteInk, margin: 0 }}>
              No magnetic ion with a tabulated form factor in this structure — check the oxidation states / ion labels.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: color.secondary, margin: 0 }}>
                {dataset.reflections.length} nuclear + {magneticDataset.reflections.length} magnetic reflections. Enter k and
                the moment hypothesis; the structure is expanded to the supercell (magnetic ions at the nuclear positions,
                nuclear scaffold frozen) and the modulated amplitudes refine against the merged data.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: fz.small, color: color.secondary, fontFamily: mono }}>k =</span>
                {[0, 1, 2].map((i) => (
                  <input
                    key={i} value={kText[i]} onChange={(e) => setKText((t) => { const n = [...t] as [string, string, string]; n[i] = e.target.value; return n; })}
                    style={{ ...numInput, width: 54 }} title="Fractions like 1/4 or decimals" placeholder={["k₁", "k₂", "k₃"][i]}
                  />
                ))}
              </div>

              {/* One row per magnetic-ion candidate: on/off, direction (crystal axes), phase. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {magIons.map((c) => {
                  const s = ionOf(c.siteLabel);
                  const set = (patch: Partial<typeof s>) => setIonState((st) => ({ ...st, [c.siteLabel]: { ...s, ...patch } }));
                  return (
                    <div key={c.siteLabel} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: fz.small }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 92 }}>
                        <input type="checkbox" checked={s.on} onChange={(e) => set({ on: e.target.checked })} style={{ accentColor: color.primary }} />
                        <span style={{ fontFamily: mono }}>{c.siteLabel}</span>
                        <span style={{ color: color.faint }}>{c.ionId}</span>
                      </label>
                      {s.on && (
                        <>
                          <span style={{ color: color.secondary }}>m ∥</span>
                          {[0, 1, 2].map((i) => (
                            <input key={i} value={s.dir[i]} onChange={(e) => { const d = [...s.dir] as [string, string, string]; d[i] = e.target.value; set({ dir: d }); }}
                              style={{ ...numInput, width: 42 }} title="Moment direction, crystal axes (a,b,c)" placeholder={["a", "b", "c"][i]} />
                          ))}
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: color.secondary }} title="Modulation phase φ (×π). 0 = node pattern (+,0,−,0); 0.25 = equal-moment (+,+,−,−)">
                            φ/π
                            <input value={s.phase} onChange={(e) => set({ phase: e.target.value })} style={{ ...numInput, width: 46 }} />
                          </label>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: fz.small, color: color.secondary }} title="Starting modulation amplitude (µB)">
                  <span style={{ fontFamily: mono }}>amp₀</span>
                  <input type="number" value={modMoment} step={0.5} min={0} onChange={(e) => setModMoment(Number(e.target.value))} style={numInput} />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: fz.small, color: color.secondary }} title="Seeded moment restarts (escape local minima)">
                  <span style={{ fontFamily: mono }}>restarts</span>
                  <input type="number" value={modRestarts} step={1} min={0} onChange={(e) => setModRestarts(Math.round(Number(e.target.value)))} style={numInput} />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: fz.small, color: color.secondary }} title="Deterministic RNG seed">
                  <span style={{ fontFamily: mono }}>seed</span>
                  <input type="number" value={modSeed} step={1} onChange={(e) => setModSeed(Math.round(Number(e.target.value)))} style={numInput} />
                </label>
                <button style={{ ...secondaryButton, padding: "7px 13px", ...(modBusy || selectedIonCount === 0 ? disabledStyle : {}) }} disabled={modBusy || selectedIonCount === 0} onClick={runModulated}
                  title={selectedIonCount === 0 ? "Tick at least one magnetic ion above" : "Expand to the supercell, merge, and refine the k-modulated moment amplitudes (one per sublattice) + shared scale"}>
                  {modBusy ? "Refining…" : "Refine magnetic supercell ↻"}
                </button>
                <button style={{ ...secondaryButton, padding: "7px 13px" }} onClick={downloadCombinedInt}
                  title="Download the combined supercell .int (FullProf single-k input) — non-destructive">
                  Download combined .int
                </button>
              </div>

              {modError && (
                <span style={{ fontSize: fz.small, color: color.warnInk }}>⚠ {modError}</span>
              )}

              {modResult && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${color.subtle}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 12.5, color: color.secondary }}>
                    Supercell {modResult.multiplicity.join("×")} · {modResult.atoms} atoms (P1) ·{" "}
                    {modResult.r1 != null ? <>wR = {(100 * modResult.r1).toFixed(1)}%</> : "—"}
                  </div>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontFamily: mono, fontSize: fz.small }}>
                    {modResult.amplitudes.map((a) => (
                      <span key={a.site} style={{ color: color.ink }}>{a.site}: amp {a.amp.toPrecision(3)} µ<sub>B</sub></span>
                    ))}
                  </div>
                  <span style={{ fontSize: fz.micro, color: color.faint }}>
                    Refined value is the modulation <em>amplitude</em>; the per-site moment is amp·cos(2πk·L+φ) — for the
                    equal-moment φ = π/4 pattern that is amp/√2.
                  </span>
                  {modResult.degeneracies.length > 0 && (
                    <div style={{ fontSize: fz.small, color: color.noteInk }}>
                      <strong>Data-limited directions:</strong>
                      <ul style={{ margin: "3px 0 0", paddingLeft: 18 }}>
                        {modResult.degeneracies.map((d, i) => <li key={i}>{d.message}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Step 1 — magnetic symmetry analysis. The workflow itself is structure-
          driven and identical to powder; only the moment fit (magneticFit) runs
          against F² reflections instead of a powder pattern. */}
      <div className="wb-mag-page" style={{ display: step === 1 ? undefined : "none" }}>
        <div style={{ ...themeCard, padding: space.inset }}>
          <div style={{ ...uppercaseLabel, marginBottom: 4 }}>Magnetic symmetry analysis — single crystal ({structure.name || "structure"})</div>
          <p style={{ fontSize: 13, color: color.secondary, margin: 0, lineHeight: 1.5 }}>
            Commensurate single-k workflow (shared with powder): magnetic ions → propagation vector k → symmetry framework → magnetic space group → refine moments.
            &ldquo;Refine moments&rdquo; fits the moment amplitudes to the F² reflections; &ldquo;Continue&rdquo; carries the model to the F² refinement to fit nuclear + magnetic together.
          </p>
        </div>
        <KSearchPanel
          structure={structure}
          magneticFit={magneticFit}
          onContinue={(m, mp, mb) => { applyMagneticModel(m, mp, mb); onStep?.(0); }}
          onReportModel={publishExploration}
        />
      </div>
    </>
  );
}

/** Segmented X-ray / Neutron / TOF control for the single-crystal Data card.
 *  A bare reflection file carries no probe, so this is the authoritative source. */
/**
 * Source × mode picker for the probe. The reflection file cannot report its
 * own radiation, so the user states it the way an experiment is described:
 * the SOURCE (X-ray or neutron) and, for neutrons, the MODE — constant
 * wavelength (a monochromated reactor / synchrotron-style beam) or time of
 * flight (a spallation source, no single λ). X-ray single-crystal data is
 * always constant-wavelength, so its mode control is fixed at CW.
 */
function ProbeToggle({ probe, onChange }: { probe: Probe; onChange: (p: Probe) => void }): JSX.Element {
  const source: "xray" | "neutron" = probe === "xray" ? "xray" : "neutron";
  const mode: "cw" | "tof" = probe === "neutron-tof" ? "tof" : "cw";
  const setSource = (s: "xray" | "neutron"): void => onChange(s === "xray" ? "xray" : mode === "tof" ? "neutron-tof" : "neutron");
  const setMode = (m: "cw" | "tof"): void => {
    if (source === "xray") return; // fixed: X-ray is always constant-wavelength
    onChange(m === "tof" ? "neutron-tof" : "neutron");
  };
  const modeFixed = source === "xray";
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <ProbeSegment
        label="source"
        hint="The reflection file cannot report its own radiation. X-ray uses atomic form factors f(Q); neutron uses scattering lengths b — the choice changes every F_calc."
        options={[{ value: "xray", label: "X-ray" }, { value: "neutron", label: "Neutron" }]}
        value={source}
        onChange={setSource}
      />
      <ProbeSegment
        label="mode"
        hint={modeFixed
          ? "X-ray single-crystal data is always constant-wavelength (monochromatic)."
          : "Constant wavelength: a monochromatic beam, λ from the file (1.54 Å when it gives none). Time of flight: a Laue measurement at a spallation source — each reflection at its own wavelength, which the extinction correction uses when the file gives it (an SNS TOPAZ file does)."}
        options={[{ value: "cw", label: "CW" }, { value: "tof", label: "TOF" }]}
        value={mode}
        onChange={setMode}
        disabled={modeFixed}
      />
    </div>
  );
}

/** One labelled segmented group of the probe picker. */
/** The resolution range fitted, SHELXL's SHEL: d from … to … Å, either end open (blank). */
function ResolutionRow({ range, excluded, onChange }: {
  range: ResolutionRange;
  excluded: number;
  onChange: (update: { readonly dMin?: number | null; readonly dMax?: number | null }) => void;
}): JSX.Element {
  const value = (v: string): number | null => (v.trim() === "" || !(Number(v) > 0) ? null : Number(v));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: fz.small }} title="Fit only the reflections in this resolution range (SHELXL's SHEL); blank leaves an end open. A high-order refinement (d below 0.5–0.6 Å, where extinction barely reaches) gives ADPs nearly free of the extinction model.">
      <span style={{ color: color.secondary }}>Resolution: d from</span>
      <input type="number" min={0.1} step={0.05} value={range.dMax ?? ""} placeholder="∞" onChange={(e) => onChange({ dMax: value(e.target.value) })} style={numInput} />
      <span style={{ color: color.secondary }}>to</span>
      <input type="number" min={0.1} step={0.05} value={range.dMin ?? ""} placeholder="0" onChange={(e) => onChange({ dMin: value(e.target.value) })} style={numInput} />
      <span style={{ color: color.secondary }}>Å</span>
      {excluded > 0 && <span style={{ marginLeft: "auto", fontFamily: mono, color: color.warnInk }}>{excluded} outside</span>}
    </div>
  );
}

/** The measurements omitted by hand (SHELXL's OMIT h k l), each removable, and a box to omit one more: "h k l" or "h k l batch". */
function OmittedRow({ omitted, count, batches, onChange }: {
  omitted: readonly OmittedMeasurement[];
  count: number;
  batches: boolean;
  onChange: (next: readonly OmittedMeasurement[]) => void;
}): JSX.Element {
  const [text, setText] = useState("");
  const parsed = text.trim().split(/[\s,]+/).map(Number);
  const valid = (parsed.length === 3 || (batches && parsed.length === 4)) && parsed.every(Number.isInteger);
  const add = (): void => {
    if (!valid) return;
    const [h, k, l, batch] = parsed as [number, number, number, number | undefined];
    onChange([...omitted, { h, k, l, ...(batch !== undefined ? { batch } : {}), reason: "omitted by hand" }]);
    setText("");
  };
  const label = (o: OmittedMeasurement): string => `${o.h} ${o.k} ${o.l}${o.batch !== undefined ? ` (batch ${o.batch})` : ""}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: fz.small }}>
      <span style={{ color: color.secondary }} title="Single measurements left out by hand, SHELXL's OMIT h k l: a failed measurement its equivalents expose. The filter above cuts by |Δ|/σ; these go whatever their residual.">Omitted:</span>
      {omitted.length === 0 && <span style={{ color: color.faint }}>none</span>}
      {omitted.map((o, i) => (
        <span key={`${label(o)}-${i}`} title={o.reason ?? ""} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: mono, border: `1px solid ${color.control}`, borderRadius: 6, padding: "0 4px" }}>
          {label(o)}
          <button
            aria-label={`Restore ${label(o)}`}
            onClick={() => onChange(omitted.filter((_, j) => j !== i))}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: color.faint, padding: 0, fontSize: 12 }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        placeholder={batches ? "h k l batch" : "h k l"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        style={{ ...numInput, width: 92 }}
      />
      <button onClick={add} disabled={!valid} style={{ ...secondaryButton, padding: "1px 8px", fontSize: 11.5, ...(valid ? {} : disabledStyle) }}>Omit</button>
      {omitted.length > 0 && <span style={{ marginLeft: "auto", fontFamily: mono, color: color.faint }}>{count} left out</span>}
    </div>
  );
}

function ProbeSegment<T extends string>({ label, hint, options, value, onChange, disabled = false }: {
  label: string;
  hint: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: disabled ? 0.55 : 1 }} title={hint}>
      <span style={{ fontSize: fz.micro, color: color.faint }}>{label}</span>
      <span style={{ display: "inline-flex", border: `1px solid ${color.control}`, borderRadius: 6, overflow: "hidden" }}>
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            disabled={disabled}
            aria-pressed={value === o.value}
            style={{
              border: "none", padding: "2px 9px", fontSize: 11.5, fontFamily: "inherit", cursor: disabled ? "default" : "pointer",
              background: value === o.value ? color.primary : "transparent",
              color: value === o.value ? "#fff" : color.secondary,
            }}
          >
            {o.label}
          </button>
        ))}
      </span>
    </span>
  );
}

function Stat({ value, label, hint, ink, small }: { value: string; label: string; hint?: string; ink?: string; small?: boolean }): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontFamily: mono, fontSize: small ? 14 : 18, fontWeight: 600, color: ink ?? color.ink }}>{value}</span>
      <span style={{ fontSize: fz.micro, color: color.secondary }}>{label}</span>
      {hint ? <span style={{ fontSize: fz.micro, color: color.faint }}>{hint}</span> : null}
    </div>
  );
}

const mergeStrip: CSSProperties = {
  display: "flex",
  gap: 22,
  flexWrap: "wrap",
  padding: "10px 2px",
  borderTop: `1px solid ${color.subtle}`,
  borderBottom: `1px solid ${color.subtle}`,
};
const filterRow: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, fontSize: fz.small, cursor: "pointer",
};
const numInput: CSSProperties = {
  width: 52, border: `1px solid ${color.input}`, borderRadius: 7, fontSize: 12, fontFamily: mono, padding: "2px 6px", background: "#fff",
};
const disabledStyle: CSSProperties = { opacity: 0.55, cursor: "not-allowed" };
