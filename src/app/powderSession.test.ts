import { describe, it, expect } from "vitest";
import { keptBindings, keptRows, withMagneticRows } from "@/app/powderSession";
import type { ParameterBinding, ParameterKind, RefinementParameter } from "@/core/refinement/types";

const row = (id: string, kind: ParameterKind, value = 1, fixed = true): RefinementParameter => ({ id, label: id, kind, value, initialValue: value, fixed });
const bind = (parameterId: string, kind: ParameterKind): ParameterBinding => ({ parameterId, kind, targetId: "s", targetKey: parameterId });

describe("rebuilding the powder spec", () => {
  // A settings change (background terms, corrections, site ties, microstrain,
  // the ADP model, a phase added) rebuilds the nuclear rows only. The magnetic
  // model stays on the session, so its moment rows must stay in the fit
  // (round 8, Cr₂WO₆ at 4 K: switching on the asymmetry dropped the moment, and
  // the "joint" refinement after it held the moment fixed without saying so).
  const previous = [row("scale", "scale", 0.008, false), row("B_W1", "bIso", 0.45, false), row("mom_Cr1_0", "momentMode", 2.29, false), row("mom_Cr1_1", "momentMode", 0)];
  const spec = [row("scale", "scale"), row("B_W1", "bIso"), row("asymSL", "asymSL", 0.01)];

  it("keeps the rows' values and states, and carries the magnetic rows as they were", () => {
    const out = keptRows(spec, previous);
    expect(out.map((p) => p.id)).toEqual(["scale", "B_W1", "asymSL", "mom_Cr1_0", "mom_Cr1_1"]);
    expect(out.find((p) => p.id === "mom_Cr1_0")).toMatchObject({ value: 2.29, fixed: false });
    expect(out.find((p) => p.id === "mom_Cr1_1")).toMatchObject({ value: 0, fixed: true });
    expect(out.find((p) => p.id === "scale")).toMatchObject({ value: 0.008, fixed: false });
  });

  it("carries a magnetic row once, and nothing when there is no magnetic model", () => {
    expect(withMagneticRows([...spec, row("mom_Cr1_0", "momentMode", 9)], previous).filter((p) => p.id === "mom_Cr1_0")).toHaveLength(1);
    expect(keptRows(spec, previous.filter((p) => p.kind !== "momentMode")).map((p) => p.id)).toEqual(["scale", "B_W1", "asymSL"]);
  });

  it("carries the magnetic bindings with the spec's", () => {
    const out = keptBindings([bind("scale", "scale")], [bind("scale", "scale"), bind("mom_Cr1_0", "momentMode"), bind("k1", "propagationK")]);
    expect(out.map((b) => b.parameterId)).toEqual(["scale", "mom_Cr1_0", "k1"]);
  });
});
