/**
 * Bundled Mn₃Ga POWGEN 600 K time-of-flight neutron dataset — the default
 * example the workbench opens with. The observed pattern is embedded (a `?raw`
 * import) so it ships with the production build and needs no runtime fetch or
 * local `data/` folder. The data is published (Zhang et al., POWGEN long-scan,
 * 600 K, λ = 0.8 Å); the structure is the bundled P6₃/mmc model and difC is read
 * from the .gsa bank header.
 *
 * The real sample carries a rock-salt MnO impurity, so the example opens as a
 * two-phase (Mn₃Ga + MnO) refinement — the textbook multi-phase demo.
 */

import patternText from "@/examples/datasets/mn3ga_powgen_600k.dat?raw";
import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { BackgroundType } from "@/core/diffraction/background";
import { parsePowderData } from "@/parsers/powderData";
import { parseCif } from "@/parsers/cif";
import { exampleStructure } from "@/examples/mn3ga";

// From the PG3_45607.gsa bank header: "DIFC 22585.8" (POWGEN 600 K, λ = 0.8 Å).
const DIF_C = 22585.8;

// Rock-salt MnO (Fm-3m) — the common impurity phase in this Mn₃Ga sample. The
// H-M name alone resolves the full group from the built-in space-group table.
export const MNO_CIF = `data_MnO
_pd_phase_name  MnO
_cell_length_a  4.446
_cell_length_b  4.446
_cell_length_c  4.446
_cell_angle_alpha  90
_cell_angle_beta   90
_cell_angle_gamma  90
_symmetry_space_group_name_H-M  "F m -3 m"
loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  _atom_site_U_iso_or_equiv
  Mn Mn1 0 0 0 1 0.006
  O  O1  0.5 0.5 0.5 1 0.006
`;

export interface Mn3GaPowgenExample {
  readonly structure: StructureModel;
  /** Additional crystallographic phases in the sample (here: the MnO impurity). */
  readonly extraPhases: StructureModel[];
  readonly pattern: PowderPattern;
  readonly instrument: InstrumentParameters;
  /** Converged parameter values (id → value) inside `fitRange`, in the
   *  `backgroundType`/`backgroundTerms` basis. Applied on load so the demo opens
   *  on a finished refinement rather than the raw starting model. */
  readonly refinedParams: Record<string, number>;
  /** The refinement window the demo opens with (TOF, µs). */
  readonly fitRange: { readonly min: number; readonly max: number };
  /** The background the snapshot was refined with: its basis and number of coefficients. */
  readonly backgroundType: BackgroundType;
  readonly backgroundTerms: number;
}

// TOF window, d ≈ 0.41–5.03 Å at this difC.
const FIT_RANGE = { min: 9349.424134934858, max: 113673.10659380186 };

// The snapshot's background: GSAS-II "log interpolate" with three points.
const BACKGROUND: { readonly type: BackgroundType; readonly terms: number } = { type: "logInterpolate", terms: 3 };

// Snapshot of a converged two-phase refinement inside FIT_RANGE, made in the
// app (MATERIA 0.5.0 project "Mn3Ga · Rietveld (powder)", 2026-11-03): wR 4.24 %,
// GoF 3.23 with the eight free rows below. The B_iso of both phases and the Mn x
// were refined in an earlier step, the Mn₃Ga mustrain in the last one, and then
// held; the demo opens with the rows the spec frees (scale, background, cell of
// both phases) free and the rest held at these values. Keyed by parameter id so
// it is applied after the spec is (deterministically) rebuilt from the model.
const REFINED_PARAMS: Record<string, number> = {
  p0_scale: 1.3795198657809256,
  bkg0: 58.056311670165464,
  bkg1: 41.71495972546248,
  bkg2: 54.233644621199666,
  p0_cell_a: 5.419643070348825,
  p0_cell_c: 4.373665652217974,
  tof_difC: 22585.8,
  tof_difA: 0,
  tof_difB: 0,
  tof_alpha0: 0,
  tof_alpha1: 200,
  tof_beta0: 0.7871359754574907,
  tof_beta1: 0.015683176112119435,
  tof_betaQ: 0,
  tof_sig0: 0,
  tof_sig2: 559.4307113995054,
  tof_sigQ: 0,
  zero: 0.10901248683627304,
  p0_B_Mn1: 1.095888995939349,
  p0_B_Ga1: 0.9610606861919474,
  p0_pos_Mn1_0: 0.005046471995896179,
  p0_occ_Mn1: 0.978,
  p0_occ_Ga1: 1.005,
  mustrainIso: 588.135408384408,
  p1_scale: 0.09746474228130754,
  p1_cell_a: 4.456038493037522,
  p1_B_Mn1: 1.1318502533554347,
  p1_B_O1: 1.1595814122614099,
  p1_occ_Mn1: 1,
  p1_occ_O1: 1,
};

let cached: Mn3GaPowgenExample | null = null;

/** The bundled Mn₃Ga + MnO POWGEN TOF example (parsed once, memoized). */
export function mn3gaPowgenExample(): Mn3GaPowgenExample {
  if (cached) return cached;
  const structure: StructureModel = { ...exampleStructure(), id: "mn3ga" };
  const mno: StructureModel = { ...parseCif(MNO_CIF, "mno"), id: "mno" };
  const pattern = parsePowderData(patternText, {
    id: "mn3ga-powder",
    name: "Mn₃Ga POWGEN 600 K (TOF, λ=0.8 Å)",
    xUnit: "tof",
    radiation: { kind: "neutron-tof" },
  });
  cached = { structure, extraPhases: [mno], pattern, instrument: { kind: "tof", difC: DIF_C }, refinedParams: REFINED_PARAMS, fitRange: FIT_RANGE, backgroundType: BACKGROUND.type, backgroundTerms: BACKGROUND.terms };
  return cached;
}
