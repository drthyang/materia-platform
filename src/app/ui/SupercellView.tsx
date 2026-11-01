/**
 * The Subgroups page's supercell bound (subgroup engine, Phase 2): the
 * supercell P inside which the cell-multiplying k-points enter (default 2×2×2
 * conventional; presets, or any integer or centred P). The page offers the
 * bound's stars as k-point chips and its subgroup lattice under "By subgroup"
 * (subgroupPicker.ts). Everything is computed on request; a large bound takes
 * seconds.
 */

import { useState } from "react";
import { DEFAULT_SUPERCELL, type SupercellCentring, type SupercellSpec } from "@/core/crystal/irreps/supercell";
import type { SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import { color, fz, mono, resetRangeBtn } from "@/app/theme";
import { InfoBadge } from "@/app/ui/InfoBadge";

export { childBasisNote } from "@/app/ui/subgroupPicker";

/** What Activate does on a cell-multiplying child (its title). */
export const SUPERCELL_ACTIVATE_NOTE = "Realise this child in its own cell (its standard setting, the Wyckoff orbits split) and refine it there: the G(r) is the supercell's, its positions are modes by parent irrep, and the irreps that lower the parent to it lead, free from a small starting kick.";

export const PRESETS: readonly { readonly label: string; readonly P: number[][] }[] = [
  { label: "2×2×2", P: DEFAULT_SUPERCELL.map((r) => [...r]) },
  { label: "2×1×1", P: [[2, 0, 0], [0, 1, 0], [0, 0, 1]] },
  { label: "1×1×2", P: [[1, 0, 0], [0, 1, 0], [0, 0, 2]] },
  { label: "√2×√2×1", P: [[1, -1, 0], [1, 1, 0], [0, 0, 1]] },
  { label: "√2×√2×2", P: [[1, -1, 0], [1, 1, 0], [0, 0, 2]] },
];

/** The default bound: 2×2×2 conventional, primitive. */
export const DEFAULT_BOUND: SupercellSpec = { P: PRESETS[0]!.P, centring: "P" };

/** "2 0 0; 0 2 0; 0 0 2" → rows of P (columns are the supercell's axes); null when malformed. */
export function parseSupercell(text: string): number[][] | null {
  const rows = text.split(/[;\n]/).map((r) => r.trim()).filter((r) => r !== "");
  if (rows.length !== 3) return null;
  const out = rows.map((r) => r.split(/[\s,]+/).filter((x) => x !== "").map((x) => {
    const [n, d] = x.split("/");
    return Number(n) / (d === undefined ? 1 : Number(d));
  }));
  return out.every((r) => r.length === 3 && r.every(Number.isFinite)) ? out : null;
}

export const formatMatrix = (P: readonly (readonly number[])[]): string => P.map((r) => r.map((x) => +x.toFixed(4)).join(" ")).join("; ");

/**
 * The lattice's summary: the classes, those with the supercell's lattice
 * (with Bilbao's SUBGROUPS count when enantiomorphs make it differ), and the
 * cell-multiplying ones.
 */
export function latticeSummary(lattice: SupercellLattice): string {
  const exact = lattice.classes.filter((c) => c.supercellLattice);
  const twice = exact.filter((c) => c.enantiomorph).length;
  const subgroups = twice > 0 ? ` (${exact.length + twice} in Bilbao's SUBGROUPS, enantiomorphs apart)` : "";
  return `${lattice.classes.length} classes · ${exact.length} with the supercell's lattice${subgroups} · ${lattice.classes.filter((c) => c.cellMultiplying).length} cell-multiplying`;
}

/** The bound's label: a preset's name, or the custom P. */
export function boundLabel(spec: SupercellSpec): string {
  const preset = PRESETS.find((p) => formatMatrix(p.P) === formatMatrix(spec.P));
  return preset && (spec.centring ?? "P") === "P" ? preset.label : `P = ${formatMatrix(spec.P)} (${spec.centring ?? "P"})`;
}

/**
 * The bound's control: a select of presets plus "custom P…", which opens the
 * P input and the centring with an Apply. Changing the bound recomputes the
 * chips.
 */
export function SupercellBound({ value, onChange, disabled = false }: { value: SupercellSpec; onChange: (spec: SupercellSpec) => void; disabled?: boolean }): JSX.Element {
  const presetIndex = (value.centring ?? "P") === "P" ? PRESETS.findIndex((p) => formatMatrix(p.P) === formatMatrix(value.P)) : -1;
  const [custom, setCustom] = useState<boolean>(presetIndex < 0);
  const [text, setText] = useState(formatMatrix(value.P));
  const [centring, setCentring] = useState<SupercellCentring>(value.centring ?? "P");
  const [error, setError] = useState<string | null>(null);
  const apply = (): void => {
    const P = parseSupercell(text);
    if (!P) {
      setError("P is three rows of three numbers, e.g. 2 0 0; 0 2 0; 0 0 2");
      return;
    }
    setError(null);
    onChange({ P, centring });
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: fz.micro, color: color.secondary }}>
        Supercell
        <select
          value={custom ? -1 : presetIndex}
          disabled={disabled}
          onChange={(e) => {
            const i = Number(e.target.value);
            if (i < 0) {
              setCustom(true);
              return;
            }
            setCustom(false);
            setError(null);
            setText(formatMatrix(PRESETS[i]!.P));
            onChange({ P: PRESETS[i]!.P, centring: "P" });
          }}
          style={{ fontSize: fz.micro }}
        >
          {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          <option value={-1}>custom P…</option>
        </select>
      </label>
      {custom && (
        <>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
            style={{ fontFamily: mono, fontSize: fz.micro, width: 140 }}
            aria-label="supercell matrix P, rows separated by ;"
            title="P as three rows (columns = the supercell's axes in the parent's conventional basis); fractions such as 1/2 are accepted for a centred parent"
          />
          <select value={centring} onChange={(e) => setCentring(e.target.value as SupercellCentring)} style={{ fontSize: fz.micro }} aria-label="centring of the supercell">
            {(["P", "I", "F", "C", "A", "B", "R"] as const).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button style={resetRangeBtn} disabled={disabled} onClick={apply}>Apply</button>
        </>
      )}
      <InfoBadge
        width={300}
        align="right"
        ariaLabel="About the supercell"
        text="The largest cell a child may have, as P (its columns are the supercell's axes in the parent's conventional basis). Every k-point with k·t an integer on that cell enters as a chip: 2×2×2 holds a cubic perovskite's zone-boundary points X, M and R. A larger bound takes longer."
      />
      {error && <span style={{ fontSize: fz.micro, color: color.warnInk }}>{error}</span>}
    </span>
  );
}
