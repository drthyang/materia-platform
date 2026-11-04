// @vitest-environment happy-dom
/**
 * The Agent lowers the symmetry exactly as the Subgroups view's Activate does.
 * The view is mounted in a DOM on the same structure as the Agent's headless
 * page; a row is picked and its Activate clicked, and the action it hands the
 * page is applied as the page's handler did before the Agent had a tool (one
 * function per path, written out here). The Agent's list_subgroups and
 * lower_symmetry on the same row must leave the same page: the live state the
 * Agent reads (group, cell, sites, modes, every row with its value and free
 * state, the curves and Rw) and the History step, with its label.
 *
 * GaTa₄Se₈ (the bundled demo, F-43m): P-42₁m in 1×1×2 (four classes share the
 * row; Activate takes the default) and P-42₁m at X in the parent's cell.
 * SrTiO₃ (synthetic, Pm-3m) in 2×2×2: Pnma (a⁻b⁺a⁻), I4/mcm and R-3c.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { SubgroupsPanel, decentringIrrepTree, gammaIrrepTree, sameCellLattice } from "@/app/ui/SubgroupsPanel";
import type { PickerAction } from "@/app/ui/subgroupPicker";
import { liveStateOf, pdfPage, withActivatedMode, withSameCellSubgroup, withSubgroup, withSupercellChild, type PdfPageModel } from "@/app/pdfPage";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { srtio3 } from "@/testSupport/perovskiteTilts";
import { executor, fakeHost, headlessHistory, pdfPort } from "@/testSupport/agentHeadless";

// The lattices, irreps and supercell children take seconds each; more on a loaded CI runner.
vi.setConfig({ testTimeout: 300_000 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const text = (h: ParentNode): string => h.textContent ?? "";
const button = (h: ParentNode, label: string): HTMLButtonElement | undefined => [...h.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
const until = async (ok: () => boolean, ms = 240_000): Promise<void> => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
};

/** The view on `structure`, at its parent state, every Activate handing its action to `took`. */
function mountView(structure: StructureModel, took: (a: PickerAction) => void): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(SubgroupsPanel, {
    spaceGroup: structure.spaceGroup.hermannMauguin,
    lattice: structuralSubgroupLattice(structure),
    irrepTree: gammaIrrepTree(structure),
    decentringTree: decentringIrrepTree(structure),
    sameCell: sameCellLattice(structure),
    operations: structure.spaceGroup.operations,
    structure,
    modes: null, modeCount: null, busy: false,
    onActivateMode: (term, sub) => took({ kind: "irrep", term, sub }),
    onActivateSubgroup: (node) => took({ kind: "subgroup", node }),
    onActivateSameCell: (node) => took({ kind: "sameCell", node }),
    onActivateSupercell: (choice) => took({ kind: "supercell", choice }),
    onClear: () => undefined, onOpenModel: () => undefined,
  })));
  act(() => button(host!, "List")!.click());
  return host;
}

/** The bound's preset in the view's select, then the listing worked out to the end. */
async function chooseBound(h: HTMLElement, label: string): Promise<void> {
  const select = h.querySelector<HTMLSelectElement>("select")!;
  const index = [...select.options].findIndex((o) => o.textContent === label);
  act(() => {
    select.value = String(index);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await until(() => new RegExp(`of \\d+ subgroups · fit ${label}`).test(text(h)) && !text(h).includes("so far"));
}

/** Pick the merged row by its key (found by name first) and click its Activate: the action the view hands the page. */
async function activateInView(h: HTMLElement, find: string, key: string, name: string, actions: PickerAction[]): Promise<PickerAction> {
  const input = h.querySelector<HTMLInputElement>('input[aria-label="find a subgroup"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, find);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => h.querySelector<HTMLElement>(`[data-row="${key}"]`)!.click());
  const before = actions.length;
  act(() => h.querySelector<HTMLButtonElement>(`button[aria-label="Activate ${name}"]`)!.click());
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  expect(actions.length).toBe(before + 1);
  return actions.at(-1)!;
}

/** The page's Activate handlers as they were before the Agent had a tool: one path per kind, and the step each recorded. */
function handlerOf(m: PdfPageModel, a: PickerAction): { readonly model: PdfPageModel; readonly step: string } {
  if (a.kind === "irrep") {
    const r = withActivatedMode(m, a.term, a.sub);
    return { model: r.model, step: `Distortion modes: ${r.label}` };
  }
  if (a.kind === "subgroup") {
    const r = withSubgroup(m, a.node);
    return { model: r.model, step: `Distortion modes: ${r.label}` };
  }
  if (a.kind === "sameCell") {
    const r = withSameCellSubgroup(m, a.node);
    return { model: r.model, step: `Distortion modes: ${r.label}` };
  }
  if (a.kind === "supercell") {
    const r = withSupercellChild(m, a.choice);
    return { model: r.model, step: `Supercell child: ${r.label}` };
  }
  throw new Error(a.note);
}

/** An Agent on a headless page holding `start`, with its History. */
function agentOn(start: PdfPageModel) {
  const { port, calls } = pdfPort({ page: start });
  const history = headlessHistory(port);
  const { host: h } = fakeHost(port, history.history, (kind, agent) => history.record(kind, agent ? "agent" : undefined), history.goTo);
  const { ex } = executor(h, "auto");
  const json = async (name: string, input: unknown): Promise<Record<string, unknown>> => {
    const out = await ex.run(name, input);
    expect(out.isError, out.text).toBe(false);
    return JSON.parse(out.text) as Record<string, unknown>;
  };
  return { port, calls, history, ex, json };
}

type Row = { readonly id: string; readonly name: string; readonly cell: string; readonly domains: number; readonly variants?: number };

/** list_subgroups' row for a name, cell and domains count, then lower_symmetry on its id; the page and the step after it. */
async function lowerByAgent(start: PdfPageModel, q: { readonly bound: string; readonly name: string; readonly cell: string; readonly domains: number }) {
  const agent = agentOn(start);
  const listed = await agent.json("list_subgroups", { bound: q.bound, name: q.name, cell: q.cell });
  const rows = (listed.rows as Row[]).filter((r) => r.domains === q.domains);
  expect(rows, JSON.stringify(listed)).toHaveLength(1);
  const out = await agent.json("lower_symmetry", { id: rows[0]!.id });
  const step = agent.history.history()!.steps.at(-1)!;
  return { agent, row: rows[0]!, out, state: agent.port.state(), step };
}

/** The same page: what the Agent reads of it (the live state, curves and Rw included) is equal. */
function expectSamePage(state: ReturnType<ReturnType<typeof pdfPort>["port"]["state"]>, model: PdfPageModel): void {
  const ui = liveStateOf(model, { busy: false });
  expect(state.modes).not.toBeNull();
  expect(state.phases[0]!.spaceGroup.hermannMauguin).toBe(ui.phases[0]!.spaceGroup.hermannMauguin);
  expect(state.phases[0]!.cell).toEqual(ui.phases[0]!.cell);
  expect(state.phases[0]!.sites).toEqual(ui.phases[0]!.sites);
  expect(state.modes!.set.modes).toEqual(ui.modes!.set.modes);
  expect(state.parameters).toEqual(ui.parameters);
  expect(state.bindings).toEqual(ui.bindings);
  expect(state.rw).toBe(ui.rw);
  expect(state).toEqual(ui);
}

/** The modes freed by an activation (its kick), by label. */
const kickedOf = (model: PdfPageModel): string[] => {
  const free = new Set(model.params.filter((p) => !p.fixed).map((p) => p.id));
  return model.modes!.set.modes.filter((m) => free.has(m.id)).map((m) => m.label);
};

function patternOf(s: StructureModel): PdfPattern {
  const rGrid = makeRGrid(1.5, 10, 0.05);
  const gr = computeGofR(s.cell, expandStructureAtoms(s), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id: "sto", name: "SrTiO3", scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: gr[i]! })), qdamp: 0.03 };
}

describe("lower_symmetry is the Subgroups view's Activate on the same row", () => {
  it("GaTa₄Se₈: P-42₁m in 1×1×2 (the row's default of four classes) and P-42₁m at X in the parent's cell", async () => {
    const demo = gata4se8PdfExample();
    const start = (): PdfPageModel => pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams, fitRange: { min: 1.5, max: 6 } } });
    const actions: PickerAction[] = [];
    const h = mountView(demo.structure, (a) => actions.push(a));
    await chooseBound(h, "1×1×2");
    const supercell = await activateInView(h, "P-42_1m", "P -4 21 m #113|1×1×2|24", "P -4 21 m #113", actions);
    const atX = await activateInView(h, "P-42_1m", "P -4 21 m #113|same cell|12", "P -4 21 m #113", actions);
    expect(supercell.kind).toBe("supercell");
    expect(atX.kind).toBe("irrep");

    const ui = handlerOf(start(), supercell);
    const agent = await lowerByAgent(start(), { bound: "1×1×2", name: "P-42_1m", cell: "1×1×2", domains: 24 });
    expect(agent.row).toMatchObject({ name: "P-42₁m #113", cell: "1×1×2", domains: 24, variants: 4 });
    // The class Activate took is the one the Agent lowered to.
    expect(agent.agent.calls).toEqual([`lower ${agent.row.id.replace(/@.*$/, "")}`]);
    expectSamePage(agent.state, ui.model);
    expect([agent.step.label, agent.step.kind, agent.step.actor]).toEqual([ui.step, "settings", "agent"]);
    expect(ui.step).toBe("Supercell child: P -4 21 m #113");
    // The answer: the group, the cell, the sites, the free mode rows and the kicked irreps.
    const lowered = agent.out.lowered as Record<string, unknown>;
    expect(lowered).toMatchObject({ to: "P -4 21 m #113", from: "F-43m #216", cell: "in its own cell, 1×1×2", atoms: 104, modes: 44, kicked: ["X irrep 5 of 5", "W irrep 1 of 4"] });
    expect((lowered.free as string[]).map((f) => f.replace(/^[^:]+: /, ""))).toEqual(kickedOf(ui.model));
    expect(lowered.sites).toEqual(ui.model.modes!.set.parentized.sites.map((x) => `${x.label} ${x.element}`));

    const uiX = handlerOf(start(), atX);
    const agentX = await lowerByAgent(start(), { bound: "1×1×2", name: "P-42_1m", cell: "same cell", domains: 12 });
    expect(agentX.row).toMatchObject({ id: "s18", cell: "same cell", variants: 2 });
    expectSamePage(agentX.state, uiX.model);
    expect([agentX.step.label, agentX.step.actor]).toEqual([uiX.step, "agent"]);
    expect(uiX.step).toMatch(/^Distortion modes: X irrep 5 of 5 → P -4 21 m$/);
  });

  it("SrTiO₃ in 2×2×2: Pnma (a⁻b⁺a⁻), I4/mcm and R-3c", async () => {
    const parent = srtio3();
    const pattern = patternOf(parent);
    const start = (): PdfPageModel => pdfPage(parent, pattern, { preset: { fitRange: { min: 1.5, max: 10 } } });
    const actions: PickerAction[] = [];
    const h = mountView(parent, (a) => actions.push(a));
    await until(() => /of \d+ subgroups · fit 2×2×2/.test(text(h)) && !text(h).includes("so far"));
    for (const c of [
      { find: "Pnma", key: "P n m a #62|2×2×2|24", name: "P n m a #62", domains: 24, label: "Supercell child: P n m a #62" },
      { find: "I4/mcm", key: "I 4/m c m #140|2×2×2|6", name: "I 4/m c m #140", domains: 6, label: "Supercell child: I 4/m c m #140" },
      { find: "R-3c", key: "R -3 c:H #167|2×2×2|8", name: "R -3 c:H #167", domains: 8, label: "Supercell child: R -3 c:H #167" },
    ]) {
      const action = await activateInView(h, c.find, c.key, c.name, actions);
      const ui = handlerOf(start(), action);
      const agent = await lowerByAgent(start(), { bound: "2×2×2", name: c.find, cell: "2×2×2", domains: c.domains });
      expectSamePage(agent.state, ui.model);
      expect([agent.step.label, agent.step.actor], c.find).toEqual([c.label, "agent"]);
      expect(ui.step).toBe(c.label);
      expect((agent.out.lowered as { kicked: string[] }).kicked.length).toBeGreaterThan(0);
    }
  });
});
