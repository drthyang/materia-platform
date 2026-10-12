import { describe, it, expect } from "vitest";
import type { RefinementParameter } from "@/core/refinement/types";
import { USER_TIE_GROUP, checkEqualTies, complementOf, isUserTie, parseTie, resolveTies, tieReferences, tieStepLabel, withEqualTies } from "@/core/refinement/constraints";

const p = (id: string, value: number, expression?: string): RefinementParameter =>
  ({ id, label: id, kind: "momentMode", value, initialValue: value, fixed: !!expression, ...(expression ? { expression } : {}) });

describe("tie expressions", () => {
  it("parses the linear forms", () => {
    expect(parseTie("= a")).toEqual({ kind: "linear", factor: 1, refId: "a", constant: 0 });
    expect(parseTie("= -2*occ_Fe1 + 1")).toEqual({ kind: "linear", factor: -2, refId: "occ_Fe1", constant: 1 });
  });

  it("parses the magnitude form with an optional sign or factor", () => {
    expect(parseTie("= hypot(a,b)")).toEqual({ kind: "norm", factor: 1, refIds: ["a", "b"] });
    expect(parseTie("= -hypot(mom_Mn1_0, mom_Mn1_1)")).toEqual({ kind: "norm", factor: -1, refIds: ["mom_Mn1_0", "mom_Mn1_1"] });
    expect(parseTie("= 0.5*hypot(x,y,z)")).toEqual({ kind: "norm", factor: 0.5, refIds: ["x", "y", "z"] });
    expect(tieReferences("= hypot(a,b)")).toEqual(["a", "b"]);
    expect(tieReferences("= 3*a+1")).toEqual(["a"]);
  });

  it("rejects anything else, loudly", () => {
    expect(() => parseTie("hypot(a)")).toThrow(/start with/);
    expect(() => parseTie("= sqrt(a)")).toThrow(/Unsupported/);
    expect(() => parseTie("= hypot()")).toThrow(/Unsupported/);
    expect(() => parseTie("= a*b")).toThrow(/Unsupported/);
  });

  it("resolves the magnitude tie as ±√(Σ ref²) and reports a missing reference", () => {
    const params = [p("a", 3), p("b", 4), p("m", 0, "= hypot(a,b)"), p("n", 0, "= -hypot(a,b)")];
    const out = resolveTies(params, { a: 3, b: 4, m: 0, n: 0 });
    expect(out.m).toBe(5);
    expect(out.n).toBe(-5);
    expect(out.a).toBe(3); // free values pass through
    expect(() => resolveTies([p("m", 0, "= hypot(a,zz)")], { a: 1, m: 0 })).toThrow(/unknown parameter "zz"/);
  });
});

describe("equal-value ties the user makes", () => {
  const row = (id: string, kind: RefinementParameter["kind"], value: number, extra: Partial<RefinementParameter> = {}): RefinementParameter =>
    ({ id, label: id, kind, value, initialValue: value, fixed: false, ...extra });
  const rows = [
    row("B_W1", "bIso", 1.5), row("B_Cr1", "bIso", 0), row("B_O1", "bIso", 0.3), row("B_O2", "bIso", 0.8),
    row("occ_W1", "occupancy", 1), row("B_Cr_W1", "bIso", 1.5, { fixed: true, expression: "= B_W1" }),
  ];

  it("ties the followers to the leader's value, fixed and tagged; releases them fixed at it", () => {
    expect(checkEqualTies(rows, { equal: ["B_W1", "B_Cr1"] })).toEqual({ unchanged: false });
    const tied = withEqualTies(rows, { equal: ["B_W1", "B_Cr1"] });
    const cr = tied.find((p) => p.id === "B_Cr1")!;
    expect(cr).toMatchObject({ value: 1.5, fixed: true, expression: "= B_W1", group: USER_TIE_GROUP });
    expect(isUserTie(cr)).toBe(true);
    expect(isUserTie(tied.find((p) => p.id === "B_Cr_W1")!)).toBe(false); // the model's own tie
    expect(checkEqualTies(tied, { equal: ["B_W1", "B_Cr1"] })).toEqual({ unchanged: true });
    const released = withEqualTies(tied, { release: ["B_Cr1"] }).find((p) => p.id === "B_Cr1")!;
    expect(released).toMatchObject({ value: 1.5, fixed: true });
    expect(released.expression).toBeUndefined();
    expect(released.group).toBeUndefined();
  });

  it("re-points a follower of a new follower to the leader: ties are not chained", () => {
    const oxygens = withEqualTies(rows, { equal: ["B_O1", "B_O2"] });
    const all = withEqualTies(oxygens, { equal: ["B_W1", "B_O1"] });
    expect(all.find((p) => p.id === "B_O1")!.expression).toBe("= B_W1");
    expect(all.find((p) => p.id === "B_O2")!.expression).toBe("= B_W1");
    expect(all.find((p) => p.id === "B_O2")!.value).toBe(1.5);
  });

  it("refuses what cannot be tied", () => {
    expect(() => checkEqualTies(rows, { equal: ["B_W1"] })).toThrow(/at least two/);
    expect(() => checkEqualTies(rows, { equal: ["B_W1", "B_W1"] })).toThrow(/twice/);
    expect(() => checkEqualTies(rows, { equal: ["B_W1", "occ_W1"] })).toThrow(/one kind/);
    expect(() => checkEqualTies(rows, { equal: ["B_Cr_W1", "B_O1"] })).toThrow(/itself tied/);
    expect(() => checkEqualTies(rows, { equal: ["B_O1", "B_Cr_W1"] })).toThrow(/already tied by the model/);
    expect(() => checkEqualTies(rows, { equal: ["B_W1", "zz"] })).toThrow(/no parameter zz/);
    expect(() => checkEqualTies(rows, { release: ["B_O1"] })).toThrow(/not held by a tie/);
    expect(() => checkEqualTies([row("scale", "scale", 1), row("s2", "scale", 1)], { equal: ["scale", "s2"] })).toThrow(/not tied this way/);
    expect(() => checkEqualTies(rows, {})).toThrow(/pass `equal`/);
  });

  it("makes a disorder's second occupancy one minus the first, and holds whole ADPs equal mode by mode (EADP)", () => {
    const disorder = [
      row("occ_Al1", "occupancy", 0.84, { fixed: true }), row("occ_Ga1", "occupancy", 0.16, { fixed: true }),
      row("U_Al1_0", "uAniso", 0.031), row("U_Al1_1", "uAniso", 0.028), row("U_Ga1_0", "uAniso", 0.05), row("U_Ga1_1", "uAniso", 0.04),
    ];
    expect(checkEqualTies(disorder, { complement: ["occ_Al1", "occ_Ga1"] })).toEqual({ unchanged: false });
    const split = withEqualTies(disorder, { complement: ["occ_Al1", "occ_Ga1"], groups: [["U_Al1_0", "U_Ga1_0"], ["U_Al1_1", "U_Ga1_1"]] });
    const ga = split.find((p) => p.id === "occ_Ga1")!;
    expect(ga).toMatchObject({ value: 1 - 0.84, fixed: true, expression: complementOf("occ_Al1"), group: USER_TIE_GROUP });
    expect(resolveTies(split, { ...Object.fromEntries(split.map((p) => [p.id, p.value])), occ_Al1: 0.7 }).occ_Ga1).toBeCloseTo(0.3, 12);
    expect(split.find((p) => p.id === "U_Ga1_1")).toMatchObject({ value: 0.028, expression: "= U_Al1_1" });
    expect(checkEqualTies(split, { complement: ["occ_Al1", "occ_Ga1"] })).toEqual({ unchanged: true });
    // An equal tie is not the complement, and the complement joins occupancies only.
    expect(checkEqualTies(split, { equal: ["occ_Al1", "occ_Ga1"] })).toEqual({ unchanged: false });
    expect(() => checkEqualTies(disorder, { complement: ["occ_Al1", "occ_Al1"] })).toThrow(/two different/);
    expect(() => checkEqualTies(disorder, { complement: ["occ_Al1", "U_Ga1_0"] })).toThrow(/two occupancies/);
    expect(() => checkEqualTies(split, { complement: ["occ_Ga1", "occ_Al1"] })).toThrow(/itself tied/);
    const back = withEqualTies(split, { release: ["occ_Ga1"] }).find((p) => p.id === "occ_Ga1")!;
    expect(back).toMatchObject({ value: 1 - 0.84, fixed: true });
    expect(back.expression).toBeUndefined();
  });
});

describe("a tie's History step", () => {
  it("names every tie the update makes", () => {
    expect(tieStepLabel({ complement: ["occ_Al1", "occ_Ga1"], groups: [["U_Al1_0", "U_Ga1_0"], ["U_Al1_1", "U_Ga1_1"]] })).toBe("occ_Ga1 = 1 − occ_Al1; EADP (2 ADP rows tied)");
    expect(tieStepLabel({ equal: ["B_O1", "B_O2", "B_O3"] })).toBe("B_O2, B_O3 = B_O1");
    expect(tieStepLabel({ release: ["B_O2"] })).toBe("Released B_O2");
    expect(tieStepLabel({})).toBe("Parameters tied");
  });
});
