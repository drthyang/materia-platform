import { describe, it, expect } from "vitest";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { compactResult, digestResult, historyChars, pruneForLocal } from "@/agent/contextWindow";

type Step = { name: string; input?: Record<string, unknown>; result: string; error?: boolean; thinking?: string };

/** A session of tool calls, one per turn, each answered. */
function session(steps: readonly Step[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [{ role: "user", content: "Refine it." }];
  steps.forEach((s, i) => {
    out.push({ role: "assistant", content: [...(s.thinking ? [{ type: "thinking" as const, thinking: s.thinking, signature: "" }] : []), { type: "tool_use", id: `t${i}`, name: s.name, input: s.input ?? {} }] });
    out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: s.result, ...(s.error ? { is_error: true } : {}) }] });
  });
  return out;
}

const results = (h: readonly BetaMessageParam[]): string[] =>
  h.flatMap((m) => (m.role === "user" && typeof m.content !== "string" ? m.content.filter((b) => b.type === "tool_result").map((b) => String((b as { content: unknown }).content)) : []));

const state = (wR: number, ref: number): string => JSON.stringify({ ref: `#${ref}`, technique: "powder", wR, phases: [{ name: "Mn3Ga", spaceGroup: "P 63/m m c" }], pad: "x".repeat(1500) });
const SKILL = "Skill my-rietveld-workflow\n\n" + "m".repeat(3000);

describe("keeping a local model's history in its window", () => {
  it("leaves a history under the budget alone", () => {
    const h = session([{ name: "get_state", result: state(8, 1) }]);
    expect(pruneForLocal(h, 10_000)).toEqual(h);
  });

  it("turns old results into digests that say what they held and whether it still holds, and keeps the method whole", () => {
    const steps: Step[] = [
      { name: "read_skill", input: { name: "my-rietveld-workflow" }, result: SKILL },
      { name: "get_state", result: state(9.1, 1) },
      { name: "check_fit_range", result: state(9.1, 2) },
      { name: "refine", result: JSON.stringify({ ref: "#3", refined: true, status: "converged", wR: 8.31, pad: "y".repeat(1500) }) },
      { name: "get_state", result: state(8.31, 4) },
      { name: "assess_refinement", result: "Error: refine first", error: true },
      // The method read again (the user's loop): only the latest copy stays.
      { name: "read_skill", input: { name: "my-rietveld-workflow" }, result: SKILL },
      { name: "get_state", result: state(8.31, 5) },
    ];
    const h = session(steps);
    const before = JSON.stringify(h);
    const pruned = pruneForLocal(h, 9000, 2);
    expect(historyChars(pruned)).toBeLessThanOrEqual(9000);
    const r = results(pruned);
    expect(r[0]).toBe('[read_skill "my-rietveld-workflow": read again later in this conversation, where it is in full.]');
    expect(r[6]).toBe(SKILL);
    // A result from before a change says so, and how to see the analysis now.
    expect(r[1]).toBe('[get_state, an earlier result (#1), shortened to fit the model\'s window: technique powder · wR 9.1 · pad ' + "x".repeat(59) + '… · phases[] 1 · phases[0].name Mn3Ga · phases[0].spaceGroup P 63/m m c. After it, refine changed the analysis: get_state gives it as it is now. read_ref "#1" gives it whole.]');
    expect(r[3]).toMatch(/^\[refine, an earlier result \(#3\), shortened to fit the model's window: refined true · status converged · wR 8\.31 · pad y+…\. No change ran after it, up to the results kept whole below\. read_ref "#3" gives it whole\.\]$/);
    // Digested two at a time: the four oldest went, the newer ones stay whole.
    expect(r[5]).toBe("Error: refine first");
    expect(digestResult("assess_refinement", "Error: refine first", true, [])).toBe("[assess_refinement, an earlier call: it answered with an error: Error: refine first]");
    // The last result is whole; the stored history is untouched; the same history prunes the same way.
    expect(r[7]).toBe(state(8.31, 5));
    expect(JSON.stringify(h)).toBe(before);
    expect(pruneForLocal(h, 9000, 2)).toEqual(pruned);
  });

  it("digests in batches, so between batches the copy sent only grows at its end (the server's prefix cache holds)", () => {
    const steps: Step[] = [{ name: "read_skill", input: { name: "my-rietveld-workflow" }, result: SKILL }];
    for (let i = 0; i < 30; i++) steps.push({ name: i % 2 ? "get_state" : "refine", result: state(9 - i / 10, i + 1) });
    let moves = 0;
    let previous: BetaMessageParam[] | null = null;
    for (let n = 2; n <= steps.length; n++) {
      const pruned = pruneForLocal(session(steps.slice(0, n)), 24_000, 6);
      expect(historyChars(pruned)).toBeLessThanOrEqual(24_000);
      if (previous !== null && JSON.stringify(pruned.slice(0, previous.length)) !== JSON.stringify(previous)) moves++;
      previous = pruned;
    }
    // A window sliding by one result would rewrite the prefix on almost every turn.
    expect(moves).toBeLessThanOrEqual(6);
    expect(moves).toBeGreaterThan(0);
  });

  it("never shortens a result of the last round, which the model has not read yet", () => {
    const h = session([{ name: "get_state", result: state(9, 1) }, { name: "get_state", result: state(9, 2) }]);
    // The last round made three calls at once.
    h.push({ role: "assistant", content: ["a", "b", "c"].map((id) => ({ type: "tool_use" as const, id, name: "get_state", input: {} })) });
    h.push({ role: "user", content: ["a", "b", "c"].map((id, i) => ({ type: "tool_result" as const, tool_use_id: id, content: state(8, 10 + i) })) });
    const r = results(pruneForLocal(h, 1000, 1));
    expect(r.slice(0, 2).every((x) => x.startsWith("[get_state"))).toBe(true);
    expect(r.slice(2)).toEqual([state(8, 10), state(8, 11), state(8, 12)]);
  });

  it("keeps a digest's words until the next batch, whatever changes after it", () => {
    const steps: Step[] = [
      { name: "get_state", result: state(9, 1) },
      { name: "refine", result: state(8, 2) },
      { name: "get_state", result: state(8, 3) },
      { name: "get_state", result: state(8, 4) },
    ];
    const first = pruneForLocal(session(steps), 4000, 2);
    // A new kind of change after the batch's last digested result: the digests read as before.
    const later = pruneForLocal(session([...steps, { name: "set_background", result: JSON.stringify({ ref: "#5", terms: 6 }) }]), 4000, 2);
    expect(results(later).slice(0, 2)).toEqual(results(first).slice(0, 2));
  });

  it("when digests are not enough, shortens the oldest to one line and the replies around them, oldest first", () => {
    const steps: Step[] = Array.from({ length: 24 }, (_, i) => ({ name: i % 2 ? "get_state" : "refine", result: state(9 - i / 10, i + 1) }));
    const h = session(steps);
    // Long replies, as a local model writes them.
    for (const m of h) if (m.role === "assistant" && typeof m.content !== "string") m.content.unshift({ type: "text", text: "I refined the scale and the background; ".repeat(30) });
    const digestsOnly = pruneForLocal(h, 1_000_000);
    expect(digestsOnly).toEqual(h);
    const pruned = pruneForLocal(h, 14_000, 6);
    expect(historyChars(pruned)).toBeLessThanOrEqual(14_000);
    const r = results(pruned);
    expect(r[0]).toMatch(/^\[refine #1: technique powder · wR 9 · pad x+…?/);
    expect(r[0]!.length).toBeLessThan(140);
    expect(r.at(-1)).toBe(state(9 - 23 / 10, 24));
    const firstReply = (pruned[1]!.content as { type: string; text?: string }[])[0]!.text!;
    expect(firstReply).toMatch(/… \(shortened to fit the window\)$/);
    expect(firstReply.length).toBeLessThan(180);
    // The user's message and every call stay.
    expect(pruned[0]).toEqual(h[0]);
    expect(pruned.filter((m) => m.role === "assistant").flatMap((m) => (m.content as { type: string }[]).filter((b) => b.type === "tool_use"))).toHaveLength(24);
  });

  it("drops the reasoning of the turns it digests, and keeps the latest", () => {
    const steps: Step[] = Array.from({ length: 8 }, (_, i) => ({ name: "get_state", result: state(9, i + 1), thinking: "t".repeat(800) }));
    const pruned = pruneForLocal(session(steps), 8000, 4);
    const thinking = pruned.map((m) => (m.role === "assistant" && typeof m.content !== "string" ? m.content.some((b) => b.type === "thinking") : null)).filter((x) => x !== null);
    expect(thinking.slice(0, 4).every((t) => !t)).toBe(true);
    expect(thinking.at(-1)).toBe(true);
  });

  it("does its most when nothing fits, and the chat measures it", () => {
    const h = session([{ name: "read_skill", input: { name: "my-rietveld-workflow" }, result: SKILL }, { name: "get_state", result: state(8, 1) }]);
    const pruned = pruneForLocal(h, 1000);
    expect(historyChars(pruned)).toBeGreaterThan(1000);
    expect(results(pruned)).toEqual([SKILL, state(8, 1)]);
  });

  it("digests a text result and a declined change", () => {
    expect(compactResult("assess_refinement", "Error: refine first", true)).toBe("[assess_refinement: an error: Error: refine first]");
    expect(digestResult("read_ref", "plain text\nresult", false, [])).toBe("[read_ref, an earlier result, shortened to fit the model's window: plain text result. No change ran after it, up to the results kept whole below.]");
    const h = session([
      { name: "get_state", result: state(8, 1) },
      { name: "set_free", result: JSON.stringify({ ref: "#2", declined: true }) },
      { name: "get_state", result: state(8, 3) },
    ]);
    // A declined change changed nothing.
    expect(results(pruneForLocal(h, 3000, 1))[0]).toMatch(/No change ran after it, up to the results kept whole below\./);
  });
});

describe("when even one-line digests are not enough", () => {
  it("shortens a method read before the latest to its outline, never the latest", () => {
    const rietveld = "Skill my-rietveld-workflow\n\n# My Rietveld workflow\n\n## Stage 0 — the fit range\n" + "r".repeat(9000) + "\n## Stage 1 — refinement\n" + "r".repeat(9000);
    const magnetic = "Skill magnetic-analysis\n\n# Powder magnetic analysis\n" + "m".repeat(5000);
    const h = session([
      { name: "read_skill", input: { name: "my-rietveld-workflow" }, result: rietveld },
      { name: "get_state", result: state(9, 1) },
      { name: "read_skill", input: { name: "magnetic-analysis" }, result: magnetic },
      { name: "magnetic_state", result: state(9, 2) },
    ]);
    const pruned = pruneForLocal(h, 10_000);
    expect(historyChars(pruned)).toBeLessThanOrEqual(10_000);
    const r = results(pruned);
    expect(r[0]).toMatch(/^\[read_skill "my-rietveld-workflow": read earlier, shortened to its outline/);
    expect(r[0]).toContain("## Stage 0 — the fit range\n## Stage 1 — refinement");
    expect(r[2]).toBe(magnetic);
    // A single method is never shortened.
    const one = session([{ name: "read_skill", input: { name: "my-rietveld-workflow" }, result: rietveld }, { name: "get_state", result: state(9, 1) }]);
    expect(results(pruneForLocal(one, 5000))[0]).toBe(rietveld);
  });
});
