/**
 * The displacive mode basis's dimension over THY-80's full coverage (tier 2,
 * opt-in: MATERIA_SUBGROUP_TIER2=1; tier 1 is modeBasisDimension.test.ts, the
 * method is in independentModeCount.ts): twelve parents with their atoms on
 * Wyckoff positions, the bounds 1×1×1, 1×1×2 and 2×2×2, and √3 × √3 × 1 of
 * P6₃/mmc; every class the engine lists.
 *
 * Time: each parent has a budget (MATERIA_SUBGROUP_TIER2_PARENT_MIN, default
 * 4 minutes) and the run a cap (MATERIA_SUBGROUP_TIER2_CAP_MIN, default and at
 * most 30), checked between classes and between bounds; the engine's search
 * of one bound is not interrupted. What the time did not reach is listed, not
 * failed. A bound the engine refuses (SubgroupSearchTooLarge) is listed as
 * refused.
 *
 * The summary is printed at the end; with MATERIA_SUBGROUP_TIER2_MODES_OUT set
 * it is also written there as JSON (every class: the counts, the child orbits
 * with moyo's Wyckoff letters and site symmetries, the per-irrep counts).
 *
 *   MATERIA_SUBGROUP_TIER2=1 npx vitest run src/core/crystal/irreps/validation/modeBasisDimension.tier2.test.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { BOUNDS, initMoyo, moyoVersion } from "@/core/crystal/irreps/validation/independentNaming";
import { MODE_PARENTS, checkModeBound, gaugeGaps, modeFindings, type ModeBoundCheck } from "@/core/crystal/irreps/validation/independentModeCount";

const ENABLED = process.env.MATERIA_SUBGROUP_TIER2 === "1";
const minutes = (name: string, fallback: number, max = Number.POSITIVE_INFINITY): number => {
  const v = Number(process.env[name]);
  return Math.min(Number.isFinite(v) && v > 0 ? v : fallback, max) * 60_000;
};
const PARENT_MS = minutes("MATERIA_SUBGROUP_TIER2_PARENT_MIN", 4);
const CAP_MS = minutes("MATERIA_SUBGROUP_TIER2_CAP_MIN", 30, 30);

/** Mismatches already reported to the owner, as "parent bound class id"; none so far. */
const KNOWN: ReadonlySet<string> = new Set<string>([]);

const results: ModeBoundCheck[] = [];
const skipped: string[] = [];
let start = 0;

describe.skipIf(!ENABLED)("tier 2: every class of THY-80's coverage has the mode dimension Wyckoff splitting gives", () => {
  for (const name of Object.keys(MODE_PARENTS)) {
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
        const r = checkModeBound(name, b, BOUNDS[b]!, deadline);
        results.push(r);
        const modes = r.classes.reduce((t, c) => t + (c.engine ?? 0), 0);
        console.log(`${name} ${b}: ${r.classes.length}/${r.listed} classes, ${modes} modes, engine ${(r.engineMs / 1000).toFixed(1)} s, check ${(r.checkMs / 1000).toFixed(1)} s, ${modeFindings(r).length} mismatches, ${gaugeGaps(r).length} default-gauge gaps${r.note ? ` (${r.note})` : ""}`);
        for (const c of r.classes) if (c.problems.length > 0 && !KNOWN.has(`${MODE_PARENTS[name]!.parent} ${b} ${c.id}`)) unexpected.push(...modeFindings({ ...r, classes: [c] }));
      }
      expect(unexpected).toEqual([]);
    });
  }

  afterAll(() => {
    const lines = results.map((r) => {
      const slow = r.classes.reduce((m, c) => Math.max(m, c.ms), 0);
      return `${r.parent} ${r.bound}: ${r.classes.length}/${r.listed} checked, ${modeFindings(r).length} mismatches, ${gaugeGaps(r).length} default-gauge gaps, engine ${(r.engineMs / 1000).toFixed(1)} s, check ${(r.checkMs / 1000).toFixed(1)} s (slowest class ${(slow / 1000).toFixed(1)} s)${r.note ? `; ${r.note}` : ""}`;
    });
    const total = results.reduce((s, r) => s + r.classes.length, 0);
    const bad = results.flatMap(modeFindings);
    const gaps = results.flatMap(gaugeGaps);
    console.log(
      [
        `moyo-wasm ${moyoVersion()}; ${total} classes checked in ${((Date.now() - start) / 60_000).toFixed(1)} min; ${bad.length} mismatches; ${gaps.length} classes where the default gauge would drop a real mode`,
        ...lines,
        ...skipped,
        ...bad,
      ].join("\n"),
    );
    const out = process.env.MATERIA_SUBGROUP_TIER2_MODES_OUT;
    if (out) writeFileSync(out, JSON.stringify({ moyo: moyoVersion(), minutes: (Date.now() - start) / 60_000, results, skipped, gaps }, null, 1));
  });
});
