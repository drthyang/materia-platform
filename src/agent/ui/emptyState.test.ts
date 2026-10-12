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
