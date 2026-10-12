import { describe, it, expect } from "vitest";
import { contextAdvice } from "@/agent/localServer";

const base = { server: "LM Studio" as const, model: "qwen/qwen3.8-27b", needed: 41_000, current: 32_768, max: 131_072 };
const GB = 1024 ** 3;

describe("the next step for a conversation that no longer fits", () => {
  it("fits: the model takes more and the machine has the memory, so it names the reload", () => {
    const a = contextAdvice({ ...base, freeBytes: 8 * GB, kvBytesPerToken: 65_536 });
    expect(a.size).toBe(49_152);
    expect(a.text).toBe("This conversation needs about 40k tokens; qwen/qwen3.8-27b takes up to 128k, and this machine has room for 48k (about 1.0 GB more). Reload it at 48k in LM Studio (eject it, then load it with Context Length 49152, or lms unload qwen/qwen3.8-27b && lms load qwen/qwen3.8-27b --context-length 49152), or start a new conversation (the analysis stays as it is).");
  });

  it("does not fit: past the model's maximum, or more memory than the machine has", () => {
    expect(contextAdvice({ ...base, needed: 140_000 })).toEqual({ size: null, text: "This conversation needs about 137k tokens; qwen/qwen3.8-27b takes at most 128k. Start a new conversation (the analysis stays as it is), or pick a model with a longer context." });
    const short = contextAdvice({ ...base, freeBytes: 0.5 * GB, kvBytesPerToken: 65_536 });
    expect(short.size).toBeNull();
    expect(short.text).toBe("This conversation needs about 40k tokens; qwen/qwen3.8-27b takes up to 128k, but 48k needs about 1.0 GB more memory and this machine has 0.5 GB free. Start a new conversation (the analysis stays as it is).");
  });

  it("unknown memory (what LM Studio and Ollama tell a page): the reload, if the machine has the memory", () => {
    const a = contextAdvice(base);
    expect(a.size).toBe(49_152);
    expect(a.text).toMatch(/^This conversation needs about 40k tokens; qwen\/qwen3\.8-27b takes up to 128k, if this machine has the memory for it\. Reload it at 48k in LM Studio/);
    // A model whose maximum the server does not give.
    expect(contextAdvice({ ...base, max: null }).text).toMatch(/qwen\/qwen3\.8-27b may take more than 32k, if this machine has the memory for it\. Reload it at 48k/);
  });

  it("on Ollama, which the chat sizes itself, only a maximum is advice", () => {
    expect(contextAdvice({ ...base, server: "Ollama", needed: 300_000, max: 262_144 }).text).toMatch(/takes at most 256k\. Start a new conversation/);
  });
});
