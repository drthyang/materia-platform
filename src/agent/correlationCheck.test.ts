import { describe, it, expect } from "vitest";
import { CORRELATION_LIMIT, carriedText, correlationRefusal, disorderAssemblies, readCorrelations, refusalLine } from "@/agent/correlationCheck";
import { disorderPage } from "@/testSupport/scPages";
import { buildSingleCrystalSpec } from "@/core/workflow/singleCrystalRefinement";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";

function param(id: string, kind: RefinementParameter["kind"]): RefinementParameter {
  return { id, label: id, kind, value: 1, initialValue: 1, fixed: false };
}

const params = [param("scale", "scale"), param("occ_Mn1", "occupancy"), param("B_Mn1", "bIso"), param("bkg0", "background"), param("bkg1", "background")];

function probe(pairs: ([string, string, number] | [string, string, number, number])[], singular: string[] = []): RefinementResult {
  return {
    status: "maxIterations",
    parameters: {},
    esd: {},
    agreement: { rFactor: 0 },
    history: [],
    diagnostics: {
      svdZeroCount: singular.length ? 1 : 0,
      singularParameterIds: singular,
      conditionNumber: 1e3,
      highCorrelations: pairs.map(([a, b, c, conditional]) => ({ parameterIdA: a, parameterIdB: b, coefficient: c, ...(conditional !== undefined ? { conditional } : {}) })),
      maxLambda: 1e-3,
      atBounds: [],
      maxShiftOverEsd: 0,
    },
  };
}

describe("correlation check", () => {
  it("lists a pair a third parameter carries, and refines it; a pair that trades off itself still stops", () => {
    const sc = [param("scale", "scale"), param("extinction", "extinction"), param("B_Al1", "bIso"), param("B_O1", "bIso"), param("occ_O1", "occupancy")];
    // Synthetic corundum to d = 0.4 Å: the scale, the extinction and the B's trade with the overall fall-off.
    const check = readCorrelations(probe([["scale", "B_O1", 0.976, 0.722], ["scale", "extinction", 0.955, 0.693], ["B_O1", "occ_O1", 0.97, 0.95]]), sc);
    expect(check.carried.map((p) => [p.a, p.b])).toEqual([["scale", "B_O1"], ["scale", "extinction"]]);
    expect(check.correlated.map((p) => [p.a, p.b])).toEqual([["B_O1", "occ_O1"]]);
    expect(correlationRefusal(check)).toContain("B_O1 ↔ occ_O1 0.970");
    expect(correlationRefusal(check)).not.toContain("scale ↔ B_O1");
    // Carried or not, a pair at 0.99 stops.
    expect(readCorrelations(probe([["B_Al1", "B_O1", 0.993, 0.6]]), sc).correlated).toHaveLength(1);
    // Without the conditional (an older result), the pair stops as before.
    expect(readCorrelations(probe([["scale", "B_O1", 0.976]]), sc).correlated).toHaveLength(1);
  });

  it("refines one disorder's alternatives together, as SHELXL does, and still stops a pair outside it", () => {
    // 1b's split site, Al1 and Ga1 0.2 Å apart (PART 1 and 2 of assembly A) sharing one U (EADP):
    // their positions correlate at −0.996 by construction, and so with every other parameter fixed.
    const split = [param("pos_Al1_1", "positionShift"), param("pos_Ga1_1", "positionShift"), param("U_Al1_1", "uAniso"), param("occ_Al1", "occupancy"), param("pos_N1_1", "positionShift")];
    const assemblies = new Map([["pos_Al1_1", "A"], ["pos_Ga1_1", "A"], ["U_Al1_1", "A"], ["occ_Al1", "A"]]);
    const pairs = probe([["pos_Al1_1", "pos_Ga1_1", -0.996, -0.99], ["pos_Ga1_1", "U_Al1_1", -0.965, -0.93], ["pos_Al1_1", "pos_N1_1", 0.97, 0.96]]);
    const check = readCorrelations(pairs, split, [], assemblies);
    expect(check.carried.map((p) => [p.a, p.b, p.disorder])).toEqual([["pos_Al1_1", "pos_Ga1_1", "A"], ["pos_Ga1_1", "U_Al1_1", "A"]]);
    expect(carriedText(check.carried[0]!)).toBe("pos_Al1_1 ↔ pos_Ga1_1 -0.996 (one disorder (A): its alternatives refined together, as SHELXL refines them)");
    // A pair with a site outside the disorder stops the refinement as before.
    expect(check.correlated.map((p) => [p.a, p.b])).toEqual([["pos_Al1_1", "pos_N1_1"]]);
    // Without the disorder known, the split stops it too.
    expect(readCorrelations(pairs, split).correlated).toHaveLength(3);
    // The assemblies come from the CIF's PART groups, through each parameter's site.
    const d = disorderPage();
    const spec = buildSingleCrystalSpec(d.structure, d.dataset);
    const map = disorderAssemblies(d.structure, spec.bindings);
    expect(map.get("pos_Al1_0")).toBe("A");
    expect(map.get("pos_Ga1_0")).toBe("A");
    expect([...map.keys()].some((id) => id.startsWith("pos_N"))).toBe(false);
  });

  it("passes a set with nothing at the limit, and names its strongest pair", () => {
    const check = readCorrelations(probe([["scale", "B_Mn1", 0.81], ["scale", "bkg0", 0.62]]), params);
    expect(check.correlated).toEqual([]);
    expect(check.strongest).toMatchObject({ a: "scale", b: "B_Mn1", coefficient: 0.81 });
    expect(correlationRefusal(check)).toBeNull();
  });

  it("refuses a pair at the limit, with the physical reason and what to do", () => {
    const check = readCorrelations(probe([["scale", "occ_Mn1", -0.991], ["B_Mn1", "occ_Mn1", CORRELATION_LIMIT], ["scale", "bkg1", 0.7]]), params);
    expect(check.correlated.map((p) => [p.a, p.b])).toEqual([["scale", "occ_Mn1"], ["B_Mn1", "occ_Mn1"]]);
    expect(check.correlated[0]!.reason).toMatch(/near-degenerate/);
    expect(check.strongest).toMatchObject({ a: "scale", b: "bkg1" });
    const refusal = correlationRefusal(check)!;
    expect(refusal).toMatch(/^Not refined/);
    expect(refusal).toContain("scale ↔ occ_Mn1 -0.991 (Scale and site occupancy");
    expect(refusal).toContain("B_Mn1 ↔ occ_Mn1 0.950");
    expect(refusal).toMatch(/Fix one of each pair with set_free/);
    expect(refusalLine(check)).toBe("Not run: scale ↔ occ_Mn1 -0.991 and 1 more correlated");
  });

  it("lets the background coefficients correlate among themselves, but not with the scale", () => {
    const check = readCorrelations(probe([["bkg0", "bkg1", 0.995], ["scale", "bkg0", 0.97]]), params);
    expect(check.correlated.map((p) => [p.a, p.b])).toEqual([["scale", "bkg0"]]);
    expect(check.correlated[0]!.reason).toMatch(/background are trading intensity/);
    expect(readCorrelations(probe([["bkg0", "bkg1", 0.995]]), params).correlated).toEqual([]);
  });

  it("does not count two occupancies one restraint ties against each other", () => {
    const occ = [param("scale", "scale"), param("occ_Mg1", "occupancy"), param("occ_Al1", "occupancy"), param("occ_Mg2", "occupancy")];
    const restraint = { id: "occ_sum_Mg1", label: "Σ occ @ Mg1 site", target: 1, sigma: 0.01, terms: [{ parameterId: "occ_Mg1", coefficient: 1 }, { parameterId: "occ_Al1", coefficient: 1 }] };
    const pairs: [string, string, number][] = [["occ_Mg1", "occ_Al1", -0.999], ["occ_Mg1", "occ_Mg2", 0.97], ["scale", "occ_Al1", 0.96]];
    const check = readCorrelations(probe(pairs), occ, [restraint]);
    expect(check.correlated.map((p) => [p.a, p.b])).toEqual([["occ_Mg1", "occ_Mg2"], ["scale", "occ_Al1"]]);
    expect(readCorrelations(probe(pairs), occ).correlated).toHaveLength(3);
  });

  it("lets the Caglioti U, V, W correlate among themselves, but not with a structural parameter", () => {
    const width = [param("profU", "profileU"), param("profV", "profileV"), param("profW", "profileW"), param("B_Mn1", "bIso")];
    const check = readCorrelations(probe([["profV", "profW", -0.967], ["profU", "profV", -0.955], ["profW", "B_Mn1", 0.96]]), width);
    expect(check.correlated.map((p) => [p.a, p.b])).toEqual([["profW", "B_Mn1"]]);
  });

  it("explains the Lorentzian X ↔ Y pair", () => {
    const check = readCorrelations(probe([["profX", "profY", -0.97]]), [param("profX", "profileX"), param("profY", "profileY")]);
    expect(check.correlated[0]!.reason).toMatch(/Refine Y \(or X\) alone/);
  });

  it("refuses a combination the data cannot determine", () => {
    const check = readCorrelations(probe([], ["scale", "occ_Mn1"]), params);
    expect(correlationRefusal(check)).toContain("Not determined by the data at all, together: scale, occ_Mn1.");
    expect(refusalLine(check)).toBe("Not run: scale, occ_Mn1 not determined");
  });
});
