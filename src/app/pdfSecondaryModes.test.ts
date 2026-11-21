import { beforeAll, describe, expect, it, vi } from "vitest";
import { ComputeClient } from "@/workers/computeClient";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { pageView, pdfFit, pdfPage, withAdpModel, withFit, withFixed, withParameter, workspaceOf, type PdfPageModel } from "@/app/pdfPage";
import { activationOf, listSubgroups, parseBound } from "@/app/pdfSubgroups";

/**
 * The secondary distortion modes of a supercell child, freed on the PDF page
 * (secondary-modes-refine, 2026-11-20): the bundled GaTa₄Se₈ demo lowered to
 * P-42₁m in 1×1×2 as the Subgroups view's Activate does it (44 modes: 19 of
 * the order parameter, X irrep 5 + W irrep 1, kicked; 25 secondary ones at 0),
 * on the 2.06–6.78 Å window of the report, through the page's own fit
 * (pdfFit, the Refine button).
 *
 * Freed, the secondary modes never refined, in two ways:
 *
 *  - at exactly 0 beside the order parameter just kicked, the first cycle
 *    proposed shifts of ångströms for them, no trial went downhill, and
 *    Refine answered "stalled after 1 iteration" with nothing moved, every
 *    time (the engine's zeroShiftCaps);
 *  - after a change of the ADP model the page had solved for the position
 *    rows again and left round-off (1e-15 Å) in the ones at 0; the engine's
 *    cap of 5× the value per cycle then held them at 1e-11, and Refine
 *    answered "converged" (the same, and withSpecChange).
 */

vi.setConfig({ testTimeout: 300_000 });

const demo = gata4se8PdfExample();
const WINDOW = { min: 2.06, max: 6.78 };

let client: ComputeClient;
/** The child as activated: the order parameter free at the kick, the secondary modes at 0, fixed. */
let child: PdfPageModel;
let modeIds: string[];
let secondary: string[];

const rw = (m: PdfPageModel): number => pageView(m).rw;
const valueOf = (m: PdfPageModel, id: string): number => m.params.find((p) => p.id === id)!.value;
const freeModes = (m: PdfPageModel): PdfPageModel => withFixed(m, modeIds.map((id) => ({ id, fixed: false })));
/** How many secondary modes stand further than `t` Å from 0. */
const moved = (m: PdfPageModel, t: number): number => secondary.filter((id) => Math.abs(valueOf(m, id)) > t).length;

beforeAll(async () => {
  client = new ComputeClient();
  const page = pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams, fitRange: WINDOW } });
  // Refined in the parent, then the view's row for P-42₁m in its own 1×1×2 cell, at its default variant.
  const parent = withFit(page, await pdfFit(client, page));
  const listing = await listSubgroups(demo.structure, parseBound("1×1×2")!);
  const row = listing.rows.find((r) => r.key === "c45")!;
  expect([row.name, row.cell, row.action.kind]).toEqual(["P -4 21 m #113", "1×1×2", "supercell"]);
  child = activationOf(parent, row.action).model;
  const modes = child.modes!.set.modes;
  modeIds = modes.map((mode) => mode.id);
  secondary = modes.filter((mode) => !mode.active).map((mode) => mode.id);
  expect([modes.length, secondary.length]).toEqual([44, 25]);
  expect(secondary.every((id) => valueOf(child, id) === 0)).toBe(true);
}, 300_000);

describe("the secondary modes of a supercell child, freed on the PDF page", () => {
  let refined: PdfPageModel;

  it("refine when every mode is freed at the kick (Refine stalled at once, nothing moved)", async () => {
    const start = freeModes(child);
    const fit = await pdfFit(client, start);
    refined = withFit(start, fit);
    console.log(`[secondary modes] free at the kick: ${fit.result.message} · Rw ${(100 * rw(start)).toFixed(2)} → ${(100 * rw(refined)).toFixed(2)} % · ${moved(refined, 0.01)} of ${secondary.length} secondary modes beyond 0.01 Å`);
    expect(fit.result.history.length).toBeGreaterThan(1);
    expect(rw(start)).toBeGreaterThan(0.115);
    expect(rw(refined)).toBeLessThan(0.095);
    expect(moved(refined, 0.01)).toBeGreaterThanOrEqual(15);
  });

  it("pull a secondary mode back after it is moved off by hand, and Rw recovers", async () => {
    const id = secondary[0]!; // Γ irrep 1 · Ta1
    const before = valueOf(refined, id);
    const nudged = withParameter(refined, id, { value: before + 0.2 });
    expect(rw(nudged)).toBeGreaterThan(rw(refined) + 0.05);
    const fit = await pdfFit(client, nudged);
    const back = withFit(nudged, fit);
    console.log(`[secondary modes] ${id} moved by +0.2 Å: Rw ${(100 * rw(refined)).toFixed(2)} → ${(100 * rw(nudged)).toFixed(2)} → ${(100 * rw(back)).toFixed(2)} % (${fit.result.message}) · ${before.toFixed(4)} → ${valueOf(back, id).toFixed(4)} Å`);
    expect(rw(back)).toBeLessThan(rw(refined) + 0.005);
    expect(Math.abs(valueOf(back, id) - before)).toBeLessThan(0.1);
  });

  it("keep their values and free choices across a change of the ADP model (the rows were solved for again: round-off in every 0, the free choices back at the default)", () => {
    // Two secondary modes freed at 0, one held at 0.03 Å, the rest at 0 and fixed.
    const before = withParameter(withFixed(child, [secondary[0]!, secondary[1]!].map((id) => ({ id, fixed: false }))), secondary[2]!, { value: 0.03 });
    const after = withAdpModel(before, false);
    expect(pageView(after).adpModel).toBe("isotropic");
    const rows = (m: PdfPageModel) => modeIds.map((id) => { const p = m.params.find((q) => q.id === id)!; return { id, value: p.value, fixed: p.fixed }; });
    expect(rows(after)).toEqual(rows(before));
    expect(secondary.slice(3).every((id) => Object.is(valueOf(after, id), 0))).toBe(true);
    // And back: still the same rows.
    expect(rows(withAdpModel(after, true))).toEqual(rows(before));
  });

  it("refine in a project 0.5.0 saved with round-off in them (\"converged\", every one still below 1e-6 Å)", async () => {
    // The order parameter refined alone on isotropic ADPs, then the rows as 0.5.0 left them after an ADP switch.
    const iso = withAdpModel(child, false);
    const primary = withFit(iso, await pdfFit(client, iso));
    const roundOff: PdfPageModel = { ...primary, params: primary.params.map((p) => { const k = secondary.indexOf(p.id); return k < 0 ? p : { ...p, value: (k % 2 ? -1 : 1) * 1e-15 * (1 + k) }; }) };
    const saved = JSON.parse(JSON.stringify(workspaceOf(roundOff)));
    const reopened = pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams, fitRange: WINDOW }, restore: saved });
    expect(rw(reopened)).toBeCloseTo(rw(primary), 9);
    const start = freeModes(reopened);
    const fit = await pdfFit(client, start);
    const after = withFit(start, fit);
    console.log(`[secondary modes] reopened with round-off rows: ${fit.result.message} · Rw ${(100 * rw(start)).toFixed(2)} → ${(100 * rw(after)).toFixed(2)} % · ${moved(after, 0.01)} of ${secondary.length} secondary modes beyond 0.01 Å`);
    expect(rw(after)).toBeLessThan(0.095);
    expect(moved(after, 0.01)).toBeGreaterThanOrEqual(15);
  });
});
