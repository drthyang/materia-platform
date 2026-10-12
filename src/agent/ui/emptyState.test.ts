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
