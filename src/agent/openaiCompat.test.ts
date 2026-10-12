import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { AgentChat, describeChatError } from "@/agent/chat";
import type { AgentExecutor } from "@/agent/executor";
import { LIVE_TOOLS } from "@/agent/tools";
import { completionEvents, listOpenAIModels, presetForUrl, toChatCompletion } from "@/agent/openaiCompat";

/** One streamed chat completion: `data:` lines, then [DONE]. */
function stream(chunks: object[], done = true): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "");
}
const text = (t: string) => ({ choices: [{ index: 0, delta: { content: t }, finish_reason: null }] });
const finish = (reason: string) => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const usage = (prompt: number) => ({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: 12 } });

interface Seen { path: string; headers: Record<string, unknown>; body: Record<string, unknown> | null }

/** An OpenAI-compatible server: its model list, and chat completions in turn. */
async function fakeServer(models: object[], turns: (string | { status: number; json: unknown })[]): Promise<{ url: string; server: Server; seen: Seen[] }> {
  const seen: Seen[] = [];
  let served = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      seen.push({ path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) as Record<string, unknown> : null });
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: models }));
        return;
      }
      const turn = turns[served++];
      if (turn === undefined) {
        res.writeHead(500);
        res.end("no more turns");
        return;
      }
      if (typeof turn !== "string") {
        res.writeHead(turn.status, { "content-type": "application/json" });
        res.end(JSON.stringify(turn.json));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(turn);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1`, server, seen };
}

const quiet = (notices: string[] = []) => ({ onAssistantStart: () => undefined, onText: () => undefined, onThinking: () => undefined, onNotice: (t: string) => notices.push(t), onUsage: () => undefined });
const chats = (seen: Seen[]) => seen.filter((s) => s.path === "/v1/chat/completions");

describe("the OpenAI-compatible provider", () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });

  it("lists the server's models with the context each takes when the server says, and sends the key only when there is one", async () => {
    const api = await fakeServer([{ id: "qwen3-32b", max_model_len: 40960 }, { id: "models/gemini-2.5-pro" }, { id: "llama", meta: { n_ctx: 8192 } }], []);
    server = api.server;
    expect(await listOpenAIModels(api.url, undefined)).toEqual([
      { id: "gemini-2.5-pro", context: null },
      { id: "llama", context: 8192 },
      { id: "qwen3-32b", context: 40960 },
    ]);
    expect(api.seen[0]!.headers.authorization).toBeUndefined();
    await listOpenAIModels(api.url + "/", "sk-local");
    expect(api.seen[1]!.headers.authorization).toBe("Bearer sk-local");
    expect(presetForUrl("https://api.openai.com/v1/")?.id).toBe("openai");
  });

  it("runs the tool loop through chat completions: calls streamed in pieces, results as tool messages, the reply capped to the window", async () => {
    const api = await fakeServer([{ id: "qwen3-32b", max_model_len: 40960 }], [
      stream([
        { choices: [{ index: 0, delta: { reasoning_content: "Read it first." }, finish_reason: null }] },
        text("Looking."),
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "get_state", arguments: "" } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"parameters\":" } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "[\"*\"]}" } }] }, finish_reason: null }] },
        finish("tool_calls"),
        usage(21000),
      ]),
      stream([text("The fit is fine."), finish("stop"), usage(21400)]),
    ]);
    server = api.server;
    const ran: { name: string; input: unknown }[] = [];
    const runner = { run: async (name: string, input: unknown) => (ran.push({ name, input }), { isError: false, text: "{\"technique\":\"powder\"}" }) } as unknown as AgentExecutor;
    let thought = "";
    const chat = new AgentChat(runner);
    await chat.send("How is it?", { transport: "openai-compatible", serverUrl: api.url, apiKey: "sk-test", model: "qwen3-32b", effort: "high" }, { ...quiet(), onThinking: (d) => (thought += d) }, new AbortController().signal);

    expect(ran).toEqual([{ name: "get_state", input: { parameters: ["*"] } }]);
    expect(thought).toBe("Read it first.");
    expect(chat.history().map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const [first, second] = chats(api.seen);
    expect(first!.headers.authorization).toBe("Bearer sk-test");
    for (const h of ["x-api-key", "anthropic-version", "anthropic-beta"]) expect(first!.headers[h]).toBeUndefined();
    expect(first!.body).toMatchObject({ model: "qwen3-32b", stream: true, stream_options: { include_usage: true } });
    // Sized to the 40k the server reported: the reply capped at the room left.
    const max = first!.body!.max_tokens as number;
    expect(max).toBeGreaterThanOrEqual(2048);
    expect(max).toBeLessThan(40960 - 5000);
    const tools = first!.body!.tools as { type: string; function: { name: string } }[];
    expect(tools.every((t) => t.type === "function")).toBe(true);
    expect(tools.map((t) => t.function.name)).toEqual(LIVE_TOOLS.map((t) => t.name));
    const messages = second!.body!.messages as Record<string, unknown>[];
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "How is it?" },
      { role: "assistant", content: "Looking.", tool_calls: [{ id: "call_a", type: "function", function: { name: "get_state", arguments: "{\"parameters\":[\"*\"]}" } }] },
      { role: "tool", tool_call_id: "call_a", content: "{\"technique\":\"powder\"}" },
    ]);
  });

  it("offers the stage's tools within a small window, and every tool within a large one", async () => {
    const runner = {
      run: async () => ({ isError: false, text: "{}" }),
      situation: () => ({ page: "powder", stage: "base", stagesDone: [], magnetic: false, fingerprint: "x", summary: "" }),
    } as unknown as AgentExecutor;
    for (const [context, all] of [[32768, false], [200000, true]] as const) {
      const api = await fakeServer([{ id: "m" }], [stream([text("Fine."), finish("stop")])]);
      await new AgentChat(runner).send("Refine.", { transport: "openai-compatible", serverUrl: api.url, model: "m", effort: "high", context }, quiet(), new AbortController().signal);
      await new Promise<void>((r) => api.server.close(() => r()));
      const offered = (chats(api.seen)[0]!.body!.tools as unknown[]).length;
      if (all) expect(offered).toBe(LIVE_TOOLS.length);
      else expect(offered).toBeLessThan(LIVE_TOOLS.length / 2);
    }
  });

  it("refuses, sending nothing, when the prompt cannot fit the context set for a server that does not say its own", async () => {
    const api = await fakeServer([{ id: "small" }], [stream([text("never"), finish("stop")])]);
    server = api.server;
    const config = { transport: "openai-compatible" as const, serverUrl: api.url, model: "small", effort: "high" as const, context: 8192 };
    const err = await new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor).send("hi", config, quiet(), new AbortController().signal).then(() => null, (e: unknown) => e);
    expect(chats(api.seen)).toHaveLength(0);
    expect(describeChatError(err, config)).toMatch(/^This conversation no longer fits the 8k-token window used for small \(the server's own, or the context set in the Agent settings when the server does not say\), even with the old tool results shortened: it needs about \d+k .*Nothing was sent, so the model was not handed a cut prompt\./);
  });

  it("explains a refused key and a missing model, and asks again without stream_options when a server refuses them", async () => {
    const api = await fakeServer([], [
      { status: 401, json: { error: { message: "Incorrect API key provided" } } },
      { status: 400, json: { error: { message: "Unknown parameter: stream_options" } } },
      stream([text("Fine."), finish("stop")]),
      { status: 404, json: { error: { message: "The model `nope` does not exist" } } },
    ]);
    server = api.server;
    const base = { transport: "openai-compatible" as const, serverUrl: api.url, effort: "high" as const, context: 32768 };
    const runner = { run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor;
    const keyErr = await new AgentChat(runner).send("hi", { ...base, model: "m", apiKey: "bad" }, quiet(), new AbortController().signal).then(() => null, (e: unknown) => e);
    expect(describeChatError(keyErr, { ...base, model: "m" })).toMatch(/refused the API key \(401\): Incorrect API key provided/);
    const notices: string[] = [];
    await new AgentChat(runner).send("hi", { ...base, model: "m" }, quiet(notices), new AbortController().signal);
    expect(notices).toEqual([]);
    expect(chats(api.seen)[2]!.body!.stream_options).toBeUndefined();
    const missing = await new AgentChat(runner).send("hi", { ...base, model: "nope" }, quiet(), new AbortController().signal).then(() => null, (e: unknown) => e);
    expect(describeChatError(missing, { ...base, model: "nope" })).toMatch(/has no model "nope"/);
  });
});

describe("a chat completion as Messages", () => {
  it("caps the reply as OpenAI's own API wants it, and sends an error result as text", () => {
    const req = { model: "gpt-x", max_tokens: 9000, messages: [{ role: "user" as const, content: [{ type: "tool_result", tool_use_id: "c", content: "no analysis", is_error: true }] }] };
    expect(toChatCompletion(req, "https://api.openai.com/v1")).toMatchObject({ max_completion_tokens: 9000, messages: [{ role: "tool", tool_call_id: "c", content: "Error: no analysis" }] });
    expect(toChatCompletion(req, "http://localhost:8000/v1")).toMatchObject({ max_tokens: 9000 });
  });

  it("says when the reply ran out of room, failed, or ended unfinished", () => {
    const types = (sse: string): string[] => [...sse.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]!);
    const cut = completionEvents("m");
    const out = [`data: ${JSON.stringify(text("Half"))}`, `data: ${JSON.stringify(finish("length"))}`, "data: [DONE]"].map(cut.feed).join("");
    expect(out).toContain('"stop_reason":"max_tokens"');
    expect(types(out)).toEqual(["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
    // No [DONE], but a finish reason: done when the stream closes.
    const quietEnd = completionEvents("m");
    quietEnd.feed(`data: ${JSON.stringify(finish("stop"))}`);
    expect(quietEnd.end()).toContain('"stop_reason":"end_turn"');
    const failed = completionEvents("m");
    expect(failed.feed(`data: ${JSON.stringify({ error: { message: "overloaded" } })}`)).toMatch(/event: error\ndata: \{"type":"error","error":\{"type":"api_error","message":"overloaded"\}\}/);
    const unfinished = completionEvents("m");
    unfinished.feed(`data: ${JSON.stringify(text("Half"))}`);
    expect(unfinished.end()).toMatch(/ended the reply without finishing it/);
  });
});
