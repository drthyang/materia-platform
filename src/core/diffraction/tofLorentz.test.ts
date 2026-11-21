import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { erfc, erfcxNonneg, imExpE1, tchPseudoVoigt, tofBackToBack, type TofLorentzForm, type TofShape } from "@/core/diffraction/profile";

/**
 * The time-of-flight peak with a Lorentzian width, against values computed at
 * 40 digits (scripts/tof-profile/make_reference.py, mpmath) for the same
 * construction, against GSAS-II's own compiled routine at the same points, and
 * against what must hold analytically (unit area, first moment, γ → 0).
 */
interface ReferenceRow {
  alpha: number; beta: number; sigma: number; gamma: number;
  dt: number[]; gsas: number[]; fullprof: number[]; gsas2Routine?: number[];
}
const REFERENCE = JSON.parse(readFileSync(fileURLToPath(new URL("./tofProfileReference.json", import.meta.url)), "utf8")) as {
  e1: [number, number, number][];
  peaks: ReferenceRow[];
};

/** Today's Gaussian form, copied as it stood before the Lorentzian part was added. */
function gaussianFormAsItWas(delta: number, shape: TofShape): number {
  const alpha = Math.max(shape.alpha, 1e-9);
  const beta = Math.max(shape.beta, 1e-9);
  const sigma = Math.max(shape.sigma, 1e-6);
  const s2 = sigma * sigma;
  const norm = (alpha * beta) / (2 * (alpha + beta));
  const gauss = Math.exp(-(delta * delta) / (2 * s2));
  const inv = 1 / (sigma * Math.SQRT2);
  const y = (alpha * s2 + delta) * inv;
  const z = (beta * s2 - delta) * inv;
  const termA = y >= 0 ? gauss * erfcxNonneg(y) : Math.exp(0.5 * alpha * (alpha * s2 + 2 * delta)) * erfc(y);
  const termB = z >= 0 ? gauss * erfcxNonneg(z) : Math.exp(0.5 * beta * (beta * s2 - 2 * delta)) * erfc(z);
  return norm * (termA + termB);
}

/** ∫ f over [−X, X] (X = ∞ when omitted) by Δ = c·tan θ and the midpoint rule (no end point, where the map is singular). */
function integrate(f: (delta: number) => number, c: number, X?: number, n = 400_000): number {
  const thetaMax = X === undefined ? Math.PI / 2 : Math.atan(X / c);
  const h = (2 * thetaMax) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const theta = -thetaMax + (i + 0.5) * h;
    const cos = Math.cos(theta);
    sum += (f(c * Math.tan(theta)) * c) / (cos * cos);
  }
  return sum * h;
}

const SHAPES: readonly { alpha: number; beta: number; sigma: number; gamma: number }[] = [
  { alpha: 0.2, beta: 0.03, sigma: 20, gamma: 15 },
  { alpha: 0.05, beta: 0.04, sigma: 35, gamma: 90 },
  { alpha: 25, beta: 0.1, sigma: 16, gamma: 20 },
  { alpha: 2, beta: 0.5, sigma: 2, gamma: 1 },
  { alpha: 0.4, beta: 0.8, sigma: 60, gamma: 0.5 },
];
const FORMS: readonly TofLorentzForm[] = ["gsas", "fullprof"];

describe("Im[eᶻE₁(z)]", () => {
  it("equals the 40-digit value to 2e-13 over the series, continued-fraction and asymptotic regions", () => {
    let worst = 0;
    let where = "";
    for (const [x, y, value] of REFERENCE.e1) {
      const err = Math.abs(imExpE1(x, y) - value) / Math.abs(value);
      if (err > worst) { worst = err; where = `z = ${x} + ${y}i`; }
    }
    expect(worst, where).toBeLessThan(2e-13);
  });
});

describe("TOF peak without a Lorentzian width", () => {
  it("is bit for bit what it was: γ absent and γ = 0 take the Gaussian form unchanged", () => {
    for (const alpha of [0.03, 0.2, 2, 25]) for (const beta of [0.008, 0.1, 0.8]) for (const sigma of [1, 8, 60, 250]) {
      for (const k of [-60, -12, -4, -1.5, -0.2, 0, 0.6, 4, 12, 60, 400]) {
        const delta = k * 2.3548 * sigma;
        const was = gaussianFormAsItWas(delta, { alpha, beta, sigma });
        expect(tofBackToBack(delta, { alpha, beta, sigma })).toBe(was);
        expect(tofBackToBack(delta, { alpha, beta, sigma, gamma: 0 })).toBe(was);
        expect(tofBackToBack(delta, { alpha, beta, sigma, gamma: -3, lorentzForm: "fullprof" })).toBe(was);
      }
    }
  });

  it("is the limit of the Lorentzian form: γ → 0 joins it to 1e-11 of the peak height", () => {
    for (const { alpha, beta, sigma } of SHAPES) for (const lorentzForm of FORMS) {
      const height = tofBackToBack(0, { alpha, beta, sigma });
      for (const k of [-8, -1, 0, 0.5, 3, 20]) {
        const delta = k * sigma;
        const joined = tofBackToBack(delta, { alpha, beta, sigma, gamma: 1e-12 * sigma, lorentzForm });
        expect(Math.abs(joined - tofBackToBack(delta, { alpha, beta, sigma })) / height).toBeLessThan(1e-11);
      }
    }
  });
});

describe("TOF peak with a Lorentzian width", () => {
  it("equals the 40-digit evaluation of the same construction to 3e-7 (the Gaussian part's erfc), in both programs' forms", () => {
    for (const form of FORMS) {
      let worst = 0;
      let where = "";
      for (const row of REFERENCE.peaks) {
        const height = Math.max(...row[form]);
        row.dt.forEach((dt, i) => {
          const ref = row[form][i]!;
          const got = tofBackToBack(dt, { alpha: row.alpha, beta: row.beta, sigma: row.sigma, gamma: row.gamma, lorentzForm: form });
          const err = Math.abs(got - ref) / (Math.abs(ref) + 1e-13 * height);
          if (err > worst) { worst = err; where = `${form} α=${row.alpha} β=${row.beta} σ=${row.sigma} γ=${row.gamma} Δ=${dt}`; }
        });
      }
      expect(worst, where).toBeLessThan(3e-7);
    }
  });

  it("agrees with GSAS-II's compiled routine to 0.5 % of the peak height at every reference point", () => {
    let worst = 0;
    let where = "";
    let compared = 0;
    for (const row of REFERENCE.peaks) {
      if (!row.gsas2Routine) continue;
      const height = Math.max(...row.gsas);
      row.dt.forEach((dt, i) => {
        const routine = row.gsas2Routine![i]!;
        if (!Number.isFinite(routine)) return;
        compared++;
        const got = tofBackToBack(dt, { alpha: row.alpha, beta: row.beta, sigma: row.sigma, gamma: row.gamma, lorentzForm: "gsas" });
        const err = Math.abs(got - routine) / height;
        if (err > worst) { worst = err; where = `α=${row.alpha} β=${row.beta} σ=${row.sigma} γ=${row.gamma} Δ=${dt}`; }
      });
    }
    expect(compared).toBeGreaterThan(3000);
    expect(worst, where).toBeLessThan(5e-3);
  });

  it("has unit area: to 1.5e-7 (the Gaussian part's erfc, as before), and to 1e-9 where the Lorentzian part is nearly all of it", () => {
    for (const s of SHAPES) for (const lorentzForm of FORMS) {
      const area = integrate((d) => tofBackToBack(d, { ...s, lorentzForm }), 2.3548 * s.sigma + s.gamma);
      expect(Math.abs(area - 1), `${lorentzForm} ${JSON.stringify(s)}`).toBeLessThan(1.5e-7);
    }
    // σ far below γ: η = 1 to 1e-4, so the area tests the exponential-integral part alone.
    for (const s of [{ alpha: 0.2, beta: 0.03, sigma: 1e-3, gamma: 15 }, { alpha: 3, beta: 0.4, sigma: 1e-4, gamma: 2 }, { alpha: 0.05, beta: 0.04, sigma: 5e-3, gamma: 90 }]) {
      for (const lorentzForm of FORMS) {
        const area = integrate((d) => tofBackToBack(d, { ...s, lorentzForm }), s.gamma, undefined, 1_600_000);
        expect(Math.abs(area - 1), `${lorentzForm} ${JSON.stringify(s)}`).toBeLessThan(1e-9);
      }
    }
  });

  it("has the first moment each form implies", () => {
    // Over ±X the Gaussian part gives its mean 1/β − 1/α. A Lorentzian of FWHM Γ
    // convolved with a distribution of mean m gives m·(1 − 2Γ/(πX)) to first
    // order in 1/X. m is 1/β − 1/α for p = +αΔ (the two exponentials on
    // opposite sides) and (α² + β²)/(αβ(α + β)) for p = −αΔ (both terms of the
    // Lorentzian part on the same side).
    for (const s of SHAPES) for (const lorentzForm of FORMS) {
      const { fwhm, eta } = tchPseudoVoigt(2 * Math.sqrt(2 * Math.LN2) * s.sigma, s.gamma);
      const X = 2e5 * fwhm;
      const moment = integrate((d) => d * tofBackToBack(d, { ...s, lorentzForm }), 2.3548 * s.sigma + s.gamma, X, 1_600_000);
      const gaussianMean = 1 / s.beta - 1 / s.alpha;
      const lorentzianMean = lorentzForm === "fullprof" ? gaussianMean : (s.alpha ** 2 + s.beta ** 2) / (s.alpha * s.beta * (s.alpha + s.beta));
      const expected = (1 - eta) * gaussianMean + eta * lorentzianMean * (1 - (2 * fwhm) / (Math.PI * X));
      const scale = Math.abs(gaussianMean) + Math.abs(lorentzianMean) + fwhm;
      expect(Math.abs(moment - expected) / scale, `${lorentzForm} ${JSON.stringify(s)}`).toBeLessThan(2e-6);
    }
  });

  it("is smooth where the evaluation changes method (no step above 1e-10 of the height)", () => {
    for (const s of SHAPES) for (const lorentzForm of FORMS) {
      const shape = { ...s, lorentzForm };
      const height = tofBackToBack(0, shape);
      const span = 40 * (2.3548 * s.sigma + s.gamma + 1 / s.alpha + 1 / s.beta);
      const n = 40_000;
      let worst = 0;
      let prev2 = tofBackToBack(-span, shape);
      let prev1 = tofBackToBack(-span + (2 * span) / n, shape);
      for (let i = 2; i <= n; i++) {
        const now = tofBackToBack(-span + (2 * span * i) / n, shape);
        // A second difference on a fine grid is O(h²) for a smooth function; a jump shows at once.
        worst = Math.max(worst, Math.abs(now - 2 * prev1 + prev2) / height);
        prev2 = prev1;
        prev1 = now;
      }
      const smoothBound = 50 * ((2 * span) / n / Math.min(s.sigma, 1 / s.alpha, 1 / s.beta, 2.3548 * s.sigma + s.gamma)) ** 2;
      expect(worst, `${lorentzForm} ${JSON.stringify(s)}`).toBeLessThan(Math.max(1e-10, smoothBound));
    }
  });
});
