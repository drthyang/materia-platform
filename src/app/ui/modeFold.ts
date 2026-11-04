/**
 * The 3D Model's mode table folded by irrep, as data: DistortionModesPanel
 * draws one row per irrep (its per-atom rows behind ▸), the contribution chart,
 * and the green arrows of an irrep or of every mode listed, from these.
 *
 * - **Folds.** Modes by parent irrep (a supercell child, a decomposition, a
 *   mode CIF) fold under their irrep, in the set's order. A set without irreps
 *   (a same-cell activation, the structure's own modes) does not fold.
 * - **Shares.** Each irrep's share of the distortion is A²/ΣA² over the rows
 *   listed. The modes are orthonormal, so the squared amplitudes add up to the
 *   total's square, and the shares sum to 1. A_s and A_p are A over a fixed
 *   √(cells), so their squares give the very same shares.
 * - **Arrow field.** An irrep's (or every listed mode's) displacement field is
 *   Σ value·axis per child site: the summed per-site modes at their current
 *   amplitudes. A single row still draws its unit eigenvector.
 *
 * UI only: no Agent or MCP text reads these labels.
 */

import type { Vec3 } from "@/core/math/types";
import type { DistortionMode } from "@/core/crystal/distortionModes";
import type { RefinementParameter } from "@/core/refinement/types";
import type { UnitCell } from "@/core/crystal/types";
import { fractionalToCartesian } from "@/core/crystal/unitCell";
import type { CellAtom } from "@/core/crystal/cellExpansion";

/** One irrep's rows: what its folded row stands for. */
export interface IrrepFold {
  /** The irrep's label, unique in a set ("X irrep 5 of 5"). */
  readonly id: string;
  readonly label: string;
  readonly direction: string | undefined;
  readonly k: Vec3;
  /** Its modes listed, in the set's order. */
  readonly modes: readonly DistortionMode[];
}

/** The irreps of the rows listed, in the order they first appear; null when no row has an irrep (nothing folds). */
export function irrepFolds(rows: readonly DistortionMode[]): IrrepFold[] | null {
  if (!rows.some((m) => m.irrep)) return null;
  const folds = new Map<string, { label: string; direction: string | undefined; k: Vec3; modes: DistortionMode[] }>();
  for (const m of rows) {
    // A row without an irrep in a set by irreps (not made today) stands as its own fold.
    const id = m.irrep?.label ?? m.label;
    const f = folds.get(id) ?? { label: id, direction: m.irrep?.direction, k: m.irrep?.k ?? [0, 0, 0], modes: [] };
    f.modes.push(m);
    folds.set(id, f);
  }
  return [...folds].map(([id, f]) => ({ id, ...f }));
}

const valueOf = (params: readonly RefinementParameter[], id: string): number => params.find((p) => p.id === id)?.value ?? 0;

/** One bar of the chart: its share of A² over the rows listed, and its parts (the per-atom rows), each a share of the same total. */
export interface Share {
  readonly id: string;
  readonly label: string;
  /** Σ A² of its modes (Å²). */
  readonly a2: number;
  /** a2 / Σ a2 over every bar; 0 when every amplitude is 0. */
  readonly share: number;
  readonly parts: readonly { readonly id: string; readonly label: string; readonly a2: number; readonly share: number; readonly value: number }[];
}

/**
 * The contribution chart's bars: one per irrep (or per mode, for a set
 * without irreps), dominant first. Signs drop out (A²); the table keeps them.
 */
export function contributionShares(rows: readonly DistortionMode[], params: readonly RefinementParameter[]): Share[] {
  const folds = irrepFolds(rows) ?? rows.map((m) => ({ id: m.id, label: m.label, direction: undefined, k: [0, 0, 0] as Vec3, modes: [m] }));
  const total = rows.reduce((s, m) => s + valueOf(params, m.id) ** 2, 0);
  const of = (a2: number): number => (total > 0 ? a2 / total : 0);
  const bars = folds.map((f) => {
    const parts = f.modes.map((m) => {
      const value = valueOf(params, m.id);
      return { id: m.id, label: m.label, a2: value * value, share: of(value * value), value };
    });
    const a2 = parts.reduce((s, p) => s + p.a2, 0);
    return { id: f.id, label: f.label, a2, share: of(a2), parts: [...parts].sort((a, b) => b.a2 - a.a2) };
  });
  // Dominant first; ties keep the set's order.
  return bars.map((b, i) => ({ b, i })).sort((x, y) => y.b.a2 - x.b.a2 || x.i - y.i).map(({ b }) => b);
}

/** A per-child-site fractional displacement field, as StructureView draws it. */
export type DisplacementField = readonly { readonly siteLabel: string; readonly axis: Vec3 }[];

/** Σ value·axis per child site over the modes, at their current amplitudes (sites in first-seen order). */
export function summedField(modes: readonly DistortionMode[], params: readonly RefinementParameter[]): { siteLabel: string; axis: Vec3 }[] {
  const by = new Map<string, [number, number, number]>();
  for (const m of modes) {
    const v = valueOf(params, m.id);
    for (const a of m.axes) {
      const d = by.get(a.siteLabel) ?? [0, 0, 0];
      d[0] += v * a.axis[0]!;
      d[1] += v * a.axis[1]!;
      d[2] += v * a.axis[2]!;
      by.set(a.siteLabel, d);
    }
  }
  return [...by].map(([siteLabel, axis]) => ({ siteLabel, axis }));
}

/** The green arrows chosen: one row's eigenvector, one irrep's field, or every listed mode's. */
export type ModeArrows =
  | { readonly kind: "mode"; readonly id: string }
  | { readonly kind: "irrep"; readonly id: string }
  | { readonly kind: "all" };

export const sameArrows = (a: ModeArrows | null, b: ModeArrows | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && (a.kind === "all" || a.id === (b as { id: string }).id));

/** The field drawn for a choice, from the rows listed; null when nothing is drawn (no choice, a row gone, or every amplitude 0). */
export function arrowField(
  arrows: ModeArrows | null,
  rows: readonly DistortionMode[],
  params: readonly RefinementParameter[],
  highlightSites: readonly string[] | null = null,
): DisplacementField | null {
  if (!arrows) return null;
  if (arrows.kind === "mode") {
    // One row: its unit eigenvector, on the chosen site's atoms when a site chip is on.
    const mode = rows.find((m) => m.id === arrows.id);
    if (!mode) return null;
    const kept = highlightSites ? mode.axes.filter((a) => highlightSites.includes(a.siteLabel)) : mode.axes;
    return kept.length > 0 ? kept : mode.axes;
  }
  const modes = arrows.kind === "all" ? rows : rows.filter((m) => (m.irrep?.label ?? m.label) === arrows.id);
  if (modes.length === 0) return null;
  const field = summedField(modes, params).filter((d) => d.axis.some((x) => Math.abs(x) > 1e-12));
  return field.length > 0 ? field : null;
}

/** The longest Cartesian shift of a field (Å): the symmetry copies are isometries, so a site's copies all shift by its own length. */
export function largestShift(field: DisplacementField, cell: UnitCell): number {
  return field.reduce((mx, d) => {
    const c = fractionalToCartesian(cell, d.axis);
    return Math.max(mx, Math.hypot(c[0]!, c[1]!, c[2]!));
  }, 0);
}

/**
 * The Cartesian arrow on each atom a field moves, as StructureView draws it:
 * the site's fractional vector rotated by the copy's placing operation
 * (d′ = R·d; displacements are polar, so no det or θ), then to Cartesian (a
 * linear map). Linear in the field: an irrep's arrows are the sum of its rows'.
 */
export function atomArrows(atoms: readonly Pick<CellAtom, "label" | "xyz" | "rot">[], cell: UnitCell, field: DisplacementField): { readonly atom: number; readonly xyz: Vec3; readonly vec: Vec3 }[] {
  const bySite = new Map(field.map((d) => [d.siteLabel, d.axis]));
  const out: { atom: number; xyz: Vec3; vec: Vec3 }[] = [];
  atoms.forEach((at, i) => {
    const ax = bySite.get(at.label);
    if (!ax) return;
    const df: Vec3 = [
      at.rot[0]![0]! * ax[0]! + at.rot[0]![1]! * ax[1]! + at.rot[0]![2]! * ax[2]!,
      at.rot[1]![0]! * ax[0]! + at.rot[1]![1]! * ax[1]! + at.rot[1]![2]! * ax[2]!,
      at.rot[2]![0]! * ax[0]! + at.rot[2]![1]! * ax[1]! + at.rot[2]![2]! * ax[2]!,
    ];
    out.push({ atom: i, xyz: at.xyz, vec: fractionalToCartesian(cell, df) });
  });
  return out;
}
