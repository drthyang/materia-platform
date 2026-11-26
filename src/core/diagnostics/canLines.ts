/**
 * Can lines: where a vanadium or aluminium sample can (or a cryostat's
 * aluminium shields) puts Bragg lines on a neutron powder pattern, and which of
 * the sample's reflections and observed peaks they overlap.
 *
 * The can phases are data (CAN_PHASES): each names a phase of the known-phase
 * library (knownPhases.ts, room-temperature cells) and, optionally, a table of
 * its thermal expansion. A further can (Cu, steel, Nb) is one more entry.
 *
 * Positions: each can line at d = d₂₉₃ × s, with s a d-scale the user states
 * (default 1). A part that does not sit at the sample position shifts its
 * lines as well; the scale absorbs both. Nothing is fitted or excluded.
 *
 * Widths: the page's own profile at that d (constant wavelength or time of
 * flight, the isotropic part: instrument and isotropic sample terms), measured
 * on the profile itself: the apex and the full width at half maximum, found
 * by bisection on the calculated peak shape, so asymmetric shapes (FCJ, the
 * back-to-back exponentials of time of flight) are measured as drawn.
 *
 * Overlap: a sample reflection or an observed peak whose apex is within one
 * FWHM (at the can line's d) of a can line's apex.
 *
 * Intensities: the can phase's |F|² with the neutron coherent scattering
 * lengths (Al 3.449 fm, V −0.3824 fm), its multiplicity, and the page's
 * Lorentz factor and intensity corrections (placePeaks). Relative within each
 * can phase; across phases, per unit volume of metal (÷ V_cell²), which is
 * what an equal volume of can wall gives. The absolute scale relative to the
 * sample is unknown: it depends on how much can the beam sees.
 */

import { knownPhaseStructure } from "@/core/diagnostics/knownPhases";
import { generateReflections } from "@/core/diffraction/reflections";
import { powderPeakIntensities } from "@/core/diffraction/intensity";
import { synthesizePattern, type ProfileOptions, type ProfilePeak } from "@/core/diffraction/profile";
import type { PowderPattern, Radiation } from "@/core/diffraction/types";
import { cellVolume } from "@/core/crystal/unitCell";
import type { StructureModel } from "@/core/crystal/types";
import { placePeaks, reflectionDRange, type PowderProfile } from "@/core/workflow/powder";
import { applyParameters, type AppliedModel } from "@/core/workflow/apply";
import { phaseBindingsFor } from "@/core/workflow/multiPhase";
import { resolveTies } from "@/core/refinement/constraints";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";

/** One row of a thermal-expansion table: T (K), ΔL/L₂₉₃ (%), α (10⁻⁶ K⁻¹). */
export interface ExpansionPoint {
  readonly T: number;
  readonly dLL: number;
  readonly alpha: number;
}

export interface ExpansionTable {
  /** Where the numbers come from, as the page cites them. */
  readonly source: string;
  /** Ascending in T; ΔL/L is 0 at 293 K. */
  readonly points: readonly ExpansionPoint[];
}

export interface CanPhase {
  /** The known-phase library's name for it (knownPhases.ts). */
  readonly phase: string;
  /** Short label on the plot and in the tables. */
  readonly label: string;
  readonly expansion?: ExpansionTable;
}

/**
 * Recommended values of the thermal linear expansion, ΔL/L₀ (%, L₀ at 293 K)
 * and α (10⁻⁶ K⁻¹), from Y. S. Touloukian, R. K. Kirby, R. E. Taylor and
 * P. D. Desai, Thermophysical Properties of Matter, Vol. 12: Thermal Expansion,
 * Metallic Elements and Alloys (IFI/Plenum, New York, 1975):
 *  - aluminium, Figure and Table No. 1R (p. 2): accurate to ±3 %;
 *  - vanadium, Figure and Table No. 60R (p. 373): ±10 % below 293 K (the
 *    values below 293 K marked provisional), ±5 % above.
 * Copied from the tables as printed (DTIC AD-A129115). For aluminium the
 * contraction agrees with Corruccini and Gniewek, NBS Monograph 29 (1961),
 * Table 2.1, to 0.002 % at 100 and 200 K (0.370 and 0.201 % there).
 */
const TPRC_VOL12 = "Touloukian, Kirby, Taylor & Desai, Thermophysical Properties of Matter vol. 12 (1975)";

export const AL_EXPANSION: ExpansionTable = {
  source: `${TPRC_VOL12}, Table 1R`,
  points: [
    { T: 5, dLL: -0.418, alpha: 0.001 },
    { T: 50, dLL: -0.413, alpha: 3.9 },
    { T: 100, dLL: -0.371, alpha: 12.2 },
    { T: 200, dLL: -0.203, alpha: 20.3 },
    { T: 293, dLL: 0, alpha: 23.1 },
    { T: 400, dLL: 0.259, alpha: 25.1 },
    { T: 500, dLL: 0.514, alpha: 26.4 },
    { T: 600, dLL: 0.787, alpha: 28.4 },
    { T: 700, dLL: 1.084, alpha: 30.9 },
    { T: 800, dLL: 1.408, alpha: 34.0 },
    { T: 900, dLL: 1.764, alpha: 37.4 },
  ],
};

export const V_EXPANSION: ExpansionTable = {
  source: `${TPRC_VOL12}, Table 60R`,
  points: [
    { T: 5, dLL: -0.155, alpha: 0.02 },
    { T: 25, dLL: -0.155, alpha: 0.2 },
    { T: 50, dLL: -0.153, alpha: 1.3 },
    { T: 100, dLL: -0.136, alpha: 5.1 },
    { T: 200, dLL: -0.072, alpha: 7.1 },
    { T: 293, dLL: 0, alpha: 8.4 },
    { T: 400, dLL: 0.102, alpha: 9.6 },
    { T: 500, dLL: 0.2, alpha: 9.9 },
    { T: 600, dLL: 0.3, alpha: 10.2 },
    { T: 700, dLL: 0.405, alpha: 10.5 },
    { T: 800, dLL: 0.512, alpha: 10.9 },
    { T: 900, dLL: 0.622, alpha: 11.2 },
    { T: 1000, dLL: 0.737, alpha: 11.6 },
    { T: 1200, dLL: 0.978, alpha: 12.5 },
    { T: 1400, dLL: 1.239, alpha: 13.6 },
    { T: 1600, dLL: 1.521, alpha: 14.7 },
    { T: 1800, dLL: 1.828, alpha: 16.0 },
    { T: 2000, dLL: 2.16, alpha: 17.2 },
  ],
};

/** The cans shown, in this order. A further can is one more entry (its phase in the known-phase library). */
export const CAN_PHASES: readonly CanPhase[] = [
  { phase: "V", label: "V can", expansion: V_EXPANSION },
  { phase: "Al", label: "Al can", expansion: AL_EXPANSION },
];

/**
 * a(T)/a(293 K) from an expansion table: 1 + ΔL/L₀ at T, interpolated as a
 * cubic Hermite between the table's rows with α as the slope (dΔL/L₀/dT = α,
 * to the 10⁻⁵ of α the difference between L₀ and L(T) makes), the slopes
 * limited where needed to keep the curve monotonic. Null outside
 * the table's range: no value is extrapolated. Below the table's first row
 * (5 K) the contraction no longer changes, and its value there is taken.
 *
 * The library cells are room-temperature cells, taken as 293 K: the 5 K
 * between 293 and 298 K moves Al's d by 1·10⁻⁴, V's by 4·10⁻⁵.
 */
export function expansionScale(table: ExpansionTable, T: number): number | null {
  const pts = table.points;
  if (!Number.isFinite(T) || pts.length === 0) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (T < 0 || T > last.T) return null;
  if (T <= first.T) return 1 + first.dLL / 100;
  let i = 0;
  while (i < pts.length - 2 && T > pts[i + 1]!.T) i++;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const h = b.T - a.T;
  const t = (T - a.T) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  // Slopes in % per K: α·10⁻⁶ K⁻¹ × 100, limited as Fritsch & Carlson (1980) do so the curve
  // never turns back between two rows (from 5 to 50 K the α of the rows would make Al dip).
  let ma = a.alpha * 1e-4;
  let mb = b.alpha * 1e-4;
  const secant = (b.dLL - a.dLL) / h;
  if (secant > 0) {
    const p = ma / secant;
    const q = mb / secant;
    const norm = p * p + q * q;
    if (norm > 9) {
      const tau = 3 / Math.sqrt(norm);
      ma *= tau;
      mb *= tau;
    }
  }
  const dLL = (2 * t3 - 3 * t2 + 1) * a.dLL + (t3 - 2 * t2 + t) * h * ma + (-2 * t3 + 3 * t2) * b.dLL + (t3 - t2) * h * mb;
  return 1 + dLL / 100;
}

/** The page the lines are placed on: its pattern, its model with the current values, its profile. */
export interface CanLineContext {
  readonly pattern: PowderPattern;
  /** The primary phase with the page's values applied: calibration, zero, profile widths, corrections. */
  readonly applied: AppliedModel;
  readonly options: ProfileOptions;
  readonly applyLorentz: boolean;
}

/** What a page holds that the lines are placed with. */
export interface CanLinePage {
  readonly structure: StructureModel;
  readonly extraPhases: readonly StructureModel[];
  readonly pattern: PowderPattern;
  readonly parameters: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  readonly profile: PowderProfile;
}

/**
 * The page's context for the can lines: its primary phase with the current
 * values applied (calibration, zero, widths, corrections), its profile and
 * Lorentz setting. Null off neutron data, and on time of flight without a
 * calibration and its back-to-back-exponential profile (no peak is placed).
 */
export function canLineContext(page: CanLinePage): CanLineContext | null {
  if (!isNeutron(page.pattern.radiation)) return null;
  const values: Record<string, number> = {};
  for (const p of page.parameters) values[p.id] = p.value;
  const resolved = resolveTies(page.parameters, values);
  const bindings = page.extraPhases.length > 0 ? phaseBindingsFor(page.bindings, page.structure.id) : page.bindings;
  const applied = applyParameters(page.structure, bindings, resolved);
  if (page.pattern.xUnit === "tof" && (!applied.tof || page.profile.shape !== "tof")) return null;
  return {
    pattern: page.pattern,
    applied,
    options: { shape: page.profile.shape, ...(page.profile.eta !== undefined ? { eta: page.profile.eta } : {}) },
    applyLorentz: page.profile.lorentz ?? true,
  };
}

/** Neutron data only: constant wavelength or time of flight. */
export function isNeutron(radiation: Radiation): boolean {
  return radiation.kind === "neutron" || radiation.kind === "neutron-tof";
}

/** A line's apex and FWHM on the pattern's abscissa. */
export interface LineProfile {
  readonly x: number;
  readonly fwhm: number;
}

function peaksAt(ctx: CanLineContext, d: number, intensity = 1): ProfilePeak[] {
  return placePeaks(ctx.pattern, ctx.applied, [{ d, intensity }]).filter((p) => !p.secondLine);
}

/**
 * The page's profile of a line at d (no hkl: the isotropic part): its apex
 * and FWHM in the pattern's x unit, measured on the shape as the page draws it.
 * Null where the page places no peak (no calibration, no width defined).
 */
export function profileAt(ctx: CanLineContext, d: number): LineProfile | null {
  const peaks = peaksAt(ctx, d);
  if (peaks.length === 0) return null;
  const opts: ProfileOptions = { shape: ctx.options.shape, ...(ctx.options.eta !== undefined ? { eta: ctx.options.eta } : {}) };
  const f = (x: number): number => synthesizePattern([x], peaks, opts)[0]!;
  let lo = Infinity;
  let hi = -Infinity;
  let width = 0;
  for (const p of peaks) {
    lo = Math.min(lo, p.center);
    hi = Math.max(hi, p.center);
    width = Math.max(width, p.fwhm);
  }
  if (!(width > 0) || !Number.isFinite(lo)) return null;
  const a = lo - 4 * width;
  const b = hi + 4 * width;
  const n = 801;
  const step = (b - a) / (n - 1);
  const grid = Array.from({ length: n }, (_, i) => a + i * step);
  const y = synthesizePattern(grid, peaks, opts);
  let k = 0;
  for (let i = 1; i < n; i++) if (y[i]! > y[k]!) k = i;
  if (!(y[k]! > 0) || k === 0 || k === n - 1) return null;
  // The apex: where the slope changes sign, bisected between the grid's neighbours of the highest
  // point. The slope's sign is read from a symmetric difference over a span far below the width,
  // which places the apex to ~10⁻¹² of the width (a search on the values themselves stops at √ε).
  const h = step * 1e-3;
  const rising = (x: number): boolean => f(x + h) > f(x - h);
  let l = grid[k - 1]!;
  let r = grid[k + 1]!;
  for (let it = 0; it < 100 && r - l > 4 * Number.EPSILON * Math.max(1, Math.abs(r)); it++) {
    const m = (l + r) / 2;
    if (rising(m)) l = m;
    else r = m;
  }
  const apex = (l + r) / 2;
  const half = f(apex) / 2;
  // Each half-maximum crossing: bracketed on the grid, then bisected.
  const crossing = (dir: -1 | 1): number | null => {
    let i = k;
    while (i > 0 && i < n - 1 && y[i]! > half) i += dir;
    if (y[i]! > half) return null;
    // The grid point next to it on the apex side is still above half (or is the apex's own neighbour).
    let inside = dir < 0 ? Math.min(grid[i + 1]!, apex) : Math.max(grid[i - 1]!, apex);
    if (f(inside) <= half) inside = apex;
    let outside = grid[i]!;
    for (let it = 0; it < 100 && Math.abs(outside - inside) > 1e-13 * Math.max(1, Math.abs(apex)); it++) {
      const m = (inside + outside) / 2;
      if (f(m) > half) inside = m;
      else outside = m;
    }
    return (inside + outside) / 2;
  };
  const left = crossing(-1);
  const right = crossing(1);
  if (left === null || right === null) return null;
  return { x: apex, fwhm: right - left };
}

/** A can line in the data's range. */
export interface CanLine {
  readonly phase: string;
  readonly label: string;
  readonly hkl: string;
  /** d at the stated scale (Å). */
  readonly d: number;
  /** d of the room-temperature cell (Å). */
  readonly d293: number;
  readonly x: number;
  readonly fwhm: number;
  /** Integrated intensity per unit cell as the page computes it (multiplicity, |F|², Lorentz, corrections); arbitrary units. */
  readonly intensity: number;
  /** Integrated intensity relative to the phase's strongest line in the range. */
  readonly relative: number;
  /** Per unit volume of metal, relative to the strongest line of every can shown. */
  readonly height: number;
}

export interface CanPhaseLines {
  readonly can: CanPhase;
  readonly scale: number;
  readonly lines: readonly CanLine[];
  /** The strongest line's integrated intensity per unit volume of metal (relative to nothing: to compare phases). */
  readonly perVolume: number;
}

const structures = new Map<string, StructureModel | null>();
function structureOf(name: string): StructureModel | null {
  if (!structures.has(name)) structures.set(name, knownPhaseStructure(name));
  return structures.get(name)!;
}

/** "1 1 1" → "111" when every index is one digit and none is negative; "8 2 2/6 6 0" → "822/660". */
export function compactHkl(hkl: string): string {
  return hkl.split("/").map((one) => {
    const parts = one.trim().split(/\s+/);
    return parts.every((p) => /^\d$/.test(p)) ? parts.join("") : parts.join(" ");
  }).join("/");
}

/**
 * Every can phase's lines in the data's d-range at its scale (scales[phase],
 * default 1): positions, the page's FWHM there, and intensities (see the module
 * header). A phase the library does not hold is left out.
 */
export function canLines(ctx: CanLineContext, scales: Readonly<Record<string, number>> = {}, cans: readonly CanPhase[] = CAN_PHASES): CanPhaseLines[] {
  const { dMin, dMax } = reflectionDRange(ctx.pattern, ctx.applied);
  if (!(dMax > dMin)) return [];
  const raw: { can: CanPhase; scale: number; lines: Omit<CanLine, "intensity" | "relative" | "height">[]; I: number[]; volume2: number }[] = [];
  for (const can of cans) {
    const model = structureOf(can.phase);
    if (!model) continue;
    const s = scales[can.phase] ?? 1;
    if (!(s > 0)) continue;
    const reflections = generateReflections(model.cell, model.spaceGroup, dMin / s, dMax / s).map((r) => ({ ...r, d: r.d * s }));
    const intensities = powderPeakIntensities(model, ctx.pattern.radiation, reflections, 1, undefined, ctx.applyLorentz);
    const lines: Omit<CanLine, "intensity" | "relative" | "height">[] = [];
    const I: number[] = [];
    reflections.forEach((r, i) => {
      const prof = profileAt(ctx, r.d);
      if (!prof) return;
      // The page's intensity corrections (absorption, roughness) as placePeaks applies them.
      const placed = peaksAt(ctx, r.d, intensities[i]!.intensity).reduce((a, p) => a + p.intensity, 0);
      lines.push({ phase: can.phase, label: can.label, hkl: `${r.h} ${r.k} ${r.l}`, d: r.d, d293: r.d / s, x: prof.x, fwhm: prof.fwhm });
      I.push(placed);
    });
    const v = cellVolume(model.cell) * s * s * s;
    raw.push({ can, scale: s, lines, I, volume2: v * v });
  }
  let top = 0;
  for (const p of raw) for (const I of p.I) top = Math.max(top, I / p.volume2);
  return raw.map((p) => {
    const max = p.I.reduce((m, v) => Math.max(m, v), 0);
    return {
      can: p.can,
      scale: p.scale,
      perVolume: max / p.volume2,
      lines: p.lines
        .map((l, i) => ({ ...l, intensity: p.I[i]!, relative: max > 0 ? p.I[i]! / max : 0, height: top > 0 ? p.I[i]! / p.volume2 / top : 0 }))
        .sort((a, b) => b.d - a.d),
    };
  });
}

/** A sample reflection as the tick rows give it. */
export interface SampleReflection {
  readonly d: number;
  readonly hkl: string;
  /** Its phase's label. */
  readonly phase: string;
}

export interface SampleOverlap {
  readonly line: CanLine;
  readonly reflection: SampleReflection;
  /** |x_sample − x_can| / FWHM at the can line. */
  readonly separation: number;
}

/** Within one FWHM: the overlap rule. */
export const OVERLAP_FWHM = 1;
/**
 * Separations are shown to 0.01 FWHM, and one shown as 1.00 counts as within:
 * a peak's apex read off the data is not known better than that.
 */
const within = (sep: number): boolean => sep < OVERLAP_FWHM + 0.005;

/** The strongest can lines first (per volume of metal, across the cans), then the closest. */
const byStrength = (a: { line: CanLine; separation: number }, b: { line: CanLine; separation: number }): number =>
  b.line.height - a.line.height || b.line.d - a.line.d || a.separation - b.separation;

/**
 * Every sample reflection within one FWHM of a can line (the FWHM of the
 * page's profile at the can line): the strongest can lines first, the
 * closest first on each.
 */
export function canOverlaps(ctx: CanLineContext, phases: readonly CanPhaseLines[], reflections: readonly SampleReflection[]): SampleOverlap[] {
  const sample: SampleOverlap[] = [];
  const byD = [...reflections].sort((a, b) => a.d - b.d);
  const apex = new Map<SampleReflection, number | null>();
  const apexOf = (r: SampleReflection): number | null => {
    if (!apex.has(r)) apex.set(r, profileAt(ctx, r.d)?.x ?? null);
    return apex.get(r)!;
  };
  for (const phase of phases) {
    for (const line of phase.lines) {
      // The FWHM in d, from the local slope of x(d), to pick the candidates.
      const p1 = peaksAt(ctx, line.d)[0];
      const p2 = peaksAt(ctx, line.d * (1 + 1e-5))[0];
      const slope = p1 && p2 ? Math.abs(p2.center - p1.center) / (line.d * 1e-5) : NaN;
      const fwhmD = slope > 0 ? line.fwhm / slope : NaN;
      if (!Number.isFinite(fwhmD)) continue;
      for (const r of byD) {
        if (r.d < line.d - 3 * fwhmD) continue;
        if (r.d > line.d + 3 * fwhmD) break;
        const x = apexOf(r);
        if (x === null) continue;
        const separation = Math.abs(x - line.x) / line.fwhm;
        if (within(separation)) sample.push({ line, reflection: r, separation });
      }
    }
  }
  return sample.sort(byStrength);
}

/** An extra peak: intensity the model does not capture, at `x` on the pattern's abscissa (and its d). */
export interface ExtraPeak {
  readonly x: number;
  readonly d: number;
}

/** An extra peak, and the can line it lines up with (the closest within one FWHM), if any. */
export interface ExtraPeakMatch<P extends ExtraPeak = ExtraPeak> {
  readonly peak: P;
  readonly line: CanLine | null;
  /** |x_peak − x_can| / FWHM at the can line; null without a line. */
  readonly separation: number | null;
}

/**
 * Each extra peak against the can lines at their d-scales: the can line whose
 * apex is closest in FWHM of the page's profile at that line, when within one
 * FWHM. In the peaks' order.
 */
export function matchExtraPeaks<P extends ExtraPeak>(phases: readonly CanPhaseLines[], peaks: readonly P[]): ExtraPeakMatch<P>[] {
  return peaks.map((peak) => {
    let best: { line: CanLine; separation: number } | null = null;
    for (const phase of phases) {
      for (const line of phase.lines) {
        const separation = Math.abs(peak.x - line.x) / line.fwhm;
        if (within(separation) && (!best || separation < best.separation)) best = { line, separation };
      }
    }
    return { peak, line: best?.line ?? null, separation: best?.separation ?? null };
  });
}

/** How far a scale moves a phase's strongest line: in FWHM at that line, from its room-temperature place. */
export interface ScaleShift {
  readonly hkl: string;
  readonly d: number;
  /** Signed: (x at the scale − x at s = 1) / FWHM. */
  readonly fwhm: number;
}

/** The shift a d-scale makes at the phase's strongest line in the range (the line one would see). */
export function scaleShift(ctx: CanLineContext, phase: CanPhaseLines, scale: number): ScaleShift | null {
  const strongest = phase.lines.reduce<CanLine | null>((m, l) => (!m || l.relative > m.relative ? l : m), null);
  if (!strongest) return null;
  const at1 = profileAt(ctx, strongest.d293);
  const atS = profileAt(ctx, strongest.d293 * scale);
  if (!at1 || !atS) return null;
  return { hkl: strongest.hkl, d: strongest.d293 * scale, fwhm: (atS.x - at1.x) / at1.fwhm };
}

/** The plain reading of a sample reflection under a can line; `phase` false leaves the phase's name out (a one-phase page). */
export function sampleReading(o: SampleOverlap, { phase = true }: { readonly phase?: boolean } = {}): string {
  const where = o.separation <= 0.5 ? "sits under" : "overlaps";
  const of = phase ? `${o.reflection.phase}, ` : "";
  return `The ${o.line.phase} ${compactHkl(o.line.hkl)} line at ${o.line.d.toFixed(3)} Å ${where} the sample's ${compactHkl(o.reflection.hkl)} (${of}${o.reflection.d.toFixed(3)} Å): its intensity may include the can.`;
}
