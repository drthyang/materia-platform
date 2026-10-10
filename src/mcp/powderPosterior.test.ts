import { describe, it, expect } from "vitest";
import { build_refinement, parse_structure, refine_powder, sample_posterior, simulate_pattern } from "@/mcp/tools";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";

/**
 * sample_posterior on a powder fit (MCP): the same ensemble sampler the
 * powder page runs, on the problem refine_powder fits — given the profile
 * build_refinement returned.
 */
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

describe("sample_posterior on a powder fit", () => {
  it("samples the refined powder problem, and refuses NUTS and a missing profile", async () => {
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
    const free = new Set(["scale", "bkg0", "B_W1", "B_O2"]);
    const parameters = built.parameters.map((p) => ({ ...p, fixed: !free.has(p.id) }));
    const fit = await refine_powder({ structure, pattern, parameters, bindings: built.bindings, profile: built.profile });
    const refined = fit.parameters;

    const run = await sample_posterior({ structure, pattern, parameters: refined, bindings: built.bindings, profile: built.profile, nSteps: 60, seed: 11, linearizedEsd: fit.result.esd });
    expect(run.sampler).toBe("ensemble");
    expect([...run.freeIds].sort()).toEqual(["B_O2", "B_W1", "bkg0", "scale"]);
    expect(run.posterior).toHaveLength(4);
    for (const q of run.posterior) {
      expect(q.q025).toBeLessThanOrEqual(q.median);
      expect(q.median).toBeLessThanOrEqual(q.q975);
      expect(q.esdRatio).toBeGreaterThan(0);
    }
    // Continue from the resume token: the same problem, more steps.
    const more = await sample_posterior({ structure, pattern, parameters: refined, bindings: built.bindings, profile: built.profile, nSteps: 20, resume: run.resume });
    expect(more.resume.stepIndex).toBe(80);

    await expect(sample_posterior({ structure, pattern, parameters: refined, bindings: built.bindings, profile: built.profile, nSteps: 5, sampler: "nuts" })).rejects.toThrow(/"nuts" is for PDF fits/);
    await expect(sample_posterior({ structure, pattern, parameters: refined, bindings: built.bindings, nSteps: 5 })).rejects.toThrow(/needs the `profile`/);
  }, 120000);
});
