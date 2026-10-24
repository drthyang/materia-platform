import { describe, it, expect } from "vitest";
import { loadedSession } from "@/app/powderSession";
import { executor, fakeHost, headlessHistory, sessionPort } from "@/testSupport/agentHeadless";
import { reportHtml } from "@/core/export/report";
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
    const { ex, asked } = executor(host, true);
    const row = (id: string) => session().powderParams.find((p) => p.id === id)!;

    await ex.run("set_free", { free: ["scale", "bkg*", "B_O*"] });
    const first = parse((await ex.run("refine", {})).text) as { checks?: { warnings?: string[] } };
    history.record("refine", "agent", "Refine");
    // The fit left B(O1) on its bound: refine's checks carry the warning with the proposal and its source.
    expect(port.state().result!.diagnostics!.atBounds.map((b) => b.parameterId)).toEqual(["B_O1"]);
    const warning = first.checks?.warnings?.find((w) => w.startsWith("B(O1) refined to 0"));
    expect(warning).toMatch(/Proposed \(rule A\): tie it to B\(O2\), same element \(O\), which refined to [\d.]+\(\d+\) Å²/);
    expect(warning).toMatch(/the Bayesian check on it \(sample_posterior\)/);
    // Nothing applied behind the user's back: the row is free, at its bound.
    expect(row("B_O1")).toMatchObject({ fixed: false, value: 0 });
    expect(row("B_O1").expression).toBeUndefined();

    // assess_refinement (the agent-visible bounds): the at-bound finding carries the proposal and how to apply it.
    const assessed = parse((await ex.run("assess_refinement", {})).text) as { findings: Finding[] };
    const atBound = assessed.findings.find((f) => f.category === "at-bound" && f.parameterIds?.includes("B_O1"))!;
    expect(atBound.detail).toMatch(/The B-at-0 rule: Proposed \(rule A\): tie it to B\(O2\)/);
    expect(atBound.detail).toMatch(/apply_adp_proposal applies it \(the user approves the card\)/);
    expect(atBound.evidence).toMatchObject({ proposal: "A", tieTo: "B_O2" });
    expect((parse((await ex.run("get_state", {})).text).bAtZero as { proposed: { parameter: string; rule: string }[] }).proposed).toEqual([expect.objectContaining({ parameter: "B_O1", rule: "A" })]);

    // A declined card changes nothing.
    const { ex: no } = executor(host, false);
    const declined = parse((await no.run("apply_adp_proposal", { parameters: ["B_O1"] })).text);
    expect(declined.declined).toBe(true);
    expect(row("B_O1").expression).toBeUndefined();
    // A row with no proposal is refused before any card.
    expect((await ex.run("apply_adp_proposal", { parameters: ["B_O2"] })).text).toMatch(/not a free B the last fit left on its lower bound/);

    // Approved: the card names the atom, the B it reached, the tie and its source — and always asks.
    const before = history.history()!.current;
    const applied = await ex.run("apply_adp_proposal", { parameters: ["B_O1"] });
    expect(applied.isError, applied.text).toBe(false);
    const card = asked.at(-1)!;
    expect(card.alwaysAsk).toBe(true);
    expect(card.preview).toMatch(/^B\(O1\) refined to 0 Å² \(its lower bound\)\. Proposed \(rule A\): tie it to B\(O2\), same element \(O\), which refined to [\d.]+\(\d+\) Å² — a constraint/);
    expect(row("B_O1")).toMatchObject({ fixed: true, expression: "= B_O2", group: "user-tie" });
    expect(session().zeroAdpFixes).toEqual([expect.objectContaining({ parameterId: "B_O1", rule: "A", leader: "B_O2", reached: 0 })]);
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
    expect(after.findings.find((f) => f.severity === "note" && f.parameterIds?.includes("B_O1"))?.summary).toMatch(/^B\(O1\) refined to 0 Å² \(its lower bound\) and is tied to B_O2 by the B-at-0 rule \(rule A: B\(O2\) \(B_O2\), same element/);
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
    expect((await ex.run("apply_adp_proposal", { parameters: ["B_O1"] })).text).toMatch(/not a free B the last fit left on its lower bound/);
  }, 120_000);

  it("rule B with its source when no oxygen refined sensibly: the starting structure's B, as it stands", async () => {
    const { pattern, structure } = simulated(600, 30);
    const { port, session } = sessionPort(loadedSession(structure, pattern, INSTRUMENT), INSTRUMENT);
    const { ex, asked } = executor(fakeHost(port).host, true);
    await ex.run("set_free", { free: ["scale", "bkg*", "B_O*"] });
    await ex.run("refine", {});
    const [p, ...more] = port.state().zeroAdp!.proposals;
    expect(more).toEqual([]);
    expect(p).toMatchObject({ parameterId: "B_O1", rule: "B", value: TRUTH_O });
    expect(p!.source).toMatch(/the loaded starting structure "cr2wo6" .* not adjusted to the measurement temperature/);
    await ex.run("apply_adp_proposal", { parameters: ["B_O1"] });
    expect(asked.at(-1)!.preview).toMatch(/^B\(O1\) refined to 0 Å² \(its lower bound\)\. Proposed \(rule B\): hold it at 0\.600 Å²/);
    expect(session().powderParams.find((q) => q.id === "B_O1")).toMatchObject({ fixed: true, value: TRUTH_O });
    expect(session().powderParams.find((q) => q.id === "B_O1")!.expression).toBeUndefined();
    // Override by freeing the row: the fix is no longer claimed.
    await ex.run("set_free", { free: ["B_O1"] });
    expect(port.state().zeroAdp!.applied).toEqual([]);
  }, 120_000);
});
