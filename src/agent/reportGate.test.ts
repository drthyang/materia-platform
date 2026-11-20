import { describe, it, expect } from "vitest";
import { instrumentPassOnPath, isInstrumentPass, isMomentsRefinement, reportNotYet } from "@/agent/executorPolicy";
import { recordStep, moveTo, type ProjectHistory } from "@/core/project/history";
import type { Workspace } from "@/core/project/types";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";

const p = (id: string, kind: RefinementParameter["kind"]): RefinementParameter => ({ id, label: id, kind, value: 1, initialValue: 1, fixed: false });
const fit = (free: string[], status: RefinementResult["status"] = "converged"): RefinementResult =>
  ({ status, parameters: {}, esd: Object.fromEntries(free.map((id) => [id, 0.01])), agreement: { rFactor: 0 }, history: [] }) as unknown as RefinementResult;

const params = [p("scale", "scale"), p("bkg0", "background"), p("B_O1", "bIso"), p("mustrainIso", "mustrainIso"), p("zero", "zeroShift"), p("tof_sig2", "tofProfile"), p("tof_beta0", "tofProfile"), p("mom_Co1_0", "momentMode"), p("prop_k1", "propagationK")];
const PASS = ["zero", "tof_sig2", "scale", "bkg0"];

describe("the report waits for the magnetic workflow's final instrument pass, and then for the moments", () => {
  it("before a pass: held until the instrument's terms refine, with the scale and background at most", () => {
    // Moments only (magnetic-analysis Stage 4): the pass is still to come.
    const held = reportNotYet("powder", params, fit(["mom_Co1_0"]), true, false)!;
    expect(held.line).toBe("Not yet: the final instrument pass");
    expect(held.message).toMatch(/Free the instrument's terms .* with the scale and the background, everything else held \(the moments, the structure, the microstrain\)/);
    expect(held.message).toMatch(/Then refine the moments alone once more, and write the report/);
    // What is a pass: the instrument with the scale and background (the user's, 2026-10-29, on a local dataset), or the instrument alone.
    expect(isInstrumentPass(params, fit(PASS))).toBe(true);
    expect(isInstrumentPass(params, fit(["zero", "tof_sig2", "tof_beta0"]))).toBe(true);
    // The scale and background alone are not; the instrument with the microstrain, a B or the moments is not.
    expect(isInstrumentPass(params, fit(["scale", "bkg0"]))).toBe(false);
    expect(isInstrumentPass(params, fit(["tof_sig2", "mustrainIso"]))).toBe(false);
    expect(isInstrumentPass(params, fit(["tof_sig2", "B_O1"]))).toBe(false);
    expect(isInstrumentPass(params, fit(["tof_sig2", "mom_Co1_0"]))).toBe(false);
    // A pass that has not converged is not done, and neither is one with no magnetic model in the refinement.
    expect(isInstrumentPass(params, fit(["zero", "tof_sig2"], "maxIterations"))).toBe(false);
    expect(isInstrumentPass(params.filter((q) => q.kind !== "momentMode"), fit(PASS))).toBe(false);
    for (const free of [["scale", "bkg0"], ["tof_sig2", "mustrainIso"], ["tof_sig2", "B_O1"], ["tof_sig2", "mom_Co1_0"]]) {
      expect(reportNotYet("powder", params, fit(free), true, false)!.line).toBe("Not yet: the final instrument pass");
    }
  });

  it("with the pass on screen: held for the moments, which it moved the scale, the background and the peak shape under", () => {
    const held = reportNotYet("powder", params, fit(PASS), true, false)!;
    expect(held.line).toBe("Not yet: the moments after the instrument pass");
    expect(held.message).toMatch(/Hold every nuclear row \(set_free: fix the instrument's terms, the scale and the background; free the moments, and k's components if they refined\) and refine to convergence/);
    // The owner's rule for the last tweak: the moments stay within their esds across the pass; a move that does not shrink is a trade with the peak shape.
    expect(held.message).toMatch(/momentShiftOverEsd is the moments' move across the pass: above 1, run the pass and the moments once more; still above 1, the peak shape trades with the moments: undo the passes, hold the terms that correlate with them, and say so/);
    // The same once the pass is behind (remembered, or on the History's path) and something else was refined since.
    expect(reportNotYet("powder", params, fit(["B_O1"]), true, true)!.line).toBe("Not yet: the moments after the instrument pass");
    expect(reportNotYet("powder", params, null, true, true)!.line).toBe("Not yet: the moments after the instrument pass");
  });

  it("after the pass, the moments refined alone (with k's components where they refine): the report goes ahead", () => {
    expect(isMomentsRefinement(params, fit(["mom_Co1_0"]))).toBe(true);
    expect(isMomentsRefinement(params, fit(["mom_Co1_0", "prop_k1"]))).toBe(true);
    expect(reportNotYet("powder", params, fit(["mom_Co1_0"]), true, true)).toBeNull();
    expect(reportNotYet("powder", params, fit(["mom_Co1_0", "prop_k1"]), true, true)).toBeNull();
    // Not the moments with a nuclear row, not k alone, not a moments fit that did not converge.
    expect(isMomentsRefinement(params, fit(["mom_Co1_0", "scale"]))).toBe(false);
    expect(isMomentsRefinement(params, fit(["prop_k1"]))).toBe(false);
    expect(reportNotYet("powder", params, fit(["mom_Co1_0", "scale"]), true, true)).not.toBeNull();
    expect(reportNotYet("powder", params, fit(["mom_Co1_0"], "maxIterations"), true, true)).not.toBeNull();
  });

  it("applies to the magnetic workflow on the powder page only, and only with the skills", () => {
    const nuclear = params.filter((q) => q.kind !== "momentMode");
    expect(reportNotYet("powder", nuclear, fit(["B_O1"]), true, false)).toBeNull();
    expect(reportNotYet("pdf", params, fit(["mom_Co1_0"]), true, false)).toBeNull();
    expect(reportNotYet("powder", params, fit(["mom_Co1_0"]), false, false)).toBeNull();
  });
});

describe("the final instrument pass on the History's path", () => {
  const step = (h: ProjectHistory | null, kind: "load" | "refine", rows: readonly RefinementParameter[], result: RefinementResult | null): ProjectHistory =>
    recordStep(h, { structures: [], workspace: { technique: "powder", refinement: { parameters: rows, bindings: [], ...(result ? { lastResult: result } : {}) } } as unknown as Workspace, kind, label: kind });
  const now = (result: RefinementResult | null) => ({ parameters: params, result });

  it("is read from the steps since the analysis was loaded, and from the page as it stands; undo takes it off", () => {
    expect(instrumentPassOnPath(null, now(fit(PASS)))).toBeNull();
    let h = step(null, "load", params, null);
    h = step(h, "refine", params, fit(["mom_Co1_0"]));
    const beforePass = h.current;
    expect(instrumentPassOnPath(h, now(fit(["mom_Co1_0"])))).toBe(false);
    // On screen, before the page records it as a step.
    expect(instrumentPassOnPath(h, now(fit(PASS)))).toBe(true);
    h = step(h, "refine", params, fit(PASS));
    h = step(h, "refine", params, fit(["mom_Co1_0"]));
    expect(instrumentPassOnPath(h, now(fit(["mom_Co1_0"])))).toBe(true);
    // Back to the step before the pass: it is no longer on the path.
    expect(instrumentPassOnPath(moveTo(h, beforePass), now(fit(["mom_Co1_0"])))).toBe(false);
    // A pass from before the data were loaded again does not count.
    h = step(h, "load", params, null);
    expect(instrumentPassOnPath(h, now(null))).toBe(false);
  });
});
