import { describe, it, expect } from "vitest";
import { posteriorReading } from "@/core/diagnostics/posteriorReading";
import type { SampleResult } from "@/core/refinement/bayes/sampler";
import type { RefinementParameter } from "@/core/refinement/types";

/** A converged run of one parameter whose interval matches its esd. */
const run: SampleResult = {
  chains: [], logProb: [], freeIds: ["B_W1"], acceptanceFraction: 0.35,
  diagnostics: { rHat: [1.01], ess: [800], maxRHat: 1.01, minEss: 800, nSamples: 4800 },
  posterior: {
    parameters: [{ id: "B_W1", mean: 0.44, median: 0.44, std: 0.08, q025: 0.28, q16: 0.36, q84: 0.52, q975: 0.6, rHat: 1.01, ess: 800, esdRatio: 1.02 }],
    correlation: [[1]],
  },
  resume: { q: [], logP: [], rngDraws: 0, stepIndex: 400, freeIds: ["B_W1"], seed: 1 },
  status: "ok",
};
const params: RefinementParameter[] = [{ id: "B_W1", label: "B_W1", kind: "bIso", value: 0.44, initialValue: 0.44, fixed: false, min: 0, max: 10 }];
const resume = { again: "call it again", brief: "again" };

describe("the posterior's caveat on a systematic misfit", () => {
  it("names the tool that reads the serial correlation only where the surface has one", () => {
    const app = posteriorReading(run, params, { B_W1: 0.08 }, [], resume, { diagnose: "diagnose_fit" }).reading;
    expect(app).toMatch(/a systematic misfit \(on powder, diagnose_fit's Durbin–Watson d below Q_D\) leaves them as overconfident as the esds/);
    // MCP has no diagnose_fit: the caveat names the statistic, not a tool the client cannot call.
    const mcp = posteriorReading(run, params, { B_W1: 0.08 }, [], resume).reading;
    expect(mcp).not.toMatch(/diagnose_fit/);
    expect(mcp).toMatch(/a systematic misfit \(a Durbin–Watson d of the residual below Q_D\) leaves them as overconfident as the esds/);
  });
});
