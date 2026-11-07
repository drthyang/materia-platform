/**
 * LOCAL-ONLY magnetic demo — the local magnetic TOF dataset
 * (`LOCAL_DATA.magneticTof`) on POWGEN time-of-flight neutron data below its
 * magnetic ordering: k ≠ 0 satellites that the paramagnetic pattern does not
 * have.
 *
 * The data are UNPUBLISHED and never enter the repository or the public build.
 * Everything this demo needs is read at runtime from the git-ignored `data/`
 * folder, which the dev server exposes under `/data/…` (vite.config.ts,
 * `serveLocalData`, dev only): first `local-paths.json`, which says where the
 * dataset's folder is, then from that folder
 *
 *   structure_100K.cif        the refined paramagnetic nuclear structure
 *   PG3_powder_6K.gsa         the ordered bank-3 histogram: the measurement of
 *                             the owner's reference refinement (and of the
 *                             benchmark's Mantid export)
 *   instrument_bank3.instprm  its bank's calibration
 *   the solution file         the solved structure
 *
 * (The whole folder's layout is in docs/VALIDATION.md.)
 *
 * The solution file is written by `localMagneticDemoSolve.test.ts` (run with
 * LOCAL_MAGNETIC_SOLVE=1): staged nuclear refinement → residual k-search → every
 * candidate magnetic group ranked → the magnetic refinement, with only the
 * magnetic parameters free and the nuclear model held at its refined values,
 * all with the app's own pipeline. The demo opens on that last step's state.
 * Its landing card appears only when these files can be fetched; a deployed
 * site has none of them and shows no local demo.
 */

import { resolveLocalData, type LocalDataPaths } from "@/testSupport/localData";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { parseSymmetryOperation } from "@/core/crystal/symmetry";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { MagneticModel } from "@/core/magnetic/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import type { Vec3 } from "@/core/math/types";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { applyMagneticMoments } from "@/core/workflow/magnetic";

/** The demo's files, as paths in the (git-ignored) data folder, from `local-paths.json`'s names. */
export interface LocalMagneticDemoFiles {
  readonly structure: string;
  readonly data: string;
  readonly instrument: string;
  readonly solution: string;
}

/** Where the demo's files live under the data folder, given its `local-paths.json`. */
export function localMagneticDemoFiles(paths: LocalDataPaths): LocalMagneticDemoFiles {
  return {
    structure: `${paths.magneticTof}/structure_100K.cif`,
    data: `${paths.magneticTof}/PG3_powder_6K.gsa`,
    instrument: `${paths.magneticTof}/instrument_bank3.instprm`,
    solution: paths.magneticTofSolution,
  };
}

/** The demo's History label, and its structure and pattern names: generic, as the data are unpublished. */
export const LOCAL_MAGNETIC_DEMO_LABEL = "Local magnetic demo";
const STRUCTURE_ID = "local-magnetic";
const PATTERN_ID = `${STRUCTURE_ID}-powder`;
const PATTERN_NAME = "Local magnetic demo · POWGEN bank 3 (TOF) · local data";

/** The solved magnetic structure, as `localMagneticDemoSolve.test.ts` writes it. */
export interface LocalMagneticSolution {
  readonly k: Vec3;
  /** Chosen magnetic group (maximal subgroup among the tied best fits). */
  readonly group: string;
  /** Its operations (Jones–Faithful xyz + time reversal), in the parent setting. */
  readonly ops: readonly { readonly xyz: string; readonly timeReversal: 1 | -1 }[];
  /** The magnetic ion sites (the co-located magnetic cations; a non-magnetic one carries none). */
  readonly ions: readonly string[];
  /** Chebyshev background terms the solve refined with (the session must match). */
  readonly backgroundTerms: number;
  /** Converged values by parameter id — the nuclear rows (held at the nuclear stage's values) and the moment modes. */
  readonly params: Readonly<Record<string, number>>;
  /** The rows the last step refined: the magnetic parameters alone (the moments, and k's free components). */
  readonly free: readonly string[];
  readonly nuclearWr: number;
  /** wR of the magnetic refinement: moments only, the nuclear model held. */
  readonly magneticWr: number;
}

export interface LocalMagneticExample {
  readonly structure: StructureModel;
  readonly pattern: PowderPattern;
  readonly instrument: InstrumentParameters;
  /** The original files, verbatim, for the cross-check bundles. */
  readonly rawData: { name: string; text: string };
  readonly rawInstrument: { name: string; text: string };
  readonly k: Vec3;
  readonly magneticSites: readonly string[];
  /** The applied magnetic model: the chosen group's operations, moments at the refined amplitudes. */
  readonly magnetic: MagneticModel;
  readonly momentParams: RefinementParameter[];
  readonly momentBindings: ParameterBinding[];
  /** Converged nuclear parameter values by id, for `loadedSession`. */
  readonly refinedParams: Readonly<Record<string, number>>;
  readonly backgroundTerms: number;
  readonly group: string;
  readonly nuclearWr: number;
  /** wR of the magnetic refinement the demo opens on (moments only, the nuclear model held). */
  readonly magneticWr: number;
}

/** Assemble the demo from the four files' text — pure, so tests can feed it from disk. */
export function buildLocalMagneticExample(files: { structure: string; data: string; instrument: string; solution: string }): LocalMagneticExample {
  const solution = JSON.parse(files.solution) as LocalMagneticSolution;
  if (!Array.isArray(solution.free) || typeof solution.magneticWr !== "number") {
    throw new Error("The local demo's solution file predates the moments-only solve: regenerate it (LOCAL_MAGNETIC_SOLVE=1 npx vitest run src/examples/localMagneticDemoSolve.test.ts)");
  }
  const free = new Set(solution.free);
  const structure: StructureModel = parseCif(files.structure, STRUCTURE_ID);
  const instrument = parseInstrumentParameters(files.instrument);
  const pattern = parseGsasHistogramPattern(files.data, PATTERN_ID, PATTERN_NAME, { radiation: { kind: "neutron-tof" } });
  const ops: SymmetryOperation[] = solution.ops.map((o) => ({ ...parseSymmetryOperation(o.xyz), timeReversal: o.timeReversal }));
  const build = buildMagneticModel(structure, solution.k, solution.ions, ops, { moment: 2, tieSameSite: true });
  const momentParams = build.params.map((p) => {
    const v = solution.params[p.id] ?? p.value;
    return { ...p, value: v, initialValue: v, fixed: !free.has(p.id) };
  });
  const magnetic = applyMagneticMoments(build.magnetic, build.bindings, Object.fromEntries(momentParams.map((p) => [p.id, p.value])));
  return {
    structure,
    pattern,
    instrument,
    rawData: { name: "PG3_powder_6K.gsa", text: files.data },
    rawInstrument: { name: "instrument_bank3.instprm", text: files.instrument },
    k: solution.k,
    magneticSites: solution.ions,
    magnetic,
    momentParams,
    momentBindings: build.bindings,
    refinedParams: solution.params,
    backgroundTerms: solution.backgroundTerms,
    group: solution.group,
    nuclearWr: solution.nuclearWr,
    magneticWr: solution.magneticWr,
  };
}

/**
 * The demo session's parameter rows: the nuclear rows (as `loadedSession`
 * seeds them, at the solved values) all held, then the moment rows, free as
 * the solve's last step refined them. The demo opens on that step — the
 * magnetic refinement, the moments measured against the nuclear model as a
 * fixed reference — so Refine from it refines the moments alone.
 */
export function localMagneticDemoParams(nuclear: readonly RefinementParameter[], ex: Pick<LocalMagneticExample, "momentParams">): RefinementParameter[] {
  return [...nuclear.map((p) => ({ ...p, fixed: true })), ...ex.momentParams];
}

/** URL of one file on the dev server's `/data/` route. */
function dataUrl(rel: string): string {
  return `${import.meta.env.BASE_URL}data/${rel}`;
}

/** A data file's text, or null when the server has none (GitHub Pages answers unknown paths with an HTML 404 page). */
async function fetchData(rel: string, json = false): Promise<string | null> {
  try {
    const res = await fetch(dataUrl(rel), { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    return json && !text.trimStart().startsWith("{") ? null : text;
  } catch {
    return null;
  }
}

/** The demo's files, from the data folder's `local-paths.json`; null without one. */
async function demoFiles(): Promise<LocalMagneticDemoFiles | null> {
  const text = await fetchData("local-paths.json", true);
  if (text === null) return null;
  try {
    return localMagneticDemoFiles(resolveLocalData(JSON.parse(text)));
  } catch {
    return null;
  }
}

/**
 * Whether the local files are reachable — true only on a dev server with the
 * data folder (and its `local-paths.json`) present. Decides whether the demo
 * is offered at all.
 */
export async function localMagneticDemoAvailable(): Promise<boolean> {
  const files = await demoFiles();
  if (!files) return false;
  const [solution, structure] = await Promise.all([fetchData(files.solution, true), fetchData(files.structure)]);
  return solution !== null && structure !== null;
}

let cached: Promise<LocalMagneticExample> | null = null;

/** Fetch the local files and assemble the demo (memoized). */
export function loadLocalMagneticExample(): Promise<LocalMagneticExample> {
  if (!cached) {
    cached = (async () => {
      const files = await demoFiles();
      if (!files) throw new Error("data/local-paths.json: not found");
      const get = async (rel: string): Promise<string> => {
        const text = await fetchData(rel);
        if (text === null) throw new Error(`${rel}: not found`);
        return text;
      };
      const [structure, data, instrument, solution] = await Promise.all([get(files.structure), get(files.data), get(files.instrument), get(files.solution)]);
      return buildLocalMagneticExample({ structure, data, instrument, solution });
    })().catch((e: unknown) => {
      cached = null; // let a later attempt retry
      throw e;
    });
  }
  return cached;
}
