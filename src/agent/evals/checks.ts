/**
 * The checks the eval scenarios grade a run by. Each is written against a
 * failure seen in the researcher rounds or reported by a user; most read the
 * tool calls (what the Agent did), a few the replies (what it told the user),
 * where a sentence-level reading is enough: a sentence that names the thing
 * and does not negate it.
 */

import { PAGE_METHOD } from "@/agent/skills";
import { groupOf, type ParameterGroup } from "@/agent/method";
import { analysisOf } from "@/agent/pages";
import { announcedTool } from "@/agent/chat";
import { LIVE_TOOLS, liveTool } from "@/agent/tools";
import { convertInterval } from "@/visualization/axisUnits";
import type { PowderAgentPort, PowderLiveState, SingleCrystalLiveState } from "@/agent/port";
import { calls, isChange, replies, type Check, type EvalRun } from "@/agent/evals/harness";

const ok = (detail: string) => ({ pass: true, detail });
const fail = (detail: string) => ({ pass: false, detail });
const json = (text: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Sentences of a reply (Markdown bullets and lines count as sentences too). */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

const NEGATION = /\b(no|not|never|neither|nor|none|nothing|zero|without|don't|doesn't|isn't|aren't|won't|wouldn't|shouldn't|rather than|instead of|before|until|unless|only (if|when|after|once)|last|first refine|premature)\b|n't\b|(?<![\w.])0 (?:[a-z-]+ ){0,2}(?:peaks?|lines?|reflections?)\b/i;

/** The sentences of the replies that say `what` without negating it. */
export function asserted(run: EvalRun, what: RegExp, upTo = Infinity): string[] {
  const out: string[] = [];
  let i = 0;
  for (const e of run.events) {
    if (i >= upTo) break;
    i++;
    if (e.kind !== "reply") continue;
    for (const s of sentences(e.text)) if (what.test(s) && !NEGATION.test(s)) out.push(s);
  }
  return out;
}

/**
 * A swapped unit questioned, not refined around (THY-19 fault injection):
 * no successful refinement, and a reply that names the axis or its unit.
 */
export const questionsAxis: Check = {
  name: "questions the data's axis before refining",
  grade: (run) => {
    const refined = calls(run).some((c) => c.name === "refine" && !c.isError && json(c.text)?.refined === true);
    if (refined) return fail("refined data whose axis cannot be what it says");
    const said = sentences(replies(run).join("\n")).find((t) => /\b(axis|units?|d-spacings?|d spacings?|Å|Q|degrees|2θ|two-theta)\b/i.test(t) && /\b(wrong|swapped|not|another|instead|check|confirm|looks like|appears|seems)\b/i.test(t));
    return said ? ok(`said "${said.slice(0, 90)}"`) : fail("never questioned the axis");
  },
};

/**
 * A wavelength (or calibration) put to the user, not refined around (THY-19
 * fault injection): the cell check run, no successful refinement, and a reply
 * that questions the wavelength.
 */
export const questionsWavelength: Check = {
  name: "questions the wavelength before refining",
  grade: (run) => {
    if (!calls(run).some((c) => c.name === "check_cell_symmetry")) return fail("never checked the cell");
    if (calls(run).some((c) => c.name === "refine" && !c.isError && json(c.text)?.refined === true)) return fail("refined data at a wavelength the peaks contradict");
    const said = sentences(replies(run).join("\n")).find((t) => /\b(wavelength|λ|difC|calibration)\b/i.test(t));
    return said ? ok(`said "${said.slice(0, 90)}"`) : fail("never questioned the wavelength");
  },
};

/** The powder page's own changes: refining, freeing, the fit window and the corrections. */
const POWDER_CHANGES = new Set(["refine", "set_free", "set_fit_range", "set_corrections", "set_background", "reset_parameters"]);

/**
 * On a magnetic question the magnetic step's sequence leads: the k-search
 * comes before any refinement-step change (Track A2: a model that read only
 * the powder checklist went back to the fit range and the stages, and the
 * long method crowded out search_propagation_vector).
 */
export const magneticSequenceFirst: Check = {
  name: "searches k before going back to the powder stages",
  grade: (run) => {
    const all = calls(run).filter((c) => !c.isError);
    const search = all.findIndex((c) => c.name === "search_propagation_vector");
    if (search < 0) return fail("never searched for k");
    const before = all.slice(0, search).filter((c) => POWDER_CHANGES.has(c.name));
    return before.length === 0 ? ok("searched k first") : fail(`went back to the powder stages first: ${before.map((c) => c.name).join(", ")}`);
  },
};

/** Changes wait for the page's method skill (the skill loader: the method is read on demand). */
export const readsMethodFirst: Check = {
  name: "reads the page's method before its first change",
  grade: (run) => {
    const all = calls(run);
    // An attempt counts, refused or not: the executor refuses it, but the Agent did not follow its method.
    const first = all.findIndex((c) => isChange(c.name));
    if (first < 0) return ok("made no change");
    // A step with its own method (the magnetic step) needs that one.
    const method = liveTool(all[first]!.name)?.skill ?? PAGE_METHOD[run.port.technique];
    const read = all.slice(0, first).some((c) => c.name === "read_skill" && c.input.name === method && c.input.reference === undefined && !c.isError);
    return read ? ok(`read ${method}, then ${all[first]!.name}`) : fail(`${all[first]!.name} before reading ${method}`);
  },
};

/** A refinement asked for is run (user report: the Agent refused the full refinement on the cell check). */
export function refines(atLeast: number): Check {
  return {
    name: `runs at least ${atLeast} converged refinement${atLeast === 1 ? "" : "s"}`,
    grade: (run) => {
      const done = calls(run).filter((c) => c.name === "refine" && !c.isError && json(c.text)?.refined === true);
      return done.length >= atLeast ? ok(`${done.length} refinements ran`) : fail(`${done.length} refinement${done.length === 1 ? "" : "s"} ran`);
    },
  };
}

/** The method's stages a converged refinement covered (the record the drawer shows). */
export function coversStages(ids: readonly string[]): Check {
  return {
    name: `covers the stages ${ids.join(", ")}`,
    grade: (run) => {
      const record = run.records.get(analysisOf(run.port));
      const done = new Set(record?.stagesDone ?? []);
      const missing = ids.filter((id) => !done.has(id));
      return missing.length === 0 ? ok(`done: ${[...done].join(", ")}`) : fail(`not done: ${missing.join(", ")}`);
    },
  };
}

const REFUSAL = /\b(can ?not|can't|won't|will not|unable to|not able to|must not|shouldn't)\b[^.]{0,60}\b(refine|run|proceed|continue|start)\b|\bblock(s|ed|ing)?\b[^.]{0,50}\b(refine|refinement)\b|\b(Le Bail|cell|space[- ]group) gate\b/i;

/**
 * A rule about what refines together, not a refusal of the refinement: "the
 * profile width must not refine together with the B values, so I'll fix
 * width" (Haiku, 2026-10-11, citing the instrument–thermal rule as it went
 * on). The gate wording is a refusal whatever follows.
 */
const TOGETHER = /\b(refine|run)\b[^.]{0,50}\b(together|at the same time|simultaneously|alongside|in the same (refinement|cycle|step))\b/i;
const GATE = /\b(Le Bail|cell|space[- ]group) gate\b|\bblock(s|ed|ing)?\b[^.]{0,50}\b(refine|refinement)\b/i;

/** No reply refuses the refinement or invokes a "gate" (user report, 2026-10-10). */
export const doesNotRefuse: Check = {
  name: "does not refuse the refinement or cite a gate",
  grade: (run) => {
    const said = replies(run).flatMap((r) => sentences(r)).filter((s) => REFUSAL.test(s) && (GATE.test(s) || !TOGETHER.test(s)));
    return said.length === 0 ? ok("no refusal") : fail(`said: "${said[0]}"`);
  },
};

const LOWER_SYMMETRY = /\b(lower(ing)?|reduc(e|ing)|drop(ping)?|break(ing)?)\b[^.]{0,30}\bsymmetry\b|\blower[- ]symmetry\b|\b(sub ?group|a lower (space )?group)\b|\bchang(e|ing) (the )?space group\b/i;

/**
 * No symmetry change is proposed before review_symmetry has run on a refined
 * fit (user report: the Agent proposed lowering the symmetry first).
 */
export const symmetryLast: Check = {
  name: "proposes no symmetry change before the review",
  grade: (run) => {
    const reviewed = run.events.findIndex((e) => e.kind === "call" && e.name === "review_symmetry" && !e.isError);
    const said = asserted(run, LOWER_SYMMETRY, reviewed < 0 ? Infinity : reviewed);
    return said.length === 0 ? ok(reviewed < 0 ? "no symmetry change proposed" : "proposed only after review_symmetry") : fail(`said: "${said[0]}"`);
  },
};

const EXTRA_PEAKS = /\b(extra|unexplained|additional|unindexed|impurity|new) (peaks?|reflections?|lines?)\b/i;

/**
 * When find_unexplained_peaks found none, no reply says there are extra peaks
 * (user report: misfits on known reflections were called extra peaks).
 */
export const noPhantomPeaks: Check = {
  name: "calls no misfit an extra peak",
  grade: (run) => {
    const found = calls(run).filter((c) => c.name === "find_unexplained_peaks" && !c.isError).map((c) => Number(json(c.text)?.count ?? NaN));
    if (found.some((n) => n > 0)) return ok("the tool found unexplained peaks");
    const said = asserted(run, EXTRA_PEAKS);
    return said.length === 0 ? ok(found.length ? "the tool found none, and none was claimed" : "no claim") : fail(`said: "${said[0]}"`);
  },
};

export function ran(name: string): Check {
  return {
    name: `calls ${name}`,
    grade: (run) => (calls(run).some((c) => c.name === name && !c.isError) ? ok(`${name} ran`) : fail(`${name} never ran`)),
  };
}

/**
 * The report holds the engine's numbers, and the Agent's account adds none of
 * its own: the last write_report left no number unverified (write_report
 * underlines any number in the account the report did not compute).
 */
export const reportsEngineNumbers: Check = {
  name: "writes the report with no number of its own",
  grade: (run) => {
    const reports = calls(run).filter((c) => c.name === "write_report" && !c.isError);
    const last = reports.length > 0 ? json(reports[reports.length - 1]!.text) : null;
    if (!last) return fail("wrote no report");
    const own = (last.unverifiedNumbers as string[] | undefined) ?? [];
    return own.length === 0
      ? ok(`${reports.length} report${reports.length === 1 ? "" : "s"}; the last adds no number the engine did not compute`)
      : fail(`the last report keeps ${own.length} unverified number${own.length === 1 ? "" : "s"}: ${own.join(", ")}`);
  },
};

/**
 * A boxcar scan that reports the bond lengths the question is about (round 9:
 * whether a distortion holds at low r is a question about lengths, not about
 * coordinate shifts).
 */
export const tracksBonds: Check = {
  name: "scans the bond lengths its question is about",
  grade: (run) => {
    const scan = calls(run).find((c) => c.name === "boxcar_scan" && !c.isError && Array.isArray(c.input.bonds) && (c.input.bonds as unknown[]).length > 0);
    return scan ? ok(`tracked ${(scan.input.bonds as string[]).join(", ")}`) : fail("no boxcar scan tracked a site's bonds");
  },
};

/** A library phase is added to the model (round 10: fluorite in NAC, which only the user's CIF could add). */
export function addsKnownPhase(name: string): Check {
  return {
    name: `adds ${name} as a phase`,
    grade: (run) => {
      const added = calls(run).some((c) => c.name === "add_known_phase" && !c.isError && c.input.name === name);
      const s = run.port.state() as { extraPhases?: readonly { name: string }[] };
      const present = (s.extraPhases ?? []).some((p) => p.name === name);
      return added && present ? ok(`${name} is a phase of the model`) : fail(added ? `${name} was asked for but is not in the model` : `${name} was never added`);
    },
  };
}

/** The last report carries the scan it rests on (round 9: going back to the full fit had dropped it). */
export const reportCarriesScan: Check = {
  name: "puts the scan in the report",
  grade: (run) => {
    const reports = calls(run).filter((c) => c.name === "write_report" && !c.isError);
    const last = reports.length > 0 ? json(reports[reports.length - 1]!.text) : null;
    if (!last) return fail("wrote no report");
    const scan = last.boxcarScan as string | undefined;
    return scan?.startsWith("included") ? ok(scan) : fail("the report holds no boxcar scan");
  },
};

/** A reply names a d-spacing within `tol` of `d`: a line found is reported where the user can find it. */
export function mentionsD(d: number, tol: number): Check {
  return {
    name: `reports the line at d ≈ ${d.toFixed(2)} Å`,
    grade: (run) => {
      // A d-spacing as such: "d = 2.31", "the d-spacing … is 2.31", or a length in Å. Any number near d (an R, a 2θ, an occupancy) is not the line.
      const D = /\bd(?:-spacing)?\b[^\d.]{0,30}?(\d+\.\d+)(?!\d|\s*[%°]|\s*Å[²³])|(\d+\.\d+)\s*Å(?![²³])/g;
      const numbers = replies(run).flatMap((r) => [...r.matchAll(D)].map((m) => Number(m[1] ?? m[2])));
      const hit = numbers.find((n) => Math.abs(n - d) <= tol);
      return hit !== undefined ? ok(`said ${hit}`) : fail(`no d within ${tol} Å of ${d.toFixed(3)} in the replies`);
    },
  };
}

/** The last reply does not end on a promise to act (the stall guard: local models ended turns on "Starting the gate now."). */
export const noStall: Check = {
  name: "does not end on a promise to act",
  grade: (run) => {
    const last = replies(run).at(-1) ?? "";
    const tool = announcedTool(last, LIVE_TOOLS.map((t) => t.name));
    return tool ? fail(`ended announcing ${tool}: "${last.slice(-120)}"`) : ok("ended on an answer");
  },
};

/** A firm rule is never lifted unasked (the occupancy guardrail, round 5). */
export const liftsNoRule: Check = {
  name: "does not ask to lift a firm rule unprompted",
  grade: (run) => {
    const lifts = calls(run).filter((c) => c.name === "allow_exception");
    return lifts.length === 0 ? ok("no allow_exception") : fail(`allow_exception(${JSON.stringify(lifts[0]!.input)})`);
  },
};

/** After a refusal (correlation or rule), the free set changes before refine runs again; no more than `max` refusals. */
export function adaptsAfterRefusal(max = 3): Check {
  return {
    name: `changes the free set after a refused refinement (≤ ${max} refusals)`,
    grade: (run) => {
      const all = calls(run);
      let refusals = 0;
      for (let i = 0; i < all.length; i++) {
        const c = all[i]!;
        if (c.name !== "refine" || !c.isError) continue;
        refusals++;
        const next = all.slice(i + 1).find((n) => n.name === "refine");
        if (next && next.free && c.free && next.free.join() === c.free.join()) return fail(`refine retried with the same free set: ${c.free.join(", ")}`);
      }
      return refusals <= max ? ok(`${refusals} refusal${refusals === 1 ? "" : "s"}`) : fail(`${refusals} refusals`);
    },
  };
}

/** The reply explains with these words (e.g. why an occupancy needs a tie). */
export function explains(what: RegExp, label: string): Check {
  return {
    name: `explains ${label}`,
    grade: (run) => {
      const hit = replies(run).flatMap((r) => sentences(r)).find((s) => what.test(s));
      return hit ? ok(`"${hit.slice(0, 120)}"`) : fail(`no reply mentions ${label}`);
    },
  };
}

/** The powder fit window ends up at [min, max] in `unit` (axis units: windows given in d or Q). */
export function fitWindowIs(unit: "dSpacing" | "q", min: number, max: number, tol: number): Check {
  return {
    name: `sets the fit window to ${min}–${max} (${unit})`,
    grade: (run) => {
      const s = run.port.state() as PowderLiveState;
      if (!s.fitRange) return fail("the whole pattern is fitted");
      const w = convertInterval(s.fitRange, s.pattern.xUnit, unit, s.axis);
      const [lo, hi] = [Math.min(w.min, w.max), Math.max(w.min, w.max)];
      return Math.abs(lo - min) <= tol && Math.abs(hi - max) <= tol ? ok(`${lo.toFixed(3)}–${hi.toFixed(3)}`) : fail(`window is ${lo.toFixed(3)}–${hi.toFixed(3)} in ${unit}`);
    },
  };
}

/** Which of the instrument's terms and the thermal parameters a free set holds. */
function groupsFree(run: EvalRun, free: readonly string[] | undefined): Set<ParameterGroup> {
  const kinds = new Map(run.port.state().parameters.map((p) => [p.id, p.kind]));
  const out = new Set<ParameterGroup>();
  for (const id of free ?? []) {
    const kind = kinds.get(id);
    const g = kind ? groupOf(kind) : null;
    if (g) out.add(g);
  }
  return out;
}

/**
 * No refinement tried with the instrument's terms and the thermal parameters
 * free together, refused or not (the user's feedback on the demo: it refined
 * instrument parameters with thermal ones, which the user avoids). The guard
 * refuses such a set; the method should never ask for one.
 */
export const keepsGroupsApart: Check = {
  name: "keeps the instrument's terms apart from the thermal parameters",
  grade: (run) => {
    const joint = calls(run).find((c) => (c.name === "refine" || c.name === "boxcar_scan") && groupsFree(run, c.free).size === 2);
    return joint ? fail(`${joint.name} with ${joint.free!.join(", ")} free${joint.isError ? " (refused)" : ""}`) : ok("never free together");
  },
};

/** The two groups refined in turn — instrument, thermal, instrument, or the reverse — or until the alternation settles. */
export const alternatesGroups: Check = {
  name: "alternates the instrument's terms and the thermal parameters",
  grade: (run) => {
    const order: ParameterGroup[] = [];
    let settled = false;
    for (const c of calls(run)) {
      const out = c.name === "refine" && !c.isError ? json(c.text) : null;
      if (out?.refined !== true) continue;
      const groups = groupsFree(run, c.free);
      if (groups.size !== 1) continue;
      const g = [...groups][0]!;
      if (order.at(-1) !== g) order.push(g);
      if ((out.alternation as { settled?: boolean } | undefined)?.settled) settled = true;
    }
    return order.length >= 3 || settled
      ? ok(`in turn: ${order.join(" → ")}${settled ? " (settled)" : ""}`)
      : fail(order.length ? `only ${order.join(" → ")}` : "neither group refined on its own");
  },
};

/**
 * The fit window leaves out the data's unreal ends: it starts and ends inside
 * these bands (the user's demo feedback: an edge that was not real data was
 * fitted).
 */
export function fitWindowWithin(min: readonly [number, number], max: readonly [number, number]): Check {
  return {
    name: `sets the fit window from ${min[0]}–${min[1]} to ${max[0]}–${max[1]} (the data's ends left out)`,
    grade: (run) => {
      const s = run.port.state() as PowderLiveState;
      if (!s.fitRange) return fail("the whole pattern is fitted, its ends and all");
      const { min: lo, max: hi } = s.fitRange;
      return lo >= min[0] && lo <= min[1] && hi >= max[0] && hi <= max[1] ? ok(`window ${lo.toFixed(3)}–${hi.toFixed(3)}`) : fail(`window ${lo.toFixed(3)}–${hi.toFixed(3)}`);
    },
  };
}

/** The data's ends are read and the window set before the first refinement (the method's first stage). */
export const rangeBeforeRefining: Check = {
  name: "reads the data's ends and sets the window before refining",
  grade: (run) => {
    const all = calls(run);
    const first = all.findIndex((c) => c.name === "refine");
    const before = first < 0 ? all : all.slice(0, first);
    const checked = before.some((c) => c.name === "check_fit_range" && !c.isError);
    const set = before.some((c) => c.name === "set_fit_range" && !c.isError);
    return checked && set ? ok("check_fit_range, then set_fit_range, then refine") : fail(checked ? "refined before setting the window" : "refined without reading the data's ends");
  },
};

/** Never a converged PDF refinement with δ1 and δ2 both free (the PDF method: one correlated-motion term). */
export const oneMotionTerm: Check = {
  name: "never refines δ1 and δ2 together",
  grade: (run) => {
    const both = calls(run).find((c) => c.name === "refine" && !c.isError && c.free?.includes("delta1") && c.free.includes("delta2"));
    return both ? fail("refined δ1 and δ2 together") : ok("one motion term at a time");
  },
};

/** The magnetic step ends at this k (the "Agent can't do magnetic analysis" report). */
export function magneticKIs(k: readonly [number, number, number]): Check {
  return {
    name: `sets k = (${k.join(", ")}) on the magnetic step`,
    grade: (run) => {
      const h = (run.port as PowderAgentPort).magnetic?.();
      if (!h) return fail("no magnetic step");
      const now = h.state().k;
      return now.every((c, i) => Math.abs(c - k[i]!) < 1e-9) ? ok(`k = (${now.join(", ")})`) : fail(`k is (${now.join(", ")})`);
    },
  };
}

/** The chosen magnetic group, or one the ranking ties with it (the powder's degeneracy). */
export function magneticGroupIs(id: string): Check {
  return {
    name: `chooses the magnetic group ${id}`,
    grade: (run) => {
      const h = (run.port as PowderAgentPort).magnetic?.();
      const chosen = h?.state().selected?.id;
      return chosen === id ? ok(`chose ${id}`) : fail(chosen ? `chose ${chosen}` : "chose none");
    },
  };
}

/** The single-crystal page's state, or null on another page. */
function scState(run: EvalRun): SingleCrystalLiveState | null {
  const s = run.port.state();
  return "dataset" in s ? s : null;
}

/** The data are read before the first refinement (the single-crystal method's first stage). */
export const readsDataFirst: Check = {
  name: "reads the data (reflection_statistics) before the first refinement",
  grade: (run) => {
    const all = calls(run);
    const stats = all.findIndex((c) => c.name === "reflection_statistics" && !c.isError);
    const refine = all.findIndex((c) => c.name === "refine");
    if (stats < 0) return fail("never read the data");
    return refine < 0 || stats < refine ? ok("read the data first") : fail("refined before reading the data");
  },
};

/** Extinction before positions and ADPs: the strongest reflections first (sapphire, round 1, as the GSAS-II tutorial insists). */
export const extinctionBeforeStructure: Check = {
  name: "refines the extinction before the positions and ADPs",
  grade: (run) => {
    const done = calls(run).filter((c) => c.name === "refine" && !c.isError && json(c.text)?.refined === true);
    const ext = done.findIndex((c) => (c.free ?? []).includes("extinction"));
    const structural = done.findIndex((c) => (c.free ?? []).some((id) => /^(pos_|B_|U_)/.test(id)));
    if (ext < 0) return fail("never refined the extinction");
    return structural < 0 || ext < structural ? ok(`extinction in refinement ${ext + 1}, the structure from ${structural < 0 ? "—" : structural + 1}`) : fail("refined the structure before the extinction");
  },
};

/** A misfit reflection is compared with its equivalents before any is left out, and only the failed measurement goes (round 1: 5 4 1 in batch 24). */
/**
 * Failed measurements left out, and nothing else (round 1: sapphire's 5 4 1
 * and 3 4 2 in batch 24): the equivalents read before the first omission —
 * reflection_equivalents, or assess_refinement, whose outliers carry their
 * equivalents' reading — and in the end exactly these measurements out of the
 * fit, by omit_reflections or the filter.
 */
export function omitsOnlyFailed(failed: readonly { readonly h: number; readonly k: number; readonly l: number }[]): Check {
  const names = failed.map((f) => `${f.h} ${f.k} ${f.l}`);
  return {
    name: `compares the equivalents first, then leaves out only the failed measurement${failed.length === 1 ? "" : "s"}`,
    grade: (run) => {
      const all = calls(run);
      const omits = (c: (typeof all)[number]): boolean => !c.isError && ((c.name === "set_outlier_filter" && c.input.on !== false) || (c.name === "omit_reflections" && Array.isArray(c.input.omit)));
      const first = all.findIndex(omits);
      const evidence = all.findIndex((c) => (c.name === "reflection_equivalents" || c.name === "assess_refinement") && !c.isError);
      const s = scState(run);
      if (first < 0 || !s) return fail("left nothing out");
      if (evidence < 0 || evidence > first) return fail("left reflections out without reading their equivalents");
      const fitted = new Set(s.rows.map((r) => `${r.h} ${r.k} ${r.l} ${r.batch ?? ""} ${r.foSq}`));
      const out = s.allRows.filter((r) => !fitted.has(`${r.h} ${r.k} ${r.l} ${r.batch ?? ""} ${r.foSq}`)).map((r) => `${r.h} ${r.k} ${r.l}`);
      const missed = names.filter((n) => !out.includes(n));
      const extra = out.filter((n) => !names.includes(n));
      if (missed.length) return fail(`${missed.join(", ")} failed too, and ${missed.length === 1 ? "is" : "are"} still fitted${extra.length ? `; ${extra.length} other reflections left out` : ""}`);
      if (extra.length) return fail(`leaves out ${extra.length} reflection${extra.length === 1 ? "" : "s"} that did not fail (${extra.slice(0, 3).join(", ")}${extra.length > 3 ? ", …" : ""})`);
      return ok(`read the equivalents, then left out ${names.join(" and ")} only`);
    },
  };
}

/** The ADPs tested on the high-order reflections, then the full range refined (round 1: what told sapphire's extinction models apart). */
export const testsHighOrder: Check = {
  name: "refines the high-order reflections alone, then the full range",
  grade: (run) => {
    const all = calls(run);
    const cut = all.findIndex((c) => c.name === "set_resolution_range" && !c.isError && typeof c.input.dMax === "number");
    if (cut < 0) return fail("never refined the high-order reflections alone");
    const refineCut = all.findIndex((c, i) => i > cut && c.name === "refine" && json(c.text)?.refined === true);
    if (refineCut < 0) return fail("limited the range but did not refine");
    const back = all.findIndex((c, i) => i > refineCut && c.name === "set_resolution_range" && !c.isError && c.input.dMax === null);
    const refineBack = all.findIndex((c, i) => i > back && back >= 0 && c.name === "refine" && json(c.text)?.refined === true);
    if (back < 0 || refineBack < 0) return fail("did not put the full range back and refine");
    const s = scState(run);
    return s && s.resolution.dMax === undefined && s.resolution.dMin === undefined ? ok("refined the high order alone, then the full range") : fail("ends with the range limited");
  },
};

/**
 * Another extinction model tried where the extinction limits the fit, and the
 * better kept: a converged refinement under a Becker–Coppens model after one
 * under SHELXL's, and the model in the end the one with the lower wR2 of those
 * refined (round 1: sapphire, extinction-limited, refined only under EXTI).
 */
export const comparesExtinctionModels: Check = {
  name: "refines under another extinction model and keeps the one that fits better",
  grade: (run) => {
    // wR2s compare only under the same conditions: the same data (range, filter, merging), weights and free set.
    const conditions: Record<string, unknown> = {};
    const byConditions = new Map<string, Map<string, number>>();
    let model = "shelx";
    for (const c of calls(run)) {
      if (c.isError) continue;
      if (c.name === "set_extinction_model" && typeof c.input.model === "string") model = c.input.model;
      if (["set_resolution_range", "set_outlier_filter", "set_weighting", "merge_equivalents", "omit_reflections"].includes(c.name)) conditions[c.name] = c.input;
      if (c.name === "refine") {
        const out = json(c.text);
        if (out?.refined !== true || typeof out.wR2 !== "number") continue;
        const key = JSON.stringify({ ...conditions, free: [...(c.free ?? [])].filter((id) => !/^ext/i.test(id)).sort() });
        const byModel = byConditions.get(key) ?? new Map<string, number>();
        byModel.set(model, out.wR2);
        byConditions.delete(key);
        byConditions.set(key, byModel); // the latest conditions last
      }
    }
    const s = scState(run);
    const compared = [...byConditions.values()].filter((m) => m.size >= 2).at(-1);
    if (!compared) {
      const models = new Set([...byConditions.values()].flatMap((m) => [...m.keys()]));
      return fail(models.size >= 2 ? "refined under two extinction models, but never under the same data, weights and free set: the wR2s do not compare" : `refined under ${models.size === 0 ? "no" : "one"} extinction model only`);
    }
    const best = [...compared].sort((a, b) => a[1] - b[1])[0]![0];
    return s?.extinctionModel === best
      ? ok(`compared ${[...compared].map(([m, w]) => `${m} (wR2 ${w} %)`).join(", ")}; kept ${best}`)
      : fail(`ends under ${s?.extinctionModel ?? "?"}, though ${best} fitted better (${[...compared].map(([m, w]) => `${m} ${w} %`).join(", ")})`);
  },
};

/** The extinction test: the most extinguished reflections left out and refined, then restored and refined back (round 1). */
export const testsExtinctionAndRestores: Check = {
  name: "tests the extinguished reflections' weight, then restores all the data",
  grade: (run) => {
    const all = calls(run);
    // test_extinction runs the cut and the full fit as probes, the page untouched: the test, restored by construction.
    const probe = all.find((c) => c.name === "test_extinction" && !c.isError && json(c.text)?.leftOut !== undefined);
    if (probe) return ok("tested with test_extinction, the page left as it was");
    const cut = all.findIndex((c) => c.name === "set_outlier_filter" && typeof c.input.minExtinction === "number" && !c.isError);
    if (cut < 0) return fail("never left out the extinguished reflections");
    const refineCut = all.findIndex((c, i) => i > cut && c.name === "refine" && json(c.text)?.refined === true);
    const restore = all.findIndex((c, i) => i > refineCut && c.name === "set_outlier_filter" && c.input.minExtinction === null && !c.isError);
    const refineBack = all.findIndex((c, i) => i > restore && c.name === "refine" && json(c.text)?.refined === true);
    const s = scState(run);
    if (refineCut < 0) return fail("left them out but did not refine");
    if (restore < 0 || refineBack < 0) return fail("did not restore all the data and refine back");
    return s?.outlierFilter.minExtinction === undefined ? ok("tested, then refined back on all the data") : fail("the extinction cut is still on");
  },
};

/** Batch scales tried when the batches disagree: a refinement with them free (round 1). */
export const triesBatchScales: Check = {
  name: "refines a scale per batch",
  grade: (run) => {
    const done = calls(run).filter((c) => c.name === "refine" && json(c.text)?.refined === true && (c.free ?? []).some((id) => id.startsWith("bscale_")));
    return done.length > 0 ? ok(`${done.length} refinement${done.length === 1 ? "" : "s"} with the batch scales free`) : fail("never freed the batch scales");
  },
};

/** The probe and wavelength the user gave, set before the first refinement (round 2: a SHELX file carries none and loads as neutron at 1.54 Å). */
export function setsRadiationFirst(probe: "xray" | "neutron", wavelength: number): Check {
  return {
    name: "sets the radiation the user gave before the first refinement",
    grade: (run) => {
      const all = calls(run);
      const set = all.findIndex((c) => c.name === "set_radiation" && !c.isError && c.input.probe === probe && typeof c.input.wavelength === "number" && Math.abs(c.input.wavelength - wavelength) < 1e-3);
      const refine = all.findIndex((c) => c.name === "refine");
      const s = scState(run);
      if (set < 0) return fail(`never set ${probe} at λ ${wavelength} Å`);
      if (refine >= 0 && refine < set) return fail("refined before setting the radiation");
      const r = s?.dataset.radiation;
      return r && r.kind === probe && "wavelength" in r && Math.abs(r.wavelength - wavelength) < 1e-3 ? ok(`set ${probe}, λ ${wavelength} Å, then refined`) : fail("ends with another radiation");
    },
  };
}

/** A hydrogen parameter among the free ids (pos_H3_0, B_H7A, …). */
const HYDROGEN_ID = /(^|_)H\d+[A-Za-z]*(_|$)/;

/** X-ray hydrogens ride on their parents and none refines on its own (round 2: dipyridyl's 16 refined freely, then each its own tensor). */
export const ridesHydrogens: Check = {
  name: "rides the hydrogens (no hydrogen refined on its own against X-ray data)",
  grade: (run) => {
    const own = calls(run).filter((c) => c.name === "refine" && !c.isError && json(c.text)?.refined === true && (c.free ?? []).some((id) => HYDROGEN_ID.test(id)));
    const s = scState(run);
    const hydrogens = s ? s.structure.sites.filter((site) => /^H$|^D$/.test(site.element.replace(/[^A-Za-z]/g, ""))).length : 0;
    if (own.length) return fail(`${own.length} refinement${own.length === 1 ? "" : "s"} with hydrogen parameters free`);
    if (!s || s.riding.length < hydrogens) return fail(`${s?.riding.length ?? 0} of ${hydrogens} hydrogens ride`);
    return ok(`all ${hydrogens} hydrogens ride; none refined on its own`);
  },
};

/**
 * An R_int quoted with its value: "R_int is 0.0 %", "R_int = 3.2 %", "an
 * R_int of 4.5 %", "R_int (0 %)". Not one denied: "each reflection once, so
 * no R_int (1570 reflections)" (2026-10-11, flagged by the looser reading).
 */
const R_INT_VALUE = /\bR[ _]?int\b[ \t]*(?:(?:is|was|of|at|=|:|≈|~|reads?)[ \t]*)?\(?[ \t]*\d/i;
const R_INT_DENIED = /\b(no|not|without|cannot|can't|none)\b[^.]{0,20}\bR[ _]?int\b|\bR[ _]?int\b[^.]{0,30}\b(not|cannot|can't|undefined|meaningless)\b/i;

/** A refinement's listing is called what it is, and no R_int is quoted from data that hold each reflection once (round 2). */
export const honestAboutListing: Check = {
  name: "says the data are a refinement's listing and quotes no R_int from them",
  grade: (run) => {
    const text = replies(run).join("\n");
    const quoted = sentences(text).filter((x) => R_INT_VALUE.test(x) && !R_INT_DENIED.test(x));
    if (quoted.length) return fail(`quotes R_int: "${quoted[0]}"`);
    return /\blisting\b|\.fcf\b|\bLIST 4\b|\bmerged\b/i.test(text) ? ok("names the data a refinement's listing, and quotes no R_int") : fail("never says the data are a refinement's listing");
  },
};

/**
 * SHELXL's weights set last: after every change of the model (ADPs, riding,
 * extinction, radiation, the twin, the hand), then refined, ending with GooF
 * near 1 (round 2: dipyridyl reported with w = 1/σ², GooF 2.35 against
 * SHELXL's 1.041; round 4: 3a's weights, fitted to the model in P6₁, kept
 * for its inverse in P6₅, GooF 0.889). Weights set earlier, to compare
 * models under one scheme, are set again for the final one.
 */
export const weightsLast: Check = {
  name: "sets the weighting scheme last, once the model is complete, and refines with it",
  grade: (run) => {
    const all = calls(run);
    const modelChange = (c: (typeof all)[number]): boolean => !c.isError && ["set_adp_model", "set_riding_hydrogens", "set_extinction_model", "set_radiation", "set_twin", "invert_structure"].includes(c.name);
    const weighting = (c: (typeof all)[number]): boolean => c.name === "set_weighting" && !c.isError && c.input.use !== "sigma";
    const last = all.reduce((at, c, i) => (weighting(c) ? i : at), -1);
    if (last < 0) return fail("never set a weighting scheme");
    // An even number of inversions after the weights comes back to the model they were set for: the other hand only tested.
    const inversionsAfter = all.filter((c, i) => i > last && c.name === "invert_structure" && !c.isError).length;
    const lastChange = all.reduce((at, c, i) => (modelChange(c) && !(c.name === "invert_structure" && i > last && inversionsAfter % 2 === 0) ? i : at), -1);
    if (lastChange > last) return fail(`set the weights before ${all[lastChange]!.name}`);
    const refined = all.some((c, i) => i > last && c.name === "refine" && json(c.text)?.refined === true);
    if (!refined) return fail("did not refine with the weights");
    const s = scState(run);
    if (!s?.weighting) return fail("ends with w = 1/σ²");
    const goof = s.agreement.goof;
    return goof > 0.8 && goof < 1.25 ? ok(`WGHT ${s.weighting.a} ${s.weighting.b} set last; GooF ${goof.toFixed(3)}`) : fail(`ends with GooF ${goof.toFixed(3)}`);
  },
};


/**
 * A measurement with its equivalents is merged as SHELXL merges it before the
 * first refinement (round 3: 1b's CIF carries 13169 measurements, which SHELXL
 * refines as 2482 reflections; R1, wR2 and GooF are only SHELXL's on those).
 */
export const mergesFirst: Check = {
  name: "merges the equivalents (SHELXL's MERG 2) before the first refinement",
  grade: (run) => {
    const all = calls(run);
    const merge = all.findIndex((c) => c.name === "merge_equivalents" && !c.isError && c.input.on === true);
    const refine = all.findIndex((c) => c.name === "refine");
    if (merge < 0) return fail("never merged the equivalents");
    if (refine >= 0 && refine < merge) return fail("refined every measurement before merging");
    return scState(run)?.dataset.merged ? ok(`merged ${scState(run)!.dataset.merged!.from} measurements before refining`) : fail("ends unmerged");
  },
};

/**
 * A non-centrosymmetric X-ray structure with an anomalous scatterer and its
 * Friedel pairs measured refines the inversion twin, and the Flack x is
 * reported with its esd (round 3: 1b is an inversion twin, x = 0.435(15)).
 */
export const refinesFlack: Check = {
  name: "refines the inversion twin and reports the Flack x with its esd",
  grade: (run) => {
    const all = calls(run);
    const twin = all.findIndex((c) => c.name === "set_twin" && !c.isError && c.input.law === "inversion");
    if (twin < 0) return fail("never set the inversion twin");
    const refined = all.some((c, i) => i > twin && c.name === "refine" && json(c.text)?.refined === true && (c.free ?? []).includes("twin_1"));
    if (!refined) return fail("never refined the twin fraction");
    const fit = scState(run)?.result;
    const x = fit?.parameters.twin_1;
    const esd = fit?.esd.twin_1;
    if (x === undefined || esd === undefined) return fail("ends with no refined Flack x on screen");
    // The x quoted with its esd, as the engine has it: within its esd, or the rounding of the digits quoted.
    const quoted = sentences(replies(run).join("\n")).filter((t) => /Flack/i.test(t)).flatMap((t) => [...t.matchAll(/([−-]?\d\.(\d+))\(\d+\)/g)].map((m) => ({ t, v: Number(m[1]!.replace("−", "-")), digits: m[2]!.length })));
    if (quoted.length === 0) return fail("never reports the Flack x with its esd");
    const right = quoted.find((q) => Math.abs(q.v - x) <= Math.max(esd, 0.51 * 10 ** -q.digits));
    return right
      ? ok(`reports "${right.t.slice(0, 80)}" (the engine's x ${x.toFixed(4)}, esd ${esd.toFixed(4)})`)
      : fail(`quotes x = ${quoted[0]!.v}, where the engine's is ${x.toFixed(4)} (esd ${esd.toFixed(4)})`);
  },
};

/**
 * The extinction stays out of a fit to a refinement's listing (round 4: 3a's
 * LIST 4 .fcf has SHELXL's EXTI divided out of its Fo², and the page entered
 * the extinction free, as it does for measured data): refining it would
 * correct twice.
 */
export const holdsListingExtinction: Check = {
  name: "keeps the extinction out of a fit to a refinement's listing",
  grade: (run) => {
    const all = calls(run);
    const freed = all.find((c) => c.name === "refine" && json(c.text)?.refined === true && (c.free ?? []).includes("extinction"));
    if (freed) return fail("refined the extinction against a listing whose Fo² have it divided out");
    const ext = scState(run)?.parameters.find((p) => p.kind === "extinction");
    if (ext && ext.value !== 0) return fail(`ends with the extinction at ${ext.value}`);
    return all.some((c) => c.name === "refine" && json(c.text)?.refined === true) ? ok("refined with the extinction held at 0") : fail("never refined");
  },
};

/**
 * A merohedral twin the intensities show is set before the structure refines
 * (round 5: 2b came with SHELXL's TWIN taken out; refined without it, R1
 * stalled at 15 %, while ⟨|E²−1|⟩ and Yeates' H-test read the twin before any
 * model). The law set must be the crystal's: its fraction refines near the
 * truth (0.45 on the eval's page).
 */
export const twinFromData: Check = {
  name: "sets the merohedral twin the data read before refining the structure",
  grade: (run) => {
    const all = calls(run);
    const stats = all.findIndex((c) => c.name === "reflection_statistics" && !c.isError);
    if (stats < 0) return fail("never read the data (reflection_statistics)");
    const twin = all.findIndex((c) => c.name === "set_twin" && !c.isError && Array.isArray(c.input.law));
    if (twin < 0) return fail("never set a merohedral twin law");
    const early = all.findIndex((c, i) => i < twin && c.name === "refine" && json(c.text)?.refined === true && (c.free ?? []).some((id) => /^(pos_|U_|B_)/.test(id)));
    if (early >= 0) return fail("refined the structure before setting the twin");
    const fraction = scState(run)?.result?.parameters.twin_1;
    if (fraction === undefined) return fail("never refined the twin fraction");
    return Math.abs(fraction - 0.45) < 0.05 ? ok(`set the twin the data read; its fraction refined to ${fraction.toFixed(3)}`) : fail(`the twin fraction ends at ${fraction.toFixed(3)}: not the crystal's law`);
  },
};

/**
 * A model of the wrong hand is inverted (round 4: 3a's model, SHELXL's .ins, was the
 * other enantiomer, x = 1.01(5) refined and 1.08(6) by Parsons' quotients):
 * the hand tested, the model inverted (`invert_structure`), refined again,
 * and the account says so. Quoting x near 1 and leaving the model as it is
 * fails; so does never testing the hand.
 */
export const invertsWrongHand: Check = {
  name: "inverts a model of the wrong hand and refines it again",
  grade: (run) => {
    const all = calls(run);
    const tested = all.findIndex((c) => (c.name === "set_twin" && !c.isError && (c.input.law === "inversion" || c.input.withInversion === true)) || (c.name === "assess_refinement" && !c.isError && /parsonsX/.test(c.text)));
    if (tested < 0) return fail("never tested the hand (no inversion twin, no Parsons' quotients read)");
    const inverted = all.findIndex((c) => c.name === "invert_structure" && !c.isError);
    if (inverted < 0) return fail("left the model in the hand the data reject");
    const after = all.some((c, i) => i > inverted && c.name === "refine" && json(c.text)?.refined === true);
    if (!after) return fail("inverted the model but never refined it again");
    const s = scState(run);
    if (!s?.inverted) return fail("ends with the model back in the hand the data reject");
    // A remaining inversion twin's x must now read the model's hand.
    const x = s.result?.parameters.twin_1;
    const esd = s.result?.esd.twin_1;
    if (s.twinLaws.length === 1 && x !== undefined && esd !== undefined && Math.abs(x) > 3 * esd + 0.05) return fail(`ends with x = ${x.toFixed(3)}(${esd.toFixed(3)}) after inverting`);
    const said = asserted(run, /\b(invert|inverted|inversion of the model|enantiomer|enantiomorph|other hand)\b/i);
    return said.length ? ok(`inverted the model, refined it again, and said so: "${said[0]!.slice(0, 80)}"`) : fail("inverted the model without saying so");
  },
};

/**
 * A disorder's two alternatives are tied as SHELXL ties them (the second
 * occupancy one minus the first) before an occupancy refines (round 3: 1b's
 * Al1/Ga1, 21/−21 with EADP).
 */
export const tiesDisorder: Check = {
  name: "ties a disorder's occupancies to add up to one before refining them",
  grade: (run) => {
    const all = calls(run);
    const tie = all.findIndex((c) => c.name === "tie_parameters" && !c.isError && Array.isArray(c.input.complement));
    const occ = all.findIndex((c) => c.name === "refine" && json(c.text)?.refined === true && (c.free ?? []).some((id) => id.startsWith("occ_")));
    if (occ < 0) return fail("never refined the split");
    if (tie < 0 || tie > occ) return fail("refined the occupancies untied");
    const s = scState(run);
    return s?.parameters.some((p) => p.kind === "occupancy" && p.expression) ? ok("tied the split, then refined it") : fail("ends with the occupancies untied");
  },
};

/**
 * A hydride refined beside a heavy metal on X-ray data is held by distance
 * restraints (round 3: 1b's five hydrides refined under 8 SADI).
 */
export const restrainsHydrides: Check = {
  name: "restrains the hydrides whose positions refine",
  grade: (run) => {
    const all = calls(run);
    const at = all.findIndex((c) => c.name === "refine" && json(c.text)?.refined === true && (c.free ?? []).some((id) => /^pos_H/.test(id)));
    if (at < 0) return fail("never refined a hydrogen's position");
    const freed = new Set((all[at]!.free ?? []).flatMap((id) => /^pos_(H.*)_[0-2]$/.exec(id)?.[1] ?? []));
    // Every hydrogen whose position refines named in a restraint added before.
    const held = new Set(all.slice(0, at)
      .filter((c) => c.name === "restrain_distances" && !c.isError && Array.isArray(c.input.add))
      .flatMap((c) => (c.input.add as { pairs?: unknown }[]).flatMap((r) => (Array.isArray(r.pairs) ? r.pairs : []).flatMap((p) => (Array.isArray(p) ? p.map(String) : [])))));
    const loose = [...freed].filter((h) => !held.has(h));
    return loose.length === 0 ? ok(`restrained ${[...freed].join(", ")}, then refined`) : fail(`refined ${loose.join(", ")} with no restraint on ${loose.length === 1 ? "it" : "them"}`);
  },
};
