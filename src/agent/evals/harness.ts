/**
 * The Agent eval suite: a scenario — a page, what the user says, what they
 * approve — run through the real chat loop (AgentChat), the real executor and
 * tools on a headless page, and the transcript graded by checks written from
 * the failures the researcher rounds and the users found.
 *
 * The model is whatever `config` points at: Claude in a live run
 * (live.test.ts, behind MATERIA_AGENT_EVAL), or a scripted stand-in
 * (scripted.ts) replaying a good and a bad transcript per scenario, so CI
 * checks that each check passes the behaviour it wants and catches the one it
 * was written against.
 */

import { AgentChat, type ChatConfig } from "@/agent/chat";
import { AgentExecutor, type ActivityEntry, type ToolRunner } from "@/agent/executor";
import type { AgentPort } from "@/agent/port";
import type { AgentAutonomy } from "@/agent/systemPrompt";
import type { AgentRecord } from "@/agent/method";
import { liveTool } from "@/agent/tools";
import { fakeHost } from "@/testSupport/agentHeadless";

/** One thing that happened in the conversation, in order. */
export type EvalEvent =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "reply"; readonly text: string }
  | {
    readonly kind: "call";
    readonly name: string;
    readonly input: Readonly<Record<string, unknown>>;
    readonly isError: boolean;
    readonly text: string;
    /** The free parameters when the call was made (refine and boxcar_scan). */
    readonly free?: readonly string[];
  };

export type EvalCall = Extract<EvalEvent, { kind: "call" }>;

/** Tokens the model spent on a run, summed over its turns (zero for a scripted model). */
export interface EvalUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface EvalRun {
  readonly events: readonly EvalEvent[];
  readonly port: AgentPort;
  /** The Agent's records at the end, by analysis key. */
  readonly records: ReadonlyMap<string, AgentRecord>;
  /** Every approval the stand-in user was asked for. */
  readonly asked: readonly ActivityEntry[];
  /** The chat's notices (errors, stalls, loops). */
  readonly notices: readonly string[];
  readonly usage: EvalUsage;
  /** Each model turn's prompt (every input token, cached or not) and reply, in tokens, in order. */
  readonly turns: readonly { readonly prompt: number; readonly output: number }[];
  /** Wall-clock time of the run, in seconds. */
  readonly seconds: number;
}

export interface Verdict {
  readonly pass: boolean;
  readonly detail: string;
}

export interface Check {
  readonly name: string;
  readonly grade: (run: EvalRun) => Verdict;
}

export interface EvalScenario {
  readonly id: string;
  readonly title: string;
  /** What found the failure this scenario guards against. */
  readonly origin: string;
  readonly page: () => AgentPort;
  /** False when the page's data are not on this machine (a scenario on git-ignored data): it is skipped, not failed. */
  readonly available?: () => boolean;
  /** What the user says, one message per turn. */
  readonly messages: readonly string[];
  readonly autonomy: AgentAutonomy;
  /**
   * What the stand-in user approves: every change (default) or none. A change
   * only the user may make (an always-ask tool: lifting a firm rule, adding a
   * phase, an instrument constant) is declined unless the scenario's user
   * asked for it and names the tool here.
   */
  readonly approve?: "changes" | "nothing";
  /** Always-ask tools the stand-in user approves (their request asked for it). */
  readonly approveAsked?: readonly string[];
  readonly checks: readonly Check[];
}

export interface EvalResult {
  readonly scenario: string;
  readonly run: EvalRun;
  readonly grades: readonly (Verdict & { readonly check: string })[];
  readonly passed: boolean;
}

/** The model's side of a run: everything but the autonomy, which the scenario sets. */
export type EvalModel = Omit<ChatConfig, "autonomy">;

export const calls = (run: EvalRun): EvalCall[] => run.events.filter((e): e is EvalCall => e.kind === "call");
export const replies = (run: EvalRun): string[] => run.events.filter((e) => e.kind === "reply").map((e) => (e as { text: string }).text).filter((t) => t.trim() !== "");
export const isChange = (name: string): boolean => liveTool(name)?.effect === "change";

/** Run one scenario and grade it. Never throws for the model's behaviour; a chat error becomes a notice. */
export async function runScenario(scenario: EvalScenario, model: EvalModel, signal: AbortSignal = new AbortController().signal): Promise<EvalResult> {
  const port = scenario.page();
  const { host, records } = fakeHost(port);
  const asked: ActivityEntry[] = [];
  const events: EvalEvent[] = [];
  const notices: string[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const turns: { prompt: number; output: number }[] = [];
  const started = Date.now();
  const executor = new AgentExecutor(host, {
    approve: async (entry) => {
      asked.push(entry);
      return (!entry.alwaysAsk || (scenario.approveAsked ?? []).includes(entry.tool)) && scenario.approve !== "nothing";
    },
    onActivity: () => undefined,
  });
  const runner: ToolRunner = {
    run: async (name, input) => {
      const free = name === "refine" || name === "boxcar_scan" ? port.state().parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.id) : undefined;
      const out = await executor.run(name, input);
      events.push({ kind: "call", name, input: (input ?? {}) as Record<string, unknown>, isError: out.isError, text: out.text, ...(free ? { free } : {}) });
      return out;
    },
    newConversation: () => executor.newConversation(),
    heard: (text) => executor.heard(text),
    situation: () => executor.situation(),
  };
  const chat = new AgentChat(runner);
  let reply: { kind: "reply"; text: string } | null = null;
  for (const text of scenario.messages) {
    events.push({ kind: "user", text });
    try {
      await chat.send(text, { ...model, autonomy: scenario.autonomy }, {
        onAssistantStart: () => {
          reply = { kind: "reply", text: "" };
          events.push(reply);
        },
        onText: (delta) => {
          if (reply) reply.text += delta;
        },
        onThinking: () => undefined,
        onNotice: (notice) => notices.push(notice),
        onUsage: (u) => {
          usage.input += u.input_tokens ?? 0;
          usage.output += u.output_tokens ?? 0;
          usage.cacheRead += u.cache_read_input_tokens ?? 0;
          usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
          turns.push({ prompt: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0 });
        },
      }, signal);
    } catch (e) {
      notices.push(`chat error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const run: EvalRun = { events, port, records, asked, notices, usage, turns, seconds: (Date.now() - started) / 1000 };
  const grades = scenario.checks.map((c) => ({ check: c.name, ...c.grade(run) }));
  return { scenario: scenario.id, run, grades, passed: grades.every((g) => g.pass) };
}

/** A run as text, for a report or a failing test's message. */
export function transcript(run: EvalRun, max = 400): string {
  const cut = (t: string): string => (t.length > max ? `${t.slice(0, max)}…` : t);
  return run.events.map((e) =>
    e.kind === "user" ? `USER: ${e.text}`
      : e.kind === "reply" ? `AGENT: ${cut(e.text)}`
        : `  → ${e.name}(${JSON.stringify(e.input)})${e.isError ? " ✗" : ""} ${cut(e.text)}`,
  ).join("\n") + (run.notices.length ? `\nNOTICES: ${run.notices.join(" | ")}` : "");
}

/**
 * What the local tier asks of every run besides its scenario's checks
 * (docs/AGENT_EVALS.md): the conversation never hits the turn cap, the app
 * never stops it for going in circles, no chat error, and no prompt the
 * server cut. Also the most times one call (tool and input) was made.
 */
export interface TierFlags {
  readonly turnCap: boolean;
  readonly loopStopped: boolean;
  readonly chatError: boolean;
  readonly truncated: boolean;
  readonly maxSameCall: number;
}

export function tierFlags(run: EvalRun): TierFlags {
  const counts = new Map<string, number>();
  for (const c of calls(run)) {
    const key = `${c.name} ${JSON.stringify(c.input)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    turnCap: run.notices.some((n) => /^Stopped after \d+ model turns/.test(n)),
    loopStopped: run.notices.some((n) => /going in circles/.test(n)),
    chatError: run.notices.some((n) => n.startsWith("chat error:")),
    truncated: run.notices.some((n) => /cut the prompt|does not fit|no longer fits/i.test(n)),
    maxSameCall: Math.max(0, ...counts.values()),
  };
}
