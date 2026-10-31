/**
 * An ISODISTORT mode CIF of a mode set by parent irrep (subgroup engine phase
 * 4, THY-35; ISODISTORT help, "CIF output"): the child structure in standard
 * CIF tags, and the symmetry modes in ISODISTORT's own tags, as ISODISTORT
 * 6.12 writes them:
 *
 *  - `_iso_displacivemode_ID/label/value`: each mode, its amplitude A_s
 *    (ISODISTORT's supercell-normalised amplitude, ADR 0003);
 *  - `_iso_displacivemodenorm_ID/value`: each mode's normfactor;
 *  - `_iso_deltacoordinate_ID/label/value`: the free coordinates' shifts from
 *    the undistorted child (lattice units);
 *  - `_iso_coordinate_label/formula`: every coordinate as the undistorted
 *    value plus its shifts ("1/4 + O1_dx");
 *  - `_iso_displacivemodematrix_row/col/value`: deltacoords =
 *    matrix·(amplitudes·normfactors), the matrix holding each mode's vector
 *    with its largest component ±1;
 *  - `_iso_parentcell_*` and `_iso_parent-to-child.transform_Pp_abc`.
 *
 * The normfactor follows ISODISTORT's definition: the mode vector times it has
 * a sum of squares of 1 Å² over the primitive child cell, in the unstrained
 * cell. MATERIA's amplitude A runs over the conventional child cell, so
 * A_s = A/√f_child.
 *
 * MATERIA's own `_materia_*` items carry what an exact round trip needs and
 * ISODISTORT does not write: the generic labels and irreps (ADR 0004), each
 * mode's A, free/fixed state and axes, the undistorted positions, the
 * amplitude cells, the parent's name, group, sites and child basis. Text outside ASCII in them is written as \uXXXX escapes. Numbers
 * are written in full (JavaScript's shortest round-trip form), so export and
 * import give back the same structure and amplitudes.
 *
 * Labels in ISODISTORT's form, e.g. "Pm-3m[1/2,1/2,1/2]R_irrep8of10(a,a,a)[O:c:dsp]m1",
 * keep the shape other readers (GSAS-II) parse, with MATERIA's generic irrep
 * name in place of a CDML one, which MATERIA does not compute.
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import type { DistortionModeSet } from "@/core/crystal/distortionModes";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { siteMultiplicity } from "@/core/crystal/symmetry";
import { cellVolume } from "@/core/crystal/unitCell";
import { latticeCentring } from "@/core/crystal/standardSetting";

/** A number in full: the shortest decimal that reads back as the same double. */
const full = (x: number): string => (Object.is(x, -0) ? "0" : String(x));

/** CIF text in single quotes, non-ASCII as \uXXXX (MATERIA's own items only). */
export function cifText(s: string): string {
  const ascii = s.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).replace(/\\(?!u[0-9a-f]{4})/g, "\\\\");
  return `'${ascii.replace(/'/g, "\\u0027")}'`;
}

/** A rational with a small denominator as ISODISTORT writes it ("1/4", "-1/2", "0"), else in full. */
export function fractionText(x: number): string {
  for (const d of [1, 2, 3, 4, 6, 8, 12, 24, 48]) {
    const n = Math.round(x * d);
    if (Math.abs(x * d - n) < 1e-12) return d === 1 ? String(n) : `${n}/${d}`;
  }
  return full(x);
}

/** ISODISTORT's short parent symbol: "P m -3 m" → "Pm-3m", "F d -3 m:2" → "Fd-3m". */
function compactSymbol(hm: string | undefined): string {
  return (hm ?? "P1").replace(/:.*$/, "").replace(/\s+/g, "");
}

/** The free coordinates of a site: the pivots of its allowed shifts in row-echelon form, and how x, y, z follow from them. */
export function freeCoordinates(structure: StructureModel, siteIndex: number): { readonly axes: readonly number[]; readonly rows: readonly Vec3[] } {
  const site = structure.sites[siteIndex]!;
  const basis = allowedPositionShifts(structure.spaceGroup.operations, site.position).basis.map((b) => [...b]);
  // Reduced row-echelon form: each row has a leading 1 at its free coordinate.
  const rows = basis.map((b) => [...b]);
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < 3 && r < rows.length; c++) {
    let p = r;
    for (let i = r + 1; i < rows.length; i++) if (Math.abs(rows[i]![c]!) > Math.abs(rows[p]![c]!)) p = i;
    if (Math.abs(rows[p]![c]!) < 1e-9) continue;
    [rows[r], rows[p]] = [rows[p]!, rows[r]!];
    const d = rows[r]![c]!;
    rows[r] = rows[r]!.map((x) => x / d);
    for (let i = 0; i < rows.length; i++) {
      if (i === r) continue;
      const f = rows[i]![c]!;
      rows[i] = rows[i]!.map((x, j) => x - f * rows[r]![j]!);
    }
    pivots.push(c);
    r++;
  }
  return { axes: pivots, rows: rows.map((row) => row.map((x) => (Math.abs(x) < 1e-12 ? 0 : x)) as unknown as Vec3) };
}

const AXIS = ["x", "y", "z"] as const;

/**
 * A generic irrep label as an ISODISTORT-shaped token, ASCII and free of
 * spaces and brackets: "R irrep 8 of 10" → "R_irrep8of10", "M irreps 3⊕4 of 10"
 * → "M_irreps3+4of10", Γ as GM, an unnamed star as "k".
 */
export function irrepToken(label: string, star: string | undefined): string {
  const m = label.match(/irreps?\s+([\d⊕]+)\s+of\s+(\d+)(.*)$/);
  const name = star === undefined || star.startsWith("k") ? "k" : star === "Γ" ? "GM" : star.replace(/[^A-Za-z0-9]/g, "");
  if (!m) return `${name}_${label.replace(/[^A-Za-z0-9+]/g, "")}`;
  const tail = /doubled/.test(m[3]!) ? "d" : /conjugate/.test(m[3]!) ? "c" : "";
  return `${name}_irrep${m[1]!.includes("⊕") ? "s" : ""}${m[1]!.replace(/⊕/g, "+")}of${m[2]}${tail}`;
}

function loop(tags: readonly string[], rows: readonly (readonly string[])[]): string {
  return ["loop_", ...tags.map((t) => `_${t}`), ...rows.map((r) => r.join("  "))].join("\n");
}

/** "a,c,-2b;0,2,0": the child's axes in the parent's, and its origin. */
export function transformText(P: Mat3, p: Vec3): string {
  const axis = (j: number): string => {
    let out = "";
    ["a", "b", "c"].forEach((name, i) => {
      const x = P[i]![j]!;
      if (Math.abs(x) < 1e-12) return;
      const mag = Math.abs(Math.abs(x) - 1) < 1e-12 ? "" : fractionText(Math.abs(x));
      out += `${x < 0 ? "-" : out === "" ? "" : "+"}${mag}${name}`;
    });
    return out || "0";
  };
  return `${axis(0)},${axis(1)},${axis(2)};${p.map(fractionText).join(",")}`;
}

export interface ModeCifInput {
  /** The mode set in force (modes by parent irrep: each mode carries its irrep). */
  readonly set: DistortionModeSet;
  /** The child as refined: the set's structure with the current values (cell, ADPs, positions). */
  readonly child: StructureModel;
  /** The current amplitude of each mode, by id (MATERIA's A). */
  readonly values: Readonly<Record<string, number>>;
  /** Which modes are free, by id. */
  readonly free?: Readonly<Record<string, boolean>>;
  readonly version: string;
}

/** The mode CIF (see the module comment). Throws when the set's modes carry no parent irrep. */
export function modeCif({ set, child, values, free = {}, version }: ModeCifInput): string {
  const parent = set.parent;
  if (!parent || set.modes.some((m) => !m.irrep)) throw new Error("modeCif: the mode set is not one by parent irrep (activate a supercell child, decompose against a parent, or import a mode CIF)");
  const ref = set.parentized;
  const fChild = latticeCentring(child.spaceGroup.operations).length;
  const cells = set.amplitudeCells ?? { child: fChild, parent: fChild };
  const sqrtF = Math.sqrt(cells.child);
  const ops = child.spaceGroup.operations;
  const parentSymbol = compactSymbol(parent.hermannMauguin);
  const wyckoffOf = new Map(parent.sites.map((s) => [s.label, s.wyckoff] as const));

  // The free coordinates, site by site, in the set's site order.
  const deltas: { site: string; axis: number; row: Vec3; label: string }[] = [];
  const freeOf = new Map<string, { axes: readonly number[]; rows: readonly Vec3[] }>();
  ref.sites.forEach((s, i) => {
    const f = freeCoordinates(ref, i);
    freeOf.set(s.label, f);
    f.axes.forEach((ax, k) => deltas.push({ site: s.label, axis: ax, row: f.rows[k]!, label: `${s.label}_d${AXIS[ax]}` }));
  });
  const deltaIndex = new Map(deltas.map((d, i) => [`${d.site}|${d.axis}`, i] as const));
  const childSite = new Map(child.sites.map((s) => [s.label, s] as const));

  // Each mode's vector in the free coordinates (A_s = 1), its largest component ±1, and its normfactor.
  const modeRows = set.modes.map((mode) => {
    const v = new Array<number>(deltas.length).fill(0);
    for (const { siteLabel, axis } of mode.axes) {
      const f = freeOf.get(siteLabel)!;
      f.axes.forEach((ax) => {
        v[deltaIndex.get(`${siteLabel}|${ax}`)!] = sqrtF * axis[ax]!;
      });
    }
    const s = Math.max(...v.map(Math.abs));
    return { mode, vector: v.map((x) => x / s), norm: s };
  });

  // The shifts of the free coordinates now: the child's coordinates less the undistorted ones.
  const deltaValues = deltas.map((d) => {
    const now = childSite.get(d.site)?.position[d.axis] ?? 0;
    const at0 = ref.sites.find((s) => s.label === d.site)!.position[d.axis]!;
    const x = now - at0;
    return x - Math.round(x);
  });

  const lines: string[] = [];
  lines.push(`# This file was generated by MATERIA ${version} in the mode-CIF form of ISODISTORT 6.12.`);
  lines.push("# Modes are labelled with MATERIA's generic irrep names (ADR 0004); ISODISTORT's CDML labels are not computed.");
  lines.push("#");
  lines.push(`# Space Group: ${parent.number ?? "?"} ${parentSymbol}`);
  lines.push(`# Lattice parameters: a= ${parent.cell.a}, b= ${parent.cell.b}, c= ${parent.cell.c}, alpha= ${parent.cell.alpha}, beta= ${parent.cell.beta}, gamma= ${parent.cell.gamma}`);
  for (const s of parent.sites) lines.push(`# ${s.label} ${s.wyckoff ?? "?"}`);
  lines.push(`# Subgroup: ${child.spaceGroup.number ?? "?"} ${compactSymbol(child.spaceGroup.hermannMauguin)}, basis ${transformText(parent.basis, parent.origin)}`);
  lines.push("");
  lines.push("data_materia-modes");
  lines.push("");
  lines.push(`_pd_phase_name ${cifText(child.name)}`);
  lines.push("");
  const c = child.cell;
  lines.push(`_cell_length_a     ${full(c.a)}`, `_cell_length_b     ${full(c.b)}`, `_cell_length_c     ${full(c.c)}`);
  lines.push(`_cell_angle_alpha  ${full(c.alpha)}`, `_cell_angle_beta   ${full(c.beta)}`, `_cell_angle_gamma  ${full(c.gamma)}`);
  lines.push(`_cell_volume       ${full(cellVolume(c))}`);
  lines.push("");
  if (child.spaceGroup.hermannMauguin) lines.push(`_symmetry_space_group_name_H-M "${child.spaceGroup.hermannMauguin}"`);
  if (child.spaceGroup.number !== undefined) lines.push(`_symmetry_Int_Tables_number ${child.spaceGroup.number}`);
  lines.push("");
  lines.push(loop(["space_group_symop_id", "space_group_symop_operation_xyz"], ops.map((op, i) => [String(i + 1), op.xyz])));
  lines.push("");
  lines.push(loop(
    ["atom_site_label", "atom_site_type_symbol", "atom_site_symmetry_multiplicity", "atom_site_fract_x", "atom_site_fract_y", "atom_site_fract_z", "atom_site_occupancy", "atom_site_adp_type", "atom_site_B_iso_or_equiv"],
    child.sites.map((s) => [
      s.label, s.element, String(siteMultiplicity(ops, s.position)), ...s.position.map(full), full(s.occupancy),
      s.adp.kind === "isotropic" ? "Biso" : "Uani",
      s.adp.kind === "isotropic" ? full(s.adp.bIso) : "?",
    ]),
  ));
  const aniso = child.sites.filter((s) => s.adp.kind === "anisotropic");
  if (aniso.length > 0) {
    lines.push("");
    lines.push(loop(
      ["atom_site_aniso_label", "atom_site_aniso_U_11", "atom_site_aniso_U_22", "atom_site_aniso_U_33", "atom_site_aniso_U_12", "atom_site_aniso_U_13", "atom_site_aniso_U_23"],
      aniso.map((s) => [s.label, ...(s.adp as { uAniso: readonly number[] }).uAniso.map(full)]),
    ));
  }
  lines.push("");
  lines.push(`_iso_displacivemode_number    ${set.modes.length}`);
  lines.push("");
  const kText = (k: readonly number[]): string => k.map(fractionText).join(",");
  const isoLabel = (i: number): string => {
    const mode = set.modes[i]!;
    const ir = mode.irrep!;
    const opd = (ir.direction ?? "(a)").replace(/·/g, "*").replace(/[^\x21-\x7e]/g, "");
    const copy = (mode.label.match(/ (\d+)$/)?.[1]) ?? "1";
    return `${parentSymbol}[${kText(ir.k)}]${irrepToken(ir.label, mode.star)}${opd}[${ir.parentSite}:${wyckoffOf.get(ir.parentSite) ?? "?"}:dsp]m${copy}`;
  };
  lines.push(loop(["iso_displacivemode_ID", "iso_displacivemode_label", "iso_displacivemode_value"], modeRows.map((r, i) => [String(i + 1), isoLabel(i), full((values[r.mode.id] ?? 0) / sqrtF)])));
  lines.push("");
  lines.push(loop(["iso_displacivemodenorm_ID", "iso_displacivemodenorm_value"], modeRows.map((r, i) => [String(i + 1), full(r.norm)])));
  lines.push("");
  lines.push(loop(["iso_deltacoordinate_ID", "iso_deltacoordinate_label", "iso_deltacoordinate_value"], deltas.map((d, i) => [String(i + 1), d.label, full(deltaValues[i]!)])));
  lines.push("");
  lines.push(loop(["iso_coordinate_label", "iso_coordinate_formula"], ref.sites.flatMap((s) => {
    const f = freeOf.get(s.label)!;
    return AXIS.map((name, ax) => {
      const terms = f.axes.map((pivot, k) => ({ coef: f.rows[k]![ax]!, label: `${s.label}_d${AXIS[pivot]}` })).filter((t) => Math.abs(t.coef) > 1e-12);
      const formula = terms.reduce((acc, t) => {
        const mag = Math.abs(Math.abs(t.coef) - 1) < 1e-12 ? "" : `${fractionText(Math.abs(t.coef))}*`;
        return `${acc} ${t.coef < 0 ? "-" : "+"} ${mag}${t.label}`;
      }, fractionText(s.position[ax]!));
      return [`${s.label}_${name}`, `"${formula}"`];
    });
  })));
  lines.push("");
  lines.push("# matrix conversion: deltacoords(lattice units) = matrix.(modeamplitudes*modenormfactors)");
  lines.push("# Square matrix with _iso_displacivemode_number rows and columns");
  lines.push("");
  const entries: string[][] = [];
  deltas.forEach((_, r) => modeRows.forEach((m, j) => {
    const x = m.vector[r]!;
    if (Math.abs(x) > 1e-15) entries.push([String(r + 1), String(j + 1), full(x)]);
  }));
  lines.push(loop(["iso_displacivemodematrix_row", "iso_displacivemodematrix_col", "iso_displacivemodematrix_value"], entries));
  lines.push("");
  lines.push(`_iso_parentcell_length_a     ${full(parent.cell.a)}`, `_iso_parentcell_length_b     ${full(parent.cell.b)}`, `_iso_parentcell_length_c     ${full(parent.cell.c)}`);
  lines.push(`_iso_parentcell_angle_alpha  ${full(parent.cell.alpha)}`, `_iso_parentcell_angle_beta   ${full(parent.cell.beta)}`, `_iso_parentcell_angle_gamma  ${full(parent.cell.gamma)}`);
  lines.push(`_iso_parentcell_volume       ${full(cellVolume(parent.cell))}`);
  lines.push(`_iso_parent-to-child.transform_Pp_abc ${transformText(parent.basis, parent.origin)}`);
  lines.push("");
  // MATERIA's own items: what the round trip needs and ISODISTORT does not write.
  lines.push("# MATERIA's own items (an exact round trip): generic labels and irreps, A and free state, amplitude cells, the parent.");
  lines.push(`_materia_modes_version 1`);
  lines.push(`_materia_parent_name ${cifText(parent.name)}`);
  if (parent.hermannMauguin) lines.push(`_materia_parent_space_group_name_H-M ${cifText(parent.hermannMauguin)}`);
  if (parent.number !== undefined) lines.push(`_materia_parent_space_group_IT_number ${parent.number}`);
  lines.push(`_materia_parent_centring ${parent.centring}`);
  lines.push(`_materia_parent_basis ${cifText(parent.basis.flat().map(full).join(" "))}`);
  lines.push(`_materia_parent_origin ${cifText(parent.origin.map(full).join(" "))}`);
  lines.push(`_materia_amplitude_cells_child ${full(cells.child)}`);
  lines.push(`_materia_amplitude_cells_parent ${full(cells.parent)}`);
  if (set.acousticExcluded !== undefined) lines.push(`_materia_acoustic_excluded ${set.acousticExcluded}`);
  lines.push("");
  lines.push(loop(["materia_parent_site_label", "materia_parent_site_type_symbol", "materia_parent_site_Wyckoff_symbol"], parent.sites.map((s) => [cifText(s.label), cifText(s.element), s.wyckoff ?? "?"])));
  lines.push("");
  lines.push(loop(
    ["materia_mode_ID", "materia_mode_label", "materia_mode_irrep", "materia_mode_k", "materia_mode_direction", "materia_mode_parent_site", "materia_mode_star", "materia_mode_amplitude", "materia_mode_free"],
    set.modes.map((mode, i) => [
      String(i + 1), cifText(mode.label), cifText(mode.irrep!.label), cifText(mode.irrep!.k.map(full).join(" ")),
      mode.irrep!.direction !== undefined ? cifText(mode.irrep!.direction) : "?", cifText(mode.irrep!.parentSite),
      mode.star !== undefined ? cifText(mode.star) : "?", full(values[mode.id] ?? 0), free[mode.id] ? "1" : "0",
    ]),
  ));
  lines.push("");
  lines.push(loop(["materia_reference_site_label", "materia_reference_site_fract_x", "materia_reference_site_fract_y", "materia_reference_site_fract_z"], ref.sites.map((x) => [cifText(x.label), ...x.position.map(full)])));
  lines.push("");
  lines.push(loop(["materia_mode_axis_mode_ID", "materia_mode_axis_site_label", "materia_mode_axis_x", "materia_mode_axis_y", "materia_mode_axis_z"], set.modes.flatMap((mode, i) => mode.axes.map((a) => [String(i + 1), cifText(a.siteLabel), ...a.axis.map(full)]))));
  lines.push("");
  lines.push("# end of structure file");
  lines.push("# end of cif");
  return `${lines.join("\n")}\n`;
}

export { compactSymbol as isodistortSymbol };
