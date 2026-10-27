import { describe, it, expect } from "vitest";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ThinkingBinding, bindingKey, withoutSignedThinking } from "@/agent/thinkingBinding";

const tool = (name: string, description = "does it") => ({ name, description, input_schema: { type: "object", properties: {} } });
const system = (mode: string) => [{ text: "You are the agent." }, { text: `Mode: ${mode}.` }];

describe("bindingKey: what a thinking block's signature is bound to besides the messages", () => {
  it("is the same for the same system blocks and tools, whatever else rides on them", () => {
    const a = bindingKey(system("ask"), [tool("get_state"), tool("refine")]);
    expect(bindingKey(system("ask"), [tool("get_state"), tool("refine")])).toBe(a);
    // Caching markers and streaming flags are not part of it.
    expect(bindingKey([{ text: "You are the agent.", cache_control: { type: "ephemeral" } } as { text: string }, { text: "Mode: ask." }], [{ ...tool("get_state"), eager_input_streaming: true } as ReturnType<typeof tool>, tool("refine")])).toBe(a);
  });

  it("moves with the mode line, a tool's description or schema, and the tools offered", () => {
    const a = bindingKey(system("ask"), [tool("get_state")]);
    const keys = new Set([
      a,
      bindingKey(system("auto"), [tool("get_state")]),
      bindingKey(system("ask"), [tool("get_state", "reads it")]),
      bindingKey(system("ask"), [{ ...tool("get_state"), input_schema: { type: "object", properties: { x: {} } } }]),
      bindingKey(system("ask"), [tool("get_state"), tool("refine")]),
      bindingKey(system("ask"), []),
    ]);
    expect(keys.size).toBe(6);
  });
});

describe("withoutSignedThinking", () => {
  const history = (): BetaMessageParam[] => [
    { role: "user", content: "How is the fit?" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Look.", signature: "sig-1" },
        { type: "redacted_thinking", data: "opaque" },
        { type: "text", text: "Looking." },
        { type: "tool_use", id: "tu_1", name: "get_state", input: {} },
      ],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "{}" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "Fine.", signature: "sig-2" }, { type: "text", text: "Fine." }] },
  ];

  it("keeps each turn's text and tool calls, the user turns and the tool results", () => {
    const out = withoutSignedThinking(history());
    expect(out).toEqual([
      { role: "user", content: "How is the fit?" },
      { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "tu_1", name: "get_state", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "{}" }] },
      { role: "assistant", content: [{ type: "text", text: "Fine." }] },
    ]);
  });

  it("does not change what it was given, and hands back the same turns where there was nothing to leave out", () => {
    const h = history();
    const before = JSON.stringify(h);
    const out = withoutSignedThinking(h);
    expect(JSON.stringify(h)).toBe(before);
    expect(out[0]).toBe(h[0]);
    expect(out[2]).toBe(h[2]);
    expect(withoutSignedThinking(out)).toEqual(out);
  });

  it("never leaves a turn empty, which the API refuses", () => {
    const out = withoutSignedThinking([{ role: "assistant", content: [{ type: "thinking", thinking: "…", signature: "s" }] }]);
    expect(out).toEqual([{ role: "assistant", content: [{ type: "text", text: "(no reply)" }] }]);
  });
});

describe("ThinkingBinding", () => {
  it("says to drop the thinking only when the prefix it was written under has moved", () => {
    const b = new ThinkingBinding();
    expect(b.moves("a")).toBe(false); // the first request: nothing written yet
    expect(b.moves("a")).toBe(false);
    expect(b.moves("b")).toBe(true); // the mode changed
    expect(b.moves("b")).toBe(false); // what was written since is signed under b
    expect(b.moves("a")).toBe(true); // and back: b's thinking goes in turn
  });

  it("starts over when the history holds no signed thinking", () => {
    const b = new ThinkingBinding();
    b.moves("a");
    b.forget();
    expect(b.moves("b")).toBe(false);
  });
});
