import { describe, it, expect } from "vitest";
import { allSkills, PAGE_METHOD, readSkill } from "@/agent/skills";
import { LIVE_TOOLS, type AgentPage } from "@/agent/tools";
import { TOOL_REGISTRY } from "@/mcp/registry";
import { stagesFor } from "@/agent/method";
import { ALTERNATION_SETTLED } from "@/agent/method";
import { LOCAL_BUDGET_CHARS, skillOutline } from "@/agent/contextWindow";
import {
  COMPLETENESS_NOTE, CORRELATION_LIMIT, DATA_PER_PARAMETER, EXTINCTION_K, EXTINCTION_LARGE, EXTINCTION_SEVERE, FLACK_U_DETERMINED, FORBIDDEN_OVERLAP, GOF_BANDS, LARGE_CUT,
  LE_BAIL_UNSETTLED, POSTERIOR_CORRELATION, POSTERIOR_NEARLY_RHAT, POSTERIOR_RHAT, R_INT_NOTE, SHIFT_SETTLED,
  BOND_SHORT, CORRELATION_REPORTED, DISTANCE_HARD, DISTANCE_WARN, U_HARD, U_LARGE, U_ORDER_RATIO, U_SMALL,
} from "@/core/diagnostics/thresholds";

/**
 * The skill lint: the skills are prose, so nothing else checks them against
 * the code they drive (docs/AGENT_PLAN.md, 5.1). Three checks:
 *  - every tool a skill names exists: on the skill's pages in the app, or over
 *    MCP where the skill marks it so (an MCP column or map, or "MCP" on its line);
 *  - every gate number a skill quotes is the constant the code decides by;
 *  - every stage of a page's method (method.ts) is named in its skill, and
 *    each "## Stage" heading of the skill is one of them or a check.
 * KNOWN lists what fails and is accepted for now, each with what it is; a
 * fixed one comes off the list, and a new failure fails here.
 * And the budget (5.4): each method fits a local model's window beside the
 * results it is read with, and its outline keeps its Gates.
 */

/** The pages each skill drives in the app. */
const SKILL_PAGES: Readonly<Record<string, readonly AgentPage[]>> = {
  "my-rietveld-workflow": ["powder"],
  "magnetic-analysis": ["powder"],
  "symmetry-review": ["powder"],
  "bayesian-check": ["powder", "pdf"],
  "pdf-workflow": ["pdf"],
  "sc-workflow": ["singleCrystal"],
};

/** Each page's method skill and how its stages read in it. */
const METHOD_STAGES: Readonly<Record<string, { readonly page: AgentPage; readonly stage: Readonly<Record<string, RegExp>>; readonly checks?: readonly RegExp[] }>> = {
  "my-rietveld-workflow": {
    page: "powder",
    stage: { range: /fit range/i, check: /sanity-check the cell|cell check/i, base: /scale.*background|background.*cell/i, positions: /positions/i, profile: /profile/i, adp: /\bADPs?\b/, occupancy: /occupanc/i, corrections: /corrections/i, symmetry: /symmetry review/i },
    // Stage 1 holds the structural stages, block by block.
    checks: [/Structural refinement, in the fixed order/],
  },
  "pdf-workflow": {
    page: "pdf",
    stage: { base: /scale/i, adp: /\bADPs?\b/, motion: /correlated motion|δ1|delta1/i, positions: /positions/i, occupancy: /occupanc/i, size: /particle size|spdiameter/i },
    // The user's three windows: the long range, the correlated motion, the local fit.
    checks: [/Check the data and the instrument/, /The long range/, /The local fit/],
  },
  "sc-workflow": {
    page: "singleCrystal",
    stage: { data: /data before the model|read the data/i, base: /\bscale\b/i, twin: /twin/i, positions: /positions/i, adp: /\bisotropic ADP/i, aniso: /anisotropic ADP/i, occupancy: /occupancy/i },
  },
};

/** Gate numbers the skills quote, each with the constant the code decides by. */
const QUOTED: readonly { readonly skill: string; readonly what: string; readonly pattern: RegExp; readonly value: number }[] = [
  { skill: "my-rietveld-workflow", what: "the fit-window cut that is the user's call (%)", pattern: /more than\s+(\d+(?:\.\d+)?) % of the points/, value: 100 * LARGE_CUT },
  { skill: "my-rietveld-workflow", what: "the alternation settled (esd)", pattern: /by more than (\d+(?:\.\d+)?) esd/, value: ALTERNATION_SETTLED },
  { skill: "my-rietveld-workflow", what: "the correlation limit", pattern: /correlate at \|ρ\| ≥ (\d\.\d+)/, value: CORRELATION_LIMIT },
  { skill: "my-rietveld-workflow", what: "a block converged (esd)", pattern: /largest shift below\s+(\d\.\d+) esd/, value: SHIFT_SETTLED },
  { skill: "my-rietveld-workflow", what: "the GoF band excellent", pattern: /excellent up to\s+(\d\.\d+)/, value: GOF_BANDS.excellent },
  { skill: "my-rietveld-workflow", what: "the GoF band good", pattern: /good to (\d\.\d+)/, value: GOF_BANDS.good },
  { skill: "my-rietveld-workflow", what: "the GoF band fair", pattern: /fair to (\d+)/, value: GOF_BANDS.fair },
  { skill: "my-rietveld-workflow", what: "a GoF too good", pattern: /below (\d\.\d+) the fit is "too good"/, value: GOF_BANDS.tooGood },
  { skill: "my-rietveld-workflow", what: "a Le Bail fit that did not settle (Rwp %)", pattern: /Rwp of (\d+) % or more/, value: 100 * LE_BAIL_UNSETTLED },
  { skill: "my-rietveld-workflow", what: "two atoms that cannot be closer (Å)", pattern: /two atoms closer than (\d\.\d+) Å/, value: DISTANCE_HARD },
  { skill: "my-rietveld-workflow", what: "a distance rarely shorter (Å)", pattern: /atoms closer than\s+(\d\.\d+) Å, a bond/, value: DISTANCE_WARN },
  { skill: "my-rietveld-workflow", what: "a bond short of its bond-valence length (%)", pattern: /more than (\d+) % shorter than its bond-valence/, value: 100 * BOND_SHORT },
  { skill: "my-rietveld-workflow", what: "the hard U limit (Å²)", pattern: /a U_iso above (\d\.\d+) Å², a negative/, value: U_HARD },
  { skill: "my-rietveld-workflow", what: "a large U (Å²)", pattern: /a U_iso above (\d\.\d+) Å²\s+or below/, value: U_LARGE },
  { skill: "my-rietveld-workflow", what: "a small U (Å²)", pattern: /or below (\d\.\d+) Å² \(room/, value: U_SMALL },
  { skill: "my-rietveld-workflow", what: "a heavier atom's U against a lighter one's", pattern: /more than (\d\.\d+)× a lighter/, value: U_ORDER_RATIO },
  { skill: "my-rietveld-workflow", what: "correlations reported from", pattern: /\*\*Correlations\*\* from (\d\.\d+) to/, value: CORRELATION_REPORTED },
  { skill: "pdf-workflow", what: "a block converged (esd)", pattern: /largest shift below\s+(\d\.\d+) esd/, value: SHIFT_SETTLED },
  { skill: "pdf-workflow", what: "the correlation limit", pattern: /correlate at \|ρ\| ≥ (\d\.\d+)/, value: CORRELATION_LIMIT },
  { skill: "bayesian-check", what: "a converged posterior's R̂", pattern: /converged run: R̂ < (\d\.\d+)/, value: POSTERIOR_RHAT },
  { skill: "bayesian-check", what: "a nearly converged posterior's R̂", pattern: /close to converged" \(R̂ < (\d\.\d+)\)/, value: POSTERIOR_NEARLY_RHAT },
  { skill: "bayesian-check", what: "the correlation limit", pattern: /below the (\d\.\d+) at which `refine` refuses/, value: CORRELATION_LIMIT },
  { skill: "bayesian-check", what: "the posterior correlations named", pattern: /names those at \|ρ\| ≥ (\d\.\d+)/, value: POSTERIOR_CORRELATION },
  { skill: "symmetry-review", what: "the absence overlap (%)", pattern: /at least (\d+(?:\.\d+)?)% in d/, value: 100 * FORBIDDEN_OVERLAP },
  { skill: "sc-workflow", what: "reflections per parameter", pattern: /at least (\d+) reflections per refined parameter/, value: DATA_PER_PARAMETER },
  { skill: "sc-workflow", what: "Flack u that determines the hand", pattern: /small esd \(≲ (\d\.\d+)\)/, value: FLACK_U_DETERMINED },
  { skill: "sc-workflow", what: "R_int the report notes above (%)", pattern: /notes an R_int above (\d+(?:\.\d+)?) %/, value: 100 * R_INT_NOTE },
  { skill: "sc-workflow", what: "completeness the report notes below (%)", pattern: /notes a completeness below (\d+(?:\.\d+)?) %/, value: 100 * COMPLETENESS_NOTE },
  { skill: "sc-workflow", what: "a stage converged (esd)", pattern: /largest shift is below (\d\.\d+) esd/, value: SHIFT_SETTLED },
  { skill: "sc-workflow", what: "the extinction K", pattern: /K below (\d\.\d+) of the others'/, value: EXTINCTION_K },
  { skill: "sc-workflow", what: "a large extinction (y)", pattern: /\(y below (\d\.\d+)\) is large/, value: EXTINCTION_LARGE },
  { skill: "sc-workflow", what: "a severe extinction (y)", pattern: /y below (\d\.\d+) is severe/, value: EXTINCTION_SEVERE },
  { skill: "sc-workflow", what: "the correlation limit", pattern: /correlate at \|ρ\| ≥ (\d\.\d+)/, value: CORRELATION_LIMIT },
];

/** What fails and is accepted for now: nothing, since the skill drafts (5.2–5.5). A new entry needs its reason. */
const KNOWN: readonly string[] = [];

/** How a page is named in prose: a tool named beside its own page is attributed, not offered here. */
const PAGE_NAMES: Readonly<Record<AgentPage, RegExp>> = { powder: /\b(Rietveld|powder) page\b/i, pdf: /\bPDF page\b/, singleCrystal: /\bsingle-crystal page\b/i };

function toolProblems(skill: string, body: string): string[] {
  const pages = SKILL_PAGES[skill];
  if (!pages) return [`${skill}: no pages listed for it in SKILL_PAGES`];
  const live = new Map(LIVE_TOOLS.map((t) => [t.name, t]));
  const mcp = new Set(TOOL_REGISTRY.map((t) => t.name));
  // A skill's references (knowledge notes) are named like tools: they are read with read_skill.
  const references = new Set(allSkills().flatMap((k) => k.references.map((r) => r.name)));
  const problems = new Set<string>();
  let mcpColumn = -1;
  let mcpTable: boolean;
  let heading = "";
  // Prose is marked by its paragraph: a sentence that says "over MCP" may run onto the next line.
  const lines = body.split("\n");
  const paragraphOf: number[] = [];
  let paragraph = 0;
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#") || line.trim().startsWith("|")) paragraph++;
    paragraphOf.push(paragraph);
  }
  const mcpParagraphs = new Set(lines.flatMap((l, i) => (/\bMCP\b/.test(l) && !l.trim().startsWith("|") ? [paragraphOf[i]!] : [])));
  for (const [i, line] of lines.entries()) {
    if (line.startsWith("#")) heading = line;
    const cells = line.trim().startsWith("|") ? line.split("|").slice(1, -1) : null;
    if (cells && /\bMCP\b/.test(line) && !line.includes("`")) mcpColumn = cells.findIndex((c) => /\bMCP\b/.test(c));
    if (!cells) mcpColumn = -1;
    mcpTable = /\bMCP\b/.test(heading) && cells !== null;
    for (const m of line.matchAll(/`([a-z]+(?:_[a-z0-9]+)+)`/g)) {
      const name = m[1]!;
      if (references.has(name)) continue;
      const column = cells ? cells.findIndex((c) => c.includes(`\`${name}\``)) : -1;
      const markedMcp = mcpTable || (mcpColumn >= 0 && column === mcpColumn) || /\bMCP\b/.test(line) || (!cells && mcpParagraphs.has(paragraphOf[i]!));
      const spec = live.get(name);
      if (spec && spec.pages.some((p) => pages.includes(p))) continue;
      if (spec && spec.pages.some((p) => PAGE_NAMES[p].test(line))) continue;
      if (spec && !mcp.has(name)) {
        problems.add(`${skill}: ${name} is not on the ${pages.join(" or ")} page`);
        continue;
      }
      if (mcp.has(name)) {
        if (!markedMcp) problems.add(`${skill}: ${name} is MCP-only, not marked so`);
        continue;
      }
      if (!spec) problems.add(`${skill}: \`${name}\` names no tool`);
    }
  }
  return [...problems];
}

function quoteProblems(skill: string, body: string): string[] {
  return QUOTED.filter((q) => q.skill === skill).flatMap((q) => {
    const m = q.pattern.exec(body.replace(/\s+/g, " "));
    if (!m) return [`${skill}: ${q.what} is no longer quoted as the lint reads it (${q.pattern})`];
    const quoted = Number(m[1]);
    return Math.abs(quoted - q.value) > 1e-9 * Math.max(1, q.value) ? [`${skill}: ${q.what} is ${quoted}, the code's ${Number(q.value.toPrecision(6))}`] : [];
  });
}

function stageProblems(skill: string, body: string): string[] {
  const method = METHOD_STAGES[skill];
  if (!method) return [];
  const problems: string[] = [];
  for (const st of stagesFor(method.page)) {
    const named = method.stage[st.id];
    if (!named) problems.push(`${skill}: the method's stage ${st.id} has no pattern here`);
    else if (!named.test(body)) problems.push(`${skill}: the method's stage "${st.label}" is not named`);
  }
  for (const h of body.split("\n").filter((l) => /^## Stage \d/.test(l))) {
    const title = h.replace(/^## Stage \d+\s*—\s*/, "");
    const isStage = Object.values(method.stage).some((re) => re.test(title));
    const isCheck = (method.checks ?? []).some((re) => re.test(title));
    if (!isStage && !isCheck) problems.push(`${skill}: "${h}" is no stage of the method`);
  }
  return problems;
}

describe("the skill lint", () => {
  const skills = allSkills();
  const found = skills.flatMap((k) => [...toolProblems(k.name, k.body), ...quoteProblems(k.name, k.body), ...stageProblems(k.name, k.body)]);

  it("lints every skill there is", () => {
    expect(skills.map((k) => k.name).sort()).toEqual(Object.keys(SKILL_PAGES).sort());
  });

  it("finds no problem beyond the known ones", () => {
    if (process.env.LINT_DUMP) console.log("FOUND\n" + found.join("\n"));
    expect(found.filter((p) => !KNOWN.includes(p))).toEqual([]);
  });

  it("lists as known only what still fails (a fixed one comes off the list)", () => {
    expect(KNOWN.filter((p) => !found.includes(p))).toEqual([]);
  });
});

/**
 * The budget (docs/AGENT_PLAN.md, 5.4). A local model's history holds
 * LOCAL_BUDGET_CHARS; a page's method is read whole with the results of a
 * stage or two beside it, so it takes at most 40 % of that, any other skill a
 * sixth. When the window fills, a method shrinks to its outline: its headings
 * and its Gates, the numbers and the stops, in a twentieth.
 */
describe("the skills' budget for a 32k window", () => {
  const methods = new Set(Object.values(PAGE_METHOD));

  it.each(allSkills().map((k) => [k.name, k] as const))("%s fits its share of the window", (_name, k) => {
    const limit = methods.has(k.name) ? 0.4 * LOCAL_BUDGET_CHARS : LOCAL_BUDGET_CHARS / 6;
    expect(k.body.length).toBeLessThanOrEqual(limit);
  });

  it.each([...methods].map((m) => [m]))("%s has Gates, which its outline keeps whole and small", (name) => {
    const text = readSkill(name);
    const gates = /^## Gates\s*\n([\s\S]*?)(?=^## )/m.exec(text);
    expect(gates, `${name} has no "## Gates" section`).not.toBeNull();
    const outline = skillOutline("read_skill", { name }, text);
    for (const line of gates![1]!.split("\n").filter((l) => l.trim())) expect(outline).toContain(line);
    expect(outline.length).toBeLessThanOrEqual(LOCAL_BUDGET_CHARS / 20);
  });
});
