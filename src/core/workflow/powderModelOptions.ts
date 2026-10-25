/**
 * User-facing powder model options that travel with a session: which shared-site
 * ties are on, and which microstrain model is in use. Kept in the core so the
 * project file (core/project) and the UI's spec builder (app/powderSpec) share
 * one definition without the core importing the app layer.
 */

/**
 * Whether atoms sharing a crystallographic site are tied (see
 * structureRefinement). A shared site's occupancies always sum to exactly its
 * total, by a tie: the last member follows the total minus the others.
 */
export interface SiteTies {
  readonly positions?: boolean;
  readonly adp?: boolean;
  /** Hold the composition: each element on two or more sites keeps its total in the cell. */
  readonly composition?: boolean;
  /** Each shared site's total occupancy by the site's key (its first member's label); 1 where absent, below 1 for vacancies. */
  readonly totals?: Readonly<Record<string, number>>;
}

/** Whether a value is a site's total occupancy the tie takes: a fraction in [0.001, 1]. */
export const isSiteTotal = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0.001 && v <= 1;

/**
 * Sample microstrain (Mustrain) model, GSAS-II-style:
 *  - `isotropic`   — the Lorentzian Y term (Γ ∝ tanθ); always present, no extra rows.
 *  - `uniaxial`    — equatorial/axial Y about the unique axis (Y⊥, Y∥).
 *  - `generalized` — Stephens (1999) anisotropic S-parameters.
 */
export type MustrainModel = "isotropic" | "uniaxial" | "generalized";

export const MUSTRAIN_MODELS: readonly MustrainModel[] = ["isotropic", "uniaxial", "generalized"];

/** The registry's peak corrections the page can switch on (core/diffraction/corrections.ts). */
export const PEAK_CORRECTION_IDS = ["displacement", "transparency", "absorption", "roughness"] as const;
export type PeakCorrectionId = (typeof PEAK_CORRECTION_IDS)[number];

/**
 * Sample and geometry corrections switched on for a pattern; each adds its
 * parameter rows, fixed on load (free them in the Corrections / profile
 * groups). Off by default: corrections are end-stage polish.
 */
export interface SampleCorrections {
  /** Finger–Cox–Jephcoat axial-divergence asymmetry (S/L, H/L); constant wavelength. */
  readonly asymmetry?: boolean;
  /** March–Dollase preferred orientation along this reciprocal-lattice direction (hkl). */
  readonly preferredOrientation?: readonly [number, number, number];
  /** Sample displacement, transparency, Debye–Scherrer absorption μR, Suortti roughness. */
  readonly peak?: readonly PeakCorrectionId[];
}

/** A change of the corrections: what is given changes (a null axis turns texture off). */
export interface CorrectionsUpdate {
  readonly asymmetry?: boolean;
  readonly preferredOrientation?: readonly [number, number, number] | null;
  readonly peak?: readonly PeakCorrectionId[];
}
