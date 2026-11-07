import { describe, it, expect } from "vitest";
import { parseCif } from "@/parsers/cif";
import { powderCurves, buildPowderProblem } from "@/core/workflow/powder";
import { buildStructureRefinement } from "@/core/workflow/structureRefinement";
import { refine } from "@/core/refinement/engine";
import { computeAgreementFactors, weightsFromSigma } from "@/core/refinement/factors";
import { optimalScale } from "@/app/loadData";
import { dataExists, readData } from "@/testSupport/data";
import { LOCAL_DATA } from "@/testSupport/localData";
import type { PowderPattern } from "@/core/diffraction/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";

/**
 * Benchmark against a GSAS-II "good fit" of the *same* synchrotron pattern of
 * the local X-ray dataset (`LOCAL_DATA.xrd`, unpublished). GSAS-II's fit (its
 * .gpx, extracted to a CSV: x, yobs, ycalc, ybkg, sigma) is reached by fixing
 * the structure and using a Thompson-Cox-Hastings pseudo-Voigt — a Gaussian
 * Caglioti part (U/V/W) PLUS an independent Lorentzian size-strain part (X/Y) and
 * axial-divergence asymmetry (SH/L) — refining only scale + Chebyshev background.
 *
 * Our engine currently has a single pseudo-Voigt width (Gaussian Caglioti only;
 * no independent Lorentzian X/Y, no SH/L asymmetry). This test quantifies the
 * resulting gap on identical data and will tighten as the TCH profile lands
 * (roadmap M1). Skips when the git-ignored data/ folder is absent.
 */

const DIR = LOCAL_DATA.xrd.dir;
const CIF = `${DIR}/${LOCAL_DATA.xrd.structure}`;
const REF = `${DIR}/${LOCAL_DATA.xrd.gsasFit}`;
const has = dataExists(CIF) && dataExists(REF);

interface Row { x: number; yobs: number; yc: number; yb: number; sig: number }
function loadRef(): Row[] {
  return readData(REF)
    .trim()
    .split(/\r?\n/)
    .slice(1) // header
    .map((l) => l.split(",").map(Number))
    .map(([x, yobs, yc, yb, sig]) => ({ x: x!, yobs: yobs!, yc: yc!, yb: yb!, sig: sig! }));
}

/** Weighted profile R over rows with positive weight. */
function wR(rows: { yobs: number; yc: number; sig: number }[]): number {
  let num = 0, den = 0;
  for (const r of rows) {
    const w = r.sig > 0 ? 1 / (r.sig * r.sig) : 0;
    num += w * (r.yobs - r.yc) ** 2;
    den += w * r.yobs ** 2;
  }
  return 100 * Math.sqrt(num / den);
}

describe.skipIf(!has)("benchmark vs GSAS-II good fit — the local X-ray dataset", () => {
  /** GSAS-II's wR over its own fit region, read from its fit (no number from the data is kept here). */
  const gsasWR = (): number => wR(loadRef().filter((r) => r.yc > 0));

  it("reads GSAS-II's wR from its fit", () => {
    const value = gsasWR();
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(30);
  });

  it("measures OUR best wR on identical data with a fixed structure", () => {
    const ref = loadRef();
    const fit = ref.filter((r) => r.yc > 0); // same fit range GSAS used
    const structure = parseCif(readData(CIF), "gns");
    const pattern: PowderPattern = {
      id: "gns",
      name: "local X-ray",
      xUnit: "twoTheta",
      radiation: { kind: "xray", wavelength: 0.1665 },
      wavelength: 0.1665,
      points: fit.map((r) => ({ x: r.x, yObs: r.yobs, sigma: r.sig })),
    };
    // Atom positions & ADP FIXED (as GSAS did). Refine scale + cubic cell a
    // (the low-temperature model is thermally contracted vs the data, so the cell must relax
    // for peaks to align) + one pseudo-Voigt width + 7 Chebyshev background terms.
    // This isolates our peak-shape model on a fixed structure — no ADP/position
    // freedom to absorb profile error.
    const a0 = structure.cell.a;
    const profile = { shape: "pseudoVoigt" as const, eta: 0.5, lorentz: true };
    const bindings: ParameterBinding[] = [
      { parameterId: "scale", kind: "scale", targetId: pattern.id },
      { parameterId: "width", kind: "peakWidth", targetId: pattern.id },
      { parameterId: "acubic", kind: "cellLength", targetId: structure.id, targetKey: "a" },
      { parameterId: "acubic", kind: "cellLength", targetId: structure.id, targetKey: "b" },
      { parameterId: "acubic", kind: "cellLength", targetId: structure.id, targetKey: "c" },
      ...Array.from({ length: 7 }, (_, k) => ({ parameterId: `bkg${k}`, kind: "background" as const, targetId: pattern.id, targetKey: String(k) })),
    ];
    const unit = powderCurves(structure, pattern, [
      { id: "scale", label: "s", kind: "scale", value: 1, initialValue: 1, fixed: false },
      { id: "width", label: "w", kind: "peakWidth", value: 0.02, initialValue: 0.02, fixed: false },
    ], bindings, profile).yCalc;
    const s0 = optimalScale(pattern.points.map((p) => (p.yObs > 0 ? p.yObs : 0)), unit);
    const params: RefinementParameter[] = [
      { id: "scale", label: "scale", kind: "scale", value: s0, initialValue: s0, min: 0, fixed: false },
      { id: "width", label: "width", kind: "peakWidth", value: 0.02, initialValue: 0.02, min: 0.003, max: 0.2, fixed: false },
      { id: "acubic", label: "a", kind: "cellLength", value: a0, initialValue: a0, min: a0 * 0.98, max: a0 * 1.02, fixed: false },
      ...Array.from({ length: 7 }, (_, k) => ({ id: `bkg${k}`, label: `bkg${k}`, kind: "background" as const, value: k === 0 ? 5 : 0, initialValue: k === 0 ? 5 : 0, fixed: false })),
    ];
    const result = refine(buildPowderProblem(structure, pattern, params, bindings, profile), { maxIterations: 40 });
    const refined = params.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
    const curves = powderCurves(structure, pattern, refined, bindings, profile);
    const weights = weightsFromSigma(pattern.points.map((p) => p.sigma));
    const agree = computeAgreementFactors(
      Float64Array.from(pattern.points.map((p) => p.yObs)),
      Float64Array.from(curves.yCalc),
      weights,
      params.length,
    );
    const ourWR = 100 * (agree.rWeighted ?? 0);
    console.log(`BENCHMARK local X-ray — GSAS-II wR = ${gsasWR().toFixed(2)}% (TCH pseudo-Voigt) | OUR wR (fixed atoms, single pseudo-Voigt) = ${ourWR.toFixed(2)}%`);
    expect(Number.isFinite(ourWR)).toBe(true);
    // With the structure-factor special-position fix and the Lorentz factor
    // applied, even a single pseudo-Voigt comes far closer than when |F|² was
    // wrong. The remaining gap to GSAS-II is the peak-shape model
    // (TCH Lorentzian X/Y + FCJ asymmetry), ADP, and polarization.
    expect(ourWR).toBeGreaterThan(gsasWR());
    expect(ourWR).toBeLessThan(30);
  });

  it("full TCH + FCJ profile approaches GSAS-II once the intensity computation is correct", () => {
    const ref = loadRef();
    // Downsample: the FCJ sub-peak expansion is ~16× heavier per point; a coarse
    // grid documents the intensity-limited floor without a slow full-grid solve.
    const fit = ref.filter((r) => r.yc > 0).filter((_, i) => i % 3 === 0);
    const structure = parseCif(readData(CIF), "gns");
    const pattern: PowderPattern = {
      id: "gns",
      name: "local X-ray",
      xUnit: "twoTheta",
      radiation: { kind: "xray", wavelength: 0.1665 },
      wavelength: 0.1665,
      points: fit.map((r) => ({ x: r.x, yObs: r.yobs, sigma: r.sig })),
    };
    // GSAS-II's model shape: fixed atoms; refine scale + cell + Chebyshev
    // background + Thompson–Cox–Hastings pseudo-Voigt (Gaussian U/V/W + Lorentzian
    // X/Y) + Finger–Cox–Jephcoat axial-divergence asymmetry (S/L, H/L). The FCJ
    // low-angle tail is the piece the strong 1.6°/3.7° synchrotron peaks need.
    const profile = { shape: "pseudoVoigt" as const, lorentz: true };
    const spec = buildStructureRefinement(structure, pattern, {
      scale: 1,
      backgroundTerms: 7,
      caglioti: { u: 0, v: 0, w: 1 },
      lorentzian: { x: 1, y: 0 },
      axial: { sl: 0.01, hl: 0.01 },
      refineU: true,
      refineAdp: false,
      refinePositions: false,
    });
    const unit = powderCurves(structure, pattern, spec.params, spec.bindings, profile).yCalc;
    const s0 = optimalScale(pattern.points.map((p) => (p.yObs > 0 ? p.yObs : 0)), unit);
    const params = spec.params.map((p) => (p.id === "scale" ? { ...p, value: s0, initialValue: s0 } : p));
    // Few iterations on a coarse grid: the FCJ sub-peak expansion makes each
    // evaluation ~16× heavier, so this samples the fit rather than fully solving.
    const result = refine(buildPowderProblem(structure, pattern, params, spec.bindings, profile), { maxIterations: 12 });
    const refined = params.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
    const curves = powderCurves(structure, pattern, refined, spec.bindings, profile);
    const weights = weightsFromSigma(pattern.points.map((p) => p.sigma));
    const agree = computeAgreementFactors(
      Float64Array.from(pattern.points.map((p) => p.yObs)),
      Float64Array.from(curves.yCalc),
      weights,
      params.length,
    );
    const ourWR = 100 * (agree.rWeighted ?? 0);
    console.log(`BENCHMARK local X-ray — GSAS-II wR = ${gsasWR().toFixed(2)}% | OUR TCH+FCJ wR (fixed atoms) = ${ourWR.toFixed(2)}%`);
    expect(Number.isFinite(ourWR)).toBe(true);
    // After the two computation fixes — the structure-factor special-position sum
    // and the Lorentz factor — the full profile (Gaussian U/V/W + Lorentzian X/Y +
    // FCJ asymmetry) refines far below the floor it had when |F|² was wrong, on
    // this coarse grid. The remaining gap to GSAS-II is ADP, polarization,
    // and a tighter solve. (Earlier this test wrongly concluded the residual was
    // profile-limited; the benchmark itself exposed the real intensity bug.)
    expect(ourWR).toBeLessThan(35);
  });
});
