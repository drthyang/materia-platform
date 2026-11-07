import { describe, expect, it } from "vitest";
import { AMBER_AT, RED_ABOVE, claudeWindow, localReserve, contextLevel, contextPercent, formatCost, meterDetails, meterLabel, promptTokens, rescaled, responseCost, usedTokens, type ContextReading } from "@/agent/contextMeter";
import { MIN_REPLY, REPLY_CAP, REPLY_RESERVE } from "@/agent/chatBudget";
import { CHAT_MODELS } from "@/agent/chat-models";

const claude = (prompt: number, reply = 0): ContextReading => ({ model: "claude-opus-5-5", window: 1_000_000, prompt, reply, reserve: REPLY_CAP, source: "provider" });
const local = (prompt: number, reply = 0, window = 32_768): ContextReading => ({ model: "qwen3:32b", window, prompt, reply, reserve: REPLY_RESERVE, source: "app", serverCount: prompt - 100 });

describe("the context meter's maths", () => {
  it("counts the last prompt, its reply and the reply reserve against the window", () => {
    const r = claude(500_000, 6_000);
    expect(usedTokens(r)).toBe(506_000);
    // (506k + 64k) / 1M
    expect(contextPercent(r)).toBe(57);
    expect(meterLabel(r)).toBe("Context 57%");
  });

  it("counts the reply reserve: an empty conversation already takes it", () => {
    expect(contextPercent(claude(0))).toBe(Math.round((100 * REPLY_CAP) / 1_000_000));
    // A local model's reserve is the room each request keeps for the reply (chatBudget.ts): a fifth of a 32k window.
    expect(contextPercent(local(0))).toBe(19);
  });

  it("measures against the model's own window: the same prompt fills a local 32k far more than Claude's 1M", () => {
    expect(contextPercent(local(20_000))).toBe(80);
    expect(contextPercent(claude(20_000))).toBe(8);
    expect(contextPercent(local(20_000, 0, 131_072))).toBe(20);
  });

  it("reads a prompt as the API counts it: uncached, written to the cache, and read from it", () => {
    expect(promptTokens({ input_tokens: 1_200, cache_creation_input_tokens: 3_000, cache_read_input_tokens: 40_000 })).toBe(44_200);
    expect(promptTokens({ input_tokens: 10, cache_creation_input_tokens: null, cache_read_input_tokens: null })).toBe(10);
  });

  it("knows the window of every Claude model the Copilot offers, and no other", () => {
    for (const m of CHAT_MODELS) expect(claudeWindow(m.id)).toBe(1_000_000);
    expect(claudeWindow("scripted")).toBeNull();
  });

  it("stops at 100 % while the conversation runs, and passes it only for a request that did not fit", () => {
    expect(contextPercent(local(30_000, 2_000))).toBe(100);
    expect(contextPercent({ ...local(30_000, 2_000), overflow: true })).toBe(116);
  });

  it("keeps the app's reply reserve for a local request, or what the prompt leaves of it, never below the least room", () => {
    expect(localReserve(32_768, 20_000, REPLY_RESERVE, MIN_REPLY)).toBe(REPLY_RESERVE);
    expect(localReserve(32_768, 28_000, REPLY_RESERVE, MIN_REPLY)).toBe(4_768);
    expect(localReserve(32_768, 31_000, REPLY_RESERVE, MIN_REPLY)).toBe(MIN_REPLY);
  });

  it("has no window to read against: no percent", () => {
    expect(contextPercent({ ...claude(10), window: 0 })).toBe(0);
  });
});

describe("the context meter's thresholds", () => {
  it("is neutral below 70 %, amber from 70 % to 90 %, red above 90 %", () => {
    expect([AMBER_AT, RED_ABOVE]).toEqual([70, 90]);
    expect(contextLevel(0)).toBe("neutral");
    expect(contextLevel(69)).toBe("neutral");
    expect(contextLevel(70)).toBe("amber");
    expect(contextLevel(90)).toBe("amber");
    expect(contextLevel(91)).toBe("red");
    expect(contextLevel(140)).toBe("red");
  });

  it("goes by the percent shown, so the color never disagrees with the number", () => {
    // 69.6 % shows as 70 %: amber.
    const r = claude(632_000);
    expect(contextPercent(r)).toBe(70);
    expect(contextLevel(contextPercent(r))).toBe("amber");
    // 90.4 % shows as 90 %: still amber; 90.6 % shows as 91 %: red.
    expect(contextLevel(contextPercent(claude(840_000)))).toBe("amber");
    expect(contextLevel(contextPercent(claude(842_000)))).toBe("red");
  });
});

describe("the cost of API models", () => {
  it("prices each part of a reply at Anthropic's list prices", () => {
    // Opus 5.5: $4 in, $20 out, $5 a cache write, $0.20 a cache read, per million.
    expect(responseCost("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as never)).toBeCloseTo(4, 10);
    expect(responseCost("claude-opus-5-5", { input_tokens: 0, output_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 1_000_000 } as never)).toBeCloseTo(2 + 1 + 0.2, 10);
    expect(responseCost("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as never)).toBeCloseTo(12, 10);
  });

  it("prices Haiku 5.5 higher past 100k prompt tokens", () => {
    expect(responseCost("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as never)).toBeCloseTo(0.01, 10);
    expect(responseCost("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as never)).toBeCloseTo(0.1, 10);
  });

  it("has no price for a local or scripted model", () => {
    expect(responseCost("qwen3:32b", { input_tokens: 10, output_tokens: 10 } as never)).toBeNull();
    expect(responseCost("scripted", { input_tokens: 10, output_tokens: 10 } as never)).toBeNull();
  });

  it("formats a cost in dollars, small ones to two significant figures", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(1.234)).toBe("$1.23");
  });
});

describe("the details behind the meter's ?", () => {
  it("give tokens used / window, the reply reserve, who counted, and the cost", () => {
    const lines = meterDetails(claude(500_000, 6_000), 1.5);
    expect(lines[0]).toBe("570,000 of 1,000,000 tokens (57%): 506,000 in use (the last prompt 500,000, its reply 6,000) and 64,000 kept for the next reply.");
    expect(lines[1]).toMatch(/^Counted by the API/);
    expect(lines.join(" ")).toMatch(/Amber at 70%, red above 90%\./);
    expect(lines.at(-1)).toBe("This session so far: $1.50 at Anthropic's list prices (your bill is Anthropic's).");
  });

  it("say when the app counted (a local model), with the server's own count, and that a local model costs nothing", () => {
    const lines = meterDetails(local(20_000), "local");
    expect(lines[1]).toBe("Counted by the app (its estimate of each prompt, measured against the server's own counts); the server counted 19,900 for the last prompt.");
    expect(lines.at(-1)).toBe("No cost: the model runs on this machine.");
    expect(meterDetails(local(20_000), null).at(-1)).toBe("Cost: not known for this server.");
  });

  it("call a reading after a summary an estimate", () => {
    const after = rescaled(claude(600_000, 2_000), 2_400_000, 120_000);
    expect(after.prompt).toBe(30_000);
    expect(after.reply).toBe(0);
    expect(after.estimated).toBe(true);
    expect(meterDetails(after, 0)[1]).toMatch(/an estimate until the next reply, since the summary replaced the history/);
  });
});
