/**
 * How the Agent reaches a model: the conversation's configuration, the SDK
 * client for each way in, and a readable sentence for each one's errors.
 *
 *  - `api-key`: the user's own Anthropic API key, sent straight from this
 *    browser to the API (the SDK's `dangerouslyAllowBrowser`). The key stays in
 *    this browser's storage; it is never part of a project file or a report.
 *  - `proxy`: the dev server's /api/anthropic route (vite.config.ts) holds the
 *    key from ANTHROPIC_API_KEY, so it never reaches the page. Local only.
 *  - `ollama` / `lmstudio`: a local model on the user's Ollama or LM Studio
 *    server, which speaks the same Messages API (ollama.ts, lmstudio.ts).
 *  - `openai-compatible`: any server that speaks OpenAI's chat completions
 *    (openaiCompat.ts).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AgentAutonomy } from "@/agent/systemPrompt";
import { ollamaBase, unreachableHint } from "@/agent/ollama";
import { ollamaNativeFetch, type OllamaPlan } from "@/agent/ollamaNative";
import { openaiBase, openaiCompatFetch, openaiUnreachableHint } from "@/agent/openaiCompat";
import { lmstudioBase, lmstudioUnreachableHint } from "@/agent/lmstudio";
import { plainFetch } from "@/agent/localServer";
import { NO_PROXY, PROXY_PATH } from "@/agent/proxyStatus";

export type ChatTransport = "api-key" | "proxy" | "ollama" | "lmstudio" | "openai-compatible";
export type ChatEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatConfig {
  readonly transport: ChatTransport;
  /** The user's key (api-key transport only). */
  readonly apiKey?: string;
  /** Another API address for the api-key transport (default the Anthropic API). */
  readonly baseURL?: string;
  /** The local server (ollama and lmstudio transports; default that server's usual address), or an OpenAI-compatible server's base URL (with its /v1). */
  readonly serverUrl?: string;
  /**
   * OpenAI-compatible: the context to size requests to when the server does
   * not say how long a prompt it takes, in tokens (default 32k). Ollama: the
   * context to load a model with that is not loaded (default 32k; a loaded
   * model keeps its own, so another program using it is never reloaded).
   */
  readonly context?: number;
  readonly model: string;
  readonly effort: ChatEffort;
  /** How far the agent goes on its own (default "ask": stop at each gate). */
  readonly autonomy?: AgentAutonomy;
  /**
   * Let the API re-run a declined turn on another model (server-side refusal
   * fallback). Off unless the user turns it on: a silent model switch makes a
   * session harder to reproduce, so every turn stays on `model` by default,
   * and a turn another model answered is always announced.
   */
  readonly fallback?: boolean;
  /**
   * Which tools each request offers: "all" (Claude's default), or "stage" —
   * the page's, and on the powder page the method stage's (toolScope.ts): a
   * local model's default, its window being small.
   */
  readonly toolScope?: "stage" | "all";
  /** What the run policy (runPolicy) may be told instead of its default for the transport. */
  readonly policy?: { readonly turnCap?: number; readonly stallStop?: boolean; readonly temperature?: number | null };
  /**
   * The skills offered (default on). Off is the validation's ablation arm
   * (docs/VALIDATION.md): no skill index in the prompt and no read_skill; the
   * executor must be built with `skills: false` to match.
   */
  readonly skills?: boolean;
}

/** Which API the history was written for: Claude's thinking is signed, another server's is not. */
export type Backend = "anthropic" | "ollama" | "lmstudio" | "openai-compatible";

export const isLocal = (t: ChatTransport): t is "ollama" | "lmstudio" => t === "ollama" || t === "lmstudio";
/** Requests sized to a window the app knows, with only the fields every server reads (not Claude's). */
export const isSized = (t: ChatTransport): t is "ollama" | "lmstudio" | "openai-compatible" => isLocal(t) || t === "openai-compatible";

/** The SDK client for the way in: a local or OpenAI-compatible server through its own fetch, the proxy, or the API with the user's key. */
export function clientFor(config: ChatConfig, ollamaPlan: () => OllamaPlan | null): Anthropic {
  if (config.transport === "openai-compatible") {
    // The SDK's requests become chat completions (openaiCompat.ts); the key goes only to the server named, as a Bearer token.
    const base = openaiBase(config.serverUrl ?? "");
    return new Anthropic({ apiKey: "openai-compatible", baseURL: base, dangerouslyAllowBrowser: true, maxRetries: 1, fetch: openaiCompatFetch(base, config.apiKey || undefined) });
  }
  if (isLocal(config.transport)) {
    // A local server ignores the key, but the SDK wants one; plainFetch never sends it.
    // Ollama goes through its native chat, the only endpoint that takes a context length.
    const baseURL = config.transport === "ollama" ? ollamaBase(config.serverUrl ?? "") : lmstudioBase(config.serverUrl ?? "");
    return new Anthropic({ apiKey: config.transport, baseURL, dangerouslyAllowBrowser: true, maxRetries: 1, fetch: config.transport === "ollama" ? ollamaNativeFetch(ollamaPlan) : plainFetch });
  }
  if (config.transport === "proxy") {
    const base = new URL(`${import.meta.env.BASE_URL}${PROXY_PATH}`, window.location.origin).href;
    // The proxy replaces this placeholder with the real key, server side.
    return new Anthropic({ apiKey: "proxy-holds-the-key", baseURL: base, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }
  if (!config.apiKey) throw new Error("No API key: add one in the Copilot settings.");
  return new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, ...(config.baseURL ? { baseURL: config.baseURL } : {}) });
}

/** A readable sentence for an API error, for the conversation. */
export function describeChatError(e: unknown, config: Pick<ChatConfig, "transport" | "model" | "serverUrl">): string {
  const { transport } = config;
  if (transport === "ollama") return describeOllamaError(e, config);
  if (transport === "openai-compatible") return describeOpenAIError(e, config);
  if (transport === "lmstudio") return describeLmStudioError(e, config);
  if (e instanceof Anthropic.AuthenticationError) {
    return transport === "proxy"
      ? "The proxy's API key was rejected. Check ANTHROPIC_API_KEY where the dev server runs."
      : "The API key was rejected. Check it in the Copilot settings.";
  }
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key is not allowed to use that model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a moment and try again.";
  if (e instanceof Anthropic.APIConnectionError) {
    return transport === "proxy"
      ? "Could not reach the proxy. It runs only with the dev server (npm run dev or npm run preview)."
      : "Could not reach the Anthropic API from this browser.";
  }
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { type?: string; message?: string } } | undefined;
    if (body?.error?.type === "proxy_not_configured") return body.error.message ?? "The proxy has no API key.";
    // A static host answers the proxy's path itself: 404, or 405 (GitHub Pages' nginx) or 501 for the POST.
    if (transport === "proxy" && (e.status === 404 || e.status === 405 || e.status === 501) && !body?.error?.type) return NO_PROXY;
    return `API error ${e.status ?? ""}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

function describeOllamaError(e: unknown, config: Pick<ChatConfig, "model" | "serverUrl">): string {
  if (e instanceof Anthropic.APIConnectionError) {
    return unreachableHint(config.serverUrl ?? "", typeof window === "undefined" ? null : window.location.origin);
  }
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { message?: string } } | undefined;
    const message = body?.error?.message ?? e.message;
    if (e.status === 404 && /not found/i.test(message)) {
      return `Ollama has no model "${config.model}". Pull it (ollama pull ${config.model}) or pick another in the Copilot settings.`;
    }
    if (/does not support tools/i.test(message)) {
      return `"${config.model}" cannot call tools, and the Copilot works only through them. Pick a model marked "tools" in the Copilot settings.`;
    }
    return `Ollama error ${e.status ?? ""}: ${message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

function describeOpenAIError(e: unknown, config: Pick<ChatConfig, "model" | "serverUrl">): string {
  const base = openaiBase(config.serverUrl ?? "");
  if (e instanceof Anthropic.APIConnectionError) return openaiUnreachableHint(base);
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { message?: string } | string } | undefined;
    const message = (typeof body?.error === "string" ? body.error : body?.error?.message) ?? e.message;
    if (e.status === 401 || e.status === 403) return `${base} refused the API key (${e.status}): ${message} Check the key in the Copilot settings.`;
    if (e.status === 429) return `${base} is rate-limiting this key: ${message} Wait a moment and try again.`;
    if (/context|too long|maximum.*tokens|token limit/i.test(message) && /length|exceed|maximum|limit|long/i.test(message)) {
      return `The server says the prompt is longer than ${config.model} takes: ${message} Set the context in the Copilot settings to what the model takes (the Copilot then shortens old results to fit), or start a new conversation.`;
    }
    if (e.status === 404 || /model.*(not found|does not exist)|unknown model/i.test(message)) return `${base} has no model "${config.model}": ${message} Pick another in the Copilot settings.`;
    if (/tool|function/i.test(message) && /support/i.test(message)) return `"${config.model}" cannot call tools on ${base}, and the Copilot works only through them: ${message}`;
    return `Server error ${e.status ?? ""} from ${base}: ${message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

function describeLmStudioError(e: unknown, config: Pick<ChatConfig, "model" | "serverUrl">): string {
  if (e instanceof Anthropic.APIConnectionError) return lmstudioUnreachableHint(config.serverUrl ?? "");
  if (e instanceof Anthropic.AuthenticationError) {
    return "LM Studio's server asks for an API token. Turn off Require Authentication in its server settings to use it from this page.";
  }
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { message?: string } | string; message?: string } | undefined;
    const message = (typeof body?.error === "string" ? body.error : body?.error?.message) ?? body?.message ?? e.message;
    if (/context/i.test(message) && /length|overflow|exceed|greater/i.test(message)) {
      return `The conversation no longer fits the context LM Studio loaded "${config.model}" with. Reload it with a context length of at least 32k (lms load ${config.model} --context-length 32768), or clear the conversation.`;
    }
    if (/not (found|loaded)|no model|does not exist/i.test(message)) {
      return `LM Studio could not run "${config.model}": ${message} Load it in LM Studio, or pick another in the Copilot settings.`;
    }
    return `LM Studio error ${e.status ?? ""}: ${message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
