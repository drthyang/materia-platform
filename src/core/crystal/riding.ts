/**
 * Riding hydrogens, as SHELXL refines them (AFIX): a hydrogen's position
 * follows the atoms it is bonded to, in its group's ideal geometry, and its
 * U_iso is 1.2 (1.5 for methyl and hydroxyl) times its parent's U_eq, so it
 * carries no parameter of its own — a rotating group's torsion aside. X-ray
 * data cannot place a hydrogen independently — its one electron sits
 * displaced into the bond — and this is the treatment a refinement is
 * published with.
 *
 * The groups, by the parent's heavy neighbours and hydrogens (for a parent of
 * B, C, N, O, Si, P or S; a metal's hydrogens ride at their offset):
 *  - AFIX 43: an sp² X–H on the external bisector of the parent's two neighbours;
 *  - AFIX 137: a methyl (or NH₃) whose three hydrogens rotate about the
 *    neighbour–parent axis, tetrahedral, the torsion refined;
 *  - AFIX 147: a hydroxyl's (or thiol's) hydrogen rotating about its axis so;
 *  - AFIX 23: a methylene's two hydrogens in the plane bisecting X–C–Y, the
 *    H–C–H angle following X–C–Y as SHELXL's does;
 *  - AFIX 13: a methine's hydrogen opposite the parent's three neighbours;
 *  - AFIX 3 otherwise: at its present offset from the parent.
 * A hydrogen the data place on their own (a hydride, a hydrogen-bonded OH)
 * can refine its position while its U_iso still rides ("free").
 *
 * `ridingRules` finds each hydrogen's parent and group (bond lengths by
 * covalent radii, symmetry images included, no bond between two alternatives
 * of one disorder); `applyRiding` places the hydrogens from their parents'
 * current positions and ADPs and the groups' torsions.
 */

import type { AtomSite, RidingRule, StructureModel } from "@/core/crystal/types";
import type { Mat3, Vec3 } from "@/core/math/types";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { inverse, mulMat, mulVec } from "@/core/math/mat3";
import { EIGHT_PI_SQUARED, isHydrogen, uEquivalent } from "@/core/crystal/adp";
import { alternatives, covalentlyBonded } from "@/core/crystal/geometry";

const bonded = (a: AtomSite, b: AtomSite, distance: number): boolean => !alternatives(a, b) && covalentlyBonded(a.element, b.element, distance);

const bare = (element: string): string => element.replace(/[^A-Za-z]/g, "");

/** The parents whose hydrogens take a group's ideal geometry. */
const GROUP_PARENTS: ReadonlySet<string> = new Set(["B", "C", "N", "O", "Si", "P", "S"]);

/** The geometries that place a hydrogen from its parent and neighbours (not "fixed" or "free"). */
export type IdealGeometry = "aromatic" | "methyl" | "hydroxyl" | "methylene" | "methine";
const IDEAL: ReadonlySet<RidingRule["geometry"]> = new Set<RidingRule["geometry"]>(["aromatic", "methyl", "hydroxyl", "methylene", "methine"]);
export const isIdealized = (rule: RidingRule): boolean => IDEAL.has(rule.geometry);
/** A group with a torsion that refines (AFIX 137 and 147). */
export const isRotating = (rule: RidingRule): boolean => rule.geometry === "methyl" || rule.geometry === "hydroxyl";

/** SHELXL's AFIX number for each geometry (0: the position refines). */
export const AFIX: Readonly<Record<RidingRule["geometry"], number>> = { aromatic: 43, methyl: 137, hydroxyl: 147, methylene: 23, methine: 13, fixed: 3, free: 0 };

/**
 * SHELXL's X–H at room temperature (Å) for a group, by its parent (HFIX's
 * defaults): C–H 0.93 (sp²), 0.96 (CH₃), 0.97 (CH₂), 0.98 (CH); N–H 0.86,
 * 0.89, 0.90, 0.91; O–H 0.82; B–H 1.10. Undefined where SHELXL has none.
 */
function roomTemperatureDistance(geometry: IdealGeometry, element: string): number | undefined {
  const byGroup: Readonly<Record<string, Partial<Record<IdealGeometry, number>>>> = {
    C: { aromatic: 0.93, methyl: 0.96, methylene: 0.97, methine: 0.98 },
    N: { aromatic: 0.86, methyl: 0.89, methylene: 0.9, methine: 0.91 },
    O: { hydroxyl: 0.82 },
    S: { hydroxyl: 1.2 },
    B: { aromatic: 1.1, methyl: 1.1, methylene: 1.1, methine: 1.1 },
  };
  return byGroup[element]?.[geometry];
}

/** SHELXL's X–H for a group measured at `temperature` (K): its room-temperature value, +0.01 Å below −20 °C, +0.02 Å below −70 °C. */
export function shelxDistance(geometry: IdealGeometry, element: string, temperature: number): number | undefined {
  const d = roomTemperatureDistance(geometry, bare(element));
  if (d === undefined) return undefined;
  const celsius = temperature - 273.15;
  return Math.round((d + (celsius < -70 ? 0.02 : celsius < -20 ? 0.01 : 0)) * 1000) / 1000;
}

/**
 * SHELXL's H–C–H angle of a methylene (AFIX 23) for its X–C–Y angle
 * (degrees): it closes as X–C–Y opens, 108.24° at the tetrahedral angle.
 * Fitted to SHELXL's own placements (1b's four CH₂ groups, X–C–Y 108.6–
 * 109.7°: within 0.0004°).
 */
export function methyleneAngle(xcy: number): number {
  return 122.643 - 0.131612 * Math.min(150, Math.max(90, xcy));
}

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
  /** X–H (Å) of every hydrogen placed in a group's geometry; default: SHELXL's for the group at `temperature`, or else each group at its present distance. */
  readonly distance?: number;
  /** The measurement's temperature (K): each group at SHELXL's X–H for it. */
  readonly temperature?: number;
  /** Hydrogens whose own positions refine (a hydride, a hydroxyl the difference map shows): only their U_iso rides. */
  readonly refine?: readonly string[];
}

type Image = { readonly label: string; readonly op: number; readonly cell: readonly [number, number, number] };

const unit = (v: Vec3): Vec3 | null => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-9 ? [v[0] / len, v[1] / len, v[2] / len] : null;
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const DEG = Math.PI / 180;
/** The tetrahedral X–C–H: the hydrogen's component along the axis is a third of the bond. */
const AXIAL = 1 / 3;
const RADIAL = Math.sqrt(8) / 3;

/** The two unit vectors across a rotating group's axis `u`: e₁ the reference projected off the axis, e₂ = u × e₁. */
function crossAxes(u: Vec3, reference: readonly [number, number, number]): [Vec3, Vec3] | null {
  const along = dot(u, reference as Vec3);
  const e1 = unit([reference[0] - along * u[0], reference[1] - along * u[1], reference[2] - along * u[2]]);
  return e1 ? [e1, cross(u, e1)] : null;
}

/**
 * Where a ruled hydrogen sits: from the parent's and its neighbours'
 * fractional positions (the neighbours' bonded images), in the group's
 * geometry; null when it is degenerate (the neighbours on one line).
 */
function place(m: Mat3, mi: Mat3, rule: RidingRule, parent: Vec3, ns: readonly Vec3[]): Vec3 | null {
  const pc = mulVec(m, parent);
  const toward = (q: Vec3): Vec3 | null => {
    const qc = mulVec(m, q);
    return unit([qc[0] - pc[0], qc[1] - pc[1], qc[2] - pc[2]]);
  };
  const dirs = ns.map(toward);
  if (dirs.some((d) => !d) || rule.distance === undefined) return null;
  const a = dirs as Vec3[];
  let h: Vec3 | null = null;
  switch (rule.geometry) {
    case "aromatic":
      if (a.length === 2) h = unit([-(a[0]![0] + a[1]![0]), -(a[0]![1] + a[1]![1]), -(a[0]![2] + a[1]![2])]);
      break;
    case "methine":
      if (a.length === 3) h = unit([-(a[0]![0] + a[1]![0] + a[2]![0]), -(a[0]![1] + a[1]![1] + a[2]![1]), -(a[0]![2] + a[1]![2] + a[2]![2])]);
      break;
    case "methylene": {
      if (a.length !== 2) break;
      const n = unit([-(a[0]![0] + a[1]![0]), -(a[0]![1] + a[1]![1]), -(a[0]![2] + a[1]![2])]);
      const p = unit(cross(a[0]!, a[1]!));
      if (!n || !p) break;
      const half = (methyleneAngle(Math.acos(Math.max(-1, Math.min(1, dot(a[0]!, a[1]!)))) / DEG) * DEG) / 2;
      const s = rule.side ?? 1;
      const c = Math.cos(half);
      const t = s * Math.sin(half);
      h = [c * n[0] + t * p[0], c * n[1] + t * p[1], c * n[2] + t * p[2]];
      break;
    }
    case "methyl":
    case "hydroxyl": {
      if (a.length !== 1 || !rule.reference) break;
      const u: Vec3 = [-a[0]![0], -a[0]![1], -a[0]![2]];
      const axes = crossAxes(u, rule.reference);
      if (!axes) break;
      const psi = ((rule.torsion ?? 0) + (rule.phase ?? 0)) * DEG;
      const [e1, e2] = axes;
      const c = RADIAL * Math.cos(psi);
      const t = RADIAL * Math.sin(psi);
      h = [AXIAL * u[0] + c * e1[0] + t * e2[0], AXIAL * u[1] + c * e1[1] + t * e2[1], AXIAL * u[2] + c * e1[2] + t * e2[2]];
      break;
    }
    default:
      return null;
  }
  if (!h) return null;
  const d = rule.distance;
  return mulVec(mi, [pc[0] + d * h[0], pc[1] + d * h[1], pc[2] + d * h[2]]);
}

/**
 * The riding rules for every hydrogen of the model: its parent (the nearest
 * heavy atom within bonding distance), and its group's geometry from the
 * parent's heavy neighbours and hydrogens (see the module comment). Rotating
 * groups start at the torsion their hydrogens have now; each group's X–H is
 * `distance`, or SHELXL's at `temperature`, or else its present mean (an sp²
 * hydrogen's own).
 */
export function ridingRules(model: StructureModel, options: RidingOptions = {}): RidingSetup {
  const { uFactor, distance, temperature } = options;
  const refine = new Set(options.refine ?? []);
  const heavy = model.sites.filter((s) => !isHydrogen(s));
  const hydrogens = model.sites.filter((s) => isHydrogen(s));
  const m = orthogonalizationMatrix(model.cell);
  const cart = (v: Vec3): Vec3 => mulVec(m, v);
  const rules: RidingRule[] = [];
  const unbonded: string[] = [];
  // Each hydrogen's parent: the nearest heavy image within bonding distance.
  const parentOf = new Map<string, { site: AtomSite; distance: number; op: number; cell: [number, number, number] }>();
  for (const h of hydrogens) {
    let best: { site: AtomSite; distance: number; op: number; cell: [number, number, number] } | null = null;
    for (const p of heavy) {
      for (const img of imagesNear(model, h.position, p, 2.2)) {
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
  // A site's heavy neighbours, one per disorder assembly (two alternatives are never there together).
  const neighboursOf = (centre: AtomSite): Image[] => {
    const out: (Image & { site: AtomSite })[] = [];
    for (const n of heavy) {
      for (const img of imagesNear(model, centre.position, n, 3.0)) {
        if ((n.label === centre.label && img.distance < 0.1) || !bonded(centre, n, img.distance)) continue;
        if (out.some((o) => alternatives(o.site, n))) continue;
        out.push({ label: n.label, op: img.op, cell: img.cell, site: n });
      }
    }
    return out.map(({ label, op, cell }) => ({ label, op, cell }));
  };
  const at = (img: Image): Vec3 => imageOf(model, model.sites.find((s) => s.label === img.label)!, img.op, img.cell);

  // The hydrogens of each parent (bonded to the parent as listed, not an image of it), in site order.
  const groups = new Map<string, AtomSite[]>();
  for (const h of hydrogens) {
    const parent = parentOf.get(h.label);
    if (!parent) continue;
    // A hydrogen bonded to a symmetry image of its parent, not the parent as listed: left as it is.
    if (!isSelf(parent.site, parent.op, parent.cell)) {
      unbonded.push(h.label);
      continue;
    }
    groups.set(parent.site.label, [...(groups.get(parent.site.label) ?? []), h]);
  }

  for (const [parentLabel, hs] of groups) {
    const parent = model.sites.find((s) => s.label === parentLabel)!;
    const element = bare(parent.element);
    const neighbours = neighboursOf(parent);
    const placed = hs.filter((h) => !refine.has(h.label));
    const all = placed.length === hs.length;
    const geometry: RidingRule["geometry"] = !GROUP_PARENTS.has(element) || !all ? "fixed"
      : hs.length === 1 && neighbours.length === 2 ? "aromatic"
        : hs.length === 3 && neighbours.length === 1 ? "methyl"
          : hs.length === 1 && neighbours.length === 1 && (element === "O" || element === "S") ? "hydroxyl"
            : hs.length === 2 && neighbours.length === 2 ? "methylene"
              : hs.length === 1 && neighbours.length === 3 ? "methine"
                : "fixed";
    const pc = cart(parent.position);
    const dirTo = (q: Vec3): Vec3 => {
      const qc = cart(q);
      return unit([qc[0] - pc[0], qc[1] - pc[1], qc[2] - pc[2]]) ?? [1, 0, 0];
    };
    const present = (h: AtomSite): number => {
      const d = cart([h.position[0] - parent.position[0], h.position[1] - parent.position[1], h.position[2] - parent.position[2]]);
      return Math.hypot(d[0], d[1], d[2]);
    };
    const factor = uFactor ?? (element === "O" || (element === "C" && hs.length === 3 && neighbours.length === 1) ? 1.5 : 1.2);
    for (const h of hs.filter((x) => refine.has(x.label))) rules.push({ site: h.label, parent: parentLabel, geometry: "free", uFactor: factor });
    if (placed.length === 0) continue;
    const groupDistance = distance
      ?? (geometry !== "fixed" && temperature !== undefined ? shelxDistance(geometry, element, temperature) : undefined)
      ?? placed.reduce((t, h) => t + present(h), 0) / placed.length;
    const fixed = (): void => {
      for (const h of placed) {
        const offset: [number, number, number] = [h.position[0] - parent.position[0], h.position[1] - parent.position[1], h.position[2] - parent.position[2]];
        rules.push({ site: h.label, parent: parentLabel, geometry: "fixed", offset, uFactor: factor });
      }
    };
    switch (geometry) {
      case "aromatic":
      case "methine":
        rules.push({ site: placed[0]!.label, parent: parentLabel, geometry, neighbours, distance: groupDistance, uFactor: factor });
        break;
      case "methylene": {
        const p = cross(dirTo(at(neighbours[0]!)), dirTo(at(neighbours[1]!)));
        const sides = placed.map((h) => Math.sign(dot(dirTo(h.position), p)) || 1);
        if (sides[0] === sides[1]) {
          fixed();
          break;
        }
        placed.forEach((h, i) => rules.push({ site: h.label, parent: parentLabel, geometry, neighbours, distance: groupDistance, side: sides[i]!, uFactor: factor }));
        break;
      }
      case "methyl":
      case "hydroxyl": {
        const axisAtom = neighbours[0]!;
        const toAxis = dirTo(at(axisAtom));
        const axis: Vec3 = [-toAxis[0], -toAxis[1], -toAxis[2]];
        const reference = torsionReference(model, axisAtom, parent, axis);
        const axes = reference ? crossAxes(axis, reference) : null;
        if (!reference || !axes) {
          fixed();
          break;
        }
        const [e1, e2] = axes;
        const wrap = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180;
        const psi = placed.map((h) => {
          const d = dirTo(h.position);
          return Math.atan2(dot(d, e2), dot(d, e1)) / DEG;
        });
        // Each hydrogen's place in the group, 0, 120 or 240° on from the first; a group far from threefold rides at its offsets.
        const phases = psi.map((x) => (((Math.round(wrap(x - psi[0]!) / 120) * 120) % 360) + 360) % 360);
        if (new Set(phases).size !== placed.length || psi.some((x, i) => Math.abs(wrap(x - psi[0]! - phases[i]!)) > 30)) {
          fixed();
          break;
        }
        // The torsion that fits them all: the circular mean of each one's own.
        const sx = psi.reduce((t, x, i) => t + Math.cos((x - phases[i]!) * DEG), 0);
        const sy = psi.reduce((t, x, i) => t + Math.sin((x - phases[i]!) * DEG), 0);
        const torsion = Math.atan2(sy, sx) / DEG;
        placed.forEach((h, i) => rules.push({
          site: h.label, parent: parentLabel, geometry, neighbours: [axisAtom], distance: groupDistance,
          torsion, ...(geometry === "methyl" ? { phase: phases[i]! } : {}), reference, uFactor: factor,
        }));
        break;
      }
      default:
        fixed();
    }
  }
  // In the model's site order.
  const order = new Map(model.sites.map((s, i) => [s.label, i]));
  rules.sort((x, y) => order.get(x.site)! - order.get(y.site)!);
  return { rules, unbonded };

  /**
   * The direction a rotating group's torsion is measured from: toward another
   * neighbour of the axis atom (the torsion is then that dihedral), or else
   * the cell axis least along the group's axis. Fixed once the rule is made.
   */
  function torsionReference(mdl: StructureModel, axisAtom: Image, parentSite: AtomSite, axis: Vec3): [number, number, number] | null {
    const axisSite = mdl.sites.find((s) => s.label === axisAtom.label)!;
    const o = mdl.spaceGroup.operations[axisAtom.op]!;
    const axisAt = cart(at(axisAtom));
    const parentAt = cart(parentSite.position);
    const beyond = neighboursOf(axisSite).map((img) => {
      // The axis atom's neighbour, carried with the axis atom to its image.
      const q = mulVec(o.rotation, at(img));
      return cart([q[0] + o.translation[0] + axisAtom.cell[0], q[1] + o.translation[1] + axisAtom.cell[1], q[2] + o.translation[2] + axisAtom.cell[2]]);
    }).filter((qc) => Math.hypot(qc[0] - parentAt[0], qc[1] - parentAt[1], qc[2] - parentAt[2]) > 0.5);
    const candidates: Vec3[] = [
      ...beyond.map((qc) => [qc[0] - axisAt[0], qc[1] - axisAt[1], qc[2] - axisAt[2]] as Vec3),
      ...([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e) => cart(e)).sort((x, y) => Math.abs(dot(unit(x)!, axis)) - Math.abs(dot(unit(y)!, axis))),
    ];
    const r = candidates.map(unit).find((c) => c && Math.abs(dot(c, axis)) < 0.95);
    return r ? [r[0], r[1], r[2]] : null;
  }
}

/** A site's image position under operation `op` and lattice translation `cell`. */
function imageOf(model: StructureModel, site: AtomSite, op: number, cell: readonly [number, number, number]): Vec3 {
  const o = model.spaceGroup.operations[op]!;
  const p = mulVec(o.rotation, site.position);
  return [p[0] + o.translation[0] + cell[0], p[1] + o.translation[1] + cell[1], p[2] + o.translation[2] + cell[2]];
}

/** The rules with each rotating group's torsion from `torsions` (by parent label), where given. */
export function withTorsions(rules: readonly RidingRule[], torsions: ReadonlyMap<string, number>): RidingRule[] {
  return rules.map((r) => (isRotating(r) && torsions.has(r.parent) ? { ...r, torsion: torsions.get(r.parent)! } : r));
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
 * parent for a hydrogen at a fixed offset; for one in a group's geometry, the
 * parent's move and each neighbour's turn the group too, so the hydrogen
 * moves by more than its parent and also when a neighbour moves. A hydrogen
 * that refines its own position depends on no other. SHELXL's riding
 * derivatives keep only the parent's translation; the full chain keeps a
 * least-squares fit from stalling on an approximate Jacobian.
 */
export function ridingDependence(model: StructureModel): RidingDependence[] {
  if (!model.riding?.length) return [];
  const byLabel = new Map(model.sites.map((s) => [s.label, s]));
  const m = orthogonalizationMatrix(model.cell);
  const mi = inverse(m);
  const identity: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const out: RidingDependence[] = [];
  for (const rule of model.riding) {
    if (rule.geometry === "free") continue;
    const parent = byLabel.get(rule.parent);
    if (!parent || !byLabel.has(rule.site)) continue;
    const ns = isIdealized(rule) && rule.neighbours?.length
      ? rule.neighbours.map((n) => {
        const site = byLabel.get(n.label);
        return site ? { label: n.label, rotation: model.spaceGroup.operations[n.op]!.rotation, at: imageOf(model, site, n.op, n.cell) } : null;
      })
      : null;
    if (!ns || ns.some((n) => !n) || !place(m, mi, rule, parent.position, ns.map((n) => n!.at))) {
      out.push({ site: rule.site, on: [{ label: rule.parent, jacobian: identity }] });
      continue;
    }
    const atoms = [parent.position, ...ns.map((n) => n!.at)];
    // Central differences of the placement in each coordinate of each atom that places it.
    const h = 1e-6;
    const jacobianOf = (which: number): Mat3 => {
      const cols = [0, 1, 2].map((k) => {
        const moved = (by: number): Vec3[] => atoms.map((a, i) => (i === which ? [a[0] + (k === 0 ? by : 0), a[1] + (k === 1 ? by : 0), a[2] + (k === 2 ? by : 0)] as Vec3 : a));
        const f = moved(h);
        const g = moved(-h);
        const pf = place(m, mi, rule, f[0]!, f.slice(1))!;
        const pg = place(m, mi, rule, g[0]!, g.slice(1))!;
        return [(pf[0] - pg[0]) / (2 * h), (pf[1] - pg[1]) / (2 * h), (pf[2] - pg[2]) / (2 * h)] as Vec3;
      });
      return [[cols[0]![0], cols[1]![0], cols[2]![0]], [cols[0]![1], cols[1]![1], cols[2]![1]], [cols[0]![2], cols[1]![2], cols[2]![2]]];
    };
    // A neighbour's image moves by R·Δx when the neighbour moves by Δx.
    out.push({
      site: rule.site,
      on: [
        { label: rule.parent, jacobian: jacobianOf(0) },
        ...ns.map((n, i) => ({ label: n!.label, jacobian: mulMat(jacobianOf(i + 1), n!.rotation) })),
      ],
    });
  }
  return out;
}

/**
 * Each rotating group's hydrogens' ∂x_H/∂torsion (fractional, per degree),
 * by parent label, at the model's current sites and torsions.
 */
export function torsionDerivatives(model: StructureModel): Map<string, { site: string; axis: Vec3 }[]> {
  const out = new Map<string, { site: string; axis: Vec3 }[]>();
  const byLabel = new Map(model.sites.map((s) => [s.label, s]));
  const m = orthogonalizationMatrix(model.cell);
  const mi = inverse(m);
  for (const rule of model.riding ?? []) {
    if (!isRotating(rule) || !rule.reference || rule.distance === undefined || !rule.neighbours?.length) continue;
    const parent = byLabel.get(rule.parent);
    const n = rule.neighbours[0]!;
    const axisSite = byLabel.get(n.label);
    if (!parent || !axisSite) continue;
    const pc = mulVec(m, parent.position);
    const xc = mulVec(m, imageOf(model, axisSite, n.op, n.cell));
    const u = unit([pc[0] - xc[0], pc[1] - xc[1], pc[2] - xc[2]]);
    const axes = u ? crossAxes(u, rule.reference) : null;
    if (!axes) continue;
    const [e1, e2] = axes;
    const psi = ((rule.torsion ?? 0) + (rule.phase ?? 0)) * DEG;
    const k = rule.distance * RADIAL * DEG;
    const s = -k * Math.sin(psi);
    const c = k * Math.cos(psi);
    const v = mulVec(mi, [s * e1[0] + c * e2[0], s * e1[1] + c * e2[1], s * e1[2] + c * e2[2]]);
    out.set(rule.parent, [...(out.get(rule.parent) ?? []), { site: rule.site, axis: v }]);
  }
  return out;
}

/**
 * The sites with every riding hydrogen placed from its parent's current
 * position (and its neighbours', and its group's torsion) and given U_iso =
 * uFactor·U_eq(parent), as an isotropic B. A hydrogen that refines its own
 * position keeps it.
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
    if (isIdealized(rule) && rule.neighbours?.length) {
      const ns = rule.neighbours.map((n) => {
        const ni = byLabel.get(n.label);
        return ni === undefined ? null : imageOf(current, sites[ni]!, n.op, n.cell);
      });
      if (ns.every((n) => n)) position = place(m, mi, rule, parent.position, ns as Vec3[]);
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

/** Each geometry in words, with SHELXL's AFIX. */
export const RIDING_GEOMETRY_TEXT: Readonly<Record<RidingRule["geometry"], string>> = {
  aromatic: "sp² X–H on the bisector (AFIX 43)",
  methyl: "methyl hydrogens rotating, the torsion refined (AFIX 137)",
  hydroxyl: "hydroxyl hydrogens rotating, the torsion refined (AFIX 147)",
  methylene: "CH₂ hydrogens, H–C–H from X–C–Y (AFIX 23)",
  methine: "tertiary C–H opposite three neighbours (AFIX 13)",
  fixed: "at their present offset (AFIX 3)",
  free: "with their positions refined, only U_iso riding",
};

/** The riding hydrogens in a line: how many of each geometry, their X–H distances and U factors. */
export function ridingSummary(model: StructureModel): string {
  const rules = model.riding ?? [];
  const ds = ridingDistances(model);
  return (Object.keys(RIDING_GEOMETRY_TEXT) as RidingRule["geometry"][]).flatMap((g) => {
    const these = rules.filter((r) => r.geometry === g);
    if (these.length === 0) return [];
    const d = ds.filter((x) => x.geometry === g).map((x) => x.distance);
    const factors = [...new Set(these.map((r) => r.uFactor))].sort((a, b) => a - b).join(" or ");
    const n = new Set(these.map((r) => r.parent)).size;
    const groups = g === "methyl" || g === "methylene" ? ` in ${n} group${n === 1 ? "" : "s"}` : "";
    const what = g === "free" ? `with ${these.length === 1 ? "its position" : "their positions"} refined, only U_iso riding` : RIDING_GEOMETRY_TEXT[g];
    return [`${these.length} ${what}${groups}${d.length ? `, X–H ${distanceRange(d)}` : ""}, U_iso ${factors}·U_eq`];
  }).join("; ");
}
