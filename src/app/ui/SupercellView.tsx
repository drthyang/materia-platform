/**
 * The Subgroups page's supercell view (subgroup engine, Phase 2): a supercell
 * bound P (default 2×2×2 conventional, any integer or centred P accepted)
 * and the two views inside it —
 *
 *   - Irreps: a k-point of the bound (Γ, the decentring points, and the
 *     cell-multiplying ones such as Pm-3m X, M, R or Fm-3m L, W), its
 *     physically irreducible representations with generic labels (ADR 0004)
 *     and their isotropy subgroups, each named in ITA standard setting with
 *     its child basis (P_H, p_H), index t·k and active arms;
 *   - Lattice: the classes of subgroups whose lattice is the supercell
 *     (Bilbao's SUBGROUPS list), plus those between it and the parent cell,
 *     named, with t·k, orientation and domain states and the maximal ones
 *     marked. A search above the measured ceiling is refused, not truncated.
 *
 * Cell-multiplying children are listed and named but not activated: their
 * refinement needs the supercell forward model, which arrives in phase 3
 * (THY-34). Everything is computed on request; a large bound takes seconds.
 */

import { useState } from "react";
import type { SymmetryOperation } from "@/core/crystal/types";
import { factorGroup, starsInBound, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar, formatK, type StarIrreps } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups, type IrrepIsotropySubgroup } from "@/core/crystal/irreps/isotropy";
import { supercellSubgroups, SubgroupSearchTooLarge, type SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL, type SupercellCentring, type SupercellSpec } from "@/core/crystal/irreps/supercell";
import { rnum } from "@/core/crystal/irreps/rational";
import { formatBasis } from "@/core/crystal/standardSetting";
import type { SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { color, fz, mono, resetRangeBtn, uppercaseLabel } from "@/app/theme";

/** Shown in place of Activate on a cell-multiplying child. */
export const PHASE3_NOTE = "supercell refinement arrives in phase 3";

const PRESETS: readonly { readonly label: string; readonly P: number[][] }[] = [
  { label: "2×2×2", P: DEFAULT_SUPERCELL.map((r) => [...r]) },
  { label: "1×1×1 (same cell)", P: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  { label: "2×1×1", P: [[2, 0, 0], [0, 1, 0], [0, 0, 1]] },
  { label: "1×1×2", P: [[1, 0, 0], [0, 1, 0], [0, 0, 2]] },
  { label: "√2×√2×1", P: [[1, -1, 0], [1, 1, 0], [0, 0, 1]] },
  { label: "√2×√2×2", P: [[1, -1, 0], [1, 1, 0], [0, 0, 2]] },
];

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

const formatMatrix = (P: readonly (readonly number[])[]): string => P.map((r) => r.map((x) => +x.toFixed(4)).join(" ")).join("; ");

/** The child basis in words: "a′ = 2a, b′ = 2b, c′ = 2c, origin (½, 0, 0)". */
export function childBasisNote(identity: SubgroupIdentity | undefined): string {
  if (!identity) return "";
  if (identity.method !== "conventional-cell" || !identity.basis) return identity.method === "direct" ? "in the parent's cell" : "";
  const shift = identity.originShift ? `, origin (${identity.originShift.map((x) => +x.toFixed(4)).join(", ")})` : "";
  return `${formatBasis(identity.basis)}${shift}`;
}

const nameOf = (identity: SubgroupIdentity | undefined): string =>
  identity?.number !== undefined ? `${identity.hermannMauguin ?? "?"} #${identity.number}` : `${identity?.pointGroup ?? "?"} (unnamed)`;

interface IrrepRow {
  readonly label: string;
  readonly dim: number;
  readonly subgroups: readonly IrrepIsotropySubgroup[];
}

interface Computed {
  readonly group: FactorGroup;
  readonly stars: readonly { readonly k: [number, number, number]; readonly label: string }[];
}

function starChoices(group: FactorGroup): Computed["stars"] {
  return starsInBound(group).map((k) => {
    const v: [number, number, number] = [rnum(k[0]), rnum(k[1]), rnum(k[2])];
    return { k: v, label: formatK(v) };
  });
}

export function SupercellView({ operations }: { readonly operations: readonly SymmetryOperation[] }): JSX.Element {
  const [preset, setPreset] = useState(0);
  const [custom, setCustom] = useState(formatMatrix(DEFAULT_SUPERCELL));
  const [centring, setCentring] = useState<SupercellCentring>("P");
  const [view, setView] = useState<"irreps" | "lattice">("irreps");
  const [computed, setComputed] = useState<Computed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starIndex, setStarIndex] = useState(0);
  const [irreps, setIrreps] = useState<{ star: StarIrreps; rows: IrrepRow[] } | null>(null);
  const [lattice, setLattice] = useState<SupercellLattice | null>(null);
  const [maxIndex, setMaxIndex] = useState(48);
  const [working, setWorking] = useState(false);

  const spec = (): SupercellSpec | null => {
    const P = parseSupercell(custom);
    return P ? { P, centring } : null;
  };
  /** Run a computation after the "working" state has painted. */
  const run = (f: () => void): void => {
    setWorking(true);
    setError(null);
    setTimeout(() => {
      try {
        f();
      } catch (e) {
        setError(e instanceof SubgroupSearchTooLarge ? `Refused: ${e.message}.` : String((e as Error).message ?? e));
      } finally {
        setWorking(false);
      }
    }, 20);
  };
  const build = (): void => run(() => {
    const s = spec();
    if (!s) throw new Error("P must be three rows of three numbers, e.g. 2 0 0; 0 2 0; 0 0 2");
    const group = factorGroup(operations, s);
    setComputed({ group, stars: starChoices(group) });
    setIrreps(null);
    setLattice(null);
    setStarIndex(0);
  });
  const showIrreps = (i: number): void => run(() => {
    if (!computed) return;
    const star = irrepsOfStar(computed.group, computed.stars[i]!.k);
    setIrreps({ star, rows: star.physical.map((p) => ({ label: p.label, dim: p.dim, subgroups: isotropySubgroups(computed.group, p).subgroups })) });
  });
  const showLattice = (): void => run(() => {
    if (!computed) return;
    setLattice(supercellSubgroups(computed.group, { maxIndex }));
  });

  const box = { marginTop: 4, border: `1px solid ${color.border}`, borderRadius: 6, maxHeight: 220, overflowY: "auto" } as const;
  const row = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 8px", borderTop: `1px solid ${color.subtle2}` } as const;
  const phase3 = <span style={{ marginLeft: "auto", fontSize: fz.micro, color: color.secondary, fontStyle: "italic" }}>{PHASE3_NOTE}</span>;

  return (
    <div style={{ marginTop: 10 }} className="wb-supercell">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={uppercaseLabel}>Supercell</span>
        <select
          value={preset}
          onChange={(e) => {
            const i = Number(e.target.value);
            setPreset(i);
            if (i >= 0) setCustom(formatMatrix(PRESETS[i]!.P));
          }}
          style={{ fontSize: fz.micro }}
          title="The supercell bound P: the columns are the supercell's axes in the parent's conventional basis"
        >
          {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          <option value={-1}>custom P</option>
        </select>
        <input
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            setPreset(-1);
          }}
          style={{ fontFamily: mono, fontSize: fz.micro, width: 150 }}
          aria-label="supercell matrix P, rows separated by ;"
          title="P as three rows (columns = the supercell's axes); fractions such as 1/2 are accepted for a centred parent"
        />
        <select value={centring} onChange={(e) => setCentring(e.target.value as SupercellCentring)} style={{ fontSize: fz.micro }} title="The centring of the supercell P describes">
          {(["P", "I", "F", "C", "A", "B", "R"] as const).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button style={resetRangeBtn} disabled={working} onClick={build}>{working ? "working…" : "Set bound"}</button>
        {computed && (
          <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
            G/T″: {computed.group.elements.length} elements · {computed.stars.length} k-point stars
          </span>
        )}
      </div>
      {error && <p style={{ margin: "4px 0 0", fontSize: 12, color: color.secondary }}>{error}</p>}
      {computed && (
        <>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {(["irreps", "lattice"] as const).map((v) => (
              <button key={v} style={{ ...resetRangeBtn, ...(view === v ? { borderColor: color.primary, color: color.primary } : {}) }} onClick={() => setView(v)}>
                {v === "irreps" ? "Irreps" : "Lattice"}
              </button>
            ))}
          </div>
          {view === "irreps" && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: fz.micro, color: color.secondary }}>k-point</span>
                <select value={starIndex} onChange={(e) => setStarIndex(Number(e.target.value))} style={{ fontFamily: mono, fontSize: fz.micro }}>
                  {computed.stars.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
                </select>
                <button style={resetRangeBtn} disabled={working} onClick={() => showIrreps(starIndex)}>Irreps →</button>
                {irreps && (
                  <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
                    {irreps.star.star.label} · {irreps.star.star.arms.length} arm{irreps.star.star.arms.length === 1 ? "" : "s"} · |Ḡ_k| = {irreps.star.littleCoGroupOrder}
                  </span>
                )}
              </div>
              {irreps && (
                <div className="wb-grow-box" style={box}>
                  {irreps.rows.map((r) => (
                    <div key={r.label} style={{ padding: "4px 8px", borderTop: `1px solid ${color.subtle2}` }}>
                      <div style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink }}>{r.label} · dim {r.dim}</div>
                      {r.subgroups.map((s, i) => (
                        <div key={i} style={{ ...row, borderTop: "none", padding: "2px 0 2px 14px" }}>
                          <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink, minWidth: 150 }} title={childBasisNote(s.identity)}>
                            {nameOf(s.identity)}
                          </span>
                          <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
                            {s.direction.symbol} · index {s.index.t}·{s.index.k} · {s.orientationStates} orientation{s.orientationStates === 1 ? "" : "s"} · {s.domainStates} domains · arms {s.activeArms.join(",")}
                            {s.kernel ? " · kernel" : ""}
                          </span>
                          {s.cellMultiplying ? phase3 : <span style={{ marginLeft: "auto", fontSize: fz.micro, color: color.secondary }}>same cell: activate it above</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {view === "lattice" && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: fz.micro, color: color.secondary }}>max index</span>
                <input type="number" min={1} value={maxIndex} onChange={(e) => setMaxIndex(Math.max(1, Number(e.target.value) || 1))} style={{ width: 64, fontSize: fz.micro }} />
                <button style={resetRangeBtn} disabled={working} onClick={showLattice}>Subgroups →</button>
                {lattice && (
                  <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
                    {lattice.classes.length} classes · {lattice.classes.filter((c) => c.supercellLattice).length} with the supercell's lattice · {lattice.classes.filter((c) => c.cellMultiplying).length} cell-multiplying
                  </span>
                )}
              </div>
              {lattice && (
                <div className="wb-grow-box" style={box}>
                  {lattice.classes.map((c) => (
                    <div key={c.id} style={row}>
                      <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink, minWidth: 150 }} title={childBasisNote(c.identity)}>
                        {nameOf(c.identity)}
                      </span>
                      <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }} title={c.coveredBy.length ? `covered by ${c.coveredBy.map((u) => nameOf(lattice.classes[u]!.identity)).join(", ")}` : undefined}>
                        {c.kind === "parent" ? "parent" : `${c.kind}${c.isomorphic ? " (isomorphic)" : ""} · ${c.index.t}·${c.index.k}`}
                        {c.kind !== "parent" ? ` · ${c.orientationStates} orientation${c.orientationStates === 1 ? "" : "s"} · ${c.domainStates} domains` : ""}
                        {c.maximal ? " · maximal" : ""}
                        {c.supercellLattice ? " · supercell lattice" : ""}
                      </span>
                      {c.cellMultiplying ? phase3 : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: color.secondary }}>
            Inside the bound P every k-point with k·t integer on the supercell enters, cell-multiplying ones included. Children are named in their ITA standard setting; hover a name for its basis (P_H, p_H) from the parent's cell. Cell-multiplying children are listed and named here; {PHASE3_NOTE}.
          </p>
        </>
      )}
    </div>
  );
}
