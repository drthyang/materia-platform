/**
 * Closing a project: has anything changed since it was last saved, opened or
 * loaded as a demo?
 *
 * The shell keeps a mark of the project as it stood at its last Save, Open or
 * demo load, and compares the live project with it when Close is pressed. A
 * project built from the user's own files, and a session restored from the
 * browser's autosave, have no such mark: they exist nowhere else, so Close asks
 * until they are saved. Three things make up a project in a saved file, so
 * three things are compared:
 *
 *  - the model state — what the step history itself calls a change
 *    (`snapshotKey`, core/project/history.ts: parameter rows, settings, the
 *    last result, the data; display-only fields like the plot unit are not a
 *    change);
 *  - the step history, by its length (steps are only ever appended, and a new
 *    load starts a new history and a new mark), so a refinement undone again
 *    still counts: the step it left is not in the saved file;
 *  - the Agent's records (the method's stages done, the exceptions the user
 *    allowed, its notes), which a project file carries too.
 *
 * Pure functions: the shell supplies the live pieces.
 */

import { snapshotKey, type ProjectHistory, type Snapshot } from "@/core/project/history";

/** The project at one moment, in the three parts above. */
export interface ProjectMark {
  readonly state: string;
  readonly steps: number;
  readonly agent: string;
}

/**
 * The mark of the live project, or null when nothing is loaded (no snapshot).
 * `agentRecords` is the Agent's record map as the shell holds it.
 */
export function markOf(
  snapshot: Snapshot | null,
  history: ProjectHistory | null,
  agentRecords: Readonly<Record<string, unknown>>,
): ProjectMark | null {
  if (!snapshot) return null;
  return {
    state: snapshotKey(snapshot),
    steps: history?.steps.length ?? 0,
    agent: JSON.stringify(Object.entries(agentRecords).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}

/**
 * Are there changes `saved` does not have? Nothing loaded: no. Something
 * loaded but no mark to compare with (nothing saved, opened or loaded as a
 * demo yet): yes, so the guard asks.
 */
export function hasUnsavedChanges(saved: ProjectMark | null, now: ProjectMark | null): boolean {
  if (now === null) return false;
  if (saved === null) return true;
  return now.state !== saved.state || now.steps !== saved.steps || now.agent !== saved.agent;
}
