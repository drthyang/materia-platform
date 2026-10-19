/**
 * Preferred orientation read from a refined fit's intensity misfit.
 *
 * The misfit of each reflection, ln(I_obs/I_calc) once the fall-off with angle
 * is taken out, is fitted by the March–Dollase correction the model would
 * apply: for each candidate axis and ratio r, ln of P(α; r) averaged over the
 * family's Laue equivalents (a powder line's members lie at different angles
 * to the axis; a cubic family's mean cos² is 1/3 whatever the axis, so only
 * the full function, not cos², can see cubic texture). The statistic is the
 * share of the misfit's weighted variance the best (axis, r) explains.
 *
 * The axes are the low-index directions, indices in {−1, 0, 1}, one per class
 * of symmetry-equivalent directions (equivalent axes give the same family
 * averages). Choosing the best of several axes and ratios finds some pattern
 * in any noise, so the chance is a permutation test: the same search on the
 * misfits shuffled among the reflections, and the share of shuffles that
 * explain as much. Texture is named only when that chance is small.
 */

import type { SpaceGroup, UnitCell } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { marchDollase } from "@/core/diffraction/intensity";
import { lauEquivalents } from "@/core/diffraction/reflections";

export interface TextureRow {
  readonly h: number;
  readonly k: number;
  readonly l: number;
  /** ln(I_obs/I_calc), the fall-off with angle taken out. */
  readonly misfit: number;
  readonly weight: number;
}

export interface TextureTest {
  /** The best axis, as reciprocal-lattice indices. */
  readonly axis: Vec3;
  /** Its March–Dollase ratio (r < 1: platelets, reflections along the axis enhanced). */
  readonly ratio: number;
  /** The ratio sits at the searched range's end: the texture is at least this strong. */
  readonly atLimit: boolean;
  /** Share of the misfit's weighted variance that axis and ratio explain. */
  readonly explained: number;
  /** Chance of explaining as much with misfits shuffled among the reflections. */
  readonly chance: number;
  readonly n: number;
  /** Symmetry-distinct axes searched. */
  readonly axes: number;
  readonly enhancedAlongAxis: boolean;
}

/** Shuffles drawn for the chance. */
export const TEXTURE_DRAWS = 400;
/** Texture is named below this chance. */
export const TEXTURE_CHANCE = 0.01;
/** Ratios searched: 2^(t/12), t = −12 … 12 (r from 0.5 to 2). */
const RATIOS = Array.from({ length: 25 }, (_, t) => 2 ** ((t - 12) / 12));

const keyOf = ([h, k, l]: Vec3): string => `${h} ${k} ${l}`;

/** One axis per class of equivalent low-index directions; the representative is the lexicographically greatest. */
export function distinctAxes(sg: SpaceGroup): Vec3[] {
  const seen = new Set<string>();
  const axes: Vec3[] = [];
  for (let u = 1; u >= -1; u--) for (let v = 1; v >= -1; v--) for (let w = 1; w >= -1; w--) {
    if (u === 0 && v === 0 && w === 0) continue;
    const orbit = lauEquivalents(sg, u, v, w);
    if (orbit.some((a) => seen.has(keyOf(a)))) continue;
    orbit.forEach((a) => seen.add(keyOf(a)));
    axes.push([u, v, w]);
  }
  return axes;
}

/** A seeded uniform generator (LCG): the chance is the same on every call. */
function uniform(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

export function textureTest(
  rows: readonly TextureRow[],
  phase: { readonly cell: UnitCell; readonly spaceGroup: SpaceGroup },
  options: { readonly draws?: number; readonly seed?: number } = {},
): TextureTest | undefined {
  const n = rows.length;
  if (n < 3) return undefined;
  const w = rows.map((r) => r.weight);
  const sw = w.reduce((s, v) => s + v, 0);
  if (!(sw > 0)) return undefined;
  const axes = distinctAxes(phase.spaceGroup);
  const orbits = rows.map((r) => lauEquivalents(phase.spaceGroup, r.h, r.k, r.l));
  // Each (axis, ratio): the weighted-centred regressor and its Σw·x².
  const models: { axis: Vec3; ratio: number; x: number[]; sxx: number }[] = [];
  for (const axis of axes) {
    for (const ratio of RATIOS) {
      if (ratio === 1) continue;
      const raw = orbits.map((orbit) => Math.log(orbit.reduce((s, [h, k, l]) => s + marchDollase(phase.cell, axis, h, k, l, ratio), 0) / orbit.length));
      const mean = raw.reduce((s, v, i) => s + w[i]! * v, 0) / sw;
      const x = raw.map((v) => v - mean);
      models.push({ axis, ratio, x, sxx: x.reduce((s, v, i) => s + w[i]! * v * v, 0) });
    }
  }
  // The best model's share of Σw·(y − ȳ)²: the fit is y ≈ c + x, so it removes 2·Σw·x·y − Σw·x².
  const best = (y: readonly number[]): { share: number; model: (typeof models)[number] | undefined } => {
    const my = y.reduce((s, v, i) => s + w[i]! * v, 0) / sw;
    const syy = y.reduce((s, v, i) => s + w[i]! * (v - my) ** 2, 0);
    let share = 0;
    let model: (typeof models)[number] | undefined;
    if (!(syy > 0)) return { share, model };
    for (const m of models) {
      let sxy = 0;
      for (let i = 0; i < n; i++) sxy += w[i]! * m.x[i]! * y[i]!;
      const gain = (2 * sxy - m.sxx) / syy;
      if (gain > share) { share = gain; model = m; }
    }
    return { share, model };
  };
  const y = rows.map((r) => r.misfit);
  const found = best(y);
  const draws = options.draws ?? TEXTURE_DRAWS;
  const rand = uniform(options.seed ?? 1);
  const shuffled = [...y];
  let asGood = 0;
  for (let d = 0; d < draws; d++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    if (best(shuffled).share >= found.share) asGood++;
  }
  const model = found.model;
  const ratio = model?.ratio ?? 1;
  return {
    axis: model?.axis ?? axes[0]!,
    ratio,
    atLimit: ratio === RATIOS[0] || ratio === RATIOS[RATIOS.length - 1],
    explained: found.share,
    chance: (asGood + 1) / (draws + 1),
    n,
    axes: axes.length,
    enhancedAlongAxis: ratio < 1,
  };
}
