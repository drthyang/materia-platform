/**
 * An independent constant-wavelength neutron powder pattern of a magnetic
 * MnWO₄, for known-truth tests of the moments fit.
 *
 * NOTHING here comes from `src/core` (no import at all): the metric, the
 * structure factors, the magnetic form factor, the projection perpendicular to
 * Q, the powder sum and the noise are written out again, the simplest way that
 * can be checked by hand. A test that fits these patterns with the app's code
 * compares the app with this calculation, not with itself.
 *
 * The crystal is the magnetic cell treated as one P1 crystal: `na` parent
 * cells along a, every atom and every spin explicit. No symmetry, no
 * propagation vector, no multiplicity: every integer (H, K, L) of that cell is
 * one reflection of the sum
 *
 *   y(2θ) = background + K · Σ_HKL L(θ) · (|F_N|² + |F_M⊥|²) · G(2θ − 2θ_HKL)
 *
 * with L = 1 / (sin²θ cosθ) and G a unit-area Gaussian in degrees.
 *
 * Numbers typed in from their sources:
 *  - Structure: J. Macavei and H. Schulz, Z. Kristallogr. 207, 193 (1993),
 *    ambient pressure: P2/c, a = 4.830, b = 5.7603, c = 4.994 Å, β = 91.14°.
 *  - Bound coherent scattering lengths (fm): V. F. Sears, Neutron News 3(3),
 *    26 (1992): Mn −3.73, W 4.86, O 5.803.
 *  - Mn²⁺ ⟨j0⟩: International Tables for Crystallography Vol. C, Table 4.4.5.1.
 *  - γ r₀ / 2 from the neutron's magnetic moment in nuclear magnetons
 *    (γ = 1.91304273) and the classical electron radius (r₀ = 2.8179403 fm):
 *    2.69542 fm per µ_B. (The app, GSAS-II and FullProf round it to 2.695: a
 *    moment refined by the app from these patterns reads 1.5e-4 high,
 *    0.0007 µ_B at 4.2 µ_B.)
 *
 * The magnetic order is a synthetic test case (k = (½, 0, 0): the spins
 * alternate from one parent cell to the next along a). It is not the
 * magnetic structure of real MnWO₄.
 */

export type V3 = readonly [number, number, number];

/** Parent cell (Å, degrees), monoclinic, unique axis b. */
export const CELL = { a: 4.83, b: 5.7603, c: 4.994, beta: 91.14 } as const;

const B_COH = { Mn: -3.73, W: 4.86, O: 5.803 } as const;
const J0_MN2 = { A: 0.422, a: 17.684, B: 0.5948, b: 6.005, C: 0.0043, c: -0.609, D: -0.0219 } as const;
/** γ r₀ / 2 in fm per µ_B. */
export const GAMMA_R0_HALF = (1.91304273 * 2.8179403) / 2;

interface Atom {
  readonly element: keyof typeof B_COH;
  /** Fractional position in the parent cell. */
  readonly r: V3;
  readonly uIso: number;
}

/** P2/c general positions: x,y,z; −x,y,½−z; −x,−y,−z; x,−y,½+z. */
function orbit(element: Atom["element"], [x, y, z]: V3, uIso: number, special: boolean): Atom[] {
  const all: V3[] = [[x, y, z], [-x, y, 0.5 - z], [-x, -y, -z], [x, -y, 0.5 + z]];
  // A site on the 2-fold axis (2e, 2f) is its own image under −x,y,½−z: keep x,y,z and its inverse.
  const kept = special ? [all[0]!, all[2]!] : all;
  return kept.map((r) => ({ element, r: [mod1(r[0]), mod1(r[1]), mod1(r[2])] as V3, uIso }));
}

function mod1(v: number): number {
  const m = v - Math.floor(v);
  return m === 1 ? 0 : m;
}

/** The 12 atoms of the parent cell. The first two are Mn(y) at (½, 0.6856, ¼) and Mn(−y) at (½, 0.3144, ¾). */
export const PARENT_ATOMS: readonly Atom[] = [
  ...orbit("Mn", [0.5, 0.6856, 0.25], 0.0108, true),
  ...orbit("W", [0, 0.18, 0.25], 0.006, true),
  ...orbit("O", [0.211, 0.102, 0.943], 0.01, false),
  ...orbit("O", [0.25, 0.374, 0.393], 0.011, false),
];

/** A moment model: the moment (µ_B) of Mn(y) and of Mn(−y) in parent cell 0, along the unit vectors â, b̂, ĉ. */
export interface SpinModel {
  /** Parent cells along a in the magnetic cell: 2 for k = (½,0,0), 1 for k = 0. */
  readonly na: 1 | 2;
  readonly mnY: V3;
  readonly mnMinusY: V3;
}

const RAD = Math.PI / 180;

/** Cartesian axes: x along a, y along b, z completing (c in the xz plane). */
function cartesianOfAxes(): { a: V3; b: V3; c: V3 } {
  const cb = Math.cos(CELL.beta * RAD);
  const sb = Math.sin(CELL.beta * RAD);
  return { a: [CELL.a, 0, 0], b: [0, CELL.b, 0], c: [CELL.c * cb, 0, CELL.c * sb] };
}

/** Reciprocal vectors of the magnetic cell (na·a, b, c), Cartesian, Å⁻¹ (no 2π). */
function reciprocal(na: number): { as: V3; bs: V3; cs: V3 } {
  const cb = Math.cos(CELL.beta * RAD);
  const sb = Math.sin(CELL.beta * RAD);
  const A = na * CELL.a;
  // a* ⟂ b, c; b* ⟂ a, c; c* ⟂ a, b, with a·a* = b·b* = c·c* = 1.
  return { as: [1 / A, 0, -cb / (A * sb)], bs: [0, 1 / CELL.b, 0], cs: [0, 0, 1 / (CELL.c * sb)] };
}

/** A moment given along â, b̂, ĉ, in Cartesian µ_B. */
export function momentCartesianOf(m: V3): V3 {
  const ax = cartesianOfAxes();
  const unit = (v: V3, len: number): V3 => [v[0] / len, v[1] / len, v[2] / len];
  const a = unit(ax.a, CELL.a);
  const b = unit(ax.b, CELL.b);
  const c = unit(ax.c, CELL.c);
  return [m[0] * a[0] + m[1] * b[0] + m[2] * c[0], m[0] * a[1] + m[1] * b[1] + m[2] * c[1], m[0] * a[2] + m[1] * b[2] + m[2] * c[2]];
}

export function momentSize(m: V3): number {
  return Math.hypot(...momentCartesianOf(m));
}

/** ⟨j0⟩ of Mn²⁺ at s = sinθ/λ = 1/(2d) (Å⁻¹). */
export function j0Mn2(s: number): number {
  const s2 = s * s;
  return J0_MN2.A * Math.exp(-J0_MN2.a * s2) + J0_MN2.B * Math.exp(-J0_MN2.b * s2) + J0_MN2.C * Math.exp(-J0_MN2.c * s2) + J0_MN2.D;
}

export interface Reflection {
  readonly H: number;
  readonly K: number;
  readonly L: number;
  readonly d: number;
  /** |F_N|² of the magnetic cell, fm². */
  readonly nuclear: number;
  /** |F_M⊥|² of the magnetic cell, fm². */
  readonly magnetic: number;
}

/** One reflection (H, K, L) of the magnetic cell: d, |F_N|² and |F_M⊥|², by the explicit sum over every atom. */
export function reflection(model: SpinModel, H: number, K: number, L: number): Reflection {
  const { as, bs, cs } = reciprocal(model.na);
  const q: V3 = [H * as[0] + K * bs[0] + L * cs[0], H * as[1] + K * bs[1] + L * cs[1], H * as[2] + K * bs[2] + L * cs[2]];
  const qLen = Math.hypot(...q);
  const d = 1 / qLen;
  const s2 = qLen * qLen / 4;
  let nRe = 0;
  let nIm = 0;
  const mRe = [0, 0, 0];
  const mIm = [0, 0, 0];
  const spins = [momentCartesianOf(model.mnY), momentCartesianOf(model.mnMinusY)];
  const f = GAMMA_R0_HALF * j0Mn2(qLen / 2);
  for (let n = 0; n < model.na; n++) {
    // k = (½,0,0): the spin of parent cell n is (−1)ⁿ that of cell 0.
    const sign = n % 2 === 0 ? 1 : -1;
    PARENT_ATOMS.forEach((atom, j) => {
      const x = (atom.r[0] + n) / model.na;
      const phase = 2 * Math.PI * (H * x + K * atom.r[1] + L * atom.r[2]);
      const dw = Math.exp(-8 * Math.PI * Math.PI * atom.uIso * s2);
      const c = Math.cos(phase);
      const sn = Math.sin(phase);
      nRe += B_COH[atom.element] * dw * c;
      nIm += B_COH[atom.element] * dw * sn;
      if (j < 2) {
        const m = spins[j]!;
        for (let i = 0; i < 3; i++) {
          mRe[i] = mRe[i]! + sign * f * dw * m[i]! * c;
          mIm[i] = mIm[i]! + sign * f * dw * m[i]! * sn;
        }
      }
    });
  }
  const qHat: V3 = [q[0] / qLen, q[1] / qLen, q[2] / qLen];
  const perp2 = (v: readonly number[]): number => {
    const along = v[0]! * qHat[0] + v[1]! * qHat[1] + v[2]! * qHat[2];
    return v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]! - along * along;
  };
  return { H, K, L, d, nuclear: nRe * nRe + nIm * nIm, magnetic: perp2(mRe) + perp2(mIm) };
}

export interface PatternSpec {
  readonly model: SpinModel;
  readonly wavelength: number;
  /** Scale K on the magnetic cell. */
  readonly scale: number;
  readonly background: number;
  /** Gaussian FWHM, degrees 2θ. */
  readonly fwhm: number;
  readonly twoThetaMin: number;
  readonly twoThetaMax: number;
  readonly step: number;
  /** Reflections are carried to this 2θ, beyond the last point, so the pattern's edge has its tails. */
  readonly reflectionsTo: number;
}

export interface CleanPattern {
  readonly x: readonly number[];
  readonly y: readonly number[];
  /** The magnetic part alone (no background), for reading how strong the satellites are. */
  readonly magnetic: readonly number[];
  readonly nuclear: readonly number[];
}

/** The noise-free pattern: every (H, K, L) of the magnetic cell with 2θ ≤ reflectionsTo, one Gaussian each. */
export function cleanPattern(spec: PatternSpec): CleanPattern {
  const n = Math.round((spec.twoThetaMax - spec.twoThetaMin) / spec.step) + 1;
  const x = Array.from({ length: n }, (_, i) => spec.twoThetaMin + i * spec.step);
  const nuclear = new Array<number>(n).fill(0);
  const magnetic = new Array<number>(n).fill(0);
  const dMin = spec.wavelength / (2 * Math.sin((spec.reflectionsTo / 2) * RAD));
  const hMax = Math.ceil((spec.model.na * CELL.a) / dMin) + 1;
  const kMax = Math.ceil(CELL.b / dMin) + 1;
  const lMax = Math.ceil(CELL.c / dMin) + 1;
  const sigma = spec.fwhm / (2 * Math.sqrt(2 * Math.LN2));
  const norm = 1 / (sigma * Math.sqrt(2 * Math.PI));
  for (let H = -hMax; H <= hMax; H++) {
    for (let K = -kMax; K <= kMax; K++) {
      for (let L = -lMax; L <= lMax; L++) {
        if (H === 0 && K === 0 && L === 0) continue;
        const r = reflection(spec.model, H, K, L);
        if (r.d < dMin) continue;
        const sinT = spec.wavelength / (2 * r.d);
        if (sinT >= 1) continue;
        const theta = Math.asin(sinT);
        const centre = (2 * theta) / RAD;
        const lorentz = 1 / (sinT * sinT * Math.cos(theta));
        const first = Math.max(0, Math.ceil((centre - 12 * spec.fwhm - spec.twoThetaMin) / spec.step));
        const last = Math.min(n - 1, Math.floor((centre + 12 * spec.fwhm - spec.twoThetaMin) / spec.step));
        for (let i = first; i <= last; i++) {
          const t = (x[i]! - centre) / sigma;
          const g = norm * Math.exp(-0.5 * t * t);
          nuclear[i] = nuclear[i]! + spec.scale * lorentz * r.nuclear * g;
          magnetic[i] = magnetic[i]! + spec.scale * lorentz * r.magnetic * g;
        }
      }
    }
  }
  return { x, y: x.map((_, i) => spec.background + nuclear[i]! + magnetic[i]!), magnetic, nuclear };
}

/** mulberry32: a small fixed generator, so a seed gives the same noise on every platform. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian counting noise, σ = √y of the noise-free pattern (Box–Muller on mulberry32). */
export function noisy(clean: CleanPattern, seed: number): { x: number; yObs: number; sigma: number }[] {
  const u = mulberry32(seed * 7919 + 13);
  return clean.x.map((x, i) => {
    const sigma = Math.sqrt(clean.y[i]!);
    const g = Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
    return { x, yObs: clean.y[i]! + sigma * g, sigma };
  });
}
