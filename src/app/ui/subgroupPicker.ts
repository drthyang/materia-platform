/**
 * The Subgroups page's one path, as data: a k-point chip, its irreps, each
 * irrep's children, and what Activate does on a child. The page renders these
 * rows and dispatches the action; the tests walk the same rows, so a child
 * reached through a chip is the child the old panels activated.
 *
 *   - Γ and the decentring points of a centred parent (X for F, H for I) keep
 *     the conventional cell: their rows are the existing same-cell trees
 *     (gammaIrrepTree, decentringIrrepTree) and Activate lowers the symmetry in
 *     the parent's cell (withActivatedMode).
 *   - The cell-multiplying stars of the supercell bound (Pm-3m X, M, R; Fm-3m
 *     L, W; …): their irreps and isotropy subgroups come from the irrep engine,
 *     one k-point at a time, on request (seconds on a large bound), and Activate
 *     realises the child in its own cell (withSupercellChild), the irrep it was
 *     picked from leading the kick.
 *
 * Irrep labels are the engine's generic ones ("R irrep 8 of 10", ADR 0004).
 */

import type { Vec3 } from "@/core/math/types";
import type { SupercellChoice } from "@/app/pdfPage";
import type { DisplaciveIrrepTerm } from "@/core/crystal/displaciveModes";
import type { SubgroupIdentity } from "@/core/crystal/isotropyTree";
import { starsInBound, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { formatK, irrepsOfStar, starName } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups } from "@/core/crystal/irreps/isotropy";
import { rnum } from "@/core/crystal/irreps/rational";
import type { SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import type { DecentringBranch, IrrepBranch, IrrepSubgroup } from "@/app/ui/SubgroupsPanel";
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
  /** Realise a cell-multiplying child in its own cell (withSupercellChild). */
  | { readonly kind: "supercell"; readonly choice: SupercellChoice }
  /** Nothing here: the child keeps the cell and is activated from a same-cell chip. */
  | { readonly kind: "elsewhere"; readonly note: string };

/** One child: its name, one line of facts, the rest for a tooltip, and its action. */
export interface PickerChild {
  readonly name: string;
  readonly facts: string;
  readonly detail: string;
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

/** The rows of a same-cell tree (Γ or one decentring star): the existing irreps and their isotropy subgroups. */
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
        facts: `${sub.direction} · ${sub.domainStates} domains`,
        detail: sameCellDetail(sub, dim),
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
 * representations at its k and their isotropy subgroups (irrep engine). This is
 * the slow step (seconds on a large bound); the page runs it on request.
 */
export function supercellRows(group: FactorGroup, k: Vec3): PickerIrrep[] {
  const star = irrepsOfStar(group, k);
  return star.physical.map((p) => {
    const subs = isotropySubgroups(group, p).subgroups;
    return {
      label: p.label,
      facts: `dim ${p.dim} · ${plural(star.star.arms.length, "arm")}`,
      detail: `k = ${formatK(star.star.k)}, ${plural(star.star.arms.length, "arm")}; a physically irreducible representation. Its isotropy subgroups, one per order-parameter direction, are named in the ITA standard setting; hover a name for its basis from the parent's cell.`,
      children: subs.map((s) => ({
        name: childName(s.identity),
        facts: `${s.direction.symbol} · ${s.domainStates} domains`,
        detail: [
          `Index ${s.index.t}·${s.index.k} (point group · translations); ${plural(s.orientationStates, "orientation")}, ${s.domainStates} domain states; arms ${s.activeArms.join(", ")}${s.kernel ? "; the irrep's kernel" : ""}.`,
          childBasisNote(s.identity) ? `Its cell: ${childBasisNote(s.identity)}.` : "",
        ].filter((x) => x !== "").join(" "),
        action: s.cellMultiplying
          ? { kind: "supercell", choice: { group, elements: s.elements, identity: s.identity, primary: p.characters } } as const
          : { kind: "elsewhere", note: "same cell: under Γ" } as const,
      })),
    };
  });
}

/** The cell-multiplying classes of the supercell lattice (By subgroup), each a child that activates in its own cell. */
export function supercellLatticeChildren(group: FactorGroup, lattice: SupercellLattice): PickerChild[] {
  return lattice.classes
    .filter((c) => c.cellMultiplying && c.kind !== "parent" && c.identity)
    .map((c) => ({
      name: childName(c.identity),
      facts: `${c.kind} · ${c.index.t}·${c.index.k} · ${c.domainStates} domains${c.maximal ? " · maximal" : ""}`,
      detail: [
        `${c.kind}${c.isomorphic ? " (isomorphic)" : ""} subgroup, index ${c.index.t}·${c.index.k} (point group · translations); ${plural(c.orientationStates, "orientation")}, ${c.domainStates} domain states${c.supercellLattice ? "; its lattice is the supercell's" : ""}.`,
        c.enantiomorph ? `Its class also holds ${childName(c.enantiomorph)} (enantiomorphs; Bilbao's SUBGROUPS lists them as two entries).` : "",
        childBasisNote(c.identity) ? `Its cell: ${childBasisNote(c.identity)}.` : "",
        c.coveredBy.length ? `Covered by ${c.coveredBy.map((u) => childName(lattice.classes[u]!.identity)).join(", ")}.` : "",
      ].filter((x) => x !== "").join(" "),
      action: { kind: "supercell", choice: { group, elements: c.elements, identity: c.identity! } } as const,
    }));
}
