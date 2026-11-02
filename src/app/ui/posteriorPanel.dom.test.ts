// @vitest-environment happy-dom
/**
 * The Posterior tab's Stop in a DOM: while a run goes Stop takes the Sample
 * button's place (a double tap on Sample does not stop it); a stopped run
 * reads "Stopped early · N of M samples", never "Converged", with failing
 * R̂/ESS in warning ink; and with too few kept steps it shows only that note.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RefinementParameter } from "@/core/refinement/types";
import type { RefinementProblem } from "@/core/refinement/engine";
import { samplePosterior, samplePosteriorParallel, type SampleResult } from "@/core/refinement/bayes/sampler";
import { PosteriorPanel, type PosteriorPanelProps } from "@/app/ui/PosteriorPanel";
import { CANCEL_ARM_MS } from "@/app/ui/RunActions";
import { color } from "@/app/theme";
import { REFINING_BLOCKS_SAMPLING, runLock } from "@/app/ui/runLock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

const param = (id: string, value: number): RefinementParameter => ({ id, label: id, kind: "pdfScale", value, initialValue: value, fixed: false, linear: false });
const problem: RefinementProblem = {
  parameters: [param("t0", 1), param("t1", 2)],
  observations: Float64Array.from({ length: 20 }, (_, i) => 1 + 2 * (i / 19)),
  weights: new Float64Array(20).fill(1),
  calculate: (v) => Float64Array.from({ length: 20 }, (_, i) => v["t0"]! + v["t1"]! * (i / 19)),
};

/** A run stopped by its signal at `at` of 400 steps. */
async function stoppedAt(at: number): Promise<SampleResult> {
  const stop = new AbortController();
  if (at === 0) stop.abort();
  return samplePosteriorParallel(problem, {
    nSteps: 400, nWalkers: 12, seed: 5, noiseModel: "fixed", signal: stop.signal,
    onStep: (s) => {
      if (s === at) stop.abort();
    },
  }, { evaluate: (sets) => Promise.resolve(sets.map((s) => problem.calculate(s))) });
}

function render(props: Partial<PosteriorPanelProps>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const full: PosteriorPanelProps = { result: null, busy: false, progress: null, onRun: () => {}, onStop: () => {}, hasRefined: true, labels: new Map(), ...props };
  act(() => root!.render(createElement(PosteriorPanel, full)));
  return host;
}
const buttons = (el: HTMLElement): string[] => [...el.querySelectorAll("button")].map((b) => b.textContent ?? "");
const button = (el: HTMLElement, label: string): HTMLButtonElement => [...el.querySelectorAll("button")].find((b) => b.textContent === label)!;

describe("the Posterior tab's Stop", () => {
  it("replaces Sample posterior while a run goes, and a double tap on Sample does not stop it", () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    const el = render({ busy: true, progress: { step: 40, total: 400 }, onStop });
    expect(buttons(el)).toEqual(["Stop"]);
    expect(el.textContent).toContain("Sampling… step 40/400");
    act(() => button(el, "Stop").click());
    expect(onStop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CANCEL_ARM_MS + 1);
    act(() => button(el, "Stop").click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("idle: Sample posterior, no Stop", () => {
    const el = render({});
    expect(buttons(el)).toEqual(["Sample posterior"]);
  });

  it("a stopped run: one plain line, never Converged, failing diagnostics in warning ink, Continue offered", async () => {
    const res = await stoppedAt(60);
    expect(res.stopped).toBeDefined();
    const el = render({ result: res });
    const note = el.querySelector("[data-testid=posterior-stopped]")!;
    expect(note.textContent).toMatch(/^Stopped early · 360 of 2400 samples/);
    expect(el.textContent).not.toContain("Converged");
    expect(el.textContent).not.toContain("Not converged");
    // 30 kept steps × 12 walkers: the ESS falls short of its 100 target, shown failing.
    expect(res.diagnostics.minEss).toBeLessThan(100);
    const ess = [...el.querySelectorAll("span")].find((s) => s.textContent?.startsWith("ESSmin"))!;
    expect(ess.querySelector("b")!.getAttribute("style")).toContain(color.warnInk);
    expect(el.querySelector("table")).not.toBeNull();
    expect(button(el, "Continue ↻").disabled).toBe(false);
  });

  it("too few kept steps: the note only, no estimates", async () => {
    const res = await stoppedAt(5);
    const el = render({ result: res });
    expect(el.querySelector("[data-testid=posterior-stopped]")!.textContent).toMatch(/^Stopped early · 36 of 2400 samples · too few to estimate/);
    expect(el.querySelector("table")).toBeNull();
    expect(el.textContent).not.toContain("R̂max");
    expect(el.textContent).not.toContain("ESSmin");
  });

  it("stopped before the first step: nothing to continue", async () => {
    const res = await stoppedAt(0);
    expect(res.stopped?.atStep).toBe(0);
    const el = render({ result: res });
    expect(el.querySelector("[data-testid=posterior-stopped]")!.textContent).toMatch(/^Stopped early · 0 of 2400 samples · too few to estimate/);
    expect(button(el, "Continue ↻").disabled).toBe(true);
  });

  it("a finished run reads as before", () => {
    const res = samplePosterior(problem, { nSteps: 30, nWalkers: 12, seed: 5, noiseModel: "fixed" });
    const el = render({ result: res });
    expect(el.querySelector("[data-testid=posterior-stopped]")).toBeNull();
    expect(el.textContent).toContain("Not converged — continue the chain");
    expect(el.textContent).toContain(`${res.diagnostics.nSamples} samples`);
  });

  it("while a refinement runs, Sample posterior and Continue are disabled, the reason their title", async () => {
    const blocked = runLock({ refining: true, sampling: false }).sample;
    expect(blocked).toBe(REFINING_BLOCKS_SAMPLING);
    const onRun = vi.fn();
    const el = render({ result: await stoppedAt(60), blockedReason: blocked, onRun });
    for (const label of ["Sample posterior", "Continue ↻"]) {
      const b = button(el, label);
      expect(b.disabled).toBe(true);
      expect(b.title).toBe(REFINING_BLOCKS_SAMPLING);
    }
    act(() => button(el, "Sample posterior").click());
    expect(onRun).not.toHaveBeenCalled();
    // Free again once it ends.
    act(() => root!.render(createElement(PosteriorPanel, { result: null, busy: false, progress: null, onRun, onStop: () => {}, hasRefined: true, labels: new Map(), blockedReason: runLock({ refining: false, sampling: false }).sample })));
    expect(button(el, "Sample posterior").disabled).toBe(false);
  });
});
