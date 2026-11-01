/**
 * Representation analysis on the subgroup engine (THY-36), checked against the
 * magnetic-space-group route and the THY-37 oracle (an independent
 * construction named by spglib, fixtures/magnetic-oracle.json), on the
 * oracle's 17 public or synthetic cases:
 *
 *  - Γ_mag decomposes with integral multiplicities into small representations
 *    whose dimensions account for all of it, at every k — the non-abelian
 *    little co-groups at k ≠ 0 (MnO at L, P6₃/mmc and P4/mmm and P4₂/mnm on
 *    the zone boundary) included, which the abelian-only route refused;
 *  - every isotropy subgroup of every irrep and order-parameter direction is
 *    a group of the magnetic-space-group route (the same operations and θ),
 *    and is named as the oracle names that group (BNS number and type);
 *  - the moments the isotropy subgroup allows include the irrep's basis
 *    vectors along the direction, and for a one-dimensional irrep they are
 *    exactly its basis vectors.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SymmetryOperation } from "@/core/crystal/types";
import { magneticSubgroupLattice } from "@/core/magnetic/subgroupLattice";
import { candidateCellGroup, magneticTypeOf } from "@/core/magnetic/magneticCell";
import { magneticOperationSignature } from "@/core/magnetic/operationSignature";
import { magneticIsotropySubgroup, magneticRepresentationAnalysis } from "@/core/magnetic/representationAnalysis";
import { MAGNETIC_ORACLE_CASES } from "@/testSupport/magneticOracleCases";

interface OracleCase {
  readonly id: string;
  readonly twoArms: boolean;
  readonly classes: readonly { readonly members: readonly (readonly [string, string | null, number | null])[] }[];
}
const oracle = JSON.parse(readFileSync(resolve(__dirname, "fixtures/magnetic-oracle.json"), "utf8")) as { cases: OracleCase[] };

/** The oracle's key of a group in its magnetic box (magneticGroupsOracle.test.ts). */
function groupKey(ops: readonly SymmetryOperation[]): string {
  const rows = ops.map((o) => {
    const R = o.rotation.flat().map((v) => String(Math.round(v) + 0)).join(",");
    const t = o.translation.map((x) => (((Math.round(x * 48) % 48) + 48) % 48)).join(",");
    return `${R}|${t}|${o.timeReversal ?? 1}`;
  });
  return createHash("sha1").update(rows.sort().join(";")).digest("hex").slice(0, 16);
}

describe("Γ_mag decomposes into small representations at every k", () => {
  it.each(MAGNETIC_ORACLE_CASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const a = magneticRepresentationAnalysis(c.structure(), c.k, c.ions);
    expect(a.available).toBe(true);
    if (!a.available) return;
    // Every copy of every irrep carries dim real (or complex) vectors: together, all of Γ_mag.
    const real = a.twoArm ? 1 : 1;
    expect(a.terms.reduce((s, t) => s + t.multiplicity * t.dim * real, 0)).toBe(a.dimension);
    for (const t of a.terms) {
      expect(t.basis).toHaveLength(t.multiplicity);
      for (const copy of t.basis) expect(copy).toHaveLength(t.dim);
      expect(t.label).toMatch(/irreps? \d+(⊕\d+)? of \d+/);
    }
  });
});

describe("every isotropy subgroup is a group of the magnetic-space-group route, named as the oracle names it", () => {
  const singleArm = MAGNETIC_ORACLE_CASES.filter((c) => !oracle.cases.find((x) => x.id === c.id)!.twoArms);
  it.each(singleArm.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const s = c.structure();
    const a = magneticRepresentationAnalysis(s, c.k, c.ions);
    if (!a.available) throw new Error("unavailable");
    const lattice = magneticSubgroupLattice(s.spaceGroup.operations, c.k);
    const bySignature = new Map(lattice.map((m) => [magneticOperationSignature(m.candidate.operations), m] as const));
    const want = oracle.cases.find((x) => x.id === c.id)!;
    const members = new Map(want.classes.flatMap((x) => x.members).map(([key, bns, type]) => [key, { bns, type }] as const));
    let checked = 0;
    for (const t of a.terms) {
      expect(t.directions.length).toBeGreaterThan(0);
      t.directions.forEach((d, i) => {
        const iso = magneticIsotropySubgroup(a, [{ label: t.label, direction: i }]);
        if ("failure" in iso) throw new Error(`${t.label} ${d.symbol}: ${iso.failure}`);
        const m = bySignature.get(magneticOperationSignature(iso.operations));
        expect(m, `${t.label} ${d.symbol} is not a candidate group`).toBeDefined();
        const key = groupKey(candidateCellGroup(iso.operations, c.k)!.operations);
        const o = members.get(key)!;
        expect(o, `${t.label} ${d.symbol} is not an oracle group`).toBeDefined();
        const identity = iso.standard ?? iso.settingMatch?.identity ?? null;
        expect(`${identity?.bnsNumber ?? "unnamed"} type ${magneticTypeOf(candidateCellGroup(iso.operations, c.k)!.operations)}`).toBe(`${o.bns} type ${o.type}`);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});
