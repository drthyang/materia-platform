/**
 * Octahedral tilts of a cubic perovskite, built geometrically and independently
 * of the subgroup engine: the supercell forward-model gate and the supercell
 * refinements (THY-34) compare the engine's realised child with these.
 *
 * SrTiO₃ in Pm-3m: Sr at the origin, Ti at (½,½,½) + n, O at Ti_n − ½e_i.
 * A Glazer tilt rotates the octahedron about Ti_n by ω(n) = Σ_a φ_a s_a(n) e_a,
 * with s_a(n) = (−1)^(n₁+n₂+n₃) for an antiphase (−) tilt about axis a and
 * (−1)^(Σ_{b≠a} n_b) for an in-phase (+) one (Glazer, Acta Cryst. B28 (1972)
 * 3384; Woodward, Acta Cryst. B53 (1997) 32). An oxygen shared by two
 * octahedra gets the same displacement from both, u = ω(n) × (Ti_n → O),
 * because ω changes sign along its bond: the field is well defined, linear in
 * φ (no rigid-body second-order term), and periodic in the 2×2×2 cell.
 *
 * a⁻a⁻a⁻ gives R-3c, a⁰a⁰c⁻ I4/mcm, a⁰a⁰c⁺ P4/mbm and a⁻b⁺a⁻ Pnma (Howard &
 * Stokes, Acta Cryst. B54 (1998) 782, Table 1).
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import type { ExpandedAtom } from "@/core/diffraction/structureFactor";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import type { RealisedChild } from "@/core/crystal/irreps/realisation";

export const A_CUBIC = 3.905;

/** Cubic SrTiO₃, B values of room temperature (Pm-3m, #221). */
export function srtio3(opts: { readonly anisoO?: boolean } = {}): StructureModel {
  return {
    id: "srtio3",
    name: "SrTiO3",
    cell: { a: A_CUBIC, b: A_CUBIC, c: A_CUBIC, alpha: 90, beta: 90, gamma: 90 },
    spaceGroup: buildSpaceGroup(221),
    sites: [
      { label: "Sr", element: "Sr", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.6 } },
      { label: "Ti", element: "Ti", position: [0.5, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.4 } },
      {
        label: "O",
        element: "O",
        position: [0, 0.5, 0.5],
        occupancy: 1,
        adp: opts.anisoO ? { kind: "anisotropic", uAniso: [0.004, 0.012, 0.012, 0, 0, 0] } : { kind: "isotropic", bIso: 0.8 },
      },
    ],
  };
}

/** A Glazer tilt system: the angle (radians) about each cubic axis and whether that tilt is in phase. */
export interface Glazer {
  readonly name: string;
  /** IT number of the space group it gives from Pm-3m. */
  readonly number: number;
  readonly phi: Vec3;
  readonly inPhase: readonly [boolean, boolean, boolean];
}

export const GLAZER: Readonly<Record<string, Glazer>> = {
  "a-a-a-": { name: "a⁻a⁻a⁻", number: 167, phi: [1, 1, 1], inPhase: [false, false, false] },
  "a0a0c-": { name: "a⁰a⁰c⁻", number: 140, phi: [0, 0, 1], inPhase: [false, false, false] },
  "a0a0c+": { name: "a⁰a⁰c⁺", number: 127, phi: [0, 0, 1], inPhase: [false, false, true] },
  "a-b+a-": { name: "a⁻b⁺a⁻", number: 62, phi: [1, 0.8, 1], inPhase: [false, true, false] },
};

/** The six permutations of the cubic axes (a Glazer system in each orientation). */
export const AXIS_ORDERS: readonly (readonly [number, number, number])[] = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [2, 1, 0], [1, 0, 2]];

const near = (x: number): boolean => Math.abs(x - Math.round(x)) < 1e-6;

/**
 * The tilt displacement (parent fractional) of the parent atom at X (parent
 * fractional, any cell): zero on Sr and Ti, ω(n) × (Ti_n → O) on O. `scale`
 * multiplies the angles; `order` maps the system's axes onto the cube's.
 */
export function tiltDisplacement(X: Vec3, g: Glazer, scale: number, order: readonly [number, number, number] = [0, 1, 2]): Vec3 {
  const rel: Vec3 = [X[0] - 0.5, X[1] - 0.5, X[2] - 0.5];
  // An oxygen sits half a cell from Ti_n along one axis: Ti_n − ½e_i.
  for (let i = 0; i < 3; i++) {
    const t: Vec3 = [rel[0], rel[1], rel[2]];
    t[i] += 0.5;
    if (!t.every(near) || near(rel[i]!)) continue;
    const n = t.map((x) => Math.round(x)) as unknown as Vec3;
    // ω(n) in the cube's axes: the system's axis a lies along order[a].
    const omega: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const axis = order[a]!;
      const sum = g.inPhase[a] ? n.reduce((s, x, b) => (b === axis ? s : s + x), 0) : n[0] + n[1] + n[2];
      omega[axis] = scale * g.phi[a]! * (sum % 2 === 0 ? 1 : -1);
    }
    // u = ω × (O − Ti_n), O − Ti_n = −½e_i (fractional; the cube's Cartesian frame is a·x).
    const d: Vec3 = [0, 0, 0];
    d[i] = -0.5;
    return [omega[1] * d[2] - omega[2] * d[1], omega[2] * d[0] - omega[0] * d[2], omega[0] * d[1] - omega[1] * d[0]];
  }
  return [0, 0, 0];
}

const mulMV = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

export function inverse3(m: Mat3): Mat3 {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** The tilt displacement of a child-cell point y (child fractional): P⁻¹ of the parent's at X = P·y + p. */
export function childDisplacement(r: RealisedChild, y: Vec3, g: Glazer, scale: number, order: readonly [number, number, number]): Vec3 {
  const X = mulMV(r.basis, y).map((x, i) => x + r.origin[i]!) as unknown as Vec3;
  return mulMV(inverse3(r.basis), tiltDisplacement(X, g, scale, order));
}

/** The realised child with each site's representative moved by the tilt (the child's asymmetric unit of the tilted structure). */
export function tiltedChild(r: RealisedChild, g: Glazer, scale: number, order: readonly [number, number, number]): StructureModel {
  return {
    ...r.structure,
    sites: r.structure.sites.map((s) => {
      const u = childDisplacement(r, s.position, g, scale, order);
      return { ...s, position: [s.position[0] + u[0], s.position[1] + u[1], s.position[2] + u[2]] };
    }),
  };
}

/**
 * Whether the tilt field is invariant under the child's operations,
 * u(g·y) = W·u(y) on every site representative: then the child's own
 * expansion of `tiltedChild` is the tilted crystal.
 */
export function tiltIsInvariant(r: RealisedChild, g: Glazer, order: readonly [number, number, number]): boolean {
  for (const s of r.structure.sites) {
    const u = childDisplacement(r, s.position, g, 0.05, order);
    for (const op of r.structure.spaceGroup.operations) {
      const y = mulMV(op.rotation, s.position).map((x, i) => x + op.translation[i]!) as unknown as Vec3;
      const want = mulMV(op.rotation, u);
      const got = childDisplacement(r, y, g, 0.05, order);
      if (want.some((x, i) => Math.abs(x - got[i]!) > 1e-12)) return false;
    }
  }
  return true;
}

/** The tilted crystal as one explicit 2×2×2 cubic cell (P1): 40 atoms, positions fractional in the 2a cell. */
export function tiltedBlock(parent: StructureModel, g: Glazer, scale: number, order: readonly [number, number, number]): { readonly cell: StructureModel["cell"]; readonly atoms: ExpandedAtom[] } {
  const a = parent.cell.a;
  const atoms: ExpandedAtom[] = [];
  const offsets: { label: string; at: Vec3[] }[] = [
    { label: "Sr", at: [[0, 0, 0]] },
    { label: "Ti", at: [[0.5, 0.5, 0.5]] },
    { label: "O", at: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]] },
  ];
  for (let n0 = 0; n0 < 2; n0++) for (let n1 = 0; n1 < 2; n1++) for (let n2 = 0; n2 < 2; n2++) {
    for (const { label, at } of offsets) {
      const site = parent.sites.find((s) => s.label === label)!;
      for (const [k, x] of at.entries()) {
        const X: Vec3 = [x[0] + n0, x[1] + n1, x[2] + n2];
        const u = tiltDisplacement(X, g, scale, order);
        // O on the axis i of its bond carries U11 along it: the tensor rotated onto that axis.
        let adp = site.adp;
        if (adp.kind === "anisotropic") {
          const [par, perp] = [adp.uAniso[0], adp.uAniso[1]];
          const diag: Vec3 = [perp, perp, perp];
          diag[k] = par;
          adp = { kind: "anisotropic", uAniso: [diag[0], diag[1], diag[2], 0, 0, 0] };
        }
        atoms.push({ element: site.element, occupancy: site.occupancy, adp, position: [(X[0] + u[0]) / 2, (X[1] + u[1]) / 2, (X[2] + u[2]) / 2] });
      }
    }
  }
  return { cell: { a: 2 * a, b: 2 * a, c: 2 * a, alpha: 90, beta: 90, gamma: 90 }, atoms };
}
