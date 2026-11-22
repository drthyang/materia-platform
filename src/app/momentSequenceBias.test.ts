import { describe, it, expect } from "vitest";
import {
  caseOf, cleanPoints, noisy, nuclearOnlyRows, powderMomentFit, sequence, sessionOf, Fitter,
  AUDIT_PATTERN, FIT_RANGE, MODEL_A, MODEL_A_K0, MODEL_B, MODEL_F_K0, NUCLEAR_SETS, type Case,
} from "@/testSupport/momentSequenceCase";
import { CELL, GAMMA_R0_HALF, j0Mn2, momentSize, reflection, type SpinModel } from "@/testSupport/independentMnwo4";
import { MagneticStep, fitMoments, fitRows, momentFitReadout, MOMENT_ROUNDS_SUMMARY, type MomentRounds } from "@/app/magneticStep";
import { magneticStepOn, sessionCurves } from "@/testSupport/magneticHeadless";
import { powderFit, powderPageCurves, weightedR, withFitResult, withMomentRoundRows } from "@/app/powderPage";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { ALTERNATION_MAX_ROUNDS, K0_SCALE_WITH_MOMENTS, momentsOnlyEsdOptions, reRefinedRows } from "@/core/magnetic/momentsFit";
// The loop under the moments fit, for the two tests that ask of it what the fit itself does not take: a cap, the other k = 0 choice.
import { alternateMoments } from "@/core/magnetic/momentAlternation";
import { magneticOperationSignature } from "@/core/magnetic/operationSignature";
import { buildMagneticPowderProblem } from "@/core/workflow/magneticPowder";
import { refine } from "@/core/refinement/engine";
import { ComputeClient } from "@/workers/computeClient";
import { DEFAULT_INSTRUMENT, type Session } from "@/app/powderSession";

/**
 * KNOWN TRUTH, from a calculation that shares no code with `src/core`
 * (testSupport/independentMnwo4.ts): the moments fit of the powder page on a
 * synthetic magnetic MnWO₄, k = (½, 0, 0) and k = 0.
 *
 * Finding 1 of the 2026-11-09 audit: one moments fit after a nuclear-only fit
 * gives a moment several esds low. The nuclear-only fit takes up the magnetic
 * intensity it does not model in its background and scale, and the moments are
 * then measured against those. Finding 2: the moments-only esd leaves out the
 * uncertainty of the held scale.
 *
 * The step's Refine moments now runs as rounds (core/magnetic/
 * momentsFit.ts): the moments, then the scale and the background with
 * the moments held, then the moments again, until they settle; it ends on a
 * moments step, hands the re-refined rows to the page, and quotes esds that
 * include them. These tests drive the step itself (MagneticStep, as the panel
 * and the Agent drive it) and compare it with the truth and with the joint fit
 * of the test's own harness (momentSequenceCase.ts), which no step of the app
 * runs. The ranking's fits stay one fit each, by decision; that is pinned too.
 *
 * The many-seed tables of docs/reports/2026-11-19-moments-alternation.md come
 * from momentSequenceSeeds.test.ts.
 */

const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7];
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: readonly number[]): number => Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / (v.length - 1));

/** The page after its nuclear-only fit of a noisy pattern, and the step on it (the store the panel renders and the Agent drives). */
function pageOf(c: Case, seed: number | "clean"): { step: MagneticStep; session: () => Session; set: (s: Session) => void; fitter: Fitter; nuclearOnly: Session } {
  const points = seed === "clean" ? cleanPoints(c.clean) : noisy(c.clean, seed);
  let session = sessionOf(c, points, nuclearOnlyRows(c, points));
  const nuclearOnly = session;
  const step = magneticStepOn(() => ({ session, window: FIT_RANGE }), (s) => { session = s; }, () => {});
  step.handle.setK([c.k[0], c.k[1], c.k[2]]);
  step.handle.selectIons(["Mn1"]);
  return { step, session: () => session, set: (s) => { session = s; }, fitter: new Fitter(c, points), nuclearOnly };
}

/** The step's id of the group the pattern was made in. */
function truthId(c: Case, step: MagneticStep): string {
  const sig = magneticOperationSignature(c.build.magnetic.operations!);
  const i = step.view().reps.findIndex((r) => magneticOperationSignature(r.candidate.operations) === sig);
  expect(i).toBeGreaterThanOrEqual(0);
  return `G${i + 1}`;
}

interface Refined {
  readonly moment: number;
  /** The free moment rows' values and esds, in row order. */
  readonly components: readonly number[];
  readonly esd: readonly number[];
  readonly rounds: MomentRounds;
  readonly page: ReturnType<typeof pageOf>;
}

/** Choose the true group and click Refine moments. */
async function refineMoments(model: SpinModel, seed: number | "clean", terms = 6): Promise<Refined> {
  const c = caseOf(model, terms);
  const page = pageOf(c, seed);
  page.step.handle.choose(truthId(c, page.step));
  expect(await page.step.refineMoments()).not.toBeNull();
  const v = page.step.view();
  const ids = fitRows(c.build).filter((p) => !p.fixed).map((p) => p.id);
  return { moment: page.fitter.moment(v.resolvedAmps), components: ids.map((id) => v.resolvedAmps[id]!), esd: ids.map((id) => v.fitRounds!.esd[id]!), rounds: v.fitRounds!, page };
}

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

  it("one fit after a nuclear-only fit is biased with no noise at all: the bias is the sequence's, not the statistics'", () => {
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

describe("Finding 1 — Refine moments after a nuclear-only fit (independent MnWO4, fixed seeds, through the step)", () => {
  it("one moment row: 4.2 µ_B within 3 esd in every seed, the joint fit's answer, the scatter as the esd says", async () => {
    const c = caseOf(MODEL_A, 6);
    // Forty-eight seeds for the scatter (known to ±10 %; the first sixteen alone read 0.66), the first eight against the joint fit.
    const all = await Promise.all(Array.from({ length: 48 }, (_, seed) => refineMoments(MODEL_A, seed)));
    const runs = all.slice(0, SEEDS.length);
    const joint = SEEDS.map((seed) => sequence(c, noisy(c.clean, seed), 0).joint);
    const m = mean(all.map((r) => r.moment));
    const scatter = sd(all.map((r) => r.moment));
    const esd = mean(all.map((r) => r.esd[0]!));
    console.log(`[moment-rounds] model A, ${all.length} seeds: ${m.toFixed(4)} µB (truth 4.2), rounds ${Math.min(...all.map((r) => r.rounds.count))}–${Math.max(...all.map((r) => r.rounds.count))} · scatter ${scatter.toFixed(4)} / esd ${esd.toFixed(4)} = ${(scatter / esd).toFixed(2)} · first eight ${runs.map((r) => `${r.moment.toFixed(3)}(${(1000 * r.esd[0]!).toFixed(0)})`).join(" ")}, joint ${mean(joint.map((j) => j.moment)).toFixed(4)}`);
    for (const r of all) {
      expect(Math.abs(r.moment - 4.2) / r.esd[0]!).toBeLessThan(3.5);
      expect(r.rounds.settled).toBe(true);
    }
    runs.forEach((r, i) => {
      expect(Math.abs(r.moment - 4.2) / r.esd[0]!, `seed ${i}`).toBeLessThan(3);
      // The joint fit of the scale, the background and the moment, which no step of the app runs: the same moment, the same esd.
      expect(Math.abs(r.moment - joint[i]!.moment) / r.esd[0]!, `seed ${i}`).toBeLessThan(0.05);
      expect(r.esd[0]! / joint[i]!.quotedEsd[0]!, `seed ${i}`).toBeCloseTo(1, 2);
      expect(r.rounds.settled).toBe(true);
      expect(r.rounds.count).toBeGreaterThanOrEqual(3);
      expect(r.rounds.count).toBeLessThanOrEqual(6);
      expect(r.rounds.lastShiftOverEsd).toBeLessThan(0.1);
    });
    // The bias is gone: the mean is the truth within its own error (esd/√48, and the app's rounded γr₀/2 at +0.0007).
    expect(Math.abs(m - 4.2)).toBeLessThan(3 * esd / Math.sqrt(all.length) + 0.001);
    // And the esd is the scatter's size: 0.88 here, 0.98 over 1000 seeds (the report). One fit's own esd read 0.70 of its scatter, 10 esd off the truth.
    expect(scatter / esd).toBeGreaterThan(0.75);
    expect(scatter / esd).toBeLessThan(1.25);
  }, 60_000);

  it("two moment rows (3.0 â + 2.0 ĉ): each within 3 esd, the joint fit's answer", async () => {
    const c = caseOf(MODEL_B, 6);
    const runs = await Promise.all(SEEDS.map((seed) => refineMoments(MODEL_B, seed)));
    const joint = SEEDS.map((seed) => sequence(c, noisy(c.clean, seed), 0).joint);
    const at = (i: number): number => mean(runs.map((r) => Math.abs(r.components[i]!)));
    console.log(`[moment-rounds] model B, ${SEEDS.length} seeds: ${at(0).toFixed(4)}, ${at(1).toFixed(4)} (truth 3, 2), rounds ${runs.map((r) => r.rounds.count).join(" ")}`);
    runs.forEach((r, s) => {
      [3, 2].forEach((truth, i) => {
        expect(Math.abs(Math.abs(r.components[i]!) - truth) / r.esd[i]!, `seed ${s} row ${i}`).toBeLessThan(3);
        expect(Math.abs(r.components[i]! - joint[s]!.components[i]!) / r.esd[i]!, `seed ${s} row ${i}`).toBeLessThan(0.05);
      });
      expect(r.rounds.settled).toBe(true);
    });
    expect(Math.abs(mean(runs.map((r) => r.moment)) - momentSize([3, 0, 2]))).toBeLessThan(0.015);
  }, 60_000);

  it("the ranking's fit stays one fit, by decision: the true group ranks at 4.06, and Refine moments then gives 4.20", async () => {
    const c = caseOf(MODEL_A, 6);
    const page = pageOf(c, 0);
    const id = truthId(c, page.step);
    await page.step.rank("all", 2);
    const before = page.session();
    const ranked = page.step.handle.state().candidates.find((g) => g.id === id)!.fit!;
    expect(page.step.handle.state().best).toBe(id);
    expect(ranked.moments[0]!.muB).toBeCloseTo(4.064, 2);
    // A ranking fits every group against the page as it stands, and changes no row of it.
    expect(page.session()).toBe(before);
    // The same single fit, asked of the page's fit without rounds.
    const single = await fitMoments(powderMomentFit(null, page.session(), FIT_RANGE), c.build);
    expect(single.rounds).toBeUndefined();
    expect(page.fitter.moment(single.values)).toBeCloseTo(ranked.moments[0]!.muB, 6);
    page.step.handle.choose(id);
    const wR = await page.step.refineMoments();
    // Lower than the ranking table's wR for the same group: the line beside the table says why.
    expect(wR!).toBeLessThan(ranked.wR! - 0.015);
    expect(page.step.handle.state().selected!.moments[0]!.muB).toBeCloseTo(4.203, 2);
  }, 60_000);
});

describe("the rows Refine moments hands back to the page", () => {
  it("the page takes the re-refined scale and background; a moments-only Refine there then moves nothing, with the joint fit's esd", async () => {
    const c = caseOf(MODEL_A, 6);
    const r = await refineMoments(MODEL_A, 0);
    const { page } = r;
    const held = r.rounds.held;
    // The scale and the six background terms, and no other row.
    expect(Object.keys(held).sort()).toEqual(["bkg0", "bkg1", "bkg2", "bkg3", "bkg4", "bkg5", "scale"]);
    expect(reRefinedRows(page.session().powderParams)).toEqual(held);
    expect(held.scale).not.toBe(reRefinedRows(page.nuclearOnly.powderParams).scale);
    const moved = page.session().powderParams.filter((p, i) => p.value !== page.nuclearOnly.powderParams[i]!.value).map((p) => p.id);
    expect(moved.sort()).toEqual(Object.keys(held).sort());
    // The width, which the nuclear-only fit left 1 % wide, is no part of the rounds.
    expect(page.session().powderParams.find((p) => p.id === "width")!.value).toBe(page.nuclearOnly.powderParams.find((p) => p.id === "width")!.value);

    // Continue: the moment rows join the page's rows, free; every nuclear row is held, as the method's Stage 4 sets it.
    page.step.continueToRefinement(false);
    const session = page.session();
    const free = session.powderParams.filter((p) => !p.fixed && !p.expression).map((p) => p.id);
    expect(free).toEqual(["mom_Mn1_0"]);
    expect(momentsOnlyEsdOptions(session.powderParams)).toEqual({ esdWith: Object.keys(held) });
    const client = new ComputeClient();
    const result = await powderFit(client, { session, instrument: DEFAULT_INSTRUMENT, fitRange: FIT_RANGE, result: null }, { maxIterations: 20 });
    // The Refine button's fit of the moments alone: nothing moves, and the esd is the one a joint fit quotes, keyed by the moment row only.
    expect(Math.abs(result.parameters.mom_Mn1_0! - r.components[0]!) / result.esd.mom_Mn1_0!).toBeLessThan(0.1);
    expect(Object.keys(result.esd)).toEqual(["mom_Mn1_0"]);
    expect(result.diagnostics?.esdIncludes).toEqual(Object.keys(held));
    const joint = sequence(c, noisy(c.clean, 0), 0).joint;
    expect(result.esd.mom_Mn1_0! / joint.quotedEsd[0]!).toBeCloseTo(1, 2);
    // Finding 2: the moments-only esd of the same fit is 11 % smaller.
    const alone = refine(buildMagneticPowderProblem(session.structure, session.magnetic!, session.pattern, session.powderParams, session.powderBindings, session.powderProfile, FIT_RANGE), { maxIterations: 20 });
    expect(result.esd.mom_Mn1_0! / alone.esd.mom_Mn1_0!).toBeGreaterThan(1.1);
    expect(result.esd.mom_Mn1_0! / alone.esd.mom_Mn1_0!).toBeLessThan(1.15);

    // Why the rows must reach the page: on the nuclear-only scale and background the same Refine takes the moment back.
    const without = withMomentRoundRows(session, reRefinedRows(page.nuclearOnly.powderParams));
    const back = await powderFit(client, { session: without, instrument: DEFAULT_INSTRUMENT, fitRange: FIT_RANGE, result: null }, { maxIterations: 20 });
    expect(back.parameters.mom_Mn1_0!).toBeCloseTo(4.064, 2);
    // A free set with a nuclear row in it asks for nothing: its esds are its own.
    expect(momentsOnlyEsdOptions(session.powderParams.map((p) => (p.id === "scale" ? { ...p, fixed: false } : p)))).toEqual({});
  }, 60_000);

  it("the nuclear-only agreement the step compares with is the one from before the rounds, while the page holds their rows", async () => {
    const c = caseOf(MODEL_A, 6);
    const page = pageOf(c, 0);
    const live = (): number => weightedR(page.session(), powderPageCurves(page.session()).nuclear, FIT_RANGE);
    const before = page.step.handle.state().baselineAgreement!;
    expect(before).toBeCloseTo(live(), 12);
    page.step.handle.choose(truthId(c, page.step));
    const wR = (await page.step.refineMoments())!;
    // The page's own nuclear curve now carries a scale and background fitted with the magnetic model: it reads worse than the nuclear-only fit did.
    expect(live()).toBeGreaterThan(before + 0.002);
    expect(page.step.handle.state().baselineAgreement).toBe(before);
    expect(wR).toBeLessThan(before);
    // A second Refine moments starts from the settled rows: one round takes up what the first left (under 0.1 esd), and the baseline is kept.
    const first = page.step.handle.state().selected!.moments[0]!.muB;
    await page.step.refineMoments();
    expect(page.step.view().fitRounds!.count).toBe(1);
    expect(Math.abs(page.step.handle.state().selected!.moments[0]!.muB - first)).toBeLessThan(0.1 * page.step.view().fitRounds!.esd.mom_Mn1_0!);
    expect(page.step.handle.state().baselineAgreement).toBe(before);
    // Once the page's rows are no longer the ones the fit handed back (a nuclear refinement, a reset, an undo), the page's own value stands again.
    page.set(withMomentRoundRows(page.session(), reRefinedRows(page.nuclearOnly.powderParams)));
    expect(page.step.handle.state().baselineAgreement).toBeCloseTo(before, 12);
    page.set(withMomentRoundRows(page.session(), { scale: 0.079 }));
    expect(page.step.handle.state().baselineAgreement).toBeCloseTo(live(), 12);
    expect(page.step.handle.state().baselineAgreement).not.toBe(before);
  }, 60_000);
});

describe("a model shown on the refinement pattern follows Refine moments", () => {
  it("Show, then Refine moments: the page's model carries the fitted moments, and its pattern is the one fitted", async () => {
    const c = caseOf(MODEL_A, 6);
    const page = pageOf(c, 0);
    page.step.handle.choose(truthId(c, page.step));
    // Show on refinement pattern: the candidate at its seed amplitude (2 µB), no rows.
    page.step.show(true);
    expect(page.session().magnetic!.moments[0]!.components[1]).toBeCloseTo(2, 6);
    const wR = (await page.step.refineMoments())!;
    const shown = page.session().magnetic!;
    const fitted = page.step.view().applied!;
    expect(shown.moments).toEqual(fitted.moments);
    // The step keeps its fit's readout and its choice: the model coming back from the page is the one it fitted.
    expect(page.step.view().fitWR).toBeCloseTo(wR, 12);
    expect(page.step.view().fitRounds!.settled).toBe(true);
    expect(page.step.handle.state().selected!.id).toBe(truthId(c, page.step));
    expect(Math.abs(shown.moments[0]!.components[1]!)).toBeCloseTo(4.203, 2);
    // The page's own curve (nuclear + the shown model) at the page's rows is the fit's.
    expect(weightedR(page.session(), sessionCurves(page.session()), FIT_RANGE)).toBeCloseTo(wR, 6);
    // Another group chosen and refined: the page keeps the model it shows, and takes only the rows.
    const other = page.step.handle.state().candidates.find((g) => g.momentParameters === 2)!.id;
    page.step.handle.choose(other);
    await page.step.refineMoments();
    expect(page.session().magnetic!.moments).toEqual(shown.moments);
  }, 60_000);

  it("after Continue: the page's moment rows follow too", async () => {
    const c = caseOf(MODEL_A, 6);
    const page = pageOf(c, 0);
    page.step.handle.choose(truthId(c, page.step));
    page.step.continueToRefinement(false);
    expect(page.session().powderParams.find((p) => p.id === "mom_Mn1_0")!.value).toBeCloseTo(2, 6);
    await page.step.refineMoments();
    const row = page.session().powderParams.find((p) => p.id === "mom_Mn1_0")!;
    expect(row.value).toBe(page.step.view().resolvedAmps.mom_Mn1_0);
    expect(row.fixed).toBe(false);
    expect(Math.abs(row.value)).toBeCloseTo(4.203, 2);
  }, 60_000);
});

describe("Cancel, and the cap", () => {
  it("Cancel in the second round: the page, the amplitudes and the readout are as before Refine moments", async () => {
    const c = caseOf(MODEL_A, 6);
    const page = pageOf(c, 0);
    page.step.handle.choose(truthId(c, page.step));
    const session = page.session();
    const amps = page.step.view().resolvedAmps;
    const seen: (number | null)[] = [];
    const off = page.step.subscribe(() => {
      const round = page.step.state().refineRound?.round ?? null;
      if (seen.at(-1) !== round) seen.push(round);
      if (round === 2) page.step.cancelRefine();
    });
    const running = page.step.refineMoments();
    expect(page.step.state().refining).toBe(true);
    expect(await running).toBeNull();
    off();
    // It showed its rounds as they started, and stopped in the second.
    expect(seen).toEqual([null, 1, 2, null]);
    expect(page.step.state().refining).toBe(false);
    expect(page.step.state().refineRound).toBeNull();
    expect(page.session()).toBe(session);
    expect(page.step.view().resolvedAmps).toEqual(amps);
    expect(page.step.view().fitWR).toBeNull();
    expect(page.step.state().nuclearOnly).toBeNull();
    // And the next Refine moments runs to its end.
    expect(await page.step.refineMoments()).not.toBeNull();
    expect(page.step.view().fitRounds!.settled).toBe(true);
    expect(page.session()).not.toBe(session);
  }, 60_000);

  it("a model changed under a running fit stops it the same way", async () => {
    const c = caseOf(MODEL_A, 6);
    const page = pageOf(c, 0);
    page.step.handle.choose(truthId(c, page.step));
    const session = page.session();
    const off = page.step.subscribe(() => {
      if (page.step.state().refineRound?.round === 1 && page.step.state().chosen !== null) page.step.choose(null);
    });
    expect(await page.step.refineMoments()).toBeNull();
    off();
    expect(page.session()).toBe(session);
    expect(page.step.state().refining).toBe(false);
  }, 60_000);

  it("the cap: a fit that has not settled keeps its last moments step and says so", async () => {
    const c = caseOf(MODEL_A, 6);
    const points = noisy(c.clean, 0);
    const session = sessionOf(c, points, nuclearOnlyRows(c, points));
    const rows = [...session.powderParams, ...fitRows(c.build)];
    const steps: string[][] = [];
    const out = (await alternateMoments({
      rows, momentIds: ["mom_Mn1_0"], betweenIds: Object.keys(reRefinedRows(session.powderParams)), maxRounds: 2,
      fit: (r, options) => {
        steps.push(r.filter((p) => !p.fixed).map((p) => p.id));
        return refine(buildMagneticPowderProblem(c.structure, c.build.magnetic, session.pattern, r, [...c.bindings, ...c.build.bindings], session.powderProfile, FIT_RANGE), options);
      },
    }))!;
    // Two rounds are not enough here (2.4 esd still to go in the second): stopped at the cap, on a moments step.
    expect(out.rounds).toBe(2);
    expect(out.settled).toBe(false);
    expect(out.lastShiftOverEsd).toBeGreaterThan(1);
    expect(steps.map((s) => (s.length === 1 && s[0] === "mom_Mn1_0" ? "moments" : "between"))).toEqual(["moments", "between", "moments", "between", "moments"]);
    // No step frees a moment and a nuclear row together.
    for (const s of steps) expect(s.includes("mom_Mn1_0") && s.length > 1).toBe(false);
    expect(Object.keys(out.result.esd)).toEqual(["mom_Mn1_0"]);
    const rounds: MomentRounds = { held: out.held, count: out.rounds, settled: out.settled, lastShiftOverEsd: out.lastShiftOverEsd, esd: { mom_Mn1_0: out.result.esd.mom_Mn1_0! }, esdIncludes: out.result.diagnostics?.esdIncludes ?? [] };
    const said = momentFitReadout("wR", out.result.agreement.rWeighted!, rounds);
    expect(said.warning).toBe(true);
    expect(said.line).toMatch(/^wR = \d+\.\d% · not settled after 2 rounds \(a moment still moved by \d+\.\d\d esd\)$/);
    expect(said.details).toContain("The last moments step is kept.");
    expect(ALTERNATION_MAX_ROUNDS).toBe(10);
  }, 60_000);

  it("the readout: the result first on one line, the owner's wording behind it", async () => {
    const r = await refineMoments(MODEL_A, 0);
    const said = momentFitReadout("wR", r.page.step.view().fitWR!, r.rounds, { mom_Mn1_0: "Mn1 moment" });
    expect(said.line).toBe("wR = 5.0% · settled in 4 rounds");
    expect(said.warning).toBe(false);
    expect(said.details!.startsWith(MOMENT_ROUNDS_SUMMARY)).toBe(true);
    expect(MOMENT_ROUNDS_SUMMARY).toBe("Nuclear structure held; scale and background re-refined with the magnetic model.");
    expect(said.details).toContain("Esd: Mn1 moment ± 0.010, with the uncertainty of the scale and the background included.");
    // A fit that ran no rounds (a page whose fit has none) reads as it did.
    expect(momentFitReadout("wR2", 0.0731, null)).toEqual({ line: "wR2 = 7.3%", warning: false, details: null });
  }, 60_000);
});

describe("k = 0 (independent MnWO4): Refine moments no longer undoes the ranking", () => {
  it("a ferromagnet on the nuclear lines: ranked at 4.155, refined to 4.2 within 3 esd, the scale held in every moments step", async () => {
    const c = caseOf(MODEL_F_K0, 6);
    const page = pageOf(c, 0);
    const id = truthId(c, page.step);
    expect(page.step.handle.state().candidates.find((g) => g.id === id)!.symbol).toBe("P2/c");
    await page.step.rank("all", 2);
    const ranked = page.step.handle.state().candidates.find((g) => g.id === id)!.fit!.moments[0]!.muB;
    page.step.handle.choose(id);
    await page.step.refineMoments();
    const v = page.step.view();
    const refined = page.step.handle.state().selected!.moments[0]!.muB;
    const esd = v.fitRounds!.esd.mom_Mn1_0!;
    const joint = sequence(c, noisy(c.clean, 0), 0).joint;
    console.log(`[moment-rounds] k = 0 ferromagnet through the step: ranked (one fit, scale free) ${ranked.toFixed(3)} µB, Refine moments ${refined.toFixed(3)}(${(1000 * esd).toFixed(0)}) in ${v.fitRounds!.count} rounds; joint ${joint.moment.toFixed(3)}; truth 4.2`);
    // The ranking's one fit frees the scale at k = 0 and is 1–2 % low (its background is the nuclear-only fit's).
    expect(ranked).toBeCloseTo(4.155, 2);
    // Before the rounds this took the ranked moment down to 3.52.
    expect(refined).toBeGreaterThan(ranked);
    expect(Math.abs(refined - 4.2) / esd).toBeLessThan(3);
    // What is left when a shift falls below 0.1 esd is that shift times r/(1 − r): 0.07 esd at this case's contraction of 0.41 a round.
    expect(Math.abs(refined - joint.moment) / esd).toBeLessThan(0.1);
    expect(v.fitRounds!.settled).toBe(true);
    // The scale and the moment trade here: more rounds than at k ≠ 0, inside the cap.
    expect(v.fitRounds!.count).toBeGreaterThanOrEqual(5);
    expect(v.fitRounds!.count).toBeLessThanOrEqual(8);
    // The esd carries the trade: 30 % above the moments-only one.
    expect(esd / joint.quotedEsd[0]!).toBeCloseTo(1, 2);
    expect(K0_SCALE_WITH_MOMENTS).toBe(false);
  }, 60_000);

  it("an antiferromagnet in the cell: within 3 esd in four seeds", async () => {
    const runs = await Promise.all([0, 1, 2, 3].map((seed) => refineMoments(MODEL_A_K0, seed)));
    console.log(`[moment-rounds] k = 0 antiferromagnet: ${runs.map((r) => `${r.moment.toFixed(3)}(${(1000 * r.esd[0]!).toFixed(0)}) in ${r.rounds.count}`).join(" ")}`);
    for (const r of runs) {
      expect(Math.abs(r.moment - 4.2) / r.esd[0]!).toBeLessThan(3);
      expect(r.rounds.settled).toBe(true);
    }
  }, 60_000);

  it("the other choice, kept behind K0_SCALE_WITH_MOMENTS: the scale free with the moments ends on the same moment in fewer rounds", async () => {
    const c = caseOf(MODEL_F_K0, 6);
    const held = await refineMoments(MODEL_F_K0, 0);
    const page = pageOf(c, 0);
    const session = page.session();
    // What the moments fit runs when the switch is on: the scale in the moments steps, the background between them.
    // The fit takes no such choice from a caller, so this asks the loop under it, on the rows the page's fit passes.
    const reRefined = Object.keys(reRefinedRows(session.powderParams));
    const free = (await alternateMoments({
      rows: [...session.powderParams, ...fitRows(c.build)], momentIds: ["scale", "mom_Mn1_0"], betweenIds: reRefined,
      fit: (r, options) => refine(buildMagneticPowderProblem(c.structure, c.build.magnetic, session.pattern, r, [...c.bindings, ...c.build.bindings], session.powderProfile, FIT_RANGE), options),
    }))!;
    expect(free.settled).toBe(true);
    expect(free.rounds).toBeLessThanOrEqual(3);
    expect(free.rounds).toBeLessThan(held.rounds.count);
    expect(Math.abs(page.fitter.moment(free.values) - held.moment) / held.esd[0]!).toBeLessThan(0.1);
    // The scale it refined with the moments is among the rows a fit hands back, with the background, and the esd is the same.
    expect(reRefined.sort()).toEqual(Object.keys(held.rounds.held).sort());
    expect(free.values.scale! / held.rounds.held.scale!).toBeCloseTo(1, 2);
    expect(free.result.esd.mom_Mn1_0! / held.esd[0]!).toBeCloseTo(1, 2);
  }, 60_000);
});

describe("the method's order: rounds, the moments alone, the final instrument pass, the moments alone again", () => {
  /** Free exactly these kinds on the page, then the Refine button's fit, its values on the page. */
  async function refineKinds(session: Session, client: ComputeClient, free: (p: RefinementParameter) => boolean): Promise<{ session: Session; result: RefinementResult }> {
    const next = { ...session, powderParams: session.powderParams.map((p) => ({ ...p, fixed: !!p.expression || !free(p) })) };
    const result = await powderFit(client, { session: next, instrument: DEFAULT_INSTRUMENT, fitRange: FIT_RANGE, result: null }, { maxIterations: 20 });
    return { session: withFitResult(next, result), result };
  }
  const isMoment = (p: RefinementParameter): boolean => p.kind === "momentMode";
  /** The final instrument pass on this page: its one instrument term (the peak width), with the scale and the background. */
  const isPass = (p: RefinementParameter): boolean => p.kind === "peakWidth" || p.kind === "scale" || p.kind === "background";

  for (const [name, model, truth] of [["one moment row", MODEL_A, [4.2]], ["two moment rows", MODEL_B, [3, 2]]] as const) {
    it(`${name}: the moments after the pass are the joint fit's (width included), and the pass moved them by a fraction of an esd`, async () => {
      const c = caseOf(model, 6);
      const client = new ComputeClient();
      const rows: string[] = [];
      for (const seed of [0, 1, 2, 3]) {
        // Stage 3: refine_moments (rounds). Stage 4: on the refinement page, the moments alone.
        const r = await refineMoments(model, seed);
        r.page.step.continueToRefinement(false);
        const stage4 = await refineKinds(r.page.session(), client, isMoment);
        const ids = Object.keys(stage4.result.esd);
        // Stage 5: the pass (the moments held), then the moments alone again.
        const pass = await refineKinds(stage4.session, client, isPass);
        const last = await refineKinds(pass.session, client, isMoment);
        // The reference no step of the app runs: the scale, the background, the width and the moments together.
        const joint = sequence(c, noisy(c.clean, seed), 0, NUCLEAR_SETS.scaleBackgroundWidth).joint;
        const shift = ids.map((id) => Math.abs(last.result.parameters[id]! - stage4.result.parameters[id]!) / last.result.esd[id]!);
        const left = ids.map((id, i) => Math.abs(Math.abs(last.result.parameters[id]!) - Math.abs(joint.components[i]!)) / last.result.esd[id]!);
        rows.push(`seed ${seed}: stage 4 ${ids.map((id) => stage4.result.parameters[id]!.toFixed(4)).join(", ")} → after the pass ${ids.map((id) => `${last.result.parameters[id]!.toFixed(4)}(${(1e4 * last.result.esd[id]!).toFixed(0)})`).join(", ")} · moved ${shift.map((x) => x.toFixed(2)).join(", ")} esd · from the joint fit ${left.map((x) => x.toFixed(2)).join(", ")} esd · wR ${(100 * stage4.result.agreement.rWeighted!).toFixed(3)} → ${(100 * pass.result.agreement.rWeighted!).toFixed(3)} → ${(100 * last.result.agreement.rWeighted!).toFixed(3)} %`);
        // Stage 4 after the rounds moves nothing.
        ids.forEach((id, i) => expect(Math.abs(stage4.result.parameters[id]! - r.components[i]!) / stage4.result.esd[id]!).toBeLessThan(0.1));
        // The owner's rule for the last tweak: the moments stay within about their esds across the profile pass. Here well within.
        for (const x of shift) expect(x).toBeLessThan(0.5);
        // And the last moments step lands on the joint answer, within the truth's esd.
        for (const x of left) expect(x).toBeLessThan(0.15);
        ids.forEach((id, i) => expect(Math.abs(Math.abs(last.result.parameters[id]!) - truth[i]!) / last.result.esd[id]!).toBeLessThan(3));
        // The pass refined the width the nuclear-only fit left 1 % wide, and every esd in the last step includes the scale and the background.
        expect(pass.session.powderParams.find((p) => p.id === "width")!.value).toBeLessThan(stage4.session.powderParams.find((p) => p.id === "width")!.value);
        expect(Object.keys(last.result.esd)).toEqual(ids);
        expect(last.result.diagnostics?.esdIncludes?.length).toBe(7);
      }
      console.log(`[moment-order] ${name}\n  ${rows.join("\n  ")}`);
    }, 60_000);
  }
});

describe("noise-free through the step: the rounds end on the truth, not on the cap", () => {
  it("k = (½, 0, 0) and the k = 0 ferromagnet", async () => {
    const a = await refineMoments(MODEL_A, "clean");
    const f = await refineMoments(MODEL_F_K0, "clean");
    console.log(`[moment-rounds] noise-free: A ${a.moment.toFixed(4)} in ${a.rounds.count}, k = 0 ferromagnet ${f.moment.toFixed(4)} in ${f.rounds.count}`);
    // The esds shrink with the misfit on such data, so a shift cannot be measured in them: the rounds stop when it is negligible.
    for (const r of [a, f]) {
      expect(r.rounds.settled).toBe(true);
      expect(r.rounds.count).toBeLessThanOrEqual(ALTERNATION_MAX_ROUNDS);
      expect(r.moment).toBeCloseTo(4.2, 2);
    }
  }, 60_000);
});
