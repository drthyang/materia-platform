import { describe, it, expect } from "vitest";
import { loadedSession } from "@/app/powderSession";
import { executor, fakeHost, headlessHistory, sessionPort } from "@/testSupport/agentHeadless";
import { reportHtml } from "@/core/export/report";
import { zeroAdpFixText, type ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";
import { POWDER_PLANS } from "@/agent/powderTools";
import type { ActivityEntry } from "@/agent/executor";
import { ZERO_ADP_INSTRUMENT, ZERO_ADP_TRUTH_O, zeroAdpSimulated } from "@/testSupport/zeroAdpCase";

/**
 * The B-at-0 rule through the Agent, on a synthetic truth: Cr₂WO₆ simulated
 * with B(O1) = B(O2) = 0.6 Å² on a neutron diffractometer (λ = 2.4067 Å, to
 * Q ≈ 4.7 Å⁻¹) at low counts, where the two oxygen B's are poorly separated:
 * with this noise draw B(O1) rails to 0 while B(O2) refines sensibly. The
 * rule proposes the tie O1 → O2 (rule A, same element); nothing changes until
 * the user approves the card; applied, the common B recovers the truth; the
 * Agent, the report and the History all show it; release and go_to_step undo it.
 */
const INSTRUMENT = ZERO_ADP_INSTRUMENT;
const TRUTH_O = ZERO_ADP_TRUTH_O;
const simulated = zeroAdpSimulated;

const parse = (t: string): Record<string, unknown> => JSON.parse(t) as Record<string, unknown>;
type Finding = { category: string; severity: string; summary: string; detail?: string; parameterIds?: string[]; evidence?: Record<string, unknown> };

describe("the B-at-0 rule through the Agent", () => {
  it("proposes the tie, applies it only on an approved card, recovers the truth, and reports it; release and go_to_step undo it", async () => {
    const { pattern, structure } = simulated(600, 17);
    const { port, session } = sessionPort(loadedSession(structure, pattern, INSTRUMENT), INSTRUMENT);
    const history = headlessHistory(port);
    const { host } = fakeHost(port, history.history, (kind, agent) => history.record(kind, agent ? "agent" : undefined), history.goTo);
    // Asking first: the user keeps the Agent's preselected option on the card.
    const keep = (e: ActivityEntry) => (e.options ? { selected: Object.fromEntries(e.options.map((g) => [g.id, g.selected])) } : true);
    const { ex, asked } = executor(host, keep);
    const row = (id: string) => session().powderParams.find((p) => p.id === id)!;

    await ex.run("set_free", { free: ["scale", "bkg*", "B_O*"] });
    const first = parse((await ex.run("refine", {})).text) as { checks?: { warnings?: string[] } };
    history.record("refine", "agent", "Refine");
    // The fit left B(O1) on its bound: refine's checks carry the warning with the proposal and its source.
    expect(port.state().result!.diagnostics!.atBounds.map((b) => b.parameterId)).toEqual(["B_O1"]);
    const warning = first.checks?.warnings?.find((w) => w.startsWith("B(O1) refined to 0"));
    expect(warning).toMatch(/2 options, none applied until you choose one: 1\) preferred — tie it to B\(O2\), same element \(O²⁻\), which refined to [\d.]+\(\d+\) Å² \(a constraint: the common B still refines\)\. 2\) alternative — hold it at 0\.600 Å², the B of O1 in the loaded starting structure/);
    expect(warning).toMatch(/the Bayesian check on it \(sample_posterior\)/);
    // Nothing applied behind the user's back: the row is free, at its bound.
    expect(row("B_O1")).toMatchObject({ fixed: false, value: 0 });
    expect(row("B_O1").expression).toBeUndefined();

    // assess_refinement (the agent-visible bounds): the at-bound finding carries the proposal and how to apply it.
    const assessed = parse((await ex.run("assess_refinement", {})).text) as { findings: Finding[] };
    const atBound = assessed.findings.find((f) => f.category === "at-bound" && f.parameterIds?.includes("B_O1"))!;
    expect(atBound.detail).toMatch(/The B-at-0 rule: 2 options, none applied until you choose one: 1\) preferred — tie it to B\(O2\)/);
    expect(atBound.detail).toMatch(/apply_adp_proposal applies the option you choose by its id \(prefer the same-element tie/);
    expect(atBound.evidence).toMatchObject({ options: expect.stringMatching(/^1\) "tie:B_O2" preferred: /) });
    expect(atBound.evidence).toMatchObject({ proposal: "A", options: expect.stringMatching(/^1\) "tie:B_O2" preferred: tie to B_O2 — same element \(O²⁻\); 2\) "start" alternative: hold at 0\.6\d* — the starting structure's B$/) });
    const proposed = (parse((await ex.run("get_state", {})).text).bAtZero as { proposed: { parameter: string; rule: string; options: { option: number; rank: string; tieTo?: string; holdAt?: number }[] }[] }).proposed;
    expect(proposed).toEqual([expect.objectContaining({ parameter: "B_O1", rule: "A" })]);
    expect(proposed[0]!.options.map((o) => [o.option, o.rank, o.tieTo ?? o.holdAt])).toEqual([[1, "preferred", "B_O2"], [2, "alternative", expect.closeTo(TRUTH_O, 6)]]);

    // A declined card changes nothing.
    const { ex: no } = executor(host, false);
    const declined = parse((await no.run("apply_adp_proposal", { choose: [{ parameter: "B_O1", option: "tie:B_O2" }] })).text);
    expect(declined.declined).toBe(true);
    expect(row("B_O1").expression).toBeUndefined();
    // A row with no proposal is refused before any card.
    expect((await ex.run("apply_adp_proposal", { choose: [{ parameter: "B_O2", option: "start" }] })).text).toMatch(/not a free B the last fit left on its lower bound/);
    // An option the app did not offer is refused by name, with the row's own list; one outside the id pattern fails the schema.
    expect((await ex.run("apply_adp_proposal", { choose: [{ parameter: "B_O1", option: "tie:B_W1" }] })).text).toMatch(/B\(O1\) has no option "tie:B_W1": its options are "tie:B_O2" \(preferred, same element \(O²⁻\)\), "start" \(alternative, the starting structure's B\)/);
    const bad = await ex.run("apply_adp_proposal", { choose: [{ parameter: "B_O1", option: "0.3" }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/option/);
    expect(row("B_O1").expression).toBeUndefined();

    // Approved: the card names the atom, the B it reached, the Agent's choice and every other option, all of them to pick from.
    const before = history.history()!.current;
    const applied = await ex.run("apply_adp_proposal", { choose: [{ parameter: "B_O1", option: "tie:B_O2" }] });
    expect(applied.isError, applied.text).toBe(false);
    const card = asked.at(-1)!;
    expect(card.alwaysAsk).toBeUndefined();
    expect(card.preview).toMatch(/^B\(O1\) refined to 0 Å² \(its lower bound\)\. The Agent chose option 1 \(preferred\): tie it to B\(O2\), same element \(O²⁻\), which refined to [\d.]+\(\d+\) Å² \(a constraint: the common B still refines\)\. Other options: 2\) alternative — hold it at 0\.600 Å²/);
    expect(card.options).toEqual([{ id: "B_O1", title: "B(O1) refined to 0 Å² (its lower bound)", selected: "tie:B_O2", options: [expect.objectContaining({ id: "tie:B_O2", label: "1 · preferred" }), expect.objectContaining({ id: "start", label: "2 · alternative" })] }]);
    expect((parse(applied.text).applied as { chosenBy: string }[])[0]!.chosenBy).toBe("the user, on the card");
    expect(row("B_O1")).toMatchObject({ fixed: true, expression: "= B_O2", group: "user-tie" });
    expect(session().zeroAdpFixes).toEqual([expect.objectContaining({ parameterId: "B_O1", rule: "A", leader: "B_O2", reached: 0 })]);
    expect(session().zeroAdpFixes![0]!.chosenBy).toBeUndefined();
    history.record("settings", "agent", "B at 0: tie B_O1 = B_O2 (rule A)");

    // Refined with the tie: the common B recovers the truth within 3 esd, off every bound.
    await ex.run("refine", {});
    history.record("refine", "agent", "Refine");
    const r = port.state().result!;
    expect(r.diagnostics!.atBounds).toEqual([]);
    const common = r.parameters.B_O2!;
    expect(Math.abs(common - TRUTH_O)).toBeLessThan(3 * r.esd!.B_O2!);
    expect(row("B_O1").value).toBeCloseTo(common, 10);

    // The Agent sees the fix in force (assess_refinement, get_state); the report lists it among its limitations; the History names it.
    const after = parse((await ex.run("assess_refinement", {})).text) as { findings: Finding[] };
    expect(after.findings.find((f) => f.severity === "note" && f.parameterIds?.includes("B_O1"))?.summary).toMatch(/^B\(O1\) refined to 0 Å² \(its lower bound\) and is tied to B_O2 by the B-at-0 rule \(preferred: rule A: B\(O2\) \(B_O2\), same element/);
    expect((parse((await ex.run("get_state", {})).text).bAtZero as { applied: string[] }).applied).toHaveLength(1);
    const report = port.reportInput!();
    expect(report.warnings?.some((w) => /^B\(O1\) refined to 0 Å² .* tied to B_O2 by the B-at-0 rule/.test(w))).toBe(true);
    expect(reportHtml(report)).toMatch(/<h4[^>]*>Limitations<\/h4><p class="warn">⚠ B\(O1\) refined to 0/);
    expect(history.history()!.steps.some((s) => s.label === "B at 0: tie B_O1 = B_O2 (rule A)")).toBe(true);

    // Override: releasing the tie takes the fix out of force — the Agent and the report stop claiming it.
    await ex.run("tie_parameters", { release: ["B_O1"] });
    expect(port.state().zeroAdp!.applied).toEqual([]);
    expect(port.reportInput!().warnings ?? []).toEqual([]);
    expect(session().zeroAdpFixes).toBeUndefined();
    // The user's own tie of the same pair afterwards is theirs, not the rule's.
    await ex.run("tie_parameters", { equal: ["B_O2", "B_O1"] });
    expect(port.state().zeroAdp!.applied).toEqual([]);

    // Undo: back to the step before it was applied, the row is free again with no record.
    const back = await ex.run("go_to_step", { step: before });
    expect(back.isError, back.text).toBe(false);
    expect(row("B_O1").expression).toBeUndefined();
    expect(row("B_O1").fixed).toBe(false);
    expect(session().zeroAdpFixes ?? []).toEqual([]);
  }, 240_000);

  it("no B at its bound: no proposal, no warning, nothing to apply", async () => {
    const { pattern, structure } = simulated(1000, 1);
    const { port } = sessionPort(loadedSession(structure, pattern, INSTRUMENT), INSTRUMENT);
    const { ex } = executor(fakeHost(port).host, true);
    await ex.run("set_free", { free: ["scale", "bkg*", "B_*"] });
    const refined = (await ex.run("refine", {})).text;
    expect(port.state().result!.diagnostics!.atBounds).toEqual([]);
    expect(refined).not.toMatch(/B-at-0|its lower bound/);
    expect(port.state().zeroAdp).toEqual({ proposals: [], applied: [] });
    expect(parse((await ex.run("get_state", {})).text).bAtZero).toBeUndefined();
    expect((await ex.run("apply_adp_proposal", { choose: [{ parameter: "B_O1", option: "start" }] })).text).toMatch(/not a free B the last fit left on its lower bound/);
  }, 120_000);

  it("rule B with its source when no oxygen refined sensibly: the starting structure's B, as it stands", async () => {
    const { pattern, structure } = simulated(600, 30);
    const { port, session } = sessionPort(loadedSession(structure, pattern, INSTRUMENT), INSTRUMENT);
    const { ex, asked } = executor(fakeHost(port).host, true);
    await ex.run("set_free", { free: ["scale", "bkg*", "B_O*"] });
    await ex.run("refine", {});
    const [p, ...more] = port.state().zeroAdp!.proposals;
    expect(more).toEqual([]);
    expect(p).toMatchObject({ parameterId: "B_O1", rule: "B" });
    expect(p!.options).toEqual([expect.objectContaining({ rule: "B", rank: "alternative", value: TRUTH_O })]);
    expect(p!.options[0]!.source).toMatch(/the loaded starting structure "cr2wo6" .* not adjusted to the measurement temperature/);
    await ex.run("apply_adp_proposal", { choose: [{ parameter: "B_O1", option: "start" }] });
    expect(asked.at(-1)!.preview).toMatch(/^B\(O1\) refined to 0 Å² \(its lower bound\)\. The Agent chose option 1 \(alternative\): hold it at 0\.600 Å²/);
    expect(session().powderParams.find((q) => q.id === "B_O1")).toMatchObject({ fixed: true, value: TRUTH_O });
    expect(session().powderParams.find((q) => q.id === "B_O1")!.expression).toBeUndefined();
    // Override by freeing the row: the fix is no longer claimed.
    await ex.run("set_free", { free: ["B_O1"] });
    expect(port.state().zeroAdp!.applied).toEqual([]);
  }, 120_000);

  /** The draw-17 page refined, B(O1) on 0 with its two options: the tie to B(O2) (preferred) and the starting value. */
  async function railed(decision: Parameters<typeof executor>[1]) {
    const { pattern, structure } = simulated(600, 17);
    const { port, session } = sessionPort(loadedSession(structure, pattern, INSTRUMENT), INSTRUMENT);
    const { ex, asked } = executor(fakeHost(port).host, decision);
    await ex.run("set_free", { free: ["scale", "bkg*", "B_O*"] });
    await ex.run("refine", {});
    return { port, session, ex, asked, row: (id: string) => session().powderParams.find((p) => p.id === id)! };
  }

  it("asking first, the user picks an alternative on the card: their pick is applied, not the Agent's", async () => {
    const { session, ex, asked, row } = await railed((e) => (e.options ? { selected: { B_O1: "start" } } : true));
    const out = await ex.run("apply_adp_proposal", { choose: [{ parameter: "B_O1", option: "tie:B_O2" }] });
    expect(out.isError, out.text).toBe(false);
    expect(asked.at(-1)!.options![0]!.selected).toBe("tie:B_O2");
    expect(row("B_O1")).toMatchObject({ fixed: true, value: TRUTH_O });
    expect(row("B_O1").expression).toBeUndefined();
    expect(session().zeroAdpFixes).toEqual([expect.objectContaining({ rule: "B", value: TRUTH_O, alternatives: [expect.stringMatching(/^preferred: tie to B_O2/)] })]);
    expect(parse(out.text).applied).toEqual([expect.objectContaining({ option: "start", chosenBy: "the user, on the card", notTaken: [expect.stringMatching(/^tie:B_O2 \(preferred/)] })]);
  }, 120_000);

  it("asking first, the user declines: nothing is applied", async () => {
    const { session, ex, row } = await railed((e) => e.tool !== "apply_adp_proposal");
    const out = parse((await ex.run("apply_adp_proposal", { choose: [{ parameter: "B_O1", option: "tie:B_O2" }] })).text);
    expect(out.declined).toBe(true);
    expect(row("B_O1")).toMatchObject({ fixed: false, value: 0 });
    expect(session().zeroAdpFixes).toBeUndefined();
  }, 120_000);

  it("in auto mode the Agent's choice applies without a card, and is recorded as its own everywhere, with the options not taken", async () => {
    const { port, session, ex, asked, row } = await railed("auto");
    const out = await ex.run("apply_adp_proposal", { choose: [{ parameter: "B_O1", option: "tie:B_O2", reason: "both are the oxide's oxygens" }] });
    expect(out.isError, out.text).toBe(false);
    // The harness's auto approves without returning picks: as the app's auto mode, no card is answered.
    expect(asked.at(-1)!.tool).toBe("apply_adp_proposal");
    expect(row("B_O1")).toMatchObject({ expression: "= B_O2" });
    const result = parse(out.text) as { note: string; applied: { chosenBy: string; reason?: string; notTaken: string[] }[] };
    expect(result.note).toMatch(/^Applied in auto mode without a card: the Agent's choice/);
    expect(result.applied[0]).toMatchObject({ chosenBy: "the Agent, in auto mode (no card)", reason: "both are the oxide's oxygens", notTaken: [expect.stringMatching(/^start \(alternative/)] });
    expect(session().zeroAdpFixes).toEqual([expect.objectContaining({ chosenBy: "agent-auto", reason: "both are the oxide's oxygens" })]);
    // The page's notice and the report say so (both from the fix's text), and get_state too.
    const text = /Chosen by the Agent in auto mode, without a card \(its reason: both are the oxide's oxygens\): release it or undo the step if you would choose otherwise\. Not taken: alternative: hold at 0\.600 Å² \(the starting structure's B\)\./;
    expect(port.state().zeroAdp!.applied.map(zeroAdpFixText).join(" ")).toMatch(text);
    expect(port.reportInput!().warnings?.join(" ")).toMatch(text);
    expect(((parse((await ex.run("get_state", {})).text).bAtZero as { applied: string[] }).applied).join(" ")).toMatch(text);
  }, 120_000);

  it("a cross-element tie is taken only with a reason; without one the plan refuses it and names the safer options", async () => {
    const { port } = await railed("auto");
    const s = port.state();
    const w1: ZeroAdpProposal = {
      parameterId: "B_W1", sites: ["W1"], atom: "B(W1)", reached: 0, rule: "A", source: "rule A: …", advice: "…", warning: "…",
      options: [
        { id: "tie:B_Cr1", rule: "A", rank: "alternative", leader: "B_Cr1", label: "same coordination (6 O), different cation (W⁶⁺ vs Cr³⁺)", caution: "a different cation (W⁶⁺ vs Cr³⁺): check it is physically sensible", source: "rule A: …", text: "tie it to B(Cr1)" },
        { id: "start", rule: "B", rank: "alternative", value: 0.5, label: "the starting structure's B", source: "rule B: …", text: "hold it at 0.500 Å²" },
      ],
    };
    const state = { ...s, zeroAdp: { proposals: [w1], applied: [] } };
    expect(() => POWDER_PLANS.apply_adp_proposal({ choose: [{ parameter: "B_W1", option: "tie:B_Cr1" }] }, state, port)).toThrow(/option "tie:B_Cr1" for B\(W1\) ties it to a different cation \(W⁶⁺ vs Cr³⁺\): take it only when it is physically sensible, and say why in `reason`; otherwise choose "start"/);
    const plan = POWDER_PLANS.apply_adp_proposal({ choose: [{ parameter: "B_W1", option: "tie:B_Cr1", reason: "W and Cr share one octahedral site type here" }] }, state, port);
    expect("preview" in plan && plan.preview).toMatch(/The Agent chose option 1 \(alternative\): tie it to B\(Cr1\) — its reason: W and Cr share one octahedral site type here\. Other options: 2\) alternative — hold it at 0\.500 Å²/);
    expect(() => POWDER_PLANS.apply_adp_proposal({ choose: [{ parameter: "B_W1", option: "start" }, { parameter: "B_W1", option: "start" }] }, state, port)).toThrow(/chosen twice/);
  }, 120_000);
});
