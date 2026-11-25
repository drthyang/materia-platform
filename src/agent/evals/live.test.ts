import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SCENARIOS } from "@/agent/evals/scenarios";
import { type EvalModel } from "@/agent/evals/harness";
import { LiveRuns, isolatedTranscript } from "@/agent/evals/isolated";
import type { ChatEffort, ChatTransport } from "@/agent/chat";

/**
 * The eval suite against a real model: every scenario run through the chat
 * loop, the executor and the tools, and graded. Off unless asked for, since
 * it spends tokens and takes minutes:
 *
 *   MATERIA_AGENT_EVAL=1 ANTHROPIC_API_KEY=… npm run eval:agent
 *
 * MATERIA_AGENT_EVAL_MODEL (default claude-opus-5-5), _EFFORT (default high),
 * _TRANSPORT (api-key, ollama, lmstudio or openai-compatible; a server at
 * _SERVER, the last with its key in _API_KEY), _CONTEXT (the context for a
 * server that does not say its own, or for Ollama to load a model with),
 * _ONLY (scenario ids, comma-separated), _REPEAT (runs per scenario, default
 * 1), _TIMEOUT_MIN (minutes per run, default 20), _CAP_MIN (minutes for the
 * whole live run, default 30) and _OUT (a JSON report) adjust it. Each
 * scenario's checks are soft assertions: the run reports every failure, with
 * the transcript. A scenario whose data are not on this machine (the user's
 * own, git-ignored) is skipped and said so.
 *
 * The limits hold even when a run's page work holds its thread (a moment fit
 * with many free components): each run is a child process (isolated.ts) that
 * is killed at the run's limit or at the overall cap. A run so stopped fails
 * with outcome "timeout" and its conversation up to then; once the cap is
 * spent the runs left are not run, and listed so. The summary and the _OUT
 * report are written all the same (the report after every run, too).
 *
 * The local tier (docs/AGENT_EVALS.md) reads more than the checks from each
 * run: whether it hit the turn cap, was stopped for going in circles, met a
 * chat error, or had its prompt cut, and how long it took; the summary prints
 * them and the report keeps each turn's prompt size.
 *
 * The _OUT report keeps each run whole (savedRun): every tool's answer, the
 * records, the reports' text and what their number audit read. A change to a
 * check or to the audit is scored on it again for free:
 *
 *   MATERIA_AGENT_EVAL_REGRADE=/path/to/out.json npx vitest run src/agent/evals/regrade.test.ts
 */

const env = process.env;
const live = env.MATERIA_AGENT_EVAL === "1";
const transport = (env.MATERIA_AGENT_EVAL_TRANSPORT ?? "api-key") as ChatTransport;
const model: EvalModel = {
  transport,
  model: env.MATERIA_AGENT_EVAL_MODEL ?? "claude-opus-5-5",
  effort: (env.MATERIA_AGENT_EVAL_EFFORT ?? "high") as ChatEffort,
  ...(transport === "api-key" && env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
  ...(transport === "openai-compatible" && env.MATERIA_AGENT_EVAL_API_KEY ? { apiKey: env.MATERIA_AGENT_EVAL_API_KEY } : {}),
  ...(env.MATERIA_AGENT_EVAL_SERVER ? { serverUrl: env.MATERIA_AGENT_EVAL_SERVER } : {}),
  ...(env.MATERIA_AGENT_EVAL_CONTEXT ? { context: Number(env.MATERIA_AGENT_EVAL_CONTEXT) } : {}),
};
const only = env.MATERIA_AGENT_EVAL_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const repeat = Math.max(1, Number(env.MATERIA_AGENT_EVAL_REPEAT ?? 1) || 1);
const asked = SCENARIOS.filter((s) => !only || only.includes(s.id));
const chosen = asked.filter((s) => s.available?.() ?? true);
const minutes = Math.max(1, Number(env.MATERIA_AGENT_EVAL_TIMEOUT_MIN ?? 20) || 20);
const capMinutes = Math.max(1, Number(env.MATERIA_AGENT_EVAL_CAP_MIN ?? 30) || 30);

describe.skipIf(!live)(`Agent evals, live (${model.model})`, () => {
  const live = new LiveRuns(model, { runMs: minutes * 60_000, capMs: capMinutes * 60_000 });
  const skipped = asked.filter((s) => !chosen.includes(s));

  /** The _OUT report: written after every run, so a run killed from outside keeps what finished. */
  const writeOut = (): void => {
    if (!env.MATERIA_AGENT_EVAL_OUT) return;
    mkdirSync(dirname(env.MATERIA_AGENT_EVAL_OUT), { recursive: true });
    writeFileSync(env.MATERIA_AGENT_EVAL_OUT, JSON.stringify({
      model: model.model,
      transport,
      effort: model.effort,
      at: new Date().toISOString(),
      limits: { runMinutes: minutes, capMinutes },
      capReached: live.capReached,
      summary: live.rows(chosen.map((s) => s.id)),
      skipped: skipped.map((s) => s.id),
      notRun: live.notRun,
      usage: live.usage(),
      runs: live.saved(),
    }, null, 2));
  };

  afterAll(() => {
    const rows = live.rows(chosen.map((s) => s.id));
    const total = rows.reduce((n, r) => n + r.passed, 0);
    const usage = live.usage();
    const flagged = (r: (typeof rows)[number]): string => [r.timeout ? `timeout ×${r.timeout}` : "", r.error ? `process failed ×${r.error}` : "", r.notRun ? `not run ×${r.notRun}` : "", r.turnCap ? `turn cap ×${r.turnCap}` : "", r.loopStopped ? `loop stopped ×${r.loopStopped}` : "", r.chatError ? `chat error ×${r.chatError}` : "", r.truncated ? `cut ×${r.truncated}` : "", r.maxSameCall > 2 ? `same call ×${r.maxSameCall}` : ""].filter(Boolean).join(", ");
    const seconds = rows.reduce((t, r) => t + r.seconds, 0);
    const cap = live.capReached ? `\n!!! The overall cap of ${capMinutes} min was reached: the run going then was stopped${live.notRun.length ? `, and ${live.notRun.length} not run: ${live.notRun.join(", ")}` : ""}.` : "";
    console.log(`\nAgent evals (${model.model}, ${transport}): ${total}/${live.runs.length} runs passed in ${seconds} s${cap}\n${rows.map((r) => `  ${r.passed === r.runs + r.notRun ? "✓" : "✗"} ${r.id}: ${r.passed}/${r.runs + r.notRun} (${r.seconds} s${flagged(r) ? `; ${flagged(r)}` : ""})`).join("\n")}${skipped.length ? `\nSkipped (data not on this machine): ${skipped.map((s) => s.id).join(", ")}` : ""}\nTokens: input ${usage.input}, output ${usage.output}, cache read ${usage.cacheRead}, cache write ${usage.cacheWrite}`);
    writeOut();
  });

  for (const s of chosen) {
    for (let i = 0; i < repeat; i++) {
      const label = `${s.id}${repeat > 1 ? ` #${i + 1}` : ""}`;
      it(`${label}: ${s.title}`, async (ctx) => {
        const done = await live.next(label, s.id);
        if (!done) {
          console.error(`!!! ${label}: not run, the overall cap of ${capMinutes} min is spent`);
          writeOut();
          ctx.skip();
          return;
        }
        writeOut();
        if (done.run.outcome !== "finished") console.error(`!!! ${label}: ${done.run.record.grades[0]!.check}: ${done.run.record.grades[0]!.detail}`);
        const text = isolatedTranscript(done.run);
        for (const g of done.run.record.grades) expect.soft(g.pass, `${g.check}: ${g.detail}\n---\n${text}`).toBe(true);
        // The run's own limit and the cap stop it (isolated.ts); this is only Vitest's backstop.
      }, (Math.min(minutes, capMinutes) + 5) * 60_000);
    }
  }
});
