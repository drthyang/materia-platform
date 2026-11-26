import { expect, it, vi } from "vitest";
import { isAccepted } from "@/core/diagnostics/subgroupSearch";
import { gateContext, gateStep1, stepTable } from "@/testSupport/searchTruths";

/**
 * The known-truth gate (THY-72, decision 11) on cubic SrTiO₃: step 1 accepts
 * nothing. Simulated G(r) with F(Q) noise, seed 1, over the gate's screen
 * (GATE_SCREEN). One seed is a regression check, not the rate. The
 * false-descent rate over seeds and the full screen is the calibration's
 * (docs/reports/2026-11-26-subgroup-search-engine.md, Q-C).
 *
 * At 10 %, seed 1 IS a false descent: R irrep 7 along (a,a,a), R-3m, passes
 * the whole gate with ΔBIC −7.4. It is one of the calibration's three, so the
 * test says so (`it.fails`) until the owner decides the threshold.
 */

vi.setConfig({ testTimeout: 300_000 });

it("cubic at 5 %: step 1 accepts nothing", async () => {
  const s1 = await gateStep1(await gateContext("cubic", 0.05, 1));
  expect(s1.rows.filter(isAccepted).map((r) => r.candidate.key), stepTable(s1)).toEqual([]);
  expect(s1.stop).toBe("no child passes the gate");
});

it.fails("cubic at 10 %: step 1 accepts nothing (seed 1 is a false descent, Q-C)", async () => {
  const s1 = await gateStep1(await gateContext("cubic", 0.1, 1));
  expect(s1.rows.filter(isAccepted).map((r) => r.candidate.key), stepTable(s1)).toEqual([]);
});
