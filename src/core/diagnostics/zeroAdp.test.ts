import { describe, it, expect } from "vitest";
import { parse_structure } from "@/mcp/tools";
import type { ParameterBinding, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { StructureModel } from "@/core/crystal/types";
import { activeZeroAdpFixes, withFixRecorded, withZeroAdpProposal, zeroAdpFix, zeroAdpFixText, zeroAdpProposals, ZERO_ADP_BAYES } from "@/core/diagnostics/zeroAdp";
import { withEqualTies } from "@/core/refinement/constraints";

/**
 * The B-at-0 rule (issue M10) on Cr₂WO₆ (trirutile, P4₂/mnm): W1 and Cr1 are
 * both octahedral cations (6 O), O1 and O2 the two oxygens. The results are
 * made by hand, so each case puts exactly the bound and esds it needs.
 */
const cif = (b: boolean): string => `data_cr2wo6
_cell_length_a 4.5753
_cell_length_b 4.5753
_cell_length_c 8.8537
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 42/m n m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
${b ? "_atom_site_U_iso_or_equiv\n" : ""}W1 W6+ 0 0 0 1${b ? " 0.0040" : ""}
Cr1 Cr3+ 0 0 0.3330 1${b ? " 0.0050" : ""}
O1 O2- 0.2985 0.2985 0 1${b ? " 0.0070" : ""}
O2 O2- 0.3075 0.3075 0.3400 1${b ? " 0.0076" : ""}
`;

const LABELS = ["W1", "Cr1", "O1", "O2"];

function rows(structure: StructureModel, values: Record<string, number>, fixed: readonly string[] = []): { params: RefinementParameter[]; bindings: ParameterBinding[] } {
  const params: RefinementParameter[] = [{ id: "scale", label: "scale", kind: "scale", value: 1, initialValue: 1, min: 0, fixed: false }];
  const bindings: ParameterBinding[] = [{ parameterId: "scale", kind: "scale", targetId: "p" }];
  for (const l of LABELS) {
    const id = `B_${l}`;
    params.push({ id, label: `${l} B`, kind: "bIso", value: values[id] ?? 0.5, initialValue: 0.5, min: 0, max: 10, fixed: fixed.includes(id) });
    bindings.push({ parameterId: id, kind: "bIso", targetId: structure.id, targetKey: l });
  }
  return { params, bindings };
}

function result(values: Record<string, number>, esd: Record<string, number>, atMin: readonly string[]): RefinementResult {
  return {
    status: "converged",
    parameters: { scale: 1, ...values },
    esd: { scale: 0.01, ...esd },
    agreement: { rFactor: 0.05, rWeighted: 0.07 },
    history: [],
    diagnostics: { svdZeroCount: 0, singularParameterIds: [], conditionNumber: 10, highCorrelations: [], maxLambda: 1e-3, maxShiftOverEsd: 0.01, atBounds: atMin.map((id) => ({ parameterId: id, bound: "min" as const, value: 0 })) },
  } as RefinementResult;
}

describe("the B-at-0 rule: which proposal", () => {
  const structure = parse_structure({ cif: cif(true), id: "cwo" }).structure;
  const bare = parse_structure({ cif: cif(false), id: "cwo" }).structure;

  it("A, same element: O2 at 0 ties to O1, which refined sensibly; the warning names the atom, the B, the tie and its source", () => {
    const v = { B_W1: 0.3, B_Cr1: 0.4, B_O1: 0.62, B_O2: 0 };
    const { params, bindings } = rows(structure, v);
    const [p, ...more] = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_O2"]), structures: [structure] });
    expect(more).toHaveLength(0);
    expect(p).toMatchObject({ parameterId: "B_O2", atom: "B(O2)", reached: 0, rule: "A", leader: "B_O1" });
    expect(p!.warning).toMatch(/^B\(O2\) refined to 0 Å² \(its lower bound\)\. Proposed \(rule A\): tie it to B\(O1\), same element \(O\), which refined to 0.62\(5\) Å²/);
    expect(p!.source).toMatch(/rule A: B\(O1\) \(B_O1\), same element/);
    expect(p!.warning).toContain(ZERO_ADP_BAYES);
    expect(p!.warning).toMatch(/the Bayesian check on it \(sample_posterior\)/);
  });

  it("A, same role and coordination: W1 at 0 ties to Cr1 (both cations with 6 O neighbours) when no other W refined", () => {
    const v = { B_W1: 0, B_Cr1: 0.4, B_O1: 0.62, B_O2: 0.6 };
    const { params, bindings } = rows(structure, v);
    const [p] = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_W1"]), structures: [structure] });
    expect(p).toMatchObject({ parameterId: "B_W1", rule: "A", leader: "B_Cr1" });
    expect(p!.source).toMatch(/same role and coordination \(a cation with 6 O neighbours, as Cr1 has\)/);
    // Never an anion for a cation: O1 has a smaller relative esd than Cr1, and is not proposed.
  });

  it("no sensible partner (O1 also on its bound, Cr1 undetermined): B, the starting structure's B with its source and no temperature adjustment", () => {
    const v = { B_W1: 0, B_Cr1: 0.05, B_O1: 0, B_O2: 0 };
    const { params, bindings } = rows(structure, v);
    const ps = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_W1", "B_O1", "B_O2"]), structures: [structure] });
    expect(ps.map((p) => [p.parameterId, p.rule])).toEqual([["B_W1", "B"], ["B_O1", "B"], ["B_O2", "B"]]);
    const o2 = ps.find((p) => p.parameterId === "B_O2")!;
    expect(o2.value).toBeCloseTo(8 * Math.PI ** 2 * 0.0076, 10);
    expect(o2.warning).toMatch(/Proposed \(rule B\): hold it at 0\.600 Å², the B of O2 in the loaded starting structure "cr2wo6" \(a CIF's U_iso is read as B = 8π²U\), used as it stands: the app has no temperature model for B, so it is not adjusted to the measurement temperature/);
  });

  it("neither a partner nor a reference B: C proposes no value and says why — never a floor", () => {
    const v = { B_W1: 0.3, B_Cr1: 0.4, B_O1: 0, B_O2: 0 };
    const { params, bindings } = rows(bare, v);
    const ps = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_O1", "B_O2"]), structures: [bare] });
    expect(ps.map((p) => p.rule)).toEqual(["C", "C"]);
    expect(ps[0]!.value).toBeUndefined();
    expect(ps[0]!.leader).toBeUndefined();
    expect(ps[0]!.warning).toMatch(/B\(O1\) refined to 0 Å² \(its lower bound\)\. No value is proposed \(no chemically similar site refined sensibly to tie it to, the starting structure gives it no B, and the app holds no documented table of typical B values by element and temperature\)/);
    expect(() => zeroAdpFix(ps[0]!)).toThrow(/nothing to apply/);
    expect(withZeroAdpProposal(params, ps[0]!)).toEqual(params);
  });

  it("nothing when no B is on its bound, when there is no result, or for a row the user holds", () => {
    const v = { B_W1: 0.3, B_Cr1: 0.4, B_O1: 0.62, B_O2: 0.6 };
    const { params, bindings } = rows(structure, v);
    expect(zeroAdpProposals({ parameters: params, bindings, result: result(v, {}, []), structures: [structure] })).toEqual([]);
    expect(zeroAdpProposals({ parameters: params, bindings, result: null, structures: [structure] })).toEqual([]);
    const held = rows(structure, { ...v, B_O2: 0 }, ["B_O2"]);
    expect(zeroAdpProposals({ parameters: held.params, bindings: held.bindings, result: result({ ...v, B_O2: 0 }, {}, ["B_O2"]), structures: [structure] })).toEqual([]);
    // A B at its upper bound is not this rule's.
    const top = result(v, {}, []);
    expect(zeroAdpProposals({ parameters: params, bindings, result: { ...top, diagnostics: { ...top.diagnostics!, atBounds: [{ parameterId: "B_O2", bound: "max", value: 10 }] } }, structures: [structure] })).toEqual([]);
  });

  it("a partner whose esd is as large as half its value is not sensible: the next rule applies", () => {
    const v = { B_W1: 0.3, B_Cr1: 0.4, B_O1: 0.08, B_O2: 0 };
    const { params, bindings } = rows(structure, v);
    const [p] = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_O2"]), structures: [structure] });
    expect(p!.rule).toBe("B");
  });
});

describe("the B-at-0 rule: applied, overridden, undone", () => {
  const structure = parse_structure({ cif: cif(true), id: "cwo" }).structure;
  const v = { B_W1: 0.3, B_Cr1: 0.4, B_O1: 0.62, B_O2: 0 };

  it("A applies as the existing user tie; releasing it (or retying) takes the fix out of force", () => {
    const { params, bindings } = rows(structure, v);
    const [p] = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_O2"]), structures: [structure] });
    const applied = withZeroAdpProposal(params, p!);
    expect(applied.find((q) => q.id === "B_O2")).toMatchObject({ fixed: true, expression: "= B_O1", group: "user-tie", value: 0.62 });
    const fixes = withFixRecorded([], zeroAdpFix(p!));
    expect(activeZeroAdpFixes(applied, fixes)).toHaveLength(1);
    expect(zeroAdpFixText(fixes[0]!)).toMatch(/^B\(O2\) refined to 0 Å² \(its lower bound\) and is tied to B_O1 by the B-at-0 rule \(rule A: /);
    // Released: the user's override; the fix no longer stands.
    expect(activeZeroAdpFixes(withEqualTies(applied, { release: ["B_O2"] }), fixes)).toEqual([]);
    // Applied again: one record per row.
    expect(withFixRecorded(fixes, zeroAdpFix(p!))).toHaveLength(1);
  });

  it("B holds the row fixed at the value; freeing it or typing another value takes the fix out of force", () => {
    const vv = { ...v, B_O1: 0 };
    const { params, bindings } = rows(structure, vv);
    const p = zeroAdpProposals({ parameters: params, bindings, result: result(vv, {}, ["B_O1", "B_O2"]), structures: [structure] }).find((q) => q.parameterId === "B_O2")!;
    const applied = withZeroAdpProposal(params, p);
    const row = applied.find((q) => q.id === "B_O2")!;
    expect(row.fixed).toBe(true);
    expect(row.expression).toBeUndefined();
    expect(row.value).toBeCloseTo(0.6, 3);
    const fixes = [zeroAdpFix(p)];
    expect(activeZeroAdpFixes(applied, fixes)).toHaveLength(1);
    expect(activeZeroAdpFixes(applied.map((q) => (q.id === "B_O2" ? { ...q, fixed: false } : q)), fixes)).toEqual([]);
    expect(activeZeroAdpFixes(applied.map((q) => (q.id === "B_O2" ? { ...q, value: 0.3 } : q)), fixes)).toEqual([]);
    expect(zeroAdpFixText(fixes[0]!)).toMatch(/held at 0\.600 Å² by the B-at-0 rule \(rule B: .*\)\. It is held, not refined/);
  });
});
