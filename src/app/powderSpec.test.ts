import { describe, it, expect } from "vitest";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import { exampleStructure } from "@/examples/mn3ga";
import { buildSyntheticPowder } from "@/examples/synthetic";
import { buildPowderSpec } from "@/app/powderSpec";
import { runPowderRefinement } from "@/workers/runPowder";
import { DEFAULT_STAGE_KINDS } from "@/core/workflow/structureRefinement";

const structure = exampleStructure();
const pattern = buildSyntheticPowder(structure);

describe("buildPowderSpec", () => {
  it("emits the full symmetry-allowed set with structural rows fixed and basics free", () => {
    const spec = buildPowderSpec(structure, pattern, { kind: "constantWavelength", wavelength: 1.54 });
    const kinds = new Set(spec.params.map((p) => p.kind));
    // Scale, background, cell, width, per-site ADP, and symmetry positions all present.
    for (const k of ["scale", "background", "cellLength", "peakWidth", "bIso", "positionShift"]) {
      expect(kinds.has(k as never)).toBe(true);
    }
    expect(spec.params.length).toBeGreaterThan(8);
    // Basics free, structural fixed on first load.
    expect(spec.params.find((p) => p.kind === "scale")!.fixed).toBe(false);
    expect(spec.params.filter((p) => p.kind === "bIso").every((p) => p.fixed)).toBe(true);
    expect(spec.params.filter((p) => p.kind === "positionShift").every((p) => p.fixed)).toBe(true);
    // No instrument profile ⇒ single width (Gaussian), not Caglioti.
    expect(spec.params.some((p) => p.kind === "profileW")).toBe(false);
    expect(spec.profile.shape).toBe("gaussian");
    // Instrument / profile parameters are NOT refined by default (fixed on load).
    expect(spec.params.filter((p) => p.kind === "peakWidth").every((p) => p.fixed)).toBe(true);
  });

  it("seeds the asymmetry from the instrument file when it is switched on", () => {
    // 11-BM's GSAS file gives S/L = H/L = 0.0011; the default 0.01 is nine times that.
    const inst: InstrumentParameters = { kind: "constantWavelength", wavelength: 0.4139, u: 6.4, v: -0.7, w: 0.35, x: 0.17, y: 0, asymmetry: { sl: 0.0011, hl: 0.0011 } };
    const on = buildPowderSpec(structure, pattern, inst, true, 4, {}, "isotropic", { asymmetry: true });
    expect(on.params.find((p) => p.kind === "asymSL")?.value).toBeCloseTo(0.0011, 6);
    const { asymmetry: _drop, ...bare } = inst;
    const seeded = buildPowderSpec(structure, pattern, bare, true, 4, {}, "isotropic", { asymmetry: true });
    expect(seeded.params.find((p) => p.kind === "asymSL")?.value).toBeCloseTo(0.01, 6);
    // Off by default: the file's asymmetry waits until it is switched on.
    expect(buildPowderSpec(structure, pattern, inst).params.some((p) => p.kind === "asymSL")).toBe(false);
  });

  it("holds instrument / profile parameters fixed on load", () => {
    const inst: InstrumentParameters = { kind: "constantWavelength", wavelength: 0.1665, u: -46, v: 0, w: 1.2, zero: 0 };
    const spec = buildPowderSpec(structure, pattern, inst);
    const profileKinds = new Set(["profileV", "profileW", "profileX", "profileY", "zeroShift"]);
    const profile = spec.params.filter((p) => profileKinds.has(p.kind));
    expect(profile.length).toBeGreaterThan(0);
    // Fixed on load — the default "Refine" leaves the instrument alone.
    expect(profile.every((p) => p.fixed)).toBe(true);
  });

  it("uses the instrument Caglioti profile when the .instprm carries U,V,W", () => {
    const inst: InstrumentParameters = { kind: "constantWavelength", wavelength: 0.1665, u: -46, v: 0, w: 1.2, zero: 0 };
    const spec = buildPowderSpec(structure, pattern, inst);
    expect(spec.params.some((p) => p.kind === "profileW")).toBe(true);
    expect(spec.params.some((p) => p.kind === "peakWidth")).toBe(false);
    expect(spec.profile.shape).toBe("pseudoVoigt");
  });

  it("surfaces the sample Lorentzian X/Y as refinable size/mustrain rows (isotropic Mustrain)", () => {
    // A pseudo-Voigt CW instrument (the .instprm carries U…) emits the sample
    // Lorentzian terms: X = crystallite size, Y = isotropic microstrain. These
    // are the refinable parameter behind "Mustrain: isotropic" — labelled and
    // (via the parameter-panel group map) filed under Microstructure, not buried
    // as anonymous "prof X/Y" instrument rows.
    const inst: InstrumentParameters = { kind: "constantWavelength", wavelength: 0.1665, u: -46, v: 0, w: 1.2, x: 0, y: 0, zero: 0 };
    const spec = buildPowderSpec(structure, pattern, inst);
    const px = spec.params.find((p) => p.kind === "profileX");
    const py = spec.params.find((p) => p.kind === "profileY");
    expect(px?.label).toBe("size (Lorentzian X)");
    expect(py?.label).toBe("mustrain (Lorentzian Y)");
    // Plain refinable rows (no expression), held fixed on load like the rest of the profile.
    expect(py!.expression).toBeUndefined();
    expect(py!.fixed).toBe(true);
  });

  it("emits Stephens anisotropic-microstrain S-parameters only when microstrain is on, fixed on load", () => {
    const inst: InstrumentParameters = { kind: "constantWavelength", wavelength: 0.7, u: -46, v: 0, w: 1.2, x: 0.1, zero: 0 };
    const off = buildPowderSpec(structure, pattern, inst, true, 4, {}, "isotropic");
    expect(off.params.some((p) => p.kind === "stephensStrain")).toBe(false);

    const on = buildPowderSpec(structure, pattern, inst, true, 4, {}, "generalized");
    const strain = on.params.filter((p) => p.kind === "stephensStrain");
    expect(strain.length).toBeGreaterThan(0); // ≥1 symmetry-allowed quartic invariant
    expect(strain.every((p) => p.fixed && p.value === 0)).toBe(true); // seeded at zero, fixed on load
  });

  it("lets the caller choose the number of Chebyshev background coefficients", () => {
    const spec = buildPowderSpec(structure, pattern, { kind: "constantWavelength", wavelength: 1.54 }, true, 8);
    const bkg = spec.params.filter((p) => p.kind === "background");
    expect(bkg).toHaveLength(8);
    expect(bkg.map((p) => p.id)).toEqual(["bkg0", "bkg1", "bkg2", "bkg3", "bkg4", "bkg5", "bkg6", "bkg7"]);
  });

  it("shows occupancy rows but keeps them fixed on load", () => {
    const spec = buildPowderSpec(structure, pattern, { kind: "constantWavelength", wavelength: 1.54 });
    const occ = spec.params.filter((p) => p.kind === "occupancy");
    // One occupancy row per site, seeded from the model and fixed on load.
    expect(occ.map((p) => p.id).sort()).toEqual(["occ_Ga1", "occ_Mn1"]);
    expect(occ.every((p) => p.fixed)).toBe(true);
  });
});

describe("staged powder refinement through the worker runner (the MCP `staged` path)", () => {
  it("converges on the synthetic example via the serializable stage plan", () => {
    const spec = buildPowderSpec(structure, pattern, { kind: "constantWavelength", wavelength: 1.54 });
    // The stage plan unlocks kind-groups in order; send every row but occupancy as unlockable.
    const unlockable = spec.params.map((p) => (p.kind === "occupancy" ? p : { ...p, fixed: false }));
    const result = runPowderRefinement({
      type: "refinePowder", requestId: 1, structure, pattern,
      parameters: unlockable, bindings: spec.bindings, shape: spec.profile.shape,
      staged: DEFAULT_STAGE_KINDS, options: { maxIterations: 15 },
    });
    expect(["converged", "stalled"]).toContain(result.status);
    expect(100 * (result.agreement.rWeighted ?? 1)).toBeLessThan(15);
    // Recovered the true peak width (0.5) and scale (~80).
    expect(result.parameters.width!).toBeCloseTo(0.5, 1);
    expect(result.parameters.scale!).toBeGreaterThan(50);
  });
});
