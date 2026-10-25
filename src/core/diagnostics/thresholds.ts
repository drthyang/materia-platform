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
 * Correlations from this up to CORRELATION_LIMIT are reported, never silent
 * (the user's rule): the pair is refined, and the report says how strongly
 * the data couple it.
 */
export const CORRELATION_REPORTED = 0.8;

/**
 * GoF (√χ²ν = Rwp/Rexp) bands after Toby (2006), for a powder fit:
 * excellent up to 1.5, good to 2.5, fair to 4, poor above; below 0.8 the fit
 * is "too good" (σ overestimated or the model over-parameterized).
 */
export const GOF_BANDS = { tooGood: 0.8, excellent: 1.5, good: 2.5, fair: 4 } as const;

/** The single-crystal GooF called good without remark (SHELXL's weights bring a right model near 1). */
export const GOOF_SINGLE_CRYSTAL_OK = 1.3;

/**
 * The single-crystal GooF bands, for the Validation tab and the assessment
 * alike: the powder bands' steps from the single-crystal line (excellent up
 * to 1.3, good to 2.3, fair to 3.8). On F² the weighting scheme is refitted
 * to the model, so a GooF the powder bands call excellent is a misfit here.
 */
export const GOOF_SINGLE_CRYSTAL_BANDS = {
  tooGood: GOF_BANDS.tooGood,
  excellent: GOOF_SINGLE_CRYSTAL_OK,
  good: GOOF_SINGLE_CRYSTAL_OK + (GOF_BANDS.good - GOF_BANDS.excellent),
  fair: GOOF_SINGLE_CRYSTAL_OK + (GOF_BANDS.fair - GOF_BANDS.excellent),
} as const;

/** A refinement has settled when its last cycle moved no parameter by more than this many esds. */
export const SHIFT_SETTLED = 0.1;

/** Fewer observations than this per free parameter thins the data's support (a warning below half of it). */
export const DATA_PER_PARAMETER = 10;

/** A fit-window cut that leaves out more than this fraction of the points is the user's call, not the Agent's (check_fit_range). */
export const LARGE_CUT = 0.15;

/**
 * Fewer of the structure's reflections than this inside a powder pattern's d
 * range: the axis is likely in another unit, or the wavelength wrong (axisReading.ts).
 */
export const AXIS_REFLECTIONS_MIN = 3;

/**
 * Observed over calculated line width within this of 1: the widths agree, so
 * with the Caglioti terms free a peak-shape misfit is a shape, not a width
 * (fitDiagnosis.ts).
 */
export const WIDTHS_AGREE = 0.1;

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
/** An extinction factor y below this (the correction takes more than a fifth of |F|²) is large. */
export const EXTINCTION_LARGE = 0.8;
/** Below this (more than half) it is severe: the extinction model carries the reflection, and test_extinction leaves such reflections out. */
export const EXTINCTION_SEVERE = 0.5;

/** Single crystal: R_int above this, or completeness below the next, is noted in the report. */
export const R_INT_NOTE = 0.1;
export const COMPLETENESS_NOTE = 0.95;

/** A Flack or Parsons u below this determines the absolute structure (Flack & Bernardinelli). */
export const FLACK_U_DETERMINED = 0.04;

/**
 * The cell check's Le Bail fit at or above this Rwp has not settled: its cell
 * is not read as the data's, and the peaks it leaves unindexed may be the
 * model's own lines with the start too far off for it to follow.
 */
export const LE_BAIL_UNSETTLED = 0.5;

/**
 * Forbidden reflections carrying intensity, all of the lattice centring's
 * class (h+k+l odd under I, and so on): from this many the cell check reads
 * them as a possible lost centring. One or two can be a stray line (an
 * impurity, λ/2) landing there.
 */
export const LOST_CENTRING_MIN = 3;

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

/**
 * The physical checks after every refinement (the user's rules, 2026-10-19).
 * Two atoms closer than DISTANCE_HARD (Å) cannot both be there: a hard
 * failure (the run is taken back and put to the user). Closer than
 * DISTANCE_WARN is unusual for any bond: a warning. Bonds to H and pairs that
 * are never present together (alternatives of one disorder, partly occupied
 * sites whose occupancies add to at most 1) are not checked.
 */
export const DISTANCE_HARD = 1.0;
export const DISTANCE_WARN = 1.5;

/** A cation–anion bond this much shorter than its bond-valence length (a fraction) is a warning. */
export const BOND_SHORT = 0.1;

/**
 * U_iso (Å²) of a fully occupied site, read at room temperature: above
 * U_LARGE a warning (it can be right: a rattling atom, a high temperature),
 * above U_HARD a hard failure put to the user; below U_SMALL a warning (a U
 * that small is a low-temperature value). A negative U is always a hard
 * failure (assessment.ts).
 */
export const U_LARGE = 0.05;
export const U_HARD = 0.1;
export const U_SMALL = 0.001;

/**
 * A heavier atom's U above a lighter one's by this factor, and by at least
 * U_ORDER_MIN Å², is a warning: heavier atoms usually vibrate less.
 */
export const U_ORDER_RATIO = 1.5;
export const U_ORDER_MIN = 0.005;

/**
 * A site at or above this occupancy counts as fully occupied (the physical
 * checks' distances: two partly occupied sites need never be present
 * together). The Validation view reads a held occupancy within the same 1 %
 * outside [0, 1] as an input to correct, a note rather than a fault of the
 * fit (powderAcceptance.ts).
 */
export const OCCUPANCY_FULL = 0.99;

