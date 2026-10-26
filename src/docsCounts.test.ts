import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checksShown } from "@/agent/evals/replays";

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
