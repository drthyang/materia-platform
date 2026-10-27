/**
 * The magnetic-group gate (THY-37): MATERIA's candidates for each reference
 * case against an independent oracle (scripts/magnetic-groups/oracle.py: every
 * magnetic space group compatible with k built from scratch in the magnetic
 * box and named by spglib; its output is the committed fixture
 * fixtures/magnetic-oracle.json).
 *
 * Every candidate must be a magnetic group; every one of MATERIA's conjugacy
 * classes must be exactly one of the oracle's (the same groups, so the same
 * domain count), and no oracle class may be missing. Groups are compared by a
 * hash of their operations in the box (rotation, translation on the 1/48 grid,
 * time reversal), computed the same way on both sides.
 *
 * `MAGNETIC_ORACLE_DUMP=1` rewrites the oracle's input from the cases
 * (src/testSupport/magneticOracleCases.ts); the oracle is then re-run by hand
 * (see its docstring). The input committed with the fixture must equal what
 * the cases give, so a changed case cannot leave a stale fixture behind.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SymmetryOperation } from "@/core/crystal/types";
import { magneticOrbitRepresentatives } from "@/core/crystal/cellExpansion";
import { allowedMomentDirections } from "@/core/magnetic/allowedMoments";
import { TWO_ARM_NOTE, latticeCandidateLabel, latticeRepresentatives, magneticSubgroupLattice, maximalWithMoment } from "@/core/magnetic/subgroupLattice";
import { candidateCellGroup, isMagneticGroup } from "@/core/magnetic/magneticCell";
import { MAGNETIC_ORACLE_CASES, oracleInput } from "@/testSupport/magneticOracleCases";

const INPUT = resolve(__dirname, "fixtures/magnetic-oracle-input.json");
const ORACLE = resolve(__dirname, "fixtures/magnetic-oracle.json");

interface OracleClass {
  readonly index: number;
  readonly orderH: number;
  readonly domains: number;
  readonly bns: string | null;
  readonly og: string | null;
  readonly type: number | null;
  readonly maximal: boolean;
  readonly maxmagn: boolean;
  readonly allowsMoment: boolean;
  readonly moments: Readonly<Record<string, readonly number[]>>;
  /** Every group of the class (its domains): its key, and the BNS number and type spglib gives it. */
  readonly members: readonly (readonly [key: string, bns: string | null, type: number | null])[];
}

interface OracleCase {
  readonly id: string;
  readonly twoArms: boolean;
  readonly groups: number;
  readonly classes: readonly OracleClass[];
}

/** The hash the oracle keys a group by: sorted "R|t48|θ" rows, sha1, 16 hex digits. */
function groupKey(ops: readonly SymmetryOperation[]): string {
  const rows = ops.map((o) => {
    const R = o.rotation.flat().map((v) => String(Math.round(v) + 0)).join(",");
    const t = o.translation.map((x) => (((Math.round(x * 48) % 48) + 48) % 48)).join(",");
    return `${R}|${t}|${o.timeReversal ?? 1}`;
  });
  return createHash("sha1").update(rows.sort().join(";")).digest("hex").slice(0, 16);
}

if (process.env.MAGNETIC_ORACLE_DUMP) {
  it("writes the oracle's input from the cases", () => {
    const cases = MAGNETIC_ORACLE_CASES.map(oracleInput);
    writeFileSync(INPUT, `{"cases": [\n${cases.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`);
  });
}

const readJson = <T,>(path: string, empty: T): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return empty; // first dump: the files do not exist yet
  }
};
const committedInput = readJson<{ cases: Record<string, unknown>[] }>(INPUT, { cases: [] });
const oracle = readJson<{ cases: OracleCase[] }>(ORACLE, { cases: [] });

describe("the oracle fixture is for these cases", () => {
  it.each(MAGNETIC_ORACLE_CASES.map((c) => [c.id, c] as const))("%s: committed input = the case", (_id, c) => {
    const want = JSON.parse(JSON.stringify(oracleInput(c))) as Record<string, unknown>;
    expect(committedInput.cases.find((x) => x.id === c.id)).toEqual(want);
    expect(oracle.cases.some((x) => x.id === c.id)).toBe(true);
  });
});

const singleArm = MAGNETIC_ORACLE_CASES.filter((c) => !oracle.cases.find((x) => x.id === c.id)?.twoArms);

describe("every candidate is a magnetic group, and the classes are the oracle's", () => {
  it.each(singleArm.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const want = oracle.cases.find((x) => x.id === c.id)!;
    const lattice = magneticSubgroupLattice(c.structure().spaceGroup.operations, c.k);
    // Every candidate, conjugates included, is closed and free of 1′ in its magnetic cell.
    const byClass = new Map<number, Set<string>>();
    for (const m of lattice) {
      const cell = candidateCellGroup(m.candidate.operations, c.k);
      expect(cell, `${m.candidate.id}: no magnetic cell`).not.toBeNull();
      expect(isMagneticGroup(cell!.operations), `${m.candidate.id} is not a group`).toBe(true);
      const keys = byClass.get(m.classId) ?? new Set<string>();
      keys.add(groupKey(cell!.operations));
      byClass.set(m.classId, keys);
    }
    expect(lattice).toHaveLength(want.groups);
    expect(byClass.size).toBe(want.classes.length);
    const unmatched = new Set(want.classes.map((_, i) => i));
    for (const [classId, keys] of byClass) {
      const rep = lattice.find((m) => m.classId === classId && m.classRepresentative)!;
      const hit = want.classes.findIndex((o) => o.members.length === keys.size && o.members.every(([k]) => keys.has(k)));
      expect(hit, `class of ${rep.candidate.id} (${keys.size} groups) is not an oracle class`).toBeGreaterThanOrEqual(0);
      expect(rep.domainCount).toBe(want.classes[hit]!.domains);
      expect(rep.index).toBe(want.classes[hit]!.index);
      unmatched.delete(hit);
    }
    expect([...unmatched].map((i) => want.classes[i]!.bns), "oracle classes MATERIA misses").toEqual([]);
  });
});

describe("every class is named by the BNS number and type of its group", () => {
  it.each(singleArm.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const want = oracle.cases.find((x) => x.id === c.id)!;
    const wrong: string[] = [];
    for (const rep of latticeRepresentatives(magneticSubgroupLattice(c.structure().spaceGroup.operations, c.k))) {
      // The representative's own group: a class's domains can be enantiomorphs (P_c4₁ and P_c4₃).
      const key = groupKey(candidateCellGroup(rep.candidate.operations, c.k)!.operations);
      const member = want.classes.flatMap((x) => x.members).find(([k]) => k === key)!;
      const identity = rep.candidate.standard ?? rep.settingMatch?.identity ?? null;
      const got = `${identity?.bnsNumber ?? "unnamed"} type ${rep.magneticType}`;
      const expected = `${member[1]} type ${member[2]}`;
      if (got !== expected) wrong.push(`${rep.candidate.id}: ${got}, oracle ${expected} (${latticeCandidateLabel(rep).symbol})`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("the allowed moments on each magnetic site are the oracle's", () => {
  it.each(singleArm.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const want = oracle.cases.find((x) => x.id === c.id)!;
    const structure = c.structure();
    const ops = structure.spaceGroup.operations;
    for (const rep of latticeRepresentatives(magneticSubgroupLattice(ops, c.k))) {
      const key = groupKey(candidateCellGroup(rep.candidate.operations, c.k)!.operations);
      const o = want.classes.find((x) => x.members.some(([k]) => k === key))!;
      for (const label of c.ions) {
        const s = structure.sites.find((x) => x.label === label)!;
        // One entry per orbit the group splits the site's orbit into: the moment dimension its site symmetry allows.
        const dims = magneticOrbitRepresentatives(ops, rep.candidate.operations, s.position)
          .map((p) => allowedMomentDirections(rep.candidate.operations, p, c.k).dimension)
          .sort((a, b) => b - a);
        expect(dims, `${rep.candidate.id} on ${label}`).toEqual(o.moments[label]);
      }
    }
  });
});

describe("maximal by containment, and the maximal groups that carry a moment", () => {
  it.each(singleArm.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const want = oracle.cases.find((x) => x.id === c.id)!;
    const structure = c.structure();
    const ops = structure.spaceGroup.operations;
    const reps = latticeRepresentatives(magneticSubgroupLattice(ops, c.k));
    // Whether a group allows a moment on any orbit of the chosen ions.
    const moments = reps.map((rep) =>
      c.ions.reduce((sum, label) => {
        const s = structure.sites.find((x) => x.label === label)!;
        return sum + magneticOrbitRepresentatives(ops, rep.candidate.operations, s.position).reduce((t, p) => t + allowedMomentDirections(rep.candidate.operations, p, c.k).dimension, 0);
      }, 0),
    );
    const withMoment = maximalWithMoment(reps, moments);
    const wrong: string[] = [];
    reps.forEach((rep, i) => {
      const key = groupKey(candidateCellGroup(rep.candidate.operations, c.k)!.operations);
      const o = want.classes.find((x) => x.members.some(([k]) => k === key))!;
      if (rep.maximal !== o.maximal) wrong.push(`${latticeCandidateLabel(rep).symbol} (index ${rep.index}): maximal ${rep.maximal}, oracle ${o.maximal}`);
      if (withMoment[i] !== o.maxmagn) wrong.push(`${latticeCandidateLabel(rep).symbol} (index ${rep.index}): maximal with a moment ${withMoment[i]}, oracle ${o.maxmagn}`);
    });
    expect(wrong).toEqual([]);
  });
});

describe("a two-arm k's candidates are not named as magnetic space groups (D5)", () => {
  const twoArm = MAGNETIC_ORACLE_CASES.filter((c) => oracle.cases.find((x) => x.id === c.id)?.twoArms);
  it.each(twoArm.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(twoArm.length).toBeGreaterThan(0);
    for (const rep of latticeRepresentatives(magneticSubgroupLattice(c.structure().spaceGroup.operations, c.k))) {
      const label = latticeCandidateLabel(rep);
      expect(rep.twoArm).toBe(true);
      expect(rep.candidate.standard).toBeNull();
      expect(rep.settingMatch).toBeUndefined();
      expect(label.numbers).toBeNull();
      expect(label.setting).toBeNull();
      expect(label.note).toBe(TWO_ARM_NOTE);
      expect(label.symbol).not.toMatch(/BNS/);
    }
  });
});

