/**
 * Structural geometry helpers for the quality-assessment step: interatomic
 * distances (bond lengths) computed from the fractional coordinates and cell.
 */

import type { AtomSite, StructureModel } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { fractionalToCartesian } from "@/core/crystal/unitCell";
import { almostEqualFractional, applyOperation, equivalentPositions } from "@/core/crystal/symmetry";
import { wrapFractional, sub, norm } from "@/core/math/vec3";
import { symmetricEigenDecomposition } from "@/core/math/linalg";

export interface BondLength {
  readonly from: string;
  readonly to: string;
  readonly distance: number;
  /**
   * The image of `to` the bond reaches, as a CIF's site-symmetry code
   * (`_geom_bond_site_symmetry_2`): the operation's number in the space
   * group's list and the lattice translation + 5, "3_564" for operation 3
   * moved by (0, +1, −1). Absent for the atom as listed (1_555).
   */
  readonly image?: string;
}

/**
 * Nearest-neighbour bond lengths (Å) up to `cutoff`, between each asymmetric
 * site and all symmetry-generated atoms in the surrounding cells. Deduplicated
 * and sorted by distance.
 */
export function bondLengths(model: StructureModel, cutoff = 3.2): BondLength[] {
  // Generate all atoms in the reference cell plus neighbouring cells, each with the operation that made it
  // and the lattice translation that wrapped it into the cell.
  const atoms: Array<{ label: string; site: AtomSite; frac: Vec3; op: number; wrap: Vec3 }> = [];
  for (const site of model.sites) {
    const positions: Vec3[] = [];
    model.spaceGroup.operations.forEach((op, k) => {
      const raw = applyOperation(op, site.position);
      const p = wrapFractional(raw);
      // Periodic, and coarse enough for a CIF's rounded special positions (0.3333, 0.6667).
      if (positions.some((q) => almostEqualFractional(q, p, 1e-3))) return;
      positions.push(p);
      atoms.push({ label: site.label, site, frac: p, op: k, wrap: sub(p, raw) as Vec3 });
    });
  }

  const bonds: BondLength[] = [];
  for (const site of model.sites) {
    const originFrac = wrapFractional(site.position);
    const originCart = fractionalToCartesian(model.cell, originFrac);
    // The listed site was wrapped too: the image is read against it as listed.
    const fromWrap = sub(originFrac, site.position as Vec3);
    for (const atom of atoms) {
      // Two alternatives of one disorder are never present together: no distance between them is a bond.
      if (alternatives(site, atom.site)) continue;
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) {
          for (let dc = -1; dc <= 1; dc++) {
            const frac: Vec3 = [atom.frac[0] + da, atom.frac[1] + db, atom.frac[2] + dc];
            const cart = fractionalToCartesian(model.cell, frac);
            const dist = norm(sub(cart, originCart));
            if (dist > 1e-3 && dist <= cutoff) {
              const n = [0, 1, 2].map((i) => Math.round(atom.wrap[i]! + [da, db, dc][i]! - fromWrap[i]!));
              const code = `${atom.op + 1}_${n.map((v) => 5 + v).join("")}`;
              bonds.push({ from: site.label, to: atom.label, distance: dist, ...(code !== "1_555" ? { image: code } : {}) });
            }
          }
        }
      }
    }
  }

  // Deduplicate near-equal bonds and sort.
  bonds.sort((a, b) => a.distance - b.distance);
  const unique: BondLength[] = [];
  for (const b of bonds) {
    if (!unique.some((u) => u.from === b.from && u.to === b.to && Math.abs(u.distance - b.distance) < 1e-3)) {
      unique.push(b);
    }
  }
  return unique;
}

/**
 * Two sites are alternatives of one disorder (SHELXL's PART 1 and PART 2 of
 * an assembly): never present together, so never bonded.
 */
export function alternatives(a: AtomSite, b: AtomSite): boolean {
  return !!a.disorder && !!b.disorder && a.disorder.assembly === b.disorder.assembly && a.disorder.group !== b.disorder.group;
}

/** Covalent radii (Å), Cordero et al. (2008); for Mn, Fe and Co the low-spin values; 0.75 for an element not listed. */
const COVALENT: Readonly<Record<string, number>> = {
  H: 0.31, D: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58,
  Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06,
  K: 2.03, Ca: 1.76, Sc: 1.7, Ti: 1.6, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22,
  Ga: 1.22, Ge: 1.2, As: 1.19, Se: 1.2, Br: 1.2, Kr: 1.16,
  Rb: 2.2, Sr: 1.95, Y: 1.9, Zr: 1.75, Nb: 1.64, Mo: 1.54, Tc: 1.47, Ru: 1.46, Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44,
  In: 1.42, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.4,
  Cs: 2.44, Ba: 2.15, La: 2.07, Ce: 2.04, Pr: 2.03, Nd: 2.01, Pm: 1.99, Sm: 1.98, Eu: 1.98, Gd: 1.96, Tb: 1.94, Dy: 1.92,
  Ho: 1.92, Er: 1.89, Tm: 1.9, Yb: 1.87, Lu: 1.87, Hf: 1.75, Ta: 1.7, W: 1.62, Re: 1.51, Os: 1.44, Ir: 1.41, Pt: 1.36,
  Au: 1.36, Hg: 1.32, Tl: 1.45, Pb: 1.46, Bi: 1.48, Po: 1.4, At: 1.5, Rn: 1.5,
  Fr: 2.6, Ra: 2.21, Ac: 2.15, Th: 2.06, Pa: 2.0, U: 1.96, Np: 1.9, Pu: 1.87, Am: 1.8, Cm: 1.69,
};
export const covalentRadius = (element: string): number => COVALENT[element.replace(/[^A-Za-z]/g, "")] ?? 0.75;

/** Two atoms at `distance` (Å) are bonded: closer than their covalent radii's sum and 0.4 Å. */
export const covalentlyBonded = (a: string, b: string, distance: number): boolean => distance > 0.5 && distance < covalentRadius(a) + covalentRadius(b) + 0.4;

/** A structure with carbon is molecular: its geometry is its covalent bonds, not cation shells. */
export function isMolecular(model: StructureModel): boolean {
  return model.sites.some((site) => site.element.replace(/[^A-Za-z]/g, "") === "C");
}

/**
 * The covalent bonds of a structure, as SHELXL lists them (_geom_bond): each
 * pair of atoms closer than their covalent radii's sum and 0.4 Å, once, from
 * the site listed first, in the order of the sites and shortest first.
 */
export function covalentBonds(model: StructureModel): BondLength[] {
  const order = new Map(model.sites.map((site, i) => [site.label, i]));
  const element = new Map(model.sites.map((site) => [site.label, site.element]));
  const seen = new Set<string>();
  const out: BondLength[] = [];
  // Far enough for the two largest atoms present (Cs–C reaches 3.6 Å), never less than 3 Å.
  const radii = model.sites.map((site) => covalentRadius(site.element)).sort((a, b) => b - a);
  const reach = Math.min(5, Math.max(3, (radii[0] ?? 0.75) + (radii[1] ?? radii[0] ?? 0.75) + 0.4));
  for (const b of bondLengths(model, reach)) {
    if (!covalentlyBonded(element.get(b.from)!, element.get(b.to)!, b.distance)) continue;
    // Each bond once, from the site listed first; the image code belongs to the far end as it is listed.
    const flipped = order.get(b.from)! > order.get(b.to)!;
    const [from, to] = flipped ? [b.to, b.from] : [b.from, b.to];
    const key = `${from}–${to}@${b.distance.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const image = flipped ? (b.image ? inverseImage(model, b.image) : undefined) : b.image;
    out.push({ from, to, distance: b.distance, ...(image && image !== "1_555" ? { image } : {}) });
  }
  return out.sort((x, y) => order.get(x.from)! - order.get(y.from)! || x.distance - y.distance);
}

/**
 * The image code of the reverse bond: if B's image (R, t + n) sits at a
 * distance d from A, A's image under the inverse operation (R⁻¹, −R⁻¹(t + n))
 * sits at d from B. The inverse operation is looked up in the group's list.
 */
export function inverseImage(model: StructureModel, code: string): string | undefined {
  const m = /^(\d+)_(\d)(\d)(\d)$/.exec(code);
  if (!m) return undefined;
  const ops = model.spaceGroup.operations;
  const op = ops[Number(m[1]) - 1];
  if (!op) return undefined;
  const t = [0, 1, 2].map((i) => op.translation[i]! + Number(m[i + 2]) - 5);
  const R = op.rotation;
  // R⁻¹ of an integer rotation: an operation whose rotation times R is the identity, with the translation
  // −R⁻¹(t + n) up to a whole lattice vector (in a centred group, one of the centred copies).
  const isInverse = (o: (typeof ops)[number]): boolean => [0, 1, 2].every((i) => [0, 1, 2].every((j) => Math.round([0, 1, 2].reduce((s, l) => s + o.rotation[i]![l]! * R[l]![j]!, 0)) === (i === j ? 1 : 0)));
  for (let k = 0; k < ops.length; k++) {
    const inv = ops[k]!;
    if (!isInverse(inv)) continue;
    const target = [0, 1, 2].map((i) => -inv.rotation[i]!.reduce((s, r, j) => s + r * t[j]!, 0));
    const n = target.map((v, i) => Math.round(v - inv.translation[i]!));
    if (target.every((v, i) => Math.abs(v - inv.translation[i]! - n[i]!) < 1e-6)) return `${k + 1}_${n.map((v) => 5 + v).join("")}`;
  }
  return undefined;
}

/** A hydrogen bond D–H···A, as SHELXL's HTAB lists it. */
export interface HydrogenBond {
  readonly donor: string;
  readonly hydrogen: string;
  readonly acceptor: string;
  /** The acceptor's image, as a CIF site-symmetry code (`_geom_hbond_site_symmetry_A`); absent for the atom as listed. */
  readonly image?: string;
  /** D–H, H···A and D···A (Å), and the angle D–H···A (°). */
  readonly dh: number;
  readonly ha: number;
  readonly da: number;
  readonly angle: number;
}

/** Van der Waals radii (Å), Bondi (1964): the hydrogen-bond criterion H···A < r(H) + r(A). */
const VDW: Readonly<Record<string, number>> = { H: 1.2, D: 1.2, N: 1.55, O: 1.52, F: 1.47, Cl: 1.75, S: 1.8, Br: 1.85, I: 1.98 };
const DONORS: ReadonlySet<string> = new Set(["N", "O", "F", "S"]);
const ACCEPTORS: ReadonlySet<string> = new Set(["N", "O", "F", "Cl", "S", "Br", "I"]);
const plain = (element: string): string => element.replace(/[^A-Za-z]/g, "");

/** Each hydrogen on an N, O, F or S (its donor the nearest atom it is bonded to, in the asymmetric unit as listed), with its contacts. */
function donorHydrogenSites(model: StructureModel, near: readonly BondLength[] = bondLengths(model, 3.2)): { h: AtomSite; donor: AtomSite; donorBond: BondLength; own: BondLength[] }[] {
  const site = new Map(model.sites.map((x) => [x.label, x]));
  const out: { h: AtomSite; donor: AtomSite; donorBond: BondLength; own: BondLength[] }[] = [];
  for (const h of model.sites) {
    if (!["H", "D"].includes(plain(h.element))) continue;
    const own = near.filter((b) => b.from === h.label);
    const donorBond = own.filter((b) => !b.image && covalentlyBonded(h.element, site.get(b.to)?.element ?? "", b.distance)).sort((a, b) => a.distance - b.distance)[0];
    const donor = donorBond ? site.get(donorBond.to) : undefined;
    if (donorBond && donor && DONORS.has(plain(donor.element))) out.push({ h, donor, donorBond, own });
  }
  return out;
}

/**
 * The hydrogen bonds of a structure, as SHELXL's HTAB finds them: each
 * hydrogen on N, O, F or S (its donor the atom it is bonded to) with every
 * acceptor N, O, F, S or a halogen closer than their van der Waals radii and
 * at an angle D–H···A above 110°, the acceptor's image named by its CIF code.
 * Shortest H···A first.
 */
export function hydrogenBonds(model: StructureModel): HydrogenBond[] {
  const site = new Map(model.sites.map((x) => [x.label, x]));
  const m = (f: readonly number[]): Vec3 => fractionalToCartesian(model.cell, f as Vec3);
  const near = bondLengths(model, 3.2);
  const out: HydrogenBond[] = [];
  for (const { h, donor, donorBond, own } of donorHydrogenSites(model, near)) {
    const hp = m(h.position);
    const dp = m(donor.position);
    for (const b of own) {
      const acceptor = site.get(b.to);
      if (!acceptor || !ACCEPTORS.has(plain(acceptor.element))) continue;
      if (b.to === donor.label && !b.image) continue;
      if (b.distance >= (VDW.H ?? 1.2) + (VDW[plain(acceptor.element)] ?? 1.6)) continue;
      // The acceptor's image, from its code: operation k applied, then the lattice translation.
      const code = /^(\d+)_(\d)(\d)(\d)$/.exec(b.image ?? "1_555")!;
      const op = model.spaceGroup.operations[Number(code[1]) - 1]!;
      const raw = applyOperation(op, acceptor.position);
      const ap = m([raw[0] + Number(code[2]) - 5, raw[1] + Number(code[3]) - 5, raw[2] + Number(code[4]) - 5]);
      const u = sub(dp, hp);
      const v = sub(ap, hp);
      const angle = (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))))) * 180) / Math.PI;
      if (angle <= 110) continue;
      out.push({ donor: donor.label, hydrogen: h.label, acceptor: acceptor.label, ...(b.image ? { image: b.image } : {}), dh: donorBond.distance, ha: b.distance, da: norm(sub(ap, dp)), angle });
    }
  }
  return out.sort((a, b) => a.ha - b.ha);
}

/** A planar ring of the molecule: its atoms in order around it, its centroid (fractional, beside the atoms as listed) and how planar it is. */
export interface Ring {
  readonly label: string;
  readonly atoms: readonly string[];
  readonly centroid: Vec3;
  /** The largest distance of an atom from the ring's least-squares plane (Å). */
  readonly planarity: number;
}

/** A contact to a ring's centroid: a metal sandwiched by a Cp, or an X–H pointing at an aromatic ring (X–H···π). */
export interface CentroidContact {
  readonly atom: string;
  readonly ring: string;
  /** The centroid's image, as a CIF site-symmetry code; absent for the ring as listed. */
  readonly image?: string;
  readonly distance: number;
  /** For X–H···Cg, the hydrogen's parent and the angle X–H···Cg (°). */
  readonly donor?: string;
  readonly angle?: number;
}

/**
 * The planar five- and six-membered rings of a molecular structure: cycles of
 * non-hydrogen atoms bonded within the asymmetric unit as listed, kept when
 * no atom lies more than 0.1 Å from their least-squares plane (an aromatic
 * ring, a Cp; not a cyclohexane chair or a cage).
 */
export function planarRings(model: StructureModel): Ring[] {
  const index = new Map(model.sites.map((site, i) => [site.label, i]));
  const element = new Map(model.sites.map((site) => [site.label, plain(site.element)]));
  const adjacency = new Map<string, Set<string>>();
  for (const b of covalentBonds(model)) {
    if (b.image || element.get(b.from) === "H" || element.get(b.to) === "H") continue;
    if (!adjacency.has(b.from)) adjacency.set(b.from, new Set());
    if (!adjacency.has(b.to)) adjacency.set(b.to, new Set());
    adjacency.get(b.from)!.add(b.to);
    adjacency.get(b.to)!.add(b.from);
  }
  const position = new Map(model.sites.map((site) => [site.label, site.position]));
  const seen = new Set<string>();
  const out: Ring[] = [];
  // Each cycle once: from its first atom in the site order, through atoms after it.
  const walk = (start: string, path: string[]): void => {
    const last = path[path.length - 1]!;
    for (const next of adjacency.get(last) ?? []) {
      if (next === start && path.length >= 5) {
        const key = [...path].sort().join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        const frac = path.map((a) => position.get(a)!);
        const centroid = [0, 1, 2].map((k) => frac.reduce((t, f) => t + f[k]!, 0) / frac.length) as unknown as Vec3;
        const cart = frac.map((f) => fractionalToCartesian(model.cell, f));
        const c = fractionalToCartesian(model.cell, centroid);
        const cov = [0, 1, 2].map((i) => [0, 1, 2].map((j) => cart.reduce((t, r) => t + (r[i]! - c[i]!) * (r[j]! - c[j]!), 0)));
        const { values, vectors } = symmetricEigenDecomposition(cov);
        // The normal: the eigenvector of the smallest eigenvalue.
        const k = values.reduce((best, v, i) => (Math.abs(v) < Math.abs(values[best]!) ? i : best), 0);
        const normal = [0, 1, 2].map((i) => vectors[i]![k]!);
        const planarity = Math.max(...cart.map((r) => Math.abs((r[0]! - c[0]!) * normal[0]! + (r[1]! - c[1]!) * normal[1]! + (r[2]! - c[2]!) * normal[2]!)));
        if (planarity <= 0.1) out.push({ label: "", atoms: [...path], centroid, planarity });
        continue;
      }
      if (path.length >= 6 || path.includes(next) || (index.get(next) ?? -1) < (index.get(start) ?? -1)) continue;
      walk(start, [...path, next]);
    }
  };
  for (const site of model.sites) if (adjacency.has(site.label)) walk(site.label, [site.label]);
  return out.map((r, i) => ({ ...r, label: `Cg${i + 1}` }));
}

/**
 * The contacts to the rings' centroids, each image of them: a metal within
 * 3.6 Å (a Cp's metal sits about 2.0–3.1 Å from it), and an N–H or O–H whose
 * hydrogen is within 3.0 Å at an angle X–H···Cg above 120° (an X–H···π
 * bond). Shortest first.
 */
export function centroidContacts(model: StructureModel, rings: readonly Ring[]): CentroidContact[] {
  const metals = model.sites.filter((site) => !RING_NON_METALS.has(plain(site.element)));
  const hydrogens = model.sites.filter((site) => ["H", "D"].includes(plain(site.element)));
  const near = bondLengths(model, 3.2);
  const site = new Map(model.sites.map((x) => [x.label, x]));
  const out: CentroidContact[] = [];
  for (const ring of rings) {
    // Every image of the centroid around the cell, with its code.
    const images: { frac: Vec3; code: string }[] = [];
    model.spaceGroup.operations.forEach((op, k) => {
      const raw = applyOperation(op, ring.centroid);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        images.push({ frac: [raw[0] + a, raw[1] + b, raw[2] + c], code: `${k + 1}_${5 + a}${5 + b}${5 + c}` });
      }
    });
    const reach = (x: AtomSite, limit: number): { image: (typeof images)[number]; distance: number }[] => {
      const p = fractionalToCartesian(model.cell, x.position);
      return images.map((image) => ({ image, distance: norm(sub(fractionalToCartesian(model.cell, image.frac), p)) })).filter((x2) => x2.distance <= limit);
    };
    for (const m of metals) {
      for (const { image, distance } of reach(m, 3.6)) out.push({ atom: m.label, ring: ring.label, ...(image.code !== "1_555" ? { image: image.code } : {}), distance });
    }
    for (const h of hydrogens) {
      const parent = near.filter((b) => b.from === h.label && !b.image && covalentlyBonded(h.element, site.get(b.to)?.element ?? "", b.distance)).sort((a, b) => a.distance - b.distance)[0];
      const donor = parent ? site.get(parent.to) : undefined;
      if (!donor || !["N", "O"].includes(plain(donor.element))) continue;
      const hp = fractionalToCartesian(model.cell, h.position);
      const dp = fractionalToCartesian(model.cell, donor.position);
      for (const { image, distance } of reach(h, 3.0)) {
        const cp = fractionalToCartesian(model.cell, image.frac);
        const u = sub(dp, hp);
        const v = sub(cp, hp);
        const angle = (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))))) * 180) / Math.PI;
        if (angle > 120) out.push({ atom: h.label, ring: ring.label, ...(image.code !== "1_555" ? { image: image.code } : {}), distance, donor: donor.label, angle });
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** The centroid image a contact names, fractional. */
function centroidImage(model: StructureModel, ring: Ring, code: string | undefined): Vec3 {
  const m = /^(\d+)_(\d)(\d)(\d)$/.exec(code ?? "1_555")!;
  const raw = applyOperation(model.spaceGroup.operations[Number(m[1]) - 1]!, ring.centroid);
  return [raw[0] + Number(m[2]) - 5, raw[1] + Number(m[3]) - 5, raw[2] + Number(m[4]) - 5];
}

/** The angle Cg–M–Cg′ at a metal between its two nearest centroids (a sandwich's bend, 180° when linear), each with its image code. */
export function metalCentroidAngles(model: StructureModel, rings: readonly Ring[], contacts: readonly CentroidContact[]): { atom: string; a: CentroidContact; b: CentroidContact; angle: number }[] {
  const byRing = new Map(rings.map((r) => [r.label, r]));
  const site = new Map(model.sites.map((x) => [x.label, x]));
  const out: { atom: string; a: CentroidContact; b: CentroidContact; angle: number }[] = [];
  for (const atom of new Set(contacts.filter((c) => c.donor === undefined).map((c) => c.atom))) {
    const two = contacts.filter((c) => c.atom === atom && c.donor === undefined).slice(0, 2);
    if (two.length < 2) continue;
    const p = fractionalToCartesian(model.cell, site.get(atom)!.position);
    const [u, v] = two.map((c) => sub(fractionalToCartesian(model.cell, centroidImage(model, byRing.get(c.ring)!, c.image)), p)) as [Vec3, Vec3];
    const angle = (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))))) * 180) / Math.PI;
    out.push({ atom, a: two[0]!, b: two[1]!, angle });
  }
  return out;
}

/** A molecule's ring geometry in lines, as a report gives it: the rings, the contacts to their centroids, the sandwiches' angles. */
export function ringGeometryLines(model: StructureModel): { rings: string[]; contacts: string[] } {
  const rings = planarRings(model);
  const contacts = centroidContacts(model, rings);
  const at = (c: CentroidContact): string => `${c.ring}${c.image ? ` [${c.image}]` : ""}`;
  return {
    rings: rings.map((r) => `${r.label}: ${r.atoms.join(" ")} (planar within ${r.planarity.toFixed(3)} Å)`),
    contacts: [
      ...contacts.map((c) => (c.donor ? `${c.donor}–${c.atom}···${at(c)} ${c.distance.toFixed(3)} Å, ${c.angle!.toFixed(0)}°` : `${c.atom}···${at(c)} ${c.distance.toFixed(3)} Å`)),
      ...metalCentroidAngles(model, rings, contacts).map((x) => `${at(x.a)}–${x.atom}–${at(x.b)} ${x.angle.toFixed(1)}°`),
    ],
  };
}

/** A molecule's hydrogen bonds in lines: D–H···A with the three lengths and the angle. */
export function hydrogenBondLines(model: StructureModel): string[] {
  const lines = hydrogenBonds(model).map((b) => `${b.donor}–${b.hydrogen}···${b.acceptor}${b.image ? ` [${b.image}]` : ""}: D–H ${b.dh.toFixed(2)}, H···A ${b.ha.toFixed(2)}, D···A ${b.da.toFixed(3)} Å, ${b.angle.toFixed(0)}°`);
  if (lines.length > 0) return lines;
  // Donors without an acceptor: said, so "no hydrogen bond" is a finding, not a silence.
  const donors = donorHydrogenSites(model).map((d) => `${d.donor.label}–${d.h.label}`);
  if (donors.length === 0) return [];
  const named = donors.length > 6 ? `${donors.slice(0, 6).join(", ")} and ${donors.length - 6} more` : donors.join(", ");
  return [`none: ${named} ${donors.length === 1 ? "reaches" : "reach"} no acceptor (N, O, F, S or a halogen) within the van der Waals sum at D–H···A above 110°`];
}

/** No metal: the elements a ring's centroid contact is not counted from (their contacts are bonds or packing). */
const RING_NON_METALS: ReadonlySet<string> = new Set(["H", "D", "B", "C", "N", "O", "F", "Si", "P", "S", "Cl", "As", "Se", "Br", "Te", "I"]);

/** One bond of a coordination shell: the neighbour site, the length and how many neighbours sit at it. */
export interface ShellBond {
  readonly to: string;
  readonly distance: number;
  readonly count: number;
}

/** A site's first coordination shell, shortest bond first. */
export interface CoordinationShell {
  readonly site: string;
  readonly bonds: readonly ShellBond[];
  /** The occupancy-blind mean bond length over the shell (Å). */
  readonly mean: number;
}

/** Elements that make the polyhedra around the cations. */
const ANION_ELEMENTS: ReadonlySet<string> = new Set(["O", "F", "Cl", "Br", "I", "S", "Se", "Te", "N"]);

/** A shell reaches at least this far (Å), so a long Jahn–Teller bond (Cu²⁺–O ≈ 2.7 Å) stays in it. */
const SHELL_REACH = 3.2;

/**
 * Each cation's coordination shell, as a structure report tabulates it: its
 * anion neighbours out to 3.2 Å, or 1.25 × the shortest bond for a large
 * cation, grouped by neighbour site and length with the multiplicity —
 * Mn–O6 1.907 ×2, Mn–O1 1.969 ×2, Mn–O6 2.179 ×2 in LaMnO₃. A structure
 * without anions (a metal, an intermetallic) gives every site's shell of any
 * neighbours. Lengths equal within 0.0005 Å are one bond.
 */
export function coordinationShells(model: StructureModel, cutoff = 3.5): CoordinationShell[] {
  const atoms: { label: string; element: string; frac: Vec3 }[] = [];
  for (const site of model.sites) {
    // Periodic, and coarse enough for a CIF's rounded special positions (0.3333, 0.6667).
    for (const p of equivalentPositions(model.spaceGroup.operations, site.position)) atoms.push({ label: site.label, element: site.element, frac: p });
  }
  const anions = atoms.some((a) => ANION_ELEMENTS.has(a.element));
  const out: CoordinationShell[] = [];
  for (const site of model.sites) {
    if (anions && ANION_ELEMENTS.has(site.element)) continue;
    const origin = fractionalToCartesian(model.cell, wrapFractional(site.position));
    const found: { to: string; distance: number }[] = [];
    for (const atom of atoms) {
      if (anions && !ANION_ELEMENTS.has(atom.element)) continue;
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) {
          for (let dc = -1; dc <= 1; dc++) {
            const d = norm(sub(fractionalToCartesian(model.cell, [atom.frac[0] + da, atom.frac[1] + db, atom.frac[2] + dc]), origin));
            if (d > 0.5 && d <= cutoff) found.push({ to: atom.label, distance: d });
          }
        }
      }
    }
    if (found.length === 0) continue;
    const shortest = Math.min(...found.map((f) => f.distance));
    const reach = Math.max(SHELL_REACH, 1.25 * shortest);
    const shell = found.filter((f) => f.distance <= reach).sort((a, b) => a.distance - b.distance);
    const bonds: { to: string; distance: number; count: number }[] = [];
    for (const f of shell) {
      const same = bonds.find((b) => b.to === f.to && Math.abs(b.distance - f.distance) < 5e-4);
      if (same) same.count++;
      else bonds.push({ to: f.to, distance: f.distance, count: 1 });
    }
    out.push({ site: site.label, bonds, mean: shell.reduce((s, f) => s + f.distance, 0) / shell.length });
  }
  return out;
}
