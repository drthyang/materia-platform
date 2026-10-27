/**
 * Claude's thinking is signed to the conversation that wrote it. Each block's
 * signature records the top-level `system` prompt, the `tools` and every
 * message before it, and the API checks them when the block comes back: a
 * request that replays a block after any of those changed is a 400 ("Invalid
 * `signature` in `thinking` block. The block is bound to a different
 * conversation"). Messages are append-only here, so the two that can move
 * between requests are the system prompt (the Ask first / Auto line is part
 * of it) and the tool list (the skills switch, a scoped tool offer).
 *
 * The prompt's words do not change for this (the validation freezes them), so
 * when the system prompt or the tools differ from those the history's
 * thinking was written under, that thinking goes: the API's own no-beta
 * recovery, "strip every `thinking` and `redacted_thinking` block, keep the
 * text and the tool calls". The model answers that turn without the reasoning
 * those blocks carried, and the thinking written from then on is signed under
 * the new prompt. The other recovery, `thinking.block_binding`
 * `prefix_mismatch_behavior: "drop_block"`, needs the dated beta header
 * `thinking-binding-controls-2026-08-01`, which a gateway behind `baseURL` may
 * refuse, and is meant as a stopgap; and moving the mode to a mid-conversation
 * `role: "system"` message would change the prompt the model reads.
 *
 * The strip is for good, not per request: a block put back after it was
 * removed would invalidate the thinking written while it was gone. It is also
 * only for a change of system or tools. Another model reading the blocks
 * (a model switch, a fallback) is the API's call, which drops what the model
 * cannot read, so those blocks are never stripped for it; and a local server's
 * unsigned thinking is dropped when the conversation moves to Claude
 * (AgentChat.keepPortableBlocks).
 */

import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

/** A short digest of the two things besides the messages that a signature is bound to: the system blocks' text and the tools' definitions. */
export function bindingKey(system: readonly { readonly text: string }[], tools: readonly { readonly name: string; readonly description?: string | undefined; readonly input_schema: unknown }[]): string {
  // cyrb53: 53 bits of a string, enough to tell two prompts apart.
  const s = JSON.stringify([system.map((b) => b.text), tools.map((t) => [t.name, t.description ?? "", t.input_schema])]);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** The history with Claude's thinking left out of every assistant turn: its text, tool calls and any other block stay. */
export function withoutSignedThinking(messages: readonly BetaMessageParam[]): BetaMessageParam[] {
  const isThinking = (b: { readonly type: string }): boolean => b.type === "thinking" || b.type === "redacted_thinking";
  return messages.map((m) => {
    if (m.role !== "assistant" || typeof m.content === "string" || !m.content.some(isThinking)) return m;
    const kept = m.content.filter((b) => !isThinking(b));
    // A turn that was only thinking still has to say something: the API refuses an empty message.
    return { ...m, content: kept.length ? kept : [{ type: "text", text: "(no reply)" }] };
  });
}

/**
 * What the thinking in a conversation's history is signed under. All of it
 * is signed under one prefix: when the prefix moves, the history's thinking is
 * dropped (withoutSignedThinking) and what the model writes next is signed
 * under the new one.
 */
export class ThinkingBinding {
  private signedUnder: string | null = null;

  /** The request about to go out has this key: true when thinking already in the history was signed under another, and must go first. */
  moves(key: string): boolean {
    const moved = this.signedUnder !== null && this.signedUnder !== key;
    this.signedUnder = key;
    return moved;
  }

  /** The history holds no signed thinking (it was all removed), so nothing is bound to a prefix yet. */
  forget(): void {
    this.signedUnder = null;
  }
}
