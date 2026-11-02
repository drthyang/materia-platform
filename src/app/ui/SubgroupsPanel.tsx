/**
 * The PDF page's Subgroups view ("Lower the symmetry"): one list of the
 * subgroups whose cell fits the supercell, from high to low symmetry, and the
 * selected one's detail with Activate (subgroupList.ts merges and filters the
 * rows of subgroupPicker.ts; SubgroupDetail.tsx is the detail). Simple by
 * default: the supercell, a name search, the k-point chips and a short list
 * (the top index levels, "Show more" and "show all" under it); the cell, how
 * a subgroup is reached, the index cap and the strain-only subgroups (hidden)
 * sit behind "Filters".
 *
 *   - The same-cell rows show at once; the larger cells are worked out in a
 *     Web Worker after the view shows (supercellListingClient.ts), streaming
 *     in under a progress line with stop, the supercell held, one run at a
 *     time, the result kept for the structure and bound. The worker also hands
 *     back the lattice as a graph (the tree, the lattice steps) and every
 *     star's irreps, so the page's cache has them for Activate.
 *   - List | Tree: the tree expands from the parent one maximal step at a time.
 *   - On a narrow panel (a phone) a row opens its detail as a full-screen
 *     sheet with Back.
 *
 * Irreps carry generic labels: the k-point, "irrep n of m" (ADR 0004); the
 * rows' tags write them "R·8". While a choice is in force the banner states
 * it, with its cell, ✕ clear and 3D Model →; the list and the detail stay,
 * Activate waiting for ✕ clear. Loading a parent CIF or an ISODISTORT mode
 * CIF lives in the 3D Model view's Distortion modes row (Import ▾).
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ModesInForce, SupercellChoice } from "@/app/pdfPage";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import { decomposeDisplacementRepresentation, type DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import type { DisplacementField, SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { irrepIsotropySubgroups, irrepEngine, type IsotropySubgroup } from "@/core/crystal/isotropySubgroups";
import { formatBasis, latticeCentring } from "@/core/crystal/standardSetting";
import type { StructuralSubgroupTree, SubgroupNode } from "@/core/crystal/subgroupTree";
import { decentringTerms } from "@/core/crystal/decentringModes";
import { identifySubgroup } from "@/core/crystal/isotropyTree";
import { sameCellSubgroups, type SameCellSubgroup } from "@/core/crystal/irreps/sameCellLattice";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import type { KStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { boxOfVectors } from "@/core/crystal/irreps/childSetting";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import { color, fz, mono, resetRangeBtn, uppercaseLabel } from "@/app/theme";
import { DEFAULT_BOUND, SupercellBound, boundLabel, formatMatrix } from "@/app/ui/SupercellView";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { chipName, kChips, sameCellGraph, sameCellListing, type LatticeCounts, type PickerAction, type SubgroupRow } from "@/app/ui/subgroupPicker";
import {
  DEFAULT_FILTERS, NO_FILTERS, childrenOf, collapseTies, compactName, foldedFiltersSet, groupRows, rowPasses, searched, setLine, shortList, shortName, starShort, tagOf, visibleGroups,
  type GraphNode, type ListFilters, type ReachKind, type RowGroup, type ShortList, type ShownGroup,
} from "@/app/ui/subgroupList";
import { SubgroupDetail } from "@/app/ui/SubgroupDetail";
import { startSupercellListing, type ListingJob } from "@/app/ui/supercellListingClient";

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

/**
 * Where a choice in force lives, for the banner: " · in its own cell, 1×1×2"
 * for a child realised in its own cell (the parent-axes box of its lattice,
 * from its basis P_H and its centring), " · in the parent's cell" for one
 * lowered there.
 */
export function modesCellNote(modes: ModesInForce): string {
  const P = modes.set.parent?.basis;
  if (modes.ownCell && P) {
    const cols = [0, 1, 2].map((j) => [P[0][j]!, P[1][j]!, P[2][j]!]);
    const centring = latticeCentring(modes.set.parentized.spaceGroup.operations).filter((c) => c.some((x) => Math.abs(x) > 1e-9));
    const extra = centring.map((c) => [0, 1, 2].map((i) => P[i]![0]! * c[0] + P[i]![1]! * c[1] + P[i]![2]! * c[2]));
    return ` · in its own cell, ${boxOfVectors([...cols, ...extra]).join("×")}`;
  }
  if (modes.ownCell) return " · in its own cell";
  return modes.fromActivation ? " · in the parent's cell" : "";
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
  /** The parent's operations: the subgroups, irreps and supercell bound are worked out from them. */
  readonly operations?: readonly SymmetryOperation[];
  /** The loaded structure: which irreps its atoms carry (a row's notes, the order of its coupled sets, its mode count). */
  readonly structure?: StructureModel;
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
const cardBox: CSSProperties = { border: `1px solid ${color.border}`, borderRadius: 10, background: color.surface, minHeight: 0, minWidth: 0 };
const nameStyle: CSSProperties = { fontFamily: mono, fontSize: fz.micro, color: color.ink, whiteSpace: "nowrap" };
const factStyle: CSSProperties = { fontFamily: mono, fontSize: fz.micro, color: color.secondary, whiteSpace: "nowrap" };
const blocked: CSSProperties = { opacity: 0.5, cursor: "not-allowed" };
/** Below this width the panel is one column and a row's detail opens as a full-screen sheet. */
const TWO_COLUMNS = 720;

export function SubgroupsPanel(props: Props): JSX.Element {
  const { modes, modeCount, busy, onClear, onOpenModel } = props;
  // The row whose child is in force, as activated here (the banner's subgroup in the list).
  const [activeKey, setActiveKey] = useState<string | null>(null);
  useEffect(() => {
    if (!modes) setActiveKey(null);
  }, [modes]);
  const banner = modes ? (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 10px", borderRadius: 6, background: color.primaryTintBg, border: `1px solid ${color.primaryTintBorder}`, fontSize: fz.micro }}>
      <span style={{ color: color.primary, fontFamily: mono }}>
        {modes.fromActivation ? `▼ lowered to ${modes.parentName}` : `▼ decomposed against ${modes.parentName}`}
        {modesCellNote(modes)}
      </span>
      <span style={{ color: color.secondary }}>
        {modeCount === null
          ? "set aside while Positions is on “Constrained atomic” — flip it to “Irreps (modes)” to refine them"
          : `${modeCount} distortion mode${modeCount === 1 ? "" : "s"} in the Positions group — free the rows to refine`}
      </span>
      <InfoBadge
        width={280}
        ariaLabel="Why clear first"
        text={`The subgroups listed are those of the parent${props.spaceGroup ? ` (${props.spaceGroup})` : ""}; the structure is now in the child's setting, where they would not match. ✕ clear returns to the parent (the fit's other values are kept), then pick another.`}
      />
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
  ) : null;
  return (
    <div className="wb-subgroups" style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0, overflowY: "auto" }}>
      {banner}
      <Picker {...props} activeKey={activeKey} onActivated={setActiveKey} banner={banner} />
    </div>
  );
}

// ── what the views compute, kept across mounts ──────────────────────────────

const boundGroups = new WeakMap<readonly SymmetryOperation[], Map<string, { group: FactorGroup | null; error: string | null }>>();
const boundKey = (bound: SupercellSpec): string => `${formatMatrix(bound.P)}|${bound.centring ?? "P"}`;

/** The bound's factor group G/T″, once per operation list and bound (so the caches keyed by it last). */
function boundGroup(ops: readonly SymmetryOperation[] | undefined, bound: SupercellSpec): { group: FactorGroup | null; error: string | null } {
  if (!ops || ops.length === 0) return { group: null, error: null };
  let byBound = boundGroups.get(ops);
  if (!byBound) {
    byBound = new Map();
    boundGroups.set(ops, byBound);
  }
  const key = boundKey(bound);
  let hit = byBound.get(key);
  if (!hit) {
    try {
      hit = { group: factorGroup(ops, bound), error: null };
    } catch (e) {
      hit = { group: null, error: e instanceof Error ? e.message : String(e) };
    }
    byBound.set(key, hit);
  }
  return hit;
}

/** The cell-multiplying part: its rows, what the summary says of the lattice and the lattice as a graph, or why there are none. */
type SupercellPart = { readonly rows: readonly SubgroupRow[]; readonly counts: LatticeCounts; readonly graph: readonly GraphNode[] | null } | { readonly error: string };
const supercellParts = new WeakMap<FactorGroup, WeakMap<object, SupercellPart>>();
const NO_STRUCTURE = {};
const partOf = (group: FactorGroup, structure: StructureModel | undefined): SupercellPart | undefined => supercellParts.get(group)?.get(structure ?? NO_STRUCTURE);
function keepPart(group: FactorGroup, structure: StructureModel | undefined, part: SupercellPart): void {
  let byStructure = supercellParts.get(group);
  if (!byStructure) {
    byStructure = new WeakMap();
    supercellParts.set(group, byStructure);
  }
  byStructure.set(structure ?? NO_STRUCTURE, part);
}

/**
 * The same-cell rows (sameCellListing), or why there are none. Kept per
 * structure from the parent's own state (the Γ tree there): while a choice is
 * in force the page has no Γ tree, and the rows stay the ones the user picked
 * from.
 */
const sameParts = new WeakMap<object, { readonly rows: readonly SubgroupRow[]; readonly error: string | null }>();
function sameCellPart(o: Parameters<typeof sameCellListing>[0], pristine: boolean): { readonly rows: readonly SubgroupRow[]; readonly error: string | null } {
  const key = o.structure ?? o.operations;
  const kept = sameParts.get(key);
  if (kept && !pristine) return kept;
  let part: { rows: readonly SubgroupRow[]; error: string | null };
  try {
    part = { rows: sameCellListing(o), error: null };
  } catch (e) {
    part = { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
  if (pristine || !kept) sameParts.set(key, part);
  return part;
}

/** The panel's width, followed as it changes; 0 until measured (and where nothing measures, as in a test DOM). */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const obs = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    obs.current = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    obs.current.observe(el);
  }, []);
  return [ref, width];
}

function Chip({ on, label, aria, title, disabled, onClick }: { on: boolean; label: ReactNode; aria: string; title?: string; disabled?: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={aria}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="wb-kchip"
      style={{
        flex: "0 0 auto", border: `1px solid ${on ? color.primary : color.control}`, background: on ? color.primaryTintBg : color.surface, color: on ? color.primary : color.ink,
        borderRadius: 999, padding: "3px 10px", fontSize: fz.micro, fontFamily: mono, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function Segments<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { readonly id: T; readonly label: string }[]; onChange: (v: T) => void; label: string }): JSX.Element {
  return (
    <span role="group" aria-label={label} style={{ display: "inline-flex", border: `1px solid ${color.control}`, borderRadius: 7, overflow: "hidden", flex: "0 0 auto" }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          style={{ border: "none", padding: "3px 10px", fontSize: fz.micro, cursor: "pointer", background: value === o.id ? color.ink : color.surface, color: value === o.id ? "#fff" : color.ink, whiteSpace: "nowrap" }}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * A merged row in the list (or a node in the tree): name #IT · cell · domains · tag, in one plain line. The tag
 * names the irreps of one variant, its first reaching set (what its Activate kicks): the variant picked in the
 * detail when this row is selected, else the first one the filters keep.
 */
function RowLine({ g, variant, selected, active, onPick, lead, trail, dim }: { g: ShownGroup; variant?: SubgroupRow; selected: boolean; active: boolean; onPick: () => void; lead?: ReactNode; trail?: ReactNode; dim?: boolean }): JSX.Element {
  const first = variant ?? g.shown[0]!;
  const tied = collapseTies(first.reach.sets)[0];
  const coupled = first.reach.kind === "coupled";
  return (
    <div
      role="button"
      tabIndex={0}
      data-row={g.group.key}
      aria-pressed={selected}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", cursor: "pointer", minWidth: 0, overflow: "hidden",
        background: selected ? color.primaryTintBg : "transparent", borderLeft: `3px solid ${selected ? color.primary : "transparent"}`,
        borderTop: `1px solid ${color.subtle2}`, opacity: dim ? 0.45 : 1,
      }}
    >
      {lead}
      <span style={{ ...nameStyle, fontWeight: selected ? 600 : 400 }}>{compactName(g.group.name)}</span>
      <span style={factStyle}>· {g.group.cell}</span>
      <span style={factStyle}>· {g.group.domains} dom</span>
      {active ? <span style={{ ...factStyle, color: color.primary }}>· active</span> : null}
      {trail}
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
        {first.modes === 0 ? <span style={{ ...factStyle, color: color.faint }}>strain only</span> : null}
        {tied ? (
          <span
            title={`${setLine(tied)}${coupled ? ", coupled" : ""}`}
            style={{ fontFamily: mono, fontSize: 11, padding: "0 6px", borderRadius: 999, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", border: `1px ${coupled ? "dashed" : "solid"} ${color.primaryTintBorder}`, background: coupled ? color.surface : color.primaryTintBg, color: color.primary }}
          >
            {tagOf(tied)}
          </span>
        ) : <span style={{ ...factStyle, color: color.faint }}>—</span>}
        {g.shown.length > 1 ? <span style={{ ...factStyle, color: color.faint }} title={`${g.shown.length} variants: the same name, cell and domains, reached by other irreps`}>×{g.shown.length}</span> : null}
      </span>
    </div>
  );
}

type PickerProps = Props & { readonly activeKey: string | null; readonly onActivated: (key: string) => void; readonly banner: ReactNode };

function Picker({ spaceGroup, lattice, irrepTree, decentringTree = null, sameCell = [], operations, structure, onActivateSameCell, onActivateSupercell, busy, onActivateMode, onActivateSubgroup, modes, activeKey, onActivated, banner }: PickerProps): JSX.Element {
  const ops = operations ?? structure?.spaceGroup.operations;
  const [bound, setBound] = useState<SupercellSpec>(DEFAULT_BOUND);
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  // How many index levels show, for these filters and this supercell; the default (one step) otherwise.
  const [more, setMore] = useState<{ readonly filters: ListFilters; readonly bound: SupercellSpec; readonly levels: number | "all" } | null>(null);
  const [view, setView] = useState<"list" | "tree">("list");
  const [selected, setSelected] = useState<{ readonly group: string; readonly row: string | null } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(["p"]));
  const [activating, setActivating] = useState<string | null>(null);
  // The larger cells' listing: one run at a time, its progress, stop.
  const workingRef = useRef(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const jobRef = useRef<ListingJob | null>(null);
  const [stoppedFor, setStoppedFor] = useState<FactorGroup | null>(null);
  const [streamed, setStreamed] = useState<{ readonly group: FactorGroup; readonly rows: readonly SubgroupRow[] } | null>(null);
  const [graphFor, setGraphFor] = useState<{ readonly group: FactorGroup; readonly nodes: readonly GraphNode[] } | null>(null);
  const [measure, width] = useWidth();
  // A newly picked subgroup's detail opens at its top.
  const detailBox = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (detailBox.current) detailBox.current.scrollTop = 0;
  }, [selected?.group]);
  const wide = width === 0 || width >= TWO_COLUMNS;

  const fg = useMemo(() => boundGroup(ops, bound), [ops, bound]);
  const pristine = modes === null;
  const same = useMemo(
    () => (ops && ops.length > 0 ? sameCellPart({ operations: ops, ...(structure ? { structure } : {}), tTree: lattice, gammaTree: irrepTree, decentringTree, kNodes: sameCell }, pristine) : { rows: [], error: null }),
    [ops, structure, lattice, irrepTree, decentringTree, sameCell, pristine],
  );
  const sameGraph = useMemo(() => (ops && ops.length > 0 ? sameCellGraph(ops) : null), [ops]);
  const part = fg.group ? partOf(fg.group, structure) : undefined;

  const [done, setDone] = useState(0);
  useEffect(() => {
    const group = fg.group;
    if (!group || !ops || partOf(group, structure) || stoppedFor === group || workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    setStreamed(null);
    const label = boundLabel(bound);
    setProgress(`listing ${label} subgroups…`);
    let graph: readonly GraphNode[] | null = null;
    const finish = (job: ListingJob): void => {
      workingRef.current = false;
      if (jobRef.current === job) jobRef.current = null;
      setWorking(false);
      setProgress("");
      setStreamed(null);
      setDone((n) => n + 1);
    };
    const job: ListingJob = startSupercellListing({ operations: ops, bound, boundLabel: label, ...(structure ? { structure } : {}) }, group, {
      progress: (percent) => setProgress(`listing ${label} subgroups… ${percent} %`),
      rows: (rows) => setStreamed({ group, rows }),
      graph: (nodes) => {
        graph = nodes;
        setGraphFor({ group, nodes });
      },
      done: (rows, counts) => {
        keepPart(group, structure, { rows, counts, graph });
        finish(job);
      },
      error: (message) => {
        keepPart(group, structure, { error: message });
        finish(job);
      },
    });
    jobRef.current = job;
  }, [fg.group, ops, structure, stoppedFor, done, bound]);
  const halt = (): void => {
    const job = jobRef.current;
    if (!job) return;
    job.stop();
    jobRef.current = null;
    workingRef.current = false;
    setWorking(false);
    setProgress("");
    setStreamed(null);
  };
  useEffect(() => () => halt(), [fg.group, structure]);
  const stop = (): void => {
    setStoppedFor(fg.group);
    halt();
  };

  // The rows, merged and filtered.
  const superRows = part && "rows" in part ? part.rows : streamed && streamed.group === fg.group ? streamed.rows : null;
  const allRows = useMemo(() => [...same.rows, ...(superRows ?? [])], [same.rows, superRows]);
  const groups = useMemo(() => groupRows(allRows), [allRows]);
  const visible = useMemo(() => visibleGroups(groups, filters), [groups, filters]);
  const levels = more && more.filters === filters && more.bound === bound ? more.levels : null;
  const short = useMemo(() => shortList(visible, levels), [visible, levels]);
  // Whether the default list is cut short at all (so "show fewer" means something).
  const cut = useMemo(() => shortList(visible, null).next !== null, [visible]);
  const found = useMemo(() => (query.trim() === "" ? null : searched(visible, query)), [visible, query]);
  // A search with nothing under the filters: how many it would find with every filter off.
  const foundOutside = useMemo(() => (found !== null && found.length === 0 ? searched(visibleGroups(groups, NO_FILTERS), query).length : 0), [found, groups, query]);
  const listed = found ?? short.rows;
  const rowByKey = useMemo(() => new Map(allRows.map((r) => [r.key, r] as const)), [allRows]);
  const groupOfRow = useMemo(() => {
    const m = new Map<string, RowGroup>();
    for (const g of groups) for (const v of g.variants) m.set(v.key, g);
    return m;
  }, [groups]);
  const boundGraph = part && "rows" in part ? part.graph : graphFor && graphFor.group === fg.group ? graphFor.nodes : null;
  const graph = boundGraph ?? sameGraph;
  const chips = useMemo(() => {
    const base = kChips(decentringTree, fg.group);
    // Stars the same-cell rows name that the page's trees do not (a decentring star while a choice is in force).
    for (const r of same.rows) for (const set of r.reach.sets) for (const x of set) {
      if (!base.some((c) => c.id === x.star)) base.push({ id: x.star, label: x.star, sameCell: true, source: "decentring", k: null });
    }
    return base;
  }, [decentringTree, fg.group, same.rows]);
  const indices = useMemo(() => [...new Set(allRows.map((r) => r.index))].sort((a, b) => a - b), [allRows]);

  // After a reload with a child in force, the row it was activated from, when the name and cell say which.
  useEffect(() => {
    if (!modes?.fromActivation || selected || activeKey) return;
    const hits = groups.filter((g) => g.name === modes.parentName && g.sameCell === !modes.ownCell && (modes.ownCell ? modesCellNote(modes).endsWith(g.cell) : true));
    if (hits.length === 1) setSelected({ group: hits[0]!.key, row: null });
  }, [modes, groups, selected, activeKey]);

  const dispatch = (action: PickerAction): void => {
    if (action.kind === "irrep") onActivateMode(action.term, action.sub);
    else if (action.kind === "subgroup") onActivateSubgroup(action.node);
    else if (action.kind === "sameCell") onActivateSameCell?.(action.node);
    else if (action.kind === "supercell") onActivateSupercell?.(action.choice);
  };
  const canActivate = (a: PickerAction): boolean =>
    a.kind === "irrep" || a.kind === "subgroup" || (a.kind === "sameCell" && onActivateSameCell !== undefined) || (a.kind === "supercell" && onActivateSupercell !== undefined);
  /** Activate a row once "working…" has painted; one at a time. */
  const activate = (row: SubgroupRow): void => {
    if (activating !== null) return;
    setActivating(row.key);
    setTimeout(() => {
      try {
        dispatch(row.action);
        onActivated(row.key);
      } finally {
        setActivating(null);
      }
    }, 20);
  };

  const pick = (group: RowGroup, row: SubgroupRow | null): void => {
    setSelected({ group: group.key, row: row?.key ?? null });
    setSheet(true);
  };
  const selGroup = selected ? groups.find((g) => g.key === selected.group) ?? null : null;
  const selShown = selGroup ? selGroup.variants.filter((v) => rowPasses(v, filters)) : [];
  const selRow = selGroup ? (selected?.row ? rowByKey.get(selected.row) : undefined) ?? selShown[0] ?? selGroup.variants[0]! : null;

  const parent = spaceGroup ?? "the parent";
  if (!ops || ops.length === 0) return <p style={line}>No space-group operations to analyse.</p>;
  const label = boundLabel(bound);
  const total = groups.length;
  const summary = (
    <InfoBadge
      width={360}
      label={<><b>{view === "list" ? listed.length : visible.length}</b> of {total} subgroups{superRows === null || working ? " so far" : ""} · fit {label}</>}
      ariaLabel="About the subgroup list"
      text={`The subgroups of ${parent} whose cell fits the ${label} supercell, from high to low symmetry (by index). The list opens on the top index levels: Show more adds the next ones, show all lists every one the filters keep. Find picks out a name or an ITA number (Pnma, 62) at any level. One row per name, cell and domains: "×4" when several classes share them, reached by different irreps (the detail lists them, each with its own Activate). By default the list keeps the subgroups one irrep reaches, or two coupled, and the maximal ones, and hides the strain-only ones (no atom moves, only the cell); Filters has the rest. A k-point chip keeps the subgroups its irreps reach; two chips also allow their coupled pairs. The tag names the irreps (R·8 is R irrep 8; dashed when coupled; M·3/5 when M irrep 3 or 5 reach it alike). Tree: each subgroup under the ones it is a maximal subgroup of.`}
    />
  );
  const kindLabel: Record<ReachKind, string> = { one: "one irrep", two: "up to two", all: `all ${total}` };

  const listBody = view === "list" ? (
    <ListBody
      visible={listed}
      short={found === null ? short : null}
      cut={found === null && cut}
      searching={found !== null}
      outside={foundOutside}
      selected={selected?.group ?? null}
      selectedRow={selRow}
      activeKey={activeKey}
      onPick={(g) => pick(g.group, null)}
      onLevels={(n) => setMore(n === null ? null : { filters, bound, levels: n })}
      onClearFilters={() => setFilters(NO_FILTERS)}
    />
  ) : (
    <TreeBody
      graph={graph}
      parent={parent}
      rowByKey={rowByKey}
      groupOfRow={groupOfRow}
      filters={filters}
      selectedRow={selRow?.key ?? null}
      activeKey={activeKey}
      expanded={expanded}
      complete={boundGraph !== null}
      toggle={(path) => setExpanded((s0) => {
        const s1 = new Set(s0);
        if (s1.has(path)) s1.delete(path);
        else s1.add(path);
        return s1;
      })}
      onPick={(row) => {
        const g = groupOfRow.get(row.key);
        if (g) pick(g, row);
      }}
    />
  );

  const detail = selGroup && selRow ? (
    <SubgroupDetail
      parent={parent}
      group={selGroup}
      shown={selShown}
      row={selRow}
      ks={filters.ks}
      activeKey={activeKey}
      modesInForce={modes !== null}
      busy={busy}
      activating={activating}
      canActivate={canActivate}
      onActivate={activate}
      onPickVariant={(v) => setSelected({ group: selGroup.key, row: v.key })}
      sheet={!wide}
    />
  ) : null;

  return (
    <div ref={measure} style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 6, flexWrap: "wrap" }}>
        <SupercellBound value={bound} onChange={(b) => { setBound(b); setStoppedFor(null); }} disabled={working} />
        <span style={{ fontSize: fz.micro, color: color.secondary }}>{summary}</span>
        {working && (
          <span style={{ ...line, gap: 6 }}>
            <span aria-busy="true" role="status">· {progress}{streamed ? ` · ${streamed.rows.length} larger so far` : ""}</span>
            <button style={resetRangeBtn} onClick={stop} title="Stop working out the larger cells (pick a smaller supercell, or come back to it)">stop</button>
          </span>
        )}
        {!working && fg.group !== null && stoppedFor === fg.group && (
          <span style={line}>
            · larger cells not worked out
            <button style={resetRangeBtn} onClick={() => setStoppedFor(null)}>work them out</button>
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
          {view === "list" ? (
            <input
              type="search"
              aria-label="find a subgroup"
              placeholder="Find: Pnma, 62"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 132, fontSize: fz.micro, padding: "3px 8px", border: `1px solid ${color.control}`, borderRadius: 7, background: color.surface, color: color.ink, minWidth: 0 }}
            />
          ) : null}
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
            style={{ ...resetRangeBtn, ...(foldedFiltersSet(filters) ? { color: color.primary, borderColor: color.primary } : {}) }}
          >
            {filtersOpen ? "▾" : "▸"} Filters{foldedFiltersSet(filters) ? " ·" : ""}
          </button>
          <Segments label="view" value={view} onChange={setView} options={[{ id: "list", label: "List" }, { id: "tree", label: "Tree" }]} />
        </span>
      </div>
      {fg.error && <p style={line}>Supercell: {fg.error}</p>}
      {same.error && <p style={line}>Same-cell subgroups: {same.error}</p>}
      {part && "error" in part && <p style={line}>{part.error}</p>}
      {filtersOpen && (
        <div role="group" aria-label="Filters" style={{ display: "flex", gap: 12, rowGap: 8, flexWrap: "wrap", alignItems: "center", padding: "8px 10px", border: `1px solid ${color.border}`, borderRadius: 8, background: color.muted2 }}>
          <span style={line}>Cell <Segments label="cell" value={filters.cell} onChange={(cell) => setFilters({ ...filters, cell })} options={[{ id: "any", label: "any" }, { id: "same", label: "same cell" }, { id: "super", label: "supercell" }]} /></span>
          <span style={line}>Reached by <Segments label="reached by" value={filters.kind} onChange={(kind) => setFilters({ ...filters, kind })} options={(["one", "two", "all"] as const).map((id) => ({ id, label: kindLabel[id] }))} /></span>
          <label style={line}>
            Index
            <select aria-label="highest index" value={filters.maxIndex ?? ""} onChange={(e) => setFilters({ ...filters, maxIndex: e.target.value === "" ? null : Number(e.target.value) })} style={{ fontSize: fz.micro }}>
              <option value="">any</option>
              {indices.map((i) => <option key={i} value={i}>≤ {i}</option>)}
            </select>
          </label>
          <span style={line}>Strain only <Segments label="strain only" value={filters.strain ? "show" : "hide"} onChange={(v) => setFilters({ ...filters, strain: v === "show" })} options={[{ id: "hide", label: "hide" }, { id: "show", label: "show" }]} /></span>
          {foldedFiltersSet(filters) ? <button style={resetRangeBtn} onClick={() => setFilters({ ...DEFAULT_FILTERS, ks: filters.ks })}>reset</button> : null}
        </div>
      )}
      <div role="group" aria-label="k-point" className="wb-kchips" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: wide ? "wrap" : "nowrap", overflowX: wide ? "visible" : "auto", paddingBottom: wide ? 0 : 4, scrollbarWidth: "none" }}>
        <Chip on={filters.ks.length === 0} label="any k" aria="any k-point" onClick={() => setFilters({ ...filters, ks: [] })} />
        {chips.map((c) => (
          <Chip
            key={c.id}
            on={filters.ks.includes(c.id)}
            label={starShort(c.label)}
            aria={chipName(c)}
            title={`Keep the subgroups ${c.label}'s irreps reach (${c.sameCell ? "same cell" : "a larger cell"}); pick two to allow them coupled`}
            onClick={() => setFilters({ ...filters, ks: filters.ks.includes(c.id) ? filters.ks.filter((x) => x !== c.id) : [...filters.ks, c.id] })}
          />
        ))}
      </div>
      {wide ? (
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "grid", gridTemplateColumns: view === "tree" ? "minmax(0, 1.4fr) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1.05fr)", gap: 12 }}>
          <div className="wb-grow-box" style={{ ...cardBox, overflowY: "auto", minHeight: 160 }}>{listBody}</div>
          <div ref={detailBox} className="wb-grow-box" style={{ ...cardBox, overflowY: "auto", padding: "12px 16px 0", minHeight: 160 }}>
            {detail ?? <p style={{ margin: 0, color: color.secondary, fontSize: fz.small }}>Pick a subgroup: its cell, how you get there, then Activate.</p>}
          </div>
        </div>
      ) : (
        <>
          <div className="wb-grow-box" style={{ ...cardBox, overflowY: "auto", minHeight: 160 }}>{listBody}</div>
          {sheet && detail && typeof document !== "undefined"
            ? createPortal(
              <div role="dialog" aria-modal="true" aria-label={`${selRow ? compactName(selRow.name) : "subgroup"} detail`} className="wb-sgsheet" style={{ position: "fixed", inset: 0, zIndex: 1000, background: color.surface, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${color.border}` }}>
                  <button type="button" onClick={() => setSheet(false)} style={{ border: "none", background: "none", color: color.primary, fontSize: fz.body, padding: "4px 0", cursor: "pointer" }}>‹ Back</button>
                  <span style={{ marginLeft: "auto", fontSize: fz.micro, color: color.faint }}>{shortName(parent)} · supercell {label}</span>
                </div>
                {banner ? <div style={{ padding: "8px 16px 0" }}>{banner}</div> : null}
                <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 0" }}>{detail}</div>
              </div>,
              document.body,
            )
            : null}
        </>
      )}
    </div>
  );
}

const moreBtn: CSSProperties = { border: "none", background: "none", color: color.primary, fontSize: fz.micro, cursor: "pointer", padding: "2px 0", fontFamily: "inherit" };

/**
 * The list, high to low symmetry under sticky index headers; under it, one
 * line: Show more (the next index levels) and show all, or show fewer. A
 * search lists every match; with none, how many lie outside the filters.
 */
function ListBody(p: {
  visible: readonly ShownGroup[];
  /** The short list's state (null while searching). */
  short: ShortList | null;
  /** True when the default list is cut short (so "show fewer" means something). */
  cut: boolean;
  searching: boolean;
  /** A search's matches outside the filters, when it has none inside. */
  outside: number;
  selected: string | null;
  selectedRow: SubgroupRow | null;
  activeKey: string | null;
  onPick: (g: ShownGroup) => void;
  onLevels: (levels: number | "all" | null) => void;
  onClearFilters: () => void;
}): JSX.Element {
  const { visible, short, selected, selectedRow, activeKey, onPick } = p;
  if (visible.length === 0) {
    return (
      <p style={{ padding: 12, margin: 0, color: color.secondary, fontSize: fz.small }}>
        {p.searching ? (p.outside > 0 ? <>No match here; {p.outside} outside the filters. <button type="button" style={moreBtn} onClick={p.onClearFilters}>show them</button></> : "No subgroup by that name.") : "No subgroup matches. Loosen a filter or a chip."}
      </p>
    );
  }
  const next = short?.next ?? null;
  const footer = next ? (
    <>
      <button type="button" style={moreBtn} onClick={() => p.onLevels(next.levels)}>
        Show more: index {next.from === next.to ? next.from : `${next.from}–${next.to}`} (+{next.count})
      </button>
      <button type="button" style={{ ...moreBtn, marginLeft: "auto" }} onClick={() => p.onLevels("all")}>show all {short!.total}</button>
    </>
  ) : short && p.cut ? (
    <button type="button" style={moreBtn} onClick={() => p.onLevels(null)}>show fewer</button>
  ) : null;
  return (
    <div>
      {visible.map((g, i) => {
        const head = i === 0 || visible[i - 1]!.group.index !== g.group.index;
        return (
          <Fragment key={g.group.key}>
            {head ? <div style={{ ...uppercaseLabel, fontSize: 10, padding: "5px 10px 2px", background: color.muted2, borderTop: `1px solid ${color.subtle2}`, position: "sticky", top: 0, zIndex: 1 }}>index {g.group.index}</div> : null}
            <RowLine g={g} {...(selected === g.group.key && selectedRow ? { variant: selectedRow } : {})} selected={selected === g.group.key} active={activeKey !== null && g.group.variants.some((v) => v.key === activeKey)} onPick={() => onPick(g)} />
          </Fragment>
        );
      })}
      {footer ? <div data-more="" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderTop: `1px solid ${color.subtle2}` }}>{footer}</div> : null}
    </div>
  );
}

/** The tree: from the parent one maximal step at a time; a subgroup with several parents says "also under …"; those the filters leave out dimmed. */
function TreeBody(p: {
  graph: readonly GraphNode[] | null;
  parent: string;
  rowByKey: ReadonlyMap<string, SubgroupRow>;
  groupOfRow: ReadonlyMap<string, RowGroup>;
  filters: ListFilters;
  selectedRow: string | null;
  activeKey: string | null;
  expanded: ReadonlySet<string>;
  complete: boolean;
  toggle: (path: string) => void;
  onPick: (row: SubgroupRow) => void;
}): JSX.Element {
  const kids = useMemo(() => (p.graph ? childrenOf(p.graph) : new Map<string, readonly string[]>()), [p.graph]);
  const parents = useMemo(() => new Map((p.graph ?? []).map((n) => [n.key, n.coveredBy] as const)), [p.graph]);
  if (!p.graph) return <p style={{ padding: 12, margin: 0, color: color.secondary, fontSize: fz.small }}>The tree is drawn once the lattice is worked out.</p>;
  const order = (a: string, b: string): number => {
    const ra = p.rowByKey.get(a);
    const rb = p.rowByKey.get(b);
    return (ra?.index ?? 1e9) - (rb?.index ?? 1e9) || Number(rb?.maximal ?? false) - Number(ra?.maximal ?? false) || Number(rb?.sameCell ?? false) - Number(ra?.sameCell ?? false);
  };
  const out: JSX.Element[] = [];
  const walk = (key: string, from: string | null, path: string, depth: number): void => {
    const below = [...(kids.get(key) ?? [])].sort(order);
    const open = p.expanded.has(path);
    const caret = (
      <span
        role="button"
        aria-label={below.length ? (open ? "collapse" : "expand") : undefined}
        aria-expanded={below.length ? open : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (below.length) p.toggle(path);
        }}
        style={{ width: 14 + depth * 14, flex: "0 0 auto", textAlign: "right", color: below.length ? color.secondary : "transparent", fontSize: 11, cursor: below.length ? "pointer" : "default" }}
      >
        {below.length ? (open ? "▾" : "▸") : "·"}
      </span>
    );
    if (key === "p") {
      out.push(
        <div key={path} data-tree="p" onClick={() => p.toggle(path)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", cursor: "pointer", background: color.muted2 }}>
          {caret}
          <span style={{ ...nameStyle, fontWeight: 600 }}>{compactName(p.parent)}</span>
          <span style={factStyle}>· parent · {below.length} maximal step{below.length === 1 ? "" : "s"}{p.complete ? "" : " (same cell; larger cells once worked out)"}</span>
        </div>,
      );
    } else {
      const row = p.rowByKey.get(key);
      const group = row ? p.groupOfRow.get(row.key) : undefined;
      const others = (parents.get(key) ?? []).filter((x) => x !== from);
      const also = others.length > 0 ? (
        <span style={{ ...factStyle, color: color.faint, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", flex: "0 1 auto", minWidth: 0 }} title={`also under ${others.map((x) => (x === "p" ? compactName(p.parent) : compactName(p.rowByKey.get(x)?.name ?? "?"))).join(", ")}`}>
          · also under {others[0] === "p" ? shortName(p.parent) : shortName(p.rowByKey.get(others[0]!)?.name ?? "?")}{others.length > 1 ? ` +${others.length - 1}` : ""}
        </span>
      ) : null;
      const count = below.length && !open ? <span style={{ ...factStyle, color: color.faint, fontSize: 11, flex: "0 0 auto" }}>· {below.length} below</span> : null;
      if (row && group) {
        out.push(
          <div key={path} data-tree={key}>
            <RowLine
              g={{ group: { ...group, variants: [row] }, shown: [row] }}
              selected={p.selectedRow === row.key}
              active={p.activeKey === row.key}
              onPick={() => p.onPick(row)}
              lead={caret}
              trail={also || count ? <span style={{ display: "inline-flex", gap: 4, flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>{also ?? count}</span> : null}
              dim={!rowPasses(row, p.filters)}
            />
          </div>,
        );
      } else {
        out.push(
          <div key={path} data-tree={key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", opacity: 0.45, borderTop: `1px solid ${color.subtle2}` }}>
            {caret}
            <span style={factStyle}>unnamed subgroup</span>
            {count}
          </div>,
        );
      }
    }
    if (open) for (const k of below) walk(k, key, `${path}/${k}`, depth + 1);
  };
  walk("p", null, "p", 0);
  return <div>{out}</div>;
}
