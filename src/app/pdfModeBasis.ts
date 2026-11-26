/**
 * Reopening a PDF project whose positions refine as the structure's own
 * symmetry-mode amplitudes (Positions → Irreps, no parent and no activation)
 * when the file's mode basis is not the one this build makes.
 *
 * Those amplitudes are not stored with their vectors in force: the page
 * rebuilds the basis from the structure on open (buildSymmetryModes) and
 * overlays the saved values by row id. Until 2026-11-26 that basis lost real
 * modes on some structures (its gauge projected out every direction all the
 * sites allow, not only the rigid translations); the corrected basis has
 * more modes, and its `mode_k` is a different vector. Overlaying the old
 * values by id would bind them to other vectors and move the atoms.
 *
 * The file does keep the vectors: `refinement.bindings` is the spec's
 * bindings at save time. So the saved displacement is rebuilt from them and
 * expressed in this build's basis, which spans everything the old one did
 * (it only removes less), by the same weighted least squares the atomic ↔
 * irreps switch uses (positionShiftValuesFor). The atoms land where they
 * were, to rounding; that is checked. A file whose saved displacement this
 * basis cannot hold, or whose mode rows carry a tie (which cannot be
 * re-expressed row by row), opens with atomic positions instead, the atoms
 * where the file's own vectors and amplitudes put them, when the atomic rows
 * hold them exactly. Where the positions as saved cannot be rebuilt (a mode
 * row missing, vectors on sites the structure lacks; the file stores no
 * refined positions) or the atomic rows cannot hold them, it is refused,
 * never rebound.
 *
 * A workspace whose saved mode bindings already are this build's (every
 * structure the gauge bug did not touch) is returned as it is.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { PdfWorkspace, Workspace } from "@/core/project/types";
import { ProjectFileError } from "@/core/project/validate";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { buildSymmetryModes, positionShiftValuesFor } from "@/core/crystal/distortionModes";
import { buildPdfSpec } from "@/core/workflow/pdf";
import { applyParameters } from "@/core/workflow/apply";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { tieReferences } from "@/core/refinement/constraints";

export type ModeBasisReopen =
  | { readonly kind: "unchanged" }
  | { readonly kind: "converted"; readonly workspace: PdfWorkspace; readonly note: string }
  | { readonly kind: "refused"; readonly message: string };

/** Largest change of an atom position the conversion accepts (Å); rounding is ~1e-16 Å. */
const POSITION_TOLERANCE = 1e-10;

const sameBinding = (a: ParameterBinding, b: ParameterBinding): boolean =>
  a.parameterId === b.parameterId &&
  a.kind === b.kind &&
  a.targetId === b.targetId &&
  a.targetKey === b.targetKey &&
  a.axis !== undefined &&
  b.axis !== undefined &&
  a.axis.length === b.axis.length &&
  a.axis.every((x, i) => x === b.axis![i]);

/** The positionShift bindings in force (the mode vectors), in the spec's order. */
const shiftBindings = (bindings: readonly ParameterBinding[]): ParameterBinding[] => bindings.filter((b) => b.kind === "positionShift");

const values = (rows: readonly RefinementParameter[], ids: ReadonlySet<string>, pick: (p: RefinementParameter) => number): Record<string, number> =>
  Object.fromEntries(rows.filter((p) => ids.has(p.id)).map((p) => [p.id, pick(p)]));

/** Largest Cartesian distance (Å) between the same sites of two placements of one structure. */
function largestMove(structure: StructureModel, a: StructureModel, b: StructureModel): number {
  const M = orthogonalizationMatrix(structure.cell);
  let worst = 0;
  a.sites.forEach((s, i) => {
    const t = b.sites[i]!;
    const d = [0, 1, 2].map((k) => s.position[k]! - t.position[k]!);
    const c = [0, 1, 2].map((r) => M[r]![0]! * d[0]! + M[r]![1]! * d[1]! + M[r]![2]! * d[2]!);
    worst = Math.max(worst, Math.hypot(c[0]!, c[1]!, c[2]!));
  });
  return worst;
}

/**
 * The workspace to reopen: as saved, converted to this build's own-mode
 * basis, or refused. `structures` are the file's (the first is the page's
 * structure, the anchor of its own modes).
 */
export function reopenOwnModeBasis(structures: readonly StructureModel[], ws: PdfWorkspace): ModeBasisReopen {
  // Only the structure's own modes are rebuilt on open: a parent decomposition
  // or an activation stores its whole set, and a multi-phase page refines atoms.
  if (ws.positionMode !== "irreps" || ws.distortionModes || structures.length !== 1) return { kind: "unchanged" };
  const structure = structures[0]!;
  const set = buildSymmetryModes(structure);
  if (set.modes.length === 0) return { kind: "unchanged" };
  const saved = shiftBindings(ws.refinement.bindings);
  const now = set.bindings;
  if (saved.length === now.length && saved.every((b, i) => sameBinding(b, now[i]!))) return { kind: "unchanged" };

  const refuse = (why: string): ModeBasisReopen => ({
    kind: "refused",
    message: `its positions refine as symmetry-mode amplitudes on an earlier mode basis, and ${why}, so they cannot be carried to this version's basis exactly. Open it in the version that saved it, set Positions to Atomic, save, and open that file`,
  });
  const rows = ws.refinement.parameters;
  const oldIds = new Set(saved.map((b) => b.parameterId));
  // Without the file's own vectors on this structure's sites and every amplitude, the
  // positions as saved cannot be rebuilt (the file stores no refined positions): refused.
  if (saved.length === 0 || saved.some((b) => b.targetId !== structure.id || !b.axis || !structure.sites.some((s) => s.label === b.targetKey))) {
    return refuse("its mode rows do not match this structure's sites");
  }
  if (![...oldIds].every((id) => rows.some((p) => p.id === id))) return refuse("a mode row is missing from the file");
  // From here the positions as saved are known exactly (the file's own vectors and amplitudes).
  // Where this build's modes cannot carry them, they open as atomic positions, when those hold them exactly.
  const asAtomic = (why: string): ModeBasisReopen => atomicReopen(structure, ws, saved, oldIds) ?? refuse(why);
  const tied = rows.filter((p) => p.expression && (oldIds.has(p.id) || tieReferences(p.expression).some((r) => oldIds.has(r))));
  if (tied.length > 0) return asAtomic(`a tie involves its mode rows (${tied.map((p) => p.id).join(", ")})`);

  // The saved displacement, rebuilt from the saved vectors, in this build's basis.
  const convert = (pick: (p: RefinementParameter) => number): { readonly values: Record<string, number>; readonly moved: number } => {
    const placed = applyParameters(structure, saved, values(rows, oldIds, pick)).model;
    const v = positionShiftValuesFor(structure, now, placed);
    const again = applyParameters(structure, now, v).model;
    return { values: v, moved: largestMove(structure, placed, again) };
  };
  const value = convert((p) => p.value);
  const initial = convert((p) => p.initialValue);
  const moved = Math.max(value.moved, initial.moved);
  if (!(moved <= POSITION_TOLERANCE)) return asAtomic(`this version's modes reproduce its atom positions only to ${moved.toExponential(1)} Å`);

  // Free/fixed: kept when every saved mode row shared it; a mix cannot be
  // re-expressed row by row, so every row is reopened fixed.
  const freeSaved = rows.filter((p) => oldIds.has(p.id)).map((p) => !p.fixed);
  const allFree = freeSaved.every((f) => f);
  const mixed = !allFree && freeSaved.some((f) => f);
  const modeRows: RefinementParameter[] = set.parameters.map((p) => ({
    ...p,
    value: value.values[p.id] ?? 0,
    initialValue: initial.values[p.id] ?? 0,
    fixed: !allFree,
  }));
  const parameters = [...rows.filter((p) => !oldIds.has(p.id)), ...modeRows];
  const bindings = [...ws.refinement.bindings.filter((b) => b.kind !== "positionShift"), ...now];
  // The last fit's statistics and the last boxcar scan belong to the old rows: they are not carried over.
  const { lastResult: _lastResult, ...refinement } = ws.refinement;
  const boxcar = ws.boxcar ? { plan: ws.boxcar.plan } : undefined;
  const workspace: PdfWorkspace = { ...ws, refinement: { ...refinement, parameters, bindings }, ...(boxcar ? { boxcar } : {}) };
  const cleared = ws.refinement.lastResult || ws.boxcar?.lastRun ? "; the last fit's result was cleared, refine again" : "";
  return {
    kind: "converted",
    workspace,
    note: `Reopened on the corrected mode basis (${set.modes.length} modes; the file had ${oldIds.size}): the atom positions are unchanged${mixed ? "; every mode row is now fixed, free the ones to refine" : ""}${cleared}.`,
  };
}

/** The notice of a workspace opened with atomic positions in place of its earlier-basis modes. */
export const ATOMIC_REOPEN_NOTE = "Opened with atomic positions: its mode amplitudes were on an earlier basis that cannot be carried exactly; the positions are as saved, its mode ties and free/fixed choices were not kept.";

/**
 * The workspace with atomic positions in place of its own-mode rows, the
 * atoms where the file's own vectors and amplitudes put them (values and
 * initial values); null when the atomic rows cannot hold them to
 * POSITION_TOLERANCE (a vector off the symmetry-allowed space). The mode rows
 * go, with every tie that reads them; the atomic rows take the spec's
 * free/fixed. The last fit's result and boxcar scan belong to the old rows.
 */
function atomicReopen(structure: StructureModel, ws: PdfWorkspace, saved: readonly ParameterBinding[], oldIds: ReadonlySet<string>): ModeBasisReopen | null {
  const rows = ws.refinement.parameters;
  const spec = buildPdfSpec(structure, ws.pattern);
  const atomicBindings = shiftBindings(spec.bindings);
  const atomicIds = new Set(atomicBindings.map((b) => b.parameterId));
  const convert = (pick: (p: RefinementParameter) => number): Record<string, number> | null => {
    const placed = applyParameters(structure, saved, values(rows, oldIds, pick)).model;
    const v = positionShiftValuesFor(structure, atomicBindings, placed);
    return largestMove(structure, placed, applyParameters(structure, atomicBindings, v).model) <= POSITION_TOLERANCE ? v : null;
  };
  const value = convert((p) => p.value);
  const initial = convert((p) => p.initialValue);
  if (!value || !initial) return null;
  const untied = (p: RefinementParameter): RefinementParameter => {
    if (!p.expression || !tieReferences(p.expression).some((r) => oldIds.has(r))) return p;
    const { expression: _e, group: _g, ...rest } = p;
    return rest;
  };
  const atomicRows = spec.params.filter((p) => atomicIds.has(p.id)).map((p) => ({ ...p, value: value[p.id] ?? 0, initialValue: initial[p.id] ?? 0 }));
  const parameters = [...rows.filter((p) => !oldIds.has(p.id)).map(untied), ...atomicRows];
  const bindings = [...ws.refinement.bindings.filter((b) => b.kind !== "positionShift"), ...atomicBindings];
  const { lastResult: _lastResult, ...refinement } = ws.refinement;
  const boxcar = ws.boxcar ? { plan: ws.boxcar.plan } : undefined;
  const workspace: PdfWorkspace = { ...ws, positionMode: "atomic", refinement: { ...refinement, parameters, bindings }, ...(boxcar ? { boxcar } : {}) };
  return { kind: "converted", workspace, note: ATOMIC_REOPEN_NOTE };
}

/**
 * A file's workspace as the app reopens it (a project, an autosave, a history
 * step): a PDF workspace on an earlier own-mode basis converted, with the note
 * to show; throws ProjectFileError, with the plain reason, when it is refused.
 */
export function reopenedWorkspace(structures: readonly StructureModel[], ws: Workspace): { readonly workspace: Workspace; readonly note: string | null } {
  if (ws.technique !== "pdf") return { workspace: ws, note: null };
  const r = reopenOwnModeBasis(structures, ws);
  if (r.kind === "refused") throw new ProjectFileError(r.message);
  return r.kind === "converted" ? { workspace: r.workspace, note: r.note } : { workspace: ws, note: null };
}
