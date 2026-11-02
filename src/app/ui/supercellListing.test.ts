/**
 * The By subgroup view's larger cells off the main thread
 * (supercellListing.ts, supercellListingClient.ts): the rows that come back
 * from the worker's steps, across a structured clone each way and rebuilt on
 * the page's own factor group, are supercellListing's (the main-thread
 * computation) exactly, class for class, row for row and in order, on
 * SrTiO₃ in 2×2×2 and the GaTa₄Se₈ demo (published) in 1×1×2; they stream (rows
 * arrive while isotropy subgroups are still being worked out); the client
 * runs them in a Worker, streams, ends, stops by terminating it, and refuses
 * a worker whose factor group is not the page's.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { cachedSupercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import { latticeCounts, supercellListing, type SubgroupRow } from "@/app/ui/subgroupPicker";
import { collectListing, factorGroupKey, fromPlainRow, supercellListingSteps, type ListingEvent, type ListingInput } from "@/app/ui/supercellListing";
import { startSupercellListing } from "@/app/ui/supercellListingClient";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { srtio3 } from "@/testSupport/perovskiteTilts";

// The lattice and the isotropy analysis of every star take seconds, twice here (the direct call and the worker's).
const SLOW = 300_000;

const STO = srtio3();
const GTS = gata4se8PdfExample().structure;
const B222: SupercellSpec = { P: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], centring: "P" };
const B112: SupercellSpec = { P: [[1, 0, 0], [0, 1, 0], [0, 0, 2]], centring: "P" };

const input = (s: StructureModel, bound: SupercellSpec, label: string): ListingInput => ({ operations: s.spaceGroup.operations, bound, boundLabel: label, structure: s });

/** What a worker does with a posted input, the input and every event crossing a structured clone. */
function viaWorker(i: ListingInput): ListingEvent[] {
  return [...supercellListingSteps(structuredClone(i))].map((e) => structuredClone(e));
}

describe("the worker's rows are the main thread's", () => {
  for (const [name, s, bound, label] of [["SrTiO₃, Pm-3m in 2×2×2", STO, B222, "2×2×2"], ["GaTa₄Se₈, F-43m in 1×1×2", GTS, B112, "1×1×2"]] as const) {
    it(`${name}: the same classes, rows and order, the summary's counts, rows streaming before the isotropy work ends`, () => {
      const group = factorGroup(s.spaceGroup.operations, bound);
      const direct = supercellListing(group, s, label);
      const events = viaWorker(input(s, bound, label));
      const got = collectListing(events);
      expect(got.error).toBeNull();
      // Built from the cloned operations, the worker's factor group is the page's, element for element.
      expect(got.key).toBe(factorGroupKey(group));
      const rows: SubgroupRow[] = got.rows.map((r) => fromPlainRow(r, group));
      expect(rows.map((r) => r.key)).toEqual(direct.rows.map((r) => r.key));
      expect(rows).toEqual(direct.rows);
      expect(got.counts).toEqual(latticeCounts(direct.lattice));
      expect(events.at(-1)).toEqual({ type: "done", rows: direct.rows.length, counts: latticeCounts(direct.lattice) });
      // Streaming: rows are sent while the percent line is still short of the isotropy work's end.
      const firstRows = events.findIndex((e) => e.type === "rows");
      const lastProgress = events.reduce((at, e, i) => (e.type === "progress" && e.percent < 95 ? i : at), -1);
      expect(firstRows).toBeGreaterThan(-1);
      expect(firstRows).toBeLessThan(lastProgress);
      expect(events.filter((e) => e.type === "rows").length).toBeGreaterThan(3);
      // The percent line only climbs, to 100.
      const percents = events.flatMap((e) => (e.type === "progress" ? [e.percent] : []));
      expect(percents.every((p, i) => i === 0 || p >= percents[i - 1]!)).toBe(true);
      expect(percents.at(-1)).toBe(100);
    }, SLOW);
  }

  it("a bound above the search's ceiling: one error, no rows", () => {
    // Pmmm in an 8a×4b×16c cell: |F| = 8 · 512 = 4096 elements (supercellLattice.test.ts).
    const pmmm = buildSpaceGroup(47).operations;
    const events = viaWorker({ operations: pmmm, bound: { P: [[8, 0, 0], [0, 4, 0], [0, 0, 16]], centring: "P" }, boundLabel: "8×4×16" });
    expect(events.filter((e) => e.type === "rows")).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/^Larger cells refused: /) });
  }, SLOW);
});

/** A Worker that runs supercellListing.worker.ts's loop in this thread, a pause between events, everything cloned. */
class FakeWorker {
  static made: FakeWorker[] = [];
  terminated = false;
  posted = 0;
  private readonly listeners: ((ev: MessageEvent<ListingEvent>) => void)[] = [];
  constructor(readonly url: URL, readonly opts: WorkerOptions) {
    FakeWorker.made.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent<ListingEvent>) => void): void {
    if (type === "message") this.listeners.push(fn);
  }
  postMessage(data: ListingInput): void {
    const steps = supercellListingSteps(structuredClone(data));
    const tick = (): void => {
      if (this.terminated) return;
      const next = steps.next();
      if (next.done) return;
      this.posted++;
      const ev = { data: structuredClone(next.value) } as MessageEvent<ListingEvent>;
      for (const fn of this.listeners) fn(ev);
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe("the listing client", () => {
  const g = globalThis as { Worker?: unknown };
  const saved = g.Worker;
  afterEach(() => {
    g.Worker = saved;
    FakeWorker.made = [];
  });
  const gts112 = (): FactorGroup => factorGroup(GTS.spaceGroup.operations, B112);

  it("runs in a worker: progress, rows streaming in the lattice's order, then every row on the page's own group", async () => {
    g.Worker = FakeWorker;
    const group = gts112();
    const direct = supercellListing(group, GTS, "1×1×2");
    const seen: { percents: number[]; partial: number[] } = { percents: [], partial: [] };
    const result = await new Promise<readonly SubgroupRow[]>((resolve, reject) => {
      const job = startSupercellListing(input(GTS, B112, "1×1×2"), group, {
        progress: (p) => seen.percents.push(p),
        rows: (rows) => {
          seen.partial.push(rows.length);
          // In the lattice's order at every step.
          const ids = rows.map((r) => Number(r.key.slice(1)));
          expect(ids).toEqual([...ids].sort((a, b) => a - b));
        },
        done: (rows) => resolve(rows),
        error: (m) => reject(new Error(m)),
      }, { throttleMs: 0 });
      expect(job.where()).toBe("worker");
    });
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]!.opts).toEqual({ type: "module" });
    expect(FakeWorker.made[0]!.url.pathname).toMatch(/supercellListing\.worker\.ts$/);
    expect(FakeWorker.made[0]!.terminated).toBe(true);
    expect(result).toEqual(direct.rows);
    expect(seen.partial.length).toBeGreaterThan(1);
    expect(seen.partial[0]!).toBeLessThan(direct.rows.length);
    expect(seen.percents.at(-1)).toBe(100);
  }, SLOW);

  it("stop terminates the worker, and nothing is heard after", async () => {
    g.Worker = FakeWorker;
    const group = gts112();
    cachedSupercellSubgroups(group);
    const heard: string[] = [];
    const job = startSupercellListing(input(GTS, B112, "1×1×2"), group, {
      progress: () => heard.push("progress"),
      rows: () => heard.push("rows"),
      done: () => heard.push("done"),
      error: () => heard.push("error"),
    }, { throttleMs: 0 });
    while (!heard.includes("progress")) await new Promise((r) => setTimeout(r, 5));
    job.stop();
    const worker = FakeWorker.made[0]!;
    expect(worker.terminated).toBe(true);
    const at = heard.length;
    const posted = worker.posted;
    await new Promise((r) => setTimeout(r, 300));
    expect(heard.length).toBe(at);
    expect(worker.posted).toBe(posted);
    expect(heard).not.toContain("done");
  }, SLOW);

  it("refuses a worker whose factor group is not the page's", async () => {
    g.Worker = FakeWorker;
    const other = factorGroup(GTS.spaceGroup.operations, B222);
    const message = await new Promise<string>((resolve) => {
      startSupercellListing(input(GTS, B112, "1×1×2"), other, { progress: () => undefined, rows: () => undefined, done: () => resolve("done"), error: resolve });
    });
    expect(message).toBe("the worker's factor group differs from the page's");
    expect(FakeWorker.made[0]!.terminated).toBe(true);
  }, SLOW);

  it("without a Worker, steps the same listing on the main thread", async () => {
    g.Worker = undefined;
    const group = gts112();
    const direct = supercellListing(group, GTS, "1×1×2");
    let where = "";
    const rows = await new Promise<readonly SubgroupRow[]>((resolve, reject) => {
      const job = startSupercellListing(input(GTS, B112, "1×1×2"), group, { progress: () => undefined, rows: () => undefined, done: resolve, error: (m) => reject(new Error(m)) });
      where = job.where();
    });
    expect(where).toBe("main thread");
    expect(rows).toEqual(direct.rows);
  }, SLOW);
});
