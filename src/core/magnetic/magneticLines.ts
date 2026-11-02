/**
 * The lines a magnetic model puts intensity on: the satellite positions G ± k
 * of its propagation vector whose |F_M⊥|², at the model's moments and averaged
 * over the line's family (the powder pattern's intensity there, per member),
 * is not negligible next to the strongest. A model whose moments are
 * all zero has none. One rule for the plot's magnetic tick row and for the
 * residual readings: a magnetic line explains a residual peak only where the
 * calculated pattern has magnetic intensity (THY-45).
 */

import type { StructureModel } from "@/core/crystal/types";
import type { MagneticModel } from "@/core/magnetic/types";
import { satelliteIntensities } from "@/core/magnetic/powderAverage";

export interface MagneticLine {
  readonly h: number;
  readonly k: number;
  readonly l: number;
  readonly d: number;
  /** |F_M⊥|² at the model's moments, averaged over the family's members (the line's powder intensity per member). */
  readonly squared: number;
}

/** Relative |F_M⊥|² below which a satellite carries no intensity (of the strongest). */
export const MAGNETIC_LINE_EPS = 1e-4;

/** The model's satellites with magnetic intensity over an inclusive d-window. */
export function magneticLines(structure: StructureModel, magnetic: MagneticModel, dMin: number, dMax: number): MagneticLine[] {
  if (magnetic.moments.length === 0) return [];
  const sat = satelliteIntensities(structure, magnetic, dMin, dMax).map((s) => ({
    h: s.h, k: s.k, l: s.l, d: s.d,
    squared: s.multiplicity > 0 ? s.squared / s.multiplicity : 0,
  }));
  let max = 0;
  for (const s of sat) if (s.squared > max) max = s.squared;
  if (!(max > 0)) return [];
  const eps = max * MAGNETIC_LINE_EPS;
  return sat.filter((s) => s.squared > eps);
}
