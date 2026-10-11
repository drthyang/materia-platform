/**
 * The model inverted through the origin: the other hand of an acentric
 * structure, as SHELXL's MOVE 1 1 1 −1 with the space group changed by hand.
 * Every coordinate x becomes s − x. The shift s is zero in most groups; in
 * the seven whose inverse needs an origin shift to stay in the same setting
 * (I4₁, I4₁22, I4₁md, I4₁cd, I-42d, Fdd2, F4₁32) it is that shift; in the
 * eleven enantiomorphic pairs (P3₁/P3₂, P4₁/P4₃, P6₁/P6₅, P4₁32/P4₃32, …) the
 * space group becomes its enantiomorph. The ADPs are unchanged: a tensor is
 * centrosymmetric.
 */

import type { DistanceRestraint, RidingRule, StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { Mat3, Vec3 } from "@/core/math/types";
import { settingForOperations, spaceGroupFromSetting } from "@/core/crystal/spaceGroups";
import { formatOperationXyz } from "@/core/crystal/symmetry";
import { ridingRules } from "@/core/crystal/riding";
import { isCentrosymmetric } from "@/core/diffraction/merge";

export interface InvertedModel {
  /** The inverted model: every site at s − x, in the same space group or its enantiomorph; its riding rules left out (see invertedRiding). */
  readonly structure: StructureModel;
  /** The origin shift s (zero unless the group needs one to keep its setting). */
  readonly shift: Vec3;
  /** The enantiomorph's symbol, when the space group changed (P 61 → P 65). */
  readonly enantiomorph?: string;
  /** An image (operation, lattice translation) of the old model, as the same image of the inverted one. */
  readonly mapImage: (op: number, cell: readonly [number, number, number]) => { op: number; cell: [number, number, number] };
}

const frac = (v: number): number => v - Math.floor(v + 1e-9);
const sameTranslation = (a: Vec3, b: Vec3): boolean => [0, 1, 2].every((i) => {
  const d = frac(a[i]! - b[i]!);
  return d < 1e-6 || d > 1 - 1e-6;
});
const sameRotation = (a: Mat3, b: Mat3): boolean => a.every((row, i) => row.every((v, j) => Math.round(v) === Math.round(b[i]![j]!)));
/** (I − R)·s − t: the translation an operation (R, t) takes in the inverted model. */
const invertedTranslation = (op: SymmetryOperation, s: Vec3): Vec3 =>
  [0, 1, 2].map((i) => s[i]! - op.rotation[i]!.reduce((t, r, j) => t + r * s[j]!, 0) - op.translation[i]!) as unknown as Vec3;
const operation = (rotation: Mat3, translation: Vec3): SymmetryOperation => {
  const t = translation.map(frac) as unknown as Vec3;
  return { rotation, translation: t, xyz: formatOperationXyz(rotation, t) };
};

/** The shifts searched for, nearest the origin first: multiples of 1/8 along each axis. */
const SHIFTS: Vec3[] = (() => {
  const steps = [0, 0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875];
  const out: Vec3[] = [];
  for (const x of steps) for (const y of steps) for (const z of steps) out.push([x, y, z]);
  return out.sort((a, b) => a.filter((v) => v !== 0).length - b.filter((v) => v !== 0).length);
})();

/**
 * The model inverted: positions s − x, the space group kept when the inverse
 * of its operations is itself after an origin shift, or else its enantiomorph.
 * Throws for a centrosymmetric group (the inverse is the same model).
 */
export function invertedModel(structure: StructureModel): InvertedModel {
  const ops = structure.spaceGroup.operations;
  if (isCentrosymmetric(ops)) throw new Error("the space group is centrosymmetric: the inverted model is the same model");
  const holds = (s: Vec3): boolean => ops.every((op) => ops.some((o) => sameRotation(o.rotation, op.rotation) && sameTranslation(o.translation, invertedTranslation(op, s))));
  let shift = SHIFTS.find(holds);
  let spaceGroup = structure.spaceGroup;
  let enantiomorph: string | undefined;
  if (!shift) {
    // The inverse is another group: its enantiomorph, in a tabulated setting.
    for (const s of SHIFTS) {
      const setting = settingForOperations(ops.map((op) => operation(op.rotation, invertedTranslation(op, s))));
      if (!setting) continue;
      shift = s;
      spaceGroup = spaceGroupFromSetting(setting);
      enantiomorph = spaceGroup.hermannMauguin ?? setting.hm;
      break;
    }
    if (!shift) throw new Error(`no tabulated setting holds the inverse of ${structure.spaceGroup.hermannMauguin ?? "this space group"}'s operations`);
  }
  const s = shift;
  const newOps = spaceGroup.operations;
  const mapImage = (op: number, cell: readonly [number, number, number]): { op: number; cell: [number, number, number] } => {
    const old = ops[op];
    if (!old) throw new Error(`no operation ${op} in the space group`);
    // s − (R·x + t + n) = R·(s − x) + (I − R)·s − t − n.
    const target = invertedTranslation(old, s).map((v, i) => v - cell[i]!) as unknown as Vec3;
    const j = newOps.findIndex((o) => sameRotation(o.rotation, old.rotation) && sameTranslation(o.translation, target));
    if (j < 0) throw new Error(`operation ${old.xyz} has no image in the inverted model's space group`);
    const n = target.map((v, i) => Math.round(v - newOps[j]!.translation[i]!)) as [number, number, number];
    return { op: j, cell: n };
  };
  const sites = structure.sites.map((site) => ({ ...site, position: site.position.map((x, i) => s[i]! - x) as unknown as Vec3 }));
  const restraints = structure.restraints?.map((r): DistanceRestraint => ({ ...r, pairs: r.pairs.map((p) => ({ ...p, ...mapImage(p.op, p.cell) })) }));
  const { riding: _, ...rest } = structure;
  return {
    structure: { ...rest, spaceGroup, sites, ...(restraints ? { restraints } : {}) },
    shift: s,
    ...(enantiomorph ? { enantiomorph } : {}),
    mapImage,
  };
}

/**
 * The riding rules of an inverted model: each group placed afresh from the
 * hydrogens where they are (the torsions, the CH₂ sides and the references
 * all change hand), with the old rules' parents' U factors, shared U_iso,
 * X–H and the hydrogens whose positions refine.
 */
export function invertedRiding(rules: readonly RidingRule[], inverted: StructureModel): RidingRule[] {
  if (rules.length === 0) return [];
  const old = new Map(rules.map((r) => [r.site, r]));
  const refine = rules.filter((r) => r.geometry === "free").map((r) => r.site);
  const fresh = ridingRules({ ...inverted, riding: [] }, refine.length ? { refine } : {}).rules;
  return fresh.filter((r) => old.has(r.site)).map((r) => {
    const was = old.get(r.site)!;
    const { uShared: _, ...rule } = r;
    return {
      ...rule,
      uFactor: was.uFactor,
      ...(was.distance !== undefined && rule.distance !== undefined ? { distance: was.distance } : {}),
      ...(was.uShared !== undefined ? { uShared: was.uShared } : {}),
    };
  });
}

/**
 * The twin fractions of an inverted model: the domain that was the inverse of
 * law M (−M, and the inversion for the first domain) now takes M's place. A
 * law whose inverse is not among the laws keeps its fraction — the crystal is
 * then modelled with the other hand. `fractions[i]` is law i's; the first
 * domain's is what they leave.
 */
export function invertedTwinFractions(laws: readonly { readonly matrix: Mat3 }[], fractions: readonly number[]): number[] {
  const negated = (m: Mat3): Mat3 => m.map((row) => row.map((v) => -v)) as unknown as Mat3;
  const isIdentity = (m: Mat3): boolean => m.every((row, i) => row.every((v, j) => Math.round(v) === (i === j ? 1 : 0)));
  const first = 1 - fractions.reduce((t, v) => t + v, 0);
  const fractionOf = (m: Mat3): number | undefined => {
    if (isIdentity(m)) return first;
    const i = laws.findIndex((law) => sameRotation(law.matrix, m));
    return i < 0 ? undefined : fractions[i];
  };
  return laws.map((law, i) => {
    const v = fractionOf(negated(law.matrix));
    return v === undefined ? fractions[i]! : Math.min(1, Math.max(0, v));
  });
}

/** 0.25 → "1/4": a shift as the fraction it is, over the smallest denominator up to 8. */
const fractionText = (v: number): string => {
  if (Math.abs(v) < 1e-9) return "0";
  const d = [1, 2, 4, 8].find((q) => Math.abs(v * q - Math.round(v * q)) < 1e-6);
  return d === undefined ? String(v) : d === 1 ? String(Math.round(v)) : `${Math.round(v * d)}/${d}`;
};

/** The inversion in words, as the report and the Agent give it. */
export function inversionText(loaded: StructureModel, inversion: InvertedModel): string {
  const s = inversion.shift;
  const shifted = s.some((v) => v !== 0);
  const from = loaded.spaceGroup.hermannMauguin ?? "the space group";
  return `the model as loaded, inverted through the origin (every coordinate x → ${shifted ? `(${s.map(fractionText).join(", ")}) − x` : "−x"}, as SHELXL's MOVE 1 1 1 −1)${inversion.enantiomorph ? `; the space group ${from} → ${inversion.enantiomorph}, its enantiomorph` : `; the space group ${from} kept`}`;
}
