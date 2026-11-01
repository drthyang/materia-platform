/**
 * The By subgroup view's cell-multiplying rows, worked out in steps that
 * stream: the bound's lattice, every star's irreps, then each irrep's
 * isotropy subgroups one at a time, a class's row sent as soon as the irreps
 * it needs (those with a vector it fixes, subgroupIrrepsAnalysis.needs) are
 * in. The rows are those of supercellListing exactly (the same analysis, one
 * class at a time), sent as plain data: the Subgroups page runs this in a Web
 * Worker (supercellListing.worker.ts) and rebuilds each row on its own copy
 * of the factor group (fromPlainRow), which the worker's must equal
 * (factorGroupKey). Without workers the page steps the same generator on the
 * main thread (supercellListingClient.ts).
 */

import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { SupercellChoice } from "@/app/pdfPage";
import { factorGroup, starsInBound, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { rnum } from "@/core/crystal/irreps/rational";
import { cachedIrrepsOfStar } from "@/core/crystal/irreps/supercellModes";
import { cachedSupercellSubgroups, SubgroupSearchTooLarge } from "@/core/crystal/irreps/supercellLattice";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import { boundIrreps, subgroupIrrepsAnalysis, type BoundIrrep } from "@/core/crystal/irreps/subgroupIrreps";
import { isSupercellRowClass, latticeCounts, multiplicitiesOf, supercellSubgroupRow, type LatticeCounts, type SubgroupRow } from "@/app/ui/subgroupPicker";

/** What a listing is worked out from: plain data, so it crosses to a worker as it is. */
export interface ListingInput {
  readonly operations: readonly SymmetryOperation[];
  readonly bound: SupercellSpec;
  /** The bound's label ("2×2×2"). */
  readonly boundLabel: string;
  readonly structure?: StructureModel;
}

/** A row as plain data: its activation's choice without the factor group (fromPlainRow puts the page's back). */
export type PlainRow = Omit<SubgroupRow, "action"> & {
  /** Its class id in the bound's lattice: the order the rows are listed in. */
  readonly cls: number;
  readonly action: { readonly kind: "supercell"; readonly choice: Omit<SupercellChoice, "group"> };
};

export type ListingEvent =
  /** The factor group the rows are on (factorGroupKey), first. */
  | { readonly type: "group"; readonly key: string }
  /** How far the work has come, in whole percent. */
  | { readonly type: "progress"; readonly percent: number }
  /** Rows whose irreps are all in, in any order (by `cls` when listed). */
  | { readonly type: "rows"; readonly rows: readonly PlainRow[] }
  /** Every row sent; what the summary says of the lattice. */
  | { readonly type: "done"; readonly rows: number; readonly counts: LatticeCounts }
  /** No rows: why (a bound above the search's ceiling, or a failure). */
  | { readonly type: "error"; readonly message: string };

/** A short fingerprint of a factor group's bound, elements and table: the worker's and the page's copies must agree element for element. */
export function factorGroupKey(group: FactorGroup): string {
  let h = 0x811c9dc5;
  const mix = (x: number): void => {
    h ^= x & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= x >>> 16;
    h = Math.imul(h, 0x01000193);
  };
  const text = (s: string): void => {
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  // The bound too: two bounds can share a core T″, and so the elements, but not the supercell a row must keep.
  text(JSON.stringify(group.bound));
  for (const e of group.elements) text(JSON.stringify(e));
  for (const row of group.table) for (const x of row) mix(x);
  return `${group.elements.length}:${(h >>> 0).toString(16)}`;
}

/** A row without its factor group, for postMessage. */
export function toPlainRow(row: SubgroupRow, cls: number): PlainRow {
  if (row.action.kind !== "supercell") throw new Error("supercellListing: a cell-multiplying row activates in its own cell");
  const { group: _group, ...choice } = row.action.choice;
  return { ...row, cls, action: { kind: "supercell", choice } };
}

/** The row on the page's own factor group. */
export function fromPlainRow(row: PlainRow, group: FactorGroup): SubgroupRow {
  const { cls: _cls, action, ...rest } = row;
  return { ...rest, action: { kind: "supercell", choice: { group, ...action.choice } } };
}

/** The share of the percent line each step takes: the lattice, the stars' irreps, the isotropy subgroups, the last rows. */
const SHARE = { lattice: 40, stars: 5, isotropy: 50 } as const;

/**
 * The listing, step by step (see the module comment). `group` is the bound's
 * factor group when the caller has it (the main thread); a worker builds its
 * own. `latticeProgress` hears the lattice search, which is one step.
 */
export function* supercellListingSteps(input: ListingInput, opts: { readonly group?: FactorGroup; readonly latticeProgress?: (percent: number) => void } = {}): Generator<ListingEvent, void, void> {
  const group = opts.group ?? factorGroup(input.operations, input.bound);
  yield { type: "group", key: factorGroupKey(group) };
  yield { type: "progress", percent: 0 };
  let lattice;
  try {
    lattice = cachedSupercellSubgroups(group, opts.latticeProgress ? (f) => opts.latticeProgress!(Math.floor(f * SHARE.lattice)) : undefined);
  } catch (e) {
    if (e instanceof SubgroupSearchTooLarge) {
      yield { type: "error", message: `Larger cells refused: ${e.message}.` };
      return;
    }
    throw e;
  }
  yield { type: "progress", percent: SHARE.lattice };
  const ks = starsInBound(group).map((k) => [rnum(k[0]), rnum(k[1]), rnum(k[2])] as [number, number, number]);
  const stars = [];
  for (let i = 0; i < ks.length; i++) {
    stars.push(cachedIrrepsOfStar(group, ks[i]!));
    yield { type: "progress", percent: SHARE.lattice + Math.floor((SHARE.stars * (i + 1)) / ks.length) };
  }
  const irreps = boundIrreps(group, stars, { lazy: true });
  const m = multiplicitiesOf(input.structure, group);
  const analysis = subgroupIrrepsAnalysis(group, irreps, lattice, m ? { multiplicity: m } : {});
  const src = { group, lattice, bound: input.boundLabel, ...(m ? { moves: (b: BoundIrrep) => m(b) > 0 } : {}) };

  // The row classes, each waiting on the irreps it needs.
  const waiting = new Map<number, number>();
  const waitedOnBy = irreps.map(() => [] as number[]);
  const ready: number[] = [];
  for (const cls of lattice.classes) {
    if (!isSupercellRowClass(cls)) continue;
    const needs = analysis.needs(cls.id);
    if (needs.length === 0) ready.push(cls.id);
    else waiting.set(cls.id, needs.length);
    for (const j of needs) waitedOnBy[j]!.push(cls.id);
  }
  let sent = 0;
  const rowsOf = (ids: readonly number[]): PlainRow[] =>
    ids.flatMap((id) => {
      const row = supercellSubgroupRow(src, lattice.classes[id]!, analysis.of(id));
      return row ? [toPlainRow(row, id)] : [];
    });
  const flush = function* (): Generator<ListingEvent, void, void> {
    if (ready.length === 0) return;
    const rows = rowsOf(ready.splice(0));
    sent += rows.length;
    if (rows.length > 0) yield { type: "rows", rows };
  };
  yield* flush();
  // The isotropy subgroups, the cheaper irreps first (lower dimension), so the rows that need only those come early;
  // the order the work is done in changes no result.
  const order = irreps.map((b, j) => ({ j, dim: b.irrep.dim })).sort((a, b) => a.dim - b.dim || a.j - b.j).map((x) => x.j);
  let last = -1;
  for (let i = 0; i < order.length; i++) {
    const j = order[i]!;
    void irreps[j]!.subgroups;
    analysis.match(j);
    for (const id of waitedOnBy[j]!) {
      const left = waiting.get(id)! - 1;
      if (left === 0) {
        waiting.delete(id);
        ready.push(id);
      } else waiting.set(id, left);
    }
    yield* flush();
    const percent = SHARE.lattice + SHARE.stars + Math.floor((SHARE.isotropy * (i + 1)) / order.length);
    if (percent !== last) {
      last = percent;
      yield { type: "progress", percent };
    }
  }
  if (waiting.size > 0) throw new Error("supercellListing: rows left waiting on irreps");
  // Every irrep matched: the checks subgroupIrreps makes, made for the irreps no row needed too.
  irreps.forEach((_, j) => analysis.match(j));
  yield { type: "progress", percent: 100 };
  yield { type: "done", rows: sent, counts: latticeCounts(lattice) };
}

/** The listing's rows in their order (by class), from its events: what supercellListing returns, as plain rows. */
export function collectListing(events: Iterable<ListingEvent>): { readonly key: string; readonly rows: PlainRow[]; readonly counts: LatticeCounts | null; readonly error: string | null } {
  let key = "";
  const rows: PlainRow[] = [];
  let counts: LatticeCounts | null = null;
  let error: string | null = null;
  for (const e of events) {
    if (e.type === "group") key = e.key;
    else if (e.type === "rows") rows.push(...e.rows);
    else if (e.type === "done") counts = e.counts;
    else if (e.type === "error") error = e.message;
  }
  rows.sort((a, b) => a.cls - b.cls);
  return { key, rows, counts, error };
}
