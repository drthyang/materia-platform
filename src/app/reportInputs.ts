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
import { isHydrogen } from "@/core/crystal/adp";
import { ridingSummary } from "@/core/crystal/riding";
import { restraintCount, restraintReport } from "@/core/crystal/restraints";
import { covalentBonds, isMolecular } from "@/core/crystal/geometry";
import { bondEsds, bondKeys } from "@/core/workflow/bondEsds";
import { withEsd } from "@/agent/structureTable";
import type { MagneticModel } from "@/core/magnetic/types";
import type { Vec3 } from "@/core/math/types";
import { extractSizeStrain } from "@/core/diffraction/microstructure";
import { formatWt, fractionsOf } from "@/core/diagnostics/phaseFractions";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { MergeStatistics } from "@/core/diffraction/merge";
import { isInversion, type OmittedMeasurement, type PdfPattern, type Radiation, type SingleCrystalDataset, type TwinLaw } from "@/core/diffraction/types";
import { dispersionLine } from "@/core/scattering/dispersion";
import { EXTINCTION_MODEL_LABELS } from "@/core/diffraction/singleCrystalFactors";
import { isMomentParameterKind, type ParameterBinding, type RefinementParameter, type RefinementResult } from "@/core/refinement/types";
import { parseTie, resolveTies } from "@/core/refinement/constraints";
import type { PowderProfile } from "@/core/workflow/powder";
import { formatMagneticSymbol, identifyMagneticGroupAnySetting } from "@/core/magnetic/bnsOg";
import { magneticOperationSignature } from "@/core/magnetic/operationSignature";
import { latticeCandidateLabel, latticeRepresentatives, magneticSubgroupLattice } from "@/core/magnetic/subgroupLattice";
import { crystalComponentsToCartesian } from "@/core/magnetic/moment";
import { kLabel } from "@/core/magnetic/kSearch";
import type { ReportBond, ReportBoxcar, ReportGroup, ReportInput, ReportMagnetic, ReportPhase, ReportRow, ReportStat } from "@/core/export/report";
import type { FigureCurves, FigureTickRow, FobsFcalcPoint } from "@/core/export/reportFigures";
import type { Session } from "@/app/powderSession";
import { APP_VERSION } from "@/app/constants";

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

/** Parameters with the last result's esds merged in (the CIF export's `withEsd`). */
function withEsds(params: readonly RefinementParameter[], result: RefinementResult | null | undefined): RefinementParameter[] {
  // A tied row (e.g. "= hypot(…)") reports what its tie evaluates to.
  let resolved: Record<string, number> | null = null;
  if (params.some((p) => p.expression)) {
    const values: Record<string, number> = {};
    for (const p of params) values[p.id] = p.value;
    try { resolved = resolveTies(params, values); } catch { resolved = null; }
  }
  // A row tied linearly to a free one ("= f·leader + c") carries |f| times the leader's esd.
  const esdOf = (p: RefinementParameter): number | undefined => {
    const own = result?.esd[p.id];
    if (own !== undefined || !p.expression) return own;
    try {
      const tie = parseTie(p.expression);
      const lead = tie.kind === "linear" ? result?.esd[tie.refId] : undefined;
      return tie.kind === "linear" && lead !== undefined ? Math.abs(tie.factor) * lead : undefined;
    } catch {
      return undefined;
    }
  };
  return params.map((p) => {
    const e = esdOf(p);
    const value = p.expression && resolved ? resolved[p.id] ?? p.value : p.value;
    return { ...p, value, ...(e !== undefined && Number.isFinite(e) ? { esd: e } : {}) };
  });
}

const pct = (v: number | null | undefined, d = 2): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(100 * v).toFixed(d)} %`);
const num = (v: number, d: number): string => v.toFixed(d);

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

/**
 * The magnetic section and its one-sentence summary. Priority: the model
 * applied to the refinement (with its provenance: refined jointly, or only
 * carried over), else the candidate under exploration on the magnetic page.
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
}): { section: ReportMagnetic | null; summary: string } {
  const { structure, applied, explored } = o;
  if (applied && applied.moments.length > 0) {
    const momentParams = o.params.filter((p) => isMomentParameterKind(p.kind));
    const sameAsExplored = !!explored && magneticOperationSignature(explored.magnetic.operations ?? []) === magneticOperationSignature(applied.operations ?? []);
    const group = sameAsExplored ? explored.group : groupOfOperations(structure, applied);
    const k = applied.propagation[0] ?? explored?.k ?? [0, 0, 0];
    const jointly = !!o.result && momentParams.some((p) => o.result!.esd[p.id] !== undefined);
    const range = momentRange(structure, applied);
    const status = jointly
      ? `Refined jointly with the atomic structure against ${o.against}; the moment esds come from that fit.`
      : `Included in the model and in the calculated pattern, but not refined together with the atomic structure in this session — the moments are as loaded or as set on the magnetic page` +
        (sameAsExplored && explored.agreement !== null ? ` (moments-only fit there: ${explored.agreementLabel} = ${pct(explored.agreement, 1)}).` : ".");
    const summary = `Magnetic structure: k = ${kLabel(k as Vec3)}, ${group.symbol}${group.numbers ? ` (${group.numbers})` : ""}${range ? `, |m| = ${range}` : ""}, ${jointly ? "refined jointly with the atomic structure" : "included in the model (not refined jointly in this session)"}.`;
    return { section: { magnetic: applied, k: k as Vec3, group, params: momentParams, status, structure }, summary };
  }
  if (explored) {
    const range = momentRange(structure, explored.magnetic);
    const fitted = explored.agreement !== null;
    const status = fitted
      ? `Candidate under exploration on the magnetic page — moments-only fit (${explored.agreementLabel} = ${pct(explored.agreement, 1)}); not applied to the refinement.`
      : "Candidate under exploration on the magnetic page — symmetry-allowed moments at their preview amplitudes; not fitted, not applied to the refinement.";
    const summary = `A magnetic candidate is under exploration on the magnetic page (k = ${kLabel(explored.k)}, ${explored.group.symbol}${range ? `, |m| = ${range}` : ""}); it is ${fitted ? "fitted on its own but " : ""}not part of the refinement above.`;
    return { section: { magnetic: explored.magnetic, k: explored.k, group: explored.group, params: explored.params, status, structure }, summary };
  }
  return { section: null, summary: "No magnetic model is included." };
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
}): ReportInput {
  const { session, result } = o;
  const params = withEsds(o.params, result);
  const structure = o.refinedPhases[0] ?? session.structure;
  const multi = session.extraPhases.length > 0;
  const phases: ReportPhase[] = o.refinedPhases.map((st, i) => ({
    structure: st,
    params,
    bindings: multi ? o.bindings.filter((b) => b.targetId === st.id) : o.bindings,
    ...(multi ? { role: i === 0 ? "primary phase" : "additional phase" } : {}),
  }));
  const free = params.filter((p) => !p.fixed && !p.expression).length;
  const pattern = session.pattern;
  const xs = pattern.points.map((p) => p.x);
  const xmin = xs.length ? Math.min(...xs) : 0;
  const xmax = xs.length ? Math.max(...xs) : 0;
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

  // The phases' weight fractions, and what the refined Lorentzian adds to the
  // instrument's: rows of their own, so an account that cites them cites the
  // report (round 10, NAC with fluorite on 11-BM).
  const fractions = multi && result ? fractionsOf(o.refinedPhases, params, result) : null;
  const micro = pattern.xUnit === "twoTheta" && result && "wavelength" in pattern.radiation ? microstructureRows(params, result, pattern.radiation.wavelength) : [];

  const data: ReportRow[] = [
    { label: "Data file", value: session.rawData?.name ?? pattern.name },
    { label: "Probe", value: probeLabel(pattern.radiation) },
    { label: "Instrument", value: instrumentLabel(o.instrument, o.instrumentLoaded) + (session.rawInstrument ? ` · file ${session.rawInstrument.name}` : "") },
    ...instrumentProfileRow(o.instrument, o.instrumentLoaded),
    { label: "Range", value: `${num(xmin, pattern.xUnit === "tof" ? 0 : 3)} – ${num(xmax, pattern.xUnit === "tof" ? 0 : 3)} ${unit} · ${pattern.points.length} points` },
    ...(o.fitRange ? [{ label: "Fit window", value: `${num(o.fitRange.min, 3)} – ${num(o.fitRange.max, 3)} (${o.xLabel}) · ${o.pointsInWindow} points` }] : []),
    { label: "Background", value: `Chebyshev polynomial, ${session.backgroundTerms} terms` },
    { label: "Peak shape", value: o.tofViewOnly ? "View only — GSAS-II's calculated curve is shown; MATERIA did not refine this TOF pattern" : `${peakShapeLabel(session.powderProfile)}${session.corrections?.asymmetry ? " · Finger–Cox–Jephcoat axial-divergence asymmetry (S/L, H/L)" : ""}` },
    { label: "Lorentz factor", value: session.powderProfile.lorentz === false ? "off (pre-reduced intensities)" : "applied" },
    ...(session.mustrain && session.mustrain !== "isotropic" ? [{ label: "Microstrain model", value: session.mustrain }] : []),
    ...(multi ? [{ label: "Phases", value: o.refinedPhases.map((s) => s.name || s.id).join(" · ") }] : []),
    ...(fractions ? [{ label: "Phase fractions", value: `${fractions.map((w) => `${w.name} ${formatWt(w)}`).join(" · ")} — Hill & Howard, from the refined scales; crystalline phases only, no microabsorption correction, esds from the scales alone` }] : []),
    ...micro,
  ];

  const inst = [o.instrument.name, o.instrument.facility].filter(Boolean).join(" · ");
  const summary =
    `Rietveld refinement of ${structure.name || structure.id}${structure.spaceGroup.hermannMauguin ? ` (${structure.spaceGroup.hermannMauguin})` : ""}` +
    `${multi ? ` with ${session.extraPhases.length} additional phase${session.extraPhases.length === 1 ? "" : "s"}` : ""}` +
    ` against ${probeInSentence(pattern.radiation)} data${inst && o.instrumentLoaded ? ` from ${inst}` : ""}: ` +
    `wR = ${pct(o.wR)}${o.gof !== null ? ` (S = ${num(o.gof, 2)})` : ""} with ${free} free parameter${free === 1 ? "" : "s"} over ${o.pointsInWindow} points. ` +
    magnetic.summary;

  const notes = [
    "wR = √(Σ w (y_obs − y_calc)² / Σ w y_obs²) with w = 1/σ² over the fit window; R_exp = √((N − P) / Σ w y_obs²); S = wR / R_exp (GSAS-II's GoF; reduced χ² = S²).",
    `Background: Chebyshev polynomial with ${session.backgroundTerms} terms, refined with the model.`,
    `Peak shape: ${peakShapeLabel(session.powderProfile)}${pattern.xUnit === "tof" ? "; d = (TOF − zero) / difC." : "."}`,
    ...(magnetic.section
      ? ["Magnetic intensities use the dipole ⟨j0⟩ form factor of the tabulated ion, with the moments expanded over the magnetic space-group operations (time-reversal-signed axial transforms, k-phase over the magnetic supercell). Components are crystal-axis µB; |m| through the cell metric. A powder pattern cannot fix the absolute moment direction within a set of symmetry-equivalent directions."]
      : []),
  ];

  return {
    technique: "powder",
    title: structure.name || structure.id,
    subtitle: `${probeLabel(pattern.radiation)}${inst && o.instrumentLoaded ? ` · ${inst}` : ""} · ${session.rawData?.name ?? pattern.name}`,
    summary,
    appVersion: APP_VERSION,
    stats,
    data,
    phases,
    magnetic: magnetic.section,
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
  };
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
  }));
}

/** The twin laws and their fractions with esds: an inversion twin's is the Flack x. */
function twinRow(laws: readonly TwinLaw[], params: readonly RefinementParameter[], bindings: readonly ParameterBinding[]): string {
  return laws.map((law, i) => {
    const p = params.find((q) => q.kind === "twinFraction" && bindings.some((b) => b.parameterId === q.id && b.targetKey === String(i + 1)));
    const value = p ? (p.esd !== undefined && !p.fixed ? withEsd(p.value, p.esd, 4) : p.value.toFixed(3)) : "?";
    return isInversion(law) ? `inversion twin: Flack x = ${value}` : `twin law h′ = R·h, R = ${JSON.stringify(law.matrix)}: fraction ${value}`;
  }).join("; ");
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
  const parts = [
    ...(riding.size + placed.length > 0 ? [`${riding.size > 0 ? `${riding.size} riding on ${riding.size === 1 ? "its parent" : "their parents"}` : ""}${riding.size > 0 && placed.length > 0 ? ", " : ""}${placed.length > 0 ? `${placed.length} (${placed.join(", ")}) with ${placed.length === 1 ? "its position" : "their positions"} refined and U_iso riding` : ""} (${ridingSummary(structure)})`] : []),
    ...(refined.length > 0 ? [`${refined.length} refined on ${refined.length === 1 ? "its" : "their"} own (${refined.map((h) => h.label).join(", ")})`] : []),
    ...(own.length > refined.length ? [`${own.length - refined.length} held at the input positions and U_iso`] : []),
  ];
  return [{ label: "Hydrogens", value: parts.join("; ") }];
}

/** The absences a merge left out, and the measurement count without them: the figure SHELXL reports (_diffrn_reflns_number). */
function absencesText(m: NonNullable<SingleCrystalDataset["merged"]>): string {
  const measured = m.absentMeasurements;
  return measured
    ? `${m.absences} systematic absence${m.absences === 1 ? "" : "s"}, measured ${measured} time${measured === 1 ? "" : "s"}, left out: ${m.from - measured} measurements merged`
    : `${m.absences} systematic absence${m.absences === 1 ? "" : "s"} left out`;
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
    { label: "R int", value: st.redundancy > 1 + 1e-9 ? pct(apart && apart.redundancy > 1 + 1e-9 ? apart.rInt : st.rInt) : "—", ...(st.redundancy > 1 + 1e-9 ? (apart && apart.redundancy > 1 + 1e-9 ? { hint: `the Friedel mates apart, as SHELXL reports it · ${pct(st.rInt)} in the Laue class` } : {}) : { hint: "merged data: one value per reflection" }) },
    { label: "Free parameters", value: String(free) },
  ];
  const data: ReportRow[] = [
    { label: "Data file", value: o.dataset.name },
    { label: "Probe", value: probeLabel(o.dataset.radiation) },
    { label: "Reflections", value: `${o.totalReflections} measured${o.dataset.merged ? ` · merged as SHELXL's MERG 2 (${o.dataset.merged.friedelApart ? "the Friedel opposites apart" : "the Friedel opposites merged"}${o.dataset.merged.absences ? `; ${absencesText(o.dataset.merged)}` : ""})` : ""} · ${o.dataset.reflections.length} used${omittedN > 0 ? ` · ${omittedN} omitted by hand` : ""}${outside > 0 && range ? ` · ${outside} outside ${range}` : ""}${o.excluded > 0 ? ` · ${o.excluded} rejected with |F_o² − F_c²|/σ > ${o.cutoffSigma}${o.minExtinction ? ` or y < ${o.minExtinction}` : ""}` : o.filterOn ? ` · the filter (|F_o² − F_c²|/σ > ${o.cutoffSigma}${o.minExtinction ? ` or y < ${o.minExtinction}` : ""}) rejected none` : ""}` },
    ...(omitted.length > 0 ? [{ label: "Omitted", value: omitted.map((m) => `${m.h} ${m.k} ${m.l}${m.batch !== undefined ? ` (batch ${m.batch})` : ""}${m.reason ? `: ${m.reason}` : ""}`).join("; ") }] : []),
    { label: "Extinction", value: EXTINCTION_MODEL_LABELS[o.dataset.extinctionModel ?? "shelx"] },
    ...(o.dataset.radiation.kind === "xray" ? [{ label: "Anomalous scattering", value: dispersionLine(o.dataset.radiation.wavelength) ? `f′ and f″ at ${dispersionLine(o.dataset.radiation.wavelength)!.name} (Cromer & Liberman, 1981)` : `none: no tabulated line at λ ${o.dataset.radiation.wavelength} Å` }] : []),
    ...(o.dataset.twinLaws?.length ? [{ label: "Twinning", value: twinRow(o.dataset.twinLaws, params, o.bindings) }] : []),
    ...hydrogenRow(o.structure, params, o.bindings),
    ...disorderRow(o.structure, params, o.bindings),
    ...(o.structure.restraints?.length ? [{ label: "Restraints", value: `${restraintCount(o.structure.restraints)} (as SHELXL counts them): ${restraintReport(o.structure, o.structure.restraints).map((r) => r.text).join("; ")}` }] : []),
    { label: "Merging", value: `${st.observations} observations → ${st.unique} unique in the Laue class · redundancy ${num(st.redundancy, 2)} · ${st.redundancy > 1 + 1e-9 ? `R_int ${pct(st.rInt)}` : "R_int n/a (merged data)"} · R_σ ${pct(st.rSigma)}${st.dMin !== undefined ? ` · d_min ${num(st.dMin, 3)} Å` : ""}${apart && apart.redundancy > 1 + 1e-9 ? `; with the Friedel mates apart and the absences left out, as SHELXL merges this group: ${apart.unique} unique · R_int ${pct(apart.rInt)} · R_σ ${pct(apart.rSigma)}` : ""}` },
    ...(o.dataset.origin === "refinement-listing" ? [{ label: "Source", value: "a refinement's listing (.fcf): Fo² on that refinement's scale, merged, the systematic absences left out, and in SHELXL's LIST 4 its extinction divided out" }] : []),
    { label: "Observed", value: `${ag.observed} of ${ag.total} reflections with F_o² > 2σ(F_o²)` },
    { label: "Weights", value: scheme ? `${weightText} (SHELXL WGHT ${scheme.a} ${scheme.b})` : "w = 1/σ²(F_o²); unit weights where σ is absent" },
    { label: "Unit cell", value: "fixed at the input values (not refinable from a single reflection file)" },
  ];
  const summary =
    `Single-crystal F² refinement of ${o.structure.name || o.structure.id}${o.structure.spaceGroup.hermannMauguin ? ` (${o.structure.spaceGroup.hermannMauguin})` : ""} against ${probeInSentence(o.dataset.radiation)} data: ` +
    `R1 = ${pct(ag.r1)}, wR2 = ${pct(ag.wr2)}, GooF = ${num(ag.goof, 2)} with ${free} free parameter${free === 1 ? "" : "s"} over ${o.dataset.reflections.length} reflections (${o.dataset.merged ? `${o.totalReflections} measurements merged as SHELXL's MERG 2` : `${st.unique} unique`}). ` +
    magnetic.summary;
  const notes = [
    `R1 = Σ||F_o| − |F_c|| / Σ|F_o| over reflections with F_o² > 2σ(F_o²); wR2 = √(Σ w (F_o² − F_c²)² / Σ w (F_o²)²) and GooF = √(Σ w (F_o² − F_c²)² / (N − P)) over all reflections, ${weightText} (SHELX conventions).`,
    "R_int = Σ|F_o² − ⟨F_o²⟩| / Σ F_o² over Laue-equivalent groups with two or more members (in a non-centrosymmetric group, the Friedel mates apart and the systematic absences left out, as SHELXL merges it); R_σ = Σ σ(F_o²) / Σ F_o².",
    ...(magnetic.section
      ? ["Magnetic reflections are computed from the moment component perpendicular to the scattering vector with the dipole ⟨j0⟩ form factor; with a magnetic model applied, the calculated intensity is nuclear + magnetic and one scale is shared."]
      : []),
  ];
  return {
    technique: "singleCrystal",
    title: o.structure.name || o.structure.id,
    subtitle: `${probeLabel(o.dataset.radiation)} · ${o.dataset.name}`,
    summary,
    appVersion: APP_VERSION,
    stats,
    data,
    phases: [{ structure: o.structure, params, bindings: o.bindings, ...(isMolecular(o.structure) ? { bonds: moleculeBonds(o.structure, o.base, o.params, o.bindings, o.result) } : {}) }],
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
    ...(multi ? [{ label: "Phases", value: o.phases.map((s) => s.name || s.id).join(" · ") }] : []),
  ];
  const summary =
    `Real-space PDF refinement of ${primary.name || primary.id}${primary.spaceGroup.hermannMauguin ? ` (${primary.spaceGroup.hermannMauguin})` : ""}${multi ? ` with ${o.phases.length - 1} additional phase${o.phases.length === 2 ? "" : "s"}` : ""} against ${pattern.scatteringType} G(r) over ${num(o.fitRange.min, 1)}–${num(o.fitRange.max, 1)} Å: ` +
    `Rw = ${pct(o.rw)} with ${free} free parameter${free === 1 ? "" : "s"}. ` +
    (o.spinModel || o.explored
      ? magnetic.summary.replace("Magnetic structure:", "Magnetic PDF (mPDF) spin model:")
      : "No magnetic (mPDF) component is included.");
  const notes = [
    "Rw = √(Σ (G_obs − G_calc)² / Σ G_obs²) over the fit window with uniform weights. G(r) point errors are strongly correlated (finite-Q sine transform), so Rw is a relative quality indicator, not a statistical one (Toby & Billinge 2004); esds from this fit are correspondingly optimistic.",
    "G(r) = 4πr[ρ(r) − ρ₀]; the calculated PDF applies the Q_max termination and the Q_damp / Q_broad instrument envelope as loaded.",
    ...(o.spinModel ? ["The magnetic PDF adds the spin-pair correlation term of the applied model (ordered component scaled separately, paramagnetic self-scattering as a smooth hump); it exists for neutron data only."] : []),
  ];
  return {
    technique: "pdf",
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
