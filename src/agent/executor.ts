/**
 * Runs the in-app chat's Agent tool calls against the live page: validate the
 * input, ask the user before a change, make the change as the agent so the history tags its
 * step, wait for it to render, and answer with a compact JSON view.
 *
 * Results travel like the MATERIA MCP server's: a bulky part becomes a ref
 * ("#3/findings") the model can open with `read_ref`, so one answer never
 * floods the conversation.
 *
 * This file is the dispatch: a call routed to its handler, a change gated,
 * asked, made and answered. What holds a call back is the policy
 * (executorPolicy.ts); what a call leaves in the record, get_state's view of
 * it, the report and the answers kept by ref are the record (executorRecord.ts).
 */

import { siteSumRangeWarnings } from "@/core/workflow/structureRefinement";
import { z } from "zod";
import { PAGE_LABEL, liveTool, type AgentPage, type LiveToolSpec, type ToolEffect } from "@/agent/tools";
import type { AgentPort } from "@/agent/port";
import type { MagneticPanelState } from "@/agent/magneticPort";
import { samplePosteriorTool } from "@/agent/posteriorTool";
import { freeSummary, type AgentReport } from "@/agent/report";
import { pct, type LiveToolHost } from "@/agent/liveCommon";
import { fillReferences, referenceCatalog, type ReferenceSource } from "@/agent/references";
import { readSkill } from "@/agent/skills";
import { RULES, advanceAlternation, alternationView, methodProgress, stagesCovered, type Alternation, type MethodRule } from "@/agent/method";
import { analysisOf, hashText, onPage, type PageAdapter, type StateOf } from "@/agent/pages";
import type { StepKind } from "@/core/project/history";
import { Refusal, correlationGate, developedCorrelations, firmRules, methodGate, staleReason, symmetryNotYet, type RefusalKind } from "@/agent/executorPolicy";
import { Answers, addNote, noteRead, recordView, syncStages, withoutMethod, writeReport, type SampledPosterior } from "@/agent/executorRecord";
import { choicesFor, questionChoices, type ChoiceContext, type ChoiceSet } from "@/agent/choices";

export type { RefusalKind } from "@/agent/executorPolicy";

/** What the executor needs from the app shell. */
export interface AgentHost extends LiveToolHost {
  /** The active engine's port; null with nothing loaded. */
  readonly port: () => AgentPort | null;
  /** Resolves once the state an action set has rendered and any step it requested is recorded. */
  readonly settle: () => Promise<void>;
  /** Run `fn` with every history step it records tagged as the agent's. */
  readonly asAgent: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Record the live state as a step now (a no-op when nothing changed). */
  readonly recordNow: (kind: StepKind, label?: string) => void;
}

export type ActivityStatus = "waiting" | "running" | "done" | "declined" | "failed";

/** One tool call as the Agent drawer lists it. */
export interface ActivityEntry {
  readonly id: string;
  readonly tool: string;
  readonly title: string;
  readonly effect: ToolEffect;
  /** What a change will do, in the page's terms (the approval card's line). */
  readonly preview?: string;
  readonly at: number;
  readonly status: ActivityStatus;
  /** A short outcome line once it finished. */
  readonly outcome?: string;
  /** Only the user may approve it: asked even in Auto. */
  readonly alwaysAsk?: boolean;
  /** The decision a read's result hands the user (the k-search's k, the ranked groups, the next steps), as options to click (choices.ts). */
  readonly choices?: ChoiceSet;
}

/**
 * What a call came to, for the code that runs the conversation (the chat
 * loop, the context pruning, the eval harness) to read instead of the text:
 * done, an error, refused by a rule or guard, declined by the user, a change
 * that changed nothing, or stopped before it ran.
 */
export type ToolStatus = "ok" | "error" | "refused" | "declined" | "unchanged" | "stopped";

/** The answer a model gets: JSON text, flagged when it is an error. */
export interface ToolOutcome {
  readonly isError: boolean;
  /** What the model reads. */
  readonly text: string;
  /** What happened (absent from a runner that does not say: read isError). */
  readonly status?: ToolStatus;
  /** A refused call: who refused it. */
  readonly refusedBy?: RefusalKind;
  /** A refinement ran to its end and its result is on the page (refine, Prefit). */
  readonly refined?: boolean;
  /**
   * A change made: whether the fit on screen is another one after it (a
   * refinement's result, a change that cleared it, a History step's put
   * back). Absent for a call that changed nothing.
   */
  readonly fitChanged?: boolean;
}

/**
 * Where the analysis stands, as the chat loop reads it between tool calls:
 * its loop guard compares fingerprints (did a call change anything?), and a
 * local model's tool list follows the page and the method's stage.
 */
export interface AgentSituation {
  readonly page: AgentPage;
  /** The method's next required stage (its id), or null when every required one is done. */
  readonly stage: string | null;
  /** The stages done (ids). */
  readonly stagesDone: readonly string[];
  /** The magnetic step is under way: a magnetic model on the page, or the step's tools used in this conversation. */
  readonly magnetic: boolean;
  /** Changes whenever anything a tool can change changes: the parameters and their values, the fit, the settings, the History step, the method's record. */
  readonly fingerprint: string;
  /** One sentence for the user: the page, the stages done, the next, the last refinement. */
  readonly summary: string;
}

/** What the chat calls: the executor, or a lazy stand-in for it. */
export interface ToolRunner {
  /** Run one call; `signal` is the user's Stop: a call it reaches before acting is not run, and a running fit is cancelled. */
  readonly run: (name: string, input: unknown, signal?: AbortSignal) => Promise<ToolOutcome>;
  /** A new conversation: the skills read in the last one must be read again. */
  readonly newConversation?: () => void;
  /** What the user said: a number they gave (a published refinement's, a reference value) may be quoted in the report. */
  readonly heard?: (text: string) => void;
  /** Where the analysis stands now; null with nothing open. */
  readonly situation?: () => Promise<AgentSituation | null> | AgentSituation | null;
  /** The Agent's words with its {{references}} filled in from the page as it stands (numbers by reference). */
  readonly fill?: (text: string) => string;
  /** The page the analysis is on, for the checks on a final answer (evidence.ts); null with none open. */
  readonly page?: () => "powder" | "pdf" | "singleCrystal" | null;
  /** The page's stamp now (what a change is approved against); null with none open. A choice set holds while it is the same. */
  readonly stamp?: () => string | null;
}

export interface ExecutorOptions {
  /** Ask the user to approve a change. Resolves false when they decline. */
  readonly approve: (entry: ActivityEntry, signal?: AbortSignal) => Promise<boolean>;
  /** Every status change of every call, for the drawer. */
  readonly onActivity: (entry: ActivityEntry) => void;
  /** Largest answer, in characters of compact JSON (default 8000, as the MCP server). */
  readonly budget?: number;
  /** The model and how it is reached, for the report ("Claude Opus 5.5 · Anthropic API"). */
  readonly modelLabel?: () => string;
  /** A report the Agent wrote (write_report), for the viewer. */
  readonly onReport?: (report: AgentReport) => void;
  /**
   * The skills (default on). Off is the validation's ablation arm
   * (docs/VALIDATION.md): read_skill is refused and no change waits for a
   * method to be read; every other rule still holds.
   */
  readonly skills?: boolean;
}

let nextCallId = 1;

export class AgentExecutor implements ToolRunner {
  /** The answers of this conversation, their bulky parts by ref. */
  private readonly answers: Answers;
  /** The skills read in this conversation (a page's method gates its changes). */
  private readonly skillsRead = new Set<string>();
  /** Changes run one at a time: the page has one compute client and one history. */
  private changes: Promise<unknown> = Promise.resolve();
  /** The last posterior run (sample_posterior), with the analysis and the step it sampled: for the report. */
  private posterior: SampledPosterior | null = null;
  /** Per analysis: the instrument terms and the thermal parameters as each was last refined, for the alternation. */
  private readonly alternations = new Map<string, Alternation>();

  constructor(private readonly host: AgentHost, private readonly opts: ExecutorOptions) {
    this.answers = new Answers(opts.budget ?? 8000);
  }

  /** The skills are on (off: the validation's ablation arm). */
  private get skills(): boolean {
    return this.opts.skills !== false;
  }

  /**
   * A new conversation: the skills, the user's words and the refs to earlier
   * answers belong to the last one. What belongs to the analysis stays: its
   * record (saved with the project), the alternation, and the last posterior
   * run, which the report places by the History step it sampled.
   */
  newConversation(): void {
    this.skillsRead.clear();
    this.userText = [];
    this.asked = null;
    this.magneticUsed = false;
    this.answers.clear();
  }

  /** The magnetic step's tools ran in this conversation (its panel then counts in the fingerprint). */
  private magneticUsed = false;

  /** The page open. */
  page(): "powder" | "pdf" | "singleCrystal" | null {
    return this.host.port()?.technique ?? null;
  }

  /** Where the analysis stands (the chat's loop guard and a local model's tool list read it). */
  situation(): AgentSituation | null {
    const port = this.host.port();
    if (!port) return null;
    return onPage(port, (page, p) => {
      const s = page.state(p);
      const record = syncStages(this.host, p);
      const progress = methodProgress(p.technique, record);
      const next = progress.stages.find((st) => !st.done && !st.optional) ?? null;
      const panel = this.stepOf(page, p);
      const fingerprint = hashText(JSON.stringify({
        step: this.currentStep()?.id ?? null,
        busy: s.busy,
        stamp: page.stamp(s, panel),
        result: s.result ? [s.result.status, s.result.history.length, Object.keys(s.result.esd).sort()] : null,
        // What the magnetic step's reads found: the k candidates, the groups fitted.
        panel: panel ? [panel.kSearch?.length ?? null, panel.candidates.filter((c) => c.fit !== undefined).length] : null,
        record: [record.stagesDone, record.exceptions.map((e) => e.rule), !!record.rangeCheck, !!record.cellCheck, !!record.dataCheck, !!record.symmetryReviewed],
      }));
      const done = progress.stages.filter((st) => st.done).map((st) => st.label);
      const fit = s.result ? `the last refinement ${s.result.status}` : "no refinement on screen yet";
      return {
        page: p.technique,
        stage: next?.id ?? null,
        stagesDone: record.stagesDone,
        magnetic: this.magneticUsed || (page.magneticModel?.(s) ?? false),
        fingerprint,
        summary: `the ${PAGE_LABEL[p.technique]} page; done: ${done.length ? done.join(", ") : "nothing yet"}; next: ${next?.label ?? "every required stage is done"}; ${fit}.`,
      };
    });
  }

  /** The page's stamp now, as a change is checked against it: a choice set made at another one no longer describes the page. */
  stamp(): string | null {
    const port = this.host.port();
    return port ? onPage(port, (page, p) => page.stamp(page.state(p), this.stepOf(page, p))) : null;
  }

  /** The magnetic step's panel once its tools are in use in this conversation: then the stamp and the fingerprint carry it. */
  private stepOf<P extends AgentPort>(page: PageAdapter<P>, port: P): MagneticPanelState | null {
    return this.magneticUsed ? page.magneticStep?.(port) ?? null : null;
  }

  /** The user's messages in this conversation: their numbers are theirs to quote, not the Agent's own. */
  private userText: string[] = [];
  /** The messages the options of the Agent's open question send (ask_user): the Agent's words, not the user's. */
  private asked: ReadonlySet<string> | null = null;

  heard(text: string): void {
    // A clicked option sends the Agent's own words: its numbers are not the user's to vouch for (the report's audit).
    const echoed = this.asked?.has(text.trim()) ?? false;
    this.asked = null;
    if (!echoed) this.userText.push(text);
  }

  /** What the page's references resolve against now; null with no analysis open. */
  private referenceSource(): ReferenceSource | null {
    const port = this.host.port();
    if (!port) return null;
    return onPage(port, (page, p) => {
      const s = page.state(p);
      return { entries: page.references(s), parameters: s.parameters, esd: s.result?.esd ?? {} };
    });
  }

  /** The Agent's words with its references filled in from the page as it stands; a reference it cannot fill stays as written. */
  fill(text: string): string {
    if (!text.includes("{{")) return text;
    return fillReferences(text, this.referenceSource()).text;
  }

  /** Filled, or refused when a reference names nothing the page has: the report and the notes keep no unfilled reference. */
  private fillOrRefuse(text: string, where: string): string {
    const source = this.referenceSource();
    const out = fillReferences(text, source);
    if (out.unknown.length > 0) {
      throw new Error(`${where}: ${out.unknown.map((k) => `{{${k}}}`).join(", ")} ${out.unknown.length === 1 ? "names" : "name"} no value the page has now. The references here: ${source ? referenceCatalog(source) : "none (no analysis is open)"}. Use one of them, or write the number with the tool that gave it.`);
    }
    return out.text;
  }

  /** Run one call. Never throws: failures come back as an error outcome the model can read. */
  run(name: string, input: unknown, signal?: AbortSignal): Promise<ToolOutcome> {
    const spec = liveTool(name);
    if (!spec) return Promise.resolve(error(`no tool named ${name}`));
    if (spec.effect !== "change") return this.execute(spec, input, signal);
    // A change queued behind another still checks the Stop when its turn comes.
    const run = this.changes.then(() => this.execute(spec, input, signal));
    this.changes = run.catch(() => undefined);
    return run;
  }

  private async execute(spec: LiveToolSpec, raw: unknown, signal?: AbortSignal): Promise<ToolOutcome> {
    if (signal?.aborted) return stopped();
    if (spec.magneticStep) this.magneticUsed = true;
    let entry: ActivityEntry = { id: `c${nextCallId++}`, tool: spec.name, title: spec.title, effect: spec.effect, at: Date.now(), status: "running", ...(spec.alwaysAsk ? { alwaysAsk: true } : {}) };
    const update = (patch: Partial<ActivityEntry>): void => {
      entry = { ...entry, ...patch };
      this.opts.onActivity(entry);
    };
    try {
      const parsed = z.object(spec.inputSchema).strict().safeParse(raw ?? {});
      if (!parsed.success) throw new Error(`invalid input for ${spec.name}: ${z.prettifyError(parsed.error)}`);
      const input = parsed.data as Record<string, unknown>;

      if (spec.name === "read_ref") {
        update({});
        const out = this.answers.readRef(input as { ref: string; start?: number; end?: number });
        update({ status: "done" });
        return { isError: false, text: JSON.stringify(out), status: "ok" };
      }
      if (spec.name === "read_skill") {
        if (!this.skills) throw new Error("there are no skills in this configuration: decide the method yourself");
        // Whole, as Markdown: a skill is read as written, not paged as a ref.
        const { name, reference } = input as { name: string; reference?: string };
        update({ preview: reference ? `${name} · ${reference}` : name });
        const text = readSkill(name, reference);
        if (reference === undefined) this.skillsRead.add(name);
        update({ status: "done" });
        return { isError: false, text, status: "ok" };
      }

      const port = this.requirePort();
      if (!spec.pages.includes(port.technique)) {
        const where = spec.pages.map((p) => PAGE_LABEL[p]).join(" and ");
        throw new Error(`${spec.name} works on the ${where} page${spec.pages.length === 1 ? "" : "s"} only; the ${PAGE_LABEL[port.technique]} page is open`);
      }
      if (spec.effect === "control") {
        update({});
        port.cancel();
        update({ status: "done", outcome: "Cancel requested" });
        return this.respond({ cancelled: port.state().busy ? "requested" : "nothing was running" });
      }

      return await onPage(port, (page, p) => this.executeOn(page, p, spec, input, () => entry, update, signal));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      update({ status: "failed", outcome: message });
      return e instanceof Refusal ? refused(message, e.by) : error(message);
    }
  }

  /**
   * A call on the page open, typed on that page through its adapter: the
   * record's notes, the report, a read, or a change (gated, checked, asked,
   * made as the agent, and answered).
   */
  private async executeOn<P extends AgentPort>(
    page: PageAdapter<P>,
    port: P,
    spec: LiveToolSpec,
    input: Record<string, unknown>,
    entry: () => ActivityEntry,
    update: (patch: Partial<ActivityEntry>) => void,
    signal?: AbortSignal,
  ): Promise<ToolOutcome> {
    if (spec.name === "write_note") {
      // The record's notes, not the page: no approval, no history step.
      // Its numbers as they stand when it is written: the note keeps them.
      const text = this.fillOrRefuse((input as { text: string }).text.trim(), "write_note");
      update({ preview: text });
      const notes = addNote(this.host, page.analysis(page.state(port)), text);
      update({ status: "done" });
      return this.respond({ noted: true, notes });
    }

    if (spec.name === "ask_user") {
      // A question for the user, as buttons under the turn (choices.ts); the chat ends the turn on it.
      // Its words are the Agent's: references filled as in a note, and an option clicked is not the user's numbers.
      const q = input as { question: string; options: { label: string; message: string }[]; other?: string };
      const fill = (text: string): string => this.fillOrRefuse(text, "ask_user");
      const options = q.options.map((o) => ({ label: fill(o.label), message: fill(o.message) }));
      const set = questionChoices(fill(q.question), options, q.other === undefined ? undefined : fill(q.other));
      this.asked = new Set(options.map((o) => o.message));
      update({ preview: set.title, status: "done", outcome: `Asked, with ${options.length} options`, choices: { ...set, stamp: page.stamp(page.state(port), this.stepOf(page, port)) } });
      return this.respond({ asked: true, options: options.length, note: "Shown to the user; your turn ends here. Their answer comes as their next message: an option's message, or their own words." });
    }

    if (spec.name === "write_report") {
      update({});
      // Let the drawer paint "running" before the checks run.
      await new Promise((r) => setTimeout(r, 0));
      const summary = this.fillOrRefuse((input as { summary: string }).summary, "write_report");
      const context = { host: this.host, skills: this.skills, posterior: this.posterior, userText: this.userText, ...(this.opts.modelLabel ? { modelLabel: this.opts.modelLabel } : {}), ...(this.opts.onReport ? { onReport: this.opts.onReport } : {}) };
      return this.respond(await writeReport(context, page, port, summary, update));
    }

    if (spec.effect === "read" || spec.effect === "compute") {
      update({});
      // The space group is questioned last: only once the method's stages
      // are refined, on a converged fit.
      if (spec.name === "review_symmetry") {
        const notYet = symmetryNotYet(port.technique, syncStages(this.host, port), port.state().result?.status, this.skills);
        if (notYet) {
          update({ status: "failed", outcome: notYet.line });
          return refused(notYet.message, "symmetry-gate");
        }
      }
      // Let the drawer paint "running" before a heavy synchronous analysis.
      await new Promise((r) => setTimeout(r, 0));
      let out = spec.name === "sample_posterior"
        ? await samplePosteriorTool(input as { continue?: boolean; steps?: number; compare?: [string, string][] }, port, (run) => { this.posterior = { run, key: page.analysis(page.state(port)), step: this.currentStep() }; })
        : await page.read(spec.name, input, port, this.host);
      noteRead(this.host, port, spec.name, out, this.currentStep());
      if (spec.name === "get_state") {
        const source = this.referenceSource();
        out = { ...withoutMethod(out, this.skills), ...recordView(this.host, port, this.skills), ...(source ? { references: `Quote the engine's numbers by reference; the app fills them in where your words are shown and in the report: ${referenceCatalog(source)}.` } : {}) };
      }
      // A decision the result hands the user, as options for the drawer, for the page as it stands now.
      const offered = choicesFor(spec.name, out, choiceContext(page.state(port)));
      update({ status: "done", ...(offered ? { choices: { ...offered, stamp: page.stamp(page.state(port), this.stepOf(page, port)) } } : {}) });
      return this.respond(out);
    }

    // A change: only once the page's method has been read, never while a fit
    // runs; then ask, then act as the agent.
    const gate = methodGate(spec, port.technique, this.skillsRead, this.skills);
    if (gate) throw gate;
    if (spec.name === "allow_exception") return await this.allowException(port, input as { rule: MethodRule; reason: string }, entry(), update);
    const before = page.state(port);
    if (before.busy) throw new Refusal("a refinement is running — wait for it to finish, or call cancel_refinement", "busy");
    // What the change is checked and approved against.
    const stamp = page.stamp(before, this.stepOf(page, port));
    // The change, planned on the state it is checked against: nothing to do, or the card's line and the change.
    const plan = page.plan(spec, input, before, port);
    if ("noOp" in plan) {
      update({ status: "done", outcome: "No change" });
      return { ...this.respond({ unchanged: true, note: plan.noOp }), status: "unchanged" };
    }
    let preview = plan.preview;
    // The method's firm rules, then its order (a note, not a refusal).
    const key = page.analysis(before);
    const freeBefore = before.parameters.filter((p) => !p.fixed && !p.expression);
    const { rule, orderNote } = firmRules(spec.name, input, port.technique, before, () => syncStages(this.host, port), this.skills);
    if (rule) {
      update({ status: "failed", preview, outcome: rule.line });
      return refused(rule.message, "firm-rule");
    }
    if (spec.name === "refine") {
      // Correlated parameters are never refined together: measure the free
      // set first, and ask the user only about a set that may run.
      update({ preview: "Checking correlations…" });
      const check = await correlationGate(page, port, before);
      if ("refused" in check) {
        update({ status: "failed", preview, outcome: check.refused.line });
        return refused(check.refused.message, "correlation");
      }
      preview += check.note;
    }
    update({ status: "waiting", preview });
    if (!(await this.opts.approve(entry(), signal))) {
      update({ status: "declined", outcome: signal?.aborted ? "Stopped" : "Declined" });
      if (signal?.aborted) return stopped();
      return { ...this.respond({ declined: true, note: "The user declined this change. Ask what they would prefer, or propose something else." }), status: "declined" };
    }
    // The card may have waited a long time: Stop, a running fit, or a page that changed since it was checked all hold the change back.
    if (signal?.aborted) {
      update({ status: "declined", outcome: "Stopped" });
      return stopped();
    }
    // The page as it is now (a port is a render's view: ask the host again); another page open is a page changed.
    const nowPort = page.own(this.requirePort());
    const now = nowPort ? page.state(nowPort) : null;
    const why = staleReason(now, !!nowPort && !!now && !now.busy && page.stamp(now, this.stepOf(page, nowPort)) === stamp);
    if (why !== null) {
      update({ status: "failed", outcome: `Not run: ${why}` });
      return refused(`not run: ${why}, so what was checked and approved no longer describes it. Read the state again (get_state) and propose the change again if it still applies.`, "stale");
    }
    update({ status: "running" });
    // The user's own unsaved edits become their step first, so the agent's
    // step holds only what the agent changed.
    this.host.recordNow("edit");
    // Stop cancels a fit this change started.
    const cancel = (): void => this.host.port()?.cancel();
    signal?.addEventListener("abort", cancel);
    const changed = await this.host.asAgent(async () => {
      const n = await plan.apply(this.host);
      await this.host.settle();
      if (spec.historyStep) {
        this.host.recordNow(spec.historyStep);
        await this.host.settle();
      }
      return n;
    }).finally(() => signal?.removeEventListener("abort", cancel));
    const note = typeof changed === "object" ? changed.note : changed;
    const afterPort = page.own(this.requirePort());
    if (!afterPort) throw new Error(`the ${PAGE_LABEL[page.page]} page was closed while the change ran`);
    const after = page.state(afterPort);
    // Where the fit started, once per analysis: the report gives it before the steps.
    if (spec.name === "refine" && after.result && after.result !== before.result && !this.host.record(key).start) {
      this.host.updateRecord(key, (r) => (r.start ? r : { ...r, start: { at: Date.now(), agreement: page.agreement(before), ...page.start(before) } }));
    }
    let alternation: Record<string, unknown> | null = null;
    if (spec.name === "refine" && after.result?.status === "converged" && after.result !== before.result) {
      const covered = stagesCovered(port.technique, freeBefore, before.parameters);
      this.host.updateRecord(key, (r) => ({ ...r, stagesDone: [...new Set([...r.stagesDone, ...covered])] }));
      const step = advanceAlternation(this.alternations.get(key) ?? {}, freeBefore, after.parameters, after.result.esd);
      this.alternations.set(key, step.memory);
      alternation = alternationView(step.memory, step.refined, after.parameters);
    }
    const out = {
      ...changeOutcome(page, spec.name, before, after, this.currentStep(), note),
      ...(typeof changed === "object" ? changed.data : {}),
      ...(orderNote ? { methodNote: orderNote } : {}),
      ...(alternation ?? {}),
      ...page.outcome?.(spec.name, afterPort),
    };
    update({ status: "done", outcome: outcomeLine(page, spec.name, before, after, note) });
    // refine's own "refined" (changeOutcome): its result on the page, for the loop and the harness to read.
    return { ...this.respond(out), ...(spec.name === "refine" ? { refined: !!after.result && after.result !== before.result } : {}), fitChanged: after.result !== before.result };
  }

  private requirePort(): AgentPort {
    const port = this.host.port();
    if (port) return port;
    throw new Error("no analysis is open — ask the user to load a structure and data, or a demo");
  }

  private currentStep(): { id: string; label: string } | null {
    const h = this.host.history();
    const st = h?.steps.find((s) => s.id === h.current);
    return st ? { id: st.id, label: st.name ?? st.label } : null;
  }

  /** allow_exception: the user lifts a firm rule for this analysis. Always asks them. */
  private async allowException(port: AgentPort, input: { rule: MethodRule; reason: string }, entry: ActivityEntry, update: (patch: Partial<ActivityEntry>) => void): Promise<ToolOutcome> {
    const rule = RULES[input.rule];
    if (!rule.pages.includes(port.technique)) throw new Error(`the rule "${input.rule}" does not apply on this page`);
    update({ status: "waiting", preview: `${rule.title}, because: ${input.reason}` });
    if (!(await this.opts.approve({ ...entry, status: "waiting", preview: `${rule.title}, because: ${input.reason}`, alwaysAsk: true }))) {
      update({ status: "declined", outcome: "Declined" });
      return { ...this.respond({ declined: true, note: "The user keeps the rule. Work within it, or ask what they would prefer." }), status: "declined" };
    }
    const key = analysisOf(port);
    this.host.updateRecord(key, (r) => ({ ...r, exceptions: [...r.exceptions.filter((e) => e.rule !== input.rule), { rule: input.rule, reason: input.reason, at: Date.now() }] }));
    update({ status: "done", outcome: "Allowed for this analysis" });
    return this.respond({ allowed: input.rule, until: "the data or the phases change" });
  }

  private respond(out: unknown): ToolOutcome {
    return this.answers.respond(out);
  }
}

/** What a choice set's values are in: the structure's cell and space group as loaded (k is in its reciprocal-lattice units). */
function choiceContext(state: unknown): ChoiceContext {
  const structure = (state as { structure?: { cell?: ChoiceContext["cell"]; spaceGroup?: { hermannMauguin?: string } } }).structure;
  return {
    ...(structure?.cell ? { cell: structure.cell } : {}),
    ...(structure?.spaceGroup?.hermannMauguin ? { spaceGroup: structure.spaceGroup.hermannMauguin } : {}),
  };
}

function error(message: string): ToolOutcome {
  return { isError: true, text: `Error: ${message}`, status: "error" };
}

/** Refused by a rule or a guard: the model reads it as an error with what to do. */
function refused(message: string, by: RefusalKind): ToolOutcome {
  return { isError: true, text: `Error: ${message}`, status: "refused", refusedBy: by };
}

function stopped(): ToolOutcome {
  return { isError: true, text: `Error: ${STOPPED}`, status: "stopped" };
}

/** What the model learns after a change: the effect on the fit (by the agreement the page shows) and the step it became. */
function changeOutcome<P extends AgentPort>(
  page: PageAdapter<P>,
  name: string,
  before: StateOf<P>,
  after: StateOf<P>,
  step: { id: string; label: string } | null,
  note: string | undefined,
): Record<string, unknown> {
  const key = page.agreementKey;
  const free = after.parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.id);
  const base = { step, ...(note ? { note } : {}), freeCount: free.length };
  if (name === "refine") {
    const r = after.result;
    if (!r || r === before.result) {
      return { ...base, refined: false, note: note ?? "The refinement did not finish (cancelled or failed); the parameters are unchanged. get_state shows the current values." };
    }
    return {
      ...base,
      refined: true,
      status: r.status,
      [key]: pct(r.agreement.rWeighted ?? 0),
      [`${key}Before`]: pct(page.agreement(before)),
      ...page.figures(before, after, r),
      iterations: r.history.length,
      ...(r.diagnostics ? { atBounds: r.diagnostics.atBounds.map((b) => b.parameterId), maxShiftOverEsd: Number(r.diagnostics.maxShiftOverEsd.toPrecision(3)) } : {}),
      ...developedCorrelations(r, after.parameters, after.restraints, page.assemblies(after)),
      // A shared site's last occupancy that left [0, 1]: the tie never clamps it.
      ...(siteSumRangeWarnings(after.parameters).length > 0 ? { occupancyWarnings: siteSumRangeWarnings(after.parameters) } : {}),
      ...(r.message ? { message: r.message } : {}),
    };
  }
  // A long free set by kind, as the History's rows give it (a structure of 567 parameters would fill the context with ids).
  if (name === "set_free") return { ...base, free: free.length > 40 ? freeSummary(after.parameters) : free };
  return { ...base, [key]: pct(page.agreement(after)), lastResultCleared: before.result !== null && after.result === null };
}

function outcomeLine<P extends AgentPort>(page: PageAdapter<P>, name: string, before: StateOf<P>, after: StateOf<P>, note: string | undefined): string {
  if (name === "refine") {
    const r = after.result;
    if (!r || r === before.result) return "Did not finish";
    return `${r.status} · ${page.agreementKey} ${pct(r.agreement.rWeighted ?? 0).toFixed(2)}%`;
  }
  return note ?? "Done";
}

/** What a stopped call answers. */
const STOPPED = "Stopped by the user before this ran.";
