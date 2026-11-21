import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import type { RefinementParameter } from "@/core/refinement/types";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { buildPowderSpec } from "@/app/powderSpec";
import { applyParameters } from "@/core/workflow/apply";
import { resolveTies } from "@/core/refinement/constraints";
import { buildPowderProblem, reflectionDRange, tofWidthsAt } from "@/core/workflow/powder";
import { generateReflections } from "@/core/diffraction/reflections";
import { powderPeakIntensities } from "@/core/diffraction/intensity";
import { refine } from "@/core/refinement/engine";

/**
 * Known truth for the time-of-flight profile of a GSAS-II instrument file,
 * through the page's own path (reader → buildPowderSpec → refine).
 *
 * The patterns are silicon on banks of a synthetic three-bank `.instprm`
 * (scripts/tof-profile/simulate_known_truth.py): two calculated by GSAS-II
 * itself (GSASIIscriptable: its structure factors, its peak routine, its peak
 * range), two by an independent Python reference that shares nothing with the
 * app or with GSAS-II. Each is refitted with the file's profile held.
 */
interface Case {
  program: "gsas2" | "reference";
  form?: "gsas" | "fullprof";
  bank: number;
  sample: { size: number; mustrain: number; mustrainMix: number; gauss?: number };
  x: number[]; y: number[]; yNoisy: number[];
  reflections?: { h: number; k: number; l: number; d: number; pos: number; sig2: number; gam: number; alpha: number; beta: number; intensity: number }[];
}
const TRUTH = JSON.parse(readFileSync(fileURLToPath(new URL("../../testSupport/tofKnownTruth.json", import.meta.url)), "utf8")) as {
  structure: { cif: string; a: number; uiso: number };
  background: number;
  instrumentFile: string;
  cases: Record<string, Case>;
};
const INSTPRM = readFileSync(TRUTH.instrumentFile, "utf8");
const B_TRUE = 8 * Math.PI ** 2 * TRUTH.structure.uiso;

const valuesOf = (params: readonly RefinementParameter[]): Record<string, number> => Object.fromEntries(params.map((p) => [p.id, p.value]));

/** The page's rows for a case: the file's profile held, the sample's rows at the case's values, and a perturbed start. */
function setUp(c: Case, y: readonly number[]) {
  const structure = parseCif(TRUTH.structure.cif, "si");
  const pattern = { id: "kt", name: "kt", xUnit: "tof", radiation: { kind: "neutron-tof" }, points: c.x.map((x, i) => ({ x, yObs: y[i]!, sigma: Math.sqrt(Math.max(y[i]!, 1)) })) } as PowderPattern;
  const instrument = parseInstrumentParameters(INSTPRM, c.bank);
  const spec = buildPowderSpec(structure, pattern, instrument, true, 2);
  // GSAS-II's one Mustrain with a Lorentzian fraction is a Lorentzian row and a Gaussian row (core/export/gsas2.ts).
  const lorentz = c.sample.mustrain * c.sample.mustrainMix;
  const gauss = c.sample.gauss ?? (c.sample.mustrain * (1 - c.sample.mustrainMix)) / (2 * Math.sqrt(2 * Math.LN2));
  const free = new Set(["scale", "background", "cellLength", "bIso"]);
  const params = spec.params.map((p) => {
    const value = p.id === "tofSampleLorentz" ? lorentz : p.id === "tofSampleSize" ? c.sample.size : p.id === "tofSampleGauss" ? gauss
      : p.kind === "cellLength" ? p.value + 0.004 : p.kind === "bIso" ? 0.7 : p.value;
    return { ...p, value, initialValue: value, fixed: !free.has(p.kind) };
  });
  if (c.form) for (const b of spec.bindings) if (b.tofLorentzForm) (b as { tofLorentzForm: string }).tofLorentzForm = c.form;
  return { structure, pattern, params, bindings: spec.bindings, profile: spec.profile };
}

function fit(c: Case, y: readonly number[]) {
  const s = setUp(c, y);
  const result = refine(buildPowderProblem(s.structure, s.pattern, s.params, s.bindings, s.profile), { maxIterations: 40 });
  const id = (kind: string): string => s.params.find((p) => p.kind === kind)!.id;
  const yCalc = buildPowderProblem(s.structure, s.pattern, s.params, s.bindings, s.profile).calculate({ ...valuesOf(s.params), ...result.parameters });
  let worst = 0;
  const top = Math.max(...y);
  for (let i = 0; i < y.length; i++) worst = Math.max(worst, Math.abs(yCalc[i]! - y[i]!) / top);
  return {
    result, worst,
    wR: 100 * (result.agreement.rWeighted ?? NaN),
    gof: result.agreement.goodnessOfFit ?? NaN,
    a: result.parameters[id("cellLength")]!, aEsd: result.esd[id("cellLength")]!,
    b: result.parameters[id("bIso")]!, bEsd: result.esd[id("bIso")]!,
    scale: result.parameters[id("scale")]!, scaleEsd: result.esd[id("scale")]!,
  };
}

describe("TOF profile of a GSAS-II file: the terms land where GSAS-II puts them", () => {
  for (const [name, c] of Object.entries(TRUTH.cases)) {
    if (!c.reflections) continue;
    it(`${name}: position, α, β, σ² and γ of every reflection equal GSAS-II's own reflection table`, () => {
      const s = setUp(c, c.y);
      const params = s.params.map((p) => (p.kind === "cellLength" ? { ...p, value: TRUTH.structure.a } : p));
      const applied = applyParameters(s.structure, s.bindings, resolveTies(params, valuesOf(params)));
      let worst = 0;
      for (const r of c.reflections!) {
        const w = tofWidthsAt(applied, r.d);
        const pos = applied.tof!.difC * r.d + applied.tof!.difA * r.d ** 2 + applied.tof!.difB / r.d + applied.zeroShift;
        for (const [got, want] of [[pos, r.pos], [w.alpha, r.alpha], [w.beta, r.beta], [w.sig2, r.sig2], [w.gamma, r.gam]] as const) {
          worst = Math.max(worst, Math.abs(got - want) / Math.abs(want));
        }
      }
      // GSAS-II's Gaussian share of the microstrain uses difC alone, the app's row |dT/dd|: they differ by 2·difA·d/difC of that share.
      expect(worst).toBeLessThan(c.sample.mustrainMix === 1 ? 1e-9 : 2e-3);
    });

    it(`${name}: the integrated intensities are GSAS-II's, up to one constant`, () => {
      const s = setUp(c, c.y);
      const params = s.params.map((p) => (p.kind === "cellLength" ? { ...p, value: TRUTH.structure.a } : p.kind === "bIso" ? { ...p, value: B_TRUE } : p));
      const applied = applyParameters(s.structure, s.bindings, resolveTies(params, valuesOf(params)));
      const { dMin, dMax } = reflectionDRange(s.pattern, applied);
      const ours = powderPeakIntensities(applied.model, s.pattern.radiation, generateReflections(applied.model.cell, applied.model.spaceGroup, dMin, dMax), 1);
      // Reflections of different families can share a d (3 3 3 and 5 1 1): compare the sums at each d.
      const theirs = new Map<string, number>();
      for (const r of c.reflections!) theirs.set(r.d.toFixed(5), (theirs.get(r.d.toFixed(5)) ?? 0) + r.intensity);
      const mine = new Map<string, number>();
      for (const p of ours) mine.set(p.d.toFixed(5), (mine.get(p.d.toFixed(5)) ?? 0) + p.intensity);
      // The diamond glide's extinct reflections (2 2 2, 6 2 2, …) are rounding noise in both lists: not compared.
      const strongest = Math.max(...mine.values());
      const ratios: number[] = [];
      for (const [d, m] of mine) {
        const t = theirs.get(d);
        if (t !== undefined && m > 1e-9 * strongest) ratios.push(m / t);
      }
      expect(ratios.length).toBeGreaterThan(15);
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      expect(Math.max(...ratios.map((r) => Math.abs(r / mean - 1)))).toBeLessThan(1e-5);
    });
  }
});

describe("TOF profile of a GSAS-II file: known truth refitted with the file held", () => {
  for (const [name, c] of Object.entries(TRUTH.cases)) {
    it(`${name}: the noise-free pattern is reproduced, and the noisy one gives the cell, B and scale back within 3 esd at the noise level`, () => {
      const exact = fit(c, c.y);
      const noisy = fit(c, c.yNoisy);
      console.log(`${name}: noise-free wR ${exact.wR.toFixed(4)} %, largest difference ${(100 * exact.worst).toFixed(4)} % of the top; `
        + `noisy wR ${noisy.wR.toFixed(3)} %, GoF ${noisy.gof.toFixed(3)}, a − truth ${((noisy.a - TRUTH.structure.a) / noisy.aEsd).toFixed(2)} esd, `
        + `B − truth ${((noisy.b - B_TRUE) / noisy.bEsd).toFixed(2)} esd, scale − noise-free ${((noisy.scale - exact.scale) / noisy.scaleEsd).toFixed(2)} esd`);
      expect(exact.result.status).toBe("converged");
      expect(Math.abs(exact.a - TRUTH.structure.a)).toBeLessThan(2e-5);
      expect(Math.abs(exact.b - B_TRUE)).toBeLessThan(5e-3);
      expect(exact.wR).toBeLessThan(0.3);
      expect(exact.worst).toBeLessThan(5e-3);
      expect(noisy.result.status).toBe("converged");
      expect(Math.abs(noisy.a - TRUTH.structure.a) / noisy.aEsd).toBeLessThan(3);
      expect(Math.abs(noisy.b - B_TRUE) / noisy.bEsd).toBeLessThan(3);
      expect(Math.abs(noisy.scale - exact.scale) / noisy.scaleEsd).toBeLessThan(3);
      expect(noisy.gof).toBeGreaterThan(0.93);
      expect(noisy.gof).toBeLessThan(1.07);
    }, 300_000);
  }
});
