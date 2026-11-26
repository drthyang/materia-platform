import { describe, it, expect } from "vitest";
import { statedTemperature } from "@/parsers/statedTemperature";

describe("the sample temperature a data file states", () => {
  it("reads a header's temperature in K or °C, and a CIF's ambient temperature", () => {
    expect(statedTemperature("# Sample: Fe3O4\n# Temperature: 10 K\n1 2 3\n")).toEqual({ kind: "stated", temperature: { kelvin: 10, text: "# Temperature: 10 K" } });
    expect(statedTemperature("Title run 123 temp=4.2K\n10 20 1")).toMatchObject({ kind: "stated", temperature: { kelvin: 4.2 } });
    expect(statedTemperature("# measured at T = 300 K\n")).toMatchObject({ kind: "stated", temperature: { kelvin: 300 } });
    expect(statedTemperature("# temperature 25 °C\n")).toMatchObject({ kind: "stated", temperature: { kelvin: 298.15 } });
    expect(statedTemperature("data_x\n_diffrn_ambient_temperature 100(2)\n")).toMatchObject({ kind: "stated", temperature: { kelvin: 100 } });
    // The same temperature stated twice is one temperature.
    expect(statedTemperature("# temperature 10 K\n# T = 10.0 K\n")).toMatchObject({ kind: "stated", temperature: { kelvin: 10 } });
  });

  it("states nothing for a placeholder 0 K, a sample name, a number without a unit, or no header", () => {
    // The NOMAD reduction's header: "at temperature 0.0 K" is its placeholder; "_at_300K" is a name.
    expect(statedTemperature("Sample Run: 160894\n# GaTa4Se8_at_300K at temperature 0.0 K.\n# Sample Temperature\nBANK 1 2999 2999 SLOG 448 19491 0.0012583 0 FXYE\n")).toEqual({ kind: "none" });
    expect(statedTemperature("# temperature 300\n")).toEqual({ kind: "none" });
    expect(statedTemperature("10.0 100 10\n10.1 120 11\n")).toEqual({ kind: "none" });
    expect(statedTemperature(null)).toEqual({ kind: "none" });
  });

  it("gives none when the file states two different temperatures", () => {
    const r = statedTemperature("# temperature 10 K\n# temperature 300 K\n");
    expect(r.kind).toBe("conflicting");
  });
});
