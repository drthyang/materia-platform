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
import type { ProjectHistory } from "@/core/project/history";
import { assess_refinement, bond_geometry, interpret_structure, suggest_next_steps } from "@/mcp/tools";
import { structureTable } from "@/agent/structureTable";
import { bondsOf, cellOf, historyView, matchIds, parameterSummary, pct, sig, type LiveToolHost } from "@/agent/liveCommon";
import { change, freePlan, goToPlan, nothing, refinePlan, resetPlan, type Plans } from "@/agent/pages/plans";
import { boxShell, boxcarStepIndex, boxcarWindows, followBond, type BoxcarRun } from "@/core/workflow/pdfBoxcar";
import type { RefinementResult } from "@/core/refinement/types";
import type { ReportCheck } from "@/core/export/report";
import { coordinationShells, type ShellBond } from "@/core/crystal/geometry";
import { pdfPhaseBindingsFor } from "@/core/workflow/pdf";
import { CORRELATION_LISTED, bondValenceCheck, boundsCheck, convergenceCheck, correlationsCheck, findingChecks, noResultCheck } from "@/agent/reportChecks";
import type { ReferenceEntry } from "@/agent/references";

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
      if (input.against !== undefined) throw new Error("`against` is on the single-crystal page only, for now");
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
 * The page's changes, one plan each (pages/plans.ts): what the approval card
 * says, and the change through the page's own handler. A change that cannot
 * run on this page is refused here, before its card.
 */
export const PDF_PLANS: Plans<PdfAgentPort> = {
  set_free: freePlan,
  set_adp_model: (input, s, port) => {
    if (s.adpModel === (input.anisotropic ? "anisotropic" : "isotropic")) return nothing(`the ADPs are already ${s.adpModel}`);
    return change(`ADPs ${s.adpModel} → ${input.anisotropic ? "anisotropic (U tensor per site)" : "isotropic (one U per site)"}`, () => {
      port.setAdpModel(!!input.anisotropic);
      return undefined;
    });
  },
  set_fit_range: (input, s, port) => {
    if (input.unit !== undefined) throw new Error("the PDF page fits a window in r (Å); leave out `unit`");
    if (input.whole) {
      return change(`Fit the default window, r ${sig(s.defaultRange.min, 4)} – ${sig(s.defaultRange.max, 4)} Å`, () => {
        port.setFitRange(null);
        return undefined;
      });
    }
    const min = input.min ?? s.fitRange.min;
    const max = input.max ?? s.fitRange.max;
    if (!(max > min)) throw new Error(`the window needs max > min (got ${min}–${max} Å)`);
    if (max < s.extent.min || min > s.extent.max) throw new Error(`${min}–${max} Å is outside the data (${sig(s.extent.min, 5)}–${sig(s.extent.max, 5)} Å)`);
    return change(`Fit window r ${String(input.min ?? sig(s.fitRange.min, 4))} – ${String(input.max ?? sig(s.fitRange.max, 4))} Å`, () => {
      port.setFitRange({ min: Math.max(min, s.extent.min), max: Math.min(max, s.extent.max) });
      return undefined;
    });
  },
  refine: refinePlan<PdfAgentPort>({
    fits: (s, free) => `Refine ${s.spinModel ? "nuclear + magnetic G(r)" : "G(r)"}, ${free} free parameter${free === 1 ? "" : "s"}`,
  }),
  boxcar_scan: (input, s, port) => {
    // matchIds refuses a pattern that matches nothing; tied rows follow their tie and are not offered.
    const free = input.free ? matchIds(s.parameters.filter((p) => !p.expression), input.free) : null;
    if (!free && !s.parameters.some((p) => !p.fixed && !p.expression)) throw new Error("no parameter is free — free the ones to track with set_free first, or pass `free`");
    const sites = input.bonds ?? [];
    const phase = s.phases[0]!;
    const labels = phase.sites.map((site) => site.label);
    const unknown = sites.filter((l) => !labels.includes(l));
    if (unknown.length) throw new Error(`no site ${unknown.join(", ")} in ${phase.name || "the primary phase"} — its sites: ${labels.join(", ")}`);
    const cations = coordinationShells(s.refinedPhases[0]!).map((sh) => sh.site);
    const anion = sites.filter((l) => !cations.includes(l));
    if (anion.length) throw new Error(`${anion.join(", ")} has no coordination shell of its own (an anion): name the cation whose bonds to track — ${cations.join(", ")}`);
    const width = input.width ?? 5;
    const step = input.step ?? 1;
    const boxes = boxcarWindows({ range: s.fitRange, width, step }).length;
    const count = free ? free.length : s.parameters.filter((p) => !p.fixed && !p.expression).length;
    const restarts = input.restarts ?? 0;
    const preview = `Boxcar scan: ${boxes} boxes of ${width} Å every ${step} Å across r ${sig(s.fitRange.min, 4)} – ${sig(s.fitRange.max, 4)} Å, ${count} free parameters${input.direction === "both" ? ", both directions" : input.direction === "down" ? ", high → low r" : ""}${restarts > 0 ? `, best of ${restarts + 1} starts per box` : ""}`;
    return change(preview, async () => {
      const run = await port.boxcar({ width, step, direction: input.direction ?? "up", restarts, ...(sites.length ? { bonds: sites } : {}), ...(free ? { free } : {}) });
      if (!run) return "The scan did not finish (cancelled, failed, or the model changed while it ran).";
      return { note: boxcarLine(run), data: boxcarView(run, s, sites) };
    });
  },
  reset_parameters: resetPlan,
  go_to_step: goToPlan,
};

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

/** The numbers the Agent quotes by reference on the PDF page ({{Rw}}, {{verdict}}; {{p:ID}} for any row). */
export function pdfReferences(s: PdfLiveState): ReferenceEntry[] {
  return [
    { key: "Rw", what: "Rw (%) of the curves on screen", value: () => `${pct(s.rw)} %` },
    { key: "verdict", what: "the engine's verdict on the last refinement (its band: convergence, no GoF on a PDF)", value: () => (s.result ? assessment(s).verdict.band : null) },
  ];
}

/**
 * The assessment in real space (its PDF mode leaves out the GoF, which uniform
 * weights make meaningless), with no residual passed: its peak scan works in
 * d-spacing, on Bragg peaks.
 */
function assessment(s: PdfLiveState): ReturnType<typeof assess_refinement> & { convention: string } {
  if (!s.result) throw new Error("there is no refinement result on screen — refine first (a model change clears the last result)");
  const out = assess_refinement({
    result: s.result,
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
        esds: Object.fromEntries(run.freeIds.map((id) => [id, sig(step.result.esd[id] ?? NaN, 2)])),
        _esd: step.result.esd,
        _values: step.result.parameters,
        ...(bonds ? { bonds: Object.fromEntries(Object.entries(bonds).map(([site, list]) => [site, list.map((b) => `${b.to} ${b.distance.toFixed(4)}${b.count > 1 ? ` ×${b.count}` : ""}`)])) } : {}),
        _bonds: bonds,
      };
    }).filter((b) => b !== null);
    const spread = Object.fromEntries(run.freeIds.map((id) => {
      const v = boxes.map((b) => b.values[id] as number).filter(Number.isFinite);
      const lo = Math.min(...v);
      const hi = Math.max(...v);
      // The first box against the last, in the esd of their difference (apart, they share no data).
      const [a, b] = [boxes[0], boxes.at(-1)];
      const sd = a && b ? Math.hypot(a._esd[id] ?? NaN, b._esd[id] ?? NaN) : NaN;
      const drift = a && b && sd > 0 ? ((b._values[id] ?? NaN) - (a._values[id] ?? NaN)) / sd : NaN;
      return [id, { label: label.get(id) ?? id, first: v[0], last: v.at(-1), min: lo, max: hi, ...(Number.isFinite(drift) ? { driftInEsds: sig(drift, 2) } : {}) }];
    }));
    // Each bond of the first box, followed through the boxes by its rank in the site's list.
    const bondSpread: Record<string, { first: number; last: number; min: number; max: number }> = {};
    for (const site of sites) {
      const firstShell = boxes[0]?._bonds?.[site] ?? [];
      firstShell.forEach((b, k) => {
        // Each bond followed by the neighbour image it reaches, not by its rank in the box's shell.
        const v = boxes.map((box) => followBond(b, firstShell, box._bonds?.[site] ?? [])?.distance).filter((d): d is number => d !== undefined);
        bondSpread[`${site}–${b.to}${b.count > 1 ? ` ×${b.count}` : ""} #${k + 1}`] = { first: sig(v[0]!, 5), last: sig(v.at(-1)!, 5), min: sig(Math.min(...v), 5), max: sig(Math.max(...v), 5) };
      });
    }
    return { direction: series.direction, boxes: boxes.map(({ _bonds: _b, _esd: _e, _values: _v, ...box }) => box), spread, ...(sites.length ? { bondSpread } : {}) };
  });
  return {
    boxcar: { width: run.width, boxes: run.windows.length, restarts: run.restarts, passes },
    reading: "Rw and a parameter that drift together across r mean the model fits some length scales and not others: compare the low-r boxes (the local structure) with the high-r ones (the average). Each box's values carry its fit's esds (`esds`), and `driftInEsds` is a parameter's change from the first box to the last over the esd of that difference. A PDF's points are correlated and it has no GoF, so these esds understate the uncertainty: read a drift of a few esds against the scatter from box to box as well, and a drift of tens as real." +
      (run.restarts > 0 ? ` Each box kept the best of ${run.restarts + 1} starts.` : "") +
      (sites.length ? " The bond lengths are each box's refined structure (Å) and carry no esds: judge their drift against the spread from box to box." : ""),
  };
}

/** The card's outcome line: the scan's Rw at low and high r. */
function boxcarLine(run: BoxcarRun): string {
  const series = run.series[0];
  const first = series && boxAt(run, series, 0);
  const last = series && boxAt(run, series, run.windows.length - 1);
  // From the fraction: pct() rounds to two decimals, and rounding that again to one can land on the wrong side.
  const rw = (step: typeof first): string => (step ? `${(100 * (step.result.agreement.rWeighted ?? NaN)).toFixed(1)}%` : "?");
  return `${run.windows.length} boxes · Rw ${rw(first)} at low r → ${rw(last)} at high r`;
}
