import { describe, it, expect, afterAll } from "vitest";
import { newSession, type Session } from "@/app/powderSession";
import { exampleStructure } from "@/examples/mn3ga";
import { powderPage, impurityD } from "@/agent/evals/pages";
import { pageExtraPeaks } from "@/app/ui/CanLines";
import { pageFitDiagnosis } from "@/app/powderJudgment";
import { canLineContext, canLines, matchExtraPeaks, compactHkl, type CanLine, type ExtraPeakMatch } from "@/core/diagnostics/canLines";
import type { BackgroundExcess } from "@/core/diagnostics/backgroundTerms";
import { generateReflections } from "@/core/diffraction/reflections";
import { minMax } from "@/core/math/extent";
import { runPowderRefinement } from "@/workers/runPowder";
import { powderRestraints } from "@/app/powderSpec";

/**
 * The Can lines card's question on synthetic data: is an extra peak a can
 * line? The extra peaks are the Validation view's own (diagnose_fit's
 * unexplained excess, read through pageFitDiagnosis on the page), matched to
 * the can lines within 1 FWHM. The synthetic Mn₃Ga pattern (λ 1.54 Å
 * neutrons, Gaussian lines of FWHM 0.5°, the strongest 5000 counts over a flat
 * 1000), its model exact, carries, each planted line at 4 % of the strongest
 * point, at each
 * noise level (σ = k·√y, k = 1 and 2):
 *  - a planted Al line (the Al line farthest from any Mn₃Ga reflection): found and matched to it;
 *  - a planted line of no can (between the Mn₃Ga reflections, > 1 FWHM from every can line): found, matched to none;
 *  - nothing (negative control): nothing found.
 */

const WAVELENGTH = 1.54;
const TRUE_WIDTH = 0.5;
const twoThetaOf = (d: number): number => (2 * Math.asin(WAVELENGTH / (2 * d)) * 180) / Math.PI;

/** Seeded standard normal deviates. */
function gaussian(seed: number): () => number {
  let state = seed;
  const uniform = (): number => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

/** The exact model, the scale and background refined onto the noisy data (as the eval pages do). */
function prefit(s: Session): Session {
  const free = new Set(s.powderParams.filter((p) => p.kind === "scale" || p.kind === "background").map((p) => p.id));
  const r = runPowderRefinement({
    type: "refinePowder", requestId: 0, structure: s.structure, pattern: s.pattern,
    parameters: s.powderParams.map((p) => ({ ...p, fixed: !free.has(p.id) })),
    bindings: s.powderBindings, shape: s.powderProfile.shape,
    restraints: powderRestraints([s.structure], s.siteTies, s.powderParams),
    options: { maxIterations: 20 },
  });
  return { ...s, powderParams: s.powderParams.map((p) => ({ ...p, value: r.parameters[p.id] ?? p.value })) };
}

/**
 * The model's own pattern on a fine grid (2θ 10–120°, step 0.04°: 12 points per
 * FWHM; the session's 500-point demo grid is too coarse for diagnose_fit to
 * measure a line width), the peak width at its true 0.5°.
 */
function exactSession(): Session {
  const s0 = newSession(exampleStructure());
  const params = s0.powderParams.map((p) => (p.id === "width" ? { ...p, value: TRUE_WIDTH } : p));
  const points = Array.from({ length: Math.round((120 - 10) / 0.04) + 1 }, (_, i) => ({ x: 10 + i * 0.04, yObs: 1, sigma: 1 }));
  const grid: Session = { ...s0, powderParams: params, pattern: { ...s0.pattern, points } };
  // Counts of a neutron pattern: the strongest line 5000 counts over a flat background of 1000.
  const f = 5e3 / minMax(powderPage(grid).state().curves.yCalc).max;
  const scaled: Session = {
    ...grid,
    powderParams: params.map((p) => (p.kind === "scale" ? { ...p, value: p.value * f } : p.kind === "background" ? { ...p, value: p.id === "bkg0" ? 1000 : 0 } : p)),
  };
  const yCalc = powderPage(scaled).state().curves.yCalc;
  return { ...scaled, pattern: { ...scaled.pattern, points: points.map((p, i) => ({ ...p, yObs: yCalc[i]!, sigma: Math.sqrt(Math.max(yCalc[i]!, 1)) })) } };
}

/** That pattern at noise level k with Gaussian lines (FWHM 0.5°) planted at these d (Å), each at `height` of the strongest point. */
function session(k: number, planted: readonly number[], height = 0.04, seed = 20261126): Session {
  const s = exactSession();
  const top = minMax(s.pattern.points.map((p) => p.yObs)).max;
  const sig = TRUE_WIDTH / (2 * Math.sqrt(2 * Math.LN2));
  const noise = gaussian(seed);
  const points = s.pattern.points.map((p) => {
    const y = p.yObs + planted.reduce((sum, d) => sum + height * top * Math.exp(-0.5 * ((p.x - twoThetaOf(d)) / sig) ** 2), 0);
    const sigma = k * Math.sqrt(Math.max(y, 1));
    return { ...p, yObs: y + sigma * noise(), sigma };
  });
  return prefit({ ...s, pattern: { ...s.pattern, points } });
}

/** The Al line farthest (relative d) from every Mn₃Ga reflection, inside the pattern. */
function isolatedAlLine(): CanLine {
  const s = exactSession();
  const ctx = canLineContext({ structure: s.structure, extraPhases: [], pattern: s.pattern, parameters: s.powderParams, bindings: s.powderBindings, profile: s.powderProfile })!;
  const al = canLines(ctx).find((p) => p.can.phase === "Al")!;
  const refl = generateReflections(s.structure.cell, s.structure.spaceGroup, 0.5, 20).map((r) => r.d);
  const gap = (d: number): number => Math.min(...refl.map((r) => Math.abs(r / d - 1)));
  const inside = al.lines.filter((l) => l.d > 1.2);
  return inside.reduce((best, l) => (gap(l.d) > gap(best.d) ? l : best));
}

interface Row { readonly noise: number; readonly kase: string; readonly found: string; readonly matched: string }
const table: Row[] = [];

function read(s: Session): { found: readonly BackgroundExcess[]; matches: ExtraPeakMatch<BackgroundExcess>[]; evidence: string } {
  const state = powderPage(s).state();
  // The Validation view's "What limits the fit" names the same peaks (its unexplained-peak cause).
  const evidence = pageFitDiagnosis(state)?.diagnosis.causes.find((c) => c.id === "unexplained-peak")?.evidence ?? "";
  const found = pageExtraPeaks(state)!;
  const ctx = canLineContext({ structure: state.structure, extraPhases: state.extraPhases, pattern: state.pattern, parameters: state.parameters, bindings: state.bindings, profile: state.profile })!;
  return { found, matches: matchExtraPeaks(canLines(ctx), found), evidence };
}

const fmt = (ms: readonly ExtraPeakMatch<BackgroundExcess>[]): { found: string; matched: string } => ({
  found: ms.length === 0 ? "none" : ms.map((m) => `${m.peak.d.toFixed(3)} Å (${m.peak.significance.toFixed(1)}σ)`).join(", "),
  matched: ms.filter((m) => m.line).map((m) => `${m.peak.d.toFixed(3)} Å → ${m.line!.phase} ${compactHkl(m.line!.hkl)} (${m.separation!.toFixed(2)} FWHM)`).join(", ") || "none",
});

describe("Can lines: an extra peak the fit does not capture, matched to the can lines", () => {
  const al = isolatedAlLine();
  const other = impurityD();

  it("the planted lines are where the test says: the Al line clear of Mn₃Ga, the other line clear of every can line", () => {
    const s = exactSession();
    const ctx = canLineContext({ structure: s.structure, extraPhases: [], pattern: s.pattern, parameters: s.powderParams, bindings: s.powderBindings, profile: s.powderProfile })!;
    const xOther = twoThetaOf(other);
    for (const p of canLines(ctx)) for (const l of p.lines) expect(Math.abs(l.x - xOther) / l.fwhm).toBeGreaterThan(2);
    expect(al.d).toBeGreaterThan(1.2);
  });

  for (const k of [1, 2]) {
    it(`noise σ = ${k}·√y: the Al line found and matched`, () => {
      const { matches, evidence } = read(session(k, [al.d]));
      expect(evidence).toContain(`d = ${matches[0]?.peak.d.toFixed(3)} Å`);
      table.push({ noise: k, kase: `Al ${compactHkl(al.hkl)} planted (d ${al.d.toFixed(3)} Å)`, ...fmt(matches) });
      expect(matches).toHaveLength(1);
      expect(matches[0]!.line?.phase).toBe("Al");
      expect(matches[0]!.line?.hkl).toBe(al.hkl);
      expect(matches[0]!.separation!).toBeLessThan(0.5);
    }, 120_000);

    it(`noise σ = ${k}·√y: a line of no can found, matched to none`, () => {
      const { matches, evidence } = read(session(k, [other]));
      expect(evidence).toContain(`d = ${matches[0]?.peak.d.toFixed(3)} Å`);
      table.push({ noise: k, kase: `non-can line planted (d ${other.toFixed(3)} Å)`, ...fmt(matches) });
      expect(matches).toHaveLength(1);
      expect(Math.abs(matches[0]!.peak.d / other - 1)).toBeLessThan(0.01);
      expect(matches[0]!.line).toBeNull();
    }, 120_000);

    it(`noise σ = ${k}·√y: clean data, nothing found (negative control)`, () => {
      const { matches, evidence } = read(session(k, []));
      table.push({ noise: k, kase: "nothing planted", ...fmt(matches) });
      expect(matches).toHaveLength(0);
      expect(evidence).toBe("");
    }, 120_000);
  }

  afterAll(() => {
    if (process.env.CAN_LINES_TABLE) {
      console.log(["| noise | case | extra peaks found | matched to a can line |", "| --- | --- | --- | --- |", ...table.map((r) => `| σ = ${r.noise}·√y | ${r.kase} | ${r.found} | ${r.matched} |`)].join("\n"));
    }
  });
});
