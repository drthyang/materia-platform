import { describe, expect, it, vi } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { liveStateOf, pdfPage, withoutModes, type PdfPageModel } from "@/app/pdfPage";
import { activationOf, cellKey, parseBound, parseRowId, rowId } from "@/app/pdfSubgroups";
import { newSession } from "@/app/powderSession";
import { exampleStructure } from "@/examples/mn3ga";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { srtio3 } from "@/testSupport/perovskiteTilts";
import { executor, fakeHost, headlessHistory, pdfPort, sessionPort } from "@/testSupport/agentHeadless";
import type { PdfAgentPort } from "@/agent/port";
import { inputJsonSchema, liveTool } from "@/agent/tools";

/**
 * The Agent's subgroup tools on the PDF page (subgroupTools.ts) beyond the
 * equivalence with the view's Activate (lowerSymmetry.dom.test.ts): a name
 * that several classes answer returns them and changes nothing; the refusals
 * (another page, a fit running, an id no list gave, a bound too large, a
 * subgroup already in force, a strain-only row); clear_subgroup is the view's
 * ✕ clear; and the bound and id syntax.
 */

vi.setConfig({ testTimeout: 300_000 });

const demo = gata4se8PdfExample();
const demoPage = (): PdfPageModel => pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams, fitRange: { min: 1.5, max: 6 } } });

function agentOn(start: PdfPageModel = demoPage(), wrap: (port: PdfAgentPort) => PdfAgentPort = (p) => p) {
  const made = pdfPort({ page: start });
  const port = wrap(made.port);
  const history = headlessHistory(made.port);
  const { host } = fakeHost(port, history.history, (kind, agent) => history.record(kind, agent ? "agent" : undefined), history.goTo);
  const { ex } = executor(host, "auto");
  return { port, calls: made.calls, history, ex };
}

const parsed = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;

describe("lower_symmetry with several matches", () => {
  it("returns the four P-42₁m classes of 1×1×2 as candidates and changes nothing; a variant or an id picks one", async () => {
    const { ex, port, calls, history } = agentOn();
    const before = port.state();
    const steps = history.history()!.steps.length;
    const out = await ex.run("lower_symmetry", { name: "P-42_1m", cell: "1×1×2" });
    expect(out.status, out.text).toBe("unchanged");
    const body = parsed(out.text) as { unchanged: boolean; count: number; candidates: { id: string; variant: number; default?: boolean; irreps: string; cell: string }[]; note: string };
    expect(body.unchanged).toBe(true);
    expect(body.count).toBe(4);
    expect(body.candidates.map((c) => [c.id, c.variant, c.default ?? false])).toEqual([["c45@1×1×2", 1, true], ["c47@1×1×2", 2, false], ["c73@1×1×2", 3, false], ["c77@1×1×2", 4, false]]);
    expect(body.candidates.every((c) => c.cell === "1×1×2" && /^X irrep 5 \(.*\) \+ W irrep \d \(.*\)$/.test(c.irreps))).toBe(true);
    expect(body.note).toMatch(/nothing was changed/);
    // Nothing on the page moved, nothing was activated, no step.
    expect(port.state()).toEqual(before);
    expect(calls).toEqual([]);
    expect(history.history()!.steps).toHaveLength(steps);
    // A name alone, in 1×1×2: the two same-cell classes at X and the four larger ones.
    const both = parsed((await ex.run("lower_symmetry", { name: "113", bound: "1x1x2" })).text) as { count: number; candidates: { cell: string }[] };
    expect([both.count, both.candidates.filter((c) => c.cell === "same cell").length]).toEqual([6, 2]);
    // The variant names one: the third class.
    const third = await ex.run("lower_symmetry", { name: "P-42_1m", cell: "1×1×2", variant: 3 });
    expect(third.status, third.text).toBe("ok");
    expect(calls).toEqual(["lower c73"]);
  });
});

describe("the subgroup tools refuse", () => {
  it("on the powder page, saying where they work", async () => {
    const { port } = sessionPort(newSession(exampleStructure()));
    const { ex } = executor(fakeHost(port).host, "auto");
    for (const name of ["list_subgroups", "lower_symmetry", "clear_subgroup"]) {
      const out = await ex.run(name, name === "lower_symmetry" ? { id: "s18" } : {});
      expect(out.isError).toBe(true);
      expect(out.text).toContain(`${name} works on the PDF page only; the powder page is open`);
    }
    // The tool says so too: a lower group on the powder page is a CIF.
    expect(liveTool("lower_symmetry")!.description).toMatch(/On the powder page a lower group is loaded as its CIF\.$/);
  });

  it("while a fit runs, an id no list gave, a bound too large or malformed, and a second lowering before clear_subgroup", async () => {
    // A refinement (or a scan, or the sampler) running: refused before anything is listed or asked.
    const busy = agentOn(demoPage(), (p) => ({ ...p, state: () => ({ ...p.state(), busy: true }) }));
    const running = await busy.ex.run("lower_symmetry", { id: "c45@1×1×2" });
    expect([running.status, running.refusedBy]).toEqual(["refused", "busy"]);
    expect(running.text).toMatch(/a refinement is running/);
    expect(busy.calls).toEqual([]);

    const { ex, calls } = agentOn();
    const unknown = await ex.run("lower_symmetry", { id: "c9999@1×1×2" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/no subgroup c9999@1×1×2 in the 1×1×2 list: use an id list_subgroups gave/);
    const junk = await ex.run("lower_symmetry", { id: "Pnma" });
    expect(junk.text).toMatch(/"Pnma" is no row id/);
    // F-43m's 96 operations in a 4×4×4 cell: |G/T″| ≥ 6144, above the search's ceiling; refused at once.
    const t0 = Date.now();
    const large = await ex.run("list_subgroups", { bound: "4×4×4" });
    expect(large.isError).toBe(true);
    expect(large.text).toMatch(/the 4×4×4 supercell is too large: its factor group has 6144 elements or more, above the 3072 the search is measured for/);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((await ex.run("list_subgroups", { bound: "banana" })).text).toMatch(/"banana" is no supercell/);
    expect((await ex.run("list_subgroups", { bound: "2 0 0; 0 0 0; 0 0 2" })).text).toMatch(/is not a supercell/);
    expect((await ex.run("lower_symmetry", {})).text).toMatch(/give a row's `id` from list_subgroups, or the subgroup's `name`/);
    expect((await ex.run("lower_symmetry", { name: "Fm-3m", cell: "same cell" })).text).toMatch(/no subgroup Fm-3m in same cell fits the 1×1×1 cell/);
    // Lowered once, a second lowering waits for clear_subgroup, as Activate waits for ✕ clear.
    expect((await ex.run("lower_symmetry", { id: "s18" })).status).toBe("ok");
    const twice = await ex.run("lower_symmetry", { id: "c45@1×1×2" });
    expect(twice.isError).toBe(true);
    expect(twice.text).toMatch(/a subgroup is in force \(lowered to X irrep 5 of 5 → P -4 21 m · in the parent's cell\): call clear_subgroup first, then lower again/);
    expect(calls).toEqual(["lower s18"]);
    // The list still lists the parent's, and says what is in force.
    const listed = parsed((await ex.run("list_subgroups", { bound: "1×1×2", name: "P-42_1m" })).text);
    expect(listed.inForce).toMatch(/^lowered to X irrep 5 of 5 → P -4 21 m · in the parent's cell: these are the parent's subgroups/);
    expect(listed.parent).toBe("F-43m #216");
  });

  it("a strain-only row: nothing to refine (SrTiO₃'s P4/mmm moves no atom)", async () => {
    const parent = srtio3();
    const { ex, calls } = agentOn(pdfPage(parent, patternOf(parent), { preset: { fitRange: { min: 1.5, max: 10 } } }));
    // Hidden by default, as in the view; `all` shows it, marked.
    const hidden = parsed((await ex.run("list_subgroups", { bound: "1×1×1", name: "P4/mmm", cell: "same cell" })).text);
    expect(hidden.count).toBe(0);
    expect(hidden.note).toMatch(/`all: true` adds the strain-only rows/);
    const shown = parsed((await ex.run("list_subgroups", { bound: "1×1×1", name: "P4/mmm", cell: "same cell", all: true })).text) as { rows: { id: string; strainOnly?: boolean; modes: number }[] };
    expect(shown.rows).toHaveLength(1);
    expect(shown.rows[0]).toMatchObject({ strainOnly: true, modes: 0 });
    const out = await ex.run("lower_symmetry", { id: shown.rows[0]!.id });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/P4\/mmm #123 \(same cell\) is strain only: no atom moves, so there is nothing to refine/);
    expect(calls).toEqual([]);
  });
});

describe("clear_subgroup", () => {
  it("is the view's ✕ clear: the parent's group, sites and rows back, the same page as withoutModes, a History step", async () => {
    const start = demoPage();
    const { ex, port, history } = agentOn(start);
    expect(parsed((await ex.run("clear_subgroup", {})).text)).toMatchObject({ unchanged: true, note: "no subgroup is in force: the page is at the loaded structure's own symmetry" });
    for (const id of ["c45@1×1×2", "s18"]) {
      expect((await ex.run("lower_symmetry", { id })).status).toBe("ok");
      const lowered = port.state();
      const out = await ex.run("clear_subgroup", {});
      expect(out.status, out.text).toBe("ok");
      expect(parsed(out.text)).toMatchObject({ spaceGroup: "F-43m #216", positions: "constrained atomic coordinates", lastResultCleared: false });
      // The page the view's ✕ clear leaves (withoutModes) on the lowered page.
      const s = port.state();
      expect(s.modes).toBeNull();
      expect(s.phases[0]!.spaceGroup.hermannMauguin).toBe("F -4 3 m");
      expect(s.phases[0]!.sites.map((x) => x.label)).toEqual(demo.structure.sites.map((x) => x.label));
      // Every row of the parent back, and the setting-free ones (the scale, the instrument, the correlated motion) as before lowering.
      expect(s.parameters.map((p) => p.id).sort()).toEqual(start.params.map((p) => p.id).sort());
      const kept = ["pdfScale", "qdamp", "qbroad", "delta1", "delta2"];
      for (const p of start.params.filter((q) => kept.includes(q.kind))) expect(s.parameters.find((q) => q.id === p.id), p.id).toMatchObject({ value: p.value, fixed: p.fixed });
      expect(lowered.modes).not.toBeNull();
      const step = history.history()!.steps.at(-1)!;
      expect([step.kind, step.actor]).toEqual(["settings", "agent"]);
    }
  });

  it("leaves the page withoutModes leaves, after either kind of child", async () => {
    for (const id of ["c45@1×1×2", "s18"]) {
      const start = demoPage();
      const { ex, port } = agentOn(start);
      await ex.run("list_subgroups", { bound: "1×1×2" });
      expect((await ex.run("lower_symmetry", { id })).status).toBe("ok");
      // The lowered page, rebuilt the view's way from the same row, then cleared the view's way.
      const listing = await port.subgroups!.list(parseBound("1×1×2")!);
      const row = listing.rows.find((r) => r.key === parseRowId(id)!.key)!;
      const viewCleared = withoutModes(activationOf(start, row.action).model);
      await ex.run("clear_subgroup", {});
      expect(port.state()).toEqual(liveStateOf(viewCleared, { busy: false }));
    }
  });
});

describe("the bound, the cell and the ids as the Agent writes them", () => {
  it("reads presets, boxes and P, with x for ×", () => {
    expect(parseBound("1x1x2")).toEqual({ P: [[1, 0, 0], [0, 1, 0], [0, 0, 2]], centring: "P" });
    expect(parseBound("2 × 2 × 2")!.P).toEqual([[2, 0, 0], [0, 2, 0], [0, 0, 2]]);
    expect(parseBound("√2×√2×1")!.P).toEqual([[1, -1, 0], [1, 1, 0], [0, 0, 1]]);
    expect(parseBound("1×3×1")!.P).toEqual([[1, 0, 0], [0, 3, 0], [0, 0, 1]]);
    expect(parseBound("2 0 0; 0 2 0; 0 0 2 (I)")).toEqual({ P: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], centring: "I" });
    expect(parseBound("P = 1 -1 0; 1 1 0; 0 0 2")!.P).toEqual([[1, -1, 0], [1, 1, 0], [0, 0, 2]]);
    expect(parseBound("big")).toBeNull();
    expect(cellKey("1x1x2")).toBe("1×1×2");
    expect(cellKey("Same cell")).toBe("same cell");
    expect(parseRowId("c45@1x1x2")).toEqual({ key: "c45", bound: parseBound("1×1×2") });
    expect(parseRowId("s18")).toEqual({ key: "s18", bound: null });
    expect(parseRowId("c45")).toBeNull();
    // A custom bound round-trips through an id.
    const custom = parseBound("1 -1 0; 1 1 0; 0 0 3")!;
    const id = rowId({ key: "c7", sameCell: false } as Parameters<typeof rowId>[0], custom);
    expect(id).toBe("c7@1 -1 0; 1 1 0; 0 0 3");
    expect(parseRowId(id)!.bound).toEqual(custom);
  });

  it("the tools' schemas take what the descriptions say", () => {
    expect(Object.keys((inputJsonSchema(liveTool("list_subgroups")!) as { properties: object }).properties)).toEqual(["bound", "name", "k", "cell", "all", "offset", "limit"]);
    expect(Object.keys((inputJsonSchema(liveTool("lower_symmetry")!) as { properties: object }).properties)).toEqual(["id", "name", "cell", "variant", "bound"]);
    expect(liveTool("lower_symmetry")!.effect).toBe("change");
    expect(liveTool("clear_subgroup")!.historyStep).toBe("settings");
    expect(liveTool("list_subgroups")!.effect).toBe("read");
  });
});

describe("list_subgroups", () => {
  it("pages a long list, gives the count, and narrows by k-point and cell", async () => {
    const { ex } = agentOn();
    const first = parsed((await ex.run("list_subgroups", { bound: "1×1×2" })).text) as { count: number; rows: { id: string; name: string }[]; more: string; parent: string; bound: string };
    expect([first.parent, first.bound]).toEqual(["F-43m #216", "1×1×2"]);
    expect(first.count).toBeGreaterThan(40);
    expect(first.rows).toHaveLength(20);
    expect(first.rows[0]).toMatchObject({ name: "F23 #196", cell: "same cell" });
    expect(first.more).toBe(`${first.count - 20} more: offset 20`);
    const next = parsed((await ex.run("list_subgroups", { bound: "1×1×2", offset: 20, limit: 5 })).text) as { rows: { id: string }[] };
    expect(next.rows).toHaveLength(5);
    expect(next.rows.some((r) => first.rows.some((f) => f.id === r.id))).toBe(false);
    // X's irreps alone keep F-43m's cell (X is a decentring point); X with W: their coupled pairs in 1×1×2 too.
    const x = parsed((await ex.run("list_subgroups", { bound: "1×1×2", k: ["X"], limit: 50 })).text) as { rows: { id: string; cell: string; irreps: string }[] };
    expect(x.rows.length).toBeGreaterThan(5);
    expect(x.rows.every((r) => r.cell === "same cell")).toBe(true);
    expect(x.rows.map((r) => r.id)).toContain("s18");
    const xw = parsed((await ex.run("list_subgroups", { bound: "1×1×2", k: ["x", "W"], cell: "1x1x2", limit: 50 })).text) as { rows: { cell: string; irreps: string }[] };
    expect(xw.rows.length).toBeGreaterThan(0);
    expect(xw.rows.every((r) => r.cell === "1×1×2")).toBe(true);
    expect(xw.rows.some((r) => /^X irrep 5 .* \+ W irrep 1 /.test(r.irreps))).toBe(true);
  });
});

function patternOf(s: StructureModel): PdfPattern {
  const rGrid = makeRGrid(1.5, 10, 0.05);
  const gr = computeGofR(s.cell, expandStructureAtoms(s), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id: "sto", name: "SrTiO3", scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: gr[i]! })), qdamp: 0.03 };
}
