import { describe, expect, it } from "vitest";
import { flackReading } from "@/agent/scTools";
import { refinesFlack } from "@/agent/evals/checks";
import type { EvalRun } from "@/agent/evals/harness";

/** The Flack x refines free of [0, 1] (flackUnbounded.test.ts): what a value outside it means, and the grader that reads it. */
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
