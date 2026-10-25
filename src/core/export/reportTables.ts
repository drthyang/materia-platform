/**
 * The refined structure as the report tabulates it, in crystallographic
 * convention: the cell as its independent parameters only (a = b = 5.4196(5) Å,
 * c = …, V = …; no angle or length the symmetry fixes), and the atoms with a
 * standard uncertainty where a value was refined, an exact fraction where a
 * symmetry element fixes a coordinate, and the starting value (fewer digits,
 * no esd) where a free value was held. The distances: each cation's shell, or
 * a molecule's covalent bonds.
 *
 * Shared by reportHtml and reportMarkdown, so both say the same; pure.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import type { UnitCell } from "@/core/crystal/types";
import { buildEsdMap, cellEsdsOf, cellVolume, formatWithEsd } from "@/core/export/cif";
import { independentCellParameters } from "@/core/crystal/cellConstraints";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { assignWyckoff } from "@/core/crystal/wyckoff";
import { coordinationShells } from "@/core/crystal/geometry";
import { uEquivalent } from "@/core/crystal/adp";
import { settingForOperations } from "@/core/crystal/spaceGroups";
import { asFraction } from "@/core/export/reportTypeset";

const EIGHT_PI2 = 8 * Math.PI * Math.PI;

/** A refined phase as the tables read it (report.ts ReportPhase). */
export interface TablePhase {
  readonly structure: StructureModel;
  readonly params: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
}

export type TableTechnique = "powder" | "singleCrystal" | "pdf";

const trimZeros = (s: string): string => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** The space group's International Tables number: as given, else from its operations. */
export function spaceGroupNumber(structure: StructureModel): number | undefined {
  const sg = structure.spaceGroup;
  if (sg.number !== undefined) return sg.number;
  try {
    return sg.operations.length > 0 ? settingForOperations(sg.operations)?.number : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// The cell

/** One term of the cell line: the symbols it gives (a and b when the symmetry holds them equal), its value with its esd, its unit. */
export interface CellTerm {
  readonly symbols: readonly string[];
  readonly value: string;
  readonly unit: "Å" | "°" | "Å³";
}

const CELL_SYMBOL: Record<keyof UnitCell, string> = { a: "a", b: "b", c: "c", alpha: "α", beta: "β", gamma: "γ" };

/**
 * The cell as its independent parameters (the metric the space-group
 * rotations leave free, cellConstraints.ts), each with the parameters the
 * symmetry ties to it, then the volume: hexagonal "a = b = 5.41964(5) Å,
 * c = 4.37366(7) Å, V = 111.254(3) Å³". The esds are the refinement's, else
 * the structure file's (cellEsdsOf).
 */
export function cellTerms(phase: TablePhase): CellTerm[] {
  const st = phase.structure;
  const e = cellEsdsOf(st, buildEsdMap(phase.params, phase.bindings));
  const terms: CellTerm[] = independentCellParameters(st).map((spec) => {
    const lead = spec.targets[0]!;
    const length = spec.kind === "cellLength";
    return {
      symbols: spec.targets.map((t) => CELL_SYMBOL[t]),
      value: formatWithEsd(st.cell[lead], e.cell[lead], length ? 5 : 4),
      unit: length ? "Å" : "°",
    };
  });
  const v = cellVolume(st.cell);
  terms.push({ symbols: ["V"], value: e.volume !== undefined ? formatWithEsd(v, e.volume, 3) : v.toFixed(3), unit: "Å³" });
  return terms;
}

/** The cell line in plain text: "a = b = 5.41964(5) Å, c = 4.37366(7) Å, V = 111.254(3) Å³". */
export function cellLineText(terms: readonly CellTerm[]): string {
  return terms.map((t) => `${t.symbols.join(" = ")} = ${t.value}${t.unit === "°" ? "°" : ` ${t.unit}`}`).join(", ");
}

// ---------------------------------------------------------------------------
// The atoms

/**
 * The displacement column: B_iso, or B_eq for an anisotropic site (Å²), on a
 * powder or a PDF; on a single crystal U_iso and U_eq (Å²), SHELXL's and the
 * CIF's convention, U_eq's esd from its tensor modes' taken as independent.
 * U_eq by the full formula (a third of the trace only in an orthogonal cell).
 */
export function displacementColumn(phase: TablePhase, technique: TableTechnique): { readonly symbol: "B" | "U"; readonly sub: "eq" | "iso"; readonly value: (site: StructureModel["sites"][number]) => string } {
  const st = phase.structure;
  const esd = buildEsdMap(phase.params, phase.bindings);
  const sub = st.sites.some((s) => s.adp.kind === "anisotropic") ? "eq" : "iso";
  if (technique !== "singleCrystal") {
    return {
      symbol: "B", sub,
      value: (s) => formatWithEsd(s.adp.kind === "isotropic" ? s.adp.bIso : EIGHT_PI2 * uEquivalent(s.adp.uAniso, st.cell), s.adp.kind === "isotropic" ? esd.bIso.get(s.label) : undefined, 3),
    };
  }
  const byId = new Map(phase.params.map((p) => [p.id, p]));
  const variance = new Map<string, number>();
  for (const b of phase.bindings) {
    const p = byId.get(b.parameterId);
    if (b.kind !== "uAniso" || !b.targetKey || !b.uBasis || !p || (p.fixed && !p.expression) || !(p.esd !== undefined && p.esd > 0)) continue;
    variance.set(b.targetKey, (variance.get(b.targetKey) ?? 0) + (uEquivalent(b.uBasis as Parameters<typeof uEquivalent>[0], st.cell) * p.esd) ** 2);
  }
  return {
    symbol: "U", sub,
    value: (s) => {
      if (s.adp.kind === "isotropic") {
        const e = esd.bIso.get(s.label);
        return formatWithEsd(s.adp.bIso / EIGHT_PI2, e !== undefined ? e / EIGHT_PI2 : undefined, 5);
      }
      const v = variance.get(s.label);
      return formatWithEsd(uEquivalent(s.adp.uAniso, st.cell), v !== undefined && v > 0 ? Math.sqrt(v) : undefined, 5);
    },
  };
}

export interface AtomRow {
  readonly label: string;
  /** The atom type, when the label does not say it (a mixed or relabelled site). */
  readonly type: string;
  /** Wyckoff position ("6h"), for the built-in groups. */
  readonly wyckoff: string | null;
  readonly x: string;
  readonly y: string;
  readonly z: string;
  readonly occupancy: string;
  readonly adp: string;
  /** "aniso" for an anisotropic site, beside U_eq. */
  readonly adpKind: "iso" | "aniso";
}

export interface AtomTable {
  readonly rows: readonly AtomRow[];
  readonly adp: { readonly symbol: "B" | "U"; readonly sub: "eq" | "iso" };
  /** Show the Wyckoff column: some site has a tabulated position. */
  readonly wyckoff: boolean;
  /** Show the type column: some label does not begin with its element. */
  readonly type: boolean;
  /** Some site is anisotropic: the ADP kind is marked. */
  readonly aniso: boolean;
  /** Some coordinate is fixed by symmetry (printed as a fraction). */
  readonly symmetryFixed: boolean;
  /** Some free value was held (printed without an esd). */
  readonly held: boolean;
}

function ionLabel(element: string, oxidation: number | undefined): string {
  if (oxidation === undefined || oxidation === 0) return element;
  const sup = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const n = Math.abs(oxidation);
  const digits = n === 1 ? "" : String(n).split("").map((c) => sup[Number(c)]!).join("");
  return `${element}${digits}${oxidation > 0 ? "⁺" : "⁻"}`;
}

/**
 * The atom table of a phase. A coordinate with an esd was refined
 * (formatWithEsd, IUCr); one the site symmetry fixes is the fraction it is
 * (1/4, 2/3); a free one held at its starting value has four decimals and no
 * esd. An occupancy or a displacement parameter without an esd was held.
 */
export function atomTable(phase: TablePhase, technique: TableTechnique): AtomTable {
  const st = phase.structure;
  const esd = buildEsdMap(phase.params, phase.bindings);
  const adp = displacementColumn(phase, technique);
  const ops = st.spaceGroup.operations;
  let symmetryFixed = false;
  let held = false;
  const rows = st.sites.map((s): AtomRow => {
    const pe = esd.pos.get(s.label);
    const basis = ops.length > 0 ? allowedPositionShifts(ops, s.position).basis : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const coordinate = (i: 0 | 1 | 2): string => {
      const v = s.position[i];
      const e = pe?.[i];
      if (e !== undefined && e > 0) return formatWithEsd(v, e, 5);
      if (basis.every((b) => Math.abs(b[i]!) < 1e-9)) {
        symmetryFixed = true;
        return asFraction(v) ?? trimZeros(v.toFixed(5));
      }
      held = true;
      return v.toFixed(4);
    };
    const occE = esd.occ.get(s.label);
    if (occE === undefined) held = true;
    const adpText = adp.value(s);
    if (!adpText.includes("(")) held = true;
    return {
      label: s.label,
      type: ionLabel(s.element, s.oxidationState),
      wyckoff: (() => {
        try {
          return assignWyckoff(st.spaceGroup, s.position)?.label ?? null;
        } catch {
          return null;
        }
      })(),
      x: coordinate(0),
      y: coordinate(1),
      z: coordinate(2),
      occupancy: occE !== undefined ? formatWithEsd(s.occupancy, occE, 4) : trimZeros(s.occupancy.toFixed(4)),
      adp: adpText,
      adpKind: s.adp.kind === "isotropic" ? "iso" : "aniso",
    };
  });
  return {
    rows,
    adp: { symbol: adp.symbol, sub: adp.sub },
    wyckoff: rows.some((r) => r.wyckoff !== null),
    type: st.sites.some((s) => !s.label.toLowerCase().startsWith(s.element.toLowerCase())),
    aniso: st.sites.some((s) => s.adp.kind === "anisotropic"),
    symmetryFixed,
    held,
  };
}

/** What the atom table's values without an esd are, said once under it. */
export function atomTableNote(t: AtomTable): string {
  const parts = [
    "Numbers in parentheses are standard uncertainties in the last digits.",
    ...(t.symmetryFixed ? ["Fractions are coordinates fixed by the site symmetry."] : []),
    ...(t.held ? ["A value without one was held at its starting value, not refined."] : []),
  ];
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Distances

export interface ShellTable {
  readonly site: string;
  readonly bonds: readonly { readonly to: string; readonly distance: string; readonly count: number }[];
  readonly mean: string;
}

/** Each cation's coordination shell (geometry.ts coordinationShells): the neighbours by length, with their multiplicity and the mean. */
export function shellTables(structure: StructureModel): ShellTable[] {
  return coordinationShells(structure).map((sh) => ({
    site: sh.site,
    bonds: sh.bonds.map((b) => ({ to: b.to, distance: b.distance.toFixed(4), count: b.count })),
    mean: sh.mean.toFixed(4),
  }));
}

/** What the shell tables' lengths are, said once. */
export const SHELL_NOTE = "Distances at the refined positions: each cation's shell out to 3.2 Å, or 1.25 × its shortest bond for a large cation. No esds: the covariance is not carried to the lengths.";
