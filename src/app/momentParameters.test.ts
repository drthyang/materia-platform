import { describe, expect, it } from "vitest";
import { allowedMomentDirections } from "@/core/magnetic/allowedMoments";
import { buildFor, candidatesOf, firstOpen, fitRows, momentParameters, rankedGroups } from "@/app/magneticStep";
import { maximalWithMoment } from "@/core/magnetic/subgroupLattice";
import { MAGNETIC_ORACLE_CASES } from "@/testSupport/magneticOracleCases";
import { allowed_moments } from "@/mcp/tools";

/**
 * The parameter count the ranking reads (THY-37, D4): the rows each group's
 * fit refines, not the allowed directions at the first orbit summed over the
 * chosen ions. Hamilton's test and the ★'s "fewest parameters" compare it,
 * and a group is ranked when it is not 0.
 */

const TIES = { sameSite: true, magnitudes: false as const, flippedUnits: [] };
const caseOf = (id: string) => MAGNETIC_ORACLE_CASES.find((c) => c.id === id)!;

describe("the moment parameters a ranking counts", () => {
  it("are the rows the fit refines: a mixed site's co-located ions share one moment", () => {
    const c = caseOf("wolframite_mixed_k_half00"); // Mn and Fe on one 2f site
    const s = c.structure();
    const reps = candidatesOf(s, c.k);
    const params = momentParameters(s, reps, c.ions, c.k, TIES);
    reps.forEach((r, i) => {
      expect(params[i]).toBe(fitRows(buildFor(s, c.k, c.ions, r.candidate.operations, TIES)).filter((p) => !p.fixed).length);
      // One shared moment: the site's allowed directions once, not once per ion.
      const once = allowedMomentDirections(r.candidate.operations, s.sites[0]!.position, c.k).dimension;
      if (r.index === 2) expect(params[i]).toBe(once);
    });
    // With the tie off each ion carries its own moment.
    const untied = momentParameters(s, reps, c.ions, c.k, { ...TIES, sameSite: false });
    reps.forEach((r, i) => {
      if (r.index === 2) expect(untied[i]).toBe(2 * params[i]!);
    });
  });

  it("count every split orbit: a group whose moment sits only on a later orbit is ranked", () => {
    const c = caseOf("kagome_k_00half"); // P6/mmm, Co on 3f, k = (0,0,½)
    const s = c.structure();
    const reps = candidatesOf(s, c.k);
    const params = momentParameters(s, reps, c.ions, c.k, TIES);
    const site = s.sites.find((x) => x.label === "Co1")!;
    const later = reps.filter((r, i) => allowedMomentDirections(r.candidate.operations, site.position, c.k).dimension === 0 && params[i]! > 0);
    expect(later.length).toBeGreaterThan(0);
    const ranked = new Set(rankedGroups(reps, params, "all", new Set()).map((r) => r.candidate.id));
    for (const r of later) expect(ranked.has(r.candidate.id)).toBe(true);
  });
});

describe("the MCP allowed_moments", () => {
  it("lists each split orbit, and its dimension is their sum", () => {
    const c = caseOf("kagome_k_00half");
    const s = c.structure();
    const reps = candidatesOf(s, c.k);
    const params = momentParameters(s, reps, c.ions, c.k, TIES);
    const i = reps.findIndex((r, j) => allowedMomentDirections(r.candidate.operations, s.sites[0]!.position, c.k).dimension === 0 && params[j]! > 0);
    const out = allowed_moments({ structure: s, operations: [...reps[i]!.candidate.operations], k: c.k, siteLabels: ["Co1"] }).sites[0]!;
    expect(out.orbits!.length).toBeGreaterThan(1);
    expect(out.orbits![0]!.dimension).toBe(0);
    expect(out.dimension).toBe(out.orbits!.reduce((sum, o) => sum + o.dimension, 0));
    expect(out.dimension).toBe(params[i]);
  });
});

describe("the sections open on a new k (THY-37, D6)", () => {
  const bns = (r: ReturnType<typeof candidatesOf>[number]): string | undefined => (r.candidate.standard ?? r.settingMatch?.identity)?.bnsNumber;

  it("are those of the maximal groups that carry a moment, at any index (MnO at k = 0: 6, 8 and 12)", () => {
    const c = caseOf("mno_k0");
    const s = c.structure();
    const reps = candidatesOf(s, c.k);
    const params = momentParameters(s, reps, c.ions, c.k, TIES);
    expect([...firstOpen(reps, params)].sort((a, b) => a - b)).toEqual([6, 8, 12]);
    const top = maximalWithMoment(reps, params);
    // FindSpinGroup's I4/mm'm', R-3m' and Im'm'm; no index-2 group carries a moment on Mn.
    expect(reps.filter((_, i) => top[i]).map(bns).sort()).toEqual(["139.537", "166.101", "71.536"]);
  });

  it("include the two maximal groups the Z point of P4₂/mnm was missing", () => {
    const c = caseOf("trirutile_k_00half");
    const s = c.structure();
    const reps = candidatesOf(s, c.k);
    const params = momentParameters(s, reps, c.ions, c.k, TIES);
    expect([...firstOpen(reps, params)]).toEqual([4]);
    const top = maximalWithMoment(reps, params);
    const named = reps.filter((_, i) => top[i]).map(bns);
    expect(named).toContain("96.148");
    expect(named).toContain("92.116");
  });
});

