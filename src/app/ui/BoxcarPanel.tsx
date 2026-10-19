/**
 * Boxcar view for the PDF workbench plot card: how each refined parameter
 * drifts as a fixed-width r-window slides across G(r).
 *
 * The reading is the point of the whole feature — a value that changes with the
 * box center means the local structure differs from the average one — so the
 * panel is built around ONE parameter track at a time (picked from a chip row),
 * drawn with its per-box esd bars, plus the Rw-vs-r context strip that says
 * whether each box was fitted well enough for its value to mean anything.
 *
 * The plan (box width, step, direction, restarts) lives HERE rather than in the
 * parameter panel: these settings shape this view's result and nothing else, so
 * they sit with the run button and the plot they produce, and the refinement
 * panel keeps one job and one primary action.
 *
 * The plot gets the card. Once a run is on screen the plan folds into a
 * one-line summary in the toolbar, the run's caption rides the chip row, and
 * the per-box table stays closed until asked for: a box is read, and adopted,
 * by picking it on the plot. On a laptop-sized card the track used to get
 * ~50 px of height under all of that.
 */

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  boxcarStepIndex,
  type BoxcarDirection,
  type BoxcarDirectionChoice,
  type BoxcarPlan,
  type BoxcarRun,
  type BoxcarSeries,
} from "@/core/workflow/pdfBoxcar";

// The run/plan data types live in the core (a project file carries them); the
// panel's callers always imported them from here.
export type { BoxcarDirectionChoice, BoxcarPlan, BoxcarRun, BoxcarSeries };
import { color, fz, mono, primaryButton, secondaryButton } from "@/app/theme";
import {
  TRACK_PAD,
  TRACK_X_INSET,
  boxSpacingPx,
  fmtTick,
  monoLabelFits,
  pickReachPx,
  positiveTicks,
  rwSlotPx,
  tickValues,
  trackLayout,
} from "@/app/ui/boxcarLayout";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { SegmentedToggle } from "@/app/ui/SegmentedToggle";
import { clientToSvgUser, nearestPointIndex } from "@/visualization/hitTest";
import { linearScale } from "@/visualization/scale";

/** {@link boxcarStepIndex} bound to a series (see there for the ordering rule). */
export function stepIndexFor(series: BoxcarSeries, windowIndex: number, total: number): number {
  return boxcarStepIndex(series.direction, windowIndex, total, series.result.steps.length);
}

/** What the current plan resolves to against the page's fit window. */
export interface BoxcarPlanInfo {
  /** Boxes the settings fit inside the window. */
  readonly count: number;
  /** Why the plan cannot run, as user-facing prose (null when it can). */
  readonly issue: string | null;
  /** The r window being scanned (the page's fit range). */
  readonly range: { readonly min: number; readonly max: number };
  /** Where the last box's right edge lands, or null for an unusable plan. */
  readonly scannedMax: number | null;
}

export interface BoxcarPanelProps {
  readonly run: BoxcarRun | null;
  readonly busy: boolean;
  /** Boxes completed / planned, while a scan runs. */
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  /** Why the panel cannot start a scan right now (disables Run, shown as prose). */
  readonly blockedReason: string | null;
  readonly plan: BoxcarPlan;
  readonly planInfo: BoxcarPlanInfo;
  readonly onPlanChange: (patch: Partial<BoxcarPlan>) => void;
  /** Parameter labels by id (falls back to the id). */
  readonly labels: ReadonlyMap<string, string>;
  /** Download the series as CSV. */
  readonly onExportCsv: () => void;
  /** Adopt one box's refined values into the parameter panel (by series and
   *  ascending window index — a compared run has two candidates per box). */
  readonly onAdoptStep: (seriesIndex: number, windowIndex: number) => void;
}

/** Series ink: the two passes read like the two curves on the fit plot. */
const SERIES_INK: Record<BoxcarDirection, string> = { up: color.calc, down: color.obs };
const DIRECTION_LABEL: Record<BoxcarDirection, string> = { up: "low → high r", down: "high → low r" };
/** The plan's direction choice, as the folded plan summary words it. */
const PLAN_DIRECTION_LABEL: Record<BoxcarDirectionChoice, string> = { up: "low → high r", down: "high → low r", both: "both directions" };

/** Fallback drawing box before the container has been measured. */
const FALLBACK = { width: 620, height: 300 };

/** The element's live content box — the plot draws to these exact numbers, so
 *  it fills whatever the flex layout gives it instead of letterboxing inside a
 *  fixed aspect ratio (the card's height is viewport-dependent). */
function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(FALLBACK);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box) return;
      setSize({ width: Math.max(240, box.width), height: Math.max(160, box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** The plan against the fit window, in full: the open plan bar's line, and the
 *  folded summary's tooltip. */
function planDetail(plan: BoxcarPlan, info: BoxcarPlanInfo): string {
  if (info.issue) return info.issue;
  return (
    `${info.count} box${info.count === 1 ? "" : "es"} · ` +
    `${info.range.min.toFixed(2)}–${(info.scannedMax ?? info.range.max).toFixed(2)} Å` +
    (info.scannedMax !== null && info.scannedMax < info.range.max - 1e-6
      ? ` (last ${(info.range.max - info.scannedMax).toFixed(2)} Å of the fit window has no room for a full box)`
      : "") +
    // step > width samples the span rather than covering it — say so,
    // or the r span above reads as continuous coverage.
    (plan.step > plan.width ? ` · ${(plan.step - plan.width).toFixed(2)} Å gaps between boxes` : "") +
    (plan.direction === "both" || plan.randomStart
      ? ` · ${info.count * (plan.randomStart ? plan.restarts + 1 : 1) * (plan.direction === "both" ? 2 : 1)} fits total`
      : "")
  );
}

/** The plan in one line, for the toolbar once a run is on screen. */
function planSummary(plan: BoxcarPlan, info: BoxcarPlanInfo): string {
  return (
    `${plan.width} Å box · ${plan.step} Å step · ${PLAN_DIRECTION_LABEL[plan.direction]} · ` +
    `${info.count} box${info.count === 1 ? "" : "es"}` +
    (plan.randomStart ? ` · ${plan.restarts} restart${plan.restarts === 1 ? "" : "s"}` : "")
  );
}

export function BoxcarPanel({
  run, busy, progress, onRun, onCancel, blockedReason, plan, planInfo, onPlanChange, labels, onExportCsv, onAdoptStep,
}: BoxcarPanelProps): JSX.Element {
  // Parameters worth a chip: free during the run (fixed rows are flat lines by
  // construction) and carrying a value in at least one box of some pass.
  const trackIds = useMemo(() => {
    if (!run) return [];
    const freeSet = new Set(run.freeIds);
    const ids: string[] = [];
    for (const e of run.series[0]?.result.evolution ?? []) {
      if (!freeSet.has(e.parameterId)) continue;
      const anyValue = run.series.some((s) =>
        s.result.evolution.find((x) => x.parameterId === e.parameterId)?.values.some((v) => v !== undefined && Number.isFinite(v)),
      );
      if (anyValue) ids.push(e.parameterId);
    }
    return ids;
  }, [run]);

  const [shownId, setShownId] = useState<string | null>(null);
  // A new scan (or a different free set) invalidates the selection; default to
  // the first track so the tab is never an empty frame after a run.
  useEffect(() => {
    setShownId((prev) => (prev && trackIds.includes(prev) ? prev : trackIds[0] ?? null));
  }, [trackIds]);

  // The plan bar is the first thing to set before a scan and a detail after
  // one: with a run on screen it folds into the toolbar's summary, and every
  // new scan folds it again (starting a scan clears the run on screen). A plan
  // that cannot run stays open — it is what the user has to fix.
  const hasRun = run !== null;
  const [planOpen, setPlanOpen] = useState(false);
  useEffect(() => {
    if (!hasRun) setPlanOpen(false);
  }, [hasRun]);
  const showPlan = !hasRun || planOpen || planInfo.issue !== null;

  // The per-box table is the numbers behind the plot, not the reading.
  const [tableOpen, setTableOpen] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // The box picked on the plot (ascending window index): read under the plot,
  // highlighted in the table, adoptable from either. A run's windows are one
  // list for its whole life, so a new list means a new scan's plan.
  const [selected, setSelected] = useState<number | null>(null);
  const windows = run?.windows;
  useEffect(() => {
    setSelected(null);
  }, [windows]);
  useEffect(() => {
    if (!tableOpen || selected === null) return;
    tableRef.current?.querySelector(`[data-wi="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [tableOpen, selected]);

  /**
   * The selected parameter, aligned onto the ascending window list: one row per
   * box per pass. This is where a "down" pass's reversed step order is undone,
   * so everything downstream — plot, table, CSV, the direction comparison —
   * reads left to right in r regardless of which way the fit walked.
   */
  const aligned = useMemo(() => {
    if (!run || shownId === null) return null;
    const total = run.windows.length;
    const passes = run.series.map((s) => {
      const evo = s.result.evolution.find((e) => e.parameterId === shownId);
      const cells = run.windows.map((w, wi) => {
        const si = stepIndexFor(s, wi, total);
        const step = si >= 0 ? s.result.steps[si] : undefined;
        if (!step || !evo) return null;
        const value = evo.values[si];
        const esd = evo.esd[si];
        return {
          center: w.center,
          min: w.min,
          max: w.max,
          windowIndex: wi,
          value: value !== undefined && Number.isFinite(value) ? value : null,
          esd: esd !== undefined && Number.isFinite(esd) ? esd : null,
          rw: step.result.agreement.rWeighted ?? null,
          status: step.result.status,
        };
      });
      return { direction: s.direction, cells };
    });
    return { total, passes };
  }, [run, shownId]);

  /**
   * The comparison the two-pass run exists for: how far apart the directions
   * land at each box, in units of their combined esd. Seeding forward is what
   * makes a boxcar path-dependent, so a track that reproduces from both ends is
   * a track you can believe; a large separation means the fit is following its
   * starting point, not the data.
   */
  const hysteresis = useMemo(() => {
    if (!aligned || aligned.passes.length < 2) return null;
    const [a, b] = aligned.passes;
    let worst: { center: number; sigma: number; delta: number } | null = null;
    let compared = 0;
    for (let i = 0; i < aligned.total; i++) {
      const x = a!.cells[i];
      const y = b!.cells[i];
      if (!x || !y || x.value === null || y.value === null) continue;
      compared++;
      const delta = Math.abs(x.value - y.value);
      // Combined esd of the two independent fits; fall back to whichever exists
      // so a box with one missing esd still contributes its raw separation.
      const ex = x.esd ?? 0;
      const ey = y.esd ?? 0;
      const sigma = Math.hypot(ex, ey);
      const ratio = sigma > 0 ? delta / sigma : Infinity;
      if (!worst || ratio > (worst.sigma > 0 ? worst.delta / worst.sigma : Infinity)) {
        worst = { center: x.center, sigma, delta };
      }
    }
    if (!worst || compared === 0) return null;
    const ratio = worst.sigma > 0 ? worst.delta / worst.sigma : Infinity;
    return { compared, worst, ratio };
  }, [aligned]);

  const shownLabel = shownId !== null ? labels.get(shownId) ?? shownId : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 6, flexWrap: "wrap" }}>
        <button
          style={{ ...primaryButton, opacity: busy || blockedReason !== null ? 0.55 : 1 }}
          disabled={busy || blockedReason !== null}
          onClick={onRun}
          title={
            blockedReason ??
            `Slide the box across the fit window and refine the free parameters inside each position (${planInfo.count} boxes), each box seeded from the previous one.`
          }
        >
          {busy ? <span className="wb-shimmer-text">Scanning…</span> : "Run boxcar scan"}
        </button>
        {busy && (
          <button style={secondaryButton} onClick={onCancel} title="Abort the scan — the boxes already fitted are kept">
            Cancel
          </button>
        )}
        {progress && busy ? (
          <span style={{ fontFamily: mono, fontSize: fz.small, color: color.secondary }}>
            box {progress.done}/{progress.total}
          </span>
        ) : null}
        {/* The plan, folded: what the NEXT scan will do. The run on screen
            carries its own settings (its caption is in the chip row below). */}
        {hasRun && planInfo.issue === null && (
          <button
            style={{ ...planToggle, ...(showPlan ? planToggleOpen : {}) }}
            onClick={() => setPlanOpen((o) => !o)}
            aria-expanded={showPlan}
            title={`Next scan: ${planDetail(plan, planInfo)}. Click to ${showPlan ? "fold the plan away" : "edit the plan"} — the run on screen keeps its own settings.`}
          >
            <span style={{ color: color.faint }}>plan</span>
            {planSummary(plan, planInfo)}
            <span aria-hidden style={{ color: color.faint }}>{showPlan ? "▴" : "▾"}</span>
          </button>
        )}
        {run && !busy ? (
          <button style={secondaryButton} onClick={onExportCsv} title="Download every parameter's value and esd against the box center as CSV">
            Export CSV
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <InfoBadge
          width={340}
          align="right"
          text={
            <span>
              A <b>boxcar</b> scan refines the same model inside a fixed-width r-window
              slid across G(r), and plots each parameter at its box <b>center</b>. A track
              that drifts means the structure the PDF sees changes with length scale — the
              local structure at low r differing from the average (Bragg) one at high r;
              a flat track means one model describes every length scale.
              <br />
              <br />
              Read a value only where its box fitted well (the Rw strip) and where the
              drift is large compared with the esds. Those esds come from uniform weights
              over G(r), so compare them with each other rather than as absolute
              uncertainties — and they grow as the box shrinks, because a narrow box holds
              fewer points.
              <br />
              <br />
              Each box is seeded from the previous one, which makes the series
              path-dependent: <b>random restarts</b> re-search each box around its seed,
              and scanning <b>both</b> directions checks the same thing from the other
              end. Click a box on the plot (or step with ← →) to read it under the plot;
              <b> Adopt</b> loads its values into the parameter panel. The <b>box table</b>{" "}
              lists every box.
            </span>
          }
        />
      </div>

      {/* The plan. Editing it never disturbs a run already on screen — the run
          carries its own settings — so a user can compare a finished scan
          against the next one's plan before spending the time. */}
      {showPlan && (
        <div style={planBar}>
          <label style={fieldLabel} title="Width of the fitting box in Å. Every box has exactly this width, so the values are comparable across the scan. Too narrow and the box holds too few G(r) points to determine the free parameters.">
            box
            <NumberField value={plan.width} min={0.1} disabled={busy} onCommit={(width) => onPlanChange({ width })} />
            Å
          </label>
          <label style={fieldLabel} title="How far the box advances between fits, in Å. Half the box width gives overlapping boxes — a smoother track at twice the cost.">
            step
            <NumberField value={plan.step} min={0.05} disabled={busy} onCommit={(step) => onPlanChange({ step })} />
            Å
          </label>
          <SegmentedToggle
            options={[
              { id: "up", label: "low → high r", title: "Start at the smallest r and walk outward — each box seeded from the one before, so the local structure is carried into the average one" },
              { id: "down", label: "high → low r", title: "Start at the largest r and walk inward — seeded from the average structure, the usual way to test whether the local structure departs from it" },
              { id: "both", label: "both", title: "Scan the same boxes BOTH ways from the same starting model and plot the two tracks together. Where they agree, the drift is in the data; where they separate, the fit is following its seed rather than the G(r) — the boxcar's characteristic failure. Costs two passes." },
            ] as const}
            value={plan.direction}
            onChange={(direction) => { if (!busy) onPlanChange({ direction }); }}
          />
          <label
            style={{ ...fieldLabel, cursor: busy ? "default" : "pointer" }}
            title="Random restarts per box: on top of the seed carried from the previous box, refine this many randomly perturbed starts and keep the lowest-χ² one. Use it when a track looks like it inherited a bad box — seeding forward makes the series path-dependent, and a box that fell into a local minimum hands it to every box after it. Costs (restarts + 1)× the scan time."
          >
            <input
              type="checkbox"
              checked={plan.randomStart}
              disabled={busy}
              onChange={(e) => onPlanChange({ randomStart: e.target.checked })}
              style={{ accentColor: color.primary }}
            />
            random restarts
            {plan.randomStart && (
              <NumberField
                value={plan.restarts}
                min={1}
                max={20}
                integer
                width={44}
                disabled={busy}
                onCommit={(restarts) => onPlanChange({ restarts })}
              />
            )}
            {plan.randomStart ? "per box" : ""}
          </label>
          <span style={{ fontFamily: mono, fontSize: fz.micro, color: planInfo.issue ? color.warnInk : color.secondary }}>
            {planDetail(plan, planInfo)}
          </span>
        </div>
      )}

      {blockedReason && !busy ? (
        <div style={{ fontSize: fz.small, color: color.warnInk }}>⚠ {blockedReason}</div>
      ) : null}

      {run ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, rowGap: 5, flexWrap: "wrap" }}>
            {trackIds.map((id) => (
              <button
                key={id}
                onClick={() => setShownId(id)}
                style={{ ...chip, ...(id === shownId ? chipActive : {}) }}
                title={`Plot ${labels.get(id) ?? id} against the box center`}
              >
                {labels.get(id) ?? id}
              </button>
            ))}
            {trackIds.length === 0 && (
              <span style={{ fontSize: fz.small, color: color.secondary }}>
                No free parameter produced a value — free some rows in the parameter panel and scan again.
              </span>
            )}
            {/* What produced these numbers, in one line, beside the legend.
                Everything a reader has to be TOLD rather than reminded of —
                what a boxcar shows, how to read the esds, what Adopt does —
                lives in the "?" above, so this stays a caption. */}
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 12, rowGap: 4, flexWrap: "wrap", fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
              {run.series.length > 1 &&
                run.series.map((s) => (
                  <span key={s.direction} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 14, height: 2, background: SERIES_INK[s.direction], display: "inline-block" }} />
                    {DIRECTION_LABEL[s.direction]}
                  </span>
                ))}
              <span>
                {busy ? (
                  <b style={{ color: color.primary }}>scanning · </b>
                ) : run.partial ? (
                  <b style={{ color: color.noteInk }}>stopped early · </b>
                ) : null}
                {run.windows.length} boxes · {run.width} Å ·{" "}
                {run.series.length > 1 ? "both directions" : DIRECTION_LABEL[run.series[0]?.direction ?? "up"]}
                {run.restarts > 0 ? ` · best of ${run.restarts + 1} starts per box` : " · seeded, no restarts"}
              </span>
            </span>
          </div>

          {/* The verdict of a two-pass run, stated rather than left to the eye:
              agreement means the drift is in the data, separation means the fit
              is following its seed. */}
          {hysteresis && (
            <div
              style={{
                ...verdictBar,
                border: `1px solid ${hysteresis.ratio <= 2 ? color.okBorder : color.noteBorder}`,
                background: hysteresis.ratio <= 2 ? color.okBg : color.noteBg,
                color: hysteresis.ratio <= 2 ? color.okInk : color.noteInk,
              }}
            >
              <b>
                {hysteresis.ratio <= 2
                  ? "The two directions agree"
                  : "The two directions disagree — this track is path-dependent"}
              </b>
              <span style={{ fontFamily: mono }}>
                worst gap {Number.isFinite(hysteresis.ratio) ? `${hysteresis.ratio.toFixed(1)}σ` : "—"}
                {" ("}
                {hysteresis.worst.delta.toPrecision(3)}
                {hysteresis.worst.sigma > 0 ? ` vs esd ${hysteresis.worst.sigma.toPrecision(2)}` : " (no esd)"}
                {`) at r = ${hysteresis.worst.center.toFixed(2)} Å · ${hysteresis.compared} boxes compared`}
              </span>
            </div>
          )}

          {/* The plot is the headline and takes the region; the picked box's
              line sits under it, and the table — its numbers — only takes a
              share once opened. */}
          {aligned && shownId !== null && (
            <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ flex: tableOpen ? "3 1 0" : "1 1 0", minHeight: 160 }}>
                <TrackPlot passes={aligned.passes} label={shownLabel} selected={selected} onSelect={setSelected} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 4, flexWrap: "wrap", flex: "0 0 auto" }}>
                <button
                  style={disclosureBtn}
                  onClick={() => setTableOpen((o) => !o)}
                  aria-expanded={tableOpen}
                  title={tableOpen ? "Hide the per-box table" : "List every box: its window, Rw and value, with Adopt"}
                >
                  {tableOpen ? "▾" : "▸"} box table
                </button>
                <BoxReadout
                  passes={aligned.passes}
                  selected={selected}
                  label={shownLabel}
                  busy={busy}
                  onAdopt={onAdoptStep}
                  onClear={() => setSelected(null)}
                />
              </div>
              {tableOpen && (
                <div ref={tableRef} style={{ flex: "2 1 0", minHeight: 74, overflow: "auto" }}>
                  <StepTable
                    run={run}
                    aligned={aligned}
                    shownId={shownId}
                    labels={labels}
                    onAdoptStep={onAdoptStep}
                    busy={busy}
                    selected={selected}
                    onSelect={setSelected}
                  />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ color: color.secondary, fontSize: fz.small, lineHeight: 1.55 }}>
          Set the box above, free the parameters you want tracked in the refinement panel, then run the scan.
          Keep the cell and an ADP free, and hold Qdamp/Qbroad at their calibrated values — they are properties
          of the diffractometer, not of r, so letting them float per box turns real drift into scatter.
          The scanned span is the fit window, set with the plot handles on the Refinement tab.
        </div>
      )}
    </div>
  );
}

/** One box's fit of the shown parameter, aligned onto the ascending plan. */
interface AlignedCell {
  readonly center: number;
  readonly min: number;
  readonly max: number;
  readonly windowIndex: number;
  readonly value: number | null;
  readonly esd: number | null;
  readonly rw: number | null;
  readonly status: string;
}
interface AlignedPass {
  readonly direction: BoxcarDirection;
  readonly cells: readonly (AlignedCell | null)[];
}

/** A fit the refinement gave up on — its value is drawn, but flagged. */
function isBadFit(status: string): boolean {
  return status === "diverged" || status === "failed";
}

/** Separation of the two directions at one box, in units of their combined
 *  esd (∞ when neither has an esd), or null when either has no value. */
function gapSigma(a: AlignedCell | null, b: AlignedCell | null): number | null {
  if (!a || !b || a.value === null || b.value === null) return null;
  const sigma = Math.hypot(a.esd ?? 0, b.esd ?? 0);
  const delta = Math.abs(a.value - b.value);
  return sigma > 0 ? delta / sigma : Infinity;
}

function fmtSigma(ratio: number): string {
  return Number.isFinite(ratio) ? `${ratio.toFixed(1)}σ` : "∞";
}

/**
 * Value vs box center for every pass, over a shared Rw strip and ONE r axis.
 * Both passes are drawn on one pair of axes — the whole point of a
 * two-direction run is reading their separation, which a side-by-side pair of
 * plots would hide.
 *
 * Picking is by nearest box center along r, over the whole plot height: a 3 px
 * dot is no target, and the Rw bar under it is the same box.
 */
function TrackPlot({ passes, label, selected, onSelect }: {
  passes: readonly AlignedPass[];
  label: string;
  selected: number | null;
  onSelect: (windowIndex: number | null) => void;
}): JSX.Element {
  const drawn = useMemo(
    () =>
      passes.map((p) => ({
        direction: p.direction,
        // Ascending in r whichever way the fit walked: the reader compares
        // length scales, not scan order.
        pts: p.cells.filter((c): c is AlignedCell => c !== null && c.value !== null),
      })),
    [passes],
  );
  // One entry per box any pass reached, ascending in r: the pick targets.
  const boxes = useMemo(() => {
    const out: AlignedCell[] = [];
    const n = Math.max(0, ...passes.map((p) => p.cells.length));
    for (let wi = 0; wi < n; wi++) {
      const c = passes.map((p) => p.cells[wi] ?? null).find((x) => x !== null);
      if (c) out.push(c);
    }
    return out;
  }, [passes]);

  const [boxRef, { width: W, height: H }] = useElementSize<HTMLElement>();
  /** The box under the pointer, with the pointer's offset in the figure. */
  const [hover, setHover] = useState<{ wi: number; x: number; y: number } | null>(null);

  const all = drawn.flatMap((d) => d.pts);
  // The figure is always mounted, so the size observer stays attached when a
  // track gains its first value (a scan whose first box diverged).
  const figureStyle: CSSProperties = { margin: 0, height: "100%", minHeight: 0, position: "relative" };
  // Every box failed to produce this value (all diverged, or the parameter was
  // fixed after all): there is no track to scale an axis to.
  if (all.length === 0) {
    return (
      <figure ref={boxRef} style={{ ...figureStyle, display: "grid", placeItems: "center", color: color.secondary, fontSize: fz.small }}>
        No box produced a value for {label}.
      </figure>
    );
  }

  const layout = trackLayout(W, H);
  const plotL = TRACK_PAD.left;
  const plotR = W - TRACK_PAD.right;
  const xMin = Math.min(...boxes.map((c) => c.center));
  const xMax = Math.max(...boxes.map((c) => c.center));
  const yLo = Math.min(...all.map((p) => p.value! - (p.esd ?? 0)));
  const yHi = Math.max(...all.map((p) => p.value! + (p.esd ?? 0)));
  const padY = (yHi - yLo || Math.abs(yHi) || 1) * 0.12;
  const sx = linearScale(xMin, xMax, plotL + TRACK_X_INSET, plotR - TRACK_X_INSET);
  const sy = linearScale(yLo - padY, yHi + padY, layout.valueBottom, layout.valueTop);
  // Rw of every box fitted, valued or not: the strip is about the fits.
  const rwAll = passes.flatMap((p) => p.cells.flatMap((c) => (c && c.rw !== null ? [c.rw] : [])));
  const rwMax = Math.max(0.001, ...rwAll);
  const sRw = linearScale(0, rwMax, layout.rwBottom, layout.rwTop + 4);
  const xs = boxes.map((c) => sx(c.center));
  const spacing = boxSpacingPx(xs);
  // Two passes fit the same boxes, so their Rw bars would overprint at
  // identical r — each takes half the box's slot.
  const slot = rwSlotPx(spacing);
  const barW = passes.length > 1 ? slot / 2 : slot;
  const barOffset = (i: number): number => (passes.length > 1 ? (i === 0 ? -barW : 0) : -barW / 2);

  const xTicks = tickValues(xMin, xMax, layout.xTicks);
  const yTicks = tickValues(yLo - padY, yHi + padY, layout.yTicks);
  const rwTicks = positiveTicks(rwMax * 100, layout.rwTicks);

  const clampX = (x: number): number => Math.min(plotR, Math.max(plotL, x));
  /** A box's r-window, shaded across both panels: the span its point summarizes. */
  const band = (wi: number | null): { x0: number; x1: number; cx: number } | null => {
    const c = wi === null ? undefined : boxes.find((b) => b.windowIndex === wi);
    return c ? { x0: clampX(sx(c.min)), x1: clampX(sx(c.max)), cx: sx(c.center) } : null;
  };
  const hoverBand = hover && hover.wi !== selected ? band(hover.wi) : null;
  const selectedBand = band(selected);
  const hot = (wi: number): boolean => wi === selected || wi === hover?.wi;

  const pickAt = (e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): { wi: number; x: number; y: number } | null => {
    const p = clientToSvgUser(e.currentTarget, e.clientX, e.clientY, { width: W, height: H });
    if (!(p.y >= layout.valueTop - 6 && p.y <= layout.xTickY)) return null;
    const i = nearestPointIndex(xs.map((x) => ({ x, y: 0 })), p.x, 0, pickReachPx(spacing));
    if (i < 0) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    return { wi: boxes[i]!.windowIndex, x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape" && selected !== null) {
      onSelect(null);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const order = boxes.map((c) => c.windowIndex);
    const at = selected === null ? -1 : order.indexOf(selected);
    const next =
      e.key === "ArrowRight"
        ? at < 0 ? 0 : Math.min(order.length - 1, at + 1)
        : at < 0 ? order.length - 1 : Math.max(0, at - 1);
    onSelect(order[next] ?? null);
  };

  const valueMid = (layout.valueTop + layout.valueBottom) / 2;
  // A long label centred on a short panel would run into the Rw strip: pin it
  // to the panel's top instead.
  const labelCentred = monoLabelFits(label, 10.5, layout.valueBottom - layout.valueTop);
  const labelY = labelCentred ? valueMid : layout.valueTop;
  const rwMid = (layout.rwTop + layout.rwBottom) / 2;
  const compare = passes.length > 1;

  return (
    <figure
      ref={boxRef}
      style={figureStyle}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`${label} against box center r — click a box, or use the arrow keys, to read it`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", cursor: hover ? "pointer" : "default" }}
        role="img"
        aria-label={`${label} against box center r${compare ? ", scanned in both directions" : ""}`}
        onPointerMove={(e) => setHover(pickAt(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const hit = pickAt(e);
          if (hit) onSelect(hit.wi === selected ? null : hit.wi);
        }}
      >
        {hoverBand && (
          <rect x={hoverBand.x0} width={hoverBand.x1 - hoverBand.x0} y={layout.valueTop} height={layout.rwBottom - layout.valueTop} fill={color.primaryTintBg} opacity={0.45} />
        )}
        {selectedBand && (
          <rect x={selectedBand.x0} width={selectedBand.x1 - selectedBand.x0} y={layout.valueTop} height={layout.rwBottom - layout.valueTop} fill={color.primaryTintBg} opacity={0.9} />
        )}

        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={plotL} x2={plotR} y1={sy(t)} y2={sy(t)} stroke={color.subtle2} strokeWidth={1} />
            <text x={plotL - 6} y={sy(t) + 3.5} textAnchor="end" fontSize={10} fontFamily={mono} fill={color.faint}>
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {/* r gridlines run through BOTH panels, so a point lines up with its
            Rw bar; the r labels are drawn once, under the strip. */}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={layout.valueTop} y2={layout.valueBottom} stroke={color.subtle2} strokeWidth={1} />
            <line x1={sx(t)} x2={sx(t)} y1={layout.rwTop} y2={layout.rwBottom} stroke={color.subtle2} strokeWidth={1} />
            <text x={sx(t)} y={layout.xTickY} textAnchor="middle" fontSize={10} fontFamily={mono} fill={color.faint}>
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {rwTicks.map((t) => (
          <g key={`rw${t}`}>
            <line x1={plotL} x2={plotR} y1={sRw(t / 100)} y2={sRw(t / 100)} stroke={color.subtle2} strokeWidth={1} />
            <text x={plotL - 6} y={sRw(t / 100) + 3.5} textAnchor="end" fontSize={10} fontFamily={mono} fill={color.faint}>
              {fmtTick(t)}%
            </text>
          </g>
        ))}
        {selectedBand && (
          <line x1={selectedBand.cx} x2={selectedBand.cx} y1={layout.valueTop} y2={layout.rwBottom} stroke={color.primaryTintBorder} strokeWidth={1} />
        )}
        {hoverBand && (
          <line x1={hoverBand.cx} x2={hoverBand.cx} y1={layout.valueTop} y2={layout.rwBottom} stroke={color.faintest} strokeWidth={1} strokeDasharray="3 3" />
        )}

        <line x1={plotL} x2={plotR} y1={layout.valueBottom} y2={layout.valueBottom} stroke={color.border} />
        <line x1={plotL} x2={plotL} y1={layout.valueTop} y2={layout.valueBottom} stroke={color.border} />

        {drawn.map(({ direction, pts }) => {
          const ink = SERIES_INK[direction];
          return (
            <g key={direction}>
              {pts.length > 1 && (
                <polyline
                  points={pts.map((p) => `${sx(p.center).toFixed(2)},${sy(p.value!).toFixed(2)}`).join(" ")}
                  fill="none"
                  stroke={ink}
                  strokeWidth={1.6}
                  // The second pass is dashed as well as coloured: where the two
                  // agree they overlap exactly, and one line would simply hide
                  // the other on a monochrome print.
                  {...(direction === "down" ? { strokeDasharray: "5 3" } : {})}
                />
              )}
              {pts.map((p) => (
                <g key={`${direction}-${p.windowIndex}`}>
                  {p.esd !== null && p.esd > 0 && (
                    <>
                      <line x1={sx(p.center)} x2={sx(p.center)} y1={sy(p.value! - p.esd)} y2={sy(p.value! + p.esd)} stroke={ink} strokeWidth={1} opacity={0.55} />
                      <line x1={sx(p.center) - 3} x2={sx(p.center) + 3} y1={sy(p.value! + p.esd)} y2={sy(p.value! + p.esd)} stroke={ink} strokeWidth={1} opacity={0.55} />
                      <line x1={sx(p.center) - 3} x2={sx(p.center) + 3} y1={sy(p.value! - p.esd)} y2={sy(p.value! - p.esd)} stroke={ink} strokeWidth={1} opacity={0.55} />
                    </>
                  )}
                  <circle
                    cx={sx(p.center)}
                    cy={sy(p.value!)}
                    r={p.windowIndex === selected ? 4.5 : p.windowIndex === hover?.wi ? 4 : 3}
                    fill={isBadFit(p.status) ? color.warnInk : ink}
                    {...(p.windowIndex === selected ? { stroke: "#fff", strokeWidth: 1.5 } : {})}
                    {...(direction === "down" ? { fillOpacity: 0.75 } : {})}
                  />
                </g>
              ))}
            </g>
          );
        })}

        {/* Rw context strip: a value from a badly-fitted box means nothing. */}
        <line x1={plotL} x2={plotR} y1={layout.rwBottom} y2={layout.rwBottom} stroke={color.border} />
        <line x1={plotL} x2={plotL} y1={layout.rwTop} y2={layout.rwBottom} stroke={color.border} />
        {passes.map((pass, pi) =>
          pass.cells.map((c) => {
            if (!c || c.rw === null) return null;
            return (
              <rect
                key={`${pass.direction}-${c.windowIndex}`}
                x={sx(c.center) + barOffset(pi)}
                y={sRw(c.rw)}
                width={barW}
                height={Math.max(1, layout.rwBottom - sRw(c.rw))}
                fill={isBadFit(c.status) ? color.warnInk : SERIES_INK[pass.direction]}
                opacity={hot(c.windowIndex) ? 0.95 : 0.55}
              />
            );
          }),
        )}

        <text x={14} y={labelY} fontSize={10.5} fontFamily={mono} fill={color.secondary} transform={`rotate(-90 14 ${labelY})`} textAnchor={labelCentred ? "middle" : "end"}>
          {label}
        </text>
        <text x={14} y={rwMid} fontSize={10.5} fontFamily={mono} fill={color.secondary} transform={`rotate(-90 14 ${rwMid})`} textAnchor="middle">
          Rw
        </text>
        <text x={(plotL + plotR) / 2} y={layout.xTitleY} textAnchor="middle" fontSize={10.5} fontFamily={mono} fill={color.secondary}>
          box center r (Å)
        </text>
      </svg>

      {hover && (() => {
        const cells = passes.map((p) => p.cells[hover.wi] ?? null);
        const any = cells.find((c) => c !== null);
        if (!any) return null;
        // Picking reads r only, so the pointer is free to sit anywhere above
        // or below the box's point: the card opens on the pointer's side AWAY
        // from that point (never over the value being read), flipped when the
        // figure has no room there, and left of the pointer on the right half.
        const valued = cells.find((c) => c !== null && c.value !== null);
        const pointY = valued ? sy(valued.value!) : valueMid;
        const room = 72;
        const above = hover.y < pointY ? hover.y > room : H - hover.y < room;
        const place: CSSProperties = {
          ...(hover.x > W * 0.55 ? { right: W - hover.x + 14 } : { left: hover.x + 14 }),
          ...(above ? { bottom: H - hover.y + 14 } : { top: hover.y + 14 }),
          maxWidth: Math.max(160, W - 24),
        };
        return (
          <div style={{ ...tooltip, ...place }} aria-hidden>
            <div>
              <b style={{ color: color.ink }}>r = {any.center.toFixed(2)} Å</b>
              <span style={{ color: color.faint }}> · box {any.min.toFixed(2)}–{any.max.toFixed(2)} Å</span>
            </div>
            {cells.map((c, ci) =>
              c === null ? null : (
                <div key={ci} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {compare && <span style={{ width: 12, height: 2, background: SERIES_INK[passes[ci]!.direction], display: "inline-block" }} />}
                  <span>
                    {label} <span style={{ color: color.ink }}>{c.value !== null ? c.value.toPrecision(6) : "—"}</span>
                    {c.esd ? ` ± ${c.esd.toPrecision(2)}` : ""}
                  </span>
                  <span>· Rw {c.rw !== null ? `${(100 * c.rw).toFixed(2)}%` : "—"}</span>
                  {c.status !== "converged" && <span style={{ color: isBadFit(c.status) ? color.warnInk : color.noteInk }}>· {c.status}</span>}
                </div>
              ),
            )}
            {hover.wi !== selected && <div style={{ color: color.faint }}>click to pick this box</div>}
          </div>
        );
      })()}
    </figure>
  );
}

/**
 * The picked box, in one line under the plot: its window, the shown value of
 * each pass with its esd and Rw, and Adopt — so reading a box and loading it
 * never needs the table.
 */
function BoxReadout({ passes, selected, label, busy, onAdopt, onClear }: {
  passes: readonly AlignedPass[];
  selected: number | null;
  label: string;
  busy: boolean;
  onAdopt: (seriesIndex: number, windowIndex: number) => void;
  onClear: () => void;
}): JSX.Element {
  const cells = selected === null ? [] : passes.map((p) => p.cells[selected] ?? null);
  const any = cells.find((c) => c !== null);
  if (selected === null || !any) {
    return (
      <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.faint }}>
        Click a box on the plot to read it and adopt its values.
      </span>
    );
  }
  const compare = passes.length > 1;
  const ratio = compare ? gapSigma(cells[0] ?? null, cells[1] ?? null) : null;
  return (
    <span style={readout}>
      <b style={{ color: color.ink }}>r = {any.center.toFixed(2)} Å</b>
      <span>box {any.min.toFixed(2)}–{any.max.toFixed(2)}</span>
      <span>{label}</span>
      {cells.map((c, ci) => {
        if (c === null) return null;
        const direction = passes[ci]!.direction;
        return (
          <span key={ci} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {compare && <span style={{ width: 12, height: 2, background: SERIES_INK[direction], display: "inline-block" }} />}
            <span style={{ color: color.ink }}>
              {c.value !== null ? c.value.toPrecision(6) : "—"}
              {c.esd ? <span style={{ color: color.faint }}> ±{c.esd.toPrecision(2)}</span> : null}
            </span>
            <span style={{ color: isBadFit(c.status) ? color.warnInk : color.secondary }}>
              Rw {c.rw !== null ? `${(100 * c.rw).toFixed(2)}%` : "—"}
              {isBadFit(c.status) ? ` · ${c.status}` : ""}
            </span>
            <button
              style={{ ...adoptBtn, ...(busy ? { opacity: 0.5, cursor: "not-allowed" } : {}), ...(compare ? { color: SERIES_INK[direction] } : {}) }}
              disabled={busy}
              onClick={() => onAdopt(ci, selected)}
              title={
                compare
                  ? `Load this box's values from the ${DIRECTION_LABEL[direction]} pass into the parameter panel (the fit window is not changed)`
                  : "Load this box's refined values into the parameter panel (the fit window is not changed)"
              }
            >
              {compare ? (direction === "up" ? "Adopt ↑" : "Adopt ↓") : "Adopt"}
            </button>
          </span>
        );
      })}
      {ratio !== null && (
        <span
          style={{ color: ratio > 2 ? color.noteInk : color.secondary }}
          title="Separation between the two directions at this box, in units of their combined esd."
        >
          gap {fmtSigma(ratio)}
        </span>
      )}
      <button style={clearBtn} onClick={onClear} title="Clear the picked box (Esc on the plot)" aria-label="Clear the picked box">
        ✕
      </button>
    </span>
  );
}

function StepTable({ run, aligned, shownId, labels, onAdoptStep, busy, selected, onSelect }: {
  run: BoxcarRun;
  aligned: { total: number; passes: AlignedPass[] } | null;
  shownId: string | null;
  labels: ReadonlyMap<string, string>;
  onAdoptStep: (seriesIndex: number, windowIndex: number) => void;
  busy: boolean;
  selected: number | null;
  onSelect: (windowIndex: number | null) => void;
}): JSX.Element {
  const passes = aligned?.passes ?? [];
  const compare = passes.length > 1;
  const valueHead = shownId ? labels.get(shownId) ?? shownId : "value";
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: fz.micro }}>
        <thead>
          <tr style={{ color: color.secondary, textAlign: "left" }}>
            <th style={headCell}>box (Å)</th>
            <th style={headCell}>window</th>
            {passes.map((p) => (
              <th key={`h-${p.direction}`} colSpan={2} style={{ ...headCell, textAlign: "right", color: compare ? SERIES_INK[p.direction] : color.secondary }}>
                {compare ? DIRECTION_LABEL[p.direction] : ""} Rw · {valueHead}
              </th>
            ))}
            {compare && (
              <th style={{ ...headCell, textAlign: "right" }} title="Separation between the two directions at this box, in units of their combined esd. Small means the value is set by the data; large means it is set by where the fit started.">
                gap
              </th>
            )}
            <th style={headCell} />
          </tr>
        </thead>
        <tbody>
          {run.windows.map((w, wi) => {
            const cells = passes.map((p) => p.cells[wi] ?? null);
            if (cells.every((c) => c === null)) return null;
            const ratio = compare ? gapSigma(cells[0] ?? null, cells[1] ?? null) : null;
            return (
              <tr
                key={wi}
                data-wi={wi}
                onClick={() => onSelect(wi === selected ? null : wi)}
                style={{ borderTop: `1px solid ${color.subtle2}`, cursor: "pointer", ...(wi === selected ? { background: color.primaryTintBg } : {}) }}
                title="Pick this box on the plot"
              >
                <td style={cell}>{w.center.toFixed(2)}</td>
                <td style={{ ...cell, color: color.secondary }}>{w.min.toFixed(2)}–{w.max.toFixed(2)}</td>
                {cells.map((c, ci) => {
                  const bad = c && isBadFit(c.status);
                  return (
                    <Fragment key={`c-${ci}`}>
                      <td style={{ ...cell, textAlign: "right", color: bad ? color.warnInk : color.secondary }}>
                        {c?.rw !== null && c?.rw !== undefined ? `${(100 * c.rw).toFixed(2)}%` : "—"}
                      </td>
                      <td style={{ ...cell, textAlign: "right" }}>
                        {c?.value !== null && c?.value !== undefined ? c.value.toPrecision(6) : "—"}
                        {c?.esd ? <span style={{ color: color.faint }}> ±{c.esd.toPrecision(2)}</span> : null}
                      </td>
                    </Fragment>
                  );
                })}
                {compare && (
                  <td style={{ ...cell, textAlign: "right", color: ratio !== null && ratio > 2 ? color.noteInk : color.secondary }}>
                    {ratio === null ? "—" : fmtSigma(ratio)}
                  </td>
                )}
                <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
                  {cells.map((c, ci) =>
                    c === null ? null : (
                      <button
                        key={`a-${ci}`}
                        style={{ ...adoptBtn, ...(busy ? { opacity: 0.5, cursor: "not-allowed" } : {}), ...(compare ? { marginLeft: 3, color: SERIES_INK[passes[ci]!.direction] } : {}) }}
                        disabled={busy}
                        onClick={(e) => {
                          // Adopting is not a pick: the row's own click toggles it.
                          e.stopPropagation();
                          onAdoptStep(ci, wi);
                        }}
                        title={
                          compare
                            ? `Load this box's values from the ${DIRECTION_LABEL[passes[ci]!.direction]} pass into the parameter panel (the fit window is not changed)`
                            : "Load this box's refined values into the parameter panel (the fit window is not changed)"
                        }
                      >
                        {compare ? (passes[ci]!.direction === "up" ? "↑" : "↓") : "Adopt"}
                      </button>
                    ),
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Numeric field that keeps what the user is typing until they commit it (blur
 * or Enter) — the `ParamRow` convention. A plain controlled number input snaps
 * an emptied field back to 0 mid-edit, which here would also flip the plan to
 * "width must be positive" while someone is simply retyping a number.
 */
function NumberField({ value, min, max, integer = false, width = 56, disabled, onCommit }: {
  value: number;
  min: number;
  max?: number;
  integer?: boolean;
  width?: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}): JSX.Element {
  const [buf, setBuf] = useState<string | null>(null);
  const commit = (raw?: string): void => {
    const source = raw !== undefined ? raw : buf;
    setBuf(null);
    // An empty or unparsable entry reverts to the last good value rather than
    // silently committing the minimum — `Number("")` is 0, which would clamp
    // to the bound and quietly rewrite what the user was editing.
    if (source === null || source.trim() === "") return;
    const v = Number(source);
    if (!Number.isFinite(v)) return;
    onCommit(Math.min(max ?? Infinity, Math.max(min, integer ? Math.round(v) : v)));
  };
  return (
    <input
      type="number"
      min={min}
      {...(max !== undefined ? { max } : {})}
      step={integer ? 1 : 0.5}
      value={buf ?? String(value)}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setBuf(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit((e.target as HTMLInputElement).value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{ ...numberInput, width }}
    />
  );
}

/** The two-direction verdict, stated where the plot's reader will look first. */
const verdictBar: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 12,
  rowGap: 4,
  flexWrap: "wrap",
  padding: "6px 11px",
  borderRadius: 8,
  fontSize: fz.small,
};
const planBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  rowGap: 6,
  flexWrap: "wrap",
  padding: "7px 10px",
  borderRadius: 8,
  border: `1px solid ${color.border}`,
  background: color.muted2,
};
/** The folded plan: reads as the plan bar's surface, in one line. */
const planToggle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: `1px solid ${color.border}`,
  background: color.muted2,
  borderRadius: 8,
  padding: "6px 10px",
  fontFamily: mono,
  fontSize: fz.micro,
  color: color.secondary,
  cursor: "pointer",
};
const planToggleOpen: CSSProperties = {
  border: `1px solid ${color.control}`,
  color: color.ink,
};
const fieldLabel: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontFamily: mono,
  fontSize: fz.micro,
  color: color.secondary,
};
const numberInput: CSSProperties = {
  border: `1px solid ${color.input}`,
  borderRadius: 7,
  fontSize: 12,
  fontFamily: mono,
  padding: "2px 6px",
  background: "#fff",
};
const cell: CSSProperties = { padding: "3px 8px", fontWeight: 500 };
/** Header cells stay put while the table scrolls to a picked box. */
const headCell: CSSProperties = { ...cell, position: "sticky", top: 0, background: color.surface, zIndex: 1 };
const chip: CSSProperties = {
  border: `1px solid ${color.control}`,
  background: "#fff",
  borderRadius: 999,
  padding: "2px 11px",
  fontSize: fz.micro,
  fontFamily: mono,
  color: color.secondary,
  cursor: "pointer",
};
const chipActive: CSSProperties = {
  border: `1px solid ${color.primaryTintBorder}`,
  background: color.primaryTintBg,
  color: color.primary,
  fontWeight: 600,
};
const adoptBtn: CSSProperties = {
  border: `1px solid ${color.control}`,
  background: "#fff",
  borderRadius: 7,
  padding: "1px 9px",
  fontSize: fz.micro,
  fontFamily: mono,
  color: color.secondary,
  cursor: "pointer",
};
const disclosureBtn: CSSProperties = {
  border: "none",
  background: "none",
  padding: "1px 0",
  fontSize: fz.micro,
  fontFamily: mono,
  color: color.secondary,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const clearBtn: CSSProperties = {
  border: "none",
  background: "none",
  padding: "0 4px",
  fontSize: fz.micro,
  color: color.faint,
  cursor: "pointer",
};
const readout: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  rowGap: 4,
  flexWrap: "wrap",
  // A zero basis keeps the readout on the table toggle's line, wrapping
  // within itself, instead of dropping under it whole.
  flex: "1 1 0",
  minWidth: 0,
  fontFamily: mono,
  fontSize: fz.micro,
  color: color.secondary,
};
/** The hover card: HTML over the SVG, never in the pointer's way. */
const tooltip: CSSProperties = {
  position: "absolute",
  pointerEvents: "none",
  display: "grid",
  gap: 2,
  padding: "5px 9px",
  borderRadius: 8,
  border: `1px solid ${color.border}`,
  background: "rgba(255,253,249,0.96)",
  boxShadow: "0 2px 8px rgba(25,23,20,0.08)",
  fontFamily: mono,
  fontSize: fz.micro,
  color: color.secondary,
  zIndex: 1,
};
