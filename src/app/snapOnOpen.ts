/**
 * A saved project's structures read by the rule every structure file is read
 * with (specialPositions.ts): a site the engine reads as special (within 1e-3)
 * is placed on its special position exactly, so a project saved from a
 * rounded CIF before the snap opens on the same geometry as that CIF loaded
 * now. The project stores the structure as JSON and every positional
 * parameter as a shift from the stored position along the site's allowed
 * directions, so a saved fit keeps its meaning on the snapped anchor.
 *
 * One exception: the primary phase of a PDF workspace with a distortion-mode
 * set in force. The set stores its own anchor (the parentized child, saved in
 * full because it cannot be rebuilt from the structure), so that structure is
 * read as saved; the snap would move it off the set's anchor.
 */
import type { StructureModel } from "@/core/crystal/types";
import type { Workspace } from "@/core/project/types";
import { snapToSpecialPositions, type SiteSnap } from "@/core/crystal/specialPositions";

/** The structures with their sites on their exact special positions, and the sites moved (all phases, in order). */
export function snapProjectStructures(structures: readonly StructureModel[], workspace: Workspace): { readonly structures: readonly StructureModel[]; readonly snapped: readonly SiteSnap[] } {
  const snapped: SiteSnap[] = [];
  const out = structures.map((s, i) => {
    if (i === 0 && workspace.technique === "pdf" && workspace.distortionModes) return s;
    const r = snapToSpecialPositions(s);
    snapped.push(...r.snapped);
    return r.structure;
  });
  return snapped.length === 0 ? { structures, snapped } : { structures: out, snapped };
}
