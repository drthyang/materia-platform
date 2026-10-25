/**
 * The refinement report as Markdown in its layout of 2026-10-24 (b525ac2),
 * FROZEN for the Agent validation. Two things read this text and must not
 * move while the validation runs:
 *
 * - the number audit of the Agent's account (agent/report.ts): the account's
 *   numbers are matched against this text, and write_report returns the ones
 *   that match nothing to the model;
 * - the evals and the validation's scoring, which read the reports the Agent
 *   writes (AgentReport.markdown) for the faults it names.
 *
 * The report people read and save is reportHtml / reportMarkdown, whose
 * layout moves on. This module keeps its own copies of the helpers it used
 * then, so a change to theirs leaves it byte for byte as it was;
 * reportMarkdownFrozen.test.ts holds it to saved goldens. Change nothing here
 * until the validation freeze is lifted; then retire it for reportMarkdown.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { ParameterKind, RefinementParameter } from "@/core/refinement/types";
import { buildEsdMap, cellEsdsOf, cellVolume, formatWithEsd } from "@/core/export/cif";
import { spaceGroupSymbol } from "@/core/crystal/spaceGroups";
import { crystalComponentsToCartesian } from "@/core/magnetic/moment";
import { kLabel } from "@/core/magnetic/kSearch";
import { magneticSupercell, momentAnchorPosition } from "@/core/crystal/cellExpansion";
import { fobsFcalcSvg, patternFigureSvg } from "@/core/export/reportFigures";
import { markNumbers } from "@/core/export/reportAudit";
import type { ReportAgent, ReportBond, ReportBoxcar, ReportCheck, ReportFigure, ReportInput, ReportMagnetic, ReportPhase, ReportPosterior, ReportRow, ReportTechnique } from "@/core/export/report";
import { coordinationShells } from "@/core/crystal/geometry";
import { uEquivalent } from "@/core/crystal/adp";

const TECHNIQUE_TITLE: Record<ReportInput["technique"], string> = {
  powder: "Rietveld refinement",
  singleCrystal: "Single-crystal refinement",
  pdf: "PDF refinement",
};

/** A table cell: no pipes or line breaks to break the row. */
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

function table(head: readonly string[], rows: readonly (readonly string[])[], align?: readonly ("l" | "r")[]): string {
  const sep = head.map((_, i) => (align?.[i] === "r" ? "---:" : "---"));
  return [`| ${head.map(cell).join(" | ")} |`, `| ${sep.join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

function kvTable(rows: readonly ReportRow[]): string {
  return table(["", ""], rows.map((r) => [`**${r.label}**`, r.value]));
}

const fixed = (v: number, d: number): string => {
  const s = v.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
};

// ---------------------------------------------------------------------------
// The helpers of report.ts as they were, copied so the layout stays frozen

/** "Before the Copilot's first refinement: wR2 25.61 %, R1 12.34 %." */
function startText(start: NonNullable<ReportAgent["start"]>, label: string): string {
  return `Before the Copilot's first refinement: ${label} ${(100 * start.agreement).toFixed(2)} %${start.r1 !== undefined ? `, R1 ${(100 * start.r1).toFixed(2)} %` : ""}.`;
}

/** Significant-figure formatting that never prints "1e-7"-style exponents for ordinary values. */
function reportSig(v: number, digits = 5): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(Math.max(1, digits - 1));
  const d = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
  return fixed(v, Math.min(d, 8));
}

const EIGHT_PI2 = 8 * Math.PI * Math.PI;

const KIND_DECIMALS: Partial<Record<ParameterKind, number>> = {
  cellLength: 5, cellAngle: 4,
  atomX: 5, atomY: 5, atomZ: 5, positionShift: 5,
  occupancy: 4, bIso: 4, uAniso: 5,
  momentX: 3, momentY: 3, momentZ: 3, momentMode: 3, propagationK: 5,
  zeroShift: 4, tofCalibration: 3,
  qdamp: 4, qbroad: 4, delta1: 4, delta2: 4, sratio: 4, rcut: 3, spdiameter: 2, corrLength: 2, mpdfPsigma: 4,
};

const KIND_UNIT: Partial<Record<ParameterKind, string>> = {
  cellLength: "Å", cellAngle: "°",
  positionShift: "shift (frac.)", bIso: "Å²", uAniso: "Å²", ridingTorsion: "°",
  momentX: "µB", momentY: "µB", momentZ: "µB", momentMode: "µB", propagationK: "(r.l.u.)",
  zeroShift: "° 2θ", sampleDisplacement: "µm",
  qdamp: "Å⁻¹", qbroad: "Å⁻¹", delta1: "Å", delta2: "Å²", rcut: "Å", spdiameter: "Å", corrLength: "Å", mpdfPsigma: "Å",
  tofCalibration: "µs", stephensStrain: "×10⁻⁶", mustrainIso: "×10⁻⁶", mustrainPar: "×10⁻⁶", mustrainPerp: "×10⁻⁶",
};

/** value(su) when the fit gave an esd; otherwise a kind-appropriate precision. */
function formatParameterValue(p: RefinementParameter, decimals?: number): string {
  const d = decimals ?? KIND_DECIMALS[p.kind];
  if (p.esd !== undefined && Number.isFinite(p.esd) && p.esd > 0) return formatWithEsd(p.value, p.esd, d ?? 5);
  return d !== undefined ? fixed(p.value, d) : reportSig(p.value);
}

/**
 * A parameter as the report's table shows it: on a single crystal an
 * isotropic displacement reads as U_iso (Å²), SHELXL's and the CIF's
 * convention, B/8π² with its esd and bounds.
 */
function shownParameter(p: RefinementParameter, technique: ReportTechnique): { readonly parameter: RefinementParameter; readonly value: string } {
  if (technique !== "singleCrystal" || p.kind !== "bIso") return { parameter: p, value: formatParameterValue(p) };
  const u = (v: number): number => v / EIGHT_PI2;
  const parameter: RefinementParameter = {
    ...p, label: p.label.replace(/\bB\b/, "U_iso"), value: u(p.value), initialValue: u(p.initialValue),
    ...(p.min !== undefined ? { min: u(p.min) } : {}), ...(p.max !== undefined ? { max: u(p.max) } : {}), ...(p.esd !== undefined ? { esd: u(p.esd) } : {}),
  };
  return { parameter, value: formatParameterValue(parameter, 5) };
}

interface ParameterGroup {
  readonly title: string;
  readonly kinds: readonly ParameterKind[];
}

const PARAMETER_GROUPS: readonly ParameterGroup[] = [
  { title: "Scale & background", kinds: ["scale", "batchScale", "background", "magneticScale", "pdfScale"] },
  { title: "Unit cell", kinds: ["cellLength", "cellAngle"] },
  { title: "Atoms", kinds: ["atomX", "atomY", "atomZ", "positionShift", "occupancy", "bIso", "uAniso"] },
  { title: "Magnetic moments", kinds: ["momentMode", "momentX", "momentY", "momentZ"] },
  { title: "Propagation vector", kinds: ["propagationK"] },
  {
    title: "Peak shape, instrument & sample",
    kinds: [
      "peakWidth", "profileU", "profileV", "profileW", "profileX", "profileY", "asymSL", "asymHL",
      "zeroShift", "sampleDisplacement", "sampleTransparency", "tofCalibration", "tofProfile",
      "poRatio", "absorption", "surfaceRoughA", "surfaceRoughB", "extinction", "stephensStrain",
      "anisoSizePerp", "anisoSizePar", "mustrainPerp", "mustrainPar", "mustrainIso",
    ],
  },
  {
    title: "PDF envelope & correlated motion",
    kinds: ["qdamp", "qbroad", "delta1", "delta2", "spdiameter", "sratio", "rcut", "mpdfOrdScale", "mpdfParaScale", "mpdfPsigma", "corrLength"],
  },
];

/** A single crystal's groups: no background or peak shape; the twin fractions, the extinction and the riding groups by name. */
const SINGLE_CRYSTAL_GROUPS: readonly ParameterGroup[] = [
  { title: "Scale", kinds: ["scale", "batchScale", "magneticScale"] },
  { title: "Twin fractions", kinds: ["twinFraction"] },
  { title: "Extinction", kinds: ["extinction"] },
  { title: "Atoms", kinds: ["atomX", "atomY", "atomZ", "positionShift", "occupancy", "bIso", "uAniso"] },
  { title: "Riding groups", kinds: ["ridingTorsion"] },
  { title: "Magnetic moments", kinds: ["momentMode", "momentX", "momentY", "momentZ"] },
  { title: "Propagation vector", kinds: ["propagationK"] },
];

/** The parameter groups a report of this technique lists. */
function parameterGroups(technique: ReportTechnique): readonly ParameterGroup[] {
  return technique === "singleCrystal" ? SINGLE_CRYSTAL_GROUPS : PARAMETER_GROUPS;
}

/** A parameter's state in words: refined, fixed, or the tie it follows. */
function parameterStatus(p: RefinementParameter): string {
  if (p.expression) return `tied · ${p.expression.trim().startsWith("=") ? p.expression.trim() : `= ${p.expression}`}`;
  return p.fixed ? "fixed" : "refined";
}

/** Kinds the summary shows in its own tables (the atoms, the cell, the moments), or leaves to the appendix (the background coefficients). */
const KINDS_SHOWN_ELSEWHERE: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  "cellLength", "cellAngle", "atomX", "atomY", "atomZ", "positionShift", "occupancy", "bIso", "uAniso",
  "momentX", "momentY", "momentZ", "momentMode", "background",
]);

/**
 * The refined values the summary lists beside the structure: every free
 * parameter (not fixed, not tied) the atom, cell and moment tables do not
 * already carry, background coefficients aside — the scales, the profile, the
 * extinction, the twin fractions, the PDF envelope. Every parameter, fixed or
 * not, is in the appendix.
 */
export function summaryParameters(params: readonly RefinementParameter[], technique: ReportTechnique): RefinementParameter[] {
  const groups = parameterGroups(technique);
  const order = (p: RefinementParameter): number => {
    const i = groups.findIndex((g) => g.kinds.includes(p.kind));
    return i < 0 ? groups.length : i;
  };
  return params
    .filter((p) => !p.fixed && !p.expression && !KINDS_SHOWN_ELSEWHERE.has(p.kind))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => order(a.p) - order(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

/**
 * Checks whose rows are diagnostic listings — the record of how the data and
 * the fit were read, not a limit on the result: in the appendix's full table
 * unless one needs attention (then it is among the open issues too).
 */
export const DETAIL_CHECKS: ReadonlySet<string> = new Set([
  "Resolution shells", "Analysis of variance", "Data reading", "Batches", "Weights",
  "Fit diagnosis", "Earlier fit diagnoses", "Refinements compared", "Fit range",
]);

/** Checks the summary shows in full whatever their status: the single-crystal data's numbers (reflections, R_int, d_min, completeness). */
const ALWAYS_SHOWN_CHECKS: ReadonlySet<string> = new Set(["Data"]);

/**
 * The checks as the summary shows them: `noted`, the rows that bear on how
 * far to trust the result (each note, and the data's numbers); `passed`, the
 * names of the others that passed. Checks needing attention are the open
 * issues'; every check, with its detail, is in the appendix.
 */
function summaryChecks(checks: readonly ReportCheck[]): { readonly noted: readonly ReportCheck[]; readonly passed: readonly string[] } {
  const noted = checks.filter((c) => ALWAYS_SHOWN_CHECKS.has(c.name) || (c.status === "note" && !DETAIL_CHECKS.has(c.name)));
  const passed = [...new Set(checks.filter((c) => c.status === "pass" && !ALWAYS_SHOWN_CHECKS.has(c.name)).map((c) => c.name))];
  return { noted, passed };
}

/** The summary's line under the noted checks. */
function passedText(passed: readonly string[]): string {
  return passed.length > 0 ? `Passed: ${passed.join(", ")} (each with its numbers in the appendix).` : "";
}

/** What the appendix holds, under its heading. */
const APPENDIX_NOTE = "The record behind the summary above, for reproducing it: how the analysis went step by step, every check with its numbers, every parameter (fixed or refined), the conventions and the software.";

/**
 * The atom table's displacement column: B_iso, or B_eq for an anisotropic
 * site (Å²), on a powder or a PDF; on a single crystal U_iso and U_eq (Å²),
 * SHELXL's and the CIF's convention, U_eq's esd from its tensor modes' taken
 * as independent. U_eq by the full formula (a third of the trace only in an
 * orthogonal cell).
 */
function displacementColumn(phase: ReportPhase, technique: ReportTechnique): { readonly symbol: "B" | "U"; readonly sub: "eq" | "iso"; readonly value: (site: StructureModel["sites"][number]) => string } {
  const st = phase.structure;
  const esd = buildEsdMap(phase.params, phase.bindings);
  const sub = st.sites.some((s) => s.adp.kind === "anisotropic") ? "eq" : "iso";
  if (technique !== "singleCrystal") {
    return {
      symbol: "B", sub,
      value: (s) => formatWithEsd(s.adp.kind === "isotropic" ? s.adp.bIso : EIGHT_PI2 * uEquivalent(s.adp.uAniso, st.cell), s.adp.kind === "isotropic" ? esd.bIso.get(s.label) : undefined, 3),
    };
  }
  const byId = new Map(phase.params.map((p) => [p.id, p]));
  const variance = new Map<string, number>();
  for (const b of phase.bindings) {
    const p = byId.get(b.parameterId);
    if (b.kind !== "uAniso" || !b.targetKey || !b.uBasis || !p || (p.fixed && !p.expression) || !(p.esd !== undefined && p.esd > 0)) continue;
    variance.set(b.targetKey, (variance.get(b.targetKey) ?? 0) + (uEquivalent(b.uBasis as Parameters<typeof uEquivalent>[0], st.cell) * p.esd) ** 2);
  }
  return {
    symbol: "U", sub,
    value: (s) => {
      if (s.adp.kind === "isotropic") {
        const e = esd.bIso.get(s.label);
        return formatWithEsd(s.adp.bIso / EIGHT_PI2, e !== undefined ? e / EIGHT_PI2 : undefined, 5);
      }
      const v = variance.get(s.label);
      return formatWithEsd(uEquivalent(s.adp.uAniso, st.cell), v !== undefined && v > 0 ? Math.sqrt(v) : undefined, 5);
    },
  };
}

/** What the bond tables say about their lengths. */
const BONDS_NOTE = "Each cation's shell at the refined positions, out to 3.2 Å (or 1.25 × its shortest bond for a large cation); no esds, as the covariance is not carried to the lengths.";

/** What the covalent bond table says about its lengths. */
const COVALENT_BONDS_NOTE = "The covalent bonds at the refined positions (atoms closer than their covalent radii and 0.4 Å), each once; the esds from the refined positions' and, for a cell held fixed, from the structure file's cell esds (each independent cell parameter moved by its esd, as SHELXL adds them). A riding hydrogen's bond is set by its constraint. [k_abc] marks an image of the atom listed: operation k of the symmetry list, moved by the lattice translation (a − 5, b − 5, c − 5), as a CIF's site-symmetry code.";

/** What the ring-centroid lines say. */
const RING_NOTE = "Cg: the centroid of a planar ring (each atom within 0.1 Å of its least-squares plane). A metal within 3.6 Å of one, an N–H or O–H whose hydrogen points at one within 3.0 Å (X–H···Cg above 120°), and the angle at a metal between its two nearest centroids; [k_abc] marks the centroid's image by its CIF site-symmetry code. No esds.";

/** What the hydrogen-bond lines say. */
const HBOND_NOTE = "D–H···A with H···A shorter than the two atoms' van der Waals radii and D–H···A above 110°, as SHELXL's HTAB finds them, D an N, O, F or S; a riding hydrogen's D–H is set by its constraint; [k_abc] marks the acceptor's image. No esds.";

/** A molecular structure's bonds, one row per site: "S1A: S2A 2.0222(5) · C6A 1.7868(13)". */
function covalentBondRows(bonds: readonly ReportBond[]): { site: string; bonds: string }[] {
  const rows = new Map<string, string[]>();
  for (const b of bonds) rows.set(b.from, [...(rows.get(b.from) ?? []), `${b.to}${b.image ? ` [${b.image}]` : ""} ${b.length}`]);
  return [...rows].map(([site, list]) => ({ site, bonds: list.join(" · ") }));
}

/** The cations' coordination shells, one row per site: "O6 1.9067 ×2 · O1 1.9692 ×2 · …". */
function shellRows(structure: StructureModel): { site: string; bonds: string; mean: string }[] {
  return coordinationShells(structure).map((sh) => ({
    site: sh.site,
    bonds: sh.bonds.map((b) => `${b.to} ${fixed(b.distance, 4)}${b.count > 1 ? ` ×${b.count}` : ""}`).join(" · "),
    mean: fixed(sh.mean, 4),
  }));
}

/** How the scan was run, under its table. */
function boxcarNote(b: ReportBoxcar): string {
  return `${b.rows.length} boxes of ${fixed(b.width, 2)} Å, each refining ${b.free.join(", ")} from the previous box's values. A value that drifts with r, or an Rw that rises at low r, is a local structure the average model lacks. No esds per box.`;
}

/** What the summary's table of the other refined values says. */
const SUMMARY_PARAMETERS_NOTE = "The refined values the tables above do not carry, with their esds. The background coefficients and every fixed or tied value are in the appendix.";

/** How the convergence of a posterior run reads. */
function posteriorStatus(p: ReportPosterior): string {
  const run = `${p.earlier ? "of an earlier refinement · " : ""}ensemble MCMC, ${p.walkers} walkers × ${p.steps} steps, ${p.samples} samples kept · R̂max ${p.maxRHat.toFixed(3)} · ESS min ${Math.round(p.minEss)}`;
  return p.convergence === "converged" ? `${run} · converged` : p.convergence === "close" ? `${run} · close to converged` : `${run} · not converged`;
}

/** The posterior's caveat line: what the intervals may be used for. */
function posteriorCaveat(p: ReportPosterior): string {
  const use = p.convergence === "converged"
    ? ""
    : p.convergence === "close"
      ? "Close to converged (R̂ < 1.1): the intervals say whether a value is determined, but are not final values to quote. "
      : "Not converged: the intervals are not to be read. ";
  const when = p.earlier ? `Of an earlier refinement: ${p.earlier}; the other parameters were held at their values then. ` : "";
  return `${when}${use}Uniform priors within each parameter's bounds; the noise scale is marginalized (the Bayesian counterpart of scaling the esds by the GoF). The intervals hold within this model: a systematic misfit leaves them as overconfident as the esds.`;
}

/** What the account's footnote says about whose words are whose. */
const ACCOUNT_NOTE = "Written by MATERIA Copilot in its own words, as are its notes (in the appendix, with the model that wrote them). Every other number in this report — the steps, the checks, the parameters, the agreement factors and the figure — comes from the refinement engine and the project's History, not from the model.";

/** The software and the date behind the report, for the appendix. */
function softwareRows(input: ReportInput, date: string): ReportRow[] {
  return [
    { label: "Program", value: `MATERIA Workbench${input.appVersion ? ` v${input.appVersion}` : ""}` },
    { label: "Report written", value: date },
    ...(input.agent ? [{ label: "Analysed with", value: `MATERIA Copilot · ${input.agent.model}` }] : []),
    ...(input.result ? [{ label: "Engine", value: `${input.result.status}${input.result.history.length > 0 ? ` after ${input.result.history.length} cycle${input.result.history.length === 1 ? "" : "s"}` : ""}` }] : []),
  ];
}

// ---------------------------------------------------------------------------
// Figure: the report's SVG with its own (light) style, as a data URI

const FIGURE_STYLE = `
.frame{fill:none;stroke:#e1e5ea;stroke-width:1}.grid{stroke:#e1e5ea;stroke-width:1;stroke-dasharray:2 4}.zero{stroke:#8e98a3;stroke-width:1}
.tickmark{stroke:#5a6572;stroke-width:1}.excl{fill:rgba(110,120,132,.10)}
.axistext{font-family:Menlo,Consolas,monospace;font-size:11px;fill:#5a6572}.axistitle,.legend{font-family:system-ui,sans-serif;font-size:12px;fill:#5a6572}
.ticklabel{font-family:Menlo,Consolas,monospace;font-size:10.5px}
.obs{stroke:#23486f;stroke-width:2.6;stroke-linecap:round;fill:none}.obsline{stroke:#23486f;stroke-width:1.4;fill:none}
.calc{stroke:#c8352e;stroke-width:1.5;fill:none}.diff{stroke:#4f7a33;stroke-width:1.2;fill:none}.bkg{stroke:#98a3ae;stroke-width:1.1;stroke-dasharray:5 4;fill:none}
.unity{stroke:#8e98a3;stroke-width:1;stroke-dasharray:4 4}.pt{stroke:#23486f;stroke-width:4.2;stroke-linecap:round;opacity:.7;fill:none}
.ptmag{stroke:#c8352e;stroke-width:4.6;stroke-linecap:round;opacity:.8;fill:none}`;

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function figureMarkdown(fig: ReportFigure): string {
  const svg = fig.kind === "pattern"
    ? patternFigureSvg(fig.curves, {
        xLabel: fig.xLabel,
        ...(fig.yLabel !== undefined ? { yLabel: fig.yLabel } : {}),
        ...(fig.ticks ? { ticks: fig.ticks } : {}),
        ...(fig.fitRange ? { fitRange: fig.fitRange } : {}),
        ...(fig.observedAs ? { observedAs: fig.observedAs } : {}),
      })
    : fig.points.length > 0 ? fobsFcalcSvg(fig.points) : "";
  if (!svg) return "";
  // A white ground and the style the HTML report's stylesheet gives the figure.
  const styled = svg.replace(/<svg([^>]*)>/, (_m, attrs: string) => `<svg${attrs.includes("xmlns=") ? attrs : `${attrs} xmlns="http://www.w3.org/2000/svg"`}><style>${FIGURE_STYLE}</style><rect width="100%" height="100%" fill="#fff"/>`);
  const alt = fig.kind === "pattern" ? "Observed, calculated and difference pattern" : "F_obs against F_calc";
  return `![${alt}](data:image/svg+xml;base64,${utf8Base64(styled)})${fig.caption ? `\n\n*${fig.caption}*` : ""}`;
}

// ---------------------------------------------------------------------------
// Sections

/** Significant figures, without exponents for ordinary values (as the HTML report). */
function sig(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(Math.max(1, digits - 1));
  return fixed(v, Math.min(Math.max(0, digits - 1 - Math.floor(Math.log10(a))), 8));
}

function posteriorMarkdown(p: ReportPosterior): string {
  const rows = table(
    ["Parameter", "Refined (esd)", "Median", "68 % interval", "95 % interval", "Width/esd", "Reading"],
    p.rows.map((r) => [
      r.label, formatWithEsd(r.refined, r.esd, 5), sig(r.median, 3),
      `${sig(r.ci68[0], 3)}–${sig(r.ci68[1], 3)}`, `${sig(r.ci95[0], 3)}–${sig(r.ci95[1], 3)}`,
      r.esdRatio !== undefined ? r.esdRatio.toFixed(2) : "—", r.verdict,
    ]),
    ["l", "r", "r", "r", "r", "r", "l"],
  );
  const diffs = p.differences.length > 0 ? `\n\n${p.differences.map((d) => `- ${d}`).join("\n")}` : "";
  return `**Bayesian check** — ${posteriorStatus(p)}\n\n${rows}${diffs}\n\n*${posteriorCaveat(p)}*`;
}

const CHECK_LABEL = { pass: "pass", note: "note", warn: "attention" } as const;

function checksTable(checks: readonly ReportCheck[]): string {
  return table(["Check", "Result", "Detail"], checks.map((c) => [c.name, CHECK_LABEL[c.status], c.detail]));
}

/** The analysis in the summary: the account, the open issues, the checks to note, the Bayesian check. */
function agentSummaryMarkdown(a: ReportAgent): string {
  const unverified = a.unverified ?? [];
  const account = a.narrative?.trim() ? markNumbers(a.narrative.trim(), unverified, (t) => `${t}†`) : "";
  const narrative = account
    ? `**The Copilot's account**\n\n${account.split(/\n\s*\n/).map((p) => `> ${p.trim().replace(/\n/g, "\n> ")}`).join("\n>\n")}\n\n*${ACCOUNT_NOTE}${unverified.length > 0 ? " Numbers marked † in the Copilot's words are not among the values this report computed." : ""}*\n\n`
    : "";
  const issues = a.openIssues.length > 0 ? a.openIssues.map((t) => `- ${t}`).join("\n") : "None: the engine's checks raised nothing left to settle.";
  const { noted, passed } = summaryChecks(a.checks);
  const checks = `${noted.length > 0 ? checksTable(noted) : "No check calls for a note."}${passed.length > 0 ? `\n\n${passedText(passed)}` : ""}`;
  const posterior = a.posterior ? `\n\n${posteriorMarkdown(a.posterior)}` : "";
  return `${narrative}**Open issues**\n\n${issues}\n\n**Checks to note**\n\n${checks}${posterior}`;
}

/** The analysis as it went, for the appendix: the steps, the method, every check, the notes. */
function agentRecordMarkdown(a: ReportAgent): string {
  const pct = (v: number | undefined): string => (v === undefined ? "" : `${(100 * v).toFixed(2)} %`);
  const anyGof = a.steps.some((st) => st.gof !== undefined);
  const steps = table(
    ["#", "Step", "By", "Refined", "Free", a.agreementLabel ?? "wR", ...(anyGof ? ["GoF"] : [])],
    a.steps.map((st, i) => [
      String(i + 1),
      st.stages ? `${st.label} · ${st.stages}` : st.label,
      st.by === "agent" ? "Copilot" : "user",
      st.refined ?? "",
      String(st.free),
      pct(st.wR),
      ...(anyGof ? [st.gof !== undefined ? st.gof.toFixed(2) : ""] : []),
    ]),
    ["r", "l", "l", "l", "r", "r", "r"],
  );
  const branches = a.otherBranches ? `\n\n*The table follows the path to the result; ${a.otherBranches} step${a.otherBranches === 1 ? "" : "s"} on branches the analysis left ${a.otherBranches === 1 ? "is" : "are"} kept in the History, not shown.*` : "";
  const start = a.start ? `\n\n${startText(a.start, a.agreementLabel ?? "wR")}` : "";
  const stages = a.method
    ? `\n\nMethod (the skill \`${a.method.skill}\`): ${a.method.stages.map((st) => `${st.done ? "✓" : "○"} ${st.label}${st.optional && !st.done ? ", if needed" : ""}`).join(" · ")}`
    : "";
  const unverified = a.unverified ?? [];
  const notes = a.notes.length > 0 ? `\n\n**The Copilot's notes**\n\n${a.notes.map((t) => `- ${markNumbers(t, unverified, (n) => `${n}†`)}`).join("\n")}` : "";
  return `**How the analysis was done** — ${a.steps.length} step${a.steps.length === 1 ? "" : "s"} from the History; model ${a.model}.\n\n${steps}${start}${stages}${branches}\n\n**Every check**\n\n${checksTable(a.checks)}${notes}`;
}

function phaseMarkdown(phase: ReportPhase, index: number, total: number, technique: ReportInput["technique"]): string {
  const st = phase.structure;
  const esd = buildEsdMap(phase.params, phase.bindings);
  const sg = st.spaceGroup;
  const sgText = `${spaceGroupSymbol(sg) ?? "no symbol"}${sg.number !== undefined ? ` (No. ${sg.number})` : ""}`;
  const role = phase.role ?? (total > 1 ? (index === 0 ? "primary phase" : `phase ${index + 1}`) : undefined);
  const adp = displacementColumn(phase, technique);
  const sites = table(
    ["Site", "Type", "x", "y", "z", "Occ.", `${adp.symbol}_${adp.sub} (Å²)`],
    st.sites.map((s) => {
      const pe = esd.pos.get(s.label);
      return [
        s.label, s.element,
        formatWithEsd(s.position[0], pe?.[0], 5), formatWithEsd(s.position[1], pe?.[1], 5), formatWithEsd(s.position[2], pe?.[2], 5),
        formatWithEsd(s.occupancy, esd.occ.get(s.label), 4), adp.value(s),
      ];
    }),
    ["l", "l", "r", "r", "r", "r", "r"],
  );
  const c = st.cell;
  const ce = cellEsdsOf(st, esd);
  const cellRow = table(
    ["a (Å)", "b (Å)", "c (Å)", "α (°)", "β (°)", "γ (°)", "V (Å³)"],
    [[
      formatWithEsd(c.a, ce.cell.a, 5), formatWithEsd(c.b, ce.cell.b, 5), formatWithEsd(c.c, ce.cell.c, 5),
      formatWithEsd(c.alpha, ce.cell.alpha, 4), formatWithEsd(c.beta, ce.cell.beta, 4), formatWithEsd(c.gamma, ce.cell.gamma, 4),
      ce.volume !== undefined ? formatWithEsd(cellVolume(c), ce.volume, 3) : fixed(cellVolume(c), 3),
    ]],
    ["r", "r", "r", "r", "r", "r", "r"],
  );
  const shells = shellRows(st);
  const covalent = phase.bonds ? covalentBondRows(phase.bonds) : [];
  const bonds = covalent.length > 0
    ? `\n\n${table(["Site", "Bonds (Å)"], covalent.map((r) => [r.site, r.bonds]), ["l", "l"])}\n\n*${COVALENT_BONDS_NOTE}*`
    : !phase.bonds && shells.length > 0
      ? `\n\n${table(["Site", "Bonds (Å)", "Mean (Å)"], shells.map((r) => [r.site, r.bonds, r.mean]), ["l", "l", "r"])}\n\n*${BONDS_NOTE}*`
      : "";
  // The ring centroids and hydrogen bonds under a molecule's bond table.
  const rings = phase.rings && phase.rings.contacts.length > 0 ? `\n\n**Ring centroids.** ${phase.rings.rings.join("; ")}. ${phase.rings.contacts.join(" · ")}.\n\n*${RING_NOTE}*` : "";
  const hbonds = phase.hydrogenBonds && phase.hydrogenBonds.length > 0 ? `\n\n**Hydrogen bonds.** ${phase.hydrogenBonds.join(" · ")}.\n\n*${HBOND_NOTE}*` : "";
  return `### ${st.name || st.id} — ${sgText}${role ? ` · ${role}` : ""}\n\n${cellRow}\n\n${sites}${bonds}${rings}${hbonds}`;
}

function boxcarMarkdown(b: ReportBoxcar): string {
  const rows = b.rows.map((row) => [`${fixed(row.r[0], 2)}–${fixed(row.r[1], 2)}`, fixed(100 * row.rw, 2), ...row.values.map((v) => (Number.isFinite(v) ? fixed(v, b.decimals) : "—"))]);
  return `${table(["r (Å)", "Rw (%)", ...b.columns], rows, ["r", "r", ...b.columns.map(() => "r" as const)])}\n\n*${boxcarNote(b)}*`;
}

function magneticMarkdown(m: ReportMagnetic, fallback: StructureModel | undefined): string {
  const structure = m.structure ?? fallback;
  if (!structure) return "";
  const supercell = magneticSupercell(m.k);
  const isSuper = supercell.some((n) => n > 1);
  const facts: ReportRow[] = [
    { label: "Propagation vector", value: `k = ${kLabel(m.k)}` },
    { label: "Magnetic space group", value: m.group.symbol },
    ...(m.group.numbers ? [{ label: "Numbers", value: m.group.numbers }] : []),
    ...(m.group.setting ? [{ label: "Setting", value: m.group.setting }] : []),
    ...(m.group.index !== undefined ? [{ label: "Index in the grey group", value: String(m.group.index) }] : []),
    { label: "Parent space group", value: structure.spaceGroup.hermannMauguin ?? "—" },
    { label: "Magnetic cell", value: isSuper ? `${supercell.join(" × ")} supercell of the nuclear cell` : "the nuclear cell (k = 0)" },
  ];
  const moments = table(
    ["Site · orbit", "Position (fractional)", "m along a, b, c (µB)", "|m| (µB)"],
    m.magnetic.moments.map((mm) => {
      const site = structure.sites.find((s) => s.label === mm.siteLabel);
      const pos = site
        ? momentAnchorPosition(structure.spaceGroup.operations, m.magnetic.operations ?? structure.spaceGroup.operations, site.position, mm.orbitIndex, mm.position)
        : mm.position ?? [0, 0, 0];
      const cart = crystalComponentsToCartesian(structure.cell, mm.components);
      return [
        `${mm.siteLabel} · orbit ${mm.orbitIndex && mm.orbitIndex > 1 ? mm.orbitIndex : 1}`,
        `${fixed(pos[0]!, 4)}, ${fixed(pos[1]!, 4)}, ${fixed(pos[2]!, 4)}`,
        `${fixed(mm.components[0]!, 3)}, ${fixed(mm.components[1]!, 3)}, ${fixed(mm.components[2]!, 3)}`,
        fixed(Math.hypot(cart[0]!, cart[1]!, cart[2]!), 3),
      ];
    }),
    ["l", "r", "r", "r"],
  );
  const params = m.params.length > 0
    ? `\n\n${table(["Moment parameter", "Value (µB)", "Status"], m.params.map((p) => [p.label, formatParameterValue(p), parameterStatus(p)]), ["l", "r", "l"])}`
    : "";
  const limits = (m.limits ?? []).map((t) => `> ⚠ ${t}`).join("\n>\n");
  return `*${m.status}*${limits ? `\n\n${limits}` : ""}\n\n${kvTable(facts)}${params}\n\n${moments}`;
}

function parametersMarkdown(params: readonly RefinementParameter[], technique: ReportInput["technique"]): string {
  if (params.length === 0) return "No parameters.";
  const seen = new Set<string>();
  const blocks: string[] = [];
  const block = (title: string, rows: readonly RefinementParameter[]): string => {
    const free = rows.filter((p) => !p.fixed && !p.expression).length;
    return `#### ${title} · ${rows.length} parameter${rows.length === 1 ? "" : "s"}, ${free} refined\n\n${table(
      ["Parameter", "Value", "Unit", "Status"],
      rows.map((p) => shownParameter(p, technique)).map(({ parameter: p, value }) => [p.label, value, KIND_UNIT[p.kind] ?? "", parameterStatus(p)]),
      ["l", "r", "l", "l"],
    )}`;
  };
  for (const g of parameterGroups(technique)) {
    const rows = params.filter((p) => g.kinds.includes(p.kind));
    if (rows.length === 0) continue;
    rows.forEach((p) => seen.add(p.id));
    blocks.push(block(g.title, rows));
  }
  const rest = params.filter((p) => !seen.has(p.id));
  if (rest.length > 0) blocks.push(block("Other parameters", rest));
  return blocks.join("\n\n");
}

function detailsMarkdown(input: ReportInput): string {
  const r = input.result;
  const labelOf = new Map(input.parameters.map((p) => [p.id, p.label]));
  const free = input.parameters.filter((p) => !p.fixed && !p.expression).length;
  const rows: ReportRow[] = [{ label: "Free parameters", value: `${free} of ${input.parameters.length}` }];
  if (r) {
    rows.push({ label: "Engine", value: `${r.status}${r.history.length > 0 ? ` after ${r.history.length} cycle${r.history.length === 1 ? "" : "s"}` : ""}` });
    const last = r.history[r.history.length - 1];
    if (last) rows.push({ label: "Final χ² (Σ w Δ²)", value: last.chiSquared.toPrecision(6) });
    if (r.agreement.rWeighted !== undefined) rows.push({ label: "Weighted R", value: `${(100 * r.agreement.rWeighted).toFixed(3)} %` });
    if (r.agreement.rExpected !== undefined) rows.push({ label: "Expected R", value: `${(100 * r.agreement.rExpected).toFixed(3)} %` });
    if (r.agreement.goodnessOfFit !== undefined) rows.push({ label: "Goodness of fit S", value: r.agreement.goodnessOfFit.toFixed(3) });
    const diag = r.diagnostics;
    if (diag && diag.svdZeroCount > 0) rows.push({ label: "Null directions", value: `${diag.svdZeroCount} dropped by SVD — esds on the involved parameters are not meaningful` });
    if (diag && diag.highCorrelations.length > 0) {
      rows.push({
        label: "Strong correlations",
        value: diag.highCorrelations.slice(0, 6).map((c) => `${labelOf.get(c.parameterIdA) ?? c.parameterIdA} / ${labelOf.get(c.parameterIdB) ?? c.parameterIdB} ${c.coefficient.toFixed(3)}`).join("; "),
      });
    }
    if (r.message) rows.push({ label: "Engine note", value: r.message });
  } else {
    rows.push({ label: "Engine", value: "no refinement run in this session — values are as loaded or set" });
  }
  const warnings = (input.warnings ?? []).map((w) => `> ⚠ ${w}`).join("\n");
  return `${kvTable(rows)}${warnings ? `\n\n**Limitations**\n\n${warnings}` : ""}`;
}

/** The summary's other refined values: the free parameters the tables above do not carry. */
function summaryParametersMarkdown(params: readonly RefinementParameter[], technique: ReportInput["technique"]): string {
  const rows = summaryParameters(params, technique);
  if (rows.length === 0) return "";
  return `${table(
    ["Parameter", "Value", "Unit"],
    rows.map((p) => shownParameter(p, technique)).map(({ parameter: p, value }) => [p.label, value, KIND_UNIT[p.kind] ?? ""]),
    ["l", "r", "l"],
  )}\n\n*${SUMMARY_PARAMETERS_NOTE}*`;
}

/** The appendix's conventions and software. */
function conventionsMarkdown(input: ReportInput, date: string): string {
  const notes = (input.notes ?? []).map((n) => `- ${n}`).join("\n");
  return `${notes ? `**Conventions**\n\n${notes}\n\n` : ""}**Software**\n\n${kvTable(softwareRows(input, date))}`;
}

/** The report as the Agent validation reads it (frozen layout): the summary, then the appendix with the record behind it. */
export function frozenReportMarkdown(input: ReportInput): string {
  const date = (input.date ?? new Date()).toISOString().slice(0, 10);
  const technique = TECHNIQUE_TITLE[input.technique];
  const primary = input.phases[0]?.structure;
  let n = 0;
  const section = (title: string, body: string): string => (body ? `## ${++n}. ${title}\n\n${body}` : "");
  let letter = 0;
  const part = (title: string, body: string): string => (body ? `### ${String.fromCharCode(65 + letter++)}. ${title}\n\n${body}` : "");
  const stats = input.stats.length > 0 ? table(input.stats.map((s) => s.label), [input.stats.map((s) => s.value)], input.stats.map(() => "r" as const)) : "";
  const free = input.parameters.filter((p) => !p.fixed && !p.expression).length;
  const parts = [
    `# ${input.title}`,
    `*MATERIA · ${technique} report${input.agent ? " · analysed with MATERIA Copilot" : ""} · ${date}*`,
    input.subtitle ?? "",
    input.summary ?? "",
    stats,
    section("The analysis", input.agent ? agentSummaryMarkdown(input.agent) : ""),
    section("Data & model", input.data.length > 0 ? kvTable(input.data) : ""),
    section("Fit", input.figure ? figureMarkdown(input.figure) : ""),
    section("Local versus average", input.boxcar ? boxcarMarkdown(input.boxcar) : ""),
    section(input.phases.length > 1 ? "Atomic structures" : "Atomic structure", input.phases.map((p, i) => phaseMarkdown(p, i, input.phases.length, input.technique)).join("\n\n")),
    section("Magnetic structure", input.magnetic ? magneticMarkdown(input.magnetic, primary) : ""),
    section("Other refined values", summaryParametersMarkdown(input.parameters, input.technique)),
    section("Refinement details", detailsMarkdown(input)),
    // How to read the summary's numbers, before the appendix: a reader may stop there.
    `*Generated by MATERIA Workbench on ${date}. Values in parentheses are standard uncertainties in the last digit(s), from the least-squares covariance of this fit; a value without one was fixed, set by a constraint, or not part of the last refinement; a tied value carries its leader's. MATERIA is in public beta — reproduce results you intend to publish in an established package.*`,
    `---\n\n## Appendix — the full record\n\n*${APPENDIX_NOTE}*`,
    input.agent ? part(`The analysis step by step`, agentRecordMarkdown(input.agent)) : "",
    part(`Every parameter · ${input.parameters.length} parameter${input.parameters.length === 1 ? "" : "s"}, ${free} refined`, parametersMarkdown(input.parameters, input.technique)),
    part("Conventions and software", conventionsMarkdown(input, date)),
  ];
  return `${parts.filter((p) => p.trim().length > 0).join("\n\n")}\n`;
}
