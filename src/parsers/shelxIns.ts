/**
 * A SHELX instruction file (.ins, or the .res SHELXL writes back): the model
 * a SHELXL refinement starts from or ends with, read as a structure.
 *
 * - CELL λ a b c α β γ; LATT n (centring |n|: 1 P, 2 I, 3 R obverse, 4 F,
 *   5 A, 6 B, 7 C; n > 0 adds the inversion); SYMM, the other operations;
 *   SFAC, the element of each scattering-factor number.
 * - An atom line, `name sfac x y z sof U11 U22 U33 U23 U13 U12` (note SHELX's
 *   order) or `… sof Uiso`, continued with `=`. Any value may reference a free
 *   variable (FVAR): 10m + p is p·fv(m) and −(10m + p) is p·(fv(m) − 1), m = 1
 *   holding p fixed. A sof carries the site's symmetry (0.5 on a twofold axis):
 *   the occupancy is sof divided by the site's share of the general position.
 *   A U_iso between −0.5 and −5 rides: |U|·U_eq of the previous atom that is
 *   not a hydrogen.
 * - AFIX and PART are recorded per atom (the hydrogen groups, the disorder
 *   groups); TWIN, BASF, EXTI, WGHT, FVAR and TEMP are returned as the file's
 *   instructions, for the page to apply or the Agent to read.
 *
 * Everything after END is ignored (a .res lists its difference-map peaks
 * there). Reference: the SHELXL manual (Sheldrick, 2008 and later).
 */

import type { AtomSite, StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { Mat3, Vec3 } from "@/core/math/types";
import { EIGHT_PI_SQUARED, uEquivalent } from "@/core/crystal/adp";
import { elementFromLetters } from "@/core/crystal/elements";
import { expandGenerators, settingForOperations, spaceGroupFromSetting } from "@/core/crystal/spaceGroups";
import { parseSymmetryOperation, siteMultiplicity } from "@/core/crystal/symmetry";

/** What the file asks of a refinement, beyond the structure. */
export interface ShelxInstructions {
  readonly title: string;
  /** CELL's wavelength (Å): the radiation the data were measured with. */
  readonly wavelength: number;
  /** TEMP, in kelvin. */
  readonly temperature?: number;
  /** TWIN: the matrix (rows, h′ = R·h) and the number of domains. */
  readonly twin?: { readonly matrix: Mat3; readonly domains: number };
  /** BASF: the fractions of the domains after the first. */
  readonly basf: readonly number[];
  /** EXTI x. */
  readonly exti?: number;
  /** WGHT a b (the other four terms when given). */
  readonly weighting?: { readonly a: number; readonly b: number };
  /** FVAR: the overall scale factor OSF first, then the free variables 2, 3, … */
  readonly freeVariables: readonly number[];
  /** HKLF n. */
  readonly hklf?: number;
  /** The AFIX code each atom was read under (0 for none). */
  readonly afix: ReadonlyMap<string, number>;
  /** Hydrogens whose U_iso is one refined free variable they share (U given as 10m + p, m > 1). */
  readonly sharedU: readonly { readonly variable: number; readonly value: number; readonly labels: readonly string[] }[];
  /** Hydrogens whose U_iso rides: the factor on the parent's U_eq (−1.2 → 1.2). */
  readonly ridingU: ReadonlyMap<string, number>;
  /** Instructions read and not carried into the model (restraints, plane and bond listings, …), each once. */
  readonly notCarried: readonly string[];
}

export interface ShelxModel {
  readonly structure: StructureModel;
  readonly instructions: ShelxInstructions;
}

/** The instructions SHELXL knows: a line starting with one is no atom. */
const KEYWORDS = new Set([
  "TITL", "CELL", "ZERR", "LATT", "SYMM", "SFAC", "DISP", "UNIT", "LAUE", "REM", "MORE", "TIME", "END", "HKLF", "OMIT", "SHEL", "BASF", "TWIN",
  "EXTI", "SWAT", "HOPE", "MERG", "SPEC", "RESI", "MOVE", "ANIS", "AFIX", "HFIX", "FRAG", "FEND", "EXYZ", "EADP", "EQIV", "CONN", "PART", "BIND",
  "FREE", "DFIX", "DANG", "BUMP", "SAME", "SADI", "CHIV", "FLAT", "DELU", "SIMU", "DEFS", "ISOR", "NCSY", "SUMP", "L.S.", "CGLS", "BLOC", "DAMP",
  "STIR", "WGHT", "FVAR", "BOND", "CONF", "MPLA", "RTAB", "HTAB", "LIST", "ACTA", "SIZE", "TEMP", "WPDB", "FMAP", "GRID", "PLAN", "MOLE", "ABIN",
  "ANSC", "ANSR", "NEUT", "TWST", "BEDE", "LONE", "RIGU", "XNPD", "PRIG", "WIGL", "SHEL", "DISP",
]);

/** Instructions that change nothing in the model the page refines. */
const LISTING_ONLY = new Set(["L.S.", "CGLS", "ACTA", "LIST", "BOND", "CONF", "MPLA", "RTAB", "HTAB", "FMAP", "GRID", "PLAN", "WPDB", "MOLE", "SIZE", "TIME", "MORE", "DAMP", "STIR", "BLOC", "EQIV", "FREE", "BIND", "CONN", "ZERR", "UNIT", "DISP", "MERG", "HOPE", "SPEC"]);

/** Whether the text is a SHELX instruction file: TITL or CELL, SFAC and atoms in SHELX's form. */
export function looksLikeShelxIns(text: string): boolean {
  const head = text.split(/\r?\n/).slice(0, 200).map((l) => l.trim().toUpperCase());
  return head.some((l) => l.startsWith("CELL ")) && head.some((l) => l.startsWith("SFAC ")) && head.some((l) => l.startsWith("LATT ") || l.startsWith("SYMM ") || l.startsWith("TITL"));
}

/** A SHELX decimal fraction as the twelfth it is (".3333333" → 1/3), for the symmetry parser. */
function fractionText(v: number): string {
  const twelfths = Math.round(v * 12);
  if (Math.abs(v * 12 - twelfths) > 1e-3) return String(v);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.abs(twelfths), 12) || 1;
  return `${twelfths / g}/${12 / g}`;
}

/** A SYMM line's operation, its decimal translations made fractions. */
function symmOperation(text: string): SymmetryOperation {
  const xyz = text
    .toLowerCase()
    .split(",")
    .map((part) => part.replace(/(^|[^\d.])(\d*\.\d+|\d+\.\d*)/g, (_m, pre: string, num: string) => `${pre}${fractionText(Number(num))}`))
    .join(",");
  return parseSymmetryOperation(xyz);
}

const CENTRING: Record<number, Vec3[]> = {
  1: [],
  2: [[0.5, 0.5, 0.5]],
  3: [[2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]],
  4: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
  5: [[0, 0.5, 0.5]],
  6: [[0.5, 0, 0.5]],
  7: [[0.5, 0.5, 0]],
};

const IDENTITY: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** The value an atom parameter stands for, its free-variable code resolved. */
export function shelxValue(x: number, fv: readonly number[]): { value: number; variable?: number } {
  if (Math.abs(x) < 5) return { value: x };
  const m = Math.round(Math.abs(x) / 10);
  const p = x - Math.sign(x) * 10 * m;
  if (m <= 1) return { value: p };
  const f = fv[m - 1];
  if (f === undefined) throw new Error(`free variable ${m} is referenced (${x}) but FVAR gives only ${fv.length}`);
  return { value: x > 0 ? p * f : p * (f - 1), variable: m };
}

/** "CS" → "Cs": an element symbol as written in SFAC, in its proper case. */
function elementOf(symbol: string): string {
  const e = elementFromLetters(symbol);
  if (!e) throw new Error(`SFAC names no element: "${symbol}"`);
  return e;
}

/** An atom's label with its element part in the element's case, as SHELXL's CIF writes it ("CS1" → "Cs1"). */
function labelOf(name: string, element: string): string {
  return name.toUpperCase().startsWith(element.toUpperCase()) ? element + name.slice(element.length) : name;
}

/** Read a SHELX .ins or .res. Throws on a file it cannot make a structure of. */
export function parseShelxIns(text: string, id = "shelx"): ShelxModel {
  // Logical lines: comments out, continuations ("=" at the end) joined, nothing after END.
  const raw = text.split(/\r?\n/);
  const lines: string[] = [];
  let carry = "";
  for (const line of raw) {
    const body = line.replace(/!.*$/, "").trimEnd();
    const keyword = body.trim().slice(0, 4).toUpperCase();
    if (!carry && (keyword === "REM" || keyword === "REM ")) continue;
    if (!carry && /^END\b/i.test(body.trim())) break;
    const joined = `${carry} ${body}`.trim();
    if (/=\s*$/.test(joined)) {
      carry = joined.replace(/=\s*$/, "");
      continue;
    }
    carry = "";
    if (joined) lines.push(joined);
  }

  let title = "";
  let wavelength: number | undefined;
  let cell: StructureModel["cell"] | undefined;
  let latt = 1;
  const symm: SymmetryOperation[] = [];
  const sfac: string[] = [];
  let fv: number[] = [];
  let temperature: number | undefined;
  let twin: ShelxInstructions["twin"];
  let basf: number[] = [];
  let exti: number | undefined;
  let weighting: ShelxInstructions["weighting"];
  let hklf: number | undefined;
  const notCarried = new Set<string>();
  // Atom lines wait for FVAR, which may come after them only in odd files: read them once the header is known.
  const atomLines: { tokens: string[]; afix: number; part: number }[] = [];
  let afix = 0;
  let part = 0;

  for (const line of lines) {
    const tokens = line.split(/\s+/);
    const keyword = tokens[0]!.toUpperCase();
    const nums = (from = 1): number[] => tokens.slice(from).map(Number).filter((n) => Number.isFinite(n));
    if (!KEYWORDS.has(keyword.slice(0, 4)) || (keyword.length > 4 && keyword !== "L.S.")) {
      if (tokens.length >= 5 && /^\d+$/.test(tokens[1]!)) atomLines.push({ tokens, afix, part });
      continue;
    }
    switch (keyword.slice(0, 4)) {
      case "TITL":
        title = line.slice(4).trim();
        break;
      case "CELL": {
        const [l, a, b, c, al, be, ga] = nums();
        if (c === undefined || ga === undefined || be === undefined || al === undefined || a === undefined || b === undefined || l === undefined) throw new Error("CELL needs λ a b c α β γ");
        wavelength = l;
        cell = { a, b, c, alpha: al, beta: be, gamma: ga };
        break;
      }
      case "LATT":
        latt = nums()[0] ?? 1;
        break;
      case "SYMM":
        symm.push(symmOperation(line.slice(4).trim()));
        break;
      case "SFAC": {
        // The short form names elements; the long form gives one element and its coefficients.
        const rest = tokens.slice(1);
        if (rest.length > 1 && rest.slice(1).every((t) => Number.isFinite(Number(t)))) sfac.push(elementOf(rest[0]!));
        else for (const t of rest) sfac.push(elementOf(t));
        break;
      }
      case "FVAR":
        fv = [...fv, ...nums()];
        break;
      case "TEMP": {
        const t = nums()[0];
        if (t !== undefined) temperature = t + 273.15;
        break;
      }
      case "TWIN": {
        const v = nums();
        const m = v.length >= 9 ? v.slice(0, 9) : [-1, 0, 0, 0, -1, 0, 0, 0, -1];
        // SHELXL multiplies the indices as a row vector, (h k l)·M: as a column, h′ = Mᵀ·h.
        const matrix: Mat3 = [[m[0]!, m[3]!, m[6]!], [m[1]!, m[4]!, m[7]!], [m[2]!, m[5]!, m[8]!]];
        twin = { matrix, domains: Math.abs(v[9] ?? 2) };
        break;
      }
      case "BASF":
        basf = [...basf, ...nums()];
        break;
      case "EXTI":
        exti = nums()[0] ?? 0;
        break;
      case "WGHT": {
        const [a, b] = nums();
        weighting = { a: a ?? 0.1, b: b ?? 0 };
        break;
      }
      case "HKLF":
        hklf = nums()[0];
        break;
      case "AFIX":
        afix = nums()[0] ?? 0;
        break;
      case "PART":
        part = nums()[0] ?? 0;
        break;
      default:
        if (!LISTING_ONLY.has(keyword) && keyword !== "ZERR") notCarried.add(keyword);
    }
  }
  if (!cell || wavelength === undefined) throw new Error("no CELL instruction: not a SHELX .ins/.res");
  if (sfac.length === 0) throw new Error("no SFAC instruction: the atoms' elements are unknown");

  // The group: the identity, SYMM, LATT's centring and (for LATT > 0) the inversion.
  const centring = CENTRING[Math.abs(latt)];
  if (!centring) throw new Error(`LATT ${latt} is not a SHELX lattice type`);
  const generators: SymmetryOperation[] = [
    { rotation: IDENTITY, translation: [0, 0, 0], xyz: "x,y,z" },
    ...symm,
    ...centring.map((t) => ({ rotation: IDENTITY, translation: t, xyz: `x+${fractionText(t[0])},y+${fractionText(t[1])},z+${fractionText(t[2])}` })),
    ...(latt > 0 ? [{ rotation: [[-1, 0, 0], [0, -1, 0], [0, 0, -1]] as Mat3, translation: [0, 0, 0] as Vec3, xyz: "-x,-y,-z" }] : []),
  ];
  const operations = expandGenerators(generators);
  const setting = settingForOperations(operations);
  const spaceGroup = setting ? spaceGroupFromSetting(setting) : { operations };

  const sites: AtomSite[] = [];
  const afixOf = new Map<string, number>();
  const ridingU = new Map<string, number>();
  const shared = new Map<number, { value: number; labels: string[] }>();
  let lastHeavy: AtomSite | undefined;
  for (const { tokens, afix: code, part: group } of atomLines) {
    const index = Number(tokens[1]);
    const element = sfac[index - 1];
    if (!element) throw new Error(`atom ${tokens[0]} names SFAC ${index}, and there are ${sfac.length}`);
    const values = tokens.slice(2).map(Number);
    if (values.length < 3 || values.slice(0, 3).some((v) => !Number.isFinite(v))) throw new Error(`atom ${tokens[0]}: x y z expected`);
    const label = labelOf(tokens[0]!, element);
    const position: Vec3 = [shelxValue(values[0]!, fv).value, shelxValue(values[1]!, fv).value, shelxValue(values[2]!, fv).value];
    const sof = shelxValue(values[3] ?? 11, fv).value;
    // The sof carries the site's symmetry: an atom on a twofold axis has 0.5 for a full site.
    const share = siteMultiplicity(operations, position) / operations.length;
    const occupancy = sof / share;
    const hydrogen = element === "H" || element === "D";
    let adp: AtomSite["adp"];
    if (values.length >= 10) {
      const u = values.slice(4, 10).map((v) => shelxValue(v, fv).value);
      // SHELX lists U11 U22 U33 U23 U13 U12; the model keeps U11 U22 U33 U12 U13 U23.
      adp = { kind: "anisotropic", uAniso: [u[0]!, u[1]!, u[2]!, u[5]!, u[4]!, u[3]!] };
    } else {
      const raw = values[4] ?? 0.05;
      let u: number;
      if (raw < -0.5 && raw > -5) {
        // Riding: |U| × U_eq of the previous atom that is not a hydrogen.
        if (!lastHeavy) throw new Error(`atom ${tokens[0]} rides (U ${raw}) on no previous atom`);
        u = -raw * (lastHeavy.adp.kind === "anisotropic" ? uEquivalent(lastHeavy.adp.uAniso, cell) : lastHeavy.adp.bIso / EIGHT_PI_SQUARED);
        ridingU.set(label, -raw);
      } else {
        const v = shelxValue(raw, fv);
        u = v.value;
        if (v.variable !== undefined && hydrogen) {
          const g = shared.get(v.variable) ?? { value: fv[v.variable - 1]!, labels: [] };
          g.labels.push(label);
          shared.set(v.variable, g);
        }
      }
      adp = { kind: "isotropic", bIso: EIGHT_PI_SQUARED * u };
    }
    const site: AtomSite = {
      label,
      element,
      position,
      occupancy,
      adp,
      ...(group !== 0 ? { disorder: { assembly: "A", group } } : {}),
    };
    sites.push(site);
    afixOf.set(label, code);
    if (!hydrogen) lastHeavy = site;
  }
  if (sites.length === 0) throw new Error("no atoms in the file");

  const name = title.split(/\s+in\s+/i)[0]!.trim() || id;
  return {
    structure: { id, name, cell, spaceGroup, sites },
    instructions: {
      title,
      wavelength,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(twin ? { twin } : {}),
      basf,
      ...(exti !== undefined ? { exti } : {}),
      ...(weighting ? { weighting } : {}),
      freeVariables: fv,
      ...(hklf !== undefined ? { hklf } : {}),
      afix: afixOf,
      sharedU: [...shared].map(([variable, g]) => ({ variable, value: g.value, labels: g.labels })),
      ridingU,
      notCarried: [...notCarried],
    },
  };
}

const matrixText = (m: Mat3): string => `[${m.map((r) => `[${r.join(",")}]`).join(",")}]`;

/** The file's instructions in a few lines: what a SHELXL refinement of this model applied, for the page and the Agent to read. */
export function shelxNotes(ins: ShelxInstructions): string[] {
  const groups = new Map<number, number>();
  for (const code of ins.afix.values()) if (code > 0) groups.set(code, (groups.get(code) ?? 0) + 1);
  return [
    `CELL: λ ${ins.wavelength} Å (X-ray)${ins.temperature !== undefined ? `; TEMP ${Math.round(ins.temperature)} K` : "; no TEMP (SHELXL then takes 20 °C)"}`,
    ...(ins.twin ? [`TWIN: law h′ = R·h, R = ${matrixText(ins.twin.matrix)}, ${ins.twin.domains} domains${ins.basf.length ? `, BASF ${ins.basf.join(" ")}` : ""}`] : ins.basf.length ? [`BASF ${ins.basf.join(" ")}`] : []),
    ...(ins.exti !== undefined ? [`EXTI ${ins.exti}`] : []),
    ...(ins.weighting ? [`WGHT ${ins.weighting.a} ${ins.weighting.b}`] : []),
    ...(ins.freeVariables.length ? [`FVAR: OSF ${ins.freeVariables[0]}${ins.freeVariables.length > 1 ? `; free variables ${ins.freeVariables.slice(1).map((v, i) => `${i + 2} = ${v}`).join(", ")}` : ""}`] : []),
    ...[...groups].map(([code, n]) => `AFIX ${code}: ${n} atom${n === 1 ? "" : "s"}`),
    ...ins.sharedU.map((g) => `${g.labels.length} hydrogen${g.labels.length === 1 ? "" : "s"} (${g.labels.slice(0, 3).join(", ")}${g.labels.length > 3 ? ", …" : ""}) share one refined U_iso, free variable ${g.variable} = ${g.value}`),
    ...(ins.ridingU.size ? [`${ins.ridingU.size} hydrogen${ins.ridingU.size === 1 ? "" : "s"} with U_iso riding at ${[...new Set(ins.ridingU.values())].join(" or ")}·U_eq of the parent`] : []),
    ...(ins.notCarried.length ? [`Read and not applied: ${ins.notCarried.join(", ")}`] : []),
  ];
}
