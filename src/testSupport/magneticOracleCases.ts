/**
 * The reference cases of the magnetic-group oracle (THY-37): a parent
 * structure, a propagation vector k and the magnetic ions, for each space
 * group and k the audit of 2026-10-26 checked. The structures are the
 * committed public examples (examples/mcp) or synthetic ones: the same space
 * group, the same Wyckoff positions for the magnetic ions, coordinates of our
 * own. No measured data enters a case.
 *
 * The oracle (scripts/magnetic-groups/oracle.py: an independent construction
 * of every magnetic group compatible with k, named by spglib) runs on the
 * inputs `oracleInput` writes; its output is the committed fixture the gate
 * test (magneticGroupsOracle.test.ts) compares MATERIA's candidates with.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AtomSite, StructureModel, UnitCell } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { centringTranslations } from "@/core/crystal/symmetry";
import { classifyPropagation } from "@/core/magnetic/propagation";
import { parseCif } from "@/parsers/cif";

export interface MagneticOracleCase {
  readonly id: string;
  readonly note: string;
  readonly structure: () => StructureModel;
  readonly k: Vec3;
  readonly ions: readonly string[];
}

const iso = { kind: "isotropic", bIso: 0.5 } as const;

function site(label: string, element: string, position: Vec3, oxidationState?: number, occupancy = 1): AtomSite {
  return { label, element, position, occupancy, adp: iso, ...(oxidationState !== undefined ? { oxidationState } : {}) };
}

function synthetic(id: string, sg: number, cell: UnitCell, sites: AtomSite[]): StructureModel {
  return { id, name: id, cell, spaceGroup: buildSpaceGroup(sg, cell), sites };
}

const EXAMPLES = resolve(__dirname, "../../examples/mcp");
const example = (file: string, id: string): StructureModel => parseCif(readFileSync(resolve(EXAMPLES, file), "utf8"), id);

const mono = (a: number, b: number, c: number, beta: number): UnitCell => ({ a, b, c, alpha: 90, beta, gamma: 90 });
const ortho = (a: number, b: number, c: number): UnitCell => ({ a, b, c, alpha: 90, beta: 90, gamma: 90 });
const hex = (a: number, c: number): UnitCell => ({ a, b: a, c, alpha: 90, beta: 90, gamma: 120 });

/** Wolframite type (P2/c): M on 2f (½, y, ¼), W on 2e, O on two 4g. */
const wolframite = (): StructureModel =>
  synthetic("wolframite", 13, mono(4.8, 5.7, 5.0, 91), [
    site("Mn1", "Mn", [0.5, 0.685, 0.25], 2),
    site("W1", "W", [0, 0.18, 0.25], 6),
    site("O1", "O", [0.21, 0.1, 0.94]),
    site("O2", "O", [0.25, 0.37, 0.39]),
  ]);

/** A wolframite with a 50/50 Mn/Fe mixed metal site (two co-located magnetic ions). */
const mixedWolframite = (): StructureModel =>
  synthetic("wolframite-mixed", 13, mono(4.8, 5.7, 5.0, 91), [
    site("Mn1", "Mn", [0.5, 0.685, 0.25], 2, 0.5),
    site("Fe1", "Fe", [0.5, 0.685, 0.25], 2, 0.5),
    site("W1", "W", [0, 0.18, 0.25], 6),
    site("O1", "O", [0.21, 0.1, 0.94]),
    site("O2", "O", [0.25, 0.37, 0.39]),
  ]);

/** Orthorhombic perovskite (Pnma, GdFeO₃ type): B on 4b (0, 0, ½). */
const perovskite = (): StructureModel =>
  synthetic("perovskite-pnma", 62, ortho(5.7, 7.7, 5.5), [
    site("Mn1", "Mn", [0, 0, 0.5], 3),
    site("La1", "La", [0.05, 0.25, 0.99], 3),
    site("O1", "O", [0.49, 0.25, 0.07]),
    site("O2", "O", [0.3, 0.04, 0.72]),
  ]);

/** Trirutile (P4₂/mnm): M on 4e (0, 0, z), W on 2a, O on 4f and 8j. */
const trirutile = (): StructureModel =>
  synthetic("trirutile", 136, ortho(4.6, 4.6, 8.9), [
    site("Cr1", "Cr", [0, 0, 0.33], 3),
    site("W1", "W", [0, 0, 0]),
    site("O1", "O", [0.3, 0.3, 0]),
    site("O2", "O", [0.3, 0.3, 0.33]),
  ]);

/** Synthetic P4/mmm with magnetic ions on 1a and 2f. */
const p4mmm = (): StructureModel =>
  synthetic("p4mmm", 123, ortho(4, 4, 6), [
    site("Mn1", "Mn", [0, 0, 0], 2),
    site("Mn2", "Mn", [0, 0.5, 0.5], 2),
    site("O1", "O", [0.5, 0.5, 0.25]),
  ]);

/** R₂BaNiO₅ type (Immm): Ni on 2a, R on 4j (½, 0, z). */
const r2baNiO5 = (): StructureModel =>
  synthetic("r2banio5", 71, ortho(3.8, 5.8, 11.3), [
    site("Ni1", "Ni", [0, 0, 0], 2),
    site("Ho1", "Ho", [0.5, 0, 0.2], 3),
    site("Ba1", "Ba", [0.5, 0.5, 0]),
    site("O1", "O", [0, 0.24, 0.15]),
    site("O2", "O", [0, 0.5, 0.5]),
  ]);

/** Kagome (P6/mmm, CoSn type): M on 3f (½, 0, 0), Sn on 1a and 2d. */
const kagome = (): StructureModel =>
  synthetic("kagome", 191, hex(5.3, 4.3), [
    site("Co1", "Co", [0.5, 0, 0], 2),
    site("Sn1", "Sn", [0, 0, 0]),
    site("Sn2", "Sn", [1 / 3, 2 / 3, 0.5]),
  ]);

/** Triangular lattice (P6/mmm): M on 1a. */
const triangular = (): StructureModel =>
  synthetic("triangular", 191, hex(4, 6), [
    site("Mn1", "Mn", [0, 0, 0], 2),
    site("O1", "O", [1 / 3, 2 / 3, 0.5]),
  ]);

export const MAGNETIC_ORACLE_CASES: readonly MagneticOracleCase[] = [
  { id: "wolframite_k_half00", note: "P2/c, M on 2f, k = (½,0,0)", structure: wolframite, k: [0.5, 0, 0], ions: ["Mn1"] },
  { id: "wolframite_k_00half", note: "P2/c, k = (0,0,½): the c-glide squared is a translation with χ = −1", structure: wolframite, k: [0, 0, 0.5], ions: ["Mn1"] },
  { id: "wolframite_mixed_k_half00", note: "P2/c, a Mn/Fe mixed site on 2f, k = (½,0,0)", structure: mixedWolframite, k: [0.5, 0, 0], ions: ["Mn1", "Fe1"] },
  { id: "mno_k0", note: "MnO (Fm-3m, examples/mcp/mno.cif), k = 0", structure: () => example("mno.cif", "mno"), k: [0, 0, 0], ions: ["Mn1"] },
  { id: "mno_k_halfhalfhalf", note: "MnO (Fm-3m), k = (½,½,½), the L point", structure: () => example("mno.cif", "mno"), k: [0.5, 0.5, 0.5], ions: ["Mn1"] },
  { id: "mn3ga_k0", note: "Mn₃Ga (P6₃/mmc, examples/mcp/mn3ga.cif), k = 0", structure: () => example("mn3ga.cif", "mn3ga"), k: [0, 0, 0], ions: ["Mn1"] },
  { id: "mn3ga_k_00half", note: "Mn₃Ga (P6₃/mmc), k = (0,0,½): the 6₃ squared is a translation with χ = −1", structure: () => example("mn3ga.cif", "mn3ga"), k: [0, 0, 0.5], ions: ["Mn1"] },
  { id: "mn3ga30k_k0", note: "Mn₃Ga 30 K parent (P2₁/m, examples/mcp/mn3ga_30k_nuclear.cif), k = 0", structure: () => example("mn3ga_30k_nuclear.cif", "mn3ga30k"), k: [0, 0, 0], ions: ["Mn1_0", "Mn2_1", "Mn3_2"] },
  { id: "perovskite_k0", note: "Pnma perovskite, B on 4b, k = 0", structure: perovskite, k: [0, 0, 0], ions: ["Mn1"] },
  { id: "perovskite_k_half00", note: "Pnma perovskite, k = (½,0,0), the X point: the 2₁ along a squared has χ = −1", structure: perovskite, k: [0.5, 0, 0], ions: ["Mn1"] },
  { id: "trirutile_k0", note: "P4₂/mnm trirutile, M on 4e, k = 0", structure: trirutile, k: [0, 0, 0], ions: ["Cr1"] },
  { id: "trirutile_k_00half", note: "P4₂/mnm trirutile, k = (0,0,½), the Z point: the 4₂ squared has χ = −1", structure: trirutile, k: [0, 0, 0.5], ions: ["Cr1"] },
  { id: "p4mmm_k_00half", note: "synthetic P4/mmm, M on 1a and 2f, k = (0,0,½) (symmorphic control)", structure: p4mmm, k: [0, 0, 0.5], ions: ["Mn1", "Mn2"] },
  { id: "r2banio5_k_half0half", note: "R₂BaNiO₅ type (Immm), Ni on 2a and R on 4j, k = (½,0,½)", structure: r2baNiO5, k: [0.5, 0, 0.5], ions: ["Ni1", "Ho1"] },
  { id: "kagome_k_00half", note: "P6/mmm kagome, M on 3f, k = (0,0,½) (symmorphic hexagonal)", structure: kagome, k: [0, 0, 0.5], ions: ["Co1"] },
  { id: "triangular_k_KK0", note: "P6/mmm triangular, M on 1a, k = (⅓,⅓,0): a two-arm k (K point)", structure: triangular, k: [1 / 3, 1 / 3, 0], ions: ["Mn1"] },
  { id: "mn3ga_k_KK0", note: "Mn₃Ga (P6₃/mmc), k = (⅓,⅓,0): a two-arm k (K point)", structure: () => example("mn3ga.cif", "mn3ga"), k: [1 / 3, 1 / 3, 0], ions: ["Mn1"] },
];

/** One case as the oracle reads it: the parent's operations (as MATERIA lists them), the cell, k, the sites. */
export function oracleInput(c: MagneticOracleCase): Record<string, unknown> {
  const s = c.structure();
  const ops = s.spaceGroup.operations;
  const cls = classifyPropagation(c.k, { centrings: centringTranslations(ops) });
  return {
    id: c.id,
    note: c.note,
    parent: s.spaceGroup.hermannMauguin ?? null,
    cell: s.cell,
    k: [...c.k],
    twoArms: cls.twoArms,
    supercell: cls.supercell ? [...cls.supercell] : null,
    parentOps: ops.map((o) => ({ R: o.rotation.map((r) => [...r]), t: [...o.translation] })),
    centrings: centringTranslations(ops),
    sites: s.sites.map((x) => ({ label: x.label, element: x.element, position: [...x.position] })),
    ions: [...c.ions],
  };
}
