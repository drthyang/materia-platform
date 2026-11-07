/**
 * The in-app Agent conversation: a model through the Anthropic SDK, from the
 * browser, with the Agent tools (tools.ts) run by the executor on the live
 * page. Four ways in, same loop:
 *
 *  - `api-key`: the user's own Anthropic API key, sent straight from this
 *    browser to the API (the SDK's `dangerouslyAllowBrowser`). The key stays in
 *    this browser's storage; it is never part of a project file or a report.
 *  - `proxy`: the dev server's /api/anthropic route (vite.config.ts) holds the
 *    key from ANTHROPIC_API_KEY, so it never reaches the page. Local only.
 *  - `ollama` / `lmstudio`: a local model on the user's Ollama or LM Studio
 *    server, which speaks the same Messages API (ollama.ts, lmstudio.ts). It
 *    gets only the fields it reads: no caching, effort, adaptive thinking or
 *    fallback, which are Claude's.
 *
 * The loop is a manual tool loop over a stream, so text shows as it arrives
 * and an approval card can hold a tool call as long as the user needs. The
 * history is append-only (thinking blocks stay valid) except where the system
 * prompt or the tools change, which unsigns the thinking before (thinkingBinding.ts),
 * and an interrupted turn still answers every tool call it made, so the
 * conversation can go on.
 *
 * This file is the loop. How a model is reached is chatTransport.ts, how much
 * a conversation may take (run policy, window, token meter) chatBudget.ts, and
 * the guards against circling, repeating and stalling chatGuards.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { LIVE_TOOLS, inputJsonSchema, liveTool, type LiveToolSpec } from "@/agent/tools";
import { scopeNote, scopedTools } from "@/agent/toolScope";
import { evidenceGate, gradeContradiction, type CallRecord } from "@/agent/evidence";
import type { AgentSituation, ToolOutcome, ToolRunner } from "@/agent/executor";
import { agentSystemPrompt, autonomyNote } from "@/agent/systemPrompt";
import { CONTEXT_EDITING, CONTEXT_EDITING_BETA, LOCAL_BATCH, historyChars, pruneForLocal, shortenedResults } from "@/agent/contextWindow";
import { hasRefusalFallback } from "@/agent/chat-models";
import { type OllamaPlan, ollamaWindow } from "@/agent/ollamaNative";
import { DEFAULT_OPENAI_CONTEXT, openaiWindow } from "@/agent/openaiCompat";
import { ensureLmStudioContext } from "@/agent/lmstudio";
import { MIN_AGENT_CONTEXT, contextAdvice } from "@/agent/localServer";
import { clientFor, isLocal, isSized, type Backend, type ChatConfig } from "@/agent/chatTransport";
import { ThinkingBinding, bindingKey, withoutSignedThinking } from "@/agent/thinkingBinding";
import { MIN_REPLY, REPLY_CAP, PromptMeter, REPLY_RESERVE, fitWindow, runPolicy, temperatureOf, type RunPolicy } from "@/agent/chatBudget";
import { claudeWindow, localReserve, promptTokens, rescaled, type ContextReading } from "@/agent/contextMeter";
import { FROM_APP, LoopGuard, MAX_GATES, MAX_NUDGES, REFUSED_HINT, RepeatWatch, stalledReply } from "@/agent/chatGuards";

export { NO_PROXY, PROXY_PATH, proxyStatus, type ProxyStatus } from "@/agent/proxyStatus";
export { describeChatError, type ChatConfig, type ChatEffort, type ChatTransport } from "@/agent/chatTransport";
export { CHARS_PER_TOKEN, MIN_REPLY, REPLY_RESERVE, fitWindow, runPolicy, type RunPolicy } from "@/agent/chatBudget";
export { LoopGuard, RepeatWatch, announcedTool, repeatingTail, stalledReply } from "@/agent/chatGuards";

export interface ChatCallbacks {
  /** A new assistant message begins (one per model turn). */
  readonly onAssistantStart: () => void;
  readonly onText: (delta: string) => void;
  /** Summarized reasoning, as it streams. */
  readonly onThinking: (delta: string) => void;
  readonly onNotice: (text: string, tone: "info" | "error") => void;
  /** A reply's token counts, and the model that wrote it (another one when a fallback answered). */
  readonly onUsage: (usage: BetaUsage, model?: string) => void;
  /** The model's message is complete, before its tool calls run: its words can be read against the page as it stands. */
  readonly onAssistantEnd?: () => void;
  /** How full the model's window is after a reply (contextMeter.ts); also after a summary, and when a request no longer fits. */
  readonly onContext?: (reading: ContextReading) => void;
}

/**
 * Summarize and continue (MODEL-VISIBLE): the request that asks the model for
 * a summary of the conversation, appended to the history as it stands.
 */
export const SUMMARY_REQUEST = `${FROM_APP} The user asked to summarize this conversation and continue: your summary will replace the conversation so far in your context. Write it now, without calling tools, in plain text of at most about 400 words: the user's goal and requests; what was done, with the key results and values as the tools reported them (with their refs); where the analysis stands now; open questions and the next step.`;
/** Summarize and continue (MODEL-VISIBLE): the message before the summary, once it has replaced the history. */
export const SUMMARY_CARRIER = `${FROM_APP} At the user's request, the conversation so far was replaced by your summary of it (your next message), to free room in your context. The page is as it was: get_state reads it, and read_ref opens an earlier result by its ref.`;

export class AgentChat {
  private readonly messages: BetaMessageParam[] = [];
  private backend: Backend | null = null;
  private readonly tools: BetaTool[] = LIVE_TOOLS.map((t) => toBetaTool(t));
  private readonly toolsWithoutSkills: BetaTool[] = LIVE_TOOLS.filter((t) => t.name !== "read_skill").map((t) => toBetaTool(t, false));
  /** Where the analysis stood after the last call (the page, the stage), for the tools a request offers. */
  private here: AgentSituation | null = null;
  /** Every tool called in this conversation: it stays offered. */
  private readonly called = new Set<string>();
  private readonly withSkills = agentSystemPrompt();
  private readonly noSkills = agentSystemPrompt({ skills: false });
  /**
   * A local model's window, in tokens, as the server runs it (null: unknown,
   * then the history keeps to a fixed budget). Each request is sized to it.
   */
  private window: number | null = null;
  /** The prompts measured against the server's counts (chatBudget.ts). */
  private readonly meter = new PromptMeter();
  /** Ollama: the longest context the model takes (null: unknown), and what the next request runs with. */
  private maxWindow: number | null = null;
  private ollamaPlan: OllamaPlan | null = null;
  /** The system prompt and tools the history's Claude thinking is signed under (thinkingBinding.ts). */
  private readonly binding = new ThinkingBinding();
  /** The last request's size in characters: its instructions and tools, and all of it (for a reading after a summary). */
  private lastFixedChars = 0;
  private lastChars = 0;
  /** A local request that did not fit: its reading, shown before the refusal. */
  private overflow: ContextReading | null = null;
  /** Never a silent cut: the older tool results the user was told are shortened (local) or left out by the API (Claude). */
  private shortenedNow = 0;
  private shortenedTold = 0;
  private clearedTold = 0;

  constructor(private readonly executor: ToolRunner) {}

  /**
   * The model a message goes to, and its window: the backend switch, and a
   * local server's context (LM Studio loads the model with room, Ollama runs
   * it at the context it asks for).
   */
  private async prepare(asked: ChatConfig, cb: ChatCallbacks, signal: AbortSignal): Promise<{ readonly config: ChatConfig; readonly client: Anthropic }> {
    // The mode is part of the system prompt Claude's thinking is signed under, so one message runs
    // under the mode it started with: a switch of Ask first / Auto reaches Claude at the next
    // message (the approval cards follow the switch at once), and a tool loop in flight keeps its
    // thinking. A local server signs nothing, so it still reads the mode at every turn.
    const config: ChatConfig = isSized(asked.transport) ? asked : { ...asked, autonomy: asked.autonomy ?? "ask" };
    const client = clientFor(config, () => this.ollamaPlan);
    const backend: Backend = isSized(config.transport) ? config.transport : "anthropic";
    if (this.backend !== null && this.backend !== backend) this.keepPortableBlocks();
    this.backend = backend;
    this.window = null;
    // Another model: its tokens are counted anew.
    this.meter.use(`${config.transport} ${config.model}`);
    if (config.transport === "lmstudio") {
      // A model LM Studio loads by itself gets its default context, often far
      // too short for the instructions: load it with room, or refuse. Its
      // context is the window each request must fit: a longer prompt is cut.
      const loaded = await ensureLmStudioContext(config.serverUrl ?? "", config.model, signal);
      if (loaded.notice) cb.onNotice(loaded.notice, "info");
      this.window = loaded.context;
      this.maxWindow = loaded.maxContext;
    }
    if (config.transport === "openai-compatible") {
      // The server's own context when it says (vLLM, llama.cpp, gateways), else the one the user set.
      const reported = await openaiWindow(config.serverUrl ?? "", config.apiKey, config.model, signal);
      this.window = reported ?? config.context ?? DEFAULT_OPENAI_CONTEXT;
    }
    if (config.transport === "ollama") {
      // Ollama runs a request at the context it asks for (num_ctx, through the
      // native API): the one the model is loaded with when it holds the Agent
      // (no reload), else the Agent's own, never past the model's maximum.
      const w = await ollamaWindow(config.serverUrl ?? "", config.model, signal);
      const want = Math.max(w.loaded ?? config.context ?? 0, MIN_AGENT_CONTEXT);
      this.maxWindow = w.max;
      this.window = w.max !== null ? Math.min(want, w.max) : want;
    }
    return { config, client };
  }

  /** One turn's request; a local request that cannot fit shows its reading before the refusal. */
  private requestOrOverflow(config: ChatConfig, cb: ChatCallbacks): BetaMessageStreamParams {
    this.overflow = null;
    try {
      return this.request(config);
    } catch (e) {
      if (this.overflow !== null) cb.onContext?.(this.overflow);
      throw e;
    }
  }

  /**
   * After a reply: how full the window is (the API's counts for Claude, the
   * app's estimate for a local model), and a word in the chat whenever the
   * history the model sees has been shortened further since it was last said.
   */
  private afterReply(config: ChatConfig, message: BetaMessage, cb: ChatCallbacks): void {
    const reading = this.readingFor(config, message.usage);
    if (reading !== null) cb.onContext?.(reading);
    if (isSized(config.transport)) {
      // Said when it starts, then again each batch of results further: a long session is not a notice a turn.
      if (this.shortenedNow > 0 && (this.shortenedTold === 0 ? true : this.shortenedNow >= this.shortenedTold + LOCAL_BATCH)) {
        cb.onNotice(`To fit the model's window, the app now sends ${this.shortenedNow} older tool result${this.shortenedNow === 1 ? "" : "s"} as short digests, and shortens the replies around them. The full results stay here, and the model can reopen one by its ref.`, "info");
        this.shortenedTold = this.shortenedNow;
      }
      return;
    }
    const cleared = (message.context_management?.applied_edits ?? []).reduce((sum, e) => sum + (e.type === "clear_tool_uses_20250919" ? e.cleared_tool_uses : 0), 0);
    if (cleared > this.clearedTold) {
      cb.onNotice(`To keep within the model's window, the API now leaves out ${cleared} older tool result${cleared === 1 ? "" : "s"} from what the model sees (method reads are kept). They stay here in the chat.`, "info");
      this.clearedTold = cleared;
    }
  }

  private readingFor(config: ChatConfig, usage: BetaUsage): ContextReading | null {
    if (isSized(config.transport)) {
      const sent = this.meter.sent;
      if (this.window === null || sent === null) return null;
      return { model: config.model, window: this.window, prompt: sent.estimate, reply: usage.output_tokens ?? 0, reserve: localReserve(this.window, sent.estimate, REPLY_RESERVE, MIN_REPLY), source: "app", serverCount: usage.input_tokens ?? null };
    }
    const window = claudeWindow(config.model);
    if (window === null) return null;
    return { model: config.model, window, prompt: promptTokens(usage), reply: usage.output_tokens ?? 0, reserve: REPLY_CAP, source: "provider" };
  }

  /** Send one user message and run the turns it leads to. */
  async send(text: string, asked: ChatConfig, cb: ChatCallbacks, signal: AbortSignal): Promise<void> {
    const { config, client } = await this.prepare(asked, cb, signal);
    this.messages.push({ role: "user", content: text });
    this.executor.heard?.(text);
    let parseRetries = 0;
    let nudges = 0;
    // Evidence rules sent back for this message (evidence.ts): each at most once, and apart from the stall nudges.
    const gated = new Set<string>();
    // This message's calls: each with what it came to and whether the fit on screen changed (the evidence gate reads them).
    const log: CallRecord[] = [];
    // The same call at the same state, or call after call that changes nothing (when the policy counts those): a loop.
    const policy = runPolicy(config, this.window);
    const guard = new LoopGuard({ countStill: policy.stallStop, method: config.skills !== false });
    this.here = await this.situation();
    let fingerprint = this.here?.fingerprint ?? null;
    const maxTurns = policy.turnCap;
    // Refinements the guards refused in a row: after a few, the model is told how to get out.
    let refusedInARow = 0;
    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal.aborted) return;
      // Sized before anything shows: a request that cannot fit is refused, not retried.
      const params = this.requestOrOverflow(config, cb);
      cb.onAssistantStart();
      let message: BetaMessage;
      const watch = { text: new RepeatWatch(), thinking: new RepeatWatch() };
      try {
        const stream = client.beta.messages.stream(params, { signal });
        stream.on("text", (delta) => {
          cb.onText(delta);
          if (watch.text.add(delta)) stream.abort();
        });
        stream.on("thinking", (delta) => {
          cb.onThinking(delta);
          if (watch.thinking.add(delta)) stream.abort();
        });
        message = await stream.finalMessage();
        parseRetries = 0;
      } catch (e) {
        if (signal.aborted) return;
        const looped = watch.text.unit ?? watch.thinking.unit;
        if (looped !== null) {
          // Stopped for repeating itself: keep the reply up to the first repeat,
          // so the history still alternates and the conversation can go on.
          this.messages.push({ role: "assistant", content: [{ type: "text", text: watch.text.kept() || "(stopped: the reply was repeating itself)" }] });
          cb.onNotice(
            `The model started repeating itself ("${looped.length > 60 ? looped.slice(0, 60) + "…" : looped}"), so this turn was stopped. ` +
              (isLocal(config.transport)
                ? "Local models do this when they lose track, often because the conversation no longer fits their context: try again, clear the conversation, or use a larger model or a longer context."
                : "Try rephrasing the request."),
            "error",
          );
          return;
        }
        if (e instanceof Anthropic.APIUserAbortError) return;
        // With streamed tool inputs, an input the SDK cannot parse at all fails
        // the stream; re-issue that turn (twice at most). API errors are final.
        if (!(e instanceof Anthropic.APIError) && parseRetries++ < 2) continue;
        throw e;
      }
      cb.onUsage(message.usage, message.model);
      this.messages.push({ role: "assistant", content: message.content });
      this.afterReply(config, message, cb);
      const cut = isSized(config.transport) ? this.meter.read(message.usage, this.window) : null;
      cb.onAssistantEnd?.();
      // Never a silent switch: say which model answered when a fallback did.
      for (const b of message.content) {
        if (b.type === "fallback") cb.onNotice(`${b.from.model} declined this turn; ${b.to.model} answered it.`, "info");
      }

      if (message.stop_reason === "refusal") {
        // A call the declined reply began is answered, so the conversation stays valid.
        const begun = message.content.filter((b: BetaContentBlock): b is BetaToolUseBlock => b.type === "tool_use");
        if (begun.length) this.messages.push({ role: "user", content: begun.map((c) => toolError(c.id, "Not run: the model declined to continue this request.")) });
        cb.onNotice("The model declined to continue this request.", "error");
        return;
      }
      if (message.stop_reason === "pause_turn") continue;
      const calls = message.content.filter((b: BetaContentBlock): b is BetaToolUseBlock => b.type === "tool_use");
      if (cut !== null) {
        // The server cut the prompt after all: this reply did not see all of it. Run nothing it asked for.
        if (calls.length) this.messages.push({ role: "user", content: calls.map((c) => toolError(c.id, "Not run: the server cut the prompt, so this call was made without all of the conversation.")) });
        cb.onNotice(cut, "error");
        return;
      }
      if (calls.length === 0) {
        // A reply that stalls (promises a call it does not make, waits for a
        // tool that already answered, or says nothing after a result) leaves
        // the user waiting on nothing. Ask the model to go on, twice at most.
        const said = message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
        const stall = nudges < MAX_NUDGES ? stalledReply(said, this.tools.map((t) => t.name), log.map((c) => c.name), config.skills !== false) : null;
        if (stall === null) {
          if (message.stop_reason === "model_context_window_exceeded") cb.onNotice("The model's window filled up, so this reply was cut off. Start fresh, or summarize the conversation and continue.", "error");
          if (message.stop_reason === "max_tokens" && this.window !== null) cb.onNotice("The reply filled the room left in the model's window and was cut off. Ask it to go on, or clear the conversation to give it more room.", "error");
          if (!said.trim() && log.length > 0) cb.onNotice(`The model gave no reply after the ${log.at(-1)!.name} result.${isLocal(config.transport) ? " Local models do this when the conversation no longer fits their context: clear the conversation, or use a longer context." : ""}`, "error");
          // An answer without the evidence its question needs goes back once, with what to run.
          const gate = gated.size < MAX_GATES ? this.finalAnswerCheck(said, text, log, gated) : null;
          if (gate === null) return;
          gated.add(gate.id);
          cb.onNotice(gate.notice, "info");
          this.messages.push({ role: "user", content: gate.nudge });
          continue;
        }
        nudges++;
        cb.onNotice(stall.notice, "info");
        this.messages.push({ role: "user", content: stall.nudge });
        continue;
      }
      if (message.stop_reason === "max_tokens") {
        // A tool input cut off mid-way is never run; answer the calls so the
        // history stays valid, and say why.
        this.messages.push({ role: "user", content: calls.map((c) => toolError(c.id, "The response hit the output limit before this tool input was complete; it was not run.")) });
        cb.onNotice("The reply hit the output limit; its tool calls were not run.", "error");
        return;
      }
      const results: BetaToolResultBlockParam[] = [];
      let circling: string | null = null;
      // A question put to the user (a tool that ends the turn, ask_user): the turn stops with it, as it does for circling.
      let asked = false;
      for (const call of calls) {
        if (signal.aborted) {
          results.push(toolError(call.id, "Stopped by the user before this ran."));
          continue;
        }
        if (circling !== null) {
          results.push(toolError(call.id, `${FROM_APP} Not run: the app stopped this turn because the conversation was going in circles.`));
          continue;
        }
        if (asked) {
          results.push(toolError(call.id, `${FROM_APP} Not run: your turn ended with the question to the user. Call it after their answer if it still applies.`));
          continue;
        }
        const endsTurn = liveTool(call.name)?.endsTurn === true;
        if (endsTurn && gated.size < MAX_GATES) {
          // The turn ends with this question, so it is read as a final answer is: the reply and the question's words.
          const said = [...message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text), questionWords(call.input)].join("\n");
          const gate = this.finalAnswerCheck(said, text, log, gated);
          if (gate !== null) {
            gated.add(gate.id);
            cb.onNotice(gate.notice, "info");
            results.push(toolError(call.id, `${gate.nudge} (The question was not shown.)`));
            continue;
          }
        }
        const refused = guard.check(call.name, call.input, fingerprint);
        if (refused !== null) {
          circling = refused.why;
          results.push(toolError(call.id, refused.nudge));
          continue;
        }
        this.called.add(call.name);
        let out: ToolOutcome;
        try {
          out = await this.executor.run(call.name, call.input, signal);
        } catch (e) {
          // Never a call left without its answer: the conversation must stay valid.
          out = { isError: true, text: `Error: the tool failed to run: ${e instanceof Error ? e.message : String(e)}`, status: "error" };
        }
        log.push({ name: call.name, status: out.status ?? (out.isError ? "error" : "ok"), fitChanged: out.fitChanged === true });
        if (endsTurn && !out.isError) asked = true;
        this.here = await this.situation();
        const after = this.here?.fingerprint ?? null;
        const seen = guard.record(call.name, call.input, out.text, fingerprint, after);
        fingerprint = after;
        if (seen.stop !== null) circling = seen.stop;
        let note = seen.note;
        if (call.name === "refine") {
          // A refinement a firm rule, the correlation guard or a changed page held back (a runner that does not say: its text).
          const held = out.status !== undefined ? out.status === "refused" && (out.refusedBy === "firm-rule" || out.refusedBy === "correlation" || out.refusedBy === "stale") : out.isError && /Not refined|refused|not run/i.test(out.text);
          refusedInARow = held ? refusedInARow + 1 : 0;
          if (refusedInARow === REFUSED_HINT && note === null) note = `${FROM_APP} ${REFUSED_HINT} refinements in a row were refused. Go back to the last free set that refined (fix what you freed since), then free one group more at a time and refine after each; hold one of each pair the refusal names. Instrument terms and B values refine in turn, never together.`;
        }
        const answer = note === null ? out.text : `${out.text}\n\n${note}`;
        results.push({ type: "tool_result", tool_use_id: call.id, content: answer, ...(out.isError ? { is_error: true } : {}) });
      }
      // Every tool call is answered in ONE user message, even when stopped.
      this.messages.push({ role: "user", content: results });
      if (signal.aborted) return;
      // The question is the user's now: their answer is their next message.
      if (asked) return;
      if (circling !== null) {
        // Never a silent stop: say where the analysis stands and what the Agent needs.
        const where = (await this.situation())?.summary;
        cb.onNotice(
          `The Copilot was going in circles: ${circling}, so the app stopped it here.${where ? ` Where it stands: ${where}` : ""} ` +
            `Tell it the next step to take (for example "free the atomic positions and refine"), or start a new conversation if it has lost track.`,
          "error",
        );
        return;
      }
    }
    cb.onNotice(`Stopped after ${maxTurns} model turns for one message. Say "continue" to go on.`, "info");
  }

  /**
   * Summarize and continue (MODEL-VISIBLE): one request asks the model for a
   * summary of the conversation (SUMMARY_REQUEST, after the history as it
   * stands, on the same instructions and tools, so Claude's cached prompt
   * holds); the summary then replaces the history the model sees: the app's
   * note (SUMMARY_CARRIER) and the model's own summary. Nothing it asks to run
   * is run. Any failure leaves the history as it was. Returns whether it did.
   */
  async summarize(asked: ChatConfig, cb: ChatCallbacks, signal: AbortSignal): Promise<boolean> {
    if (!this.messages.some((m) => m.role === "assistant")) {
      cb.onNotice("Nothing to summarize yet.", "info");
      return false;
    }
    const { config, client } = await this.prepare(asked, cb, signal);
    this.here = await this.situation();
    // The ask after the history: a message of its own, or with the tool results a stopped turn ended on.
    const last = this.messages.length - 1;
    const ended = this.messages[last]!;
    if (ended.role === "user") {
      const blocks: BetaContentBlockParam[] = typeof ended.content === "string" ? [{ type: "text", text: ended.content }] : [...ended.content];
      this.messages[last] = { role: "user", content: [...blocks, { type: "text", text: SUMMARY_REQUEST }] };
    } else {
      this.messages.push({ role: "user", content: SUMMARY_REQUEST });
    }
    let params: BetaMessageStreamParams;
    try {
      const built = this.requestOrOverflow(config, cb);
      params = { ...built, messages: [...built.messages] };
    } finally {
      // The history is the conversation's again, whatever the request did (thinking it left out stays out).
      if (ended.role === "user") this.messages[last] = ended;
      else this.messages.pop();
    }
    cb.onAssistantStart();
    let message: BetaMessage;
    try {
      const stream = client.beta.messages.stream(params, { signal });
      stream.on("text", (delta) => cb.onText(delta));
      stream.on("thinking", (delta) => cb.onThinking(delta));
      message = await stream.finalMessage();
    } catch (e) {
      if (signal.aborted || e instanceof Anthropic.APIUserAbortError) return false;
      throw e;
    }
    cb.onUsage(message.usage, message.model);
    const cut = isSized(config.transport) ? this.meter.read(message.usage, this.window) : null;
    const summary = message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
    const unchanged = "The conversation is unchanged.";
    if (cut !== null) {
      cb.onNotice(`${cut} ${unchanged}`, "error");
      return false;
    }
    if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded" || !summary) {
      cb.onNotice(`${message.stop_reason === "refusal" ? "The model declined to summarize." : summary ? "The summary was cut off before it ended." : "The model wrote no summary."} ${unchanged} Try again, or start fresh.`, "error");
      return false;
    }
    const before = this.readingFor(config, message.usage);
    const charsBefore = this.lastChars;
    this.messages.splice(0, this.messages.length, { role: "user", content: SUMMARY_CARRIER }, { role: "assistant", content: [{ type: "text", text: summary }] });
    this.shortenedNow = 0;
    this.shortenedTold = 0;
    this.clearedTold = 0;
    if (before !== null) cb.onContext?.(rescaled(before, charsBefore, this.lastFixedChars + historyChars(this.messages)));
    cb.onNotice("Summarized: from here the model works from the summary above, in place of the earlier conversation, which stays here for you to read.", "info");
    return true;
  }

  /**
   * A final answer the app sends back: a conclusion whose check did not run
   * for this message, or a grade of the fit that contradicts the engine's
   * verdict. Null for an answer that stands.
   */
  private finalAnswerCheck(reply: string, asked: string, log: readonly CallRecord[], gated: ReadonlySet<string>): { id: string; notice: string; nudge: string } | null {
    const rule = evidenceGate(reply, asked, log, this.page(), gated);
    if (rule) return { id: rule.id, notice: rule.notice, nudge: rule.nudge };
    if (gated.has("verdict") || !this.executor.fill) return null;
    const band = this.executor.fill("{{verdict}}");
    const contradiction = band.includes("{{") ? null : gradeContradiction(reply, band);
    if (contradiction === null) return null;
    return {
      id: "verdict",
      notice: `The answer ${contradiction}; the app asked the model to quote the engine's verdict.`,
      nudge: `${FROM_APP} Your answer ${contradiction}. The verdict is the engine's, not yours: quote it as {{verdict}} and explain what it rests on.`,
    };
  }

  /** One turn's request: everything Claude reads, or only what a local server does. */
  private request(config: ChatConfig): BetaMessageStreamParams {
    if (isSized(config.transport)) {
      // A thinking-capable model thinks by default, and the servers reuse the
      // cached prompt prefix by themselves.
      const scoped = this.offered(config);
      const system = `${this.systemFor(config)}\n\n${autonomyNote(config.autonomy ?? "ask", { skills: config.skills !== false })}${scoped ? `\n\n${scopeNote(config.skills !== false)}` : ""}`;
      let tools = scoped ?? this.allTools(config);
      if (this.window === null) {
        // The window unknown: old tool results go from the copy it gets past a fixed budget.
        this.meter.sent = null;
        const pruned = pruneForLocal(this.messages);
        this.shortenedNow = Math.max(this.shortenedNow, shortenedResults(this.messages, pruned));
        return { model: config.model, max_tokens: REPLY_CAP, system, tools, messages: pruned, ...temperatureOf(config) };
      }
      let fixed = system.length + JSON.stringify(tools).length;
      const cap = runPolicy(config, this.window).replyCap;
      let fit = fitWindow(this.messages, fixed, this.window, this.meter.charsPerToken, cap);
      if (fit.refusal !== null && scoped) {
        // Every tool used stays offered, and a long session gathers many: when nothing else fits, the stage's tools only.
        const lean = this.offered(config, true)!;
        const leanFit = fitWindow(this.messages, system.length + JSON.stringify(lean).length, this.window, this.meter.charsPerToken, cap);
        if (leanFit.refusal === null || leanFit.estimate < fit.estimate) {
          tools = lean;
          fixed = system.length + JSON.stringify(lean).length;
          fit = leanFit;
        }
      }
      if (fit.refusal !== null && config.transport === "ollama" && this.maxWindow !== null && this.window < this.maxWindow) {
        // Ollama can run the model with more: the smallest step of 8k that holds it (one reload), up to its maximum.
        const grown = Math.min(this.maxWindow, Math.ceil((fit.estimate + REPLY_RESERVE) / 8192) * 8192);
        const wider = fitWindow(this.messages, fixed, grown, this.meter.charsPerToken, cap);
        if (wider.refusal === null) this.window = grown;
        fit = wider;
      }
      if (fit.refusal !== null) {
        this.overflow = { model: config.model, window: this.window, prompt: fit.estimate, reply: 0, reserve: MIN_REPLY, source: "app", overflow: true };
        // What the model could run with instead (LM Studio: a reload; Ollama: past its maximum, nothing).
        const advice = isLocal(config.transport)
          ? contextAdvice({ server: config.transport === "lmstudio" ? "LM Studio" : "Ollama", model: config.model, needed: fit.estimate + REPLY_RESERVE, current: this.window, max: this.maxWindow }).text
          : undefined;
        throw new Error(fit.refusal(config, advice));
      }
      this.meter.sent = { chars: fit.chars, sentChars: fit.sentChars, estimate: fit.estimate };
      this.lastFixedChars = fixed;
      this.lastChars = fit.chars;
      this.shortenedNow = Math.max(this.shortenedNow, shortenedResults(this.messages, fit.messages));
      // fit was sized to this.window (grown when it had to be).
      this.ollamaPlan = config.transport === "ollama" ? { numCtx: this.window, numPredict: fit.maxTokens } : null;
      return { model: config.model, max_tokens: fit.maxTokens, system, tools, messages: fit.messages, ...temperatureOf(config) };
    }
    // The mode follows the cached prompt, so switching it keeps the cache.
    const system: BetaTextBlockParam[] = [{ type: "text", text: this.systemFor(config), cache_control: { type: "ephemeral" } }, { type: "text", text: `${autonomyNote(config.autonomy ?? "ask", { skills: config.skills !== false })}${this.offered(config) ? `\n\n${scopeNote(config.skills !== false)}` : ""}` }];
    // Inputs stream as generated; the executor validates each against its schema.
    const tools = (this.offered(config) ?? this.allTools(config)).map((t) => ({ ...t, eager_input_streaming: true }));
    // Thinking written under another system prompt or tool list is refused by the API (thinkingBinding.ts).
    if (this.binding.moves(bindingKey(system, tools))) this.dropThinking();
    this.lastFixedChars = JSON.stringify(system).length + JSON.stringify(tools).length;
    this.lastChars = this.lastFixedChars + historyChars(this.messages);
    return {
      model: config.model,
      max_tokens: REPLY_CAP,
      system,
      tools,
      messages: this.messages,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: config.effort },
      // Caches the conversation so far on every turn, after the system prompt.
      cache_control: { type: "ephemeral" },
      // Old tool results leave the window once it fills (contextWindow.ts).
      context_management: CONTEXT_EDITING,
      betas: [CONTEXT_EDITING_BETA, ...(config.fallback && hasRefusalFallback(config.model) ? ["server-side-fallback-2026-07-01"] : [])],
      ...(config.fallback && hasRefusalFallback(config.model) ? { fallbacks: "default" as const } : {}),
    };
  }

  /**
   * The conversation moves to another backend: earlier replies keep only
   * their text and tool calls. The API rejects a local model's unsigned
   * thinking, and Claude's own blocks (signed thinking, fallback) mean nothing
   * to a local server.
   * Safe between messages: no tool loop is in flight.
   */
  private keepPortableBlocks(): void {
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i]!;
      if (m.role !== "assistant" || typeof m.content === "string") continue;
      const kept = m.content.filter((b) => b.type === "text" || b.type === "tool_use");
      this.messages[i] = { role: "assistant", content: kept.length ? kept : [{ type: "text", text: "(no reply)" }] };
    }
    this.binding.forget();
  }

  /**
   * The system prompt or the tools changed since Claude wrote the thinking in
   * the history, which is bound to them: it is left out of every earlier reply,
   * for good (their text and tool calls stay). Between messages the usual
   * cause is the mode; within one, only a tool offer that moves, which strips
   * the reply in flight too, as the API's own recovery does.
   */
  private dropThinking(): void {
    withoutSignedThinking(this.messages).forEach((m, i) => {
      this.messages[i] = m;
    });
  }

  /** The policy the conversation runs under now (its window as the last message found it): for a run's record. */
  policyFor(config: ChatConfig): RunPolicy {
    return runPolicy(config, this.window);
  }

  /** Messages so far (for tests). */
  history(): readonly BetaMessageParam[] {
    return this.messages;
  }

  private systemFor(config: ChatConfig): string {
    return config.skills === false ? this.noSkills : this.withSkills;
  }

  /** Every tool, as the model is offered it: without the skills (the validation's ablation arm), no read_skill, and each description in its form without them. */
  private allTools(config: ChatConfig): BetaTool[] {
    return config.skills === false ? this.toolsWithoutSkills : this.tools;
  }

  /**
   * The tools this request offers when they are scoped (null: every tool):
   * a local model's default, and only when the runner says where the
   * analysis stands.
   */
  private offered(config: ChatConfig, lean = false): BetaTool[] | null {
    // A local model's window is small; an OpenAI-compatible one's may be either: all the tools only when it is large.
    if (runPolicy(config, this.window).toolScope === "all" || this.here === null) return null;
    // Lean: the page's and the stage's tools only, for a prompt that otherwise cannot fit.
    const asked = lean ? [] : this.messages.filter((m) => m.role === "user" && typeof m.content === "string" && !m.content.startsWith(FROM_APP)).map((m) => m.content as string);
    const skills = config.skills !== false;
    return scopedTools({ page: this.here.page, stage: this.here.stage, magnetic: this.here.magnetic, asked, called: lean ? new Set<string>() : this.called, method: skills })
      .filter((t) => skills || t.name !== "read_skill")
      .map((t) => toBetaTool(t, skills));
  }

  /** The page open, as the runner says (the evidence rules are per page). */
  private page(): "powder" | "pdf" | "singleCrystal" | null {
    try {
      return this.executor.page?.() ?? this.here?.page ?? null;
    } catch {
      return null;
    }
  }

  /** Where the analysis stands, when the runner can say (a failure to read it is no reason to stop a turn). */
  private async situation(): Promise<AgentSituation | null> {
    try {
      return (await this.executor.situation?.()) ?? null;
    } catch {
      return null;
    }
  }
}

function toBetaTool(t: LiveToolSpec, skills = true): BetaTool {
  return { name: t.name, description: skills ? t.description : t.withoutSkills ?? t.description, input_schema: inputJsonSchema(t) as BetaTool["input_schema"] };
}

/** A question's words as the user sees them (ask_user's question and options), for the checks on a final answer. */
function questionWords(input: unknown): string {
  const q = (typeof input === "object" && input !== null ? input : {}) as { question?: unknown; options?: unknown };
  const options = Array.isArray(q.options) ? q.options.flatMap((o) => (typeof o === "object" && o !== null ? [(o as { label?: unknown }).label, (o as { message?: unknown }).message] : [])) : [];
  return [q.question, ...options].filter((w): w is string => typeof w === "string").join("\n");
}

function toolError(id: string, text: string): BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: id, content: text, is_error: true };
}
