/**
 * The order irreps are numbered in, "irrep n of m" at a star and Γ1, Γ2, …
 * on the Γ chip (ADR 0004): a total order the irreps themselves fix, so the
 * numbers are the same on every JavaScript runtime (Node, Chrome, Safari,
 * Linux or macOS) and for every order of the operation list (THY-64).
 *
 *  1. dimension, smallest first;
 *  2. reality: real, then pseudoreal, then complex;
 *  3. the characters on a fixed list of elements, one element after another:
 *     the larger real part first, then the larger imaginary part. Two values
 *     within 1e-6 of each other are equal (a character is a sum of roots of
 *     unity, computed to about 1e-12; distinct ones differ by far more).
 *
 * The list: the rotations W of the little co-group of the star's
 * representative arm k (the conventional basis, integer matrices): the
 * identity, then the proper rotations, then the improper ones, each in
 * row-major lexicographic order of the entries, the smaller entry first
 * ({@link compareRotations}). Each is taken as the element {W|w₀} with w₀ its
 * smallest translation (in [0, 1), lexicographically; factorGroup's
 * pointGroupElements), and the character read is that of the small
 * representation there, exp(2πi k·w₀)·χ_P(W). At Γ that is the point group's
 * own character on each rotation, so the Γ chip (pointGroupIrreps,
 * abelianIrreps) and "Γ irrep n of m" number the irreps alike: Pm-3m's polar
 * irrep is Γ10 and "Γ irrep 10 of 10". Inequivalent irreps of a star have
 * inequivalent small representations, whose characters differ on some element
 * of the list, so no two irreps compare equal. The numbers still depend on
 * the setting (the basis the matrices are written in) and on the arm k, as
 * any table's do (ADR 0004); not on the runtime, the operation list's order,
 * or the supercell bound.
 *
 * Proper rotations first keeps an irrep and its partner of the other parity
 * (g and u) next to each other, as the chain induction (the rotation subgroup,
 * then −1) had them: Pm-3m's Γ and R numbers are those of before.
 *
 * Why not the order the irreps are built in: that order follows the chain
 * induction (projective.ts) and, where an irrep extends in p ways, a
 * principal root of a value on the branch cut (U^p = −1 + 1e-16·i, whose
 * square root is +i or −i by the sign of the rounding error), so it differs
 * between runtimes whose libm differs in the last bit (Fd-3m's X, Cmcm's and
 * P4₂/mnm's zone-boundary irreps swapped under a one-ulp change). The Γ
 * chip's old order compared characters printed to four decimals with
 * localeCompare, where "-0.0000" and "0.0000" (a rounding error's sign)
 * decided between irreps: SrTiO₃'s polar irrep was Γ9 on one machine and Γ10
 * on another.
 */

import type { Complex } from "@/core/math/types";
import type { IMat } from "@/core/crystal/irreps/rational";

/** Two character values within this are equal. */
export const CHARACTER_TOL = 1e-6;

export type IrrepReality = "real" | "pseudoreal" | "complex";

const REALITY_RANK: Record<IrrepReality, number> = { real: 0, pseudoreal: 1, complex: 2 };

/** What an irrep is ordered by: its dimension, reality and characters on the fixed element list. */
export interface IrrepOrderKey {
  readonly dim: number;
  readonly reality: IrrepReality;
  readonly characters: readonly Complex[];
}

const isIdentity = (W: IMat): boolean => W.every((row, i) => row.every((x, j) => x === (i === j ? 1 : 0)));
const det = (W: IMat): number =>
  W[0][0] * (W[1][1] * W[2][2] - W[1][2] * W[2][1]) - W[0][1] * (W[1][0] * W[2][2] - W[1][2] * W[2][0]) + W[0][2] * (W[1][0] * W[2][1] - W[1][1] * W[2][0]);

/** The fixed order of rotations: the identity first, then the proper ones, then the improper ones, each in row-major lexicographic order, the smaller entry first. */
export function compareRotations(a: IMat, b: IMat): number {
  const ia = isIdentity(a);
  const ib = isIdentity(b);
  if (ia !== ib) return ia ? -1 : 1;
  const da = det(a);
  const db = det(b);
  if (da !== db) return db - da;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const d = a[i]![j]! - b[i]![j]!;
      if (d !== 0) return d;
    }
  }
  return 0;
}

/** One character value against another: the larger real part first, then the larger imaginary part (negative: a first). */
export function compareCharacter(a: Complex, b: Complex): number {
  if (Math.abs(a.re - b.re) > CHARACTER_TOL) return b.re - a.re;
  if (Math.abs(a.im - b.im) > CHARACTER_TOL) return b.im - a.im;
  return 0;
}

/** Characters on the fixed list, compared element by element (see the module comment). */
export function compareCharacters(a: readonly Complex[], b: readonly Complex[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = compareCharacter(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** The order of irreps: dimension, reality, characters (the module comment). Negative: a is numbered first. */
export function compareIrreps(a: IrrepOrderKey, b: IrrepOrderKey): number {
  return a.dim - b.dim || REALITY_RANK[a.reality] - REALITY_RANK[b.reality] || compareCharacters(a.characters, b.characters);
}

/**
 * The irreps in that order. Throws when two compare equal: distinct irreps
 * cannot, so a tie means the characters were not read on the right list.
 */
export function orderIrreps<T>(items: readonly T[], key: (item: T) => IrrepOrderKey): T[] {
  const keyed = items.map((item) => ({ item, key: key(item) }));
  keyed.sort((x, y) => compareIrreps(x.key, y.key));
  for (let i = 1; i < keyed.length; i++) {
    if (compareIrreps(keyed[i - 1]!.key, keyed[i]!.key) === 0) throw new Error("irrepOrder: two irreps have the same dimension, reality and characters");
  }
  return keyed.map(({ item }) => item);
}
