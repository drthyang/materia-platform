/**
 * The refined structure as a crystallographer reports it: the cell, then per
 * site the fractional coordinates, occupancy and displacement parameter, each
 * as value(esd) in the last digits. Built from the refined phases and the
 * esds of the parameters bound to them: a coordinate's esd from every
 * position mode that moves it (stored + Σ v·axis), a length's from the
 * parameter that sets it. Covariances between modes are ignored (they are
 * orthogonal on a special position).
 */

import type { StructureModel } from "@/core/crystal/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { parseTie } from "@/core/refinement/constraints";
import { uEquivalent } from "@/core/crystal/adp";

/** A value with its esd in parentheses, in the last digits: 0.18752(9), 8.46808(10). */
export function withEsd(value: number, esd: number | undefined, maxDecimals = 6): string {
  if (esd === undefined || !(esd > 0) || !Number.isFinite(esd)) return value.toFixed(Math.min(maxDecimals, 5));
  // Two significant digits of esd when they start with 1, else one (the convention).
  let decimals = Math.max(0, -Math.floor(Math.log10(esd)));
  let digits = Math.round(esd * 10 ** decimals);
  if (digits < 2) {
    decimals += 1;
    digits = Math.round(esd * 10 ** decimals);
  }
  if (decimals > maxDecimals) {
    decimals = maxDecimals;
    digits = Math.max(1, Math.round(esd * 10 ** decimals));
  }
  return `${value.toFixed(decimals)}(${digits})`;
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
}

export interface StructureTable {
  readonly phase: string;
  readonly spaceGroup: string;
  readonly cell: Record<string, string>;
  readonly volume: string;
  readonly sites: readonly StructureTableSite[];
}

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
  // A free row's esd; a row tied to a free one ("= f·leader") carries |f| × the leader's.
  const err = (id: string): number | undefined => {
    if (free.has(id)) return esd[id];
    const p = byId.get(id);
    if (!p?.expression) return undefined;
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
  const cell: Record<string, string> = {
    a: withEsd(c.a, cellEsd.a),
    b: withEsd(c.b, cellEsd.b),
    c: withEsd(c.c, cellEsd.c),
    alpha: withEsd(c.alpha, cellEsd.alpha, 4),
    beta: withEsd(c.beta, cellEsd.beta, 4),
    gamma: withEsd(c.gamma, cellEsd.gamma, 4),
  };
  const rad = Math.PI / 180;
  const [ca, cb, cg] = [Math.cos(c.alpha * rad), Math.cos(c.beta * rad), Math.cos(c.gamma * rad)];
  const volume = c.a * c.b * c.c * Math.sqrt(Math.max(1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg, 0));
  const relV = Math.sqrt(["a", "b", "c"].reduce((s, k) => s + ((cellEsd[k] ?? 0) / (c as unknown as Record<string, number>)[k]!) ** 2, 0));
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
    const adp = site.adp.kind === "isotropic"
      ? `B ${withEsd(site.adp.bIso, adpEsd, 4)}`
      : `Ueq ${withEsd(uEquivalent(site.adp.uAniso, phase.cell), sd(uEqVar), 5)}`;
    const u = site.adp.kind === "anisotropic"
      ? Object.fromEntries((["U11", "U22", "U33", "U12", "U13", "U23"] as const).map((name, i) => [name, withEsd((site.adp as { uAniso: readonly number[] }).uAniso[i]!, sd(uVar[i]!), 5)])) as Record<"U11" | "U22" | "U33" | "U12" | "U13" | "U23", string>
      : undefined;
    return { label: site.label, type: site.element, x: pos[0]!, y: pos[1]!, z: pos[2]!, occupancy: withEsd(site.occupancy, occEsd, 4), adp, ...(u ? { u } : {}) };
  });
  return {
    phase: phase.name || phase.id,
    spaceGroup: phase.spaceGroup.hermannMauguin ?? String(phase.spaceGroup.number ?? "?"),
    cell,
    volume: withEsd(volume, relV > 0 ? volume * relV : undefined, 3),
    sites,
  };
}
