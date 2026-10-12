import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SCENARIOS } from "@/agent/evals/scenarios";
import { LIVE_TOOLS } from "@/agent/tools";
import { TOOL_REGISTRY } from "@/mcp/registry";

/** The counts the README states, against the code: a doc that drifts from it fails here. */
describe("the README's counts", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  it("names as many eval scenarios, Agent tools and MCP tools as the code has", () => {
    expect(readme).toContain(`${SCENARIOS.length} eval scenarios`);
    expect(readme).toContain(`${LIVE_TOOLS.length} tools across the powder page`);
    expect(readme).toContain(`(${TOOL_REGISTRY.length} tools)`);
  });
});
