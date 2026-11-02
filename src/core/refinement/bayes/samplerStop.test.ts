import { describe, it, expect } from "vitest";
import type { RefinementParameter } from "@/core/refinement/types";
import type { BatchEvaluator, RefinementProblem } from "@/core/refinement/engine";
import {
  MIN_KEPT_STEPS,
  samplePosterior,
  samplePosteriorParallel,
  tooFewToRead,
  type SampleOptions,
} from "@/core/refinement/bayes/sampler";

/**
 * Stopping a posterior run (SampleOptions.signal): the run ends on its last
 * WHOLE step — the batch in flight abandoned at once — so its chains and
 * resume token are exactly a shorter run's; it is marked `stopped` and never
 * "ok"; its default burn-in is half the steps it took; and too few kept steps
 * for R̂/ESS is flagged (tooFewToRead) so the page shows no estimates.
 */

const param = (id: string, value: number): RefinementParameter => ({
  id, label: id, kind: "pdfScale", value, initialValue: value, fixed: false, linear: false,
});

/** y = A·θ, unit weights: a two-parameter Gaussian posterior (as sampler.test.ts). */
function gaussian(): RefinementProblem {
  const n = 40;
  const A = Array.from({ length: n }, (_, i) => [1 + 0.5 * (i / (n - 1)), 0.7 + 0.6 * (i / (n - 1))] as const);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = A[i]![0] * 1.4 + A[i]![1] * -0.6;
  return {
    parameters: [param("t0", 1.4), param("t1", -0.6)],
    observations: y,
    weights: new Float64Array(n).fill(1),
    calculate: (v) => {
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = A[i]![0] * v["t0"]! + A[i]![1] * v["t1"]!;
      return out;
    },
  };
}

const OPTS: SampleOptions = { nSteps: 200, nWalkers: 16, seed: 77, noiseModel: "fixed" };

/** An order-preserving evaluator that waits `ms` per batch and counts its calls. */
function slow(problem: RefinementProblem, ms: number): BatchEvaluator & { calls: number } {
  const ev = {
    calls: 0,
    evaluate: async (sets: readonly Record<string, number>[]) => {
      ev.calls++;
      await new Promise((r) => setTimeout(r, ms));
      return sets.map((s) => problem.calculate(s));
    },
  };
  return ev;
}

describe("posterior sampler — Stop", () => {
  const problem = gaussian();

  it("stops on the step it was asked at, evaluates nothing after, and ends exactly where a shorter run ends", async () => {
    const stop = new AbortController();
    const ev = slow(problem, 1);
    let callsAtStop = -1;
    const res = await samplePosteriorParallel(problem, {
      ...OPTS,
      signal: stop.signal,
      onStep: (s) => {
        if (s === 30) {
          stop.abort();
          callsAtStop = ev.calls;
        }
      },
    }, ev);
    expect(res.stopped).toEqual({ atStep: 30, plannedStep: 200, plannedSamples: 16 * 100 });
    expect(ev.calls).toBe(callsAtStop);
    expect(res.status).toBe("not-converged");
    // The chain is the 30-step run's: the same resume token, so Continue is a true continuation.
    const short = samplePosterior(problem, { ...OPTS, nSteps: 30 });
    expect(res.resume).toEqual(short.resume);
    // Burn-in is half the steps taken (15), so 15 steps per walker are kept.
    expect(res.chains[0]).toHaveLength(15);
    expect(res.diagnostics.nSamples).toBe(16 * 15);
    expect(res.chains).toEqual(short.chains);
    expect(res.message).toMatch(/^stopped early at step 30 of 200: 240 of 1600 samples/);
  });

  it("abandons the batch in flight at once (an evaluator that never answers)", async () => {
    const stop = new AbortController();
    let n = 0;
    const hang: BatchEvaluator = {
      evaluate: (sets) => {
        n++;
        // The 41st batch (step 20's second half) never resolves, as a pool mid-batch.
        if (n > 40) return new Promise<Float64Array[]>(() => undefined);
        return Promise.resolve(sets.map((s) => problem.calculate(s)));
      },
    };
    let stoppedAt = 0;
    setTimeout(() => {
      stoppedAt = performance.now();
      stop.abort();
    }, 50);
    const res = await samplePosteriorParallel(problem, { ...OPTS, signal: stop.signal }, hang);
    expect(performance.now() - stoppedAt).toBeLessThan(100);
    // Batch 1 is the initial ensemble, then two per step: batch 41 is step 20's second half — rolled back.
    expect(res.stopped?.atStep).toBe(19);
    expect(res.resume).toEqual(samplePosterior(problem, { ...OPTS, nSteps: 19 }).resume);
  });

  it("a pool disposed under the stop (its batch rejecting) surfaces no error", async () => {
    const stop = new AbortController();
    let n = 0;
    const disposed: BatchEvaluator = {
      evaluate: (sets) => {
        n++;
        if (n === 5) {
          stop.abort();
          return Promise.reject(new Error("evaluation failed: __refinement_cancelled__"));
        }
        return Promise.resolve(sets.map((s) => problem.calculate(s)));
      },
    };
    const res = await samplePosteriorParallel(problem, { ...OPTS, signal: stop.signal }, disposed);
    expect(res.stopped?.atStep).toBe(1);
  });

  it("a failure that is not a stop still throws", async () => {
    const stop = new AbortController();
    const broken: BatchEvaluator = { evaluate: () => Promise.reject(new Error("worker crashed")) };
    await expect(samplePosteriorParallel(problem, { ...OPTS, signal: stop.signal }, broken)).rejects.toThrow("worker crashed");
  });

  it("is never 'ok' even when its partial chains pass R̂ and ESS", async () => {
    const stop = new AbortController();
    const ev = slow(problem, 0);
    const res = await samplePosteriorParallel(problem, {
      ...OPTS,
      nSteps: 4000,
      nWalkers: 32,
      signal: stop.signal,
      onStep: (s) => {
        if (s === 2000) stop.abort();
      },
    }, ev);
    expect(res.diagnostics.maxRHat).toBeLessThan(1.05);
    expect(res.diagnostics.minEss).toBeGreaterThan(100);
    expect(res.stopped?.atStep).toBe(2000);
    expect(res.status).toBe("not-converged");
  }, 60_000);

  it("too few kept steps: flagged so no estimates are shown", async () => {
    const stop = new AbortController();
    const res = await samplePosteriorParallel(problem, {
      ...OPTS,
      signal: stop.signal,
      onStep: (s) => {
        if (s === 2 * MIN_KEPT_STEPS - 2) stop.abort();
      },
    }, slow(problem, 0));
    expect(res.chains[0]!.length).toBe(MIN_KEPT_STEPS - 1);
    expect(tooFewToRead(res)).toBe(true);
    // One more step is enough.
    const stop2 = new AbortController();
    const res2 = await samplePosteriorParallel(problem, {
      ...OPTS,
      signal: stop2.signal,
      onStep: (s) => {
        if (s === 2 * MIN_KEPT_STEPS) stop2.abort();
      },
    }, slow(problem, 0));
    expect(tooFewToRead(res2)).toBe(false);
  });

  it("stopped before the first step: no samples, and a token Continue refuses", async () => {
    const stop = new AbortController();
    stop.abort();
    const res = await samplePosteriorParallel(problem, { ...OPTS, signal: stop.signal }, slow(problem, 0));
    expect(res.stopped).toEqual({ atStep: 0, plannedStep: 200, plannedSamples: 16 * 100 });
    expect(res.diagnostics.nSamples).toBe(0);
    expect(tooFewToRead(res)).toBe(true);
    expect(res.resume.logP).toEqual([]);
    expect(() => samplePosterior(problem, { ...OPTS, init: res.resume })).toThrow(/stopped before its first step/);
  });

  it("Continue after a stop continues the same chain; a fresh run after it is untouched by it", async () => {
    const stop = new AbortController();
    const stopped = await samplePosteriorParallel(problem, {
      ...OPTS,
      signal: stop.signal,
      onStep: (s) => {
        if (s === 50) stop.abort();
      },
    }, slow(problem, 0));
    const continued = samplePosterior(problem, { ...OPTS, nSteps: 150, init: stopped.resume });
    expect(continued.resume).toEqual(samplePosterior(problem, OPTS).resume);
    expect(continued.stopped).toBeUndefined();
    // A fresh run with a fresh signal: bit-identical to one that never saw a stop.
    const fresh = await samplePosteriorParallel(problem, { ...OPTS, signal: new AbortController().signal }, slow(problem, 0));
    const plain = samplePosterior(problem, OPTS);
    expect(fresh.chains).toEqual(plain.chains);
    expect(fresh.logProb).toEqual(plain.logProb);
    expect(fresh.resume).toEqual(plain.resume);
    expect(fresh.status).toBe(plain.status);
    expect(fresh.stopped).toBeUndefined();
  });
});
