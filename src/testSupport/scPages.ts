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
import type { ExtinctionModel, SingleCrystalDataset } from "@/core/diffraction/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { dSpacing } from "@/core/crystal/unitCell";
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
