/**
 * The in-app Agent's tool table in docs/AGENT_TOOLS.md, generated from
 * LIVE_TOOLS (`npm run gen:tooldoc`, which also writes the MCP table), so the
 * page lists every tool with its pages and whether it asks. modelText.test.ts
 * fails when the doc drifts. The full descriptions are the model-text
 * snapshots (src/agent/__snapshots__), not repeated here.
 */

import { LIVE_TOOLS, type AgentPage, type LiveToolSpec } from "@/agent/tools";
import { isMagneticTool } from "@/agent/magneticTools";

const PAGE: Readonly<Record<AgentPage, string>> = { powder: "powder", pdf: "PDF", singleCrystal: "single crystal" };

/** One heading per set of pages, the widest first; the powder page's magnetic step apart. */
const GROUPS: readonly { readonly heading: string; readonly test: (t: LiveToolSpec) => boolean }[] = [
  { heading: "Every page", test: (t) => t.pages.length === 3 },
  { heading: "Two pages", test: (t) => t.pages.length === 2 },
  { heading: "Powder page", test: (t) => t.pages.length === 1 && t.pages[0] === "powder" && !isMagneticTool(t.name) },
  { heading: "Powder page: the magnetic step", test: (t) => isMagneticTool(t.name) },
  { heading: "PDF page", test: (t) => t.pages.length === 1 && t.pages[0] === "pdf" },
  { heading: "Single-crystal page", test: (t) => t.pages.length === 1 && t.pages[0] === "singleCrystal" },
];

/** How the tool runs: at once (it changes nothing on the page), after an approval card (none in Auto), always after one, or never asking. */
function runs(t: LiveToolSpec): string {
  if (t.effect === "read") return "at once";
  if (t.effect === "control") return "never asks";
  return t.alwaysAsk ? "always asks" : "asks first";
}

/** The table's Markdown, between the doc's LIVE_TOOLS markers. */
export function liveToolTable(): string {
  const placed = new Set<string>();
  const sections = GROUPS.map((g) => {
    const tools = LIVE_TOOLS.filter((t) => !placed.has(t.name) && g.test(t));
    for (const t of tools) placed.add(t.name);
    return { heading: g.heading, tools };
  });
  const left = LIVE_TOOLS.filter((t) => !placed.has(t.name));
  if (left.length > 0) throw new Error(`toolDoc: no group for ${left.map((t) => t.name).join(", ")}`);
  const pages = (t: LiveToolSpec): string => t.pages.map((p) => PAGE[p]).join(", ");
  const title = (t: LiveToolSpec): string => t.title.replaceAll("|", "\\|");
  return sections
    .filter((s) => s.tools.length > 0)
    .flatMap((s) => [
      `**${s.heading}**`,
      "",
      s.heading === "Two pages" ? "| Tool | Pages | Runs | What it does |" : "| Tool | Runs | What it does |",
      s.heading === "Two pages" ? "|---|---|---|---|" : "|---|---|---|",
      ...s.tools.map((t) => (s.heading === "Two pages" ? `| \`${t.name}\` | ${pages(t)} | ${runs(t)} | ${title(t)} |` : `| \`${t.name}\` | ${runs(t)} | ${title(t)} |`)),
      "",
    ])
    .join("\n")
    .trimEnd();
}
