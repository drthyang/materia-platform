/**
 * Regenerate the tool tables in docs/AGENT_TOOLS.md: the MCP tools from the
 * registry (src/mcp/registry.ts; registry.test.ts fails when the doc drifts),
 * and the in-app Agent's from LIVE_TOOLS (src/agent/toolDoc.ts;
 * modelText.test.ts fails when it drifts). Run it after a change to either:
 *
 *   npm run gen:tooldoc
 *
 * The sources use the Vite `@/` alias, so each is esbuild-bundled to a temp
 * file first (same approach as scripts/build-mcp.mjs).
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** One module of the source, bundled to a temp file and imported. */
async function load(entry, name) {
  const tmp = resolve(root, `dist/.tooldoc-${name}.mjs`);
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: tmp,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    alias: { "@": resolve(root, "src") },
    // The skills and knowledge notes come in as text, as Vite's ?raw does.
    loader: { ".md": "text" },
    logLevel: "silent",
  });
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    rmSync(tmp, { force: true });
  }
}

const { TOOL_REGISTRY } = await load("src/mcp/registry.ts", "registry");
const { liveToolTable } = await load("src/agent/toolDoc.ts", "live");

// Human-facing layout: one short table per workflow (name + title), then the
// full agent-facing descriptions folded into a <details> block. A tool missing
// from TOOL_GROUPS still gets documented, under "Other tools" — add it to a
// group rather than letting that section grow. registry.test.ts only checks
// that every tool has a `| \`name\`` row, so keep descriptions out of tables.
const TOOL_GROUPS = [
  ["Structure, data and instrument", ["parse_structure", "parse_powder_data", "parse_instrument", "reflection_list", "bond_geometry", "analyze_site_symmetry"]],
  ["Powder refinement", ["check_fit_range", "check_cell_symmetry", "build_refinement", "refine_powder", "evaluate_pattern", "simulate_pattern", "rank_next_parameters", "review_symmetry"]],
  ["Judging a refinement", ["assess_refinement", "suggest_next_steps", "interpret_structure"]],
  ["Magnetic structures", ["find_unexplained_peaks", "search_propagation_vector", "list_magnetic_subgroups", "allowed_moments", "build_magnetic_model", "refine_magnetic_powder"]],
  ["Single crystal", ["parse_single_crystal_data", "write_single_crystal_data", "merge_magnetic_supercell", "expand_structure_supercell", "build_modulated_moment_model"]],
  ["Pair distribution function (PDF)", ["parse_pdf_data", "build_pdf_model", "refine_pdf", "refine_pdf_boxcar", "compute_partial_pdf", "calibrate_qdamp", "sample_posterior"]],
  ["Magnetic PDF", ["build_mpdf_model", "refine_mpdf", "compute_mpdf_components"]],
  ["Symmetry modes", ["build_distortion_modes", "build_symmetry_modes"]],
  ["Export", ["export_bundle"]],
];

const esc = (s) => s.replaceAll("|", "\\|");
const grouped = new Set(TOOL_GROUPS.flatMap(([, names]) => names));
const sections = TOOL_GROUPS.map(([heading, names]) => [heading, TOOL_REGISTRY.filter((t) => names.includes(t.name))]);
const ungrouped = TOOL_REGISTRY.filter((t) => !grouped.has(t.name));
if (ungrouped.length > 0) {
  sections.push(["Other tools", ungrouped]);
  console.warn(`gen:tooldoc — add to a TOOL_GROUPS entry: ${ungrouped.map((t) => t.name).join(", ")}`);
}

const table = [
  ...sections
    .filter(([, tools]) => tools.length > 0)
    .flatMap(([heading, tools]) => [
      `**${heading}**`,
      "",
      "| Tool | What it does |",
      "|---|---|",
      ...tools.map((t) => `| \`${t.name}\` | ${esc(t.title)} |`),
      "",
    ]),
  "<details>",
  "<summary>Full descriptions — the text an agent reads for each tool</summary>",
  "",
  ...TOOL_REGISTRY.flatMap((t) => [`**\`${t.name}\`** — ${t.description}`, ""]),
  "</details>",
].join("\n");

const docPath = resolve(root, "docs/AGENT_TOOLS.md");
let doc = readFileSync(docPath, "utf8");
for (const [begin, end, body] of [["TOOLS:BEGIN", "TOOLS:END", table], ["LIVE_TOOLS:BEGIN", "LIVE_TOOLS:END", liveToolTable()]]) {
  const marked = new RegExp(`(<!-- ${begin}[^>]*-->)[\\s\\S]*?(<!-- ${end} -->)`);
  if (!marked.test(doc)) {
    console.error(`docs/AGENT_TOOLS.md is missing the <!-- ${begin} --> … <!-- ${end} --> markers`);
    process.exit(1);
  }
  doc = doc.replace(marked, (_, a, b) => `${a}\n${body}\n${b}`);
}
writeFileSync(docPath, doc);
console.log(`regenerated the MCP tool table (${TOOL_REGISTRY.length} tools) and the in-app tool table in docs/AGENT_TOOLS.md`);
