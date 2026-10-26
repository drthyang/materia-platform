/**
 * Displacive distortions at the decentring k-points of a centred parent —
 * the Phase-1 half of the subgroup engine on a structure: the irreps at the
 * k-points of the conventional-cell bound other than Γ (X for F, H for I,
 * (1,0,0) for C, (0,0,1) for R on hexagonal axes), which lower the symmetry
 * without enlarging the conventional cell, so the existing PDF and Rietveld
 * engines refine the child as it stands.
 *
 *  - `decentringTerms`: the physically irreducible representations at those
 *    stars that the structure's displacements carry, with their multiplicity
 *    n = ⟨χ, χ_disp⟩ / ⟨χ, χ⟩ over the factor group (χ_disp from
 *    displaciveModes.ts); the same term shape as the Γ decomposition, so the
 *    isotypic projector and the isotropy machinery serve both.
 *  - `irrepModeSeeds`: the child's displacement modes grouped by parent irrep
 *    and parent Wyckoff site — for each irrep and each site, the part of the
 *    irrep's isotypic component on that site's orbit that the child group
 *    fixes (site projection, Stokes, Hatch & Wells, PRB 43 (1991) 11010;
 *    docs/research/SUBGROUP_ENGINES.md §4.1). Together they span the child's
 *    allowed displacements.
 *  - `activateIsotropySubgroup`: a decentring irrep's isotropy subgroup made
 *    the child, realized in the parent's conventional cell (Wyckoff orbits
 *    split), its modes per irrep with the order parameter first.
 */

import type { Vec3 } from "@/core/math/types";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import { applyOperation } from "@/core/crystal/symmetry";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { mulVec } from "@/core/math/mat3";
import { decomposeDisplacementRepresentation, displacementCharacters, orbitAtoms, type DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import { fieldSeedAxes, identifySubgroup, projectIsotypicModes, realizeSubgroup, stabilizerOfField, type DisplacementField, type SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { buildSymmetryModes, type DistortionModeSet, type SymmetryModeSeed } from "@/core/crystal/distortionModes";
import { irrepEngine, isotropyField, subgroupOrderParameter, type SubgroupOrderParameter } from "@/core/crystal/isotropySubgroups";
import type { KStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { latticeCentring } from "@/core/crystal/standardSetting";

/** A decentring irrep the structure's displacements carry. */
export interface DecentringTerm {
  readonly star: KStar;
  readonly term: DisplaciveIrrepTerm;
}

/** The physically irreducible representations at the bound's k ≠ 0 stars that carry displacements, star by star. */
export function decentringTerms(structure: StructureModel): DecentringTerm[] {
  const ops = structure.spaceGroup.operations;
  if (ops.length === 0) return [];
  const engine = irrepEngine(ops);
  const chi = displacementCharacters(structure);
  const out: DecentringTerm[] = [];
  for (const s of engine.stars) {
    if (s.star.k.every((x) => x === 0)) continue;
    for (const p of s.physical) {
      let pp = 0;
      let pd = 0;
      p.characters.forEach((c, f) => {
        pp += c * c;
        pd += c * chi[f]!;
      });
      const n = pd / pp;
      const m = Math.round(n);
      if (Math.abs(n - m) > 1e-6) throw new Error(`decentringTerms: non-integral multiplicity ${n} of ${p.label}`);
      if (m <= 0) continue;
      out.push({
        star: s.star,
        term: {
          irrep: { label: p.label, characters: p.characters.map((re) => ({ re, im: 0 })), real: true, dim: p.dim },
          multiplicity: m,
          acoustic: 0,
          trivial: false,
        },
      });
    }
  }
  return out;
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

/**
 * The child's displacement modes grouped by parent irrep and parent site:
 * for each term and each parent site, an orthonormal basis (Cartesian metric
 * over the site's atoms in the cell) of the irrep's isotypic component on the
 * site's orbit that `subOps` fixes, as mode seeds on the realized child. The
 * seeds enter inactive; the caller puts the order parameter first.
 */
export function irrepModeSeeds(parent: StructureModel, child: StructureModel, subOps: readonly SymmetryOperation[], terms: readonly { readonly term: DisplaciveIrrepTerm; readonly star?: string }[]): SymmetryModeSeed[] {
  const ops = parent.spaceGroup.operations;
  const M = orthogonalizationMatrix(parent.cell);
  const seeds: SymmetryModeSeed[] = [];
  for (const site of parent.sites) {
    const atoms = orbitAtoms(parent, [site.label]);
    const image = subOps.map((h) => atoms.map((r) => {
      const img = applyOperation(h, r);
      const m = atoms.findIndex((q) => samePos(q, img));
      if (m < 0) throw new Error(`irrepModeSeeds: ${site.label}'s orbit is not closed under ${h.xyz}`);
      return m;
    }));
    const dot = (x: readonly Vec3[], y: readonly Vec3[]): number => x.reduce((s, v, j) => {
      const a = mulVec(M, v);
      const b = mulVec(M, y[j]!);
      return s + a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }, 0);
    for (const { term, star } of terms) {
      const isotypic = projectIsotypicModes(parent, [site.label], term, ops);
      const basis: Vec3[][] = [];
      for (const f of isotypic) {
        // The atoms of the projected field are this site's orbit, in orbitAtoms order.
        const u = atoms.map((r) => f.atoms.find((a) => samePos(a.position, r))?.u ?? ([0, 0, 0] as Vec3));
        // The average over the child group projects onto the fields it fixes.
        let w: Vec3[] = atoms.map(() => [0, 0, 0] as Vec3);
        subOps.forEach((h, hi) => {
          u.forEach((v, j) => {
            const t = image[hi]![j]!;
            const r = mulVec(h.rotation, v);
            w[t] = [w[t]![0] + r[0] / subOps.length, w[t]![1] + r[1] / subOps.length, w[t]![2] + r[2] / subOps.length];
          });
        });
        for (const q of basis) {
          const s = dot(w, q);
          w = w.map((v, j) => [v[0] - s * q[j]![0], v[1] - s * q[j]![1], v[2] - s * q[j]![2]] as Vec3);
        }
        const n = Math.sqrt(dot(w, w));
        if (n > 1e-7) basis.push(w.map((v) => [v[0] / n, v[1] / n, v[2] / n] as Vec3));
      }
      basis.forEach((b, j) => {
        const field: DisplacementField = { atoms: atoms.map((position, i) => ({ position, u: b[i]! })) };
        const axes = fieldSeedAxes(child, field);
        if (axes.length === 0) return;
        seeds.push({ axes, label: `${term.irrep.label} · ${site.label}${basis.length > 1 ? ` ${j + 1}` : ""}`, ...(star !== undefined ? { star } : {}), active: false });
      });
    }
  }
  return seeds;
}

/** The symmetry-breaking irreps a child's modes are grouped by: Γ's (their point-group labels) and the decentring ones. */
export function modeTerms(structure: StructureModel): { readonly term: DisplaciveIrrepTerm; readonly star: string }[] {
  const gamma = decomposeDisplacementRepresentation(structure);
  return [
    ...(gamma.available ? gamma.terms.map((term) => ({ term, star: "Γ" })) : []),
    ...decentringTerms(structure).map(({ star, term }) => ({ term, star: star.label })),
  ];
}

/** An activated decentring distortion: the child in the parent's cell and its mode set, the order parameter first. */
export interface ActivatedIsotropySubgroup {
  readonly child: StructureModel;
  readonly identity: SubgroupIdentity;
  readonly modeSet: DistortionModeSet;
}

/**
 * Lower a structure to an isotropy subgroup of one of its decentring irreps:
 * the order parameter (a generic field of the irrep that the subgroup fixes,
 * isotropyField) is realized as the child's leading, active mode, and the
 * child's other displacements follow as modes per parent irrep and site,
 * inactive. Null when the irrep has no field with this symmetry here.
 */
export function activateIsotropySubgroup(parent: StructureModel, term: DisplaciveIrrepTerm, subOps: readonly SymmetryOperation[], label: string, star: string): ActivatedIsotropySubgroup | null {
  const field = isotropyField(parent, term, subOps);
  if (!field) return null;
  const ops = parent.spaceGroup.operations;
  const stabilizer = stabilizerOfField(field, ops);
  const identity = identifySubgroup(stabilizer, ops, { standard: true });
  const child = realizeSubgroup(parent, stabilizer, identity);
  const seeds: SymmetryModeSeed[] = [
    { axes: fieldSeedAxes(child, field), label, star },
    ...irrepModeSeeds(parent, child, stabilizer, modeTerms(parent)),
  ];
  const built = buildSymmetryModes(child, { seeds, gauge: "polar" });
  return { child, identity, modeSet: { ...built, amplitudeCells: amplitudeCells(parent, child) } };
}

/**
 * The lattice points per conventional cell of the child and of the parent:
 * a mode amplitude normalized over the conventional child cell (MATERIA's
 * parameter) is √f_child times ISODISTORT's A_s (over the primitive child
 * cell) and √f_parent times A_p = A_s·√(V_p/V_s) (ADR 0003).
 */
export function amplitudeCells(parent: StructureModel, child: StructureModel): { readonly child: number; readonly parent: number } {
  return { child: latticeCentring(child.spaceGroup.operations).length, parent: latticeCentring(parent.spaceGroup.operations).length };
}

/** A subgroup picked from the same-cell lattice, realized: the child, its modes per irrep, and the order parameter leading them. */
export interface LoweredToSubgroup {
  readonly child: StructureModel;
  readonly modeSet: DistortionModeSet;
  /** The order parameter, from the fewest irreps that reach the subgroup; null when no displacement breaks the symmetry. */
  readonly order: SubgroupOrderParameter | null;
}

/**
 * Lower a structure to a subgroup that keeps its conventional cell (a
 * decentring k-subgroup or a general one): the child realized with its
 * orbits split, the order parameter drawn from the Γ and decentring irreps
 * (subgroupOrderParameter) leading as the active mode, the child's other
 * displacements as modes per parent irrep and site, inactive.
 */
export function lowerToSubgroup(parent: StructureModel, subOps: readonly SymmetryOperation[], identity: SubgroupIdentity, name: string): LoweredToSubgroup {
  const terms = modeTerms(parent);
  const child = realizeSubgroup(parent, subOps, identity);
  const order = subgroupOrderParameter(parent, subOps, terms.filter((t) => !t.term.trivial).map((t) => t.term));
  const seeds: SymmetryModeSeed[] = [
    ...(order ? [{ axes: fieldSeedAxes(child, order.field), label: `${order.irreps.join(" + ")} → ${name}` }] : []),
    ...irrepModeSeeds(parent, child, subOps, terms),
  ];
  const built = buildSymmetryModes(child, { seeds, gauge: "polar" });
  return { child, modeSet: { ...built, amplitudeCells: amplitudeCells(parent, child) }, order };
}
