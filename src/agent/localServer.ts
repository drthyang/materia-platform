/**
 * What the two local-model servers (Ollama, LM Studio) share. Both answer the
 * Anthropic Messages API at `<server>/v1/messages`, so the chat loop (chat.ts)
 * drives them with the same SDK, tools and executor as Claude, straight from
 * this browser. Nothing leaves this machine.
 *
 * Kept free of the SDK so the drawer can list models without loading it.
 */

/**
 * The Agent's instructions alone are about 15k tokens (the system prompt with
 * the user's method and two reference notes), plus the tool list and the
 * conversation. Below this, the model is likely to lose the start of it.
 */
export const MIN_AGENT_CONTEXT = 32_768;

/** The server address with no trailing slash (the SDK and `fetch` add the paths). */
export function serverBase(url: string, fallback: string): string {
  return (url.trim() || fallback).replace(/\/+$/, "");
}

/** The headers a local server's CORS rules let a page send, and all a request to it needs. */
const PLAIN_HEADERS = ["content-type", "accept"];

/**
 * `fetch` for the SDK, sending only plain headers. The SDK's own (`x-api-key`,
 * `anthropic-version`, `anthropic-beta`, `x-stainless-*`) would fail a local
 * server's CORS preflight, and neither server needs them.
 */
export function plainFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const given = new Headers(init?.headers);
  const headers = new Headers();
  for (const h of PLAIN_HEADERS) {
    const v = given.get(h);
    if (v !== null) headers.set(h, v);
  }
  return globalThis.fetch(input, { ...init, headers });
}

/** GET (or POST `body` as JSON) and parse the answer; throws on a network error or a non-2xx status. */
export async function getJson(url: string, body: unknown, signal: AbortSignal | undefined): Promise<unknown> {
  const init: RequestInit = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  if (signal) init.signal = signal;
  const res = await globalThis.fetch(url, init);
  if (!res.ok) throw new HttpError(url, res.status);
  return res.json();
}

export class HttpError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`${url} answered ${status}`);
  }
}

/** The page is served from this machine (localhost, 127.0.0.1 or [::1]). */
export function isMachineOrigin(pageOrigin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(pageOrigin);
}

/** What a local server's model could run with, for a conversation that no longer fits its window. */
export interface ContextAdviceInput {
  readonly server: "LM Studio" | "Ollama";
  readonly model: string;
  /** Tokens the conversation needs, its reply included. */
  readonly needed: number;
  /** The window it runs with now. */
  readonly current: number;
  /** The longest context the model takes (null: the server does not say). */
  readonly max: number | null;
  /** Memory free for a larger window, in bytes (null: the server does not say; neither LM Studio nor Ollama tells a page). */
  readonly freeBytes?: number | null;
  /** The KV cache's bytes per token of context (null: not known). */
  readonly kvBytesPerToken?: number | null;
}

const kTok = (n: number): string => `${Math.round(n / 1024)}k`;
const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * The next step for a conversation that no longer fits the window: the
 * smallest larger window that holds it (a multiple of 16k), whether the model
 * takes it, and whether the machine has the memory for its KV cache where
 * that is known. Ollama needs no reload (the chat sets num_ctx itself, up to
 * the model's maximum), so for it only the maximum is advice. Never a reload
 * button: a model another program uses must not be unloaded from here.
 */
export function contextAdvice(i: ContextAdviceInput): { readonly size: number | null; readonly text: string } {
  const size = Math.ceil(i.needed / 16384) * 16384;
  const needs = `This conversation needs about ${kTok(i.needed)} tokens`;
  if (i.max !== null && size > i.max) {
    return { size: null, text: `${needs}; ${i.model} takes at most ${kTok(i.max)}. Start a new conversation (the analysis stays as it is), or pick a model with a longer context.` };
  }
  if (i.server === "Ollama") return { size, text: `${needs}. Start a new conversation (the analysis stays as it is).` };
  const takes = i.max !== null ? `${i.model} takes up to ${kTok(i.max)}` : `${i.model} may take more than ${kTok(i.current)}`;
  const extra = i.kvBytesPerToken ? (size - i.current) * i.kvBytesPerToken : null;
  const reload = `Reload it at ${kTok(size)} in LM Studio (eject it, then load it with Context Length ${size}, or lms unload ${i.model} && lms load ${i.model} --context-length ${size}), or start a new conversation (the analysis stays as it is).`;
  if (extra !== null && i.freeBytes != null) {
    return extra <= i.freeBytes
      ? { size, text: `${needs}; ${takes}, and this machine has room for ${kTok(size)} (about ${gb(extra)} more). ${reload}` }
      : { size: null, text: `${needs}; ${takes}, but ${kTok(size)} needs about ${gb(extra)} more memory and this machine has ${gb(i.freeBytes)} free. Start a new conversation (the analysis stays as it is).` };
  }
  return { size, text: `${needs}; ${takes}, if this machine has the memory for it${extra !== null ? ` (about ${gb(extra)} more)` : ""}. ${reload}` };
}
