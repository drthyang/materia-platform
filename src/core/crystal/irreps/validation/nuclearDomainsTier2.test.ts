/**
 * Tier 2 of the nuclear domain-equivalence test (THY-80 C2; tier 1 and the
 * method: nuclearDomains.test.ts): every case of nuclearDomainCases.ts at
 * more seeds. Opt-in:
 *
 *   MATERIA_SUBGROUP_TIER2=1 npx vitest run src/core/crystal/irreps/validation/nuclearDomainsTier2.test.ts
 *
 * MATERIA_SUBGROUP_TIER2_SEEDS (default 5): seeds 1…n per case.
 * MATERIA_SUBGROUP_TIER2_CASE_MIN (default 5): a case's time limit; a case
 * past it stops between domains and fails as timed out, with what it did.
 * MATERIA_SUBGROUP_TIER2_CAP_MIN (default 30): the run's cap; the cases left
 * when it is reached are not run, and the summary lists them.
 * MATERIA_SUBGROUP_TIER2_OUT: a path for the summary as JSON.
 */
import { writeFileSync } from "node:fs";
import { afterAll, describe, it, expect } from "vitest";
import { CASES } from "@/core/crystal/irreps/validation/nuclearDomainCases";
import { failures, fmt, prepare, runSeed, summary, type SeedResult } from "@/core/crystal/irreps/validation/nuclearDomainsSupport";

const ON = process.env.MATERIA_SUBGROUP_TIER2 === "1";
const SEEDS = Number(process.env.MATERIA_SUBGROUP_TIER2_SEEDS ?? 5);
const CASE_MS = Number(process.env.MATERIA_SUBGROUP_TIER2_CASE_MIN ?? 5) * 60_000;
const CAP_MS = Number(process.env.MATERIA_SUBGROUP_TIER2_CAP_MIN ?? 30) * 60_000;
const OUT = process.env.MATERIA_SUBGROUP_TIER2_OUT;

interface CaseRecord {
  readonly key: string;
  readonly name: string;
  status: "passed" | "failed" | "timed out" | "error" | "not run (cap)";
  readonly seeds: { seed: number; domains: number; lines: number; profile: number; pdf: number; residual: number; modeSetGap: number; ms: number }[];
  readonly failures: string[];
  ms: number;
}

const records: CaseRecord[] = [];
const started = performance.now();

describe.skipIf(!ON)("tier 2: every domain of every case at more seeds (THY-80 C2)", () => {
  for (const [key, c] of Object.entries(CASES)) {
    it(`${c.name}: seeds 1–${SEEDS}`, () => {
      const rec: CaseRecord = { key, name: c.name, status: "passed", seeds: [], failures: [], ms: 0 };
      records.push(rec);
      const t0 = performance.now();
      if (t0 - started > CAP_MS) {
        rec.status = "not run (cap)";
        return;
      }
      const deadline = Math.min(t0 + CASE_MS, started + CAP_MS);
      try {
        const p = prepare(c);
        for (let seed = 1; seed <= SEEDS; seed++) {
          if (performance.now() > deadline) {
            rec.status = "timed out";
            rec.failures.push(`stopped before seed ${seed}`);
            break;
          }
          const r: SeedResult = runSeed(p, seed, { deadline });
          console.log(`[THY-80 C2 tier 2] ${summary(r)}`);
          rec.seeds.push({ seed, domains: r.domains.length, lines: r.worst.lines, profile: r.worst.profile, pdf: r.worst.pdf, residual: r.worstResidual, modeSetGap: r.modeSetGap, ms: r.ms });
          if (r.domains.length < p.cls.domainStates && performance.now() > deadline) {
            rec.status = "timed out";
            rec.failures.push(`seed ${seed}: stopped after ${r.domains.length} of ${p.cls.domainStates} domains`);
            break;
          }
          const f = failures(r, p.cls.domainStates, p.cls.orientationStates);
          if (f.length > 0) {
            rec.status = "failed";
            rec.failures.push(...f);
          }
        }
      } catch (e) {
        rec.status = "error";
        rec.failures.push(e instanceof Error ? e.message : String(e));
      }
      rec.ms = performance.now() - t0;
      expect(rec.failures).toEqual([]);
    }, CASE_MS + 120_000);
  }

  afterAll(() => {
    const lines = records.map((r) => {
      const worst = (k: "lines" | "profile" | "pdf"): string => fmt(Math.max(0, ...r.seeds.map((s) => s[k])));
      return `${r.status.padEnd(14)} ${r.name}: ${r.seeds.length} seeds, ${r.seeds.reduce((t, s) => t + s.domains, 0)} domains; worst lines ${worst("lines")}, profile ${worst("profile")}, G(r) ${worst("pdf")}; ${(r.ms / 1000).toFixed(1)} s`;
    });
    console.log(`[THY-80 C2 tier 2] ${((performance.now() - started) / 60_000).toFixed(1)} min\n${lines.join("\n")}`);
    if (OUT) writeFileSync(OUT, JSON.stringify({ minutes: (performance.now() - started) / 60_000, seeds: SEEDS, records }, null, 2));
  });
});
