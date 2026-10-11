import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import type { StructureModel } from "@/core/crystal/types";
import { bondEsds, freePlan, matchIds, parameterSummary } from "@/agent/liveCommon";
import type { RefinementParameter } from "@/core/refinement/types";

const row = (id: string): RefinementParameter => ({ id, label: id, kind: "scale", value: 1, initialValue: 1, fixed: true });

describe("matching parameter ids", () => {
  // A two-phase model, as NAC with fluorite on 11-BM (round 10): "pos_*" matched nothing.
  const params = ["p0_scale", "p0_cell_a", "p0_pos_Ca1_0", "p0_pos_F1_0", "p1_scale", "p1_cell_a", "bkg0", "zero"].map(row);

  it("matches as written first", () => {
    expect(matchIds(params, ["p0_pos_*", "zero"])).toEqual(["p0_pos_Ca1_0", "p0_pos_F1_0", "zero"]);
  });

  it("reads a pattern without the phase prefix as every phase's rows", () => {
    expect(matchIds(params, ["pos_*"])).toEqual(["p0_pos_Ca1_0", "p0_pos_F1_0"]);
    expect(matchIds(params, ["cell_a", "scale"])).toEqual(["p0_scale", "p0_cell_a", "p1_scale", "p1_cell_a"]);
  });

  it("plans set_free and selects get_state rows the same way", () => {
    expect(freePlan(params, ["pos_*"], []).changes.map((c) => c.id)).toEqual(["p0_pos_Ca1_0", "p0_pos_F1_0"]);
    const rows = (parameterSummary(params, undefined, ["cell_*"]) as { parameterRows: { id: string }[] }).parameterRows.map((r) => r.id);
    expect(rows).toEqual(["p0_cell_a", "p1_cell_a"]);
  });

  it("still refuses a pattern nothing matches, listing the ids", () => {
    expect(() => matchIds(params, ["occ_*"])).toThrow(/nothing matches "occ_\*"\. Parameter ids: p0_scale/);
  });
});

describe("bondEsds", () => {
  it("follows a bond that a shift lists the other way round", () => {
    const structure: StructureModel = {
      id: "s", name: "s", cell: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: buildSpaceGroup(1),
      sites: [{ label: "A", element: "Al", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.3 } }, { label: "B", element: "O", position: [0.3, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.3 } }],
    };
    const parameters: RefinementParameter[] = [{ id: "x_B", label: "B x", kind: "atomX", value: 0.3, initialValue: 0.3, fixed: false }];
    let call = 0;
    // The reference lists the short bond A–B; the shifted structure lists it B–A, 0.0002 Å longer.
    const measure = (): { from: string; to: string; distance: number }[] =>
      call++ === 0
        ? [{ from: "A", to: "B", distance: 1.8549 }, { from: "A", to: "B", distance: 1.9717 }]
        : [{ from: "B", to: "A", distance: 1.8551 }, { from: "A", to: "B", distance: 1.9716 }];
    const esds = bondEsds(structure, [{ parameterId: "x_B", kind: "atomX", targetId: "s", targetKey: "B" }], parameters, { x_B: 1e-4 }, measure);
    expect([...esds.values()].map((e) => Number(e.toFixed(4)))).toEqual([0.0002, 0.0001]);
  });
});
