/**
 * The parameter panel's groups: which group each parameter kind lives in, and
 * the order the groups are shown in. The panel (ParameterPanel.tsx) lists the
 * rows by them, and the Validation view names them when it points the user at
 * the rows a cause of misfit is about ("Open Instrument / profile").
 */

import type { ParameterKind } from "@/core/refinement/types";

export const PARAMETER_GROUP: Record<ParameterKind, string> = {
  scale: "Scale",
  background: "Background",
  cellLength: "Lattice",
  cellAngle: "Lattice",
  peakWidth: "Instrument / profile",
  profileU: "Instrument / profile",
  profileV: "Instrument / profile",
  profileW: "Instrument / profile",
  profileX: "Microstructure",
  profileY: "Microstructure",
  asymSL: "Instrument / profile",
  asymHL: "Instrument / profile",
  zeroShift: "Instrument / profile",
  sampleDisplacement: "Corrections",
  sampleTransparency: "Corrections",
  tofCalibration: "Instrument / profile",
  tofProfile: "Instrument / profile",
  bIso: "ADPs (thermal)",
  uAniso: "ADPs (thermal)",
  atomX: "Positions",
  atomY: "Positions",
  atomZ: "Positions",
  positionShift: "Positions",
  occupancy: "Occupancy",
  poRatio: "Corrections",
  absorption: "Corrections",
  surfaceRoughA: "Corrections",
  surfaceRoughB: "Corrections",
  extinction: "Corrections",
  batchScale: "Scale",
  twinFraction: "Twinning",
  ridingTorsion: "Positions",
  stephensStrain: "Microstructure",
  anisoSizePerp: "Microstructure",
  anisoSizePar: "Microstructure",
  mustrainPerp: "Microstructure",
  mustrainPar: "Microstructure",
  mustrainIso: "Microstructure",
  magneticScale: "Magnetic",
  momentX: "Magnetic",
  momentY: "Magnetic",
  momentZ: "Magnetic",
  momentMode: "Magnetic",
  // Its own group: freeing "all Magnetic" must not also move k — refining the
  // propagation vector is a deliberate step, not a side effect of the moments.
  propagationK: "Propagation vector",
  // Real-space PDF fit: the G(r) scale joins "Scale"; the remaining PDF terms
  // split by PHYSICS — they are independent effects that happen to share a page,
  // so they get separate groups rather than one catch-all "PDF" bucket:
  //   · instrument Q-resolution envelope (Qdamp/Qbroad) — calibrated, held fixed;
  //   · near-neighbor correlated motion (δ1/δ2, or sratio/rcut) — sharpens low-r;
  //   · finite-particle shape envelope (spdiameter) — nanoparticle size.
  // "Instrument" only ever co-exists with the powder "Instrument / profile" in
  // PARAMETER_GROUP, never on one page — qdamp/qbroad appear only in PDF specs.
  pdfScale: "Scale",
  qdamp: "Instrument",
  qbroad: "Instrument",
  delta1: "Correlated motion",
  delta2: "Correlated motion",
  sratio: "Correlated motion",
  rcut: "Correlated motion",
  spdiameter: "Particle shape",
  // Magnetic-PDF envelope rows get their OWN group rather than joining the
  // moments in "Magnetic": mpdfOrdScale scales d_mag(r) exactly as the moment
  // magnitude does, so the two are perfectly degenerate. Sharing a group would
  // let one click of the group's "all free" checkbox free the degenerate pair
  // and fit a flat valley.
  mpdfOrdScale: "mPDF",
  mpdfParaScale: "mPDF",
  mpdfPsigma: "mPDF",
  corrLength: "mPDF",
};

export const GROUP_ORDER = ["Scale", "Background", "Lattice", "Instrument / profile", "Instrument", "Correlated motion", "Particle shape", "ADPs (thermal)", "Positions", "Occupancy", "Microstructure", "Corrections", "Magnetic", "Propagation vector", "mPDF"];

/** The panel group a parameter kind is listed in ("Other" for a kind no group names). */
export function parameterGroupOf(kind: ParameterKind): string {
  return PARAMETER_GROUP[kind] ?? "Other";
}
