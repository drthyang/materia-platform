/**
 * Each irrep label the engine gives, with a fingerprint of the irrep it names
 * (THY-64): the same function runs under Node (irrepOrder.test.ts, against
 * irrepLabels.golden.json) and in a browser (scripts/irrep-labels-check.mjs),
 * so a runtime that numbered an irrep differently would show as a label
 * against another irrep's fingerprint.
 *
 * The fingerprint is the irrep's characters on every element, keyed by the
 * element itself (its rotation and translation, not its index), rounded to
 * 1e-3 and hashed (FNV-1a): it names the irrep whatever order the elements,
 * classes or irreps were built in. No Node API here: it runs in a page.
 */

import type { Complex } from "@/core/math/types";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup, starsInBound, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { complexIrrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { CONVENTIONAL_CELL, DEFAULT_SUPERCELL, type SupercellMatrix } from "@/core/crystal/irreps/supercell";
import { ikey, rnum } from "@/core/crystal/irreps/rational";
import { abelianIrreps } from "@/core/magnetic/irreps";
import { pointGroupIrreps } from "@/core/magnetic/pointGroupIrreps";
import { decomposeDisplacementRepresentation } from "@/core/crystal/displaciveModes";

/** FNV-1a, 32 bits, as 8 hex digits. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const round = (x: number): number => Math.round(x * 1000) + 0;
const value = (c: Complex): string => `${round(c.re)},${round(c.im)}`;

/** The characters keyed by element, sorted by key, hashed. */
function fingerprint(keys: readonly string[], characters: readonly Complex[]): string {
  const seen = new Map<string, string>();
  keys.forEach((k, i) => {
    if (!seen.has(k)) seen.set(k, value(characters[i]!));
  });
  return fnv1a([...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("|"));
}

const elementKey = (group: FactorGroup, i: number): string => {
  const e = group.elements[i]!;
  return `${ikey(e.W)}+${e.w.map((x) => `${x.n}/${x.d}`).join(",")}`;
};

const rotationKey = (op: SymmetryOperation): string => op.rotation.map((row) => row.map((x) => Math.round(x)).join(",")).join(";");

/** A parent, its setting and the bound its stars are listed in; `k` alone, or every star the bound admits. */
export interface StarCase {
  readonly name: string;
  readonly setting: number | string;
  readonly bound: SupercellMatrix;
  readonly k?: readonly [number, number, number];
}

const oracle = (name: string, setting: number | string, k: readonly [number, number, number]): StarCase => ({
  name,
  setting,
  bound: k.every(Number.isInteger) ? CONVENTIONAL_CELL : DEFAULT_SUPERCELL,
  k,
});

/** The ISOTROPY label oracle's cases (irrepLabelOracle.test.ts), SrTiO₃'s and GaTa₄Se₈'s parents in the app's bounds. */
export const STAR_CASES: readonly StarCase[] = [
  oracle("Pm-3m Γ", 221, [0, 0, 0]),
  oracle("Fm-3m Γ", 225, [0, 0, 0]),
  oracle("Fm-3m X", 225, [0, 0, 1]),
  oracle("F-43m X", 216, [0, 0, 1]),
  oracle("Fd-3m X", "F d -3 m:2", [0, 0, 1]),
  oracle("Im-3m H", 229, [0, 0, 1]),
  oracle("I4/mmm M", 139, [0, 0, 1]),
  oracle("Cmcm Y", 63, [0, 1, 0]),
  oracle("Pm-3m X", 221, [0, 0.5, 0]),
  oracle("Pm-3m M", 221, [0.5, 0.5, 0]),
  oracle("Pm-3m R", 221, [0.5, 0.5, 0.5]),
  oracle("Fm-3m L", 225, [0.5, 0.5, 0.5]),
  oracle("Fm-3m W", 225, [0.5, 1, 0]),
  oracle("P6₃/mmc A", "P 63/m m c", [0, 0, 0.5]),
  oracle("P4₂/mnm Z", "P 42/m n m", [0, 0, 0.5]),
  oracle("P4/mmm Z", 123, [0, 0, 0.5]),
  { name: "SrTiO₃ Pm-3m 2×2×2", setting: 221, bound: DEFAULT_SUPERCELL },
  { name: "GaTa₄Se₈ F-43m 1×1×2", setting: 216, bound: [[1, 0, 0], [0, 1, 0], [0, 0, 2]] },
  { name: "GaTa₄Se₈ F-43m 2×2×2", setting: 216, bound: DEFAULT_SUPERCELL },
];

/** One space group of each of the 32 crystal classes (the Γ chip's point groups). */
export const CLASS_REPRESENTATIVES: readonly number[] = [
  1, 2, 3, 6, 10, 16, 25, 47, 75, 81, 83, 89, 99, 111, 123, 143, 147, 149, 156, 162, 168, 174, 175, 177, 183, 187, 191, 195, 200, 207, 215, 221,
];

/** "label · dim reality · fingerprint" for every irrep at the case's stars, in their order. */
export function starFingerprints(c: StarCase, operations?: readonly SymmetryOperation[]): string[] {
  const group = factorGroup(operations ?? buildSpaceGroup(c.setting).operations, c.bound);
  const keys = group.elements.map((_, i) => elementKey(group, i));
  const ks = c.k ? [c.k] : starsInBound(group).map((k) => [rnum(k[0]), rnum(k[1]), rnum(k[2])] as const);
  return ks.flatMap((k) => complexIrrepsOfStar(group, [k[0], k[1], k[2]]).irreps.map((ir) => `${ir.label} · ${ir.dim}${ir.reality[0]} · ${fingerprint(keys, ir.characters)}`));
}

/** The Γ chip's irreps of a group's point group (abelianIrreps, else pointGroupIrreps), as the displacive decomposition takes them. */
export function gammaChipFingerprints(operations: readonly SymmetryOperation[]): string[] {
  const keys = operations.map(rotationKey);
  const irreps = abelianIrreps(operations) ?? pointGroupIrreps(operations);
  return irreps.map((ir) => `${ir.label} · ${ir.dim ?? 1}${ir.real ? "r" : "c"} · ${fingerprint(keys, ir.characters)}`);
}

/** The Γ chip's terms of a structure's displacements: label, dimension, multiplicity and acoustic count, fingerprint. */
export function displaciveFingerprints(structure: StructureModel): string[] {
  const keys = structure.spaceGroup.operations.map(rotationKey);
  return decomposeDisplacementRepresentation(structure).terms.map((t) => `${t.irrep.label} · ${t.irrep.dim ?? 1} · n ${t.multiplicity} · acoustic ${t.acoustic} · ${fingerprint(keys, t.irrep.characters)}`);
}

/** Everything above, by case name: what irrepLabels.golden.json holds. */
export function allFingerprints(structures: Readonly<Record<string, StructureModel>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of STAR_CASES) out[c.name] = starFingerprints(c);
  for (const n of CLASS_REPRESENTATIVES) out[`Γ chip #${n}`] = gammaChipFingerprints(buildSpaceGroup(n).operations);
  for (const [name, s] of Object.entries(structures)) out[`${name} displacive`] = displaciveFingerprints(s);
  return out;
}
