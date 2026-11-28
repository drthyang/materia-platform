/**
 * Bundled GaTa₄Se₈ NOMAD 300 K time-of-flight neutron dataset: a one-phase
 * Rietveld example that opens on a converged fit of bank 4. The data are
 * published (T.-H. Yang et al., Phys. Rev. Research 4, 033123 (2022); NOMAD,
 * IPTS-26313, run 160894); the six-bank .gsa is shipped whole, as written, and
 * kept in the session as a loaded multi-bank file is, so the Data card's bank
 * chooser lists banks 1–6 (examples/gata4se8-nomad-300k/README.md). The instrument is bank 4 of the
 * NOMAD 2023A instrument file MATERIA ships as a default
 * (examples/instruments/nomad/), so the profile is the file's.
 */

import patternText from "../../examples/gata4se8-nomad-300k/NOM_GaTa4Se8_at_300K.gsa?raw";
import instrumentText from "../../examples/instruments/nomad/NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm?raw";
import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { BackgroundType } from "@/core/diffraction/background";
import { parseCif } from "@/parsers/cif";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { parseInstrumentFile } from "@/parsers/instrument";

/** The data file's name, as the page shows it. */
export const NOMAD_DATA_NAME = "NOM_GaTa4Se8_at_300K.gsa";
/** The NOMAD bank the example fits (in the data file and in the instrument file). */
export const NOMAD_BANK = 4;

// The owner's starting model (MATERIA 0.5.1 project "GaTa4Se8-NOMAD-300K-bank4",
// structure "3D"): F-43m with the origin at Ga (4c) and its site labels, except
// that its second Se site, "Se17" there, is named Se2 here; the ADP of each site
// made isotropic (B = 8π²U, U the owner's diagonal U). It is the
// lacunar-spinel structure of examples/mcp/gata4se8.cif, written from another
// origin and hand (the same powder pattern), with the owner's own values.
export const GATA4SE8_NOMAD_CIF = `data_GaTa4Se8
_pd_phase_name  GaTa4Se8
_cell_length_a  10.3564
_cell_length_b  10.3564
_cell_length_c  10.3564
_cell_angle_alpha  90
_cell_angle_beta   90
_cell_angle_gamma  90
_symmetry_space_group_name_H-M  "F -4 3 m"
loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  _atom_site_U_iso_or_equiv
  Ga Ga1  0.25      0.75      0.75      1 0.008453
  Ta Ta1  0.64772   0.85228   0.85228   1 0.00422
  Se Se1  0.886164  0.886164  0.886164  1 0.00674
  Se Se2  0.384737  0.884736  0.884736  1 0.00548
`;

export interface GaTa4Se8NomadExample {
  readonly structure: StructureModel;
  readonly pattern: PowderPattern;
  readonly instrument: InstrumentParameters;
  /** Converged parameter values (id → value) inside `fitRange`. */
  readonly refinedParams: Record<string, number>;
  /** The refinement window the example opens with (TOF, µs). */
  readonly fitRange: { readonly min: number; readonly max: number };
  readonly backgroundType: BackgroundType;
  readonly backgroundTerms: number;
  /** The two files as loaded (the whole six-bank data file), kept in the session as a loaded file's are. */
  readonly rawData: { readonly name: string; readonly text: string; readonly bank: number; readonly bankWindows: Readonly<Record<string, { readonly min: number; readonly max: number }>> };
  readonly rawInstrument: { readonly name: string; readonly text: string; readonly bank: number; readonly bundledDefault: string };
}

// TOF window: 3000–16000 µs (d 0.331–1.773 Å), the owner's choice; 1785
// points. It lies above d 0.209 Å, below which the file's profile gives no
// peak (σ² ≤ 0, THY-90), so every point in it is fitted, and below the two
// long-TOF peaks that no phase explains (17209 and 17274 µs, d ≈ 1.91 Å).
// check_fit_range proposes a cut near 4600 µs (d 0.51 Å), where the lines stop
// being resolved, to fit faster, and calls it a large cut to put to the user
// first; the example keeps the owner's window.
const FIT_RANGE = { min: 3000, max: 16000 };

// The owner's fit window for each bank of the data file (TOF, µs), stored with
// the file (rawData.bankWindows): choosing a bank in the Data card's chooser
// sets the window to that bank's (app/bankKeep.ts). Each lies inside its
// bank's data. Bank 6 has none: the instrument file has no bank 6, and the
// page holds Refine there.
const BANK_WINDOWS: Readonly<Record<string, { readonly min: number; readonly max: number }>> = {
  "1": { min: 1250, max: 16400 },
  "2": { min: 1400, max: 17600 },
  "3": { min: 2000, max: 18500 },
  "4": FIT_RANGE,
  "5": { min: 4000, max: 15300 },
};

const BACKGROUND: { readonly type: BackgroundType; readonly terms: number } = { type: "chebyshev", terms: 7 };

// Snapshot of a converged refinement inside FIT_RANGE: Rw 2.208 %, GoF 5.718
// with sixteen free rows (scale, seven Chebyshev terms, a, the four B_iso and the
// three position modes), a = 10.37596(10) Å; status "converged", no near-null
// SVD direction (the high correlations are among the background terms only).
// Made 2026-11-28 through the page's own refine (headless,
// testSupport/agentHeadless.ts), from the model above with the instrument
// file's bank-4 rows held: scale, background and a first; then alternately the
// sample profile (Lorentzian microstrain and size; the Gaussian microstrain
// held at 0, as it correlates with the background) and the structure (B_iso,
// positions), each with scale, background and a, fifteen times each; the last
// structure stage moved nothing by more than 0.001 esd. The profile stages put
// the Lorentzian microstrain at 424(79) and the size at 0.0464(15) µm. The
// example opens with the rows the spec frees (scale, background, a) free and
// the rest held at these values. Keyed by parameter id, applied after the spec
// is rebuilt from the model.
const REFINED_PARAMS: Record<string, number> = {
  scale: 0.00003699290913148213,
  bkg0: 0.548273074558259,
  bkg1: 0.15094797516697686,
  bkg2: 0.15120735872055202,
  bkg3: 0.012034143396177952,
  bkg4: 0.1114262911331799,
  bkg5: 0.012893821227680813,
  bkg6: 0.04315476222016007,
  cell_a: 10.375964764591364,
  tof_difC: 9068.553459758095,
  tof_difA: -23.07639352718455,
  tof_difB: 0,
  tof_alpha1: 0.10035694239047813,
  tof_beta0: 0.039149083861326865,
  tof_beta1: 0.15675783660419662,
  tof_betaQ: -0.08735516778530311,
  tof_sig0: -75.19558926024992,
  tof_sig1: -261.1939549202771,
  tof_sig2: 76.27265656376133,
  tof_sigQ: 413.02010359564184,
  tof_gamX: 0.6773538418798967,
  tof_gamY: 6.397888325532403,
  tof_gamZ: 0,
  tofSampleGauss: 0,
  tofSampleLorentz: 423.8097118105326,
  tofSampleSize: 0.046448604780985246,
  zero: -3.196819630450491,
  B_Ga1: 0.3103685396674084,
  B_Ta1: 0.343465076487938,
  B_Se1: 0.44492811016940914,
  B_Se2: 0.39307846732646057,
  pos_Ta1_0: -0.00021716632322054744,
  pos_Se1_0: -0.0004272710421696226,
  pos_Se2_0: 0.0006012986590684235,
  occ_Ga1: 1,
  occ_Ta1: 1,
  occ_Se1: 1,
  occ_Se2: 1,
};

let cached: GaTa4Se8NomadExample | null = null;

/** The bundled GaTa₄Se₈ NOMAD TOF example, on bank 4 of the six-bank file (parsed once, memoized). */
export function gata4se8NomadExample(): GaTa4Se8NomadExample {
  if (cached) return cached;
  const structure: StructureModel = { ...parseCif(GATA4SE8_NOMAD_CIF, "gata4se8"), id: "gata4se8", name: "GaTa₄Se₈" };
  const pattern = parseGsasHistogramPattern(patternText, "gata4se8-powder", "GaTa₄Se₈ NOMAD 300 K (TOF, bank 4)", { radiation: { kind: "neutron-tof" }, bank: NOMAD_BANK });
  const bank = parseInstrumentFile(instrumentText).banks.find((b) => b.bank === NOMAD_BANK);
  if (!bank) throw new Error(`The NOMAD instrument file has no bank ${NOMAD_BANK}`);
  cached = {
    structure,
    pattern,
    instrument: bank.parameters,
    refinedParams: REFINED_PARAMS,
    fitRange: FIT_RANGE,
    backgroundType: BACKGROUND.type,
    backgroundTerms: BACKGROUND.terms,
    rawData: { name: NOMAD_DATA_NAME, text: patternText, bank: NOMAD_BANK, bankWindows: BANK_WINDOWS },
    rawInstrument: { name: "NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm", text: instrumentText, bank: NOMAD_BANK, bundledDefault: "nomad-2023A" },
  };
  return cached;
}
