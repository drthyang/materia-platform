/**
 * The data's ends: where the fit window should start and stop. A pattern's
 * first and last stretches are often not data the model should fit — a
 * detector's or a scan's edge where the counts climb or step away from the
 * background, points with no counts, background below the first reflection,
 * or the short-d end where the peaks have faded into the noise. This reads
 * each end and proposes a window, its edges in gaps between reflections.
 *
 * It follows the GSAS-II tutorials' practice: "move the lower limit … to just
 * below the 1st peak, set the upper limit to the gap just below the end of the
 * neutron pattern" (PbSO₄ on D1A); on POWGEN's short-TOF end, "find a place
 * where there are still peaks and put the lower limit into a convenient gap";
 * where "peaks are clearly visible over the entire range … we need not change
 * the limits". Found by the user on the Agent's demo (PbSO₄, 2026-10-11): the
 * edge of the data did not look real and should have been excluded — there
 * one detector counts the last 6°, and the counts climb to about twice the
 * background over the last 3°.
 *
 * The background is read with the model's Bragg peaks taken out (the
 * calculated curve, its scale and a smooth background fitted to the data), so
 * a background that curves smoothly is not taken for an edge. Pure: arrays in,
 * a reading out, on the pattern's own axis (2θ, TOF, …), ascending.
 */

import { LARGE_CUT } from "@/core/diagnostics/thresholds";

export type End = "low" | "high";

export interface DataRangeInput {
  /** The pattern's axis (2θ in °, TOF in µs, …), ascending. */
  readonly x: readonly number[];
  readonly yObs: readonly number[];
  /** Each point's σ. */
  readonly sigma: readonly number[];
  /** The model's curve at the current values. */
  readonly yCalc?: readonly number[];
  /** The model's background under yCalc. */
  readonly yBackground?: readonly number[];
  /** yCalc comes from a converged refinement: its residual is read as evidence too. */
  readonly fitted?: boolean;
  /** Every phase's reflections, on the pattern's axis. */
  readonly reflections: readonly number[];
  /** Which end of the axis holds the short d-spacings (2θ, Q: high; TOF, d: low). */
  readonly shortD: End;
  /** Points the data mark as missing (a sentinel plateau). */
  readonly excluded?: readonly boolean[];
  /** The current fit window, on the same axis. */
  readonly window?: { readonly min: number; readonly max: number } | null;
}

/** Why a stretch at an end is left out. */
export type EdgeCause = "no-counts" | "step" | "background-only" | "faded-peaks" | "residual" | "line-at-edge";

export interface EdgeFinding {
  readonly cause: EdgeCause;
  /** The stretch, from the end inward, on the pattern's axis. */
  readonly from: number;
  readonly to: number;
  readonly points: number;
  /** What was seen, with numbers. */
  readonly detail: string;
}

export interface DataEnd {
  readonly end: End;
  /** trim: leave the stretch out of the fit window. */
  readonly verdict: "keep" | "trim";
  /** Where the fit window should stop, on the pattern's axis (when trimming): in a gap between reflections. */
  readonly cut?: number;
  /** Points the cut leaves out. */
  readonly dropped?: number;
  /** A cut of more than LARGE_CUT of the points: the user's call. */
  readonly large?: boolean;
  /** The current window already leaves out every point of the stretch. */
  readonly alreadyOutside?: boolean;
  readonly findings: readonly EdgeFinding[];
  /** Context that is no reason to trim on its own. */
  readonly notes: readonly string[];
}

export interface DataRangeReading {
  readonly extent: { readonly min: number; readonly max: number };
  readonly low: DataEnd;
  readonly high: DataEnd;
  /** The window to fit, or null to keep the current one. */
  readonly proposed: { readonly min: number; readonly max: number } | null;
  /** Single-point spikes and runs of missing points inside the pattern: no window leaves these out. */
  readonly interior: readonly string[];
  /** Whether the fit's residual was read too (only on a converged refinement). */
  readonly basis: "the data" | "the data and the fit's residual";
}

/** A step at an edge: the two-level model beats a straight line through the stretch by this Δχ²… */
const STEP_CHI2 = 25;
/** …and the level changes by at least this fraction. */
const STEP_REL = 0.15;
/**
 * Data scatter about a smooth level above the counting σ (excess variance per
 * point) below which no Bragg signal is left: this, or what noise alone gives
 * a block of that size (2.5 standard deviations of χ²/ν), whichever is larger.
 */
const FADED_EXCESS = 0.1;
/** A peak: three neighbouring points averaging this many σ above the local level. */
const PEAK_SIGMA = 5;
/** The residual's run at an end is evidence above this significance (Σz/√n). */
const RESIDUAL_RUN = 6;
/** The window starts this many line widths short of the first reflection (and at least 1 % of the axis). */
const MARGIN_WIDTHS = 3;
/** A cut dropping more than this fraction of the points is the user's call. */
export { LARGE_CUT };

export function inspectDataRange(input: DataRangeInput): DataRangeReading {
  const { x, yObs, sigma } = input;
  const n = x.length;
  if (n < 60) throw new Error(`a pattern of ${n} points is too short to read its ends`);
  const valid = x.map((_, i) => !input.excluded?.[i] && Number.isFinite(yObs[i]) && sigma[i]! > 0);
  const reflections = [...input.reflections].filter(Number.isFinite).sort((a, b) => a - b);
  const bragg = input.yCalc ? braggPart(input.yCalc, input.yBackground) : null;
  const residual = input.fitted && input.yCalc ? yObs.map((y, i) => (valid[i] ? (y - input.yCalc![i]!) / sigma[i]! : NaN)) : null;

  // Line widths (points) at each end, from the calculated peaks.
  const maxima = bragg ? peakMaxima(bragg) : [];
  const fallbackWidth = medianOf(maxima.slice(0, 25).map((m) => m.width)) ?? Math.max(3, Math.round(n / 400));
  const widthAt = (end: End): number => {
    const near = maxima.filter((m) => (end === "low" ? m.i < 0.3 * n : m.i > 0.7 * n)).slice(0, 7);
    return Math.max(3, Math.min(Math.round(n / 40), medianOf(near.map((m) => m.width)) ?? fallbackWidth));
  };
  const relSigma = yObs.map((y, i) => (valid[i] ? sigma[i]! / Math.sqrt(Math.max(y, 1)) : NaN));
  const midRel = quantile(relSigma.slice(Math.floor(0.25 * n), Math.ceil(0.75 * n)).filter(Number.isFinite), 0.5);

  const readEnd = (end: End): DataEnd => {
    const w = widthAt(end);
    const h = Math.max(4, Math.round(1.5 * w));
    const at = (k: number): number => (end === "low" ? k : n - 1 - k);
    const pos = (k: number): number => x[at(k)]!;
    const localStep = Math.abs(pos(Math.min(n - 1, 10)) - pos(0)) / 10;
    const mE = Math.min(Math.round(0.25 * n), Math.max(Math.round(0.06 * n), 4 * h));
    const mR = Math.min(Math.round(0.35 * n), Math.max(Math.round(0.12 * n), 6 * h));
    const findings: EdgeFinding[] = [];
    const notes: string[] = [];
    const add = (cause: EdgeCause, last: number, detail: string): void => {
      findings.push({ cause, from: pos(0), to: pos(last), points: last + 1, detail });
    };

    // No counts at the very end.
    let dead = 0;
    while (dead < mE && (!valid[at(dead)] || yObs[at(dead)]! <= 0)) dead++;
    if (dead >= 3) add("no-counts", dead - 1, `${dead} points with no counts`);

    // A step: the counts jump up near the end and stay there, flat, to the
    // last point — a detector's or a scan's edge. Two levels must fit far
    // better than a straight line, and the outer level must be flat, so a
    // line at the edge (it rises and falls) or a smooth climb is no step.
    {
      let best: { j: number; gain: number; after: number; before: number } | null = null;
      const reach = Math.max(20, 3 * w);
      for (let j = Math.max(3, dead); j <= reach && 3 * j < n; j++) {
        const L = Math.max(12, 2 * j);
        const outer: number[] = [];
        const near: number[] = [];
        for (let k = 0; k < j; k++) if (valid[at(k)]) outer.push(at(k));
        for (let k = j; k < j + L; k++) if (valid[at(k)]) near.push(at(k));
        if (outer.length < 3 || near.length < 8) continue;
        const a = quantile(outer.map((i) => yObs[i]!), 0.5);
        const b = quantile(near.map((i) => yObs[i]!), 0.5);
        // The level just inside is the background's: a line's points there are left out.
        const inner = near.filter((i) => yObs[i]! - b < 5 * sigma[i]!);
        if (inner.length < 6) continue;
        if (!(a - b > STEP_REL * Math.max(b, 1))) continue;
        if (quantile(outer.map((i) => yObs[i]!), 0.25) <= b) continue;
        const flat = outer.reduce((acc, i) => acc + ((yObs[i]! - a) / sigma[i]!) ** 2, 0) / Math.max(1, outer.length - 1);
        if (flat > 2) continue;
        const chiLevels = [...outer.map((i) => ((yObs[i]! - a) / sigma[i]!) ** 2), ...inner.map((i) => ((yObs[i]! - b) / sigma[i]!) ** 2)].reduce((acc, v) => acc + v, 0);
        const all = [...outer, ...inner].map((i) => ({ x: x[i]!, e: yObs[i]!, s: sigma[i]! }));
        const ln = weightedLine(all);
        const chiLine = all.reduce((acc, pt) => acc + ((pt.e - (ln.a + ln.b * pt.x)) / pt.s) ** 2, 0);
        const gain = chiLine - chiLevels;
        if (gain > STEP_CHI2 && (!best || gain > best.gain)) best = { j, gain, after: a, before: b };
      }
      if (best) {
        add("step", best.j - 1, `the counts step up to ${best.after.toFixed(0)} from ${best.before.toFixed(0)} just inside and stay there, flat, to the last point (two levels fit ${best.gain.toFixed(0)} in χ² better than a smooth line): a detector's or a scan's edge`);
      }
    }

    // Below the first reflection (the long-d end): background only, unless the data hold peaks there.
    if (end !== input.shortD) {
      const first = end === "low" ? reflections.find((r) => r >= x[0]!) : [...reflections].reverse().find((r) => r <= x[n - 1]!);
      const margin = Math.max(MARGIN_WIDTHS * w * localStep, 0.01 * Math.abs(x[n - 1]! - x[0]!));
      const edge = first === undefined ? undefined : end === "low" ? first - margin : first + margin;
      let k = 0;
      while (edge !== undefined && k < n && (end === "low" ? pos(k) < edge : pos(k) > edge)) k++;
      if (edge !== undefined && k >= 2 * h) {
        const blocks = blockSignal(x, yObs, sigma, valid, at, 0, k, Math.max(30, 6 * w));
        const peaks = blocks.flatMap((b) => b.peaks).sort((a, b) => b.sigmas - a.sigmas);
        const strongest = peaks[0];
        if (!strongest) {
          add("background-only", k - 1, `no reflection of any phase and no peak in the data: background only, up to ${fmtNum(margin, localStep)} short of the first reflection, at ${fmt(first!, localStep)}`);
        } else {
          notes.push(`no reflection of any phase over ${span(pos(0), pos(k - 1), localStep)}, but the data hold ${peaks.length} peak${peaks.length === 1 ? "" : "s"} there (the strongest ${strongest.sigmas.toFixed(0)}σ at ${fmt(strongest.x, localStep)}) that no phase explains: another phase, or magnetic order on neutron data — keep it in the window and find out what it is`);
        }
      }
    }

    // The short-d end: where no peak stands out of the noise any more.
    if (end === input.shortD) {
      const reach = Math.min(Math.round(0.4 * n), mE + mR);
      const blocks = blockSignal(x, yObs, sigma, valid, at, 0, reach, Math.max(30, 6 * w));
      let faded = 0;
      let quiet = 0;
      for (const b of blocks) {
        if (b.excess >= Math.max(FADED_EXCESS, 2.5 * Math.sqrt(2 / Math.max(1, b.points - 3))) || b.peaks.length > 0) break;
        faded = b.end;
        quiet++;
      }
      if (quiet >= 2) {
        const scatter = Math.max(...blocks.slice(0, quiet).map((b) => b.excess));
        add("faded-peaks", faded - 1, `no peak stands out of the noise: the data scatter about a smooth level by at most ${Math.sqrt(1 + scatter).toFixed(2)}× the counting σ — the reflections there have faded into it`);
      }
    }

    // The fit's residual: a run of one sign at the end, beyond any stretch of that length next to it.
    if (residual) {
      let best = { k: -1, t: 0, mean: 0 };
      let sum = 0;
      let count = 0;
      for (let k = 0; k < mE; k++) {
        const z = residual[at(k)]!;
        if (!Number.isFinite(z)) continue;
        sum += z;
        count++;
        const t = Math.abs(sum) / Math.sqrt(count);
        if (count >= h && t > best.t) best = { k, t, mean: sum / count };
      }
      if (best.k >= 0) {
        const block = Math.max(h, best.k + 1);
        const means: number[] = [];
        for (let k0 = mE; k0 + block <= Math.min(n, mE + mR); k0 += block) {
          const zs: number[] = [];
          for (let k = k0; k < k0 + block; k++) if (Number.isFinite(residual[at(k)])) zs.push(residual[at(k)]!);
          if (zs.length) means.push(Math.abs(zs.reduce((a, v) => a + v, 0) / zs.length));
        }
        const q90 = means.length >= 3 ? quantile(means, 0.9) : Infinity;
        if (best.t > RESIDUAL_RUN && Math.abs(best.mean) > Math.max(1.5, 1.25 * q90)) {
          add("residual", best.k, `the fit leaves the data ${best.mean > 0 ? "above" : "below"} the model by ${Math.abs(best.mean).toFixed(1)}σ on average, more than any stretch of that length just inside (at most ${q90.toFixed(1)}σ)`);
        }
      }
    }

    // The data end on a line's flank, its top beyond the data: the window ends in the gap before it.
    {
      const edgeX = pos(0);
      const cutLine = reflections.find((r) => (end === "low" ? r < edgeX + 0.5 * w * localStep && r > edgeX - w * localStep : r > edgeX - 0.5 * w * localStep && r < edgeX + w * localStep));
      if (cutLine !== undefined) {
        let k = 0;
        while (k < n / 4 && Math.abs(pos(k) - cutLine) < 1.5 * w * localStep) k++;
        add("line-at-edge", Math.max(0, k - 1), `the data end on the flank of a reflection at ${fmt(cutLine, localStep)}, its top at or beyond the last point`);
      }
    }

    // Context: the counting σ.
    if (midRel > 0) {
      let k = 0;
      while (k < mE && (!Number.isFinite(relSigma[at(k)]) || relSigma[at(k)]! >= 1.8 * midRel)) k++;
      if (k >= h) {
        const r = quantile(Array.from({ length: k }, (_, j) => relSigma[at(j)]!).filter(Number.isFinite), 0.5) / midRel;
        notes.push(`${span(pos(0), pos(k - 1), localStep)} is counted with ${r.toFixed(1)}× the middle's relative σ (fewer detectors, or a weaker incident flux): its points weigh about ${Math.round(r * r)}× less in the fit`);
      }
    }

    if (findings.length === 0) return { end, verdict: "keep", findings, notes };

    // The cut: inside every finding, in a gap — the point within two line
    // widths inward farthest from any reflection (lower calculated intensity
    // breaks a tie), so the window's edge cuts no line. A background-only
    // stretch already ends a margin short of the first reflection.
    const innermost = Math.max(...findings.map((f) => f.points - 1));
    const onlyBackground = findings.every((f) => f.cause === "background-only" || f.cause === "no-counts");
    let pick = Math.min(n - 2, innermost + 1);
    if (!onlyBackground) {
      const lo = pick;
      const hi = Math.min(n - 2, lo + 2 * w);
      let bestScore = -Infinity;
      for (let k = lo; k <= hi; k++) {
        const v = pos(k);
        const dist = reflections.length ? nearest(reflections, v) / (w * localStep) : 0;
        const score = Math.min(dist, 3) - (bragg ? 1e-9 * Math.abs(bragg[at(k)]!) : 0) - 1e-6 * (k - lo);
        if (score > bestScore) {
          bestScore = score;
          pick = k;
        }
      }
    }
    const cut = pos(pick);
    const large = pick > LARGE_CUT * n;
    // A window that already leaves out every flagged point needs no new cut
    // (a refined cell moves the gaps a little; a tenth of a degree is no change).
    const w0 = input.window;
    const flagged = pos(innermost);
    const alreadyOutside = !!w0 && (end === "low" ? w0.min > flagged : w0.max < flagged);
    return {
      end,
      verdict: alreadyOutside ? "keep" : "trim",
      cut,
      dropped: pick,
      ...(large ? { large } : {}),
      ...(alreadyOutside ? { alreadyOutside } : {}),
      findings,
      notes,
    };
  };

  const low = readEnd("low");
  const high = readEnd("high");
  const window = input.window ?? { min: x[0]!, max: x[n - 1]! };
  let proposed: { min: number; max: number } | null = low.verdict === "trim" || high.verdict === "trim"
    ? { min: low.verdict === "trim" ? low.cut! : window.min, max: high.verdict === "trim" ? high.cut! : window.max }
    : null;
  // An end trimmed past the far end of the current window: the window held only
  // what is trimmed, so the far end opens to the data's own. Two trims that
  // cross leave nothing to propose.
  if (proposed && proposed.min >= proposed.max) {
    proposed = low.verdict === "trim" && high.verdict !== "trim" ? { min: proposed.min, max: x[n - 1]! }
      : high.verdict === "trim" && low.verdict !== "trim" ? { min: x[0]!, max: proposed.max }
      : null;
  }
  return {
    extent: { min: x[0]!, max: x[n - 1]! },
    low,
    high,
    proposed,
    interior: interiorFindings(x, yObs, sigma, valid, reflections, Math.max(2, fallbackWidth)),
    basis: residual ? "the data and the fit's residual" : "the data",
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

/** The calculated peaks without their background (or without the curve's own floor). */
function braggPart(yCalc: readonly number[], yBackground: readonly number[] | undefined): number[] {
  if (yBackground && yBackground.length === yCalc.length) return yCalc.map((y, i) => Math.max(0, y - yBackground[i]!));
  const floor = runningMin(yCalc, 60);
  return yCalc.map((y, i) => Math.max(0, y - floor[i]!));
}

/** Gaussian elimination with partial pivoting; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const m = b.length;
  const M = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (!(Math.abs(M[p]![c]!) > 1e-300)) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = c + 1; r < m; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= m; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const out = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let s = M[r]![m]!;
    for (let k = r + 1; k < m; k++) s -= M[r]![k]! * out[k]!;
    out[r] = s / M[r]![r]!;
  }
  return out.every(Number.isFinite) ? out : null;
}

/**
 * Per block of `size` points from an end inward (k0 … k1): how much the data
 * scatter about a smooth level (a quadratic through the block) beyond the
 * counting σ — the excess variance per point, 0 for noise alone — and the
 * peaks standing PEAK_SIGMA above that level.
 */
function blockSignal(
  x: readonly number[], y: readonly number[], sigma: readonly number[], valid: readonly boolean[],
  at: (k: number) => number, k0: number, k1: number, size: number,
): { start: number; end: number; points: number; excess: number; peaks: { x: number; sigmas: number }[] }[] {
  const out: { start: number; end: number; points: number; excess: number; peaks: { x: number; sigmas: number }[] }[] = [];
  for (let s = k0; s + Math.min(size, 15) <= k1; s += size) {
    const e = Math.min(k1, s + size);
    const pts: { x: number; y: number; s: number }[] = [];
    for (let k = s; k < e; k++) if (valid[at(k)]) pts.push({ x: x[at(k)]!, y: y[at(k)]!, s: sigma[at(k)]! });
    if (pts.length < 8) continue;
    const q = quadratic(pts);
    const z = pts.map((p) => (p.y - (q.a + q.b * p.x + q.c * p.x * p.x)) / p.s);
    const chi = z.reduce((acc, v) => acc + v * v, 0) / Math.max(1, pts.length - 3);
    // Peaks: three neighbouring points averaging PEAK_SIGMA above the level;
    // maxima a few points apart are one peak (noise splits a top).
    const peaks: { x: number; sigmas: number; i: number }[] = [];
    for (let i = 1; i < z.length - 1; i++) {
      const m = (z[i - 1]! + z[i]! + z[i + 1]!) / Math.sqrt(3);
      if (!(m > PEAK_SIGMA && z[i]! >= z[i - 1]! && z[i]! >= z[i + 1]!)) continue;
      const last = peaks[peaks.length - 1];
      if (last && i - last.i <= 4) {
        if (m > last.sigmas) peaks[peaks.length - 1] = { x: pts[i]!.x, sigmas: m, i };
      } else peaks.push({ x: pts[i]!.x, sigmas: m, i });
    }
    out.push({ start: s, end: e, points: pts.length, excess: Math.max(0, chi - 1), peaks: peaks.map(({ x: px, sigmas }) => ({ x: px, sigmas })) });
  }
  return out;
}

/** A weighted quadratic through the points (by σ), refitted once without the points far above it. */
function quadratic(pts: readonly { x: number; y: number; s: number }[]): { a: number; b: number; c: number } {
  const x0 = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const fit = (ps: readonly { x: number; y: number; s: number }[]): { a: number; b: number; c: number } | null => {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const B = [0, 0, 0];
    for (const p of ps) {
      const u = p.x - x0;
      const r = [1, u, u * u];
      const wt = 1 / (p.s * p.s);
      for (let i = 0; i < 3; i++) {
        B[i]! += wt * r[i]! * p.y;
        for (let j = 0; j < 3; j++) A[i]![j]! += wt * r[i]! * r[j]!;
      }
    }
    const c = solve(A, B);
    if (!c) return null;
    // Back to the raw axis: a + b(x−x0) + c(x−x0)².
    return { a: c[0]! - c[1]! * x0 + c[2]! * x0 * x0, b: c[1]! - 2 * c[2]! * x0, c: c[2]! };
  };
  const first = fit(pts) ?? { a: pts.reduce((s, p) => s + p.y, 0) / pts.length, b: 0, c: 0 };
  // A peak pulls the level up; refit without what stands far above it, so the
  // level is the background's and the peak shows as excess.
  const kept = pts.filter((p) => (p.y - (first.a + first.b * p.x + first.c * p.x * p.x)) / p.s <= 3);
  return (kept.length >= 8 ? fit(kept) : null) ?? first;
}

/** The calculated curve's local maxima, strongest first, with each one's FWHM in points. */
function peakMaxima(y: readonly number[]): { i: number; height: number; width: number }[] {
  const n = y.length;
  const out: { i: number; height: number; width: number }[] = [];
  for (let i = 2; i < n - 2; i++) {
    const v = y[i]!;
    if (!(v > y[i - 1]! && v >= y[i + 1]! && v > y[i - 2]! && v >= y[i + 2]!)) continue;
    let base = v;
    for (let j = Math.max(0, i - 60); j <= Math.min(n - 1, i + 60); j++) base = Math.min(base, y[j]!);
    const half = base + (v - base) / 2;
    let l = i;
    while (l > 0 && y[l]! > half) l--;
    let r = i;
    while (r < n - 1 && y[r]! > half) r++;
    if (l > 0 && r < n - 1 && v - base > 0) out.push({ i, height: v - base, width: r - l });
  }
  return out.sort((a, b) => b.height - a.height);
}

function runningMin(y: readonly number[], h: number): number[] {
  return y.map((_, i) => {
    let m = Infinity;
    for (let j = Math.max(0, i - h); j <= Math.min(y.length - 1, i + h); j++) m = Math.min(m, y[j]!);
    return m;
  });
}

/** Single-point spikes (far above both neighbours, away from any reflection) and runs of missing points. */
function interiorFindings(x: readonly number[], y: readonly number[], sigma: readonly number[], valid: readonly boolean[], reflections: readonly number[], width: number): string[] {
  const n = x.length;
  const out: string[] = [];
  const spikes: number[] = [];
  for (let i = 3; i < n - 3; i++) {
    if (!valid[i] || !valid[i - 1] || !valid[i + 1]) continue;
    const local = Math.abs(x[i + 1]! - x[i - 1]!) / 2;
    if (reflections.length && nearest(reflections, x[i]!) < 2 * width * local) continue;
    const around = [y[i - 3]!, y[i - 2]!, y[i + 2]!, y[i + 3]!].sort((a, b) => a - b);
    const med = (around[1]! + around[2]!) / 2;
    if (y[i]! - Math.max(y[i - 1]!, y[i + 1]!) > 8 * sigma[i]! && y[i]! - med > 8 * sigma[i]!) spikes.push(i);
  }
  const step = Math.abs(x[n - 1]! - x[0]!) / (n - 1);
  if (spikes.length) out.push(`${spikes.length} single-point spike${spikes.length === 1 ? "" : "s"}, away from any reflection, at ${spikes.slice(0, 5).map((i) => fmt(x[i]!, step)).join(", ")}${spikes.length > 5 ? ", …" : ""}`);
  let i = 1;
  while (i < n - 1) {
    if (valid[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n - 1 && !valid[j]) j++;
    if (j - i >= 3) out.push(`${j - i} points with no data at ${fmt(x[i]!, step)}–${fmt(x[j - 1]!, step)}`);
    i = j + 1;
  }
  return out;
}

function nearest(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid;
    else hi = mid;
  }
  return Math.min(Math.abs(sorted[lo]! - v), Math.abs(sorted[hi]! - v));
}

function medianOf(values: readonly number[]): number | null {
  return values.length >= 3 ? quantile(values, 0.5) : null;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** A line through the points, weighted by σ. */
function weightedLine(pts: readonly { x: number; e: number; s: number }[]): { a: number; b: number } {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    const wt = 1 / (p.s * p.s);
    sw += wt;
    sx += wt * p.x;
    sy += wt * p.e;
    sxx += wt * p.x * p.x;
    sxy += wt * p.x * p.e;
  }
  const det = sw * sxx - sx * sx;
  const b = det !== 0 ? (sw * sxy - sx * sy) / det : 0;
  return { a: (sy - b * sx) / sw, b };
}

/** A length on the axis at its precision. */
function fmtNum(v: number, step: number): string {
  return fmt(Math.abs(v), step);
}

/** A position at the axis' precision. */
export function fmt(v: number, step: number): string {
  const decimals = Math.max(0, Math.min(4, Math.ceil(-Math.log10(Math.abs(step) || 1))));
  return v.toFixed(decimals);
}

function span(a: number, b: number, step: number): string {
  return `${fmt(Math.min(a, b), step)}–${fmt(Math.max(a, b), step)}`;
}
