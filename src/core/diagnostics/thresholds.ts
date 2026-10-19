/**
 * The numbers the judgment code decides by, in one place: the engine's
 * assessment, the Validation tab, the Agent's guard and report, the posterior
 * reading, the single-crystal readings and the magnetic ranking import them
 * from here, and the skills quote them (a test holds each quoted number to its
 * constant). Each says where it comes from.
 */

/**
 * Two free parameters correlated at |ρ| at or above this are not refined
 * together (the Agent's guard refuses), and the assessment, the report and
 * the Validation tab warn about them. The usual "dangerous" line in
 * least-squares practice; one of the pair is fixed or tied.
 */
export const CORRELATION_LIMIT = 0.95;

/**
 * A pair over CORRELATION_LIMIT whose correlation a third free parameter
 * carries: with every other free parameter held fixed the two correlate below
 * CARRIED_BELOW (the engine's `conditional`), and their own correlation stays
 * under CARRIED_MAX. On synthetic corundum to d = 0.4 Å, scale ↔ B(O) reads
 * 0.976 with 0.72 conditional, and both B's come back within 0.002 Å² of the
 * truth. The guard refines such a pair; the assessment notes it.
 */
export const CARRIED_BELOW = 0.9;
export const CARRIED_MAX = 0.99;

/**
 * GoF (√χ²ν = Rwp/Rexp) bands after Toby (2006), for a powder fit:
 * excellent up to 1.5, good to 2.5, fair to 4, poor above; below 0.8 the fit
 * is "too good" (σ overestimated or the model over-parameterized).
 */
export const GOF_BANDS = { tooGood: 0.8, excellent: 1.5, good: 2.5, fair: 4 } as const;

/** The Validation tab's single-crystal GooF it calls good without remark (SHELXL's weights bring a right model near 1). */
export const GOOF_SINGLE_CRYSTAL_OK = 1.3;

/** A refinement has settled when its last cycle moved no parameter by more than this many esds. */
export const SHIFT_SETTLED = 0.1;

/** Fewer observations than this per free parameter thins the data's support (a warning below half of it). */
export const DATA_PER_PARAMETER = 10;

/** A fit-window cut that leaves out more than this fraction of the points is the user's call, not the Agent's (check_fit_range). */
export const LARGE_CUT = 0.15;

/** Two reflections closer than this (relative d) overlap, so an absence between them cannot be tested. */
export const FORBIDDEN_OVERLAP = 0.02;

/** The posterior's width over the esd beyond which the esd understates the uncertainty. */
export const POSTERIOR_WIDER = 1.5;
/** Posterior correlations worth naming. */
export const POSTERIOR_CORRELATION = 0.8;
/** A posterior run has converged below this R̂, with its ESS reached (Vehtari et al. 2021's split-R̂ line). */
export const POSTERIOR_RHAT = 1.05;
/** Below this R̂, with the ESS reached, an ensemble run is read as nearly converged. */
export const POSTERIOR_NEARLY_RHAT = 1.1;

/** The strongest reflections' Fo²/Fc² against the others' below this suggests extinction. */
export const EXTINCTION_K = 0.95;

/** Single crystal: R_int above this, or completeness below the next, is noted in the report. */
export const R_INT_NOTE = 0.1;
export const COMPLETENESS_NOTE = 0.95;

/** A Flack or Parsons u below this determines the absolute structure (Flack & Bernardinelli). */
export const FLACK_U_DETERMINED = 0.04;

/** Magnetic groups whose wR is within this of the best are tied, where the fit reports no χ² (the mPDF's, on uniform weights); the maximal one with the fewest moments then leads. */
export const RANK_TIE_WR = 1e-4;

/**
 * Hamilton's test of the magnetic ranking (Hamilton, Acta Cryst. 18 (1965)
 * 502): a group with more moment parameters fits "within the noise" of one
 * with fewer unless its χ² is lower beyond the F distribution's 5 % point; a
 * group with as many or more is within the noise when its χ² exceeds the
 * best's by less than one parameter's worth at the same level.
 */
export const RANK_NOISE_ALPHA = 0.05;
