/**
 * An isotropic B that refines to 0 (its lower bound): what it could be held
 * at, and why — the owner's rule (issue M10), as ranked options the user
 * chooses from, never a silent change.
 *
 * A B on its bound has no esd worth the name and usually absorbs an error
 * elsewhere (assessment.ts says what to look at). The options, in order:
 *
 * 1. **A tie to a site of the same element** that refined sensibly (free, off
 *    its bounds, positive, at least twice its esd): the preferred option. It
 *    is a constraint, so the common B still refines (the existing user tie,
 *    constraints.ts).
 * 2. **A tie to another similar site**, a cation with the same coordination (as
 *    many of the same ligands, from coordinationShells): weaker alternatives,
 *    each labelled with both sites' species and a caution — tying two different
 *    cations is often not physically sensible, and the user judges it.
 * 3. **The starting structure's B** for that site (a CIF's U_iso is read as
 *    B = 8π²U), held fixed: a further alternative beside the ties. The app has
 *    no temperature model for B, so the value is used as it stands.
 *
 * With none of these, nothing is proposed (rule C): the repository holds no
 * documented table of typical B values by element and temperature, and no
 * arbitrary small floor is ever proposed.
 *
 * Pure functions over the rows, the bindings and the structures; the pages
 * show every option (a notice with an Apply per option, the Agent's approval
 * card) and keep what was applied (`ZeroAdpFix`) beside their rows.
 *
 * The prose here (`warning`, `advice`, each option's `text`, `zeroAdpFixText`)
 * is what the Agent reads, and is frozen (agentVisibleText.test.ts). The pages
 * word the same things in short lines of their own (zeroAdpLines.ts), built
 * from the structured facts each option and fix carries (`ZeroAdpFacts`).
 */

import type { ParameterBinding, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { AtomSite, StructureModel } from "@/core/crystal/types";
import { ANION_ELEMENTS, coordinationShells } from "@/core/crystal/geometry";
import { isUserTie, withEqualTies } from "@/core/refinement/constraints";
import { formatWithEsd } from "@/core/export/cif";

/** A: a tie; B: the starting structure's value; C: nothing to propose (no documented table). */
export type ZeroAdpRule = "A" | "B" | "C";

/**
 * An option's facts without its prose: what the pages' short lines are built
 * from (zeroAdpLines.ts). The Agent reads the prose (`text`, `label`, `caution`).
 */
export interface ZeroAdpFacts {
  readonly rule: "A" | "B";
  /** "preferred": a tie to a site of the same element; every other option is an alternative. */
  readonly rank: "preferred" | "alternative";
  /** Rule A: the row it follows. */
  readonly leader?: string;
  /** Rule A: the leader's atom as the warning names it ("B(O1)", "B(Co1 +5)"). */
  readonly leaderAtom?: string;
  /** Rule A: what the leader refined to when the option was offered, and its esd (Å²). */
  readonly leaderValue?: number;
  readonly leaderEsd?: number;
  /** Rule A: what the two sites share — the element, or the coordination of two different cations. */
  readonly shared?: "element" | "coordination";
  /** Rule A, a shared coordination: the cation's first shell ("6 O", "4 O + 2 F"). */
  readonly shell?: string;
  /** Rule A: how the two sites differ, when they do (the subject of the caution). */
  readonly differs?: "cation" | "oxidation state";
  /** Rule B: the value it is held at (Å²). */
  readonly value?: number;
}

/** One way to hold a B at 0: a tie or the starting structure's value, ranked. */
export interface ZeroAdpOption extends ZeroAdpFacts {
  /** Stable within its proposal: "tie:B_O1" for a tie to that row, "start" for the starting structure's value. */
  readonly id: string;
  /** What kind of option it is: "same element (O²⁻)", "same coordination (6 O), different cation (W⁶⁺ vs Co²⁺)", "the starting structure's B". */
  readonly label: string;
  /** What the user should check before choosing it. */
  readonly caution?: string;
  /** Where the tie or the value comes from, in words. */
  readonly source: string;
  /** The option in a sentence: "tie it to B(O1), …". */
  readonly text: string;
}

/** One B at 0 and the options for it, the preferred first. */
export interface ZeroAdpProposal {
  readonly parameterId: string;
  /** The sites the row drives (one, or a shared site's atoms). */
  readonly sites: readonly string[];
  /** "B(O2)", the atom the warning names. */
  readonly atom: string;
  /** The phase the row belongs to, when the model has several (its name): the pages' short lines name it. */
  readonly phase?: string;
  /** The value it reached (its lower bound). */
  readonly reached: number;
  /** The first option's rule, or C when there is none. */
  readonly rule: ZeroAdpRule;
  /** Every option, ranked: same-element ties, then same-coordination ties, then the starting structure's value. Empty for rule C. */
  readonly options: readonly ZeroAdpOption[];
  /** The first option's source, or why nothing is proposed. */
  readonly source: string;
  /** The options and their sources, then the Bayesian caution: the warning after its first sentence. */
  readonly advice: string;
  /** The whole warning: the atom, the B it reached, every option with its source. */
  readonly warning: string;
}

/** A proposal the user applied: kept beside the rows (saved with the session), shown in the report and to the Agent. */
export interface ZeroAdpFix {
  readonly parameterId: string;
  readonly atom: string;
  readonly reached: number;
  readonly rule: "A" | "B";
  readonly leader?: string;
  readonly value?: number;
  readonly source: string;
  /** Who chose it: the user (the page's notice, or the Agent's card), or the Agent in auto mode with no card. Absent: the user. */
  readonly chosenBy?: "user" | "agent-auto";
  /** The Agent's reason for its choice, when it gave one. */
  readonly reason?: string;
  /** The options not taken, in words. */
  readonly alternatives?: readonly string[];
  /** The phase of the row, when the model has several. */
  readonly phase?: string;
  /** The applied option's facts and caution, and the facts of those not taken: the pages' short lines. Absent on a fix saved before them. */
  readonly facts?: ZeroAdpFacts;
  readonly caution?: string;
  readonly others?: readonly ZeroAdpFacts[];
}

/** Who applies an option and why: the page's notice and the Agent's card are the user's choice; auto mode is the Agent's. */
export interface ZeroAdpChoice {
  readonly parameterId: string;
  /** The option's index in the proposal's ranked options. */
  readonly option: number;
  readonly chosenBy?: "user" | "agent-auto";
  readonly reason?: string;
}

export interface ZeroAdpInput {
  readonly parameters: readonly RefinementParameter[];
  readonly bindings: readonly ParameterBinding[];
  /** The last refinement: its bounds and esds. Null or absent: no proposal. */
  readonly result: RefinementResult | null | undefined;
  /** The structures as loaded (the reference B of rule B), primary phase first. */
  readonly structures: readonly StructureModel[];
  /** The structures with the current values applied (coordination for rule A); the loaded ones when absent. */
  readonly refined?: readonly StructureModel[];
}

/** The sentence every warning ends on: a B with physical meaning needs its posterior, not a fixed value alone. */
export const ZERO_ADP_BAYES = "If this B carries physical meaning (a conclusion rests on it), run the Bayesian check on it (sample_posterior) before quoting it: a parameter on its bound is not convincing, and its esd means nothing.";

/** An option's facts, the prose left out. */
export function zeroAdpFacts(o: ZeroAdpFacts): ZeroAdpFacts {
  const keys = ["rule", "rank", "leader", "leaderAtom", "leaderValue", "leaderEsd", "shared", "shell", "differs", "value"] as const;
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as unknown as ZeroAdpFacts;
}

/** A row refined in the last fit and free: no tie, not held. */
const refinedFree = (p: RefinementParameter, result: RefinementResult): boolean => !p.fixed && !p.expression && result.parameters[p.id] !== undefined;

/** "B(O2)", "B(Co1/Cu1/Fe1)", "B(Co1 +5)". */
export function adpAtom(sites: readonly string[], fallback: string): string {
  if (sites.length === 0) return `B(${fallback})`;
  return sites.length <= 3 ? `B(${sites.join("/")})` : `B(${sites[0]} +${sites.length - 1})`;
}

interface RowSites {
  readonly structureId: string;
  readonly labels: string[];
}

function sitesOf(bindings: readonly ParameterBinding[], id: string): RowSites | null {
  const own = bindings.filter((b) => b.parameterId === id && b.kind === "bIso" && b.targetKey);
  if (own.length === 0) return null;
  return { structureId: own[0]!.targetId, labels: [...new Set(own.map((b) => b.targetKey!))] };
}

/** "6 O", "4 O + 2 F": a cation's first shell by ligand element; null for an anion or a site with no shell. */
function coordinationOf(model: StructureModel | undefined, label: string, cache: Map<StructureModel, Map<string, string>>): string | null {
  if (!model) return null;
  let shells = cache.get(model);
  if (!shells) {
    shells = new Map();
    const byLabel = new Map(model.sites.map((s) => [s.label, s.element]));
    for (const shell of coordinationShells(model)) {
      const count = new Map<string, number>();
      for (const b of shell.bonds) {
        const el = byLabel.get(b.to) ?? b.to;
        count.set(el, (count.get(el) ?? 0) + b.count);
      }
      shells.set(shell.site, [...count].sort(([a], [b]) => a.localeCompare(b)).map(([el, n]) => `${n} ${el}`).join(" + "));
    }
    cache.set(model, shells);
  }
  return shells.get(label) ?? null;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join();

const SUPERSCRIPT: Readonly<Record<string, string>> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻" };

/** "W⁶⁺", "O²⁻", or "W site" when the structure gives no oxidation state. */
function speciesOf(site: AtomSite): string {
  const q = site.oxidationState;
  if (q === undefined || q === 0) return `${site.element} site`;
  return `${site.element}${`${Math.abs(q)}${q > 0 ? "+" : "-"}`.split("").map((c) => SUPERSCRIPT[c] ?? c).join("")}`;
}

/** A row's species, "Co²⁺/Cu²⁺/Fe²⁺/…" for a shared site. */
function speciesText(model: StructureModel | undefined, labels: readonly string[]): string {
  const all = [...new Set(labels.map((l) => model?.sites.find((s) => s.label === l)).filter((s): s is AtomSite => !!s).map(speciesOf))];
  return all.length <= 3 ? all.join("/") : `${all.slice(0, 3).join("/")}/…`;
}

/**
 * The options for every free isotropic B the last refinement left on its
 * lower bound. Empty when there is no result, or no B on its bound.
 */
export function zeroAdpProposals(input: ZeroAdpInput): ZeroAdpProposal[] {
  const { parameters, bindings, result } = input;
  if (!result) return [];
  const atMin = new Map((result.diagnostics?.atBounds ?? []).filter((b) => b.bound === "min").map((b) => [b.parameterId, b.value]));
  const atAny = new Set((result.diagnostics?.atBounds ?? []).map((b) => b.parameterId));
  const targets = parameters.filter((p) => p.kind === "bIso" && atMin.has(p.id) && refinedFree(p, result));
  if (targets.length === 0) return [];

  const loaded = new Map(input.structures.map((s) => [s.id, s]));
  const refined = new Map((input.refined ?? input.structures).map((s) => [s.id, s]));
  const cache = new Map<StructureModel, Map<string, string>>();
  const elementsOf = (rs: RowSites): string[] => {
    const model = loaded.get(rs.structureId);
    return [...new Set(rs.labels.map((l) => model?.sites.find((s) => s.label === l)?.element ?? "?"))];
  };

  // The partners a tie may follow: free B rows of the last fit, off every bound, positive and at least twice their esd.
  const partners = parameters.filter((p) => {
    if (p.kind !== "bIso" || !refinedFree(p, result) || atAny.has(p.id)) return false;
    const v = result.parameters[p.id]!;
    const esd = result.esd?.[p.id];
    return v > 0 && esd !== undefined && Number.isFinite(esd) && esd > 0 && v >= 2 * esd;
  });

  return targets.map((p) => {
    const rs = sitesOf(bindings, p.id);
    const sites = rs?.labels ?? [];
    const atom = adpAtom(sites, p.label);
    const own = rs ? loaded.get(rs.structureId) : undefined;
    const phase = own && input.structures.length > 1 ? own.name || own.id : undefined;
    const reached = result.parameters[p.id] ?? atMin.get(p.id)!;
    const head = `${atom} refined to ${fmt(reached)} Å² (its lower bound).`;
    const options: ZeroAdpOption[] = [];

    if (rs) {
      // Ties: the same element first (preferred), then cations of the same coordination (alternatives).
      const els = elementsOf(rs);
      const model = refined.get(rs.structureId) ?? loaded.get(rs.structureId);
      const anionic = !!model && model.sites.some((s) => ANION_ELEMENTS.has(s.element));
      const role = (labels: readonly string[]): "anion" | "cation" | null => {
        if (!anionic || !model) return null;
        const el = model.sites.find((s) => s.label === labels[0])?.element;
        return el === undefined ? null : ANION_ELEMENTS.has(el) ? "anion" : "cation";
      };
      const mineSpecies = speciesText(loaded.get(rs.structureId), rs.labels);
      const shell = role(sites) === "cation" ? coordinationOf(model, sites[0]!, cache) : null;
      const rel = (q: RefinementParameter): number => (result.esd?.[q.id] ?? 0) / result.parameters[q.id]!;
      interface Tie { q: RefinementParameter; qs: RowSites; tier: number; label: string; caution?: string; differs?: ZeroAdpFacts["differs"] }
      const ties = partners.flatMap((q): Tie[] => {
        const qs = sitesOf(bindings, q.id);
        if (!qs || qs.structureId !== rs.structureId) return [];
        const theirs = speciesText(loaded.get(rs.structureId), qs.labels);
        if (sameSet(elementsOf(qs), els)) {
          return [{ q, qs, tier: 0, label: `same element (${theirs})`, ...(theirs !== mineSpecies ? { caution: `a different oxidation state (${mineSpecies} vs ${theirs}): check it is physically sensible`, differs: "oxidation state" } : {}) }];
        }
        if (shell && role(qs.labels) === "cation" && shell === coordinationOf(model, qs.labels[0]!, cache)) {
          return [{ q, qs, tier: 1, label: `same coordination (${shell}), different cation (${mineSpecies} vs ${theirs})`, caution: `a different cation (${mineSpecies} vs ${theirs}): check it is physically sensible`, differs: "cation" }];
        }
        return [];
      }).sort((x, y) => x.tier - y.tier || rel(x.q) - rel(y.q));
      for (const t of ties) {
        const v = formatWithEsd(result.parameters[t.q.id]!, result.esd![t.q.id]!, 4);
        const leaderAtom = adpAtom(t.qs.labels, t.q.label);
        options.push({
          id: `tie:${t.q.id}`, rule: "A", rank: t.tier === 0 ? "preferred" : "alternative", leader: t.q.id, label: t.label, ...(t.caution ? { caution: t.caution } : {}),
          leaderAtom, leaderValue: result.parameters[t.q.id]!, leaderEsd: result.esd![t.q.id]!,
          shared: t.tier === 0 ? "element" : "coordination", ...(t.tier === 1 && shell ? { shell } : {}), ...(t.differs ? { differs: t.differs } : {}),
          source: `rule A: ${leaderAtom} (${t.q.id}), ${t.label}, refined to ${v} Å²`,
          text: `tie it to ${leaderAtom}, ${t.label}, which refined to ${v} Å² (a constraint: the common B still refines)${t.caution ? ` — ${t.caution}` : ""}`,
        });
      }
      // Rank: only the first same-element tie is the preferred option.
      for (let i = 1; i < options.length; i++) if (options[i]!.rank === "preferred") options[i] = { ...options[i]!, rank: "alternative" };

      // The starting structure's value for the site, as it stands: an alternative beside the ties.
      const start = loaded.get(rs.structureId);
      const values = rs.labels.map((l) => {
        const adp = start?.sites.find((s) => s.label === l)?.adp;
        return adp?.kind === "isotropic" ? adp.bIso : NaN;
      });
      const v = values[0]!;
      if (Number.isFinite(v) && v > 0 && values.every((x) => Math.abs(x - v) <= 1e-6)) {
        const name = start?.name || start?.id || "the loaded structure";
        const from = `the B of ${sites.join("/")} in the loaded starting structure "${name}" (a CIF's U_iso is read as B = 8π²U), used as it stands: the app has no temperature model for B, so it is not adjusted to the measurement temperature`;
        options.push({ id: "start", rule: "B", rank: "alternative", value: v, label: "the starting structure's B", source: `rule B: ${from}`, text: `hold it at ${fmt(v)} Å², ${from}` });
      }
    }

    if (options.length === 0) {
      // C — no documented table of typical B values: nothing is proposed.
      const why = "no chemically similar site refined sensibly to tie it to, the starting structure gives it no B, and the app holds no documented table of typical B values by element and temperature";
      const advice = `No value is proposed (${why}). Find the cause first (the background, absorption or a correlation: diagnose_fit), or hold it at a value you can cite. ${ZERO_ADP_BAYES}`;
      return { parameterId: p.id, sites, atom, ...(phase ? { phase } : {}), reached, rule: "C" as const, options, source: `rule C: no value (${why})`, advice, warning: `${head} ${advice}` };
    }
    const list = options.map((o, i) => `${i + 1}) ${o.rank} — ${o.text}.`).join(" ");
    const advice = `${options.length === 1 ? "One option" : `${options.length} options`}, none applied until you choose one: ${list} ${ZERO_ADP_BAYES}`;
    return { parameterId: p.id, sites, atom, ...(phase ? { phase } : {}), reached, rule: options[0]!.rule, options, source: options[0]!.source, advice, warning: `${head} ${advice}` };
  });
}

/** The option of a proposal, by its index (the preferred one, 0, by default). Throws for rule C or an index out of range. */
export function zeroAdpOption(proposal: ZeroAdpProposal, index = 0): ZeroAdpOption {
  const o = proposal.options[index];
  if (!o) throw new Error(proposal.options.length === 0 ? `${proposal.atom}: no value is proposed (rule C), so there is nothing to apply` : `${proposal.atom} has ${proposal.options.length} option${proposal.options.length === 1 ? "" : "s"}; there is no option ${index + 1}`);
  return o;
}

/** The rows with an option applied: a tie makes the row follow its leader (a user tie), the starting value holds it fixed. */
export function withZeroAdpProposal(params: readonly RefinementParameter[], proposal: ZeroAdpProposal, index = 0): RefinementParameter[] {
  const o = proposal.options[index];
  if (!o) return [...params];
  if (o.rule === "A" && o.leader) return withEqualTies(params, { equal: [o.leader, proposal.parameterId] });
  const value = o.value!;
  return params.map((p) => (p.id === proposal.parameterId ? { ...p, value, fixed: true } : p));
}

/** The record of an applied option, with who chose it and the options not taken. Throws for rule C, which has nothing to apply. */
export function zeroAdpFix(proposal: ZeroAdpProposal, index = 0, how: { readonly chosenBy?: "user" | "agent-auto"; readonly reason?: string } = {}): ZeroAdpFix {
  const o = zeroAdpOption(proposal, index);
  const others = proposal.options.filter((_, i) => i !== index).map((x) => `${x.rank}: ${x.rule === "A" ? `tie to ${x.leader} (${x.label})` : `hold at ${fmt(x.value!)} Å² (${x.label})`}`);
  return {
    parameterId: proposal.parameterId, atom: proposal.atom, reached: proposal.reached, rule: o.rule,
    ...(o.leader ? { leader: o.leader } : {}),
    ...(o.value !== undefined ? { value: o.value } : {}),
    source: `${o.rank}: ${o.source}${o.caution ? ` (${o.caution})` : ""}`,
    ...(how.chosenBy === "agent-auto" ? { chosenBy: "agent-auto" as const } : {}),
    ...(how.reason ? { reason: how.reason } : {}),
    ...(others.length > 0 ? { alternatives: others } : {}),
    ...(proposal.phase ? { phase: proposal.phase } : {}),
    facts: zeroAdpFacts(o),
    ...(o.caution ? { caution: o.caution } : {}),
    ...(others.length > 0 ? { others: proposal.options.filter((_, i) => i !== index).map(zeroAdpFacts) } : {}),
  };
}

/** The index of the option with this id in a proposal, or −1. */
export function zeroAdpOptionIndex(proposal: ZeroAdpProposal, id: string): number {
  return proposal.options.findIndex((o) => o.id === id);
}

/** The fixes the rows still carry: a tie still to its leader, a value still held. One the user overrode (released, freed, retyped) drops out. */
export function activeZeroAdpFixes(params: readonly RefinementParameter[], fixes: readonly ZeroAdpFix[] | undefined): ZeroAdpFix[] {
  if (!fixes?.length) return [];
  const byId = new Map(params.map((p) => [p.id, p]));
  return fixes.filter((f) => {
    const p = byId.get(f.parameterId);
    if (!p) return false;
    if (f.rule === "A") return isUserTie(p) && p.expression === `= ${f.leader}`;
    return p.fixed && !p.expression && f.value !== undefined && Math.abs(p.value - f.value) <= 1e-9 * Math.max(1, Math.abs(f.value));
  });
}

/** The fixes after applying one: any older record of the row replaced. */
export function withFixRecorded(fixes: readonly ZeroAdpFix[] | undefined, fix: ZeroAdpFix): ZeroAdpFix[] {
  return [...(fixes ?? []).filter((f) => f.parameterId !== fix.parameterId), fix];
}

/** What a fix in force says: the report's limitation, the Agent's note, the History's label. */
export function zeroAdpFixText(fix: ZeroAdpFix): string {
  const what = fix.rule === "A" ? `tied to ${fix.leader}` : `held at ${fmt(fix.value!)} Å²`;
  const who = fix.chosenBy === "agent-auto" ? ` Chosen by the Agent in auto mode, without a card${fix.reason ? ` (its reason: ${fix.reason})` : ""}: release it or undo the step if you would choose otherwise.` : fix.reason ? ` Reason given: ${fix.reason}.` : "";
  const rest = fix.alternatives?.length ? ` Not taken: ${fix.alternatives.join("; ")}.` : "";
  return `${fix.atom} refined to ${fmt(fix.reached)} Å² (its lower bound) and is ${what} by the B-at-0 rule (${fix.source}). ${fix.rule === "A" ? "Its value follows the tie; it is not measured on its own." : "It is held, not refined: its value is an input, with no esd."}${who}${rest}`;
}

/** A History step's label for an applied option. */
export function zeroAdpStepLabel(proposal: ZeroAdpProposal, index = 0, chosenBy?: "user" | "agent-auto"): string {
  const o = zeroAdpOption(proposal, index);
  const by = chosenBy === "agent-auto" ? ", the Agent's choice in auto mode" : "";
  return o.rule === "A" ? `B at 0: tie ${proposal.parameterId} = ${o.leader} (${o.rank}${by})` : `B at 0: hold ${proposal.parameterId} at ${fmt(o.value ?? NaN)} Å² (starting structure${by})`;
}

/** A B as the rule's prose gives it: "0.600", "0" (Å² left to the caller). */
export function formatB(v: number): string {
  return fmt(v);
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  return Math.abs(v) >= 0.01 ? v.toFixed(3) : v.toPrecision(2);
}
