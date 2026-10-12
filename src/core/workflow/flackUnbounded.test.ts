import { describe, expect, it } from "vitest";
import { buildSingleCrystalRefinementProblem, buildSingleCrystalSpec } from "@/core/workflow/singleCrystalRefinement";
import { refine } from "@/core/refinement/engine";
import { INVERSION_TWIN } from "@/core/diffraction/types";
import { chiralPage } from "@/testSupport/scPages";

/**
 * The Flack x is refined free, as SHELXL refines it: a value a little below 0
 * (or above 1) is what the data give, and flackReading says what it means. A
 * bound at 0 hid it as "0.0000 at bound".
 */
describe("the Flack x and the twin fractions are not held to [0, 1]", () => {
  it("refines P2₁2₁2₁ data of x = −0.04 to a negative x, not 0 at a bound", () => {
    const page = chiralPage({ flack: -0.04 });
    const dataset = { ...page.dataset, twinLaws: [INVERSION_TWIN] };
    const spec = buildSingleCrystalSpec(page.structure, dataset, { twinFractions: [0.1] });
    const twin = spec.params.find((p) => p.id === "twin_1")!;
    expect(twin.min).toBeLessThan(0);
    expect(twin.max).toBeGreaterThan(1);
    const params = spec.params.map((p) => ({ ...p, fixed: !(p.kind === "scale" || p.kind === "twinFraction" || p.kind === "positionShift" || p.kind === "bIso") }));
    const result = refine(buildSingleCrystalRefinementProblem(page.structure, dataset, params, spec.bindings), { maxIterations: 12 });
    const x = result.parameters.twin_1!;
    expect(x).toBeLessThan(-0.01);
    expect(Math.abs(x + 0.04)).toBeLessThan(3 * result.esd.twin_1! + 0.01);
    expect((result.diagnostics?.atBounds ?? []).map((b) => b.parameterId)).not.toContain("twin_1");
  });
});
