import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse_structure } from "@/mcp/tools";
import type { RefinementParameter } from "@/core/refinement/types";
import type { StructureModel } from "@/core/crystal/types";
import { CIF, SHARED_CIF, result, rows } from "@/testSupport/zeroAdpFixtures";
import { zeroAdpFix, zeroAdpFixText, zeroAdpProposals, zeroAdpStepLabel, type ZeroAdpFix, type ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";
import { assessRefinement, physicalFindings } from "@/core/diagnostics/assessment";

/**
 * The validation freeze: what the in-app Agent reads of the B-at-0 rule and of
 * the physical findings stays byte for byte as it was. The pages word these
 * things in short lines of their own (zeroAdpLines.ts, findingLines.ts); the
 * Agent keeps the long text: get_state's bAtZero (each proposal's warning, its
 * options' labels and cautions, zeroAdpFixText of each fix in force), refine's
 * checks (the warnings), apply_adp_proposal (each option's text, label and
 * source) and assess_refinement (the findings' summary, detail and evidence).
 *
 * The golden (__goldens__/agentVisibleText.json) was written from main before
 * the short lines existed. To write it again (only for a change the Agent is
 * meant to see): AGENT_TEXT_WRITE=1 npx vitest run src/core/diagnostics/agentVisibleText.test.ts
 */

const GOLDEN = resolve(__dirname, "__goldens__/agentVisibleText.json");

/** What the Agent reads of a proposal: get_state's bAtZero, refine's warnings, apply_adp_proposal's card and errors. */
const proposalText = (p: ZeroAdpProposal) => ({
  parameterId: p.parameterId, sites: p.sites, atom: p.atom, reached: p.reached, rule: p.rule, source: p.source, advice: p.advice, warning: p.warning,
  options: p.options.map((o) => ({ id: o.id, rule: o.rule, rank: o.rank, leader: o.leader ?? null, value: o.value ?? null, label: o.label, caution: o.caution ?? null, source: o.source, text: o.text })),
});
/** What the Agent reads of a fix: zeroAdpFixText (get_state, assess_refinement, the report's frozen limitations) and the fields it is built from. */
const fixText = (f: ZeroAdpFix) => ({
  parameterId: f.parameterId, atom: f.atom, reached: f.reached, rule: f.rule, leader: f.leader ?? null, value: f.value ?? null, source: f.source,
  chosenBy: f.chosenBy ?? null, reason: f.reason ?? null, alternatives: f.alternatives ?? null, text: zeroAdpFixText(f),
});

function agentVisibleText(): Record<string, unknown> {
  const cwo = parse_structure({ cif: CIF(true), id: "cwo" }).structure;
  const bare = parse_structure({ cif: CIF(false), id: "cwo" }).structure;
  const shared = parse_structure({ cif: SHARED_CIF, id: "shared" }).structure;
  const second = { ...parse_structure({ cif: CIF(true, "second"), id: "second" }).structure, name: "Cr2WO6-b" };
  const first = { ...cwo, name: "Cr2WO6-a" };
  const single = (s: StructureModel) => [{ structure: s, prefix: "", groups: [["W1"], ["Cr1"], ["O1"], ["O2"]] }];
  const out: Record<string, unknown> = {};

  // 1. W1 and O2 at 0: O2 → O1 (same element, preferred), W1 → Cr1 (another cation, with its caution), each beside the starting value.
  {
    const v = { B_W1: 0, B_Cr1: 0.4, B_O1: 0.62, B_O2: 0 };
    const { params, bindings } = rows(single(cwo), v);
    const res = result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_W1", "B_O2"]);
    const ps = zeroAdpProposals({ parameters: params, bindings, result: res, structures: [cwo] });
    const o2 = ps.find((p) => p.parameterId === "B_O2")!;
    const w1 = ps.find((p) => p.parameterId === "B_W1")!;
    const fixes = [
      zeroAdpFix(o2, 0),
      zeroAdpFix(o2, 1),
      zeroAdpFix(w1, 0, { reason: "W and Cr share one octahedral site type here" }),
      zeroAdpFix(o2, 0, { chosenBy: "agent-auto", reason: "both are the oxide's oxygens" }),
      zeroAdpFix(w1, 1, { chosenBy: "agent-auto" }),
    ];
    out.awo4Like = {
      proposals: ps.map(proposalText),
      fixes: fixes.map(fixText),
      stepLabels: [zeroAdpStepLabel(o2, 0), zeroAdpStepLabel(o2, 1), zeroAdpStepLabel(w1, 0, "agent-auto"), zeroAdpStepLabel(w1, 1, "user")],
      assessment: assessRefinement({ result: res, parameters: params, observationCount: 1800, mode: "powder", structures: [cwo], zeroAdp: { proposals: ps, applied: [] } }).findings,
      assessmentWithFixes: assessRefinement({ result: res, parameters: params, observationCount: 1800, mode: "powder", structures: [cwo], zeroAdp: { proposals: [w1], applied: [fixes[0]!, fixes[4]!] } }).findings,
    };
  }
  // 2. Every partner on its bound or undetermined: the starting value alone (rule B).
  {
    const v = { B_W1: 0, B_Cr1: 0.05, B_O1: 0, B_O2: 0 };
    const { params, bindings } = rows(single(cwo), v);
    const ps = zeroAdpProposals({ parameters: params, bindings, result: result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_W1", "B_O1", "B_O2"]), structures: [cwo] });
    out.startOnly = { proposals: ps.map(proposalText), fixes: ps.map((p) => fixText(zeroAdpFix(p, 0))) };
  }
  // 3. No partner and no starting B: nothing to propose (rule C).
  {
    const v = { B_W1: 0.3, B_Cr1: 0.4, B_O1: 0, B_O2: 0 };
    const { params, bindings } = rows(single(bare), v);
    const res = result(v, { B_W1: 0.03, B_Cr1: 0.04, B_O1: 0.05, B_O2: 0.05 }, ["B_O1", "B_O2"]);
    const ps = zeroAdpProposals({ parameters: params, bindings, result: res, structures: [bare] });
    out.ruleC = { proposals: ps.map(proposalText), assessment: assessRefinement({ result: res, parameters: params, observationCount: 1800, mode: "powder", structures: [bare], zeroAdp: { proposals: ps, applied: [] } }).findings };
  }
  // 4. A shared site (Cr1/Fe1, one B) and no oxidation states: W1's tie to it is another cation's.
  {
    const groups = [["W1"], ["Cr1", "Fe1"], ["O1"], ["O2"]];
    const v = { B_W1: 0, B_Cr1: 0.6, B_O1: 0.62, B_O2: 0.5 };
    const { params, bindings } = rows([{ structure: shared, prefix: "", groups }], v);
    const res = result(v, { B_W1: 0.03, B_Cr1: 0.2, B_O1: 0.05, B_O2: 0.05 }, ["B_W1"]);
    const ps = zeroAdpProposals({ parameters: params, bindings, result: res, structures: [shared] });
    out.sharedSite = {
      proposals: ps.map(proposalText),
      fixes: ps.flatMap((p) => p.options.map((_, i) => fixText(zeroAdpFix(p, i)))),
      assessment: assessRefinement({ result: res, parameters: params, observationCount: 1800, mode: "powder", structures: [shared], sharedSiteAdps: ["B_Cr1"], zeroAdp: { proposals: ps, applied: [] } }).findings,
    };
  }
  // 5. Two phases, the rows prefixed p0_ and p1_: each proposal stays within its phase.
  {
    const phases = [{ structure: first, prefix: "p0_", groups: [["W1"], ["Cr1"], ["O1"], ["O2"]] }, { structure: second, prefix: "p1_", groups: [["W1"], ["Cr1"], ["O1"], ["O2"]] }];
    const v = { p0_B_W1: 0.3, p0_B_Cr1: 0.4, p0_B_O1: 0.62, p0_B_O2: 0, p1_B_W1: 0.3, p1_B_Cr1: 0.4, p1_B_O1: 0, p1_B_O2: 0.7 };
    const esd = Object.fromEntries(Object.keys(v).map((k) => [k, 0.05]));
    const { params, bindings } = rows(phases, v);
    const res = result(v, esd, ["p0_B_O2", "p1_B_O1"]);
    const ps = zeroAdpProposals({ parameters: params, bindings, result: res, structures: [first, second] });
    out.twoPhases = {
      proposals: ps.map(proposalText),
      fixes: ps.map((p) => fixText(zeroAdpFix(p, 0))),
      assessment: assessRefinement({ result: res, parameters: params, observationCount: 1800, mode: "powder", structures: [first, second], zeroAdp: { proposals: ps, applied: [] } }).findings,
    };
  }
  // 6. The physical findings of the values alone, and the moderate correlations.
  {
    const p = (id: string, label: string, kind: RefinementParameter["kind"], value: number, fixed: boolean): RefinementParameter => ({ id, label, kind, value, initialValue: value, fixed });
    const params = [
      p("B_W1", "W1 B", "bIso", -0.0123, false),
      p("B_O1", "O1 B", "bIso", -0.5, true),
      p("occ_Ga1", "Mn3Ga: Ga1 occ", "occupancy", 1.05, true),
      p("occ_Mn1", "Mn1 occ", "occupancy", 1.0731, false),
      p("occ_Fe1", "Fe1 occ", "occupancy", -0.0712, false),
      p("occ_Ni1", "Ni1 occ", "occupancy", 1.005, true),
      p("profX", "size (Lorentzian X)", "profileX", -1.234, false),
      p("profY", "mustrain (Lorentzian Y)", "profileY", -0.5, false),
    ];
    const pairs = [["B_W1", "occ_Mn1", 0.86], ["occ_Fe1", "B_O1", -0.82], ["profX", "profY", 0.91], ["occ_Mn1", "occ_Fe1", -0.81], ["B_W1", "profY", 0.8]] as const;
    const moderate = pairs.map(([a, b, c]) => ({ parameterIdA: a, parameterIdB: b, coefficient: c }));
    const values = Object.fromEntries(params.map((q) => [q.id, q.value]));
    out.physical = physicalFindings(params);
    out.moderate = assessRefinement({ result: result(values, {}, [], moderate), parameters: params, observationCount: 1800, mode: "powder" }).findings.filter((f) => f.category === "correlation");
    out.moderateOne = assessRefinement({ result: result(values, {}, [], moderate.slice(0, 1)), parameters: params, observationCount: 1800, mode: "powder" }).findings.filter((f) => f.category === "correlation");
    // A bound other than a B's: the at-bound finding without a proposal.
    const bounded = result(values, {}, []);
    out.otherBounds = assessRefinement({
      result: { ...bounded, diagnostics: { ...bounded.diagnostics!, atBounds: [{ parameterId: "profX", bound: "min", value: 0 }, { parameterId: "occ_Mn1", bound: "max", value: 1 }] } },
      parameters: params, observationCount: 1800, mode: "powder",
    }).findings.filter((f) => f.category === "at-bound");
  }
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
}

describe("the validation freeze: what the Agent reads of the B-at-0 rule and the physical findings", () => {
  it("is byte for byte the golden written before the pages' short lines", () => {
    const now = agentVisibleText();
    if (process.env.AGENT_TEXT_WRITE === "1") writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`);
    expect(existsSync(GOLDEN)).toBe(true);
    expect(now).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });
});
