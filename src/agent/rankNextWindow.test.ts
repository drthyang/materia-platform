import { describe, it, expect } from "vitest";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { mn3gaImpuritySession } from "@/agent/evals/pages";

/**
 * rank_next_parameters probes the problem the next refinement solves: the
 * points inside the fit window (check_fit_range's first step sets one) and the
 * page's restraints. It used to build the problem over the whole pattern, so
 * its wR and its predicted gains read points the fit leaves out.
 */
describe("rank_next_parameters inside the fit window", () => {
  it("reads wR over the window the fit uses", async () => {
    const { port } = sessionPort(mn3gaImpuritySession());
    const { ex } = executor(fakeHost(port).host, true);
    const whole = JSON.parse((await ex.run("rank_next_parameters", {})).text) as { wrNow: number };
    port.setFitRange({ min: 30, max: 60 });
    const windowed = JSON.parse((await ex.run("rank_next_parameters", {})).text) as { wrNow: number };

    // The weighted R over the window, from the page's own curves and σ.
    const s = port.state();
    let num = 0;
    let den = 0;
    s.curves.x.forEach((x, i) => {
      if (x < 30 || x > 60) return;
      const sigma = s.pattern.points[i]!.sigma ?? Math.sqrt(Math.max(s.curves.yObs[i]!, 1));
      const w = 1 / sigma ** 2;
      num += w * (s.curves.yObs[i]! - s.curves.yCalc[i]!) ** 2;
      den += w * s.curves.yObs[i]! ** 2;
    });
    const inWindow = 100 * Math.sqrt(num / den);
    expect(Math.abs(windowed.wrNow - inWindow) / inWindow).toBeLessThan(0.02);
    expect(Math.abs(windowed.wrNow - whole.wrNow) / whole.wrNow).toBeGreaterThan(0.02);
  });
});
