/**
 * The PDF page's distortion modes, under the 3D Model view: the modes being
 * refined, each amplitude with its esd and free/fixed state, the total |A|
 * and the acoustic combinations left out. Modes by parent irrep (a supercell
 * child, a decomposition, a mode CIF) are grouped under their irrep, with the
 * irrep's total A_s and A_p, as ISODISTORT reports them, and can be saved as
 * an ISODISTORT mode CIF. A row click draws that mode's eigenvector on the
 * model as green arrows. The symmetry the modes lower to is chosen on the
 * Subgroups page (SubgroupsPanel), which also clears it; this table only
 * names it.
 */

import type { ModesInForce } from "@/app/pdfPage";
import { isodistortAmplitudes, type DistortionModeSet } from "@/core/crystal/distortionModes";
import { latticeCentring } from "@/core/crystal/standardSetting";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { color, fz, mono, resetRangeBtn, uppercaseLabel } from "@/app/theme";

interface Props {
  /** The mode set in force (pageView.modeSet); null while positions refine per coordinate. */
  readonly modeSet: DistortionModeSet | null;
  /** The parent CIF or subgroup choice behind it; null for the structure's own (symmetry-conserving) modes. */
  readonly modes: ModesInForce | null;
  readonly params: readonly RefinementParameter[];
  readonly result: RefinementResult | null;
  /** The loaded structure's space group, which the symmetry-conserving modes come from. */
  readonly spaceGroup: string | undefined;
  /** The loaded group has symmetry-conserving modes, so Positions → “Irreps (modes)” is offered. */
  readonly ownModes: boolean;
  readonly shownModeId: string | null;
  readonly onShowMode: (id: string | null) => void;
  /** Open the Subgroups page, where the symmetry is lowered. */
  readonly onOpenSubgroups: () => void;
  /** Save the modes as an ISODISTORT mode CIF (modeCifOf); absent when the set is not one by parent irrep. */
  readonly onExportModeCif?: () => void;
}

export function DistortionModesPanel({ modeSet, modes, params, result, spaceGroup, ownModes, shownModeId, onShowMode, onOpenSubgroups, onExportModeCif }: Props): JSX.Element {
  const toSubgroups = (title: string): JSX.Element => (
    <button style={resetRangeBtn} onClick={onOpenSubgroups} title={title}>
      Subgroups →
    </button>
  );
  if (!modeSet) {
    // Nothing in force: one line that says where the symmetry is chosen. A
    // choice set aside (Positions flipped back to atomic) is named, since it
    // comes back on the flip.
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 4, flexWrap: "wrap" }}>
        <span style={uppercaseLabel}>Distortion modes</span>
        <span style={{ fontSize: fz.micro, color: color.secondary }}>
          {modes
            ? `vs ${modes.parentName}, set aside while Positions is on “Constrained atomic” — flip it to “Irreps (modes)” to refine them`
            : "none active — the symmetry is lowered on the Subgroups page"}
        </span>
        {toSubgroups(modes ? "Change or clear the symmetry these modes lower to, on the Subgroups page" : "Lower the symmetry on the Subgroups page: a subgroup, a Γ irrep, or a parent CIF")}
        {!modes && ownModes && (
          <span style={{ fontSize: fz.micro, color: color.secondary }}>
            or flip Positions → “Irreps (modes)” in the parameter panel for the symmetry-conserving Γ modes of {spaceGroup ?? "the loaded space group"}
          </span>
        )}
      </div>
    );
  }
  const shownMode = shownModeId !== null ? modeSet.modes.find((m) => m.id === shownModeId) ?? null : null;
  const totalAmplitude = Math.sqrt(
    modeSet.modes.reduce((s, m) => {
      const v = params.find((p) => p.id === m.id)?.value ?? 0;
      return s + v * v;
    }, 0),
  );
  // ISODISTORT's normalizations (ADR 0003): A_s over the primitive child cell, A_p to the parent's.
  const own = latticeCentring(modeSet.parentized.spaceGroup.operations).length;
  const cells = modeSet.amplitudeCells ?? { child: own, parent: own };
  const totals = isodistortAmplitudes(totalAmplitude, cells);
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={uppercaseLabel}>Distortion modes</span>
        <span style={{ fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
          {modes ? `vs ${modes.parentName}` : `from ${spaceGroup ?? "own space group"}`}
          {` · total |A| = ${totalAmplitude.toFixed(4)} Å (A_s ${totals.as.toFixed(4)}, A_p ${totals.ap.toFixed(4)})`}
          {(modeSet.acousticExcluded ?? 0) > 0 ? ` · ${modeSet.acousticExcluded} acoustic excluded` : ""}
        </span>
        {shownMode && (
          <span style={{ fontFamily: mono, fontSize: fz.micro, color: "#15803d" }}>
            ▸ green arrows: {shownMode.label}
          </span>
        )}
        {toSubgroups(modes ? "The symmetry these modes lower to is chosen on the Subgroups page — change or clear it there" : "Lower the symmetry on the Subgroups page: a subgroup, a Γ irrep, or a parent CIF")}
        {onExportModeCif && (
          <button style={resetRangeBtn} onClick={onExportModeCif} title="Save the child and these modes, at their current amplitudes, as an ISODISTORT mode CIF (ISODISTORT's tags, A_s values and normfactors; MATERIA's generic irrep labels). It reads back here exactly, and ISODISTORT-aware programs such as GSAS-II read its modes.">
            Mode CIF ↓
          </button>
        )}
      </div>
      <div style={{ marginTop: 4, border: `1px solid ${color.border}`, borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: fz.micro }}>
          <thead>
            <tr style={{ color: color.secondary, textAlign: "left" }}>
              <th style={{ padding: "3px 8px", fontWeight: 500 }}>mode</th>
              <th style={{ padding: "3px 8px", fontWeight: 500, textAlign: "right" }} title="MATERIA's refined amplitude: the displacement norm over the conventional child cell">A (Å)</th>
              <th style={{ padding: "3px 8px", fontWeight: 500, textAlign: "right" }} title={`ISODISTORT's A_s, over the primitive child cell: A/√${cells.child}`}>A_s</th>
              <th style={{ padding: "3px 8px", fontWeight: 500, textAlign: "right" }} title={`ISODISTORT's A_p = A_s·√(V_p/V_s), normalized to the parent's primitive cell: A/√${cells.parent}`}>A_p</th>
              <th style={{ padding: "3px 8px", fontWeight: 500, textAlign: "right" }}>esd</th>
              <th style={{ padding: "3px 8px", fontWeight: 500 }}>state</th>
            </tr>
          </thead>
          <tbody>
            {modeSet.modes.map((m, i) => {
              const p = params.find((q) => q.id === m.id);
              const esd = result?.esd[m.id] ?? p?.esd;
              const shown = m.id === shownModeId;
              // Modes by parent irrep: a header row where the irrep changes, with the irrep's total A_s and A_p.
              const irrep = m.irrep;
              const header = irrep && modeSet.modes[i - 1]?.irrep?.label !== irrep.label ? irrep : null;
              const irrepTotal = header
                ? isodistortAmplitudes(Math.hypot(...modeSet.modes.filter((x) => x.irrep?.label === header.label).map((x) => params.find((q) => q.id === x.id)?.value ?? 0)), cells)
                : null;
              return [
                header && irrepTotal ? (
                  <tr key={`${m.id}-irrep`} style={{ borderTop: `1px solid ${color.border}`, background: color.subtle }}>
                    <td colSpan={6} style={{ padding: "3px 8px", color: color.secondary }} title={`The parent's irrep at k = (${header.k.map((x) => +x.toFixed(4)).join(", ")})${header.direction ? `, order-parameter direction ${header.direction} in MATERIA's basis of the irrep` : ""}: its modes below, its total amplitude added in quadrature, as ISODISTORT reports one per irrep`}>
                      {header.label}{header.direction ? ` ${header.direction}` : ""} · k = ({header.k.map((x) => +x.toFixed(4)).join(", ")}) · total A_s {irrepTotal.as.toFixed(5)}, A_p {irrepTotal.ap.toFixed(5)}
                    </td>
                  </tr>
                ) : null,
                <tr
                  key={m.id}
                  onClick={() => onShowMode(shown ? null : m.id)}
                  title="Click to show/hide this mode's displacement pattern in the 3D model (green arrows, unit amplitude — the eigenvector, not the refined magnitude)"
                  style={{
                    borderTop: `1px solid ${color.border}`,
                    cursor: "pointer",
                    background: shown ? "rgba(22, 163, 74, 0.1)" : i === 0 ? "rgba(90, 130, 255, 0.06)" : "transparent",
                  }}
                >
                  <td style={{ padding: "3px 8px", color: shown ? "#15803d" : i === 0 ? color.primary : color.ink }}>
                    {shown ? "▸ " : ""}{m.label}
                  </td>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{(p?.value ?? 0).toFixed(5)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", color: color.secondary }}>{isodistortAmplitudes(p?.value ?? 0, cells).as.toFixed(5)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", color: color.secondary }}>{isodistortAmplitudes(p?.value ?? 0, cells).ap.toFixed(5)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", color: color.secondary }}>{esd !== undefined ? esd.toFixed(5) : "—"}</td>
                  <td style={{ padding: "3px 8px", color: color.secondary }}>{p?.fixed ? "fixed" : "free"}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: color.secondary }}>
        {modeSet.modes.some((m) => m.irrep)
          ? "Amplitudes are whole-cell displacement norms (Å) of the child's modes by parent irrep, each named by its irrep and the parent site it moves (generic irrep labels; an imported mode CIF keeps its own). Free/fix rows in the parameter panel (Positions group)."
          : modes?.fromActivation
          ? "Amplitudes are whole-cell displacement norms (Å) of the distortions the lowered group permits. Free/fix rows in the parameter panel (Positions group)."
          : modes
            ? "Amplitudes are whole-cell displacement norms (Å); mode 1 is the frozen distortion — its fitted amplitude is the order parameter. Free/fix rows in the parameter panel (Positions group)."
            : "Amplitudes are whole-cell displacement norms (Å), enumerated from the structure's own space group (symmetry-conserving Γ modes; rigid-translation gauge excluded). All seed at 0 — free the rows you want active in the parameter panel (Positions group), or load a parent CIF on the Subgroups page for the observed order-parameter decomposition."}
        {` A is over the conventional child cell (${cells.child} lattice point${cells.child === 1 ? "" : "s"}); ISODISTORT's A_s runs over the primitive child cell (A/√${cells.child}) and A_p = A_s·√(V_p/V_s) is normalized to the parent (A/√${cells.parent}).`}
        {" Click a row to draw the mode's eigenvector on the 3D model (green arrows)."}
      </p>
    </>
  );
}
