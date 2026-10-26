/**
 * The B-at-0 rule (zeroAdp.ts) in the pages' own words: one short line per
 * proposal, option and fix, the result or the action first, built from the
 * structured facts each carries (the atom, the leader, the values and esds,
 * what the two sites share), never from the prose.
 *
 *   B(W1) is at its 0 bound: tie it to B(Co1) (same coordination) or hold it at 1.453 Å²
 *   B(W1) hit 0 → tied to B(Co1) = 0.6(2) Å² (same 6-O coordination, different cation); not measured on its own
 *   B(O1) hit 0 → held at 0.800 Å² (starting value); not measured
 *
 * A cross-site tie's caution rides along as `caution` (the page shows a ⚠
 * with it as a tooltip; the report a short suffix), and the long text — the
 * warning, the option's sentence, zeroAdpFixText — as `detail`, behind a "?"
 * and in the report's appendix: nothing is dropped, only moved.
 *
 * UI only. The Agent reads the prose of zeroAdp.ts, frozen
 * (agentVisibleText.test.ts); nothing here reaches it.
 */

import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { formatWithEsd } from "@/core/export/cif";
import { formatB, zeroAdpFixText, ZERO_ADP_BAYES, type ZeroAdpFacts, type ZeroAdpFix, type ZeroAdpOption, type ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";

/** One short line, with what it leaves to a tooltip. */
export interface ShortLine {
  /** One line in plain words, the result or the action first. */
  readonly text: string;
  /** A caution the line carries (a tie across two different sites): a ⚠ with it as its tooltip. */
  readonly caution?: string;
  /** The longer account, paragraph by paragraph, for the "?" (and the report's appendix). */
  readonly detail: readonly string[];
  /** The line as the report states it, where `text`'s arrow gives a result, not an action the report would drop. */
  readonly report?: string;
}

/** What a caution asks, as the report's suffix gives it. */
export const CAUTION_SHORT = "check it is physically sensible";

/** The leader's value as it is now: the last fit's with its esd, else the row's, else what it was when offered. */
export interface LeaderNow {
  readonly result?: RefinementResult | null | undefined;
  readonly parameters?: readonly RefinementParameter[] | undefined;
}

const prefix = (phase: string | undefined): string => (phase ? `${phase}: ` : "");

/** "6 O" → "6-O"; several ligands as they are ("4 O + 2 F"). */
const shellWord = (shell: string | undefined): string => (!shell ? "" : /^\d+ \S+$/.test(shell) ? `${shell.replace(" ", "-")} ` : `${shell} `);

/** What the two sites share, in a few words: "same element", "same 6-O coordination, different cation"; `brief` leaves the rest to the ⚠. */
function relation(f: ZeroAdpFacts, brief = false): string | null {
  if (f.shared === "element") return !brief && f.differs === "oxidation state" ? "same element, different oxidation state" : "same element";
  if (f.shared === "coordination") return brief ? "same coordination" : `same ${shellWord(f.shell)}coordination, different cation`;
  return null;
}

/** A B with its esd where the fit gave one: "0.62(5)", else "0.620". */
function bWithEsd(value: number, esd: number | undefined): string {
  return esd !== undefined && Number.isFinite(esd) && esd > 0 ? formatWithEsd(value, esd, 4) : formatB(value);
}

/** The leader's atom: as the warning named it, else its row's id. */
const leaderName = (f: ZeroAdpFacts): string => f.leaderAtom ?? f.leader ?? "its partner";

/** "tie to B(O1) = 0.62(5) Å² (same element)", "hold at 1.453 Å² (starting value)": an option in brief, for a list of them. */
function optionBrief(f: ZeroAdpFacts): string {
  if (f.rule === "B") return `hold at ${formatB(f.value ?? NaN)} Å² (starting value)`;
  const rel = relation(f, true);
  const v = f.leaderValue !== undefined ? ` = ${bWithEsd(f.leaderValue, f.leaderEsd)} Å²` : "";
  return `tie to ${leaderName(f)}${v}${rel ? ` (${rel})` : ""}`;
}

/** One option of a proposal, as the notice lists it beside its Apply: "Tie to B(O1) = 0.62(5) Å² (same element)", "Hold at 1.453 Å² (starting value)". */
export function zeroAdpOptionLine(o: ZeroAdpOption): ShortLine {
  const detail = [`${o.text.charAt(0).toUpperCase()}${o.text.slice(1)}.`];
  if (o.rule === "B") return { text: `Hold at ${formatB(o.value ?? NaN)} Å² (starting value)`, detail };
  const rel = relation(o) ?? o.label;
  const v = o.leaderValue !== undefined ? ` = ${bWithEsd(o.leaderValue, o.leaderEsd)} Å²` : "";
  return { text: `Tie to ${leaderName(o)}${v} (${rel})`, ...(o.caution ? { caution: o.caution } : {}), detail };
}

/** "tie it to B(O1) or B(O3) (same element)": the ties, grouped by what they share, in rank order. */
function tieClause(ties: readonly ZeroAdpOption[]): string {
  const groups: { rel: string | null; names: string[] }[] = [];
  for (const t of ties) {
    const rel = relation(t, true);
    const g = groups.find((x) => x.rel === rel);
    if (g) g.names.push(leaderName(t));
    else groups.push({ rel, names: [leaderName(t)] });
  }
  return `tie it to ${groups.map((g) => `${g.names.join(" or ")}${g.rel ? ` (${g.rel})` : ""}`).join(" or ")}`;
}

/** "B(W1) is at its 0 bound", the phase named when the model has several. */
export function zeroAdpHead(p: ZeroAdpProposal): string {
  return `${prefix(p.phase)}${p.atom} is at its 0 bound`;
}

/**
 * A B the last fit left on 0, with its options in one line: "B(W1) is at its
 * 0 bound: tie it to B(Co1) (same coordination) or hold it at 1.453 Å²", or
 * "… no value to propose — find the cause first" (rule C).
 */
export function zeroAdpProposalLine(p: ZeroAdpProposal): ShortLine {
  const at = zeroAdpHead(p);
  if (p.options.length === 0) {
    return { text: `${at}: no value to propose — find the cause first`, detail: [p.warning], report: `${at}: no value to propose` };
  }
  const ties = p.options.filter((o) => o.rule === "A");
  const start = p.options.find((o) => o.rule === "B");
  const hold = start ? `hold it at ${formatB(start.value ?? NaN)} Å²${ties.length === 0 ? " (starting value)" : ""}` : null;
  const clauses = [ties.length > 0 ? tieClause(ties) : null, hold].filter((c): c is string => c !== null);
  const cautions = [...new Set(p.options.map((o) => o.caution).filter((c): c is string => !!c))];
  const text = `${at}: ${clauses.join(" or ")}`;
  return {
    text,
    ...(cautions.length > 0 ? { caution: cautions.map((c) => `${c.charAt(0).toUpperCase()}${c.slice(1)}.`).join(" ") } : {}),
    detail: [p.warning],
    report: `${text}${cautions.length > 0 ? ` — ${CAUTION_SHORT}` : ""}`,
  };
}

/** The leader's value and esd as they stand, for a fix's line. */
function leaderValue(fix: ZeroAdpFix, now: LeaderNow): { value: number; esd?: number } | null {
  const id = fix.leader;
  const fitted = id !== undefined ? now.result?.parameters[id] : undefined;
  if (fitted !== undefined) return { value: fitted, ...(now.result?.esd?.[id!] !== undefined ? { esd: now.result.esd[id!] } : {}) };
  const row = id !== undefined ? now.parameters?.find((q) => q.id === id) : undefined;
  if (row) return { value: row.value };
  if (fix.facts?.leaderValue !== undefined) return { value: fix.facts.leaderValue, ...(fix.facts.leaderEsd !== undefined ? { esd: fix.facts.leaderEsd } : {}) };
  return null;
}

/**
 * A fix in force: "B(W1) hit 0 → tied to B(Co1) = 0.6(2) Å² (same 6-O
 * coordination, different cation); not measured on its own", or "B(O1) hit 0
 * → held at 0.800 Å² (starting value); not measured". The tied value is the
 * leader's as it stands (the last fit's, with its esd). The options not
 * taken, the Agent's reason and the whole account go to `detail`.
 */
export function zeroAdpFixLine(fix: ZeroAdpFix, now: LeaderNow = {}): ShortLine {
  const facts: ZeroAdpFacts = fix.facts ?? { rule: fix.rule, rank: "alternative", ...(fix.leader ? { leader: fix.leader } : {}), ...(fix.value !== undefined ? { value: fix.value } : {}) };
  const auto = fix.chosenBy === "agent-auto" ? "; the Agent's choice (auto mode)" : "";
  let result: string;
  if (fix.rule === "A") {
    const v = leaderValue(fix, now);
    const rel = relation(facts);
    result = `tied to ${leaderName(facts)}${v ? ` = ${bWithEsd(v.value, v.esd)} Å²` : ""}${rel ? ` (${rel})` : ""}; not measured on its own`;
  } else {
    result = `held at ${formatB(fix.value ?? NaN)} Å² (starting value); not measured`;
  }
  const atom = `${prefix(fix.phase)}${fix.atom}`;
  const reached = formatB(fix.reached);
  const others = fix.others?.length ? fix.others.map(optionBrief) : fix.alternatives ?? [];
  const detail = [
    ...(others.length > 0 ? [`Other options: ${others.join("; ")}.`] : []),
    ...(fix.reason ? [`${fix.chosenBy === "agent-auto" ? "The Agent's reason" : "Reason given"}: ${fix.reason}.`] : []),
    zeroAdpFixText(fix),
  ];
  return {
    text: `${atom} hit ${reached} → ${result}${auto}`,
    ...(fix.caution ? { caution: fix.caution } : {}),
    detail,
    report: `${atom} refined to ${reached} and is ${result}${auto}${fix.caution ? ` — ${CAUTION_SHORT}` : ""}`,
  };
}

/** The report's limitation for a B the fit left on 0 with no option applied: why its value cannot be quoted. */
export function zeroAdpOpenLimitation(p: ZeroAdpProposal): ShortLine {
  return {
    text: `${prefix(p.phase)}${p.atom} refined to ${formatB(p.reached)} with no option applied: its esd means nothing`,
    detail: [`${p.warning.replace(` ${ZERO_ADP_BAYES}`, "")} Not applied: the B is reported on its bound, where its esd means nothing.`],
  };
}
