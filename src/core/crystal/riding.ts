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
import type { Mat3, Vec3 } from "@/core/math/types";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { inverse, mulMat, mulVec } from "@/core/math/mat3";
import { EIGHT_PI_SQUARED, isHydrogen, uEquivalent } from "@/core/crystal/adp";
import { alternatives, covalentlyBonded } from "@/core/crystal/geometry";

const bonded = (a: AtomSite, b: AtomSite, distance: number): boolean => !alternatives(a, b) && covalentlyBonded(a.element, b.element, distance);

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
 * An sp² hydrogen on the external bisector of its parent's two neighbours, at
 * `distance` (Å) from the parent: fractional positions in, fractional out;
 * null when the neighbours lie on one line through the parent.
 */
function placeOnBisector(m: Mat3, mi: Mat3, parent: Vec3, n1: Vec3, n2: Vec3, distance: number): Vec3 | null {
  const pc = mulVec(m, parent);
  // The external bisector: away from both neighbours, along their unit vectors' sum.
  const u = (q: Vec3): Vec3 => {
    const qc = mulVec(m, q);
    const d: Vec3 = [pc[0] - qc[0], pc[1] - qc[1], pc[2] - qc[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    return [d[0] / len, d[1] / len, d[2] / len];
  };
  const a = u(n1);
  const b = u(n2);
  const sum: Vec3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const len = Math.hypot(sum[0], sum[1], sum[2]);
  if (len <= 1e-6) return null;
  return mulVec(mi, [pc[0] + (distance * sum[0]) / len, pc[1] + (distance * sum[1]) / len, pc[2] + (distance * sum[2]) / len]);
}

/** How a riding hydrogen moves with the atoms that place it: ∂x_H/∂x (fractional, 3×3) for its parent and for each neighbour, the latter as the neighbour's own coordinates move (through the image's rotation). */
export interface RidingDependence {
  readonly site: string;
  /** The atom whose move moves the hydrogen, and the 3×3 ∂x_H/∂x_atom. */
  readonly on: readonly { readonly label: string; readonly jacobian: Mat3 }[];
}

/**
 * The derivatives of each riding hydrogen's position with respect to the
 * positions that place it, at the model's current sites: the identity on its
 * parent for a hydrogen at a fixed offset; for one on the bisector, the
 * parent's move and each neighbour's turn the bisector too, so the hydrogen
 * moves by more than its parent and also when a neighbour moves. SHELXL's
 * riding derivatives keep only the parent's translation; the full chain keeps
 * a least-squares fit from stalling on an approximate Jacobian.
 */
export function ridingDependence(model: StructureModel): RidingDependence[] {
  if (!model.riding?.length) return [];
  const byLabel = new Map(model.sites.map((s) => [s.label, s]));
  const m = orthogonalizationMatrix(model.cell);
  const mi = inverse(m);
  const identity: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const out: RidingDependence[] = [];
  for (const rule of model.riding) {
    const parent = byLabel.get(rule.parent);
    if (!parent || !byLabel.has(rule.site)) continue;
    const ns = rule.geometry === "aromatic" && rule.neighbours?.length === 2 && rule.distance !== undefined
      ? rule.neighbours.map((n) => {
        const site = byLabel.get(n.label);
        return site ? { label: n.label, rotation: model.spaceGroup.operations[n.op]!.rotation, at: imageOf(model, site, n.op, n.cell) } : null;
      })
      : null;
    if (!ns || !ns[0] || !ns[1] || !placeOnBisector(m, mi, parent.position, ns[0].at, ns[1].at, rule.distance!)) {
      out.push({ site: rule.site, on: [{ label: rule.parent, jacobian: identity }] });
      continue;
    }
    const [n1, n2] = [ns[0], ns[1]];
    // Central differences of the placement in each coordinate of each of the three atoms.
    const h = 1e-6;
    const column = (move: (k: number, by: number) => [Vec3, Vec3, Vec3], k: number): Vec3 => {
      const [pf, af, bf] = move(k, h);
      const [pb, ab, bb] = move(k, -h);
      const f = placeOnBisector(m, mi, pf, af, bf, rule.distance!)!;
      const g = placeOnBisector(m, mi, pb, ab, bb, rule.distance!)!;
      return [(f[0] - g[0]) / (2 * h), (f[1] - g[1]) / (2 * h), (f[2] - g[2]) / (2 * h)];
    };
    const shifted = (v: Vec3, k: number, by: number): Vec3 => [v[0] + (k === 0 ? by : 0), v[1] + (k === 1 ? by : 0), v[2] + (k === 2 ? by : 0)];
    const jacobianOf = (which: 0 | 1 | 2): Mat3 => {
      const cols = [0, 1, 2].map((k) => column((kk, by) => [
        which === 0 ? shifted(parent.position, kk, by) : parent.position,
        which === 1 ? shifted(n1.at, kk, by) : n1.at,
        which === 2 ? shifted(n2.at, kk, by) : n2.at,
      ], k));
      return [[cols[0]![0], cols[1]![0], cols[2]![0]], [cols[0]![1], cols[1]![1], cols[2]![1]], [cols[0]![2], cols[1]![2], cols[2]![2]]];
    };
    // A neighbour's image moves by R·Δx when the neighbour moves by Δx.
    out.push({
      site: rule.site,
      on: [
        { label: rule.parent, jacobian: jacobianOf(0) },
        { label: n1.label, jacobian: mulMat(jacobianOf(1), n1.rotation) },
        { label: n2.label, jacobian: mulMat(jacobianOf(2), n2.rotation) },
      ],
    });
  }
  return out;
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
      const ns = rule.neighbours.map((n) => {
        const ni = byLabel.get(n.label);
        return ni === undefined ? null : imageOf(current, sites[ni]!, n.op, n.cell);
      });
      if (ns[0] && ns[1]) position = placeOnBisector(m, mi, parent.position, ns[0], ns[1], rule.distance);
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
