import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { AgentChat } from "@/agent/chat";
import type { AgentExecutor, ActivityEntry } from "@/agent/executor";
import { liveTool } from "@/agent/tools";
import { executor, fakeHost } from "@/testSupport/agentHeadless";
import { mn3gaSession, pdfPage, powderPage, scPage } from "@/agent/evals/pages";
import { turnChoices } from "@/agent/ui/AgentDrawer";
import type { TranscriptItem } from "@/agent/useAgent";

/**
 * ask_user: the Agent's own question, as buttons under its turn. Its input is
 * checked like any tool's; it ends the turn the way the chat ends one already
 * (every call of the reply answered in one message, then no further request);
 * a click sends exactly an option's message, which is the Agent's words, not
 * the user's numbers; and a change it leads to still asks first.
 */

const spec = liveTool("ask_user")!;
const schema = z.object(spec.inputSchema).strict();
const two = [{ label: "Free the B values", message: "Free the B values and refine." }, { label: "Free the occupancies", message: "Free the Mn occupancy, tied, and refine." }];

describe("ask_user's input", () => {
  const ok = (input: unknown): boolean => schema.safeParse(input).success;
  const opts = (n: number): { label: string; message: string }[] => Array.from({ length: n }, (_, i) => ({ label: `Option ${i + 1}`, message: `Do thing ${i + 1}.` }));

  it("takes a question with 2 to 6 options, and an optional hint for the user's own words", () => {
    expect(ok({ question: "What next?", options: opts(2) })).toBe(true);
    expect(ok({ question: "What next?", options: opts(6), other: "e.g. free only the Mn positions" })).toBe(true);
  });

  it("refuses 1 or 7 options, a label twice (case and spaces aside), empty or long text, and keys it does not know", () => {
    expect(ok({ question: "What next?", options: opts(1) })).toBe(false);
    expect(ok({ question: "What next?", options: opts(7) })).toBe(false);
    expect(ok({ question: "What next?", options: [{ label: "Free B", message: "a" }, { label: " free  b ", message: "b" }] })).toBe(false);
    expect(ok({ question: "  ", options: opts(2) })).toBe(false);
    expect(ok({ question: "x".repeat(301), options: opts(2) })).toBe(false);
    expect(ok({ question: "What next?", options: [{ label: "", message: "a" }, { label: "b", message: "b" }] })).toBe(false);
    expect(ok({ question: "What next?", options: [{ label: "x".repeat(61), message: "a" }, { label: "b", message: "b" }] })).toBe(false);
    expect(ok({ question: "What next?", options: [{ label: "a", message: "x".repeat(301) }, { label: "b", message: "b" }] })).toBe(false);
    expect(ok({ question: "What next?", options: [{ label: "a", message: "a", recommended: true }, { label: "b", message: "b" }] })).toBe(false);
    expect(ok({ question: "What next?", options: opts(2), other: "x".repeat(121) })).toBe(false);
    expect(ok({ question: "What next?", options: opts(2), approve: true })).toBe(false);
  });

  it("is a tool that ends the turn, on every page, at once, offered to a local model everywhere", () => {
    expect(spec).toMatchObject({ effect: "read", endsTurn: true, pages: ["powder", "pdf", "singleCrystal"], offer: { core: true } });
  });
});

describe("ask_user in the executor", () => {
  it("puts the question and its options on the call's entry, each sending exactly its message, for the page as it stands", async () => {
    const { ex, seen, asked } = executor(fakeHost(powderPage(mn3gaSession())).host, true);
    const out = await ex.run("ask_user", { question: "  The fit is at {{wR}}. What next?  ", options: two, other: "e.g. free only the Mn positions" });
    expect(out.isError, out.text).toBe(false);
    expect(out.status).toBe("ok");
    expect(JSON.parse(out.text)).toMatchObject({ asked: true, options: 2 });
    const entry = seen.filter((e) => e.tool === "ask_user").at(-1)!;
    expect(entry.status).toBe("done");
    const set = entry.choices!;
    expect(set).toMatchObject({ kind: "question", tool: "ask_user", stamp: ex.stamp() });
    // The reference filled from the engine, the text trimmed.
    expect(set.title).toMatch(/^The fit is at \d+(\.\d+)? ?%?\. What next\?$/);
    expect(set.title).not.toContain("{{");
    expect(set.options).toEqual([
      { id: "1", label: "Free the B values", message: "Free the B values and refine." },
      { id: "2", label: "Free the occupancies", message: "Free the Mn occupancy, tied, and refine." },
    ]);
    // Nothing of the model's goes into the message box: the hint is a placeholder.
    expect(set.other).toEqual({ label: "Something else…", template: "", placeholder: "e.g. free only the Mn positions" });
    // A question changes nothing and asks for no approval.
    expect(asked).toEqual([]);
  });

  it("works on the PDF and single-crystal pages too", async () => {
    for (const page of [pdfPage(), scPage()]) {
      const { ex, seen } = executor(fakeHost(page).host, true);
      const out = await ex.run("ask_user", { question: "Which window?", options: [{ label: "1.5–6 Å", message: "Keep the 1.5–6 Å window." }, { label: "Whole range", message: "Fit the whole r range." }] });
      expect(out.status, out.text).toBe("ok");
      expect(seen.find((e) => e.tool === "ask_user")?.choices?.kind).toBe("question");
    }
  }, 60000);

  it("refuses a reference that names nothing the page has, and a bad input, with no question shown", async () => {
    const { ex, seen } = executor(fakeHost(powderPage(mn3gaSession())).host, true);
    const unknown = await ex.run("ask_user", { question: "At {{nonsense}}: what next?", options: two });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/ask_user: \{\{nonsense\}\} names no value the page has now/);
    const bad = await ex.run("ask_user", { question: "What next?", options: [two[0]] });
    expect(bad.isError).toBe(true);
    expect(seen.filter((e) => e.choices)).toEqual([]);
  });

  it("a clicked option is the Agent's words: the report still underlines a number it brought; the user's own typed number still stands", async () => {
    const { ex } = executor(fakeHost(powderPage(mn3gaSession())).host, true);
    ex.heard("Refine it.");
    await ex.run("ask_user", { question: "Compare with a published value?", options: [{ label: "Yes", message: "Compare with the published wR of 7.31 %." }, { label: "No", message: "No comparison." }] });
    // The click sends the option's message as the user's.
    ex.heard("Compare with the published wR of 7.31 %.");
    const clicked = JSON.parse((await ex.run("write_report", { summary: "The refinement is compared with the published wR of 7.31 %." })).text) as { unverifiedNumbers?: string[] };
    expect(clicked.unverifiedNumbers).toContain("7.31");
    // The same words typed by the user (no question open) are theirs to quote.
    ex.heard("Compare with the published wR of 7.31 %.");
    const typed = JSON.parse((await ex.run("write_report", { summary: "The refinement is compared with the published wR of 7.31 %." })).text) as { unverifiedNumbers?: string[] };
    expect(typed.unverifiedNumbers ?? []).not.toContain("7.31");
  }, 60000);

  it("an option that leads to a change still goes through the change tool and its approval card", async () => {
    const { ex, asked } = executor(fakeHost(powderPage(mn3gaSession())).host, false);
    await ex.run("ask_user", { question: "What next?", options: [{ label: "Hold the scale", message: "Hold the scale fixed." }, { label: "Lift the occupancy rule", message: "Lift the bare-occupancy rule: the anomalous data determine it." }] });
    ex.heard("Hold the scale fixed.");
    // The model acts on the message as on a typed one: the change asks, and here the user declines.
    const change = await ex.run("set_free", { fix: ["scale"] });
    expect(asked.map((e) => e.tool)).toEqual(["set_free"]);
    expect(change.status).toBe("declined");
    ex.heard("Lift the bare-occupancy rule: the anomalous data determine it.");
    await ex.run("allow_exception", { rule: "bare-occupancy", reason: "the anomalous data determine it" });
    expect(asked.at(-1)).toMatchObject({ tool: "allow_exception", alwaysAsk: true });
  }, 60000);
});

describe("ask_user in the drawer", () => {
  const question = (id: string, stamp: string): ActivityEntry => ({
    id, tool: "ask_user", title: "Ask you a question", effect: "read", at: 0, status: "done",
    choices: { kind: "question", tool: "ask_user", title: "What next?", options: [{ id: "1", label: "Free B", message: "Free the B values and refine." }, { id: "2", label: "Occupancy", message: "Free the occupancy." }], other: { label: "Something else…", template: "" }, stamp },
  });
  const activity = { q1: question("q1", "A"), q2: question("q2", "B") };
  const items: TranscriptItem[] = [
    { kind: "user", id: "u1", text: "Refine." },
    { kind: "assistant", id: "a1", text: "Converged. Your call:", thinking: "" },
    { kind: "tool", id: "t1", entryId: "q1" },
    { kind: "user", id: "u2", text: "Free the B values and refine." },
    { kind: "assistant", id: "a2", text: "Done. Next?", thinking: "" },
    { kind: "tool", id: "t2", entryId: "q2" },
  ];

  it("shows the question live on the last turn and superseded once a message follows it", () => {
    const shown = turnChoices(items, activity, false);
    expect(shown.get("t1")).toMatchObject({ entryId: "q1", state: "superseded" });
    expect(shown.get("t2")).toMatchObject({ entryId: "q2", state: "live" });
    expect(turnChoices(items, activity, true).get("t2")).toBeUndefined();
  });
});

// ── the chat loop ends the turn on the question ─────────────────────────────

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

function sse(blocks: Block[], stop: string): string {
  const ev = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
  let out = ev("message_start", { message: { id: "msg_x", type: "message", role: "assistant", model: "scripted", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      out += ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      out += ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    } else {
      out += ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      out += ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    out += ev("content_block_stop", { index });
  });
  out += ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
  out += ev("message_stop", {});
  return out;
}

async function fakeApi(turns: string[]): Promise<{ url: string; server: Server; requests: Record<string, unknown>[] }> {
  const requests: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      const turn = turns[requests.length - 1];
      if (!turn) {
        res.statusCode = 500;
        res.end("no more turns");
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(turn);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, server, requests };
}

describe("the chat loop with ask_user", () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });
  const config = (url: string) => ({ transport: "api-key" as const, apiKey: "sk-test", baseURL: url, model: "claude-opus-5-5", effort: "high" as const });
  const quiet = (notices: string[] = []) => ({ onAssistantStart: () => undefined, onText: () => undefined, onThinking: () => undefined, onNotice: (t: string) => notices.push(t), onUsage: () => undefined });

  it("ends the turn at the question: the calls before it run, those after it do not, all answered in one message, and no further request", async () => {
    const api = await fakeApi([
      sse([{ type: "text", text: "Converged. Which next?" }, { type: "tool_use", id: "tu_1", name: "get_state", input: {} }, { type: "tool_use", id: "tu_2", name: "ask_user", input: { question: "What next?", options: two } }, { type: "tool_use", id: "tu_3", name: "set_free", input: { free: ["scale"] } }], "tool_use"),
      sse([{ type: "text", text: "(never asked for)" }], "end_turn"),
    ]);
    server = api.server;
    const ran: string[] = [];
    const chat = new AgentChat({ run: async (name: string) => { ran.push(name); return { isError: false, text: "{}", status: "ok" }; } } as unknown as AgentExecutor);
    await chat.send("Refine it.", config(api.url), quiet(), new AbortController().signal);
    expect(ran).toEqual(["get_state", "ask_user"]);
    expect(api.requests).toHaveLength(1);
    const history = chat.history();
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const results = history[2]!.content as { tool_use_id: string; is_error?: boolean; content: string }[];
    expect(results.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([["tu_1", false], ["tu_2", false], ["tu_3", true]]);
    expect(results[2]!.content).toMatch(/Not run: your turn ended with the question to the user/);
  });

  it("the user's answer (a click) is their next message, and the conversation goes on from it", async () => {
    const api = await fakeApi([
      sse([{ type: "tool_use", id: "tu_1", name: "ask_user", input: { question: "What next?", options: two } }], "tool_use"),
      sse([{ type: "text", text: "Freeing the B values." }], "end_turn"),
    ]);
    server = api.server;
    const chat = new AgentChat({ run: async () => ({ isError: false, text: "{}", status: "ok" }) } as unknown as AgentExecutor);
    await chat.send("Refine it.", config(api.url), quiet(), new AbortController().signal);
    await chat.send(two[0]!.message, config(api.url), quiet(), new AbortController().signal);
    expect(api.requests).toHaveLength(2);
    const sent = api.requests[1]!.messages as { role: string; content: unknown }[];
    expect(sent.at(-1)).toEqual({ role: "user", content: "Free the B values and refine." });
  });

  it("a question that failed (a bad input) does not end the turn: the model reads the error and goes on", async () => {
    const api = await fakeApi([
      sse([{ type: "tool_use", id: "tu_1", name: "ask_user", input: { question: "What next?", options: [two[0]] } }], "tool_use"),
      sse([{ type: "text", text: "Which do you prefer: the B values or the occupancies?" }], "end_turn"),
    ]);
    server = api.server;
    const chat = new AgentChat({ run: async () => ({ isError: true, text: "Error: invalid input for ask_user", status: "error" }) } as unknown as AgentExecutor);
    await chat.send("Refine it.", config(api.url), quiet(), new AbortController().signal);
    expect(api.requests).toHaveLength(2);
  });

  it("a conclusion in a question's turn meets the final-answer check: a grade of a fit refined in this message, with no assessment, is sent back and the question is not shown", async () => {
    const api = await fakeApi([
      sse([{ type: "tool_use", id: "tu_1", name: "refine", input: {} }], "tool_use"),
      sse([{ type: "text", text: "The fit is excellent now." }, { type: "tool_use", id: "tu_2", name: "ask_user", input: { question: "Shall I write the report?", options: [{ label: "Yes", message: "Write the report." }, { label: "No", message: "Not yet." }] } }], "tool_use"),
      sse([{ type: "tool_use", id: "tu_3", name: "assess_refinement", input: {} }], "tool_use"),
      sse([{ type: "text", text: "The assessment reads it as good." }], "end_turn"),
    ]);
    server = api.server;
    const ran: string[] = [];
    const notices: string[] = [];
    const runner = {
      run: async (name: string) => {
        ran.push(name);
        return name === "refine" ? { isError: false, text: "{\"refined\":true}", status: "ok", refined: true, fitChanged: true } : { isError: false, text: "{}", status: "ok" };
      },
      page: () => "powder" as const,
    };
    const chat = new AgentChat(runner as unknown as AgentExecutor);
    await chat.send("Refine it and tell me how good the fit is.", config(api.url), quiet(notices), new AbortController().signal);
    // The question never ran; the model was sent back for the assessment and went on.
    expect(ran).toEqual(["refine", "assess_refinement"]);
    expect(api.requests).toHaveLength(4);
    const back = chat.history()[4]!.content as { tool_use_id: string; is_error?: boolean; content: string }[];
    expect(back[0]).toMatchObject({ tool_use_id: "tu_2", is_error: true });
    expect(back[0]!.content).toMatch(/\(The question was not shown\.\)$/);
    expect(notices.some((n) => /assess/i.test(n))).toBe(true);
  });
});
