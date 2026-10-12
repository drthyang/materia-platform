import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SCENARIOS } from "@/agent/evals/scenarios";
import { LIVE_TOOLS } from "@/agent/tools";
import { TOOL_REGISTRY } from "@/mcp/registry";
import { checksShown } from "@/agent/evals/replays";

/** The counts the README states, against the code: a doc that drifts from it fails here. */
describe("the README's counts", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  it("names as many eval scenarios, Agent tools and MCP tools as the code has", () => {
    expect(readme).toContain(`${SCENARIOS.length} eval scenarios`);
    expect(readme).toContain(`${LIVE_TOOLS.length} tools across the powder page`);
    expect(readme).toContain(`(${TOOL_REGISTRY.length} tools)`);
  });
});

/** How many checks a failing replay shows catching their failure, as the eval docs say it. */
describe("the eval docs' count of checks shown to catch their failure", () => {
  const { shown, all } = checksShown();
  const unshown = [...all].filter((c) => !shown.has(c));
  const evals = readFileSync(new URL("../docs/AGENT_EVALS.md", import.meta.url), "utf8").replace(/\s+/g, " ");
  const tools = readFileSync(new URL("../docs/AGENT_TOOLS.md", import.meta.url), "utf8").replace(/\s+/g, " ");

  it("states the count the replays give, and names a check still without one", () => {
    expect(evals).toContain(`${shown.size} of the suite's ${all.size} checks so far`);
    expect(tools).toContain(`${shown.size} of the ${all.size} so far`);
    for (const doc of [evals, tools]) {
      const named = /the rest \(`([^`]+)` among them\)/.exec(doc)?.[1];
      expect(unshown, `the docs name "${named}" as having no failing replay`).toContain(named);
    }
  });
});
