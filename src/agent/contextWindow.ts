/**
 * Keeping a long session inside the model's window.
 *
 * Claude: the API clears old tool results itself (context editing,
 * `CONTEXT_EDITING`) once the prompt passes a threshold, keeping the last few
 * and every skill read. Server-side clearing is not an edit of the history the
 * model's thinking is bound to, so it is the safe way to clear there.
 *
 * Local models (Ollama, LM Studio): their window is far smaller (32k), and a
 * prompt longer than it is not refused but cut, from the middle, without a
 * word (LM Studio's TruncateMiddle; Ollama keeps the start): the model then
 * answers without its method and its earlier results, and calls the same
 * tools again and again. So the app sends a copy of the history that fits
 * (`pruneForLocal`, sized by the chat from the server's real context), and
 * keeps the full history:
 *
 *  - an old tool result becomes a digest: the tool, its ref, its key values,
 *    and which changes ran after it (up to the results kept whole) — so the
 *    model knows what it already learned, and whether it still holds.
 *    `read_ref` opens the whole result again.
 *  - a skill read again keeps only its latest copy; the method itself is
 *    never cut.
 *  - results are digested in batches, oldest first: between batches the
 *    pruned copy only grows at its end, so the server's prefix cache keeps
 *    the whole conversation, instead of losing it each turn to a window
 *    sliding by one result.
 *
 * A pure function of the history, so the same history always prunes the
 * same way.
 */

import type { BetaContentBlockParam, BetaContextManagementConfig, BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { liveTool } from "@/agent/tools";

/** Results never cleared: a skill is the method the Agent works by. */
export const KEEP_TOOLS: readonly string[] = ["read_skill"];

/** Claude: clear old tool results past 60k input tokens, in batches of 15k or more, keeping the last 6. */
export const CONTEXT_EDITING: BetaContextManagementConfig = {
  edits: [
    {
      type: "clear_tool_uses_20250919",
      trigger: { type: "input_tokens", value: 60_000 },
      keep: { type: "tool_uses", value: 6 },
      clear_at_least: { type: "input_tokens", value: 15_000 },
      exclude_tools: [...KEEP_TOOLS],
    },
  ],
};
export const CONTEXT_EDITING_BETA = "context-management-2025-06-27";

/** Local models: the history's budget when the chat does not size it from the server (~15k tokens). */
export const LOCAL_BUDGET_CHARS = 60_000;
/** Old results are digested this many at a time, so the pruned prefix stays the same between batches. */
export const LOCAL_BATCH = 6;
/** Most characters of key values a digest quotes. */
const DIGEST_VALUES = 280;

const size = (m: BetaMessageParam): number => (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length);
/** The characters a history takes as sent (its content as JSON). */
export const historyChars = (messages: readonly BetaMessageParam[]): number => messages.reduce((n, m) => n + size(m), 0);

const resultText = (b: BetaToolResultBlockParam): string =>
  typeof b.content === "string" ? b.content : (b.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("\n");

interface Call {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * The history as a local model gets it, within `budget` characters: under it,
 * unchanged; over it, older copies of a skill read again, then the oldest
 * tool results in batches of `batch` (never those of the last round), digested, and the
 * reasoning of the turns before them dropped, until it fits. When even that
 * does not fit, the most it can do; the chat measures the result and refuses
 * to send a prompt the model would lose.
 */
export function pruneForLocal(messages: readonly BetaMessageParam[], budget = LOCAL_BUDGET_CHARS, batch = LOCAL_BATCH): BetaMessageParam[] {
  if (historyChars(messages) <= budget) return [...messages];
  const callOf = new Map<string, Call>();
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const b of m.content) if (b.type === "tool_use") callOf.set(b.id, { name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
  }
  // Every tool result in order, with the message it sits in.
  const results: { readonly id: string; readonly message: number; readonly name: string }[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "user" || typeof m.content === "string") return;
    for (const b of m.content) if (b.type === "tool_result") results.push({ id: b.tool_use_id, message: i, name: callOf.get(b.tool_use_id)?.name ?? "a tool" });
  });
  // The latest read of each skill (and reference) stays whole; an earlier read of the same one is a repeat.
  const skillKey = (r: { id: string; name: string }): string => `${r.name} ${JSON.stringify(callOf.get(r.id)?.input ?? {})}`;
  const latestSkill = new Map<string, string>();
  for (const r of results) if (KEEP_TOOLS.includes(r.name)) latestSkill.set(skillKey(r), r.id);
  const staleSkills = new Set(results.filter((r) => KEEP_TOOLS.includes(r.name) && latestSkill.get(skillKey(r)) !== r.id).map((r) => r.id));
  const others = results.filter((r) => !KEEP_TOOLS.includes(r.name));

  const prune = (cut: number): BetaMessageParam[] => {
    const digested = new Set([...staleSkills, ...others.slice(0, cut).map((r) => r.id)]);
    // What changed after each digested result, up to the last digested one: a digest depends only
    // on the batch, so it reads the same until the next batch; later changes are in the results kept whole.
    const changed = changesAfter(messages, callOf, cut > 0 ? others[cut - 1]!.id : null);
    // The reasoning of every turn before the last digested result goes with it.
    const thinkingBefore = cut > 0 ? others[cut - 1]!.message : -1;
    return messages.map((m, i) => {
      if (m.role === "assistant") {
        if (i > thinkingBefore || typeof m.content === "string" || !m.content.some((b) => b.type === "thinking" || b.type === "redacted_thinking")) return m;
        const kept = m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
        return { ...m, content: kept.length ? kept : [{ type: "text", text: "(reasoning left out to fit the window)" }] };
      }
      if (typeof m.content === "string" || !m.content.some((b) => b.type === "tool_result" && digested.has(b.tool_use_id))) return m;
      return {
        ...m,
        content: m.content.map((b): BetaContentBlockParam => {
          if (b.type !== "tool_result" || !digested.has(b.tool_use_id)) return b;
          const call = callOf.get(b.tool_use_id) ?? { name: "a tool", input: {} };
          const text = staleSkills.has(b.tool_use_id)
            ? `[${call.name} ${skillName(call.input)}: read again later in this conversation, where it is in full.]`
            : digestResult(call.name, resultText(b), b.is_error === true, changed.get(b.tool_use_id) ?? []);
          return { type: "tool_result", tool_use_id: b.tool_use_id, content: text, ...(b.is_error ? { is_error: true } : {}) };
        }),
      };
    });
  };
  // The smallest batch of digests that fits; never a result of the last round, which the model has not read yet.
  const lastRound = results.length ? results.at(-1)!.message : -1;
  const most = others.filter((r) => r.message < lastRound).length;
  for (let cut = 0; ; cut = Math.min(most, cut + batch)) {
    const pruned = prune(cut);
    if (historyChars(pruned) <= budget || cut === most) return pruned;
  }
}

const skillName = (input: Readonly<Record<string, unknown>>): string =>
  [input.name, input.reference].filter((v): v is string => typeof v === "string").map((v) => `"${v}"`).join(" · ");

/** For each tool result, the change tools that ran (and changed something) after it, up to the result `until` (null: none), in order. */
function changesAfter(messages: readonly BetaMessageParam[], callOf: ReadonlyMap<string, Call>, until: string | null): Map<string, string[]> {
  const order: { readonly id: string; readonly change: string | null }[] = [];
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type !== "tool_result") continue;
      const name = callOf.get(b.tool_use_id)?.name ?? "";
      const done = liveTool(name)?.effect === "change" && b.is_error !== true && !/"(declined|unchanged)":true/.test(resultText(b));
      order.push({ id: b.tool_use_id, change: done ? name : null });
    }
  }
  if (until === null) return new Map();
  order.splice(order.findIndex((o) => o.id === until) + 1);
  const out = new Map<string, string[]>();
  const later: string[] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    out.set(order[i]!.id, [...new Set(later)]);
    if (order[i]!.change) later.unshift(order[i]!.change!);
  }
  return out;
}

/**
 * An old result in a line or two: the tool, its ref, the key values (the
 * top-level numbers and short texts first), and whether the analysis changed
 * since — the model reads what it already learned, and is not sent to call
 * the tool again.
 */
export function digestResult(tool: string, text: string, isError: boolean, changedSince: readonly string[]): string {
  if (isError) return `[${tool}, an earlier call: it answered with an error: ${clip(text.replace(/\s+/g, " "), 200)}]`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const ref = parsed !== null && typeof parsed === "object" && typeof (parsed as { ref?: unknown }).ref === "string" ? (parsed as { ref: string }).ref : null;
  const values = parsed === undefined ? clip(text.replace(/\s+/g, " "), DIGEST_VALUES) : keyValues(parsed, DIGEST_VALUES);
  const since = changedSince.length === 0
    ? "No change ran after it, up to the results kept whole below."
    : `After it, ${changedSince.slice(0, 4).join(", ")}${changedSince.length > 4 ? ", …" : ""} changed the analysis: ${tool === "get_state" ? "get_state gives it as it is now" : "its values may have moved"}.`;
  return `[${tool}, an earlier result${ref ? ` (${ref})` : ""}, shortened to fit the model's window: ${values || "(no values)"}. ${since}${ref ? ` read_ref "${ref}" gives it whole.` : ""}]`;
}

const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Scalars by path, breadth first (the top level first), within about `max` characters. */
function keyValues(root: unknown, max: number): string {
  const parts: string[] = [];
  let used = 0;
  let level: { readonly path: string; readonly value: unknown }[] = [{ path: "", value: root }];
  while (level.length > 0) {
    const next: { path: string; value: unknown }[] = [];
    for (const { path, value } of level) {
      if (value === null || typeof value !== "object") {
        if (path === "ref" || path === "") continue;
        const shown = typeof value === "string" ? clip(value, 60) : typeof value === "number" ? String(Number(value.toPrecision(6))) : String(value);
        const part = `${path} ${shown}`;
        if (used + part.length > max) return [...parts, "…"].join(" · ");
        parts.push(part);
        used += part.length + 3;
      } else if (Array.isArray(value)) {
        if (value.length > 0 && value.every((v) => v === null || typeof v !== "object")) {
          next.push({ path, value: clip(value.map((v) => (typeof v === "number" ? Number(v.toPrecision(6)) : v)).join(", "), 80) });
        } else {
          next.push({ path: `${path}[]`, value: value.length });
          value.slice(0, 3).forEach((v, i) => {
            if (v !== null && typeof v === "object") next.push({ path: `${path}[${i}]`, value: v });
          });
        }
      } else {
        for (const [k, v] of Object.entries(value)) next.push({ path: path ? `${path}.${k}` : k, value: v });
      }
    }
    level = next;
  }
  return parts.join(" · ");
}
