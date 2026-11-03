// @vitest-environment happy-dom
/**
 * Which parameter groups are open (ParameterPanel, openOnLoad): a parameter
 * set opens with its groups that have free rows expanded, the others
 * collapsed, so the values and esds being refined are on screen and the card
 * has no empty block under its table. Freeing or fixing a row moves nothing;
 * a group the user closes stays closed, and a new set (another load, an
 * activated child) opens its newly free groups without reopening it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RefinementParameter } from "@/core/refinement/types";
import { ParameterPanel } from "@/app/ui/ParameterPanel";
import { openOnLoad } from "@/app/ui/parameterGroups";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const row = (id: string, kind: RefinementParameter["kind"], fixed: boolean, extra: Partial<RefinementParameter> = {}): RefinementParameter =>
  ({ id, label: id, kind, value: 1, initialValue: 1, fixed, ...extra }) as RefinementParameter;

/** A Rietveld demo's shape: Scale, Background and Lattice free; profile, ADPs and positions fixed. */
const DEMO: RefinementParameter[] = [
  row("scale", "scale", false),
  row("bkg0", "background", false),
  row("bkg1", "background", false),
  row("a", "cellLength", false),
  row("c", "cellLength", false),
  row("sig1", "tofProfile", true),
  row("difc", "tofCalibration", true),
  row("B_Mn", "bIso", true),
  row("x_Mn", "atomX", true),
];

function render(params: readonly RefinementParameter[]): void {
  host ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(host);
  act(() => root!.render(createElement(ParameterPanel, { params, onChange: () => {}, onRefine: () => {}, onReset: () => {}, busy: false, result: null })));
}

/** The groups showing their rows (an open group renders a row input per parameter). */
function openGroups(): string[] {
  return [...host!.querySelectorAll<HTMLElement>("[data-group]")]
    .filter((g) => g.querySelector("input:not([type=checkbox])") !== null)
    .map((g) => g.dataset.group!);
}

const header = (group: string): HTMLElement => host!.querySelector<HTMLElement>(`[data-group="${group}"] > div`)!;

describe("the parameter groups open on load", () => {
  it("opens the groups with a free row and leaves the rest collapsed", () => {
    expect(openOnLoad(DEMO)).toEqual({ Scale: true, Background: true, Lattice: true });
    render(DEMO);
    expect(openGroups()).toEqual(["Scale", "Background", "Lattice"]);
  });

  it("counts neither a fixed row nor a locked one (calibration, a tied row) as free", () => {
    const tied = row("b", "cellLength", false, { expression: "a" });
    const calib = row("difc", "tofCalibration", false);
    expect(openOnLoad([tied, calib, row("B", "bIso", true)])).toEqual({});
  });

  it("keeps what the user decided: freeing a row opens nothing, a closed group stays closed", () => {
    render(DEMO);
    act(() => header("Background").click());
    expect(openGroups()).toEqual(["Scale", "Lattice"]);
    // Free an ADP row: the same set, so nothing reopens or opens.
    render(DEMO.map((p) => (p.id === "B_Mn" ? { ...p, fixed: false } : p)));
    expect(openGroups()).toEqual(["Scale", "Lattice"]);
    // A new set (a child's position rows, free): Positions opens, Background stays closed.
    render([...DEMO.filter((p) => p.kind !== "atomX"), row("mode1", "positionShift", false)]);
    expect(openGroups()).toEqual(["Scale", "Lattice", "Positions"]);
  });

  it("keeps the prior state of every decided group, open or closed", () => {
    expect(openOnLoad(DEMO, { Scale: false, Positions: true })).toEqual({ Scale: false, Positions: true, Background: true, Lattice: true });
  });
});
