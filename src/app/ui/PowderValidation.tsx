/**
 * The powder page's Validation view, read top down:
 *
 *  1. The verdict: one line on where the fit stands, the state of the fit
 *     judged (converged, a converged snapshot, edited since, not refined),
 *     and the user's acceptance bar as three checks — the goodness of fit,
 *     physical sanity, the external cross-check — each green, amber or red
 *     with one short line (core/diagnostics/powderAcceptance.ts).
 *  2. What limits the fit: diagnose_fit's causes, largest share of χ² first,
 *     each with what the residual shows and what to do in a few words, in the
 *     order of the user's method (fitCauses.ts). An action opens the parameter
 *     group the cause is about, or the pattern where it shows; the rows are
 *     the user's to free.
 *
 * Every line is short and leads with what to do. The longer account — the
 * statistic, the method's reasons, diagnose_fit's own words — is in a "?"
 * beside it (a tooltip on hover as well): nothing is dropped, only moved.
 *  3. The evidence, collapsed: the normalized residual with the cumulative χ²,
 *     χ² by d-shell, the worst peaks, and every agreement number (Rp, Rwp,
 *     Rexp, the background-subtracted pair, Durbin–Watson, R_Bragg and R_F
 *     per phase).
 *
 * The causes and the findings are those the Agent's tools report on the same
 * page (powderJudgment.ts): the view and the Agent never disagree on what
 * limits a fit.
 *
 * Deliberately absent: an F_obs vs F_calc scatter. Powder I_obs is split
 * between overlapping peaks in proportion to I_calc, so the scatter leans
 * toward the model; the per-phase R_Bragg keeps the same caveat and says so.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { ReflectionObsCalc } from "@/core/workflow/obsCalc";
import type { PhaseTicks } from "@/visualization/reflectionTicks";
import { tickCountFor } from "@/visualization/axisTicks";
import { clientToSvgUser } from "@/visualization/hitTest";
import {
  phaseAgreement,
  powderValidation,
  worstReflections,
  type MisfitSignature,
  type PowderValidation,
  type ReflectionMisfit,
} from "@/core/diagnostics/powderValidation";
import { parametersChangedSince, type CheckStatus } from "@/core/diagnostics/validationChecks";
import { powderAcceptance, type Acceptance, type AcceptanceCheck, type PhysicalItem, type Tone } from "@/core/diagnostics/powderAcceptance";
import { pageAssessment, pageFitDiagnosis, type JudgedPage } from "@/app/powderJudgment";
import { causeRows, headlineCause, whereSummary, type ActionButton, type CauseRow, type EvidenceSection, type ValidationAction } from "@/app/ui/fitCauses";
import { color, fz, mono, uppercaseLabel } from "@/app/theme";
import { InfoBadge } from "@/app/ui/InfoBadge";
import {
  ACTION_LABEL,
  Bars,
  Metric,
  MetricGrid,
  StatusIcon,
  TONES,
  useElementWidth,
  caption,
  linkButton,
  sectionStyle,
  tableStyle,
  td,
  th,
} from "@/app/ui/ValidationParts";
import { minMax } from "@/core/math/extent";

const AGREEMENT_INFO = "Rwp is judged against Rexp: their ratio is the GoF (Toby 2006). With the background subtracted (Rwp′, Rexp′) the same misfit is measured against the peaks alone. Durbin–Watson d ≈ 2 for uncorrelated residuals; below Q_D (Hill & Flack 1987) neighbouring points miss together — a profile misfit, and esds that are too small. R_Bragg and R_F come from the Rietveld split of I_obs, so overlapped reflections lean toward the model: compare phases with them, don't quote them as proof.";
const STRIP_INFO = "Top: (y_obs − y_calc)/σ per point, the ±3σ band shaded. Bottom: the running χ² as a share of the total. Noise alone climbs as a straight ramp; steps are where the model misses, and the numbered steps are the rows of Worst peaks. Click the strip to open that spot in the Refinement view.";
const SHELL_INFO = "χ² per point in equal-count shells of d. Near 1 is noise. Misfit concentrated at short d points to the ADPs or an absorption/roughness correction; at long d, to peak shape, asymmetry or preferred orientation.";
const WORST_INFO = "Each point's χ² is shared among the reflections in proportion to their calculated intensity there. The signature reads the residual under the peak: ± lobes mean position, width or asymmetry; a one-signed residual means intensity. Several reflections of one hkl family on the same side suggest preferred orientation.";
const CAUSES_INFO = "The Agent's diagnose_fit, read on the fit on screen: the residual between the peaks (background), the line widths and shapes of isolated peaks, ± lobes under the peaks (position, asymmetry, shape), the intensity fall-off with angle (ADPs), preferred orientation, and what is left of the intensities (the structure). Shares are approximate, and causes can overlap. Act on the largest first, in your method's order, and read it again after each change.";

/** Causes shown before "show all". */
const CAUSES_SHOWN = 3;
/** Worst-peak rows shown before "all". */
const WORST_SHOWN = 4;
/** Below this width the worst peaks are listed as wrapping rows, not a table. */
const NARROW = 520;

export interface PowderValidationProps {
  /** Native-unit curves of the page (total calc, background included). */
  readonly x: readonly number[];
  readonly yObs: readonly number[];
  readonly yCalc: readonly number[];
  readonly yBackground?: readonly number[];
  readonly sigma: readonly number[];
  /** Points that enter the fit. */
  readonly include: readonly boolean[];
  /** d-spacing of every point, when the axis converts. */
  readonly d?: readonly number[];
  readonly nParams: number;
  /** Rows of the Rietveld partition, built with χ² attribution. */
  readonly reflections: readonly ReflectionObsCalc[];
  /** Bragg tick rows in the display unit. */
  readonly phaseTicks: readonly PhaseTicks[];
  /** Native x → display x, and the display axis label. */
  readonly toDisplay: (x: number) => number;
  readonly displayLabel: string;
  readonly result: RefinementResult | null;
  readonly parameters: readonly RefinementParameter[];
  /** The page as the Agent's tools read it (powderJudgment.ts): the causes and the findings come from it. */
  readonly page?: JudgedPage | null;
  /** The GoF the card's header shows (the last refinement's, else the curves'): the verdict judges the same number. */
  readonly gof?: number;
  /** The page shows the converged snapshot it opened on (a demo), with no refinement of its own. */
  readonly snapshot?: boolean;
  /** The method's stages done (agent/method.ts ids), for the order of the advice. */
  readonly stagesDone?: readonly string[];
  /** Open the pattern zoomed on a reflection. */
  readonly onLocateReflection?: (row: ReflectionObsCalc) => void;
  /** Open the pattern zoomed on a native x. */
  readonly onLocateX?: (x: number) => void;
  readonly onAction?: (action: ValidationAction) => void;
  /** The page can refine now (no fit running, a pattern it refines): the verdict then offers Refine. */
  readonly canRefine?: boolean;
  readonly canExport?: boolean;
  /** The evidence sections open (the page holds them, so they survive a switch of view). */
  readonly openSections?: ReadonlySet<EvidenceSection>;
  readonly onToggleSection?: (section: EvidenceSection) => void;
}

const SIGNATURE: Record<MisfitSignature, string> = {
  shape: "± lobes · shape/position",
  under: "under-calculated",
  over: "over-calculated",
};

function pct(v: number | undefined, digits = 2): string {
  return v === undefined || !Number.isFinite(v) ? "—" : `${(100 * v).toFixed(digits)}%`;
}

/** A tone as the shared status palette draws it. */
const STATUS: Record<Tone, CheckStatus> = { green: "ok", amber: "note", red: "critical", grey: "info" };

export function PowderValidationView(props: PowderValidationProps): JSX.Element {
  const { x, yObs, yCalc, yBackground, sigma, include, d, nParams, reflections, phaseTicks, result, parameters, page } = props;

  const validation = useMemo(
    () => powderValidation({ x, yObs, yCalc, ...(yBackground ? { yBackground } : {}), sigma, include, nParams, ...(d ? { d } : {}) }),
    [x, yObs, yCalc, yBackground, sigma, include, nParams, d],
  );
  const phases = useMemo(() => phaseAgreement(reflections), [reflections]);
  const worst = useMemo(() => worstReflections(reflections, validation.chi2, 8), [reflections, validation.chi2]);

  // The Agent's readings of the same page: diagnose_fit, and assess_refinement while a result describes the values.
  const judged = useMemo(() => (page ? pageFitDiagnosis(page) : null), [page]);
  const current = result !== null && !parametersChangedSince(result, parameters);
  const assessment = useMemo(() => (page && current ? pageAssessment(page) : null), [page, current]);
  const stagesDone = props.stagesDone;
  const causes = useMemo<CauseRow[]>(() => {
    if (!judged || !page) return [];
    return causeRows(judged.diagnosis, {
      parameters: page.parameters,
      twoTheta: page.pattern.xUnit === "twoTheta",
      backgroundTerms: page.settings.backgroundTerms,
      magneticNeutron: judged.magneticNeutron,
      widthsFree: judged.widthsFree,
      stagesDone: stagesDone ?? [],
    });
  }, [judged, page, stagesDone]);

  const acceptance = useMemo(() => powderAcceptance({
    gof: props.gof ?? validation.agreement.gof,
    durbinWatson: validation.durbinWatson,
    result,
    parameters,
    structures: page?.refinedPhases ?? [],
    assessment,
    snapshot: props.snapshot ?? false,
    topCause: headlineCause(causes),
    canExport: props.canExport ?? false,
  }), [props.gof, validation, result, parameters, page, assessment, props.snapshot, causes, props.canExport]);

  // Evidence sections: held by the page when it offers to, else here.
  const [ownOpen, setOwnOpen] = useState<ReadonlySet<EvidenceSection>>(new Set());
  const open = props.openSections ?? ownOpen;
  const toggle = (s: EvidenceSection): void => {
    if (props.onToggleSection) props.onToggleSection(s);
    else setOwnOpen((o) => { const n = new Set(o); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  };
  const openSection = (s: EvidenceSection): void => {
    if (!open.has(s)) toggle(s);
    // Bring it into view once it has rendered.
    setTimeout(() => document.getElementById(`validation-${s}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
  };
  const act = (a: ValidationAction): void => {
    if (a.kind === "evidence") openSection(a.section);
    else props.onAction?.(a);
  };

  const phaseColor = (id: string): string => phaseTicks.find((p) => p.id === id)?.color ?? color.primary;
  const reflectionX = (row: ReflectionObsCalc): number | undefined => {
    const id = row.kind === "magnetic" ? "magnetic" : row.phaseId;
    const hkl = `${row.h} ${row.k} ${row.l}`;
    return phaseTicks.find((p) => p.id === id)?.ticks.find((t) => t.hkl === hkl)?.x;
  };
  const markers = worst.map((w, i) => ({ n: i + 1, x: reflectionX(w.row) }));
  const where = useMemo(() => whereSummary(validation), [validation]);

  const ag = validation.agreement;
  const dw = validation.durbinWatson;
  const refCount = phases.reduce((a, p) => a + p.reflections, 0);
  const meanChi2 = ag.n > 0 ? validation.chi2 / ag.n : 0;
  const worstShare = worst.reduce((a, w) => a + w.share, 0);
  const peakShell = validation.shells.reduce<(typeof validation.shells)[number] | null>((best, s) => (!best || s.chi2PerPoint > best.chi2PerPoint ? s : best), null);
  const shellDigits = validation.shellAxis === "d" ? 2 : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Verdict acceptance={acceptance} canRefine={props.canRefine ?? !!props.onAction} onAction={act} />
      <Causes
        causes={causes}
        state={acceptance.state.kind}
        band={acceptance.band}
        where={where}
        diagnosable={judged !== null}
        onAction={act}
      />

      <section aria-label="Evidence" style={{ ...sectionStyle, gap: 0, paddingTop: 8, paddingBottom: 4 }}>
        <span style={{ ...uppercaseLabel, paddingBottom: 2 }}>Evidence</span>
        <Disclosure
          id="residual"
          title="Residual"
          summary={`Δ/σ and cumulative χ²${dw ? ` · DW ${dw.d.toFixed(2)}` : ""}`}
          info={STRIP_INFO}
          open={open.has("residual")}
          onToggle={() => toggle("residual")}
        >
          <ResidualStrip
            x={x}
            validation={validation}
            include={include}
            toDisplay={props.toDisplay}
            displayLabel={props.displayLabel}
            phaseTicks={phaseTicks}
            markers={markers}
            {...(props.onLocateX ? { onLocateX: props.onLocateX } : {})}
          />
        </Disclosure>
        <Disclosure
          id="shells"
          title={validation.shellAxis === "d" ? "χ² by d-shell" : "χ² by shell"}
          summary={peakShell ? `highest ${peakShell.chi2PerPoint.toFixed(1)}/point at ${validation.shellAxis === "d" ? "d " : ""}${Math.min(peakShell.lo, peakShell.hi).toFixed(shellDigits)}–${Math.max(peakShell.lo, peakShell.hi).toFixed(shellDigits)}${validation.shellAxis === "d" ? " Å" : ""} (noise 1)` : undefined}
          info={SHELL_INFO}
          open={open.has("shells")}
          onToggle={() => toggle("shells")}
        >
          <Bars
            items={validation.shells.map((s) => ({
              label: s.lo.toFixed(shellDigits),
              value: s.chi2PerPoint,
              text: s.chi2PerPoint.toFixed(1),
              title: `${s.lo.toFixed(3)} – ${s.hi.toFixed(3)} · ${s.n} points · ${(100 * s.share).toFixed(1)}% of χ²`,
              flagged: s.chi2PerPoint > 1.5 && s.chi2PerPoint > 1.25 * meanChi2,
            }))}
            max={1.18 * Math.max(1.2, ...validation.shells.map((s) => s.chi2PerPoint))}
            reference={1}
            referenceLabel="noise"
            axisLabel={validation.shellAxis === "d" ? "shell start, d (Å)" : `shell start, ${props.displayLabel}`}
          />
        </Disclosure>
        <Disclosure
          id="worst"
          title="Worst peaks"
          summary={worst.length > 0 ? `${worst.length} worst: ${pct(worstShare, 0)} of χ²` : "no reflection list"}
          info={WORST_INFO}
          open={open.has("worst")}
          onToggle={() => toggle("worst")}
        >
          <WorstPeaks worst={worst} phaseColor={phaseColor} {...(props.onLocateReflection ? { onLocate: props.onLocateReflection } : {})} />
        </Disclosure>
        <Disclosure
          id="agreement"
          title="Agreement"
          summary={`Rwp ${pct(ag.rwp)} · Rexp ${pct(ag.rexp)} · ${ag.n.toLocaleString()} points · ${refCount} refl · ${nParams} free`}
          info={AGREEMENT_INFO}
          open={open.has("agreement")}
          onToggle={() => toggle("agreement")}
          last
        >
          <MetricGrid>
            <Metric value={pct(ag.rwp)} label="Rwp" />
            <Metric value={pct(ag.rexp)} label="Rexp" />
            <Metric value={ag.gof.toFixed(2)} label={`GoF · χ²ᵥ ${ag.chi2nu.toFixed(1)}`} />
            <Metric value={pct(ag.rp)} label="Rp" />
            {ag.rwpBkg !== undefined ? <Metric value={pct(ag.rwpBkg)} label="Rwp′ bkg-sub" title="Σw(y_o − y_c)² over Σw(y_o − y_b)²" /> : null}
            {ag.rexpBkg !== undefined ? <Metric value={pct(ag.rexpBkg)} label="Rexp′ bkg-sub" /> : null}
            {dw ? <Metric value={dw.d.toFixed(2)} label={`DW · Q_D ${dw.qd.toFixed(2)}`} tone={dw.correlated ? "warn" : "ok"} title={dw.correlated ? "Durbin–Watson d below Hill & Flack's critical value: neighbouring points miss together" : "Durbin–Watson d against Hill & Flack's critical value"} /> : null}
          </MetricGrid>
          {phases.length > 0 ? (
            <table style={{ ...tableStyle, marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Phase</th>
                  <th style={th}>R_Bragg</th>
                  <th style={th}>R_F</th>
                  <th style={th}>N</th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p) => (
                  <tr key={p.phaseId}>
                    <td style={{ ...td, textAlign: "left", fontFamily: "inherit", whiteSpace: "normal" }}><Dot color={phaseColor(p.phaseId)} />{p.label}</td>
                    <td style={td}>{pct(p.rBragg)}</td>
                    <td style={td}>{pct(p.rF)}</td>
                    <td style={td}>{p.reflections}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Disclosure>
      </section>
    </div>
  );
}

// ── the verdict ────────────────────────────────────────────────────────────

const toneInk = (t: Tone): string => TONES[STATUS[t]].ink;

function Verdict({ acceptance, canRefine, onAction }: { acceptance: Acceptance; canRefine: boolean; onAction: (a: ValidationAction) => void }): JSX.Element {
  const { state } = acceptance;
  return (
    <section aria-label="Verdict" style={{ ...sectionStyle, gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ marginTop: 1 }}><StatusIcon status={STATUS[acceptance.tone]} size={21} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p data-testid="verdict-headline" title={acceptance.headlineDetail} style={{ margin: 0, fontSize: fz.body, fontWeight: 650, lineHeight: 1.4, color: acceptance.tone === "red" ? color.warnInk : color.ink }}>
            {acceptance.headline}
          </p>
          <p data-testid="fit-state" title={state.detail} style={{ margin: "2px 0 0", fontSize: fz.small, lineHeight: 1.45, color: state.tone === "amber" || state.tone === "red" ? toneInk(state.tone) : color.secondary }}>
            {state.text}
            {state.refine && canRefine ? <button type="button" style={linkButton} onClick={() => onAction({ kind: "refine" })}>Refine</button> : null}
          </p>
        </div>
      </div>
      <div>
        <span style={uppercaseLabel}>Acceptance bar</span>
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8 }}>
          {acceptance.checks.map((c) => <CheckCard key={c.id} check={c} onAction={onAction} />)}
        </ul>
      </div>
    </section>
  );
}

const ITEM_CHIP: Record<PhysicalItem["severity"], { label: string; tone: Tone }> = {
  blocker: { label: "fix", tone: "red" },
  issue: { label: "check", tone: "amber" },
  note: { label: "note", tone: "grey" },
};

/** Physical findings shown before "more". */
const ITEMS_SHOWN = 2;

function CheckCard({ check, onAction }: { check: AcceptanceCheck; onAction: (a: ValidationAction) => void }): JSX.Element {
  const [all, setAll] = useState(false);
  const t = TONES[STATUS[check.tone]];
  const items = check.items ?? [];
  const shown = all ? items : items.slice(0, ITEMS_SHOWN);
  // The longer accounts behind the short lines, for the "?" (a tooltip does not show on a touch screen).
  const info = [check.detail, ...(check.esd ?? []).map((e) => e.detail)].filter((s): s is string => !!s);
  const help = info.length > 0 ? (
    <span style={{ display: "inline-flex", marginLeft: 6, verticalAlign: -2 }}><InfoBadge text={info.length === 1 ? info[0] : <Paragraphs lines={info} />} width={280} /></span>
  ) : null;
  return (
    <li data-check={check.id} data-tone={check.tone} style={{ display: "flex", gap: 8, alignItems: "flex-start", border: `1px solid ${check.tone === "grey" ? color.border : t.border}`, background: check.tone === "grey" ? color.surface : t.bg, borderRadius: 8, padding: "8px 10px", minWidth: 0 }}>
      <span style={{ marginTop: 1 }}><StatusIcon status={STATUS[check.tone]} /></span>
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 8, rowGap: 0 }}>
          <span style={{ fontSize: fz.small, fontWeight: 650, color: color.ink }}>{check.label}</span>
          <span style={{ fontSize: fz.small, fontFamily: mono, fontWeight: 600, color: check.tone === "grey" ? color.secondary : t.ink }}>{check.value}</span>
          {!check.sentence ? help : null}
        </div>
        {check.sentence ? <span title={check.detail} style={{ fontSize: fz.small, lineHeight: 1.45, color: color.secondary }}><WithBadge text={check.sentence} badge={help} /></span> : null}
        {shown.length > 0 ? (
          <ul style={{ listStyle: "none", margin: "2px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            {shown.map((item, i) => (
              <li key={i} title={item.detail} style={{ fontSize: fz.micro, lineHeight: 1.45, color: color.ink }}>
                <SeverityChip severity={item.severity} />{item.text}
              </li>
            ))}
          </ul>
        ) : null}
        {items.length > ITEMS_SHOWN ? (
          <button type="button" style={{ ...linkButton, padding: 0, alignSelf: "flex-start", fontSize: fz.micro }} onClick={() => setAll((v) => !v)}>
            {all ? "fewer" : `${items.length - ITEMS_SHOWN} more`}
          </button>
        ) : null}
        {check.esd?.map((e, i) => (
          <span key={i} title={e.detail} style={{ fontSize: fz.micro, lineHeight: 1.45, color: color.secondary }}>{e.text}</span>
        ))}
        {check.actions && check.actions.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
            {check.actions.map((a) => (
              <button key={a} type="button" style={actionButton} onClick={() => onAction({ kind: "check", action: a })}>{ACTION_LABEL[a]}</button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** A line ending in a "?" that wraps with its last word, never alone onto a line of its own. */
function WithBadge({ text, badge }: { text: string; badge: ReactNode }): JSX.Element {
  if (!badge) return <>{text}</>;
  const cut = text.lastIndexOf(" ");
  return <>{text.slice(0, cut + 1)}<span style={{ whiteSpace: "nowrap" }}>{text.slice(cut + 1)}{badge}</span></>;
}

/** Lines of a "?" tooltip, each its own paragraph. */
function Paragraphs({ lines }: { lines: readonly ReactNode[] }): JSX.Element {
  return <>{lines.map((l, i) => <span key={i} style={{ display: "block", marginTop: i > 0 ? 6 : 0 }}>{l}</span>)}</>;
}

function SeverityChip({ severity }: { severity: PhysicalItem["severity"] }): JSX.Element {
  const chip = ITEM_CHIP[severity];
  const t = TONES[STATUS[chip.tone]];
  return (
    <span style={{ display: "inline-block", marginRight: 6, padding: "0 6px", borderRadius: 999, border: `1px solid ${t.border}`, background: t.bg, color: t.ink, fontSize: 10.5, fontWeight: 600, lineHeight: "15px", verticalAlign: 1 }}>
      {chip.label}
    </span>
  );
}

// ── what limits the fit ────────────────────────────────────────────────────

function Causes({ causes, state, band, where, diagnosable, onAction }: {
  causes: readonly CauseRow[];
  state: Acceptance["state"]["kind"];
  band: Acceptance["band"];
  where: string | null;
  diagnosable: boolean;
  onAction: (a: ValidationAction) => void;
}): JSX.Element {
  const [all, setAll] = useState(false);
  const shown = all ? causes : causes.slice(0, CAUSES_SHOWN);
  const body = ((): ReactNode => {
    if (state === "none") return <p style={note} title="Until then every reflection misfits, and each is a misfit to refine, not a cause.">Causes are read once the first block is refined</p>;
    if (!diagnosable) return <p style={note}>Causes need the pattern in d-spacing: a wavelength or a TOF calibration</p>;
    if (causes.length === 0) {
      const look = band === "fair" || band === "poor";
      return (
        <p style={note}>
          No single cause: the misfit is spread thin
          {look ? <button type="button" style={linkButton} title="Read the worst peaks one by one" onClick={() => onAction({ kind: "evidence", section: "worst" })}>Read the worst peaks</button> : null}
        </p>
      );
    }
    return (
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {shown.map((c, i) => <CauseItem key={c.id} cause={c} rank={i + 1} onAction={onAction} />)}
      </ol>
    );
  })();
  return (
    <section aria-label="What limits the fit" style={{ ...sectionStyle, gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, rowGap: 2, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: fz.body, fontWeight: 700, color: color.ink }}>What limits the fit</h3>
        <InfoBadge text={CAUSES_INFO} width={320} />
        {causes.length > 0 && state !== "none" ? (
          <span style={{ fontSize: fz.micro, color: color.secondary }} title="Largest share of χ² first; shares are approximate, and causes can overlap">
            largest first{causes.reduce((a, c) => a + c.share, 0) > 1 ? " · shares overlap" : ""}
          </span>
        ) : null}
        {causes.length > CAUSES_SHOWN && state !== "none" ? (
          <button type="button" style={{ ...linkButton, marginLeft: "auto", padding: 0, fontSize: fz.micro }} onClick={() => setAll((v) => !v)}>
            {all ? "fewer" : `show all ${causes.length}`}
          </button>
        ) : null}
      </div>
      {body}
      {where && state !== "none" ? <p style={{ ...caption, borderTop: `1px solid ${color.subtle2}`, paddingTop: 6 }}>{where}</p> : null}
    </section>
  );
}

function CauseItem({ cause, rank, onAction }: { cause: CauseRow; rank: number; onAction: (a: ValidationAction) => void }): JSX.Element {
  const evidence = `${cause.evidence}${cause.statistic ? ` (${cause.statistic})` : ""}`;
  return (
    <li data-cause={cause.id} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "8px 0", borderTop: rank > 1 ? `1px solid ${color.subtle2}` : "none" }}>
      <span aria-hidden style={rankBadge}>{rank}</span>
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 3 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: fz.small, fontWeight: 650, color: color.ink }} title={`diagnose_fit: ${cause.detail}`}>{cause.title}</span>
            <InfoBadge text={<Paragraphs lines={[evidence, `→ ${cause.action}`, `diagnose_fit: ${cause.detail}`]} />} width={320} />
          </span>
          <ShareBar share={cause.share} />
        </div>
        <span title={evidence} style={{ fontSize: fz.small, lineHeight: 1.45, color: color.ink }}>{cause.summary}</span>
        <span title={cause.action} style={{ fontSize: fz.small, lineHeight: 1.45, color: color.secondary }}>
          <span aria-hidden style={{ color: color.primary, fontWeight: 600 }}>→ </span>{cause.todo}
        </span>
        {cause.buttons.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
            {cause.buttons.map((b) => <ActionChip key={b.label} button={b} onAction={onAction} />)}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ActionChip({ button, onAction }: { button: ActionButton; onAction: (a: ValidationAction) => void }): JSX.Element {
  return <button type="button" style={actionButton} title={button.title} onClick={() => onAction(button.action)}>{button.label}</button>;
}

/** A cause's share of χ²: a short bar and the percentage (approximate; causes can overlap). */
function ShareBar({ share }: { share: number }): JSX.Element {
  const f = Math.min(1, Math.max(0, share));
  return (
    <span title="Approximate share of χ² (causes can overlap)" style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "1 1 120px", maxWidth: 240, minWidth: 96 }}>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: color.chipBg, overflow: "hidden" }}>
        <span style={{ display: "block", width: `${Math.max(2, 100 * f)}%`, height: "100%", background: color.primary, borderRadius: 3 }} />
      </span>
      <span style={{ fontFamily: mono, fontSize: fz.small, color: color.ink, minWidth: 34, textAlign: "right" }}>{share < 0.005 ? "<1%" : `${Math.round(100 * share)}%`}</span>
    </span>
  );
}

// ── the evidence ───────────────────────────────────────────────────────────

function Disclosure({ id, title, summary, info, open, onToggle, last, children }: {
  id: EvidenceSection;
  title: string;
  summary?: string | undefined;
  info?: string;
  open: boolean;
  onToggle: () => void;
  last?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div id={`validation-${id}`} style={{ borderBottom: last ? "none" : `1px solid ${color.subtle2}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`validation-${id}-body`}
          onClick={onToggle}
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 8, rowGap: 0, padding: "8px 0", border: "none", background: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: color.ink }}
        >
          <span aria-hidden style={{ color: color.primary, fontSize: 12, width: 12 }}>{open ? "▾" : "▸"}</span>
          <span style={{ fontSize: fz.small, fontWeight: 650 }}>{title}</span>
          {summary ? <span style={{ fontSize: fz.micro, color: color.secondary, minWidth: 0 }}>{summary}</span> : null}
        </button>
        {info ? <InfoBadge text={info} width={300} align="right" /> : null}
      </div>
      {open ? <div id={`validation-${id}-body`} style={{ paddingBottom: 10 }}>{children}</div> : null}
    </div>
  );
}

function WorstPeaks({ worst, phaseColor, onLocate }: {
  worst: readonly ReflectionMisfit[];
  phaseColor: (id: string) => string;
  onLocate?: (row: ReflectionObsCalc) => void;
}): JSX.Element {
  const [all, setAll] = useState(false);
  const [boxRef, width] = useElementWidth(600);
  if (worst.length === 0) return <p style={caption}>No reflection list to attribute the misfit to.</p>;
  const rows = all ? worst : worst.slice(0, WORST_SHOWN);
  const phaseOf = (w: ReflectionMisfit): string => (w.row.kind === "magnetic" ? "magnetic" : w.row.phaseId ?? "");
  const ratio = (w: ReflectionMisfit): string => (w.row.iCalc > 0 ? (w.row.iObs / w.row.iCalc).toFixed(2) : "—");
  const view = (w: ReflectionMisfit): ReactNode => (onLocate ? <button type="button" style={{ ...linkButton, padding: 0 }} onClick={() => onLocate(w.row)}>view →</button> : null);
  const more = worst.length > WORST_SHOWN ? (
    <button type="button" style={{ ...linkButton, padding: 0, fontSize: fz.micro, marginTop: 4 }} onClick={() => setAll((v) => !v)}>
      {all ? "fewer" : `all ${worst.length}`}
    </button>
  ) : null;
  return (
    <div ref={boxRef}>
      {width < NARROW ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((w, i) => (
            <li key={`${w.row.phaseId}:${w.row.h},${w.row.k},${w.row.l}:${w.row.kind}`} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderTop: i > 0 ? `1px solid ${color.subtle2}` : "none", fontSize: fz.small }}>
              <Badge n={i + 1} />
              <div style={{ minWidth: 0, flex: 1, display: "flex", flexWrap: "wrap", columnGap: 10, rowGap: 1, alignItems: "baseline" }}>
                <span style={{ fontFamily: mono }}><Dot color={phaseColor(phaseOf(w))} />({w.row.h} {w.row.k} {w.row.l})</span>
                <span style={{ fontFamily: mono, color: color.secondary }}>d {w.row.d.toFixed(4)} Å</span>
                <span style={{ fontFamily: mono }}>{pct(w.share, 1)} of χ²</span>
                <span style={{ color: color.secondary }}>{SIGNATURE[w.signature]} · I_o/I_c {ratio(w)}</span>
                {view(w)}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Reflection</th>
              <th style={th}>d (Å)</th>
              <th style={th} title="Rietveld-partitioned I_obs over I_calc">I_o/I_c</th>
              <th style={th}>χ²</th>
              <th style={{ ...th, textAlign: "left" }}>Signature</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={`${w.row.phaseId}:${w.row.h},${w.row.k},${w.row.l}:${w.row.kind}`}>
                <td style={{ ...td, textAlign: "left" }}><Badge n={i + 1} /></td>
                <td style={{ ...td, textAlign: "left" }}><Dot color={phaseColor(phaseOf(w))} />({w.row.h} {w.row.k} {w.row.l})</td>
                <td style={td}>{w.row.d.toFixed(4)}</td>
                <td style={td}>{ratio(w)}</td>
                <td style={td}>{pct(w.share, 1)}</td>
                <td style={{ ...td, textAlign: "left", fontFamily: "inherit", color: color.secondary, whiteSpace: "normal" }}>{SIGNATURE[w.signature]}</td>
                <td style={td}>{view(w)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more}
    </div>
  );
}

function Dot({ color: c }: { color: string }): JSX.Element {
  return <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: c, marginRight: 6, verticalAlign: 0 }} />;
}

function Badge({ n }: { n: number }): JSX.Element {
  return <span style={{ display: "inline-flex", flex: "none", width: 17, height: 17, borderRadius: 999, background: color.flag, color: "#fff", fontSize: 10, fontWeight: 600, alignItems: "center", justifyContent: "center" }}>{n}</span>;
}

/** 1-2-5 ticks covering [lo, hi]. */
function niceTicks(lo: number, hi: number, target = 8): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9 * span; t += step) out.push(+t.toPrecision(12));
  return out;
}

const X0 = 46;
const DELTA_LIM = 8;
/** δ panel: centre line and px per σ (±DELTA_LIM spans 92 px). */
const D_MID = 56;
const D_SCALE = 5.75;
/** Room an axis label needs: the strip shows no more ticks than fit at this spacing. */
const TICK_SPACING = 80;

/**
 * δ = (y_obs − y_calc)/σ as a per-pixel min/max envelope with the ±3σ band,
 * the Bragg tick rows, and the cumulative χ² beneath, on the display axis.
 */
function ResidualStrip({ x, validation, include, toDisplay, displayLabel, phaseTicks, markers, onLocateX }: {
  x: readonly number[];
  validation: PowderValidation;
  include: readonly boolean[];
  toDisplay: (x: number) => number;
  displayLabel: string;
  phaseTicks: readonly PhaseTicks[];
  markers: readonly { n: number; x: number | undefined }[];
  onLocateX?: (x: number) => void;
}): JSX.Element {
  // Draw in true pixels: the strip keeps its height and its text size however
  // wide the card is (a fixed viewBox would scale both with the width).
  const [boxRef, W] = useElementWidth(900);
  const X1 = Math.max(X0 + 120, W - 12);
  const geom = useMemo(() => {
    const idx: number[] = [];
    const dx: number[] = [];
    for (let i = 0; i < x.length; i++) {
      if (!include[i] || Number.isNaN(validation.delta[i]!)) continue;
      const v = toDisplay(x[i]!);
      if (!Number.isFinite(v)) continue;
      idx.push(i);
      dx.push(v);
    }
    if (idx.length === 0) return null;
    const { min: lo, max: hi } = minMax(dx);
    const span = hi - lo || 1;
    const px = (v: number): number => X0 + ((v - lo) / span) * (X1 - X0);
    const cols = X1 - X0;
    const cMin = new Float64Array(cols).fill(Infinity);
    const cMax = new Float64Array(cols).fill(-Infinity);
    const cWorst = new Int32Array(cols).fill(-1);
    // Cumulative χ² in display order (left to right), whatever the native order.
    const order = idx.map((_, j) => j).sort((a, b) => dx[a]! - dx[b]!);
    const cum = new Float64Array(cols).fill(Number.NaN);
    const total = validation.chi2 || 1;
    let run = 0;
    for (const j of order) {
      const i = idx[j]!;
      const dl = validation.delta[i]!;
      run += dl * dl;
      const c = Math.min(cols - 1, Math.max(0, Math.floor(((dx[j]! - lo) / span) * cols)));
      if (dl < cMin[c]!) cMin[c] = dl;
      if (dl > cMax[c]!) cMax[c] = dl;
      if (cWorst[c]! < 0 || Math.abs(dl) > Math.abs(validation.delta[cWorst[c]!]!)) cWorst[c] = i;
      cum[c] = run / total;
    }
    // Carry the running total across empty columns.
    let last = 0;
    for (let c = 0; c < cols; c++) {
      if (Number.isNaN(cum[c]!)) cum[c] = last;
      else last = cum[c]!;
    }
    return { lo, hi, px, cMin, cMax, cWorst, cum, cols };
  }, [x, include, validation, toDisplay, X1]);

  if (!geom) return <p style={caption}>No fitted points.</p>;
  const { lo, hi, px, cMin, cMax, cWorst, cum, cols } = geom;
  const yD = (v: number): number => D_MID - Math.max(-DELTA_LIM, Math.min(DELTA_LIM, v)) * D_SCALE;
  const rows = phaseTicks.filter((p) => p.ticks.length > 0);
  const tickTop = yD(-DELTA_LIM) + 6;
  const cumTop = tickTop + rows.length * 10 + 10;
  const cumH = 40;
  const H = cumTop + cumH + 26;
  const yC = (f: number): number => cumTop + cumH - f * (cumH - 4);

  let env = "";
  for (let c = 0; c < cols; c++) {
    if (cMin[c]! === Infinity) continue;
    const xx = (X0 + c + 0.5).toFixed(1);
    const a = yD(cMax[c]!);
    const b = Math.max(yD(cMin[c]!), a + 0.8);
    env += `M${xx} ${a.toFixed(1)}V${b.toFixed(1)}`;
  }
  let cumPath = "";
  for (let c = 0; c < cols; c++) cumPath += `${c === 0 ? "M" : "L"}${(X0 + c + 0.5).toFixed(1)} ${yC(cum[c]!).toFixed(1)}`;
  const colOf = (v: number): number => Math.min(cols - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo || 1)) * cols)));

  const onClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (!onLocateX) return;
    const at = clientToSvgUser(e.currentTarget, e.clientX, e.clientY, { width: W, height: H });
    if (at.x < X0 || at.x > X1) return;
    // The worst point within a few pixels of the click.
    const c0 = Math.floor(at.x - X0);
    let best = -1;
    for (let c = Math.max(0, c0 - 3); c <= Math.min(cols - 1, c0 + 3); c++) {
      const i = cWorst[c]!;
      if (i >= 0 && (best < 0 || Math.abs(validation.delta[i]!) > Math.abs(validation.delta[best]!))) best = i;
    }
    if (best >= 0) onLocateX(x[best]!);
  };

  // As many axis labels as fit: a phone-wide strip would print them over each other.
  const ticks = niceTicks(lo, hi, tickCountFor(X1 - X0, TICK_SPACING, 2, 8));

  return (
    <div ref={boxRef}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: "100%", height: H, display: "block", cursor: onLocateX ? "pointer" : undefined }} role="img" aria-label="Normalized residual and cumulative chi-square along the pattern" onClick={onClick}>
      <rect x={X0} y={yD(3)} width={X1 - X0} height={yD(-3) - yD(3)} fill={color.chipBg} />
      <line x1={X0} y1={D_MID} x2={X1} y2={D_MID} stroke={color.control} strokeWidth={1} />
      <line x1={X0} y1={yD(DELTA_LIM)} x2={X0} y2={yD(-DELTA_LIM)} stroke={color.border} strokeWidth={1} />
      <path d={env} stroke={color.ink} strokeWidth={1} opacity={0.75} />
      <g fontSize={10} fill={color.secondary} fontFamily={mono} textAnchor="end">
        <text x={X0 - 5} y={yD(3) + 3.5}>+3</text>
        <text x={X0 - 5} y={D_MID + 3.5}>0</text>
        <text x={X0 - 5} y={yD(-3) + 3.5}>−3</text>
        <text x={X0 - 5} y={yD(DELTA_LIM) + 3.5}>+{DELTA_LIM}</text>
        <text x={X0 - 5} y={yD(-DELTA_LIM) + 3.5}>−{DELTA_LIM}</text>
      </g>
      <text x={12} y={D_MID} textAnchor="middle" fontSize={11} fill={color.secondary} transform={`rotate(-90 12 ${D_MID})`}>Δ/σ</text>

      {rows.map((p, r) => {
        const y = tickTop + r * 10;
        let path = "";
        for (const t of p.ticks) if (t.x >= lo && t.x <= hi) path += `M${px(t.x).toFixed(1)} ${y}v7`;
        return (
          <g key={p.id}>
            <path d={path} stroke={p.color} strokeWidth={1} />
            <text x={X0 - 5} y={y + 7} textAnchor="end" fontSize={9} fontFamily={mono} fill={color.secondary}>{p.label.length > 7 ? `${p.label.slice(0, 6)}…` : p.label}</text>
          </g>
        );
      })}

      <line x1={X0} y1={cumTop + cumH} x2={X1} y2={cumTop + cumH} stroke={color.control} strokeWidth={1} />
      <line x1={X0} y1={yC(1)} x2={X1} y2={yC(1)} stroke={color.subtle} strokeWidth={1} strokeDasharray="2 4" />
      <path d={cumPath} fill="none" stroke={color.primary} strokeWidth={1.6} strokeLinejoin="round" />
      <g fontSize={10} fill={color.secondary} fontFamily={mono} textAnchor="end">
        <text x={X0 - 5} y={yC(1) + 3.5}>100%</text>
        <text x={X0 - 5} y={cumTop + cumH + 3.5}>0</text>
      </g>
      <text x={12} y={cumTop + cumH / 2} textAnchor="middle" fontSize={11} fill={color.secondary} transform={`rotate(-90 12 ${cumTop + cumH / 2})`}>cum. χ²</text>

      {markers.map((m) => {
        if (m.x === undefined || m.x < lo || m.x > hi) return null;
        const xx = px(m.x);
        const f = cum[Math.min(cols - 1, colOf(m.x) + 2)]!;
        const cy = Math.max(cumTop + 1, yC(f) - 9);
        return (
          <g key={m.n} pointerEvents="none">
            <circle cx={xx} cy={cy} r={6.5} fill={color.flag} />
            <text x={xx} y={cy + 3.2} textAnchor="middle" fontSize={9} fontWeight={600} fill="#fff" fontFamily={mono}>{m.n}</text>
          </g>
        );
      })}

      <g fontSize={10} fill={color.secondary} fontFamily={mono} textAnchor="middle">
        {ticks.map((t) => (
          <text key={t} x={px(t)} y={H - 12}>{+t.toPrecision(6)}</text>
        ))}
      </g>
      <text x={X1} y={H - 1} textAnchor="end" fontSize={10} fill={color.secondary}>{displayLabel}</text>
    </svg>
    </div>
  );
}

const note: CSSProperties = { margin: 0, fontSize: fz.small, lineHeight: 1.5, color: color.secondary };

/** A small outlined action (open a group, show the pattern, a bundle). */
const actionButton: CSSProperties = {
  border: `1px solid ${color.primaryTintBorder}`,
  background: color.primaryTintBg,
  color: color.primary,
  borderRadius: 999,
  padding: "2px 10px",
  fontSize: fz.micro,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  lineHeight: 1.5,
};

const rankBadge: CSSProperties = {
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  marginTop: 0,
  borderRadius: 999,
  border: `1px solid ${color.control}`,
  background: color.surface,
  color: color.secondary,
  fontFamily: mono,
  fontSize: 11,
  fontWeight: 600,
};
