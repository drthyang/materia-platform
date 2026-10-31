/**
 * Read an ISODISTORT mode CIF (subgroup engine phase 4, THY-35): the child
 * structure, and its displacive modes as a mode set refinable on it. Reads
 * ISODISTORT's own output (6.x: the tags of `export/modeCif.ts`) and MATERIA's
 * export, whose `_materia_*` items give back MATERIA's labels, irreps, A and
 * free state exactly.
 *
 * From ISODISTORT's tags: the coordinate formulas give each site's undistorted
 * position and how x, y, z follow from the free coordinates' shifts; the
 * matrix and normfactors give each mode's shifts at A_s = 1 (deltacoords =
 * matrix·(A_s·normfactor)); MATERIA's parameter is A = √f_child·A_s (ADR
 * 0003), so a mode's axis at A = 1 is its shifts at A_s = 1 over √f_child.
 * The labels are ISODISTORT's ("Pm-3m[1/2,1/2,1/2]R4+(a,a,a)[O1:d:dsp]Eu(a)"),
 * CDML labels read from the file as ADR 0004 allows; the irrep, k-point,
 * direction and parent site are read from them.
 *
 * Only displacive modes are read; occupancy, magnetic, rotational and strain
 * modes are listed in `ignored` (the cell stays as the file gives it).
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import type { DistortionMode, DistortionModeSet, ModeSetParent } from "@/core/crystal/distortionModes";
import { parseCif, readCifBlock } from "@/parsers/cif";
import { latticeCentring } from "@/core/crystal/standardSetting";

export interface ModeCif {
  /** The child as the file gives it (its atom sites: the distorted structure). */
  readonly structure: StructureModel;
  /** The modes as a mode set on the child: the sites at their undistorted positions, the amplitudes seeded at the file's values. */
  readonly set: DistortionModeSet;
  /** The parent's space group as the file names it (the labels' prefix, "Pm-3m"), its number when given. */
  readonly parentSymbol?: string;
  readonly parentNumber?: number;
  /** Kinds of modes the file carries that are not read (occupancy, magnetic, rotational, strain). */
  readonly ignored: readonly string[];
  /** Written by MATERIA (its `_materia_*` items present). */
  readonly materia: boolean;
}

/** MATERIA's \uXXXX escapes back to text. */
export function cifUnescape(s: string): string {
  return s.replace(/\\u([0-9a-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\\\/g, "\\");
}

/** A number as a CIF or ISODISTORT writes it: "0.25", "1/4", "-0.00907(3)". */
function num(t: string): number {
  const s = t.trim().replace(/\([0-9]+\)$/, "");
  const [n, d] = s.split("/");
  const v = Number(n) / (d === undefined ? 1 : Number(d));
  if (!Number.isFinite(v)) throw new Error(`mode CIF: "${t}" is not a number`);
  return v;
}

/**
 * A linear formula of ISODISTORT's coordinate form: a constant and terms
 * "± [k*]label", e.g. "1/4 + O1_dx", "0 - 2*O1_dx", "1/2". Returns the
 * constant and each label's coefficient.
 */
export function parseFormula(text: string): { readonly constant: number; readonly terms: ReadonlyMap<string, number> } {
  const src = text.replace(/\s+/g, "");
  const terms = new Map<string, number>();
  let constant = 0;
  let i = 0;
  while (i < src.length) {
    let sign = 1;
    while (src[i] === "+" || src[i] === "-") {
      if (src[i] === "-") sign = -sign;
      i++;
    }
    let j = i;
    while (j < src.length && src[j] !== "+" && src[j] !== "-") j++;
    // A number in exponent form keeps its sign ("1e-5").
    while (j < src.length && /[eE]$/.test(src.slice(i, j)) && /^[0-9.]+[eE]$/.test(src.slice(i, j))) {
      j++;
      while (j < src.length && src[j] !== "+" && src[j] !== "-") j++;
    }
    const term = src.slice(i, j);
    if (term === "") throw new Error(`mode CIF: cannot read the formula "${text}"`);
    const star = term.lastIndexOf("*");
    const head = star >= 0 ? term.slice(0, star) : "";
    const tail = star >= 0 ? term.slice(star + 1) : term;
    if (/^[0-9./eE]+$/.test(tail)) constant += sign * num(tail) * (head === "" ? 1 : num(head));
    else terms.set(tail, (terms.get(tail) ?? 0) + sign * (head === "" ? 1 : num(head)));
    i = j;
  }
  return { constant, terms };
}

/** "a,c,-2b;0,2,0" → P (child axes as columns) and p. */
function parseTransform(text: string): { P: Mat3; p: Vec3 } | null {
  const [axes, origin] = text.split(";");
  if (!axes) return null;
  const cols = axes.split(",").map((expr) => {
    const v = [0, 0, 0];
    const f = parseFormula(expr.replace(/([0-9.]+)([abc])/g, "$1*$2"));
    for (const [name, k] of f.terms) {
      const i = ["a", "b", "c"].indexOf(name);
      if (i < 0) return null;
      v[i] = k;
    }
    return v;
  });
  if (cols.length !== 3 || cols.some((c) => c === null)) return null;
  const P = [0, 1, 2].map((i) => [0, 1, 2].map((j) => cols[j]![i]!)) as unknown as Mat3;
  const p = (origin ?? "0,0,0").split(",").map(num);
  return { P, p: [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0] };
}

const det3 = (m: Mat3): number =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

/** Lattice points per conventional cell of a space-group symbol's lattice letter. */
const centringOfSymbol = (symbol: string): number => ({ P: 1, A: 2, B: 2, C: 2, I: 2, F: 4, R: 3 } as Record<string, number>)[symbol.trim()[0]?.toUpperCase() ?? "P"] ?? 1;

/** What an ISODISTORT label says: "Pm-3m[1/2,1/2,1/2]R4+(a,a,a)[O1:d:dsp]Eu(a)". */
function parseIsoLabel(label: string): { parent?: string; k?: Vec3; irrep?: string; direction?: string; site?: string; wyckoff?: string } {
  const m = label.match(/^([^[]+)\[([^\]]*)\]([^([]+)(\([^)]*\))?\[([^:\]]+):?([^:\]]*):?[^\]]*\]/);
  if (!m) return {};
  const k = m[2]!.split(",").map((x) => {
    try {
      return num(x);
    } catch {
      return NaN;
    }
  });
  return {
    parent: m[1]!,
    ...(k.length === 3 && k.every(Number.isFinite) ? { k: [k[0]!, k[1]!, k[2]!] as Vec3 } : {}),
    irrep: m[3]!,
    ...(m[4] ? { direction: m[4] } : {}),
    site: m[5]!,
    ...(m[6] ? { wyckoff: m[6] } : {}),
  };
}

/**
 * The mode CIF read (see the module comment). Throws, with the reason, when it
 * holds no displacive modes or their tags do not fit together.
 */
export function parseModeCif(text: string, id = "mode-cif"): ModeCif {
  const structure = parseCif(text, id);
  const { items, loops } = readCifBlock(text);
  const loopWith = (tag: string) => {
    const l = loops.find((x) => x.headers.includes(tag));
    if (l?.malformed) throw new Error(`mode CIF: ${l.malformed}`);
    return l;
  };
  const column = (tag: string): string[] => {
    const l = loopWith(tag);
    if (!l) return [];
    const c = l.headers.indexOf(tag);
    return l.rows.map((r) => r[c] ?? "");
  };
  const modeIds = column("_iso_displacivemode_id").map((x) => parseInt(x, 10));
  const modeLabels = column("_iso_displacivemode_label");
  const modeValues = column("_iso_displacivemode_value").map(num);
  if (modeIds.length === 0) throw new Error("mode CIF: no displacive modes (_iso_displacivemode_label)");
  const normIds = column("_iso_displacivemodenorm_id").map((x) => parseInt(x, 10));
  const norms = new Map(normIds.map((i, k) => [i, num(column("_iso_displacivemodenorm_value")[k]!)] as const));
  const deltaIds = column("_iso_deltacoordinate_id").map((x) => parseInt(x, 10));
  const deltaLabels = column("_iso_deltacoordinate_label");
  const rows = column("_iso_displacivemodematrix_row").map((x) => parseInt(x, 10));
  const cols = column("_iso_displacivemodematrix_col").map((x) => parseInt(x, 10));
  const vals = column("_iso_displacivemodematrix_value").map(num);
  // deltacoords = matrix·(A_s·norm): delta row r, mode column j.
  const matrix = new Map<string, number>();
  rows.forEach((r, k) => matrix.set(`${r}|${cols[k]}`, vals[k]!));
  const deltaRow = new Map(deltaIds.map((i, k) => [deltaLabels[k]!, i] as const));

  // Each coordinate: its undistorted value and its shifts' coefficients.
  const formulas = new Map<string, { constant: number; terms: ReadonlyMap<string, number> }>();
  const coordLabels = column("_iso_coordinate_label");
  const coordFormulas = column("_iso_coordinate_formula");
  coordLabels.forEach((label, k) => formulas.set(label, parseFormula(coordFormulas[k]!)));

  const fChild = latticeCentring(structure.spaceGroup.operations).length;
  const sqrtF = Math.sqrt(fChild);
  // A site's displacement (fractional) for a set of shifts: x_i = constant + Σ coefficient·shift.
  const shiftOfSite = (site: string, shifts: (label: string) => number): Vec3 => [0, 1, 2].map((axis) => {
    const f = formulas.get(`${site}_${["x", "y", "z"][axis]}`);
    if (!f) return 0;
    let s = 0;
    for (const [label, k] of f.terms) if (deltaRow.has(label)) s += k * shifts(label);
    return s;
  }) as unknown as Vec3;

  // MATERIA's own items, when present.
  const materiaRows = loopWith("_materia_mode_id");
  const mcol = (tag: string): string[] => {
    if (!materiaRows) return [];
    const c = materiaRows.headers.indexOf(tag);
    return c < 0 ? [] : materiaRows.rows.map((r) => r[c] ?? "");
  };
  const materia = materiaRows !== undefined;
  const mLabels = mcol("_materia_mode_label").map(cifUnescape);
  const mIrreps = mcol("_materia_mode_irrep").map(cifUnescape);
  const mK = mcol("_materia_mode_k").map((x) => cifUnescape(x).split(/\s+/).map(Number) as unknown as Vec3);
  const mDir = mcol("_materia_mode_direction").map((x) => (x === "?" ? undefined : cifUnescape(x)));
  const mSite = mcol("_materia_mode_parent_site").map(cifUnescape);
  const mStar = mcol("_materia_mode_star").map((x) => (x === "?" ? undefined : cifUnescape(x)));
  const mA = mcol("_materia_mode_amplitude").map(Number);
  const mFree = mcol("_materia_mode_free").map((x) => x === "1");

  const parentSites = loopWith("_materia_parent_site_label");
  const transform = items.get("_iso_parent-to-child.transform_pp_abc");
  const parsedTransform = transform ? parseTransform(transform) : null;
  const firstLabel = parseIsoLabel(modeLabels[0] ?? "");
  const parentSymbol = items.has("_materia_parent_space_group_name_h-m") ? cifUnescape(items.get("_materia_parent_space_group_name_h-m")!) : firstLabel.parent;
  const numberFromComment = text.match(/^#\s*Space Group:\s*(\d+)/m)?.[1];
  const parentNumber = items.has("_materia_parent_space_group_it_number") ? Number(items.get("_materia_parent_space_group_it_number")) : numberFromComment ? Number(numberFromComment) : undefined;
  const parentCentring = items.has("_materia_parent_centring") ? Number(items.get("_materia_parent_centring")) : centringOfSymbol(parentSymbol ?? "P");
  const numbers = (tag: string): number[] | null => {
    const raw = items.get(tag);
    return raw === undefined ? null : cifUnescape(raw).trim().split(/\s+/).map(Number);
  };
  const b9 = numbers("_materia_parent_basis");
  const basis: Mat3 | undefined = b9 && b9.length === 9 ? [[b9[0]!, b9[1]!, b9[2]!], [b9[3]!, b9[4]!, b9[5]!], [b9[6]!, b9[7]!, b9[8]!]] : parsedTransform?.P;
  const o3 = numbers("_materia_parent_origin");
  const origin: Vec3 = o3 && o3.length === 3 ? [o3[0]!, o3[1]!, o3[2]!] : parsedTransform?.p ?? [0, 0, 0];
  const cellsParent = items.has("_materia_amplitude_cells_parent")
    ? Number(items.get("_materia_amplitude_cells_parent"))
    : basis ? Math.round(Math.abs(det3(basis)) * parentCentring * 1e9) / 1e9 : fChild;

  // MATERIA's exact axes and undistorted positions, when it wrote the file.
  const axisRows = loopWith("_materia_mode_axis_mode_id");
  const exactAxes = new Map<number, { siteLabel: string; axis: Vec3 }[]>();
  if (axisRows) {
    const h = (t: string): number => axisRows.headers.indexOf(t);
    for (const r of axisRows.rows) {
      const j = parseInt(r[h("_materia_mode_axis_mode_id")]!, 10);
      const list = exactAxes.get(j) ?? [];
      list.push({ siteLabel: cifUnescape(r[h("_materia_mode_axis_site_label")]!), axis: [Number(r[h("_materia_mode_axis_x")]), Number(r[h("_materia_mode_axis_y")]), Number(r[h("_materia_mode_axis_z")])] });
      exactAxes.set(j, list);
    }
  }
  const refRows = loopWith("_materia_reference_site_label");
  const exactRef = new Map<string, Vec3>();
  if (refRows) {
    const h = (t: string): number => refRows.headers.indexOf(t);
    for (const r of refRows.rows) exactRef.set(cifUnescape(r[h("_materia_reference_site_label")]!), [Number(r[h("_materia_reference_site_fract_x")]), Number(r[h("_materia_reference_site_fract_y")]), Number(r[h("_materia_reference_site_fract_z")])]);
  }

  // The modes on the child's sites.
  const parameters: RefinementParameter[] = [];
  const bindings: ParameterBinding[] = [];
  const modes: DistortionMode[] = modeIds.map((mid, j) => {
    const norm = norms.get(mid);
    if (norm === undefined) throw new Error(`mode CIF: mode ${mid} has no normfactor`);
    const axes: { siteLabel: string; axis: Vec3 }[] = exactAxes.get(j + 1) ?? [];
    if (!exactAxes.has(j + 1)) {
      for (const site of structure.sites.map((s) => s.label)) {
        const shift = shiftOfSite(site, (label) => (matrix.get(`${deltaRow.get(label)}|${mid}`) ?? 0) * norm / sqrtF);
        if (Math.hypot(...shift) > 1e-15) axes.push({ siteLabel: site, axis: shift });
      }
    }
    const id = `mode_${j + 1}`;
    const isoLabel = modeLabels[j]!;
    const info = parseIsoLabel(isoLabel);
    const label = materia ? mLabels[j]! : isoLabel;
    const a = materia && Number.isFinite(mA[j]) ? mA[j]! : modeValues[j]! * sqrtF;
    const free = materia ? mFree[j]! : Math.abs(a) > 1e-5;
    parameters.push({ id, label, kind: "positionShift", value: a, initialValue: a, fixed: !free });
    for (const { siteLabel, axis } of axes) bindings.push({ parameterId: id, kind: "positionShift", targetId: structure.id, targetKey: siteLabel, axis });
    const irrepLabel = materia ? mIrreps[j]! : info.irrep ?? isoLabel;
    const k = materia ? mK[j]! : info.k ?? ([0, 0, 0] as Vec3);
    const direction = materia ? mDir[j] : info.direction;
    const parentSite = materia ? mSite[j]! : info.site ?? "?";
    const star = materia ? mStar[j] : undefined;
    return {
      id,
      label,
      ...(star !== undefined ? { star } : {}),
      observedAmplitude: a,
      axes,
      active: free,
      irrep: { label: irrepLabel, k, ...(direction !== undefined ? { direction } : {}), parentSite },
    };
  });

  // The undistorted child: MATERIA's positions, else each site at its formulas' constants (ISODISTORT's undistorted values).
  const parentized: StructureModel = {
    ...structure,
    sites: structure.sites.map((s) => {
      const exact = exactRef.get(s.label);
      if (exact) return { ...s, position: exact };
      const f = ["x", "y", "z"].map((a) => formulas.get(`${s.label}_${a}`));
      if (f.some((x) => !x)) return s;
      return { ...s, position: [f[0]!.constant, f[1]!.constant, f[2]!.constant] as Vec3 };
    }),
  };

  const parent: ModeSetParent | undefined = (() => {
    const name = items.has("_materia_parent_name") ? cifUnescape(items.get("_materia_parent_name")!) : parentSymbol ?? "parent";
    const cell = ["a", "b", "c"].every((x) => items.has(`_iso_parentcell_length_${x}`))
      ? {
        a: num(items.get("_iso_parentcell_length_a")!), b: num(items.get("_iso_parentcell_length_b")!), c: num(items.get("_iso_parentcell_length_c")!),
        alpha: num(items.get("_iso_parentcell_angle_alpha") ?? "90"), beta: num(items.get("_iso_parentcell_angle_beta") ?? "90"), gamma: num(items.get("_iso_parentcell_angle_gamma") ?? "90"),
      }
      : undefined;
    if (!cell || !basis) return undefined;
    const siteLabels = parentSites ? parentSites.rows.map((r) => cifUnescape(r[parentSites.headers.indexOf("_materia_parent_site_label")]!)) : [];
    const siteElements = parentSites ? parentSites.rows.map((r) => cifUnescape(r[parentSites.headers.indexOf("_materia_parent_site_type_symbol")]!)) : [];
    const siteWyckoff = parentSites ? parentSites.rows.map((r) => r[parentSites.headers.indexOf("_materia_parent_site_wyckoff_symbol")]!) : [];
    return {
      name,
      ...(parentSymbol !== undefined ? { hermannMauguin: parentSymbol } : {}),
      ...(parentNumber !== undefined && Number.isFinite(parentNumber) ? { number: parentNumber } : {}),
      cell,
      centring: parentCentring,
      basis,
      origin,
      sites: siteLabels.map((label, i) => ({ label, element: siteElements[i]!, ...(siteWyckoff[i] && siteWyckoff[i] !== "?" ? { wyckoff: siteWyckoff[i] } : {}) })),
    };
  })();

  const ignored = ["_iso_occupancymode_label", "_iso_magneticmode_label", "_iso_rotationalmode_label", "_iso_strainmode_label"]
    .filter((t) => loops.some((l) => l.headers.includes(t) && l.rows.length > 0))
    .map((t) => t.replace(/^_iso_(\w+?)mode_label$/, "$1"));
  const acoustic = items.get("_materia_acoustic_excluded");
  const set: DistortionModeSet = {
    parentized,
    originShift: parent?.origin ?? [0, 0, 0],
    parameters,
    bindings,
    modes,
    totalAmplitude: Math.sqrt(parameters.reduce((s, p) => s + p.value * p.value, 0)),
    unpaired: [],
    ...(acoustic !== undefined ? { acousticExcluded: Number(acoustic) } : {}),
    amplitudeCells: { child: items.has("_materia_amplitude_cells_child") ? Number(items.get("_materia_amplitude_cells_child")) : fChild, parent: cellsParent },
    ...(parent ? { parent } : {}),
  };
  return {
    structure,
    set,
    ...(parentSymbol !== undefined ? { parentSymbol } : {}),
    ...(parentNumber !== undefined && Number.isFinite(parentNumber) ? { parentNumber } : {}),
    ignored,
    materia,
  };
}
