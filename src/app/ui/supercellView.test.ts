/**
 * The Subgroups page's supercell view (Phase 2): the bound's controls render
 * from the parent's operations, P parses as three rows, and a cell-multiplying
 * child's basis reads as (P_H, p_H) with the phase-3 note in place of Activate.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups } from "@/core/crystal/irreps/isotropy";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { SupercellView, PHASE3_NOTE, childBasisNote, parseSupercell } from "@/app/ui/SupercellView";

describe("the supercell view", () => {
  it("renders the bound's controls, 2×2×2 by default", () => {
    const out = renderToStaticMarkup(createElement(SupercellView, { operations: buildSpaceGroup(221).operations }));
    expect(out).toContain("Supercell");
    expect(out).toContain("2×2×2");
    expect(out).toContain("Set bound");
  });

  it("parses P as three rows, fractions accepted", () => {
    expect(parseSupercell("2 0 0; 0 2 0; 0 0 2")).toEqual([[2, 0, 0], [0, 2, 0], [0, 0, 2]]);
    expect(parseSupercell("1/2 1/2 0; -1/2 1/2 0; 0 0 2")).toEqual([[0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 2]]);
    expect(parseSupercell("1 0 0; 0 1 0")).toBeNull();
  });

  it("writes a cell-multiplying child's basis from the parent's cell: Pm-3m R3+ → I4/mcm", () => {
    const group = factorGroup(buildSpaceGroup(221).operations, DEFAULT_SUPERCELL);
    const star = irrepsOfStar(group, [0.5, 0.5, 0.5]);
    const sub = star.physical.flatMap((p) => isotropySubgroups(group, p).subgroups).find((s) => s.identity.number === 140)!;
    expect(sub.cellMultiplying).toBe(true);
    expect(childBasisNote(sub.identity)).toMatch(/^a′ = .*, c′ = /);
    expect(PHASE3_NOTE).toBe("supercell refinement arrives in phase 3");
  });
});
