/**
 * Order parameters beyond one irrep (docs/research/SUBGROUP_ENGINES.md §3.3,
 * §3.5; Campbell et al. 2006 §4.3–4.6; Stokes, van Orden & Campbell 2016):
 *
 *  - the irreps a child group allows, the inverse query (Bilbao's
 *    Get_irreps): for a subgroup S, every physically irreducible
 *    representation with n_j = (1/|S|) Σ_{x∈S} χ_j(x) > 0 — n_j is the
 *    dimension of the subspace S fixes — with that subspace (the
 *    order-parameter direction S allows) and its isotropy subgroup, a
 *    supergroup of S, equal to S exactly when the irrep reaches S alone;
 *  - the secondary irreps of an isotropy subgroup: the same list, minus the
 *    primary irrep;
 *  - coupled primary irreps: the isotropy subgroup of a superposition is the
 *    intersection of the isotropy subgroups, and which domain of the second
 *    order parameter is combined with the first changes the result, so every
 *    domain choice is made explicit: H₁ ∩ gH₂g⁻¹ over the distinct conjugates
 *    of H₂, grouped into conjugacy classes.
 */

import type { FactorGroup } from "@/core/crystal/irreps/factorGroup";
import type { SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { nameChild, keepsConventionalCell } from "@/core/crystal/irreps/childSetting";
import { directionSymbol, indexSplit, type IndexSplit } from "@/core/crystal/irreps/isotropy";
import type { PhysicalIrrep, StarIrreps } from "@/core/crystal/irreps/spaceGroupIrreps";
import { symmetricEigenDecomposition } from "@/core/math/linalg";

/** An irrep a child allows. */
export interface AllowedIrrep {
  /** The star's label and the irrep's ("X irrep 3 of 10"). */
  readonly starLabel: string;
  readonly irrep: PhysicalIrrep;
  /** n_j: the dimension of the subspace the child fixes. */
  readonly multiplicity: number;
  /** The direction the child allows, in symbols ("(a,0,0)"). */
  readonly direction: string;
  /** Its isotropy subgroup's elements (a supergroup of the child). */
  readonly isotropyElements: readonly number[];
  /** True when the irrep alone lowers the parent to the child (its isotropy subgroup is the child). */
  readonly reachesChild: boolean;
}

/** The subspace of a representation the elements fix: the null space of Σ (D(x) − I)ᵀ(D(x) − I). */
function fixedSubspace(pir: PhysicalIrrep, elements: readonly number[]): number[][] {
  const n = pir.dim;
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const x of elements) {
    const D = pir.matrices[x]!;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += (D[k * n + i]! - (k === i ? 1 : 0)) * (D[k * n + j]! - (k === j ? 1 : 0));
        M[i]![j]! += s;
      }
    }
  }
  const { values, vectors } = symmetricEigenDecomposition(M);
  const out: number[][] = [];
  for (let k = 0; k < n; k++) if (Math.abs(values[k]!) < 1e-8 * n * Math.max(1, elements.length)) out.push(vectors.map((row) => row[k]!));
  return out;
}

/** The elements that fix every vector of the subspace. */
function pointwiseStabilizer(group: FactorGroup, pir: PhysicalIrrep, basis: readonly number[][]): number[] {
  const n = pir.dim;
  const out: number[] = [];
  for (let f = 0; f < group.elements.length; f++) {
    const D = pir.matrices[f]!;
    const ok = basis.every((b) => {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += D[i * n + j]! * b[j]!;
        if (Math.abs(s - b[i]!) > 1e-7) return false;
      }
      return true;
    });
    if (ok) out.push(f);
  }
  return out;
}

/**
 * The irreps a child group S (factor-group elements) allows, over the given
 * stars: every physically irreducible representation with n_j > 0 except the
 * identity irrep, with the direction S allows and whether that irrep alone
 * reaches S. Ordered by star, then irrep.
 */
export function irrepsFor(group: FactorGroup, stars: readonly StarIrreps[], elements: readonly number[]): AllowedIrrep[] {
  const out: AllowedIrrep[] = [];
  const S = [...elements].sort((a, b) => a - b);
  for (const star of stars) {
    for (const pir of star.physical) {
      // The identity irrep: every character equals the dimension 1.
      if (pir.dim === 1 && pir.characters.every((c) => Math.abs(c - 1) < 1e-9)) continue;
      let sum = 0;
      for (const x of S) sum += pir.characters[x]!;
      const multiplicity = Math.round(sum / S.length);
      if (Math.abs(sum / S.length - multiplicity) > 1e-6) throw new Error(`irrepsFor: n_j = ${sum / S.length} is not an integer for ${pir.label}`);
      if (multiplicity <= 0) continue;
      const basis = fixedSubspace(pir, S);
      if (basis.length !== multiplicity) throw new Error(`irrepsFor: the fixed subspace of ${pir.label} has dimension ${basis.length}, n_j = ${multiplicity}`);
      const iso = pointwiseStabilizer(group, pir, basis);
      out.push({
        starLabel: star.star.label,
        irrep: pir,
        multiplicity,
        direction: directionSymbol(basis),
        isotropyElements: iso,
        reachesChild: iso.length === S.length,
      });
    }
  }
  return out;
}

/** The secondary irreps of an isotropy subgroup: the irreps it allows other than its primary one. */
export function secondaryIrreps(group: FactorGroup, stars: readonly StarIrreps[], elements: readonly number[], primary: PhysicalIrrep): AllowedIrrep[] {
  return irrepsFor(group, stars, elements).filter((a) => a.irrep !== primary);
}

/** One child of two coupled order parameters, for one choice of the second one's domain. */
export interface CoupledChild {
  readonly elements: readonly number[];
  /** The element g that carries the second isotropy subgroup to the domain combined: H₁ ∩ gH₂g⁻¹ (its operation, translations modulo T″). */
  readonly domain: { readonly element: number; readonly xyz: string };
  /** How many of the second subgroup's distinct conjugates give this class. */
  readonly domainChoices: number;
  readonly index: IndexSplit;
  readonly cellMultiplying: boolean;
  readonly identity: SubgroupIdentity;
}

const conjugate = (group: FactorGroup, g: number, H: readonly number[]): number[] =>
  H.map((h) => group.table[group.table[g]![h]!]![group.inverse[g]!]!).sort((a, b) => a - b);

/**
 * The children of two coupled order parameters with isotropy subgroups H₁
 * and H₂ (factor-group elements): H₁ ∩ gH₂g⁻¹ for every distinct conjugate
 * of H₂, one entry per conjugacy class of the result, the domain choice that
 * first gave it recorded, smallest index first.
 */
export function coupledIsotropy(group: FactorGroup, H1: readonly number[], H2: readonly number[]): CoupledChild[] {
  const F = group.elements.length;
  const in1 = new Uint8Array(F);
  for (const h of H1) in1[h] = 1;
  const seen = new Set<string>();
  const classes = new Map<string, { elements: number[]; g: number; count: number }>();
  const canonical = (K: readonly number[]): string => {
    let best: string | null = null;
    for (let g = 0; g < F; g++) {
      const k = conjugate(group, g, K).join(",");
      if (best === null || k < best) best = k;
    }
    return best!;
  };
  for (let g = 0; g < F; g++) {
    const C = conjugate(group, g, H2);
    const key = C.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const K = C.filter((x) => in1[x]);
    const c = canonical(K);
    const cur = classes.get(c);
    if (cur) cur.count++;
    else classes.set(c, { elements: K, g, count: 1 });
  }
  return [...classes.values()]
    .map(({ elements, g, count }) => ({
      elements,
      domain: { element: g, xyz: group.operations[g]!.xyz },
      domainChoices: count,
      index: indexSplit(group, elements),
      cellMultiplying: !keepsConventionalCell(group, elements),
      identity: nameChild(group, elements),
    }))
    .sort((a, b) => b.elements.length - a.elements.length);
}
