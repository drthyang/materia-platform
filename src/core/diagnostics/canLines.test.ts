import { describe, it, expect } from "vitest";
import {
  AL_EXPANSION,
  V_EXPANSION,
  canLines,
  canOverlaps,
  expansionScale,
  observedPeakApexes,
  observedReading,
  profileAt,
  sampleReading,
  scaleShift,
  type CanLineContext,
} from "@/core/diagnostics/canLines";
import { knownPhaseStructure } from "@/core/diagnostics/knownPhases";
import { applyParameters } from "@/core/workflow/apply";
import { reflectionDRange } from "@/core/workflow/powder";
import type { PowderPattern } from "@/core/diffraction/types";
import { canPhaseTicks } from "@/visualization/canTicks";
import { convertAxisValue } from "@/visualization/axisUnits";

/**
 * The can lines checked against calculations written here, not the engine's:
 * d = a/√(h²+k²+l²) with the cubic reflection conditions (fcc: h, k, l all
 * odd or all even; bcc: h + k + l even), 2θ = 2 asin(λ/2d), t = difC·d.
 */

const A_AL = 4.0495;
const A_V = 3.024;
const LAMBDA = 1.5;
const DIFC = 5000;

const fcc = (h: number, k: number, l: number): boolean => (h % 2 === 0) === (k % 2 === 0) && (k % 2 === 0) === (l % 2 === 0);
const bcc = (h: number, k: number, l: number): boolean => (h + k + l) % 2 === 0;

/** The distinct d-spacings of a cubic cell under a reflection condition, within [dMin, dMax]. */
function independentDs(a: number, allowed: (h: number, k: number, l: number) => boolean, dMin: number, dMax: number): number[] {
  const out = new Set<number>();
  const n = Math.ceil(a / dMin) + 1;
  for (let h = 0; h <= n; h++) for (let k = 0; k <= h; k++) for (let l = 0; l <= k; l++) {
    if (h + k + l === 0 || !allowed(h, k, l)) continue;
    const d = a / Math.sqrt(h * h + k * k + l * l);
    if (d >= dMin && d <= dMax) out.add(Number(d.toFixed(9)));
  }
  return [...out].sort((x, y) => y - x);
}

/** Multiplicity of a cubic (m-3m) family, by counting the distinct signed permutations. */
function multiplicity(h: number, k: number, l: number): number {
  const seen = new Set<string>();
  const perms = [[h, k, l], [h, l, k], [k, h, l], [k, l, h], [l, h, k], [l, k, h]];
  for (const [a, b, c] of perms) for (const sa of [1, -1]) for (const sb of [1, -1]) for (const sc of [1, -1]) seen.add(`${sa * a!},${sb * b!},${sc * c!}`);
  return seen.size;
}

const sample = knownPhaseStructure("Si")!;
const base = applyParameters(sample, [], {});

function cwContext(w = 100): CanLineContext {
  const points = [];
  for (let x = 10; x <= 150; x += 0.01) points.push({ x, yObs: 1 });
  const pattern: PowderPattern = { id: "cw", name: "cw", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: LAMBDA }, points };
  return { pattern, applied: { ...base, caglioti: { u: 0, v: 0, w }, zeroShift: 0 }, options: { shape: "gaussian" }, applyLorentz: true };
}

function tofContext(): CanLineContext {
  const points = [];
  for (let x = 3000; x <= 15000; x *= 1.0005) points.push({ x, yObs: 1 });
  const pattern: PowderPattern = { id: "tof", name: "tof", xUnit: "tof", radiation: { kind: "neutron-tof" }, points };
  return {
    pattern,
    applied: {
      ...base,
      zeroShift: 0,
      tof: { difC: DIFC, difA: 0, difB: 0 },
      tofProfile: { alpha0: 0, alpha1: 0.5, beta0: 0.03, beta1: 0.004, betaQ: 0, sig0: 0, sig1: 40, sig2: 0, sigQ: 0 },
    },
    options: { shape: "tof" },
    applyLorentz: true,
  };
}

const twoTheta = (d: number): number => (2 * Math.asin(LAMBDA / (2 * d)) * 180) / Math.PI;
const dOfTwoTheta = (tt: number): number => LAMBDA / (2 * Math.sin((tt * Math.PI) / 360));

describe("can lines: positions against an independent d-spacing calculation", () => {
  for (const [name, ctx, toX] of [
    ["constant wavelength (λ 1.5 Å)", cwContext(), (d: number) => twoTheta(d)],
    ["time of flight (difC 5000)", tofContext(), (d: number) => DIFC * d],
  ] as const) {
    for (const scale of [1, 0.9958]) {
      it(`${name}, d × ${scale}: every V and Al line, and only those, at a/√N × the scale`, () => {
        const { dMin, dMax } = reflectionDRange(ctx.pattern, ctx.applied);
        const phases = canLines(ctx, { V: scale, Al: scale });
        expect(phases.map((p) => p.can.phase)).toEqual(["V", "Al"]);
        for (const p of phases) {
          const [a, rule] = p.can.phase === "Al" ? [A_AL, fcc] : [A_V, bcc];
          const want = independentDs(a * scale, rule, dMin, dMax);
          const got = [...new Set(p.lines.map((l) => Number(l.d.toFixed(9))))].sort((x, y) => y - x);
          expect(got.length).toBeGreaterThan(5);
          expect(got).toEqual(want);
          for (const l of p.lines) expect(l.d293 * scale).toBeCloseTo(l.d, 12);
          // The plot's ticks at the display unit's position of each d.
          const axis = ctx.pattern.xUnit === "tof"
            ? { native: "tof" as const, tof: { difC: DIFC, difA: 0, difB: 0, zero: 0 } }
            : { native: "twoTheta" as const, wavelength: LAMBDA, zero: 0 };
          const ticks = canPhaseTicks([p], (d) => convertAxisValue(d, "dSpacing", ctx.pattern.xUnit, axis))[0]!;
          expect(ticks.ticks).toHaveLength(p.lines.length);
          ticks.ticks.forEach((t, i) => expect(t.x).toBeCloseTo(toX(p.lines[i]!.d), 8));
          for (const l of p.lines) {
            if (ctx.pattern.xUnit === "twoTheta") {
              // A symmetric Gaussian peaks at its Bragg angle.
              expect(l.x).toBeCloseTo(twoTheta(l.d), 8);
            } else {
              // A back-to-back exponential peaks just past t = difC·d, within its width.
              expect(Math.abs(l.x - DIFC * l.d)).toBeLessThan(0.5 * l.fwhm);
            }
          }
        }
      });
    }
  }

  it("the FWHM is the profile's: a Gaussian's Caglioti width at the line", () => {
    const ctx = cwContext(400); // W 400 centideg² → 0.2°
    const prof = profileAt(ctx, 2.338)!;
    expect(prof.fwhm).toBeCloseTo(0.2, 9);
    expect(prof.x).toBeCloseTo(twoTheta(2.338), 9);
  });
});

describe("can lines: the overlap table", () => {
  const ctx = cwContext();
  const phases = canLines(ctx);
  const al = phases.find((p) => p.can.phase === "Al")!;
  const line = (hkl: string) => al.lines.find((l) => l.hkl === hkl)!;
  const l111 = line("1 1 1");
  const l200 = line("2 0 0");
  const l220 = line("2 2 0");

  it("lists sample reflections 0.5 and 1 FWHM from a can line, not one 2 FWHM away, with the separations", () => {
    const planted = [0.5, 1, 2].map((k, i) => ({ d: dOfTwoTheta(l111.x + k * l111.fwhm), hkl: `${i + 1} 0 0`, phase: "S" }));
    const out = canOverlaps(ctx, phases, planted, []);
    const at111 = out.sample.filter((o) => o.line === l111);
    expect(at111.map((o) => o.reflection.hkl)).toEqual(["1 0 0", "2 0 0"]);
    expect(at111.map((o) => o.separation.toFixed(2))).toEqual(["0.50", "1.00"]);
    expect(out.sample.every((o) => o.reflection.hkl !== "3 0 0")).toBe(true);
    expect(sampleReading(at111[0]!)).toBe(`The Al 111 line at ${l111.d.toFixed(3)} Å sits under the sample's 100 (S, ${planted[0]!.d.toFixed(3)} Å): its intensity may include the can.`);
    expect(sampleReading(at111[1]!)).toContain("overlaps the sample's 200");
  });

  it("finds observed peaks 0.5 and 1 FWHM from can lines on a synthetic pattern, not one 2 FWHM away", () => {
    // Gaussian peaks (FWHM 0.1°) at 0.5 FWHM above Al 111, 1 FWHM below Al 200, 2 FWHM above Al 220.
    const centres = [l111.x + 0.5 * l111.fwhm, l200.x - l200.fwhm, l220.x + 2 * l220.fwhm];
    const x = ctx.pattern.points.map((p) => p.x);
    const g = 4 * Math.LN2 / (0.1 * 0.1);
    const y = x.map((xv) => 5 + centres.reduce((s, c) => s + 1000 * Math.exp(-g * (xv - c) * (xv - c)), 0));
    const sigma = y.map((v) => Math.sqrt(v));
    const d = x.map(dOfTwoTheta);
    const peaks = observedPeakApexes(x, y, sigma, d);
    expect(peaks).toHaveLength(3);
    peaks.forEach((p, i) => expect(p.x).toBeCloseTo(centres[i]!, 4));
    const sampleNear200 = [{ d: l200.d, hkl: "4 0 0", phase: "S" }];
    const out = canOverlaps(ctx, phases, sampleNear200, peaks);
    expect(out.observed.map((o) => [o.line.hkl, o.separation.toFixed(2)])).toEqual([["1 1 1", "0.50"], ["2 0 0", "1.00"]]);
    expect(observedReading(out.observed[0]!)).toBe(`The observed peak at ${peaks[0]!.d!.toFixed(3)} Å is 0.50 FWHM from the Al 111 line, with no sample reflection within 1 FWHM: it may be the can's.`);
    // The sample's 400 sits on Al 200, 1 FWHM from the peak: on it.
    expect(observedReading(out.observed[1]!)).toContain("and on the sample's 400: part of it may be the can's.");
  });
});

describe("can lines: the cooled d-scale", () => {
  it("is 1 + ΔL/L₂₉₃ of the cited tables at their rows (TPRC vol. 12, Tables 1R and 60R)", () => {
    expect(expansionScale(AL_EXPANSION, 293)).toBe(1);
    expect(expansionScale(AL_EXPANSION, 100)).toBeCloseTo(1 - 0.00371, 12);
    expect(expansionScale(AL_EXPANSION, 200)).toBeCloseTo(1 - 0.00203, 12);
    expect(expansionScale(AL_EXPANSION, 50)).toBeCloseTo(1 - 0.00413, 12);
    expect(expansionScale(AL_EXPANSION, 500)).toBeCloseTo(1 + 0.00514, 12);
    expect(expansionScale(V_EXPANSION, 100)).toBeCloseTo(1 - 0.00136, 12);
    expect(expansionScale(V_EXPANSION, 200)).toBeCloseTo(1 - 0.00072, 12);
    expect(expansionScale(V_EXPANSION, 25)).toBeCloseTo(1 - 0.00155, 12);
    // Below the first row (5 K) the contraction no longer changes; past the last row there is no value.
    expect(expansionScale(AL_EXPANSION, 1.5)).toBeCloseTo(1 - 0.00418, 12);
    expect(expansionScale(AL_EXPANSION, 1000)).toBeNull();
    expect(expansionScale(V_EXPANSION, 2100)).toBeNull();
  });

  it("between the rows, follows the table's slope: Al against NBS Monograph 29 (Corruccini & Gniewek 1961)", () => {
    // Monograph 29, Table 2.1, Al: 10⁵(L₂₉₃ − L_T)/L₂₉₃ = 381 (90 K), 312 (140 K), 240 (180 K), 118 (240 K), 45 (273 K).
    for (const [T, c] of [[90, 381], [140, 312], [180, 240], [240, 118], [273, 45]] as const) {
      expect(Math.abs(expansionScale(AL_EXPANSION, T)! - (1 - c * 1e-5))).toBeLessThan(4e-5);
    }
    // Monotonic over the range, as α ≥ 0.
    let last = 0;
    for (let T = 5; T <= 900; T += 5) {
      const s = expansionScale(AL_EXPANSION, T)!;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it("states the shift in FWHM at the strongest line", () => {
    const ctx = cwContext();
    const [v, al] = canLines(ctx, { Al: expansionScale(AL_EXPANSION, 10)!, V: expansionScale(V_EXPANSION, 10)! });
    const shiftAl = scaleShift(ctx, al!, al!.scale)!;
    const shiftV = scaleShift(ctx, v!, v!.scale)!;
    // At the strongest line in the range.
    const top = (p: typeof al) => p!.lines.find((l) => l.relative === 1)!;
    expect(shiftAl.hkl).toBe(top(al).hkl);
    expect(shiftV.hkl).toBe(top(v).hkl);
    // A smaller d is a larger angle on constant wavelength: positive.
    expect(shiftAl.fwhm).toBeGreaterThan(0);
    const want = (twoTheta(top(al).d) - twoTheta(top(al).d293)) / 0.1; // FWHM 0.1° (W 100 centideg²)
    expect(shiftAl.fwhm).toBeCloseTo(want, 6);
    expect(shiftV.fwhm).toBeCloseTo((twoTheta(top(v).d) - twoTheta(top(v).d293)) / 0.1, 6);
  });
});

describe("can lines: V against Al intensities", () => {
  it("per atom, V's lines are b²(V)/b²(Al) = 0.0123 of Al's (time of flight: I = m·d⁴·|F|²)", () => {
    const ctx = tofContext();
    const [v, al] = canLines(ctx);
    const B = 8 * Math.PI * Math.PI * 0.006;
    const perAtom = (p: typeof v, atoms: number): number[] => p!.lines.map((l) => {
      const [h, k, ll] = l.hkl.split(" ").map(Number) as [number, number, number];
      const dw = Math.exp(-B / (2 * l.d * l.d));
      return l.intensity / (multiplicity(h, k, ll) * l.d ** 4 * dw * atoms * atoms);
    });
    const pv = perAtom(v, 2);
    const pal = perAtom(al, 4);
    // Within a phase the per-atom value is one number (b²), line after line.
    for (const x of pv) expect(x / pv[0]!).toBeCloseTo(1, 9);
    for (const x of pal) expect(x / pal[0]!).toBeCloseTo(1, 9);
    expect(pv[0]! / pal[0]!).toBeCloseTo((0.3824 / 3.449) ** 2, 9);
    // On the plot: V's strongest line, per unit volume of metal, is a few percent of Al's.
    const vTop = Math.max(...v!.lines.map((l) => l.height));
    expect(vTop).toBeLessThan(0.05);
    expect(Math.max(...al!.lines.map((l) => l.height))).toBe(1);
    // Within each phase the strongest line is 1.
    expect(Math.max(...v!.lines.map((l) => l.relative))).toBe(1);
  });
});
