/**
 * A synthetic B-at-0 case with a known truth (core/diagnostics/zeroAdp.ts):
 * Cr₂WO₆ (P4₂/mnm) simulated on a neutron diffractometer (λ = 2.4067 Å, to
 * Q ≈ 4.7 Å⁻¹) with B(O1) = B(O2) = 0.6 Å² at low counts, where the two oxygen
 * B's are poorly separated. With counts 600, noise draw 17 leaves B(O1) on 0
 * and B(O2) sensible (rule A); draw 30 leaves no sensible partner (rule B).
 */

import { parse_structure, simulate_pattern } from "@/mcp/tools";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";

export const ZERO_ADP_CIF = `data_cr2wo6
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
export const ZERO_ADP_INSTRUMENT: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 2.4067, u: 3889, v: -6417, w: 3098, x: 0, y: 0 };
export const ZERO_ADP_TRUTH_O = 0.6;

/** The simulated pattern at `counts` above a flat 20, Gaussian noise from the seeded generator. */
export function zeroAdpSimulated(counts: number, seed0: number): { pattern: PowderPattern; structure: ReturnType<typeof parse_structure>["structure"] } {
  const structure = parse_structure({ cif: ZERO_ADP_CIF }).structure;
  const sim = simulate_pattern({ structure, instrument: ZERO_ADP_INSTRUMENT, xMin: 8, xMax: 130, points: 1800 });
  const top = Math.max(...sim.curves.yCalc);
  let seed = seed0 * 7919;
  const u = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pattern: PowderPattern = {
    id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 2.4067 }, wavelength: 2.4067,
    points: sim.curves.x.map((x, i) => {
      const y = (counts * sim.curves.yCalc[i]!) / top + 20;
      return { x, yObs: y + Math.sqrt(y) * Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()), sigma: Math.sqrt(y) };
    }),
  };
  return { pattern, structure };
}

