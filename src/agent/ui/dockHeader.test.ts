import { describe, expect, it } from "vitest";
import { connectionStatus, methodSummary, railLabel } from "@/agent/ui/AgentDrawer";
import { settingsFrom } from "@/agent/useAgent";

describe("the Agent dock's header", () => {
  const base = settingsFrom(null);

  it("says how the Agent is connected, and when it cannot send", () => {
    expect(connectionStatus({ ...base, mode: "api-key" }, "")).toMatchObject({ text: "No API key", ok: false });
    expect(connectionStatus({ ...base, mode: "api-key" }, "sk-ant-x")).toMatchObject({ text: "Anthropic API", ok: true });
    expect(connectionStatus({ ...base, mode: "proxy" }, "")).toMatchObject({ text: "Local proxy", ok: true });
    expect(connectionStatus({ ...base, mode: "ollama", ollamaModel: "" }, "")).toMatchObject({ text: "Ollama · no model", ok: false });
    expect(connectionStatus({ ...base, mode: "lmstudio", lmstudioModel: "qwen3-32b" }, "")).toMatchObject({ text: "LM Studio", ok: true });
  });

  it("covers an OpenAI-compatible server: a missing key, the preset's name, where the conversation goes", () => {
    const openai = { ...base, mode: "openai-compatible" as const, openaiUrl: "https://api.openai.com/v1", openaiModel: "gpt-5" };
    expect(connectionStatus(openai, "", "")).toMatchObject({ text: "OpenAI · no key", ok: false });
    const cloud = connectionStatus(openai, "", "sk-x");
    expect(cloud).toMatchObject({ text: "OpenAI", ok: true });
    expect(cloud.title).toContain("Sent to OpenAI");
    const llama = connectionStatus({ ...openai, openaiUrl: "http://localhost:8080/v1", openaiModel: "qwen3" }, "", "");
    expect(llama.ok).toBe(true);
    expect(llama.title).toContain("nothing leaves it");
  });

  it("keeps a local model's privacy note and a cloud model's billing note in the tooltip", () => {
    expect(connectionStatus({ ...base, mode: "ollama", ollamaModel: "qwen3:8b" }, "").title).toContain("nothing leaves it");
    expect(connectionStatus({ ...base, mode: "api-key" }, "sk-ant-x").title).toContain("billed to your key");
  });

  it("names a replay as one, never as the provider carrying it", () => {
    const s = connectionStatus({ ...base, mode: "proxy", replayOf: "Scripted model (eval sc-data-first)" }, "");
    expect(s.text).toBe("Scripted model (eval sc-data-first) · replay");
    expect(s.text).not.toContain("proxy");
  });

  it("folds the method to the required stages done and the next one", () => {
    const stage = (id: string, done: boolean, optional = false) => ({ id, label: id, done, optional });
    expect(methodSummary({ skill: "my-rietveld-workflow", stages: [stage("Fit range", true), stage("Cell check", false), stage("Occupancy", false, true)], next: "Cell check" })).toBe("1 of 2 done · next: Cell check");
    expect(methodSummary({ skill: "pdf-workflow", stages: [stage("Scale, cell", true)], next: null })).toBe("1 of 1 done");
  });
});

describe("the Copilot's rail, its only way in", () => {
  it("says what waits: changes to approve before a new answer, else how to open it", () => {
    expect(railLabel(false, 0)).toBe("Open the Copilot");
    expect(railLabel(true, 0)).toBe("Open the Copilot: a new answer");
    expect(railLabel(true, 1)).toBe("Open the Copilot: 1 change waiting for your approval");
    expect(railLabel(false, 3)).toBe("Open the Copilot: 3 changes waiting for your approval");
  });
});
