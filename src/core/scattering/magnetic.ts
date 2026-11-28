/**
 * Magnetic neutron form factor.
 *
 * Spin-only (⟨j0⟩) and dipole (⟨j0⟩ + (2/g − 1)·⟨j2⟩) approximations with
 *   ⟨j0⟩(s) = A·e^{−a·s²} + B·e^{−b·s²} + C·e^{−c·s²} + D,   s = sinθ/λ (Å⁻¹),
 * normalized to 1 at s = 0. Coefficients come from the generated
 * {@link J0_COEFFS}/{@link J2_COEFFS} tables (International Tables Vol. C §4.4.5,
 * Brown) — see [magneticFormFactorData.ts](./magneticFormFactorData.ts) and
 * scripts/gen_magnetic_ff.py. This file holds only the evaluation logic.
 */

import type { MagneticFormFactorTable } from "@/core/scattering/types";
import { J0_COEFFS, J2_COEFFS } from "@/core/scattering/magneticFormFactorData";

export { J0_COEFFS, J2_COEFFS };

/**
 * Spin-only magnetic form factor:
 *   ⟨j0⟩(s) = A·exp(−a·s²) + B·exp(−b·s²) + C·exp(−c·s²) + D
 * Symbols → code: A, B, C, D `k.A`, `k.B`, `k.C`, `k.D` (dimensionless);
 * a, b, c `k.a`, `k.b`, `k.c` (Å²); s = sinθ/λ = 1/(2d) `s` (Å⁻¹).
 * Dimensionless, 1 at s = 0.
 * Reference: P. J. Brown, International Tables for Crystallography Vol. C,
 * §4.4.5 (magnetic form factors).
 * Also in: workers/gpuMagneticStructureFactor.ts (WGSL `fMag`, hot loop).
 */
export function magneticFormFactorJ0(ionId: string, s: number): number {
  const k = J0_COEFFS[ionId];
  if (!k) {
    throw new Error(`No magnetic form factor for ion "${ionId}"`);
  }
  const s2 = s * s;
  return (
    k.A * Math.exp(-k.a * s2) +
    k.B * Math.exp(-k.b * s2) +
    k.C * Math.exp(-k.c * s2) +
    k.D
  );
}

/**
 * ⟨j2⟩(s) = [A·exp(−a·s²) + B·exp(−b·s²) + C·exp(−c·s²) + D]·s², or NaN when
 * the ion has no tabulated ⟨j2⟩ coefficients. Same symbols and units as
 * {@link magneticFormFactorJ0} (here A…D are in Å², so that ⟨j2⟩ is
 * dimensionless); 0 at s = 0. Reference: Brown, ITC Vol. C §4.4.5.
 */
export function magneticFormFactorJ2(ionId: string, s: number): number {
  const k = J2_COEFFS[ionId];
  if (!k) return NaN;
  const s2 = s * s;
  return (k.A * Math.exp(-k.a * s2) + k.B * Math.exp(-k.b * s2) + k.C * Math.exp(-k.c * s2) + k.D) * s2;
}

/**
 * Dipole-approximation magnetic form factor f(s) = ⟨j0⟩ + (2/g − 1)·⟨j2⟩ for a
 * moment with Landé factor g (Lovesey 1984, eq. 11.110). The spin part of the
 * moment carries ⟨j0⟩ and the orbital part ⟨j0⟩ + ⟨j2⟩, so the ⟨j2⟩ weight is
 * the orbital fraction μ_L/μ = (2 − g)/g. Reduces to the spin-only ⟨j0⟩ when
 * g = 2 or when the ion has no tabulated ⟨j2⟩.
 * Symbols → code: ⟨j0⟩ `j0`, ⟨j2⟩ `j2`, g `g` (Landé factor), s `s` (Å⁻¹).
 * Dimensionless, 1 at s = 0.
 */
export function magneticFormFactorDipole(ionId: string, s: number, g: number): number {
  const j0 = magneticFormFactorJ0(ionId, s);
  const j2 = magneticFormFactorJ2(ionId, s);
  return Number.isNaN(j2) ? j0 : j0 + (2 / g - 1) * j2;
}

export const magneticTable: MagneticFormFactorTable = {
  j0(ionId: string, s: number): number {
    return magneticFormFactorJ0(ionId, s);
  },
  j2(ionId: string, s: number): number {
    return magneticFormFactorJ2(ionId, s);
  },
  dipole(ionId: string, s: number, g: number): number {
    return magneticFormFactorDipole(ionId, s, g);
  },
  has(ionId: string): boolean {
    return ionId in J0_COEFFS;
  },
  hasJ2(ionId: string): boolean {
    return ionId in J2_COEFFS;
  },
};
