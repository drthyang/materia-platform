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
    const { cellShiftReading } = await import("@/core/diagnostics/cellReading");
    const cell = { a: 5.42, b: 5.42, c: 4.376, alpha: 90, beta: 90, gamma: 120 };
    const scaled = (f: number, g = f) => ({ ...cell, a: cell.a * f, b: cell.b * f, c: cell.c * g });
    expect(cellShiftReading(cell, scaled(1.002), "twoTheta")).toBeNull();
    expect(cellShiftReading(cell, scaled(1.0104), "twoTheta")).toMatch(/\+1\.04 % off the structure's in every length alike.*a wrong wavelength.*confirm the wavelength before refining/);
    expect(cellShiftReading(cell, scaled(0.99), "tof")).toMatch(/a wrong calibration.*the TOF calibration \(difC\)/);
    expect(cellShiftReading(cell, scaled(1.002, 1.012), "twoTheta")).toMatch(/unevenly: the phase at another temperature or composition/);
  });
});

describe("the data's axis against the structure", () => {
  it("warns when a 2θ axis holds no reflection of the structure (d-spacings read as degrees), and not on the demo", async () => {
    const { mn3gaSession, mn3gaSwappedUnitsSession } = await import("@/agent/evals/pages");
    const { executor, fakeHost, sessionPort } = await import("@/testSupport/agentHeadless");
    const stateOf = async (session: ReturnType<typeof mn3gaSession>): Promise<{ axisWarning?: string }> => {
      const { port } = sessionPort(session);
      const { ex } = executor(fakeHost(port).host, "auto");
      return JSON.parse((await ex.run("get_state", {})).text) as { axisWarning?: string };
    };
    expect((await stateOf(mn3gaSession())).axisWarning).toBeUndefined();
    expect((await stateOf(mn3gaSwappedUnitsSession())).axisWarning).toMatch(/axis is likely in another unit .*Ask the user before refining/);
  });
});

describe("a wavelength the peaks contradict", () => {
  it("is named by the cell check, with the wavelength the peaks imply; the demo at its own λ is not", async () => {
    const { mn3gaSession, mn3gaWrongWavelengthSession } = await import("@/agent/evals/pages");
    const { executor, fakeHost, sessionPort } = await import("@/testSupport/agentHeadless");
    const readingOf = async (session: ReturnType<typeof mn3gaSession>): Promise<string> => {
      const { port } = sessionPort(session);
      const { ex } = executor(fakeHost(port).host, "auto");
      const out = await ex.run("check_cell_symmetry", {});
      return out.isError ? out.text : String((JSON.parse(out.text) as { reading: string }).reading);
    };
    expect(await readingOf(mn3gaWrongWavelengthSession())).toMatch(/every d × 1\.01\d\d .*the data would be at λ 1\.5[34]\d\d Å, not 1\.556 Å.*Ask the user to confirm/);
    expect(await readingOf(mn3gaSession())).not.toMatch(/every d ×/);
  });
});
