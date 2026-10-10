/**
 * Phases a powder pattern often holds besides the sample: the sample
 * environment (an aluminium can or cryostat shields, steel, copper, niobium
 * heat shields, lead shielding), common holders (corundum, graphite) and line
 * standards (Si, LaB₆, CeO₂). Peaks no phase of the model explains are matched
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
];

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
  /** d_observed / d_room-temperature: < 1 a cooled or off-centre part. */
  readonly dScale: number;
  /** The peaks it explains, with the line each sits on. */
  readonly explains: readonly { readonly d: number; readonly hkl: string; readonly relativeIntensity: number }[];
  /** Its strong lines in the range that no unexplained peak sits on (they may hide under the sample's lines). */
  readonly alsoExpected: readonly { readonly d: number; readonly hkl: string; readonly relativeIntensity: number }[];
}

/**
 * The library phases whose lines explain at least one of `peaks`, best first:
 * most peaks explained with their strongest lines, then the closest d scale
 * to 1. `tolerance` is the relative d window of a match (default 0.25 %);
 * the d scale is searched over ±1.5 %.
 */
export function matchKnownPhases(
  peaks: readonly PeakToMatch[],
  radiation: Radiation,
  dRange: { readonly dMin: number; readonly dMax: number },
  tolerance = 0.0025,
): KnownPhaseMatch[] {
  if (peaks.length === 0) return [];
  const out: (KnownPhaseMatch & { score: number })[] = [];
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
      .filter((l) => l.rel >= 0.02);
    let best: { scale: number; explains: KnownPhaseMatch["explains"]; error: number; weight: number } | null = null;
    for (let scale = 0.985; scale <= 1.015 + 1e-9; scale += 0.0005) {
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
      if (!best || weight > best.weight + 1e-9 || (Math.abs(weight - best.weight) <= 1e-9 && error < best.error)) {
        best = { scale, explains, error, weight };
      }
    }
    if (!best) continue;
    const scale = best.scale;
    const explained = new Set(best.explains.map((e) => e.hkl));
    const inRange = (d: number): boolean => scale * d >= dRange.dMin && scale * d <= dRange.dMax;
    const alsoExpected = lines
      .filter((l) => l.rel >= 0.3 && !explained.has(l.hkl) && inRange(l.d))
      .map((l) => ({ d: scale * l.d, hkl: l.hkl, relativeIntensity: l.rel }));
    out.push({ phase: phase.name, source: phase.source, dScale: scale, explains: best.explains, alsoExpected, score: best.weight });
  }
  // A single weak line matches something by chance; rank by the weight of what is explained.
  return out
    .sort((a, b) => b.score - a.score || Math.abs(a.dScale - 1) - Math.abs(b.dScale - 1))
    .map(({ score: _score, ...m }) => m);
}
