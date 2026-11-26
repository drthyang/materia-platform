/**
 * The PDF page's same-cell mode sets over every same-cell row of every parent
 * of the gauge verification (tier 2, opt-in: MATERIA_SUBGROUP_TIER2=1; tier 1
 * is pdfSameCellModeCount.test.ts, the method is in
 * testSupport/sameCellModeCount.ts): B2's twelve parents, the three whose
 * sites all allow a common direction and the bundled GaTa4Se8 demo, the
 * bound 1×1×1. Before the gauge fix, 38 of the 809 rows with modes offered
 * fewer than they listed.
 *
 * Time: the run has a cap (MATERIA_SUBGROUP_TIER2_CAP_MIN, default and at
 * most 30 minutes), checked between rows; what it did not reach is listed,
 * not failed. With MATERIA_SAMECELL_MODES_OUT set the rows are written there
 * as JSON.
 *
 *   MATERIA_SUBGROUP_TIER2=1 npx vitest run src/app/pdfSameCellModeCount.tier2.test.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { initMoyo, moyoVersion } from "@/core/crystal/irreps/validation/independentNaming";
import { checkSameCellParent, sameCellFindings, sameCellParents, type SameCellParentCheck } from "@/testSupport/sameCellModeCount";

const ENABLED = process.env.MATERIA_SUBGROUP_TIER2 === "1";
const capMin = Number(process.env.MATERIA_SUBGROUP_TIER2_CAP_MIN);
const CAP_MS = Math.min(Number.isFinite(capMin) && capMin > 0 ? capMin : 30, 30) * 60_000;

const results: SameCellParentCheck[] = [];
let start = 0;

describe.skipIf(!ENABLED)("tier 2: every same-cell row offers the modes it lists, and the independent count", () => {
  for (const p of sameCellParents()) {
    it(p.name, { timeout: CAP_MS + 5 * 60_000 }, async () => {
      initMoyo();
      if (start === 0) start = Date.now();
      const r = await checkSameCellParent(p, { deadline: start + CAP_MS });
      results.push(r);
      const withModes = r.rows.filter((x) => x.offered > 0).length;
      console.log(`${p.name}: ${r.rows.length}/${r.listed} rows (${withModes} with modes), own ${r.own.offered}/${r.own.independent}, ${sameCellFindings(r).length} mismatches, ${(r.ms / 1000).toFixed(1)} s${r.note ? ` (${r.note})` : ""}`);
      expect(sameCellFindings(r)).toEqual([]);
    });
  }

  afterAll(() => {
    const rows = results.flatMap((r) => r.rows);
    const bad = results.flatMap(sameCellFindings);
    console.log(
      [
        `moyo-wasm ${moyoVersion()}; ${results.length} parents, ${rows.length} rows (${rows.filter((x) => x.offered > 0).length} with modes, ${rows.filter((x) => x.offered === 0).length} pinned) in ${((Date.now() - start) / 60_000).toFixed(1)} min; ${bad.length} mismatches`,
        ...results.filter((r) => r.note).map((r) => `${r.parent}: ${r.note}`),
        ...bad,
      ].join("\n"),
    );
    const out = process.env.MATERIA_SAMECELL_MODES_OUT;
    if (out) writeFileSync(out, JSON.stringify({ moyo: moyoVersion(), minutes: (Date.now() - start) / 60_000, results }, null, 1));
  });
});
