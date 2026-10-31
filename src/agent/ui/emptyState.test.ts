import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState, OpenAICompatSettings } from "@/agent/ui/AgentDrawer";
import { settingsFrom, type AgentController, type AgentSettings } from "@/agent/useAgent";

/** The prose a reader sees before the examples: tags and the example list stripped. */
const prose = (html: string): string => html.replace(/<ul data-examples[\s\S]*?<\/ul>/, "").replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").trim();

describe("the Agent drawer's empty state", () => {
  const pages = [null, "my-rietveld-workflow", "pdf-workflow", "sc-workflow"];
  const modes = [{ mode: "api-key" }, { mode: "ollama", ollamaModel: "qwen3:8b" }, { mode: "lmstudio" }, { mode: "proxy", autoApprove: true }, { mode: "openai-compatible" }, { mode: "openai-compatible", openaiUrl: "http://localhost:8000/v1", openaiModel: "Qwen/Qwen3-32B" }] as const;

  it("stays short, names the model, and never presents one provider as the model", () => {
    for (const page of pages) {
      for (const m of modes) {
        const settings = { ...settingsFrom(null), ...m };
        const html = renderToStaticMarkup(createElement(EmptyState, { settings, page }));
        const text = prose(html);
        expect(text.length, text).toBeLessThan(350);
        expect(text).not.toMatch(/Claude through|API key or a local proxy/);
        expect((html.match(/<li>/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect((html.match(/<li>/g) ?? []).length).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("the collapsed rail's dot", () => {
  it("counts the answers with text, not the tool cards, the user's lines or the notices", async () => {
    const { answersIn } = await import("@/agent/ui/AgentDrawer");
    expect(answersIn([
      { kind: "user", id: "1", text: "Refine." },
      { kind: "tool", id: "2", entryId: "e" },
      { kind: "assistant", id: "3", text: "", thinking: "…" },
      { kind: "assistant", id: "4", text: "Done: wR 3.9 %.", thinking: "" },
      { kind: "notice", id: "5", text: "stalled", tone: "info" },
    ])).toBe(1);
  });
});

describe("a turn's Outcome", () => {
  const entry = (id: string, tool: string, status: string, outcome?: string, effect = "change") => ({ id, tool, title: tool, effect, at: 0, status, ...(outcome ? { outcome } : {}) });
  const turn = (n: string, ...entryIds: string[]) => [
    { kind: "user" as const, id: `${n}u`, text: "go" },
    ...entryIds.map((e) => ({ kind: "tool" as const, id: `${n}${e}`, entryId: e })),
    { kind: "assistant" as const, id: `${n}a`, text: "Done.", thinking: "" },
  ];

  it("comes from what the turn's tools computed: converged achieved, a stop short partial, a refusal not achieved; reads alone none", async () => {
    const { turnOutcomes } = await import("@/agent/ui/AgentDrawer");
    const activity = {
      r1: entry("r1", "refine", "done", "converged · wR 3.87%"),
      r2: entry("r2", "refine", "done", "maxIterations · wR 9.10%"),
      f1: entry("f1", "refine", "failed", "pos_O1 ↔ B_O1 at 0.97: refused"),
      s1: entry("s1", "get_state", "done", undefined, "read"),
      d1: entry("d1", "set_free", "declined", "Declined"),
      f2: entry("f2", "refine", "failed", "Not run: profU free with B_Mn1"),
      r3: entry("r3", "refine", "done", "converged · wR 4.34%"),
    } as never;
    const items = [...turn("a", "s1", "r1"), ...turn("b", "r2"), ...turn("c", "f1"), ...turn("d", "s1"), ...turn("e", "d1")];
    const out = turnOutcomes(items, activity, false);
    expect(out.get("aa")).toEqual({ status: "achieved", note: "converged · wR 3.87%" });
    expect(out.get("ba")?.status).toBe("partial");
    expect(out.get("ca")).toEqual({ status: "not-achieved", note: "refine: pos_O1 ↔ B_O1 at 0.97: refused" });
    expect(out.has("da")).toBe(false);
    expect(out.get("ea")).toEqual({ status: "partial", note: "1 change declined" });
    // A refusal the turn then got past (the same call, made again, went through) is judged by what it ended on.
    expect(turnOutcomes(turn("g", "f2", "r3"), activity, false).get("ga")).toEqual({ status: "achieved", note: "converged · wR 4.34%" });
    expect(turnOutcomes(turn("h", "r3", "f2"), activity, false).get("ha")?.status).toBe("not-achieved");
    // The turn still running has none yet.
    expect(turnOutcomes(turn("a", "r1"), activity, true).size).toBe(0);
  });

  it("times a step to a tenth of a second, whole seconds past ten", async () => {
    const { formatDuration } = await import("@/agent/ui/AgentDrawer");
    expect(formatDuration(40)).toBe("<0.1 s");
    expect(formatDuration(1234)).toBe("1.2 s");
    expect(formatDuration(12_600)).toBe("13 s");
    expect(formatDuration(undefined)).toBeNull();
  });
});

describe("the OpenAI-compatible provider's settings block", () => {
  const render = (patch: Partial<AgentSettings>, openaiKey = ""): string => {
    const agent = { settings: { ...settingsFrom(null), mode: "openai-compatible", ...patch }, updateSettings: () => undefined, openaiKey, setOpenaiKey: () => undefined } as unknown as AgentController;
    return renderToStaticMarkup(createElement(OpenAICompatSettings, { agent }));
  };

  it("offers the presets, the base URL, the key, the model from the server and the context, with the one-line note", () => {
    const html = render({});
    for (const label of ["OpenAI", "Gemini (OpenAI-compatible)", "vLLM", "llama.cpp server", "Other"]) expect(html).toContain(`>${label}</option>`);
    expect(html).toContain('value="https://api.openai.com/v1"');
    expect(html).toMatch(/API key<\/span>/);
    expect(html).toContain("Asking the server…");
    expect(html).toMatch(/Context \(tokens\)/);
    expect(html).toContain('value="32768"');
    expect(html).toContain("Sent to OpenAI and billed to your key; not saved in projects or reports.");
  });

  it("says a server on this machine keeps everything on it, and its key is optional", () => {
    const html = render({ openaiUrl: "http://localhost:8080/v1", openaiPreset: "llamacpp" });
    expect(html).toContain("Runs on this machine; nothing leaves it.");
    expect(html).toContain("API key (if the server needs one)");
  });
});
