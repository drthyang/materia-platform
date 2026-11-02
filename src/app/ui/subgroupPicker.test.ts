/**
 * The Subgroups page's rows (subgroupPicker.ts): a child reached through a By
 * subgroup row, a k-point chip or the irreps of a supercell star is the child
 * the older paths activated — the same name, basis (P, p), structure and
 * modes. The older paths are rebuilt here as they were: the Γ and decentring
 * trees' "Activate →", the t-lattice (withSubgroup), the same-cell lattice
 * (withSameCellSubgroup), the supercell view's irreps at a k-point (the
 * irrep's characters as the primary) and its Lattice view (the lattice's
 * member, no primary).
 *
 * The rows themselves: every subgroup that fits the bound, each with its
 * cell and the irreps that lower the parent to it, on SrTiO₃ (Pm-3m, 2×2×2)
 * and the bundled GaTa₄Se₈ demo (F-43m, published; 1×1×2). The list's
 * merging (subgroupList.ts) loses no class, and a row reached as a merged
 * row's variant activates the same child; the default filter, the k-point
 * chips and the tie rule keep the known cases; every "how you get here"
 * chain is made of real relations of the engine's lattice; the mode count a
 * row shows is the count Activate loads.
 */
import { describe, it, expect, vi } from "vitest";
import type { PdfPattern } from "@/core/diffraction/types";
import type { StructureModel } from "@/core/crystal/types";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups } from "@/core/crystal/irreps/isotropy";
import { cachedSupercellSubgroups, supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { structuralSubgroupLattice, subgroupClassRepresentatives } from "@/core/crystal/subgroupTree";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { pageView, pdfPage, withActivatedMode, withSameCellSubgroup, withSubgroup, withSupercellChild, type PdfPageModel, type SupercellChoice } from "@/app/pdfPage";
import { decentringIrrepTree, gammaIrrepTree, modesCellNote, sameCellLattice } from "@/app/ui/SubgroupsPanel";
import { DEFAULT_BOUND, PRESETS } from "@/app/ui/SupercellView";
import {
  chipName, decentringRows, kChips, latticeGraph, sameCellListing, sameCellRows, supercellListing, supercellRows,
  type PickerAction, type PickerIrrep, type SubgroupRow,
} from "@/app/ui/subgroupPicker";
import { DEFAULT_FILTERS, collapseTies, groupRows, latticeChains, setLine, setsFor, tagOf, visibleGroups, type ListFilters, type RowGroup } from "@/app/ui/subgroupList";
import { boundIrreps } from "@/core/crystal/irreps/subgroupIrreps";
import { starsInBound } from "@/core/crystal/irreps/factorGroup";
import { rnum } from "@/core/crystal/irreps/rational";
import { cachedIrrepsOfStar } from "@/core/crystal/irreps/supercellModes";
import { irrepEngine } from "@/core/crystal/isotropySubgroups";
import type { SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import { srtio3 } from "@/testSupport/perovskiteTilts";

// Realising and splitting the supercell children takes seconds each, the bound's lattice and irreps more; more on a loaded CI runner.
vi.setConfig({ testTimeout: 300_000 });

const PARENT = srtio3();
// The bound's factor group, one object for every path (the rows and the irreps they come from share its caches).
const STO_GROUP: FactorGroup = factorGroup(PARENT.spaceGroup.operations, DEFAULT_BOUND);
// The old supercell view's group: the 2×2×2 bound as Phase 2 built it.
const oldGroup: FactorGroup = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const rChip = kChips([], STO_GROUP).find((c) => c.id === "R")!;

function patternOf(s: StructureModel): PdfPattern {
  const rGrid = makeRGrid(1.5, 10, 0.05);
  const gr = computeGofR(s.cell, expandStructureAtoms(s), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id: "sto", name: "SrTiO3", scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: gr[i]! })), qdamp: 0.03 };
}

const stoPage = (): PdfPageModel => pdfPage(PARENT, patternOf(PARENT), { preset: { fitRange: { min: 1.5, max: 10 } } });
const demoPage = (): PdfPageModel => {
  const demo = gata4se8PdfExample();
  return pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams } });
};

/** What a child's activation leaves on the page: the lowered structure, its symmetry and cell, and the modes. */
function outcome(m: PdfPageModel) {
  const set = pageView(m).modeSet!;
  const s = set.parentized;
  return {
    group: s.spaceGroup.hermannMauguin,
    nOps: s.spaceGroup.operations.length,
    cell: s.cell,
    sites: s.sites.map((x) => ({ label: x.label, element: x.element, position: x.position })),
    modes: set.modes.map((x) => ({ label: x.label, irrep: x.irrep, axes: x.axes })),
    params: m.params.map((p) => ({ id: p.id, value: p.value, fixed: p.fixed })),
  };
}

/** The child named `name` under the irrep `irrep` (any irrep when omitted), and its action. */
function childAction(rows: readonly PickerIrrep[], name: string, irrep?: string): PickerAction {
  for (const r of rows) {
    if (irrep !== undefined && r.label !== irrep) continue;
    const c = r.children.find((x) => x.name === name);
    if (c) return c.action;
  }
  throw new Error(`no child ${name}${irrep ? ` under ${irrep}` : ""}`);
}

/** Activate as the page does: the action's own path. */
function activated(m: PdfPageModel, action: PickerAction): { readonly model: PdfPageModel; readonly label: string; readonly message: string } {
  if (action.kind === "irrep") return withActivatedMode(m, action.term, action.sub);
  if (action.kind === "subgroup") return withSubgroup(m, action.node);
  if (action.kind === "sameCell") return withSameCellSubgroup(m, action.node);
  if (action.kind === "supercell") return withSupercellChild(m, action.choice);
  throw new Error(`not activatable here: ${action.note}`);
}
const activate = (m: PdfPageModel, action: PickerAction): PdfPageModel => activated(m, action).model;

/** A row as the page shows it, in one line. */
const lineOf = (r: SubgroupRow): string => `${r.name} · ${r.cell} · ${r.domains} domains · ${r.irreps}`;

/** The By subgroup rows of a page as the panel builds them: the same-cell ones, then the bound's larger cells. */
function listing(m: PdfPageModel, group: FactorGroup, bound: string): { readonly same: SubgroupRow[]; readonly larger: SubgroupRow[] } {
  const s = m.loaded;
  const same = sameCellListing({ operations: s.spaceGroup.operations, structure: s, tTree: structuralSubgroupLattice(s), gammaTree: gammaIrrepTree(s), decentringTree: decentringIrrepTree(s), kNodes: sameCellLattice(s) });
  return { same, larger: supercellListing(group, s, bound).rows };
}


/** The modes Activate loads (pageView.modeSet), for a row's count. */
const modesAfter = (m: PdfPageModel): number => pageView(m).modeSet!.modes.length;

/** The merged row holding a row, and that the row is one of its variants itself (the same object, so the same action). */
function groupOf(groups: readonly RowGroup[], row: SubgroupRow): RowGroup {
  const g = groups.filter((x) => x.variants.includes(row));
  expect(g, row.key).toHaveLength(1);
  return g[0]!;
}

/** Merging keeps every class: each row is exactly one group's variant, every group's variants share name, cell and domains. */
function expectNothingLost(rows: readonly SubgroupRow[]): RowGroup[] {
  const groups = groupRows(rows);
  const variants = groups.flatMap((g) => g.variants);
  expect(variants).toHaveLength(rows.length);
  expect(new Set(variants).size).toBe(rows.length);
  for (const r of rows) expect(variants).toContain(r);
  for (const g of groups) expect(g.variants.every((v) => v.name === g.name && v.cell === g.cell && v.domains === g.domains)).toBe(true);
  // Every class stays reachable from the list: with every filter off, every group is listed, every variant in it.
  const all = visibleGroups(groups, { ...DEFAULT_FILTERS, kind: "all" });
  expect(all.flatMap((x) => x.shown)).toHaveLength(rows.length);
  return groups;
}

/** The ancestors of each class of a lattice (every class above it, through the covering edges). */
function ancestorsOf(lattice: SupercellLattice): Set<number>[] {
  const memo: (Set<number> | null)[] = lattice.classes.map(() => null);
  const up = (id: number): Set<number> => {
    if (memo[id]) return memo[id]!;
    const s = new Set<number>();
    for (const u of lattice.classes[id]!.coveredBy) {
      s.add(u);
      for (const x of up(u)) s.add(x);
    }
    memo[id] = s;
    return s;
  };
  return lattice.classes.map((c) => up(c.id));
}

/**
 * Every displayed way of every row is made of real relations of the
 * lattice: the first step is an isotropy subgroup of its irrep (the class of
 * one of that irrep's isotropy subgroups), each next step lies strictly below
 * the one before through the covering edges, the last is the row's class.
 */
function expectRealWays(rows: readonly SubgroupRow[], lattice: SupercellLattice, irrepClasses: (label: string) => Set<number>): number {
  const above = ancestorsOf(lattice);
  let steps = 0;
  for (const r of rows) {
    for (const way of r.ways.ways) {
      expect(way.at(-1)!.cls, r.key).toBe(r.cls);
      expect(irrepClasses(way[0]!.irrep.label).has(way[0]!.cls), `${r.key}: ${way[0]!.irrep.label}`).toBe(true);
      for (let i = 1; i < way.length; i++) {
        expect(way[i]!.cls).toBeGreaterThanOrEqual(0);
        expect(above[way[i]!.cls]!.has(way[i - 1]!.cls), `${r.key} step ${i}`).toBe(true);
      }
      steps += way.length;
    }
    expect(r.ways.ways.length).toBeGreaterThan(r.reach.kind === "none" ? -1 : 0);
  }
  return steps;
}

/** The lattice classes of each irrep's isotropy subgroups, by label. */
function isotropyClassesOf(group: FactorGroup, lattice: SupercellLattice, stars: Parameters<typeof boundIrreps>[1]): (label: string) => Set<number> {
  const byLabel = new Map<string, Set<number>>();
  for (const b of boundIrreps(group, stars)) byLabel.set(b.irrep.label, new Set(b.subgroups.map((x) => lattice.classOf(x.elements)).filter((x): x is number => x !== null)));
  return (label) => byLabel.get(label) ?? new Set();
}
const boundStars = (group: FactorGroup) => starsInBound(group).map((k) => cachedIrrepsOfStar(group, [rnum(k[0]), rnum(k[1]), rnum(k[2])]));
const shownIn = (groups: readonly RowGroup[], f: ListFilters, key: string) => visibleGroups(groups, f).find((g) => g.group.key === key);

describe("the k-point chips", () => {
  it("name Γ and the 2×2×2 bound's stars of Pm-3m, with accessible names", () => {
    const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_BOUND);
    const chips = kChips([], group);
    expect(chips.map(chipName)).toEqual(["Γ, same cell", "X, supercell", "M, supercell", "R, supercell"]);
    expect(chips.find((c) => c.id === "R")!.k).toEqual([0.5, 0.5, 0.5]);
  });

  it("add a centred parent's decentring stars as same-cell chips, and leave its integer stars to them", () => {
    const demo = gata4se8PdfExample();
    const group = factorGroup(demo.structure.spaceGroup.operations, DEFAULT_BOUND);
    const chips = kChips(decentringIrrepTree(demo.structure), group);
    expect(chips.filter((c) => c.sameCell).map((c) => c.id)).toEqual(["Γ", "X"]);
    expect(chips.filter((c) => !c.sameCell).map((c) => c.id)).toEqual(expect.arrayContaining(["L", "W"]));
    expect(chips.filter((c) => c.id === "X")).toHaveLength(1);
  });
});

describe("a child reached through the chips is the child the old panels activated", () => {
  it("Γ: P4mm and R3m of SrTiO₃, in the parent's cell", () => {
    const m = stoPage();
    const tree = gammaIrrepTree(m.loaded)!;
    const rows = sameCellRows(tree);
    for (const name of ["P 4 m m #99", "R 3 m:H #160"]) {
      // Old: the Γ tree's "Activate → name".
      const branch = tree.find((b) => b.subgroups.some((s) => `${s.identity.hermannMauguin} #${s.identity.number}` === name))!;
      const sub = branch.subgroups.find((s) => `${s.identity.hermannMauguin} #${s.identity.number}` === name)!;
      const old = withActivatedMode(m, branch.term, sub).model;
      const action = childAction(rows, name, branch.term.irrep.label);
      expect(action.kind).toBe("irrep");
      if (action.kind === "irrep") {
        expect(action.term).toBe(branch.term);
        expect(action.sub.identity).toEqual(sub.identity);
      }
      const now = activate(m, action);
      expect(now).not.toBe(m);
      expect(outcome(now)).toEqual(outcome(old));
      expect(outcome(now).nOps).toBe(sub.operations.length);
    }
  });

  it("a decentring point: GaTa₄Se₈ X → P2₁3, in the parent's cell", () => {
    const m = demoPage();
    const tree = decentringIrrepTree(m.loaded);
    const branch = tree.find((b) => b.term.irrep.dim === 6)!;
    const sub = branch.subgroups.find((s) => s.identity.number === 198)!;
    const old = withActivatedMode(m, branch.term, sub).model;
    const chip = kChips(tree, factorGroup(m.loaded.spaceGroup.operations, DEFAULT_BOUND)).find((c) => c.id === "X")!;
    expect(chip.source).toBe("decentring");
    const rows = decentringRows(tree, chip);
    expect(rows.map((r) => r.label)).toContain("X irrep 5 of 5");
    const child = rows.find((r) => r.label === "X irrep 5 of 5")!.children.find((c) => c.name === "P 21 3 #198")!;
    expect(child.facts).toBe("(a,a,a,-a,-a,-a) · same cell · 8 domains");
    expect([child.cell, child.fits]).toEqual(["same cell", true]);
    expect(outcome(activate(m, child.action))).toEqual(outcome(old));
  });

  // The old supercell view: the R irreps of the 2×2×2 bound, each child with its irrep's characters as the primary.
  const oldR = irrepsOfStar(oldGroup, [0.5, 0.5, 0.5]).physical.map((p) => ({ label: p.label, characters: p.characters, subs: isotropySubgroups(oldGroup, p).subgroups }));
  const newR = supercellRows(STO_GROUP, rChip.k!);

  it("lists the R irreps with their generic labels and every child the old view listed, each with its cell", () => {
    expect(newR.map((r) => r.label)).toEqual(oldR.map((r) => r.label));
    expect(newR.every((r) => /^R irrep \d+ of 10$/.test(r.label))).toBe(true);
    expect(newR.map((r) => r.children.map((c) => c.name))).toEqual(oldR.map((r) => r.subs.map((s) => (s.identity.number !== undefined ? `${s.identity.hermannMauguin} #${s.identity.number}` : `${s.identity.pointGroup} (unnamed)`))));
    // Every R child fits the 2×2×2 cube; each says its cell.
    expect(newR.every((r) => r.children.every((c) => c.fits && c.cell === "2×2×2" && c.facts.includes(" · 2×2×2 · ")))).toBe(true);
  });

  for (const number of [167, 74]) {
    it(`R → ${number === 167 ? "R-3c" : "Imma"}: the same child in its own cell, basis (P, p) and modes, from each irrep that reaches it`, () => {
      const m = stoPage();
      let compared = 0;
      for (const r of oldR) {
        for (const s of r.subs.filter((x) => x.identity.number === number && x.cellMultiplying)) {
          const choice: SupercellChoice = { group: oldGroup, elements: s.elements, identity: s.identity, primary: r.characters };
          const old = withSupercellChild(m, choice);
          const action = newR.find((x) => x.label === r.label)!.children.find((c) => c.action.kind === "supercell" && c.action.choice.elements.join() === s.elements.join())!.action;
          expect(action.kind).toBe("supercell");
          if (action.kind !== "supercell") continue;
          expect(action.choice.identity.basis).toEqual(s.identity.basis);
          expect(action.choice.identity.originShift).toEqual(s.identity.originShift);
          expect(action.choice.primary).toEqual(r.characters);
          const now = withSupercellChild(m, action.choice);
          expect(now.label).toBe(old.label);
          expect(now.message).toBe(old.message);
          if (old.model === m) {
            // An irrep whose modes cannot reach the child here: refused the same way on both paths.
            expect(now.model).toBe(m);
            continue;
          }
          expect(outcome(now.model)).toEqual(outcome(old.model));
          expect(now.model.modes!.ownCell).toBe(true);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(0);
    });
  }

  it("lists only the children that fit the bound, and says so: GaTa₄Se₈ at W in 1×1×2", () => {
    const group = factorGroup(gata4se8PdfExample().structure.spaceGroup.operations, { P: PRESETS.find((p) => p.label === "1×1×2")!.P, centring: "P" });
    const w = kChips([], group).find((c) => c.id === "W")!;
    const rows = supercellRows(group, w.k!);
    const children = rows.flatMap((r) => r.children);
    const larger = children.filter((c) => !c.fits);
    expect(larger.length).toBeGreaterThan(0);
    expect(children.some((c) => c.fits)).toBe(true);
    // The (2a, 2a, c) P-42₁m of each W irrep, in its own orientation: two axes doubled, more than the 1×1×2 bound holds.
    const p113 = larger.filter((c) => c.name === "P -4 21 m #113");
    expect(p113.length).toBeGreaterThan(0);
    expect(p113.every((c) => c.cell.split("×").map(Number).reduce((a, b) => a * b, 1) === 4 && c.facts.includes(` · ${c.cell} · `))).toBe(true);
    expect(p113.every((c) => c.detail.includes("larger than the supercell chosen"))).toBe(true);
    expect(children.filter((c) => c.fits).every((c) => c.cell === "1×1×2")).toBe(true);
  });
});

describe("By subgroup on SrTiO₃, 2×2×2: every subgroup that fits, each with its cell and the irreps that lower Pm-3m to it", () => {
  const group = STO_GROUP;
  let cached: { m: PdfPageModel; same: SubgroupRow[]; larger: SubgroupRow[] } | null = null;
  const sto = () => {
    if (!cached) {
      const m = stoPage();
      cached = { m, ...listing(m, group, "2×2×2") };
    }
    return cached;
  };
  const row = (rows: readonly SubgroupRow[], text: string): SubgroupRow => {
    const hit = rows.filter((r) => lineOf(r) === text);
    expect(hit, text).toHaveLength(1);
    return hit[0]!;
  };

  it("lists the 32 same-cell subgroups and the 1394 larger ones in the cube", () => {
    const { same, larger } = sto();
    expect(same).toHaveLength(32);
    expect(same.every((r) => r.cell === "same cell" && r.sameCell)).toBe(true);
    expect(larger).toHaveLength(1394);
    expect(larger.every((r) => r.cell !== "same cell" && r.cell.split("×").every((n) => n === "1" || n === "2"))).toBe(true);
    // Every row names its irreps: a primary one, or a coupled set.
    expect([...same, ...larger].every((r) => r.irreps !== "" && !r.irreps.startsWith("no "))).toBe(true);
  });

  it("names the tilts' irreps: R-3c and I4/mcm from the R irrep alone, Pnma from an M and that R irrep coupled", () => {
    const { larger } = sto();
    const r3c = row(larger, "R -3 c:H #167 · 2×2×2 · 8 domains · R irrep 8 of 10 (a,a,a)");
    const i4mcm = row(larger, "I 4/m c m #140 · 2×2×2 · 6 domains · R irrep 8 of 10 (a,0,0)");
    const pnma = row(larger, "P n m a #62 · 2×2×2 · 24 domains · M irrep 3 of 10 (a,0,0) + R irrep 8 of 10 (a,a,0), coupled (or 7 other pairs)");
    expect(r3c.detail).toContain("Primary: R irrep 8 of 10 (a,a,a). Its isotropy subgroup along that direction is this subgroup.");
    expect(r3c.detail).toContain("Its own cell: a′ = −b+c, b′ = a−c, c′ = 2a+2b+2c, origin");
    expect(r3c.detail).toContain("(×6 the parent's), repeating every 2×2×2 parent cells; refined in that cell.");
    expect(r3c.detail).toMatch(/Secondary \(allowed here, induced by coupling\): Γ irrep 7 of 10, R irrep 2 of 10\./);
    expect(i4mcm.detail).toContain("Secondary (allowed here, induced by coupling): Γ irrep 5 of 10.");
    expect(pnma.detail).toContain("No single irrep has it as an isotropy subgroup. Coupled: M irrep 3 of 10 (a,0,0) (alone, P 4/m b m #127) with R irrep 8 of 10 (a,a,0) (alone, I m m a #74)");
    expect(pnma.detail).toContain("Also reached by M irrep 5 of 10 + R irrep 8 of 10;");
    // The strain-only tetragonal subgroup: its Γ irrep moves no atom of SrTiO₃.
    const p4mmm = row(sto().same, "P 4/m m m #123 · same cell · 3 domains · Γ irrep 5 of 10 (a,a)");
    expect(p4mmm.detail).toContain("Γ irrep 5 of 10 moves no atom of this structure.");
    expect(p4mmm.action.kind).toBe("subgroup");
  });

  it("Activate on a same-cell row: the Γ tree's child for a Γ primary, the t-lattice's otherwise", () => {
    const { m, same } = sto();
    const p4mm = row(same, "P 4 m m #99 · same cell · 6 domains · Γ irrep 10 of 10 (a,0,0)");
    expect(p4mm.action.kind).toBe("irrep");
    // The Γ tree's polar irrep (its children P4mm, R3m, Amm2, …), whatever the Γ chip calls it: its point-group
    // numbering "Γn" is not the generic one, and is not even the same on every platform (Node 22 and 24 differ).
    const tree = gammaIrrepTree(m.loaded)!;
    const branch = tree.find((b) => b.subgroups.some((s) => s.identity.number === 99))!;
    const sub = branch.subgroups.find((s) => s.identity.number === 99)!;
    expect(p4mm.detail).toContain(`(Γ irrep 10 of 10 is ${branch.term.irrep.label} in the activated modes' labels.)`);
    const fromRow = activate(m, p4mm.action);
    expect(outcome(fromRow)).toEqual(outcome(withActivatedMode(m, branch.term, sub).model));
    expect(modesAfter(fromRow)).toBe(p4mm.modes);
    // The t-subgroups no displacive irrep reaches alone: the old t-lattice path, node for node.
    const nodes = subgroupClassRepresentatives(structuralSubgroupLattice(m.loaded));
    let compared = 0;
    for (const r of same.filter((x) => x.action.kind === "subgroup")) {
      if (r.action.kind !== "subgroup") continue;
      const node = r.action.node;
      expect(nodes.map((n) => n.id)).toContain(node.id);
      const old = withSubgroup(m, node);
      const now = activated(m, r.action);
      expect([now.label, now.message]).toEqual([old.label, old.message]);
      if (old.model === m) continue;
      expect(outcome(now.model)).toEqual(outcome(old.model));
      expect(modesAfter(now.model)).toBe(r.modes);
      if (++compared === 3) break;
    }
    expect(compared).toBe(3);
  });

  it("Activate on a larger row: R-3c as By irrep's R child, Pnma as the old Lattice view's, the coupled tilts kicked", () => {
    const { m, larger } = sto();
    const r3c = row(larger, "R -3 c:H #167 · 2×2×2 · 8 domains · R irrep 8 of 10 (a,a,a)");
    expect(r3c.action.kind).toBe("supercell");
    if (r3c.action.kind !== "supercell") return;
    const fromIrrep = supercellRows(group, rChip.k!).find((r) => r.label === "R irrep 8 of 10")!.children.find((c) => c.action.kind === "supercell" && c.action.choice.elements.join() === (r3c.action as { choice: SupercellChoice }).choice.elements.join())!;
    expect(fromIrrep).toBeDefined();
    const a = withSupercellChild(m, r3c.action.choice);
    const b = activated(m, fromIrrep.action);
    expect([a.label, a.message]).toEqual([b.label, b.message]);
    expect(outcome(a.model)).toEqual(outcome(b.model));
    expect(modesCellNote(a.model.modes!)).toBe(" · in its own cell, 2×2×2");
    expect(modesAfter(a.model)).toBe(r3c.modes);

    const pnma = row(larger, "P n m a #62 · 2×2×2 · 24 domains · M irrep 3 of 10 (a,0,0) + R irrep 8 of 10 (a,a,0), coupled (or 7 other pairs)");
    if (pnma.action.kind !== "supercell") throw new Error("Pnma activates in its own cell");
    const lattice = cachedSupercellSubgroups(group);
    const cls = lattice.classes[lattice.classOf(pnma.action.choice.elements)!]!;
    expect(pnma.action.choice.elements).toEqual(cls.elements);
    const old = withSupercellChild(m, { group, elements: cls.elements, identity: cls.identity! });
    const now = withSupercellChild(m, pnma.action.choice);
    expect(now.label).toBe(old.label);
    expect(now.message).toBe(old.message);
    expect(now.message).toContain("the order parameter (M irrep 3 of 10 + R irrep 8 of 10)");
    expect(outcome(now.model)).toEqual(outcome(old.model));
    expect(modesAfter(now.model)).toBe(pnma.modes);
    expect(pnma.modes).toBe(7);
  });

  it("I4/mcm: its row activates By irrep's R child in its own cell, with the modes the row counts", () => {
    const { m, larger } = sto();
    const i4mcm = row(larger, "I 4/m c m #140 · 2×2×2 · 6 domains · R irrep 8 of 10 (a,0,0)");
    if (i4mcm.action.kind !== "supercell") throw new Error("I4/mcm activates in its own cell");
    const fromIrrep = supercellRows(group, rChip.k!).find((r) => r.label === "R irrep 8 of 10")!.children.find((c) => c.action.kind === "supercell" && c.action.choice.elements.join() === (i4mcm.action as { choice: SupercellChoice }).choice.elements.join())!;
    const a = withSupercellChild(m, i4mcm.action.choice);
    const b = activated(m, fromIrrep.action);
    expect(outcome(a.model)).toEqual(outcome(b.model));
    expect(modesAfter(a.model)).toBe(i4mcm.modes);
  });

  it("the list merges rows by name, cell and domains and loses no class; a gate row reached as a variant is the row itself", () => {
    const { same, larger } = sto();
    const groups = expectNothingLost([...same, ...larger]);
    expect(groups).toHaveLength(559);
    const pnma = row(larger, "P n m a #62 · 2×2×2 · 24 domains · M irrep 3 of 10 (a,0,0) + R irrep 8 of 10 (a,a,0), coupled (or 7 other pairs)");
    const g = groupOf(groups, pnma);
    expect(g.key).toBe("P n m a #62|2×2×2|24");
    expect(g.variants).toHaveLength(4);
    for (const text of ["R -3 c:H #167 · 2×2×2 · 8 domains · R irrep 8 of 10 (a,a,a)", "I 4/m c m #140 · 2×2×2 · 6 domains · R irrep 8 of 10 (a,0,0)"]) groupOf(groups, row(larger, text));
    groupOf(groups, row(same, "P 4 m m #99 · same cell · 6 domains · Γ irrep 10 of 10 (a,0,0)"));
  });

  it("the default list keeps Pnma (two irreps coupled) and every maximal subgroup; the chips keep what their irreps reach; the tie is written on one line", () => {
    const { same, larger } = sto();
    const groups = groupRows([...same, ...larger]);
    const pnma = row(larger, "P n m a #62 · 2×2×2 · 24 domains · M irrep 3 of 10 (a,0,0) + R irrep 8 of 10 (a,a,0), coupled (or 7 other pairs)");
    const PNMA = "P n m a #62|2×2×2|24";
    const R3C = "R -3 c:H #167|2×2×2|8";
    const I4MCM = "I 4/m c m #140|2×2×2|6";
    // Default: one irrep, or two coupled, or maximal: 444 of the 559 merged rows; Pnma among them, the a⁻b⁺a⁻ class a shown variant.
    const def = visibleGroups(groups, DEFAULT_FILTERS);
    expect(def).toHaveLength(444);
    expect(shownIn(groups, DEFAULT_FILTERS, PNMA)!.shown).toContain(pnma);
    expect(def.flatMap((x) => x.shown).filter((r) => r.maximal)).toHaveLength([...same, ...larger].filter((r) => r.maximal).length);
    // High to low symmetry: the index never falls.
    expect(def.every((x, i) => i === 0 || def[i - 1]!.group.index <= x.group.index)).toBe(true);
    // One irrep only: Pnma (coupled) leaves, R-3c stays.
    const one = { ...DEFAULT_FILTERS, kind: "one" as const };
    expect(shownIn(groups, one, PNMA)).toBeUndefined();
    expect(shownIn(groups, one, R3C)).toBeDefined();
    // The R chip: R-3c and I4/mcm, not Pnma (it needs an M or X irrep too) nor P4mm (Γ).
    const r = { ...DEFAULT_FILTERS, ks: ["R"] };
    expect(shownIn(groups, r, R3C)).toBeDefined();
    expect(shownIn(groups, r, I4MCM)).toBeDefined();
    expect(shownIn(groups, r, PNMA)).toBeUndefined();
    expect(shownIn(groups, r, "P 4 m m #99|same cell|6")).toBeUndefined();
    // R and M: their coupled pairs too; Pnma's tag the M and R pair, the tied M irreps on one line.
    const rm = { ...DEFAULT_FILTERS, ks: ["R", "M"] };
    expect(shownIn(groups, rm, PNMA)!.shown).toContain(pnma);
    const shownSet = collapseTies(setsFor(pnma, rm.ks))[0]!;
    expect(tagOf(shownSet)).toBe("M·3/5+R·8");
    expect(setLine(shownSet)).toBe("M irrep 3 or 5 + R irrep 8");
    // X and R alone: Pnma by an X irrep and R irrep 8 (a pair inside those two stars).
    expect(tagOf(collapseTies(setsFor(pnma, ["X", "R"]))[0]!)).toMatch(/^X·\d+\+R·\d+$/);
  });

  it("the tie: M irrep 3 and 5 tie in a⁻b⁺a⁻ Pnma (same star, dimension, direction, multiplicity, isotropy subgroups by type and order, and alone the same P4/mbm); R irrep 8 and 10 do not (multiplicity 1 and 2)", () => {
    const { larger } = sto();
    const pnma = row(larger, "P n m a #62 · 2×2×2 · 24 domains · M irrep 3 of 10 (a,0,0) + R irrep 8 of 10 (a,a,0), coupled (or 7 other pairs)");
    const refs = pnma.reach.sets.flat();
    const ref = (label: string) => refs.find((x) => x.label === label)!;
    expect(ref("M irrep 3 of 10").tie).toBe(ref("M irrep 5 of 10").tie);
    expect(ref("M irrep 3 of 10").tie).toBe("M|3|1|(a,0,0)|127:64,139:32,204:48,71:16|127:64");
    expect(ref("R irrep 8 of 10").tie).not.toBe(ref("R irrep 10 of 10").tie);
    // The first four sets: M3+R8, M5+R8 (tied: one line), M3+R10, M5+R10 (tied: another line).
    const tied = collapseTies(pnma.reach.sets);
    expect(tied.slice(0, 2).map(setLine)).toEqual(["M irrep 3 or 5 + R irrep 8", "M irrep 3 or 5 + R irrep 10"]);
    // Every set written on a tied line reaches the row: one place varies, and each combination is one of its sets.
    for (const t of tied) {
      const varying = t.members.filter((alts) => alts.length > 1);
      expect(varying.length).toBeLessThanOrEqual(1);
      for (const alt of varying[0] ?? []) {
        const labels = t.members.map((alts) => (alts.length > 1 ? alt.label : alts[0]!.label)).sort();
        expect(pnma.reach.sets.some((set) => set.map((x) => x.label).sort().join() === labels.join())).toBe(true);
      }
    }
    // Two sets that differ in two members never share a line, tied or not.
    const a = { label: "A irrep 1 of 2", star: "A", number: "1", direction: "(a)", moves: true, alone: "P1", tie: "t" };
    const b = { ...a, label: "A irrep 2 of 2", number: "2" };
    const c = { ...a, label: "B irrep 1 of 2", star: "B", tie: "u" };
    const d = { ...c, label: "B irrep 2 of 2", number: "2" };
    expect(collapseTies([[a, c], [b, d]])).toHaveLength(2);
    expect(collapseTies([[a, c], [b, c]]).map(tagOf)).toEqual(["A·1/2+B·1"]);
    expect(collapseTies([[a, c], [{ ...b, tie: "other" }, c]])).toHaveLength(2);
  });

  it("every way of every row is a chain of real relations of the lattice, and the lattice steps are covering edges", () => {
    const { m, same, larger } = sto();
    const lattice = cachedSupercellSubgroups(group);
    const steps = expectRealWays(larger, lattice, isotropyClassesOf(group, lattice, boundStars(group)));
    expect(steps).toBeGreaterThan(larger.length);
    const engine = irrepEngine(m.loaded.spaceGroup.operations);
    const sameLattice = cachedSupercellSubgroups(engine.group);
    expectRealWays(same, sameLattice, isotropyClassesOf(engine.group, sameLattice, engine.stars));
    // Pnma's ways name Imma (R irrep 8 alone) and P4/mbm (M irrep 3 alone) before Pnma.
    const pnma = row(larger, "P n m a #62 · 2×2×2 · 24 domains · M irrep 3 of 10 (a,0,0) + R irrep 8 of 10 (a,a,0), coupled (or 7 other pairs)");
    expect(pnma.ways.count).toBe(16);
    expect(pnma.ways.ways.slice(0, 2).map((w) => w.map((st) => `${st.name} (${st.irrep.label})`).join(" → "))).toEqual([
      "I m m a #74 (R irrep 8 of 10) → P n m a #62 (M irrep 3 of 10)",
      "P 4/m b m #127 (M irrep 3 of 10) → P n m a #62 (R irrep 8 of 10)",
    ]);
    // The literal lattice steps: each consecutive pair a covering edge of the bound's lattice, from the parent to the row.
    const graph = latticeGraph(lattice, m.loaded.spaceGroup.operations).nodes;
    const byKey = new Map(graph.map((n) => [n.key, n]));
    for (const r of [pnma, row(larger, "R -3 c:H #167 · 2×2×2 · 8 domains · R irrep 8 of 10 (a,a,a)"), row(same, "P 4 m m #99 · same cell · 6 domains · Γ irrep 10 of 10 (a,0,0)")]) {
      const { count, chains } = latticeChains(graph, r.key, 5);
      expect(count).toBeGreaterThan(0);
      expect(chains.length).toBeGreaterThan(0);
      for (const ch of chains) {
        expect([ch[0], ch.at(-1)]).toEqual(["p", r.key]);
        for (let i = 1; i < ch.length; i++) expect(byKey.get(ch[i]!)!.coveredBy).toContain(ch[i - 1]);
      }
    }
    // The bound's same-cell classes are the same-cell rows' (by key): the graph's s-keys are rows.
    const sameKeys = new Set(same.map((r) => r.key));
    expect(graph.filter((n) => n.key.startsWith("s")).every((n) => sameKeys.has(n.key))).toBe(true);
    expect(graph.filter((n) => n.key.startsWith("s"))).toHaveLength(same.length);
  });

  it("Pnma from the old Lattice view's list (maxIndex 48) is the same class as the row's", () => {
    const oldLattice = supercellSubgroups(oldGroup, { maxIndex: 48 });
    const tilt = oldLattice.classes.find((c) => c.identity?.number === 62 && c.cellMultiplying && c.domainStates === 24)!;
    const m = stoPage();
    const old = withSupercellChild(m, { group: oldGroup, elements: tilt.elements, identity: tilt.identity! });
    const lattice = cachedSupercellSubgroups(group);
    const rowOf = sto().larger.find((r) => r.action.kind === "supercell" && lattice.classOf(r.action.choice.elements) === lattice.classOf(tilt.elements))!;
    expect(rowOf.name).toBe("P n m a #62");
    const now = activated(m, rowOf.action);
    expect(now.label).toBe(old.label);
    expect(outcome(now.model).group).toBe(outcome(old.model).group);
    expect(outcome(now.model).sites).toEqual(outcome(old.model).sites);
    expect(outcome(now.model).modes).toEqual(outcome(old.model).modes);
  });
});

describe("By subgroup on GaTa₄Se₈, 1×1×2: P-42₁m in the bound's own cell, and at X in the parent's", () => {
  const bound = { P: PRESETS.find((p) => p.label === "1×1×2")!.P, centring: "P" as const };
  let cached: { m: PdfPageModel; group: FactorGroup; same: SubgroupRow[]; larger: SubgroupRow[] } | null = null;
  const gts = () => {
    if (!cached) {
      const m = demoPage();
      const group = factorGroup(m.loaded.spaceGroup.operations, bound);
      cached = { m, group, ...listing(m, group, "1×1×2") };
    }
    return cached;
  };

  it("lists the four 1×1×2 classes of P-42₁m, each with the irreps that reach it, and the two at X in the parent's cell", () => {
    const { same, larger } = gts();
    const own = larger.filter((r) => r.name === "P -4 21 m #113");
    expect(own).toHaveLength(4);
    for (const r of own) {
      expect(r.cell).toBe("1×1×2");
      expect(r.domains).toBe(24);
      expect(r.irreps).toMatch(/^.+ \+ .+, coupled \(or 2 other pairs\)$/);
      expect(r.irreps).toContain("X irrep 5 of 5");
      expect(r.detail).toContain("Its lattice is the 1×1×2 cell itself: one of Bilbao's SUBGROUPS entries for that supercell.");
    }
    expect(lineOf(own[0]!)).toBe("P -4 21 m #113 · 1×1×2 · 24 domains · X irrep 5 of 5 (0,0,a,-a,-a,a) + W irrep 1 of 4 (a,0,0,a,0,0), coupled (or 2 other pairs)");
    const atX = same.filter((r) => r.name === "P -4 21 m #113");
    expect(atX.map(lineOf).sort()).toEqual([
      "P -4 21 m #113 · same cell · 12 domains · X irrep 5 of 5 (0,0,a,-a,-a,a)",
      "P -4 21 m #113 · same cell · 12 domains · X irrep 5 of 5 (0,0,a,a,a,a)",
    ]);
    // Every larger row fits 1×1×2: c doubled, a and b kept.
    expect(larger.every((r) => r.cell === "1×1×2")).toBe(true);
  });

  it("Activate on an X row is the X chip's child; on a 1×1×2 row, the child in (a, a, 2c), as the old Lattice view's", () => {
    const { m, group, same, larger } = gts();
    const atX = same.find((r) => lineOf(r) === "P -4 21 m #113 · same cell · 12 domains · X irrep 5 of 5 (0,0,a,-a,-a,a)")!;
    expect(atX.action.kind).toBe("irrep");
    const xRows = decentringRows(decentringIrrepTree(m.loaded), kChips(decentringIrrepTree(m.loaded), null).find((c) => c.id === "X")!);
    const xChild = xRows.find((r) => r.label === "X irrep 5 of 5")!.children.find((c) => c.name === "P -4 21 m #113" && c.facts.startsWith("(0,0,a,-a,-a,a)"))!;
    const fromX = activated(m, xChild.action);
    const fromRow = activated(m, atX.action);
    expect(fromRow.label).toBe(fromX.label);
    expect(outcome(fromRow.model)).toEqual(outcome(fromX.model));
    expect(modesAfter(fromRow.model)).toBe(atX.modes);
    // The parent's cubic cell, kept.
    const xc = pageView(fromRow.model).modeSet!.parentized.cell;
    expect(xc.c).toBeCloseTo(xc.a, 9);
    expect(modesCellNote(fromRow.model.modes!)).toBe(" · in the parent's cell");

    const own = larger.find((r) => r.name === "P -4 21 m #113")!;
    if (own.action.kind !== "supercell") throw new Error("a 1×1×2 child activates in its own cell");
    const lattice = cachedSupercellSubgroups(group);
    const cls = lattice.classes[lattice.classOf(own.action.choice.elements)!]!;
    const old = withSupercellChild(m, { group, elements: cls.elements, identity: cls.identity! });
    const now = withSupercellChild(m, own.action.choice);
    expect(old.model).not.toBe(m);
    expect(now.label).toBe(old.label);
    expect(outcome(now.model).group).toBe(outcome(old.model).group);
    expect(outcome(now.model).cell).toEqual(outcome(old.model).cell);
    expect(outcome(now.model).sites).toEqual(outcome(old.model).sites);
    expect(outcome(now.model).modes).toEqual(outcome(old.model).modes);
    // The order parameter kicked: the row's coupled pair.
    expect(now.message).toContain("the order parameter (X irrep 5 of 5 + W irrep 1 of 4)");
    const cell = pageView(now.model).modeSet!.parentized.cell;
    expect(cell.b).toBeCloseTo(cell.a, 6);
    expect(cell.c).toBeCloseTo(2 * cell.a, 6);
    expect(cell.a).toBeCloseTo(10.36, 1);
    expect(cell.c).toBeCloseTo(20.73, 1);
    expect(modesCellNote(now.model.modes!)).toBe(" · in its own cell, 1×1×2");
    expect(modesAfter(now.model)).toBe(own.modes);
  });

  it("Activate on a decentring k- or general row without a displacive primary takes the same-cell lattice's path", () => {
    const { m, same } = gts();
    const nodes = sameCellLattice(m.loaded);
    const k = same.filter((r) => r.action.kind === "sameCell");
    expect(k.length).toBeGreaterThan(0);
    let compared = 0;
    for (const r of k.slice(0, 3)) {
      if (r.action.kind !== "sameCell") continue;
      expect(nodes).toContainEqual(r.action.node);
      const old = withSameCellSubgroup(m, r.action.node);
      const now = activated(m, r.action);
      expect([now.label, now.message]).toEqual([old.label, old.message]);
      if (old.model !== m) {
        expect(outcome(now.model)).toEqual(outcome(old.model));
        expect(modesAfter(now.model)).toBe(r.modes);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
  it("the list: no class lost; the default keeps the four 1×1×2 P-42₁m and the two at X; the X chip keeps the X ones, X and W the 1×1×2 ones", () => {
    const { m, group, same, larger } = gts();
    const groups = expectNothingLost([...same, ...larger]);
    const OWN = "P -4 21 m #113|1×1×2|24";
    const AT_X = "P -4 21 m #113|same cell|12";
    expect(shownIn(groups, DEFAULT_FILTERS, OWN)!.shown).toHaveLength(4);
    expect(shownIn(groups, DEFAULT_FILTERS, AT_X)!.shown).toHaveLength(2);
    for (const r of larger.filter((x) => x.name === "P -4 21 m #113")) expect(groupOf(groups, r).key).toBe(OWN);
    // The X chip: the X ones (X irrep 5 alone), not the 1×1×2 ones (they need W or (0,0,½) as well).
    const x = { ...DEFAULT_FILTERS, ks: ["X"] };
    expect(shownIn(groups, x, AT_X)).toBeDefined();
    expect(shownIn(groups, x, OWN)).toBeUndefined();
    const xw = { ...DEFAULT_FILTERS, ks: ["X", "W"] };
    const own = shownIn(groups, xw, OWN)!;
    expect(own.shown).toHaveLength(4);
    expect(tagOf(collapseTies(setsFor(own.shown[0]!, xw.ks))[0]!)).toMatch(/^X·5\+W·[1-4]$/);
    // The chips' ids are the rows' stars: X from the decentring tree, W and the unnamed (0, 0, 1/2) from the bound.
    const chips = kChips(decentringIrrepTree(m.loaded), group).map((c) => c.id);
    const stars = new Set([...same, ...larger].flatMap((r) => r.reach.sets.flat().map((y) => y.star)));
    for (const st of stars) expect(chips).toContain(st);
    // Ways: the 1×1×2 P-42₁m by the X one in the parent's cell, then W.
    const first = larger.find((r) => r.name === "P -4 21 m #113")!;
    expect(first.ways.ways.map((w) => w.map((st) => `${st.name} ${st.cell}`).join(" → "))).toContain("P -4 21 m #113 same cell → P -4 21 m #113 1×1×2");
    const lattice = cachedSupercellSubgroups(group);
    expectRealWays(larger, lattice, isotropyClassesOf(group, lattice, boundStars(group)));
  });
});
