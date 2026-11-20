/**
 * Whether this browser can draw the 3D views, asked once.
 *
 * The 3D model (StructureView) is the only part of the app that needs WebGL;
 * refinement, the plots and every export run without it. A browser with
 * graphics acceleration off, a blocked GPU or a remote desktop returns null
 * from `canvas.getContext`, and three.js then throws from its renderer's
 * constructor. Nothing here throws: the view asks `webglAvailable()` first and
 * builds its renderer through `createRenderer`, which returns null on failure,
 * so a missing context is a line in the 3D card and never an error on the page.
 *
 * three.js draws with WebGL 2 only, so that is the context probed.
 */

/** The fallback line of a 3D card: the result first, the detail behind "?". */
export const WEBGL_UNAVAILABLE_LINE = "3D view unavailable: WebGL is not available in this browser.";
export const WEBGL_UNAVAILABLE_HELP =
  "The 3D model is drawn with WebGL 2, which this browser did not provide. Refinement, the plots and the exports do not need it and work as usual. To check: open chrome://gpu (Firefox: about:support) and look for WebGL; turn on graphics (hardware) acceleration in the browser's settings, update the graphics driver, or try another browser.";
export const WEBGL_LOST_LINE = "3D view paused: the browser dropped its WebGL context.";
export const WEBGL_LOST_HELP =
  "The browser took the graphics context back (a driver reset, the GPU process restarting, or too many 3D pages open). The view redraws when the browser gives it back; if it stays paused, reload the page. Nothing in the model or the fit is affected.";
export const VIEW_FAILED_LINE = "3D view unavailable: the model could not be drawn.";

let cached: boolean | null = null;

/** Can a WebGL 2 context be created? Probed once per page, never throws. */
export function webglAvailable(): boolean {
  if (cached !== null) return cached;
  cached = probe();
  return cached;
}

function probe(): boolean {
  try {
    if (typeof document === "undefined") return false;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) return false;
    // Hand the probe's context straight back: a page may hold only a few.
    try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* best effort */ }
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a renderer (`make` calls three.js) or return null: when WebGL is known
 * to be missing `make` is not called at all, and a constructor that throws all
 * the same (context limit reached, GPU process gone) is caught.
 */
export function createRenderer<T>(make: () => T): T | null {
  if (!webglAvailable()) return null;
  try {
    return make();
  } catch (error) {
    console.warn("[3D view] WebGL renderer could not be created:", error);
    return null;
  }
}

/** Tests only: forget the probe's answer, or force one. */
export function resetWebglProbeForTests(value: boolean | null = null): void {
  cached = value;
}
