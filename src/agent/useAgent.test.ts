import { describe, it, expect } from "vitest";
import { modelLabel, settingsFrom } from "@/agent/useAgent";

describe("Agent settings from storage", () => {
  it("defaults to your own API key, with LM Studio and Ollama on their usual addresses", () => {
    const s = settingsFrom(null);
    expect(s.mode).toBe("api-key");
    expect(s.ollamaUrl).toBe("http://localhost:11434");
    expect(s.lmstudioUrl).toBe("http://localhost:1234");
    expect(settingsFrom("not json")).toEqual(s);
  });

  it("a saved Claude Code choice falls back to the default, and its bridge address is dropped", () => {
    const s = settingsFrom(JSON.stringify({ mode: "claude-code", bridgeUrl: "http://127.0.0.1:5199", model: "claude-sonnet-5-5", ollamaModel: "qwen3:32b" }));
    expect(s.mode).toBe("api-key");
    expect(s.model).toBe("claude-sonnet-5-5");
    expect(s.ollamaModel).toBe("qwen3:32b");
    expect("bridgeUrl" in s).toBe(false);
  });

  it("keeps a saved LM Studio choice, and never brings auto-approve back on", () => {
    const s = settingsFrom(JSON.stringify({ mode: "lmstudio", lmstudioModel: "qwen/qwen3-32b", autoApprove: true, rememberKey: "yes" }));
    expect(s.mode).toBe("lmstudio");
    expect(s.lmstudioModel).toBe("qwen/qwen3-32b");
    expect(s.autoApprove).toBe(false);
    // A value of the wrong type is ignored.
    expect(s.rememberKey).toBe(false);
  });

  it("names a replayed run by the model that took it live, never by the server that carries the replay", () => {
    const s = settingsFrom(JSON.stringify({ mode: "lmstudio", lmstudioModel: "claude-replay", replayOf: "Claude Opus 5.5" }));
    expect(modelLabel(s)).toBe("Claude Opus 5.5 · replay of a live run");
    expect(modelLabel(settingsFrom(JSON.stringify({ mode: "lmstudio", lmstudioModel: "qwen/qwen3-32b" })))).toBe("qwen/qwen3-32b · LM Studio (local)");
    expect(settingsFrom(null).replayOf).toBe("");
  });
});
