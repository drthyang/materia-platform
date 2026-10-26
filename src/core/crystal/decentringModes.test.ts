/**
 * The same-cell subgroup lattice (irreps/sameCellLattice.ts) and the
 * decentring distortions on a structure (decentringModes.ts), through their
 * interfaces: the lattice against the t-lattice and the isotropy subgroups,
 * the decentring decomposition's dimension count, an activation to P2₁3 on
 * the GaTa₄Se₈ demo (F-43m, the parent of GaNb₄Se₈'s local P2₁3), and the
 * √f relation between MATERIA's amplitude and ISODISTORT's A_s and A_p.
 */
import { describe, it, expect } from "vitest";
import type { AtomSite, StructureModel, UnitCell } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsInBound } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups } from "@/core/crystal/irreps/isotropy";
import { sameCellSubgroups } from "@/core/crystal/irreps/sameCellLattice";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { decomposeDisplacementRepresentation, orbitAtoms } from "@/core/crystal/displaciveModes";
import { irrepIsotropySubgroups } from "@/core/crystal/isotropySubgroups";
import { stabilizerOfField } from "@/core/crystal/isotropyTree";
import { activateIsotropySubgroup, decentringTerms } from "@/core/crystal/decentringModes";
import { isodistortAmplitudes } from "@/core/crystal/distortionModes";
import { applyParameters } from "@/core/workflow/apply";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { mulVec } from "@/core/math/mat3";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";

const iso = { kind: "isotropic", bIso: 0.5 } as const;
const site = (label: string, position: [number, number, number]): AtomSite => ({ label, element: label.replace(/\d+$/, ""), position, occupancy: 1, adp: iso });
const cubic = (a: number): UnitCell => ({ a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 });
const CAF2: StructureModel = { id: "caf2", name: "CaF2", cell: cubic(5.46), spaceGroup: buildSpaceGroup(225), sites: [site("Ca", [0, 0, 0]), site("F", [0.25, 0.25, 0.25])] };
const GATA4SE8 = gata4se8PdfExample().structure;

describe("the same-cell subgroup lattice", () => {
  it("is the t-lattice for a primitive parent (Pm-3m: 98 subgroups in 33 classes)", () => {
    const subs = sameCellSubgroups(factorGroup(buildSpaceGroup(221).operations));
    expect(subs).toHaveLength(structuralSubgroupLattice({ ...CAF2, spaceGroup: buildSpaceGroup(221) }).nodes.length);
    expect(subs).toHaveLength(98);
    expect(new Set(subs.map((s) => s.classId)).size).toBe(33);
    expect(subs.every((s) => s.kind === "t" || s.kind === "parent")).toBe(true);
  });

  it("adds the decentring k-subgroups and the general ones (Fm-3m: Pm-3m and Pn-3m the only k-subgroups)", () => {
    const group = factorGroup(buildSpaceGroup(225).operations);
    const subs = sameCellSubgroups(group);
    const reps = subs.filter((s) => s.classRepresentative);
    expect([subs.length, reps.length]).toEqual([1120, 238]);
    expect(reps.filter((s) => s.kind === "t")).toHaveLength(32);
    const k = reps.filter((s) => s.kind === "k");
    expect(k.map((s) => [s.index, s.domainStates])).toEqual([[{ t: 1, k: 4 }, 4], [{ t: 1, k: 4 }, 4]]);
    // The class sizes add up to the subgroup count, and t·k is the index.
    expect(reps.reduce((n, s) => n + s.conjugates, 0)).toBe(subs.length);
    for (const s of subs) expect(s.index.t * s.index.k).toBe(s.domainStates);
  });

  it("contains every isotropy subgroup of every irrep in the bound (F-43m, Im-3m)", () => {
    for (const sg of [216, 229]) {
      const group = factorGroup(buildSpaceGroup(sg).operations);
      const keys = new Set(sameCellSubgroups(group).map((s) => s.elements.join(",")));
      for (const star of irrepsInBound(group)) {
        for (const p of star.physical) {
          for (const x of isotropySubgroups(group, p).subgroups) expect(keys.has([...x.elements].sort((a, b) => a - b).join(","))).toBe(true);
        }
      }
    }
  });
});

describe("decentring distortions on a structure", () => {
  it("the Γ and decentring irreps together carry every displacement of the conventional cell", () => {
    for (const s of [CAF2, GATA4SE8]) {
      const gamma = decomposeDisplacementRepresentation(s).terms;
      const x = decentringTerms(s);
      const n = orbitAtoms(s, s.sites.map((t) => t.label)).length;
      const dim = (terms: readonly { multiplicity: number; irrep: { dim?: number } }[]): number => terms.reduce((t, term) => t + term.multiplicity * (term.irrep.dim ?? 1), 0);
      expect(dim(gamma) + dim(x.map((t) => t.term))).toBe(3 * n);
      expect(x.every((t) => t.star.name === "X")).toBe(true);
    }
  });

  it("activates GaTa₄Se₈'s six-dimensional X irrep toward P2₁3: the cell kept, the orbits split, modes per irrep", () => {
    const xTerm = decentringTerms(GATA4SE8).find((t) => t.term.irrep.dim === 6)!;
    const p213 = irrepIsotropySubgroups(GATA4SE8, xTerm.term).find((s) => s.identity.number === 198)!;
    expect([p213.index, p213.direction, p213.orderParameterDim]).toEqual([{ t: 2, k: 4 }, "(a,a,a,-a,-a,-a)", 1]);
    expect(stabilizerOfField(p213.field!, GATA4SE8.spaceGroup.operations)).toHaveLength(12);
    const act = activateIsotropySubgroup(GATA4SE8, xTerm.term, p213.operations, `${xTerm.term.irrep.label} → P2₁3`, "X")!;
    expect(act.identity.number).toBe(198);
    expect(act.child.cell).toEqual(GATA4SE8.cell);
    expect(act.child.spaceGroup.operations).toHaveLength(12);
    // Ga 4a → 4a; Ta, Se1, Se2 16e → 4a + 12b each: seven child sites, 1 + 3·(1 + 3) = 13
    // coordinates — the 13 of the GaNb₄Se₈ P2₁3 refinement (realPdfData.test.ts).
    expect(act.child.sites).toHaveLength(7);
    const modes = act.modeSet.modes;
    expect(modes).toHaveLength(13);
    expect(modes[0]!.active).toBe(true);
    expect(modes.slice(1).every((m) => !m.active)).toBe(true);
    // Every mode belongs to one parent irrep: Γ or X.
    expect(modes.every((m) => m.star === "Γ" || m.star === "X")).toBe(true);
    expect(modes.some((m) => m.label.startsWith("X irrep"))).toBe(true);
    expect(act.modeSet.amplitudeCells).toEqual({ child: 1, parent: 4 });
  });
});

describe("MATERIA's mode amplitude and ISODISTORT's (ADR 0003)", () => {
  /** Σ|u|² of a mode at amplitude 1 over the atoms of one primitive cell of the child, by enumeration. */
  function primitiveSumOfSquares(child: StructureModel, set: ReturnType<typeof activate>): number {
    const mode = set.modeSet.modes[0]!;
    const moved = applyParameters(set.modeSet.parentized, set.modeSet.bindings, { [mode.id]: 1 }).model;
    const M = orthogonalizationMatrix(child.cell);
    const before = expandStructureAtoms(set.modeSet.parentized);
    const after = expandStructureAtoms(moved);
    // The child's lattice translations mod ℤ³; one atom per class of atoms they relate.
    const centrings: Vec3[] = child.spaceGroup.operations.filter((op) => op.rotation.every((r, i) => r.every((x, j) => x === (i === j ? 1 : 0)))).map((op) => op.translation);
    const same = (a: Vec3, b: Vec3): boolean => a.every((x, i) => {
      const d = Math.abs(x - b[i]!) % 1;
      return Math.min(d, 1 - d) < 1e-4;
    });
    const taken: Vec3[] = [];
    let sum = 0;
    before.forEach((a, i) => {
      if (taken.some((p) => centrings.some((c) => same([p[0] + c[0], p[1] + c[1], p[2] + c[2]], a.position)))) return;
      taken.push(a.position);
      const u = mulVec(M, [after[i]!.position[0] - a.position[0], after[i]!.position[1] - a.position[1], after[i]!.position[2] - a.position[2]]);
      sum += u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    });
    return sum;
  }
  const activate = (s: StructureModel, dim: number, number: number) => {
    const x = decentringTerms(s).find((t) => t.term.irrep.dim === dim)!;
    const sub = irrepIsotropySubgroups(s, x.term).find((t) => t.identity.number === number)!;
    return activateIsotropySubgroup(s, x.term, sub.operations, "OP", x.star.label)!;
  };

  it("A = √f_child·A_s and A_p = A_s·√(V_p/V_s): a primitive child (P2₁3, f = 1) of an F parent (f = 4)", () => {
    const act = activate(GATA4SE8, 6, 198);
    const as = Math.sqrt(primitiveSumOfSquares(act.child, act));
    const amp = isodistortAmplitudes(1, act.modeSet.amplitudeCells!);
    expect(as).toBeCloseTo(1, 9); // the primitive child cell is the conventional one
    expect(amp.as).toBeCloseTo(as, 9);
    // V_p = V/4 (F), V_s = V (P): A_p = A_s·√(1/4).
    expect(amp.ap).toBeCloseTo(as * Math.sqrt(1 / 4), 9);
  });

  it("a centred child (Fm-3m X → an A-centred P4/mmm-type child, f = 2) has A_s = A/√2", () => {
    const act = activate(CAF2, 3, 123);
    expect(act.modeSet.amplitudeCells).toEqual({ child: 2, parent: 4 });
    const as = Math.sqrt(primitiveSumOfSquares(act.child, act));
    expect(as).toBeCloseTo(1 / Math.SQRT2, 9);
    const amp = isodistortAmplitudes(1, act.modeSet.amplitudeCells!);
    expect(amp.as).toBeCloseTo(as, 9);
    expect(amp.ap).toBeCloseTo(as * Math.sqrt(2 / 4), 9);
  });
});
