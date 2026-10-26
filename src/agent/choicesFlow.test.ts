import { describe, expect, it } from "vitest";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { mn3gaMagneticSession } from "@/agent/evals/pages";
import { kComponentsIn, type ChoiceSet } from "@/agent/choices";
import { turnChoices } from "@/agent/ui/AgentDrawer";
import type { ActivityEntry } from "@/agent/executor";
import type { TranscriptItem } from "@/agent/useAgent";

/**
 * Clickable choices through the real executor, on the synthetic Mn₃Ga
 * pattern with magnetic satellites at k = (0 0 ½): the k-search's entry
 * carries its options for the page it ran on, and each option's message,
 * read as set_propagation_vector reads it, sets exactly the k it shows.
 */
describe("choices from the executor", () => {
  it("offers the k-search's candidates, each of whose messages sets exactly that k, then goes stale", async () => {
    const { port } = sessionPort(mn3gaMagneticSession());
    const { ex, seen } = executor(fakeHost(port).host, true);
    await ex.run("read_skill", { name: "magnetic-analysis" });
    const out = JSON.parse((await ex.run("search_propagation_vector", {})).text) as { candidates: { k: string; components: number[] }[]; simplest: string };
    const entry = seen.filter((e) => e.tool === "search_propagation_vector" && e.status === "done").at(-1)!;
    const set = entry.choices!;
    expect(set.kind).toBe("k");
    expect(set.stamp).toBe(ex.stamp());
    expect(set.note).toMatch(/^k in reciprocal-lattice units of the structure's cell as loaded/);
    expect(set.options.find((o) => o.recommended)).toMatchObject({ label: "k = (0 0 ½)", message: "Set the propagation vector to k = (0, 0, 1/2)." });

    for (const option of set.options) {
      const candidate = out.candidates.find((c) => `k = ${c.k}` === option.label)!;
      expect(candidate, option.label).toBeDefined();
      // What the model passes on from the user's message: the triple it names.
      const set_ = JSON.parse((await ex.run("set_propagation_vector", { k: kComponentsIn(option.message)! })).text) as Record<string, unknown>;
      expect(set_.declined).toBeUndefined();
      expect([...port.magnetic!()!.state().k]).toEqual(candidate.components);
    }
    // The page moved on: the set no longer describes it.
    expect(ex.stamp()).not.toBe(set.stamp);
  }, 60000);

  it("puts no choices on a tool that offers none", async () => {
    const { port } = sessionPort(mn3gaMagneticSession());
    const { ex, seen } = executor(fakeHost(port).host, true);
    await ex.run("magnetic_state", {});
    await ex.run("get_state", {});
    expect(seen.filter((e) => e.choices)).toEqual([]);
  }, 60000);
});

describe("which choices the drawer shows, and whether they still send", () => {
  const set = (stamp: string): ChoiceSet => ({ kind: "k", tool: "search_propagation_vector", title: "Propagation vector k", options: [{ id: "a", label: "k = (½ 0 0)", message: "Set the propagation vector to k = (1/2, 0, 0)." }], other: { label: "Another k…", template: "" }, stamp });
  const entry = (id: string, tool: string, patch: Partial<ActivityEntry> = {}): ActivityEntry => ({ id, tool, title: tool, effect: "compute", at: 0, status: "done", ...patch });
  const activity: Record<string, ActivityEntry> = {
    s1: entry("s1", "search_propagation_vector", { choices: set("A") }),
    s2: entry("s2", "search_propagation_vector", { choices: set("B") }),
    c1: entry("c1", "set_propagation_vector", { effect: "change" }),
    s3: entry("s3", "search_propagation_vector", { choices: set("C") }),
  };
  const items: TranscriptItem[] = [
    { kind: "user", id: "u1", text: "Find k." },
    { kind: "tool", id: "t1", entryId: "s1" },
    { kind: "assistant", id: "a1", text: "Which k?", thinking: "" },
    { kind: "user", id: "u2", text: "Set the propagation vector to k = (1/2, 0, 0)." },
    { kind: "tool", id: "t2", entryId: "s2" },
    { kind: "tool", id: "t3", entryId: "c1" },
    { kind: "assistant", id: "a2", text: "Set.", thinking: "" },
    { kind: "user", id: "u3", text: "Search again." },
    { kind: "tool", id: "t4", entryId: "s3" },
    { kind: "assistant", id: "a3", text: "Which k?", thinking: "" },
  ];

  it("the last finished turn's set is live; an earlier turn's is superseded; one acted on in its turn is not shown", () => {
    const shown = turnChoices(items, activity, false);
    expect([...shown.keys()]).toEqual(["a1", "a3"]);
    expect(shown.get("a1")).toMatchObject({ entryId: "s1", state: "superseded" });
    expect(shown.get("a3")).toMatchObject({ entryId: "s3", state: "live" });
  });

  it("nothing sends while a turn runs", () => {
    const shown = turnChoices(items, activity, true);
    expect(shown.get("a3")).toBeUndefined();
    expect(shown.get("a1")).toMatchObject({ state: "superseded" });
  });

  it("a declined change after the set leaves it live: the page did not move", () => {
    const declined = { ...activity, c1: { ...activity.c1!, status: "declined" as const } };
    const two = items.slice(0, 7);
    expect(turnChoices(two, declined, false).get("a2")).toMatchObject({ entryId: "s2", state: "live" });
  });
});
