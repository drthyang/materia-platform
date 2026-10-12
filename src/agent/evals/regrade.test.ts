import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { scenario } from "@/agent/evals/scenarios";
import { regrade, savedRun, type EvalResult, type SavedRun } from "@/agent/evals/harness";

/**
 * A live run's _OUT report scored again with the checks as they are now, at
 * no cost: no model is called. Off unless a report is given:
 *
 *   MATERIA_AGENT_EVAL_REGRADE=/path/to/out.json npx vitest run src/agent/evals/regrade.test.ts
 *
 * Each run's verdicts are printed beside the ones it had; _OUT writes the
 * re-scored report. A check that reads the page's final state keeps the
 * verdict the run had (regrade() in harness.ts).
 */

const env = process.env;
const path = env.MATERIA_AGENT_EVAL_REGRADE;

describe.skipIf(!path)("Agent evals, re-scored from a saved run", () => {
  const report = path ? (JSON.parse(readFileSync(path, "utf8")) as { model?: string; runs: SavedRun[] }) : { runs: [] };
  const results: { before: SavedRun; after: EvalResult }[] = [];

  afterAll(() => {
    const changed = results.filter((r) => r.before.passed !== r.after.passed);
    const lines = results.map(({ before, after }, i) => {
      const flips = after.grades.filter((g) => before.grades.find((b) => b.check === g.check)?.pass !== g.pass);
      return `  ${after.passed ? "✓" : "✗"} ${i + 1}. ${after.scenario}: ${before.passed ? "passed" : "failed"} → ${after.passed ? "passes" : "fails"}${flips.map((g) => `\n      ${g.pass ? "now passes" : "now fails"}: ${g.check} — ${g.detail}`).join("")}`;
    });
    console.log(`\nRe-scored ${results.length} runs of ${report.model ?? "a model"}: ${results.filter((r) => r.after.passed).length} pass (${results.filter((r) => r.before.passed).length} did); ${changed.length} changed\n${lines.join("\n")}`);
    if (env.MATERIA_AGENT_EVAL_OUT) {
      mkdirSync(dirname(env.MATERIA_AGENT_EVAL_OUT), { recursive: true });
      writeFileSync(env.MATERIA_AGENT_EVAL_OUT, JSON.stringify({ ...report, regradedAt: new Date().toISOString(), runs: results.map((r) => savedRun(r.after)) }, null, 2));
    }
  });

  for (const [i, saved] of report.runs.entries()) {
    it(`${i + 1}. ${saved.scenario}`, () => {
      const after = regrade(saved, scenario(saved.scenario));
      results.push({ before: saved, after });
      for (const g of after.grades) expect.soft(g.pass, `${g.check}: ${g.detail}`).toBe(true);
    });
  }
});
