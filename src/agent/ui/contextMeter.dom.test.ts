// @vitest-environment happy-dom
/**
 * The context meter in the Copilot's drawer, in a DOM: "Context N%" by the
 * message box, its details behind "?", the two ways on from amber (Start
 * fresh, Summarize and continue), and on a phone collapsed until amber.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentDrawer } from "@/agent/ui/AgentDrawer";
import { meterView } from "@/agent/ui/ContextMeter";
import { SHEET_QUERY } from "@/agent/ui/drawerWidth";
import { settingsFrom, type AgentController, type AgentSettings } from "@/agent/useAgent";
import type { ContextReading } from "@/agent/contextMeter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const realMatchMedia = window.matchMedia;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

/** The window as a phone held upright (the sheet) or a desktop. */
function viewport(phone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === SHEET_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const claude = (prompt: number): ContextReading => ({ model: "claude-opus-5-5", window: 1_000_000, prompt, reply: 0, reserve: 64_000, source: "provider" });
const local = (prompt: number): ContextReading => ({ model: "qwen3:32b", window: 32_768, prompt, reply: 0, reserve: 6_144, source: "app", serverCount: prompt });

function controller(context: ContextReading | null, patch: Partial<AgentController> = {}, settings: Partial<AgentSettings> = {}): AgentController {
  return {
    settings: { ...settingsFrom(null), ...settings },
    updateSettings: () => {},
    apiKey: "sk-ant-test",
    setApiKey: () => {},
    openaiKey: "",
    setOpenaiKey: () => {},
    transcript: [{ kind: "user", id: "u1", text: "How is the fit?" }, { kind: "assistant", id: "a1", text: "Good.", thinking: "" }],
    activity: {},
    pending: [],
    decide: () => {},
    thinking: false,
    send: () => {},
    choose: () => false,
    choiceCurrent: () => false,
    stop: () => {},
    clear: vi.fn(),
    usage: { input: 640_000, output: 2_000, cacheRead: 600_000 },
    context,
    cost: 1.25,
    summarize: vi.fn(),
    focus: [],
    hoverReply: () => {},
    report: null,
    reportOpen: false,
    openReport: () => {},
    closeReport: () => {},
    ...patch,
  };
}

function render(agent: AgentController, phone = false): HTMLDivElement {
  viewport(phone);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AgentDrawer, { agent, onClose: () => {} })));
  return host;
}

const meter = (el: HTMLElement): HTMLElement | null => el.querySelector(".wb-agent-ctx");
const warning = (el: HTMLElement): HTMLElement | null => el.querySelector(".wb-agent-ctxwarn");
const button = (el: HTMLElement, label: string): HTMLButtonElement => [...el.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;

describe("the context meter by the message box", () => {
  it("is neutral below 70 %: the meter only, no warning", () => {
    const el = render(controller(claude(400_000)));
    expect(meter(el)!.dataset.level).toBe("neutral");
    expect(meter(el)!.textContent).toContain("Context 46%");
    expect(warning(el)).toBeNull();
  });

  it("before the first reply there is no reading, and the hint stays", () => {
    const el = render(controller(null, { usage: { input: 0, output: 0, cacheRead: 0 } }));
    expect(meter(el)).toBeNull();
    expect(el.querySelector(".wb-agent-hint")!.textContent).toBe("Enter to send · Shift+Enter for a new line");
  });

  it("at amber offers Start fresh and Summarize and continue, and each does what it says", () => {
    const agent = controller(claude(700_000));
    const el = render(agent);
    expect(meter(el)!.dataset.level).toBe("amber");
    expect(warning(el)!.dataset.level).toBe("amber");
    expect(warning(el)!.textContent).toContain("The model's window is 76% full.");
    act(() => button(el, "Start fresh").click());
    expect(agent.clear).toHaveBeenCalledTimes(1);
    act(() => button(el, "Summarize and continue").click());
    expect(agent.summarize).toHaveBeenCalledTimes(1);
  });

  it("is red above 90 %, with the same two ways on", () => {
    const el = render(controller(claude(900_000)));
    expect(meter(el)!.dataset.level).toBe("red");
    expect(warning(el)!.dataset.level).toBe("red");
    expect(warning(el)!.textContent).toContain("The model's window is nearly full (96%).");
    expect(button(el, "Start fresh")).toBeTruthy();
    expect(button(el, "Summarize and continue")).toBeTruthy();
  });

  it("holds both actions while a turn runs", () => {
    const el = render(controller(claude(900_000), { thinking: true }));
    expect(button(el, "Start fresh").disabled).toBe(true);
    expect(button(el, "Summarize and continue").disabled).toBe(true);
  });

  it("opens its details behind ?: tokens used / window, the reply reserve, who counted, the cost", () => {
    const el = render(controller(claude(500_000)));
    act(() => (el.querySelector(".wb-agent-ctx-help") as HTMLButtonElement).click());
    const details = el.querySelector(".wb-agent-ctx-details")!.textContent!;
    expect(details).toContain("564,000 of 1,000,000 tokens (56%)");
    expect(details).toContain("64,000 kept for the next reply");
    expect(details).toContain("Counted by the API");
    expect(details).toContain("This session so far: $1.25 at Anthropic's list prices");
    expect(details).toContain("This session: 640k in · 600k cached · 2.0k out.");
    // Escape closes them.
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(el.querySelector(".wb-agent-ctx-details")).toBeNull();
  });

  it("a local model: measured against its own window, counted by the app, at no cost", () => {
    const el = render(controller(local(20_000), {}, { mode: "ollama", ollamaModel: "qwen3:32b" }));
    expect(meter(el)!.textContent).toContain("Context 80%");
    act(() => (el.querySelector(".wb-agent-ctx-help") as HTMLButtonElement).click());
    const details = el.querySelector(".wb-agent-ctx-details")!.textContent!;
    expect(details).toContain("of 32,768 tokens");
    expect(details).toContain("Counted by the app");
    expect(details).toContain("No cost: the model runs on this machine.");
  });
});

describe("the context meter on a phone", () => {
  it("stays collapsed below amber", () => {
    const el = render(controller(claude(400_000)), true);
    expect(el.querySelector(".wb-agent")!.getAttribute("data-mode")).toBe("sheet");
    expect(meter(el)).toBeNull();
    expect(warning(el)).toBeNull();
  });

  it("opens at amber, with both actions", () => {
    const el = render(controller(claude(700_000)), true);
    expect(meter(el)!.dataset.level).toBe("amber");
    expect(button(el, "Start fresh")).toBeTruthy();
    expect(button(el, "Summarize and continue")).toBeTruthy();
  });

  it("follows one rule: shown beside the page always, on a phone from amber", () => {
    expect(meterView(null, false)).toBeNull();
    expect(meterView(claude(400_000), false)).toMatchObject({ shown: true, actions: false, level: "neutral" });
    expect(meterView(claude(400_000), true)).toMatchObject({ shown: false, actions: false });
    expect(meterView(claude(700_000), true)).toMatchObject({ shown: true, actions: true, level: "amber" });
    expect(meterView(claude(900_000), true)).toMatchObject({ shown: true, actions: true, level: "red" });
  });
});
