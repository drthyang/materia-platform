/**
 * The refinement report as Markdown — the same content as `reportHtml`, for a
 * lab notebook, a repository or an e-mail: the analysis (when the Agent ran
 * it), the data and model, the fit figure, the refined structures with
 * standard uncertainties, the magnetic structure, every parameter and the
 * refinement's diagnostics. The figure is an SVG data URI carrying its own
 * style, so the file stands alone (Markdown viewers that block data URIs show
 * its alt text; the HTML report always has the figure).
 *
 * Pure data → string, like the HTML report; the numbers come from the same
 * `ReportInput` and the same formatting (`formatWithEsd`, IUCr convention).
 */

import type { StructureModel } from "@/core/crystal/types";
import type { RefinementParameter } from "@/core/refinement/types";
import { buildEsdMap, cellEsdsOf, cellVolume, formatWithEsd } from "@/core/export/cif";
import { spaceGroupSymbol } from "@/core/crystal/spaceGroups";
import { crystalComponentsToCartesian } from "@/core/magnetic/moment";
import { kLabel } from "@/core/magnetic/kSearch";
import { magneticSupercell, momentAnchorPosition } from "@/core/crystal/cellExpansion";
import { fobsFcalcSvg, patternFigureSvg } from "@/core/export/reportFigures";
import { markNumbers } from "@/core/export/reportAudit";
import {
  BONDS_NOTE,
  COVALENT_BONDS_NOTE,
  HBOND_NOTE,
  RING_NOTE,
  covalentBondRows,
  boxcarNote,
  displacementColumn,
  formatParameterValue,
  KIND_UNIT,
  parameterGroups,
  parameterStatus,
  posteriorCaveat,
  posteriorStatus,
  shownParameter,
  startText,
  type ReportAgent,
  type ReportBoxcar,
  type ReportPosterior,
  type ReportFigure,
  type ReportInput,
  type ReportMagnetic,
  type ReportPhase,
  type ReportRow,
  shellRows,
} from "@/core/export/report";

const TECHNIQUE_TITLE: Record<ReportInput["technique"], string> = {
  powder: "Rietveld refinement",
  singleCrystal: "Single-crystal refinement",
  pdf: "PDF refinement",
};

/** A table cell: no pipes or line breaks to break the row. */
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

function table(head: readonly string[], rows: readonly (readonly string[])[], align?: readonly ("l" | "r")[]): string {
  const sep = head.map((_, i) => (align?.[i] === "r" ? "---:" : "---"));
  return [`| ${head.map(cell).join(" | ")} |`, `| ${sep.join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

function kvTable(rows: readonly ReportRow[]): string {
  return table(["", ""], rows.map((r) => [`**${r.label}**`, r.value]));
}

const fixed = (v: number, d: number): string => {
  const s = v.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
};

// ---------------------------------------------------------------------------
// Figure: the report's SVG with its own (light) style, as a data URI

const FIGURE_STYLE = `
.frame{fill:none;stroke:#e1e5ea;stroke-width:1}.grid{stroke:#e1e5ea;stroke-width:1;stroke-dasharray:2 4}.zero{stroke:#8e98a3;stroke-width:1}
.tickmark{stroke:#5a6572;stroke-width:1}.excl{fill:rgba(110,120,132,.10)}
.axistext{font-family:Menlo,Consolas,monospace;font-size:11px;fill:#5a6572}.axistitle,.legend{font-family:system-ui,sans-serif;font-size:12px;fill:#5a6572}
.ticklabel{font-family:Menlo,Consolas,monospace;font-size:10.5px}
.obs{stroke:#23486f;stroke-width:2.6;stroke-linecap:round;fill:none}.obsline{stroke:#23486f;stroke-width:1.4;fill:none}
.calc{stroke:#c8352e;stroke-width:1.5;fill:none}.diff{stroke:#4f7a33;stroke-width:1.2;fill:none}.bkg{stroke:#98a3ae;stroke-width:1.1;stroke-dasharray:5 4;fill:none}
.unity{stroke:#8e98a3;stroke-width:1;stroke-dasharray:4 4}.pt{stroke:#23486f;stroke-width:4.2;stroke-linecap:round;opacity:.7;fill:none}
.ptmag{stroke:#c8352e;stroke-width:4.6;stroke-linecap:round;opacity:.8;fill:none}`;

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

/** Significant figures, without exponents for ordinary values (as the HTML report). */
function sig(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(Math.max(1, digits - 1));
  return fixed(v, Math.min(Math.max(0, digits - 1 - Math.floor(Math.log10(a))), 8));
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

function agentMarkdown(a: ReportAgent): string {
  const pct = (v: number | undefined): string => (v === undefined ? "" : `${(100 * v).toFixed(2)} %`);
  const anyGof = a.steps.some((st) => st.gof !== undefined);
  const steps = table(
    ["#", "Step", "By", "Refined", "Free", a.agreementLabel ?? "wR", ...(anyGof ? ["GoF"] : [])],
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
  const label = { pass: "pass", note: "note", warn: "attention" } as const;
  const checks = table(["Check", "Result", "Detail"], a.checks.map((c) => [c.name, label[c.status], c.detail]));
  const issues = a.openIssues.length > 0 ? a.openIssues.map((t) => `- ${t}`).join("\n") : "None: the engine's checks raised nothing left to settle.";
  const unverified = a.unverified ?? [];
  const notes = a.notes.length > 0 ? `\n\n**The Copilot's notes**\n\n${a.notes.map((t) => `- ${markNumbers(t, unverified, (n) => `${n}†`)}`).join("\n")}` : "";
  const account = a.narrative?.trim() ? markNumbers(a.narrative.trim(), unverified, (t) => `${t}†`) : "";
  const narrative = account
    ? `\n\n**The Copilot's account**\n\n${account.split(/\n\s*\n/).map((p) => `> ${p.trim().replace(/\n/g, "\n> ")}`).join("\n>\n")}\n\n*Written by MATERIA Copilot (${a.model}) in its own words, as are its notes. Every other number in this report — the steps, the checks, the parameters, the agreement factors and the figure — comes from the refinement engine and the project's History, not from the model.${unverified.length > 0 ? " Numbers marked † in the Copilot's words are not among the values this report computed." : ""}*`
    : "";
  const posterior = a.posterior ? `\n\n${posteriorMarkdown(a.posterior)}` : "";
  return `**How the analysis was done** — ${a.steps.length} step${a.steps.length === 1 ? "" : "s"} from the History; model ${a.model}.\n\n${steps}${start}${stages}${branches}\n\n**Checks**\n\n${checks}\n\n**Open issues**\n\n${issues}${notes}${posterior}${narrative}`;
}

function phaseMarkdown(phase: ReportPhase, index: number, total: number, technique: ReportInput["technique"]): string {
  const st = phase.structure;
  const esd = buildEsdMap(phase.params, phase.bindings);
  const sg = st.spaceGroup;
  const sgText = `${spaceGroupSymbol(sg) ?? "no symbol"}${sg.number !== undefined ? ` (No. ${sg.number})` : ""}`;
  const role = phase.role ?? (total > 1 ? (index === 0 ? "primary phase" : `phase ${index + 1}`) : undefined);
  const adp = displacementColumn(phase, technique);
  const sites = table(
    ["Site", "Type", "x", "y", "z", "Occ.", `${adp.symbol}_${adp.sub} (Å²)`],
    st.sites.map((s) => {
      const pe = esd.pos.get(s.label);
      return [
        s.label, s.element,
        formatWithEsd(s.position[0], pe?.[0], 5), formatWithEsd(s.position[1], pe?.[1], 5), formatWithEsd(s.position[2], pe?.[2], 5),
        formatWithEsd(s.occupancy, esd.occ.get(s.label), 4), adp.value(s),
      ];
    }),
    ["l", "l", "r", "r", "r", "r", "r"],
  );
  const c = st.cell;
  const ce = cellEsdsOf(st, esd);
  const cellRow = table(
    ["a (Å)", "b (Å)", "c (Å)", "α (°)", "β (°)", "γ (°)", "V (Å³)"],
    [[
      formatWithEsd(c.a, ce.cell.a, 5), formatWithEsd(c.b, ce.cell.b, 5), formatWithEsd(c.c, ce.cell.c, 5),
      formatWithEsd(c.alpha, ce.cell.alpha, 4), formatWithEsd(c.beta, ce.cell.beta, 4), formatWithEsd(c.gamma, ce.cell.gamma, 4),
      ce.volume !== undefined ? formatWithEsd(cellVolume(c), ce.volume, 3) : fixed(cellVolume(c), 3),
    ]],
    ["r", "r", "r", "r", "r", "r", "r"],
  );
  const shells = shellRows(st);
  const covalent = phase.bonds ? covalentBondRows(phase.bonds) : [];
  const bonds = covalent.length > 0
    ? `\n\n${table(["Site", "Bonds (Å)"], covalent.map((r) => [r.site, r.bonds]), ["l", "l"])}\n\n*${COVALENT_BONDS_NOTE}*`
    : !phase.bonds && shells.length > 0
      ? `\n\n${table(["Site", "Bonds (Å)", "Mean (Å)"], shells.map((r) => [r.site, r.bonds, r.mean]), ["l", "l", "r"])}\n\n*${BONDS_NOTE}*`
      : "";
  // The ring centroids and hydrogen bonds under a molecule's bond table.
  const rings = phase.rings && phase.rings.contacts.length > 0 ? `\n\n**Ring centroids.** ${phase.rings.rings.join("; ")}. ${phase.rings.contacts.join(" · ")}.\n\n*${RING_NOTE}*` : "";
  const hbonds = phase.hydrogenBonds && phase.hydrogenBonds.length > 0 ? `\n\n**Hydrogen bonds.** ${phase.hydrogenBonds.join(" · ")}.\n\n*${HBOND_NOTE}*` : "";
  return `### ${st.name || st.id} — ${sgText}${role ? ` · ${role}` : ""}\n\n${cellRow}\n\n${sites}${bonds}${rings}${hbonds}`;
}

function boxcarMarkdown(b: ReportBoxcar): string {
  const rows = b.rows.map((row) => [`${fixed(row.r[0], 2)}–${fixed(row.r[1], 2)}`, fixed(100 * row.rw, 2), ...row.values.map((v) => (Number.isFinite(v) ? fixed(v, b.decimals) : "—"))]);
  return `${table(["r (Å)", "Rw (%)", ...b.columns], rows, ["r", "r", ...b.columns.map(() => "r" as const)])}\n\n*${boxcarNote(b)}*`;
}

function magneticMarkdown(m: ReportMagnetic, fallback: StructureModel | undefined): string {
  const structure = m.structure ?? fallback;
  if (!structure) return "";
  const supercell = magneticSupercell(m.k);
  const isSuper = supercell.some((n) => n > 1);
  const facts: ReportRow[] = [
    { label: "Propagation vector", value: `k = ${kLabel(m.k)}` },
    { label: "Magnetic space group", value: m.group.symbol },
    ...(m.group.numbers ? [{ label: "Numbers", value: m.group.numbers }] : []),
    ...(m.group.setting ? [{ label: "Setting", value: m.group.setting }] : []),
    ...(m.group.index !== undefined ? [{ label: "Index in the grey group", value: String(m.group.index) }] : []),
    { label: "Parent space group", value: structure.spaceGroup.hermannMauguin ?? "—" },
    { label: "Magnetic cell", value: isSuper ? `${supercell.join(" × ")} supercell of the nuclear cell` : "the nuclear cell (k = 0)" },
  ];
  const moments = table(
    ["Site · orbit", "Position (fractional)", "m along a, b, c (µB)", "|m| (µB)"],
    m.magnetic.moments.map((mm) => {
      const site = structure.sites.find((s) => s.label === mm.siteLabel);
      const pos = site
        ? momentAnchorPosition(structure.spaceGroup.operations, m.magnetic.operations ?? structure.spaceGroup.operations, site.position, mm.orbitIndex, mm.position)
        : mm.position ?? [0, 0, 0];
      const cart = crystalComponentsToCartesian(structure.cell, mm.components);
      return [
        `${mm.siteLabel} · orbit ${mm.orbitIndex && mm.orbitIndex > 1 ? mm.orbitIndex : 1}`,
        `${fixed(pos[0]!, 4)}, ${fixed(pos[1]!, 4)}, ${fixed(pos[2]!, 4)}`,
        `${fixed(mm.components[0]!, 3)}, ${fixed(mm.components[1]!, 3)}, ${fixed(mm.components[2]!, 3)}`,
        fixed(Math.hypot(cart[0]!, cart[1]!, cart[2]!), 3),
      ];
    }),
    ["l", "r", "r", "r"],
  );
  const params = m.params.length > 0
    ? `\n\n${table(["Moment parameter", "Value (µB)", "Status"], m.params.map((p) => [p.label, formatParameterValue(p), parameterStatus(p)]), ["l", "r", "l"])}`
    : "";
  return `*${m.status}*\n\n${kvTable(facts)}${params}\n\n${moments}`;
}

function parametersMarkdown(params: readonly RefinementParameter[], technique: ReportInput["technique"]): string {
  if (params.length === 0) return "No parameters.";
  const seen = new Set<string>();
  const blocks: string[] = [];
  const block = (title: string, rows: readonly RefinementParameter[]): string => {
    const free = rows.filter((p) => !p.fixed && !p.expression).length;
    return `### ${title} · ${rows.length} parameter${rows.length === 1 ? "" : "s"}, ${free} refined\n\n${table(
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

function detailsMarkdown(input: ReportInput): string {
  const r = input.result;
  const labelOf = new Map(input.parameters.map((p) => [p.id, p.label]));
  const free = input.parameters.filter((p) => !p.fixed && !p.expression).length;
  const rows: ReportRow[] = [{ label: "Free parameters", value: `${free} of ${input.parameters.length}` }];
  if (r) {
    rows.push({ label: "Engine", value: `${r.status}${r.history.length > 0 ? ` after ${r.history.length} cycle${r.history.length === 1 ? "" : "s"}` : ""}` });
    const last = r.history[r.history.length - 1];
    if (last) rows.push({ label: "Final χ² (Σ w Δ²)", value: last.chiSquared.toPrecision(6) });
    if (r.agreement.rWeighted !== undefined) rows.push({ label: "Weighted R", value: `${(100 * r.agreement.rWeighted).toFixed(3)} %` });
    if (r.agreement.rExpected !== undefined) rows.push({ label: "Expected R", value: `${(100 * r.agreement.rExpected).toFixed(3)} %` });
    if (r.agreement.goodnessOfFit !== undefined) rows.push({ label: "Goodness of fit S", value: r.agreement.goodnessOfFit.toFixed(3) });
    const diag = r.diagnostics;
    if (diag && diag.svdZeroCount > 0) rows.push({ label: "Null directions", value: `${diag.svdZeroCount} dropped by SVD — esds on the involved parameters are not meaningful` });
    if (diag && diag.highCorrelations.length > 0) {
      rows.push({
        label: "Strong correlations",
        value: diag.highCorrelations.slice(0, 6).map((c) => `${labelOf.get(c.parameterIdA) ?? c.parameterIdA} / ${labelOf.get(c.parameterIdB) ?? c.parameterIdB} ${c.coefficient.toFixed(3)}`).join("; "),
      });
    }
    if (r.message) rows.push({ label: "Engine note", value: r.message });
  } else {
    rows.push({ label: "Engine", value: "no refinement run in this session — values are as loaded or set" });
  }
  const warnings = (input.warnings ?? []).map((w) => `> ⚠ ${w}`).join("\n");
  const notes = (input.notes ?? []).map((n) => `- ${n}`).join("\n");
  return `${kvTable(rows)}${warnings ? `\n\n${warnings}` : ""}${notes ? `\n\n**Conventions**\n\n${notes}` : ""}`;
}

/** Build the report as a Markdown document. */
export function reportMarkdown(input: ReportInput): string {
  const date = (input.date ?? new Date()).toISOString().slice(0, 10);
  const technique = TECHNIQUE_TITLE[input.technique];
  const primary = input.phases[0]?.structure;
  let n = 0;
  const section = (title: string, body: string): string => (body ? `## ${++n}. ${title}\n\n${body}` : "");
  const stats = input.stats.length > 0 ? table(input.stats.map((s) => s.label), [input.stats.map((s) => s.value)], input.stats.map(() => "r" as const)) : "";
  const parts = [
    `# ${input.title}`,
    `*MATERIA · ${technique} report${input.agent ? " · analysed with MATERIA Copilot" : ""} · ${date}*`,
    input.subtitle ?? "",
    input.summary ?? "",
    stats,
    section("The analysis", input.agent ? agentMarkdown(input.agent) : ""),
    section("Data & model", input.data.length > 0 ? kvTable(input.data) : ""),
    section("Fit", input.figure ? figureMarkdown(input.figure) : ""),
    section("Local versus average", input.boxcar ? boxcarMarkdown(input.boxcar) : ""),
    section(input.phases.length > 1 ? "Atomic structures" : "Atomic structure", input.phases.map((p, i) => phaseMarkdown(p, i, input.phases.length, input.technique)).join("\n\n")),
    section("Magnetic structure", input.magnetic ? magneticMarkdown(input.magnetic, primary) : ""),
    section("Parameters", parametersMarkdown(input.parameters, input.technique)),
    section("Refinement details", detailsMarkdown(input)),
    `---\n\n*Generated by MATERIA Workbench${input.appVersion ? ` v${input.appVersion}` : ""} on ${date}. Values in parentheses are standard uncertainties in the last digit(s), from the least-squares covariance of this fit; a value without one was fixed, set by a constraint, or not part of the last refinement; a tied value carries its leader's. MATERIA is in public beta — reproduce results you intend to publish in an established package.*`,
  ];
  return `${parts.filter((p) => p.trim().length > 0).join("\n\n")}\n`;
}
