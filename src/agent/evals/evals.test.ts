import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SCENARIOS } from "@/agent/evals/scenarios";
import { REPLAYS } from "@/agent/evals/replays";
import { evalGroup, scenarioReplays } from "@/agent/evals/scenarioReplays";

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

  // The scenarios are split over the evals*.test.ts files by group: a group no file replays, or two files replay, would drop or repeat its cases.
  it("replays every group of scenarios in exactly one test file", () => {
    const dir = resolve(__dirname);
    const replayed = readdirSync(dir)
      .filter((f) => /^evals.*\.test\.ts$/.test(f))
      .flatMap((f) => [...readFileSync(resolve(dir, f), "utf8").matchAll(/scenarioReplays\("([^"]+)"\)/g)].map((m) => m[1]!));
    expect(replayed.sort()).toEqual([...new Set(SCENARIOS.map((s) => evalGroup(s)))].sort());
  });

  scenarioReplays("powder");
});
