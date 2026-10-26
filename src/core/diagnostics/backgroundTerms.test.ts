import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import type { PowderPattern } from "@/core/diffraction/types";
import { estimateBackground, type BackgroundType } from "@/core/diffraction/background";
import { buildPowderSpec } from "@/app/powderSpec";
import { buildPowderProblem, powderCurves } from "@/core/workflow/powder";
import { refine } from "@/core/refinement/engine";
import { backgroundPoints, backgroundTermsReading, unexplainedExcess, type BackgroundPointsInput } from "@/core/diagnostics/backgroundTerms";
import { diagnoseFit } from "@/core/diagnostics/fitDiagnosis";
import { loadedSession } from "@/app/powderSession";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { exampleStructure } from "@/examples/mn3ga";
import type { InstrumentParameters } from "@/core/diffraction/instrument";

/**
 * A background must not absorb a peak the model lacks. On the POWGEN 350 K
 * Mn₃Ga grid (examples/mn3ga-350k: TOF 3 390–135 207 µs, the bank's
 * calibration and the nuclear model) a pattern is simulated from the nuclear
 * peaks, a smooth background b(t) = 30 + 25·e^(−t/25000) + 4·ln(t/3000) and
 * one Gaussian line no phase has, with Poisson-like noise (σ = √μ); the model
 * fitted to it is the nuclear one, its scale and background refined. The
 * intensity the background takes is the refined background with the line
 * minus the one without it (same noise draw), over ±3σ of the line, as a
 * fraction of the line's own.
 */

const DIR = resolve(__dirname, "../../../examples/mn3ga-350k");
const text = (name: string): string => readFileSync(resolve(DIR, name), "utf8");
const instrument = parseInstrumentParameters(text("PG3_45598_Bank1.instprm"));
const grid = parseGsasHistogramPattern(text("PG3_45598_Bank1.fxye"), "pg3", "PG3_45598_Bank1.fxye", { radiation: { kind: "neutron-tof" } });
const structure = parseCif(text("Mn3Ga_350K_nuclear.cif"), "mn3ga");
const difC = instrument.kind === "tof" ? instrument.difC : NaN;
const xs = grid.points.map((p) => p.x);
const step = xs.map((x, i) => (i + 1 < xs.length ? xs[i + 1]! - x : x - xs[i - 1]!));
const dOf = xs.map((x) => x / difC);
const scale0 = buildPowderSpec(structure, grid, instrument, true, 1).params.find((p) => p.kind === "scale")!.value;
const nuclear = (() => {
  const spec = buildPowderSpec(structure, grid, instrument, true, 1);
  const params = spec.params.map((p) => (p.kind === "background" ? { ...p, value: 0 } : p));
  return powderCurves(structure, grid, params, spec.bindings, spec.profile).yCalc;
})();
const bTrue = (t: number): number => 30 + 25 * Math.exp(-t / 25000) + 4 * Math.log(t / 3000);

interface Line { readonly d: number; readonly fwhm: number; readonly height: number }
/** A line no phase has: at d (Å), FWHM a fraction of its TOF, height in counts (before `counts`). */
const lineAt = (l: Line) => (t: number): number => {
  const t0 = difC * l.d, s = (l.fwhm * t0) / 2.3548;
  return l.height * Math.exp(-0.5 * ((t - t0) / s) ** 2);
};
const BROAD_LONG: Line = { d: 5.3, fwhm: 0.03, height: 30 };
const LINES: readonly Line[] = [{ d: 5.3, fwhm: 0.006, height: 30 }, BROAD_LONG, { d: 2.9, fwhm: 0.006, height: 60 }, { d: 2.9, fwhm: 0.03, height: 30 }];

function noise(seed: number): () => number {
  let a = seed >>> 0;
  const u = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** The pattern: `counts` × (nuclear + background + line), with noise of the seed. */
function simulate(line: ((t: number) => number) | null, seed: number, counts = 1): { pattern: PowderPattern; truth: number[] } {
  const z = noise(seed);
  const truth = xs.map((t, i) => counts * (nuclear[i]! + bTrue(t) + (line ? line(t) : 0)));
  return { pattern: { ...grid, points: xs.map((t, i) => ({ x: t, yObs: truth[i]! + Math.sqrt(truth[i]!) * z(), sigma: Math.sqrt(truth[i]!) })) }, truth };
}

/** Scale and background refined on the nuclear model, the rest held at their true values. */
function fit(pattern: PowderPattern, type: BackgroundType, terms: number, counts = 1) {
  const spec = buildPowderSpec(structure, pattern, instrument, true, terms);
  const seeds = estimateBackground(xs, pattern.points.map((p) => p.yObs), type, terms);
  let k = 0;
  const params = spec.params.map((p) => (p.kind === "background" ? { ...p, value: seeds[k++]!, fixed: false } : p.kind === "scale" ? { ...p, value: counts * scale0, fixed: false } : { ...p, fixed: true }));
  const profile = { ...spec.profile, backgroundType: type };
  const result = refine(buildPowderProblem(structure, pattern, params, spec.bindings, profile), { maxIterations: 60 });
  const fitted = params.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
  const curves = powderCurves(structure, pattern, fitted, spec.bindings, profile);
  const input: BackgroundPointsInput = { x: curves.x, yObs: curves.yObs, yCalc: curves.yCalc, yBackground: curves.yBackground!, sigma: pattern.points.map((p) => p.sigma!), include: xs.map(() => true), d: dOf };
  return { result, fitted, spec, profile, curves, input };
}

/** The fraction of the line's intensity the background takes (paired with the same noise without the line). */
function absorbed(line: Line, type: BackgroundType, terms: number, seed = 7): number {
  const f = lineAt(line);
  const t0 = difC * line.d, s = (line.fwhm * t0) / 2.3548;
  const a = fit(simulate(f, seed).pattern, type, terms).curves.yBackground!;
  const b = fit(simulate(null, seed).pattern, type, terms).curves.yBackground!;
  let taken = 0, area = 0;
  xs.forEach((t, i) => {
    if (Math.abs(t - t0) > 3 * s) return;
    taken += (a[i]! - b[i]!) * step[i]!;
    area += f(t) * step[i]!;
  });
  return taken / area;
}

describe("the risk: a flexible background takes a line the model lacks", () => {
  it("takes more of a broad line at long d the more Chebyshev terms it has", () => {
    // Measured (seed 7): 4 terms 17.7 %, 12 terms 61.6 %, 24 terms 96.9 %.
    const taken = [4, 12, 24].map((n) => absorbed(BROAD_LONG, "chebyshev", n));
    expect(taken[0]!).toBeLessThan(taken[1]!);
    expect(taken[1]!).toBeLessThan(taken[2]!);
    expect(taken[0]!).toBeLessThan(0.25);
    expect(taken[2]!).toBeGreaterThan(0.8);
  });

  it("an information criterion over every point the model leaves to the background asks for the terms that take it", () => {
    const { input } = fit(simulate(lineAt(BROAD_LONG), 7).pattern, "chebyshev", 4);
    const nothingTakenOut = { features: [], mask: xs.map(() => false) };
    const naive = backgroundTermsReading({ ...input, type: "chebyshev" }, backgroundPoints(input), nothingTakenOut)!;
    const guarded = backgroundTermsReading({ ...input, type: "chebyshev" })!;
    // Measured: 16 against 4; at 16 terms the background takes 79 % of the line.
    expect(naive.justified).toBeGreaterThanOrEqual(12);
    expect(guarded.justified).toBeLessThanOrEqual(6);
  });
});

describe("the excess no reflection explains", () => {
  it.each(LINES.flatMap((l) => (["chebyshev", "logInterpolate"] as const).map((type) => [l, type] as const)))("finds the line %o on %s and leaves the count where the line-free pattern puts it", (line, type) => {
    const terms = type === "chebyshev" ? 4 : 3;
    const withLine = fit(simulate(lineAt(line), 7).pattern, type, terms).input;
    const without = fit(simulate(null, 7).pattern, type, terms).input;
    const excess = unexplainedExcess(withLine, backgroundPoints(withLine));
    expect(excess.features.length).toBe(1);
    expect(Math.abs(excess.features[0]!.d - line.d) / line.d).toBeLessThan(0.01);
    expect(unexplainedExcess(without, backgroundPoints(without)).features).toEqual([]);
    // The line itself does not move the count: the line-free pattern read on
    // the same points justifies the same number of terms.
    const reading = backgroundTermsReading({ ...withLine, type }, backgroundPoints(withLine), excess)!;
    const control = backgroundTermsReading({ ...without, type }, backgroundPoints(withLine), excess)!;
    expect(reading.justified).toBe(control.justified);
    expect(reading.excess).toHaveLength(1);
  });

  it("raises no false alarm on a correct model, over 50 noise draws (designed: 1 % per pattern)", () => {
    let alarms = 0;
    for (let seed = 100; seed < 150; seed++) {
      const { pattern, truth } = simulate(null, seed);
      const input: BackgroundPointsInput = {
        x: xs, yObs: pattern.points.map((p) => p.yObs), yCalc: truth, yBackground: xs.map(bTrue),
        sigma: pattern.points.map((p) => p.sigma!), include: xs.map(() => true), d: dOf,
      };
      if (unexplainedExcess(input, backgroundPoints(input)).features.length > 0) alarms++;
    }
    // Binomial(50, 0.01): P(≥ 3) = 1.4 %.
    expect(alarms).toBeLessThanOrEqual(2);
  });

  it("reads a 2θ axis, whose d runs the other way, the same", () => {
    const D1A: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 1.909, zero: 0, u: 1963, v: -4217, w: 3613, x: 0, y: 0 };
    const cw = exampleStructure();
    const cwGrid: PowderPattern = { id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 1.909 }, wavelength: 1.909, points: Array.from({ length: 2800 }, (_, i) => ({ x: 10 + i * 0.05, yObs: 0 })) };
    const spec = buildPowderSpec(cw, cwGrid, D1A, true, 1);
    const peaks = powderCurves(cw, cwGrid, spec.params.map((p) => (p.kind === "background" ? { ...p, value: 0 } : p.kind === "scale" ? { ...p, value: 1 } : p)), spec.bindings, spec.profile).yCalc;
    const k = 20000 / Math.max(...peaks);
    const tth = cwGrid.points.map((p) => p.x);
    const d = tth.map((t) => 1.909 / (2 * Math.sin((t * Math.PI) / 360)));
    // A gap between the model's lines, by its calculated curve: the lowest point past 30°.
    let at = tth.findIndex((t) => t > 30);
    for (let i = at; i < tth.length && tth[i]! < 80; i++) if (peaks[i]! < peaks[at]!) at = i;
    const extra = (t: number): number => 300 * Math.exp(-0.5 * ((t - tth[at]!) / 0.15) ** 2);
    const z = noise(3);
    const truth = tth.map((t, i) => k * peaks[i]! + 200 + extra(t));
    const input: BackgroundPointsInput = {
      x: tth, yObs: truth.map((y) => y + Math.sqrt(y) * z()), yCalc: tth.map((_, i) => k * peaks[i]! + 200), yBackground: tth.map(() => 200),
      sigma: truth.map((y) => Math.sqrt(y)), include: tth.map(() => true), d,
    };
    const found = unexplainedExcess(input, backgroundPoints(input)).features;
    expect(found).toHaveLength(1);
    expect(Math.abs(found[0]!.x - tth[at]!)).toBeLessThan(0.1);
  });
});

describe("diagnose_fit and set_background on a line the model lacks", () => {
  const diagnosis = (input: BackgroundPointsInput, type: BackgroundType, terms: number) =>
    diagnoseFit({ ...input, nParams: terms + 1, reflections: [], phases: [structure], twoTheta: false, xOf: (d) => d * difC, background: { type, terms } });

  it("names the line, and does not ask for the terms that would take it (20× the counts)", () => {
    const withLine = fit(simulate(lineAt(BROAD_LONG), 7, 20).pattern, "chebyshev", 4, 20).input;
    const dx = diagnosis(withLine, "chebyshev", 4);
    const line = dx.causes.find((c) => c.id === "unexplained-peak");
    expect(line?.evidence).toMatch(/d = 5\.(2|3)\d\d Å/);
    expect(line?.action).toMatch(/Not background/);
    // Before the change the line's χ², read as the background's, gave "The
    // background function misses: more terms or another basis" here (between
    // the peaks 2.97 χ² per point, 90 % of χ²). Left out, the rest is noise.
    expect(dx.causes.some((c) => c.id === "background")).toBe(false);
    expect(dx.betweenPeaks!.chi2PerPoint).toBeLessThan(2);
    // The count read with the line left out is below what every point the
    // model leaves to the background would ask for.
    const naive = backgroundTermsReading({ ...withLine, type: "chebyshev" }, backgroundPoints(withLine), { features: [], mask: xs.map(() => false) })!.justified;
    expect(dx.backgroundTerms!.justified).toBeLessThan(naive);
  });

  it("on a neutron pattern of magnetic ions, routes the line to the magnetic step's k-search", () => {
    const input = fit(simulate(lineAt(BROAD_LONG), 7, 20).pattern, "chebyshev", 4, 20).input;
    const magnetic = diagnoseFit({ ...input, nParams: 5, reflections: [], phases: [structure], twoTheta: false, xOf: (d) => d * difC, background: { type: "chebyshev", terms: 4 }, magneticNeutron: { k0: false } });
    expect(magnetic.causes.find((c) => c.id === "unexplained-peak")?.action).toMatch(/give the lines to the magnetic step first \(magnetic_state, search_propagation_vector\)/);
    expect(diagnosis(input, "chebyshev", 4).causes.find((c) => c.id === "unexplained-peak")?.action).not.toMatch(/search_propagation_vector/);
  });

  it("with a line and a background that misses too, asks for the line to be explained before a count", () => {
    const dx = diagnosis(fit(simulate(lineAt(BROAD_LONG), 7, 20).pattern, "chebyshev", 1, 20).input, "chebyshev", 1);
    expect(dx.causes.some((c) => c.id === "unexplained-peak")).toBe(true);
    const background = dx.causes.find((c) => c.id === "background")!;
    expect(background.evidence).toMatch(/the unexplained excess left out/);
    expect(background.action).toMatch(/explain them first/);
    expect(background.action).not.toMatch(/set_background terms/);
  });

  it("still asks for more terms where the background itself misses, with the count its points justify", () => {
    const input = fit(simulate(null, 7, 20).pattern, "chebyshev", 1, 20).input;
    const dx = diagnosis(input, "chebyshev", 1);
    const background = dx.causes.find((c) => c.id === "background");
    expect(background).toBeDefined();
    const n = dx.backgroundTerms!.justified;
    expect(n).toBeGreaterThan(1);
    expect(background!.action).toContain(`set_background terms ${n}`);
    expect(dx.causes.some((c) => c.id === "unexplained-peak")).toBe(false);
  });

  it("set_background warns, on the card, that more terms would take the line", async () => {
    const { pattern } = simulate(lineAt(BROAD_LONG), 7);
    const f = fit(pattern, "chebyshev", 4);
    const s = loadedSession(structure, pattern, instrument, [], Object.fromEntries(f.fitted.map((p) => [p.id, p.value])), 4);
    const { port } = sessionPort(s, instrument, { instrumentOnPage: true });
    const { ex, asked } = executor(fakeHost(port).host, "auto");
    await ex.run("set_background", { terms: 16 });
    expect(asked.at(-1)!.preview).toMatch(/^Background terms 4 → 16 · Caution: more terms can absorb the excess between the lines that no reflection explains, at d = 5\.\d{3} Å/);
    expect(asked.at(-1)!.preview).toMatch(/justify \d \(BIC, the excess left out\)/);
  });
});
