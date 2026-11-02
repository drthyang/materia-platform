import { describe, expect, it } from "vitest";
import type { PdfPattern } from "@/core/diffraction/types";
import type { DistortionModeSet } from "@/core/crystal/distortionModes";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { isodistortAmplitudes } from "@/core/crystal/distortionModes";
import { pageView, pdfPage, withParameter, withSubgroup, withSupercellChild, type PdfPageModel } from "@/app/pdfPage";
import { ALL_MODES, bulkFixed, highlightedSites, modeGroups, modesTotal, selectedModes } from "@/app/ui/modeGroups";
import { srtio3 } from "@/testSupport/perovskiteTilts";

/**
 * The 3D Model's mode table by k-point and parent site (modeGroups.ts): the
 * chips are the k-points and sites of the modes in force and nothing else of
 * the parent's; the totals add in quadrature as the irrep totals do; and Free
 * all / Fix all give exactly the rows the per-row toggles give.
 */

const PARENT = srtio3();
const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const lattice = supercellSubgroups(group, { maxIndex: 48 });
const pattern: PdfPattern = { id: "flat", name: "flat", scatteringType: "neutron", points: Array.from({ length: 60 }, (_, i) => ({ r: 1.5 + i * 0.1, gObs: 0 })), qdamp: 0.03 };
const page = pdfPage(PARENT, pattern, { preset: { fitRange: { min: 1.5, max: 7.4 } } });

/** SrTiO₃ → R-3c (a⁻a⁻a⁻, the ×6 cell): one mode, R on O. */
function r3c(): PdfPageModel {
  return lattice.classes.filter((c) => c.identity?.number === 167)
    .map((c) => withSupercellChild(page, { group, elements: c.elements, identity: c.identity! }).model)
    .find((m) => pageView(m).modeSet?.modes.length === 1)!;
}

/** SrTiO₃ → Pnma (a⁻b⁺a⁻, Sr free on its mirror): seven modes in five irreps at X, M and R. */
function pnma(): PdfPageModel {
  const cls = lattice.classes.filter((c) => c.identity?.number === 62).map((c) => ({ c, r: realiseChild(PARENT, group, c.elements, c.identity) }))
    .find(({ r }) => r.structure.sites.length === 4 && r.structure.sites.filter((x) => allowedPositionShifts(r.structure.spaceGroup.operations, x.position).dimension > 0).length === 3)!.c;
  return withSupercellChild(page, { group, elements: cls.elements, identity: cls.identity! }).model;
}

const setOf = (m: PdfPageModel): DistortionModeSet => pageView(m).modeSet!;
const cellsOf = (set: DistortionModeSet) => set.amplitudeCells!;
const rows = (m: PdfPageModel) => m.params.map((p) => ({ id: p.id, value: p.value, fixed: p.fixed }));

/** The per-row toggles: one withParameter per row named, as the Positions toggle makes it. */
const perRow = (m: PdfPageModel, ids: readonly string[], fixed: boolean): PdfPageModel => ids.reduce((x, id) => withParameter(x, id, { fixed }), m);
/** The bulk button: its row edits, through the same handler. */
const viaBulk = (m: PdfPageModel, filter: { k: string | null; site: string | null }, fixed: boolean): PdfPageModel => {
  const set = setOf(m);
  return bulkFixed(selectedModes(set, modeGroups(set), filter), m.params, fixed).reduce((x, c) => withParameter(x, c.id, { fixed: c.fixed }), m);
};

describe("the mode table's groups", () => {
  it("Pnma: k chips for X, M and R only (the child's, no Γ), sites by the parent's site, every mode in one k and one site", () => {
    const set = setOf(pnma());
    const g = modeGroups(set);
    const stars = [...new Set(set.modes.map((m) => m.star))];
    expect(stars.sort()).toEqual(["M", "R", "X"]);
    // Γ first if present, then by |k|: X (½), M (1), R (3/2); each one arm doubles the parent cell.
    expect(g.ks.map((k) => k.label)).toEqual(["X", "M", "R"]);
    expect(g.ks.map((k) => k.cellMultiple)).toEqual([2, 2, 2]);
    for (const k of g.ks) expect(k.modeIds).toEqual(set.modes.filter((m) => m.star === k.id).map((m) => m.id));
    // One parent site per element: the element alone. Only the sites the modes move.
    const sites = [...new Set(set.modes.map((m) => m.irrep!.parentSite))];
    expect(g.sites.map((s) => s.id)).toEqual(["Sr", "Ti", "O"].filter((x) => sites.includes(x)));
    expect(g.sites.map((s) => s.label)).toEqual(g.sites.map((s) => s.id));
    for (const s of g.sites) expect(s.modeIds).toEqual(set.modes.filter((m) => m.irrep!.parentSite === s.id).map((m) => m.id));
    // The O chip highlights every O site of the child.
    const o = set.parentized.sites.filter((x) => x.element === "O").map((x) => x.label);
    expect(highlightedSites(g, { k: null, site: "O" })).toEqual(o);
    expect(highlightedSites(g, ALL_MODES)).toBeNull();
    // Filters intersect, in the set's order.
    expect(selectedModes(set, g, { k: "R", site: "O" }).map((m) => m.id)).toEqual(set.modes.filter((m) => m.star === "R" && m.irrep!.parentSite === "O").map((m) => m.id));
    expect(selectedModes(set, g, ALL_MODES)).toEqual(set.modes);
  });

  it("R-3c: one k chip (R) and one site (O)", () => {
    const set = setOf(r3c());
    const g = modeGroups(set);
    expect(g.ks.map((k) => [k.id, k.cellMultiple])).toEqual([["R", 2]]);
    expect(g.sites.map((s) => s.label)).toEqual(["O"]);
  });

  it("per-k and per-site totals add the members in quadrature, as the irrep totals and the whole-set total do", () => {
    const m0 = pnma();
    const set = setOf(m0);
    // Amplitudes on every mode, so every total is non-trivial.
    const m = set.modes.reduce((x, mode, i) => withParameter(x, mode.id, { value: 0.01 * (i + 1) * (i % 2 ? -1 : 1) }), m0);
    const g = modeGroups(set);
    const value = (id: string) => m.params.find((p) => p.id === id)!.value;
    const cells = cellsOf(set);
    for (const k of g.ks) {
      const t = modesTotal(k.modeIds.map((id) => ({ id })), m.params, cells);
      expect(t.a).toBeCloseTo(Math.sqrt(k.modeIds.reduce((s, id) => s + value(id) ** 2, 0)), 14);
      expect(t.as).toBeCloseTo(isodistortAmplitudes(t.a, cells).as, 14);
      expect(t.ap).toBeCloseTo(t.a / Math.sqrt(cells.parent), 14);
      // The irreps at k: their totals (the table's irrep rows) combine to the k total.
      const irreps = [...new Set(set.modes.filter((x) => k.modeIds.includes(x.id)).map((x) => x.irrep!.label))];
      const irrepTotals = irreps.map((label) => Math.hypot(...set.modes.filter((x) => x.irrep!.label === label).map((x) => value(x.id))));
      expect(Math.hypot(...irrepTotals)).toBeCloseTo(t.a, 14);
      // And its sites' parts combine to it too.
      const siteParts = g.sites.map((s) => modesTotal(s.modeIds.filter((id) => k.modeIds.includes(id)).map((id) => ({ id })), m.params, cells).a);
      expect(Math.hypot(...siteParts)).toBeCloseTo(t.a, 14);
    }
    // Every k total together is the header's total |A|.
    const all = Math.hypot(...g.ks.map((k) => modesTotal(k.modeIds.map((id) => ({ id })), m.params, cells).a));
    expect(all).toBeCloseTo(Math.sqrt(set.modes.reduce((s, x) => s + value(x.id) ** 2, 0)), 14);
  });

  it("a same-cell activation (P4mm): one Γ chip, sites by element, a mode under each element it moves", () => {
    const P4MM = structuralSubgroupLattice(PARENT).nodes.find((n) => n.identity.number === 99 && n.identity.method === "direct")!;
    const set = setOf(withSubgroup(page, P4MM).model);
    const g = modeGroups(set);
    expect(g.ks.map((k) => k.id)).toEqual(["Γ"]);
    expect(g.ks[0]!.cellMultiple).toBe(1);
    expect(g.ks[0]!.modeIds).toEqual(set.modes.map((m) => m.id));
    expect(g.sites.map((s) => s.label)).toEqual(["Sr", "Ti", "O"].filter((el) => set.modes.some((m) => m.axes.some((a) => set.parentized.sites.find((x) => x.label === a.siteLabel)!.element === el && a.axis.some((v) => Math.abs(v) > 1e-12)))));
    const o = g.sites.find((s) => s.label === "O")!;
    expect(o.childSites).toEqual(set.parentized.sites.filter((x) => x.element === "O").map((x) => x.label));
  });

  it("names a parent site with its Wyckoff site when the element has several (a tabulated group)", () => {
    // A hand-built set on an Fm-3m parent with two O sites (4a, 4b), one mode each.
    const mode = (id: string, site: string, child: string) => ({ id, label: `X irrep 1 of 4 · ${site}`, star: "X", observedAmplitude: 0, axes: [{ siteLabel: child, axis: [0.1, 0, 0] as [number, number, number] }], irrep: { label: "X irrep 1 of 4", k: [0, 0, 1] as [number, number, number], parentSite: site } });
    const set = {
      parentized: { sites: [{ label: "Oa", element: "O" }, { label: "Ob", element: "O" }] },
      modes: [mode("mode_1", "O1", "Oa"), mode("mode_2", "O2", "Ob")],
      parent: { number: 225, sites: [{ label: "O1", element: "O", wyckoff: "a" }, { label: "O2", element: "O", wyckoff: "b" }] },
    } as unknown as DistortionModeSet;
    const g = modeGroups(set);
    expect(g.sites.map((s) => s.label)).toEqual(["O (4a)", "O (4b)"]);
    expect(g.sites.map((s) => s.childSites)).toEqual([["Oa"], ["Ob"]]);
    // X of a face-centred parent keeps the conventional cell.
    expect(g.ks.map((k) => [k.label, k.cellMultiple])).toEqual([["X", 1]]);
  });
});

describe("Free all / Fix all", () => {
  for (const [name, build] of [["Pnma", pnma], ["R-3c", r3c]] as const) {
    it(`${name}: per k-point, per parent site and per both, the same rows as the per-row toggles`, () => {
      const m = build();
      const set = setOf(m);
      const g = modeGroups(set);
      const cases: { k: string | null; site: string | null }[] = [
        ...g.ks.map((k) => ({ k: k.id, site: null })),
        ...g.sites.map((s) => ({ k: null, site: s.id })),
        ...g.ks.flatMap((k) => g.sites.map((s) => ({ k: k.id, site: s.id }))),
      ];
      for (const filter of cases) {
        // The per-row toggles on the rows chosen by hand: the modes at that star and on that parent site.
        const ids = set.modes.filter((x) => (filter.k === null || x.star === filter.k) && (filter.site === null || x.irrep!.parentSite === filter.site)).map((x) => x.id);
        for (const fixed of [false, true]) {
          expect(rows(viaBulk(m, filter, fixed)), `${JSON.stringify(filter)} fixed=${fixed}`).toEqual(rows(perRow(m, ids, fixed)));
        }
      }
      // "Refine only the R tilts on O": R on O free, every other row as it was.
      const freed = viaBulk(m, { k: "R", site: "O" }, false);
      const target = new Set(set.modes.filter((x) => x.star === "R" && x.irrep!.parentSite === "O").map((x) => x.id));
      expect(target.size).toBeGreaterThan(0);
      for (const p of freed.params) expect(p.fixed).toBe(target.has(p.id) ? false : m.params.find((q) => q.id === p.id)!.fixed);
      // Values never move: only the free/fixed flags.
      expect(freed.params.map((p) => p.value)).toEqual(m.params.map((p) => p.value));
    });
  }
});
