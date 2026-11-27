/**
 * The notice a structure file's load shows when sites were placed exactly on
 * their special positions (specialPositions.ts): which, and by how much. A
 * user-facing line only; nothing the Agent reads.
 */
import type { SiteSnap } from "@/core/crystal/specialPositions";

/** How many sites the line names before "and N more". */
const LISTED = 6;

const angstrom = (d: number): string => (d >= 0.001 ? d.toFixed(4) : d.toPrecision(2));

/** The line, or null when no site moved. */
export function snapNote(snapped: readonly SiteSnap[], file?: string): string | null {
  if (snapped.length === 0) return null;
  const n = snapped.length;
  const listed = snapped.slice(0, LISTED).map((s, i) => `${s.label} ${i === 0 ? "moved " : ""}${angstrom(s.shiftAngstrom)} Å`);
  const more = n > LISTED ? `, and ${n - LISTED} more` : "";
  return `Placed ${n === 1 ? "1 site" : `${n} sites`} exactly on ${n === 1 ? "its special position" : "their special positions"} (${file ? `${file} rounds` : "the file rounds"} ${n === 1 ? "it" : "them"}): ${listed.join(", ")}${more}.`;
}
