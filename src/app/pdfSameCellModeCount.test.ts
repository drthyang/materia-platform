/**
 * The PDF page's same-cell mode sets: offered = listed = an independent count
 * (tier 1, sampled; every row of every parent is the opt-in tier 2,
 * pdfSameCellModeCount.tier2.test.ts; the method is in
 * testSupport/sameCellModeCount.ts). The rows sampled are the ones that
 * offered fewer modes than they listed before the gauge fix of 2026-11-27,
 * and unaffected rows of the same parents beside them.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { initMoyo } from "@/core/crystal/irreps/validation/independentNaming";
import { checkSameCellParent, sameCellFindings, sameCellParents } from "@/testSupport/sameCellModeCount";

beforeAll(() => initMoyo());

const parent = (name: string) => sameCellParents().find((p) => p.name === name)!;

/** (parent, rows kept; null = every same-cell row), with the counts before the fix in the comments. */
const TIER1: readonly (readonly [string, RegExp | null])[] = [
  // P2₁/c → P2₁ 8 (offered 6), → Pc 7 (6), → P-1.
  ["P2_1/c", null],
  // Pnma → P2₁2₁2₁ 12 (9), Pmn2₁ 12 (11), Pmc2₁ 12 (11), Pna2₁ 11 (9), P2₁ 23 (21), Pc 22 (21); P2₁/m, P-1 unaffected.
  ["Pnma", null],
  // FeSi-type P2₁3 → P2₁2₁2₁ 6 (3), P2₁ 11 (9); own modes 2 (1).
  ["P2_13 (FeSi-type)", null],
  // SnS-type Pnma (all 4c): 13 rows short, 26 modes; own modes 4 (2).
  ["Pnma all-4c (SnS-type)", null],
  // Cmcm → Cmc2₁ 7 (6), P2₁ 11 (9), Cc 10 (9); Pmmn, C2/m unaffected.
  ["Cmcm", /^(C m c 21|P 1 21 1|C 1 c 1|P m m n|C 1 2\/m 1) /],
  // P6₃/mmc → Cmc2₁ 7 (6), Cc 10 (9), P2₁ 11 (9); P-3m1, P6₃mc unaffected.
  ["P6_3/mmc", /^(C m c 21|C 1 c 1|P 1 21 1|P -3 m 1|P 63 m c) /],
  // Pa-3: 5 rows short.
  ["Pa-3 (pyrite-type)", null],
  // Unaffected parents: the cubic perovskite and the bundled demo (all 55 rows were right before).
  ["Pm-3m", /^(P 4 m m|R 3 m|P 4\/m m m|C m m m|I 4\/m m m) /],
  ["GaTa4Se8 (bundled demo)", /^(R 3 m|I -4 m 2|C 1 m 1|P 1) /],
];

describe("every same-cell row sampled: the page offers the modes the row lists, and the independent count", { timeout: 300_000 }, () => {
  for (const [name, pick] of TIER1) {
    it(`${name}${pick ? " (sampled rows)" : ""}`, async () => {
      const r = await checkSameCellParent(parent(name), pick ? { pick: (row) => pick.test(row) } : {});
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.note).toBeUndefined();
      expect(sameCellFindings(r)).toEqual([]);
    });
  }

  it("the rows the fix restores, by count", async () => {
    const byRow = async (name: string, re: RegExp) => (await checkSameCellParent(parent(name), { pick: (row) => re.test(row) })).rows.map((r) => [r.row.replace(/ #.*/, ""), r.offered, r.independent]);
    expect(await byRow("Pnma", /^P 21 21 21 /)).toEqual([["P 21 21 21", 12, 12]]);
    expect(await byRow("P2_1/c", /^P 1 21 1 /)).toEqual([["P 1 21 1", 8, 8]]);
    expect(await byRow("P2_13 (FeSi-type)", /^P 21 21 21 /)).toEqual([["P 21 21 21", 6, 6]]);
  });

  it("the loaded structure's own modes (Positions → Irreps): FeSi-type P2₁3 2 of 2, SnS-type Pnma 4 of 4", async () => {
    const own = async (name: string) => (await checkSameCellParent(parent(name), { pick: () => false })).own;
    expect(await own("P2_13 (FeSi-type)")).toEqual({ offered: 2, independent: 2, problems: [] });
    expect(await own("Pnma all-4c (SnS-type)")).toEqual({ offered: 4, independent: 4, problems: [] });
  });
});
