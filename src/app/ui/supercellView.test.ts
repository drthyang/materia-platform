/**
 * The Subgroups page's supercell bound (Phase 2): the control renders 2×2×2
 * by default with its presets, P parses as three rows, and a cell-multiplying
 * child's basis reads as (P_H, p_H) and it activates in its own cell (phase 3),
 * and the Lattice summary gives Bilbao's SUBGROUPS count when enantiomorphs
 * make it differ.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups } from "@/core/crystal/irreps/isotropy";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_BOUND, PRESETS, SupercellBound, SUPERCELL_ACTIVATE_NOTE, boundLabel, childBasisNote, latticeSummary, parseSupercell } from "@/app/ui/SupercellView";

describe("the supercell bound", () => {
  it("renders 2×2×2 by default, the presets and custom P in one select, the P input only for custom", () => {
    const out = renderToStaticMarkup(createElement(SupercellBound, { value: DEFAULT_BOUND, onChange: () => undefined }));
    expect(out).toContain("Supercell");
    for (const p of PRESETS) expect(out).toContain(`>${p.label}</option>`);
    expect(out).toContain("custom P…");
    expect(out).not.toContain("supercell matrix P");
    expect(DEFAULT_BOUND.P).toEqual(DEFAULT_SUPERCELL.map((r) => [...r]));
    expect(boundLabel(DEFAULT_BOUND)).toBe("2×2×2");
    const custom = { P: [[3, 0, 0], [0, 1, 0], [0, 0, 1]], centring: "P" as const };
    expect(boundLabel(custom)).toBe("P = 3 0 0; 0 1 0; 0 0 1 (P)");
    expect(renderToStaticMarkup(createElement(SupercellBound, { value: custom, onChange: () => undefined }))).toContain('aria-label="supercell matrix P, rows separated by ;"');
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
    expect(SUPERCELL_ACTIVATE_NOTE).toMatch(/^Realise this child in its own cell/);
  });

  it("summarises the lattice, with Bilbao's SUBGROUPS count only when a class holds both enantiomorphs", () => {
    const lattice = supercellSubgroups(factorGroup(buildSpaceGroup(62).operations, [[1, 0, 0], [0, 1, 0], [0, 0, 2]]));
    expect(latticeSummary(lattice)).toMatch(/^\d+ classes · 11 with the supercell's lattice · \d+ cell-multiplying$/);
    // A class marked with its enantiomorph is one class here, two entries in SUBGROUPS.
    const i = lattice.classes.findIndex((c) => c.supercellLattice);
    const marked = { ...lattice, classes: lattice.classes.map((c, j) => (j === i ? { ...c, enantiomorph: c.identity! } : c)) };
    expect(latticeSummary(marked)).toContain("11 with the supercell's lattice (12 in Bilbao's SUBGROUPS, enantiomorphs apart)");
  });
});
