import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { openaiCompatFetch } from "@/agent/openaiCompat";
import { ollamaNativeFetch } from "@/agent/ollamaNative";

/**
 * Real servers flush a stream a piece at a time: an event per write, a line
 * split across two. The adapters must read on until a piece yields an event —
 * a stream whose pull enqueues nothing is never pulled again, and the reply
 * would hang. These servers write each piece apart, with a pause between.
 */
async function trickle(pieces: string[], type: string): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    req.on("data", () => undefined);
    req.on("end", async () => {
      res.writeHead(200, { "content-type": type });
      for (const p of pieces) {
        res.write(p);
        await new Promise((r) => setTimeout(r, 5));
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, server };
}

const body = JSON.stringify({ model: "m", max_tokens: 4000, messages: [{ role: "user", content: "hi" }] });

/** The whole adapted stream as text, or a timeout. */
async function readAll(res: Response): Promise<string> {
  const text = res.text();
  const timeout = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("the stream hung")), 3000));
  return Promise.race([text, timeout]);
}

describe("the stream adapters, fed a piece at a time", () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });

  it("OpenAI-compatible: a tool call whose pieces yield no event until the end", async () => {
    const ev = (o: object): string => `data: ${JSON.stringify(o)}\n\n`;
    const callStart = ev({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "get_state", arguments: "" } }] }, finish_reason: null }] });
    const pieces = [
      callStart,
      ev({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"parameters\":" } }] }, finish_reason: null }] }),
      ev({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "[\"*\"]}" } }] }, finish_reason: null }] }),
      ev({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
      // A line split across two writes.
      'data: {"choices":[],"usage":{"prompt_',
      'tokens":1200,"completion_tokens":30}}\n\n',
      "data: [DONE]\n\n",
    ];
    const api = await trickle(pieces, "text/event-stream");
    server = api.server;
    const res = await openaiCompatFetch(`${api.url}/v1`, undefined)(`${api.url}/v1/v1/messages`, { method: "POST", body });
    const out = await readAll(res);
    expect(out).toContain('"name":"get_state"');
    expect(out).toContain('"partial_json":"{\\"parameters\\":[\\"*\\"]}"');
    expect(out).toContain('"stop_reason":"tool_use"');
    expect(out).toContain('"input_tokens":1200');
    expect(out.trim().endsWith('data: {"type":"message_stop"}')).toBe(true);
  });

  it("OpenAI-compatible: a call cut off by the limit is a max_tokens stop, never a tool_use", async () => {
    const ev = (o: object): string => `data: ${JSON.stringify(o)}\n\n`;
    const api = await trickle([
      ev({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "set_free", arguments: "{\"free\":[\"a\",\"b\",\"c" } }] }, finish_reason: null }] }),
      ev({ choices: [{ index: 0, delta: {}, finish_reason: "length" }] }),
      "data: [DONE]\n\n",
    ], "text/event-stream");
    server = api.server;
    const out = await readAll(await openaiCompatFetch(`${api.url}/v1`, undefined)(`${api.url}/v1/v1/messages`, { method: "POST", body }));
    expect(out).toContain('"stop_reason":"max_tokens"');
  });

  it("Ollama: lines split across writes", async () => {
    const lines = [
      JSON.stringify({ message: { content: "Look" } }),
      JSON.stringify({ message: { content: "ing." } }),
      JSON.stringify({ message: { content: "", tool_calls: [{ function: { name: "get_state", arguments: {} } }] } }),
      JSON.stringify({ done: true, done_reason: "stop", prompt_eval_count: 900, eval_count: 9 }),
    ].join("\n") + "\n";
    // Cut into pieces of 7 characters: hardly one holds a whole line.
    const pieces = lines.match(/[\s\S]{1,7}/g)!;
    const api = await trickle(pieces, "application/x-ndjson");
    server = api.server;
    const out = await readAll(await ollamaNativeFetch(() => ({ numCtx: 32768, numPredict: 4000 }))(`${api.url}/v1/messages`, { method: "POST", body }));
    expect(out).toContain('"text":"Look"');
    expect(out).toContain('"name":"get_state"');
    expect(out).toContain('"stop_reason":"tool_use"');
    expect(out.trim().endsWith('data: {"type":"message_stop"}')).toBe(true);
  });
});
