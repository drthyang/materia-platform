import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SCENARIOS } from "@/agent/evals/scenarios";
import { runScenario, tierFlags, transcript, type EvalModel, type EvalResult } from "@/agent/evals/harness";
import type { ChatEffort, ChatTransport } from "@/agent/chat";

/**
 * The eval suite against a real model: every scenario run through the chat
 * loop, the executor and the tools, and graded. Off unless asked for, since
 * it spends tokens and takes minutes:
 *
 *   MATERIA_AGENT_EVAL=1 ANTHROPIC_API_KEY=… npm run eval:agent
 *
 * MATERIA_AGENT_EVAL_MODEL (default claude-opus-5-5), _EFFORT (default high),
 * _TRANSPORT (api-key, ollama or lmstudio; a local server at _SERVER),
 * _ONLY (scenario ids, comma-separated), _REPEAT (runs per scenario, default
 * 1), _TIMEOUT_MIN (minutes per run, default 20) and _OUT (a JSON report)
 * adjust it. Each scenario's checks are soft assertions: the run reports every
 * failure, with the transcript. A scenario whose data are not on this machine
 * (the user's own, git-ignored) is skipped and said so.
 *
 * The local tier (docs/AGENT_EVALS.md) reads more than the checks from each
 * run: whether it hit the turn cap, was stopped for going in circles, met a
 * chat error, or had its prompt cut, and how long it took; the summary prints
 * them and the report keeps each turn's prompt size.
 */

const env = process.env;
const live = env.MATERIA_AGENT_EVAL === "1";
const transport = (env.MATERIA_AGENT_EVAL_TRANSPORT ?? "api-key") as ChatTransport;
const model: EvalModel = {
  transport,
  model: env.MATERIA_AGENT_EVAL_MODEL ?? "claude-opus-5-5",
  effort: (env.MATERIA_AGENT_EVAL_EFFORT ?? "high") as ChatEffort,
  ...(transport === "api-key" && env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
  ...(env.MATERIA_AGENT_EVAL_SERVER ? { serverUrl: env.MATERIA_AGENT_EVAL_SERVER } : {}),
};
const only = env.MATERIA_AGENT_EVAL_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const repeat = Math.max(1, Number(env.MATERIA_AGENT_EVAL_REPEAT ?? 1) || 1);
const asked = SCENARIOS.filter((s) => !only || only.includes(s.id));
const chosen = asked.filter((s) => s.available?.() ?? true);
const minutes = Math.max(1, Number(env.MATERIA_AGENT_EVAL_TIMEOUT_MIN ?? 20) || 20);

describe.skipIf(!live)(`Agent evals, live (${model.model})`, () => {
  const results: EvalResult[] = [];

  afterAll(() => {
    const rows = chosen.map((s) => {
      const runs = results.filter((r) => r.scenario === s.id);
      const flags = runs.map((r) => tierFlags(r.run));
      return {
        id: s.id,
        passed: runs.filter((r) => r.passed).length,
        runs: runs.length,
        seconds: Math.round(runs.reduce((t, r) => t + r.run.seconds, 0)),
        turnCap: flags.filter((f) => f.turnCap).length,
        loopStopped: flags.filter((f) => f.loopStopped).length,
        chatError: flags.filter((f) => f.chatError).length,
        truncated: flags.filter((f) => f.truncated).length,
        maxSameCall: Math.max(0, ...flags.map((f) => f.maxSameCall)),
      };
    });
    const skipped = asked.filter((s) => !chosen.includes(s));
    const total = rows.reduce((n, r) => n + r.passed, 0);
    const usage = results.reduce((u, r) => ({
      input: u.input + r.run.usage.input,
      output: u.output + r.run.usage.output,
      cacheRead: u.cacheRead + r.run.usage.cacheRead,
      cacheWrite: u.cacheWrite + r.run.usage.cacheWrite,
    }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    const flagged = (r: (typeof rows)[number]): string => [r.turnCap ? `turn cap ×${r.turnCap}` : "", r.loopStopped ? `loop stopped ×${r.loopStopped}` : "", r.chatError ? `chat error ×${r.chatError}` : "", r.truncated ? `cut ×${r.truncated}` : "", r.maxSameCall > 2 ? `same call ×${r.maxSameCall}` : ""].filter(Boolean).join(", ");
    const seconds = rows.reduce((t, r) => t + r.seconds, 0);
    console.log(`\nAgent evals (${model.model}, ${transport}): ${total}/${results.length} runs passed in ${seconds} s\n${rows.map((r) => `  ${r.passed === r.runs ? "✓" : "✗"} ${r.id}: ${r.passed}/${r.runs} (${r.seconds} s${flagged(r) ? `; ${flagged(r)}` : ""})`).join("\n")}${skipped.length ? `\nSkipped (data not on this machine): ${skipped.map((s) => s.id).join(", ")}` : ""}\nTokens: input ${usage.input}, output ${usage.output}, cache read ${usage.cacheRead}, cache write ${usage.cacheWrite}`);
    if (env.MATERIA_AGENT_EVAL_OUT) {
      mkdirSync(dirname(env.MATERIA_AGENT_EVAL_OUT), { recursive: true });
      writeFileSync(env.MATERIA_AGENT_EVAL_OUT, JSON.stringify({
        model: model.model,
        transport,
        effort: model.effort,
        at: new Date().toISOString(),
        summary: rows,
        skipped: skipped.map((s) => s.id),
        usage,
        runs: results.map((r) => ({ scenario: r.scenario, passed: r.passed, seconds: r.run.seconds, flags: tierFlags(r.run), turns: r.run.turns, notices: r.run.notices, usage: r.run.usage, grades: r.grades, transcript: transcript(r.run, 2000) })),
      }, null, 2));
    }
  });

  for (const s of chosen) {
    for (let i = 0; i < repeat; i++) {
      it(`${s.id}${repeat > 1 ? ` #${i + 1}` : ""}: ${s.title}`, async () => {
        const result = await runScenario(s, model);
        results.push(result);
        const text = transcript(result.run);
        for (const g of result.grades) expect.soft(g.pass, `${g.check}: ${g.detail}\n---\n${text}`).toBe(true);
      }, minutes * 60_000);
    }
  }
});
