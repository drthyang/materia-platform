/**
 * The line-position standards an instrument is calibrated against: NIST SRM
 * 640e (silicon) and SRM 660c (lanthanum hexaboride, ¹¹B-enriched). Each has
 * its certified lattice parameter at the certificate's temperature, as the
 * certificate states it, and the structure the calibration refines against.
 *
 * The cell is the standard's, never the fit's: a calibration holds it at the
 * certified value (corrected to the measurement temperature) and refines the
 * instrument's constants against it. difC and the cell are one factor on every
 * d, exactly correlated, so the two are never free together.
 *
 * The temperature correction needs the standard's thermal expansion. Each
 * certificate names the expansion it used to bring its own measurements to
 * 22.5 °C (`expansionReference`); the numbers the app would apply are not
 * chosen yet (`expansion` is absent), so `latticeAt` corrects nothing and says
 * so when the data were measured at another temperature.
 */

import type { StructureModel } from "@/core/crystal/types";
import { parseCif } from "@/parsers/cif";

export type CalibrationStandardId = "si640e" | "lab6660c";

/** A thermal expansion the app applies: the ratio a(T₂)/a(T₁) and where it comes from. */
export interface ThermalExpansion {
  readonly source: string;
  readonly ratio: (fromK: number, toK: number) => number;
}

export interface CalibrationStandard {
  readonly id: CalibrationStandardId;
  /** "NIST SRM 640e (silicon)". */
  readonly name: string;
  /** The compound, e.g. "Si". */
  readonly formula: string;
  /** Certified cubic lattice parameter (Å) at `certificateTemperatureK`. */
  readonly certifiedA: number;
  /** The certificate's expanded uncertainty (k = 2) of `certifiedA`, Å. */
  readonly expandedUncertaintyA: number;
  /** 22.5 °C. */
  readonly certificateTemperatureK: number;
  /** The certificate: issuer, number, issue date. */
  readonly certificate: string;
  /** The expansion data the certificate itself used to refer its value to 22.5 °C. */
  readonly expansionReference: string;
  /** The expansion the app applies to other temperatures; absent until chosen. */
  readonly expansion?: ThermalExpansion;
}

/** 22.5 °C in kelvin. */
export const CERTIFICATE_TEMPERATURE_K = 295.65;

/** A measurement temperature this close to the certificate's needs no correction (K). */
export const SAME_TEMPERATURE_K = 0.05;

export const CALIBRATION_STANDARDS: Readonly<Record<CalibrationStandardId, CalibrationStandard>> = {
  si640e: {
    id: "si640e",
    name: "NIST SRM 640e (silicon)",
    formula: "Si",
    // "The certified lattice parameter for a temperature of 22.5 °C is 0.543 117 9 nm ± 0.000 008 nm" (k = 2).
    certifiedA: 5.431179,
    expandedUncertaintyA: 0.00008,
    certificateTemperatureK: CERTIFICATE_TEMPERATURE_K,
    certificate: "NIST, Certificate of Analysis, SRM 640e, issued 29 October 2015",
    expansionReference: "Bergamin et al., J. Appl. Phys. 82, 5396–5400 (1997), as the certificate cites it",
  },
  lab6660c: {
    id: "lab6660c",
    name: "NIST SRM 660c (lanthanum hexaboride, ¹¹B-enriched)",
    formula: "LaB6",
    // "The certified lattice parameter for a temperature of 22.5 °C is 0.415 682 6 nm ± 0.000 008 nm" (k = 2).
    certifiedA: 4.156826,
    expandedUncertaintyA: 0.00008,
    certificateTemperatureK: CERTIFICATE_TEMPERATURE_K,
    certificate: "NIST, Certificate of Analysis, SRM 660c, issued 29 October 2015",
    expansionReference: "Sirota et al., Phys. Solid State 40, 1856–1858 (1998), as the certificate cites it",
  },
};

/** The standard's cell at the measurement temperature, or why it cannot be given. */
export type StandardLattice =
  | { readonly kind: "certified"; readonly a: number; readonly temperatureK: number; readonly note: string }
  | { readonly kind: "corrected"; readonly a: number; readonly temperatureK: number; readonly note: string }
  | { readonly kind: "needsExpansion"; readonly temperatureK: number; readonly note: string };

/**
 * The standard's lattice parameter at the temperature the data were measured
 * at. At the certificate's temperature it is the certified value; elsewhere it
 * is corrected with the standard's expansion, which must be chosen first.
 */
export function latticeAt(standard: CalibrationStandard, temperatureK: number): StandardLattice {
  const cert = `${standard.certifiedA.toFixed(6)} Å ± ${standard.expandedUncertaintyA.toFixed(5)} Å (k = 2) at ${(standard.certificateTemperatureK - 273.15).toFixed(1)} °C (${standard.certificate})`;
  if (Math.abs(temperatureK - standard.certificateTemperatureK) <= SAME_TEMPERATURE_K) {
    return { kind: "certified", a: standard.certifiedA, temperatureK, note: `a = ${cert}.` };
  }
  if (!standard.expansion) {
    return {
      kind: "needsExpansion", temperatureK,
      note: `The data were measured at ${temperatureK.toFixed(2)} K, the certificate's value is for ${standard.certificateTemperatureK.toFixed(2)} K: a = ${cert}. The correction needs ${standard.formula}'s thermal expansion (the certificate used ${standard.expansionReference}), which the app does not have yet.`,
    };
  }
  const a = standard.certifiedA * standard.expansion.ratio(standard.certificateTemperatureK, temperatureK);
  return {
    kind: "corrected", a, temperatureK,
    note: `a = ${a.toFixed(6)} Å at ${temperatureK.toFixed(2)} K: the certified ${cert}, corrected with ${standard.expansion.source}.`,
  };
}

/** The standard's site parameters the calibration starts from (refined: U_iso; held: the LaB₆ boron x). */
export interface StandardSites {
  /** Starting U_iso per site label (Å²). */
  readonly uiso?: Readonly<Record<string, number>>;
  /** LaB₆ only: the boron x of 6f (x, ½, ½), which symmetry does not fix. Required for LaB₆. */
  readonly boronX?: number;
}

/**
 * The standard as a structure: silicon in Fd-3m (origin 2, Si on 8a), LaB₆ in
 * Pm-3m (La on 1a, ¹¹B on 6f), at the cell given.
 */
export function standardStructure(standard: CalibrationStandard, a: number, sites: StandardSites = {}): StructureModel {
  const u = (label: string, fallback: number): number => sites.uiso?.[label] ?? fallback;
  const head = (sg: string): string => [
    `data_${standard.formula}`,
    `_cell_length_a ${a}`, `_cell_length_b ${a}`, `_cell_length_c ${a}`,
    "_cell_angle_alpha 90", "_cell_angle_beta 90", "_cell_angle_gamma 90",
    `_symmetry_space_group_name_H-M '${sg}'`,
    "loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z",
    "_atom_site_occupancy", "_atom_site_U_iso_or_equiv",
  ].join("\n");
  if (standard.id === "si640e") {
    return parseCif(`${head("F d -3 m:2")}\nSi1 Si 0.125 0.125 0.125 1 ${u("Si1", 0.006)}\n`, "standard");
  }
  if (sites.boronX === undefined) throw new Error("LaB₆: the boron x of 6f (x, ½, ½) must be given; symmetry does not fix it");
  return parseCif(`${head("P m -3 m")}\nLa1 La 0 0 0 1 ${u("La1", 0.003)}\nB1 11B ${sites.boronX} 0.5 0.5 1 ${u("B1", 0.003)}\n`, "standard");
}
