/**
 * Single-crystal pages for tests and the eval suite, built from the engine
 * itself so they need no data file: corundum (α-Al₂O₃, R-3c) measured to
 * d = 0.6 Å with three equivalents per reflection, its intensities computed
 * from the room-temperature structure (Al z = 0.35216, O x = 0.30624), with
 * secondary extinction and counting noise. The starting model is the rounded one
 * a user types in (Al z = 0.352, O x = 0.306, every B 0.4 Å²).
 */

import { parseCif } from "@/parsers/cif";
import type { StructureModel } from "@/core/crystal/types";
import { INVERSION_TWIN, type ExtinctionModel, type SingleCrystalDataset } from "@/core/diffraction/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { dSpacing, orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { inverse, mulVec } from "@/core/math/mat3";
import { buildSingleCrystalSpec, singleCrystalRefinementComparison } from "@/core/workflow/singleCrystalRefinement";

const corundumCif = (alZ: number, oX: number, uIso: number): string => `data_corundum
_chemical_formula_sum 'Al2 O3'
_cell_length_a 4.7613
_cell_length_b 4.7613
_cell_length_c 12.9846
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 120
_symmetry_space_group_name_H-M 'R -3 c'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
Al1 Al 0 0 ${alZ} ${uIso}
O1 O ${oX} 0 0.25 ${uIso}
`;

/** Deterministic noise: mulberry32 into Box–Muller. */
function normals(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

export interface CorundumPage {
  readonly structure: StructureModel;
  readonly dataset: SingleCrystalDataset;
  /** The values the intensities were computed with. */
  readonly truth: { readonly alZ: number; readonly oX: number; readonly extinction: number };
}

/** A measurement that failed: this reflection (as indexed) at `factor` of its intensity. */
export interface FailedMeasurement {
  readonly h: number;
  readonly k: number;
  readonly l: number;
  readonly factor: number;
}

export interface CorundumOptions {
  /** The extinction of the crystal the intensities are computed for: SHELX's EXTI x, or Eg/Es under `extinctionModel`. */
  readonly extinction?: number;
  /** The extinction model the intensities are computed with (SHELXL's by default); the page loads the data with SHELXL's whatever it is. */
  readonly extinctionModel?: ExtinctionModel;
  readonly seed?: number;
  readonly dMin?: number;
  /** Batch scales: each reflection's equivalents measured in turn in batches 1, 2, …, each batch at its scale. */
  readonly batches?: readonly number[];
  /** Measurements that failed, each at `factor` of its intensity. */
  readonly failed?: FailedMeasurement | readonly FailedMeasurement[];
  /** Measured as a time-of-flight Laue experiment: each reflection at its own 2θ (30–150°) and so its own wavelength, as on TOPAZ. */
  readonly laue?: boolean;
}

/** Corundum on a constant-wavelength neutron diffractometer (λ 1.0 Å). */
export function corundumPage({ extinction = 2, extinctionModel, seed = 7, dMin = 0.6, batches, failed, laue = false }: CorundumOptions = {}): CorundumPage {
  const failures: readonly FailedMeasurement[] = failed === undefined ? [] : "h" in failed ? [failed] : failed;
  const truth = parseCif(corundumCif(0.35216, 0.30624, 0.0035), "corundum");
  const start = parseCif(corundumCif(0.352, 0.306, 0.005), "corundum");
  const radiation = { kind: "neutron" as const, wavelength: 1.0 };
  const unique = generateReflections(truth.cell, truth.spaceGroup, dMin, 20);
  // Three equivalents of each reflection, as a diffractometer measures them.
  const ops = truth.spaceGroup.operations;
  const indices: [number, number, number][] = [];
  for (const r of unique) {
    const seen = new Set<string>();
    for (const op of ops) {
      const R = op.rotation;
      const h = Math.round(R[0]![0]! * r.h + R[1]![0]! * r.k + R[2]![0]! * r.l);
      const k = Math.round(R[0]![1]! * r.h + R[1]![1]! * r.k + R[2]![1]! * r.l);
      const l = Math.round(R[0]![2]! * r.h + R[1]![2]! * r.k + R[2]![2]! * r.l);
      const key = `${h},${k},${l}`;
      if (seen.has(key)) continue;
      seen.add(key);
      indices.push([h, k, l]);
      if (seen.size === 3) break;
    }
  }
  // On a Laue instrument each reflection lands at its own angle, and λ = 2d·sinθ.
  const measuredAt = (h: number, k: number, l: number, i: number): { wavelength: number; twoTheta: number; tbar: number } => {
    const twoTheta = 30 + ((i * 7919) % 121);
    return { wavelength: 2 * dSpacing(truth.cell, h, k, l) * Math.sin((twoTheta * Math.PI) / 360), twoTheta, tbar: 0.07 };
  };
  const empty: SingleCrystalDataset = laue
    ? { id: "corundum-sx", name: "corundum (synthetic, neutron TOF Laue)", radiation: { kind: "neutron-tof" }, reflections: indices.map(([h, k, l], i) => ({ h, k, l, iObs: 1, ...measuredAt(h, k, l, i) })) }
    : { id: "corundum-sx", name: "corundum (synthetic, neutron λ 1.0 Å)", radiation, reflections: indices.map(([h, k, l]) => ({ h, k, l, iObs: 1 })) };
  const computed: SingleCrystalDataset = extinctionModel ? { ...empty, extinctionModel } : empty;
  const spec = buildSingleCrystalSpec(truth, computed, { scale: 1, extinction });
  const calc = singleCrystalRefinementComparison(truth, computed, spec.params, spec.bindings).rows;
  const noise = normals(seed);
  // Counting statistics on a background, and 2 % of the intensity for what
  // the integration and the corrections add: σ² = (I + B)·g + (0.02·I)², with
  // the strongest reflection counted to about 10⁵ and B at 1 % of it.
  const iMax = Math.max(...calc.map((c) => c.fcSq));
  const g = iMax / 1e5;
  const background = 0.01 * iMax;
  const dataset: SingleCrystalDataset = {
    ...empty,
    reflections: calc.map((c, i) => {
      const batch = batches ? i % batches.length : -1;
      const k = batches ? batches[batch]! : 1;
      const lost = failures.find((f) => c.h === f.h && c.k === f.k && c.l === f.l)?.factor ?? 1;
      const iTrue = k * lost * c.fcSq;
      const sigma = Math.sqrt((Math.max(iTrue, 0) + background) * g + (0.02 * iTrue) ** 2);
      const at = empty.reflections[i]!;
      return { ...at, h: c.h, k: c.k, l: c.l, iObs: iTrue + sigma * noise(), sigma, ...(batches ? { batch: batch + 1 } : {}) };
    }),
  };
  return { structure: start, dataset, truth: { alZ: 0.35216, oX: 0.30624, extinction } };
}

/** A Cartesian point as fractional coordinates of `cell` (a along x, b in the xy plane). */
function fractional(cell: StructureModel["cell"], p: readonly [number, number, number]): [number, number, number] {
  const m = orthogonalizationMatrix(cell);
  const f = mulVec(inverse(m), [p[0], p[1], p[2]]);
  return [f[0], f[1], f[2]];
}

export interface PyridylPage {
  readonly structure: StructureModel;
  readonly dataset: SingleCrystalDataset;
  /** The structure the intensities were computed from: the hydrogens riding at 0.95 Å (sp²) and 0.98 Å (methyl). */
  readonly truth: StructureModel;
}

/**
 * 2-(methylthio)pyridine, C₆H₇NS, in P2₁/c measured with Mo Kα to d = 0.8 Å,
 * one measurement per unique reflection: a small organic X-ray structure with
 * four aromatic hydrogens and a methyl group. The intensities come from the
 * structure with its hydrogens where SHELXL rides them (sp² C–H 0.95 Å on the
 * bisector, U_iso 1.2·U_eq; methyl C–H 0.98 Å, 1.5·U_eq). The starting model
 * has the heavy atoms a few hundredths of an ångström off, the ring hydrogens
 * where a difference map put them (0.1–0.15 Å off, at 0.80–1.10 Å) and the
 * methyl's as a riding refinement left them.
 */
export function pyridylPage({ seed = 11, dMin = 0.8, extraError = 0 }: {
  readonly seed?: number;
  readonly dMin?: number;
  /** An error on every Fo² of this fraction of it that the σ do not carry (absorption, scaling): what SHELXL's WGHT a covers. */
  readonly extraError?: number;
} = {}): PyridylPage {
  const cell = { a: 9.5, b: 12.0, c: 9.0, alpha: 90, beta: 101, gamma: 90 };
  const m = orthogonalizationMatrix(cell);
  const unit = (v: readonly [number, number, number]): [number, number, number] => {
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  const add = (a: readonly number[], b: readonly number[], f = 1): [number, number, number] => [a[0]! + f * b[0]!, a[1]! + f * b[1]!, a[2]! + f * b[2]!];
  const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  // The ring's plane: normal n, in-plane axes e1, e2.
  const n = unit([0.2, 0.5, 1]);
  const v: [number, number, number] = [1, 0.3, 0.2];
  const dot = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  const e1 = unit(add(v, n, -dot));
  const e2 = cross(n, e1);
  const centre = mulVec(m, [0.27, 0.16, 0.33]);
  const radial = (deg: number): [number, number, number] => add(add([0, 0, 0], e1, Math.cos((deg * Math.PI) / 180)), e2, Math.sin((deg * Math.PI) / 180));
  const ring = (deg: number, r: number): [number, number, number] => add(centre, radial(deg), r);
  // C2 carries the S; N1 next to it; C3–C6 carry the ring hydrogens.
  const atoms: { label: string; element: string; cart: [number, number, number]; u: number }[] = [
    { label: "S1", element: "S", cart: ring(0, 1.39 + 1.77), u: 0.025 },
    { label: "N1", element: "N", cart: ring(60, 1.39), u: 0.03 },
    { label: "C2", element: "C", cart: ring(0, 1.39), u: 0.028 },
    { label: "C3", element: "C", cart: ring(300, 1.39), u: 0.032 },
    { label: "C4", element: "C", cart: ring(240, 1.39), u: 0.036 },
    { label: "C5", element: "C", cart: ring(180, 1.39), u: 0.036 },
    { label: "C6", element: "C", cart: ring(120, 1.39), u: 0.033 },
  ];
  const sCart = atoms[0]!.cart;
  // The methyl carbon: C2–S1–C7 103°, in the ring's plane, on N1's side.
  const out = radial(0);
  const c7 = add(sCart, add(add([0, 0, 0], out, Math.cos((77 * Math.PI) / 180)), radial(90), Math.sin((77 * Math.PI) / 180)), 1.8);
  atoms.push({ label: "C7", element: "C", cart: c7, u: 0.045 });
  const hydrogens: { label: string; parent: string; cart: [number, number, number] }[] = [
    { label: "H3", parent: "C3", cart: ring(300, 1.39 + 0.95) },
    { label: "H4", parent: "C4", cart: ring(240, 1.39 + 0.95) },
    { label: "H5", parent: "C5", cart: ring(180, 1.39 + 0.95) },
    { label: "H6", parent: "C6", cart: ring(120, 1.39 + 0.95) },
  ];
  // Staggered methyl hydrogens at 0.98 Å, S1–C7–H 109.5°.
  const axis = unit(add(c7, sCart, -1));
  const p1 = unit(cross(axis, n));
  const p2 = cross(axis, p1);
  ["H7A", "H7B", "H7C"].forEach((label, j) => {
    const phi = (j * 2 * Math.PI) / 3 + 0.3;
    const dir = add(add(add([0, 0, 0], axis, Math.cos((70.5 * Math.PI) / 180)), p1, Math.sin((70.5 * Math.PI) / 180) * Math.cos(phi)), p2, Math.sin((70.5 * Math.PI) / 180) * Math.sin(phi));
    hydrogens.push({ label, parent: "C7", cart: add(c7, dir, 0.98) });
  });
  const uOf = (label: string): number => atoms.find((a) => a.label === label)!.u;
  const cif = (rows: readonly string[]): string => `data_pyridyl
_chemical_formula_sum 'C6 H7 N S'
_cell_length_a ${cell.a}
_cell_length_b ${cell.b}
_cell_length_c ${cell.c}
_cell_angle_alpha ${cell.alpha}
_cell_angle_beta ${cell.beta}
_cell_angle_gamma ${cell.gamma}
_symmetry_space_group_name_H-M 'P 1 21/c 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
${rows.join("\n")}
`;
  const row = (label: string, element: string, f: readonly number[], u: number): string => `${label} ${element} ${f.map((x) => x.toFixed(6)).join(" ")} ${u.toFixed(5)}`;
  const truth = parseCif(cif([
    ...atoms.map((a) => row(a.label, a.element, fractional(cell, a.cart), a.u)),
    ...hydrogens.map((h) => row(h.label, "H", fractional(cell, h.cart), (h.parent === "C7" ? 1.5 : 1.2) * uOf(h.parent))),
  ]), "pyridyl");
  // The starting model: heavy atoms off by a few hundredths of an ångström,
  // every U at 0.04 (0.06 for H), the ring hydrogens where a difference map
  // put them, the methyl as a riding refinement left it (moved with its carbon).
  const jitter = (i: number, size: number): [number, number, number] => [size * Math.sin(1.7 * i + 0.3), size * Math.cos(2.3 * i + 1.1), size * Math.sin(3.1 * i + 2.2)];
  const start = parseCif(cif([
    ...atoms.map((a, i) => row(a.label, a.element, fractional(cell, add(a.cart, jitter(i, 0.025))), 0.04)),
    ...hydrogens.map((h, i) => {
      if (h.parent === "C7") return row(h.label, "H", fractional(cell, add(h.cart, jitter(atoms.length - 1, 0.025))), 0.06);
      const parent = atoms.find((a) => a.label === h.parent)!.cart;
      // Along the bond to 0.84–1.05 Å, then off it by about 0.1 Å.
      const bond = add(h.cart, parent, -1);
      const length = Math.hypot(bond[0], bond[1], bond[2]);
      const target = [0.84, 1.05, 0.9, 1.0, 0.86, 1.03, 0.92][i]!;
      return row(h.label, "H", fractional(cell, add(add(parent, bond, target / length), jitter(i + 10, 0.08))), 0.06);
    }),
  ]), "pyridyl");
  const radiation = { kind: "xray" as const, wavelength: 0.71073, polarization: 0.5 };
  const empty: SingleCrystalDataset = {
    id: "pyridyl-sx", name: "2-(methylthio)pyridine (synthetic, Mo Kα)", radiation,
    reflections: generateReflections(cell, truth.spaceGroup, dMin, 30).map((r) => ({ h: r.h, k: r.k, l: r.l, iObs: 1 })),
  };
  const spec = buildSingleCrystalSpec(truth, empty, { scale: 1 });
  const calc = singleCrystalRefinementComparison(truth, empty, spec.params, spec.bindings).rows;
  const noise = normals(seed);
  const iMax = Math.max(...calc.map((c) => c.fcSq));
  const g = iMax / 2e5;
  const background = 0.002 * iMax;
  const dataset: SingleCrystalDataset = {
    ...empty,
    reflections: calc.map((c) => {
      const sigma = Math.sqrt((Math.max(c.fcSq, 0) + background) * g + (0.02 * c.fcSq) ** 2);
      const spread = Math.sqrt(sigma * sigma + (extraError * c.fcSq) ** 2);
      return { h: c.h, k: c.k, l: c.l, iObs: c.fcSq + spread * noise(), sigma };
    }),
  };
  return { structure: start, dataset, truth };
}

export interface ChiralPage {
  readonly structure: StructureModel;
  readonly dataset: SingleCrystalDataset;
  /** The inversion twin fraction the intensities were computed with (the Flack x of the starting model's hand). */
  readonly flack: number;
}

/**
 * A non-centrosymmetric crystal with an anomalous scatterer for the absolute
 * structure: the Ga, N and C framework of the GSAS-II tutorial's 1b in
 * P2₁2₁2₁, measured with Mo Kα to d = 0.8 Å with every Friedel pair apart,
 * its intensities from an inversion twin of fraction `flack` (Ga's f″ =
 * 1.6 e gives Bijvoet differences of a few per cent). The page loads it
 * untwinned, the positions a few hundredths of an ångström off.
 */
export function chiralPage({ flack = 0.3, seed = 13 }: { readonly flack?: number; readonly seed?: number } = {}): ChiralPage {
  const atoms: [string, string, number, number, number, number][] = [
    ["Ga2", "Ga", 0.20888, 0.61248, 0.17694, 0.035],
    ["N1", "N", 0.3043, 0.55591, -0.04642, 0.035],
    ["N2", "N", 0.403, 0.52312, 0.10749, 0.03],
    ["N3", "N", 0.2682, 0.32177, 0.13327, 0.03],
    ["C1", "C", 0.1045, 0.5938, -0.0822, 0.05],
    ["C3", "C", 0.4086, 0.6396, -0.00213, 0.04],
    ["C4", "C", 0.5411, 0.5931, 0.06152, 0.04],
    ["C5", "C", 0.5383, 0.4558, 0.15634, 0.04],
    ["C6", "C", 0.3965, 0.3749, 0.19306, 0.035],
    ["C7", "C", 0.0556, 0.2903, 0.16437, 0.045],
  ];
  const cif = (jitter: number): string => `data_chiral
_cell_length_a 6.2256
_cell_length_b 12.9136
_cell_length_c 17.4444
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 21 21 21'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
${atoms.map(([label, element, x, y, z, u], i) => `${label} ${element} ${(x + jitter * Math.sin(1.3 * i + 0.2) / 6.2).toFixed(6)} ${(y + jitter * Math.cos(2.1 * i) / 12.9).toFixed(6)} ${(z + jitter * Math.sin(2.9 * i + 1) / 17.4).toFixed(6)} ${u}`).join("\n")}
`;
  const truth = parseCif(cif(0), "chiral");
  const start = parseCif(cif(0.03), "chiral");
  const radiation = { kind: "xray" as const, wavelength: 0.71073, polarization: 0.5 };
  // Every reflection and its Friedel mate, measured apart.
  const unique = generateReflections(truth.cell, truth.spaceGroup, 0.8, 30);
  const indices = unique.flatMap((r) => (r.h === 0 && r.k === 0 && r.l === 0 ? [] : [{ h: r.h, k: r.k, l: r.l }, { h: -r.h, k: -r.k, l: -r.l }]));
  const empty: SingleCrystalDataset = { id: "chiral-sx", name: "chiral Ga complex (synthetic, Mo Kα)", radiation, reflections: indices.map((r) => ({ ...r, iObs: 1 })) };
  const twinned: SingleCrystalDataset = { ...empty, twinLaws: [INVERSION_TWIN] };
  const spec = buildSingleCrystalSpec(truth, twinned, { scale: 1, twinFractions: [flack] });
  const calc = singleCrystalRefinementComparison(truth, twinned, spec.params, spec.bindings).rows;
  const noise = normals(seed);
  const iMax = Math.max(...calc.map((c) => c.fcSq));
  const g = iMax / 4e5;
  const background = 0.001 * iMax;
  const dataset: SingleCrystalDataset = {
    ...empty,
    reflections: calc.map((c) => {
      const sigma = Math.sqrt((Math.max(c.fcSq, 0) + background) * g + (0.01 * c.fcSq) ** 2);
      return { h: c.h, k: c.k, l: c.l, iObs: c.fcSq + sigma * noise(), sigma };
    }),
  };
  return { structure: start, dataset, flack };
}
