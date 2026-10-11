/**
 * The SNS TOPAZ time-of-flight Laue reflection file (ANVRED's output, GSAS-II's
 * "Neutron SNS TOF HKL F2"): per reflection h k l, F² and σ(F²), the scale
 * index of its run (one per crystal orientation), the wavelength it was
 * measured at, the mean path length through the crystal (tbar, cm), the run
 * and sequence numbers, the transmission the absorption correction applied,
 * the detector, 2θ (radians), d (Å) and the detector pixel, in fixed columns
 *
 *   3I4, 2F8.2, I4, 2F8.5, 2I7, F7.4, I4, F9.5, F9.4, 2F7.2
 *
 * The first 32 characters are SHELX's HKLF 4 with a batch number, so a SHELX
 * reader takes the file and drops the rest — every wavelength with it, which
 * the extinction of a Laue measurement depends on. The F² are corrected for
 * the incident spectrum, the Laue Lorentz factor and absorption. The `0 0 0`
 * row ends the data.
 */

import type { SingleCrystalReflection } from "@/core/diffraction/types";

export interface SnsTofParse {
  readonly reflections: SingleCrystalReflection[];
  /** Rows that were not reflections (diagnostic; 0 for a clean file). */
  readonly skipped: number;
  /** The scale indices (runs) present, in order. */
  readonly batches: readonly number[];
}

const HEADER = /^\s*#\s*h\s*,\s*k\s*,\s*l\s*,\s*fosq/i;

/** The fields of one row, by column; null when it is not a full row. */
function fixedRow(line: string): number[] | null {
  const widths = [4, 4, 4, 8, 8, 4, 8, 8, 7, 7, 7, 4, 9, 9];
  if (line.length < widths.reduce((a, b) => a + b, 0)) return null;
  const out: number[] = [];
  let at = 0;
  for (const w of widths) {
    const raw = line.slice(at, at + w).trim();
    at += w;
    const v = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

/** Whitespace split, for a file whose columns were not kept (14 or more numbers). */
function looseRow(line: string): number[] | null {
  const t = line.trim().split(/\s+/).map(Number);
  return t.length >= 14 && t.slice(0, 14).every((v) => Number.isFinite(v)) ? t.slice(0, 14) : null;
}

function plausible(f: readonly number[]): boolean {
  const [h, k, l, , sigma, , wl, tbar, , , transmission, , twoth, dsp] = f as [number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  return [h, k, l].every(Number.isInteger) && sigma >= 0 && wl > 0.1 && wl < 20 && tbar >= 0 && transmission >= 0 && transmission <= 1.0001 && twoth > 0 && twoth <= Math.PI && dsp > 0;
}

/** True for a TOPAZ file: its header, or a first row with a wavelength, 2θ in radians and d where TOPAZ writes them. */
export function looksLikeSnsTofHkl(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines[0] !== undefined && HEADER.test(lines[0])) return true;
  const first = lines.find((l) => !l.trim().startsWith("#"));
  if (!first) return false;
  const f = fixedRow(first) ?? looseRow(first);
  if (!f || !plausible(f)) return false;
  // λ = 2d·sinθ holds row by row: the columns are what they claim.
  const [, , , , , , wl, , , , , , twoth, dsp] = f as number[];
  return Math.abs(2 * dsp! * Math.sin(twoth! / 2) - wl!) < 0.01 * wl!;
}

export function parseSnsTofHkl(text: string): SnsTofParse {
  const reflections: SingleCrystalReflection[] = [];
  const batches: number[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const f = fixedRow(line) ?? looseRow(line);
    if (!f) {
      skipped++;
      continue;
    }
    const [h, k, l, fosq, sigma, scaleId, wl, tbar, , , transmission, , twoth] = f as number[];
    if (h === 0 && k === 0 && l === 0) break;
    if (!plausible(f)) {
      skipped++;
      continue;
    }
    if (!batches.includes(scaleId!)) batches.push(scaleId!);
    reflections.push({
      h: h!, k: k!, l: l!, iObs: fosq!, sigma: sigma!,
      batch: scaleId!, wavelength: wl!, twoTheta: (twoth! * 180) / Math.PI, tbar: tbar!, transmission: transmission!,
    });
  }
  return { reflections, skipped, batches };
}
