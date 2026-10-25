/**
 * Analytic derivatives of the PDF forward model (roadmap F1.1 for the real-
 * space track) — a FUSED single pass over the pair list that accumulates the
 * value curve and every requested ∂G/∂p column simultaneously.
 *
 * Per pair, the term at grid point k is t = peak·e with e = exp(−dr²/2σ²),
 * dr = r_k − r_p. Every supported parameter's per-pair contribution reduces to
 * a quadratic-in-dr coefficient triple on e:
 *
 *   ∂t/∂p = (q0 + q1·dr + q2·dr²)·e
 *     width  D = dσ/dp:      q0 −= peak·D/σ,   q2 += peak·D/σ³
 *     center R′ = dr_p/dp:   q0 −= peak·R′/r,  q1 += peak·R′/σ²
 *     amplitude dA = dAmp/dp: q0 += dA/(√2π·σ)   (absolute — no divide by Amp,
 *                              so a zero-occupancy site still differentiates)
 *
 * so the fused engine costs ≈ one forward pass (the exp dominates) plus ~3
 * flops per active column per point, versus 2 evaluations per column for
 * finite differences.
 *
 * The value curve is computed with the SAME expressions in the SAME order as
 * `computeGofR` and a test pins them bit-identical — lockstep is enforced by
 * test, not by shared helpers, so the forward hot path stays untouched.
 *
 * Non-differentiable points (zero-subgradient convention, matching what an
 * exact FD would see almost everywhere):
 *  - SIGMA_FLOOR clamp and the sig2 ≤ 0 fallback: dσ/d(δ,Qbroad) = 0 through
 *    the clamp; through the msd fallback (sig2 = msd) the msd-direction keeps
 *    dsig2/dmsd = 1 while the r-direction of sig2 vanishes.
 *  - The ±5σ accumulation window: the analytic column is the derivative of the
 *    untruncated pair term restricted to the window — the edge error is
 *    O(e^{−12.5}) ≈ 4·10⁻⁶ of peak height. (An FD oracle additionally sees
 *    window-quantization spikes of order peak·e^{−12.5}/2h when a perturbation
 *    moves lo/hi across a lattice point; that is FD noise, not column error.)
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { UnitCell } from "@/core/crystal/types";
import type { ExpandedAtom } from "@/core/diffraction/structureFactor";
import { compositionWeights, groupedWeights, numberDensity, pairWeight, speciesAmplitude } from "@/core/totalscattering/weights";
import { asPairSource, cartesianAdpTensor, type ColocatedGroups, type PairsInput } from "@/core/pdf/pairEnumerator";
import { sphereEnvelope, type GridBlock, type PdfModelParams } from "@/core/pdf/forwardModel";

/**
 * One requested derivative column. Built by the workflow (which owns bindings,
 * sites, and symmetry provenance); this module is binding-agnostic — every
 * request is stated per EXPANDED ATOM index, aligned with `atoms`.
 */
export type PdfColumnRequest =
  /** ∂G/∂Qdamp — pointwise on the final curve, no pair loop. */
  | { readonly kind: "qdamp" }
  /** ∂G/∂spdiameter — pointwise on the pre-envelope curve (diameter > 0). */
  | { readonly kind: "spdiameter" }
  /** ∂G/∂{δ1, δ2, Qbroad} — width-only, through sig2 = msd·broad(r). */
  | { readonly kind: "sigma"; readonly target: "delta1" | "delta2" | "qbroad" }
  /** ∂G/∂occupancy: dOcc[a] = d(occ_a)/dp per expanded atom (0 or 1 summed
   *  over bindings). Amplitude + ρ₀-baseline + normalization chain. */
  | { readonly kind: "occupancy"; readonly dOcc: Float64Array }
  /** ∂G/∂(ADP parameter): per expanded atom, d(msd along n̂)/dp = constant
   *  (bIso: 1/8π², direction-free) + n̂ᵀ·tensor·n̂ (uAniso: the Cartesian
   *  d U_cart/dp). */
  | { readonly kind: "msd"; readonly constant: Float64Array; readonly tensors: readonly (Mat3 | null)[] }
  /** ∂G/∂(positionShift): du_a/dp = Cartesian velocity per bound expanded atom
   *  (null = unbound). Moves peak centers AND (through n̂) the msd projection. */
  | { readonly kind: "position"; readonly velocity: readonly (Vec3 | null)[] };

export interface PdfGradResult {
  /** Value curve — bit-identical to `computeGofR` on the same inputs. */
  readonly g: Float64Array;
  /** ∂G/∂p per request (same order), on the model grid, envelope + scale
   *  applied, NOT terminated — the caller owns bandLimit + window splice,
   *  exactly as it does for the value. */
  readonly columns: Float64Array[];
}

const GAUSS_WINDOW = 5;
const SIGMA_FLOOR = 1e-4;
const EIGHT_PI_SQ = 8 * Math.PI * Math.PI;

/** d(msd along n̂)/dp for one atom of a pair under an "msd" request. */
function msdDeriv(req: { constant: Float64Array; tensors: readonly (Mat3 | null)[] }, a: number, nx: number, ny: number, nz: number): number {
  let d = req.constant[a]!;
  const T = req.tensors[a];
  if (T) {
    // n̂ᵀ·T·n̂ with T symmetric.
    const tx = T[0][0] * nx + T[0][1] * ny + T[0][2] * nz;
    const ty = T[1][0] * nx + T[1][1] * ny + T[1][2] * nz;
    const tz = T[2][0] * nx + T[2][1] * ny + T[2][2] * nz;
    d += nx * tx + ny * ty + nz * tz;
  }
  return d;
}

/**
 * Fused value + analytic-columns pass. `atoms`/`pairs` must be the same lists
 * a `computeGofR` call would use (the workflow's cached pairs). Every request
 * yields one column, index-aligned with `requests`.
 *
 * With `groups` (the pairs over each mixed site's representative, as for
 * `computeGofR`), every request must be the same on each atom of a group
 * (`requestsUniformOver`): only occupancy may differ, which is summed.
 *
 * `pairs` may be any pair source in the canonical order, and `block` limits
 * the value and every column to grid points [k0, k1), as for `computeGofR`
 * (each point bit-identical to the whole pass's).
 */
export function computeGofRWithColumns(
  cell: UnitCell,
  atoms: readonly ExpandedAtom[],
  rGrid: ArrayLike<number>,
  params: PdfModelParams,
  pairs: PairsInput,
  requests: readonly PdfColumnRequest[],
  groups?: ColocatedGroups | null,
  block?: GridBlock,
): PdfGradResult {
  const n = rGrid.length;
  const g = new Float64Array(n);
  const columns = requests.map(() => new Float64Array(n));
  if (n === 0 || atoms.length === 0) return { g, columns };

  const r0 = rGrid[0]!;
  const step = n > 1 ? rGrid[1]! - rGrid[0]! : 1;

  const cellWeights = compositionWeights(atoms, params.scatteringType);
  const weights = groups ? groupedWeights(cellWeights, groups.rep) : cellWeights;
  const rho0 = numberDensity(weights.nEff, cell);
  const norm = 1 / (weights.bAvgAbs2 * weights.nEff);

  const sratio = params.sratio ?? 1;
  const rcut = params.rcut ?? 0;
  const d1 = params.delta1;
  const d2 = params.delta2;
  const qb = params.qbroad;
  const qb2 = qb * qb;

  // --- Per-request precomputation ------------------------------------------
  // Occupancy: dPer[a] = dOcc[a]·b_a, plus the normalization chain through
  // N = Σocc and S1 = Σ occ·b (norm = N/|S1|², rho0 = N/V). Complex amplitudes
  // add the imaginary parts: d Re(w_i w_j*) = dPer_i·w_j + w_i·dPer_j + (same
  // for the imaginary parts), d ln|S1|² = 2·Re(S1*·dS1)/|S1|².
  const occPre = requests.map((req) => {
    if (req.kind !== "occupancy") return null;
    const dPer = new Float64Array(atoms.length);
    const dPerIm = weights.perAtomIm ? new Float64Array(atoms.length) : null;
    let dS1 = 0;
    let dS1Im = 0;
    let dN = 0;
    for (let a = 0; a < atoms.length; a++) {
      const dOcc = req.dOcc[a]!;
      if (dOcc === 0) continue;
      const amp = speciesAmplitude(atoms[a]!.element, params.scatteringType, atoms[a]!.isotope);
      const b = amp.re;
      dPer[a] = dOcc * b;
      dS1 += dOcc * b;
      if (dPerIm) {
        dPerIm[a] = dOcc * amp.im;
        dS1Im += dOcc * amp.im;
      }
      dN += dOcc;
    }
    const S1 = weights.bAvg * weights.nEff;
    // d(norm)/norm = dN/N − 2·Re(S1*·dS1)/|S1|² (norm = N/|S1|²).
    const S1Im = weights.bAvgIm * weights.nEff;
    if (groups) {
      // Each species' weight derivative onto its group's representative, as the weights are.
      const g = new Float64Array(atoms.length);
      for (let a = 0; a < atoms.length; a++) g[groups.rep[a]!] = g[groups.rep[a]!]! + dPer[a]!;
      dPer.set(g);
      if (dPerIm) {
        g.fill(0);
        for (let a = 0; a < atoms.length; a++) g[groups.rep[a]!] = g[groups.rep[a]!]! + dPerIm[a]!;
        dPerIm.set(g);
      }
    }
    const dLnS1Sq = dPerIm
      ? (S1 !== 0 || S1Im !== 0 ? (2 * (S1 * dS1 + S1Im * dS1Im)) / (S1 * S1 + S1Im * S1Im) : 0)
      : (S1 !== 0 ? (2 * dS1) / S1 : 0);
    const dNormRel = (weights.nEff > 0 ? dN / weights.nEff : 0) - dLnS1Sq;
    return { dPer, dPerIm, dN, dNormRel };
  });

  // Position requests need U_sum·n̂ only when the structure has anisotropic
  // ADPs — for isotropic ADPs msd is direction-free and n̂ rotation drops out.
  const anyPosition = requests.some((r) => r.kind === "position");
  const hasAniso = anyPosition && atoms.some((a) => a.adp.kind === "anisotropic");
  const uCartAll: Mat3[] | null = hasAniso ? atoms.map((a) => cartesianAdpTensor(cell, a.adp)) : null;

  // Scratch: per-pair active-column coefficient triples on e.
  const q0 = new Float64Array(requests.length);
  const q1 = new Float64Array(requests.length);
  const q2 = new Float64Array(requests.length);
  const active: number[] = [];
  // Scratch: one pair's Gaussian window (e and dr per grid point).
  let eWin = new Float64Array(256);
  let drWin = new Float64Array(256);

  const kFirst = block ? Math.max(0, block.k0) : 0;
  const kLast = block ? Math.min(n, block.k1) - 1 : n - 1;
  const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);
  asPairSource(pairs).forEachChunk((chunk) => {
    for (let p = 0; p < chunk.length; p++) {
      const pi = chunk.i[p]!;
      const pj = chunk.j[p]!;
      const pnx = chunk.nx[p]!;
      const pny = chunk.ny[p]!;
      const pnz = chunk.nz[p]!;
      const r = chunk.r[p]!;
      const msd = chunk.msd[p]!;
      const broad = 1 - d1 / r - d2 / (r * r) + qb2 * r * r;
      const sig2raw = msd * broad;
      // Fallback tri-state mirrors the forward model exactly.
      const fallbackMsd = !(sig2raw > 0) && msd > 0;
      const fallbackFloor = !(sig2raw > 0) && !(msd > 0);
      let sig2 = sig2raw;
      if (!(sig2 > 0)) sig2 = msd > 0 ? msd : SIGMA_FLOOR * SIGMA_FLOOR;
      const sigma0 = Math.sqrt(sig2);
      let sigma = sigma0;
      const cut = rcut > 0 && r < rcut;
      if (cut) sigma *= sratio;
      const clamped = sigma < SIGMA_FLOOR;
      if (clamped) sigma = SIGMA_FLOOR;

      const amp = pairWeight(weights, pi, pj) * norm / r;
      const invTwoSig2 = 1 / (2 * sigma * sigma);
      const peak = amp * INV_SQRT_2PI / sigma;

      // dσ/d(sig2): zero through the floor clamp; scut/(2σ0) otherwise.
      const dSigDSig2 = clamped ? 0 : (cut ? sratio : 1) / (2 * sigma0);
      // ∂sig2/∂msd (the "B" factor): broad normally, 1 in the msd fallback,
      // 0 when floored (sig2 pinned at the constant floor).
      const B = fallbackFloor ? 0 : fallbackMsd ? 1 : broad;
      // ∂sig2/∂r at fixed msd — vanishes in both fallback branches.
      const dSig2Dr = fallbackMsd || fallbackFloor ? 0 : msd * (d1 / (r * r) + (2 * d2) / (r * r * r) + 2 * qb2 * r);

      const invSigma = 1 / sigma;
      const invSigma2 = invSigma * invSigma;
      const invSigma3 = invSigma2 * invSigma;

      // A pair whose window misses the grid (or a split pool's block) adds nothing.
      const lo = Math.max(kFirst, Math.ceil((r - GAUSS_WINDOW * sigma - r0) / step));
      const hi = Math.min(kLast, Math.floor((r + GAUSS_WINDOW * sigma - r0) / step));
      if (lo > hi) continue;

      active.length = 0;
      for (let c = 0; c < requests.length; c++) {
        const req = requests[c]!;
        let a0 = 0;
        let a1 = 0;
        let a2 = 0;
        switch (req.kind) {
          case "qdamp":
          case "spdiameter":
            continue; // pointwise epilogue kinds — no pair contribution
          case "sigma": {
            const dsig2 =
              fallbackMsd || fallbackFloor
                ? 0
                : req.target === "delta1"
                  ? -msd / r
                  : req.target === "delta2"
                    ? -msd / (r * r)
                    : 2 * qb * msd * r * r;
            const D = dSigDSig2 * dsig2;
            if (D === 0) continue;
            a0 = -peak * D * invSigma;
            a2 = peak * D * invSigma3;
            break;
          }
          case "msd": {
            const dmsd =
              msdDeriv(req, pi, pnx, pny, pnz) +
              msdDeriv(req, pj, pnx, pny, pnz);
            if (dmsd === 0) continue;
            const D = dSigDSig2 * B * dmsd;
            if (D === 0) continue;
            a0 = -peak * D * invSigma;
            a2 = peak * D * invSigma3;
            break;
          }
          case "position": {
            const vi = req.velocity[pi];
            const vj = req.velocity[pj];
            if (!vi && !vj) continue;
            // Δu = du_j − du_i; center velocity R′ = n̂·Δu.
            const ux = (vj ? vj[0] : 0) - (vi ? vi[0] : 0);
            const uy = (vj ? vj[1] : 0) - (vi ? vi[1] : 0);
            const uz = (vj ? vj[2] : 0) - (vi ? vi[2] : 0);
            const rPrime = pnx * ux + pny * uy + pnz * uz;
            // msd reacts through n̂ only for anisotropic ADPs:
            // dmsd = 2·(U_sum n̂)·dn̂, dn̂ = (Δu − n̂·R′)/r.
            let dmsd = 0;
            if (uCartAll) {
              const Ui = uCartAll[pi]!;
              const Uj = uCartAll[pj]!;
              const sx = (Ui[0][0] + Uj[0][0]) * pnx + (Ui[0][1] + Uj[0][1]) * pny + (Ui[0][2] + Uj[0][2]) * pnz;
              const sy = (Ui[1][0] + Uj[1][0]) * pnx + (Ui[1][1] + Uj[1][1]) * pny + (Ui[1][2] + Uj[1][2]) * pnz;
              const sz = (Ui[2][0] + Uj[2][0]) * pnx + (Ui[2][1] + Uj[2][1]) * pny + (Ui[2][2] + Uj[2][2]) * pnz;
              const dnx = (ux - pnx * rPrime) / r;
              const dny = (uy - pny * rPrime) / r;
              const dnz = (uz - pnz * rPrime) / r;
              dmsd = 2 * (sx * dnx + sy * dny + sz * dnz);
            }
            const D = dSigDSig2 * (dSig2Dr * rPrime + B * dmsd);
            if (rPrime === 0 && D === 0) continue;
            a0 = -peak * (rPrime / r) - peak * D * invSigma;
            a1 = peak * rPrime * invSigma2;
            a2 = peak * D * invSigma3;
            break;
          }
          case "occupancy": {
            const pre = occPre[c]!;
            const im = weights.perAtomIm;
            const dW = pre.dPerIm && im
              ? pre.dPer[pi]! * weights.perAtom[pj]! + weights.perAtom[pi]! * pre.dPer[pj]! +
                (pre.dPerIm[pi]! * im[pj]! + im[pi]! * pre.dPerIm[pj]!)
              : pre.dPer[pi]! * weights.perAtom[pj]! + weights.perAtom[pi]! * pre.dPer[pj]!;
            const dAmp = (dW * norm) / r + amp * pre.dNormRel;
            if (dAmp === 0) continue;
            a0 = dAmp * INV_SQRT_2PI * invSigma;
            break;
          }
        }
        q0[c] = a0;
        q1[c] = a1;
        q2[c] = a2;
        active.push(c);
      }

      if (active.length === 0) {
        // Value-only accumulation (identical expressions to computeGofR).
        for (let k = lo; k <= hi; k++) {
          const dr = r0 + k * step - r;
          g[k] = g[k]! + peak * Math.exp(-dr * dr * invTwoSig2);
        }
      } else {
        // The window's e and dr once, then one tight loop per active column. Each
        // column point receives the same terms in the same pair order as a
        // point-outer loop, so the result is bit-identical; walking one column
        // at a time is about twice as fast.
        const span = hi - lo + 1;
        if (span > eWin.length) {
          eWin = new Float64Array(2 * span);
          drWin = new Float64Array(2 * span);
        }
        for (let k = lo; k <= hi; k++) {
          const dr = r0 + k * step - r;
          const e = Math.exp(-dr * dr * invTwoSig2);
          g[k] = g[k]! + peak * e;
          eWin[k - lo] = e;
          drWin[k - lo] = dr;
        }
        for (let a = 0; a < active.length; a++) {
          const c = active[a]!;
          const col = columns[c]!;
          const c0 = q0[c]!;
          const c1 = q1[c]!;
          const c2 = q2[c]!;
          for (let k = lo; k <= hi; k++) {
            const dr = drWin[k - lo]!;
            col[k] = col[k]! + (c0 + dr * (c1 + dr * c2)) * eWin[k - lo]!;
          }
        }
      }
    }
  });

  // --- Epilogue: baseline + envelopes + scale --------------------------------
  // The value path repeats computeGofR verbatim (bit-identity); columns ride
  // the same envelope/scale, with their own baseline/pointwise terms.
  const fourPiRho0 = 4 * Math.PI * rho0;
  const spd = params.spdiameter ?? 0;
  const volume = rho0 > 0 ? weights.nEff / rho0 : 0;
  for (let k = kFirst; k <= kLast; k++) {
    const r = rGrid[k]!;
    let val = g[k]! - fourPiRho0 * r;
    let env = 1;
    if (spd > 0) {
      const sph = sphereEnvelope(r, spd);
      val *= sph;
      env *= sph;
    }
    if (params.qdamp > 0) {
      const damp = Math.exp(-0.5 * (r * params.qdamp) * (r * params.qdamp));
      val *= damp;
      env *= damp;
    }
    const rawPost = g[k]! - fourPiRho0 * r; // pre-envelope, post-baseline
    g[k] = params.scale * val;

    for (let c = 0; c < requests.length; c++) {
      const req = requests[c]!;
      const col = columns[c]!;
      switch (req.kind) {
        case "qdamp":
          // d/dQdamp of exp(−½(r·Qdamp)²) = −r²·Qdamp·(the final curve).
          col[k] = -r * r * params.qdamp * g[k]!;
          break;
        case "spdiameter": {
          // d(sphereEnvelope)/d(d) = 1.5·(1−x²)·r/d² for x = r/d < 1, else 0;
          // applies to the pre-sphere curve, then rides the Qdamp envelope.
          if (spd > 0 && r < spd) {
            const x = r / spd;
            const dEnv = (1.5 * (1 - x * x) * r) / (spd * spd);
            const qd = params.qdamp > 0 ? Math.exp(-0.5 * (r * params.qdamp) * (r * params.qdamp)) : 1;
            col[k] = params.scale * qd * rawPost * dEnv;
          } else {
            col[k] = 0;
          }
          break;
        }
        case "occupancy": {
          const pre = occPre[c]!;
          const dRho0 = volume > 0 ? pre.dN / volume : 0;
          col[k] = params.scale * env * (col[k]! - 4 * Math.PI * dRho0 * r);
          break;
        }
        default:
          col[k] = params.scale * env * col[k]!;
      }
    }
  }
  return { g, columns };
}

/** d(u_iso)/d(B_iso) = 1/8π² — the bIso "constant" msd-request entry. */
export const DUISO_DBISO = 1 / EIGHT_PI_SQ;

/**
 * Whether every request is the same on each atom of a co-located group, so the
 * group's pairs may be summed through its representative: the ADP derivative
 * (constant and tensor) and the position velocity per atom. Occupancy, the
 * width and envelope kinds hold on any grouping.
 */
export function requestsUniformOver(requests: readonly PdfColumnRequest[], groups: ColocatedGroups): boolean {
  const rep = groups.rep;
  const same3 = (a: readonly number[] | null, b: readonly number[] | null): boolean =>
    a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
  for (const req of requests) {
    for (let a = 0; a < rep.length; a++) {
      const r = rep[a]!;
      if (r === a) continue;
      if (req.kind === "msd") {
        if (req.constant[a] !== req.constant[r]) return false;
        const ta = req.tensors[a] ?? null;
        const tr = req.tensors[r] ?? null;
        if ((ta === null) !== (tr === null)) return false;
        if (ta && tr && !(same3(ta[0], tr[0]) && same3(ta[1], tr[1]) && same3(ta[2], tr[2]))) return false;
      } else if (req.kind === "position") {
        if (!same3(req.velocity[a] ?? null, req.velocity[r] ?? null)) return false;
      }
    }
  }
  return true;
}
