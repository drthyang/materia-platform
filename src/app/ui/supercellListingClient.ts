/**
 * Runs the By subgroup view's cell-multiplying listing (supercellListing.ts)
 * in a Web Worker, so the page stays responsive: the rows stream back as
 * plain data and are rebuilt on the page's own factor group, which must be
 * the worker's (their factorGroupKey agree, else the run fails). Stop
 * terminates the worker. Where no worker can start (no Worker, or it fails to
 * load before its first message), the same steps run on the main thread with
 * a pause between them, so the page still paints and a stop is heard.
 */

import type { FactorGroup } from "@/core/crystal/irreps/factorGroup";
import type { LatticeCounts, SubgroupRow } from "@/app/ui/subgroupPicker";
import { factorGroupKey, fromPlainRow, supercellListingSteps, type ListingEvent, type ListingInput, type PlainRow } from "@/app/ui/supercellListing";

export interface ListingHandlers {
  /** How far the work has come, in whole percent. */
  readonly progress: (percent: number) => void;
  /** The rows so far, in the lattice's order (at most every `throttleMs`). */
  readonly rows: (rows: readonly SubgroupRow[]) => void;
  /** Every row, in the lattice's order, and the lattice's counts. */
  readonly done: (rows: readonly SubgroupRow[], counts: LatticeCounts) => void;
  readonly error: (message: string) => void;
}

export interface ListingJob {
  /** Stop: the worker is terminated (or the main-thread steps end); no handler is called after. */
  readonly stop: () => void;
  /** Where it runs. */
  readonly where: () => "worker" | "main thread";
}

const pause = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Start one listing of `group` (the page's factor group for input.operations and input.bound). */
export function startSupercellListing(input: ListingInput, group: FactorGroup, on: ListingHandlers, opts: { readonly throttleMs?: number } = {}): ListingJob {
  const throttleMs = opts.throttleMs ?? 200;
  const key = factorGroupKey(group);
  let over = false;
  let where: "worker" | "main thread" = "main thread";
  let worker: Worker | null = null;
  const plain: PlainRow[] = [];
  let built: SubgroupRow[] = [];
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const sorted = (): SubgroupRow[] => {
    if (dirty) {
      plain.sort((a, b) => a.cls - b.cls);
      built = plain.map((r) => fromPlainRow(r, group));
      dirty = false;
    }
    return built;
  };
  const end = (): void => {
    over = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    worker?.terminate();
    worker = null;
  };
  const fail = (message: string): void => {
    if (over) return;
    end();
    on.error(message);
  };
  const handle = (e: ListingEvent): void => {
    if (over) return;
    if (e.type === "group") {
      if (e.key !== key) fail("the worker's factor group differs from the page's");
    } else if (e.type === "progress") {
      on.progress(e.percent);
    } else if (e.type === "rows") {
      plain.push(...e.rows);
      dirty = true;
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (!over) on.rows(sorted());
        }, throttleMs);
      }
    } else if (e.type === "done") {
      const rows = sorted();
      end();
      if (rows.length !== e.rows) on.error(`supercellListing: ${rows.length} rows came of ${e.rows}`);
      else on.done(rows, e.counts);
    } else {
      fail(e.message);
    }
  };

  const inThread = async (): Promise<void> => {
    where = "main thread";
    try {
      await pause(20);
      for (const e of supercellListingSteps(input, { group })) {
        if (over) return;
        handle(e);
        await pause();
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  };

  if (typeof Worker === "undefined") {
    void inThread();
  } else {
    let heard = false;
    try {
      // Vite bundles the worker from this literal pattern (see workers/computeClient.ts).
      worker = new Worker(new URL("./supercellListing.worker.ts", import.meta.url), { type: "module" });
      where = "worker";
      worker.addEventListener("message", (ev: MessageEvent<ListingEvent>) => {
        heard = true;
        handle(ev.data);
      });
      worker.addEventListener("error", (ev) => {
        if (over) return;
        if (!heard) {
          // It never started (a chunk that failed to load, a policy): the main thread does the work.
          worker?.terminate();
          worker = null;
          void inThread();
        } else fail(ev.message || "the listing worker failed");
      });
      worker.postMessage(input);
    } catch {
      worker = null;
      void inThread();
    }
  }
  return { stop: end, where: () => where };
}
