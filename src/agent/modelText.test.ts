import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { liveToolTable } from "@/agent/toolDoc";
import { agentSystemPrompt, autonomyNote } from "@/agent/systemPrompt";
import { LIVE_TOOLS, inputJsonSchema } from "@/agent/tools";

/**
 * What the model reads, as files kept in the repository: the system prompt,
 * the mode lines and every live tool's description and input schema, with the
 * skills (arm B, the Agent as it ships) and without them (arm C). A change to
 * any of it shows in the pull request's diff, where the user can read it
 * (docs/AGENT_PLAN.md, ground rules); `npx vitest run -u` writes the new text.
 * The skills themselves are files already (.claude/skills).
 */
function modelText(skills: boolean): string {
  const tools = LIVE_TOOLS.filter((t) => skills || t.name !== "read_skill").map((t) =>
    [`### ${t.name}`, "", skills ? t.description : t.withoutSkills ?? t.description, "", "```json", JSON.stringify(inputJsonSchema(t), null, 2), "```"].join("\n"),
  );
  return [
    `# What the model reads: ${skills ? "arm B, with the skills" : "arm C, without them"}`,
    "",
    "## System prompt",
    "",
    agentSystemPrompt({ skills }),
    "",
    "## Mode lines",
    "",
    `ask: ${autonomyNote("ask", { skills })}`,
    "",
    `auto: ${autonomyNote("auto", { skills })}`,
    "",
    "## Tools",
    "",
    tools.join("\n\n"),
    "",
  ].join("\n");
}

describe("the model-visible text", () => {
  it("with the skills (arm B) is as the snapshot holds it", async () => {
    await expect(modelText(true)).toMatchFileSnapshot("./__snapshots__/model-text.arm-b.md");
  });

  it("without the skills (arm C) is as the snapshot holds it", async () => {
    await expect(modelText(false)).toMatchFileSnapshot("./__snapshots__/model-text.arm-c.md");
  });
});

describe("the in-app tool table in docs/AGENT_TOOLS.md", () => {
  it("is LIVE_TOOLS as toolDoc.ts renders it (npm run gen:tooldoc)", () => {
    const doc = readFileSync(resolve(__dirname, "../../docs/AGENT_TOOLS.md"), "utf8");
    const m = /<!-- LIVE_TOOLS:BEGIN[^>]*-->\n([\s\S]*?)\n<!-- LIVE_TOOLS:END -->/.exec(doc);
    expect(m, "marker block <!-- LIVE_TOOLS:BEGIN --> … <!-- LIVE_TOOLS:END --> missing").toBeTruthy();
    expect(m![1]).toBe(liveToolTable());
  });
});
