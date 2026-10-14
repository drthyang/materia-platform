/**
 * The Agent on any OpenAI-compatible server: OpenAI, Gemini's OpenAI-compatible
 * endpoint, vLLM, a llama.cpp server, and the like. They share one dialect —
 * GET <base>/models, POST <base>/chat/completions with tools — so one provider
 * covers them: a base URL, an optional API key, and a model from the list.
 *
 * `openaiCompatFetch` is a `fetch` for the Anthropic SDK, as Ollama's is
 * (ollamaNative.ts): it takes the Messages request the chat loop makes, sends
 * it as a chat completion (tools as functions, results as tool messages, the
 * reply capped by the chat's own sizing), and streams the answer back as the
 * Messages API's events. The loop, the tools and the executor stay the same.
 *
 * The window: few of these servers say how long a prompt they take (vLLM's
 * max_model_len, a llama.cpp server's n_ctx, some gateways' context_length).
 * When the server is silent the chat uses the context the user set (32k by
 * default) and refuses rather than send a prompt longer than it. The key is
 * sent only to the server the user named, as a Bearer token.
 *
 * Kept free of the SDK so the drawer can list models without loading it.
 */

import { serverBase } from "@/agent/localServer";

export interface OpenAIPreset {
  readonly id: string;
  readonly label: string;
  /** The base URL, with its /v1 (or the provider's own prefix): <base>/models, <base>/chat/completions. */
  readonly baseUrl: string;
  readonly needsKey: boolean;
  /** Runs on this machine: nothing leaves it. */
  readonly local: boolean;
}

export const OPENAI_PRESETS: readonly OpenAIPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", needsKey: true, local: false },
  { id: "gemini", label: "Gemini (OpenAI-compatible)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true, local: false },
  { id: "vllm", label: "vLLM", baseUrl: "http://localhost:8000/v1", needsKey: false, local: true },
  { id: "llamacpp", label: "llama.cpp server", baseUrl: "http://localhost:8080/v1", needsKey: false, local: true },
  { id: "custom", label: "Other", baseUrl: "", needsKey: false, local: false },
];

/** The window used when the server does not say how long a prompt it takes, in tokens (the user may change it). */
export const DEFAULT_OPENAI_CONTEXT = 32_768;

export const openaiBase = (url: string): string => serverBase(url, OPENAI_PRESETS[0]!.baseUrl);

/** The preset a base URL is, or null. */
export const presetForUrl = (url: string): OpenAIPreset | null => OPENAI_PRESETS.find((p) => p.baseUrl && openaiBase(p.baseUrl) === openaiBase(url)) ?? null;

/** A server on this machine (no key needed, nothing leaves it). */
export function isMachineUrl(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"].includes(new URL(openaiBase(url)).hostname);
  } catch {
    return false;
  }
}

const authHeaders = (key: string | undefined): Record<string, string> => (key ? { authorization: `Bearer ${key}` } : {});

export interface OpenAIModel {
  readonly id: string;
  /** The longest prompt the server says it takes (null: it does not say). */
  readonly context: number | null;
}

/**
 * The server's models, by id, with the context each takes when the server
 * says it (vLLM's max_model_len, a gateway's context_length, a llama.cpp
 * server's n_ctx). Throws a readable error when the server cannot be reached
 * or refuses the key.
 */
export async function listOpenAIModels(url: string, key: string | undefined, signal?: AbortSignal): Promise<OpenAIModel[]> {
  const base = openaiBase(url);
  let res: Response;
  try {
    res = await globalThis.fetch(`${base}/models`, { headers: authHeaders(key), ...(signal ? { signal } : {}) });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(openaiUnreachableHint(base), { cause: e });
  }
  if (res.status === 401 || res.status === 403) throw new Error(`${base} refused the API key (${res.status}). Check it in the Copilot settings.`);
  if (!res.ok) throw new Error(`${base}/models answered ${res.status}: is this the server's OpenAI-compatible base URL (it usually ends in /v1)?`);
  const body = (await res.json()) as { data?: { id?: string; max_model_len?: number; context_length?: number; context_window?: number; meta?: { n_ctx?: number; n_ctx_train?: number } }[] };
  if (!Array.isArray(body.data)) throw new Error(`${base}/models did not list models as an OpenAI-compatible server does.`);
  return body.data
    .filter((m): m is typeof m & { id: string } => typeof m.id === "string")
    .map((m) => {
      const ctx = [m.max_model_len, m.context_length, m.context_window, m.meta?.n_ctx].find((v) => typeof v === "number" && v > 0);
      return { id: m.id.replace(/^models\//, ""), context: ctx ?? null };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The context the server reports for `model`, or null (never throws). */
export async function openaiWindow(url: string, key: string | undefined, model: string, signal?: AbortSignal): Promise<number | null> {
  try {
    return (await listOpenAIModels(url, key, signal)).find((m) => m.id === model)?.context ?? null;
  } catch {
    return null;
  }
}

/** Why the page cannot reach the server, as a sentence. */
export function openaiUnreachableHint(url: string): string {
  const base = openaiBase(url);
  return isMachineUrl(base)
    ? `Could not reach ${base}. Is the server running, and does it allow this page's origin (CORS)? vLLM: --allowed-origins; llama.cpp: it allows any origin by default.`
    : `Could not reach ${base} from this browser. Check the address, the connection, and that the provider accepts requests from a web page (CORS).`;
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

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c && typeof c === "object" && (c as Block).type === "text" ? String((c as Block).text ?? "") : "")).join("\n") : "";

/**
 * A Messages API request as a chat completion: the system message first, a
 * reply's tool calls as function calls, each tool result as a tool message
 * (an error says so in its text: the dialect has no error flag), the reply
 * capped at the room the chat left (`max_completion_tokens` on OpenAI's own
 * API, which no longer takes max_tokens for its newer models).
 */
export function toChatCompletion(req: MessagesRequest, base: string, usage = true): Record<string, unknown> {
  const messages: ChatMessage[] = [];
  const system = typeof req.system === "string" ? req.system : (req.system ?? []).map((b) => b.text ?? "").join("\n\n");
  if (system) messages.push({ role: "system", content: system });
  for (const m of req.messages) {
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n");
      const calls = m.content.filter((b) => b.type === "tool_use");
      messages.push({
        role: "assistant",
        content: text || (calls.length ? null : ""),
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: String(c.id), type: "function" as const, function: { name: String(c.name), arguments: JSON.stringify(c.input ?? {}) } })) } : {}),
      });
      continue;
    }
    for (const b of m.content) {
      if (b.type !== "tool_result") continue;
      const text = textOf(b.content);
      messages.push({ role: "tool", tool_call_id: String(b.tool_use_id), content: b.is_error && !/^error\b/i.test(text) ? `Error: ${text}` : text });
    }
    const text = m.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n");
    if (text) messages.push({ role: "user", content: text });
  }
  const openai = /^https:\/\/api\.openai\.com\//.test(`${openaiBase(base)}/`);
  return {
    model: req.model,
    messages,
    stream: true,
    ...(usage ? { stream_options: { include_usage: true } } : {}),
    ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } })) } : {}),
    ...(req.max_tokens ? (openai ? { max_completion_tokens: req.max_tokens } : { max_tokens: req.max_tokens }) : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
}

// ── the answer ──────────────────────────────────────────────────────────────

interface Chunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string } | string;
}

const event = (type: string, data: object): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/**
 * A chat completion's stream (`data: {…}` lines, then `data: [DONE]`) as the
 * Messages API's events: thinking (a server's reasoning_content) and text as
 * they stream; the tool calls, whose names and arguments come in pieces by
 * index, each as one tool_use block once the reply is done; the stop reason;
 * the prompt's and the reply's token counts when the server gives them.
 */
export function completionEvents(model: string): { readonly feed: (line: string) => string; readonly end: () => string } {
  let index = -1;
  let open: "text" | "thinking" | null = null;
  let started = false;
  let finished = false;
  let finish: string | null = null;
  let usage: { input: number | null; output: number } = { input: null, output: 0 };
  const calls = new Map<number, { id: string; name: string; args: string }>();
  const start = (): string => {
    if (started) return "";
    started = true;
    return event("message_start", { message: { id: `msg_oai_${Date.now().toString(36)}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
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
  const done = (): string => {
    if (finished) return "";
    finished = true;
    let out = start() + close();
    for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      index++;
      out += event("content_block_start", { index, content_block: { type: "tool_use", id: c.id, name: c.name, input: {} } });
      out += event("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: c.args.trim() || "{}" } });
      out += event("content_block_stop", { index });
    }
    // Cut off by the limit, a call's input may be cut too: never "tool_use" then (the chat runs nothing).
    const stop = finish === "length" ? "max_tokens" : calls.size > 0 ? "tool_use" : "end_turn";
    out += event("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output, ...(usage.input !== null ? { input_tokens: usage.input } : {}) } });
    return out + event("message_stop", {});
  };
  const feed = (line: string): string => {
    const text = line.trim();
    if (!text.startsWith("data:") || finished) return "";
    const data = text.slice(5).trim();
    if (data === "[DONE]") return done();
    let chunk: Chunk;
    try {
      chunk = JSON.parse(data) as Chunk;
    } catch {
      return "";
    }
    let out = start();
    if (chunk.error !== undefined) {
      finished = true;
      const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message ?? JSON.stringify(chunk.error);
      return out + event("error", { error: { type: "api_error", message } });
    }
    if (chunk.usage) usage = { input: chunk.usage.prompt_tokens ?? usage.input, output: chunk.usage.completion_tokens ?? usage.output };
    for (const choice of chunk.choices ?? []) {
      const d = choice.delta;
      const thinking = d?.reasoning_content ?? d?.reasoning;
      if (thinking) out += block("thinking", thinking);
      if (d?.content) out += block("text", d.content);
      for (const t of d?.tool_calls ?? []) {
        const i = t.index ?? calls.size;
        const was = calls.get(i) ?? { id: "", name: "", args: "" };
        calls.set(i, { id: t.id || was.id || `call_${Date.now().toString(36)}_${i}`, name: was.name || t.function?.name || "", args: was.args + (t.function?.arguments ?? "") });
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    return out;
  };
  // A stream that ends without [DONE] (some servers): done once it closes, if a finish reason came; else an error.
  const end = (): string => (finished ? "" : finish !== null ? done() : start() + event("error", { error: { type: "api_error", message: "The server ended the reply without finishing it." } }));
  return { feed, end };
}

/**
 * The SDK's fetch for an OpenAI-compatible server at `base`: a Messages
 * request goes to <base>/chat/completions, with the key as a Bearer token
 * when there is one; its answer comes back as Messages events. A server that
 * refuses `stream_options` (the token counts) is asked again without it.
 */
export function openaiCompatFetch(base: string, key: string | undefined): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const root = openaiBase(base);
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/v1\/messages(\?|$)/.test(url) || typeof init?.body !== "string") throw new Error(`the OpenAI-compatible provider sends only chat requests (asked for ${url})`);
    const req = JSON.parse(init.body) as MessagesRequest;
    const send = (usage: boolean): Promise<Response> =>
      globalThis.fetch(`${root}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(key) },
        body: JSON.stringify(toChatCompletion(req, root, usage)),
        ...(init.signal ? { signal: init.signal } : {}),
      });
    let res = await send(true);
    if (res.status === 400) {
      const raw = await res.clone().text();
      if (/stream_options|include_usage/i.test(raw)) res = await send(false);
    }
    if (!res.ok) {
      const raw = await res.text();
      let message = raw;
      try {
        const body = JSON.parse(raw) as { error?: string | { message?: string } } | { error?: unknown }[];
        const first = Array.isArray(body) ? body[0] : body;
        const err = (first as { error?: string | { message?: string } } | undefined)?.error;
        message = typeof err === "string" ? err : err?.message ?? raw;
      } catch {
        // not JSON: the text as it is
      }
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message } }), { status: res.status, headers: { "content-type": "application/json" } });
    }
    if (!res.body) throw new Error("The server answered with no body to stream.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const sse = completionEvents(req.model);
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
