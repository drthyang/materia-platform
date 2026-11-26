/**
 * Every domain of a nuclear subgroup child gives the same powder pattern and
 * the same PDF (THY-80 C2; the magnetic version is THY-58's
 * magnetic/powderAverage.test.ts).
 *
 * For a child H of the parent G (a class of the subgroup lattice the
 * Subgroups view and list_subgroups list), every domain state, one per coset
 * gH of G/H: the conjugate gHg⁻¹ realised by the engine in the setting it
 * picks for it, carrying g·u, the image of one random symmetry-allowed
 * distortion u of H (random amplitudes on every displacive mode, a random
 * spontaneous strain H keeps). The powder lines (neutron and X-ray, by d),
 * the Rietveld engine's calculated neutron profile and G(r) (neutron and
 * X-ray) of every domain must be the identity domain's to 10⁻⁹ (relative):
 * the domains are one crystal turned and shifted by an operation of the
 * parent. See nuclearDomainsSupport.ts for how each piece is made.
 *
 * Why 10⁻⁹: the observed differences are rounding, 10⁻¹⁷–10⁻¹¹ (the largest
 * on the weakest lines of the largest cell, where |F|² is a difference of
 * large terms); a real error moves an atom by ≥ 10⁻⁴ of the cell or a line by
 * a strain of 10⁻³, and shows at ≥ 10⁻⁴ (the negative controls below). 10⁻⁹
 * sits between with two orders of margin on either side.
 *
 * Tier 1 (here): a few cases at fixed seeds. Tier 2, opt-in
 * (MATERIA_SUBGROUP_TIER2=1): every case at more seeds (nuclearDomainsTier2.test.ts).
 */
import { describe, it, expect } from "vitest";
import { CASES } from "@/core/crystal/irreps/validation/nuclearDomainCases";
import { failures, fmt, negativeControls, prepare, runSeed, summary } from "@/core/crystal/irreps/validation/nuclearDomainsSupport";

/** The tier-1 cases and seeds. */
const TIER1: readonly (readonly [string, readonly number[]])[] = [
  ["Pnma", [1, 2]],
  ["R-3c", [3]],
  ["P4mm", [1]],
  ["P-42₁m X5+W1", [1]],
  ["P-4c2 Δ", [2]],
  ["R3m GTS", [1]],
  ["Cmcm", [1]],
];

describe("every domain of a nuclear subgroup child gives the same powder pattern and PDF (THY-80 C2)", { timeout: 300_000 }, () => {
  for (const [key, seeds] of TIER1) {
    const c = CASES[key]!;
    it(`${c.name}: seeds ${seeds.join(", ")}`, () => {
      const p = prepare(c);
      for (const seed of seeds) {
        const r = runSeed(p, seed);
        console.log(`[THY-80 C2] ${summary(r)}`);
        expect(failures(r, p.cls.domainStates, p.cls.orientationStates)).toEqual([]);
      }
    });
  }

  it("the check sees a domain on the wrong setting and a strain not turned with its domain (Pnma)", () => {
    const p = prepare(CASES["Pnma"]!);
    const { wrongMapping, unturnedStrain } = negativeControls(p, 1);
    console.log(`[THY-80 C2 controls] wrong setting: lines ${fmt(wrongMapping.lines)}, profile ${fmt(wrongMapping.profile)}, G(r) ${fmt(wrongMapping.pdf)}; unturned strain: lines ${fmt(unturnedStrain.lines)}, profile ${fmt(unturnedStrain.profile)}, G(r) ${fmt(unturnedStrain.pdf)}`);
    expect(wrongMapping.lines).toBeGreaterThan(1e-4);
    expect(wrongMapping.profile).toBeGreaterThan(1e-4);
    expect(wrongMapping.pdf).toBeGreaterThan(1e-4);
    expect(unturnedStrain.lines).toBeGreaterThan(1e-4);
    expect(unturnedStrain.profile).toBeGreaterThan(1e-4);
    expect(unturnedStrain.pdf).toBeGreaterThan(1e-4);
  });
});
