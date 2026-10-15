/**
 * The Agent drawer: the conversation with the model, every tool call as a
 * card, and an approval card for each change waiting on the user. It sits beside the page, not over
 * it, so the plot and the parameter panel stay in view while the model works.
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { color, fz, mono, radius } from "@/app/theme";
import { tableRows } from "@/agent/ui/markdownTable";
import type { ActivityEntry } from "@/agent/executor";
import type { MethodProgress } from "@/agent/method";
import { isScriptedReplay, providerOf, replayLabel, type AgentController, type AgentMode, type AgentProvider, type AgentSettings, type TranscriptItem } from "@/agent/useAgent";
import { OPENAI_PRESETS, isMachineUrl, listOpenAIModels, openaiBase, openaiUnreachableHint, presetForUrl, type OpenAIModel } from "@/agent/openaiCompat";
import { CHAT_MODELS, hasRefusalFallback } from "@/agent/chat-models";
import { listOllamaModels, unreachableHint, type OllamaModel } from "@/agent/ollama";
import { listLmStudioModels, lmstudioUnreachableHint, type LmStudioModel } from "@/agent/lmstudio";
import { MIN_AGENT_CONTEXT } from "@/agent/localServer";
import { cardsInReply, type AgentCard } from "@/agent/focus";
import { MATH_SPAN_SOURCE, mathInside, texPieces } from "@/agent/ui/texText";
import { DRAWER_MAX, DRAWER_MIN, KEY_STEP, SHEET_DEFAULT, SHEET_MAX, SHEET_MIN, SHEET_QUERY, clampDrawerWidth, clampSheet, readDrawerWidth, readSheet, sheetFor, writeDrawerWidth, writeSheet } from "@/agent/ui/drawerWidth";
import { cssZoom } from "@/app/ui/cssZoom";

interface Props {
  readonly agent: AgentController;
  /** The open page's method and how far along it is (null with no page open). */
  readonly method?: MethodProgress | null;
  readonly onClose: () => void;
}

const MODE_LABEL: Record<AgentMode, string> = { "api-key": "API key", proxy: "Local proxy", ollama: "Ollama", lmstudio: "LM Studio", "openai-compatible": "OpenAI-compatible" };

/**
 * The providers the settings offer, local ones first. A provider owns one or
 * more connection modes (providerOf, useAgent.ts); a new provider is one more
 * entry here and its own settings block below. "OpenAI-compatible" is any
 * server that speaks OpenAI's API: OpenAI, Gemini, vLLM, a llama.cpp server.
 */
const PROVIDERS: readonly { readonly id: AgentProvider; readonly label: string; readonly title?: string; readonly modes: readonly AgentMode[] }[] = [
  { id: "ollama", label: "Ollama", modes: ["ollama"] },
  { id: "lmstudio", label: "LM Studio", modes: ["lmstudio"] },
  { id: "anthropic", label: "Anthropic", modes: ["api-key", "proxy"] },
  { id: "openai-compatible", label: "OpenAI API", title: "Any server that speaks OpenAI's API: OpenAI, Gemini, vLLM, a llama.cpp server, …", modes: ["openai-compatible"] },
];

/** The one-line privacy note under each provider. */
const LOCAL_NOTE = "Runs on this machine; nothing leaves it.";
const cloudNote = (provider: string): string => `Sent to ${provider} and billed to your key; not saved in projects or reports.`;

/** The model a server the user picks from will use ("" with none picked); null for Anthropic's modes. */
function localModel(s: AgentSettings): string | null {
  return s.mode === "ollama" ? s.ollamaModel : s.mode === "lmstudio" ? s.lmstudioModel : s.mode === "openai-compatible" ? s.openaiModel : null;
}

/** The OpenAI-compatible server needs a key the user has not given. */
const missingOpenAIKey = (s: AgentSettings, key: string): boolean => s.mode === "openai-compatible" && !key && (presetForUrl(s.openaiUrl)?.needsKey ?? false);

export function AgentDrawer({ agent, method = null, onClose }: Props): JSX.Element {
  const { settings } = agent;
  const [showSettings, setShowSettings] = useState(false);
  const needsSetup = (settings.mode === "api-key" && !agent.apiKey) || localModel(settings) === "" || missingOpenAIKey(settings, agent.openaiKey);
  // First open with nothing set up: show the settings.
  useEffect(() => {
    if (needsSetup) setShowSettings(true);
  }, [needsSetup]);

  const [width, setWidth] = useDrawerWidth();
  const [sheet, setSheet] = useSheetHeight();
  const sheetMode = useMediaQuery(SHEET_QUERY);
  const lowered = useSheetForFocus(sheetMode, sheet, agent.focus);
  const aside = useRef<HTMLElement>(null);
  const sized: CSSProperties = { ...drawer, ...(width === null ? {} : { ["--wb-agent-w" as string]: `${width}px` }), ["--wb-sheet-h" as string]: `calc(${((lowered ?? sheet) * 100).toFixed(1)}dvh / var(--ui-zoom))` };
  return (
    <aside ref={aside} className="wb-agent" data-mode={sheetMode ? "sheet" : "docked"} style={sized} aria-label="MATERIA Copilot">
      {sheetMode ? <SheetHandle fraction={sheet} onResize={setSheet} /> : <ResizeHandle drawer={aside} width={width} onResize={setWidth} />}
      {sheetMode ? (
        // The sheet is short: one row, the status a dot (its words in the tooltip), the model in the settings.
        <div style={{ ...head, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: "8px 12px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <SparkIcon />
            <b className="wb-agent-title">MATERIA Copilot</b>
            <span className="wb-agent-beta" title="A public beta: check what it does, as you would a new colleague's work">Beta</span>
            <StatusChip agent={agent} compact />
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <AutonomySwitch agent={agent} />
            {agent.report && <IconButton title="Open the analysis report" onClick={agent.openReport}><ReportIcon /></IconButton>}
            <IconButton title="Settings" active={showSettings} onClick={() => setShowSettings((v) => !v)}>⚙</IconButton>
            <IconButton title="Close the Copilot" onClick={onClose}>✕</IconButton>
          </span>
        </div>
      ) : (
        <div style={head}>
          <div style={headRow}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <SparkIcon />
              <b className="wb-agent-title">MATERIA Copilot</b>
              <span className="wb-agent-beta" title="A public beta: check what it does, as you would a new colleague's work">Beta</span>
            </span>
            <span style={{ display: "flex", gap: 4 }}>
              {agent.report && <IconButton title="Open the analysis report" onClick={agent.openReport}><ReportIcon /></IconButton>}
              <IconButton title="Settings" active={showSettings} onClick={() => setShowSettings((v) => !v)}>⚙</IconButton>
              <IconButton title="Close the Copilot" onClick={onClose}>✕</IconButton>
            </span>
          </div>
          <div style={{ ...headRow, flexWrap: "wrap", rowGap: 6 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 auto" }}>
              <StatusChip agent={agent} />
              <ModelSelect agent={agent} onSettings={() => setShowSettings(true)} />
            </span>
            <AutonomySwitch agent={agent} />
          </div>
        </div>
      )}
      {method && <MethodChecklist key={sheetMode ? "sheet" : "docked"} method={method} folded={sheetMode} />}
      {showSettings && <Settings agent={agent} />}
      <Transcript agent={agent} page={method?.skill ?? null} />
      <Composer agent={agent} disabled={needsSetup} compact={sheetMode} />
    </aside>
  );
}

// ── method ──────────────────────────────────────────────────────────────────

/** The checklist folded to one line: how many stages are done, and the next. */
export function methodSummary(method: MethodProgress): string {
  const required = method.stages.filter((st) => !st.optional);
  const done = required.filter((st) => st.done).length;
  return `${done} of ${required.length} done${method.next ? ` · next: ${method.next}` : ""}`;
}

/**
 * The page's method as a checklist: each stage done (✓) or not (○), the next
 * required one marked, the stages used only when the data call for them dim.
 * It folds to one line (open beside the page, folded in the sheet, where
 * height is short), and the user's choice holds while the drawer is open.
 */
function MethodChecklist({ method, folded: foldedAtFirst }: { method: MethodProgress; folded: boolean }): JSX.Element {
  const [folded, setFolded] = useState(foldedAtFirst);
  return (
    <div style={checklist} aria-label="Method progress">
      <button type="button" className="wb-agent-fold" aria-expanded={!folded} onClick={() => setFolded((f) => !f)} title={`The page's method: the skill ${method.skill}. ${folded ? "Show" : "Hide"} the stages`}>
        <span aria-hidden="true">{folded ? "▸" : "▾"}</span> Method
      </button>
      {folded
        ? <span style={{ color: color.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{methodSummary(method)}</span>
        : method.stages.map((st) => {
          const next = !st.done && st.label === method.next;
          return (
            <span
              key={st.id}
              style={{
                whiteSpace: "nowrap",
                color: st.done ? color.okInk : next ? color.primary : st.optional ? color.faintest : color.faint,
                fontWeight: next ? 600 : 500,
              }}
              title={st.done ? "Done" : next ? "Next" : st.optional ? "If the data call for it" : "Not yet"}
            >
              {st.done ? "✓" : "○"} {st.label}
            </span>
          );
        })}
    </div>
  );
}

// ── width ───────────────────────────────────────────────────────────────────

/** Whether a media query matches, following the window as it changes. */
function useMediaQuery(query: string): boolean {
  const get = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = (): void => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** The sheet's height as a share of the window (a portrait tablet, a phone), remembered by the browser. */
function useSheetHeight(): [number, (f: number, commit?: boolean) => void] {
  const [fraction, setFraction] = useState<number>(() => (typeof localStorage === "undefined" ? null : readSheet(localStorage)) ?? SHEET_DEFAULT);
  const update = (f: number, commit = true): void => {
    setFraction(clampSheet(f));
    if (commit && typeof localStorage !== "undefined") writeSheet(localStorage, f);
  };
  return [fraction, update];
}

/**
 * While the Agent points at a page card (agent.focus) in the sheet, the sheet
 * lowers, for now, so that card fits in the page above it (sheetFor); it goes
 * back to the user's height when the focus moves off. Null: no change.
 */
function useSheetForFocus(sheetMode: boolean, fraction: number, focus: readonly AgentCard[]): number | null {
  const [lowered, setLowered] = useState<number | null>(null);
  const key = focus.join(" ");
  useLayoutEffect(() => {
    if (!sheetMode || key === "") {
      setLowered(null);
      return;
    }
    const card = key.split(" ").map((c) => document.querySelector(`[data-agent-card="${c}"]`)).find((el): el is Element => el !== null);
    const page = document.querySelector(".wb-shell");
    if (!card || !page) return;
    const f = sheetFor(fraction, card.getBoundingClientRect().height, page.getBoundingClientRect().height, window.innerHeight / cssZoom());
    setLowered(f < fraction ? f : null);
    // The page scrolls to the card once the sheet has moved (or at once, if it stays).
    const show = (): void => card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const timer = window.setTimeout(show, f < fraction ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [sheetMode, fraction, key]);
  return lowered;
}

/** The sheet's top edge: drag (or ↑ / ↓) to make the conversation taller or the page. */
function SheetHandle({ fraction, onResize }: { fraction: number; onResize: (f: number, commit?: boolean) => void }): JSX.Element {
  const drag = useRef<{ y: number; f: number; last: number } | null>(null);
  const viewport = (): number => window.innerHeight / cssZoom();
  return (
    <div
      className="wb-agent-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the Copilot panel"
      aria-valuemin={Math.round(SHEET_MIN * 100)}
      aria-valuemax={Math.round(SHEET_MAX * 100)}
      aria-valuenow={Math.round(fraction * 100)}
      title="Drag to resize"
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, f: fraction, last: fraction };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = clampSheet(d.f + (d.y - e.clientY) / cssZoom() / viewport());
        onResize(d.last, false);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && d.last !== d.f) onResize(d.last);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const step = e.key === "ArrowUp" ? 0.04 : e.key === "ArrowDown" ? -0.04 : 0;
        if (step === 0) return;
        e.preventDefault();
        onResize(fraction + step);
      }}
    />
  );
}

/** The width the user dragged the drawer to (null: the default), remembered by the browser. */
function useDrawerWidth(): [number | null, (w: number | null, commit?: boolean) => void] {
  const [width, setWidth] = useState<number | null>(() => (typeof localStorage === "undefined" ? null : readDrawerWidth(localStorage)));
  const update = (w: number | null, commit = true): void => {
    setWidth(w);
    if (commit && typeof localStorage !== "undefined") writeDrawerWidth(localStorage, w);
  };
  return [width, update];
}

/**
 * The drawer's left edge: drag to resize, ← / → by a step, Enter or a double
 * click for the default width. Hidden where the drawer covers the page or docks
 * under it (workbench.css).
 */
function ResizeHandle({ drawer, width, onResize }: { drawer: RefObject<HTMLElement>; width: number | null; onResize: (w: number | null, commit?: boolean) => void }): JSX.Element {
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);
  // Widths are CSS px: under the large-screen UI zoom, screen px divide by it.
  const viewport = (): number => window.innerWidth / cssZoom();
  const current = (): number => (drawer.current ? drawer.current.getBoundingClientRect().width / cssZoom() : width ?? DRAWER_MIN);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const w = current();
    drag.current = { x: e.clientX, w, last: w };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    d.last = clampDrawerWidth(d.w + (d.x - e.clientX) / cssZoom(), viewport());
    onResize(d.last, false);
  };
  const onPointerUp = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d && d.last !== d.w) onResize(d.last);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
    if (step !== 0) {
      e.preventDefault();
      onResize(clampDrawerWidth(current() + step, viewport()));
    } else if (e.key === "Enter") {
      e.preventDefault();
      onResize(null);
    }
  };
  return (
    <div
      className="wb-agent-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the Copilot panel"
      aria-valuemin={DRAWER_MIN}
      aria-valuemax={DRAWER_MAX}
      aria-valuenow={Math.round(width ?? current())}
      title="Drag to resize · double-click for the default width"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onResize(null)}
      onKeyDown={onKeyDown}
    />
  );
}

// ── status ──────────────────────────────────────────────────────────────────

/**
 * How the Agent is connected, for the header's status line: the provider (or
 * the replay), and whether it can send. The model is the select beside it.
 */
export function connectionStatus(settings: AgentSettings, apiKey: string, openaiKey = ""): { readonly text: string; readonly ok: boolean; readonly title: string } {
  // A replay, short enough for the line; its tooltip and the report say what it replays.
  if (settings.replayOf) return { text: `${settings.replayOf} · replay`, ok: true, title: replayLabel(settings.replayOf) };
  if (settings.mode === "api-key" && !apiKey) return { text: "No API key", ok: false, title: "Add your Anthropic API key in the settings (⚙)" };
  const local = localModel(settings);
  if (missingOpenAIKey(settings, openaiKey)) return { text: `${presetForUrl(settings.openaiUrl)?.label ?? MODE_LABEL[settings.mode]} · no key`, ok: false, title: "Add the server's API key in the settings (⚙)" };
  if (local === "") return { text: `${MODE_LABEL[settings.mode]} · no model`, ok: false, title: "Pick a model in the settings (⚙)" };
  if (settings.mode === "openai-compatible") {
    const where = presetForUrl(settings.openaiUrl)?.label ?? MODE_LABEL[settings.mode];
    return { text: where, ok: true, title: `${where}: ${isMachineUrl(settings.openaiUrl) ? LOCAL_NOTE : cloudNote(where)}` };
  }
  const where = settings.mode === "api-key" ? "Anthropic API" : MODE_LABEL[settings.mode];
  return { text: where, ok: true, title: local === null ? `${where}: ${cloudNote("Anthropic")}` : `${where}: ${LOCAL_NOTE}` };
}

function StatusChip({ agent, compact = false }: { agent: AgentController; compact?: boolean }): JSX.Element {
  const { text, ok, title } = connectionStatus(agent.settings, agent.apiKey, agent.openaiKey);
  return (
    <span role="status" className={`wb-agent-status ${ok ? "is-ok" : "is-off"}`} title={compact ? `${text}. ${title}` : title} {...(compact ? { "aria-label": text } : {})}>
      <span className="wb-agent-status-dot" aria-hidden="true" />
      {!compact && text}
    </span>
  );
}

/**
 * The model, beside the status: Claude's models as a select; a local
 * server's model by name, which opens the settings (they list the server's
 * models); nothing for a replay, whose model is the recording.
 */
function ModelSelect({ agent, onSettings }: { agent: AgentController; onSettings: () => void }): JSX.Element | null {
  const { settings, updateSettings } = agent;
  if (settings.replayOf) return null;
  const local = localModel(settings);
  if (local !== null) {
    return (
      <button type="button" className="wb-agent-model" onClick={onSettings} title="Pick the model in the settings" aria-label={`Model: ${local || "none"}. Pick one in the settings`}>
        {local || "Pick a model"} ▾
      </button>
    );
  }
  return (
    <select className="wb-agent-model" aria-label="Model" title="Model" value={settings.model} onChange={(e) => updateSettings({ model: e.target.value })}>
      {CHAT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select>
  );
}

// ── settings ────────────────────────────────────────────────────────────────

function Settings({ agent }: { agent: AgentController }): JSX.Element {
  const { settings, updateSettings } = agent;
  const provider = providerOf(settings.mode);
  const cloud = settings.mode === "api-key" || settings.mode === "proxy";
  return (
    <div style={settingsBox}>
      <div style={segmented} role="radiogroup" aria-label="Model provider">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={provider === p.id}
            onClick={() => provider !== p.id && updateSettings({ mode: p.modes[0]! })}
            style={segment(provider === p.id)}
            {...(p.title ? { title: p.title } : {})}
          >
            {p.label}
          </button>
        ))}
      </div>
      {provider === "anthropic" && (
        <>
          <div style={segmented} role="radiogroup" aria-label="How to reach Anthropic">
            {(["api-key", "proxy"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={settings.mode === m} onClick={() => updateSettings({ mode: m })} style={segment(settings.mode === m)}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {settings.mode === "api-key" && (
            <>
              <label style={field}>
                <span style={fieldLabel}>Anthropic API key</span>
                <input style={input} type="password" autoComplete="off" placeholder="sk-ant-…" value={agent.apiKey} onChange={(e) => agent.setApiKey(e.target.value.trim())} spellCheck={false} />
              </label>
              <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={settings.rememberKey} onChange={(e) => updateSettings({ rememberKey: e.target.checked })} />
                <span style={{ fontSize: 12.5 }}>Remember on this device</span>
              </label>
            </>
          )}
          <p style={note}>{cloudNote("Anthropic")}</p>
        </>
      )}
      {settings.mode === "ollama" && <OllamaSettings agent={agent} />}
      {settings.mode === "lmstudio" && <LmStudioSettings agent={agent} />}
      {settings.mode === "openai-compatible" && <OpenAICompatSettings agent={agent} />}
      {cloud && (
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ ...field, flex: 1 }}>
            <span style={fieldLabel}>Model</span>
            <select style={input} value={settings.model} onChange={(e) => updateSettings({ model: e.target.value })}>
              {CHAT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label style={{ ...field, width: 110 }}>
            <span style={fieldLabel}>Effort</span>
            <select style={input} value={settings.effort} onChange={(e) => updateSettings({ effort: e.target.value as typeof settings.effort })}>
              {(["low", "medium", "high", "xhigh", "max"] as const).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </div>
      )}
      {cloud && hasRefusalFallback(settings.model) && (
        <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 6 }} title="Off: every turn stays on the chosen model, so a session can be reproduced. On: if the model declines a turn, the API answers it with another model, and the conversation says which.">
          <input type="checkbox" checked={settings.fallback} onChange={(e) => updateSettings({ fallback: e.target.checked })} />
          <span style={{ fontSize: 12.5 }}>Fall back to another model if this one declines</span>
        </label>
      )}
      <HowToConnect mode={settings.mode} />
    </div>
  );
}

/** The longer how-to for the chosen connection, folded away. */
function HowToConnect({ mode }: { mode: AgentMode }): JSX.Element {
  return (
    <details style={{ ...note, margin: 0 }}>
      <summary style={{ cursor: "pointer" }}>? How to connect a model</summary>
      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
        {mode === "api-key" && <span>The key goes only from this browser to api.anthropic.com. It is kept for this tab unless you tick Remember.</span>}
        {mode === "proxy" && (
          <span>
            The dev server forwards to the API with <code style={code}>ANTHROPIC_API_KEY</code> from where you ran <code style={code}>npm run dev</code> (or <code style={code}>.env.local</code>), so the key never reaches this page. Local only: the published site has no proxy.
          </span>
        )}
        {mode === "ollama" && (
          <span>
            Pull a model that can call tools (e.g. <code style={code}>ollama pull qwen3</code>). A page not served from this machine also needs <code style={code}>OLLAMA_ORIGINS</code> set to its address where Ollama runs.
          </span>
        )}
        {mode === "lmstudio" && (
          <span>
            Needs LM Studio 0.4.1 or later with its server running and <b>Enable CORS</b> on (Developer tab → server settings, or <code style={code}>lms server start --cors</code>).
          </span>
        )}
        {mode === "openai-compatible" && (
          <>
            <span>
              Any server that speaks OpenAI's API: its base URL (usually ending in <code style={code}>/v1</code>) and, if it needs one, a key. OpenAI and Gemini need a key from their consoles; vLLM (started with <code style={code}>--allowed-origins</code> for this page) and llama.cpp's server run on this machine with none.
            </span>
            <span>The key goes only to that server. It is kept for this tab unless you tick Remember.</span>
            <span>Every request is sized to the model's context: the server's own when it says, else the one set here. Below 128k the Copilot offers the tools of the method's stage; at 128k or more, all of them.</span>
          </>
        )}
        {(mode === "ollama" || mode === "lmstudio" || mode === "openai-compatible") && <span>A smaller model follows a long method less reliably than a large one: keep Ask first on until it has shown it follows yours.</span>}
      </div>
    </details>
  );
}

type ModelList<T> = { readonly status: "loading" } | { readonly status: "ok"; readonly models: readonly T[] } | { readonly status: "error"; readonly message: string };

/**
 * A local server's models, asked of the server itself whenever its address
 * changes (once typing pauses) or the user asks again. `onListed` gets each
 * fresh list, to keep or replace the chosen model.
 */
function useModelList<T>(url: string, list: (url: string, signal: AbortSignal) => Promise<T[]>, hint: (url: string) => string, onListed: (models: T[]) => void): { list: ModelList<T>; refresh: () => void } {
  const [state, setState] = useState<ModelList<T>>({ status: "loading" });
  const [round, setRound] = useState(0);
  const fresh = useRef({ list, hint, onListed });
  fresh.current = { list, hint, onListed };
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      fresh.current.list(url, ctrl.signal).then(
        (models) => {
          if (ctrl.signal.aborted) return;
          setState({ status: "ok", models });
          fresh.current.onListed(models);
        },
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          // A server that answered, but not as expected, says why; one that did not answer gets the setup hint.
          const answered = e instanceof Error && /did not answer as|needs LM Studio|refused the API key|answered \d+|did not list models/.test(e.message);
          setState({ status: "error", message: answered ? (e as Error).message : fresh.current.hint(url) });
        },
      );
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [url, round]);
  return { list: state, refresh: () => setRound((n) => n + 1) };
}

const kTokens = (n: number): string => `${Math.round(n / 1024)}k`;

/** The Ollama server and a model on it, listed from the server itself. */
function OllamaSettings({ agent }: { agent: AgentController }): JSX.Element {
  const { settings, updateSettings } = agent;
  const { list, refresh } = useModelList<OllamaModel>(
    settings.ollamaUrl,
    listOllamaModels,
    (url) => unreachableHint(url, window.location.origin),
    // Nothing chosen yet, or the choice is gone: take the first that can call tools.
    (models) => {
      if (!models.some((m) => m.tools && m.name === settings.ollamaModel)) updateSettings({ ollamaModel: models.find((m) => m.tools)?.name ?? "" });
    },
  );
  const models = list.status === "ok" ? list.models : [];
  const picked = models.find((m) => m.name === settings.ollamaModel);
  return (
    <>
      <label style={field}>
        <span style={fieldLabel}>Ollama server</span>
        <input style={input} value={settings.ollamaUrl} onChange={(e) => updateSettings({ ollamaUrl: e.target.value })} spellCheck={false} placeholder="http://localhost:11434" />
      </label>
      <ModelPicker label="Ollama model" list={list} value={picked ? settings.ollamaModel : ""} onChange={(v) => updateSettings({ ollamaModel: v })} onRefresh={refresh}>
        {models.map((m) => (
          <option key={m.name} value={m.name} disabled={!m.tools}>
            {[m.name, m.parameterSize, m.context ? `${kTokens(m.context)} context` : null, m.tools ? null : "no tools"].filter(Boolean).join(" · ")}
          </option>
        ))}
      </ModelPicker>
      {list.status === "error" && <p style={{ ...note, color: color.warnInk }}>{list.message}</p>}
      {list.status === "ok" && models.length > 0 && !models.some((m) => m.tools) && (
        <p style={{ ...note, color: color.warnInk }}>None of these models can call tools, and the Copilot works only through them. Pull one that can (e.g. <code style={code}>ollama pull qwen3</code>).</p>
      )}
      {list.status === "ok" && models.length === 0 && <p style={{ ...note, color: color.warnInk }}>The server has no models. Pull one that can call tools (e.g. <code style={code}>ollama pull qwen3</code>).</p>}
      {picked?.context != null && picked.context < MIN_AGENT_CONTEXT && (
        <p style={{ ...note, color: color.noteInk }}>This model takes {kTokens(picked.context)} tokens of context; the Copilot's instructions alone are about 15k. Expect it to lose track in a long session.</p>
      )}
      <p style={note}>{LOCAL_NOTE}</p>
    </>
  );
}

/** The LM Studio server and a model on it, listed from the server itself. */
function LmStudioSettings({ agent }: { agent: AgentController }): JSX.Element {
  const { settings, updateSettings } = agent;
  const { list, refresh } = useModelList<LmStudioModel>(
    settings.lmstudioUrl,
    listLmStudioModels,
    lmstudioUnreachableHint,
    // Nothing chosen yet, or the choice is gone: take the first trained for tools
    // and not loaded with too short a context (else the first trained, else the first).
    (models) => {
      if (models.some((m) => m.key === settings.lmstudioModel)) return;
      const roomy = (m: LmStudioModel): boolean => m.loadedContext == null || m.loadedContext >= MIN_AGENT_CONTEXT;
      updateSettings({ lmstudioModel: (models.find((m) => m.toolUse && roomy(m)) ?? models.find((m) => m.toolUse) ?? models[0])?.key ?? "" });
    },
  );
  const models = list.status === "ok" ? list.models : [];
  const picked = models.find((m) => m.key === settings.lmstudioModel);
  return (
    <>
      <label style={field}>
        <span style={fieldLabel}>LM Studio server</span>
        <input style={input} value={settings.lmstudioUrl} onChange={(e) => updateSettings({ lmstudioUrl: e.target.value })} spellCheck={false} placeholder="http://localhost:1234" />
      </label>
      <ModelPicker label="LM Studio model" list={list} value={picked ? settings.lmstudioModel : ""} onChange={(v) => updateSettings({ lmstudioModel: v })} onRefresh={refresh}>
        {models.map((m) => (
          <option key={m.key} value={m.key}>
            {[m.key, m.parameterSize, m.loadedContext != null ? `loaded, ${kTokens(m.loadedContext)} context` : "not loaded", m.toolUse ? null : "not trained for tools"].filter(Boolean).join(" · ")}
          </option>
        ))}
      </ModelPicker>
      {list.status === "error" && <p style={{ ...note, color: color.warnInk }}>{list.message}</p>}
      {list.status === "ok" && models.length === 0 && <p style={{ ...note, color: color.warnInk }}>LM Studio has no language models. Download one trained for tool use (e.g. Qwen3) in its Discover tab.</p>}
      {picked && !picked.toolUse && (
        <p style={{ ...note, color: color.noteInk }}>This model was not trained for tool use. LM Studio still offers it the tools, but it may call them poorly; one marked for tool use works better.</p>
      )}
      {picked?.loadedContext != null && picked.loadedContext < MIN_AGENT_CONTEXT && (
        <p style={{ ...note, color: color.noteInk }}>
          LM Studio loaded this model with {kTokens(picked.loadedContext)} tokens of context; the Copilot's instructions alone are about 15k, so it will not send to it. Eject the model in LM Studio and the Copilot loads it with 32k on your next message (or <code style={code}>lms load {picked.key} --context-length 32768</code>{picked.maxContext != null && picked.maxContext < MIN_AGENT_CONTEXT ? `; it takes at most ${kTokens(picked.maxContext)}` : ""}).
        </p>
      )}
      {picked && picked.loadedContext == null && (
        <p style={note}>Not loaded yet: the Copilot loads it with a 32k context on your first message.</p>
      )}
      <p style={note}>{LOCAL_NOTE}</p>
    </>
  );
}

/**
 * Any OpenAI-compatible server: a preset (or another address), the base URL,
 * the key when it needs one, a model from its list, and the context the
 * model takes when the server does not say.
 */
export function OpenAICompatSettings({ agent }: { agent: AgentController }): JSX.Element {
  const { settings, updateSettings } = agent;
  const preset = presetForUrl(settings.openaiUrl);
  // The list is asked again when the address or the key changes.
  const sep = "\u0000";
  const { list, refresh } = useModelList<OpenAIModel>(
    `${settings.openaiUrl}${sep}${agent.openaiKey}`,
    (both, signal) => {
      const [url, key] = both.split(sep);
      return listOpenAIModels(url ?? "", key || undefined, signal);
    },
    (both) => openaiUnreachableHint(both.split(sep)[0] ?? ""),
    (models) => {
      if (!models.some((m) => m.id === settings.openaiModel)) updateSettings({ openaiModel: models[0]?.id ?? "" });
    },
  );
  const models = list.status === "ok" ? list.models : [];
  const picked = models.find((m) => m.id === settings.openaiModel);
  const local = isMachineUrl(settings.openaiUrl);
  let where = "the server";
  try {
    where = preset?.label ?? new URL(openaiBase(settings.openaiUrl)).host;
  } catch {
    // An address still being typed.
  }
  return (
    <>
      <label style={field}>
        <span style={fieldLabel}>Server</span>
        <select
          style={input}
          value={preset?.id ?? "custom"}
          onChange={(e) => {
            const next = OPENAI_PRESETS.find((p) => p.id === e.target.value);
            updateSettings({ openaiPreset: e.target.value, ...(next?.baseUrl ? { openaiUrl: next.baseUrl, openaiModel: "" } : {}) });
          }}
        >
          {OPENAI_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label style={field}>
        <span style={fieldLabel}>Base URL</span>
        <input style={input} value={settings.openaiUrl} onChange={(e) => updateSettings({ openaiUrl: e.target.value.trim(), openaiPreset: presetForUrl(e.target.value)?.id ?? "custom" })} spellCheck={false} placeholder="https://api.openai.com/v1" />
      </label>
      <label style={field}>
        <span style={fieldLabel}>API key{preset?.needsKey ? "" : " (if the server needs one)"}</span>
        <input style={input} type="password" autoComplete="off" placeholder={preset?.needsKey ? "sk-…" : "none"} value={agent.openaiKey} onChange={(e) => agent.setOpenaiKey(e.target.value.trim())} spellCheck={false} />
      </label>
      {agent.openaiKey && (
        <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={settings.rememberKey} onChange={(e) => updateSettings({ rememberKey: e.target.checked })} />
          <span style={{ fontSize: 12.5 }}>Remember on this device</span>
        </label>
      )}
      <ModelPicker label="Model on the server" list={list} value={picked ? settings.openaiModel : ""} onChange={(v) => updateSettings({ openaiModel: v })} onRefresh={refresh}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {[m.id, m.context ? `${kTokens(m.context)} context` : null].filter(Boolean).join(" · ")}
          </option>
        ))}
      </ModelPicker>
      {list.status === "error" && <p style={{ ...note, color: color.warnInk }}>{list.message}</p>}
      <label style={field} title="The longest prompt the model takes. Every request is sized to it, old results shortened to fit; a prompt that cannot fit is refused, never sent cut. Used when the server does not say its own.">
        <span style={fieldLabel}>Context (tokens){picked?.context ? ` · the server says ${kTokens(picked.context)}` : ""}</span>
        <input
          style={input}
          type="number"
          min={8192}
          step={1024}
          disabled={!!picked?.context}
          value={picked?.context ?? settings.openaiContext}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n) && n >= 4096) updateSettings({ openaiContext: n });
          }}
        />
      </label>
      {(picked?.context ?? settings.openaiContext) < MIN_AGENT_CONTEXT && (
        <p style={{ ...note, color: color.noteInk }}>The Copilot's instructions alone are about 15k tokens: below 32k, expect it to refuse long sessions.</p>
      )}
      <p style={note}>{local ? LOCAL_NOTE : cloudNote(where)}</p>
    </>
  );
}

/** A local server's model list, with a button to ask again. */
function ModelPicker<T>({ label, list, value, onChange, onRefresh, children }: { label: string; list: ModelList<T>; value: string; onChange: (v: string) => void; onRefresh: () => void; children: ReactNode }): JSX.Element {
  const empty = list.status !== "ok" || list.models.length === 0;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
      <label style={{ ...field, flex: 1, minWidth: 0 }}>
        <span style={fieldLabel}>Model</span>
        <select style={input} value={value} disabled={empty} onChange={(e) => onChange(e.target.value)} aria-label={label}>
          {empty && <option value="">{list.status === "loading" ? "Asking the server…" : "No models"}</option>}
          {children}
        </select>
      </label>
      <IconButton title="List the server's models again" onClick={onRefresh}>↻</IconButton>
    </div>
  );
}

// ── transcript ──────────────────────────────────────────────────────────────

function Transcript({ agent, page }: { agent: AgentController; page: string | null }): JSX.Element {
  const end = useRef<HTMLDivElement>(null);
  const items = agent.transcript;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items, agent.activity]);
  const ended = useEndTimes(agent.activity);
  // Each finished turn's verdict, after its last item: what its tools computed.
  const outcomes = turnOutcomes(items, agent.activity, agent.thinking);
  return (
    <div style={transcriptBox} aria-live="polite">
      {items.length === 0 && <EmptyState settings={agent.settings} page={page} />}
      {items.map((item) => (
        <Fragment key={item.id}>
          <Item item={item} agent={agent} ended={ended} />
          {outcomes.get(item.id) && <OutcomePill outcome={outcomes.get(item.id)!} />}
        </Fragment>
      ))}
      {agent.thinking && <div style={{ fontSize: 12.5, color: color.faint, padding: "0 2px" }}>Working…</div>}
      <div ref={end} />
    </div>
  );
}

/** The model the Agent talks to, as the settings name it. */
function modelName(s: AgentSettings): string {
  if (s.replayOf) return `${s.replayOf} (${isScriptedReplay(s.replayOf) ? "a scripted replay, not a live run" : "a replay of a live run"})`;
  if (s.mode === "ollama") return s.ollamaModel ? `${s.ollamaModel} (Ollama)` : "the Ollama model you pick";
  if (s.mode === "lmstudio") return s.lmstudioModel ? `${s.lmstudioModel} (LM Studio)` : "the LM Studio model you pick";
  if (s.mode === "openai-compatible") return s.openaiModel ? `${s.openaiModel} (${presetForUrl(s.openaiUrl)?.label ?? "OpenAI-compatible"})` : "the model you pick on your server";
  return CHAT_MODELS.find((m) => m.id === s.model)?.label ?? s.model;
}

/** What to ask, by page: its method's examples. */
const EXAMPLES: Readonly<Record<string, readonly string[]>> = {
  "my-rietveld-workflow": [
    "Refine this pattern by my method and report the structure.",
    "Why is the fit poor? Fix what you can.",
    "There are new peaks at low temperature: find the magnetic structure.",
    "Assess the fit and suggest what to free next.",
  ],
  "pdf-workflow": [
    "Refine this G(r) and report the local structure.",
    "Does the local structure differ from the average one?",
    "Assess the fit and suggest what to free next.",
  ],
  "sc-workflow": [
    "Read the data, then refine the structure and report it.",
    "Is extinction a problem here? Which reflections fit worst, and why?",
    "Are the anisotropic ADPs justified by these data?",
  ],
};

const DEFAULT_EXAMPLES = ["Assess the fit and suggest what to free next.", "Refine this from the start and report the result."];

export function EmptyState({ settings, page }: { settings: AgentSettings; page: string | null }): JSX.Element {
  const examples = ((page && EXAMPLES[page]) || DEFAULT_EXAMPLES).slice(0, 3);
  return (
    <div style={{ color: color.secondary, fontSize: fz.small, lineHeight: 1.5, padding: "6px 2px" }}>
      <p style={{ margin: "0 0 6px" }}>
        <b style={{ color: color.ink }}>{modelName(settings)}</b> works on this analysis with MATERIA's tools and reports the result.
      </p>
      <p style={{ margin: "0 0 6px" }}>
        {settings.autoApprove ? "Auto: it works on its own and stops when a decision is yours." : "Ask first: every change waits for your approval."} Each change is a History step.
      </p>
      <ul data-examples style={{ margin: 0, paddingLeft: 18 }}>
        {examples.map((e) => <li key={e}><i>“{e}”</i></li>)}
      </ul>
    </div>
  );
}

function Item({ item, agent, ended }: { item: TranscriptItem; agent: AgentController; ended: ReadonlyMap<string, number> }): JSX.Element | null {
  switch (item.kind) {
    case "user":
      return <div style={userBubble}>{item.text}</div>;
    case "assistant":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {item.thinking && (
            <details style={{ fontSize: fz.micro, color: color.faint }}>
              <summary style={{ cursor: "pointer" }}>Reasoning</summary>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{item.thinking}</div>
            </details>
          )}
          {item.text && (
            <div className="wb-agent-answer" onMouseEnter={() => agent.hoverReply(item.text)} onMouseLeave={() => agent.hoverReply(null)}>
              <div style={assistantText}><Markdown text={item.text} /></div>
              <CardChips text={item.text} onHover={(card) => agent.hoverReply(card ? CARD_WORD[card] : item.text)} />
            </div>
          )}
        </div>
      );
    case "tool": {
      const entry = agent.activity[item.entryId];
      return entry ? <ToolCard entry={entry} endedAt={ended.get(entry.id)} onDecide={agent.decide} {...(entry.tool === "write_report" && entry.status === "done" && agent.report ? { onOpenReport: agent.openReport } : {})} /> : null;
    }
    case "notice":
      return <div style={noticeStyle(item.tone)}>{item.text}</div>;
  }
}

const STATUS_TEXT: Record<ActivityEntry["status"], string> = { waiting: "Needs approval", running: "Running…", done: "Done", declined: "Declined", failed: "Failed" };

/** A duration as a step card shows it: 0.4 s, 12 s. */
export function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 100) return "<0.1 s";
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}

/**
 * One tool call, compact: a status dot, its title, the status and how long it
 * took, and the one line that matters (the preview while it waits, the
 * outcome after). A change waiting for approval keeps its Approve / Decline.
 */
function ToolCard({ entry, endedAt, onDecide, onOpenReport }: { entry: ActivityEntry; endedAt: number | undefined; onDecide: (id: string, ok: boolean) => void; onOpenReport?: () => void }): JSX.Element {
  const waiting = entry.status === "waiting";
  const took = endedAt !== undefined && entry.status !== "running" && !waiting ? formatDuration(endedAt - entry.at) : null;
  const meta = [STATUS_TEXT[entry.status], took].filter(Boolean).join(" · ");
  const line = waiting ? entry.preview : entry.outcome ?? entry.preview;
  return (
    <div className={`wb-agent-step is-${entry.status}`} data-tool={entry.tool} data-status={entry.status}>
      <div className="wb-agent-step-head">
        <span className="wb-agent-step-dot" aria-hidden="true" />
        <span className="wb-agent-step-label">{entry.title}</span>
        <span className="wb-agent-step-meta">{meta}</span>
      </div>
      {line && <div className="wb-agent-step-line" style={entry.tool === "refine" && !waiting ? { fontFamily: mono } : undefined}>{line}</div>}
      {onOpenReport && (
        <div style={{ marginTop: 6 }}>
          <button style={secondaryButton} onClick={onOpenReport}>Open the report</button>
        </div>
      )}
      {waiting && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button style={primaryButton} onClick={() => onDecide(entry.id, true)}>Approve</button>
          <button style={secondaryButton} onClick={() => onDecide(entry.id, false)}>Decline</button>
        </div>
      )}
    </div>
  );
}

/** When each tool call stopped running, seen as the activity changes: a step card's duration. */
function useEndTimes(activity: Readonly<Record<string, ActivityEntry>>): ReadonlyMap<string, number> {
  const ended = useRef(new Map<string, number>());
  for (const entry of Object.values(activity)) {
    if (entry.status !== "running" && entry.status !== "waiting" && !ended.current.has(entry.id)) ended.current.set(entry.id, Date.now());
  }
  return ended.current;
}

// ── outcome ─────────────────────────────────────────────────────────────────

export interface TurnOutcome {
  readonly status: "achieved" | "partial" | "not-achieved";
  readonly note: string;
}

const OUTCOME_TEXT: Record<TurnOutcome["status"], string> = { achieved: "Achieved", partial: "Partial", "not-achieved": "Not achieved" };

/**
 * A finished turn's verdict, from what its tools computed, not from what the
 * reply says: a refusal or a failed change is not achieved; a declined change,
 * or a refinement that stopped short of converging, is partial; a converged
 * refinement, or changes all made, achieved. A turn of reads and words alone
 * has none. Keyed by the turn's last item.
 */
export function turnOutcomes(items: readonly TranscriptItem[], activity: Readonly<Record<string, ActivityEntry>>, thinking: boolean): Map<string, TurnOutcome> {
  const out = new Map<string, TurnOutcome>();
  const turns: TranscriptItem[][] = [];
  for (const item of items) {
    if (item.kind === "user" || turns.length === 0) turns.push([]);
    turns[turns.length - 1]!.push(item);
  }
  turns.forEach((turn, t) => {
    if (thinking && t === turns.length - 1) return;
    const entries = turn.flatMap((i) => (i.kind === "tool" && activity[i.entryId] ? [activity[i.entryId]!] : []));
    const changes = entries.filter((e) => e.effect !== "read");
    if (changes.length === 0) return;
    const last = turn[turn.length - 1]!;
    const failed = changes.filter((e) => e.status === "failed");
    const declined = changes.filter((e) => e.status === "declined");
    const refines = changes.filter((e) => e.tool === "refine" && e.status === "done");
    const lastRefine = refines.at(-1);
    if (failed.length > 0) out.set(last.id, { status: "not-achieved", note: `${failed.at(-1)!.title}: ${failed.at(-1)!.outcome ?? "failed"}` });
    else if (declined.length > 0) out.set(last.id, { status: "partial", note: `${declined.length} change${declined.length === 1 ? "" : "s"} declined` });
    else if (lastRefine && !/^converged\b/.test(lastRefine.outcome ?? "")) out.set(last.id, { status: "partial", note: `the refinement ${lastRefine.outcome ?? "did not converge"}` });
    else out.set(last.id, { status: "achieved", note: lastRefine?.outcome ?? `${changes.length} change${changes.length === 1 ? "" : "s"} made` });
  });
  return out;
}

function OutcomePill({ outcome }: { outcome: TurnOutcome }): JSX.Element {
  return (
    <div className={`wb-agent-outcome is-${outcome.status}`} role="status">
      <span className="wb-agent-outcome-label">Outcome</span>
      <strong>{OUTCOME_TEXT[outcome.status]}</strong>
      <span className="wb-agent-outcome-note">{outcome.note}</span>
    </div>
  );
}

// ── card chips ──────────────────────────────────────────────────────────────

const CARD_LABEL: Record<AgentCard, string> = { structure: "Structure", data: "Data", instrument: "Instrument", pattern: "Plot", parameters: "Parameters", result: "Result" };
/** A word each card's own pattern (focus.ts) reads as that card alone: hovering a chip lights its card. */
const CARD_WORD: Record<AgentCard, string> = { structure: "structure", data: "dataset", instrument: "instrument", pattern: "plot", parameters: "parameters", result: "wR" };

/** The cards an answer points to, as chips: hover lights the card, a click brings it into view. */
function CardChips({ text, onHover }: { text: string; onHover: (card: AgentCard | null) => void }): JSX.Element | null {
  const cards = cardsInReply(text);
  if (cards.length === 0) return null;
  return (
    <div className="wb-agent-chips">
      {cards.map((card) => (
        <button
          key={card}
          type="button"
          className="wb-agent-chip"
          onMouseEnter={() => onHover(card)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(card)}
          onBlur={() => onHover(null)}
          onClick={() => document.querySelector(`[data-agent-card="${card}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
          title={`Show the ${CARD_LABEL[card].toLowerCase()} card`}
        >
          {CARD_LABEL[card]}
        </button>
      ))}
    </div>
  );
}

// ── input ───────────────────────────────────────────────────────────────────

function Composer({ agent, disabled, compact }: { agent: AgentController; disabled: boolean; compact: boolean }): JSX.Element {
  const [text, setText] = useState("");
  const submit = (): void => {
    if (!text.trim() || agent.thinking || disabled) return;
    agent.send(text);
    setText("");
  };
  const { usage } = agent;
  const used = usage.input + usage.output > 0;
  return (
    <div style={composer}>
      <div className="wb-agent-input">
        <textarea
          aria-label="Message the Copilot"
          rows={compact ? 1 : 2}
          placeholder={disabled ? (localModel(agent.settings) !== null ? "Pick a model in the settings first" : "Add your API key in the settings first") : "Ask anything, or ask it to run the analysis…"}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {agent.thinking
          ? <button type="button" className="wb-agent-send is-stop" onClick={agent.stop} aria-label="Stop" title="Stop"><StopGlyph /></button>
          : <button type="button" className="wb-agent-send" onClick={submit} disabled={disabled || !text.trim()} aria-label="Send" title="Send (Enter)"><ArrowGlyph /></button>}
      </div>
      <div className="wb-agent-foot">
        <span className="wb-agent-hint" title={used ? `${usage.input} input tokens (${usage.cacheRead} read from the cache) and ${usage.output} output tokens this session` : undefined}>
          {used ? `${fmtTokens(usage.input)} in · ${fmtTokens(usage.cacheRead)} cached · ${fmtTokens(usage.output)} out` : "Enter to send · Shift+Enter for a new line"}
        </span>
        {agent.transcript.length > 0 && !agent.thinking && (
          <button type="button" className="wb-agent-link" onClick={agent.clear}>New conversation</button>
        )}
      </div>
    </div>
  );
}

function ArrowGlyph(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden style={{ display: "block" }}>
      <path d="M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopGlyph(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ display: "block" }}>
      <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * Ask first: every change waits for approval, and the agent stops after each
 * stage. Auto: changes run without a card (still undoable History steps), and
 * the agent works through the stages, stopping at a failed stage or a decision
 * the method leaves to the user. Off again on reload.
 */
function AutonomySwitch({ agent }: { agent: AgentController }): JSX.Element {
  const auto = agent.settings.autoApprove;
  const option = (on: boolean, label: string, title: string): JSX.Element => (
    <button
      type="button"
      role="radio"
      aria-checked={auto === on}
      title={title}
      onClick={() => agent.updateSettings({ autoApprove: on })}
      style={{ border: "none", padding: "3px 9px", fontSize: 12, whiteSpace: "nowrap", cursor: "pointer", background: auto === on ? (on ? color.noteBg : color.primaryTintBg) : color.surface, color: auto === on ? (on ? color.noteInk : color.primary) : color.secondary, fontWeight: auto === on ? 600 : 500 }}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Approval mode" style={{ display: "flex", border: `1px solid ${color.control}`, borderRadius: radius.button, overflow: "hidden", flexShrink: 0 }}>
      {option(false, "Ask first", "Every change waits for your approval, and the agent stops after each stage of the method to report.")}
      {option(true, "Auto", "Changes run without an approval card (each is still a History step you can undo), and the agent works through the method's stages on its own, stopping at a failed stage or a decision that is yours. Back to Ask first on reload.")}
    </div>
  );
}

// ── small pieces ────────────────────────────────────────────────────────────

/** A safe, minimal Markdown subset: paragraphs, bullet/numbered lists, tables, **bold**, `code`, and inline $math$ read as text. */
function Markdown({ text }: { text: string }): JSX.Element {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const rows = tableRows(lines);
        if (rows) {
          const [head, ...body] = rows;
          return (
            <div key={i} style={{ overflowX: "auto", margin: "0 0 6px" }}>
              <table style={table}>
                <thead><tr>{head!.map((c, j) => <th key={j} style={th}>{inline(c)}</th>)}</tr></thead>
                <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} style={td}>{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]!);
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>);
          return ordered ? <ol key={i} style={list}>{items}</ol> : <ul key={i} style={list}>{items}</ul>;
        }
        if (/^#{1,4}\s/.test(block)) return <p key={i} style={{ margin: "0 0 6px", fontWeight: 600 }}>{inline(block.replace(/^#{1,4}\s/, ""))}</p>;
        return <p key={i} style={{ margin: "0 0 6px", whiteSpace: "pre-wrap" }}>{inline(block)}</p>;
      })}
    </>
  );
}

const INLINE_SOURCE = String.raw`(\*\*[^*]+\*\*|\`[^\`]+\`|${MATH_SPAN_SOURCE})`;

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE_SOURCE, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<b key={k++}>{inline(t.slice(2, -2))}</b>);
    else if (t.startsWith("`")) out.push(<code key={k++} style={code}>{t.slice(1, -1)}</code>);
    else out.push(<TexText key={k++} tex={mathInside(t)} />);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Inline TeX as plain text with sub- and superscripts (texText.ts). */
function TexText({ tex }: { tex: string }): JSX.Element {
  return (
    <>
      {texPieces(tex).map((p, i) => (p.script === "sub" ? <sub key={i}>{p.text}</sub> : p.script === "sup" ? <sup key={i}>{p.text}</sup> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

/** A page with lines: the report. */
function ReportIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden style={{ display: "block", margin: "0 auto" }}>
      <path d="M4 1.5h5.5L13 5v9.5H4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9.5 1.5V5H13M6 8h5M6 10.5h5M6 13h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconButton({ children, title, onClick, active, disabled }: { children: ReactNode; title: string; onClick: () => void; active?: boolean; disabled?: boolean }): JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      style={{ border: `1px solid ${active ? color.primaryTintBorder : "transparent"}`, background: active ? color.primaryTintBg : "transparent", color: disabled ? color.faintest : color.secondary, borderRadius: 6, width: 28, height: 28, cursor: disabled ? "default" : "pointer", fontSize: 14, lineHeight: 1 }}
    >
      {children}
    </button>
  );
}

/** The Agent mark: a four-point spark. */
/** The answers in a conversation: what the collapsed rail's dot counts. */
export function answersIn(transcript: readonly TranscriptItem[]): number {
  return transcript.filter((t) => t.kind === "assistant" && t.text.trim() !== "").length;
}

/** The rail's words: what is waiting (changes to approve, a new answer), or just how to open it. */
export function railLabel(unread: boolean, pending: number): string {
  if (pending > 0) return `Open the Copilot: ${pending} change${pending === 1 ? "" : "s"} waiting for your approval`;
  return unread ? "Open the Copilot: a new answer" : "Open the Copilot";
}

/**
 * The Copilot collapsed: a slim rail beside the page, or a bar under it on a
 * tablet held upright or a phone. It is how the Copilot opens (the header has
 * no button for it): the count of changes waiting for approval on it, or a
 * dot when an answer has landed since it was closed.
 */
export function AgentRail({ unread, pending = 0, onOpen }: { unread: boolean; pending?: number; onOpen: () => void }): JSX.Element {
  const label = railLabel(unread, pending);
  return (
    <aside className="wb-agent-rail" aria-label="MATERIA Copilot">
      <button type="button" onClick={onOpen} title={label} aria-label={label}>
        <SparkIcon size={18} />
        <span className="wb-agent-rail-label">Copilot</span>
        {pending > 0 ? <span className="wb-agent-count" aria-hidden="true">{pending}</span> : unread && <span className="wb-agent-dot" aria-hidden="true" />}
      </button>
    </aside>
  );
}

export function SparkIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden style={{ display: "block", flex: "none" }}>
      <path d="M8 1.2c.5 3.3 1.9 4.9 5.3 5.5-3.4.6-4.8 2.2-5.3 5.5-.5-3.3-1.9-4.9-5.3-5.5C6.1 6.1 7.5 4.5 8 1.2Z" fill={color.primary} />
      <circle cx="13" cy="12.6" r="1.4" fill={color.primary} opacity="0.55" />
    </svg>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────

const drawer: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  background: color.raised,
  borderLeft: `1px solid ${color.border}`,
};
const checklist: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "3px 10px", padding: "6px 14px", borderBottom: `1px solid ${color.border}`, background: color.muted2, fontSize: fz.micro };
const head: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${color.border}` };
const headRow: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 };
const settingsBox: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${color.border}`, background: color.muted2 };
const transcriptBox: CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 };
const composer: CSSProperties = { display: "flex", flexDirection: "column", gap: 5, padding: "10px 12px 10px", borderTop: `1px solid ${color.border}`, background: color.raised };
const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const fieldLabel: CSSProperties = { fontSize: fz.micro, color: color.secondary, fontWeight: 600 };
const input: CSSProperties = { border: `1px solid ${color.input}`, borderRadius: 6, padding: "6px 8px", fontSize: 13, background: color.surface, color: color.ink, width: "100%", boxSizing: "border-box" };
const segmented: CSSProperties = { display: "flex", gap: 0, border: `1px solid ${color.control}`, borderRadius: radius.button, overflow: "hidden" };
const segment = (on: boolean): CSSProperties => ({ flex: 1, border: "none", padding: "6px 4px", fontSize: 12.5, cursor: "pointer", background: on ? color.primaryTintBg : color.surface, color: on ? color.primary : color.ink, fontWeight: on ? 600 : 500 });
const note: CSSProperties = { margin: 0, fontSize: 12, color: color.secondary, lineHeight: 1.45 };
const code: CSSProperties = { fontFamily: mono, fontSize: "0.92em", background: color.chipBg, padding: "0 4px", borderRadius: 4 };
// A long unbroken token (a parameter id list, a file name, a ref) wraps
// inside the drawer instead of widening the conversation past it.
const userBubble: CSSProperties = { alignSelf: "flex-end", maxWidth: "88%", background: color.primaryTintBg, border: `1px solid ${color.primaryTintBorder}`, color: color.ink, padding: "7px 10px", borderRadius: 10, fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.45, overflowWrap: "anywhere" };
const assistantText: CSSProperties = { fontSize: 13, color: color.ink, lineHeight: 1.5, overflowWrap: "anywhere" };
const list: CSSProperties = { margin: "0 0 6px", paddingLeft: 18 };
const table: CSSProperties = { borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" };
const th: CSSProperties = { textAlign: "left", fontWeight: 600, padding: "2px 8px 3px 0", borderBottom: `1px solid ${color.border}`, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "2px 8px 2px 0", borderBottom: `1px solid ${color.chipBg}`, whiteSpace: "nowrap" };
const primaryButton: CSSProperties = { border: `1px solid ${color.primary}`, background: color.primary, color: "#fff", borderRadius: 6, padding: "5px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const secondaryButton: CSSProperties = { border: `1px solid ${color.control}`, background: color.surface, color: color.ink, borderRadius: 6, padding: "5px 14px", fontSize: 12.5, cursor: "pointer" };
const noticeStyle = (tone: "info" | "error"): CSSProperties => ({
  fontSize: 12.5,
  lineHeight: 1.45,
  padding: "6px 9px",
  borderRadius: 6,
  border: `1px solid ${tone === "error" ? color.warnBorder : color.noteBorder}`,
  background: tone === "error" ? color.warnBg : color.noteBg,
  color: tone === "error" ? color.warnInk : color.noteInk,
});
