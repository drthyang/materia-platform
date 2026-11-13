/**
 * The gate to the LOCAL-ONLY magnetic demo (`@/examples/localMagneticDemo`).
 *
 * The demo's files exist only on a dev server with the git-ignored data
 * folder. A production build must neither ask for them (a deployed site
 * answered the probe with a 404 on every page load) nor carry the demo's
 * module. `import.meta.env.DEV` is a build-time constant, so in a production
 * build the import below is dead code and the module is left out of the
 * bundle.
 */

type LocalDemoModule = typeof import("@/examples/localMagneticDemo");

/** The local demo's module, loaded on demand; null in a production build. */
export const loadLocalDemoModule: (() => Promise<LocalDemoModule>) | null = import.meta.env.DEV
  ? () => import("@/examples/localMagneticDemo")
  : null;

/** Whether the local demo can be offered: never in a production build (no request is made), else when its files are reachable. */
export async function localDemoAvailable(): Promise<boolean> {
  if (!loadLocalDemoModule) return false;
  try {
    return await (await loadLocalDemoModule()).localMagneticDemoAvailable();
  } catch {
    return false;
  }
}
