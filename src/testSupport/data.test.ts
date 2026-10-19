import { describe, it, expect } from "vitest";
import { dataExists } from "@/testSupport/data";

/**
 * A published dataset committed under examples/ is found without the
 * git-ignored data/ folder, so its tests run in CI instead of skipping.
 */
describe("the test data folders", () => {
  it("finds the Mn₃Ga 350 K POWGEN set under both its local names", () => {
    for (const file of ["PG3_45598_Bank1.fxye", "PG3_45598_Bank1.instprm", "Mn3Ga-mag_53_350K_Final_ortho.cif"]) {
      expect(dataExists(`Mn3Ga_POWGEN_350K/${file}`)).toBe(true);
    }
    expect(dataExists("350K/Mn3Ga-mag_53_350K_Final_ortho.cif")).toBe(true);
  });

  it("still reports a dataset that is neither local nor committed as absent", () => {
    expect(dataExists("No_Such_Set/file.xye")).toBe(false);
  });
});
