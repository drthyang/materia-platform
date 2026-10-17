import { describe, it, expect } from "vitest";
import { powderResidual } from "@/core/diagnostics/powderResidual";
import { MAGNETIC_TRUTH, mn3gaMagneticSession, mn3gaSession } from "@/agent/evals/pages";
import { magneticSubgroupLattice, latticeRepresentatives } from "@/core/magnetic/subgroupLattice";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { withMagneticModelRows } from "@/app/powderPage";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { mn3gaImpuritySession } from "@/agent/evals/pages";
import { find_unexplained_peaks } from "@/mcp/tools";
import { residualPeaks } from "@/core/diagnostics/assessment";
import { newSession } from "@/app/powderSession";
import { exampleStructure } from "@/examples/mn3ga";
import type { PowderLiveState } from "@/agent/port";

/**
 * The powder residual both tool surfaces read (the MCP tools and the in-app
 * Agent each had their own builder, and they disagreed): the points a fit
 * uses, with σ and where it came from, beside every line of the model.
 */

const inputOf = (s: PowderLiveState) => ({ curves: s.curves, d: s.d!, pattern: s.pattern, phases: s.refinedPhases, fitRange: s.fitRange, magnetic: s.magnetic });

describe("the powder residual", () => {
  it("keeps the points a fit uses: inside the window, off the excluded plateau", () => {
    const { port } = sessionPort(mn3gaSession());
    const whole = powderResidual(inputOf(port.state()));
    expect(whole.observationCount).toBe(port.state().curves.x.length);
    port.setFitRange({ min: 30, max: 100 });
    const windowed = powderResidual(inputOf(port.state()));
    expect(windowed.observationCount).toBe(port.state().observationCount);
    expect(windowed.residual.d.length).toBe(windowed.observationCount);
    // A masked stretch (a constant non-positive sentinel, as a GSAS export writes it) is not a residual.
    const s = port.state();
    const yObs = s.curves.yObs.map((y, i) => (i < 10 ? -3 : y));
    const masked = powderResidual({ ...inputOf(s), curves: { ...s.curves, yObs }, fitRange: null });
    expect(masked.observationCount).toBe(s.curves.x.length - 10);
  });

  it("says where σ came from: the file's own, or counting statistics where the file gives none", () => {
    const s = sessionPort(mn3gaSession()).port.state();
    expect(powderResidual(inputOf(s)).residual.sigmaFrom).toBe("file");
    const bare = { ...s.pattern, points: s.pattern.points.map(({ sigma: _sigma, ...p }) => p) };
    const counted = powderResidual({ ...inputOf(s), pattern: bare }).residual;
    expect(counted.sigmaFrom).toBe("counting");
    expect(counted.sigma[0]).toBeCloseTo(Math.sqrt(Math.max(counted.yObs[0]!, 1)), 12);
  });

  it("lists an applied magnetic model's satellites among the model's lines, and flags magnetic ions under neutrons only without one", () => {
    const nuclear = powderResidual(inputOf(sessionPort(mn3gaSession()).port.state())).residual;
    expect(nuclear.magneticNeutron).toBe(true);
    expect(nuclear.reflections.some((r) => /magnetic/.test(r.phaseLabel))).toBe(false);
    // The magnetic model the data were simulated from, applied to the page.
    const s0 = mn3gaMagneticSession();
    const truth = latticeRepresentatives(magneticSubgroupLattice(s0.structure.spaceGroup.operations, MAGNETIC_TRUTH.k))[Number(MAGNETIC_TRUTH.id.slice(1)) - 1]!;
    const built = buildMagneticModel(s0.structure, MAGNETIC_TRUTH.k, ["Mn1"], [...truth.candidate.operations], { moment: 2, tieSameSite: true, tieEqualMagnitude: false, flippedUnits: [] });
    const magnetic = powderResidual(inputOf(sessionPort(withMagneticModelRows(s0, built.magnetic, built.params, built.bindings)).port.state())).residual;
    expect(magnetic.magneticNeutron).toBe(false);
    expect(magnetic.reflections.filter((r) => /magnetic/.test(r.phaseLabel)).length).toBeGreaterThan(0);
  });
});

describe("find_unexplained_peaks on both surfaces", () => {
  it("gives the same unexplained peaks and misfits for the same fit (the MCP tool once returned them unclassified)", async () => {
    const { port } = sessionPort(mn3gaImpuritySession());
    const { ex } = executor(fakeHost(port).host, "auto");
    await ex.run("refine", {});
    const live = JSON.parse((await ex.run("find_unexplained_peaks", {})).text) as { count: number; unexplained: { d: number }[]; misfits: { d: number }[] };
    const mcp = find_unexplained_peaks({ residual: powderResidual(inputOf(port.state())).residual });
    expect(live.count).toBeGreaterThan(0);
    expect(mcp.count).toBe(live.count);
    const ds = (list: readonly { d: number }[]): string[] => list.map((p) => p.d.toPrecision(5));
    expect(ds(mcp.unexplained)).toEqual(ds(live.unexplained));
    expect(ds(mcp.misfits)).toEqual(ds(live.misfits));
  }, 60_000);
});

describe("residual peaks without the floor, where the file gives σ", () => {
  it("finds no peak on a correct model's counting noise (the floor once guarded against these)", () => {
    const base = powderResidual(inputOf(sessionPort(newSession(exampleStructure())).port.state())).residual;
    let max = 0;
    for (const y of base.yCalc) max = Math.max(max, y);
    let seed = 12345;
    const uniform = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) + 0.5) / 2147483648;
    const normal = (): number => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    for (const top of [2e3, 2e4, 2e5]) {
      for (let run = 0; run < 40; run++) {
        const yTrue = base.yCalc.map((y) => (y * top) / max + 300);
        const sigma = yTrue.map((y) => Math.sqrt(y));
        const yObs = yTrue.map((y, i) => y + sigma[i]! * normal());
        const found = residualPeaks({ ...base, yObs, yCalc: yTrue, sigma, sigmaFrom: "file" });
        expect([...found.between, ...found.beside, ...found.onReflection], `${top} counts, run ${run}`).toEqual([]);
      }
    }
  });
});
