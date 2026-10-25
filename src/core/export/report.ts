/**
 * The refinement report — one self-contained HTML document for every
 * technique (Rietveld powder, single crystal F², real-space PDF), offered from
 * the header's Export menu and written by the Agent's write_report. It reads
 * as a paper's results section:
 *
 * 1. Result — what was refined against what, the outcome with its key
 *    numbers, the verdict against the acceptance bar and the main limitation:
 *    the Agent's own account when it wrote one, else a paragraph composed
 *    from the app's own readings of the fit (reportResult.ts).
 * 2. Structure — per phase the space group, the cell as its independent
 *    parameters, the atoms with standard uncertainties (fractions where the
 *    symmetry fixes a coordinate), the distances (reportTables.ts).
 * 3. Magnetic structure, when there is one: k, the magnetic space group, the
 *    moments, the projection, what the data cannot fix.
 * 4. Fit — the figure, the agreement indices in a line, the other refined
 *    values, a PDF's boxcar scan.
 * 5. Quality and caveats — one line each: the acceptance checks, the causes
 *    of misfit, the meaningful correlations, the limitations, the Agent's
 *    open issues and Bayesian check.
 * 6. Appendix — collapsed on screen, open in print: the data and model, the
 *    refinement's statistics, the analysis step by step, every parameter, the
 *    conventions and the software. Nothing is dropped, only moved.
 *
 * Pure data → string, in the exporters.ts convention: the workbenches assemble
 * a `ReportInput` (`src/app/reportInputs.ts`) and save the result; nothing
 * here touches the DOM. Figures come from `reportFigures.ts`.
 *
 * Numbers in parentheses are standard uncertainties in the last digit(s)
 * (`formatWithEsd`, the IUCr convention), taken from the refinement's esds via
 * the same parameter → field mapping the CIF export uses (`buildEsdMap`).
 *
 * The Agent's number audit and the validation read the report's Markdown in
 * its earlier layout, frozen (reportMarkdownFrozen.ts): this layout may change
 * without moving them.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { MagneticModel } from "@/core/magnetic/types";
import type { ParameterKind, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { ParameterBinding } from "@/core/refinement/types";
import type { Vec3 } from "@/core/math/types";
import { formatWithEsd } from "@/core/export/cif";
import { spaceGroupSymbol } from "@/core/crystal/spaceGroups";
import { crystalComponentsToCartesian } from "@/core/magnetic/moment";
import { kLabel } from "@/core/magnetic/kSearch";
import { magneticSupercell, momentAnchorPosition } from "@/core/crystal/cellExpansion";
import { markNumbers } from "@/core/export/reportAudit";
import { atomTable, atomTableNote, cellTerms, shellTables, spaceGroupNumber, SHELL_NOTE, type AtomTable } from "@/core/export/reportTables";
import { asFraction, esc, formulaHtml, formulasInText, formulaText, minus, spaceGroupHtml, splitAtPoint, symbolHtml } from "@/core/export/reportTypeset";
import type { ReportAssessment, ReportCaveat, ReportTone } from "@/core/export/reportResult";
import {
  fobsFcalcSvg,
  magneticProjectionSvg,
  patternFigureSvg,
  SUBLATTICE_COLORS,
  type FigureCurves,
  type FigureTickRow,
  type FobsFcalcPoint,
} from "@/core/export/reportFigures";

export { displacementColumn } from "@/core/export/reportTables";
export type { ReportAssessment, ReportCaveat, ReportTone } from "@/core/export/reportResult";

export type ReportTechnique = "powder" | "singleCrystal" | "pdf";

export const TECHNIQUE_TITLE: Record<ReportTechnique, string> = {
  powder: "Rietveld refinement",
  singleCrystal: "Single-crystal refinement",
  pdf: "PDF refinement",
};

/** One headline number (the agreement line's fallback, and the frozen layout's tiles). */
export interface ReportStat {
  readonly label: string;
  readonly value: string;
  /** Tooltip: how the number is defined. */
  readonly hint?: string;
}

/**
 * One agreement index of the Fit line: its symbol marked for typesetting
 * ("R_wp", "χ^2", "wR_2", "GoF"; reportTypeset.ts symbolHtml) or a count's
 * word ("points"), its value as printed, and how it is defined.
 */
export interface ReportIndex {
  readonly symbol: string;
  readonly value: string;
  readonly hint?: string;
  /** A count ("3125 points"): the word follows the value, no "=". */
  readonly count?: boolean;
}

/** A label / value line of the "Data & model" record. */
export interface ReportRow {
  readonly label: string;
  readonly value: string;
}

/** A refined crystallographic phase: the structure AS REFINED plus the
 *  parameters/bindings that carry its esds (already filtered to this phase). */
export interface ReportPhase {
  readonly structure: StructureModel;
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  /** e.g. "primary phase", "impurity phase". */
  readonly role?: string;
  /** The phase's weight fraction as printed, with its esd ("96.63(7) wt%"), in a multi-phase fit. */
  readonly fraction?: string;
  /** A molecular structure's covalent bonds, each length with its esd (in place of the cation shells). */
  readonly bonds?: readonly ReportBond[];
  /** A molecule's planar rings and the contacts to their centroids (a Cp's metal, an X–H···π), in lines. */
  readonly rings?: { readonly rings: readonly string[]; readonly contacts: readonly string[] };
  /** A molecule's hydrogen bonds D–H···A, in lines. */
  readonly hydrogenBonds?: readonly string[];
}

/** One covalent bond of the report's table: its sites and its length as printed, with the esd or "riding". */
export interface ReportBond {
  readonly from: string;
  readonly to: string;
  readonly length: string;
  /** The far atom's image as a CIF site-symmetry code ("2_554"), when it is not the atom as listed. */
  readonly image?: string;
}

/** How the magnetic group is named in the report. */
export interface ReportGroup {
  /** Display symbol, e.g. "Cm′cm′" or "isotropy subgroup of Γ2 ⊕ Γ3". */
  readonly symbol: string;
  /** e.g. "BNS 63.462 · OG 63.9.520". */
  readonly numbers?: string;
  /** Setting transformation when identified off-standard. */
  readonly setting?: string;
  /** Index of the group in the grey group, when known. */
  readonly index?: number;
}

export interface ReportMagnetic {
  /** The model with its moments applied (the arrangement to draw and tabulate). */
  readonly magnetic: MagneticModel;
  readonly k: Vec3;
  readonly group: ReportGroup;
  /** Moment parameters (mode amplitudes), values set, esds when jointly refined. */
  readonly params: readonly RefinementParameter[];
  /** Provenance sentence: refined jointly · moments-only fit · candidate. */
  readonly status: string;
  /** What the data cannot determine about the moments (a powder's averaging), shown with them. */
  readonly limits?: readonly string[];
  /** The parent structure the moments decorate; defaults to the primary phase. */
  readonly structure?: StructureModel;
}

export type ReportFigure =
  | {
      readonly kind: "pattern";
      readonly curves: FigureCurves;
      readonly xLabel: string;
      readonly yLabel?: string;
      readonly ticks?: readonly FigureTickRow[];
      readonly fitRange?: { readonly min: number; readonly max: number };
      readonly caption?: string;
      readonly observedAs?: "dots" | "line";
    }
  | {
      readonly kind: "fobsFcalc";
      readonly points: readonly FobsFcalcPoint[];
      readonly caption?: string;
    };

/** One step of the analysis, from the project's History. */
export interface ReportStep {
  readonly label: string;
  /** Who took it: the Agent or the user. */
  readonly by: "agent" | "user";
  /** History step kind (load, settings, edit, refine, magnetic, open). */
  readonly kind: string;
  /** Agreement after the step, when it was a refinement (fractions). */
  readonly wR?: number;
  readonly gof?: number;
  readonly free: number;
  /** A refinement's free parameters, grouped: "scale, background ×4, cell ×2". */
  readonly refined?: string;
  /** The method stages those parameters belong to — the reason in the method's terms. */
  readonly stages?: string;
}

/** A check the engine made on the result (never a model's judgement). */
export interface ReportCheck {
  readonly name: string;
  readonly status: "pass" | "note" | "warn";
  readonly detail: string;
}

/** One parameter's posterior from the Bayesian check (the engine's sampler). */
export interface ReportPosteriorRow {
  readonly label: string;
  readonly refined: number;
  readonly esd?: number;
  readonly median: number;
  readonly ci68: readonly [number, number];
  readonly ci95: readonly [number, number];
  /** Posterior width over the least-squares esd. */
  readonly esdRatio?: number;
  /** The engine's reading: the esd stands, a limit only, wider than the esd, … */
  readonly verdict: string;
}

/** The Bayesian check (ensemble MCMC over a refinement's free parameters). */
export interface ReportPosterior {
  /** Set when the run sampled an earlier refinement than the final one: which, and how far its values moved since. */
  readonly earlier?: string;
  readonly convergence: "converged" | "close" | "not converged";
  readonly walkers: number;
  readonly steps: number;
  readonly samples: number;
  readonly maxRHat: number;
  readonly minEss: number;
  readonly rows: readonly ReportPosteriorRow[];
  /** Differences the Agent asked about, as the engine read them. */
  readonly differences: readonly string[];
}

/**
 * How an analysis run with the in-app Agent was done: its steps (the History),
 * the method's stages, the engine's checks and open issues, and the notes the
 * Agent kept. Only `narrative` is a model's text, and the report says so.
 */
export interface ReportAgent {
  /** The model and how it was reached, e.g. "Claude Opus 5.5 · API key". */
  readonly model: string;
  readonly method?: { readonly skill: string; readonly stages: readonly { readonly label: string; readonly done: boolean; readonly optional: boolean }[] };
  readonly steps: readonly ReportStep[];
  /** The agreement factor the steps carry: "wR" (powder, with a GoF) or "Rw" (PDF, none). */
  readonly agreementLabel?: string;
  /** History steps on branches the analysis left (not on the path to the result). */
  readonly otherBranches?: number;
  /** The agreement before the Agent's first refinement (fractions; R1 on the single-crystal page). */
  readonly start?: { readonly agreement: number; readonly r1?: number };
  readonly checks: readonly ReportCheck[];
  readonly posterior?: ReportPosterior | null;
  readonly openIssues: readonly string[];
  readonly notes: readonly string[];
  /** The Agent's own account of what it did and found. */
  readonly narrative?: string;
  /** Numbers in the narrative that match no value the report computed (reportAudit.ts): marked where they appear. */
  readonly unverified?: readonly string[];
}

/** "Before the Copilot's first refinement: wR2 25.61 %, R1 12.34 %." */
export function startText(start: NonNullable<ReportAgent["start"]>, label: string): string {
  return `Before the Copilot's first refinement: ${label} ${(100 * start.agreement).toFixed(2)} %${start.r1 !== undefined ? `, R1 ${(100 * start.r1).toFixed(2)} %` : ""}.`;
}

/**
 * A boxcar scan (PDF): the model refined box by box across r. Each row is a
 * box — its r range, Rw and the tracked values (a site's bond lengths in the
 * structure that box refined, or the free parameters' values).
 */
export interface ReportBoxcar {
  /** Box width (Å). */
  readonly width: number;
  /** The parameters refined in each box (labels). */
  readonly free: readonly string[];
  /** What the value columns hold, e.g. "Mn1–O6 ×2 (Å)". */
  readonly columns: readonly string[];
  readonly rows: readonly { readonly r: readonly [number, number]; readonly rw: number; readonly values: readonly number[] }[];
  /** Decimals for the value columns (4 for lengths in Å). */
  readonly decimals: number;
}

export interface ReportInput {
  readonly technique: ReportTechnique;
  /** The material / structure name. */
  readonly title: string;
  /** One line under the title: probe · instrument · data file. */
  readonly subtitle?: string;
  /** A one-sentence plain-language summary (the frozen layout's; the Result paragraph's fallback). */
  readonly summary?: string;
  readonly date?: Date;
  readonly appVersion?: string;
  readonly stats: readonly ReportStat[];
  /** The agreement indices of the Fit line; the stats stand in without them. */
  readonly indices?: readonly ReportIndex[];
  /** The app's judgment of the fit: the Result paragraph and the caveats (reportResult.ts). */
  readonly assessment?: ReportAssessment | null;
  readonly data: readonly ReportRow[];
  readonly phases: readonly ReportPhase[];
  readonly magnetic?: ReportMagnetic | null;
  readonly figure?: ReportFigure | null;
  /** The last boxcar scan of this model (PDF), when one was run. */
  readonly boxcar?: ReportBoxcar | null;
  /** Every parameter of the model, with esds merged in where the fit gave one. */
  readonly parameters: readonly RefinementParameter[];
  readonly result?: RefinementResult | null;
  /** Method notes: how the agreement factors, weights, and models are defined. */
  readonly notes?: readonly string[];
  readonly warnings?: readonly string[];
  /** The analysis as the in-app Agent ran it, when it did. */
  readonly agent?: ReportAgent | null;
}

// ---------------------------------------------------------------------------
// Formatting

export const fixed = (v: number, d: number): string => {
  const s = v.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
};

/** Significant-figure formatting that never prints "1e-7"-style exponents for ordinary values. */
export function sig(v: number, digits = 5): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(Math.max(1, digits - 1));
  const d = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
  return fixed(v, Math.min(d, 8));
}

const EIGHT_PI2 = 8 * Math.PI * Math.PI;

/** Decimal places by parameter kind. */
const KIND_DECIMALS: Partial<Record<ParameterKind, number>> = {
  cellLength: 5, cellAngle: 4,
  atomX: 5, atomY: 5, atomZ: 5, positionShift: 5,
  occupancy: 4, bIso: 4, uAniso: 5,
  momentX: 3, momentY: 3, momentZ: 3, momentMode: 3, propagationK: 5,
  zeroShift: 4, tofCalibration: 3,
  qdamp: 4, qbroad: 4, delta1: 4, delta2: 4, sratio: 4, rcut: 3, spdiameter: 2, corrLength: 2, mpdfPsigma: 4,
};

export const KIND_UNIT: Partial<Record<ParameterKind, string>> = {
  cellLength: "Å", cellAngle: "°",
  positionShift: "shift (frac.)", bIso: "Å²", uAniso: "Å²", ridingTorsion: "°",
  momentX: "µB", momentY: "µB", momentZ: "µB", momentMode: "µB", propagationK: "(r.l.u.)",
  zeroShift: "° 2θ", sampleDisplacement: "µm",
  qdamp: "Å⁻¹", qbroad: "Å⁻¹", delta1: "Å", delta2: "Å²", rcut: "Å", spdiameter: "Å", corrLength: "Å", mpdfPsigma: "Å",
  tofCalibration: "µs", stephensStrain: "×10⁻⁶", mustrainIso: "×10⁻⁶", mustrainPar: "×10⁻⁶", mustrainPerp: "×10⁻⁶",
};

/** value(su) when the fit gave an esd; otherwise a kind-appropriate precision. */
export function formatParameterValue(p: RefinementParameter, decimals?: number): string {
  const d = decimals ?? KIND_DECIMALS[p.kind];
  if (p.esd !== undefined && Number.isFinite(p.esd) && p.esd > 0) return formatWithEsd(p.value, p.esd, d ?? 5);
  return d !== undefined ? fixed(p.value, d) : sig(p.value);
}

/**
 * A parameter as the report's table shows it: on a single crystal an
 * isotropic displacement reads as U_iso (Å²), SHELXL's and the CIF's
 * convention, B/8π² with its esd and bounds.
 */
export function shownParameter(p: RefinementParameter, technique: ReportTechnique): { readonly parameter: RefinementParameter; readonly value: string } {
  if (technique !== "singleCrystal" || p.kind !== "bIso") return { parameter: p, value: formatParameterValue(p) };
  const u = (v: number): number => v / EIGHT_PI2;
  const parameter: RefinementParameter = {
    ...p, label: p.label.replace(/\bB\b/, "U_iso"), value: u(p.value), initialValue: u(p.initialValue),
    ...(p.min !== undefined ? { min: u(p.min) } : {}), ...(p.max !== undefined ? { max: u(p.max) } : {}), ...(p.esd !== undefined ? { esd: u(p.esd) } : {}),
  };
  return { parameter, value: formatParameterValue(parameter, 5) };
}

export interface ParameterGroup {
  readonly title: string;
  readonly kinds: readonly ParameterKind[];
}

export const PARAMETER_GROUPS: readonly ParameterGroup[] = [
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
export function parameterGroups(technique: ReportTechnique): readonly ParameterGroup[] {
  return technique === "singleCrystal" ? SINGLE_CRYSTAL_GROUPS : PARAMETER_GROUPS;
}

/** A parameter's state in words: refined, fixed, or the tie it follows. */
export function parameterStatus(p: RefinementParameter): string {
  if (p.expression) return `tied · ${p.expression.trim().startsWith("=") ? p.expression.trim() : `= ${p.expression}`}`;
  return p.fixed ? "fixed" : "refined";
}

/** Kinds the structure and magnetic tables carry, or the appendix keeps (the background coefficients). */
const KINDS_SHOWN_ELSEWHERE: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  "cellLength", "cellAngle", "atomX", "atomY", "atomZ", "positionShift", "occupancy", "bIso", "uAniso",
  "momentX", "momentY", "momentZ", "momentMode", "background",
]);

/**
 * The refined values the Fit section lists: every free parameter (not
 * fixed, not tied) the structure and moment tables do not already carry,
 * background coefficients aside — the scales, the profile, the extinction,
 * the twin fractions, the PDF envelope. Every parameter is in the appendix.
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

/** What the appendix holds, under its heading. */
export const APPENDIX_NOTE = "The record behind the report, for reproducing it: the data and the model, the refinement's statistics, how the analysis went step by step, every parameter (fixed or refined), the conventions and the software.";

/** What the covalent bond table says about its lengths. */
export const COVALENT_BONDS_NOTE = "Covalent bonds at the refined positions (atoms closer than their covalent radii and 0.4 Å), each once; the esds from the refined positions' and, for a cell held fixed, from the structure file's cell esds (each independent cell parameter moved by its esd, as SHELXL adds them). A riding hydrogen's bond is set by its constraint. [k_abc] marks an image of the atom listed: operation k of the symmetry list, moved by the lattice translation (a − 5, b − 5, c − 5), as a CIF's site-symmetry code.";

/** What the ring-centroid lines say. */
export const RING_NOTE = "Cg: the centroid of a planar ring (each atom within 0.1 Å of its least-squares plane). A metal within 3.6 Å of one, an N–H or O–H whose hydrogen points at one within 3.0 Å (X–H···Cg above 120°), and the angle at a metal between its two nearest centroids; [k_abc] marks the centroid's image by its CIF site-symmetry code. No esds.";

/** What the hydrogen-bond lines say. */
export const HBOND_NOTE = "D–H···A with H···A shorter than the two atoms' van der Waals radii and D–H···A above 110°, as SHELXL's HTAB finds them, D an N, O, F or S; a riding hydrogen's D–H is set by its constraint; [k_abc] marks the acceptor's image. No esds.";

/** A molecular structure's bonds, one row per site: "S1A: S2A 2.0222(5) · C6A 1.7868(13)". */
export function covalentBondRows(bonds: readonly ReportBond[]): { site: string; bonds: string }[] {
  const rows = new Map<string, string[]>();
  for (const b of bonds) rows.set(b.from, [...(rows.get(b.from) ?? []), `${b.to}${b.image ? ` [${b.image}]` : ""} ${b.length}`]);
  return [...rows].map(([site, list]) => ({ site, bonds: list.join(" · ") }));
}

/** How the scan was run, under its table. */
export function boxcarNote(b: ReportBoxcar): string {
  return `${b.rows.length} boxes of ${fixed(b.width, 2)} Å, each refining ${b.free.join(", ")} from the previous box's values. A value that drifts with r, or an Rw that rises at low r, is a local structure the average model lacks. No esds per box.`;
}

/** How the convergence of a posterior run reads. */
export function posteriorStatus(p: ReportPosterior): string {
  const run = `${p.earlier ? "of an earlier refinement · " : ""}ensemble MCMC, ${p.walkers} walkers × ${p.steps} steps, ${p.samples} samples kept · R̂max ${p.maxRHat.toFixed(3)} · ESS min ${Math.round(p.minEss)}`;
  return p.convergence === "converged" ? `${run} · converged` : p.convergence === "close" ? `${run} · close to converged` : `${run} · not converged`;
}

/** The posterior's caveat line: what the intervals may be used for. */
export function posteriorCaveat(p: ReportPosterior): string {
  const use = p.convergence === "converged"
    ? ""
    : p.convergence === "close"
      ? "Close to converged (R̂ < 1.1): the intervals say whether a value is determined, but are not final values to quote. "
      : "Not converged: the intervals are not to be read. ";
  const when = p.earlier ? `Of an earlier refinement: ${p.earlier}; the other parameters were held at their values then. ` : "";
  return `${when}${use}Uniform priors within each parameter's bounds; the noise scale is marginalized (the Bayesian counterpart of scaling the esds by the GoF). The intervals hold within this model: a systematic misfit leaves them as overconfident as the esds.`;
}

/** What the account's footnote says about whose words are whose. */
export const ACCOUNT_NOTE = "Written by MATERIA Copilot in its own words, as are its notes (in the appendix, with the model that wrote them). Every other number in this report — the steps, the checks, the parameters, the agreement factors and the figure — comes from the refinement engine and the project's History, not from the model.";

/** What the composed Result paragraph says about whose words it is. */
export const COMPOSED_NOTE = "Composed by MATERIA from its own readings of this fit; no model wrote it.";

/** The software and the date behind the report, for the appendix. */
export function softwareRows(input: ReportInput, date: string): ReportRow[] {
  return [
    { label: "Program", value: `MATERIA Workbench${input.appVersion ? ` v${input.appVersion}` : ""}` },
    { label: "Report written", value: date },
    ...(input.agent ? [{ label: "Analysed with", value: `MATERIA Copilot · ${input.agent.model}` }] : []),
    ...(input.result ? [{ label: "Engine", value: `${input.result.status}${input.result.history.length > 0 ? ` after ${input.result.history.length} cycle${input.result.history.length === 1 ? "" : "s"}` : ""}` }] : []),
  ];
}

/** The space group of a phase as a heading gives it, with its number. */
export function phaseSymmetry(structure: StructureModel): { readonly symbol: string | undefined; readonly number: number | undefined } {
  return { symbol: spaceGroupSymbol(structure.spaceGroup), number: spaceGroupNumber(structure) };
}

/** A phase's role, as its heading names it. */
export function phaseRole(phase: ReportPhase, index: number, total: number): string | undefined {
  return phase.role ?? (total > 1 ? (index === 0 ? "primary phase" : `phase ${index + 1}`) : undefined);
}

/**
 * The lines of "Quality and caveats": the app's judgment (the acceptance
 * checks, the causes of misfit, the correlations), the page's limitations,
 * and the Agent's open issues when it ran the analysis.
 */
export function qualityItems(input: ReportInput): ReportCaveat[] {
  return [
    ...(input.assessment?.caveats ?? []),
    ...(input.warnings ?? []).map((w): ReportCaveat => ({ tone: "warn", label: "Limitation", text: w })),
    ...(input.agent?.openIssues ?? []).map((t): ReportCaveat => {
      const m = /^([^:]{2,40}): (.+)$/.exec(t);
      return m ? { tone: "warn", label: m[1]!, text: m[2]! } : { tone: "warn", label: "Open issue", text: t };
    }),
  ];
}

/** The stats as agreement indices, when the page gave none of its own. */
export function indicesOf(input: ReportInput): readonly ReportIndex[] {
  if (input.indices?.length) return input.indices;
  return input.stats.map((s) => ({ symbol: s.label, value: s.value, ...(s.hint ? { hint: s.hint } : {}) }));
}

/** The moment table's rows: each sublattice's anchor position, its components along a, b, c and |m|. */
export function momentRows(m: ReportMagnetic, structure: StructureModel): { key: string; site: string; orbit: number; position: readonly [number, number, number]; components: readonly [number, number, number]; magnitude: number }[] {
  return m.magnetic.moments.map((mm) => {
    const site = structure.sites.find((s) => s.label === mm.siteLabel);
    const pos = site
      ? momentAnchorPosition(structure.spaceGroup.operations, m.magnetic.operations ?? structure.spaceGroup.operations, site.position, mm.orbitIndex, mm.position)
      : mm.position ?? [0, 0, 0];
    const cart = crystalComponentsToCartesian(structure.cell, mm.components);
    const orbit = mm.orbitIndex && mm.orbitIndex > 1 ? mm.orbitIndex : 1;
    return {
      key: orbit > 1 ? `${mm.siteLabel}#${orbit}` : mm.siteLabel,
      site: mm.siteLabel,
      orbit,
      position: [pos[0]!, pos[1]!, pos[2]!] as const,
      components: [mm.components[0]!, mm.components[1]!, mm.components[2]!] as const,
      magnitude: Math.hypot(cart[0]!, cart[1]!, cart[2]!),
    };
  });
}

/** A moment anchor's coordinate: a fraction where it is one (within a CIF's rounding), else four decimals. */
export const anchorCoordinate = (v: number): string => asFraction(v, 5e-5) ?? fixed(v, 4);

/** The magnetic facts in one line: k, the group with its numbers and setting, the parent, the magnetic cell. */
export function magneticFacts(m: ReportMagnetic, structure: StructureModel): { k: string; group: string; numbers?: string; setting?: string; index?: number; parent?: string; cell: string; ordered: string } {
  const supercell = magneticSupercell(m.k);
  const isSuper = supercell.some((n) => n > 1);
  const carried = m.magnetic.moments.filter((mm) => mm.components.some((c) => c !== 0));
  const parent = structure.spaceGroup.hermannMauguin;
  return {
    k: kLabel(m.k),
    // Time reversal as the prime it is (′), whatever the source wrote.
    group: m.group.symbol.replace(/'/g, "′"),
    ...(m.group.numbers ? { numbers: m.group.numbers } : {}),
    ...(m.group.setting ? { setting: m.group.setting } : {}),
    ...(m.group.index !== undefined ? { index: m.group.index } : {}),
    ...(parent ? { parent } : {}),
    cell: isSuper ? `${supercell.join(" × ")} supercell of the nuclear cell` : "the nuclear cell (k = 0)",
    ordered: `${carried.length} of ${m.magnetic.moments.length} sublattice${m.magnetic.moments.length === 1 ? "" : "s"} ordered`,
  };
}

// ---------------------------------------------------------------------------
// HTML pieces

/** A number for a table or a line: escaped, with the minus sign. */
const num = (text: string): string => minus(esc(text));

/** Prose the engine wrote: escaped, symbols typeset ({{R_wp}}), minus signs set. */
export function proseHtml(text: string): string {
  return formulasInText(minus(esc(text)).replace(/(\d) (%|Å|µB|°C|K\b)/g, "$1&nbsp;$2"), (c) => `<sub>${c}</sub>`).replace(/\{\{([^}]+)\}\}/g, (_m, s: string) => symbolHtml(s));
}

/** A table column: its heading (HTML), and whether it holds numbers (aligned on the decimal point). */
interface Col {
  readonly head: string;
  readonly num?: boolean;
  /** A class for the column's cells (e.g. "lbl"). */
  readonly cls?: string;
}

/**
 * A booktabs table: a top and a bottom rule, a light rule under the head, no
 * vertical lines. Number columns are aligned on the decimal point (or a
 * fraction's slash): each cell is split there, the two parts set in boxes as
 * wide as the column's widest, so the points line up with tabular figures.
 * Number cells are given as text; the others as HTML.
 */
function table(cols: readonly Col[], rows: readonly (readonly string[])[], cls = ""): string {
  const width = cols.map((c, i) => {
    if (!c.num) return null;
    let int = 0;
    let frac = 0;
    let neg = false;
    for (const r of rows) {
      const t = minus(r[i] ?? "");
      const [a, b] = splitAtPoint(t);
      int = Math.max(int, [...a].length);
      frac = Math.max(frac, [...b].length);
      neg ||= a.includes("−");
    }
    return { int: int + (neg ? 0.3 : 0), frac };
  });
  const cell = (text: string, i: number): string => {
    const c = cols[i]!;
    const w = width[i];
    if (!c.num || !w) return `<td${c.cls ? ` class="${c.cls}"` : ""}>${text}</td>`;
    if (!text) return `<td class="n"></td>`;
    const [a, b] = splitAtPoint(minus(text));
    return `<td class="n"><span class="ip" style="min-width:${w.int}ch">${esc(a)}</span><span class="fp" style="min-width:${w.frac}ch">${esc(b)}</span></td>`;
  };
  return `<table class="bt${cls ? ` ${cls}` : ""}"><thead><tr>${cols.map((c) => `<th${c.num ? ' class="n"' : ""}>${c.head}</th>`).join("")}</tr></thead><tbody>
${rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("\n")}
</tbody></table>`;
}

/** A label / value list (the appendix's records). */
function kvHtml(rows: readonly ReportRow[]): string {
  return `<dl class="kv">${rows.map((r) => `<dt>${esc(r.label)}</dt><dd>${minus(esc(r.value))}</dd>`).join("")}</dl>`;
}

/** The cell line: italic symbols, the values with their esds, the units. */
function cellLineHtml(phase: ReportPhase): string {
  return cellTerms(phase).map((t) => `<span class="nw">${t.symbols.map((s) => `<i>${s}</i>`).join(" = ")} = ${num(t.value)}${t.unit === "°" ? "°" : `&nbsp;${t.unit}`}</span>`).join(", ");
}

function atomTableHtml(t: AtomTable): string {
  const cols: Col[] = [
    { head: "Site", cls: "lbl" },
    ...(t.type ? [{ head: "Type" }] : []),
    ...(t.wyckoff ? [{ head: "Wyckoff" }] : []),
    { head: "<i>x</i>", num: true }, { head: "<i>y</i>", num: true }, { head: "<i>z</i>", num: true },
    { head: "Occ.", num: true },
    { head: `<i>${t.adp.symbol}</i><sub>${t.adp.sub}</sub> (Å²)`, num: true },
    ...(t.aniso ? [{ head: "ADP" }] : []),
  ];
  const rows = t.rows.map((r) => [
    esc(r.label),
    ...(t.type ? [esc(r.type)] : []),
    ...(t.wyckoff ? [esc(r.wyckoff ?? "")] : []),
    r.x, r.y, r.z, r.occupancy, r.adp,
    ...(t.aniso ? [r.adpKind] : []),
  ]);
  return table(cols, rows, "atoms");
}

/** Each cation's shell as a small table, side by side. */
function shellsHtml(structure: StructureModel): string {
  const shells = shellTables(structure);
  if (shells.length === 0) return "";
  return `<div class="bonds">${shells.map((sh) => table(
    [{ head: `${esc(sh.site)}–`, cls: "lbl" }, { head: "<i>d</i> (Å)", num: true }, { head: "" }],
    [...sh.bonds.map((b) => [esc(b.to), b.distance, b.count > 1 ? `×${b.count}` : ""]), [`<span class="muted">mean</span>`, sh.mean, ""]],
    "mini",
  )).join("")}</div>`;
}

/** A molecule's covalent bonds as short tables side by side. */
function covalentHtml(bonds: readonly ReportBond[]): string {
  if (bonds.length === 0) return "";
  const rows = bonds.map((b) => [`${esc(b.from)}–${esc(b.to)}${b.image ? ` <span class="muted">[${esc(b.image)}]</span>` : ""}`, b.length.replace(/ \(riding\)$/, ""), / \(riding\)$/.test(b.length) ? `<span class="muted">riding</span>` : ""]);
  const per = Math.max(8, Math.ceil(rows.length / 3));
  const chunks: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += per) chunks.push(rows.slice(i, i + per));
  return `<div class="bonds">${chunks.map((c) => table([{ head: "Bond", cls: "lbl" }, { head: "<i>d</i> (Å)", num: true }, { head: "" }], c, "mini")).join("")}</div>`;
}

function moleculeExtrasHtml(phase: ReportPhase): string {
  const parts: string[] = [];
  if (phase.rings && phase.rings.contacts.length > 0) parts.push(`<p class="small"><span class="runin">Ring centroids.</span> ${esc(phase.rings.rings.join("; "))}. ${esc(phase.rings.contacts.join(" · "))}.</p>`);
  if (phase.hydrogenBonds && phase.hydrogenBonds.length > 0) parts.push(`<p class="small"><span class="runin">Hydrogen bonds.</span> ${esc(phase.hydrogenBonds.join(" · "))}.</p>`);
  return parts.join("\n");
}

function phaseHtml(phase: ReportPhase, index: number, total: number, technique: ReportTechnique): { html: string; table: AtomTable } {
  const st = phase.structure;
  const { symbol, number } = phaseSymmetry(st);
  const role = phaseRole(phase, index, total);
  const t = atomTable(phase, technique);
  const meta = [number !== undefined ? `No. ${number}` : "", role ?? "", phase.fraction ?? ""].filter(Boolean).join(" · ");
  const head = `<h3>${formulaHtml(st.name || st.id)}<span class="sgsym">${symbol ? spaceGroupHtml(symbol) : "no symbol"}</span>${meta ? `<span class="meta">${num(meta)}</span>` : ""}</h3>`;
  const distances = phase.bonds ? covalentHtml(phase.bonds) : shellsHtml(st);
  return {
    html: `<div class="phase">
${head}
<p class="cell">${cellLineHtml(phase)}</p>
${atomTableHtml(t)}
${distances}${moleculeExtrasHtml(phase)}
</div>`,
    table: t,
  };
}

function structureHtml(input: ReportInput): string {
  if (input.phases.length === 0) return "";
  const built = input.phases.map((p, i) => phaseHtml(p, i, input.phases.length, input.technique));
  const flags: AtomTable = { ...built[0]!.table, symmetryFixed: built.some((b) => b.table.symmetryFixed), held: built.some((b) => b.table.held) };
  const shells = input.phases.some((p) => !p.bonds && shellTables(p.structure).length > 0);
  const covalent = input.phases.some((p) => p.bonds && p.bonds.length > 0);
  const molecule = input.phases.find((p) => p.rings?.contacts.length || p.hydrogenBonds?.length);
  const notes = [
    atomTableNote(flags),
    ...(shells ? [SHELL_NOTE] : []),
    ...(covalent ? [COVALENT_BONDS_NOTE] : []),
    ...(molecule?.rings?.contacts.length ? [RING_NOTE] : []),
    ...(molecule?.hydrogenBonds?.length ? [HBOND_NOTE] : []),
  ];
  return `${built.map((b) => b.html).join("\n")}
<p class="note">${notes.map(esc).join(" ")}</p>`;
}

function magneticHtml(m: ReportMagnetic, fallback: StructureModel | undefined): string {
  const structure = m.structure ?? fallback;
  if (!structure) return "";
  const { svg, subKeys } = magneticProjectionSvg(structure, m.magnetic, m.k);
  const f = magneticFacts(m, structure);
  const supercell = magneticSupercell(m.k);
  const isSuper = supercell.some((n) => n > 1);
  const rows = momentRows(m, structure);
  const facts = [
    `<i>k</i> = ${esc(f.k)}`,
    `magnetic space group ${esc(f.group)}${f.numbers ? ` <span class="muted">(${esc(f.numbers)})</span>` : ""}`,
    ...(f.setting ? [`setting ${esc(f.setting)}`] : []),
    ...(f.index !== undefined ? [`index ${f.index}`] : []),
    ...(f.parent ? [`parent ${spaceGroupHtml(f.parent)}`] : []),
    `magnetic cell: ${esc(f.cell)}`,
    esc(f.ordered),
  ].join(" · ");
  const swatch = (key: string): string => `<span class="sw" style="background:${SUBLATTICE_COLORS[Math.max(0, subKeys.indexOf(key)) % SUBLATTICE_COLORS.length]}"></span>`;
  const moments = table(
    [{ head: "Site", cls: "lbl" }, { head: "<i>x</i>", num: true }, { head: "<i>y</i>", num: true }, { head: "<i>z</i>", num: true }, { head: "<i>m<sub>a</sub></i>", num: true }, { head: "<i>m<sub>b</sub></i>", num: true }, { head: "<i>m<sub>c</sub></i>", num: true }, { head: "|<i>m</i>| (µ<sub>B</sub>)", num: true }],
    rows.map((r) => [`${swatch(r.key)}${esc(r.site)}${r.orbit > 1 ? ` <span class="muted">orbit ${r.orbit}</span>` : ""}`, ...r.position.map(anchorCoordinate), ...r.components.map((c) => fixed(c, 3)), fixed(r.magnitude, 3)]),
    "atoms",
  );
  const params = m.params.length > 0
    ? table([{ head: "Moment parameter", cls: "lbl" }, { head: "Value (µ<sub>B</sub>)", num: true }, { head: "" }], m.params.map((p) => [esc(p.label), formatParameterValue(p), `<span class="muted">${esc(parameterStatus(p))}</span>`]), "mini")
    : "";
  const limits = (m.limits ?? []).length > 0 ? `<ul class="plain small">${m.limits!.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
  return `<p class="cell">${facts}</p>
<p>${esc(m.status)}</p>
${moments}
<div class="pair">
  <figure class="fig mag">${svg}<figcaption>${isSuper ? `Magnetic supercell ${supercell.join(" × ")} of the nuclear cell` : "One unit cell"}, projected down <i>c</i>*. Arrows: the in-plane moment, length ∝ |<i>m</i>|; ⊙ / ⊗ a component out of / into the page. Filled atoms lie in the lower half of the cell, outlined ones in the upper half.</figcaption></figure>
  <div>${params}${limits}<p class="note">Components along <i>a</i>, <i>b</i>, <i>c</i> in µ<sub>B</sub> per unit cell length; |<i>m</i>| through the cell metric.</p></div>
</div>`;
}

function figureHtml(fig: ReportFigure): string {
  if (fig.kind === "pattern") {
    const svg = patternFigureSvg(fig.curves, {
      xLabel: fig.xLabel,
      ...(fig.yLabel !== undefined ? { yLabel: fig.yLabel } : {}),
      ...(fig.ticks ? { ticks: fig.ticks } : {}),
      ...(fig.fitRange ? { fitRange: fig.fitRange } : {}),
      ...(fig.observedAs ? { observedAs: fig.observedAs } : {}),
    });
    if (!svg) return "";
    return `<figure class="fig">${svg}${fig.caption ? `<figcaption>${esc(fig.caption)}</figcaption>` : ""}</figure>`;
  }
  if (fig.points.length === 0) return "";
  return `<figure class="fig square">${fobsFcalcSvg(fig.points)}${fig.caption ? `<figcaption>${esc(fig.caption)}</figcaption>` : ""}</figure>`;
}

/** The agreement indices in one line: "R_wp = 4.01 %, R_exp = 1.31 %, … · 3125 points · 9 free parameters". */
function indicesHtml(indices: readonly ReportIndex[]): string {
  if (indices.length === 0) return "";
  const values = indices.filter((i) => !i.count).map((i) => `<span class="nw"${i.hint ? ` title="${esc(i.hint)}"` : ""}>${symbolHtml(i.symbol)} = ${num(i.value)}</span>`);
  const counts = indices.filter((i) => i.count).map((i) => `<span class="nw"${i.hint ? ` title="${esc(i.hint)}"` : ""}>${num(i.value)} ${esc(i.symbol)}</span>`);
  return `<p class="indices">${values.join(", ")}${counts.length ? `${values.length ? " · " : ""}${counts.join(" · ")}` : ""}</p>`;
}

function otherValuesHtml(params: readonly RefinementParameter[], technique: ReportTechnique): string {
  const rows = summaryParameters(params, technique).map((p) => shownParameter(p, technique)).map(({ parameter: p, value }) => [esc(p.label), value, `<span class="muted">${esc(KIND_UNIT[p.kind] ?? "")}</span>`]);
  if (rows.length === 0) return "";
  const per = rows.length > 10 ? Math.ceil(rows.length / 2) : rows.length;
  const chunks: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += per) chunks.push(rows.slice(i, i + per));
  return `<h3>Other refined values</h3>
<div class="bonds">${chunks.map((c) => table([{ head: "Parameter", cls: "lbl" }, { head: "Value", num: true }, { head: "Unit" }], c, "mini")).join("")}</div>`;
}

function boxcarHtml(b: ReportBoxcar): string {
  const rows = b.rows.map((row) => [`${fixed(row.r[0], 2)}–${fixed(row.r[1], 2)}`, fixed(100 * row.rw, 2), ...row.values.map((v) => (Number.isFinite(v) ? fixed(v, b.decimals) : "—"))]);
  return `<h3 id="local">Local versus average: boxcar scan</h3>
${table([{ head: "<i>r</i> (Å)" }, { head: "<i>R</i><sub>w</sub> (%)", num: true }, ...b.columns.map((c) => ({ head: esc(c), num: true }))], rows)}
<p class="note">${esc(boxcarNote(b))}</p>`;
}

/** A caveat's text ends as a sentence does. */
export const endSentence = (t: string): string => (/[.!?)…]$/.test(t.trim()) || !t.trim() ? t.trim() : `${t.trim()}.`);

const TONE_LABEL: Record<ReportTone, string> = { ok: "met", note: "note", warn: "attention", bad: "blocker", info: "context" };

function qualityHtml(input: ReportInput): string {
  const items = qualityItems(input);
  const list = items.length > 0
    ? `<ul class="caveats">${items.map((c) => `<li class="t-${c.tone}"><span class="dot" title="${TONE_LABEL[c.tone]}"></span><span class="lbl">${minus(esc(c.label))}</span> ${proseHtml(endSentence(c.text))}</li>`).join("\n")}</ul>`
    : "";
  const posterior = input.agent?.posterior ? posteriorHtml(input.agent.posterior) : "";
  return list || posterior ? `${list}${posterior}` : "";
}

const UNVERIFIED = (t: string): string => `<span class="unverified" title="Not among the values this report computed">${t}</span>`;

/** The narrative as paragraphs: blank lines separate them; nothing else is interpreted. Unverified numbers are marked. */
function paragraphs(text: string, unverified: readonly string[]): string {
  return text.trim().split(/\n\s*\n/).map((p) => `<p>${markNumbers(esc(p.trim()), unverified, UNVERIFIED).replace(/\n/g, "<br>")}</p>`).join("");
}

function resultHtml(input: ReportInput): string {
  const a = input.agent;
  if (a?.narrative?.trim()) {
    const unverified = a.unverified ?? [];
    const note = `${esc(ACCOUNT_NOTE)}${unverified.length > 0 ? ` <span class="unverified">Underlined</span> numbers in the Copilot's words are not among the values this report computed.` : ""}`;
    return `<div class="account"><p class="byline">The Copilot's account</p>${paragraphs(a.narrative, unverified)}</div>
<p class="note">${note}</p>`;
  }
  if (input.assessment?.result) return `<p class="lede">${proseHtml(input.assessment.result)}</p>\n<p class="note">${esc(COMPOSED_NOTE)}</p>`;
  return input.summary ? `<p class="lede">${esc(input.summary)}</p>` : "";
}

function posteriorHtml(p: ReportPosterior): string {
  const rows = p.rows.map((r) => [
    esc(r.label), formatWithEsd(r.refined, r.esd, 5), sig(r.median, 3),
    `${sig(r.ci68[0], 3)} – ${sig(r.ci68[1], 3)}`, `${sig(r.ci95[0], 3)} – ${sig(r.ci95[1], 3)}`,
    r.esdRatio !== undefined ? r.esdRatio.toFixed(2) : "—", `<span class="small">${esc(r.verdict)}</span>`,
  ]);
  const diffs = p.differences.length > 0 ? `<ul class="plain small">${p.differences.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
  return `<h3>Bayesian check <span class="meta">${esc(posteriorStatus(p))}</span></h3>
<div class="scroll">${table([{ head: "Parameter", cls: "lbl" }, { head: "Refined", num: true }, { head: "Median", num: true }, { head: "68 %" }, { head: "95 %" }, { head: "Width/esd", num: true }, { head: "Reading" }], rows)}</div>
${diffs}<p class="note">${esc(posteriorCaveat(p))}</p>`;
}

// ---------------------------------------------------------------------------
// The appendix

const CHECK_LABEL: Record<ReportCheck["status"], string> = { pass: "pass", note: "note", warn: "attention" };

function checksTableHtml(checks: readonly ReportCheck[]): string {
  return table([{ head: "Check", cls: "lbl" }, { head: "Result" }, { head: "Detail" }], checks.map((c) => [esc(c.name), `<span class="st st-${c.status}">${CHECK_LABEL[c.status]}</span>`, minus(esc(c.detail))]), "wide");
}

/** The analysis as it went: the History's steps, the method's checklist, every check, the Copilot's notes. */
function agentRecordHtml(a: ReportAgent): string {
  const pctOf = (v: number | undefined): string => (v === undefined ? "" : (100 * v).toFixed(2));
  const anyGof = a.steps.some((st) => st.gof !== undefined);
  const steps = table(
    [{ head: "#", num: true }, { head: "Step", cls: "lbl" }, { head: "By" }, { head: "Refined" }, { head: "Free", num: true }, { head: `${esc(a.agreementLabel ?? "wR")} (%)`, num: true }, ...(anyGof ? [{ head: "GoF", num: true }] : [])],
    a.steps.map((st, i) => [
      String(i + 1),
      `${esc(st.label)}${st.stages ? `<div class="small muted">${esc(st.stages)}</div>` : ""}`,
      st.by === "agent" ? "Copilot" : `<span class="muted">user</span>`,
      `<span class="small muted">${st.refined ? esc(st.refined) : ""}</span>`,
      String(st.free), pctOf(st.wR), ...(anyGof ? [st.gof !== undefined ? st.gof.toFixed(2) : ""] : []),
    ]),
    "wide",
  );
  const stages = a.method
    ? `<p class="small">Method (the skill <code>${esc(a.method.skill)}</code>): ${a.method.stages.map((st) => `<span class="stage${st.done ? " done" : ""}">${st.done ? "✓" : "○"} ${esc(st.label)}${st.optional && !st.done ? ", if needed" : ""}</span>`).join(" ")}</p>`
    : "";
  const unverified = a.unverified ?? [];
  const notes = a.notes.length > 0 ? `<h4>The Copilot's notes</h4><ul class="plain small">${a.notes.map((t) => `<li>${markNumbers(esc(t), unverified, UNVERIFIED)}</li>`).join("")}</ul>` : "";
  const branches = a.otherBranches ? `The table follows the path to the result; ${a.otherBranches} step${a.otherBranches === 1 ? "" : "s"} on branches the analysis left ${a.otherBranches === 1 ? "is" : "are"} kept in the History, not shown.` : "";
  const start = a.start ? `<p class="note">${esc(startText(a.start, a.agreementLabel ?? "wR"))}</p>` : "";
  return `<p class="small muted">${a.steps.length} step${a.steps.length === 1 ? "" : "s"} from the History · model ${esc(a.model)}</p>
<div class="scroll">${steps}</div>
${start}${stages}${branches ? `<p class="note">${esc(branches)}</p>` : ""}
<h4>Every check</h4>
<div class="scroll">${checksTableHtml(a.checks)}</div>
${notes}`;
}

/** The refinement's own statistics, for the appendix: the counts, the engine's status, χ², the indices to more digits, null directions, every strong pair. */
export function statisticsRows(input: ReportInput): ReportRow[] {
  const r = input.result;
  const labelOf = new Map(input.parameters.map((p) => [p.id, p.label]));
  const free = input.parameters.filter((p) => !p.fixed && !p.expression).length;
  const rows: ReportRow[] = [{ label: "Free parameters", value: `${free} of ${input.parameters.length}` }];
  if (!r) return [...rows, { label: "Engine", value: "no refinement run in this session — values are as loaded or set" }];
  rows.push({ label: "Engine", value: `${r.status}${r.history.length > 0 ? ` after ${r.history.length} cycle${r.history.length === 1 ? "" : "s"}` : ""}` });
  const last = r.history[r.history.length - 1];
  if (last) rows.push({ label: "Final χ² (Σ w Δ²)", value: sig(last.chiSquared, 6) });
  if (r.agreement.rWeighted !== undefined) rows.push({ label: "Weighted R", value: `${(100 * r.agreement.rWeighted).toFixed(3)} %` });
  if (r.agreement.rExpected !== undefined) rows.push({ label: "Expected R", value: `${(100 * r.agreement.rExpected).toFixed(3)} %` });
  if (r.agreement.goodnessOfFit !== undefined) rows.push({ label: "Goodness of fit S", value: r.agreement.goodnessOfFit.toFixed(3) });
  const diag = r.diagnostics;
  if (diag?.maxShiftOverEsd !== undefined) rows.push({ label: "Largest last shift/esd", value: diag.maxShiftOverEsd.toFixed(4) });
  if (diag && diag.svdZeroCount > 0) rows.push({ label: "Null directions", value: `${diag.svdZeroCount} dropped by SVD — esds on the involved parameters are not meaningful` });
  if (diag && diag.highCorrelations.length > 0) {
    rows.push({ label: "Strong correlations (all pairs)", value: diag.highCorrelations.map((c) => `${labelOf.get(c.parameterIdA) ?? c.parameterIdA} / ${labelOf.get(c.parameterIdB) ?? c.parameterIdB} ${c.coefficient.toFixed(3)}`).join("; ") });
  }
  // The engine's message, unless it only restates the status above.
  if (r.message && !/^(converged|stopped|stalled|diverged)\b[^.;]*\b(cycles?|iterations?)(\(s\))?\W*$/i.test(r.message.trim())) rows.push({ label: "Engine note", value: r.message });
  return rows;
}

function parametersHtml(params: readonly RefinementParameter[], technique: ReportTechnique): string {
  if (params.length === 0) return `<p class="note">No parameters.</p>`;
  const seen = new Set<string>();
  const block = (title: string, rows: readonly RefinementParameter[]): string => {
    const free = rows.filter((p) => !p.fixed && !p.expression).length;
    return `<h4>${esc(title)} <span class="meta">${rows.length} parameter${rows.length === 1 ? "" : "s"}, ${free} refined</span></h4>
<div class="scroll">${table(
      [{ head: "Parameter", cls: "lbl" }, { head: "Value", num: true }, { head: "Unit" }, { head: "Status" }],
      rows.map((p) => shownParameter(p, technique)).map(({ parameter: p, value }) => [esc(p.label), value, `<span class="muted">${esc(KIND_UNIT[p.kind] ?? "")}</span>`, `<span class="muted">${esc(parameterStatus(p))}</span>`]),
    )}</div>`;
  };
  const blocks: string[] = [];
  for (const g of parameterGroups(technique)) {
    const rows = params.filter((p) => g.kinds.includes(p.kind));
    if (rows.length === 0) continue;
    rows.forEach((p) => seen.add(p.id));
    blocks.push(block(g.title, rows));
  }
  const rest = params.filter((p) => !seen.has(p.id));
  if (rest.length > 0) blocks.push(block("Other parameters", rest));
  return blocks.join("\n");
}

function conventionsHtml(input: ReportInput, date: string): string {
  const notes = (input.notes ?? []).map((n) => `<li>${minus(esc(n))}</li>`).join("");
  return `${notes ? `<h4>Conventions</h4><ul class="plain small">${notes}</ul>` : ""}<h4>Software</h4>${kvHtml(softwareRows(input, date))}`;
}

// ---------------------------------------------------------------------------
// Document

const CSS = `
  :root {
    --paper: #ffffff; --ink: #1b1f23; --soft: #59636e; --faint: #8b949e;
    --rule: #1b1f23; --rule-light: #c9d1d9; --hair: #e3e7eb; --wash: #f6f8fa;
    --accent: #1f4e79;
    --ok: #3a7d55; --note: #8b949e; --warn: #b26b00; --bad: #b42318; --info: #c3cad2;
    --obs: #1f4e79; --calc: #c23b2e; --diffc: #6e7781; --bkgc: #a3acb6; --excl: rgba(110, 119, 129, .09);
    --cellc: #8b949e; --bondc: #b8a9d4; --panel: var(--paper);
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, system-ui, sans-serif;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --fs-1: 26px; --fs-2: 17px; --fs-3: 14.5px; --fs-4: 12.5px;
    --s1: 4px; --s2: 8px; --s3: 16px; --s4: 24px; --s5: 40px;
  }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #15181c; --ink: #e4e7ea; --soft: #a4adb6; --faint: #7d8790; --rule: #c9d1d9; --rule-light: #3b424a; --hair: #2b3138; --wash: #1c2026;
            --accent: #8db4e2; --ok: #74b98d; --note: #8b949e; --warn: #e0a24e; --bad: #f07a6e; --info: #4b535c;
            --obs: #8db4e2; --calc: #f0877b; --diffc: #8b949e; --bkgc: #646d77; --excl: rgba(160, 170, 182, .10); --cellc: #6d7683; --bondc: #594d73; }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: var(--fs-3)/1.55 var(--sans); font-variant-numeric: lining-nums tabular-nums; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 900px; margin: 0 auto; padding: var(--s5) var(--s4) 64px; }
  header.masthead { padding-bottom: var(--s3); border-bottom: 1px solid var(--rule-light); margin-bottom: var(--s4); }
  .kicker { font-size: var(--fs-4); color: var(--soft); margin: 0 0 var(--s2); }
  h1 { font-size: var(--fs-1); line-height: 1.2; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 var(--s1); }
  .sub { color: var(--soft); margin: 0; }
  section { margin: 0 0 var(--s5); }
  h2 { font-size: var(--fs-2); font-weight: 600; color: var(--accent); margin: 0 0 var(--s3); letter-spacing: 0; }
  h3 { font-size: var(--fs-3); font-weight: 600; margin: var(--s4) 0 var(--s2); }
  h4 { font-size: var(--fs-4); font-weight: 600; margin: var(--s3) 0 var(--s2); }
  h2 + .phase > h3:first-child, section > h3:first-child { margin-top: 0; }
  h3 .sgsym { font-weight: 400; margin-left: 0.6em; }
  .meta { font-weight: 400; color: var(--soft); margin-left: 0.6em; font-size: var(--fs-4); }
  p { margin: 0 0 var(--s2); }
  .lede, .account p, section > p:not(.note):not(.cell):not(.indices) { max-width: 74ch; }
  .lede { font-size: 15px; line-height: 1.6; }
  .account { border-left: 2px solid var(--accent); padding-left: var(--s3); }
  .byline { font-size: var(--fs-4); color: var(--soft); margin-bottom: var(--s1); }
  .note { font-size: var(--fs-4); color: var(--soft); max-width: 90ch; margin-top: var(--s2); }
  .small { font-size: var(--fs-4); }
  .muted { color: var(--soft); }
  .runin { font-weight: 600; }
  .cell { margin: 0 0 var(--s2); }
  .indices { margin: var(--s2) 0 var(--s3); }
  .indices span + span::before { content: ""; }
  i { font-style: italic; }
  sub, sup { line-height: 0; font-size: 0.75em; }
  .nw { white-space: nowrap; }
  .ovl { text-decoration: overline; }
  .phase + .phase { margin-top: var(--s4); }
  /* booktabs */
  table.bt { border-collapse: collapse; margin: var(--s2) 0 var(--s3); font-size: var(--fs-3); line-height: 1.4; }
  table.bt thead th { border-top: 1.5px solid var(--rule); border-bottom: 0.75px solid var(--rule); font-weight: 500; text-align: left; padding: 5px 14px 4px 0; white-space: nowrap; }
  table.bt tbody tr:last-child td { border-bottom: 1.5px solid var(--rule); }
  table.bt td { padding: 3px 14px 3px 0; vertical-align: baseline; text-align: left; }
  table.bt th:last-child, table.bt td:last-child { padding-right: 0; }
  table.bt tbody tr:first-child td { padding-top: 5px; }
  table.bt tbody tr:last-child td { padding-bottom: 5px; }
  table.bt th.n { text-align: center; }
  table.bt td.n { text-align: right; white-space: nowrap; }
  td.n .ip { display: inline-block; text-align: right; }
  td.n .fp { display: inline-block; text-align: left; }
  table.bt.wide { width: 100%; }
  table.bt.wide td { vertical-align: top; }
  table.mini { margin: 0; font-size: var(--fs-4); }
  td.lbl { white-space: nowrap; }
  .bonds { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s5); align-items: flex-start; margin: var(--s2) 0 var(--s3); }
  .scroll { overflow-x: auto; }
  .kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s1) var(--s4); margin: 0; font-size: var(--fs-4); }
  .kv dt { color: var(--soft); }
  .kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .fig { margin: 0 0 var(--s2); }
  .fig svg { display: block; width: 100%; height: auto; }
  .fig.square svg { max-width: 420px; }
  figcaption { font-size: var(--fs-4); color: var(--soft); margin-top: var(--s1); max-width: 90ch; }
  .pair { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: var(--s4); align-items: start; margin-top: var(--s3); }
  .fig.mag svg { max-width: 420px; }
  @media (max-width: 720px) { .pair { grid-template-columns: 1fr; } }
  .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; vertical-align: 0; }
  ul.plain { margin: var(--s2) 0; padding-left: 18px; }
  ul.plain li { margin: 2px 0; }
  ul.caveats { list-style: none; margin: 0; padding: 0; max-width: 90ch; }
  ul.caveats li { position: relative; padding: 3px 0 3px 18px; }
  ul.caveats .dot { position: absolute; left: 2px; top: 0.72em; width: 7px; height: 7px; border-radius: 50%; background: var(--info); }
  ul.caveats .lbl { font-weight: 600; }
  ul.caveats .lbl::after { content: ":"; }
  ul.caveats .t-ok .dot { background: var(--ok); } ul.caveats .t-note .dot { background: var(--note); } ul.caveats .t-warn .dot { background: var(--warn); } ul.caveats .t-bad .dot { background: var(--bad); }
  .st { font-size: var(--fs-4); }
  .st-pass { color: var(--ok); } .st-warn { color: var(--warn); font-weight: 600; } .st-note { color: var(--soft); }
  .stage { white-space: nowrap; margin-right: 10px; }
  .stage.done { color: var(--ok); }
  .unverified { text-decoration: underline dotted var(--warn); text-underline-offset: 3px; cursor: help; }
  code { font-family: var(--mono); font-size: 0.92em; }
  .appendix { border-top: 1px solid var(--rule-light); padding-top: var(--s4); }
  .appendix details { border-bottom: 1px solid var(--hair); }
  .appendix details:first-of-type { border-top: 1px solid var(--hair); }
  .appendix summary { cursor: pointer; padding: var(--s2) 0; font-weight: 600; list-style: none; }
  .appendix summary::-webkit-details-marker { display: none; }
  .appendix summary::before { content: "▸"; display: inline-block; width: 1.1em; color: var(--soft); font-weight: 400; }
  .appendix details[open] > summary::before { content: "▾"; }
  .appendix summary .letter { color: var(--soft); font-weight: 400; margin-right: 0.5em; }
  .appendix summary .meta { margin-left: 0.5em; }
  .appendix .part { padding: 0 0 var(--s3); }
  .appendix .part > h4:first-child { margin-top: var(--s1); }
  footer { margin-top: var(--s5); padding-top: var(--s2); border-top: 1px solid var(--rule-light); font-size: var(--fs-4); color: var(--soft); line-height: 1.5; }
  /* figures */
  .frame { fill: none; stroke: var(--rule-light); stroke-width: 1; }
  .grid { stroke: var(--hair); stroke-width: 1; }
  .zero { stroke: var(--faint); stroke-width: 0.8; }
  .tickmark { stroke: var(--soft); stroke-width: 1; }
  .excl { fill: var(--excl); }
  .axistext { font-family: var(--sans); font-size: 12px; fill: var(--soft); font-variant-numeric: tabular-nums; }
  .axistitle, .legend { font-family: var(--sans); font-size: 13px; fill: var(--soft); }
  .ticklabel { font-family: var(--sans); font-size: 11.5px; }
  .obs { stroke: var(--obs); stroke-width: 2.4; stroke-linecap: round; fill: none; }
  .obsline { stroke: var(--obs); stroke-width: 1.3; fill: none; }
  .calc { stroke: var(--calc); stroke-width: 1.3; fill: none; }
  .diff { stroke: var(--diffc); stroke-width: 1.1; fill: none; }
  .bkg { stroke: var(--bkgc); stroke-width: 1; stroke-dasharray: 5 4; fill: none; }
  .unity { stroke: var(--faint); stroke-width: 1; stroke-dasharray: 4 4; }
  .pt { stroke: var(--obs); stroke-width: 4; stroke-linecap: round; opacity: .7; fill: none; }
  .ptmag { stroke: var(--calc); stroke-width: 4.4; stroke-linecap: round; opacity: .8; fill: none; }
  .cell line, line.cell { stroke: var(--cellc); fill: none; }
  .bond { stroke: var(--bondc); opacity: .55; }
  .axis { stroke: var(--soft); }
  .axisdot { fill: var(--soft); }
  .lbl text, text.lbl { font-family: var(--sans); font-size: 11px; fill: var(--soft); paint-order: stroke; stroke: var(--paper); stroke-width: 3px; stroke-linejoin: round; }
  @media (max-width: 600px) {
    .wrap { padding: var(--s4) var(--s3) var(--s5); }
    :root { --fs-1: 22px; --fs-2: 16px; --fs-3: 14px; --fs-4: 12px; }
    table.bt { font-size: 13px; }
    table.bt td, table.bt thead th { padding-right: 10px; }
  }
  @page { margin: 16mm 15mm 18mm; }
  @media print {
    :root { --paper: #fff; --ink: #000; --soft: #444b52; --rule: #000; --rule-light: #9aa1a8; --hair: #d5dadf; --accent: #1f4e79;
            --fs-1: 20pt; --fs-2: 13pt; --fs-3: 9.5pt; --fs-4: 8pt; }
    body { background: #fff; }
    .wrap { max-width: none; padding: 0; }
    section { margin-bottom: 18pt; }
    h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
    table.bt, figure, .phase > p.cell, ul.caveats li, .pair { break-inside: avoid; page-break-inside: avoid; }
    .appendix table.bt { break-inside: auto; }
    tr { break-inside: avoid; }
    .scroll { overflow: visible; }
    a { color: inherit; text-decoration: none; }
    /* The appendix prints in full: every part open. */
    details::details-content { content-visibility: visible; display: block; }
    details > summary { list-style: none; }
    details > summary::-webkit-details-marker { display: none; }
  }
`;

/** Open every part of the appendix before printing, where ::details-content is not supported. */
const PRINT_SCRIPT = `addEventListener("beforeprint",function(){document.querySelectorAll("details").forEach(function(d){d.setAttribute("open","")})});`;

/** Build the standalone HTML report (a complete document, ready to save). */
export function reportHtml(input: ReportInput): string {
  const date = (input.date ?? new Date()).toISOString().slice(0, 10);
  const technique = TECHNIQUE_TITLE[input.technique];
  const primary = input.phases[0]?.structure;
  const section = (id: string, title: string, body: string): string =>
    body ? `<section id="${id}"><h2>${esc(title)}</h2>\n${body}\n</section>` : "";
  let letter = 0;
  // A part of the appendix: collapsed on screen, open in print.
  const part = (id: string, title: string, meta: string, body: string): string =>
    body ? `<details id="${id}"><summary><span class="letter">${String.fromCharCode(65 + letter++)}</span>${esc(title)}${meta ? `<span class="meta">${esc(meta)}</span>` : ""}</summary>\n<div class="part">${body}</div>\n</details>` : "";

  const fit = [
    input.figure ? figureHtml(input.figure) : "",
    indicesHtml(indicesOf(input)),
    otherValuesHtml(input.parameters, input.technique),
    input.boxcar ? boxcarHtml(input.boxcar) : "",
  ].filter(Boolean).join("\n");
  const free = input.parameters.filter((p) => !p.fixed && !p.expression).length;
  const appendix = [
    part("data", "Data and model", "", input.data.length > 0 ? kvHtml(input.data) : ""),
    part("statistics", "Refinement statistics", "", kvHtml(statisticsRows(input))),
    input.agent ? part("record", "The analysis step by step", `${input.agent.steps.length} step${input.agent.steps.length === 1 ? "" : "s"}, every check${input.agent.notes.length > 0 ? ", the notes" : ""}`, agentRecordHtml(input.agent)) : "",
    part("parameters", "Every parameter", `${input.parameters.length} parameter${input.parameters.length === 1 ? "" : "s"}, ${free} refined`, parametersHtml(input.parameters, input.technique)),
    part("conventions", "Conventions and software", "", conventionsHtml(input, date)),
  ].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(formulaText(input.title))} · ${esc(technique)} report</title>
<style>${CSS}</style>
<script>${PRINT_SCRIPT}</script>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <p class="kicker">MATERIA · ${esc(technique)}${input.agent ? " · analysed with MATERIA Copilot" : ""} · ${esc(date)}</p>
    <h1>${formulaHtml(input.title)}</h1>
    ${input.subtitle ? `<p class="sub">${formulasInText(esc(input.subtitle), (c) => `<sub>${c}</sub>`)}</p>` : ""}
  </header>
  ${section("result", "Result", resultHtml(input))}
  ${section("structure", input.phases.length > 1 ? "Structures" : "Structure", structureHtml(input))}
  ${section("magnetic", "Magnetic structure", input.magnetic ? magneticHtml(input.magnetic, primary) : "")}
  ${section("fit", "Fit", fit)}
  ${section("quality", "Quality and caveats", qualityHtml(input))}
  <section id="appendix" class="appendix"><h2>Appendix</h2>
  <p class="note">${esc(APPENDIX_NOTE)} Open a part to read it; printing opens them all.</p>
  ${appendix}
  </section>
  <footer>
    Generated by MATERIA Workbench${input.appVersion ? ` v${esc(input.appVersion)}` : ""} on ${esc(date)}.
    Values in parentheses are standard uncertainties in the last digit(s), from the least-squares covariance of this fit;
    a value without one was fixed, set by a constraint, or not part of the last refinement; a tied value carries its leader's.
    MATERIA is in public beta — reproduce results you intend to publish in an established package (the Export menu offers GSAS-II and FullProf bundles).
  </footer>
</div>
</body>
</html>
`;
}
