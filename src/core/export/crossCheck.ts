/**
 * The packages a result is reproduced in before it is published, per
 * technique, and what the Export menu writes for that cross-check: one source
 * for the page banner (App.tsx) and the report (report.ts FOOTER,
 * reportResult.ts), so neither names another technique's programs. A PDF user
 * told to check against GSAS-II learns nothing: the reference
 * implementations differ per technique.
 *
 * - Rietveld powder: GSAS-II and FullProf (a bundle for each, bundle.ts).
 * - Real-space PDF: PDFgui / diffpy-CMI, both on the PDFfit2 engine (the
 *   PDFgui / diffpy-CMI bundle, pdffit2.ts); the magnetic PDF term in
 *   diffpy.mpdf, which no bundle carries.
 * - Single crystal: SHELXL, JANA2020 or FullProf (the CIF and the FullProf
 *   .int the page writes).
 */

export type CrossCheckTechnique = "powder" | "singleCrystal" | "pdf";

export interface CrossCheckTarget {
  /** The packages, as a list reads in a sentence ("GSAS-II or FullProf"). */
  readonly packages: string;
  /** The package for the magnetic part, when it is another one (the PDF's mPDF term). */
  readonly magnetic?: string;
  /** What the Export menu writes for the cross-check, as a clause. */
  readonly exportNote: string;
}

export const CROSS_CHECK: Readonly<Record<CrossCheckTechnique, CrossCheckTarget>> = {
  powder: {
    packages: "GSAS-II or FullProf",
    exportNote: "the Export menu writes a GSAS-II and a FullProf bundle",
  },
  pdf: {
    packages: "PDFgui / diffpy-CMI (PDFfit2)",
    magnetic: "diffpy.mpdf",
    exportNote: "the Export menu writes a PDFgui / diffpy-CMI bundle with the structure, the data and a PDFfit2 script",
  },
  singleCrystal: {
    packages: "SHELXL, JANA2020 or FullProf",
    exportNote: "the Export menu writes the CIF and the reflections as a FullProf .int",
  },
};

/** Where to reproduce a result, with the magnetic part's package when the model has one: "PDFgui / diffpy-CMI (PDFfit2), and its magnetic term in diffpy.mpdf". */
export function crossCheckPackages(technique: CrossCheckTechnique, magnetic = false): string {
  const t = CROSS_CHECK[technique];
  return magnetic && t.magnetic ? `${t.packages}, and its magnetic term in ${t.magnetic}` : t.packages;
}
