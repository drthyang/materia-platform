/**
 * A saved project is read by the rule a structure file is read with: a
 * project saved from the rounded Mn₃Ga CIF before the snap opens on exactly the
 * geometry the CIF loads with now, and says so in the same line. A PDF
 * workspace with a distortion-mode set in force keeps its primary phase as
 * saved (the set stores its own anchor).
 */
import { describe, expect, it } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import type { Workspace } from "@/core/project/types";
import { parseProject, serializeProject } from "@/core/project/io";
import { newSession, DEFAULT_INSTRUMENT } from "@/app/powderSession";
import { powderWorkspaceFrom, projectFileFor } from "@/app/projectIo";
import { snapProjectStructures } from "@/app/snapOnOpen";
import { snapNote } from "@/app/snapNote";
import { parseCifWithSnaps } from "@/parsers/cif";
import { MN3GA_CIF } from "@/examples/mn3ga";

const loaded = parseCifWithSnaps(MN3GA_CIF, "mn3ga");
/** Mn₃Ga as the CIF prints it, as a project saved before the snap stores it. */
const printed: StructureModel = { ...loaded.structure, sites: loaded.structure.sites.map((s) => ({ ...s, position: loaded.snapped.find((x) => x.label === s.label)?.from ?? s.position })) };

function saved(structure: StructureModel) {
  const session = newSession(structure, DEFAULT_INSTRUMENT);
  const ws = powderWorkspaceFrom(session, null, DEFAULT_INSTRUMENT, false, { fitRange: null, displayUnit: null, manualPeakD: [] });
  return parseProject(serializeProject(projectFileFor({ structures: [session.structure], workspace: ws, title: "t", agentRecords: [] })));
}

describe("a project snapped on open", () => {
  it("opens on the geometry its CIF loads with, bit for bit, and says which sites moved", () => {
    const file = saved(printed);
    expect(file.structures[0]!.sites.map((s) => s.position)).toEqual([[0.16393, 0.32775, 0.25], [0.3333, 0.6667, 0.75]]);
    const open = snapProjectStructures(file.structures, file.workspace);
    expect(open.structures[0]!.sites.map((s) => s.position)).toEqual(loaded.structure.sites.map((s) => s.position));
    expect(open.snapped.map((s) => [s.label, s.shiftAngstrom])).toEqual(loaded.snapped.map((s) => [s.label, s.shiftAngstrom]));
    expect(snapNote(open.snapped, "mn3ga.materia.json")).toBe("Placed 2 sites exactly on their special positions (mn3ga.materia.json rounds them): Mn1 moved 0.00030 Å, Ga1 0.00031 Å.");
  });

  it("leaves a project saved on exact positions as it is", () => {
    const file = saved(loaded.structure);
    const open = snapProjectStructures(file.structures, file.workspace);
    expect(open.snapped).toEqual([]);
    expect(open.structures).toBe(file.structures);
  });

  it("keeps a PDF primary phase with a distortion-mode set in force as saved; the other phases are snapped", () => {
    const withModes = { technique: "pdf", distortionModes: { parentName: "P" } } as unknown as Workspace;
    const plain = { technique: "pdf" } as unknown as Workspace;
    const both = [printed, { ...printed, id: "second" }];
    const kept = snapProjectStructures(both, withModes);
    expect(kept.structures[0]).toBe(printed);
    expect(kept.structures[1]!.sites.map((s) => s.position)).toEqual(loaded.structure.sites.map((s) => s.position));
    expect(kept.snapped).toHaveLength(2);
    expect(snapProjectStructures(both, plain).snapped).toHaveLength(4);
  });
});
