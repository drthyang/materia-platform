/**
 * The **translationengleiche subgroup lattice** of a structure's space group —
 * the structural counterpart of `magneticSubgroupLattice`, and the "search for
 * subgroups" step of the PDF distortion workflow (parent → fit → residual →
 * pick a subgroup → activate its distortion modes → refine amplitudes).
 *
 * It reuses the generic finite-group subgroup enumerator `allSubgroups`
 * (`add-a-generator-and-close` BFS over the rotation-coset composition table —
 * exhaustive for any crystallographic group, |Ḡ| ≤ 48). A t-subgroup H keeps
 * EVERY lattice translation of G, centring included (Hermann 1929; ITA A1,
 * Ch. 1.2): H = ⋃_{h̄ ∈ H̄} (h̄, t_h + L), so each node's operations are its coset
 * representatives with the parent's centring translations added — read without
 * them, Fm-3m's 4/mmm subgroup is the primitive P4/mmm, a klassengleiche
 * subgroup that splits Na 4a into three sites. Every subgroup found is
 *
 *  - named with `identifySubgroup` in its STANDARD setting (`standard`: the
 *    conventional cell of its own symmetry, e.g. F4/mmm → I4/mmm, #139, with
 *    a′ = (a−b)/2, b′ = (a+b)/2, c′ = c; honest point-group-only fallback);
 *  - linked into the group–subgroup lattice by its COVERING relations (immediate
 *    maximal subgroups / minimal supergroups) — the Bärnighausen-tree edges; and
 *  - grouped into conjugacy classes under the parent (conjugate subgroups are
 *    the same distortion in symmetry-equivalent orientations), each class
 *    reporting a representative, its number of conjugates [G : N_G(H)] and its
 *    number of domain states [G : H] (Janovec; ITA D, Ch. 3.4): Pm-3m → P4mm
 *    has 3 conjugates (the polar axis along x, y or z) and 6 domain states
 *    (±P along each).
 *
 * Each node carries its own OPERATIONS, so a chosen node feeds `realizeSubgroup`
 * (orbit splitting) and then `buildSymmetryModes` directly — the subgroup-driven
 * activation path: pick H → realize the child → refine the symmetry-allowed
 * displacement modes H permits. (Tagging each such mode with the parent irrep it
 * descends from is the later per-irrep-label phase.)
 *
 * Scope (deliberate, matching the rest of the distortion stack): **t-subgroups
 * only** — subgroups that keep the lattice (point-group level). Klassengleiche
 * (cell-multiplying / centering-losing) subgroups — the zone-boundary /
 * supercell half of the full ITA1 tree — are NOT enumerated here; they ride
 * along with the k≠0 displacive engine.
 */

import type { SymmetryOperation, StructureModel } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { IDENTITY3 } from "@/core/math/mat3";
import { formatOperationXyz } from "@/core/crystal/symmetry";
import { identifySubgroup, type SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { latticeCentring } from "@/core/crystal/standardSetting";
import { allSubgroups, buildCosetContext, type CosetContext } from "@/core/magnetic/subgroupLattice";

export interface SubgroupNode {
  /** Stable id (derived from the coset-index set) — the key covering edges use. */
  readonly id: string;
  /** The subgroup's operations in the parent's cell: each rotation coset's
   *  representative with every centring translation of the parent (a
   *  t-subgroup keeps them all) — ready for `realizeSubgroup`. */
  readonly operations: readonly SymmetryOperation[];
  /** One representative per rotation coset (the parent's intrinsic translations, no centring). */
  readonly cosetOperations: readonly SymmetryOperation[];
  /** Name in the standard setting: H-M symbol + IT number when matched (with the conventional cell when it is not the parent's), else point group + index. */
  readonly identity: SubgroupIdentity;
  /** Point-group symbol (always defined when classifiable). */
  readonly pointGroup: string | null;
  /** |H| — number of rotation cosets. */
  readonly order: number;
  /** [G : H] index in the parent. */
  readonly index: number;
  /** Immediate maximal subgroups of this node (Bärnighausen children). */
  readonly maximalSubgroupIds: readonly string[];
  /** Immediate minimal supergroups of this node (Bärnighausen parents). */
  readonly minimalSupergroupIds: readonly string[];
  /** 0-based conjugacy-class id (classes are contiguous in `nodes`). */
  readonly conjugacyClassId: number;
  /** True for the canonical member the UI lists; its conjugates are the other orientations. */
  readonly classRepresentative: boolean;
  /**
   * Number of conjugate subgroups in this class, [G : N_G(H)]: the distinct
   * orientations of the distortion (Pm-3m → P4mm: 3). Not the domain count.
   */
  readonly conjugates: number;
  /**
   * Number of domain states, [G : H] — the index, since a t-subgroup keeps the
   * lattice (no translation domains): each orientation holds [N_G(H) : H]
   * states of the same symmetry, such as ±P (Pm-3m → P4mm: 6).
   */
  readonly domainStates: number;
  /** The whole group H = G. */
  readonly isParent: boolean;
  /** The trivial subgroup H = P1. */
  readonly isTrivial: boolean;
}

export interface StructuralSubgroupTree {
  /** Node id of the parent (whole group). */
  readonly parentId: string;
  /** All subgroups, sorted index ascending (parent first), conjugates contiguous. */
  readonly nodes: readonly SubgroupNode[];
  /** True when `maxIndex` cut deeper subgroups from the full lattice. */
  readonly truncated: boolean;
}

const IDENTITY_OP: SymmetryOperation = { rotation: IDENTITY3, translation: [0, 0, 0], xyz: "x,y,z" };

const mod1 = (x: number): number => {
  const f = x - Math.floor(x);
  return f > 1 - 1e-9 || f < 1e-9 ? 0 : f;
};

/**
 * A t-subgroup's operations in its parent's cell: each coset representative
 * with every centring translation of the parent's lattice (translations mod 1,
 * Jones–Faithful strings rewritten). A t-subgroup keeps all of them.
 */
export function withLatticeCentring(
  cosetOps: readonly SymmetryOperation[],
  centring: readonly (readonly [number, number, number])[],
): SymmetryOperation[] {
  return cosetOps.flatMap((op) =>
    centring.map((c) => {
      const translation: Vec3 = [mod1(op.translation[0] + c[0]), mod1(op.translation[1] + c[1]), mod1(op.translation[2] + c[2])];
      return { rotation: op.rotation, translation, xyz: formatOperationXyz(op.rotation, translation) };
    }),
  );
}

/** Conjugate the coset-index set S by coset g: h ↦ g·h·g⁻¹. */
function conjugateSet(S: readonly number[], g: number, ctx: CosetContext): number[] {
  return S.map((h) => ctx.comp[ctx.comp[g]![h]!]![ctx.inv[g]!]!).sort((a, b) => a - b);
}

/** Lexicographically minimal conjugate signature — equal for conjugate subgroups. */
export function conjugacyKey(S: readonly number[], ctx: CosetContext): string {
  let best: string | null = null;
  for (let g = 0; g < ctx.cosets.length; g++) {
    const k = conjugateSet(S, g, ctx).join(",");
    if (best === null || k < best) best = k;
  }
  return best ?? [...S].sort((a, b) => a - b).join(",");
}

/**
 * Enumerate the full translationengleiche subgroup lattice of `structure`'s
 * space group: every t-subgroup, named, with covering (Bärnighausen) edges and
 * conjugacy/domain grouping. `maxIndex` caps the enumeration by index (the whole
 * lattice otherwise — cheap, ≤ a few hundred nodes); covering edges are then
 * recomputed within the retained set so the tree stays a valid sub-poset.
 */
export function structuralSubgroupLattice(
  structure: StructureModel,
  opts: { readonly maxIndex?: number } = {},
): StructuralSubgroupTree {
  const parentOps = structure.spaceGroup.operations.length ? structure.spaceGroup.operations : [IDENTITY_OP];
  const ctx = buildCosetContext(parentOps);
  const centring = latticeCentring(parentOps);
  const N = ctx.cosets.length;
  const maxIndex = opts.maxIndex ?? Number.POSITIVE_INFINITY;

  // allSubgroups → coset-index arrays, sorted |S| descending (parent first).
  const all = allSubgroups(ctx);
  const idOf = (S: readonly number[]): string => `h${[...S].sort((a, b) => a - b).join("_")}`;

  // Conjugacy classes over the FULL lattice (before any index cut).
  const classKey = all.map((S) => conjugacyKey(S, ctx));
  const classOrder: string[] = [];
  for (const k of classKey) if (!classOrder.includes(k)) classOrder.push(k);
  const classIdByKey = new Map(classOrder.map((k, i) => [k, i] as const));
  const conjugateCountByKey = new Map<string, number>();
  for (const k of classKey) conjugateCountByKey.set(k, (conjugateCountByKey.get(k) ?? 0) + 1);

  // Retain by index, keep original (size-descending) order for now.
  const retained = all
    .map((S, i) => ({ S, i }))
    .filter(({ S }) => (N / S.length) <= maxIndex);
  const truncated = retained.length < all.length;

  const sets = retained.map(({ S }) => new Set(S));
  const strictSub = (a: number, b: number): boolean =>
    retained[a]!.S.length < retained[b]!.S.length && [...sets[a]!].every((x) => sets[b]!.has(x));

  // Covering relations within the retained set: A ⋖ B iff A ⊊ B and no retained
  // C strictly between. O(n³) but n ≤ few hundred.
  const children: string[][] = retained.map(() => []);
  const parents: string[][] = retained.map(() => []);
  for (let b = 0; b < retained.length; b++) {
    for (let a = 0; a < retained.length; a++) {
      if (!strictSub(a, b)) continue;
      let covered = true;
      for (let c = 0; c < retained.length; c++) {
        if (c !== a && c !== b && strictSub(a, c) && strictSub(c, b)) {
          covered = false;
          break;
        }
      }
      if (covered) {
        children[b]!.push(idOf(retained[a]!.S));
        parents[a]!.push(idOf(retained[b]!.S));
      }
    }
  }

  // First node in each class (by size desc, then id) is the representative.
  const seenClass = new Set<number>();
  const built = retained.map(({ S }, r) => {
    const cosetOperations = S.map((ci) => ctx.cosets[ci]!);
    const operations = withLatticeCentring(cosetOperations, centring);
    const identity = identifySubgroup(operations, parentOps, { standard: true });
    const key = classKey[retained[r]!.i]!;
    const conjugacyClassId = classIdByKey.get(key)!;
    const isRep = !seenClass.has(conjugacyClassId);
    seenClass.add(conjugacyClassId);
    const order = S.length;
    return {
      id: idOf(S),
      operations,
      cosetOperations,
      identity,
      pointGroup: identity.pointGroup,
      order,
      index: N / order,
      maximalSubgroupIds: children[r]!,
      minimalSupergroupIds: parents[r]!,
      conjugacyClassId,
      classRepresentative: isRep,
      conjugates: conjugateCountByKey.get(key)!,
      domainStates: N / order,
      isParent: order === N,
      isTrivial: order === 1,
    } satisfies SubgroupNode;
  });

  // Present index ascending (parent first), conjugates contiguous, deterministic.
  built.sort(
    (a, b) => a.index - b.index || a.conjugacyClassId - b.conjugacyClassId || a.id.localeCompare(b.id),
  );

  const parent = built.find((n) => n.isParent);
  return { parentId: parent?.id ?? built[0]?.id ?? "", nodes: built, truncated };
}

/** Only the conjugacy-class representatives — what a subgroup picker should list. */
export function subgroupClassRepresentatives(tree: StructuralSubgroupTree): SubgroupNode[] {
  return tree.nodes.filter((n) => n.classRepresentative);
}
