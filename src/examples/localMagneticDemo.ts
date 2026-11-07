/**
 * LOCAL-ONLY magnetic demo — the local magnetic TOF dataset
 * (`LOCAL_DATA.magneticTof`) on POWGEN time-of-flight neutron data below its
 * magnetic ordering: k ≠ 0 satellites that the paramagnetic pattern does not
 * have.
 *
 * The data are UNPUBLISHED and never enter the repository or the public build.
 * Everything this demo needs is read at runtime from the git-ignored `data/`
 * folder, which the dev server exposes under `/data/…` (vite.config.ts,
 * `serveLocalData`, dev only):
 *
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
 *
 * The nuclear structure itself (the refined paramagnetic CIF) is the one
 * already bundled in `highEntropyWO4.ts`.
 */

import { HIGH_ENTROPY_CIF } from "@/examples/highEntropyWO4";
import { LOCAL_DATA } from "@/testSupport/localData";
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

/** Where the demo's files live under the (git-ignored) data folder. */
export const LOCAL_MAGNETIC_DEMO_FILES = {
  data: `${LOCAL_DATA.magneticTof}/PG3_powder_6K.gsa`,
  instrument: `${LOCAL_DATA.magneticTof}/instrument_bank3.instprm`,
  solution: LOCAL_DATA.magneticTofSolution,
} as const;

const STRUCTURE_ID = "awo4";
const PATTERN_ID = `${STRUCTURE_ID}-powder`;
const PATTERN_NAME = "AWO₄ POWGEN 6 K bank 3 (TOF) · local data";

/** The solved magnetic structure, as `localMagneticDemoSolve.test.ts` writes it. */
export interface LocalMagneticSolution {
  readonly k: Vec3;
  /** Chosen magnetic group (maximal subgroup among the tied best fits). */
  readonly group: string;
  /** Its operations (Jones–Faithful xyz + time reversal), in the parent setting. */
  readonly ops: readonly { readonly xyz: string; readonly timeReversal: 1 | -1 }[];
  /** The magnetic ion sites (co-located 3d cations; Zn²⁺ carries none). */
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

/** Assemble the demo from the three files' text — pure, so tests can feed it from disk. */
export function buildLocalMagneticExample(files: { data: string; instrument: string; solution: string }): LocalMagneticExample {
  const solution = JSON.parse(files.solution) as LocalMagneticSolution;
  if (!Array.isArray(solution.free) || typeof solution.magneticWr !== "number") {
    throw new Error(`${LOCAL_MAGNETIC_DEMO_FILES.solution} predates the moments-only solve: regenerate it (LOCAL_MAGNETIC_SOLVE=1 npx vitest run src/examples/localMagneticDemoSolve.test.ts)`);
  }
  const free = new Set(solution.free);
  const structure: StructureModel = { ...parseCif(HIGH_ENTROPY_CIF, STRUCTURE_ID), name: "(Co,Cu,Fe,Mn,Ni,Zn)WO₄" };
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
    rawData: { name: LOCAL_MAGNETIC_DEMO_FILES.data.split("/").pop()!, text: files.data },
    rawInstrument: { name: LOCAL_MAGNETIC_DEMO_FILES.instrument.split("/").pop()!, text: files.instrument },
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

/** URL of one demo file on the dev server's `/data/` route. */
function dataUrl(rel: string): string {
  return `${import.meta.env.BASE_URL}data/${rel}`;
}

/**
 * Whether the local files are reachable — true only on a dev server with the
 * data folder present. Decides whether the demo is offered at all.
 */
export async function localMagneticDemoAvailable(): Promise<boolean> {
  try {
    const res = await fetch(dataUrl(LOCAL_MAGNETIC_DEMO_FILES.solution), { method: "GET", cache: "no-store" });
    if (!res.ok) return false;
    // GitHub Pages answers unknown paths with an HTML 404 page; a real answer is JSON.
    const text = await res.text();
    return text.trimStart().startsWith("{");
  } catch {
    return false;
  }
}

let cached: Promise<LocalMagneticExample> | null = null;

/** Fetch the local files and assemble the demo (memoized). */
export function loadLocalMagneticExample(): Promise<LocalMagneticExample> {
  if (!cached) {
    cached = (async () => {
      const get = async (rel: string): Promise<string> => {
        const res = await fetch(dataUrl(rel), { cache: "no-store" });
        if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
        return res.text();
      };
      const [data, instrument, solution] = await Promise.all([
        get(LOCAL_MAGNETIC_DEMO_FILES.data),
        get(LOCAL_MAGNETIC_DEMO_FILES.instrument),
        get(LOCAL_MAGNETIC_DEMO_FILES.solution),
      ]);
      return buildLocalMagneticExample({ data, instrument, solution });
    })().catch((e: unknown) => {
      cached = null; // let a later attempt retry
      throw e;
    });
  }
  return cached;
}
