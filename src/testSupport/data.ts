/**
 * Helpers for tests that validate against the local GSAS-II datasets in `data/`.
 *
 * The `data/` folder is git-ignored (large, local-only), so these tests must
 * skip gracefully when it is absent — e.g. on a fresh CI checkout — rather than
 * fail. Use `dataExists(rel)` with `describe.skipIf` and read only when present.
 * A dataset that is published is also committed under `examples/` (COMMITTED),
 * so its tests run everywhere.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isUnsetLocalPath, resolveLocalData, type LocalDataPaths } from "@/testSupport/localData";
import type { LocalReferences } from "@/testSupport/localReferences";

/** The data folder: `data/` in the checkout, or MATERIA_DATA_DIR (a worktree reads its main checkout's). */
export const DATA_DIR = process.env.MATERIA_DATA_DIR ? resolve(process.env.MATERIA_DATA_DIR) : resolve(process.cwd(), "data");

/**
 * A git-ignored JSON file of the local data: the one `envVar` names, else
 * `name` in the data folder, else `name` in the checkout's own `data/` (so a
 * worktree pointed at another checkout's data can keep its own copy). Null
 * when there is none.
 */
function localJson(envVar: string, name: string): unknown {
  const candidates = [process.env[envVar], resolve(DATA_DIR, name), resolve(process.cwd(), "data", name)];
  for (const file of candidates) {
    if (!file || !existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as unknown;
    } catch (e) {
      throw new Error(`${file}: not valid JSON (${(e as Error).message})`, { cause: e });
    }
  }
  return null;
}

/**
 * Where the owner's unpublished datasets sit in the data folder: read from
 * `local-paths.json` (or the file MATERIA_LOCAL_PATHS names). Without it every
 * name is a placeholder that no file has, and the tests that need one skip.
 */
export const LOCAL_DATA: LocalDataPaths = resolveLocalData(localJson("MATERIA_LOCAL_PATHS", "local-paths.json"));

/**
 * The reference values the data-gated tests compare with — numbers from the
 * owner's own refinements of the unpublished datasets, kept out of the
 * repository in `local-references.json` (or the file MATERIA_LOCAL_REFERENCES
 * names). Null without it: the tests that need a value skip.
 */
export const LOCAL_REFERENCES: LocalReferences | null = localJson("MATERIA_LOCAL_REFERENCES", "local-references.json") as LocalReferences | null;

/**
 * Datasets whose local folder name varies between checkouts. Tests, README and
 * docs use the canonical name (the key); a local copy may sit under any listed
 * alias. Resolving the name here is what keeps a differently-named local
 * folder from silently skipping every test that needs it: a skip looks
 * identical to a pass in `npm test`.
 */
const DIR_ALIASES: Record<string, readonly string[]> = isUnsetLocalPath(LOCAL_DATA.xrd.dir) ? {} : {
  [LOCAL_DATA.xrd.dir]: [LOCAL_DATA.xrd.dir, ...LOCAL_DATA.xrd.aliases],
};

/**
 * Published datasets committed to the repository (path from the checkout's
 * root), read when the local folder is absent: the Mn₃Ga 350 K POWGEN data and
 * refined structure, kept locally as `Mn3Ga_POWGEN_350K/` or `350K/`.
 */
const COMMITTED: Record<string, string> = {
  Mn3Ga_POWGEN_350K: "examples/mn3ga-350k",
  "350K": "examples/mn3ga-350k",
};

/**
 * Absolute path of a dataset directory, trying each known alias in order, then
 * the committed copy. Falls back to the canonical name when none is present, so
 * callers still get a sensible path to report in an error message.
 */
export function dataDir(name: string): string {
  for (const alias of DIR_ALIASES[name] ?? [name]) {
    const dir = resolve(DATA_DIR, alias);
    if (existsSync(dir)) return dir;
  }
  const committed = COMMITTED[name];
  if (committed !== undefined && existsSync(resolve(process.cwd(), committed))) return resolve(process.cwd(), committed);
  return resolve(DATA_DIR, name);
}

/** Absolute path of `rel` ("<dataset>/<file>"), with the dataset alias-resolved. */
export function dataPath(rel: string): string {
  const [head, ...rest] = rel.split("/");
  const dir = dataDir(head ?? "");
  return rest.length > 0 ? resolve(dir, ...rest) : dir;
}

export function dataExists(rel: string): boolean {
  return !isUnsetLocalPath(rel) && existsSync(dataPath(rel));
}

export function readData(rel: string): string {
  return readFileSync(dataPath(rel), "utf8");
}
