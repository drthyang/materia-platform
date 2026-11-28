import { describe, it, expect } from "vitest";
import { MICROSTRAIN_TITLE_CW, MICROSTRAIN_TITLE_TOF } from "@/app/microstructureText";
import { extractSizeStrain } from "@/core/diffraction/microstructure";

describe("the Microstructure readout's hover text", () => {
  it("constant wavelength: names the strain it shows and gives GSAS-II's number for the same Y", () => {
    expect(MICROSTRAIN_TITLE_CW).toBe(
      "Derived from the refined Lorentzian X (size) and Y (microstrain), with the instrument seed deconvoluted. Stokes–Wilson microstrain ε = π·Y/72000 (× 10⁶ here); GSAS-II's Mustrain for the same Y is 10⁶·π·Y/18000 (4 × this).",
    );
    // π/72000 is not credited to GSAS-II.
    expect(MICROSTRAIN_TITLE_CW).not.toMatch(/GSAS-II microstrain =|LY·π\/72000/);
    // The text's two constants are the code's: the number shown is 10⁶·π·Y/72000, and GSAS-II's is four times it.
    const y = 12;
    const shown = extractSizeStrain({ x: 0, y, wavelength: 1.5406 }).strainPpm.value;
    expect(shown).toBeCloseTo((1e6 * Math.PI * y) / 72000, 8);
    expect((1e6 * Math.PI * y) / 18000 / shown).toBeCloseTo(4, 12);
  });

  it("time of flight: the microstrain row, with no Lorentzian X or Y and no π·Y/72000", () => {
    expect(MICROSTRAIN_TITLE_TOF).toBe("Derived from the refined microstrain row (ε = Δd/d, a Gaussian standard deviation, × 10⁶), with the instrument seed deconvoluted in quadrature.");
    expect(MICROSTRAIN_TITLE_TOF).not.toMatch(/Lorentzian|72000|GSAS/);
  });
});
