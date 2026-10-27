/**
 * The **full lattice of candidate magnetic space groups** for a commensurate
 * propagation vector k — every translationengleiche magnetic subgroup, not only
 * the maximal (index-2) ones that decorate the whole little group G_k.
 *
 * Theory. The possible symmetry groups of a magnetic ordering with propagation
 * vector k are the subgroups M of the grey (paramagnetic) group G_k·1' that do
 * **not** contain pure time reversal 1'. Keeping the translation lattice intact
 * (no cell enlargement — type-IV/anti-translation groups are the star-of-k /
 * supercell follow-up), each such M is determined by a pair (H, θ):
 *
 *   - H ≤ G_k, a translationengleiche subgroup of the little group (a subgroup
 *     of the little co-group, retaining all lattice/centring translations), and
 *   - θ: H → {±1}, a time-reversal homomorphism on it (θ ≡ +1 → type I;
 *     a non-trivial θ primes the coset of its index-2 kernel → type III).
 *
 *   M = { (h, θ(h)) : h ∈ H },   with index [G_k·1' : M] = 2·|Ḡ_k| / |H̄|.
 *
 * The previous candidate generator enumerated only H = G_k (index 2). This
 * module enumerates **all** subgroups H̄ of the finite little co-group Ḡ_k by
 * breadth-first closure over generator sets (every subgroup of a finite group
 * is reached by adding one generator at a time, so the BFS is exhaustive), runs
 * the same GF(2) θ-enumeration on each, and classifies the resulting magnetic
 * groups into conjugacy classes under G_k — conjugate candidates describe the
 * same ordering in symmetry-equivalent **domains**, so the UI shows one
 * representative per class with its domain count, as k-SUBGROUPSMAG does.
 *
 * References:
 *  - J. M. Perez-Mato, S. V. Gallego, E. S. Tasci, L. Elcoro, G. de la Flor &
 *    M. I. Aroyo, "Symmetry-Based Computational Tools for Magnetic
 *    Crystallography", Annu. Rev. Mater. Res. 45 (2015) 217 — possible magnetic
 *    groups = subgroups of the grey group enumerated by index (the
 *    k-SUBGROUPSMAG framework on the Bilbao Crystallographic Server).
 *  - C. Hermann, Z. Kristallogr. 69 (1929) 533 — subgroup chains factor through
 *    translationengleiche and klassengleiche steps; here only the t-part is
 *    enumerated (fixed lattice), the k-part being the type-IV extension.
 *  - International Tables for Crystallography Vol. A1 (Wondratschek & Müller,
 *    eds.) — group–subgroup relations, index, conjugacy and domains.
 *  - D. B. Litvin, *Magnetic Group Tables* (IUCr, 2013) — the groups the
 *    candidates are matched against (via `identifyCandidate`: at k ≠ 0 the
 *    type-IV group of the magnetic cell).
 */

import type { SymmetryOperation } from "@/core/crystal/types";
import type { Mat3, Vec3 } from "@/core/math/types";
import { composeOperations } from "@/core/crystal/symmetry";
import { inverse, mulMat, mulVec } from "@/core/math/mat3";
import {
  cosetFrame,
  distinctCosets,
  generateMagneticCandidates,
  latticePhase,
  littleGroup,
  rotationKey,
  twistingK,
  type CosetFrame,
  type MagneticCandidate,
} from "./magneticGroups";
import { type TransformedIdentification, formatMagneticSymbol } from "./bnsOg";
import { candidateCellGroup, identifyCandidate, magneticTypeOf } from "./magneticCell";

export interface LatticeCandidate {
  /** The magnetic group itself (operations, label, BNS/OG identification). */
  readonly candidate: MagneticCandidate;
  /** Order of the spatial subgroup H̄ (distinct rotation cosets). */
  readonly subgroupOrder: number;
  /** Index of M in the grey group G_k·1': 2·|Ḡ_k| / |H̄|. Index 2 is maximal,
   *  but not every maximal group has index 2 (see `maximal`). */
  readonly index: number;
  /** 0-based conjugacy-class id (classes are contiguous in the output). */
  readonly classId: number;
  /** Number of conjugate candidates under G_k = number of symmetry-equivalent
   *  domain descriptions. 1 for a normal magnetic subgroup. */
  readonly domainCount: number;
  /** True for the first (canonical) member of its conjugacy class — the one
   *  the UI lists; the conjugates are the same physics in other domains. */
  readonly classRepresentative: boolean;
  /** When the exact standard-setting match failed, the BNS/OG identity found
   *  through a setting transformation — computed for class representatives
   *  only. At a single-arm k ≠ 0 it is always this: the group of the ordered
   *  structure, named in its magnetic cell, with the transformation from the
   *  PARENT cell to its standard BNS cell (`identifyCandidate`). Undefined: no
   *  match either way. */
  readonly settingMatch?: TransformedIdentification;
  /** The Shubnikov type of the group the candidate denotes (IV at a single-arm k ≠ 0). */
  readonly magneticType: 1 | 2 | 3 | 4;
  /** The classes one of whose groups properly contains a group of this class
   *  (by classId, ascending): the candidates above it in the lattice. */
  readonly above: readonly number[];
  /** No candidate properly contains a group of this class. Maximality is
   *  containment, not index: where no group closes on the whole little group
   *  the maximal ones have index 4 (the Z point of P4₂/mnm), and a maximal
   *  group can sit below an index-2 one of another class only if it is not
   *  contained in it (MnO at k = 0: I4/mm′m′ at index 6, Im′m′m at 12). */
  readonly maximal: boolean;
}

export interface CosetContext {
  /** One representative op per rotation coset, identity first. */
  readonly cosets: readonly SymmetryOperation[];
  /** cosets[i] ∘ cosets[j] lies in coset comp[i][j]. */
  readonly comp: readonly (readonly number[])[];
  /** Index of the inverse coset. */
  readonly inv: readonly number[];
}

/**
 * The rotation-coset composition context of a finite crystallographic group —
 * the input `allSubgroups` needs. Generic (no magnetic content): pass any
 * group's operations (a space group's general positions, or a little group)
 * and it dedupes to one representative per rotation coset, builds the
 * composition table, and records inverse cosets.
 */
export function buildCosetContext(lgOps: readonly SymmetryOperation[]): CosetContext {
  const cosets = distinctCosets(lgOps);
  const index = new Map<string, number>();
  cosets.forEach((op, i) => index.set(rotationKey(op), i));
  const comp = cosets.map((a) =>
    cosets.map((b) => index.get(rotationKey(composeOperations(a, b))) ?? 0),
  );
  const inv = cosets.map((_, i) => comp[i]!.findIndex((c) => c === 0));
  return { cosets, comp, inv };
}

/** Closure of a set of coset indices under the composition table. */
function closure(seed: readonly number[], comp: CosetContext["comp"]): number[] {
  const inSet = new Set<number>(seed);
  inSet.add(0); // identity
  const queue = [...inSet];
  while (queue.length > 0) {
    const a = queue.pop()!;
    for (const b of inSet) {
      for (const c of [comp[a]![b]!, comp[b]![a]!]) {
        if (!inSet.has(c)) {
          inSet.add(c);
          queue.push(c);
        }
      }
    }
  }
  return [...inSet].sort((x, y) => x - y);
}

/**
 * All subgroups of the finite co-group, as sorted coset-index arrays. BFS over
 * "add one generator and close": starting from {E}, every subgroup is reached
 * because any H = ⟨g₁, …, gₘ⟩ appears after m steps. Exhaustive and cheap for
 * crystallographic co-groups (|Ḡ| ≤ 48, e.g. m-3m has 98 subgroups).
 */
export function allSubgroups(ctx: CosetContext): number[][] {
  const found = new Map<string, number[]>();
  const trivial = closure([], ctx.comp);
  found.set(trivial.join(","), trivial);
  const queue = [trivial];
  while (queue.length > 0) {
    const S = queue.pop()!;
    const inS = new Set(S);
    for (let g = 0; g < ctx.cosets.length; g++) {
      if (inS.has(g)) continue;
      const T = closure([...S, g], ctx.comp);
      const key = T.join(",");
      if (!found.has(key)) {
        found.set(key, T);
        queue.push(T);
      }
    }
  }
  return [...found.values()].sort((a, b) => b.length - a.length);
}

/** Sortable key for a BNS number "P.S" (e.g. "194.265" → 19400265). Groups with
 *  no standard-setting identification return +∞, so they sort last within their
 *  index. Matches the render's key in KSearchPanel so UI and core agree. */
function bnsSortKey(bnsNumber: string | null): number {
  if (!bnsNumber) return Number.MAX_SAFE_INTEGER;
  const [p, s] = bnsNumber.split(".").map(Number);
  return (Number.isFinite(p) ? p! : 999) * 100000 + (Number.isFinite(s) ? s! : 0);
}

/** θ per coset index for a candidate, from its operations' timeReversal flags. */
function thetaByCoset(
  cand: MagneticCandidate,
  cosetIndex: ReadonlyMap<string, number>,
): Map<number, 1 | -1> {
  const theta = new Map<number, 1 | -1>();
  for (const op of cand.operations) {
    const i = cosetIndex.get(rotationKey(op));
    if (i !== undefined) theta.set(i, (op.timeReversal ?? 1) as 1 | -1);
  }
  return theta;
}

/** Canonical signature of (H, θ) as a sorted "coset:θ" string. */
function pairSignature(theta: ReadonlyMap<number, 1 | -1>): string {
  return [...theta.entries()]
    .map(([i, t]) => `${i}:${t}`)
    .sort()
    .join(" ");
}

/** How the representative g_h of one coset conjugates under another's, g_g·g_h·g_g⁻¹ = {I|s}·g_m. */
interface Conjugation {
  readonly m: number;
  /** χ(s) = e^{2πi k·s}: the sign the conjugate's θ on coset m picks up (null: complex). */
  readonly sign: 1 | -1 | null;
}

/**
 * The conjugation table of the coset representatives, with the k-phase of the
 * lattice vector each conjugate differs from its coset's representative by.
 * Conjugation by a lattice translation leaves every (H, θ) unchanged
 * (χ(t − R t) = 1 for R in G_k), so the representatives give every conjugate.
 */
function conjugationTable(frame: CosetFrame, index: ReadonlyMap<string, number>, k: Vec3): Conjugation[][] {
  const zeroK = k.every((c) => Math.abs(c) < 1e-9);
  const round = (M: Mat3): Mat3 => M.map((row) => row.map((v) => Math.round(v))) as unknown as Mat3;
  return frame.reps.map((g) => {
    const Rg = g.rotation;
    const Rgi = round(inverse(Rg));
    return frame.reps.map((h) => {
      const R = round(mulMat(mulMat(Rg, h.rotation), Rgi));
      const m = index.get(R.map((row) => row.join(",")).join(";")) ?? 0;
      if (zeroK) return { m, sign: 1 };
      const a = mulVec(Rg, h.translation);
      const b = mulVec(R, g.translation);
      const tm = frame.reps[m]!.translation;
      const s: Vec3 = [a[0] + g.translation[0]! - b[0] - tm[0]!, a[1] + g.translation[1]! - b[1] - tm[1]!, a[2] + g.translation[2]! - b[2] - tm[2]!];
      return { m, sign: latticePhase(k, s) };
    });
  });
}

/**
 * Signature of the conjugate g·(H,θ)·g⁻¹: h ↦ ghg⁻¹ keeps its own θ, and the
 * conjugate's θ on the coset of ghg⁻¹ is read at that coset's representative,
 * so it carries the k-phase of the lattice vector between them. Null when a
 * phase is complex (no real conjugate on these representatives).
 */
function conjugateSignature(
  theta: ReadonlyMap<number, 1 | -1>,
  g: number,
  table: readonly (readonly Conjugation[])[],
): string | null {
  const conj = new Map<number, 1 | -1>();
  for (const [h, t] of theta) {
    const { m, sign } = table[g]![h]!;
    if (sign === null) return null;
    conj.set(m, (t * sign) as 1 | -1);
  }
  return pairSignature(conj);
}

/**
 * Enumerate the full lattice of candidate magnetic space groups for a
 * commensurate k: every (subgroup H ≤ G_k, time-reversal homomorphism θ) pair,
 * wrapped with its index in the grey group and its conjugacy class under G_k.
 *
 * Ordered by index (maximal candidates first), then type I before type III,
 * conjugacy classes kept contiguous. `maxIndex` truncates the enumeration (the
 * k-SUBGROUPSMAG convention: the practically relevant candidates sit at low
 * index; pass Infinity for everything down to triclinic P1-type groups).
 */
export function magneticSubgroupLattice(
  parentOps: readonly SymmetryOperation[],
  k: Vec3,
  opts: { maxIndex?: number } = {},
): LatticeCandidate[] {
  const lg = littleGroup(parentOps, k);
  if (lg.length === 0) return [];
  const ctx = buildCosetContext(lg);
  const n = ctx.cosets.length;
  const maxIndex = opts.maxIndex ?? Number.POSITIVE_INFINITY;

  const cosetIndex = new Map<string, number>();
  ctx.cosets.forEach((op, i) => cosetIndex.set(rotationKey(op), i));
  // Conjugation with the k-phase (a single-arm k's; a two-arm k keeps θ plain):
  // the representatives θ is read at, and how each conjugates.
  const conjugations = conjugationTable(cosetFrame(lg, cosetIndex, n), cosetIndex, twistingK(lg, k));

  interface Raw {
    cand: MagneticCandidate;
    order: number;
    index: number;
    theta: Map<number, 1 | -1>;
    canonical: string;
    self: string;
  }
  const raws: Raw[] = [];

  for (const S of allSubgroups(ctx)) {
    const index = (2 * n) / S.length;
    if (index > maxIndex) continue;
    const inS = new Set(S);
    // Full operation list of H: every little-group op whose rotation coset is
    // in S (centring translations preserved, as in the maximal-only generator).
    const subOps = lg.filter((op) => inS.has(cosetIndex.get(rotationKey(op)) ?? -1));
    for (const cand of generateMagneticCandidates(subOps, k)) {
      const theta = thetaByCoset(cand, cosetIndex);
      const self = pairSignature(theta);
      // Canonical class signature: lexicographic minimum over all conjugates.
      let canonical = self;
      for (let g = 0; g < n; g++) {
        const sig = conjugateSignature(theta, g, conjugations);
        if (sig !== null && sig < canonical) canonical = sig;
      }
      raws.push({
        cand: { ...cand, id: `mag-sub-${S.join("_")}-${cand.id}` },
        order: S.length,
        index,
        theta,
        canonical,
        self,
      });
    }
  }

  // Group into conjugacy classes; count distinct conjugates (= domains).
  const classes = new Map<string, Raw[]>();
  for (const r of raws) {
    const list = classes.get(r.canonical);
    if (list) list.push(r);
    else classes.set(r.canonical, [r]);
  }

  // Resolve each class representative's BNS identity ONCE — the exact
  // standard-setting match when there is one, else a setting-transformed match.
  // This drives both the ordering (by BNS number within an index) and the
  // emitted settingMatch, so identifyMagneticGroupAnySetting is not re-run below.
  interface ClassInfo {
    readonly members: Raw[];
    readonly settingMatch: TransformedIdentification | null;
    readonly bnsKey: number;
    readonly magneticType: 1 | 2 | 3 | 4;
  }
  const infos: ClassInfo[] = [...classes.values()].map((members) => {
    const rep = members[0]!;
    const settingMatch = rep.cand.standard === null ? identifyCandidate(rep.cand.operations, k) : null;
    const identity = rep.cand.standard ?? settingMatch?.identity ?? null;
    const cell = identity ? null : candidateCellGroup(rep.cand.operations, k);
    const magneticType = identity?.magtype ?? magneticTypeOf(cell ? cell.operations : rep.cand.operations);
    return { members, settingMatch, bnsKey: bnsSortKey(identity?.bnsNumber ?? null), magneticType };
  });

  // Bilbao k-SUBGROUPSMAG order: by index (maximal / highest symmetry first),
  // then by BNS number ascending within an index (a group's type-I entry has the
  // lowest .number, so it leads; unidentified groups sort last), with a
  // deterministic final tiebreak on the conjugacy-class signature.
  infos.sort(
    (A, B) =>
      A.members[0]!.index - B.members[0]!.index ||
      A.bnsKey - B.bnsKey ||
      A.members[0]!.canonical.localeCompare(B.members[0]!.canonical),
  );

  // Containment between classes: a group lies inside another when the other's
  // cosets hold its own with the same θ on them (both are read at the same
  // coset representatives). Cosets as two 24-bit words (|Ḡ_k| ≤ 48).
  const words = (cosets: Iterable<number>): [number, number] => {
    let lo = 0;
    let hi = 0;
    for (const i of cosets) {
      if (i < 24) lo |= 1 << i;
      else hi |= 1 << (i - 24);
    }
    return [lo, hi];
  };
  const masks = infos.flatMap(({ members }, classId) =>
    members.map((m) => ({
      s: words(m.theta.keys()),
      p: words([...m.theta].filter(([, t]) => t === -1).map(([i]) => i)),
      order: m.order,
      classId,
    })),
  );
  const above = infos.map(() => new Set<number>());
  for (const a of masks) {
    for (const b of masks) {
      if (b.order <= a.order) continue;
      if ((a.s[0] & ~b.s[0]) !== 0 || (a.s[1] & ~b.s[1]) !== 0) continue;
      if (((a.p[0] ^ b.p[0]) & a.s[0]) !== 0 || ((a.p[1] ^ b.p[1]) & a.s[1]) !== 0) continue;
      above[a.classId]!.add(b.classId);
    }
  }

  const out: LatticeCandidate[] = [];
  infos.forEach(({ members, settingMatch, magneticType }, classId) => {
    const domainCount = new Set(members.map((m) => m.self)).size;
    const aboveIds = [...above[classId]!].sort((x, y) => x - y);
    members.forEach((m, i) => {
      const isRep = i === 0;
      out.push({
        candidate: m.cand,
        subgroupOrder: m.order,
        index: m.index,
        classId,
        domainCount,
        classRepresentative: isRep,
        magneticType,
        above: aboveIds,
        maximal: aboveIds.length === 0,
        ...(isRep && settingMatch ? { settingMatch } : {}),
      });
    });
  });
  return out;
}

/**
 * The maximal groups among those that carry a moment: a group that allows a
 * moment on the chosen ions while no candidate above it does (Bilbao MAXMAGN's
 * selection). `moments` gives, per representative, the moment parameters its
 * fit refines (0: no moment). These are where a top-down search starts; they
 * can sit at any index (MnO at k = 0: 6, 8 and 12).
 */
export function maximalWithMoment(reps: readonly LatticeCandidate[], moments: readonly number[]): boolean[] {
  const carries = new Map(reps.map((r, i) => [r.classId, (moments[i] ?? 0) > 0]));
  return reps.map((r, i) => (moments[i] ?? 0) > 0 && !r.above.some((c) => carries.get(c)));
}

/** Only the class representatives — what a candidate list should display. */
export function latticeRepresentatives(
  lattice: readonly LatticeCandidate[],
): LatticeCandidate[] {
  return lattice.filter((c) => c.classRepresentative);
}

/** How a lattice candidate is named wherever it is shown (the magnetic page's
 *  rows, the report, the project): the standard BNS symbol with its BNS/OG
 *  numbers when the operations match a tabulated group directly, the symbol
 *  plus the setting transformation when they match after a basis change, and
 *  otherwise the candidate's own descriptive label without its type prefix. */
export function latticeCandidateLabel(c: LatticeCandidate): { symbol: string; numbers: string | null; setting: string | null } {
  if (c.candidate.standard) {
    return {
      symbol: c.candidate.label,
      numbers: `BNS ${c.candidate.standard.bnsNumber} · OG ${c.candidate.standard.ogNumber}`,
      setting: null,
    };
  }
  if (c.settingMatch) {
    return {
      symbol: formatMagneticSymbol(c.settingMatch.identity.bnsSymbol),
      numbers: `BNS ${c.settingMatch.identity.bnsNumber} · OG ${c.settingMatch.identity.ogNumber}`,
      setting: c.settingMatch.transformation,
    };
  }
  const bare = c.candidate.label
    .replace(/^type III · /, "")
    .replace(/^type I \(no time reversal\)$/, "no time reversal");
  return { symbol: bare, numbers: null, setting: null };
}
