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
  readonly rawData: { readonly name: string; readonly text: string; readonly bank: number };
  readonly rawInstrument: { readonly name: string; readonly text: string; readonly bank: number; readonly bundledDefault: string };
}

// TOF window: from the pattern's first point (d ≈ 0.13 Å at the file's difC) to
// 16905.49 µs (d 1.873 Å). Below d 0.209 Å the file's profile gives no peak
// (σ² ≤ 0), so the page leaves those 545 points out of the fit and of wR
// (THY-90): the fit counts 2334 points. The long-TOF end is cut below two peaks
// that no phase explains (check_fit_range, on the data: at 17209 and 17274 µs,
// d ≈ 1.91 Å, the stronger 9σ; each one data point wide, narrower than a line
// of this instrument there). The first rises from 17145 µs; the cut is one peak
// support below that (2.3548σ + γ + 1/α + 1/β of the profile at that TOF, file
// rows and the refined size: 231 µs), on the last data point below, 16905.49 µs.
// It is clear of the nearest GaTa₄Se₈ lines (440 at 16553 µs, its support
// ending at 16771 µs; 333/511 at 18013 µs, its support starting at 17764 µs).
// The 27 points above it are left out. check_fit_range proposes a cut at
// 4434 µs (d 0.49 Å), where the lines stop being resolved, to fit faster, and
// calls it a large cut to put to the user first; the example keeps that end.
const FIT_RANGE = { min: 1137.280204904, max: 16905.488658956 };

const BACKGROUND: { readonly type: BackgroundType; readonly terms: number } = { type: "chebyshev", terms: 7 };

// Snapshot of a converged refinement inside FIT_RANGE: Rw 2.495 %, GoF 5.898
// with sixteen free rows (scale, seven Chebyshev terms, a, the four B_iso and the
// three position modes), a = 10.37572(10) Å; status "converged", no near-null
// SVD direction (the owner's 0.5.1 project, with ten background terms and a
// narrower window, stalled with one). Made 2026-11-27 through the page's own
// refine (headless, testSupport/agentHeadless.ts), from the model above with
// the instrument file's bank-4 rows held: scale, background and a first; then
// alternately the sample profile (Lorentzian microstrain and size; the
// Gaussian microstrain held at 0, as it correlates with the background) and
// the structure (B_iso, positions), each with scale, background and a, five
// times each; the last structure stage moved nothing by more than 0.005 esd.
// The profile stages put the Lorentzian microstrain at its lower bound, 0,
// and the size at 0.0384(9) µm. The example opens with the rows the spec
// frees (scale, background, a) free and the rest held at these values. Keyed
// by parameter id, applied after the spec is rebuilt from the model.
const REFINED_PARAMS: Record<string, number> = {
  scale: 0.00003731959019619424,
  bkg0: 0.47467845110001994,
  bkg1: 0.12739806776741466,
  bkg2: 0.02396065930480788,
  bkg3: -0.0026104066912052792,
  bkg4: 0.032566208897163135,
  bkg5: 0.0071533371202941185,
  bkg6: 0.013716532851531758,
  cell_a: 10.375722843496254,
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
  tofSampleLorentz: 0,
  tofSampleSize: 0.03844925775546365,
  zero: -3.196819630450491,
  B_Ga1: 0.3489573765820661,
  B_Ta1: 0.3504330358174063,
  B_Se1: 0.4601028444982398,
  B_Se2: 0.4165920542781746,
  pos_Ta1_0: -0.0001865511179297992,
  pos_Se1_0: -0.00016481635772059558,
  pos_Se2_0: 0.0004175746291828129,
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
    rawData: { name: NOMAD_DATA_NAME, text: patternText, bank: NOMAD_BANK },
    rawInstrument: { name: "NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm", text: instrumentText, bank: NOMAD_BANK, bundledDefault: "nomad-2023A" },
  };
  return cached;
}
