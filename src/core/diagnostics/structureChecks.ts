/**
 * The physical checks of a refined structure, read after every refinement
 * (the user's rules, 2026-10-19): atoms too close, bonds shorter than their
 * bond-valence length, U_iso too large or too small, and a heavier atom
 * vibrating more than a lighter one. A hard failure is a structure that
 * cannot be (two atoms under 1 Å apart, U above the hard limit): the run is
 * taken back and put to the user. A warning is unusual and reported; it can
 * be right. A negative U is the parameters' check (assessment.ts).
 *
 * Read at room temperature: the U limits are room-temperature values, and a
 * fit at low or high temperature reads them with that in mind.
 */

import type { AtomSite, StructureModel } from "@/core/crystal/types";
import { bondLengths } from "@/core/crystal/geometry";
import { bondValenceR0, bondValenceSums, expectedBondLength } from "@/core/crystal/bondValence";
import { atomicWeight } from "@/core/crystal/atomicMass";
import type { AssessmentFinding } from "@/core/diagnostics/assessment";
import { BOND_SHORT, DISTANCE_HARD, DISTANCE_WARN, OCCUPANCY_FULL, U_HARD, U_LARGE, U_ORDER_MIN, U_ORDER_RATIO, U_SMALL } from "@/core/diagnostics/thresholds";

const EIGHT_PI2 = 8 * Math.PI * Math.PI;
/** A site at or above this occupancy counts as fully occupied. */
const FULL = OCCUPANCY_FULL;
/** The anions the bond-valence lengths are tabulated against. */
const ANIONS = new Set(["O", "F"]);
/** Anions within R₀ + this (Å) of a cation are its first shell, for the bond-valence length. */
const SHELL_WINDOW = 1.0;

const isHydrogen = (element: string): boolean => element === "H" || element === "D";
const uIsoOf = (site: AtomSite): number | undefined => (site.adp.kind === "isotropic" ? site.adp.bIso / EIGHT_PI2 : undefined);
const fmtU = (u: number): string => u.toFixed(u < 0.01 ? 4 : 3);

export function structureChecks(model: StructureModel, phase?: string): AssessmentFinding[] {
  const findings: AssessmentFinding[] = [];
  const where = phase ? ` (${phase})` : "";
  const site = new Map(model.sites.map((s) => [s.label, s]));

  // ── distances ─────────────────────────────────────────────────────────
  const bonds = bondLengths(model, Math.max(DISTANCE_WARN, 3.2));
  const checked = bonds.filter((b) => {
    const a = site.get(b.from);
    const c = site.get(b.to);
    if (!a || !c || isHydrogen(a.element) || isHydrogen(c.element)) return false;
    // Two partly occupied sites whose occupancies add to at most 1 need never be present together.
    return !(a.occupancy < FULL && c.occupancy < FULL && a.occupancy + c.occupancy <= 1 + 1e-3);
  });
  const seen = new Set<string>();
  const once = (b: { from: string; to: string; distance: number }): boolean => {
    const key = `${[b.from, b.to].sort().join("–")}@${b.distance.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  for (const b of checked.filter((x) => x.distance < DISTANCE_WARN && once(x))) {
    const hard = b.distance < DISTANCE_HARD;
    findings.push({
      category: "physical",
      severity: hard ? "critical" : "warning",
      summary: `${b.from}–${b.to}${where} is ${b.distance.toFixed(3)} Å, ${hard ? `under the ${DISTANCE_HARD} Å two atoms cannot be closer than` : `under the ${DISTANCE_WARN} Å a bond is rarely shorter than`}.`,
      detail: hard
        ? "Two atoms this close cannot both be there: a position has run off (refined against misfit it does not describe), or the site is a split one that needs its occupancy tied. Take the run back and put it to the user."
        : "Unusual for any bond but one to H. Check the positions against the chemistry (bond_geometry); a split or disordered site needs its occupancies tied so the two are never present together.",
      evidence: { from: b.from, to: b.to, distance: b.distance },
    });
  }

  // ── bonds against their bond-valence length ──────────────────────────
  for (const sum of bondValenceSums(model)) {
    const shell = checked.filter((b) => b.from === sum.site && ANIONS.has(site.get(b.to)?.element ?? "") && b.distance >= DISTANCE_WARN);
    for (const anion of new Set(shell.map((b) => site.get(b.to)!.element))) {
      const r0 = bondValenceR0(sum.element, sum.valence, anion);
      if (r0 === undefined) continue;
      // The site's first shell (bondValence.ts: within 1.25 × its shortest bond); the bond list holds each distinct bond once.
      const first = shell.filter((b) => site.get(b.to)!.element === anion && b.distance <= r0 + SHELL_WINDOW);
      const coordination = sum.coordination;
      const expected = expectedBondLength(sum.element, sum.valence, anion, coordination);
      if (expected === undefined) continue;
      const short = first.filter((b) => b.distance < (1 - BOND_SHORT) * expected && once({ ...b, to: `${b.to}#bv` }));
      if (short.length === 0) continue;
      const worst = short.reduce((a, b) => (b.distance < a.distance ? b : a));
      findings.push({
        category: "physical",
        severity: "warning",
        summary: `${worst.from}–${worst.to}${where} is ${worst.distance.toFixed(3)} Å, ${(100 * (1 - worst.distance / expected)).toFixed(0)}% shorter than the ${expected.toFixed(2)} Å bond-valence length of ${sum.element}${sum.valence}+–${anion} in ${coordination.toFixed(0)}-fold coordination${short.length > 1 ? ` (${short.length} bonds of ${sum.site} more than ${100 * BOND_SHORT}% short)` : ""}.`,
        detail: `A bond this short puts more valence on the cation than it has${sum.assumed ? ` (its valence ${sum.valence}+ was taken as the one closest to its sum; give the oxidation state if it differs)` : ""}. It can be right (a short apical bond, a vanadyl); otherwise the position has moved against misfit it does not describe. Read bond_geometry and put it to the user.`,
        evidence: { from: worst.from, to: worst.to, distance: worst.distance, expected, valence: sum.valence },
      });
    }
  }

  // ── U_iso, fully occupied sites ──────────────────────────────────────
  const full = model.sites.filter((s) => s.occupancy >= FULL && !isHydrogen(s.element) && uIsoOf(s) !== undefined);
  for (const s of full) {
    const u = uIsoOf(s)!;
    if (u < 0) continue;
    if (u > U_LARGE) {
      const hard = u > U_HARD;
      findings.push({
        category: "physical",
        severity: hard ? "critical" : "warning",
        summary: `U_iso of ${s.label}${where} is ${fmtU(u)} Å² (B ${(u * EIGHT_PI2).toFixed(2)} Å²), above the ${hard ? `${U_HARD} Å² hard limit` : `${U_LARGE} Å² a fully occupied site rarely exceeds`} at room temperature.`,
        detail: hard
          ? "A U this large is a site the data barely see: the occupancy, the element or the position is wrong, or it absorbs a misfit (background, absorption). It can be right (a rattling atom, a high temperature): take the run back and put it to the user."
          : "It can be right (a rattling atom in a cage, a high temperature, static disorder); otherwise check the occupancy, the element, and whether the background or absorption is taking intensity. Say so in the report.",
        evidence: { site: s.label, uIso: u },
      });
    } else if (u < U_SMALL) {
      findings.push({
        category: "physical",
        severity: "warning",
        summary: `U_iso of ${s.label}${where} is ${fmtU(u)} Å² (B ${(u * EIGHT_PI2).toFixed(3)} Å²), below the ${U_SMALL} Å² of a room-temperature atom.`,
        detail: "That small is a low-temperature value. At room temperature it usually absorbs an error elsewhere (absorption, the scale, a scattering length or occupancy too small): check those before reporting it.",
        evidence: { site: s.label, uIso: u },
      });
    }
  }

  // ── heavier atoms vibrate less ───────────────────────────────────────
  const weighed = full.map((s) => ({ s, u: uIsoOf(s)!, m: atomicWeight(s.element) })).filter((x): x is { s: AtomSite; u: number; m: number } => x.m !== undefined && x.u > 0);
  let worst: { heavy: (typeof weighed)[number]; light: (typeof weighed)[number] } | undefined;
  for (const heavy of weighed) {
    for (const light of weighed) {
      if (!(heavy.m > light.m) || heavy.s.element === light.s.element) continue;
      if (heavy.u > U_ORDER_RATIO * light.u && heavy.u - light.u >= U_ORDER_MIN && (!worst || heavy.u / light.u > worst.heavy.u / worst.light.u)) worst = { heavy, light };
    }
  }
  if (worst) {
    findings.push({
      category: "physical",
      severity: "warning",
      summary: `${worst.heavy.s.label} (${worst.heavy.s.element})${where} has U_iso ${fmtU(worst.heavy.u)} Å², ${(worst.heavy.u / worst.light.u).toFixed(1)}× that of the lighter ${worst.light.s.label} (${worst.light.s.element}, ${fmtU(worst.light.u)} Å²).`,
      detail: "Heavier atoms usually vibrate less. It can be right (a loosely bound heavy atom, a rattler); otherwise the two sites' occupancies or elements may be swapped, or one U is taking a misfit. Say so in the report.",
      evidence: { heavy: worst.heavy.s.label, light: worst.light.s.label, uHeavy: worst.heavy.u, uLight: worst.light.u },
    });
  }
  return findings;
}
