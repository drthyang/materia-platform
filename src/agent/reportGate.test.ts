import { describe, it, expect } from "vitest";
import { reportNotYet } from "@/agent/executorPolicy";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";

const p = (id: string, kind: RefinementParameter["kind"]): RefinementParameter => ({ id, label: id, kind, value: 1, initialValue: 1, fixed: false });
const fit = (free: string[], status: RefinementResult["status"] = "converged"): RefinementResult =>
  ({ status, parameters: {}, esd: Object.fromEntries(free.map((id) => [id, 0.01])), agreement: { rFactor: 0 }, history: [] }) as unknown as RefinementResult;

describe("the report waits for the magnetic workflow's final instrument pass", () => {
  const params = [p("scale", "scale"), p("bkg0", "background"), p("B_O1", "bIso"), p("mustrainIso", "mustrainIso"), p("zero", "zeroShift"), p("tof_sig2", "tofProfile"), p("tof_beta0", "tofProfile"), p("mom_Co1_0", "momentMode")];

  it("holds the report until the last converged refinement freed the instrument's terms, with the scale and background at most", () => {
    // Moments only (AWO₄'s Stage 4): the pass is still to come.
    const held = reportNotYet("powder", params, fit(["mom_Co1_0"]), true)!;
    expect(held.line).toBe("Not yet: the final instrument pass");
    expect(held.message).toMatch(/Free the instrument's terms .* with the scale and the background, everything else held \(the moments, the structure, the microstrain\)/);
    // The instrument with the scale and background is the pass (the user's, 2026-10-29: 10.20 → 8.57 % on AWO₄).
    expect(reportNotYet("powder", params, fit(["zero", "tof_sig2", "scale", "bkg0"]), true)).toBeNull();
    // The scale and background alone are not; the instrument with the microstrain, a B or the moments is not.
    expect(reportNotYet("powder", params, fit(["scale", "bkg0"]), true)).not.toBeNull();
    expect(reportNotYet("powder", params, fit(["tof_sig2", "mustrainIso"]), true)).not.toBeNull();
    expect(reportNotYet("powder", params, fit(["tof_sig2", "B_O1"]), true)).not.toBeNull();
    expect(reportNotYet("powder", params, fit(["tof_sig2", "mom_Co1_0"]), true)).not.toBeNull();
    // A pass that has not converged is not done either.
    expect(reportNotYet("powder", params, fit(["zero", "tof_sig2"], "maxIterations"), true)).not.toBeNull();
    // The pass done: the report goes ahead.
    expect(reportNotYet("powder", params, fit(["zero", "tof_sig2", "tof_beta0"]), true)).toBeNull();
  });

  it("applies to the magnetic workflow on the powder page only, and only with the skills", () => {
    const nuclear = params.filter((q) => q.kind !== "momentMode");
    expect(reportNotYet("powder", nuclear, fit(["B_O1"]), true)).toBeNull();
    expect(reportNotYet("pdf", params, fit(["mom_Co1_0"]), true)).toBeNull();
    expect(reportNotYet("powder", params, fit(["mom_Co1_0"]), false)).toBeNull();
  });
});
