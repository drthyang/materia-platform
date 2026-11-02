/**
 * The powder intensity of a magnetic line: |F_M⊥|² summed over every member of
 * its family (THY-58).
 *
 * A powder sums the scattering of every reciprocal-lattice point at a given
 * |Q|. For a magnetic line that is
 *
 *   I(line) = Σ_{Q ∈ family} |F_M⊥(Q)|²,   F_M⊥ = q̂ × (F_M × q̂),
 *
 * over the members of the parent's Laue family that are satellites of the
 * model's arm (`magneticSatellites`: both ±k, every equivalent reflection; at
 * k = 0 the whole family). Each member gets its own q̂, so its own
 * perpendicular projection. The members' |F_M⊥|² are equal only when the
 * magnetic group keeps the parent's Laue symmetry; below it (an ordered
 * moment direction, a lower magnetic point group, a k that splits the star)
 * they differ, and one member times the count is not the powder intensity.
 *
 * The sum is the same for every domain of the structure: a domain is the
 * structure carried by a parent operation g, its |F_M⊥|² at Q is the
 * original's at g⁻¹Q, and the family is closed under g. Reading the family at
 * one member made two domains of one magnetic group fit differently — wR
 * 0.31 % and 29.6 % for the two P_c-3m1 domains on the synthetic Mn₃Ga page —
 * which the sum removes.
 *
 * The moment expansion is done once per model (`magneticStructureFactorEvaluator`)
 * and every member evaluated from it.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { MagneticModel } from "@/core/magnetic/types";
import { magneticSatellites, type SatellitePosition } from "@/core/magnetic/satellites";
import { magneticStructureFactorEvaluator } from "@/core/magnetic/structureFactor";

/** A magnetic line with its powder intensity before Lorentz–polarization and scale. */
export interface SatelliteIntensity extends SatellitePosition {
  /** Σ over the family's members of |F_M⊥|² (fm², the multiplicity included). */
  readonly squared: number;
}

/** |F_M⊥|² summed over a family's members, from one model's prepared expansion. */
export function familySquared(
  evaluate: (h: number, k: number, l: number) => { readonly squared: number },
  members: SatellitePosition["members"],
): number {
  let sum = 0;
  for (const m of members) sum += evaluate(m[0], m[1], m[2]).squared;
  return sum;
}

/**
 * Every magnetic line of the model in an inclusive d-window, each with its
 * powder intensity (the family sum), on the positions of `magneticSatellites`.
 */
export function satelliteIntensities(
  structure: StructureModel,
  magnetic: MagneticModel,
  dMin: number,
  dMax: number,
): SatelliteIntensity[] {
  const k = magnetic.propagation[0] ?? [0, 0, 0];
  const evaluate = magneticStructureFactorEvaluator(structure, magnetic);
  return magneticSatellites(structure.cell, structure.spaceGroup, k, dMin, dMax).map((s) => ({
    ...s,
    squared: familySquared(evaluate, s.members),
  }));
}
