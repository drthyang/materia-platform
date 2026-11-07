/**
 * The owner's unpublished local datasets: where each one sits in the
 * git-ignored `data/` folder. Tests, docs and comments refer to them only by
 * the keys below ("the local magnetic TOF dataset", …).
 *
 * The folder and file names are those of the owner's local copies. They stay
 * here, in this one file, because renaming them would break the local folders;
 * whether to read them from the environment instead is the owner's call. No
 * data, and no number measured on them, is in the repository.
 *
 * Pure (no Node imports), so the dev-only local demo can use it too.
 */
export const LOCAL_DATA = {
  /** A magnetic POWGEN TOF dataset: bank-3 patterns, calibrations, the refined structure, a reference mCIF and a PDF (layout in docs/VALIDATION.md). */
  magneticTof: "AWO4",
  /** The local magnetic demo's solution, written by `localMagneticDemoSolve.test.ts`. */
  magneticTofSolution: "AWO4/awo4_demo_solution.json",
  /** A synchrotron X-ray powder dataset (28-ID): its structure, a pattern and a GSAS-II fit of it. */
  xrd: {
    dir: "GaNb4Se8_XRD",
    /** Other names the same local folder is kept under. */
    aliases: ["GaNb4Se8_XRD_28ID"],
    structure: "GaNb4Se8_100K.cif",
    pattern: "GaNb4Se8_799_T_298.8K_gsas.dat",
    gsasFit: "GaNb4Se8_goodfit_298K.csv",
  },
  /** An X-ray PDF dataset (28-ID) of the same compound: a low-temperature G(r) and a local model. */
  xrayPdf: {
    dir: "GaNb4Se8_PDF_Qmax_27",
    pattern: "GaNb4Se8_101_T_base_5.8K_T_FC0.0K_Sample_X_5.78mm_DetZ_3674.0mm_new_masked_L1_U98_q.dat_bgsub_scale_0.28_shift_110.gr",
    localModel: "P213_5p8K_extracted.cif",
  },
  /** A room-temperature G(r) of the same X-ray PDF dataset. */
  xrayPdfRoomT: "PDF/GaNb4Se8_28ID/GaNb4Se8_796_T_base_299.5K_T_FC0.0K_Sample_X_5.78mm_DetZ_3674.0mm_new_masked_L1_U98_q.dat_bgsub_scale_0.28_shift_110.gr",
  /** A hexagonal magnetic POWGEN dataset: a GSAS-II magnetic refinement and a raw histogram. */
  hexMagnetic: {
    refinement: "FeCoSn/Co0p55/refinement/1p7K",
    histogram: "FeCoSn/PG3_48278.gsa",
  },
  /** A neutron PDF of the hexagonal dataset: its G(r) and a starting structure. */
  hexPdf: {
    pattern: "FeCoSn_PDF/PG3_48288_PDF_1p7K_Q30.gr",
    structure: "FeCoSn_PDF/Fe1Co9Sn_300K.cif",
  },
  /** The same neutron G(r), as kept under the PDF folder. */
  hexPdfCopy: "PDF/Fe1Co9Sn_PG3/PG3_48288_PDF_1p7K_Q30.gr",
  /** PDFgui's G_calc for that G(r) (the owner's fit), as a golden. */
  hexPdfGolden: "PDF/Fe1Co9Sn_PG3/golden/pdfgui_calc_1p7K_Q30.txt",
  /** StoG's input and output for the hexagonal dataset's S(Q). */
  hexStog: "StoG/199K",
  /** GSAS-II reflection lists of three hexagonal phases of the same system. */
  hexPhases: {
    dir: "TwoPhases",
    tags: ["CoSn_1", "CoSn_2", "CoSn"],
  },
} as const;
