import { describe, expect, it } from "vitest";
import { connectionStatus, methodSummary } from "@/agent/ui/AgentDrawer";
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
