/**
 * The subgroup engine's names checked by an independent library (THY-80 A3,
 * tier 1; the full coverage is the opt-in tier 2,
 * subgroupNaming.moyo.tier2.test.ts). moyo (@spglib/moyo-wasm, a dev
 * dependency, never in the app) identifies a structure with exactly each
 * class's symmetry, and its ITA standard-setting operations are the reference
 * the engine's (P_H, p_H) must reproduce (independentNaming.ts).
 *
 * First the two tables are compared: moyo's standard setting of each of the
 * 230 types is MATERIA's reference setting operation for operation, so a
 * "standard setting" means the same thing on both sides; the Hall symbols
 * agree (moyo writes the double-prime axis "=", gemmi '"'); the H-M symbols agree
 * except for the five e-glide groups, whose ITA symbol changed in 2002
 * (Cmca → Cmce, …), which MATERIA writes in the older form. Then negative
 * controls show the check catches a wrong number, origin or handedness. Then
 * every class of a few fixed (parent, bound) pairs is checked.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { hall_symbol_entries_from_number, operations_from_number } from "@spglib/moyo-wasm";
import { buildSpaceGroup, extendedSymbol } from "@/core/crystal/spaceGroups";
import { SPACE_GROUP_DATA } from "@/core/crystal/spaceGroupData";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups, type SubgroupClass } from "@/core/crystal/irreps/supercellLattice";
import type { SubgroupIdentity } from "@/core/crystal/isotropyTree";
import type { Mat3 } from "@/core/math/types";
import {
  BOUNDS, PARENTS, E_GLIDE_SYMBOLS, checkBound, checkClass, engineHm, engineHall, findings, hallKey, initMoyo, moyoStandardOperations, operationKey,
} from "@/core/crystal/irreps/validation/independentNaming";

beforeAll(() => initMoyo());

describe("moyo's standard settings are MATERIA's reference settings", () => {
  it("all 230 types: the same operations, modulo ℤ³", () => {
    const differ: number[] = [];
    for (let n = 1; n <= 230; n++) {
      const ref = SPACE_GROUP_DATA.find((e) => e.number === n && e.reference)!;
      const mine = new Set(buildSpaceGroup(extendedSymbol(ref)).operations.map((o) => operationKey(o.rotation.map((r) => [...r]), [...o.translation])));
      const theirs = new Set(moyoStandardOperations(n).map((o) => operationKey(o.W, o.w)));
      if (mine.size !== theirs.size || [...mine].some((k) => !theirs.has(k))) differ.push(n);
    }
    expect(differ).toEqual([]);
  });

  it("the same Hall symbols (moyo's \"=\" is gemmi's '\"')", () => {
    const differ: number[] = [];
    for (let n = 1; n <= 230; n++) {
      const std = new Set(moyoStandardOperations(n).map((o) => operationKey(o.W, o.w)));
      // moyo's Hall entries of n whose operations are its standard setting.
      const halls = hall_symbol_entries_from_number(n)
        .filter((h) => {
          const ops = new Set(operations_from_number(n, { type: "HallNumber", value: h.hall_number }, false).map((o) => operationKey([0, 1, 2].map((i) => [0, 1, 2].map((j) => o.rotation[i + 3 * j]!)), [...o.translation])));
          return ops.size === std.size && [...ops].every((k) => std.has(k));
        })
        .map((h) => hallKey(h.hall_symbol));
      if (!halls.includes(hallKey(engineHall(n)!))) differ.push(n);
    }
    expect(differ).toEqual([]);
  });

  it("the same H-M symbols, but for the five e-glide groups MATERIA writes in their pre-2002 form", () => {
    const differ: string[] = [];
    for (let n = 1; n <= 230; n++) {
      const ref = SPACE_GROUP_DATA.find((e) => e.number === n && e.reference)!;
      const theirs = hall_symbol_entries_from_number(n).flatMap((h) => [h.hm_short, h.hm_full]).map((s) => s.replace(/[\s_]/g, ""));
      if (!theirs.includes(engineHm(extendedSymbol(ref)))) differ.push(engineHm(extendedSymbol(ref)));
    }
    expect(differ).toEqual(Object.keys(E_GLIDE_SYMBOLS).sort((a, b) => SPACE_GROUP_DATA.find((e) => e.short === a)!.number - SPACE_GROUP_DATA.find((e) => e.short === b)!.number));
  });
});

describe("the check catches a wrong name or setting (negative controls)", () => {
  const P = BOUNDS["1x1x2"]!;
  const group = factorGroup(buildSpaceGroup(221).operations, P);
  const classes = supercellSubgroups(group).classes;
  const pc = PARENTS["Pm-3m"]!;
  const withIdentity = (c: SubgroupClass, identity: SubgroupIdentity): SubgroupClass => ({ ...c, identity });
  /** A class named in a conventional cell with an origin shift: I4/mcm or similar. */
  const shifted = classes.find((c) => c.identity?.method === "conventional-cell" && c.identity.originShift !== undefined && c.identity.number !== undefined)!;

  it("the unmodified class passes", () => {
    expect(shifted).toBeDefined();
    expect(checkClass(group, shifted, P, pc.cart, "control").problems).toEqual([]);
  });
  it("a wrong number is caught", () => {
    const id = shifted.identity!;
    const r = checkClass(group, withIdentity(shifted, { ...id, number: id.number! + 1 }), P, pc.cart, "control");
    expect(r.problems.some((p) => p.startsWith("number:"))).toBe(true);
  });
  it("a wrong origin (shifted by ¼ along c) is caught", () => {
    const id = shifted.identity!;
    const p = id.originShift!;
    const r = checkClass(group, withIdentity(shifted, { ...id, originShift: [p[0], p[1], p[2] + 0.25] }), P, pc.cart, "control");
    expect(r.problems.some((x) => x.startsWith("setting:"))).toBe(true);
  });
  it("a left-handed basis (one axis reversed) is caught", () => {
    const id = shifted.identity!;
    const B = id.basis!.map((r) => [r[0]!, r[1]!, -r[2]!]) as unknown as Mat3;
    const r = checkClass(group, withIdentity(shifted, { ...id, basis: B }), P, pc.cart, "control");
    expect(r.problems.some((x) => x.startsWith("det P_H"))).toBe(true);
  });
  it("a cell twice too long along c is caught", () => {
    const id = shifted.identity!;
    const B = id.basis!.map((r) => [r[0]!, r[1]!, 2 * r[2]!]) as unknown as Mat3;
    const r = checkClass(group, withIdentity(shifted, { ...id, basis: B }), P, pc.cart, "control");
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

/** Fixed (parent, bound) pairs: a few seconds together. */
const TIER1: readonly (readonly [string, string])[] = [
  ["Pm-3m", "1x1x1"],
  ["Pm-3m", "1x1x2"],
  ["Fm-3m", "1x1x1"],
  ["Fd-3m", "1x1x1"],
  ["R-3m", "1x1x1"],
  ["P6_3/mmc", "r3xr3x1"],
  ["Pnma", "1x1x2"],
  ["P2_1/c", "2x2x2"],
];

describe("every class named as moyo names it, in the setting moyo calls standard", { timeout: 120_000 }, () => {
  for (const [parent, bound] of TIER1) {
    it(`${parent}, ${bound}`, () => {
      const r = checkBound(PARENTS[parent]!, bound, BOUNDS[bound]!);
      expect(r.note).toBeUndefined();
      expect(r.classes.length).toBe(r.listed);
      expect(r.listed).toBeGreaterThan(0);
      expect(findings(r)).toEqual([]);
    });
  }
});
