import { describe, it, expect } from "vitest";
import { build_refinement, check_cell_symmetry, parse_structure, refine_powder, sample_posterior, simulate_pattern } from "@/mcp/tools";
import { executor, fakeHost } from "@/testSupport/agentHeadless";
import { mn3gaWrongWavelengthSession, powderPage } from "@/agent/evals/pages";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";

/**
 * One reading under both surfaces (plan 2.3): the cell check's and the
 * posterior's, which the app's tools gave and MCP's raw outputs left to the
 * client, now the same core functions in both.
 */

describe("the cell check's reading on MCP and in the app", () => {
  it("names a wrong wavelength the same way on both", async () => {
    const port = powderPage(mn3gaWrongWavelengthSession());
    const s = port.state();
    const live = JSON.parse((await executor(fakeHost(port).host).ex.run("check_cell_symmetry", {})).text) as { reading: string };
    const mcp = check_cell_symmetry({ structure: s.structure, pattern: s.pattern, ...(s.instrument ? { instrument: s.instrument } : {}) });
    const wavelength = /^The pattern's \d+ strongest peaks index the structure's cell with every d × 1\.01\d\d .*a wrong wavelength: the data would be at λ 1\.5\d+ Å, not 1\.556 Å.*Ask the user to confirm before anything else: no refinement fixes it, and a refined cell would absorb it\./;
    expect(live.reading).toMatch(wavelength);
    expect(mcp.reading).toMatch(wavelength);
    // The same first sentence: the d-scale reading, from one function.
    const first = (t: string): string => t.slice(0, t.indexOf("absorb it.") + "absorb it.".length);
    expect(first(mcp.reading)).toBe(first(live.reading));
  });
});

const CIF = `data_t
_cell_length_a 4.5753
_cell_length_b 4.5753
_cell_length_c 8.8537
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 42/m n m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
W1 W6+ 0 0 0 1 0.5
Cr1 Cr3+ 0 0 0.3330 1 0.5
O1 O2- 0.2985 0.2985 0 1 0.6
O2 O2- 0.3075 0.3075 0.3400 1 0.6
`;
const INSTRUMENT: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 2.4067, u: 3889, v: -6417, w: 3098, x: 0, y: 0 };

describe("the posterior's reading on MCP", () => {
  it("reads each parameter's interval against its esd, and says when to resume", async () => {
    const structure = parse_structure({ cif: CIF }).structure;
    const sim = simulate_pattern({ structure, instrument: INSTRUMENT, xMin: 10, xMax: 130, points: 600 });
    const top = Math.max(...sim.curves.yCalc);
    let seed = 3;
    const u = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pattern: PowderPattern = {
      id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 2.4067 }, wavelength: 2.4067,
      points: sim.curves.x.map((x, i) => {
        const y = (5000 * sim.curves.yCalc[i]!) / top + 60;
        return { x, yObs: y + Math.sqrt(y) * Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()), sigma: Math.sqrt(y) };
      }),
    };
    const built = build_refinement({ structure, pattern, instrument: INSTRUMENT });
    const free = new Set(["scale", "bkg0", "B_W1"]);
    const parameters = built.parameters.map((p) => ({ ...p, fixed: !free.has(p.id) }));
    const fit = await refine_powder({ structure, pattern, parameters, bindings: built.bindings, profile: built.profile });
    // Too short to converge: the reading says so, and how to go on.
    const run = await sample_posterior({ structure, pattern, parameters: fit.parameters, bindings: built.bindings, profile: built.profile, nSteps: 30, seed: 11, linearizedEsd: fit.result.esd });
    expect(run.intervals.map((r) => r.id).sort()).toEqual(["B_W1", "bkg0", "scale"]);
    for (const r of run.intervals) {
      expect(r.esd).toBeGreaterThan(0);
      expect(r.verdict).toBe(run.converged ? expect.any(String) : "not converged: do not read yet");
    }
    expect(run.reading).toMatch(/^Not converged yet \(R̂max [\d.]+, ESS min \d+; wanted R̂ < 1\.05 and ESS ≥ 100\): call sample_posterior again with `resume` \(this result's\) before reading the intervals\.$/);
  }, 60_000);
});
