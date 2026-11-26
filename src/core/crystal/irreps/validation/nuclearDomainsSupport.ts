/**
 * Domain equivalence of nuclear subgroup children (THY-80 item C2): every
 * domain of a child H of a parent G must give the same powder pattern and the
 * same PDF. The test harness for nuclearDomains*.test.ts; test code only,
 * nothing of the app imports it.
 *
 * How the domains are made, through the engine's own path:
 *
 *  - the factor group F = G/T″ of the bound (factorGroup) and the class of H
 *    from the subgroup lattice the Subgroups view and list_subgroups list
 *    (supercellSubgroups);
 *  - the domain states are the cosets gH of F/H, [G : H] of them
 *    (orientation states × translation states); for each coset
 *    representative g the domain's subgroup is the conjugate gHg⁻¹ (from F's
 *    multiplication table), realised in its own ITA setting by the engine
 *    (realiseChild, with the child basis nameChild picks for that conjugate,
 *    not one derived from g), with its own mode basis (supercellModeBasis);
 *  - the distortion: random amplitudes (seeded) on every displacive mode of H
 *    (supercellModeBasis), the field u = Σ ηᵢ·fieldᵢ on the parent's atoms
 *    modulo T″; the domain's field is g·u (the atom at x carried to g·x, its
 *    displacement turned by W_g: atomAction, F's own permutation of the
 *    atoms). Its amplitudes on the conjugate's modes are found by least
 *    squares; the residual says whether the conjugate's modes span it;
 *  - the domain's structure is the conjugate's realised child with each
 *    site's representative moved by g·u at its parent atom;
 *  - a spontaneous strain: a random symmetric strain averaged over H's
 *    rotations (so H keeps it), carried to domain g as the metric
 *    W⁻ᵀ·G_s·W⁻¹ of the parent's axes, and to each child as Pᵀ·G·P.
 *    Fractional coordinates do not change under it; anisotropic ADPs keep
 *    their fractional covariance.
 *
 * The identity coset is also built through the engine's mode set, as the PDF
 * page builds it (irrepModeSet), its amplitudes read off the field-built
 * child by the engine's interpolation (positionShiftValuesFor), and applied
 * (applyParameters): its child must be the field-built one, up to a rigid
 * translation (the polar gauge drops it), with the same observables.
 *
 * Then, for every domain: the powder lines (generateReflections × |F|², by d,
 * neutron and X-ray), the calculated constant-wavelength neutron profile
 * (buildStructureRefinement + powderCurves, the Rietveld engine's curve) and
 * G(r) (computeGofR on expandStructureAtoms, neutron and X-ray), each against
 * the identity domain's.
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { StructureModel, UnitCell } from "@/core/crystal/types";
import type { PowderPattern, Radiation } from "@/core/diffraction/types";
import { inverse, mulMat, mulVec, transpose } from "@/core/math/mat3";
import { metricTensor, orthogonalizationMatrix, reciprocalMetricTensor } from "@/core/crystal/unitCell";
import { cellFromMetric } from "@/core/crystal/settings";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups, type SubgroupClass, type SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import type { SupercellMatrix } from "@/core/crystal/irreps/supercell";
import { realiseChild, type RealisedChild } from "@/core/crystal/irreps/realisation";
import { atomAction, coreCell, supercellModeBasis, type CoreCell, type SupercellModeBasis } from "@/core/crystal/irreps/supercellModes";
import { irrepModeSet } from "@/core/crystal/irreps/modeSet";
import { positionShiftValuesFor } from "@/core/crystal/distortionModes";
import { applyParameters } from "@/core/workflow/apply";
import { generateReflections } from "@/core/diffraction/reflections";
import { expandStructureAtoms, nuclearStructureFactorSquared } from "@/core/diffraction/structureFactor";
import { buildStructureRefinement } from "@/core/workflow/structureRefinement";
import { powderCurves } from "@/core/workflow/powder";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";

// ── a seeded generator ───────────────────────────────────────────────────────

/** mulberry32: a small seeded uniform generator in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── the case ─────────────────────────────────────────────────────────────────

export interface DomainCase {
  readonly name: string;
  readonly parent: StructureModel;
  readonly bound: SupercellMatrix;
  /** IT number of the child's type, for the label and a check. */
  readonly number: number;
  /** Picks the class among those of that type (in the lattice's order). */
  readonly pick: (cls: SubgroupClass, ctx: PickContext) => boolean;
  /** Smallest d of the powder lines (Å). */
  readonly dMin: number;
  /** PDF grid end (Å). */
  readonly rMax: number;
}

/** What a pick may look at: the class realised at the parent's geometry, and its modes (worked out on demand). */
export interface PickContext {
  readonly parent: StructureModel;
  readonly group: FactorGroup;
  readonly realised: RealisedChild;
  basis(): SupercellModeBasis;
}

export interface Prepared {
  readonly c: DomainCase;
  readonly group: FactorGroup;
  readonly cls: SubgroupClass;
  readonly cell: CoreCell;
  readonly perm: Int32Array;
}

const lattices = new Map<string, { group: FactorGroup; lattice: SupercellLattice }>();

/** The factor group and the class of the case's child, through the subgroup lattice. */
export function prepare(c: DomainCase): Prepared {
  // The lattice depends on the operations and the bound only.
  const key = `${JSON.stringify(c.parent.spaceGroup.operations.map((o) => o.xyz))}|${JSON.stringify(c.bound)}`;
  let hit = lattices.get(key);
  if (!hit) {
    const group = factorGroup(c.parent.spaceGroup.operations, c.bound);
    // Every case's child has index ≤ 24.
    hit = { group, lattice: supercellSubgroups(group, { maxIndex: 24 }) };
    lattices.set(key, hit);
  }
  const { group, lattice } = hit;
  const cls = lattice.classes.find((x) => {
    if (x.identity?.number !== c.number) return false;
    const realised = realiseChild(c.parent, group, x.elements, x.identity);
    return c.pick(x, { parent: c.parent, group, realised, basis: () => supercellModeBasis(c.parent, group, x.elements, realised) });
  });
  if (!cls) throw new Error(`${c.name}: no class of type ${c.number} passes the pick`);
  const cell = coreCell(c.parent, group);
  return { c, group, cls, cell, perm: atomAction(group, cell) };
}

// ── F's cosets and conjugates ────────────────────────────────────────────────

/** One representative per coset gH of F/H, the identity first. */
export function cosetRepresentatives(group: FactorGroup, H: readonly number[]): number[] {
  const covered = new Uint8Array(group.elements.length);
  const reps: number[] = [];
  const order = [group.identity, ...group.elements.map((_, i) => i).filter((i) => i !== group.identity)];
  for (const g of order) {
    if (covered[g]) continue;
    reps.push(g);
    for (const h of H) covered[group.table[g]![h]!] = 1;
  }
  return reps;
}

/** gHg⁻¹, ascending. */
export function conjugate(group: FactorGroup, g: number, H: readonly number[]): number[] {
  const gi = group.inverse[g]!;
  return H.map((h) => group.table[group.table[g]![h]!]![gi]!).sort((a, b) => a - b);
}

// ── fields on the parent's atoms modulo T″ ───────────────────────────────────

/** g·u: the displacement at atom a turned by W_g and moved to g·a (F's own action on the atoms). */
export function carryField(p: Prepared, g: number, u: Float64Array): Float64Array {
  const N = p.cell.positions.length;
  const W = p.group.elements[g]!.W;
  const out = new Float64Array(3 * N);
  for (let a = 0; a < N; a++) {
    const b = p.perm[g * N + a]!;
    for (let i = 0; i < 3; i++) out[3 * b + i] = W[i]![0]! * u[3 * a]! + W[i]![1]! * u[3 * a + 1]! + W[i]![2]! * u[3 * a + 2]!;
  }
  return out;
}

/** Σ ηᵢ·fieldᵢ. */
export function fieldOf(basis: SupercellModeBasis, eta: readonly number[]): Float64Array {
  const n = basis.fields[0]?.length ?? 0;
  const u = new Float64Array(n);
  basis.fields.forEach((f, i) => {
    const e = eta[i]!;
    for (let j = 0; j < n; j++) u[j] = u[j]! + e * f[j]!;
  });
  return u;
}

/** Least-squares amplitudes of v on the basis's fields (Cartesian metric of the parent), and the relative residual. */
export function project(basis: SupercellModeBasis, G: Mat3, v: Float64Array): { readonly eta: number[]; readonly residual: number } {
  const N = v.length / 3;
  const dot = (x: Float64Array, y: Float64Array): number => {
    let s = 0;
    for (let a = 0; a < N; a++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += x[3 * a + i]! * G[i]![j]! * y[3 * a + j]!;
    return s;
  };
  const f = basis.fields;
  const n = f.length;
  const A = f.map((fi) => f.map((fj) => dot(fi, fj)));
  const b = f.map((fi) => dot(fi, v));
  // Gaussian elimination with partial pivoting.
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-14) throw new Error("project: the modes are linearly dependent");
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const k = M[r]![col]! / d;
      if (k !== 0) for (let j = col; j <= n; j++) M[r]![j] = M[r]![j]! - k * M[col]![j]!;
    }
  }
  const eta = M.map((row, i) => row[n]! / row[i]!);
  const rebuilt = fieldOf(basis, eta);
  const diff = new Float64Array(v.length);
  for (let j = 0; j < v.length; j++) diff[j] = v[j]! - rebuilt[j]!;
  const vv = dot(v, v);
  return { eta, residual: vv > 0 ? Math.sqrt(dot(diff, diff) / vv) : 0 };
}

// ── the domain's structure ───────────────────────────────────────────────────

const reciprocalLengths = (cell: UnitCell): Vec3 => {
  const g = reciprocalMetricTensor(cell);
  return [Math.sqrt(g[0][0]), Math.sqrt(g[1][1]), Math.sqrt(g[2][2])];
};

/**
 * A realised child moved by the field v (parent fractional, on the atoms
 * modulo T″), in the cell of the parent metric `Gparent`: each site's
 * representative by v at its parent atom, taken to the child's axes.
 */
export function childWithField(p: Prepared, r: RealisedChild, v: Float64Array, Gparent: Mat3): StructureModel {
  const P = r.basis;
  const Pinv = inverse(P);
  const parentIndex = new Map(p.c.parent.sites.map((s, i) => [s.label, i] as const));
  const sites = r.structure.sites.map((s, i) => {
    const origin = r.sites[i]!;
    if (origin.label !== s.label) throw new Error("childWithField: the realisation's sites are out of order");
    const y = mulVec(P, s.position);
    const a = p.cell.find([y[0] + r.origin[0], y[1] + r.origin[1], y[2] + r.origin[2]], parentIndex.get(origin.parentSite)!);
    if (a < 0) throw new Error(`childWithField: ${s.label} is on no parent atom`);
    const d = mulVec(Pinv, [v[3 * a]!, v[3 * a + 1]!, v[3 * a + 2]!]);
    return { ...s, position: [s.position[0] + d[0], s.position[1] + d[1], s.position[2] + d[2]] as Vec3 };
  });
  const cell = cellFromMetric(mulMat(transpose(P), mulMat(Gparent, P)));
  const m0 = reciprocalLengths(r.structure.cell);
  const m1 = reciprocalLengths(cell);
  return {
    ...r.structure,
    cell,
    sites: sites.map((s) => {
      if (s.adp.kind !== "anisotropic") return s;
      // The same fractional covariance in the strained cell.
      const [u11, u22, u33, u12, u13, u23] = s.adp.uAniso;
      const k = (i: number, j: number): number => (m0[i]! * m0[j]!) / (m1[i]! * m1[j]!);
      return { ...s, adp: { kind: "anisotropic" as const, uAniso: [u11 * k(0, 0), u22 * k(1, 1), u33 * k(2, 2), u12 * k(0, 1), u13 * k(0, 2), u23 * k(1, 2)] as const } };
    }),
  };
}

/** A random symmetric strain (Cartesian, amplitude `size`) averaged over H's rotations: the parent's metric H keeps. */
export function strainedMetric(p: Prepared, H: readonly number[], next: () => number, size: number): Mat3 {
  const A = orthogonalizationMatrix(p.c.parent.cell);
  const e = [0, 1, 2].map(() => [0, 0, 0]);
  for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) e[i]![j] = e[j]![i] = size * (2 * next() - 1);
  const F = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + e[i]![j]!)) as unknown as Mat3;
  const FA = mulMat(F, A);
  const G0 = mulMat(transpose(FA), FA);
  const seen = new Set<string>();
  const sum: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let count = 0;
  for (const h of H) {
    const W = p.group.elements[h]!.W as unknown as Mat3;
    const key = JSON.stringify(W);
    if (seen.has(key)) continue;
    seen.add(key);
    const t = mulMat(transpose(W), mulMat(G0, W));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) sum[i]![j] = sum[i]![j]! + t[i]![j]!;
    count++;
  }
  return sum.map((r) => r.map((x) => x / count)) as unknown as Mat3;
}

/** The parent's metric in domain g: W⁻ᵀ·G_s·W⁻¹. */
export function domainMetric(p: Prepared, g: number, Gs: Mat3): Mat3 {
  const Wi = inverse(p.group.elements[g]!.W as unknown as Mat3);
  return mulMat(transpose(Wi), mulMat(Gs, Wi));
}

// ── what a powder and a PDF see ──────────────────────────────────────────────

export interface Line {
  readonly d: number;
  readonly squared: number;
}

/** Lines closer in d than this (relative) are one powder peak. */
const D_TOL = 1e-9;

/** The powder lines, multiplicity × |F|², summed by d. */
export function powderLines(s: StructureModel, radiation: Radiation, dMin: number): Line[] {
  const refl = generateReflections(s.cell, s.spaceGroup, dMin, 50);
  const lines = refl.map((x) => ({ d: x.d, squared: x.multiplicity * nuclearStructureFactorSquared(s, radiation, x.h, x.k, x.l) }));
  lines.sort((a, b) => a.d - b.d);
  const out: { d: number; squared: number }[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && Math.abs(l.d - last.d) <= D_TOL * l.d) last.squared += l.squared;
    else out.push({ d: l.d, squared: l.squared });
  }
  return out;
}

/**
 * The worst difference between two line lists: each line against its own
 * intensity, floored at `floor`·the strongest; a line in one list and not the
 * other (above the floor) is Infinity.
 */
export function lineDifference(a: readonly Line[], b: readonly Line[], floor = 1e-9): number {
  const max = Math.max(...a.map((x) => x.squared), ...b.map((x) => x.squared));
  const na = a.filter((x) => x.squared > floor * max);
  const nb = b.filter((x) => x.squared > floor * max);
  if (na.length !== nb.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < na.length; i++) {
    if (Math.abs(na[i]!.d - nb[i]!.d) > D_TOL * na[i]!.d) return Infinity;
    worst = Math.max(worst, Math.abs(na[i]!.squared - nb[i]!.squared) / Math.max(na[i]!.squared, floor * max));
  }
  return worst;
}

const NEUTRON: Radiation = { kind: "neutron", wavelength: 1.54 };
const XRAY: Radiation = { kind: "xray", wavelength: 0.7107 };

const PROFILE_GRID = Array.from({ length: 3001 }, (_, i) => 10 + i * 0.04);
const EMPTY: PowderPattern = { id: "domains", name: "domains", xUnit: "twoTheta", radiation: NEUTRON, wavelength: 1.54, points: PROFILE_GRID.map((x) => ({ x, yObs: 0 })) };

/** The Rietveld engine's calculated constant-wavelength neutron profile (2θ 10–130°, Gaussian peaks). */
export function powderProfile(s: StructureModel): Float64Array {
  const spec = buildStructureRefinement(s, EMPTY, { scale: 1, width: 0.15, backgroundTerms: 1, refineAdp: false, refinePositions: false });
  const params = spec.params.map((q) => (q.kind === "background" ? { ...q, value: 0 } : q));
  return Float64Array.from(powderCurves(s, EMPTY, params, spec.bindings, { shape: "gaussian" }).yCalc);
}

/** G(r) on an off-grid r grid (no pair lands on a window edge by construction of the numbers). */
export function pdf(s: StructureModel, type: "neutron" | "xray", rMax: number): Float64Array {
  const grid = makeRGrid(1.00377, rMax, 0.01);
  return computeGofR(s.cell, expandStructureAtoms(s), grid, { scatteringType: type, scale: 1, qdamp: 0.04, qbroad: 0.01, delta1: 0, delta2: 1.6 });
}

/** max |a − b| / max |a|. */
export function curveDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Infinity;
  let top = 0;
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    top = Math.max(top, Math.abs(a[i]!));
    worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  }
  return top > 0 ? worst / top : worst;
}

export interface Observables {
  readonly neutronLines: Line[];
  readonly xrayLines: Line[];
  readonly profile: Float64Array;
  readonly gNeutron: Float64Array;
  readonly gXray: Float64Array;
}

export function observables(s: StructureModel, c: DomainCase): Observables {
  return {
    neutronLines: powderLines(s, NEUTRON, c.dMin),
    xrayLines: powderLines(s, XRAY, c.dMin),
    profile: powderProfile(s),
    gNeutron: pdf(s, "neutron", c.rMax),
    gXray: pdf(s, "xray", c.rMax),
  };
}

export interface Differences {
  /** Powder lines (neutron, X-ray): each line relative to itself, floored at 10⁻⁹ of the strongest. */
  readonly lines: number;
  /** The calculated neutron profile, relative to its maximum. */
  readonly profile: number;
  /** G(r) (neutron, X-ray), relative to its maximum. */
  readonly pdf: number;
}

export function differences(a: Observables, b: Observables): Differences {
  return {
    lines: Math.max(lineDifference(a.neutronLines, b.neutronLines), lineDifference(a.xrayLines, b.xrayLines)),
    profile: curveDifference(a.profile, b.profile),
    pdf: Math.max(curveDifference(a.gNeutron, b.gNeutron), curveDifference(a.gXray, b.gXray)),
  };
}

// ── one case, one seed ───────────────────────────────────────────────────────

export interface DomainResult {
  /** Coset representative g (F element) and its operation. */
  readonly g: number;
  readonly xyz: string;
  /** The conjugate's index among the distinct conjugates (orientation state), 0 for H itself. */
  readonly orientation: number;
  /** The conjugate realised: its name and child basis. */
  readonly child: string;
  /** How much of g·u the conjugate's modes leave out (relative). */
  readonly residual: number;
  /** The conjugate's displacive modes (H's count, for a conjugate). */
  readonly modes: number;
  readonly diff: Differences;
}

export interface SeedResult {
  readonly name: string;
  readonly seed: number;
  readonly child: string;
  readonly domainStates: number;
  readonly orientationStates: number;
  readonly modes: number;
  /** The identity domain through the engine's mode set against the field-built one: positions (Å, after removing a common translation), and the observables. */
  readonly modeSetGap: number;
  readonly modeSetTranslation: number;
  readonly modeSetDiff: Differences;
  readonly domains: readonly DomainResult[];
  readonly worst: Differences;
  readonly worstResidual: number;
  readonly ms: number;
}

const conjugateCache = new WeakMap<Prepared, Map<string, { realised: RealisedChild; basis: SupercellModeBasis }>>();

function realisedConjugate(p: Prepared, elements: readonly number[]): { realised: RealisedChild; basis: SupercellModeBasis } {
  let byKey = conjugateCache.get(p);
  if (!byKey) {
    byKey = new Map();
    conjugateCache.set(p, byKey);
  }
  const key = elements.join(",");
  const hit = byKey.get(key);
  if (hit) return hit;
  const sameAsRep = key === p.cls.elements.join(",");
  const realised = sameAsRep ? realiseChild(p.c.parent, p.group, elements, p.cls.identity) : realiseChild(p.c.parent, p.group, elements);
  const basis = supercellModeBasis(p.c.parent, p.group, elements, realised);
  const out = { realised, basis };
  byKey.set(key, out);
  return out;
}

const childName = (r: RealisedChild): string => {
  const P = r.basis.map((row) => row.map((x) => +x.toFixed(4)).join(" ")).join("; ");
  return `${r.structure.spaceGroup.hermannMauguin ?? "?"} P=[${P}] p=(${r.origin.map((x) => +x.toFixed(4)).join(", ")})`;
};

/** Positions of two children of one realisation, site by site: the largest gap (Å) after removing their mean Cartesian difference, and that mean. */
function positionGap(a: StructureModel, b: StructureModel): { gap: number; translation: number } {
  const M = orthogonalizationMatrix(a.cell);
  const byLabel = new Map(b.sites.map((s) => [s.label, s] as const));
  const diffs = a.sites.map((s) => {
    const t = byLabel.get(s.label);
    if (!t) throw new Error(`positionGap: ${s.label} missing`);
    const d = [0, 1, 2].map((i) => {
      const x = t.position[i]! - s.position[i]!;
      return x - Math.round(x);
    }) as unknown as Vec3;
    return mulVec(M, d);
  });
  const mean = [0, 1, 2].map((i) => diffs.reduce((t, d) => t + d[i]!, 0) / diffs.length);
  let gap = 0;
  for (const d of diffs) gap = Math.max(gap, Math.hypot(d[0] - mean[0]!, d[1] - mean[1]!, d[2] - mean[2]!));
  return { gap, translation: Math.hypot(mean[0]!, mean[1]!, mean[2]!) };
}

/**
 * One case at one seed: random amplitudes on every mode of H (total 0.08 Å
 * per atom of the child cell, root mean square), a random strain of 0.5 %,
 * every domain state built and compared with the identity's.
 * `maxDomains` caps the domains compared (the identity always included).
 */
export function runSeed(p: Prepared, seed: number, opts: { readonly maxDomains?: number; readonly deadline?: number } = {}): SeedResult {
  const t0 = performance.now();
  const next = rng(seed);
  const H = p.cls.elements;
  const base = realisedConjugate(p, H);
  const nModes = base.basis.modes.length;
  if (nModes === 0) throw new Error(`${p.c.name}: the child has no displacive mode`);
  const raw = base.basis.modes.map(() => 2 * next() - 1);
  const atoms = expandStructureAtoms(base.realised.structure).length;
  const norm = Math.hypot(...raw);
  const eta = raw.map((x) => (x / norm) * 0.08 * Math.sqrt(atoms));
  const Gs = strainedMetric(p, H, next, 0.005);
  const G0 = metricTensor(p.c.parent.cell);
  const u = fieldOf(base.basis, eta);

  // The identity domain: field-built, and through the engine's mode set.
  const ref = childWithField(p, base.realised, u, Gs);
  const refObs = observables(ref, p.c);
  // The mode set as the PDF page builds it (irrepModeSet), its amplitudes read off the field-built child by the
  // engine's own interpolation (positionShiftValuesFor: exact in the span, the polar gauge's translation dropped).
  const set = irrepModeSet(p.c.parent, base.realised, base.basis);
  const anchor = { ...set.parentized, cell: ref.cell };
  const values = { ...Object.fromEntries(set.parameters.map((q) => [q.id, q.value] as const)), ...positionShiftValuesFor(anchor, set.bindings, ref) };
  const viaModes0 = applyParameters(anchor, set.bindings, values).model;
  const viaModes = { ...viaModes0, sites: viaModes0.sites.map((s) => ({ ...s, adp: ref.sites.find((x) => x.label === s.label)!.adp })) };
  const gap = positionGap(ref, viaModes);
  const modeSetDiff = differences(refObs, observables(viaModes, p.c));

  const reps = cosetRepresentatives(p.group, H);
  const orientations: string[] = [];
  const domains: DomainResult[] = [];
  const chosen = opts.maxDomains !== undefined && reps.length > opts.maxDomains ? spread(reps, opts.maxDomains) : reps;
  for (const g of chosen) {
    if (opts.deadline !== undefined && performance.now() > opts.deadline) break;
    const Hg = conjugate(p.group, g, H);
    const key = Hg.join(",");
    let orientation = orientations.indexOf(key);
    if (orientation < 0) {
      orientations.push(key);
      orientation = orientations.length - 1;
    }
    const conj = realisedConjugate(p, Hg);
    const v = carryField(p, g, u);
    const { residual } = project(conj.basis, G0, v);
    const s = childWithField(p, conj.realised, v, domainMetric(p, g, Gs));
    domains.push({ g, xyz: p.group.operations[g]!.xyz, orientation, child: childName(conj.realised), residual, modes: conj.basis.modes.length, diff: differences(refObs, observables(s, p.c)) });
  }
  const worst = {
    lines: Math.max(...domains.map((d) => d.diff.lines)),
    profile: Math.max(...domains.map((d) => d.diff.profile)),
    pdf: Math.max(...domains.map((d) => d.diff.pdf)),
  };
  return {
    name: p.c.name,
    seed,
    child: childName(base.realised),
    domainStates: reps.length,
    orientationStates: p.cls.orientationStates,
    modes: nModes,
    modeSetGap: gap.gap,
    modeSetTranslation: gap.translation,
    modeSetDiff,
    domains,
    worst,
    worstResidual: Math.max(...domains.map((d) => d.residual)),
    ms: performance.now() - t0,
  };
}

/**
 * The test's own sensitivity, on two mistakes it must see: a domain whose
 * field is put on another orientation's realisation (an atom-mapping or
 * setting error), and a domain whose strain is not turned with it (the
 * identity domain's metric in another orientation). Both on the first coset
 * representative of another orientation than H's.
 */
export function negativeControls(p: Prepared, seed: number): { readonly wrongMapping: Differences; readonly unturnedStrain: Differences } {
  const next = rng(seed);
  const H = p.cls.elements;
  const base = realisedConjugate(p, H);
  const raw = base.basis.modes.map(() => 2 * next() - 1);
  const atoms = expandStructureAtoms(base.realised.structure).length;
  const norm = Math.hypot(...raw);
  const eta = raw.map((x) => (x / norm) * 0.08 * Math.sqrt(atoms));
  const Gs = strainedMetric(p, H, next, 0.005);
  const u = fieldOf(base.basis, eta);
  const refObs = observables(childWithField(p, base.realised, u, Gs), p.c);
  const g = cosetRepresentatives(p.group, H).find((x) => conjugate(p.group, x, H).join(",") !== H.join(","));
  if (g === undefined) throw new Error(`${p.c.name}: one orientation only`);
  const conj = realisedConjugate(p, conjugate(p.group, g, H));
  // The field carried by g, put on H's own realisation and cell (the setting of the wrong orientation); the strain is H's, so only the atoms differ.
  const wrong = childWithField(p, base.realised, carryField(p, g, u), Gs);
  const unturned = childWithField(p, conj.realised, carryField(p, g, u), Gs);
  return { wrongMapping: differences(refObs, observables(wrong, p.c)), unturnedStrain: differences(refObs, observables(unturned, p.c)) };
}

/** `n` of the list spread over it, the first always. */
function spread<T>(xs: readonly T[], n: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.floor((i * xs.length) / n)]!);
  return out;
}

export const fmt = (x: number): string => (Number.isFinite(x) ? x.toExponential(1) : "∞");

/** The tolerance of every comparison (relative; Å for the mode-set child's positions). */
export const TOL = 1e-9;

/** What one seed got wrong, one line each (empty: every domain alike). */
export function failures(r: SeedResult, domainStates: number, orientationStates: number): string[] {
  const out: string[] = [];
  if (r.domains.length !== domainStates) out.push(`${r.domains.length} domains compared, the lattice says ${domainStates}`);
  const orientations = new Set(r.domains.map((d) => d.orientation)).size;
  if (orientations !== orientationStates) out.push(`${orientations} orientations, the lattice says ${orientationStates}`);
  if (!(r.modeSetGap < TOL)) out.push(`the mode set's child is ${fmt(r.modeSetGap)} Å from the field-built one`);
  const m = r.modeSetDiff;
  if (!(Math.max(m.lines, m.profile, m.pdf) < TOL)) out.push(`the mode set's child looks different: lines ${fmt(m.lines)}, profile ${fmt(m.profile)}, G(r) ${fmt(m.pdf)}`);
  for (const d of r.domains) {
    const bad: string[] = [];
    if (d.modes !== r.modes) bad.push(`${d.modes} modes, not ${r.modes}`);
    if (!(d.residual < TOL)) bad.push(`its modes leave ${fmt(d.residual)} of g·u`);
    if (!(d.diff.lines < TOL)) bad.push(`lines ${fmt(d.diff.lines)}`);
    if (!(d.diff.profile < TOL)) bad.push(`profile ${fmt(d.diff.profile)}`);
    if (!(d.diff.pdf < TOL)) bad.push(`G(r) ${fmt(d.diff.pdf)}`);
    if (bad.length > 0) out.push(`domain g = ${d.xyz} (orientation ${d.orientation}, ${d.child}): ${bad.join(", ")}`);
  }
  return out.map((x) => `${r.name}, seed ${r.seed}: ${x}`);
}

/** One seed in one line. */
export const summary = (r: SeedResult): string =>
  `${r.name} seed ${r.seed}: ${r.domains.length} domains (${new Set(r.domains.map((d) => d.orientation)).size} orientations), ${r.modes} modes; worst lines ${fmt(r.worst.lines)}, profile ${fmt(r.worst.profile)}, G(r) ${fmt(r.worst.pdf)}, mode residual ${fmt(r.worstResidual)}; mode-set child ${fmt(r.modeSetGap)} Å; ${(r.ms / 1000).toFixed(1)} s`;
