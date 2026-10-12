import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import {
  axisContext,
  availableDisplayUnits,
  convertAxisValue,
  convertInterval,
} from "@/visualization/axisUnits";

function pattern(xUnit: PowderPattern["xUnit"], extra: Partial<PowderPattern> = {}): PowderPattern {
  return {
    id: "p", name: "p", xUnit,
    radiation: xUnit === "tof" ? { kind: "neutron-tof" } : { kind: "neutron", wavelength: 1.54 },
    points: [{ x: 1, yObs: 0 }],
    ...extra,
  } as PowderPattern;
}

describe("availableDisplayUnits", () => {
  it("offers TOF only for TOF data, never for constant-wavelength", () => {
    const tof: InstrumentParameters = { kind: "tof", difC: 22585.8 };
    const cw: InstrumentParameters = { kind: "constantWavelength", wavelength: 1.54 };
    expect(availableDisplayUnits(axisContext(pattern("tof"), tof))).toEqual(["tof", "dSpacing", "q"]);
    const cwUnits = availableDisplayUnits(axisContext(pattern("twoTheta"), cw));
    expect(cwUnits).toContain("twoTheta");
    expect(cwUnits).toContain("dSpacing");
    expect(cwUnits).toContain("q");
    expect(cwUnits).not.toContain("tof");
  });

  it("omits 2θ for TOF data (no fixed wavelength)", () => {
    const units = availableDisplayUnits(axisContext(pattern("tof"), { kind: "tof", difC: 22585.8 }));
    expect(units).not.toContain("twoTheta");
  });
});

describe("convertAxisValue", () => {
  const cwCtx = axisContext(pattern("twoTheta"), { kind: "constantWavelength", wavelength: 1.54 });
  const tofCtx = axisContext(pattern("tof"), { kind: "tof", difC: 22585.8 });

  it("d ↔ Q is 2π/d", () => {
    expect(convertAxisValue(2, "dSpacing", "q", cwCtx)).toBeCloseTo(Math.PI, 6);
    expect(convertAxisValue(Math.PI, "q", "dSpacing", cwCtx)).toBeCloseTo(2, 6);
  });

  it("2θ → d → 2θ round-trips (constant wavelength)", () => {
    const d = convertAxisValue(40, "twoTheta", "dSpacing", cwCtx);
    expect(d).toBeCloseTo(1.54 / (2 * Math.sin(20 * Math.PI / 180)), 6);
    expect(convertAxisValue(d, "dSpacing", "twoTheta", cwCtx)).toBeCloseTo(40, 6);
  });

  it("takes the refined zero shift out of 2θ (observed = Bragg + zero), as GSAS-II's Pos2dsp does", () => {
    const zeroed = axisContext(pattern("twoTheta"), { kind: "constantWavelength", wavelength: 1.54 }, 0.2);
    expect(convertAxisValue(40.2, "twoTheta", "dSpacing", zeroed)).toBeCloseTo(convertAxisValue(40, "twoTheta", "dSpacing", cwCtx), 9);
    expect(convertAxisValue(convertAxisValue(40, "twoTheta", "dSpacing", cwCtx), "dSpacing", "twoTheta", zeroed)).toBeCloseTo(40.2, 9);
    // Only for 2θ data: a TOF pattern ignores it.
    expect(axisContext(pattern("tof"), { kind: "tof", difC: 22585.8 }, 0.2).zero).toBeUndefined();
  });

  it("TOF → d uses difC (TOF = difC·d)", () => {
    expect(convertAxisValue(45171.6, "tof", "dSpacing", tofCtx)).toBeCloseTo(2, 4);
    expect(convertAxisValue(2, "dSpacing", "tof", tofCtx)).toBeCloseTo(45171.6, 1);
  });
});

describe("convertInterval", () => {
  it("re-sorts endpoints when the conversion reverses ordering (2θ→d)", () => {
    const ctx = axisContext(pattern("twoTheta"), { kind: "constantWavelength", wavelength: 1.54 });
    const iv = convertInterval({ min: 20, max: 60 }, "twoTheta", "dSpacing", ctx);
    // Larger 2θ ⇒ smaller d, so min/max swap but stay ordered min < max.
    expect(iv.min).toBeLessThan(iv.max);
    expect(iv.max).toBeCloseTo(convertAxisValue(20, "twoTheta", "dSpacing", ctx), 6);
    expect(iv.min).toBeCloseTo(convertAxisValue(60, "twoTheta", "dSpacing", ctx), 6);
  });
});

describe("TOF d with the refined calibration", () => {
  it("reads d from the refined difC and zero, not the instrument file's", async () => {
    const { axisContext, convertAxisValue, tofCalibrationOf } = await import("@/visualization/axisUnits");
    const pattern = { id: "p", name: "p", xUnit: "tof", radiation: { kind: "neutron-tof" }, points: [] } as never;
    const instrument = { kind: "tof", difC: 5000, difA: 0, difB: 0, zero: 0 } as never;
    const params = [
      { id: "tof_difC", kind: "tofCalibration", value: 5010 },
      { id: "tof_difA", kind: "tofCalibration", value: 0 },
      { id: "zero", kind: "zeroShift", value: 10 },
    ];
    const ctx = axisContext(pattern, instrument, 10, tofCalibrationOf(params));
    // TOF = zero + difC·d: 10 030 µs is d = 2 Å under the refined calibration, 2.006 under the file's.
    expect(convertAxisValue(10030, "tof", "dSpacing", ctx)).toBeCloseTo(2, 9);
    expect(convertAxisValue(10030, "tof", "dSpacing", axisContext(pattern, instrument))).toBeCloseTo(2.006, 9);
  });
});
