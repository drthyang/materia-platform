/**
 * Standard BNS/OG identification of magnetic space groups.
 *
 * A magnetic group *is* its operation set, so identification is exact set
 * matching: the candidate's operations (spatial part modulo lattice
 * translations, plus the ±1 time-reversal flag) are canonicalized into a
 * signature and looked up against the bundled standard table
 * ({@link ./bnsOgTable} — generated from the ISO-MAG data, see that file's
 * header for provenance). No symbol is ever derived heuristically: if the
 * operations do not match a tabulated group *in its standard BNS setting*,
 * identification returns `null` and callers keep the descriptive
 * primed-operation label. A wrong symbol is worse than none
 * (docs/MAGNETIC_SYMMETRY.md).
 *
 * The table covers all 1651 types (I–IV). Every candidate generated from a
 * parent group in its standard ITA setting (monoclinic b-unique cell choice 1,
 * hexagonal axes, origin choice 2) at k = 0 is identified directly; a
 * k ≠ 0 candidate is named from its group in the magnetic cell
 * (`magneticCell.ts`), a type-IV group, through the setting search below.
 *
 * For types I–III the OG symbol coincides with the BNS symbol; only the OG
 * *number* differs (verified at table-generation time). Type IV has an OG
 * symbol of its own (P_a2/c is P_2a2/c in OG).
 */

import type { SymmetryOperation } from "@/core/crystal/types";
import type { Mat3, Vec3 } from "@/core/math/types";
import {
  composeOperations,
  formatOperationXyz,
  parseMagneticSymmetryOperation,
  parseSymmetryOperation,
} from "@/core/crystal/symmetry";
import { mulMat } from "@/core/math/mat3";
import { adjugate3i, det3i, integerKernel, latticeBasis, solveCongruence } from "@/core/math/integerLattice";
import { MAGNETIC_GROUP_TABLE } from "./bnsOgTable";

export interface MagneticGroupIdentity {
  /** Shubnikov type: 1 (M = G, colourless), 2 (grey, M = G + G1′), 3 (M = D + θ(G − D)) or 4 (black-and-white lattice, M = D + {1|t₀}′D). */
  readonly magtype: 1 | 2 | 3 | 4;
  /** BNS number, e.g. "62.448". */
  readonly bnsNumber: string;
  /** BNS symbol in ASCII form, e.g. "Pn'ma'" or "P2_1'/c" (see {@link formatMagneticSymbol}). */
  readonly bnsSymbol: string;
  /** OG (Opechowski–Guccione) number, e.g. "62.8.509". */
  readonly ogNumber: string;
  /** OG symbol — the BNS symbol for types I–III, its own for type IV ("P_2a2/c"). */
  readonly ogSymbol: string;
  /** ITA number of the BNS family space group (the first part of the BNS number). */
  readonly parentNumber: number;
}

/**
 * Canonical key of one magnetic operation: rotation, translation modulo ℤ³ on
 * the 1/48 grid (wrapped modularly, so a translation a rounding error below an
 * integer keys as 0, and the ⅛ and 1/16 steps of a doubled cell keep their
 * own keys), and time reversal.
 */
function magneticOpKey(op: SymmetryOperation): string {
  const R = op.rotation.map((row) => row.map((v) => Math.round(v) + 0).join(",")).join(";");
  const t = op.translation.map((x) => (((Math.round(x * 48) % 48) + 48) % 48)).join(",");
  return `${R}|${t}|${op.timeReversal ?? 1}`;
}

/**
 * Canonical signature of a whole operation set: the sorted, deduplicated
 * operation keys. Duplicates (the same op given twice modulo a lattice
 * translation) collapse, so signatures compare groups, not listings.
 */
function groupSignature(ops: readonly SymmetryOperation[]): string {
  return [...new Set(ops.map(magneticOpKey))].sort().join(" ");
}

/** Turn a centring vector string like "1/2,1/2,0" into a pure-translation op. */
function centringOperation(vector: string): SymmetryOperation {
  const parts = vector.split(",");
  const xyz = ["x", "y", "z"].map((ax, i) => (parts[i] === "0" ? ax : `${ax}+${parts[i]}`)).join(",");
  return parseSymmetryOperation(xyz);
}

/** Canonical key of one (rotation, θ) pair — what survives origin shifts. */
function rotationThetaKey(rotation: Mat3, theta: number): string {
  return `${rotation.map((row) => row.map((v) => Math.round(v)).join(",")).join(";")}|${theta}`;
}

/** Sorted, deduplicated (rotation, θ) keys of a group: its point-group part. */
function rotationSignature(keys: Iterable<string>): string {
  return [...new Set(keys)].sort().join(" ");
}

let lookup: Map<string, MagneticGroupIdentity> | null = null;
/** Rotation signatures of every tabulated group — a cheap necessary condition
 *  for a match that the setting search checks before trying origin shifts. */
let rotationLookup: Set<string> | null = null;

/** A tabulated group as the origin solve reads it (see {@link solveOrigin}). */
interface TableEntry {
  readonly identity: MagneticGroupIdentity;
  /** One translation per (rotation, θ) of the group. */
  readonly translations: ReadonlyMap<string, Vec3>;
  /** Pure translations modulo ℤ³: unprimed (the lattice's centrings, 0 included) and primed (anti-translations). */
  readonly plus: string;
  readonly minus: string;
  /** Λ⁻¹ of the lattice ℤ³ + centrings as an integer matrix over a denominator: x ∈ Λ ⇔ inverse·x/den ∈ ℤ³. */
  readonly inverse: number[][];
  readonly den: number;
}

/** The tabulated groups by their rotation signature. */
let entriesByRotation: Map<string, TableEntry[]> | null = null;

/** The pure translations of an operation list, mod ℤ³, unprimed and primed, as sorted keys. */
function pureTranslations(ops: readonly SymmetryOperation[]): { plus: string; minus: string } {
  const plus = new Set<string>();
  const minus = new Set<string>();
  for (const op of ops) {
    if (!isIdentityMat(op.rotation)) continue;
    ((op.timeReversal ?? 1) === 1 ? plus : minus).add(vecKey(op.translation));
  }
  return { plus: [...plus].sort().join(" "), minus: [...minus].sort().join(" ") };
}

/** The full operation list of a table row: types II and IV are stored compactly (bnsOgTable.ts). */
function rowOperations(magtype: number, ops: string, centring: string, anti: string): SymmetryOperation[] {
  const listed = ops.split(";").map(parseMagneticSymmetryOperation);
  const antiOp: SymmetryOperation | null = anti === "" ? null : { ...centringOperation(anti), timeReversal: -1 };
  const reps =
    magtype === 2
      ? [...listed, ...listed.map((op) => ({ ...op, timeReversal: -1 as const }))]
      : antiOp
        ? [...listed, ...listed.map((op) => composeOperations(antiOp, op))]
        : listed;
  const shifts = centring === "" ? [] : centring.split(";").map(centringOperation);
  return [...reps, ...shifts.flatMap((s) => reps.map((op) => composeOperations(s, op)))];
}

/** Build the signature → identity map (and the rotation-signature set) once, on first use. */
function buildLookup(): Map<string, MagneticGroupIdentity> {
  const map = new Map<string, MagneticGroupIdentity>();
  rotationLookup = new Set<string>();
  entriesByRotation = new Map<string, TableEntry[]>();
  for (const [magtype, bnsNumber, bnsSymbol, ogNumber, ogSymbol, parentNumber, ops, centring, anti] of MAGNETIC_GROUP_TABLE) {
    const full = rowOperations(magtype, ops, centring, anti);
    const identity: MagneticGroupIdentity = {
      magtype,
      bnsNumber,
      bnsSymbol,
      ogNumber,
      ogSymbol: ogSymbol === "" ? bnsSymbol : ogSymbol,
      parentNumber,
    };
    map.set(groupSignature(full), identity);
    const rotSig = rotationSignature(full.map((op) => rotationThetaKey(op.rotation, op.timeReversal ?? 1)));
    rotationLookup.add(rotSig);
    const translations = new Map<string, Vec3>();
    for (const op of full) {
      const key = rotationThetaKey(op.rotation, op.timeReversal ?? 1);
      if (!translations.has(key)) translations.set(key, op.translation);
    }
    const lattice = latticeInverse(centring === "" ? [] : centring.split(";").map((v) => centringOperation(v).translation));
    const entry: TableEntry = { identity, translations, ...pureTranslations(full), ...lattice };
    const list = entriesByRotation.get(rotSig);
    if (list) list.push(entry);
    else entriesByRotation.set(rotSig, [entry]);
  }
  return map;
}

/** Scale of the integer grid lattice vectors are written on (every centring and anti-translation lies on it). */
const GRID = 48;

/** Λ = ℤ³ + centrings as Λ⁻¹ over a denominator (see {@link TableEntry}). */
function latticeInverse(centrings: readonly Vec3[]): { inverse: number[][]; den: number } {
  const gens: number[][] = [[GRID, 0, 0], [0, GRID, 0], [0, 0, GRID], ...centrings.map((c) => c.map((x) => Math.round(x * GRID)))];
  const B = latticeBasis(gens); // columns, in 1/GRID units
  const det = det3i(B);
  // Λ⁻¹ = (B/GRID)⁻¹ = GRID·adj(B)/det(B).
  return { inverse: adjugate3i(B).map((row) => row.map((v) => v * GRID)), den: det };
}

/**
 * Identify a magnetic group from its full operation list (including centring
 * cosets; missing `timeReversal` means +1). Returns the standard BNS/OG
 * numbers and symbols, or `null` when the operations do not match any type-I
 * or type-III group in its standard BNS setting.
 */
export function identifyMagneticGroup(
  ops: readonly SymmetryOperation[],
): MagneticGroupIdentity | null {
  lookup ??= buildLookup();
  return lookup.get(groupSignature(ops)) ?? null;
}

/** All tabulated groups (types I–IV) of the given BNS family space-group number. */
export function magneticGroupsForParent(parentNumber: number): MagneticGroupIdentity[] {
  return MAGNETIC_GROUP_TABLE.filter((row) => row[5] === parentNumber).map(
    ([magtype, bnsNumber, bnsSymbol, ogNumber, ogSymbol, parent]) => ({
      magtype,
      bnsNumber,
      bnsSymbol,
      ogNumber,
      ogSymbol: ogSymbol === "" ? bnsSymbol : ogSymbol,
      parentNumber: parent,
    }),
  );
}

// ---------------------------------------------------------------------------
// Setting-transformation search
//
// A subgroup of a standard-setting parent is often expressed in a
// non-standard setting (monoclinic axis along a or c, off-origin inversion
// centre, a tetragonal subgroup still written in the cubic F cell, …), so its
// operation set misses the exact table match even though the group type is
// tabulated. The remedy is the ITA basis transformation (P, p): with
// x_old = P·x_new + p, every operation conjugates as
//
//   R' = P⁻¹·R·P,   t' = P⁻¹·(R·p + t − p)
//
// (International Tables for Crystallography Vol. A, §1.5 "Transformations of
// coordinate systems", and Vol. A1, Wondratschek & Müller, on subgroups in
// non-standard settings). Three families of basis changes are searched, each
// combined with origin shifts on the 1/4-grid:
//
//   1. the 24 proper signed axis permutations (det P = +1) — every
//      right-handed relabelling of the axes;
//   2. the three **orthohexagonal** C-centred cells (det P = +2) composed
//      with the 24 permutations — (a, a+2b, c) and its 120°-rotated variants.
//      These are how the orthorhombic and monoclinic subgroups of a hexagonal
//      parent reach their standard settings (ITA A1): the doubled cell brings
//      a centring, so the transformed operation set is expanded with the
//      centring cosets {P⁻¹·v mod 1, v ∈ ℤ³} before matching; and
//   3. the **cells of a cubic lattice** other than its conventional one: for a
//      face-centred lattice the body-centred tetragonal cell ((a−b)/2,
//      (a+b)/2, c), the obverse hexagonal cell of the rhombohedral sublattice
//      ((−a+b)/2, (−b+c)/2, a+b+c), two C-centred monoclinic cells with the
//      unique axis along a cube edge or a face diagonal, and the primitive
//      rhombohedral cell (det P = ½, ¾, ½, ½, ¼); for a primitive lattice the
//      obverse hexagonal cell (a−b, b−c, a+b+c) of ITA §1.5.1 (det 3), which
//      is also the rhombohedral→hexagonal axes change of a rhombohedral-axes
//      parent — each in every orientation the cubic point group allows. These
//      are how the tetragonal, rhombohedral, orthorhombic-I, monoclinic-C and
//      triclinic subgroups of an F cubic parent reach their standard settings
//      (I4/mm'm', R-3m', Im'm'm, C2'/m', P-1, …). A cell with fractional
//      basis vectors is applied only when each of them is a lattice vector of
//      the group being identified (its centring translations are read off the
//      operation list), so the transformed translation group is exactly P⁻¹
//      of the old one and never a fictitious superset.
//
// P is rational, P = N/d with N integer, and P⁻¹ = d·adj N / det N. A
// transformed rotation is accepted only when adj·R·N is divisible by det N —
// otherwise that basis simply does not apply. A basis whose transformed
// rotation set (which no origin shift can change) matches no tabulated group
// is dropped before any origin shift is tried. Every match is still
// **exact** — only the setting is searched, never the symbol guessed.
// Monoclinic cell choices 2/3, the reverse rhombohedral setting and sub-cells
// of I- or C-centred parents remain outside the family and honestly return
// null.
// ---------------------------------------------------------------------------

export interface TransformedIdentification {
  readonly identity: MagneticGroupIdentity;
  /** New basis in terms of the old, ITA-style, e.g. "(b, c, a; 0, 0, 0)" or
   *  "((a-b)/2, (a+b)/2, c; 0, 0, 0)". */
  readonly transformation: string;
  /** True when the match needed no transformation (standard setting). */
  readonly direct: boolean;
  /** Basis-change matrix: columns = standard-setting basis vectors in the
   *  parent basis (x_old = P·x_new + P·originShift), rational for sub-cells.
   *  Lets the UI draw the transformed cell. Identity when `direct`. */
  readonly P: Mat3;
  /** Origin shift in the new basis; the new cell origin sits at the parent
   *  fractional position P·originShift. Zero when `direct`. */
  readonly originShift: Vec3;
}

const IDENTITY: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** The 24 proper (det = +1) signed permutation matrices, identity first. */
function properSignedPermutations(): Mat3[] {
  const perms = [
    [0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [1, 0, 2], [2, 1, 0],
  ];
  const out: Mat3[] = [];
  for (const perm of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const P: number[][] = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      // Column j is (±1) in row perm[j]: new axis j = ±(old axis perm[j]).
      let det = 1;
      for (let j = 0; j < 3; j++) {
        const s = signs & (1 << j) ? -1 : 1;
        P[perm[j]!]![j] = s;
        det *= s;
      }
      // Sign of the permutation: even for the first three above.
      const parity = perm[0] === 0 && perm[1] === 1 ? 1 : perms.indexOf(perm) < 3 ? 1 : -1;
      if (det * parity === 1) out.push(P as unknown as Mat3);
    }
  }
  // Identity first so a standard-setting group reports `direct`.
  out.sort((a, b) => Number(isIdentityMat(b)) - Number(isIdentityMat(a)));
  return out;
}

function isIdentityMat(m: Mat3): boolean {
  return m[0]![0] === 1 && m[1]![1] === 1 && m[2]![2] === 1 &&
    m[0]![1] === 0 && m[0]![2] === 0 && m[1]![0] === 0 &&
    m[1]![2] === 0 && m[2]![0] === 0 && m[2]![1] === 0;
}

function mulVec3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0]![0]! * v[0]! + m[0]![1]! * v[1]! + m[0]![2]! * v[2]!,
    m[1]![0]! * v[0]! + m[1]![1]! * v[1]! + m[1]![2]! * v[2]!,
    m[2]![0]! * v[0]! + m[2]![1]! * v[1]! + m[2]![2]! * v[2]!,
  ];
}

function det3(m: Mat3): number {
  return (
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
  );
}

/** Integer adjugate: N⁻¹ = adj(N) / det(N). */
function adjugate(m: Mat3): Mat3 {
  const c = (r1: number, c1: number, r2: number, c2: number): number =>
    m[r1]![c1]! * m[r2]![c2]! - m[r1]![c2]! * m[r2]![c1]!;
  return [
    [c(1, 1, 2, 2), -c(0, 1, 2, 2), c(0, 1, 1, 2)],
    [-c(1, 0, 2, 2), c(0, 0, 2, 2), -c(0, 0, 1, 2)],
    [c(1, 0, 2, 1), -c(0, 0, 2, 1), c(0, 0, 1, 1)],
  ];
}

/** x mod 1 in [0, 1), with values within 1e-9 of an integer snapped to 0. */
function wrap01(x: number): number {
  const r = ((x % 1) + 1) % 1;
  return Math.abs(r - 1) < 1e-9 || Math.abs(r) < 1e-9 ? 0 : r;
}

/** Canonical key of a translation vector modulo the lattice. */
function vecKey(v: Vec3): string {
  return v.map((x) => wrap01(x).toFixed(6)).join(",");
}

function isZeroVec(v: Vec3): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0;
}

interface BasisOption {
  /** Rational basis-change matrix: columns = new basis vectors in the old basis. */
  readonly P: Mat3;
  /** Integer numerator N = d·P, with adj N and det N > 0: P⁻¹ = d·adj/det. */
  readonly N: Mat3;
  readonly d: number;
  readonly adj: Mat3;
  readonly det: number;
  /** {P⁻¹·n mod 1 : n ∈ ℤ³} — the cosets the old integer translations occupy
   *  in the new cell (just the origin for a cell with integer P⁻¹). */
  readonly centerings: readonly Vec3[];
  /** Non-integer columns of P, reduced mod 1: each must be a centring
   *  translation of the group, or the cell is not a cell of its lattice. */
  readonly fractionalColumns: readonly Vec3[];
  readonly identity: boolean;
}

/** {d·adj·n / det mod 1 : n ∈ ℤ³} = P⁻¹·ℤ³ mod 1. Each image has order
 *  dividing det, so n over [0, det)³ reaches every coset. */
function centeringVectors(adj: Mat3, det: number, d: number): Vec3[] {
  // The group mod 1 generated by the images of the three old basis vectors.
  const gens = [0, 1, 2].map((i) => [adj[0]![i]!, adj[1]![i]!, adj[2]![i]!].map((x) => wrap01((d * x) / det)) as unknown as Vec3);
  const seen = new Map<string, Vec3>([[vecKey([0, 0, 0]), [0, 0, 0]]]);
  const queue: Vec3[] = [[0, 0, 0]];
  while (queue.length > 0) {
    const v = queue.pop()!;
    for (const g of gens) {
      const w: Vec3 = [wrap01(v[0]! + g[0]!), wrap01(v[1]! + g[1]!), wrap01(v[2]! + g[2]!)];
      const key = vecKey(w);
      if (!seen.has(key)) {
        seen.set(key, w);
        queue.push(w);
      }
    }
  }
  return [...seen.values()];
}

const DENOMINATORS = [1, 2, 3, 4, 6, 8, 12, 24];

function makeBasisOption(P: Mat3): BasisOption {
  const isInt = (x: number): boolean => Math.abs(x - Math.round(x)) < 1e-9;
  const d = DENOMINATORS.find((k) => P.every((row) => row.every((x) => isInt(x * k))));
  if (d === undefined) throw new Error("basis matrix is not rational with a small denominator");
  const N = P.map((row) => row.map((x) => Math.round(x * d))) as unknown as Mat3;
  const det = det3(N);
  if (det <= 0) throw new Error("basis change must be right-handed");
  const adj = adjugate(N);
  const fractionalColumns: Vec3[] = [];
  for (let j = 0; j < 3; j++) {
    const col: Vec3 = [P[0]![j]!, P[1]![j]!, P[2]![j]!];
    if (!col.every(isInt)) fractionalColumns.push(col.map(wrap01) as unknown as Vec3);
  }
  return {
    P,
    N,
    d,
    adj,
    det,
    centerings: centeringVectors(adj, det, d),
    fractionalColumns,
    identity: isIdentityMat(P),
  };
}

/** Lattice points of a primitive and of a face-centred cell (origin included). */
const P_LATTICE: readonly Vec3[] = [[0, 0, 0]];
const F_LATTICE: readonly Vec3[] = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];

/** Centring sets a standard BNS setting can carry: P, C, I, F, obverse R. */
const STANDARD_CENTRINGS: ReadonlySet<string> = new Set(
  (
    [
      [[0, 0, 0]],
      [[0, 0, 0], [0.5, 0.5, 0]],
      [[0, 0, 0], [0.5, 0.5, 0.5]],
      [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
      [[0, 0, 0], [2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]],
    ] as Vec3[][]
  ).map((set) => set.map(vecKey).sort().join(" ")),
);

/** The cosets the given lattice occupies in the cell P, as a sorted key. */
function latticeCentringKey(b: BasisOption, lattice: readonly Vec3[]): string {
  const keys = new Set<string>();
  for (const c of lattice) {
    const pc = mulVec3(b.adj, c).map((x) => (b.d * x) / b.det);
    for (const n of b.centerings) keys.add(vecKey([pc[0]! + n[0]!, pc[1]! + n[1]!, pc[2]! + n[2]!]));
  }
  return [...keys].sort().join(" ");
}

/**
 * Cells of a cubic (or rhombohedral-axes) lattice other than its conventional
 * one: each seed in every orientation the cubic point group allows (left
 * factor Q₁ over the 24 proper rotations) and, where the standard setting
 * cares about axis order, every relabelling (right factor Q₂). Only cells in
 * which the seed's lattice shows a standard centring (P, C, I, F or obverse R)
 * are kept, so e.g. only the C-monoclinic relabellings with the centring at
 * (½, ½, 0) and only the obverse hexagonal orientations survive.
 */
function cubicSubcells(perms: readonly Mat3[]): Mat3[] {
  const seeds: { O: Mat3; lattice: readonly Vec3[]; orient: boolean; relabel: boolean }[] = [
    // F → body-centred tetragonal ((a−b)/2, (a+b)/2, c), det ½: the I4/mmm-,
    // Immm-, Imm2-, I222-family settings.
    { O: [[0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 1]], lattice: F_LATTICE, orient: true, relabel: true },
    // F → obverse hexagonal axes of the rhombohedral sublattice, det ¾:
    // a_h = a_r − b_r, b_h = b_r − c_r, c_h = a_r + b_r + c_r with
    // (a_r, b_r, c_r) = ((b+c)/2, (a+c)/2, (a+b)/2), i.e.
    // ((−a+b)/2, (−b+c)/2, a+b+c): the R3-…R-3m-family settings.
    { O: [[-0.5, 0, 1], [0.5, -0.5, 1], [0, 0.5, 1]], lattice: F_LATTICE, orient: true, relabel: false },
    // F → C-centred monoclinic, unique axis b' along a cube edge, det ½:
    // (a, c, (a−b)/2) — the C2/m-family settings for a mirror ⊥ a cube edge.
    { O: [[1, 0, 0.5], [0, 0, -0.5], [0, 1, 0]], lattice: F_LATTICE, orient: true, relabel: true },
    // F → C-centred monoclinic, unique axis b' along a face diagonal, det ½:
    // ((a+b)/2 + c, (a−b)/2, (a+b)/2) — for a mirror ⊥ a face diagonal.
    { O: [[0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [1, 0, 0]], lattice: F_LATTICE, orient: true, relabel: true },
    // F → primitive rhombohedral cell ((b+c)/2, (a+c)/2, (a+b)/2), det ¼:
    // the triclinic P1 / P-1 settings (any primitive cell will do).
    { O: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]], lattice: F_LATTICE, orient: false, relabel: false },
    // Rhombohedral axes → obverse hexagonal axes (a−b, b−c, a+b+c), det 3
    // (ITA Vol. A §1.5.1): for a rhombohedral-axes parent, or a primitive
    // cubic one, whose 3-fold subgroups are rhombohedral.
    { O: [[1, 0, 1], [-1, 1, 1], [0, -1, 1]], lattice: P_LATTICE, orient: true, relabel: false },
  ];
  const out = new Map<string, Mat3>();
  for (const { O, lattice, orient, relabel } of seeds) {
    const lefts = orient ? perms : [IDENTITY];
    const rights = relabel ? perms : [IDENTITY];
    for (const Q1 of lefts) {
      for (const Q2 of rights) {
        const P = mulMat(mulMat(Q1, O), Q2);
        const key = P.map((row) => row.map((x) => x.toFixed(6)).join(",")).join(";");
        if (out.has(key)) continue;
        if (!STANDARD_CENTRINGS.has(latticeCentringKey(makeBasisOption(P), lattice))) continue;
        out.set(key, P);
      }
    }
  }
  return [...out.values()];
}

let basisOptionsCache: BasisOption[] | null = null;

/**
 * All searched basis changes, in order: the 24 proper signed permutations
 * (det 1), the three orthohexagonal cells composed with the permutations
 * (det 2), then the sub-cells of an F cubic lattice (det ½, ¾, ¼) and the
 * hexagonal cell of a rhombohedral-axes lattice (det 3).
 */
function basisOptions(): BasisOption[] {
  if (basisOptionsCache) return basisOptionsCache;
  const perms = properSignedPermutations();
  // Columns = new basis vectors in the old (hexagonal) basis. In a γ = 120°
  // cell, a ⊥ a+2b, b ⊥ 2a+b, and (a+b) ⊥ (a−b) — the three orthohexagonal
  // settings (each right-handed, det +2, C-centring (½,½,0)-type).
  const orthohex: Mat3[] = [
    [[1, 1, 0], [0, 2, 0], [0, 0, 1]],    // (a, a+2b, c)
    [[0, -2, 0], [1, -1, 0], [0, 0, 1]],  // (b, −2a−b, c)
    [[1, -1, 0], [1, 1, 0], [0, 0, 1]],   // (a+b, −a+b, c)
  ];
  const all: Mat3[] = [...perms];
  for (const O of orthohex) for (const Q of perms) all.push(mulMat(O, Q));
  all.push(...cubicSubcells(perms));
  basisOptionsCache = all.map(makeBasisOption);
  return basisOptionsCache;
}

/** R' = adj·R·N / det, or null when it is not integral (basis does not apply). */
function changeRotation(rotation: Mat3, basis: BasisOption): Mat3 | null {
  const M = mulMat(mulMat(basis.adj, rotation), basis.N);
  const out: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const q = M[i]![j]! / basis.det;
      if (Math.abs(q - Math.round(q)) > 1e-9) return null;
      out[i]![j] = Math.round(q);
    }
  }
  return out as unknown as Mat3;
}

/**
 * Basis-change part of the conjugation: R' = P⁻¹·R·P (must be integral —
 * returns null when this basis does not apply to the rotation),
 * t' = P⁻¹·t = d·adj·t / det. Origin shifts are applied afterwards, in the
 * new basis.
 */
function changeBasis(op: SymmetryOperation, basis: BasisOption): SymmetryOperation | null {
  const rotation = changeRotation(op.rotation, basis);
  if (!rotation) return null;
  const translation = mulVec3(basis.adj, op.translation).map((x) => (basis.d * x) / basis.det) as unknown as Vec3;
  return {
    rotation,
    translation,
    xyz: formatOperationXyz(rotation, translation),
    ...(op.timeReversal !== undefined ? { timeReversal: op.timeReversal } : {}),
  };
}

/** Origin shift by p (new basis): t'' = R·p + t − p. */
function shiftOrigin(op: SymmetryOperation, p: Vec3): SymmetryOperation {
  const Rp = mulVec3(op.rotation, p);
  const translation: Vec3 = [
    Rp[0]! + op.translation[0]! - p[0]!,
    Rp[1]! + op.translation[1]! - p[1]!,
    Rp[2]! + op.translation[2]! - p[2]!,
  ];
  return { ...op, translation, xyz: formatOperationXyz(op.rotation, translation) };
}

const AXES = ["a", "b", "c"] as const;

/** One column of P as "b", "-a", "a+2b", "(a-b)/2", "(a+b+2c)/2", … */
function describeColumn(col: Vec3): string {
  const d =
    DENOMINATORS.find((k) => col.every((x) => Math.abs(x * k - Math.round(x * k)) < 1e-9)) ?? 1;
  const terms: string[] = [];
  for (let i = 0; i < 3; i++) {
    const v = Math.round(col[i]! * d);
    if (v === 0) continue;
    const mag = Math.abs(v) === 1 ? "" : String(Math.abs(v));
    terms.push(`${v < 0 ? "-" : terms.length > 0 ? "+" : ""}${mag}${AXES[i]!}`);
  }
  const body = terms.join("") || "0";
  return d === 1 ? body : `(${body})/${d}`;
}

/** A coordinate as the smallest fraction n/d (d ≤ 48) it is, "0" for zero. */
function fractionText(v: number): string {
  for (let d = 1; d <= 48; d++) {
    const n = Math.round(v * d);
    if (Math.abs(v * d - n) < 1e-6) return n === 0 ? "0" : d === 1 ? String(n) : `${n}/${d}`;
  }
  return v.toFixed(4);
}

/**
 * Describe a basis change ITA-style: the new basis vectors in terms of the
 * old (P's columns) and the origin shift in the new basis, e.g.
 * "(b, c, a; 0, 0, 0)" or "(2a, b, c; 1/4, 0, 0)".
 */
export function describeTransformation(P: Mat3, p: Vec3): string {
  const cols = [0, 1, 2].map((j) => describeColumn([P[0]![j]!, P[1]![j]!, P[2]![j]!]));
  return `(${cols.join(", ")}; ${p.map(fractionText).join(", ")})`;
}

/** Origin-shift grids, coarse to fine: exact setting → halves → quarters. */
function* originShifts(): Generator<Vec3> {
  yield [0, 0, 0];
  const halves = [0, 0.5];
  for (const x of halves) for (const y of halves) for (const z of halves) {
    if (x !== 0 || y !== 0 || z !== 0) yield [x, y, z];
  }
  const quarters = [0, 0.25, 0.5, 0.75];
  for (const x of quarters) for (const y of quarters) for (const z of quarters) {
    if ((x * 4) % 2 === 0 && (y * 4) % 2 === 0 && (z * 4) % 2 === 0) continue; // already tried
    yield [x, y, z];
  }
}

/**
 * Identify a magnetic group in **any setting reachable by a proper axis
 * permutation, an orthohexagonal (C-centred, det-2) cell, a sub-cell of an
 * F cubic lattice (I tetragonal/orthorhombic, obverse-hexagonal R, C
 * monoclinic, primitive triclinic) or the hexagonal cell of a rhombohedral
 * lattice, plus a ¼-grid origin shift**: conjugate
 * the operation set by each candidate (P, p), expand the translation cosets
 * the new cell requires, and look for an exact table match. Returns the
 * identity plus the transformation that produced the match (`direct` when
 * none was needed), or null when no setting in the family matches — a wrong
 * symbol is still worse than none.
 */
export function identifyMagneticGroupAnySetting(
  ops: readonly SymmetryOperation[],
  options: { readonly family?: boolean } = {},
): TransformedIdentification | null {
  const direct = identifyMagneticGroup(ops);
  if (direct) {
    return {
      identity: direct,
      transformation: "(a, b, c; 0, 0, 0)",
      direct: true,
      P: IDENTITY,
      originShift: [0, 0, 0],
    };
  }
  const rotations = rotationLookup!; // built by identifyMagneticGroup above

  // Lattice translations of the group: its pure unprimed translations. A
  // fractional cell is a cell of this lattice only if its basis vectors are
  // among them.
  const centrings = new Set<string>();
  for (const op of ops) {
    if (isIdentityMat(op.rotation) && (op.timeReversal ?? 1) === 1) centrings.add(vecKey(op.translation));
  }
  // One representative per (rotation, θ): the part of the group that neither
  // a centring expansion nor an origin shift changes.
  const rotationReps = new Map<string, SymmetryOperation>();
  for (const op of ops) {
    const k = rotationThetaKey(op.rotation, op.timeReversal ?? 1);
    if (!rotationReps.has(k)) rotationReps.set(k, op);
  }

  /** The transformed rotation signature, or null when a rotation is not integral in the cell. */
  const rotationsIn = (basis: BasisOption): string | null => {
    const keys: string[] = [];
    for (const op of rotationReps.values()) {
      const R = changeRotation(op.rotation, basis);
      if (!R) return null; // rotation not integral in this cell
      keys.push(rotationThetaKey(R, op.timeReversal ?? 1));
    }
    return rotationSignature(keys);
  };

  for (const basis of options.family === false ? [] : basisOptions()) {
    if (basis.fractionalColumns.some((c) => !centrings.has(vecKey(c)))) continue;
    // Necessary condition, cheap: the transformed rotation set is tabulated.
    const rotSig = rotationsIn(basis);
    if (rotSig === null || !rotations.has(rotSig)) continue;
    const base = inBasis(ops, basis);
    if (!base) continue;
    for (const p of originShifts()) {
      if (isZeroVec(p) && basis.identity) continue; // the untransformed set was already tried above
      const shifted = isZeroVec(p) ? base : base.map((op) => shiftOrigin(op, p));
      const identity = identifyMagneticGroup(shifted);
      if (identity) {
        return {
          identity,
          transformation: describeTransformation(basis.P, p),
          direct: false,
          P: basis.P,
          originShift: p,
        };
      }
    }
  }

  // The group's own conventional cells: built from its lattice and rotation
  // axes, so any basis change reaches them (monoclinic cell choices, the
  // magnetic cell of a type-IV group, a centred cell inside a supercell),
  // each with the origin shift solved exactly instead of searched.
  for (const P of conventionalBases(ops)) {
    let basis: BasisOption;
    try {
      basis = makeBasisOption(P);
    } catch {
      continue;
    }
    if (basis.fractionalColumns.some((c) => !centrings.has(vecKey(c)))) continue;
    const rotSig = rotationsIn(basis);
    const entries = rotSig === null ? undefined : entriesByRotation!.get(rotSig);
    if (!entries) continue;
    const base = inBasis(ops, basis);
    if (!base) continue;
    const pure = pureTranslations(base);
    for (const entry of entries) {
      if (entry.plus !== pure.plus || entry.minus !== pure.minus) continue;
      const p = solveOrigin(base, entry);
      if (!p) continue;
      const shifted = base.map((op) => shiftOrigin(op, p));
      if (identifyMagneticGroup(shifted) === entry.identity) {
        return {
          identity: entry.identity,
          transformation: describeTransformation(basis.P, p),
          direct: false,
          P: basis.P,
          originShift: p,
        };
      }
    }
  }
  return null;
}

/**
 * The operations in a new basis: conjugated, expanded with the cosets the old
 * integer translations occupy in the new cell and deduplicated modulo the new
 * lattice (a sub-cell collapses the old centring cosets). Null when a rotation
 * is not integral in the cell.
 */
function inBasis(ops: readonly SymmetryOperation[], basis: BasisOption): SymmetryOperation[] | null {
  const reps = new Map<string, SymmetryOperation>();
  for (const op of ops) {
    const t = changeBasis(op, basis);
    if (!t) return null;
    for (const c of basis.centerings) {
      const shifted = isZeroVec(c)
        ? t
        : { ...t, translation: [t.translation[0]! + c[0]!, t.translation[1]! + c[1]!, t.translation[2]! + c[2]!] as Vec3 };
      const k = magneticOpKey(shifted);
      if (!reps.has(k)) reps.set(k, shifted);
    }
  }
  return [...reps.values()];
}

/**
 * The origin shift p that carries a group (in the entry's basis, with the
 * entry's rotations and pure translations) onto a tabulated one, or null:
 * for a generating set of its (rotation, θ) classes, t + (R − I)·p ≡ t_E
 * modulo the entry's lattice Λ — a congruence solved exactly
 * (`solveCongruence`) in Λ's own basis. The generators' images fix the rest,
 * and the caller confirms the match on the whole operation set.
 */
function solveOrigin(ops: readonly SymmetryOperation[], entry: TableEntry): Vec3 | null {
  const gens: SymmetryOperation[] = [];
  const reached = new Set<string>([rotationThetaKey(IDENTITY, 1)]);
  const close = (): void => {
    let grown = true;
    while (grown) {
      grown = false;
      for (const a of [...reached]) for (const g of gens) {
        const [ra, ta] = a.split("|");
        const Ra = ra!.split(";").map((r) => r.split(",").map(Number)) as unknown as Mat3;
        const key = rotationThetaKey(mulMat(g.rotation, Ra), (g.timeReversal ?? 1) * Number(ta));
        if (!reached.has(key)) {
          reached.add(key);
          grown = true;
        }
      }
    }
  };
  for (const op of ops) {
    if (isIdentityMat(op.rotation)) continue; // pure translations: compared as sets by the caller
    if (reached.has(rotationThetaKey(op.rotation, op.timeReversal ?? 1))) continue;
    gens.push(op);
    close();
  }
  const A: number[][] = [];
  const b: number[] = [];
  for (const g of gens) {
    const tE = entry.translations.get(rotationThetaKey(g.rotation, g.timeReversal ?? 1));
    if (!tE) return null;
    const RI = g.rotation.map((row, i) => row.map((v, j) => v - (i === j ? 1 : 0)));
    const d = [tE[0]! - g.translation[0]!, tE[1]! - g.translation[1]!, tE[2]! - g.translation[2]!];
    // In Λ's basis: inverse·((R − I)·p − d)/den ∈ ℤ³, with u = p/den: (inverse·(R − I))·u ≡ inverse·d/den.
    for (let i = 0; i < 3; i++) {
      A.push([0, 1, 2].map((j) => entry.inverse[i]![0]! * RI[0]![j]! + entry.inverse[i]![1]! * RI[1]![j]! + entry.inverse[i]![2]! * RI[2]![j]!));
      b.push((entry.inverse[i]![0]! * d[0]! + entry.inverse[i]![1]! * d[1]! + entry.inverse[i]![2]! * d[2]!) / entry.den);
    }
  }
  if (A.length === 0) return [0, 0, 0];
  const u = solveCongruence(A, b);
  if (!u) return null;
  return [wrap01(u[0]! * entry.den), wrap01(u[1]! * entry.den), wrap01(u[2]! * entry.den)];
}

// ---------------------------------------------------------------------------
// Conventional cells of a group's own lattice
//
// The standard (BNS) cell of a group is a conventional cell of its lattice of
// unprimed translations: its basis vectors are lattice vectors along the
// group's symmetry directions (ITA Vol. A §2.1.3; for a type-IV group, the
// lattice of D, BNS's cell). They are found from the group itself, metric-
// free, in the primitive basis of that lattice, where every rotation is an
// integer matrix:
//   cubic        the three cube-edge axes (of the 4-folds, or of the 2-folds);
//   hexagonal    c along the 3- or 6-fold axis, a in the lattice plane
//                normal to it with {a, R₃a} a basis of that plane;
//   tetragonal   c along the 4-fold axis, a with {a, R₄a} a basis of the plane;
//   orthorhombic the three 2-fold axes, in every order;
//   monoclinic   b along the 2-fold axis, a and c a basis of the plane normal
//                to it — small unimodular combinations, which reach the cell
//                choices and centrings of ITA;
//   triclinic    any primitive cell, the anti-translation of a type-IV group
//                put at a/2, b/2 or c/2.
// Each candidate keeps det > 0; along an axis the vector is the shortest
// lattice vector there (the primitive integer vector in the lattice basis).
// ---------------------------------------------------------------------------

type IVec = number[];

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** The primitive integer vector along v (gcd 1), sign-normalized. */
function primitive(v: IVec): IVec {
  const g = v.reduce((acc, x) => gcd(acc, x), 0) || 1;
  const w = v.map((x) => x / g);
  const first = w.find((x) => x !== 0) ?? 1;
  return first < 0 ? w.map((x) => -x + 0) : w;
}

const matVec = (M: readonly (readonly number[])[], v: IVec): IVec => M.map((row) => row[0]! * v[0]! + row[1]! * v[1]! + row[2]! * v[2]!);
const matMul = (A: readonly (readonly number[])[], B: readonly (readonly number[])[]): number[][] =>
  A.map((row) => [0, 1, 2].map((j) => row[0]! * B[0]![j]! + row[1]! * B[1]![j]! + row[2]! * B[2]![j]!));
const columns = (cols: readonly IVec[]): number[][] => [0, 1, 2].map((i) => cols.map((c) => c[i]!));

/** The axis of a proper rotation R ≠ I: the primitive integer vector spanning ker(R − I). */
function axisOf(R: readonly (readonly number[])[]): IVec {
  const K = integerKernel(R.map((row, i) => row.map((v, j) => v - (i === j ? 1 : 0))));
  return primitive(K.map((row) => row[0]!));
}

/** Order of a proper rotation from its trace. */
function rotationOrder(R: readonly (readonly number[])[]): number {
  const tr = R[0]![0]! + R[1]![1]! + R[2]![2]!;
  return tr === 3 ? 1 : tr === -1 ? 2 : tr === 0 ? 3 : tr === 1 ? 4 : 6;
}

/** A basis (two columns) of the lattice plane {v : (I + R + … + R^{n−1})·v = 0} normal to R's axis. */
function planeOf(R: readonly (readonly number[])[], order: number): IVec[] {
  let S = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let P = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = 1; i < order; i++) {
    P = matMul(P, R);
    S = S.map((row, a) => row.map((v, b) => v + P[a]![b]!));
  }
  const K = integerKernel(S);
  return [0, 1].map((j) => K.map((row) => row[j]!));
}

/** Integer combinations m·w₁ + n·w₂ with |m|, |n| ≤ 2. */
function planeVectors(w: readonly IVec[]): IVec[] {
  const out: IVec[] = [];
  for (let m = -2; m <= 2; m++) for (let n = -2; n <= 2; n++) {
    if (m === 0 && n === 0) continue;
    out.push([0, 1, 2].map((i) => m * w[0]![i]! + n * w[1]![i]!));
  }
  return out;
}

/** The candidate conventional cells of a group, as basis matrices P in the group's own basis (columns). */
function conventionalBases(ops: readonly SymmetryOperation[]): Mat3[] {
  const plus: number[][] = [];
  const minus: number[][] = [];
  for (const op of ops) {
    if (!isIdentityMat(op.rotation)) continue;
    const t = op.translation.map((x) => Math.round(wrap01(x) * GRID));
    ((op.timeReversal ?? 1) === 1 ? plus : minus).push(t);
  }
  let B: number[][];
  try {
    B = latticeBasis([[GRID, 0, 0], [0, GRID, 0], [0, 0, GRID], ...plus]);
  } catch {
    return [];
  }
  const detB = det3i(B);
  const adjB = adjugate3i(B);
  // Rotations in the lattice basis: B⁻¹·R·B, integral for a lattice the group keeps.
  const rots = new Map<string, number[][]>();
  for (const op of ops) {
    const M = matMul(matMul(adjB, op.rotation as unknown as number[][]), B);
    if (M.some((row) => row.some((v) => v % detB !== 0))) return [];
    const R = M.map((row) => row.map((v) => v / detB + 0));
    rots.set(R.map((r) => r.join(",")).join(";"), R);
  }
  const proper = [...rots.values()].map((R) => (det3i(R) < 0 ? R.map((row) => row.map((v) => -v + 0)) : R)).filter((R) => rotationOrder(R) > 1);
  const axes = new Map<string, { axis: IVec; order: number; R: number[][] }>();
  for (const R of proper) {
    const axis = axisOf(R);
    const key = axis.join(",");
    const order = rotationOrder(R);
    const prev = axes.get(key);
    if (!prev || order > prev.order) axes.set(key, { axis, order, R });
  }
  const all = [...axes.values()];
  const of = (orders: number[]): typeof all => all.filter((a) => orders.includes(a.order));
  const cells: IVec[][] = [];
  const signedTriples = (u: readonly IVec[]): void => {
    for (const perm of [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [1, 0, 2], [2, 1, 0]]) {
      for (let s = 0; s < 8; s++) {
        cells.push(perm.map((p, j) => u[p]!.map((x) => (s & (1 << j) ? -x : x) + 0)));
      }
    }
  };
  const cubic = of([3, 6]).length >= 2;
  if (cubic) {
    const four = of([4]);
    signedTriples((four.length === 3 ? four : of([2])).map((a) => a.axis));
  } else if (of([3, 6]).length === 1) {
    const { axis, R: R0, order } = of([3, 6])[0]!;
    const R3 = order === 6 ? matMul(R0, R0) : R0;
    const R3b = matMul(R3, R3);
    const w = planeOf(R3, 3);
    const area = Math.abs(det3i(columns([w[0]!, w[1]!, axis])));
    for (const a of planeVectors(w)) {
      for (const b of [matVec(R3, a), matVec(R3b, a)]) {
        if (Math.abs(det3i(columns([a, b, axis]))) !== area) continue;
        for (const c of [axis, axis.map((x) => -x + 0)]) cells.push([a, b, c]);
      }
    }
  } else if (of([4]).length === 1) {
    const { axis, R: R4 } = of([4])[0]!;
    const R4c = matMul(matMul(R4, R4), R4);
    const w = planeOf(R4, 4);
    const area = Math.abs(det3i(columns([w[0]!, w[1]!, axis])));
    for (const a of planeVectors(w)) {
      for (const b of [matVec(R4, a), matVec(R4c, a)]) {
        if (Math.abs(det3i(columns([a, b, axis]))) !== area) continue;
        for (const c of [axis, axis.map((x) => -x + 0)]) cells.push([a, b, c]);
      }
    }
  } else if (of([2]).length >= 2) {
    signedTriples(of([2]).slice(0, 3).map((a) => a.axis));
  } else if (of([2]).length === 1) {
    const { axis, R: R2 } = of([2])[0]!;
    const w = planeOf(R2, 2);
    for (let m = -2; m <= 2; m++) for (let n = -2; n <= 2; n++) for (let p = -2; p <= 2; p++) for (let q = -2; q <= 2; q++) {
      if (Math.abs(m * q - n * p) !== 1) continue;
      const a = [0, 1, 2].map((i) => m * w[0]![i]! + n * w[1]![i]!);
      const c = [0, 1, 2].map((i) => p * w[0]![i]! + q * w[1]![i]!);
      for (const b of [axis, axis.map((x) => -x + 0)]) cells.push([a, b, c]);
    }
  } else {
    cells.push([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    // A type-IV triclinic group: its anti-translation (half a lattice vector) on a/2, b/2 or c/2.
    if (minus.length > 0) {
      const t0 = matVec(adjB, minus[0]!).map((v) => v / detB); // in lattice coordinates: half-integers
      const e = primitive(t0.map((v) => Math.round(2 * v)).map((v) => ((v % 2) + 2) % 2));
      for (let j = 0; j < 3; j++) {
        if (e[j] === 0) continue;
        const rest: IVec[] = [0, 1, 2].filter((i) => i !== j).map((i) => [0, 1, 2].map((x) => (x === i ? 1 : 0)));
        for (const slot of [0, 1, 2]) {
          const cols = [...rest];
          cols.splice(slot, 0, e);
          cells.push(cols);
        }
      }
    }
  }
  // Right-handed, then into the group's basis: P = B·C / GRID.
  const out = new Map<string, Mat3>();
  for (const cols of cells) {
    let C = columns(cols);
    const d = det3i(C);
    if (d === 0) continue;
    if (d < 0) C = C.map((row) => [row[0]!, row[1]!, -row[2]! + 0]);
    const P = matMul(B, C).map((row) => row.map((v) => v / GRID)) as unknown as Mat3;
    const key = P.map((row) => row.map((x) => x.toFixed(6)).join(",")).join(";");
    if (!out.has(key)) out.set(key, P);
  }
  // Simplest first, so the setting reported is the plainest that matches: the
  // smallest entries in the group's own basis, then the fewest reversed axes.
  const score = (P: Mat3): number => P.flat().reduce((s, x) => s + Math.abs(x) + (x < 0 ? 0.1 : 0), 0);
  return [...out.values()].sort((a, b) => score(a) - score(b));
}

const SUBSCRIPTS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
};

/**
 * Pretty-print an ASCII BNS/OG symbol for display: screw-axis subscripts
 * ("P2_1'/c'" → "P2₁'/c'"). Roto-inversion bars stay as leading minus signs
 * ("Fm-3m"), matching how nuclear symbols are shown elsewhere in the app.
 */
export function formatMagneticSymbol(symbol: string): string {
  return symbol.replace(/_(\d)/g, (_, d: string) => SUBSCRIPTS[d] ?? d);
}
