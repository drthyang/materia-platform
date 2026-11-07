/**
 * The owner's unpublished local datasets: where each one sits in the
 * git-ignored `data/` folder. Tests, docs and comments refer to them only by
 * the keys below ("the local magnetic TOF dataset", …).
 *
 * No folder or file name of these datasets is in the repository. They are
 * read at run time from `local-paths.json` (git-ignored, in the data folder):
 * in Node by `testSupport/data.ts` (MATERIA_LOCAL_PATHS may name another
 * file), in the dev server's page by the local demo, which fetches it from
 * `/data/`. A name the file does not give stays a placeholder naming its key,
 * a path that never exists, so every test that needs it skips.
 *
 * Pure (no Node imports), so the dev-only local demo can use it too.
 */

/** The shape of `data/local-paths.json`. Paths are from the data folder unless a comment says otherwise. */
export interface LocalDataPaths {
  /** A magnetic POWGEN TOF dataset's folder: bank-3 patterns, calibrations, the refined structure, a reference mCIF and a PDF (layout in docs/VALIDATION.md). */
  readonly magneticTof: string;
  /** The local magnetic demo's solution, written by `localMagneticDemoSolve.test.ts`. */
  readonly magneticTofSolution: string;
  /** A synchrotron X-ray powder dataset (28-ID): its folder, and in it its structure, a pattern and a GSAS-II fit of it. */
  readonly xrd: {
    readonly dir: string;
    /** Other names the same local folder is kept under. */
    readonly aliases: readonly string[];
    readonly structure: string;
    readonly pattern: string;
    readonly gsasFit: string;
  };
  /** An X-ray PDF dataset (28-ID) of the same compound: its folder, and in it a low-temperature G(r) and a local model. */
  readonly xrayPdf: { readonly dir: string; readonly pattern: string; readonly localModel: string };
  /** A room-temperature G(r) of the same X-ray PDF dataset. */
  readonly xrayPdfRoomT: string;
  /** A hexagonal magnetic POWGEN dataset: a GSAS-II magnetic refinement (folder) and a raw histogram. */
  readonly hexMagnetic: { readonly refinement: string; readonly histogram: string };
  /** A neutron PDF of the hexagonal dataset: its G(r) and a starting structure. */
  readonly hexPdf: { readonly pattern: string; readonly structure: string };
  /** The same neutron G(r), as kept under the PDF folder. */
  readonly hexPdfCopy: string;
  /** PDFgui's G_calc for that G(r) (the owner's fit), as a golden. */
  readonly hexPdfGolden: string;
  /** StoG's input and output for the hexagonal dataset's S(Q) (a folder). */
  readonly hexStog: string;
  /** GSAS-II reflection lists of three hexagonal phases of the same system: the folder, and each phase's tag. */
  readonly hexPhases: { readonly dir: string; readonly tags: readonly string[] };
}

const UNSET = "(unset in local-paths.json: ";

/** The placeholder of a name `local-paths.json` does not give: it names its key, and no file has it. */
export function unsetLocalPath(key: string): string {
  return `${UNSET}${key})`;
}

/** Whether a path is (or contains) the placeholder of an unset name. */
export function isUnsetLocalPath(path: string): boolean {
  return path.includes(UNSET);
}

const record = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
const text = (raw: unknown, key: string): string => (typeof raw === "string" && raw !== "" ? raw : unsetLocalPath(key));
const texts = (raw: unknown): readonly string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x !== "") : []);

/** The paths a parsed `local-paths.json` gives (null or {} when there is none), each missing one a placeholder. */
export function resolveLocalData(raw: unknown): LocalDataPaths {
  const j = record(raw);
  const [xrd, xrayPdf, hexMagnetic, hexPdf, hexPhases] = [j.xrd, j.xrayPdf, j.hexMagnetic, j.hexPdf, j.hexPhases].map(record) as [
    Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>,
  ];
  return {
    magneticTof: text(j.magneticTof, "magneticTof"),
    magneticTofSolution: text(j.magneticTofSolution, "magneticTofSolution"),
    xrd: {
      dir: text(xrd.dir, "xrd.dir"),
      aliases: texts(xrd.aliases),
      structure: text(xrd.structure, "xrd.structure"),
      pattern: text(xrd.pattern, "xrd.pattern"),
      gsasFit: text(xrd.gsasFit, "xrd.gsasFit"),
    },
    xrayPdf: { dir: text(xrayPdf.dir, "xrayPdf.dir"), pattern: text(xrayPdf.pattern, "xrayPdf.pattern"), localModel: text(xrayPdf.localModel, "xrayPdf.localModel") },
    xrayPdfRoomT: text(j.xrayPdfRoomT, "xrayPdfRoomT"),
    hexMagnetic: { refinement: text(hexMagnetic.refinement, "hexMagnetic.refinement"), histogram: text(hexMagnetic.histogram, "hexMagnetic.histogram") },
    hexPdf: { pattern: text(hexPdf.pattern, "hexPdf.pattern"), structure: text(hexPdf.structure, "hexPdf.structure") },
    hexPdfCopy: text(j.hexPdfCopy, "hexPdfCopy"),
    hexPdfGolden: text(j.hexPdfGolden, "hexPdfGolden"),
    hexStog: text(j.hexStog, "hexStog"),
    hexPhases: { dir: text(hexPhases.dir, "hexPhases.dir"), tags: texts(hexPhases.tags) },
  };
}
