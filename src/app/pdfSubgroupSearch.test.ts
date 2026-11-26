import { describe, expect, it, vi } from "vitest";
import { isAccepted, searchStep1, searchStep2 } from "@/core/diagnostics/subgroupSearch";
import { gateContext, gateStep1, stepTable } from "@/testSupport/searchTruths";

/**
 * The subgroup search's known-truth gate (THY-72, decision 11) on simulated
 * SrTiO₃ G(r) with F(Q) noise (testSupport/pdfNoise.ts), seed 1: the outcome
 * named by irrep and order-parameter direction, the group and cell as a
 * cross-check. a⁻a⁻a⁻ at 10 % is in pdfSubgroupSearchTilt10.test.ts, the cubic
 * parent in pdfSubgroupSearchCubic.test.ts (files apart so they run side by side).
 *
 *  - a⁻a⁻a⁻ at 5 %: step 1's top accepted child is R irrep 8 along (a,a,a),
 *    R-3c, with no subgroup of it (C2/c by the same irrep) above.
 *  - a⁻b⁺a⁻: the decided outcome (step 1 accepts M irrep 3 and R irrep 8;
 *    step 2's top accepted child is them coupled, Pnma) is NOT met, and the
 *    test says so (`it.fails`). M irrep 3 alone improves the parent's fit too
 *    little to pass ΔBIC ≤ −6 (−2.0 even on noise-free data). It also ranks
 *    far below R irreps 8 and 10 in a full screen, so step 2, which pairs step
 *    1's top three irreps, never fits M3 + R8. A question for the owner
 *    (docs/reports/2026-11-26-subgroup-search-engine.md, Q-A). When it is
 *    answered and built, this test turns red and becomes an `it`.
 *
 * Step 1 screens the gate's handful of classes (GATE_SCREEN). The full screen,
 * over seeds and noise levels, is the calibration's.
 */

vi.setConfig({ testTimeout: 300_000 });

it("a⁻a⁻a⁻ at 5 %: step 1's top accepted child is R irrep 8 along (a,a,a), R-3c", async () => {
  const s1 = await gateStep1(await gateContext("a-a-a-", 0.05, 1));
  const top = s1.rows.find(isAccepted);
  expect(top && `${top.candidate.irreps[0]!.label} ${top.candidate.irreps[0]!.direction}`, stepTable(s1)).toBe("R irrep 8 of 10 (a,a,a)");
  expect([top!.candidate.group, top!.candidate.cell]).toEqual(["R -3 c:H #167", "2×2×2"]);
});

describe("the known-truth gate on a⁻b⁺a⁻ (a miss, reported to the owner)", () => {
  it.fails("a⁻b⁺a⁻ at 5 %: step 1 accepts M irrep 3 and R irrep 8; step 2's top accepted child is them coupled, Pnma", async () => {
    const ctx = await gateContext("a-b+a-", 0.05, 1);
    // The two classes the outcome turns on; step 1 fails on M irrep 3 before step 2 runs.
    const screen = ["c36:M irrep 3 of 10 (a,0,0)", "c71:R irrep 8 of 10 (a,a,a)"].map((k) => ctx.singles.find((c) => c.key === k)!);
    const s1 = await searchStep1({ host: ctx.host, window: ctx.window, firstPeakPast: ctx.peak.past }, ctx.reference, screen);
    const accepted = new Set(s1.rows.filter(isAccepted).map((r) => r.candidate.irreps[0]!.label));
    expect(accepted.has("M irrep 3 of 10") && accepted.has("R irrep 8 of 10"), stepTable(s1)).toBe(true);
    const s2 = await searchStep2({ host: ctx.host, window: ctx.window, firstPeakPast: ctx.peak.past }, ctx.reference, s1, ctx.pairs);
    const top = s2.rows.find(isAccepted);
    expect(top && new Set(top.candidate.irreps.map((x) => x.label)), stepTable(s2)).toEqual(new Set(["M irrep 3 of 10", "R irrep 8 of 10"]));
    expect([top!.candidate.group, top!.candidate.cell]).toEqual(["P n m a #62", "2×2×2"]);
  });
});
