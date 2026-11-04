/**
 * What the Subgroups view works out, kept across mounts and shared with the
 * Agent's subgroup tools (app/pdfSubgroups.ts), so the two list the same rows
 * and work each listing out once: the bound's factor group, a structure's
 * same-cell rows, and the larger cells' rows of a bound.
 */

import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import { sameCellListing, type LatticeCounts, type SubgroupRow } from "@/app/ui/subgroupPicker";
import type { GraphNode } from "@/app/ui/subgroupList";

const boundGroups = new WeakMap<readonly SymmetryOperation[], Map<string, { group: FactorGroup | null; error: string | null }>>();
const boundKey = (bound: SupercellSpec): string => `${bound.P.map((r) => r.map((x) => +x.toFixed(4)).join(" ")).join("; ")}|${bound.centring ?? "P"}`;

/** The bound's factor group G/T″, once per operation list and bound (so the caches keyed by it last). */
export function boundGroup(ops: readonly SymmetryOperation[] | undefined, bound: SupercellSpec): { group: FactorGroup | null; error: string | null } {
  if (!ops || ops.length === 0) return { group: null, error: null };
  let byBound = boundGroups.get(ops);
  if (!byBound) {
    byBound = new Map();
    boundGroups.set(ops, byBound);
  }
  const key = boundKey(bound);
  let hit = byBound.get(key);
  if (!hit) {
    try {
      hit = { group: factorGroup(ops, bound), error: null };
    } catch (e) {
      hit = { group: null, error: e instanceof Error ? e.message : String(e) };
    }
    byBound.set(key, hit);
  }
  return hit;
}

/** The cell-multiplying part: its rows, what the summary says of the lattice and the lattice as a graph, or why there are none. */
export type SupercellPart = { readonly rows: readonly SubgroupRow[]; readonly counts: LatticeCounts; readonly graph: readonly GraphNode[] | null } | { readonly error: string };
const supercellParts = new WeakMap<FactorGroup, WeakMap<object, SupercellPart>>();
const NO_STRUCTURE = {};

/** The larger cells' part kept for this factor group and structure, if it was worked out. */
export const partOf = (group: FactorGroup, structure: StructureModel | undefined): SupercellPart | undefined => supercellParts.get(group)?.get(structure ?? NO_STRUCTURE);

export function keepPart(group: FactorGroup, structure: StructureModel | undefined, part: SupercellPart): void {
  let byStructure = supercellParts.get(group);
  if (!byStructure) {
    byStructure = new WeakMap();
    supercellParts.set(group, byStructure);
  }
  byStructure.set(structure ?? NO_STRUCTURE, part);
}

/**
 * The same-cell rows (sameCellListing), or why there are none. Kept per
 * structure from the parent's own state (the Γ tree there): while a choice is
 * in force the page has no Γ tree, and the rows stay the ones the user picked
 * from.
 */
const sameParts = new WeakMap<object, { readonly rows: readonly SubgroupRow[]; readonly error: string | null }>();
export function sameCellPart(o: Parameters<typeof sameCellListing>[0], pristine: boolean): { readonly rows: readonly SubgroupRow[]; readonly error: string | null } {
  const key = o.structure ?? o.operations;
  const kept = sameParts.get(key);
  if (kept && !pristine) return kept;
  let part: { rows: readonly SubgroupRow[]; error: string | null };
  try {
    part = { rows: sameCellListing(o), error: null };
  } catch (e) {
    part = { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
  if (pristine || !kept) sameParts.set(key, part);
  return part;
}
