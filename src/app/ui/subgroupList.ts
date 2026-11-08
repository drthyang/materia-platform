/**
 * The Subgroups page's one list, as data (SubgroupsPanel renders it): the
 * rows of subgroupPicker.ts merged by name, cell and domains, filtered by the
 * k-point chips, the folded filters and a name search, sorted from high to
 * low symmetry and cut short to the top index levels (more on demand); the
 * tied coupled sets written on one line; the tree of maximal steps. The group
 * theory is the rows'; this module only groups, filters and writes them.
 */

import type { IrrepRef, SubgroupRow, WayStep } from "@/app/ui/subgroupPicker";

// ── filters ──────────────────────────────────────────────────────────────────

/** Which subgroups the list keeps by how they are reached: one irrep, up to two coupled, or every one. The maximal ones always. */
export type ReachKind = "one" | "two" | "all";
/** The cell filter: any, the parent's own (same cell), or a larger one. */
export type CellFilter = "any" | "same" | "super";

export interface ListFilters {
  /** The chosen k-point chips (their ids); none keeps every star. */
  readonly ks: readonly string[];
  readonly kind: ReachKind;
  readonly cell: CellFilter;
  /** The highest index kept; null keeps every index. */
  readonly maxIndex: number | null;
  /** Keep the strain-only subgroups (no atom moves: 0 modes); hidden by default. */
  readonly strain: boolean;
}

export const DEFAULT_FILTERS: ListFilters = { ks: [], kind: "two", cell: "any", maxIndex: null, strain: false };

/** Every filter off: every class of every merged row is listed. */
export const NO_FILTERS: ListFilters = { ks: [], kind: "all", cell: "any", maxIndex: null, strain: true };

/** True when the folded filters (cell, kind, index, strain only) differ from the defaults. */
export const foldedFiltersSet = (f: ListFilters): boolean => f.kind !== DEFAULT_FILTERS.kind || f.cell !== DEFAULT_FILTERS.cell || f.maxIndex !== null || f.strain !== DEFAULT_FILTERS.strain;

/**
 * The reaching sets a row shows for the chosen chips, best first: every set
 * with no chip; with chips, the sets whose irreps all sit at chosen stars (a
 * primary irrep at a chosen star; a coupled set inside the chosen stars, so
 * picking two chips allows their coupled pairs).
 */
export function setsFor(row: SubgroupRow, ks: readonly string[]): readonly (readonly IrrepRef[])[] {
  if (ks.length === 0) return row.reach.sets;
  return row.reach.sets.filter((set) => set.every((x) => ks.includes(x.star)));
}

/** Whether a row stays in the list under the filters. */
export function rowPasses(row: SubgroupRow, f: ListFilters): boolean {
  if (f.cell === "same" && !row.sameCell) return false;
  if (f.cell === "super" && row.sameCell) return false;
  if (f.maxIndex !== null && row.index > f.maxIndex) return false;
  if (!f.strain && row.modes === 0) return false;
  const sets = setsFor(row, f.ks);
  if (f.ks.length > 0 && sets.length === 0) return false;
  if (row.maximal || f.kind === "all") return true;
  if (row.reach.kind === "primary") return true;
  return f.kind === "two" && row.reach.kind === "coupled" && (sets[0]?.length ?? 0) <= 2;
}

// ── merged rows ──────────────────────────────────────────────────────────────

/** Subgroups with the same name, cell and domains, as one row; its variants differ in the irreps that reach them. */
export interface RowGroup {
  readonly key: string;
  readonly name: string;
  readonly cell: string;
  readonly domains: number;
  readonly index: number;
  readonly sameCell: boolean;
  /** The classes, best first (variantOrder): the first is the row's tag, detail and default Activate. */
  readonly variants: readonly SubgroupRow[];
}

const reachRank = (r: SubgroupRow): number => (r.reach.kind === "primary" ? 0 : r.reach.kind === "coupled" ? r.reach.sets[0]!.length : 9);

/** Below this a row's bond stretch is 0: a rigid-unit distortion (rigid ones come out at rounding, ~1e-15; the others at order 1). */
export const RIGID_STRETCH = 1e-6;
/** Whether the irreps a row leads with can move its atoms without stretching the shortest bonds (SubgroupRow.stretch). */
export const isRigid = (r: SubgroupRow): boolean => r.stretch !== null && r.stretch < RIGID_STRETCH;

/** What the variants' "?" says of their order. */
export const VARIANT_ORDER_NOTE =
  "The first is the default: one irrep before coupled ones, atoms moved before strain only, then a rigid-unit distortion (the shortest bonds kept, as octahedra tilt), then the lattice's order.";

/**
 * The variants' order, best first: reached by one irrep before coupled ones
 * (fewer first); those that move atoms before strain-only ones; then those
 * whose lead irreps make a rigid-unit distortion (isRigid: SrTiO₃'s tilts,
 * a⁰a⁰c⁻ I4/mcm by R irrep 8 before the Jahn–Teller-like R irrep 6, a⁻b⁺a⁻
 * Pnma by the M and R tilts before the pairs that move Ti or Sr); then the
 * lattice's order. Symmetry alone does not order a tilt before a mode of
 * the same subgroup that deforms the octahedra; the bonds do.
 */
export function variantOrder(a: SubgroupRow, b: SubgroupRow): number {
  return reachRank(a) - reachRank(b) || Number((b.modes ?? 1) > 0) - Number((a.modes ?? 1) > 0) || Number(isRigid(b)) - Number(isRigid(a));
}

/** Merge rows with the same name, cell and domains; every row is one group's variant, none lost. */
export function groupRows(rows: readonly SubgroupRow[]): RowGroup[] {
  const groups = new Map<string, { rows: { row: SubgroupRow; at: number }[] }>();
  rows.forEach((row, at) => {
    const key = `${row.name}|${row.cell}|${row.domains}`;
    const g = groups.get(key) ?? { rows: [] };
    g.rows.push({ row, at });
    groups.set(key, g);
  });
  return [...groups.entries()].map(([key, g]) => {
    const variants = g.rows
      .sort((a, b) => variantOrder(a.row, b.row) || a.at - b.at)
      .map((x) => x.row);
    const first = variants[0]!;
    return { key, name: first.name, cell: first.cell, domains: first.domains, index: first.index, sameCell: first.sameCell, variants };
  });
}

/** A group as the list shows it: its variants the filters keep (the first is the row's tag and the default Activate). */
export interface ShownGroup {
  readonly group: RowGroup;
  readonly shown: readonly SubgroupRow[];
}

const itNumber = (name: string): number => Number(/#(\d+)/.exec(name)?.[1] ?? 0);

/** From high to low symmetry: by index, the maximal ones first, the same cell first, then the higher ITA number, then the lattice's order. */
export function symmetryOrder(a: ShownGroup, b: ShownGroup): number {
  const ma = a.shown.some((r) => r.maximal);
  const mb = b.shown.some((r) => r.maximal);
  return a.group.index - b.group.index || Number(mb) - Number(ma) || Number(b.group.sameCell) - Number(a.group.sameCell) || itNumber(b.group.name) - itNumber(a.group.name);
}

/** The groups the filters keep, high to low symmetry. */
export function visibleGroups(groups: readonly RowGroup[], f: ListFilters): ShownGroup[] {
  const out: ShownGroup[] = [];
  for (const group of groups) {
    const shown = group.variants.filter((r) => rowPasses(r, f));
    if (shown.length > 0) out.push({ group, shown });
  }
  // A stable sort keeps the lattice's order among equals.
  return out.sort(symmetryOrder);
}

// ── the short list and the search ────────────────────────────────────────────

/** The short list takes whole index levels from the top until at least this many rows show… */
export const SHORT_MIN = 20;
/** …but adds no level that would take it past this many (a first level is taken whole, however long). */
export const SHORT_MAX = 40;

/** One index level of the list: its index and how many rows it has. */
export interface IndexLevel {
  readonly index: number;
  readonly count: number;
}

/** The list's index levels, top first (the list is sorted by index). */
export function indexLevels(visible: readonly ShownGroup[]): IndexLevel[] {
  const out: { index: number; count: number }[] = [];
  for (const g of visible) {
    const last = out.at(-1);
    if (last && last.index === g.group.index) last.count++;
    else out.push({ index: g.group.index, count: 1 });
  }
  return out;
}

/** How many levels, from `from` on, one step of the short list takes: whole levels until at least SHORT_MIN rows, never past SHORT_MAX unless it is the first. */
function chunk(levels: readonly IndexLevel[], from: number): number {
  let n = 0;
  let taken = 0;
  for (let i = from; i < levels.length; i++) {
    if (n >= SHORT_MIN) break;
    if (taken > 0 && n + levels[i]!.count > SHORT_MAX) break;
    n += levels[i]!.count;
    taken++;
  }
  return taken;
}

/** The list as it shows: the rows, and what "show more" would add (null when every row shows). */
export interface ShortList {
  readonly rows: readonly ShownGroup[];
  /** How many index levels show. */
  readonly levels: number;
  /** The next step: its levels (to show `levels` in all), its first and last index and its rows. */
  readonly next: { readonly levels: number; readonly from: number; readonly to: number; readonly count: number } | null;
  /** Every row the filters keep. */
  readonly total: number;
}

/**
 * The top of the list: `levels` index levels (null: the default, one step;
 * "all": every row). The full list stays one "show all" away.
 */
export function shortList(visible: readonly ShownGroup[], levels: number | "all" | null): ShortList {
  const all = indexLevels(visible);
  const n = levels === "all" ? all.length : Math.min(all.length, levels ?? chunk(all, 0));
  const rows = n === all.length ? visible : visible.slice(0, all.slice(0, n).reduce((t, l) => t + l.count, 0));
  const k = n < all.length ? chunk(all, n) : 0;
  const step = all.slice(n, n + k);
  return {
    rows, levels: n, total: visible.length,
    next: step.length > 0 ? { levels: n + k, from: step[0]!.index, to: step.at(-1)!.index, count: step.reduce((t, l) => t + l.count, 0) } : null,
  };
}

/** A name flattened for the search: lower case, no spaces, subscripts and "#" dropped ("P-42₁m #113" → "p-421m113"). */
const flatName = (s: string): string => s.toLowerCase().replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080)).replace(/[\s#_]/g, "");

/**
 * Whether a subgroup's name answers a search: a number ("62", "#62") is the
 * ITA number; anything else a part of the symbol, spaces, subscripts and
 * "_" ignored ("Pnma", "P-42_1m", "p-421m", "I4/mcm").
 */
export function nameMatches(name: string, query: string): boolean {
  const q = query.trim().replace(/^#/, "");
  if (q === "") return true;
  if (/^\d+$/.test(q)) return itNumber(name) === Number(q);
  return flatName(compactName(name)).includes(flatName(q));
}

/** The rows a search keeps, in the list's order (every level: a search is not cut short). */
export const searched = (visible: readonly ShownGroup[], query: string): ShownGroup[] => visible.filter((g) => nameMatches(g.group.name, query));

// ── tied sets and tags ───────────────────────────────────────────────────────

/**
 * Reaching sets written as one: the members, each with its tied
 * alternatives (subgroupPicker's IrrepRef.tie). Two sets are tied when they
 * differ by exactly one member and those two members are tied; the
 * alternatives sit at that member's place ("M irrep 3 or 5 + R irrep 8").
 * Only one place varies, so every combination written is a set that reaches
 * the row.
 */
export interface TiedSet {
  readonly members: readonly (readonly IrrepRef[])[];
}

/** The sets, tied ones on one line, in their order. */
export function collapseTies(sets: readonly (readonly IrrepRef[])[]): TiedSet[] {
  const out: { base: readonly IrrepRef[]; at: number | null; alts: IrrepRef[] }[] = [];
  for (const set of sets) {
    let merged = false;
    for (const g of out) {
      if (g.base.length !== set.length) continue;
      const labels = new Set(set.map((x) => x.label));
      const missing = g.base.map((x, i) => ({ x, i })).filter(({ x }) => !labels.has(x.label));
      if (missing.length !== 1) continue;
      const baseLabels = new Set(g.base.map((x) => x.label));
      const extra = set.filter((x) => !baseLabels.has(x.label));
      if (extra.length !== 1) continue;
      const at = missing[0]!.i;
      if (g.at !== null && g.at !== at) continue;
      if (extra[0]!.tie !== g.base[at]!.tie) continue;
      if (g.alts.some((x) => x.label === extra[0]!.label)) {
        merged = true;
        break;
      }
      g.at = at;
      g.alts.push(extra[0]!);
      merged = true;
      break;
    }
    if (!merged) out.push({ base: set, at: null, alts: [] });
  }
  return out.map((g) => ({ members: g.base.map((x, i) => (i === g.at ? [x, ...g.alts] : [x])) }));
}

/** A star as a tag writes it: "R", "(0,0,½)", "Δ(0,0,½)". */
export function starShort(star: string): string {
  return star.replace(/^k = /, "").replace(/\s/g, "").replace(/1\/2/g, "½").replace(/1\/4/g, "¼").replace(/3\/4/g, "¾").replace(/1\/3/g, "⅓").replace(/2\/3/g, "⅔");
}

/** The compact tag of a set: "R·8", "M·3+R·8", tied "M·3/5+R·8"; not ISODISTORT's "R4+". */
export function tagOf(set: TiedSet): string {
  return set.members.map((alts) => `${starShort(alts[0]!.star)}·${alts.map((x) => x.number).join("/")}`).join("+");
}

/** A set in words, without "of N": "M irrep 3 or 5 + R irrep 8". */
export function setLine(set: TiedSet): string {
  return set.members.map((alts) => alts.length === 1 ? shortLabel(alts[0]!) : `${shortLabel(alts[0]!)} or ${alts.slice(1).map((x) => x.number).join(" or ")}`).join(" + ");
}

/** "R irrep 8 of 10" → "R irrep 8"; "k = (0, 0, 1/2) irreps 3⊕4 of 4" → "(0,0,½) irreps 3⊕4"; "Δ (0, 0, 1/2) irrep 2 of 4" → "Δ(0,0,½) irrep 2". */
export function shortLabel(x: IrrepRef): string {
  const s = x.label.replace(/ of \d+$/, "");
  const prefix = s.startsWith("k = ") ? (/^k = \([^)]*\)/.exec(s)?.[0] ?? null) : x.star.includes("(") && s.startsWith(x.star) ? x.star : null;
  return prefix ? `${starShort(x.star)}${s.slice(prefix.length)}` : s;
}

/** The name as the page writes it: the engine's spaced symbol closed up, screw axes as subscripts ("P 42/n n m:2 #134" → "P4₂/nnm:2 #134"). */
export function compactName(name: string): string {
  const m = /^(.*?)( #\d+.*| \(.*\))?$/.exec(name);
  const symbol = m?.[1] ?? name;
  const rest = m?.[2] ?? "";
  const sub = "₀₁₂₃₄₅₆₇₈₉";
  const tokens = symbol.split(/\s+/).map((t) => t.replace(/([2346])([1-5])/g, (_, a: string, b: string) => `${a}${sub[Number(b)]}`));
  return `${tokens.join("")}${rest}`;
}

/** The name without its number: "Pnma", for chains and buttons. */
export const shortName = (name: string): string => compactName(name).replace(/ #\d+$/, "").replace(/ \(.*\)$/, "");

// ── the tree ──────────────────────────────────────────────────────────────────

/** A subgroup in the lattice, by its row's key ("p" the parent), with the keys of the classes covering it. */
export interface GraphNode {
  readonly key: string;
  readonly coveredBy: readonly string[];
}

/** The classes each class covers (its maximal subgroups), by key. */
export function childrenOf(graph: readonly GraphNode[]): ReadonlyMap<string, readonly string[]> {
  const m = new Map<string, string[]>();
  for (const n of graph) for (const p of n.coveredBy) {
    const list = m.get(p) ?? [];
    if (!list.includes(n.key)) list.push(n.key);
    m.set(p, list);
  }
  return m;
}

// ── ways ─────────────────────────────────────────────────────────────────────

/** A way written as one: each step's subgroup, with the tied irreps that switch it on. */
export interface TiedWay {
  readonly steps: readonly { readonly name: string; readonly cell: string; readonly cls: number; readonly irreps: readonly IrrepRef[] }[];
  /** How many of the row's chains it stands for. */
  readonly chains: number;
}

/** The ways, tied ones (the same subgroups, the irreps tied step by step) on one line, in their order. */
export function collapseWays(ways: readonly (readonly WayStep[])[]): TiedWay[] {
  const out = new Map<string, { steps: { name: string; cell: string; cls: number; irreps: IrrepRef[] }[]; chains: number }>();
  for (const way of ways) {
    const key = way.map((st) => `${st.name}|${st.cell}|${st.irrep.tie}`).join(">");
    const hit = out.get(key);
    if (!hit) {
      out.set(key, { steps: way.map((st) => ({ name: st.name, cell: st.cell, cls: st.cls, irreps: [st.irrep] })), chains: 1 });
      continue;
    }
    hit.chains++;
    way.forEach((st, i) => {
      const at = hit.steps[i]!;
      if (!at.irreps.some((x) => x.label === st.irrep.label)) at.irreps.push(st.irrep);
    });
  }
  return [...out.values()];
}

/** The irreps of a step in words: "M irrep 3 or 5". */
export const irrepsLineOf = (irreps: readonly IrrepRef[]): string =>
  irreps.length === 1 ? shortLabel(irreps[0]!) : `${shortLabel(irreps[0]!)} or ${irreps.slice(1).map((x) => x.number).join(" or ")}`;

/**
 * What the detail panel says of one row (a variant): the set it leads with
 * (the row's first reaching set, the one Activate kicks: SupercellChoice's
 * coupled set, or the first primary irrep), the ways built from that set
 * only, and the ways through its other reaching sets, which wait behind
 * "more ways". Every irrep a lead way names is in the lead set.
 */
export function detailOf(row: SubgroupRow): { readonly set: TiedSet | null; readonly lead: readonly TiedWay[]; readonly more: readonly TiedWay[] } {
  const set = collapseTies(row.reach.sets)[0] ?? null;
  const labels = new Set((set?.members ?? []).flat().map((x) => x.label));
  const movesFirst = (ws: TiedWay[]): TiedWay[] =>
    [...ws].sort((a, b) => Number(a.steps.some((s) => s.irreps.every((x) => x.moves === false))) - Number(b.steps.some((s) => s.irreps.every((x) => x.moves === false))));
  const ways = collapseWays(row.ways.ways);
  // A primary row's lead is its first primary irrep alone; a coupled row's, every ordering of its first (tied) set.
  const inLead = (w: TiedWay): boolean => w.steps.every((s) => s.irreps.every((x) => labels.has(x.label))) && (row.reach.kind !== "coupled" || w.steps.length === (set?.members.length ?? 0));
  return { set, lead: movesFirst(ways.filter(inLead)), more: movesFirst(ways.filter((w) => !inLead(w))) };
}
