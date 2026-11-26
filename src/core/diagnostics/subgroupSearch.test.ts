import { describe, expect, it } from "vitest";
import {
  SEARCH_RULES, agreeingCount, beamOf, bicOf, deltaBicOf, independentPoints, rmaxAllowing, searchStep1, searchStep2, searchStep3Layer, startPlan, toppedUpStarts, topIrreps,
  type CandidateRow, type FitReading, type PreparedCandidate, type Reference, type SearchCandidate, type SearchHost, type StartPlan, type StepContext, type Window,
} from "@/core/diagnostics/subgroupSearch";
import { firstPeak } from "@/core/totalscattering/firstPeak";

/**
 * The subgroup search's rules (THY-72) on a host whose fits are made up: what
 * each number decides, without a structure. The known-truth runs on simulated
 * SrTiO₃ and GaTa₄Se₈ are in app/pdfSubgroupSearch.test.ts.
 */

const QMAX = 25;
const WINDOW: Window = { rmin: 1.6, rmax: 10 };
const N_IND = independentPoints(WINDOW, QMAX);

/** A made-up candidate's behaviour: its best Rw by window, how its starts spread, its amplitude and esd. */
interface Fake {
  readonly rw: (w: Window) => number;
  readonly modes?: number;
  /** Starts with this index or above reach the best; below, 5 % worse. */
  readonly agreeFrom?: number;
  readonly amplitude?: number;
  readonly esd?: number;
  readonly converged?: boolean;
  readonly displacement?: number;
  readonly nonPositiveAdp?: readonly string[];
  readonly bvs?: number;
  readonly holds?: boolean;
}

const reading = (rw: number, f: Partial<Fake>): FitReading => ({
  rw,
  converged: f.converged ?? true,
  status: f.converged === false ? "maxIterations" : "converged",
  values: {},
  amplitudes: [{ label: "R irrep 8 of 10", amplitude: f.amplitude ?? 0.8, esd: f.esd ?? 0.01 }],
  maxDisplacement: f.displacement ?? 0.2,
  nonPositiveAdp: f.nonPositiveAdp ?? [],
  bondValence: f.bvs === undefined ? [] : [{ site: "Ti", deviation: f.bvs }],
});

function hostOf(fakes: Record<string, Fake>, log: string[] = []): SearchHost {
  const preparedOf = (key: string, f: Fake, held: readonly string[]): PreparedCandidate => ({
    parameters: 4 + (f.modes ?? 1) - held.length,
    modeIds: Array.from({ length: f.modes ?? 1 }, (_, i) => `mode_${i + 1}`),
    heldByGuard: held,
    fit: async (plan: StartPlan, w: Window) => {
      log.push(`${key}#${plan.index}`);
      const best = f.rw(w);
      return reading(plan.index >= (f.agreeFrom ?? 0) ? best : best * 1.05, f);
    },
    refitFrom: async (_v, w) => reading(f.rw(w), f),
    guard: async () => (f.holds && held.length === 0 ? preparedOf(key, f, ["mode_2 (mode_1 ↔ mode_2 0.990)"]) : null),
  });
  return {
    qmax: QMAX,
    windowData: (w) => ({ nGrid: Math.round((w.rmax - w.rmin) / 0.02) + 1, sumObs2: 1000 }),
    prepare: async (c) => preparedOf(c.key, fakes[c.key]!, []),
  };
}

const parentRw = (w: Window): number => 0.1 * (1 + 0.01 * (w.rmax - 10));
const parent: Reference = { label: "Pm-3m (parent)", parameters: 4, refit: async (w) => reading(parentRw(w), {}) };

const cand = (key: string, irreps: readonly string[] = ["R irrep 8 of 10"], moves = true): SearchCandidate => ({
  key,
  classKey: key,
  group: key,
  cell: "2×2×2",
  index: 8,
  irreps: irreps.map((label) => ({ label, direction: "(a,a,a)" })),
  freeIrreps: irreps.map((label) => ({ label, direction: "(a,a,a)" })),
  moves,
});

const ctxOf = (host: SearchHost, extra: Partial<StepContext> = {}): StepContext => ({ host, window: WINDOW, firstPeakPast: 2.2, ...extra });
const rowOf = (rows: readonly CandidateRow[], key: string): CandidateRow => rows.find((r) => r.candidate.key === key)!;

describe("the statistics (decision 1)", () => {
  it("count the window's independent points by Qmax, and BIC and ΔBIC as decided", () => {
    expect(N_IND).toBeCloseTo((8.4 * 25) / Math.PI, 12);
    const nGrid = 421;
    const b = (rw: number, p: number) => bicOf(rw, 1000, nGrid, N_IND, p);
    // ΔBIC is the difference of the two BICs on the same data and window.
    expect(b(0.05, 5) - b(0.1, 4)).toBeCloseTo(deltaBicOf(0.05, 0.1, 1, N_IND), 10);
    expect(deltaBicOf(0.1, 0.1, 2, N_IND)).toBeCloseTo(2 * Math.log(N_IND), 12);
  });

  it("give the rmax at which p stays within N_ind/4", () => {
    const r = rmaxAllowing(20, 1.6, QMAX);
    expect(independentPoints({ rmin: 1.6, rmax: r }, QMAX) / 4).toBeCloseTo(20, 10);
  });
});

describe("the starts (decision 7)", () => {
  it("are the activation's own, then kicks mostly ≤ 0.1 Å and a few of 0.2–0.3 Å, some with the ADPs at half", () => {
    const plans = Array.from({ length: 30 }, (_, i) => startPlan(i, 3, 7));
    expect(plans[0]).toEqual({ index: 0, kick: 0, direction: [], adpFactor: 1 });
    for (const p of plans.slice(1)) {
      const slot = p.index % 10;
      const [lo, hi] = slot >= 8 || slot === 0 ? [0.2, 0.3] : [0.02, 0.1];
      expect(p.kick).toBeGreaterThanOrEqual(lo);
      expect(p.kick).toBeLessThanOrEqual(hi);
      expect(Math.hypot(...p.direction)).toBeCloseTo(1, 12);
      expect(p.adpFactor).toBe([3, 6, 9].includes(slot) ? 0.5 : 1);
    }
    expect(plans.slice(1, 10).filter((p) => p.kick <= 0.1)).toHaveLength(7);
    // The same start for the same seed, whatever ran before.
    expect(startPlan(17, 3, 7)).toEqual(plans[17]);
    expect(startPlan(17, 3, 8)).not.toEqual(plans[17]);
  });

  it("top up to max(20, 10 × the new parameters)", () => {
    expect(toppedUpStarts(1)).toBe(20);
    expect(toppedUpStarts(3)).toBe(30);
  });

  it("agree when within 0.1 % (relative) of the best Rw", () => {
    expect(agreeingCount([0.1, 0.10009, 0.1001, 0.10011, NaN], 0.001)).toBe(3);
  });
});

describe("step 1: the gate and the stop rules", () => {
  it("accepts a child that passes all five criteria, and lists the ones that fail with their reasons", async () => {
    const fakes: Record<string, Fake> = {
      good: { rw: (w) => 0.5 * parentRw(w) },
      noise: { rw: (w) => 0.995 * parentRw(w) },
      small: { rw: (w) => 0.5 * parentRw(w), amplitude: 0.02, esd: 0.01 },
      lonely: { rw: (w) => 0.5 * parentRw(w), agreeFrom: 19 },
      edge: { rw: (w) => (w.rmax < 10 ? 0.5 : w.rmax > 10 ? 1.01 : 0.5) * parentRw(w) },
      npd: { rw: (w) => 0.5 * parentRw(w), nonPositiveAdp: ["O1"] },
      bvs: { rw: (w) => 0.5 * parentRw(w), bvs: 0.2 },
    };
    const step = await searchStep1(ctxOf(hostOf(fakes)), parent, Object.keys(fakes).map((k) => cand(k)));
    expect(step.rows[0]!.candidate.key).toBe("good");
    const good = rowOf(step.rows, "good");
    expect(good.gate!.accepted).toBe(true);
    expect([good.p, good.dp, good.startsRun]).toEqual([5, 1, 20]);
    expect(good.deltaBic).toBeCloseTo(deltaBicOf(0.05, 0.1, 1, N_IND), 10);
    const reason = (k: string) => rowOf(step.rows, k).gate!.reasons.join(" | ");
    expect(rowOf(step.rows, "noise").startsRun).toBe(10); // ΔBIC > 0 after 10: no top-up, no refits
    expect(reason("noise")).toMatch(/ΔBIC 3\.\d \(needs ≤ -6\)/);
    expect(reason("small")).toMatch(/0\.020 Å = 0\.8σ \(needs ≥ 3σ\)/);
    // σ is the fit's esd × √(N_grid/N_ind).
    const s = rowOf(step.rows, "small").gate!.amplitude.sigmas[0]!;
    expect(s.sigma).toBeCloseTo(0.01 * Math.sqrt(421 / N_IND), 10);
    expect(reason("lonely")).toMatch(/1 of 20 starts/);
    expect(reason("edge")).toMatch(/at 12 Å/);
    expect(reason("npd")).toMatch(/non-positive ADP at O1/);
    expect(reason("bvs")).toMatch(/20\.0 % at Ti/);
    for (const k of ["noise", "small", "lonely", "edge", "npd", "bvs"]) expect(rowOf(step.rows, k).gate!.accepted).toBe(false);
    expect(step.stop).toBeNull();
  });

  it("marks failed fits, lists strain-only classes and classes over N_ind/4 without fitting, and says when nothing passes", async () => {
    const fakes: Record<string, Fake> = {
      worse: { rw: (w) => 1.01 * parentRw(w) },
      stuck: { rw: (w) => 0.5 * parentRw(w), converged: false },
      far: { rw: (w) => 0.5 * parentRw(w), displacement: 0.6 },
      big: { rw: (w) => 0.5 * parentRw(w), modes: 14 },
    };
    const log: string[] = [];
    const step = await searchStep1(ctxOf(hostOf(fakes, log)), parent, [...Object.keys(fakes).map((k) => cand(k)), cand("strain", ["Γ irrep 5 of 10"], false)]);
    expect(rowOf(step.rows, "worse").reason).toMatch(/worse than its parent/);
    expect(rowOf(step.rows, "stuck").reason).toMatch(/did not converge/);
    expect(rowOf(step.rows, "far").reason).toMatch(/moves 0\.600 Å/);
    for (const k of ["worse", "stuck", "far"]) expect(rowOf(step.rows, k).status).toBe("fit failed");
    const big = rowOf(step.rows, "big");
    expect([big.status, big.p]).toEqual(["not fitted", 18]);
    expect(big.reason).toMatch(/exceed N_ind\/4 = 16\.7; rmax ≥ 10\.6\d Å/);
    expect(rowOf(step.rows, "strain").reason).toMatch(/strain or ordering only/);
    expect(log.some((x) => x.startsWith("big") || x.startsWith("strain"))).toBe(false);
    expect(step.rows.map((r) => r.status)).toEqual(["fit failed", "fit failed", "fit failed", "not fitted", "not fitted"]);
    expect(step.stop).toBe("no child passes the gate");
  });

  it("marks a child whose gain is only from the first peak", async () => {
    const step = await searchStep1(ctxOf(hostOf({ peak: { rw: (w) => (w.rmin > 2 ? 1 : 0.5) * parentRw(w) } })), parent, [cand("peak")]);
    const row = step.rows[0]!;
    expect(row.gate!.accepted).toBe(true);
    expect(row.firstPeak).toMatchObject({ rmin: 2.2, gainOnlyFromFirstPeak: true });
    expect(beamOf(step.rows)).toHaveLength(0);
  });

  it("runs the starts again with the rows the correlation guard holds, and counts p without them", async () => {
    const step = await searchStep1(ctxOf(hostOf({ two: { rw: (w) => 0.5 * parentRw(w), modes: 2, holds: true } })), parent, [cand("two")]);
    const row = step.rows[0]!;
    expect([row.p, row.dp, row.startsRun]).toEqual([5, 1, 20]);
    expect(row.heldByGuard).toEqual(["mode_2 (mode_1 ↔ mode_2 0.990)"]);
  });

  it("names the candidates its budget left, and the ones a stop left", async () => {
    let t = 0;
    const fakes = Object.fromEntries(["a", "b", "c"].map((k) => [k, { rw: (w: Window) => 0.995 * parentRw(w) }]));
    const host = hostOf(fakes);
    const slow: SearchHost = { ...host, prepare: async (c, w) => { t += 0.4 * SEARCH_RULES.stepBudgetMs; return host.prepare(c, w); } };
    const step = await searchStep1(ctxOf(slow, { now: () => t }), parent, ["a", "b", "c"].map((k) => cand(k)));
    expect(step.ended).toBe("budget");
    expect(step.unfinished).toEqual(["c"]);
    expect(rowOf(step.rows, "c").reason).toMatch(/budget ended/);
    expect(step.stop).toBeNull();
    const ac = new AbortController();
    ac.abort();
    const stopped = await searchStep1(ctxOf(host, { signal: ac.signal }), parent, ["a", "b"].map((k) => cand(k)));
    expect([stopped.ended, stopped.unfinished]).toEqual(["stopped", ["a", "b"]]);
  });
});

describe("steps 2 and 3", () => {
  it("step 2 pairs only irreps among step 1's top three, and only after step 1 accepted a child", async () => {
    const fakes: Record<string, Fake> = {
      R: { rw: (w) => 0.5 * parentRw(w) },
      M: { rw: (w) => 0.6 * parentRw(w) },
      X: { rw: (w) => 0.9 * parentRw(w) },
      Y: { rw: (w) => 0.95 * parentRw(w) },
      RM: { rw: (w) => 0.3 * parentRw(w), modes: 2 },
      RY: { rw: (w) => 0.3 * parentRw(w), modes: 2 },
    };
    const host = hostOf(fakes);
    const step1 = await searchStep1(ctxOf(host), parent, [cand("R", ["R8"]), cand("M", ["M3"]), cand("X", ["X5"]), cand("Y", ["Y1"])]);
    expect(topIrreps(step1)).toEqual(["R8", "M3", "X5"]);
    const step2 = await searchStep2(ctxOf(host), parent, step1, [cand("RM", ["R8", "M3"]), cand("RY", ["R8", "Y1"])]);
    expect(step2.rows.map((r) => r.candidate.key)).toEqual(["RM"]);
    expect(step2.rows[0]!.gate!.accepted).toBe(true);
    const none = await searchStep1(ctxOf(host), parent, [cand("Y", ["Y1"])]);
    expect((await searchStep2(ctxOf(host), parent, none, [cand("RM", ["R8", "M3"])])).rows).toHaveLength(0);
  });

  it("step 3 keeps the best three with near-ties, and fits a class under several parents once", async () => {
    const rows = [0, 1, 2, 3, 4].map((i): CandidateRow => ({ candidate: cand(`n${i}`), reference: "p", status: "fitted", bic: [10, 11, 12, 13.5, 20][i]!, gate: { accepted: true } as NonNullable<CandidateRow["gate"]> }));
    expect(beamOf(rows).map((r) => r.candidate.key)).toEqual(["n0", "n1", "n2", "n3"]);
    const fakes: Record<string, Fake> = { d: { rw: (w) => 0.3 * parentRw(w), modes: 2 } };
    const node = (k: string, bic: number) => ({ row: { ...rows[0]!, candidate: cand(k), bic }, reference: { label: k, parameters: 5, refit: async (w: Window) => reading(0.5 * parentRw(w), {}) } });
    const layer = await searchStep3Layer(ctxOf(hostOf(fakes)), [node("A", 12), node("B", 10)], () => [cand("d", ["X5"])], 1);
    expect(layer.rows).toHaveLength(1);
    expect(layer.rows[0]!.reference).toBe("B");
    expect(layer.rows[0]!.alsoUnder).toEqual(["A"]);
    expect([layer.rows[0]!.p, layer.rows[0]!.dp]).toEqual([6, 1]);
  });
});

describe("the first G(r) peak (decision 10)", () => {
  it("is found against the density line, whatever its sign, with the window just below it and the check just past it", () => {
    const r = Array.from({ length: 600 }, (_, i) => 0.5 + 0.02 * i);
    const g = r.map((x) => -1.05 * x - 4.5 * Math.exp(-((x - 1.96) ** 2) / (2 * 0.07 ** 2)) + 20 * Math.exp(-((x - 2.77) ** 2) / (2 * 0.08 ** 2)));
    const peak = firstPeak(r, g, 10)!;
    expect(peak.r).toBeCloseTo(1.96, 6);
    expect(peak.height).toBeLessThan(0);
    const hwhm = 0.07 * Math.sqrt(2 * Math.log(2));
    expect(Math.abs(peak.below - (1.96 - 2 * hwhm))).toBeLessThanOrEqual(0.021);
    expect(Math.abs(peak.past - (1.96 + 2 * hwhm))).toBeLessThanOrEqual(0.021);
    expect(peak.baselineSlope).toBeCloseTo(-1.05, 2);
  });
});
