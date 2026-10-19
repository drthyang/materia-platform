/**
 * Forbidden reflections that read as a lost centring. A centred model (I, F,
 * C, A, B, R) forbids a whole class of reflections by its lattice alone; when
 * the data hold intensity at several of them, and only reflections of that
 * class, the data's lattice may be primitive where the model's is centred —
 * an ordered arrangement the model averages (two elements sharing one site
 * that order onto two). One or two such reflections can be a stray line
 * landing there; a glide's or a screw axis's absences are a different
 * question (the symmetry review's).
 *
 * Pure: the model's space group and the hkl of the forbidden reflections
 * that carry intensity in, the reading's facts out.
 */

import type { SpaceGroup } from "@/core/crystal/types";
import { centringTranslations, isReciprocalLatticeVector } from "@/core/crystal/symmetry";
import { LOST_CENTRING_MIN } from "@/core/diagnostics/thresholds";

export interface LostCentring {
  /** The model's lattice letter (I, F, C, A, B, R). */
  readonly centring: string;
  /** The class the centring forbids, in words ("h+k+l odd"). */
  readonly condition: string;
  /** How many of the reflections given are of that class (all of them). */
  readonly count: number;
}

const CONDITION: Readonly<Record<string, string>> = {
  I: "h+k+l odd",
  F: "h, k, l of mixed parity",
  C: "h+k odd",
  A: "k+l odd",
  B: "h+l odd",
  R: "−h+k+l not a multiple of 3",
};

/** The reading, or null: a primitive model, too few reflections, or one the centring allows among them. */
export function lostCentring(spaceGroup: SpaceGroup, forbidden: readonly (readonly [number, number, number])[]): LostCentring | null {
  if (forbidden.length < LOST_CENTRING_MIN) return null;
  const centrings = centringTranslations(spaceGroup.operations);
  if (centrings.length === 0) return null;
  if (forbidden.some((hkl) => isReciprocalLatticeVector([hkl[0], hkl[1], hkl[2]], centrings))) return null;
  const letter = (spaceGroup.hermannMauguin ?? "").trim().charAt(0).toUpperCase();
  return { centring: letter in CONDITION ? letter : "centred", condition: CONDITION[letter] ?? "the reflections the centring forbids", count: forbidden.length };
}
