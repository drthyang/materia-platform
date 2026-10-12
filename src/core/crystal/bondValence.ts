/**
 * Bond-valence sums (Brown & Altermatt 1985; Brese & O'Keeffe 1991): a
 * cation–anion bond of length R carries the valence s = exp((R₀ − R)/b),
 * b = 0.37 Å, and a cation's bonds add up to its oxidation state, within about
 * 0.1–0.2 valence units in a sound structure. It is how a crystallographer
 * judges refined bond lengths: a sum far from the formal valence is a wrong
 * position, a wrong element on the site (antisite disorder, a swapped
 * assignment), or a strained or mixed-valent site.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";
import { fractionalToCartesian } from "@/core/crystal/unitCell";
import { equivalentPositions } from "@/core/crystal/symmetry";
import { wrapFractional, sub, norm } from "@/core/math/vec3";

const B = 0.37;

/** R₀ (Å) against O²⁻, by cation and oxidation state (Brese & O'Keeffe 1991; Brown & Altermatt 1985). */
const R0_OXIDE: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  Li: { 1: 1.466 }, Na: { 1: 1.803 }, K: { 1: 2.132 }, Rb: { 1: 2.263 }, Cs: { 1: 2.417 },
  Be: { 2: 1.381 }, Mg: { 2: 1.693 }, Ca: { 2: 1.967 }, Sr: { 2: 2.118 }, Ba: { 2: 2.285 },
  B: { 3: 1.371 }, Al: { 3: 1.651 }, Ga: { 3: 1.730 }, In: { 3: 1.902 },
  C: { 4: 1.390 }, Si: { 4: 1.624 }, Ge: { 4: 1.748 }, Sn: { 2: 1.984, 4: 1.905 }, Pb: { 2: 2.112, 4: 2.042 },
  N: { 5: 1.432 }, P: { 5: 1.617 }, As: { 3: 1.789, 5: 1.767 }, Sb: { 3: 1.973, 5: 1.942 }, Bi: { 3: 2.094 },
  S: { 4: 1.644, 6: 1.624 }, Se: { 4: 1.811, 6: 1.788 }, Te: { 4: 1.977, 6: 1.917 },
  Sc: { 3: 1.849 }, Y: { 3: 2.019 }, La: { 3: 2.172 },
  Ce: { 3: 2.151, 4: 2.028 }, Pr: { 3: 2.138 }, Nd: { 3: 2.117 }, Sm: { 3: 2.088 }, Eu: { 3: 2.074 },
  Gd: { 3: 2.065 }, Tb: { 3: 2.049 }, Dy: { 3: 2.036 }, Ho: { 3: 2.023 }, Er: { 3: 2.010 },
  Tm: { 3: 2.000 }, Yb: { 3: 1.985 }, Lu: { 3: 1.971 },
  Ti: { 3: 1.791, 4: 1.815 }, Zr: { 4: 1.937 }, Hf: { 4: 1.923 },
  V: { 3: 1.743, 4: 1.784, 5: 1.803 }, Nb: { 5: 1.911 }, Ta: { 5: 1.920 },
  Cr: { 2: 1.73, 3: 1.724, 6: 1.794 }, Mo: { 6: 1.907 }, W: { 6: 1.917 },
  Mn: { 2: 1.790, 3: 1.760, 4: 1.753 }, Fe: { 2: 1.734, 3: 1.759 }, Co: { 2: 1.692, 3: 1.70 },
  Ni: { 2: 1.654 }, Cu: { 2: 1.679 }, Zn: { 2: 1.704 }, Cd: { 2: 1.904 },
  Th: { 4: 2.167 }, U: { 4: 2.112, 6: 2.075 },
};

/** R₀ (Å) against F⁻ (Brese & O'Keeffe 1991). */
const R0_FLUORIDE: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  Li: { 1: 1.360 }, Na: { 1: 1.677 }, K: { 1: 1.992 }, Mg: { 2: 1.581 }, Ca: { 2: 1.842 },
  Sr: { 2: 2.019 }, Ba: { 2: 2.188 }, Al: { 3: 1.545 },
};

const ANIONS: Readonly<Record<string, Readonly<Record<string, Readonly<Record<number, number>>>>>> = { O: R0_OXIDE, F: R0_FLUORIDE };

export interface BondValenceSum {
  readonly site: string;
  readonly element: string;
  /** The oxidation state the sum is read against. */
  readonly valence: number;
  /** True when the structure gave no oxidation state and the state closest to its own sum was taken. */
  readonly assumed: boolean;
  /** Anion neighbours within the cutoff (occupancy-weighted count). */
  readonly coordination: number;
  /** Mean cation–anion distance of the first shell (Å). */
  readonly meanDistance: number;
  /** Σ s over the anion neighbours (valence units). */
  readonly sum: number;
  /** (sum − valence)/valence. */
  readonly deviation: number;
}

/** The non-metals and the metalloids that bond covalently in a molecule: no bond-valence sum for them there. */
const NON_METALS: ReadonlySet<string> = new Set(["H", "D", "B", "C", "N", "O", "F", "Si", "P", "S", "Cl", "Ge", "As", "Se", "Br", "Sb", "Te", "I", "He", "Ne", "Ar", "Kr", "Xe"]);

/** Every symmetry-generated position of each site in the cell. */
function cellAtoms(model: StructureModel): { label: string; element: string; occupancy: number; frac: Vec3 }[] {
  const atoms: { label: string; element: string; occupancy: number; frac: Vec3 }[] = [];
  for (const site of model.sites) {
    // Periodic, and coarse enough for a CIF's rounded special positions (0.3333, 0.6667).
    for (const p of equivalentPositions(model.spaceGroup.operations, site.position)) atoms.push({ label: site.label, element: site.element, occupancy: site.occupancy, frac: p });
  }
  return atoms;
}

/**
 * The bond-valence sum of every cation site with tabulated R₀ against the
 * structure's anions (O²⁻, F⁻), from all anion neighbours within `cutoff`
 * (each weighted by its site occupancy). The valence is the site's oxidation
 * state when the structure carries one (a CIF type symbol "W6+"), else the
 * tabulated state closest to the sum it gives (marked `assumed`).
 */
export function bondValenceSums(model: StructureModel, cutoff = 3.5): BondValenceSum[] {
  const atoms = cellAtoms(model).filter((a) => a.element in ANIONS);
  if (atoms.length === 0) return [];
  // In a molecular structure (one with carbon) the non-metals' bonds are covalent: only its metals' sums describe cation–anion bonds.
  const molecular = model.sites.some((s) => s.element === "C");
  const out: BondValenceSum[] = [];
  for (const site of model.sites) {
    if (site.element in ANIONS) continue;
    if (molecular && NON_METALS.has(site.element)) continue;
    const tables = new Set(atoms.map((a) => a.element));
    if (![...tables].some((an) => ANIONS[an]![site.element])) continue;
    const origin = fractionalToCartesian(model.cell, wrapFractional(site.position));
    const neighbours: { element: string; occupancy: number; distance: number }[] = [];
    for (const atom of atoms) {
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) {
          for (let dc = -1; dc <= 1; dc++) {
            const cart = fractionalToCartesian(model.cell, [atom.frac[0] + da, atom.frac[1] + db, atom.frac[2] + dc]);
            const distance = norm(sub(cart, origin));
            if (distance > 0.5 && distance <= cutoff) neighbours.push({ element: atom.element, occupancy: atom.occupancy, distance });
          }
        }
      }
    }
    if (neighbours.length === 0) continue;
    const sumFor = (state: number): number | null => {
      let total = 0;
      for (const n of neighbours) {
        const r0 = ANIONS[n.element]?.[site.element]?.[state];
        if (r0 === undefined) return null;
        total += n.occupancy * Math.exp((r0 - n.distance) / B);
      }
      return total;
    };
    const states = Object.keys(R0_OXIDE[site.element] ?? R0_FLUORIDE[site.element] ?? {}).map(Number);
    const given = site.oxidationState !== undefined && site.oxidationState > 0 ? site.oxidationState : undefined;
    let valence: number | undefined;
    let sum: number | null = null;
    if (given !== undefined) {
      valence = given;
      sum = sumFor(given);
    } else {
      for (const st of states) {
        const s = sumFor(st);
        if (s !== null && (sum === null || Math.abs(s - st) < Math.abs(sum - valence!))) {
          valence = st;
          sum = s;
        }
      }
    }
    if (valence === undefined || sum === null) continue;
    // The first shell: the bonds within 1.25 × the shortest (a fair coordination count).
    const shortest = Math.min(...neighbours.map((n) => n.distance));
    const shell = neighbours.filter((n) => n.distance <= 1.25 * shortest);
    const weight = shell.reduce((s, n) => s + n.occupancy, 0);
    out.push({
      site: site.label,
      element: site.element,
      valence,
      assumed: given === undefined,
      coordination: weight,
      meanDistance: shell.reduce((s, n) => s + n.occupancy * n.distance, 0) / weight,
      sum,
      deviation: (sum - valence) / valence,
    });
  }
  return out;
}

/** One line on the sums: which agree with their valence, which do not and what that usually means. */
export function bondValenceReading(sums: readonly BondValenceSum[]): string {
  if (sums.length === 0) return "No cation here has tabulated bond-valence parameters against these anions.";
  const show = (v: BondValenceSum): string => `${v.site} ${v.sum.toFixed(2)} (${v.element}${v.valence}+${v.assumed ? ", assumed" : ""})`;
  const off = sums.filter((v) => Math.abs(v.deviation) > 0.15);
  const strained = sums.filter((v) => Math.abs(v.deviation) > 0.08 && Math.abs(v.deviation) <= 0.15);
  if (off.length === 0 && strained.length === 0) return `Bond-valence sums agree with the valences (within 8 %): ${sums.map(show).join(", ")}.`;
  return [
    `Bond-valence sums: ${sums.map(show).join(", ")}.`,
    ...(off.length ? [`${off.map((v) => v.site).join(", ")} ${off.length === 1 ? "is" : "are"} more than 15 % from the valence: an over-bonded site (sum high) has bonds too short or a lighter or lower-valent element than modelled; an under-bonded one (sum low) the reverse. Check the positions, the site's element (antisite disorder) and the oxidation state.`] : []),
    ...(strained.length ? [`${strained.map((v) => v.site).join(", ")} ${strained.length === 1 ? "is" : "are"} 8–15 % off: strained or a mixed valence; worth a sentence in the report.`] : []),
  ].join(" ");
}
