/**
 * The absolute structure from the Bijvoet pairs measured both ways, by
 * Parsons' quotients (Parsons, Flack & Wagner, Acta Cryst. B69 (2013) 249):
 * for each pair, Q = (I⁺ − I⁻)/(I⁺ + I⁻), observed against the model's, and
 * Q_obs = (1 − 2x)·Q_calc for a crystal with a fraction x of the inverted
 * hand. The scale and most systematic errors (absorption, extinction, a
 * crystal's decay) cancel in the quotient, so x comes out far better
 * determined than from refining it beside everything else — SHELXL reports
 * it so ("determined using N quotients"). The model's Fc² must hold no
 * inversion twinning (x = 0); a merohedral twin's mixing is in them.
 */

import type { SymmetryOperation } from "@/core/crystal/types";
import { canonicalKey, mergeEquivalents, pointGroupRotations } from "@/core/diffraction/merge";

export interface BijvoetRow {
  readonly h: number;
  readonly k: number;
  readonly l: number;
  readonly foSq: number;
  readonly fcSq: number;
  readonly sigma: number;
}

export interface ParsonsEstimate {
  /** The Flack x the quotients give. */
  readonly x: number;
  /** Its esd: the least-squares one, scaled by √χ²_ν of the quotients' fit when that is above 1. */
  readonly esd: number;
  /** The Bijvoet pairs used (both measured, neither centric, I⁺ + I⁻ > 0). */
  readonly quotients: number;
  /** √χ²_ν of Q_obs against (1 − 2x)·Q_calc: near 1 when the σ(I) describe the quotients' scatter. */
  readonly goodness: number;
  /** The Bijvoet differences observed at more than 3σ, and how many have the model's sign: the hand at a glance. */
  readonly signs: { readonly observed: number; readonly modelSign: number };
}

/**
 * Parsons' x from the reflections fitted, paired by the point group; null
 * when no pair was measured both ways, or the model gives the pairs no
 * anomalous difference. Unmerged data are merged first, the Friedel
 * opposites apart (SHELXL's MERG 2): each side of a pair is every
 * measurement of the reflection and its equivalents, Fo² and Fc² their means
 * weighted by 1/σ², σ as `mergeEquivalents` gives it. (Each side's first
 * measurement alone left the esd √n too large for n measurements.)
 */
export function parsonsQuotients(rows: readonly BijvoetRow[], operations: readonly SymmetryOperation[]): ParsonsEstimate | null {
  const rotations = pointGroupRotations(operations);
  const groups = new Map<string, BijvoetRow[]>();
  for (const r of rows) {
    const key = canonicalKey(rotations, r.h, r.k, r.l);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const fo = mergeEquivalents(rows.map((r) => ({ h: r.h, k: r.k, l: r.l, intensity: r.foSq, sigma: r.sigma })), operations, { friedel: false }).reflections;
  const byKey = new Map<string, BijvoetRow>();
  for (const m of fo) {
    const key = `${m.h},${m.k},${m.l}`;
    const members = groups.get(key)!;
    let w = 0;
    let wc = 0;
    for (const r of members) {
      const wi = r.sigma > 0 ? 1 / (r.sigma * r.sigma) : 1;
      w += wi;
      wc += wi * r.fcSq;
    }
    byKey.set(key, { h: m.h, k: m.k, l: m.l, foSq: m.intensity, sigma: m.sigma, fcSq: wc / w });
  }
  let sxy = 0;
  let sxx = 0;
  let observed = 0;
  let modelSign = 0;
  const pairs: { qo: number; qc: number; w: number }[] = [];
  const seen = new Set<string>();
  for (const [key, plus] of byKey) {
    if (seen.has(key)) continue;
    const mateKey = canonicalKey(rotations, -plus.h, -plus.k, -plus.l);
    // A centric reflection is its own Friedel mate: no Bijvoet difference.
    if (mateKey === key) continue;
    const minus = byKey.get(mateKey);
    seen.add(key);
    seen.add(mateKey);
    if (!minus) continue;
    const io = plus.foSq + minus.foSq;
    const ic = plus.fcSq + minus.fcSq;
    if (!(io > 0) || !(ic > 0) || !(plus.sigma > 0) || !(minus.sigma > 0)) continue;
    const qo = (plus.foSq - minus.foSq) / io;
    const qc = (plus.fcSq - minus.fcSq) / ic;
    const sq = (2 / (io * io)) * Math.hypot(minus.foSq * plus.sigma, plus.foSq * minus.sigma);
    if (!(sq > 0) || !Number.isFinite(sq)) continue;
    const w = 1 / (sq * sq);
    pairs.push({ qo, qc, w });
    const d = plus.foSq - minus.foSq;
    if (Math.abs(d) > 3 * Math.hypot(plus.sigma, minus.sigma) && plus.fcSq !== minus.fcSq) {
      observed++;
      if (Math.sign(d) === Math.sign(plus.fcSq - minus.fcSq)) modelSign++;
    }
    sxy += w * qo * qc;
    sxx += w * qc * qc;
  }
  if (pairs.length < 2 || !(sxx > 0)) return null;
  const slope = sxy / sxx;
  const chi2 = pairs.reduce((t, p) => t + p.w * (p.qo - slope * p.qc) ** 2, 0) / (pairs.length - 1);
  const goodness = Math.sqrt(chi2);
  // slope = 1 − 2x: x and its esd from the slope's.
  return { x: (1 - slope) / 2, esd: (0.5 / Math.sqrt(sxx)) * Math.max(1, goodness), quotients: pairs.length, goodness, signs: { observed, modelSign } };
}
