/**
 * The Agent on Ollama through its native chat API (`POST /api/chat`), the only
 * Ollama endpoint that takes a context length. Its Anthropic-compatible
 * /v1/messages runs a model at the server's default context
 * (OLLAMA_CONTEXT_LENGTH, or one Ollama picks from the GPU's memory — the
 * model's own maximum on a large Mac, 4096 on a machine without a usable GPU),
 * and cuts a longer prompt to fit without an error: the model then answers
 * without its instructions or its method.
 *
 * `ollamaNativeFetch` is a `fetch` for the SDK. It takes the Messages request
 * the chat loop makes, sends it to /api/chat with the `num_ctx` and
 * `num_predict` the chat planned for it (chat.ts sizes them to the prompt),
 * and streams the answer back as the Messages API's events — so the loop, the
 * SDK, the tools and the executor are the same as on every other server.
 * Every other request goes out as `plainFetch` sends it.
 */

import { getJson, plainFetch } from "@/agent/localServer";
import { ollamaBase } from "@/agent/ollama";

/** What one request runs with: the context (tokens) and the most the reply may take. */
export interface OllamaPlan {
  readonly numCtx: number;
  readonly numPredict: number;
}

/** A model's window on the server: the context it is loaded with now, and the longest it takes (null: unknown). */
export interface OllamaWindow {
  readonly loaded: number | null;
  readonly max: number | null;
}

const withTag = (name: string): string => (name.includes(":") ? name : `${name}:latest`);

/** What the server says of the model's context: loaded now (/api/ps), and its maximum (/api/show). Never throws. */
export async function ollamaWindow(url: string, model: string, signal?: AbortSignal): Promise<OllamaWindow> {
  const base = ollamaBase(url);
  const [ps, show] = await Promise.all([
    getJson(`${base}/api/ps`, undefined, signal).catch(() => null) as Promise<{ models?: { name?: string; model?: string; context_length?: number }[] } | null>,
    getJson(`${base}/api/show`, { model }, signal).catch(() => null) as Promise<{ model_info?: Record<string, unknown> } | null>,
  ]);
  const entry = ps?.models?.find((m) => withTag(m.name ?? "") === withTag(model) || withTag(m.model ?? "") === withTag(model));
  const max = Object.entries(show?.model_info ?? {}).find(([k, v]) => k.endsWith(".context_length") && typeof v === "number")?.[1];
  return {
    loaded: typeof entry?.context_length === "number" && entry.context_length > 0 ? entry.context_length : null,
    max: typeof max === "number" ? max : null,
  };
}

// ── the request ─────────────────────────────────────────────────────────────

type Block = { type: string; [k: string]: unknown };
interface MessagesRequest {
  readonly model: string;
  readonly system?: string | readonly { readonly type: string; readonly text?: string }[];
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string | readonly Block[] }[];
  readonly tools?: readonly { readonly name: string; readonly description?: string; readonly input_schema: unknown }[];
  readonly max_tokens?: number;
  readonly temperature?: number;
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
  tool_name?: string;
}

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c && typeof c === "object" && (c as Block).type === "text" ? String((c as Block).text ?? "") : "")).join("\n") : "";

/** A Messages API request as Ollama's /api/chat body, run with `plan`. */
export function toOllamaChat(req: MessagesRequest, plan: OllamaPlan | null): Record<string, unknown> {
  const messages: OllamaMessage[] = [];
  const system = typeof req.system === "string" ? req.system : (req.system ?? []).map((b) => b.text ?? "").join("\n\n");
  if (system) messages.push({ role: "system", content: system });
  const toolOf = new Map<string, string>();
  for (const m of req.messages) {
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const out: OllamaMessage = { role: "assistant", content: m.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n") };
      const thinking = m.content.filter((b) => b.type === "thinking").map((b) => String(b.thinking ?? "")).join("\n");
      if (thinking) out.thinking = thinking;
      const calls = m.content.filter((b) => b.type === "tool_use");
      for (const c of calls) toolOf.set(String(c.id), String(c.name));
      if (calls.length) out.tool_calls = calls.map((c) => ({ function: { name: String(c.name), arguments: c.input ?? {} } }));
      messages.push(out);
      continue;
    }
    // A user turn: each tool result as the tool's message, then any text.
    for (const b of m.content) {
      if (b.type !== "tool_result") continue;
      const name = toolOf.get(String(b.tool_use_id));
      const text = textOf(b.content);
      // Ollama has no error flag on a tool's message: the text says so.
      messages.push({ role: "tool", content: b.is_error && !/^error\b/i.test(text) ? `Error: ${text}` : text, ...(name ? { tool_name: name } : {}) });
    }
    const text = m.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n");
    if (text) messages.push({ role: "user", content: text });
  }
  return {
    model: req.model,
    messages,
    stream: true,
    ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } })) } : {}),
    options: {
      ...(plan ? { num_ctx: plan.numCtx, num_predict: plan.numPredict } : req.max_tokens ? { num_predict: req.max_tokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    },
  };
}

// ── the answer ──────────────────────────────────────────────────────────────

interface Chunk {
  message?: { content?: string; thinking?: string; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string | { message?: string };
}

const event = (type: string, data: object): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/**
 * Ollama's newline-delimited chat stream as the Messages API's server-sent
 * events: thinking and text blocks as they stream, each tool call as a
 * tool_use block, the stop reason and the token counts (the prompt it read,
 * the reply) at the end, an error as an error event.
 */
export function messagesEvents(model: string): { readonly feed: (line: string) => string; readonly end: () => string } {
  let index = -1;
  let open: "text" | "thinking" | null = null;
  let calls = 0;
  let started = false;
  let finished = false;
  const start = (): string => {
    if (started) return "";
    started = true;
    return event("message_start", { message: { id: `msg_ollama_${Date.now().toString(36)}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  };
  const close = (): string => {
    if (open === null) return "";
    open = null;
    return event("content_block_stop", { index });
  };
  const block = (kind: "text" | "thinking", delta: string): string => {
    let out = "";
    if (open !== kind) {
      out += close();
      index++;
      open = kind;
      out += event("content_block_start", { index, content_block: kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" } });
    }
    return out + event("content_block_delta", { index, delta: kind === "text" ? { type: "text_delta", text: delta } : { type: "thinking_delta", thinking: delta } });
  };
  const feed = (line: string): string => {
    const text = line.trim();
    if (!text || finished) return "";
    let chunk: Chunk;
    try {
      chunk = JSON.parse(text) as Chunk;
    } catch {
      return "";
    }
    let out = start();
    if (chunk.error !== undefined) {
      finished = true;
      const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message ?? JSON.stringify(chunk.error);
      return out + event("error", { error: { type: "api_error", message } });
    }
    const m = chunk.message;
    if (m?.thinking) out += block("thinking", m.thinking);
    if (m?.content) out += block("text", m.content);
    for (const call of m?.tool_calls ?? []) {
      const name = call.function?.name;
      if (!name) continue;
      out += close();
      index++;
      const args = call.function?.arguments;
      out += event("content_block_start", { index, content_block: { type: "tool_use", id: call.id || `call_${Date.now().toString(36)}_${calls}`, name, input: {} } });
      out += event("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: typeof args === "string" ? args : JSON.stringify(args ?? {}) } });
      out += event("content_block_stop", { index });
      calls++;
    }
    if (chunk.done) {
      finished = true;
      out += close();
      const stop = chunk.done_reason === "length" ? "max_tokens" : calls > 0 ? "tool_use" : "end_turn";
      out += event("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: chunk.eval_count ?? 0, ...(typeof chunk.prompt_eval_count === "number" ? { input_tokens: chunk.prompt_eval_count } : {}) } });
      out += event("message_stop", {});
    }
    return out;
  };
  const end = (): string => (finished ? "" : start() + event("error", { error: { type: "api_error", message: "Ollama ended the reply without finishing it." } }));
  return { feed, end };
}

/**
 * The SDK's fetch for Ollama: a Messages request goes to /api/chat with the
 * plan `plan()` gives (null: only the reply's cap, at the server's context),
 * its answer comes back as Messages events; anything else as plainFetch sends it.
 */
export function ollamaNativeFetch(plan: () => OllamaPlan | null): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/v1\/messages(\?|$)/.test(url) || (init?.method ?? "GET").toUpperCase() !== "POST" || typeof init?.body !== "string") return plainFetch(input, init);
    const req = JSON.parse(init.body) as MessagesRequest;
    const native = url.replace(/\/v1\/messages(\?.*)?$/, "/api/chat");
    const res = await globalThis.fetch(native, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toOllamaChat(req, plan())), ...(init.signal ? { signal: init.signal } : {}) });
    if (!res.ok) {
      const raw = await res.text();
      let message = raw;
      try {
        const body = JSON.parse(raw) as { error?: string | { message?: string } };
        message = typeof body.error === "string" ? body.error : body.error?.message ?? raw;
      } catch {
        // not JSON: the text as it is
      }
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message } }), { status: res.status, headers: { "content-type": "application/json" } });
    }
    if (!res.body) throw new Error("Ollama answered with no body to stream.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const sse = messagesEvents(req.model);
    let buffer = "";
    const stream = new ReadableStream<Uint8Array>({
      // Read until a read yields an event (or the stream ends): a pull that
      // enqueues nothing is not called again, and the reader would wait forever
      // on a chunk that held only part of a line, or lines with no event.
      async pull(controller) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            const tail = sse.feed(buffer + decoder.decode()) + sse.end();
            if (tail) controller.enqueue(encoder.encode(tail));
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          const out = lines.map(sse.feed).join("");
          if (out) {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}
