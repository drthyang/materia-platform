/**
 * An isotropic B that refines to 0 (its lower bound): what to hold it at, and
 * why — the owner's rule (issue M10), as a proposal the user applies, never a
 * silent change.
 *
 * A B on its bound has no esd worth the name and usually absorbs an error
 * elsewhere (assessment.ts says what to look at). When the fit is otherwise
 * settled, the B is fixed at a reasonable value with a warning, from the first
 * rule that applies:
 *
 * - **A. A tie** to the B of a chemically similar site that refined sensibly
 *   (free, off its bounds, positive, at least twice its esd): the same element
 *   first, then the same role and coordination (a cation with as many of the
 *   same ligands, from coordinationShells). It is a constraint, so the common
 *   B still refines from the data (the existing user tie, constraints.ts).
 * - **B. The starting structure's B** for that site (a CIF's U_iso is read as
 *   B = 8π²U), held fixed. The app has no temperature model for B, so the value
 *   is used as it stands and the warning says so.
 * - **C. A documented typical value** for the element at the measurement
 *   temperature. The repository holds no such table from a citable source, so
 *   rule C proposes nothing: the warning says so and leaves the choice to the
 *   user. No arbitrary small floor is ever proposed.
 *
 * Pure functions over the rows, the bindings and the structures; the pages
 * show the proposals (a notice with Apply, the Agent's approval card) and keep
 * what was applied (`ZeroAdpFix`) beside their rows.
 */

import type { ParameterBinding, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { StructureModel } from "@/core/crystal/types";
import { ANION_ELEMENTS, coordinationShells } from "@/core/crystal/geometry";
import { isUserTie, withEqualTies } from "@/core/refinement/constraints";
import { formatWithEsd } from "@/core/export/cif";

/** Which rule gave the proposal: A a tie, B the starting structure's value, C none (no documented table). */
export type ZeroAdpRule = "A" | "B" | "C";

/** One B at 0 and what is proposed for it. */
export interface ZeroAdpProposal {
  readonly parameterId: string;
  /** The sites the row drives (one, or a shared site's atoms). */
  readonly sites: readonly string[];
  /** "B(O2)", the atom the warning names. */
  readonly atom: string;
  /** The value it reached (its lower bound). */
  readonly reached: number;
  readonly rule: ZeroAdpRule;
  /** Rule A: the row it follows. */
  readonly leader?: string;
  /** Rule B: the value it is held at (Å²). */
  readonly value?: number;
  /** Where the tie or the value comes from, in words. */
  readonly source: string;
  /** The proposal and its source, then the Bayesian caution: the warning after its first sentence. */
  readonly advice: string;
  /** The whole warning: the atom, the B it reached, the proposal and its source. */
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

/**
 * The proposals for every free isotropic B the last refinement left on its
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

  // The partners rule A may tie to: free B rows of the last fit, off every bound, positive and at least twice their esd.
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
    const reached = result.parameters[p.id] ?? atMin.get(p.id)!;
    const head = `${atom} refined to ${fmt(reached)} Å² (its lower bound).`;
    const done = (rule: ZeroAdpRule, source: string, proposal: string, extra: { leader?: string; value?: number }): ZeroAdpProposal => ({
      parameterId: p.id, sites, atom, reached, rule, ...extra, source,
      advice: `${proposal} ${ZERO_ADP_BAYES}`,
      warning: `${head} ${proposal} ${ZERO_ADP_BAYES}`,
    });

    // A — a tie to a chemically similar site that refined sensibly.
    if (rs) {
      const els = elementsOf(rs);
      const model = refined.get(rs.structureId) ?? loaded.get(rs.structureId);
      const anionic = !!model && model.sites.some((s) => ANION_ELEMENTS.has(s.element));
      const role = (labels: readonly string[]): "anion" | "cation" | null => {
        if (!anionic || !model) return null;
        const el = model.sites.find((s) => s.label === labels[0])?.element;
        return el === undefined ? null : ANION_ELEMENTS.has(el) ? "anion" : "cation";
      };
      const mine = { role: role(sites), shell: coordinationOf(model, sites[0]!, cache) };
      const candidates = partners.flatMap((q) => {
        const qs = sitesOf(bindings, q.id);
        if (!qs || qs.structureId !== rs.structureId) return [];
        const qEls = elementsOf(qs);
        if (sameSet(qEls, els)) return [{ q, qs, tier: 0, why: `same element (${els.join("/")})` }];
        // Same role and coordination: two cations with as many of the same ligands.
        if (mine.role === "cation" && role(qs.labels) === "cation" && mine.shell && mine.shell === coordinationOf(model, qs.labels[0]!, cache)) {
          return [{ q, qs, tier: 1, why: `same role and coordination (a cation with ${mine.shell} neighbours, as ${qs.labels.join("/")} has)` }];
        }
        return [];
      });
      const rel = (q: RefinementParameter): number => (result.esd?.[q.id] ?? 0) / result.parameters[q.id]!;
      candidates.sort((a, b) => a.tier - b.tier || rel(a.q) - rel(b.q));
      const best = candidates[0];
      if (best) {
        const v = result.parameters[best.q.id]!;
        const leaderAtom = adpAtom(best.qs.labels, best.q.label);
        const source = `rule A: ${leaderAtom} (${best.q.id}), ${best.why}, refined to ${formatWithEsd(v, result.esd![best.q.id]!, 4)} Å²`;
        return done("A", source, `Proposed (rule A): tie it to ${leaderAtom}, ${best.why}, which refined to ${formatWithEsd(v, result.esd![best.q.id]!, 4)} Å² — a constraint, so the common B still refines from the data.`, { leader: best.q.id });
      }
    }

    // B — the starting structure's value for the site, as it stands.
    if (rs) {
      const model = loaded.get(rs.structureId);
      const values = rs.labels.map((l) => {
        const adp = model?.sites.find((s) => s.label === l)?.adp;
        return adp?.kind === "isotropic" ? adp.bIso : NaN;
      });
      const v = values[0]!;
      if (Number.isFinite(v) && v > 0 && values.every((x) => Math.abs(x - v) <= 1e-6)) {
        const name = model?.name || model?.id || "the loaded structure";
        const source = `rule B: the B of ${sites.join("/")} in the loaded starting structure "${name}" (a CIF's U_iso is read as B = 8π²U), used as it stands: the app has no temperature model for B, so it is not adjusted to the measurement temperature`;
        return done("B", source, `Proposed (rule B): hold it at ${fmt(v)} Å², ${source.slice("rule B: ".length)}.`, { value: v });
      }
    }

    // C — no documented table of typical B values: nothing is proposed.
    const why = "no chemically similar site refined sensibly to tie it to, the starting structure gives it no B, and the app holds no documented table of typical B values by element and temperature";
    return done("C", `rule C: no value (${why})`, `No value is proposed (${why}). Find the cause first (the background, absorption or a correlation: diagnose_fit), or hold it at a value you can cite.`, {});
  });
}

/** The rows with a proposal applied: rule A ties the row to its leader (a user tie), rule B holds it fixed at the value. Rule C changes nothing. */
export function withZeroAdpProposal(params: readonly RefinementParameter[], proposal: ZeroAdpProposal): RefinementParameter[] {
  if (proposal.rule === "A" && proposal.leader) return withEqualTies(params, { equal: [proposal.leader, proposal.parameterId] });
  if (proposal.rule === "B" && proposal.value !== undefined) {
    const value = proposal.value;
    return params.map((p) => (p.id === proposal.parameterId ? { ...p, value, fixed: true } : p));
  }
  return [...params];
}

/** The record of an applied proposal. Throws for rule C, which has nothing to apply. */
export function zeroAdpFix(proposal: ZeroAdpProposal): ZeroAdpFix {
  if (proposal.rule === "C") throw new Error(`${proposal.atom}: no value is proposed (rule C), so there is nothing to apply`);
  return {
    parameterId: proposal.parameterId, atom: proposal.atom, reached: proposal.reached, rule: proposal.rule,
    ...(proposal.leader ? { leader: proposal.leader } : {}),
    ...(proposal.value !== undefined ? { value: proposal.value } : {}),
    source: proposal.source,
  };
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
  return `${fix.atom} refined to ${fmt(fix.reached)} Å² (its lower bound) and is ${what} by the B-at-0 rule (${fix.source}). ${fix.rule === "A" ? "Its value follows the tie; it is not measured on its own." : "It is held, not refined: its value is an input, with no esd."}`;
}

/** A History step's label for an applied proposal. */
export function zeroAdpStepLabel(proposal: ZeroAdpProposal): string {
  return proposal.rule === "A" ? `B at 0: tie ${proposal.parameterId} = ${proposal.leader} (rule A)` : `B at 0: hold ${proposal.parameterId} at ${fmt(proposal.value ?? NaN)} Å² (rule B)`;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  return Math.abs(v) >= 0.01 ? v.toFixed(3) : v.toPrecision(2);
}
