/**
 * The subgroup engine's names checked by moyo over THY-80's full coverage
 * (tier 2, opt-in: MATERIA_SUBGROUP_TIER2=1; tier 1 is
 * subgroupNaming.moyo.test.ts, the method is in independentNaming.ts):
 * twelve parents, the bounds 1×1×1, 1×1×2 and 2×2×2, and one hexagonal
 * supercell (√3 × √3 × 1 of P6₃/mmc); every class the engine lists.
 *
 * Time: each parent has a budget (MATERIA_SUBGROUP_TIER2_PARENT_MIN, default
 * 6 minutes) and the run a cap (MATERIA_SUBGROUP_TIER2_CAP_MIN, default and
 * at most 30). Both are checked between classes and between bounds: one
 * engine call (the search and naming of one bound) is not interrupted, so a
 * bound that starts before its deadline finishes its search. What the time
 * did not reach is reported, not failed. A bound the engine refuses
 * (SubgroupSearchTooLarge) is reported as refused.
 *
 * The summary is printed at the end; with MATERIA_SUBGROUP_TIER2_OUT set it is
 * also written there as JSON (every class: the engine's name and (P_H, p_H),
 * moyo's number, Hall number, symbol and own transformation, the seed).
 *
 *   MATERIA_SUBGROUP_TIER2=1 npx vitest run src/core/crystal/irreps/validation/subgroupNaming.moyo.tier2.test.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { BOUNDS, PARENTS, checkBound, findings, initMoyo, moyoVersion, type BoundCheck } from "@/core/crystal/irreps/validation/independentNaming";

const ENABLED = process.env.MATERIA_SUBGROUP_TIER2 === "1";
const minutes = (name: string, fallback: number, max = Number.POSITIVE_INFINITY): number => {
  const v = Number(process.env[name]);
  return Math.min(Number.isFinite(v) && v > 0 ? v : fallback, max) * 60_000;
};
const PARENT_MS = minutes("MATERIA_SUBGROUP_TIER2_PARENT_MIN", 6);
const CAP_MS = minutes("MATERIA_SUBGROUP_TIER2_CAP_MIN", 30, 30);

/** Mismatches already reported to the owner, as "parent bound class id"; none so far. */
const KNOWN: ReadonlySet<string> = new Set<string>([]);

const results: BoundCheck[] = [];
const skipped: string[] = [];
let start = 0;

describe.skipIf(!ENABLED)("tier 2: every class of THY-80's coverage named as moyo names it", () => {
  for (const [name, pc] of Object.entries(PARENTS)) {
    const bounds = ["1x1x1", "1x1x2", "2x2x2", ...(name === "P6_3/mmc" ? ["r3xr3x1"] : [])];
    it(`${name}: ${bounds.join(", ")}`, { timeout: PARENT_MS + 10 * 60_000 }, () => {
      initMoyo();
      if (start === 0) start = Date.now();
      const deadline = Math.min(Date.now() + PARENT_MS, start + CAP_MS);
      const unexpected: string[] = [];
      for (const b of bounds) {
        if (Date.now() > deadline) {
          skipped.push(`${name} ${b}: not started (${Date.now() > start + CAP_MS ? "the 30-minute cap" : "the parent's budget"})`);
          continue;
        }
        const r = checkBound(pc, b, BOUNDS[b]!, deadline);
        results.push(r);
        console.log(`${name} ${b}: ${r.classes.length}/${r.listed} classes checked, engine ${(r.engineMs / 1000).toFixed(1)} s, check ${(r.checkMs / 1000).toFixed(1)} s, ${findings(r).length} mismatches${r.note ? ` (${r.note})` : ""}`);
        for (const c of r.classes) if (c.problems.length > 0 && !KNOWN.has(`${pc.parent} ${b} ${c.id}`)) unexpected.push(...findings({ ...r, classes: [c] }));
      }
      expect(unexpected).toEqual([]);
    });
  }

  afterAll(() => {
    const lines = results.map((r) => `${r.parent} ${r.bound}: ${r.classes.length}/${r.listed} checked, ${findings(r).length} mismatches, engine ${(r.engineMs / 1000).toFixed(1)} s, check ${(r.checkMs / 1000).toFixed(1)} s${r.note ? `; ${r.note}` : ""}`);
    const total = results.reduce((s, r) => s + r.classes.length, 0);
    const bad = results.flatMap(findings);
    console.log(
      [
        `moyo-wasm ${moyoVersion()}; ${total} classes checked in ${((Date.now() - start) / 60_000).toFixed(1)} min; ${bad.length} mismatches`,
        ...lines,
        ...skipped,
        ...bad,
      ].join("\n"),
    );
    const out = process.env.MATERIA_SUBGROUP_TIER2_OUT;
    if (out) writeFileSync(out, JSON.stringify({ moyo: moyoVersion(), minutes: (Date.now() - start) / 60_000, results, skipped }, null, 1));
  });
});
