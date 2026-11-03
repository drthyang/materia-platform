/**
 * What the PDF page's Structure card names: the structure the page fits. At
 * the loaded structure's own symmetry that is the loaded structure; once a
 * subgroup or supercell child is in force (activated on the Subgroups tab, or
 * a mode CIF whose parent is the loaded structure) it is the child, with a
 * note naming the parent it came from. ✕ clear (or Positions back on
 * "Constrained atomic", which sets the child aside) returns the card to the
 * parent. UI only: nothing here is read by the Agent.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { ModesInForce } from "@/app/pdfPage";
import type { DistortionModeSet } from "@/core/crystal/distortionModes";

export interface StructureCardText {
  readonly title: string;
  readonly meta: string;
  /** "child of SrTiO3 · P m -3 m" while a child is fitted; null at the parent. */
  readonly childOf: string | null;
}

const titleOf = (s: StructureModel): string => `${s.name || "structure"} · ${s.spaceGroup.hermannMauguin ?? "—"}`;
const metaOf = (s: StructureModel): string =>
  `a ${s.cell.a.toFixed(4)} · b ${s.cell.b.toFixed(4)} · c ${s.cell.c.toFixed(4)} Å · ${s.sites.length} site${s.sites.length === 1 ? "" : "s"}`;

/**
 * The card's lines for `loaded`, the page's mode set in force (`modes`), the
 * set the fit uses now (`modeSet`, pageView) and the structure it fits
 * (`fitStructure`, pageView). A child is in force when the set the fit uses is
 * an activated one: a decomposition against a parent CIF leaves the loaded
 * structure as the one fitted, and so does a child set aside.
 */
export function structureCardText(loaded: StructureModel, modes: ModesInForce | null, modeSet: DistortionModeSet | null, fitStructure: StructureModel): StructureCardText {
  const child = modes?.fromActivation === true && modeSet !== null && modeSet === modes.set;
  if (!child) return { title: titleOf(loaded), meta: metaOf(loaded), childOf: null };
  return { title: titleOf(fitStructure), meta: metaOf(fitStructure), childOf: `child of ${titleOf(loaded)}` };
}
