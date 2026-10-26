/**
 * The isotropy subgroups of an irrep on a structure's displacements — its
 * kernel and epikernels (Ascher & Kobayashi, J. Phys. C 10 (1977) 1349;
 * Stokes & Hatch, *Isotropy Subgroups of the 230 Crystallographic Space
 * Groups*, 1988; the ISOTROPY / ISODISTORT suite) — each with a displacement
 * field that lowers the structure to exactly it; and the order parameter that
 * lowers it to a t-subgroup picked from the lattice.
 *
 * The subgroups come from the general engine (irreps/isotropy.ts): the
 * irrep's physically irreducible representation on the factor group of the
 * conventional cell, its image group's fixed spaces (the order-parameter
 * directions) and their stabilizers pulled back to the parent, named in ITA
 * standard setting. It serves Γ irreps (the cell-preserving distortions, the
 * t-subgroups) and the decentring irreps of a centred parent (X for F, H for
 * I, …), whose isotropy subgroups keep the conventional cell and lose some of
 * its centring translations. A Γ irrep is found among the engine's by its
 * characters, so the point-group labels of displaciveModes.ts carry over.
 *
 * On the structure, the irrep's isotypic component of the displacement
 * representation is Γ ⊗ ℝ^m (m its multiplicity): its fixed space under H is
 * Fix_Γ(H) ⊗ ℝ^m, and the stabilizer of any of its vectors is the pointwise
 * stabilizer of a subspace of Γ, again an isotropy subgroup of Γ. A generic
 * field of Fix(H) in the optic part (the rigid translations projected out,
 * since they are unobservable) therefore has stabilizer exactly H whenever
 * the irrep has an optic copy; the field is built that way and its stabilizer
 * checked.
 */

import type { Vec3 } from "@/core/math/types";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import { applyOperation } from "@/core/crystal/symmetry";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { mulVec } from "@/core/math/mat3";
import { decomposeDisplacementRepresentation, orbitAtoms, type DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import { projectIsotypicModes, type DisplacementField, type SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsInBound, type PhysicalIrrep, type StarIrreps } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups, type IndexSplit } from "@/core/crystal/irreps/isotropy";

/** One isotropy subgroup of an irrep (a class of conjugates), with a field that reaches it. */
export interface IsotropySubgroup {
  /** Its operations in the parent's cell, the parent's centring kept. */
  readonly operations: readonly SymmetryOperation[];
  /** Its name in the standard setting (identifySubgroup with `standard`). */
  readonly identity: SubgroupIdentity;
  /** n_H: the free components of the order parameter along this direction (1: a one-parameter direction). */
  readonly orderParameterDim: number;
  /** True for the kernel, the isotropy subgroup of a generic direction (n_H = the irrep's dimension). */
  readonly kernel: boolean;
  /** Conjugate isotropy subgroups, [G : N_G(H)]: the orientations of this direction. */
  readonly conjugates: number;
  /** Domain states, [G : H]. */
  readonly domainStates: number;
  /** An optic displacement field with exactly this stabilizer; null when the irrep has no optic copy here. */
  readonly field: DisplacementField | null;
  /** The order-parameter direction, in the irrep's basis: "(a,0,0)", "(a,a,a)", …. */
  readonly direction: string;
  /** [G : H] = t·k, the point-group and the translation factor. */
  readonly index: IndexSplit;
}

const wrap = (v: number): number => {
  const x = v % 1;
  return x < 0 ? x + 1 : x;
};
const samePos = (a: Vec3, b: Vec3, tol = 1e-3): boolean => {
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(wrap(a[i]!) - wrap(b[i]!));
    if (Math.min(d, 1 - d) > tol) return false;
  }
  return true;
};

/** The structure's orbit atoms and, per operation, the atom each one maps to (mod lattice). */
interface AtomAction {
  readonly atoms: readonly Vec3[];
  readonly image: readonly (readonly number[])[];
}

function atomAction(structure: StructureModel, ops: readonly SymmetryOperation[]): AtomAction {
  const atoms = orbitAtoms(structure, structure.sites.map((s) => s.label));
  const image = ops.map((g) => atoms.map((r) => {
    const img = applyOperation(g, r);
    const m = atoms.findIndex((q) => samePos(q, img));
    if (m < 0) throw new Error(`isotropySubgroups: the orbit is not closed under ${g.xyz}`);
    return m;
  }));
  return { atoms, image };
}

type Field = Vec3[];

/** ρ(g)u: (ρ(g)u)(g·r) = W_g u(r). */
function act(u: Field, g: SymmetryOperation, image: readonly number[]): Field {
  const out: Vec3[] = u.map(() => [0, 0, 0] as Vec3);
  u.forEach((v, j) => {
    out[image[j]!] = mulVec(g.rotation, v);
  });
  return out;
}

/** The operations (indices into `ops`) under which a field is invariant. */
function stabilizerIndices(u: Field, ops: readonly SymmetryOperation[], action: AtomAction, tol = 1e-7): number[] {
  const scale = Math.max(1e-12, ...u.map((v) => Math.hypot(v[0], v[1], v[2])));
  const out: number[] = [];
  ops.forEach((g, gi) => {
    const img = action.image[gi]!;
    for (let j = 0; j < u.length; j++) {
      const w = mulVec(g.rotation, u[j]!);
      const t = u[img[j]!]!;
      if (Math.abs(w[0] - t[0]) > tol * scale || Math.abs(w[1] - t[1]) > tol * scale || Math.abs(w[2] - t[2]) > tol * scale) return;
    }
    out.push(gi);
  });
  return out;
}

/**
 * An orthonormal basis (Cartesian metric over the cell's atoms) of the optic
 * fields in one irrep's isotypic component that a group fixes: the isotypic
 * basis with the rigid translation projected out, averaged over the group.
 */
function fixedOpticBasis(structure: StructureModel, isotypic: readonly DisplacementField[], subOps: readonly SymmetryOperation[], subImages: readonly (readonly number[])[]): Field[] {
  const M = orthogonalizationMatrix(structure.cell);
  const dot = (x: Field, y: Field): number => x.reduce((s, v, j) => {
    const a = mulVec(M, v);
    const b = mulVec(M, y[j]!);
    return s + a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }, 0);
  const basis: Field[] = [];
  for (const f of isotypic) {
    const u = f.atoms.map((a) => a.u);
    // The rigid translation (the atoms' mean shift) is unobservable: drop it.
    const mean: Vec3 = [0, 1, 2].map((i) => u.reduce((s, v) => s + v[i]!, 0) / u.length) as unknown as Vec3;
    const optic: Field = u.map((v) => [v[0] - mean[0], v[1] - mean[1], v[2] - mean[2]] as Vec3);
    // The group average projects onto the fields it fixes.
    const avg: Vec3[] = optic.map(() => [0, 0, 0] as Vec3);
    subOps.forEach((g, gi) => {
      act(optic, g, subImages[gi]!).forEach((v, j) => {
        avg[j] = [avg[j]![0] + v[0] / subOps.length, avg[j]![1] + v[1] / subOps.length, avg[j]![2] + v[2] / subOps.length];
      });
    });
    let w: Field = avg;
    for (const q of basis) {
      const s = dot(w, q);
      w = w.map((v, j) => [v[0] - s * q[j]![0], v[1] - s * q[j]![1], v[2] - s * q[j]![2]] as Vec3);
    }
    const n = Math.sqrt(dot(w, w));
    if (n > 1e-7) basis.push(w.map((v) => [v[0] / n, v[1] / n, v[2] / n] as Vec3));
  }
  return basis;
}

/** Deterministic, rationally independent weights for a generic combination (try `k` of a few). */
const genericWeights = (n: number, k: number): number[] => Array.from({ length: n }, (_, i) => 1 + 0.5 * Math.sin(1.7 * (i + 1) * (k + 1) + 0.3 * k));

const asField = (atoms: readonly Vec3[], u: Field): DisplacementField => ({ atoms: atoms.map((position, j) => ({ position, u: u[j]! })) });

/**
 * A generic optic field of an irrep's isotypic component fixed by `subOps`,
 * checked to be fixed by nothing more; null when there is none (no optic copy,
 * or the irrep has no fixed vector under the group).
 */
export function isotropyField(structure: StructureModel, term: DisplaciveIrrepTerm, subOps: readonly SymmetryOperation[]): DisplacementField | null {
  const ops = structure.spaceGroup.operations;
  const action = atomAction(structure, ops);
  const subAction = atomAction(structure, subOps);
  const isotypic = projectIsotypicModes(structure, undefined, term, ops);
  const basis = fixedOpticBasis(structure, isotypic, subOps, subAction.image);
  return genericField(basis, ops, action, subOps.length);
}

function genericField(basis: readonly Field[], ops: readonly SymmetryOperation[], action: AtomAction, order: number): DisplacementField | null {
  if (basis.length === 0) return null;
  let best: { u: Field; size: number } | null = null;
  for (let k = 0; k < 4; k++) {
    const w = genericWeights(basis.length, k);
    const u: Field = basis[0]!.map((_, j) => [0, 1, 2].map((i) => basis.reduce((s, b, bi) => s + w[bi]! * b[j]![i]!, 0)) as unknown as Vec3);
    const size = stabilizerIndices(u, ops, action).length;
    if (!best || size < best.size) best = { u, size };
    if (size === order) break;
  }
  return best ? asField(action.atoms, best.u) : null;
}

interface Engine {
  readonly group: FactorGroup;
  readonly stars: readonly StarIrreps[];
}

const engineCache = new WeakMap<readonly SymmetryOperation[], Engine>();

/** The factor group of the conventional cell and every star's irreps, once per operation list. */
export function irrepEngine(ops: readonly SymmetryOperation[]): Engine {
  let e = engineCache.get(ops);
  if (!e) {
    const group = factorGroup(ops);
    e = { group, stars: irrepsInBound(group) };
    engineCache.set(ops, e);
  }
  return e;
}

/** The engine's physically irreducible representation with the term's characters (per operation). */
function physicalIrrepOf(engine: Engine, term: DisplaciveIrrepTerm): PhysicalIrrep | null {
  for (const s of engine.stars) {
    for (const p of s.physical) {
      if (p.characters.every((c, i) => Math.abs(c - (term.irrep.characters[i]?.re ?? Number.NaN)) < 1e-6)) return p;
    }
  }
  return null;
}

/**
 * The isotropy subgroups of one irrep of the structure's space group (a Γ
 * irrep, or a decentring one of a centred parent), one per conjugacy class:
 * the epikernels and the kernel, one-parameter directions first, then by
 * index. See the module comment for the method.
 */
export function irrepIsotropySubgroups(structure: StructureModel, term: DisplaciveIrrepTerm): IsotropySubgroup[] {
  const ops = structure.spaceGroup.operations;
  if (ops.length === 0) return [];
  const engine = irrepEngine(ops);
  const pir = physicalIrrepOf(engine, term);
  if (!pir) throw new Error(`isotropySubgroups: ${term.irrep.label} is not an irrep of the parent in the conventional-cell bound`);
  const analysis = isotropySubgroups(engine.group, pir);
  const action = atomAction(structure, ops);
  const isotypic = projectIsotypicModes(structure, undefined, term, ops);
  return analysis.subgroups.map((sub) => {
    const subAction = atomAction(structure, sub.operations);
    const basis = fixedOpticBasis(structure, isotypic, sub.operations, subAction.image);
    return {
      operations: sub.operations,
      identity: sub.identity,
      orderParameterDim: sub.direction.dim,
      kernel: sub.kernel,
      conjugates: sub.orientationStates,
      domainStates: sub.domainStates,
      field: genericField(basis, ops, action, sub.operations.length),
      direction: sub.direction.symbol,
      index: sub.index,
    };
  });
}

/** The order parameter that lowers a structure to a t-subgroup: a field, the irreps it is built from, and its stabilizer's size. */
export interface SubgroupOrderParameter {
  readonly field: DisplacementField;
  /** The irreps the field draws on (one when a single irrep's isotropy subgroup is the target). */
  readonly irreps: readonly string[];
  /** True when the field's stabilizer is the target itself; false when the displacements allowed keep a larger group. */
  readonly reachesTarget: boolean;
}

/**
 * The order parameter that lowers the structure to a t-subgroup picked from
 * the lattice: an optic displacement field the subgroup fixes and the parent
 * does not, its stabilizer exactly the subgroup when the structure's
 * displacements can reach it. A primary irrep is preferred (one whose fixed
 * fields under the subgroup are fixed by nothing larger: the subgroup is one
 * of its isotropy subgroups); when none is, irreps are added, the one that
 * lowers the stabilizer most first, until it is the subgroup (a coupled order
 * parameter). Null when no symmetry-breaking displacement is fixed by the
 * subgroup (it differs from the parent in its metric only, as NaCl's I4/mmm).
 */
export function subgroupOrderParameter(structure: StructureModel, subOps: readonly SymmetryOperation[]): SubgroupOrderParameter | null {
  const ops = structure.spaceGroup.operations;
  const dec = decomposeDisplacementRepresentation(structure);
  if (!dec.available) return null;
  const action = atomAction(structure, ops);
  const subAction = atomAction(structure, subOps);
  const order = subOps.length;
  const parts: { label: string; u: Field; size: number }[] = [];
  for (const term of dec.terms) {
    if (term.trivial || term.multiplicity - term.acoustic <= 0) continue;
    const basis = fixedOpticBasis(structure, projectIsotypicModes(structure, undefined, term, ops), subOps, subAction.image);
    const f = genericField(basis, ops, action, order);
    if (!f) continue;
    const u = f.atoms.map((a) => a.u);
    parts.push({ label: term.irrep.label, u, size: stabilizerIndices(u, ops, action).length });
  }
  if (parts.length === 0) return null;
  const primary = parts.find((p) => p.size === order);
  if (primary) return { field: asField(action.atoms, primary.u), irreps: [primary.label], reachesTarget: true };
  // Coupled: add irreps while the stabilizer shrinks.
  const sum = (x: Field, y: Field): Field => x.map((v, j) => [v[0] + y[j]![0], v[1] + y[j]![1], v[2] + y[j]![2]] as Vec3);
  const chosen = [...parts].sort((a, b) => a.size - b.size).slice(0, 1);
  let u = chosen[0]!.u;
  let size = chosen[0]!.size;
  while (size > order) {
    let next: { part: (typeof parts)[number]; size: number; u: Field } | null = null;
    for (const p of parts) {
      if (chosen.includes(p)) continue;
      const w = sum(u, p.u);
      const s = stabilizerIndices(w, ops, action).length;
      if (s < size && (!next || s < next.size)) next = { part: p, size: s, u: w };
    }
    if (!next) break;
    chosen.push(next.part);
    u = next.u;
    size = next.size;
  }
  return { field: asField(action.atoms, u), irreps: chosen.map((p) => p.label), reachesTarget: size === order };
}
