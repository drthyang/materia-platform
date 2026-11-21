import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import { ModelDomainError, type RefinementParameter } from "@/core/refinement/types";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { buildPowderSpec, tofFileProfileOf } from "@/app/powderSpec";
import { emptyPage, withFixed, withInstrument, withPattern, withStructure } from "@/app/powderPage";
import { fileProfileNote, tofWidthNote } from "@/app/tofWidthNote";
import { applyParameters } from "@/core/workflow/apply";
import { resolveTies } from "@/core/refinement/constraints";
import { buildPowderProblem, placePeaks, tofReflectionsLeftOut, tofWidthProblems, tofWidthsAt } from "@/core/workflow/powder";
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

  it("the FullProf bundle of the same session names what it does not carry", () => {
    const fp = refinementBundle("fullprof", structure, s.pattern, { name: "si", params, bindings: s.powderBindings, instrument: page.instrument, rawInstrument: { name: "three.instprm", text: INSTPRM } });
    const readme = String(fp.find((e) => e.name === "README.txt")!.data);
    expect(readme).toMatch(/Not carried: the Lorentzian X = -5; the Lorentzian Y = 13; beta-q = 0\.2; the sample's Lorentzian microstrain 1400 \(x 1e-6\); the sample's size 0\.4 um; the sample's Gaussian microstrain 300 \(x 1e-6\)\./);
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
