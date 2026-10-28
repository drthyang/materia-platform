/**
 * The refinement report as Markdown — the same report as `reportHtml`, in the
 * same order, for a lab notebook, a repository or an e-mail: the Result, the
 * structure per phase (the cell as its independent parameters, the atoms with
 * standard uncertainties, the distances), the magnetic structure, the fit
 * (figure, agreement indices, the other refined values), the quality and
 * caveats, then the appendix with the record behind it. The figure is an SVG
 * data URI carrying its own style, so the file stands alone (Markdown viewers
 * that block data URIs show its alt text; the HTML report always has it).
 *
 * Pure data → string, like the HTML report; the numbers come from the same
 * `ReportInput` and the same tables (reportTables.ts, `formatWithEsd`).
 *
 * Not the text the Agent's number audit or the validation read: that is the
 * frozen layout (reportMarkdownFrozen.ts).
 */

import type { StructureModel } from "@/core/crystal/types";
import type { RefinementParameter } from "@/core/refinement/types";
import { formatWithEsd } from "@/core/export/cif";
import { fobsFcalcSvg, patternFigureSvg } from "@/core/export/reportFigures";
import { markNumbers } from "@/core/export/reportAudit";
import { atomTable, atomTableNote, cellLineText, cellTerms, shellTables, SHELL_NOTE, type AtomTable } from "@/core/export/reportTables";
import { formulasText, formulaText, minus, spaceGroupText, symbolText } from "@/core/export/reportTypeset";
import {
  ACCOUNT_NOTE,
  APPENDIX_NOTE,
  COMPOSED_NOTE,
  COVALENT_BONDS_NOTE,
  endSentence,
  FOOTER,
  HBOND_NOTE,
  RING_NOTE,
  TECHNIQUE_TITLE,
  anchorCoordinate,
  boxcarNote,
  modesNote,
  fixed,
  formatParameterValue,
  indicesOf,
  KIND_UNIT,
  magneticFacts,
  momentRows,
  parameterGroups,
  parameterStatus,
  phaseRole,
  phaseSymmetry,
  posteriorCaveat,
  posteriorStatus,
  qualityItems,
  caveatsInFull,
  shownParameter,
  sig,
  softwareRows,
  startText,
  statisticsRows,
  summaryParameters,
  type ReportAgent,
  type ReportBoxcar,
  type ReportModes,
  type ReportCheck,
  type ReportFigure,
  type ReportIndex,
  type ReportInput,
  type ReportMagnetic,
  type ReportPhase,
  type ReportPosterior,
  type ReportRow,
} from "@/core/export/report";

/** A table cell: no pipes or line breaks to break the row. */
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

function table(head: readonly string[], rows: readonly (readonly string[])[], align?: readonly ("l" | "r")[]): string {
  const sep = head.map((_, i) => (align?.[i] === "r" ? "---:" : "---"));
  return [`| ${head.map(cell).join(" | ")} |`, `| ${sep.join(" | ")} |`, ...rows.map((r) => `| ${r.map((c) => cell(minus(c))).join(" | ")} |`)].join("\n");
}

function kvTable(rows: readonly ReportRow[]): string {
  return table(["", ""], rows.map((r) => [`**${r.label}**`, r.value]));
}

/** Engine prose with its symbols in plain text ({{R_wp}} → Rwp) and minus signs. */
const prose = (text: string): string => formulasText(minus(text)).replace(/\{\{([^}]+)\}\}/g, (_m, s: string) => symbolText(s));

// ---------------------------------------------------------------------------
// Figure: the report's SVG with its own (light) style, as a data URI

const FIGURE_STYLE = `
.frame{fill:none;stroke:#c9d1d9;stroke-width:1}.grid{stroke:#e3e7eb;stroke-width:1}.zero{stroke:#8b949e;stroke-width:.8}
.tickmark{stroke:#59636e;stroke-width:1}.excl{fill:rgba(110,119,129,.09)}
.axistext{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:12px;fill:#59636e}.axistitle,.legend{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:13px;fill:#59636e}
.ticklabel{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:11.5px}
.obs{stroke:#1f4e79;stroke-width:2.4;stroke-linecap:round;fill:none}.obsline{stroke:#1f4e79;stroke-width:1.3;fill:none}
.calc{stroke:#c23b2e;stroke-width:1.3;fill:none}.diff{stroke:#6e7781;stroke-width:1.1;fill:none}.bkg{stroke:#a3acb6;stroke-width:1;stroke-dasharray:5 4;fill:none}
.unity{stroke:#8b949e;stroke-width:1;stroke-dasharray:4 4}.pt{stroke:#1f4e79;stroke-width:4;stroke-linecap:round;opacity:.7;fill:none}
.ptmag{stroke:#c23b2e;stroke-width:4.4;stroke-linecap:round;opacity:.8;fill:none}`;

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function figureMarkdown(fig: ReportFigure): string {
  const svg = fig.kind === "pattern"
    ? patternFigureSvg(fig.curves, {
        xLabel: fig.xLabel,
        ...(fig.yLabel !== undefined ? { yLabel: fig.yLabel } : {}),
        ...(fig.ticks ? { ticks: fig.ticks } : {}),
        ...(fig.fitRange ? { fitRange: fig.fitRange } : {}),
        ...(fig.observedAs ? { observedAs: fig.observedAs } : {}),
      })
    : fig.points.length > 0 ? fobsFcalcSvg(fig.points) : "";
  if (!svg) return "";
  // A white ground and the style the HTML report's stylesheet gives the figure.
  const styled = svg.replace(/<svg([^>]*)>/, (_m, attrs: string) => `<svg${attrs.includes("xmlns=") ? attrs : `${attrs} xmlns="http://www.w3.org/2000/svg"`}><style>${FIGURE_STYLE}</style><rect width="100%" height="100%" fill="#fff"/>`);
  const alt = fig.kind === "pattern" ? "Observed, calculated and difference pattern" : "F_obs against F_calc";
  return `![${alt}](data:image/svg+xml;base64,${utf8Base64(styled)})${fig.caption ? `\n\n*${fig.caption}*` : ""}`;
}

// ---------------------------------------------------------------------------
// Sections

function resultMarkdown(input: ReportInput): string {
  const a = input.agent;
  if (a?.narrative?.trim()) {
    const unverified = a.unverified ?? [];
    const account = markNumbers(a.narrative.trim(), unverified, (t) => `${t}†`);
    return `*The Copilot's account:*\n\n${account.split(/\n\s*\n/).map((p) => `> ${p.trim().replace(/\n/g, "\n> ")}`).join("\n>\n")}\n\n*${ACCOUNT_NOTE}${unverified.length > 0 ? " Numbers marked † in the Copilot's words are not among the values this report computed." : ""}*`;
  }
  if (input.assessment?.result) return `${prose(input.assessment.result)}\n\n*${COMPOSED_NOTE}*`;
  return input.summary ?? "";
}

function atomTableMarkdown(t: AtomTable): string {
  const head = ["Site", ...(t.type ? ["Type"] : []), ...(t.wyckoff ? ["Wyckoff"] : []), "x", "y", "z", "Occ.", `${t.adp.symbol}_${t.adp.sub} (Å²)`, ...(t.aniso ? ["ADP"] : [])];
  const align: ("l" | "r")[] = ["l", ...(t.type ? ["l" as const] : []), ...(t.wyckoff ? ["l" as const] : []), "r", "r", "r", "r", "r", ...(t.aniso ? ["l" as const] : [])];
  return table(head, t.rows.map((r) => [r.label, ...(t.type ? [r.type] : []), ...(t.wyckoff ? [r.wyckoff ?? ""] : []), r.x, r.y, r.z, r.occupancy, r.adp, ...(t.aniso ? [r.adpKind] : [])]), align);
}

function distancesMarkdown(phase: ReportPhase): string {
  if (phase.bonds) {
    if (phase.bonds.length === 0) return "";
    return table(["Bond", "d (Å)"], phase.bonds.map((b) => [`${b.from}–${b.to}${b.image ? ` [${b.image}]` : ""}`, b.length]), ["l", "r"]);
  }
  const shells = shellTables(phase.structure);
  if (shells.length === 0) return "";
  return table(["Bond", "d (Å)", "×"], shells.flatMap((sh) => [...sh.bonds.map((b) => [`${sh.site}–${b.to}`, b.distance, b.count > 1 ? String(b.count) : ""]), [`${sh.site} mean`, sh.mean, ""]]), ["l", "r", "r"]);
}

function phaseMarkdown(phase: ReportPhase, index: number, total: number, technique: ReportInput["technique"]): { md: string; table: AtomTable } {
  const st = phase.structure;
  const { symbol, number } = phaseSymmetry(st);
  const role = phaseRole(phase, index, total);
  const t = atomTable(phase, technique);
  const meta = [number !== undefined ? `No. ${number}` : "", role ?? "", phase.fraction ?? ""].filter(Boolean).join(" · ");
  const rings = phase.rings && phase.rings.contacts.length > 0 ? `\n\n**Ring centroids.** ${phase.rings.rings.join("; ")}. ${phase.rings.contacts.join(" · ")}.` : "";
  const hbonds = phase.hydrogenBonds && phase.hydrogenBonds.length > 0 ? `\n\n**Hydrogen bonds.** ${phase.hydrogenBonds.join(" · ")}.` : "";
  const distances = distancesMarkdown(phase);
  return {
    md: `### ${formulaText(st.name || st.id)} — ${symbol ? spaceGroupText(symbol) : "no symbol"}${meta ? ` (${meta})` : ""}\n\n${minus(cellLineText(cellTerms(phase)))}\n\n${atomTableMarkdown(t)}${distances ? `\n\n${distances}` : ""}${rings}${hbonds}`,
    table: t,
  };
}

function structureMarkdown(input: ReportInput): string {
  if (input.phases.length === 0) return "";
  const built = input.phases.map((p, i) => phaseMarkdown(p, i, input.phases.length, input.technique));
  const flags: AtomTable = { ...built[0]!.table, symmetryFixed: built.some((b) => b.table.symmetryFixed), held: built.some((b) => b.table.held) };
  const molecule = input.phases.find((p) => p.rings?.contacts.length || p.hydrogenBonds?.length);
  const notes = [
    atomTableNote(flags),
    ...(input.phases.some((p) => !p.bonds && shellTables(p.structure).length > 0) ? [SHELL_NOTE] : []),
    ...(input.phases.some((p) => p.bonds && p.bonds.length > 0) ? [COVALENT_BONDS_NOTE] : []),
    ...(molecule?.rings?.contacts.length ? [RING_NOTE] : []),
    ...(molecule?.hydrogenBonds?.length ? [HBOND_NOTE] : []),
  ];
  return `${built.map((b) => b.md).join("\n\n")}\n\n*${notes.filter(Boolean).join(" ")}*`;
}

function magneticMarkdown(m: ReportMagnetic, fallback: StructureModel | undefined): string {
  const structure = m.structure ?? fallback;
  if (!structure) return "";
  const f = magneticFacts(m, structure);
  const facts = [
    `k = ${f.k}`,
    `magnetic space group ${f.group}${f.numbers ? ` (${f.numbers})` : ""}`,
    ...(f.setting ? [`setting ${f.setting}`] : []),
    ...(f.index !== undefined ? [`index ${f.index}`] : []),
    ...(f.parent ? [`parent ${spaceGroupText(f.parent)}`] : []),
    `magnetic cell: ${f.cell}`,
    f.ordered,
  ].join(" · ");
  const moments = table(
    ["Site", "x", "y", "z", "m_a", "m_b", "m_c", "|m| (µB)"],
    momentRows(m, structure).map((r) => [`${r.site}${r.orbit > 1 ? ` (orbit ${r.orbit})` : ""}`, ...r.position.map(anchorCoordinate), ...r.components.map((c) => fixed(c, 3)), fixed(r.magnitude, 3)]),
    ["l", "r", "r", "r", "r", "r", "r", "r"],
  );
  const params = m.params.length > 0
    ? `\n\n${table(["Moment parameter", "Value (µB)", "Status"], m.params.map((p) => [p.label, formatParameterValue(p), parameterStatus(p)]), ["l", "r", "l"])}`
    : "";
  const limits = (m.limits ?? []).map((t) => `- ${t}`).join("\n");
  return `${facts}\n\n${m.provenance ?? m.status}\n\n${moments}${params}${limits ? `\n\n${limits}` : ""}\n\n*m_a, m_b, m_c: components along the cell axes (µB); |m| through the metric.*`;
}

function indicesMarkdown(indices: readonly ReportIndex[]): string {
  const values = indices.filter((i) => !i.count).map((i) => `${symbolText(i.symbol)} = ${i.value}`);
  const counts = indices.filter((i) => i.count).map((i) => `${i.value} ${i.symbol}`);
  return minus(`${values.join(", ")}${counts.length ? `${values.length ? " · " : ""}${counts.join(" · ")}` : ""}`);
}

function modesMarkdown(m: ReportModes): string {
  const rows = m.rows.map((r) => [r.label, r.esd !== undefined ? `${fixed(r.a, 5)} (${fixed(r.esd, 5)})` : fixed(r.a, 5), fixed(r.as, 5), fixed(r.ap, 5)]);
  return `**Distortion modes vs ${m.against}**\n\n${table(["Mode", "A (Å)", "A_s (Å)", "A_p (Å)"], rows, ["l", "r", "r", "r"])}\n\n*${modesNote(m)}*`;
}

function boxcarMarkdown(b: ReportBoxcar): string {
  const rows = b.rows.map((row) => [`${fixed(row.r[0], 2)}–${fixed(row.r[1], 2)}`, fixed(100 * row.rw, 2), ...row.values.map((v) => (Number.isFinite(v) ? fixed(v, b.decimals) : "—"))]);
  return `**Local versus average: boxcar scan**\n\n${table(["r (Å)", "Rw (%)", ...b.columns], rows, ["r", "r", ...b.columns.map(() => "r" as const)])}\n\n*${boxcarNote(b)}*`;
}

function fitMarkdown(input: ReportInput): string {
  const other = summaryParameters(input.parameters, input.technique);
  return [
    input.figure ? figureMarkdown(input.figure) : "",
    indicesMarkdown(indicesOf(input)),
    other.length > 0
      ? `**Other refined values**\n\n${table(["Parameter", "Value", "Unit"], other.map((p) => shownParameter(p, input.technique)).map(({ parameter: p, value }) => [p.label, value, KIND_UNIT[p.kind] ?? ""]), ["l", "r", "l"])}`
      : "",
    input.modes ? modesMarkdown(input.modes) : "",
    input.boxcar ? boxcarMarkdown(input.boxcar) : "",
  ].filter(Boolean).join("\n\n");
}

function posteriorMarkdown(p: ReportPosterior): string {
  const rows = table(
    ["Parameter", "Refined (esd)", "Median", "68 % interval", "95 % interval", "Width/esd", "Reading"],
    p.rows.map((r) => [
      r.label, formatWithEsd(r.refined, r.esd, 5), sig(r.median, 3),
      `${sig(r.ci68[0], 3)}–${sig(r.ci68[1], 3)}`, `${sig(r.ci95[0], 3)}–${sig(r.ci95[1], 3)}`,
      r.esdRatio !== undefined ? r.esdRatio.toFixed(2) : "—", r.verdict,
    ]),
    ["l", "r", "r", "r", "r", "r", "l"],
  );
  const diffs = p.differences.length > 0 ? `\n\n${p.differences.map((d) => `- ${d}`).join("\n")}` : "";
  return `**Bayesian check** — ${posteriorStatus(p)}\n\n${rows}${diffs}\n\n*${posteriorCaveat(p)}*`;
}

function qualityMarkdown(input: ReportInput): string {
  const items = qualityItems(input).map((c) => `- **${c.label}:** ${prose(endSentence(c.text))}${c.detail ? " \\*" : ""}`).join("\n");
  const posterior = input.agent?.posterior ? posteriorMarkdown(input.agent.posterior) : "";
  return [items, posterior].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// The appendix

const CHECK_LABEL = { pass: "pass", note: "note", warn: "attention" } as const;

function checksTable(checks: readonly ReportCheck[]): string {
  return table(["Check", "Result", "Detail"], checks.map((c) => [c.name, CHECK_LABEL[c.status], c.detail]));
}

function agentRecordMarkdown(a: ReportAgent): string {
  const pct = (v: number | undefined): string => (v === undefined ? "" : (100 * v).toFixed(2));
  const anyGof = a.steps.some((st) => st.gof !== undefined);
  const steps = table(
    ["#", "Step", "By", "Refined", "Free", `${a.agreementLabel ?? "wR"} (%)`, ...(anyGof ? ["GoF"] : [])],
    a.steps.map((st, i) => [
      String(i + 1),
      st.stages ? `${st.label} · ${st.stages}` : st.label,
      st.by === "agent" ? "Copilot" : "user",
      st.refined ?? "",
      String(st.free),
      pct(st.wR),
      ...(anyGof ? [st.gof !== undefined ? st.gof.toFixed(2) : ""] : []),
    ]),
    ["r", "l", "l", "l", "r", "r", "r"],
  );
  const branches = a.otherBranches ? `\n\n*The table follows the path to the result; ${a.otherBranches} step${a.otherBranches === 1 ? "" : "s"} on branches the analysis left ${a.otherBranches === 1 ? "is" : "are"} kept in the History, not shown.*` : "";
  const start = a.start ? `\n\n${startText(a.start, a.agreementLabel ?? "wR")}` : "";
  const stages = a.method
    ? `\n\nMethod (the skill \`${a.method.skill}\`): ${a.method.stages.map((st) => `${st.done ? "✓" : "○"} ${st.label}${st.optional && !st.done ? ", if needed" : ""}`).join(" · ")}`
    : "";
  const unverified = a.unverified ?? [];
  const notes = a.notes.length > 0 ? `\n\n**The Copilot's notes**\n\n${a.notes.map((t) => `- ${markNumbers(t, unverified, (n) => `${n}†`)}`).join("\n")}` : "";
  return `${a.steps.length} step${a.steps.length === 1 ? "" : "s"} from the History; model ${a.model}.\n\n${steps}${start}${stages}${branches}\n\n**Every check**\n\n${checksTable(a.checks)}${notes}`;
}

function parametersMarkdown(params: readonly RefinementParameter[], technique: ReportInput["technique"]): string {
  if (params.length === 0) return "No parameters.";
  const seen = new Set<string>();
  const blocks: string[] = [];
  const block = (title: string, rows: readonly RefinementParameter[]): string => {
    const free = rows.filter((p) => !p.fixed && !p.expression).length;
    return `**${title}** — ${rows.length} parameter${rows.length === 1 ? "" : "s"}, ${free} refined\n\n${table(
      ["Parameter", "Value", "Unit", "Status"],
      rows.map((p) => shownParameter(p, technique)).map(({ parameter: p, value }) => [p.label, value, KIND_UNIT[p.kind] ?? "", parameterStatus(p)]),
      ["l", "r", "l", "l"],
    )}`;
  };
  for (const g of parameterGroups(technique)) {
    const rows = params.filter((p) => g.kinds.includes(p.kind));
    if (rows.length === 0) continue;
    rows.forEach((p) => seen.add(p.id));
    blocks.push(block(g.title, rows));
  }
  const rest = params.filter((p) => !seen.has(p.id));
  if (rest.length > 0) blocks.push(block("Other parameters", rest));
  return blocks.join("\n\n");
}

function conventionsMarkdown(input: ReportInput, date: string): string {
  const notes = (input.notes ?? []).map((n) => `- ${n}`).join("\n");
  return `${notes ? `**Conventions**\n\n${notes}\n\n` : ""}**Software**\n\n${kvTable(softwareRows(input, date))}`;
}

/** Build the report as a Markdown document: the report, then the appendix with the record behind it. */
export function reportMarkdown(input: ReportInput): string {
  const date = (input.date ?? new Date()).toISOString().slice(0, 10);
  const technique = TECHNIQUE_TITLE[input.technique];
  const primary = input.phases[0]?.structure;
  const section = (title: string, body: string): string => (body ? `## ${title}\n\n${body}` : "");
  let letter = 0;
  const part = (title: string, body: string): string => (body ? `### ${String.fromCharCode(65 + letter++)}. ${title}\n\n${body}` : "");
  const free = input.parameters.filter((p) => !p.fixed && !p.expression).length;
  const parts = [
    `# ${formulaText(input.title)}`,
    `*MATERIA · ${technique}${input.agent ? " · analysed with MATERIA Copilot" : ""} · ${date}*`,
    input.subtitle ?? "",
    section("Result", resultMarkdown(input)),
    section(input.phases.length > 1 ? "Structures" : "Structure", structureMarkdown(input)),
    section("Magnetic structure", input.magnetic ? magneticMarkdown(input.magnetic, primary) : ""),
    section("Fit", fitMarkdown(input)),
    section("Quality and caveats", qualityMarkdown(input)),
    // How to read the numbers, before the appendix: a reader may stop there.
    `*${FOOTER(input, date)}*`,
    `---\n\n## Appendix\n\n*${APPENDIX_NOTE}*`,
    part("Data and model", input.data.length > 0 ? kvTable(input.data) : ""),
    part("Refinement statistics", kvTable(statisticsRows(input))),
    input.agent ? part("The analysis step by step", agentRecordMarkdown(input.agent)) : "",
    part("Caveats in full", caveatsInFull(qualityItems(input)).map((c) => `- **${c.label}:** ${prose(endSentence(c.text))}\n  ${c.detail}`).join("\n")),
    part(`Every parameter · ${input.parameters.length} parameter${input.parameters.length === 1 ? "" : "s"}, ${free} refined`, parametersMarkdown(input.parameters, input.technique)),
    part("Conventions and software", conventionsMarkdown(input, date)),
  ];
  return `${parts.filter((p) => p.trim().length > 0).join("\n\n")}\n`;
}
