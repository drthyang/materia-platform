/**
 * Phases a powder pattern often holds besides the sample: the sample
 * environment (an aluminium can or cryostat shields, steel, copper, niobium
 * heat shields, lead shielding), common holders (corundum, graphite), line
 * standards (Si, LaB₆, CeO₂) and the impurities a synthesis leaves most often
 * (fluorite, NaF, rock salt). Peaks no phase of the model explains are matched
 * against their lines — positions and relative intensities computed for the
 * pattern's own radiation — allowing each phase one d scale: thermal
 * contraction, and a part (a cryostat shield, a can) that does not sit at the
 * sample position and so shifts its lines.
 *
 * A match is a lead, not an identification: the reading says which strong
 * lines of the phase should also be seen, and which are missing.
 */

import { parseCif } from "@/parsers/cif";
import { generateReflections } from "@/core/diffraction/reflections";
import { powderPeakIntensities } from "@/core/diffraction/intensity";
import type { Radiation } from "@/core/diffraction/types";
import type { StructureModel } from "@/core/crystal/types";

interface KnownPhase {
  readonly name: string;
  /** Where it usually comes from. */
  readonly source: string;
  readonly cell: readonly [number, number, number, number, number, number];
  readonly spaceGroup: string;
  readonly setting?: string;
  /** label element x y z */
  readonly sites: readonly string[];
  /** A by-product of the sample's synthesis, so part of the sample (not its surroundings). */
  readonly impurity?: true;
}

/** Room-temperature cells (Å); a d scale absorbs cooling and an off-centre part. */
const LIBRARY: readonly KnownPhase[] = [
  { name: "Al", source: "an aluminium sample can, cryostat heat shields or a holder", cell: [4.0495, 4.0495, 4.0495, 90, 90, 90], spaceGroup: "F m -3 m", sites: ["Al Al 0 0 0"] },
  { name: "V", source: "a vanadium can (nearly invisible to neutrons) or heat shields", cell: [3.0240, 3.0240, 3.0240, 90, 90, 90], spaceGroup: "I m -3 m", sites: ["V V 0 0 0"] },
  { name: "Cu", source: "a copper holder, clamp or thermal link", cell: [3.6150, 3.6150, 3.6150, 90, 90, 90], spaceGroup: "F m -3 m", sites: ["Cu Cu 0 0 0"] },
  { name: "α-Fe", source: "ferritic steel or iron parts", cell: [2.8665, 2.8665, 2.8665, 90, 90, 90], spaceGroup: "I m -3 m", sites: ["Fe Fe 0 0 0"] },
  { name: "austenitic steel", source: "a stainless-steel can, furnace or pressure cell", cell: [3.5900, 3.5900, 3.5900, 90, 90, 90], spaceGroup: "F m -3 m", sites: ["Fe Fe 0 0 0"] },
  { name: "Nb", source: "niobium furnace heat shields", cell: [3.3004, 3.3004, 3.3004, 90, 90, 90], spaceGroup: "I m -3 m", sites: ["Nb Nb 0 0 0"] },
  { name: "Pb", source: "lead shielding", cell: [4.9502, 4.9502, 4.9502, 90, 90, 90], spaceGroup: "F m -3 m", sites: ["Pb Pb 0 0 0"] },
  { name: "Si", source: "a silicon standard or a zero-background plate", cell: [5.4310, 5.4310, 5.4310, 90, 90, 90], spaceGroup: "F d -3 m", setting: "F d -3 m:1", sites: ["Si Si 0 0 0"] },
  { name: "LaB₆", source: "a LaB₆ line standard", cell: [4.1569, 4.1569, 4.1569, 90, 90, 90], spaceGroup: "P m -3 m", sites: ["La La 0 0 0", "B B 0.1996 0.5 0.5"] },
  { name: "CeO₂", source: "a CeO₂ standard", cell: [5.4113, 5.4113, 5.4113, 90, 90, 90], spaceGroup: "F m -3 m", sites: ["Ce Ce 0 0 0", "O O 0.25 0.25 0.25"] },
  { name: "corundum Al₂O₃", source: "an alumina crucible or holder", cell: [4.7589, 4.7589, 12.991, 90, 90, 120], spaceGroup: "R -3 c", setting: "R -3 c:H", sites: ["Al Al 0 0 0.35216", "O O 0.30624 0 0.25"] },
  { name: "graphite", source: "a graphite holder or furnace part", cell: [2.4640, 2.4640, 6.7110, 90, 90, 120], spaceGroup: "P 63/m m c", sites: ["C1 C 0 0 0.25", "C2 C 0.33333 0.66667 0.25"] },
  // The impurities a synthesis leaves most often (round 10: NAC on 11-BM held fluorite).
  { name: "CaF₂", source: "fluorite: a by-product of a fluoride synthesis, a CaF₂ standard or window", cell: [5.4626, 5.4626, 5.4626, 90, 90, 90], spaceGroup: "F m -3 m", sites: ["Ca Ca 0 0 0", "F F 0.25 0.25 0.25"], impurity: true },
  { name: "NaF", source: "unreacted NaF from a fluoride synthesis", cell: [4.6330, 4.6330, 4.6330, 90, 90, 90], spaceGroup: "F m -3 m", sites: ["Na Na 0 0 0", "F F 0.5 0.5 0.5"], impurity: true },
  { name: "NaCl", source: "rock salt: a flux, a chloride precursor or a salt residue", cell: [5.6402, 5.6402, 5.6402, 90, 90, 90], spaceGroup: "F m -3 m", sites: ["Na Na 0 0 0", "Cl Cl 0.5 0.5 0.5"], impurity: true },
];

/** The library's phase names, for the Agent's add_known_phase. */
export function knownPhaseNames(): string[] {
  return LIBRARY.map((p) => p.name);
}

/**
 * A library phase as a further phase of the model: its room-temperature cell,
 * positions and a B of about 0.5 Å² on every site, with its own id. Null for
 * a name the library does not hold.
 */
export function knownPhaseStructure(name: string): StructureModel | null {
  const p = LIBRARY.find((x) => x.name === name);
  if (!p) return null;
  const s = structureOf(p);
  return { ...s, id: `phase-${p.name.replace(/\W+/g, "") || "known"}-${Date.now().toString(36)}`, name: p.name };
}

function structureOf(p: KnownPhase): StructureModel {
  const [a, b, c, al, be, ga] = p.cell;
  const text = [
    `data_${p.name.replace(/\W+/g, "_")}`,
    `_cell_length_a ${a}`, `_cell_length_b ${b}`, `_cell_length_c ${c}`,
    `_cell_angle_alpha ${al}`, `_cell_angle_beta ${be}`, `_cell_angle_gamma ${ga}`,
    `_symmetry_space_group_name_H-M '${p.spaceGroup}'`,
    "loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z", "_atom_site_occupancy", "_atom_site_U_iso_or_equiv",
    ...p.sites.map((s) => `${s} 1 0.006`),
  ].join("\n");
  return parseCif(text, p.name, p.setting ? { spaceGroupSetting: p.setting } : {});
}

const structures = new Map<string, StructureModel>();
function structureFor(p: KnownPhase): StructureModel {
  let s = structures.get(p.name);
  if (!s) {
    s = structureOf(p);
    structures.set(p.name, s);
  }
  return s;
}

export interface PeakToMatch {
  readonly d: number;
  readonly height: number;
}

export interface KnownPhaseMatch {
  readonly phase: string;
  readonly source: string;
  /** A synthesis by-product: part of the sample, its fraction worth refining. */
  readonly impurity: boolean;
  /** d_observed / d_room-temperature: < 1 a cooled or off-centre part. */
  readonly dScale: number;
  /** The peaks it explains, with the line each sits on. */
  readonly explains: readonly { readonly d: number; readonly hkl: string; readonly relativeIntensity: number }[];
  /** Its strong lines in the range that no unexplained peak sits on (they may hide under the sample's lines). */
  readonly alsoExpected: readonly { readonly d: number; readonly hkl: string; readonly relativeIntensity: number }[];
}

/** Lines this weak still count as a phase's (a heavy-atom-free phase's high-angle lines on synchrotron data). */
const WEAKEST_LINE = 0.005;
/** The d-scale search: ±1.5 %, a cooled or off-centre part at the most. */
const SCALE_RANGE = 0.015;

/**
 * The library phases whose lines explain at least one of `peaks`, best first:
 * by the peaks explained, weighed by how plausible the phase's d scale is
 * (1 at its room-temperature cell, ½ at the ±1.5 % edge), then by the
 * strength of the lines that explain them. Isostructural candidates explain
 * the same peaks, and the cell tells them apart: on NAC, fluorite at its own
 * cell beat CeO₂, the same lattice 1 % smaller, that the line strengths alone
 * had preferred. `tolerance` is the relative d window of a match (default
 * 0.25 %).
 */
export function matchKnownPhases(
  peaks: readonly PeakToMatch[],
  radiation: Radiation,
  dRange: { readonly dMin: number; readonly dMax: number },
  tolerance = 0.0025,
): KnownPhaseMatch[] {
  if (peaks.length === 0) return [];
  const out: (KnownPhaseMatch & { score: number; weight: number })[] = [];
  for (const phase of LIBRARY) {
    const model = structureFor(phase);
    // Lines over a range wide enough for any scale in the search.
    const reflections = generateReflections(model.cell, model.spaceGroup, dRange.dMin / 1.02, dRange.dMax * 1.02);
    if (reflections.length === 0) continue;
    const intensities = powderPeakIntensities(model, radiation, reflections, 1, undefined, true);
    const top = Math.max(...intensities.map((p) => p.intensity));
    if (!(top > 0)) continue;
    const lines = reflections
      .map((r, i) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, rel: intensities[i]!.intensity / top }))
      .filter((l) => l.rel >= WEAKEST_LINE);
    let best: { scale: number; explains: KnownPhaseMatch["explains"]; error: number; weight: number; score: number } | null = null;
    for (let scale = 1 - SCALE_RANGE; scale <= 1 + SCALE_RANGE + 1e-9; scale += 0.0005) {
      const explains: { d: number; hkl: string; relativeIntensity: number }[] = [];
      let error = 0;
      let weight = 0;
      for (const p of peaks) {
        let hit: (typeof lines)[number] | undefined;
        for (const l of lines) {
          const e = Math.abs(scale * l.d - p.d) / p.d;
          if (e <= tolerance && (!hit || l.rel > hit.rel)) hit = l;
        }
        if (!hit) continue;
        explains.push({ d: p.d, hkl: hit.hkl, relativeIntensity: hit.rel });
        error += Math.abs(scale * hit.d - p.d) / p.d;
        weight += Math.sqrt(hit.rel);
      }
      if (explains.length === 0) continue;
      const score = explains.length * (1 - Math.abs(scale - 1) / (2 * SCALE_RANGE));
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && (weight > best.weight + 1e-9 || (Math.abs(weight - best.weight) <= 1e-9 && error < best.error)))) {
        best = { scale, explains, error, weight, score };
      }
    }
    if (!best) continue;
    const scale = best.scale;
    const explained = new Set(best.explains.map((e) => e.hkl));
    const inRange = (d: number): boolean => scale * d >= dRange.dMin && scale * d <= dRange.dMax;
    const alsoExpected = lines
      .filter((l) => l.rel >= 0.3 && !explained.has(l.hkl) && inRange(l.d))
      .map((l) => ({ d: scale * l.d, hkl: l.hkl, relativeIntensity: l.rel }));
    out.push({ phase: phase.name, source: phase.source, impurity: !!phase.impurity, dScale: scale, explains: best.explains, alsoExpected, score: best.score, weight: best.weight });
  }
  return out
    .sort((a, b) => b.score - a.score || b.weight - a.weight || Math.abs(a.dScale - 1) - Math.abs(b.dScale - 1))
    .map(({ score: _score, weight: _weight, ...m }) => m);
}
