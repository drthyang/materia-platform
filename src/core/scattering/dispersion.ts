/**
 * Anomalous X-ray scattering: the f′ and f″ an element adds to its form
 * factor, f = f0(s) + f′ + i·f″, at the wavelength of a laboratory line. They
 * make |F(h)| differ from |F(−h)| in a non-centrosymmetric crystal (the
 * Bijvoet differences that determine its absolute structure), and change every
 * |F| slightly: a heavy atom's f′ at Mo Kα is tenths of an electron, its f″ up
 * to a few. SHELXL applies them by default (DISP); so does the single-crystal
 * fit here, for any wavelength within 0.5 % of a tabulated line.
 */

import { DISPERSION, DISPERSION_LINES } from "@/core/scattering/dispersionData";

/** The tabulated line within 0.5 % of `wavelength` (Å), or null (a synchrotron wavelength, an unusual anode). */
export function dispersionLine(wavelength: number): { readonly index: number; readonly name: string; readonly wavelength: number } | null {
  let best: { index: number; name: string; wavelength: number } | null = null;
  DISPERSION_LINES.forEach((line, index) => {
    const off = Math.abs(line.wavelength - wavelength) / line.wavelength;
    if (off < 0.005 && (!best || off < Math.abs(best.wavelength - wavelength) / best.wavelength)) best = { index, ...line };
  });
  return best;
}

/** The element of a site's type symbol: "Ga3+" → "Ga", "O2-" → "O". */
const elementOf = (symbol: string): string => {
  const m = symbol.match(/^[A-Z][a-z]?/);
  return m ? m[0] : symbol;
};

/**
 * f′ and f″ (electrons) of an element at a tabulated line; 0 for hydrogen, helium and an element not in the table.
 *
 *   f = f0(s) + f′ + i·f″
 *
 * Symbols → code: f′ `fp`, f″ `fpp` (electrons, independent of s); f0 is
 * xray.ts `xrayFormFactor`. The sum is formed in diffraction/scKernel.ts
 * `scPlan` (`a.re + extra.fp`, `a.im + extra.fpp`).
 * Reference: values by Cromer & Liberman's method, Acta Cryst. A37 (1981) 267
 * (see dispersionData.ts).
 */
export function anomalousScattering(element: string, line: { readonly index: number }): { readonly fp: number; readonly fpp: number } {
  const pair = DISPERSION[elementOf(element)]?.[line.index];
  return pair ? { fp: pair[0], fpp: pair[1] } : { fp: 0, fpp: 0 };
}
