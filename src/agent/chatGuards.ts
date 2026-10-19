/**
 * The conversation's guards: against a model going in circles (the same call
 * at the same state, call after call that changes nothing), a streamed reply
 * repeating itself, and a reply that stalls (promises a call it does not make,
 * waits for a tool that already answered, or says nothing after a result).
 * What the app tells the model is marked as the app's, not the user's.
 */

import { liveTool } from "@/agent/tools";

/** Refused refinements in a row before the model is told how to get out. */
export const REFUSED_HINT = 3;

/** Most times one user message may ask a stalled model to go on. */
export const MAX_NUDGES = 2;
/** Most times one user message's final answer may be sent back for its evidence or its verdict. */
export const MAX_GATES = 2;
export const FROM_APP = "(From the app, not the user.)";

/** A call made again at the same state, its result unchanged: noted once, and the third time the turn stops. */
const MAX_SAME_CALL = 3;
/** Repeated calls of any kind in one message before the turn stops. */
const MAX_REPEATS = 4;
/** Calls in a row that change nothing: the model is told at the first count, and the turn stops at the second. */
const STILL_NOTE = 12;
const STILL_STOP = 20;

const callKey = (name: string, input: unknown): string => `${name} ${stableJson(input ?? {})}`;
/** A result as compared between calls: without its ref, which numbers every result anew. */
const sameText = (text: string): string => text.replace(/"ref":"#\d+",?/g, "");

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/**
 * The chat's guard against a model going in circles (local models lose track
 * and call the same tool again and again). Per user message it remembers each
 * call (tool and input), the state it was made at (the runner's fingerprint)
 * and what it answered:
 *
 *  - the same call at the same state with the same answer is a repeat: its
 *    result carries a note from the app saying so;
 *  - a third such call at the same state is not run, and the turn stops; so
 *    does a fourth repeat of any kind, or STILL_STOP calls in a row that
 *    changed nothing (the model is told at STILL_NOTE).
 *
 * Without a fingerprint (a runner that cannot say), a repeat is the same call
 * with the same answer, and nothing is refused before it runs.
 */
export class LoopGuard {
  private readonly seen = new Map<string, { readonly at: string | null; readonly text: string; readonly count: number }>();
  private repeats = 0;
  private still = 0;
  private toldStill = false;

  /** `method`: a page's written method is in play (false without the skills, the validation's arm C: the notes then name none). */
  constructor(private readonly opts: { readonly countStill?: boolean; readonly method?: boolean } = {}) {}

  /** Before a call: why it must not run (it already ran twice at this very state), or null. */
  check(name: string, input: unknown, at: string | null): { readonly why: string; readonly nudge: string } | null {
    const prev = this.seen.get(callKey(name, input));
    if (at === null || prev === undefined || prev.at !== at || prev.count < MAX_SAME_CALL - 1) return null;
    return {
      why: `it called ${name} ${MAX_SAME_CALL} times with the same input, and nothing changed in between`,
      nudge: `${FROM_APP} Not run: ${name} already ran ${prev.count} times with this input, and nothing has changed since. The app stopped this turn; the user will tell you how to go on.`,
    };
  }

  /** After a call: a note for the model (a repeat, or calls that change nothing), and why the turn must stop, if it must. */
  record(name: string, input: unknown, text: string, before: string | null, after: string | null): { readonly note: string | null; readonly stop: string | null } {
    const key = callKey(name, input);
    const prev = this.seen.get(key);
    const answer = sameText(text);
    // The same answer at the same state; for a sampler (a new draw each time) the same state is enough.
    const tool = liveTool(name);
    const repeat = prev !== undefined && (before === null ? prev.text === answer : prev.at === before && (prev.text === answer || !!tool?.sampler));
    const count = repeat ? prev.count + 1 : 1;
    this.seen.set(key, { at: before, text: answer, count });
    // Only reads count toward a stall: a change attempt, a note or a report (a record) is work even when the fit
    // stays as it was (a boxcar scan, a refused refinement), and reading a ref or a skill reads what is there (stallNeutral).
    const changed = before !== null && after !== before;
    if (changed) this.still = 0;
    else if (tool && !tool.stallNeutral && (tool.effect === "read" || tool.effect === "compute")) this.still = this.opts.countStill !== false && before !== null ? this.still + 1 : 0;
    if (repeat) {
      this.repeats++;
      if (count >= MAX_SAME_CALL) return { note: null, stop: `it called ${name} ${count} times with the same input, and nothing changed in between` };
      if (this.repeats >= MAX_REPEATS) return { note: null, stop: `it repeated calls it had already made ${this.repeats} times, with nothing changed in between` };
      return {
        note: `${FROM_APP} You already made this call (${name}, the same input) and nothing has changed since: this is the same result as before.${name === "read_skill" ? " The skill is already in this conversation." : ""} Do not call it again. Take the next step${this.opts.method === false ? "" : " of the method"} with what you have, or stop and tell the user what you need.`,
        stop: null,
      };
    }
    if (this.still >= STILL_STOP) return { note: null, stop: `it made ${this.still} tool calls in a row without changing the analysis` };
    if (this.still >= STILL_NOTE && !this.toldStill) {
      this.toldStill = true;
      return { note: `${FROM_APP} ${this.still} tool calls in a row have not changed the analysis. Make the change ${this.opts.method === false ? "the analysis needs" : "the method calls for"} next, write the report if the work is done, or stop and ask the user.`, stop: null };
    }
    return { note: null, stop: null };
  }
}

/**
 * A reply with no tool call that leaves the user waiting on nothing, and what
 * the app tells the model about it; null for an ordinary final reply. `ran`
 * holds the tools that already ran for this message, in order.
 */
export function stalledReply(text: string, tools: readonly string[], ran: readonly string[], method = true): { notice: string; nudge: string } | null {
  const last = ran.at(-1);
  if (!text.trim()) {
    if (last === undefined) return null;
    return {
      notice: `The model said nothing after the ${last} result; the app asked it to go on.`,
      nudge: `${FROM_APP} You replied with nothing after the ${last} result above. Say what it shows and take the next step${method ? " your method calls for" : ""}, or stop for the user and say why.`,
    };
  }
  // "I was waiting for the check_cell_symmetry tool to complete" — about a
  // tool, not about the user ("I'll wait for your go-ahead" is a real stop).
  const waiting = ran.length === 0 ? undefined : text.split(/(?<=[.!?])\s+/).find(
    (st) => /\bwait(s|ing|ed)?\b/i.test(st) && !/\byou(r|rs)?\b/i.test(st) && (ran.some((n) => st.includes(n)) || /\b(tool|result|finish|complete|analysis)\b/i.test(st)),
  );
  const waitedOn = waiting === undefined ? null : [...ran].reverse().find((n) => waiting.includes(n)) ?? last!;
  if (waitedOn !== null) {
    return {
      notice: `The model said it was waiting for ${waitedOn}, which had already finished; the app pointed it to the result.`,
      nudge: `${FROM_APP} ${waitedOn} already finished; its result is the tool result above. Nothing is running. Read it, say what it shows, and go on.`,
    };
  }
  const tool = announcedTool(text, tools);
  if (tool === null) return null;
  return {
    notice: `The reply said it would run ${tool} but made no tool call, so nothing ran; the app asked it to go on.`,
    nudge: `${FROM_APP} Your last reply said you would act now, but it made no tool call, so nothing ran. If you meant to act, make the call now. If you meant to stop for the user, say so in one line.`,
  };
}

/**
 * The tool a reply announces it is about to run without calling it, or null.
 * Its last paragraph speaks of acting now ("Starting the Le Bail gate now.",
 * "I'll call refine()"), the reply names a tool, and it neither asks the user
 * nor says it is stopping — a gate where the method waits for the user is not
 * nudged.
 */
export function announcedTool(text: string, tools: readonly string[]): string | null {
  const t = text.trim();
  if (!t || /\?\s*$/.test(t)) return null;
  const last = t.split(/\n\s*\n/).filter((p) => p.trim()).at(-1)!.trim();
  if (/\b(shall|should|may) I\b|\bwould you\b|\bdo you want\b|\blet me know\b|\bif you (want|agree|approve|prefer)\b|\byour (go-ahead|approval|call|decision)\b|\b(stop|stopping|pause|wait|waiting|hold) (here|for)\b/i.test(last)) return null;
  // An action the reply takes now, in the first person ("I'll refine", "Starting the gate now."):
  // "for now" is a stop, and "next" without a person is a summary of what is left.
  const firstPerson = /\b(I|I'll|I will|I'm|I am|let me|let's|we'll|we will)\b/i.test(last);
  const acting = /^(starting|running|calling|proceeding|launching|beginning)\b/i.test(last)
    || /\b(I'll|I will|I'm going to|I am going to|let me|let's) (now )?(call|run|start|refine|free|fix|check|set|assess|use)\b/i.test(last)
    || (/\b(now|next)\s*[.!]?$/i.test(last) && !/\bfor now\s*[.!]?$/i.test(last) && firstPerson);
  if (!acting) return null;
  // The tool named closest to the end, as a word ("refine" is not in "refinement"), else "refine" when the reply speaks of refining.
  let best: string | null = null;
  let at = -1;
  for (const name of tools) {
    for (const m of t.matchAll(new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "g"))) {
      if (m.index > at) {
        at = m.index;
        best = name;
      }
    }
  }
  return best ?? (/\brefin(e|ing)\b/i.test(t) ? "refine" : null);
}

/**
 * Watches a streamed reply for a degenerate loop: the same phrase (8 to 400
 * characters, with a letter in it) at least six times in a row at its end,
 * whitespace aside. Checked every couple of hundred characters, so a loop is
 * caught within a few repeats.
 */
export class RepeatWatch {
  private raw = "";
  private checkedAt = 0;
  /** The repeating phrase, once found. */
  unit: string | null = null;

  /** Add a delta; true when the reply has just been found looping. */
  add(delta: string): boolean {
    if (this.unit !== null) return false;
    this.raw += delta;
    if (this.raw.length - this.checkedAt < 200) return false;
    this.checkedAt = this.raw.length;
    this.unit = repeatingTail(this.raw);
    return this.unit !== null;
  }

  /** The reply up to the end of the phrase's first occurrence. */
  kept(): string {
    const flat = this.raw.replace(/\s+/g, " ").trim();
    if (this.unit === null) return flat;
    const at = flat.indexOf(this.unit);
    return at < 0 ? flat : flat.slice(0, at + this.unit.length).trim();
  }
}

/** The phrase `text` ends by repeating at least `run` times in a row, or null. */
export function repeatingTail(text: string, run = 6, minUnit = 8, maxUnit = 400): string | null {
  const flat = text.replace(/\s+/g, " ").trimEnd() + " ";
  for (let len = minUnit; len <= maxUnit && len * run <= flat.length; len++) {
    const unit = flat.slice(-len);
    let k = 2;
    while (k <= run && flat.slice(-len * k, -len * (k - 1)) === unit) k++;
    if (k > run && /\p{L}/u.test(unit)) return unit.trim();
  }
  return null;
}
