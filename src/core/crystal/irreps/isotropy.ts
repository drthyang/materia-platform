/**
 * Isotropy subgroups by the image method (docs/research/SUBGROUP_ENGINES.md
 * §3.1; Stokes & Hatch 1988; Stokes, Hatch & Kim, Acta Cryst. A43 (1987) 81):
 * the subgroups of a physically irreducible representation's image group
 * L = D(F) that fix a vector, their fixed spaces (the order-parameter
 * directions), pulled back to the parent group and named in ITA standard
 * setting with their child basis (P_H, p_H).
 *
 * Method. The isotropy subgroup of a direction η is G_η = D⁻¹(L_η). Its fixed
 * space Fix(G_η) is the intersection of the fixed spaces of the cyclic
 * subgroups it contains, and conversely every intersection W of fixed spaces
 * of single image elements is the fixed space of its own stabilizer
 * {f : D(f)w = w ∀w ∈ W}. So the order-parameter directions are exactly the
 * nonzero subspaces in the intersection closure of {Fix(D(f))}, each with its
 * isotropy subgroup, and distinct subspaces give distinct subgroups — no
 * enumeration of all subgroups of L is needed. The whole space gives the
 * kernel (the operations D maps to 1); the others are epikernels.
 *
 * Conjugate isotropy subgroups are one direction in another orientation:
 * there are [G : N_G(H)] of them (orientation states) and [G : H] domain
 * states. One representative per class is reported: the conjugate the
 * parent's cell names directly when there is one, else the one with the
 * simplest direction symbol, coefficients that read as small fractions
 * first: (a,-a) rather than (a,0.268a) for the same direction in another
 * orientation. The irrep's basis is chosen so that one exists where the
 * image allows it (directionBasis.ts).
 */

import type { SymmetryOperation } from "@/core/crystal/types";
import { identifySubgroup, type SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { pointGroupElements, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { keepsConventionalCell, nameChild, subgroupLattice } from "@/core/crystal/irreps/childSetting";
import { inDual } from "@/core/crystal/irreps/supercell";
import type { PhysicalIrrep } from "@/core/crystal/irreps/spaceGroupIrreps";
import { ikey, iIsIdentity, vfrom } from "@/core/crystal/irreps/rational";
import { fixedSpace, intersect, isSimpleFraction, projector, projectorKey, type Vec } from "@/core/crystal/irreps/subspace";

/** A direction of the order parameter: the subspace of the irrep's carrier space an isotropy subgroup fixes. */
export interface OrderParameterDirection {
  /** Its dimension: the number of free order-parameter components (1: a one-parameter direction). */
  readonly dim: number;
  /** An orthonormal basis, in the physically irreducible representation's basis. */
  readonly basis: readonly (readonly number[])[];
  /** A generic vector of it in symbols, e.g. "(a,0,0)", "(a,a,a)", "(a,b,0)". */
  readonly symbol: string;
}

/** The index [G : H] = t·k: the point-group factor t and the translation factor k. */
export interface IndexSplit {
  readonly t: number;
  readonly k: number;
}

export interface IrrepIsotropySubgroup {
  /** The factor-group elements of the subgroup. */
  readonly elements: readonly number[];
  /** Its operations in the parent's cell, the centring translations it keeps included. */
  readonly operations: readonly SymmetryOperation[];
  readonly direction: OrderParameterDirection;
  /** True for the kernel, the isotropy subgroup of a generic direction. */
  readonly kernel: boolean;
  /** Conjugate subgroups, [G : N_G(H)]: the orientations of this direction. */
  readonly orientationStates: number;
  /** Domain states, [G : H]. */
  readonly domainStates: number;
  readonly index: IndexSplit;
  /** The name in ITA standard setting, with (P_H, p_H) when the cell or origin differs from the parent's. */
  readonly identity: SubgroupIdentity;
  /** True when the child loses translations of the conventional cell (its realisation needs the supercell, phase 3). */
  readonly cellMultiplying: boolean;
  /** The arms of the star the direction involves (1-based, in the star's arm order). */
  readonly activeArms: readonly number[];
}

/**
 * The arms of the star a subgroup's distortion is built from: the arms k_j
 * with k_j·t ∈ ℤ for every translation t the subgroup keeps (1-based, in
 * the star's order) — the waves its lattice admits. Basis-independent: the
 * real form of a real irrep can mix an arm with its partner at −k.
 */
function activeArms(group: FactorGroup, elements: readonly number[], pir: PhysicalIrrep): number[] {
  const lattice = subgroupLattice(group, elements);
  const out: number[] = [];
  pir.starArms.forEach((k, j) => {
    if (inDual(lattice, vfrom(k, 48), group.bound.D)) out.push(j + 1);
  });
  return out;
}

export interface IsotropyAnalysis {
  /** |L|, the order of the image group. */
  readonly imageOrder: number;
  /** One per conjugacy class: one-parameter directions first, then by index, the kernel last. */
  readonly subgroups: readonly IrrepIsotropySubgroup[];
}

const EPS = 1e-8;
/** Images up to this order take the full closure (every Phase 1 image does: |F| ≤ 192 there); larger ones the orbit-wise closure. */
const SMALL_IMAGE = 192;

/** Reduced row echelon form of a basis (rows), pivots normalized to 1. */
function rref(basis: readonly Vec[]): Vec[] {
  const rows = basis.map((b) => [...b]);
  const n = rows[0]?.length ?? 0;
  let r = 0;
  for (let c = 0; c < n && r < rows.length; c++) {
    let p = r;
    for (let i = r + 1; i < rows.length; i++) if (Math.abs(rows[i]![c]!) > Math.abs(rows[p]![c]!)) p = i;
    if (Math.abs(rows[p]![c]!) < 1e-7) continue;
    [rows[r], rows[p]] = [rows[p]!, rows[r]!];
    const d = rows[r]![c]!;
    rows[r] = rows[r]!.map((x) => x / d);
    for (let i = 0; i < rows.length; i++) {
      if (i === r) continue;
      const f = rows[i]![c]!;
      rows[i] = rows[i]!.map((x, j) => x - f * rows[r]![j]!);
    }
    r++;
  }
  return rows.map((row) => row.map((x) => (Math.abs(x) < 1e-9 ? 0 : x)));
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function coefficient(x: number): string {
  if (Math.abs(x - 1) < 1e-7) return "";
  if (Math.abs(x + 1) < 1e-7) return "-";
  for (const d of [1, 2, 3, 4, 6]) {
    const n = Math.round(x * d);
    if (Math.abs(x * d - n) < 1e-7) return d === 1 ? `${n}` : `${n}/${d}·`;
  }
  return `${+x.toFixed(3)}`;
}

/** A generic vector of the subspace in symbols: the RREF basis rows weighted by a, b, c, …. */
export function directionSymbol(basis: readonly Vec[]): string {
  const rows = rref(basis);
  const n = rows[0]?.length ?? 0;
  const parts: string[] = [];
  for (let j = 0; j < n; j++) {
    let s = "";
    rows.forEach((row, r) => {
      const x = row[j]!;
      if (Math.abs(x) < 1e-9) return;
      const c = coefficient(x);
      const term = `${c}${LETTERS[r] ?? "?"}`;
      s += s === "" ? term : term.startsWith("-") ? term : `+${term}`;
    });
    parts.push(s === "" ? "0" : s);
  }
  return `(${parts.join(",")})`;
}

/**
 * How simple a direction's symbol is: fewer coefficients that are not small
 * fractions first (so (a,-a) beats (a,0.268a)), then fewer nonzero entries,
 * fewer minus signs, the leading entries earliest.
 */
export function simplicity(basis: readonly Vec[]): number[] {
  const rows = rref(basis);
  const irrational = rows.reduce((s, row) => s + row.filter((x) => !isSimpleFraction(x)).length, 0);
  const nonzero = rows.reduce((s, row) => s + row.filter((x) => Math.abs(x) > 1e-9).length, 0);
  const negative = rows.reduce((s, row) => s + row.filter((x) => x < -1e-9).length, 0);
  return [irrational, nonzero, negative, ...rows.flatMap((row) => row.map((x) => (Math.abs(x) > 1e-9 ? 0 : 1)))];
}

const lexLess = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return a.length < b.length;
};

/** The subgroup's index split into its point-group and translation factors (k = |T/T″| / |T_H/T″|). */
export function indexSplit(group: FactorGroup, elements: readonly number[]): IndexSplit {
  const rotations = new Set(elements.map((i) => ikey(group.elements[i]!.W)));
  const translations = elements.filter((i) => iIsIdentity(group.elements[i]!.W)).length;
  return { t: pointGroupElements(group).length / rotations.size, k: group.translations.length / translations };
}

/**
 * The isotropy subgroups of a physically irreducible representation of the
 * factor group, one per conjugacy class (see the module comment). The
 * parent's operations name the children (identifySubgroup, standard).
 */
export function isotropySubgroups(group: FactorGroup, pir: PhysicalIrrep): IsotropyAnalysis {
  const n = pir.dim;
  const F = group.elements.length;
  // The image group: the distinct matrices.
  const imageKeys = new Map<string, number>();
  pir.matrices.forEach((m, f) => {
    const key = Array.from(m, (x) => Math.round(x * 1e6) / 1e6 || 0).join(",");
    if (!imageKeys.has(key)) imageKeys.set(key, f);
  });
  // Fixed spaces of single image elements, then their intersection closure.
  const spaces = new Map<string, Vec[]>();
  const whole: Vec[] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  spaces.set(projectorKey(whole, n), whole);
  for (const f of imageKeys.values()) {
    const fix = fixedSpace(pir.matrices[f]!, n);
    if (fix.length > 0) spaces.set(projectorKey(fix, n), fix);
  }
  // a ⊆ b when b's projector fixes a's basis: then a ∩ b is a or b, already listed, and no
  // eigendecomposition is needed (the closure, and the order it lists the spaces in, are unchanged).
  const projectors = new Map<Vec[], number[][]>();
  const projectorOf = (b: Vec[]): number[][] => {
    let P = projectors.get(b);
    if (!P) {
      P = projector(b, n);
      projectors.set(b, P);
    }
    return P;
  };
  const within = (a: readonly Vec[], b: Vec[]): boolean => {
    const P = projectorOf(b);
    return a.every((v) => P.every((row, i) => Math.abs(row.reduce((t, x, j) => t + x * v[j]!, 0) - v[i]!) < 1e-7));
  };
  // The elements fixing a subspace pointwise: its isotropy subgroup.
  const stabilizerOf = (basis: readonly Vec[]): number[] => {
    const elements: number[] = [];
    for (let f = 0; f < F; f++) {
      const D = pir.matrices[f]!;
      const fixesAll = basis.every((b) => {
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let j = 0; j < n; j++) s += D[i * n + j]! * b[j]!;
          if (Math.abs(s - b[i]!) > 1e-7) return false;
        }
        return true;
      });
      if (fixesAll) elements.push(f);
    }
    return elements;
  };
  type Member = { basis: Vec[]; elements: number[]; key: string };
  const classes: Member[][] = imageKeys.size <= SMALL_IMAGE ? closureClasses() : orbitClasses();

  /** Phase 1's route: the whole intersection closure, then the conjugacy classes of the subgroups. */
  function closureClasses(): Member[][] {
    let frontier = [...spaces.values()];
    while (frontier.length > 0) {
      const next: Vec[][] = [];
      const all = [...spaces.values()];
      for (const a of frontier) {
        for (const b of all) {
          if (within(a, b) || within(b, a)) continue;
          const c = intersect(a, b, n);
          if (c.length === 0) continue;
          const key = projectorKey(c, n);
          if (!spaces.has(key)) {
            spaces.set(key, c);
            next.push(c);
          }
        }
      }
      frontier = next;
    }
    const found: Member[] = [...spaces.values()].map((basis) => {
      const elements = stabilizerOf(basis);
      return { basis, elements, key: elements.join(",") };
    });
    // Conjugacy classes under F.
    const byKey = new Map(found.map((x) => [x.key, x] as const));
    const out: Member[][] = [];
    const seen = new Set<string>();
    for (const x of found) {
      if (seen.has(x.key)) continue;
      const members: Member[] = [];
      for (let g = 0; g < F; g++) {
        const conj = x.elements.map((h) => group.table[group.table[g]![h]!]![group.inverse[g]!]!).sort((a, b) => a - b).join(",");
        const m = byKey.get(conj);
        if (!m) throw new Error("isotropy: a conjugate of an isotropy subgroup is not one");
        if (!members.includes(m)) members.push(m);
        seen.add(conj);
      }
      out.push(members);
    }
    return out;
  }

  /**
   * For a large image group: the closure up to the group's action. Every
   * fixed space is an intersection of single elements' fixed spaces, and
   * g·(a ∩ Fix(f)) = g·a ∩ Fix(gfg⁻¹), so intersecting one representative of
   * each orbit with every single fixed space reaches every orbit; an orbit is
   * recorded whole (its images under the image group) so a conjugate is
   * never taken for a new class.
   */
  function orbitClasses(): Member[][] {
    const singles = [...spaces.values()].filter((b) => b.length < n);
    const imageElements = [...imageKeys.values()];
    const orbitOf = new Map<string, number>();
    const reps: Vec[][] = [];
    const apply = (f: number, basis: readonly Vec[]): Vec[] => {
      const D = pir.matrices[f]!;
      return basis.map((v) => Array.from({ length: n }, (_, i) => {
        let t = 0;
        for (let j = 0; j < n; j++) t += D[i * n + j]! * v[j]!;
        return t;
      }));
    };
    const addOrbit = (basis: Vec[]): boolean => {
      if (orbitOf.has(projectorKey(basis, n))) return false;
      const id = reps.length;
      reps.push(basis);
      for (const f of imageElements) orbitOf.set(projectorKey(apply(f, basis), n), id);
      return true;
    };
    addOrbit(whole);
    for (const s of singles) addOrbit(s);
    let frontier = [...reps];
    while (frontier.length > 0) {
      const next: Vec[][] = [];
      for (const a of frontier) {
        for (const b of singles) {
          if (within(a, b) || within(b, a)) continue;
          const c = intersect(a, b, n);
          if (c.length === 0) continue;
          if (addOrbit(c)) next.push(c);
        }
      }
      frontier = next;
    }
    // Each orbit's members: the conjugate subgroups, in the order of the conjugating elements.
    return reps.map((rep) => {
      const elements = stabilizerOf(rep);
      const members: Member[] = [];
      const seen = new Set<string>();
      for (let g = 0; g < F; g++) {
        const conj = elements.map((h) => group.table[group.table[g]![h]!]![group.inverse[g]!]!).sort((a, b) => a - b);
        const key = conj.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        members.push({ basis: apply(g, rep), elements: conj, key });
      }
      return members;
    });
  }

  const subgroups = classes.map((members) => {
    const named = members.map((m) => {
      const operations = m.elements.map((i) => group.operations[i]!);
      const direct = keepsConventionalCell(group, m.elements) && identifySubgroup(operations, group.parentOperations).method === "direct";
      return { m, operations, direct };
    });
    let rep = named[0]!;
    for (const c of named.slice(1)) {
      if (c.direct !== rep.direct) {
        if (c.direct) rep = c;
        continue;
      }
      if (lexLess(simplicity(c.m.basis), simplicity(rep.m.basis))) rep = c;
    }
    const basis = rref(rep.m.basis);
    // Orthonormal basis of the representative's direction.
    const ortho: Vec[] = [];
    for (const b of basis) {
      let w = [...b];
      for (const q of ortho) {
        const s = w.reduce((t, x, i) => t + x * q[i]!, 0);
        w = w.map((x, i) => x - s * q[i]!);
      }
      const norm = Math.hypot(...w);
      if (norm > EPS) ortho.push(w.map((x) => x / norm));
    }
    return {
      elements: rep.m.elements,
      operations: rep.operations,
      direction: { dim: rep.m.basis.length, basis: ortho, symbol: directionSymbol(rep.m.basis) },
      kernel: rep.m.basis.length === n,
      orientationStates: members.length,
      domainStates: F / rep.m.elements.length,
      index: indexSplit(group, rep.m.elements),
      identity: nameChild(group, rep.m.elements),
      cellMultiplying: !keepsConventionalCell(group, rep.m.elements),
      activeArms: activeArms(group, rep.m.elements, pir),
    } satisfies IrrepIsotropySubgroup;
  });
  subgroups.sort((a, b) => a.direction.dim - b.direction.dim || a.domainStates - b.domainStates || (a.identity.number ?? 999) - (b.identity.number ?? 999) || (a.direction.symbol < b.direction.symbol ? -1 : a.direction.symbol > b.direction.symbol ? 1 : 0));
  return { imageOrder: imageKeys.size, subgroups };
}

const isotropyCache = new WeakMap<FactorGroup, WeakMap<PhysicalIrrep, IsotropyAnalysis>>();

/** {@link isotropySubgroups}, computed once per factor group and representation (the Subgroups page asks for the same irreps from both of its views). */
export function cachedIsotropySubgroups(group: FactorGroup, pir: PhysicalIrrep): IsotropyAnalysis {
  let byIrrep = isotropyCache.get(group);
  if (!byIrrep) {
    byIrrep = new WeakMap();
    isotropyCache.set(group, byIrrep);
  }
  const hit = byIrrep.get(pir);
  if (hit) return hit;
  const out = isotropySubgroups(group, pir);
  byIrrep.set(pir, out);
  return out;
}
