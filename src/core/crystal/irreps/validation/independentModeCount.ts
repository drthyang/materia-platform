/**
 * An independent check of the displacive mode basis's dimension (THY-80 B2;
 * test code only, never imported by the app). For every subgroup class H of a
 * supercell bound, the modes the engine builds for the realised child
 * (`supercellModeBasis`, and the refinable set the PDF page makes of them,
 * `irrepModeSet`) are compared with counts that use none of the engine's mode
 * code:
 *
 *  1. Wyckoff splitting, by moyo. The parent's atoms, placed exactly on their
 *     Wyckoff positions and spread over the cell of the bound's core T″ (all
 *     of F acts on it as integer matrices), plus two marker orbits of
 *     generic points under H (the structure then has exactly
 *     H's symmetry; the operation count is checked, as in A3), are given to
 *     moyo (@spglib/moyo-wasm, a dev dependency). moyo's orbits split each
 *     parent orbit into the child's orbits; each child orbit's free
 *     coordinates are counted twice: from moyo's operations, the dimension of
 *     the displacements its stabiliser S fixes, (1/|S|)·Σ_S tr W; and from
 *     moyo's site-symmetry symbol (1 → 3, m → 2, a polar group 2, 3, 4, 6,
 *     mm2, 3m, 4mm, 6mm → 1, any other → 0). Their sum is the dimension the
 *     mode basis must have. The rigid translations H allows (its polar
 *     directions) are (1/|R|)·Σ_R tr R over moyo's distinct rotations.
 *  2. Characters. The displacement representation's character on F = G/T″,
 *     χ(f) = Σ over the atoms modulo T″ that f leaves in place of tr W_f, is
 *     computed here from F's elements (not displacementCharacters). An
 *     irrep Γ's modes in the child must number m_Γ·n_Γ, with m_Γ =
 *     ⟨χ_Γ, χ⟩/⟨χ_Γ, χ_Γ⟩ its copies in the displacement representation and
 *     n_Γ = (1/|H|)·Σ_H χ_Γ(h) the dimension H fixes in one copy. The irreps'
 *     characters are the engine's (the irreps themselves are checked
 *     elsewhere); the count is not.
 *  3. Orthonormality and H-invariance of the engine's fields on the parent's
 *     atoms modulo T″, with an action written here.
 *
 * Gauge. `supercellModeBasis` keeps the rigid translations (one mode per free
 * coordinate). `irrepModeSet`, the set the PDF page refines, uses
 * buildSymmetryModes' "polar" gauge: the translations along H's polar
 * directions are projected out, so it must hold the free coordinates minus
 * the polar dimension, and each irrep loses m_V(Γ)·n_Γ modes, m_V(Γ) the
 * copies of Γ in the vector representation (tr W_f). buildSymmetryModes'
 * default gauge ("sites") instead removes every direction all the child's
 * site representatives allow; where that space is larger than the polar one
 * it drops a real distortion (a known, frozen issue; the PDF page's
 * same-cell t-subgroup route uses it, the supercell route does not). Those
 * classes are counted and listed, not failed.
 */
import { analyze_cell, type MoyoDataset } from "@spglib/moyo-wasm";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import type { StructureModel } from "@/core/crystal/types";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups, SubgroupSearchTooLarge, type SubgroupClass } from "@/core/crystal/irreps/supercellLattice";
import { rnum } from "@/core/crystal/irreps/rational";
import type { SupercellMatrix } from "@/core/crystal/irreps/supercell";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { supercellModeBasis, type SupercellModeBasis } from "@/core/crystal/irreps/supercellModes";
import { irrepModeSet } from "@/core/crystal/irreps/modeSet";
import { buildSymmetryModes } from "@/core/crystal/distortionModes";
import { cartesianCell, initMoyo, rng, seedOf, type ParentCase } from "@/core/crystal/irreps/validation/independentNaming";

type M3 = number[][];
type V3 = number[];
const mul = (A: M3, B: M3): M3 => A.map((r) => [0, 1, 2].map((j) => r[0]! * B[0]![j]! + r[1]! * B[1]![j]! + r[2]! * B[2]![j]!));
const app = (A: M3, v: V3): V3 => A.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
const det = (m: M3): number =>
  m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
function inv(m: M3): M3 {
  const d = det(m);
  const c = (i: number, j: number): number => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const k = [0, 1, 2].filter((x) => x !== j);
    return m[r[0]!]![k[0]!]! * m[r[1]!]![k[1]!]! - m[r[0]!]![k[1]!]! * m[r[1]!]![k[0]!]!;
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (((i + j) % 2 === 0 ? 1 : -1) * c(j, i)) / d));
}
const tr = (m: M3 | readonly (readonly number[])[]): number => m[0]![0]! + m[1]![1]! + m[2]![2]!;
const mod1 = (x: number): number => {
  const f = x - Math.floor(x);
  return Math.abs(f - 1) < 1e-7 || Math.abs(f) < 1e-7 ? 0 : f;
};
const near = (x: number): boolean => Math.abs(x - Math.round(x)) < 1e-6;
const colMajor = (a: readonly number[]): M3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i + 3 * j]!));

/**
 * Free coordinates of a Wyckoff position from its site-symmetry symbol, the
 * dots and 1s of the oriented symbol dropped: 1 → 3; m → 2; a polar point
 * group (one rotation axis, with or without mirrors containing it: 2, 3, 4,
 * 6, mm2, 3m, 4mm, 6mm) → 1; any other (a centre, a rotoinversion, a mirror
 * across an axis, two axes) → 0. Throws on a symbol it does not know.
 */
export function freeFromSiteSymbol(symbol: string): number {
  const s = symbol.replace(/\./g, "");
  if (s === "1" || s === "") return 3;
  if (/[-/]/.test(s)) return 0;
  const body = s.replace(/1/g, "");
  const axes = (body.match(/[2346]/g) ?? []).length;
  const mirrors = (body.match(/m/g) ?? []).length;
  if (axes === 0 && mirrors === 1) return 2;
  if (axes === 0 && mirrors === 3) return 0; // mmm
  if (axes === 1 && mirrors <= 2) return 1;
  if (axes >= 2) return 0;
  throw new Error(`freeFromSiteSymbol: unknown site symmetry "${symbol}"`);
}

/** The lattice T″ of a factor group: membership and reduction (parent fractional coordinates). */
function coreLattice(group: FactorGroup): { readonly contains: (v: V3) => boolean; readonly key: (v: V3) => string; readonly cosets: V3[] } {
  const { core, D } = group.bound;
  // Columns: the basis vectors (rows of the Hermite form over D).
  const B: M3 = [0, 1, 2].map((i) => [0, 1, 2].map((j) => core[j]![i]! / D));
  const Bi = inv(B);
  const contains = (v: V3): boolean => app(Bi, v).every(near);
  const key = (v: V3): string => app(Bi, v).map((c) => Math.round(mod1(c) * 1e6) % 1e6).join(",");
  // ℤ³ modulo T″: integer vectors in a box, one per coset.
  const n = Math.round(Math.abs(det(B)));
  const box = Math.max(...[0, 1, 2].map((i) => core[i]![i]! / D));
  const seen = new Map<string, V3>();
  for (let a = 0; a < box; a++) for (let b = 0; b < box; b++) for (let c = 0; c < box; c++) {
    const v = [a, b, c];
    const k = key(v);
    if (!seen.has(k)) seen.set(k, v);
  }
  const cosets = [...seen.values()];
  if (cosets.length !== n) throw new Error(`coreLattice: ${cosets.length} cosets of T″ in ℤ³, expected ${n}`);
  return { contains, key, cosets };
}

/** A parent site's orbit modulo ℤ³ (the conventional cell, centrings included), from the parent's operations. */
function orbitModZ(structure: StructureModel, x: V3): V3[] {
  const out = new Map<string, V3>();
  for (const op of structure.spaceGroup.operations) {
    const y = app(op.rotation.map((r) => [...r]), x).map((v, k) => mod1(v + op.translation[k]!));
    const key = y.map((v) => Math.round(v * 1e6) % 1e6).join(",");
    if (!out.has(key)) out.set(key, y);
  }
  return [...out.values()];
}

/** One child orbit as moyo sees it. */
export interface ChildOrbit {
  readonly parentSite: string;
  readonly wyckoff: string;
  readonly siteSymmetry: string;
  /** Free coordinates from the stabiliser in moyo's operations. */
  readonly free: number;
  /** Free coordinates from the site-symmetry symbol. */
  readonly freeFromSymbol: number;
  readonly atoms: number;
}

export interface IrrepCount {
  readonly label: string;
  /** Modes of this irrep in supercellModeBasis. */
  readonly engine: number;
  /** m_Γ·n_Γ. */
  readonly expected: number;
  readonly m: number;
  readonly n: number;
  /** Modes of this irrep in irrepModeSet (polar gauge). */
  readonly engineGauged: number;
  /** Copies of Γ in the vector representation: the polar gauge removes mVector·n of its modes. */
  readonly mVector: number;
}

export interface ModeCheck {
  readonly id: number;
  readonly order: number;
  readonly kind: string;
  readonly number: number | null;
  readonly hm: string | null;
  /** supercellModeBasis's mode count (null when the engine threw). */
  readonly engine: number | null;
  /** irrepModeSet's mode count. */
  readonly engineGauged: number | null;
  /** Σ free over the child orbits (moyo). */
  readonly expected: number;
  /** Dimension of H's rigid translations (its polar directions). */
  readonly polar: number;
  /**
   * buildSymmetryModes' default-gauge ("sites") mode count on the realised
   * child, computed where it can differ from the polar gauge's (every child
   * orbit free, H not P1); `expected − polar − sitesGauge` real modes it would
   * drop (the known gauge issue).
   */
  readonly sitesGauge?: number;
  readonly orbits: readonly ChildOrbit[];
  /** By parent site: the engine's modes and the expected count. */
  readonly bySite: readonly { readonly site: string; readonly engine: number; readonly expected: number }[];
  readonly irreps: readonly IrrepCount[];
  /** Largest deviation of the fields' Gram matrix from (N/N_child)·I, relative. */
  readonly orthoError: number;
  /** Largest |D(h)u − u| over h ∈ H and the fields, relative to the field's largest entry. */
  readonly invarianceError: number;
  readonly seed: number;
  readonly ms: number;
  /** Empty when everything agrees. */
  readonly problems: readonly string[];
}

export interface ModeBoundCheck {
  readonly parent: number;
  readonly bound: string;
  readonly classes: readonly ModeCheck[];
  readonly listed: number;
  readonly engineMs: number;
  readonly checkMs: number;
  readonly note?: string;
}

/**
 * A parent structure with every atom exactly on its Wyckoff position, and
 * each site's ITA site symmetry, which moyo must give (the symbol, not the
 * letter: moyo may pick another origin of the same setting, which swaps
 * Fd-3m's 8a and 8b or F-43m's 4c and 4d).
 */
export interface ModeParent extends ParentCase {
  readonly structure: StructureModel;
  readonly siteSymmetry: readonly string[];
}

const site = (label: string, element: string, position: [number, number, number]) => ({ label, element, position, occupancy: 1, adp: { kind: "isotropic" as const, bIso: 0.5 } });
function modeParent(name: string, number: number, symbol: string | undefined, cell: [number, number, number, number, number, number], sites: ReturnType<typeof site>[], siteSymmetry: string[]): ModeParent {
  const [a, b, c, alpha, beta, gamma] = cell;
  return {
    parent: number,
    ...(symbol !== undefined ? { symbol } : {}),
    cart: cartesianCell(a, b, c, alpha, beta, gamma),
    siteSymmetry,
    structure: { id: `b2-${name}`, name, cell: { a, b, c, alpha, beta, gamma }, spaceGroup: buildSpaceGroup(symbol ?? number), sites },
  };
}

/**
 * The twelve parents of THY-80 (the cells of PARENTS in independentNaming.ts),
 * each with two to three orbits on special and free Wyckoff positions, exact.
 * Synthetic structures: the parameters are generic numbers, no data.
 */
export const MODE_PARENTS: Readonly<Record<string, ModeParent>> = {
  "Pm-3m": modeParent("Pm-3m", 221, undefined, [4.0, 4.0, 4.0, 90, 90, 90], [site("A", "Sr", [0, 0, 0]), site("B", "Ti", [0.5, 0.5, 0.5]), site("X", "O", [0, 0.5, 0.5])], ["m-3m", "m-3m", "4/mm.m"]),
  "Fm-3m": modeParent("Fm-3m", 225, undefined, [5.6, 5.6, 5.6, 90, 90, 90], [site("A", "Na", [0, 0, 0]), site("B", "Cl", [0.5, 0.5, 0.5]), site("X", "F", [0.25, 0.25, 0.25])], ["m-3m", "m-3m", "-43m"]),
  "F-43m": modeParent("F-43m", 216, undefined, [5.4, 5.4, 5.4, 90, 90, 90], [site("A", "Ga", [0, 0, 0]), site("B", "As", [0.25, 0.25, 0.25]), site("X", "Li", [0.6, 0.6, 0.6])], ["-43m", "-43m", ".3m"]),
  "Fd-3m": modeParent("Fd-3m", 227, "F d -3 m:2", [8.1, 8.1, 8.1, 90, 90, 90], [site("A", "Mg", [0.125, 0.125, 0.125]), site("B", "Al", [0.5, 0.5, 0.5]), site("X", "O", [0.26, 0.26, 0.26])], ["-43m", ".-3m", ".3m"]),
  "Im-3m": modeParent("Im-3m", 229, undefined, [3.3, 3.3, 3.3, 90, 90, 90], [site("A", "W", [0, 0, 0]), site("X", "O", [0, 0.5, 0.5])], ["m-3m", "4/mm.m"]),
  "P6_3/mmc": modeParent("P6_3/mmc", 194, undefined, [3.2, 3.2, 5.2, 90, 90, 120], [site("A", "Ni", [0, 0, 0]), site("B", "As", [1 / 3, 2 / 3, 0.25]), site("X", "Ge", [1 / 3, 2 / 3, 0.62])], ["-3m.", "-6m2", "3m."]),
  "R-3m": modeParent("R-3m", 166, "R -3 m:H", [3.0, 3.0, 14.0, 90, 90, 120], [site("A", "Te", [0, 0, 0]), site("B", "Bi", [0, 0, 0.4]), site("X", "Se", [0, 0, 0.21])], ["-3m", "3m", "3m"]),
  "I4/mmm": modeParent("I4/mmm", 139, undefined, [3.9, 3.9, 12.7, 90, 90, 90], [site("A", "Ba", [0, 0, 0]), site("B", "Fe", [0, 0.5, 0.25]), site("X", "As", [0, 0, 0.35])], ["4/mmm", "-4m2", "4mm"]),
  "P4/mmm": modeParent("P4/mmm", 123, undefined, [3.9, 3.9, 4.4, 90, 90, 90], [site("A", "Ca", [0, 0, 0]), site("B", "Ti", [0.5, 0.5, 0.5]), site("X", "O", [0, 0.5, 0])], ["4/mmm", "4/mmm", "mmm."]),
  Pnma: modeParent("Pnma", 62, undefined, [5.5, 7.6, 5.3, 90, 90, 90], [site("A", "Gd", [0.06, 0.25, 0.49]), site("B", "Fe", [0, 0, 0.5]), site("X", "O", [0.3, 0.05, 0.7])], [".m.", "-1", "1"]),
  Cmcm: modeParent("Cmcm", 63, undefined, [3.1, 10.3, 4.2, 90, 90, 90], [site("A", "Re", [0, 0, 0]), site("B", "B", [0, 0.36, 0.25]), site("X", "O", [0, 0.13, 0.06])], ["2/m..", "m2m", "m.."]),
  "P2_1/c": modeParent("P2_1/c", 14, undefined, [5.1, 6.2, 7.3, 90, 101, 90], [site("A", "Fe", [0, 0, 0]), site("X", "O", [0.2, 0.3, 0.1])], ["-1", "1"]),
};

/** moyo's space group, Wyckoff letters and site symmetries of a parent structure alone (its conventional cell). */
export function parentWyckoff(mp: ModeParent): { number: number; letters: string[]; siteSymmetry: string[] } {
  initMoyo();
  const s = mp.structure;
  const atoms = s.sites.flatMap((x, i) => orbitModZ(s, [...x.position]).map((f) => ({ f, z: i + 1, i })));
  const A = mp.cart;
  const d = analyze_cell(JSON.stringify({ lattice: { basis: [0, 1, 2].flatMap((j) => [A[0]![j]!, A[1]![j]!, A[2]![j]!]) }, positions: atoms.map((a) => a.f), numbers: atoms.map((a) => a.z) }), 1e-4, "Standard");
  const first = s.sites.map((_, i) => atoms.findIndex((a) => a.i === i));
  return { number: d.number, letters: first.map((k) => d.wyckoffs[k]!), siteSymmetry: first.map((k) => d.site_symmetry_symbols[k]!) };
}

/**
 * Check one class (see the module comment). `P` is the bound's supercell
 * (columns in the parent's basis).
 */
export function checkModes(
  mp: ModeParent,
  group: FactorGroup,
  cls: SubgroupClass,
  label: string,
  opts: {
    readonly symprec?: number;
    /** Negative controls only: a change made to the engine's basis before it is checked. */
    readonly tamper?: (basis: SupercellModeBasis) => SupercellModeBasis;
  } = {},
): ModeCheck {
  initMoyo();
  const symprec = opts.symprec ?? 1e-4;
  const t0 = Date.now();
  const parent = mp.structure;
  const problems: string[] = [];
  // The cell is T″, the bound's point-group core: every element of F is an
  // integer matrix in its basis, so moyo, which keeps only the operations
  // that map the input lattice onto itself, sees all of H. (In T′ it would
  // miss H's rotations that do not keep T′, a 3-fold in a 1×1×2 cell.)
  const { core, D } = group.bound;
  const C: M3 = [0, 1, 2].map((i) => [0, 1, 2].map((j) => core[j]![i]! / D));
  const Cinv = inv(C);
  const A = mul(mp.cart, C);
  const seed = seedOf(`${label}#${cls.id}`);
  const random = rng(seed);
  const H = cls.elements.map((i) => {
    const e = group.elements[i]!;
    return { W: e.W.map((r) => [...r]), w: e.w.map(rnum) };
  });

  // ── 1. the oracle structure: the parent's atoms in T″ and two marker orbits of H ──
  const key = (f: V3): string => f.map((v) => Math.round(mod1(v) * 1e6) % 1e6).join(",");
  const sites: { f: V3; z: number }[] = [];
  // The parent cells that can reach into the T″ cell: the bounding box of its corners.
  const corners: V3[] = [];
  for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) corners.push(app(C, [i, j, k]));
  const box = [0, 1, 2].map((i) => [Math.min(...corners.map((v) => v[i]!)), Math.max(...corners.map((v) => v[i]!))]);
  parent.sites.forEach((s, si) => {
    const seen = new Set<string>();
    for (const x of orbitModZ(parent, [...s.position])) {
      for (let a = Math.floor(box[0]![0]!) - 1; a <= Math.ceil(box[0]![1]!); a++) for (let b = Math.floor(box[1]![0]!) - 1; b <= Math.ceil(box[1]![1]!); b++) for (let c = Math.floor(box[2]![0]!) - 1; c <= Math.ceil(box[2]![1]!); c++) {
        const f = app(Cinv, [x[0]! + a, x[1]! + b, x[2]! + c]).map(mod1);
        const k = key(f);
        if (seen.has(k)) continue;
        seen.add(k);
        sites.push({ f, z: si + 1 });
      }
    }
  });
  const nParent = sites.length;
  const expectedAtoms = parent.sites.reduce((t, s) => t + orbitModZ(parent, [...s.position]).length, 0) * Math.round(Math.abs(det(C)));
  if (nParent !== expectedAtoms) problems.push(`oracle: ${nParent} parent atoms in T″, expected ${expectedAtoms}`);
  const orbitH = (x: V3): V3[] => {
    const seen = new Map<string, V3>();
    for (const { W, w } of H) {
      const f = app(Cinv, app(W, x).map((v, k) => v + w[k]!)).map(mod1);
      const k = key(f);
      if (!seen.has(k)) seen.set(k, f);
    }
    return [...seen.values()];
  };
  const generic = (): V3 => [0.05 + 0.9 * random(), 0.05 + 0.9 * random(), 0.05 + 0.9 * random()];
  for (const z of [101, 102]) for (const f of orbitH(generic())) sites.push({ f, z });
  const d: MoyoDataset = analyze_cell(JSON.stringify({ lattice: { basis: [0, 1, 2].flatMap((j) => [A[0]![j]!, A[1]![j]!, A[2]![j]!]) }, positions: sites.map((x) => x.f), numbers: sites.map((x) => x.z) }), symprec, "Standard");
  const modT = new Set(
    H.map(({ W, w }) => ({ W: mul(Cinv, mul(W, C)), w: app(Cinv, w) }))
      .filter(({ W }) => W.flat().every(near))
      .map(({ W, w }) => `${W.flat().map(Math.round).join(",")}|${key(w)}`),
  );
  if (modT.size !== H.length) problems.push(`oracle: ${H.length - modT.size} of H's elements are not integer matrices in T″`);
  if (d.operations.length !== modT.size) problems.push(`oracle: moyo finds ${d.operations.length} operations, H has ${modT.size} modulo T″ (seed ${seed})`);
  const ops = d.operations.map((o) => ({ W: colMajor(o.rotation), w: [...o.translation] }));

  // Child orbits of the parent's atoms, their free coordinates two ways.
  const orbits: ChildOrbit[] = [];
  const repOf = new Map<number, number>();
  for (let i = 0; i < nParent; i++) {
    const r = d.orbits[i]!;
    if (r >= nParent) problems.push(`oracle: parent atom ${i} in an orbit with a marker`);
    repOf.set(r, (repOf.get(r) ?? 0) + 1);
  }
  for (const [r, count] of repOf) {
    const x = sites[r]!.f;
    const stab = ops.filter(({ W, w }) => app(W, x).every((v, k) => near(v + w[k]! - x[k]!)));
    const free = stab.reduce((t, { W }) => t + tr(W), 0) / stab.length;
    if (!near(free)) problems.push(`oracle: a non-integer fixed dimension ${free}`);
    const sym = d.site_symmetry_symbols[r]!;
    let fromSymbol = -1;
    try {
      fromSymbol = freeFromSiteSymbol(sym);
    } catch (e) {
      problems.push(`oracle: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (fromSymbol !== Math.round(free)) problems.push(`oracle: site symmetry "${sym}" gives ${fromSymbol} free coordinates, the stabiliser ${Math.round(free)}`);
    orbits.push({ parentSite: parent.sites[sites[r]!.z - 1]!.label, wyckoff: d.wyckoffs[r]!, siteSymmetry: sym, free: Math.round(free), freeFromSymbol: fromSymbol, atoms: count });
  }
  const expected = orbits.reduce((t, o) => t + o.free, 0);
  const rotations = new Map<string, M3>();
  for (const { W } of ops) rotations.set(W.flat().join(","), W);
  const polarRaw = [...rotations.values()].reduce((t, W) => t + tr(W), 0) / rotations.size;
  if (!near(polarRaw)) problems.push(`oracle: a non-integer polar dimension ${polarRaw}`);
  const polar = Math.round(polarRaw);

  // ── 2. the engine ──
  let engine: number | null = null;
  let engineGauged: number | null = null;
  let sitesGauge: number | undefined;
  const bySite: { site: string; engine: number; expected: number }[] = [];
  const irreps: IrrepCount[] = [];
  let orthoError = 0;
  let invarianceError = 0;
  try {
    const realised = realiseChild(parent, group, cls.elements, cls.identity ?? undefined);
    const built = supercellModeBasis(parent, group, cls.elements, realised, { arms: "bound" });
    const basis = opts.tamper ? opts.tamper(built) : built;
    engine = basis.modes.length;
    // The PDF page's set; on its own, so a failure here leaves the other checks standing.
    let gauged: ReturnType<typeof irrepModeSet> | null = null;
    try {
      gauged = irrepModeSet(parent, realised, basis);
      engineGauged = gauged.modes.length;
    } catch (e) {
      problems.push(`engine (irrepModeSet): ${e instanceof Error ? e.message : String(e)}`);
    }
    if (polar < 3 && orbits.every((o) => o.free > 0)) {
      // The known gauge issue: the default gauge removes every direction each
      // child site's representative allows (which depends on the
      // representatives), the polar one only H's translations. It can only
      // remove more, never less: a polar direction is allowed at every site.
      sitesGauge = buildSymmetryModes(realised.structure).modes.length;
      if (sitesGauge > expected - polar) problems.push(`default gauge: buildSymmetryModes keeps ${sitesGauge} modes, more than the ${expected} − ${polar} without H's translations`);
    }

    for (const s of parent.sites) {
      bySite.push({ site: s.label, engine: basis.modes.filter((m) => m.parentSite === s.label).length, expected: orbits.filter((o) => o.parentSite === s.label).reduce((t, o) => t + o.free, 0) });
    }

    // The atoms modulo T″ (the engine's list, checked against our own count) and F's action on them.
    const lat = coreLattice(group);
    const core = basis.core.positions.map((x) => [...x]);
    const coreSite = basis.core.sites;
    const N = core.length;
    const ownN = parent.sites.reduce((t, s) => t + orbitModZ(parent, [...s.position]).length, 0) * lat.cosets.length;
    if (N !== ownN) problems.push(`core: the engine lists ${N} atoms modulo T″, expected ${ownN}`);
    const index = new Map<string, number>();
    core.forEach((x, a) => index.set(`${coreSite[a]}|${lat.key(x)}`, a));
    const F = group.elements.length;
    const permOf = (f: number): Int32Array => {
      const e = group.elements[f]!;
      const w = e.w.map(rnum);
      const p = new Int32Array(N);
      for (let a = 0; a < N; a++) {
        const y = app(e.W.map((r) => [...r]), core[a]!).map((v, k) => v + w[k]!);
        const b = index.get(`${coreSite[a]}|${lat.key(y)}`);
        if (b === undefined) throw new Error(`core: element ${f} takes atom ${a} off the parent's atoms`);
        p[a] = b;
      }
      return p;
    };
    // χ of the displacement and the vector representations.
    const chi = new Float64Array(F);
    const chiV = new Float64Array(F);
    const perms: Int32Array[] = [];
    for (let f = 0; f < F; f++) {
      const p = permOf(f);
      perms.push(p);
      const t = tr(group.elements[f]!.W);
      let fixed = 0;
      for (let a = 0; a < N; a++) if (p[a] === a) fixed++;
      chi[f] = fixed * t;
      chiV[f] = t;
    }
    let sumExpected = 0;
    let sumGaugeDrop = 0;
    basis.irreps.forEach((ir) => {
      let pp = 0;
      let pd = 0;
      let pv = 0;
      for (let f = 0; f < F; f++) {
        pp += ir.characters[f]! * ir.characters[f]!;
        pd += ir.characters[f]! * chi[f]!;
        pv += ir.characters[f]! * chiV[f]!;
      }
      const nH = cls.elements.reduce((t, h) => t + ir.characters[h]!, 0) / cls.elements.length;
      const m = pd / pp;
      const mV = pv / pp;
      if (!near(m) || !near(nH) || !near(mV)) problems.push(`characters: ${ir.label} has m = ${m}, n = ${nH}, m_V = ${mV} (not integers)`);
      const exp = Math.round(m) * Math.round(nH);
      sumExpected += exp;
      sumGaugeDrop += Math.round(mV) * Math.round(nH);
      const gaugedCount = gauged ? gauged.modes.filter((mode) => mode.irrep?.label === ir.label).length : -1;
      irreps.push({ label: ir.label, engine: ir.modes.length, expected: exp, m: Math.round(m), n: Math.round(nH), engineGauged: gaugedCount, mVector: Math.round(mV) });
    });
    if (sumGaugeDrop !== polar) problems.push(`characters: the irreps listed carry ${sumGaugeDrop} translation dimensions, H allows ${polar}`);
    if (sumExpected !== expected) problems.push(`characters: Σ m·n over the irreps listed is ${sumExpected}, the Wyckoff count ${expected}`);
    for (const ir of irreps) {
      if (ir.engine !== ir.expected) problems.push(`irrep ${ir.label}: ${ir.engine} modes, m·n = ${ir.m}·${ir.n} = ${ir.expected}`);
      if (gauged && ir.engineGauged !== ir.engine - ir.mVector * ir.n) problems.push(`irrep ${ir.label} (polar gauge): ${ir.engineGauged} modes, expected ${ir.engine} − ${ir.mVector}·${ir.n}`);
    }

    // ── 3. orthonormality and H-invariance of the fields ──
    const Gm = (() => {
      const c = parent.cell;
      const r = Math.PI / 180;
      const [ca, cb, cg] = [Math.cos(c.alpha * r), Math.cos(c.beta * r), Math.cos(c.gamma * r)];
      return [[c.a * c.a, c.a * c.b * cg, c.a * c.c * cb], [c.a * c.b * cg, c.b * c.b, c.b * c.c * ca], [c.a * c.c * cb, c.b * c.c * ca, c.c * c.c]];
    })();
    const fields = basis.fields;
    const scale = N / realised.atoms.length;
    const Gu = fields.map((u) => {
      const out = new Float64Array(3 * N);
      for (let a = 0; a < N; a++) for (let i = 0; i < 3; i++) out[3 * a + i] = Gm[i]![0]! * u[3 * a]! + Gm[i]![1]! * u[3 * a + 1]! + Gm[i]![2]! * u[3 * a + 2]!;
      return out;
    });
    for (let i = 0; i < fields.length; i++) {
      const gi = Gu[i]!;
      for (let j = i; j < fields.length; j++) {
        const uj = fields[j]!;
        let s = 0;
        for (let k = 0; k < 3 * N; k++) s += gi[k]! * uj[k]!;
        orthoError = Math.max(orthoError, Math.abs(s / scale - (i === j ? 1 : 0)));
      }
    }
    if (orthoError > 1e-8) problems.push(`orthonormality: Gram deviates by ${orthoError.toExponential(2)}`);
    const v = new Float64Array(3 * N);
    for (const h of cls.elements) {
      const W = group.elements[h]!.W;
      const p = perms[h]!;
      for (const u of fields) {
        v.fill(0);
        let big = 0;
        for (let a = 0; a < N; a++) {
          const b = p[a]!;
          for (let i = 0; i < 3; i++) v[3 * b + i] = W[i]![0]! * u[3 * a]! + W[i]![1]! * u[3 * a + 1]! + W[i]![2]! * u[3 * a + 2]!;
          big = Math.max(big, Math.abs(u[3 * a]!), Math.abs(u[3 * a + 1]!), Math.abs(u[3 * a + 2]!));
        }
        for (let k = 0; k < 3 * N; k++) invarianceError = Math.max(invarianceError, Math.abs(v[k]! - u[k]!) / big);
      }
    }
    if (invarianceError > 1e-8) problems.push(`H-invariance: a field moves by ${invarianceError.toExponential(2)} under H`);
  } catch (e) {
    problems.push(`engine: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (engine !== null && engine !== expected) {
    const differ = bySite.filter((s) => s.engine !== s.expected).map((s) => `${s.site} ${s.engine} vs ${s.expected}`);
    problems.push(`dimension: supercellModeBasis ${engine}, Wyckoff count ${expected} (by parent site: ${differ.join(", ") || "none differ"})`);
  }
  if (engineGauged !== null && engineGauged !== expected - polar) problems.push(`dimension (polar gauge): irrepModeSet ${engineGauged}, expected ${expected} − ${polar} = ${expected - polar}`);
  return {
    id: cls.id,
    order: cls.order,
    kind: cls.kind,
    number: cls.identity?.number ?? null,
    hm: cls.identity?.hermannMauguin ?? null,
    engine,
    engineGauged,
    expected,
    polar,
    ...(sitesGauge !== undefined ? { sitesGauge } : {}),
    orbits,
    bySite,
    irreps,
    orthoError,
    invarianceError,
    seed,
    ms: Date.now() - t0,
    problems,
  };
}

/** Every class of one (parent, bound); stops between classes once `deadline` passes and says so in `note`. */
export function checkModeBound(name: string, boundName: string, P: SupercellMatrix, deadline = Number.POSITIVE_INFINITY): ModeBoundCheck {
  const mp = MODE_PARENTS[name]!;
  const t0 = Date.now();
  const group = factorGroup(mp.structure.spaceGroup.operations, P);
  let classes: readonly SubgroupClass[];
  try {
    classes = supercellSubgroups(group).classes;
  } catch (e) {
    if (e instanceof SubgroupSearchTooLarge) return { parent: mp.parent, bound: boundName, classes: [], note: `engine refused: ${e.message}`, listed: 0, engineMs: Date.now() - t0, checkMs: 0 };
    throw e;
  }
  const t1 = Date.now();
  const out: ModeCheck[] = [];
  let note: string | undefined;
  for (const cls of classes) {
    if (Date.now() > deadline) {
      note = `stopped at the time limit after ${out.length} of ${classes.length} classes`;
      break;
    }
    out.push(checkModes(mp, group, cls, `${name}|${boundName}`));
  }
  return { parent: mp.parent, bound: boundName, classes: out, listed: classes.length, engineMs: t1 - t0, checkMs: Date.now() - t1, ...(note ? { note } : {}) };
}

/** One line per mismatching class. */
export function modeFindings(b: ModeBoundCheck): string[] {
  return b.classes
    .filter((c) => c.problems.length > 0)
    .map((c) => `#${b.parent} ${b.bound} class ${c.id} (#${c.number ?? "?"} ${c.hm ?? ""}, order ${c.order}, ${c.kind}; polar ${c.polar}): ${c.problems.join("; ")} | orbits ${c.orbits.map((o) => `${o.parentSite}→${o.wyckoff}(${o.siteSymmetry}):${o.free}`).join(" ")} | seed ${c.seed}`);
}

/** The classes where buildSymmetryModes' default gauge would remove more than the rigid translations (the known frozen issue). */
export function gaugeGaps(b: ModeBoundCheck): string[] {
  return b.classes
    .filter((c) => c.sitesGauge !== undefined && c.sitesGauge < c.expected - c.polar)
    .map((c) => `#${b.parent} ${b.bound} class ${c.id} (#${c.number ?? "?"} ${c.hm ?? ""}, polar ${c.polar}): the default gauge keeps ${c.sitesGauge} modes, the polar gauge ${c.engineGauged ?? "?"} of ${c.expected}; ${c.expected - c.polar - c.sitesGauge!} real mode(s) dropped`);
}
