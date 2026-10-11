import { describe, it, expect } from "vitest";
import { freePlan, matchIds, parameterSummary } from "@/agent/liveCommon";
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
