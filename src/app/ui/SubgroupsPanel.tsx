/**
 * The PDF page's Subgroups view: where the symmetry is lowered. Three ways in,
 * each loading the distortion modes it permits into the Positions group (the
 * 3D Model view then lists them as they refine):
 *
 *   - a parent CIF the loaded structure is decomposed against (withParentModes);
 *   - a symmetry-breaking Γ irrep of the loaded group, activated toward one of
 *     the isotropy subgroups its modes lead to (withActivatedMode);
 *   - a translationengleiche subgroup picked from the lattice (withSubgroup).
 *
 * All three start from the parent's own symmetry: while a choice is in force
 * it is shown with ✕ clear (withoutModes), and the pickers wait for it.
 */

import { useMemo } from "react";
import { ACTIVATION_KICK, type ModesInForce } from "@/app/pdfPage";
import type { StructureModel } from "@/core/crystal/types";
import { decomposeDisplacementRepresentation, type DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import {
  projectIsotypicModes,
  stabilizerOfField,
  identifySubgroup,
  subgroupTypeKey,
  type DisplacementField,
  type SubgroupIdentity,
} from "@/core/crystal/isotropyTree";
import { subgroupClassRepresentatives, type StructuralSubgroupTree, type SubgroupNode } from "@/core/crystal/subgroupTree";
import { color, fz, mono, resetRangeBtn, uppercaseLabel } from "@/app/theme";

/** An isotropy subgroup one of an irrep's modes leads to, with a field that reaches it. */
export interface IrrepSubgroup {
  readonly identity: SubgroupIdentity;
  readonly field: DisplacementField;
  /** How many of the irrep's candidate modes lead to it. */
  readonly count: number;
}

/** One symmetry-breaking Γ irrep of the loaded group and the subgroups its modes lead to. */
export interface IrrepBranch {
  readonly term: DisplaciveIrrepTerm;
  readonly subgroups: readonly IrrepSubgroup[];
}

/**
 * The displacive decomposition of a structure's own space group at Γ: the
 * irreps that could carry a symmetry-breaking distortion, each with the
 * isotropy subgroups its modes lead to (null when it is not available).
 * Acoustic-only terms (optic = 0) are dropped: their entire content is a rigid
 * translation the gauge projection would discard, making activation a
 * guaranteed no-op.
 */
export function gammaIrrepTree(structure: StructureModel): readonly IrrepBranch[] | null {
  const dec = decomposeDisplacementRepresentation(structure);
  if (!dec.available) return null;
  return dec.terms
    .filter((t) => !t.trivial && t.multiplicity - t.acoustic > 0)
    .map((term) => {
      const fields = projectIsotypicModes(structure, undefined, term, structure.spaceGroup.operations);
      // Group candidate modes by the subgroup they lead to — the tree view.
      // The key must distinguish subgroups that share point group and index
      // but differ in translation content (Pm vs Pc), hence the
      // setting-invariant op-set key fallback.
      const bySub = new Map<string, { identity: SubgroupIdentity; field: DisplacementField; count: number }>();
      for (const f of fields) {
        const subOps = stabilizerOfField(f, structure.spaceGroup.operations);
        const id = identifySubgroup(subOps, structure.spaceGroup.operations);
        const key = id.number !== undefined ? `#${id.number}` : subgroupTypeKey(subOps);
        const e = bySub.get(key);
        if (e) e.count++;
        else bySub.set(key, { identity: id, field: f, count: 1 });
      }
      return { term, subgroups: [...bySub.values()] };
    });
}

interface Props {
  /** The loaded structure's space group: the parent every choice here lowers. */
  readonly spaceGroup: string | undefined;
  readonly lattice: StructuralSubgroupTree;
  /** The Γ irrep tree (gammaIrrepTree); null while a choice is in force, or when the decomposition is unavailable. */
  readonly irrepTree: readonly IrrepBranch[] | null;
  /** The parent CIF or subgroup choice in force, or null at the parent's own symmetry. */
  readonly modes: ModesInForce | null;
  /** How many of its modes refine (pageView.modeSet); null while Positions is on “Constrained atomic”. */
  readonly modeCount: number | null;
  readonly busy: boolean;
  readonly onLoadParentCif: (file: File) => void;
  readonly onActivateMode: (term: DisplaciveIrrepTerm, sub: IrrepSubgroup) => void;
  readonly onActivateSubgroup: (node: SubgroupNode) => void;
  /** Drop the choice: back to the parent's per-coordinate positions. */
  readonly onClear: () => void;
  /** Open the 3D Model view, where the modes are inspected. */
  readonly onOpenModel: () => void;
}

export function SubgroupsPanel({ spaceGroup, lattice, irrepTree, modes, modeCount, busy, onLoadParentCif, onActivateMode, onActivateSubgroup, onClear, onOpenModel }: Props): JSX.Element {
  const levels = useMemo(() => {
    const byIndex = new Map<number, SubgroupNode[]>();
    for (const n of subgroupClassRepresentatives(lattice)) {
      const list = byIndex.get(n.index);
      if (list) list.push(n);
      else byIndex.set(n.index, [n]);
    }
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([index, nodes]) => ({ index, nodes }));
  }, [lattice]);
  const parent = spaceGroup ?? "parent";
  const pickBlocked = busy || modes !== null;
  const blockedStyle = { opacity: 0.5, cursor: "not-allowed" } as const;
  return (
    <div className="wb-subgroups" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>
      {modes && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8, padding: "5px 9px", borderRadius: 6, background: "rgba(90, 130, 255, 0.08)", border: `1px solid ${color.border}`, fontSize: fz.micro }}>
          <span style={{ color: color.primary, fontFamily: mono }}>
            {modes.fromActivation ? `▼ lowered to ${modes.parentName}` : `▼ decomposed against ${modes.parentName}`}
          </span>
          <span style={{ color: color.secondary }}>
            {modeCount === null
              ? "set aside while Positions is on “Constrained atomic” — flip it to “Irreps (modes)” to refine them"
              : `${modeCount} distortion mode${modeCount === 1 ? "" : "s"} in the Positions group — free the rows to refine`}
          </span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
            <button style={resetRangeBtn} onClick={onOpenModel} title="Inspect the modes being refined: their amplitudes, and each one's displacement pattern drawn on the 3D model">
              3D Model →
            </button>
            <button
              style={{ ...resetRangeBtn, ...(busy ? blockedStyle : {}) }}
              disabled={busy}
              onClick={onClear}
              title={modes.fromActivation ? "Discard the distortion and return to the parent's per-coordinate positions" : "Drop the parent-CIF decomposition and return to per-coordinate positions"}
            >
              ✕ clear
            </button>
          </span>
        </div>
      )}

      {/* From a parent CIF: the loaded structure is already the low-symmetry child. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 4, flexWrap: "wrap" }}>
        <span style={uppercaseLabel}>Parent CIF</span>
        <label
          style={{ border: `1px solid ${color.border}`, borderRadius: 6, padding: "2px 10px", fontSize: fz.micro, color: color.ink, cursor: "pointer", ...(pickBlocked ? blockedStyle : {}) }}
          title={modes !== null ? "Clear the active distortion first" : "Decompose this structure against a high-symmetry parent CIF (same lattice/setting) into refinable symmetry-mode amplitudes — refine one order parameter instead of many coordinates"}
        >
          Load parent CIF…
          <input
            type="file"
            accept=".cif,text/plain"
            disabled={pickBlocked}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLoadParentCif(f);
              e.target.value = "";
            }}
          />
        </label>
        <span style={{ fontSize: fz.micro, color: color.secondary }}>
          for a loaded structure that is already the distorted child — its distortion from the parent as mode amplitudes, seeded to reproduce it exactly
        </span>
      </div>

      {/* Irrep-driven: a symmetry-breaking Γ irrep of the loaded group, toward one of its isotropy subgroups. */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={uppercaseLabel}>Potential Γ modes · irreps</span>
          <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
            {modes !== null
              ? `offered from ${parent} itself — ✕ clear the active distortion first`
              : irrepTree === null
                ? `${parent} · no Γ decomposition available`
                : `${parent} · ${irrepTree.length} symmetry-breaking irrep${irrepTree.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {modes === null && irrepTree !== null && irrepTree.length === 0 && (
          <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: color.secondary }}>
            No symmetry-breaking Γ irrep carries an optic (non-translation) mode on these sites.
          </p>
        )}
        {modes === null && irrepTree !== null && irrepTree.length > 0 && (
          <>
            <div className="wb-grow-box" style={{ marginTop: 4, border: `1px solid ${color.border}`, borderRadius: 6, maxHeight: 168, overflowY: "auto" }}>
              {irrepTree.map(({ term, subgroups }) => {
                const dim = term.irrep.dim ?? 1;
                const optic = term.multiplicity - term.acoustic;
                return (
                  <div key={term.irrep.label} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "5px 8px", borderTop: `1px solid ${color.subtle2}` }}>
                    <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink, minWidth: 128 }}>
                      {term.irrep.label} · dim {dim} · {optic} optic mode{optic === 1 ? "" : "s"}
                      {term.acoustic > 0 ? ` (+${term.acoustic} acoustic)` : ""}
                    </span>
                    {subgroups.map((sub, si) => (
                      <button
                        key={si}
                        style={{ ...resetRangeBtn, ...(busy ? { opacity: 0.55, cursor: "not-allowed" } : {}) }}
                        disabled={busy}
                        onClick={() => onActivateMode(term, sub)}
                        title={`Activate this distortion: the space group lowers to the isotropy subgroup (Wyckoff orbits split), the mode enters the Positions group free with a ${ACTIVATION_KICK} Å starting amplitude — a polar mode of a centrosymmetric parent sits at an exact χ² stationary point at amplitude 0, so it must start off zero.`}
                      >
                        Activate → {sub.identity.hermannMauguin ?? sub.identity.pointGroup ?? "?"}
                        {sub.identity.number !== undefined ? ` #${sub.identity.number}` : ` (index ${sub.identity.index})`}
                        {sub.count > 1 ? ` ·${sub.count}` : ""}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: color.secondary }}>
              Cell-preserving (Γ) distortions of the loaded group only — zone-boundary (cell-multiplying) modes need projective small representations and are deliberately not enumerated. Oblique order-parameter directions arrive via a parent-CIF decomposition.
            </p>
          </>
        )}
      </div>

      {/* Subgroup-driven: the translationengleiche lattice, by index. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 10, marginBottom: 4 }}>
        <span style={uppercaseLabel}>Subgroup lattice</span>
        <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
          {parent} · {lattice.nodes.length} translationengleiche subgroups · {levels.reduce((s, l) => s + l.nodes.length, 0)} distinct types
        </span>
      </div>
      <div className="wb-grow-box" style={{ overflowY: "auto", border: `1px solid ${color.border}`, borderRadius: 6, flex: "1 1 auto", minHeight: 140 }}>
        {levels.map(({ index, nodes }) => (
          <div key={index}>
            <div style={{ position: "sticky", top: 0, padding: "3px 8px", background: color.subtle, borderTop: `1px solid ${color.border}`, borderBottom: `1px solid ${color.subtle2}`, fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
              index {index}{index === 1 ? " · parent group" : ""}
            </div>
            {nodes.map((n) => (
              <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 8px", borderTop: `1px solid ${color.subtle2}` }}>
                <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink, minWidth: 140 }}>
                  {n.identity.hermannMauguin ?? n.pointGroup ?? "?"}
                  {n.identity.hermannMauguin && n.pointGroup ? <span style={{ color: color.secondary }}> ({n.pointGroup})</span> : null}
                  {n.identity.number !== undefined ? <span style={{ color: color.secondary }}> #{n.identity.number}</span> : null}
                </span>
                {n.domainStates > 1 && (
                  <span
                    style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}
                    title={`${n.conjugates} conjugate subgroup${n.conjugates === 1 ? "" : "s"} [G : N_G(H)]: the orientations of this distortion. ${n.domainStates} domain states [G : H]${n.conjugates > 1 ? `: ${n.domainStates / n.conjugates} in each orientation, of the same symmetry (such as ±)` : ""}.`}
                  >
                    {n.conjugates > 1 ? `${n.conjugates} orientations · ` : ""}{n.domainStates} domain states
                  </span>
                )}
                {n.identity.number === undefined && !n.isTrivial && (
                  <span style={{ fontSize: fz.micro, color: color.secondary }} title="named by point group only — the origin-shifted/translation setting is not resolved yet">
                    approx.
                  </span>
                )}
                {!n.isParent && !n.isTrivial && (
                  <button
                    style={{ ...resetRangeBtn, marginLeft: "auto", ...(pickBlocked ? blockedStyle : {}) }}
                    disabled={pickBlocked}
                    onClick={() => onActivateSubgroup(n)}
                    title={modes !== null ? "Clear the active distortion first" : "Lower to this subgroup: split the Wyckoff orbits and load the Γ distortion modes it permits into the Positions group as refinable amplitudes."}
                  >
                    Activate ↓
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: color.secondary }}>
        Translationengleiche (lattice-preserving) subgroups only. Activating one splits the Wyckoff orbits and exposes the Γ distortion modes that subgroup allows as amplitudes (all seed at 0 — a polar mode sits at a χ² stationary point, so free it and use Prefit to escape zero). Cell-multiplying (klassengleiche) subgroups arrive with the zone-boundary engine.
      </p>
    </div>
  );
}
