/**
 * The hover text of the powder page's Microstructure readout. Page only: no
 * tool or report prints it.
 *
 * Constant wavelength: the readout is `extractSizeStrain` on the refined
 * Lorentzian X and Y (core/diffraction/microstructure.ts). Its microstrain is
 * the Stokes–Wilson ε = π·Y/72000 (β = 4·ε·tanθ, Y in centidegrees), shown
 * × 10⁶. It is not GSAS-II's Mustrain: GSAS-II's constant-wavelength width is
 * 0.018·Mustrain·tanθ/π centidegrees (GSASIIstrMath.py `GetSampleSigGam`), so
 * its Mustrain for the same Y is 10⁶·π·Y/18000, four times the number shown.
 */
export const MICROSTRAIN_TITLE_CW =
  "Derived from the refined Lorentzian X (size) and Y (microstrain), with the instrument seed deconvoluted. Stokes–Wilson microstrain ε = π·Y/72000 (× 10⁶ here); GSAS-II's Mustrain for the same Y is 10⁶·π·Y/18000 (4 × this).";

/**
 * Time of flight: the readout is the isotropic microstrain row (10⁶·ε, with
 * ε = Δd/d the standard deviation of a Gaussian strain: docs/EQUATIONS.md
 * §17), less the row's starting value in quadrature. There is no Lorentzian X
 * or Y in it. The starting value is not an instrument's measured width: it is
 * the flat 1500 × 10⁻⁶ `buildPowderSpec` seeds (app/powderSpec.ts), or the
 * value a saved fit opens on (the bundled POWGEN example's 616.82), so the
 * text says "the row's starting value" and not "the instrument seed".
 */
export const MICROSTRAIN_TITLE_TOF =
  "Derived from the refined microstrain row (ε = Δd/d, a Gaussian standard deviation, × 10⁶), less the row's starting value in quadrature.";
