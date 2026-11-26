import { expect, it, vi } from "vitest";
import { isAccepted } from "@/core/diagnostics/subgroupSearch";
import { gateContext, gateStep1, stepTable } from "@/testSupport/searchTruths";

/**
 * The known-truth gate (THY-72, decision 11) on a⁻a⁻a⁻ SrTiO₃ at 10 % noise,
 * seed 1, over the gate's screen: step 1's top accepted child is R irrep 8
 * along (a,a,a), R-3c. Apart from pdfSubgroupSearch.test.ts so the two run
 * side by side.
 */

vi.setConfig({ testTimeout: 300_000 });

it("a⁻a⁻a⁻ at 10 %: step 1's top accepted child is R irrep 8 along (a,a,a), R-3c", async () => {
  const s1 = await gateStep1(await gateContext("a-a-a-", 0.1, 1));
  const top = s1.rows.find(isAccepted);
  expect(top && `${top.candidate.irreps[0]!.label} ${top.candidate.irreps[0]!.direction}`, stepTable(s1)).toBe("R irrep 8 of 10 (a,a,a)");
  expect([top!.candidate.group, top!.candidate.cell]).toEqual(["R -3 c:H #167", "2×2×2"]);
});
