/**
 * Isotropic ↔ anisotropic displacement-parameter (ADP) conversion.
 *
 * A refinement usually starts isotropic (one B_iso per site) and, once the
 * scale/cell/positions are stable, switches well-determined atoms to the full
 * anisotropic U tensor. The two parameterizations are linked by the equivalent
 * isotropic displacement (Fischer & Tillmanns, *Acta Cryst.* C44 (1988) 775;
 * International Tables Vol. C §1.2.2):
 *
 *   U_iso = B_iso / (8π²),           B_iso = 8π² · U_eq,
 *   U_eq  = ⅓ Σ_ij U^ij a*_i a*_j (a_i·a_j)
 *
 * with U^ij the CIF components (on the axes a*_i normalized). The sphere of
 * radius² U in that convention is U^ij = U·cos(a*_i, a*_j): U11 = U22 = U33 =
 * U with off-diagonals U·cos γ*, U·cos β*, U·cos α* — zero only for orthogonal
 * axes. Promotion seeds that sphere, so the anisotropic fit starts exactly
 * where the isotropic one ended; demotion collapses a tensor to its U_eq. Both
 * reduce to the familiar U11 = U22 = U33 = U and the trace/3 on orthogonal axes.
 * Seeding U12 = 0 in a hexagonal cell (where the sphere has U12 = U/2) is an
 * ellipsoid, which the site-symmetry projection then distorts further: on
 * sapphire (R-3c) the switch moved wR2 from 14.13 to 14.48 % before anything
 * refined.
 */

import type { DisplacementParameters, StructureModel, AtomSite, UnitCell } from "@/core/crystal/types";
import { metricTensor, reciprocalMetricTensor } from "@/core/crystal/unitCell";

/** 8π², the B_iso ↔ U_iso conversion constant. */
export const EIGHT_PI_SQUARED = 8 * Math.PI * Math.PI;

/** U_iso (Å²) from B_iso (Å²). */
export function uIsoFromBIso(bIso: number): number {
  return bIso / EIGHT_PI_SQUARED;
}

type U6 = readonly [number, number, number, number, number, number];

/** The cosines of the reciprocal angles (α*, β*, γ*); all 0 without a cell. */
function reciprocalCosines(cell: UnitCell | undefined): { readonly ca: number; readonly cb: number; readonly cg: number } {
  if (!cell) return { ca: 0, cb: 0, cg: 0 };
  const g = reciprocalMetricTensor(cell);
  // A right angle's cosine is round-off (6e-17), not a tilt: snapped to 0, so orthogonal axes keep exact zeros.
  const n = (i: number, j: number): number => {
    const c = g[i]![j]! / Math.sqrt(g[i]![i]! * g[j]![j]!);
    return Math.abs(c) < 1e-12 ? 0 : c;
  };
  return { ca: n(1, 2), cb: n(0, 2), cg: n(0, 1) };
}

/** The sphere U^ij = U·cos(a*_i, a*_j) [U11, U22, U33, U12, U13, U23] in the cell (U12 = U13 = U23 = 0 without one). */
export function sphereU(u: number, cell?: UnitCell): [number, number, number, number, number, number] {
  const { ca, cb, cg } = reciprocalCosines(cell);
  return [u, u, u, u * cg, u * cb, u * ca];
}

/** U_eq = ⅓ Σ_ij U^ij a*_i a*_j (a_i·a_j) (Fischer & Tillmanns 1988); the trace/3 without a cell. */
export function uEquivalent(u: U6, cell?: UnitCell): number {
  if (!cell) return (u[0] + u[1] + u[2]) / 3;
  const g = metricTensor(cell);
  const gs = reciprocalMetricTensor(cell);
  const a = [0, 1, 2].map((i) => Math.sqrt(gs[i]![i]!));
  const m = [[u[0], u[3], u[4]], [u[3], u[1], u[5]], [u[4], u[5], u[2]]];
  let sum = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) sum += m[i]![j]! * a[i]! * a[j]! * g[i]![j]!;
  return sum / 3;
}

/** B_iso (Å²) from the equivalent isotropic U of an aniso tensor (the trace/3 without a cell). */
export function bIsoFromUAniso(u: U6, cell?: UnitCell): number {
  return EIGHT_PI_SQUARED * uEquivalent(u, cell);
}

/** Convert a site's ADP to anisotropic (isotropic → the sphere in the cell; aniso passes through). */
export function toAnisotropic(adp: DisplacementParameters, cell?: UnitCell): DisplacementParameters {
  if (adp.kind === "anisotropic") return adp;
  return { kind: "anisotropic", uAniso: sphereU(uIsoFromBIso(adp.bIso), cell) };
}

/** Convert a site's ADP to isotropic (aniso → its U_eq as B_iso; iso passes through). */
export function toIsotropic(adp: DisplacementParameters, cell?: UnitCell): DisplacementParameters {
  if (adp.kind === "isotropic") return adp;
  return { kind: "isotropic", bIso: bIsoFromUAniso(adp.uAniso, cell) };
}

/** A hydrogen (or deuterium) site. */
export function isHydrogen(site: Pick<AtomSite, "element">): boolean {
  const e = site.element.replace(/[^A-Za-z]/g, "");
  return e === "H" || e === "D";
}

/**
 * Return a structure with every site's ADP set to the requested model. Sites
 * already in that model are unchanged; promotion seeds the spherical tensor from
 * each site's current B_iso, so a converged isotropic fit is the starting point
 * for the anisotropic one. `hydrogensIsotropic` keeps (or makes) the hydrogens
 * isotropic under an anisotropic model, as X-ray data require: a hydrogen's one
 * electron sits displaced into its bond, and cannot define a tensor.
 */
export function withAdpModel(structure: StructureModel, kind: "isotropic" | "anisotropic", opts: { readonly hydrogensIsotropic?: boolean } = {}): StructureModel {
  const sites: AtomSite[] = structure.sites.map((s) => {
    const iso = kind === "isotropic" || (opts.hydrogensIsotropic === true && isHydrogen(s));
    return { ...s, adp: iso ? toIsotropic(s.adp, structure.cell) : toAnisotropic(s.adp, structure.cell) };
  });
  return { ...structure, sites };
}

/**
 * Rotate an anisotropic U tensor by a space-group operation's (fractional)
 * rotation matrix: U′ = R·U·Rᵀ, with U^{jk} the CIF contravariant components.
 * This is how a site's displacement ellipsoid carries to the other members of
 * its orbit — an image related by a 4-fold has U11 and U22 swapped, etc.
 * Skipping this (using the asymmetric-unit tensor verbatim on every image)
 * corrupts anisotropic Debye–Waller factors and real-space bond-projected
 * displacement widths for every site whose orbit involves a rotation.
 */
export function rotateUAniso(
  u: readonly [number, number, number, number, number, number],
  r: readonly (readonly number[])[],
): [number, number, number, number, number, number] {
  const U = [
    [u[0], u[3], u[4]],
    [u[3], u[1], u[5]],
    [u[4], u[5], u[2]],
  ];
  // W = R·U, then U′ = W·Rᵀ.
  const w = [0, 1, 2].map((i) => [0, 1, 2].map((j) => r[i]![0]! * U[0]![j]! + r[i]![1]! * U[1]![j]! + r[i]![2]! * U[2]![j]!));
  const up = [0, 1, 2].map((i) => [0, 1, 2].map((j) => w[i]![0]! * r[j]![0]! + w[i]![1]! * r[j]![1]! + w[i]![2]! * r[j]![2]!));
  return [up[0]![0]!, up[1]![1]!, up[2]![2]!, up[0]![1]!, up[0]![2]!, up[1]![2]!];
}

/** A site's ADP as seen by one orbit image: isotropic passes through, an
 *  anisotropic tensor is rotated by the operation (see rotateUAniso). */
export function adpForOperation(adp: DisplacementParameters, rotation: readonly (readonly number[])[]): DisplacementParameters {
  if (adp.kind === "isotropic") return adp;
  return { kind: "anisotropic", uAniso: rotateUAniso(adp.uAniso, rotation) };
}

/**
 * Whether an anisotropic U tensor (U11, U22, U33, U12, U13, U23) is
 * positive-definite, by Sylvester's criterion. Taking U to Cartesian axes is a
 * congruence transform, which preserves definiteness, so the CIF-convention
 * components are tested as they are. A tensor that is not positive-definite
 * describes no physical vibration ellipsoid (checkCIF's "NPD" alert).
 */
export function isPositiveDefiniteU(u: readonly [number, number, number, number, number, number]): boolean {
  const [u11, u22, u33, u12, u13, u23] = u;
  if (!(u11 > 0)) return false;
  if (!(u11 * u22 - u12 * u12 > 0)) return false;
  const det = u11 * (u22 * u33 - u23 * u23) - u12 * (u12 * u33 - u23 * u13) + u13 * (u12 * u23 - u22 * u13);
  return det > 0;
}

/** Labels of the sites whose ADP is unphysical: an anisotropic tensor that is not positive-definite. */
export function nonPositiveDefiniteSites(structure: StructureModel): string[] {
  return structure.sites
    .filter((s) => s.adp.kind === "anisotropic" && !isPositiveDefiniteU(s.adp.uAniso))
    .map((s) => s.label);
}
