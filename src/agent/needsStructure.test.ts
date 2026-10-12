import { describe, expect, it } from "vitest";
import { requireStructure } from "@/agent/powderTools";
import type { PowderLiveState } from "@/agent/port";

describe("tools that need a structure", () => {
  it("refuse check_fit_range on the empty placeholder: with no reflections there are no gaps to cut in", () => {
    const placeholder = { structure: { sites: [] } } as unknown as PowderLiveState;
    expect(() => requireStructure("check_fit_range", placeholder)).toThrow(/no structure is loaded/);
    expect(() => requireStructure("get_state", placeholder)).not.toThrow();
  });
});

describe("the cell the peaks give, against the structure's", () => {
  it("reads one factor on every length as the wavelength, uneven shifts as the phase, and less than 0.5 % as nothing", async () => {
    const { cellShiftReading } = await import("@/agent/powderTools");
    const cell = { a: 5.42, b: 5.42, c: 4.376, alpha: 90, beta: 90, gamma: 120 };
    const scaled = (f: number, g = f) => ({ ...cell, a: cell.a * f, b: cell.b * f, c: cell.c * g });
    expect(cellShiftReading(cell, scaled(1.002), "twoTheta")).toBeNull();
    expect(cellShiftReading(cell, scaled(1.0104), "twoTheta")).toMatch(/\+1\.04 % off the structure's in every length alike.*a wrong wavelength.*confirm the wavelength before refining/);
    expect(cellShiftReading(cell, scaled(0.99), "tof")).toMatch(/a wrong calibration.*the TOF calibration \(difC\)/);
    expect(cellShiftReading(cell, scaled(1.002, 1.012), "twoTheta")).toMatch(/unevenly: the phase at another temperature or composition/);
  });
});
