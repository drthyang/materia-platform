import { describe, it } from "vitest";
import { appendFileSync } from "node:fs";
import { runScenario, savedRun, type EvalScenario } from "@/agent/evals/harness";
import { CHILD_ENV, progressLines, writeWhole, type ChildSpec, type ProgressLine, type ScenarioSet } from "@/agent/evals/isolated";

/**
 * One eval run, in the child process isolated.ts starts for it: off unless
 * MATERIA_AGENT_EVAL_CHILD names the run. The scenario runs as it would in
 * the test process (runScenario); its progress is appended to a file as it
 * goes, so the parent keeps the run so far if it has to kill this process,
 * and the finished run is written whole for the parent to read.
 */

const raw = process.env[CHILD_ENV];

const SETS: Record<ScenarioSet, () => Promise<readonly EvalScenario[]>> = {
  evals: async () => (await import("@/agent/evals/scenarios")).SCENARIOS,
  stuck: async () => (await import("@/agent/evals/stuckScenarios")).STUCK_SCENARIOS,
};

describe.skipIf(!raw)("an eval run in a process of its own (isolated.ts)", () => {
  it("runs the scenario", async () => {
    const spec = JSON.parse(raw!) as ChildSpec;
    const write = (lines: readonly ProgressLine[]): void => appendFileSync(spec.progress, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
    write([{ kind: "start" }]);
    const found = (await SETS[spec.set]()).find((s) => s.id === spec.scenario);
    if (!found) throw new Error(`no scenario ${spec.scenario} in ${spec.set}`);
    const sent = { events: 0, notices: 0, technique: false };
    const result = await runScenario(found, spec.model, undefined, undefined, (p) => write(progressLines(p, sent)));
    writeWhole(spec.result, JSON.stringify(savedRun(result)));
  }, 24 * 3_600_000); // the parent's limits stop it, not this
});
