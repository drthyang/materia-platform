/**
 * The PDF page's subgroups for both of its adapters: the workbench, whose
 * Subgroups view lists them and activates a row, and the Agent's
 * list_subgroups, lower_symmetry and clear_subgroup, on the workbench or the
 * headless page. One listing and one activation, so the Agent lowers the
 * symmetry exactly as Activate does:
 *
 *  - the listing: the Subgroups view's rows (subgroupPicker.ts), from the
 *    caches the view keeps (subgroupCache.ts) — the same-cell rows at once,
 *    the larger cells of the supercell bound in a Web Worker
 *    (supercellListingClient.ts), waited on for a while;
 *  - the view's merging, filters and order (subgroupList.ts), and its default
 *    variant: the first one the filters keep;
 *  - a row's activation: the child its action gives (withActivatedMode,
 *    withSubgroup, withSameCellSubgroup, withSupercellChild) and the History
 *    step the view records for it;
 *  - ✕ clear on the view's banner (clearanceOf): the page back at the loaded
 *    structure's own group, and the History step the view records for it.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { SupercellSpec, SupercellCentring } from "@/core/crystal/irreps/supercell";
import { MAX_FACTOR_ORDER } from "@/core/crystal/irreps/supercellLattice";
import type { FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { structuralSubgroupLattice, type StructuralSubgroupTree } from "@/core/crystal/subgroupTree";
import { withActivatedMode, withSameCellSubgroup, withSubgroup, withSupercellChild, withoutModes, type PdfPageModel } from "@/app/pdfPage";
import { decentringIrrepTree, gammaIrrepTree, sameCellLattice, type DecentringBranch, type IrrepBranch, type SameCellNode } from "@/app/ui/SubgroupsPanel";
import { DEFAULT_BOUND, PRESETS, boundLabel, parseSupercell } from "@/app/ui/SupercellView";
import type { PickerAction, SubgroupRow } from "@/app/ui/subgroupPicker";
import { DEFAULT_FILTERS, NO_FILTERS, groupRows, nameMatches, visibleGroups, type GraphNode, type ShownGroup } from "@/app/ui/subgroupList";
import { boundGroup, keepPart, partOf, sameCellPart } from "@/app/ui/subgroupCache";
import { startSupercellListing } from "@/app/ui/supercellListingClient";

// ── the bound ────────────────────────────────────────────────────────────────

const CENTRINGS: readonly SupercellCentring[] = ["P", "A", "B", "C", "I", "F", "R"];

/**
 * A supercell bound as the Agent writes it: a preset ("1×1×2", "1x1x2",
 * "√2×√2×1"), any n₁×n₂×n₃ box, or P as the view's custom field takes it
 * ("2 0 0; 0 2 0; 0 0 2"), its centring after it in brackets ("… (I)").
 * Null when it is none of these.
 */
export function parseBound(text: string): SupercellSpec | null {
  const t = text.trim().replace(/[xX*]/g, "×").replace(/\s*×\s*/g, "×").replace(/sqrt\s*2|r2/gi, "√2");
  const preset = PRESETS.find((p) => p.label === t);
  if (preset) return { P: preset.P, centring: "P" };
  const box = /^(\d+)×(\d+)×(\d+)$/.exec(t);
  if (box) {
    const n = [Number(box[1]), Number(box[2]), Number(box[3])];
    if (n.some((x) => x < 1)) return null;
    return { P: [[n[0]!, 0, 0], [0, n[1]!, 0], [0, 0, n[2]!]], centring: "P" };
  }
  const m = /^(.*?)(?:\s*\(\s*([PABCIFR])\s*\))?$/.exec(t.replace(/^P\s*=\s*/, ""));
  const P = m ? parseSupercell(m[1]!) : null;
  if (!P) return null;
  const centring = (m![2] ?? "P") as SupercellCentring;
  return CENTRINGS.includes(centring) ? { P, centring } : null;
}

/** The bound by name: a preset's ("√2×√2×1"), a primitive box's ("1×3×1"), else P as the view writes it ("P = 2 0 0; 0 2 0; 0 0 2 (I)"). */
export function boundName(bound: SupercellSpec): string {
  const name = boundLabel(bound);
  if (!name.startsWith("P = ")) return name;
  const P = bound.P;
  const diagonal = P.every((row, i) => row.every((x, j) => (i === j ? Number.isInteger(x) && x >= 1 : x === 0)));
  return diagonal && (bound.centring ?? "P") === "P" ? `${P[0]![0]}×${P[1]![1]}×${P[2]![2]}` : name;
}

/** The bound as a row id carries it: its name, P without the prefix (and its centring when not P). */
function boundCode(bound: SupercellSpec): string {
  const name = boundName(bound);
  return name.startsWith("P = ") ? name.slice(4).replace(/ \(P\)$/, "") : name;
}

/** The view's bound, else its default (2×2×2). */
export const boundOr = (bound: SupercellSpec | null): SupercellSpec => bound ?? DEFAULT_BOUND;

// ── row ids ──────────────────────────────────────────────────────────────────

/**
 * A row's id for the Agent: a same-cell row's key ("s18", the conventional
 * cell's lattice, whatever the bound), a larger row's key with its bound
 * ("c45@1×1×2", a class of that bound's lattice).
 */
export const rowId = (row: SubgroupRow, bound: SupercellSpec): string => (row.sameCell ? row.key : `${row.key}@${boundCode(bound)}`);

/** An id back to its row key and bound (null: a same-cell row, any bound); null when it is no id. */
export function parseRowId(id: string): { readonly key: string; readonly bound: SupercellSpec | null } | null {
  const m = /^\s*([sc]\d+)\s*(?:@\s*(.+?))?\s*$/.exec(id);
  if (!m) return null;
  if (!m[2]) return m[1]!.startsWith("s") ? { key: m[1]!, bound: null } : null;
  const bound = parseBound(m[2]);
  return bound ? { key: m[1]!, bound } : null;
}

// ── the listing ──────────────────────────────────────────────────────────────

/** What the same-cell rows are built from, the parent's own (the Subgroups view builds them on the loaded structure). */
interface ParentTrees {
  readonly tTree: StructuralSubgroupTree;
  readonly gammaTree: readonly IrrepBranch[] | null;
  readonly decentringTree: readonly DecentringBranch[] | null;
  readonly kNodes: readonly SameCellNode[];
}

const sameRows = new WeakMap<StructureModel, { readonly rows: readonly SubgroupRow[]; readonly error: string | null }>();

/** The same-cell rows as the view lists them at the parent's own state (its Γ and decentring trees), once per structure. */
function sameCellRows(structure: StructureModel): { readonly rows: readonly SubgroupRow[]; readonly error: string | null } {
  let part = sameRows.get(structure);
  if (!part) {
    const trees: ParentTrees = {
      tTree: structuralSubgroupLattice(structure),
      gammaTree: gammaIrrepTree(structure),
      decentringTree: decentringIrrepTree(structure),
      kNodes: sameCellLattice(structure),
    };
    part = sameCellPart({ operations: structure.spaceGroup.operations, structure, ...trees }, true);
    sameRows.set(structure, part);
  }
  return part;
}

/** A bound the listing refuses before any work: its factor group is above the search's ceiling, or P is not a supercell. */
export class BoundRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundRefused";
  }
}

/** The subgroups of a structure that fit a bound, as the view lists them. */
export interface SubgroupListing {
  readonly bound: SupercellSpec;
  /** The same-cell rows, then the larger cells' (every one, or those listed so far). */
  readonly rows: readonly SubgroupRow[];
  /** The larger cells: listed, still being listed (how far), or refused. */
  readonly larger: { readonly state: "done" } | { readonly state: "listing"; readonly percent: number } | { readonly state: "error"; readonly message: string };
  /** Why there are no same-cell rows, when there are none. */
  readonly sameCellError: string | null;
}

/** How long the Agent's call waits on the larger cells in the app before it answers with the rows so far (the work goes on). */
export const AGENT_LISTING_WAIT_MS = 30_000;

/** A listing of the larger cells under way (one per factor group and structure). */
interface Job {
  percent: number;
  rows: readonly SubgroupRow[];
  readonly finished: Promise<void>;
}
const jobs = new WeakMap<FactorGroup, WeakMap<StructureModel, Job>>();

function jobFor(group: FactorGroup, structure: StructureModel, bound: SupercellSpec): Job {
  let byStructure = jobs.get(group);
  if (!byStructure) {
    byStructure = new WeakMap();
    jobs.set(group, byStructure);
  }
  const running = byStructure.get(structure);
  if (running) return running;
  let finish!: () => void;
  const job: Job = { percent: 0, rows: [], finished: new Promise<void>((r) => (finish = r)) };
  byStructure.set(structure, job);
  let graph: readonly GraphNode[] | null = null;
  const end = (): void => {
    byStructure!.delete(structure);
    finish();
  };
  startSupercellListing({ operations: structure.spaceGroup.operations, bound, boundLabel: boundLabel(bound), structure }, group, {
    progress: (percent) => {
      job.percent = percent;
    },
    rows: (rows) => {
      job.rows = rows;
    },
    graph: (nodes) => {
      graph = nodes;
    },
    done: (rows, counts) => {
      keepPart(group, structure, { rows, counts, graph });
      end();
    },
    error: (message) => {
      keepPart(group, structure, { error: message });
      end();
    },
  });
  return job;
}

/**
 * The subgroups of `structure` that fit `bound`, as the Subgroups view lists
 * them: the same-cell rows, and the larger cells' rows from the view's cache,
 * else worked out (in a Web Worker where there is one) and waited on for
 * `waitMs` (default: until done). Throws BoundRefused for a bound the search
 * refuses outright.
 */
export async function listSubgroups(structure: StructureModel, bound: SupercellSpec, opts: { readonly waitMs?: number } = {}): Promise<SubgroupListing> {
  const ops = structure.spaceGroup.operations;
  if (ops.length === 0) throw new BoundRefused("the structure has no space-group operations to analyse");
  // |G/T″| is at least |G/T| times the supercell's volume: refuse a bound above the ceiling before building its group.
  const det = Math.abs(
    bound.P[0]![0]! * (bound.P[1]![1]! * bound.P[2]![2]! - bound.P[1]![2]! * bound.P[2]![1]!)
    - bound.P[0]![1]! * (bound.P[1]![0]! * bound.P[2]![2]! - bound.P[1]![2]! * bound.P[2]![0]!)
    + bound.P[0]![2]! * (bound.P[1]![0]! * bound.P[2]![1]! - bound.P[1]![1]! * bound.P[2]![0]!),
  );
  const tooLarge = (order: number): BoundRefused =>
    new BoundRefused(`the ${boundName(bound)} supercell is too large: its factor group has ${order} elements or more, above the ${MAX_FACTOR_ORDER} the search is measured for; choose a smaller supercell`);
  if (det < 1 - 1e-9) throw new BoundRefused(`${boundName(bound)} is not a supercell (det P = ${+det.toFixed(4)})`);
  if (ops.length * det > MAX_FACTOR_ORDER) throw tooLarge(Math.round(ops.length * det));
  const fg = boundGroup(ops, bound);
  if (fg.error || !fg.group) throw new BoundRefused(`the ${boundName(bound)} supercell: ${fg.error ?? "no factor group"}`);
  if (fg.group.elements.length > MAX_FACTOR_ORDER) throw tooLarge(fg.group.elements.length);
  const group = fg.group;
  const same = sameCellRows(structure);
  const listed = (larger: SubgroupListing["larger"], rows: readonly SubgroupRow[]): SubgroupListing => ({ bound, rows: [...same.rows, ...rows], larger, sameCellError: same.error });
  const kept = (): SubgroupListing | null => {
    const part = partOf(group, structure);
    if (!part) return null;
    return "error" in part ? listed({ state: "error", message: part.error }, []) : listed({ state: "done" }, part.rows);
  };
  const hit = kept();
  if (hit) return hit;
  const job = jobFor(group, structure, bound);
  const waitMs = opts.waitMs;
  if (waitMs === undefined) await job.finished;
  else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([job.finished, new Promise<void>((r) => (timer = setTimeout(r, waitMs)))]);
    clearTimeout(timer);
  }
  return kept() ?? listed({ state: "listing", percent: job.percent }, job.rows);
}

// ── the view's list ──────────────────────────────────────────────────────────

/** What the Agent narrows the list by, as the view's search, chips and filters do. */
export interface SubgroupQuery {
  /** A name or an ITA number, as the view's Find takes it ("P-42_1m", "113"). */
  readonly name?: string;
  /** k-point chips ("X", "W", "Γ"): the rows their irreps reach, two allowing their coupled pairs. */
  readonly k?: readonly string[];
  /** "same cell", or a box ("1×1×2"); "supercell" for any larger one. */
  readonly cell?: string;
  /** Every filter off: the strain-only rows and those only three or more coupled irreps reach too. */
  readonly all?: boolean;
}

/** A k-point as a chip names it: "Γ" for Gamma or G, a name upper-cased, coordinates without spaces. */
const chipKey = (k: string): string => {
  const t = k.trim().replace(/^k\s*=\s*/i, "");
  if (/^(Γ|gamma|gm|g)$/i.test(t)) return "Γ";
  return t.startsWith("(") ? t.replace(/\s+/g, "") : t.toUpperCase();
};

/** A cell as a row writes it. */
export function cellKey(cell: string): string {
  const t = cell.trim().toLowerCase();
  if (/^(same|same cell|same-cell|parent|parent's cell)$/.test(t)) return "same cell";
  if (/^(super|supercell|larger)$/.test(t)) return "supercell";
  return t.replace(/[x*]/g, "×").replace(/\s+/g, "");
}

/**
 * The merged rows the view lists for the query, high to low symmetry: each
 * with the variants the filters keep (the first is its default, the variant
 * the view's Activate takes).
 */
export function queryGroups(rows: readonly SubgroupRow[], q: SubgroupQuery = {}): ShownGroup[] {
  const groups = groupRows(rows);
  const stars = new Map<string, string>();
  for (const r of rows) for (const set of r.reach.sets) for (const x of set) stars.set(chipKey(x.star), x.star);
  const ks = (q.k ?? []).map((k) => stars.get(chipKey(k)) ?? chipKey(k));
  const visible = visibleGroups(groups, { ...(q.all ? NO_FILTERS : DEFAULT_FILTERS), ks });
  const cell = q.cell === undefined ? null : cellKey(q.cell);
  return visible.filter((g) =>
    (q.name === undefined || nameMatches(g.group.name, q.name))
    && (cell === null || (cell === "supercell" ? !g.group.sameCell : g.group.cell === cell)));
}

// ── a row's activation ───────────────────────────────────────────────────────

/** A row activated: the next page (the same page when nothing changed), the child's name, the view's status line and the History step it records. */
export interface Activation {
  readonly model: PdfPageModel;
  readonly label: string;
  readonly message: string;
  /** The History step's label, as the Subgroups view records it. */
  readonly step: string;
}

/** Activate on a row's action, as the Subgroups view does it: its path to the child, and the History step's label. */
export function activationOf(m: PdfPageModel, action: PickerAction): Activation {
  if (action.kind === "irrep") {
    const a = withActivatedMode(m, action.term, action.sub);
    return { ...a, step: `Distortion modes: ${a.label}` };
  }
  if (action.kind === "subgroup") {
    const a = withSubgroup(m, action.node);
    return { ...a, step: `Distortion modes: ${a.label}` };
  }
  if (action.kind === "sameCell") {
    const a = withSameCellSubgroup(m, action.node);
    return { ...a, step: `Distortion modes: ${a.label}` };
  }
  if (action.kind === "supercell") {
    const a = withSupercellChild(m, action.choice);
    return { ...a, step: `Supercell child: ${a.label}` };
  }
  return { model: m, label: "", message: `not offered here (${action.note})`, step: "" };
}

/** ✕ clear on the Subgroups view: the page without its modes (the same page when none are in force) and the History step it records. */
export function clearanceOf(m: PdfPageModel): { readonly model: PdfPageModel; readonly step: string } {
  const sg = m.loaded.spaceGroup;
  const name = sg.hermannMauguin ?? "the parent's group";
  return { model: withoutModes(m), step: `Back to ${sg.number !== undefined ? `${name} #${sg.number}` : name}` };
}
