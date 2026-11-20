// @vitest-environment happy-dom
/**
 * The 3D model without WebGL, in a DOM that has none (happy-dom's canvas
 * returns no "webgl2" context, as a browser with graphics acceleration off
 * does). The probe answers false once and never throws; no renderer is built;
 * the card shows one line with its "?" in the canvas's place, the legend as
 * plain dots and the host's downloads; and an error thrown by the 3D layer
 * all the same stays in the card, below the workbench's own boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { srtio3 } from "@/testSupport/perovskiteTilts";
import { StructureView } from "@/app/ui/StructureView";
import { View3DBoundary } from "@/app/ui/View3DFallback";
import { WorkbenchErrorBoundary } from "@/app/ui/WorkbenchErrorBoundary";
import {
  createRenderer,
  resetWebglProbeForTests,
  VIEW_FAILED_LINE,
  webglAvailable,
  WEBGL_UNAVAILABLE_HELP,
  WEBGL_UNAVAILABLE_LINE,
} from "@/app/ui/webglSupport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A browser reports an event listener's exception to window.onerror and
// carries on; React's development build relies on that to route a component's
// error to its boundary. Vitest turns it off in happy-dom, so turn it back on.
const happy = (window as unknown as { happyDOM: { settings: { errorCapture: string; disableErrorCapturing: boolean } } }).happyDOM.settings;
happy.disableErrorCapturing = false;
happy.errorCapture = "tryAndCatch";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
beforeEach(() => resetWebglProbeForTests());
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  resetWebglProbeForTests();
  vi.restoreAllMocks();
});

function mount(el: ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

/** The page's boundary around a 3D card, as App.tsx wraps a workbench. */
const inWorkbench = (child: ReactElement): ReactElement =>
  createElement(WorkbenchErrorBoundary, { resetKeys: [], children: child });

describe("the WebGL probe", () => {
  it("answers false where no WebGL 2 context can be created, and asks once", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    expect(webglAvailable()).toBe(false);
    expect(webglAvailable()).toBe(false);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith("webgl2");
  });

  it("answers false, without throwing, when getContext itself throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => { throw new Error("blocked"); });
    expect(webglAvailable()).toBe(false);
  });

  it("answers true when a context is given, and hands the probe's context back", () => {
    const loseContext = vi.fn();
    const gl = { getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null) };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => gl) as never);
    expect(webglAvailable()).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});

describe("createRenderer", () => {
  it("does not call the constructor when WebGL is missing", () => {
    const make = vi.fn(() => "renderer");
    expect(createRenderer(make)).toBeNull();
    expect(make).not.toHaveBeenCalled();
  });

  it("returns null when the constructor throws although the probe passed", () => {
    resetWebglProbeForTests(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(createRenderer(() => { throw new Error("Error creating WebGL context."); })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns the renderer when it can be built", () => {
    resetWebglProbeForTests(true);
    expect(createRenderer(() => "renderer")).toBe("renderer");
  });
});

describe("StructureView without WebGL", () => {
  it("shows the line in its card, the legend as dots and the downloads; nothing throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = vi.fn();
    const h = mount(inWorkbench(createElement(StructureView, {
      structure: srtio3(),
      exports: [{ label: "CIF", title: "The structure on screen", run }],
    })));
    expect(h.querySelector('[role="alert"]')).toBeNull(); // the page's banner
    const line = h.querySelector('[data-testid="view3d-fallback"]')!;
    expect(line.textContent).toContain(WEBGL_UNAVAILABLE_LINE);
    expect(line.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe(WEBGL_UNAVAILABLE_HELP); // the "?"
    expect(WEBGL_UNAVAILABLE_HELP).toContain("chrome://gpu");
    expect(h.querySelector("canvas")).toBeNull();
    expect(h.querySelector(".wb-3d-canvas")).toBeNull();
    const legend = h.querySelector(".wb-3d-legend")!;
    expect(legend.textContent).toBe("SrTiO");
    expect(legend.querySelectorAll("img")).toHaveLength(0);
    const button = [...h.querySelectorAll("button")].find((b) => b.textContent === "CIF")!;
    act(() => button.click());
    expect(run).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled(); // three.js was never asked for a context
  });

  it("keeps a renderer that throws although the probe passed inside the card", () => {
    // The probe says yes, the DOM has no WebGL: three.js throws from its
    // constructor in the scene's effect, as on the reported page.
    resetWebglProbeForTests(true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = vi.fn();
    const h = mount(inWorkbench(createElement(StructureView, {
      structure: srtio3(),
      exports: [{ label: "CIF", title: "The structure on screen", run }],
    })));
    expect(h.querySelector('[role="alert"]')).toBeNull();
    expect(h.textContent).not.toContain("This structure and data cannot be calculated");
    expect(h.querySelector('[data-testid="view3d-fallback"]')!.textContent).toContain(VIEW_FAILED_LINE);
    const button = [...h.querySelectorAll("button")].find((b) => b.textContent === "CIF")!;
    act(() => button.click());
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("View3DBoundary", () => {
  const Broken = (): JSX.Element => { throw new Error("shader failed"); };

  it("turns an error of the 3D layer into the card's line and draws again on a new structure", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = {}, b = {};
    const h = mount(inWorkbench(createElement(View3DBoundary, { resetKeys: [a], children: createElement(Broken) })));
    expect(h.querySelector('[role="alert"]')).toBeNull();
    expect(h.querySelector('[data-testid="view3d-fallback"]')!.textContent).toContain(VIEW_FAILED_LINE);
    act(() => root!.render(inWorkbench(createElement(View3DBoundary, { resetKeys: [b], children: createElement("p", null, "drawn") }))));
    expect(h.querySelector('[data-testid="view3d-fallback"]')).toBeNull();
    expect(h.textContent).toBe("drawn");
  });
});
