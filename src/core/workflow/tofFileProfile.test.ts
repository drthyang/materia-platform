import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import { ModelDomainError, type RefinementParameter } from "@/core/refinement/types";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { buildPowderSpec, tofFileProfileOf } from "@/app/powderSpec";
import { emptyPage, withFixed, withInstrument, withPattern, withStructure } from "@/app/powderPage";
import { fileProfileNote, tofNegativeGammaNote, tofWidthNote } from "@/app/tofWidthNote";
import { applyParameters } from "@/core/workflow/apply";
import { resolveTies } from "@/core/refinement/constraints";
import { buildPowderProblem, placePeaks, tofNegativeLorentzian, tofReflectionsLeftOut, tofWidthProblems, tofWidthsAt } from "@/core/workflow/powder";
import { DEFAULT_STAGE_KINDS } from "@/core/workflow/structureRefinement";
import { synthesizePattern } from "@/core/diffraction/profile";
import { refine } from "@/core/refinement/engine";
import { refinementBundle } from "@/core/export/bundle";
import { gsas2SampleTerms } from "@/core/export/gsas2";
import { INSTRUMENT_KINDS } from "@/agent/method";
import { mn3gaPowgenExample } from "@/examples/mn3gaPowgen";
import { bundledSession } from "@/app/powderSession";

/**
 * A GSAS-II TOF instrument file on the page: its profile terms as the file
 * gives them, held; the sample's rows beside them; the width rule; and the
 * export. The instrument is the synthetic three-bank file of
 * scripts/tof-profile/fixtures (invented numbers): bank 1's σ² is negative
 * below d = 0.62 Å, bank 2 has a negative sig-1 and a negative X.
 */
const INSTPRM = readFileSync("scripts/tof-profile/fixtures/synthetic_three_banks.instprm", "utf8");
const SI = `data_Si
_cell_length_a 5.4310
_cell_length_b 5.4310
_cell_length_c 5.4310
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M "F d -3 m:2"
loop_
_atom_site_type_symbol
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_U_iso_or_equiv
Si Si1 0.125 0.125 0.125 1 0.006
`;
const structure = parseCif(SI, "si");

/** A flat pattern over d = dLo … dHi Å on a bank's calibration. */
function patternOn(bank: number, dLo = 0.55, dHi = 3.3, n = 1200): PowderPattern {
  const inst = parseInstrumentParameters(INSTPRM, bank);
  if (inst.kind !== "tof") throw new Error("TOF expected");
  const tof = (d: number): number => (inst.zero ?? 0) + inst.difC * d + (inst.difA ?? 0) * d * d;
  const lo = tof(dLo), hi = tof(dHi);
  return { id: "p", name: "p", xUnit: "tof", radiation: { kind: "neutron-tof" }, points: Array.from({ length: n }, (_, i) => ({ x: lo * (hi / lo) ** (i / (n - 1)), yObs: 100, sigma: 10 })) } as PowderPattern;
}
const valuesOf = (params: readonly RefinementParameter[]): Record<string, number> => Object.fromEntries(params.map((p) => [p.id, p.value]));
const pageOn = (bank: number) =>
  withInstrument(withPattern(withStructure(emptyPage(), structure), patternOn(bank), { name: "si.dat", text: "" }), parseInstrumentParameters(INSTPRM, bank), { name: "three.instprm", text: INSTPRM, bank });

describe("a GSAS-II TOF file's rows", () => {
  it("only a file that carries the profile takes this path; a calibration alone keeps the page's own profile", () => {
    expect(tofFileProfileOf(parseInstrumentParameters(INSTPRM, 2))).not.toBeNull();
    expect(tofFileProfileOf({ kind: "tof", difC: 3800 })).toBeNull();
    expect(tofFileProfileOf({ kind: "tof", difC: 3800, alpha: 1, beta0: 0.05, sig1: 20 })).toBeNull(); // no program named: an older project's instrument
    const plain = buildPowderSpec(structure, patternOn(2), { kind: "tof", difC: 3800 });
    expect(plain.params.find((p) => p.id === "mustrainIso")).toMatchObject({ value: 1500 });
    expect(plain.params.some((p) => p.kind === "tofFileProfile" || p.kind.startsWith("tofSample"))).toBe(false);
  });

  it("every term the file gives is a row at the file's value, the negative ones included, with limits that hold them", () => {
    const spec = buildPowderSpec(structure, patternOn(2), parseInstrumentParameters(INSTPRM, 2));
    const want: Record<string, number> = { tof_alpha1: 1.1, tof_beta0: 0.057, tof_beta1: 0.003, tof_betaQ: 0.2, tof_sig0: 30, tof_sig1: -30, tof_sig2: 190, tof_sigQ: 200, tof_gamX: -5, tof_gamY: 13, tof_gamZ: 0 };
    for (const [id, value] of Object.entries(want)) {
      const row = spec.params.find((p) => p.id === id)!;
      expect(row, id).toMatchObject({ value, kind: "tofFileProfile", fixed: true });
      expect(row.min!).toBeLessThanOrEqual(value);
      expect(row.max!).toBeGreaterThanOrEqual(value);
    }
    // The limits take any real file: a constant rise term above 10, a negative α₁.
    const alpha0 = buildPowderSpec(structure, patternOn(2), parseInstrumentParameters(INSTPRM, 2)).params.find((p) => p.id === "tof_alpha1")!;
    expect(alpha0.min!).toBeLessThanOrEqual(-10);
    expect(alpha0.max!).toBeGreaterThanOrEqual(200);
  });

  it("no stage frees the file's rows; the profile stage frees the sample's Lorentzian rows", () => {
    const profile = new Set(DEFAULT_STAGE_KINDS.find((g) => g.name === "profile")!.kinds);
    expect(DEFAULT_STAGE_KINDS.some((g) => g.kinds.includes("tofFileProfile"))).toBe(false);
    expect(profile.has("tofSampleLorentz") && profile.has("tofSampleSize") && profile.has("zeroShift")).toBe(true);
    expect(profile.has("tofSampleGauss")).toBe(false);
    // The Copilot's instrument group: the sample's rows stand where the peak-shape terms stood; the file's rows are not in it.
    expect(INSTRUMENT_KINDS.has("tofFileProfile")).toBe(false);
    expect(INSTRUMENT_KINDS.has("tofSampleLorentz") && INSTRUMENT_KINDS.has("tofSampleSize")).toBe(true);
  });

  it("σ₁² and the Gaussian microstrain are never free together: freeing one holds the other", () => {
    const page = pageOn(2);
    const free = (s: typeof page.session, id: string): boolean => !s.powderParams.find((p) => p.id === id)!.fixed;
    const a = withFixed(page.session, [{ id: "tofSampleGauss", fixed: false }]);
    expect(free(a, "tofSampleGauss")).toBe(true);
    const b = withFixed(a, [{ id: "tof_sig1", fixed: false }]);
    expect(free(b, "tof_sig1")).toBe(true);
    expect(free(b, "tofSampleGauss")).toBe(false);
    const c = withFixed(b, [{ id: "tofSampleGauss", fixed: false }]);
    expect(free(c, "tofSampleGauss")).toBe(true);
    expect(free(c, "tof_sig1")).toBe(false);
    const both = withFixed(page.session, [{ id: "tof_sig1", fixed: false }, { id: "tofSampleGauss", fixed: false }]);
    expect(free(both, "tof_sig1")).toBe(false);
    expect(free(both, "tofSampleGauss")).toBe(true);
  });

  it("the Instrument card says how the file is used", () => {
    const note = fileProfileNote(parseInstrumentParameters(INSTPRM, 2), null)!;
    expect(note.line).toBe("Profile as the file gives it, held. Sample rows start at GSAS-II's defaults (Lorentzian microstrain 1000, size 1 µm), which a GSAS-II calibration assumes.");
    expect(fileProfileNote({ kind: "tof", difC: 3800 }, null)).toBeNull();
  });
});

describe("the width rule: σ², α and β over the data's d-range", () => {
  it("valid everywhere in the data: nothing is said, every reflection is drawn", () => {
    const page = pageOn(2);
    expect(tofWidthNote(page.session)).toBeNull();
  });

  it("σ² ≤ 0 inside the data's range: the range is named, the reflections there are not drawn, the others are", () => {
    const page = pageOn(1);
    const s = page.session;
    const applied = applyParameters(structure, s.powderBindings, resolveTies(s.powderParams, valuesOf(s.powderParams)));
    const problems = tofWidthProblems(s.pattern, applied);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.which).toBe("σ²");
    // −16 + 40 d² + 11 d⁴ = 0 at d = 0.6030 Å; the data start at 0.55 Å.
    expect(problems[0]!.dMax).toBeGreaterThan(0.599);
    expect(problems[0]!.dMax).toBeLessThan(0.6031);
    const left = tofReflectionsLeftOut(s.pattern, applied);
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((r) => r.d < 0.6031 && r.which === "σ²")).toBe(true);
    const peaks = placePeaks(s.pattern, applied, [{ d: 0.58, intensity: 1 }, { d: 0.7, intensity: 1 }]);
    expect(peaks).toHaveLength(1);
    expect(Number.isFinite(peaks[0]!.tof!.sigma) && peaks[0]!.tof!.sigma > 0).toBe(true);
    const note = tofWidthNote(s)!;
    expect(note.line).toMatch(/^The instrument file gives no peak width for d 0\.550–0\.60\d Å \(σ² ≤ 0\): \d+ reflections? not drawn\.$/);
    // The same check outside the data's range says nothing: data from 0.7 Å up.
    const above = withPattern(page, patternOn(1, 0.7, 3.3), { name: "si.dat", text: "" });
    expect(tofWidthNote(above.session)).toBeNull();
  });

  it("a fit step that would take a width below zero inside the data's range is rejected, and the fit goes on", () => {
    const pattern = patternOn(2);
    const built = buildPowderSpec(structure, pattern, parseInstrumentParameters(INSTPRM, 2));
    // A scale that gives the peaks weight on the flat test pattern.
    const spec = { ...built, params: built.params.map((p) => (p.kind === "scale" ? { ...p, value: 1 } : p)) };
    const free = (ids: readonly string[]): RefinementParameter[] => spec.params.map((p) => ({ ...p, fixed: !ids.includes(p.id) }));
    const problem = buildPowderProblem(structure, pattern, free(["tof_sig0"]), spec.bindings, spec.profile);
    const at = (sig0: number): Float64Array => problem.calculate({ ...valuesOf(spec.params), tof_sig0: sig0 });
    expect(() => at(30)).not.toThrow();
    // σ² = sig0 − 30 d² + 190 d⁴ + 200 d is smallest at the short end, 0.55 Å: 110.3 + sig0 − 9.1 + 17.4.
    expect(() => at(-200)).toThrow(ModelDomainError);
    // Held, the file's widths cannot change: no check, nothing thrown at the file's own values.
    const held = buildPowderProblem(structure, pattern, free(["scale"]), spec.bindings, spec.profile);
    expect(() => held.calculate(valuesOf(spec.params))).not.toThrow();
    // A refinement that starts valid stays valid.
    const truth = at(30);
    const data = { ...pattern, points: pattern.points.map((p, i) => ({ ...p, yObs: truth[i]!, sigma: Math.sqrt(Math.max(truth[i]!, 1)) })) } as PowderPattern;
    const result = refine(buildPowderProblem(structure, data, free(["scale", "tof_sig0"]).map((p) => (p.id === "tof_sig0" ? { ...p, value: 80 } : p)), spec.bindings, spec.profile), { maxIterations: 40 });
    expect(result.status).toBe("converged");
    expect(result.parameters.tof_sig0!).toBeCloseTo(30, 1);
  });

  it("where the file's widths are invalid at the start the fit is not refused: the reflections are left out", () => {
    const pattern = patternOn(1);
    const spec = buildPowderSpec(structure, pattern, parseInstrumentParameters(INSTPRM, 1));
    const params = spec.params.map((p) => ({ ...p, fixed: p.kind !== "scale" && p.id !== "tof_sig2" }));
    const problem = buildPowderProblem(structure, pattern, params, spec.bindings, spec.profile);
    const y = problem.calculate(valuesOf(params));
    expect(Array.from(y).every(Number.isFinite)).toBe(true);
  });
});

describe("the structure's analytic columns with a Lorentzian width", () => {
  it("the occupancy and B columns equal a finite difference of the pattern", () => {
    const pattern = patternOn(2);
    const spec = buildPowderSpec(structure, pattern, parseInstrumentParameters(INSTPRM, 2));
    const params = spec.params.map((p) => ({ ...p, fixed: !(p.kind === "bIso" || p.kind === "occupancy"), ...(p.kind === "scale" ? { value: 1 } : {}) }));
    const problem = buildPowderProblem(structure, pattern, params, spec.bindings, spec.profile);
    const freeParams = params.filter((p) => !p.fixed);
    expect(freeParams.length).toBeGreaterThan(0);
    const columns = problem.analyticColumns!(freeParams, freeParams.map((p) => p.value));
    freeParams.forEach((p, j) => {
      const column = columns[j];
      if (!column) return;
      const h = 1e-5;
      const plus = problem.calculate({ ...valuesOf(params), [p.id]: p.value + h });
      const minus = problem.calculate({ ...valuesOf(params), [p.id]: p.value - h });
      let worst = 0, top = 0;
      for (let i = 0; i < column.length; i++) {
        const fd = (plus[i]! - minus[i]!) / (2 * h);
        worst = Math.max(worst, Math.abs(fd - column[i]!));
        top = Math.max(top, Math.abs(column[i]!));
      }
      expect(worst / top, p.id).toBeLessThan(1e-6);
    });
    expect(columns.some((c) => c !== null)).toBe(true);
  });
});

describe("the drawn range of a peak with a Lorentzian width", () => {
  it("leaves less than 0.05 % of a peak's area outside", () => {
    const pattern = patternOn(3);
    const spec = buildPowderSpec(structure, pattern, parseInstrumentParameters(INSTPRM, 3));
    const applied = applyParameters(structure, spec.bindings, resolveTies(spec.params, valuesOf(spec.params)));
    for (const d of [0.7, 1.4, 2.6]) {
      const [peak] = placePeaks(pattern, applied, [{ d, intensity: 1 }]);
      expect(peak!.tof!.gamma!).toBeGreaterThan(0);
      const half = 20 * peak!.fwhm;
      const n = 200_001;
      const xs = Array.from({ length: n }, (_, i) => peak!.center - half + (2 * half * i) / (n - 1));
      const y = synthesizePattern(xs, [peak!], { shape: "tof" });
      let area = 0;
      for (let i = 1; i < n; i++) area += 0.5 * (y[i]! + y[i - 1]!) * (xs[i]! - xs[i - 1]!);
      expect(1 - area).toBeLessThan(5e-4);
      expect(1 - area).toBeGreaterThan(0);
    }
  });
});

describe("the GSAS-II bundle of a GSAS-II file's session", () => {
  const page = pageOn(2);
  const s = page.session;
  const params = s.powderParams.map((p) => (p.id === "tofSampleLorentz" ? { ...p, value: 1400 } : p.id === "tofSampleGauss" ? { ...p, value: 300 } : p.id === "tofSampleSize" ? { ...p, value: 0.4 } : p));
  const entries = refinementBundle("gsas2", structure, s.pattern, {
    name: "si", params, bindings: s.powderBindings, instrument: page.instrument, rawInstrument: { name: "three.instprm", text: INSTPRM },
  });
  const file = (name: string): string => String(entries.find((e) => e.name === name)!.data);

  it("the .instprm is the session's bank with sig-1 and X, Y, Z as the profile uses them", () => {
    const text = file("si.instprm");
    expect(text).not.toMatch(/#Bank/);
    const value = (key: string): number => parseFloat(text.match(new RegExp(`^${key.replace(/[-.]/g, "\\$&")}:(.*)$`, "m"))![1]!);
    expect(value("difC")).toBe(3800);
    expect(value("sig-1")).toBe(-30);
    expect(value("X")).toBe(-5);
    expect(value("Y")).toBe(13);
    expect(value("Z")).toBe(0);
    expect(value("2-theta")).toBe(42);
    // And it reads back as the instrument the session has.
    const back = parseInstrumentParameters(text);
    const original = parseInstrumentParameters(INSTPRM, 2);
    expect(back).toMatchObject({ ...original });
  });

  it("the sample's rows go to each phase as GSAS-II's Mustrain with its Lorentzian fraction, and Size", () => {
    const terms = gsas2SampleTerms({ gauss: 300, lorentz: 1400, size: 0.4 });
    // 300 × 10⁻⁶ Gaussian σ is a Gaussian FWHM of 2.3548 × 300; GSAS-II's Mustrain is the two FWHM added.
    expect(terms.mustrain).toBeCloseTo(1400 + 2.3548200450309493 * 300, 9);
    expect(terms.mustrainMix).toBeCloseTo(1400 / terms.mustrain, 12);
    expect(terms.size).toBe(0.4);
    const script = file("build_gpx.py");
    expect(script).toContain(`_hap['Mustrain'][1][0] = _hap['Mustrain'][1][1] = ${Number(terms.mustrain.toPrecision(10))}`);
    expect(script).toContain(`_hap['Mustrain'][1][2] = ${Number(terms.mustrainMix.toPrecision(10))}`);
    expect(script).toContain("_hap['Size'][1][0] = _hap['Size'][1][1] = 0.4");
    expect(file("README.txt")).toMatch(/Sample broadening: build_gpx\.py sets every phase's Mustrain/);
  });

  it("the FullProf bundle of the same session carries the widths as totals and says the function is FullProf's own", () => {
    const fp = refinementBundle("fullprof", structure, s.pattern, { name: "si", params, bindings: s.powderBindings, instrument: page.instrument, rawInstrument: { name: "three.instprm", text: INSTPRM } });
    const pcr = String(fp.find((e) => e.name === "si.pcr")!.data);
    const after = (marker: string): number[] => {
      const lines = pcr.split("\n");
      const i = lines.findIndex((l) => l.includes(marker));
      return lines[i + 2]!.trim().split(/\s+/).map(Number);
    };
    // Sig-1 = −30 + (3800 · 300e-6)²; Gam-1 = X + 1e-6 · 3800 · 1400; Gam-2 = Y + 1e-4 · 3800 / 0.4.
    const sig = after("Sig-2       Sig-1       Sig-0");
    expect(sig[0]).toBeCloseTo(190, 4);
    expect(sig[1]).toBeCloseTo(-30 + (3800 * 300e-6) ** 2, 4);
    expect(sig[2]).toBeCloseTo(30, 4);
    const gam = after("Gam-2       Gam-1       Gam-0");
    expect(gam[0]).toBeCloseTo(13 + (1e-4 * 3800) / 0.4, 4);
    expect(gam[1]).toBeCloseTo(-5 + 1e-6 * 3800 * 1400, 4);
    expect(gam[2]).toBeCloseTo(0, 4);
    const readme = String(fp.find((e) => e.name === "README.txt")!.data);
    expect(readme).toContain("its Gaussian microstrain 300 (x 1e-6) in Sig-1; its Lorentzian microstrain 1400 (x 1e-6) in Gam-1; its size 0.4 um in Gam-2.");
    expect(readme).toContain("FullProf's function for the Lorentzian part is");
  });
});

/** The synthetic FullProf resolution files of scripts/tof-profile/fixtures (invented numbers). */
const IRF_A = readFileSync("scripts/tof-profile/fixtures/synthetic_a.irf", "utf8");
const IRF_B = readFileSync("scripts/tof-profile/fixtures/synthetic_b_negative_gamma.irf", "utf8");
const IRF_C = readFileSync("scripts/tof-profile/fixtures/synthetic_c_negative_variance.irf", "utf8");

/** A flat pattern over d = dLo … dHi Å on an .irf's calibration, and the page with it. */
function irfPage(text: string, dLo = 0.62, dHi = 3.3) {
  const inst = parseInstrumentParameters(text);
  if (inst.kind !== "tof") throw new Error("TOF expected");
  const tof = (d: number): number => (inst.zero ?? 0) + inst.difC * d + (inst.difA ?? 0) * d * d;
  const lo = tof(dLo), hi = tof(dHi), n = 1200;
  const pattern = { id: "p", name: "p", xUnit: "tof", radiation: { kind: "neutron-tof" }, points: Array.from({ length: n }, (_, i) => ({ x: lo * (hi / lo) ** (i / (n - 1)), yObs: 100, sigma: 10 })) } as PowderPattern;
  return withInstrument(withPattern(withStructure(emptyPage(), structure), pattern, { name: "si.dat", text: "" }), inst, { name: "bank.irf", text });
}

describe("a FullProf .irf's rows", () => {
  it("SIGMA, GAMMA and ALFBE as read, alph0 included, held; a Gaussian microstrain row at 0 and no other sample row", () => {
    const s2 = irfPage(IRF_A).session;
    const want: Record<string, number> = { tof_alpha0: 0.5, tof_alpha1: 0.53, tof_beta0: 0.052, tof_beta1: 0.0049, tof_sig0: 5, tof_sig1: 25, tof_sig2: 14, tof_gamX: 5, tof_gamY: 2.8, tof_gamZ: 2 };
    for (const [id, value] of Object.entries(want)) expect(s2.powderParams.find((p) => p.id === id), id).toMatchObject({ value, kind: "tofFileProfile", fixed: true });
    expect(s2.powderParams.find((p) => p.id === "tofSampleGauss")).toMatchObject({ value: 0, fixed: true });
    for (const id of ["tofSampleLorentz", "tofSampleSize", "mustrainIso", "tof_sigQ", "tof_betaQ"]) expect(s2.powderParams.find((p) => p.id === id), id).toBeUndefined();
    // The peak is FullProf's form, with the file's widths: at d = 1 Å, α = 1.03, β = 0.0569, σ² = 44, γ = 9.8.
    const applied = applyParameters(structure, s2.powderBindings, resolveTies(s2.powderParams, valuesOf(s2.powderParams)));
    expect(applied.tofFile!.lorentzForm).toBe("fullprof");
    const w = tofWidthsAt(applied, 1);
    expect([w.alpha, w.beta, w.sig2, w.gamma].map((v) => +v.toFixed(6))).toEqual([1.03, 0.0569, 44, 9.8]);
    const [peak] = placePeaks(s2.pattern, applied, [{ d: 1, intensity: 1 }]);
    expect(peak!.tof).toMatchObject({ lorentzForm: "fullprof", gamma: 9.8 });
  });

  it("a constant rise term above the old limit of 10 and a negative alph1 are held as read and stay inside their limits", () => {
    const s2 = irfPage(IRF_B).session;
    const alpha0 = s2.powderParams.find((p) => p.id === "tof_alpha0")!;
    const alpha1 = s2.powderParams.find((p) => p.id === "tof_alpha1")!;
    expect([alpha0.value, alpha1.value]).toEqual([13, -0.4]);
    expect(alpha0.max!).toBeGreaterThan(13);
    expect(alpha1.min!).toBeLessThan(-0.4);
  });

  it("the Instrument card: FullProf's function, not yet checked against a FullProf run, not verified for Jana", () => {
    const page2 = irfPage(IRF_A);
    const note = fileProfileNote(page2.instrument, null)!;
    expect(note.line).toBe("Profile as the file gives it, held, by FullProf's NPROF 9 function: its Lorentzian part and alph0 are not yet checked against a FullProf run, and it is not verified for Jana.");
    expect(note.detail).toContain("A resolution file written for Jana is a FullProf resolution file");
    expect(tofWidthNote(page2.session)).toBeNull();
    expect(tofNegativeGammaNote(page2.session)).toBeNull();
  });

  it("a negative Lorentzian width is taken as none, and the card says where", () => {
    const s2 = irfPage(IRF_B).session;
    const applied = applyParameters(structure, s2.powderBindings, resolveTies(s2.powderParams, valuesOf(s2.powderParams)));
    // γ = −3 d² + 7.5 d − 1 is negative above d = 2.359 Å.
    expect(tofWidthsAt(applied, 2.3).gamma).toBeGreaterThan(0);
    const w = tofWidthsAt(applied, 3);
    expect(w.gammaAsGiven).toBeCloseTo(-5.5, 9);
    expect(w.gamma).toBe(0);
    expect(w.invalid).toBeNull();
    const [peak] = placePeaks(s2.pattern, applied, [{ d: 3, intensity: 1 }]);
    expect(peak!.tof!.gamma).toBeUndefined();
    const ranges = tofNegativeLorentzian(s2.pattern, applied);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.dMin).toBeGreaterThan(2.359);
    expect(ranges[0]!.dMin).toBeLessThan(2.37);
    expect(tofNegativeGammaNote(s2)!.line).toMatch(/^The file's Lorentzian width is negative for d 2\.36–3\.30 Å: taken as none there\.$/);
    // A GSAS-II file's negative γ is its program's definition: no line.
    expect(tofNegativeGammaNote(pageOn(2).session)).toBeNull();
  });

  it("σ² ≤ 0 at both ends of the data: both ranges named, the reflections there not drawn", () => {
    const s2 = irfPage(IRF_C, 0.5, 3.3).session;
    const applied = applyParameters(structure, s2.powderBindings, resolveTies(s2.powderParams, valuesOf(s2.powderParams)));
    const problems = tofWidthProblems(s2.pattern, applied);
    // −4 d⁴ + 30 d² − 10 = 0 at d = 0.5903 and 2.6787 Å.
    expect(problems.map((p) => p.which)).toEqual(["σ²", "σ²"]);
    expect(problems[0]!.dMax).toBeLessThan(0.5904);
    expect(problems[0]!.dMax).toBeGreaterThan(0.586);
    expect(problems[1]!.dMin).toBeGreaterThan(2.6787);
    expect(problems[1]!.dMin).toBeLessThan(2.69);
    const left = tofReflectionsLeftOut(s2.pattern, applied);
    expect(left.some((r) => r.h === 1 && r.k === 1 && r.l === 1)).toBe(true);
    expect(left.every((r) => r.d < 0.5904 || r.d > 2.6787)).toBe(true);
    expect(tofWidthNote(s2)!.line).toMatch(/^The instrument file gives no peak width for d 0\.500–0\.5\d\d Å \(σ² ≤ 0\), d 2\.6\d–3\.30 Å \(σ² ≤ 0\): \d+ reflections not drawn\.$/);
  });

  it("an .irf whose ALFBE is all zero, and a calibration alone, keep the page's own profile", () => {
    const zeros = IRF_A.replace(/^ALFBE.*$/m, "ALFBE    0 0 0 0");
    expect(tofFileProfileOf(parseInstrumentParameters(zeros))).toBeNull();
    expect(tofFileProfileOf(parseInstrumentParameters("D2TOF 7300.5 -1.25\nTWOTH 140.0\n"))).toBeNull();
  });
});

describe("the bundles of a FullProf file's session", () => {
  const page2 = irfPage(IRF_A);
  const s2 = page2.session;
  const params = s2.powderParams.map((p) => (p.id === "tofSampleGauss" ? { ...p, value: 500 } : p));
  const opts = { name: "si", params, bindings: s2.powderBindings, instrument: page2.instrument, rawInstrument: { name: "bank.irf", text: IRF_A } };

  it("FullProf: the .pcr holds the .irf's lines as the fit used them, the Gaussian microstrain in Sig-1", () => {
    const fp = refinementBundle("fullprof", structure, s2.pattern, opts);
    const pcr = String(fp.find((e) => e.name === "si.pcr")!.data);
    const after = (marker: string): number[] => {
      const lines = pcr.split("\n");
      const i = lines.findIndex((l) => l.includes(marker));
      return lines[i + 2]!.trim().split(/\s+/).map(Number);
    };
    const sig = after("Sig-2       Sig-1       Sig-0");
    expect([sig[0], sig[2]]).toEqual([14, 5]);
    expect(sig[1]).toBeCloseTo(25 + (3800 * 500e-6) ** 2, 4);
    expect(after("Gam-2       Gam-1       Gam-0").slice(0, 3)).toEqual([2.8, 5, 2]);
    const alf = after("Pref1      Pref2        alph0       beta0       alph1       beta1");
    expect(alf.slice(2, 6)).toEqual([0.5, 0.052, 0.53, 0.0049]);
    expect(fp.some((e) => e.name === "bank.irf" && String(e.data) === IRF_A)).toBe(true);
    const readme = String(fp.find((e) => e.name === "README.txt")!.data);
    expect(readme).toContain("is not yet checked against a FullProf run");
    expect(readme).toContain("its Gaussian microstrain 500 (x 1e-6) in Sig-1.");
  });

  it("GSAS-II: the widths under GSAS-II's names, alph0 named as not carried, the function named as GSAS-II's own", () => {
    const g2 = refinementBundle("gsas2", structure, s2.pattern, opts);
    const text = String(g2.find((e) => e.name === "si.instprm")!.data);
    const value = (key: string): number => parseFloat(text.match(new RegExp(`^${key.replace(/[-.]/g, "\\$&")}:(.*)$`, "m"))![1]!);
    expect([value("sig-0"), value("sig-1"), value("sig-2"), value("X"), value("Y"), value("Z"), value("alpha"), value("beta-0"), value("beta-1")]).toEqual([5, 25, 14, 5, 2.8, 2, 0.53, 0.052, 0.0049]);
    const readme = String(g2.find((e) => e.name === "README.txt")!.data);
    expect(readme).toContain("α₀ = 0.5 (constant rise-time term) has no GSAS-II key");
    expect(readme).toContain("GSAS-II's function for the Lorentzian part is its own");
    // The Gaussian microstrain as GSAS-II's Mustrain with no Lorentzian share, and no size term.
    const script = String(g2.find((e) => e.name === "build_gpx.py")!.data);
    expect(script).toContain(`_hap['Mustrain'][1][0] = _hap['Mustrain'][1][1] = ${Number((2.3548200450309493 * 500).toPrecision(10))}`);
    expect(script).toContain("_hap['Mustrain'][1][2] = 0");
    expect(script).toContain("_hap['Size'][1][0] = _hap['Size'][1][1] = 1000000");
  });
});

describe("a session with no profile in its instrument is unchanged", () => {
  it("the bundled POWGEN demo has today's rows and no new kind", () => {
    const session = bundledSession(mn3gaPowgenExample());
    expect(session.powderParams.some((p) => p.kind === "tofFileProfile" || p.kind.startsWith("tofSample"))).toBe(false);
    expect(session.powderParams.find((p) => p.id === "mustrainIso")).toBeDefined();
    expect(session.powderParams.find((p) => p.id === "tof_sig1")).toBeUndefined();
    const applied = applyParameters(session.structure, session.powderBindings, resolveTies(session.powderParams, valuesOf(session.powderParams)));
    expect(applied.tofFile).toBeUndefined();
    expect(() => tofWidthsAt({ ...applied, tofFile: { gamX: 0, gamY: 0, gamZ: 0, lorentzForm: "gsas", sampleGauss: 0, sampleLorentz: 0 } }, 1)).not.toThrow();
  });
});
