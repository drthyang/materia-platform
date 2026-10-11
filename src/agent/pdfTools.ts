/**
 * The Agent tools on the PDF page: each one reads the live state through the
 * page's port (port.ts) or calls the page's own handler, as on the powder
 * page (powderTools.ts). The analysis tools are the MATERIA MCP handlers that
 * hold in real space: the assessment (without its GoF verdict and its
 * Bragg-peak scan), the next-step ranking built on it, bond geometry and the
 * structure read.
 *
 * A PDF fit weights every G(r) point equally (core/workflow/pdf.ts): Rw is a
 * relative measure, there is no GoF, and the esds are not statistical. The
 * answers say so, so a model does not read them as a Rietveld fit's.
 */

import type { PdfAgentPort, PdfLiveState } from "@/agent/port";
import type { LiveToolSpec } from "@/agent/tools";
import type { ProjectHistory } from "@/core/project/history";
import { assess_refinement, bond_geometry, interpret_structure, suggest_next_steps } from "@/mcp/tools";
import { structureTable } from "@/agent/structureTable";
import { applyFree, bondsOf, cellOf, describeFree, freeNoOp, goToStep, historyView, matchIds, parameterSummary, pct, sig, type ChangeResult, type LiveToolHost } from "@/agent/liveCommon";
import { boxShell, boxcarStepIndex, boxcarWindows, type BoxcarRun } from "@/core/workflow/pdfBoxcar";
import type { RefinementResult } from "@/core/refinement/types";
import type { ReportCheck } from "@/core/export/report";
import { coordinationShells, type ShellBond } from "@/core/crystal/geometry";
import { pdfPhaseBindingsFor } from "@/core/workflow/pdf";
import { CORRELATION_LISTED, bondValenceCheck, boundsCheck, convergenceCheck, correlationsCheck, findingChecks, noResultCheck } from "@/agent/reportChecks";

/* eslint-disable @typescript-eslint/no-explicit-any -- inputs are validated against the spec's zod schema before a handler runs */
type Input = any;

/** What every PDF answer says about its numbers. */
export const PDF_CONVENTION =
  "PDF fit: uniform weights over G(r), so Rw is a relative measure, there is no GoF, and the esds are not statistical.";

/** Run a read tool. Returns the JSON result the model sees. */
export function readPdfTool(name: string, input: Input, port: PdfAgentPort, host: LiveToolHost): unknown {
  const s = port.state();
  switch (name) {
    case "get_state":
      return stateView(s, host.history(), input.parameters);
    case "assess_refinement":
      return assessment(s);
    case "suggest_next_steps":
      return { steps: suggest_next_steps({ assessment: assessment(s) }) };
    case "structure_table":
      return { phases: s.refinedPhases.map((ph, k) => structureTable(ph, k, s.parameters, s.bindings, s.result?.esd ?? {})), ...(s.result ? {} : { note: "No refinement on screen: the values carry no esds." }) };
    case "bond_geometry":
      return bondsOf(s.refinedPhases, input, bond_geometry);
    case "interpret_structure":
      return interpret_structure({
        structure: s.refinedPhases[0]!,
        parameters: [...s.parameters],
        ...(s.result ? { esd: { ...s.result.esd } } : {}),
        magnetic: null,
      });
    default:
      throw new Error(`${name} is not a PDF read tool`);
  }
}

/**
 * Make a change on the page. Returns a note for the model when the change
 * needed adjusting (tied parameters skipped) or did not finish.
 */
export async function changePdf(name: string, input: Input, port: PdfAgentPort, host: LiveToolHost): Promise<ChangeResult> {
  const s = port.state();
  switch (name) {
    case "set_free":
      return applyFree(s.parameters, input, port.setFixed);
    case "set_adp_model":
      port.setAdpModel(!!input.anisotropic);
      return undefined;
    case "set_fit_range": {
      if (input.unit !== undefined) throw new Error("the PDF page fits a window in r (Å); leave out `unit`");
      if (input.whole) {
        port.setFitRange(null);
        return undefined;
      }
      const min = input.min ?? s.fitRange.min;
      const max = input.max ?? s.fitRange.max;
      if (!(max > min)) throw new Error(`the window needs max > min (got ${min}–${max} Å)`);
      if (max < s.extent.min || min > s.extent.max) throw new Error(`${min}–${max} Å is outside the data (${sig(s.extent.min, 5)}–${sig(s.extent.max, 5)} Å)`);
      port.setFitRange({ min: Math.max(min, s.extent.min), max: Math.min(max, s.extent.max) });
      return undefined;
    }
    case "refine": {
      if (!s.parameters.some((p) => !p.fixed && !p.expression)) throw new Error("no parameter is free — free some with set_free first");
      const why = await (input.mode === "thorough" ? port.thorough() : port.refine());
      return why ? `The refinement did not finish (${why}); the parameters keep their values from before it.` : undefined;
    }
    case "boxcar_scan": {
      // matchIds refuses a pattern that matches nothing; tied rows follow their tie and are not offered.
      const free = input.free ? matchIds(s.parameters.filter((p) => !p.expression), input.free as string[]) : null;
      if (!free && !s.parameters.some((p) => !p.fixed && !p.expression)) throw new Error("no parameter is free — free the ones to track with set_free first, or pass `free`");
      const sites = (input.bonds as string[] | undefined) ?? [];
      const phase = s.phases[0]!;
      const labels = phase.sites.map((site) => site.label);
      const unknown = sites.filter((l) => !labels.includes(l));
      if (unknown.length) throw new Error(`no site ${unknown.join(", ")} in ${phase.name || "the primary phase"} — its sites: ${labels.join(", ")}`);
      const cations = coordinationShells(s.refinedPhases[0]!).map((sh) => sh.site);
      const anion = sites.filter((l) => !cations.includes(l));
      if (anion.length) throw new Error(`${anion.join(", ")} has no coordination shell of its own (an anion): name the cation whose bonds to track — ${cations.join(", ")}`);
      const run = await port.boxcar({ width: input.width ?? 5, step: input.step ?? 1, direction: input.direction ?? "up", ...(sites.length ? { bonds: sites } : {}), ...(free ? { free } : {}) });
      if (!run) return "The scan did not finish (cancelled, failed, or the model changed while it ran).";
      return { note: boxcarLine(run), data: boxcarView(run, s, sites) };
    }
    case "reset_parameters":
      port.reset(input.parameters ? matchIds(s.parameters, input.parameters as string[]) : undefined);
      return undefined;
    case "go_to_step":
      goToStep(host, input.step);
      return undefined;
    default:
      throw new Error(`${name} is not a PDF change tool`);
  }
}

/** Why a change would do nothing, or null when it would do something. */
export function pdfNoOp(spec: LiveToolSpec, input: Input, s: PdfLiveState): string | null {
  if (spec.name === "set_adp_model") return s.adpModel === (input.anisotropic ? "anisotropic" : "isotropic") ? `the ADPs are already ${s.adpModel}` : null;
  return spec.name === "set_free" ? freeNoOp(s.parameters, input) : null;
}

/** One line for the approval card: what this change will do, in the page's terms. */
export function describePdfChange(spec: LiveToolSpec, input: Input, s: PdfLiveState): string {
  switch (spec.name) {
    case "boxcar_scan": {
      const width = input.width ?? 5;
      const step = input.step ?? 1;
      const boxes = boxcarWindows({ range: s.fitRange, width, step }).length;
      const free = input.free ? matchIds(s.parameters.filter((p) => !p.expression), input.free as string[]).length : s.parameters.filter((p) => !p.fixed && !p.expression).length;
      return `Boxcar scan: ${boxes} boxes of ${width} Å every ${step} Å across r ${sig(s.fitRange.min, 4)} – ${sig(s.fitRange.max, 4)} Å, ${free} free parameters${input.direction === "both" ? ", both directions" : input.direction === "down" ? ", high → low r" : ""}`;
    }
    case "set_free":
      return describeFree(s.parameters, input);
    case "set_adp_model":
      return `ADPs ${s.adpModel} → ${input.anisotropic ? "anisotropic (U tensor per site)" : "isotropic (one U per site)"}`;
    case "set_fit_range":
      return input.whole
        ? `Fit the default window, r ${sig(s.defaultRange.min, 4)} – ${sig(s.defaultRange.max, 4)} Å`
        : `Fit window r ${String(input.min ?? sig(s.fitRange.min, 4))} – ${String(input.max ?? sig(s.fitRange.max, 4))} Å`;
    case "refine": {
      const free = s.parameters.filter((p) => !p.fixed && !p.expression).length;
      const what = s.spinModel ? "nuclear + magnetic G(r)" : "G(r)";
      return input.mode === "thorough"
        ? `${s.result ? "Escape minimum" : "Prefit"} (multi-start) on ${free} free parameter${free === 1 ? "" : "s"}`
        : `Refine ${what}, ${free} free parameter${free === 1 ? "" : "s"}`;
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

function stateView(s: PdfLiveState, history: ProjectHistory | null, select: readonly string[] | undefined): Record<string, unknown> {
  const p = s.pattern;
  return {
    technique: "pdf",
    source: s.source,
    busy: s.busy,
    phases: s.phases.map((ph, i) => {
      const refined = s.refinedPhases[i] ?? ph;
      return { id: ph.id, name: ph.name, spaceGroup: ph.spaceGroup.hermannMauguin, cell: cellOf(refined), sites: ph.sites.map((site) => `${site.label} ${site.element}`) };
    }),
    data: {
      points: p.points.length,
      axis: "r (Å)",
      extent: [sig(s.extent.min, 5), sig(s.extent.max, 5)],
      fitWindow: [sig(s.fitRange.min, 5), sig(s.fitRange.max, 5)],
      defaultWindow: [sig(s.defaultRange.min, 5), sig(s.defaultRange.max, 5)],
      observations: s.observationCount,
      radiation: p.radiationAssumed ? `${p.scatteringType} (assumed: the file names none)` : p.scatteringType,
      ...(p.qmax !== undefined ? { qmax: p.qmax } : {}),
    },
    positions: s.positionMode === "irreps" ? "symmetry-mode amplitudes (irreps)" : "constrained atomic coordinates",
    adp: s.adpModel === "anisotropic" ? "anisotropic (U tensor per site)" : s.adpModel === "isotropic" ? "isotropic (one U per site)" : "mixed (isotropic and anisotropic sites)",
    spinModel: s.spinModel ? "applied: refine fits nuclear + magnetic G(r)" : null,
    Rw: pct(s.rw),
    lastRefinement: s.result
      ? {
          status: s.result.status,
          Rw: pct(s.result.agreement.rWeighted ?? 0),
          iterations: s.result.history.length,
          ...(s.result.diagnostics ? { maxShiftOverEsd: sig(s.result.diagnostics.maxShiftOverEsd, 3), atBounds: s.result.diagnostics.atBounds.map((b) => b.parameterId) } : {}),
          ...(s.result.message ? { message: s.result.message } : {}),
        }
      : null,
    ...(s.warnings.length ? { warnings: s.warnings } : {}),
    convention: PDF_CONVENTION,
    ...parameterSummary(s.parameters, s.result?.esd, select),
    history: historyView(history),
  };
}

// ── analysis helpers ────────────────────────────────────────────────────────

/**
 * The MCP assessment, read for real space: the GoF (and the expected R it is
 * formed from) is dropped, since uniform weights make it meaningless, and no
 * residual is passed — its peak scan works in d-spacing, on Bragg peaks.
 */
function assessment(s: PdfLiveState): ReturnType<typeof assess_refinement> & { convention: string } {
  if (!s.result) throw new Error("there is no refinement result on screen — refine first (a model change clears the last result)");
  const { goodnessOfFit: _gof, rExpected: _rExp, ...agreement } = s.result.agreement;
  const out = assess_refinement({
    result: { ...s.result, agreement },
    parameters: [...s.parameters],
    observationCount: s.observationCount,
    mode: "pdf",
    restraints: s.restraints,
  });
  return { ...out, convention: `${PDF_CONVENTION} The verdict reads convergence only; wRPercent is Rw. No residual-peak scan in real space.` };
}

/**
 * The engine's checks of the fit on screen, for the Agent's report: the
 * convergence, correlations, bounds, the bond-valence sums, the page's own
 * warnings and the assessment's other findings. No GoF verdict and no
 * residual-peak scan: G(r) points are equally weighted and Fourier-correlated.
 */
export function pdfReportChecks(s: PdfLiveState, probe: RefinementResult | null = null): ReportCheck[] {
  if (!s.result) return [noResultCheck()];
  const checks: ReportCheck[] = [
    convergenceCheck(s.result),
    { name: "Agreement", status: "note", detail: `Rw = ${(100 * s.rw).toFixed(2)} % over r ${s.fitRange.min.toFixed(2)}–${s.fitRange.max.toFixed(2)} Å. ${PDF_CONVENTION}` },
    probe ? correlationsCheck(probe, s.parameters, s.restraints) : correlationsCheck(s.result, s.parameters, s.restraints, CORRELATION_LISTED),
    boundsCheck(s.result, s.parameters),
  ];
  const bv = bondValenceCheck(s.refinedPhases);
  if (bv) checks.push(bv);
  for (const w of s.warnings) checks.push({ name: "Page warning", status: "warn", detail: w });
  checks.push(...findingChecks(assessment(s)));
  return checks;
}

/** One box of a scan, in the run's ascending window order. */
function boxAt(run: BoxcarRun, series: BoxcarRun["series"][number], i: number): BoxcarRun["series"][number]["result"]["steps"][number] | undefined {
  return series.result.steps[boxcarStepIndex(series.direction, i, run.windows.length, series.result.steps.length)];
}

/**
 * The scan as the model reads it: per box its window, Rw and the free values;
 * per parameter its spread. With `sites`, each box also gives those sites'
 * bond lengths in the structure that box refined, and each bond its spread
 * across the boxes — the local geometry box by box, computed rather than
 * worked out from coordinate shifts.
 */
function boxcarView(run: BoxcarRun, s: PdfLiveState, sites: readonly string[]): Record<string, unknown> {
  const label = new Map(s.parameters.map((p) => [p.id, p.label]));
  const phase = s.phases[0]!;
  const bindings = s.phases.length > 1 ? pdfPhaseBindingsFor(s.bindings, phase.id) : s.bindings;
  const bondsIn = (values: Readonly<Record<string, number>>): Record<string, readonly ShellBond[]> =>
    Object.fromEntries(sites.map((site) => [site, boxShell(phase, bindings, s.parameters, values, site) ?? []]));
  const passes = run.series.map((series) => {
    const boxes = run.windows.map((w, i) => {
      const step = boxAt(run, series, i);
      if (!step) return null;
      const bonds = sites.length ? bondsIn(step.result.parameters) : null;
      return {
        r: [sig(w.min, 4), sig(w.max, 4)],
        Rw: pct(step.result.agreement.rWeighted ?? NaN),
        ...(step.carried ? {} : { diverged: true }),
        values: Object.fromEntries(run.freeIds.map((id) => [id, sig(step.result.parameters[id] ?? NaN, 5)])),
        ...(bonds ? { bonds: Object.fromEntries(Object.entries(bonds).map(([site, list]) => [site, list.map((b) => `${b.to} ${b.distance.toFixed(4)}${b.count > 1 ? ` ×${b.count}` : ""}`)])) } : {}),
        _bonds: bonds,
      };
    }).filter((b) => b !== null);
    const spread = Object.fromEntries(run.freeIds.map((id) => {
      const v = boxes.map((b) => b.values[id] as number).filter(Number.isFinite);
      const lo = Math.min(...v);
      const hi = Math.max(...v);
      return [id, { label: label.get(id) ?? id, first: v[0], last: v.at(-1), min: lo, max: hi }];
    }));
    // Each bond of the first box, followed through the boxes by its rank in the site's list.
    const bondSpread: Record<string, { first: number; last: number; min: number; max: number }> = {};
    for (const site of sites) {
      (boxes[0]?._bonds?.[site] ?? []).forEach((b, k) => {
        const v = boxes.map((box) => box._bonds?.[site]?.[k]?.distance).filter((d): d is number => d !== undefined);
        bondSpread[`${site}–${b.to}${b.count > 1 ? ` ×${b.count}` : ""} #${k + 1}`] = { first: sig(v[0]!, 5), last: sig(v.at(-1)!, 5), min: sig(Math.min(...v), 5), max: sig(Math.max(...v), 5) };
      });
    }
    return { direction: series.direction, boxes: boxes.map(({ _bonds: _drop, ...box }) => box), spread, ...(sites.length ? { bondSpread } : {}) };
  });
  return {
    boxcar: { width: run.width, boxes: run.windows.length, passes },
    reading: "Rw and a parameter that drift together across r mean the model fits some length scales and not others: compare the low-r boxes (the local structure) with the high-r ones (the average)." +
      (sites.length ? " The bond lengths are each box's refined structure (Å); the scan gives no esds, so judge a drift against the spread from box to box." : ""),
  };
}

/** The card's outcome line: the scan's Rw at low and high r. */
function boxcarLine(run: BoxcarRun): string {
  const series = run.series[0];
  const first = series && boxAt(run, series, 0);
  const last = series && boxAt(run, series, run.windows.length - 1);
  const rw = (step: typeof first): string => (step ? `${pct(step.result.agreement.rWeighted ?? NaN).toFixed(1)}%` : "?");
  return `${run.windows.length} boxes · Rw ${rw(first)} at low r → ${rw(last)} at high r`;
}
