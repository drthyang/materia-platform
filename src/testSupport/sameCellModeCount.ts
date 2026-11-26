/**
 * The PDF page's same-cell mode sets checked against an independent count
 * (test code only, never imported by the app; the gauge fix of 2026-11-26).
 *
 * For a parent structure, every same-cell row of its Subgroups listing (bound
 * 1×1×1) is activated as the view does (activationOf), and the mode set the
 * page then refines is compared with
 *  - the row's own count (`row.modes`, what the listing and list_subgroups
 *    show), and
 *  - an independent count: the child the activation realised is given to
 *    moyo (@spglib/moyo-wasm, a dev dependency) with two marker orbits of
 *    generic points under the child's own operations (so moyo sees exactly
 *    its group; the operation count is checked); each orbit contributes the
 *    dimension its stabiliser S fixes, (1/|S|)·Σ_S tr W, and H's rigid
 *    translations, (1/|R|)·Σ_R tr R over its distinct rotations, are taken
 *    off. None of the engine's mode code is used.
 * The structure's own modes (Positions → Irreps: buildSymmetryModes on the
 * parent itself) are counted the same way.
 *
 * Before the fix the default gauge projected out every direction all the
 * listed representatives allow, not only H's translations: 38 of the 809
 * same-cell rows of these parents offered fewer modes than they listed
 * (67 modes), and FeSi-type P2₁3 and SnS-type Pnma's own modes 1 of 2 and
 * 2 of 4 (the verification of 2026-11-26).
 */
import { analyze_cell } from "@spglib/moyo-wasm";
import type { AtomSite, StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { buildSymmetryModes } from "@/core/crystal/distortionModes";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { pdfPage, type PdfPageModel } from "@/app/pdfPage";
import { activationOf, listSubgroups, parseBound } from "@/app/pdfSubgroups";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { MODE_PARENTS } from "@/core/crystal/irreps/validation/independentModeCount";
import { cartesianCell, initMoyo, rng, seedOf } from "@/core/crystal/irreps/validation/independentNaming";

type M3 = number[][];
type V3 = number[];
const app = (A: M3, v: V3): V3 => A.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
const mod1 = (x: number): number => {
  const f = x - Math.floor(x);
  return Math.abs(f - 1) < 1e-7 || Math.abs(f) < 1e-7 ? 0 : f;
};
const near = (x: number): boolean => Math.abs(x - Math.round(x)) < 1e-6;
const colMajor = (a: readonly number[]): M3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i + 3 * j]!));
const key = (f: V3): string => f.map((v) => Math.round(mod1(v) * 1e6) % 1e6).join(",");
const tr = (m: M3): number => m[0]![0]! + m[1]![1]! + m[2]![2]!;

const site = (label: string, element: string, position: [number, number, number]): AtomSite => ({ label, element, position, occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } });
const synthetic = (id: string, sg: number, cell: [number, number, number, number, number, number], sites: AtomSite[]): StructureModel => ({
  id, name: id, cell: { a: cell[0], b: cell[1], c: cell[2], alpha: cell[3], beta: cell[4], gamma: cell[5] }, spaceGroup: buildSpaceGroup(sg), sites,
});

/** The verification's three extra parents: every site on a special position that allows one common direction. Synthetic, generic parameters. */
export const GAUGE_PARENTS: Readonly<Record<string, StructureModel>> = {
  "Pa-3 (pyrite-type)": synthetic("Pa-3", 205, [5.42, 5.42, 5.42, 90, 90, 90], [site("Fe", "Fe", [0, 0, 0]), site("S", "S", [0.385, 0.385, 0.385])]),
  "P2_13 (FeSi-type)": synthetic("P2_13", 198, [4.49, 4.49, 4.49, 90, 90, 90], [site("Fe", "Fe", [0.136, 0.136, 0.136]), site("Si", "Si", [0.844, 0.844, 0.844])]),
  "Pnma all-4c (SnS-type)": synthetic("Pnma4c", 62, [11.2, 4.0, 4.3, 90, 90, 90], [site("Sn", "Sn", [0.12, 0.25, 0.12]), site("S", "S", [0.85, 0.25, 0.48])]),
};

/** Every parent of the verification: B2's twelve, the three above and the bundled GaTa4Se8 demo (its refined values). */
export function sameCellParents(): readonly { readonly name: string; readonly structure: StructureModel; readonly page: () => PdfPageModel }[] {
  const synth = (s: StructureModel) => () => pdfPage(s, syntheticPattern(s), { preset: { fitRange: { min: 1.5, max: 12 } } });
  const demo = gata4se8PdfExample();
  return [
    ...Object.entries(MODE_PARENTS).map(([name, mp]) => ({ name, structure: mp.structure, page: synth(mp.structure) })),
    ...Object.entries(GAUGE_PARENTS).map(([name, s]) => ({ name, structure: s, page: synth(s) })),
    { name: "GaTa4Se8 (bundled demo)", structure: demo.structure, page: () => pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams, fitRange: { min: 1.5, max: 6 } } }) },
  ];
}

/** A neutron G(r) of the structure itself, 1.5–12 Å (the page needs data; the count does not depend on it). */
export function syntheticPattern(s: StructureModel): PdfPattern {
  const rGrid = makeRGrid(1.5, 12, 0.02);
  const g = computeGofR(s.cell, expandStructureAtoms(s), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id: `p-${s.id}`, name: s.id, scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: g[i]! })), qdamp: 0.03 };
}

function orbit(s: StructureModel, x: V3): V3[] {
  const out = new Map<string, V3>();
  for (const op of s.spaceGroup.operations) {
    const y = app(op.rotation.map((r) => [...r]), x).map((v, k) => mod1(v + op.translation[k]!));
    out.set(key(y), y);
  }
  return [...out.values()];
}

export interface IndependentCount {
  /** Σ over the structure's orbits of the dimension each stabiliser fixes. */
  readonly free: number;
  /** The rigid translations the group allows (its polar directions). */
  readonly polar: number;
  /** free − polar: the modes a basis without the rigid translations must have. */
  readonly expected: number;
  /** moyo found exactly the structure's operations and orbits. */
  readonly ok: boolean;
}

/** The independent count of a structure's displacive modes in its own group (see the module comment). */
export function independentCount(s: StructureModel, label: string): IndependentCount {
  initMoyo();
  const c = s.cell;
  const A = cartesianCell(c.a, c.b, c.c, c.alpha, c.beta, c.gamma);
  const atoms: { f: V3; z: number }[] = [];
  s.sites.forEach((x, i) => {
    for (const f of orbit(s, [...x.position])) atoms.push({ f, z: i + 1 });
  });
  const nReal = atoms.length;
  const r = rng(seedOf(label));
  for (const z of [1001, 1002]) for (const f of orbit(s, [0.05 + 0.9 * r(), 0.05 + 0.9 * r(), 0.05 + 0.9 * r()])) atoms.push({ f, z });
  const d = analyze_cell(JSON.stringify({ lattice: { basis: [0, 1, 2].flatMap((j) => [A[0]![j]!, A[1]![j]!, A[2]![j]!]) }, positions: atoms.map((a) => a.f), numbers: atoms.map((a) => a.z) }), 1e-4, "Standard");
  const own = new Set(s.spaceGroup.operations.map((op) => `${op.rotation.flat().join(",")}|${key([...op.translation])}`));
  const ops = d.operations.map((o) => ({ W: colMajor(o.rotation), w: [...o.translation] }));
  const reps = new Map<number, number>();
  for (let i = 0; i < nReal; i++) reps.set(d.orbits[i]!, (reps.get(d.orbits[i]!) ?? 0) + 1);
  let free = 0;
  for (const [rep] of reps) {
    const x = atoms[rep]!.f;
    const stab = ops.filter(({ W, w }) => app(W, x).every((v, k) => near(v + w[k]! - x[k]!)));
    free += Math.round(stab.reduce((t, { W }) => t + tr(W), 0) / stab.length);
  }
  const rots = new Map<string, M3>();
  for (const { W } of ops) rots.set(W.flat().join(","), W);
  const polar = Math.round([...rots.values()].reduce((t, W) => t + tr(W), 0) / rots.size);
  return { free, polar, expected: free - polar, ok: d.operations.length === own.size && reps.size === s.sites.length };
}

export interface SameCellRowCheck {
  readonly row: string;
  readonly kind: string;
  /** The listing's count (null: the listing has no structure, never the case here). */
  readonly listed: number | null;
  /** The activated set's modes (0: the page found nothing to refine). */
  readonly offered: number;
  /** The independent count (absent where the activation built no set). */
  readonly independent?: number;
  readonly problems: readonly string[];
}

export interface SameCellParentCheck {
  readonly parent: string;
  /** The structure's own modes (Positions → Irreps) and their independent count. */
  readonly own: { readonly offered: number; readonly independent: number; readonly problems: readonly string[] };
  readonly rows: readonly SameCellRowCheck[];
  /** Same-cell rows listed; `rows` may hold fewer when the deadline stopped the run. */
  readonly listed: number;
  readonly note?: string;
  readonly ms: number;
}

/**
 * Activate every same-cell row of a parent (or those `pick` keeps) and
 * compare listed, offered and the independent count; stops between rows once
 * `deadline` passes and says so in `note`.
 */
export async function checkSameCellParent(
  p: ReturnType<typeof sameCellParents>[number],
  opts: { readonly pick?: (rowName: string) => boolean; readonly deadline?: number } = {},
): Promise<SameCellParentCheck> {
  const t0 = Date.now();
  const ownSet = buildSymmetryModes(p.structure);
  const ownCount = independentCount(p.structure, `${p.name}|own`);
  const ownProblems: string[] = [];
  if (!ownCount.ok) ownProblems.push("oracle: moyo did not see exactly the structure's group");
  if (ownSet.modes.length !== ownCount.expected) ownProblems.push(`own modes: ${ownSet.modes.length}, independent ${ownCount.expected}`);
  const page = p.page();
  const listing = await listSubgroups(p.structure, parseBound("1×1×1")!);
  const all = listing.rows.filter((r) => r.sameCell && r.action.kind !== "elsewhere");
  const rows = all.filter((r) => !opts.pick || opts.pick(r.name));
  const out: SameCellRowCheck[] = [];
  let note: string | undefined;
  for (const row of rows) {
    if (Date.now() > (opts.deadline ?? Number.POSITIVE_INFINITY)) {
      note = `stopped at the time limit after ${out.length} of ${rows.length} rows`;
      break;
    }
    const problems: string[] = [];
    const a = activationOf(page, row.action);
    const set = a.model === page ? null : a.model.modes?.set ?? null;
    if (!set) {
      // Every site pinned in the child: nothing to refine, and the listing must say 0.
      if (row.modes !== 0) problems.push(`no mode set, but the row lists ${row.modes} (${a.message})`);
      out.push({ row: row.name, kind: row.action.kind, listed: row.modes, offered: 0, problems });
      continue;
    }
    const ind = independentCount(set.parentized, `${p.name}|${row.key}`);
    if (!ind.ok) problems.push("oracle: moyo did not see exactly the child's group");
    if (set.modes.length !== ind.expected) problems.push(`offered ${set.modes.length}, independent ${ind.expected} (${ind.free} free − ${ind.polar} polar)`);
    if (row.modes !== ind.expected) problems.push(`listed ${row.modes}, independent ${ind.expected}`);
    out.push({ row: row.name, kind: row.action.kind, listed: row.modes, offered: set.modes.length, independent: ind.expected, problems });
  }
  return {
    parent: p.name,
    own: { offered: ownSet.modes.length, independent: ownCount.expected, problems: ownProblems },
    rows: out,
    listed: rows.length,
    ...(note ? { note } : {}),
    ms: Date.now() - t0,
  };
}

/** One line per mismatch. */
export function sameCellFindings(c: SameCellParentCheck): string[] {
  return [
    ...c.own.problems.map((x) => `${c.parent} (own modes): ${x}`),
    ...c.rows.filter((r) => r.problems.length > 0).map((r) => `${c.parent} → ${r.row} [${r.kind}]: ${r.problems.join("; ")}`),
  ];
}
