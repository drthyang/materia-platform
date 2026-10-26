/**
 * The dev server's run recorder (opt-in: MATERIA_RECORD=1, `npm run dev`
 * only): a live run through the Agent's local proxy is written down as a
 * replay of that run, so it can be played again on the page
 * (`?agentReplay=local-live-…`) exactly as the model took it — its words and
 * its tool calls, the tools themselves run again by the page.
 *
 * Every request the Copilot sends carries the conversation so far; every
 * response is one model turn. The recorder keeps the turns from the responses
 * (by the number of assistant messages the request already holds, as the
 * replay server counts them), and from the requests the scientist's own
 * messages and what each tool answered, so a replay can be checked against
 * the run. A request with no assistant message starts a new recording.
 *
 * Written to the git-ignored data folder (`data/replays/`, or
 * MATERIA_DATA_DIR's), never anywhere else. Imports nothing through the "@/"
 * alias: vite.config.ts loads it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ScriptTurn } from "./sse";

/** A recorded run: a replay (the shape replay/server.ts plays) with what the run saw beside it. */
export interface RecordedRun {
  readonly page: "files";
  /** The scientist's first message: the one a replay types. */
  readonly message: string;
  /** The model that took the run (the request's `model`). */
  readonly model: string;
  readonly recordedAt: string;
  readonly turns: readonly ScriptTurn[];
  /** Messages the scientist typed after the first, each before the model turn it led to. */
  readonly userMessages: readonly { readonly beforeTurn: number; readonly text: string }[];
  /** What each tool call answered (truncated), by the turn that made it: declines and refusals included. */
  readonly results: readonly { readonly turn: number; readonly tool: string; readonly isError: boolean; readonly text: string }[];
}

type Block = { type?: string; text?: string; name?: string; id?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };
type Message = { role?: string; content?: string | Block[] };

/** A result kept to this many characters: enough to check a number, not the bulk of a ref. */
const RESULT_CHARS = 1500;

/** The model turn a streamed response holds (server-sent events): its text and its tool calls; thinking is left out. */
export function turnFromSse(stream: string): ScriptTurn {
  const blocks = new Map<number, { type: string; name?: string; text: string; json: string }>();
  for (const chunk of stream.split(/\r?\n\r?\n/)) {
    const data = chunk.split(/\r?\n/).find((l) => l.startsWith("data:"));
    if (!data) continue;
    let ev: { type?: string; index?: number; content_block?: Block; delta?: { type?: string; text?: string; partial_json?: string } };
    try {
      ev = JSON.parse(data.slice(5).trim());
    } catch {
      continue;
    }
    const i = ev.index ?? -1;
    if (ev.type === "content_block_start" && ev.content_block) {
      blocks.set(i, { type: ev.content_block.type ?? "", ...(ev.content_block.name ? { name: ev.content_block.name } : {}), text: ev.content_block.text ?? "", json: "" });
    } else if (ev.type === "content_block_delta" && ev.delta) {
      const b = blocks.get(i);
      if (!b) continue;
      if (ev.delta.type === "text_delta") b.text += ev.delta.text ?? "";
      else if (ev.delta.type === "input_json_delta") b.json += ev.delta.partial_json ?? "";
    }
  }
  const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => b);
  const text = ordered.filter((b) => b.type === "text").map((b) => b.text).join("");
  const calls = ordered.filter((b) => b.type === "tool_use" && b.name).map((b) => {
    let input: Record<string, unknown> = {};
    try {
      input = b.json ? (JSON.parse(b.json) as Record<string, unknown>) : {};
    } catch {
      input = {};
    }
    return { name: b.name!, input };
  });
  return { ...(text ? { text } : {}), ...(calls.length ? { calls } : {}) };
}

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? (content as Block[]).map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("") : "";

/**
 * The run after one exchange: the request body the page sent and the response
 * it streamed back. A request with no assistant message starts a new run.
 */
export function recordExchange(run: RecordedRun | null, requestBody: string, responseStream: string, now: Date = new Date()): RecordedRun | null {
  let req: { model?: string; messages?: Message[] };
  try {
    req = JSON.parse(requestBody);
  } catch {
    return run;
  }
  const messages = req.messages ?? [];
  const n = messages.filter((m) => m.role === "assistant").length;
  const turn = turnFromSse(responseStream);
  if (!turn.text && !turn.calls) return run;
  // Each tool_use id's name, from the assistant messages, so a result can say which tool answered.
  const toolOf = new Map<string, string>();
  for (const m of messages) if (m.role === "assistant" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_use" && b.id && b.name) toolOf.set(b.id, b.name);
  const userMessages: { beforeTurn: number; text: string }[] = [];
  const results: { turn: number; tool: string; isError: boolean; text: string }[] = [];
  let seen = 0;
  for (const m of messages) {
    if (m.role === "assistant") {
      seen++;
      continue;
    }
    if (m.role !== "user") continue;
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content ?? [];
    for (const b of blocks) {
      if (b.type === "tool_result") results.push({ turn: seen - 1, tool: toolOf.get(b.tool_use_id ?? "") ?? "", isError: b.is_error === true, text: textOf(b.content).slice(0, RESULT_CHARS) });
    }
    const typed = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    if (typed) userMessages.push({ beforeTurn: seen, text: typed });
  }
  const first = userMessages.find((u) => u.beforeTurn === 0)?.text ?? run?.message ?? "";
  const fresh = n === 0 || run === null;
  const turns = fresh ? [] : [...run!.turns];
  turns[n] = turn;
  return {
    page: "files",
    message: first,
    model: req.model ?? run?.model ?? "",
    recordedAt: fresh ? now.toISOString() : run!.recordedAt,
    turns,
    userMessages: userMessages.filter((u) => u.beforeTurn > 0),
    results,
  };
}

/** The replay id a recording is played by: the model, then the time it started (local-live-claude-sonnet-5-5-20261026-101500). */
export function recordingId(run: RecordedRun): string {
  const at = run.recordedAt.replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");
  const model = run.model.replace(/[^A-Za-z0-9-]/g, "-") || "model";
  return `local-live-${model}-${at}`;
}

/** The recorder the proxy calls after each exchange: keeps the current run and writes it after every turn. */
export function runRecorder(dir = process.env.MATERIA_DATA_DIR ? resolve(process.env.MATERIA_DATA_DIR) : resolve(process.cwd(), "data")) {
  let run: RecordedRun | null = null;
  const folder = join(dir, "replays");
  return {
    exchange(requestBody: string, responseStream: string): string | null {
      run = recordExchange(run, requestBody, responseStream);
      if (!run) return null;
      mkdirSync(folder, { recursive: true });
      const id = recordingId(run);
      writeFileSync(join(folder, `${id}.json`), JSON.stringify(run, null, 1));
      return id;
    },
  };
}

export type RunRecorder = ReturnType<typeof runRecorder>;
