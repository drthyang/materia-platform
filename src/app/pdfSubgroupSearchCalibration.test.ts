import { describe, it } from "vitest";
import { appendFileSync } from "node:fs";
import { ComputeClient } from "@/workers/computeClient";
import { pdfPage } from "@/app/pdfPage";
import { pdfSearchContext } from "@/app/pdfSubgroupSearch";
import { SEARCH_RULES, searchStep1, searchStep2, topIrreps, type CandidateRow, type StepResult } from "@/core/diagnostics/subgroupSearch";
import { noisyPattern } from "@/testSupport/pdfNoise";
import { searchTruth, type TruthName } from "@/testSupport/searchTruths";

/**
 * The subgroup search's calibration (THY-72, decisions 3 and 11): the full
 * step 1 screen (and step 2 as specified, where step 1 accepts a child) on
 * simulated G(r) of known truths at three noise levels, many seeds; every
 * candidate's ΔBIC and gate numbers, one JSON line per dataset. Opt-in, never
 * in CI: run by scripts/subgroup-calibration.sh, which shards the datasets
 * over processes and caps the whole run at 30 minutes; the report is drawn by
 * scripts/subgroup-calibration-report.mjs.
 *
 *   SUBGROUP_CALIBRATION_OUT   the JSON-lines file to append to (unset: skipped)
 *   SUBGROUP_CALIBRATION_JOBS  "truth|level|seed;…", the datasets of this process
 *   SUBGROUP_CALIBRATION_STOP  epoch ms after which no new dataset starts
 *
 * The step budget is lifted (the run's own cap bounds it): a screen cut short
 * would bias the rates. Each step's time is recorded, so the report shows how
 * the 10-minute budget compares.
 */

const OUT = process.env.SUBGROUP_CALIBRATION_OUT;
const JOBS = (process.env.SUBGROUP_CALIBRATION_JOBS ?? "").split(";").filter((x) => x.trim() !== "").map((x) => {
  const [truth, level, seed] = x.split("|");
  return { truth: truth as TruthName, level: Number(level), seed: Number(seed) };
});
const STOP = Number(process.env.SUBGROUP_CALIBRATION_STOP ?? Infinity);
const RULES = { ...SEARCH_RULES, stepBudgetMs: Infinity };
/**
 * A shard of step 1's candidates, "i/n": this process fits every n-th from
 * the i-th. Each candidate is independent (its own starts, seeded by its key;
 * the parent's fits are deterministic), so the shards' rows together are the
 * sequential step's; the report merges them and ranks.
 */
const SHARD = (process.env.SUBGROUP_CALIBRATION_SHARD ?? "0/1").split("/").map(Number) as [number, number];
/** A smoke run's limit on step 1's candidates (unset: every one). */
const LIMIT = Number(process.env.SUBGROUP_CALIBRATION_LIMIT ?? Infinity);

/** A row as the report reads it. */
const rowOf = (r: CandidateRow) => ({
  key: r.candidate.key,
  group: r.candidate.group,
  cell: r.candidate.cell,
  irreps: r.candidate.irreps.map((x) => `${x.label} ${x.direction}`),
  status: r.status,
  ...(r.reason ? { reason: r.reason } : {}),
  ...(r.rw !== undefined ? { rw: r.rw, bic: r.bic, deltaBic: r.deltaBic } : {}),
  ...(r.p !== undefined ? { p: r.p, dp: r.dp } : {}),
  ...(r.startsRun !== undefined ? { starts: r.startsRun, agreeing: r.startsAgreeing } : {}),
  ...(r.heldByGuard?.length ? { held: r.heldByGuard } : {}),
  ...(r.best ? { maxDisplacement: r.best.maxDisplacement, status: r.status, fit: r.best.status } : {}),
  ...(r.gate
    ? {
        accepted: r.gate.accepted,
        gate: {
          deltaBic: r.gate.deltaBic.pass,
          amplitude: r.gate.amplitude.pass,
          sigmas: r.gate.amplitude.sigmas.map((s) => s.ratio),
          restarts: r.gate.restarts.pass,
          rmax: r.gate.rmaxShift.pass,
          rmaxLow: r.gate.rmaxShift.deltaBicLow,
          rmaxHigh: r.gate.rmaxShift.deltaBicHigh,
          adp: r.gate.adp.pass,
          bvs: r.gate.bondValence.pass,
          bvsWorst: r.gate.bondValence.worst,
        },
      }
    : {}),
  ...(r.firstPeak ? { firstPeak: r.firstPeak } : {}),
});

const stepOf = (s: StepResult) => ({ nInd: s.nInd, nGrid: s.nGrid, ended: s.ended, stop: s.stop, seconds: s.elapsedMs / 1000, rows: s.rows.map(rowOf) });

describe.skipIf(!OUT)("subgroup search calibration (opt-in)", () => {
  const client = new ComputeClient();
  for (const job of JOBS) {
    it(`${job.truth} at ${job.level} noise, seed ${job.seed}`, async () => {
      if (Date.now() > STOP) {
        appendFileSync(OUT!, JSON.stringify({ ...job, skipped: "the run's cap was reached before this dataset started" }) + "\n");
        return;
      }
      const t0 = performance.now();
      const truth = searchTruth(job.truth);
      const data = noisyPattern(truth.clean(), { level: job.level, window: truth.levelWindow, seed: job.seed });
      const ctx = await pdfSearchContext(client, pdfPage(truth.parent, data), truth.bound, { rules: RULES });
      const ref = await ctx.reference.refit(ctx.window);
      const stepCtx = { host: ctx.host, window: ctx.window, firstPeakPast: ctx.peak.past, rules: RULES };
      const s1 = await searchStep1(stepCtx, ctx.reference, ctx.singles.slice(0, LIMIT).filter((_, i) => i % SHARD[1] === SHARD[0]));
      const top = topIrreps(s1, RULES.pairedIrreps);
      // Step 2 as specified, fitted when its pairing holds the truth's pair; else what it would try, named.
      const target = job.truth === "a-b+a-" ? ["M irrep 3 of 10", "R irrep 8 of 10"] : job.truth === "GaTa4Se8 P-42_1m" ? ["X irrep 5 of 5", "W irrep 1 of 4"] : null;
      const tried = ctx.pairs.filter((c) => c.irreps.length === 2 && c.irreps[0]!.label !== c.irreps[1]!.label && c.irreps.every((x) => top.includes(x.label)));
      const accepted1 = s1.rows.some((r) => r.gate?.accepted);
      const s2 = SHARD[1] === 1 && target && accepted1 && target.every((l) => top.includes(l)) ? await searchStep2(stepCtx, ctx.reference, s1, ctx.pairs) : null;
      const ranks = target ? Object.fromEntries(target.map((l) => [l, s1.rows.filter((r) => r.status === "fitted").findIndex((r) => r.candidate.irreps.some((x) => x.label === l))])) : null;
      appendFileSync(OUT!, JSON.stringify({
        ...job,
        shard: SHARD,
        window: ctx.window,
        peak: ctx.peak,
        parentRwWhole: ctx.parentRw,
        parentHeld: ctx.parentHeld,
        parentRw: ref.rw,
        parentP: ctx.reference.parameters,
        noiseScale: data.noiseScale,
        step1: stepOf(s1),
        top3: top,
        ...(ranks ? { targetRanks: ranks, step2Tries: tried.map((c) => `${c.key} | ${c.group} ${c.cell}`), step2Fitted: s2 !== null } : {}),
        ...(s2 ? { step2: stepOf(s2) } : {}),
        seconds: (performance.now() - t0) / 1000,
      }) + "\n");
    }, 3 * 3600_000);
  }
});
