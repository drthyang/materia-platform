/**
 * The 3D Model's distortion modes grouped by k-point and by parent site, as
 * data: DistortionModesPanel draws the chips, the rows and the Free all / Fix
 * all buttons from these groups, and the PDF page highlights the chosen site's
 * atoms. The groups hold only the modes the mode set in force has: an
 * activated child lists the irreps active in it, nothing else of the parent's.
 *
 * - **k-point.** A mode by parent irrep (a supercell child, a decomposition, a
 *   mode CIF) is at its irrep's k. The chip is named as the Subgroups page
 *   names it (starChipId): Γ, the star's name (X, M, R…), else its
 *   coordinates. A mode set without irreps (a same-cell activation, the
 *   structure's own modes) groups by each mode's star ("Γ", "X"…). A mode with
 *   neither is "other".
 * - **Parent site.** A mode by parent irrep moves one parent site
 *   (irrep.parentSite). It is named by its element, with the Wyckoff site
 *   ("O (4e)") only when the parent has the element on more than one site. A
 *   mode set without irreps groups by element: a mode is under each element
 *   whose sites it moves.
 * - **Totals.** In quadrature, as the irrep totals are (A = √ΣA_i², then
 *   ISODISTORT's A_s and A_p of it).
 *
 * UI only: the labels here are the app's; no Agent or MCP text reads them.
 */

import type { Vec3 } from "@/core/math/types";
import type { DistortionMode, DistortionModeSet } from "@/core/crystal/distortionModes";
import type { RefinementParameter } from "@/core/refinement/types";
import { isodistortAmplitudes } from "@/core/crystal/distortionModes";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { siteMultiplicity } from "@/core/crystal/symmetry";
import { WYCKOFF_TABLE } from "@/core/crystal/wyckoff";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { starName } from "@/core/crystal/irreps/spaceGroupIrreps";
import { starChipId } from "@/app/ui/subgroupPicker";
import { starShort } from "@/app/ui/subgroupList";
import { isLocked } from "@/app/ui/parameterGroups";

/** One k-point chip: the modes at that k. */
export interface ModeKGroup {
  /** Unique: the star's name ("Γ", "R"), its coordinates, or "other". */
  readonly id: string;
  /** What the chip says ("R", "(0,½,0)"). */
  readonly label: string;
  /** The representative k (parent's conventional reciprocal basis), when known. */
  readonly k: Vec3 | null;
  /** Parent cells one arm's wave repeats over (1 at Γ and the decentring points); null when k is unknown. */
  readonly cellMultiple: number | null;
  readonly modeIds: readonly string[];
}

/** One parent-site chip: the modes that move it. */
export interface ModeSiteGroup {
  /** Unique: the parent site's label, or "el:<element>" for a set without irreps. */
  readonly id: string;
  /** What the chip says: "O", or "O (4e)" when the element has more than one parent site. */
  readonly label: string;
  /** The site in words, for the chip's tooltip. */
  readonly title: string;
  readonly element: string;
  /** The child sites (labels in the fitted structure) the 3D view highlights. */
  readonly childSites: readonly string[];
  readonly modeIds: readonly string[];
}

export interface ModeGroups {
  /** Γ first, then by |k|; empty when no mode has a k. */
  readonly ks: readonly ModeKGroup[];
  /** In the parent's site order (or the child's for a set without irreps). */
  readonly sites: readonly ModeSiteGroup[];
}

/** The chips chosen: null is "all". */
export interface ModeFilter {
  readonly k: string | null;
  readonly site: string | null;
}

export const ALL_MODES: ModeFilter = { k: null, site: null };

const OTHER = "other";

/** The smallest n with n·k integral (denominators up to 24): the parent cells one arm's wave repeats over. */
function cellMultipleOf(k: Vec3): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let n = 1;
  for (const x of k) {
    let d = 1;
    while (d < 24 && Math.abs(x * d - Math.round(x * d)) > 1e-6) d++;
    n = (n * d) / gcd(n, d);
  }
  return n;
}

/** The parent's factor group, for naming a k a mode CIF gave without its star (an ISODISTORT file). */
function parentGroupOf(set: DistortionModeSet): FactorGroup | null {
  const number = set.parent?.number;
  if (number === undefined) return null;
  try {
    return factorGroup(buildSpaceGroup(number).operations);
  } catch {
    return null;
  }
}

/** A mode's k-chip id and representative k. */
function kOfMode(mode: DistortionMode, group: () => FactorGroup | null): { id: string; k: Vec3 | null } {
  if (mode.irrep) {
    const k = mode.irrep.k;
    const named = mode.star && !mode.star.startsWith("k") ? mode.star : (() => {
      const g = group();
      try {
        return g ? starName(g, k) : null;
      } catch {
        return null;
      }
    })();
    return { id: starChipId(k, named), k };
  }
  if (mode.star) return { id: mode.star, k: mode.star === "Γ" ? [0, 0, 0] : null };
  return { id: OTHER, k: null };
}

/** The weight a chip sorts by: Γ first, then the shorter k, then by name. */
const kWeight = (g: ModeKGroup): number => (g.id === OTHER ? Infinity : g.k ? g.k.reduce((s, x) => s + Math.abs(x), 0) : 100);

/** The Wyckoff site of a parent site ("4e"), when the repository's table has the parent's group. */
function wyckoffOf(set: DistortionModeSet, letter: string | undefined): string | null {
  const number = set.parent?.number;
  if (!letter || number === undefined) return null;
  const entry = WYCKOFF_TABLE[number]?.find((e) => e.letter === letter);
  if (!entry) return letter;
  try {
    return `${siteMultiplicity(buildSpaceGroup(number).operations, entry.coord)}${letter}`;
  } catch {
    return letter;
  }
}

/** Whether a mode moves a child site (a non-zero axis on it). */
const moves = (mode: DistortionMode, site: string): boolean => mode.axes.some((a) => a.siteLabel === site && a.axis.some((x) => Math.abs(x) > 1e-12));

/** The k-point and parent-site groups of a mode set. */
export function modeGroups(set: DistortionModeSet): ModeGroups {
  let group: FactorGroup | null | undefined;
  const lazyGroup = (): FactorGroup | null => (group === undefined ? (group = parentGroupOf(set)) : group);

  // k-points.
  const ks = new Map<string, { k: Vec3 | null; ids: string[] }>();
  for (const mode of set.modes) {
    const { id, k } = kOfMode(mode, lazyGroup);
    const g = ks.get(id) ?? { k, ids: [] };
    g.ids.push(mode.id);
    ks.set(id, g);
  }
  const kGroups: ModeKGroup[] = [...ks].map(([id, g]) => ({
    id,
    label: id === OTHER ? "other" : starShort(id.replace(/^k\s*=\s*/, "")),
    k: g.k,
    cellMultiple: g.k ? cellMultipleOf(g.k) : null,
    modeIds: g.ids,
  }));
  kGroups.sort((a, b) => kWeight(a) - kWeight(b) || a.label.localeCompare(b.label));
  const noK = kGroups.length === 1 && kGroups[0]!.id === OTHER;

  // Parent sites.
  const child = set.parentized.sites;
  const elementOfChild = new Map(child.map((s) => [s.label, s.element] as const));
  const sites: ModeSiteGroup[] = [];
  if (set.modes.length > 0 && set.modes.every((m) => m.irrep)) {
    const parentSites = set.parent?.sites ?? [];
    const order = [...new Set([...parentSites.map((s) => s.label), ...set.modes.map((m) => m.irrep!.parentSite)])];
    for (const label of order) {
      const members = set.modes.filter((m) => m.irrep!.parentSite === label);
      if (members.length === 0) continue;
      const info = parentSites.find((s) => s.label === label);
      const element = info?.element ?? elementOfChild.get(members[0]!.axes[0]?.siteLabel ?? "") ?? label;
      const sameElement = parentSites.length > 0 ? parentSites.filter((s) => s.element === element).length : new Set(set.modes.filter((m) => elementOfChild.get(m.axes[0]?.siteLabel ?? "") === element).map((m) => m.irrep!.parentSite)).size;
      const wyckoff = wyckoffOf(set, info?.wyckoff);
      const moved = [...new Set(members.flatMap((m) => m.axes.map((a) => a.siteLabel)))];
      // One parent site of the element: every child site of it is that site's (the ones no mode moves too).
      const childSites = sameElement <= 1 ? child.filter((s) => s.element === element).map((s) => s.label) : child.filter((s) => moved.includes(s.label)).map((s) => s.label);
      sites.push({
        id: label,
        label: sameElement <= 1 ? element : wyckoff ? `${element} (${wyckoff})` : label,
        title: `the parent's site ${label}${wyckoff ? ` (Wyckoff ${wyckoff})` : ""}`,
        element,
        childSites,
        modeIds: members.map((m) => m.id),
      });
    }
    // Two sites of one element on the same Wyckoff site (two 4e in P2₁/c): name them apart.
    const named = sites.map((s) => (sites.filter((t) => t.label === s.label).length > 1 ? { ...s, label: s.label.endsWith(")") ? `${s.label.slice(0, -1)}, ${s.id})` : `${s.label} (${s.id})` } : s));
    sites.splice(0, sites.length, ...named);
  } else {
    for (const element of [...new Set(child.map((s) => s.element))]) {
      const own = child.filter((s) => s.element === element).map((s) => s.label);
      const members = set.modes.filter((m) => own.some((l) => moves(m, l)));
      if (members.length === 0) continue;
      sites.push({ id: `el:${element}`, label: element, title: `the ${element} sites (${own.join(", ")})`, element, childSites: own, modeIds: members.map((m) => m.id) });
    }
  }
  return { ks: noK ? [] : kGroups, sites };
}

/** The modes a filter keeps, in the set's order. */
export function selectedModes(set: DistortionModeSet, groups: ModeGroups, filter: ModeFilter): DistortionMode[] {
  const inK = filter.k !== null ? new Set(groups.ks.find((g) => g.id === filter.k)?.modeIds ?? []) : null;
  const inSite = filter.site !== null ? new Set(groups.sites.find((g) => g.id === filter.site)?.modeIds ?? []) : null;
  return set.modes.filter((m) => (!inK || inK.has(m.id)) && (!inSite || inSite.has(m.id)));
}

/** A group's total, in quadrature as the irrep totals are: A, and ISODISTORT's A_s and A_p of it. */
export function modesTotal(modes: readonly { readonly id: string }[], params: readonly RefinementParameter[], cells: { readonly child: number; readonly parent: number }): { readonly a: number; readonly as: number; readonly ap: number } {
  const a = Math.hypot(...modes.map((m) => params.find((p) => p.id === m.id)?.value ?? 0));
  return { a, ...isodistortAmplitudes(a, cells) };
}

/**
 * The row edits Free all / Fix all makes on a group: one { fixed } per row, as
 * the per-row toggle makes it, skipping the rows the toggles leave alone.
 */
export function bulkFixed(modes: readonly DistortionMode[], params: readonly RefinementParameter[], fixed: boolean): { readonly id: string; readonly fixed: boolean }[] {
  return modes.flatMap((m) => {
    const p = params.find((q) => q.id === m.id);
    return p && !isLocked(p) ? [{ id: m.id, fixed }] : [];
  });
}

/** The child sites a filter highlights in 3D: its site's, or none for "all sites". */
export function highlightedSites(groups: ModeGroups, filter: ModeFilter): readonly string[] | null {
  if (filter.site === null) return null;
  return groups.sites.find((g) => g.id === filter.site)?.childSites ?? null;
}
