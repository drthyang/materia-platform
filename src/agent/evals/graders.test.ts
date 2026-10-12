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
