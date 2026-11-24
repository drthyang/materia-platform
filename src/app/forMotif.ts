/**
 * Export ▾ → "For a MOTIF figure…": the one standard file that fits the page's
 * state, for MOTIF (the author's separate app for publication-quality crystal
 * figures, which reads CIF, mCIF and ISODISTORT mode CIFs). No new format: the
 * entry calls the page's existing exporters.
 *
 *  - a subgroup child with modes by parent irrep is in force → the ISODISTORT
 *    mode CIF (core/export/modeCif.ts), so the displacements can be drawn;
 *  - else a magnetic model with moments is on → the mCIF
 *    (magneticStructureToMcif: the magnetic cell for k ≠ 0);
 *  - else → the refined CIF (structureToCif).
 *
 * Both a subgroup child and a magnetic model: no one standard file holds the
 * modes and the moments together, so the mCIF is written (the distorted child's
 * atoms and its moments) and the help says the mode arrows are left out.
 */

export type MotifFileKind = "cif" | "mcif" | "modeCif";

export interface MotifPageState {
  /** A magnetic model with at least one moment is on the page, and the page can write its mCIF. */
  readonly magnetic: boolean;
  /** A subgroup child is in force whose mode set exports as a mode CIF. */
  readonly modeChild: boolean;
  /** Phases on the page (the entry writes the first; absent ⇒ 1). */
  readonly phases?: number;
  /** A magnetic model is on but this page has no mCIF exporter (single crystal): the moments are left out. */
  readonly momentsNotExported?: boolean;
  /** The magnetic model's k is incommensurate: the mCIF holds the parent cell with the cosine amplitudes only. */
  readonly incommensurate?: boolean;
}

export interface MotifChoice {
  readonly kind: MotifFileKind;
  /** The "?" line: which file, and that MOTIF opens it for a figure; what is left out, when anything is. */
  readonly help: string;
}

const OPENS = "MOTIF opens it for a publication figure";

/** The file the entry writes for this state, and its one-line help. */
export function motifChoice(s: MotifPageState): MotifChoice {
  const extra: string[] = [];
  if ((s.phases ?? 1) > 1) extra.push("first phase only");
  if (s.modeChild && !s.magnetic) {
    return { kind: "modeCif", help: line("the ISODISTORT mode CIF of the subgroup child (atoms and mode displacements)", extra) };
  }
  if (s.magnetic) {
    if (s.modeChild) extra.push("the mode displacements are left out (no one standard file holds modes and moments)");
    if (s.incommensurate) extra.push("the modulation is left out: k is incommensurate, so the parent cell holds the cosine amplitudes");
    return { kind: "mcif", help: line("the mCIF (magnetic space group; the magnetic cell for k ≠ 0)", extra) };
  }
  if (s.momentsNotExported) extra.push("the moments are left out (this page writes no mCIF)");
  return { kind: "cif", help: line("the refined CIF", extra) };
}

function line(what: string, extra: readonly string[]): string {
  return `Writes ${what}; ${OPENS}.${extra.length > 0 ? ` ${capital(extra.join("; "))}.` : ""}`;
}

const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** The entry's label in the Export menu. */
export const FOR_MOTIF_LABEL = "For a MOTIF figure…";
