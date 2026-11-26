/**
 * The powder page's "Can lines" (neutron data): a toggle beside the phase
 * ticks that draws the V and Al can lines on the pattern at their relative
 * strength, the d-scale of each can (default 1, a one-click cooled value when
 * the data file states the sample temperature), and the Validation view's
 * section: every sample reflection and observed peak within one FWHM of a can
 * line, with a plain reading. Nothing is fitted or excluded, and nothing here
 * reaches the Agent (core/diagnostics/canLines.ts holds the physics).
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern, PowderXUnit } from "@/core/diffraction/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { resolveTies } from "@/core/refinement/constraints";
import { applyParameters } from "@/core/workflow/apply";
import { phaseBindingsFor } from "@/core/workflow/multiPhase";
import type { PowderProfile } from "@/core/workflow/powder";
import {
  CAN_PHASES,
  canLines,
  canOverlaps,
  compactHkl,
  expansionScale,
  isNeutron,
  observedPeakApexes,
  observedReading,
  sampleReading,
  scaleShift,
  type CanLineContext,
  type CanPhaseLines,
  type ObservedOverlap,
  type SampleOverlap,
} from "@/core/diagnostics/canLines";
import { statedTemperature, type TemperatureReading } from "@/parsers/statedTemperature";
import { CAN_COLORS, canPhaseTicks } from "@/visualization/canTicks";
import { convertAxisValue, type AxisContext } from "@/visualization/axisUnits";
import type { PhaseTicks } from "@/visualization/reflectionTicks";
import { color, fz, mono } from "@/app/theme";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { caption, linkButton, sectionStyle, tableStyle, td, th, useElementWidth } from "@/app/ui/ValidationParts";

export interface CanLinesPage {
  readonly structure: StructureModel;
  readonly extraPhases: readonly StructureModel[];
  readonly pattern: PowderPattern;
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  readonly profile: PowderProfile;
  /** The data file's text, for the sample temperature it states. */
  readonly rawText?: string | null | undefined;
  /** The plot's display unit and axis, for the ticks. */
  readonly displayUnit: PowderXUnit;
  readonly axis: AxisContext;
  /** The lines are needed though the toggle is off: the Validation view is open. */
  readonly wanted: boolean;
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
  /** The plot's can rows (empty while the toggle is off). */
  readonly ticks: readonly PhaseTicks[];
}

const fmtScale = (s: number): string => s.toFixed(5);

export function useCanLines(page: CanLinesPage): CanLinesState {
  const available = isNeutron(page.pattern.radiation);
  const [on, setOn] = useState(false);
  const [scales, setScales] = useState<Readonly<Record<string, number>>>({});
  const temperature = useMemo(() => statedTemperature(page.rawText), [page.rawText]);
  const ctx = useMemo<CanLineContext | null>(() => {
    if (!available || !(on || page.wanted)) return null;
    const values: Record<string, number> = {};
    for (const p of page.params) values[p.id] = p.value;
    const resolved = resolveTies(page.params, values);
    const bindings = page.extraPhases.length > 0 ? phaseBindingsFor(page.bindings, page.structure.id) : page.bindings;
    const applied = applyParameters(page.structure, bindings, resolved);
    // Time of flight places peaks only with a calibration and its back-to-back-exponential profile.
    if (page.pattern.xUnit === "tof" && (!applied.tof || page.profile.shape !== "tof")) return null;
    return {
      pattern: page.pattern,
      applied,
      options: { shape: page.profile.shape, ...(page.profile.eta !== undefined ? { eta: page.profile.eta } : {}) },
      applyLorentz: page.profile.lorentz ?? true,
    };
  }, [available, on, page.wanted, page.params, page.bindings, page.structure, page.extraPhases, page.pattern, page.profile]);
  const phases = useMemo(() => (ctx ? canLines(ctx, scales) : []), [ctx, scales]);
  const { displayUnit, axis } = page;
  const ticks = useMemo(
    () => (on && phases.length > 0 ? canPhaseTicks(phases, (d) => convertAxisValue(d, "dSpacing", displayUnit, axis)) : []),
    [on, phases, displayUnit, axis],
  );
  return {
    available,
    on: available && on,
    setOn,
    scales,
    setScale: (phase, scale) => setScales((s) => ({ ...s, [phase]: scale })),
    temperature,
    ctx,
    phases,
    ticks,
  };
}

const CAN_INFO =
  "Where a vanadium or aluminium can (or Al cryostat shields) puts Bragg lines on neutron data. Each tick's solid part is the line's strength per volume of metal, so V's are drawn as weak as they are; the faint mark only shows where it is. Room-temperature cells × the d-scale of each can. How much can the beam sees is unknown, so its intensity against the sample's is too. Nothing is fitted or excluded.";

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

// ── the Validation view's section ─────────────────────────────────────────

const NARROW = 560;
/** The readings are sentences: the page's text face, not the table's mono. */
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const SHOWN = 6;

function Dot({ c }: { c: string }): JSX.Element {
  return <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: c, marginRight: 6 }} />;
}

const canName = (o: { line: { phase: string; hkl: string } }): string => `${o.line.phase} ${compactHkl(o.line.hkl)}`;
const canColor = (phase: string): string => CAN_COLORS[phase] ?? color.faint;

export function CanLinesSection({
  can,
  phaseTicks,
  x,
  yObs,
  sigma,
  d,
  onLocateX,
}: {
  can: CanLinesState;
  /** The sample's tick rows (every model phase, the magnetic row too). */
  phaseTicks: readonly PhaseTicks[];
  /** Native-unit observed curve. */
  x: readonly number[];
  yObs: readonly number[];
  sigma: readonly number[];
  d?: readonly number[] | undefined;
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
  const observed = useMemo(() => observedPeakApexes(x, yObs, sigma, d ?? null), [x, yObs, sigma, d]);
  const overlaps = useMemo(() => (can.ctx ? canOverlaps(can.ctx, can.phases, reflections, observed) : null), [can.ctx, can.phases, reflections, observed]);
  if (!can.available) return null;
  const ratio = (() => {
    const v = can.phases.find((p) => p.can.phase === "V");
    const al = can.phases.find((p) => p.can.phase === "Al");
    return v && al && v.perVolume > 0 && al.perVolume > 0 ? al.perVolume / v.perVolume : null;
  })();
  const nS = overlaps?.sample.length ?? 0;
  const nO = overlaps?.observed.length ?? 0;
  const headline = !overlaps
    ? "Needs a calibrated pattern: load the instrument that places the peaks."
    : nS + nO === 0
      ? "No sample reflection or observed peak lies within 1 FWHM of a V or Al can line."
      : `${nS} sample reflection${nS === 1 ? "" : "s"} and ${nO} observed peak${nO === 1 ? "" : "s"} lie within 1 FWHM of a V or Al can line.`;
  const info = `A sample reflection or observed peak counts when its apex is within one FWHM of a can line's (the page's own profile at that d; separations to 0.01 FWHM). Rel. I is the can line's integrated intensity against its own strongest line here (neutron b: V −0.3824 fm, Al 3.449 fm; the page's Lorentz factor and corrections).${ratio ? ` Per volume of metal, V's strongest line is 1/${Math.round(ratio)} of Al's.` : ""} How much can the beam sees is unknown, so nothing says what share of a peak is the can's. Nothing is fitted or excluded.`;
  return (
    <section aria-label="Can lines" style={{ ...sectionStyle, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: fz.small, fontWeight: 650, color: color.ink }}>Can lines</span>
        <InfoBadge text={info} width={320} />
      </div>
      <p style={{ margin: 0, fontSize: fz.small, color: color.ink }}>{headline}</p>
      <CanScaleRow can={can} />
      {overlaps && nS > 0 ? (
        <OverlapList
          title="Sample reflections"
          rows={overlaps.sample.map((o: SampleOverlap) => ({
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
          otherHead="Sample"
          {...(onLocateX ? { onLocateX } : {})}
        />
      ) : null}
      {overlaps && nO > 0 ? (
        <OverlapList
          title="Observed peaks"
          rows={overlaps.observed.map((o: ObservedOverlap) => ({
            key: `${o.line.phase}${o.line.hkl}|${o.peak.x}`,
            can: o.line.phase,
            canLine: canName(o),
            d: o.line.d,
            rel: o.line.relative,
            other: o.peak.d !== null ? `peak ${o.peak.d.toFixed(3)} Å` : "peak",
            separation: o.separation,
            reading: observedReading(o),
            x: o.peak.x,
          }))}
          otherHead="Observed"
          {...(onLocateX ? { onLocateX } : {})}
        />
      ) : null}
      {overlaps ? <p style={caption}>Rel. I: within each can's own lines; the can's scale against the sample is unknown.</p> : null}
    </section>
  );
}

interface OverlapRow {
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

function OverlapList({ title, rows, otherHead, onLocateX }: { title: string; rows: readonly OverlapRow[]; otherHead: string; onLocateX?: (x: number) => void }): JSX.Element {
  const [all, setAll] = useState(false);
  const [boxRef, width] = useElementWidth(600);
  const shown = all ? rows : rows.slice(0, SHOWN);
  const view = (r: OverlapRow): ReactNode => (onLocateX ? <button type="button" style={{ ...linkButton, padding: 0 }} onClick={() => onLocateX(r.x)}>view →</button> : null);
  return (
    <div ref={boxRef}>
      <div style={{ fontSize: fz.micro, fontWeight: 650, color: color.secondary, margin: "2px 0 4px" }}>{title} · {rows.length}</div>
      {width < NARROW ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {shown.map((r, i) => (
            <li key={r.key} style={{ padding: "5px 0", borderTop: i > 0 ? `1px solid ${color.subtle2}` : "none", fontSize: fz.small }}>
              <div style={{ display: "flex", flexWrap: "wrap", columnGap: 10, rowGap: 1, alignItems: "baseline", fontFamily: mono, lineHeight: 1.35 }}>
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
              <th style={{ ...th, textAlign: "left" }}>{otherHead}</th>
              <th style={th}>Δ (FWHM)</th>
              <th style={{ ...th, textAlign: "left" }}>Reading</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
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
