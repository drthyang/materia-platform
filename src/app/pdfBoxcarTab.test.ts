import { describe, it, expect } from "vitest";
import { ComputeClient } from "@/workers/computeClient";
import type { PdfPattern } from "@/core/diffraction/types";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { validateSnapshot } from "@/core/project/validate";
import { srtio3 } from "@/testSupport/perovskiteTilts";
import {
  agentBoxcarPlan, boxcarDataRange, boxcarRangeOf, boxcarStartIsCurrent, boxcarStartRows, boxcarSummary, boxcarTabIssue, boxcarTabScanPlan,
  pdfBoxcar, pdfFit, pdfPage, withBoxcarPlan, withBoxcarRange, withBoxcarRangeFromFit, withBoxcarRun, withBoxcarStart, withBoxcarStartReset,
  withFit, withFitRange, withPattern, workspaceOf, type PdfCompute, type PdfPageModel,
} from "@/app/pdfPage";

/**
 * The Boxcar tab as an analysis of its own: it scans its own r bounds (the
 * fit window until edited or scanned), starts from the current fit with any
 * edits made on the tab ("Reset to current fit" drops them), and never writes
 * back to the main fit. The Agent's scan is unchanged: the fit window, the rows
 * as they are.
 */

const STO = srtio3();

/** A synthetic SrTiO₃ G(r), 1–12 Å (no measured data). */
function pattern(id = "sto", rMax = 12): PdfPattern {
  const rGrid = makeRGrid(1, rMax, 0.02);
  const gr = computeGofR(STO.cell, expandStructureAtoms(STO), rGrid, { scatteringType: "xray", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id, name: id, scatteringType: "xray", points: Array.from(rGrid, (r, i) => ({ r, gObs: gr[i]! })), qdamp: 0.03 };
}

/** The page on the fit window 1.5–10 Å (it opens with the scale and the cell free). */
function page(): PdfPageModel {
  return pdfPage(STO, pattern(), { preset: { fitRange: { min: 1.5, max: 10 } } });
}

const freeIds = (m: PdfPageModel): string[] => m.params.filter((p) => !p.fixed && !p.expression).map((p) => p.id);
const cellId = (m: PdfPageModel): string => m.params.find((p) => p.kind === "cellLength")!.id;

/** A client that records the boxcar request and answers with one flat step per box (no compute). */
function fakeClient(): { client: PdfCompute; asked: { parameters: { id: string; value: number; fixed: boolean }[]; windows: { min: number; max: number }[] }[] } {
  const asked: { parameters: { id: string; value: number; fixed: boolean }[]; windows: { min: number; max: number }[] }[] = [];
  const client = {
    refinePdfBoxcar: async (req: { parameters: { id: string; value: number; fixed: boolean }[] }, windows: { min: number; max: number }[]) => {
      asked.push({ parameters: req.parameters.map((p) => ({ id: p.id, value: p.value, fixed: p.fixed })), windows: windows.map((w) => ({ min: w.min, max: w.max })) });
      const values = Object.fromEntries(req.parameters.map((p) => [p.id, p.value + 1]));
      const steps = windows.map((w, i) => ({ index: i, label: `${w.min}`, carried: true, result: { status: "converged", parameters: values, esd: {}, agreement: { rWeighted: 0.1 } } }));
      return { steps, evolution: [] };
    },
  } as unknown as PdfCompute;
  return { client, asked };
}

describe("the Boxcar tab's own range", () => {
  it("shows the fit window until it is edited, then keeps its own bounds when the fit window moves", () => {
    let m = page();
    expect(m.boxcarPlan.range).toBeUndefined();
    expect(boxcarRangeOf(m)).toEqual({ min: 1.5, max: 10 });
    m = withBoxcarRange(m, { max: 8 });
    expect(boxcarRangeOf(m)).toEqual({ min: 1.5, max: 8 });
    m = withFitRange(m, { min: 2, max: 11 });
    expect(boxcarRangeOf(m)).toEqual({ min: 1.5, max: 8 });
    expect(m.fitRange).toEqual({ min: 2, max: 11 });
    m = withBoxcarRangeFromFit(m);
    expect(boxcarRangeOf(m)).toEqual({ min: 2, max: 11 });
  });

  it("says in one plain line what is wrong with the bounds, and accepts bounds on the data with room for two boxes", () => {
    let m = withBoxcarPlan(page(), { width: 3, step: 1 });
    expect(boxcarDataRange(m)).toEqual({ min: 1, max: expect.closeTo(12, 6) });
    expect(boxcarTabIssue(m)).toBeNull();
    m = withBoxcarRange(m, { min: 6, max: 4 });
    expect(boxcarTabIssue(m)).toBe("The lower bound must be below the upper bound.");
    m = withBoxcarRange(m, { min: 0.5, max: 8 });
    expect(boxcarTabIssue(m)).toBe("The lower bound is below the data, which starts at 1 Å.");
    m = withBoxcarRange(m, { min: 2, max: 30 });
    expect(boxcarTabIssue(m)).toMatch(/^The upper bound is past the data, which ends at 12 Å\.$/);
    m = withBoxcarRange(m, { min: 2, max: 4 });
    expect(boxcarTabIssue(m)).toBe("A 3 Å box does not fit inside the 2–4 Å window — shrink the box or widen the range.");
    m = withBoxcarRange(m, { min: 2, max: 5.5 });
    expect(boxcarTabIssue(m)).toMatch(/single box .*widen the range\)/);
    m = withBoxcarRange(m, { min: 2, max: 6 });
    expect(boxcarTabIssue(m)).toBeNull();
  });

  it("scans the tab's range, not the fit window, and the status line reports that span", async () => {
    const m = withBoxcarRange(withBoxcarPlan(page(), { width: 2, step: 1 }), { min: 3, max: 9 });
    const { client, asked } = fakeClient();
    const out = await pdfBoxcar(client, m, boxcarTabScanPlan(m));
    expect(asked[0]!.windows[0]).toEqual({ min: 3, max: 5 });
    expect(asked[0]!.windows.at(-1)).toEqual({ min: 7, max: 9 });
    expect(out.run!.windows).toHaveLength(5);
    expect(boxcarSummary(m, out.run!, "up")).toMatch(/^5 boxes of 2 Å across 3\.00–9\.00 Å/);
  });

  it("leaves the Agent's scan on the fit window, from the rows as they are, whatever the tab holds", async () => {
    let m = withBoxcarRange(page(), { min: 3, max: 9 });
    m = withBoxcarStart(m, cellId(m), { value: 3.95, free: false });
    const { client, asked } = fakeClient();
    await pdfBoxcar(client, m, agentBoxcarPlan(m.boxcarPlan, { width: 2, step: 1, direction: "up" }));
    expect(asked[0]!.windows[0]).toEqual({ min: 1.5, max: 3.5 });
    const a = asked[0]!.parameters.find((p) => p.id === cellId(m))!;
    expect(a).toEqual({ id: cellId(m), value: m.params.find((p) => p.id === cellId(m))!.value, fixed: false });
  });
});

describe("the Boxcar tab's starting point", () => {
  it("is the current fit until edited: its values and free rows, following the main page", () => {
    let m = page();
    expect(freeIds(m)).toEqual(["pdfScale", "cell_a"]);
    const rows = boxcarStartRows(m);
    expect(rows.filter((r) => r.free).map((r) => r.id)).toEqual(freeIds(m));
    expect(rows.every((r) => r.value === r.fitValue)).toBe(true);
    expect(boxcarStartIsCurrent(m)).toBe(true);
    // The main fit moves on: the unedited tab starts from the new values.
    const id = cellId(m);
    m = { ...m, params: m.params.map((p) => (p.id === id ? { ...p, value: 3.91 } : p)) };
    expect(boxcarStartRows(m).find((r) => r.id === id)!.value).toBe(3.91);
    expect(boxcarTabScanPlan(m).startValues).toEqual({});
    expect(boxcarTabScanPlan(m).free).toEqual(freeIds(m));
  });

  it("keeps the tab's edits, drops an edit that lands back on the fit, and Reset to current fit drops them all", () => {
    let m = page();
    const id = cellId(m);
    const scale = "pdfScale";
    m = withBoxcarStart(m, id, { value: 3.95 });
    m = withBoxcarStart(m, scale, { free: false });
    expect(boxcarStartIsCurrent(m)).toBe(false);
    expect(boxcarTabScanPlan(m).startValues).toEqual({ [id]: 3.95 });
    expect(boxcarTabScanPlan(m).free).toEqual(freeIds(m).filter((x) => x !== scale));
    // The edit back to the fit's own flag is dropped, not stored.
    m = withBoxcarStart(m, scale, { free: true });
    expect(m.boxcarPlan.start).toEqual({ values: { [id]: 3.95 } });
    m = withBoxcarStartReset(m);
    expect(m.boxcarPlan.start).toBeUndefined();
    expect(boxcarStartIsCurrent(m)).toBe(true);
    // Reset re-seeds from the CURRENT fit, not from where the tab started.
    m = { ...m, params: m.params.map((p) => (p.id === id ? { ...p, value: 3.9 } : p)) };
    expect(boxcarStartRows(m).find((r) => r.id === id)!.value).toBe(3.9);
  });

  it("starts the first box from the tab's values and free rows", async () => {
    let m = withBoxcarPlan(page(), { width: 2, step: 1 });
    const id = cellId(m);
    const scale = "pdfScale";
    m = withBoxcarStart(m, id, { value: 3.95 });
    m = withBoxcarStart(m, scale, { free: false });
    const { client, asked } = fakeClient();
    const out = await pdfBoxcar(client, m, boxcarTabScanPlan(m));
    const sent = new Map(asked[0]!.parameters.map((p) => [p.id, p]));
    expect(sent.get(id)).toMatchObject({ value: 3.95, fixed: false });
    expect(sent.get(scale)!.fixed).toBe(true);
    expect(out.run!.freeIds).toEqual(freeIds(m).filter((x) => x !== scale));
  });

  it("is dropped with the range when new data replaces the old (they belong to the old rows and r span)", () => {
    let m = withBoxcarRange(page(), { min: 3, max: 9 });
    m = withBoxcarStart(m, cellId(m), { value: 3.95 });
    m = withPattern(m, pattern("other", 15));
    expect(m.boxcarPlan.range).toBeUndefined();
    expect(m.boxcarPlan.start).toBeUndefined();
    expect(m.boxcarPlan.width).toBe(5);
  });
});

describe("a boxcar scan and the main fit", () => {
  it("never writes back: the rows, the fit window and the last fit are the same after a real scan", async () => {
    const client = new ComputeClient();
    let m = page();
    m = withFit(m, await pdfFit(client, m));
    m = withBoxcarPlan(m, { width: 3, step: 1.5 });
    m = withBoxcarRange(m, { min: 2, max: 8 });
    m = withBoxcarStart(m, cellId(m), { value: 3.93 });
    const before = JSON.stringify({ params: m.params, fitRange: m.fitRange, result: m.result });
    const out = await pdfBoxcar(client, m, boxcarTabScanPlan(m));
    expect(out.stopped).toBeNull();
    expect(out.run!.series[0]!.result.steps).toHaveLength(3);
    const after = withBoxcarRun(m, out.run, out.key);
    expect(after.boxcarRun).toBe(out.run);
    expect(JSON.stringify({ params: after.params, fitRange: after.fitRange, result: after.result })).toBe(before);
    // The boxes did move the cell — the scan refined, on copies.
    const id = cellId(m);
    expect(out.run!.series[0]!.result.steps.some((s) => s.result.parameters[id] !== 3.93)).toBe(true);
  }, 120_000);
});

describe("the tab's range and starting point in a project file", () => {
  it("are saved and come back on reopen; an older file without them still opens and follows the fit", () => {
    let m = withBoxcarRange(page(), { min: 2.5, max: 9.5 });
    m = withBoxcarStart(m, cellId(m), { value: 3.95, free: false });
    const saved = JSON.parse(JSON.stringify(workspaceOf(m)));
    expect(() => validateSnapshot([STO], saved, "snapshot")).not.toThrow();
    const back = pdfPage(STO, m.pattern, { restore: saved });
    expect(back.boxcarPlan).toEqual(m.boxcarPlan);
    expect(boxcarRangeOf(back)).toEqual({ min: 2.5, max: 9.5 });
    expect(boxcarStartIsCurrent(back)).toBe(false);
    // An older file: the plan has neither.
    const old = JSON.parse(JSON.stringify(saved));
    delete old.boxcar.plan.range;
    delete old.boxcar.plan.start;
    expect(() => validateSnapshot([STO], old, "snapshot")).not.toThrow();
    const reopened = pdfPage(STO, m.pattern, { restore: old });
    expect(boxcarRangeOf(reopened)).toEqual(reopened.fitRange);
    expect(boxcarStartIsCurrent(reopened)).toBe(true);
    // A malformed range is refused by name.
    const bad = JSON.parse(JSON.stringify(saved));
    bad.boxcar.plan.range.max = "x";
    expect(() => validateSnapshot([STO], bad, "snapshot")).toThrow(/boxcar\.plan\.range\.max/);
  });
});
