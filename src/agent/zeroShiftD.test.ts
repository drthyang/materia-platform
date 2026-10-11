import { describe, it, expect } from "vitest";
import { parse_structure, simulate_pattern } from "@/mcp/tools";
import { loadedSession } from "@/app/powderSession";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";

/**
 * A d read off the data is d with the refined zero taken out. Cr₂WO₆ measured
 * with a +0.25° zero and an extra peak at d 2.330 Å (an impurity line): once
 * the zero refines, find_unexplained_peaks names the line at 2.330 Å — not at
 * the 2.322 Å the raw 2θ gives (the cryostat's Al 111 on the real data read
 * 0.35 % short for exactly this reason).
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
const ZERO = 0.25;
const D_EXTRA = 2.33;

describe("d with the zero shift taken out", () => {
  it("places an extra peak at its own d once the zero is refined", async () => {
    const structure = parse_structure({ cif: CIF }).structure;
    const sim = simulate_pattern({ structure, instrument: INSTRUMENT, xMin: 10, xMax: 130, points: 2400 });
    const top = Math.max(...sim.curves.yCalc);
    const tt = (2 * Math.asin(2.4067 / (2 * D_EXTRA)) * 180) / Math.PI;
    const pattern: PowderPattern = {
      id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 2.4067 }, wavelength: 2.4067,
      // The instrument reads every angle 0.25° high.
      points: sim.curves.x.map((x, i) => {
        const y = (5000 * sim.curves.yCalc[i]!) / top + 60 + 300 * Math.exp(-4 * Math.LN2 * ((x - tt) / 0.3) ** 2);
        return { x: x + ZERO, yObs: y, sigma: Math.sqrt(y) };
      }),
    };
    const { port, session } = sessionPort(loadedSession(structure, pattern, INSTRUMENT), INSTRUMENT);
    const { ex } = executor(fakeHost(port).host, "auto");
    await ex.run("set_free", { free: ["scale", "bkg*", "cell_a", "cell_c", "zero"] });
    await ex.run("refine", {});
    expect(session().powderParams.find((p) => p.id === "zero")!.value).toBeCloseTo(ZERO, 2);
    const found = JSON.parse((await ex.run("find_unexplained_peaks", {})).text) as { unexplained: { d: number }[] };
    const extra = found.unexplained.find((p) => Math.abs(p.d - D_EXTRA) < 0.02)!;
    expect(extra).toBeDefined();
    expect(Math.abs(extra.d - D_EXTRA) / D_EXTRA).toBeLessThan(0.0005);
  }, 60000);
});
