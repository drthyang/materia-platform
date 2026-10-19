/**
 * Simulated powder patterns for the validation cases (docs/VALIDATION.md,
 * "Does the Agent help?"): a constant-wavelength neutron pattern computed by
 * the engine from a known structure, with seeded counting noise, so every
 * refined value has a truth to be scored against. The instrument is the one
 * Example 3 uses (examples/mcp/mn3ga_30k.instprm: λ 1.54 Å, GSAS-II U V W,
 * a small asymmetry), the pattern 10–130° 2θ in 0.05° steps.
 *
 * Faults are injected the way they happen: a wavelength typed wrong, a file of
 * d-spacings loaded as degrees, a zero offset, a second phase or a line no
 * phase explains. The model the page opens on is a separate structure (the
 * "literature CIF"), so a start can be off as a real one is.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StructureModel } from "@/core/crystal/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";
import { loadedSession, type Session } from "@/app/powderSession";
import { openedPage } from "@/app/powderPage";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { sessionCurves } from "@/testSupport/magneticHeadless";
import { cellContentsMass } from "@/core/crystal/atomicMass";
import { cellVolume } from "@/core/crystal/unitCell";

export const WAVELENGTH = 1.54;
const X_MIN = 10;
const X_MAX = 130;
const STEP = 0.05;

let instrumentCache: InstrumentParameters | null = null;
/** Example 3's instrument (committed): CW neutrons, λ 1.54 Å. */
export function validationInstrument(): InstrumentParameters {
  instrumentCache ??= parseInstrumentParameters(readFileSync(resolve(__dirname, "../../../examples/mcp/mn3ga_30k.instprm"), "utf8"));
  return instrumentCache;
}

/** A CIF from its cell, space group and sites ("label type x y z occ Biso"). */
export function cif(name: string, cell: readonly number[], spaceGroup: string, sites: readonly string[]): string {
  return [
    `data_${name}`,
    ...["a", "b", "c"].map((k, i) => `_cell_length_${k} ${cell[i]}`),
    ...["alpha", "beta", "gamma"].map((k, i) => `_cell_angle_${k} ${cell[i + 3]}`),
    `_symmetry_space_group_name_H-M "${spaceGroup}"`,
    "loop_",
    "_atom_site_label",
    "_atom_site_type_symbol",
    "_atom_site_fract_x",
    "_atom_site_fract_y",
    "_atom_site_fract_z",
    "_atom_site_occupancy",
    "_atom_site_B_iso_or_equiv",
    ...sites,
    "",
  ].join("\n");
}

export const structureOf = (text: string, id: string): StructureModel => parseCif(text, id);

/** Seeded standard normal deviates (the same noise on every run). */
export function gaussian(seed: number): () => number {
  let state = seed;
  const uniform = (): number => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

export interface SimulationSpec {
  /** The sample: its phases at their true values (the first is the main phase). */
  readonly phases: readonly StructureModel[];
  /** Weight percent of each phase after the first (Hill & Howard); the main phase takes the rest. */
  readonly minorWeightPercent?: readonly number[];
  /** Counts at the strongest peak above the background. */
  readonly peakCounts?: number;
  /** Flat background, counts. */
  readonly background?: number;
  /** The instrument's true zero offset, ° 2θ. */
  readonly zero?: number;
  readonly seed: number;
}

/** The pattern the sample gives on the validation instrument, with counting noise. */
export function simulatePowder(spec: SimulationSpec): PowderPattern {
  const instrument = validationInstrument();
  const n = Math.round((X_MAX - X_MIN) / STEP) + 1;
  const skeleton: PowderPattern = {
    id: "validation-powder",
    name: "simulated CW neutron pattern (λ 1.54 Å)",
    xUnit: "twoTheta",
    radiation: { kind: "neutron", wavelength: WAVELENGTH },
    wavelength: WAVELENGTH,
    points: Array.from({ length: n }, (_, i) => ({ x: X_MIN + i * STEP, yObs: 0 })),
  } as PowderPattern;
  const [main, ...minor] = spec.phases;
  const s = loadedSession(main!, skeleton, instrument, [...minor]);
  const scaleIds = s.powderParams.filter((p) => p.kind === "scale").map((p) => p.id);
  // Relative scales from the weight fractions: W_p ∝ S_p (ZMV)_p.
  const zmv = spec.phases.map((ph) => cellContentsMass(ph) * cellVolume(ph.cell));
  const minorW = (spec.minorWeightPercent ?? []).map((w) => w / 100);
  const mainW = 1 - minorW.reduce((a, b) => a + b, 0);
  const relative = spec.phases.map((_, i) => (i === 0 ? 1 : (minorW[i - 1]! / mainW) * (zmv[0]! / zmv[i]!)));
  const withValues = (scales: readonly number[], bkg0: number): Session => ({
    ...s,
    powderParams: s.powderParams.map((p) => {
      const k = scaleIds.indexOf(p.id);
      if (k >= 0) return { ...p, value: scales[k] ?? 0 };
      if (p.kind === "background") return { ...p, value: p.id.endsWith("0") ? bkg0 : 0 };
      if (p.kind === "zeroShift") return { ...p, value: spec.zero ?? 0 };
      return p;
    }),
  });
  const unit = sessionCurves(withValues(relative, 0)).yCalc;
  const flat = sessionCurves(withValues(relative.map(() => 0), 1)).yCalc;
  const k = (spec.peakCounts ?? 20000) / Math.max(...unit);
  const flatMean = flat.reduce((a, b) => a + b, 0) / flat.length || 1;
  const b = (spec.background ?? 300) / flatMean;
  const noise = gaussian(spec.seed);
  return {
    ...skeleton,
    points: skeleton.points.map((p, i) => {
      const y = k * unit[i]! + b * flat[i]!;
      const sigma = Math.sqrt(Math.max(y, 1));
      return { x: p.x, yObs: y + sigma * noise(), sigma };
    }),
  };
}

/** The page as the app opens it: the model's CIF, the pattern and the instrument. */
export function openedSession(model: StructureModel, pattern: PowderPattern): Session {
  return openedPage(model, validationInstrument(), pattern).session;
}

/** Fault: the pattern loaded at a wavelength it was not measured at. */
export function atWavelength(pattern: PowderPattern, wavelength: number): PowderPattern {
  return { ...pattern, wavelength, radiation: { ...pattern.radiation, wavelength } as PowderPattern["radiation"] };
}

/** Fault: a file of d-spacings (Å) loaded as 2θ (°). */
export function asDSpacingsLabelledTwoTheta(pattern: PowderPattern): PowderPattern {
  const points = pattern.points
    .map((p) => ({ ...p, x: WAVELENGTH / (2 * Math.sin((p.x * Math.PI) / 360)) }))
    .sort((a, b) => a.x - b.x);
  return { ...pattern, points };
}

/** A line no phase explains, at this d (Å), of this height (counts) and FWHM (° 2θ). */
export function withLine(pattern: PowderPattern, d: number, height: number, fwhm = 0.35): PowderPattern {
  const at = (2 * Math.asin(WAVELENGTH / (2 * d)) * 180) / Math.PI;
  const s = fwhm / 2.355;
  const points = pattern.points.map((p) => {
    const y = p.yObs + height * Math.exp(-0.5 * ((p.x - at) / s) ** 2);
    return { ...p, yObs: y, sigma: Math.sqrt(Math.max(y, 1)) };
  });
  return { ...pattern, points };
}

export const twoThetaOf = (d: number): number => (2 * Math.asin(WAVELENGTH / (2 * d)) * 180) / Math.PI;
