/**
 * What holds a call back before it runs (the executor's policy):
 *
 *  - a change waits for the page's method to be read (the method gate);
 *  - refine and boxcar_scan answer to the method's firm rules, and refine to
 *    its order (a note, not a refusal);
 *  - refine never runs a free set with a correlated pair (the correlation
 *    guard), and its answer names the pairs that developed on the way;
 *  - review_symmetry waits for the method's stages and a converged fit;
 *  - a change approved on a page that has changed since is not run.
 *
 * Each check returns why, or null; the executor turns it into the refusal the
 * model reads and the drawer's line.
 */

import type { AgentPage, LiveToolSpec } from "@/agent/tools";
import type { AgentPort } from "@/agent/port";
import { matchIds } from "@/agent/liveCommon";
import { correlationRefusal, refusalLine } from "@/agent/correlationCheck";
import { PROBE_OPTIONS, carriedText, pairText, readCorrelations } from "@/core/diagnostics/correlationGuard";
import { PAGE_METHOD } from "@/agent/skills";
import { INSTRUMENT_KINDS, outOfOrder, ruleRefusal, stagesLeft, type AgentRecord } from "@/agent/method";
import type { PageAdapter, StateOf } from "@/agent/pages";
import { isMomentParameterKind, type LinearRestraint, type RefinementParameter, type RefinementResult } from "@/core/refinement/types";

/** Who refused a call: the method gate, a running fit, a firm rule, the correlation guard, the symmetry review's gate, or a page changed while the card waited. */
export type RefusalKind = "method" | "busy" | "firm-rule" | "correlation" | "symmetry-gate" | "report-gate" | "stale";

/** A call refused by a rule or a guard: an error to the model, `refused` to the loop. */
export class Refusal extends Error {
  constructor(message: string, readonly by: RefusalKind) {
    super(message);
  }
}

/** A refusal with the drawer's line for it. */
export interface Held {
  readonly message: string;
  readonly line: string;
}

/** A change waits until the method it follows (the tool's own skill, else the page's) has been read in this conversation. */
export function methodGate(spec: LiveToolSpec, page: AgentPage, skillsRead: ReadonlySet<string>, skills: boolean): Refusal | null {
  const method = spec.skill ?? PAGE_METHOD[page];
  if (!skills || skillsRead.has(method)) return null;
  const what = spec.skill ? `it is how the user works on this step` : `it is how the user works on this page`;
  return new Refusal(`read the method first: call read_skill with name "${method}" — ${what}, and changes wait until it has been read in this conversation`, "method");
}

/**
 * The method's firm rules for a refinement (refine, or boxcar_scan on the set
 * it is given), then its order: a rule refuses, the order only notes. `record`
 * is read only for those two tools.
 */
export function firmRules(
  name: string,
  input: Record<string, unknown>,
  page: AgentPage,
  before: { readonly parameters: readonly RefinementParameter[]; readonly restraints: readonly LinearRestraint[] },
  record: () => AgentRecord,
  skills: boolean,
): { readonly rule: Held | null; readonly orderNote: string | null } {
  if (name !== "refine" && name !== "boxcar_scan") return { rule: null, orderNote: null };
  const rec = record();
  const freeBefore = before.parameters.filter((p) => !p.fixed && !p.expression);
  // A scan given its own free set refines that set, not the page's.
  const scanFree = name === "boxcar_scan" && Array.isArray(input.free) ? new Set(matchIds(before.parameters, input.free as string[])) : null;
  const ruleFree = scanFree ? before.parameters.filter((p) => scanFree.has(p.id) && !p.expression) : freeBefore;
  const rule = ruleRefusal(page, ruleFree, before.restraints, rec, before.parameters);
  if (rule) return { rule, orderNote: null };
  // The method's order is the skills' (arm C has none).
  return { rule: null, orderNote: name === "refine" && skills ? outOfOrder(page, freeBefore, rec, before.parameters) : null };
}

/**
 * Correlated parameters are never refined together: the free set is measured
 * first, and only a set that may run goes to the user. Either the refusal, or
 * what the approval card adds about the correlations.
 */
export async function correlationGate<P extends AgentPort>(page: PageAdapter<P>, port: P, before: StateOf<P>): Promise<{ readonly refused: Held } | { readonly note: string }> {
  let probe: RefinementResult;
  try {
    probe = await port.probe(PROBE_OPTIONS);
  } catch (e) {
    throw new Error(`could not check the free parameters' correlations before refining (${e instanceof Error ? e.message : String(e)}); nothing was refined`, { cause: e });
  }
  const check = readCorrelations(probe, before.parameters, before.restraints, page.assemblies(before));
  const refusal = correlationRefusal(check);
  if (refusal) return { refused: { message: refusal, line: refusalLine(check) } };
  return {
    note: check.carried.length > 0 ? ` · ${check.carried.map(carriedText).join("; ")}, carried by the other free parameters`
      : check.strongest ? ` · strongest correlation ${pairText(check.strongest)}` : " · no correlation above 0.5",
  };
}

/**
 * Correlations at the minimum the refinement reached: the check before it ran
 * read the starting values, and a pair can tighten on the way. The next
 * refinement refuses the set until one of each pair is fixed.
 */
export function developedCorrelations(r: RefinementResult, parameters: readonly RefinementParameter[], restraints: readonly LinearRestraint[], assemblies: ReadonlyMap<string, string>): Record<string, unknown> {
  const check = readCorrelations(r, parameters, restraints, assemblies);
  const carried = check.carried.length > 0
    ? { carriedCorrelations: check.carried.map(carriedText), carriedNote: "Correlated, and refined together: through the other free parameters (with them held fixed each pair separates); as the overall intensity terms (scale, extinction, batch scales), one disorder's alternatives, or the domains of a twin with both hands, as every single-crystal program refines them; or as the TOF peak-shape terms (α, β, σ and the zero), as GSAS-II refines an instrument's profile. The correlation is in their esds: read them before quoting them." }
    : {};
  if (check.correlated.length === 0 && check.undetermined.length === 0) return carried;
  return {
    ...carried,
    correlated: check.correlated.map(pairText),
    ...(check.undetermined.length > 0 ? { undetermined: check.undetermined } : {}),
    correlationNote: "These parameters correlate at the refined values. Fix one of each pair before the next refinement; refine will not run with them all free.",
  };
}

/**
 * Why the space group may not be questioned yet, or null: the method's
 * required stages must be refined, and the fit on screen converged. Without
 * the skills (arm C) there are no stages: a converged fit only.
 */
export function symmetryNotYet(page: AgentPage, record: AgentRecord, status: string | undefined, skills: boolean): Held | null {
  const left = skills ? stagesLeft(page, record) : [];
  const why = "The space group is the last thing questioned: a structure is refined to the best its group allows first, and intensity that differs on the group's own reflections is what that refinement fixes, not evidence against the group.";
  if (left.length > 0) {
    return {
      line: `Not yet: ${left.length} stage${left.length === 1 ? "" : "s"} to refine first`,
      message: `Not yet. ${why} Refine these stages of ${PAGE_METHOD[page]} first, each to convergence: ${left.join(", ")}. Then, only if the fit is still not good, review the symmetry.`,
    };
  }
  if (status !== "converged") {
    return {
      line: "Not yet: no converged refinement on screen",
      message: `Not yet: the review reads the refined residual, and the fit on screen is ${status ? `"${status}"` : "not refined"}. ${why} Refine to convergence first.`,
    };
  }
  return null;
}

/**
 * Why the report waits, or null: on the powder page with a magnetic model in the refinement, the
 * magnetic workflow ends with a final instrument pass (magnetic-analysis Stage 5) — the peak shape was
 * fitted before the magnetic peaks were modelled — so the report comes once the last converged
 * refinement freed the instrument's terms and nothing else. Without the skills (arm C) there is no
 * workflow to keep.
 */
export function reportNotYet(page: AgentPage, parameters: readonly RefinementParameter[], result: RefinementResult | null | undefined, skills: boolean): Held | null {
  if (!skills || page !== "powder" || !parameters.some((p) => isMomentParameterKind(p.kind))) return null;
  const kind = new Map(parameters.map((p) => [p.id, p.kind] as const));
  const refined = result?.status === "converged" ? Object.keys(result.esd).map((id) => kind.get(id)) : [];
  if (refined.length > 0 && refined.every((k) => k !== undefined && INSTRUMENT_KINDS.has(k))) return null;
  return {
    line: "Not yet: the final instrument pass",
    message: `Not yet. ${PAGE_METHOD[page]}'s magnetic step ends with a final instrument pass (magnetic-analysis Stage 5): the peak shape was fitted before the magnetic peaks were modelled. Free only the instrument's terms — the zero and the peak shape with its asymmetry (TOF α, β, σ; constant wavelength U, V, W, X, Y and S/L, H/L) — with everything else held (the moments, the structure, the microstrain, the scale and the background), and refine to convergence; a term that lands on its bound is fixed alone and the rest refined again. Then write the report, quoting the fit before and after the pass.`,
  };
}

/** Why an approved change may no longer run (the page closed, a fit running, or anything checked changed while the card waited), or null. */
export function staleReason(now: { readonly busy: boolean } | null, sameStamp: boolean): string | null {
  if (now && !now.busy && sameStamp) return null;
  return now?.busy ? "a refinement is running" : "the analysis changed while it waited for approval";
}
