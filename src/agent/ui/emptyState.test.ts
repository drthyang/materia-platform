import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "@/agent/ui/AgentDrawer";
import { settingsFrom } from "@/agent/useAgent";

/** The prose a reader sees before the examples: tags and the example list stripped. */
const prose = (html: string): string => html.replace(/<ul data-examples[\s\S]*?<\/ul>/, "").replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").trim();

describe("the Agent drawer's empty state", () => {
  const pages = [null, "my-rietveld-workflow", "pdf-workflow", "sc-workflow"];
  const modes = [{ mode: "api-key" }, { mode: "ollama", ollamaModel: "qwen3:8b" }, { mode: "lmstudio" }, { mode: "proxy", autoApprove: true }] as const;

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
    } as never;
    const items = [...turn("a", "s1", "r1"), ...turn("b", "r2"), ...turn("c", "f1"), ...turn("d", "s1"), ...turn("e", "d1")];
    const out = turnOutcomes(items, activity, false);
    expect(out.get("aa")).toEqual({ status: "achieved", note: "converged · wR 3.87%" });
    expect(out.get("ba")?.status).toBe("partial");
    expect(out.get("ca")).toEqual({ status: "not-achieved", note: "refine: pos_O1 ↔ B_O1 at 0.97: refused" });
    expect(out.has("da")).toBe(false);
    expect(out.get("ea")).toEqual({ status: "partial", note: "1 change declined" });
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
