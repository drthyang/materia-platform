/**
 * Riding hydrogens, as SHELXL refines them: a hydrogen's position follows the
 * atom it is bonded to and its U_iso is 1.2 (1.5 for methyl and hydroxyl)
 * times its parent's U_eq, so it carries no parameter of its own. X-ray data
 * cannot place a hydrogen independently — its one electron sits displaced into
 * the bond — and this is the treatment a refinement is published with.
 *
 * `ridingRules` finds each hydrogen's parent and the parent's heavy neighbours
 * (bond lengths by covalent radii, symmetry images included); `applyRiding`
 * places the hydrogens from their parents' current positions and ADPs.
 */

import type { AtomSite, RidingRule, StructureModel } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { inverse, mulVec } from "@/core/math/mat3";
import { EIGHT_PI_SQUARED, isHydrogen, uEquivalent } from "@/core/crystal/adp";

/** Covalent radii (Å), Cordero et al. (2008), for the common elements; 0.75 otherwise. */
const COVALENT: Readonly<Record<string, number>> = {
  H: 0.31, D: 0.31, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Se: 1.2, Br: 1.2, I: 1.39,
};
const radius = (element: string): number => COVALENT[element.replace(/[^A-Za-z]/g, "")] ?? 0.75;
const bonded = (a: AtomSite, b: AtomSite, distance: number): boolean => distance > 0.5 && distance < radius(a.element) + radius(b.element) + 0.4;

/** Every symmetry image of `site` within reach of `from`: its label, operation index, lattice translation and Cartesian distance. */
function imagesNear(model: StructureModel, from: Vec3, site: AtomSite, reach: number): { op: number; cell: [number, number, number]; distance: number }[] {
  const m = orthogonalizationMatrix(model.cell);
  const out: { op: number; cell: [number, number, number]; distance: number }[] = [];
  model.spaceGroup.operations.forEach((op, o) => {
    const p = mulVec(op.rotation, site.position);
    const base: Vec3 = [p[0] + op.translation[0], p[1] + op.translation[1], p[2] + op.translation[2]];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const shift: [number, number, number] = [Math.round(from[0] - base[0]) + i, Math.round(from[1] - base[1]) + j, Math.round(from[2] - base[2]) + k];
      const d = mulVec(m, [base[0] + shift[0] - from[0], base[1] + shift[1] - from[1], base[2] + shift[2] - from[2]]);
      const distance = Math.hypot(d[0], d[1], d[2]);
      if (distance <= reach && !out.some((x) => Math.abs(x.distance - distance) < 1e-6)) out.push({ op: o, cell: shift, distance });
    }
  });
  return out;
}

export interface RidingSetup {
  readonly rules: RidingRule[];
  /** Hydrogens with no heavy atom within bonding distance: left as they are. */
  readonly unbonded: string[];
}

export interface RidingOptions {
  /** U_iso as this multiple of the parent's U_eq, for every hydrogen (default 1.2; 1.5 for methyl and hydroxyl). */
  readonly uFactor?: number;
  /** X–H of the sp² hydrogens placed on the bisector (Å); default: each at its present distance. */
  readonly distance?: number;
}

/**
 * The riding rules for every hydrogen of the model: its parent (the nearest
 * heavy atom within bonding distance), "aromatic" geometry for a parent with
 * exactly two heavy neighbours and this one hydrogen (an sp² C–H, SHELXL's
 * AFIX 43), "fixed" otherwise (AFIX 3: the present offset), and U_iso =
 * 1.5·U_eq for methyl and hydroxyl hydrogens, 1.2 otherwise.
 */
export function ridingRules(model: StructureModel, options: RidingOptions = {}): RidingSetup {
  const { uFactor, distance } = options;
  const heavy = model.sites.filter((s) => !isHydrogen(s));
  const hydrogens = model.sites.filter((s) => isHydrogen(s));
  const rules: RidingRule[] = [];
  const unbonded: string[] = [];
  // Each hydrogen's parent: the nearest heavy image within bonding distance.
  const parentOf = new Map<string, { site: AtomSite; distance: number; op: number; cell: [number, number, number] }>();
  for (const h of hydrogens) {
    let best: { site: AtomSite; distance: number; op: number; cell: [number, number, number] } | null = null;
    for (const p of heavy) {
      for (const img of imagesNear(model, h.position, p, 1.6)) {
        if (bonded(h, p, img.distance) && (!best || img.distance < best.distance)) best = { site: p, ...img };
      }
    }
    if (best) parentOf.set(h.label, best);
    else unbonded.push(h.label);
  }
  // Whether an image is the site itself (the identity, no translation).
  const isSelf = (site: AtomSite, op: number, cell: readonly [number, number, number]): boolean => {
    const p = imageOf(model, site, op, cell);
    return Math.abs(p[0] - site.position[0]) + Math.abs(p[1] - site.position[1]) + Math.abs(p[2] - site.position[2]) < 1e-6;
  };
  for (const h of hydrogens) {
    const parent = parentOf.get(h.label);
    if (!parent) continue;
    // A hydrogen bonded to a symmetry image of its parent, not the parent as listed: left as it is.
    if (!isSelf(parent.site, parent.op, parent.cell)) {
      unbonded.push(h.label);
      continue;
    }
    const neighbours = heavy.flatMap((n) => imagesNear(model, parent.site.position, n, 2.4)
      .filter((img) => n.label !== parent.site.label || img.distance > 0.1)
      .filter((img) => bonded(parent.site, n, img.distance))
      .map((img) => ({ label: n.label, op: img.op, cell: img.cell })));
    const hCount = [...parentOf.values()].filter((p) => p.site.label === parent.site.label && isSelf(p.site, p.op, p.cell)).length;
    const element = parent.site.element.replace(/[^A-Za-z]/g, "");
    const factor = uFactor ?? (element === "O" || (element === "C" && hCount === 3) ? 1.5 : 1.2);
    if (neighbours.length === 2 && hCount === 1) {
      rules.push({ site: h.label, parent: parent.site.label, geometry: "aromatic", neighbours, distance: distance ?? parent.distance, uFactor: factor });
    } else {
      const offset: [number, number, number] = [h.position[0] - parent.site.position[0], h.position[1] - parent.site.position[1], h.position[2] - parent.site.position[2]];
      rules.push({ site: h.label, parent: parent.site.label, geometry: "fixed", offset, uFactor: factor });
    }
  }
  return { rules, unbonded };
}

/** A site's image position under operation `op` and lattice translation `cell`. */
function imageOf(model: StructureModel, site: AtomSite, op: number, cell: readonly [number, number, number]): Vec3 {
  const o = model.spaceGroup.operations[op]!;
  const p = mulVec(o.rotation, site.position);
  return [p[0] + o.translation[0] + cell[0], p[1] + o.translation[1] + cell[1], p[2] + o.translation[2] + cell[2]];
}

/**
 * The sites with every riding hydrogen placed from its parent's current
 * position and given U_iso = uFactor·U_eq(parent), as an isotropic B.
 */
export function applyRiding(model: StructureModel, sites: AtomSite[]): void {
  if (!model.riding?.length) return;
  const byLabel = new Map(sites.map((s, i) => [s.label, i]));
  const m = orthogonalizationMatrix(model.cell);
  const mi = inverse(m);
  const current: StructureModel = { ...model, sites };
  for (const rule of model.riding) {
    const hi = byLabel.get(rule.site);
    const pi = byLabel.get(rule.parent);
    if (hi === undefined || pi === undefined) continue;
    const parent = sites[pi]!;
    let position: Vec3 | null = null;
    if (rule.geometry === "aromatic" && rule.neighbours?.length === 2 && rule.distance !== undefined) {
      const pc = mulVec(m, parent.position);
      const ns = rule.neighbours.map((n) => {
        const ni = byLabel.get(n.label);
        return ni === undefined ? null : mulVec(m, imageOf(current, sites[ni]!, n.op, n.cell));
      });
      if (ns[0] && ns[1]) {
        // The external bisector: away from both neighbours, along their unit vectors' sum.
        const u = (q: Vec3): Vec3 => {
          const d: Vec3 = [pc[0] - q[0], pc[1] - q[1], pc[2] - q[2]];
          const len = Math.hypot(d[0], d[1], d[2]);
          return [d[0] / len, d[1] / len, d[2] / len];
        };
        const a = u(ns[0]);
        const b = u(ns[1]);
        const sum: Vec3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
        const len = Math.hypot(sum[0], sum[1], sum[2]);
        if (len > 1e-6) {
          const hc: Vec3 = [pc[0] + (rule.distance * sum[0]) / len, pc[1] + (rule.distance * sum[1]) / len, pc[2] + (rule.distance * sum[2]) / len];
          position = mulVec(mi, hc);
        }
      }
    }
    if (!position && rule.offset) position = [parent.position[0] + rule.offset[0], parent.position[1] + rule.offset[1], parent.position[2] + rule.offset[2]];
    const uEq = parent.adp.kind === "anisotropic" ? uEquivalent(parent.adp.uAniso, model.cell) : parent.adp.bIso / EIGHT_PI_SQUARED;
    sites[hi] = { ...sites[hi]!, ...(position ? { position } : {}), adp: { kind: "isotropic", bIso: EIGHT_PI_SQUARED * rule.uFactor * uEq } };
  }
}

/** Each riding hydrogen's X–H distance in the model as it stands (Å). */
export function ridingDistances(model: StructureModel): { site: string; geometry: RidingRule["geometry"]; distance: number }[] {
  const at = new Map(model.sites.map((site) => [site.label, site.position]));
  const m = orthogonalizationMatrix(model.cell);
  return (model.riding ?? []).flatMap((r) => {
    const h = at.get(r.site);
    const p = at.get(r.parent);
    if (!h || !p) return [];
    const d = mulVec(m, [h[0] - p[0], h[1] - p[1], h[2] - p[2]]);
    return [{ site: r.site, geometry: r.geometry, distance: Math.hypot(d[0], d[1], d[2]) }];
  });
}

const distanceRange = (ds: readonly number[]): string => {
  const lo = Math.min(...ds);
  const hi = Math.max(...ds);
  return hi - lo < 0.0005 ? `${lo.toFixed(3)} Å` : `${lo.toFixed(3)}–${hi.toFixed(3)} Å`;
};

/** The riding hydrogens in a line: how many of each geometry, their X–H distances and U factors. */
export function ridingSummary(model: StructureModel): string {
  const rules = model.riding ?? [];
  const ds = ridingDistances(model);
  return (["aromatic", "fixed"] as const).flatMap((g) => {
    const these = rules.filter((r) => r.geometry === g);
    if (these.length === 0) return [];
    const d = ds.filter((x) => x.geometry === g).map((x) => x.distance);
    const factors = [...new Set(these.map((r) => r.uFactor))].sort((a, b) => a - b).join(" or ");
    return [`${these.length} ${g === "aromatic" ? "sp² C–H on the bisector (AFIX 43)" : "at their present offset (AFIX 3)"}${d.length ? `, X–H ${distanceRange(d)}` : ""}, U_iso ${factors}·U_eq`];
  }).join("; ");
}
