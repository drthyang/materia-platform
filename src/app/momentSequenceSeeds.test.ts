import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  alternatingFit, caseOf, noisy, nuclearOnlyRows, powderMomentFit, rankUnder, sequence, sessionOf,
  FIT_RANGE, MODEL_A, MODEL_A_K0, MODEL_B, MODEL_F_K0, NUCLEAR_SETS, type MomentsStep,
} from "@/testSupport/momentSequenceCase";
import type { ParameterKind } from "@/core/refinement/types";
import type { SpinModel } from "@/testSupport/independentMnwo4";
import { momentSize } from "@/testSupport/independentMnwo4";

/**
 * The many-seed run behind docs/reports/2026-11-19-moments-alternation.md:
 * today's sequence, the alternation round by round and the joint fit, on the
 * independent MnWO₄ patterns, with the scatter of the moment against the two
 * esds. Too long for the suite (about a minute for 200 seeds), so it runs
 * only when asked:
 *
 *   MOMENT_SEQUENCE_SEEDS=200 MOMENT_SEQUENCE_OUT=<folder> npx vitest run src/app/momentSequenceSeeds.test.ts
 *
 * and writes one JSON per case into the folder. The suite's own fixed-seed
 * version is momentSequenceBias.test.ts.
 */
const SEEDS = Number(process.env.MOMENT_SEQUENCE_SEEDS ?? 0);
const OUT = process.env.MOMENT_SEQUENCE_OUT;
/** Run only the cases whose name contains this. */
const ONLY = process.env.MOMENT_SEQUENCE_CASE;
/** Seeds for the ranking comparison (each ranks 11 groups twice; about 12 s a seed). */
const RANK_SEEDS = Number(process.env.MOMENT_SEQUENCE_RANK ?? 0);

interface SeedCase {
  readonly name: string;
  readonly model: SpinModel;
  readonly terms: number;
  readonly between: readonly ParameterKind[];
  /** Kinds refined with the moments in a moments step (the page's freeScale at k = 0). */
  readonly withMoments?: readonly ParameterKind[];
  readonly rounds?: number;
}

const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: readonly number[]): number => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

function summary(steps: readonly MomentsStep[], truth: readonly number[], truthSize: number) {
  const size = steps.map((s) => s.moment);
  return {
    moment: mean(size), bias: mean(size) - truthSize,
    components: truth.map((t, i) => {
      const v = steps.map((s) => Math.abs(s.components[i]!));
      const quoted = mean(steps.map((s) => s.quotedEsd[i]!));
      const full = mean(steps.map((s) => s.fullEsd[i]!));
      return { mean: mean(v), bias: mean(v) - t, scatter: sd(v), quotedEsd: quoted, fullEsd: full, biasOverQuoted: (mean(v) - t) / quoted, scatterOverQuoted: sd(v) / quoted, scatterOverFull: sd(v) / full };
    }),
    scale: mean(steps.map((s) => s.scale)), background: mean(steps.map((s) => s.background)), width: mean(steps.map((s) => s.width)),
    gof: mean(steps.map((s) => s.gof)), wR: mean(steps.map((s) => s.wR)),
    ...(steps[0]!.shiftOverEsd !== undefined ? { shiftOverEsd: { mean: mean(steps.map((s) => s.shiftOverEsd!)), max: Math.max(...steps.map((s) => s.shiftOverEsd!)) } } : {}),
  };
}

describe.skipIf(!(SEEDS > 0))(`the moments sequence over ${SEEDS} noise seeds (independent MnWO4, truth known)`, () => {
  const cases: readonly SeedCase[] = [
    { name: "A-6terms", model: MODEL_A, terms: 6, between: NUCLEAR_SETS.scaleBackground },
    { name: "A-1term", model: MODEL_A, terms: 1, between: NUCLEAR_SETS.scaleBackground },
    { name: "B-6terms", model: MODEL_B, terms: 6, between: NUCLEAR_SETS.scaleBackground },
    { name: "B-1term", model: MODEL_B, terms: 1, between: NUCLEAR_SETS.scaleBackground },
    { name: "A-6terms-width", model: MODEL_A, terms: 6, between: NUCLEAR_SETS.scaleBackgroundWidth },
    { name: "B-6terms-width", model: MODEL_B, terms: 6, between: NUCLEAR_SETS.scaleBackgroundWidth },
    // k = 0: the moments step with the scale held (the step's Refine moments today), and with the scale free (the ranking's freeScale).
    { name: "k0-antiferro-scaleHeld", model: MODEL_A_K0, terms: 6, between: NUCLEAR_SETS.scaleBackground, rounds: 12 },
    { name: "k0-antiferro-scaleFree", model: MODEL_A_K0, terms: 6, between: ["background"], withMoments: ["scale"], rounds: 12 },
    { name: "k0-ferro-scaleHeld", model: MODEL_F_K0, terms: 6, between: NUCLEAR_SETS.scaleBackground, rounds: 12 },
    { name: "k0-ferro-scaleFree", model: MODEL_F_K0, terms: 6, between: ["background"], withMoments: ["scale"], rounds: 12 },
  ];

  for (const c of cases.filter((x) => !ONLY || x.name.includes(ONLY))) {
    it(c.name, { timeout: 12 * 60 * 1000 }, () => {
      const ROUNDS = c.rounds ?? 6;
      const t0 = Date.now();
      const made = caseOf(c.model, c.terms);
      // The app's rows are along â, b̂, ĉ: the truth of each free row is the generator's component.
      const truth = c.model.mnY.filter((v) => v !== 0).map(Math.abs);
      const truthSize = momentSize(c.model.mnY);
      const runs = Array.from({ length: SEEDS }, (_, seed) => sequence(made, noisy(made.clean, seed), ROUNDS, c.between, NUCLEAR_SETS.scaleBackgroundWidth, c.withMoments ?? []));
      // The rounds a rule "stop when every moment row moved by less than `tol` of its esd" takes (ROUNDS + 1: not within the rounds run).
      const roundsTo = (tol: number): number[] => runs.map((r) => {
        const at = r.steps.findIndex((s) => s.shiftOverEsd !== undefined && s.shiftOverEsd < tol);
        return at < 0 ? ROUNDS + 1 : at;
      });
      const out = {
        case: c.name, seeds: SEEDS, truth, truthSize, between: c.between, withMoments: c.withMoments ?? [],
        truthHeld: summary(runs.map((r) => r.truthHeld), truth, truthSize),
        steps: Array.from({ length: ROUNDS + 1 }, (_, i) => summary(runs.map((r) => r.steps[i]!), truth, truthSize)),
        joint: summary(runs.map((r) => r.joint), truth, truthSize),
        // What is left against the joint fit after r rounds, in quoted esds of the first row: the mean and the worst seed.
        leftAgainstJoint: Array.from({ length: ROUNDS + 1 }, (_, i) => {
          const d = runs.map((r) => Math.max(...r.steps[i]!.components.map((x, j) => Math.abs(Math.abs(x) - Math.abs(r.joint.components[j]!)) / r.steps[i]!.quotedEsd[j]!)));
          return { mean: mean(d), max: Math.max(...d) };
        }),
        roundsToStop: Object.fromEntries([0.5, 0.2, 0.1, 0.05].map((tol) => {
          const n = roundsTo(tol);
          // What is left against the joint fit where the rule stops, in quoted esds: the worst seed.
          const left = runs.map((r, i) => {
            const at = r.steps[Math.min(n[i]!, ROUNDS)]!;
            return Math.max(...at.components.map((x, j) => Math.abs(Math.abs(x) - Math.abs(r.joint.components[j]!)) / at.quotedEsd[j]!));
          });
          return [tol, { mean: mean(n), max: Math.max(...n), histogram: Array.from({ length: ROUNDS + 2 }, (_, k) => n.filter((v) => v === k).length), leftMax: Math.max(...left) }];
        })),
        seconds: (Date.now() - t0) / 1000,
      };
      const line = (label: string, s: ReturnType<typeof summary>): string =>
        `${label.padEnd(10)} |M| ${s.moment.toFixed(4)} (${s.bias >= 0 ? "+" : ""}${s.bias.toFixed(4)}) · ` +
        s.components.map((k) => `${k.mean.toFixed(4)} bias/esd ${k.biasOverQuoted.toFixed(2)} scatter ${k.scatter.toFixed(4)} quoted ${k.quotedEsd.toFixed(4)} (${k.scatterOverQuoted.toFixed(2)}) full ${k.fullEsd.toFixed(4)} (${k.scatterOverFull.toFixed(2)})`).join(" | ") +
        ` · scale ${s.scale.toFixed(5)} bkg ${s.background.toFixed(1)} width ${s.width.toFixed(4)} GoF ${s.gof.toFixed(2)}${s.shiftOverEsd ? ` · shift/esd mean ${s.shiftOverEsd.mean.toFixed(2)} max ${s.shiftOverEsd.max.toFixed(2)}` : ""}`;
      console.log([`[moment-sequence] ${c.name}, ${SEEDS} seeds, truth ${truth.join(", ")} (${truthSize.toFixed(4)} µB), ${out.seconds.toFixed(0)} s`,
        line("truth held", out.truthHeld), ...out.steps.map((s, i) => line(i === 0 ? "today" : `${i} round${i > 1 ? "s" : ""}`, s)), line("joint", out.joint),
        `left against the joint fit (quoted esds), mean/max by round: ${out.leftAgainstJoint.map((l) => `${l.mean.toFixed(3)}/${l.max.toFixed(3)}`).join("  ")}`,
        `rounds to stop: ${Object.entries(out.roundsToStop).map(([tol, r]) => `<${tol}: mean ${r.mean.toFixed(2)} max ${r.max} [${r.histogram.join(",")}] left ≤ ${r.leftMax.toFixed(3)}`).join(" · ")}`].join("\n"));
      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(resolve(OUT, `moment-sequence-${c.name}-${SEEDS}seeds.json`), JSON.stringify(out, null, 2) + "\n");
      }
      expect(runs).toHaveLength(SEEDS);
    });
  }
});

describe.skipIf(!(RANK_SEEDS > 0))(`the ranking under today's single pass and under the alternation, ${RANK_SEEDS} seeds (independent MnWO4)`, () => {
  for (const [name, model] of [["A", MODEL_A], ["B", MODEL_B]] as const) {
    it(`model ${name}`, { timeout: 25 * 60 * 1000 }, async () => {
      const c = caseOf(model, 6);
      const rows: { seed: number; sameBest: boolean; sameSet: boolean; sameTwins: boolean; single: Awaited<ReturnType<typeof rankUnder>>; alternating: Awaited<ReturnType<typeof rankUnder>>; rounds: number[] }[] = [];
      for (let seed = 0; seed < RANK_SEEDS; seed++) {
        const points = noisy(c.clean, seed);
        const nuclear = nuclearOnlyRows(c, points);
        // Today: the page's own fit (powderMomentFit → momentFitRequest), every nuclear row held.
        const single = await rankUnder(c, powderMomentFit(null, sessionOf(c, points, nuclear), FIT_RANGE));
        const counts = { rounds: [] as number[] };
        const alternating = await rankUnder(c, alternatingFit(c, points, nuclear, counts));
        rows.push({
          seed, single, alternating, rounds: counts.rounds,
          sameBest: single.best === alternating.best,
          sameSet: single.withinNoise.join("|") === alternating.withinNoise.join("|"),
          sameTwins: single.twins.join("|") === alternating.twins.join("|"),
        });
      }
      const count = (pick: (r: (typeof rows)[number]) => boolean): number => rows.filter(pick).length;
      console.log(`[moment-ranking] model ${name}, ${RANK_SEEDS} seeds: same ★ ${count((r) => r.sameBest)}, same within-noise set ${count((r) => r.sameSet)}, same twins ${count((r) => r.sameTwins)} · ★ ${[...new Set(rows.map((r) => `${r.single.best} → ${r.alternating.best}`))].join("; ")} · sets ${[...new Set(rows.map((r) => `{${r.single.withinNoise.join(", ")}} → {${r.alternating.withinNoise.join(", ")}}`))].join("; ")} · rounds per fit ${Math.min(...rows.flatMap((r) => r.rounds))}–${Math.max(...rows.flatMap((r) => r.rounds))}`);
      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(resolve(OUT, `moment-ranking-${name}-${RANK_SEEDS}seeds.json`), JSON.stringify(rows, null, 2) + "\n");
      }
      expect(rows).toHaveLength(RANK_SEEDS);
    });
  }
});
