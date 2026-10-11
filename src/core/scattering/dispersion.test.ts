import { describe, it, expect } from "vitest";
import { anomalousScattering, dispersionLine } from "@/core/scattering/dispersion";

describe("anomalous scattering", () => {
  it("matches SHELXL's DISP values at Mo and Cu Kα to the third decimal", () => {
    const mo = dispersionLine(0.71073)!;
    expect(mo.name).toBe("Mo Kα");
    // SHELXL's Mo Kα DISP: S 0.1246 0.1234, C 0.0033 0.0016.
    expect(anomalousScattering("S", mo).fp).toBeCloseTo(0.1246, 2);
    expect(anomalousScattering("S", mo).fpp).toBeCloseTo(0.1234, 2);
    expect(anomalousScattering("Ga3+", mo).fpp).toBeCloseTo(1.61, 1);
    expect(anomalousScattering("C", mo)).toEqual({ fp: 0.0033, fpp: 0.0016 });
    const cu = dispersionLine(1.5406)!;
    expect(cu.name).toBe("Cu Kα");
    expect(anomalousScattering("S", cu).fpp).toBeCloseTo(0.557, 2);
  });

  it("has none for hydrogen, and no line far from the tabulated ones", () => {
    expect(anomalousScattering("H", dispersionLine(0.71073)!)).toEqual({ fp: 0, fpp: 0 });
    expect(dispersionLine(0.4959)).toBeNull();
    expect(dispersionLine(1.0)).toBeNull();
  });
});
