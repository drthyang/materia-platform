/**
 * The Agent's state for the drawer: settings, the conversation, the tool
 * activity, and approvals waiting on the user. Lives in the app shell (always
 * mounted), so a call can ask for approval while the drawer is closed —
 * `onAttention` opens it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEntry, AgentExecutor, AgentHost, ToolRunner } from "@/agent/executor";
import type { ChatConfig, ChatEffort, AgentChat } from "@/agent/chat";
import { API_KEY_KEY, OPENAI_KEY_KEY, SETTINGS_KEY, migrateLegacyKeys } from "@/agent/storage";
import { DEFAULT_OPENAI_CONTEXT, OPENAI_PRESETS, isMachineUrl, openaiBase, presetForUrl } from "@/agent/openaiCompat";
import { DEFAULT_OLLAMA_URL } from "@/agent/ollama";
import { DEFAULT_LMSTUDIO_URL } from "@/agent/lmstudio";
import { TOOL_CARDS, cardsInReply, cardsInText, type AgentCard } from "@/agent/focus";
import { CHAT_MODELS } from "@/agent/chat-models";
import type { AgentReport } from "@/agent/report";

/**
 * How the Agent reaches a model: Anthropic two ways (an API key, or the dev
 * server's proxy), a local model on Ollama or LM Studio, or any
 * OpenAI-compatible server (OpenAI, Gemini, vLLM, llama.cpp, …).
 */
export type AgentMode = "api-key" | "proxy" | "ollama" | "lmstudio" | "openai-compatible";
export const AGENT_MODES: readonly AgentMode[] = ["api-key", "proxy", "ollama", "lmstudio", "openai-compatible"];

/** The provider a mode belongs to: one id per provider (Anthropic's two modes are one provider). */
export type AgentProvider = "anthropic" | "ollama" | "lmstudio" | "openai-compatible";
export const providerOf = (mode: AgentMode): AgentProvider => (mode === "api-key" || mode === "proxy" ? "anthropic" : mode);

export interface AgentSettings {
  readonly mode: AgentMode;
  readonly model: string;
  readonly effort: ChatEffort;
  /** Auto mode: changes run without an approval card, and the agent works
   *  through the method's stages on its own. Off (ask first) unless the user
   *  turns it on, for this session. */
  readonly autoApprove: boolean;
  /** Keep the API key in this browser's local storage, not just for the tab. */
  readonly rememberKey: boolean;
  /** Let the API answer a declined turn with another model (off: every turn stays on `model`). */
  readonly fallback: boolean;
  /** The Ollama server, and the model on it (kept apart from `model`, the Claude choice). */
  readonly ollamaUrl: string;
  readonly ollamaModel: string;
  /** The LM Studio server, and the model on it (its key). */
  readonly lmstudioUrl: string;
  readonly lmstudioModel: string;
  /** The OpenAI-compatible server: its preset (OPENAI_PRESETS id, "custom" for another), base URL (with its /v1), model. */
  readonly openaiPreset: string;
  readonly openaiUrl: string;
  readonly openaiModel: string;
  /** The context the OpenAI-compatible model takes, in tokens, used when the server does not say (it sizes every request; 128k or more offers every tool). */
  readonly openaiContext: number;
  /**
   * A recording that replays a live run this model took (a demo), "" in use:
   * every label names this model and the replay, never the server that
   * carries the replay. No setting shows it; a recording script sets it.
   */
  readonly replayOf: string;
}

export type TranscriptItem =
  | { readonly kind: "user"; readonly id: string; readonly text: string }
  | { readonly kind: "assistant"; readonly id: string; readonly text: string; readonly thinking: string }
  | { readonly kind: "tool"; readonly id: string; readonly entryId: string }
  | { readonly kind: "notice"; readonly id: string; readonly text: string; readonly tone: "info" | "error" };

export interface AgentController {
  readonly settings: AgentSettings;
  readonly updateSettings: (patch: Partial<AgentSettings>) => void;
  readonly apiKey: string;
  readonly setApiKey: (key: string) => void;
  /** The OpenAI-compatible server's key ("" for a server that needs none). Kept as Anthropic's is: the tab, or Remember. */
  readonly openaiKey: string;
  readonly setOpenaiKey: (key: string) => void;
  readonly transcript: readonly TranscriptItem[];
  readonly activity: Readonly<Record<string, ActivityEntry>>;
  /** Changes waiting for the user's decision. */
  readonly pending: readonly ActivityEntry[];
  readonly decide: (entryId: string, approve: boolean) => void;
  /** A chat turn is running. */
  readonly thinking: boolean;
  readonly send: (text: string) => void;
  readonly stop: () => void;
  readonly clear: () => void;
  readonly usage: { readonly input: number; readonly output: number; readonly cacheRead: number };
  /** The page cards the agent is on: a running tool's, the latest reply's, a hovered reply's. */
  readonly focus: readonly AgentCard[];
  /** A reply under the pointer (null when it leaves): its cards join the focus. */
  readonly hoverReply: (text: string | null) => void;
  /** The last report the Agent wrote (write_report); null before the first. */
  readonly report: AgentReport | null;
  /** The report viewer is open. */
  readonly reportOpen: boolean;
  readonly openReport: () => void;
  readonly closeReport: () => void;
}

/** How long the cards a finished reply names keep breathing. */
const MENTION_MS = 8000;

const KEY_KEY = API_KEY_KEY;
const DEFAULTS: AgentSettings = {
  mode: "api-key",
  model: "claude-opus-5-5",
  effort: "high",
  autoApprove: false,
  rememberKey: false,
  fallback: false,
  ollamaUrl: DEFAULT_OLLAMA_URL,
  ollamaModel: "",
  lmstudioUrl: DEFAULT_LMSTUDIO_URL,
  lmstudioModel: "",
  openaiPreset: OPENAI_PRESETS[0]!.id,
  openaiUrl: OPENAI_PRESETS[0]!.baseUrl,
  openaiModel: "",
  openaiContext: DEFAULT_OPENAI_CONTEXT,
  replayOf: "",
};

let nextItem = 1;
const itemId = (): string => `t${nextItem++}`;

export function useAgent(host: AgentHost, onAttention: () => void): AgentController {
  const [settings, setSettings] = useState<AgentSettings>(readSettings);
  const [apiKey, setApiKeyState] = useState<string>(() => readKey(KEY_KEY));
  const [openaiKey, setOpenaiKeyState] = useState<string>(() => readKey(OPENAI_KEY_KEY));
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [activity, setActivity] = useState<Record<string, ActivityEntry>>({});
  const [thinking, setThinking] = useState(false);
  const [usage, setUsage] = useState({ input: 0, output: 0, cacheRead: 0 });
  const [report, setReport] = useState<AgentReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const approvals = useRef(new Map<string, (ok: boolean) => void>());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;
  const openaiKeyRef = useRef(openaiKey);
  openaiKeyRef.current = openaiKey;
  const attention = useRef(onAttention);
  attention.current = onAttention;

  // The executor (and the MATERIA tool handlers and zod behind it) loads on the
  // first call, so a session that never uses the Agent never downloads it.
  const executor = useMemo<ToolRunner>(() => {
    let loaded: Promise<AgentExecutor> | null = null;
    // The executor once loaded, for what is read synchronously (the page open).
    let instance: AgentExecutor | null = null;
    // A chunk that failed to load is asked for again next time, not remembered as failed.
    const load = (): Promise<AgentExecutor> =>
      (loaded ??= import("@/agent/executor").then(
        (m) =>
          (instance = new m.AgentExecutor(host, {
            approve: (entry, signal) => {
              // After Stop nothing is approved, and no new card appears.
              if (signal?.aborted) return Promise.resolve(false);
              // Auto approves every change but the ones only the user may make.
              if (settingsRef.current.autoApprove && !entry.alwaysAsk) return Promise.resolve(true);
              attention.current();
              return new Promise<boolean>((resolve) => {
                // Stop declines the card; a decision removes the listener (one per card would pile up).
                const onAbort = (): void => {
                  approvals.current.delete(entry.id);
                  resolve(false);
                };
                approvals.current.set(entry.id, (ok) => {
                  signal?.removeEventListener("abort", onAbort);
                  resolve(ok);
                });
                signal?.addEventListener("abort", onAbort, { once: true });
              });
            },
            onActivity: (entry) => {
              setActivity((a) => ({ ...a, [entry.id]: entry }));
              // A card joins the conversation as its call starts, in the same update
              // queue as the chat text: an effect would run after the next turn has
              // already begun and put the card below that turn's reply.
              setTranscript((t) => (t.some((i) => i.kind === "tool" && i.entryId === entry.id) ? t : [...t, { kind: "tool", id: itemId(), entryId: entry.id }]));
            },
            modelLabel: () => modelLabel(settingsRef.current),
            onReport: (r) => {
              setReport(r);
              setReportOpen(true);
            },
          })),
        (e: unknown) => {
          loaded = null;
          throw e;
        },
      ));
    return {
      run: async (name, input, signal) => (await load()).run(name, input, signal),
      newConversation: () => void loaded?.then((e) => e.newConversation()),
      heard: (text) => void load().then((e) => e.heard(text)),
      situation: async () => (await load()).situation(),
      fill: (text) => (instance ? instance.fill(text) : text),
      page: () => instance?.page() ?? null,
    };
  }, [host]);

  const updateSettings = useCallback((patch: Partial<AgentSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      writeSettings(next);
      if (patch.rememberKey !== undefined) {
        moveKey(KEY_KEY, next.rememberKey);
        moveKey(OPENAI_KEY_KEY, next.rememberKey);
      }
      return next;
    });
  }, []);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    storeKey(KEY_KEY, key, settingsRef.current.rememberKey);
  }, []);

  const setOpenaiKey = useCallback((key: string) => {
    setOpenaiKeyState(key);
    storeKey(OPENAI_KEY_KEY, key, settingsRef.current.rememberKey);
  }, []);

  const decide = useCallback((entryId: string, ok: boolean) => {
    const resolve = approvals.current.get(entryId);
    approvals.current.delete(entryId);
    resolve?.(ok);
  }, []);

  // ── the in-app chat ─────────────────────────────────────────────────────
  const chat = useRef<AgentChat | null>(null);
  const turn = useRef<AbortController | null>(null);

  const send = useCallback((text: string) => {
    const message = text.trim();
    if (!message || turn.current) return;
    // The mode is read at every model turn, so switching Ask first / Auto
    // mid-run reaches the model as it reaches the approval cards.
    const config: ChatConfig = Object.defineProperty({ ...chatConfig(settingsRef.current, settingsRef.current.mode === "openai-compatible" ? openaiKeyRef.current : apiKeyRef.current) }, "autonomy", {
      get: (): "auto" | "ask" => (settingsRef.current.autoApprove ? "auto" : "ask"),
      enumerable: true,
    });
    const ctrl = new AbortController();
    turn.current = ctrl;
    setThinking(true);
    setTranscript((t) => [...t, { kind: "user", id: itemId(), text: message }]);
    let current: string | null = null;
    // The reply as it streams, kept here too: its {{references}} are filled from the page when the message ends, before its tools run.
    let currentText = "";
    const patchAssistant = (fn: (item: { text: string; thinking: string }) => { text: string; thinking: string }): void => {
      const id = current;
      if (!id) return;
      setTranscript((t) => t.map((i) => (i.id === id && i.kind === "assistant" ? { ...i, ...fn(i) } : i)));
    };
    void (async () => {
      let mod: typeof import("@/agent/chat") | null = null;
      try {
        // Loaded on first use: the SDK and the system prompt stay out of the main bundle.
        // Inside the try: a chunk that fails to load must not leave the turn running.
        mod = await import("@/agent/chat");
        chat.current ??= new mod.AgentChat(executor);
        await chat.current.send(
          message,
          config,
          {
            onAssistantStart: () => {
              const id = itemId();
              current = id;
              currentText = "";
              setTranscript((t) => [...t, { kind: "assistant", id, text: "", thinking: "" }]);
            },
            onText: (d) => {
              currentText += d;
              patchAssistant((i) => ({ text: i.text + d, thinking: i.thinking }));
            },
            onAssistantEnd: () => {
              // Numbers by reference: the values as they stand now, kept with the reply.
              const filled = executor.fill ? executor.fill(currentText) : currentText;
              if (filled !== currentText) patchAssistant((i) => ({ text: filled, thinking: i.thinking }));
            },
            onThinking: (d) => patchAssistant((i) => ({ text: i.text, thinking: i.thinking + d })),
            onNotice: (msg, tone) => setTranscript((t) => [...t, { kind: "notice", id: itemId(), text: msg, tone }]),
            onUsage: (u) =>
              setUsage((x) => ({
                input: x.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
                output: x.output + (u.output_tokens ?? 0),
                cacheRead: x.cacheRead + (u.cache_read_input_tokens ?? 0),
              })),
          },
          ctrl.signal,
        );
      } catch (e) {
        const text = mod ? mod.describeChatError(e, config) : `The Copilot could not load (${e instanceof Error ? e.message : String(e)}). Check the connection and send again.`;
        setTranscript((t) => [...t, { kind: "notice", id: itemId(), text, tone: "error" }]);
      } finally {
        turn.current = null;
        setThinking(false);
        // Drop empty assistant bubbles left by tool-only turns.
        setTranscript((t) => t.filter((i) => !(i.kind === "assistant" && !i.text && !i.thinking)));
      }
    })();
  }, [executor]);

  const stop = useCallback(() => {
    turn.current?.abort();
    // A stopped turn declines what it was waiting on.
    for (const resolve of approvals.current.values()) resolve(false);
    approvals.current.clear();
  }, []);

  const clear = useCallback(() => {
    if (turn.current) return;
    chat.current = null;
    executor.newConversation?.();
    // A change still waiting for approval keeps its card, or its call would hang unseen.
    const waiting = Object.values(activity).filter((e) => e.status === "waiting");
    setTranscript(waiting.map((e) => ({ kind: "tool", id: itemId(), entryId: e.id })));
    setActivity(Object.fromEntries(waiting.map((e) => [e.id, e])));
    setUsage({ input: 0, output: 0, cacheRead: 0 });
  }, [activity, executor]);

  const pending = Object.values(activity).filter((e) => e.status === "waiting");

  // ── where the agent is on the page ─────────────────────────────────────
  const [hover, setHover] = useState<readonly AgentCard[]>([]);
  const [mentionLive, setMentionLive] = useState(false);
  const lastReply = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const item = transcript[i]!;
      if (item.kind === "assistant" && item.text) return item.text;
    }
    return "";
  }, [transcript]);
  // A reply's cards breathe while it streams and for a while after.
  useEffect(() => {
    if (thinking) {
      setMentionLive(true);
      return;
    }
    const timer = setTimeout(() => setMentionLive(false), MENTION_MS);
    return () => clearTimeout(timer);
  }, [thinking, lastReply]);
  const focus = useMemo(() => {
    const cards = new Set<AgentCard>();
    for (const e of Object.values(activity)) {
      if (e.status === "running" || e.status === "waiting") for (const c of TOOL_CARDS[e.tool] ?? []) cards.add(c);
    }
    if (mentionLive) for (const c of cardsInReply(lastReply)) cards.add(c);
    for (const c of hover) cards.add(c);
    return [...cards].sort();
  }, [activity, mentionLive, lastReply, hover]);
  const hoverReply = useCallback((text: string | null) => setHover(text ? cardsInText(text) : []), []);

  const openReport = useCallback(() => setReportOpen(true), []);
  const closeReport = useCallback(() => setReportOpen(false), []);

  return { settings, updateSettings, apiKey, setApiKey, openaiKey, setOpenaiKey, transcript, activity, pending, decide, thinking, send, stop, clear, usage, focus, hoverReply, report, reportOpen, openReport, closeReport };
}

/** The model and how it is reached, as a report names it. */
export function modelLabel(s: AgentSettings): string {
  if (s.replayOf) return replayLabel(s.replayOf);
  if (s.mode === "ollama") return `${s.ollamaModel || "a local model"} · Ollama (local)`;
  if (s.mode === "lmstudio") return `${s.lmstudioModel || "a local model"} · LM Studio (local)`;
  if (s.mode === "openai-compatible") {
    const where = presetForUrl(s.openaiUrl)?.label ?? (() => {
      try {
        return new URL(openaiBase(s.openaiUrl)).host;
      } catch {
        return "an OpenAI-compatible server";
      }
    })();
    return `${s.openaiModel || "a model"} · ${where}${isMachineUrl(s.openaiUrl) ? " (local)" : ""}`;
  }
  const name = CHAT_MODELS.find((m) => m.id === s.model)?.label ?? s.model;
  return `${name} · ${s.mode === "proxy" ? "local proxy" : "Anthropic API"}`;
}

/** A replayed run's label: the model that took it live, and that this is its replay. */
export const replayLabel = (model: string): string => `${model} · replay of a live run`;

/** What one chat message runs on, from the settings. */
function chatConfig(s: AgentSettings, apiKey: string): ChatConfig {
  const autonomy = s.autoApprove ? "auto" : "ask";
  if (s.mode === "ollama") return { transport: "ollama", serverUrl: s.ollamaUrl, model: s.ollamaModel, effort: s.effort, autonomy };
  if (s.mode === "lmstudio") return { transport: "lmstudio", serverUrl: s.lmstudioUrl, model: s.lmstudioModel, effort: s.effort, autonomy };
  if (s.mode === "openai-compatible") return { transport: "openai-compatible", serverUrl: s.openaiUrl, ...(apiKey ? { apiKey } : {}), model: s.openaiModel, effort: s.effort, autonomy, context: s.openaiContext };
  return { transport: s.mode === "proxy" ? "proxy" : "api-key", apiKey, model: s.model, effort: s.effort, fallback: s.fallback, autonomy };
}

// ── storage (guarded: private windows and blocked site data throw) ─────────

/**
 * The stored settings, read as often as the page asks for them. A replay's
 * label is for this load only: taken out of storage at the first read, and
 * kept here for the reads after it in the same load (React's StrictMode reads
 * the settings twice in development, where the replays run).
 */
export function settingsReader(): (store: Pick<Storage, "getItem" | "setItem">) => AgentSettings {
  let replayThisLoad = "";
  return (store) => {
    const s = settingsFrom(store.getItem(SETTINGS_KEY));
    if (s.replayOf) {
      replayThisLoad = s.replayOf;
      store.setItem(SETTINGS_KEY, JSON.stringify(savedSettings(s)));
      return s;
    }
    return replayThisLoad ? { ...s, replayOf: replayThisLoad } : s;
  };
}

const readStored = settingsReader();

function readSettings(): AgentSettings {
  try {
    migrateLegacyKeys(localStorage, sessionStorage);
    return readStored(localStorage);
  } catch {
    return DEFAULTS;
  }
}

/**
 * The stored settings over the defaults. Only known keys come back, and a mode
 * this version no longer has (the Claude Code bridge, removed) falls back to
 * the default.
 */
export function settingsFrom(raw: string | null): AgentSettings {
  if (!raw) return DEFAULTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULTS;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
  const stored = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof AgentSettings)[]) {
    if (typeof stored[k] === typeof DEFAULTS[k]) out[k] = stored[k];
  }
  if (!AGENT_MODES.includes(out.mode as AgentMode)) out.mode = DEFAULTS.mode;
  // Auto-approve is a per-session choice: it never comes back on by itself.
  out.autoApprove = false;
  return out as unknown as AgentSettings;
}

/**
 * What is saved of the settings: neither auto-approve (a per-session choice)
 * nor a replay's label (a recording sets it for one load; saved, it would
 * call every later live run a replay).
 */
export function savedSettings(s: AgentSettings): Omit<AgentSettings, "autoApprove" | "replayOf"> {
  const { autoApprove: _auto, replayOf: _replay, ...kept } = s;
  return kept;
}

function writeSettings(s: AgentSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(savedSettings(s)));
  } catch {
    // Not remembered; the session still uses it.
  }
}

function readKey(name: string): string {
  try {
    migrateLegacyKeys(localStorage, sessionStorage);
    return sessionStorage.getItem(name) ?? localStorage.getItem(name) ?? "";
  } catch {
    return "";
  }
}

function storeKey(name: string, key: string, remember: boolean): void {
  try {
    sessionStorage.removeItem(name);
    localStorage.removeItem(name);
    if (!key) return;
    (remember ? localStorage : sessionStorage).setItem(name, key);
  } catch {
    // Kept in memory for this page only.
  }
}

function moveKey(name: string, remember: boolean): void {
  const key = readKey(name);
  if (key) storeKey(name, key, remember);
}
