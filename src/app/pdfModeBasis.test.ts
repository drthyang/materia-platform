/**
 * Reopening PDF projects saved with positions as the structure's own mode
 * amplitudes on the earlier mode basis (pdfModeBasis.ts).
 *
 * The fixtures in fixtures/ownModeBasis were written by main 8003787 (the
 * version before the gauge fix, through the app's own save path:
 * workspaceOf → projectFileFor → serializeProject) on synthetic structures:
 *  - sns-pnma-own-modes: SnS-type Pnma (every site on 4c), Positions → Irreps,
 *    main's basis 2 of the 4 modes, one free and fitted, one fixed at a set
 *    value with a different initial value;
 *  - fesi-p213-own-modes: FeSi-type P2₁3, main's basis 1 of 2, free, fitted;
 *  - pnma-own-modes-unaffected: a Pnma structure with a pinned site, where
 *    main's basis is this build's;
 *  - pnma-p212121-activated: that structure lowered to P2₁2₁2₁ (main's set,
 *    9 of the 12 modes), the activated set stored with the project.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfWorkspace } from "@/core/project/types";
import type { ParameterBinding } from "@/core/refinement/types";
import { parseProject, serializeProject, ProjectFileError } from "@/core/project/io";
import { applyParameters } from "@/core/workflow/apply";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { pageView, pdfPage, withParameter, withPositionMode, withReset, workspaceOf } from "@/app/pdfPage";
import { ATOMIC_REOPEN_NOTE, reopenOwnModeBasis, reopenedWorkspace } from "@/app/pdfModeBasis";
import { syntheticPattern } from "@/testSupport/sameCellModeCount";
import { projectFileFor } from "@/app/projectIo";

const fixture = (name: string): string => readFileSync(`src/app/fixtures/ownModeBasis/${name}.materia.json`, "utf8");
const open = (name: string): { structure: StructureModel; ws: PdfWorkspace } => {
  const file = parseProject(fixture(name));
  if (file.workspace.technique !== "pdf") throw new Error("not a PDF project");
  return { structure: file.structures[0]!, ws: file.workspace };
};
const shifts = (bs: readonly ParameterBinding[]): ParameterBinding[] => bs.filter((b) => b.kind === "positionShift");
/** The atoms where the file put them: its own mode vectors and values on its structure (what main reopened). */
const saved = (structure: StructureModel, ws: PdfWorkspace, pick: "value" | "initialValue" = "value"): StructureModel =>
  applyParameters(structure, shifts(ws.refinement.bindings), Object.fromEntries(ws.refinement.parameters.map((p) => [p.id, p[pick]]))).model;
/** Largest distance between the same sites, in Å and in fractional coordinates. */
function gap(structure: StructureModel, a: StructureModel, b: StructureModel): { readonly angstrom: number; readonly fractional: number } {
  const M = orthogonalizationMatrix(structure.cell);
  let angstrom = 0;
  let fractional = 0;
  expect(a.sites.map((s) => s.label)).toEqual(b.sites.map((s) => s.label));
  a.sites.forEach((s, i) => {
    const d = [0, 1, 2].map((k) => s.position[k]! - b.sites[i]!.position[k]!);
    fractional = Math.max(fractional, ...d.map(Math.abs));
    const c = [0, 1, 2].map((r) => M[r]![0]! * d[0]! + M[r]![1]! * d[1]! + M[r]![2]! * d[2]!);
    angstrom = Math.max(angstrom, Math.hypot(c[0]!, c[1]!, c[2]!));
  });
  return { angstrom, fractional };
}

describe("a project on the earlier own-mode basis reopens with its atoms where they were", () => {
  it("SnS-type Pnma: 2 saved modes → 4, positions identical to 1e-12; a mix of free and fixed reopens fixed; the last fit cleared", () => {
    const { structure, ws } = open("sns-pnma-own-modes");
    expect(shifts(ws.refinement.bindings).map((b) => b.parameterId)).toEqual(["mode_1", "mode_1", "mode_2", "mode_2"]);
    const r = reopenedWorkspace([structure], ws);
    expect(r.note).toBe("Reopened on the corrected mode basis (4 modes; the file had 2): the atom positions are unchanged; every mode row is now fixed, free the ones to refine; the last fit's result was cleared, refine again.");
    const m = pdfPage(structure, ws.pattern, { restore: r.workspace as PdfWorkspace });
    const v = pageView(m);
    expect(v.modeSet!.modes).toHaveLength(4);
    const now = v.refinedPhases[0]!;
    const g = gap(structure, now, saved(structure, ws));
    expect(g.fractional).toBeLessThan(1e-12);
    expect(g.angstrom).toBeLessThan(1e-12);
    // The initial values too: Reset lands where the file's Reset did.
    const reset = pageView(withReset(m)).refinedPhases[0]!;
    expect(gap(structure, reset, saved(structure, ws, "initialValue")).angstrom).toBeLessThan(1e-12);
    const modeRows = m.params.filter((p) => p.kind === "positionShift");
    expect(modeRows.map((p) => p.id)).toEqual(["mode_1", "mode_2", "mode_3", "mode_4"]);
    expect(modeRows.every((p) => p.fixed)).toBe(true);
    expect(m.result).toBeNull();
    // Nothing else of the file changed: every other row as saved.
    const others = (rows: readonly { id: string; kind: string }[]) => rows.filter((p) => p.kind !== "positionShift");
    expect(others(m.params)).toEqual(others(ws.refinement.parameters.map((p) => { const { esd: _e, ...rest } = p; return rest; })).map((p) => expect.objectContaining(p)));
  });

  it("FeSi-type P2₁3: 1 saved mode → 2, free kept free, positions identical to 1e-12", () => {
    const { structure, ws } = open("fesi-p213-own-modes");
    const r = reopenedWorkspace([structure], ws);
    expect(r.note).toBe("Reopened on the corrected mode basis (2 modes; the file had 1): the atom positions are unchanged; the last fit's result was cleared, refine again.");
    const m = pdfPage(structure, ws.pattern, { restore: r.workspace as PdfWorkspace });
    const g = gap(structure, pageView(m).refinedPhases[0]!, saved(structure, ws));
    expect(g.fractional).toBeLessThan(1e-12);
    expect(g.angstrom).toBeLessThan(1e-12);
    expect(m.params.filter((p) => p.kind === "positionShift").map((p) => p.fixed)).toEqual([false, false]);
    // The curve follows the atoms: the same G(r) as the file's geometry.
    const atomsAsSaved = pdfPage(structure, ws.pattern, { restore: { ...ws, positionMode: "atomic" } });
    expect(Math.abs(pageView(m).rw - pageView({ ...atomsAsSaved, loaded: saved(structure, ws) }).rw)).toBeLessThan(1e-12);
  });

  it("the page converts a workspace handed to it unconverted (any reopen path) the same way", () => {
    const { structure, ws } = open("sns-pnma-own-modes");
    const direct = pdfPage(structure, ws.pattern, { restore: ws });
    const viaShell = pdfPage(structure, ws.pattern, { restore: reopenedWorkspace([structure], ws).workspace as PdfWorkspace });
    expect(direct.params).toEqual(viaShell.params);
    expect(gap(structure, pageView(direct).refinedPhases[0]!, saved(structure, ws)).angstrom).toBeLessThan(1e-12);
  });

  it("saved again, it reopens as saved (no second conversion)", () => {
    const { structure, ws } = open("fesi-p213-own-modes");
    const m = pdfPage(structure, ws.pattern, { restore: reopenedWorkspace([structure], ws).workspace as PdfWorkspace });
    const text = serializeProject(projectFileFor({ structures: [structure], workspace: workspaceOf(m), title: "again" }));
    const again = parseProject(text);
    expect(reopenOwnModeBasis(again.structures, again.workspace as PdfWorkspace)).toEqual({ kind: "unchanged" });
    const m2 = pdfPage(structure, ws.pattern, { restore: again.workspace as PdfWorkspace });
    expect(m2.params).toEqual(m.params);
  });
});

describe("what is not converted", () => {
  it("a structure the gauge fix does not change: the workspace is returned as it is, rows as saved", () => {
    const { structure, ws } = open("pnma-own-modes-unaffected");
    expect(reopenOwnModeBasis([structure], ws)).toEqual({ kind: "unchanged" });
    const r = reopenedWorkspace([structure], ws);
    expect(r.workspace).toBe(ws);
    expect(r.note).toBeNull();
    const m = pdfPage(structure, ws.pattern, { restore: ws });
    expect(pageView(m).bindings.filter((b) => b.kind === "positionShift")).toEqual(shifts(ws.refinement.bindings));
    expect(gap(structure, pageView(m).refinedPhases[0]!, saved(structure, ws)).angstrom).toBe(0);
  });

  it("an activated mode set stored with the project keeps its basis: the set as saved, the atoms where they were", () => {
    const { structure, ws } = open("pnma-p212121-activated");
    expect(ws.distortionModes?.fromActivation).toBe(true);
    expect(ws.distortionModes!.set.modes).toHaveLength(9);
    expect(reopenOwnModeBasis([structure], ws)).toEqual({ kind: "unchanged" });
    const m = pdfPage(structure, ws.pattern, { restore: ws });
    const v = pageView(m);
    expect(v.modeSet).toEqual(ws.distortionModes!.set);
    const child = ws.distortionModes!.set.parentized;
    const atSave = applyParameters(child, shifts(ws.refinement.bindings), Object.fromEntries(ws.refinement.parameters.map((p) => [p.id, p.value]))).model;
    expect(gap(child, v.refinedPhases[0]!, atSave).angstrom).toBe(0);
  });

  it("atomic positions are never touched", () => {
    const { structure, ws } = open("sns-pnma-own-modes");
    expect(reopenOwnModeBasis([structure], { ...ws, positionMode: "atomic" })).toEqual({ kind: "unchanged" });
  });
});

describe("where this build's modes cannot carry it: atomic positions when exact, else refused", () => {
  const refusal = (ws: PdfWorkspace, structure: StructureModel): string => {
    try {
      reopenedWorkspace([structure], ws);
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectFileError);
      return (e as Error).message;
    }
    throw new Error("not refused");
  };
  const REFUSAL = (why: string): string =>
    `its positions refine as symmetry-mode amplitudes on an earlier mode basis, and ${why}, so they cannot be carried to this version's basis exactly. Open it in the version that saved it, set Positions to Atomic, save, and open that file`;
  /** Opened with atomic positions: the notice, the mode, the atoms as the file's own rows put them (values and initial values). */
  const expectAtomic = (structure: StructureModel, ws: PdfWorkspace): ReturnType<typeof pdfPage> => {
    const r = reopenedWorkspace([structure], ws);
    expect(r.note).toBe(ATOMIC_REOPEN_NOTE);
    expect(r.note).toBe("Opened with atomic positions: its mode amplitudes were on an earlier basis that cannot be carried exactly; the positions are as saved, its mode ties and free/fixed choices were not kept.");
    const m = pdfPage(structure, ws.pattern, { restore: r.workspace as PdfWorkspace });
    expect(m.positionMode).toBe("atomic");
    expect(pageView(m).modeSet).toBeNull();
    expect(m.params.some((p) => /^mode_/.test(p.id) || (p.expression ?? "").includes("mode_"))).toBe(false);
    const g = gap(structure, pageView(m).refinedPhases[0]!, saved(structure, ws));
    expect(g.angstrom).toBeLessThan(1e-12);
    expect(g.fractional).toBeLessThan(1e-12);
    expect(gap(structure, pageView(withReset(m)).refinedPhases[0]!, saved(structure, ws, "initialValue")).angstrom).toBeLessThan(1e-12);
    expect(m.result).toBeNull();
    // The page reaches the same state from the unconverted workspace.
    expect(pdfPage(structure, ws.pattern, { restore: ws }).params).toEqual(m.params);
    return m;
  };

  it("a tie on a mode row: atomic positions, the tie and free/fixed not kept", () => {
    const { structure, ws } = open("sns-pnma-own-modes");
    const tied: PdfWorkspace = { ...ws, refinement: { ...ws.refinement, parameters: ws.refinement.parameters.map((p) => (p.id === "mode_2" ? { ...p, expression: "= mode_1", group: "user-tie" } : p)) } };
    const m = expectAtomic(structure, tied);
    // The atomic rows take the spec's free/fixed (positions fixed).
    expect(m.params.filter((p) => p.kind === "positionShift").every((p) => p.fixed)).toBe(true);
  });

  it("this basis reproduces the positions only to x Å, the atomic rows exactly (a rigid shift along a polar axis in the file's vectors): atomic positions", () => {
    // P2₁ (polar along b), two general sites: the file's mode_1 carries a uniform b shift of every site,
    // which this build's modes leave out (a rigid translation) and the atomic rows hold.
    const s: StructureModel = {
      id: "p21", name: "p21", cell: { a: 5.1, b: 6.2, c: 7.3, alpha: 90, beta: 101, gamma: 90 }, spaceGroup: buildSpaceGroup(4),
      sites: [
        { label: "A", element: "Fe", position: [0.11, 0.23, 0.31], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
        { label: "X", element: "O", position: [0.62, 0.41, 0.83], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
      ],
    };
    let page = withPositionMode(pdfPage(s, syntheticPattern(s), { preset: { fitRange: { min: 1.5, max: 8 } } }), "irreps");
    page = withParameter(page, "mode_1", { value: 0.04, initialValue: 0.01, fixed: false });
    const base = workspaceOf(page);
    const shifted: PdfWorkspace = { ...base, refinement: { ...base.refinement, bindings: base.refinement.bindings.map((b) => (b.kind === "positionShift" && b.parameterId === "mode_1" ? { ...b, axis: [b.axis![0], b.axis![1] + 0.05, b.axis![2]] as [number, number, number] } : b)) } };
    expect(reopenOwnModeBasis([s], shifted).kind).toBe("converted");
    expectAtomic(s, shifted);
  });

  it("this basis and the atomic rows both fail (a vector off the symmetry-allowed space): refused", () => {
    const { structure, ws } = open("fesi-p213-own-modes");
    const off: PdfWorkspace = { ...ws, refinement: { ...ws.refinement, bindings: ws.refinement.bindings.map((b) => (b.kind === "positionShift" && b.targetKey === "Fe" ? { ...b, axis: [0.05, 0, 0] } : b)) } };
    expect(refusal(off, structure)).toMatch(/^its positions refine as symmetry-mode amplitudes on an earlier mode basis, and this version's modes reproduce its atom positions only to \d\.\de-\d+ Å, so they cannot be carried to this version's basis exactly\. Open it in the version that saved it, set Positions to Atomic, save, and open that file$/);
  });

  it("mode vectors on sites the structure does not have: the positions as saved cannot be rebuilt, refused", () => {
    const { structure, ws } = open("fesi-p213-own-modes");
    const other: PdfWorkspace = { ...ws, refinement: { ...ws.refinement, bindings: ws.refinement.bindings.map((b) => (b.kind === "positionShift" && b.targetKey === "Si" ? { ...b, targetKey: "Ge" } : b)) } };
    expect(refusal(other, structure)).toBe(REFUSAL("its mode rows do not match this structure's sites"));
    expect(() => pdfPage(structure, ws.pattern, { restore: other })).toThrow(/cannot be reopened/);
  });

  it("a mode row missing from the file (its amplitude unknown, no positions stored): refused", () => {
    const { structure, ws } = open("sns-pnma-own-modes");
    const missing: PdfWorkspace = { ...ws, refinement: { ...ws.refinement, parameters: ws.refinement.parameters.filter((p) => p.id !== "mode_2") } };
    expect(refusal(missing, structure)).toBe(REFUSAL("a mode row is missing from the file"));
  });
});
