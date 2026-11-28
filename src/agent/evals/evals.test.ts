import { describe, it, expect } from "vitest";
import { SCENARIOS } from "@/agent/evals/scenarios";
import { REPLAYS } from "@/agent/evals/replays";
import { scenarioReplays } from "@/agent/evals/scriptedReplay";

/**
 * The eval suite in CI: every scenario replayed with a scripted model, once
 * as the Agent should behave (every check passes) and once as it did when the
 * failure was found (the checks written against it fail). The real chat loop,
 * executor and tools run each time; only the model is scripted. The live run
 * against Claude is live.test.ts.
 */

describe("Agent evals, scripted", () => {
  it("has a good and a bad replay for every scenario", () => {
    expect(Object.keys(REPLAYS).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  scenarioReplays("powder");
});
