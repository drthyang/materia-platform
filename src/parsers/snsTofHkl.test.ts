import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { looksLikeSnsTofHkl, parseSnsTofHkl } from "@/parsers/snsTofHkl";
import { parse_single_crystal_data } from "@/mcp/tools";
import { dataExists, dataPath } from "@/testSupport/data";

// Two rows of the GSAS-II tutorial's sapphire_sphere.hkl (TOPAZ), a third
// whose F² fills its F8.2 field, and the terminator.
const TEXT = `#h,k,l,fosq,sigfosq, scaleID, wl, tbar, run_num, seqnum,transmission, detector_num, twoth, dsp, col, row
  -4   6   5  627.43   21.71   1 1.18419 0.07120   6674      1 0.9736  17  1.83484   0.7457 174.00 189.00
  -2   5  11  490.06   17.96  31 0.95395 0.06608   7103   8293 0.9755  58  1.40791   0.7369 201.00  94.00
   1   0   412345.67   99.99  31 1.55320 0.06608   7103   8294 0.9755  58  1.40791   1.2000 201.00  94.00
   0   0   0    0.00    0.00   0  0.00000 0.0000      0      0 0.0000   0  0.00000   0.0000
`;

describe("SNS TOPAZ time-of-flight reflections", () => {
  it("reads each reflection's wavelength, 2θ, path length, transmission and run, by column", () => {
    expect(looksLikeSnsTofHkl(TEXT)).toBe(true);
    const p = parseSnsTofHkl(TEXT);
    expect(p.reflections).toHaveLength(3);
    expect(p.reflections[0]).toEqual({ h: -4, k: 6, l: 5, iObs: 627.43, sigma: 21.71, batch: 1, wavelength: 1.18419, twoTheta: (1.83484 * 180) / Math.PI, tbar: 0.0712, transmission: 0.9736 });
    // An F² of 10000.00 or more fills its field and butts against l: the columns, not whitespace, keep l = 4.
    expect(p.reflections[2]).toMatchObject({ h: 1, k: 0, l: 4, iObs: 12345.67, sigma: 99.99 });
    expect(p.batches).toEqual([1, 31]);
  });

  it("is told from a SHELX file, whose first columns it shares, by λ = 2d·sinθ", () => {
    expect(looksLikeSnsTofHkl("   1   0   4  123.45    1.23   1\n   0   0   0    0.00    0.00   0\n")).toBe(false);
    // The header-less TOPAZ row still reads as TOPAZ.
    expect(looksLikeSnsTofHkl(TEXT.split("\n").slice(1).join("\n"))).toBe(true);
    const parsed = parse_single_crystal_data({ text: TEXT, name: "sapphire.hkl" });
    expect(parsed.format).toBe("sns-tof");
    expect(parsed.dataset.radiation).toEqual({ kind: "neutron-tof" });
  });
});

const SAPPHIRE = "GSAS-II-tutorials/sc/sapphire_sphere.hkl";

describe.skipIf(!dataExists(SAPPHIRE))("the GSAS-II tutorial's sapphire (TOPAZ, 31 orientations)", () => {
  it("loads all 5078 reflections in 31 runs, from 0.40 to 3.32 Å", () => {
    const p = parseSnsTofHkl(readFileSync(dataPath(SAPPHIRE), "utf8"));
    expect(p.reflections).toHaveLength(5078);
    expect(p.skipped).toBe(0);
    expect(p.batches).toHaveLength(31);
    const wl = p.reflections.map((r) => r.wavelength!);
    expect(Math.min(...wl)).toBeCloseTo(0.4003, 4);
    expect(Math.max(...wl)).toBeCloseTo(3.3228, 4);
  });
});
