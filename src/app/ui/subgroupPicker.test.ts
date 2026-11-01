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
 * The By subgroup rows themselves: every subgroup that fits the bound, each
 * with its cell and the irreps that lower the parent to it, on SrTiO₃ (Pm-3m,
 * 2×2×2) and the bundled GaTa₄Se₈ demo (F-43m, published; 1×1×2).
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
  chipName, decentringRows, kChips, sameCellListing, sameCellRows, supercellListing, supercellRows,
  type PickerAction, type PickerIrrep, type SubgroupRow,
} from "@/app/ui/subgroupPicker";
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
    expect(p4mm.detail).toContain("(Γ irrep 10 of 10 is Γ9 on the By irrep view's Γ chip.)");
    expect(p4mm.action.kind).toBe("irrep");
    const tree = gammaIrrepTree(m.loaded)!;
    const branch = tree.find((b) => b.term.irrep.label === "Γ9")!;
    const sub = branch.subgroups.find((s) => s.identity.number === 99)!;
    expect(outcome(activate(m, p4mm.action))).toEqual(outcome(withActivatedMode(m, branch.term, sub).model));
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
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
