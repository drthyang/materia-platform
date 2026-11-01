/**
 * The PDF page's Subgroups view: where the symmetry is lowered, by one path —
 * pick a k-point, then a child, then Activate (subgroupPicker.ts holds the
 * rows). The modes the child permits load into the Positions group, and the
 * 3D Model view lists them as they refine.
 *
 *   - Γ and, for a centred parent, the decentring points that keep the
 *     conventional cell (X for F, H for I, …): the irreps of the loaded group
 *     and their isotropy subgroups, activated in the parent's cell
 *     (withActivatedMode).
 *   - The cell-multiplying stars of the supercell bound (default 2×2×2):
 *     their irreps from the irrep engine, one k-point at a time, a child
 *     realised in its own cell (withSupercellChild).
 *   - "By subgroup": the same-cell lattice (withSubgroup for a t-subgroup,
 *     withSameCellSubgroup for a decentring k- or general one) and, on
 *     request, the bound's cell-multiplying classes (withSupercellChild).
 *
 * Irreps carry generic labels: the k-point, "irrep n of m" (ADR 0004). While
 * a choice is in force only it is shown, with ✕ clear (withoutModes). Loading
 * a parent CIF or an ISODISTORT mode CIF lives in the 3D Model view's
 * Distortion modes row (Import ▾).
 */

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { ACTIVATION_KICK, type ModesInForce, type SupercellChoice } from "@/app/pdfPage";
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
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups, SubgroupSearchTooLarge, type SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import { color, fz, mono, resetRangeBtn } from "@/app/theme";
import { DEFAULT_BOUND, SUPERCELL_ACTIVATE_NOTE, SupercellBound, boundLabel, formatMatrix, latticeSummary } from "@/app/ui/SupercellView";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { SegmentedToggle } from "@/app/ui/SegmentedToggle";
import { chipName, decentringRows, kChips, sameCellRows, supercellLatticeChildren, supercellRows, type KChip, type PickerAction, type PickerChild, type PickerIrrep } from "@/app/ui/subgroupPicker";
import type { SymmetryOperation } from "@/core/crystal/types";

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

/** The name of a subgroup as the page lists it: the standard symbol and number, else the point group and index. */
export function subgroupName(identity: SubgroupIdentity): string {
  return identity.number !== undefined
    ? `${identity.hermannMauguin ?? "?"} #${identity.number}`
    : `${identity.pointGroup ?? "?"} (index ${identity.index})`;
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
  /** The parent's operations, for the supercell bound's chips and lattice; omitted, only the same-cell chips show. */
  readonly operations?: readonly SymmetryOperation[];
  readonly onActivateSameCell?: (node: SameCellNode) => void;
  /** A cell-multiplying child, realised in its own cell (withSupercellChild). */
  readonly onActivateSupercell?: (choice: SupercellChoice) => void;
  /** The choice in force, or null at the parent's own symmetry. */
  readonly modes: ModesInForce | null;
  /** How many of its modes refine (pageView.modeSet); null while Positions is on “Constrained atomic”. */
  readonly modeCount: number | null;
  readonly busy: boolean;
  readonly onActivateMode: (term: DisplaciveIrrepTerm, sub: IrrepSubgroup) => void;
  readonly onActivateSubgroup: (node: SubgroupNode) => void;
  /** Drop the choice: back to the parent's per-coordinate positions. */
  readonly onClear: () => void;
  /** Open the 3D Model view, where the modes are inspected. */
  readonly onOpenModel: () => void;
}

const line: CSSProperties = { margin: 0, fontSize: fz.micro, color: color.secondary, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
const listBox: CSSProperties = { border: `1px solid ${color.border}`, borderRadius: 6, overflowY: "auto" };
const childRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderTop: `1px solid ${color.subtle2}` };
/** Name and facts: one line on a wide card, the facts under the name on a phone; Activate stays at the right. */
const childText: CSSProperties = { display: "flex", alignItems: "baseline", columnGap: 8, rowGap: 0, flexWrap: "wrap", flex: "1 1 auto", minWidth: 0 };
const nameStyle: CSSProperties = { fontFamily: mono, fontSize: fz.micro, color: color.ink, minWidth: 130 };
const factStyle: CSSProperties = { fontFamily: mono, fontSize: fz.micro, color: color.secondary };
const blocked: CSSProperties = { opacity: 0.5, cursor: "not-allowed" };

export function SubgroupsPanel(props: Props): JSX.Element {
  const { modes, modeCount, busy, onClear, onOpenModel } = props;
  return (
    <div className="wb-subgroups" style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0, overflowY: "auto" }}>
      {modes ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 10px", borderRadius: 6, background: color.primaryTintBg, border: `1px solid ${color.primaryTintBorder}`, fontSize: fz.micro }}>
            <span style={{ color: color.primary, fontFamily: mono }}>
              {modes.fromActivation ? `▼ lowered to ${modes.parentName}` : `▼ decomposed against ${modes.parentName}`}
              {modes.ownCell ? " · in its own cell" : ""}
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
                style={{ ...resetRangeBtn, ...(busy ? blocked : {}) }}
                disabled={busy}
                onClick={onClear}
                title="Discard the distortion and return to the parent's symmetry and per-coordinate positions"
              >
                ✕ clear
              </button>
            </span>
          </div>
          <p style={line}>
            Clear to pick another child.
            <InfoBadge
              width={280}
              ariaLabel="Why clear first"
              text={`The k-points, irreps and subgroups are those of the parent${props.spaceGroup ? ` (${props.spaceGroup})` : ""}; the structure is now in the child's setting, where they would not match. ✕ clear returns to the parent; the fit's other values are kept.`}
            />
          </p>
        </>
      ) : (
        <Picker {...props} />
      )}
    </div>
  );
}

/** The cache key of a supercell chip's rows: the bound and the star. */
const rowsKey = (bound: SupercellSpec, chip: KChip): string => `${formatMatrix(bound.P)}|${bound.centring ?? "P"}|${chip.id}`;

function Picker({ spaceGroup, lattice, irrepTree, decentringTree = null, sameCell = [], operations, onActivateSameCell, onActivateSupercell, busy, onActivateMode, onActivateSubgroup }: Props): JSX.Element {
  const [view, setView] = useState<"irrep" | "subgroup">("irrep");
  const [bound, setBound] = useState<SupercellSpec>(DEFAULT_BOUND);
  const [chipId, setChipId] = useState("Γ");
  const [cache, setCache] = useState<ReadonlyMap<string, PickerIrrep[] | string>>(new Map());
  const [working, setWorking] = useState<string | null>(null);
  const workingRef = useRef<string | null>(null);
  const [superLattice, setSuperLattice] = useState<{ key: string; lattice: SupercellLattice | null; error: string | null } | null>(null);
  const [maxIndex, setMaxIndex] = useState(48);

  const fg = useMemo((): { group: FactorGroup | null; error: string | null } => {
    if (!operations || operations.length === 0) return { group: null, error: null };
    try {
      return { group: factorGroup(operations, bound), error: null };
    } catch (e) {
      return { group: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [operations, bound]);
  const chips = useMemo(() => kChips(decentringTree, fg.group), [decentringTree, fg.group]);
  const chip = chips.find((c) => c.id === chipId) ?? chips[0]!;

  /** Run a slow computation once the "working" state has painted; one at a time, a repeat click ignored. */
  const run = (key: string, f: () => void): void => {
    if (workingRef.current !== null) return;
    workingRef.current = key;
    setWorking(key);
    setTimeout(() => {
      try {
        f();
      } finally {
        workingRef.current = null;
        setWorking(null);
      }
    }, 20);
  };
  const pick = (c: KChip): void => {
    if (workingRef.current !== null) return;
    setChipId(c.id);
    const group = fg.group;
    if (c.source !== "supercell" || !group || !c.k) return;
    const key = rowsKey(bound, c);
    if (cache.has(key)) return;
    const k = c.k;
    run(c.id, () => {
      let rows: PickerIrrep[] | string;
      try {
        rows = supercellRows(group, k);
      } catch (e) {
        rows = e instanceof Error ? e.message : String(e);
      }
      setCache((m) => new Map(m).set(key, rows));
    });
  };
  const listSupercellLattice = (): void => {
    const group = fg.group;
    if (!group) return;
    const key = `${formatMatrix(bound.P)}|${bound.centring ?? "P"}|${maxIndex}`;
    run("lattice", () => {
      try {
        setSuperLattice({ key, lattice: supercellSubgroups(group, { maxIndex }), error: null });
      } catch (e) {
        setSuperLattice({ key, lattice: null, error: e instanceof SubgroupSearchTooLarge ? `Refused: ${e.message}.` : e instanceof Error ? e.message : String(e) });
      }
    });
  };

  const dispatch = (action: PickerAction): void => {
    if (action.kind === "irrep") onActivateMode(action.term, action.sub);
    else if (action.kind === "supercell") onActivateSupercell?.(action.choice);
  };

  const parent = spaceGroup ?? "the parent";
  // The rows of the chosen chip, or why there are none.
  let rows: PickerIrrep[] | null = null;
  let note: string | null = null;
  if (chip.source === "gamma") {
    if (irrepTree === null) note = `No Γ decomposition is available for ${parent}.`;
    else if (irrepTree.length === 0) note = "No symmetry-breaking Γ irrep carries an optic (non-translation) mode on these sites.";
    else rows = sameCellRows(irrepTree);
  } else if (chip.source === "decentring") {
    rows = decentringRows(decentringTree ?? [], chip);
  } else {
    const got = cache.get(rowsKey(bound, chip));
    if (typeof got === "string") note = got;
    else if (got) rows = got;
    else note = working === chip.id ? `Working out the irreps at ${chip.label}…` : `Pick ${chip.label} to list its irreps.`;
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 6, flexWrap: "wrap" }}>
        <SegmentedToggle
          options={[
            { id: "irrep", label: "By irrep", title: "Pick a k-point, then a child of one of its irreps" },
            { id: "subgroup", label: "By subgroup", title: "Pick a child from the subgroup lattice" },
          ]}
          value={view}
          onChange={setView}
        />
        {operations && operations.length > 0 && (
          <span style={{ marginLeft: "auto" }}>
            <SupercellBound value={bound} onChange={setBound} disabled={working !== null} />
          </span>
        )}
      </div>
      {fg.error && <p style={line}>Supercell: {fg.error}</p>}

      {view === "irrep" ? (
        <>
          <p style={line}>
            Pick a k-point, then a child, then Activate.
            <InfoBadge
              width={320}
              ariaLabel="How the k-points work"
              text={`Each k-point lists the irreps of ${parent} there and, under each, its isotropy subgroups: one child per order-parameter direction (Stokes & Hatch), named in the ITA standard setting. Same-cell points (Γ, and the decentring points of a centred parent) lower the symmetry in the parent's cell. Supercell points multiply the cell: the child is refined in its own cell, its positions as modes by parent irrep. Activate splits the Wyckoff orbits and puts the child's modes in the Positions group, the order parameter free from a ${ACTIVATION_KICK} Å start (at 0 the parent's symmetry makes χ² stationary along it). Irreps carry generic labels, "R irrep 8 of 10", not ISODISTORT's.`}
            />
          </p>
          <div role="group" aria-label="k-point" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {chips.map((c) => {
              const on = c.id === chip.id;
              const runningHere = working === c.id;
              return (
                <button
                  key={c.id}
                  aria-pressed={on}
                  aria-label={chipName(c)}
                  aria-busy={runningHere || undefined}
                  disabled={working !== null}
                  onClick={() => pick(c)}
                  title={c.sameCell ? "Children keep the parent's cell" : `Children multiply the cell (inside the ${boundLabel(bound)} bound); its irreps are worked out when you pick it`}
                  className="wb-kchip"
                  style={{
                    display: "inline-flex", alignItems: "baseline", gap: 6, padding: "4px 10px", borderRadius: 999, cursor: working !== null ? "wait" : "pointer",
                    border: `1px solid ${on ? color.primary : color.control}`, background: on ? color.primaryTintBg : "#fff",
                    color: on ? color.primary : color.ink, fontFamily: mono, fontSize: fz.micro,
                    ...(working !== null && !runningHere ? { opacity: 0.6 } : {}),
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{c.label}</span>
                  <span style={{ color: on ? color.primary : color.secondary }}>{runningHere ? "working…" : c.sameCell ? "same cell" : "supercell"}</span>
                </button>
              );
            })}
          </div>
          {note && <p style={line}>{note}</p>}
          {rows && (
            <IrrepList
              key={`${chip.id}|${rowsKey(bound, chip)}`}
              rows={rows}
              busy={busy}
              canActivate={(a) => a.kind === "irrep" || (a.kind === "supercell" && onActivateSupercell !== undefined)}
              onActivate={dispatch}
            />
          )}
        </>
      ) : (
        <SubgroupList
          parent={parent}
          lattice={lattice}
          sameCell={sameCell}
          busy={busy}
          onActivateSubgroup={onActivateSubgroup}
          {...(onActivateSameCell ? { onActivateSameCell } : {})}
          supercell={fg.group && onActivateSupercell ? {
            bound: boundLabel(bound),
            maxIndex,
            setMaxIndex,
            working: working === "lattice",
            disabled: working !== null,
            result: superLattice && superLattice.key === `${formatMatrix(bound.P)}|${bound.centring ?? "P"}|${maxIndex}` ? superLattice : null,
            group: fg.group,
            onList: listSupercellLattice,
            onActivate: onActivateSupercell,
          } : null}
        />
      )}
    </>
  );
}

/** One child's row: name, one line of facts, Activate. */
function ChildRow({ child, busy, canActivate, onActivate }: { child: PickerChild; busy: boolean; canActivate: boolean; onActivate: () => void }): JSX.Element {
  const a = child.action;
  return (
    <div style={childRow}>
      <span style={childText}>
        <span style={nameStyle} title={child.detail}>{child.name}</span>
        <span style={factStyle}>{child.facts}</span>
      </span>
      {a.kind === "elsewhere" ? (
        <span style={{ flex: "none", fontSize: fz.micro, color: color.secondary }}>{a.note}</span>
      ) : canActivate ? (
        <button
          style={{ ...resetRangeBtn, flex: "none", ...(busy ? blocked : {}) }}
          disabled={busy}
          onClick={onActivate}
          aria-label={`Activate ${child.name}`}
          title={busy ? "A fit is running" : a.kind === "supercell" ? SUPERCELL_ACTIVATE_NOTE : `Lower to ${child.name} in the parent's cell: the Wyckoff orbits split and its modes enter the Positions group, the order parameter free from a ${ACTIVATION_KICK} Å start.`}
        >
          Activate
        </button>
      ) : null}
    </div>
  );
}

/** The irreps of one k-point, each a collapsible group of children; all open when there are three or fewer. */
function IrrepList({ rows, busy, canActivate, onActivate }: { rows: readonly PickerIrrep[]; busy: boolean; canActivate: (a: PickerAction) => boolean; onActivate: (a: PickerAction) => void }): JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(rows.length <= 3 ? rows.map((r) => r.label) : rows.slice(0, 1).map((r) => r.label)));
  if (rows.length === 0) return <p style={line}>No irrep here carries a distortion of these sites.</p>;
  return (
    <div className="wb-grow-box" style={{ ...listBox, flex: "1 1 auto", minHeight: 120 }}>
      {rows.map((r) => {
        const isOpen = open.has(r.label);
        return (
          <div key={r.label} style={{ borderTop: `1px solid ${color.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: color.muted2 }}>
              <button
                aria-expanded={isOpen}
                onClick={() => setOpen((s) => {
                  const n = new Set(s);
                  if (n.has(r.label)) n.delete(r.label);
                  else n.add(r.label);
                  return n;
                })}
                style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "baseline", gap: 8, flex: "0 1 auto", minWidth: 0, fontFamily: mono, fontSize: fz.micro, color: color.ink, textAlign: "left" }}
              >
                <span style={{ color: color.secondary, width: 10, display: "inline-block" }}>{isOpen ? "▾" : "▸"}</span>
                <span style={{ fontWeight: 600 }}>{r.label}</span>
                <span style={{ color: color.secondary }}>{r.facts} · {r.children.length} {r.children.length === 1 ? "child" : "children"}</span>
              </button>
              <InfoBadge width={300} ariaLabel={`About ${r.label}`} text={r.detail} />
            </div>
            {isOpen && r.children.map((c, i) => (
              <ChildRow key={i} child={c} busy={busy} canActivate={canActivate(c.action)} onActivate={() => onActivate(c.action)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

type LatticeRow = { readonly t: SubgroupNode } | { readonly k: SameCellNode };

interface SupercellLatticeProps {
  readonly bound: string;
  readonly maxIndex: number;
  readonly setMaxIndex: (n: number) => void;
  readonly working: boolean;
  readonly disabled: boolean;
  readonly result: { readonly lattice: SupercellLattice | null; readonly error: string | null } | null;
  readonly group: FactorGroup;
  readonly onList: () => void;
  readonly onActivate: (choice: SupercellChoice) => void;
}

/** By subgroup: the same-cell lattice by index, then the bound's cell-multiplying classes on request. */
function SubgroupList({ parent, lattice, sameCell, busy, onActivateSubgroup, onActivateSameCell, supercell }: {
  parent: string;
  lattice: StructuralSubgroupTree;
  sameCell: readonly SameCellNode[];
  busy: boolean;
  onActivateSubgroup: (node: SubgroupNode) => void;
  onActivateSameCell?: (node: SameCellNode) => void;
  supercell: SupercellLatticeProps | null;
}): JSX.Element {
  const levels = useMemo(() => {
    const byIndex = new Map<number, LatticeRow[]>();
    const add = (index: number, row: LatticeRow): void => {
      const list = byIndex.get(index);
      if (list) list.push(row);
      else byIndex.set(index, [row]);
    };
    for (const n of subgroupClassRepresentatives(lattice)) if (!n.isParent && !n.isTrivial) add(n.index, { t: n });
    for (const n of sameCell) add(n.domainStates, { k: n });
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([index, nodes]) => ({ index, nodes }));
  }, [lattice, sameCell]);
  const tTypes = subgroupClassRepresentatives(lattice).filter((n) => !n.isParent && !n.isTrivial).length;
  const superChildren = supercell?.result?.lattice ? supercellLatticeChildren(supercell.group, supercell.result.lattice) : null;
  const activateTitle = (name: string): string => busy ? "A fit is running" : `Lower to ${name} in the parent's cell: the Wyckoff orbits split and its modes enter the Positions group, the order parameter free from a ${ACTIVATION_KICK} Å start.`;
  const activateBtn = (name: string, onClick: () => void): JSX.Element => (
    <button style={{ ...resetRangeBtn, flex: "none", ...(busy ? blocked : {}) }} disabled={busy} onClick={onClick} aria-label={`Activate ${name}`} title={activateTitle(name)}>
      Activate
    </button>
  );
  return (
    <>
      <p style={line}>
        Pick a subgroup, then Activate.
        <InfoBadge
          width={320}
          ariaLabel="About the subgroup lattice"
          text={`The subgroups of ${parent} that keep the conventional cell (${tTypes} translationengleiche types${sameCell.length > 0 ? `, and ${sameCell.length} decentring k- and general classes, marked k or general` : ""}), by index, each named in its standard setting; hover a name for its setting. Activating one splits the Wyckoff orbits and loads the modes it allows, the order parameter that lowers the structure to it free from a ${ACTIVATION_KICK} Å start. Subgroups with a larger cell are listed below, inside the supercell bound.`}
        />
      </p>
      <div className="wb-grow-box" style={{ ...listBox, flex: "1 1 auto", minHeight: 140 }}>
        {levels.map(({ index, nodes }) => (
          <div key={index}>
            <div style={{ position: "sticky", top: 0, padding: "3px 8px", background: color.subtle, borderTop: `1px solid ${color.border}`, fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
              index {index}
            </div>
            {nodes.map((row) => {
              if ("k" in row) {
                const n = row.k;
                const name = subgroupName(n.identity);
                return (
                  <div key={`k${n.classId}`} style={childRow}>
                    <span style={childText}>
                      <span style={nameStyle} title={settingNote(n.identity) ?? undefined}>{name}</span>
                      <span style={factStyle} title={`${n.kind === "k" ? "A decentring k-subgroup: the point group kept, centring translations lost" : "A general subgroup: point-group operations and centring translations lost"}, the conventional cell kept. Index ${n.domainStates} = ${n.index.t} (point group) · ${n.index.k} (translations); ${n.conjugates} orientation${n.conjugates === 1 ? "" : "s"}.`}>
                        {n.kind === "k" ? "k" : "general"} · {n.domainStates} domains
                      </span>
                    </span>
                    {onActivateSameCell && activateBtn(name, () => onActivateSameCell(n))}
                  </div>
                );
              }
              const n = row.t;
              const name = n.identity.number !== undefined ? subgroupName(n.identity) : `${n.pointGroup ?? "?"} (approx.)`;
              return (
                <div key={n.id} style={childRow}>
                  <span style={childText}>
                    <span style={nameStyle} title={settingNote(n.identity) ?? (n.identity.number === undefined ? "no tabulated setting matched: named by its point group only" : undefined)}>{name}</span>
                    <span style={factStyle} title={`${n.conjugates} orientation${n.conjugates === 1 ? "" : "s"} (conjugate subgroups), ${n.domainStates} domain states${n.identity.method === "conventional-cell" ? "; named in its own cell" : ""}.`}>
                      {n.domainStates} domains{n.identity.method === "conventional-cell" ? " · own setting" : ""}
                    </span>
                  </span>
                  {activateBtn(name, () => onActivateSubgroup(n))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {supercell && (
        <>
          <div style={line}>
            <span>Larger cells, inside the {supercell.bound} bound:</span>
            <button style={resetRangeBtn} disabled={supercell.disabled} onClick={supercell.onList} aria-busy={supercell.working || undefined}>
              {supercell.working ? "working…" : "List supercell subgroups"}
            </button>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              up to index
              <input type="number" min={1} value={supercell.maxIndex} onChange={(e) => supercell.setMaxIndex(Math.max(1, Number(e.target.value) || 1))} style={{ width: 56, fontSize: fz.micro }} />
            </label>
            {supercell.result?.lattice && (
              <InfoBadge width={300} align="right" ariaLabel="About the supercell lattice" text={`${latticeSummary(supercell.result.lattice)}. Only the cell-multiplying classes are listed here; the same-cell ones are above. Activate realises the child in its own cell.`} />
            )}
          </div>
          {supercell.result?.error && <p style={line}>{supercell.result.error}</p>}
          {superChildren && (
            <div className="wb-grow-box" style={{ ...listBox, maxHeight: 260 }}>
              {superChildren.map((c, i) => (
                <ChildRow key={i} child={c} busy={busy} canActivate onActivate={() => { if (c.action.kind === "supercell") supercell.onActivate(c.action.choice); }} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
