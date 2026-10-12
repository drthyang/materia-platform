import { describe, it, expect, afterEach } from "vitest";
import { messagesEvents, toOllamaChat } from "@/agent/ollamaNative";
import { createServer, type Server } from "node:http";
import { listOllamaModels, ollamaBase, unreachableHint } from "@/agent/ollama";
import { plainFetch } from "@/agent/localServer";

/**
 * The Ollama helpers against a stand-in server that answers /api/tags and
 * /api/show as Ollama 0.40 does (the shapes are copied from a real server).
 */

const SHOW: Record<string, unknown> = {
  "qwen3:32b": { capabilities: ["completion", "tools", "thinking"], model_info: { "general.architecture": "qwen3", "qwen3.context_length": 40960 } },
  "gemma4:26b": { capabilities: ["completion", "vision", "tools", "thinking"], model_info: { "gemma4.context_length": 262144 } },
  "llava:7b": { capabilities: ["completion", "vision"], model_info: { "llama.context_length": 4096 } },
};

async function fakeOllama(handler?: (path: string, body: string, headers: Record<string, unknown>) => { status: number; body: unknown }): Promise<{ url: string; server: Server; seen: { path: string; headers: Record<string, unknown> }[] }> {
  const seen: { path: string; headers: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ path: req.url ?? "", headers: req.headers });
      const out = handler
        ? handler(req.url ?? "", body, req.headers)
        : req.url === "/api/tags"
          ? { status: 200, body: { models: Object.keys(SHOW).map((name) => ({ name, details: { parameter_size: name === "qwen3:32b" ? "32.8B" : "7B" } })) } }
          : req.url === "/api/show"
            ? { status: 200, body: SHOW[(JSON.parse(body) as { model: string }).model] }
            : { status: 404, body: { error: "not found" } };
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, server, seen };
}

describe("Ollama helpers", () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });

  it("lists the server's models, those that can call tools first, with their context", async () => {
    const api = await fakeOllama();
    server = api.server;
    const models = await listOllamaModels(api.url + "/");
    expect(models.map((m) => [m.name, m.tools, m.context])).toEqual([
      ["gemma4:26b", true, 262144],
      ["qwen3:32b", true, 40960],
      ["llava:7b", false, 4096],
    ]);
    expect(models.find((m) => m.name === "qwen3:32b")!.parameterSize).toBe("32.8B");
    // The trailing slash in the address is not doubled.
    expect(api.seen.every((s) => !s.path.startsWith("//"))).toBe(true);
  });

  it("rejects a server that does not answer as Ollama", async () => {
    const api = await fakeOllama(() => ({ status: 200, body: { hello: "world" } }));
    server = api.server;
    await expect(listOllamaModels(api.url)).rejects.toThrow(/did not answer as an Ollama server/);
  });

  it("sends only plain headers, so Ollama's CORS preflight admits the request", async () => {
    const api = await fakeOllama(() => ({ status: 200, body: {} }));
    server = api.server;
    await plainFetch(`${api.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-api-key": "ollama", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", "x-stainless-lang": "js" },
      body: "{}",
    });
    const h = api.seen[0]!.headers;
    expect(h["content-type"]).toBe("application/json");
    expect(h.accept).toBe("application/json");
    for (const gone of ["x-api-key", "anthropic-version", "anthropic-dangerous-direct-browser-access", "x-stainless-lang"]) expect(h[gone]).toBeUndefined();
  });

  it("normalizes the address and explains an unreachable server by where the page runs", () => {
    expect(ollamaBase("  http://box:11434///  ")).toBe("http://box:11434");
    expect(ollamaBase("")).toBe("http://localhost:11434");
    expect(unreachableHint("", "http://localhost:5173")).not.toMatch(/OLLAMA_ORIGINS/);
    expect(unreachableHint("", "http://127.0.0.1:4173")).not.toMatch(/OLLAMA_ORIGINS/);
    expect(unreachableHint("", "https://drthyang.github.io")).toMatch(/OLLAMA_ORIGINS=https:\/\/drthyang\.github\.io/);
  });
});

describe("Ollama's native chat as the Messages API", () => {
  const types = (sse: string): string[] => [...sse.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]!);

  it("turns the stream into Messages events: thinking, text, each call, the stop reason and the counts", () => {
    const s = messagesEvents("qwen3:32b");
    const out = [
      { message: { thinking: "Look." } },
      { message: { thinking: " First." } },
      { message: { content: "Reading." } },
      { message: { content: "", tool_calls: [{ function: { name: "get_state", arguments: { parameters: ["*"] } } }] } },
      { done: true, done_reason: "stop", prompt_eval_count: 21000, eval_count: 40 },
    ].map((c) => s.feed(JSON.stringify(c))).join("");
    expect(types(out)).toEqual([
      "message_start",
      "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_stop",
      "message_delta", "message_stop",
    ]);
    expect(out).toContain('"partial_json":"{\\"parameters\\":[\\"*\\"]}"');
    expect(out).toContain('"delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":40,"input_tokens":21000}');
    expect(s.end()).toBe("");
  });

  it("says when the reply ran out of room, failed, or stopped unfinished", () => {
    const cut = messagesEvents("m");
    expect(cut.feed(JSON.stringify({ message: { content: "Half" } })) + cut.feed(JSON.stringify({ done: true, done_reason: "length", eval_count: 9 }))).toContain('"stop_reason":"max_tokens"');
    const failed = messagesEvents("m");
    expect(failed.feed(JSON.stringify({ error: "model runner has unexpectedly stopped" }))).toMatch(/event: error\ndata: \{"type":"error","error":\{"type":"api_error","message":"model runner has unexpectedly stopped"\}\}/);
    const unfinished = messagesEvents("m");
    unfinished.feed(JSON.stringify({ message: { content: "Half" } }));
    expect(unfinished.end()).toMatch(/Ollama ended the reply without finishing it\./);
  });

  it("sends the conversation as Ollama's messages: the system first, each result as its tool's message", () => {
    const body = toOllamaChat({
      model: "qwen3:32b",
      system: "You are the agent.",
      max_tokens: 64000,
      tools: [{ name: "get_state", description: "The analysis.", input_schema: { type: "object", properties: {} } }],
      messages: [
        { role: "user", content: "Refine it." },
        { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "c1", name: "get_state", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "no analysis", is_error: true }] },
      ],
    }, { numCtx: 32768, numPredict: 9000 });
    expect(body).toEqual({
      model: "qwen3:32b",
      stream: true,
      messages: [
        { role: "system", content: "You are the agent." },
        { role: "user", content: "Refine it." },
        { role: "assistant", content: "Looking.", tool_calls: [{ function: { name: "get_state", arguments: {} } }] },
        { role: "tool", content: "Error: no analysis", tool_name: "get_state" },
      ],
      tools: [{ type: "function", function: { name: "get_state", description: "The analysis.", parameters: { type: "object", properties: {} } } }],
      options: { num_ctx: 32768, num_predict: 9000 },
    });
  });
});
