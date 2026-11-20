import { describe, it, expect } from "vitest";
import {
  caseOf, cleanPoints, noisy, nuclearOnlyRows, powderMomentFit, sequence, sessionOf, Fitter,
  AUDIT_PATTERN, FIT_RANGE, MODEL_A, MODEL_B, MODEL_F_K0,
} from "@/testSupport/momentSequenceCase";
import { CELL, GAMMA_R0_HALF, j0Mn2, momentSize, reflection } from "@/testSupport/independentMnwo4";
import { fitMoments, fitRows } from "@/app/magneticStep";
import { magneticHandle } from "@/testSupport/magneticHeadless";
import type { RefinementParameter } from "@/core/refinement/types";

/**
 * KNOWN TRUTH, from a calculation that shares no code with `src/core`
 * (testSupport/independentMnwo4.ts): the moments fit of the powder page on a
 * synthetic magnetic MnWO₄, k = (½, 0, 0).
 *
 * Finding 1 of the 2026-11-09 audit: the page's sequence "nuclear model first,
 * then the moments with every nuclear row held" gives a moment several esds
 * low. The nuclear-only fit takes up the satellites it does not model in its
 * background and scale, and the moments are then measured against those.
 * Alternating "scale + background with the moments held, then the moments
 * again" reaches the joint fit's answer without a joint step.
 *
 * Finding 2: the moments-only esd leaves out the uncertainty of the held scale.
 *
 * Nothing in the app is changed yet (docs/reports/2026-11-19-moments-alternation.md
 * is the plan). So this file states today's behaviour as it is:
 *  - "documented bias" pins the size of the bias today; it goes when the fix lands;
 *  - `it.fails` states what the fix must make true, and turns red the day it is
 *    true, so the marker cannot be forgotten;
 *  - the alternation here is the test's own (momentSequenceCase.ts): the
 *    statement of the design the fix will be compared with.
 * The 200-seed tables of the report come from momentSequenceSeeds.test.ts.
 */

const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7];
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

describe("the independent generator, against hand calculations", () => {
  const RAD = Math.PI / 180;
  // A ferromagnetic stacking within the parent cell, so that (1 0 0) of the magnetic cell is not extinct.
  const parallel = { na: 2 as const, mnY: [0, 4.2, 0] as const, mnMinusY: [0, 4.2, 0] as const };

  it("d spacings of the magnetic cell: (1 0 0) at 2a·sin β, (0 2 0) at b/2", () => {
    expect(reflection(parallel, 1, 0, 0).d).toBeCloseTo(2 * CELL.a * Math.sin(CELL.beta * RAD), 12);
    expect(reflection(parallel, 0, 2, 0).d).toBeCloseTo(CELL.b / 2, 12);
  });

  it("the nuclear |F|² of (0 2 0): four cosines, written out", () => {
    // F(0 k 0) of one parent cell = Σ b·T·(sum over the orbit of exp(2πi·k·y)); every orbit is ±y, so each is a cosine.
    const s2 = 1 / CELL.b ** 2; // (1 / 2d)², d = b/2
    const T = (u: number): number => Math.exp(-8 * Math.PI ** 2 * u * s2);
    const cos = (y: number): number => Math.cos(2 * Math.PI * 2 * y);
    const cell = 2 * -3.73 * T(0.0108) * cos(0.6856) + 2 * 4.86 * T(0.006) * cos(0.18) + 4 * 5.803 * T(0.01) * cos(0.102) + 4 * 5.803 * T(0.011) * cos(0.374);
    // Two parent cells in the magnetic cell: F doubles.
    expect(reflection(parallel, 0, 2, 0).nuclear).toBeCloseTo((2 * cell) ** 2, 9);
    expect(reflection(parallel, 0, 2, 0).magnetic).toBeLessThan(1e-20);
  });

  it("the magnetic |F⊥|² of (1 0 0): 16·(p·f·T·m)², the moment along b perpendicular to Q", () => {
    // Four Mn at x = ¼, ¼, ¾, ¾ of the magnetic cell with spins +, +, −, −: Σ ±exp(2πi x) = 2·(i − (−i)) = 4i.
    const d = 2 * CELL.a * Math.sin(CELL.beta * RAD);
    const s = 1 / (2 * d);
    const f = 0.422 * Math.exp(-17.684 * s * s) + 0.5948 * Math.exp(-6.005 * s * s) + 0.0043 * Math.exp(0.609 * s * s) - 0.0219;
    expect(j0Mn2(s)).toBeCloseTo(f, 14);
    expect(f).toBeCloseTo(0.9702, 4); // by hand, to four figures
    const T = Math.exp(-8 * Math.PI ** 2 * 0.0108 * s * s);
    expect(reflection(parallel, 1, 0, 0).magnetic).toBeCloseTo(16 * (GAMMA_R0_HALF * f * T * 4.2) ** 2, 8);
    // Its antiferromagnetic twin (Mn(y) against Mn(−y)) has no weight there, and none on any parent node (even H).
    expect(reflection(MODEL_A, 1, 0, 0).magnetic).toBeLessThan(1e-20);
    expect(reflection(MODEL_A, 2, 1, 1).magnetic).toBeLessThan(1e-20);
    expect(reflection(MODEL_A, 1, 1, 0).magnetic).toBeGreaterThan(100);
  });

  it("γr₀/2 = 2.6954 fm per µ_B, and |3 â + 2 ĉ| = 3.5723 µ_B at β = 91.14°", () => {
    expect(GAMMA_R0_HALF).toBeCloseTo(2.6954, 4);
    expect(momentSize([3, 0, 2])).toBeCloseTo(Math.sqrt(9 + 4 + 12 * Math.cos(91.14 * RAD)), 12);
    expect(momentSize([3, 0, 2])).toBeCloseTo(3.5723, 4);
  });
});

describe("noise-free: the app's moments fit against the independent pattern", () => {
  // The app rounds γr₀/2 to 2.695 (as GSAS-II and FullProf do): its moment reads higher by that ratio.
  const rounding = GAMMA_R0_HALF / 2.695;

  it("recovers 4.2 µ_B along b, the nuclear rows held at the truth (one moment row)", () => {
    const c = caseOf(MODEL_A, 6);
    const s = sequence(c, cleanPoints(c.clean), 0);
    expect(s.truthHeld.moment / 4.2).toBeCloseTo(rounding, 7);
    expect(s.truthHeld.wR).toBeLessThan(1e-6);
    // One scale for nuclear and magnetic: K on the magnetic cell is 4K per parent cell.
    expect(c.nuclearTruth.find((p) => p.id === "scale")!.value).toBeCloseTo(4 * AUDIT_PATTERN.scale, 12);
  });

  it("recovers 3.0 â + 2.0 ĉ (two moment rows)", () => {
    const c = caseOf(MODEL_B, 6);
    const s = sequence(c, cleanPoints(c.clean), 0);
    expect(Math.abs(s.truthHeld.components[0]!) / 3).toBeCloseTo(rounding, 7);
    expect(Math.abs(s.truthHeld.components[1]!) / 2).toBeCloseTo(rounding, 7);
  });

  it("today's sequence is biased with no noise at all: the bias is the sequence's, not the statistics'", () => {
    const c = caseOf(MODEL_A, 6);
    const s = sequence(c, cleanPoints(c.clean), 4);
    expect(s.steps[0]!.moment).toBeCloseTo(4.062, 2);
    // The nuclear-only fit lifted the background and the scale over the satellites it did not model.
    expect(s.steps[0]!.background).toBeGreaterThan(205);
    expect(s.steps[0]!.scale / 0.08).toBeGreaterThan(1.012);
    // The alternation closes on the joint fit by a factor of about five a round.
    const left = s.steps.map((x) => Math.abs(x.moment - s.joint.moment));
    for (let r = 1; r <= 4; r++) expect(left[r]! / left[r - 1]!).toBeLessThan(0.3);
    expect(left[4]!).toBeLessThan(5e-4);
  });
});

describe("Finding 1 — the page's moments fit after a nuclear-only fit (independent MnWO4, 8 fixed seeds)", () => {
  /** The page's own fit: powderMomentFit → momentFitRequest, every nuclear row held, from the page's seeds. */
  async function pageMoment(model: typeof MODEL_A, seed: number): Promise<{ moment: number; fullEsd: number }> {
    const c = caseOf(model, 6);
    const points = noisy(c.clean, seed);
    const nuclear = nuclearOnlyRows(c, points);
    const fit = await fitMoments(powderMomentFit(null, sessionOf(c, points, nuclear), FIT_RANGE), c.build);
    const f = new Fitter(c, points);
    const rows: RefinementParameter[] = [...nuclear, ...fitRows(c.build, fit.values)];
    const esd = f.covarianceEsd(rows, fit.values, (p) => p.kind === "momentMode" || p.kind === "scale" || p.kind === "background");
    return { moment: f.moment(fit.values), fullEsd: Object.entries(esd).find(([id]) => id.startsWith("mom_"))![1] };
  }

  it("documented bias (today): 4.2 µ_B comes out near 4.06, about 9 esd low, in every seed", async () => {
    const runs = await Promise.all(SEEDS.map((seed) => pageMoment(MODEL_A, seed)));
    const m = mean(runs.map((r) => r.moment));
    console.log(`[moment-bias] today, page fit, model A, ${SEEDS.length} seeds: ${m.toFixed(4)} µB (truth 4.2), per seed ${runs.map((r) => `${r.moment.toFixed(3)}(${(1000 * r.fullEsd).toFixed(0)})`).join(" ")}`);
    expect(m).toBeGreaterThan(4.04);
    expect(m).toBeLessThan(4.09);
    for (const r of runs) expect((r.moment - 4.2) / r.fullEsd).toBeLessThan(-6);
  }, 60_000);

  it.fails("TARGET (red until the fix): the page's moments fit lands within 3 esd of 4.2 µ_B in every seed", async () => {
    const runs = await Promise.all(SEEDS.map((seed) => pageMoment(MODEL_A, seed)));
    for (const r of runs) expect(Math.abs(r.moment - 4.2) / r.fullEsd).toBeLessThan(3);
  }, 60_000);

  it("the alternation removes it without a joint step: one moment row", () => {
    const c = caseOf(MODEL_A, 6);
    const runs = SEEDS.map((seed) => sequence(c, noisy(c.clean, seed), 5));
    const at = (r: number): number => mean(runs.map((s) => s.steps[r]!.moment));
    const joint = mean(runs.map((s) => s.joint.moment));
    console.log(`[moment-bias] model A, ${SEEDS.length} seeds: today ${at(0).toFixed(4)}, rounds 1–5 ${[1, 2, 3, 4, 5].map((r) => at(r).toFixed(4)).join(" ")}, joint ${joint.toFixed(4)}, truth held ${mean(runs.map((s) => s.truthHeld.moment)).toFixed(4)}`);
    expect(at(0) - 4.2).toBeLessThan(-0.12);
    expect(Math.abs(at(1) - joint)).toBeGreaterThan(0.02); // one round is not enough
    expect(Math.abs(at(4) - joint)).toBeLessThan(0.002);
    for (const s of runs) {
      // Every seed, in the last moments step's own esd: within 0.05 of the joint fit after five rounds, the shift then below 0.05.
      expect(Math.abs(s.steps[5]!.moment - s.joint.moment) / s.steps[5]!.quotedEsd[0]!).toBeLessThan(0.05);
      expect(s.steps[5]!.shiftOverEsd!).toBeLessThan(0.05);
      // The rounds refine the scale and the background only: the width keeps its nuclear-only value.
      expect(s.steps[5]!.width).toBe(s.steps[0]!.width);
    }
    // And the joint fit is the truth within the noise of eight seeds (esd 0.010 each).
    expect(Math.abs(joint - 4.2)).toBeLessThan(0.012);
  }, 60_000);

  it("and with two moment rows (3.0 â + 2.0 ĉ)", () => {
    const c = caseOf(MODEL_B, 6);
    const runs = SEEDS.map((seed) => sequence(c, noisy(c.clean, seed), 5));
    const at = (r: number, i: number): number => mean(runs.map((s) => Math.abs(s.steps[r]!.components[i]!)));
    console.log(`[moment-bias] model B, ${SEEDS.length} seeds: today ${at(0, 0).toFixed(4)}, ${at(0, 1).toFixed(4)} · 4 rounds ${at(4, 0).toFixed(4)}, ${at(4, 1).toFixed(4)} · joint ${mean(runs.map((s) => Math.abs(s.joint.components[0]!))).toFixed(4)}, ${mean(runs.map((s) => Math.abs(s.joint.components[1]!))).toFixed(4)}`);
    expect(at(0, 0) - 3).toBeLessThan(-0.09);
    expect(at(0, 1) - 2).toBeLessThan(-0.01);
    for (const s of runs) {
      for (const i of [0, 1]) expect(Math.abs(s.steps[5]!.components[i]! - s.joint.components[i]!) / s.steps[5]!.quotedEsd[i]!).toBeLessThan(0.05);
    }
    expect(Math.abs(mean(runs.map((s) => s.joint.moment)) - momentSize([3, 0, 2]))).toBeLessThan(0.015);
  }, 60_000);
});

describe("Finding 2 — the esd of a moment (independent MnWO4)", () => {
  it("the moments-only esd is 11 % below the esd from the covariance that includes the scale and the background", () => {
    const c = caseOf(MODEL_A, 6);
    const s = sequence(c, noisy(c.clean, 0), 5);
    const last = s.steps[5]!;
    expect(last.fullEsd[0]! / last.quotedEsd[0]!).toBeGreaterThan(1.1);
    expect(last.fullEsd[0]! / last.quotedEsd[0]!).toBeLessThan(1.15);
    // That covariance, taken at the alternation's end with no step, is the joint fit's own esd (the engine's).
    expect(last.fullEsd[0]! / s.joint.quotedEsd[0]!).toBeCloseTo(1, 2);
    // The contraction of the alternation follows from the same number: 1 − (moments-only / full)².
    const predicted = 1 - (last.quotedEsd[0]! / last.fullEsd[0]!) ** 2;
    const left = s.steps.map((x) => Math.abs(x.moment - s.joint.moment));
    expect(left[2]! / left[1]!).toBeCloseTo(predicted, 1);
  }, 60_000);
});

describe("k = 0 — a ferromagnet on the nuclear lines (independent MnWO4)", () => {
  it("documented bias (today): with the scale held, as the step's Refine moments holds it, 4.2 µ_B comes out near 3.5", () => {
    const c = caseOf(MODEL_F_K0, 6);
    const held = sequence(c, noisy(c.clean, 0), 8);
    const free = sequence(c, noisy(c.clean, 0), 3, ["background"], ["scale", "background", "peakWidth"], ["scale"]);
    console.log(`[moment-bias] k = 0 ferromagnet, seed 0: scale held ${held.steps.map((x) => x.moment.toFixed(3)).join(" ")} (joint ${held.joint.moment.toFixed(3)}) · scale free with the moments ${free.steps.map((x) => x.moment.toFixed(3)).join(" ")}`);
    expect(held.steps[0]!.moment).toBeLessThan(3.6);
    // The alternation still closes, but by 0.4 a round where k ≠ 0 gave 0.2: the scale and the moment trade.
    const left = held.steps.map((x) => Math.abs(x.moment - held.joint.moment));
    expect(left[4]! / left[3]!).toBeGreaterThan(0.3);
    expect(left[4]! / left[3]!).toBeLessThan(0.5);
    // With the scale free beside the moments (the ranking's freeScale) two rounds over the background are enough.
    expect(Math.abs(free.steps[0]!.moment - held.joint.moment)).toBeLessThan(0.12);
    expect(Math.abs(free.steps[2]!.moment - held.joint.moment)).toBeLessThan(0.002);
  }, 60_000);

  it("documented (today): the step's Refine moments holds the scale at k = 0, where its ranking frees it", async () => {
    const c = caseOf(MODEL_F_K0, 6);
    const points = noisy(c.clean, 0);
    let session = sessionOf(c, points, nuclearOnlyRows(c, points));
    // The step itself (MagneticStep, as the panel and the Agent drive it), on the page after its nuclear-only fit.
    const step = magneticHandle(() => ({ session, window: FIT_RANGE }), (s) => { session = s; }, () => {});
    step.setK([0, 0, 0]);
    step.selectIons(["Mn1"]);
    // P2/c with one moment row: the group the pattern was made in (2 and −1 unprimed keep a moment along b on both Mn).
    const truth = step.state().candidates.find((g) => g.symbol === "P2/c");
    expect(truth?.id).toBe("G1");
    await step.rank("all", 2);
    const ranked = step.state().candidates.find((g) => g.id === "G1")!.fit!.moments[0]!.muB;
    step.choose("G1");
    await step.refineMoments();
    const refined = step.state().selected!.moments[0]!.muB;
    console.log(`[moment-bias] k = 0 ferromagnet through the step: ranked (scale free) ${ranked.toFixed(3)} µB, then Refine moments (scale held) ${refined.toFixed(3)} µB; truth 4.2`);
    expect(ranked).toBeGreaterThan(4.1);
    // Refine moments, started from the ranked values, takes the moment back to the nuclear-only scale's answer.
    expect(refined).toBeLessThan(3.6);
  }, 60_000);
});
