/**
 * How full the model's window is: the meter by the Copilot's message box.
 *
 * A reading is the last request's prompt, the reply it got (which joins the
 * history) and the room kept for the next reply, against the window of the
 * model in use: Claude's own window, or the context a local server runs the
 * model with. Claude's counts are the API's (its reported usage); a local
 * model's are the app's estimate, the one each request is sized by
 * (chatBudget.ts), whose characters per token are measured against the
 * server's own counts.
 *
 * Pure: the chat makes readings (chat.ts), the drawer shows them.
 */

import type { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export interface ContextReading {
  /** The model the window is for. */
  readonly model: string;
  /** The model's window, in tokens. */
  readonly window: number;
  /** Tokens of the last prompt (instructions, tools and the history as sent). */
  readonly prompt: number;
  /** Tokens of the reply it got, which the next prompt carries. */
  readonly reply: number;
  /** Tokens kept free for the next reply: the most one reply may take. */
  readonly reserve: number;
  /** Who counted: the provider's reported usage, or the app's own estimate. */
  readonly source: "provider" | "app";
  /** A local server's own count of the last prompt, when it gave one. */
  readonly serverCount?: number | null;
  /** An estimate until the next reply (after a summary replaced the history). */
  readonly estimated?: boolean;
  /** A request that did not fit, so nothing was sent: the percent may pass 100. */
  readonly overflow?: boolean;
}

/** Below this share of the window the meter is neutral; from it, amber. */
export const AMBER_AT = 70;
/** Above this share the meter is red. */
export const RED_ABOVE = 90;

export type ContextLevel = "neutral" | "amber" | "red";

/** The tokens in use: the last prompt and its reply. */
export const usedTokens = (r: ContextReading): number => r.prompt + r.reply;

/**
 * The share of the window taken, in whole percent: what is in use plus the
 * reply reserve. At most 100 for a conversation that still runs (the next
 * request is shortened to fit, and the chat says so); past it only for a
 * request that did not fit.
 */
export function contextPercent(r: ContextReading): number {
  if (!(r.window > 0)) return 0;
  const percent = Math.round((100 * (usedTokens(r) + r.reserve)) / r.window);
  return r.overflow ? percent : Math.min(100, percent);
}

/**
 * The room a local request keeps for the reply: the app's reserve, or what is
 * left of the window when the prompt reaches into it (never below the least a
 * request is sent with).
 */
export const localReserve = (window: number, prompt: number, reserve: number, least: number): number => Math.max(least, Math.min(reserve, window - prompt));

/** Neutral below 70 %, amber from 70 % to 90 %, red above 90 % (on the percent shown). */
export function contextLevel(percent: number): ContextLevel {
  return percent > RED_ABOVE ? "red" : percent >= AMBER_AT ? "amber" : "neutral";
}

/** The meter's own words: "Context 62%". */
export const meterLabel = (r: ContextReading): string => `Context ${contextPercent(r)}%`;

/** The tokens of a prompt as the Anthropic API counts it: the uncached part, the part written to the cache and the part read from it. */
export const promptTokens = (u: Pick<BetaUsage, "input_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens">): number =>
  (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

/** Claude's window, in tokens, for the models the Copilot offers (chat-models.ts); null for a model it does not know. */
export const CLAUDE_WINDOWS: Readonly<Record<string, number>> = {
  "claude-opus-5-5": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-haiku-5-5": 1_000_000,
};
export const claudeWindow = (model: string): number | null => CLAUDE_WINDOWS[model] ?? null;

/**
 * Anthropic's list prices, US dollars per million tokens (as of 2026-10):
 * input, output, a 5-minute cache write (1.25 × input) and a cache read.
 * Haiku 5.5 costs more past 100k prompt tokens.
 */
interface Price {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}
const PRICES: Readonly<Record<string, { readonly base: Price; readonly long?: { readonly above: number; readonly price: Price } }>> = {
  "claude-opus-5-5": { base: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
  "claude-sonnet-5-5": { base: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 } },
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    long: { above: 100_000, price: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 } },
  },
};

/** One response's cost at list price, in US dollars; null for a model without a known price (a local or scripted one). */
export function responseCost(model: string, u: BetaUsage): number | null {
  const entry = PRICES[model];
  if (!entry) return null;
  const p = entry.long && promptTokens(u) > entry.long.above ? entry.long.price : entry.base;
  return ((u.input_tokens ?? 0) * p.input + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.output_tokens ?? 0) * p.output) / 1e6;
}

/** A cost as the details show it: cents below a dollar keep two significant figures. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toPrecision(2)}`;
  return `$${usd.toFixed(2)}`;
}

const n = (x: number): string => x.toLocaleString("en-US");

/**
 * The details behind the meter's "?", one line each: what is in use against
 * the window, the reply reserve, who counted, and the cost (`cost`: the
 * session's, in dollars; "local": nothing to pay; null: not known).
 */
export function meterDetails(r: ContextReading, cost: number | "local" | null): string[] {
  const used = usedTokens(r);
  const lines = [
    `${n(used + r.reserve)} of ${n(r.window)} tokens (${contextPercent(r)}%): ${n(used)} in use (the last prompt ${n(r.prompt)}, its reply ${n(r.reply)}) and ${n(r.reserve)} kept for the next reply.`,
    r.source === "provider"
      ? `Counted by the API (the usage it reports with each reply)${r.estimated ? "; an estimate until the next reply, since the summary replaced the history" : ""}.`
      : `Counted by the app (its estimate of each prompt, measured against the server's own counts)${r.serverCount ? `; the server counted ${n(r.serverCount)} for the last prompt` : ""}${r.estimated ? "; an estimate until the next reply, since the summary replaced the history" : ""}.`,
    `Amber at ${AMBER_AT}%, red above ${RED_ABOVE}%.`,
  ];
  if (cost === "local") lines.push("No cost: the model runs on this machine.");
  else if (cost === null) lines.push("Cost: not known for this server.");
  else lines.push(`This session so far: ${formatCost(cost)} at Anthropic's list prices (your bill is Anthropic's).`);
  return lines;
}

/**
 * A reading after the history was replaced (a summary): the prompt scaled by
 * the characters it now takes, an estimate until the next reply counts it.
 */
export function rescaled(r: ContextReading, charsBefore: number, charsAfter: number): ContextReading {
  const prompt = charsBefore > 0 ? Math.round((r.prompt * charsAfter) / charsBefore) : r.prompt;
  return { ...r, prompt, reply: 0, estimated: true, serverCount: null };
}
