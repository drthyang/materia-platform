/**
 * The refined structure as a crystallographer reports it: the cell, then per
 * site the fractional coordinates, occupancy and displacement parameter, each
 * as value(esd) in the last digits. Built from the refined phases and the
 * esds of the parameters bound to them: a coordinate's esd from every
 * position mode that moves it (stored + Σ v·axis), a length's from the
 * parameter that sets it. Covariances between modes are ignored (they are
 * orthogonal on a special position).
 */

import type { StructureModel, UnitCell } from "@/core/crystal/types";
import { AFIX } from "@/core/crystal/riding";
import type { RidingRule } from "@/core/crystal/types";

/** How a riding hydrogen is placed, in a few words. */
const PLACED: Readonly<Record<RidingRule["geometry"], string>> = {
  aromatic: "on the bisector", methyl: "a rotating methyl", hydroxyl: "a rotating hydroxyl", methylene: "a CH₂ pair", methine: "opposite three neighbours", fixed: "at its offset", free: "refined",
};
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { parseTie } from "@/core/refinement/constraints";
import { formatWithEsd } from "@/core/export/cif";
import { EIGHT_PI_SQUARED, uEquivalent } from "@/core/crystal/adp";
import { cellVolume, orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { cellVolumeEsd } from "@/core/crystal/cellEsd";
import { mulVec } from "@/core/math/mat3";
import type { Vec3 } from "@/core/math/types";

/**
 * A value with its esd in parentheses, in the last digits: 0.18752(9),
 * 8.46808(10), 0.435(15). The CIF writer's convention (formatWithEsd: two
 * figures when they read 10–19, else one), at most `maxDecimals` decimals.
 */
export function withEsd(value: number, esd: number | undefined, maxDecimals = 6): string {
  if (esd === undefined || !(esd > 0) || !Number.isFinite(esd)) return value.toFixed(Math.min(maxDecimals, 5));
  const text = formatWithEsd(value, esd, maxDecimals);
  if ((text.match(/\.(\d+)\(/)?.[1]?.length ?? 0) <= maxDecimals) return text;
  return `${value.toFixed(maxDecimals)}(${Math.max(1, Math.round(esd * 10 ** maxDecimals))})`;
}

export interface StructureTableSite {
  readonly label: string;
  readonly type: string;
  readonly x: string;
  readonly y: string;
  readonly z: string;
  readonly occupancy: string;
  /** B_iso (Å²) or U_eq (Å²) for an anisotropic site. */
  readonly adp: string;
  /** An anisotropic site's tensor, U11 … U23 (Å², CIF convention), each with its esd from the refined modes. */
  readonly u?: Readonly<Record<"U11" | "U22" | "U33" | "U12" | "U13" | "U23", string>>;
  /** A riding hydrogen: its parent and how it is placed (no esds: it has no parameter of its own). */
  readonly riding?: string;
  /** A hydrogen whose position refines while its U_iso rides on its parent's U_eq. */
  readonly ridingU?: string;
}

export interface StructureTable {
  readonly phase: string;
  readonly spaceGroup: string;
  readonly cell: Record<string, string>;
  readonly volume: string;
  readonly sites: readonly StructureTableSite[];
}

/** A site's esds as numbers, before they are printed: what a comparison with published su's reads. */
interface SiteEsds {
  readonly position: readonly (number | undefined)[];
  /** U11, U22, U33, U12, U13, U23. */
  readonly u?: readonly (number | undefined)[];
  readonly occupancy?: number;
  /** The values themselves, unrounded: the position, and B (isotropic) or U_eq, with its esd. */
  readonly value: { readonly position: Vec3; readonly adp: number; readonly adpEsd?: number };
}

/** Each table's esds as numbers, by site label: kept beside the table, out of what the tool prints. */
const RAW_ESDS = new WeakMap<StructureTable, ReadonlyMap<string, SiteEsds>>();

export function structureTable(
  phase: StructureModel,
  phaseIndex: number,
  parameters: readonly RefinementParameter[],
  bindings: readonly ParameterBinding[],
  esd: Readonly<Record<string, number>>,
): StructureTable {
  // A multi-phase spec prefixes phase i's ids with p{i}_ and binds them to the phase's id.
  const mine = bindings.filter((b) => b.targetId === phase.id || (phaseIndex === 0 && !/^p\d+_/.test(b.parameterId)));
  const free = new Set(parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.id));
  const byId = new Map(parameters.map((p) => [p.id, p]));
  // A free row's esd; a tied row the one the page passes (esdsWithTies), else, tied to a free one ("= f·leader"), |f| × the leader's.
  const err = (id: string): number | undefined => {
    if (free.has(id)) return esd[id];
    const p = byId.get(id);
    if (!p?.expression) return undefined;
    if (esd[id] !== undefined) return esd[id];
    try {
      const tie = parseTie(p.expression);
      if (tie.kind !== "linear" || !free.has(tie.refId)) return undefined;
      const e = esd[tie.refId];
      return e !== undefined ? Math.abs(tie.factor) * e : undefined;
    } catch {
      return undefined;
    }
  };
  const cellEsd: Record<string, number> = {};
  for (const b of mine) {
    if ((b.kind === "cellLength" || b.kind === "cellAngle") && b.targetKey && free.has(b.parameterId)) {
      const e = err(b.parameterId);
      if (e !== undefined) cellEsd[b.targetKey] = e;
    }
  }
  const c = phase.cell;
  // A refined cell's esds, else those the structure file gives a cell held fixed (ZERR, a CIF's su).
  const su: Partial<Record<keyof UnitCell, number>> = Object.keys(cellEsd).length > 0 ? cellEsd : phase.cellSu ?? {};
  const cell: Record<string, string> = {
    a: withEsd(c.a, su.a),
    b: withEsd(c.b, su.b),
    c: withEsd(c.c, su.c),
    alpha: withEsd(c.alpha, su.alpha, 4),
    beta: withEsd(c.beta, su.beta, 4),
    gamma: withEsd(c.gamma, su.gamma, 4),
  };
  const volume = cellVolume(c);
  const volumeEsd = cellVolumeEsd(c, su, phase.spaceGroup.operations);
  const ridingOf = new Map((phase.riding ?? []).map((r) => [r.site, r]));
  const raw = new Map<string, SiteEsds>();
  const sites = phase.sites.map((site): StructureTableSite => {
    const own = mine.filter((b) => b.targetKey === site.label && err(b.parameterId) !== undefined);
    const posVar = [0, 0, 0];
    // A tensor is Σ_m c_m·basis_m over its symmetry modes: each U^ij and U_eq carry the modes' esds (taken as independent).
    const uVar = [0, 0, 0, 0, 0, 0];
    let uEqVar = 0;
    let occEsd: number | undefined;
    let adpEsd: number | undefined;
    for (const b of own) {
      const e = err(b.parameterId);
      if (e === undefined) continue;
      if (b.kind === "positionShift" && b.axis) for (let i = 0; i < 3; i++) posVar[i]! += (b.axis[i]! * e) ** 2;
      if (b.kind === "atomX") posVar[0]! += e * e;
      if (b.kind === "atomY") posVar[1]! += e * e;
      if (b.kind === "atomZ") posVar[2]! += e * e;
      if (b.kind === "occupancy") occEsd = e;
      if (b.kind === "bIso") adpEsd = e;
      if (b.kind === "uAniso" && b.uBasis) {
        for (let i = 0; i < 6; i++) uVar[i]! += (b.uBasis[i]! * e) ** 2;
        uEqVar += (uEquivalent(b.uBasis, phase.cell) * e) ** 2;
      }
    }
    const pos = site.position.map((v, i) => withEsd(v, posVar[i]! > 0 ? Math.sqrt(posVar[i]!) : undefined));
    const sd = (v: number): number | undefined => (v > 0 ? Math.sqrt(v) : undefined);
    const adpValue = site.adp.kind === "isotropic" ? site.adp.bIso : uEquivalent(site.adp.uAniso, phase.cell);
    const adpSu = site.adp.kind === "isotropic" ? adpEsd : sd(uEqVar);
    raw.set(site.label, {
      position: posVar.map(sd), ...(site.adp.kind === "anisotropic" ? { u: uVar.map(sd) } : {}), ...(occEsd !== undefined ? { occupancy: occEsd } : {}),
      value: { position: [site.position[0], site.position[1], site.position[2]], adp: adpValue, ...(adpSu !== undefined ? { adpEsd: adpSu } : {}) },
    });
    const adp = site.adp.kind === "isotropic"
      ? `B ${withEsd(site.adp.bIso, adpEsd, 4)}`
      : `Ueq ${withEsd(uEquivalent(site.adp.uAniso, phase.cell), sd(uEqVar), 5)}`;
    const u = site.adp.kind === "anisotropic"
      ? Object.fromEntries((["U11", "U22", "U33", "U12", "U13", "U23"] as const).map((name, i) => [name, withEsd((site.adp as { uAniso: readonly number[] }).uAniso[i]!, sd(uVar[i]!), 5)])) as Record<"U11" | "U22" | "U33" | "U12" | "U13" | "U23", string>
      : undefined;
    const rule = ridingOf.get(site.label);
    const uRides = !rule ? "" : rule.uShared !== undefined ? `U_iso shared and refined (B_shared_${rule.uShared})` : `U_iso = ${rule.uFactor}·U_eq(${rule.parent})`;
    const riding = rule && rule.geometry !== "free" ? `rides on ${rule.parent} (AFIX ${AFIX[rule.geometry]}, ${PLACED[rule.geometry]}), ${uRides}` : undefined;
    // A hydrogen whose position refines on its own: only its U rides.
    const ridingU = rule?.geometry === "free" ? `${uRides}; the position refines` : undefined;
    return { label: site.label, type: site.element, x: pos[0]!, y: pos[1]!, z: pos[2]!, occupancy: withEsd(site.occupancy, occEsd, 4), adp, ...(u ? { u } : {}), ...(riding ? { riding } : {}), ...(ridingU ? { ridingU } : {}) };
  });
  const table: StructureTable = {
    phase: phase.name || phase.id,
    spaceGroup: phase.spaceGroup.hermannMauguin ?? String(phase.spaceGroup.number ?? "?"),
    cell,
    volume: withEsd(volume, volumeEsd, 3),
    sites,
  };
  RAW_ESDS.set(table, raw);
  return table;
}

/** A value(esd) as printed, back to numbers: "0.41020(7)" → 0.4102 ± 0.00007. */
export function parseEsd(text: string): { value: number; esd?: number } {
  const m = text.match(/(-?\d+(?:\.(\d+))?)(?:\((\d+)\))?/);
  if (!m) return { value: NaN };
  const value = Number(m[1]);
  return m[3] !== undefined ? { value, esd: Number(m[3]) * 10 ** -(m[2]?.length ?? 0) } : { value };
}

/**
 * The refined structure against the structure as loaded (a published
 * refinement's CIF): each site's shift in Å and in esds of the refined
 * position, and its U_eq (or B) against the loaded value in esds of the
 * refined one; riding hydrogens, which have no parameter, are left out. The
 * sites beyond 2 esds are listed; the summary gives the largest of each.
 */
export function compareWithLoaded(table: StructureTable, refined: StructureModel, loaded: StructureModel): Record<string, unknown> {
  const m = orthogonalizationMatrix(refined.cell);
  const byLabel = new Map(loaded.sites.map((site) => [site.label, site]));
  const rows = table.sites.flatMap((row) => {
    const was = byLabel.get(row.label);
    if (!was || row.riding) return [];
    const printed = [parseEsd(row.x), parseEsd(row.y), parseEsd(row.z)];
    // The values and esds as computed, not as printed: rounded to the esd's last digit they would add their rounding to every shift and ratio.
    const raw = RAW_ESDS.get(table)?.get(row.label);
    const posEsd = [0, 1, 2].map((i) => raw?.position[i] ?? printed[i]!.esd);
    const now = raw?.value.position ?? [printed[0]!.value, printed[1]!.value, printed[2]!.value];
    const delta: Vec3 = [now[0]! - was.position[0], now[1]! - was.position[1], now[2]! - was.position[2]];
    const cart = mulVec(m, delta);
    const shift = Math.hypot(cart[0], cart[1], cart[2]);
    // The shift's esd along its own direction, from the coordinates' esds.
    const unit = shift > 0 ? [cart[0] / shift, cart[1] / shift, cart[2] / shift] : [0, 0, 0];
    const shiftEsd = Math.sqrt([0, 1, 2].reduce((sum, i) => {
      const g = unit[0]! * m[0][i]! + unit[1]! * m[1][i]! + unit[2]! * m[2][i]!;
      return sum + (g * (posEsd[i] ?? 0)) ** 2;
    }, 0));
    const printedAdp = parseEsd(row.adp.replace(/^(Ueq|B)\s+/, ""));
    const adp = raw ? { value: raw.value.adp, esd: raw.value.adpEsd } : printedAdp;
    const isU = row.adp.startsWith("Ueq");
    const wasAdp = isU
      ? (was.adp.kind === "anisotropic" ? uEquivalent(was.adp.uAniso, refined.cell) : was.adp.bIso / EIGHT_PI_SQUARED)
      : (was.adp.kind === "isotropic" ? was.adp.bIso : EIGHT_PI_SQUARED * uEquivalent(was.adp.uAniso, refined.cell));
    // The refined esds against the published su's, where the CIF gave them.
    // U_eq is left out: the CIF's su comes from the covariance of the U^ij, which this table does not carry.
    const su = was.su;
    const positionRatios = su ? [0, 1, 2].flatMap((i) => (posEsd[i] && su.position[i]! > 0 ? [posEsd[i]! / su.position[i]!] : [])) : [];
    const keys = ["U11", "U22", "U33", "U12", "U13", "U23"] as const;
    const uRatios = su?.uAniso && row.u ? keys.flatMap((k, i) => { const e = raw?.u?.[i] ?? parseEsd(row.u![k]).esd; return e && su.uAniso![i]! > 0 ? [e / su.uAniso![i]!] : []; }) : [];
    const occEsd = raw?.occupancy ?? parseEsd(row.occupancy).esd;
    const occRatio = su && occEsd && su.occupancy > 0 ? occEsd / su.occupancy : undefined;
    return [{
      label: row.label,
      shift, shiftEsds: shiftEsd > 0 ? shift / shiftEsd : undefined,
      adpText: row.adp, wasAdp, isU,
      adpEsds: adp.esd ? (adp.value - wasAdp) / adp.esd : undefined,
      ratio: wasAdp > 0 ? adp.value / wasAdp : undefined,
      positionRatios, uRatios, occRatio,
    }];
  });
  if (rows.length === 0) return { note: "no site to compare: none of the refined sites is in the loaded structure" };
  const largest = <T>(xs: readonly T[], key: (x: T) => number): T => xs.reduce((a, b) => (key(b) > key(a) ? b : a));
  const far = largest(rows, (r) => r.shiftEsds ?? 0);
  const big = largest(rows, (r) => Math.abs(r.adpEsds ?? 0));
  const ratios = rows.flatMap((r) => (r.ratio !== undefined ? [r.ratio] : []));
  const beyond = rows.filter((r) => (r.shiftEsds ?? 0) > 2 || Math.abs(r.adpEsds ?? 0) > 2);
  const sig = (v: number, d = 2): string => v.toFixed(d);
  return {
    sites: rows.length,
    positions: `largest shift ${shift4(far.shift)} Å at ${far.label}${far.shiftEsds !== undefined ? ` (${sig(far.shiftEsds, 1)} esd)` : ""}; ${rows.filter((r) => (r.shiftEsds ?? 0) > 3).length} site(s) beyond 3 esd`,
    adps: `refined/loaded ${rows[0]!.isU ? "U_eq" : "B"} ${ratios.length ? `${sig(Math.min(...ratios), 3)}–${sig(Math.max(...ratios), 3)}, mean ${sig(ratios.reduce((a, b) => a + b, 0) / ratios.length, 3)}` : "—"}; largest difference at ${big.label} (${big.adpEsds !== undefined ? `${sig(big.adpEsds, 1)} esd` : "no esd"})`,
    ...(beyond.length ? {
      beyond2Esd: beyond.map((r) => `${r.label}: shift ${shift4(r.shift)} Å${r.shiftEsds !== undefined ? ` (${sig(r.shiftEsds, 1)} esd)` : ""}, ${r.adpText} against ${r.wasAdp.toPrecision(4)} loaded${r.adpEsds !== undefined ? ` (${sig(r.adpEsds, 1)} esd)` : ""}`),
    } : {}),
    ...(esdComparison(rows) ? { esds: esdComparison(rows) } : {}),
    note: rows.some((r) => r.positionRatios.length > 0)
      ? "The loaded structure is what the page started from (for a CIF from a published refinement, that refinement's values, with its su's); shifts are in the refined esds, and `esds` sets the refined esds against the published ones."
      : "The loaded structure is what the page started from (for a CIF from a published refinement, that refinement's values); its own esds are not known here, so differences are in the refined esds.",
  };
}

/**
 * The refined esds against the published su's, each kind as the ratio
 * refined/published: its median and range over the parameters both give. The
 * same data and model give the same esds; a ratio away from 1 says the two
 * refinements differ in the weights, the model, or how the esds were scaled.
 */
function esdComparison(rows: readonly { positionRatios: readonly number[]; uRatios: readonly number[]; occRatio: number | undefined }[]): Record<string, string> | null {
  const kinds: [string, number[]][] = [
    ["positions", rows.flatMap((r) => r.positionRatios)],
    ["uij", rows.flatMap((r) => r.uRatios)],
    ["occupancies", rows.flatMap((r) => (r.occRatio !== undefined ? [r.occRatio] : []))],
  ];
  const out: Record<string, string> = {};
  for (const [name, ratios] of kinds) {
    if (ratios.length === 0) continue;
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[sorted.length >> 1]! : (sorted[(sorted.length >> 1) - 1]! + sorted[sorted.length >> 1]!) / 2;
    out[name] = ratios.length === 1 ? `${median.toFixed(2)}` : `median ${median.toFixed(2)} (${sorted[0]!.toFixed(2)}–${sorted[sorted.length - 1]!.toFixed(2)}, ${ratios.length})`;
  }
  if (Object.keys(out).length === 0) return null;
  return { reading: "refined esd / published su, each kind's median (range, count): 1 when both refinements weigh the same data and model alike. The published su is rounded to one or two digits (the rule of 19), so a single ratio is good to 5–25 %; the median is the reading", ...out };
}

const shift4 = (v: number): string => v.toFixed(4);
