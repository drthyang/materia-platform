/**
 * The PDF page's Subgroups view: where the symmetry is lowered. Three ways in,
 * each loading the distortion modes it permits into the Positions group (the
 * 3D Model view then lists them as they refine):
 *
 *   - a parent CIF the loaded structure is decomposed against (withParentModes);
 *   - a symmetry-breaking Γ irrep of the loaded group, activated toward one of
 *     the isotropy subgroups its modes lead to (withActivatedMode);
 *   - a subgroup picked from the lattice (withSubgroup for a t-subgroup,
 *     withSameCellSubgroup for a decentring k-subgroup or a general one).
 *
 * The irreps are Γ's and, for a centred parent, those at the decentring
 * k-points that keep the conventional cell (X for F, H for I, …), labelled
 * generically: the k-point, "irrep n of m" (ADR 0004). Cell-multiplying
 * k-points need a supercell (Phase 2) and are only named.
 *
 * All start from the parent's own symmetry: while a choice is in force
 * it is shown with ✕ clear (withoutModes), and the pickers wait for it.
 */

import { useMemo } from "react";
import { ACTIVATION_KICK, type ModesInForce } from "@/app/pdfPage";
import type { StructureModel } from "@/core/crystal/types";
import { decomposeDisplacementRepresentation, type DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import type { DisplacementField, SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { irrepIsotropySubgroups, irrepEngine, type IsotropySubgroup } from "@/core/crystal/isotropySubgroups";
import { formatBasis } from "@/core/crystal/standardSetting";
import { subgroupClassRepresentatives, type StructuralSubgroupTree, type SubgroupNode } from "@/core/crystal/subgroupTree";
import { decentringTerms } from "@/core/crystal/decentringModes";
import { identifySubgroup } from "@/core/crystal/isotropyTree";
import { sameCellSubgroups, type SameCellSubgroup } from "@/core/crystal/irreps/sameCellLattice";
import type { KStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { color, fz, mono, resetRangeBtn, uppercaseLabel } from "@/app/theme";

/** An isotropy subgroup of an irrep (one order-parameter direction, its conjugates counted), with a field that reaches it. */
export type IrrepSubgroup = IsotropySubgroup & { readonly field: DisplacementField };

/** One symmetry-breaking Γ irrep of the loaded group and its isotropy subgroups. */
export interface IrrepBranch {
  readonly term: DisplaciveIrrepTerm;
  readonly subgroups: readonly IrrepSubgroup[];
}

/**
 * The displacive decomposition of a structure's own space group at Γ: the
 * irreps that could carry a symmetry-breaking distortion, each with its
 * isotropy subgroups — the epikernels and the kernel, one per order-parameter
 * direction, one-parameter directions first (isotropySubgroups.ts; Stokes &
 * Hatch 1988). Null when the decomposition is not available. Acoustic-only
 * terms (optic = 0) are dropped: their entire content is a rigid translation
 * the gauge projection would discard, making activation a guaranteed no-op.
 */
export function gammaIrrepTree(structure: StructureModel): readonly IrrepBranch[] | null {
  const dec = decomposeDisplacementRepresentation(structure);
  if (!dec.available) return null;
  return dec.terms
    .filter((t) => !t.trivial && t.multiplicity - t.acoustic > 0)
    .map((term) => ({
      term,
      subgroups: irrepIsotropySubgroups(structure, term).filter((s): s is IrrepSubgroup => s.field !== null),
    }));
}

/** One decentring irrep of the loaded group (same cell) and its isotropy subgroups. */
export interface DecentringBranch extends IrrepBranch {
  readonly star: KStar;
}

/**
 * The decentring irreps of a centred parent that carry an optic displacement,
 * each with its isotropy subgroups (decentringModes.ts, isotropySubgroups.ts):
 * the irreps at the k-points of the conventional-cell bound other than Γ.
 * Empty for a primitive parent.
 */
export function decentringIrrepTree(structure: StructureModel): readonly DecentringBranch[] {
  return decentringTerms(structure).map(({ star, term }) => ({
    star,
    term,
    subgroups: irrepIsotropySubgroups(structure, term).filter((s): s is IrrepSubgroup => s.field !== null),
  }));
}

/** A class of k- or general subgroups of the same-cell lattice, named. */
export type SameCellNode = SameCellSubgroup & { readonly identity: SubgroupIdentity };

/**
 * The same-cell lattice's k- and general subgroups (one per conjugacy class),
 * each named in its standard setting: the subgroups beyond the t-lattice that
 * keep the conventional cell.
 */
export function sameCellLattice(structure: StructureModel): readonly SameCellNode[] {
  const ops = structure.spaceGroup.operations;
  if (ops.length === 0) return [];
  const group = irrepEngine(ops).group;
  return sameCellSubgroups(group)
    .filter((n) => n.classRepresentative && (n.kind === "k" || n.kind === "general"))
    .map((n) => ({ ...n, identity: identifySubgroup(n.operations, ops, { standard: true }) }));
}

/** The standard k-points of the parent's lattice that multiply the cell (Phase 2), for the note. */
function supercellPoints(structure: StructureModel): string {
  const f = new Set(structure.spaceGroup.operations.filter((op) => op.rotation.every((r, i) => r.every((x, j) => x === (i === j ? 1 : 0)))).map((op) => op.translation.map((t) => Math.round(((t % 1) + 1) % 1 * 24)).join(","))).size;
  const cubic = structure.spaceGroup.operations.filter((op) => op.rotation[0][0] + op.rotation[1][1] + op.rotation[2][2] === 0).length >= 8 * f;
  if (cubic && f === 1) return "X, M and R";
  if (cubic && f === 4) return "L and W";
  if (cubic && f === 2) return "N and P";
  return "zone-boundary points that multiply the cell";
}

/** The name of a subgroup as the page lists it: the standard symbol and number, else the point group and index. */
export function subgroupName(identity: SubgroupIdentity): string {
  return identity.number !== undefined
    ? `${identity.hermannMauguin ?? "?"} #${identity.number}`
    : `${identity.pointGroup ?? "?"} (index ${identity.index})`;
}

/** The tooltip of an Activate → button: the direction, its orientations and domain states, where the name holds, and the kick. */
function directionTitle(sub: IrrepSubgroup, dim: number): string {
  const direction = sub.kernel
    ? `a general direction of the order parameter (all ${dim} components free, the irrep's kernel)`
    : sub.orderParameterDim === 1
      ? "a one-parameter direction of the order parameter"
      : `a ${sub.orderParameterDim}-parameter direction of the order parameter (of ${dim})`;
  const orientations = `${sub.conjugates} orientation${sub.conjugates === 1 ? "" : "s"} (conjugate subgroups), ${sub.domainStates} domain states`;
  const note = settingNote(sub.identity);
  return `The isotropy subgroup of ${direction}; ${orientations}${note ? `; ${note}` : ""}. Activate: the space group lowers to it (Wyckoff orbits split) and the mode enters the Positions group free with a ${ACTIVATION_KICK} Å starting amplitude: at amplitude 0 the parent's symmetry makes χ² stationary along every symmetry-breaking mode, so it must start off zero.`;
}

/** Where the standard name holds, when it is not the parent's own cell. */
export function settingNote(identity: SubgroupIdentity): string | null {
  if (identity.method !== "conventional-cell" || !identity.basis) return null;
  const shift = identity.originShift ? `, origin shifted by (${identity.originShift.map((x) => +x.toFixed(4)).join(", ")})` : "";
  const given = identity.inParentCell ? `; ${identity.inParentCell} in the parent's cell` : "";
  return `named in its own cell, ${formatBasis(identity.basis)}${shift}${given}; the structure keeps the parent's cell`;
}

interface Props {
  /** The loaded structure's space group: the parent every choice here lowers. */
  readonly spaceGroup: string | undefined;
  readonly lattice: StructuralSubgroupTree;
  /** The Γ irrep tree (gammaIrrepTree); null while a choice is in force, or when the decomposition is unavailable. */
  readonly irrepTree: readonly IrrepBranch[] | null;
  /** The decentring irreps (decentringIrrepTree); null while a choice is in force. */
  readonly decentringTree?: readonly DecentringBranch[] | null;
  /** The same-cell lattice's k- and general subgroups (sameCellLattice). */
  readonly sameCell?: readonly SameCellNode[];
  /** The k-points that need a supercell, named for the note (supercellPointsOf). */
  readonly supercellNote?: string | null;
  readonly onActivateSameCell?: (node: SameCellNode) => void;
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

/** The note on the k-points beyond the bound: they need a supercell (planned). */
export function supercellPointsOf(structure: StructureModel): string {
  return supercellPoints(structure);
}

type LatticeRow = { readonly t: SubgroupNode } | { readonly k: SameCellNode };

export function SubgroupsPanel({ spaceGroup, lattice, irrepTree, decentringTree = null, sameCell = [], supercellNote = null, onActivateSameCell, modes, modeCount, busy, onLoadParentCif, onActivateMode, onActivateSubgroup, onClear, onOpenModel }: Props): JSX.Element {
  const levels = useMemo(() => {
    const byIndex = new Map<number, LatticeRow[]>();
    const add = (index: number, row: LatticeRow): void => {
      const list = byIndex.get(index);
      if (list) list.push(row);
      else byIndex.set(index, [row]);
    };
    for (const n of subgroupClassRepresentatives(lattice)) add(n.index, { t: n });
    for (const n of sameCell) add(n.domainStates, { k: n });
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([index, nodes]) => ({ index, nodes }));
  }, [lattice, sameCell]);
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
                        title={directionTitle(sub, dim)}
                      >
                        Activate → {subgroupName(sub.identity)}
                        {sub.orderParameterDim > 1 ? ` · ${sub.kernel ? "general" : `${sub.orderParameterDim}-dim`}` : ""}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: color.secondary }}>
              Each irrep lists its isotropy subgroups, one per order-parameter direction (Stokes &amp; Hatch): the one-parameter directions first, then the lower ones down to a general direction.
            </p>
          </>
        )}
      </div>

      {/* The decentring irreps: k-points that keep the conventional cell (X for F, H for I, …). */}
      {modes === null && decentringTree !== null && decentringTree.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={uppercaseLabel}>Decentring modes · irreps (same cell)</span>
            <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
              {`${parent} · ${[...new Set(decentringTree.map((b) => b.star.label))].join(", ")} · ${decentringTree.length} irrep${decentringTree.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="wb-grow-box" style={{ marginTop: 4, border: `1px solid ${color.border}`, borderRadius: 6, maxHeight: 168, overflowY: "auto" }}>
            {decentringTree.map(({ star, term, subgroups }) => (
              <div key={term.irrep.label} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "5px 8px", borderTop: `1px solid ${color.subtle2}` }}>
                <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink, minWidth: 128 }} title={`k = (${star.k.join(", ")}), ${star.arms.length} arm${star.arms.length === 1 ? "" : "s"}; a physically irreducible representation, real`}>
                  {term.irrep.label} · dim {term.irrep.dim ?? 1} · {term.multiplicity} mode{term.multiplicity === 1 ? "" : "s"}
                </span>
                {subgroups.map((sub, si) => (
                  <button
                    key={si}
                    style={{ ...resetRangeBtn, ...(busy ? { opacity: 0.55, cursor: "not-allowed" } : {}) }}
                    disabled={busy}
                    onClick={() => onActivateMode(term, sub)}
                    title={`${directionTitle(sub, term.irrep.dim ?? 1)} Index ${sub.index.t * sub.index.k} = ${sub.index.t}·${sub.index.k} (point group · translations); the child keeps the conventional cell.`}
                  >
                    Activate → {subgroupName(sub.identity)} · {sub.direction}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: color.secondary }}>
            Irreps at the k-points the centring makes zone-boundary but the conventional cell still holds: a distortion there loses centring translations and keeps the cell, so it refines as it stands. Each direction is written in the irrep's own basis, which can differ from ISODISTORT's symbols. Activating one splits the Wyckoff orbits and lists the child's modes by parent irrep and site, the order parameter first.
          </p>
        </div>
      )}
      {supercellNote && (
        <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: color.secondary }}>
          {`Cell-multiplying k-points (${supercellNote}) need a supercell (planned).`}
        </p>
      )}

      {/* Subgroup-driven: the translationengleiche lattice, by index. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 10, marginBottom: 4 }}>
        <span style={uppercaseLabel}>Subgroup lattice</span>
        <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
          {parent} · {lattice.nodes.length} translationengleiche subgroups · {levels.reduce((s, l) => s + l.nodes.filter((r) => "t" in r).length, 0)} distinct types{sameCell.length > 0 ? ` · ${sameCell.length} k- and general classes in the same cell` : ""}
        </span>
      </div>
      <div className="wb-grow-box" style={{ overflowY: "auto", border: `1px solid ${color.border}`, borderRadius: 6, flex: "1 1 auto", minHeight: 140 }}>
        {levels.map(({ index, nodes }) => (
          <div key={index}>
            <div style={{ position: "sticky", top: 0, padding: "3px 8px", background: color.subtle, borderTop: `1px solid ${color.border}`, borderBottom: `1px solid ${color.subtle2}`, fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
              index {index}{index === 1 ? " · parent group" : ""}
            </div>
            {nodes.map((row) => "k" in row ? (
              <div key={`k${row.k.classId}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 8px", borderTop: `1px solid ${color.subtle2}` }}>
                <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink, minWidth: 140 }} title={settingNote(row.k.identity) ?? undefined}>
                  {row.k.identity.hermannMauguin ?? row.k.identity.pointGroup ?? "?"}
                  {row.k.identity.number !== undefined ? <span style={{ color: color.secondary }}> #{row.k.identity.number}</span> : null}
                  <span style={{ color: color.secondary }}>{` · ${row.k.kind === "k" ? "k" : "general"} · ${row.k.index.t}·${row.k.index.k}`}</span>
                </span>
                <span
                  style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}
                  title={`${row.k.kind === "k" ? "A decentring k-subgroup: the point group kept, centring translations lost" : "A general subgroup: point-group operations and centring translations lost"}, the conventional cell kept. Index ${row.k.domainStates} = ${row.k.index.t} (point group) · ${row.k.index.k} (translations). ${row.k.conjugates} conjugate subgroup${row.k.conjugates === 1 ? "" : "s"}, ${row.k.domainStates} domain states.`}
                >
                  {row.k.conjugates > 1 ? `${row.k.conjugates} orientations · ` : ""}{row.k.domainStates} domain states
                </span>
                {onActivateSameCell && (
                  <button
                    style={{ ...resetRangeBtn, marginLeft: "auto", ...(pickBlocked ? blockedStyle : {}) }}
                    disabled={pickBlocked}
                    onClick={() => onActivateSameCell(row.k)}
                    title={modes !== null ? "Clear the active distortion first" : `Lower to this subgroup in the parent's cell: split the Wyckoff orbits and load its modes by parent irrep, the order parameter free from a ${ACTIVATION_KICK} Å start.`}
                  >
                    Activate ↓
                  </button>
                )}
              </div>
            ) : (() => { const n = row.t; return (
              <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 8px", borderTop: `1px solid ${color.subtle2}` }}>
                <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink, minWidth: 140 }} title={settingNote(n.identity) ?? undefined}>
                  {n.identity.hermannMauguin ?? n.pointGroup ?? "?"}
                  {n.identity.hermannMauguin && n.pointGroup ? <span style={{ color: color.secondary }}> ({n.pointGroup})</span> : null}
                  {n.identity.number !== undefined ? <span style={{ color: color.secondary }}> #{n.identity.number}</span> : null}
                  {n.identity.method === "conventional-cell" ? <span style={{ color: color.secondary }}> · own cell</span> : null}
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
                  <span style={{ fontSize: fz.micro, color: color.secondary }} title="no tabulated setting matched: named by its point group only">
                    approx.
                  </span>
                )}
                {!n.isParent && !n.isTrivial && (
                  <button
                    style={{ ...resetRangeBtn, marginLeft: "auto", ...(pickBlocked ? blockedStyle : {}) }}
                    disabled={pickBlocked}
                    onClick={() => onActivateSubgroup(n)}
                    title={modes !== null ? "Clear the active distortion first" : `Lower to this subgroup: split the Wyckoff orbits and load the Γ distortion modes it permits into the Positions group as refinable amplitudes, the order parameter that lowers the structure to it free from a ${ACTIVATION_KICK} Å start.`}
                  >
                    Activate ↓
                  </button>
                )}
              </div>
            ); })())}
          </div>
        ))}
      </div>
      <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: color.secondary }}>
        The subgroups that keep the conventional cell, each named in its standard setting: the translationengleiche ones with the parent's centring kept, and for a centred parent the decentring k-subgroups and the general ones (marked k or general, with the index split as point group · translations). Activating one splits the Wyckoff orbits and exposes the distortion modes that subgroup allows as amplitudes: at the parent's geometry χ² is stationary along every symmetry-breaking mode, so the order parameter that lowers the structure to it leads, free from a {ACTIVATION_KICK} Å start, and the others start at 0, fixed. Cell-multiplying subgroups need a supercell (planned).
      </p>
    </div>
  );
}
