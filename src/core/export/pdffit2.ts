/**
 * The PDFfit2 side of the PDF cross-check export: a real-space G(r)
 * refinement mapped onto the PDFfit2 engine (diffpy.pdffit2, the calculator
 * inside PDFgui and diffpy-CMI's small-box fits), as a structure file every
 * PDFfit2 reader takes (`.stru`, the PDFfit format) and the constraints that
 * refine exactly the parameters MATERIA refined. Pure: the model and strings;
 * the bundle (pdfBundle.ts) packs them.
 *
 * MATERIA's model is PDFfit2's in all but one convention (below), so the
 * quantities carry over one to one. Each mapping, checked against the PDFfit2
 * 1.6 source (libpdffit2/pdf.cc, metric.cc, stru.cc) and, on the GaTa4Se8
 * demo, by running the exported bundle in PDFfit2 1.6.0:
 *
 *   MATERIA                          PDFfit2
 *   ───────────────────────────────  ──────────────────────────────────────────
 *   PDF scale (one per phase)        pscale of the phase; dscale = 1. PDFfit2's
 *                                    total is dscale·Σ pscale·G_p, MATERIA's
 *                                    Σ scale_p·G_p.
 *   G(r) = (1/N) Σ b_i b_j/⟨b⟩² ·    the same sum and normalization: weights
 *     (1/r_ij)·𝒩(r; r_ij, σ_ij)      b/⟨b⟩, ⟨b⟩ = Σ occ·b/Σ occ, ρ₀ = Σ occ/V —
 *     − 4πρ₀r                        but (1/r)·Σ 𝒩, a Gaussian in R(r)
 *                                    (pdf.cc: calc = ppp/np/r), where MATERIA
 *                                    has 1/r_ij inside the sum (the G of an
 *                                    isotropic 3D Gaussian pair, its mirror
 *                                    term aside). THE ONE DIFFERENCE, and no
 *                                    setting reconciles it: PDFfit2's peaks lean
 *                                    toward low r by about σ²/r_ij. On the demo:
 *                                    1.2 % of the rms G(r), largest at low r,
 *                                    and the refined cell 75 ppm (3 esds) larger
 *                                    in PDFfit2; with 1/r in MATERIA's model the
 *                                    two curves agree to 1e-6 of G.
 *   b: neutron coherent length (fm,  set per element with set_scat (the
 *     NIST/Sears), X-ray f(0) from   script) — PDFfit2's own tables differ in
 *     Cromer–Mann (≈ Z)              the last digits (Mn −3.750 vs −3.73 fm;
 *                                    X-ray Z exactly).
 *   B_iso (Å²), U_cart = B/8π² · I   no isotropic switch: the six U^ij of the
 *                                    same tensor, U11 = U22 = U33 = U_iso,
 *                                    U12 = U_iso·cos γ*, U13 = U_iso·cos β*,
 *                                    U23 = U_iso·cos α*, all tied to one
 *                                    parameter @n = U_iso = B/8π² (a refined
 *                                    angle enters as cos(x·π/180), which both
 *                                    PDFfit2's parser and PDFgui's take). U12 = 0
 *                                    on a hexagonal cell would be anisotropic.
 *   U^ij (CIF convention, Å²),        u11 … u23 of every atom, the same
 *     image U′ = R·U·Rᵀ               convention (msd = Σ U^ij a*_i a*_j
 *                                    (a_i·n̂)(a_j·n̂), metric.cc msdAtoms).
 *   σ_ij² = σ′²(1 − δ1/r − δ2/r²     the same (pdf.cc NEW_SHARP). One edge:
 *     + Qbroad²r²), σ′² = n̂ᵀ(U_i +     where the bracket is ≤ 0 PDFfit2 drops
 *     U_j)n̂                          the pair, MATERIA keeps it unsharpened.
 *   sratio below rcut                the same (σ·sratio for r < rcut).
 *   Qdamp: × exp(−(r·Qdamp)²/2)      the same (dataset qdamp).
 *   Qbroad (in σ above)              the same (dataset qbroad).
 *   spherical particle Ø             spdiameter, the same envelope
 *     1 − 3x/2 + x³/2, x = r/Ø        (ShapeFactors.h).
 *   Qmax termination: exact sinc     zeroes the Fourier components above Qmax
 *     convolution on the data grid,  of the curve over the fit range extended
 *     6·2π/Qmax margin, odd image    by 6·2π/Qmax (an FFT, no odd image). Not
 *     at r → 0; skipped at/above     the same algorithm: on the demo a ripple of
 *     the grid's Nyquist π/Δr        0.07 % of the rms G(r) at the cutoff, which
 *                                    moves no peak. Qmax 0 (no termination)
 *                                    where MATERIA applies none.
 *   uniform weights over the window  2-column data, so wic = 1 (a dG column
 *                                    would weight by 1/dG²).
 *   Rw = √(Σ(G_o − G_c)²/Σ G_o²)     the same (fit.cc).
 *   esd = √(cov·χ²/(N − P))          √cov only, unscaled with unit weights:
 *                                    × √χ²_red to compare (the script does).
 *   the fit window [rmin, rmax]      pdfrange on the same grid points.
 *   positions as symmetry-adapted    x, y, z of every atom of the cell as an
 *     shifts (or mode amplitudes)    affine formula in the same shifts
 *                                    (R·axis per image), so the orbit moves as
 *                                    in MATERIA (PDFgui's symmetry
 *                                    constraints do the same with coordinates).
 *   ties (a shared site's last       occupancy formulas (1 − @a − @b …)
 *     occupancy, user ties)
 *
 * PDFfit2 has no equivalent, and the exporter says so (notes): restraints,
 * the magnetic (mPDF) term, a riding hydrogen's geometry, complex (absorbing)
 * neutron lengths, two isotopes of one element in a phase.
 */

import type { StructureModel, UnitCell } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import type { LinearRestraint, ParameterBinding, ParameterKind, RefinementParameter } from "@/core/refinement/types";
import type { SymmetryOperation } from "@/core/crystal/types";
import { applyParameters } from "@/core/workflow/apply";
import { resolveTies, parseTie } from "@/core/refinement/constraints";
import { pdfPhaseBindingsFor } from "@/core/workflow/pdf";
import { distinctSiteOps } from "@/core/diffraction/structureFactor";
import { applyOperation } from "@/core/crystal/symmetry";
import { EIGHT_PI_SQUARED, rotateUAniso } from "@/core/crystal/adp";
import { speciesAmplitude } from "@/core/totalscattering/weights";
import { enumeratePairs } from "@/core/pdf/pairEnumerator";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { terminationActive, uniformStep } from "@/core/pdf/termination";
import { windowFor } from "@/core/workflow/pdf";

// ---------------------------------------------------------------------------
// The model as PDFfit2 takes it

/** A phase as the fit builds it: before the parameters are applied (its bindings move it). */
export interface PdffitPhaseInput {
  readonly structure: StructureModel;
  /** The phase's binding target id (its structure id). */
  readonly id: string;
}

export interface PdffitExportInput {
  /** Every phase as fitted (primary first): the structures the bindings act on. */
  readonly phases: readonly PdffitPhaseInput[];
  /** The parameters, at MATERIA's values (with `esd` when the last refinement describes them). */
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  readonly restraints?: readonly LinearRestraint[];
  readonly pattern: PdfPattern;
  /** The fit window (Å). */
  readonly fitRange: { readonly min: number; readonly max: number };
}

/** One refinable PDFfit2 parameter @index: a parameter MATERIA refined, in PDFfit2's units. */
export interface PdffitParameter {
  readonly index: number;
  /** MATERIA's parameter id and label. */
  readonly id: string;
  readonly label: string;
  readonly kind: ParameterKind;
  /** The value in PDFfit2's units (U_iso = B/8π² for an isotropic ADP, else MATERIA's own). */
  readonly value: number;
  /** MATERIA's esd in the same units, when the last refinement describes the values. */
  readonly esd?: number;
  /** MATERIA's value = factor × the PDFfit2 value (8π² for B, else 1). */
  readonly factor: number;
  /** The PDFfit2 variable(s) it moves, in short ("pscale", "lat(1,2,3)", "Uiso", "xyz"). */
  readonly variable: string;
  /** What the parameter is on the PDFfit2 side, in a few words. */
  readonly meaning: string;
}

/** A PDFfit2 variable ("x(3)", "lat(1)", "pscale", "qdamp") and its formula in the @ parameters. */
export interface PdffitConstraint {
  readonly variable: string;
  readonly formula: string;
}

/** One atom of the cell, as the `.stru` lists it. */
export interface PdffitAtom {
  /** PDFfit2's element symbol (capitalized in the file). */
  readonly element: string;
  readonly xyz: readonly [number, number, number];
  readonly occupancy: number;
  /** U11, U22, U33, U12, U13, U23 (Å², CIF convention). */
  readonly u: readonly [number, number, number, number, number, number];
  /** The site it images, and which image (1 = the generator). */
  readonly site: string;
  readonly image: number;
}

export interface PdffitPhase {
  readonly name: string;
  /** The space group as the `.stru`'s `spcgr` line writes it (no spaces, no setting suffix). */
  readonly spaceGroup: string;
  /** The setting suffix dropped from `spaceGroup` (":2", ":H"), for the README. */
  readonly settingSuffix?: string;
  readonly cell: UnitCell;
  readonly atoms: readonly PdffitAtom[];
  /** The phase variables at MATERIA's values. */
  readonly pscale: number;
  readonly delta1: number;
  readonly delta2: number;
  readonly sratio: number;
  readonly rcut: number;
  readonly spdiameter: number;
  readonly constraints: readonly PdffitConstraint[];
  /** MATERIA's scattering amplitude per element (fm for neutrons, electrons for X-rays), for set_scat. */
  readonly scattering: Readonly<Record<string, number>>;
  /** Each site's generator atom (1-based index in `atoms`), for comparing refined coordinates. */
  readonly sites: readonly { readonly label: string; readonly atom: number; readonly xyz: readonly [number, number, number]; readonly refined: boolean }[];
}

export interface PdffitModel {
  readonly stype: "X" | "N";
  /** Qmax for read_data: 0 where MATERIA applies no termination. */
  readonly qmax: number;
  /** The data's own Qmax, when MATERIA's grid made the termination inactive (for the README). */
  readonly qmaxIgnored?: number;
  readonly qdamp: number;
  readonly qbroad: number;
  /** The dataset constraints (qdamp, qbroad). */
  readonly datasetConstraints: readonly PdffitConstraint[];
  /** The fit window as data grid points (pdfrange), and their count. */
  readonly rmin: number;
  readonly rmax: number;
  readonly points: number;
  readonly parameters: readonly PdffitParameter[];
  readonly phases: readonly PdffitPhase[];
  /** What PDFfit2 cannot carry, one sentence each. */
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// Affine forms in MATERIA's free parameters

/** c + Σ coef·v_id, v the MATERIA parameter values (each free id once). */
interface Affine {
  readonly c: number;
  readonly terms: ReadonlyMap<string, number>;
}

const constant = (c: number): Affine => ({ c, terms: new Map() });

function combine(parts: readonly (readonly [Affine, number])[], c0 = 0): Affine {
  let c = c0;
  const terms = new Map<string, number>();
  for (const [a, f] of parts) {
    if (f === 0) continue;
    c += f * a.c;
    for (const [id, k] of a.terms) terms.set(id, (terms.get(id) ?? 0) + f * k);
  }
  for (const [id, k] of terms) if (k === 0) terms.delete(id);
  return { c, terms };
}

const isConstant = (a: Affine): boolean => a.terms.size === 0;

function evaluate(a: Affine, values: Readonly<Record<string, number>>): number {
  let v = a.c;
  for (const [id, k] of a.terms) v += k * (values[id] ?? 0);
  return v;
}

/** MATERIA value = factor × the PDFfit2 value: B = 8π²·U_iso. */
const unitFactor = (kind: ParameterKind): number => (kind === "bIso" ? EIGHT_PI_SQUARED : 1);

/** The kinds that act on a phase's structure, its PDF terms, or the dataset. */
const STRUCTURE_KINDS = new Set<ParameterKind>(["cellLength", "cellAngle", "atomX", "atomY", "atomZ", "positionShift", "occupancy", "bIso", "uAniso"]);
const PHASE_KINDS = new Set<ParameterKind>(["pdfScale", "delta1", "delta2", "sratio", "rcut", "spdiameter"]);
const MAGNETIC_KINDS = new Set<ParameterKind>(["momentX", "momentY", "momentZ", "momentMode", "propagationK", "mpdfOrdScale", "mpdfParaScale", "mpdfPsigma", "corrLength", "magneticScale"]);

// ---------------------------------------------------------------------------
// Numbers as PDFfit2's formula parser and Python read them

/** A number for a formula or a file: 15 significant digits, no trailing noise ("0.4", not "0.39999999999999997"). */
export function pdffitNumber(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`PDFfit2 export: a non-finite number (${x})`);
  if (Math.abs(x) < 1e-300) return "0";
  return String(Number(x.toPrecision(15)));
}

const COEFFICIENT_FLOOR = 1e-14;

/** π/180, as a formula's number. */
const DEG = pdffitNumber(Math.PI / 180);

/**
 * An affine form as a PDFfit2 formula: "0.25+@3-0.5*@4". PDFfit2's parser
 * (libpdffit2/parser.cc) takes + − * / with the usual precedence, brackets,
 * numbers as C++ reads them (an exponent included) and @n for parameter n.
 */
function formulaOf(a: Affine, at: (id: string) => { readonly index: number; readonly factor: number }): string {
  const out: string[] = [];
  const c = Math.abs(a.c) < 1e-15 ? 0 : a.c;
  if (c !== 0) out.push(pdffitNumber(c));
  for (const [id, k] of a.terms) {
    const { index, factor } = at(id);
    const coef = k * factor;
    if (Math.abs(coef) < COEFFICIENT_FLOOR) continue;
    const mag = Math.abs(coef);
    const term = Math.abs(mag - 1) < 1e-13 ? `@${index}` : `${pdffitNumber(mag)}*@${index}`;
    out.push(out.length === 0 ? (coef < 0 ? `-${term}` : term) : `${coef < 0 ? "-" : "+"}${term}`);
  }
  return out.length === 0 ? "0" : out.join("");
}

// ---------------------------------------------------------------------------
// The mapping

/** PDFfit2's element symbol: the element of a typed label ("O2-" → "O"). */
export function pdffitElement(element: string): string {
  const m = /^([A-Z][a-z]?)/.exec(element.trim());
  return m ? m[1]! : element.trim();
}

/**
 * The `spcgr` symbol: Hermann–Mauguin without spaces or setting ("F -4 3 m"
 * → "F-43m"), a monoclinic full symbol as its short one ("P 1 21/c 1" →
 * "P21/c"): the forms diffpy.structure's table (PDFgui's) looks up. PDFfit2
 * itself reads one token and only keeps it for its own output.
 */
export function spcgrSymbol(structure: StructureModel): { symbol: string; suffix?: string } {
  const hm = structure.spaceGroup.hermannMauguin?.trim();
  if (!hm) return { symbol: "P1" };
  const [main, suffix] = hm.split(":");
  const parts = (main ?? hm).trim().split(/\s+/);
  const symbol = (parts.length === 4 && parts[1] === "1" && parts[3] === "1" ? `${parts[0]}${parts[2]}` : parts.join("")) || "P1";
  return suffix ? { symbol, suffix: `:${suffix}` } : { symbol };
}

const CELL_KEYS = ["a", "b", "c", "alpha", "beta", "gamma"] as const;

/** cos of the reciprocal angles from the direct ones (degrees). */
function reciprocalCosines(cell: UnitCell): { alpha: number; beta: number; gamma: number } {
  const r = Math.PI / 180;
  const [ca, cb, cg] = [Math.cos(cell.alpha * r), Math.cos(cell.beta * r), Math.cos(cell.gamma * r)];
  const [sa, sb, sg] = [Math.sin(cell.alpha * r), Math.sin(cell.beta * r), Math.sin(cell.gamma * r)];
  return { alpha: (cb * cg - ca) / (sb * sg), beta: (ca * cg - cb) / (sa * sg), gamma: (ca * cb - cg) / (sa * sb) };
}

/** U^ij of an isotropic U_cart = U_iso·I: U_iso·G*_ij/(a*_i a*_j), i.e. U_iso times 1, 1, 1, cos γ*, cos β*, cos α*. */
export function isotropicUij(uIso: number, cell: UnitCell): [number, number, number, number, number, number] {
  const c = reciprocalCosines(cell);
  const z = (x: number): number => (Math.abs(x) < 1e-15 ? 0 : x);
  return [uIso, uIso, uIso, z(uIso * c.gamma), z(uIso * c.beta), z(uIso * c.alpha)];
}

/** The six components of the image tensor R·U·Rᵀ as a linear map of U's six (rotateUAniso, one column per component). */
function rotationMap(r: SymmetryOperation["rotation"]): number[][] {
  const map: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (let m = 0; m < 6; m++) {
    const e: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
    e[m] = 1;
    const out = rotateUAniso(e, r);
    for (let k = 0; k < 6; k++) map[k]![m] = out[k]!;
  }
  return map;
}

/** The largest r (Å) at which 1 − δ1/r − δ2/r² + Qbroad²r² ≤ 0 (PDFfit2 drops such pairs; MATERIA keeps them unsharpened), 0 when none. */
function sharpeningCollapse(delta1: number, delta2: number, qbroad: number): number {
  const f = (r: number): number => 1 - delta1 / r - delta2 / (r * r) + qbroad * qbroad * r * r;
  if (f(10) <= 0) return 10;
  let lo = 1e-3;
  if (f(lo) > 0) return 0;
  let hi = 10;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return lo;
}

const fmt = (x: number, d = 4): string => String(Number(x.toFixed(d)));

/**
 * The refinement as PDFfit2 takes it: every phase's cell at MATERIA's values
 * (the full cell, each image of a site with its rotated U), the phase and
 * dataset variables, and a constraint for every PDFfit2 variable that moves
 * with a parameter MATERIA refined — the rest fixed at their values.
 */
export function pdffitModel(input: PdffitExportInput): PdffitModel {
  const { params, bindings, pattern, phases } = input;
  const notes: string[] = [];
  const byId = new Map(params.map((p) => [p.id, p]));
  const values: Record<string, number> = {};
  for (const p of params) values[p.id] = p.value;
  const resolved = resolveTies(params, values);
  const multi = phases.length > 1;

  // Each MATERIA parameter as an affine form in the free ones (ties followed).
  const memo = new Map<string, Affine>();
  const affineOf = (id: string, depth = 0): Affine => {
    const hit = memo.get(id);
    if (hit) return hit;
    const p = byId.get(id);
    if (!p) throw new Error(`PDFfit2 export: a binding names parameter "${id}", which is not in the list`);
    if (depth > 32) throw new Error(`PDFfit2 export: the ties of "${id}" form a cycle`);
    let a: Affine;
    if (p.expression) {
      const tie = parseTie(p.expression);
      if (tie.kind === "linear") a = combine([[affineOf(tie.refId, depth + 1), tie.factor]], tie.constant);
      else if (tie.kind === "sum") a = combine(tie.refIds.map((r) => [affineOf(r, depth + 1), tie.factor] as const), tie.constant);
      else {
        a = constant(resolved[id] ?? p.value);
        notes.push(`${p.label} follows a magnitude tie (${p.expression.trim()}), which is not linear: it is held at ${fmt(resolved[id] ?? p.value, 6)} in PDFfit2.`);
      }
    } else if (!p.fixed) {
      a = { c: 0, terms: new Map([[id, 1]]) };
    } else {
      a = constant(p.value);
    }
    memo.set(id, a);
    return a;
  };

  // The dataset variables (shared by every phase).
  let qdamp: Affine = constant(0);
  let qbroad: Affine = constant(0);
  for (const b of bindings) {
    if (b.kind === "qdamp") qdamp = affineOf(b.parameterId);
    if (b.kind === "qbroad") qbroad = affineOf(b.parameterId);
  }
  const magneticFree = params.filter((p) => !p.fixed && !p.expression && MAGNETIC_KINDS.has(p.kind));
  if (bindings.some((b) => MAGNETIC_KINDS.has(b.kind))) {
    notes.push(`The magnetic (mPDF) term is not carried: PDFfit2 computes the nuclear G(r) only. Its spin model goes to diffpy.mpdf${magneticFree.length ? ` (${magneticFree.length} free magnetic parameter${magneticFree.length === 1 ? "" : "s"} left out here)` : ""}; see the README.`);
  }

  interface PhaseDraft {
    readonly phase: PdffitPhase;
    readonly affines: readonly { readonly variable: string; readonly value: Affine; readonly isoFactor?: { readonly u: Affine; readonly component: 3 | 4 | 5 } }[];
  }
  const drafts: PhaseDraft[] = [];

  for (const ph of phases) {
    const own = multi ? pdfPhaseBindingsFor(bindings, ph.id) : bindings;
    const applied = applyParameters(ph.structure, own, resolved);
    const model = applied.model;
    const pdf = applied.pdf ?? { scale: 1, qdamp: 0, qbroad: 0, delta1: 0, delta2: 0, spdiameter: 0, sratio: 1, rcut: 0 };
    const label = ph.structure.name || ph.id;

    // The structure's own variables, as affine forms in binding order (apply.ts's semantics).
    const cellAff: Record<(typeof CELL_KEYS)[number], Affine> = {
      a: constant(ph.structure.cell.a), b: constant(ph.structure.cell.b), c: constant(ph.structure.cell.c),
      alpha: constant(ph.structure.cell.alpha), beta: constant(ph.structure.cell.beta), gamma: constant(ph.structure.cell.gamma),
    };
    const siteIndex = new Map(ph.structure.sites.map((s, i) => [s.label, i] as const));
    const posAff: Affine[][] = ph.structure.sites.map((s) => s.position.map((x) => constant(x)));
    const occAff: Affine[] = ph.structure.sites.map((s) => constant(s.occupancy));
    const bAff: (Affine | null)[] = ph.structure.sites.map((s) => (s.adp.kind === "isotropic" ? constant(s.adp.bIso) : null));
    const uAff: (Affine[] | null)[] = ph.structure.sites.map((s) => (s.adp.kind === "anisotropic" ? s.adp.uAniso.map((u) => constant(u)) : null));
    const uBound = new Set<number>();
    const phaseVar: Record<string, Affine> = {
      pscale: constant(1), delta1: constant(0), delta2: constant(0), sratio: constant(1), rcut: constant(0), spdiameter: constant(0),
    };
    const PHASE_VAR: Partial<Record<ParameterKind, string>> = { pdfScale: "pscale", delta1: "delta1", delta2: "delta2", sratio: "sratio", rcut: "rcut", spdiameter: "spdiameter" };
    for (const b of own) {
      if (PHASE_KINDS.has(b.kind)) {
        phaseVar[PHASE_VAR[b.kind]!] = affineOf(b.parameterId);
        continue;
      }
      if (!STRUCTURE_KINDS.has(b.kind)) continue;
      if (b.kind === "cellLength" || b.kind === "cellAngle") {
        if (b.targetKey && b.targetKey in cellAff) cellAff[b.targetKey as (typeof CELL_KEYS)[number]] = affineOf(b.parameterId);
        continue;
      }
      const si = b.targetKey !== undefined ? siteIndex.get(b.targetKey) : undefined;
      if (si === undefined) continue;
      const v = affineOf(b.parameterId);
      switch (b.kind) {
        case "atomX": case "atomY": case "atomZ":
          posAff[si]![b.kind === "atomX" ? 0 : b.kind === "atomY" ? 1 : 2] = v;
          break;
        case "positionShift":
          if (b.axis) for (let i = 0; i < 3; i++) posAff[si]![i] = combine([[posAff[si]![i]!, 1], [v, b.axis[i]!]]);
          break;
        case "occupancy":
          occAff[si] = v;
          break;
        case "bIso":
          if (bAff[si]) bAff[si] = v;
          break;
        case "uAniso":
          if (uAff[si] && b.uBasis) {
            // apply.ts sums a site's U modes from zero: the bound modes are the whole tensor.
            const start = uBound.has(si) ? uAff[si]! : uAff[si]!.map(() => constant(0));
            uBound.add(si);
            uAff[si] = start.map((u, k) => combine([[u, 1], [v, b.uBasis![k]!]]));
          }
          break;
      }
    }

    const ridingLabels = new Set((ph.structure.riding ?? []).map((rule) => rule.site));
    if (ridingLabels.size > 0) notes.push(`${label}: riding hydrogens follow their parents by geometry, which PDFfit2 cannot constrain; they are written at their refined positions and U_iso and held there.`);

    // Every image of every site, at MATERIA's values, with its variables' forms.
    const atoms: PdffitAtom[] = [];
    const affines: { variable: string; value: Affine; isoFactor?: { u: Affine; component: 3 | 4 | 5 } }[] = [];
    const sites: { label: string; atom: number; xyz: readonly [number, number, number]; refined: boolean }[] = [];
    const scattering: Record<string, number> = {};
    const isotopeOf = new Map<string, number | undefined>();
    const cellRefined = CELL_KEYS.slice(3).some((k) => !isConstant(cellAff[k]));
    model.sites.forEach((site, s) => {
      const element = pdffitElement(site.element);
      // MATERIA's amplitude for set_scat: the real part (PDFfit2 has no complex b).
      const amp = speciesAmplitude(site.element, pattern.scatteringType, site.isotope);
      if (amp.im !== 0) notes.push(`${label} ${site.label} (${site.element}): its neutron scattering length is complex (an absorbing nucleus); PDFfit2 takes the real part, ${fmt(amp.re, 4)} fm.`);
      if (isotopeOf.has(element) && isotopeOf.get(element) !== site.isotope) notes.push(`${label}: ${element} appears as two isotopes; PDFfit2 sets one scattering length per element and phase, so the script uses the last one.`);
      isotopeOf.set(element, site.isotope);
      scattering[element] = amp.re;
      const held = ridingLabels.has(site.label);
      const ops = distinctSiteOps(model.spaceGroup.operations, site.position);
      const refined = !held && posAff[s]!.some((a) => !isConstant(a));
      ops.forEach((op, image) => {
        const p = applyOperation(op, site.position);
        const wrap = p.map((x) => -Math.floor(x + 1e-9)) as [number, number, number];
        const xyz: [number, number, number] = [p[0]! + wrap[0], p[1]! + wrap[1], p[2]! + wrap[2]];
        const index = atoms.length + 1;
        let u: [number, number, number, number, number, number];
        if (site.adp.kind === "isotropic") u = isotropicUij(site.adp.bIso / EIGHT_PI_SQUARED, model.cell);
        else u = rotateUAniso(site.adp.uAniso, op.rotation);
        atoms.push({ element, xyz, occupancy: site.occupancy, u, site: site.label, image: image + 1 });
        if (image === 0) sites.push({ label: site.label, atom: index, xyz, refined });
        if (held) return;
        // x, y, z = R·p_s + t + n, with p_s the site's affine position.
        const R = op.rotation;
        for (let i = 0; i < 3; i++) {
          const form = combine([0, 1, 2].map((j) => [posAff[s]![j]!, R[i]![j]!] as const), op.translation[i]! + wrap[i]!);
          affines.push({ variable: `${"xyz"[i]}(${index})`, value: form });
        }
        const ufields = ["u11", "u22", "u33", "u12", "u13", "u23"] as const;
        if (site.adp.kind === "isotropic") {
          const uIso = combine([[bAff[s]!, 1 / EIGHT_PI_SQUARED]]);
          for (let k = 0; k < 3; k++) affines.push({ variable: `${ufields[k]}(${index})`, value: uIso });
          for (const k of [3, 4, 5] as const) {
            // An isotropic tensor's off-diagonal U^ij follow the reciprocal angles: with a refined angle, a formula in it.
            if (cellRefined) affines.push({ variable: `${ufields[k]}(${index})`, value: constant(u[k]), isoFactor: { u: uIso, component: k } });
            else affines.push({ variable: `${ufields[k]}(${index})`, value: combine([[uIso, isotropicUij(1, model.cell)[k]]]) });
          }
        } else {
          const map = rotationMap(op.rotation);
          const us = uAff[s]!;
          for (let k = 0; k < 6; k++) affines.push({ variable: `${ufields[k]}(${index})`, value: combine(us.map((a, m) => [a, map[k]![m]!] as const)) });
        }
        affines.push({ variable: `occ(${index})`, value: occAff[s]! });
      });
    });
    CELL_KEYS.forEach((k, i) => affines.push({ variable: `lat(${i + 1})`, value: cellAff[k] }));
    for (const v of ["pscale", "delta1", "delta2", "sratio", "rcut", "spdiameter"]) affines.push({ variable: v, value: phaseVar[v]! });

    // PDFfit2 drops a pair whose sharpening bracket is ≤ 0; MATERIA keeps it unsharpened.
    const collapse = sharpeningCollapse(pdf.delta1, pdf.delta2, pdf.qbroad);
    if (collapse > 0.5) {
      const close = enumeratePairs(model.cell, expandStructureAtoms(model), collapse);
      if (close.length > 0) {
        const shortest = Math.min(...close.map((c) => c.rij));
        notes.push(`${label}: with δ1 = ${fmt(pdf.delta1)} Å and δ2 = ${fmt(pdf.delta2)} Å² the peak-width bracket 1 − δ1/r − δ2/r² is ≤ 0 below ${fmt(collapse, 2)} Å, where ${close.length} pair${close.length === 1 ? "" : "s"} lie (shortest ${fmt(shortest, 3)} Å): PDFfit2 drops them, MATERIA keeps them unsharpened, so the two G(r) differ there.`);
      }
    }
    if (model.sites.some((st) => (st.adp.kind === "isotropic" ? st.adp.bIso <= 0 : false))) {
      notes.push(`${label}: a site has B_iso ≤ 0; PDFfit2 drops its pairs (zero width), MATERIA floors their width at 10⁻⁴ Å.`);
    }

    const sg = spcgrSymbol(model);
    drafts.push({
      phase: {
        name: label,
        spaceGroup: sg.symbol,
        ...(sg.suffix ? { settingSuffix: sg.suffix } : {}),
        cell: model.cell,
        atoms,
        pscale: pdf.scale,
        delta1: pdf.delta1,
        delta2: pdf.delta2,
        sratio: pdf.sratio,
        rcut: pdf.rcut,
        spdiameter: pdf.spdiameter,
        constraints: [],
        scattering,
        sites,
      },
      affines,
    });
  }

  // The @ parameters: MATERIA's free parameters that move a PDFfit2 variable, in MATERIA's order.
  const used = new Set<string>();
  const datasetAffines = [{ variable: "qdamp", value: qdamp }, { variable: "qbroad", value: qbroad }];
  for (const d of drafts) for (const a of d.affines) {
    for (const [id, k] of a.value.terms) if (Math.abs(k) > COEFFICIENT_FLOOR) used.add(id);
    if (a.isoFactor) for (const id of a.isoFactor.u.terms.keys()) used.add(id);
  }
  for (const a of datasetAffines) for (const id of a.value.terms.keys()) used.add(id);
  const parameters: PdffitParameter[] = [];
  const indexOf = new Map<string, { index: number; factor: number }>();
  for (const p of params) {
    if (p.fixed || p.expression || !used.has(p.id)) continue;
    const factor = unitFactor(p.kind);
    const index = parameters.length + 1;
    indexOf.set(p.id, { index, factor });
    parameters.push({
      index, id: p.id, label: p.label, kind: p.kind,
      value: p.value / factor,
      ...(p.esd !== undefined && Number.isFinite(p.esd) ? { esd: p.esd / factor } : {}),
      factor,
      variable: variableOf(p, bindings),
      meaning: meaningOf(p, bindings),
    });
  }
  const unmapped = params.filter((p) => !p.fixed && !p.expression && !used.has(p.id) && !MAGNETIC_KINDS.has(p.kind));
  if (unmapped.length > 0) notes.push(`Free in MATERIA but moving nothing PDFfit2 computes, so left out: ${unmapped.map((p) => p.label).join(", ")}.`);
  if ((input.restraints ?? []).length > 0) notes.push(`MATERIA's ${input.restraints!.length} restraint${input.restraints!.length === 1 ? "" : "s"} (${[...new Set(input.restraints!.map((r) => r.label || r.id))].slice(0, 3).join(", ")}${input.restraints!.length > 3 ? ", …" : ""}) are not carried: PDFfit2 has no restraints.`);

  const at = (id: string): { index: number; factor: number } => {
    const hit = indexOf.get(id);
    if (!hit) throw new Error(`PDFfit2 export: "${id}" has no @ index`);
    return hit;
  };
  // The reciprocal cosine of an isotropic off-diagonal, as a formula in the refined angles.
  const angleTerm = (cellForms: Record<string, Affine>, component: 3 | 4 | 5): string => {
    // An angle in radians: cos(x·π/180), not cosd — PDFgui checks and evaluates a formula with Python's math module, which has no cosd.
    const rad = (k: "alpha" | "beta" | "gamma"): string => (isConstant(cellForms[k]!) ? pdffitNumber((cellForms[k]!.c * Math.PI) / 180) : `(${formulaOf(cellForms[k]!, at)})*${DEG}`);
    const [A, B, G] = [rad("alpha"), rad("beta"), rad("gamma")];
    // U12 ↔ cos γ*, U13 ↔ cos β*, U23 ↔ cos α*.
    if (component === 3) return `((cos(${A})*cos(${B})-cos(${G}))/(sin(${A})*sin(${B})))`;
    if (component === 4) return `((cos(${A})*cos(${G})-cos(${B}))/(sin(${A})*sin(${G})))`;
    return `((cos(${B})*cos(${G})-cos(${A}))/(sin(${B})*sin(${G})))`;
  };

  const outPhases: PdffitPhase[] = drafts.map((d) => {
    const cellForms: Record<string, Affine> = {};
    CELL_KEYS.forEach((k, i) => { cellForms[k] = d.affines.find((a) => a.variable === `lat(${i + 1})`)!.value; });
    const constraints: PdffitConstraint[] = [];
    for (const a of d.affines) {
      if (a.isoFactor) {
        const u = a.isoFactor.u;
        const factor = angleTerm(cellForms, a.isoFactor.component);
        constraints.push({ variable: a.variable, formula: isConstant(u) ? `${pdffitNumber(u.c)}*${factor}` : `(${formulaOf(u, at)})*${factor}` });
        continue;
      }
      if (isConstant(a.value) || [...a.value.terms.values()].every((k) => Math.abs(k) <= COEFFICIENT_FLOOR)) continue;
      constraints.push({ variable: a.variable, formula: formulaOf(a.value, at) });
    }
    return { ...d.phase, constraints };
  });

  const datasetConstraints = datasetAffines.filter((a) => !isConstant(a.value)).map((a) => ({ variable: a.variable, formula: formulaOf(a.value, at) }));

  // The window on the data grid, and the termination MATERIA applies on it.
  const r = pattern.points.map((pt) => pt.r);
  const { i0, i1 } = windowFor(r, input.fitRange);
  if (i1 - i0 < 2) throw new Error("PDFfit2 export: the fit window holds fewer than two data points");
  const step = uniformStep(r.slice(i0, i1)) ?? 0;
  const qmaxData = pattern.qmax ?? 0;
  const terminate = qmaxData > 0 && step > 0 && terminationActive(qmaxData, step);
  if (uniformStep(r) === null) notes.push("The data's r grid is not uniform; PDFfit2 needs a uniform grid and will refuse the file.");

  return {
    stype: pattern.scatteringType === "neutron" ? "N" : "X",
    qmax: terminate ? qmaxData : 0,
    ...(!terminate && qmaxData > 0 ? { qmaxIgnored: qmaxData } : {}),
    qdamp: evaluate(qdamp, values),
    qbroad: evaluate(qbroad, values),
    datasetConstraints,
    rmin: r[i0]!,
    rmax: r[i1 - 1]!,
    points: i1 - i0,
    parameters,
    phases: outPhases,
    notes: [...new Set(notes)],
  };
}

/** The PDFfit2 variable a parameter moves, in short. */
function variableOf(p: RefinementParameter, bindings: readonly ParameterBinding[]): string {
  switch (p.kind) {
    case "pdfScale": return "pscale";
    case "cellLength":
    case "cellAngle": return `lat(${bindings.filter((b) => b.parameterId === p.id).map((b) => CELL_KEYS.indexOf(b.targetKey as (typeof CELL_KEYS)[number]) + 1).filter((i) => i > 0).join(",")})`;
    case "bIso": return "Uiso";
    case "uAniso": return "Uij";
    case "positionShift": return "xyz";
    case "atomX": return "x";
    case "atomY": return "y";
    case "atomZ": return "z";
    case "occupancy": return "occ";
    default: return p.kind;
  }
}

/** What a parameter is on the PDFfit2 side. */
function meaningOf(p: RefinementParameter, bindings: readonly ParameterBinding[]): string {
  const own = bindings.filter((b) => b.parameterId === p.id);
  switch (p.kind) {
    case "pdfScale": return "pscale (dscale = 1)";
    case "cellLength":
    case "cellAngle": return `lat(${own.map((b) => CELL_KEYS.indexOf(b.targetKey as (typeof CELL_KEYS)[number]) + 1).filter((i) => i > 0).join(", ")})`;
    case "bIso": return "U_iso = B/8π² (Å²)";
    case "uAniso": return "U^ij mode coefficient (Å²)";
    case "positionShift": {
      const axis = own[0]?.axis;
      return own.length > 1 ? `mode amplitude over ${own.length} sites` : axis ? `shift along (${axis.map((x) => fmt(x, 4)).join(", ")}), fractional` : "position shift";
    }
    case "atomX": case "atomY": case "atomZ": return "fractional coordinate";
    case "occupancy": return "occupancy";
    case "qdamp": return "qdamp (Å⁻¹)";
    case "qbroad": return "qbroad (Å⁻¹)";
    case "delta1": return "delta1 (Å)";
    case "delta2": return "delta2 (Å²)";
    case "sratio": return "sratio";
    case "rcut": return "rcut (Å)";
    case "spdiameter": return "spdiameter (Å)";
    default: return p.kind;
  }
}

// ---------------------------------------------------------------------------
// The .stru file

const f = (x: number, width: number, decimals: number): string => x.toFixed(decimals).padStart(width);

/**
 * A phase as a PDFfit-format structure file (`.stru`), the layout
 * diffpy.structure writes (parsers/p_pdffit.py) and PDFfit2 reads
 * (libpdffit2/stru.cc): the header (scale = pscale, sharp = δ2, δ1, sratio,
 * rcut, the space group, the particle shape, the cell, `ncell 1, 1, 1, N`),
 * then six lines per atom: element, x, y, z, occupancy; their esds; U11 U22
 * U33; their esds; U12 U13 U23; their esds. The whole cell, one line block
 * per atom (PDFfit2 applies no symmetry). Values carry two more decimals than
 * diffpy's own writer, which both readers take as they come.
 */
export function pdffitStru(phase: PdffitPhase): string {
  const c = phase.cell;
  const lines = [
    `title  ${phase.name}`.trim(),
    "format pdffit",
    `scale  ${f(phase.pscale, 11, 8)}`,
    `sharp  ${f(phase.delta2, 11, 8)}, ${f(phase.delta1, 11, 8)}, ${f(phase.sratio, 11, 8)}, ${f(phase.rcut, 11, 8)}`,
    `spcgr   ${phase.spaceGroup}`,
    ...(phase.spdiameter > 0 ? [`shape   sphere, ${pdffitNumber(phase.spdiameter)}`] : []),
    `cell   ${[c.a, c.b, c.c, c.alpha, c.beta, c.gamma].map((v) => f(v, 12, 8)).join(", ")}`,
    `dcell  ${[0, 0, 0, 0, 0, 0].map((v) => f(v, 12, 8)).join(", ")}`,
    `ncell  ${[1, 1, 1, phase.atoms.length].map((n) => String(n).padStart(9)).join(", ")}`,
    "atoms",
  ];
  for (const a of phase.atoms) {
    lines.push(
      `${a.element.toUpperCase().padEnd(4)} ${f(a.xyz[0], 19, 10)} ${f(a.xyz[1], 19, 10)} ${f(a.xyz[2], 19, 10)} ${f(a.occupancy, 14, 8)}`,
      `    ${f(0, 20, 10)} ${f(0, 19, 10)} ${f(0, 19, 10)} ${f(0, 14, 8)}`,
      `    ${f(a.u[0], 20, 10)} ${f(a.u[1], 19, 10)} ${f(a.u[2], 19, 10)}`,
      `    ${f(0, 20, 10)} ${f(0, 19, 10)} ${f(0, 19, 10)}`,
      `    ${f(a.u[3], 20, 10)} ${f(a.u[4], 19, 10)} ${f(a.u[5], 19, 10)}`,
      `    ${f(0, 20, 10)} ${f(0, 19, 10)} ${f(0, 19, 10)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
