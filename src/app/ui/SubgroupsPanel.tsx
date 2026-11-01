/**
 * The PDF page's Subgroups view: where the symmetry is lowered. Pick a child,
 * then Activate (subgroupPicker.ts holds the rows). The modes the child
 * permits load into the Positions group, and the 3D Model view lists them as
 * they refine.
 *
 *   - "By subgroup" (first): every subgroup whose cell fits the supercell
 *     bound (default 2×2×2), by index, each with its cell, domains and the
 *     irreps that lower the parent to it (subgroupIrreps.ts). The same-cell
 *     ones are listed at once; the larger cells are worked out after the
 *     view shows, with "working…", the controls held and one run at a time.
 *   - "By irrep": a k-point chip, its irreps, their isotropy subgroups. Γ and
 *     the decentring points of a centred parent keep the cell
 *     (withActivatedMode); the bound's cell-multiplying stars come from the
 *     irrep engine, one k-point at a time, a child realised in its own cell
 *     (withSupercellChild). Only the children that fit the bound are listed,
 *     unless the larger cells are asked for.
 *
 * Irreps carry generic labels: the k-point, "irrep n of m" (ADR 0004). While
 * a choice is in force only it is shown, with its cell and ✕ clear
 * (withoutModes). Loading a parent CIF or an ISODISTORT mode CIF lives in the
 * 3D Model view's Distortion modes row (Import ▾).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ACTIVATION_KICK, type ModesInForce, type SupercellChoice } from "@/app/pdfPage";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import { decomposeDisplacementRepresentation, type DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import type { DisplacementField, SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { irrepIsotropySubgroups, irrepEngine, type IsotropySubgroup } from "@/core/crystal/isotropySubgroups";
import { formatBasis, latticeCentring } from "@/core/crystal/standardSetting";
import type { StructuralSubgroupTree, SubgroupNode } from "@/core/crystal/subgroupTree";
import { decentringTerms } from "@/core/crystal/decentringModes";
import { identifySubgroup } from "@/core/crystal/isotropyTree";
import { sameCellSubgroups, type SameCellSubgroup } from "@/core/crystal/irreps/sameCellLattice";
import { starsInBound, factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import type { KStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { starName } from "@/core/crystal/irreps/spaceGroupIrreps";
import { cachedIsotropySubgroups } from "@/core/crystal/irreps/isotropy";
import { rnum } from "@/core/crystal/irreps/rational";
import { boxOfVectors } from "@/core/crystal/irreps/childSetting";
import { cachedIrrepsOfStar } from "@/core/crystal/irreps/supercellModes";
import { cachedSupercellSubgroups, SubgroupSearchTooLarge, type SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import { color, fz, mono, resetRangeBtn } from "@/app/theme";
import { DEFAULT_BOUND, SUPERCELL_ACTIVATE_NOTE, SupercellBound, boundLabel, formatMatrix } from "@/app/ui/SupercellView";
import { InfoBadge } from "@/app/ui/InfoBadge";
import { SegmentedToggle } from "@/app/ui/SegmentedToggle";
import {
  chipName, decentringRows, kChips, sameCellListing, sameCellRows, subgroupLevels, subgroupSummary, supercellListing, supercellRows,
  type KChip, type PickerAction, type PickerChild, type PickerIrrep, type SubgroupRow,
} from "@/app/ui/subgroupPicker";

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
  /** The loaded structure: which irreps its atoms carry (a row's notes, the order of its coupled sets). */
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
  /** The view it opens on: "subgroup" (By subgroup, the default) or "irrep". */
  readonly initialView?: "subgroup" | "irrep";
}

const line: CSSProperties = { margin: 0, fontSize: fz.micro, color: color.secondary, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
const listBox: CSSProperties = { border: `1px solid ${color.border}`, borderRadius: 6, overflowY: "auto" };
const childRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderTop: `1px solid ${color.subtle2}` };
/** Name and facts: one line on a wide card, the facts under the name on a phone; "?" and Activate stay at the right. */
const childText: CSSProperties = { display: "flex", alignItems: "baseline", columnGap: 8, rowGap: 0, flexWrap: "wrap", flex: "1 1 auto", minWidth: 0 };
const nameStyle: CSSProperties = { fontFamily: mono, fontSize: fz.micro, color: color.ink, minWidth: 130 };
const factStyle: CSSProperties = { fontFamily: mono, fontSize: fz.micro, color: color.secondary, minWidth: 0, overflowWrap: "anywhere" };
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
              {modesCellNote(modes)}
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

/** The By subgroup view's cell-multiplying part: its rows and lattice, or why there are none. */
type SupercellPart = { readonly rows: readonly SubgroupRow[]; readonly lattice: SupercellLattice } | { readonly error: string };
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

class Stopped extends Error {}
const pause = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The cell-multiplying rows of the bound, step by step with a pause between
 * the steps (the lattice; each star's irreps; each irrep's isotropy subgroups;
 * the matching) so "working…" paints and a stop is heard.
 */
async function computeSupercellPart(group: FactorGroup, structure: StructureModel | undefined, bound: string, say: (what: string) => void, stopped: () => boolean): Promise<SupercellPart> {
  const check = async (what: string): Promise<void> => {
    say(what);
    await pause();
    if (stopped()) throw new Stopped();
  };
  await check(`listing the subgroups in ${bound}`);
  try {
    cachedSupercellSubgroups(group);
  } catch (e) {
    if (e instanceof SubgroupSearchTooLarge) return { error: `Larger cells refused: ${e.message}.` };
    throw e;
  }
  const ks = starsInBound(group).map((k) => [rnum(k[0]), rnum(k[1]), rnum(k[2])] as [number, number, number]);
  for (let i = 0; i < ks.length; i++) {
    const name = starName(group, ks[i]!) ?? `(${ks[i]!.join(", ")})`;
    await check(`irreps at ${name} (${i + 1} of ${ks.length})`);
    const star = cachedIrrepsOfStar(group, ks[i]!);
    for (const p of star.physical) {
      await check(`isotropy subgroups at ${name} (${i + 1} of ${ks.length})`);
      cachedIsotropySubgroups(group, p);
    }
  }
  await check("matching irreps to subgroups");
  return supercellListing(group, structure, bound);
}

/** The same-cell rows, at once (sameCellListing), or why there are none. */
function sameCellPart(o: Parameters<typeof sameCellListing>[0]): { readonly rows: readonly SubgroupRow[]; readonly error: string | null } {
  try {
    return { rows: sameCellListing(o), error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** The cache key of a supercell chip's rows: the bound and the star. */
const rowsKey = (bound: SupercellSpec, chip: KChip): string => `${boundKey(bound)}|${chip.id}`;

function Picker({ spaceGroup, lattice, irrepTree, decentringTree = null, sameCell = [], operations, structure, onActivateSameCell, onActivateSupercell, busy, onActivateMode, onActivateSubgroup, initialView = "subgroup" }: Props): JSX.Element {
  const ops = operations ?? structure?.spaceGroup.operations;
  const [view, setView] = useState<"irrep" | "subgroup">(initialView);
  const [bound, setBound] = useState<SupercellSpec>(DEFAULT_BOUND);
  const [chipId, setChipId] = useState("Γ");
  const [cache, setCache] = useState<ReadonlyMap<string, PickerIrrep[] | string>>(new Map());
  // What runs: a chip's id, or "subgroups" for the By subgroup view's larger cells; one at a time.
  const [working, setWorking] = useState<string | null>(null);
  const workingRef = useRef<string | null>(null);
  const [progress, setProgress] = useState("");
  const jobRef = useRef<{ stop: boolean } | null>(null);
  const [stoppedFor, setStoppedFor] = useState<FactorGroup | null>(null);
  const [showLarger, setShowLarger] = useState(false);

  const fg = useMemo(() => boundGroup(ops, bound), [ops, bound]);
  const chips = useMemo(() => kChips(decentringTree, fg.group), [decentringTree, fg.group]);
  const chip = chips.find((c) => c.id === chipId) ?? chips[0]!;
  const same = useMemo(
    () => (ops && ops.length > 0 ? sameCellPart({ operations: ops, ...(structure ? { structure } : {}), tTree: lattice, gammaTree: irrepTree, decentringTree, kNodes: sameCell }) : { rows: [], error: null }),
    [ops, structure, lattice, irrepTree, decentringTree, sameCell],
  );
  const part = fg.group ? partOf(fg.group, structure) : undefined;

  // The larger cells of the By subgroup view: worked out once the view shows, one run at a time (a job's end
  // re-checks through `done`), and stopped when the view, the bound or the structure changes.
  const [done, setDone] = useState(0);
  useEffect(() => {
    const group = fg.group;
    if (view !== "subgroup" || !group || partOf(group, structure) || stoppedFor === group || workingRef.current !== null) return;
    const job = { stop: false };
    jobRef.current = job;
    workingRef.current = "subgroups";
    setWorking("subgroups");
    void (async () => {
      try {
        await pause(20);
        const result = await computeSupercellPart(group, structure, boundLabel(bound), (what) => { if (!job.stop) setProgress(what); }, () => job.stop);
        keepPart(group, structure, result);
      } catch (e) {
        if (!(e instanceof Stopped)) keepPart(group, structure, { error: e instanceof Error ? e.message : String(e) });
      } finally {
        workingRef.current = null;
        if (jobRef.current === job) jobRef.current = null;
        setWorking(null);
        setProgress("");
        setDone((n) => n + 1);
      }
    })();
  }, [view, fg.group, structure, stoppedFor, done, bound]);
  useEffect(() => () => {
    if (jobRef.current) jobRef.current.stop = true;
  }, [view, fg.group, structure]);

  const stop = (): void => {
    if (jobRef.current) jobRef.current.stop = true;
    setStoppedFor(fg.group);
  };

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

  const dispatch = (action: PickerAction): void => {
    if (action.kind === "irrep") onActivateMode(action.term, action.sub);
    else if (action.kind === "subgroup") onActivateSubgroup(action.node);
    else if (action.kind === "sameCell") onActivateSameCell?.(action.node);
    else if (action.kind === "supercell") onActivateSupercell?.(action.choice);
  };
  const canActivate = (a: PickerAction): boolean =>
    a.kind === "irrep" || a.kind === "subgroup" || (a.kind === "sameCell" && onActivateSameCell !== undefined) || (a.kind === "supercell" && onActivateSupercell !== undefined);

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
    else note = working === chip.id ? `Working out the irreps at ${chip.label}…` : working !== null ? `Pick ${chip.label} when the work in hand is done.` : `Pick ${chip.label} to list its irreps.`;
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 6, flexWrap: "wrap" }}>
        <SegmentedToggle
          options={[
            { id: "subgroup", label: "By subgroup", title: "Pick a child among the subgroups that fit the supercell, each with the irreps that lower the parent to it" },
            { id: "irrep", label: "By irrep", title: "Pick a k-point, then a child of one of its irreps" },
          ]}
          value={view}
          onChange={setView}
        />
        {ops && ops.length > 0 && (
          <span style={{ marginLeft: "auto" }}>
            <SupercellBound value={bound} onChange={(b) => { setBound(b); setStoppedFor(null); }} disabled={working !== null} />
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
              text={`Each k-point lists the irreps of ${parent} there and, under each, its isotropy subgroups: one child per order-parameter direction (Stokes & Hatch), named in the ITA standard setting, with its cell. Same-cell points (Γ, and the decentring points of a centred parent) lower the symmetry in the parent's cell. Supercell points multiply the cell: the child is refined in its own cell, its positions as modes by parent irrep. Only the children whose cell fits the ${boundLabel(bound)} supercell are listed unless "show larger cells" is on (the whole list, as ISODISTORT gives it). Activate splits the Wyckoff orbits and puts the child's modes in the Positions group, the order parameter free from a ${ACTIVATION_KICK} Å start (at 0 the parent's symmetry makes χ² stationary along it). Irreps carry generic labels, "R irrep 8 of 10", not ISODISTORT's.`}
            />
          </p>
          <div role="group" aria-label="k-point" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
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
          {working === "subgroups" && <p style={line}>working… {progress} (the By subgroup view)</p>}
          {chip.source === "supercell" && (
            <label style={{ ...line, cursor: "pointer" }}>
              <input type="checkbox" checked={showLarger} disabled={working !== null} onChange={(e) => setShowLarger(e.target.checked)} />
              show larger cells
            </label>
          )}
          {note && <p style={line}>{note}</p>}
          {rows && (
            <IrrepList
              key={`${chip.id}|${rowsKey(bound, chip)}`}
              rows={rows}
              busy={busy}
              showLarger={showLarger}
              bound={boundLabel(bound)}
              canActivate={canActivate}
              onActivate={dispatch}
            />
          )}
        </>
      ) : (
        <SubgroupList
          parent={parent}
          bound={boundLabel(bound)}
          sameRows={same.rows}
          sameError={same.error}
          part={part}
          working={working === "subgroups"}
          otherWork={working !== null && working !== "subgroups"}
          progress={progress}
          stopped={fg.group !== null && stoppedFor === fg.group}
          noOperations={!ops || ops.length === 0}
          busy={busy}
          canActivate={canActivate}
          onActivate={dispatch}
          onStop={stop}
          onResume={() => setStoppedFor(null)}
        />
      )}
    </>
  );
}

/** What Activate says it does, by action. */
function activateTitle(a: PickerAction, name: string, busy: boolean): string {
  if (busy) return "A fit is running";
  return a.kind === "supercell"
    ? SUPERCELL_ACTIVATE_NOTE
    : `Lower to ${name} in the parent's cell: the Wyckoff orbits split and its modes enter the Positions group, the order parameter free from a ${ACTIVATION_KICK} Å start.`;
}

function ActivateButton({ action, name, busy, canActivate, onActivate }: { action: PickerAction; name: string; busy: boolean; canActivate: boolean; onActivate: () => void }): JSX.Element | null {
  if (action.kind === "elsewhere") return <span style={{ flex: "none", fontSize: fz.micro, color: color.secondary }}>{action.note}</span>;
  if (!canActivate) return null;
  return (
    <button
      style={{ ...resetRangeBtn, flex: "none", ...(busy ? blocked : {}) }}
      disabled={busy}
      onClick={onActivate}
      aria-label={`Activate ${name}`}
      title={activateTitle(action, name, busy)}
    >
      Activate
    </button>
  );
}

/** One child's row (By irrep): name, one line of facts, Activate. */
function ChildRow({ child, busy, canActivate, onActivate }: { child: PickerChild; busy: boolean; canActivate: boolean; onActivate: () => void }): JSX.Element {
  return (
    <div style={childRow}>
      <span style={childText}>
        <span style={nameStyle} title={child.detail}>{child.name}</span>
        <span style={factStyle}>{child.facts}</span>
      </span>
      <ActivateButton action={child.action} name={child.name} busy={busy} canActivate={canActivate} onActivate={onActivate} />
    </div>
  );
}

/**
 * The irreps of one k-point, each a collapsible group of children (all open
 * when there are three or fewer); only the children that fit the bound unless
 * `showLarger`.
 */
function IrrepList({ rows, busy, showLarger, bound, canActivate, onActivate }: { rows: readonly PickerIrrep[]; busy: boolean; showLarger: boolean; bound: string; canActivate: (a: PickerAction) => boolean; onActivate: (a: PickerAction) => void }): JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(rows.length <= 3 ? rows.map((r) => r.label) : rows.slice(0, 1).map((r) => r.label)));
  if (rows.length === 0) return <p style={line}>No irrep here carries a distortion of these sites.</p>;
  return (
    <div className="wb-grow-box" style={{ ...listBox, flex: "1 1 auto", minHeight: 120 }}>
      {rows.map((r) => {
        const isOpen = open.has(r.label);
        const shown = showLarger ? r.children : r.children.filter((c) => c.fits);
        const larger = r.children.length - r.children.filter((c) => c.fits).length;
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
                <span style={{ color: color.secondary }}>
                  {r.facts} · {shown.length} {shown.length === 1 ? "child" : "children"}
                  {!showLarger && larger > 0 ? ` (${larger} larger than ${bound})` : ""}
                </span>
              </button>
              <InfoBadge width={300} ariaLabel={`About ${r.label}`} text={r.detail} />
            </div>
            {isOpen && shown.map((c, i) => (
              <ChildRow key={i} child={c} busy={busy} canActivate={canActivate(c.action)} onActivate={() => onActivate(c.action)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** One subgroup (By subgroup): name, its cell, domains and irreps in one line, "?" for the rest, Activate. */
function SubgroupRowView({ row, busy, canActivate, onActivate }: { row: SubgroupRow; busy: boolean; canActivate: boolean; onActivate: () => void }): JSX.Element {
  return (
    <div style={childRow} data-row={row.key}>
      <span style={childText}>
        <span style={nameStyle}>{row.name}</span>
        <span style={factStyle}>{row.cell} · {row.domains} domains · {row.irreps}</span>
      </span>
      <InfoBadge width={340} align="right" ariaLabel={`About ${row.name}`} text={row.detail} />
      <ActivateButton action={row.action} name={row.name} busy={busy} canActivate={canActivate} onActivate={onActivate} />
    </div>
  );
}

/** By subgroup: the subgroups that fit the bound, by index, the same-cell ones at once and the larger cells once worked out. */
function SubgroupList(p: {
  parent: string;
  bound: string;
  sameRows: readonly SubgroupRow[];
  sameError: string | null;
  part: SupercellPart | undefined;
  working: boolean;
  otherWork: boolean;
  progress: string;
  stopped: boolean;
  noOperations: boolean;
  busy: boolean;
  canActivate: (a: PickerAction) => boolean;
  onActivate: (a: PickerAction) => void;
  onStop: () => void;
  onResume: () => void;
}): JSX.Element {
  const superRows = p.part && "rows" in p.part ? p.part.rows : null;
  const levels = useMemo(() => subgroupLevels([...p.sameRows, ...(superRows ?? [])]), [p.sameRows, superRows]);
  if (p.noOperations) return <p style={line}>No space-group operations to analyse.</p>;
  const summary = subgroupSummary({
    parent: p.parent,
    bound: p.bound,
    sameCell: p.sameRows.length,
    supercell: p.part && "rows" in p.part ? { rows: p.part.rows.length, lattice: p.part.lattice } : null,
  });
  return (
    <>
      <p style={line}>
        <span style={{ color: color.ink }}>{summary.line}</span>
        <InfoBadge width={340} ariaLabel="About the subgroup list" text={summary.detail} />
        {p.working && (
          <>
            <span aria-busy="true">· working… {p.progress}</span>
            <button style={resetRangeBtn} onClick={p.onStop} title="Stop working out the larger cells (pick a smaller supercell, or come back to it)">
              stop
            </button>
          </>
        )}
        {!p.working && p.stopped && (
          <>
            <span>· larger cells not worked out</span>
            <button style={resetRangeBtn} disabled={p.otherWork} onClick={p.onResume}>work them out</button>
          </>
        )}
      </p>
      {p.sameError && <p style={line}>Same-cell subgroups: {p.sameError}</p>}
      {p.part && "error" in p.part && <p style={line}>{p.part.error}</p>}
      <div className="wb-grow-box" style={{ ...listBox, flex: "1 1 auto", minHeight: 140 }}>
        {levels.map(({ index, rows }) => (
          <div key={index}>
            <div style={{ position: "sticky", top: 0, padding: "3px 8px", background: color.subtle, borderTop: `1px solid ${color.border}`, fontFamily: mono, fontSize: fz.micro, color: color.secondary }}>
              index {index}
            </div>
            {rows.map((row) => (
              <SubgroupRowView key={row.key} row={row} busy={p.busy} canActivate={p.canActivate(row.action)} onActivate={() => p.onActivate(row.action)} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
