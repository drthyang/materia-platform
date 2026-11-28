/**
 * Powder profile synthesis: spread integrated peak intensities into a
 * continuous pattern using a peak-shape function plus a polynomial background.
 *
 * Peak shapes (minimal engine):
 *  - Gaussian
 *  - pseudo-Voigt (Gaussian/Lorentzian mix via η)
 *
 * Peak width follows the Caglioti form FWHM² = U·tan²θ + V·tanθ + W (Caglioti,
 * Paoletti & Ricci, *Nucl. Instrum.* 3 (1958) 223); the minimal engine exposes a
 * single width parameter and optional U,V,W.
 *
 * Units in this file: a shape function takes x, its centre and its FWHM in one
 * common unit, the pattern's (degrees 2θ, µs, Å or Å⁻¹), and returns a
 * density per that unit (unit area). The width functions `cagliotiFwhm` and
 * `lorentzianFwhm` take 2θ in degrees and return CENTIDEGREES of 2θ (GSAS-II's
 * unit for U, V, W, X, Y); the caller divides by 100. TOF widths are in µs.
 * Index of every equation: docs/EQUATIONS.md.
 */

import { evaluateBackground, type BackgroundType } from "@/core/diffraction/background";

const LN2 = Math.LN2;
const SQRT_LN2_OVER_PI = Math.sqrt(LN2 / Math.PI);

/**
 * Unit-area Gaussian, written with its FWHM:
 *   G(x) = (2/Γ)·√(ln2/π) · exp[−4 ln2 · (x − x₀)²/Γ²]
 * Symbols → code: x `x`; x₀ `center`; Γ `fwhm` (FWHM = 2√(2 ln2)·σ). All three
 * in the pattern's x unit; G is per that unit (∫G dx = 1).
 */
export function gaussian(x: number, center: number, fwhm: number): number {
  const sigmaFactor = (2 * SQRT_LN2_OVER_PI) / fwhm;
  const t = (x - center) / fwhm;
  return sigmaFactor * Math.exp(-4 * LN2 * t * t);
}

/**
 * Unit-area Lorentzian:
 *   L(x) = (Γ/2π) / [(x − x₀)² + (Γ/2)²]
 * Symbols → code: x `x`; x₀ `center`; Γ `fwhm` (FWHM), Γ/2 `hwhm`. Units as
 * {@link gaussian}.
 */
function lorentzian(x: number, center: number, fwhm: number): number {
  const hwhm = fwhm / 2;
  return (hwhm / Math.PI) / ((x - center) * (x - center) + hwhm * hwhm);
}

/**
 * Pseudo-Voigt: pV(x) = η·L(x) + (1−η)·G(x), η ∈ [0,1].
 * Symbols → code: η `eta` (clamped to [0, 1], the Lorentzian fraction); L and
 * G the unit-area {@link lorentzian} and {@link gaussian} of one common FWHM Γ
 * `fwhm`. Units as {@link gaussian}; unit area. Γ and η from a Gaussian and a
 * Lorentzian width: {@link tchPseudoVoigt}.
 */
export function pseudoVoigt(x: number, center: number, fwhm: number, eta: number): number {
  const e = Math.min(Math.max(eta, 0), 1);
  return e * lorentzian(x, center, fwhm) + (1 - e) * gaussian(x, center, fwhm);
}

export interface CagliotiParams {
  readonly u: number;
  readonly v: number;
  readonly w: number;
}

/**
 * Gaussian FWHM from the Caglioti coefficients:
 *   Γ_G² = U·tan²θ + V·tanθ + W
 * Symbols → code: θ is half of `twoThetaDeg`, the argument, which is 2θ in
 * DEGREES (the function converts to radians itself, `theta`); U, V, W `p.u`,
 * `p.v`, `p.w`.
 * Units: U, V, W in centidegrees² of 2θ, as this app holds them (FWHM², which
 * is 8 ln 2 times the variances a GSAS-II file gives: see
 * InstrumentParameters in instrument.ts). The result Γ_G is in CENTIDEGREES
 * of 2θ; the caller divides by 100 for degrees (workflow/powder.ts). Γ_G² is
 * floored at 10⁻⁶ centidegree².
 * Reference: Caglioti, Paoletti & Ricci, Nucl. Instrum. 3 (1958) 223.
 */
export function cagliotiFwhm(twoThetaDeg: number, p: CagliotiParams): number {
  const theta = (twoThetaDeg / 2) * (Math.PI / 180);
  const t = Math.tan(theta);
  const fwhm2 = p.u * t * t + p.v * t + p.w;
  return Math.sqrt(Math.max(fwhm2, 1e-6));
}

/** Lorentzian size–strain coefficients (GSAS-II convention). */
export interface LorentzianParams {
  /** Size (Scherrer) term, broadening ∝ 1/cosθ. */
  readonly x: number;
  /** Microstrain term, broadening ∝ tanθ. */
  readonly y: number;
}

/**
 * Lorentzian FWHM from GSAS-II's X, Y:
 *   Γ_L = X/cosθ + Y·tanθ        (floored at 0)
 * Symbols → code: X `p.x` (size term), Y `p.y` (microstrain term); θ is half
 * of `twoThetaDeg` (2θ in degrees).
 * Units: X, Y and the result in centidegrees of 2θ; the caller divides by 100
 * for degrees (workflow/powder.ts). X and Y convert to a crystallite size and
 * a microstrain in microstructure.ts (D = 18000·K·λ/(π·X), ε = π·Y/72000).
 * Reference: the Lorentzian width of the GSAS constant-wavelength profile
 * (Larson & Von Dreele, GSAS manual, LAUR 86-748), as GSAS-II uses it.
 */
export function lorentzianFwhm(twoThetaDeg: number, p: LorentzianParams): number {
  const theta = (twoThetaDeg / 2) * (Math.PI / 180);
  return Math.max(p.x / Math.cos(theta) + p.y * Math.tan(theta), 0);
}

/**
 * Thompson–Cox–Hastings pseudo-Voigt: combine a Gaussian FWHM Γ_G and a
 * Lorentzian FWHM Γ_L (same unit) into the total pseudo-Voigt FWHM Γ and the
 * mixing fraction η. This is the standard approximation to a true Voigt used by
 * GSAS-II / FullProf, and is what lets independent Gaussian (instrument) and
 * Lorentzian (sample size–strain) broadening coexist in one peak.
 *
 *   Γ⁵ = Γ_G⁵ + 2.69269 Γ_G⁴Γ_L + 2.42843 Γ_G³Γ_L² + 4.47163 Γ_G²Γ_L³
 *        + 0.07842 Γ_G Γ_L⁴ + Γ_L⁵
 *   η  = 1.36603 (Γ_L/Γ) − 0.47719 (Γ_L/Γ)² + 0.11116 (Γ_L/Γ)³
 *
 * Symbols → code: Γ_G `gammaG` (`g`, floored at 10⁻⁹); Γ_L `gammaL` (`l`,
 * floored at 0); Γ `fwhm`; η `eta` (clamped to [0, 1]).
 * Units: any one unit for the three widths (degrees 2θ on a CW pattern, µs
 * on TOF); η is dimensionless.
 * Reference: Thompson, Cox & Hastings, *J. Appl. Cryst.* 20 (1987) 79.
 */
export function tchPseudoVoigt(gammaG: number, gammaL: number): { fwhm: number; eta: number } {
  const g = Math.max(gammaG, 1e-9);
  const l = Math.max(gammaL, 0);
  const g2 = g * g, g3 = g2 * g, g4 = g3 * g, g5 = g4 * g;
  const l2 = l * l, l3 = l2 * l, l4 = l3 * l, l5 = l4 * l;
  const fwhm = Math.pow(
    g5 + 2.69269 * g4 * l + 2.42843 * g3 * l2 + 4.47163 * g2 * l3 + 0.07842 * g * l4 + l5,
    0.2,
  );
  const r = l / fwhm;
  const eta = Math.min(Math.max(1.36603 * r - 0.47719 * r * r + 0.11116 * r * r * r, 0), 1);
  return { fwhm, eta };
}

export interface ProfilePeak {
  readonly center: number;
  readonly intensity: number;
  /** Symmetric width used for the Gaussian/pseudo-Voigt shapes and, for a TOF
   *  peak, as the support half-width proxy for the far-peak skip. */
  readonly fwhm: number;
  /** Per-peak pseudo-Voigt mixing (from TCH); falls back to the global η. */
  readonly eta?: number;
  /** Back-to-back-exponential TOF shape; present only for `shape: "tof"`. */
  readonly tof?: TofShape;
  /** A Kα₂ component: drawn into the pattern, not the reflection's position. */
  readonly secondLine?: boolean;
}

/**
 * Finger–Cox–Jephcoat axial-divergence asymmetry (S/L, H/L), the sample and
 * detector-slit half-heights over the diffractometer radius. Both are refinable;
 * S is often treated as adjustable to absorb divergent optics (Finger et al.,
 * 1994).
 */
export interface AxialDivergence {
  readonly sl: number;
  readonly hl: number;
}

/** Gauss–Legendre nodes/weights on [-1, 1], cached by point count. */
const glCache = new Map<number, { nodes: number[]; weights: number[] }>();
function gaussLegendre(n: number): { nodes: number[]; weights: number[] } {
  const cached = glCache.get(n);
  if (cached) return cached;
  const nodes = new Array<number>(n).fill(0);
  const weights = new Array<number>(n).fill(0);
  const m = (n + 1) >> 1;
  for (let i = 0; i < m; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)); // initial root guess
    let dp = 0;
    for (let iter = 0; iter < 100; iter++) {
      let p1 = 1, p2 = 0;
      for (let j = 0; j < n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j + 1) * x * p2 - j * p3) / (j + 1);
      }
      dp = (n * (x * p1 - p2)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    nodes[i] = -x;
    nodes[n - 1 - i] = x;
    const w = 2 / ((1 - x * x) * dp * dp);
    weights[i] = w;
    weights[n - 1 - i] = w;
  }
  const result = { nodes, weights };
  glCache.set(n, result);
  return result;
}

/**
 * Expand a Bragg peak at `center2Theta` (degrees) into Finger–Cox–Jephcoat
 * sub-peaks that reproduce axial-divergence asymmetry — a long low-angle tail for
 * 2θ < 90° (Finger, Cox & Jephcoat, J. Appl. Cryst. 27, 892, 1994). Each returned
 * sub-peak is the symmetric profile shifted to a quadrature node between 2θ_min
 * and 2θ, weighted by W/(h·cos2φ); weights are normalized to sum to 1 (intensity
 * preserved). Returns a single unit-weight peak when the asymmetry is negligible
 * or 2θ ≥ 90° (not modelled; irrelevant for the low-angle regime this targets).
 */
export function fcjSubPeaks(
  center2Theta: number,
  axial: AxialDivergence,
  nQuad = 16,
): { center: number; weight: number }[] {
  const single = [{ center: center2Theta, weight: 1 }];
  const { sl, hl } = axial;
  const sum = sl + hl;
  if (sum <= 1e-7 || center2Theta <= 0 || center2Theta >= 90) return single;

  const rad = Math.PI / 180;
  const cos2T = Math.cos(center2Theta * rad);
  const dif = Math.abs(hl - sl);
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  // Eq (4)/(5): the ramp foot (2θ_min) and the inflection (2θ_infl), in degrees.
  const twoThetaMin = Math.acos(clamp(cos2T * Math.sqrt(sum * sum + 1))) / rad;
  const twoThetaInfl = Math.acos(clamp(cos2T * Math.sqrt(dif * dif + 1))) / rad;
  if (!(twoThetaMin < center2Theta - 1e-9)) return single;

  const { nodes, weights } = gaussLegendre(nQuad);
  const mid = 0.5 * (center2Theta + twoThetaMin);
  const half = 0.5 * (center2Theta - twoThetaMin);
  const minSH = Math.min(sl, hl);
  const cos2T2 = cos2T * cos2T;
  const subs: { center: number; weight: number }[] = [];
  let norm = 0;
  for (let k = 0; k < nQuad; k++) {
    const phi = mid + half * nodes[k]!; // 2φ node (degrees)
    const cphi = Math.cos(phi * rad);
    const hL2 = (cphi * cphi) / cos2T2 - 1; // (h/L)² from eq (1)
    if (hL2 <= 1e-12) continue; // at/above the singularity 2φ = 2θ
    const hL = Math.sqrt(hL2);
    const w = phi < twoThetaInfl ? sum - hL : 2 * minSH; // eq (7a)/(7b)
    if (w <= 0) continue;
    const g = (weights[k]! * w) / (hL * cphi); // eq (6) weight, L/2H cancels in norm
    subs.push({ center: phi, weight: g });
    norm += g;
  }
  if (norm <= 0 || subs.length === 0) return single;
  for (const s of subs) s.weight /= norm;
  return subs;
}

// --- Error functions (Numerical Recipes 6.2 rational form, |err| ≲ 1.2e-7) ---
// The polynomial in t = 1/(1+|x|/2) shared by erfc and its scaled variant.
function erfcPoly(t: number): number {
  return t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
}

/** Complementary error function erfc(x) = 1 − erf(x), valid for all real x. */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans = t * Math.exp(-z * z - 1.26551223 + erfcPoly(t));
  return x >= 0 ? ans : 2 - ans;
}

/**
 * Scaled complementary error function erfcx(x) = exp(x²)·erfc(x) for x ≥ 0.
 * Computed without forming exp(x²) so no catastrophic cancellation in the tail
 * (the exp(−x²) inside erfc cancels the exp(x²) analytically).
 */
export function erfcxNonneg(x: number): number {
  const t = 1 / (1 + 0.5 * x);
  return t * Math.exp(-1.26551223 + erfcPoly(t));
}

/** Time-of-flight peak-shape parameters at one reflection (all in µs / µs⁻¹). */
export interface TofShape {
  /** Rising-edge exponential rate α (µs⁻¹). */
  readonly alpha: number;
  /** Falling-edge exponential rate β (µs⁻¹). */
  readonly beta: number;
  /** Gaussian standard deviation σ (µs). */
  readonly sigma: number;
  /** Lorentzian FWHM γ (µs). Absent or ≤ 0: no Lorentzian part, the Gaussian closed form alone. */
  readonly gamma?: number;
  /** Whose function evaluates the Lorentzian part: the program the instrument file belongs to. Default "gsas". */
  readonly lorentzForm?: TofLorentzForm;
}

/**
 * The program whose definition of the peak is used when a Lorentzian width is
 * present. Both build the peak the same way (see {@link tofBackToBack}); their
 * manuals print the argument p of the Lorentzian part's first term differently,
 * and an instrument file is evaluated with its own program's function:
 *
 *  - "gsas": the GSAS manual (Larson & Von Dreele, LAUR 86-748), TOF profile
 *    function 3, with p and q "defined as in the second function":
 *    p = −αΔ + iαΓ/2, q = −βΔ + iβΓ/2. GSAS-II's TOF function is this one.
 *  - "fullprof": FullProf's NPROF 9: p = αΔ + iαΓ/2, q = −βΔ + iβΓ/2.
 */
export type TofLorentzForm = "gsas" | "fullprof";

const EULER_GAMMA = 0.5772156649015329;

/**
 * Im[eᶻ E₁(z)] for z = x + iy with y > 0, where E₁ is the exponential integral
 * (Abramowitz & Stegun 5.1.1). In double precision throughout, by three
 * expansions, each used where it loses no digits:
 *
 *  - the power series E₁(z) = −γ − ln z − Σ (−z)ᵏ/(k·k!) (A&S 5.1.11) where its
 *    terms do not cancel: |z| + x ≤ 4 on the right half-plane, ≤ 6 on the left
 *    (there the terms grow like e^|z| and the result like e^−x, so |z| + x
 *    measures the digits lost);
 *  - the asymptotic series eᶻE₁(z) ~ Σ (−1)ᵏ k!/zᵏ⁺¹ (A&S 5.1.51) for |z| > 50,
 *    cut at its smallest term, which is below 10⁻²⁰ there;
 *  - the continued fraction 1/(z+1 − 1/(z+3 − 4/(z+5 − …))) (A&S 5.1.22, in
 *    its even form) everywhere else, by the modified Lentz method.
 */
export function imExpE1(x: number, y: number): number {
  const r2 = x * x + y * y;
  const r = Math.sqrt(r2);
  if (r > 50) {
    // (1/z)·Σ (−1)ᵏ k!/zᵏ: term_k = term_{k−1}·(−k/z).
    const ir = x / r2, ii = -y / r2; // 1/z
    let tr = ir, ti = ii;
    let si = ti;
    let last = Math.abs(tr) + Math.abs(ti);
    for (let k = 1; k < 60; k++) {
      const nr = -k * (tr * ir - ti * ii);
      const ni = -k * (tr * ii + ti * ir);
      const mag = Math.abs(nr) + Math.abs(ni);
      if (mag >= last) break;
      tr = nr; ti = ni; last = mag;
      si += ti;
      if (mag < 1e-18 * (Math.abs(ir) + Math.abs(ii))) break;
    }
    return si;
  }
  if (r + x <= (x >= 0 ? 4 : 6)) {
    let tr = 1, ti = 0; // (−z)ᵏ/k!
    let sr = 0, si = 0;
    for (let k = 1; k < 600; k++) {
      const nr = (tr * -x - ti * -y) / k;
      const ni = (tr * -y + ti * -x) / k;
      tr = nr; ti = ni;
      sr += tr / k; si += ti / k;
      if (k > r && Math.abs(tr) + Math.abs(ti) < 1e-17 * k * (Math.abs(sr) + Math.abs(si))) break;
    }
    const er = -EULER_GAMMA - 0.5 * Math.log(r2) - sr;
    const ei = -Math.atan2(y, x) - si;
    return Math.exp(x) * (er * Math.sin(y) + ei * Math.cos(y));
  }
  // Modified Lentz (Numerical Recipes §6.3, complex argument).
  let br = x + 1;
  const bi = y;
  let cr = 1e300, ci = 0;
  let den = br * br + bi * bi;
  let dr = br / den, di = -bi / den;
  let hr = dr, hi = di;
  for (let i = 1; i < 2000; i++) {
    const a = -i * i;
    br += 2;
    const er = a * dr + br, ei = a * di + bi;
    den = er * er + ei * ei;
    dr = er / den; di = -ei / den;
    const cden = cr * cr + ci * ci;
    const ncr = br + (a * cr) / cden, nci = bi - (a * ci) / cden;
    cr = ncr; ci = nci;
    const delr = cr * dr - ci * di, deli = cr * di + ci * dr;
    const nhr = hr * delr - hi * deli;
    hi = hr * deli + hi * delr;
    hr = nhr;
    if (Math.abs(delr - 1) + Math.abs(deli) < 1e-16) break;
  }
  return hi;
}

/**
 * Back-to-back exponentials convolved with a Gaussian — the standard GSAS/
 * Von Dreele TOF peak shape (Jorgensen et al.; Von Dreele, Jorgensen & Windsor,
 * J. Appl. Cryst. 15, 581, 1982). A sharp rising edge (rate α) and a longer
 * falling tail (rate β) give the characteristic TOF asymmetry; the Gaussian σ
 * folds in the moderator/detector resolution. Normalized to unit area, so a
 * peak's integrated intensity multiplies it directly.
 *
 *   H(Δ) = αβ/[2(α+β)] · [ e^u erfc(y) + e^v erfc(z) ]
 *   u = α/2(ασ²+2Δ), y = (ασ²+Δ)/(σ√2);  v = β/2(βσ²−2Δ), z = (βσ²−Δ)/(σ√2)
 *
 * Evaluated in the erfcx form when the erfc argument is ≥ 0 (where e^u would
 * overflow) and directly otherwise (where e^u < 1), so it is stable across the
 * whole profile.
 *
 * With a Lorentzian width γ > 0 the exponentials are convolved with a
 * pseudo-Voigt instead, as GSAS (TOF profile function 3), GSAS-II and FullProf
 * (NPROF 9) do: the total FWHM Γ and the mixing η come from the Gaussian FWHM
 * 2√(2 ln 2)·σ and γ by Thompson, Cox & Hastings (1987), and
 *
 *   H(Δ) = (1−η)·N[e^u erfc(y) + e^v erfc(z)]  −  (2Nη/π)·{Im[e^p E₁(p)] + Im[e^q E₁(q)]}
 *
 * with u, v, y, z as above at σ = Γ/2√(2 ln 2), N = αβ/2(α+β), and p, q as
 * the file's program defines them ({@link TofLorentzForm}). Unit area. With
 * γ absent or ≤ 0 this is the Gaussian form above, unchanged.
 *
 * Symbols → code: Δ `delta` = t − t_hkl (µs), the time from the peak's
 * centre; α `shape.alpha`, β `shape.beta` (µs⁻¹; floored at 10⁻⁹); σ
 * `shape.sigma` (µs; floored at 10⁻⁶), σ² `s2`; γ `shape.gamma` (µs, FWHM);
 * N `norm` (µs⁻¹); y, z `y`, `z` (dimensionless); Γ `fwhm`, η `eta` in
 * `tofBackToBackPseudoVoigt`. H is in µs⁻¹ (∫H dΔ = 1).
 * References: Von Dreele, Jorgensen & Windsor, J. Appl. Cryst. 15 (1982) 581;
 * Larson & Von Dreele, GSAS manual (LAUR 86-748), TOF profile functions;
 * Thompson, Cox & Hastings, J. Appl. Cryst. 20 (1987) 79; the FullProf manual
 * (NPROF 9). α(d), β(d), σ²(d), γ(d) are formed in workflow/powder.ts
 * (`tofWidthsAt`, `buildTofPeaks`): see docs/EQUATIONS.md.
 */
export function tofBackToBack(delta: number, shape: TofShape): number {
  if (shape.gamma !== undefined && shape.gamma > 0) return tofBackToBackPseudoVoigt(delta, shape, shape.gamma);
  const alpha = Math.max(shape.alpha, 1e-9);
  const beta = Math.max(shape.beta, 1e-9);
  const sigma = Math.max(shape.sigma, 1e-6);
  const s2 = sigma * sigma;
  const norm = (alpha * beta) / (2 * (alpha + beta));
  const gauss = Math.exp(-(delta * delta) / (2 * s2));
  const inv = 1 / (sigma * Math.SQRT2);
  const y = (alpha * s2 + delta) * inv;
  const z = (beta * s2 - delta) * inv;
  // e^u erfc(y) = e^{−Δ²/2σ²} erfcx(y) for y ≥ 0; e^u erfc(y) directly for y < 0.
  const termA = y >= 0 ? gauss * erfcxNonneg(y) : Math.exp(0.5 * alpha * (alpha * s2 + 2 * delta)) * erfc(y);
  const termB = z >= 0 ? gauss * erfcxNonneg(z) : Math.exp(0.5 * beta * (beta * s2 - 2 * delta)) * erfc(z);
  return norm * (termA + termB);
}

/** 2√(2 ln 2): Gaussian FWHM over its standard deviation. */
const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * LN2);

/**
 * The pseudo-Voigt branch of {@link tofBackToBack} (its second formula):
 * Γ and η from 2√(2 ln 2)·σ and γ by {@link tchPseudoVoigt}; the Gaussian part
 * is the closed form at σ = Γ/2√(2 ln 2), the Lorentzian part
 * −(2N/π)·{Im[e^p E₁(p)] + Im[e^q E₁(q)]} with p = ∓αΔ + iαΓ/2 (`riseArgument`:
 * − for "gsas", + for "fullprof") and q = −βΔ + iβΓ/2. Units as tofBackToBack.
 */
function tofBackToBackPseudoVoigt(delta: number, shape: TofShape, gamma: number): number {
  const alpha = Math.max(shape.alpha, 1e-9);
  const beta = Math.max(shape.beta, 1e-9);
  const { fwhm, eta } = tchPseudoVoigt(FWHM_PER_SIGMA * Math.max(shape.sigma, 1e-6), gamma);
  const gaussianPart = tofBackToBack(delta, { alpha, beta, sigma: fwhm / FWHM_PER_SIGMA });
  if (eta <= 0) return gaussianPart;
  const norm = (alpha * beta) / (2 * (alpha + beta));
  const riseArgument = shape.lorentzForm === "fullprof" ? alpha * delta : -alpha * delta;
  const lorentzianPart = ((-2 * norm) / Math.PI) * (imExpE1(riseArgument, (alpha * fwhm) / 2) + imExpE1(-beta * delta, (beta * fwhm) / 2));
  return (1 - eta) * gaussianPart + eta * lorentzianPart;
}

/**
 * How far from its centre a TOF peak with a Lorentzian part is drawn, in µs.
 * A Lorentzian of FWHM Γ has the fraction Γ/(πX) of its area beyond ±X, so the
 * range is the larger of the Gaussian rule (±20 support widths) and the X that
 * leaves less than {@link TOF_LORENTZ_TAIL_FRACTION} of the peak's area outside.
 */
export const TOF_LORENTZ_TAIL_FRACTION = 2e-4;
export function tofLorentzSupport(sigma: number, gamma: number): number {
  const { fwhm, eta } = tchPseudoVoigt(FWHM_PER_SIGMA * sigma, gamma);
  return (eta * fwhm) / (Math.PI * TOF_LORENTZ_TAIL_FRACTION);
}

export type PeakShape = "gaussian" | "pseudoVoigt" | "tof";

export interface ProfileOptions {
  readonly shape: PeakShape;
  /** Mixing parameter for pseudo-Voigt; ignored for Gaussian. */
  readonly eta?: number;
  /** Background coefficients (c0 first). Interpreted per `backgroundType`. */
  readonly background?: readonly number[];
  /** Background model; defaults to Chebyshev (well-conditioned for wide x). */
  readonly backgroundType?: BackgroundType;
}

/** Half-width of a peak's finite support, in units of its FWHM. */
export const PEAK_WINDOW_FWHM = 20;

/** Outer fraction of the support over which a peak fades to zero. */
const SUPPORT_TAPER_FRACTION = 0.2;

/**
 * Weight that fades a peak to zero at the edge of its finite support ±`half`:
 * 1 out to 80 % of `half`, then a quintic smootherstep down to exactly 0 at
 * `half`, so value, slope and curvature are all continuous.
 *
 * A hard cutoff made the pattern discontinuous in every parameter that moves
 * the edge — each width (the window scales with Γ) and each peak position. When
 * a data point crossed the edge, y jumped by the Lorentzian tail there (up to
 * 6·10⁻⁴ of the peak height at 20 Γ), and a central difference divided that jump by
 * 2h, so the column spiked ∝ 1/h at one point. The weight depends only on
 * dist/half, so it moves smoothly with Γ and the centre. It removes 0.18 % of a
 * Lorentzian's area (between 16 and 20 Γ; the 1.6 % beyond 20 Γ was never
 * modelled); Gaussian and TOF shapes are already negligible there.
 */
export function supportTaper(dist: number, half: number): number {
  const flat = (1 - SUPPORT_TAPER_FRACTION) * half;
  if (dist <= flat) return 1;
  if (dist >= half) return 0;
  const t = (dist - flat) / (half - flat);
  return 1 - t * t * t * (10 + t * (6 * t - 15));
}

/**
 * The unit profiles of TOF peaks with a Lorentzian width, kept per abscissa
 * grid. Such a peak costs about ten times the Gaussian form per point and is
 * drawn over most of the pattern (tofLorentzSupport), while a refinement that
 * holds the instrument's profile asks for the same peaks, with other
 * intensities, hundreds of times. A peak's values on the grid depend only on
 * its centre, its support and its shape, so they are computed once and reused
 * while those are the same numbers; the sum is formed in the same order with
 * the same factors, so a pattern from the cache is bit for bit the pattern
 * without it.
 */
interface UnitProfile {
  readonly start: number;
  readonly shape: Float64Array;
  readonly taper: Float64Array;
}
interface UnitProfileCache {
  readonly entries: Map<string, UnitProfile>;
  values: number;
}
const unitProfileCaches = new WeakMap<readonly number[], UnitProfileCache>();
/** The most numbers one grid's cache holds (two arrays per peak): 96 MB. Past it the cache starts again. */
const UNIT_PROFILE_CACHE_VALUES = 12_000_000;

function unitProfileKey(peak: ProfilePeak, tof: TofShape): string {
  return `${peak.center}|${peak.fwhm}|${tof.alpha}|${tof.beta}|${tof.sigma}|${tof.gamma}|${tof.lorentzForm ?? ""}`;
}

function shapeAt(x: number, peak: ProfilePeak, opts: ProfileOptions): number {
  if (opts.shape === "tof" && peak.tof) {
    return tofBackToBack(x - peak.center, peak.tof);
  }
  if (opts.shape === "gaussian" || opts.shape === "tof") {
    return gaussian(x, peak.center, peak.fwhm);
  }
  // A per-peak η (from the TCH combination of Gaussian + Lorentzian widths) wins
  // over the global η; the global value is the single-width fallback.
  return pseudoVoigt(x, peak.center, peak.fwhm, peak.eta ?? opts.eta ?? 0.5);
}

/**
 * Evaluate the full calculated pattern y(x) over an abscissa grid: the sum of
 * profile-spread peaks plus the polynomial background.
 */
export function synthesizePattern(
  xValues: readonly number[],
  peaks: readonly ProfilePeak[],
  opts: ProfileOptions,
): Float64Array {
  const y = new Float64Array(xValues.length);
  // THE BACKGROUND DOMAIN. x_min and x_max of every background basis (the
  // Chebyshev t ∈ [−1, 1], the cosine s ∈ [0, 1], the interpolation points) are
  // the smallest and largest value of `xValues`, the abscissa array passed to
  // this call, found here. The workflows pass every point of the pattern
  // (`pattern.points`), inside the fit range or not. The domain is not stored
  // with the coefficients: the same coefficients on another x array are another
  // curve. See background.ts.
  // Chebyshev normalization needs the abscissa span; compute it once.
  const bgType = opts.backgroundType ?? "chebyshev";
  let xMin = Infinity;
  let xMax = -Infinity;
  if (opts.background && opts.background.length > 0) {
    for (const x of xValues) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
  }
  for (let i = 0; i < xValues.length; i++) {
    y[i] = evaluateBackground(xValues[i]!, opts.background, bgType, xMin, xMax);
  }

  // Each peak contributes only within ±20 FWHM of its center, faded to zero at
  // the edge (supportTaper). On a monotonic grid (every real diffractogram)
  // that support window is found by binary search, making the cost Σ(window
  // widths) instead of points × peaks — the point-major loop with a per-pair
  // distance test was >90% of every refinement evaluation on synchrotron-scale
  // data (20k points × 5k peaks).
  const n = xValues.length;
  const ascending = n < 2 || xValues[0]! <= xValues[n - 1]!;
  let monotonic = true;
  for (let i = 1; i < n; i++) {
    if (ascending ? xValues[i]! < xValues[i - 1]! : xValues[i]! > xValues[i - 1]!) {
      monotonic = false;
      break;
    }
  }

  if (monotonic) {
    // First index whose x is inside the window approaching from the low side.
    const lowerBound = (v: number): number => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ascending ? xValues[mid]! < v : xValues[mid]! > v) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    let cache: UnitProfileCache | undefined;
    for (const peak of peaks) {
      const half = PEAK_WINDOW_FWHM * peak.fwhm;
      const start = lowerBound(ascending ? peak.center - half : peak.center + half);
      const tof = opts.shape === "tof" ? peak.tof : undefined;
      if (tof && tof.gamma !== undefined && tof.gamma > 0) {
        // A Lorentzian TOF peak: its unit profile from the cache, or computed into it (see UnitProfile).
        if (!cache) {
          cache = unitProfileCaches.get(xValues);
          if (!cache) unitProfileCaches.set(xValues, (cache = { entries: new Map(), values: 0 }));
        }
        const key = unitProfileKey(peak, tof);
        let unit = cache.entries.get(key);
        if (!unit) {
          let end = start;
          while (end < n && !(ascending ? xValues[end]! > peak.center + half : xValues[end]! < peak.center - half)) end++;
          const shape = new Float64Array(end - start);
          const taper = new Float64Array(end - start);
          for (let i = start; i < end; i++) {
            const x = xValues[i]!;
            shape[i - start] = shapeAt(x, peak, opts);
            taper[i - start] = supportTaper(Math.abs(x - peak.center), half);
          }
          unit = { start, shape, taper };
          if (cache.values + 2 * shape.length > UNIT_PROFILE_CACHE_VALUES) {
            cache.entries.clear();
            cache.values = 0;
          }
          if (2 * shape.length <= UNIT_PROFILE_CACHE_VALUES) {
            cache.entries.set(key, unit);
            cache.values += 2 * shape.length;
          }
        }
        const { shape, taper } = unit;
        for (let j = 0; j < shape.length; j++) {
          const i = unit.start + j;
          y[i] = y[i]! + peak.intensity * shape[j]! * taper[j]!;
        }
        continue;
      }
      for (let i = start; i < n; i++) {
        const x = xValues[i]!;
        if (ascending ? x > peak.center + half : x < peak.center - half) break;
        y[i] = y[i]! + peak.intensity * shapeAt(x, peak, opts) * supportTaper(Math.abs(x - peak.center), half);
      }
    }
  } else {
    // Non-monotonic grid: fall back to the point-major loop (the parsers never
    // produce one, but synthetic callers might).
    for (let i = 0; i < n; i++) {
      const x = xValues[i]!;
      let sum = 0;
      for (const peak of peaks) {
        const half = PEAK_WINDOW_FWHM * peak.fwhm;
        const dist = Math.abs(x - peak.center);
        if (dist > half) continue;
        sum += peak.intensity * shapeAt(x, peak, opts) * supportTaper(dist, half);
      }
      y[i] = y[i]! + sum;
    }
  }
  return y;
}
