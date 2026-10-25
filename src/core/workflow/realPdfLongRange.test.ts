import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePdfData } from "@/parsers/pdfData";
import { exampleStructure } from "@/examples/highEntropyWO4";
import { pdfPage, pageView } from "@/app/pdfPage";
import { buildPdfProblem, joinBlocks, terminationPlanFor, windowFor } from "@/core/workflow/pdf";
import { applyParameters } from "@/core/workflow/apply";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { colocatedGroups, CompactPairs, PAIR_STORE_BUDGET_BYTES } from "@/core/pdf/pairEnumerator";
import { PAIR_REACH_MARGIN } from "@/core/pdf/forwardModel";
import { dataDir } from "@/testSupport/data";

/**
 * The user's measured G(r) on the bundled multi-element-site model (six
 * species on one site), where it is: the git-ignored data folder. The data
 * are unpublished: nothing here names the file or holds a number from it, and
 * the suite skips without it. What it pins are relations — the split pool's
 * evaluation is the whole one bit for bit on the real grid, and the full
 * range's pair list fits its storage budget at under two bytes a pair (the
 * object list it replaces took about a hundred in a browser isolate).
 */

/** `pdf.gr` in the data folder (docs/VALIDATION.md), or a `.gr` file in its `pdf/` subfolder. */
function userPdf(): string | null {
  const flat = join(dataDir("AWO4"), "pdf.gr");
  if (existsSync(flat)) return flat;
  const dir = join(dataDir("AWO4"), "pdf");
  if (!existsSync(dir)) return null;
  const gr = readdirSync(dir).sort().find((f) => /\.gr$/i.test(f));
  return gr ? join(dir, gr) : null;
}
const file = userPdf();

describe.skipIf(!file)("the user's multi-element-site G(r), long range", () => {
  const pattern = () => parsePdfData(readFileSync(file!, "utf8"), { id: "user-pdf", filename: "user.gr" });

  it("splits into three blocks that join to the whole evaluation and its analytic columns, bit for bit (1.5–30 Å)", () => {
    const pat = pattern();
    const fitRange = { min: 1.5, max: 30 };
    const page = pdfPage(exampleStructure(), pat, { preset: { fitRange } });
    const v = pageView(page);
    const params = page.params.map((p) => ({ ...p, fixed: !(p.kind === "pdfScale" || p.kind === "cellLength" || p.kind === "cellAngle" || p.kind === "bIso" || p.kind === "positionShift") }));
    const build = (shard?: { index: number; count: number }) => buildPdfProblem(v.fitStructure, pat, params, v.bindings, v.spec.restraints, fitRange, shard);
    const whole = build();
    const shards = [0, 1, 2].map((index) => build({ index, count: 3 }));
    const values = Object.fromEntries(params.map((p) => [p.id, p.value]));
    const joined = whole.split.finish(values, joinBlocks(whole.split, shards.map((s) => s.split.evaluateBlock(values))));
    const ref = whole.calculate(values);
    expect(joined.every((y, i) => Object.is(y, ref[i]))).toBe(true);
    const free = params.filter((p) => !p.fixed);
    const fv = free.map((p) => p.value);
    const refCols = whole.analyticColumns!(free, fv);
    const blocks = shards.map((s) => s.split.analyticBlock(free, fv));
    const cols = whole.split.finishColumns(free, blocks[0]!.map((b0, j) => (b0 ? joinBlocks(whole.split, blocks.map((b) => b[j]!)) : null)));
    expect(refCols.filter((c) => c !== null).length).toBeGreaterThan(8);
    refCols.forEach((c, j) => {
      expect(cols[j] === null).toBe(c === null);
      if (c) expect(cols[j]!.every((y, i) => Object.is(y, c[i]))).toBe(true);
    });
  });

  it("holds the full range's pairs (to 100 Å) in under two bytes each, inside the storage budget", () => {
    const pat = pattern();
    // The page's rows from its default window (its start scale is fitted there); the pairs for the full range.
    const page = pdfPage(exampleStructure(), pat, { preset: { fitRange: { min: 1.5, max: 30 } } });
    const fitRange = { min: 1.5, max: 100 };
    const v = pageView(page);
    const applied = applyParameters(v.fitStructure, v.bindings, Object.fromEntries(page.params.map((p) => [p.id, p.value])));
    const atoms = expandStructureAtoms(applied.model);
    const rValues = pat.points.map((p) => p.r);
    const { i0, i1 } = windowFor(rValues, fitRange);
    const grid = terminationPlanFor(pat, rValues.slice(i0, i1)).modelGrid;
    const list = CompactPairs.build(applied.model.cell, atoms, grid[grid.length - 1]! + PAIR_REACH_MARGIN, colocatedGroups(atoms));
    expect(list.count).toBeGreaterThan(1e6);
    expect(list.bytes / list.count).toBeLessThan(2);
    expect(list.bytes).toBeLessThan(PAIR_STORE_BUDGET_BYTES);
  });
});
