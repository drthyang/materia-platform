/**
 * Magnetic propagation-vector (k) search + little-group magnetic subgroups, for
 * the commensurate single-k first pass. Self-contained over the loaded nuclear
 * structure:
 *   1. select the magnetic ion(s),
 *   2. enter a k-vector by hand OR search it from observed magnetic-peak
 *      d-spacings (FullProf-style position scoring), and
 *   3. read the allowed magnetic subgroups of the little group of k.
 *
 * The step's state and its changes are one store (app/magneticStep.ts,
 * MagneticStep), which the Agent's headless page holds too; the numerics are
 * the pure core's. This panel renders the store and calls its changes.
 */

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { StructureModel } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { magneticIonCandidates } from "@/core/magnetic/magneticIons";
import { satelliteMatchDeltas, kLabel } from "@/core/magnetic/kSearch";
import { describePropagation } from "@/core/magnetic/propagation";
import { latticeCandidateLabel as latticeLabel, type LatticeCandidate } from "@/core/magnetic/subgroupLattice";
import type { IsotropyFailure } from "@/core/magnetic/isotropy";
import { formatMagneticSymbol } from "@/core/magnetic/bnsOg";
import { describeMomentMode } from "@/core/magnetic/momentModel";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import type { MagneticModel } from "@/core/magnetic/types";
import type { PowderCurves } from "@/core/workflow/powder";
import {
  magneticPhaseTicks,
  satellitePositionTicks,
  MAGNETIC_COLOR,
  type PhaseTicks,
} from "@/visualization/reflectionTicks";
import { WorkbenchPlot, type FitRangeSelection } from "@/app/ui/WorkbenchPlot";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { momentEntriesFrom } from "@/app/ui/cellModel";
import {
  DEFAULT_PEAK_SORT, describePeakSort, isDefaultPeakSort, listedPeakRows, nearReflectionLabel, visiblePeakRows, type PeakSort,
} from "@/app/ui/peakTable";
import { PeakSortHeader } from "@/app/ui/PeakSortHeader";
import type { ReportGroup } from "@/core/export/report";
import type { MagneticExploration } from "@/app/reportInputs";
import { structureToCif, magneticStructureToMcif } from "@/core/export/cif";
import { downloadText } from "@/app/download";
import { card as themeCard, color as theme, mono as themeMono, uppercaseLabel as themeLabel, resetRangeBtn, space, toolbarBtn } from "@/app/theme";
import type { MagneticAgentHandle } from "@/agent/magneticPort";
import { MagneticStep, NO_RANK, handoff, peakKey, type MagneticFit, type ResidualPeak, type StepInputs } from "@/app/magneticStep";

// Lazy so three.js stays in its own chunk (only loaded when a group is previewed).
const StructureView = lazy(() => import("@/app/ui/StructureView").then((m) => ({ default: m.StructureView })));
// Type-only — erased at build, so it does not pull the viewer out of its chunk.
import type { StructureExport } from "@/app/ui/StructureView";

/**
 * Parse one k component, accepting fractions ("1/2", "-1/3") as well as
 * decimals — exact fractions matter: 0.333 misses the little-group tolerance
 * where 1/3 is meant.
 */
function parseKComponent(s: string): number {
  const frac = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = Number(frac[2]);
    return den === 0 ? 0 : Number(frac[1]) / den;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/** The two equivalent symmetry frameworks for step 3 of the workflow. */
const FRAMEWORKS: readonly { id: "msg" | "irrep"; label: string }[] = [
  { id: "msg", label: "Magnetic space groups" },
  { id: "irrep", label: "Representation analysis" },
];

/** Stable default for the residualPeaks prop — an inline `= []` would mint a
 *  fresh array on every render and retrigger every effect keyed on it (a
 *  render loop when the prop is absent, e.g. single-crystal mode). */
const NO_PEAKS: readonly ResidualPeak[] = [];


const ISOTROPY_FAILURE_TEXT: Record<IsotropyFailure, string> = {
  "no-modes": "The selected irrep(s) carry no moment on the chosen site(s) — this order parameter is magnetically silent here.",
  "complex-irrep": "A conjugate-pair (complex) irrep is selected: its real combinations generally stabilize as anti-translation (type-IV) groups, which this route does not build yet. The magnetic-space-group route lists them.",
  "multidim-irrep": "A multidimensional irrep is selected: its magnetic group depends on the order-parameter direction (kernel vs epikernels) — direction selection is the next milestone. The magnetic-space-group route covers these orderings today.",
  "complex-phase": "This k gives complex phase factors e^{2πik·L}: naming needs the type-IV / star-of-k treatment (see docs/MAGNETIC_SYMMETRY.md).",
  "primed-translation": "The stabilizer contains a primed pure translation — a type-IV magnetic group, which this route does not build yet. The magnetic-space-group route lists it.",
};

/**
 * Everything the powder-pattern preview needs, prepared by the powder
 * workbench (which owns the axis conversions and the refined session state).
 * It is the refinement plot's own view — refined curves in the current
 * display unit, fit-range window, unit toggle, and the per-phase Bragg-tick
 * rows — so the magnetic page shows exactly the pattern being refined; this
 * panel adds the satellite / allowed / residual rows on top.
 */
export interface MagneticPatternView {
  /** Refined obs/calc/background curves in the CURRENT display unit. */
  readonly curves: PowderCurves;
  readonly xLabel: string;
  /** d-spacing (Å) → current display unit. */
  readonly dToX: (d: number) => number;
  /** Current display unit → d-spacing (Å) — for click-to-add manual peaks. */
  readonly xToD?: (x: number) => number;
  /** d-window of the pattern (floored against tiny-d tick explosions). */
  readonly dRange: { readonly min: number; readonly max: number };
  /** One Bragg-tick row per crystallographic phase (refined cells), so
   *  impurity peaks index against their own phase. */
  readonly nuclearTicks: readonly PhaseTicks[];
  /** Fit-range window in display space (same draggable handles as the
   *  refinement plot when `onFitRangeChange` is present). */
  readonly fitRange?: FitRangeSelection;
  readonly onFitRangeChange?: (r: FitRangeSelection) => void;
  /** Axis-unit segmented control, sharing the refinement page's unit state. */
  readonly unitToggle?: ReactNode;
  /**
   * The MAGNETIC contribution of a model to the calculated curve (display
   * point order, nuclear model at its current values). With it the page draws
   * the candidate being judged ON the pattern — the visual test the agreement
   * number alone cannot give. The curves above must then be nuclear-only.
   */
  readonly magneticComponent?: (magnetic: MagneticModel) => number[];
}

export function KSearchPanel({
  structure,
  residualPeaks = NO_PEAKS,
  onAddManualPeak,
  onRemoveManualPeak,
  pattern,
  fitRange,
  patternView,
  patternQuality,
  patternFitChip,
  onFocusFit,
  focusFitToken = 0,
  magneticFit,
  onApply,
  onContinue,
  allowRefineK = false,
  baselineAgreement = null,
  preselect = null, onReportModel,
  agentHandleRef,
}: {
  structure: StructureModel;
  /** Candidate magnetic peaks auto-detected from the pattern residual (permissive
   *  base cut), annotated with significance and nearby nuclear reflections —
   *  plus any manually added picks (flagged `manual`). The panel's own criteria
   *  decide which detections feed the k-search; manual picks are always in. */
  residualPeaks?: readonly ResidualPeak[];
  /** Add a manual residual peak at this d (from a click on the pattern). */
  onAddManualPeak?: (d: number) => void;
  /** Remove a manually added peak (by its d). */
  onRemoveManualPeak?: (d: number) => void;
  /** The observed pattern: new data invalidate the fits shown. */
  pattern?: PowderPattern;
  /** Active refinement window in the pattern's native x-unit: a new window invalidates the fits shown (the page's fit applies it). */
  fitRange?: { readonly min: number; readonly max: number };
  /** Curves + d→x mapping for the pattern preview with satellite/allowed tick
   *  rows — the visual check that the chosen k and magnetic space group can
   *  explain the unindexed peaks. Absent in single-crystal mode. */
  patternView?: MagneticPatternView;
  /** Live wR/GoF chips for the pattern-card toolbar. Passed separately from
   *  `patternView` on purpose: it changes every live-refinement flush, and
   *  baking it into the memoized view would churn the tick computation. */
  patternQuality?: ReactNode;
  /** Active fit-range chip (display-space label + reset). Present only while a
   *  window narrower than the pattern is set. */
  patternFitChip?: { readonly label: string; readonly onReset: () => void };
  /** "optimize view": zoom the plot onto the active fit range (bumps the shared
   *  focus token, so the refinement plot re-frames identically). */
  onFocusFit?: () => void;
  focusFitToken?: number;
  /** The page's moments-only fit (magneticStep.ts): without it nothing is fitted. */
  magneticFit?: MagneticFit;
  /** Push the current magnetic model onto the session so the refinement plot
   *  shows the magnetic pattern + satellite ticks (null clears it). */
  onApply?: (magnetic: MagneticModel | null) => void;
  /** Hand the magnetic model + moment params/bindings to the refinement page. */
  onContinue?: (magnetic: MagneticModel, params: readonly RefinementParameter[], bindings: readonly ParameterBinding[]) => void;
  /** Offer "Refine k" on Continue. Only a host whose refinement can MOVE k
   *  sets it (powder): single-crystal satellite indices come from the file and
   *  the mPDF spin box is built at a fixed k, so both keep k fixed. */
  allowRefineK?: boolean;
  /** The nuclear-only agreement (fraction) the candidate fits are compared against. */
  baselineAgreement?: number | null;
  /**
   * A magnetic model to open ON — the session's applied model (an mCIF load, a
   * bundled demo, a reopened project, a previous Continue). Its k is set, its
   * ions selected, the candidate whose operations match is selected (its index
   * section opened), and the amplitudes are seeded from its moments.
   */
  preselect?: MagneticModel | null;
  /**
   * Publishes what the page currently shows — the selected candidate with its
   * moments at the current amplitudes, its label, and the moments-only fit's
   * agreement — so the header's report (Export ▾ → Report) can include the
   * model under exploration. Called with null when no candidate is selected.
   */
  onReportModel?: (model: MagneticExploration | null) => void;
  /** Where this page publishes its controls for the Agent (agent/magneticPort.ts). */
  agentHandleRef?: { current: MagneticAgentHandle | null };
}): JSX.Element {
  const ions = useMemo(() => magneticIonCandidates(structure), [structure]);

  // The step's state and its changes (app/magneticStep.ts): one store for the
  // panel's life, which this panel renders and the Agent's handle reads and
  // drives. It reads the page through the latest props.
  const fitContext = `${pattern?.id ?? ""}|${pattern?.points.length ?? 0}|${fitRange ? `${fitRange.min}–${fitRange.max}` : "all"}`;
  const inputs = useMemo<StepInputs>(() => ({
    structure,
    residualPeaks,
    fit: magneticFit ?? null,
    baselineAgreement,
    allowRefineK,
    fitContext,
    preselect,
    ...(onApply ? { onApply } : {}),
    ...(onContinue ? { onContinue } : {}),
  }), [structure, residualPeaks, magneticFit, baselineAgreement, allowRefineK, fitContext, preselect, onApply, onContinue]);
  const latestInputs = useRef(inputs);
  useLayoutEffect(() => {
    latestInputs.current = inputs;
  });
  const [step] = useState(() => new MagneticStep(() => latestInputs.current));
  const s = useSyncExternalStore(step.subscribe, step.state);
  const view = useMemo(() => step.view(s, inputs), [step, s, inputs]);
  // A new model to open on, or a new peak set, once the page has rendered with it.
  useEffect(() => step.sync());

  const selected = s.ions;
  const [kText, setKText] = useState<[string, string, string]>(["0", "0", "0"]);
  const results = view.results;

  // Peak-selection criteria: which detected residual peaks count as magnetic
  // input for the k-search. The significance threshold (when the data carries
  // σ) and the near-nuclear exclusion set the default; the per-peak checkboxes
  // override peak by peak. Changing a criterion drops the manual overrides so
  // the criteria stay the single explanation of what is included.
  const { minSig, allowNearNuclear } = s.criteria;
  // Draft/commit for the threshold input (same pattern as the k components):
  // clamping per keystroke would make values like "10" untypable.
  const [minSigText, setMinSigText] = useState(String(minSig));
  function commitMinSig(): void {
    const v = Number(minSigText);
    const next = Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, 3), 30) : minSig;
    setMinSigText(String(next));
    if (next !== minSig) step.setCriteria({ minSig: next });
  }
  // Peaks with σ carry a significance; a masked bin (σ = 0) or mixed data can
  // leave individual peaks without one — those pass the threshold rather than
  // silently disabling the criterion for everyone.
  const hasSignificance = residualPeaks.some((p) => p.significance !== undefined);
  // Display rows: sorted by d descending (low Q first — left-to-right in
  // d-spacing, where magnetic peaks live) and numbered to match the ticks the
  // pattern preview draws for them.
  const peakRows = view.rows;
  const includedPeaks = useMemo(() => peakRows.filter((r) => r.included), [peakRows]);
  // Content signature of the DETECTED set: residualPeaks is re-minted (fresh
  // array) by unrelated re-renders upstream (axis toggles, applying a model),
  // which must not drop the spotlight — only a real change of the peak set
  // does (the step's store keeps the curation: MagneticStep.sync).
  const peakSignature = useMemo(() => residualPeaks.map((p) => peakKey(p.d)).sort().join("|"), [residualPeaks]);

  // k is confirmed explicitly ("Set k") so the symmetry analysis below does not
  // churn on every keystroke; the inputs hold a draft until then, and follow
  // the k the step holds (a search result, a model opened on).
  const k = s.k;
  useEffect(() => setKText([String(k[0]), String(k[1]), String(k[2])]), [k]);
  // Arms / commensurability of the applied k: decides whether the moment
  // parameters are real amplitudes or cosine + sine (quadrature) pairs.
  const kClass = view.kClass;
  const draftK: Vec3 = [parseKComponent(kText[0]), parseKComponent(kText[1]), parseKComponent(kText[2])];
  const draftPending = draftK.some((v, i) => Math.abs(v - k[i]!) > 1e-12);

  // Per-peak |Δd| to the nearest satellite G ± k of the CURRENT k — the
  // quantitative per-peak check that the applied k explains each detection.
  const kDeltas = useMemo(
    () => satelliteMatchDeltas(structure.cell, k, peakRows.map((r) => r.d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structure, k[0], k[1], k[2], peakRows],
  );

  // Route A: the FULL lattice of candidate magnetic space groups — every
  // (subgroup H ≤ G_k, θ) pair, not only the maximal index-2 decorations —
  // grouped into conjugacy classes (one representative shown per class, with
  // its domain count), k-SUBGROUPSMAG-style, with the moment dimension each
  // allows on the selected sites. Route B: representation analysis, and the
  // isotropy subgroup of the irreps chosen, cross-linked to its candidate.
  const { reps, lgSize, dims: repMomentDims, irrepAnalysis, combo, comboRepIdx } = view;
  // Which symmetry framework drives the group selection: the Shubnikov
  // (magnetic space group) route or the representation-analysis (irrep) route.
  // Both converge on a magnetic space group whose moments are previewed below.
  const { framework, irreps: chosenIrreps, chosen: selIdx, open: openIndices, amps, refineK, refining } = s;
  // The moment model's ties: same-site moments, an |M| tie across sublattices
  // (same size, own symmetry-fixed directions) within each element or across
  // all selected sites (the high-entropy case), with per-sublattice flips.
  const { sameSite: tieMoments, magnitudes: tieMagnitudes, scope: tieScope, flippedUnits } = s.ties;

  // When the chosen group's BNS identification needed a basis transformation,
  // offer its standard-setting cell as a 3D overlay (e.g. the orthohexagonal
  // C-centred cell of a Cm'cm'-type subgroup of a hexagonal parent).
  const standardCell = useMemo(() => {
    const match =
      framework === "msg"
        ? selIdx != null
          ? reps[selIdx]?.settingMatch
          : undefined
        : combo && !("failure" in combo)
          ? combo.settingMatch ?? undefined
          : undefined;
    if (!match || match.direct) return undefined;
    const { P, originShift: p } = match;
    // New cell origin in parent fractional coordinates: P·p.
    const origin: Vec3 = [
      P[0]![0]! * p[0]! + P[0]![1]! * p[1]! + P[0]![2]! * p[2]!,
      P[1]![0]! * p[0]! + P[1]![1]! * p[1]! + P[1]![2]! * p[2]!,
      P[2]![0]! * p[0]! + P[2]![1]! * p[1]! + P[2]![2]! * p[2]!,
    ];
    return { P, origin, label: formatMagneticSymbol(match.identity.bnsSymbol) };
  }, [framework, selIdx, reps, combo]);

  // True when ≥2 selected magnetic ions share one crystallographic site (disorder).
  const hasSharedMagSite = useMemo(() => {
    const sel = [...selected]
      .map((l) => structure.sites.find((s) => s.label === l))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
    const coincide = (a: Vec3, b: Vec3): boolean =>
      [0, 1, 2].every((i) => { const d = Math.abs(a[i]! - b[i]!); return Math.min(d, 1 - d) < 1e-3; });
    for (let i = 0; i < sel.length; i++) for (let j = i + 1; j < sel.length; j++) {
      if (coincide(sel[i]!.position, sel[j]!.position)) return true;
    }
    return false;
  }, [selected, structure]);

  // The chosen group's moment model, the k rows it lets refine, and its
  // amplitudes with the |M| ties resolved: a derived amplitude ("= ±hypot(…)")
  // follows its reference wherever the amplitudes are applied — preview, 3D
  // arrows, handoff, report.
  const { build: magBuild, kRows, canRefineK, resolvedAmps } = view;

  // Whether an |M| tie could apply: ≥2 magnetic sites (the all-sites scope
  // ties across elements), or a split orbit (two sublattices of one site) —
  // the tie option only renders when it can do something.
  const canTieMagnitudes = useMemo(() => {
    if (!magBuild) return false;
    if (magBuild.activeSites.length >= 2) return true;
    return magBuild.magnetic.moments.some((m) => (m.orbitIndex ?? 1) > 1);
  }, [magBuild]);

  // The moments fit's readout, for the model and data it was run on.
  const refineWR = view.fitWR;

  /** Confirm a k: apply it, and drop the previous k's group pick. */
  const applyK = (kk: Vec3): void => step.setK(kk);

  // The candidate magnetic model with the current amplitudes applied — feeds
  // both the 3D moment arrows and the allowed-reflection tick row.
  const appliedMagnetic = view.applied;

  // Moment entries for the 3D view (one per site — or per split orbit when the
  // magnetic group splits a site's crystallographic orbit), with amps applied.
  const momentEntries = useMemo(
    () => (appliedMagnetic ? momentEntriesFrom(appliedMagnetic) : undefined),
    [appliedMagnetic],
  );

  // The 3D card's own download. This view is where the moments live, so it
  // writes mCIF as soon as a group is previewed: the refined nuclear structure
  // plus the magnetic symmetry and the moment loop at the current amplitudes
  // (`appliedMagnetic` — the very model drawn as arrows, so file and picture
  // agree). Before a group is picked there are no moments and it is plain CIF.
  // No `magneticLabel`: the BNS symbol is assembled inside the report export,
  // so the writer falls back to naming the parent group, as the header mCIF does.
  const viewerCifExport = useMemo<StructureExport>(() => {
    const mag = appliedMagnetic && appliedMagnetic.moments.length > 0 ? appliedMagnetic : null;
    return {
      label: mag ? "mCIF" : "CIF",
      title: mag
        ? `Download ${structure.name || structure.id} as mCIF — refined cell and sites plus the magnetic moment loop at the current amplitudes`
        : "Download the refined nuclear structure as CIF — pick a magnetic group to include the moments",
      run: () => {
        if (mag) {
          downloadText(`${structure.id}.mcif`, magneticStructureToMcif(structure, mag), "chemical/x-cif");
        } else {
          downloadText(`${structure.id}.cif`, structureToCif(structure), "chemical/x-cif");
        }
      },
    };
  }, [appliedMagnetic, structure]);

  // Tick rows for the pattern preview: every crystallographic phase (from the
  // refinement page, so impurity peaks index correctly), then where this k CAN
  // put magnetic intensity (satellite positions G ± k), where the selected
  // group actually DOES (|F_M|² > 0 with the current amplitudes), and where
  // the nuclear fit leaves unexplained intensity — the visual test of the k
  // and group choices.
  const previewTicks = useMemo<PhaseTicks[]>(() => {
    if (!patternView) return [];
    const { dRange, dToX } = patternView;
    // One phase: its row is "nuclear" — the phase's name (a long formula on a
    // mixed-site sample) wrapped the legend, and the page's title names it.
    const nuclear = patternView.nuclearTicks.length === 1
      ? [{ ...patternView.nuclearTicks[0]!, label: "nuclear" }]
      : patternView.nuclearTicks;
    const rows: PhaseTicks[] = [
      ...nuclear,
      satellitePositionTicks(structure, k, dRange.min, dRange.max, dToX, {
        id: "k-positions",
        label: "G ± k",
        color: theme.faint,
      }),
    ];
    if (appliedMagnetic) {
      rows.push(
        magneticPhaseTicks(structure, appliedMagnetic, dRange.min, dRange.max, dToX, {
          id: "allowed",
          label: "allowed",
          color: MAGNETIC_COLOR,
        }),
      );
    }
    if (peakRows.length > 0) {
      // One numbered tick per DETECTED peak (included or not — the table's
      // checkboxes carry the distinction), so every table row has its marker
      // in the pattern and clicking a row can spotlight it.
      const ticks = peakRows
        .filter((p) => p.d >= dRange.min && p.d <= dRange.max)
        .map((p) => ({ x: dToX(p.d), hkl: `#${p.idx}`, d: p.d }))
        .filter((t) => Number.isFinite(t.x));
      rows.push({ id: "residual", label: "residual", color: theme.obs, kind: "magnetic", ticks });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternView, structure, k[0], k[1], k[2], appliedMagnetic, peakRows]);

  // Tick-click spotlight in the pattern preview (same interaction as the
  // refinement plot, local to this page). A peak-table row spotlights its
  // numbered residual tick: marked on the pattern, the view left where it is
  // (the plot pans only if the peak is out of view, keeping its zoom width).
  const [patternPick, setPatternPick] = useState<{ hkl: string; kind: "nuclear" | "magnetic"; phaseId?: string } | null>(null);
  // Armed "add a peak" mode: the next plain click on the pattern places a
  // manual residual peak at the clicked position (single-shot).
  const [addingPeak, setAddingPeak] = useState(false);
  const canAddPeak = !!(onAddManualPeak && patternView?.xToD);
  // A genuinely different peak set drops any residual-peak spotlight (the #n
  // numbering is positional, so a stale pick would silently mark a different
  // peak); the step prunes the picks of peaks no longer in it.
  useEffect(() => {
    setPatternPick((p) => (p?.phaseId === "residual" ? null : p));
  }, [peakSignature]);
  function spotlightPeak(idx: number): void {
    const hkl = `#${idx}`;
    setPatternPick((p) => (p?.hkl === hkl && p.phaseId === "residual" ? null : { hkl, kind: "magnetic", phaseId: "residual" }));
  }

  // A long peak table shows its strongest rows (and every row the search
  // reads) until "Show all": 24 rows put step 4 two screens down.
  const [allPeaksShown, setAllPeaksShown] = useState(false);
  // The table's order: a click on a column header. Kept with the panel (which
  // the page keeps mounted across its steps), so it lasts the session, until
  // a new structure remounts the page. It only orders the rows: which rows a
  // collapsed table shows does not depend on it (peakTable.ts, listedPeakRows).
  const [peakSort, setPeakSort] = useState<PeakSort>(DEFAULT_PEAK_SORT);
  const spotlitIdx = patternPick?.phaseId === "residual" ? Number(patternPick.hkl.slice(1)) : null;
  // Each row with its Δd→k, which is also a sort key.
  const sortableRows = useMemo(() => peakRows.map((r) => ({ ...r, delta: kDeltas[r.idx - 1] })), [peakRows, kDeltas]);
  const shownPeakRows = listedPeakRows(sortableRows, peakSort, allPeaksShown, spotlitIdx);
  const hiddenPeaks = peakRows.length - visiblePeakRows(peakRows, false, spotlitIdx).length;
  // The near cell names the phase only when the pattern has several.
  const multiPhase = (patternView?.nuclearTicks.length ?? 1) > 1;

  // A k the fit backend cannot model at all (mPDF: incommensurate). Everything
  // that would report a number against the data is held back — the symmetry
  // analysis above stays live, since it is valid for any k.
  const { kUnsupported, canRefine, canFit, agreementLabel } = view;

  // What this page shows right now, for the header's report (Export ▾ →
  // Report): the selected candidate, its label, and the moments-only fit.
  const reportGroup = useMemo<ReportGroup>(() => {
    if (framework === "msg" && selIdx != null && reps[selIdx]) {
      const r = reps[selIdx]!;
      const lbl = latticeLabel(r);
      return {
        symbol: lbl.symbol,
        ...(lbl.numbers ? { numbers: lbl.numbers } : {}),
        ...(lbl.setting ? { setting: lbl.setting } : {}),
        index: r.index,
      };
    }
    if (framework === "irrep" && combo && !("failure" in combo)) {
      const identity = combo.standard ?? combo.settingMatch?.identity ?? null;
      return {
        symbol: identity
          ? formatMagneticSymbol(identity.bnsSymbol)
          : `isotropy subgroup of ${[...chosenIrreps].sort().join(" ⊕ ")}`,
        ...(identity ? { numbers: `BNS ${identity.bnsNumber} · OG ${identity.ogNumber}` } : {}),
        ...(combo.settingMatch ? { setting: combo.settingMatch.transformation } : {}),
      };
    }
    return { symbol: "magnetic subgroup" };
  }, [framework, selIdx, reps, combo, chosenIrreps]);
  useEffect(() => {
    if (!onReportModel) return;
    if (!magBuild) {
      onReportModel(null);
      return;
    }
    onReportModel({
      magnetic: applyMagneticMoments(magBuild.magnetic, magBuild.bindings, resolvedAmps),
      params: magBuild.params.map((p) => ({ ...p, value: resolvedAmps[p.id] ?? p.value })),
      bindings: magBuild.bindings,
      k,
      group: reportGroup,
      agreement: refineWR,
      agreementLabel,
    });
  }, [onReportModel, magBuild, resolvedAmps, k, reportGroup, refineWR, agreementLabel]);
  // Unmount (or a page switch that remounts the panel) withdraws the candidate.
  useEffect(() => () => onReportModel?.(null), [onReportModel]);

  // ── Rank the candidates against the data ─────────────────────────────────
  // Every moment-allowing candidate is fitted the same way "Refine moments"
  // fits the selected one, and the rows then carry (and sort by) the result —
  // instead of clicking candidates one at a time and remembering numbers. The
  // table is for the model and data it ran on: a change of what a fit means
  // (k, ions, tie options, the structure, the data, the fit window) drops it
  // and stops a run in progress.
  const rank = s.rank.on === view.rankKey ? s.rank : NO_RANK;
  // The ★: lowest wR — and among candidates tied with it, the MAXIMAL subgroup
  // (lowest index) with the fewest moment parameters. Ties are the rule, not the
  // exception: a powder cannot tell several symmetry-distinct models apart
  // (direction ambiguity), and the top-down Landau prescription breaks them.
  const bestRanked = view.best;
  const bestRankedId = bestRanked?.id ?? null;
  // The ranked groups within the noise of the best fit, in the ★'s order (the ≈ marks and their sort).
  const noiseRank = useMemo(() => new Map(view.noise.map((id, n) => [id, n])), [view.noise]);
  function rankCandidates(scope: "open" | "all"): void {
    if (canFit) void step.rank(scope);
  }

  function runRefine(): void {
    void step.refineMoments();
  }

  /** Search candidate k-vectors from the included rows (magneticStep.ts: one option set). */
  function runKSearch(): void {
    step.search();
  }

  function toggleIon(label: string): void {
    step.toggleIon(label);
  }

  // The Agent drives this page through the step's own handle: one object for
  // the panel's life, so a call after an await reads the step as it is.
  useEffect(() => {
    if (!agentHandleRef) return;
    agentHandleRef.current = step.handle;
    return () => {
      agentHandleRef.current = null;
    };
  }, [agentHandleRef, step]);

  // The candidate drawn ON the pattern: the nuclear fit plus this model's
  // magnetic contribution at the current amplitudes, the magnetic part also as
  // its own overlay — so a click on a candidate shows where its intensity goes.
  const previewMagnetic = useMemo(
    () => (patternView?.magneticComponent && appliedMagnetic && appliedMagnetic.moments.length > 0 ? patternView.magneticComponent(appliedMagnetic) : null),
    [patternView, appliedMagnetic],
  );
  const previewCurves = useMemo<PowderCurves | null>(() => {
    if (!patternView) return null;
    const base = patternView.curves;
    if (!previewMagnetic || previewMagnetic.length !== base.yCalc.length) return base;
    const yCalc = base.yCalc.map((v, i) => v + (previewMagnetic[i] ?? 0));
    return { ...base, yCalc, diff: base.yObs.map((o, i) => o - yCalc[i]!) };
  }, [patternView, previewMagnetic]);
  const kIsZero = k.every((c) => Math.abs(c) < 1e-12);
  const nearNuclearCount = peakRows.filter((r) => r.nearNuclear).length;
  const allOnNuclear = peakRows.length > 0 && nearNuclearCount === peakRows.length;

  return (
    <div className={patternView ? "wb-mag2 wb-mag2-rail" : "wb-mag2"}>
      {/* Left rail: in powder mode the refined pattern first — the judging
          tool while clicking candidate groups on the right — then the 3D model
          (magnetic (super)cell; arrows once a group is selected), which fills
          the rest of the rail. On a desktop the powder row scrolls as a whole
          beside this rail, which is pinned to the row's height; without a
          pattern the steps card scrolls inside itself (workbench.css). */}
      <div className="wb-mag2-left">
      {/* Pattern check: is the k / magnetic-space-group choice consistent
          with where the unexplained intensity actually sits? The same view as
          the refinement plot (refined curves, fit range, unit toggle), plus
          the satellite / allowed / residual tick rows. */}
      {patternView && (
        <section className="wb-mag2-pattern" style={{ ...themeCard, padding: space.inset, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={themeLabel}>Powder pattern</span>
            <InfoBadge
              width={300}
              text={
                <>
                  The refinement plot, plus the magnetic tick rows. Per-phase Bragg rows index each
                  phase (impurities included) against its own cell; <b>G ± k</b> marks every position
                  the current k allows; <b>allowed</b> marks the reflections the selected magnetic
                  group keeps (|F<sub>M</sub>|² &gt; 0 with the current moments); <b>residual</b> marks
                  peaks the nuclear fit leaves unexplained. A plausible k puts a G ± k tick under every
                  residual peak; a plausible group keeps those peaks in the allowed row.
                </>
              }
            />
            {patternQuality}
            {patternFitChip && (
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: themeMono, fontSize: 12, color: theme.secondary }}
                title="The data range used for refinement (set with the blue handles)"
              >
                fit {patternFitChip.label}
                <button style={resetRangeBtn} onClick={patternFitChip.onReset} title="Refine over the full pattern again">
                  Reset range
                </button>
              </span>
            )}
            {addingPeak && (
              <span style={{ fontSize: 12, color: theme.noteInk, fontWeight: 600 }}>
                click the pattern to place the peak…
              </span>
            )}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, rowGap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {onFocusFit && (
                <button
                  style={{ ...toolbarBtn, display: "inline-flex", alignItems: "center", gap: 5, ...(patternFitChip ? {} : { opacity: 0.45, cursor: "default" }) }}
                  disabled={!patternFitChip}
                  title={patternFitChip
                    ? "Zoom the plot onto the active fit range"
                    : "Set a fit range first (blue handles), then this zooms the view onto it"}
                  onClick={onFocusFit}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  optimize view
                </button>
              )}
              {patternView.unitToggle}
            </div>
          </div>
          <div className="wb-mag2-plot" style={{ display: "flex", flexDirection: "column" }}>
            <WorkbenchPlot
              curves={previewCurves ?? patternView.curves}
              xLabel={patternView.xLabel}
              phases={previewTicks}
              {...(previewMagnetic ? { overlays: [{ label: "magnetic", y: previewMagnetic }] } : {})}
              highlight={patternPick}
              onHighlight={setPatternPick}
              revealPan="nearest"
              highlightBand
              focusFitToken={focusFitToken}
              {...(addingPeak && canAddPeak
                ? {
                    onPlotClick: (x: number) => {
                      const d = patternView.xToD!(x);
                      if (Number.isFinite(d) && d > 0) {
                        // A click on (or next to) an already-listed peak means
                        // "use that one": include it instead of minting a
                        // duplicate manual entry the merge would swallow.
                        const near = peakRows.find((r) => Math.abs(r.d - d) < 0.01);
                        if (near) step.setOverride(near.key, true);
                        else onAddManualPeak!(d);
                      }
                      setAddingPeak(false);
                    },
                  }
                : {})}
              {...(patternView.fitRange ? { fitRange: patternView.fitRange } : {})}
              {...(patternView.onFitRangeChange ? { onFitRangeChange: patternView.onFitRangeChange } : {})}
            />
          </div>
        </section>
      )}

      <section className="wb-mag2-model" style={{ ...themeCard, padding: space.inset, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={themeLabel}>3D model — {magBuild ? "moment preview" : "refined structure"}</span>
          <InfoBadge
            width={280}
            text={magBuild
              ? `The magnetic unit cell with the selected group's symmetry-allowed moments (red arrows) — atoms without an arrow are moment-forbidden under this group. Directions and relative sizes are well defined; the absolute arrow length carries a display convention.`
              : `The refined nuclear structure over the magnetic (super)cell of the current k. Pick a magnetic space group in step 4 to preview its symmetry-allowed moments here.`}
          />
          <span style={{ marginLeft: "auto", color: theme.secondary, fontFamily: themeMono, fontSize: 12 }}>k = {kLabel(k)}</span>
        </div>
        <Suspense fallback={<div style={{ flex: 1, display: "grid", placeItems: "center", color: theme.secondary, fontSize: 13 }}>Loading 3D model…</div>}>
          <StructureView
            structure={structure}
            propagation={k}
            {...(magBuild ? { magneticOperations: magBuild.magnetic.operations ?? [] } : {})}
            {...(momentEntries ? { moments: momentEntries } : {})}
            {...(standardCell ? { standardCell } : {})}
            minCanvasHeight={240}
            fit
            exports={[viewerCifExport]}
          />
        </Suspense>
      </section>
      </div>

      {/* Right panel: the workflow controls (steps 1–5), at least the row's
          height (see the rail above for what scrolls). */}
      <div className="wb-mag2-steps" style={{ ...themeCard, padding: space.inset, display: "grid", gap: 14, alignContent: "start", minWidth: 0 }}>
      {/* 1. Which sites carry a moment */}
      <section>
        <StepTitle
          n="1"
          title="Magnetic ions"
          info="Tick the site(s) that carry an ordered moment. Candidates are the sites with a tabulated ⟨j0⟩ magnetic form factor; everything below runs on the refined structure from the refinement page."
        />
        {ions.length === 0 ? (
          <p style={help}>No magnetic ions in this structure (no site has a tabulated ⟨j0⟩ form factor).</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {ions.map((ion) => {
              const active = selected.has(ion.siteLabel);
              return (
                <button
                  key={ion.siteLabel}
                  onClick={() => toggleIon(ion.siteLabel)}
                  style={ionChip(active)}
                  title={active ? "Selected — click to exclude this site" : "Click to include this site"}
                >
                  {ion.siteLabel}
                  <span style={{ opacity: 0.72, fontFamily: themeMono, fontSize: 11 }}>{ion.ionId}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. k-vector: typed directly or searched from the residual peaks. The
          model is single-k, so there is exactly ONE active k — "Set k" replaces
          it (no add/remove list), and search rows apply on click. */}
      <section style={sectionDivider}>
        <StepTitle
          n="2"
          title="Propagation vector k"
          info={
            <>
              One k describes the ordering (single-k model), so setting a new k replaces the current
              one. Components accept exact fractions — 1/2, 1/3, −1/3 — or decimals (an irrational
              value is an incommensurate k: no finite magnetic cell, refined through Fourier cos/sin
              amplitudes); exact fractions matter, since 0.333 misses the little-group tolerance where
              1/3 is meant. Type and press Enter (or Set k), pick a search result below, or leave
              k = (0, 0, 0) for an ordering with the nuclear cell.
            </>
          }
          right={
            <span style={kChip} title={`The active propagation vector — steps 3–5 use it. ${describePropagation(kClass)}`}>
              k = {kLabel(k)}{kClass.kind === "incommensurate" ? " · incommensurate" : kClass.twoArms ? " · two arms ±k" : ""}
            </span>
          }
        />
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontFamily: themeMono, fontSize: 13, color: theme.secondary }}>k = (</span>
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              value={kText[i]}
              onChange={(e) => setKText((t) => { const n = [...t] as [string, string, string]; n[i] = e.target.value; return n; })}
              onKeyDown={(e) => { if (e.key === "Enter" && draftPending) applyK(draftK); }}
              placeholder={["0", "1/2", "1/3"][i]}
              style={kInput}
              aria-label={`k${["x", "y", "z"][i]}`}
            />
          ))}
          <span style={{ fontFamily: themeMono, fontSize: 13, color: theme.secondary }}>)</span>
          {/* Idle (the fields hold the k in use), a quiet button of the same
              size rather than a faded primary one, which read as broken. */}
          <button
            style={draftPending ? { ...btn, marginTop: 0 } : setKIdle}
            onClick={() => applyK(draftK)}
            disabled={!draftPending}
            title={draftPending
              ? "Use this propagation vector — the symmetry analysis below re-runs on it"
              : "This k is in use — edit a component to set another"}
          >
            Set k
          </button>
          {draftPending && (
            <span style={{ fontSize: 12, color: theme.noteInk }}>edited — press Enter or Set k</span>
          )}
        </div>
        {kUnsupported && (
          <p style={{ ...help, marginTop: 8, color: theme.noteInk }} role="status">
            <b>This k cannot be fitted against the loaded data.</b> {kUnsupported} The symmetry
            analysis below still applies — only the fit against the data is held back.
          </p>
        )}
        {/* Detected residual peaks: the quantitative input to the k-search.
            Each row has a numbered tick (#n) in the pattern preview; criteria
            (and per-peak checkboxes) decide what feeds the search. */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={themeLabel}>Detected residual peaks</span>
            <InfoBadge
              width={310}
              text={
                <>
                  Peaks in the nuclear-fit residual (obs − calc): local maxima above the noise floor
                  and — when the data carries σ — at least 3σ significant. The criteria below choose
                  which detections feed the k-search: the I/σ threshold, and whether apexes sitting on
                  a nuclear reflection participate (those are usually profile misfit, e.g. an impurity
                  shoulder — though k = 0 orderings do put intensity there). Each peak is marked #n in
                  the pattern; click a row to highlight it there (the view keeps its zoom, and pans only to
                  show a peak that is out of view). <b>Δd→k</b> is the distance to the nearest
                  satellite G ± k of the current k — ≤ 20 mÅ counts as explained. Click a column header
                  to sort; the table opens in # order (d from large to small), and sorting only
                  reorders: a collapsed table shows the same rows in any order.
                </>
              }
            />
            {peakRows.length > 0 && (
              <span style={kChip} title="Peaks feeding the k-search / all detected. Peaks on nuclear positions stay out of a k ≠ 0 search unless included below — they are what k = 0 ordering looks like.">
                {includedPeaks.length}/{peakRows.length} in k-search{nearNuclearCount > 0 ? ` · ${nearNuclearCount} on nuclear positions` : ""}
              </span>
            )}
          </div>
          {peakRows.length === 0 ? (
            <>
              <p style={help}>
                No unexplained peaks in the residual. Refine the nuclear structure first (the residual
                then isolates magnetic intensity), type k directly above — or add a peak by hand below.
              </p>
              {canAddPeak && (
                <div style={{ marginTop: 7 }}>
                  <AddPeakButton adding={addingPeak} onToggle={() => setAddingPeak((v) => !v)} />
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 14, rowGap: 5, marginTop: 7, flexWrap: "wrap", fontSize: 12, color: theme.secondary }}>
                {hasSignificance && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5 }} title="Keep peaks at least this many σ above the counting noise (3–30; commit with Enter or by leaving the field)">
                    I/σ ≥
                    <input
                      type="number"
                      min={3}
                      max={30}
                      step={0.5}
                      value={minSigText}
                      onChange={(e) => setMinSigText(e.target.value)}
                      onBlur={commitMinSig}
                      onKeyDown={(e) => { if (e.key === "Enter") commitMinSig(); }}
                      style={{ ...kInput, width: 52 }}
                    />
                  </label>
                )}
                <label
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}
                  title="A residual apex on a nuclear reflection is usually profile misfit, not magnetic — include them only for k = 0 candidates"
                >
                  <input
                    type="checkbox"
                    checked={allowNearNuclear}
                    onChange={(e) => step.setCriteria({ allowNearNuclear: e.target.checked })}
                  />
                  include peaks at nuclear positions
                </label>
              </div>
              <table style={{ fontSize: 12.5, borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
                <thead>
                  <tr style={{ color: theme.secondary, textAlign: "left" }}>
                    <PeakSortHeader column="use" label="use" title="Include this peak in the k-search" sort={peakSort} onSort={setPeakSort} style={{ ...th, width: 26 }} />
                    <PeakSortHeader column="idx" label="#" title="Tick label in the pattern preview; # runs from large d to small" sort={peakSort} onSort={setPeakSort} style={th} />
                    <PeakSortHeader column="d" label="d (Å)" title="Position of the peak" sort={peakSort} onSort={setPeakSort} style={th} />
                    {hasSignificance && <PeakSortHeader column="significance" label="I/σ" title="Residual height over the counting σ at the apex" sort={peakSort} onSort={setPeakSort} style={th} />}
                    <PeakSortHeader column="delta" label="Δd→k (mÅ)" title="Distance to the nearest satellite G ± k of the current k (≤ 20 mÅ = explained)" sort={peakSort} onSort={setPeakSort} style={th} />
                    <PeakSortHeader column="near" label="near" title="Nuclear reflection within 1% in d — likely profile misfit, not a magnetic peak" sort={peakSort} onSort={setPeakSort} style={th} />
                    <th style={{ ...th, width: 20 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {shownPeakRows.map((row) => {
                    const delta = row.delta;
                    const explained = delta !== undefined && Number.isFinite(delta) && delta <= 0.02;
                    const picked = patternPick?.hkl === `#${row.idx}` && patternPick.phaseId === "residual";
                    return (
                      <tr
                        key={row.key}
                        onClick={() => spotlightPeak(row.idx)}
                        // Enter or Space on the row itself; on its check box or × they are that control's.
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); spotlightPeak(row.idx); }
                        }}
                        tabIndex={0}
                        aria-current={picked ? "true" : undefined}
                        style={{
                          borderTop: `1px solid ${theme.border}`,
                          cursor: "pointer",
                          opacity: row.included ? 1 : 0.55,
                          background: picked ? theme.primaryTintBg : undefined,
                        }}
                        title={picked ? "Highlighted in the pattern (click to clear)" : "Highlight this peak in the pattern"}
                      >
                        <td style={{ ...td, ...(picked ? { boxShadow: `inset 3px 0 0 ${theme.primary}`, padding: "4px 10px 4px 7px" } : {}) }} onClick={(e) => e.stopPropagation()}>
                          {/* The label is the hit area (44px tall on a touch screen, workbench.css). */}
                          <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={row.included}
                              onChange={() => step.setOverride(row.key, !row.included)}
                              title={row.included ? "Exclude from the k-search" : "Include in the k-search"}
                            />
                          </label>
                        </td>
                        <td style={{ ...td, fontFamily: themeMono, color: theme.obs, fontWeight: 600 }}>#{row.idx}</td>
                        <td style={{ ...td, fontFamily: themeMono }}>{row.d.toFixed(4)}</td>
                        {hasSignificance && <td style={{ ...td, fontFamily: themeMono }}>{row.significance?.toFixed(1) ?? "—"}</td>}
                        <td style={{ ...td, fontFamily: themeMono, color: explained ? theme.okInk : theme.warnInk }}>
                          {delta !== undefined && Number.isFinite(delta) ? `${explained ? "✓ " : ""}${(delta * 1000).toFixed(0)}` : "—"}
                        </td>
                        <td style={{ ...td, fontSize: 11.5, color: theme.secondary }}>
                          {row.manual && (
                            <span style={manualChip} title="Manually added (click × to remove)">manual</span>
                          )}
                          {row.nearNuclear
                            ? <span title={`Within ${(100 * row.nearNuclear.relDelta).toFixed(2)}% of ${row.nearNuclear.phaseLabel} (${row.nearNuclear.hkl}), d = ${row.nearNuclear.d.toFixed(4)} Å`}>
                                {nearReflectionLabel(row.nearNuclear, multiPhase)}
                              </span>
                            : ""}
                        </td>
                        <td style={{ ...td, padding: "4px 0" }} onClick={(e) => e.stopPropagation()}>
                          {row.manual && onRemoveManualPeak && (
                            <button
                              style={removePeakBtn}
                              onClick={() => onRemoveManualPeak(row.d)}
                              title="Remove this manually added peak"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: "flex", alignItems: "center", gap: 14, rowGap: 0, flexWrap: "wrap" }}>
                {hiddenPeaks > 0 && (
                  <button
                    style={moreRowsBtn}
                    onClick={() => setAllPeaksShown((v) => !v)}
                    title={allPeaksShown
                      ? "Show the strongest peaks only (and every peak in the k-search)"
                      : "Show every detected peak. Collapsed, the table shows the strongest peaks and every peak in the k-search, in the order set by the column headers."}
                  >
                    {allPeaksShown ? "Show fewer peaks" : `Show all ${peakRows.length} peaks (${hiddenPeaks} more)`}
                  </button>
                )}
                {!isDefaultPeakSort(peakSort) && (
                  <span style={{ ...moreRowsBtn, color: theme.secondary, cursor: "default", display: "inline-flex", alignItems: "center", gap: 8 }}>
                    sorted by {describePeakSort(peakSort)}
                    <button
                      style={{ ...moreRowsBtn, padding: 0 }}
                      onClick={() => setPeakSort(DEFAULT_PEAK_SORT)}
                      title="Back to the default order: # ascending, d from large to small"
                    >
                      default order
                    </button>
                  </span>
                )}
                {/* The sorted column is in the header's aria-sort; this says it when a press changes it. */}
                <span className="wb-sr-only" role="status" aria-live="polite">Peaks sorted by {describePeakSort(peakSort)}</span>
              </div>
              {allOnNuclear && !allowNearNuclear && (
                <div style={kZeroNote}>
                  <b>Every residual peak sits on a nuclear reflection.</b> That is what a <b>k = 0</b> ordering
                  looks like — magnetic intensity adds onto the nuclear peaks — or profile misfit; a k ≠ 0
                  search has nothing to work with here.{" "}
                  {kIsZero
                    ? <>k = (0 0 0) is set: pick a group in step 4, or rank the candidates there against the data.</>
                    : <>Set k = (0 0 0) and rank the candidates in step 4.</>}
                  <span style={{ display: "inline-flex", gap: 8, marginLeft: 10, verticalAlign: "middle" }}>
                    {!kIsZero && (
                      <button style={ghostBtn} onClick={() => applyK([0, 0, 0])} title="Use k = 0 — the ordering keeps the nuclear cell">
                        Use k = 0
                      </button>
                    )}
                    <button
                      style={ghostBtn}
                      onClick={() => step.setCriteria({ allowNearNuclear: true })}
                      title="Feed the peaks at nuclear positions to the k-search anyway (they will favour k = 0 and its harmonics)"
                    >
                      Include them in the k-search
                    </button>
                  </span>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, flexWrap: "wrap" }}>
                <button
                  style={{ ...ghostBtn, opacity: includedPeaks.length === 0 ? 0.5 : 1 }}
                  onClick={() => runKSearch()}
                  disabled={includedPeaks.length === 0}
                  title={includedPeaks.length === 0
                    ? "No peaks pass the criteria — lower the I/σ threshold or tick peaks manually"
                    : "Score candidate propagation vectors by how well their satellites G ± k reproduce the included peaks (FullProf-style position matching, significance-weighted)"}
                >
                  Search k from {includedPeaks.length} peak{includedPeaks.length === 1 ? "" : "s"}
                </button>
                {canAddPeak && <AddPeakButton adding={addingPeak} onToggle={() => setAddingPeak((v) => !v)} />}
              </div>
            </>
          )}
        </div>
        {results && (
          <div style={{ marginTop: 8 }}>
            {results.length === 0 ? (
              <p style={help}>No candidate k reproduces the detected peaks — check the nuclear fit, or set k directly above.</p>
            ) : (
              <table style={{ fontSize: 12.5, borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ color: theme.secondary, textAlign: "left" }}>
                    <th style={{ ...th, width: 22 }}></th><th style={th}>k</th><th style={th}>matched</th>
                    <th style={th} title="Which peaks of the table above this candidate explains (hover for each Δd)">explains</th>
                    <th style={th}>RMSD (Å)</th>
                  </tr>
                </thead>
                <tbody role="radiogroup" aria-label="Candidate propagation vectors">
                  {results.slice(0, 8).map((c) => {
                    const active = c.k.every((v, i) => Math.abs(v - k[i]!) < 1e-9);
                    // matches index into the searched list = includedPeaks at
                    // search time; results are invalidated when that set
                    // changes, so the mapping stays valid (guarded regardless).
                    const explained = c.matches
                      .map((m) => ({ row: includedPeaks[m.index], delta: m.delta }))
                      .filter((e): e is { row: (typeof includedPeaks)[number]; delta: number } => e.row !== undefined);
                    return (
                      <tr
                        key={c.label}
                        onClick={() => applyK(c.k)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applyK(c.k); } }}
                        role="radio"
                        aria-checked={active}
                        tabIndex={0}
                        style={{ borderTop: `1px solid ${theme.border}`, cursor: "pointer", background: active ? theme.primaryTintBg : undefined }}
                        title="Use this propagation vector"
                      >
                        <td style={td}><span style={radioDot(active)} /></td>
                        <td style={{ ...td, fontFamily: themeMono, ...(active ? { color: theme.primary, fontWeight: 600 } : {}) }}>{c.label}</td>
                        <td style={td}>{c.matched}/{c.total}</td>
                        <td
                          style={{ ...td, fontFamily: themeMono, fontSize: 11.5, color: theme.obs }}
                          title={explained.map((e) => `#${e.row.idx}: Δd ${(e.delta * 1000).toFixed(0)} mÅ`).join(" · ") || undefined}
                        >
                          {explained.map((e) => `#${e.row.idx}`).join(" ") || "—"}
                        </td>
                        <td style={td}>{Number.isFinite(c.rmsd) ? c.rmsd.toFixed(4) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* 3. Choose the symmetry framework */}
      <section style={sectionDivider}>
        <StepTitle
          n="3"
          title="Symmetry framework"
          info={
            <>
              Two equivalent languages for the ordering the little group G(k) allows — both converge
              on a magnetic space group in step 4. <b>Magnetic space groups</b> (Shubnikov,
              k-SUBGROUPSMAG style): enumerate every subgroup H ≤ G(k) with every time-reversal
              assignment θ, grouped by index, one representative per conjugacy class.{" "}
              <b>Representation analysis</b> (SARAh / BasIreps style): decompose Γ<sub>mag</sub> into
              irreps of G(k) and pick any combination — its magnetic space group is the isotropy
              subgroup (exact stabilizer) of the mixed order parameter.
            </>
          }
          right={
            <span style={kChip} title={`Little group of k: ${lgSize} of the ${structure.spaceGroup.operations.length} parent operations leave k invariant`}>
              G(k): {lgSize}/{structure.spaceGroup.operations.length} ops
            </span>
          }
        />
        <div style={{ display: "inline-flex", gap: 2, background: theme.chipBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 2 }}>
          {FRAMEWORKS.map((f) => (
            <button
              key={f.id}
              onClick={() => step.setFramework(f.id)}
              style={{
                border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: themeMono,
                background: framework === f.id ? theme.primary : "transparent",
                color: framework === f.id ? "#fff" : theme.secondary,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {/* 4. Magnetic space group — picked directly, or through an irrep */}
      <section style={sectionDivider}>
        <StepTitle
          n="4"
          title="Magnetic space group"
          info={framework === "msg"
            ? (
              <>
                Every candidate subgroup class (each H ≤ G(k) with each time-reversal assignment θ),
                grouped by index in the grey group and sorted by BNS number. Work top-down: the
                physical symmetry is usually a <b>maximal</b> (index-2) subgroup — descend only when
                no maximal candidate fits. The badge on each row is the moment degrees of freedom the
                group allows on your selected site(s); click a candidate to preview it in step 5.
              </>
            )
            : (
              <>
                Tick one irrep (the Landau single-irrep prescription) or any combination (SARAh-style
                mixing) — the resulting magnetic space group is the isotropy subgroup of the mixed
                order parameter, computed as the exact stabilizer of a generic combination and named
                from the standard BNS/OG table.
              </>
            )}
          {...(framework === "msg" && reps.length > 0
            ? { right: <span style={kChip}>{reps.length} class{reps.length === 1 ? "" : "es"}</span> }
            : {})}
        />
        {framework === "msg" ? (
          <>
            {reps.length > 0 && (() => {
              const allowing = reps.map((r, i) => ({ r, i })).filter(({ i }) => (repMomentDims[i] ?? 0) > 0);
              const inOpen = allowing.filter(({ r }) => openIndices.has(r.index));
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, rowGap: 6, flexWrap: "wrap", margin: "2px 0 8px" }}>
                  <button
                    style={{ ...btn, marginTop: 0, opacity: canFit && !rank.running && inOpen.length > 0 ? 1 : 0.5 }}
                    disabled={!canFit || rank.running || inOpen.length === 0}
                    onClick={() => void rankCandidates("open")}
                    title={canFit
                      ? "Refine the moments of every moment-allowing candidate in the open index sections against the data (nuclear model held fixed) and sort the rows by agreement"
                      : "Load a dataset to rank candidates against it"}
                  >
                    {rank.running ? `Ranking ${rank.done}/${rank.total}…` : `Rank ${inOpen.length} candidate${inOpen.length === 1 ? "" : "s"} against the data`}
                  </button>
                  {!rank.running && allowing.length > inOpen.length && (
                    <button style={ghostBtn} disabled={!canFit} onClick={() => void rankCandidates("all")} title="Also the collapsed index sections — every candidate that allows a moment">
                      all {allowing.length}
                    </button>
                  )}
                  {rank.running && (
                    <button style={ghostBtn} onClick={() => step.cancelRank()} title="Stop after the current candidate; finished rows stay">
                      Cancel
                    </button>
                  )}
                  {baselineAgreement != null && (
                    <span style={kChip} title="The nuclear-only fit every candidate is compared against (Δ in the rows)">
                      nuclear only · {agreementLabel} {(100 * baselineAgreement).toFixed(2)}%
                    </span>
                  )}
                  {!rank.running && rank.total > 0 && bestRanked && (
                    <span style={{ fontSize: 12, color: theme.secondary }}>rows sorted by fit · ≈ within the noise of the best fit (Hamilton's test) · ★ the first of those top-down: no other contains it, then the lowest index and the fewest moment parameters · click a row to preview it with its refined moments</span>
                  )}
                  {!rank.running && rank.total > 0 && bestRanked && baselineAgreement != null && bestRanked.wR > baselineAgreement - 5e-4 && (
                    <span style={{ ...kZeroNote, marginTop: 0, flexBasis: "100%" }}>
                      <b>No candidate improves on the nuclear-only fit</b> (best Δ{agreementLabel}{" "}
                      {(100 * (bestRanked.wR - baselineAgreement)).toFixed(2)} %). At this k the data carry no
                      magnetic signal the model can pick up — the pattern may be paramagnetic, the moments below
                      detection, or k wrong. Check the residual (step 2) before trusting any of these moments.
                    </span>
                  )}
                </div>
              );
            })()}
            {(() => {
              const all = reps.map((r, i) => ({ r, i }));
              const indices = [...new Set(all.map(({ r }) => r.index))].sort((a, b) => a - b);
              // BNS-number sort key: labeled candidates in table order, unlabeled last.
              const bnsKey = ({ r }: { r: LatticeCandidate }): number => {
                const num = r.candidate.standard?.bnsNumber ?? r.settingMatch?.identity.bnsNumber;
                if (!num) return Number.MAX_SAFE_INTEGER;
                const [a, b] = num.split(".").map(Number);
                return (a ?? 999) * 100000 + (b ?? 0);
              };
              return (
                <div style={{ margin: "6px 0 0", display: "grid", gap: 3 }}>
                  {indices.map((idx) => {
                    // Bilbao k-SUBGROUPSMAG order: BNS number ascending within
                    // the index (matches the core lattice sort). The moment DOF
                    // each group allows on your sites is shown per row, not used
                    // to reorder.
                    const group = all
                      .filter(({ r }) => r.index === idx)
                      .sort((A, B) => bnsKey(A) - bnsKey(B) || A.r.classId - B.r.classId);
                    // Ranked rows lead, best fit first; unranked keep the BNS order after them.
                    const wrOf = (c: { r: LatticeCandidate }): number => {
                      const e = rank.results[c.r.candidate.id];
                      return e?.status === "ok" && e.wR != null ? e.wR : Infinity;
                    };
                    // The fits within the noise of the best (Hamilton's test) lead, in the ★'s
                    // order; the rest follow by fit.
                    const ordered = rank.total > 0
                      ? [...group].sort((A, B) => {
                          const a = wrOf(A), b = wrOf(B);
                          if (a === Infinity && b === Infinity) return bnsKey(A) - bnsKey(B);
                          const na = noiseRank.get(A.r.candidate.id);
                          const nb = noiseRank.get(B.r.candidate.id);
                          if (na !== undefined || nb !== undefined) return (na ?? Infinity) - (nb ?? Infinity);
                          return a - b;
                        })
                      : group;
                    const open = openIndices.has(idx);
                    const allowing = group.filter(({ i }) => (repMomentDims[i] ?? 0) > 0).length;
                    const holdsSelection = selIdx != null && group.some(({ i }) => i === selIdx);
                    return (
                      <div key={idx} style={{ display: "grid", gap: 3 }}>
                        <button
                          onClick={() => step.toggleOpen(idx)}
                          style={{
                            textAlign: "left", fontSize: 11.5, fontFamily: themeMono, cursor: "pointer",
                            border: "none", background: "transparent", color: theme.secondary,
                            padding: "4px 2px", marginTop: idx === indices[0] ? 0 : 4,
                            display: "flex", alignItems: "baseline", gap: 8,
                          }}
                        >
                          <span style={{ color: theme.primary }}>{open ? "▾" : "▸"}</span>
                          <span style={{ fontWeight: 700 }}>index {idx}{group.some(({ i }) => view.maximal[i]) ? " — maximal" : ""}</span>
                          <span>
                            {group.length} class{group.length === 1 ? "" : "es"} · {allowing} allow moments
                          </span>
                          {!open && holdsSelection && <span style={{ color: theme.primary }}>· selected inside</span>}
                        </button>
                        {open && ordered.map(({ r, i }) => {
                        const lbl = latticeLabel(r);
                        const dim = repMomentDims[i] ?? 0;
                        const entry = rank.results[r.candidate.id];
                        const isBest = r.candidate.id === bestRankedId;
                        const isTie = !isBest && noiseRank.has(r.candidate.id);
                        const delta = entry?.status === "ok" && entry.wR != null && baselineAgreement != null ? entry.wR - baselineAgreement : null;
                        return (
                          <button
                            key={r.candidate.id}
                            // A ranked row previews its refined moments; a second click clears the choice.
                            onClick={() => step.choose(i === selIdx ? null : i)}
                            style={{
                              textAlign: "left", fontSize: 12.5, padding: "5px 9px", borderRadius: 7, cursor: "pointer",
                              border: `1px solid ${i === selIdx ? theme.primary : isBest ? theme.okBorder : theme.border}`,
                              background: i === selIdx ? theme.chipBg : isBest ? theme.okBg : "#fff",
                              opacity: dim === 0 ? 0.55 : 1,
                            }}
                            title={dim === 0
                              ? "No symmetry-allowed moment on the selected site(s) under this group"
                              : entry?.status === "ok" && entry.wR != null
                                ? `Moments-only fit: ${agreementLabel} ${(100 * entry.wR).toFixed(2)}%${delta != null ? ` (${delta <= 0 ? "−" : "+"}${Math.abs(100 * delta).toFixed(2)} vs nuclear only)` : ""} · |M| ${entry.magnitudes.map((m) => `${m.label} ${m.value.toFixed(2)}`).join(", ")} µ_B${isTie ? " — within the noise of the best fit (Hamilton's test): the powder cannot tell it from the ★ candidate; the ★ is the higher-symmetry / fewer-parameter choice" : ""} — click to preview with these moments`
                                : undefined}
                          >
                            <span style={{ fontFamily: themeMono, color: theme.secondary }}>
                              {`type ${["I", "II", "III", "IV"][r.magneticType - 1]}`}
                            </span>
                            {" · "}{lbl.symbol}
                            {lbl.numbers && <span style={{ color: theme.secondary }}> · {lbl.numbers}</span>}
                            {lbl.setting && (
                              <span style={{ color: theme.noteInk }}> · setting {lbl.setting}</span>
                            )}
                            {r.domainCount > 1 && (
                              <span style={{ color: theme.secondary }}> · ×{r.domainCount} domains</span>
                            )}
                            {view.maximal[i] && (
                              <span style={{ color: theme.okInk }} title="No candidate above it in the lattice carries a moment on your sites: where a top-down search starts"> · maximal</span>
                            )}
                            <span style={{ float: "right", display: "inline-flex", gap: 10, alignItems: "baseline", fontFamily: themeMono, fontSize: 11.5 }}>
                              {entry?.status === "ok" && entry.wR != null && (
                                <span style={{ color: delta != null && delta < -1e-4 ? theme.okInk : theme.secondary }}>
                                  {isBest ? "★ " : isTie ? "≈ " : ""}{agreementLabel} {(100 * entry.wR).toFixed(2)}%
                                  {delta != null && <span style={{ color: theme.secondary }}> ({delta <= 0 ? "−" : "+"}{Math.abs(100 * delta).toFixed(2)})</span>}
                                  {entry.magnitudes.length > 0 && <span style={{ color: theme.secondary }}> · |M| {entry.magnitudes.map((m) => m.value.toFixed(2)).join(", ")}</span>}
                                </span>
                              )}
                              {entry?.status === "failed" && <span style={{ color: theme.warnInk }}>fit failed</span>}
                              <span style={{ color: dim === 0 ? theme.secondary : theme.primary }}>
                                {dim === 0 ? "moment forbidden" : `${dim} moment dof`}
                              </span>
                            </span>
                          </button>
                        );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </>
        ) : !irrepAnalysis ? (
          <p style={help}>Select at least one magnetic ion in step 1.</p>
        ) : !irrepAnalysis.dec.available ? (
          <p style={help}>
            This <strong>non-abelian</strong> little co-group at <strong>k ≠ 0</strong> needs the
            projective <em>small</em> representations — the remaining piece (see
            docs/MAGNETIC_SYMMETRY.md). At k = 0 the irreps are generated for any point group.
            Switch to the <strong>magnetic space groups</strong> framework above — it applies to
            every G(k).
          </p>
        ) : (
          <>
            <p style={help}>
              Γ<sub>mag</sub> ({irrepAnalysis.dec.dimension}-dim
              {irrepAnalysis.dec.method === "induced" ? ", induced point-group irreps, exact at k = 0" : ""}) ={" "}
              <span style={{ fontFamily: themeMono, color: theme.ink }}>
                {irrepAnalysis.dec.terms.map((t) => `${t.multiplicity}${t.irrep.label}`).join(" ⊕ ") || "—"}
              </span>
            </p>
            <div style={{ margin: "6px 0 0", display: "grid", gap: 3 }}>
              {irrepAnalysis.dec.terms.map((t, i) => {
                const modes = irrepAnalysis.modes[i] ?? [];
                const modeText = modes.length ? modes.map((m) => describeMomentMode(m)).join(", ") : "—";
                const active = chosenIrreps.has(t.irrep.label);
                const dim = t.irrep.dim ?? 1;
                const selectable = t.irrep.real && dim === 1;
                const blockReason = dim > 1 ? ISOTROPY_FAILURE_TEXT["multidim-irrep"] : ISOTROPY_FAILURE_TEXT["complex-irrep"];
                return (
                  <label
                    key={t.irrep.label}
                    style={{
                      textAlign: "left", fontSize: 12, padding: "4px 9px", borderRadius: 7,
                      border: `1px solid ${active ? theme.primary : theme.border}`,
                      background: active ? theme.chipBg : "#fff",
                      display: "flex", gap: 8, alignItems: "baseline", width: "100%",
                      cursor: selectable ? "pointer" : "default",
                      opacity: selectable ? 1 : 0.6,
                    }}
                    title={selectable ? undefined : blockReason}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      disabled={!selectable}
                      onChange={() => step.toggleIrrep(t.irrep.label)}
                      style={{ alignSelf: "center" }}
                    />
                    <span style={{ fontFamily: themeMono, color: theme.primary, minWidth: 56 }}>{t.multiplicity} × {t.irrep.label}</span>
                    <span style={{ color: theme.secondary }}>
                      {dim > 1 ? `${dim}-dim` : t.irrep.real ? "real" : "complex"} · modes:{" "}
                      <span style={{ color: theme.ink }}>{modeText}</span>
                    </span>
                    {!selectable && (
                      <span style={{ marginLeft: "auto", fontSize: 11.5, color: theme.secondary, whiteSpace: "nowrap" }}>
                        {dim > 1 ? "multidim — direction UI pending" : "conjugate pair — type-IV territory"}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            {combo && ("failure" in combo ? (
              <p style={{ ...help, marginTop: 8, color: theme.noteInk }}>{ISOTROPY_FAILURE_TEXT[combo.failure]}</p>
            ) : (
              <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 7, border: `1px solid ${theme.primary}`, background: theme.chipBg, fontSize: 12.5 }}>
                <span style={{ color: theme.secondary }}>Isotropy subgroup of </span>
                <span style={{ fontFamily: themeMono }}>{[...chosenIrreps].sort().join(" ⊕ ")}</span>
                <span style={{ color: theme.secondary }}>: </span>
                {combo.standard ? (
                  <strong>{formatMagneticSymbol(combo.standard.bnsSymbol)}
                    <span style={{ fontWeight: 400, color: theme.secondary }}> · BNS {combo.standard.bnsNumber} · OG {combo.standard.ogNumber}</span>
                  </strong>
                ) : combo.settingMatch ? (
                  <strong>{formatMagneticSymbol(combo.settingMatch.identity.bnsSymbol)}
                    <span style={{ fontWeight: 400, color: theme.secondary }}>
                      {" "}· BNS {combo.settingMatch.identity.bnsNumber} · OG {combo.settingMatch.identity.ogNumber} · setting {combo.settingMatch.transformation}
                    </span>
                  </strong>
                ) : (
                  <strong>order-{combo.subgroupOrder} group
                    <span style={{ fontWeight: 400, color: theme.secondary }}> — no tabulated setting match (symbol withheld rather than guessed)</span>
                  </strong>
                )}
                {comboRepIdx != null && (
                  <span style={{ color: theme.secondary }}> · = candidate {comboRepIdx + 1} of the subgroup list</span>
                )}
                <div style={{ ...help, marginTop: 4 }}>
                  The moment preview in step 5 refines this group&rsquo;s symmetry-allowed modes — for a single
                  irrep these are exactly its basis modes; for a combination, the union.
                </div>
              </div>
            ))}
            {!irrepAnalysis.dec.integerConsistent && (
              <p style={{ ...help, marginTop: 6, color: theme.noteInk }}>
                Non-integer multiplicities: this non-symmorphic BZ-boundary k needs the projective
                <em> small</em> representations (ordinary irreps shown as an approximation).
              </p>
            )}
          </>
        )}
      </section>

      {/* 5. Selected subgroup: editable moments + 3D preview + handoff */}
      {magBuild && (
        <section style={sectionDivider}>
          <StepTitle
            n="5"
            title="Moments — refine & continue"
            info={
              <>
                The chosen group's symmetry-allowed moment amplitudes (µ<sub>B</sub>). Edit them, or
                let <b>Refine moments</b> fit them here against the pattern (nuclear model held
                fixed, shared scale) — the 3D model updates live. <b>Show on refinement pattern</b>{" "}
                overlays this model on the refinement plot; <b>Continue in refinement page</b> adds
                the moment parameters to the main refinement, where Refine fits nuclear + magnetic
                together.
              </>
            }
            right={
              <span style={{ fontSize: 12, color: theme.secondary, fontFamily: themeMono, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {framework === "msg" && selIdx != null && reps[selIdx]
                  ? `${latticeLabel(reps[selIdx]!).symbol} · index ${reps[selIdx]!.index}`
                  : framework === "irrep" && combo && !("failure" in combo)
                    ? `isotropy of ${[...chosenIrreps].sort().join(" ⊕ ")}`
                    : null}
              </span>
            }
          />
          {magBuild.params.length === 0 ? (
            <p style={help}>No symmetry-allowed moment on the selected ion(s) under this subgroup — the moment is forbidden here.</p>
          ) : (
            <div style={{ display: "grid", gap: 12, marginTop: 6 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {magBuild.params.map((p) => (
                  <label key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                    <span style={{ color: theme.secondary }}>{p.label} (µ_B)</span>
                    {p.expression ? (
                      // Derived by the |M| tie: shown, not edited — it follows the reference.
                      <input
                        type="number"
                        value={+(resolvedAmps[p.id] ?? p.value).toFixed(3)}
                        readOnly
                        disabled
                        title={`Derived from the tie ${p.expression} — edit the reference amplitudes instead`}
                        style={{ ...kInput, opacity: 0.7 }}
                      />
                    ) : (
                      <input
                        type="number"
                        step={0.1}
                        value={amps[p.id] ?? p.value}
                        onChange={(e) => step.setAmp(p.id, Number(e.target.value))}
                        style={kInput}
                      />
                    )}
                  </label>
                ))}
              </div>
              {(hasSharedMagSite || canTieMagnitudes) && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, rowGap: 6 }}>
                    {hasSharedMagSite && (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: theme.secondary }} title="Constrain co-located (disordered) magnetic ions to the same moment vector">
                        <input type="checkbox" checked={tieMoments} onChange={(e) => step.setTies({ sameSite: e.target.checked })} />
                        Same moment on shared site
                      </label>
                    )}
                    {canTieMagnitudes && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: theme.secondary, cursor: "pointer" }}>
                          <input type="checkbox" checked={tieMagnitudes} onChange={(e) => step.setTies({ magnitudes: e.target.checked })} />
                          Equal |M|
                        </label>
                        {tieMagnitudes && (
                          <select
                            value={tieScope}
                            onChange={(e) => step.setTies({ scope: e.target.value as "element" | "all" })}
                            style={tieScopeSelect}
                            title="Tie moment sizes within each element (Mn1 = Mn2), or across every selected site (the high-entropy case)"
                          >
                            <option value="element">per element</option>
                            <option value="all">all sites</option>
                          </select>
                        )}
                        <InfoBadge
                          width={300}
                          text={
                            <>
                              One shared amplitude drives every tied sublattice (site or split orbit) —
                              same moment <b>size</b>, each sublattice keeping its own symmetry-allowed
                              direction(s). Scope: <b>per element</b> ties Mn1 = Mn2 but leaves Fe free;{" "}
                              <b>all sites</b> ties every selected site regardless of element. Use the{" "}
                              <b>flip</b> toggles to make a tied sublattice antiparallel to the
                              reference. A sublattice with a single allowed mode is tied to a multi-mode
                              reference through a derived amplitude equal to ±|M| of the reference (the
                              reference's modes are re-expressed orthonormally, so its amplitudes are
                              components of one vector); two multi-mode sublattices of different
                              geometry cannot be tied and stay independent (noted below).
                            </>
                          }
                        />
                      </span>
                    )}
                  </div>
                  {tieMagnitudes && magBuild.magnitudeTies.length === 0 && (
                    <span style={{ fontSize: 12, color: theme.secondary }}>
                      Nothing to tie under this group — no element has two magnetic sublattices here.
                    </span>
                  )}
                  {tieMagnitudes && magBuild.magnitudeTies.map((t) => (
                    <div key={t.element} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, rowGap: 5, fontSize: 12, color: theme.secondary }}>
                      <span style={{ fontFamily: themeMono }}>
                        {t.element}: |M({t.reference})|{t.members.map((m) => ` = |M(${m.label})|`).join("")}
                      </span>
                      {t.members.map((m) => (
                        <label key={m.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }} title={`Make ${m.label} antiparallel to ${t.reference}`}>
                          <input
                            type="checkbox"
                            checked={flippedUnits.has(m.key)}
                            onChange={() => step.toggleFlip(m.key)}
                          />
                          flip {m.label}
                        </label>
                      ))}
                      {t.skipped.length > 0 && (
                        <span style={{ color: theme.noteInk }}>
                          {t.skipped.map((s) => s.label).join(", ")} not tied — {t.skipped[0]!.reason}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 8, flexWrap: "wrap" }}>
                <button style={{ ...btn, marginTop: 0, opacity: canRefine && !refining ? 1 : 0.5 }} onClick={runRefine} disabled={!canRefine || refining}>
                  {refining ? "Refining…" : "Refine moments"}
                </button>
                {refineWR != null && (
                  <span style={{ fontSize: 12.5, color: theme.secondary, fontFamily: themeMono }}>{agreementLabel} = {(100 * refineWR).toFixed(1)}%</span>
                )}
                {onApply && (
                  <button
                    style={{ ...btn, marginTop: 0, background: "#fff", color: theme.primary, border: `1px solid ${theme.primary}`, ...(kUnsupported ? { opacity: 0.5 } : {}) }}
                    onClick={() => onApply(applyMagneticMoments(magBuild.magnetic, magBuild.bindings, resolvedAmps))}
                    disabled={!!kUnsupported}
                    title={kUnsupported ?? "Put this candidate on the refinement page: it joins the calculated pattern with its moments HELD at the amplitudes shown here, so Refine fits the nuclear parameters against nuclear + magnetic. Continue instead to add the moment rows and refine them too."}
                  >
                    Show on refinement pattern
                  </button>
                )}
                {onContinue && canRefineK && (
                  <label
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: theme.secondary, cursor: "pointer" }}
                    title={`Continue also adds k${kRows!.params.filter((p) => !p.expression).map((p) => p.id.slice(-1)).join(", k")} as refinable rows (Propagation vector group) — only the components the little group of k leaves free${kRows!.params.some((p) => p.expression) ? "; a component on the same symmetry line follows as a tie" : ""}. The fit moves k in steps of at most 0.005 r.l.u. per cycle.`}
                  >
                    <input type="checkbox" checked={refineK} onChange={(e) => step.setRefineK(e.target.checked)} />
                    Refine k
                  </label>
                )}
                {onContinue && allowRefineK && !canRefineK && kRows && kRows.notes.length > 0 && (
                  <span style={{ fontSize: 12, color: theme.secondary }} title={kRows.notes.join("; ")}>k held fixed</span>
                )}
                {onContinue && (
                  <button
                    style={{ ...btn, marginTop: 0, ...(kUnsupported ? { opacity: 0.5 } : {}) }}
                    onClick={() => {
                      const out = handoff(magBuild, resolvedAmps, refineK && canRefineK ? kRows : null);
                      onContinue(out.magnetic, out.params, out.bindings);
                    }}
                    disabled={!!kUnsupported}
                    {...(kUnsupported ? { title: kUnsupported } : {})}
                  >
                    Continue in refinement page →
                  </button>
                )}
                {kUnsupported && (
                  <span style={{ fontSize: 12, color: theme.noteInk }}>this k is not fittable against the loaded data — see above</span>
                )}
                <span style={{ fontSize: 12, color: theme.secondary }} title="The HTML report (Export ▾ → Report) includes the candidate shown here, labelled as such, until you Continue.">
                  report: Export ▾
                </span>
              </div>
            </div>
          )}
        </section>
      )}
      </div>
    </div>
  );
}

/** Toggle for the click-to-add-peak mode: armed until the next plot click
 *  places the peak (or until clicked again to cancel). */
function AddPeakButton({ adding, onToggle }: { adding: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      style={{
        ...ghostBtn,
        ...(adding ? { border: `1px solid ${theme.primary}`, color: theme.primary, background: theme.primaryTintBg } : {}),
      }}
      onClick={onToggle}
      title={adding
        ? "Click the position of the missed peak in the pattern plot — or click here again to cancel"
        : "Add a peak the detector missed: arm this, then click its position in the pattern plot"}
    >
      {adding ? "Click the pattern… (cancel)" : "+ Add peak from plot"}
    </button>
  );
}

/** Numbered step header: circled number + tracked label + optional info badge
 *  and a right-aligned status chip. One consistent look for every workflow step. */
function StepTitle({ n, title, info, right }: {
  n: string;
  title: string;
  info?: ReactNode;
  right?: ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, minWidth: 0 }}>
      <span style={stepNum}>{n}</span>
      <span style={themeLabel}>{title}</span>
      {info && <InfoBadge text={info} width={300} />}
      {right && <span style={{ marginLeft: "auto", display: "inline-flex", minWidth: 0 }}>{right}</span>}
    </div>
  );
}

const help: React.CSSProperties = { fontSize: 12, color: theme.secondary, margin: "4px 0 0", maxWidth: 560 };
/** The k = 0 explanation shown when every residual peak sits on a nuclear reflection. */
const kZeroNote: React.CSSProperties = {
  marginTop: 8, padding: "7px 10px", borderRadius: 7, fontSize: 12, lineHeight: 1.55,
  background: theme.noteBg, border: `1px solid ${theme.noteBorder}`, color: theme.noteInk, maxWidth: 640,
};
const kInput: React.CSSProperties = { width: 64, border: `1px solid ${theme.control}`, borderRadius: 7, padding: "3px 7px", fontSize: 13, fontFamily: themeMono };
const btn: React.CSSProperties = { marginTop: 6, border: "none", background: theme.primary, color: "#fff", borderRadius: 7, padding: "4px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
/** "Set k" while the fields hold the k in use: btn's size, nothing to press. */
const setKIdle: React.CSSProperties = { ...btn, marginTop: 0, background: theme.chipBg, color: theme.secondary, cursor: "default" };
/** The peak table's "Show all" footer: a text button under the last row. */
const moreRowsBtn: React.CSSProperties = { border: "none", background: "transparent", padding: "5px 0 0", fontSize: 12, color: theme.primary, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { border: `1px solid ${theme.control}`, background: "#fff", borderRadius: 7, padding: "3px 12px", fontSize: 12, color: theme.ink, cursor: "pointer" };
const th: React.CSSProperties = { padding: "2px 10px 4px 0", fontWeight: 600 };
const td: React.CSSProperties = { padding: "4px 10px 4px 0" };

/** Circled step number for the workflow headers. */
const stepNum: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 17, height: 17, borderRadius: "50%", flex: "none",
  background: theme.primary, color: "#fff",
  fontSize: 10, fontWeight: 700, fontFamily: themeMono, lineHeight: 1,
};

/** Steps 2+ get a hairline divider so the panel reads as one card of stages. */
const sectionDivider: React.CSSProperties = { borderTop: `1px solid ${theme.subtle}`, paddingTop: 12 };

/** Mono status chip (active k, little-group size, class count …). */
const kChip: React.CSSProperties = {
  fontFamily: themeMono, fontSize: 11.5, color: theme.secondary,
  background: theme.chipBg, border: `1px solid ${theme.border}`,
  borderRadius: 999, padding: "1px 9px", whiteSpace: "nowrap",
};

/** Selectable magnetic-ion pill. */
function ionChip(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "3px 11px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
    border: `1px solid ${active ? theme.primary : theme.control}`,
    background: active ? theme.primaryTintBg : "#fff",
    color: active ? theme.primary : theme.secondary,
    fontWeight: active ? 600 : 400,
  };
}

/** Radio indicator for the k-search result rows (one active k at a time). */
function radioDot(active: boolean): React.CSSProperties {
  return {
    display: "inline-block", width: 11, height: 11, borderRadius: "50%",
    border: `1.5px solid ${active ? theme.primary : theme.control}`,
    background: active ? theme.primary : "#fff",
    boxShadow: active ? "inset 0 0 0 2px #fff" : undefined,
  };
}

/** Scope select for the |M| tie (per element / all sites). */
const tieScopeSelect: React.CSSProperties = {
  border: `1px solid ${theme.control}`, borderRadius: 6, padding: "1px 4px",
  fontSize: 11.5, color: theme.ink, background: "#fff",
};

/** Tiny pill marking a manually added peak row. */
const manualChip: React.CSSProperties = {
  display: "inline-block", fontSize: 10, fontFamily: themeMono, color: theme.secondary,
  border: `1px solid ${theme.border}`, borderRadius: 999, padding: "0 6px", marginRight: 5,
};

/** "×" remove control on manual peak rows. */
const removePeakBtn: React.CSSProperties = {
  border: "none", background: "none", cursor: "pointer", color: theme.secondary,
  fontSize: 14, lineHeight: 1, padding: "0 4px",
};

/** Toolbar button (blue outline) — matches the refinement plot header. */
