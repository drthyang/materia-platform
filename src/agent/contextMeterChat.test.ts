import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { AgentChat, MIN_REPLY, REPLY_RESERVE, SUMMARY_CARRIER, SUMMARY_REQUEST, type ChatCallbacks } from "@/agent/chat";
import { REPLY_CAP } from "@/agent/chatBudget";
import { contextLevel, contextPercent, type ContextReading } from "@/agent/contextMeter";
import type { AgentExecutor } from "@/agent/executor";
import { fakeApi, ndjson, sse, type OllamaSide } from "@/testSupport/fakeMessagesApi";

/**
 * The context meter and Summarize and continue, through the real chat loop
 * against a stand-in Messages API (scripted turns; no network, no key, no
 * model): the readings each reply gives, the words the chat says whenever the
 * history the model sees is shortened, and the summary that replaces it.
 */

interface Seen {
  readonly readings: ContextReading[];
  readonly notices: string[];
  readonly usage: { model: string | undefined }[];
  text: string;
}

function listen(): { seen: Seen; cb: ChatCallbacks } {
  const seen: Seen = { readings: [], notices: [], usage: [], text: "" };
  return {
    seen,
    cb: {
      onAssistantStart: () => undefined,
      onText: (d) => (seen.text += d),
      onThinking: () => undefined,
      onNotice: (t) => seen.notices.push(t),
      onUsage: (_u, model) => seen.usage.push({ model }),
      onContext: (r) => seen.readings.push(r),
    },
  };
}

const claude = (url: string) => ({ transport: "api-key" as const, apiKey: "sk-test", baseURL: url, model: "claude-opus-5-5", effort: "high" as const });
const ollama = (url: string) => ({ transport: "ollama" as const, serverUrl: url, model: "qwen3:32b", effort: "high" as const });
const qwen = (loaded: number | null = 32_768, max: number | null = 40_960): OllamaSide => ({ model: "qwen3:32b", loaded, max });

type Sent = { role: string; content: string | { type: string; text?: string }[] };
const sentMessages = (r: { body: Record<string, unknown> }): Sent[] => r.body.messages as Sent[];
const textOf = (m: Sent): string => (typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? `[${b.type}]`).join("\n"));

describe("the context meter's readings", () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });

  it("Claude: the API's own counts against the model's 1M window, with the reply cap as the reserve", async () => {
    const api = await fakeApi([sse([{ type: "text", text: "Fine." }], "end_turn", { usage: { input_tokens: 2_000, cache_creation_input_tokens: 3_000, cache_read_input_tokens: 600_000, output_tokens: 1 }, outputTokens: 900 })]);
    server = api.server;
    const { seen, cb } = listen();
    await new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor).send("How is it?", claude(api.url), cb, new AbortController().signal);
    expect(seen.readings).toEqual([{ model: "claude-opus-5-5", window: 1_000_000, prompt: 605_000, reply: 900, reserve: REPLY_CAP, source: "provider" }]);
    // (605k + 0.9k + 64k) / 1M
    expect(contextPercent(seen.readings[0]!)).toBe(67);
    expect(seen.usage).toEqual([{ model: "claude-opus-5-5" }]);
  });

  it("a local model: the app's estimate against the context the server runs it with, the server's count alongside", async () => {
    const api = await fakeApi([ndjson([{ type: "text", text: "Fine." }], "stop", 15_500)], undefined, qwen());
    server = api.server;
    const { seen, cb } = listen();
    await new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor).send("How is it?", ollama(api.url), cb, new AbortController().signal);
    expect(seen.readings).toHaveLength(1);
    const r = seen.readings[0]!;
    expect([r.model, r.window, r.source, r.serverCount]).toEqual(["qwen3:32b", 32_768, "app", 15_500]);
    // The estimate is the one the request was sized by: it errs high (three characters a token at first).
    expect(r.prompt).toBeGreaterThan(10_000);
    // The reserve is the app's, or what the prompt leaves of it: never past the window, never below the least room a reply gets.
    expect(r.reserve).toBe(Math.max(MIN_REPLY, Math.min(REPLY_RESERVE, 32_768 - r.prompt)));
    expect(r.prompt + r.reserve).toBeLessThanOrEqual(32_768);
    expect(r.reply).toBe(20);
    expect(contextPercent(r)).toBeLessThanOrEqual(100);
  });

  it("a local request that cannot fit shows red, over 100 %, before the refusal says so", async () => {
    // The model takes 8k at most: the instructions alone are about 15k.
    const api = await fakeApi([], undefined, qwen(null, 8_192));
    server = api.server;
    const { seen, cb } = listen();
    await expect(new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor).send("How is it?", ollama(api.url), cb, new AbortController().signal)).rejects.toThrow(/no longer fits/);
    expect(api.requests).toHaveLength(0);
    expect(seen.readings).toHaveLength(1);
    expect(seen.readings[0]!.window).toBe(8_192);
    expect(contextPercent(seen.readings[0]!)).toBeGreaterThan(100);
    expect(contextLevel(contextPercent(seen.readings[0]!))).toBe("red");
  });
});

describe("never a silent cut", () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });

  it("says when the API leaves older tool results out of what Claude sees, once per new clearing", async () => {
    const cleared = (n: number) => ({ applied_edits: [{ type: "clear_tool_uses_20250919", cleared_tool_uses: n, cleared_input_tokens: 30_000 * n }] });
    const api = await fakeApi([
      sse([{ type: "tool_use", id: "t1", name: "get_state", input: {} }], "tool_use", { contextManagement: cleared(4) }),
      sse([{ type: "tool_use", id: "t2", name: "get_state", input: { again: 1 } }], "tool_use", { contextManagement: cleared(4) }),
      sse([{ type: "text", text: "Done." }], "end_turn", { contextManagement: cleared(9) }),
    ]);
    server = api.server;
    const { seen, cb } = listen();
    await new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor).send("Go on.", claude(api.url), cb, new AbortController().signal);
    expect(seen.notices).toEqual([
      "To keep within the model's window, the API now leaves out 4 older tool results from what the model sees (method reads are kept). They stay here in the chat.",
      "To keep within the model's window, the API now leaves out 9 older tool results from what the model sees (method reads are kept). They stay here in the chat.",
    ]);
  });

  it("says nothing when nothing was left out", async () => {
    const api = await fakeApi([sse([{ type: "text", text: "Done." }], "end_turn", { contextManagement: { applied_edits: [] } })]);
    server = api.server;
    const { seen, cb } = listen();
    await new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor).send("Go on.", claude(api.url), cb, new AbortController().signal);
    expect(seen.notices).toEqual([]);
  });

  it("says so when a reply stops because the model's window filled up", async () => {
    const api = await fakeApi([sse([{ type: "text", text: "The fit" }], "model_context_window_exceeded")]);
    server = api.server;
    const { seen, cb } = listen();
    await new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor).send("Go on.", claude(api.url), cb, new AbortController().signal);
    expect(seen.notices).toContain("The model's window filled up, so this reply was cut off. Start fresh, or summarize the conversation and continue.");
  });

  it("a local model's history shortened to fit is said in the chat (pruning is covered in chat.test.ts)", async () => {
    // Twelve large results on a 32k window: the oldest go as digests, and the chat says so.
    const turns = [
      ...Array.from({ length: 12 }, (_, i) => ndjson([{ type: "tool_use", id: `c${i}`, name: "reflection_equivalents", input: { h: i, k: 0, l: 0 } }])),
      ndjson([{ type: "text", text: "Compared." }]),
    ];
    const api = await fakeApi(turns, undefined, qwen());
    server = api.server;
    const { seen, cb } = listen();
    const runner = { run: async (_: string, input: { h: number }) => ({ isError: false, text: JSON.stringify({ ref: `#${input.h}`, h: input.h, pad: "x".repeat(7000) }) }) };
    await new AgentChat(runner as unknown as AgentExecutor).send("Compare them.", ollama(api.url), cb, new AbortController().signal);
    expect(seen.notices.length).toBeGreaterThan(0);
    expect(seen.notices[0]).toMatch(/^To fit the model's window, the app now sends \d+ older tool results? as short digests, and shortens the replies around them\. The full results stay here, and the model can reopen one by its ref\.$/);
    // Every reading stays within the window: the shortened copy is what is measured.
    for (const r of seen.readings) {
      expect(r.prompt + r.reserve).toBeLessThanOrEqual(r.window);
      expect(contextPercent(r)).toBeLessThanOrEqual(100);
    }
  });
});

describe("Summarize and continue", () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });
  const SUMMARY = "Goal: refine the powder pattern. Done: scale and background refined (wR 8.1%, ref #3). Next: free the lattice.";

  it("asks for a summary after the history, on the same instructions and tools, then the model sees the summary in its place", async () => {
    const api = await fakeApi([
      sse([{ type: "text", text: "Let me look." }, { type: "tool_use", id: "t1", name: "get_state", input: {} }], "tool_use"),
      sse([{ type: "text", text: "The fit is good." }], "end_turn", { usage: { input_tokens: 500, cache_read_input_tokens: 700_000, output_tokens: 1 } }),
      sse([{ type: "text", text: SUMMARY }], "end_turn", { usage: { input_tokens: 400, cache_read_input_tokens: 701_000, output_tokens: 1 }, outputTokens: 300 }),
      sse([{ type: "text", text: "Freeing the lattice next." }], "end_turn"),
    ]);
    server = api.server;
    const ran: string[] = [];
    const chat = new AgentChat({ run: async (name: string) => (ran.push(name), { isError: false, text: "{\"technique\":\"powder\"}" }) } as unknown as AgentExecutor);
    await chat.send("How is the fit?", claude(api.url), listen().cb, new AbortController().signal);

    const { seen, cb } = listen();
    expect(await chat.summarize(claude(api.url), cb, new AbortController().signal)).toBe(true);
    const ask = api.requests[2]!;
    // The history as it stood, then the ask: the instructions and tools unchanged, so Claude's cached prompt holds.
    expect(sentMessages(ask).slice(0, -1)).toEqual(sentMessages(api.requests[1]!).concat([{ role: "assistant", content: [{ type: "text", text: "The fit is good." }] } as Sent]));
    expect(textOf(sentMessages(ask).at(-1)!)).toBe(SUMMARY_REQUEST);
    expect(ask.body.system).toEqual(api.requests[1]!.body.system);
    expect(ask.body.tools).toEqual(api.requests[1]!.body.tools);
    expect(ask.body.tool_choice).toBeUndefined();
    expect(seen.text).toBe(SUMMARY);

    // The model now sees the app's note and its own summary, in place of the conversation.
    expect(chat.history()).toEqual([{ role: "user", content: SUMMARY_CARRIER }, { role: "assistant", content: [{ type: "text", text: SUMMARY }] }]);
    // Never silent: the chat says the history was replaced.
    expect(seen.notices).toEqual(["Summarized: from here the model works from the summary above, in place of the earlier conversation, which stays here for you to read."]);
    // The meter drops, as an estimate until the next reply counts it.
    expect(seen.readings).toHaveLength(1);
    expect(seen.readings[0]!.estimated).toBe(true);
    expect(seen.readings[0]!.prompt).toBeLessThan(701_400);

    await chat.send("Go on.", claude(api.url), listen().cb, new AbortController().signal);
    expect(sentMessages(api.requests[3]!).map(textOf)).toEqual([SUMMARY_CARRIER, SUMMARY, "Go on."]);
    expect(ran).toEqual(["get_state"]);
  });

  it("the prompt is short and factual, and says where the page and the earlier results are", () => {
    expect(SUMMARY_REQUEST.startsWith("(From the app, not the user.)")).toBe(true);
    expect(SUMMARY_REQUEST).toMatch(/without calling tools/);
    expect(SUMMARY_REQUEST.length).toBeLessThan(500);
    expect(SUMMARY_CARRIER).toMatch(/get_state reads it, and read_ref opens an earlier result by its ref/);
    expect(SUMMARY_CARRIER.length).toBeLessThan(400);
  });

  it("runs nothing the model asks for, and leaves the conversation as it was when it writes no summary", async () => {
    const api = await fakeApi([
      sse([{ type: "text", text: "Fine." }], "end_turn"),
      sse([{ type: "tool_use", id: "t9", name: "refine", input: {} }], "tool_use"),
    ]);
    server = api.server;
    const ran: string[] = [];
    const chat = new AgentChat({ run: async (name: string) => (ran.push(name), { isError: false, text: "{}" }) } as unknown as AgentExecutor);
    await chat.send("How is it?", claude(api.url), listen().cb, new AbortController().signal);
    const before = structuredClone(chat.history());
    const { seen, cb } = listen();
    expect(await chat.summarize(claude(api.url), cb, new AbortController().signal)).toBe(false);
    expect(ran).toEqual([]);
    expect(chat.history()).toEqual(before);
    expect(seen.notices).toEqual(["The model wrote no summary. The conversation is unchanged. Try again, or start fresh."]);
    expect(seen.readings).toEqual([]);
  });

  it("leaves the conversation as it was when the request fails", async () => {
    const api = await fakeApi([sse([{ type: "text", text: "Fine." }], "end_turn"), { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "bad" } } }]);
    server = api.server;
    const chat = new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor);
    await chat.send("How is it?", claude(api.url), listen().cb, new AbortController().signal);
    const before = structuredClone(chat.history());
    await expect(chat.summarize(claude(api.url), listen().cb, new AbortController().signal)).rejects.toThrow();
    expect(chat.history()).toEqual(before);
  });

  it("after a turn that ended on tool results (a question to the user), the ask joins them: the history still alternates", async () => {
    const api = await fakeApi([
      sse([{ type: "tool_use", id: "q1", name: "ask_user", input: { question: "Which phase?", options: [{ label: "A", message: "A" }, { label: "B", message: "B" }] } }], "tool_use"),
      sse([{ type: "text", text: SUMMARY }], "end_turn"),
    ]);
    server = api.server;
    const chat = new AgentChat({ run: async () => ({ isError: false, text: "{\"asked\":true}" }) } as unknown as AgentExecutor);
    await chat.send("Refine it.", claude(api.url), listen().cb, new AbortController().signal);
    expect(chat.history().at(-1)!.role).toBe("user");
    expect(await chat.summarize(claude(api.url), listen().cb, new AbortController().signal)).toBe(true);
    const roles = sentMessages(api.requests[1]!).map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    const last = sentMessages(api.requests[1]!).at(-1)!.content as { type: string; text?: string }[];
    expect(last.map((b) => b.type)).toEqual(["tool_result", "text"]);
    expect(last[1]!.text).toBe(SUMMARY_REQUEST);
  });

  it("works the same with a local model, measured by the app", async () => {
    const api = await fakeApi([ndjson([{ type: "text", text: "Fine." }], "stop", 15_000), ndjson([{ type: "text", text: SUMMARY }], "stop", 15_200)], undefined, qwen());
    server = api.server;
    const chat = new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor);
    await chat.send("How is it?", ollama(api.url), listen().cb, new AbortController().signal);
    const { seen, cb } = listen();
    expect(await chat.summarize(ollama(api.url), cb, new AbortController().signal)).toBe(true);
    expect(chat.history()).toEqual([{ role: "user", content: SUMMARY_CARRIER }, { role: "assistant", content: [{ type: "text", text: SUMMARY }] }]);
    expect(seen.readings[0]!.source).toBe("app");
    expect(seen.readings[0]!.estimated).toBe(true);
  });

  it("with nothing said yet, there is nothing to summarize", async () => {
    const { seen, cb } = listen();
    const chat = new AgentChat({ run: async () => ({ isError: false, text: "{}" }) } as unknown as AgentExecutor);
    expect(await chat.summarize(claude("http://127.0.0.1:9"), cb, new AbortController().signal)).toBe(false);
    expect(seen.notices).toEqual(["Nothing to summarize yet."]);
    expect(chat.history()).toEqual([]);
  });
});
