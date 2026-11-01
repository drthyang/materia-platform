/**
 * The Subgroups page's rows, as data: the page renders them and dispatches
 * their actions; the tests walk the same rows, so a child reached through a
 * row is the child the older paths activated.
 *
 * By subgroup (the page's first view): every subgroup of the parent whose
 * cell fits the supercell bound, one row per conjugacy class, by index. Each
 * names its cell ("same cell", or the parent-axes box n₁×n₂×n₃ that repeats
 * it), its domains and the irreps that lower the parent to it
 * (subgroupIrreps.ts: the primary ones, or the fewest coupled ones), the
 * secondary irreps behind its "?".
 *   - The same-cell rows come from the conventional cell's lattice (G/ℤ³).
 *     Activate takes the irrep path when a primary irrep is one the page's Γ
 *     or decentring trees list (withActivatedMode, the By irrep child
 *     itself), else the lattice path (withSubgroup for a t-subgroup,
 *     withSameCellSubgroup for a decentring k- or general one).
 *   - The cell-multiplying rows come from the bound's lattice (G/T″), its
 *     classes that keep a conjugate of the supercell. Activate realises the
 *     child in its own cell (withSupercellChild): the By irrep child itself
 *     when its primary irrep's child keeps the supercell, else the lattice's
 *     member that does, with the row's irreps as the order parameter.
 *
 * By irrep (the second view): a k-point chip, its irreps, each irrep's
 * children — Γ and the decentring points of a centred parent keep the cell
 * (the same-cell trees, withActivatedMode); the bound's cell-multiplying stars
 * come from the irrep engine (withSupercellChild, the irrep leading the kick).
 * Each child says its cell and whether it fits the bound; the page lists the
 * ones that fit unless asked for the larger cells.
 *
 * Irrep labels are the engine's generic ones ("R irrep 8 of 10", ADR 0004).
 */

import type { Vec3 } from "@/core/math/types";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { SupercellChoice } from "@/app/pdfPage";
import type { DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import type { SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { subgroupClassRepresentatives, type StructuralSubgroupTree, type SubgroupNode } from "@/core/crystal/subgroupTree";
import { irrepEngine } from "@/core/crystal/isotropySubgroups";
import { starsInBound, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { formatK, starName } from "@/core/crystal/irreps/spaceGroupIrreps";
import { cachedIsotropySubgroups } from "@/core/crystal/irreps/isotropy";
import { rnum } from "@/core/crystal/irreps/rational";
import { periodicityBox } from "@/core/crystal/irreps/childSetting";
import { cachedIrrepsOfStar, displacementCharacters, displacementMultiplicity } from "@/core/crystal/irreps/supercellModes";
import { cachedSupercellSubgroups, fitsBound, keepsSupercell, type SubgroupClass, type SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import { boundIrreps, subgroupIrreps, type BoundIrrep, type IrrepDirection, type SubgroupIrreps } from "@/core/crystal/irreps/subgroupIrreps";
import type { DecentringBranch, IrrepBranch, IrrepSubgroup, SameCellNode } from "@/app/ui/SubgroupsPanel";
import { formatBasis } from "@/core/crystal/standardSetting";

/** A k-point the page offers, as a chip. */
export interface KChip {
  /** Unique among the chips: the star's name, else its coordinates. */
  readonly id: string;
  /** What the chip says: "Γ", "X", "R", or "(0, 0, 1/2)" for an unnamed star. */
  readonly label: string;
  /** True when the children keep the conventional cell (Γ, the decentring points). */
  readonly sameCell: boolean;
  /** Where its rows come from. */
  readonly source: "gamma" | "decentring" | "supercell";
  /** The representative k (conventional reciprocal basis); null for Γ. */
  readonly k: Vec3 | null;
}

/** The chip's accessible name: "R, supercell", "Γ, same cell". */
export const chipName = (chip: KChip): string => `${chip.label}, ${chip.sameCell ? "same cell" : "supercell"}`;

/** What Activate does on a child. */
export type PickerAction =
  /** Lower the symmetry in the parent's cell along a Γ or decentring irrep (withActivatedMode). */
  | { readonly kind: "irrep"; readonly term: DisplaciveIrrepTerm; readonly sub: IrrepSubgroup }
  /** Lower to a t-subgroup in the parent's cell (withSubgroup). */
  | { readonly kind: "subgroup"; readonly node: SubgroupNode }
  /** Lower to a decentring k- or general subgroup in the parent's cell (withSameCellSubgroup). */
  | { readonly kind: "sameCell"; readonly node: SameCellNode }
  /** Realise a cell-multiplying child in its own cell (withSupercellChild). */
  | { readonly kind: "supercell"; readonly choice: SupercellChoice }
  /** Nothing here: the child keeps the cell and is activated from a same-cell chip. */
  | { readonly kind: "elsewhere"; readonly note: string };

/** One child of an irrep (By irrep): its name, one line of facts, the rest for a tooltip, its cell and its action. */
export interface PickerChild {
  readonly name: string;
  readonly facts: string;
  readonly detail: string;
  /** "same cell", or the parent-axes box that repeats it ("1×1×2"). */
  readonly cell: string;
  /** True when its lattice holds a conjugate of the bound's supercell: it fits the cell the user chose. */
  readonly fits: boolean;
  readonly action: PickerAction;
}

/** One irrep and its children. */
export interface PickerIrrep {
  readonly label: string;
  readonly facts: string;
  readonly detail: string;
  readonly children: readonly PickerChild[];
}

/** The name of a child: the standard symbol and number, else the point group. */
export function childName(identity: SubgroupIdentity | undefined): string {
  if (identity?.number !== undefined) return `${identity.hermannMauguin ?? "?"} #${identity.number}`;
  return `${identity?.pointGroup ?? "?"} (unnamed)`;
}

/** The child basis in words: "a′ = 2a, b′ = 2b, c′ = 2c, origin (½, 0, 0)"; "in the parent's cell" when named there. */
export function childBasisNote(identity: SubgroupIdentity | undefined): string {
  if (!identity) return "";
  if (identity.method !== "conventional-cell" || !identity.basis) return identity.method === "direct" ? "in the parent's cell" : "";
  const shift = identity.originShift ? `, origin (${identity.originShift.map((x) => +x.toFixed(4)).join(", ")})` : "";
  return `${formatBasis(identity.basis)}${shift}`;
}

/** A cell as the rows write it: "same cell" for the parent's, else the parent-axes box n₁×n₂×n₃ that repeats it. */
export const cellLabel = (box: readonly number[]): string => (box.every((n) => n === 1) ? "same cell" : box.join("×"));

/** The volume of a child's own cell in parent cells, |det P_H|, as the activation message writes it. */
function cellVolume(identity: SubgroupIdentity): number | null {
  const P = identity.basis;
  if (!P) return null;
  const det = P[0][0] * (P[1][1] * P[2][2] - P[1][2] * P[2][1]) - P[0][1] * (P[1][0] * P[2][2] - P[1][2] * P[2][0]) + P[0][2] * (P[1][0] * P[2][1] - P[1][1] * P[2][0]);
  return +Math.abs(det).toFixed(4);
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The chips: Γ, the decentring stars (from their tree, one chip per star), then
 * the bound's cell-multiplying stars (a component of k not an integer), named
 * where the engine names them (starName) and by coordinates otherwise.
 */
export function kChips(decentring: readonly DecentringBranch[] | null, group: FactorGroup | null): KChip[] {
  const chips: KChip[] = [{ id: "Γ", label: "Γ", sameCell: true, source: "gamma", k: null }];
  for (const b of decentring ?? []) {
    if (!chips.some((c) => c.id === b.star.label)) chips.push({ id: b.star.label, label: b.star.label, sameCell: true, source: "decentring", k: b.star.k });
  }
  if (group) {
    for (const r of starsInBound(group)) {
      const k: Vec3 = [rnum(r[0]), rnum(r[1]), rnum(r[2])];
      if (k.every((x) => Number.isInteger(x))) continue; // Γ or a decentring point: the same-cell chips have them.
      const label = starName(group, k) ?? formatK(k);
      if (!chips.some((c) => c.id === label)) chips.push({ id: label, label, sameCell: false, source: "supercell", k });
    }
  }
  return chips;
}

/** Why a direction's subgroup is what it is, for the tooltip of an Activate in the parent's cell. */
function sameCellDetail(sub: IrrepSubgroup, dim: number): string {
  const direction = sub.kernel
    ? `a general direction (all ${dim} components free, the irrep's kernel)`
    : sub.orderParameterDim === 1 ? "a one-parameter direction" : `a ${sub.orderParameterDim}-parameter direction (of ${dim})`;
  const basis = childBasisNote(sub.identity);
  return [
    `The isotropy subgroup of ${direction} of the order parameter.`,
    `Index ${sub.index.t * sub.index.k} = ${sub.index.t}·${sub.index.k} (point group · translations); ${plural(sub.conjugates, "orientation")}, ${sub.domainStates} domain states.`,
    basis ? `Named in its own setting: ${basis}; refined in the parent's cell.` : "Refined in the parent's cell.",
  ].join(" ");
}

/** The rows of a same-cell tree (Γ or one decentring star): the existing irreps and their isotropy subgroups, each child in the parent's cell. */
export function sameCellRows(tree: readonly IrrepBranch[]): PickerIrrep[] {
  return tree.map(({ term, subgroups }) => {
    const dim = term.irrep.dim ?? 1;
    const optic = term.multiplicity - term.acoustic;
    return {
      label: term.irrep.label,
      facts: `dim ${dim} · ${plural(optic, "optic mode")}${term.acoustic > 0 ? ` (+${term.acoustic} acoustic)` : ""}`,
      detail: "Its isotropy subgroups, one per order-parameter direction (Stokes & Hatch): the one-parameter directions first, then the lower ones down to a general direction. Directions are written in the irrep's own basis, which can differ from ISODISTORT's.",
      children: subgroups.map((sub) => ({
        name: childName(sub.identity),
        facts: `${sub.direction} · same cell · ${sub.domainStates} domains`,
        detail: sameCellDetail(sub, dim),
        cell: "same cell",
        fits: true,
        action: { kind: "irrep", term, sub } as const,
      })),
    };
  });
}

/** The rows of a decentring chip: the decentring tree's branches at that star. */
export function decentringRows(tree: readonly DecentringBranch[], chip: KChip): PickerIrrep[] {
  return sameCellRows(tree.filter((b) => b.star.label === chip.id));
}

/**
 * The rows of a cell-multiplying chip: the physically irreducible
 * representations at its k and their isotropy subgroups (irrep engine, cached:
 * the By subgroup view asks for the same ones), each child with its cell and
 * whether it fits the bound. This is the slow step (seconds on a large
 * bound); the page runs it on request.
 */
export function supercellRows(group: FactorGroup, k: Vec3): PickerIrrep[] {
  const star = cachedIrrepsOfStar(group, k);
  return star.physical.map((p) => {
    const subs = cachedIsotropySubgroups(group, p).subgroups;
    return {
      label: p.label,
      facts: `dim ${p.dim} · ${plural(star.star.arms.length, "arm")}`,
      detail: `k = ${formatK(star.star.k)}, ${plural(star.star.arms.length, "arm")}; a physically irreducible representation. Its isotropy subgroups, one per order-parameter direction, are named in the ITA standard setting; hover a name for its basis from the parent's cell.`,
      children: subs.map((s) => {
        const cell = cellLabel(periodicityBox(group, s.elements));
        const fits = fitsBound(group, s.elements);
        return {
          name: childName(s.identity),
          facts: `${s.direction.symbol} · ${cell} · ${s.domainStates} domains`,
          detail: [
            `Index ${s.index.t}·${s.index.k} (point group · translations); ${plural(s.orientationStates, "orientation")}, ${s.domainStates} domain states; arms ${s.activeArms.join(", ")}${s.kernel ? "; the irrep's kernel" : ""}.`,
            childBasisNote(s.identity) ? `Its cell: ${childBasisNote(s.identity)}.` : "",
            fits ? "" : "Its cell is larger than the supercell chosen: no conjugate of it fits that cell.",
          ].filter((x) => x !== "").join(" "),
          cell,
          fits,
          action: s.cellMultiplying
            ? { kind: "supercell", choice: { group, elements: s.elements, identity: s.identity, primary: p.characters } } as const
            : { kind: "elsewhere", note: "same cell: under Γ" } as const,
        };
      }),
    };
  });
}

// ── By subgroup ──────────────────────────────────────────────────────────────

/** One subgroup of the parent (a conjugacy class) in the By subgroup list. */
export interface SubgroupRow {
  readonly key: string;
  readonly name: string;
  /** "same cell", or the parent-axes box that repeats it ("1×1×2"). */
  readonly cell: string;
  /** [G : H]. */
  readonly index: number;
  readonly domains: number;
  readonly maximal: boolean;
  readonly sameCell: boolean;
  /** The irreps that lower the parent to it, in one line: the primary ones with their directions, or the coupled set. */
  readonly irreps: string;
  /** Everything else, for its "?": the index split, orientations, the basis, the coupled alternatives, the secondary irreps. */
  readonly detail: string;
  readonly action: PickerAction;
}

/** The largest coupled set the rows search (subgroupIrreps' default). */
export const MAX_COUPLED = 4;

const irrepText = (d: IrrepDirection): string => `${d.irrep.irrep.label} ${d.direction}`;
const labelsOf = (ds: readonly IrrepDirection[]): string => ds.map((d) => d.irrep.irrep.label).join(" + ");

/** The irreps of a row, in one line. */
export function irrepsLine(r: SubgroupIrreps): string {
  if (r.primary.length > 0) return r.primary.map(irrepText).join(" or ");
  if (r.coupled) {
    const n = r.otherCoupled.length;
    const kind = r.coupled.length === 2 ? "pair" : "set";
    return `${r.coupled.map(irrepText).join(" + ")}, coupled${n > 0 ? ` (or ${n} other ${kind}${n === 1 ? "" : "s"})` : ""}`;
  }
  return r.searchedUpTo >= MAX_COUPLED ? `no ${MAX_COUPLED} irreps or fewer reach it` : `no set of up to ${r.searchedUpTo} irreps reaches it (search stopped)`;
}

/** The "?" of a row: what kind of subgroup it is, its index and cell, how its irreps reach it, the secondary ones. */
function rowDetail(o: {
  readonly cls: SubgroupClass;
  readonly r: SubgroupIrreps;
  readonly identity: SubgroupIdentity;
  readonly box: readonly number[];
  readonly bound?: string;
  readonly moves?: (b: BoundIrrep) => boolean;
  readonly gammaAlias?: string;
}): string {
  const { cls, r, identity, box } = o;
  const same = !cls.cellMultiplying;
  const kind = cls.kind === "t"
    ? "A t-subgroup: point-group operations lost, every translation kept."
    : cls.kind === "k"
      ? same
        ? "A decentring k-subgroup: the point group kept, centring translations lost, the conventional cell kept."
        : `A k-subgroup in a larger cell: the point group kept, translations lost${cls.isomorphic ? " (isomorphic: the parent's own type)" : ""}.`
      : `A general subgroup: point-group operations and translations lost${same ? ", the conventional cell kept" : ""}.`;
  const parts: string[] = [
    `${kind}${cls.maximal ? " Maximal." : ""}`,
    `Index ${cls.index.t * cls.index.k} = ${cls.index.t}·${cls.index.k} (point group · translations); ${plural(cls.orientationStates, "orientation")}, ${cls.domainStates} domain states.`,
  ];
  const basis = childBasisNote(identity);
  if (same) {
    parts.push(basis && basis !== "in the parent's cell" ? `Named in its own setting (${basis}); refined in the parent's cell.` : "Named and refined in the parent's cell.");
  } else {
    const v = cellVolume(identity);
    parts.push(`Its own cell: ${basis}${v !== null ? ` (×${v} the parent's)` : ""}, repeating every ${box.join("×")} parent cells; refined in that cell.`);
    if (cls.supercellLattice && o.bound) parts.push(`Its lattice is the ${o.bound} cell itself: one of Bilbao's SUBGROUPS entries for that supercell.`);
  }
  if (r.primary.length > 0) {
    parts.push(`Primary: ${r.primary.map(irrepText).join("; ")}. ${r.primary.length === 1 ? "Its isotropy subgroup along that direction is" : "Each one's isotropy subgroup along its direction is"} this subgroup.`);
  } else if (r.coupled) {
    parts.push(`No single irrep has it as an isotropy subgroup. Coupled: ${r.coupled.map((d) => `${irrepText(d)} (alone, ${childName(d.subgroup.identity)})`).join(" with ")}; their joint isotropy subgroup, each in the domain this subgroup fixes, is this one.`);
    if (r.otherCoupled.length > 0) parts.push(`Also reached by ${r.otherCoupled.map(labelsOf).join("; ")}.`);
  } else {
    parts.push(`No irrep, or set of up to ${r.searchedUpTo}, reaches it in this bound.`);
  }
  if (o.gammaAlias) parts.push(`(${o.gammaAlias} on the By irrep view's Γ chip.)`);
  const still = [...r.primary, ...(r.coupled ?? [])].filter((d) => o.moves && !o.moves(d.irrep));
  if (still.length > 0) parts.push(`${still.map((d) => d.irrep.irrep.label).join(", ")} ${still.length === 1 ? "moves" : "move"} no atom of this structure.`);
  parts.push(r.secondary.length > 0 ? `Secondary (allowed here, induced by coupling): ${r.secondary.map((s) => s.irrep.irrep.label).join(", ")}.` : "No secondary irrep.");
  if (cls.enantiomorph) parts.push(`Its class also holds ${childName(cls.enantiomorph)} (Bilbao's SUBGROUPS lists the two as separate entries).`);
  return parts.join(" ");
}

/** A same-cell subgroup's operations (parent's cell, modulo ℤ³) as elements of the conventional cell's factor group. */
function elementsOf(group: FactorGroup, ops: readonly SymmetryOperation[]): number[] {
  const key = (op: SymmetryOperation): string => `${op.rotation.flat().map((x) => Math.round(x)).join(",")}|${op.translation.map((x) => Math.round((((x % 1) + 1) % 1) * 48) % 48).join(",")}`;
  const index = new Map<string, number>();
  group.operations.forEach((op, i) => {
    if (!index.has(key(op))) index.set(key(op), i);
  });
  return [...new Set(ops.map((op) => {
    const i = index.get(key(op));
    if (i === undefined) throw new Error(`subgroupPicker: ${op.xyz} is not an operation of the parent`);
    return i;
  }))].sort((a, b) => a - b);
}

const sameCharacters = (a: readonly number[], b: readonly { readonly re: number }[]): boolean => a.every((x, i) => Math.abs(x - (b[i]?.re ?? Number.NaN)) < 1e-6);

/** What the same-cell rows are built from. */
export interface SameCellSources {
  /** The conventional cell's factor group (irrepEngine: element i is the parent's operation i). */
  readonly group: FactorGroup;
  /** Its subgroup lattice: every subgroup that keeps the conventional cell. */
  readonly lattice: SupercellLattice;
  /** The irreps each class activates, over the Γ and decentring stars. */
  readonly analysis: readonly SubgroupIrreps[];
  /** The page's Γ and decentring trees (gammaIrrepTree, decentringIrrepTree): the irrep path's children. */
  readonly gammaTree: readonly IrrepBranch[] | null;
  readonly decentringTree: readonly DecentringBranch[] | null;
  /** The t-lattice's class representatives (withSubgroup) and the same-cell lattice's k- and general classes (withSameCellSubgroup). */
  readonly tNodes: readonly SubgroupNode[];
  readonly kNodes: readonly SameCellNode[];
  /** Whether the structure's atoms carry an irrep (its displacement multiplicity is not 0). */
  readonly moves?: (b: BoundIrrep) => boolean;
}

/**
 * The same-cell rows: every class of the conventional cell's lattice below the
 * parent, each with the action that reaches it by the older paths (see the
 * module comment).
 */
export function sameCellSubgroupRows(src: SameCellSources): SubgroupRow[] {
  const { group, lattice, analysis } = src;
  const classOfOps = (ops: readonly SymmetryOperation[]): number | null => lattice.classOf(elementsOf(group, ops));
  const branches = [...(src.gammaTree ?? []), ...(src.decentringTree ?? [])];
  const tOf = new Map<number, SubgroupNode>();
  for (const n of src.tNodes) {
    const c = classOfOps(n.operations);
    if (c !== null && !tOf.has(c)) tOf.set(c, n);
  }
  const kOf = new Map<number, SameCellNode>();
  for (const n of src.kNodes) {
    const c = classOfOps(n.operations);
    if (c !== null && !kOf.has(c)) kOf.set(c, n);
  }
  const rows: SubgroupRow[] = [];
  lattice.classes.forEach((cls) => {
    if (cls.kind === "parent") return;
    const r = analysis[cls.id]!;
    // The irrep path: a primary irrep the page's trees list, and its child in this class.
    let action: PickerAction | null = null;
    let identity: SubgroupIdentity | undefined;
    let gammaAlias: string | undefined;
    for (const p of r.primary) {
      const branch = branches.find((b) => sameCharacters(p.irrep.irrep.characters, b.term.irrep.characters));
      const sub = branch?.subgroups.find((s) => classOfOps(s.operations) === cls.id);
      if (branch && sub) {
        action = { kind: "irrep", term: branch.term, sub };
        identity = sub.identity;
        if (branch.term.irrep.label !== p.irrep.irrep.label) gammaAlias = `${p.irrep.irrep.label} is ${branch.term.irrep.label}`;
        break;
      }
    }
    if (!action) {
      const t = tOf.get(cls.id);
      const k = kOf.get(cls.id);
      if (t) {
        action = { kind: "subgroup", node: t };
        identity = t.identity;
      } else if (k) {
        action = { kind: "sameCell", node: k };
        identity = k.identity;
      } else {
        action = { kind: "elsewhere", note: "not offered" };
        identity = cls.identity;
      }
    }
    const id = identity ?? cls.identity!;
    rows.push({
      key: `s${cls.id}`,
      name: childName(id),
      cell: "same cell",
      index: cls.domainStates,
      domains: cls.domainStates,
      maximal: cls.maximal,
      sameCell: true,
      irreps: irrepsLine(r),
      detail: rowDetail({ cls, r, identity: id, box: [1, 1, 1], ...(src.moves ? { moves: src.moves } : {}), ...(gammaAlias ? { gammaAlias } : {}) }),
      action,
    });
  });
  return rows;
}

/** What the cell-multiplying rows are built from. */
export interface SupercellSources {
  /** The bound's factor group G/T″. */
  readonly group: FactorGroup;
  /** Its subgroup lattice (supercellSubgroups): the classes that keep a conjugate of the supercell. */
  readonly lattice: SupercellLattice;
  /** The irreps each class activates, over every star of the bound. */
  readonly analysis: readonly SubgroupIrreps[];
  /** The bound's label ("2×2×2"). */
  readonly bound: string;
  readonly moves?: (b: BoundIrrep) => boolean;
}

/**
 * The cell-multiplying rows: the bound lattice's classes that lose
 * translations of the conventional cell, each activated in its own cell
 * (withSupercellChild). The member is the By irrep child of the first
 * primary irrep when that keeps the bound's supercell (then the activation is
 * that child's, the irrep leading), else the lattice's member that keeps it,
 * the row's primary or coupled irreps preferred as the order parameter.
 */
export function supercellSubgroupRows(src: SupercellSources): SubgroupRow[] {
  const { group, lattice, analysis } = src;
  const rows: SubgroupRow[] = [];
  lattice.classes.forEach((cls) => {
    if (cls.kind === "parent" || !cls.cellMultiplying || !cls.identity) return;
    const r = analysis[cls.id]!;
    const p = r.primary[0];
    const own = p !== undefined && keepsSupercell(group, p.subgroup.elements);
    const elements = own ? p.subgroup.elements : cls.elements;
    const identity = own ? p.subgroup.identity : cls.identity;
    const box = periodicityBox(group, elements);
    const choice: SupercellChoice = {
      group,
      elements,
      identity,
      ...(p ? { primary: p.irrep.irrep.characters } : {}),
      ...(r.coupled ? { coupled: r.coupled.map((d) => d.irrep.irrep.characters) } : {}),
    };
    rows.push({
      key: `c${cls.id}`,
      name: childName(identity),
      cell: cellLabel(box),
      index: cls.domainStates,
      domains: cls.domainStates,
      maximal: cls.maximal,
      sameCell: false,
      irreps: irrepsLine(r),
      detail: rowDetail({ cls, r, identity, box, bound: src.bound, ...(src.moves ? { moves: src.moves } : {}) }),
      action: { kind: "supercell", choice },
    });
  });
  return rows;
}

/** The rows by index, each level's maximal subgroups first, then the same-cell ones, then the lattice's order. */
export function subgroupLevels(rows: readonly SubgroupRow[]): { readonly index: number; readonly rows: readonly SubgroupRow[] }[] {
  const byIndex = new Map<number, { row: SubgroupRow; at: number }[]>();
  rows.forEach((row, at) => {
    const list = byIndex.get(row.index) ?? [];
    list.push({ row, at });
    byIndex.set(row.index, list);
  });
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, list]) => ({
      index,
      rows: list.sort((a, b) => Number(b.row.maximal) - Number(a.row.maximal) || Number(b.row.sameCell) - Number(a.row.sameCell) || a.at - b.at).map((x) => x.row),
    }));
}

/** The By subgroup summary: one line, and its "?". */
export function subgroupSummary(o: {
  readonly parent: string;
  readonly bound: string;
  readonly sameCell: number;
  /** The cell-multiplying part: its row count and lattice, or null while it is not there. */
  readonly supercell: { readonly rows: number; readonly lattice: SupercellLattice } | null;
}): { readonly line: string; readonly detail: string } {
  const how = `Each row names the irreps that lower ${o.parent} to it: a primary irrep, one of whose isotropy subgroups it is (the child By irrep lists), or, when there is none, the fewest irreps coupled whose joint isotropy subgroup it is. The other irreps it allows, the secondary ones, are behind the row's "?". The cell is the parent's ("same cell"), or the multiple of the parent's cell along its axes that repeats the child's. Irreps carry generic labels ("R irrep 8 of 10"), not ISODISTORT's.`;
  if (!o.supercell) {
    return { line: `${plural(o.sameCell, "subgroup")} keep the cell`, detail: `The subgroups of ${o.parent} that keep its conventional cell, by index. ${how}` };
  }
  const exact = o.supercell.lattice.classes.filter((c) => c.supercellLattice);
  const twice = exact.filter((c) => c.enantiomorph).length;
  const total = o.sameCell + o.supercell.rows;
  return {
    line: `${plural(total, "subgroup")} fit the ${o.bound} cell`,
    detail: `The subgroups of ${o.parent} whose cell fits the ${o.bound} supercell, one per conjugacy class, by index: ${o.sameCell} keep the conventional cell, ${o.supercell.rows} need a larger one. ${exact.length} have exactly the ${o.bound} lattice, the list Bilbao's SUBGROUPS gives for that supercell${twice > 0 ? ` (${exact.length + twice} entries there, enantiomorphs apart)` : ""}. ${how}`,
  };
}

/** The structure's displacement multiplicity of each irrep on the group's cell (displacementCharacters); undefined without a structure. */
export function multiplicitiesOf(structure: StructureModel | undefined, group: FactorGroup): ((b: BoundIrrep) => number) | undefined {
  if (!structure) return undefined;
  let chi: Float64Array;
  try {
    chi = displacementCharacters(structure, group);
  } catch {
    return undefined;
  }
  return (b) => displacementMultiplicity(chi, b.irrep.characters);
}

/**
 * The By subgroup view's same-cell rows, from the parent's operations and the
 * page's trees: the conventional cell's lattice and its Γ and decentring
 * irreps (irrepEngine, fast), matched to the t-lattice, the same-cell
 * lattice's k- and general classes and the Γ and decentring trees.
 */
export function sameCellListing(o: {
  readonly operations: readonly SymmetryOperation[];
  readonly structure?: StructureModel;
  readonly tTree: StructuralSubgroupTree;
  readonly gammaTree: readonly IrrepBranch[] | null;
  readonly decentringTree: readonly DecentringBranch[] | null;
  readonly kNodes: readonly SameCellNode[];
}): SubgroupRow[] {
  const engine = irrepEngine(o.operations);
  const group = engine.group;
  const lattice = cachedSupercellSubgroups(group);
  const m = multiplicitiesOf(o.structure, group);
  const analysis = subgroupIrreps(group, boundIrreps(group, engine.stars), lattice, m ? { multiplicity: m } : {});
  return sameCellSubgroupRows({
    group,
    lattice,
    analysis,
    gammaTree: o.gammaTree,
    decentringTree: o.decentringTree,
    tNodes: subgroupClassRepresentatives(o.tTree).filter((n) => !n.isParent),
    kNodes: o.kNodes,
    ...(m ? { moves: (b: BoundIrrep) => m(b) > 0 } : {}),
  });
}

/**
 * The By subgroup view's cell-multiplying rows for the bound's factor group:
 * its lattice, every star's irreps and their isotropy subgroups (all cached,
 * so a caller that warmed them step by step computes only the matching), and
 * the rows. Throws SubgroupSearchTooLarge for a bound above the search's
 * ceiling.
 */
export function supercellListing(group: FactorGroup, structure: StructureModel | undefined, bound: string): { readonly rows: SubgroupRow[]; readonly lattice: SupercellLattice } {
  const lattice = cachedSupercellSubgroups(group);
  const stars = starsInBound(group).map((k) => cachedIrrepsOfStar(group, [rnum(k[0]), rnum(k[1]), rnum(k[2])]));
  const m = multiplicitiesOf(structure, group);
  const analysis = subgroupIrreps(group, boundIrreps(group, stars), lattice, m ? { multiplicity: m } : {});
  return { rows: supercellSubgroupRows({ group, lattice, analysis, bound, ...(m ? { moves: (b: BoundIrrep) => m(b) > 0 } : {}) }), lattice };
}
