import { describe, it, expect } from "vitest";
import { fCritical, fUpperTail, incompleteBeta } from "@/core/math/fDistribution";

describe("the F distribution", () => {
  it("gives the incomplete beta function and the tabulated 5 % points", () => {
    expect(incompleteBeta(0.5, 2, 3)).toBeCloseTo(0.6875, 10);
    expect(incompleteBeta(0.3, 1, 1)).toBeCloseTo(0.3, 12);
    // F tables (Abramowitz & Stegun 26.6): F(d1, d2) at 5 %.
    expect(fCritical(0.05, 1, 1e6)).toBeCloseTo(3.8415, 3);
    expect(fCritical(0.05, 2, 100)).toBeCloseTo(3.0873, 3);
    expect(fCritical(0.05, 3, 30)).toBeCloseTo(2.9223, 3);
    expect(fCritical(0.05, 5, 10)).toBeCloseTo(3.3258, 3);
    expect(fUpperTail(fCritical(0.01, 4, 50), 4, 50)).toBeCloseTo(0.01, 8);
  });
});
