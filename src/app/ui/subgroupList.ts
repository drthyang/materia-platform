/**
 * The Subgroups page's one list, as data (SubgroupsPanel renders it): the
 * rows of subgroupPicker.ts merged by name, cell and domains, filtered by the
 * k-point chips and the folded filters, sorted from high to low symmetry; the
 * tied coupled sets written on one line; the tree of maximal steps and the
 * literal lattice chains. The group theory is the rows'; this module only
 * groups, filters and writes them.
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
}

export const DEFAULT_FILTERS: ListFilters = { ks: [], kind: "two", cell: "any", maxIndex: null };

/** True when the folded filters (cell, kind, index) differ from the defaults. */
export const foldedFiltersSet = (f: ListFilters): boolean => f.kind !== DEFAULT_FILTERS.kind || f.cell !== DEFAULT_FILTERS.cell || f.maxIndex !== null;

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
  /** The classes, best first: reached by one irrep before coupled ones, then those that move atoms, then in the lattice's order. */
  readonly variants: readonly SubgroupRow[];
}

const reachRank = (r: SubgroupRow): number => (r.reach.kind === "primary" ? 0 : r.reach.kind === "coupled" ? r.reach.sets[0]!.length : 9);

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
      .sort((a, b) => reachRank(a.row) - reachRank(b.row) || Number((b.row.modes ?? 1) > 0) - Number((a.row.modes ?? 1) > 0) || a.at - b.at)
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

/** A star as a tag writes it: "R", "(0,0,½)". */
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

/** "R irrep 8 of 10" → "R irrep 8"; "k = (0, 0, 1/2) irreps 3⊕4 of 4" → "(0,0,½) irreps 3⊕4". */
export function shortLabel(x: IrrepRef): string {
  const s = x.label.replace(/ of \d+$/, "");
  return x.star.startsWith("(") || x.label.startsWith("k = ") ? s.replace(/^k = \([^)]*\)/, starShort(x.star)) : s;
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

// ── the tree and the lattice chains ──────────────────────────────────────────

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

/**
 * The chains of covering steps from the parent ("p") down to a class: how
 * many there are, and up to `n` of the shortest (each from the parent to the
 * class, by key).
 */
export function latticeChains(graph: readonly GraphNode[], key: string, n: number): { readonly count: number; readonly chains: readonly (readonly string[])[] } {
  const byKey = new Map(graph.map((x) => [x.key, x] as const));
  if (!byKey.has(key)) return { count: 0, chains: [] };
  const memo = new Map<string, number>();
  const count = (k: string): number => {
    if (k === "p") return 1;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    memo.set(k, 0);
    const v = (byKey.get(k)?.coveredBy ?? []).reduce((s, p) => s + count(p), 0);
    memo.set(k, v);
    return v;
  };
  // The depth of each class below the parent (fewest steps), so the walk takes the shortest first.
  const depth = new Map<string, number>([["p", 0]]);
  const depthOf = (k: string): number => {
    const hit = depth.get(k);
    if (hit !== undefined) return hit;
    depth.set(k, Infinity);
    const d = 1 + Math.min(Infinity, ...(byKey.get(k)?.coveredBy ?? []).map(depthOf));
    depth.set(k, d);
    return d;
  };
  const out: string[][] = [];
  const walk = (k: string, acc: string[]): void => {
    if (out.length >= n) return;
    if (k === "p") {
      out.push(["p", ...acc]);
      return;
    }
    const ups = [...(byKey.get(k)?.coveredBy ?? [])].sort((a, b) => depthOf(a) - depthOf(b));
    for (const p of ups) walk(p, [k, ...acc]);
  };
  walk(key, []);
  return { count: count(key), chains: out.sort((a, b) => a.length - b.length) };
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
