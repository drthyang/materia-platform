/**
 * The powder page's "Can lines" (neutron data). The question it answers: is
 * an extra peak, one the refinement does not capture, a line of the vanadium
 * or aluminium can?
 *
 *  - A toggle beside the phase ticks draws the V and Al can lines at their
 *    relative strength and labels, on the difference curve, each extra peak
 *    that lines up with one ("Al 311").
 *  - The Validation view's card says it in one line: which extra peaks line
 *    up with a can line and which match none, each with "view →"; each can's
 *    d-scale under it (a one-click cooled value when the data file states the
 *    sample temperature); and, collapsed, the sample reflections the can's
 *    lines sit under.
 *
 * The extra peaks are the Validation view's own: diagnose_fit's
 * "unexplained-peak" excess (core/diagnostics/backgroundTerms.ts,
 * unexplainedExcess), read on the same page through pageFitDiagnosis, so the
 * card, the view's "What limits the fit" and the Copilot's diagnose_fit name
 * the same peaks. Nothing is fitted or excluded, and nothing here reaches the
 * Agent (core/diagnostics/canLines.ts holds the physics).
 */

import { Fragment, useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { SavedCanLines } from "@/core/project/types";
import type { PowderXUnit } from "@/core/diffraction/types";
import type { BackgroundExcess } from "@/core/diagnostics/backgroundTerms";
import {
  CAN_PHASES,
  canLineContext,
  canLines,
  canOverlaps,
  compactHkl,
  expansionScale,
  isNeutron,
  matchExtraPeaks,
  sampleReading,
  scaleShift,
  type CanLineContext,
  type CanLinePage,
  type CanPhaseLines,
  type ExtraPeakMatch,
  type SampleOverlap,
} from "@/core/diagnostics/canLines";
import { pageFitDiagnosis, type JudgedPage } from "@/app/powderJudgment";
import { statedTemperature, type TemperatureReading } from "@/parsers/statedTemperature";
import { CAN_COLORS, canPhaseTicks } from "@/visualization/canTicks";
import { convertAxisValue, type AxisContext } from "@/visualization/axisUnits";
import type { PhaseTicks } from "@/visualization/reflectionTicks";
import { color, fz, mono } from "@/app/theme";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { caption, linkButton, sectionStyle, tableStyle, td, th, useElementWidth } from "@/app/ui/ValidationParts";

export interface CanLinesPage extends CanLinePage {
  /** The page as the Validation view reads it (its extra peaks); null while it cannot be read. */
  readonly judged: JudgedPage | null;
  /** The data file's text, for the sample temperature it states. */
  readonly rawText?: string | null | undefined;
  /** The plot's display unit and axis, for the ticks and the labels. */
  readonly displayUnit: PowderXUnit;
  readonly axis: AxisContext;
  /** The lines are needed though the toggle is off: the Validation view is open. */
  readonly wanted: boolean;
}

/** A label on the difference curve: an extra peak that lines up with a can line. */
export interface CanDiffMark {
  /** Display-unit x. */
  readonly x: number;
  readonly label: string;
  readonly color: string;
  readonly d: number;
}

export interface CanLinesState {
  /** Neutron data: the feature applies. */
  readonly available: boolean;
  readonly on: boolean;
  readonly setOn: (on: boolean) => void;
  /** d-scale per can phase (library name), 1 when not set. */
  readonly scales: Readonly<Record<string, number>>;
  readonly setScale: (phase: string, scale: number) => void;
  readonly temperature: TemperatureReading;
  /** The page's model and profile the lines are placed with; null where no peak can be placed (no calibration). */
  readonly ctx: CanLineContext | null;
  readonly phases: readonly CanPhaseLines[];
  /** The extra peaks, each with the can line it lines up with; null where the page's extra peaks cannot be read. */
  readonly extra: readonly ExtraPeakMatch<BackgroundExcess>[] | null;
  /** The plot's can rows (empty while the toggle is off). */
  readonly ticks: readonly PhaseTicks[];
  /** The difference-curve labels (empty while the toggle is off). */
  readonly marks: readonly CanDiffMark[];
  /** The view as a project saves it. */
  readonly saved: SavedCanLines;
  /** Put the view back as a project (or a History step) holds it; absent: off, every scale 1. Stable. */
  readonly restore: (saved: SavedCanLines | undefined) => void;
}

/** The view a project holds, or the defaults (off, every scale 1) for one saved without it. */
export function canLinesFromSaved(saved: SavedCanLines | undefined): { readonly on: boolean; readonly scales: Readonly<Record<string, number>> } {
  return { on: saved?.on ?? false, scales: { ...(saved?.scales ?? {}) } };
}

const fmtScale = (s: number): string => s.toFixed(5);

/**
 * The page's extra peaks as the Validation view reads them: diagnose_fit's
 * unexplained excess (none found: an empty list). Null where it is not read:
 * no d-spacing, or no background curve to tell the background points.
 */
export function pageExtraPeaks(judged: JudgedPage): readonly BackgroundExcess[] | null {
  const dx = pageFitDiagnosis(judged);
  if (!dx || !judged.curves.yBackground || judged.curves.yBackground.length !== judged.curves.x.length) return null;
  return dx.diagnosis.unexplained ?? [];
}

export function useCanLines(page: CanLinesPage): CanLinesState {
  const available = isNeutron(page.pattern.radiation);
  const [on, setOn] = useState(false);
  const [scales, setScales] = useState<Readonly<Record<string, number>>>({});
  const temperature = useMemo(() => statedTemperature(page.rawText), [page.rawText]);
  const needed = available && (on || page.wanted);
  const { structure, extraPhases, pattern, parameters, bindings, profile, judged } = page;
  const ctx = useMemo<CanLineContext | null>(
    () => (needed ? canLineContext({ structure, extraPhases, pattern, parameters, bindings, profile }) : null),
    [needed, structure, extraPhases, pattern, parameters, bindings, profile],
  );
  const phases = useMemo(() => (ctx ? canLines(ctx, scales) : []), [ctx, scales]);
  // The Validation view's extra peaks (diagnose_fit's unexplained excess), read on the same page.
  const excess = useMemo(() => (needed && ctx && judged ? pageExtraPeaks(judged) : null), [needed, ctx, judged]);
  const extra = useMemo(() => (excess ? matchExtraPeaks(phases, excess) : null), [excess, phases]);
  const { displayUnit, axis } = page;
  const toDisplay = useCallback((x: number) => convertAxisValue(x, pattern.xUnit, displayUnit, axis), [pattern.xUnit, displayUnit, axis]);
  const ticks = useMemo(
    () => (on && phases.length > 0 ? canPhaseTicks(phases, (d) => convertAxisValue(d, "dSpacing", displayUnit, axis)) : []),
    [on, phases, displayUnit, axis],
  );
  const marks = useMemo<CanDiffMark[]>(
    () => (on && extra ? extra.flatMap((m) => (m.line ? [{ x: toDisplay(m.peak.x), d: m.peak.d, label: `${m.line.phase} ${compactHkl(m.line.hkl)}`, color: CAN_COLORS[m.line.phase] ?? color.secondary }] : [])) : []),
    [on, extra, toDisplay],
  );
  const restore = useCallback((saved: SavedCanLines | undefined) => {
    const v = canLinesFromSaved(saved);
    setOn(v.on);
    setScales(v.scales);
  }, []);
  const saved = useMemo<SavedCanLines>(() => ({ on, scales }), [on, scales]);
  return {
    available,
    saved,
    restore,
    on: available && on,
    setOn,
    scales,
    setScale: (phase, scale) => setScales((s) => ({ ...s, [phase]: scale })),
    temperature,
    ctx,
    phases,
    extra,
    ticks,
    marks,
  };
}

const CAN_INFO =
  "Is an extra peak, one the refinement does not capture, a line of the vanadium or aluminium can? With this on, the V and Al can lines join the phase ticks (each tick's solid part is the line's strength per volume of metal, so V's are drawn as weak as they are), and an extra peak that lines up with a can line is labelled on the difference curve. Validation lists them. Nothing is fitted or excluded.";

/** The toolbar toggle, beside the plot's phase ticks. Neutron data only. */
export function CanLinesToggle({ can }: { can: CanLinesState }): JSX.Element | null {
  if (!can.available) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: color.secondary, cursor: "pointer", whiteSpace: "nowrap" }}>
        <input type="checkbox" checked={can.on} onChange={(e) => can.setOn(e.target.checked)} />
        Can lines
      </label>
      <InfoBadge text={CAN_INFO} width={300} />
    </span>
  );
}

const pillBtn: CSSProperties = { border: `1px solid ${color.control}`, background: color.surface, borderRadius: 999, padding: "1px 8px", fontSize: 12, fontFamily: mono, color: color.ink, cursor: "pointer", whiteSpace: "nowrap" };

function signed(v: number, digits: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
}

/** One can's d-scale: the input, the shift it makes at the strongest line, and the cooled value when the file states a temperature. */
function ScaleControl({ can, phase }: { can: CanLinesState; phase: CanPhaseLines }): JSX.Element {
  const name = phase.can.phase;
  const scale = can.scales[name] ?? 1;
  const [draft, setDraft] = useState<string | null>(null);
  const stated = can.temperature.kind === "stated" ? can.temperature.temperature : null;
  const cooled = stated && phase.can.expansion ? expansionScale(phase.can.expansion, stated.kelvin) : null;
  const shift = can.ctx && scale !== 1 ? scaleShift(can.ctx, phase, scale) : null;
  const cooledShift = can.ctx && cooled !== null ? scaleShift(can.ctx, phase, cooled) : null;
  const commit = (text: string): void => {
    const v = Number(text);
    if (Number.isFinite(v) && v > 0.9 && v < 1.1) can.setScale(name, v);
    setDraft(null);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", rowGap: 4 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: CAN_COLORS[name] ?? color.faint }} />
        <span style={{ fontFamily: mono, fontSize: 12, color: color.ink }}>{name} d ×</span>
        <input
          aria-label={`${name} can d-scale`}
          value={draft ?? fmtScale(scale)}
          inputMode="decimal"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
          style={{ width: "10ch", fontFamily: mono, fontSize: 12, padding: "1px 4px", border: `1px solid ${color.input}`, borderRadius: 6, background: color.surface, color: color.ink }}
        />
      </span>
      {shift ? (
        <span style={{ fontFamily: mono, fontSize: 12, color: color.secondary }} title={`The ${name} ${compactHkl(shift.hkl)} line (its strongest here) moves this far from its room-temperature place, in FWHM of the profile there.`}>
          {compactHkl(shift.hkl)} {signed(shift.fwhm, 2)} FWHM
        </span>
      ) : null}
      {cooled !== null && Math.abs(cooled - scale) > 5e-7 ? (
        <button
          type="button"
          style={pillBtn}
          onClick={() => can.setScale(name, cooled)}
          title={`From the sample temperature the file states (“${stated!.text}”) and ${phase.can.expansion!.source}. Use it if the can is at the sample's temperature.`}
        >
          {Math.round(stated!.kelvin * 10) / 10} K: × {fmtScale(cooled)}{cooledShift ? ` (${compactHkl(cooledShift.hkl)} ${signed(cooledShift.fwhm, 1)} FWHM)` : ""}
        </button>
      ) : null}
      {scale !== 1 ? <button type="button" style={{ ...linkButton, padding: 0, fontSize: 12 }} onClick={() => can.setScale(name, 1)}>room T</button> : null}
    </span>
  );
}

function temperatureNote(t: TemperatureReading): string {
  if (t.kind === "stated") return `The file states ${Math.round(t.temperature.kelvin * 10) / 10} K (“${t.temperature.text}”).`;
  if (t.kind === "conflicting") return `The file states several temperatures (${t.values.map((v) => `${Math.round(v.kelvin * 10) / 10} K`).join(", ")}): none is taken. Set the scales by hand.`;
  return "The file states no sample temperature, so no cooled value is offered: set the scales by hand if the can is not at room temperature.";
}

/** The can d-scales in a row (under the plot while the toggle is on, and in the Validation section). */
export function CanScaleRow({ can }: { can: CanLinesState }): JSX.Element | null {
  if (!can.available || can.phases.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, rowGap: 6, flexWrap: "wrap", fontSize: 12, color: color.secondary }}>
      {can.phases.map((p) => <ScaleControl key={p.can.phase} can={can} phase={p} />)}
      <InfoBadge
        width={320}
        text={`Each can's lines sit at its room-temperature d × this scale: a cooled can contracts, and a part away from the sample position shifts its lines too. ${temperatureNote(can.temperature)} Cooled values: ${CAN_PHASES.filter((c) => c.expansion).map((c) => `${c.phase} ${c.expansion!.source}`).join("; ")}.`}
      />
    </div>
  );
}

// ── the Validation view's card ────────────────────────────────────────────

const NARROW = 560;
/** The readings are sentences: the page's text face, not the table's mono. */
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const SHOWN = 6;
/** Extra peaks that match no can line, listed before "more" (the strongest first, as the view lists them). */
const OTHERS_SHOWN = 5;

function Dot({ c }: { c: string }): JSX.Element {
  return <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: c, marginRight: 6 }} />;
}

const canName = (o: { line: { phase: string; hkl: string } }): string => `${o.line.phase} ${compactHkl(o.line.hkl)}`;
const canColor = (phase: string): string => CAN_COLORS[phase] ?? color.faint;

/** The rule, as the card's "?" states it. */
export const EXTRA_PEAK_RULE =
  "An extra peak is intensity the model does not capture, as Validation's “What limits the fit” (and the Copilot's diagnose_fit) finds it: on the points where the model is background alone (its peaks under 0.5 σ there), the residual (obs − calc)/σ, its running mean over 24 line widths taken off, is summed over windows of 1, 2, 4 and 8 line widths (the FWHM of the calculated lines); a window counts when that sum over √(points) passes the level that pure noise crosses anywhere in the pattern only 1 time in 100 (about 4σ on a few thousand points), and the peak is placed at its strongest window. σ is the file's own, or √y where it gives none. A peak lines up with a can line when it is within 1 FWHM of the page's profile at the can line's d, after that can's d-scale. Peaks under the sample's own lines are not looked for here: the can lines under sample reflections are listed below.";

const peakD = (m: ExtraPeakMatch<BackgroundExcess>): string => `${m.peak.d.toFixed(3)} Å`;

export function CanLinesSection({
  can,
  phaseTicks,
  onLocateX,
}: {
  can: CanLinesState;
  /** The sample's tick rows (every model phase, the magnetic row too). */
  phaseTicks: readonly PhaseTicks[];
  /** Open the pattern at a native x. */
  onLocateX?: (x: number) => void;
}): JSX.Element | null {
  // The sample's reflections, those of one phase at one d (822 and 660 of a cubic cell) as one.
  const reflections = useMemo(() => {
    const out = new Map<string, { d: number; hkl: string; phase: string }>();
    for (const p of phaseTicks) for (const t of p.ticks) {
      const key = `${p.id}|${t.d.toFixed(6)}`;
      const had = out.get(key);
      out.set(key, had ? { ...had, hkl: `${had.hkl}/${t.hkl}` } : { d: t.d, hkl: t.hkl, phase: p.label });
    }
    return [...out.values()];
  }, [phaseTicks]);
  const onePhase = phaseTicks.length <= 1;
  const [showUnder, setShowUnder] = useState(false);
  const [allOthers, setAllOthers] = useState(false);
  // The sample reflections the can's lines sit under: counted for the collapsed line, listed behind "show".
  const under = useMemo(() => (can.ctx ? canOverlaps(can.ctx, can.phases, reflections) : null), [can.ctx, can.phases, reflections]);
  if (!can.available) return null;
  const extra = can.extra;
  const matched = extra?.filter((m) => m.line) ?? [];
  const others = extra?.filter((m) => !m.line) ?? [];
  const view = (x: number): ReactNode => (onLocateX ? <button type="button" style={{ ...linkButton, padding: "0 0 0 4px" }} onClick={() => onLocateX(x)}>view →</button> : null);
  // Each peak kept on one line; the list wraps between peaks.
  const list = (ms: readonly ExtraPeakMatch<BackgroundExcess>[], withLine: boolean): ReactNode => ms.map((m, i) => (
    <Fragment key={`${m.peak.x}`}>
      {i > 0 ? ", " : ""}
      <span style={{ whiteSpace: "nowrap" }}>
        <span style={{ fontFamily: mono }}>{peakD(m)}</span>
        {withLine && m.line ? <> (<Dot c={canColor(m.line.phase)} />{canName({ line: m.line })})</> : null}
        {view(m.peak.x)}
      </span>
    </Fragment>
  ));
  const cans = [...new Set((under ?? []).map((o) => o.line.phase))];
  const n = under?.length ?? 0;
  return (
    <section aria-label="Can lines" style={{ ...sectionStyle, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: fz.small, fontWeight: 650, color: color.ink }}>Can lines</span>
        <InfoBadge text={EXTRA_PEAK_RULE} width={340} />
      </div>
      {!can.ctx ? (
        <p style={{ margin: 0, fontSize: fz.small, color: color.ink }}>Needs a calibrated pattern: load the instrument that places the peaks.</p>
      ) : extra === null ? (
        <p style={{ margin: 0, fontSize: fz.small, color: color.ink }}>Extra peaks cannot be read on this pattern (no d-spacing, or fewer than three resolved lines to measure a line width).</p>
      ) : (
        <>
          <p data-testid="can-lines-result" style={{ margin: 0, fontSize: fz.small, color: color.ink, lineHeight: 1.5 }}>
            {matched.length === 0
              ? "No extra peak lines up with a V or Al can line."
              : <>{matched.length === 1 ? "1 extra peak lines up with a can line" : `${matched.length} extra peaks line up with can lines`}: {list(matched, true)}</>}
          </p>
          {others.length > 0 ? (
            <p data-testid="can-lines-others" style={{ margin: 0, fontSize: fz.small, color: color.secondary, lineHeight: 1.5 }}>
              {others.length} {matched.length > 0 ? "other " : ""}extra peak{others.length === 1 ? " matches" : "s match"} no can line: {list(allOthers ? others : others.slice(0, OTHERS_SHOWN), false)}
              {others.length > OTHERS_SHOWN ? (
                <button type="button" style={{ ...linkButton, fontSize: "inherit" }} onClick={() => setAllOthers((v) => !v)}>
                  {allOthers ? "fewer" : `+ ${others.length - OTHERS_SHOWN} more`}
                </button>
              ) : null}
            </p>
          ) : null}
        </>
      )}
      <CanScaleRow can={can} />
      {can.ctx && n > 0 ? (
        <div style={{ fontSize: fz.small, color: color.secondary }}>
          {cans.join(" and ")} lines also sit under {n} sample reflection{n === 1 ? "" : "s"}: their intensities may include the can.
          <button type="button" aria-expanded={showUnder} style={{ ...linkButton, fontSize: "inherit" }} onClick={() => setShowUnder((v) => !v)}>{showUnder ? "hide" : "show"}</button>
          {showUnder && under ? (
            <div style={{ marginTop: 6 }}>
              <UnderList
                rows={under.map((o: SampleOverlap) => ({
                  key: `${o.line.phase}${o.line.hkl}|${o.reflection.phase}${o.reflection.hkl}|${o.reflection.d}`,
                  can: o.line.phase,
                  canLine: canName(o),
                  d: o.line.d,
                  rel: o.line.relative,
                  other: onePhase ? compactHkl(o.reflection.hkl) : `${compactHkl(o.reflection.hkl)} · ${o.reflection.phase}`,
                  separation: o.separation,
                  reading: sampleReading(o, { phase: !onePhase }),
                  x: o.line.x,
                }))}
                {...(onLocateX ? { onLocateX } : {})}
              />
              <p style={{ ...caption, marginTop: 4 }}>Rel. I: within each can's own lines; the can's scale against the sample is unknown.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

interface UnderRow {
  readonly key: string;
  readonly can: string;
  readonly canLine: string;
  readonly d: number;
  readonly rel: number;
  readonly other: string;
  readonly separation: number;
  readonly reading: string;
  readonly x: number;
}

function UnderList({ rows, onLocateX }: { rows: readonly UnderRow[]; onLocateX?: (x: number) => void }): JSX.Element {
  const [all, setAll] = useState(false);
  const [boxRef, width] = useElementWidth(600);
  const shown = all ? rows : rows.slice(0, SHOWN);
  const view = (r: UnderRow): ReactNode => (onLocateX ? <button type="button" style={{ ...linkButton, padding: 0 }} onClick={() => onLocateX(r.x)}>view →</button> : null);
  return (
    <div ref={boxRef}>
      {width < NARROW ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {shown.map((r, i) => (
            <li key={r.key} style={{ padding: "5px 0", borderTop: i > 0 ? `1px solid ${color.subtle2}` : "none", fontSize: fz.small }}>
              <div style={{ display: "flex", flexWrap: "wrap", columnGap: 10, rowGap: 1, alignItems: "baseline", fontFamily: mono, lineHeight: 1.35, color: color.ink }}>
                <span><Dot c={canColor(r.can)} />{r.canLine}</span>
                <span style={{ color: color.secondary }}>d {r.d.toFixed(3)} Å</span>
                <span style={{ color: color.secondary }}>rel. I {r.rel.toFixed(2)}</span>
                <span>{r.other}</span>
                <span>{r.separation.toFixed(2)} FWHM</span>
                {view(r)}
              </div>
              <div style={{ color: color.secondary, marginTop: 2, lineHeight: 1.4 }}>{r.reading}</div>
            </li>
          ))}
        </ol>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Can line</th>
              <th style={th}>d (Å)</th>
              <th style={th}>Rel. I</th>
              <th style={{ ...th, textAlign: "left" }}>Sample</th>
              <th style={th}>Δ (FWHM)</th>
              <th style={{ ...th, textAlign: "left" }}>Reading</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody style={{ color: color.ink }}>
            {shown.map((r) => (
              <tr key={r.key}>
                <td style={{ ...td, textAlign: "left" }}><Dot c={canColor(r.can)} />{r.canLine}</td>
                <td style={td}>{r.d.toFixed(3)}</td>
                <td style={td}>{r.rel.toFixed(2)}</td>
                <td style={{ ...td, textAlign: "left" }}>{r.other}</td>
                <td style={td}>{r.separation.toFixed(2)}</td>
                <td style={{ ...td, textAlign: "left", fontFamily: SANS, fontSize: fz.small, color: color.secondary, whiteSpace: "normal", minWidth: 220 }}>{r.reading}</td>
                <td style={td}>{view(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > SHOWN ? (
        <button type="button" style={{ ...linkButton, padding: 0, fontSize: fz.micro, marginTop: 4 }} onClick={() => setAll((v) => !v)}>
          {all ? "fewer" : `all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}
