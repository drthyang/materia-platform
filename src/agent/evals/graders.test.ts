import { describe, expect, it } from "vitest";
import { flackReading } from "@/agent/scTools";
import { refinesFlack } from "@/agent/evals/checks";
import type { EvalRun } from "@/agent/evals/harness";

/** Readings and graders checked on small cases: the Flack x outside [0, 1] (flackUnbounded.test.ts), and what the eval checks accept. */
describe("reading and grading an x outside [0, 1]", () => {
  it("says an x below 0 by more than 2u is unphysical, and an x within 2u of 0 is the model's hand", () => {
    expect(flackReading(-0.12, 0.03, "Ga f″ 1.6 e")).toMatch(/below 0 by more than 2u.*systematic error/);
    expect(flackReading(1.15, 0.03, "Ga f″ 1.6 e")).toMatch(/above 1 by more than 2u.*inverted one/);
    expect(flackReading(-0.04, 0.03, "Ga f″ 1.6 e")).toMatch(/^the model's hand/);
    expect(flackReading(0.3, 0.03, "Ga f″ 1.6 e")).toMatch(/inversion twin/);
  });

  it("grades a reported negative x with its sign", () => {
    const run = (reply: string): EvalRun => ({
      events: [
        { kind: "call", name: "set_twin", input: { law: "inversion" }, isError: false, text: "{}" },
        { kind: "call", name: "refine", input: {}, isError: false, text: JSON.stringify({ refined: true }), free: ["scale", "twin_1"] },
        { kind: "reply", text: reply },
      ],
      port: { state: () => ({ dataset: {}, result: { parameters: { twin_1: -0.04 }, esd: { twin_1: 0.02 } } }) },
    }) as unknown as EvalRun;
    expect(refinesFlack.grade(run("The Flack x is −0.04(2).")).pass).toBe(true);
    expect(refinesFlack.grade(run("The Flack x is -0.04(2).")).pass).toBe(true);
    // Its magnitude with the sign dropped is a different value.
    expect(refinesFlack.grade(run("The Flack x is 0.04(2).")).pass).toBe(false);
  });
});

describe("mentionsD", () => {
  it("counts a d-spacing, not any number within the tolerance", async () => {
    const { mentionsD } = await import("@/agent/evals/checks");
    const run = (reply: string): EvalRun => ({ events: [{ kind: "reply", text: reply }] }) as unknown as EvalRun;
    const check = mentionsD(2.31, 0.03);
    expect(check.grade(run("An extra line at d = 2.312 Å, from Cr₂O₃.")).pass).toBe(true);
    expect(check.grade(run("An extra peak, 2.30 Å, unindexed.")).pass).toBe(true);
    expect(check.grade(run("The d-spacing of the unindexed peak is 2.33.")).pass).toBe(true);
    // A GoF, an R in %, an angle or a B in Å² near 2.31 is not the line.
    expect(check.grade(run("GoF 2.30 and wR 2.29 %, B = 2.31 Å², at 2θ 2.32°.")).pass).toBe(false);
  });
});

describe("comparesExtinctionModels", () => {
  const refine = (wR2: number) => ({ kind: "call", name: "refine", input: {}, isError: false, text: JSON.stringify({ refined: true, wR2 }), free: ["scale", "extinction", "B_O1"] });
  const run = (events: unknown[], model: string): EvalRun => ({ events, port: { state: () => ({ dataset: {}, extinctionModel: model }) } }) as unknown as EvalRun;
  const setModel = { kind: "call", name: "set_extinction_model", input: { model: "bc-1-lorentzian" }, isError: false, text: "{}" };

  it("compares the wR2s of refinements under the same conditions only", async () => {
    const { comparesExtinctionModels } = await import("@/agent/evals/checks");
    // Same data, weights and free set: a fair comparison, the better kept.
    expect(comparesExtinctionModels.grade(run([refine(5.1), setModel, refine(4.2)], "bc-1-lorentzian")).pass).toBe(true);
    // The high order alone under EXTI, the full range under Becker–Coppens: the wR2s do not compare.
    const cut = { kind: "call", name: "set_resolution_range", input: { dMax: 1 }, isError: false, text: "{}" };
    const back = { kind: "call", name: "set_resolution_range", input: { dMax: null }, isError: false, text: "{}" };
    const verdict = comparesExtinctionModels.grade(run([cut, refine(3.0), back, setModel, refine(4.2)], "shelx"));
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toMatch(/never under the same data/);
  });
});

describe("the free set an eval records for a call", () => {
  it("is what a boxcar_scan given `free` fits, not the page's set", async () => {
    const { freeAtCall } = await import("@/agent/evals/harness");
    const row = (id: string, fixed: boolean, expression?: string) => ({ id, label: id, kind: "bIso" as const, value: 1, initialValue: 1, fixed, ...(expression ? { expression } : {}) });
    const params = [row("scale", false), row("delta2", false), row("x_Ga1", true), row("x_Se1", true), row("x_Se2", true, "= x_Se1")];
    expect(freeAtCall("boxcar_scan", { free: ["x_*"] }, params)).toEqual(["x_Ga1", "x_Se1"]);
    expect(freeAtCall("boxcar_scan", {}, params)).toEqual(["scale", "delta2"]);
    expect(freeAtCall("refine", { free: ["x_*"] }, params)).toEqual(["scale", "delta2"]);
    expect(freeAtCall("get_state", {}, params)).toBeUndefined();
  });
});
