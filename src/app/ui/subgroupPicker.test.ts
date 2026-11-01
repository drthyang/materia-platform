/**
 * The Subgroups page's one path (subgroupPicker.ts): a child reached through
 * the k-point chips, or the By subgroup list, is the child the old panels
 * activated — the same name, basis (P, p), structure and modes. The old paths
 * are rebuilt here as they were: the Γ and decentring trees' "Activate →",
 * the supercell view's irreps at a k-point (the irrep's characters as the
 * primary), and its Lattice view.
 */
import { describe, it, expect, vi } from "vitest";
import type { PdfPattern } from "@/core/diffraction/types";
import type { StructureModel } from "@/core/crystal/types";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups } from "@/core/crystal/irreps/isotropy";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { pageView, pdfPage, withActivatedMode, withSupercellChild, type PdfPageModel, type SupercellChoice } from "@/app/pdfPage";
import { decentringIrrepTree, gammaIrrepTree } from "@/app/ui/SubgroupsPanel";
import { DEFAULT_BOUND } from "@/app/ui/SupercellView";
import { chipName, decentringRows, kChips, sameCellRows, supercellLatticeChildren, supercellRows, type PickerAction, type PickerIrrep } from "@/app/ui/subgroupPicker";
import { srtio3 } from "@/testSupport/perovskiteTilts";

// Realising and splitting the supercell children takes seconds each; more on a loaded CI runner.
vi.setConfig({ testTimeout: 120_000 });

const PARENT = srtio3();

function patternOf(s: StructureModel): PdfPattern {
  const rGrid = makeRGrid(1.5, 10, 0.05);
  const gr = computeGofR(s.cell, expandStructureAtoms(s), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id: "sto", name: "SrTiO3", scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: gr[i]! })), qdamp: 0.03 };
}

const stoPage = (): PdfPageModel => pdfPage(PARENT, patternOf(PARENT), { preset: { fitRange: { min: 1.5, max: 10 } } });

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

function activate(m: PdfPageModel, action: PickerAction): PdfPageModel {
  if (action.kind === "irrep") return withActivatedMode(m, action.term, action.sub).model;
  if (action.kind === "supercell") return withSupercellChild(m, action.choice).model;
  throw new Error(`not activatable here: ${action.note}`);
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
    const demo = gata4se8PdfExample();
    const m = pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams } });
    const tree = decentringIrrepTree(m.loaded);
    const branch = tree.find((b) => b.term.irrep.dim === 6)!;
    const sub = branch.subgroups.find((s) => s.identity.number === 198)!;
    const old = withActivatedMode(m, branch.term, sub).model;
    const chip = kChips(tree, factorGroup(m.loaded.spaceGroup.operations, DEFAULT_BOUND)).find((c) => c.id === "X")!;
    expect(chip.source).toBe("decentring");
    const rows = decentringRows(tree, chip);
    expect(rows.map((r) => r.label)).toContain("X irrep 5 of 5");
    const child = rows.find((r) => r.label === "X irrep 5 of 5")!.children.find((c) => c.name === "P 21 3 #198")!;
    expect(child.facts).toBe("(a,a,a,-a,-a,-a) · 8 domains");
    expect(outcome(activate(m, child.action))).toEqual(outcome(old));
  });

  // The old supercell view: the R irreps of the 2×2×2 bound, each child with its irrep's characters as the primary.
  const oldGroup: FactorGroup = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
  const oldR = irrepsOfStar(oldGroup, [0.5, 0.5, 0.5]).physical.map((p) => ({ label: p.label, characters: p.characters, subs: isotropySubgroups(oldGroup, p).subgroups }));
  const newGroup: FactorGroup = factorGroup(PARENT.spaceGroup.operations, DEFAULT_BOUND);
  const rChip = kChips([], newGroup).find((c) => c.id === "R")!;
  const newR = supercellRows(newGroup, rChip.k!);

  it("lists the R irreps with their generic labels and every child the old view listed", () => {
    expect(newR.map((r) => r.label)).toEqual(oldR.map((r) => r.label));
    expect(newR.every((r) => /^R irrep \d+ of 10$/.test(r.label))).toBe(true);
    expect(newR.map((r) => r.children.map((c) => c.name))).toEqual(oldR.map((r) => r.subs.map((s) => (s.identity.number !== undefined ? `${s.identity.hermannMauguin} #${s.identity.number}` : `${s.identity.pointGroup} (unnamed)`))));
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

  it("Pnma from By subgroup: the supercell lattice's class, the same child as the old Lattice view's", () => {
    const m = stoPage();
    const oldLattice = supercellSubgroups(oldGroup, { maxIndex: 48 });
    const cls = oldLattice.classes.find((c) => c.identity?.number === 62 && c.cellMultiplying)!;
    const old = withSupercellChild(m, { group: oldGroup, elements: cls.elements, identity: cls.identity! });
    const children = supercellLatticeChildren(newGroup, supercellSubgroups(newGroup, { maxIndex: 48 }));
    // Only the cell-multiplying classes are listed (the same-cell ones are in the same-cell lattice).
    expect(children.length).toBe(oldLattice.classes.filter((c) => c.cellMultiplying && c.kind !== "parent" && c.identity).length);
    const child = children.find((c) => c.name === "P n m a #62")!;
    expect(child.action.kind).toBe("supercell");
    if (child.action.kind !== "supercell") return;
    expect(child.action.choice.identity.basis).toEqual(cls.identity!.basis);
    const now = withSupercellChild(m, child.action.choice);
    expect(now.label).toBe(old.label);
    expect(now.message).toBe(old.message);
    expect(old.model).not.toBe(m);
    expect(outcome(now.model)).toEqual(outcome(old.model));
  }, 120_000);
});
