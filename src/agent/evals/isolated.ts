/**
 * A live eval run in a process of its own, so that it can be stopped.
 *
 * A scenario's page work (a moment fit with many free components, a ranking
 * with restarts) runs on the thread that called it and can hold that thread
 * for many minutes. A timer on the same thread cannot fire while it does, so
 * a run inside the test process can outlast every limit set on it. Here each
 * run is a child process (Vitest on isolatedRun.test.ts, so the scenario runs
 * exactly as it would in the test process); this process only waits on it,
 * keeps its own timers free, and kills the child's whole process group when a
 * limit is reached.
 *
 * Two limits: the run's own (counted from the moment the child starts the
 * scenario, as Vitest's per-test timeout counted it; the child has two
 * minutes to get there) and the overall cap of
 * the live run (wall-clock, an absolute end time shared by every run). A run
 * stopped by either is recorded as a failure, outcome "timeout", with its
 * conversation up to that point and the call it was in: the child writes its
 * progress to a file as it goes, which survives the kill.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tierFlags, transcript, type EvalEvent, type EvalModel, type EvalUsage, type RunProgress, type SavedRun, type TierFlags } from "@/agent/evals/harness";

/** The repository's root, where the child Vitest runs. */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
/** The child's test file: runs the one scenario named in CHILD_ENV. */
export const CHILD_TEST = "src/agent/evals/isolatedRun.test.ts";
/** The variable that hands the child its run (a ChildSpec as JSON). */
export const CHILD_ENV = "MATERIA_AGENT_EVAL_CHILD";

/**
 * Where a scenario is looked up: the eval suite's scenarios, or the ones the
 * harness's own test stops (isolated.test.ts).
 */
export type ScenarioSet = "evals" | "stuck";

/** What the child process is asked to run. */
export interface ChildSpec {
  readonly scenario: string;
  readonly set: ScenarioSet;
  readonly model: EvalModel;
  /** The progress file the child appends to (ProgressLine, one per line). */
  readonly progress: string;
  /** Where the child writes the finished run (a SavedRun), whole or not at all. */
  readonly result: string;
}

/** A line of the progress file. Events and notices carry their index: a later line for the same index replaces it (a reply's text grows). */
export type ProgressLine =
  | { readonly kind: "start" }
  | { readonly kind: "technique"; readonly technique: SavedRun["technique"] }
  | { readonly kind: "event"; readonly i: number; readonly event: EvalEvent }
  | { readonly kind: "notice"; readonly i: number; readonly text: string }
  | { readonly kind: "usage"; readonly usage: EvalUsage }
  | { readonly kind: "during"; readonly during: string | null };

/**
 * A run stopped before it finished: what it had done by then. Its one grade
 * is the reason, so every summary counts it a failure.
 */
export interface StoppedRun {
  readonly scenario: string;
  /** Absent when the run was stopped before its page was made. */
  readonly technique?: SavedRun["technique"];
  readonly passed: false;
  readonly outcome: "timeout" | "error";
  /** Which limit stopped it (a timeout): the run's own, or the live run's overall cap. */
  readonly limit?: "run" | "cap";
  /** What the run was doing when it was stopped. */
  readonly during: string | null;
  readonly usage: EvalUsage;
  readonly grades: readonly { readonly check: string; readonly pass: false; readonly detail: string }[];
  readonly events: readonly EvalEvent[];
  readonly notices: readonly string[];
  readonly seconds: number;
}

export interface IsolatedRun {
  readonly outcome: "finished" | "timeout" | "error";
  /** The run as the _OUT report keeps it: the whole saved run, or the run so far. */
  readonly record: SavedRun | StoppedRun;
  readonly flags: TierFlags;
}

export interface IsolatedOptions {
  readonly scenario: string;
  readonly set?: ScenarioSet;
  readonly model: EvalModel;
  /** The run's own limit, from the moment the child starts the scenario (it has STARTUP_MS to get there). */
  readonly runMs: number;
  /** The overall cap: the time (Date.now()) every run must end by. */
  readonly capEndsAt?: number;
}

/** How long a child may take to start its scenario (Vitest's start-up, the modules loaded) before it is stopped; the cap bounds it too. */
const STARTUP_MS = 2 * 60_000;
const ZERO: EvalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const TAIL = 4000;

/** Turn a run's progress into the lines not yet written (`sent` keeps the counts). The last event and notice are written again: a reply grows. */
export function progressLines(p: RunProgress, sent: { events: number; notices: number; technique: boolean }): ProgressLine[] {
  const lines: ProgressLine[] = [];
  if (p.technique && !sent.technique) {
    lines.push({ kind: "technique", technique: p.technique });
    sent.technique = true;
  }
  for (let i = Math.max(0, sent.events - 1); i < p.events.length; i++) lines.push({ kind: "event", i, event: p.events[i]! });
  for (let i = sent.notices; i < p.notices.length; i++) lines.push({ kind: "notice", i, text: p.notices[i]! });
  sent.events = p.events.length;
  sent.notices = p.notices.length;
  lines.push({ kind: "usage", usage: { ...p.usage } }, { kind: "during", during: p.during });
  return lines;
}

/** The run so far, read back from the progress file (a line cut by the kill is left out). */
export function readProgress(text: string): { started: boolean; technique?: SavedRun["technique"]; events: EvalEvent[]; notices: string[]; usage: EvalUsage; during: string | null } {
  const events: EvalEvent[] = [];
  const notices: string[] = [];
  let usage = ZERO;
  let during: string | null = null;
  let started = false;
  let technique: SavedRun["technique"] | undefined;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let line: ProgressLine;
    try {
      line = JSON.parse(raw) as ProgressLine;
    } catch {
      continue;
    }
    if (line.kind === "start") started = true;
    else if (line.kind === "technique") technique = line.technique;
    else if (line.kind === "event") events[line.i] = line.event;
    else if (line.kind === "notice") notices[line.i] = line.text;
    else if (line.kind === "usage") usage = line.usage;
    else during = line.during;
  }
  return { started, ...(technique ? { technique } : {}), events: events.filter(Boolean), notices: notices.filter((n) => n !== undefined), usage, during };
}

/** Kill the child and everything it started (Vitest's pool workers), the group too once the child itself has ended. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    // The group is gone already (ESRCH); the child alone, if it is not.
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

/** The child's environment: this one, without the variables this process's Vitest set for itself. */
function childEnv(spec: ChildSpec): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("VITEST") && k !== "TEST") env[k] = v;
  env[CHILD_ENV] = JSON.stringify(spec);
  return env;
}

const span = (ms: number): string => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 6_000) / 10} min`);

/**
 * Run one scenario in a child process and wait for it, stopping it at the
 * first limit it reaches. Never throws for the run: a run that is stopped,
 * or whose process fails, comes back as a StoppedRun.
 */
export async function runIsolated(opts: IsolatedOptions): Promise<IsolatedRun> {
  const dir = mkdtempSync(join(tmpdir(), "materia-eval-run-"));
  const spec: ChildSpec = { scenario: opts.scenario, set: opts.set ?? "evals", model: opts.model, progress: join(dir, "progress.jsonl"), result: join(dir, "result.json") };
  const capEndsAt = opts.capEndsAt ?? Number.POSITIVE_INFINITY;
  const spawned = Date.now();
  // Set from the timer (the child began the scenario; a limit stopped it): read through the box, so the checks after the wait see it.
  const box: { started: number | null; stopped: { at: number; limit: "run" | "cap" } | null } = { started: null, stopped: null };
  let tail = "";
  const keep = (b: Buffer): void => {
    tail = (tail + b.toString("utf8")).slice(-TAIL);
  };
  try {
    const child = spawn(process.execPath, [join(ROOT, "node_modules/vitest/vitest.mjs"), "run", CHILD_TEST, "--reporter=dot"], {
      cwd: ROOT,
      env: childEnv(spec),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    // If this process ends first (Ctrl-C, an outer limit), the child goes with it.
    const onExit = (): void => killTree(child);
    process.once("exit", onExit);
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", (e) => {
        keep(Buffer.from(String(e)));
        resolve({ code: null, signal: null });
      });
    });
    const tick = setInterval(() => {
      const now = Date.now();
      if (box.started === null && existsSync(spec.progress)) box.started = now;
      // The finished run is written whole (a rename): the child need not be waited for further.
      if (existsSync(spec.result)) {
        killTree(child);
        return;
      }
      const runEnds = box.started === null ? spawned + STARTUP_MS : box.started + opts.runMs;
      if (now >= Math.min(runEnds, capEndsAt)) {
        box.stopped ??= { at: now, limit: runEnds <= capEndsAt ? "run" : "cap" };
        killTree(child);
      }
    }, 100);
    const exit = await exited;
    clearInterval(tick);
    process.removeListener("exit", onExit);
    killTree(child); // anything of the run's left in its group

    if (existsSync(spec.result)) {
      const saved = JSON.parse(readFileSync(spec.result, "utf8")) as SavedRun;
      return { outcome: "finished", record: saved, flags: tierFlags(saved) };
    }
    const stopped = box.stopped;
    const so = existsSync(spec.progress) ? readProgress(readFileSync(spec.progress, "utf8")) : readProgress("");
    const from = box.started ?? spawned;
    const doing = so.during ?? (so.started ? "between tool calls" : "starting the run's process");
    const limitText = stopped?.limit === "cap" ? `the overall cap (${span(capEndsAt - spawned)} left when the run began)`
      : box.started === null ? `${span(STARTUP_MS)}: its process did not start the run` : `the run's limit of ${span(opts.runMs)}`;
    const grade = stopped
      ? { check: "timeout", pass: false as const, detail: `stopped at ${limitText}, during ${doing}` }
      : { check: "error", pass: false as const, detail: `the run's process ended (exit ${exit.code ?? exit.signal ?? "unknown"}) before the run finished, during ${doing}:\n${tail.trim()}` };
    const record: StoppedRun = {
      scenario: opts.scenario,
      ...(so.technique ? { technique: so.technique } : {}),
      passed: false,
      outcome: stopped ? "timeout" : "error",
      ...(stopped ? { limit: stopped.limit } : {}),
      during: so.during,
      usage: so.usage,
      grades: [grade],
      events: so.events,
      notices: so.notices,
      seconds: ((stopped?.at ?? Date.now()) - from) / 1000,
    };
    return { outcome: record.outcome, record, flags: tierFlags(record) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The run's transcript, for a failing test's message or the _OUT report (a stopped run's, as far as it went). */
export function isolatedTranscript(run: IsolatedRun, max?: number): string {
  return transcript(run.record, max);
}

/** Write a finished run whole, or not at all: the parent reads the file as soon as it exists. */
export function writeWhole(path: string, text: string): void {
  writeFileSync(`${path}.part`, text);
  renameSync(`${path}.part`, path);
}

/** One run of a live eval: its label (the scenario, with its repeat number), and what came of it. */
export interface LiveRun {
  readonly label: string;
  readonly scenario: string;
  readonly run: IsolatedRun;
}

/**
 * The runs of a live eval, one after another, under the overall cap: each
 * run gets its own limit or what is left of the cap, whichever is less; once
 * the cap is spent, the runs not yet started are not run, and are listed so.
 * The cap's clock starts with the first run.
 */
export class LiveRuns {
  readonly runs: LiveRun[] = [];
  readonly notRun: string[] = [];
  private capEndsAt: number | null = null;

  constructor(
    private readonly model: EvalModel,
    readonly limits: { readonly runMs: number; readonly capMs: number },
    private readonly set: ScenarioSet = "evals",
  ) {}

  /** The cap was reached: a run was stopped by it, or a run was not started. */
  get capReached(): boolean {
    return this.notRun.length > 0 || this.runs.some((r) => r.run.outcome === "timeout" && (r.run.record as StoppedRun).limit === "cap");
  }

  /** Run the next one, or null (and listed as not run) when the cap is spent. */
  async next(label: string, scenario: string): Promise<LiveRun | null> {
    this.capEndsAt ??= Date.now() + this.limits.capMs;
    if (Date.now() >= this.capEndsAt) {
      this.notRun.push(label);
      return null;
    }
    const run = await runIsolated({ scenario, set: this.set, model: this.model, runMs: this.limits.runMs, capEndsAt: this.capEndsAt });
    const done = { label, scenario, run };
    this.runs.push(done);
    return done;
  }

  /** The summary, one row per scenario (in the order given). */
  rows(scenarios: readonly string[]): LiveRow[] {
    return scenarios.map((id) => {
      const runs = this.runs.filter((r) => r.scenario === id).map((r) => r.run);
      const flags = runs.map((r) => r.flags);
      return {
        id,
        passed: runs.filter((r) => r.record.passed).length,
        runs: runs.length,
        seconds: Math.round(runs.reduce((t, r) => t + (r.record.seconds ?? 0), 0)),
        turnCap: flags.filter((f) => f.turnCap).length,
        loopStopped: flags.filter((f) => f.loopStopped).length,
        chatError: flags.filter((f) => f.chatError).length,
        truncated: flags.filter((f) => f.truncated).length,
        maxSameCall: Math.max(0, ...flags.map((f) => f.maxSameCall)),
        timeout: runs.filter((r) => r.outcome === "timeout").length,
        error: runs.filter((r) => r.outcome === "error").length,
        notRun: this.notRun.filter((l) => l === id || l.startsWith(`${id} #`)).length,
      };
    });
  }

  /** Tokens spent over every run (a stopped run's, as far as it went). */
  usage(): EvalUsage {
    return this.runs.reduce((u, { run }) => ({
      input: u.input + run.record.usage.input,
      output: u.output + run.record.usage.output,
      cacheRead: u.cacheRead + run.record.usage.cacheRead,
      cacheWrite: u.cacheWrite + run.record.usage.cacheWrite,
    }), ZERO);
  }

  /** The runs as the _OUT report keeps them: each whole (or as far as it went), with its outcome, flags and transcript. */
  saved(): (Record<string, unknown> & { readonly outcome: IsolatedRun["outcome"] })[] {
    return this.runs.map(({ run }) => ({ ...run.record, outcome: run.outcome, flags: run.flags, transcript: isolatedTranscript(run, 2000) }));
  }
}

/** A row of the live run's summary. */
export interface LiveRow {
  readonly id: string;
  readonly passed: number;
  readonly runs: number;
  readonly seconds: number;
  readonly turnCap: number;
  readonly loopStopped: number;
  readonly chatError: number;
  readonly truncated: number;
  readonly maxSameCall: number;
  /** Runs stopped at a time limit (the run's own or the overall cap). */
  readonly timeout: number;
  /** Runs whose process failed before the run finished. */
  readonly error: number;
  /** Runs never started: the overall cap was spent. */
  readonly notRun: number;
}
