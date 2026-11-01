/**
 * PDF (pair distribution function) refinement page — "real-space Rietveld"
 * (PDF_MPDF_ROADMAP P0/P1). Shares the workbench design language — SummaryCards
 * row, quality strip, the collapsible ParameterPanel, and the shared plot in its
 * signed-y mode (G(r) oscillates about zero). What its controls and fits do is
 * in pdfPage.ts, which the Agent's headless page runs too: this component holds
 * the page in one state value and renders it.
 *
 * Self-contained: owns its page state and its CSV export. The app shell mounts
 * it (keyed on the dataset) whenever a reduced `.gr` PDF is loaded.
 */

import type { HistoryBinding } from "@/app/historyBinding";
import type { AgentLink } from "@/agent/link";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineExportsRef } from "@/app/workbenchEngine";
import type { PdfWorkspace } from "@/core/project/types";
import { useOnChange } from "@/app/useOnChange";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { CANCELLED, type ComputeClient } from "@/workers/computeClient";
import { pdfPartialCurves, pdfPhaseCurves } from "@/core/workflow/pdf";
import { unsupportedMpdfK } from "@/core/workflow/mpdf";
import type { MagneticModel } from "@/core/magnetic/types";
import { isMomentParameterKind } from "@/core/refinement/types";
import { KSearchPanel } from "@/components/KSearchPanel";
import type { MagneticFit } from "@/app/magneticStep";
import type { DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import { structuralSubgroupLattice, type SubgroupNode } from "@/core/crystal/subgroupTree";
import { parseCif } from "@/parsers/cif";
import { parseModeCif } from "@/parsers/modeCif";
import {
  SAMPLE_STEPS, agentBoxcarPlan, boxcarDataRange, boxcarRangeOf, boxcarStartIsCurrent, boxcarStartRows, boxcarSummary, boxcarTabIssue, boxcarTabScanPlan, landsOn, liveStateOf, momentFit, pageView, pdfBoxcar, pdfFit, pdfguiBundleOf, pdfPage, pdfPosterior, pdfProbe, pdfThorough, reportInputOf, rwOf, specKeyOf,
  withActivatedMode, withAdpModel, withBoxcarPlan, withBoxcarRange, withBoxcarRangeFromFit, withBoxcarRun, withBoxcarStart, withBoxcarStartReset, withBoxcarStep, withExtraPhases, withFit, withFitRange, withFixed, withLoadedStructure, withoutModes,
  withParameter, withParentModes, withModeCif, modeCifOf, withPattern, withPositionMode, withPosterior, withReset, withSameCellSubgroup, withSiteTotal, withSpinModel, withSubgroup, withSupercellChild, workspaceOf, type AgentBoxcarPlan, type SupercellChoice,
} from "@/app/pdfPage";
import { SiteTotals } from "@/app/ui/SiteTotals";
import { DistortionModesPanel } from "@/app/ui/DistortionModesPanel";
import { SubgroupsPanel, decentringIrrepTree, gammaIrrepTree, sameCellLattice, supercellPointsOf, type IrrepSubgroup, type SameCellNode } from "@/app/ui/SubgroupsPanel";
import { sharedSites, siteSumRangeWarnings } from "@/core/workflow/structureRefinement";

// Lazy so three.js stays out of the main bundle until the 3D view is opened.
const StructureView = lazy(() => import("@/app/ui/StructureView").then((m) => ({ default: m.StructureView })));
import { ParameterPanel } from "@/app/ui/ParameterPanel";
import { PosteriorPanel } from "@/app/ui/PosteriorPanel";
import { ReciprocalPanel } from "@/app/ui/ReciprocalPanel";
import { BoxcarPanel, stepIndexFor, type BoxcarRun } from "@/app/ui/BoxcarPanel";
import { boxcarPlanIssue, boxcarScannedMax, boxcarWindows, type BoxcarDirection } from "@/core/workflow/pdfBoxcar";
import type { SampleResult } from "@/core/refinement/bayes/sampler";
import { SummaryCards, type SummaryCardData } from "@/app/ui/SummaryCards";
import { WorkbenchPlot } from "@/app/ui/WorkbenchPlot";
import { SegmentedToggle } from "@/app/ui/SegmentedToggle";
import { downloadBlob, downloadText } from "@/app/download";
import { zipStore } from "@/core/export/zip";
import { structureToCif, magneticStructureToMcif } from "@/core/export/cif";
import { reportHtml, type ReportInput } from "@/core/export/report";
import type { MagneticExploration } from "@/app/reportInputs";
import { esdsWithTies } from "@/core/refinement/constraints";
import { card as themeCard, color, mono, secondaryButton, uppercaseLabel, fz, toolbarBtn, resetRangeBtn, space } from "@/app/theme";

const DATA_ACCEPT = ".gr,.sgr,.fgr,.sq,.fq,.dat,.txt,text/plain";
const noop = (): void => {};
const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

/** Rw quality bands for a PDF (fraction): <15 % good · <30 % mediocre · else
 *  poor. PDF Rw runs much higher than Bragg Rwp for equally good fits — and with
 *  correlated G(r) errors it is a relative indicator, not an absolute one. */
function rwInk(rw: number): string {
  if (!Number.isFinite(rw)) return color.ink;
  if (rw < 0.15) return color.okInk;
  if (rw < 0.3) return color.noteInk;
  return color.warnInk;
}

export function PdfWorkbench({ structure, pattern, extraPhases = [], ownStructure = false, client, step = 0, onStep, onMagneticPresent, exportsRef, onLoadData, onLoadCif, onAddPhase, onRemovePhase, presetValues, presetFitRange, restore, stepHistory, agentLink }: {
  structure: StructureModel;
  pattern: PdfPattern;
  /** Active workflow step (0 = refinement, 1 = magnetic PDF analysis). */
  step?: number;
  onStep?: (i: number) => void;
  /** Report whether an mPDF spin model is part of the fit, so the shell's header
   *  can light the Magnetic chip from the nuclear page. */
  onMagneticPresent?: (present: boolean) => void;
  /** Additional crystallographic phases (multi-phase G(r) sum). */
  extraPhases?: readonly StructureModel[];
  /** True once the user replaced the bundled structure — the load button then
   *  appends phases instead of replacing (multi-phase entry point, as powder). */
  ownStructure?: boolean;
  /** Shared compute worker — the fit runs off the main thread, as in powder. */
  client: ComputeClient;
  exportsRef?: EngineExportsRef;
  onLoadData?: (file: File) => void;
  onLoadCif?: (file: File) => void;
  onAddPhase?: (file: File) => void;
  onRemovePhase?: (id: string) => void;
  /** Converged parameter values to open with (bundled demo snapshots). Applied
   *  as value AND initialValue, so Reset returns to the converged state. */
  presetValues?: Record<string, number>;
  /** Fit window to open with (demo snapshots refine a specific window). */
  presetFitRange?: { min: number; max: number };
  /** A saved PDF workspace to reopen (project open). The shell remounts this
   *  page with a fresh key when it opens a project; the workspace seeds the
   *  initial state and overlays the saved parameter rows onto the spec. */
  restore?: PdfWorkspace;
  /** The shell's step history: recorded at this page's refinements and model changes. */
  stepHistory?: HistoryBinding;
  /** Where this page publishes its Agent port (agent/port.ts). */
  agentLink?: AgentLink;
}): JSX.Element {
  // The page: what was loaded and every setting that is saved with a project
  // or changes the fit (pdfPage.ts, whose operations the Agent's headless page
  // runs too). Each change returns the next page with its rows already
  // rebuilt, so no render pairs the old rows with a new spec. A reopened
  // project seeds it once, on mount: the shell remounts this page with a fresh
  // key when it opens one.
  const [model, setModel] = useState(() =>
    pdfPage(structure, pattern, {
      extraPhases,
      preset: { ...(presetValues ? { values: presetValues } : {}), ...(presetFitRange ? { fitRange: presetFitRange } : {}) },
      ...(restore ? { restore } : {}),
    }),
  );
  // The page as it is now, for a fit or scan that lands after a change.
  const modelRef = useRef(model);
  modelRef.current = model;
  const view = useMemo(() => pageView(model), [model]);
  const { positionMode, modes, params, result, fitRange, boxcarPlan: boxcarPlanState, boxcarRun, sample } = model;
  const { multiPhase, spinFit, symModes, modeSet, fitStructure, adpModel, phases, spec, refinedMagnetic, mpdfCurves, curves, motionConflict, adpWarning, radiationWarning } = view;
  // Another structure, other phases or another G(r) on this page (it is keyed
  // on the data's id): the rows are built afresh (on change only — the mount
  // render may carry a restored state).
  useOnChange(structure, () => setModel((m) => withLoadedStructure(m, structure)));
  // Every phase's shared sites (one per site key), for their totals in the Occupancy group.
  const pdfSharedSites = useMemo(() => {
    const seen = new Set<string>();
    return [model.loaded, ...model.extraPhases].flatMap((ph) => sharedSites(ph.sites)).filter((site) => !seen.has(site.key) && (seen.add(site.key), true));
  }, [model.loaded, model.extraPhases]);
  useOnChange(extraPhases, () => setModel((m) => withExtraPhases(m, extraPhases)));
  useOnChange(pattern, () => setModel((m) => withPattern(m, pattern)));
  // Mode selected in the 3D card's table (DistortionModesPanel): its
  // eigenvector (unit-amplitude displacement field) is drawn as green arrows
  // on the 3D model. Click the row to toggle; any mode-set change invalidates
  // the selection.
  const [shownModeId, setShownModeId] = useState<string | null>(null);
  useEffect(() => setShownModeId(null), [modeSet]);
  const shownMode = (shownModeId !== null ? modeSet?.modes.find((m) => m.id === shownModeId) : undefined) ?? null;
  // Modes by parent irrep (a supercell child, a decomposition, a mode CIF) can be saved as an ISODISTORT mode CIF.
  const modeCifAvailable = modeSet !== null && modeSet.parent !== undefined && modeSet.modes.length > 0 && modeSet.modes.every((m) => m.irrep !== undefined);
  const [busy, setBusy] = useState(false);
  // Live calculated curve streamed from the worker during a refinement.
  const [live, setLive] = useState<number[] | null>(null);
  // Plot-card view: the fit, the refined 3D structure (per phase) with the
  // distortion modes being refined, the subgroup page where the symmetry is
  // lowered, the Bayesian posterior, or the boxcar (r-resolved) scan.
  const [viewTab, setViewTab] = useState<"fit" | "reciprocal" | "model3d" | "subgroups" | "posterior" | "boxcar">("fit");
  // The S(Q) tab exists only for a pattern transformed from Q-space data; a
  // later G(r) load must not strand the page on a view it no longer offers.
  const hasReciprocal = pattern.reciprocal !== undefined;
  // The G(r) plot keeps its zoom until another dataset loads.
  const plotViewKey = useMemo(() => ({ pattern }), [pattern]);
  useEffect(() => {
    if (!hasReciprocal && viewTab === "reciprocal") setViewTab("fit");
  }, [hasReciprocal, viewTab]);
  // ±σ ribbon on G(r): the σ propagated from S(Q), or the file's own dG column.
  const gSigma = useMemo(
    () => (pattern.points.length > 0 && pattern.points.every((p) => p.sigma !== undefined && Number.isFinite(p.sigma)) ? pattern.points.map((p) => p.sigma!) : null),
    [pattern],
  );
  const [showGSigma, setShowGSigma] = useState(true);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleProgress, setSampleProgress] = useState<{ step: number; total: number } | null>(null);
  const [viewPhase, setViewPhase] = useState(0);
  const [focusFitToken, setFocusFitToken] = useState(0);

  // The 3D view tracks the refinement: the refined cell/positions/ADPs of the phase shown.
  const viewStructure = view.refinedPhases[Math.min(viewPhase, phases.length - 1)]!;

  // The structure the magnetic page analyses: `viewStructure` re-mints on every
  // parameter edit, and the magnetic step (app/magneticStep.ts) keys its heavy symmetry enumerations (the
  // magnetic subgroup lattice, the irrep decomposition) on structure IDENTITY —
  // so feeding it directly would re-run the whole enumeration on every
  // keystroke in the refinement panel, while the magnetic page is not even
  // visible. Snapshot it instead: the magnetic page always opens on the current
  // refined structure, and holds it while the user is back on step 0. (Both
  // step panels stay mounted, so "not visible" is not "not computing".)
  const [magneticStructure, setMagneticStructure] = useState(viewStructure);
  useEffect(() => {
    if (step === 1) setMagneticStructure(viewStructure);
  }, [step, viewStructure]);

  const rFirst = pattern.points[0]?.r ?? 0;
  const rLast = pattern.points[pattern.points.length - 1]?.r ?? 1;

  // Decomposition overlays (P3): per-phase contributions on a multi-phase fit,
  // element-pair (Faber–Ziman) partials on a single-phase fit with ≥2 elements.
  const nElements = useMemo(() => new Set(structure.sites.map((s) => s.element)).size, [structure]);
  const canOverlay = multiPhase || nElements >= 2;
  const [showPartials, setShowPartials] = useState(false);
  const partials = useMemo(() => {
    if (!showPartials || !canOverlay) return null;
    return multiPhase
      ? pdfPhaseCurves(phases, pattern, params, spec.bindings, fitRange)
      : pdfPartialCurves(fitStructure, pattern, params, spec.bindings, fitRange);
  }, [showPartials, canOverlay, multiPhase, phases, fitStructure, pattern, params, spec.bindings, fitRange]);

  // Separable nuclear/magnetic overlay — the real-space analog of the powder
  // page's magnetic component curve. Always on when a spin model is applied:
  // seeing how much of G(r) the spins carry is the whole point of the page.
  // Free (no extra evaluation): the parts come from the same mPDF evaluation
  // that produced the total.
  const magneticOverlay = useMemo(
    () =>
      mpdfCurves
        ? [{ label: "nuclear", y: mpdfCurves.yNuclear }, { label: "magnetic", y: mpdfCurves.yMagnetic }]
        : null,
    [mpdfCurves],
  );
  const overlays = partials ?? magneticOverlay;
  const plotCurves = useMemo(() => {
    if (!live) return curves;
    const yCalc = live;
    return { ...curves, yCalc, diff: curves.yObs.map((o, i) => o - (yCalc[i] ?? 0)) };
  }, [curves, live]);

  // Rw over G(r) inside the fit window — computed from the PLOTTED curves so
  // it ticks live while a refinement streams its per-cycle calc. Uniform
  // weights: a relative indicator only (correlated G(r) errors; see core/workflow/pdf.ts).
  const rw = useMemo(() => rwOf(plotCurves, fitRange), [plotCurves, fitRange]);

  const nFree = params.filter((p) => !p.fixed && !p.expression).length;

  /** Switch the primary phase's ADP model (withAdpModel): the new rows seeded from the ADPs as refined so far, entering fixed. */
  function switchAdpModel(anisotropic: boolean): void {
    const next = withAdpModel(model, anisotropic);
    if (next === model) return;
    setModel(next);
    setLive(null);
    stepHistory?.requestStep("settings", anisotropic ? "Anisotropic ADPs" : "Isotropic ADPs");
  }

  // Tell the shell whether a spin model is in the fit (the header's Magnetic
  // chip lights up from the nuclear page); withdrawn when this engine unmounts.
  useEffect(() => {
    onMagneticPresent?.(!!spinFit && spinFit.magnetic.moments.length > 0);
  }, [onMagneticPresent, spinFit]);
  useEffect(() => () => onMagneticPresent?.(false), [onMagneticPresent]);

  /** The Refine button. Resolves to why it did not finish, or null when it did (the Agent reads it). */
  async function runRefine(): Promise<string | null> {
    stepHistory?.recordNow("edit");
    setBusy(true);
    try {
      const outcome = await pdfFit(client, model, (yCalc) => setLive(yCalc));
      if (!landsOn(modelRef.current, outcome.key)) {
        // The parameterization (or the whole problem) changed mid-run; the
        // result's ids belong to the old spec — drop it rather than mixing.
        console.info("[status] refinement result discarded — the parameter spec changed while it ran");
        return "the parameter set changed while it ran, so its result was dropped";
      }
      setModel((m) => withFit(m, outcome));
      stepHistory?.requestStep("refine", outcome.label);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === CANCELLED) {
        console.info("[status] PDF refinement cancelled");
        return "cancelled";
      }
      console.error(`[status] PDF refinement failed: ${msg}`);
      return `failed: ${msg}`;
    } finally {
      setLive(null);
      setBusy(false);
    }
  }

  // Multi-start (one engine, two faces, as powder): a cold start gets the wide
  // "Prefit" search; once a fit exists it's a lighter "Escape min" nudge out of
  // the current basin (pdfThorough).
  async function runMultiStart(): Promise<string | null> {
    stepHistory?.recordNow("edit");
    setBusy(true);
    try {
      const outcome = await pdfThorough(client, model, (yCalc) => setLive(yCalc));
      if (!landsOn(modelRef.current, outcome.key)) {
        console.info("[status] multi-start result discarded — the parameter spec changed while it ran");
        return "the parameter set changed while it ran, so its result was dropped";
      }
      setModel((m) => withFit(m, outcome));
      stepHistory?.requestStep("refine", outcome.label);
      console.info(`[status] PDF multi-start (${outcome.label === "Prefit" ? "prefit" : "escape"}): ${outcome.summary}`);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === CANCELLED) {
        console.info("[status] PDF multi-start cancelled");
        return "cancelled";
      }
      console.error(`[status] PDF multi-start failed: ${msg}`);
      return `failed: ${msg}`;
    } finally {
      setLive(null);
      setBusy(false);
    }
  }

  // ---- Boxcar (sliding r-window) scan --------------------------------------
  // A fixed-width box slid across the fit window, refined at each position and
  // seeded from the previous one: the r-resolved view of the SAME model, which
  // is how a local structure that differs from the average one shows up. The
  // plan is edited in the Boxcar tab (it shapes that view and nothing else).
  // `randomStart` guards `restarts`: seeding every box from the previous one
  // makes the series path-dependent, so one box that falls into a local
  // minimum hands it to every box after it — restarts re-search each box
  // around its seed and keep the best, at (restarts + 1)× the cost.
  const [boxcarBusy, setBoxcarBusy] = useState(false);
  const [boxcarProgress, setBoxcarProgress] = useState<{ done: number; total: number } | null>(null);
  // The tab scans its OWN r bounds (the fit window until it is edited or a
  // scan runs) and starts from the current fit with any edits made on the tab.
  const boxcarRange = boxcarRangeOf(model);
  const boxcarPlan = useMemo(
    () => ({ range: { min: boxcarRange.min, max: boxcarRange.max }, width: boxcarPlanState.width, step: boxcarPlanState.step }),
    [boxcarRange.min, boxcarRange.max, boxcarPlanState.width, boxcarPlanState.step],
  );
  const boxcarIssue = useMemo(() => boxcarTabIssue(model), [model]);
  const boxcarWindowList = useMemo(() => (boxcarIssue ? [] : boxcarWindows(boxcarPlan)), [boxcarPlan, boxcarIssue]);
  // Where the last box's right edge lands: a plan rarely divides the window
  // evenly, and silently ignoring the tail would misreport what was scanned.
  const boxcarScanned = useMemo(() => (boxcarIssue ? null : boxcarScannedMax(boxcarPlan)), [boxcarPlan, boxcarIssue]);
  const boxcarStart = useMemo(() => ({ rows: boxcarStartRows(model), current: boxcarStartIsCurrent(model) }), [model]);
  const boxcarBlocked =
    boxcarIssue ??
    (boxcarStart.rows.every((r) => !r.free)
      ? "No parameters to refine — tick at least one under Starting point."
      : null);

  /**
   * Run the scan (pdfBoxcar): every box refines the current free set inside
   * its own window, the page's window and rows untouched, and the plot fills
   * in box by box. A cancelled scan keeps the boxes already fitted. Resolves
   * to the finished run, or null when it stopped or the page changed under it.
   */
  async function runBoxcar(override?: AgentBoxcarPlan): Promise<BoxcarRun | null> {
    // The Agent passes its own plan: it becomes the panel's plan, and the
    // Boxcar view opens so the user watches the scan fill in.
    // The Agent's scan runs on the fit window from the rows as they are (its
    // tool is unchanged); the tab's Run scans the tab's own range from the
    // tab's starting point.
    const plan = override ? agentBoxcarPlan(boxcarPlanState, override) : boxcarTabScanPlan(model);
    const span = plan.range ?? fitRange;
    const windows = boxcarWindows({ range: { min: span.min, max: span.max }, width: plan.width, step: plan.step });
    if (override) {
      const issue = boxcarPlanIssue({ range: { min: fitRange.min, max: fitRange.max }, width: override.width, step: override.step });
      if (issue) throw new Error(issue);
      // The panel shows the plan the Agent ran, its range included.
      setModel((m) => withBoxcarPlan(m, { width: plan.width, step: plan.step, direction: plan.direction, randomStart: plan.randomStart, restarts: plan.restarts, range: { min: fitRange.min, max: fitRange.max } }));
      setViewTab("boxcar");
    } else {
      if (boxcarIssue) return null;
      // From the first scan on, the range is the tab's own: moving the fit
      // window on the Refinement tab no longer moves it.
      setModel((m) => (m.boxcarPlan.range ? m : withBoxcarRange(m, span)));
    }
    if (windows.length === 0) return null;
    const key = specKeyOf(model);
    setBoxcarBusy(true);
    // Clear the previous run: leaving it on screen while a new scan streams in
    // would show two different scans' numbers in one plot.
    setModel((m) => withBoxcarRun(m, null, key));
    try {
      const out = await pdfBoxcar(client, model, plan, {
        onRun: (run) => setModel((m) => withBoxcarRun(m, run, key)),
        onProgress: (done, total) => setBoxcarProgress({ done, total }),
      });
      if (!landsOn(modelRef.current, out.key)) {
        console.info("[status] boxcar result discarded — the parameter spec changed while it ran");
        return null;
      }
      if (out.stopped) {
        const kept = out.run ? out.run.series.reduce((n, d) => n + d.result.steps.length, 0) : 0;
        const keptNote = kept > 0 ? ` — keeping the ${kept} box${kept === 1 ? "" : "es"} already fitted` : "";
        if (out.stopped === "cancelled") console.info(`[status] boxcar scan cancelled${keptNote}`);
        else console.error(`[status] boxcar scan failed: ${out.stopped.failed}${keptNote}`);
        return null;
      }
      if (out.run) console.info(`[status] boxcar: ${boxcarSummary(model, out.run, plan.direction)}`);
      return out.run;
    } catch (e) {
      console.error(`[status] boxcar scan failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      setBoxcarProgress(null);
      setBoxcarBusy(false);
    }
  }

  function cancelBoxcar(): void {
    client.cancel();
  }

  /** Load one box's refined values onto the parameter rows (withBoxcarStep): the last fit is cleared, its esds being the whole window's. */
  function adoptBoxcarStep(seriesIndex: number, windowIndex: number): void {
    const adopted = withBoxcarStep(model, seriesIndex, windowIndex);
    if (!adopted) return;
    setModel(adopted.model);
    setLive(null);
    stepHistory?.requestStep("edit", `Adopted the ${adopted.center.toFixed(2)} Å box's values`);
    console.info(`[status] ${adopted.note}`);
  }

  /** One row per box; a compared run repeats the value columns per direction,
   *  so both passes travel together in the same file. */
  function exportBoxcarCsv(): void {
    const run = boxcarRun;
    if (!run) return;
    const labelOf = (id: string): string => params.find((p) => p.id === id)?.label ?? id;
    const ids = run.freeIds.filter((id) => run.series[0]?.result.evolution.some((e) => e.parameterId === id));
    const suffix = (d: BoxcarDirection): string => (run.series.length > 1 ? (d === "up" ? "_up" : "_down") : "");
    const header = [
      "rCenter", "rMin", "rMax",
      ...run.series.flatMap((s) => [
        `Rw${suffix(s.direction)}`,
        `status${suffix(s.direction)}`,
        ...ids.flatMap((id) => [`${labelOf(id)}${suffix(s.direction)}`, `${labelOf(id)}_esd${suffix(s.direction)}`]),
      ]),
    ];
    const rows = run.windows.map((w, wi) => {
      const cells: (string | number)[] = [w.center.toFixed(4), w.min.toFixed(4), w.max.toFixed(4)];
      for (const s of run.series) {
        const si = stepIndexFor(s, wi, run.windows.length);
        const step = si >= 0 ? s.result.steps[si] : undefined;
        cells.push(step?.result.agreement.rWeighted ?? "", step?.result.status ?? "");
        for (const id of ids) {
          const evo = s.result.evolution.find((e) => e.parameterId === id);
          cells.push(si >= 0 ? evo?.values[si] ?? "" : "", si >= 0 ? evo?.esd[si] ?? "" : "");
        }
      }
      return cells.join(",");
    });
    downloadText(`${pattern.id}_boxcar.csv`, `${header.join(",")}\n${rows.join("\n")}\n`, "text/csv");
  }

  /**
   * Sample the Bayesian posterior of the free parameters (pdfPosterior): a
   * fresh run poses the current problem; Continue re-poses the run's own
   * request with its resume token, so the chain keeps targeting the same
   * posterior even if the user edited parameters meanwhile.
   */
  async function runSample(continueRun: boolean, steps = SAMPLE_STEPS): Promise<SampleResult | string> {
    setSampleBusy(true);
    const from = continueRun && sample ? sample.result.resume.stepIndex : 0;
    setSampleProgress({ step: from, total: from + steps });
    try {
      const out = await pdfPosterior(client, model, continueRun, steps, (s, total) => {
        if (s % 5 === 0 || s === total) setSampleProgress({ step: s, total });
      });
      if (!landsOn(modelRef.current, out.key)) {
        console.info("[status] posterior result discarded — the parameter spec changed while it ran");
        return "discarded: the parameters changed while it ran";
      }
      setModel((m) => withPosterior(m, out.sample, out.key));
      const res = out.sample.result;
      console.info(
        `[status] posterior ${continueRun && sample ? "continued" : "sampled"}: ${res.status} · R̂max ${res.diagnostics.maxRHat.toFixed(3)} · ESSmin ${Math.round(res.diagnostics.minEss)} · ${res.diagnostics.nSamples} samples`,
      );
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[status] posterior sampling failed: ${msg}`);
      return `failed: ${msg}`;
    } finally {
      setSampleProgress(null);
      setSampleBusy(false);
    }
  }

  function onParamChange(id: string, patch: Partial<RefinementParameter>): void {
    setModel((m) => withParameter(m, id, patch));
  }
  // ---- The Subgroups page: where the symmetry is lowered -------------------
  // Both trees are the LOADED structure's, computed only while the Subgroups
  // tab is visible; single-phase only (SubgroupsPanel renders them).
  //
  // Γ irrep tree (potential distortion modes, requirement 3): which irreps of
  // the loaded group could carry a symmetry-breaking distortion, and — per
  // irrep — which isotropy subgroups its modes lead to (gammaIrrepTree). It
  // enumerates the PARENT's irreps, so it is only offered from the pristine
  // parent state — an active mode set (activation or parent-CIF) lives in a
  // different setting whose irreps/labels would not match; the user clears it
  // (✕) first.
  const subgroupTree = useMemo(
    () => (multiPhase || viewTab !== "subgroups" || modes !== null ? null : gammaIrrepTree(structure)),
    [multiPhase, viewTab, structure, modes],
  );

  // Structural subgroup lattice: the full translationengleiche group–subgroup
  // tree of the loaded space group (every t-subgroup named, with
  // covering/Bärnighausen edges and conjugacy grouping) — the "search for
  // subgroups" step: pick a target subgroup and activate the distortion modes
  // it permits. Independent of `modes` (it is the parent's lattice, unchanged
  // by an active distortion).
  const subgroupLattice = useMemo(
    () => (multiPhase || viewTab !== "subgroups" ? null : structuralSubgroupLattice(structure)),
    [multiPhase, viewTab, structure],
  );

  // The decentring irreps of a centred parent (X for F, H for I, …: the
  // k-points that keep the conventional cell) and the same-cell lattice's k-
  // and general subgroups — Phase 1 of the subgroup engine. As the Γ tree,
  // the irreps are offered only from the parent's own state.
  const decentringTree = useMemo(
    () => (multiPhase || viewTab !== "subgroups" || modes !== null ? null : decentringIrrepTree(structure)),
    [multiPhase, viewTab, structure, modes],
  );
  const sameCell = useMemo(
    () => (multiPhase || viewTab !== "subgroups" ? [] : sameCellLattice(structure)),
    [multiPhase, viewTab, structure],
  );
  const supercellNote = useMemo(() => (viewTab !== "subgroups" ? null : supercellPointsOf(structure)), [viewTab, structure]);

  // A k- or general subgroup of the same-cell lattice (withSameCellSubgroup).
  function onActivateSameCell(node: SameCellNode): void {
    const activated = withSameCellSubgroup(model, node);
    if (activated.model === model) {
      console.error(`[status] ${activated.message}`);
      return;
    }
    setModel(activated.model);
    setLive(null);
    stepHistory?.requestStep("settings", `Distortion modes: ${activated.label}`);
    console.info(`[status] ${activated.message}`);
  }

  // A cell-multiplying child from the supercell view (withSupercellChild): the
  // child realised in its own cell and refined there, its symmetry-breaking
  // displacements free from the starting kick.
  function onActivateSupercell(choice: SupercellChoice): void {
    const activated = withSupercellChild(model, choice);
    if (activated.model === model) {
      console.error(`[status] ${activated.message}`);
      return;
    }
    setModel(activated.model);
    setLive(null);
    stepHistory?.requestStep("settings", `Supercell child: ${activated.label}`);
    console.info(`[status] ${activated.message}`);
  }

  // Activate a chosen SUBGROUP (subgroup-driven, the inverse of the irrep-driven
  // path; withSubgroup): the child realized from the current refined geometry,
  // with every distortion it permits as an amplitude: the order parameter that
  // lowers the parent to it free at the starting kick (χ² is stationary along
  // every symmetry-breaking mode at the parent's geometry), the others at 0,
  // fixed, for the user to free.
  function onActivateSubgroup(node: SubgroupNode): void {
    const activated = withSubgroup(model, node);
    if (activated.model === model) {
      console.error(`[status] ${activated.message}`);
      return;
    }
    setModel(activated.model);
    setLive(null);
    stepHistory?.requestStep("settings", `Distortion modes: ${activated.label}`);
    console.info(`[status] ${activated.message}`);
  }

  // Activate one symmetry-breaking mode (withActivatedMode): the isotropy
  // subgroup's child realized, the activated field the leading free amplitude
  // with a small starting kick.
  function onActivateMode(term: DisplaciveIrrepTerm, sub: IrrepSubgroup): void {
    const activated = withActivatedMode(model, term, sub);
    if (activated.model === model) {
      console.error(`[status] ${activated.message}`);
      return;
    }
    setModel(activated.model);
    setLive(null);
    stepHistory?.requestStep("settings", `Distortion modes: ${activated.label}`);
    console.info(`[status] ${activated.message}`);
  }

  // Decompose the current (child) structure against a HIGH-SYMMETRY parent CIF
  // into refinable distortion-mode amplitudes. The seeded amplitudes reproduce
  // the loaded structure exactly, so activating modes never changes the curve.
  async function onLoadParentCif(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parent = parseCif(text, `parent-${Date.now().toString(36)}`);
      const decomposed = withParentModes(modelRef.current, parent, parent.name || file.name.replace(/\.[^.]+$/, ""));
      if (decomposed.model === modelRef.current) {
        console.error(`[status] distortion modes: ${decomposed.message}.`);
        return;
      }
      setModel(decomposed.model);
      setLive(null);
      stepHistory?.requestStep("settings", `Distortion modes against ${parent.name || file.name}`);
      console.info(`[status] distortion modes: ${decomposed.message}`);
    } catch (e) {
      console.error(`[status] parent CIF failed to parse: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // An ISODISTORT mode CIF (withModeCif): its child and modes in force, the
  // amplitudes as the file gives them; with the parent loaded, the child in
  // its own cell.
  async function onLoadModeCif(file: File): Promise<void> {
    try {
      const parsed = parseModeCif(await file.text(), modelRef.current.loaded.id);
      const loadedModes = withModeCif(modelRef.current, parsed, file.name);
      if (loadedModes.model === modelRef.current) {
        console.error(`[status] mode CIF: ${loadedModes.message}`);
        return;
      }
      setModel(loadedModes.model);
      setLive(null);
      stepHistory?.requestStep("settings", `Mode CIF: ${loadedModes.label}`);
      console.info(`[status] mode CIF: ${loadedModes.message}`);
    } catch (e) {
      console.error(`[status] mode CIF failed to read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** The modes in force as an ISODISTORT mode CIF (modeCifOf), downloaded. */
  function exportModeCif(): void {
    const out = modeCifOf(modelRef.current);
    if (!out) return;
    downloadText(out.fileName, out.text, "chemical/x-cif");
  }

  /** Values back to their starting values, every row and free/fixed choice kept — as on the powder page. */
  function reset(ids?: readonly string[]): void {
    setModel((m) => withReset(m, ids));
    setLive(null);
    stepHistory?.requestStep("edit", ids ? `Reset ${[...new Set(ids)].join(", ")}` : "Reset to starting values");
  }

  /** Stop the running refinement or multi-start; the parameters keep their values. */
  function cancelRefine(): void {
    client.cancel();
  }
  // The mPDF page's current candidate, for the report — published by KSearchPanel;
  // null when nothing is selected there. The same contract the powder and
  // single-crystal pages use, so "report: Export ▾" means the same on all three.
  const exploredMagnetic = useRef<MagneticExploration | null>(null);
  const publishExploration = useCallback((m: MagneticExploration | null): void => {
    exploredMagnetic.current = m;
  }, []);

  const reportInputRef = useRef<() => ReportInput>(() => { throw new Error("PdfWorkbench: not mounted"); });
  reportInputRef.current = (): ReportInput => reportInputOf(model, { explored: exploredMagnetic.current, rw });
  // Publish the Agent port (agent/port.ts): the live state, read lazily, and
  // this page's own handlers — the Agent's `refine` is the Refine button.
  // Republished every render, so a call always sees the state on screen.
  useEffect(() => {
    if (!agentLink) return;
    agentLink.publish({
      technique: "pdf",
      state: () => liveStateOf(model, { busy: busy || boxcarBusy || sampleBusy, rw }),
      setFixed: (changes) => setModel((m) => withFixed(m, changes)),
      setAdpModel: switchAdpModel,
      setFitRange: (range) => setModel((m) => withFitRange(m, range)),
      refine: runRefine,
      thorough: runMultiStart,
      boxcar: (plan) => runBoxcar(plan),
      samplePosterior: async ({ continue: continueRun, steps }) => {
        if (sampleBusy) return "a posterior run is already going";
        if (continueRun && !sample) return "there is no posterior run to continue: sample first";
        setViewTab("posterior");
        return runSample(continueRun, steps);
      },
      reportInput: () => reportInputRef.current(),
      // The Refine button's request with the Agent's options; the result is only read.
      probe: (options) => pdfProbe(client, model, options),
      cancel: cancelRefine,
      reset,
    });
  });
  useEffect(() => () => agentLink?.release("pdf"), [agentLink]);
  // Exports published to the app header (engine contract): the output triple —
  // refined curves (CSV), refined structure(s) (CIF with esds + Rw meta), and
  // the markdown report.
  const exportCsvRef = useRef<() => void>(noop);
  exportCsvRef.current = (): void => {
    const rows = curves.x.map((r, i) => `${r},${curves.yObs[i]},${curves.yCalc[i]},${curves.diff[i]}`);
    downloadText(`${pattern.id}.csv`, `r,Gobs,Gcalc,diff\n${rows.join("\n")}\n`, "text/csv");
  };
  // CIF for one phase. `target` MUST already have the parameters applied (as
  // `viewStructure` does), never `phase.structure`: structureToCif reads the
  // coordinates and cell straight off the model and takes the parameters only
  // for their esds, so the starting model would be written with pre-refinement
  // values annotated by post-refinement uncertainties.
  //
  // A refined spin model makes the output an mCIF (as on the powder page): a
  // plain CIF cannot carry moments, so exporting one would silently drop the
  // magnetic half of the refinement. The caller decides which phase carries the
  // moments — only the spin-fit phase does — and the esd/Rw metadata is built
  // once here for both flavours.
  const exportPhaseCifRef = useRef<(target: StructureModel, id: string, magnetic?: MagneticModel | null) => void>(() => {});
  exportPhaseCifRef.current = (target: StructureModel, id: string, magnetic?: MagneticModel | null): void => {
    // A tied row (a shared site's last occupancy) carries its tie's esd, as the report does.
    const esds = esdsWithTies(params, result);
    const withEsd = params.map((p) => {
      const esd = esds[p.id] ?? p.esd;
      return esd !== undefined ? { ...p, esd } : { ...p };
    });
    const meta = {
      rwp: rw * 100,
      nRef: curves.x.filter((r) => r >= fitRange.min && r <= fitRange.max).length,
      nParam: nFree,
    };
    const opts = { params: withEsd, bindings: spec.bindings, refinement: meta };
    if (magnetic && magnetic.moments.length > 0) {
      downloadText(`${target.name || id}_mpdf.mcif`, magneticStructureToMcif(target, magnetic, opts), "chemical/x-cif");
      return;
    }
    downloadText(`${target.name || id}_pdf.cif`, structureToCif(target, opts), "chemical/x-cif");
  };
  /** The moments to write with a phase, or null when it is purely nuclear. */
  const phaseMagnetic = (phaseStructure: StructureModel): MagneticModel | null =>
    spinFit && phaseStructure === fitStructure ? refinedMagnetic ?? spinFit.magnetic : null;
  const exportCifRef = useRef<() => void>(noop);
  exportCifRef.current = (): void => {
    // The header export writes every phase; each one needs its own bindings so
    // a multi-phase fit does not cross-apply another phase's cell.
    phases.forEach((phase, i) => exportPhaseCifRef.current(view.refinedPhases[i]!, phase.id, phaseMagnetic(phase.structure)));
  };
  const exportReportRef = useRef<() => void>(noop);
  exportReportRef.current = (): void => {
    downloadText(`${pattern.id}_report.html`, reportHtml(reportInputRef.current()), "text/html");
  };
  // The PDFgui / diffpy-CMI cross-check bundle: the model as PDFfit2 takes it,
  // the data, a script that refines exactly the free rows there, and the
  // PDFgui project builder (pdfPage.pdfguiBundleOf).
  const exportPdfguiRef = useRef<() => void>(noop);
  exportPdfguiRef.current = (): void => {
    try {
      const entries = pdfguiBundleOf(model, { rw });
      const base = (structure.name || structure.id).normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "structure";
      downloadBlob(`${base}_pdfgui.zip`, zipStore(entries), "application/zip");
    } catch (e) {
      console.error(`[status] PDFgui / diffpy-CMI bundle failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // The project snapshot reads the live state through a ref (like the exports
  // above), so the shell's stable handler always sees the current page.
  const projectWorkspaceRef = useRef<() => PdfWorkspace>(() => { throw new Error("PdfWorkbench: not mounted"); });
  projectWorkspaceRef.current = () => workspaceOf(model);
  useEffect(() => {
    if (!exportsRef) return;
    exportsRef.current = {
      csv: () => exportCsvRef.current(),
      cif: () => exportCifRef.current(),
      report: () => exportReportRef.current(),
      pdfguiBundle: () => exportPdfguiRef.current(),
      projectWorkspace: () => projectWorkspaceRef.current(),
    };
    return () => { exportsRef.current = null; };
  }, [exportsRef]);

  const probeLabel = pattern.scatteringType === "neutron" ? "Neutron" : "X-ray";
  const summaryCards: SummaryCardData[] = [
    {
      label: "Structure",
      // Once the user owns the structure, the button appends phases (multi-phase
      // G(r) sum) instead of replacing — mirroring the powder card's behaviour.
      loadLabel: ownStructure && onAddPhase ? "Add CIF…" : "Load CIF…",
      accept: ".cif,.mcif,.ins,.res,text/plain",
      onFile: (ownStructure && onAddPhase ? onAddPhase : onLoadCif) ?? noop,
      chip: multiPhase ? `✓ ${phases.length} phases` : "✓ parsed",
      title: multiPhase
        ? phases.map((p) => p.structure.name || p.id).join(" + ")
        : `${structure.name || "structure"} · ${structure.spaceGroup.hermannMauguin ?? "—"}`,
      meta: `a ${structure.cell.a.toFixed(4)} · b ${structure.cell.b.toFixed(4)} · c ${structure.cell.c.toFixed(4)} Å · ${structure.sites.length} sites`,
      ...(multiPhase && onRemovePhase
        ? {
            phaseBadges: phases.map((p, i) => ({ id: p.id, label: p.structure.name || p.id, removable: i > 0 })),
            onRemovePhase,
          }
        : {}),
    },
    {
      label: "Data · PDF G(r)",
      loadLabel: "Load data…",
      accept: DATA_ACCEPT,
      onFile: onLoadData ?? noop,
      chip: "✓ reduced G(r)",
      title: pattern.name,
      meta:
        `${probeLabel}${pattern.radiationAssumed ? " (assumed)" : ""} · r ${rFirst.toFixed(2)}–${rLast.toFixed(2)} Å · ${pattern.points.length} pts` +
        (pattern.qmax !== undefined ? ` · Qmax ${pattern.qmax.toFixed(1)} Å⁻¹` : "") +
        (pattern.sourceKind === "sq" ? " · from S(Q)" : pattern.sourceKind === "fq" ? " · from F(Q)" : "") +
        (pattern.reciprocal?.sigma ? " ± σ" : "") +
        (pattern.composition ? ` · ${pattern.composition}` : ""),
    },
  ];

  // Mirrors the powder page's "Magnetic analysis →" slot. Live for neutron
  // single-phase data; dimmed (with the reason) otherwise.
  const magneticBlockedReason = multiPhase
    ? "Magnetic PDF is single-phase: the mPDF spec builds on the single-phase nuclear one. Remove the extra phases to analyse the spin structure."
    : pattern.scatteringType !== "neutron"
      ? "Magnetic PDF needs neutron total-scattering data — X-rays have no dipole coupling to spins, so the magnetic G(r) would be identically zero."
      : null;
  const refineActions = (
    <button
      style={{
        ...secondaryButton, flex: "0 0 auto", padding: "10px 13px", fontSize: 13,
        ...(magneticBlockedReason ? { opacity: 0.5, cursor: "default" } : {}),
      }}
      disabled={magneticBlockedReason !== null || busy}
      onClick={() => onStep?.(1)}
      title={magneticBlockedReason ?? "Magnetic PDF (mPDF): pick the magnetic ions and propagation vector, read the allowed spin models, and co-refine the moments against the magnetic G(r)."}
    >
      Magnetic PDF →
    </button>
  );

  // Moment-fit backend handed to the (shared) symmetry panel: it fits the freed
  // moment amplitudes against this G(r) with the nuclear model held fixed — the
  // real-space sibling of the single-crystal F² backend (momentFit).
  const magneticFit: MagneticFit = {
    agreementLabel: "Rw",
    // The mPDF spin field is a periodic box, so an incommensurate k has nothing
    // to sum over. The panel disables the moment fit, the ranking run, Apply and
    // Continue, and shows this reason instead of a number.
    unsupportedK: unsupportedMpdfK,
    // Each of the ranking's starts keeps this fit's own seeded restarts: the mPDF needs them to find a group's minimum.
    nestedStarts: true,
    refine: (mag, momentParams, mBindings) => momentFit(client, model, mag, momentParams, mBindings),
  };

  /** Adopt a spin model from the magnetic page. Replaced wholesale (never
   *  merged) so a second pass through the panel cannot leave stale moment rows
   *  behind (withSpinModel). */
  function adoptSpinModel(
    magnetic: MagneticModel,
    momentParams: readonly RefinementParameter[],
    momentBindings: readonly ParameterBinding[],
  ): void {
    // The step hands its rows free as a fit frees them (magneticStep.ts, handoff); this page has taken them held, as built.
    const held = momentParams.map((p) => ({ ...p, fixed: true }));
    const adopted = withSpinModel(model, { magnetic, params: held, bindings: momentBindings });
    if (adopted.message) {
      console.info(`[status] spin model NOT applied to the PDF fit — ${adopted.message}`);
      return;
    }
    setModel(adopted.model);
    setLive(null);
    stepHistory?.requestStep("magnetic", "Spin model added to the fit");
    const nMoment = momentParams.filter((p) => isMomentParameterKind(p.kind)).length;
    console.info(
      `[status] spin model applied to the PDF fit — ${nMoment} moment parameter${nMoment === 1 ? "" : "s"} added. ` +
      "Refine now fits nuclear + magnetic G(r) together.",
    );
  }

  /** "Show on refinement pattern" — a preview of the model's own moments (no
   *  refinable rows). Same commensurability gate as {@link adoptSpinModel}. */
  function previewSpinModel(magnetic: MagneticModel | null): void {
    const shown = withSpinModel(model, magnetic ? { magnetic, params: [], bindings: [] } : null);
    if (shown.message) {
      console.info(`[status] spin model NOT shown on the PDF fit — ${shown.message}`);
      return;
    }
    setModel(shown.model);
    setLive(null);
    stepHistory?.requestStep("magnetic", magnetic ? "Spin model shown on the fit" : "Spin model removed");
  }
  return (
    <>
      {/* Step 0 — setup + real-space refinement. Both step panels stay MOUNTED
          (display:none) rather than being swapped: the magnetic step's store, which
          KSearchPanel makes, holds the ion selection, k, framework and subgroup
          picks, and unmounting loses them. */}
      {/* The step wrapper carries the page's own vertical gutter: it sits
          between `.wb-main` and its children, so without a gap of its own the
          rows inside it would butt together while every other page's rows are
          spaced. */}
      {/* `auto 1fr` hands the leftover height to the working row, the way the
          powder page's rows get it directly from `.wb-main`. */}
      <div style={{ display: step === 1 ? "none" : "grid", gap: space.gap, gridTemplateRows: "auto 1fr", gridTemplateColumns: "minmax(0, 1fr)", flex: 1, minHeight: 0 }}>
      <SummaryCards cards={summaryCards} />
      <div className="wb-work2">
        <div data-agent-card="pattern" style={{ ...themeCard, padding: space.inset, display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={uppercaseLabel}>
              {viewTab === "fit"
                ? "PDF pattern — G(r)"
                : viewTab === "reciprocal"
                  ? "Reduced data — S(Q) the G(r) was transformed from"
                  : viewTab === "model3d"
                  ? "Crystal structure — unit cell"
                  : viewTab === "posterior"
                    ? "Bayesian posterior — free parameters"
                    : viewTab === "boxcar"
                      ? "Boxcar scan — parameters vs box center r"
                      : "Lower the symmetry — group–subgroup tree"}
            </span>
            {viewTab === "fit" && (
              <span style={{ display: "flex", gap: 14, fontFamily: mono, fontSize: 12.5 }}>
                <span style={{ color: color.secondary }} title="Rw over G(r) inside the fit window (uniform weights). G(r) point errors are correlated, so treat as a relative indicator.">
                  Rw <b style={{ color: rwInk(rw) }}>{Number.isFinite(rw) ? pct(rw) : "—"}</b>
                </span>
              </span>
            )}
            {viewTab === "fit" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: mono, fontSize: fz.micro, color: color.secondary }} title="The r window used for refinement (set with the blue handles). Low r below r_poly is reduction artifact.">
                fit {fitRange.min.toFixed(2)}–{fitRange.max.toFixed(2)} Å
                <button style={resetRangeBtn} onClick={() => setModel((m) => withFitRange(m, null))} title="Reset to the default window">Reset range</button>
              </span>
            )}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, rowGap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {viewTab === "fit" && gSigma && (
                <label
                  style={{ display: "flex", gap: 5, alignItems: "center", fontSize: fz.micro, color: color.secondary, cursor: "pointer" }}
                  title={
                    pattern.transform
                      ? "±1σ ribbon: σ_G(r) propagated exactly from the S(Q) error column through the sine transform. Neighboring points are correlated — see the S(Q) tab."
                      : "±1σ ribbon from the file's dG(r) column, as the reduction wrote it."
                  }
                >
                  <input type="checkbox" checked={showGSigma} onChange={(e) => setShowGSigma(e.target.checked)} style={{ accentColor: color.primary }} />
                  ±σ
                </label>
              )}
              {viewTab === "fit" && canOverlay && (
                <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: fz.micro, color: color.secondary, cursor: "pointer" }} title={multiPhase ? "Overlay each phase's G(r) contribution — they sum exactly to the calc curve" : "Overlay the element-pair (Faber–Ziman) partial PDFs — they sum exactly to the calc curve"}>
                  <input type="checkbox" checked={showPartials} onChange={(e) => setShowPartials(e.target.checked)} style={{ accentColor: color.primary }} />
                  {multiPhase ? "phases" : "partials"}
                </label>
              )}
              {viewTab === "fit" && (
                <button
                  style={{ ...toolbarBtn, display: "inline-flex", alignItems: "center", gap: 5 }}
                  title="Zoom the plot onto the active fit window"
                  onClick={() => setFocusFitToken((t) => t + 1)}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  optimize view
                </button>
              )}
              <SegmentedToggle
                options={[
                  { id: "fit", label: "Refinement", title: "Observed vs calculated G(r)" },
                  ...(hasReciprocal
                    ? [{ id: "reciprocal" as const, label: "S(Q)", title: "The S(Q)/F(Q) this G(r) was transformed from, with its ±σ error ribbon, and what that error becomes in G(r) over the fit window" }]
                    : []),
                  { id: "model3d", label: "3D Model", title: "3D crystal-structure model, with the distortion modes being refined — click a mode to draw its displacement pattern" },
                  { id: "subgroups", label: "Subgroups", title: "Lower the symmetry here: pick a subgroup, a Γ irrep's isotropy subgroup, or a parent CIF — the distortion modes it permits load into the Positions group" },
                  { id: "posterior", label: "Posterior", title: "Bayesian posterior of the free parameters (ensemble MCMC) — credible intervals, convergence diagnostics, and the posterior-vs-esd check" },
                  { id: "boxcar", label: "Boxcar", title: "Boxcar scan — refine inside a fixed-width r-window slid across G(r) and plot each parameter against the box center: how the structure changes with length scale" },
                ] as const}
                value={viewTab}
                onChange={setViewTab}
              />
            </div>
          </div>
          {viewTab === "fit" ? (
            <>
              <WorkbenchPlot
                curves={plotCurves}
                xLabel="r (Å)"
                viewKey={plotViewKey}
                ariaLabel="G(r): observed, calculated and difference"
                yLabel="G(r) (Å⁻²)"
                signedY
                showBackground={false}
                fitRange={fitRange}
                onFitRangeChange={(range) => setModel((m) => withFitRange(m, range))}
                focusFitToken={focusFitToken}
                {...(overlays ? { overlays } : {})}
                {...(gSigma && showGSigma ? { obsSigma: gSigma, obsSigmaLabel: pattern.transform ? "±σ propagated" : "±σ (file)" } : {})}
              />
              <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: color.secondary }}>
                Qdamp/Qbroad are instrument constants — hold them fixed once calibrated on a standard.
              </p>
              {radiationWarning && (
                <div style={{ marginTop: 6, fontSize: 12, color: color.warnInk }}>⚠ {radiationWarning}</div>
              )}
              {motionConflict && (
                <div style={{ marginTop: 6, fontSize: 12, color: color.warnInk }}>⚠ {motionConflict}</div>
              )}
              {adpWarning && (
                <div style={{ marginTop: 6, fontSize: 12, color: color.warnInk }}>
                  ⚠ {adpWarning} Edit the “ADPs (thermal)” rows in the parameter panel.
                </div>
              )}
            </>
          ) : viewTab === "reciprocal" ? (
            <ReciprocalPanel pattern={pattern} fitRange={fitRange} />
          ) : viewTab === "model3d" ? (
            <>
              {multiPhase && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11.5, color: color.secondary }}>phase</span>
                  <span style={{ display: "inline-flex", border: `1px solid ${color.border}`, borderRadius: 6, overflow: "hidden" }}>
                    {phases.map((ph, i) => (
                      <button
                        key={ph.id}
                        onClick={() => setViewPhase(i)}
                        style={{ border: "none", padding: "1px 9px", fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", background: i === viewPhase ? color.primary : "#fff", color: i === viewPhase ? "#fff" : color.ink }}
                      >
                        {ph.structure.name || `phase ${i + 1}`}
                      </button>
                    ))}
                  </span>
                </div>
              )}
              {/* The viewer and the panels below share a FIXED-height card, so
                  both regions are explicit flex partners: the viewer flexes but
                  never bleeds (overflow hidden), the mode/tree stack scrolls
                  internally. Before this, the wrapper shrank to its 360 px
                  minimum while the viewer's own chrome (toolbar, view row,
                  legend) overflowed it — painting over the modes table. */}
              <div className="wb-3d-host" style={{ flex: "1 1 auto", minHeight: 320, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <Suspense fallback={<div style={{ flex: 1, display: "grid", placeItems: "center", color: color.secondary, fontSize: 13 }}>Loading 3D viewer…</div>}>
                  <StructureView
                    key={viewStructure.id + viewPhase}
                    structure={viewStructure}
                    minCanvasHeight={200}
                    {...(shownMode ? { displacements: shownMode.axes } : {})}
                    exports={[(() => {
                      // The phase on screen, not every phase (that is the
                      // header export). Displacement modes are not in the file
                      // yet; they land here as mCIF when the writer supports them.
                      const shown = phases[Math.min(viewPhase, phases.length - 1)]!;
                      const mag = phaseMagnetic(shown.structure);
                      // The label tracks the CONTENT: a spin fit writes an mCIF,
                      // so calling the button "CIF" would misname the download.
                      const kind = mag && mag.moments.length > 0 ? "mCIF" : "CIF";
                      return {
                        label: kind,
                        title: `Download ${viewStructure.name || viewStructure.id} as ${kind} — refined cell and sites${kind === "mCIF" ? " and moments" : ""}, with esds`,
                        run: () => exportPhaseCifRef.current(viewStructure, shown.id, mag),
                      };
                    })()]}
                  />
                </Suspense>
              </div>
              {/* The modes being refined; the symmetry they lower to is
                  chosen (and cleared) on the Subgroups page. */}
              {!multiPhase && (
                <div className="wb-grow-box" style={{ flex: "0 1 auto", minHeight: modeSet ? 90 : 0, maxHeight: 300, overflowY: "auto", marginTop: 6 }}>
                  <DistortionModesPanel
                    modeSet={modeSet}
                    modes={modes}
                    params={params}
                    result={result}
                    spaceGroup={structure.spaceGroup.hermannMauguin}
                    ownModes={(symModes?.modes.length ?? 0) > 0}
                    shownModeId={shownModeId}
                    onShowMode={setShownModeId}
                    onOpenSubgroups={() => setViewTab("subgroups")}
                    {...(modeCifAvailable ? { onExportModeCif: exportModeCif } : {})}
                  />
                </div>
              )}
              <p style={{ marginTop: 4, fontSize: 12, color: color.secondary }}>
                {viewStructure.name || "Structure"}
                {viewStructure.spaceGroup.hermannMauguin ? ` · ${viewStructure.spaceGroup.hermannMauguin}` : ""}
                {` · ${viewStructure.sites.length} site${viewStructure.sites.length === 1 ? "" : "s"} · refined values applied`}
              </p>
            </>
          ) : viewTab === "boxcar" ? (
            <BoxcarPanel
              run={boxcarRun}
              busy={boxcarBusy}
              progress={boxcarProgress}
              onRun={() => void runBoxcar()}
              onCancel={cancelBoxcar}
              blockedReason={busy ? "A refinement is running — wait for it to finish." : boxcarBlocked}
              plan={boxcarPlanState}
              planInfo={{
                count: boxcarWindowList.length,
                issue: boxcarIssue,
                range: { min: boxcarRange.min, max: boxcarRange.max },
                scannedMax: boxcarScanned,
              }}
              onPlanChange={(patch) => setModel((m) => withBoxcarPlan(m, patch))}
              dataRange={boxcarDataRange(model)}
              fitRange={fitRange}
              onRangeChange={(patch) => setModel((m) => withBoxcarRange(m, patch))}
              onRangeFromFit={() => setModel((m) => withBoxcarRangeFromFit(m))}
              start={boxcarStart}
              fitRw={result ? rw : null}
              onStartChange={(id, patch) => setModel((m) => withBoxcarStart(m, id, patch))}
              onStartReset={() => setModel((m) => withBoxcarStartReset(m))}
              labels={new Map(params.map((p) => [p.id, p.label]))}
              onExportCsv={exportBoxcarCsv}
              onAdoptStep={adoptBoxcarStep}
            />
          ) : viewTab === "posterior" ? (
            <PosteriorPanel
              result={sample?.result ?? null}
              busy={sampleBusy}
              progress={sampleProgress}
              onRun={(continueRun) => void runSample(continueRun)}
              hasRefined={result !== null && !busy}
              labels={new Map(params.map((p) => [p.id, p.label]))}
            />
          ) : (
            <>
              {multiPhase ? (
                <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center", color: color.secondary, fontSize: 13, padding: 20 }}>
                  Subgroup analysis is single-phase — the group–subgroup tree is built from one structure's space group.
                </div>
              ) : !subgroupLattice ? (
                <div style={{ flex: 1, display: "grid", placeItems: "center", color: color.secondary, fontSize: 13 }}>
                  No space-group operations to analyze.
                </div>
              ) : (
                <SubgroupsPanel
                  spaceGroup={structure.spaceGroup.hermannMauguin}
                  lattice={subgroupLattice}
                  irrepTree={subgroupTree}
                  decentringTree={decentringTree}
                  sameCell={sameCell}
                  supercellNote={supercellNote}
                  operations={structure.spaceGroup.operations}
                  onActivateSameCell={onActivateSameCell}
                  onActivateSupercell={onActivateSupercell}
                  modes={modes}
                  modeCount={modeSet ? modeSet.modes.length : null}
                  busy={busy}
                  onLoadParentCif={(file) => void onLoadParentCif(file)}
                  onLoadModeCif={(file) => void onLoadModeCif(file)}
                  onActivateMode={onActivateMode}
                  onActivateSubgroup={onActivateSubgroup}
                  onClear={() => setModel((m) => withoutModes(m))}
                  onOpenModel={() => setViewTab("model3d")}
                />
              )}
            </>
          )}
        </div>

        <ParameterPanel
          params={params}
          esd={result ? esdsWithTies(params, result) : undefined}
          onChange={onParamChange}
          onRefine={() => void runRefine()}
          onThorough={() => void runMultiStart()}
          // A scan owns the client's evaluator pool for its whole run. Starting
          // a second refinement would re-point `activePool` at the new pool, so
          // the scan's Cancel would abort the wrong run and leave the scan's own
          // workers spinning — the panel is read-only until the scan finishes.
          disabled={boxcarBusy}
          thoroughMode={result ? "escape" : "prefit"}
          prefitTitle="Prefit from a cold start: a broad set of perturbed restarts of the free parameters, keeping the best — lands the model in a good basin before you refine. (No Le Bail stage — that extracts Bragg intensities, which real-space G(r) doesn't have.)"
          onReset={reset}
          onCancel={cancelRefine}
          busy={busy}
          result={result}
          title="PDF parameters"
          extraActions={refineActions}
          warnings={siteSumRangeWarnings(params)}
          groupControls={{
            // Each shared site's occupancies sum to its total by a tie (the last follows the others).
            ...(pdfSharedSites.length > 0 ? {
              Occupancy: <SiteTotals sites={pdfSharedSites} totals={model.siteTotals} onChange={(key, total) => setModel((m) => withSiteTotal(m, key, total))} disabled={busy} />,
            } : {}),
            "ADPs (thermal)": (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: busy ? "default" : "pointer" }} title="Refine the symmetry-allowed U tensor of each site instead of one U per site. Each site's tensor is seeded from its current U; a CIF with U_aniso columns loads anisotropic. A small-box fit usually refines one U per site.">
                <input type="checkbox" checked={adpModel === "anisotropic"} disabled={busy} onChange={(e) => switchAdpModel(e.target.checked)} />
                anisotropic (U tensor){adpModel === "mixed" ? " · some sites" : ""}
              </label>
            ),
          }}
          groupInfo={{
            // Each PDF group is a distinct physical effect — the "?" badge spells
            // it out on hover so the physics stays off the resting parameter rows.
            Instrument: (
              <span>
                Instrument Q-space resolution: <b>Qdamp</b> damps G(r) by a Gaussian
                envelope, <b>Qbroad</b> broadens peaks ∝ r. Calibrate on a standard
                (Ni/Si) and hold fixed — free only deliberately.
              </span>
            ),
            "Correlated motion": (
              <span>
                Near-neighbor correlated thermal motion sharpens low-r peaks.{" "}
                <b>δ1</b> (1/r) and <b>δ2</b> (1/r²) are the smooth laws;{" "}
                <b>sratio/rcut</b> step-sharpens below a cutoff instead — refine one
                family, not both.
              </span>
            ),
            "Particle shape": (
              <span>
                Finite-size envelope for nanoparticles: the spherical-particle
                diameter attenuates G(r) toward high r. 0 = bulk; set a starting Ø
                by hand before freeing it (it cannot climb up from 0).
              </span>
            ),
            mPDF: (
              <span>
                Magnetic-PDF envelope. <b>Ordered scale</b> is exactly degenerate
                with the moment magnitude — free one or the other, never both.{" "}
                <b>Para scale</b> weights the broad paramagnetic self-term near
                r = 0, <b>peak σ</b> broadens the magnetic pairs, and <b>ξ</b> is
                the short-range-order correlation length (0 = long-range order):
                a finite ξ is how local magnetic order without Bragg satellites
                shows up.
              </span>
            ),
          }}
          // The atomic ↔ irreps switch reshapes the whole parameter set (the
          // Positions group swaps per-coordinate rows for whole-cell mode
          // amplitudes), so it lives at panel level, not inside one group.
          // (The boxcar plan deliberately does NOT live here: it shapes the
          // Boxcar view's result and nothing else, so it sits in that tab with
          // the run button and the plot it produces.)
          frameworkControls={
            multiPhase || !symModes || (symModes.modes.length === 0 && !modes)
              ? undefined
              : (
                  <>
                    <span style={uppercaseLabel}>Parameterization</span>
                    <SegmentedToggle
                      options={[
                        {
                          id: "atomic",
                          label: "Constrained atomic",
                          title: "Per-coordinate symmetry-allowed shifts — one row per free coordinate of each site",
                        },
                        {
                          id: "irreps",
                          label: "Irreps (modes)",
                          title:
                            "Symmetry-adapted distortion-mode amplitudes (whole-cell Å) computed from the structure's own space group — no parent CIF needed. Modes seed at 0 and enter fixed; free the ones you want active. The unobservable rigid-translation (acoustic) combinations are excluded, so freeing every mode stays well-posed.",
                        },
                      ]}
                      value={positionMode}
                      // Guard the input side of the mid-refine race too: a
                      // flip while the worker runs would swap the spec under
                      // the in-flight result (which the staleness check in
                      // runRefine would then discard — better not to invite it).
                      onChange={(id) => {
                        if (!busy) setModel((m) => withPositionMode(m, id));
                      }}
                    />
                    {positionMode === "irreps" && modeSet && (
                      <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
                        {modes
                          ? `vs ${modes.parentName}`
                          : `from ${structure.spaceGroup.hermannMauguin ?? "own space group"}`}
                        {` · ${modeSet.modes.length} mode${modeSet.modes.length === 1 ? "" : "s"}`}
                        {(modeSet.acousticExcluded ?? 0) > 0
                          ? ` · ${modeSet.acousticExcluded} acoustic (translation) excluded`
                          : ""}
                      </span>
                    )}
                  </>
                )
          }
        />
      </div>
      </div>

      {/* Step 1 — magnetic PDF (mPDF) analysis. The symmetry workflow is
          structure-driven and identical to powder and single crystal; only the
          moment fit differs — here it runs against the real-space G(r).
          The k-search half is intentionally not fed: it scores candidate k
          against unindexed BRAGG peak d-spacings, and a G(r) has none. The k
          is typed in (or carried over from a companion powder refinement). */}
      <div style={{ display: step === 1 ? "grid" : "none", gap: space.gap }}>
        <div style={{ ...themeCard, padding: space.inset }}>
          <div style={{ ...uppercaseLabel, marginBottom: 4 }}>Magnetic PDF (mPDF) — {structure.name || "structure"}</div>
          <p style={{ fontSize: 13, color: color.secondary, margin: 0, lineHeight: 1.5 }}>
            Commensurate single-k workflow (shared with powder and single crystal): magnetic ions → propagation vector k → symmetry framework → magnetic space group → refine moments.
            &ldquo;Refine moments&rdquo; fits the moment amplitudes to the magnetic G(r) with the nuclear model held; &ldquo;Continue&rdquo; carries the spin model to the refinement page to fit nuclear + magnetic together.
            The magnetic signal is the Frandsen unnormalized mPDF, added into the same residual — local order, so it survives where Bragg satellites do not.
          </p>
        </div>
        <KSearchPanel
          structure={magneticStructure}
          magneticFit={magneticFit}
          // "Apply" is a PREVIEW: the model's own moment values drive the spin
          // field so the magnetic curve appears on the fit plot, but no
          // refinable rows are added — a different model's moment rows would
          // not match the bindings we already hold. "Continue" adds the rows.
          onApply={previewSpinModel}
          onContinue={(m, mp, mb) => { adoptSpinModel(m, mp, mb); onStep?.(0); }}
          onReportModel={publishExploration}
        />
      </div>
    </>
  );
}
