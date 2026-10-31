import { describe, it, expect } from "vitest";
import { recordExchange, recordingId, turnFromSse } from "./recorder";
import { sse, type ScriptTurn } from "./sse";
import { replayOfLabel, scriptedLabel } from "./arm";
import { replayLabel } from "@/agent/useAgent";

const ask = (messages: unknown[], model = "claude-sonnet-5-5"): string => JSON.stringify({ model, messages });
const toolUse = (id: string, name: string, input: object = {}) => ({ type: "tool_use", id, name, input });
const result = (id: string, text: string, isError = false) => ({ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }], ...(isError ? { is_error: true } : {}) });

describe("run recorder", () => {
  it("reads a streamed turn back as the replay server writes it: the text and each call with its input", () => {
    const turn: ScriptTurn = { text: "k = (½ 0 0) explains every peak.", calls: [{ name: "set_propagation_vector", input: { k: [0.5, 0, 0] } }, { name: "rank_magnetic_groups" }] };
    expect(turnFromSse(sse(turn, 3))).toEqual({ text: turn.text, calls: [{ name: "set_propagation_vector", input: { k: [0.5, 0, 0] } }, { name: "rank_magnetic_groups", input: {} }] });
    // A tool call's input arrives in pieces; thinking is not part of the replay.
    const pieces = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hm"}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"set_free","input":{}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"free\\": [\\"sca"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"le\\"]}"}}',
    ].join("\n\n");
    expect(turnFromSse(pieces)).toEqual({ calls: [{ name: "set_free", input: { free: ["scale"] } }] });
  });

  it("keeps the turns by the request's place in the run, the scientist's later messages, and what each tool answered", () => {
    const first = "Refine this 8 K neutron pattern.";
    const t0: ScriptTurn = { text: "The fit window first.", calls: [{ name: "check_fit_range" }] };
    const t1: ScriptTurn = { text: "Refining.", calls: [{ name: "refine" }] };
    const t2: ScriptTurn = { text: "Done: wR 8.57 %." };
    const at = new Date("2026-10-26T10:15:00.000Z");
    let run = recordExchange(null, ask([{ role: "user", content: first }]), sse(t0, 1), at);
    expect(run?.message).toBe(first);
    expect(run?.turns).toEqual([{ text: t0.text, calls: [{ name: "check_fit_range", input: {} }] }]);
    const history1 = [{ role: "user", content: first }, { role: "assistant", content: [{ type: "text", text: t0.text }, toolUse("a", "check_fit_range")] }, { role: "user", content: [result("a", "Both ends hold.")] }];
    run = recordExchange(run, ask(history1), sse(t1, 2), new Date("2026-10-26T10:16:00Z"));
    // The scientist declined the refinement, then typed a message.
    const history2 = [...history1, { role: "assistant", content: [{ type: "text", text: t1.text }, toolUse("b", "refine")] }, { role: "user", content: [result("b", "The user declined this change.", true), { type: "text", text: "Free the zero too." }] }];
    run = recordExchange(run, ask(history2), sse(t2, 3), new Date("2026-10-26T10:17:00Z"));
    expect(run?.turns).toHaveLength(3);
    expect(run?.turns[2]).toEqual({ text: t2.text });
    expect(run?.recordedAt).toBe(at.toISOString());
    expect(run?.userMessages).toEqual([{ beforeTurn: 2, text: "Free the zero too." }]);
    expect(run?.results).toEqual([
      { turn: 0, tool: "check_fit_range", isError: false, text: "Both ends hold." },
      { turn: 1, tool: "refine", isError: true, text: "The user declined this change." },
    ]);
    expect(recordingId(run!)).toBe("local-live-claude-sonnet-5-5-20261026-101500");
    // A request with no model turn yet starts a new recording.
    const next = recordExchange(run, ask([{ role: "user", content: "Another dataset." }]), sse({ text: "On it." }, 1), new Date("2026-10-26T11:00:00Z"));
    expect(next?.turns).toEqual([{ text: "On it." }]);
    expect(recordingId(next!)).toBe("local-live-claude-sonnet-5-5-20261026-110000");
  });

  it("names a recording as a replay of a live run by its model; a scripted replay stays labelled scripted", () => {
    expect(replayOfLabel("local-live-claude-sonnet-5-5-20261026-101500")).toBe("Claude Sonnet 5.5");
    expect(replayLabel(replayOfLabel("local-live-claude-sonnet-5-5-20261026-101500"))).toBe("Claude Sonnet 5.5 · replay of a live run");
    expect(replayOfLabel("local-awo4-magnetic")).toBe(scriptedLabel("local-awo4-magnetic"));
    expect(replayLabel(replayOfLabel("local-awo4-magnetic"))).toMatch(/a scripted replay, not a live run$/);
  });
});
