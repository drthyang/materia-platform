/**
 * Simulated G(r) for the subgroup search's known-truth gate and calibration
 * (THY-72, decision 4): a structure's G(r) by the app's own forward model,
 * band-limited at the data's Qmax and damped by its Qdamp, plus Gaussian noise
 * drawn on F(Q) and transformed to G(r) with the same Qmax, so the noise is
 * correlated in r as a measurement's is.
 *
 *  - **The signal**: `pdfCurves` (core/workflow/pdf.ts) on a grid from one
 *    step to 30 Å, so the band-limit has room on both sides, then cut to the
 *    data's range. The scale is 1; Qdamp, Qbroad, δ1 and δ2 are the given
 *    values (the fit's).
 *  - **The noise**: δF(Q_k) ~ N(0, σ_k²) on a uniform Q grid 0 … Qmax, with
 *    σ_k = s·Q_k/Qmax (white S(Q) noise, σ_F = Q·σ_S: it grows with Q as a
 *    measurement's does), and δG(r) = (2/π) Σ_k w_k δF_k sin(Q_k r) with the
 *    trapezoid weights w_k (fourier.ts's transform, no modification
 *    function). The noise is not damped by Qdamp: Qdamp is the instrument's
 *    resolution acting on the signal, the counting noise is added after it.
 *  - **The level**: s is set so the noise's expected Σδg² over a window is
 *    `level`² × Σg² of the signal there: a parent fit on parent-simulated
 *    data then reads Rw ≈ level (a little less: the fit absorbs a part).
 */

import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern, PdfScatteringType } from "@/core/diffraction/types";
import { buildPdfSpec, pdfCurves } from "@/core/workflow/pdf";
import { makeRGrid } from "@/core/pdf/forwardModel";

export interface SimulationSettings {
  readonly scatteringType: PdfScatteringType;
  readonly qmax: number;
  readonly qdamp: number;
  readonly qbroad?: number;
  readonly delta1?: number;
  readonly delta2?: number;
  /** Grid step Δr (Å). */
  readonly rStep: number;
  /** The data's range (Å). */
  readonly rFirst: number;
  readonly rLast: number;
}

/** A structure's noise-free G(r) as a pattern carrying Qmax and Qdamp. */
export function simulatedPattern(structure: StructureModel, s: SimulationSettings, name = "simulated"): PdfPattern {
  const grid = makeRGrid(s.rStep, 30, s.rStep);
  const base: PdfPattern = {
    id: name,
    name,
    scatteringType: s.scatteringType,
    points: Array.from(grid, (r) => ({ r, gObs: 0 })),
    qmax: s.qmax,
    qdamp: s.qdamp,
    ...(s.qbroad !== undefined ? { qbroad: s.qbroad } : {}),
  };
  const spec = buildPdfSpec(structure, base);
  const set: Record<string, number> = { pdfScale: 1, qdamp: s.qdamp, qbroad: s.qbroad ?? 0, delta1: s.delta1 ?? 0, delta2: s.delta2 ?? 0 };
  const params = spec.params.map((p) => (set[p.kind] !== undefined ? { ...p, value: set[p.kind]!, initialValue: set[p.kind]! } : p));
  const c = pdfCurves(structure, base, params, spec.bindings);
  const eps = 1e-9;
  return { ...base, points: base.points.map((p, i) => ({ r: p.r, gObs: c.yCalc[i]! })).filter((p) => p.r >= s.rFirst - eps && p.r <= s.rLast + eps) };
}

/** A seeded standard normal sequence (mulberry32 through Box–Muller). */
export function normalSequence(seed: number): () => number {
  let a = seed >>> 0;
  const u = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** The noise operator on a pattern's grid: δG(r_i) = Σ_k a_ik δF_k for unit σ_F shape Q/Qmax. */
interface NoiseOperator {
  readonly q: Float64Array;
  /** (2/π)·w_k·Q_k/Qmax, the column weight with the σ shape folded in. */
  readonly c: Float64Array;
}

function noiseOperator(qmax: number, dq: number): NoiseOperator {
  const n = Math.round(qmax / dq) + 1;
  const q = new Float64Array(n);
  const c = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    q[k] = (k * qmax) / (n - 1);
    const w = (qmax / (n - 1)) * (k === 0 || k === n - 1 ? 0.5 : 1);
    c[k] = (2 / Math.PI) * w * (q[k]! / qmax);
  }
  return { q, c };
}

/**
 * The pattern with F(Q) noise at a level: the noise's expected Σδg² over
 * `window` is level² × the signal's Σg² there. `dq` is the Q grid step
 * (default 0.02 Å⁻¹, fine enough for r up to π/dq ≈ 157 Å).
 */
export function noisyPattern(clean: PdfPattern, o: { readonly level: number; readonly window: { readonly rmin: number; readonly rmax: number }; readonly seed: number; readonly dq?: number }): PdfPattern & { readonly noiseScale: number } {
  const qmax = clean.qmax!;
  const op = noiseOperator(qmax, o.dq ?? 0.02);
  const r = clean.points.map((p) => p.r);
  // Expected Σ over the window of δG² per unit s²: Σ_i Σ_k c_k² sin²(Q_k r_i).
  let expected = 0;
  let signal = 0;
  for (let i = 0; i < r.length; i++) {
    if (r[i]! < o.window.rmin || r[i]! > o.window.rmax) continue;
    signal += clean.points[i]!.gObs ** 2;
    for (let k = 0; k < op.q.length; k++) expected += (op.c[k]! * Math.sin(op.q[k]! * r[i]!)) ** 2;
  }
  const s = o.level * Math.sqrt(signal / expected);
  const normal = normalSequence(o.seed);
  const dF = Float64Array.from(op.q, () => s * normal());
  return {
    ...clean,
    id: `${clean.id}-noise-${o.level}-${o.seed}`,
    name: `${clean.name} + ${(100 * o.level).toFixed(0)} % noise (seed ${o.seed})`,
    points: clean.points.map((p) => {
      let d = 0;
      for (let k = 0; k < op.q.length; k++) d += op.c[k]! * dF[k]! * Math.sin(op.q[k]! * p.r);
      return { r: p.r, gObs: p.gObs + d };
    }),
    noiseScale: s,
  };
}
