/**
 * The PDF page's distortion modes, under the 3D Model view: the modes being
 * refined, each amplitude with its esd and free/fixed state, the total |A|
 * and the acoustic combinations left out. Modes by parent irrep (a supercell
 * child, a decomposition, a mode CIF) are grouped under their irrep, with the
 * irrep's total A_s and A_p, as ISODISTORT reports them, and can be saved as
 * an ISODISTORT mode CIF. A row click draws that mode's eigenvector on the
 * model as green arrows. The symmetry the modes lower to is chosen on the
 * Subgroups page (SubgroupsPanel), which also clears it; this table only
 * names it. With no choice in force, Import ▾ loads one from a file: an
 * ISODISTORT mode CIF (withModeCif) or a parent CIF the loaded structure is
 * decomposed against (withParentModes) — the counterpart of Mode CIF ↓.
 */

import { useMemo, useRef, useState } from "react";
import type { ModesInForce } from "@/app/pdfPage";
import { isodistortAmplitudes, type DistortionModeSet } from "@/core/crystal/distortionModes";
import { latticeCentring } from "@/core/crystal/standardSetting";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { color, fz, mono, resetRangeBtn, uppercaseLabel } from "@/app/theme";
import { ShortLineText } from "@/app/ui/lineInfo";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { Chip } from "@/app/ui/Chip";
import { ALL_MODES, bulkFixed, modeGroups, modesTotal, selectedModes, type ModeFilter, type ModeGroups } from "@/app/ui/modeGroups";

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
  /** Decompose the loaded structure against a parent CIF (withParentModes); with onLoadModeCif, Import ▾ shows while no choice is in force. */
  readonly onLoadParentCif?: (file: File) => void;
  /** Load an ISODISTORT mode CIF (withModeCif). */
  readonly onLoadModeCif?: (file: File) => void;
  /** A fit is running: Import, Free all and Fix all wait. */
  readonly busy?: boolean;
  /**
   * The parameter panel's own row edit (the PDF page's onParamChange): Free all /
   * Fix all call it once per row of the group, as the Positions toggles do.
   * Absent: no bulk buttons.
   */
  readonly onParamChange?: (id: string, patch: Partial<RefinementParameter>) => void;
  /** The k-point and parent-site chips chosen (the page holds them for the 3D highlight); absent, the panel holds its own. */
  readonly filter?: ModeFilter;
  readonly onFilter?: (filter: ModeFilter) => void;
  /** Keep each row on one line (a wide panel beside the 3D view); a narrow one wraps them. */
  readonly oneLineRows?: boolean;
}

/** Import ▾: the two file loaders, opened inline (a popover would be clipped by the scrolling box). */
export function ImportMenu({ onLoadParentCif, onLoadModeCif, busy = false }: { onLoadParentCif: (file: File) => void; onLoadModeCif: (file: File) => void; busy?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const modeRef = useRef<HTMLInputElement | null>(null);
  const parentRef = useRef<HTMLInputElement | null>(null);
  const input = (ref: typeof modeRef, onFile: (file: File) => void, label: string): JSX.Element => (
    <input
      ref={ref}
      type="file"
      accept=".cif,text/plain"
      aria-label={label}
      disabled={busy}
      style={{ display: "none" }}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = "";
        setOpen(false);
      }}
    />
  );
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <button style={{ ...resetRangeBtn, ...(busy ? { opacity: 0.5, cursor: "not-allowed" } : {}) }} disabled={busy} aria-expanded={open} onClick={() => setOpen((o) => !o)} title={busy ? "A fit is running" : "Load distortion modes from a file"}>
        Import {open ? "▴" : "▾"}
      </button>
      {open && (
        <>
          <button style={resetRangeBtn} disabled={busy} onClick={() => modeRef.current?.click()}>Mode CIF (ISODISTORT)…</button>
          <button style={resetRangeBtn} disabled={busy} onClick={() => parentRef.current?.click()}>Parent CIF (decompose this structure)…</button>
          <InfoBadge
            width={320}
            align="right"
            ariaLabel="About importing modes"
            text={<>
              <b>Mode CIF:</b> an ISODISTORT distortion-mode CIF (ISODISTORT&apos;s own, or one saved with Mode CIF ↓): its child and displacive modes, the amplitudes as the file gives them. With its parent loaded, the child is fitted in its own cell; with its child loaded, the modes go on it.<br />
              <b>Parent CIF:</b> for a loaded structure that is already the distorted child, in the parent&apos;s cell or a supercell: its distortion from the high-symmetry parent as modes by parent irrep, seeded to reproduce it exactly.
            </>}
          />
          {input(modeRef, onLoadModeCif, "mode CIF file")}
          {input(parentRef, onLoadParentCif, "parent CIF file")}
        </>
      )}
    </span>
  );
}

export function DistortionModesPanel({ modeSet, modes, params, result, spaceGroup, ownModes, shownModeId, onShowMode, onOpenSubgroups, onExportModeCif, onLoadParentCif, onLoadModeCif, busy = false, onParamChange, filter: heldFilter, onFilter, oneLineRows = false }: Props): JSX.Element {
  const groups = useMemo(() => (modeSet ? modeGroups(modeSet) : null), [modeSet]);
  const [ownFilter, setOwnFilter] = useState<ModeFilter>(ALL_MODES);
  const setFilter = onFilter ?? setOwnFilter;
  // A chip no longer offered (another mode set) reads as "all".
  const asked = heldFilter ?? ownFilter;
  const filter: ModeFilter = {
    k: asked.k !== null && groups?.ks.some((g) => g.id === asked.k) ? asked.k : null,
    site: asked.site !== null && groups?.sites.some((g) => g.id === asked.site) ? asked.site : null,
  };
  // Import ▾ while no choice is in force (a choice set aside by the atomic switch counts: it comes back on the flip).
  const importMenu = !modes && onLoadParentCif && onLoadModeCif ? <ImportMenu onLoadParentCif={onLoadParentCif} onLoadModeCif={onLoadModeCif} busy={busy} /> : null;
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
        {toSubgroups(modes ? "Change or clear the symmetry these modes lower to, on the Subgroups page" : "Lower the symmetry on the Subgroups page: pick a subgroup there")}
        {importMenu}
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
  // One line under the table, the rest behind its "?" (UI text only; no agent reads it).
  const byIrrep = modeSet.modes.some((m) => m.irrep);
  const captionLine = !modes && !byIrrep
    ? "A: mode amplitude (Å), all start at 0 · free/fix in Positions · click a row to show it in 3D"
    : modes && !modes.fromActivation && !byIrrep
      ? "A: mode amplitude (Å); mode 1 is the order parameter · free/fix in Positions · click a row to show it in 3D"
      : "A: mode amplitude (Å) · free/fix in Positions · click a row to show it in 3D";
  const captionDetail = [
    byIrrep
      ? "A is the whole-cell displacement norm of each of the child's modes by parent irrep, named by its irrep and the parent site it moves (generic irrep labels; an imported mode CIF keeps its own)."
      : modes?.fromActivation
        ? "A is the whole-cell displacement norm of each distortion the lowered group permits."
        : modes
          ? "A is the whole-cell displacement norm; mode 1 is the frozen distortion, so its fitted amplitude is the order parameter."
          : "A is the whole-cell displacement norm of the structure's own symmetry-conserving Γ modes (rigid-translation gauge excluded). Free the rows you want in the parameter panel (Positions group), or Import ▾ → Parent CIF for the order-parameter decomposition of a structure loaded already distorted.",
    `A is over the conventional child cell (${cells.child} lattice point${cells.child === 1 ? "" : "s"}); ISODISTORT's A_s = A/√${cells.child} (primitive child cell) and A_p = A_s·√(V_p/V_s) = A/√${cells.parent} (parent).`,
    "A row click draws the mode's eigenvector on the 3D model (green arrows, unit amplitude).",
  ];
  const g = groups!;
  const rows = selectedModes(modeSet, g, filter);
  const kChip = filter.k !== null ? g.ks.find((x) => x.id === filter.k) ?? null : null;
  const site = filter.site !== null ? g.sites.find((x) => x.id === filter.site) ?? null : null;
  const chips = g.ks.length > 0 || g.sites.length > 0;
  // Clicking a chip again goes back to "all"; a row drawn as arrows that the new choice hides is put away.
  const choose = (next: ModeFilter): void => {
    setFilter(next);
    if (shownModeId !== null && !selectedModes(modeSet, g, next).some((m) => m.id === shownModeId)) onShowMode(null);
  };
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
        {toSubgroups(modes ? "The symmetry these modes lower to is chosen on the Subgroups page — change or clear it there" : "Lower the symmetry on the Subgroups page: pick a subgroup there")}
        {importMenu}
        {onExportModeCif && (
          <button style={resetRangeBtn} onClick={onExportModeCif} title="Save the child and these modes, at their current amplitudes, as an ISODISTORT mode CIF (ISODISTORT's tags, A_s values and normfactors; MATERIA's generic irrep labels). It reads back here exactly, and ISODISTORT-aware programs such as GSAS-II read its modes.">
            Mode CIF ↓
          </button>
        )}
      </div>
      {chips && (
        <ModeChips
          groups={g}
          filter={filter}
          kChip={kChip}
          site={site}
          rows={rows}
          params={params}
          cells={cells}
          busy={busy}
          onChoose={choose}
          {...(onParamChange ? { onParamChange } : {})}
        />
      )}
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
            {rows.map((m, j) => {
              const i = modeSet.modes.indexOf(m);
              const p = params.find((q) => q.id === m.id);
              const esd = result?.esd[m.id] ?? p?.esd;
              const shown = m.id === shownModeId;
              // Modes by parent irrep: a header row where the irrep changes, with the irrep's total A_s and A_p
              // (over all its modes, whatever the site chip; the site's part follows when one is chosen).
              const irrep = m.irrep;
              const header = irrep && rows[j - 1]?.irrep?.label !== irrep.label ? irrep : null;
              const members = header ? modeSet.modes.filter((x) => x.irrep?.label === header.label) : [];
              const irrepTotal = header ? isodistortAmplitudes(Math.hypot(...members.map((x) => params.find((q) => q.id === x.id)?.value ?? 0)), cells) : null;
              const sitePart = header && site && members.some((x) => !rows.includes(x)) ? modesTotal(rows.filter((x) => x.irrep?.label === header.label), params, cells) : null;
              return [
                header && irrepTotal ? (
                  <tr key={`${m.id}-irrep`} style={{ borderTop: `1px solid ${color.border}`, background: color.subtle }}>
                    <td colSpan={6} style={{ padding: "3px 8px", color: color.secondary, ...(oneLineRows ? { whiteSpace: "nowrap" } : {}) }} title={`The parent's irrep at k = (${header.k.map((x) => +x.toFixed(4)).join(", ")})${header.direction ? `, order-parameter direction ${header.direction} in MATERIA's basis of the irrep` : ""}: its modes below, its total amplitude added in quadrature, as ISODISTORT reports one per irrep`}>
                      {header.label}{header.direction ? ` ${header.direction}` : ""} · total A_s {irrepTotal.as.toFixed(5)}, A_p {irrepTotal.ap.toFixed(5)}
                      {sitePart && site ? ` · ${site.label} A_s ${sitePart.as.toFixed(5)}` : ""}
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
                  <td style={{ padding: "3px 8px", ...(oneLineRows ? { whiteSpace: "nowrap" } : {}), color: shown ? "#15803d" : i === 0 ? color.primary : color.ink }}>
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
        <ShortLineText text={captionLine} detail={captionDetail} width={340} />
      </p>
    </>
  );
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const chipRow = { display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap", overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2, flex: "0 1 auto", minWidth: 0, maxWidth: "100%" } as const;
const chipGroup = { display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" } as const;

/**
 * The chips over the mode table: the k-points of the modes in force (with the
 * parent cells one arm's wave repeats over), then their parent sites, then one
 * line for the rows chosen: their total, how many are free, and Free all / Fix
 * all for exactly those rows. Each chip row scrolls sideways on a phone.
 */
function ModeChips({ groups, filter, kChip, site, rows, params, cells, busy, onChoose, onParamChange }: {
  groups: ModeGroups;
  filter: ModeFilter;
  kChip: ModeGroups["ks"][number] | null;
  site: ModeGroups["sites"][number] | null;
  rows: readonly DistortionModeSet["modes"][number][];
  params: readonly RefinementParameter[];
  cells: { readonly child: number; readonly parent: number };
  busy: boolean;
  onChoose: (filter: ModeFilter) => void;
  onParamChange?: (id: string, patch: Partial<RefinementParameter>) => void;
}): JSX.Element {
  const total = modesTotal(rows, params, cells);
  const inK = (id: string): boolean => !kChip || kChip.modeIds.includes(id);
  const inSite = (id: string): boolean => !site || site.modeIds.includes(id);
  const free = rows.filter((m) => params.find((p) => p.id === m.id)?.fixed === false).length;
  const scope = [kChip?.label, site?.label].filter(Boolean).join(" · ") || "All modes";
  // Behind the "?": the chosen k-point's total on each of its sites, or the chosen site's at each k-point.
  const ksOf = (ids: ReadonlySet<string>) => groups.ks.filter((k) => k.modeIds.some((id) => ids.has(id)));
  const inRows = new Set(rows.map((m) => m.id));
  const part = (ids: readonly string[]) => modesTotal(rows.filter((m) => ids.includes(m.id)), params, cells);
  const breakdown = site && !kChip
    ? ksOf(inRows).map((k) => `${k.label}: A_s ${part(k.modeIds).as.toFixed(5)} Å`)
    : groups.sites.filter((s) => s.modeIds.some((id) => inRows.has(id))).map((s) => `${s.label}: A_s ${part(s.modeIds).as.toFixed(5)} Å`);
  const detail = [
    `${scope}: ${plural(rows.length, "mode")}, ${free} free. Totals add the amplitudes in quadrature, as each irrep's total does: A = ${total.a.toFixed(5)} Å over the conventional child cell, A_s = A/√${cells.child}, A_p = A/√${cells.parent}.`,
    ...(breakdown.length > 1 ? [`By ${site && !kChip ? "k-point" : "site"}: ${breakdown.join(" · ")}.`] : []),
    "The k chips are the k-points of the modes in force, with the parent cells one arm's wave repeats over (×2); the site chips are the parent's sites they move (element, with the Wyckoff site when the element has several). A site chip highlights its atoms in the 3D model.",
    ...(onParamChange ? ["Free all / Fix all set exactly these rows, as their toggles in Positions do."] : []),
  ];
  const bulk = (fixed: boolean): void => {
    if (!onParamChange) return;
    for (const c of bulkFixed(rows, params, fixed)) onParamChange(c.id, { fixed: c.fixed });
  };
  const btn = (fixed: boolean): JSX.Element => {
    const would = rows.filter((m) => params.find((p) => p.id === m.id)?.fixed === !fixed).length;
    const off = busy || would === 0;
    return (
      <button
        type="button"
        style={{ ...resetRangeBtn, ...(off ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
        disabled={off}
        onClick={() => bulk(fixed)}
        title={busy ? "A fit is running" : `${fixed ? "Fix" : "Free"} the ${plural(rows.length, "mode")} listed (${scope})`}
      >
        {fixed ? "Fix all" : "Free all"}
      </button>
    );
  };
  return (
    <>
      {/* The chips (k-points, then sites), then the line for the rows chosen: one line on a wide panel; on a phone the chips take their own row and scroll sideways. A chip that would list no row is off. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 2, marginTop: 4 }}>
      <div style={chipRow}>
        {groups.ks.length > 0 && (
          <div role="group" aria-label="k-point" className="wb-kchips" style={chipGroup}>
            <Chip on={filter.k === null} label="all k" aria="all k-points" onClick={() => onChoose({ ...filter, k: null })} />
            {groups.ks.map((k) => {
              const n = k.cellMultiple;
              const t = modesTotal(k.modeIds.map((id) => ({ id })), params, cells);
              const empty = filter.k !== k.id && !k.modeIds.some((id) => inSite(id));
              return (
                <Chip
                  key={k.id}
                  on={filter.k === k.id}
                  disabled={empty}
                  label={<>{k.label}{n !== null && n > 1 ? <span style={{ color: color.secondary }}> ×{n}</span> : null}</>}
                  aria={`${k.label}, ${n === null ? "k-point" : n === 1 ? "same cell" : `supercell ×${n}`}`}
                  title={`${k.label}${k.k ? ` (k = (${k.k.map((x) => +x.toFixed(4)).join(", ")}))` : ""}: ${plural(k.modeIds.length, "mode")}, total A_s ${t.as.toFixed(5)} Å${n !== null && n > 1 ? ` · one arm's wave repeats over ${n} parent cells` : ""}${empty && site ? ` · none on ${site.label}` : ""}`}
                  onClick={() => onChoose({ ...filter, k: filter.k === k.id ? null : k.id })}
                />
              );
            })}
          </div>
        )}
        {groups.ks.length > 0 && groups.sites.length > 0 && <span aria-hidden style={{ flex: "0 0 auto", width: 1, alignSelf: "stretch", background: color.border, margin: "2px 2px" }} />}
        {groups.sites.length > 0 && (
          <div role="group" aria-label="parent site" className="wb-kchips" style={chipGroup}>
            <Chip on={filter.site === null} label="all sites" aria="all sites" onClick={() => onChoose({ ...filter, site: null })} />
            {groups.sites.map((s) => {
              const empty = filter.site !== s.id && !s.modeIds.some((id) => inK(id));
              return (
                <Chip
                  key={s.id}
                  on={filter.site === s.id}
                  disabled={empty}
                  label={s.label}
                  aria={s.label}
                  title={`${s.label}: ${s.title}, ${plural(s.modeIds.length, "mode")}; highlighted in the 3D model${empty && kChip ? ` · no ${kChip.label} mode moves it` : ""}`}
                  onClick={() => onChoose({ ...filter, site: filter.site === s.id ? null : s.id })}
                />
              );
            })}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: fz.micro }}>
        <span style={{ fontFamily: mono, color: color.ink }}>
          <ShortLineText text={`${scope}: A_s ${total.as.toFixed(5)} Å, A_p ${total.ap.toFixed(5)} Å · ${free}/${rows.length} free`} detail={detail} width={340} />
        </span>
        {onParamChange && <span style={{ display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}>{btn(false)}{btn(true)}</span>}
      </div>
      </div>
    </>
  );
}
