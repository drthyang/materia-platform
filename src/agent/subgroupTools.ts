/**
 * The Agent's subgroup tools on the PDF page: list_subgroups, lower_symmetry
 * and clear_subgroup — the Subgroups view's list, its Activate and its ✕
 * clear, through the page's port (PdfAgentPort.subgroups). The rows, their
 * merging, filters and default variant, and the activation are the view's own
 * (app/pdfSubgroups.ts), so the row the Agent lowers to gives the child the
 * view's Activate gives, recorded as the same History step.
 */

import type { PdfAgentPort, PdfLiveState, PdfSubgroupsHandle } from "@/agent/port";
import { change, nothing } from "@/agent/pages/plans";
import type { Plan } from "@/agent/pages/types";
import type { InputOf } from "@/agent/tools";
import type { ModesInForce } from "@/app/pdfPage";
import { boundName, boundOr, cellKey, parseBound, parseRowId, queryGroups, rowId, type SubgroupListing } from "@/app/pdfSubgroups";
import { DEFAULT_FILTERS, collapseTies, compactName, groupRows, rowPasses, shortLabel, type RowGroup } from "@/app/ui/subgroupList";
import type { SubgroupRow } from "@/app/ui/subgroupPicker";
import { modesCellNote } from "@/app/ui/SubgroupsPanel";
import type { StructureModel } from "@/core/crystal/types";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import { CONVENTIONAL_CELL } from "@/core/crystal/irreps/supercell";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";

/** Rows per page of list_subgroups, by default. */
const PAGE_SIZE = 20;
/** The most candidates lower_symmetry lists. */
const MAX_CANDIDATES = 12;
/** The same-cell rows hold in any bound: the conventional cell's is the quickest to list. */
const SAME_CELL_BOUND: SupercellSpec = { P: CONVENTIONAL_CELL, centring: "P" };

/** A structure's group as the view's list names it: "F-43m #216". */
const groupName = (s: StructureModel): string => compactName(`${s.spaceGroup.hermannMauguin ?? "?"}${s.spaceGroup.number !== undefined ? ` #${s.spaceGroup.number}` : ""}`);

/** What is in force, as the view's banner says it: "lowered to P -4 21 m #113 · in its own cell, 1×1×2". */
export const inForceLine = (modes: ModesInForce): string => `${modes.fromActivation ? "lowered to" : "decomposed against"} ${modes.parentName}${modesCellNote(modes)}`;

/** The page's Subgroups view, or why the subgroups cannot be listed here. */
function viewOf(s: PdfLiveState, port: PdfAgentPort): PdfSubgroupsHandle {
  if (s.phases.length > 1) throw new Error("the subgroups are those of one structure, and this G(r) is fitted with several phases");
  if (!port.subgroups) throw new Error("this page has no Subgroups view");
  return port.subgroups;
}

function boundFrom(text: string): SupercellSpec {
  const bound = parseBound(text);
  if (!bound) throw new Error(`"${text}" is no supercell: give a box such as "1×1×2", or P as "2 0 0; 0 2 0; 0 0 2"`);
  return bound;
}

/**
 * The bound list_subgroups and lower_symmetry by name look in, the same for
 * both (so a name finds the rows, and the ids, the list gave): the call's
 * own, else the box its `cell` names (the conventional cell for "same
 * cell"), else the view's (2×2×2 by default).
 */
function queryBound(input: { readonly bound?: string | undefined; readonly cell?: string | undefined }, view: PdfSubgroupsHandle): SupercellSpec {
  if (input.bound !== undefined) return boundFrom(input.bound);
  if (input.cell !== undefined) {
    const cell = cellKey(input.cell);
    if (cell === "same cell") return SAME_CELL_BOUND;
    const box = parseBound(cell);
    if (box) return box;
  }
  return boundOr(view.bound());
}

/** The irreps a row's Activate kicks, with their directions: "X irrep 5 (0,0,a,-a,-a,a) + W irrep 1 (a,0,0,a,0,0)". */
function irrepsOf(row: SubgroupRow): string {
  const set = collapseTies(row.reach.sets)[0];
  if (!set) return row.irreps;
  return set.members.map((alts) => `${shortLabel(alts[0]!)}${alts.length > 1 ? ` or ${alts.slice(1).map((x) => x.number).join(" or ")}` : ""} ${alts[0]!.direction}`).join(" + ");
}

/** One row as the model reads it. */
function rowFacts(row: SubgroupRow, bound: SupercellSpec): Record<string, unknown> {
  return {
    id: rowId(row, bound),
    name: compactName(row.name),
    cell: row.cell,
    domains: row.domains,
    irreps: irrepsOf(row),
    ...(row.reach.kind === "coupled" ? { coupled: true } : {}),
    modes: row.modes,
    ...(row.modes === 0 ? { strainOnly: true } : {}),
    ...(row.maximal ? { maximal: true } : {}),
  };
}

/** The larger cells' state, when it is not done. */
function listingNote(listing: SubgroupListing): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (listing.larger.state === "listing") out.listing = `still working out the larger cells (${listing.larger.percent} %): the same-cell rows and any larger ones so far; call again shortly`;
  if (listing.larger.state === "error") out.larger = `not listed: ${listing.larger.message}`;
  if (listing.sameCellError) out.sameCell = `not listed: ${listing.sameCellError}`;
  return out;
}

/** list_subgroups: the view's list for the query, a page of it. */
export async function listSubgroupsView(input: InputOf<"list_subgroups">, s: PdfLiveState, port: PdfAgentPort): Promise<Record<string, unknown>> {
  const view = viewOf(s, port);
  const bound = queryBound(input, view);
  const listing = await view.list(bound);
  const groups = queryGroups(listing.rows, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.k !== undefined ? { k: input.k } : {}),
    ...(input.cell !== undefined ? { cell: input.cell } : {}),
    ...(input.all ? { all: true } : {}),
  });
  const offset = input.offset ?? 0;
  const shown = groups.slice(offset, offset + (input.limit ?? PAGE_SIZE));
  const left = groups.length - offset - shown.length;
  return {
    parent: groupName(s.loaded),
    bound: boundName(bound),
    ...listingNote(listing),
    ...(s.modes ? { inForce: `${inForceLine(s.modes)}: these are the parent's subgroups; clear_subgroup before lowering another way` } : {}),
    count: groups.length,
    rows: shown.map((g) => ({ ...rowFacts(g.shown[0]!, bound), ...(g.group.variants.length > 1 ? { variants: g.group.variants.length } : {}) })),
    ...(left > 0 ? { more: `${left} more: offset ${offset + shown.length}` } : {}),
    ...(groups.length === 0 && !input.all ? { note: "None here; `all: true` adds the strain-only rows and those only three or more coupled irreps reach." } : {}),
  };
}

/** A variant of a merged row: the row, its group and its number in the view's detail (1 is listed first). */
interface Variant {
  readonly row: SubgroupRow;
  readonly group: RowGroup;
  readonly number: number;
}

/** A merged row's default variant, the view's: the first its filters keep (the #153 order puts a rigid-unit one first), else its first. */
const defaultOf = (group: RowGroup): SubgroupRow => group.variants.find((r) => rowPasses(r, DEFAULT_FILTERS)) ?? group.variants[0]!;

/** Which row a lower_symmetry call names: one variant of one row, or the rows (each at its default) to pick from. */
async function resolve(input: InputOf<"lower_symmetry">, view: PdfSubgroupsHandle): Promise<{ readonly pick: Variant; readonly bound: SupercellSpec } | { readonly candidates: readonly RowGroup[]; readonly bound: SupercellSpec }> {
  const still = (listing: SubgroupListing): string | null =>
    listing.larger.state === "listing" ? `the ${boundName(listing.bound)} cells are still being listed (${listing.larger.percent} %): call again shortly` : null;
  if (input.id !== undefined) {
    const parsed = parseRowId(input.id);
    if (!parsed) throw new Error(`"${input.id}" is no row id: use one list_subgroups gave`);
    const bound = input.bound !== undefined ? boundFrom(input.bound) : parsed.bound ?? SAME_CELL_BOUND;
    const listing = await view.list(bound);
    const row = listing.rows.find((r) => r.key === parsed.key);
    if (!row) throw new Error(still(listing) ?? `no subgroup ${input.id} in the ${boundName(bound)} list: use an id list_subgroups gave`);
    const group = groupRows(listing.rows).find((g) => g.variants.includes(row))!;
    return { pick: { row, group, number: group.variants.indexOf(row) + 1 }, bound };
  }
  if (input.name === undefined) throw new Error("give a row's `id` from list_subgroups, or the subgroup's `name` (with its `cell`)");
  const bound = queryBound(input, view);
  const listing = await view.list(bound);
  const wait = still(listing);
  if (wait) throw new Error(wait);
  const query = { name: input.name, ...(input.cell !== undefined ? { cell: input.cell } : {}) };
  // The rows list_subgroups lists for the name (merged by name, cell and domains); those its filters hide only when it lists none.
  const shown = queryGroups(listing.rows, query);
  const rows = (shown.length > 0 ? shown : queryGroups(listing.rows, { ...query, all: true })).map((g) => g.group);
  const what = `${input.name}${input.cell !== undefined ? ` in ${cellKey(input.cell)}` : ""}`;
  if (rows.length === 0) throw new Error(`no subgroup ${what} fits the ${boundName(bound)} cell: list_subgroups lists them`);
  if (rows.length > 1) return { candidates: rows, bound };
  // One row: its default variant, or the one asked for.
  const group = rows[0]!;
  if (input.variant !== undefined && input.variant > group.variants.length) {
    throw new Error(`${compactName(group.name)} in ${group.cell} has ${group.variants.length} variant${group.variants.length === 1 ? "" : "s"}, not ${input.variant}`);
  }
  const row = input.variant !== undefined ? group.variants[input.variant - 1]! : defaultOf(group);
  return { pick: { row, group, number: group.variants.indexOf(row) + 1 }, bound };
}

/** Which variant of its row a lowering used, and the others' ids: "1 of 4, the default; the others: c47@1×1×2, …". */
function variantLine(v: Variant, bound: SupercellSpec): string | null {
  const n = v.group.variants.length;
  if (n === 1) return null;
  const preferred = defaultOf(v.group);
  const others = v.group.variants.filter((r) => r !== v.row).map((r) => `${rowId(r, bound)}${r === preferred ? " (the default)" : ""}`);
  return `${v.number} of ${n}${v.row === preferred ? ", the default" : ""}; the others: ${others.join(", ")}`;
}

/** lower_symmetry: one row, activated as the view's Activate does (a merged row at its default variant); several rows, the candidates and no change. */
export async function lowerSymmetryPlan(input: InputOf<"lower_symmetry">, s: PdfLiveState, port: PdfAgentPort): Promise<Plan> {
  const view = viewOf(s, port);
  if (s.modes) throw new Error(`a subgroup is in force (${inForceLine(s.modes)}): call clear_subgroup first, then lower again`);
  const found = await resolve(input, view);
  if ("candidates" in found) {
    const candidates = found.candidates.slice(0, MAX_CANDIDATES).map((g) => ({ ...rowFacts(defaultOf(g), found.bound), ...(g.variants.length > 1 ? { variants: g.variants.length } : {}) }));
    return nothing(`${found.candidates.length} subgroups match, in different cells or domains: nothing was changed. Pick one with the user, then call again with its id`, {
      bound: boundName(found.bound),
      count: found.candidates.length,
      candidates,
    });
  }
  const { row } = found.pick;
  const bound = found.bound;
  const name = compactName(row.name);
  if (row.action.kind === "elsewhere") throw new Error(`${name} is not offered on the Subgroups view (${row.action.note})`);
  if (row.modes === 0) throw new Error(`${name} (${row.cell}) is strain only: no atom moves, so there is nothing to refine`);
  const variant = variantLine(found.pick, bound);
  return change(`Lower ${groupName(s.loaded)} to ${name} · ${row.cell} · ${row.domains} domains, from ${irrepsOf(row)}${variant ? `, variant ${found.pick.number} of ${found.pick.group.variants.length}` : ""}`, () => {
    const why = view.activate(row, bound);
    if (why) throw new Error(`nothing was changed: ${why}`);
    return { data: { row: rowId(row, bound), bound: boundName(bound), ...(variant ? { variant } : {}) } };
  });
}

/** clear_subgroup: the view's ✕ clear. */
export function clearSubgroupPlan(s: PdfLiveState, port: PdfAgentPort): Plan {
  if (!s.modes) return nothing("no subgroup is in force: the page is at the loaded structure's own symmetry");
  const view = viewOf(s, port);
  const modes = s.modes;
  return change(`Back to ${groupName(s.loaded)}: drop what is in force (${inForceLine(modes)})`, () => {
    view.clear();
    return undefined;
  });
}

/** The most child sites listed by label; beyond, their count. */
const MAX_SITES = 40;

/** What lower_symmetry and clear_subgroup leave on the page, read after the change. */
export function subgroupOutcome(name: string, s: PdfLiveState): Record<string, unknown> {
  if (name === "clear_subgroup") return s.modes ? {} : { spaceGroup: groupName(s.loaded), positions: s.positionMode === "irreps" ? "symmetry-mode amplitudes (irreps)" : "constrained atomic coordinates" };
  if (name !== "lower_symmetry" || !s.modes) return {};
  const set = s.modes.set;
  const child = s.phases[0]!;
  const free = new Set(s.parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.id));
  const freed = set.modes.filter((m) => free.has(m.id));
  return {
    lowered: {
      to: s.modes.parentName,
      from: groupName(s.loaded),
      cell: modesCellNote(s.modes).replace(/^ · /, "") || "in the parent's cell",
      sites: child.sites.length > MAX_SITES ? child.sites.length : child.sites.map((x) => `${x.label} ${x.element}`),
      atoms: expandStructureAtoms(child).length,
      modes: set.modes.length,
      free: freed.map((m) => `${m.id}: ${m.label}`),
      kicked: [...new Set(freed.map((m) => m.irrep?.label ?? m.label))],
    },
    next: "Refine the free modes with the scale, the cell held (refine names the pairs that correlate at the kick: fix one of each); then free the other mode rows a block at a time.",
  };
}
