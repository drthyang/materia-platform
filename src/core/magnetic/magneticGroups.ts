/**
 * Generation of candidate magnetic space groups from a parent (nuclear) space
 * group (or a subgroup of its little group), for k = 0 and for a commensurate
 * single-arm k.
 *
 * Theory. A candidate is a time-reversal sign θ on the rotation cosets of the
 * group, attached to one representative per coset, g_i = {R_i|τ_i}. At k ≠ 0
 * a lattice translation t carries the phase χ(t) = e^{2πi k·t} (±1 for a
 * single-arm k), so the magnetic group the pair denotes in its magnetic cell is
 *   M = { {R_i | τ_i + t} with sign θ_i·χ(t) : i, t ∈ Λ }.
 * M is closed exactly when, for every pair of cosets,
 *   θ_i·θ_j = θ_{ij}·χ(t_ij),   g_i∘g_j = {I|t_ij}·g_{ij}  (t_ij ∈ Λ),
 * a TWISTED homomorphism: at k = 0 (or whenever χ(t_ij) = 1) it is the plain
 * one, but where a screw or glide squared is a translation with χ = −1 (the
 * c-glide of P2/c at k = (0,0,½), the 2₁ of Pnma at X, the 4₂ of P4₂/mnm at Z)
 * no plain homomorphism is a group and some groups are only reached by a θ
 * that is not one. With θ_i = (−1)^{x_i} the condition is the inhomogeneous
 * system over GF(2)
 *   x_i ⊕ x_j ⊕ x_{ij} = c_ij,   c_ij = 1 ⇔ χ(t_ij) = −1,
 * whose solutions are one particular solution plus the null space — or none at
 * all when the system is inconsistent (no magnetic group on that subgroup).
 *
 * A two-arm k (2k not in the reciprocal lattice) has complex phases and no
 * magnetic space group of this form: there θ stays a plain homomorphism, the
 * real decoration of G_k the Fourier moment model reads (cos and sin
 * amplitudes per mode), and the candidate is not a magnetic space group.
 *
 * θ is attached to the representative the moment code reads it with: the
 * coset member without a centring offset (`centringOffsets`), its translation
 * as listed. A centred copy {R_i|τ_i + c} carries θ_i·χ(c) through its offset.
 *
 * At k = 0 each candidate is additionally matched against the bundled standard
 * table of Shubnikov groups ({@link identifyMagneticGroup}): when the parent is
 * in its standard ITA setting, the candidate carries its BNS/OG numbers and
 * symbols (e.g. "Pn'ma'", BNS 62.448). When no exact match exists, and always
 * at k ≠ 0 (the group of the structure is not this parent-cell list; see
 * `identifyCandidate`), `standard` is null and the label describes which
 * operations are primed.
 */

import type { SymmetryOperation } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { centringOffsets, centringTranslations, formatOperationXyz, isReciprocalLatticeVector, operationKey } from "@/core/crystal/symmetry";
import { mulMat, mulVec } from "@/core/math/mat3";
import {
  formatMagneticSymbol,
  identifyMagneticGroup,
  type MagneticGroupIdentity,
} from "./bnsOg";

export interface MagneticCandidate {
  readonly id: string;
  /** Display label: the BNS symbol when identified (e.g. "P2₁'/c'"), else a
   *  descriptive one like "type III · primed: 2₁, m". */
  readonly label: string;
  /** True for the type-I (no time-reversal) group. */
  readonly isTypeI: boolean;
  /** Number of unprimed (θ = +1) operations. */
  readonly unprimedCount: number;
  readonly operations: readonly SymmetryOperation[];
  /** Standard BNS/OG identification, or null if the operations do not match a
   *  tabulated group in its standard BNS setting. */
  readonly standard: MagneticGroupIdentity | null;
}

/** Deduplicate operations modulo lattice translation, identity first. */
export function distinctCosets(ops: readonly SymmetryOperation[]): SymmetryOperation[] {
  const seen = new Map<string, SymmetryOperation>();
  for (const op of ops) {
    const key = op.rotation.map((r) => r.map((v) => Math.round(v)).join(",")).join(";");
    if (!seen.has(key)) seen.set(key, { ...op, timeReversal: 1 });
  }
  const result = [...seen.values()];
  // Identity (rotation = I, translation = 0) first.
  result.sort((a, b) => (isIdentity(b) ? 1 : 0) - (isIdentity(a) ? 1 : 0));
  return result;
}

function isIdentity(op: SymmetryOperation): boolean {
  const r = op.rotation;
  return (
    r[0][0] === 1 && r[1][1] === 1 && r[2][2] === 1 &&
    r[0][1] === 0 && r[0][2] === 0 && r[1][0] === 0 &&
    r[1][2] === 0 && r[2][0] === 0 && r[2][1] === 0
  );
}

/** Point-group key (rotation only) for composition-table indexing. */
export function rotationKey(op: SymmetryOperation): string {
  return op.rotation.map((r) => r.map((v) => Math.round(v)).join(",")).join(";");
}

/**
 * Solve A·x = b over GF(2). `rows` are the constraints as boolean arrays of
 * length n, `rhs` their right-hand sides. Returns one particular solution and
 * a basis of the null space of A (each a boolean array of length n), or null
 * when the system is inconsistent.
 */
function solveAffineGF2(rows: readonly boolean[][], rhs: readonly boolean[], n: number): { particular: boolean[]; basis: boolean[][] } | null {
  // Augmented matrix: column n holds the right-hand side.
  const mat = rows.map((r, i) => [...r, rhs[i]!]);
  const pivotCol: number[] = [];
  let pivotRow = 0;
  const colOfPivot: Record<number, number> = {};

  for (let col = 0; col < n && pivotRow < mat.length; col++) {
    let sel = -1;
    for (let r = pivotRow; r < mat.length; r++) {
      if (mat[r]![col]) { sel = r; break; }
    }
    if (sel === -1) continue;
    [mat[pivotRow], mat[sel]] = [mat[sel]!, mat[pivotRow]!];
    for (let r = 0; r < mat.length; r++) {
      if (r !== pivotRow && mat[r]![col]) {
        for (let c = 0; c <= n; c++) mat[r]![c] = mat[r]![c] !== mat[pivotRow]![c];
      }
    }
    colOfPivot[col] = pivotRow;
    pivotCol.push(col);
    pivotRow++;
  }
  // A row reduced to 0 = 1 makes the system inconsistent.
  for (let r = pivotRow; r < mat.length; r++) if (mat[r]![n]) return null;

  const particular = new Array<boolean>(n).fill(false);
  for (const pc of pivotCol) particular[pc] = mat[colOfPivot[pc]!]![n]!;

  const pivotSet = new Set(pivotCol);
  const basis: boolean[][] = [];
  for (let free = 0; free < n; free++) {
    if (pivotSet.has(free)) continue;
    const vec = new Array<boolean>(n).fill(false);
    vec[free] = true;
    for (const pc of pivotCol) {
      if (mat[colOfPivot[pc]!]![free]) vec[pc] = true;
    }
    basis.push(vec);
  }
  return { particular, basis };
}

/**
 * The k-phase e^{2πi k·t} of a lattice translation t: +1 or −1 when it is
 * real (always, for k = 0 and a single-arm k), null when it is complex.
 */
export function latticePhase(k: Vec3, t: Vec3): 1 | -1 | null {
  const x = 2 * (k[0]! * t[0]! + k[1]! * t[1]! + k[2]! * t[2]!);
  const r = Math.round(x);
  if (Math.abs(x - r) > 1e-6) return null;
  return Math.abs(r) % 2 === 0 ? 1 : -1;
}

const isZeroK = (k: Vec3): boolean => k.every((c) => Math.abs(c) < 1e-9);

/**
 * The k whose phases twist θ on this operation list: k itself when it is a
 * single-arm k (2k in the reciprocal lattice of the list's lattice), else 0 —
 * a two-arm k keeps θ a plain homomorphism (module doc).
 */
export function twistingK(ops: readonly SymmetryOperation[], k: Vec3): Vec3 {
  if (isZeroK(k)) return [0, 0, 0];
  return isReciprocalLatticeVector([2 * k[0]!, 2 * k[1]!, 2 * k[2]!], centringTranslations(ops)) ? k : [0, 0, 0];
}

/** Snap a translation computed by adding listed ones to the 1/24 grid every crystallographic translation lives on. */
function snap24(v: Vec3): Vec3 {
  const s = (x: number): number => {
    const r = Math.round(x * 24) / 24;
    return Math.abs(x - r) < 1e-6 ? (r === 0 ? 0 : r) : x;
  };
  return [s(v[0]!), s(v[1]!), s(v[2]!)];
}

/**
 * The coset frame θ is attached to: for each rotation coset (the order of
 * {@link distinctCosets}), its representative — the member without a centring
 * offset, translation as listed — and the composition of representatives,
 * g_i∘g_j = {I|t_ij}·g_{comp[i][j]} with the lattice vector t_ij exact.
 */
export interface CosetFrame {
  /** Coset index of each listed operation. */
  readonly cosetOf: readonly number[];
  /** The representative of each coset. */
  readonly reps: readonly SymmetryOperation[];
  /** Centring offset c(g) of each listed operation (`centringOffsets`). */
  readonly offsets: readonly Vec3[];
  readonly comp: readonly (readonly number[])[];
  readonly t: readonly (readonly Vec3[])[];
}

/** Build the {@link CosetFrame} of an operation list whose cosets are indexed as in `index`. */
export function cosetFrame(ops: readonly SymmetryOperation[], index: ReadonlyMap<string, number>, count: number): CosetFrame {
  // Offsets are read on the unprimed list: θ is what is being decided.
  const plain = ops.some((o) => (o.timeReversal ?? 1) !== 1) ? ops.map((o) => ({ ...o, timeReversal: 1 as const })) : ops;
  const offsets = centringOffsets(plain);
  const cosetOf = ops.map((o) => index.get(rotationKey(o)) ?? 0);
  const reps: (SymmetryOperation | undefined)[] = new Array(count).fill(undefined);
  ops.forEach((o, i) => {
    const c = cosetOf[i]!;
    const off = offsets[i]!;
    if (reps[c] === undefined && off[0] === 0 && off[1] === 0 && off[2] === 0) reps[c] = { ...o, timeReversal: 1 };
  });
  // Every coset has a member without an offset (its own class representative); guard anyway.
  ops.forEach((o, i) => {
    if (reps[cosetOf[i]!] === undefined) reps[cosetOf[i]!] = { ...o, timeReversal: 1 };
  });
  const R = reps as SymmetryOperation[];
  const comp: number[][] = [];
  const t: Vec3[][] = [];
  for (let i = 0; i < count; i++) {
    comp.push([]);
    t.push([]);
    for (let j = 0; j < count; j++) {
      const a = R[i]!;
      const b = R[j]!;
      const rot = mulMat(a.rotation, b.rotation);
      const c = index.get(rot.map((row) => row.map((v) => Math.round(v)).join(",")).join(";")) ?? 0;
      const rb = mulVec(a.rotation, b.translation);
      const tc = R[c]!.translation;
      comp[i]!.push(c);
      t[i]!.push(snap24([rb[0] + a.translation[0]! - tc[0]!, rb[1] + a.translation[1]! - tc[1]!, rb[2] + a.translation[2]! - tc[2]!]));
    }
  }
  return { cosetOf, reps: R, offsets, comp, t };
}

/**
 * The descriptive label of an unnamed candidate: its primed operations. At
 * k = 0 that is its type (I or III); at a k ≠ 0 the group of the structure is
 * type IV whatever θ is, so no type is claimed.
 */
function primedLabel(ops: readonly SymmetryOperation[], atK = false): string {
  const primed = ops.filter((o) => (o.timeReversal ?? 1) === -1).map((o) => o.xyz);
  if (primed.length === 0) return atK ? "no time reversal" : "type I (no time reversal)";
  return `${atK ? "" : "type III · "}primed: ${primed.join("  ")}`;
}

/**
 * Generate every candidate magnetic space group on an operation list (a parent
 * group, its little group of k, or a subgroup of that) for a propagation
 * vector k (default 0): every θ satisfying the twisted condition of the module
 * doc. At k = 0 these are the type-I group and one type-III group per index-2
 * subgroup; at a single-arm k ≠ 0 there may be fewer (none, when no θ closes)
 * or θ's that are not homomorphisms of the point group.
 */
export function generateMagneticCandidates(
  parentOps: readonly SymmetryOperation[],
  kIn: Vec3 = [0, 0, 0],
): MagneticCandidate[] {
  const k = twistingK(parentOps, kIn);
  const ops = distinctCosets(parentOps);
  const m = ops.length;
  const index = new Map<string, number>();
  ops.forEach((op, i) => index.set(rotationKey(op), i));
  const zeroK = isZeroK(k);
  const frame = cosetFrame(parentOps, index, m);

  // Constraints: x_i ⊕ x_j ⊕ x_{comp} = c_ij (the k-phase of t_ij), plus x_identity = 0.
  const rows: boolean[][] = [];
  const rhs: boolean[] = [];
  const identityIdx = ops.findIndex(isIdentity);
  const idRow = new Array<boolean>(m).fill(false);
  idRow[identityIdx >= 0 ? identityIdx : 0] = true;
  rows.push(idRow);
  rhs.push(false);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      const row = new Array<boolean>(m).fill(false);
      row[i] = !row[i];
      row[j] = !row[j];
      const c = frame.comp[i]![j]!;
      row[c] = !row[c];
      const phase = zeroK ? 1 : latticePhase(k, frame.t[i]![j]!);
      // A complex phase: no real θ closes this group at k.
      if (phase === null) return [];
      if (row.some(Boolean)) {
        rows.push(row);
        rhs.push(phase === -1);
      } else if (phase === -1) {
        // 0 = 1: the twist itself is inconsistent.
        return [];
      }
    }
  }

  const solution = solveAffineGF2(rows, rhs, m);
  if (!solution) return [];
  const { particular, basis } = solution;

  // At k ≠ 0, θ_i is read through each operation's centring offset: a listed
  // translation that differs from its representative's by an integer vector
  // with χ ≠ 1 as well would read the opposite sign, so it is re-expressed as
  // the representative's translation plus the offset (the same coset mod ℤ³).
  const translations: Vec3[] = parentOps.map((op, i) => {
    if (zeroK) return op.translation;
    const rep = frame.reps[frame.cosetOf[i]!]!;
    const c = frame.offsets[i]!;
    const want: Vec3 = snap24([rep.translation[0]! + c[0]!, rep.translation[1]! + c[1]!, rep.translation[2]! + c[2]!]);
    const n: Vec3 = [op.translation[0]! - want[0]!, op.translation[1]! - want[1]!, op.translation[2]! - want[2]!];
    return latticePhase(k, n) === 1 ? op.translation : want;
  });

  // Enumerate all 2^dim solutions: the particular one plus the null space.
  const dim = basis.length;
  const candidates: MagneticCandidate[] = [];
  const seen = new Set<string>();
  for (let mask = 0; mask < (1 << dim); mask++) {
    const x = [...particular];
    for (let b = 0; b < dim; b++) {
      if (mask & (1 << b)) {
        for (let c = 0; c < m; c++) x[c] = x[c] !== basis[b]![c];
      }
    }
    const signature = x.map((v) => (v ? "1" : "0")).join("");
    if (seen.has(signature)) continue;
    seen.add(signature);

    // Assign θ to the FULL parent operation list (each op takes the sign of its
    // rotation coset), so centring translations are preserved for the calc.
    const candOps: SymmetryOperation[] = parentOps.map((op, i) => {
      const coset = frame.cosetOf[i]!;
      const translation = translations[i]!;
      const moved = translation !== op.translation;
      return {
        ...op,
        ...(moved ? { translation, xyz: formatOperationXyz(op.rotation, translation) } : {}),
        timeReversal: (x[coset] ? -1 : 1) as 1 | -1,
      };
    });
    // Label from one representative per coset.
    const cosetReps: SymmetryOperation[] = ops.map((op, i) => ({ ...op, timeReversal: (x[i] ? -1 : 1) as 1 | -1 }));
    const unprimedCount = cosetReps.filter((o) => (o.timeReversal ?? 1) === 1).length;
    const isTypeI = unprimedCount === m;
    // At k ≠ 0 the parent-cell operations are not the group of the structure:
    // at a single-arm k it is named from its magnetic cell (`identifyCandidate`),
    // and a two-arm k's decoration is no magnetic space group at all.
    const atZero = isZeroK(kIn);
    const standard = atZero ? identifyMagneticGroup(candOps) : null;
    candidates.push({
      id: `mag-cand-${signature}`,
      label: standard ? formatMagneticSymbol(standard.bnsSymbol) : primedLabel(cosetReps, !atZero),
      isTypeI,
      unprimedCount,
      operations: candOps,
      standard,
    });
  }

  // Type I first, then by decreasing symmetry (more unprimed ops).
  candidates.sort((a, b) => Number(b.isTypeI) - Number(a.isTypeI) || b.unprimedCount - a.unprimedCount);
  return candidates;
}

/**
 * Transform a reciprocal-space vector (Miller-like) by an operation's rotation.
 * This codebase's convention is h' = Rᵀ·h (see `isReflectionAbsent`), so the
 * propagation vector transforms the same way. Translations do not act on k.
 *
 * Note: the strictly-geometric contragredient map of a dual-basis vector is
 * R⁻ᵀ·k (it differs from Rᵀ·k in oblique settings). This does NOT affect the
 * little group ({@link littleGroup}) or the star of k *as a set*: because the
 * group is closed under inverse and both Rᵀ and R⁻ᵀ map the reciprocal lattice
 * to itself, {R : Rᵀk ≡ k} = {R : R⁻ᵀk ≡ k}. Only if this were used to *label*
 * individual k-arms (not set membership) would R⁻ᵀ be required.
 */
export function transformK(op: SymmetryOperation, k: Vec3): Vec3 {
  const R = op.rotation;
  return [
    R[0][0] * k[0] + R[1][0] * k[1] + R[2][0] * k[2],
    R[0][1] * k[0] + R[1][1] * k[1] + R[2][1] * k[2],
    R[0][2] * k[0] + R[1][2] * k[1] + R[2][2] * k[2],
  ];
}

/** True if Rᵀ·k ≡ k modulo a vector of the parent's reciprocal lattice Λ*. */
function leavesKInvariant(op: SymmetryOperation, k: Vec3, centrings: readonly Vec3[], tol: number): boolean {
  const kp = transformK(op, k);
  return isReciprocalLatticeVector([kp[0]! - k[0]!, kp[1]! - k[1]!, kp[2]! - k[2]!], centrings, tol);
}

/**
 * The little group (group of the wavevector) G_k: the operations of the parent
 * group whose rotation leaves k invariant modulo a reciprocal-lattice vector,
 * Rᵀ·k ≡ k (mod Λ*). For k = 0 this is the whole parent group.
 *
 * Λ* is the reciprocal lattice of the parent's **true** lattice, read off the
 * centring translations in the operation list: for a centred cell it is a
 * sublattice of ℤ³ (F: h,k,l all even or all odd; I: h+k+l even; C: h+k even;
 * obverse R: −h+k+l ≡ 0 mod 3). Testing "mod ℤ³" instead would admit
 * operations that carry k to another arm of its star — for MnO (Fm-3m,
 * k = (½,½,½), the L point) the 4-fold axes map k to (½,−½,½) ≡ k + (0,−1,0),
 * a ℤ³ vector but not an F reciprocal-lattice vector, and the little group
 * would wrongly be all of m-3m instead of -3m.
 *
 * Reference: Bradley & Cracknell, *The Mathematical Theory of Symmetry in
 * Solids* (1972), §3.7 (the group of the wavevector).
 */
export function littleGroup(
  parentOps: readonly SymmetryOperation[],
  k: Vec3,
  tol = 1e-4,
): SymmetryOperation[] {
  const centrings = centringTranslations(parentOps);
  return parentOps.filter((op) => leavesKInvariant(op, k, centrings, tol));
}

/**
 * Candidate magnetic space groups for a **commensurate** propagation vector k
 * on the whole little group G_k: every θ on its cosets satisfying the twisted
 * condition (module doc), the k-phase of each product's lattice translation
 * included. For k = 0 this reduces exactly to {@link generateMagneticCandidates}
 * on the parent.
 *
 * This yields the magnetic groups on G_k itself — the maximal starting point
 * for a commensurate single-k structure; `magneticSubgroupLattice` adds every
 * subgroup of G_k. It does **not** perform representation (irrep) analysis or
 * enumerate the full star of k.
 *
 * Reference: Bertaut, *Acta Cryst.* A24 (1968) 217; Bradley & Cracknell (1972).
 */
export function generateMagneticCandidatesForK(
  parentOps: readonly SymmetryOperation[],
  k: Vec3,
): MagneticCandidate[] {
  return generateMagneticCandidates(littleGroup(parentOps, k), k);
}

// operationKey is re-exported for callers that key candidates by their op set.
export { operationKey };
