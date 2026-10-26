/**
 * Report assembly — turns each workbench's live state into the technique-
 * agnostic `ReportInput` that `core/export/report.ts` renders. This is the
 * UI-side glue (it knows about sessions, display units and the magnetic page);
 * the report itself stays a pure renderer. One builder per technique, plus the
 * shared magnetic section, which prefers the model applied to the refinement
 * and otherwise reports the candidate under exploration on the magnetic page,
 * always saying which of the two it is.
 */

import type { StructureModel } from "@/core/crystal/types";
import { crystalSystem } from "@/core/crystal/cellConstraints";
import { structureToCif, type CifRefinementMeta } from "@/core/export/cif";
import { formatWithEsd } from "@/core/export/cif";
import { EIGHT_PI_SQUARED, isHydrogen } from "@/core/crystal/adp";
import { ridingSummary, sharedUGroups } from "@/core/crystal/riding";
import { floatingOrigins } from "@/core/crystal/polarOrigin";
import { improper, parsonsOfModel } from "@/core/workflow/singleCrystalRefinement";
import { restraintCount, restraintReport } from "@/core/crystal/restraints";
import { covalentBonds, hydrogenBondLines, isMolecular, ringGeometryLines } from "@/core/crystal/geometry";
import { bondEsds, bondKeys } from "@/core/workflow/bondEsds";
import { withEsd } from "@/agent/structureTable";
import type { MagneticModel } from "@/core/magnetic/types";
import type { Vec3 } from "@/core/math/types";
import { extractSizeStrain } from "@/core/diffraction/microstructure";
import { formatWt, fractionsOf } from "@/core/diagnostics/phaseFractions";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { MergeStatistics } from "@/core/diffraction/merge";
import { isInversion, mergedOnlyAbsences, type OmittedMeasurement, type PdfPattern, type Radiation, type SingleCrystalDataset, type TwinLaw } from "@/core/diffraction/types";
import { dispersionLine } from "@/core/scattering/dispersion";
import { EXTINCTION_MODEL_LABELS } from "@/core/diffraction/singleCrystalFactors";
import { isMomentParameterKind, type ParameterBinding, type ParameterKind, type RefinementParameter, type RefinementResult } from "@/core/refinement/types";
import { esdsWithTies, parseTie, resolveTies } from "@/core/refinement/constraints";
import { siteSumConstraints, siteSumRangeWarnings } from "@/core/workflow/structureRefinement";
import type { PowderProfile } from "@/core/workflow/powder";
import { backgroundLabel } from "@/core/diffraction/background";
import { formatMagneticSymbol, identifyMagneticGroupAnySetting } from "@/core/magnetic/bnsOg";
import { magneticOperationSignature } from "@/core/magnetic/operationSignature";
import { latticeCandidateLabel, latticeRepresentatives, magneticSubgroupLattice } from "@/core/magnetic/subgroupLattice";
import { crystalComponentsToCartesian } from "@/core/magnetic/moment";
import { kLabel } from "@/core/magnetic/kSearch";
import type { ReportBond, ReportBoxcar, ReportGroup, ReportIndex, ReportInput, ReportMagnetic, ReportPhase, ReportRow, ReportStat } from "@/core/export/report";
import { pdfCaveats, pdfResultParagraph, powderCaveats, powderResultParagraph, singleCrystalCaveats, singleCrystalResultParagraph, type ReportAssessment } from "@/core/export/reportResult";
import { formulaText, spaceGroupText } from "@/core/export/reportTypeset";
import { parametersChangedSince, type ValidationVerdict } from "@/core/diagnostics/validationChecks";
import type { RefinementAssessment } from "@/core/diagnostics/assessment";
import type { PowderJudgment } from "@/app/reportJudgment";
import type { FigureCurves, FigureTickRow, FobsFcalcPoint } from "@/core/export/reportFigures";
import type { Session } from "@/app/powderSession";
import { APP_VERSION } from "@/app/constants";
import { minMax } from "@/core/math/extent";
import { activeZeroAdpFixes, zeroAdpFixText, zeroAdpProposals, ZERO_ADP_BAYES } from "@/core/diagnostics/zeroAdp";

/** What the magnetic page is showing right now, as published by KSearchPanel. */
export interface MagneticExploration {
  /** The candidate with its moments applied at the current amplitudes. */
  readonly magnetic: MagneticModel;
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  readonly k: Vec3;
  readonly group: ReportGroup;
  /** The moments-only fit's agreement (fraction), when "Refine moments" ran. */
  readonly agreement: number | null;
  readonly agreementLabel: string;
}

/** `<name>_report.html`, the name reduced to a safe token (the id when nothing is left). */
export function reportFileName(structure: StructureModel): string {
  const token = (structure.name || structure.id).normalize("NFKD").replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${token.length >= 2 ? token : structure.id}_report.html`;
}

/** Parameters with the last result's esds merged in, a tied row's from its leader's: what the CIF exports and the report prints. */
export function withEsds(params: readonly RefinementParameter[], result: RefinementResult | null | undefined): RefinementParameter[] {
  // A tied row (e.g. "= hypot(…)") reports what its tie evaluates to.
  let resolved: Record<string, number> | null = null;
  if (params.some((p) => p.expression)) {
    const values: Record<string, number> = {};
    for (const p of params) values[p.id] = p.value;
    try { resolved = resolveTies(params, values); } catch { resolved = null; }
  }
  // A row tied linearly to a free one ("= f·leader + c") carries |f| times the leader's esd, one
  // tied to a sum of free ones (a shared site's last occupancy) the sum's, from the covariance.
  const esds = esdsWithTies(params, result);
  return params.map((p) => {
    const e = esds[p.id];
    const value = p.expression && resolved ? resolved[p.id] ?? p.value : p.value;
    return { ...p, value, ...(e !== undefined && Number.isFinite(e) ? { esd: e } : {}) };
  });
}

/**
 * The single-crystal page's CIF: the refined model with each parameter's su,
 * a tied row's from its leader's (withEsds). The workbench's Export CIF writes
 * exactly this.
 */
export function singleCrystalCifText(o: { structure: StructureModel; params: readonly RefinementParameter[]; result: RefinementResult | null | undefined; bindings: readonly ParameterBinding[]; refinement: CifRefinementMeta }): string {
  return structureToCif(o.structure, { params: withEsds(o.params, o.result), bindings: o.bindings, refinement: o.refinement });
}

const pct = (v: number | null | undefined, d = 2): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(100 * v).toFixed(d)} %`);
const num = (v: number, d: number): string => v.toFixed(d);
const capitalized = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The profile the instrument file was calibrated with, beside the refined one
 * in the parameter table: what a profile standard is measured against (round
 * 10, NAC against 11-BM's 2009 LaB₆ profile).
 */
function instrumentProfileRow(instrument: InstrumentParameters, loaded: boolean): ReportRow[] {
  if (!loaded || instrument.kind !== "constantWavelength" || instrument.u === undefined) return [];
  const g = `U ${instrument.u.toFixed(3)}, V ${(instrument.v ?? 0).toFixed(3)}, W ${(instrument.w ?? 0).toFixed(3)} (Gaussian FWHM², centideg²)`;
  const l = instrument.x !== undefined ? ` · X ${instrument.x}, Y ${instrument.y ?? 0} (Lorentzian, centideg)` : "";
  const a = instrument.asymmetry ? ` · S/L ${instrument.asymmetry.sl}, H/L ${instrument.asymmetry.hl}` : "";
  return [{ label: "Instrument profile (file)", value: `${g}${l}${a}` }];
}

/** The cell's esds as the structure file gives them, in a few words: "a 12.7506(1), c 27.6245(3) Å", the lengths the lattice holds equal given once. */
function cellSuText(structure: StructureModel): string {
  const su = structure.cellSu ?? {};
  const c = structure.cell;
  const lengths = (["a", "b", "c"] as const).filter((k, i, all) => su[k] !== undefined && !all.slice(0, i).some((j) => Math.abs(c[j] - c[k]) < 1e-9 && su[j] === su[k]));
  const angles = (["alpha", "beta", "gamma"] as const).filter((k) => su[k] !== undefined);
  const sym = { alpha: "α", beta: "β", gamma: "γ" } as const;
  return [
    ...(lengths.length ? [`${lengths.map((k) => `${k} ${formatWithEsd(c[k], su[k], 5)}`).join(", ")} Å`] : []),
    ...(angles.length ? [`${angles.map((k) => `${sym[k]} ${formatWithEsd(c[k], su[k], 4)}`).join(", ")}°`] : []),
  ].join("; ");
}

/** A value with its esd in the last digits, e.g. 19.8(4); the value alone without one. */
function withEsdText(v: number, esd: number | undefined, decimals: number): string {
  if (esd === undefined || !(esd > 0)) return v.toFixed(decimals);
  const d = Math.min(Math.max(-Math.floor(Math.log10(esd)) + (esd < 2 * 10 ** Math.floor(Math.log10(esd)) ? 1 : 0), 0), 6);
  return `${v.toFixed(d)}(${Math.round(esd * 10 ** d)})`;
}

/**
 * Crystallite size and microstrain from the refined Lorentzian X and Y, with
 * the instrument's (the starting values, from its file) subtracted — the
 * page's microstructure readout, as report rows.
 */
function microstructureRows(params: readonly RefinementParameter[], result: RefinementResult, wavelength: number): ReportRow[] {
  const px = params.find((p) => p.kind === "profileX");
  const py = params.find((p) => p.kind === "profileY");
  if (!px || !py || (px.fixed && py.fixed)) return [];
  const ss = extractSizeStrain({
    x: px.value, y: py.value, wavelength,
    ...(result.esd[px.id] !== undefined ? { xEsd: result.esd[px.id]! } : {}),
    ...(result.esd[py.id] !== undefined ? { yEsd: result.esd[py.id]! } : {}),
    instrument: { x: px.initialValue, y: py.initialValue },
  });
  const ref = `the instrument's X = ${px.initialValue}, Y = ${py.initialValue} subtracted`;
  return [
    { label: "Crystallite size", value: Number.isFinite(ss.sizeNm.value) ? `${withEsdText(ss.sizeNm.value, ss.sizeNm.esd, 0)} nm — Lorentzian X, Scherrer K 0.9, ${ref}` : `not resolved: X is not above the instrument's (${ref})` },
    { label: "Microstrain", value: `${withEsdText(ss.strainPpm.value, ss.strainPpm.esd, 1)} × 10⁻⁶ — Lorentzian Y, ${ref}` },
  ];
}

/**
 * Name a magnetic group from its operations the way the magnetic page names
 * it: find the candidate with the same operation set in the parent's subgroup
 * lattice at this k (the page's own enumeration, so labels agree), else fall
 * back to identifying the operations in any setting, else an honest generic.
 */
export function groupOfOperations(structure: StructureModel, model: MagneticModel): ReportGroup {
  const list = model.operations;
  if (!list || list.length === 0) return { symbol: "nuclear-symmetry expansion (no magnetic group chosen)" };
  const k = model.propagation[0] ?? [0, 0, 0];
  const sig = magneticOperationSignature(list);
  try {
    const reps = latticeRepresentatives(magneticSubgroupLattice(structure.spaceGroup.operations, k as Vec3));
    const hit = reps.find((r) => magneticOperationSignature(r.candidate.operations) === sig);
    if (hit) {
      const lbl = latticeCandidateLabel(hit);
      return {
        symbol: lbl.symbol,
        ...(lbl.numbers ? { numbers: lbl.numbers } : {}),
        ...(lbl.setting ? { setting: lbl.setting } : {}),
        index: hit.index,
      };
    }
  } catch {
    // An unusual parent (or an incommensurate k) may not enumerate; fall through.
  }
  const any = identifyMagneticGroupAnySetting(list);
  if (any) {
    return {
      symbol: formatMagneticSymbol(any.identity.bnsSymbol),
      numbers: `BNS ${any.identity.bnsNumber} · OG ${any.identity.ogNumber}`,
      ...(any.direct ? {} : { setting: any.transformation }),
    };
  }
  return { symbol: "magnetic subgroup", numbers: `${list.length} operations (not in the type I/III table)` };
}

/** |m| range over the carried sublattices, e.g. "2.57 µB" or "1.8–2.6 µB". */
function momentRange(structure: StructureModel, magnetic: MagneticModel): string | null {
  const mags = magnetic.moments
    .filter((m) => m.components.some((c) => c !== 0))
    .map((m) => {
      const c = crystalComponentsToCartesian(structure.cell, m.components);
      return Math.hypot(c[0]!, c[1]!, c[2]!);
    });
  if (mags.length === 0) return null;
  const lo = Math.min(...mags);
  const hi = Math.max(...mags);
  return hi - lo < 0.005 ? `${num(hi, 2)} µB` : `${num(lo, 2)}–${num(hi, 2)} µB`;
}

/** Rows of the magnetic model and its terms, which a magnetic refinement frees with the nuclear model held. */
const MAGNETIC_TERM_KINDS: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  "momentX", "momentY", "momentZ", "momentMode", "propagationK", "magneticScale", "mpdfOrdScale", "mpdfParaScale", "mpdfPsigma", "corrLength",
]);

/**
 * The magnetic section and its one-sentence summary. Priority: the model
 * applied to the refinement (with its provenance: refined jointly, the
 * moments refined with the nuclear model held, or only carried over), else
 * the candidate under exploration on the magnetic page.
 *
 * Two wordings, because two layouts read them. `status` and `summary` are the
 * frozen layout's (reportMarkdownFrozen.ts, which the Agent's number audit and
 * the evals read: it prints both, and must not move while the validation
 * runs), and keep its words: any moment esd reads as a joint refinement.
 * `provenance` and `sentence` are the current report's, and follow the free
 * set of the last refinement, read off its esds: "refined jointly with the
 * atomic structure" only when nuclear rows were free beside the moments, "the
 * moments refined with the nuclear model held" when every nuclear row was
 * fixed — the user's rule for a magnetic refinement, and the AWO₄ demo's last
 * step.
 */
export function magneticReportSection(o: {
  readonly structure: StructureModel;
  readonly applied: MagneticModel | null | undefined;
  /** The page's full parameter list with esds; the moment rows are picked out. */
  readonly params: readonly RefinementParameter[];
  readonly result: RefinementResult | null | undefined;
  readonly explored: MagneticExploration | null | undefined;
  /** How the joint refinement is described, e.g. "the powder pattern". */
  readonly against: string;
}): { section: ReportMagnetic | null; summary: string; sentence: string } {
  const { structure, applied, explored } = o;
  if (applied && applied.moments.length > 0) {
    const momentParams = o.params.filter((p) => isMomentParameterKind(p.kind));
    const sameAsExplored = !!explored && magneticOperationSignature(explored.magnetic.operations ?? []) === magneticOperationSignature(applied.operations ?? []);
    const group = sameAsExplored ? explored.group : groupOfOperations(structure, applied);
    const k = applied.propagation[0] ?? explored?.k ?? [0, 0, 0];
    const jointly = !!o.result && momentParams.some((p) => o.result!.esd[p.id] !== undefined);
    // The rows the last refinement freed carry its esds: a nuclear one among them makes the fit joint.
    const kindOf = new Map(o.params.map((p) => [p.id, p.kind] as const));
    const nuclearFree = jointly && Object.keys(o.result!.esd).some((id) => {
      const kind = kindOf.get(id);
      return kind !== undefined && !MAGNETIC_TERM_KINDS.has(kind);
    });
    const range = momentRange(structure, applied);
    const exploredFit = sameAsExplored && explored.agreement !== null ? ` (moments-only fit there: ${explored.agreementLabel} = ${pct(explored.agreement, 1)})` : "";
    const status = jointly
      ? `Refined jointly with the atomic structure against ${o.against}; the moment esds come from that fit.`
      : `Included in the model and in the calculated pattern, but not refined together with the atomic structure in this session — the moments are as loaded or as set on the magnetic page` +
        (exploredFit ? `${exploredFit}.` : ".");
    const provenance = !jointly
      ? `Included in the model and in the calculated pattern; ${o.result ? "the last refinement held the moments, which are" : "not refined in this session: the moments are"} as loaded or as set on the magnetic page${exploredFit}.`
      : nuclearFree
        ? status
        : `Moments refined against ${o.against} with the nuclear model held; the moment esds come from that fit.`;
    const head = `Magnetic structure: k = ${kLabel(k as Vec3)}, ${group.symbol}${group.numbers ? ` (${group.numbers})` : ""}${range ? `, |m| = ${range}` : ""}`;
    const summary = `${head}, ${jointly ? "refined jointly with the atomic structure" : "included in the model (not refined jointly in this session)"}.`;
    const sentence = `${head}, ${!jointly ? (o.result ? "included in the model (held in the last refinement)" : "included in the model (not refined in this session)") : nuclearFree ? "refined jointly with the atomic structure" : "moments refined with the nuclear model held"}.`;
    return { section: { magnetic: applied, k: k as Vec3, group, params: momentParams, status, provenance, structure }, summary, sentence };
  }
  if (explored) {
    const range = momentRange(structure, explored.magnetic);
    const fitted = explored.agreement !== null;
    const status = fitted
      ? `Candidate under exploration on the magnetic page — moments-only fit (${explored.agreementLabel} = ${pct(explored.agreement, 1)}); not applied to the refinement.`
      : "Candidate under exploration on the magnetic page — symmetry-allowed moments at their preview amplitudes; not fitted, not applied to the refinement.";
    const summary = `A magnetic candidate is under exploration on the magnetic page (k = ${kLabel(explored.k)}, ${explored.group.symbol}${range ? `, |m| = ${range}` : ""}); it is ${fitted ? "fitted on its own but " : ""}not part of the refinement above.`;
    return { section: { magnetic: explored.magnetic, k: explored.k, group: explored.group, params: explored.params, status, structure }, summary, sentence: summary };
  }
  return { section: null, summary: "No magnetic model is included.", sentence: "No magnetic model is included." };
}

/**
 * What a powder pattern cannot fix about the moments, shown beside them: it
 * averages over the crystallites' orientations, so the moment direction is
 * determined only up to the symmetry-equivalent directions — in a cubic
 * crystal not at all (only |m|), in a uniaxial one only as the angle to the
 * unique axis (Shirane 1959). By the parent's crystal system (its space-group
 * number, else its cell metric).
 */
export function powderMomentLimits(parent: StructureModel): string[] {
  const system = crystalSystem(parent.spaceGroup, parent.cell);
  const general = "A powder pattern averages over the crystallites' orientations (and the magnetic domains): it cannot fix the absolute moment direction within a set of symmetry-equivalent directions.";
  if (system === "cubic") return [general, "In this cubic crystal it fixes only the size of each moment, |m|: the direction shown is the model's, not one the data determine."];
  if (system === "hexagonal" || system === "trigonal" || system === "rhombohedral" || system === "tetragonal") {
    return [general, "In this uniaxial crystal it fixes each moment's size and its angle to the unique axis (the c axis of a hexagonal or tetragonal cell) only: where a moment has a component perpendicular to that axis, the component's direction within the plane is the model's, not one the data determine."];
  }
  return [general];
}

function probeLabel(r: Radiation): string {
  if (r.kind === "neutron-tof") return "Neutron, time-of-flight";
  if (r.kind === "neutron") return `Neutron, constant wavelength λ = ${num(r.wavelength, 5)} Å`;
  return `X-ray, λ = ${num(r.wavelength, 5)} Å${r.polarization !== undefined ? ` · polarization ${num(r.polarization, 2)}` : ""}`;
}

/** The probe inside a sentence: "neutron, constant wavelength λ = … Å", with "X-ray" and "Å" kept as written. */
function probeInSentence(r: Radiation): string {
  const label = probeLabel(r);
  return label.startsWith("X-ray") ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** The data in the Result paragraph's words: "neutron time-of-flight data", "X-ray data (λ = 1.54059 Å)". */
function dataPhrase(r: Radiation): string {
  if (r.kind === "neutron-tof") return "neutron time-of-flight data";
  if (r.kind === "neutron") return `constant-wavelength neutron data (λ = ${num(r.wavelength, 5)} Å)`;
  return `X-ray data (λ = ${num(r.wavelength, 5)} Å)`;
}

/** What was refined, as the Result paragraph names it: "Mn₃Ga (P6₃/mmc), with MnO (Fm-3m) as a second phase," (a second phase set off by commas). */
export function subjectOf(phases: readonly StructureModel[]): string {
  const one = (st: StructureModel): string => `${formulaText(st.name || st.id)}${st.spaceGroup.hermannMauguin ? ` (${spaceGroupText(st.spaceGroup.hermannMauguin)})` : ""}`;
  const [first, ...rest] = phases;
  if (!first) return "the model";
  if (rest.length === 0) return one(first);
  return `${one(first)}, with ${rest.length === 1 ? `${one(rest[0]!)} as a second phase` : `${rest.length} further phases (${rest.map(one).join("; ")})`},`;
}

const countIndex = (n: number, one: string, many = `${one}s`): ReportIndex => ({ symbol: n === 1 ? one : many, value: String(n), count: true });

/** A magnetic group's time reversal as the prime it is, in a sentence that names the group: "P2/c'" → "P2/c′". */
const primes = (s: string, symbol: string | undefined): string => (symbol && symbol.includes("'") ? s.split(symbol).join(symbol.replace(/'/g, "′")) : s);

function instrumentLabel(inst: InstrumentParameters, loaded: boolean): string {
  const name = [inst.name, inst.facility].filter(Boolean).join(" · ");
  const bits: string[] = [];
  if (name) bits.push(name);
  if (inst.kind === "tof") {
    bits.push(`difC = ${num(inst.difC, 2)} µs/Å`);
    if (inst.zero !== undefined) bits.push(`zero = ${num(inst.zero, 3)} µs`);
  } else {
    bits.push(`λ = ${num(inst.wavelength, 5)} Å`);
    if (inst.zero !== undefined) bits.push(`zero = ${num(inst.zero, 4)}° 2θ`);
  }
  return `${bits.join(" · ")}${loaded ? "" : " (default parameters — no instrument file loaded)"}`;
}

const X_UNIT_NAME: Record<string, string> = { twoTheta: "° 2θ", dSpacing: "Å (d)", q: "Å⁻¹ (Q)", tof: "µs (TOF)" };

const PEAK_SHAPE: Record<string, string> = {
  gaussian: "Gaussian (Caglioti widths)",
  pseudoVoigt: "Thompson–Cox–Hastings pseudo-Voigt (Caglioti U, V, W; Lorentzian X, Y)",
  tof: "Back-to-back exponentials convolved with a pseudo-Voigt (GSAS-II TOF profile type 1)",
};

function peakShapeLabel(profile: PowderProfile): string {
  return PEAK_SHAPE[profile.shape] ?? profile.shape;
}

// ---------------------------------------------------------------------------
// Powder (Rietveld)

export function powderReportInput(o: {
  readonly session: Session;
  /** Every phase with the current parameter values applied (primary first). */
  readonly refinedPhases: readonly StructureModel[];
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  readonly result: RefinementResult | null;
  readonly instrument: InstrumentParameters;
  readonly instrumentLoaded: boolean;
  /** Agreement over the plotted pattern (fractions). */
  readonly wR: number;
  readonly rExp: number | null;
  readonly gof: number | null;
  /** The figure, in the display unit the user is looking at. */
  readonly curves: FigureCurves;
  readonly xLabel: string;
  readonly ticks: readonly FigureTickRow[];
  readonly fitRange: { readonly min: number; readonly max: number } | null;
  readonly pointsInWindow: number;
  readonly tofViewOnly: boolean;
  readonly explored: MagneticExploration | null;
  /** The Validation tab's verdict and causes of misfit (reportJudgment.ts), for the Result paragraph and the caveats. */
  readonly judgment?: PowderJudgment | null;
}): ReportInput {
  const { session, result } = o;
  const params = withEsds(o.params, result);
  const limitations = zeroAdpLimitations(session, o.params, o.bindings, result, o.refinedPhases);
  const structure = o.refinedPhases[0] ?? session.structure;
  const multi = session.extraPhases.length > 0;
  // The phases' weight fractions, and what the refined Lorentzian adds to the
  // instrument's: rows of their own, so an account that cites them cites the
  // report (round 10, NAC with fluorite on 11-BM).
  const fractions = multi && result ? fractionsOf(o.refinedPhases, params, result) : null;
  const phases: ReportPhase[] = o.refinedPhases.map((st, i) => ({
    structure: st,
    params,
    bindings: multi ? o.bindings.filter((b) => b.targetId === st.id) : o.bindings,
    ...(multi ? { role: i === 0 ? "primary phase" : "additional phase" } : {}),
    ...(fractions?.[i] ? { fraction: formatWt(fractions[i]!) } : {}),
  }));
  const free = params.filter((p) => !p.fixed && !p.expression).length;
  const pattern = session.pattern;
  const xs = pattern.points.map((p) => p.x);
  const { min: xmin, max: xmax } = xs.length ? minMax(xs) : { min: 0, max: 0 };
  const unit = X_UNIT_NAME[pattern.xUnit] ?? pattern.xUnit;

  const magnetic = magneticReportSection({
    structure,
    applied: session.magnetic,
    params,
    result,
    explored: o.explored,
    against: "the powder pattern",
  });

  const stats: ReportStat[] = [
    { label: "wR", value: pct(o.wR), hint: "Weighted profile R over the fit window, w = 1/σ²" },
    ...(o.rExp !== null ? [{ label: "R exp", value: pct(o.rExp), hint: "Expected R: the statistical floor √((N − P) / Σ w y²)" }] : []),
    ...(o.gof !== null ? [{ label: "GoF (S)", value: num(o.gof, 2), hint: "S = wR / R_exp; reduced χ² = S²" }] : []),
    { label: "Points", value: String(o.pointsInWindow), hint: "Data points inside the fit window" },
    { label: "Free parameters", value: String(free) },
    ...(result ? [{ label: "Cycles", value: `${result.history.length}`, hint: `Engine status: ${result.status}` }] : []),
    ...(multi ? [{ label: "Phases", value: String(o.refinedPhases.length) }] : []),
  ];

  const micro = pattern.xUnit === "twoTheta" && result && "wavelength" in pattern.radiation ? microstructureRows(params, result, pattern.radiation.wavelength) : [];

  const data: ReportRow[] = [
    { label: "Data file", value: session.rawData?.name ?? pattern.name },
    { label: "Probe", value: probeLabel(pattern.radiation) },
    { label: "Instrument", value: instrumentLabel(o.instrument, o.instrumentLoaded) + (session.rawInstrument ? ` · file ${session.rawInstrument.name}` : "") },
    ...instrumentProfileRow(o.instrument, o.instrumentLoaded),
    { label: "Range", value: `${num(xmin, pattern.xUnit === "tof" ? 0 : 3)} – ${num(xmax, pattern.xUnit === "tof" ? 0 : 3)} ${unit} · ${pattern.points.length} points` },
    ...(o.fitRange ? [{ label: "Fit window", value: `${num(o.fitRange.min, 3)} – ${num(o.fitRange.max, 3)} (${o.xLabel}) · ${o.pointsInWindow} points` }] : []),
    { label: "Background", value: capitalized(backgroundLabel(session.powderProfile.backgroundType, session.backgroundTerms)) },
    { label: "Peak shape", value: o.tofViewOnly ? "View only — GSAS-II's calculated curve is shown; MATERIA did not refine this TOF pattern" : `${peakShapeLabel(session.powderProfile)}${session.corrections?.asymmetry ? " · Finger–Cox–Jephcoat axial-divergence asymmetry (S/L, H/L)" : ""}` },
    { label: "Lorentz factor", value: session.powderProfile.lorentz === false ? "off (pre-reduced intensities)" : "applied" },
    ...(session.mustrain && session.mustrain !== "isotropic" ? [{ label: "Microstrain model", value: session.mustrain }] : []),
    ...(multi ? [{ label: "Phases", value: o.refinedPhases.map((s) => s.name || s.id).join(" · ") }] : []),
    ...siteSumRow(params, o.bindings),
    ...(fractions ? [{ label: "Phase fractions", value: `${fractions.map((w) => `${w.name} ${formatWt(w)}`).join(" · ")} — Hill & Howard, from the refined scales; crystalline phases only, no microabsorption correction, esds from the scales alone` }] : []),
    ...micro,
  ];

  const inst = [o.instrument.name, o.instrument.facility].filter(Boolean).join(" · ");
  // Without a refinement of its own (a converged snapshot), the curves' agreement as the Validation tab reads it.
  const fromCurves = o.gof === null && !!o.judgment;
  const gof = o.gof ?? o.judgment?.agreement.gof ?? null;
  const rExp = o.rExp ?? (fromCurves ? o.judgment!.agreement.rexp : null);
  const curvesHint = fromCurves ? " (of the curves shown: no refinement in this session)" : "";
  const indices: ReportIndex[] = [
    { symbol: "R_wp", value: pct(o.wR), hint: "Weighted profile R over the fit window, w = 1/σ²" },
    ...(rExp !== null ? [{ symbol: "R_exp", value: pct(rExp), hint: `Expected R: the statistical floor √((N − P) / Σ w y²)${curvesHint}` }] : []),
    ...(gof !== null ? [{ symbol: "χ^2", value: num(gof * gof, 2), hint: `Reduced χ² = GoF²${curvesHint}` }, { symbol: "GoF", value: num(gof, 2), hint: `GoF = R_wp / R_exp (GSAS-II's GoF)${curvesHint}` }] : []),
    countIndex(o.pointsInWindow, "point"),
    countIndex(free, "free parameter"),
  ];
  const assessment: ReportAssessment | null = o.judgment
    ? (() => {
        const facts = {
          subject: subjectOf(o.refinedPhases),
          against: `${dataPhrase(pattern.radiation)}${inst && o.instrumentLoaded ? ` from ${inst}` : ""}`,
          free, points: o.pointsInWindow, rwp: o.wR, rexp: rExp, gof, result, parameters: params,
          acceptance: o.judgment.acceptance, headlineCause: o.judgment.headlineCause, causes: o.judgment.causes, restraints: o.judgment.restraints,
          magnetic: magnetic.section ? primes(magnetic.sentence, magnetic.section.group.symbol) : undefined,
        };
        return { result: powderResultParagraph(facts), caveats: powderCaveats(facts) };
      })()
    : null;
  const summary =
    `Rietveld refinement of ${structure.name || structure.id}${structure.spaceGroup.hermannMauguin ? ` (${structure.spaceGroup.hermannMauguin})` : ""}` +
    `${multi ? ` with ${session.extraPhases.length} additional phase${session.extraPhases.length === 1 ? "" : "s"}` : ""}` +
    ` against ${probeInSentence(pattern.radiation)} data${inst && o.instrumentLoaded ? ` from ${inst}` : ""}: ` +
    `wR = ${pct(o.wR)}${o.gof !== null ? ` (S = ${num(o.gof, 2)})` : ""} with ${free} free parameter${free === 1 ? "" : "s"} over ${o.pointsInWindow} points. ` +
    magnetic.summary;

  const notes = [
    "wR = √(Σ w (y_obs − y_calc)² / Σ w y_obs²) with w = 1/σ² over the fit window; R_exp = √((N − P) / Σ w y_obs²); S = wR / R_exp (GSAS-II's GoF; reduced χ² = S²).",
    `Background: ${backgroundLabel(session.powderProfile.backgroundType, session.backgroundTerms)}, refined with the model.`,
    `Peak shape: ${peakShapeLabel(session.powderProfile)}${pattern.xUnit === "tof" ? "; d = (TOF − zero) / difC." : "."}`,
    ...(magnetic.section
      ? ["Magnetic intensities use the dipole ⟨j0⟩ form factor of the tabulated ion, with the moments expanded over the magnetic space-group operations (time-reversal-signed axial transforms, k-phase over the magnetic supercell). Components are crystal-axis µB; |m| through the cell metric."]
      : []),
  ];

  return {
    technique: "powder",
    indices,
    assessment,
    title: structure.name || structure.id,
    subtitle: `${probeLabel(pattern.radiation)}${inst && o.instrumentLoaded ? ` · ${inst}` : ""} · ${session.rawData?.name ?? pattern.name}`,
    summary,
    appVersion: APP_VERSION,
    stats,
    data,
    phases,
    magnetic: magnetic.section ? { ...magnetic.section, limits: powderMomentLimits(magnetic.section.structure ?? structure) } : null,
    figure: o.curves.x.length > 0
      ? {
          kind: "pattern",
          curves: o.curves,
          xLabel: o.xLabel,
          yLabel: "Intensity",
          ticks: o.ticks,
          ...(o.fitRange ? { fitRange: o.fitRange } : {}),
          caption: `Observed (dots), calculated (line) and difference (lower band) over the full pattern${o.fitRange ? "; shaded regions lie outside the fit window" : ""}. Rows of ticks mark the Bragg positions of each phase${session.magnetic ? " and the magnetic reflections" : ""}.`,
        }
      : null,
    parameters: params,
    result,
    notes,
    // The B-at-0 limitations, and a shared site's last occupancy outside [0, 1] (the tie does not clamp it).
    ...(limitations.length + siteSumRangeWarnings(params).length > 0 ? { warnings: [...limitations, ...siteSumRangeWarnings(params)] } : {}),
  };
}

/**
 * The B-at-0 rule in the report's limitations: each fix the user applied that
 * the rows still carry (a B that is tied or held, not measured), and each B
 * the fit left on its bound with no fix applied.
 */
function zeroAdpLimitations(session: Session, params: readonly RefinementParameter[], bindings: readonly ParameterBinding[], result: RefinementResult | null, refined: readonly StructureModel[]): string[] {
  const applied = activeZeroAdpFixes(params, session.zeroAdpFixes).map(zeroAdpFixText);
  const open = zeroAdpProposals({ parameters: params, bindings, result, structures: [session.structure, ...session.extraPhases], refined })
    .map((p) => `${p.warning.replace(` ${ZERO_ADP_BAYES}`, "")} Not applied: the B is reported on its bound, where its esd means nothing.`);
  return [...applied, ...open];
}

// ---------------------------------------------------------------------------
// Single crystal (F²)

/**
 * A molecular structure's covalent bonds for the report, each length with its
 * esd from the refined positions' (as bond_geometry gives them), a riding
 * hydrogen's bond marked as set by its constraint. `base` is the structure the
 * parameters apply to; without it, or without a refinement, no esds.
 */
function moleculeBonds(refined: StructureModel, base: StructureModel | undefined, params: readonly RefinementParameter[], bindings: readonly ParameterBinding[], result: RefinementResult | null): ReportBond[] {
  const bonds = covalentBonds(refined);
  const keys = bondKeys(bonds);
  const esds = base && result ? bondEsds(base, bindings, params, result.esd, covalentBonds) : null;
  const pair = (a: string, b: string): string => [a, b].sort().join("–");
  const riding = new Set((refined.riding ?? []).filter((r) => r.geometry !== "free").map((r) => pair(r.site, r.parent)));
  return bonds.map((b, i) => ({
    from: b.from,
    to: b.to,
    length: riding.has(pair(b.from, b.to)) ? `${b.distance.toFixed(4)} (riding)` : withEsd(b.distance, esds?.get(keys[i]!), 5),
    ...(b.image ? { image: b.image } : {}),
  }));
}

/** The twin laws and their fractions with esds: an inversion twin's is the Flack x. */
function twinRow(laws: readonly TwinLaw[], params: readonly RefinementParameter[], bindings: readonly ParameterBinding[], combined?: Readonly<Record<string, number>>): string {
  const fractionOf = (i: number): RefinementParameter | undefined => params.find((q) => q.kind === "twinFraction" && bindings.some((b) => b.parameterId === q.id && b.targetKey === String(i + 1)));
  const text = (p: RefinementParameter | undefined): string => (p ? (p.esd !== undefined && !p.fixed ? withEsd(p.value, p.esd, 4) : p.value.toFixed(3)) : "?");
  if (laws.length === 1 && isInversion(laws[0]!)) return `inversion twin: Flack x = ${text(fractionOf(0))}`;
  const all = laws.map((_, i) => fractionOf(i));
  const firstX = 1 - all.reduce((t, p) => t + (p?.value ?? 0), 0);
  // The first domain's fraction is what the laws leave: one law's esd is its own; with several, from the covariance.
  const lone = laws.length === 1 && all[0] && !all[0].fixed ? all[0].esd : undefined;
  const firstEsd = laws.length > 1 ? combined?.twin_first : lone;
  const first = firstEsd !== undefined ? withEsd(firstX, firstEsd, 4) : firstX.toFixed(3);
  const rows = [
    `the first domain (the model as given): fraction ${first}`,
    ...laws.map((law, i) => `${isInversion(law) ? "inversion" : `h′ = R·h, R = ${JSON.stringify(law.matrix)}`}${improper(law.matrix) && !isInversion(law) ? " (inverted hand)" : ""}: fraction ${text(fractionOf(i))}`),
  ];
  // Beside a merohedral law, the domains of the other hand hold the Flack x together; its esd from the covariance when the fit gave it.
  const inverted = laws.map((law, i) => ({ law, p: fractionOf(i) })).filter(({ law }) => improper(law.matrix));
  if (laws.length > 1 && inverted.length > 0 && inverted.every(({ p }) => p)) {
    const x = inverted.reduce((t, { p }) => t + p!.value, 0);
    const esds = inverted.map(({ p }) => (p!.esd !== undefined && !p!.fixed ? p!.esd : undefined));
    const covariant = esds.every((e) => e !== undefined) ? combined?.flack : undefined;
    const esd = covariant ?? (esds.every((e) => e !== undefined) ? Math.sqrt(esds.reduce((t, e) => t + e! ** 2, 0)) : undefined);
    rows.push(`Flack x (the inverted domains together) = ${esd !== undefined ? withEsd(x, esd, 4) : x.toFixed(3)}${esd !== undefined ? (covariant !== undefined ? ", its esd from the covariance" : ", its esd from the fractions' in quadrature") : ""}`);
  }
  return `${laws.length + 1} domains: ${rows.join("; ")}`;
}

/** The shared sites of a powder or PDF fit: who shares each, and that their occupancies sum to exactly the site's total by a constraint. */
function siteSumRow(params: readonly RefinementParameter[], bindings: readonly ParameterBinding[]): ReportRow[] {
  const site = (id: string): string => bindings.find((b) => b.parameterId === id && b.kind === "occupancy")?.targetKey ?? id;
  const value = siteSumConstraints(params).map((c) => {
    const members = [...c.leaders, c.follower].map(site);
    const total = c.total < 1 ? `${c.total} (${+((1 - c.total) * 100).toPrecision(3)} % vacancies, as set)` : "1";
    return `${members.slice(0, -1).join(", ")} and ${members[members.length - 1]} share one site, their occupancies summing to exactly ${total}: ${site(c.follower)} = ${c.total} − ${c.leaders.length === 1 ? site(c.leaders[0]!) : "the others"}, a constraint (its esd from the others' covariance)`;
  }).join("; ");
  return value ? [{ label: "Shared sites", value }] : [];
}

/** Each disorder assembly: its alternatives' occupancies, and how they were tied. */
function disorderRow(structure: StructureModel, params: readonly RefinementParameter[], bindings: readonly ParameterBinding[]): ReportRow[] {
  const sites = structure.sites.filter((site) => site.disorder);
  if (sites.length === 0) return [];
  const assemblies = [...new Set(sites.map((site) => site.disorder!.assembly))];
  const value = assemblies.map((a) => {
    const members = sites.filter((site) => site.disorder!.assembly === a);
    const parts = members.map((site) => {
      const row = params.find((p) => p.id === `occ_${site.label}`);
      return `${site.label} (part ${site.disorder!.group}) ${withEsd(site.occupancy, row?.esd, 4)}`;
    });
    const tied = members.some((site) => params.find((p) => p.id === `occ_${site.label}`)?.expression);
    // EADP: every ADP row of an alternative that follows another's.
    const shared = members.filter((site) => {
      const rows = params.filter((p) => (p.kind === "uAniso" || p.kind === "bIso") && p.id.startsWith(`${p.kind === "bIso" ? "B" : "U"}_${site.label}`));
      return rows.length > 0 && rows.every((p) => p.expression);
    });
    // Whose ADP each follows: the site its tie's leader drives.
    const siteOf = (id: string): string | undefined => bindings.find((b) => b.parameterId === id && b.targetKey !== undefined)?.targetKey;
    const leaders = [...new Set(shared.flatMap((site) => params
      .filter((p) => p.expression && (p.id.startsWith(`U_${site.label}_`) || p.id === `B_${site.label}`))
      .flatMap((p) => { try { const tie = parseTie(p.expression!); const leader = tie.kind === "linear" ? siteOf(tie.refId) : undefined; return leader ? [leader] : []; } catch { return []; } })))];
    const eadp = shared.length > 0 ? `; ${shared.map((x) => x.label).join(", ")} ${shared.length === 1 ? "takes" : "take"} the ADP of ${leaders.length ? leaders.join(", ") : "its alternative"} (EADP)` : "";
    return `${a ? `assembly ${a}: ` : ""}${parts.join(", ")}${tied ? ", the occupancies tied to add up to one" : ""}${eadp}`;
  }).join("; ");
  return [{ label: "Disorder", value }];
}

/** How the hydrogens were treated: riding (SHELXL's AFIX, with their distances), refined, or held at the input positions. */
function hydrogenRow(structure: StructureModel, params: readonly RefinementParameter[], bindings: readonly ParameterBinding[]): ReportRow[] {
  const hydrogens = structure.sites.filter((site) => isHydrogen(site));
  if (hydrogens.length === 0) return [];
  const riding = new Set((structure.riding ?? []).filter((r) => r.geometry !== "free").map((r) => r.site));
  const placed = (structure.riding ?? []).filter((r) => r.geometry === "free").map((r) => r.site);
  const own = hydrogens.filter((h) => !riding.has(h.label) && !placed.includes(h.label));
  const free = new Set(params.filter((p) => !p.fixed && !p.expression).map((p) => p.id));
  const refined = own.filter((h) => bindings.some((b) => b.targetKey === h.label && free.has(b.parameterId)));
  // Each shared U_iso as refined, U = B/8π², with its esd.
  const shared = [...sharedUGroups(structure.riding ?? [])].map(([key, labels]) => {
    const p = params.find((q) => q.id === `B_shared_${key}`);
    if (!p) return "";
    const e = p.esd !== undefined && !p.fixed ? p.esd / EIGHT_PI_SQUARED : undefined;
    return `B_shared_${key}: U_iso ${withEsd(p.value / EIGHT_PI_SQUARED, e, 4)} Å² for ${labels.length} hydrogens`;
  }).filter(Boolean);
  const parts = [
    ...(riding.size + placed.length > 0 ? [`${riding.size > 0 ? `${riding.size} riding on ${riding.size === 1 ? "its parent" : "their parents"}` : ""}${riding.size > 0 && placed.length > 0 ? ", " : ""}${placed.length > 0 ? `${placed.length} (${placed.join(", ")}) with ${placed.length === 1 ? "its position" : "their positions"} refined and U_iso riding` : ""} (${ridingSummary(structure)}${shared.length ? `; ${shared.join("; ")}` : ""})`] : []),
    ...(refined.length > 0 ? [`${refined.length} refined on ${refined.length === 1 ? "its" : "their"} own (${refined.map((h) => h.label).join(", ")})`] : []),
    ...(own.length > refined.length ? [`${own.length - refined.length} held at the input positions and U_iso`] : []),
  ];
  return [{ label: "Hydrogens", value: parts.join("; ") }];
}

/** The restraints, as SHELXL counts them: the distances, and a polar group's floating origin. */
function restraintsRow(structure: StructureModel, params: readonly RefinementParameter[], bindings: readonly ParameterBinding[]): ReportRow[] {
  const distances = structure.restraints ?? [];
  const origins = floatingOrigins(structure, params, bindings);
  if (distances.length === 0 && origins.length === 0) return [];
  const parts = [
    ...(distances.length ? restraintReport(structure, distances).map((r) => r.text) : []),
    ...origins.map((o) => `the floating origin along ${o.axis}, held by its Z²-weighted mean coordinate (SHELXL's floating-origin restraint)`),
  ];
  return [{ label: "Restraints", value: `${restraintCount(distances) + origins.length} (as SHELXL counts them): ${parts.join("; ")}` }];
}

/**
 * The absolute structure: Parsons' x from the Bijvoet pairs fitted both ways
 * (an acentric group, X-rays at a tabulated line), and the model's hand when
 * it was inverted from the one loaded.
 */
function absoluteStructureRow(o: { readonly base?: StructureModel; readonly structure: StructureModel; readonly dataset: SingleCrystalDataset; readonly params: readonly RefinementParameter[]; readonly bindings: readonly ParameterBinding[]; readonly inverted?: string }): ReportRow[] {
  const r = o.dataset.radiation;
  const anomalous = r.kind === "xray" && dispersionLine(r.wavelength) !== undefined;
  const est = anomalous && o.base ? parsonsOfModel(o.base, o.dataset, o.params, o.bindings) : null;
  const parts = [
    // The inverse model's quotients are the same with Q_calc's sign turned: x' = 1 − x, its esd the same.
    ...(est ? [`Flack x = ${withEsd(est.x, est.esd, 4)} by Parsons' quotients from ${est.quotients} Bijvoet pairs (Parsons, Flack & Wagner, 2013), ${withEsd(1 - est.x, est.esd, 4)} for the inverse model${est.signs.observed ? `; of the ${est.signs.observed} Bijvoet differences observed at more than 3σ, ${est.signs.modelSign} ${est.signs.modelSign === 1 ? "has" : "have"} the model's sign` : ""}`] : []),
    ...(o.inverted ? [o.inverted] : []),
  ];
  return parts.length ? [{ label: "Absolute structure", value: parts.join("; ") }] : [];
}

/** The absences a merge left out, and the measurement count without them: the figure SHELXL reports (_diffrn_reflns_number). */
function absencesText(m: NonNullable<SingleCrystalDataset["merged"]>): string {
  const measured = m.absentMeasurements;
  return measured
    ? `${m.absences} systematic absence${m.absences === 1 ? "" : "s"}, measured ${measured} time${measured === 1 ? "" : "s"}, left out: ${m.from - measured} measurements merged`
    : `${m.absences} systematic absence${m.absences === 1 ? "" : "s"} left out`;
}

/** A molecule's geometry for the report: its covalent bonds with their esds, its ring centroids' contacts and its hydrogen bonds, when it has any. */
function moleculeGeometry(structure: StructureModel, base: StructureModel | undefined, params: readonly RefinementParameter[], bindings: readonly ParameterBinding[], result: RefinementResult | null): Pick<ReportPhase, "bonds" | "rings" | "hydrogenBonds"> {
  const rings = ringGeometryLines(structure);
  const hydrogenBonds = hydrogenBondLines(structure);
  return {
    bonds: moleculeBonds(structure, base, params, bindings, result),
    ...(rings.contacts.length > 0 ? { rings } : {}),
    ...(hydrogenBonds.length > 0 ? { hydrogenBonds } : {}),
  };
}

export function singleCrystalReportInput(o: {
  /** The structure AS REFINED (parameters applied). */
  readonly structure: StructureModel;
  /** The structure the parameters apply to, for the bond lengths' esds. */
  readonly base?: StructureModel;
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  readonly result: RefinementResult | null;
  /** The reflections the fit used (after the σ filter), with the chosen radiation. */
  readonly dataset: SingleCrystalDataset;
  readonly totalReflections: number;
  readonly excluded: number;
  readonly filterOn: boolean;
  readonly cutoffSigma: number;
  /** The filter's extinction cut (null: none). */
  readonly minExtinction?: number | null;
  /** Measurements left out by hand, each with its reason. */
  readonly omitted?: readonly OmittedMeasurement[];
  /** The resolution range fitted, and how many measurements lie outside it. */
  readonly resolution?: { readonly dMin?: number; readonly dMax?: number; readonly excluded: number };
  readonly agreement: { readonly r1: number; readonly wr2: number; readonly goof: number; readonly observed: number; readonly total: number };
  readonly merge: MergeStatistics;
  readonly points: readonly FobsFcalcPoint[];
  readonly magnetic: MagneticModel | null;
  readonly explored: MagneticExploration | null;
  /** The model inverted from the one loaded (invert_structure), in words: the coordinates and the space group it took. */
  readonly inverted?: string;
  /** A SHELX .ins/.res loaded as the structure: what its refinement applied, in a few lines (TWIN, BASF, EXTI, WGHT, FVAR, AFIX). */
  readonly structureFile?: readonly string[];
  /** That file's name. */
  readonly structureFileName?: string;
  /** The Validation view's checks (validationChecks.ts singleCrystalChecks), for the Result paragraph and the caveats. */
  readonly verdict?: ValidationVerdict | null;
}): ReportInput {
  const params = withEsds(o.params, o.result);
  const free = params.filter((p) => !p.fixed && !p.expression).length;
  const ag = o.agreement;
  const st = o.merge;
  const omitted = o.omitted ?? [];
  const outside = o.resolution?.excluded ?? 0;
  // Merged, the measurement's equivalents became one reflection each: the merge is no omission.
  const omittedN = o.dataset.merged ? omitted.length : o.totalReflections - o.dataset.reflections.length - o.excluded - outside;
  const apart = st.friedelApart;
  const range = o.resolution && (o.resolution.dMin !== undefined || o.resolution.dMax !== undefined)
    ? `d ${o.resolution.dMax !== undefined ? `≤ ${o.resolution.dMax}` : ""}${o.resolution.dMax !== undefined && o.resolution.dMin !== undefined ? " and " : ""}${o.resolution.dMin !== undefined ? `≥ ${o.resolution.dMin}` : ""} Å`
    : null;
  const magnetic = magneticReportSection({
    structure: o.structure,
    applied: o.magnetic,
    params,
    result: o.result,
    explored: o.explored,
    against: "the F² reflection data",
  });
  const scheme = o.dataset.weighting && (o.dataset.weighting.a > 0 || o.dataset.weighting.b > 0) ? o.dataset.weighting : null;
  const weightText = scheme ? `w = 1/[σ²(F_o²) + (${scheme.a}P)² + ${scheme.b}P], P = (F_o² + 2F_c²)/3` : "w = 1/σ²(F_o²)";
  const stats: ReportStat[] = [
    { label: "R1", value: pct(ag.r1), hint: `Σ||F_o| − |F_c|| / Σ|F_o| over the ${ag.observed} reflections with F_o² > 2σ` },
    { label: "wR2", value: pct(ag.wr2), hint: `√(Σ w (F_o² − F_c²)² / Σ w (F_o²)²), ${weightText}, all reflections` },
    { label: "GooF", value: num(ag.goof, 2), hint: "√(Σ w (F_o² − F_c²)² / (N − P))" },
    { label: "Reflections", value: String(o.dataset.reflections.length), hint: o.excluded > 0 || omittedN > 0 ? [omittedN > 0 ? `${omittedN} omitted by hand` : "", o.excluded > 0 ? `${o.excluded} excluded by the filter` : ""].filter(Boolean).join(", ") : "All measured reflections" },
    // A non-centrosymmetric group's figures as SHELXL gives them (the Friedel mates apart, the absences out), the Laue class's in the hint.
    apart
      ? { label: "Unique", value: String(apart.unique), hint: `the Friedel mates apart and the systematic absences left out, as SHELXL merges this group (MERG 2) · ${st.unique} in the Laue class · redundancy ${num(st.redundancy, 2)}` }
      : { label: "Unique", value: String(st.unique), hint: `Laue-equivalent merge · redundancy ${num(st.redundancy, 2)}` },
    // In an acentric group the Friedel mates stay apart: data holding each reflection once (merged, or a listing) have no R_int, whatever the Laue class would make of the Bijvoet pairs.
    (apart ?? st).redundancy > 1 + 1e-9
      ? { label: "R int", value: pct((apart ?? st).rInt), ...(apart ? { hint: `the Friedel mates apart, as SHELXL reports it · ${pct(st.rInt)} in the Laue class` } : {}) }
      : { label: "R int", value: "—", hint: `${o.dataset.origin === "refinement-listing" ? "a refinement's listing" : "merged data"}: one value per reflection${apart ? ", the Friedel mates apart" : ""}` },
    { label: "Free parameters", value: String(free) },
  ];
  const data: ReportRow[] = [
    { label: "Data file", value: o.dataset.name },
    ...(o.structureFile?.length ? [{ label: "Structure file", value: `${o.structureFileName ? `${o.structureFileName}, ` : ""}a SHELX instruction file, whose refinement applied: ${o.structureFile.join("; ")}` }] : []),
    { label: "Probe", value: probeLabel(o.dataset.radiation) },
    { label: "Reflections", value: `${o.totalReflections} ${o.dataset.origin === "refinement-listing" ? "listed" : o.dataset.merged && mergedOnlyAbsences(o.dataset.merged, o.dataset.reflections.length) ? `in the file, each once (merged by its data reduction${o.dataset.merged.friedelApart ? ", the Friedel opposites apart" : ""})${o.dataset.merged.absences ? ` · ${o.dataset.merged.absences} systematic absence${o.dataset.merged.absences === 1 ? "" : "s"} left out, as SHELXL's MERG 2 leaves them` : ""}` : `measured${o.dataset.merged ? ` · merged as SHELXL's MERG 2 (${o.dataset.merged.friedelApart ? "the Friedel opposites apart" : "the Friedel opposites merged"}${o.dataset.merged.absences ? `; ${absencesText(o.dataset.merged)}` : ""})` : ""}`} · ${o.dataset.reflections.length} used${omittedN > 0 ? ` · ${omittedN} omitted by hand` : ""}${outside > 0 && range ? ` · ${outside} outside ${range}` : ""}${o.excluded > 0 ? ` · ${o.excluded} rejected with |F_o² − F_c²|/σ > ${o.cutoffSigma}${o.minExtinction ? ` or y < ${o.minExtinction}` : ""}` : o.filterOn ? ` · the filter (|F_o² − F_c²|/σ > ${o.cutoffSigma}${o.minExtinction ? ` or y < ${o.minExtinction}` : ""}) rejected none` : ""}` },
    ...(omitted.length > 0 ? [{ label: "Omitted", value: omitted.map((m) => `${m.h} ${m.k} ${m.l}${m.batch !== undefined ? ` (batch ${m.batch})` : ""}${m.reason ? `: ${m.reason}` : ""}`).join("; ") }] : []),
    { label: "Extinction", value: !params.some((p) => p.kind === "extinction" && (!p.fixed || p.value !== 0)) ? (o.dataset.origin === "refinement-listing" ? "none refined: the listing's Fo² have the extinction of the refinement that wrote it divided out (SHELXL's LIST 4)" : "none refined (held at 0)") : EXTINCTION_MODEL_LABELS[o.dataset.extinctionModel ?? "shelx"] },
    ...(o.dataset.radiation.kind === "xray" ? [{ label: "Anomalous scattering", value: dispersionLine(o.dataset.radiation.wavelength) ? `f′ and f″ at ${dispersionLine(o.dataset.radiation.wavelength)!.name} (Cromer & Liberman, 1981)` : `none: no tabulated line at λ ${o.dataset.radiation.wavelength} Å` }] : []),
    ...(o.dataset.twinLaws?.length ? [{ label: "Twinning", value: twinRow(o.dataset.twinLaws, params, o.bindings, o.result?.combinationEsd) }] : []),
    ...absoluteStructureRow(o),
    ...hydrogenRow(o.structure, params, o.bindings),
    ...disorderRow(o.structure, params, o.bindings),
    ...restraintsRow(o.structure, params, o.bindings),
    { label: "Merging", value: apart && apart.redundancy <= 1 + 1e-9
      ? `${st.observations} reflections, each once with its Friedel mate apart (${o.dataset.origin === "refinement-listing" ? "a refinement's listing" : "merged data"}): no R_int · R_σ ${pct(apart.rSigma)}${st.dMin !== undefined ? ` · d_min ${num(st.dMin, 3)} Å` : ""}`
      : `${st.observations} observations → ${st.unique} unique in the Laue class · redundancy ${num(st.redundancy, 2)} · ${st.redundancy > 1 + 1e-9 ? `R_int ${pct(st.rInt)}` : "R_int n/a (merged data)"} · R_σ ${pct(st.rSigma)}${st.dMin !== undefined ? ` · d_min ${num(st.dMin, 3)} Å` : ""}${apart && apart.redundancy > 1 + 1e-9 ? `; with the Friedel mates apart and the absences left out, as SHELXL merges this group: ${apart.unique} unique · R_int ${pct(apart.rInt)} · R_σ ${pct(apart.rSigma)}` : ""}` },
    ...(o.dataset.origin === "refinement-listing" ? [{ label: "Source", value: "a refinement's listing (.fcf): Fo² on that refinement's scale, merged, the systematic absences left out, and in SHELXL's LIST 4 its extinction divided out" }] : []),
    { label: "Observed", value: `${ag.observed} of ${ag.total} reflections with F_o² > 2σ(F_o²)` },
    { label: "Weights", value: scheme ? `${weightText} (SHELXL WGHT ${scheme.a} ${scheme.b})` : "w = 1/σ²(F_o²); unit weights where σ is absent" },
    { label: "Unit cell", value: `fixed at the input values (not refinable from a single reflection file)${o.structure.cellSu ? `, with the structure file's esds (${cellSuText(o.structure)}), which the volume and the bond esds carry` : ", which give no esds"}` },
  ];
  const summary =
    `Single-crystal F² refinement of ${o.structure.name || o.structure.id}${o.structure.spaceGroup.hermannMauguin ? ` (${o.structure.spaceGroup.hermannMauguin})` : ""} against ${probeInSentence(o.dataset.radiation)} data: ` +
    `R1 = ${pct(ag.r1)}, wR2 = ${pct(ag.wr2)}, GooF = ${num(ag.goof, 2)} with ${free} free parameter${free === 1 ? "" : "s"} over ${o.dataset.reflections.length} reflections (${o.dataset.merged ? mergedOnlyAbsences(o.dataset.merged, o.dataset.reflections.length) ? `${o.totalReflections} in the file, each once${o.dataset.merged.absences ? `, the ${o.dataset.merged.absences} systematic absences left out` : ""}` : `${o.totalReflections} measurements merged as SHELXL's MERG 2` : apart ? `${apart.unique} unique, the Friedel mates apart` : `${st.unique} unique`}). ` +
    magnetic.summary;
  const unique = apart ? apart.unique : st.unique;
  const rIntShown = (apart ?? st).redundancy > 1 + 1e-9;
  const indices: ReportIndex[] = [
    { symbol: "R_1", value: pct(ag.r1), hint: `Σ||F_o| − |F_c|| / Σ|F_o| over the ${ag.observed} reflections with F_o² > 2σ` },
    { symbol: "wR_2", value: pct(ag.wr2), hint: `√(Σ w (F_o² − F_c²)² / Σ w (F_o²)²), ${weightText}, all reflections` },
    { symbol: "GooF", value: num(ag.goof, 2), hint: "√(Σ w (F_o² − F_c²)² / (N − P))" },
    ...(rIntShown ? [{ symbol: "R_int", value: pct((apart ?? st).rInt), ...(apart ? { hint: "the Friedel mates apart, as SHELXL reports it" } : {}) }] : []),
    countIndex(o.dataset.reflections.length, "reflection"),
    { symbol: "unique", value: String(unique), count: true },
    countIndex(free, "free parameter"),
  ];
  const assessment: ReportAssessment | null = o.verdict
    ? (() => {
        const facts = {
          subject: subjectOf([o.structure]),
          against: `${o.dataset.reflections.length} reflections (${unique} unique) of ${dataPhrase(o.dataset.radiation)}`,
          free,
          agreement: `{{R_1}} = ${pct(ag.r1)} (${ag.observed} reflections with {{F_o^2}} > 2σ), {{wR_2}} = ${pct(ag.wr2)} and GooF = ${num(ag.goof, 2)} over all ${ag.total}`,
          result: o.result, parameters: params, verdict: o.verdict,
          magnetic: magnetic.section ? primes(magnetic.sentence, magnetic.section.group.symbol) : undefined,
        };
        const changed = !!o.result && parametersChangedSince(o.result, o.params);
        return { result: singleCrystalResultParagraph(facts, changed), caveats: singleCrystalCaveats(facts, changed) };
      })()
    : null;
  const notes = [
    `R1 = Σ||F_o| − |F_c|| / Σ|F_o| over reflections with F_o² > 2σ(F_o²); wR2 = √(Σ w (F_o² − F_c²)² / Σ w (F_o²)²) and GooF = √(Σ w (F_o² − F_c²)² / (N − P)) over all reflections, ${weightText} (SHELX conventions).`,
    "R_int = Σ|F_o² − ⟨F_o²⟩| / Σ F_o² over Laue-equivalent groups with two or more members (in a non-centrosymmetric group, the Friedel mates apart and the systematic absences left out, as SHELXL merges it); R_σ = Σ σ(F_o²) / Σ F_o².",
    ...(magnetic.section
      ? ["Magnetic reflections are computed from the moment component perpendicular to the scattering vector with the dipole ⟨j0⟩ form factor; with a magnetic model applied, the calculated intensity is nuclear + magnetic and one scale is shared."]
      : []),
  ];
  return {
    technique: "singleCrystal",
    indices,
    assessment,
    title: o.structure.name || o.structure.id,
    subtitle: `${probeLabel(o.dataset.radiation)} · ${o.dataset.name}`,
    summary,
    appVersion: APP_VERSION,
    stats,
    data,
    phases: [{ structure: o.structure, params, bindings: o.bindings, ...(isMolecular(o.structure) ? moleculeGeometry(o.structure, o.base, o.params, o.bindings, o.result) : {}) }],
    magnetic: magnetic.section,
    figure: { kind: "fobsFcalc", points: o.points, caption: "|F_obs| against |F_calc| for every reflection used; the dashed line is perfect agreement. Magnetic reflections (those whose calculated intensity is mostly magnetic) are coloured." },
    parameters: params,
    result: o.result,
    notes,
  };
}

// ---------------------------------------------------------------------------
// PDF (real space)

const PDF_SOURCE_LABEL: Record<string, string> = {
  gr: "G(r) as loaded",
  sq: "S(Q), sine-transformed to G(r) at load",
  fq: "F(Q), sine-transformed to G(r) at load",
  fgr: "PDFgui fit export; observed rebuilt as G_calc + G_diff",
  "fgr-diff": "PDFgui fit residual (G_diff — the mPDF signal, not a total G(r))",
};

export function pdfReportInput(o: {
  /** Every phase AS REFINED (primary first). */
  readonly phases: readonly StructureModel[];
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  readonly result: RefinementResult | null;
  readonly pattern: PdfPattern;
  /** Rw over G(r) inside the fit window (uniform weights), fraction. */
  readonly rw: number;
  readonly fitRange: { readonly min: number; readonly max: number };
  readonly curves: FigureCurves;
  readonly positionMode: "atomic" | "irreps";
  readonly spinModel: MagneticModel | null;
  /** The mPDF page's current candidate, when one is selected but not adopted. */
  readonly explored: MagneticExploration | null;
  readonly warnings?: readonly string[];
  /** The last boxcar scan of this model, as a table (pdfBoxcar.boxcarTable). */
  readonly boxcar?: ReportBoxcar | null;
  /** assess_refinement's reading of the fit on screen (mode "pdf"), for the Result paragraph and the caveats. */
  readonly findings?: RefinementAssessment | null;
  /** The fit on screen is the last refinement's (its values unedited): its esds and findings apply. */
  readonly current?: boolean;
}): ReportInput {
  const params = withEsds(o.params, o.result);
  const free = params.filter((p) => !p.fixed && !p.expression).length;
  const { pattern } = o;
  const primary = o.phases[0]!;
  const multi = o.phases.length > 1;
  const rFirst = pattern.points[0]?.r ?? 0;
  const rLast = pattern.points[pattern.points.length - 1]?.r ?? 0;
  const inWindow = pattern.points.filter((p) => p.r >= o.fitRange.min && p.r <= o.fitRange.max).length;
  const magnetic = magneticReportSection({
    structure: primary,
    applied: o.spinModel,
    params,
    result: o.result,
    explored: o.explored,
    against: "G(r)",
  });
  const phases: ReportPhase[] = o.phases.map((st, i) => ({
    structure: st,
    params,
    bindings: multi ? o.bindings.filter((b) => b.targetId === st.id) : o.bindings,
    ...(multi ? { role: i === 0 ? "primary phase" : "additional phase" } : {}),
  }));
  const stats: ReportStat[] = [
    { label: "Rw(G)", value: pct(o.rw), hint: "√(Σ (G_obs − G_calc)² / Σ G_obs²) over the fit window, uniform weights" },
    { label: "Fit window", value: `${num(o.fitRange.min, 1)}–${num(o.fitRange.max, 1)} Å` },
    { label: "Points", value: String(inWindow), hint: "Grid points inside the fit window" },
    { label: "Free parameters", value: String(free) },
    ...(o.result ? [{ label: "Cycles", value: `${o.result.history.length}`, hint: `Engine status: ${o.result.status}` }] : []),
    ...(multi ? [{ label: "Phases", value: String(o.phases.length) }] : []),
  ];
  const meta: string[] = [];
  if (pattern.qmax !== undefined) meta.push(`Q_max ${pattern.qmax} Å⁻¹`);
  if (pattern.qmin !== undefined) meta.push(`Q_min ${pattern.qmin} Å⁻¹`);
  if (pattern.qdamp !== undefined) meta.push(`Q_damp ${pattern.qdamp} Å⁻¹`);
  if (pattern.qbroad !== undefined) meta.push(`Q_broad ${pattern.qbroad} Å⁻¹`);
  const data: ReportRow[] = [
    { label: "Data file", value: `${pattern.name} — ${PDF_SOURCE_LABEL[pattern.sourceKind ?? "gr"] ?? "G(r)"}` },
    { label: "Probe", value: (pattern.scatteringType === "neutron" ? "Neutron total scattering (coherent scattering lengths b)" : "X-ray total scattering (Z-weighted, PDFfit2 convention)") + (pattern.radiationAssumed ? " — assumed: the data file names no radiation" : "") },
    { label: "Range", value: `r = ${num(rFirst, 2)} – ${num(rLast, 2)} Å · ${pattern.points.length} points${pattern.rstep !== undefined ? ` · Δr ${pattern.rstep} Å` : ""}` },
    { label: "Fit window", value: `${num(o.fitRange.min, 2)} – ${num(o.fitRange.max, 2)} Å · ${inWindow} points` },
    ...(meta.length ? [{ label: "Reduction", value: meta.join(" · ") }] : []),
    ...(pattern.composition ? [{ label: "Composition", value: pattern.composition }] : []),
    { label: "Positions", value: o.positionMode === "irreps" ? "symmetry-adapted distortion modes (irreps of the parent group)" : "atomic coordinates (symmetry-allowed shifts)" },
    ...siteSumRow(o.params, o.bindings),
    ...(multi ? [{ label: "Phases", value: o.phases.map((s) => s.name || s.id).join(" · ") }] : []),
  ];
  const summary =
    `Real-space PDF refinement of ${primary.name || primary.id}${primary.spaceGroup.hermannMauguin ? ` (${primary.spaceGroup.hermannMauguin})` : ""}${multi ? ` with ${o.phases.length - 1} additional phase${o.phases.length === 2 ? "" : "s"}` : ""} against ${pattern.scatteringType} G(r) over ${num(o.fitRange.min, 1)}–${num(o.fitRange.max, 1)} Å: ` +
    `Rw = ${pct(o.rw)} with ${free} free parameter${free === 1 ? "" : "s"}. ` +
    (o.spinModel || o.explored
      ? magnetic.summary.replace("Magnetic structure:", "Magnetic PDF (mPDF) spin model:")
      : "No magnetic (mPDF) component is included.");
  const indices: ReportIndex[] = [
    { symbol: "R_w", value: pct(o.rw), hint: "√(Σ (G_obs − G_calc)² / Σ G_obs²) over the fit window, uniform weights" },
    { symbol: "r", value: `${num(o.fitRange.min, 2)}–${num(o.fitRange.max, 2)} Å`, hint: "The fit window" },
    countIndex(inWindow, "point"),
    countIndex(free, "free parameter"),
  ];
  const facts = {
    subject: subjectOf(o.phases),
    against: `${pattern.scatteringType === "neutron" ? "neutron" : "X-ray"} G(r) over r = ${num(o.fitRange.min, 2)}–${num(o.fitRange.max, 2)} Å (${inWindow} points)`,
    free, rw: o.rw, result: o.result, parameters: params,
    assessment: o.current === false ? null : o.findings ?? null,
    magnetic: o.spinModel || o.explored ? primes(magnetic.sentence.replace("Magnetic structure:", "Magnetic PDF (mPDF) spin model:"), magnetic.section?.group.symbol) : undefined,
  };
  const assessment: ReportAssessment | null = o.findings !== undefined
    ? { result: pdfResultParagraph(facts, o.current === false), caveats: pdfCaveats(facts) }
    : null;
  const notes = [
    "Rw = √(Σ (G_obs − G_calc)² / Σ G_obs²) over the fit window with uniform weights. G(r) point errors are strongly correlated (finite-Q sine transform), so Rw is a relative quality indicator, not a statistical one (Toby & Billinge 2004); esds from this fit are correspondingly optimistic.",
    "G(r) = 4πr[ρ(r) − ρ₀]; the calculated PDF applies the Q_max termination and the Q_damp / Q_broad instrument envelope as loaded.",
    ...(o.spinModel ? ["The magnetic PDF adds the spin-pair correlation term of the applied model (ordered component scaled separately, paramagnetic self-scattering as a smooth hump); it exists for neutron data only."] : []),
  ];
  return {
    technique: "pdf",
    indices,
    assessment,
    title: primary.name || primary.id,
    subtitle: `${pattern.scatteringType === "neutron" ? "Neutron" : "X-ray"} G(r) · ${pattern.name}`,
    summary,
    appVersion: APP_VERSION,
    stats,
    data,
    phases,
    magnetic: magnetic.section,
    ...(o.boxcar ? { boxcar: o.boxcar } : {}),
    figure: o.curves.x.length > 0
      ? {
          kind: "pattern",
          curves: o.curves,
          xLabel: "r (Å)",
          yLabel: "G(r) (Å⁻²)",
          fitRange: o.fitRange,
          observedAs: "dots",
          caption: "Observed G(r) (dots), calculated (line) and difference (lower band); shaded regions lie outside the fit window.",
        }
      : null,
    parameters: params,
    result: o.result,
    notes,
    ...(o.warnings && o.warnings.length > 0 ? { warnings: o.warnings } : {}),
  };
}
