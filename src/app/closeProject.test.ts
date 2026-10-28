import { describe, it, expect } from "vitest";
import { hasUnsavedChanges, markOf, type ProjectMark } from "@/app/closeProject";
import { recordStep, snapshotKey, type ProjectHistory, type Snapshot } from "@/core/project/history";
import type { StructureModel } from "@/core/crystal/types";
import type { Workspace } from "@/core/project/types";

/** A minimal powder snapshot: one parameter row, the rest as the history's change detection sees it. */
function snapshot(value: number, extra: Record<string, unknown> = {}): Snapshot {
  const structure = { id: "s", name: "S", sites: [] } as unknown as StructureModel;
  const workspace = {
    technique: "powder",
    refinement: {
      parameters: [{ id: "scale", value, fixed: false }],
      bindings: [],
    },
    ...extra,
  } as unknown as Workspace;
  return { structures: [structure], workspace };
}

const NO_AGENT = {};

function history(...values: number[]): ProjectHistory | null {
  let h: ProjectHistory | null = null;
  for (const v of values) h = recordStep(h, { ...snapshot(v), kind: "edit" });
  return h;
}

describe("snapshotKey", () => {
  it("is the same for the same model state, whatever object it comes in", () => {
    expect(snapshotKey(snapshot(1))).toBe(snapshotKey(snapshot(1)));
  });

  it("changes when a parameter value does", () => {
    expect(snapshotKey(snapshot(1))).not.toBe(snapshotKey(snapshot(1.5)));
  });

  it("ignores display-only fields, as the history does", () => {
    expect(snapshotKey(snapshot(1, { displayUnit: "d" }))).toBe(snapshotKey(snapshot(1, { displayUnit: "tof" })));
  });

  it("agrees with recordStep about what is a change", () => {
    const h = history(1);
    expect(recordStep(h, { ...snapshot(1, { displayUnit: "d" }), kind: "edit" })).toBe(h);
    expect(recordStep(h, { ...snapshot(2), kind: "edit" })).not.toBe(h);
  });
});

describe("the Close guard: unsaved changes", () => {
  const mark = (snap: Snapshot | null, h: ProjectHistory | null, agent: Record<string, unknown> = NO_AGENT): ProjectMark | null => markOf(snap, h, agent);

  it("nothing loaded: nothing to lose", () => {
    expect(markOf(null, null, NO_AGENT)).toBeNull();
    expect(hasUnsavedChanges(null, null)).toBe(false);
    expect(hasUnsavedChanges(mark(snapshot(1), history(1)), null)).toBe(false);
  });

  it("clean: the project as saved, opened or loaded as a demo closes without asking", () => {
    const saved = mark(snapshot(1), history(1));
    expect(hasUnsavedChanges(saved, mark(snapshot(1), history(1)))).toBe(false);
  });

  it("dirty: a parameter changed since the save", () => {
    const saved = mark(snapshot(1), history(1));
    expect(hasUnsavedChanges(saved, mark(snapshot(1.2), history(1)))).toBe(true);
  });

  it("dirty: a step was recorded since, even if the model came back to the saved state", () => {
    const saved = mark(snapshot(1), history(1));
    // Refined to 2 (a step), then undone to 1: the live state is the saved one, the step is not in the file.
    expect(hasUnsavedChanges(saved, mark(snapshot(1), history(1, 2)))).toBe(true);
  });

  it("clean: a display-only change (the plot unit) is not a change", () => {
    const saved = mark(snapshot(1), history(1));
    expect(hasUnsavedChanges(saved, mark(snapshot(1, { displayUnit: "d" }), history(1)))).toBe(false);
  });

  it("dirty: the Agent's records moved", () => {
    const saved = mark(snapshot(1), history(1), {});
    expect(hasUnsavedChanges(saved, mark(snapshot(1), history(1), { "powder:1": { stage: "cell" } }))).toBe(true);
  });

  it("the Agent's records compare by content, not by key order", () => {
    const a = mark(snapshot(1), history(1), { x: 1, y: 2 });
    const b = mark(snapshot(1), history(1), { y: 2, x: 1 });
    expect(hasUnsavedChanges(a, b)).toBe(false);
  });

  it("loaded but never marked: asks rather than guess", () => {
    expect(hasUnsavedChanges(null, mark(snapshot(1), history(1)))).toBe(true);
  });

  it("a history that is not there counts as no steps", () => {
    const saved = mark(snapshot(1), null);
    expect(hasUnsavedChanges(saved, mark(snapshot(1), null))).toBe(false);
  });
});
