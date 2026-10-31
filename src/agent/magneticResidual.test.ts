import { describe, expect, it } from "vitest";
import { parse_structure, simulate_pattern } from "@/mcp/tools";
import { loadedSession } from "@/app/powderSession";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";
import type { MagneticModel } from "@/core/magnetic/types";
import { latticeRepresentatives, magneticSubgroupLattice } from "@/core/magnetic/subgroupLattice";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { magneticLines } from "@/core/magnetic/magneticLines";

/**
 * With a magnetic model applied, its satellites are lines of the model where
 * its moments put intensity: the Agent's peak reading counts a residual on one
 * as that line's misfit, not as intensity no phase explains (review low
 * finding, powderTools.ts:697). A satellite the model has no intensity on —
 * zero moments — explains nothing: a magnetic tick alone never does (THY-45).
 */
describe("the residual's reflections with a magnetic model applied", () => {
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

  it("reads a residual on the satellite 0 0 1 + k as its misfit, and as an unexplained peak without the model or with a model of zero moments", async () => {
    const structure = parse_structure({ cif: CIF }).structure;
    const sim = simulate_pattern({ structure, instrument: INSTRUMENT, xMin: 10, xMax: 130, points: 1200 });
    const top = Math.max(...sim.curves.yCalc);
    // The satellite 0 0 1 + k of k = (0 0 ½): d = c/1.5 = 5.902 Å, 2θ 23.4°, away from every nuclear line; in the data, not in the model.
    const d = 8.8537 / 1.5;
    const at = (2 * Math.asin(2.4067 / (2 * d)) * 180) / Math.PI;
    let seed = 5;
    const u = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pattern: PowderPattern = {
      id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 2.4067 }, wavelength: 2.4067,
      points: sim.curves.x.map((x, i) => {
        const y = (5000 * sim.curves.yCalc[i]!) / top + 60 + 900 * Math.exp((-4 * Math.LN2 * (x - at) ** 2) / 0.5 ** 2);
        return { x, yObs: y + Math.sqrt(y) * Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()), sigma: Math.sqrt(y) };
      }),
    };
    const peaksWith = async (magnetic: MagneticModel | undefined): Promise<{ unexplained: { d: number }[]; misfits: { d: number; near?: string }[] }> => {
      const session = { ...loadedSession(structure, pattern, INSTRUMENT), ...(magnetic ? { magnetic } : {}) };
      const { port } = sessionPort(session, INSTRUMENT);
      const { ex } = executor(fakeHost(port).host, true);
      const out = await ex.run("find_unexplained_peaks", { showMisfits: true });
      return JSON.parse(out.text) as { unexplained: { d: number }[]; misfits: { d: number; near?: string }[] };
    };
    const near = (p: { d: number }): boolean => Math.abs(p.d - d) < 0.03;
    const without = await peaksWith(undefined);
    expect(without.unexplained.some(near)).toBe(true);
    // A model with no moment puts no intensity on its satellites: the peak stays unexplained.
    const empty = await peaksWith({ id: "m", structureId: structure.id, propagation: [[0, 0, 0.5]], moments: [] });
    expect(empty.unexplained.some(near)).toBe(true);
    expect(empty.misfits.some((p) => near(p) && /magnetic/.test(p.near ?? ""))).toBe(false);
    // A model of a magnetic group of k with intensity on that satellite: its moments, 2.5 µB per mode.
    const magnetic = latticeRepresentatives(magneticSubgroupLattice(structure.spaceGroup.operations, [0, 0, 0.5]))
      .map((rep) => {
        const built = buildMagneticModel(structure, [0, 0, 0.5], ["Cr1"], rep.candidate.operations);
        return applyMagneticMoments(built.magnetic, built.bindings, Object.fromEntries(built.params.map((p) => [p.id, 2.5])));
      })
      .find((m) => magneticLines(structure, m, d - 0.05, d + 0.05).some((l) => Math.abs(l.d - d) < 0.01))!;
    expect(magnetic).toBeDefined();
    const withModel = await peaksWith(magnetic);
    expect(withModel.unexplained.some(near)).toBe(false);
    expect(withModel.misfits.find(near)?.near).toMatch(/^on \S+ magnetic (0 0 1 \+ k|0 0 2 − k|0 0 -1 − k|0 0 -2 \+ k)$/);
  });
});
