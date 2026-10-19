import { describe, it, expect } from "vitest";
import { withinNoiseOfBest } from "@/core/diagnostics/hamilton";

describe("fits within the noise of the best (Hamilton's test)", () => {
  // The best fit's reduced χ² is 2: its noise per parameter is 2 in χ².
  const best = { id: "lower", chi2: 1000, dof: 500, parameters: 3 };
  it("lets a group with fewer parameters stand beside one that beats it by the noise only", () => {
    // Two parameters fewer, χ² up by 8: F = (8/2)/2 = 2 < F(2, 500) = 3.01.
    expect([...withinNoiseOfBest([best, { id: "maximal", chi2: 1008, dof: 502, parameters: 1 }])].sort()).toEqual(["lower", "maximal"]);
    // χ² up by 20: F = 5, beyond the noise.
    expect([...withinNoiseOfBest([best, { id: "maximal", chi2: 1020, dof: 502, parameters: 1 }])]).toEqual(["lower"]);
  });

  it("gives a group with as many parameters or more one parameter's worth", () => {
    // F(1, 500) = 3.86: up to 7.7 in χ² at a reduced χ² of 2.
    expect(withinNoiseOfBest([best, { id: "same", chi2: 1007, dof: 500, parameters: 3 }]).has("same")).toBe(true);
    expect(withinNoiseOfBest([best, { id: "more", chi2: 1009, dof: 498, parameters: 5 }]).has("more")).toBe(false);
  });
});
