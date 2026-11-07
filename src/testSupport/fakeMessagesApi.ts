/**
 * A stand-in Messages API for the chat loop's tests: scripted turns streamed
 * as the real API does (server-sent events), or as Ollama's native chat does
 * (JSON lines), with LM Studio's and Ollama's REST answers when a test needs
 * them. No network, no key.
 */

import { createServer, type Server } from "node:http";

export type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "fallback"; from: string; to: string };

/** What a turn's stream may say besides its blocks: its usage, and the context edits the API applied. */
export interface TurnExtra {
  readonly usage?: Readonly<Record<string, number>>;
  readonly outputTokens?: number;
  readonly contextManagement?: unknown;
}

export function sse(blocks: Block[], stop: string, extra: TurnExtra = {}): string {
  const ev = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
  let out = ev("message_start", {
    message: { id: "msg_x", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: extra.usage ?? { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 80 } },
  });
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      out += ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      out += ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    } else if (b.type === "thinking") {
      // As Ollama streams it: no signature. Claude's carries one, bound to the prompt it was written under.
      out += ev("content_block_start", { index, content_block: { type: "thinking", thinking: "" } });
      out += ev("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } });
      if (b.signature !== undefined) out += ev("content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } });
    } else if (b.type === "fallback") {
      out += ev("content_block_start", { index, content_block: { type: "fallback", from: { model: b.from }, to: { model: b.to }, trigger: { type: "refusal" } } });
    } else {
      out += ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      out += ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    out += ev("content_block_stop", { index });
  });
  out += ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: extra.outputTokens ?? 20 }, ...(extra.contextManagement !== undefined ? { context_management: extra.contextManagement } : {}) });
  out += ev("message_stop", {});
  return out;
}

/** The same turn as Ollama's native chat streams it: one JSON line per piece, then the counts. */
export function ndjson(blocks: Block[], doneReason = "stop", promptTokens?: number): string {
  const lines = blocks.map((b) =>
    b.type === "thinking" ? { message: { role: "assistant", content: "", thinking: b.thinking } }
      : b.type === "text" ? { message: { role: "assistant", content: b.text } }
        : b.type === "tool_use" ? { message: { role: "assistant", content: "", tool_calls: [{ function: { name: b.name, arguments: b.input } }] } }
          : {},
  );
  lines.push({ done: true, done_reason: doneReason, ...(promptTokens !== undefined ? { prompt_eval_count: promptTokens } : {}), eval_count: 20 } as never);
  return lines.map((l) => JSON.stringify({ model: "m", ...l })).join("\n") + "\n";
}

/** Ollama's REST answers, for an Ollama stand-in: the model loaded now (and its context), and its longest. */
export interface OllamaSide {
  readonly model: string;
  readonly loaded: number | null;
  readonly max: number | null;
}

/** LM Studio's REST answers, for an LM Studio stand-in: the model list, and what a load does. */
export interface LmStudioSide {
  readonly models: unknown;
  readonly load?: { status: number; json: unknown };
  readonly seen: { path: string; body: unknown }[];
}

export async function fakeApi(turns: (string | { status: number; json: unknown })[], lmstudio?: LmStudioSide, ollama?: OllamaSide): Promise<{ url: string; server: Server; requests: { path: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] }> {
  const requests: { path: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (ollama && (req.url === "/api/ps" || req.url === "/api/show")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(req.url === "/api/ps"
          ? { models: ollama.loaded === null ? [] : [{ name: ollama.model, model: ollama.model, context_length: ollama.loaded }] }
          : { model_info: ollama.max === null ? {} : { "qwen3.context_length": ollama.max } }));
        return;
      }
      if (lmstudio && req.url?.startsWith("/api/v1/models")) {
        const text = Buffer.concat(chunks).toString("utf8");
        lmstudio.seen.push({ path: req.url, body: text ? JSON.parse(text) : null });
        const out = req.url === "/api/v1/models" ? { status: 200, json: lmstudio.models } : (lmstudio.load ?? { status: 200, json: { status: "loaded" } });
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.json));
        return;
      }
      requests.push({ path: req.url ?? "", headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> });
      const turn = turns[requests.length - 1];
      if (!turn) {
        res.statusCode = 500;
        res.end("no more turns");
        return;
      }
      if (typeof turn !== "string") {
        res.writeHead(turn.status, { "content-type": "application/json" });
        res.end(JSON.stringify(turn.json));
        return;
      }
      res.writeHead(200, { "content-type": req.url === "/api/chat" ? "application/x-ndjson" : "text/event-stream" });
      res.end(turn);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, server, requests };
}
