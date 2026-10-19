/**
 * How much a conversation may take: its run policy on each transport (turns,
 * tools offered, pruning, reply cap), a sized request fitted to a local
 * model's window, and the meter that learns the model's characters per token
 * from the server's own counts (and knows a cut prompt when it sees one).
 */

import type { BetaMessageParam, BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { historyChars, pruneForLocal } from "@/agent/contextWindow";
import { kTokens } from "@/agent/localServer";
import { isLocal, isSized, type ChatConfig } from "@/agent/chatTransport";

/** Most model turns one user message may run (each tool round is a turn). */
const MAX_TURNS = 40;
/**
 * A local model makes one call a turn where Claude makes several, so a full
 * refinement takes it twice the turns; the loop guard, not the cap, stops a
 * model going in circles.
 */
const MAX_TURNS_SIZED = 80;
/** A window this long or more holds every tool: the OpenAI-compatible provider then offers them all. */
const LARGE_CONTEXT = 131_072;

/** Characters per token a local model's prompt is first taken to have: low, so the estimate errs high (measured: 3.7 on the Agent's prompt for qwen3.8-27b). */
export const CHARS_PER_TOKEN = 3;
const CHARS_PER_TOKEN_FLOOR = 2.5;
const MAX_CHARS_PER_TOKEN = 3.8;
/** Tokens kept free for a local model's reply and its thinking. */
export const REPLY_RESERVE = 6144;
/** The least room for a reply a request is sent with. */
export const MIN_REPLY = 2048;
/** The most an OpenAI-compatible reply is given (gpt-4o takes no more). */
const OPENAI_REPLY_CAP = 16384;

/**
 * How a conversation runs on its transport: its limits and the shape of each
 * request. Each default is the app's choice for that transport, with its
 * reason where it is set; a run records the policy it ran under, so models
 * reached in different ways are compared knowing how (docs/VALIDATION.md).
 */
export interface RunPolicy {
  /** Most model turns one user message may run (MAX_TURNS, MAX_TURNS_SIZED). */
  readonly turnCap: number;
  /** The tools a request offers: all of them, or the page's and the method stage's (toolScope.ts). */
  readonly toolScope: "stage" | "all";
  /** Old tool results: cleared by the API past a budget (Claude), or digested by the app to fit the window (contextWindow.ts). */
  readonly pruning: "server" | "digest";
  /** A turn stops after STILL_STOP read calls in a row that change nothing (LoopGuard). */
  readonly stallStop: boolean;
  /** Sent with each request; null: the server's default for the model. Claude thinks (adaptive), which takes its own. */
  readonly temperature: number | null;
  /** Most tokens one reply may take. */
  readonly replyCap: number;
  /** Claude's adaptive thinking at the configured effort, or what a local model does by default. */
  readonly thinking: "adaptive" | "model";
}

export function runPolicy(config: ChatConfig, window: number | null): RunPolicy {
  const sized = isSized(config.transport);
  const set = config.policy ?? {};
  return {
    turnCap: set.turnCap ?? (sized ? MAX_TURNS_SIZED : MAX_TURNS),
    // A local model's window is small; an OpenAI-compatible one's may be either: all the tools only when it is large.
    toolScope: config.toolScope ?? (isLocal(config.transport) || (config.transport === "openai-compatible" && (window ?? 0) < LARGE_CONTEXT) ? "stage" : "all"),
    pruning: sized ? "digest" : "server",
    // Calls that change nothing are counted on a sized transport only: Claude may read at length (a ref page by page).
    stallStop: set.stallStop ?? sized,
    temperature: sized ? set.temperature ?? null : null,
    // OpenAI's own models take at most 16k (gpt-4o) to 32k tokens of reply: cap it there.
    replyCap: config.transport === "openai-compatible" ? OPENAI_REPLY_CAP : 64000,
    thinking: sized ? "model" : "adaptive",
  };
}

/** A sized request's temperature, when the policy sets one. */
export function temperatureOf(config: ChatConfig): { temperature?: number } {
  const t = runPolicy(config, null).temperature;
  return t === null ? {} : { temperature: t };
}
/** Template tokens around each message. */
const MESSAGE_TOKENS = 8;
/** A prompt the server counts below this share of the estimate was cut. */
const CUT_SHARE = 0.4;


const withoutThinking = (messages: readonly BetaMessageParam[]): BetaMessageParam[] =>
  messages.map((m) => (m.role !== "assistant" || typeof m.content === "string" ? m : { ...m, content: m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking") }));

/**
 * A local request sized to the model's window (tokens): the history pruned to
 * what is left after the instructions, the tools and room for the reply; the
 * reply capped at the room left. When even the most pruned history does not
 * fit, a refusal instead: a prompt the server would cut is never sent.
 */
export function fitWindow(messages: readonly BetaMessageParam[], fixedChars: number, window: number, charsPerToken: number, replyCap = 64000): {
  readonly messages: BetaMessageParam[];
  readonly chars: number;
  /** The characters every server surely reads: without the reasoning of earlier replies, which some drop. */
  readonly sentChars: number;
  readonly estimate: number;
  readonly maxTokens: number;
  /** Why nothing was sent; `advice` (contextAdvice) replaces the generic next step. */
  readonly refusal: ((config: Pick<ChatConfig, "transport" | "model">, advice?: string) => string) | null;
} {
  const overhead = MESSAGE_TOKENS * (messages.length + 2);
  const budget = Math.max(0, Math.floor((window - REPLY_RESERVE - overhead) * charsPerToken - fixedChars));
  const pruned = pruneForLocal(messages, budget);
  const chars = fixedChars + historyChars(pruned);
  const sentChars = fixedChars + historyChars(withoutThinking(pruned));
  const estimate = Math.ceil(chars / charsPerToken) + overhead;
  const room = window - estimate;
  if (room >= MIN_REPLY) return { messages: pruned, chars, sentChars, estimate, maxTokens: Math.min(replyCap, room), refusal: null };
  return {
    messages: pruned,
    chars,
    sentChars,
    estimate,
    maxTokens: 0,
    refusal: (config, advice) => {
      const needs = `it needs about ${kTokens(estimate + MIN_REPLY)} (the instructions and tools alone about ${kTokens(fixedChars / charsPerToken)}). Nothing was sent, so the model was not handed a cut prompt.`;
      if (advice) return `This conversation no longer fits the ${kTokens(window)}-token context ${config.transport === "lmstudio" ? "LM Studio" : "Ollama"} runs ${config.model} with, even with the old tool results shortened. Nothing was sent, so the model was not handed a cut prompt. ${advice}`;
      return config.transport === "lmstudio"
        ? `This conversation no longer fits the ${kTokens(window)}-token context LM Studio runs ${config.model} with, even with the old tool results shortened: ${needs} Start a new conversation, or give the model a longer context (lms unload ${config.model} && lms load ${config.model} --context-length ${2 * window}).`
        : config.transport === "openai-compatible"
          ? `This conversation no longer fits the ${kTokens(window)}-token window used for ${config.model} (the server's own, or the context set in the Copilot settings when the server does not say), even with the old tool results shortened: ${needs} Start a new conversation, or set a longer context if the model takes one.`
          : `This conversation no longer fits ${config.model}'s ${kTokens(window)}-token context on Ollama, even with the old tool results shortened: ${needs} Start a new conversation, or pick a model with a longer context.`;
    },
  };
}


/**
 * A sized transport's prompts, measured: the characters per token (a cautious
 * guess, then the server's own counts), the last request's size, and whether
 * the server cut the prompt.
 */
export class PromptMeter {
  /** Characters per token of this model's prompts: a cautious guess, then measured from the server's own counts. */
  charsPerToken = CHARS_PER_TOKEN;
  /** The last local request's size, to read the server's count against. */
  sent: { readonly chars: number; readonly sentChars: number; readonly estimate: number } | null = null;
  /**
   * The server's counts that read as the whole prompt (near the estimate, and
   * not below the last such count): after two, it is known to count whole
   * prompts, cached or not, so a count far below the estimate means a cut. A
   * server that counts only what it had not cached gives one such count at
   * most (its first, cold request) and never arms the check.
   */
  private wholeCounts = 0;
  private lastWhole = 0;
  /** The server and model the measured characters per token are for. */
  private of = "";

  /** The model the next requests go to: another model's tokens are counted anew. */
  use(model: string): void {
    if (this.of === model) return;
    this.of = model;
    this.charsPerToken = CHARS_PER_TOKEN;
    this.wholeCounts = 0;
    this.lastWhole = 0;
  }

  /**
   * The server's count of the prompt it read, against what was sent: a count
   * far below the estimate means it cut the prompt (a sentence for the user);
   * otherwise it calibrates the characters per token. Null when it fits.
   */
  read(usage: BetaUsage, window: number | null): string | null {
    const sent = this.sent;
    // These servers count the whole prompt as its input (LM Studio gives the cached part again
    // as cache_read; Ollama's prompt_eval_count and an OpenAI server's prompt_tokens are totals).
    const read = usage.input_tokens ?? 0;
    if (sent === null || window === null || read <= 0) return null;
    if (read < CUT_SHARE * sent.estimate) {
      if (this.wholeCounts < 2) return null;
      return `The server read only ${read.toLocaleString("en-US")} of about ${sent.estimate.toLocaleString("en-US")} prompt tokens: it cut the prompt, so this reply did not see all of its instructions and the conversation, and nothing it asked for was run. Check the context the model is loaded with, or clear the conversation.`;
    }
    // Measured on what the server surely read (reasoning a server drops is left out), so the
    // ratio errs low. A count near the window may be a cut one, and a count below the last
    // whole one may leave out what was cached: learn only from a prompt that clearly fit, whole.
    const ratio = sent.sentChars / read;
    if (ratio >= 2.4 && ratio <= 4.5 && read < 0.95 * window && read >= 0.9 * this.lastWhole) {
      this.wholeCounts++;
      this.lastWhole = read;
      this.charsPerToken = Math.min(MAX_CHARS_PER_TOKEN, Math.max(CHARS_PER_TOKEN_FLOOR, ratio * 0.92));
    }
    return null;
  }
}
