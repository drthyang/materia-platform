import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCif, parseCifWithSnaps, parseMagneticCif } from "@/parsers/cif";
import { snapToSpecialPositions, specialPositionOf, SNAP_TOLERANCE } from "@/core/crystal/specialPositions";
import { equivalentPositions } from "@/core/crystal/symmetry";
import { cif } from "@/agent/validation/simulate";
import { MN3GA_CIF } from "@/examples/mn3ga";
import { GATA4SE8_CIF } from "@/examples/gata4se8PdfData";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import type { StructureModel } from "@/core/crystal/types";

/**
 * Snap on load (specialPositions.ts): a site the engine reads as special
 * within its 1e-3 is placed on the special position exactly, the nearest
 * point of it; a site already exact keeps its printed bits; a free site,
 * however near a special position, beyond the tolerance stays as printed.
 */
const repo = (f: string): string => readFileSync(resolve(__dirname, "../../..", f), "utf8");
const third = 1 / 3;

describe("snap on load", () => {
  it("the bundled Mn₃Ga CIF: Ga at (0.3333, 0.6667) on (⅓, ⅔), Mn's y = 2x − 1.1e-4 on y = 2x at the nearest point (x = y/2)", () => {
    const { structure, snapped } = parseCifWithSnaps(MN3GA_CIF, "mn3ga");
    expect(snapped.map((s) => s.label)).toEqual(["Mn1", "Ga1"]);
    const mn = structure.sites.find((s) => s.label === "Mn1")!.position;
    const ga = structure.sites.find((s) => s.label === "Ga1")!.position;
    expect(mn[1]).toBe(0.32775);
    expect(mn[0]).toBeCloseTo(0.32775 / 2, 15);
    expect(mn[2]).toBe(0.25);
    expect(ga[0]).toBeCloseTo(third, 15);
    expect(ga[1]).toBeCloseTo(2 * third, 15);
    expect(ga[2]).toBe(0.75);
    // By how much: 5.5e-5 and 3.3e-5 of a cell edge, 3.0e-4 and 3.1e-4 Å.
    expect(snapped.map((s) => s.shift.toExponential(1))).toEqual(["5.5e-5", "3.3e-5"]);
    expect(snapped.map((s) => s.shiftAngstrom.toExponential(1))).toEqual(["3.0e-4", "3.1e-4"]);
    // Every operation that fixes a site within the tolerance now fixes it exactly.
    for (const s of structure.sites) {
      expect(equivalentPositions(structure.spaceGroup.operations, s.position, 1e-12)).toHaveLength(equivalentPositions(structure.spaceGroup.operations, s.position).length);
    }
  });

  it("the same text as examples/mcp/mn3ga.cif, and the 350 K Cmcm CIF's Mn1_1 x = 0.50005 on ½", () => {
    expect(parseCif(repo("examples/mcp/mn3ga.cif"), "m").sites).toEqual(parseCif(MN3GA_CIF, "m").sites);
    const { structure, snapped } = parseCifWithSnaps(repo("examples/mn3ga-350k/Mn3Ga_350K_nuclear.cif"), "c");
    expect(snapped.map((s) => [s.label, s.from[0], s.to[0]])).toEqual([["Mn1_1", 0.50005, 0.5]]);
    expect(structure.sites.find((s) => s.label === "Mn1_1")!.position).toEqual([0.5, 0.66388, 0.75]);
  });

  it("an mCIF snaps under the group it carries (the BNS group's spatial parts)", () => {
    const { structure, snapped } = parseMagneticCif(repo("examples/mn3ga-350k/Mn3Ga_350K_workbench_refined.mcif"), "m");
    expect(snapped.map((s) => s.label)).toEqual(["Mn1_1"]);
    expect(structure.sites.find((s) => s.label === "Mn1_1")!.position[0]).toBe(0.5);
  });

  it("the ZnO validation fixture's 0.33333, 0.66667 on ⅓, ⅔; its free z kept", () => {
    const text = cif("ZnO", [3.2496, 3.2496, 5.2042, 90, 90, 120], "P 63 m c", ["Zn1 Zn 0.33333 0.66667 0 1 0.55", "O1 O 0.33333 0.66667 0.3819 1 0.65"]);
    const { structure, snapped } = parseCifWithSnaps(text, "zno");
    expect(snapped.map((s) => s.label)).toEqual(["Zn1", "O1"]);
    for (const s of structure.sites) {
      expect(s.position[0]).toBeCloseTo(third, 15);
      expect(s.position[1]).toBeCloseTo(2 * third, 15);
    }
    expect(structure.sites.map((s) => s.position[2])).toEqual([0, 0.3819]);
  });

  it("a file already exact is read bit for bit, the very same object (the GaTa₄Se₈ demo)", () => {
    const s = parseCif(GATA4SE8_CIF, "g");
    const again = snapToSpecialPositions(s);
    expect(again.snapped).toEqual([]);
    expect(again.structure).toBe(s);
  });

  it("a free site near a special position is not snapped beyond the tolerance: the engine's own reading decides", () => {
    // P6₃/mmc, 6h (x, 2x, ¼): Mn's y off 2x by 1.1e-4 snaps (its mirror image is 2.2e-4 away);
    // off by 2e-3 it is a free 12k-like site the engine counts as general, and stays as printed.
    const sg = buildSpaceGroup("P 63/m m c");
    const at = (y: number, z = 0.25): StructureModel => ({
      id: "t", name: "t", cell: { a: 5.42, b: 5.42, c: 4.38, alpha: 90, beta: 90, gamma: 120 }, spaceGroup: sg,
      sites: [{ label: "Mn1", element: "Mn", position: [0.16393, y, z], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } }],
    });
    const ops = sg.operations;
    expect(specialPositionOf(ops, [0.16393, 0.32775, 0.25])).not.toBeNull();
    for (const [y, z] of [[0.32786 + 0.002, 0.25], [0.32786, 0.2508], [0.32786 - 0.0015, 0.25]] as const) {
      const pos: [number, number, number] = [0.16393, y, z];
      // The engine reads it as less special than the position it is near …
      expect(equivalentPositions(ops, pos).length).toBeGreaterThan(equivalentPositions(ops, [0.16393, 0.32786, 0.25]).length);
      // … and the snap leaves it where the file puts it.
      const r = snapToSpecialPositions(at(y, z));
      expect(r.snapped).toEqual([]);
      expect(r.structure.sites[0]!.position).toEqual(pos);
    }
    // z = 0.2504: its mirror image (z = 0.2496) is 8e-4 away, within the engine's 1e-3: on the mirror.
    expect(snapToSpecialPositions(at(0.32786, 0.2504)).structure.sites[0]!.position[2]).toBe(0.25);
    expect(SNAP_TOLERANCE).toBe(1e-3);
  });

  it("a general position is never moved", () => {
    const sg = buildSpaceGroup("P 63/m m c");
    const s: StructureModel = {
      id: "g", name: "g", cell: { a: 5, b: 5, c: 4, alpha: 90, beta: 90, gamma: 120 }, spaceGroup: sg,
      sites: [{ label: "X", element: "C", position: [0.1234, 0.4567, 0.0891], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } }],
    };
    expect(snapToSpecialPositions(s).structure).toBe(s);
  });
});
