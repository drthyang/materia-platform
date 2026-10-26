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
import { pct } from "@/core/math/precision";

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
/** Draws of random peaks the chance of a match is measured on. */
export const CHANCE_DRAWS = 500;
/** A lead random peaks match as well this often or more is not named. */
export const CHANCE_LIMIT = 0.01;

type DRange = { readonly dMin: number; readonly dMax: number };

interface Line {
  readonly d: number;
  readonly hkl: string;
  readonly rel: number;
}

/** A library phase's lines over a range wide enough for any scale in the search, by d. */
interface PhaseLines {
  readonly phase: KnownPhase;
  readonly lines: readonly Line[];
}

function libraryLines(radiation: Radiation, dRange: DRange): PhaseLines[] {
  const out: PhaseLines[] = [];
  for (const phase of LIBRARY) {
    const model = structureFor(phase);
    const reflections = generateReflections(model.cell, model.spaceGroup, dRange.dMin / 1.02, dRange.dMax * 1.02);
    if (reflections.length === 0) continue;
    const intensities = powderPeakIntensities(model, radiation, reflections, 1, undefined, true);
    const top = intensities.reduce((m, p) => Math.max(m, p.intensity), 0);
    if (!(top > 0)) continue;
    const lines = reflections
      .map((r, i) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, rel: intensities[i]!.intensity / top }))
      .filter((l) => l.rel >= WEAKEST_LINE)
      .sort((a, b) => a.d - b.d);
    out.push({ phase, lines });
  }
  return out;
}

/** The strongest of `lines` whose d, times `scale`, is within `tolerance` of `d`. */
function strongestNear(lines: readonly Line[], d: number, scale: number, tolerance: number): Line | undefined {
  const lo = (d * (1 - tolerance)) / scale;
  const hi = (d * (1 + tolerance)) / scale;
  let a = 0;
  let b = lines.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (lines[m]!.d < lo) a = m + 1;
    else b = m;
  }
  let hit: Line | undefined;
  for (let i = a; i < lines.length && lines[i]!.d <= hi; i++) if (!hit || lines[i]!.rel > hit.rel) hit = lines[i];
  return hit;
}

/** How plausible a d scale is: 1 at the room-temperature cell, ½ at the edge of the search. */
const plausibility = (scale: number): number => 1 - Math.abs(scale - 1) / (2 * SCALE_RANGE);

type Ranked = KnownPhaseMatch & { readonly score: number; readonly weight: number };

function rank(peaks: readonly PeakToMatch[], table: readonly PhaseLines[], dRange: DRange, tolerance: number): Ranked[] {
  const out: Ranked[] = [];
  for (const { phase, lines } of table) {
    let best: { scale: number; explains: KnownPhaseMatch["explains"]; error: number; weight: number; score: number } | null = null;
    for (let scale = 1 - SCALE_RANGE; scale <= 1 + SCALE_RANGE + 1e-9; scale += 0.0005) {
      const explains: { d: number; hkl: string; relativeIntensity: number }[] = [];
      // Each line counts once, however many peaks sit on it.
      const lit = new Map<string, number>();
      let error = 0;
      for (const p of peaks) {
        const hit = strongestNear(lines, p.d, scale, tolerance);
        if (!hit) continue;
        explains.push({ d: p.d, hkl: hit.hkl, relativeIntensity: hit.rel });
        error += Math.abs(scale * hit.d - p.d) / p.d;
        lit.set(hit.hkl, hit.rel);
      }
      if (explains.length === 0) continue;
      let weight = 0;
      for (const rel of lit.values()) weight += Math.sqrt(rel);
      const score = lit.size * plausibility(scale);
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
  return out.sort((a, b) => b.score - a.score || b.weight - a.weight || Math.abs(a.dScale - 1) - Math.abs(b.dScale - 1));
}

const unranked = ({ score: _score, weight: _weight, ...m }: Ranked): KnownPhaseMatch => m;

/** What the chance is measured on: the lines' strength (Σ√I), weighed by the d scale's plausibility, for a match the rules pass. */
const strengthOf = (m: Ranked): number => (caseOf(m) === "candidate" ? m.weight * plausibility(m.dScale) : 0);

/**
 * The library phases whose lines explain at least one of `peaks`, best first:
 * by the lines explained (a line counts once, however many peaks sit on it),
 * weighed by how plausible the phase's d scale is (1 at its room-temperature
 * cell, ½ at the ±1.5 % edge), then by the strength of those lines.
 * Isostructural candidates explain the same peaks, and the cell tells them
 * apart: on NAC, fluorite at its own cell beat CeO₂, the same lattice 1 %
 * smaller, that the line strengths alone had preferred. `tolerance` is the
 * relative d window of a match (default 0.25 %).
 */
export function matchKnownPhases(peaks: readonly PeakToMatch[], radiation: Radiation, dRange: DRange, tolerance = 0.0025): KnownPhaseMatch[] {
  if (peaks.length === 0) return [];
  return rank(peaks, libraryLines(radiation, dRange), dRange, tolerance).map(unranked);
}

export interface PeakIdentification {
  /** Best first, as matchKnownPhases ranks them. */
  readonly candidates: readonly KnownPhaseMatch[];
  /**
   * What the lead amounts to. `named`: it explains two lines or more (or one
   * strong line, with no other strong line in the range), none of its
   * strongest lines (0.8 of the strongest or more) is missing, and random
   * peaks match as well less often than CHANCE_LIMIT. `chance`: all of that
   * but the last. `strongLineMissing`: one of its strongest lines is not
   * among the peaks. `weak`: one weak line. `none`: no candidate.
   */
  readonly verdict: "named" | "chance" | "strongLineMissing" | "weak" | "none";
  /** The lead's strongest line the peaks miss (`strongLineMissing`). */
  readonly strongestMissing?: KnownPhaseMatch["alsoExpected"][number];
  /**
   * For `named` and `chance`: the fraction of draws of as many peaks, at
   * random over the range (uniform in 1/d), in which some library phase
   * matches as unusually as the lead does these peaks.
   */
  readonly chance?: number;
}

function caseOf(lead: KnownPhaseMatch): Exclude<PeakIdentification["verdict"], "named" | "chance" | "none"> | "candidate" {
  // A phase whose strongest line is missing is a doubtful match, however many weak lines it explains
  // (round 10: graphite offered for two weak NAC lines without its 002).
  if (lead.alsoExpected.some((e) => e.relativeIntensity >= 0.8)) return "strongLineMissing";
  const lines = new Set(lead.explains.map((e) => e.hkl)).size;
  return lines >= 2 || (lines === 1 && lead.explains[0]!.relativeIntensity >= 0.8 && lead.alsoExpected.length === 0) ? "candidate" : "weak";
}

/** Uniform deviates in [0, 1): mulberry32, seeded, so a reading repeats. */
function uniforms(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * identify_peaks: the candidates, and whether the lead is a match or what
 * random peaks give as often. With 15 phases, each with its own d scale, a few
 * peaks anywhere sit on some phase's lines: on random d-lists the rules
 * without the chance named a phase in up to 12 % of lists (λ 2.41 Å neutrons,
 * eight to twelve peaks), most often corundum, whose lines are dense.
 *
 * The chance is measured, not modelled: as many peaks drawn CHANCE_DRAWS
 * times over the range (a fixed seed, so the reading repeats). Each phase is
 * held to its own draws, so a dense phase needs more lines than a sparse one:
 * its strength (Σ√I of the lines it explains, times its d scale's
 * plausibility, when it passes the rules) gives how often random peaks give
 * it as much. The chance is how often a draw's least likely phase is as
 * unlikely as the lead, which covers the search over every phase at once.
 */
export function identifyPeaks(peaks: readonly PeakToMatch[], radiation: Radiation, dRange: DRange, tolerance = 0.0025): PeakIdentification {
  if (peaks.length === 0) return { candidates: [], verdict: "none" };
  const table = libraryLines(radiation, dRange);
  const ranked = rank(peaks, table, dRange, tolerance);
  const candidates = ranked.map(unranked);
  const lead = ranked[0];
  if (!lead) return { candidates, verdict: "none" };
  const found = caseOf(lead);
  if (found === "strongLineMissing") return { candidates, verdict: found, strongestMissing: lead.alsoExpected.find((e) => e.relativeIntensity >= 0.8)! };
  if (found === "weak") return { candidates, verdict: found };
  // Each draw's strength for every phase.
  const qMin = 1 / dRange.dMax;
  const qSpan = 1 / dRange.dMin - qMin;
  const random = uniforms(0x5eed);
  const names = table.map((t) => t.phase.name);
  const drawn: number[][] = names.map(() => []);
  for (let draw = 0; draw < CHANCE_DRAWS; draw++) {
    const ds = peaks.map(() => ({ d: 1 / (qMin + random() * qSpan), height: 0 }));
    const byPhase = new Map(rank(ds, table, dRange, tolerance).map((m) => [m.phase, m] as const));
    names.forEach((name, i) => {
      const m = byPhase.get(name);
      drawn[i]!.push(m ? strengthOf(m) : 0);
    });
  }
  // A phase's own tail: how often random peaks give it this strength or more.
  const sorted = drawn.map((w) => [...w].sort((a, b) => a - b));
  const tail = (i: number, w: number): number => {
    if (!(w > 0)) return 1;
    const xs = sorted[i]!;
    let a = 0;
    let b = xs.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (xs[m]! < w - 1e-9) a = m + 1;
      else b = m;
    }
    return (xs.length - a) / xs.length;
  };
  // Against every phase at once: how often a draw's least likely phase is as unlikely as the lead.
  const own = tail(names.indexOf(lead.phase), strengthOf(lead));
  let asRare = 0;
  for (let draw = 0; draw < CHANCE_DRAWS; draw++) {
    let least = 1;
    for (let i = 0; i < names.length; i++) least = Math.min(least, tail(i, drawn[i]![draw]!));
    if (least <= own) asRare++;
  }
  const chance = asRare / CHANCE_DRAWS;
  return { candidates, verdict: chance < CHANCE_LIMIT ? "named" : "chance", chance };
}

/** The tools a surface has that the identification's reading names. */
export interface IdentifyReadingTools {
  /** The tool that adds a library phase to the model (add_known_phase). */
  readonly add?: string;
}

/**
 * identify_peaks' lead in words: the phase named, with the lines it explains,
 * its d scale, where it usually comes from and the chance of so good a match
 * by accident; or why none is named. `count` is the number of peaks read.
 */
export function identifyReading(count: number, id: PeakIdentification, tools: IdentifyReadingTools = {}): string {
  const { candidates, verdict, strongestMissing, chance } = id;
  const lead = candidates[0];
  const of = `${count} peak${count === 1 ? "" : "s"}`;
  if (!lead || verdict === "none") return `None of the ${of} matches a common sample-environment phase or standard: an impurity of the sample, magnetic order, or a feature to put to the user.`;
  const lines = lead.explains.map((e) => e.hkl).filter((h, i, all) => all.indexOf(h) === i).join(", ");
  const chanceText = chance === undefined ? "" : chance === 0
    ? `random peaks never match a library phase as well (${CHANCE_DRAWS} draws of ${count} over this range)`
    : `random peaks match a library phase as well in ${pct(chance)} % of draws (${CHANCE_DRAWS} draws of ${count} over this range)`;
  const add = (what: string): string => (tools.add ? `add ${what} (${tools.add})` : `add ${what} to the model`);
  if (verdict === "strongLineMissing" && strongestMissing) {
    return `No convincing match: ${lead.phase} would explain ${lead.explains.length} of ${count} (${lines}), but its strongest line ${strongestMissing.hkl} at d ${strongestMissing.d.toFixed(3)} Å is not among the peaks. Unless that line hides under one of the sample's, report the peaks as unexplained.`;
  }
  if (verdict === "named") {
    const also = lead.alsoExpected.length ? ` Its strong lines ${lead.alsoExpected.map((e) => `${e.hkl} at d ${e.d.toFixed(3)} Å`).join(", ")} should also be seen (they may hide under the sample's lines).` : "";
    const next = lead.impurity
      ? ` An impurity of the sample: put it to the user, and ${add("it")} so its lines are modelled and its weight fraction refines.`
      : ` Put it to the user: ${add("the phase")} or leave the lines unmodelled and say so; it is not part of the sample.`;
    return `${lead.explains.length} of ${of} match ${lead.phase} (${lines}), with its d-spacings × ${lead.dScale.toFixed(4)} — usually ${lead.source}; ${chanceText}.${also}${next}`;
  }
  if (verdict === "chance") return `Not enough to name a phase: ${lead.phase} would explain ${lead.explains.length} of ${of} (${lines}), but ${chanceText}. Report the peaks to the user as unexplained, ${lead.phase} a possibility to check.`;
  return `Only weak or single matches (best: ${lead.phase} ${lines}): not enough to name a phase. Report the peaks to the user as unexplained.`;
}
