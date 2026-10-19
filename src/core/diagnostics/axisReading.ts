/**
 * Whether a powder pattern's axis can be what its file says: the structure's
 * reflections against the axis's d range. A 2θ axis that holds next to none of
 * them (d-spacings, or Q, read as degrees: 0.6–5 "°") is the commonest swapped
 * unit. The app gives it in get_state; MCP's check_fit_range returns it.
 */

import type { SpaceGroup, UnitCell } from "@/core/crystal/types";
import type { PowderXUnit } from "@/core/diffraction/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { minMax } from "@/core/math/extent";
import { sig } from "@/core/math/precision";
import { AXIS_REFLECTIONS_MIN } from "@/core/diagnostics/thresholds";

/** Each axis unit as the readings name it. */
export const X_UNIT_LABEL: Readonly<Record<PowderXUnit, string>> = { tof: "µs (TOF)", twoTheta: "° 2θ", dSpacing: "Å (d)", q: "Å⁻¹ (Q)" };

export interface AxisInput {
  readonly unit: PowderXUnit;
  /** The pattern's extent on its own axis. */
  readonly extent: { readonly min: number; readonly max: number };
  /** Each point's d (Å) at the page's wavelength or calibration; null when the axis converts to none. */
  readonly d: readonly number[] | null;
  readonly structure: { readonly cell: UnitCell; readonly spaceGroup: SpaceGroup; readonly sites: readonly unknown[] };
}

/** The warning, or null when the axis holds the reflections a pattern of it should (or there is no structure to read it against). */
export function axisPlausibility(o: AxisInput): string | null {
  if (o.structure.sites.length === 0 || !o.d || o.d.length === 0) return null;
  const label = X_UNIT_LABEL[o.unit];
  const axis = `the ${label} axis (${sig(o.extent.min, 4)}–${sig(o.extent.max, 4)})`;
  const finite = o.d.filter((v) => Number.isFinite(v) && v > 0);
  if (finite.length === 0) return `${axis} converts to no d-spacing at this wavelength: is the axis in another unit (d in Å, or Q)? Ask the user before anything else.`;
  const { min: lo, max: hi } = minMax(finite);
  const inside = generateReflections(o.structure.cell, o.structure.spaceGroup, lo, Math.min(hi, 50)).length;
  if (inside >= AXIS_REFLECTIONS_MIN) return null;
  return `${axis} spans d ${sig(lo, 3)}–${sig(hi, 3)} Å at this wavelength, where the structure has ${inside === 0 ? "no reflection" : `only ${inside} reflection${inside === 1 ? "" : "s"}`}: the axis is likely in another unit (d in Å or Q read as ${label}), or the wavelength is wrong. Ask the user before refining: no refinement fixes it.`;
}
