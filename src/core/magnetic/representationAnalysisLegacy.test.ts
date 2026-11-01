/**
 * The magnetic page's representation analysis moved from the abelian-only
 * route (irreps.ts, isotropy.ts: ordinary irreps of an abelian co-group at any
 * k, point-group irreps at k = 0) to the subgroup engine
 * (representationAnalysis.ts; THY-36). Where the old route applied — the
 * small representations are ordinary ones there — its answers stand: the same
 * irreps (by their characters), the same multiplicities, the same modes on
 * the reference site, and, for a real one-dimensional irrep, the same
 * isotropy subgroup. The old route is kept as the reference for this check
 * (displaciveModes.ts uses its abelian irreps too).
 *
 * Where it did not apply it gave no answer (a non-abelian co-group at k ≠ 0),
 * or a wrong one: on the zone boundary of a non-symmorphic group the small
 * representations are projective, and the ordinary irreps it used are not
 * them. Those cases are listed here, with what the engine gives instead.
 */

import { describe, expect, it } from "vitest";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { centringOffsets, parseSymmetryOperation } from "@/core/crystal/symmetry";
import { littleGroup } from "@/core/magnetic/magneticGroups";
import { decomposeMagneticRepresentation, projectIrrepModes } from "@/core/magnetic/irreps";
import { isotropySubgroup } from "@/core/magnetic/isotropy";
import { magneticOperationSignature } from "@/core/magnetic/operationSignature";
import { magneticIsotropySubgroup, magneticRepresentationAnalysis } from "@/core/magnetic/representationAnalysis";
import { MAGNETIC_ORACLE_CASES } from "@/testSupport/magneticOracleCases";

const iso = { kind: "isotropic", bIso: 0.3 } as const;
const ops = (...xyz: string[]): SymmetryOperation[] => xyz.map(parseSymmetryOperation);
const pointGroupCase = (id: string, operations: SymmetryOperation[], position: Vec3, k: Vec3 = [0, 0, 0]) => ({
  id,
  k,
  ions: ["M1"],
  structure: (): StructureModel => ({
    id, name: id, cell: { a: 5, b: 6, c: 7, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: { operations },
    sites: [{ label: "M1", element: "Mn", oxidationState: 3, position, occupancy: 1, adp: iso }],
  }),
});

/** The old route's own test structures: abelian groups of every crystal system, a k-phase case, and the oracle's cases. */
const CASES = [
  pointGroupCase("P2/m general", ops("x,y,z", "-x,y,-z", "-x,-y,-z", "x,-y,z"), [0.13, 0.27, 0.31]),
  pointGroupCase("P2_1/m 2e", ops("x,y,z", "-x,1/2+y,-z", "-x,-y,-z", "x,1/2-y,z"), [0.13, 0.25, 0.31]),
  pointGroupCase("mmm general", ops("x,y,z", "-x,-y,z", "x,-y,-z", "-x,y,-z", "-x,-y,-z", "x,y,-z", "-x,y,z", "x,-y,z"), [0.13, 0.27, 0.31]),
  pointGroupCase("4/m general", ops("x,y,z", "-y,x,z", "-x,-y,z", "y,-x,z", "-x,-y,-z", "y,-x,-z", "x,y,-z", "-y,x,-z"), [0.13, 0.27, 0.31]),
  pointGroupCase("6/m general", ops("x,y,z", "x-y,x,z", "-y,x-y,z", "-x,-y,z", "-x+y,-x,z", "y,-x+y,z", "-x,-y,-z", "-x+y,-x,-z", "y,-x+y,-z", "x,y,-z", "x-y,x,-z", "-y,x-y,-z"), [0.13, 0.27, 0.31]),
  pointGroupCase("P-1 at (0,0,1/2), k = (0,0,1/2)", ops("x,y,z", "-x,-y,-z"), [0, 0, 0.5], [0, 0, 0.5]),
  ...MAGNETIC_ORACLE_CASES,
];

/** Where the old route gave an answer the small representations do not: projective ones on the zone boundary of a non-symmorphic group. */
const OLD_ROUTE_WRONG: Record<string, string> = {
  // P2/c at (0,0,½): the c-glide squares to a translation with phase −1, so the four 1-D ordinary irreps are one 2-D small representation.
  wolframite_k_00half: "k = (0, 0, 1/2) irrep 1 of 1",
  // Pnma at X: the 2₁ along a squares to a translation with phase −1: two 2-D small representations, not eight 1-D ones.
  perovskite_k_half00: "k = (1/2, 0, 0) irrep 1 of 2 | k = (1/2, 0, 0) irrep 2 of 2",
};

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const spanKey = (modes: readonly Vec3[]): string => {
  // The projector onto the span, rounded: equal for any basis of one subspace.
  const P = [0, 1, 2].map((i) => [0, 1, 2].map((j) => modes.reduce((s, m) => s + m[i]! * m[j]!, 0)));
  return `${modes.length}:${P.flat().map((x) => Math.round(x * 1e5) / 1e5 || 0).join(",")}`;
};

describe("the engine keeps the old route's answers where it applied", () => {
  it.each(CASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const s = c.structure();
    const lg = littleGroup(s.spaceGroup.operations, c.k);
    const old = decomposeMagneticRepresentation(s, c.k, c.ions, lg);
    const fresh = magneticRepresentationAnalysis(s, c.k, c.ions);
    if (!fresh.available) throw new Error("the engine gave no analysis");
    if (!old.available) return; // the old route refused (a non-abelian co-group at k ≠ 0)
    if (OLD_ROUTE_WRONG[c.id]) {
      expect(fresh.terms.map((t) => t.label).join(" | ")).toBe(OLD_ROUTE_WRONG[c.id]);
      return;
    }
    expect(old.integerConsistent).toBe(true);
    expect(fresh.dimension).toBe(old.dimension);
    for (const term of old.terms) {
      // The new term with the same characters on every operation of G_k (a complex pair as one).
      // The old route reads each rotation class at one operation (its centring copies alike); compare there.
      const d = term.irrep.dim ?? 1;
      const reps = centringOffsets(lg).map((c, i) => (c.every((x) => x === 0) ? i : -1)).filter((i) => i >= 0);
      const trace = (m: Float64Array, n: number): number => Array.from({ length: n }, (_, j) => m[j * n + j]!).reduce((x, y) => x + y, 0);
      const match = fresh.terms.find((t) => {
        if (term.irrep.real) return t.reality === "real" && t.dim === d && reps.every((i) => close(trace(t.matrices![i]!, d), term.irrep.characters[i]!.re));
        return t.dim === 2 * d && t.reality === "complex" && reps.every((i) => close(trace(t.matrices![i]!, 2 * d), 2 * term.irrep.characters[i]!.re));
      });
      expect(match, `${term.irrep.label}: no engine irrep with its characters`).toBeDefined();
      expect(match!.multiplicity, `${term.irrep.label}: multiplicity`).toBe(term.multiplicity);
      const oldModes = projectIrrepModes(s, c.k, c.ions, lg, term.irrep);
      expect(spanKey(match!.modes), `${term.irrep.label}: modes on the reference site`).toBe(spanKey(oldModes));
      if (term.irrep.real && d === 1) {
        const before = isotropySubgroup(s, c.k, c.ions, lg, [{ irrep: term.irrep }]);
        const after = magneticIsotropySubgroup(fresh, [{ label: match!.label }]);
        if ("failure" in before) {
          expect(before.failure, `${term.irrep.label}: the old route failed with`).toBe("no-modes");
          continue;
        }
        if ("failure" in after) throw new Error(`${match!.label}: ${after.failure}`);
        expect(magneticOperationSignature(after.operations), `${term.irrep.label}: isotropy subgroup`).toBe(magneticOperationSignature(before.operations));
        const name = (r: typeof before | typeof after) => ("failure" in r ? null : (r.standard?.bnsNumber ?? r.settingMatch?.identity.bnsNumber ?? null));
        expect(name(after)).toBe(name(before));
      }
    }
  });
});
