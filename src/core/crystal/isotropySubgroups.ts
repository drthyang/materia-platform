/**
 * The isotropy subgroups of a Γ irrep on a structure's displacements — its
 * kernel and epikernels (Ascher & Kobayashi, J. Phys. C 10 (1977) 1349;
 * Stokes & Hatch, *Isotropy Subgroups of the 230 Crystallographic Space
 * Groups*, 1988; the ISOTROPY / ISODISTORT suite) — each with a displacement
 * field that lowers the structure to exactly it; and the order parameter that
 * lowers it to a t-subgroup picked from the lattice.
 *
 * At Γ every irrep is trivial on the lattice translations, so its isotropy
 * subgroups are t-subgroups: a subgroup H̄ of the point group with all of G's
 * translations, centring included (Bradley & Cracknell 1972, Ch. 3: the
 * ordinary point-group irreps are the small representations at Γ). The order
 * parameter η of an irrep Γ of dimension d lives in Γ's carrier space, and its
 * isotropy subgroup is the stabilizer of η. For each H̄ ≤ Ḡ the subspace of
 * the carrier space H fixes has the dimension
 *
 *     n_H = (1/|H̄|) Σ_{h ∈ H̄} χ_Γ(h),
 *
 * the multiplicity of H's identity irrep in Γ↓H; for a complex-conjugate pair
 * merged into one physically irreducible real representation χ is the pair's
 * real character χ + χ* and n_H counts real dimensions. Fix(K) ⊆ Fix(H) for
 * K ⊇ H, and equal dimensions mean equal spaces, so H̄ is an isotropy subgroup
 * exactly when n_H > 0 and every K̄ ⊋ H̄ has n_K < n_H: a generic vector of
 * Fix(H) is then fixed by H and by nothing larger. The test needs characters
 * only, so it holds for every irrep of all 32 point groups, multidimensional
 * ones included. Conjugate isotropy subgroups are one order-parameter
 * direction in another orientation; n_H = 1 marks a one-parameter direction
 * (Pm-3m's Γ4⁻, the polar vector T1u: P4mm (a,0,0), Amm2 (a,a,0), R3m (a,a,a)),
 * and the kernel, n_H = d, is a generic direction's (P1 there).
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
import { identifySubgroup, projectIsotypicModes, type DisplacementField, type SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { latticeCentring } from "@/core/crystal/standardSetting";
import { conjugacyKey, withLatticeCentring } from "@/core/crystal/subgroupTree";
import { allSubgroups, buildCosetContext } from "@/core/magnetic/subgroupLattice";
import { rotationKey } from "@/core/magnetic/magneticGroups";

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

/**
 * The isotropy subgroups of one Γ irrep of the structure's space group, one
 * per conjugacy class: the epikernels and the kernel, one-parameter
 * directions first, then by index. See the module comment for the method.
 */
export function irrepIsotropySubgroups(structure: StructureModel, term: DisplaciveIrrepTerm): IsotropySubgroup[] {
  const ops = structure.spaceGroup.operations;
  if (ops.length === 0) return [];
  const ctx = buildCosetContext(ops);
  const centring = latticeCentring(ops);
  const N = ctx.cosets.length;
  // χ per rotation coset (Γ irreps are trivial on translations).
  const chiByRotation = new Map<string, number>();
  ops.forEach((op, i) => {
    const key = rotationKey(op);
    if (!chiByRotation.has(key)) chiByRotation.set(key, term.irrep.characters[i]?.re ?? 0);
  });
  const chi = ctx.cosets.map((c) => chiByRotation.get(rotationKey(c)) ?? 0);
  const dim = Math.round(chi[0] ?? term.irrep.dim ?? 1);

  const subs = allSubgroups(ctx);
  const fixedDim = subs.map((S) => {
    const raw = S.reduce((s, i) => s + chi[i]!, 0) / S.length;
    const n = Math.round(raw);
    if (Math.abs(raw - n) > 1e-6) throw new Error(`isotropySubgroups: non-integral fixed dimension ${raw} for ${term.irrep.label}`);
    return n;
  });
  const sets = subs.map((S) => new Set(S));
  const isotropy = subs
    .map((S, i) => ({ S, n: fixedDim[i]! }))
    .filter(({ S, n }) => n > 0 && subs.every((K, k) => !(K.length > S.length && S.every((x) => sets[k]!.has(x))) || fixedDim[k]! < n));

  // One per conjugacy class; the conjugate named in the parent's own cell is preferred.
  const classes = new Map<string, { S: number[]; n: number }[]>();
  for (const { S, n } of isotropy) {
    const key = conjugacyKey(S, ctx);
    const list = classes.get(key);
    if (list) list.push({ S, n });
    else classes.set(key, [{ S, n }]);
  }

  const action = atomAction(structure, ops);
  const isotypic = projectIsotypicModes(structure, undefined, term, ops);
  const out: IsotropySubgroup[] = [];
  for (const members of classes.values()) {
    const named = members.map((m) => {
      const operations = withLatticeCentring(m.S.map((i) => ctx.cosets[i]!), centring);
      const asGiven = identifySubgroup(operations, ops);
      return { ...m, operations, asGiven: asGiven.method === "direct" };
    });
    const rep = named.find((m) => m.asGiven) ?? named[0]!;
    const subAction = atomAction(structure, rep.operations);
    const basis = fixedOpticBasis(structure, isotypic, rep.operations, subAction.image);
    out.push({
      operations: rep.operations,
      identity: identifySubgroup(rep.operations, ops, { standard: true }),
      orderParameterDim: rep.n,
      kernel: rep.n === dim,
      conjugates: members.length,
      domainStates: N / rep.S.length,
      field: genericField(basis, ops, action, rep.operations.length),
    });
  }
  return out.sort((a, b) => a.orderParameterDim - b.orderParameterDim || a.domainStates - b.domainStates || (a.identity.number ?? 999) - (b.identity.number ?? 999));
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
